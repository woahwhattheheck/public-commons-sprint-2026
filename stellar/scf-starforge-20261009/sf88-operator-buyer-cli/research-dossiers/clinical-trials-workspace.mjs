// MIT. Complete original ClinicalTrials packet → question/cohort/evidence/report receiving.
import {readdir,mkdtemp,link,rm,open} from 'node:fs/promises';
import {join} from 'node:path';
import {privateDirectory,readJson,readBytes,writeJson,writeBytes,safeCode as nativeSafeCode} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {ORIGIN,PROVIDER,validateEdition,compareEditions,packetBytes,sha,json,need,object} from './clinical-trials-model.mjs';
import {openClinicalTrialsInputs} from './clinical-trials-inputs.mjs';
const PLAN='stellar-forge.clinicaltrials-plan.v1',STATE='stellar-forge.clinicaltrials-operation.v1';
const now=()=>new Date().toISOString();
const safeCode=error=>nativeSafeCode(error?.code,'CLINICALTRIALS_OPERATION_FAILED');
const identifier=value=>{need(typeof value==='string'&&/^ct_[a-f0-9]{64}$/.test(value),'CLINICALTRIALS_OPERATION_ID_INVALID');return value;};
const revision=value=>{need(Number.isSafeInteger(value)&&value>=0,'EXPECTED_REVISION_REQUIRED');return value;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const initial=id=>({schema:STATE,id,phase:'PREPARED',sequence:0,startedAt:null,updatedAt:now(),
 pages:[],before:null,after:null,occurrences:0,sourceBytes:0,nextPageToken:null,editionSha256:null,editionBytes:null,
 stoppedReason:null,error:null,pendingReceive:null,received:null});
export async function openClinicalTrialsWorkspace({directory,dossiers,inputs=null,python='python3'}={}){
 need(dossiers&&typeof dossiers.get==='function'&&typeof dossiers.receive==='function','DOSSIER_STORE_REQUIRED');
 directory=await privateDirectory(directory);
 const ownInputs=inputs===null;inputs??=await openClinicalTrialsInputs({directory:join(directory,'inputs'),python});
 const operations=await privateDirectory(join(directory,'operations')),active=new Map();let closed=false;
 const folder=id=>join(operations,identifier(id));
 const metadata=(id,options)=>dossiers.getMetadata?dossiers.getMetadata(id,options):dossiers.get(id,options);
 async function plan(id){
  const value=await readJson(join(folder(id),'plan.json'),1024*1024);
  need(value.schema===PLAN&&value.id===id&&object(value.payload)&&value.sha256===sha(json(value.payload))&&
   id==='ct_'+sha(json({dossierId:value.payload.dossierId,requestId:value.payload.requestId})),'CLINICALTRIALS_PLAN_CHANGED');
  return value;
 }
 async function state(id){
  let value;
  try{value=await readJson(join(folder(id),'state.json'),4*1024*1024);}
  catch(error){if(error.code!=='ENOENT')throw error;await plan(id);return initial(id);}
  need(value.schema===STATE&&value.id===id&&Number.isSafeInteger(value.sequence)&&Array.isArray(value.pages)&&
   ['PREPARED','RUNNING','READY','STOPPED','FAILED','IMPORTED'].includes(value.phase),'CLINICALTRIALS_OPERATION_CHANGED');
  return value;
 }
 async function save(id,current){
  const next={...current,sequence:current.sequence+1,updatedAt:now()};
  await writeJson(join(folder(id),'state.json'),next);return next;
 }
 async function running(id){
  if(active.has(id))return true;
  try{await withPrivateLock(folder(id),'operation.lock',async()=>{});return false;}
  catch(error){if(error.code==='ROUTESCAN_RECORD_BUSY')return true;throw error;}
 }
 async function inspect(id,{probe=true}={}){
  const [selected,current]=await Promise.all([plan(id),state(id)]);
  const live=current.phase==='RUNNING'&&(probe?await running(id):true);
  let sourceMatches=false;
  try{const input=await inputs.get(selected.payload.request.sourceId);
   sourceMatches=input.packetSha256===selected.payload.source.packetSha256&&input.manifestSha256===selected.payload.source.manifestSha256;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return {plan:selected,operation:current,running:live,interrupted:current.phase==='RUNNING'&&!live,sourceMatches};
 }
 async function prepare(dossierId,input={}){
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');
  need(object(input)&&Object.keys(input).every(key=>['requestId','questionId','expectedRevision','sourceId','captureId','allowPartial','label'].includes(key)),'CLINICALTRIALS_PLAN_FIELDS_INVALID');
  need(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'CLINICALTRIALS_REQUEST_ID_REQUIRED');
  need(typeof input.questionId==='string'&&input.questionId.length<=160,'QUESTION_NOT_FOUND');
  need(typeof input.sourceId==='string'&&/^ctsrc_[a-f0-9]{64}$/.test(input.sourceId),'CLINICALTRIALS_INPUT_ID_INVALID');
  need(typeof input.captureId==='string'&&/^capture-[a-f0-9-]{36}$/.test(input.captureId),'CLINICALTRIALS_CAPTURE_NOT_FOUND');
  need(input.allowPartial===undefined||typeof input.allowPartial==='boolean','CLINICALTRIALS_PARTIAL_DECISION_INVALID');
  const label=input.label??'ClinicalTrials.gov retained cohort';
  need(typeof label==='string'&&label.trim().length>0&&label.length<=200,'CLINICALTRIALS_LABEL_INVALID');
  const request={requestId:input.requestId,dossierId,questionId:input.questionId,expectedRevision:revision(input.expectedRevision),
   sourceId:input.sourceId,captureId:input.captureId,allowPartial:input.allowPartial??false,label};
  const id='ct_'+sha(json({dossierId,requestId:input.requestId})),path=await privateDirectory(folder(id));
  return withPrivateLock(path,'operation.lock',async()=>{
   try{
    const existing=await plan(id);need(same(existing.payload.request,request),'CLINICALTRIALS_REQUEST_ID_REUSED');
    return inspect(id,{probe:false});
   }catch(error){if(error.code!=='ENOENT')throw error;}
   const before=await metadata(dossierId);need(before.revision===request.expectedRevision,'REVISION_CONFLICT');
   const question=before.questions.find(row=>row.id===request.questionId);need(question,'QUESTION_NOT_FOUND');
   const source=await inputs.get(request.sourceId),capture=source.captures.find(row=>row.id===request.captureId);
   need(capture&&capture.pageCount>0,'CLINICALTRIALS_RETAINED_PAGES_REQUIRED');
   need(capture.status==='completed'||request.allowPartial,'CLINICALTRIALS_PARTIAL_REVIEW_REQUIRED');
   const payload={dossierId,requestId:request.requestId,request,question:question.text,
    source:{sourceId:source.sourceId,packetSha256:source.packetSha256,packetBytes:source.packetBytes,
     manifestSha256:source.manifestSha256,capture}};
   const selected={schema:PLAN,id,preparedAt:now(),payload,sha256:sha(json(payload))};
   await writeJson(join(path,'plan.json'),selected,{exclusive:true});await save(id,initial(id));
   return inspect(id,{probe:false});
  });
 }
 async function adoptEdition(id,selected,current){
  let bytes;try{bytes=await readBytes(join(folder(id),'edition.json'),64*1024*1024);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=validateEdition(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  need(value.usage.operationId===id&&value.query===selected.payload.question&&value.label===selected.payload.request.label&&
   value.usage.captureId===selected.payload.request.captureId&&value.usage.sourceId===selected.payload.request.sourceId&&
   value.sourcePacket.sha256===selected.payload.source.packetSha256&&
   value.sourcePacket.manifestSha256===selected.payload.source.manifestSha256,'CLINICALTRIALS_EDITION_PLAN_CHANGED');
  return save(id,{...current,phase:'READY',editionSha256:sha(bytes),editionBytes:bytes.length,
   pages:value.sourcePages,occurrences:value.results.length,sourceBytes:value.usage.sourceBytes,
   nextPageToken:value.usage.nextPageToken,stoppedReason:value.usage.stoppedReason,error:null});
 }
 async function collect(id,selected,controller,ready){
  return withPrivateLock(folder(id),'operation.lock',async()=>{
   let current=await state(id);
   if(['READY','IMPORTED'].includes(current.phase)){ready.resolve();return;}
   if(await adoptEdition(id,selected,current)){ready.resolve();return;}
   current=await save(id,{...current,phase:'RUNNING',startedAt:current.startedAt??now(),error:null,stoppedReason:null});
   ready.resolve();const stage=await mkdtemp(join(folder(id),'.edition-'));
   try{
    const request=selected.payload.request,input=await inputs.get(request.sourceId);
    need(input.packetSha256===selected.payload.source.packetSha256&&input.manifestSha256===selected.payload.source.manifestSha256,
     'CLINICALTRIALS_SOURCE_CONFIGURATION_CHANGED');
    const output=join(stage,'edition.json');
    const built=await inputs.build(request.sourceId,{sourceId:request.sourceId,captureId:request.captureId,
     question:selected.payload.question,label:request.label,operationId:id},{output,signal:controller.signal});
    controller.signal.throwIfAborted();
    try{await link(output,join(folder(id),'edition.json'));}
    catch(error){if(error.code!=='EEXIST')throw error;
     need(sha(await readBytes(join(folder(id),'edition.json'),64*1024*1024))===built.sha256,'CLINICALTRIALS_EDITION_CHANGED');}
    const dir=await open(folder(id),'r');try{await dir.sync();}finally{await dir.close();}
    await adoptEdition(id,selected,current);
   }catch(error){
    // Reconcile an already published edition before reporting an interrupted state write.
    try{if(await adoptEdition(id,selected,current))return;}catch{}
    try{await save(id,{...current,phase:controller.signal.aborted?'STOPPED':'FAILED',
     error:safeCode(error),stoppedReason:controller.signal.aborted?'Local source receiving stopped. The original packet remains retained.':safeCode(error)});}catch{}
    throw error;
   }finally{await rm(stage,{recursive:true,force:true});}
  });
 }
 async function start(id,{expectedPlanSha256}={}){
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');
  const selected=await plan(id);need(selected.sha256===expectedPlanSha256,'CLINICALTRIALS_PLAN_CHANGED');
  if(active.has(id))return inspect(id);
  if(['READY','IMPORTED'].includes((await state(id)).phase))return inspect(id);
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');
  const controller=new AbortController();let resolve,reject;
  const readiness=new Promise((yes,no)=>{resolve=yes;reject=no;}),ready={resolve,reject};
  const promise=collect(id,selected,controller,ready);active.set(id,{controller,promise});
  promise.catch(reject).finally(()=>active.delete(id)).catch(()=>{});
  await readiness;return inspect(id,{probe:false});
 }
 async function wait(id){await active.get(id)?.promise.catch(()=>{});return review(id);}
 async function stop(id){
  const job=active.get(id);
  if(job){job.controller.abort();await job.promise.catch(()=>{});}
  return inspect(id);
 }
 async function edition(id){
  const current=await state(id);need(current.editionSha256,'CLINICALTRIALS_EDITION_NOT_READY');
  const bytes=await readBytes(join(folder(id),'edition.json'),64*1024*1024);
  need(bytes.length===current.editionBytes&&sha(bytes)===current.editionSha256,'CLINICALTRIALS_EDITION_CHANGED');
  const value=validateEdition(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  return {bytes,value,sha256:current.editionSha256};
 }
 async function review(id,{offset=0,limit=50}={}){
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'CLINICALTRIALS_REVIEW_PAGE_INVALID');
  const selected=await inspect(id);
  if(!selected.operation.editionSha256)return {...selected,cohort:null};
  const retained=await edition(id);
  return {...selected,cohort:{sha256:retained.sha256,usage:retained.value.usage,warnings:retained.value.warnings,
   sourcePages:retained.value.sourcePages,offset,limit,total:retained.value.results.length,
   studies:retained.value.results.slice(offset,offset+limit).map(row=>row.metadata)}};
 }
 async function receive(id,{expectedPlanSha256,expectedEditionSha256,expectedRevision}={}){
  return withPrivateLock(folder(id),'operation.lock',async()=>{
   const selected=await plan(id),current=await state(id),request=selected.payload.request;
   need(selected.sha256===expectedPlanSha256&&current.editionSha256===expectedEditionSha256,'CLINICALTRIALS_REVIEW_CHANGED');
   const before=await metadata(request.dossierId),retained=await edition(id);
   const existing=before.editions.find(row=>row.questionId===request.questionId&&row.raw?.sha256===retained.sha256);
   if(current.phase==='IMPORTED'){
    need(existing&&current.received?.editionId===existing.id,'CLINICALTRIALS_RECEIVED_EDITION_MISSING');
    return {operation:current,receipt:current.received,dossier:await dossiers.get(request.dossierId)};
   }
   if(current.pendingReceive&&existing){
    const pending=current.pendingReceive,receivedRevision=pending.expectedRevision+(pending.duplicateEditionId?0:1);
    const original=await metadata(request.dossierId,{revision:receivedRevision});
    need(original.editions.some(row=>row.id===existing.id&&row.raw?.sha256===retained.sha256)&&
     (pending.duplicateEditionId===existing.id||existing.origin?.operationId===id),'CLINICALTRIALS_RECEIVE_RECONCILIATION_FAILED');
    const receipt={dossierId:request.dossierId,questionId:request.questionId,editionId:existing.id,
     sourceSha256:retained.sha256,originalRevision:pending.expectedRevision,revision:receivedRevision,
     duplicate:pending.duplicateEditionId!==null,receivedAt:pending.startedAt,reconciled:true};
    const saved=await save(id,{...current,phase:'IMPORTED',received:receipt,pendingReceive:null});
    return {operation:saved,receipt,dossier:await dossiers.get(request.dossierId)};
   }
   need(before.revision===revision(expectedRevision),'REVISION_CONFLICT');
   need(before.questions.find(row=>row.id===request.questionId)?.text===selected.payload.question,'CLINICALTRIALS_QUESTION_CHANGED');
   const pending={expectedRevision,duplicateEditionId:existing?.id??null,startedAt:now()};
   const pendingState=await save(id,{...current,pendingReceive:pending});
   const received=await dossiers.receive(request.dossierId,{questionId:request.questionId,label:request.label,provider:PROVIDER,
    rawBytes:retained.bytes,sourceReference:ORIGIN+'/data-api/api',expectedRevision,
    origin:{mode:'ORIGINAL_CLINICALTRIALS_PACKET_RECEIVING',operationId:id,planSha256:selected.sha256,
     packetSha256:selected.payload.source.packetSha256,captureId:request.captureId}});
   const original=received.editions.find(row=>row.questionId===request.questionId&&row.raw?.sha256===retained.sha256);
   need(original,'CLINICALTRIALS_RECEIVED_EDITION_MISSING');
   const receipt={dossierId:request.dossierId,questionId:request.questionId,editionId:original.id,sourceSha256:retained.sha256,
    originalRevision:expectedRevision,revision:received.revision,duplicate:received.revision===expectedRevision,receivedAt:now(),reconciled:false};
   const saved=await save(id,{...pendingState,phase:'IMPORTED',received:receipt,pendingReceive:null});
   return {operation:saved,receipt,dossier:received};
  });
 }
 async function compare(id,otherId){
  const [left,right]=await Promise.all([plan(otherId),plan(id)]);
  need(left.payload.dossierId===right.payload.dossierId&&left.payload.request.questionId===right.payload.request.questionId,'CLINICALTRIALS_COMPARISON_QUESTION_MISMATCH');
  return compareEditions((await edition(otherId)).value,(await edition(id)).value);
 }

 function pageOptions({offset=0,limit=50}={}){
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'CLINICALTRIALS_REVIEW_PAGE_INVALID');
  return {offset,limit};
 }
 function cohortView(value,sha256,{offset=0,limit=50}={}){
  return {sha256,usage:value.usage,warnings:value.warnings,sourcePages:value.sourcePages,offset,limit,total:value.results.length,
   studies:value.results.slice(offset,offset+limit).map(row=>row.metadata)};
 }
 async function record(id,index){
  const retained=await edition(id);
  need(Number.isSafeInteger(index)&&index>=0&&index<retained.value.results.length,'CLINICALTRIALS_STUDY_INDEX_INVALID');
  return {editionSha256:retained.sha256,index,record:retained.value.results[index]};
 }
 async function retainedEdition(dossierId,editionId){
  need(typeof dossiers.readRetainedEdition==='function','ORIGINAL_RETAINED_EDITION_READER_REQUIRED');
  const saved=await dossiers.readRetainedEdition(dossierId,editionId);
  need(saved.edition.provider===PROVIDER,'CLINICALTRIALS_RETAINED_EDITION_REQUIRED');
  const value=validateEdition(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(saved.bytes)));
  return {...saved,value,sha256:sha(saved.bytes)};
 }
 async function retainedList(dossierId){
  const dossier=await metadata(dossierId);
  return {items:dossier.editions.filter(row=>row.provider===PROVIDER&&row.mode==='retained'),
   revision:dossier.revision};
 }
 async function retainedReview(dossierId,editionId,options={}){
  const paging=pageOptions(options),saved=await retainedEdition(dossierId,editionId);
  return {edition:saved.edition,question:saved.value.query,label:saved.value.label,
   cohort:cohortView(saved.value,saved.sha256,paging)};
 }
 async function retainedRecord(dossierId,editionId,index){
  const saved=await retainedEdition(dossierId,editionId);
  need(Number.isSafeInteger(index)&&index>=0&&index<saved.value.results.length,'CLINICALTRIALS_STUDY_INDEX_INVALID');
  return {editionId,editionSha256:saved.sha256,index,record:saved.value.results[index]};
 }
 async function compareRetained(dossierId,beforeId,afterId){
  const [left,right]=await Promise.all([retainedEdition(dossierId,beforeId),retainedEdition(dossierId,afterId)]);
  need(left.edition.questionId===right.edition.questionId,'CLINICALTRIALS_COMPARISON_QUESTION_MISMATCH');
  return {...compareEditions(left.value,right.value),beforeEditionId:beforeId,afterEditionId:afterId,
   authority:'ORIGINAL_RETAINED_DOSSIER_EDITIONS'};
 }

 async function list(dossierId,{after='',limit=30}={}){
  need(typeof after==='string'&&(after===''||/^ct_[a-f0-9]{64}$/.test(after))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'CLINICALTRIALS_OPERATION_PAGE_INVALID');
  const names=(await readdir(operations)).filter(name=>/^ct_[a-f0-9]{64}$/.test(name)&&name>after).sort();
  const items=[];let last=after,more=false;
  for(const id of names){
   const selected=await plan(id);if(selected.payload.dossierId!==dossierId)continue;
   if(items.length===limit){more=true;break;}items.push({plan:selected,operation:await state(id)});last=id;
  }
  return {items,next:more?last:null};
 }
 return {directory,prepare,start,wait,stop,inspect,review,edition,record,receive,compare,list,
  inputs:options=>inputs.list(options),input:id=>inputs.get(id),importInput:(stream,options)=>inputs.importStream(stream,options),
  importFile:(path,options)=>inputs.importFile(path,options),sourcePacket:id=>inputs.packet(id),
  async retainedPacket(dossierId,editionId){const retained=await retainedEdition(dossierId,editionId);
   return {bytes:packetBytes(retained.value.sourcePacket),sha256:retained.value.sourcePacket.sha256,
    filename:'clinicaltrials-workspace-'+retained.value.sourcePacket.sha256.slice(0,12)+'.zip'};},
  retainedList,retainedReview,retainedEdition,retainedRecord,compareRetained,
  async snapshot(){return {configured:true,source:inputs.identity,activeOperations:[...active.keys()]};},
  async close(){if(closed)return;closed=true;for(const entry of active.values())entry.controller.abort();
   await Promise.allSettled([...active.values()].map(entry=>entry.promise));if(ownInputs)await inputs.close();}};
}
