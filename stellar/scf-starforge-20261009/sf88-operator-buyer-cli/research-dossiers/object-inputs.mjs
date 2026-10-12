// MIT. Receive original Object Buyer deliveries into the existing Research file intake.
import {readdir,lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Buyer} from '../node/client.mjs';
import {ObjectReport,ObjectDelivery} from '../node/object.mjs';
import {VerifiedFile} from '../node/result.mjs';
import {privateDirectory,readJson,readBytes,writeJson,jsonBytes,digest,need,object,now,safeCode} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {SERVICE_LIMITS} from './unstructured-pipelines/contract.mjs';
import {researchObjectReference,validateResearchObjectReference,researchObjectWorkspaceId} from './object-reference.mjs';

const SOURCE = 'stellar-forge.research-object-source.v1';
const REQUEST = 'stellar-forge.research-object-review-request.v1';
const PREPARATION = 'stellar-forge.research-object-review-preparation.v1';
const REVIEW = 'stellar-forge.research-object-review.v1';
const HEX = /^[a-f0-9]{64}$/;
const REVIEW_ID = /^or_[a-f0-9]{64}$/;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const encoded = value => Buffer.from(JSON.stringify(canonical(value)));
const same = (a,b) => encoded(a).equals(encoded(b));
const identifier = (value,maximum=256) => typeof value === 'string' && value.trim().length > 0 &&
  Buffer.byteLength(value) <= maximum && !/[\0-\x1f\x7f/\\]/.test(value);
const exact = (value,fields,code) => need(object(value) && Object.keys(value).every(key => fields.includes(key)),code);
const absolute = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !value.includes('\0'),'RESEARCH_OBJECT_ABSOLUTE_PATH_REQUIRED');
  return value;
};
async function optional(path,maximum=1048576) {
  try {return await readJson(path,maximum);} catch(error) {if(error.code !== 'ENOENT')throw error;return null;}
}
async function immutable(path,value) {
  try {await writeJson(path,value,{exclusive:true});}
  catch(error) {if(error.code !== 'EEXIST')throw error;
    need(same(await readJson(path,8*1024*1024),value),'RESEARCH_OBJECT_RETAINED_RECORD_CHANGED');}
}
class CapturedObjectFile extends VerifiedFile {
  constructor(path,reference) {super();this.metadata={path,bytes:reference.bytes,sha256:reference.sha256};}
  _metadata() {return this.metadata;}
}
export {researchObjectWorkspaceId} from './object-reference.mjs';

