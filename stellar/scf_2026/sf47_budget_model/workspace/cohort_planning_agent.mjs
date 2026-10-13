// MIT. Complete adoption authoring over the original Grant workspace client.
import {createHash} from 'node:crypto';
import {COHORT_PLAN_SCHEMA,COHORT_PLAN_REPORT_SCHEMA,COHORT_PLAN_COMPARISON_SCHEMA,
  seedCohortPlan,normalizeCohortPlan,evaluateCohortPlan,compareCohortPlans,
  reopenCohortPlanComparison,exportCohortPlanCsv,exportCohortPlanComparisonCsv} from './cohort_planning.mjs';
import {seedCohortPlanFromCalendar} from './cohort_planning_calendar.mjs';
import {COHORT_DELIVERY_SCHEDULE_SCHEMA,seedCohortDeliveryScheduling,scheduleCohortDelivery,
  reopenCohortDeliverySchedule,exportCohortDeliveryScheduleCsv} from './cohort_planning_scheduling.mjs';

import {COHORT_DELIVERY_INPUT_SCHEMA,COHORT_DELIVERY_COMPARISON_SCHEMA,
  compareCohortDelivery,reopenCohortDeliveryComparison,
  exportCohortDeliveryCsv,exportCohortDeliveryHtml,COHORT_RECORDED_COST_PLAN_SCHEMA,
  planCohortFromRecordedCosts,reopenCohortRecordedCostPlan,exportCohortRecordedCostPlanCsv,inspectCohortTaskMeasurements} from './cohort_delivery_comparison.mjs';

