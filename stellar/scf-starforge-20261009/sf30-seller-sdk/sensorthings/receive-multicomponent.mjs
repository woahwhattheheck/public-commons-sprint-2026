// MIT. Receive the complete original IoTLab multi-component week through the maintained SensorThings workspace.
// Every source request consumes one retained original connector response; no provider fetch is made.
import {isAbsolute,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../stellar-expert/store.mjs';
import {openSensorThingsWorkspace} from './core.mjs';
import {recordedTransport} from './provider.mjs';
import {createFileAccess} from './files.mjs';
import {json,sha,identity,plain} from './contract.mjs';

import {IOTLAB_COMPONENT_OPERATION,IOTLAB_COMPONENT_RECORDING} from './record-multicomponent.mjs';
import {componentCatalog,normalizeComponentSelection,validateComponentBindings} from './analysis/components.mjs';
const OP=IOTLAB_COMPONENT_OPERATION;
const SOURCE={
  "label": "IoTLab AD4GD / KWB Spree 2016 explicit temperature and conductivity components",
  "serviceUrl": "https://frost.iotlab.com/sensorthings/v1.1/",
  "license": {
    "name": "Data reuse licence not established in the retrieved source records",
    "url": "https://frost.iotlab.com/sensorthings/v1.1/MultiDatastreams(23)",
    "attribution": "IoTLab SensorThings service, MultiDatastream 23; retained Sensor 30 describes the 2016 AquaTroll 100 observations at Weidendammer Brücke in the river Spree.",
    "sourceUrl": "https://frost.iotlab.com/sensorthings/v1.1/MultiDatastreams(23)",
    "note": "The AD4GD deliverable's CC BY 4.0 label is a document licence, not an established licence for these data. Both unsuccessful source licence queries remain in the complete package."
  },
  "maxPageBytes": 4194304,
  "requestTimeoutMs": 45000
};
const WINDOW={
 start:'2016-06-20T00:00:00Z',endExclusive:'2016-06-27T00:00:00Z'
};
const QUERY={
 filter:'phenomenonTime ge 2016-06-20T00:00:00Z and phenomenonTime lt 2016-06-27T00:00:00Z',
 orderBy:'phenomenonTime asc',top:128,count:true,expandFeatureOfInterest:true
};
const fail=(code,message,details=null)=>Object.assign(new Error(message),{code,details});
async function recording(path){
 if(!isAbsolute(path??''))throw fail('IOTLAB_COMPONENT_RECORDING','Select the absolute path of the complete original IoTLab component recording.');
 const bytes=await readOwned(path,8*1024*1024);
 if(bytes.length!==IOTLAB_COMPONENT_RECORDING.bytes||sha(bytes)!==IOTLAB_COMPONENT_RECORDING.sha256)
  throw fail('IOTLAB_COMPONENT_RECORDING_CHANGED','The original IoTLab source recording differs from its frozen byte identity.');
 const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(original.schema!=='stellar-forge.sensorthings-connector-responses.v1'||
    original.source?.operationId!==OP||original.responses?.length!==15||
    original.source.window?.start!==WINDOW.start||original.source.window?.endExclusive!==WINDOW.endExclusive)
  throw fail('IOTLAB_COMPONENT_RECORDING_SCOPE','Use the 15-response native recording for the complete 20–27 June 2016 IoTLab window.');
 const transport=await recordedTransport(path);
 if(transport.sha256!==IOTLAB_COMPONENT_RECORDING.sha256)
  throw fail('IOTLAB_COMPONENT_RECORDING_CHANGED','The source recording changed while opening the original transport.');
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
 if(!plain(value)||value.schema!=='stellar-forge.sensorthings-iotlab-source-review.v1'||value.operationId!==OP||
    value.editionId!==editionId||value.decision!=='accept'||
    typeof value.actor!=='string'||!value.actor.trim()||value.actor.length>240||
    typeof value.note!=='string'||!value.note.trim()||
    !Array.isArray(value.acknowledgeIssues)||value.acknowledgeIssues.some(x=>typeof x!=='string')||
    new Set(value.acknowledgeIssues).size!==value.acknowledgeIssues.length)
  throw fail('IOTLAB_COMPONENT_REVIEW_BINDING','Retain the responsible operator, actual completed native edition, substantive source review and exact acknowledged issue codes.');
 return value;
}
async function retain(workspace,result){
 const bytes=json(result),saved=await workspace.store.putObject(bytes);
 await workspace.store.immutable(join(workspace.directory,'receipts','iotlab-component-receiving-'+saved.sha256+'.json'),bytes);
 return {sha256:saved.sha256,bytes:saved.bytes};
}
export async function receiveIotlabComponents({directory,recordingFile,resume=false,reviewFile=null,
 buyerWorkspaceDirectory=null,sourceInboxDirectory=null,componentReviewFile=null,publicationFile=null,onProgress=()=>{}}={}){
 if(!isAbsolute(directory??'')||(reviewFile!==null&&!isAbsolute(reviewFile))||
    (buyerWorkspaceDirectory!==null&&!isAbsolute(buyerWorkspaceDirectory))||
    (sourceInboxDirectory!==null&&!isAbsolute(sourceInboxDirectory))||
    (componentReviewFile!==null&&!isAbsolute(componentReviewFile))||(publicationFile!==null&&!isAbsolute(publicationFile)))
  throw fail('IOTLAB_COMPONENT_PATH','Use explicit absolute native workspace, review and host-bound receiving paths.');
 if(typeof resume!=='boolean'||typeof onProgress!=='function')
  throw fail('IOTLAB_COMPONENT_ARGUMENT','Resume is a boolean and onProgress is a caller-owned function.');
 const transport=await recording(recordingFile);
 const workspace=await openSensorThingsWorkspace({directory,transport,buyerWorkspaceDirectory,sourceInboxDirectory,onProgress,
  fetchImpl:async()=>{throw fail('IOTLAB_COMPONENT_NO_NETWORK','This original receiving operation does not issue another provider request.');}});
 const call=async(suffix,action,payload)=>{
  const result=await workspace.action({operationId:OP+'_'+suffix,expectedRevision:(await workspace.view()).revision,action,payload});
  if(!Object.hasOwn(result,'result'))
   throw fail('IOTLAB_COMPONENT_OPERATION_PENDING','The original action remains unresolved. Inspect that same native operation before continuing.',{operationId:result.operationId});
  return result.result;
 };
 let files;
 try{
  const source=await call('SOURCE','source.add',SOURCE);
  const catalogue=await call('CATALOG','catalog.capture',{sourceId:source.id,kind:'MultiDatastreams',
   query:{orderBy:'id asc',top:3,count:true}});
  const selected=await workspace.catalogRows(catalogue.id,{offset:0,limit:3});
  if(selected.rows[0]?.pointer!=='/value/0')
   throw fail('IOTLAB_COMPONENT_CATALOGUE','The retained catalogue does not contain the original selected occurrence.');
  const plan=await call('PLAN_WINDOW','plan.create',{sourceId:source.id,
   label:'IoTLab MultiDatastream 23 — complete 20–27 June 2016 UTC source window',
   streams:[{catalogId:catalogue.id,pointer:'/value/0'}],observationQuery:QUERY,
   includeHistoricalLocations:false,maxRequests:64,maxBytes:8*1024*1024});
  if(plan.streams.length!==1||plan.streams[0].id.type!=='number'||plan.streams[0].id.value!=='23')
   throw fail('IOTLAB_COMPONENT_SELECTION','The retained catalogue pointer does not identify the original numeric MultiDatastream 23.');
  const started=await call('WINDOW_CAPTURE','capture.start',{planId:plan.id,budget:64});
  let captured=await workspace.waitCapture(started.captureId);
  if(captured.state!=='COMPLETE'&&resume){
   if(captured.tasks.some(t=>t.state==='FAILED'))
    throw fail('IOTLAB_COMPONENT_SOURCE_FAILURE','Inspect the retained failed request; this receiver does not substitute later source responses.',compact(captured));
   const suffix='RESUME_'+identity({captureId:captured.id,tasks:captured.tasks.map(t=>({
    id:t.id,state:t.state,attempts:t.attempts.length
   }))}).slice(0,20);
   await call(suffix,'capture.resume',{captureId:captured.id,budget:64,retryFailed:false});
   captured=await workspace.waitCapture(captured.id);
  }
  const window={...WINDOW,...compact(captured)};
  if(window.state!=='COMPLETE'||!window.editionId){
   const result={schema:'stellar-forge.sensorthings-iotlab-component-receiving.v1',operationId:OP,
    state:'INCOMPLETE_ORIGINAL_CAPTURE',workspaceId:(await workspace.view()).workspaceId,
    recording:IOTLAB_COMPONENT_RECORDING,sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,window,
    recordingSelection:transport.inspect(),
    resume:'Reopen the same workspace and recording with resume=true. An original failed request requires inspecting its saved evidence.'};
   const receipt=await retain(workspace,result);return {...result,receipt};
  }
  window.summary=await workspace.summary(window.editionId);
  const summary=window.summary;
  if(summary.rows!==672||summary.uniqueObservationIds!==672||summary.duplicateOccurrences||
     summary.changedDuplicates||summary.unkeyed||summary.resultTypes.array!==672||
     Object.keys(summary.resultTypes).some(t=>t!=='array'))
   throw fail('IOTLAB_COMPONENT_NATIVE_SOURCE_DISAGREEMENT','The native original observation set differs from the complete frozen 672-entity, four-component original source. Retain it for inspection without publication.',window);
  const selection=transport.inspect();
  if(selection.remaining.length)
   throw fail('IOTLAB_COMPONENT_SOURCE_CLOSURE','The native traversal did not consume the complete selected 15-response original recording.',selection);
  onProgress({event:'source-edition-complete',editionId:window.editionId,rows:672});
  const originalEdition=await workspace.edition(window.editionId),componentCatalogue=await componentCatalog(workspace.store,originalEdition);
  if(componentCatalogue.streams.length!==1||componentCatalogue.streams[0].components.length!==4||!componentCatalogue.streams[0].metadataAligned)
   throw fail('IOTLAB_COMPONENT_METADATA','The native source does not preserve the four aligned original metadata positions.');
  let review=null,delivery=null;
  if(reviewFile!==null){
   const original=await readOwned(reviewFile,1024*1024);
   review=reviewDocument(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original)),window.editionId);
   const accepted=await call('WINDOW_REVIEW','edition.review',{editionId:window.editionId,decision:'accept',
    actor:review.actor,note:review.note,acknowledgeIssues:review.acknowledgeIssues});
   const dataset=await call('WINDOW_DATASET','dataset.prepare',{editionId:window.editionId,
    name:'IoTLab Spree 2016 — complete original positional components',table:'components'});
   const exported=await call('WINDOW_EXPORT','edition.export',{editionId:window.editionId});
   files=createFileAccess(workspace);
   delivery={editionId:window.editionId,reviewId:accepted.id,dataset,sourceExport:exported,
    sourceFiles:await files.list({kind:'transfer',id:exported.id}),
    datasetFiles:await files.list({kind:'dataset',id:dataset.id})};
  }
  let analysis=null;
  if(componentReviewFile!==null){
   const componentReview=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(componentReviewFile,1024*1024)));
   if(!plain(componentReview)||componentReview.schema!=='stellar-forge.sensorthings-iotlab-component-review.v1'||
      componentReview.operationId!==OP||componentReview.editionId!==window.editionId||componentReview.recordingSha256!==IOTLAB_COMPONENT_RECORDING.sha256||
      typeof componentReview.actor!=='string'||!componentReview.actor.trim()||componentReview.actor.length>200||
      typeof componentReview.title!=='string'||!componentReview.title.trim()||typeof componentReview.note!=='string'||!componentReview.note.trim())
    throw fail('IOTLAB_COMPONENT_REVIEW','Bind the responsible operator and explicit component decision to this actual original edition.');
   if(!Array.isArray(componentReview.componentSelections)||componentReview.componentSelections.length!==2||
      componentReview.componentSelections.some(c=>![1,2].includes(c.index))||new Set(componentReview.componentSelections.map(c=>c.index)).size!==2)
    throw fail('IOTLAB_COMPONENT_REVIEW','This receiving programme reviews the two originally qualified positions 1 and 2. Other selections remain explicit new analyst work.');
   const selection=normalizeComponentSelection({streamKeys:[plan.streams[0].key],componentSelections:componentReview.componentSelections,
    period:{start:WINDOW.start,end:WINDOW.endExclusive},view:'numeric',viewerId:componentReview.viewerId??null},originalEdition);
   await validateComponentBindings(workspace.store,originalEdition,selection);
   const created=await call('ANALYSIS','analysis.create',{editionId:window.editionId,title:componentReview.title,actor:componentReview.actor,note:componentReview.note,
    selection:{streamKeys:selection.streamKeys,componentSelections:selection.componentSelections,period:{start:WINDOW.start,end:WINDOW.endExclusive},view:'numeric',
     viewerId:selection.viewerId,timeBasis:'phenomenonTime'}});
   analysis={projectId:created.projectId,versionId:created.versionId,summary:created.summary,publication:null,projectExport:null};
   if(publicationFile!==null){
    const approved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(publicationFile,1024*1024)));
    if(!plain(approved)||approved.schema!=='stellar-forge.sensorthings-iotlab-component-publication.v1'||approved.operationId!==OP||
       approved.projectId!==created.projectId||approved.versionId!==created.versionId||approved.editionId!==window.editionId||
       typeof approved.actor!=='string'||!approved.actor.trim()||typeof approved.title!=='string'||!approved.title.trim()||typeof approved.note!=='string'||!approved.note.trim()||
       !Array.isArray(approved.comparisonIds)||!Array.isArray(approved.viewerEvidenceIds))
      throw fail('IOTLAB_COMPONENT_PUBLICATION','Choose the actual saved version, named publication decision and original evidence IDs.');
    const published=await call('ANALYSIS_PUBLICATION','analysis.publish',{projectId:created.projectId,baseVersionId:created.versionId,actor:approved.actor,
     title:approved.title,note:approved.note,comparisonIds:approved.comparisonIds,evidenceIds:approved.viewerEvidenceIds});
    const exported=await call('ANALYSIS_EXPORT','analysis.export',{projectId:created.projectId,actor:approved.actor});
    files??=createFileAccess(workspace);
    analysis.publication={...published,fileSelection:await files.list({kind:'analysis',id:published.id})};
    analysis.projectExport={...exported,fileSelection:await files.list({kind:'analysis',id:exported.id})};
   }
  }else if(publicationFile!==null)throw fail('IOTLAB_COMPONENT_PUBLICATION','Reopen the same explicit component review before publishing its saved version.');
  const view=await workspace.view();
  const result={schema:'stellar-forge.sensorthings-iotlab-component-receiving.v1',operationId:OP,
   state:analysis?.publication?'NATIVE_COMPONENT_PUBLICATION_EXPORT_COMPLETE':analysis?'NATIVE_COMPONENT_ANALYSIS_COMPLETE':review?'NATIVE_SOURCE_REVIEW_DATASET_EXPORT_COMPLETE':'NATIVE_SOURCE_RECEIVED_REVIEW_PENDING',
   workspaceId:view.workspaceId,revision:view.revision,recording:{...IOTLAB_COMPONENT_RECORDING,selection},
   sourceId:source.id,catalogueId:catalogue.id,planId:plan.id,window,componentCatalogue,delivery,analysis,
   interpretation:'Original IoTLab Spree 2016 MultiDatastream observations. All four original positions, property/unit/datatype declarations and full vectors remain retained. Selected positions 1 and 2 require explicit numeric-JSON interpretation of the nonconformant datatype declarations. Duplicate instants and 75-minute observed gaps remain original events, without repaired time, continuous coverage, interpolation, current telemetry, independent QA or an atomic provider snapshot.',
   receiving:'Use the returned actual edition and component binding IDs in the maintained analyst operation. The original Helgoland point diagram, complete publication download and independent project receiving use this same source and original Applications/merchant interfaces; this receiving result does not claim a browser run.'};
  const receipt=await retain(workspace,result);return {...result,receipt};
 }finally{await files?.close();await workspace.close();}
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){
  console.log('node receive-multicomponent.mjs --workspace ABS --recording ABS [--resume] [--review ABS] [--components ABS] [--publication ABS] [--source-inbox ABS] [--buyer-workspace ABS]\nReceive the same complete retained IoTLab multi-component week. Its exact original recording hash and size are pinned in this source. No provider fetch or automatic source acceptance.');return;
 }
 const values={},allowed=new Set(['workspace','recording','review','components','publication','source-inbox','buyer-workspace']);let resume=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--resume'){if(resume)throw fail('IOTLAB_COMPONENT_CLI','Duplicate --resume.');resume=true;continue;}
  const key=args[i].startsWith('--')?args[i].slice(2):'';
  if(!allowed.has(key)||Object.hasOwn(values,key)||!args[i+1]||args[i+1].startsWith('--'))
   throw fail('IOTLAB_COMPONENT_CLI','Use the exact declared options once.');
  values[key]=args[++i];
 }
 if(!values.workspace||!values.recording)throw fail('IOTLAB_COMPONENT_CLI','The native workspace and complete original recording are required.');
 const result=await receiveIotlabComponents({directory:values.workspace,recordingFile:values.recording,resume,
  reviewFile:values.review??null,componentReviewFile:values.components??null,publicationFile:values.publication??null,sourceInboxDirectory:values['source-inbox']??null,
  buyerWorkspaceDirectory:values['buyer-workspace']??null,
  onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
 console.log(JSON.stringify(result,null,2));if(result.state==='INCOMPLETE_ORIGINAL_CAPTURE')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 console.error(JSON.stringify({error:error.code??'IOTLAB_COMPONENT_RECEIVING',message:error.message,details:error.details??null}));process.exitCode=1;
});
