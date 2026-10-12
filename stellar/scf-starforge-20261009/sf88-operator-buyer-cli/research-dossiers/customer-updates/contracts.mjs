// MIT. Shared wire values for the original Research customer-update workflow.
export const CUSTOMER_UPDATES_SCHEMA='sf88-research-customer-updates/v1';
export const CUSTOMER_UPDATE_OPERATION_SCHEMA='sf88-research-customer-update-operation/v1';
export const CUSTOMER_UPDATE_WORK_SCHEMA='sf88-research-customer-update-work/v1';
export const CUSTOMER_UPDATE_REPORT_SCHEMA='sf88-research-customer-update-report/v1';
export const CUSTOMER_UPDATE_LIMIT=16*1024*1024;
export const CUSTOMER_UPDATE_ACTIONS=Object.freeze(['create-project','revise-brief','record-agreement',
  'request-update','revise-request','attach-intake','review-work','publish-delivery','record-delivery','set-project-status']);
export const CUSTOMER_UPDATE_SECTIONS=Object.freeze(['overview','projects','briefs','agreements','requests',
  'intakes','work','deliveries','delivery-events','operations','records','editions','questions']);
export const CUSTOMER_UPDATE_FORMATS=Object.freeze(['json','md','html','csv']);
export function requireCustomerUpdate(condition,code='CUSTOMER_UPDATE_INVALID'){
  if(!condition)throw Object.assign(new Error(code),{code});
}
export const customerObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
export function customerFields(value,allowed,code='CUSTOMER_UPDATE_FIELDS_INVALID'){
  requireCustomerUpdate(customerObject(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);return value;
}
export function customerText(value,code='CUSTOMER_UPDATE_TEXT_INVALID',maximum=20000,empty=false){
  requireCustomerUpdate(typeof value==='string'&&value.length<=maximum&&(empty||value.trim().length>0),code);
  return value;
}
export function customerIdentifier(value,code='CUSTOMER_UPDATE_ID_INVALID'){
  requireCustomerUpdate(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value),code);return value;
}
export function customerHash(value,code='CUSTOMER_UPDATE_SHA256_REQUIRED'){
  requireCustomerUpdate(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),code);return value;
}
export function customerList(value,code='CUSTOMER_UPDATE_LIST_INVALID',maximum=1000){
  requireCustomerUpdate(Array.isArray(value)&&value.length<=maximum,code);return value;
}
export function customerIds(value,code='CUSTOMER_UPDATE_IDS_INVALID',maximum=1000){
  customerList(value,code,maximum);value.forEach(item=>customerIdentifier(item,code));
  requireCustomerUpdate(new Set(value).size===value.length,code);return [...value];
}
export function customerActor(value){
  customerFields(value,['id','name'],'CUSTOMER_UPDATE_ACTOR_INVALID');
  return {id:customerIdentifier(value.id),name:customerText(value.name,'CUSTOMER_UPDATE_ACTOR_NAME_REQUIRED',240)};
}
export function customerJson(value,{depth=0}={}){
  requireCustomerUpdate(depth<=40,'CUSTOMER_UPDATE_JSON_DEPTH');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){
    requireCustomerUpdate(Number.isFinite(value),'CUSTOMER_UPDATE_JSON_REQUIRED');return value;
  }
  if(Array.isArray(value)){
    requireCustomerUpdate(value.length<=100000&&Object.keys(value).length===value.length,'CUSTOMER_UPDATE_JSON_REQUIRED');
    return value.map(item=>customerJson(item,{depth:depth+1}));
  }
  requireCustomerUpdate(customerObject(value),'CUSTOMER_UPDATE_JSON_REQUIRED');
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,customerJson(value[key],{depth:depth+1})]));
}
export function customerRevision(value){
  requireCustomerUpdate(Number.isSafeInteger(value)&&value>=1&&value<100000000,'EXPECTED_REVISION_REQUIRED');
  return value;
}
export function customerTime(value,code='CUSTOMER_UPDATE_TIME_INVALID'){
  customerText(value,code,100);
  requireCustomerUpdate(Number.isFinite(Date.parse(value)),code);return value;
}
export function customerPeriod(value){
  customerFields(value,['planId','from','until','field','notes'],'CUSTOMER_UPDATE_PERIOD_INVALID');
  const from=customerText(value.from,'CUSTOMER_UPDATE_PERIOD_FROM_REQUIRED',100,true);
  const until=customerText(value.until,'CUSTOMER_UPDATE_PERIOD_UNTIL_REQUIRED',100,true);
  // Provider date fields and literal bounds remain operator-selected source parameters.
  // We do not reinterpret a publication date as an acquisition or indexing date.
  return {planId:customerIdentifier(value.planId),from,until,
    field:customerText(value.field,'CUSTOMER_UPDATE_PERIOD_FIELD_REQUIRED',240),
    notes:customerText(value.notes??'','CUSTOMER_UPDATE_PERIOD_NOTES_INVALID',10000,true)};
}
export function customerRecordSelection(value){
  customerFields(value,['path','sha256','label'],'CUSTOMER_UPDATE_RECORD_SELECTION_INVALID');
  const path=customerText(value.path,'CUSTOMER_UPDATE_RECORD_PATH_REQUIRED',2048);
  requireCustomerUpdate(path.startsWith('/')&&!/~(?:[^01]|$)/.test(path),'CUSTOMER_UPDATE_RECORD_PATH_INVALID');
  return {path,sha256:customerHash(value.sha256),label:customerText(value.label??'','CUSTOMER_UPDATE_RECORD_LABEL_INVALID',240,true)};
}
export function customerOriginalHandle(value){
  requireCustomerUpdate(customerObject(value),'CUSTOMER_UPDATE_SOURCE_HANDLE_INVALID');
  const result=customerJson(value);
  requireCustomerUpdate(JSON.stringify(result).length<=32000,'CUSTOMER_UPDATE_SOURCE_HANDLE_TOO_LARGE');
  return result;
}
export function customerBrief(input){
  customerFields(input,['name','customer','purpose','owner','questionIds','protocol','sourcePlans','outputs','scope','updatePolicy']);
  customerFields(input.customer,['id','name','reference'],'CUSTOMER_UPDATE_CUSTOMER_INVALID');
  customerFields(input.protocol,['title','version','source','notes'],'CUSTOMER_UPDATE_PROTOCOL_INVALID');
  customerFields(input.scope,['currency','amount','unit','note','reference'],'CUSTOMER_UPDATE_SCOPE_INVALID');
  const questionIds=customerIds(input.questionIds,'CUSTOMER_UPDATE_QUESTIONS_REQUIRED',100);
  requireCustomerUpdate(questionIds.length>0,'CUSTOMER_UPDATE_QUESTIONS_REQUIRED');
  const sourcePlans=customerList(input.sourcePlans,'CUSTOMER_UPDATE_SOURCE_PLANS_REQUIRED',100).map(plan=>{
    customerFields(plan,['id','name','questionId','provider','query','parameters','original','terms','constraints']);
    const parameters=customerOriginalHandle(plan.parameters??{}),original=customerOriginalHandle(plan.original??{});
    return {id:customerIdentifier(plan.id),name:customerText(plan.name,'CUSTOMER_UPDATE_PLAN_NAME_REQUIRED',240),
      questionId:customerIdentifier(plan.questionId),provider:customerText(plan.provider,'CUSTOMER_UPDATE_PROVIDER_REQUIRED',100),
      query:customerText(plan.query,'CUSTOMER_UPDATE_QUERY_REQUIRED',20000),parameters,original,
      terms:customerText(plan.terms,'CUSTOMER_UPDATE_TERMS_REQUIRED',20000),
      constraints:customerText(plan.constraints??'','CUSTOMER_UPDATE_CONSTRAINTS_INVALID',20000,true)};
  });
  requireCustomerUpdate(sourcePlans.length>0&&new Set(sourcePlans.map(row=>row.id)).size===sourcePlans.length&&
    sourcePlans.every(row=>questionIds.includes(row.questionId)),'CUSTOMER_UPDATE_SOURCE_PLANS_INVALID');
  const outputs=customerList(input.outputs,'CUSTOMER_UPDATE_OUTPUTS_REQUIRED',100).map(row=>{
    customerFields(row,['id','label','format','acceptance']);
    return {id:customerIdentifier(row.id),label:customerText(row.label,'CUSTOMER_UPDATE_OUTPUT_LABEL_REQUIRED',240),
      format:customerText(row.format,'CUSTOMER_UPDATE_OUTPUT_FORMAT_REQUIRED',240),
      acceptance:customerText(row.acceptance,'CUSTOMER_UPDATE_ACCEPTANCE_REQUIRED',20000)};
  });
  requireCustomerUpdate(outputs.length>0&&new Set(outputs.map(row=>row.id)).size===outputs.length,'CUSTOMER_UPDATE_OUTPUTS_INVALID');
  const result={name:customerText(input.name,'CUSTOMER_UPDATE_NAME_REQUIRED',240),
    customer:{id:customerIdentifier(input.customer.id),name:customerText(input.customer.name,'CUSTOMER_UPDATE_CUSTOMER_NAME_REQUIRED',240),
      reference:customerText(input.customer.reference??'','CUSTOMER_UPDATE_CUSTOMER_REFERENCE_INVALID',4000,true)},
    purpose:customerText(input.purpose,'CUSTOMER_UPDATE_PURPOSE_REQUIRED',20000),owner:customerActor(input.owner),questionIds,
    protocol:{title:customerText(input.protocol.title,'CUSTOMER_UPDATE_PROTOCOL_TITLE_REQUIRED',1000),
      version:customerText(input.protocol.version,'CUSTOMER_UPDATE_PROTOCOL_VERSION_REQUIRED',240),
      source:customerText(input.protocol.source,'CUSTOMER_UPDATE_PROTOCOL_SOURCE_REQUIRED',4000),
      notes:customerText(input.protocol.notes??'','CUSTOMER_UPDATE_PROTOCOL_NOTES_INVALID',20000,true)},
    sourcePlans,outputs,scope:{currency:customerText(input.scope.currency??'','CUSTOMER_UPDATE_CURRENCY_INVALID',40,true),
      amount:customerText(input.scope.amount??'','CUSTOMER_UPDATE_AMOUNT_INVALID',100,true),
      unit:customerText(input.scope.unit??'','CUSTOMER_UPDATE_UNIT_INVALID',240,true),
      note:customerText(input.scope.note??'','CUSTOMER_UPDATE_SCOPE_NOTE_INVALID',20000,true),
      reference:customerText(input.scope.reference??'','CUSTOMER_UPDATE_SCOPE_REFERENCE_INVALID',4000,true)},
    updatePolicy:customerText(input.updatePolicy,'CUSTOMER_UPDATE_POLICY_REQUIRED',20000)};
  requireCustomerUpdate(JSON.stringify(result).length<=256*1024,'CUSTOMER_UPDATE_BRIEF_TOO_LARGE');
  return result;
}
export function customerRequestedUpdate(input){
  customerFields(input,['briefId','kind','previousDeliveryId','label','request','periods','instructions']);
  requireCustomerUpdate(['BASELINE','UPDATE','CORRECTION'].includes(input.kind),'CUSTOMER_UPDATE_KIND_INVALID');
  customerFields(input.request,['by','receivedAt','reference','note'],'CUSTOMER_UPDATE_REQUEST_ORIGIN_INVALID');
  const periods=customerList(input.periods,'CUSTOMER_UPDATE_PERIODS_INVALID',100).map(customerPeriod);
  requireCustomerUpdate(new Set(periods.map(row=>row.planId)).size===periods.length,'CUSTOMER_UPDATE_PERIOD_DUPLICATE');
  return {briefId:customerIdentifier(input.briefId),kind:input.kind,
    previousDeliveryId:input.previousDeliveryId===null?null:customerIdentifier(input.previousDeliveryId),
    label:customerText(input.label,'CUSTOMER_UPDATE_LABEL_REQUIRED',240),
    request:{by:customerActor(input.request.by),receivedAt:customerTime(input.request.receivedAt),
      reference:customerText(input.request.reference??'','CUSTOMER_UPDATE_REQUEST_REFERENCE_INVALID',4000,true),
      note:customerText(input.request.note,'CUSTOMER_UPDATE_REQUEST_NOTE_REQUIRED',20000)},
    periods,instructions:customerText(input.instructions??'','CUSTOMER_UPDATE_INSTRUCTIONS_INVALID',20000,true)};
}
export function customerWorkSelection(input){
  customerFields(input,['intakeIds','records'],'CUSTOMER_UPDATE_WORK_SELECTION_INVALID');
  const intakeIds=customerIds(input.intakeIds,'CUSTOMER_UPDATE_INTAKE_SELECTION_REQUIRED',500);
  const records=customerList(input.records??[],'CUSTOMER_UPDATE_RECORDS_INVALID',1000).map(customerRecordSelection);
  requireCustomerUpdate(intakeIds.length>0&&new Set(records.map(row=>row.path)).size===records.length,'CUSTOMER_UPDATE_WORK_SELECTION_INVALID');
  return {intakeIds,records};
}
export function customerUpdateInput(input){
  customerFields(input,['requestId','expectedRevision','actor','action','data'],'CUSTOMER_UPDATE_FIELDS_INVALID');
  requireCustomerUpdate(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'CUSTOMER_UPDATE_REQUEST_ID_REQUIRED');
  requireCustomerUpdate(CUSTOMER_UPDATE_ACTIONS.includes(input.action),'CUSTOMER_UPDATE_ACTION_INVALID');
  requireCustomerUpdate(customerObject(input.data),'CUSTOMER_UPDATE_DATA_REQUIRED');
  const result={requestId:input.requestId,expectedRevision:customerRevision(input.expectedRevision),
    actor:customerActor(input.actor),action:input.action,data:customerJson(input.data)};
  requireCustomerUpdate(JSON.stringify(result).length<=CUSTOMER_UPDATE_LIMIT,'CUSTOMER_UPDATE_REQUEST_TOO_LARGE');
  return result;
}