export const COHORT_PLAN_EDITION_SCHEMA='stellar-forge.sf47-cohort-plan-edition.v1';
export const COHORT_ADOPTION_SEED_SCHEMA='stellar-forge.sf47-cohort-adoption-seed.v1';
export const COHORT_ADOPTION_REVIEW_SCHEMA='stellar-forge.sf47-cohort-adoption-review.v1';
export const COHORT_ADOPTION_PREPARED_SCHEMA='stellar-forge.sf47-cohort-adoption-prepared.v1';
export const COHORT_ADOPTION_SAVED_SCHEMA='stellar-forge.sf47-cohort-adoption-saved.v1';
const MAX_SOURCE=8*1024*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify((function order(x){return Array.isArray(x)?x.map(order):plain(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;})(v));
const same=(a,b)=>canonical(a)===canonical(b);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const rawJson=v=>Buffer.from(JSON.stringify(v,null,2)+'\n','utf8');
const need=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code});};
const object=(v,label)=>{need(plain(v),'GRANT_ADOPTION_INPUT',label+' must be one complete JSON object.');return v;};
const exact=(v,keys,required=[])=>{
  object(v,'Input');
  need(Object.keys(v).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'GRANT_ADOPTION_INPUT','Keep the supported complete fields: '+keys.join(', ')+'.');return v;
};
const sourceId=v=>{need(typeof v==='string'&&/^source-[a-f0-9]{32}$/.test(v),'GRANT_ADOPTION_INPUT','Use the original source ID.');return v;};
const caseId=v=>{need(typeof v==='string'&&/^operation-[a-f0-9]{32}$/.test(v),'GRANT_ADOPTION_INPUT','Use the original case ID.');return v;};
const digest=v=>{need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'GRANT_ADOPTION_INPUT','Use the complete original SHA256.');return v;};
const version=v=>{need(Number.isSafeInteger(v)&&v>=1&&v<=10000000,'GRANT_ADOPTION_INPUT','Use the current native case version.');return v;};
const text=(v,label,max=12000,required=false)=>{
  need(typeof v==='string'&&v.length<=max&&(!required||v.trim())&&!/\u0000/.test(v),
    'GRANT_ADOPTION_INPUT','Use '+label+' as complete text.');return v;
};
const timestamp=v=>{
  need(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v)),
    'GRANT_ADOPTION_INPUT','Retain the original creation time as a UTC ISO timestamp.');
  return v;
};
const requestId=v=>{
  need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v),
    'GRANT_ADOPTION_INPUT','Retain the original native request ID.');return v;
};
function originalDocument(value){
  object(value,'Adoption document');
  for(let count=0;count<5;count++){
    if(value.schema===COHORT_ADOPTION_SEED_SCHEMA)return object(value.plan,'Complete seed plan');
    if([COHORT_ADOPTION_REVIEW_SCHEMA,COHORT_ADOPTION_PREPARED_SCHEMA,COHORT_ADOPTION_SAVED_SCHEMA,
      'stellar-forge.sf47-cohort-delivery-agent.v1'].includes(value.schema)){
      value=object(value.document,'Complete original document');continue;
    }
    return value;
  }
  throw Object.assign(new Error('Select the complete original plan or saved edition.'),{code:'GRANT_ADOPTION_INPUT'});
}
function planOf(value){
  const document=originalDocument(value);
  if(document.schema===COHORT_RECORDED_COST_PLAN_SCHEMA)return reopenCohortRecordedCostPlan(document).candidate;
  if(document.schema===COHORT_PLAN_SCHEMA)return document;
  if(document.schema===COHORT_PLAN_EDITION_SCHEMA)return object(document.plan,'Complete edition plan');
  if(document.schema===COHORT_PLAN_REPORT_SCHEMA&&document.kind==='PLAN')return object(document.input,'Complete report input');
  if(document.schema===COHORT_DELIVERY_SCHEDULE_SCHEMA)return reopenCohortDeliverySchedule(document).candidate;
  throw Object.assign(new Error('Select a plan, plan report, saved edition or complete delivery allocation.'),{code:'GRANT_ADOPTION_INPUT'});
}
function verifyReport(report){
  need(report?.schema===COHORT_PLAN_REPORT_SCHEMA&&report.kind==='PLAN','GRANT_ADOPTION_REPORT','Keep the complete original plan report.');
  const comparison=report.sourceComparison;
  const nativeSeed=comparison?.currentSource&&comparison?.currentRule
    ?{source:comparison.currentSource,rule:comparison.currentRule}:undefined;
  const computed=evaluateCohortPlan(report.input,{nativeSeed});
  need(same(report,computed),'GRANT_ADOPTION_REPORT','The saved plan report differs from its complete original input and source.');
  return computed;
}
function checkedDocument(value){
  const wrapper=clone(value),document=clone(originalDocument(value));
  if(document.schema===COHORT_PLAN_COMPARISON_SCHEMA)return {document,comparison:reopenCohortPlanComparison(document)};
  if(document.schema===COHORT_DELIVERY_INPUT_SCHEMA||document.schema===COHORT_DELIVERY_COMPARISON_SCHEMA){
    const recordedDelivery=document.schema===COHORT_DELIVERY_INPUT_SCHEMA?compareCohortDelivery(document):reopenCohortDeliveryComparison(document);
    return {document:recordedDelivery,recordedDelivery};
  }
  let deliverySchedule=null,comparison=null,recordedCostPlan=null;
  if(document.schema===COHORT_RECORDED_COST_PLAN_SCHEMA){recordedCostPlan=reopenCohortRecordedCostPlan(document);comparison=recordedCostPlan.comparison;}
  if(document.recordedCostPlan){
    recordedCostPlan=reopenCohortRecordedCostPlan(document.recordedCostPlan);
    need(same(document.recordedCostPlanComparison,compareCohortPlans(recordedCostPlan,document.plan)),
      'GRANT_ADOPTION_REPORT','Keep the complete comparison from the recorded-cost proposal to this saved successor.');
  }
  if(wrapper.schema===COHORT_ADOPTION_REVIEW_SCHEMA){
    if(wrapper.recordedCostPlan)recordedCostPlan=reopenCohortRecordedCostPlan(wrapper.recordedCostPlan);
    if(wrapper.comparison)comparison=reopenCohortPlanComparison(wrapper.comparison);
    if(wrapper.deliverySchedule)deliverySchedule=reopenCohortDeliverySchedule(wrapper.deliverySchedule);
  }
  if(document.schema===COHORT_DELIVERY_SCHEDULE_SCHEMA)deliverySchedule=reopenCohortDeliverySchedule(document);
  if(document.schema===COHORT_PLAN_EDITION_SCHEMA){
    text(document.editionId,'Original edition identity',300,true);
    timestamp(document.createdAt);text(document.actor,'Original recording operator',300);
    if(document.report!==null&&document.report!==undefined){
      verifyReport(document.report);
      need(same(normalizeCohortPlan(document.plan),document.report.input),'GRANT_ADOPTION_REPORT','The edition plan differs from its retained report input.');
    }
    if(document.deliverySchedule){
      deliverySchedule=reopenCohortDeliverySchedule(document.deliverySchedule);
      need(same(normalizeCohortPlan(document.plan),normalizeCohortPlan(deliverySchedule.candidate)),
        'GRANT_ADOPTION_REPORT','The saved delivery allocation belongs to another candidate.');
    }
    if(document.comparison){
      comparison=reopenCohortPlanComparison(document.comparison);
      need(same(normalizeCohortPlan(document.plan),comparison.after.input),
        'GRANT_ADOPTION_REPORT','The retained comparison has another successor plan.');
    }
  }else if(document.schema===COHORT_PLAN_REPORT_SCHEMA)verifyReport(document);
  const plan=normalizeCohortPlan(planOf(document));
  return {document,plan,deliverySchedule,comparison,recordedCostPlan};
}
async function currentCase(client,selected,expected){
  caseId(selected);version(expected);
  const response=await client.read('case',{caseId:selected}),current=object(response.value,'Native case');
  need(current.program?.id===selected&&current.program.version===expected,'GRANT_ADOPTION_SOURCE_CHANGED',
    'The case changed. Read its current version and review the complete source again.');
  need(typeof current.program.createdAt==='string'&&Array.isArray(current.sources),
    'GRANT_ADOPTION_SOURCE_CHANGED','Retain the original case creation identity and complete source inventory.');
  return {response,current};
}
async function currentSeed(client,current,tranche){
  const response=await client.cohortSeed(current.program.id,current.program.version,tranche);
  const value=object(response.value,'Full native cohort seed');
  need(value.source?.programId===current.program.id&&value.source.version===current.program.version,
    'GRANT_ADOPTION_SOURCE_CHANGED','The native seed belongs to another case or version.');
  return value;
}

async function currentDeliverySources(client,current,comparison){
  need(comparison.source.programId===current.program.id,'GRANT_ADOPTION_SOURCE_CHANGED',
    'Continue the recorded delivery comparison in its original Operations case.');
  const selected=sourceId(comparison.input.recording.planSourceId);
  const plan=current.sources.find(row=>row.id===selected);
  need(plan,'GRANT_ADOPTION_SOURCE_CHANGED','Select the original saved adoption source in this case.');
  const original=await client.download('source',{caseId:current.program.id,sourceId:selected});
  need(Buffer.isBuffer(original.bytes)&&original.bytes.length===plan.bytes&&hash(original.bytes)===plan.sha256&&
    same(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes)),comparison.input.planDocument),
    'GRANT_ADOPTION_SOURCE_CHANGED','The recorded delivery comparison has a different original saved adoption source.');
  const response=await client.read('review',{caseId:current.program.id,reviewId:comparison.source.reviewId});
  need(same(response.value,comparison.input.review),'GRANT_ADOPTION_SOURCE_CHANGED',
    'Select the complete original frozen review. Its recorded observations differ from this comparison.');
  return {plan:clone(plan),review:{id:response.value.id,version:response.value.version,
    businessSha256:response.value.businessSha256,measurementSha256:response.value.cohort.source.measurementSha256,
    previewSha256:response.value.cohort.previewSha256}};
}

