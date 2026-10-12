// MIT. Receive one actual BGS pressure window through the maintained SensorThings workspace.
// Every source request consumes one retained original connector response; no provider fetch is made.
import {isAbsolute,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../stellar-expert/store.mjs';
import {openSensorThingsWorkspace} from './core.mjs';
import {recordedTransport} from './provider.mjs';
import {createFileAccess} from './files.mjs';
import {json,sha,identity,plain} from './contract.mjs';

export const BGS_PRESSURE_OPERATION='SCF_SENSORTHINGS_BGS_PRESSURE_1B40_20261012';
export const BGS_PRESSURE_RECORDING=Object.freeze({
 filename:'native-recording.json',bytes:313277,
 sha256:'e04a3932da707a2a90a68fc87b97c4af72337c09ec5a23f7c072b933a1b855ac'
});
const OP=BGS_PRESSURE_OPERATION;
const SOURCE={
 label:'BGS GGERFS_01 barometric pressure — retained 1 June 2026 window',
 serviceUrl:'https://sensors.bgs.ac.uk/FROST-Server/v1.1/',
 license:{
  name:'Open Government Licence — original record and government catalogue statement; version not specified',
  url:'https://www.api.gov.uk/bgs/bgs-sensor-data-service/',
  attribution:'Contains UKRI materials ©UKRI 2026',
  sourceUrl:'https://sensors.bgs.ac.uk/FROST-Server/v1.1/Things(8)',
  note:'The original Thing properties retain the complete licence notice and Unrestricted access label. The licence URL is the government catalogue statement, not an inferred licence-version text. The acknowledgement year identifies these retained 2026 observations.'
 },
 maxPageBytes:4*1024*1024,requestTimeoutMs:45000
};
const WINDOW={
 start:'2026-06-01T00:00:00Z',endExclusive:'2026-06-02T00:00:00Z'
};
const QUERY={
 filter:'phenomenonTime ge 2026-06-01T00:00:00Z and phenomenonTime lt 2026-06-02T00:00:00Z',
 orderBy:'phenomenonTime asc',top:64,count:true,expandFeatureOfInterest:true
};
const fail=(code,message,details=null)=>Object.assign(new Error(message),{code,details});
async function recording(path){
 if(!isAbsolute(path??''))throw fail('BGS_RECORDING','Select the absolute path of the complete original BGS recording.');
 const bytes=await readOwned(path,1024*1024);
 if(bytes.length!==BGS_PRESSURE_RECORDING.bytes||sha(bytes)!==BGS_PRESSURE_RECORDING.sha256)
  throw fail('BGS_RECORDING_CHANGED','The original BGS source recording differs from its frozen byte identity.');
 const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(original.schema!=='stellar-forge.sensorthings-connector-responses.v1'||
    original.source?.operationId!==OP||original.responses?.length!==10||
    original.source.window?.start!==WINDOW.start||original.source.window?.endExclusive!==WINDOW.endExclusive)
  throw fail('BGS_RECORDING_SCOPE','Use the ten-response native recording for the separate complete 1 June BGS pressure window.');
 const transport=await recordedTransport(path);
 if(transport.sha256!==BGS_PRESSURE_RECORDING.sha256)
  throw fail('BGS_RECORDING_CHANGED','The source recording changed while opening the original transport.');
 return transport;
}
function compact(capture){
 return {captureId:capture.id,state:capture.state,editionId:capture.editionIds.at(-1)??null,
  requests:capture.tasks.reduce((n,t)=>n+t.attempts.length,0),pages:capture.pages.length,bytes:capture.totalBytes,
  issues:capture.issues,remaining:capture.tasks.filter(t=>t.state!=='COMPLETE').map(t=>({
   id:t.id,url:t.url,state:t.state,error:t.error
  }))};
}
function reviewDocument(value,editionId){
 if(!plain(value)||value.schema!=='stellar-forge.sensorthings-bgs-review.v1'||value.operationId!==OP||
    value.editionId!==editionId||value.decision!=='accept'||
    typeof value.actor!=='string'||!value.actor.trim()||value.actor.length>240||
    typeof value.note!=='string'||!value.note.trim()||
    !Array.isArray(value.acknowledgeIssues)||value.acknowledgeIssues.some(x=>typeof x!=='string')||
    new Set(value.acknowledgeIssues).size!==value.acknowledgeIssues.length)
  throw fail('BGS_REVIEW_BINDING','Retain the responsible operator, actual completed native edition, substantive source review and exact acknowledged issue codes.');
 return value;
}
async function retain(workspace,result){
 const bytes=json(result),saved=await workspace.store.putObject(bytes);
 await workspace.store.immutable(join(workspace.directory,'receipts','bgs-pressure-receiving-'+saved.sha256+'.json'),bytes);
 return {sha256:saved.sha256,bytes:saved.bytes};
}
export async function receiveBgsPressure({directory,recordingFile,resume=false,reviewFile=null,
 buyerWorkspaceDirectory=null,sourceInboxDirectory=null,onProgress=()=>{}}={}){
 if(!isAbsolute(directory??'')||(reviewFile!==null&&!isAbsolute(reviewFile))||
    (buyerWorkspaceDirectory!==null&&!isAbsolute(buyerWorkspaceDirectory))||
    (sourceInboxDirectory!==null&&!isAbsolute(sourceInboxDirectory)))
  throw fail('BGS_PATH','Use explicit absolute native workspace, review and host-bound receiving paths.');
 if(typeof resume!=='boolean'||typeof onProgress!=='function')
  throw fail('BGS_ARGUMENT','Resume is a boolean and onProgress is a caller-owned function.');
 const transport=await recording(recordingFile);
 const workspace=await openSensorThingsWorkspace({directory,transport,buyerWorkspaceDirectory,sourceInboxDirectory,onProgress,
  fetchImpl:async()=>{throw fail('BGS_NO_NETWORK','This original receiving operation does not issue another provider request.');}});
 const call=async(suffix,action,payload)=>{
  const result=await workspace.action({operationId:OP+'_'+suffix,expectedRevision:(await workspace.view()).revision,action,payload});
  if(!Object.hasOwn(result,'result'))
   throw fail('BGS_OPERATION_PENDING','The original action remains unresolved. Inspect that same native operation before continuing.',{operationId:result.operationId});
  return result.result;
 };
 let files;
 try{
  const source=await call('SOURCE','source.add',SOURCE);
  const catalogue=await call('CATALOG','catalog.capture',{sourceId:source.id,kind:'Datastreams',
   query:{orderBy:'id asc',top:3,count:true}});
  const selected=await workspace.catalogRows(catalogue.id,{offset:0,limit:3});
  if(selected.rows[0]?.pointer!=='/value/0')
   throw fail('BGS_CATALOGUE','The retained catalogue does not contain the original selected occurrence.');
  const plan=await call('PLAN_WINDOW','plan.create',{sourceId:source.id,
   label:'BGS stream 1 — complete 1 June 2026 UTC pressure window',
   streams:[{catalogId:catalogue.id,pointer:'/value/0'}],observationQuery:QUERY,
   includeHistoricalLocations:false,maxRequests:64,maxBytes:8*1024*1024});
  if(plan.streams.length!==1||plan.streams[0].id.type!=='number'||plan.streams[0].id.value!=='1')
   throw fail('BGS_SELECTION','The retained catalogue pointer does not identify the original numeric Datastream 1.');
  const started=await call('WINDOW_CAPTURE','capture.start',{planId:plan.id,budget:64});
  let captured=await workspace.waitCapture(started.captureId);
  if(captured.state!=='COMPLETE'&&resume){
   if(captured.tasks.some(t=>t.state==='FAILED'))
    throw fail('BGS_SOURCE_FAILURE','Inspect the retained failed request; this receiver does not substitute later source responses.',compact(captured));
   const suffix='RESUME_'+identity({captureId:captured.id,tasks:captured.tasks.map(t=>({
    id:t.id,state:t.state,attempts:t.attempts.length
   }))}).slice(0,20);
   await call(suffix,'capture.resume',{captureId:captured.id,budget:64,retryFailed:false});
   captured=await workspace.waitCapture(captured.id);
  }
  const window={...WINDOW,...compact(captured)};
  if(window.state!=='COMPLETE'||!window.editionId){
   const result={schema:'stellar-forge.sensorthings-bgs-receiving.v1',operationId:OP,
    state:'INCOMPLETE_ORIGINAL_CAPTURE',workspaceId:(await workspace.view()).workspaceId,
    recording:BGS_PRESSURE_RECORDING,sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,window,
    recordingSelection:transport.inspect(),
    resume:'Reopen the same workspace and recording with resume=true. An original failed request requires inspecting its saved evidence.'};
   const receipt=await retain(workspace,result);return {...result,receipt};
  }
  window.summary=await workspace.summary(window.editionId);
  const summary=window.summary;
  if(summary.rows!==96||summary.uniqueObservationIds!==96||summary.duplicateOccurrences||
     summary.changedDuplicates||summary.unkeyed||summary.resultTypes.number!==96||
     Object.keys(summary.resultTypes).some(t=>t!=='number'))
   throw fail('BGS_NATIVE_SOURCE_DISAGREEMENT','The native original observation set differs from the complete frozen 96-point scalar source. Retain it for inspection without publication.',window);
  const selection=transport.inspect();
  if(selection.remaining.length)
   throw fail('BGS_SOURCE_CLOSURE','The native traversal did not consume the complete selected ten-response original recording.',selection);
  onProgress({event:'source-edition-complete',editionId:window.editionId,rows:96});
  let review=null,delivery=null;
  if(reviewFile!==null){
   const original=await readOwned(reviewFile,1024*1024);
   review=reviewDocument(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original)),window.editionId);
   const accepted=await call('WINDOW_REVIEW','edition.review',{editionId:window.editionId,decision:'accept',
    actor:review.actor,note:review.note,acknowledgeIssues:review.acknowledgeIssues});
   const dataset=await call('WINDOW_DATASET','dataset.prepare',{editionId:window.editionId,
    name:'BGS GGERFS_01 barometric pressure — 1 June 2026 UTC',table:'observations'});
   const exported=await call('WINDOW_EXPORT','edition.export',{editionId:window.editionId});
   files=createFileAccess(workspace);
   delivery={editionId:window.editionId,reviewId:accepted.id,dataset,sourceExport:exported,
    sourceFiles:await files.list({kind:'transfer',id:exported.id}),
    datasetFiles:await files.list({kind:'dataset',id:dataset.id})};
  }
  const view=await workspace.view();
  const result={schema:'stellar-forge.sensorthings-bgs-receiving.v1',operationId:OP,
   state:review?'NATIVE_SOURCE_REVIEW_DATASET_EXPORT_COMPLETE':'NATIVE_SOURCE_RECEIVED_REVIEW_PENDING',
   workspaceId:view.workspaceId,revision:view.revision,recording:{...BGS_PRESSURE_RECORDING,selection},
   sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,window,delivery,
   interpretation:'Separate historical BGS scalar pressure observations. Units and original publisher quality labels are retained. No sample validity interval, interpolation, current telemetry, independent QA or atomic provider snapshot is inferred.',
   receiving:'Use the actual returned edition ID in the maintained analyst selection. Numeric Helgoland diagram, reviewed publication, merchant delivery and fresh receiving remain their own original operations.'};
  const receipt=await retain(workspace,result);return {...result,receipt};
 }finally{await files?.close();await workspace.close();}
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){
  console.log('node receive-bgs.mjs --workspace ABS --recording ABS [--resume] [--review ABS] [--source-inbox ABS] [--buyer-workspace ABS]\nReceive the same complete retained BGS pressure window. Its exact original recording hash and size are pinned in this source. No provider fetch or automatic source acceptance.');return;
 }
 const values={},allowed=new Set(['workspace','recording','review','source-inbox','buyer-workspace']);let resume=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--resume'){if(resume)throw fail('BGS_CLI','Duplicate --resume.');resume=true;continue;}
  const key=args[i].startsWith('--')?args[i].slice(2):'';
  if(!allowed.has(key)||Object.hasOwn(values,key)||!args[i+1]||args[i+1].startsWith('--'))
   throw fail('BGS_CLI','Use the exact declared options once.');
  values[key]=args[++i];
 }
 if(!values.workspace||!values.recording)throw fail('BGS_CLI','The native workspace and complete original recording are required.');
 const result=await receiveBgsPressure({directory:values.workspace,recordingFile:values.recording,resume,
  reviewFile:values.review??null,sourceInboxDirectory:values['source-inbox']??null,
  buyerWorkspaceDirectory:values['buyer-workspace']??null,
  onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
 console.log(JSON.stringify(result,null,2));if(result.state==='INCOMPLETE_ORIGINAL_CAPTURE')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 console.error(JSON.stringify({error:error.code??'BGS_RECEIVING',message:error.message,details:error.details??null}));process.exitCode=1;
});
