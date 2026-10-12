// MIT. Retained Crossref acquisition and explicit receiving in the original research workspace.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {privateDirectory,readJson,readBytes,writeJson,writeBytes,jsonBytes,parseJson,digest,need,object,now,safeCode} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {requestFor} from '../../sf30-seller-sdk/crossref/metadata.mjs';
import {collectCrossrefEdition,selectedCrossrefDois,compareCrossrefMetadata,validateCrossrefEdition,receiveCrossrefEdition} from './crossref.mjs';

const PLAN='stellar-forge.crossref-workspace-plan.v1',STATE='stellar-forge.crossref-workspace-operation.v1';
const LIMIT=64*1024*1024,phases=new Set(['PREPARED','RUNNING','READY','STOPPED','FAILED','IMPORTED']);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const idValue=value=>{need(typeof value==='string'&&/^cr_[a-f0-9]{64}$/.test(value),'CROSSREF_OPERATION_ID_INVALID');return value;};
function revision(value){need(Number.isSafeInteger(value)&&value>=0,'EXPECTED_REVISION_REQUIRED');return value;}
function canonicalRequest(data,dossierId){
  need(object(data)&&Object.keys(data).every(key=>['requestId','questionId','expectedRevision','selectedOnly','includeUpdates','refresh','maxUpdatePages','label'].includes(key)),'CROSSREF_PLAN_FIELDS_INVALID');
  need(typeof data.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(data.requestId),'CROSSREF_REQUEST_ID_REQUIRED');
  need(typeof data.questionId==='string'&&data.questionId.length>0&&data.questionId.length<=160,'QUESTION_NOT_FOUND');
  const request={requestId:data.requestId,dossierId,questionId:data.questionId,expectedRevision:revision(data.expectedRevision),
    selectedOnly:data.selectedOnly??true,includeUpdates:data.includeUpdates??true,refresh:data.refresh??false,
    maxUpdatePages:data.maxUpdatePages??1000,label:data.label??'Crossref DOI enrichment'};
  need(['selectedOnly','includeUpdates','refresh'].every(key=>typeof request[key]==='boolean'),'CROSSREF_PLAN_OPTIONS_INVALID');
  need(Number.isSafeInteger(request.maxUpdatePages)&&request.maxUpdatePages>=1&&request.maxUpdatePages<=10000,'CROSSREF_UPDATE_PAGE_LIMIT_INVALID');
  need(typeof request.label==='string'&&request.label.trim().length>0&&request.label.length<=200,'CROSSREF_LABEL_INVALID');
  return request;
}
function operationRecord(id,phase='PREPARED'){
  return {schema:STATE,id,phase,sequence:0,startedAt:null,updatedAt:now(),responses:0,
    lastCapture:null,error:null,editionSha256:null,editionBytes:null,received:null,pendingReceive:null};
}
function checkedState(value,id){
  need(object(value)&&value.schema===STATE&&value.id===id&&phases.has(value.phase)&&Number.isSafeInteger(value.sequence)&&value.sequence>=0&&
    Number.isSafeInteger(value.responses)&&value.responses>=0&&value.responses<=2000,'CROSSREF_OPERATION_CHANGED');
  return value;
}
/** Source configuration is fixed by the local launcher; browser input selects research scope only. */
export async function openCrossrefWorkspace({directory,dossiers,source,identity}={}){
  need(dossiers&&typeof dossiers.get==='function'&&typeof dossiers.receive==='function','DOSSIER_STORE_REQUIRED');
  need(source&&['request','readCapture','snapshot'].every(key=>typeof source[key]==='function'),'CROSSREF_SOURCE_REQUIRED');
  need(object(identity)&&typeof identity.account==='string'&&['public','polite'].includes(identity.mode)&&
    /^[a-f0-9]{64}$/.test(identity.configSha256??''),'CROSSREF_SOURCE_IDENTITY_REQUIRED');
  identity={account:identity.account,mode:identity.mode,configSha256:identity.configSha256};
  directory=await privateDirectory(directory);
  const operations=await privateDirectory(join(directory,'operations'));
  const active=new Map();let closed=false;
  const folder=id=>join(operations,idValue(id));
  const metadata=(id,options)=>typeof dossiers.getMetadata==='function'?dossiers.getMetadata(id,options):dossiers.get(id,options);
  const fullView=(id,value)=>Array.isArray(value.sources)?value:dossiers.get(id,{revision:value.revision});
  async function plan(id){
    const value=await readJson(join(folder(id),'plan.json'),1024*1024);
    need(value.schema===PLAN&&value.id===id&&object(value.request)&&object(value.payload)&&
      digest(jsonBytes(value.payload))===value.sha256&&
      'cr_'+digest(jsonBytes({requestId:value.request.requestId,dossierId:value.request.dossierId}))===id,'CROSSREF_PLAN_CHANGED');
    need(same(value.request,value.payload.request),'CROSSREF_PLAN_CHANGED');
    return value;
  }
  async function state(id){
    try{return checkedState(await readJson(join(folder(id),'state.json'),1024*1024),id);}
    catch(error){if(error.code==='ENOENT'){await plan(id);return operationRecord(id);}throw error;}
  }
  async function save(id,value){
    value={...value,sequence:value.sequence+1,updatedAt:now()};
    checkedState(value,id);await writeJson(join(folder(id),'state.json'),value);return value;
  }
  async function references(id){
    const path=join(folder(id),'captures'),names=await readdir(path);
    const refs=[];
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort()){
      const ref=await readJson(join(path,name),32768);
      need(object(ref)&&typeof ref.captureId==='string'&&/^[a-f0-9]{64}$/.test(ref.captureId)&&
        typeof ref.url==='string'&&name===digest(Buffer.from(ref.url))+'.json','CROSSREF_CAPTURE_REFERENCE_CHANGED');
      const capture=await source.readCapture(ref.captureId);
      need(capture.url===ref.url&&capture.bodySha256===ref.bodySha256&&capture.status===ref.status,'CROSSREF_CAPTURE_REFERENCE_CHANGED');
      refs.push({ref,capture});
    }
    need(refs.length<=2000,'CROSSREF_ACQUISITION_REQUEST_LIMIT');
    return refs;
  }
  async function isRunning(id){
    if(active.has(id))return true;
    try{await withPrivateLock(folder(id),'operation.lock',async()=>{});return false;}
    catch(error){if(error.code==='ROUTESCAN_RECORD_BUSY')return true;throw error;}
  }
  async function inspect(id,{probe=true}={}){
    const [selected,current]=await Promise.all([plan(id),state(id)]);
    const running=current.phase==='RUNNING'&&(probe?await isRunning(id):true);
    return {plan:selected,operation:current,running,interrupted:current.phase==='RUNNING'&&!running,
      sourceMatches:same(selected.payload.source,identity)};
  }
  async function prepare(dossierId,input){
    need(!closed,'CROSSREF_WORKSPACE_CLOSED');
    const request=canonicalRequest(input,dossierId);
    const id='cr_'+digest(jsonBytes({requestId:request.requestId,dossierId}));
    const path=await privateDirectory(folder(id));
    return withPrivateLock(path,'operation.lock',async()=>{
      try{
        const existing=await plan(id);
        need(same(existing.request,request),'CROSSREF_REQUEST_ID_REUSED');
        return {plan:existing,operation:await state(id),running:false,interrupted:false,sourceMatches:same(existing.payload.source,identity)};
      }catch(error){if(error.code!=='ENOENT')throw error;}
      const before=await dossiers.get(dossierId);
      need(before.revision===request.expectedRevision,'REVISION_CONFLICT');
      const question=before.questions.find(row=>row.id===request.questionId);need(question,'QUESTION_NOT_FOUND');
      const dois=selectedCrossrefDois(before,{questionId:question.id,selectedOnly:request.selectedOnly});
      if(request.includeUpdates)for(const doi of dois)requestFor('updates',{doi});
      const payload={request,source:{...identity},question:question.text,dois,
        metadataRequests:dois.length,minimumUpdateRequests:request.includeUpdates?dois.length:0,
        maximumRequests:2000,sourceTerms:'https://www.crossref.org/documentation/retrieve-metadata/rest-api/'};
      const selected={schema:PLAN,id,preparedAt:now(),request,payload,sha256:digest(jsonBytes(payload))};
      await privateDirectory(join(path,'captures'));
      await writeJson(join(path,'plan.json'),selected,{exclusive:true});
      const current=await save(id,operationRecord(id));
      return {plan:selected,operation:current,running:false,interrupted:false,sourceMatches:true};
    });
  }
  async function collect(id,selected,controller,ready){
    return withPrivateLock(folder(id),'operation.lock',async()=>{
      let current=await state(id);
      if(['READY','IMPORTED'].includes(current.phase)){ready.resolve();return;}
      need(same(selected.payload.source,identity),'CROSSREF_SOURCE_CONFIGURATION_CHANGED');
      const retained=await references(id),byUrl=new Map(retained.map(row=>[row.capture.url,row]));
      current=await save(id,{...current,phase:'RUNNING',startedAt:current.startedAt??now(),error:null,responses:retained.length});
      ready.resolve();
      try{
        const resumed={
          async request(kind,input,options){
            const target=requestFor(kind,input),saved=byUrl.get(target.url);
            if(saved)return {capture:saved.capture,captureId:saved.ref.captureId,cached:true,resumed:true};
            return source.request(kind,input,options);
          }
        };
        const result=await collectCrossrefEdition({source:resumed,dois:selected.payload.dois,query:selected.payload.question,
          label:selected.request.label,includeUpdates:selected.request.includeUpdates,maxUpdatePages:selected.request.maxUpdatePages,
          refresh:selected.request.refresh,signal:controller.signal,
          async onCapture(receipt){
            const capture=await source.readCapture(receipt.captureId),url=capture.url;
            const ref={captureId:receipt.captureId,url,bodySha256:capture.bodySha256,status:capture.status,cached:receipt.cached,
              recordedAt:now(),request:capture.request};
            const existing=byUrl.get(url);
            if(existing)need(existing.ref.captureId===receipt.captureId,'CROSSREF_CAPTURE_REFERENCE_CHANGED');
            else{
              await writeJson(join(folder(id),'captures',digest(Buffer.from(url))+'.json'),ref,{exclusive:true});
              byUrl.set(url,{ref,capture});
            }
            current=await save(id,{...current,responses:byUrl.size,lastCapture:{captureId:ref.captureId,url,status:ref.status,cached:ref.cached}});
          }});
        validateCrossrefEdition(result.envelope);
        const bytes=jsonBytes(result.envelope);need(bytes.length<=LIMIT,'RESEARCH_RESPONSE_TOO_LARGE');
        const sha256=digest(bytes);
        try{await writeBytes(join(folder(id),'edition.json'),bytes,{exclusive:true});}
        catch(error){
          if(error.code!=='EEXIST')throw error;
          need(digest(await readBytes(join(folder(id),'edition.json'),LIMIT))===sha256,'CROSSREF_REVIEWED_EDITION_CHANGED');
        }
        current=await save(id,{...current,phase:'READY',error:null,editionSha256:sha256,editionBytes:bytes.length});
      }catch(error){
        current=await save(id,{...current,phase:controller.signal.aborted?'STOPPED':'FAILED',
          error:controller.signal.aborted?'CROSSREF_ACQUISITION_STOPPED':safeCode(error.code,'CROSSREF_ACQUISITION_FAILED')});
      }
    });
  }
  async function start(id,{expectedPlanSha256}={}){
    need(!closed,'CROSSREF_WORKSPACE_CLOSED');
    const selected=await plan(id);need(selected.sha256===expectedPlanSha256,'CROSSREF_PLAN_CHANGED');
    if(active.has(id))return inspect(id);
    const current=await state(id);
    if(['READY','IMPORTED'].includes(current.phase))return inspect(id);
    let accept,reject;
    const started=new Promise((resolve,rejectPromise)=>{accept=resolve;reject=rejectPromise;});
    const controller=new AbortController(),entry={controller,promise:null};active.set(id,entry);
    entry.promise=collect(id,selected,controller,{resolve:accept}).catch(error=>{reject(error);throw error;})
      .finally(()=>active.delete(id));
    entry.promise.catch(()=>{});
    await started;return inspect(id);
  }
  async function stop(id){
    await plan(id);
    const entry=active.get(id);
    if(entry){entry.controller.abort();await entry.promise;}
    else need(!await isRunning(id),'CROSSREF_OPERATION_RUNNING_ELSEWHERE');
    return inspect(id);
  }
  async function edition(id){
    const current=await state(id);
    need(['READY','IMPORTED'].includes(current.phase),'CROSSREF_EDITION_NOT_READY');
    const bytes=await readBytes(join(folder(id),'edition.json'),LIMIT);
    need(bytes.length===current.editionBytes&&digest(bytes)===current.editionSha256,'CROSSREF_REVIEWED_EDITION_CHANGED');
    return {bytes,value:validateCrossrefEdition(parseJson(bytes))};
  }
  async function review(id){
    const selected=await inspect(id),current=selected.operation;
    if(!['READY','IMPORTED'].includes(current.phase))return {...selected,currentRevision:null,questionMatches:null,review:null};
    const before=await dossiers.get(selected.plan.request.dossierId);
    const question=before.questions.find(row=>row.id===selected.plan.request.questionId);
    const {value}=await edition(id);
    const incoming=new Map(value.results.map(row=>[row.doi,row])),seen=new Set();
    const projected=before.sources.map(row=>{
      let doi;try{doi=requestFor('work',{doi:row.doi}).doi;}catch{return row;}
      seen.add(doi);return incoming.has(doi)?{...incoming.get(doi),id:row.id}:row;
    });
    projected.push(...value.results.filter(row=>!seen.has(row.doi)));
    const after={revision:before.revision,sources:projected};
    return {...selected,currentRevision:before.revision,questionMatches:question?.text===selected.plan.payload.question,
      review:{coverage:value.usage.coverage,usage:value.usage,warnings:value.warnings,
        comparison:compareCrossrefMetadata(before,after,{dois:selected.plan.payload.dois}),
        records:value.results.map(row=>({doi:row.doi,title:row.title,authors:row.authors,dates:row.metadata.dates,
          funders:row.metadata.crossref.funder??[],licenses:row.metadata.crossref.license??[],
          relations:row.metadata.crossref.relation??{},referenceCount:row.metadata.crossref['reference-count']??null,
          sourceOccurrences:row.metadata.sourceOccurrences}))}};
  }
  async function receive(id,{expectedRevision,expectedPlanSha256,expectedEditionSha256}={}){
    const path=folder(id);
    return withPrivateLock(path,'operation.lock',async()=>{
      const selected=await plan(id),current=await state(id);
      need(selected.sha256===expectedPlanSha256,'CROSSREF_PLAN_CHANGED');
      need(current.editionSha256===expectedEditionSha256,'CROSSREF_REVIEWED_EDITION_CHANGED');
      const before=await metadata(selected.request.dossierId);
      if(current.phase==='IMPORTED'){
        need(before.editions.some(row=>row.questionId===selected.request.questionId&&row.raw?.sha256===current.editionSha256),
          'CROSSREF_RECEIVED_EDITION_MISSING');
        return {operation:current,receipt:current.received,dossier:await fullView(selected.request.dossierId,before)};
      }
      const pending=current.pendingReceive;
      const retained=before.editions.find(row=>row.questionId===selected.request.questionId&&row.raw?.sha256===current.editionSha256&&
        (row.origin?.operationId===id||pending?.duplicateEditionId===row.id));
      if(retained&&pending){
        revision(pending.expectedRevision);
        const duplicate=pending.duplicateEditionId===retained.id;
        const receivedRevision=pending.expectedRevision+(duplicate?0:1);
        const original=before.revision===receivedRevision?before:await metadata(selected.request.dossierId,{revision:receivedRevision});
        need(original.editions.some(row=>row.id===retained.id&&row.raw?.sha256===current.editionSha256&&
          (duplicate||row.origin?.operationId===id)),'CROSSREF_RECEIVE_RECONCILIATION_FAILED');
        const {value}=await edition(id);
        const receipt={dossierId:selected.request.dossierId,questionId:selected.request.questionId,
          originalRevision:pending.expectedRevision,revision:receivedRevision,duplicate,
          sourceSha256:current.editionSha256,coverage:value.usage.coverage,metadataRecords:value.results.length,
          receivedAt:pending.startedAt,reconciled:true};
        const saved=await save(id,{...current,phase:'IMPORTED',error:null,received:receipt,pendingReceive:null});
        return {operation:saved,receipt,dossier:await fullView(selected.request.dossierId,before)};
      }
      need(before.revision===revision(expectedRevision),'REVISION_CONFLICT');
      const question=before.questions.find(row=>row.id===selected.request.questionId);
      need(question?.text===selected.payload.question,'CROSSREF_QUESTION_CHANGED');
      const {value}=await edition(id);
      const already=before.editions.find(row=>row.questionId===selected.request.questionId&&row.raw?.sha256===current.editionSha256);
      const pendingState=await save(id,{...current,pendingReceive:{expectedRevision,duplicateEditionId:already?.id??null,startedAt:now()}});
      const imported=await receiveCrossrefEdition(dossiers,selected.request.dossierId,{
        questionId:selected.request.questionId,label:selected.request.label,captures:value.originalResponses,
        dois:selected.payload.dois,expectedRevision,acquisition:value.usage.acquisition,
        sourceReference:selected.payload.sourceTerms,
        origin:{mode:'CROSSREF_RESEARCH_WORKSPACE',operationId:id,planSha256:selected.sha256}});
      const receipt={dossierId:imported.dossierId,questionId:imported.questionId,originalRevision:imported.originalRevision,
        revision:imported.revision,duplicate:imported.duplicate,sourceSha256:imported.sourceSha256,coverage:imported.coverage,
        metadataRecords:imported.metadataRecords,receivedAt:now()};
      need(receipt.sourceSha256===current.editionSha256,'CROSSREF_RECEIVED_EDITION_CHANGED');
      const saved=await save(id,{...pendingState,phase:'IMPORTED',error:null,received:receipt,pendingReceive:null});
      return {operation:saved,receipt,dossier:imported.dossier};
    });
  }
  async function list(dossierId,{after='',limit=30}={}){
    need(typeof after==='string'&&(after===''||/^cr_[a-f0-9]{64}$/.test(after))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'CROSSREF_OPERATION_PAGE_INVALID');
    const names=(await readdir(operations)).filter(name=>/^cr_[a-f0-9]{64}$/.test(name)&&name>after).sort();
    const items=[];let last=after,more=false;
    for(const id of names){
      const selected=await plan(id);
      if(selected.request.dossierId!==dossierId)continue;
      if(items.length===limit){more=true;break;}
      items.push({plan:selected,operation:await state(id)});last=id;
    }
    return {items,next:more?last:null};
  }
  return {prepare,start,stop,inspect,review,receive,list,edition,
    async snapshot(){return {configured:true,identity:{...identity},source:await source.snapshot(),activeOperations:[...active.keys()]};},
    async close(){if(closed)return;closed=true;for(const entry of active.values())entry.controller.abort();
      await Promise.allSettled([...active.values()].map(entry=>entry.promise));}};
}
