import {COHORT_RECORDED_COST_PLAN_SCHEMA,reopenCohortRecordedCostPlan,reopenCohortDeliveryComparison,inspectCohortTaskMeasurements} from './cohort_delivery_comparison.mjs';
import {COHORT_PLAN_SCHEMA,COHORT_PLAN_REPORT_SCHEMA,COHORT_PLAN_COMPARISON_SCHEMA,evaluateCohortPlan,reopenCohortPlanComparison,compareCohortPlans} from './cohort_planning.mjs';
import {COHORT_DELIVERY_SCHEDULE_SCHEMA,reopenCohortDeliverySchedule} from './cohort_planning_scheduling.mjs';

export const COHORT_WORKING_SESSION_SCHEMA='stellar-forge.sf47-cohort-working-session.v1';
export const COHORT_WORKING_STATE_SCHEMA='stellar-forge.sf47-cohort-planning-session.v1';
export const COHORT_WORKING_SESSION_MAX_BYTES=64*1024*1024;
export const COHORT_WORKING_STATE_FIELDS=Object.freeze(['recordedCostMeasurementEditor','recordedCostSource','recordedCostBaseline','recordedCostChoices','recordedCostPreview','recordedCostPlan','recordedCostDraft','recordedCostSelectedSource','recordedCostHistory','schema','caseId','plan','report','reportInput','rowDrafts','lastEditorKey','selectedDate','caseRefreshReceipt','latestSeed','tranche','tab','editor','editorDraft','pending','accepted','priorDrafts','parentSourceId','savedSourceId','savedEnvelope','filter','pages','reportSection','importText','incomingCalendar','comparison','comparisonSelections','comparisonHistory','comparisonIncoming','comparisonSavedSourceId','comparisonMetric','schedulingResult','schedulingInput','schedulingEditorId','schedulingOptions','viewedSource','rejected']);
const editionSchema='stellar-forge.sf47-cohort-plan-edition.v1';
const collections=['buyers','merchants','facilitators','operations','schedules','workshares','capacityPools','fundingGroups'];
const tabs=['setup','participants','operations','schedules','workshares','capacity','recorded-cost','scheduling','funding','report','compare','editions'];
const digestPattern=/^[a-f0-9]{64}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw new Error('Working session: '+message);};
const need=(value,message)=>{if(!value)fail(message);};
const object=(value,label)=>{need(value!==null&&typeof value==='object'&&!Array.isArray(value),label+' must be an object.');return value;};
const string=(value,label,max=1048576)=>{need(typeof value==='string'&&value.length<=max,label+' must be text no longer than '+max+' characters.');return value;};
const array=(value,label,max=100000)=>{need(Array.isArray(value)&&value.length<=max,label+' must be a complete array of at most '+max+' items.');return value;};
const optionalString=(value,label)=>{if(value!==null&&value!==undefined)string(value,label);};
const integer=(value,label,min=0)=>need(Number.isSafeInteger(value)&&value>=min,label+' must be a whole number.');
const exact=(value,allowed,label)=>{object(value,label);for(const key of Object.keys(value))need(allowed.includes(key),label+' has an unsupported field: '+key);};
const reserved=key=>['__proto__','constructor','prototype'].includes(key);
function map(value,label){object(value,label);for(const key of Object.keys(value))need(!reserved(key),label+' contains a reserved map key.');return value;}
function jsonValue(value){
  let count=0;
  const visit=(item,depth)=>{
    need(depth<=100&&++count<=2000000,'The selected JSON is too deeply nested or has too many values.');
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'){need(Number.isFinite(item),'All JSON numbers must be finite.');return;}
    need(typeof item==='object','Only complete JSON values can travel in a working session.');
    if(Array.isArray(item)){for(const entry of item)visit(entry,depth+1);}
    else for(const entry of Object.values(item))visit(entry,depth+1);
  };visit(value,0);
}
export async function cohortWorkingSessionSha256(text){
  const bytes=new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function captureCohortPlanningState(state){
  const picked={};for(const key of COHORT_WORKING_STATE_FIELDS)if(state[key]!==undefined)picked[key]=state[key];
  return clone(picked);
}
function planShape(value,label){
  object(value,label);need(value.schema===COHORT_PLAN_SCHEMA,label+' has an unsupported plan schema.');
  object(value.source,label+' source');string(value.source.programId,label+' source case',500);
  object(value.rule,label+' rule');object(value.rule.target,label+' target');object(value.rule.target.proposed_window,label+' target window');
  need([2,3].includes(value.rule.target.tranche),label+' has an unsupported tranche.');
  for(const key of collections)for(const row of array(value[key]||[],label+' '+key)){object(row,label+' '+key+' row');string(row.id,label+' '+key+' row identity');if(key==='schedules'){object(row.cadence,label+' schedule cadence');object(row.payment,label+' schedule payment');}if(key==='capacityPools')object(row.hoursByWeekday,label+' weekday capacity');}
  object(value.calendar,label+' calendar');array(value.calendar.weekdays,label+' weekdays');
  array(value.calendar.excludedDates,label+' excluded dates');
  for(const key of ['draftId','name','windowStart','asOfAt'])string(value[key],label+' '+key);
  optionalString(value.note,label+' note');
  // Incomplete input text is intentional. The original editor/calculator validates it on Apply.
}
function comparableReport(value){
  const projected=clone(value);delete projected.sourceComparison;
  projected.findings=(projected.findings||[]).filter(row=>!['COHORT_PLAN_SOURCE_CHANGED','COHORT_PLAN_RULE_CHANGED'].includes(row.code));
  return projected;
}
function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function checkReport(value,label){
  if(value===null||value===undefined)return;
  object(value,label);need(value.schema===COHORT_PLAN_REPORT_SCHEMA,label+' has an unsupported report schema.');
  const calculated=evaluateCohortPlan(value.input);
  need(stable(comparableReport(value))===stable(comparableReport(calculated)),label+' differs from its original calculated inputs.');
}
function checkReportInput(value,raw,label){
  if(raw===undefined||raw==='')return;
  string(raw,label+' input',COHORT_WORKING_SESSION_MAX_BYTES);
  need(value,label+' has recorded inputs without its calculated report.');
  let input;try{input=JSON.parse(raw);}catch{fail(label+' input is not complete JSON.');}
  need(stable(input)===stable(value.input),label+' input differs from its retained calculated source.');
}
function checkDocument(value,label){
  object(value,label);
  if(value.schema===COHORT_RECORDED_COST_PLAN_SCHEMA){reopenCohortRecordedCostPlan(value);return;}
  if(value.schema===COHORT_PLAN_SCHEMA){evaluateCohortPlan(value);return;}
  if(value.schema===COHORT_PLAN_REPORT_SCHEMA){checkReport(value,label);return;}
  if(value.schema===COHORT_PLAN_COMPARISON_SCHEMA){reopenCohortPlanComparison(value);return;}
  if(value.schema===COHORT_DELIVERY_SCHEDULE_SCHEMA){reopenCohortDeliverySchedule(value);return;}
  if(value.schema===editionSchema){
    planShape(value.plan,label+' plan');
    // A downloaded draft may contain unfinished plan text and no calculated report.
    if(value.report)checkReport(value.report,label+' report');
    if(value.recordedCostPlan){reopenCohortRecordedCostPlan(value.recordedCostPlan);need((!value.report&&!value.recordedCostPlanComparison)||stable(value.recordedCostPlanComparison)===stable(compareCohortPlans(value.recordedCostPlan,value.plan)),label+' recorded-cost comparison differs from this successor.');}
    if(value.deliverySchedule)reopenCohortDeliverySchedule(value.deliverySchedule);
    if(value.comparison)reopenCohortPlanComparison(value.comparison);
    return;
  }
  fail(label+' has an unsupported planning document schema.');
}
function editor(value,data,label){
  if(value===null||value===undefined){need(data===null||data===undefined,label+' has text without its row editor.');return;}
  object(value,label);need(collections.includes(value.kind),label+' has an unsupported row kind.');
  string(value.key,label+' key');optionalString(value.id,label+' row id');
  object(data,label+' text');string(data.id,label+' editable row id');
  optionalString(data.label,label+' label');
  if(value.kind==='schedules'){object(data.cadence,label+' cadence');object(data.payment,label+' payment');}
  if(value.kind==='capacityPools')object(data.hoursByWeekday,label+' weekday capacity');
  const variants=object(value.variants,label+' saved choices');
  for(const key of ['cadence','payment'])for(const [kind,choice] of Object.entries(map(variants[key],label+' saved '+key+' choices'))){
    object(choice,label+' saved '+key+' choice');need(choice.kind===kind,label+' saved '+key+' identity differs from its choice.');
  }
  if(variants.economics!==null&&variants.economics!==undefined)object(variants.economics,label+' saved economics');
  if(variants.fundingGroupIds!==undefined)array(variants.fundingGroupIds,label+' saved funding groups');
}
function comparison(value,label){
  if(value===null||value===undefined)return;
  object(value,label);
  for(const side of ['before','after'])if(value[side]){
    object(value[side],label+' '+side);checkDocument(value[side].document,label+' '+side+' source');
    if(value[side].origin!==undefined)object(value[side].origin,label+' '+side+' origin');
  }
  for(const key of ['title','note','section'])optionalString(value[key],label+' '+key);
}
function nativeRequest(value,caseId,label,accepted=false){
  if(value===null||value===undefined)return;
  object(value,label);const payload=object(value.payload,label+' payload');
  exact(payload,['expectedVersion','actor','action','data','note','requestId'],label+' payload');
  need(payload.action==='source.add',label+' must be the original source attachment action.');
  integer(payload.expectedVersion,label+' case version',1);string(payload.actor,label+' actor',1000);need(payload.actor.trim(),label+' has no actor.');
  string(payload.requestId,label+' request identity',1000);need(payload.requestId.length>0,label+' has no request identity.');
  optionalString(payload.note,label+' note');
  const data=object(payload.data,label+' source');
  exact(data,['kind','filename','contentBase64','mediaType','sourceUrl','observedAt'],label+' source');
  need(data.kind==='other'&&data.mediaType==='application/json'&&data.sourceUrl==='',label+' must retain its original JSON source attachment.');
  string(data.filename,label+' filename',1000);need(/^sf47-cohort-plan-.*\.json$/.test(data.filename),label+' has an unsupported source filename.');
  string(data.observedAt,label+' observation time',100);
  const raw=string(value.raw,label+' original bytes',8*1024*1024);
  const bytes=new TextEncoder().encode(raw);need(bytes.length<=8*1024*1024,label+' exceeds the original source attachment size.');
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  need(data.contentBase64===btoa(binary),label+' encoded body differs from its exact original JSON.');
  let document;try{document=JSON.parse(raw);}catch{fail(label+' original source is not complete JSON.');}
  checkDocument(document,label+' original source');
  const sourceCase=document.schema===COHORT_PLAN_COMPARISON_SCHEMA?document.before?.source?.programId:document.plan?.source?.programId;
  if(document.schema===COHORT_PLAN_COMPARISON_SCHEMA){
    // Comparisons can intentionally contain another case; their native request remains this selected case.
    need(value.documentKind==='comparison',label+' comparison request kind is missing.');
  }else need(sourceCase===caseId,label+' original plan belongs to a different case.');
  string(value.editionId,label+' edition identity',1000);
  if(accepted){const result=object(value.result,label+' result');need(result.id===caseId,label+' result belongs to another case.');integer(result.version,label+' accepted version',1);string(result.recordId,label+' original source record',1000);}
}
export function validateCohortPlanningState(value,caseId){
  exact(value,COHORT_WORKING_STATE_FIELDS,'Retained state');
  for(const key of ['schema','caseId','plan','report','reportInput','rowDrafts','tranche','tab','editor','editorDraft','priorDrafts','pages'])need(Object.hasOwn(value,key),'The complete working state is missing '+key+'.');
  need(value.schema===COHORT_WORKING_STATE_SCHEMA&&value.caseId===caseId,'The original selected case does not match this working session.');
  if(value.recordedCostMeasurementEditor){
    const editor=object(value.recordedCostMeasurementEditor,'Saved measurement working selection');
    exact(editor,['sourceId','source','kind','observationId','serviceBasis'],'Saved measurement working selection');
    for(const key of ['sourceId','kind','observationId','serviceBasis'])string(editor[key],'Saved measurement '+key);
    if(editor.source)inspectCohortTaskMeasurements(editor.source); // Received cases retain the producer identity; native review checks the selected case inventory.
  }
  if(value.recordedCostSource){reopenCohortDeliveryComparison(value.recordedCostSource);need(value.recordedCostSource.source.programId===caseId,'The recorded-cost source belongs to another case.');}
  if(value.recordedCostBaseline)checkDocument(value.recordedCostBaseline,'Recorded-cost baseline');
  for(const key of ['recordedCostPreview','recordedCostPlan'])if(value[key]){reopenCohortRecordedCostPlan(value[key]);need(value[key].candidate.source.programId===caseId,'The cost proposal belongs to another case.');}
  for(const key of ['recordedCostChoices','recordedCostDraft'])if(value[key])object(value[key],key);
  if(value.recordedCostHistory)array(value.recordedCostHistory,'Earlier recorded-cost choices');
  optionalString(value.recordedCostSelectedSource,'Recorded-cost source selection');
  if(value.plan)planShape(value.plan,'Working plan');
  checkReport(value.report,'Working report');
  for(const key of ['reportInput','selectedDate','filter','reportSection','importText','schedulingInput'])if(value[key]!==undefined)string(value[key],key,64*1024*1024);
  checkReportInput(value.report,value.reportInput,'Working report');
  for(const key of ['lastEditorKey','parentSourceId','savedSourceId','comparisonSavedSourceId','comparisonMetric','schedulingEditorId'])optionalString(value[key],key);
  need(value.tab===undefined||tabs.includes(value.tab),'The retained panel is unsupported.');
  need(value.tranche===undefined||[2,3].includes(value.tranche),'The selected tranche is unsupported.');
  for(const page of Object.values(map(value.pages,'Report pages')))integer(page,'Report page');
  if(value.latestSeed){object(value.latestSeed,'Current seed');object(value.latestSeed.source,'Current seed source');need(value.latestSeed.source.programId===caseId,'The retained current seed belongs to another case.');}
  if(value.incomingCalendar!==null&&value.incomingCalendar!==undefined){
    const received=object(value.incomingCalendar,'Incoming customer calendar');
    object(received.nativeSeed,'Incoming calendar seed');object(received.nativeSeed.source,'Incoming calendar case');
    need(received.nativeSeed.source.programId===caseId,'The incoming calendar belongs to another original case.');
    object(received.calendarSelection,'Incoming calendar selection');optionalString(received.requestId,'Incoming calendar request');
  }
  editor(value.editor,value.editorDraft,'Open row editor');
  for(const row of Object.values(map(value.rowDrafts,'Unfinished rows')))editor(row.editor,row.data,'Unfinished row');
  for(const row of array(value.priorDrafts,'Earlier drafts')){
    string(row.id,'Earlier draft id');string(row.retainedAt,'Earlier draft time');string(row.reason,'Earlier draft reason');
    planShape(row.plan,'Earlier draft');checkReport(row.report,'Earlier draft report');
    checkReportInput(row.report,row.reportInput,'Earlier draft report');
  }
  comparison(value.comparison,'Current comparison');
  if(value.comparisonSelections)for(const [key,selected] of Object.entries(map(value.comparisonSelections,'Comparison selection'))){need(['before','after'].includes(key),'Unsupported comparison side.');string(selected,'Comparison selection');}
  for(const row of array(value.comparisonHistory||[],'Comparison history')){string(row.id,'Comparison history id');object(row.value,'Earlier comparison');comparison(row.value,'Earlier comparison');}
  for(const row of array(value.comparisonIncoming||[],'Incoming planning sources')){string(row.id,'Incoming source id');checkDocument(row.document,'Incoming planning source');}
  if(value.schedulingResult)reopenCohortDeliverySchedule(value.schedulingResult);
  if(value.schedulingOptions){
    exact(value.schedulingOptions,['method','maxSearchSteps'],'Allocation choices');
    need(['FIRST_FIT','RESOLVE_CONFLICTS'].includes(value.schedulingOptions.method),'Unsupported allocation method.');
    if(value.schedulingOptions.maxSearchSteps!==undefined){integer(value.schedulingOptions.maxSearchSteps,'Allocation search effort',1);need(value.schedulingOptions.maxSearchSteps<=1000000,'Allocation search effort exceeds its original limit.');}
  }
  if(value.savedEnvelope)checkDocument(value.savedEnvelope,'Saved original edition');
  if(value.viewedSource){object(value.viewedSource.meta,'Opened source identity');string(value.viewedSource.meta.id,'Opened source id');string(value.viewedSource.meta.filename,'Opened source filename');if(value.viewedSource.raw!==null&&value.viewedSource.raw!==undefined)string(value.viewedSource.raw,'Opened original source',64*1024*1024);}
  if(value.caseRefreshReceipt){
    const receipt=object(value.caseRefreshReceipt,'Original source receipt');
    need(receipt.id===caseId,'The original source receipt belongs to another case.');
    integer(receipt.version,'Original source receipt version',1);string(receipt.recordId,'Original source receipt identity',1000);
    need(value.viewedSource?.meta.id===receipt.recordId&&typeof value.viewedSource.raw==='string',
      'The original source receipt must retain its exact opened source.');
  }
  nativeRequest(value.pending,caseId,'Original pending request');
  nativeRequest(value.accepted,caseId,'Original accepted request',true);
  nativeRequest(value.rejected,caseId,'Original rejected request');
  need(!(value.pending&&value.accepted),'One original request cannot be both pending and accepted.');
  return value;
}
function entry(value,label,snapshots){
  exact(value,['id','snapshotSha256','retainedAt','reason','origin','transportActive'],label);
  string(value.id,label+' identity',1000);need(value.id.length>0,label+' has no identity.');
  need(digestPattern.test(value.snapshotSha256)&&Object.hasOwn(snapshots,value.snapshotSha256),label+' has no complete retained snapshot.');
  string(value.retainedAt,label+' time',100);string(value.reason,label+' reason',2000);
  if(value.origin!==undefined)object(value.origin,label+' origin');
  need(value.transportActive===undefined||typeof value.transportActive==='boolean',label+' has an invalid transport state.');
}
export async function reopenCohortWorkingSession(input,{caseId}={}){
  const document=typeof input==='string'?JSON.parse(input):clone(input);
  jsonValue(document);const bytes=new TextEncoder().encode(JSON.stringify(document)).length;
  need(bytes<=COHORT_WORKING_SESSION_MAX_BYTES,'The complete working session exceeds 64 MiB.');
  exact(document,['schema','sessionId','caseId','exportedAt','current','snapshots','history','incoming'],'Working document');
  need(document.schema===COHORT_WORKING_SESSION_SCHEMA,'Select a complete cohort working session.');
  string(document.caseId,'Case identity',500);if(caseId!==undefined)need(document.caseId===caseId,'Open the original case '+document.caseId+' to continue this working session.');
  string(document.sessionId,'Working session identity',1000);string(document.exportedAt,'Export time',100);
  const snapshots=map(document.snapshots,'Complete snapshots'),keys=Object.keys(snapshots);need(keys.length>0&&keys.length<=10000,'Retain between one and 10,000 complete snapshots.');
  for(const id of keys){
    need(digestPattern.test(id),'A snapshot identity is invalid.');
    need(await cohortWorkingSessionSha256(JSON.stringify(snapshots[id]))===id,'A complete snapshot differs from its source identity.');
    validateCohortPlanningState(snapshots[id],document.caseId);
  }
  entry(document.current,'Selected working state',snapshots);
  const history=array(document.history,'Retained working sessions',10000),incoming=array(document.incoming,'Incoming working sessions',10000);
  const ids=new Set([document.current.id]),used=new Set([document.current.snapshotSha256]);
  for(const [label,rows] of [['Retained working session',history],['Incoming working session',incoming]])for(const row of rows){
    entry(row,label,snapshots);need(!ids.has(row.id),'Working entry identities must be unique.');ids.add(row.id);used.add(row.snapshotSha256);
  }
  need(used.size===keys.length,'Every retained snapshot must belong to a complete current, prior or incoming working entry.');
  return document;
}
export async function createCohortWorkingSession(state,{sessionId,exportedAt,transportActive=false}){
  const captured=captureCohortPlanningState(state),id=await cohortWorkingSessionSha256(JSON.stringify(captured));
  const snapshots=clone(state.workingSnapshots||{});snapshots[id]=captured;
  const history=clone(state.workingHistory||[]),incoming=clone(state.workingIncoming||[]);
  const used=new Set([id,...history.map(row=>row.snapshotSha256),...incoming.map(row=>row.snapshotSha256)]);
  for(const key of Object.keys(snapshots))if(!used.has(key))delete snapshots[key];
  const document={schema:COHORT_WORKING_SESSION_SCHEMA,sessionId,caseId:state.caseId,exportedAt,
    current:{id:sessionId,snapshotSha256:id,retainedAt:exportedAt,reason:'Current complete planning work',transportActive},
    snapshots,history,incoming};
  return reopenCohortWorkingSession(document,{caseId:state.caseId});
}
export function describeCohortWorkingState(state){
  return {name:state.plan?.name||'Planning workspace',tranche:state.plan?.rule?.target?.tranche||state.tranche,
    sourceVersion:state.plan?.source?.version??null,unfinishedRows:Object.keys(state.rowDrafts||{}).length,
    priorDrafts:(state.priorDrafts||[]).length,comparisonHistory:(state.comparisonHistory||[]).length,
    incomingSources:(state.comparisonIncoming||[]).length,allocationMethod:state.schedulingResult?(state.schedulingOptions?.method||state.schedulingResult.resolution?.method||'FIRST_FIT'):null,
    originalRequest:state.accepted?'ACCEPTED':state.pending?'PENDING':null,
    requestId:state.accepted?.payload.requestId||state.pending?.payload.requestId||null};
}

async function workingArchive(){
  if(typeof indexedDB==='undefined')return null;
  return new Promise((resolve,reject)=>{
    let abandoned=false;
    const request=indexedDB.open('sf47-cohort-working-archive',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots');};
    request.onsuccess=()=>{if(abandoned)request.result.close();else resolve(request.result);};
    request.onerror=()=>reject(new Error('The browser could not open the complete working archive: '+request.error?.message));
    request.onblocked=()=>{abandoned=true;reject(new Error('Close the earlier browser archive connection, then reopen the original working-session file.'));};
  });
}
/** Store immutable snapshots before selecting a successor; the compact session cache retains their exact identities. */
export async function storeCohortWorkingSnapshots(caseId,snapshots){
  const db=await workingArchive();if(!db)return false;
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('snapshots','readwrite'),objects=transaction.objectStore('snapshots');
    for(const [id,state] of Object.entries(snapshots))objects.put(state,caseId+'|'+id);
    transaction.oncomplete=()=>resolve(true);
    transaction.onerror=()=>reject(new Error('The complete working archive could not be retained: '+transaction.error?.message));
    transaction.onabort=()=>reject(new Error('The complete working archive was not committed: '+transaction.error?.message));
  });}finally{db.close();}
}
export async function loadCohortWorkingSnapshots(caseId,ids){
  const db=await workingArchive();need(db,'This browser cannot reopen its retained archive. Open the complete working-session JSON to recover all states.');
  const result={};
  try{await new Promise((resolve,reject)=>{
    const transaction=db.transaction('snapshots','readonly'),objects=transaction.objectStore('snapshots');
    for(const id of ids){need(digestPattern.test(id),'The retained browser snapshot identity is invalid.');const request=objects.get(caseId+'|'+id);request.onsuccess=()=>{if(request.result!==undefined)result[id]=request.result;};}
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(new Error('The complete browser archive could not be read: '+transaction.error?.message));
    transaction.onabort=()=>reject(new Error('The complete browser archive read was interrupted: '+transaction.error?.message));
  });}finally{db.close();}
  for(const id of ids){
    need(result[id],'A retained working state is missing from this browser. Open its complete working-session JSON to recover the original.');
    need(await cohortWorkingSessionSha256(JSON.stringify(result[id]))===id,'The retained browser snapshot differs from its original identity.');
    validateCohortPlanningState(result[id],caseId);
  }
  return result;
}