async function currentTaskMeasurementSources(client,current,costPlan){
  const selected=new Map();
  for(const row of costPlan.choices.allocations){
    for(const basis of [row.measurement,...(row.measurementHistory||[]).map(previous=>previous.measurement)].filter(Boolean)){
      const catalog=inspectCohortTaskMeasurements(basis.original),key=catalog.sourceId,prior=selected.get(key);
      need(!prior||same(prior.original.source,catalog.original.source)&&same(prior.original.edition,catalog.original.edition),
        'GRANT_ADOPTION_MEASUREMENT_CHANGED','One original measurement source cannot carry conflicting saved editions.');
      selected.set(key,catalog);
    }
  }
  for(const catalog of selected.values()){
    const original=catalog.original,source=current.sources.find(row=>row.id===catalog.sourceId);
    need(source&&same(source,original.source),'GRANT_ADOPTION_MEASUREMENT_CHANGED',
      'The selected task measurement source differs from this case. Keep the old basis and explicitly select its current original.');
    const saved=await client.read('task-outcome',{caseId:current.program.id,comparisonId:catalog.comparisonId,revision:catalog.revision});
    need(same(saved.value?.source,original.source)&&same(saved.value?.edition,original.edition),
      'GRANT_ADOPTION_MEASUREMENT_CHANGED','The complete selected Task Outcomes revision differs from its native original. Select that saved revision again.');
  }
}

function sourceCase(current){
  const p=current.program;
  return {id:p.id,createdAt:p.createdAt,version:p.version,planId:p.planId,planRevision:p.planRevision,
    state:p.state,name:p.name};
}

export async function seedGrantCohortAdoption(client,selected,options){
  exact(options,['expectedVersion','source','tranche','installationRefs','groupId','asOfAt','name','draftId','windowStart'],
    ['expectedVersion','source']);
  need(['CASE','CALENDAR'].includes(options.source),'GRANT_ADOPTION_INPUT','Choose CASE or the saved CALENDAR source.');
  const {current}=await currentCase(client,selected,options.expectedVersion);
  const seedOptions={planId:current.program.planId,planRevision:current.program.planRevision};
  for(const key of ['name','draftId','asOfAt','windowStart'])if(options[key]!==undefined)seedOptions[key]=options[key];
  let nativeSeed,calendarSelection=null,plan;
  if(options.source==='CASE'){
    need([2,3].includes(options.tranche)&&!['groupId','installationRefs'].some(k=>options[k]!==undefined),
      'GRANT_ADOPTION_INPUT','A case seed selects tranche 2 or 3.');
    nativeSeed=await currentSeed(client,current,options.tranche);
    plan=seedCohortPlan(nativeSeed,seedOptions);
  }else{
    need(typeof options.groupId==='string'&&options.groupId&&options.tranche===undefined&&options.windowStart===undefined,
      'GRANT_ADOPTION_INPUT','Select one saved Calendar group; its original tranche and window travel with it.');
    const selection={expectedVersion:options.expectedVersion};
    if(options.installationRefs!==undefined)selection.installationRefs=options.installationRefs;
    const calendar=await client.customerUseCalendar(selected,selection);
    calendarSelection=calendar.value;
    const cohort=await client.customerUseCalendarCohort(selected,{...selection,groupId:options.groupId,
      ...(options.asOfAt===undefined?{}:{asOfAt:options.asOfAt})});
    nativeSeed=cohort.value;
    plan=seedCohortPlanFromCalendar(nativeSeed,calendarSelection,{...seedOptions,groupId:options.groupId});
  }
  return {schema:COHORT_ADOPTION_SEED_SCHEMA,sourceKind:options.source,case:sourceCase(current),
    nativeSeed:clone(nativeSeed),...(calendarSelection?{calendarSelection:clone(calendarSelection)}:{}),
    plan,report:evaluateCohortPlan(plan,{nativeSeed}),schedulingChoices:seedCohortDeliveryScheduling(plan)};
}

export function reviewCohortAdoption(value,{nativeSeed}={}){
  const checked=checkedDocument(value);
  if(checked.recordedDelivery)return {schema:COHORT_ADOPTION_REVIEW_SCHEMA,document:checked.document,
    recordedDelivery:{summary:clone(checked.recordedDelivery.summary),source:clone(checked.recordedDelivery.source),issues:clone(checked.recordedDelivery.issues)}};
  if(checked.comparison&&!checked.plan)return {schema:COHORT_ADOPTION_REVIEW_SCHEMA,
    document:checked.document,comparison:checked.comparison};
  const retained=checked.document.schema===COHORT_PLAN_REPORT_SCHEMA?checked.document:checked.document.report;
  const comparison=retained?.sourceComparison;
  const selectedSeed=nativeSeed??value.nativeSeed??checked.document.nativeSeed??(comparison?.currentSource&&comparison?.currentRule
    ?{source:comparison.currentSource,rule:comparison.currentRule}:undefined);
  const report=evaluateCohortPlan(checked.plan,{nativeSeed:selectedSeed});
  return {schema:COHORT_ADOPTION_REVIEW_SCHEMA,document:checked.document,plan:checked.plan,report,
    ...(checked.recordedCostPlan?{recordedCostPlan:checked.recordedCostPlan}:{}),
    ...(checked.deliverySchedule?{deliverySchedule:checked.deliverySchedule}:{}),
    ...(checked.comparison?{comparison:checked.comparison}:{})};
}
export async function reviewGrantCohortAdoption(client,selected,expected,document){
  const {current}=await currentCase(client,selected,expected),checked=checkedDocument(document);
  if(checked.recordedDelivery)return {...reviewCohortAdoption(document),case:sourceCase(current),
    nativeSources:await currentDeliverySources(client,current,checked.recordedDelivery)};
  if(!checked.plan)return {...reviewCohortAdoption(document),case:sourceCase(current)};
  if(checked.recordedCostPlan){await currentDeliverySources(client,current,checked.recordedCostPlan.sourceDocument);await currentTaskMeasurementSources(client,current,checked.recordedCostPlan);}
  const nativeSeed=await currentSeed(client,current,checked.plan.rule.target.tranche);
  return {...reviewCohortAdoption(document,{nativeSeed}),case:sourceCase(current),nativeSeed};
}

