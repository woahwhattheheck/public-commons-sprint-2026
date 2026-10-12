// MIT. Append-only customer brief, requested update, review and delivery editions.
import {digest,jsonBytes} from '../../node/store.mjs';
import {validateCustomerEuropePmcIntake} from './source-plans.mjs';
import {CUSTOMER_UPDATES_SCHEMA,CUSTOMER_UPDATE_OPERATION_SCHEMA,CUSTOMER_UPDATE_WORK_SCHEMA,
  CUSTOMER_UPDATE_SECTIONS,CUSTOMER_UPDATE_FORMATS,customerFields,customerText,customerIdentifier,customerHash,
  customerIds,customerList,customerActor,customerTime,customerBrief,customerRequestedUpdate,customerWorkSelection,
  customerOriginalHandle,customerUpdateInput,customerJson,customerObject,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateDigest,customerUpdateSame,customerUpdateRecords,customerCurrentRequests,customerCurrentBriefs,
  customerFind,customerNativeRecordCatalog} from './context.mjs';
const clone=value=>structuredClone(value),array=value=>Array.isArray(value)?value:[];
export const customerUpdateEntity=(prefix,state,request)=>prefix+'_'+customerUpdateDigest({dossierId:state.id,requestId:request.requestId});
function projectFor(rows,data){return customerFind(rows.projects,customerIdentifier(data.projectId),'CUSTOMER_UPDATE_PROJECT_NOT_FOUND');}
function fileMetadata(value){
  customerFields(value,['sha256','bytes'],'CUSTOMER_UPDATE_FILE_INVALID');
  customerHash(value.sha256);need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=64*1024*1024,'CUSTOMER_UPDATE_FILE_SIZE_INVALID');
  return {sha256:value.sha256,bytes:value.bytes};
}
export function customerUpdateBlobMetadata(state){
  const found=new Map();
  for(const event of state.customerUpdateEvents??[]){
    const files=[...(event.result?.work?[event.result.work.snapshot]:[]),...array(event.result?.delivery?.files).map(file=>({sha256:file.sha256,bytes:file.bytes}))];
    for(const value of files){
      const metadata=fileMetadata(value),old=found.get(metadata.sha256);
      need(!old||old.bytes===metadata.bytes,'CUSTOMER_UPDATE_FILE_CONFLICT');found.set(metadata.sha256,metadata);
    }
  }
  return [...found.values()];
}
function requestedDefinition(state,rows,projectId,input){
  const definition=customerRequestedUpdate(input),brief=customerFind(rows.briefs,definition.briefId,'CUSTOMER_UPDATE_BRIEF_NOT_FOUND');
  need(brief.projectId===projectId,'CUSTOMER_UPDATE_BRIEF_PROJECT_CHANGED');
  need(definition.periods.length===brief.definition.sourcePlans.length&&
    definition.periods.every(period=>brief.definition.sourcePlans.some(plan=>plan.id===period.planId)),
    'CUSTOMER_UPDATE_SOURCE_PERIOD_REQUIRED');
  if(definition.kind==='BASELINE')need(definition.previousDeliveryId===null,'CUSTOMER_UPDATE_BASELINE_PARENT_INVALID');
  else{
    const previous=customerFind(rows.deliveries,definition.previousDeliveryId,'CUSTOMER_UPDATE_PREVIOUS_DELIVERY_REQUIRED');
    need(previous.projectId===projectId,'CUSTOMER_UPDATE_PREVIOUS_PROJECT_CHANGED');
  }
  need(brief.definition.questionIds.every(id=>state.questions.some(question=>question.id===id)),'QUESTION_NOT_FOUND');
  return definition;
}
export function customerReviewDefinition(data,context){
  customerFields(data,['projectId','cycleId','requestEditionId','selection','fingerprint','summary','limitations',
    'changeDecisions','acceptance','note'],'CUSTOMER_UPDATE_WORK_FIELDS_INVALID');
  need(customerHash(data.fingerprint)===context.fingerprint,'CUSTOMER_UPDATE_CONTEXT_CHANGED');
  const changeDecisions=customerList(data.changeDecisions??[],'CUSTOMER_UPDATE_CHANGE_DECISIONS_INVALID',25000).map(row=>{
    customerFields(row,['sourceId','fingerprint','disposition','reason']);
    const source=customerFind(context.comparison.rows,customerIdentifier(row.sourceId),'CUSTOMER_UPDATE_CHANGE_NOT_FOUND');
    need(source.status!=='UNCHANGED'&&source.fingerprint===customerHash(row.fingerprint),'CUSTOMER_UPDATE_CHANGE_CHANGED');
    need(['reviewed','needs_review','not_applicable'].includes(row.disposition),'CUSTOMER_UPDATE_CHANGE_DISPOSITION_INVALID');
    return {sourceId:source.id,fingerprint:row.fingerprint,disposition:row.disposition,
      reason:customerText(row.reason,'CUSTOMER_UPDATE_CHANGE_REASON_REQUIRED',20000)};
  });
  need(new Set(changeDecisions.map(row=>row.sourceId)).size===changeDecisions.length,'CUSTOMER_UPDATE_CHANGE_DUPLICATE');
  const acceptance=customerList(data.acceptance,'CUSTOMER_UPDATE_ACCEPTANCE_REQUIRED',100).map(row=>{
    customerFields(row,['outputId','status','note']);
    customerFind(context.brief.definition.outputs,customerIdentifier(row.outputId),'CUSTOMER_UPDATE_OUTPUT_NOT_FOUND');
    need(['met','partly_met','not_met','not_applicable','not_reviewed'].includes(row.status),'CUSTOMER_UPDATE_ACCEPTANCE_STATUS_INVALID');
    return {outputId:row.outputId,status:row.status,note:customerText(row.note??'','CUSTOMER_UPDATE_ACCEPTANCE_NOTE_INVALID',20000,true)};
  });
  need(acceptance.length===context.brief.definition.outputs.length&&
    new Set(acceptance.map(row=>row.outputId)).size===acceptance.length,'CUSTOMER_UPDATE_ACCEPTANCE_INCOMPLETE');
  return {summary:customerText(data.summary,'CUSTOMER_UPDATE_SUMMARY_REQUIRED',100000),
    limitations:customerText(data.limitations??'','CUSTOMER_UPDATE_LIMITATIONS_INVALID',100000,true),
    changeDecisions,acceptance,note:customerText(data.note??'','CUSTOMER_UPDATE_REVIEW_NOTE_INVALID',100000,true)};
}
export function buildCustomerWorkPayload(state,input,createdAt,context){
  const request=customerUpdateInput(input);
  need(request.action==='review-work'&&request.expectedRevision===state.revision&&context.revision===state.revision&&
    context.revisionSha256===digest(jsonBytes(state)),'CUSTOMER_UPDATE_CONTEXT_CHANGED');
  const review=customerReviewDefinition(request.data,context);
  return {schema:CUSTOMER_UPDATE_WORK_SCHEMA,workId:customerUpdateEntity('cuw',state,request),dossierId:state.id,
    projectId:context.project.id,cycleId:context.requested.cycleId,requestEditionId:context.requested.id,
    sourceRevision:state.revision,sourceRevisionSha256:context.revisionSha256,createdAt:customerTime(createdAt),
    actor:clone(request.actor),context:clone(context),review};
}
export function customerDeliveryDefinition(state,input,createdAt,workPayload){
  const request=customerUpdateInput(input),data=request.data,rows=customerUpdateRecords(state);
  customerFields(data,['projectId','workId','expectedWorkSha256','title','coverNote','deliveryNote'],'CUSTOMER_UPDATE_DELIVERY_FIELDS_INVALID');
  const project=projectFor(rows,data),work=customerFind(rows.work,customerIdentifier(data.workId),'CUSTOMER_UPDATE_WORK_NOT_FOUND');
  need(work.projectId===project.id&&work.sha256===customerHash(data.expectedWorkSha256),'CUSTOMER_UPDATE_WORK_CHANGED');
  need(workPayload?.workId===work.id&&customerUpdateDigest(workPayload)===work.payloadSha256,'CUSTOMER_UPDATE_WORK_FILE_CHANGED');
  return {id:customerUpdateEntity('cud',state,request),projectId:project.id,cycleId:work.cycleId,
    workId:work.id,workSha256:work.sha256,sourceRevision:work.sourceRevision,requestEditionId:work.requestEditionId,
    title:customerText(data.title,'CUSTOMER_UPDATE_DELIVERY_TITLE_REQUIRED',240),
    coverNote:customerText(data.coverNote??'','CUSTOMER_UPDATE_COVER_NOTE_INVALID',100000,true),
    deliveryNote:customerText(data.deliveryNote??'','CUSTOMER_UPDATE_DELIVERY_NOTE_INVALID',100000,true),
    createdAt:customerTime(createdAt),actor:clone(request.actor),revision:state.revision+1};
}
export function recordCustomerUpdateOperation(state,projected,input,createdAt,prepared={}){
  const request=customerUpdateInput(input),data=request.data,rows=customerUpdateRecords(state);
  need(request.expectedRevision===state.revision,'REVISION_CONFLICT');
  need(!rows.operations.some(row=>row.requestId===request.requestId),'CUSTOMER_UPDATE_REQUEST_ALREADY_SAVED');
  customerTime(createdAt);
  const id=prefix=>customerUpdateEntity(prefix,state,request),base={createdAt,actor:clone(request.actor),revision:state.revision+1};
  const result={};let project;
  switch(request.action){
    case 'create-project':{
      customerFields(data,['brief'],'CUSTOMER_UPDATE_CREATE_FIELDS_INVALID');
      const definition=customerBrief(data.brief);
      need(definition.questionIds.every(key=>state.questions.some(row=>row.id===key)),'QUESTION_NOT_FOUND');
      project={id:id('cup'),name:definition.name,customer:clone(definition.customer),...base};
      result.project=project;
      result.brief={id:id('cub'),projectId:project.id,edition:1,definition,reason:'Initial customer brief',...base};break;
    }
    case 'revise-brief':{
      customerFields(data,['projectId','expectedBriefId','brief','reason']);
      project=projectFor(rows,data);
      const current=customerCurrentBriefs(rows).find(row=>row.projectId===project.id);
      need(current?.id===customerIdentifier(data.expectedBriefId),'CUSTOMER_UPDATE_BRIEF_CHANGED');
      const definition=customerBrief(data.brief);
      need(definition.customer.id===project.customer.id,'CUSTOMER_UPDATE_CUSTOMER_ID_CHANGED');
      need(definition.questionIds.every(key=>state.questions.some(row=>row.id===key)),'QUESTION_NOT_FOUND');
      result.brief={id:id('cub'),projectId:project.id,edition:current.edition+1,definition,
        reason:customerText(data.reason,'CUSTOMER_UPDATE_BRIEF_REASON_REQUIRED'),...base};break;
    }
    case 'record-agreement':{
      customerFields(data,['projectId','briefId','disposition','by','occurredAt','reference','message','records']);
      project=projectFor(rows,data);
      const brief=customerFind(rows.briefs,customerIdentifier(data.briefId),'CUSTOMER_UPDATE_BRIEF_NOT_FOUND');
      need(brief.projectId===project.id,'CUSTOMER_UPDATE_BRIEF_PROJECT_CHANGED');
      need(['PROPOSED','ACCEPTED','CHANGES_REQUESTED','DECLINED'].includes(data.disposition),'CUSTOMER_UPDATE_AGREEMENT_INVALID');
      result.agreement={id:id('cua'),projectId:project.id,briefId:brief.id,disposition:data.disposition,
        by:customerActor(data.by),occurredAt:customerTime(data.occurredAt),
        reference:customerText(data.reference??'','CUSTOMER_UPDATE_AGREEMENT_REFERENCE_INVALID',4000,true),
        message:customerText(data.message,'CUSTOMER_UPDATE_AGREEMENT_MESSAGE_REQUIRED',100000),
        original:customerOriginalHandle(data.records??{}),...base};break;
    }
    case 'request-update':{
      customerFields(data,['projectId','definition']);project=projectFor(rows,data);
      const definition=requestedDefinition(state,rows,project.id,data.definition);
      result.updateRequest={id:id('cur'),cycleId:id('cuc'),projectId:project.id,edition:1,definition,
        reason:'Original requested update',...base};break;
    }
    case 'revise-request':{
      customerFields(data,['projectId','cycleId','expectedRequestEditionId','definition','reason']);project=projectFor(rows,data);
      const current=customerCurrentRequests(rows).find(row=>row.cycleId===customerIdentifier(data.cycleId));
      need(current?.projectId===project.id&&current.id===customerIdentifier(data.expectedRequestEditionId),'CUSTOMER_UPDATE_REQUEST_EDITION_CHANGED');
      const definition=requestedDefinition(state,rows,project.id,data.definition);
      result.updateRequest={id:id('cur'),cycleId:current.cycleId,projectId:project.id,edition:current.edition+1,definition,
        reason:customerText(data.reason,'CUSTOMER_UPDATE_REQUEST_REASON_REQUIRED'),...base};break;
    }
    case 'attach-intake':{
      customerFields(data,['projectId','cycleId','requestEditionId','planId','editionIds','original','note']);
      project=projectFor(rows,data);
      const requested=customerFind(rows.requests,customerIdentifier(data.requestEditionId),'CUSTOMER_UPDATE_REQUEST_EDITION_NOT_FOUND');
      need(requested.projectId===project.id&&requested.cycleId===customerIdentifier(data.cycleId)&&
        customerCurrentRequests(rows).find(row=>row.cycleId===requested.cycleId)?.id===requested.id,'CUSTOMER_UPDATE_REQUEST_EDITION_CHANGED');
      const brief=customerFind(rows.briefs,requested.definition.briefId);
      const plan=customerFind(brief.definition.sourcePlans,customerIdentifier(data.planId),'CUSTOMER_UPDATE_SOURCE_PLAN_NOT_FOUND');
      const editionIds=customerIds(data.editionIds,'CUSTOMER_UPDATE_EDITION_IDS_REQUIRED',1000);
      need(editionIds.length>0,'CUSTOMER_UPDATE_EDITION_IDS_REQUIRED');
      const editions=editionIds.map(key=>customerFind(state.editions,key,'CUSTOMER_UPDATE_EDITION_NOT_FOUND'));
      need(editions.every(row=>row.questionId===plan.questionId),'CUSTOMER_UPDATE_EDITION_QUESTION_CHANGED');
      for(const edition of editions)validateCustomerEuropePmcIntake(plan,edition,projected.get(edition.id));
      result.intake={id:id('cui'),projectId:project.id,cycleId:requested.cycleId,requestEditionId:requested.id,planId:plan.id,
        editionIds,editions:clone(editions),original:customerOriginalHandle(data.original??{}),
        note:customerText(data.note??'','CUSTOMER_UPDATE_INTAKE_NOTE_INVALID',20000,true),...base};break;
    }
    case 'review-work':{
      need(prepared.context,'CUSTOMER_UPDATE_PREPARED_CONTEXT_REQUIRED');
      const payload=buildCustomerWorkPayload(state,request,createdAt,prepared.context);
      need(customerUpdateSame(payload,prepared.workPayload),'CUSTOMER_UPDATE_WORK_FILE_CHANGED');
      const snapshot=fileMetadata(prepared.workFile),bytes=jsonBytes(payload);
      need(snapshot.bytes===bytes.length&&snapshot.sha256===digest(bytes),'CUSTOMER_UPDATE_WORK_FILE_CHANGED');
      const value={id:payload.workId,projectId:payload.projectId,cycleId:payload.cycleId,requestEditionId:payload.requestEditionId,
        selection:clone(payload.context.selection),contextFingerprint:payload.context.fingerprint,
        sourceRevision:payload.sourceRevision,sourceRevisionSha256:payload.sourceRevisionSha256,
        snapshot,payloadSha256:customerUpdateDigest(payload),summary:payload.review.summary,
        counts:clone(payload.context.inventory.counts),changeCounts:clone(payload.context.comparison.counts),
        acceptance:clone(payload.review.acceptance),...base};
      result.work={...value,sha256:customerUpdateDigest(value)};break;
    }
    case 'publish-delivery':{
      const definition=customerDeliveryDefinition(state,request,createdAt,prepared.workPayload);
      need(customerUpdateSame(definition,prepared.deliveryDefinition),'CUSTOMER_UPDATE_DELIVERY_CHANGED');
      const files=customerList(prepared.deliveryFiles,'CUSTOMER_UPDATE_DELIVERY_FILES_REQUIRED',4).map(file=>{
        customerFields(file,['format','name','contentType','sha256','bytes']);
        need(CUSTOMER_UPDATE_FORMATS.includes(file.format)&&
          file.name===definition.id+'.'+file.format,'CUSTOMER_UPDATE_DELIVERY_FILENAME_INVALID');
        return {format:file.format,name:file.name,contentType:customerText(file.contentType,'CUSTOMER_UPDATE_CONTENT_TYPE_INVALID',100),...fileMetadata({sha256:file.sha256,bytes:file.bytes})};
      });
      need(files.length===4&&new Set(files.map(row=>row.format)).size===4,'CUSTOMER_UPDATE_DELIVERY_FILES_REQUIRED');
      const value={...definition,files};result.delivery={...value,sha256:customerUpdateDigest(value)};break;
    }
    case 'record-delivery':{
      customerFields(data,['projectId','deliveryId','status','by','occurredAt','channel','reference','message','original']);
      project=projectFor(rows,data);const delivery=customerFind(rows.deliveries,customerIdentifier(data.deliveryId),'CUSTOMER_UPDATE_DELIVERY_NOT_FOUND');
      need(delivery.projectId===project.id,'CUSTOMER_UPDATE_DELIVERY_PROJECT_CHANGED');
      need(['SENT','RECEIVED','ACCEPTED','CORRECTIONS_REQUESTED','WITHDRAWN'].includes(data.status),'CUSTOMER_UPDATE_DELIVERY_STATUS_INVALID');
      result.deliveryEvent={id:id('cue'),projectId:project.id,cycleId:delivery.cycleId,deliveryId:delivery.id,status:data.status,
        by:customerActor(data.by),occurredAt:customerTime(data.occurredAt),
        channel:customerText(data.channel,'CUSTOMER_UPDATE_DELIVERY_CHANNEL_REQUIRED',240),
        reference:customerText(data.reference??'','CUSTOMER_UPDATE_DELIVERY_REFERENCE_INVALID',4000,true),
        message:customerText(data.message,'CUSTOMER_UPDATE_DELIVERY_MESSAGE_REQUIRED',100000),
        original:customerOriginalHandle(data.original??{}),...base};break;
    }
    case 'set-project-status':{
      customerFields(data,['projectId','status','reason']);project=projectFor(rows,data);
      need(['ACTIVE','PAUSED','COMPLETE'].includes(data.status),'CUSTOMER_UPDATE_PROJECT_STATUS_INVALID');
      result.projectStatus={id:id('cus'),projectId:project.id,status:data.status,
        reason:customerText(data.reason,'CUSTOMER_UPDATE_PROJECT_STATUS_REASON_REQUIRED'),...base};break;
    }
    default:need(false,'CUSTOMER_UPDATE_ACTION_INVALID');
  }
  const value={schema:CUSTOMER_UPDATE_OPERATION_SCHEMA,id:id('cuo'),dossierId:state.id,
    originalRevision:state.revision,originalRevisionSha256:digest(jsonBytes(state)),revision:state.revision+1,
    requestId:request.requestId,requestSha256:customerUpdateDigest(request),action:request.action,
    request:clone(request),actor:clone(request.actor),createdAt,result};
  const operation={...value,sha256:customerUpdateDigest(value)};
  state.customerUpdateEvents=[...rows.operations,operation];return operation;
}
export function customerUpdatesModel(state){
  const records=customerUpdateRecords(state),currentBriefs=customerCurrentBriefs(records),currentRequests=customerCurrentRequests(records);
  const projects=records.projects.map(project=>{
    const brief=currentBriefs.find(row=>row.projectId===project.id),agreements=records.agreements.filter(row=>row.projectId===project.id);
    return {...clone(project),name:brief?.definition.name??project.name,currentBriefId:brief?.id,
      status:records.projectStatuses.filter(row=>row.projectId===project.id).at(-1)?.status??'ACTIVE',
      latestAgreement:agreements.at(-1)??null,requestCount:currentRequests.filter(row=>row.projectId===project.id).length,
      deliveryCount:records.deliveries.filter(row=>row.projectId===project.id).length};
  });
  const requests=records.requests.map(request=>{
    const work=records.work.filter(row=>row.requestEditionId===request.id),deliveries=records.deliveries.filter(row=>row.requestEditionId===request.id);
    return {...clone(request),current:currentRequests.some(row=>row.id===request.id),
      latestWorkId:work.at(-1)?.id??null,latestDeliveryId:deliveries.at(-1)?.id??null,
      status:deliveries.length?'PUBLISHED':work.length?'REVIEWED':records.intakes.some(row=>row.requestEditionId===request.id)?'SOURCE_ATTACHED':'REQUESTED'};
  });
  return {schema:CUSTOMER_UPDATES_SCHEMA,dossierId:state.id,revision:state.revision,...records,projects,requests,
    overview:{projectCount:projects.length,requestedCycleCount:currentRequests.length,workReviewCount:records.work.length,
      deliveryCount:records.deliveries.length,deliveryEventCount:records.deliveryEvents.length}};
}
export function customerUpdatePage(state,{projectId,cycleId,section='overview',offset=0,limit=30,query=''}={}){
  need(CUSTOMER_UPDATE_SECTIONS.includes(section),'CUSTOMER_UPDATE_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'RESEARCH_PAGE_INVALID');
  customerText(query,'CUSTOMER_UPDATE_QUERY_INVALID',1000,true);
  const model=customerUpdatesModel(state);
  if(projectId!==undefined)customerFind(model.projects,customerIdentifier(projectId),'CUSTOMER_UPDATE_PROJECT_NOT_FOUND');
  if(cycleId!==undefined)need(model.requests.some(row=>row.cycleId===customerIdentifier(cycleId)&&(!projectId||row.projectId===projectId)),'CUSTOMER_UPDATE_CYCLE_NOT_FOUND');
  const result={schema:model.schema,dossierId:state.id,revision:state.revision,section,overview:model.overview};
  if(section==='overview')return {...result,projects:model.projects.map(row=>({id:row.id,name:row.name,customer:row.customer,
    status:row.status,currentBriefId:row.currentBriefId,requestCount:row.requestCount,deliveryCount:row.deliveryCount}))};
  let rows=section==='records'?customerNativeRecordCatalog(state):section==='editions'?state.editions:section==='questions'?state.questions:
    section==='delivery-events'?model.deliveryEvents:model[section];
  if(projectId&& !['records','editions','questions'].includes(section))
    rows=rows.filter(row=>section==='projects'?row.id===projectId:section==='operations'?
      Object.values(row.result).some(value=>value.projectId===projectId||value.id===projectId):row.projectId===projectId);
  if(cycleId&&!['records','editions','questions','projects','briefs','agreements'].includes(section))
    rows=rows.filter(row=>section==='operations'?Object.values(row.result).some(value=>value.cycleId===cycleId):row.cycleId===cycleId);
  if(query){const needle=query.toLocaleLowerCase();rows=rows.filter(row=>JSON.stringify(row).toLocaleLowerCase().includes(needle));}
  need(offset<=rows.length,'RESEARCH_PAGE_INVALID');
  const items=clone(rows.slice(offset,offset+limit)),nextOffset=offset+items.length<rows.length?offset+items.length:null;
  return {...result,offset,limit,total:rows.length,items,nextOffset,complete:nextOffset===null,
    next:nextOffset===null?null:{revision:state.revision,offset:nextOffset,limit}};
}
export function validateCustomerUpdateState(state,editions){
  need(state.customerUpdateEvents===undefined||Array.isArray(state.customerUpdateEvents),'PORTABLE_CUSTOMER_UPDATE_INVALID');
  const ids=new Set(),requests=new Set();
  for(const event of state.customerUpdateEvents??[]){
    need(customerObject(event)&&event.schema===CUSTOMER_UPDATE_OPERATION_SCHEMA&&customerObject(event.result)&&
      event.dossierId===state.id&&Number.isSafeInteger(event.originalRevision)&&event.originalRevision>=1&&
      event.revision===event.originalRevision+1&&event.revision<=state.revision,'PORTABLE_CUSTOMER_UPDATE_OPERATION_INVALID');
    customerHash(event.originalRevisionSha256);customerTime(event.createdAt);
    const request=customerUpdateInput(event.request),{sha256,...content}=event;
    need(event.id===customerUpdateEntity('cuo',state,request)&&event.requestId===request.requestId&&
      event.requestSha256===customerUpdateDigest(request)&&customerUpdateSame(event.request,request)&&
      event.originalRevision===request.expectedRevision&&event.action===request.action&&
      customerUpdateSame(event.actor,request.actor)&&sha256===customerUpdateDigest(content),'PORTABLE_CUSTOMER_UPDATE_OPERATION_CHANGED');
    need(!ids.has(event.id)&&!requests.has(event.requestId),'PORTABLE_CUSTOMER_UPDATE_DUPLICATE');
    ids.add(event.id);requests.add(event.requestId);
    for(const edition of event.result.intake?.editions??[]){
      const current=editions.get(edition.id);
      need(current&&customerUpdateSame(current,edition),'PORTABLE_CUSTOMER_UPDATE_EDITION_CHANGED');
    }
  }
  customerUpdateBlobMetadata(state);
}
export function validateCustomerUpdateHistory(previous,state){
  const old=previous?.customerUpdateEvents??[],current=state.customerUpdateEvents??[];
  need(current.length>=old.length&&old.every((value,index)=>customerUpdateSame(value,current[index])),
    'PORTABLE_CUSTOMER_UPDATE_HISTORY_CHANGED');
  const added=current.slice(old.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&
    value.originalRevision===previous?.revision&&value.originalRevisionSha256===state.previous),
    'PORTABLE_CUSTOMER_UPDATE_HISTORY_INVALID');
  return added;
}
