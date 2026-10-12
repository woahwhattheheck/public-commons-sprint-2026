// MIT. Saved refresh plans compose the original Fiscal capture, review and delivery engines.
import { randomUUID } from 'node:crypto';
import { identity, fault, object } from '../postgres/publisher/files.mjs';
import { sourceQuery } from './capture.mjs';

export const FISCAL_REFRESH_PLAN='stellar-forge.fiscaldata-refresh-plan.v1';
export const FISCAL_REFRESH_RUN='stellar-forge.fiscaldata-refresh-run.v1';
export const FISCAL_REFRESH_ACTIONS=Object.freeze([
 'refresh.plans.list','refresh.plans.get','refresh.plans.save',
 'refresh.runs.list','refresh.runs.get','refresh.runs.preview','refresh.runs.start','refresh.runs.pause',
 'refresh.runs.resume','refresh.runs.cancel','refresh.runs.review','refresh.baseline.promote'
]);
const HASH=/^[a-f0-9]{64}$/;
const TERMINAL=new Set(['COMPLETE','CANCELLED']);
const REVIEW_ERRORS=new Set(['REFRESH_REVIEW_REQUIRED','REFRESH_REVIEW_CHANGED','REFRESH_COMPARISON_REVIEW',
 'EDITION_FIELDS_REQUIRED','EDITION_FIELD_IDENTITY','EDITION_FIELD_ROLE','FIELD_SCALE_REQUIRED','MEASURE_CONTEXT_REQUIRED',
 'NULL_TOKEN_INVALID','NULL_EMPTY_AMBIGUITY','NULL_TOKEN_COLLISION','QUERY_CONTRACT_CAPACITY','MEASURE_STRING_ORDER',
 'QUERY_LIMIT_ORDER','REVIEW_TEXT_INVALID']);
