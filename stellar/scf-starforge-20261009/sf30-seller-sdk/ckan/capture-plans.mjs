// MIT. Fresh scheduled DataStore editions through the original capture and review owners.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureSelection, readCkanCapture, ExactCkanNumber } from './capture.mjs';
import { cloneRemote as clone, parseRemote, remoteIdentity as identity } from './remote-json.mjs';
import { object, bytes, digest, readPrivate, atomicJson, privateDirectory, fault, stamp } from '../postgres/publisher/files.mjs';

export const CKAN_CAPTURE_PLANS_SCHEMA = 'stellar-forge.ckan-capture-plans.v1';
const PLAN_SCHEMA = 'stellar-forge.ckan-capture-plan.v1';
const RUN_SCHEMA = 'stellar-forge.ckan-capture-plan-run.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['COLLECTING','COMPLETE','FAILED','INTERRUPTED']);
const MAX = 2097152;
const need = (ok, code, message = code, status = 400) => { if (!ok) throw fault(code, message, status); };
const uid = value => { need(UUID.test(value ?? ''), 'CKAN_CAPTURE_PLAN_ID_INVALID'); return value; };
const integer = (value,min,max,code) => { need(Number.isSafeInteger(value)&&value>=min&&value<=max,code); return value; };
const timestamp = value => {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value, 'CKAN_CAPTURE_PLAN_TIME_INVALID',
    'Use a complete canonical UTC timestamp, including milliseconds and Z.');
  return value;
};
const configPath = (directory,id,sha) => join(directory,'capture-plans','plans',uid(id),sha+'.json');
const runPath = (directory,id) => join(directory,'capture-plans','runs',uid(id)+'.json');
const pick = (rows,id,code='CKAN_CAPTURE_PLAN_NOT_FOUND') => {
  uid(id); const row=rows.find(value=>value.id===id); need(row,code,'Choose a retained capture plan or run.',404); return row;
};
const paging = input => ({
  offset:integer(input?.offset??0,0,10000000,'CKAN_CAPTURE_PLAN_PAGE_INVALID'),
  limit:integer(input?.limit??50,1,200,'CKAN_CAPTURE_PLAN_PAGE_INVALID')
});
function substituted(value, replacements) {
  if(typeof value==='string') {
    const result=value.replace(/\{\{([^{}]+)\}\}/g,(_match,key)=>{
    need(Object.hasOwn(replacements,key),'CKAN_CAPTURE_PLAN_TEMPLATE_INVALID',
      'Use only period.date, period.start and period.end in filter or query values.');
      return replacements[key];
    });
    need(!/\{\{|\}\}/.test(result),'CKAN_CAPTURE_PLAN_TEMPLATE_INVALID','Complete the period token or use a literal source value.');
    return result;
  }
  if(value instanceof ExactCkanNumber) return clone(value);
  if(Array.isArray(value)) return value.map(item=>substituted(item,replacements));
  if(object(value)) return Object.fromEntries(Object.entries(value).map(([key,item])=>{
    need(!key.includes('{{'),'CKAN_CAPTURE_PLAN_TEMPLATE_KEY','Source field names remain literal.');
    return [key,substituted(item,replacements)];
  }));
  return value;
}
export function ckanCapturePlanConfig(input, binding) {
  need(object(input)&&object(input.selection)&&object(input.cadence),'CKAN_CAPTURE_PLAN_CONFIG_REQUIRED');
  const label=input.label;
  need(typeof label==='string'&&label.trim()&&label.length<=256,'CKAN_CAPTURE_PLAN_LABEL_INVALID');
  need(typeof input.enabled==='boolean','CKAN_CAPTURE_PLAN_ENABLED_REQUIRED');
  const selection=captureSelection({...clone(input.selection),
    ...(binding?{catalogOrigin:binding.catalogOrigin,authTokenEnv:binding.authTokenEnv}:{})});
  const limits={maxRows:integer(input.limits?.maxRows??250000,1,5000000,'CKAN_ROW_LIMIT_INVALID'),
    maxBytes:integer(input.limits?.maxBytes??268435456,1024,2147483647,'CKAN_CAPTURE_LIMIT_INVALID')};
  const cadence={anchorAt:timestamp(input.cadence.anchorAt),
    intervalMinutes:integer(input.cadence.intervalMinutes,1,525600,'CKAN_CAPTURE_PLAN_INTERVAL_INVALID')};
  const chosen=input.period??{kind:'none'};
  need(object(chosen)&&['none','utc-day'].includes(chosen.kind),'CKAN_CAPTURE_PLAN_PERIOD_INVALID');
  const period=chosen.kind==='none'?{kind:'none'}:{kind:'utc-day',
    offsetDays:integer(chosen.offsetDays??-1,-3660,0,'CKAN_CAPTURE_PLAN_PERIOD_INVALID')};
  const comparisonKeys=input.comparisonKeys??['_id'];
  need(Array.isArray(comparisonKeys)&&comparisonKeys.length>0&&comparisonKeys.length<=16&&
    new Set(comparisonKeys).size===comparisonKeys.length&&comparisonKeys.every(key=>
      typeof key==='string'&&key.length>0&&key.length<=512&&!/[\u0000-\u001f]/.test(key)),
    'CKAN_CAPTURE_PLAN_KEYS_INVALID');
  const config={label:label.trim(),enabled:input.enabled,selection,limits,cadence,period,comparisonKeys:[...comparisonKeys]};
  need(bytes(config).length<=60000,'CKAN_CAPTURE_PLAN_CONFIG_TOO_LARGE');
  resolveCkanCapturePlan(config,cadence.anchorAt);
  return config;
}
const acquisitionIdentity = config => identity({
  selection:config.selection,limits:config.limits,cadence:config.cadence,period:config.period
});
function acquisitionVersions(plan,config) {
  const sha=acquisitionIdentity(config);
  return new Set(plan.versions.filter(row=>row.acquisitionSha256===sha).map(row=>row.planSha256));
}
export function resolveCkanCapturePlan(config, scheduledFor) {
  timestamp(scheduledFor);
  let period={kind:'none'},values={};
  if(config.period.kind==='utc-day') {
    const time=new Date(scheduledFor);
    time.setUTCHours(0,0,0,0);time.setUTCDate(time.getUTCDate()+config.period.offsetDays);
    const start=time.getTime();
    need(Number.isFinite(start)&&Number.isFinite(start+86400000),'CKAN_CAPTURE_PLAN_PERIOD_INVALID');
    const from=timestamp(new Date(start).toISOString()),until=timestamp(new Date(start+86400000).toISOString());
    period={kind:'utc-day',date:from.slice(0,10),start:from,end:until};
    values={'period.date':period.date,'period.start':period.start,'period.end':period.end};
  }
  const selection=captureSelection({...clone(config.selection),
    filters:substituted(config.selection.filters,values),q:substituted(config.selection.q,values)});
  return {scheduledFor,period,selection,selectionSha256:identity(selection),limits:clone(config.limits)};
}
export function scheduledCkanCaptureRunId(planId,planSha256,scheduledFor) {
  uid(planId);need(HASH.test(planSha256??''),'CKAN_CAPTURE_PLAN_VERSION_INVALID');timestamp(scheduledFor);
  const hash=identity({planId,planSha256,scheduledFor,kind:'scheduled'});
  return hash.slice(0,8)+'-'+hash.slice(8,12)+'-5'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
}
function summary(record) {
  return {id:record.id,planId:record.intent.planId,planSha256:record.intent.planSha256,
    intentSha256:record.intentSha256,kind:record.intent.kind,scheduledFor:record.intent.scheduledFor,
    editionId:record.editionId,state:record.state,createdAt:record.createdAt,
    startedAt:record.startedAt,completedAt:record.completedAt,attempts:record.attempts,
    manifestSha256:record.manifestSha256??null,rowCount:record.rowCount??null,
    retryNotBefore:record.retryNotBefore??null,recordSha256:digest(bytes(record))};
}
export function validateCkanCapturePlans(current,state) {
  if(current===undefined)return;
  need(object(current)&&current.schema===CKAN_CAPTURE_PLANS_SCHEMA&&
    Array.isArray(current.plans)&&Array.isArray(current.runs),'CKAN_CAPTURE_PLANS_INVALID');
  for(const rows of [current.plans,current.runs]) {
    const seen=new Set();
    for(const row of rows){need(object(row)&&UUID.test(row.id??'')&&!seen.has(row.id),'CKAN_CAPTURE_PLANS_INVALID');seen.add(row.id);}
  }
  for(const plan of current.plans) {
    need(HASH.test(plan.planSha256??'')&&HASH.test(plan.acquisitionSha256??'')&&typeof plan.label==='string'&&typeof plan.enabled==='boolean'&&
      Array.isArray(plan.versions)&&Array.isArray(plan.selections)&&plan.versions.length>0,'CKAN_CAPTURE_PLAN_INVALID');
    const versions=new Set();
    for(const version of plan.versions) {
      need(HASH.test(version.planSha256??'')&&HASH.test(version.acquisitionSha256??'')&&!versions.has(version.planSha256),'CKAN_CAPTURE_PLAN_VERSION_INVALID');
      timestamp(version.savedAt);versions.add(version.planSha256);
    }
    need(versions.has(plan.planSha256)&&plan.versions.find(row=>row.planSha256===plan.planSha256).acquisitionSha256===plan.acquisitionSha256&&plan.selections.length>0&&plan.selections.every(row=>
      versions.has(row.planSha256)&&timestamp(row.selectedAt))&&
      plan.selections.at(-1).planSha256===plan.planSha256,'CKAN_CAPTURE_PLAN_VERSION_CHANGED');
    timestamp(plan.createdAt);timestamp(plan.updatedAt);
    for(const key of ['nextDueAt','retryNotBefore'])if(plan[key]!==null)timestamp(plan[key]);
    for(const key of ['latestRunId','latestCompleteRunId'])if(plan[key]!==null) {
      const run=pick(current.runs,plan[key]);
      need(run.planId===plan.id&&(key!=='latestCompleteRunId'||run.state==='COMPLETE'),'CKAN_CAPTURE_PLAN_RUN_BINDING');
    }
  }
  const slots=new Set();
  for(const run of current.runs) {
    const plan=pick(current.plans,run.planId);
    need(plan.versions.some(v=>v.planSha256===run.planSha256)&&HASH.test(run.intentSha256??'')&&
      HASH.test(run.recordSha256??'')&&STATES.has(run.state)&&UUID.test(run.editionId??'')&&
      ['manual','scheduled'].includes(run.kind),'CKAN_CAPTURE_PLAN_RUN_INVALID');
    timestamp(run.scheduledFor);timestamp(run.createdAt);
    for(const key of ['startedAt','completedAt','retryNotBefore'])if(run[key]!==null&&run[key]!==undefined)timestamp(run[key]);
    need(Number.isSafeInteger(run.attempts)&&run.attempts>=0,'CKAN_CAPTURE_PLAN_RUN_INVALID');
    if(run.kind==='scheduled'){
      const key=run.planId+':'+run.planSha256+':'+run.scheduledFor;
      need(!slots.has(key)&&run.id===scheduledCkanCaptureRunId(run.planId,run.planSha256,run.scheduledFor),
        'CKAN_CAPTURE_PLAN_SLOT_REPEATED');slots.add(key);
    }
    if(state) {
      const edition=state.editions.find(row=>row.id===run.editionId);
      need(edition&&edition.capturePlanRunId===run.id,'CKAN_CAPTURE_PLAN_EDITION_MISSING');
      if(run.state==='COMPLETE')need(edition.state==='COMPLETE'&&edition.manifestSha256===run.manifestSha256,
        'CKAN_CAPTURE_PLAN_EDITION_CHANGED');
    }
  }
}
async function readConfig(directory,plan,version=plan.planSha256) {
  need(HASH.test(version??'')&&plan.versions.some(row=>row.planSha256===version),'CKAN_CAPTURE_PLAN_VERSION_NOT_FOUND');
  const raw=await readPrivate(configPath(directory,plan.id,version),65536);
  const record=parseRemote(raw),config=ckanCapturePlanConfig(record.config);
  need(record.schema===PLAN_SCHEMA&&record.planId===plan.id&&record.planSha256===version&&
    identity(config)===version&&identity(record.config)===version&&
    record.savedAt===plan.versions.find(row=>row.planSha256===version).savedAt&&
    record.acquisitionSha256===acquisitionIdentity(config)&&
    record.acquisitionSha256===plan.versions.find(row=>row.planSha256===version).acquisitionSha256,'CKAN_CAPTURE_PLAN_VERSION_CHANGED');
  return {record,config,raw};
}
function validateRun(record) {
  need(object(record)&&record.schema===RUN_SCHEMA&&UUID.test(record.id??'')&&object(record.intent)&&
    HASH.test(record.intentSha256??'')&&identity(record.intent)===record.intentSha256&&
    STATES.has(record.state)&&UUID.test(record.editionId??''),'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  const intent=record.intent;
  uid(intent.planId);need(HASH.test(intent.planSha256??'')&&['manual','scheduled'].includes(intent.kind),
    'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  timestamp(intent.scheduledFor);timestamp(record.createdAt);
  need(record.scheduledFor===intent.scheduledFor,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  for(const key of ['startedAt','completedAt','retryNotBefore'])if(record[key]!==null)timestamp(record[key]);
  if(record.state==='COMPLETE')need(HASH.test(record.manifestSha256??'')&&
    Number.isSafeInteger(record.rowCount)&&record.rowCount>=0&&Number.isSafeInteger(record.pageCount)&&record.pageCount>=0&&
    record.completedAt!==null,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  if(intent.kind==='scheduled')need(record.id===scheduledCkanCaptureRunId(intent.planId,intent.planSha256,intent.scheduledFor),
    'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  need(identity(record.selection)===record.selectionSha256&&Array.isArray(record.history)&&
    Number.isSafeInteger(record.attempts)&&record.attempts>=0,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  return record;
}
async function readRun(directory,id) {
  const raw=await readPrivate(runPath(directory,id),MAX),record=validateRun(parseRemote(raw));
  need(record.id===id,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
  return {record,raw};
}
export async function validateCkanCapturePlanFiles(directory,current,state) {
  if(current===undefined)return;
  validateCkanCapturePlans(current,state);
  for(const plan of current.plans)for(const version of plan.versions){
    const {config}=await readConfig(directory,plan,version.planSha256);
    if(state)checkProjectBinding(config,state);
  }
  for(const row of current.runs) {
    const {record,raw}=await readRun(directory,row.id),plan=pick(current.plans,row.planId);
    need(digest(raw)===row.recordSha256&&identity(summary(record))===identity(row),'CKAN_CAPTURE_PLAN_RUN_CHANGED');
    const {config}=await readConfig(directory,plan,record.intent.planSha256);
    const resolved=resolveCkanCapturePlan(config,record.intent.scheduledFor);
    need(identity(resolved.period)===identity(record.period)&&identity(resolved.selection)===record.selectionSha256&&identity(resolved.limits)===identity(record.limits),
      'CKAN_CAPTURE_PLAN_SELECTION_CHANGED');
    if(row.state==='COMPLETE') {
      const capture=await readCkanCapture(join(directory,'editions',row.editionId,'capture.json'),row.manifestSha256);
      need(identity(capture.manifest.selection)===record.selectionSha256,'CKAN_CAPTURE_PLAN_SELECTION_CHANGED');
    }
  }
}
function retryTime(value) {
  if(typeof value!=='string')return null;
  const time=/^\d+$/.test(value.trim())?Date.now()+Number(value.trim())*1000:Date.parse(value);
  return Number.isFinite(time)&&time>Date.now()&&time<=8640000000000000?new Date(time).toISOString():null;
}
function checkProjectBinding(config,state) {
  need(config.selection.catalogOrigin===state.catalogOrigin&&config.selection.authTokenEnv===state.authTokenEnv,
    'CKAN_CAPTURE_PLAN_PROJECT_CHANGED','Use the original catalogue and configured credential reference.');
}
/** Reuses the original workbench lease, capture engine and human-reviewed refresh. */
export async function createCkanCapturePlans({directory,state,launch,persist,capture,prepareRefresh}) {
  const current=state.capturePlans??={schema:CKAN_CAPTURE_PLANS_SCHEMA,plans:[],runs:[]};
  validateCkanCapturePlans(current,state);
  async function configFor(plan,version) {
    const loaded=await readConfig(directory,plan,version);checkProjectBinding(loaded.config,state);return loaded;
  }
  async function root() {
    await privateDirectory(join(directory,'capture-plans'),true);
    await privateDirectory(join(directory,'capture-plans','plans'),true);
    await privateDirectory(join(directory,'capture-plans','runs'),true);
  }
  function nextSlot(plan,config) {
    const versions=acquisitionVersions(plan,config);
    const attempted=current.runs.filter(row=>row.planId===plan.id&&versions.has(row.planSha256)&&row.kind==='scheduled');
    const last=attempted.reduce((time,row)=>Math.max(time,Date.parse(row.scheduledFor)),-Infinity);
    const due=last===-Infinity?Date.parse(config.cadence.anchorAt):last+config.cadence.intervalMinutes*60000;
    need(Number.isFinite(due)&&due<=8640000000000000,'CKAN_CAPTURE_PLAN_TIME_INVALID');
    return new Date(due).toISOString();
  }
  function cooldown() {
    // This workbench has one catalogue origin; honor its provider deadline
    // across every policy before another source request is admitted.
    const times=current.runs.map(row=>Date.parse(row.retryNotBefore??''))
      .filter(value=>Number.isFinite(value)&&value>Date.now());
    return times.length?new Date(Math.max(...times)).toISOString():null;
  }
  async function projectPlan(plan) {
    const {config}=await configFor(plan);
    plan.nextDueAt=nextSlot(plan,config);
    const deadline=cooldown();for(const item of current.plans)item.retryNotBefore=deadline;
    const versions=acquisitionVersions(plan,config);
    const rows=current.runs.filter(row=>row.planId===plan.id&&versions.has(row.planSha256));
    plan.latestRunId=rows.at(-1)?.id??null;
    plan.latestCompleteRunId=rows.filter(row=>row.state==='COMPLETE').at(-1)?.id??null;
  }
  async function saveRun(record) {
    await root();await atomicJson(join(directory,'capture-plans','runs'),record.id+'.json',record);
    const row=summary(record),index=current.runs.findIndex(item=>item.id===record.id);
    if(index<0)current.runs.push(row);else current.runs[index]=row;
    await projectPlan(pick(current.plans,record.intent.planId));await persist();
    return row;
  }
  async function bindRun(record) {
    const plan=pick(current.plans,record.intent.planId),{config}=await configFor(plan,record.intent.planSha256);
    const resolved=resolveCkanCapturePlan(config,record.intent.scheduledFor);
    need(identity(resolved.period)===identity(record.period)&&resolved.selectionSha256===record.selectionSha256&&identity(resolved.limits)===identity(record.limits),
      'CKAN_CAPTURE_PLAN_SELECTION_CHANGED');
    let entry=state.editions.find(row=>row.id===record.editionId);
    if(entry)need(entry.capturePlanRunId===record.id,'CKAN_CAPTURE_PLAN_EDITION_CHANGED');
    else {
      entry={id:record.editionId,state:'INTERRUPTED',createdAt:record.createdAt,
        selection:clone(record.selection),limits:clone(record.limits),capturePlanRunId:record.id};
      state.editions.push(entry);
    }
    // Restore the exact original selection from its authoritative typed run file.
    entry.selection=clone(record.selection);entry.limits=clone(record.limits);
    return entry;
  }
  for(const row of [...current.runs])if(row.state!=='COMPLETE') {
    const {record}=await readRun(directory,row.id);await bindRun(record);
    if(record.state==='COLLECTING') {
      record.state='INTERRUPTED';record.completedAt=stamp();
      record.error={code:'CKAN_CAPTURE_PLAN_INTERRUPTED',message:'The original capture stopped before completion.'};
      record.history.push({at:record.completedAt,event:'INTERRUPTED',attempt:record.attempts});
      await saveRun(record);
    } else if(identity(summary(record))!==identity(row))await saveRun(record);
  }
  async function execute(record,signal,progress) {
    const plan=pick(current.plans,record.intent.planId);
    if(record.state==='COMPLETE') {
      await readCkanCapture(join(directory,'editions',record.editionId,'capture.json'),record.manifestSha256);
      return clone(summary(record));
    }
    const deadline=cooldown();
    need(!deadline,'CKAN_CAPTURE_PLAN_RETRY_AFTER','Wait until the retained provider retry time.',409);
    const entry=await bindRun(record);
    record.state='COLLECTING';record.startedAt=stamp();record.completedAt=null;record.error=null;
    record.attempts++;record.history.push({at:record.startedAt,event:'STARTED',attempt:record.attempts});
    await saveRun(record);
    try {
      const result=await capture(entry,signal,progress);
      record.state='COMPLETE';record.completedAt=stamp();record.manifestSha256=result.manifestSha256;
      record.rowCount=result.rowCount;record.pageCount=result.pageCount;record.retryNotBefore=null;
      record.history.push({at:record.completedAt,event:'COMPLETE',attempt:record.attempts,
        manifestSha256:result.manifestSha256});await saveRun(record);
      return clone(summary(record));
    } catch(error) {
      record.state=signal.aborted?'INTERRUPTED':'FAILED';record.completedAt=stamp();
      record.error={code:typeof error.code==='string'?error.code:'CKAN_CAPTURE_PLAN_FAILED',
        message:error.code?error.message:'The original source capture did not complete.',
        ...(error.receipt?{receipt:clone(error.receipt)}:{})};
      record.retryNotBefore=retryTime(error.receipt?.headers?.['retry-after'])??record.retryNotBefore??null;
      record.history.push({at:record.completedAt,event:record.state,attempt:record.attempts,error:clone(record.error)});
      await saveRun(record);throw error;
    }
  }
  return {
    previewCapturePlan(input) {
      need(object(input),'CKAN_CAPTURE_PLAN_CONFIG_REQUIRED');
      const config=ckanCapturePlanConfig(input.config,state),scheduledFor=timestamp(input.scheduledFor);
      return {config,planSha256:identity(config),...resolveCkanCapturePlan(config,scheduledFor)};
    },
    saveCapturePlan(input) {
      need(object(input)&&Object.hasOwn(input,'expectedPlanSha256'),'CKAN_CAPTURE_PLAN_GUARD_REQUIRED');
      const planId=uid(input.id),config=ckanCapturePlanConfig(input.config,state),sha=identity(config),
        acquisitionSha256=acquisitionIdentity(config);
      const previous=current.plans.find(row=>row.id===planId);
      need(previous?input.expectedPlanSha256===previous.planSha256||previous.planSha256===sha:
        input.expectedPlanSha256===null,'CKAN_CAPTURE_PLAN_CHANGED','Read the current plan before saving its successor.',409);
      return {...launch('save DataStore capture policy',async()=>{
        await root();const now=stamp();
        const plan=previous??{id:planId,createdAt:now,versions:[],selections:[],latestRunId:null,
          latestCompleteRunId:null,nextDueAt:null,retryNotBefore:null};
        if(plan.planSha256===sha)return clone(plan);
        const folder=join(directory,'capture-plans','plans',planId);await privateDirectory(folder,true);
        if(!plan.versions.some(row=>row.planSha256===sha)){
          let savedAt=now;
          const version={schema:PLAN_SCHEMA,planId,planSha256:sha,acquisitionSha256,config,savedAt};
          try {
            const retained=parseRemote(await readPrivate(configPath(directory,planId,sha),65536));
            need(retained.schema===PLAN_SCHEMA&&retained.planId===planId&&retained.planSha256===sha&&identity(retained.config)===sha&&retained.acquisitionSha256===acquisitionSha256,
              'CKAN_CAPTURE_PLAN_VERSION_CHANGED');
            savedAt=timestamp(retained.savedAt);
          } catch(error) {
            if(error.code!=='ENOENT')throw error;
            await atomicJson(folder,sha+'.json',version);
          }
          plan.versions.push({planSha256:sha,acquisitionSha256,savedAt});
        }
        Object.assign(plan,{planSha256:sha,acquisitionSha256,label:config.label,enabled:config.enabled,updatedAt:now});
        plan.selections.push({planSha256:sha,selectedAt:now});
        if(!previous)current.plans.push(plan);
        await projectPlan(plan);await persist();return clone(plan);
      }),planId};
    },
    async capturePlan(id,input={}) {
      const plan=pick(current.plans,id),{config}=await configFor(plan),page=paging(input);
      const rows=current.runs.filter(row=>row.planId===id),selected=rows.slice(page.offset,page.offset+page.limit);
      return {...clone(plan),config,runs:clone(selected),total:rows.length,offset:page.offset,
        next:page.offset+selected.length<rows.length?page.offset+selected.length:null};
    },
    async capturePlanRun(id) {
      pick(current.runs,id);const {record,raw}=await readRun(directory,id);
      return {...record,recordSha256:digest(raw),refreshes:clone(state.refreshes.filter(row=>row.afterEditionId===record.editionId))};
    },
    async dueCapturePlans() {
      const now=Date.now(),rows=[];
      for(const plan of current.plans) {
        const {config}=await configFor(plan),scheduledFor=nextSlot(plan,config);
        const versions=acquisitionVersions(plan,config);
        const retryNotBefore=cooldown(),interrupted=current.runs.filter(row=>row.planId===plan.id&&
          versions.has(row.planSha256)&&row.kind==='scheduled'&&row.state!=='COMPLETE');
        if(!plan.enabled||retryNotBefore||Date.parse(scheduledFor)>now)continue;
        rows.push({id:scheduledCkanCaptureRunId(plan.id,plan.planSha256,scheduledFor),
          planId:plan.id,label:plan.label,expectedPlanSha256:plan.planSha256,kind:'scheduled',scheduledFor,
          previousIncompleteRuns:interrupted.map(row=>({id:row.id,state:row.state,scheduledFor:row.scheduledFor}))});
      }
      return {checkedAt:new Date(now).toISOString(),runs:rows};
    },
    runCapturePlan(input) {
      need(object(input),'CKAN_CAPTURE_PLAN_RUN_REQUIRED');input=clone(input);
      const plan=pick(current.plans,input.planId),scheduledFor=timestamp(input.scheduledFor);
      need(['scheduled','manual'].includes(input.kind)&&HASH.test(input.expectedPlanSha256??''),
        'CKAN_CAPTURE_PLAN_RUN_KIND');
      const runId=input.kind==='scheduled'?scheduledCkanCaptureRunId(plan.id,input.expectedPlanSha256,scheduledFor):uid(input.id);
      need(input.id===runId,'CKAN_CAPTURE_PLAN_RUN_ID_CHANGED');
      const intent={planId:plan.id,planSha256:input.expectedPlanSha256,kind:input.kind,scheduledFor};
      const intentSha256=identity(intent);
      // Admission precedes every asynchronous read. The original workbench's
      // one active operation owns both orphan recovery and a new capture.
      return {...launch('acquire or reopen DataStore capture run',async(signal,progress)=>{
        let record;
        try {record=(await readRun(directory,runId)).record;}
        catch(error){if(error.code!=='ENOENT')throw error;}
        if(record){
          need(record.intentSha256===intentSha256,'CKAN_CAPTURE_PLAN_RUN_ID_REUSED');
          await bindRun(record);
          if(record.state==='COLLECTING'){
            record.state='INTERRUPTED';record.completedAt=stamp();
            record.error={code:'CKAN_CAPTURE_PLAN_INTERRUPTED',message:'Resume this retained capture explicitly.'};
            record.history.push({at:record.completedAt,event:'INTERRUPTED',attempt:record.attempts});
          }
          if(record.state==='COMPLETE')await readCkanCapture(
            join(directory,'editions',record.editionId,'capture.json'),record.manifestSha256);
          await saveRun(record);return clone(summary(record));
        }
        need(plan.planSha256===input.expectedPlanSha256,'CKAN_CAPTURE_PLAN_CHANGED',
          'Read the current policy before acquiring a new edition.',409);
        need(Date.parse(scheduledFor)<=Date.now(),'CKAN_CAPTURE_PLAN_NOT_DUE','A future observation is not due.',409);
        const {config}=await configFor(plan),resolved=resolveCkanCapturePlan(config,scheduledFor);
        if(input.kind==='scheduled')need(plan.enabled&&scheduledFor===nextSlot(plan,config),
          'CKAN_CAPTURE_PLAN_NOT_DUE','Use the earliest due slot of this enabled plan.',409);
        need(!cooldown(),'CKAN_CAPTURE_PLAN_RETRY_AFTER','Wait until the retained provider retry time.',409);
        record={schema:RUN_SCHEMA,id:runId,intent,intentSha256,...resolved,editionId:randomUUID(),
          state:'INTERRUPTED',createdAt:stamp(),startedAt:null,completedAt:null,attempts:0,
          retryNotBefore:null,error:null,history:[]};
        await root();await bindRun(record);await saveRun(record);return execute(record,signal,progress);
      }),runId};
    },
    resumeCapturePlanRun(id,input) {
      const row=pick(current.runs,id);
      need(input?.expectedIntentSha256===row.intentSha256,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
      return {...launch('resume original DataStore capture',async(signal,progress)=>{
        const {record}=await readRun(directory,id);
        need(input.expectedIntentSha256===record.intentSha256,'CKAN_CAPTURE_PLAN_RUN_CHANGED');
        return execute(record,signal,progress);
      }),runId:id,editionId:row.editionId};
    },
    async prepareCapturePlanRefresh(id,input) {
      pick(current.runs,id);const {record}=await readRun(directory,id);
      need(record.state==='COMPLETE'&&input?.expectedIntentSha256===record.intentSha256,
        'CKAN_CAPTURE_PLAN_COMPLETE_RUN_REQUIRED');
      const plan=pick(current.plans,record.intent.planId),{config}=await configFor(plan,record.intent.planSha256);
      const original=await readCkanCapture(join(directory,'editions',record.editionId,'capture.json'),record.manifestSha256);
      need(identity(original.manifest.selection)===record.selectionSha256,'CKAN_CAPTURE_PLAN_SELECTION_CHANGED');
      return prepareRefresh(input.sourceId,{expectedSourceSha256:input.expectedSourceSha256,
        afterEditionId:record.editionId,expectedAfterCaptureSha256:record.manifestSha256,
        keys:input.keys??config.comparisonKeys,...(input.previousPublicationId?{previousPublicationId:input.previousPublicationId}:{})});
    },
    async capturePlanFile(id,kind,versionSha256) {
      let file,raw;
      if(kind==='plan'){
        const plan=pick(current.plans,id),version=versionSha256??plan.planSha256;
        const read=await configFor(plan,version);file=configPath(directory,id,version);raw=read.raw;
      } else {
        need(kind==='run','CKAN_CAPTURE_PLAN_FILE_KIND');pick(current.runs,id);
        const read=await readRun(directory,id);file=runPath(directory,id);raw=read.raw;
      }
      return {id,file,bytes:raw.length,sha256:digest(raw),mediaType:'application/json; charset=utf-8',
        downloadName:'ckan-capture-'+kind+'-'+id+'.json'};
    },
  };
}
