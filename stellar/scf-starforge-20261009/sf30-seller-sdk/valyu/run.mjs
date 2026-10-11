#!/usr/bin/env node
// MIT. Complete customer research workflow on the maintained native merchant/buyer.
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ValyuWorkspace,initializeValyu} from './workspace.mjs';
import {startValyuDesk} from './server.mjs';
import {exportResearchEdition} from './research.mjs';
import {privateJson,readJson,publish,need} from './files.mjs';
import {native,runtimeRoot} from './runtime.mjs';

const help=[
  'Valyu customer research workspace',
  '',
  '  init --state-root PRIVATE_DIRECTORY [--seller-client ORIGINAL_SELLER_CLIENT.mjs]',
  '       [--operator-profile PROFILE.json] [--operator-directory ORIGINAL_SF88_DIRECTORY]',
  '       [--provider-config PROVIDER.json] [--merchant-path /research/search]',
  '  serve --settings SETTINGS.json [--port PORT]',
  '',
  '  list|editions --settings SETTINGS.json [--offset NUMBER]',
  '  request --settings SETTINGS.json --input DRAFT.json',
  '  query --settings SETTINGS.json --id QUERY_ID',
  '  duplicate --settings SETTINGS.json --id QUERY_ID [--title TITLE]',
  '  prepare --settings SETTINGS.json --id QUERY_ID --revision NUMBER --max-atomic TOTAL_CAP --accept INDEX',
  '  review|inspect|execute|collect --settings SETTINGS.json --id QUERY_ID',
  '',
  '  annotation --settings SETTINGS.json --input ANNOTATION.json',
  '  freeze --settings SETTINGS.json --capture CAPTURE_ID --selection-sha SHA256 [--title TITLE]',
  '  edition --settings SETTINGS.json --id EDITION_ID',
  '  compare --settings SETTINGS.json --left EDITION_ID --right EDITION_ID',
  '  export --settings SETTINGS.json --edition EDITION_ID --format json|md|csv|html --out NEW_FILE',
  '  import-edition --settings SETTINGS.json --input EDITION.json',
  '  import-observation --settings SETTINGS.json --id QUERY_ID --response RESPONSE.json',
  '       --request ORIGINAL_REQUEST.json --provenance OBSERVATION.json',
  '',
  '  backup-review --settings SETTINGS.json',
  '  backup --settings SETTINGS.json --out NEW_ARCHIVE_DIRECTORY --quiesced [--pass-env ENV_NAME]',
  '  verify|restore --bundle ARCHIVE_DIRECTORY --record-sha SHA256 [--pass-env ENV_NAME]',
  '',
  'The original operator executes the reviewed native purchase.',
  'Collect reads the same saved operation and retains its permitted delivery.',
  'Provider configuration and service launch: node merchant-cli.mjs --help',
].join('\n');
function flags(args){
  const out={};
  for(let i=0;i<args.length;i++){
    const flag=args[i];need(/^--[a-z][a-z-]*$/.test(flag)&&!Object.hasOwn(out,flag.slice(2)),'ARGUMENTS_INVALID');
    if(flag==='--quiesced')out.quiesced=true;
    else{need(args[i+1]!==undefined&&!args[i+1].startsWith('--'),'ARGUMENT_VALUE_REQUIRED');out[flag.slice(2)]=args[++i];}
  }
  return out;
}
const required=(o,k)=>{need(typeof o[k]==='string'&&o[k].length>0,'ARGUMENT_'+k.replaceAll('-','_').toUpperCase()+'_REQUIRED');return o[k];};
const integer=(o,k,fallback)=>{const raw=o[k]??(fallback===undefined?'':String(fallback));need(/^(0|[1-9][0-9]*)$/.test(raw)&&Number.isSafeInteger(Number(raw)),'INTEGER_ARGUMENT_REQUIRED');return Number(raw);};
async function wait(close){
  await new Promise((resolve,reject)=>{
    const end=()=>{process.off('SIGINT',end);process.off('SIGTERM',end);Promise.resolve().then(close).then(resolve,reject);};
    process.once('SIGINT',end);process.once('SIGTERM',end);
  });
}
export async function main([mode,...args]=process.argv.slice(2)){
  if(!mode||mode==='--help'||mode==='help'){console.log(help);return;}
  const options=flags(args);
  if(mode==='init'){
    const result=await initializeValyu({stateRoot:resolve(required(options,'state-root')),
      ...(options['seller-client']?{sellerClient:resolve(options['seller-client'])}:{}),
      ...(options['operator-profile']?{operatorProfile:resolve(options['operator-profile'])}:{}),
      ...(options['operator-directory']?{originalOperatorDirectory:resolve(options['operator-directory'])}:{}),
      ...(options['provider-config']?{provider:await readJson(resolve(options['provider-config']))}:{}),
      ...(options['merchant-path']?{merchantPath:options['merchant-path']}:{})});
    console.log(JSON.stringify(result,null,2));return;
  }
  if(mode==='verify'||mode==='restore'){
    const {WorkspaceRecovery}=await native('sf88-operator-buyer-cli/node/index.mjs');
    const engine=new WorkspaceRecovery({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli')});
    const result=await engine[mode]({bundle:resolve(required(options,'bundle')),expectedRecordSha256:required(options,'record-sha'),
      passphraseEnv:options['pass-env']??'SF88_BACKUP_PASSPHRASE'});
    console.log(JSON.stringify(result,null,2));return;
  }
  const settings=await privateJson(resolve(required(options,'settings')));
  if(mode==='serve'){
    const desk=await startValyuDesk({settings,port:integer(options,'port',0)});
    console.log(JSON.stringify({url:desk.url,mode:'PRIVATE_VALYU_RESEARCH_WORKSPACE'}));
    await wait(desk.close);return;
  }
  const workspace=await ValyuWorkspace.open(settings),controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    let result;
    if(mode==='list')result=workspace.store.list({offset:integer(options,'offset',0)});
    else if(mode==='editions')result=workspace.store.listEditions({offset:integer(options,'offset',0)});
    else if(mode==='request')result=workspace.saveQuery(await readJson(resolve(required(options,'input')),65536));
    else if(mode==='query')result=workspace.store.detail(required(options,'id'));
    else if(mode==='duplicate')result=workspace.store.duplicateQuery(required(options,'id'),{...(options.title?{title:options.title}:{})});
    else if(mode==='prepare')result=await workspace.prepare(required(options,'id'),{expectedRevision:integer(options,'revision'),
      maxAtomic:required(options,'max-atomic'),acceptIndex:integer(options,'accept')});
    else if(['review','inspect','execute','collect'].includes(mode))result=await workspace[mode](required(options,'id'),{signal:controller.signal});
    else if(mode==='annotation')result=workspace.store.annotate(await readJson(resolve(required(options,'input')),65536));
    else if(mode==='freeze'){
      const edition=workspace.store.freeze(required(options,'capture'),{expectedSelectionSha256:required(options,'selection-sha'),...(options.title?{title:options.title}:{})});
      result={id:edition.id,sha256:edition.sha256};
    }else if(mode==='edition')result=workspace.store.editionView(required(options,'id'));
    else if(mode==='compare')result=workspace.store.compare(required(options,'left'),required(options,'right'),{editions:true});
    else if(mode==='import-edition'){
      const edition=workspace.store.importEdition(await readJson(resolve(required(options,'input')),40*1024*1024));
      result={id:edition.id,sha256:edition.sha256,imported:edition.imported};
    }else if(mode==='export'){
      const edition=workspace.store.edition(required(options,'edition')),output=exportResearchEdition(edition.manifest,required(options,'format'));
      result=await publish(resolve(required(options,'out')),output.bytes);
    }else if(mode==='import-observation')result=await workspace.importObservation(required(options,'id'),{
      responseFile:resolve(required(options,'response')),requestFile:resolve(required(options,'request')),provenanceFile:resolve(required(options,'provenance'))});
    else if(mode==='backup-review'||mode==='backup'){
      const recovery=await workspace.recovery();workspace.close();
      result=mode==='backup-review'?await recovery.engine.inspect({...recovery.selection,signal:controller.signal}):
        await recovery.engine.snapshot({...recovery.selection,output:resolve(required(options,'out')),quiesced:options.quiesced,
          passphraseEnv:options['pass-env']??'SF88_BACKUP_PASSPHRASE',signal:controller.signal});
    }else need(false,'MODE_INVALID');
    console.log(JSON.stringify(result,null,2));
  }finally{workspace.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(JSON.stringify({error:error.code??'VALYU_OPERATION_FAILED'}));process.exitCode=1;});
}