const REVIEW_KEYS=['fields','keyFields','notes','filters','ranges','sorts','defaultLimit','maxLimit'];
const clone=value=>structuredClone(value);
const clock=()=>new Date().toISOString();
function only(value,keys){
 if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))
  throw fault('REFRESH_FIELDS','Use the documented saved refresh fields.');
}
function text(value,max,required=true){
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||required&&!value.trim())
  throw fault('REFRESH_TEXT','Enter '+(required?'a value':'text')+' within '+max+' characters.');
 return value.trim();
}
function integer(value,min,max,label){
 if(!Number.isSafeInteger(value)||value<min||value>max)throw fault('REFRESH_NUMBER',label+' must be an integer from '+min+' to '+max+'.');
 return value;
}
function sameRevision(record,revision){
 if(record.revision!==revision)throw fault('REFRESH_REVISION_CHANGED','Read the current saved plan or run before changing it.',409);
}
function request(action,input){
 if(typeof input.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(input.requestId))
  throw fault('REQUEST_ID_REQUIRED','Keep the same request ID while continuing this exact refresh input.');
 return{requestKey:action+':'+input.requestId,inputSha256:identity(input)};
}
function exactRequest(saved,pin){
 if(saved.inputSha256!==pin.inputSha256)throw fault('REQUEST_ID_CONFLICT','This request ID belongs to other retained refresh input.',409);
}
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00.000Z'))||
  new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)
  throw fault('REFRESH_DATE','Use a real UTC calendar date as YYYY-MM-DD.');
 return value;
}
function shiftDate(value,days){
 const result=new Date(date(value)+'T00:00:00.000Z');result.setUTCDate(result.getUTCDate()+days);
 return date(result.toISOString().slice(0,10));
}
function names(value,allowed,label,required=false,maximum=128){
 if(!Array.isArray(value)||value.length>maximum||required&&!value.length||new Set(value).size!==value.length||
  value.some(name=>typeof name!=='string'||!allowed.includes(name)))
  throw fault('REFRESH_FIELDS_REQUIRED','Choose distinct reviewed '+label+' from the baseline edition.');
 return [...value];
}
const reviewOf=edition=>Object.fromEntries(REVIEW_KEYS.map(key=>[key,clone(edition[key])]));
const binding=record=>({id:record.id,revision:record.revision,sha256:record.sha256});
const errorOf=error=>({code:typeof error.code==='string'?error.code:'REFRESH_OPERATION_FAILED',message:String(error.message??error)});
export function fiscalRefreshSchema(capture){
 if(!Array.isArray(capture.fields)||!object(capture.metadata))throw fault('REFRESH_CAPTURE_METADATA','Use a complete original capture with its field metadata.',409);
 return capture.fields.map(source=>({source,type:capture.metadata.dataTypes?.[source]??null,
  label:capture.metadata.labels?.[source]??null,format:capture.metadata.dataFormats?.[source]??null}))
  .sort((a,b)=>a.source.localeCompare(b.source));
}
export function fiscalRefreshSchemaChanges(before,after){
 const left=new Map(before.map(field=>[field.source,field])),right=new Map(after.map(field=>[field.source,field]));
 return [...new Set([...left.keys(),...right.keys()])].sort().flatMap(source=>{
  const a=left.get(source),b=right.get(source);
  return identity(a??null)===identity(b??null)?[]:[{source,change:!a?'ADDED':!b?'REMOVED':'CHANGED',before:a??null,after:b??null}];
 });
}
export function fiscalRefreshPeriod(definition,asOf){
 date(asOf);
 const policy=definition.capture;
 if(policy.mode==='source')return{asOf,from:null,through:null,filter:definition.source.filter,sort:definition.source.sort};
 const through=shiftDate(asOf,-policy.lagDays),from=shiftDate(through,1-policy.days);
 return{asOf,from,through,filter:[policy.baseFilter,policy.dateField+':gte:'+from,policy.dateField+':lte:'+through].filter(Boolean).join(','),
  sort:definition.source.sort};
}
export function fiscalRefreshPlanView(record){
 const definition=record.definition;
 return{id:record.id,revision:record.revision,sha256:record.sha256,name:definition.name,
  createdAt:record.createdAt,updatedAt:record.updatedAt,baseline:clone(definition.baseline),
  source:{id:definition.source.id,revision:definition.source.revision,sha256:definition.source.sha256,
   endpoint:definition.source.endpoint},capture:clone(definition.capture),
  comparison:clone(definition.comparison),versions:record.versions.length};
}
export function fiscalRefreshRunView(record){
 return{id:record.id,revision:record.revision,name:record.name,planId:record.planId,
  planRevision:record.planRevision,planSha256:record.planSha256,status:record.status,
  desiredState:record.desiredState,phase:record.phase,createdAt:record.createdAt,updatedAt:record.updatedAt,
  completedAt:record.completedAt??null,asOf:record.asOf,period:clone(record.period),
  source:clone(record.source),capture:clone(record.capture),edition:clone(record.edition),
  comparison:clone(record.comparison),sourceExport:clone(record.sourceExport),briefing:clone(record.briefing),
  delivery:clone(record.delivery),sha256:record.sha256,reviewRequired:record.status==='REVIEW_REQUIRED',
  schemaChanges:record.schemaChanges.length,error:clone(record.error)};
}

/**
 * The original workspace owns storage, its kernel lease, serial writes and worker.
 * These callbacks are internal operations already inside that SAME serial writer;
 * calling the model's public dispatch here would deadlock behind its own action.
 */
