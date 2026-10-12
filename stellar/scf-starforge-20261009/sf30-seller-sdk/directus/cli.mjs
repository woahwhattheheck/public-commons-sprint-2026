#!/usr/bin/env node
// MIT. Original retained repository, SF82 merchant and SF88 buyer commands.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDirectusWorkspace,receiveDirectusWorkspace} from './workspace.mjs';
import {prepareDirectusMerchant,readDirectusMerchant,initializeDirectusVersions,startDirectusMerchant,
  publishDirectusMerchant,stageDirectusRelease,activateDirectusRelease,rollbackDirectusRelease,runDirectusRelease} from './merchant.mjs';
import {reviewDirectusBuyer,prepareDirectusBuyer,receiveDirectusBuyer,inspectDirectusDelivery,runDirectusBuyer} from './customer.mjs';
import {performDirectusOperation} from './operations.mjs';
import {startDirectusOperator} from './server.mjs';
import {datasetControl} from '../dataset-refresh/service.mjs';
import {copyExact,object,fault} from '../dspace/merchant-files.mjs';

const HELP=`Retained Directus collections
  operator --directory PRIVATE_DIRECTORY [--workspace PRIVATE_DIRECTORY --host 127.0.0.1 --port PORT]
  native capture|draft-create|draft-save|draft-compare|draft-promote|item-read --workspace PRIVATE_DIRECTORY --input REQUEST.json
  native-history --workspace PRIVATE_DIRECTORY --id ORIGINAL_OPERATION_ID
  state --workspace PRIVATE_DIRECTORY
  read --workspace PRIVATE_DIRECTORY --kind sources|editions|reviews|comparisons --id ID [--offset N --limit N]
  import-source --workspace PRIVATE_DIRECTORY --file ORIGINAL_CAPTURE.json --input REQUEST.json
  save-edition|review-edition|select-edition|compare-editions|record-publication --workspace PRIVATE_DIRECTORY --input REQUEST.json
  operation --workspace PRIVATE_DIRECTORY --id ORIGINAL_OPERATION_ID
  query --workspace PRIVATE_DIRECTORY --edition ID --input ORIGINAL_STRING_QUERY.json
  export-dataset --workspace PRIVATE_DIRECTORY --edition ID --out PRIVATE_DIRECTORY
  export --workspace PRIVATE_DIRECTORY --kind project|source|editions|dataset|config|reviews --id ID --out FILE
  receive --file COMPLETE_PROJECT.sqlite3 --workspace PRIVATE_DIRECTORY
  merchant prepare --workspace PRIVATE_DIRECTORY --edition ID --edition-sha SHA --review ID --package PRIVATE_DIRECTORY
       --versions PRIVATE_DIRECTORY --payment PUBLIC_TERMS.json --origin HTTPS_ORIGIN [--path /directus-data]
  merchant inspect|initialize --package PRIVATE_DIRECTORY
  merchant serve --package PRIVATE_DIRECTORY --stage PRIVATE_DIRECTORY [--runtime RUNTIME.json]
  merchant publish --package PRIVATE_DIRECTORY --expect SNAPSHOT --expect-revision N
  merchant status|collect --versions PRIVATE_DIRECTORY
  merchant activate --versions PRIVATE_DIRECTORY --snapshot SHA --expect SHA --expect-revision N
  merchant stage --package PRIVATE_DIRECTORY --releases PRIVATE_DIRECTORY --id ID [--label TEXT --runtime FILE]
  merchant release-activate --releases PRIVATE_DIRECTORY --id ID --input ORIGINAL_OPTIONS.json
  merchant release-rollback|release-run --releases PRIVATE_DIRECTORY --input ORIGINAL_OPTIONS.json
  buyer offer --package PRIVATE_DIRECTORY --seller http://127.0.0.1:PORT [--query QUERY.json]
  buyer prepare --package PRIVATE_DIRECTORY --seller http://127.0.0.1:PORT [--query QUERY.json]
       --intent ID --accept-index N --offer-sha SHA --out PRIVATE_BUYER.json [--workspace PRIVATE_DIRECTORY]
  buyer receive --package PRIVATE_DIRECTORY --session ORIGINAL_SESSION --out PRIVATE_DIRECTORY [--include-source-captures --workspace PRIVATE_DIRECTORY]
  buyer inspect-delivery --directory PRIVATE_DIRECTORY
  buyer init|status|run|recover|export|deliver|accounting|finalize ORIGINAL_SF88_OPTIONS

Request JSON retains actor, operationId and expectedRevision. Review also supplies
editionId, editionSha256, decision and comment. Exact source bytes are read from --file.
The original seller and buyer retain payment terms, per-page approvals and journals.
Set DIRECTUS_BASE_URL and DIRECTUS_TOKEN in the process environment for native calls.
Tokens remain transport credentials. The same operation ID continues its retained native history.
Use operator for the industrial browser workspace.
`;
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function flags(args,allowed,booleans=[]){
  const out={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!allowed.includes(key)||Object.hasOwn(out,key))throw new TypeError('Unknown or repeated option: '+key);
    if(booleans.includes(key)){out[key]=true;continue;}
    if(!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('A value is required for '+key);
    out[key]=args[++i];
  }return out;
}
const required=(f,k)=>{if(!f[k])throw new TypeError(k+' is required.');return f[k];};
const location=(f,k)=>resolve(required(f,k));
function integer(value,fallback){if(value===undefined)return fallback;if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new TypeError('Use an exact nonnegative integer.');return Number(value);}
async function json(file,maximum=16*1024*1024){
  const raw=await readFile(file);if(raw.length>maximum)throw new TypeError('The input JSON exceeds its configured byte limit.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!object(value))throw new TypeError('The input JSON must be an object.');return value;
}
async function withWorkspace(f,run){
  const workspace=await openDirectusWorkspace({directory:location(f,'--workspace')});
  try{return await run(workspace);}finally{await workspace.close();}
}
function signals(service){
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;service.close().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);return service;
}
async function merchant(args){
  const [action,...tokens]=args;
  if(!action||action==='--help'){process.stdout.write(HELP);return;}
  const allowed={
    prepare:['--workspace','--edition','--edition-sha','--review','--package','--versions','--payment','--origin','--path'],
    inspect:['--package'],initialize:['--package'],serve:['--package','--stage','--runtime'],
    publish:['--package','--expect','--expect-revision'],
    status:['--versions'],collect:['--versions'],activate:['--versions','--snapshot','--expect','--expect-revision'],
    stage:['--package','--releases','--id','--label','--runtime'],
    'release-activate':['--releases','--id','--input'],'release-rollback':['--releases','--input'],'release-run':['--releases','--input']
  }[action];if(!allowed)throw new TypeError(HELP);
  const f=flags(tokens,allowed);
  if(action==='inspect'){const p=await readDirectusMerchant(location(f,'--package'));return print({
    directory:p.directory,source:p.source,dataset:p.dataset,resource:p.service.publicOrigin+p.service.routes[0].path});}
  if(action==='initialize')return print(await initializeDirectusVersions(location(f,'--package')));
  if(action==='serve'){
    const service=await startDirectusMerchant({directory:location(f,'--package'),stageDirectory:location(f,'--stage'),
      runtime:f['--runtime']?await json(f['--runtime'],65536):{port:0}});
    print({url:service.url,mode:service.mode,edition:service.edition,current:service.versions.status(),stage:service.stageDirectory});
    return signals(service);
  }
  if(action==='publish')return print(await publishDirectusMerchant({directory:location(f,'--package'),
    expectedSnapshot:required(f,'--expect'),expectedRevision:integer(required(f,'--expect-revision'))}));
  if(['status','collect'].includes(action))return print(await datasetControl(location(f,'--versions'),action));
  if(action==='activate')return print(await datasetControl(location(f,'--versions'),'activate',{
    snapshot:required(f,'--snapshot'),expectedSnapshot:required(f,'--expect'),expectedRevision:integer(required(f,'--expect-revision'))}));
  if(action==='stage')return print(await stageDirectusRelease({directory:location(f,'--package'),
    releaseDirectory:location(f,'--releases'),id:required(f,'--id'),label:f['--label']??f['--id'],
    runtime:f['--runtime']?await json(f['--runtime'],65536):{port:0}}));
  const options=await json(required(f,'--input'),65536),directory=location(f,'--releases');
  if(action==='release-activate')return print(await activateDirectusRelease(directory,required(f,'--id'),options));
  if(action==='release-rollback')return print(await rollbackDirectusRelease(directory,options));
  return runDirectusRelease(directory,options);
}
async function buyer(args){
  if(['init','status','run','recover','export','deliver','accounting','finalize'].includes(args[0]))return runDirectusBuyer(args);
  const [action,...tokens]=args;
  const allowed={
    offer:['--package','--seller','--query'],
    prepare:['--package','--seller','--query','--intent','--accept-index','--offer-sha','--out','--workspace'],
    receive:['--package','--session','--out','--include-source-captures','--workspace'],
    'inspect-delivery':['--directory']
  }[action];if(!allowed)throw new TypeError(HELP);
  const f=flags(tokens,allowed,['--include-source-captures']);
  if(action==='inspect-delivery')return print(await inspectDirectusDelivery(location(f,'--directory')));
  const withProject=run=>f['--workspace']?withWorkspace(f,run):run(undefined);
  if(action==='receive')return print(await withProject(workspace=>receiveDirectusBuyer({workspace,directory:location(f,'--package'),
    sessionDirectory:location(f,'--session'),destination:location(f,'--out'),includeSourceCaptures:!!f['--include-source-captures']})));
  const input={directory:location(f,'--package'),seller:required(f,'--seller'),query:f['--query']?await json(f['--query'],16384):{}};
  if(action==='offer')return print(await reviewDirectusBuyer(input));
  return print(await withProject(workspace=>prepareDirectusBuyer({...input,workspace,intentId:required(f,'--intent'),acceptIndex:integer(required(f,'--accept-index')),
    offerSha256:required(f,'--offer-sha'),destination:location(f,'--out')})));
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||['--help','help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
  if(args[0]==='operator'){
    const f=flags(args.slice(1),['--directory','--workspace','--host','--port']);
    const service=await startDirectusOperator({directory:location(f,'--directory'),
      ...(f['--workspace']?{workspaceDirectory:location(f,'--workspace')}:{ }),host:f['--host']??'127.0.0.1',port:integer(f['--port'],0)});
    print(service.launch);return signals(service);
  }
  if(args[0]==='native'){
    const f=flags(args.slice(2),['--workspace','--input']),input=await json(required(f,'--input'));
    return print(await withWorkspace(f,workspace=>performDirectusOperation({workspace,action:args[1],input,
      connection:{baseUrl:process.env.DIRECTUS_BASE_URL,token:process.env.DIRECTUS_TOKEN}})));
  }
  if(args[0]==='merchant'){
    if(args[1]==='prepare'){
      const f=flags(args.slice(2),['--workspace','--edition','--edition-sha','--review','--package','--versions','--payment','--origin','--path']);
      const payment=await json(required(f,'--payment'),16384);
      return print(await withWorkspace(f,workspace=>prepareDirectusMerchant({workspace,
        editionId:required(f,'--edition'),editionSha256:required(f,'--edition-sha'),reviewId:required(f,'--review'),
        directory:location(f,'--package'),versionDirectory:location(f,'--versions'),payment,
        origin:required(f,'--origin'),path:f['--path']??'/directus-data'})));
    }
    return merchant(args.slice(1));
  }
  if(args[0]==='buyer')return buyer(args.slice(1));
  const [action,...tokens]=args,mutations=['save-edition','review-edition','select-edition','compare-editions','record-publication'];
  const allowed=mutations.includes(action)?['--workspace','--input']:{
    'native-history':['--workspace','--id'],state:['--workspace'],read:['--workspace','--kind','--id','--offset','--limit'],
    operation:['--workspace','--id'],'import-source':['--workspace','--file','--input'],
    query:['--workspace','--edition','--input'],'export-dataset':['--workspace','--edition','--out'],
    export:['--workspace','--kind','--id','--out'],receive:['--workspace','--file']
  }[action];if(!allowed)throw new TypeError(HELP);const f=flags(tokens,allowed);
  if(action==='receive'){
    const ws=await receiveDirectusWorkspace({file:location(f,'--file'),directory:location(f,'--workspace')});
    try{return print(ws.state());}finally{await ws.close();}
  }
  return withWorkspace(f,async workspace=>{
    if(action==='state')return print(workspace.state());
    if(action==='native-history')return print(workspace.nativeHistory(required(f,'--id')));
    if(action==='read')return print(workspace.read(required(f,'--kind'),required(f,'--id'),{
      offset:integer(f['--offset'],0),limit:integer(f['--limit'],50)}));
    if(action==='operation')return print(workspace.operation(required(f,'--id')));
    if(action==='query')return print(await workspace.query(required(f,'--edition'),await json(required(f,'--input'))));
    if(action==='export-dataset')return print(await workspace.exportDataset(required(f,'--edition'),location(f,'--out')));
    if(action==='export'){
      const file=await workspace.exportFile(required(f,'--kind'),f['--id']);
      return print(await copyExact(file.path,location(f,'--out'),file));
    }
    const input=await json(required(f,'--input'));
    if(action==='import-source'){
      const raw=await readFile(location(f,'--file'));
      if(raw.length>256*1024*1024)throw fault('DIRECTUS_SOURCE_SIZE','Use the original source capture limit.');
      input.sourceBase64=raw.toString('base64');
    }
    return print(await workspace.dispatch(action,input));
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'DIRECTUS_COMMAND',message:error.message})+'\n');process.exitCode=1;});
