#!/usr/bin/env node
// MIT. Whole Firecrawl provider/customer lifecycle using original native commands.
import {readFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {native,runtimeRoot} from './runtime.mjs';
import {compileProduct,createProduct} from './merchant.mjs';
import {ResearchWorkspace,privateJson,publish,initializeResearch} from './research.mjs';
import {startResearchDesk} from './server.mjs';
import {exportEdition} from './exports.mjs';
import {PRODUCT_SCHEMA,need,encoded} from './contract.mjs';
const help=[
  'Firecrawl provider and customer research workspace',
  '',
  'Provider configuration:',
  '  compile --product PRODUCT.json --out NEW_PRIVATE_DIRECTORY',
  '  preview --product PRODUCT.json [--port 8423]',
  '',
  'Customer setup:',
  '  init --state-root NEW_PRIVATE_DIRECTORY [--operator-profile PROFILE.json]',
  '       [--seller-client ORIGINAL_CLIENT.mjs] [--operator-directory ORIGINAL_SF88_WORKSPACE]',
  '  serve --settings SETTINGS.json [--port 8430]',
  '',
  'Exact retained requests:',
  '  request --settings SETTINGS.json --input REQUEST_DRAFT.json',
  '  prepare --settings SETTINGS.json --id QUERY_ID --revision REVISION --max-atomic CAP --accept INDEX',
  '  review|inspect|execute|collect --settings SETTINGS.json --id QUERY_ID',
  '  import-observation --settings SETTINGS.json --id QUERY_ID',
  '       --response RESPONSE.json --request ORIGINAL_SOURCE_REQUEST.json --provenance CAPTURE.json',
  '',
  'Research and delivery:',
  '  annotation|collection --settings SETTINGS.json --input SELECTION.json',
  '  freeze --settings SETTINGS.json --id COLLECTION_ID --revision REVISION --selection-sha SHA256',
  '  export --settings SETTINGS.json --edition EDITION_ID --format html|csv|json --out NEW_FILE',
  '  compare --settings SETTINGS.json --left CAPTURE_ID --right CAPTURE_ID',
  '',
  'Original whole-workspace recovery:',
  '  backup-review --settings SETTINGS.json',
  '  backup --settings SETTINGS.json --out NEW_ARCHIVE_DIRECTORY --quiesced [--pass-env NAME]',
  '  verify|restore --bundle ARCHIVE_DIRECTORY --record-sha SHA256 [--pass-env NAME]',
  '',
  'Execution enters the original buyer terminal approval with the saved request.',
  'Collect and inspect reuse the original operation; they do not purchase again.',
  'Provider JSON is separate from the original customer ledger and native result.',
].join('\n');
function flags(args){
  const out={};
  for(let i=0;i<args.length;i++){
    const key=args[i];need(/^--[a-z][a-z-]*$/.test(key)&&!Object.hasOwn(out,key.slice(2)),'ARGUMENTS_INVALID');
    if(key==='--quiesced')out.quiesced=true;
    else{need(args[i+1]!==undefined&&!args[i+1].startsWith('--'),'ARGUMENT_VALUE_REQUIRED');out[key.slice(2)]=args[++i];}
  }
  return out;
}
function required(options,key){need(typeof options[key]==='string'&&options[key].length>0,'ARGUMENT_'+key.replaceAll('-','_').toUpperCase()+'_REQUIRED');return options[key];}
function number(options,key,fallback){const value=options[key]??String(fallback);need(/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)),'INTEGER_ARGUMENT_REQUIRED');return Number(value);}
async function readJson(path){const raw=await readFile(resolve(path));need(raw.length<=1048576,'INPUT_FILE_TOO_LARGE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
async function waitForSignal(close){
  await new Promise((resolve,reject)=>{
    const end=()=>{process.off('SIGINT',end);process.off('SIGTERM',end);Promise.resolve().then(close).then(resolve,reject);};
    process.once('SIGINT',end);process.once('SIGTERM',end);
  });
}
export async function main([mode,...args]=process.argv.slice(2)){
  if(!mode||mode==='--help'){console.log(help);return;}
  const options=flags(args);
  if(mode==='compile'){
    const source=await readJson(required(options,'product')),compiled=compileProduct(source),out=resolve(required(options,'out'));
    await mkdir(out,{mode:0o700});
    const records=[];
    for(const[name,value]of Object.entries({'product.json':compiled.product,'seller-service.json':compiled.service,'upstreams.json':compiled.upstreams}))
      records.push(await publish(join(out,name),encoded(value)));
    console.log(JSON.stringify({schema:PRODUCT_SCHEMA,directory:out,files:records,authMode:source.auth.mode,
      launch:'Use the original SF30 operations/launch.mjs with seller-service.json and this product application.mjs'}));return;
  }
  if(mode==='preview'){
    const product=createProduct(await readJson(required(options,'product')));
    const {startSellerService}=await native('sf30-seller-sdk/serve.mjs');
    let service;
    try{
      service=await startSellerService({config:product.config,handlers:product.handlers,port:number(options,'port',0)});
      console.log(JSON.stringify({mode:'CHALLENGE_ONLY',url:service.url,docs:service.url+'/_seller/docs',source:product.snapshot()}));
      await waitForSignal(async()=>{await service.close();await product.close();});
    }catch(error){await service?.close();await product.close();throw error;}return;
  }
  if(mode==='init'){
    const result=await initializeResearch({stateRoot:resolve(required(options,'state-root')),
      ...(options['operator-profile']?{operatorProfile:resolve(options['operator-profile'])}:{}),
      ...(options['seller-client']?{sellerClient:resolve(options['seller-client'])}:{}),
      ...(options['operator-directory']?{originalOperatorDirectory:resolve(options['operator-directory'])}:{})});
    console.log(JSON.stringify(result));return;
  }
  if(mode==='verify'||mode==='restore'){
    const {WorkspaceRecovery}=await native('sf88-operator-buyer-cli/node/index.mjs');
    const engine=new WorkspaceRecovery({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli')});
    const result=await engine[mode]({bundle:resolve(required(options,'bundle')),expectedRecordSha256:required(options,'record-sha'),
      passphraseEnv:options['pass-env']??'SF88_BACKUP_PASSPHRASE'});
    console.log(JSON.stringify(result,null,2));return;
  }
  const settings=(await privateJson(resolve(required(options,'settings')),65536)).value;
  if(mode==='serve'){
    const server=await startResearchDesk({settings,port:number(options,'port',0)});
    console.log(JSON.stringify({url:server.url,mode:'PRIVATE_RESEARCH_WORKSPACE'}));
    await waitForSignal(server.close);return;
  }
  const workspace=await ResearchWorkspace.open(settings),controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    let result;
    if(mode==='request')result=workspace.saveQuery(await readJson(required(options,'input')));
    else if(mode==='prepare')result=await workspace.prepare(required(options,'id'),{expectedRevision:number(options,'revision',undefined),
      maxAtomic:required(options,'max-atomic'),acceptIndex:number(options,'accept',undefined)});
    else if(['review','inspect','execute','collect'].includes(mode))result=await workspace[mode](required(options,'id'),{signal:controller.signal});
    else if(mode==='import-observation')result=await workspace.importObservation(required(options,'id'),{
      responseFile:resolve(required(options,'response')),requestFile:resolve(required(options,'request')),provenanceFile:resolve(required(options,'provenance'))});
    else if(mode==='annotation')result=workspace.store.annotate(await readJson(required(options,'input')));
    else if(mode==='collection')result=workspace.store.saveCollection(await readJson(required(options,'input')));
    else if(mode==='freeze')result=workspace.store.freezeCollection(required(options,'id'),number(options,'revision',undefined),required(options,'selection-sha'));
    else if(mode==='export'){const edition=workspace.store.edition(required(options,'edition')),output=exportEdition(edition,required(options,'format'));
      result=await publish(resolve(required(options,'out')),output.bytes);}
    else if(mode==='compare')result=workspace.compare(required(options,'left'),required(options,'right'));
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
  main().catch(error=>{console.error(JSON.stringify({error:error.code??'FIRECRAWL_OPERATION_FAILED',...(error.result?{originalResult:error.result}:{}),...(error.publication?{publication:error.publication}:{})}));process.exitCode=1;});
}