function mergeEditableFields(original,fields,depth=0){
  need(depth<=16,'GRANT_ADOPTION_INPUT','Keep editable field nesting within the native plan structure.');
  return Object.fromEntries([...new Set([...Object.keys(original??{}),...Object.keys(fields)])].map(key=>{
    if(!Object.hasOwn(fields,key))return [key,clone(original[key])];
    const value=plain(fields[key])&&plain(original?.[key])?mergeEditableFields(original[key],fields[key],depth+1):clone(fields[key]);
    return [key,value];
  }));
}
/** Apply explicit whole-row edits while retaining the complete predecessor comparison. */
export function editCohortAdoption(document,changes,{title,note=''}={}){
  const checked=checkedDocument(document);
  if(Array.isArray(changes)&&changes.length===1&&changes[0].action==='FROM_RECORDED_COSTS'){
    const change=exact(changes[0],['action','recordedDocument','choices'],['action','recordedDocument','choices']);
    need(checked.plan,'GRANT_ADOPTION_INPUT','Select a complete future plan.');
    const result=planCohortFromRecordedCosts(change.recordedDocument,checked.document,change.choices);
    return reviewCohortAdoption(result);
  }
  need(checked.plan&&Array.isArray(changes)&&changes.length>0&&changes.length<=2000,
    'GRANT_ADOPTION_INPUT','Select a complete plan and explicit row or plan edits.');
  const plan=clone(checked.plan),collections=['buyers','merchants','facilitators','operations','schedules','workshares','capacityPools','fundingGroups'];
  for(const change of changes){
    exact(change,['action','collection','id','fields','value','beforeId'],['action']);
    if(change.action==='PLAN'){
      need(change.collection===undefined&&change.id===undefined&&change.value===undefined&&change.beforeId===undefined,
        'GRANT_ADOPTION_INPUT','A plan edit selects complete editable plan fields.');
      exact(change.fields,['name','asOfAt','windowStart','calendar','sensitivity','note','deliveryScheduling']);
      Object.assign(plan,mergeEditableFields(plan,change.fields));continue;
    }
    need(collections.includes(change.collection)&&['UPDATE','ADD','REMOVE'].includes(change.action),
      'GRANT_ADOPTION_INPUT','Select an original plan collection and UPDATE, ADD or REMOVE.');
    const rows=plan[change.collection],index=rows.findIndex(row=>row.id===change.id);
    if(change.action==='UPDATE'){
      need(index>=0&&plain(change.fields)&&change.value===undefined&&change.beforeId===undefined&&
        !['id','origin'].some(key=>Object.hasOwn(change.fields,key)),'GRANT_ADOPTION_INPUT',
        'Update the selected original row fields while keeping its identity and source origin.');
      rows[index]=mergeEditableFields(rows[index],change.fields);
    }else if(change.action==='REMOVE'){
      need(index>=0&&change.fields===undefined&&change.value===undefined&&change.beforeId===undefined,
        'GRANT_ADOPTION_INPUT','Remove an explicitly selected original row.');
      rows.splice(index,1);
    }else{
      need(plain(change.value)&&change.id===undefined&&change.fields===undefined&&!rows.some(row=>row.id===change.value.id),
        'GRANT_ADOPTION_INPUT','Add one complete row with a distinct identity.');
      const at=change.beforeId===undefined?rows.length:rows.findIndex(row=>row.id===change.beforeId);
      need(at>=0,'GRANT_ADOPTION_INPUT','Select an existing row for the explicit insertion position.');
      rows.splice(at,0,clone(change.value));
    }
  }
  const normalized=normalizeCohortPlan(plan),report=evaluateCohortPlan(normalized);
  return {schema:COHORT_ADOPTION_REVIEW_SCHEMA,document:normalized,plan:normalized,report,changes:clone(changes),...(checked.recordedCostPlan?{recordedCostPlan:clone(checked.recordedCostPlan)}:{}),
    comparison:compareCohortPlans(checked.document,normalized,{title:title??normalized.name+' · complete plan edits',note})};
}

