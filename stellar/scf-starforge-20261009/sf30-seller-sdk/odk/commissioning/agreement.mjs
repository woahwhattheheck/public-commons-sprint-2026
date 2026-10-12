// MIT. Original Central customer agreement and reporting-plan preparation.
import { normalizeCentralUrl, normalizeScope } from '../source.mjs';
import { digest, fault, stable } from '../../odata/state.mjs';

export const COMMISSIONING_SCHEMA='stellar-forge.central-commissioning.v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
const copy=v=>JSON.parse(JSON.stringify(v));
export const fingerprint=v=>digest(stable(v));
export const nativeId=(kind,value)=>'comm-'+kind+'-'+fingerprint(value).slice(0,32);
export function jsonObject(value,label='agreement') {
  if(!plain(value))throw fault('CENTRAL_COMMISSIONING_OBJECT','Use a JSON object for the '+label+'.');
  const bytes=Buffer.byteLength(JSON.stringify(value));
  if(bytes>2*1024*1024)throw fault('CENTRAL_COMMISSIONING_SIZE','This '+label+' exceeds 2 MiB.');
  return copy(value);
}
export function normalizeConnection(value) {
  value=jsonObject(value,'private connection');
  if(typeof value.authEnv!=='string'||!/^[A-Z_][A-Z0-9_]{0,127}$/.test(value.authEnv))
    throw fault('CENTRAL_AUTH_REFERENCE','Select the host environment variable holding the original Authorization header.');
  const allowLoopback=value.allowLoopback===true,url=normalizeCentralUrl(value.url,{allowLoopback});
  return {url,authEnv:value.authEnv,allowLoopback,
    name:text(value.name)||'Central commissioning',
    ...(text(value.connectionId??value.id)?{connectionId:value.connectionId??value.id}:{}),
    ...(value.hostReference===undefined?{}:{hostReference:normalizeHostReference(value.hostReference)})};
}
export function normalizeHostReference(value) {
  if(!plain(value))throw fault('CENTRAL_COMMISSIONING_HOST','Use the original host receipt reference.');
  // Preserve useful operating provenance; never copy host secrets/configuration.
  const result={};
  for(const key of ['owner','operationId','profileId','receiptPath','receiptSha256','sourceCommit','release','observedAt'])
    if(value[key]!==undefined) {
      if(typeof value[key]!=='string'||value[key].length>2048||/[\u0000-\u001f\u007f]/.test(value[key]))
        throw fault('CENTRAL_COMMISSIONING_HOST','Use a plain original '+key+' reference.');
      result[key]=value[key];
    }
  for(const key of ['receiptSha256'])if(result[key]&&!/^[a-f0-9]{64}$/.test(result[key]))
    throw fault('CENTRAL_COMMISSIONING_HOST','Use the full original host receipt SHA-256.');
  return result;
}
function dateOnly(value,label) {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||
      new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)
    throw fault('CENTRAL_COMMISSIONING_DATE','Use a calendar date for '+label+'.');
  return value;
}
export function deliverySchedule(input={},days=10) {
  if(!plain(input))throw fault('CENTRAL_COMMISSIONING_KICKOFF','Use the proposed or agreed kickoff record.');
  if(!['proposed','agreed'].includes(input.status??'proposed'))
    throw fault('CENTRAL_COMMISSIONING_KICKOFF','Kickoff status is proposed or agreed.');
  if(!Number.isSafeInteger(days)||days<1||days>260)throw fault('CENTRAL_COMMISSIONING_DAYS','Choose 1–260 working days.');
  const status=input.status??'proposed',start=input.start?dateOnly(input.start,'kickoff'):null;
  const exclusions=input.excludedDates??[];
  if(!Array.isArray(exclusions)||new Set(exclusions).size!==exclusions.length)
    throw fault('CENTRAL_COMMISSIONING_CALENDAR','Use distinct excluded calendar dates.');
  exclusions.forEach(x=>dateOnly(x,'an excluded date'));
  const weekdays=input.weekdays??[1,2,3,4,5];
  if(!Array.isArray(weekdays)||!weekdays.length||new Set(weekdays).size!==weekdays.length||
      weekdays.some(x=>!Number.isSafeInteger(x)||x<0||x>6))
    throw fault('CENTRAL_COMMISSIONING_CALENDAR','Choose distinct weekday numbers from 0 (Sunday) to 6.');
  if(status==='agreed'&&(!start||!text(input.agreementReference)||!text(input.inputsReadyReference)))
    throw fault('CENTRAL_COMMISSIONING_KICKOFF','An agreed kickoff needs its date and original agreement/input-readiness references.');
  const dates=[];
  if(start) {
    const cursor=new Date(start+'T12:00:00Z');
    for(let examined=0;dates.length<days&&examined<4000;examined++,cursor.setUTCDate(cursor.getUTCDate()+1)) {
      const day=cursor.toISOString().slice(0,10);
      if(weekdays.includes(cursor.getUTCDay())&&!exclusions.includes(day))dates.push(day);
    }
    if(dates.length!==days)throw fault('CENTRAL_COMMISSIONING_CALENDAR','This calendar does not yield the complete working period.');
    if(dates[0]!==start)throw fault('CENTRAL_COMMISSIONING_DATE','The selected kickoff is outside the stated working calendar.');
  }
  return {status,start,finish:dates.at(-1)??null,workingDays:days,dates,weekdays,excludedDates:exclusions,
    agreementReference:text(input.agreementReference),inputsReadyReference:text(input.inputsReadyReference),
    capacityReference:text(input.capacityReference),
    description:status==='proposed'?'Proposed calendar; capacity and customer kickoff are not booked by this record.':
      'Date and input references are recorded; this tool does not book staffing or accept commercial terms.'};
}
function locator(item,projectId) {
  if(typeof item==='string')return {projectId,formId:item};
  if(!plain(item))throw fault('CENTRAL_COMMISSIONING_FORM','Select an original form identifier.');
  return {projectId:String(item.project_id??item.projectId??projectId),formId:item.form_id??item.formId??item.xmlFormId};
}
function tableLocator(item,projectId) {
  const form=locator(item,projectId);
  if(typeof form.formId!=='string'||!form.formId||typeof item.table!=='string'||!item.table)
    throw fault('CENTRAL_COMMISSIONING_TABLE','Bind each output/measure to its original form and table name.');
  return {...form,table:item.table};
}
export function agreementReadiness(input) {
  const agreement=jsonObject(input),d=agreement.customer_decisions??{},issues=[];
  const required=['accountable_project_owner','technical_receiver','authorized_central_origin','project_id',
    'reporting_timezone','late_edit_policy','review_state_inclusion','media_retention_selection'];
  for(const field of required)if(d[field]===null||d[field]===undefined||d[field]===''||
      typeof d[field]==='string'&&!d[field].trim())
    issues.push({field:'customer_decisions.'+field,message:'Record '+field.replaceAll('_',' ')+'.'});
  for(const field of ['selected_forms','periods','metric_definitions','approved_output_fields'])
    if(!Array.isArray(d[field])||!d[field].length)issues.push({field:'customer_decisions.'+field,message:'Complete '+field.replaceAll('_',' ')+'.'});
  if(!text(agreement.opportunity_id))issues.push({field:'opportunity_id',message:'Use the original customer/opportunity identity.'});
  if(!plain(agreement.processing)||agreement.processing.reviewStates!=='all'||
      agreement.processing.lateEdits!=='current-state-at-capture'||agreement.processing.portableSource!=='complete-selected-capture')
    issues.push({field:'processing',message:'This original capture includes all review states and retains the current state/available versions at acquisition; choose those explicit processing semantics and complete selected-capture portability.'});
  return {ready:issues.length===0,issues};
}
export function compileAgreement(input,{inspection,connection,id,existingPlanIds}={}) {
  const agreement=jsonObject(input),readiness=agreementReadiness(agreement);
  if(!readiness.ready)throw Object.assign(fault('CENTRAL_COMMISSIONING_DEFINITIONS',
    'Complete the selected source and report definitions before installing period plans.'),{details:readiness});
  if(!inspection||inspection.status!=='READY')throw fault('CENTRAL_COMMISSIONING_INSPECTION','Inspect the original Central project first.');
  const d=agreement.customer_decisions,projectId=String(d.project_id);
  if(projectId!==String(inspection.project.id))throw fault('CENTRAL_COMMISSIONING_PROJECT','The agreement selects another project than the retained inspection.');
  if(normalizeCentralUrl(d.authorized_central_origin,{allowLoopback:connection.allowLoopback})!==connection.url)
    throw fault('CENTRAL_COMMISSIONING_ORIGIN','The agreement must name this original Central server.');
  try{new Intl.DateTimeFormat('en',{timeZone:d.reporting_timezone}).format(new Date());}
  catch{throw fault('CENTRAL_COMMISSIONING_TIMEZONE','Use an explicit supported reporting time zone.');}
  const maxForms=agreement.commercial_scope?.max_existing_forms??3;
  if(!Number.isSafeInteger(maxForms)||maxForms<1||maxForms>100)throw fault('CENTRAL_COMMISSIONING_FORM_LIMIT','Use the agreed positive form limit.');
  const forms=d.selected_forms.map(x=>locator(x,projectId)),available=new Map(inspection.forms.map(x=>[x.xmlFormId,x]));
  if(forms.length>maxForms||new Set(forms.map(x=>stable(x))).size!==forms.length||
      forms.some(x=>x.projectId!==projectId||typeof x.formId!=='string'||!available.has(x.formId)))
    throw fault('CENTRAL_COMMISSIONING_FORM','Choose each inspected native form once within the agreed project and form limit.');
  if(d.periods.length!==2)throw fault('CENTRAL_COMMISSIONING_PERIODS','Select the two original reporting periods.');
  const periods=d.periods.map((p,index)=>{
    if(!plain(p)||!text(p.label)||!p.submitted_from||!p.submitted_before_exclusive)
      throw fault('CENTRAL_COMMISSIONING_PERIODS','Name both periods and set their exact start and exclusive end timestamps.');
    return {index,label:p.label.trim(),scope:normalizeScope({submittedFrom:p.submitted_from,
      submittedBefore:p.submitted_before_exclusive,updatedSince:p.updated_since??null,pageSize:p.page_size??1000})};
  });
  if(new Set(periods.map(x=>x.label)).size!==2)throw fault('CENTRAL_COMMISSIONING_PERIODS','Give each period its own label.');
  const outputs=d.approved_output_fields.map((x,index)=>{
    const table=tableLocator(x,projectId);
    if(!forms.some(f=>f.projectId===table.projectId&&f.formId===table.formId)||!Array.isArray(x.fields)||
        (!x.fields.length||x.fields.length>32)||x.fields.some(p=>typeof p!=='string'||!p)||new Set(x.fields).size!==x.fields.length)
      throw fault('CENTRAL_COMMISSIONING_OUTPUT','Choose explicit original field paths for every approved output table.');
    return {...table,fields:[...x.fields],name:text(x.name)||table.formId+' / '+table.table,index};
  });
  if(new Set(outputs.map(({projectId,formId,table})=>stable([projectId,formId,table]))).size!==outputs.length)
    throw fault('CENTRAL_COMMISSIONING_OUTPUT','Select each output table once.');
  const operations=['rows','nonempty','sum','mean','minimum','maximum','distinct','frequency'];
  const indicators=d.metric_definitions.map(x=>{
    const table=tableLocator(x,projectId);
    if(!forms.some(f=>f.projectId===table.projectId&&f.formId===table.formId)||!operations.includes(x.operation)||
        !text(x.name)||x.operation!=='rows'&&!text(x.field)||
        Object.hasOwn(x,'equals')&&(!text(x.field)||x.equals===undefined||x.equals!==null&&typeof x.equals==='object'))
      throw fault('CENTRAL_COMMISSIONING_MEASURE','Choose an explicit original scalar indicator and its table/field mapping.');
    return {...table,name:x.name,operation:x.operation,...(text(x.field)?{field:x.field}:{}),
      ...(Object.hasOwn(x,'equals')?{equals:x.equals}:{})};
  });
  const schedule=deliverySchedule(agreement.kickoff??{},agreement.commercial_scope?.delivery_business_days??10);
  const agreementSha256=fingerprint(agreement),definition={agreement,agreementSha256,projectId,forms,periods,outputs,indicators,
    schedule,connectionId:inspection.connectionId,inspectionId:inspection.id,sourceIdentity:inspection.sourceIdentity};
  if(existingPlanIds!==undefined&&(!Array.isArray(existingPlanIds)||existingPlanIds.length!==2||
      existingPlanIds.some(x=>typeof x!=='string'||!x)||new Set(existingPlanIds).size!==2))
    throw fault('CENTRAL_COMMISSIONING_PLANS','Provide two distinct original period-plan IDs when adopting existing plans.');
  definition.plans=periods.map((p,index)=>({id:existingPlanIds?.[index]??nativeId('plan',[id,agreementSha256,index]),
    name:((text(agreement.name)||agreement.opportunity_id)+' / '+p.label).slice(0,160),
    connectionId:inspection.connectionId,forms,scope:p.scope}));
  return definition;
}
export function resolveCaptureTable(capture,selection) {
  const form=capture.forms.find(x=>String(x.projectId)===selection.projectId&&x.formId===selection.formId);
  const table=form&&capture.tables.find(x=>x.formKey===form.key&&x.name===selection.table);
  if(!table)throw fault('CENTRAL_COMMISSIONING_TABLE','The accepted capture does not contain '+selection.formId+' / '+selection.table+'.');
  return table;
}
