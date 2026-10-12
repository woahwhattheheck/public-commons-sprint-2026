// MIT. Compose customer updates with the original dossier commit and verified blob store.
import {digest,jsonBytes,parseJson} from '../../node/store.mjs';
import {CUSTOMER_UPDATES_SCHEMA,CUSTOMER_UPDATE_WORK_SCHEMA,CUSTOMER_UPDATE_FORMATS,customerFields,customerIdentifier,
  customerRevision,customerText,customerUpdateInput,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateDigest,customerUpdateSame,customerUpdateRecords,customerFind,customerUpdateContext,
  customerNativeRecord} from './context.mjs';
import {buildCustomerWorkPayload,customerDeliveryDefinition,recordCustomerUpdateOperation,customerUpdatePage,
  validateCustomerUpdateHistory} from './model.mjs';
import {customerDeliveryBodies} from './reports.mjs';
const clone=value=>structuredClone(value);
const metadata=body=>({sha256:digest(body),bytes:body.length});
async function verified(readContent,description){
  const bytes=await readContent(description);
  need(Buffer.isBuffer(bytes)&&bytes.length===description.bytes&&digest(bytes)===description.sha256,'CUSTOMER_UPDATE_FILE_CHANGED');
  return bytes;
}
export async function readCustomerWorkPayload(state,workId,readContent){
  const work=customerFind(customerUpdateRecords(state).work,workId,'CUSTOMER_UPDATE_WORK_NOT_FOUND');
  const bytes=await verified(readContent,work.snapshot),value=parseJson(bytes);
  need(value.schema===CUSTOMER_UPDATE_WORK_SCHEMA&&value.workId===work.id&&value.dossierId===state.id&&
    value.projectId===work.projectId&&value.cycleId===work.cycleId&&value.sourceRevision===work.sourceRevision&&
    value.sourceRevisionSha256===work.sourceRevisionSha256&&customerUpdateDigest(value)===work.payloadSha256,
    'CUSTOMER_UPDATE_WORK_FILE_CHANGED');
  return value;
}
export async function prepareCustomerUpdateContext(state,projected,input,readContent){
  customerFields(input,['projectId','cycleId','requestEditionId','selection'],'CUSTOMER_UPDATE_PREVIEW_FIELDS_INVALID');
  for(const key of ['projectId','cycleId','requestEditionId'])customerIdentifier(input[key]);
  const rows=customerUpdateRecords(state);
  const requested=customerFind(rows.requests,input.requestEditionId,'CUSTOMER_UPDATE_REQUEST_EDITION_NOT_FOUND');
  let baseline=null;
  if(requested.definition.previousDeliveryId){
    const delivery=customerFind(rows.deliveries,requested.definition.previousDeliveryId,'CUSTOMER_UPDATE_BASELINE_NOT_FOUND');
    baseline=await readCustomerWorkPayload(state,delivery.workId,readContent);
  }
  return customerUpdateContext(state,projected,input,baseline);
}
export async function prepareCustomerUpdateOperation(state,projected,input,createdAt,readContent){
  const request=customerUpdateInput(input),data=request.data,files=[];
  if(request.action==='review-work'){
    const context=await prepareCustomerUpdateContext(state,projected,
      {projectId:data.projectId,cycleId:data.cycleId,requestEditionId:data.requestEditionId,selection:data.selection},readContent);
    const workPayload=buildCustomerWorkPayload(state,request,createdAt,context),body=jsonBytes(workPayload),workFile=metadata(body);
    need(body.length<=64*1024*1024,'CUSTOMER_UPDATE_WORK_SIZE_LIMIT');
    files.push({metadata:workFile,body});
    return {context,workPayload,workFile,files};
  }
  if(request.action==='publish-delivery'){
    const workPayload=await readCustomerWorkPayload(state,data.workId,readContent);
    const deliveryDefinition=customerDeliveryDefinition(state,request,createdAt,workPayload);
    const deliveryFiles=customerDeliveryBodies(deliveryDefinition,workPayload).map(file=>{
      need(file.body.length<=64*1024*1024,'CUSTOMER_UPDATE_REPORT_SIZE_LIMIT');
      const selected={format:file.format,name:file.name,contentType:file.contentType,...metadata(file.body)};
      files.push({metadata:{sha256:selected.sha256,bytes:selected.bytes},body:file.body});return selected;
    });
    return {workPayload,deliveryDefinition,deliveryFiles,files};
  }
  return {files};
}
export async function validateCustomerUpdateTransition(previous,state,projected,readContent){
  const added=validateCustomerUpdateHistory(previous,state);
  if(!added.length)return;
  need(previous&&projected instanceof Map&&typeof readContent==='function','PORTABLE_CUSTOMER_UPDATE_SOURCE_REQUIRED');
  const event=added[0],prepared=await prepareCustomerUpdateOperation(previous,projected,event.request,event.createdAt,readContent);
  for(const file of prepared.files){
    const actual=await verified(readContent,file.metadata);
    need(actual.equals(file.body),'PORTABLE_CUSTOMER_UPDATE_FILE_CHANGED');
  }
  const replay=clone(previous);
  recordCustomerUpdateOperation(replay,projected,event.request,event.createdAt,prepared);
  const content=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['revision','previous','updatedAt','change'].includes(key)));
  need(customerUpdateSame(content(replay),content(state)),'PORTABLE_CUSTOMER_UPDATE_TRANSITION_CHANGED');
}
function contextPage(context,{section='overview',offset=0,limit=30}={}){
  need(['overview','changes','sources','records','intakes','editions','uncovered-plans'].includes(section),'CUSTOMER_UPDATE_PREVIEW_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'RESEARCH_PAGE_INVALID');
  const result={schema:'sf88-research-customer-update-preview/v1',dossierId:context.dossierId,revision:context.revision,
    revisionSha256:context.revisionSha256,fingerprint:context.fingerprint,section,project:clone(context.project),
    brief:clone(context.brief),requested:clone(context.requested),baseline:clone(context.baseline),
    counts:clone(context.inventory.counts),changeCounts:clone(context.comparison.counts),
    recordCount:context.nativeRecords.length,uncoveredPlanCount:context.uncoveredPlans.length,currentBriefId:context.currentBriefId};
  if(section==='overview')return result;
  const rows={changes:context.comparison.rows,sources:context.inventory.sources,records:context.nativeRecords,
    intakes:context.intakes,editions:context.inventory.editions,'uncovered-plans':context.uncoveredPlans}[section];
  need(offset<=rows.length,'RESEARCH_PAGE_INVALID');
  const items=clone(rows.slice(offset,offset+limit)),nextOffset=offset+items.length<rows.length?offset+items.length:null;
  return {...result,offset,limit,total:rows.length,items,nextOffset,complete:nextOffset===null,
    next:nextOffset===null?null:{revision:context.revision,fingerprint:context.fingerprint,offset:nextOffset,limit}};
}
export function createCustomerUpdateStore({head,commit,metadata:originalMetadata,get,projections,blob,putBlob,exportStream}){
  for(const [name,method]of Object.entries({head,commit,originalMetadata,get,projections,blob,putBlob,exportStream}))
    need(typeof method==='function','CUSTOMER_UPDATE_NATIVE_'+name.toUpperCase()+'_REQUIRED');
  async function customerUpdates(id,options={}){
    const input=clone(options),{revision,...selection}=input;
    need((selection.offset??0)===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    if(revision!==undefined)customerRevision(revision);
    const {state}=await head(id,revision);return customerUpdatePage(state,selection);
  }
  async function customerUpdateRecord(id,{revision,path,sha256,label}={}){
    if(revision!==undefined)customerRevision(revision);
    const {state}=await head(id,revision);
    return {schema:'sf88-research-customer-update-record/v1',dossierId:id,revision:state.revision,
      ...customerNativeRecord(state,{path,sha256,...(label!==undefined?{label}:{})})};
  }
  async function previewCustomerUpdate(id,input={}){
    const selected=clone(input);
    customerFields(selected,['revision','projectId','cycleId','requestEditionId','selection','section','offset','limit','fingerprint']);
    need((selected.offset??0)===0||selected.revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    if(selected.revision!==undefined)customerRevision(selected.revision);
    const {state}=await head(id,selected.revision);
    const context=await prepareCustomerUpdateContext(state,await projections(state,{references:false}),
      {projectId:selected.projectId,cycleId:selected.cycleId,requestEditionId:selected.requestEditionId,selection:selected.selection},blob);
    need(selected.fingerprint===undefined||selected.fingerprint===context.fingerprint,'CUSTOMER_UPDATE_CONTEXT_CHANGED');
    return contextPage(context,selected);
  }
  async function customerUpdateWork(id,{revision,workId,section='overview',offset=0,limit=30}={}){
    if(revision!==undefined)customerRevision(revision);
    const {state}=await head(id,revision),payload=await readCustomerWorkPayload(state,customerIdentifier(workId),blob);
    return {...contextPage(payload.context,{section,offset,limit}),schema:'sf88-research-customer-update-saved-work/v1',
      workspaceRevision:state.revision,workId:payload.workId,createdAt:payload.createdAt,actor:payload.actor,review:payload.review};
  }
  async function reviewCustomerUpdate(id,{projection='metadata',...input}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=customerUpdateInput(input),requestSha256=customerUpdateDigest(request);
    async function recovered(state){
      const existing=(state.customerUpdateEvents??[]).find(event=>event.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'CUSTOMER_UPDATE_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?originalMetadata(state):await get(id),
        operation:clone(existing),duplicate:true};
    }
    const previous=await recovered((await head(id)).state);if(previous)return previous;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Customer update: '+request.action,async(state,original)=>{
        const projected=await projections(original,{references:false}),createdAt=new Date().toISOString();
        const prepared=await prepareCustomerUpdateOperation(original,projected,request,createdAt,blob);
        // Original content-addressed bytes are durable before their one immutable
        // dossier revision. A lost reply reuses that original request first.
        for(const file of prepared.files){
          const saved=await putBlob(file.body);
          need(customerUpdateSame(saved,file.metadata),'CUSTOMER_UPDATE_FILE_CHANGED');
        }
        operation=recordCustomerUpdateOperation(state,projected,request,createdAt,prepared);
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }
  async function exportCustomerUpdate(id,{revision,deliveryId,workId,format='json'}={}){
    need((deliveryId!==undefined)!==(workId!==undefined),'CUSTOMER_UPDATE_EXPORT_SELECTION_REQUIRED');
    if(revision!==undefined)customerRevision(revision);
    const {state}=await head(id,revision),rows=customerUpdateRecords(state);
    if(workId!==undefined){
      need(format==='json','CUSTOMER_UPDATE_WORK_EXPORT_FORMAT_INVALID');
      const work=customerFind(rows.work,customerIdentifier(workId),'CUSTOMER_UPDATE_WORK_NOT_FOUND');
      return {filename:work.id+'.review.json',contentType:'application/json; charset=utf-8',
        revision:work.revision,body:await verified(blob,work.snapshot),sha256:work.snapshot.sha256,bytes:work.snapshot.bytes};
    }
    const delivery=customerFind(rows.deliveries,customerIdentifier(deliveryId),'CUSTOMER_UPDATE_DELIVERY_NOT_FOUND');
    if(format==='portable'||format==='portable.gz'){
      const exported=await exportStream(id,{revision:delivery.revision,compression:format==='portable.gz'?'gzip':'none'});
      return {...exported,deliveryId:delivery.id};
    }
    need(CUSTOMER_UPDATE_FORMATS.includes(format),'CUSTOMER_UPDATE_EXPORT_FORMAT_INVALID');
    const file=delivery.files.find(row=>row.format===format);
    need(file,'CUSTOMER_UPDATE_DELIVERY_FILE_MISSING');
    return {filename:file.name,contentType:file.contentType,revision:delivery.revision,body:await verified(blob,file),
      sha256:file.sha256,bytes:file.bytes,deliveryId:delivery.id};
  }
  return Object.freeze({customerUpdates,customerUpdateRecord,previewCustomerUpdate,customerUpdateWork,
    reviewCustomerUpdate,exportCustomerUpdate});
}