export function scheduleCohortAdoption(input){
  exact(input,['document','constraints','name','method','maxSearchSteps'],['document']);
  const checked=checkedDocument(input.document);
  need(checked.plan,'GRANT_ADOPTION_INPUT','Schedule one complete editable plan.');
  const options=Object.fromEntries(['name','method','maxSearchSteps']
    .filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
  return scheduleCohortDelivery(checked.document,input.constraints,options);
}
export function compareCohortAdoption(input){
  exact(input,['beforeDocument','afterDocument','options'],['beforeDocument','afterDocument']);
  const a=checkedDocument(input.beforeDocument),b=checkedDocument(input.afterDocument);
  need(a.plan&&b.plan,'GRANT_ADOPTION_INPUT','Choose complete baseline and successor plans.');
  return compareCohortPlans(a.document,b.document,input.options??{});
}
export async function rebaseGrantCohortAdoption(client,selected,expected,document){
  const {current}=await currentCase(client,selected,expected),checked=checkedDocument(document);
  need(checked.plan?.source.programId===selected,'GRANT_ADOPTION_SOURCE_CHANGED','Rebase the complete plan in its original Operations case.');
  const nativeSeed=await currentSeed(client,current,checked.plan.rule.target.tranche);
  const plan=normalizeCohortPlan({...clone(checked.plan),source:{...clone(nativeSeed.source),
    planId:current.program.planId,planRevision:current.program.planRevision},rule:clone(nativeSeed.rule)});
  return {schema:COHORT_ADOPTION_REVIEW_SCHEMA,case:sourceCase(current),document:plan,plan,nativeSeed,...(checked.recordedCostPlan?{recordedCostPlan:clone(checked.recordedCostPlan)}:{}),
    report:evaluateCohortPlan(plan,{nativeSeed}),
    comparison:compareCohortPlans(checked.document,plan,{title:plan.name+' · current source',note:'Explicit rebase on the original current case; the complete previous document is retained.'})};
}

export function cohortAdoptionPreparedSha256(value){
  const {preparedSha256,...body}=object(value,'Prepared adoption edition');
  return hash(Buffer.from(canonical(body),'utf8'));
}
export async function prepareGrantCohortAdoption(client,selected,body){
  exact(body,['expectedVersion','requestId','actor','note','createdAt','document','parentSourceId','expectedParentSha256'],
    ['expectedVersion','requestId','actor','note','createdAt','document']);
  requestId(body.requestId);text(body.actor,'Recording operator',300,true);text(body.note,'Save note');timestamp(body.createdAt);
  const {current}=await currentCase(client,selected,body.expectedVersion);
  need(current.program.state==='OPEN','GRANT_ADOPTION_CASE_CLOSED','Reopen the original case before preparing a new source edition.');
  const checked=checkedDocument(body.document);
  let nativeSeed=null,parent=null;
  if(body.parentSourceId!==undefined){
    sourceId(body.parentSourceId);digest(body.expectedParentSha256);
    parent=current.sources.find(row=>row.id===body.parentSourceId);
    need(parent?.sha256===body.expectedParentSha256,'GRANT_ADOPTION_SOURCE_CHANGED','The selected predecessor source differs from its original file identity.');
  }else need(body.expectedParentSha256===undefined,'GRANT_ADOPTION_INPUT','A predecessor SHA needs its original source ID.');
  const editionId='cohort-edition-'+hash(Buffer.from(current.program.createdAt+'\0'+selected+'\0'+body.requestId)).slice(0,32);
  let document,filename;
  if(checked.recordedDelivery){
    need(!parent,'GRANT_ADOPTION_INPUT','The recorded delivery comparison retains its original saved plan and frozen review.');
    await currentDeliverySources(client,current,checked.recordedDelivery);
    const input=clone(checked.recordedDelivery.input);
    input.recording={...input.recording,editionId:'cohort-delivery-'+editionId.slice('cohort-edition-'.length),
      createdAt:body.createdAt,actor:body.actor};
    document=compareCohortDelivery(input);
    filename='sf47-cohort-delivery-'+input.recording.editionId+'.json';
  }else if(checked.plan){
    need(checked.plan.source.programId===selected,'GRANT_ADOPTION_SOURCE_CHANGED','Save this plan in its original Operations case.');
    if(checked.recordedCostPlan){await currentDeliverySources(client,current,checked.recordedCostPlan.sourceDocument);await currentTaskMeasurementSources(client,current,checked.recordedCostPlan);}
    nativeSeed=await currentSeed(client,current,checked.plan.rule.target.tranche);
    const report=evaluateCohortPlan(checked.plan,{nativeSeed});
    const comparison=checked.deliverySchedule?compareCohortPlans(checked.deliverySchedule.sourceDocument,checked.deliverySchedule.candidate,
      {title:checked.deliverySchedule.candidate.name+' · delivery allocation',note:checked.deliverySchedule.constraints.note||''})
      :checked.comparison;
    document={schema:COHORT_PLAN_EDITION_SCHEMA,editionId,createdAt:body.createdAt,actor:body.actor,
      parentSourceId:parent?.id??null,plan:clone(checked.plan),report,nativeSeed:clone(nativeSeed),
      ...(checked.recordedCostPlan?{recordedCostPlan:clone(checked.recordedCostPlan),recordedCostPlanComparison:compareCohortPlans(checked.recordedCostPlan,checked.plan)}:{}),
      ...(checked.deliverySchedule?{deliverySchedule:clone(checked.deliverySchedule)}:{}),
      ...(comparison?{comparison:clone(comparison)}:{})};
    filename='sf47-cohort-plan-tranche-'+checked.plan.rule.target.tranche+'-'+editionId+'.json';
  }else{
    need(!parent,'GRANT_ADOPTION_INPUT','A complete comparison retains its two original documents; select predecessor sources in those documents.');
    need([checked.comparison.before.source.programId,checked.comparison.after.source.programId].includes(selected),
      'GRANT_ADOPTION_SOURCE_CHANGED','Save the complete comparison in one of its original cases.');
    document=clone(checked.comparison);
    filename='sf47-cohort-plan-comparison-'+editionId+'.json';
  }
  const bytes=rawJson(document);
  need(bytes.length<=MAX_SOURCE,'GRANT_ADOPTION_SOURCE_LIMIT','The complete edition exceeds the original 8 MiB source attachment. Keep the full document and adjust its scope before saving.');
  const request={expectedVersion:body.expectedVersion,requestId:body.requestId,actor:body.actor,note:body.note,
    action:'source.add',data:{kind:'other',filename,contentBase64:bytes.toString('base64'),mediaType:'application/json',
      sourceUrl:'',observedAt:body.createdAt}};
  const prepared={schema:COHORT_ADOPTION_PREPARED_SCHEMA,caseId:selected,caseCreatedAt:current.program.createdAt,
    case:sourceCase(current),document,nativeSeed,parentSource:parent?clone(parent):null,
    sourceFile:{filename,mediaType:'application/json',bytes:bytes.length,sha256:hash(bytes)},request};
  return {...prepared,preparedSha256:cohortAdoptionPreparedSha256(prepared)};
}
export function validateCohortAdoptionPrepared(value,expectedSha256){
  const prepared=object(value,'Complete prepared adoption edition');
  exact(prepared,['schema','caseId','caseCreatedAt','case','document','nativeSeed','parentSource','sourceFile','request','preparedSha256'],
    ['schema','caseId','caseCreatedAt','case','document','nativeSeed','parentSource','sourceFile','request','preparedSha256']);
  need(prepared.schema===COHORT_ADOPTION_PREPARED_SCHEMA,'GRANT_ADOPTION_PREPARED_CHANGED','Select the complete original prepared edition.');
  caseId(prepared.caseId);digest(expectedSha256);
  need(prepared.preparedSha256===expectedSha256&&cohortAdoptionPreparedSha256(prepared)===expectedSha256,
    'GRANT_ADOPTION_PREPARED_CHANGED','The complete prepared document differs from the reviewed SHA256.');
  const r=prepared.request;
  exact(r,['expectedVersion','requestId','actor','note','action','data'],['expectedVersion','requestId','actor','note','action','data']);
  version(r.expectedVersion);requestId(r.requestId);text(r.actor,'Recording operator',300,true);text(r.note,'Save note');
  exact(r.data,['kind','filename','contentBase64','mediaType','sourceUrl','observedAt'],
    ['kind','filename','contentBase64','mediaType','sourceUrl','observedAt']);
  timestamp(r.data.observedAt);
  need(r.action==='source.add'&&r.data.kind==='other'&&r.data.mediaType==='application/json'&&r.data.sourceUrl==='',
    'GRANT_ADOPTION_PREPARED_CHANGED','An adoption save uses the original JSON source.add command.');
  need(typeof r.data.contentBase64==='string','GRANT_ADOPTION_PREPARED_CHANGED','Retain all original attachment bytes.');
  const bytes=Buffer.from(r.data.contentBase64,'base64');
  need(bytes.length<=MAX_SOURCE&&bytes.toString('base64')===r.data.contentBase64&&
    same(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),prepared.document)&&
    same(prepared.sourceFile,{filename:r.data.filename,mediaType:r.data.mediaType,bytes:bytes.length,sha256:hash(bytes)}),
    'GRANT_ADOPTION_PREPARED_CHANGED','Retain the exact complete source bytes and original file metadata.');
  need(prepared.case.id===prepared.caseId&&prepared.case.createdAt===prepared.caseCreatedAt&&
    prepared.case.version===r.expectedVersion,'GRANT_ADOPTION_PREPARED_CHANGED','The prepared command belongs to another original case/version.');
  const checked=checkedDocument(prepared.document);
  if(checked.recordedDelivery)need(prepared.nativeSeed===null&&prepared.parentSource===null&&
    checked.recordedDelivery.source.programId===prepared.caseId&&
    checked.recordedDelivery.input.recording.actor===r.actor&&checked.recordedDelivery.input.recording.createdAt===r.data.observedAt,
    'GRANT_ADOPTION_PREPARED_CHANGED','Retain the complete original recorded delivery comparison and recording operator.');
  else if(checked.plan)need(same(prepared.document.nativeSeed,prepared.nativeSeed)&&checked.plan.source.programId===prepared.caseId&&prepared.nativeSeed?.source?.programId===prepared.caseId&&
    prepared.nativeSeed.source.version===r.expectedVersion&&same(prepared.document.report,evaluateCohortPlan(checked.plan,{nativeSeed:prepared.nativeSeed})),
    'GRANT_ADOPTION_PREPARED_CHANGED','The edition must retain its complete selected native source and calculated report.');
  else need([checked.comparison.before.source.programId,checked.comparison.after.source.programId].includes(prepared.caseId),
    'GRANT_ADOPTION_PREPARED_CHANGED','The comparison has another original case.');
  if(prepared.parentSource)need(prepared.document.parentSourceId===prepared.parentSource.id&&prepared.parentSource.sha256,
    'GRANT_ADOPTION_PREPARED_CHANGED','The prepared edition changed its original predecessor source.');
  return prepared;
}
function acceptedValue(accepted){
  if(!accepted)return null;
  if(accepted.value)return accepted.value;
  return accepted;
}
function sourceMatches(row,prepared){
  const d=prepared.request.data,f=prepared.sourceFile;
  return row&&row.filename===f.filename&&row.sha256===f.sha256&&row.bytes===f.bytes&&
    row.mediaType===f.mediaType&&row.kind===d.kind&&row.sourceUrl===d.sourceUrl&&row.observedAt===d.observedAt;
}
export async function inspectGrantCohortAdoptionRequest(client,prepared,expectedSha256,{acceptedResult}={}){
  validateCohortAdoptionPrepared(prepared,expectedSha256);
  const current=(await client.read('case',{caseId:prepared.caseId})).value;
  need(current?.program?.id===prepared.caseId&&current.program.createdAt===prepared.caseCreatedAt,
    'GRANT_ADOPTION_CASE_CHANGED','Restore the original case creation identity before continuing this request.');
  const history=(await client.read('case-history',{caseId:prepared.caseId,after:prepared.request.expectedVersion,limit:1})).value;
  need(Array.isArray(history?.events),'GRANT_ADOPTION_HISTORY','Read the original complete event at the prepared version.');
  const event=history.events.find(row=>row.version===prepared.request.expectedVersion+1&&row.requestId===prepared.request.requestId);
  const accepted=acceptedValue(acceptedResult);
  if(accepted)need(accepted.id===prepared.caseId&&accepted.version===prepared.request.expectedVersion+1&&
    accepted.action==='source.add'&&accepted.kind==='source'&&typeof accepted.recordId==='string',
    'GRANT_ADOPTION_RESPONSE_CHANGED','The accepted original response belongs to another prepared source request.');
  if(event){
    need(event.action==='source.add'&&event.kind==='source'&&event.actor===prepared.request.actor&&
      event.note===prepared.request.note&&sourceMatches(event.after,prepared)&&event.recordId===event.after.id,
      'GRANT_ADOPTION_REQUEST_CHANGED','The original event differs from the complete prepared source command.');
    if(accepted)need(accepted.recordId===event.recordId,'GRANT_ADOPTION_RESPONSE_CHANGED','The accepted result differs from the original source event.');
    const row=current.sources.find(source=>source.id===event.recordId);
    need(sourceMatches(row,prepared),'GRANT_ADOPTION_SOURCE_CHANGED','The original saved source is absent or changed in the current case.');
    return {state:'COMMITTED',case:sourceCase(current),event,source:row,acceptedResult:accepted};
  }
  need(!accepted,'GRANT_ADOPTION_COMMITMENT_MISSING','The retained accepted response requires its matching original case state before this request can continue.');
  need(current.program.version===prepared.request.expectedVersion&&history.events.length===0,
    'GRANT_ADOPTION_CASE_CHANGED','Another original case change occupies the prepared version. Review the complete plan against current source before preparing a new request.');
  need(current.program.state==='OPEN','GRANT_ADOPTION_CASE_CLOSED','Reopen the original case before continuing its pending source command.');
  return {state:'PREPARED',case:sourceCase(current),event:null,source:null,acceptedResult:null};
}
export async function saveGrantCohortAdoption(client,prepared,expectedSha256,{acceptedResponse,retainResponse}={}){
  need(typeof retainResponse==='function','GRANT_ADOPTION_RETENTION_REQUIRED','Use the existing caller to durably retain the complete native response before source readback.');
  const status=await inspectGrantCohortAdoptionRequest(client,prepared,expectedSha256,{acceptedResult:acceptedResponse});
  let response=acceptedResponse;
  if(!response){
    const {action,data,...request}=prepared.request,{contentBase64,...fields}=data;
    response=await client.attach(prepared.caseId,Buffer.from(contentBase64,'base64'),{...clone(request),...clone(fields)});
    await retainResponse(response);
  }
  const value=acceptedValue(response);
  const committed=await inspectGrantCohortAdoptionRequest(client,prepared,expectedSha256,{acceptedResult:value});
  need(committed.state==='COMMITTED','GRANT_ADOPTION_COMMITMENT_MISSING','Reconcile this exact original source command before continuing.');
  const original=await client.download('source',{caseId:prepared.caseId,sourceId:committed.source.id});
  need(Buffer.isBuffer(original.bytes)&&original.bytes.length===prepared.sourceFile.bytes&&hash(original.bytes)===prepared.sourceFile.sha256&&
    original.bytes.equals(Buffer.from(prepared.request.data.contentBase64,'base64')),'GRANT_ADOPTION_SOURCE_CHANGED','The complete reopened source differs from the reviewed edition bytes.');
  return {...reviewCohortAdoption(prepared.document,{nativeSeed:prepared.nativeSeed??undefined}),schema:COHORT_ADOPTION_SAVED_SCHEMA,preparedSha256:expectedSha256,case:committed.case,
    originalRequestId:prepared.request.requestId,receipt:clone(value),source:clone(committed.source),
    recovered:status.state==='COMMITTED'};
}
export async function openGrantCohortAdoption(client,selected,selectedSource,expectedSourceSha256){
  caseId(selected);sourceId(selectedSource);digest(expectedSourceSha256);
  const current=(await client.read('case',{caseId:selected})).value;
  need(current?.program?.id===selected&&Array.isArray(current.sources),'GRANT_ADOPTION_SOURCE_CHANGED','Read the selected native case.');
  const source=current.sources.find(row=>row.id===selectedSource);
  need(source?.sha256===expectedSourceSha256,'GRANT_ADOPTION_SOURCE_CHANGED','Keep the exact selected source ID and SHA256.');
  const response=await client.download('source',{caseId:selected,sourceId:selectedSource});
  need(Buffer.isBuffer(response.bytes)&&response.bytes.length===source.bytes&&hash(response.bytes)===source.sha256,
    'GRANT_ADOPTION_SOURCE_CHANGED','The complete source download differs from its native metadata.');
  const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes));
  return {...reviewCohortAdoption(document),case:sourceCase(current),source:clone(source)};
}
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=v=>String(v).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
const cell=v=>v===null||v===undefined?'Unspecified':typeof v==='object'?canonical(v):String(v);
function table(title,rows,keys){
  if(!Array.isArray(rows)||!rows.length)return '<section><h2>'+escape(title)+'</h2><p>No rows.</p></section>';
  return '<section><h2>'+escape(title)+'</h2><div class="table"><table><thead><tr>'+keys.map(k=>'<th>'+escape(label(k))+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+keys.map(k=>'<td>'+escape(cell(row[k]))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div></section>';
}
function reportHtml(report){
  let html=table('Workload',Object.entries(report.summary).map(([metric,value])=>({metric,value})),['metric','value']);
  html+=table('Original proposed targets',report.targets,['key','expected','planned','gap','status']);
  html+=table('Commercial totals',report.currencies,['currency','revenue','supplierCost','paymentFees','activeHours','laborCost','totalCost','contribution','marginPercent','complete','unknownRecordCounts']);
  html+=table('Every useful occurrence',report.occurrences,['id','date','sourceDate','scheduleId','operationId','buyerId','merchantId','fundingGroupIds','scheduledTasks','scheduledRequests','plannedPaymentRequests','plannedCompleteAt','withinWindow','economics']);
  html+=table('Daily workload',report.days,['date','scheduledTasks','scheduledRequests','plannedPaymentRequests','plannedCompleteTasks','plannedPaidPurchases']);
  html+=table('Daily capacity',(report.capacity?.pools??[]).flatMap(p=>p.days),['poolId','date','availableHours','requiredHours','headroomHours','additionalHoursKnownMinimum','status','scheduleIds']);
  html+=table('Service pricing',report.servicePricing?.services??report.servicePricing??[],['id','label','status','currency','scheduledTasks','chargeUnits','revenue','totalCost','breakEvenUnitRevenue','targetUnitRevenue']);
  html+=table('Funding groups',report.fundingGroups??[],['id','label','kind','date','origin','operationId','buyerId','facilitatorId','scheduledTasks','plannedPaymentRequests','economics']);
  html+=table('Operating findings',report.findings,['severity','code','scope','id','message']);
  return html;
}
export function exportCohortAdoption(document,format='JSON'){
  need(['JSON','CSV','HTML'].includes(format),'GRANT_ADOPTION_INPUT','Choose JSON, CSV or HTML.');
  const checked=checkedDocument(document),original=checked.document;
  const title=checked.plan?.name??checked.comparison?.review?.title??'Cohort adoption';
  if(checked.recordedDelivery){
    const bytes=format==='JSON'?rawJson(document):Buffer.from(format==='CSV'
      ?exportCohortDeliveryCsv(checked.recordedDelivery):exportCohortDeliveryHtml(checked.recordedDelivery),'utf8');
    return {bytes,sha256:hash(bytes),filename:'cohort-delivery.'+format.toLowerCase(),
      mediaType:format==='JSON'?'application/json':format==='CSV'?'text/csv; charset=utf-8':'text/html; charset=utf-8'};
  }
  let bytes,mediaType,extension;
  if(format==='JSON'){bytes=rawJson(document);mediaType='application/json';extension='json';}
  if(format==='CSV'){
    const value=checked.recordedCostPlan?exportCohortRecordedCostPlanCsv(checked.recordedCostPlan)+['saved_successor','current',JSON.stringify(document)].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')+'\r\n':original.schema===COHORT_PLAN_COMPARISON_SCHEMA?exportCohortPlanComparisonCsv(checked.comparison):
      checked.deliverySchedule?exportCohortDeliveryScheduleCsv(checked.deliverySchedule):exportCohortPlanCsv(reviewCohortAdoption(document).report);
    bytes=Buffer.from(value,'utf8');mediaType='text/csv; charset=utf-8';extension='csv';
  }
  if(format==='HTML'){
    let html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
      escape(title)+'</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#222;margin:32px;max-width:1500px}h1{font-size:26px}h2{font-size:19px;margin-top:28px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f2f2f2}td{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:24px}@media print{body{margin:12mm}tr{break-inside:avoid}}</style></head><body><h1>'+
      escape(title)+'</h1><p>Complete adoption planning document</p>';
    if(checked.plan){
      const report=reviewCohortAdoption(document).report;
      html+='<p>Original case '+escape(report.source.programId)+' · tranche '+escape(report.window.tranche)+' · '+
        escape(report.window.start)+' through '+escape(report.window.end)+'</p>'+reportHtml(report);
    }else{
      html+='<h2>Baseline</h2>'+reportHtml(checked.comparison.before)+'<h2>Successor</h2>'+reportHtml(checked.comparison.after);
      html+=table('Comparison findings',checked.comparison.findings,['code','message']);
    }
    if(checked.recordedCostPlan){
      html+=table('Recorded cost basis',checked.recordedCostPlan.derivations,['targetScheduleId','sourceServiceId','outputQuantity','outputUnit','outputSource','supplierCoverage','laborCoverage','derivedEconomics','coverageNote']);
      html+=table('Selected task measurements',checked.recordedCostPlan.derivations.filter(row=>row.measurement).map(row=>({targetScheduleId:row.targetScheduleId,...row.measurement})),['targetScheduleId','customer','task','comparisonId','revision','kind','observationId','quantity','unit','basis','status','acceptance','method','serviceBasis']);
      html+=table('Original cost portions',checked.recordedCostPlan.costBalances,['costId','costType','selectedShare','unselectedShare']);
    }
    if(checked.deliverySchedule){
      const allocation=checked.deliverySchedule;
      html+='<h2>Delivery allocation method</h2><p>'+escape(allocation.method)+'</p>';
      html+=table('Allocation result',[allocation.summary],
        ['status','occurrences','moved','fixed','unresolved','capacityBefore','capacityAfter']);
      if(allocation.resolution){
        const resolution=allocation.resolution;
        html+=table('Resolve competing dates',[resolution],
          ['method','maxSearchSteps','visitedSteps','reconsideredGroups','resolvedGroups','revisedDates']);
        html+=table('Complete competing service groups',resolution.components,
          ['groupIds','occurrenceIds','status','visitedSteps','revisedDates']);
      }
      html+=table('Complete delivery allocation',allocation.assignments,
        ['occurrenceId','sourceDate','originalDate','date','scheduledTasks','scheduledRequests','requiredHours','capacityPoolId','fundingGroupIds','status','fixedReason','permittedDates','rejectedDates','issues']);
    }
    if(checked.comparison&&checked.plan)html+=table('Comparison targets',checked.comparison.targets,['key','expected','planned','gap']);
    html+='<details><summary>Complete original editable document and source</summary><pre>'+escape(JSON.stringify(document,null,2))+'</pre></details></body></html>';
    bytes=Buffer.from(html,'utf8');mediaType='text/html; charset=utf-8';extension='html';
  }
  return {bytes,sha256:hash(bytes),mediaType,filename:'cohort-adoption.'+extension};
}
