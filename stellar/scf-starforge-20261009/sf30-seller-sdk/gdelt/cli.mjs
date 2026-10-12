#!/usr/bin/env node
// MIT. Installed GDELT command; original source, merchant and buyer own every action.
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { withPrivateLock } from '../routescan/quota.mjs';
import { need, jsonBytes, hash, LIMITS } from './model.mjs';
import { durableDirectory, exactFile } from './source.mjs';
import { initializeGdeltProject, gdeltProjectView, exportGdeltProject, receiveGdeltProject } from './project.mjs';
import { openGdeltApplication } from './application.mjs';
import { startGdeltWorkspace } from './workspace.mjs';
import { inspectGdeltWorkspaceBinding } from './launch.mjs';
import { receiveGdeltSourceDelivery, reopenGdeltSources } from './customer.mjs';

export const USAGE=String.raw`GDELT event desk — original Events, Mentions, merchant and customer

starforge gdelt init --project ABS --title TEXT
starforge gdelt show --project ABS
starforge gdelt serve --project ABS [--port N] [--merchant-port N]
  [--buyer-config PRIVATE_JSON] [--facilitator URL] [--allow-local-facilitator]
  [--expected-binding-sha256 SHA] [--connection-file PRIVATE_JSON]
starforge gdelt binding --project ABS [--buyer-config PRIVATE_JSON]
  [--facilitator URL] [--merchant-port N] [--allow-local-facilitator]
starforge gdelt discover --project ABS [--format events-mentions|gkg] [--history] [--out MANIFEST_JSON]
starforge gdelt capture --project ABS --id ID --revision N [--format events-mentions|gkg]
  [--batch UTC14] [--manifest MANIFEST_JSON | --discovery SHA]
starforge gdelt discovery --project ABS --id SHA [--format events-mentions|gkg]
starforge gdelt import --project ABS --id ID --revision N --source CAPTURE_JSON
starforge gdelt select --project ABS --id ID --revision N --capture SHA
starforge gdelt fields --project ABS [--table TABLE]
starforge gdelt rows --project ABS --captures SHA,SHA [--policy JSON] [--offset N] [--limit N]
starforge gdelt review --project ABS --id ID --revision N --captures SHA,SHA
  --name TEXT [--policy JSON] [--note TEXTFILE]
starforge gdelt compare --project ABS --before SHA --after SHA [--out JSON]
starforge gdelt publish --project ABS --id ID --revision N --review SHA
  --origin HTTPS --payment JSON [--path /gdelt]
starforge gdelt publication --project ABS --publication SHA
starforge gdelt merchant --project ABS --publication SHA [--merchant-port N]
  [--facilitator URL] [--allow-local-facilitator]
starforge gdelt preview --project ABS --publication SHA [--kind rows|sources] [--query QUERY]
starforge gdelt prepare --project ABS --publication SHA --intent ID
  [--kind rows|sources] [--query QUERY] [--file MEMBER] [--previous JSON] [--accept N]
starforge gdelt buy|recover --project ABS --publication SHA --intent ID --buyer-config JSON
starforge gdelt customer-file --project ABS --publication SHA --intent ID --buyer-config JSON --out FILE
starforge gdelt dataset-prepare --project ABS --publication SHA --id ID
  --kind rows|sources --max-pages N --max-total-atomic TEXT [--max-rows N] [--query QUERY]
starforge gdelt dataset-create|dataset-run|dataset-recover|dataset-inspect|dataset-deliver
  --project ABS --publication SHA --id ID --buyer-config JSON
starforge gdelt dataset-accounting|dataset-finalize|dataset-receive
  --project ABS --publication SHA --id ID --buyer-config JSON
starforge gdelt customer-reopen --project ABS --publication SHA --id ID
starforge gdelt dataset-file --project ABS --publication SHA --id ID --file dataset.csv --out FILE
starforge gdelt source --project ABS --capture SHA --out CAPTURE_JSON
starforge gdelt export --project ABS --out PROJECT_JSON
starforge gdelt receive --project EMPTY_ABS --source PROJECT_JSON
starforge gdelt source-receive --project SOURCES_ABS --source ORIGINAL_DELIVERY_JSON
  [--capture-manifest SHA] [--source-set SHA]
starforge gdelt sources-open --project NEW_PROJECT_ABS --source SOURCES_ABS [--title TEXT]
starforge gdelt abandon --project ABS --id ID --revision N --pending ID [--note TEXTFILE]

All source mutations keep the original id and revision for recovery.
Dataset run acquires remaining original pages within the explicitly saved budget.
Dataset recover, deliver and source receiving reopen retained customer data.
The ZIP decoder and source receiver use Python3.11+; --python selects its existing executable.
Exports keep complete originals and reject a different existing destination.
`;
const common=['project','python','out'];
const selected=['publication'];
const operator=['buyer-config','facilitator','allow-local-facilitator','merchant-port','expected-binding-sha256'];
const recording=['id','revision'];
const allowed={
  init:['title'],show:[],binding:operator,serve:[...operator,'port','connection-file'],
  discover:['history','format'],discovery:['id','format'],capture:[...recording,'batch','manifest','discovery','format'],import:[...recording,'source'],
  select:[...recording,'capture'],fields:['table'],rows:['captures','policy','offset','limit'],
  review:[...recording,'captures','policy','note','name'],compare:['before','after'],
  publish:[...recording,'review','origin','payment','path'],publication:selected,
  merchant:[...selected,...operator],preview:[...selected,'kind','query'],
  prepare:[...selected,'intent','kind','query','file','previous','accept'],
  buy:[...selected,'intent','buyer-config'],recover:[...selected,'intent','buyer-config'],
  'customer-file':[...selected,'intent','buyer-config'],'dataset-file':[...selected,'id','file'],
  'dataset-prepare':[...selected,'id','kind','query','max-pages','max-total-atomic','max-rows','accept'],
  ...Object.fromEntries(['dataset-create','dataset-run','dataset-recover','dataset-inspect','dataset-deliver',
    'dataset-accounting','dataset-finalize','dataset-receive'].map(name=>[name,[...selected,'id','buyer-config']])),
  'customer-reopen':[...selected,'id'],source:['capture'],export:[],receive:['source'],
  'source-receive':['source','capture-manifest','source-set'],'sources-open':['source','title'],
  abandon:[...recording,'pending','note']
};
function flags(command,args){
  need(Object.hasOwn(allowed,command),'Unknown command; use gdelt --help.');const result={};
  for(let i=0;i<args.length;i++){
    const key=args[i].replace(/^--/,'');need(args[i].startsWith('--')&&[...common,...allowed[command]].includes(key)&&
      !Object.hasOwn(result,key),'Unknown or duplicate option: '+args[i]);
    if(['history','allow-local-facilitator'].includes(key))result[key]=true;
    else{need(args[i+1]&&!args[i+1].startsWith('--'),'Option requires a value: '+args[i]);result[key]=args[++i];}
  }
  need(result.project,'--project selects the original private directory.');return result;
}
const integer=(value,label,fallback)=>{
  if(value===undefined&&fallback!==undefined)return fallback;
  need(typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)),label+' requires an exact integer.');
  return Number(value);
};
async function readJson(path,max=LIMITS.projectBytes){
  need(typeof path==='string'&&path,'Select the original JSON file.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(path),max)));
}
async function readNote(path){
  return path?new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(path),32000)):'';
}
async function artifact(value,path){
  if(!path)return value;
  path=resolve(path);const bytes=Buffer.isBuffer(value)?value:jsonBytes(value),directory=await durableDirectory(dirname(path));
  await withPrivateLock(directory,basename(path)+'.lock',()=>exactFile(directory,basename(path),bytes));
  return{path,bytes:bytes.length,sha256:hash(bytes)};
}
async function foreground(value,close,signal){
  let stop;
  try{
    await new Promise((done,reject)=>{
      let stopping=false;
      stop=()=>{
        if(stopping)return;stopping=true;
        Promise.resolve().then(close).then(done,reject);
      };
      process.on('SIGTERM',stop);process.on('SIGINT',stop);
      signal?.addEventListener('abort',stop,{once:true});
      try{console.log(JSON.stringify(value));}catch(error){
        stopping=true;Promise.resolve().then(close).then(()=>reject(error),reject);return;
      }
      if(signal?.aborted)stop();
    });
    return {state:'CLOSED'};
  }finally{
    if(stop){process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);signal?.removeEventListener('abort',stop);}
    await close();
  }
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||['--help','-h','help'].includes(args[0])){console.log(USAGE);return;}
  const [command,...rest]=args,f=flags(command,rest),directory=resolve(f.project);
  const abort=new AbortController(),stop=()=>abort.abort();
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  let application,result;
  const options={directory,buyerConfig:f['buyer-config'],facilitator:f.facilitator,
    allowLocalFacilitator:f['allow-local-facilitator']===true,merchantPort:integer(f['merchant-port'],'Merchant port',0),
    expectedBindingSha256:f['expected-binding-sha256'],python:f.python};
  const recorded=()=>({id:f.id,expectedRevision:integer(f.revision,'Project revision')});
  const captures=()=>{need(f.captures,'--captures selects original source IDs.');return f.captures.split(',').map(v=>v.trim());};
  try{
    if(command==='init')result=await initializeGdeltProject({directory,title:f.title});
    else if(command==='show')result=await gdeltProjectView(directory);
    else if(command==='binding')result=await inspectGdeltWorkspaceBinding(options);
    else if(command==='receive')result=await receiveGdeltProject({directory,bundle:await readJson(f.source),python:f.python,signal:abort.signal});
    else if(command==='source-receive')result=await receiveGdeltSourceDelivery({directory,report:await readJson(f.source,4*1024*1024),
      expectedCaptureId:f['capture-manifest'],expectedSourceSetId:f['source-set'],python:f.python,signal:abort.signal});
    else if(command==='sources-open')result=await reopenGdeltSources({sourceDirectory:resolve(f.source),projectDirectory:directory,
      title:f.title,python:f.python,signal:abort.signal});
    else if(command==='export'){need(f.out,'--out selects the full project file.');result=await exportGdeltProject({directory});}
    else if(command==='serve'){
      const session=await startGdeltWorkspace({...options,port:integer(f.port,'Browser port',0),connectionFile:f['connection-file']});
      result=await foreground(session.startup,()=>session.close(),abort.signal);
    }else{
      application=await openGdeltApplication({...options,onProgress:v=>console.error(JSON.stringify(v))});
      const onAbort=()=>{void application.close().catch(()=>{});};abort.signal.addEventListener('abort',onAbort,{once:true});
      if(abort.signal.aborted){await application.close();abort.signal.throwIfAborted();}
      switch(command){
        case'discover':result=await application.action({action:'discover',history:f.history===true,format:f.format});break;
        case'discovery':result=await application.query('discovery',{id:f.id,format:f.format});break;
        case'capture':{let manifest=f.manifest?await readJson(f.manifest,2*1024*1024):undefined;if(manifest?.manifest)manifest=manifest.manifest;
          result=await application.action({action:'capture',...recorded(),batch:f.batch,manifest,discoveryId:f.discovery,format:f.format});break;}
        case'import':result=await application.action({action:'import',...recorded(),capture:await readJson(f.source)});break;
        case'select':result=await application.action({action:'select',...recorded(),captureId:f.capture});break;
        case'fields':result=await application.query('fields',{table:f.table});break;
        case'rows':result=await application.query('rows',{captureIds:captures(),policy:f.policy?await readJson(f.policy,65536):{},
          offset:integer(f.offset,'Offset',0),limit:integer(f.limit,'Limit',100)});break;
        case'review':result=await application.action({action:'review',...recorded(),captureIds:captures(),
          policy:f.policy?await readJson(f.policy,65536):{},note:await readNote(f.note),name:f.name});break;
        case'compare':result=await application.query('compare',{before:f.before,after:f.after});break;
        case'publish':result=await application.action({action:'publish',...recorded(),reviewId:f.review,origin:f.origin,
          path:f.path??'/gdelt',payment:await readJson(f.payment,16384)});break;
        case'publication':result=await application.query('publication',{publicationId:f.publication});break;
        case'preview':result=await application.query('preview',{publicationId:f.publication,kind:f.kind??'rows',query:f.query??''});break;
        case'merchant':{
          const started=await application.action({action:'merchant-start',publicationId:f.publication});
          result=await foreground(started,()=>application.close(),abort.signal);break;
        }
        case'prepare':result=await application.action({action:'prepare',publicationId:f.publication,intentId:f.intent,
          kind:f.kind??'rows',query:f.query??'',file:f.file??null,previous:f.previous?await readJson(f.previous,131072):null,
          acceptIndex:integer(f.accept,'Payment alternative',0)});break;
        case'buy':case'recover':result=await application.action({action:command,publicationId:f.publication,intentId:f.intent});break;
        case'dataset-prepare':result=await application.action({action:command,publicationId:f.publication,id:f.id,kind:f.kind,
          query:f.query??'',maxPages:integer(f['max-pages'],'Maximum pages'),maxTotalAtomic:f['max-total-atomic'],
          maxRows:integer(f['max-rows'],'Maximum rows',LIMITS.rows),acceptIndex:integer(f.accept,'Payment alternative',0)});break;
        case'dataset-create':case'dataset-run':case'dataset-recover':case'dataset-inspect':case'dataset-deliver':
        case'dataset-accounting':case'dataset-finalize':case'dataset-receive':case'customer-reopen':
          result=await application.action({action:command,publicationId:f.publication,id:f.id});break;
        case'dataset-file':{
          need(f.out,'--out selects the complete delivered file.');
          const file=await application.download('dataset',{publicationId:f.publication,id:f.id,file:f.file});result=file.bytes;break;
        }
        case'source':case'customer-file':{
          need(f.out,'--out selects the complete customer file.');
          const file=await application.download(command==='source'?'source':'customer',command==='source'
            ?{captureId:f.capture}:{publicationId:f.publication,intentId:f.intent});
          result=file.bytes;break;
        }
        case'abandon':result=await application.action({action:'abandon',...recorded(),pendingId:f.pending,note:await readNote(f.note)});break;
      }
    }
    result=await artifact(result,f.out);console.log(JSON.stringify(result,null,2));return result;
  }finally{
    await application?.close();
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(JSON.stringify({code:error.code??'GDELT_COMMAND_FAILED',message:error.message,
    ...(error.retryAt?{retryAt:error.retryAt}:{})}));process.exitCode=error.name==='AbortError'?130:2;});
