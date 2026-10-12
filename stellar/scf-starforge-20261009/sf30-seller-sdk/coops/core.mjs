// MIT. Coastal source operations over the original workspace, publisher and receiver.
import {makeBackfillPlan} from './history.mjs';
import {writeRetainedAnalysisBundle} from './analysis/retained.mjs';
import {mappingValue,mappingSourceValue,mappingChanges,materializeExport,retainedExport,writeTableExport,writeSourcePackage,writeComparisonExport} from './exports.mjs';
import {openWorkspaceStore,jsonBytes,stable} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA,workspaceSchema,ACTIONS,SOURCE_CONTRACT} from './schema.mjs';
import {normaliseStation,makeQuery,requestPlan,metadataTasks,decodeSource,fetchCoopsResponse,normaliseBundle,importedResponse,text,fault,hashBytes} from './provider.mjs';
import {editionRows,summarizeEdition,exportEdition} from './domain.mjs';
import {prepareCoastalDataset,queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
const selected=(rows,id,label)=>{const r=rows.find(x=>x.id===id);if(!r)throw fault('COOPS_SELECTION','Choose a saved '+label+'.',404);return r;};
const key=value=>hashBytes(Buffer.from(value)).slice(0,24),now=()=>new Date().toISOString();
function errorInfo(error){
 if(['ENOSPC','EDQUOT'].includes(error.code))return{code:'COOPS_STORAGE_FULL',message:'The workspace is full. Its original operation can resume when capacity returns.',status:507,retryable:true};
 if(/^(COOPS_|STELLAR_|DATASET_|SOCRATA_|SELLER_|RELEASE_)/.test(error.code??'')||error.code==='INVALID_DATASET_QUERY')return{code:error.code,message:error.message,status:error.status??400,retryable:error.retryable??(error.status===429||error.status>=500),retryAt:error.retryAt??null};
 if(error.name==='AbortError'||error.name==='TimeoutError')return{code:'COOPS_SOURCE_TIMEOUT',message:'The original source request was interrupted; preceding responses remain retained.',status:504,retryable:true};
 return{code:'COOPS_OPERATION_FAILED',message:'The operation did not complete. Preserve its original request and inspect the retained source/error before resuming.',status:503,retryable:true};
}
function captureIdentity(c,workspaceId){
 return{schema:'stellar-forge.coops-edition.v1',workspaceId,captureId:c.id,profile:c.profile,query:c.query,planSha256:c.planSha256,
  stationMetadata:c.stationMetadata,metadataUnavailable:c.metadataUnavailable,pages:c.pages,failedResponses:c.failedResponses,
  coverage:c.tasks.map(({id,kind,resource,product,beginDate,endDate,url,state,records,reason,error})=>({id,kind,resource:resource??null,product:product??null,beginDate:beginDate??null,endDate:endDate??null,url,state,records:records??null,reason:reason??null,error:error??null})),
  complete:c.tasks.every(t=>['COMPLETE','UNAVAILABLE'].includes(t.state)),sourcePackageSha256:c.sourcePackageSha256??null,
  originalSource:c.originalSource??null};
}
export async function openCoopsWorkspace({directory,inboxDirectory,releaseRuntime={port:0},userAgent='StellarForgeCoastal/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)',fetchImpl=fetch}={}){
 text(userAgent,'an identifying user agent',512);
 const store=await openWorkspaceStore(directory,{schema:WORKSPACE_SCHEMA,initialState:{stations:[],backfills:[],mappings:[]}}),
  captures=new Map(),backfills=new Map(),operations=new Map(),controllers=new Map(),publishers=nativePublishers(store);
 await store.mutate(s=>{s.backfills??=[];s.mappings??=[];for(const b of s.backfills)if(['RUNNING','QUEUED'].includes(b.state))b.state='PAUSED';});
 let closing=false,requestTail=Promise.resolve(),lastRequest=0;
 if(store.read().captures.some(c=>['RUNNING','QUEUED'].includes(c.state)))await store.mutate(s=>{for(const c of s.captures)if(['RUNNING','QUEUED'].includes(c.state))c.state='PAUSED';});
 const capability=()=>({mode:releaseRuntime.facilitator?'NATIVE_X402':'CHALLENGE_ONLY',facilitatorConfigured:Boolean(releaseRuntime.facilitator),port:releaseRuntime.port??0});
 const schema=()=>({...workspaceSchema({workspaceId:store.read().workspaceId,inboxConfigured:Boolean(inboxDirectory),userAgent}),releaseRuntime:capability()});
 async function retain(bytes){if(bytes.length>256*1024*1024)throw fault('COOPS_OBJECT_CAPACITY','The complete selected file exceeds the 256 MiB native object limit.',413);return store.putObject(bytes);}
 async function editions({offset=0,limit=100,profileId}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw fault('COOPS_EDITION_RANGE','Choose a nonnegative offset and one to 500 editions.');
  const all=[];for(const id of [...store.read().editionIds].reverse()){const e=await store.edition(id);if(!profileId||e.profile.id===profileId){const {pages,failedResponses,...small}=e;all.push({...small,failedResponseCount:failedResponses?.length??0});}}
  return{editions:all.slice(offset,offset+limit),total:all.length,offset,limit};
 }
 async function view(){
  const s=store.read(),releases=[];
  for(const r of s.releases)try{const publisher=await publishers.state(r);releases.push({...r,publisher,selection:publisher.releases.state});}catch(e){releases.push({...r,publisherError:errorInfo(e)});}
  return{schema:'stellar-forge.coops-workspace-view.v1',workspaceId:s.workspaceId,revision:s.revision,stations:s.stations,
   captures:[...s.captures].reverse(),backfills:[...s.backfills].reverse(),mappings:s.mappings,editions:(await editions({limit:100})).editions,editionCount:s.editionIds.length,
   selectedEditionId:s.selectedEditionId,selectedEdition:s.selectedEditionId?await store.edition(s.selectedEditionId):null,
   annotations:s.annotations,datasets:s.datasets,releases,receipts:s.receipts,exports:s.exports,
   operations:Object.values(s.operations).slice(-100).reverse().map(({payload,context,materializedResult,...o})=>o),
   capabilities:{inboxConfigured:Boolean(inboxDirectory),releaseRuntime:capability()}};
 }
 async function seal(id){
  const c=selected(store.read().captures,id,'capture');if(!c.pages.length)return null;
  const identity=captureIdentity(c,store.read().workspaceId),eid=hashBytes(Buffer.from(stable(identity)));let edition;
  try{edition=await store.edition(eid);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!edition){
   edition={...identity,id:eid,label:c.label,createdAt:c.completedAt??c.updatedAt??c.createdAt,sourceContract:SOURCE_CONTRACT,
    byteCount:c.byteCount,sourceSha256:hashBytes(Buffer.from(stable(c.pages.map(p=>({url:p.url,sha256:p.sha256,bytes:p.bytes})))))};edition.summary=await summarizeEdition(store,edition);await store.saveEdition(edition);
  }else if(stable(Object.fromEntries(Object.keys(identity).map(k=>[k,edition[k]])))!==stable(identity))throw fault('COOPS_EDITION_CHANGED','The immutable edition differs from its source identity.',409);
  await store.mutate(s=>{const current=selected(s.captures,id,'capture');current.editionId=eid;if(!s.editionIds.includes(eid))s.editionIds.push(eid);s.selectedEditionId=eid;
   if(!current.annotationsImported){for(const a of current.importedAnnotations??[]){
    if(typeof a.subject!=='string'||typeof a.note!=='string'||!['open','reviewed','follow_up'].includes(a.status))continue;
    const aid='import-'+key(stable({eid,a}));if(!s.annotations.some(x=>x.id===aid))s.annotations.push({id:aid,editionId:eid,subject:a.subject.slice(0,300),note:a.note.slice(0,12000),status:a.status,updatedAt:a.updatedAt??c.createdAt,history:a.history??[],importedFrom:{editionId:a.editionId??null,annotationId:a.id??null}});
   }current.annotationsImported=true;}
  });return edition;
 }
 async function request(task,controller){
  const prior=requestTail;let release;requestTail=new Promise(done=>release=done);
  try{await prior;if(closing||controller.signal.aborted)throw new DOMException('Capture paused','AbortError');
   const delay=Math.max(0,lastRequest+250-Date.now());if(delay)await new Promise(done=>setTimeout(done,delay));
   if(closing||controller.signal.aborted)throw new DOMException('Capture paused','AbortError');lastRequest=Date.now();
   return await fetchCoopsResponse(task,{userAgent,fetchImpl,signal:controller.signal});
  }finally{release();}
 }
 async function adopt(id,taskId,receipt,decoded){
  await store.mutate(s=>{
   const c=selected(s.captures,id,'capture'),t=selected(c.tasks,taskId,'source task');if(c.pages.some(p=>p.taskId===taskId))return;
   if(c.pages.length+c.failedResponses.length>=128||c.byteCount+receipt.bytes>256*1024*1024)throw fault('COOPS_CAPTURE_CAPACITY','The source capture reached its 128-response/256 MiB bound.',413);
   const page={...receipt,taskId,kind:t.kind,resource:t.resource??null,product:t.product??null,beginDate:t.beginDate??null,endDate:t.endDate??null,records:decoded.records??0,unavailable:decoded.unavailable===true,reason:decoded.reason??null};
   c.pages.push(page);c.byteCount+=page.bytes;c.updatedAt=now();t.state=decoded.unavailable?'UNAVAILABLE':'COMPLETE';t.records=decoded.records??0;t.reason=decoded.reason??null;t.error=null;
   if(t.kind==='metadata'&&t.resource==='station'){
    const planned=metadataTasks(decoded.body,c.query);c.stationMetadata=planned.station;c.metadataUnavailable=planned.unavailable;
    const newTasks=planned.tasks.filter(p=>!c.tasks.some(x=>x.id===p.id)).map(p=>({...p,state:'PENDING',records:null}));
    c.tasks.splice(1,0,...newTasks);
   }
  });
 }
 async function captureLoop(id){
  const controller=new AbortController();controllers.set(id,controller);
  try{
   await store.mutate(s=>{const c=selected(s.captures,id,'capture');c.state='RUNNING';c.error=null;c.pauseRequested=false;});
   const first=selected(store.read().captures,id,'capture'),imported=first.sourcePackageSha256?normaliseBundle((await store.object(first.sourcePackageSha256)).toString('utf8')):null;
   while(!closing&&!controller.signal.aborted){
    const c=selected(store.read().captures,id,'capture'),task=c.tasks.find(t=>t.state==='PENDING'&&(!t.dependency||c.tasks.find(d=>d.id===t.dependency)?.state==='COMPLETE'));
    if(!task)break;
    try{
     let source;const checkpoint=await store.response(c.id,task.url);
     if(checkpoint?.parseState==='ACCEPTED')source={body:await store.object(checkpoint.sha256),receipt:checkpoint,error:null};
     else source=imported?importedResponse(imported,task):await request(task,controller);
     if(closing||controller.signal.aborted)break;
     await retain(source.body);await store.saveResponse(c.id,task.url,source.receipt);
     let decoded;
     if(source.error){
      if(source.error.status===404&&task.kind==='metadata'&&task.resource!=='station')decoded={unavailable:true,records:0,reason:'The advertised original metadata resource returned HTTP 404.',body:null};
      else throw Object.assign(new Error(source.error.message),source.error,{sourceReceipt:source.receipt});
     }else if(checkpoint?.parseState==='ACCEPTED'&&checkpoint.unavailable)decoded={unavailable:true,records:0,reason:checkpoint.reason,body:null};
     else try{decoded=decodeSource(source.body,task,c.query);}catch(error){error.sourceReceipt=source.receipt;throw error;}
     const receipt={...source.receipt,parseState:'ACCEPTED',unavailable:decoded.unavailable,reason:decoded.reason??null};
     await store.saveResponse(c.id,task.url,receipt);await adopt(c.id,task.id,receipt,decoded);
    }catch(error){
     if(closing||controller.signal.aborted)break;
     const info=errorInfo(error);
     await store.mutate(s=>{const current=selected(s.captures,id,'capture'),t=selected(current.tasks,task.id,'source task');t.state='FAILED';t.error=info;t.attempts=(t.attempts??0)+1;current.error=info;current.updatedAt=now();
      const receipt=error.sourceReceipt;if(receipt&&!current.failedResponses.some(r=>r.url===receipt.url&&r.sha256===receipt.sha256)){
       if(current.byteCount+receipt.bytes<=256*1024*1024&&current.pages.length+current.failedResponses.length<128){current.failedResponses.push({...receipt,taskId:t.id,kind:t.kind,resource:t.resource??null,product:t.product??null});current.byteCount+=receipt.bytes;}
      }
     });
    }
   }
   await store.mutate(s=>{const c=selected(s.captures,id,'capture');c.state=c.tasks.every(t=>['COMPLETE','UNAVAILABLE'].includes(t.state))?'COMPLETE':closing||controller.signal.aborted?'PAUSED':'PARTIAL';c.updatedAt=now();if(c.state==='COMPLETE')c.completedAt=c.updatedAt;});
   await seal(id);
  }catch(e){await store.mutate(s=>{const c=selected(s.captures,id,'capture');c.state='PAUSED';c.error=errorInfo(e);}).catch(()=>{});}
  finally{controllers.delete(id);}
 }
 function launch(id){if(captures.has(id))return captures.get(id);if(closing)return Promise.resolve();const task=captureLoop(id);captures.set(id,task);void task.finally(()=>captures.delete(id)).catch(()=>{});return task;}
 async function backfillLoop(id){
  try{
   await store.mutate(s=>{const b=selected(s.backfills,id,'backfill');b.state='RUNNING';b.pauseRequested=false;b.error=null;});
   for(;;){
    const b=selected(store.read().backfills,id,'backfill');if(closing||b.pauseRequested)break;
    const part=b.parts.find(p=>p.state!=='COMPLETE');if(!part)break;
    await store.mutate(s=>{
     const b=selected(s.backfills,id,'backfill'),p=selected(b.parts,part.id,'backfill part');
     if(!s.captures.some(c=>c.id===p.captureId)){
      const plan=requestPlan(b.plan.profile,p.query);s.captures.push({id:p.captureId,label:b.plan.label+' · '+p.query.beginDate+' to '+p.query.endDate,profile:b.plan.profile,query:p.query,planSha256:plan.planSha256,
       backfillId:id,createdAt:b.createdAt,state:'QUEUED',tasks:plan.tasks.map(t=>({...t,state:'PENDING',records:null})),pages:[],failedResponses:[],byteCount:0,stationMetadata:null,metadataUnavailable:[],sourcePackageSha256:null,originalSource:null,editionId:null,error:null});
     }else{const c=selected(s.captures,p.captureId,'capture');for(const t of c.tasks)if(t.state==='FAILED'){t.state='PENDING';t.error=null;}}
     p.state='RUNNING';b.updatedAt=now();
    });
    const original=selected(store.read().captures,part.captureId,'capture');if(original.state!=='COMPLETE')await launch(part.captureId);
    const captured=selected(store.read().captures,part.captureId,'capture');
    await store.mutate(s=>{const b=selected(s.backfills,id,'backfill'),p=selected(b.parts,part.id,'backfill part');p.state=captured.state==='COMPLETE'?'COMPLETE':'PARTIAL';p.editionId=captured.editionId;p.error=captured.error;b.updatedAt=now();});
    if(captured.state!=='COMPLETE')break;
   }
   await store.mutate(s=>{const b=selected(s.backfills,id,'backfill');b.state=b.parts.every(p=>p.state==='COMPLETE')?'COMPLETE':closing||b.pauseRequested?'PAUSED':'PARTIAL';b.updatedAt=now();if(b.state==='COMPLETE')b.completedAt=b.updatedAt;});
  }catch(error){await store.mutate(s=>{const b=selected(s.backfills,id,'backfill');b.state='PAUSED';b.error=errorInfo(error);}).catch(()=>{});}
 }
 function launchBackfill(id){if(backfills.has(id))return backfills.get(id);if(closing)return Promise.resolve();const task=backfillLoop(id);backfills.set(id,task);void task.finally(()=>backfills.delete(id)).catch(()=>{});return task;}
 async function reserve(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['action','payload','operationId','expectedRevision'].includes(k)))throw fault('COOPS_ACTION','Use action, payload, operationId and expectedRevision.');
  const {action,payload,operationId,expectedRevision}=request;
  if(!Object.hasOwn(ACTIONS,action)||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!ACTIONS[action].includes(k)))throw fault('COOPS_ACTION','Choose an advertised action and its exact fields.');
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw fault('COOPS_OPERATION_ID','Supply the original stable operationId.');
  const digest=hashBytes(Buffer.from(stable({action,payload}))),prior=store.read().operations[operationId];
  if(prior){if(prior.requestSha256!==digest)throw fault('COOPS_OPERATION_CONFLICT','That operation identity belongs to another request.',409);return{...prior,reused:true};}
  let imported=null,sourceObject=null,mappingSource=null;
  if(action==='capture.import'){imported=normaliseBundle(payload.bundle);sourceObject=await retain(imported.bytes);for(const response of imported.failedResponses)await retain(response.body);}
  if(action==='mapping.save'&&payload.mappingSource!==undefined){const incoming=mappingSourceValue(payload.mappingSource,{requireDecision:true});await retain(incoming.bytes);mappingSource=incoming.source;}
  let op;await store.mutate(s=>{
   const prior=s.operations[operationId];if(prior){if(prior.requestSha256!==digest)throw fault('COOPS_OPERATION_CONFLICT','The operation identity changed.',409);op={...prior,reused:true};return;}
   if(!Number.isSafeInteger(expectedRevision)||s.revision!==expectedRevision)throw fault('COOPS_REVISION_CHANGED','The workspace changed. Review its saved state while retaining the pending form.',409,{currentRevision:s.revision});
   op={operationId,action,payload:structuredClone(payload),expectedRevision,requestSha256:digest,state:'RUNNING',createdAt:now(),attempts:1,error:null};
   if(['capture.start','capture.preview','capture.import','backfill.preview','backfill.start'].includes(action)){
    const profile=selected(s.stations,payload.profileId,'station profile');if(!profile.active)throw fault('COOPS_STATION_ARCHIVED','Reopen this station profile before creating another source edition.',409);
    if(action==='backfill.preview'||action==='backfill.start'){
     if(action==='backfill.start'&&(s.backfills.some(b=>b.plan.profile.id===profile.id&&['RUNNING','QUEUED'].includes(b.state))||s.captures.some(c=>c.profile.id===profile.id&&['RUNNING','QUEUED'].includes(c.state))))throw fault('COOPS_CAPTURE_ACTIVE','Open this station profile’s existing active capture or backfill.',409);
     op.context={profile:structuredClone(profile),plan:makeBackfillPlan(profile,payload)};
    }else if(action==='capture.import'){
     if(profile.stationId!==imported.query.stationId)throw fault('COOPS_IMPORT_STATION','The source package belongs to another original NOAA station.',409);
     op.payload={profileId:payload.profileId,label:payload.label??profile.label};op.context={profile:structuredClone(profile),query:imported.query,sourcePackageSha256:sourceObject.sha256,
      originalSource:{editionId:imported.bundle.edition.id,workspaceId:imported.bundle.edition.workspaceId,profile:imported.profile,packageRepresentation:typeof payload.bundle==='string'?'Original submitted UTF-8 package bytes':'Submitted JSON object serialized as UTF-8; source response bytes remain exact.'},annotations:imported.annotations,failedResponses:imported.failedResponses.map(r=>({...r.receipt,imported:true}))};
    }else{
     if(action==='capture.start'&&s.captures.some(c=>c.profile.id===profile.id&&['RUNNING','QUEUED'].includes(c.state)))throw fault('COOPS_CAPTURE_ACTIVE','Open this profile’s existing active capture.',409);
     op.context={profile:structuredClone(profile),query:makeQuery(profile,payload)};
    }
   }
   if(action==='mapping.save'){
    const prior=payload.mappingId?selected(s.mappings,payload.mappingId,'model-input mapping'):null,targetId=prior?.id??'mapping-'+key(operationId);
    if(!prior&&s.mappings.some(m=>m.id===targetId))throw fault('COOPS_MAPPING_TARGET','The original creation identity already belongs to a saved mapping. Inspect that record before choosing a new request.',409);
    op.payload=structuredClone(payload);delete op.payload.mappingSource;
    op.context={mappingSource:structuredClone(mappingSource),mappingTarget:{id:targetId,revision:prior?.revision??null,recordSha256:prior?hashBytes(Buffer.from(stable(prior))):null}};
   }
   if(action==='export.create')op.context={annotations:structuredClone(s.annotations.filter(a=>a.editionId===payload.editionId)),mapping:payload.mappingId?structuredClone(selected(s.mappings,payload.mappingId,'model-input mapping')):null};
   if(action==='backfill.export'){const b=selected(s.backfills,payload.backfillId,'backfill');op.context={backfill:structuredClone(b),annotations:structuredClone(s.annotations.filter(a=>b.parts.some(p=>p.editionId===a.editionId))),mapping:payload.mappingId?structuredClone(selected(s.mappings,payload.mappingId,'model-input mapping')):null};}
   if(action==='release.prepare')op.context={releaseRuntime:structuredClone(releaseRuntime)};
   if(action.startsWith('buyer.'))op.context={inboxDirectory:inboxDirectory??null};
   s.operations[operationId]=op;
  });return op;
 }
 async function local(op,fn){let result;await store.mutate(s=>{const o=s.operations[op.operationId];if(Object.hasOwn(o,'materializedResult')){result=structuredClone(o.materializedResult);return;}result=fn(s);o.materializedResult=structuredClone(result);});return result;}
 async function execute(op){
  const p=op.payload,id=key(op.operationId);let result,launchId,backfillId;
  switch(op.action){
   case'station.save':{const input=normaliseStation(p);result=await local(op,s=>{const prior=p.profileId?selected(s.stations,p.profileId,'station profile'):null,profile={id:prior?.id??'station-'+id,...input,createdAt:prior?.createdAt??op.createdAt,updatedAt:op.createdAt,history:prior?[...(prior.history??[]),Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history'))]:[]};s.stations=s.stations.filter(x=>x.id!==profile.id);s.stations.push(profile);return profile;});break;}
   case'station.archive':result=await local(op,s=>{const r=selected(s.stations,p.profileId,'station profile');r.active=false;r.updatedAt=op.createdAt;return{id:r.id,active:false};});break;
   case'capture.preview':result=requestPlan(op.context.profile,op.context.query);break;
   case'backfill.preview':result=op.context.plan;break;
   case'backfill.start':result=await local(op,s=>{if(!s.backfills.some(b=>b.id===id)){s.backfills.push({id,plan:op.context.plan,state:'QUEUED',createdAt:op.createdAt,pauseRequested:false,error:null,parts:op.context.plan.parts.map(p=>({...p,id:'part-'+p.index,captureId:key(id+':'+p.index),state:'PENDING',editionId:null,error:null}))});}return{backfillId:id,state:selected(s.backfills,id,'backfill').state};});backfillId=id;break;
   case'backfill.resume':result=await local(op,s=>{const b=selected(s.backfills,p.backfillId,'backfill');b.pauseRequested=false;return{backfillId:b.id,state:b.state==='COMPLETE'?'COMPLETE':'QUEUED'};});if(result.state!=='COMPLETE')backfillId=p.backfillId;break;
   case'backfill.pause':result=await local(op,s=>{const b=selected(s.backfills,p.backfillId,'backfill');b.pauseRequested=true;return{backfillId:b.id,state:'PAUSING',captureIds:b.parts.filter(p=>p.state==='RUNNING').map(p=>p.captureId)};});for(const cid of result.captureIds)controllers.get(cid)?.abort();break;
   case'mapping.save':{const value=mappingValue(p);result=await local(op,s=>{
    const target=op.context?.mappingTarget;
    if(!target)throw fault('COOPS_MAPPING_REVIEW_REQUIRED','This unfinished request predates retained mapping comparison. Review the current mapping and preserve this request before issuing a new save.',409);
    const prior=s.mappings.find(m=>m.id===target.id)??null,currentSha256=prior?hashBytes(Buffer.from(stable(prior))):null;
    if(currentSha256!==target.recordSha256)throw fault('COOPS_MAPPING_CHANGED','The selected mapping changed after this request was reserved. Review its current revision and the retained draft before issuing a new save.',409,{mappingId:target.id,comparedRevision:target.revision,currentRevision:prior?.revision??null});
    const original=op.context?.mappingSource??prior?.sourceFile??null,
     sourceFile=original?{...structuredClone(original),retainedAt:original.retainedAt??op.createdAt,appliedMappingSha256:hashBytes(Buffer.from(stable(value))),adaptations:mappingChanges(original.mapping,value)}:null,
     m={id:prior?.id??'mapping-'+id,...value,sourceFile,revision:(prior?.revision??0)+1,createdAt:prior?.createdAt??op.createdAt,updatedAt:op.createdAt,
      history:prior?[...(prior.history??[]),Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history'))]:[]};
    s.mappings=s.mappings.filter(x=>x.id!==m.id);s.mappings.push(m);return m;});break;}
   case'capture.start':
   case'capture.import':{
    result=await local(op,s=>{if(!s.captures.some(c=>c.id===id)){
     const plan=requestPlan(op.context.profile,op.context.query);s.captures.push({id,label:text(p.label??op.context.profile.label,'a capture label',200),profile:op.context.profile,query:op.context.query,planSha256:plan.planSha256,
      createdAt:op.createdAt,state:'QUEUED',tasks:plan.tasks.map(t=>({...t,state:'PENDING',records:null})),pages:[],failedResponses:op.context.failedResponses??[],byteCount:(op.context.failedResponses??[]).reduce((n,r)=>n+r.bytes,0),stationMetadata:null,metadataUnavailable:[],
      sourcePackageSha256:op.context.sourcePackageSha256??null,originalSource:op.context.originalSource??null,importedAnnotations:op.context.annotations??[],editionId:null,error:null});}
     return{captureId:id,state:selected(s.captures,id,'capture').state,source:op.action==='capture.import'?'RETAINED_SOURCE_PACKAGE':'NOAA_HTTPS'};});launchId=id;break;
   }
   case'capture.resume':result=await local(op,s=>{const c=selected(s.captures,p.captureId,'capture');if(c.state==='COMPLETE')return{captureId:c.id,state:c.state,editionId:c.editionId};for(const t of c.tasks)if(t.state==='FAILED'){t.state='PENDING';t.error=null;}c.pauseRequested=false;return{captureId:c.id,state:'QUEUED'};});if(result.state!=='COMPLETE')launchId=p.captureId;break;
   case'capture.pause':controllers.get(p.captureId)?.abort();result=await local(op,s=>{const c=selected(s.captures,p.captureId,'capture');c.pauseRequested=true;return{captureId:c.id,state:'PAUSING'};});break;
   case'edition.select':{const edition=await store.edition(p.editionId);result=await local(op,s=>{if(!s.editionIds.includes(edition.id))throw fault('COOPS_EDITION','Choose a saved edition.',404);s.selectedEditionId=edition.id;return{editionId:edition.id};});break;}
   case'edition.compare':{
    const {comparison,exported:item}=await writeComparisonExport(store,{id:'comparison-'+id,left:await store.edition(p.leftId),right:await store.edition(p.rightId),table:p.table,createdAt:op.createdAt});
    await local(op,s=>{if(!s.exports.some(e=>e.id===item.id))s.exports.push(item);return item;});
    result={...comparison,export:item};break;
   }
   case'annotation.save':{await store.edition(p.editionId);const subject=text(p.subject,'a review subject',300),note=text(p.note,'a review note',12000,true);if(!['open','reviewed','follow_up'].includes(p.status))throw fault('COOPS_REVIEW','Choose open, reviewed or follow_up.');result=await local(op,s=>{const prior=s.annotations.find(a=>a.editionId===p.editionId&&a.subject===subject),a={id:prior?.id??id,editionId:p.editionId,subject,note,status:p.status,updatedAt:op.createdAt,history:prior?[...(prior.history??[]),{note:prior.note,status:prior.status,updatedAt:prior.updatedAt}]:[]};s.annotations=s.annotations.filter(x=>x.id!==a.id);s.annotations.push(a);return a;});break;}
   case'dataset.prepare':result=await prepareCoastalDataset(store,{edition:await store.edition(p.editionId),table:p.table,name:p.name,beginDate:p.beginDate,endDate:p.endDate,products:p.products,id:'dataset-'+id});await local(op,s=>{if(!s.datasets.some(d=>d.id===result.id))s.datasets.push(result);return result;});break;
   case'dataset.query':result=await queryNativeDataset(store,selected(store.read().datasets,p.datasetId,'dataset'),p.query);break;
   case'release.prepare':result=await prepareNativeRelease(store,{dataset:selected(store.read().datasets,p.datasetId,'dataset'),origin:p.origin,path:p.path??'/coastal',payment:p.payment,id:'coops-'+id,runtime:op.context?.releaseRuntime??releaseRuntime,publishers});await local(op,s=>{if(!s.releases.some(r=>r.id===result.id))s.releases.push(result);return result;});break;
   case'release.inspect':result=await inspectNativeRelease(store,selected(store.read().releases,p.releaseId,'release'),publishers);break;
   case'release.activate':case'release.start':case'release.stop':case'release.rollback':result=await controlNativeRelease(store,selected(store.read().releases,p.releaseId,'release'),op.action.split('.')[1],p,publishers);break;
   case'buyer.inspect':result=await inspectBuyer(op.context?.inboxDirectory??inboxDirectory,p.intentIds);break;
   case'buyer.receive':result=await receiveBuyer(store,op.context?.inboxDirectory??inboxDirectory,p.intentIds,'buyer-'+id);await local(op,s=>{if(!s.receipts.some(r=>r.id===result.id))s.receipts.push(result);return result;});break;
   case'export.create':{
    const edition=await store.edition(p.editionId),table=p.table??'observations',annotations=op.context?.annotations??[];
    if(p.format==='source-package')result=await writeSourcePackage(store,{id:'export-'+id,edition,annotations,createdAt:op.createdAt});
    else if(p.format==='report'){const output=await exportEdition(store,edition,annotations,table,p.format);result=await materializeExport(store,{id:'export-'+id,kind:'edition',editionId:edition.id,table,format:p.format,name:'coops-'+edition.id.slice(0,12)+'.html',type:output.type,createdAt:op.createdAt},async function*(){yield output.bytes;});}
    else result=await writeTableExport(store,{id:'export-'+id,editions:[edition],annotations,table,format:p.format,mapping:op.context?.mapping??null,createdAt:op.createdAt});
    await local(op,s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);return result;});break;
   }
   case'analysis.export':{
    result=op.materializedResult??await writeRetainedAnalysisBundle(store,{
     id:'analysis-'+id,observationsEditionId:p.observationsEditionId,predictionsEditionId:p.predictionsEditionId,
     options:p.options,analyst:p.analyst,createdAt:op.createdAt});
    result=await local(op,s=>{for(const file of result.files)if(!s.exports.some(e=>e.id===file.id))s.exports.push(file);return result;});
    break;
   }
   case'backfill.export':{
    const b=op.context.backfill,editions=[];for(const part of b.parts)if(part.editionId)editions.push(await store.edition(part.editionId));
    if(!editions.length)throw fault('COOPS_BACKFILL_EMPTY','Complete at least one retained source response before exporting this backfill.',409);
    const manifest={schema:'stellar-forge.coops-study-manifest.v1',id:b.id,plan:b.plan,state:b.state,parts:b.parts,sourceComplete:b.parts.every(p=>p.state==='COMPLETE'),note:'This selection pins the exact currently retained child editions, including partial source coverage. Later backfill progress produces another export.'};
    result=await writeTableExport(store,{id:'export-'+id,editions,annotations:op.context.annotations,table:p.table??'observations',format:p.format,mapping:op.context.mapping,createdAt:op.createdAt,backfill:manifest});
    await local(op,s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);return result;});break;
   }
  }
  const saved=await retain(jsonBytes(result));await store.mutate(s=>{const o=s.operations[op.operationId];o.state='COMPLETE';o.resultSha256=saved.sha256;o.completedAt=now();o.error=null;});
  if(launchId&&!closing)launch(launchId);if(backfillId&&!closing)launchBackfill(backfillId);return result;
 }
 async function action(request){
  let op;try{
   op=await reserve(request);
   if(op.state==='COMPLETE')return{operationId:op.operationId,reused:true,result:JSON.parse((await store.object(op.resultSha256)).toString('utf8')),view:await view()};
   if(op.state==='FAILED'&&!op.error?.retryable)throw Object.assign(new Error(op.error.message),op.error);
   if(operations.has(op.operationId))return{operationId:op.operationId,state:'RUNNING',reused:true,view:await view()};
   if(op.state==='FAILED')await store.mutate(s=>{const o=s.operations[op.operationId];o.state='RUNNING';o.attempts++;o.error=null;});
   const task=execute(op);operations.set(op.operationId,task);try{return{operationId:op.operationId,reused:Boolean(op.reused),result:await task,view:await view()};}finally{operations.delete(op.operationId);}
  }catch(error){const info=errorInfo(error);if(op)await store.mutate(s=>{const o=s.operations[op.operationId];if(o?.state!=='COMPLETE'){o.state='FAILED';o.error=info;o.failedAt=now();}}).catch(()=>{});throw Object.assign(new Error(info.message),info,{operationId:op?.operationId,currentRevision:store.read().revision});}
 }
 for(const c of store.read().captures)if(c.pages.length&&!c.editionId)await seal(c.id);
 return{store,schema,view,action,editions,
  inspectMappingFile(input){const {mapping,source}=mappingSourceValue(input);return{schema:'stellar-forge.coops-mapping-file-preview.v1',mapping,source};},
  async mappingRaw(id,revision){const m=selected(store.read().mappings,id,'model-input mapping'),r=revision===undefined?m:[m,...(m.history??[])].find(x=>x.revision===revision);if(!r?.sourceFile)throw fault('COOPS_MAPPING_SOURCE','Choose a saved mapping revision with its original input file.',404);const bytes=await store.object(r.sourceFile.sha256);if(bytes.length!==r.sourceFile.bytes)throw fault('COOPS_MAPPING_SOURCE_CHANGED','The retained mapping source size changed.',409);return{receipt:structuredClone(r.sourceFile),mappingId:m.id,revision:r.revision,bytes,type:'application/json; charset=utf-8',item:{name:'coops-mapping-source-'+r.sourceFile.sha256+'.json',type:'application/json; charset=utf-8',bytes:bytes.length,sha256:r.sourceFile.sha256}};},
  async operation(operationId){const op=store.read().operations[operationId];if(!op)return{operationId,state:'NOT_RESERVED'};const {payload,context,materializedResult,...record}=op;return{...record,result:op.resultSha256?JSON.parse((await store.object(op.resultSha256)).toString('utf8')):undefined};},
  async edition(id){if(!store.read().editionIds.includes(id))throw fault('COOPS_EDITION','Choose a retained edition.',404);return store.edition(id);},
  rows:(id,options)=>store.edition(id).then(e=>editionRows(store,e,options)),
  async raw(id,index){const e=await store.edition(id);if(!Number.isSafeInteger(index)||index<0||index>=e.pages.length)throw fault('COOPS_SOURCE_PAGE','Choose an original response page.');const receipt=e.pages[index];return{receipt,bytes:await store.object(receipt.sha256),type:'application/json; charset=utf-8'};},
  async captureRaw(id,index){const c=selected(store.read().captures,id,'capture'),all=[...c.pages,...c.failedResponses];if(!Number.isSafeInteger(index)||index<0||index>=all.length)throw fault('COOPS_SOURCE_PAGE','Choose an original capture response.');const receipt=all[index];return{receipt,bytes:await store.object(receipt.sha256),type:'application/octet-stream'};},
  async exported(id){const item=selected(store.read().exports,id,'export');return item.relativeFile?retainedExport(store,item):{item,bytes:await store.object(item.sha256)};},
  async received(id,name){return readBuyerOutput(store,selected(store.read().receipts,id,'customer receipt'),name);},
  async waitForCaptures(){await Promise.allSettled([...backfills.values(),...captures.values()]);return view();},
  async close(){if(closing)return;closing=true;for(const c of controllers.values())c.abort();await Promise.allSettled([...backfills.values(),...captures.values(),...operations.values()]);try{await publishers.close();}finally{await store.close();}}
 };
}