/** The local launcher selects the source root. HTTP clients only select its original session IDs. */
export async function openResearchObjectSource({directory,objectWorkspaceDirectory,
  runtimeDirectory=fileURLToPath(new URL('../',import.meta.url))} = {}) {
  absolute(directory);absolute(objectWorkspaceDirectory);absolute(resolve(runtimeDirectory));
  const workspaceId=researchObjectWorkspaceId(objectWorkspaceDirectory);
  const definition={schema:SOURCE,workspaceId,objectWorkspaceDirectory};
  const sourceSha256=digest(encoded(definition));
  const root=await privateDirectory(join(directory,'object-inputs'));
  const selected=await privateDirectory(join(root,sourceSha256));
  const reviews=await privateDirectory(join(selected,'reviews'));
  const files=await privateDirectory(join(selected,'files'));
  await immutable(join(selected,'source.json'),definition);
  const buyer=new Buyer({runtimeDirectory:resolve(runtimeDirectory),
    stateDirectory:join(selected,'buyer'),outputLimit:8*1024*1024});
  const sessionsRoot=join(objectWorkspaceDirectory,'sessions');
  const tasks=new Set(),controllers=new Set();let closed=false;
  const folder=id=>{need(REVIEW_ID.test(id ?? ''),'RESEARCH_OBJECT_REVIEW_ID_INVALID');return join(reviews,id);};
  const publicSource=()=>({configured:true,workspaceId,sourceSha256,maxInputBytes:SERVICE_LIMITS.maxInputBytes,
    active:tasks.size});
  async function track(work,signal) {
    need(!closed,'RESEARCH_OBJECT_SOURCE_CLOSED');
    need(signal === undefined || signal instanceof AbortSignal,'RESEARCH_OBJECT_ABORT_SIGNAL_INVALID');
    const controller=new AbortController(),abort=()=>controller.abort();
    controllers.add(controller);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const pending=Promise.resolve().then(()=>{
      need(!closed&&!controller.signal.aborted,'RESEARCH_OBJECT_REVIEW_STOPPED');return work(controller.signal);
    });
    tasks.add(pending);
    try{return await pending;}
    finally{tasks.delete(pending);controllers.delete(controller);signal?.removeEventListener('abort',abort);}
  }
  async function readDefinition(session,expectedSessionId) {
    need(SESSION.test(session ?? ''),'RESEARCH_OBJECT_SESSION_INVALID');
    await privateDirectory(objectWorkspaceDirectory,{create:false});
    await privateDirectory(sessionsRoot,{create:false});
    const directory=join(sessionsRoot,session);
    await privateDirectory(directory,{create:false});
    const bytes=await readBytes(join(directory,'session.json'),131072);
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
    need(value?.schema==='stellar-forge.sf88.object-session.v1' && value.directory===directory &&
      UUID.test(value.sessionId ?? '') && object(value.config?.operation) &&
      Number.isSafeInteger(value.bytes) && value.bytes>=0,'RESEARCH_OBJECT_SESSION_INVALID');
    if(expectedSessionId !== undefined)
      need(value.sessionId===expectedSessionId,'RESEARCH_OBJECT_SESSION_CHANGED');
    return {directory,value,sha256:digest(bytes)};
  }
  async function list({after='',snapshot=null,limit=25} = {}) {
    need(!closed,'RESEARCH_OBJECT_SOURCE_CLOSED');
    need((after===''||SESSION.test(after)) && (snapshot===null||HEX.test(snapshot)) &&
      Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'RESEARCH_OBJECT_PAGE_INVALID');
    let entries;
    try{
      await privateDirectory(objectWorkspaceDirectory,{create:false});
      await privateDirectory(sessionsRoot,{create:false});
      entries=(await readdir(sessionsRoot,{withFileTypes:true}))
        .filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()&&SESSION.test(entry.name))
        .map(entry=>entry.name).sort();
    }catch(error){
      return {...publicSource(),available:false,error:safeCode(error.code,'RESEARCH_OBJECT_SOURCE_UNAVAILABLE'),
        items:[],nextAfter:null,snapshot:null};
    }
    const current=digest(encoded(entries));
    need(snapshot===null||snapshot===current,'RESEARCH_OBJECT_INVENTORY_CHANGED');
    const start=after===''?0:entries.indexOf(after)+1;
    need(after===''||start>0,'RESEARCH_OBJECT_CURSOR_CHANGED');
    const chosen=entries.slice(start,start+limit),items=[];
    for(const session of chosen){
      try{
        const {value}=await readDefinition(session);
        items.push({session,sessionId:value.sessionId,name:value.selection?.filename??session,
          objectId:value.selection?.objectId??null,bytes:value.bytes,
          deliveryMode:value.deliveryMode??'chunks',createdAt:value.createdAt,
          state:'SAVED_SESSION',reviewRequired:true,
          unavailable:value.bytes===0?'PIPELINE_EMPTY_INPUT':
            value.bytes>SERVICE_LIMITS.maxInputBytes?'PIPELINE_INPUT_SIZE_INVALID':null});
      }catch(error){items.push({session,state:'UNAVAILABLE',error:safeCode(error.code,'RESEARCH_OBJECT_SESSION_UNAVAILABLE')});}
    }
    return {...publicSource(),available:true,items,snapshot:current,
      nextAfter:start+chosen.length<entries.length?chosen.at(-1):null};
  }
  function checkedRequest(dossierId,input) {
    need(identifier(dossierId,160),'RESEARCH_OBJECT_DOSSIER_REQUIRED');
    exact(input,['requestId','session','expectedSessionId'],'RESEARCH_OBJECT_REVIEW_FIELDS_INVALID');
    need(identifier(input.requestId)&&SESSION.test(input.session??'')&&UUID.test(input.expectedSessionId??''),
      'RESEARCH_OBJECT_REVIEW_SELECTION_REQUIRED');
    return {dossierId,requestId:input.requestId,session:input.session,expectedSessionId:input.expectedSessionId};
  }
  function reviewView(value) {
    return {reviewId:value.id,reviewSha256:value.sha256,requestId:value.request.requestId,
      dossierId:value.request.dossierId,source:{workspaceId,sourceSha256},
      reference:structuredClone(value.reference),capturedAt:value.capturedAt,
      nativeRecordSha256:value.nativeRecordSha256};
  }
  async function checkedPreparation(id,request) {
    const dir=folder(id),value=await optional(join(dir,'preparation.json'),8*1024*1024);
    if(value===null)return null;
    const retainedRequest=await readJson(join(dir,'request.json'));
    need(same(retainedRequest,{schema:REQUEST,request,sourceSha256,requestSha256:digest(encoded(request))}),
      'RESEARCH_OBJECT_REVIEW_REQUEST_CHANGED');
    need(value.schema===PREPARATION&&value.id===id&&same(value.request,request)&&
      value.sourceSha256===sourceSha256&&value.requestSha256===digest(encoded(request))&&
      HEX.test(value.nativeRecordSha256??'')&&Number.isFinite(Date.parse(value.capturedAt)),
    'RESEARCH_OBJECT_PREPARATION_CHANGED');
    validateResearchObjectReference(value.reference);
    need(value.reference.workspaceId===workspaceId&&value.reference.session===request.session&&
      value.reference.sessionId===request.expectedSessionId,'RESEARCH_OBJECT_PREPARATION_CHANGED');
    need(object(value.nativeRecord)&&digest(jsonBytes(value.nativeRecord))===value.nativeRecordSha256,
      'RESEARCH_OBJECT_NATIVE_RECORD_CHANGED');
    const original=new ObjectDelivery(new ObjectReport(value.nativeRecord.record,value.nativeRecord.process));
    need(same(researchObjectReference(original,{workspaceId,session:request.session}),value.reference),
      'RESEARCH_OBJECT_NATIVE_RECORD_CHANGED');
    return value;
  }
  async function checkedReview(dossierId,id) {
    const dir=folder(id),value=await readJson(join(dir,'review.json'));
    need(value.schema===REVIEW&&value.id===id&&object(value.request)&&
      value.request.dossierId===dossierId&&id==='or_'+digest(Buffer.from(value.request.requestId))&&
      value.sourceSha256===sourceSha256,'RESEARCH_OBJECT_REVIEW_CHANGED');
    exact(value.request,['dossierId','requestId','session','expectedSessionId'],'RESEARCH_OBJECT_REVIEW_CHANGED');
    const prepared=await checkedPreparation(id,checkedRequest(dossierId,{
      requestId:value.request.requestId,session:value.request.session,expectedSessionId:value.request.expectedSessionId}));
    need(prepared!==null,'RESEARCH_OBJECT_PREPARATION_REQUIRED');
    const payload={request:prepared.request,sourceSha256,reference:prepared.reference,
      nativeRecordSha256:prepared.nativeRecordSha256,capturedAt:prepared.capturedAt};
    need(value.sha256===digest(encoded(payload))&&
      same(Object.fromEntries(Object.keys(payload).map(key=>[key,value[key]])),payload),
    'RESEARCH_OBJECT_REVIEW_CHANGED');
    return value;
  }
  async function capture(dossierId,input,{signal} = {}) {
    const request=checkedRequest(dossierId,input),id='or_'+digest(Buffer.from(request.requestId));
    return track(async selectedSignal=>{
      const dir=await privateDirectory(folder(id));
      return withPrivateLock(dir,'review.lock',async()=>{
        await immutable(join(dir,'request.json'),{schema:REQUEST,request,sourceSha256,
          requestSha256:digest(encoded(request))});
        const existing=await optional(join(dir,'review.json'));
        if(existing!==null)return {...reviewView(await checkedReview(dossierId,id)),replayed:true};
        let prepared=await checkedPreparation(id,request),delivery=null;
        if(prepared===null){
          const before=await readDefinition(request.session,request.expectedSessionId);
          need(before.value.bytes>0,'PIPELINE_EMPTY_INPUT');
          need(before.value.bytes<=SERVICE_LIMITS.maxInputBytes,'PIPELINE_INPUT_SIZE_INVALID');
          need(!selectedSignal.aborted,'RESEARCH_OBJECT_REVIEW_STOPPED');
          const objectId='research-object-'+digest(encoded({workspaceId,session:request.session,
            sessionId:request.expectedSessionId}));
          let acquisition=buyer.object(objectId);
          let attached=true;
          try{await lstat(join(acquisition.directory,'object.json'));}
          catch(error){if(error.code!=='ENOENT')throw error;attached=false;}
          if(attached)await acquisition.initialize({signal:selectedSignal});
          else acquisition=await buyer.attachObject({id:objectId,directory:before.directory});
          need(!selectedSignal.aborted,'RESEARCH_OBJECT_REVIEW_STOPPED');
          delivery=await acquisition.delivery(undefined,{signal:selectedSignal,chunkLimit:1});
          const reference=researchObjectReference(delivery,{workspaceId,session:request.session});
          need(reference.sessionId===request.expectedSessionId&&reference.bytes===before.value.bytes,
            'RESEARCH_OBJECT_SESSION_CHANGED');
          const current=await readDefinition(request.session,request.expectedSessionId);
          need(current.sha256===before.sha256,'RESEARCH_OBJECT_SESSION_CHANGED');
          const nativeBytes=jsonBytes({record:delivery.report.record,process:delivery.report.process});
          need(nativeBytes.length<=8*1024*1024,'RESEARCH_OBJECT_NATIVE_RECORD_TOO_LARGE');
          // One original atomic preparation owns both the observation and its identity.
          // Reinspection timestamps never replace an earlier captured report.
          prepared={schema:PREPARATION,id,request,sourceSha256,requestSha256:digest(encoded(request)),
            reference,nativeRecord:JSON.parse(nativeBytes),nativeRecordSha256:digest(nativeBytes),capturedAt:now()};
          need(jsonBytes(prepared).length<=8*1024*1024,'RESEARCH_OBJECT_NATIVE_RECORD_TOO_LARGE');
          await immutable(join(dir,'preparation.json'),prepared);
        }
        const path=join(files,prepared.reference.sha256+'.bin');
        await withPrivateLock(files,'capture-'+prepared.reference.sha256+'.lock',async()=>{
          let exists=true;try{await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
          if(!exists){
            if(delivery===null){
              const before=await readDefinition(request.session,request.expectedSessionId);
              const objectId='research-object-'+digest(encoded({workspaceId,session:request.session,
                sessionId:request.expectedSessionId}));
              const acquisition=buyer.object(objectId);
              delivery=await acquisition.delivery(undefined,{signal:selectedSignal,chunkLimit:1});
              need(same(researchObjectReference(delivery,{workspaceId,session:request.session}),prepared.reference),
                'RESEARCH_OBJECT_REVIEW_SOURCE_CHANGED');
              need((await readDefinition(request.session,request.expectedSessionId)).sha256===before.sha256,
                'RESEARCH_OBJECT_SESSION_CHANGED');
            }
            await delivery.saveAs(path,{signal:selectedSignal});
          }
          await new CapturedObjectFile(path,prepared.reference).verify({signal:selectedSignal});
        });
        need(!selectedSignal.aborted,'RESEARCH_OBJECT_REVIEW_STOPPED');
        const payload={request:prepared.request,sourceSha256,reference:prepared.reference,
          nativeRecordSha256:prepared.nativeRecordSha256,capturedAt:prepared.capturedAt};
        const value={schema:REVIEW,id,...payload,sha256:digest(encoded(payload))};
        await immutable(join(dir,'review.json'),value);
        return {...reviewView(value),replayed:false};
      });
    },signal);
  }
  async function readReview(dossierId,id) {
    need(!closed,'RESEARCH_OBJECT_SOURCE_CLOSED');
    return reviewView(await checkedReview(dossierId,id));
  }
  async function listReviews(dossierId,{after='',limit=25} = {}) {
    need(!closed&&identifier(dossierId,160),'RESEARCH_OBJECT_DOSSIER_REQUIRED');
    need((after===''||REVIEW_ID.test(after))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,
      'RESEARCH_OBJECT_REVIEW_PAGE_INVALID');
    const names=(await readdir(reviews,{withFileTypes:true})).filter(entry=>
      entry.isDirectory()&&!entry.isSymbolicLink()&&REVIEW_ID.test(entry.name)).map(entry=>entry.name).sort();
    const all=[];
    for(const id of names){
      const value=await optional(join(folder(id),'review.json'));
      if(value?.request?.dossierId===dossierId)all.push(id);
    }
    const start=after===''?0:all.indexOf(after)+1;
    need(after===''||start>0,'RESEARCH_OBJECT_REVIEW_CURSOR_CHANGED');
    const selected=all.slice(start,start+limit),items=[];
    for(const id of selected)items.push(await readReview(dossierId,id));
    return {items,nextAfter:start+selected.length<all.length?selected.at(-1):null};
  }
  async function withFile(dossierId,{reviewId,expectedReviewSha256},work,{signal} = {}) {
    need(HEX.test(expectedReviewSha256??'')&&typeof work==='function','RESEARCH_OBJECT_REVIEW_SELECTION_REQUIRED');
    return track(selectedSignal=>withPrivateLock(folder(reviewId),'review.lock',async()=>{
      const value=await checkedReview(dossierId,reviewId);
      need(value.sha256===expectedReviewSha256,'RESEARCH_OBJECT_REVIEW_CHANGED');
      const reference=validateResearchObjectReference(value.reference);
      const path=join(files,reference.sha256+'.bin');
      await new CapturedObjectFile(path,reference).verify({signal:selectedSignal});
      need(!selectedSignal.aborted,'RESEARCH_OBJECT_REVIEW_STOPPED');
      return work({path,filename:reference.filename,contentType:reference.contentType,
        sourceRef:reference},reviewView(value));
    }),signal);
  }
  return Object.freeze({source:publicSource,list,capture,readReview,listReviews,withFile,
    async close(){
      if(closed)return;closed=true;
      for(const controller of controllers)controller.abort();
      await Promise.allSettled([...tasks]);
    }});
}