export function createFiscalRefreshEngine({list,get,save,sourceVersion,native,findNative,
 deliver,limits,notify=()=>{},now=clock}){
 const plans=()=>list('refresh-plans');
 const runs=()=>list('refresh-runs');
 function plan(id){
  const record=get('refresh-plans',id);
  if(record.schema!==FISCAL_REFRESH_PLAN||identity(record.definition)!==record.sha256||
   !Array.isArray(record.versions)||record.versions.length!==record.revision||
   record.versions.some((version,index)=>version.revision!==index+1||identity(version.definition)!==version.sha256)||
   record.versions.at(-1)?.sha256!==record.sha256)
   throw fault('REFRESH_PLAN_CHANGED','The retained refresh plan differs from its saved definition.',409);
  return record;
 }
 function run(id){
  const record=get('refresh-runs',id);
  if(record.schema!==FISCAL_REFRESH_RUN||identity(record.definition)!==record.planSha256||
   record.completion&&identity(record.completion)!==record.sha256)
   throw fault('REFRESH_RUN_CHANGED','The retained refresh run differs from its original selection.',409);
  return record;
 }
 const event=(record,action,detail={})=>record.events.push({at:now(),action,phase:record.phase,...clone(detail)});
 async function put(record){
  record.revision++;record.updatedAt=now();await save('refresh-runs',record);return record;
 }
 function readPlanRequest(pin){
  for(const record of plans())for(const version of record.versions){
   if(version.requestKey===pin.requestKey){exactRequest(version,pin);return record;}
  }
  return null;
 }
 function readRunRequest(pin){
  const record=runs().find(value=>value.requestKey===pin.requestKey);
  if(record)exactRequest(record,pin);return record??null;
 }
 async function baseline(id,expectedSha256){
  const edition=get('editions',id);
  if(edition.status!=='READY'||!HASH.test(expectedSha256??'')||edition.sha256!==expectedSha256)
   throw fault('REFRESH_BASELINE_CHANGED','Choose the exact READY baseline edition and its SHA-256.',409);
  const capture=get('captures',edition.captureId);
  if(capture.status!=='COMPLETE'||capture.sha256!==edition.captureSha256)
   throw fault('REFRESH_CAPTURE_CHANGED','The baseline must retain its exact complete original capture.',409);
  const source=await sourceVersion(capture.source.id,capture.source.revision);
  if(source.sha256!==capture.source.sha256)throw fault('REFRESH_SOURCE_CHANGED','The original source revision differs from the baseline.',409);
  return{edition,capture,source};
 }
 function capturePolicy(value,edition){
  only(value,['mode','dateField','days','lagDays','baseFilter']);
  if(value.mode==='source'){
   if(Object.keys(value).some(key=>key!=='mode'))throw fault('REFRESH_QUERY_POLICY','An unchanged source query needs only mode: source.');
   return{mode:'source'};
  }
  if(value.mode!=='window')throw fault('REFRESH_QUERY_POLICY','Choose source or window capture mode.');
  if(!edition.fields.some(field=>field.source===value.dateField&&field.role==='date'))
   throw fault('REFRESH_DATE_FIELD','Choose an original source field reviewed as a date.');
  if(typeof value.baseFilter!=='string')throw fault('REFRESH_BASE_FILTER','Record the exact non-window filter, including an explicit empty string.');
  // This is an authored filter. Never guess which clauses of an earlier query to remove.
  return{mode:'window',dateField:value.dateField,days:integer(value.days,1,3660,'Window days'),
   lagDays:integer(value.lagDays??0,0,3660,'Source publication lag days'),baseFilter:text(value.baseFilter,8192,false)};
 }
 function comparisonPolicy(value,edition){
  only(value,['keyFields','measureFields']);
  return{keyFields:names(value.keyFields,edition.fields.map(field=>field.name),'row keys',true,16),
   measureFields:names(value.measureFields,edition.fields.filter(field=>field.role==='measure').map(field=>field.name),'measure fields')};
 }
 function briefingPolicy(value){
  only(value,['title','audience','notes','rowsPerPage']);
  return{title:text(value.title,240),audience:text(value.audience??'',400,false),
   notes:text(value.notes??'',64000,false),rowsPerPage:integer(value.rowsPerPage??200,1,500,'Report rows per page')};
 }
 async function savePlan(input){
  only(input,['id','expectedRevision','requestId','name','baselineEditionId','expectedBaselineSha256','capture','comparison','briefing','notes']);
  const pin=request('refresh.plans.save',input),reused=readPlanRequest(pin);
  if(reused)return clone(reused);
  const old=input.id?plan(input.id):null;if(old)sameRevision(old,input.expectedRevision);
  if(!old&&plans().length>=limits.maxRefreshPlans)throw fault('REFRESH_PLAN_CAPACITY','Keep this workspace within its configured saved-plan capacity.',409);
  if(old&&old.versions.length>=128)throw fault('REFRESH_PLAN_HISTORY_CAPACITY','Create a successor plan; these 128 original revisions remain retained.',409);
  const original=await baseline(input.baselineEditionId,input.expectedBaselineSha256);
  const definition={name:text(input.name,160),baseline:binding(original.edition),source:clone(original.source),
   review:reviewOf(original.edition),schema:fiscalRefreshSchema(original.capture),
   capture:capturePolicy(input.capture??{mode:'source'},original.edition),
   comparison:comparisonPolicy(input.comparison??{keyFields:original.edition.keyFields,measureFields:[]},original.edition),
   briefing:briefingPolicy(input.briefing??{title:text(input.name,160)}),notes:text(input.notes??'',16000,false)};
  fiscalRefreshPeriod(definition,now().slice(0,10)); // Validate the full authored policy before storing it.
  const at=now(),revision=(old?.revision??0)+1,sha256=identity(definition);
  const version={revision,sha256,definition:clone(definition),at,action:'SAVED',...pin};
  const record={id:old?.id??randomUUID(),schema:FISCAL_REFRESH_PLAN,kind:'refresh-plans',revision,
   createdAt:old?.createdAt??at,updatedAt:at,definition,sha256,versions:[...(old?.versions??[]),version]};
  await save('refresh-plans',record);return clone(record);
 }
 async function preview(input){
  only(input,['planId','expectedRevision','expectedPlanSha256','asOf']);
  const selected=plan(input.planId);sameRevision(selected,input.expectedRevision);
  if(!HASH.test(input.expectedPlanSha256??'')||selected.sha256!==input.expectedPlanSha256)
   throw fault('REFRESH_PLAN_SELECTION_CHANGED','Preview the exact saved plan that was reviewed.',409);
  const asOf=date(input.asOf??now().slice(0,10)),period=fiscalRefreshPeriod(selected.definition,asOf);
  const source={...selected.definition.source,filter:period.filter,sort:period.sort};
  return{planId:selected.id,planRevision:selected.revision,planSha256:selected.sha256,asOf,period,
   sourceUrl:sourceQuery(source),baseline:clone(selected.definition.baseline),
   review:clone(selected.definition.review),comparison:clone(selected.definition.comparison)};
 }
 async function start(input){
  only(input,['planId','expectedRevision','expectedPlanSha256','asOf','requestId']);
  const pin=request('refresh.runs.start',input),reused=readRunRequest(pin);if(reused)return clone(reused);
  const selected=plan(input.planId);sameRevision(selected,input.expectedRevision);
  if(!HASH.test(input.expectedPlanSha256??'')||selected.sha256!==input.expectedPlanSha256)
   throw fault('REFRESH_PLAN_SELECTION_CHANGED','Run the exact saved plan that was reviewed.',409);
  const active=runs().find(item=>item.planId===selected.id&&!TERMINAL.has(item.status));
  if(active)throw fault('REFRESH_RUN_ACTIVE','Continue or cancel the existing run '+active.id+' before starting another period for this plan.',409);
  if(runs().length>=limits.maxRefreshRuns)throw fault('REFRESH_RUN_CAPACITY','Keep this workspace within its configured retained-run capacity.',409);
  await baseline(selected.definition.baseline.id,selected.definition.baseline.sha256);
  const at=now(),asOf=date(input.asOf??at.slice(0,10)),definition=clone(selected.definition);
  const record={id:randomUUID(),schema:FISCAL_REFRESH_RUN,kind:'refresh-runs',revision:1,...pin,
   planId:selected.id,planRevision:selected.revision,planSha256:selected.sha256,definition,
   name:definition.name+' · '+asOf,createdAt:at,updatedAt:at,asOf,period:fiscalRefreshPeriod(definition,asOf),
   status:'QUEUED',desiredState:'RUNNING',phase:'SOURCE',steps:{},events:[{at,action:'STARTED',phase:'SOURCE'}],
   source:null,capture:null,edition:null,comparison:null,sourceExport:null,briefing:null,delivery:null,
   schemaChanges:[],review:null,error:null,completion:null,completedAt:null,sha256:null};
  await save('refresh-runs',record);notify();return clone(record);
 }
 async function invoke(record,key,action,input){
  let step=record.steps[key];
  if(step){
   if(step.action!==action||identity(step.input)!==identity(input))throw fault('REFRESH_STEP_CHANGED','Continue the exact retained '+key+' input.',409);
   if(step.completed)return clone(step.result);
  }else{
   step={action,input:clone(input),startedAt:now(),completed:false,result:null};
   record.steps[key]=step;event(record,'STEP_SELECTED',{step:key,action});await put(record);
  }
  const result=await native(action,clone(step.input));
  step.completed=true;step.completedAt=now();step.result=clone(result);event(record,'STEP_RETAINED',{step:key,id:result.id??null});
  await put(record);return clone(result);
 }
 function nativeInput(record,key,action,input){
  const saved=record.steps[key];if(saved&&saved.action!==action)throw fault('REFRESH_STEP_CHANGED','The retained workflow step changed.',409);
  return saved?clone(saved.input):input;
 }
 async function copiedReview(record,edition){
  const available=new Set(Object.keys(edition.observations)),previous=record.definition.review;
  const fields=previous.fields.filter(field=>available.has(field.source)).map(clone),selected=new Set(fields.map(field=>field.name));
  const proposed={fields,keyFields:previous.keyFields.filter(name=>selected.has(name)),notes:previous.notes,
   filters:previous.filters.filter(name=>selected.has(name)),ranges:previous.ranges.filter(name=>selected.has(name)),
   sorts:previous.sorts.filter(name=>selected.has(name)),defaultLimit:previous.defaultLimit,maxLimit:previous.maxLimit};
  if(!fields.length)throw fault('REFRESH_REVIEW_REQUIRED','The new capture has no selected baseline fields; review its original source fields.',409);
  const key='review',saved=record.steps[key],input=saved?.input??{id:edition.id,expectedRevision:edition.revision,...proposed};
  if(saved?.completed)return;
  if(!saved){record.steps[key]={action:'editions.review',input:clone(input),startedAt:now(),completed:false,result:null};
   event(record,'REVIEW_RULES_SELECTED');await put(record);}
  const current=get('editions',edition.id),expectedReview=Object.fromEntries(REVIEW_KEYS.map(name=>[name,clone(input[name])]));
  // Native review predates requestId. Reconcile its exact persisted postimage, never
  // repeat a review over a later operator edit or fabricate a successful revision.
  let result;
  if(current.revision===input.expectedRevision)result=await native('editions.review',input);
  else if(current.revision===input.expectedRevision+1&&current.status==='DRAFT'&&identity(reviewOf(current))===identity(expectedReview))
   result=clone(current);
  else throw fault('REFRESH_REVIEW_CHANGED','The native review changed during this run. Review the retained edition and select its READY result.',409);
  record.steps[key].completed=true;record.steps[key].completedAt=now();
  record.steps[key].result={id:result.id,revision:result.revision};event(record,'REVIEW_RULES_COPIED');await put(record);
 }
 function validateComparisonReview(definition,edition){
  const oldFields=new Map(definition.review.fields.map(field=>[field.name,field]));
  for(const name of [...definition.comparison.keyFields,...definition.comparison.measureFields]){
   const before=oldFields.get(name),after=edition.fields.find(field=>field.name===name);
   if(!after||!before||['role','unit','scale','nullToken'].some(key=>identity(before[key]??null)!==identity(after[key]??null)))
    throw fault('REFRESH_COMPARISON_REVIEW','Keep the compared field '+name+' and its reviewed role, source unit, scale and null marker compatible with the baseline.',409);
  }
 }
 async function acceptReview(input){
  only(input,['id','expectedRevision','editionId','expectedEditionSha256','requestId']);
  const pin=request('refresh.runs.review',input),record=run(input.id),found=record.review?.requestKey===pin.requestKey;
  if(found){exactRequest(record.review,pin);return clone(record);}
  sameRevision(record,input.expectedRevision);
  if(TERMINAL.has(record.status)||!['EDITION','REVIEW'].includes(record.phase))
   throw fault('REFRESH_REVIEW_PHASE','Select a reviewed edition while this run is waiting for its field review.',409);
  const edition=get('editions',input.editionId);
  if(edition.status!=='READY'||!HASH.test(input.expectedEditionSha256??'')||edition.sha256!==input.expectedEditionSha256||
   edition.captureId!==record.capture?.id||edition.captureSha256!==record.capture?.sha256)
   throw fault('REFRESH_REVIEW_SELECTION','Choose a READY edition of this run’s exact completed capture.',409);
  validateComparisonReview(record.definition,edition);
  record.edition=binding(edition);record.review={mode:'OPERATOR',...pin,edition:binding(edition),acceptedAt:now()};
  record.status='QUEUED';record.desiredState='RUNNING';record.phase='COMPARE';record.error=null;
  event(record,'REVIEW_ACCEPTED',{editionId:edition.id,sha256:edition.sha256});await put(record);notify();return clone(record);
 }
 async function reconcileCapture(record){
  if(!record.capture&&record.steps.capture){
   const found=findNative('captures','captures.start',record.steps.capture.input);
   if(found){record.capture=binding(found);event(record,'CAPTURE_RECONCILED',{id:found.id});await put(record);}
  }
  return record.capture?get('captures',record.capture.id):null;
 }
 async function intent(verb,input){
  only(input,['id','expectedRevision']);const record=run(input.id);sameRevision(record,input.expectedRevision);
  if(TERMINAL.has(record.status))return clone(record);
  if(verb==='resume'&&record.phase==='REVIEW')
   throw fault('REFRESH_REVIEW_REQUIRED','Review this capture’s schema and choose its READY edition before continuing.',409);
  const capture=await reconcileCapture(record);
  if(verb==='resume'&&capture?.status==='CANCELLED')
   throw fault('REFRESH_CAPTURE_CANCELLED','This run’s original capture was cancelled. Cancel the run and create a new period.',409);
  record.desiredState=verb==='resume'?'RUNNING':verb==='cancel'?'CANCELLED':'PAUSED';
  record.status=verb==='resume'?'QUEUED':record.desiredState;record.error=null;
  record.control={action:verb,pending:true,selectedAt:now()};
  event(record,verb.toUpperCase());await put(record); // Retain intent before altering its original capture.
  if(capture&&capture.status!=='COMPLETE'&&capture.status!=='CANCELLED')
   await native('captures.'+verb,{id:capture.id});
  record.control.pending=false;record.control.completedAt=now();await put(record);
  notify();return clone(record);
 }
 function canAdvance(record){
  if(record.control?.pending)return record.status!=='FAILED';
  if(record.desiredState!=='RUNNING'||TERMINAL.has(record.status)||['FAILED','REVIEW_REQUIRED','PAUSED'].includes(record.status))return false;
  if(record.phase==='CAPTURE'&&record.capture){
   const capture=get('captures',record.capture.id);
   return !['QUEUED','RUNNING'].includes(capture.status);
  }
  return true;
 }
 async function stage(record){
  const definition=record.definition,requestId=name=>'refresh:'+record.id+':'+name;
  if(record.control?.pending){
   const capture=await reconcileCapture(record);
   if(capture&&!['COMPLETE','CANCELLED'].includes(capture.status))await native('captures.'+record.control.action,{id:capture.id});
   record.control.pending=false;record.control.completedAt=now();event(record,'CONTROL_COMPLETED',{action:record.control.action});await put(record);return;
  }
  record.status='RUNNING';record.error=null;
  switch(record.phase){
   case 'SOURCE':{
    if(definition.capture.mode==='source'){
     const source=await sourceVersion(definition.source.id,definition.source.revision);
     if(source.sha256!==definition.source.sha256)throw fault('REFRESH_SOURCE_CHANGED','The plan’s exact source revision changed.',409);
     record.source=binding(source);
    }else{
     const input=nativeInput(record,'source','sources.save',{name:definition.name.slice(0,120)+' · '+record.asOf,
      endpoint:definition.source.endpoint,filter:record.period.filter,sort:record.period.sort,pageSize:definition.source.pageSize,
      notes:definition.source.notes,requestId:requestId('source')});
     const source=await invoke(record,'source','sources.save',input);record.source=binding(source);
    }
    record.phase='CAPTURE';event(record,'SOURCE_PINNED',{source:record.source});await put(record);return;
   }
   case 'CAPTURE':{
    if(!record.capture){
     const input=nativeInput(record,'capture','captures.start',{sourceId:record.source.id,sourceRevision:record.source.revision,
      sourceSha256:record.source.sha256,name:record.name.slice(0,160),requestId:requestId('capture')});
     const capture=await invoke(record,'capture','captures.start',input);record.capture=binding(capture);
    }
    const capture=get('captures',record.capture.id);record.capture=binding(capture);
    if(capture.status==='COMPLETE'){record.phase='EDITION';event(record,'CAPTURE_COMPLETE',{capture:record.capture});}
    else if(capture.status==='FAILED')throw fault(capture.error?.code??'REFRESH_CAPTURE_FAILED',capture.error?.message??'Resume this original capture after resolving its reported source error.',409);
    else if(['PAUSED','CANCELLED'].includes(capture.status)){record.status=capture.status;record.desiredState=capture.status;event(record,'CAPTURE_'+capture.status);}
    else record.status='WAITING_CAPTURE';
    await put(record);return;
   }
   case 'EDITION':{
    const capture=get('captures',record.capture.id);
    if(capture.status!=='COMPLETE'||capture.sha256!==record.capture.sha256)throw fault('REFRESH_CAPTURE_CHANGED','Keep this run’s exact complete capture.',409);
    const created=await invoke(record,'edition','editions.create',nativeInput(record,'edition','editions.create',{
     captureId:capture.id,captureSha256:capture.sha256,name:definition.name.slice(0,90)+' · '+record.asOf,requestId:requestId('edition')}));
    record.edition={id:created.id,revision:created.revision,sha256:created.sha256};
    record.schemaChanges=fiscalRefreshSchemaChanges(definition.schema,fiscalRefreshSchema(capture));
    const edition=get('editions',created.id);
    try{await copiedReview(record,edition);}
    catch(error){if(!REVIEW_ERRORS.has(error.code))throw error;record.phase='REVIEW';record.status='REVIEW_REQUIRED';record.desiredState='PAUSED';record.error=errorOf(error);
     event(record,'REVIEW_REQUIRED',{error:record.error});await put(record);return;}
    if(record.schemaChanges.length){
     record.phase='REVIEW';record.status='REVIEW_REQUIRED';record.desiredState='PAUSED';
     event(record,'SCHEMA_REVIEW_REQUIRED',{changes:record.schemaChanges.length});await put(record);return;
    }
    const input=nativeInput(record,'build','editions.build',{id:created.id,expectedRevision:get('editions',created.id).revision,requestId:requestId('build')});
    let built;
    try{built=await invoke(record,'build','editions.build',input);validateComparisonReview(definition,get('editions',built.id));}
    catch(error){if(!REVIEW_ERRORS.has(error.code))throw error;record.phase='REVIEW';record.status='REVIEW_REQUIRED';record.desiredState='PAUSED';record.error=errorOf(error);
     event(record,'REVIEW_REQUIRED',{error:record.error});await put(record);return;}
    record.edition=binding(built);record.review={mode:'EXACT_SAVED_RULES',edition:binding(built),acceptedAt:now()};
    record.phase='COMPARE';event(record,'SAVED_RULES_BUILT',{edition:record.edition});await put(record);return;
   }
   case 'COMPARE':{
    const edition=get('editions',record.edition.id);validateComparisonReview(definition,edition);
    if(edition.status!=='READY'||edition.sha256!==record.edition.sha256)throw fault('REFRESH_EDITION_CHANGED','Keep the exact reviewed candidate edition.',409);
    await baseline(definition.baseline.id,definition.baseline.sha256);
    const comparison=await invoke(record,'comparison','comparisons.create',nativeInput(record,'comparison','comparisons.create',{
     leftEditionId:definition.baseline.id,rightEditionId:edition.id,keyFields:definition.comparison.keyFields,
     measureFields:definition.comparison.measureFields,name:definition.name.slice(0,120)+' · '+record.asOf,requestId:requestId('comparison')}));
    record.comparison=binding(comparison);record.phase='EXPORT';event(record,'COMPARISON_RETAINED',{comparison:record.comparison});await put(record);return;
   }
   case 'EXPORT':{
    const result=await invoke(record,'export','exports.create',nativeInput(record,'export','exports.create',{
     kind:'comparison',id:record.comparison.id,requestId:requestId('export')}));
    record.sourceExport=binding(result);record.phase='BRIEFING';event(record,'SOURCE_DELIVERY_RETAINED',{export:record.sourceExport});await put(record);return;
   }
   case 'BRIEFING':{
    const result=await invoke(record,'briefing','briefings.create',nativeInput(record,'briefing','briefings.create',{
     comparisonId:record.comparison.id,expectedComparisonSha256:record.comparison.sha256,exportId:record.sourceExport.id,
     ...definition.briefing,requestId:requestId('briefing')}));
    record.briefing=binding(result);record.phase='DELIVERY';event(record,'BRIEFING_RETAINED',{briefing:record.briefing});await put(record);return;
   }
   case 'DELIVERY':{
    if(!record.completion){
     record.completion={schema:FISCAL_REFRESH_RUN,id:record.id,name:record.name,planId:record.planId,
      planRevision:record.planRevision,planSha256:record.planSha256,createdAt:record.createdAt,completedAt:now(),
      asOf:record.asOf,period:clone(record.period),definition:clone(definition),source:clone(record.source),capture:clone(record.capture),
      edition:clone(record.edition),schemaChanges:clone(record.schemaChanges),review:clone(record.review),
      comparison:clone(record.comparison),sourceExport:clone(record.sourceExport),briefing:clone(record.briefing)};
     record.sha256=identity(record.completion);event(record,'HANDOVER_SELECTED',{sha256:record.sha256});await put(record);
    }
    const result=await deliver(record,{requestId:requestId('delivery')});
    record.delivery=binding(result);record.status='COMPLETE';record.desiredState='PAUSED';
    record.completedAt=record.completion.completedAt;record.error=null;event(record,'COMPLETE',{delivery:record.delivery});await put(record);return;
   }
   default:throw fault('REFRESH_PHASE','The saved refresh phase cannot be advanced.',409);
  }
 }
 async function advance(){
  const candidate=runs().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).find(canAdvance);if(!candidate)return false;
  let record=run(candidate.id);
  try{await stage(record);}
  catch(error){
   // Re-read the last successful write so a failed later persistence never
   // discards the retained native request which must be resumed.
   record=run(candidate.id);record.status='FAILED';if(!record.control?.pending)record.desiredState='PAUSED';record.error=errorOf(error);
   event(record,'FAILED',{error:record.error});await put(record);
  }
  return true;
 }
 async function promote(input){
  only(input,['planId','expectedRevision','runId','expectedRunRevision','requestId']);
  const pin=request('refresh.baseline.promote',input),reused=readPlanRequest(pin);if(reused)return clone(reused);
  const selected=plan(input.planId);sameRevision(selected,input.expectedRevision);
  const completed=run(input.runId);sameRevision(completed,input.expectedRunRevision);
  if(completed.status!=='COMPLETE'||completed.planId!==selected.id||completed.planRevision!==selected.revision||
   completed.planSha256!==selected.sha256)
   throw fault('REFRESH_PROMOTION_SELECTION','Choose a complete run of the current exact plan revision. The existing baseline is preserved.',409);
  if(selected.versions.length>=128)throw fault('REFRESH_PLAN_HISTORY_CAPACITY','Create a successor plan while preserving these original revisions.',409);
  const next=await baseline(completed.edition.id,completed.edition.sha256),definition={...clone(selected.definition),
   baseline:binding(next.edition),source:clone(next.source),review:reviewOf(next.edition),schema:fiscalRefreshSchema(next.capture)};
  const at=now(),revision=selected.revision+1,sha256=identity(definition);
  const version={revision,sha256,definition:clone(definition),at,action:'BASELINE_PROMOTED',runId:completed.id,runSha256:completed.sha256,...pin};
  const record={...selected,revision,definition,sha256,updatedAt:at,versions:[...selected.versions,version]};
  await save('refresh-plans',record);return clone(record);
 }
 async function recover(){
  for(const item of plans())plan(item.id);
  for(const item of runs()){
   const record=run(item.id),capture=await reconcileCapture(record);
   if(record.control?.pending){
    if(capture&&!['COMPLETE','CANCELLED'].includes(capture.status))await native('captures.'+record.control.action,{id:capture.id});
    record.control.pending=false;record.control.completedAt=now();event(record,'CONTROL_RECOVERED');await put(record);
   }else if(capture&&!['COMPLETE','CANCELLED'].includes(capture.status)&&record.desiredState!=='RUNNING')
    await native('captures.'+(record.desiredState==='CANCELLED'?'cancel':'pause'),{id:capture.id});
  }
 }
 function page(values,input,view){
  const offset=integer(input.offset??0,0,10000000,'Offset'),limit=integer(input.limit??50,1,100,'Page size');
  const selected=values.slice(offset,offset+limit);
  return{items:selected.map(view),offset,limit,total:values.length,nextOffset:offset+selected.length<values.length?offset+selected.length:null};
 }
 async function dispatch(action,input){
  switch(action){
   case 'refresh.plans.list':only(input,['offset','limit']);return page(plans().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),input,fiscalRefreshPlanView);
   case 'refresh.plans.get':only(input,['id']);return clone(plan(input.id));
   case 'refresh.plans.save':return savePlan(input);
   case 'refresh.runs.list':only(input,['planId','offset','limit']);if(input.planId)plan(input.planId);
    return page(runs().filter(item=>!input.planId||item.planId===input.planId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),input,fiscalRefreshRunView);
   case 'refresh.runs.get':only(input,['id']);return clone(run(input.id));
   case 'refresh.runs.preview':return preview(input);
   case 'refresh.runs.start':return start(input);
   case 'refresh.runs.pause':return intent('pause',input);
   case 'refresh.runs.resume':return intent('resume',input);
   case 'refresh.runs.cancel':return intent('cancel',input);
   case 'refresh.runs.review':return acceptReview(input);
   case 'refresh.baseline.promote':return promote(input);
   default:throw fault('REFRESH_ACTION','Choose a documented refresh plan or run action.',404);
  }
 }
 return{dispatch,recover,advance,hasWork:()=>runs().some(canAdvance),
  nextId:()=>runs().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).find(canAdvance)?.id??null,
  snapshot:()=>({refreshPlans:plans().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(fiscalRefreshPlanView),
   refreshRuns:runs().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(fiscalRefreshRunView)})};
}
