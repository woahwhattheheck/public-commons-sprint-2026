// MIT. Receive the two actual Hamburg query editions through the existing native workspace.
// This driver never fetches a provider: every request must consume one exact retained response.
import {isAbsolute,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../stellar-expert/store.mjs';
import {openSensorThingsWorkspace} from './core.mjs';
import {recordedTransport} from './provider.mjs';
import {createFileAccess} from './files.mjs';
import {json,sha,identity,plain} from './contract.mjs';

export const HAMBURG_OPERATION='SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012';
const SOURCE={
 label:'Hamburg public charging-point status — original selected stream',
 serviceUrl:'https://iot.hamburg.de/v1.1/',
 license:{
  name:'Datenlizenz Deutschland — Namensnennung — Version 2.0',
  url:'https://www.govdata.de/dl-de/by-2-0',
  attribution:'Freie und Hansestadt Hamburg, Behörde für Wirtschaft und Innovation',
  sourceUrl:'https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36',
  note:'Original published dataset edition. Provider observations are captured separately at their actual request times; current licence or service revisions must be retained as new source evidence.'
 },
 maxPageBytes:4*1024*1024,requestTimeoutMs:45000
};
const WINDOW_QUERY={filter:'phenomenonTime ge 2026-09-14T00:00:00Z and phenomenonTime lt 2026-10-12T10:31:58Z',
 orderBy:'phenomenonTime asc',top:100,count:true,expandFeatureOfInterest:true};
const OP=HAMBURG_OPERATION;
const fail=(code,message,details=null)=>Object.assign(new Error(message),{code,details});
async function recording(path,expectedSha256,expectedBytes){
 if(!isAbsolute(path??'')||!/^[a-f0-9]{64}$/.test(expectedSha256??'')||
    !Number.isSafeInteger(expectedBytes)||expectedBytes<1)throw fail('HAMBURG_RECORDING','Select the exact absolute recording path, complete byte count and SHA-256.');
 const bytes=await readOwned(path,128*1024*1024);
 if(bytes.length!==expectedBytes||sha(bytes)!==expectedSha256)throw fail('HAMBURG_RECORDING_CHANGED','The complete original recorded-source bundle changed.');
 const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(original.schema!=='stellar-forge.sensorthings-connector-responses.v1'||original.source?.operationId!==OP||
    original.responses?.length!==28)throw fail('HAMBURG_RECORDING_SCOPE','Use the complete frozen 28-response native bundle. The separate discovery response is not a fixed-window page.');
 const transport=await recordedTransport(path);
 if(transport.sha256!==expectedSha256)throw fail('HAMBURG_RECORDING_CHANGED','The source bundle changed while opening its original transport.');
 return transport;
}
function reviewDocument(value,windows){
 if(!plain(value)||value.schema!=='stellar-forge.sensorthings-hamburg-review.v1'||value.operationId!==OP||
    typeof value.actor!=='string'||!value.actor.trim()||value.actor.length>240||
    !Array.isArray(value.editions)||value.editions.length!==2)throw fail('HAMBURG_REVIEW','Retain the responsible operator and both actual source-edition decisions.');
 for(const window of windows){
  const selected=value.editions.filter(x=>x.window===window.window);
  if(selected.length!==1||selected[0].editionId!==window.editionId||
     selected[0].decision!=='accept'||typeof selected[0].note!=='string'||!selected[0].note.trim()||
     !Array.isArray(selected[0].acknowledgeIssues)||selected[0].acknowledgeIssues.some(x=>typeof x!=='string')||
     new Set(selected[0].acknowledgeIssues).size!==selected[0].acknowledgeIssues.length)
   throw fail('HAMBURG_REVIEW_BINDING','Each review must name its actual completed native edition and retain its source interpretation.',{window:window.window});
 }
 return value;
}
function compact(c){
 return {captureId:c.id,state:c.state,editionId:c.editionIds.at(-1)??null,
  requests:c.tasks.reduce((n,t)=>n+t.attempts.length,0),pages:c.pages.length,bytes:c.totalBytes,issues:c.issues,
  remaining:c.tasks.filter(t=>t.state!=='COMPLETE').map(t=>({id:t.id,url:t.url,state:t.state,error:t.error}))};
}
export async function receiveHamburg({directory,recordingFile,expectedSha256,expectedBytes,
 resume=false,reviewFile=null,buyerWorkspaceDirectory=null,sourceInboxDirectory=null,onProgress=()=>{}}={}){
 if(!isAbsolute(directory??'')||(reviewFile!==null&&!isAbsolute(reviewFile))||
    (buyerWorkspaceDirectory!==null&&!isAbsolute(buyerWorkspaceDirectory))||
    (sourceInboxDirectory!==null&&!isAbsolute(sourceInboxDirectory)))
   throw fail('HAMBURG_PATH','Use explicit absolute native workspace, review and host-bound receiving paths.');
 const transport=await recording(recordingFile,expectedSha256,expectedBytes);
 const workspace=await openSensorThingsWorkspace({directory,transport,
  buyerWorkspaceDirectory,sourceInboxDirectory,onProgress,
  fetchImpl:async()=>{throw fail('HAMBURG_NO_NETWORK','This original receiving operation does not issue another provider request.');}});
 const call=async(suffix,action,payload)=>{
  const result=await workspace.action({operationId:OP+'_'+suffix,expectedRevision:(await workspace.view()).revision,action,payload});
  if(!Object.hasOwn(result,'result'))throw fail('HAMBURG_OPERATION_PENDING','The original native action is still running; inspect that same operation before continuing.',{operationId:result.operationId});
  return result.result;
 };
 let files;
 try{
  const source=await call('SOURCE','source.add',SOURCE);
  const catalogue=await call('CATALOG','catalog.capture',{sourceId:source.id,kind:'Datastreams',
   query:{filter:"properties/serviceName eq 'HH_STA_E-Ladestationen' and properties/layerName eq 'Status_E-Ladepunkt'",
    orderBy:'id asc',top:3,count:true}});
  const rows=await workspace.catalogRows(catalogue.id,{offset:0,limit:3});
  if(rows.rows[0]?.pointer!=='/value/0')throw fail('HAMBURG_CATALOGUE','The actual source does not contain the selected catalogue occurrence.');
  const plan=await call('PLAN_WINDOW','plan.create',{sourceId:source.id,
   label:'Hamburg point 18571 — complete fixed window 2026-09-14 to 2026-10-12T10:31:58Z',
   streams:[{catalogId:catalogue.id,pointer:'/value/0'}],observationQuery:WINDOW_QUERY,
   includeHistoricalLocations:false,maxRequests:128,maxBytes:32*1024*1024});
  if(plan.streams.length!==1||plan.streams[0].id.type!=='number'||plan.streams[0].id.value!=='18571')
   throw fail('HAMBURG_SELECTION','The retained catalogue pointer does not identify the original numeric Datastream 18571.');
  const windows=[];
  for(const n of [1,2]){
   const window='window-'+n,started=await call('WINDOW'+n+'_CAPTURE','capture.start',{planId:plan.id,budget:128});
   let captured=await workspace.waitCapture(started.captureId);
   if(captured.state!=='COMPLETE'&&resume){
    if(captured.tasks.some(x=>x.state==='FAILED'))throw fail('HAMBURG_SOURCE_FAILURE','Inspect the saved original failed request. This driver does not replace failed source attempts or consume a later same-URL response.',compact(captured));
    const suffix='WINDOW'+n+'_RESUME_'+identity({captureId:captured.id,tasks:captured.tasks.map(t=>({id:t.id,state:t.state,attempts:t.attempts.length}))}).slice(0,20);
    await call(suffix,'capture.resume',{captureId:captured.id,budget:128,retryFailed:false});
    captured=await workspace.waitCapture(captured.id);
   }
   const item={window,...compact(captured)};
   if(item.state!=='COMPLETE'||!item.editionId){
    const pending={schema:'stellar-forge.sensorthings-hamburg-receiving.v1',operationId:OP,
     state:'INCOMPLETE_ORIGINAL_CAPTURE',workspaceId:(await workspace.view()).workspaceId,
     recording:{sha256:expectedSha256,bytes:expectedBytes},sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,
     windows:[...windows,item],recordingSelection:transport.inspect(),resume:'Reopen this same workspace and recording with resume=true. Failed requests require source inspection.'};
    await retain(workspace,pending);return pending;
   }
   item.summary=await workspace.summary(item.editionId);
   if(item.summary.rows!==660||item.summary.uniqueObservationIds!==660||item.summary.duplicateOccurrences||
      item.summary.changedDuplicates||item.summary.unkeyed||Object.keys(item.summary.resultTypes).some(x=>x!=='string'))
    throw fail('HAMBURG_NATIVE_SOURCE_DISAGREEMENT','The native original rows differ from the frozen complete source calculation; retain them for inspection without publishing.',item);
   windows.push(item);onProgress({event:'source-edition-complete',window,editionId:item.editionId});
  }
  const selection=transport.inspect();
  if(selection.remaining.length)throw fail('HAMBURG_SOURCE_CLOSURE','The original native traversals did not consume the complete selected recording.',selection);
  const comparison=await call('COMPARE_WINDOWS','edition.compare',{leftId:windows[0].editionId,rightId:windows[1].editionId});
  if(comparison.counts?.same!==660||comparison.counts.changed||comparison.counts.observedOnlyLeft||
     comparison.counts.observedOnlyRight||comparison.counts.ambiguous||comparison.counts.unkeyed)
   throw fail('HAMBURG_COMPARISON','The actual native comparison differs from the original fixed-window result.',comparison);
  let review=null,delivery=[];
  if(reviewFile){
   const bytes=await readOwned(reviewFile,1024*1024);
   review=reviewDocument(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),windows);
   for(const window of windows){
    const decision=review.editions.find(x=>x.window===window.window),n=window.window.slice(-1);
    const accepted=await call('WINDOW'+n+'_REVIEW','edition.review',{editionId:window.editionId,decision:'accept',
     actor:review.actor,note:decision.note,acknowledgeIssues:decision.acknowledgeIssues});
    const dataset=await call('WINDOW'+n+'_DATASET','dataset.prepare',{editionId:window.editionId,
     name:'Hamburg point 18571 retained status '+window.window,table:'observations'});
    const exported=await call('WINDOW'+n+'_EXPORT','edition.export',{editionId:window.editionId});
    files??=createFileAccess(workspace);
    const sourceFiles=await files.list({kind:'transfer',id:exported.id});
    const datasetFiles=await files.list({kind:'dataset',id:dataset.id});
    delivery.push({window:window.window,editionId:window.editionId,reviewId:accepted.id,dataset,sourceExport:exported,sourceFiles,datasetFiles});
   }
  }
  const view=await workspace.view(),result={
   schema:'stellar-forge.sensorthings-hamburg-receiving.v1',operationId:OP,
   state:review?'NATIVE_SOURCE_REVIEW_DATASET_EXPORT_COMPLETE':'NATIVE_SOURCE_RECEIVED_REVIEW_PENDING',
   workspaceId:view.workspaceId,revision:view.revision,
   recording:{sha256:expectedSha256,bytes:expectedBytes,selection},sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,
   windows,comparison,delivery,
   sourceInterpretation:'Two actual retained connector-text traversals. Native intake times are separate from source acquisition clocks. No provider HTTP metadata, snapshot, status duration or QA result is invented.',
   customerReceiving:'Native source archives and SF30 dataset files are ready after review. Merchant publication, buyer acquisition and receiving retain their separate actual engine operations and receipts.'
  };
  const receipt=await retain(workspace,result);return {...result,receipt};
 }finally{await files?.close();await workspace.close();}
}
async function retain(workspace,result){
 const bytes=json(result),saved=await workspace.store.putObject(bytes);
 await workspace.store.immutable(join(workspace.directory,'receipts','hamburg-receiving-'+saved.sha256+'.json'),bytes);
 return {sha256:saved.sha256,bytes:saved.bytes};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('node receive-hamburg.mjs --workspace ABS --recording ABS --sha256 SHA --bytes N [--resume] [--review ABS] [--source-inbox ABS] [--buyer-workspace ABS]\nReceive the same two complete original source editions without a provider fetch. Reopen the same operation after interruption. Add the actual two-edition review file to prepare source archives and native datasets.');return;}
 const values={},allowed=new Set(['workspace','recording','sha256','bytes','review','source-inbox','buyer-workspace']);let resume=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--resume'){if(resume)throw fail('HAMBURG_CLI','Duplicate --resume.');resume=true;continue;}
  const key=args[i].startsWith('--')?args[i].slice(2):'';
  if(!allowed.has(key)||Object.hasOwn(values,key)||!args[i+1]||args[i+1].startsWith('--'))throw fail('HAMBURG_CLI','Use the exact declared options once.');
  values[key]=args[++i];
 }
 if(!values.workspace||!values.recording||!values.sha256||!/^[1-9]\d*$/.test(values.bytes??''))throw fail('HAMBURG_CLI','Workspace, recording and its complete SHA/byte identity are required.');
 const result=await receiveHamburg({directory:values.workspace,recordingFile:values.recording,expectedSha256:values.sha256,
  expectedBytes:Number(values.bytes),resume,reviewFile:values.review??null,buyerWorkspaceDirectory:values['buyer-workspace']??null,
  sourceInboxDirectory:values['source-inbox']??null,onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
 console.log(JSON.stringify(result,null,2));if(result.state==='INCOMPLETE_ORIGINAL_CAPTURE')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 console.error(JSON.stringify({error:error.code??'HAMBURG_RECEIVING',message:error.message,details:error.details??null}));process.exitCode=1;
});
