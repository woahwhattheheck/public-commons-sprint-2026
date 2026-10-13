import { GRANT_AGENT_SCHEMA, GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_SOURCE_BYTES, GRANT_CASE_ACTIONS } from './agent-contracts.mjs';
import {performGrantPlanningSourceOperation} from './source-tables-agent.mjs';
import {planInstallationSourceOperation, performInstallationSourceOperation,
  INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES} from './installation-source-desk-agent.mjs';
export * from './installation-source-desk-agent.mjs';
export {grantPlanningSourceProfiles,GRANT_PLANNING_SOURCE_SCHEMA,GRANT_PLANNING_SOURCE_ACTIONS} from './source-tables-agent.mjs';
export { GRANT_AGENT_SCHEMA, GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_SOURCE_BYTES, GRANT_MAX_WORKBOOK_HANDOVER_BYTES, GRANT_CASE_ACTIONS } from './agent-contracts.mjs';
// MIT. Typed agent access to the original SF47 planning and delivery service.
// This client owns no planning database, business records or financial model.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGrantWorkspaceSelection, readGrantWorkspaceLaunch, GRANT_LAUNCH_SCHEMA, GRANT_MAX_LAUNCH_BYTES } from './launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));



const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (code, message, details = {}) => Object.assign(new Error(message), {code, ...details});
const need = (value, code, message) => { if (!value) throw error(code, message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = (value, name = 'Input') => {
  need(plain(value), 'GRANT_INVALID_INPUT', name + ' must be an object.'); return value;
};
const exact = (value, allowed, required = []) => {
  object(value);
  need(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
    'GRANT_INVALID_INPUT', 'Use the declared fields, including every required field.');
};
const text = (value, name, max = 12000, empty = false) => {
  need(typeof value === 'string' && value.length <= max && (empty || value.trim()) && !value.includes('\0'),
    'GRANT_INVALID_INPUT', name + ' is required and must fit its native text bound.'); return value;
};
const integer = (value, name, min = 1, max = 10000000) => {
  need(Number.isSafeInteger(value) && value >= min && value <= max, 'GRANT_INVALID_INPUT',
    name + ' must be an integer from ' + min + ' through ' + max + '.'); return value;
};
const id = (value, prefix) => {
  need(typeof value === 'string' && new RegExp('^' + prefix + '-[a-f0-9]{32}$').test(value),
    'GRANT_INVALID_INPUT', 'Use the original ' + prefix + ' identifier.'); return value;
};
const requestId = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value),
    'GRANT_INVALID_INPUT', 'Use the original request ID: up to 100 letters, numbers, dots, underscores or hyphens.');
  return value;
};
const path = value => {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'GRANT_CONFIGURATION_ERROR',
    'Host selections must be absolute original paths.'); return resolve(value);
};
const sha = value => {
  need(typeof value === 'string' && HASH.test(value), 'GRANT_INVALID_INPUT', 'Use the exact SHA256.'); return value;
};

const commercialIdentifier = (value, label = 'Saved commercial identifier') => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value),
    'GRANT_INVALID_INPUT', label + ' must be the original saved identifier.');
  return value;
};
const commercialPath = (caseId, billingId, milestoneId) => {
  let route = '/api/operations/' + encodeURIComponent(id(caseId, 'operation')) + '/commercial';
  if (billingId !== undefined) route += '/' + encodeURIComponent(commercialIdentifier(billingId, 'Billing identifier'));
  if (milestoneId !== undefined) route += '/milestones/' + encodeURIComponent(commercialIdentifier(milestoneId, 'Milestone identifier'));
  return route;
};


const EXPENSE_BILLING_FIELDS=['requestId','actor','expectedVersion','previousId','mode','endpointId','customerId','currency','sourceIds','authorization','authorizedOn','creditReviewNote','reason','issueDate','dueDate','effectiveDate','resolution','purchaseOrder','note','lines','expectedPreviewSha256'];
function expenseBillingInput(body,prepare=false){
  exact(body,EXPENSE_BILLING_FIELDS,['requestId','actor','expectedVersion','mode','sourceIds','authorization','authorizedOn','creditReviewNote','reason','lines',...(prepare?['expectedPreviewSha256']:[])]);
  requestId(body.requestId);text(body.actor,'Original recording operator',300);integer(body.expectedVersion,'Current case version');
  need(['NEW','DRAFT_EDIT','CREDIT','VOID','REPLACE'].includes(body.mode),'GRANT_INVALID_INPUT','Choose the original expense charge or reviewed correction.');
  if(body.previousId!==undefined&&body.previousId!==null)id(body.previousId,'expense-billing');
  need(body.mode==='NEW'?!body.previousId:!!body.previousId,'GRANT_INVALID_INPUT','A new charge has no previous ID; a correction retains its original charge ID.');
  for(const [key,max] of [['authorization',12000],['creditReviewNote',6000],['reason',3000]])text(body[key],key,max);
  need(Array.isArray(body.sourceIds)&&body.sourceIds.length>0&&new Set(body.sourceIds).size===body.sourceIds.length,'GRANT_INVALID_INPUT','Select distinct retained original authority sources.');
  body.sourceIds.forEach(value=>id(value,'source'));
  for(const key of ['authorizedOn','issueDate','dueDate','effectiveDate'])if(body[key]!==undefined)completionDate(body[key]);
  if(body.endpointId!==undefined)text(body.endpointId,'Original accounting endpoint',200);
  if(body.customerId!==undefined)text(body.customerId,'Original native customer',100);
  if(body.mode==='NEW'){text(body.endpointId,'Original accounting endpoint',200);text(body.customerId,'Original native customer',100);object(body.currency,'Original currency');}
  if(body.currency!==undefined){
    exact(body.currency,['code','scale'],['code','scale']);
    need(typeof body.currency.code==='string'&&/^[A-Z]{3}$/.test(body.currency.code),'GRANT_INVALID_INPUT','Keep the native currency code.');
    integer(body.currency.scale,'Original currency precision',0,6);
  }
  if(body.resolution!==undefined)need(['CREDIT','VOID'].includes(body.resolution),'GRANT_INVALID_INPUT','Choose the reviewed original invoice treatment.');
  for(const [key,max] of [['purchaseOrder',300],['note',6000]])if(body[key]!==undefined)text(body[key],key,max,true);
  if(body.expectedPreviewSha256!==undefined)sha(body.expectedPreviewSha256);
  need(Array.isArray(body.lines)&&body.lines.length>=1&&body.lines.length<=200,'GRANT_INVALID_INPUT','Retain one through 200 original expense portions.');
  for(const line of body.lines){
    exact(line,['attributionId','expectedContentSha256','costId','nativeAmount','amountBasis','amount','description'],['attributionId','expectedContentSha256','costId','nativeAmount','amountBasis','amount','description']);
    id(line.attributionId,'expense-attribution');sha(line.expectedContentSha256);text(line.costId,'Original work-package cost',300);
    need(typeof line.nativeAmount==='string'&&/^(?:0|[1-9][0-9]{0,99})$/.test(line.nativeAmount),'GRANT_INVALID_INPUT','Retain exact integer native units as a string.');
    need(['REVIEWED_USD','AGREED_AMOUNT'].includes(line.amountBasis),'GRANT_INVALID_INPUT','Choose the retained valuation basis.');
    text(line.amount,'Exact reviewed customer decimal amount',100);text(line.description,'Native invoice line description',3000);
  }
}
const expenseBillingPath=(caseId,chargeId)=>'/api/operations/'+encodeURIComponent(id(caseId,'operation'))+'/expense-billing'+
  (chargeId===undefined?'':'/'+encodeURIComponent(id(chargeId,'expense-billing')));


const hourlyAuthorityId=value=>{
  need(typeof value==='string'&&/^hourly-authority-[a-f0-9]{32}-r[1-9][0-9]*$/.test(value),
    'GRANT_INVALID_INPUT','Use the original customer hourly authority edition.');return value;
};
const workBillingPath=(caseId,chargeId)=>'/api/operations/'+encodeURIComponent(id(caseId,'operation'))+'/work-billing'+
  (chargeId===undefined?'':'/'+encodeURIComponent(id(chargeId,'work-billing')));
const workHours=value=>{
  need(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,4})?$/.test(value),
    'GRANT_INVALID_INPUT','Keep exact nonnegative hour text with at most four decimal places.');return value;
};
function hourlyAuthorityInput(body){
  exact(body,['requestId','actor','expectedVersion','previousId','expectedAuthoritySha256','terms'],
    ['requestId','actor','expectedVersion','terms']);
  requestId(body.requestId);text(body.actor,'Recording operator',300);integer(body.expectedVersion,'Current case version');
  if(body.previousId!==undefined&&body.previousId!==null){hourlyAuthorityId(body.previousId);sha(body.expectedAuthoritySha256);}
  if(body.expectedAuthoritySha256!==undefined)sha(body.expectedAuthoritySha256);
  const terms=body.terms,fields=['title','authorization','authorizedOn','sourceIds','endpointId','customerId','currency','periodStart','periodEnd','rates','rounding','hoursCap','amountCap'];
  exact(terms,fields,fields);text(terms.title,'Customer hourly authority',300);text(terms.authorization,'Actual customer terms',12000);
  for(const key of ['authorizedOn','periodStart','periodEnd'])completionDate(terms[key]);
  need(terms.periodEnd>=terms.periodStart,'GRANT_INVALID_INPUT','The customer service period must end on or after its start.');
  need(Array.isArray(terms.sourceIds)&&terms.sourceIds.length>0&&new Set(terms.sourceIds).size===terms.sourceIds.length,'GRANT_INVALID_INPUT','Retain distinct original customer authority sources.');
  terms.sourceIds.forEach(value=>id(value,'source'));
  text(terms.endpointId,'Original accounting endpoint',200);text(terms.customerId,'Original native customer',100);
  exact(terms.currency,['code','scale'],['code','scale']);
  need(typeof terms.currency.code==='string'&&/^[A-Z]{3}$/.test(terms.currency.code),'GRANT_INVALID_INPUT','Keep the native currency code.');
  integer(terms.currency.scale,'Native currency precision',0,6);
  need(['EXACT','HALF_UP'].includes(terms.rounding),'GRANT_INVALID_INPUT','Choose the declared per-line rounding policy.');
  if(terms.hoursCap!==null)workHours(terms.hoursCap);
  if(terms.amountCap!==null)text(terms.amountCap,'Whole authority amount cap',100);
  need(Array.isArray(terms.rates)&&terms.rates.length>=1&&terms.rates.length<=200,'GRANT_INVALID_INPUT','Retain one through 200 explicitly scoped hourly rates.');
  const ids=new Set();
  for(const rate of terms.rates){
    exact(rate,['id','label','contributorIds','costIds','hourlyRate'],['id','label','contributorIds','costIds','hourlyRate']);
    requestId(rate.id);need(!ids.has(rate.id),'GRANT_INVALID_INPUT','Hourly rate identities must be distinct.');ids.add(rate.id);
    text(rate.label,'Hourly rate description',300);text(rate.hourlyRate,'Exact hourly rate amount',100);
    for(const key of ['contributorIds','costIds']){
      need(Array.isArray(rate[key])&&rate[key].length>0&&new Set(rate[key]).size===rate[key].length,'GRANT_INVALID_INPUT','Retain explicit distinct rate scopes.');
      rate[key].forEach(value=>text(value,key,300));
    }
  }
}
const WORK_BILLING_FIELDS=['requestId','actor','expectedVersion','previousId','mode','authorityId','expectedAuthoritySha256','reason','issueDate','dueDate','effectiveDate','resolution','purchaseOrder','note','lines','expectedPreviewSha256'];
function workBillingInput(body,prepare=false){
  exact(body,WORK_BILLING_FIELDS,['requestId','actor','expectedVersion','mode','authorityId','expectedAuthoritySha256','reason','lines',...(prepare?['expectedPreviewSha256']:[])]);
  requestId(body.requestId);text(body.actor,'Original recording operator',300);integer(body.expectedVersion,'Current case version');
  hourlyAuthorityId(body.authorityId);sha(body.expectedAuthoritySha256);text(body.reason,'Hourly charge or correction reason',3000);
  need(['NEW','DRAFT_EDIT','CREDIT','VOID','REPLACE'].includes(body.mode),'GRANT_INVALID_INPUT','Choose an original hourly charge or reviewed correction.');
  if(body.previousId!==undefined&&body.previousId!==null)id(body.previousId,'work-billing');
  need(body.mode==='NEW'?!body.previousId:!!body.previousId,'GRANT_INVALID_INPUT','A correction retains its original charge; a new charge has no previous ID.');
  for(const key of ['issueDate','dueDate','effectiveDate'])if(body[key]!==undefined)completionDate(body[key]);
  if(body.resolution!==undefined)need(['CREDIT','VOID'].includes(body.resolution),'GRANT_INVALID_INPUT','Choose the original invoice credit or void disposition.');
  for(const [key,max]of [['purchaseOrder',300],['note',6000]])if(body[key]!==undefined)text(body[key],key,max,true);
  if(body.expectedPreviewSha256!==undefined)sha(body.expectedPreviewSha256);
  need(Array.isArray(body.lines)&&body.lines.length>=1&&body.lines.length<=200,'GRANT_INVALID_INPUT','Retain one through 200 original Work portions.');
  const selected=new Set();
  for(const line of body.lines){
    exact(line,['workId','expectedWorkSha256','rateId','hours','description'],['workId','expectedWorkSha256','rateId','hours','description']);
    id(line.workId,'work');sha(line.expectedWorkSha256);requestId(line.rateId);workHours(line.hours);text(line.description,'Native hourly invoice description',3000);
    need(!selected.has(line.workId),'GRANT_INVALID_INPUT','Combine each original Work record once in this charge.');selected.add(line.workId);
  }
}

const CHANGE_FIELDS=['expectedVersion','previousChangeId','actor','sourceIds','mode','resolution','targetAmount','issueDate','dueDate','effectiveDate','authorizedOn','description','reason','authorization','purchaseOrder','note'];
function commercialChangeSource(body, prepare=false){
  const fields=prepare?[...CHANGE_FIELDS,'requestId','expectedPreviewSha256']:CHANGE_FIELDS;
  exact(body,fields,['expectedVersion','actor','sourceIds','mode','targetAmount','effectiveDate','authorizedOn','reason','authorization',...(prepare?['requestId','expectedPreviewSha256']:[])]);
  integer(body.expectedVersion,'Current case version');text(body.actor,'Recording operator',300);
  for(const [key,max] of [['reason',3000],['authorization',12000]])text(body[key],key,max);
  need(['DRAFT_EDIT','CREDIT','VOID','REPLACE'].includes(body.mode),'GRANT_INVALID_INPUT','Choose the native milestone change.');
  need(Array.isArray(body.sourceIds)&&body.sourceIds.length>0&&new Set(body.sourceIds).size===body.sourceIds.length,'GRANT_INVALID_INPUT','Select distinct original authorization sources.');
  body.sourceIds.forEach(value=>id(value,'source'));text(body.targetAmount,'Exact revised amount',100);
  for(const key of ['effectiveDate','authorizedOn','issueDate','dueDate'])if(body[key]!==undefined)completionDate(body[key]);
  if(body.previousChangeId!==undefined&&body.previousChangeId!==null)commercialIdentifier(body.previousChangeId);
  if(body.resolution!==undefined)need(['VOID','CREDIT'].includes(body.resolution),'GRANT_INVALID_INPUT','Choose the original invoice treatment.');
  for(const [key,max] of [['description',3000],['purchaseOrder',300],['note',6000]])if(body[key]!==undefined)text(body[key],key,max,true);
  if(prepare){requestId(body.requestId);sha(body.expectedPreviewSha256);}
}
const commercialChangePath=(caseId,changeId)=>commercialPath(caseId)+'/changes/'+encodeURIComponent(commercialIdentifier(changeId,'Change identifier'));

const COMMERCIAL_SELECTION_FIELDS = [
  'expectedVersion','installationId','installationRevision','expectedInstallationSha256','currencyScale',
];
const commercialSource = body => {
  integer(body.expectedVersion, 'Current case version');
  id(body.installationId, 'installation');
  integer(body.installationRevision, 'Selected installation edition', 1, 500);
  sha(body.expectedInstallationSha256);
  integer(body.currencyScale, 'Original currency precision', 0, 6);
};
const commercialMilestones = rows => {
  need(Array.isArray(rows) && rows.length >= 1 && rows.length <= 250,
    'GRANT_INVALID_INPUT', 'Map every original commercial milestone exactly once.');
  const seen = new Set();
  for (const row of rows) {
    exact(row, ['milestoneId','issueDate','dueDate','billingBasis','requiredCheckIds','authorizationSourceIds','authorizationNote'],
      ['milestoneId','issueDate','dueDate','billingBasis']);
    commercialIdentifier(row.milestoneId, 'Original milestone identifier');
    need(!seen.has(row.milestoneId), 'GRANT_INVALID_INPUT', 'Map each original milestone once.');
    seen.add(row.milestoneId);
    completionDate(row.issueDate); completionDate(row.dueDate);
    need(row.dueDate >= row.issueDate, 'GRANT_INVALID_INPUT', 'The due date must follow or equal the issue date.');
    need(['PHASE_ACCEPTANCE','COMMERCIAL_AUTHORIZATION'].includes(row.billingBasis),
      'GRANT_INVALID_INPUT', 'Choose the original phase acceptance or retained commercial authorization.');
    const checks = row.requiredCheckIds ?? [], sources = row.authorizationSourceIds ?? [];
    for (const [values, label] of [[checks, 'Required phase checks'], [sources, 'Authorization sources']]) {
      need(Array.isArray(values) && new Set(values).size === values.length,
        'GRANT_INVALID_INPUT', label + ' must be a list of distinct original identifiers.');
      for (const value of values) text(value, label, 300);
    }
    for (const value of sources) id(value, 'source');
    if (row.authorizationNote !== undefined) text(row.authorizationNote, 'Commercial authorization', 6000, true);
    need(row.billingBasis !== 'PHASE_ACCEPTANCE' || checks.length > 0,
      'GRANT_INVALID_INPUT', 'Select the original phase checks for this milestone.');
    need(row.billingBasis !== 'COMMERCIAL_AUTHORIZATION' ||
      (sources.length > 0 && typeof row.authorizationNote === 'string' && row.authorizationNote.trim()),
      'GRANT_INVALID_INPUT', 'Retain the commercial authorization note and its original source.');
  }
};
const commercialRecovery = (caseId, billingId, milestoneId, action) =>
  'Read the original billing record ' + billingId + ' in case ' + caseId +
  (milestoneId === undefined ? '' : ', milestone ' + milestoneId) +
  ', then repeat the same ' + action + ' selection to recover its retained native result.';

const WORKSHARE_SOURCE_FIELDS = ['sourceId','expectedSourceSha256','packetSourceId','expectedPacketSha256'];
function workshareSources(body) {
  id(body.sourceId,'source'); sha(body.expectedSourceSha256);
  const packet=body.packetSourceId??null, packetSha=body.expectedPacketSha256??null;
  need((packet===null)===(packetSha===null),'GRANT_INVALID_INPUT',
    'Select the original receiving packet and its SHA-256 together.');
  if(packet!==null){
    id(packet,'source'); sha(packetSha);
    need(packet!==body.sourceId,'GRANT_INVALID_INPUT',
      'Select distinct complete commissioning and receiving packet files.');
  }
}

const completionDate = value => {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    'GRANT_INVALID_INPUT', 'Use the native calendar date in YYYY-MM-DD form.');
  return value;
};
function riskComparisonQuery(args, kind = null) {
  const fields = ['caseId','beforeReviewId','beforeReviewSha256','afterReviewId','afterReviewSha256'];
  const required = [...fields];
  if (kind !== null) {
    fields.push('kind','expectedComparisonSha256'); required.push('expectedComparisonSha256');
    if (kind === 'risk-comparison') { fields.push('expectedVersion'); required.push('expectedVersion'); }
  }
  exact(args, fields, required);
  if (Object.hasOwn(args, 'kind'))
    need(args.kind === kind, 'GRANT_INVALID_INPUT', 'Keep the selected native comparison export kind.');
  id(args.caseId, 'operation');
  const values = new URLSearchParams({
    beforeReviewId:id(args.beforeReviewId,'review'),
    beforeReviewSha256:sha(args.beforeReviewSha256),
    afterReviewId:id(args.afterReviewId,'review'),
    afterReviewSha256:sha(args.afterReviewSha256),
  });
  if (kind !== null) values.set('expectedComparisonSha256',sha(args.expectedComparisonSha256));
  if (kind === 'risk-comparison')
    values.set('expectedVersion',String(integer(args.expectedVersion,'Selected comparison case version')));
  return '?' + values.toString();
}
function forecastComparisonQuery(args, exported = false) {
  const values = new URLSearchParams({beforeId:id(args.beforeId,'forecast'),afterId:id(args.afterId,'forecast')});
  if(args.expectedComparisonSha256 !== undefined || exported)
    values.set('expectedComparisonSha256',sha(args.expectedComparisonSha256));
  return '?' + values.toString();
}
function planComparisonQuery(args, exported = false) {
  const values = new URLSearchParams({
    fromRevision:String(integer(args.fromRevision,'Before saved revision',1,1000000)),
    toRevision:String(integer(args.toRevision,'After saved revision',1,1000000)),
  });
  if(args.toPlanId !== undefined)values.set('toPlanId',id(args.toPlanId,'plan'));
  if(args.expectedComparisonSha256 !== undefined || exported)
    values.set('expectedComparisonSha256',sha(args.expectedComparisonSha256));
  return '?' + values.toString();
}
function deliveryAgendaQuery(args, exported = false) {
  const fields = ['caseIds','asOfDate','expectedVersions'];
  if (exported) fields.push('format','kind');
  exact(args, fields, ['caseIds']);
  if (args.kind !== undefined)
    need(args.kind === 'delivery-agenda','GRANT_INVALID_INPUT','Select the delivery-agenda export.');
  need(Array.isArray(args.caseIds) && args.caseIds.length > 0,
    'GRANT_INVALID_INPUT','Select at least one original operations case.');
  const identities = args.caseIds.map(value => id(value, 'operation'));
  need(new Set(identities).size === identities.length,
    'GRANT_INVALID_INPUT','Select each original case once.');
  const query = new URLSearchParams();
  for (const ident of identities) query.append('caseId', ident);
  if (args.asOfDate !== undefined) query.set('asOfDate', completionDate(args.asOfDate));
  if (args.expectedVersions !== undefined) {
    exact(args.expectedVersions, identities, identities);
    const versions = Object.fromEntries(identities.map(ident =>
      [ident, integer(args.expectedVersions[ident], 'Selected agenda case version')]));
    query.set('expectedVersions', JSON.stringify(versions));
  }
  return '?' + query.toString();
}
function deliveryCalendarQuery(args) {
  const query = new URLSearchParams();
  if (args.asOfDate !== undefined) query.set('asOfDate', completionDate(args.asOfDate));
  if (args.expectedVersion !== undefined)
    query.set('expectedVersion', String(integer(args.expectedVersion, 'Selected calendar case version')));
  return query.size ? '?' + query : '';
}
function customerUseRefs(value) {
  need(Array.isArray(value) && value.length <= 100, 'GRANT_INVALID_INPUT', 'Select at most 100 original Installation editions.');
  const seen=new Set();
  for(const row of value){
    exact(row,['id','revision','sha256'],['id','revision']);
    id(row.id,'installation');integer(row.revision,'Selected Installation edition',1,500);
    need(!seen.has(row.id),'GRANT_INVALID_INPUT','Select one exact edition per Installation.');seen.add(row.id);
    if(row.sha256!==undefined)sha(row.sha256);
  }
  return value;
}
function customerUseQuery(args) {
  const query=new URLSearchParams({expectedVersion:String(integer(args.expectedVersion,'Selected customer-use case version'))});
  if(args.asOfDate!==undefined)query.set('asOfDate',completionDate(args.asOfDate));
  if(args.installationRefs!==undefined)query.set('installationRefs',JSON.stringify(customerUseRefs(args.installationRefs)));
  return '?'+query;
}
function deliveryCalendarFormat(value = 'ics') {
  need(['ics','csv','json'].includes(value), 'GRANT_INVALID_INPUT', 'Choose the ICS, CSV or JSON calendar format.');
  return value;
}
function performanceQuery(args, exported = false) {
  const values = new URLSearchParams();
  if (args.startDate !== undefined && args.startDate !== null && args.startDate !== '')
    values.set('startDate', completionDate(args.startDate));
  if (args.endDate !== undefined) values.set('endDate', completionDate(args.endDate));
  if (args.expectedVersion !== undefined || exported)
    values.set('expectedVersion', String(integer(args.expectedVersion, 'Reviewed case version')));
  if (exported) {
    completionDate(args.endDate);
    values.set('expectedReportSha256', sha(args.expectedReportSha256));
  }
  return values.size ? '?' + values.toString() : '';
}
function supplierAccountQuery(args, exported = false) {
  const values = new URLSearchParams(performanceQuery(args, exported));
  if (args.contributorId !== undefined && args.contributorId !== null)
    values.set('contributorId', id(args.contributorId, 'person'));
  return values.size ? '?' + values.toString() : '';
}
function accountReconciliationQuery(args, exported = false) {
  const values = new URLSearchParams();
  if (args.reconciliationId !== undefined && args.reconciliationId !== null)
    values.set('reconciliationId', id(args.reconciliationId, 'reconciliation'));
  if (args.revision !== undefined && args.revision !== null) {
    need(values.has('reconciliationId'), 'GRANT_INVALID_INPUT', 'Select the original reconciliation for this edition.');
    values.set('revision', String(integer(args.revision, 'Original reconciliation edition')));
  }
  if (args.expectedVersion !== undefined || exported)
    values.set('expectedVersion', String(integer(args.expectedVersion, 'Reviewed case version')));
  if (exported) values.set('expectedReportSha256', sha(args.expectedReportSha256));
  return values.size ? '?' + values.toString() : '';
}
function accountReconciliationInput(body, applying = false) {
  const keys = ['expectedVersion','reconciliationId','expectedRevision','state','document'];
  if (applying) keys.push('expectedPreviewSha256','requestId','actor');
  exact(body, keys, keys);
  integer(body.expectedVersion, 'Original case version');
  integer(body.expectedRevision, 'Current reconciliation edition', 0);
  if (body.reconciliationId !== null) id(body.reconciliationId, 'reconciliation');
  need(body.reconciliationId === null ? body.expectedRevision === 0 : body.expectedRevision >= 1,
    'GRANT_INVALID_INPUT', 'Select edition zero for a new reconciliation or the current original edition.');
  need(['DRAFT','CLOSED'].includes(body.state), 'GRANT_INVALID_INPUT', 'Save a draft reconciliation or a closed period.');
  object(body.document, 'Complete original reconciliation document');
  if (applying) { sha(body.expectedPreviewSha256); requestId(body.requestId); text(body.actor, 'Recording operator', 300); }
  return body;
}
function cashAccountQuery(args, exported = false) {
  const values = new URLSearchParams(performanceQuery(args, exported));
  for (const [key,maximum] of [['network',200],['currency',40],['asset',500]])
    if (args[key] !== undefined && args[key] !== null)
      values.set(key, text(args[key], 'Cash account ' + key, maximum, true));
  return values.size ? '?' + values.toString() : '';
}
function cashCorrectionInput(body, applying = false) {
  const keys = ['expectedVersion','selection','originalCashId','replacement','reason','attachments'];
  const required = ['expectedVersion','originalCashId','replacement','reason'];
  if (applying) { keys.push('expectedPreviewSha256','requestId','actor'); required.push('expectedPreviewSha256','requestId','actor'); }
  exact(body, keys, required);
  integer(body.expectedVersion, 'Current case version', 1, 10000000);
  id(body.originalCashId, 'cash'); object(body.replacement, 'Complete replacement observation');
  text(body.reason, 'Correction reason', 12000);
  if (body.selection !== undefined) object(body.selection, 'Original cash account selection');
  if (body.attachments !== undefined)
    need(Array.isArray(body.attachments), 'GRANT_INVALID_INPUT', 'Use the complete original source attachments array.');
  if (applying) { sha(body.expectedPreviewSha256); requestId(body.requestId); text(body.actor, 'Recording operator', 300); }
  return body;
}
const cohortReviewIds = value => {
  need(Array.isArray(value) && value.length <= 20 && new Set(value).size === value.length,
    'GRANT_INVALID_INPUT', 'Select at most 20 distinct original frozen cohort reviews.');
  for (const selected of value) id(selected, 'review');
  return value;
};
const implementationReviewIds = value => {
  need(Array.isArray(value) && value.length <= 20 && new Set(value).size === value.length,
    'GRANT_INVALID_INPUT', 'Select at most 20 distinct original frozen implementation reviews.');
  for (const selected of value) id(selected, 'review');
  return value;
};
const implementationCutoff = value => {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    'GRANT_INVALID_INPUT', 'Use the exact implementation cutoff in UTC with milliseconds.');
  return value;
};
// Preserve the complete input; the original case owns source membership,
// current outcome/head and finding readiness decisions.
const completionCorrectionInputs = inputs => {
  const inputKeys=['roundId','previousReviewId','outcomeId','expectedOutcomeSha256','document'];
  exact(inputs,inputKeys,inputKeys);
  id(inputs.roundId,'corrections'); id(inputs.outcomeId,'outcome'); sha(inputs.expectedOutcomeSha256);
  if(inputs.previousReviewId!==null)id(inputs.previousReviewId,'review');
  exact(inputs.document,['title','findings','note'],['title','findings','note']);
  text(inputs.document.title,'Correction round title',300);
  text(inputs.document.note,'Correction note',12000,true);
  need(Array.isArray(inputs.document.findings)&&inputs.document.findings.length>=1&&
    inputs.document.findings.length<=100,'GRANT_INVALID_INPUT','Retain one to 100 original issuer findings.');
  const seen=new Set();
  for(const finding of inputs.document.findings){
    const keys=['id','request','basis','costIds','ownerIds','state','dueOn','completedOn',
      'response','workIds','deploymentIds','sourceIds'];
    exact(finding,keys,keys);id(finding.id,'finding');
    need(!seen.has(finding.id),'GRANT_INVALID_INPUT','Retain each original finding once.');seen.add(finding.id);
    text(finding.request,'Original issuer finding',12000);
    text(finding.basis,'Original finding source',12000);
    text(finding.response,'Correction response',12000,true);
    need(['OPEN','IN_PROGRESS','ADDRESSED','NOT_APPLICABLE'].includes(finding.state),
      'GRANT_INVALID_INPUT','Use the native correction work state.');
    for(const key of ['dueOn','completedOn'])if(finding[key]!==null)completionDate(finding[key]);
    for(const key of ['costIds','ownerIds','workIds','deploymentIds','sourceIds']){
      need(Array.isArray(finding[key])&&new Set(finding[key]).size===finding[key].length&&
        finding[key].every(value=>typeof value==='string'&&value.length>0&&!value.includes('\0')),
      'GRANT_INVALID_INPUT','Retain distinct original '+key+' selections.');
    }
  }
  return inputs;
};

const COMPLETION_FIELDS = Object.freeze({
  save:{allowed:['inputs'], required:['inputs']},
  prepare:{allowed:['receiptId','asOfDate','summary','expectedPreviewSha256','cohortReviewIds','implementationReviewIds','correctionReviewId'],
    required:['receiptId','asOfDate','summary','expectedPreviewSha256']},
  extension:{allowed:['receiptId','confirmedOn','deadlineOn','reference','sourceIds','confirmationNote'],
    required:['receiptId','confirmedOn','deadlineOn','reference']},
  submit:{allowed:['reviewId','expectedReviewSha256','submittedOn','formReference','sourceIds','sourceNote'],
    required:['reviewId','expectedReviewSha256','submittedOn','formReference']},
  decision:{allowed:['outcomeId','state','date','sourceIds','sourceNote'],
    required:['outcomeId','state','date','sourceNote']},
});
function completionInstallationSelections(inputs) {
  object(inputs,'Completion assignments');
  if (inputs.installationSelections === undefined) return;
  const rows=inputs.installationSelections, seen=new Set(), editions=new Map();
  need(Array.isArray(rows) && rows.length<=200,'GRANT_INVALID_INPUT',
    'Select up to two hundred complete original Installation checks.');
  for(const row of rows){
    exact(row,['costId','installationId','revision','sha256','checkId','requirePaidPurchase'],
      ['costId','installationId','revision','sha256','checkId','requirePaidPurchase']);
    text(row.costId,'Original completion work package',300); id(row.installationId,'installation');
    integer(row.revision,'Original Installation edition',1,500); sha(row.sha256);
    text(row.checkId,'Original Installation check',80);
    need(typeof row.requirePaidPurchase==='boolean','GRANT_INVALID_INPUT',
      'State the useful paid-purchase requirement explicitly.');
    const key=JSON.stringify([row.costId,row.installationId,row.checkId]);
    const edition=JSON.stringify([row.revision,row.sha256]);
    need(!seen.has(key) && (!editions.has(row.installationId) || editions.get(row.installationId)===edition),
      'GRANT_INVALID_INPUT','Keep each package/check once and one exact edition per Installation.');
    seen.add(key); editions.set(row.installationId,edition);
  }
  need(editions.size<=20,'GRANT_INVALID_INPUT','Select at most twenty complete Installation editions.');
}
function completionCommandBody(action, body) {
  const selected=COMPLETION_FIELDS[action];
  need(selected, 'GRANT_INVALID_ACTION', 'Choose an original completion lifecycle action.');
  const common=['expectedVersion','requestId','actor','note'];
  exact(body, [...common,...selected.allowed], ['expectedVersion','requestId','actor',...selected.required]);
  const original=Object.fromEntries(Object.entries(body).filter(([key])=>common.includes(key)));
  const data=Object.fromEntries(Object.entries(body).filter(([key])=>selected.allowed.includes(key)));
  if (data.receiptId !== undefined) id(data.receiptId,'cash');
  if (data.reviewId !== undefined) id(data.reviewId,'review');
  if (data.correctionReviewId !== undefined) id(data.correctionReviewId,'review');
  if (data.outcomeId !== undefined) id(data.outcomeId,'outcome');
  if (data.inputs !== undefined) completionInstallationSelections(data.inputs);
  if (data.cohortReviewIds !== undefined) cohortReviewIds(data.cohortReviewIds);
  if (data.implementationReviewIds !== undefined) implementationReviewIds(data.implementationReviewIds);
  for (const key of ['asOfDate','confirmedOn','deadlineOn','submittedOn','date'])
    if (data[key] !== undefined) completionDate(data[key]);
  for (const key of ['expectedPreviewSha256','expectedReviewSha256'])
    if (data[key] !== undefined) sha(data[key]);
  if (action === 'decision') need(['ACCEPTED','CHANGES_REQUESTED','WITHDRAWN'].includes(data.state),
    'GRANT_INVALID_INPUT', 'Use the original recorded issuer outcome.');
  if (Object.hasOwn(data,'confirmationNote')) { data.note=data.confirmationNote; delete data.confirmationNote; }
  return {...original,action:'completion.'+action,data};
}

const SUPPORT_DEPLOYMENT_FIELDS = [
  'name', 'operator', 'operatorId', 'role', 'participantClass', 'environment', 'state',
  'costIds', 'tranche', 'endpoint', 'releaseRef', 'caseRef', 'acceptedBy', 'acceptedAt', 'sourceNote',
];
const supportHandoff = (bytes, filename) => {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_MAX_SOURCE_BYTES,
    'GRANT_INPUT_TOO_LARGE', 'Use the complete nonempty original support handoff up to 8 MiB.');
  text(filename, 'Original support filename', 240);
  need(!/[\x00-\x1f\x7f\\/]/.test(filename) && !['.', '..'].includes(filename),
    'GRANT_INVALID_INPUT', 'Use the plain original support filename without directory components.');
  return {filename, contentBase64:bytes.toString('base64')};
};




const buyerHandoff = (bytes, filename) => {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_MAX_SOURCE_BYTES,
    'GRANT_INPUT_TOO_LARGE', 'Use the complete nonempty original buyer handoff up to 8 MiB.');
  need(typeof filename === 'string' && filename.trim() && [...filename].length <= 240 &&
    !/[\x00-\x1f\\/]/.test(filename) && !['.', '..'].includes(filename.trim()),
    'GRANT_INVALID_INPUT', 'Use the plain original buyer filename without directory components.');
  return {filename, contentBase64:bytes.toString('base64')};
};
const buyerSelections = value => {
  need(Array.isArray(value) && value.length >= 1 && value.length <= 100,
    'GRANT_INVALID_INPUT', 'Select from one through 100 original buyer jobs.');
  const jobs = new Set(), purchases = new Set();
  for (const row of value) {
    exact(row, ['jobId', 'purchaseId'], ['jobId', 'purchaseId']);
    sha(row.jobId);
    need(!jobs.has(row.jobId), 'GRANT_INVALID_INPUT', 'Select each original buyer job once.');
    jobs.add(row.jobId);
    if (row.purchaseId !== null) {
      id(row.purchaseId, 'purchase');
      need(!purchases.has(row.purchaseId), 'GRANT_INVALID_INPUT',
        'Each selected source job retains its own original purchase.');
      purchases.add(row.purchaseId);
    }
  }
  return value;
};

/** Exact regular-file input. Private launch records additionally keep original ownership. */
export async function readGrantAgentFile(filename, maximum = GRANT_MAX_BUNDLE_BYTES, privateOnly = false) {
  const fd = await open(path(filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    need(before.isFile() && before.size <= maximum, 'GRANT_INPUT_FILE_INVALID',
      'Select one complete regular file within its native size bound.');
    if (privateOnly) need(before.nlink === 1 && !(before.mode & 0o077) &&
      (!process.getuid || before.uid === process.getuid()), 'GRANT_PRIVATE_LAUNCH_REQUIRED',
    'Keep the original launch record private and owned by its operator.');
    const bytes = await fd.readFile(), after = await fd.stat();
    need(bytes.length === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'GRANT_INPUT_CHANGED', 'The original file changed during its read.');
    return bytes;
  } finally { await fd.close(); }
}

/** Configuration performs no process launch and no SQLite open. */
export async function inspectGrantAgentBinding(input) {
  exact(input, ['directory', 'scenarioFile', 'pythonExecutable', 'allowStart', 'label'], ['directory']);
  const directory = path(input.directory), pythonExecutable = path(input.pythonExecutable ?? '/usr/bin/python3');
  if (input.allowStart !== undefined) need(typeof input.allowStart === 'boolean', 'GRANT_CONFIGURATION_ERROR',
    'allowStart must be an explicit host boolean.');
  const selected = await inspectGrantWorkspaceSelection({workspaceDirectory:directory,
    pythonExecutable, ...(input.scenarioFile ? {scenarioFile:path(input.scenarioFile)} : {})});
  return {directory, scenarioFile:selected.selection.scenarioFile, pythonExecutable,
    allowStart:input.allowStart === true, label:text(input.label ?? 'Grant workspace', 'Workspace label', 240),
    selectionSha256:selected.selectionSha256, selection:selected.selection};
}

function publicOriginal(record) {
  const {accessToken, ...original} = record;
  return original;
}
function originalSource(connection) {
  const record = connection.original;
  return {schema:GRANT_LAUNCH_SCHEMA, instanceId:record.instanceId, pid:record.pid,
    selectionSha256:record.selectionSha256, url:record.url, sourceDirectory:record.selection.sourceDirectory,
    executionSourceDirectory:record.execution.sourceDirectory};
}
function transport(connection, route, {body, contentType = 'application/json', headers = {},
  originalRequestId, timeoutMs = 30000, mutation = body !== undefined, maxResponseBytes = MAX_RESPONSE_BYTES} = {}) {
  need(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 1 &&
    maxResponseBytes <= INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES, 'GRANT_RESPONSE_LIMIT',
    'Use the declared complete original response bound.');
  const target = new URL(route, connection.original.url), authorization = new URL(connection.url).hash.slice('#access='.length);
  need(target.origin === new URL(connection.original.url).origin && route.startsWith('/api/'),
    'GRANT_ROUTE_INVALID', 'Use an original declared grant API route.');
  const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  need(bytes === undefined || bytes.length <= GRANT_MAX_BUNDLE_BYTES, 'GRANT_INPUT_TOO_LARGE',
    'The original grant API accepts complete requests up to 32 MiB.');
  return new Promise((resolveResult, reject) => {
    let dispatched = false, settled = false;
    const uncertain = failure => {
      if (settled) return;
      settled = true;
      if (mutation && dispatched && failure.definite !== true) {
        reject(error('GRANT_RESULT_UNCERTAIN',
          'The original request may have committed. Original request ID: ' + (originalRequestId ?? '(none)') +
          '. Reopen the original case or plan and repeat this identical request ID and payload to recover its saved result.',
          {requestId:originalRequestId ?? null, originalCode:failure.code ?? null, originalStatus:failure.status ?? null,
            source:originalSource(connection), route, uncertain:true}));
      } else reject(failure);
    };
    const req = httpRequest(target, {method:bytes === undefined ? 'GET' : 'POST', agent:false, maxHeaderSize:32768,
      headers:{Authorization:'Bearer ' + authorization, Accept:'application/json, application/zip, application/octet-stream',
        ...(bytes === undefined ? {} : {'Content-Type':contentType, 'Content-Length':String(bytes.length)}), ...headers}},
    response => {
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxResponseBytes) {
          req.destroy(error('GRANT_RESPONSE_TOO_LARGE', 'The original response exceeds its declared complete receiving bound of ' + maxResponseBytes + ' bytes.')); return;
        }
        chunks.push(chunk);
      });
      response.once('error', uncertain);
      response.once('aborted', () => uncertain(error('GRANT_RESPONSE_INTERRUPTED', 'The original response was interrupted.')));
      response.once('end', () => {
        if (settled) return;
        try {
          const raw = Buffer.concat(chunks), mediaType = String(response.headers['content-type'] ?? 'application/octet-stream');
          let value;
          if (/^application\/json\b/i.test(mediaType)) value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const problem = value?.error;
            throw error(problem?.code ?? 'GRANT_HTTP_ERROR', problem?.message ?? 'The original grant service returned HTTP ' + status + '.',
              {status, definite:status >= 400 && status < 500, source:originalSource(connection), requestId:originalRequestId ?? null});
          }
          if (mediaType.startsWith('application/json')) need(value !== undefined, 'GRANT_RESPONSE_INVALID', 'Read the original JSON response.');
          settled = true;
          resolveResult({value, bytes:raw, mediaType, status, sha256:digest(raw), source:originalSource(connection),
            filename:typeof response.headers['content-disposition'] === 'string'
              ? response.headers['content-disposition'].match(/filename="([^"]+)"/)?.[1] ?? null : null});
        } catch (failure) { uncertain(failure); }
      });
    });
    req.once('finish', () => { dispatched = true; });
    req.once('error', failure => { if (req.socket?.bytesWritten) dispatched = true; uncertain(failure); });
    req.setTimeout(timeoutMs, () => req.destroy(error('GRANT_REQUEST_TIMEOUT', 'The original grant request timed out.')));
    if (bytes) req.end(bytes); else req.end();
  });
}

function ownGrantLauncher(child) {
  const owned = {child, instanceId:null, done:null, closed:false, stopSent:false,
    firstError:null, stopError:null, diagnostics:'', startup:null, startupData:null, automaticStopAttempted:false};
  let resolveDone;
  owned.done = new Promise(resolve => { resolveDone = resolve; });
  owned.stop = () => {
    if (owned.closed || child.exitCode !== null || child.signalCode !== null || owned.stopSent) return;
    // A failed spawn still emits close. It has no process that this owner may signal.
    if (!child.pid && owned.firstError) return;
    const sent = child.kill('SIGTERM');
    if (!sent && !owned.closed && child.exitCode === null && child.signalCode === null)
      throw error('GRANT_SHUTDOWN_INCOMPLETE', 'The original grant launcher has not accepted its stop signal.');
    if (sent) owned.stopSent = true;
  };
  const recordFailure = (failure, channel) => {
    if (!owned.firstError) {
      owned.firstError = failure;
      owned.errorChannel = channel;
    }
    owned.startup?.(owned.firstError);
    if (!owned.automaticStopAttempted) {
      owned.automaticStopAttempted = true;
      try { owned.stop(); } catch (stopFailure) { owned.stopError ??= stopFailure; }
    }
  };
  const onError = failure => recordFailure(failure, 'launcher');
  const onStdoutError = failure => recordFailure(failure, 'stdout');
  const onStderrError = failure => recordFailure(failure, 'stderr');
  const onStdout = chunk => {
    try { owned.startupData?.(chunk); } catch (failure) { recordFailure(failure, 'stdout'); }
  };
  const onStderr = chunk => {
    try { owned.diagnostics = (owned.diagnostics + chunk.toString('utf8')).slice(-16384); }
    catch (failure) { recordFailure(failure, 'stderr'); }
  };
  child.on('error', onError);
  child.stdout?.on('error', onStdoutError); child.stdout?.on('data', onStdout);
  child.stderr?.on('error', onStderrError); child.stderr?.on('data', onStderr);
  child.once('close', (code, signal) => {
    owned.closed = true;
    // Child close follows the original stdio close. Retain error ownership through
    // the next event turn before releasing those listeners or resolving custody.
    setImmediate(() => {
      child.removeListener('error', onError);
      child.stdout?.removeListener('error', onStdoutError); child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('error', onStderrError); child.stderr?.removeListener('data', onStderr);
      resolveDone({code, signal, error:owned.firstError?.code ?? null,
        errorChannel:owned.errorChannel ?? null, diagnostics:owned.diagnostics,
        ...(owned.firstError ? {message:String(owned.firstError.message ?? owned.firstError).slice(0,1024)} : {})});
    });
  });
  return owned;
}

const SETTLEMENT_CASH_FIELDS = ['date','currency','decimals','unitSourceIds','unitNote','usdValue',
  'valuationSourceIds','valuationNote','category','tranche','allocations'];
const settlementRecordId = (value,prefix) => {
  need(typeof value==='string'&&/^[a-z][a-z0-9-]{1,99}$/.test(value)&&value.startsWith(prefix+'-'),
    'GRANT_INVALID_INPUT','Use the original retained '+prefix+' identity.');return value;
};
const SETTLEMENT_UNIT_FIELDS = ['currency','decimals','unitSourceIds','unitNote'];
const SETTLEMENT_CORRECTION_FIELDS = ['reviewId','rowId','expectedCashId','decision','reason','cashId','cash','deploymentIds','workIds'];
function settlementIds(value,prefix) {
  need(Array.isArray(value)&&new Set(value).size===value.length,'GRANT_INVALID_INPUT','Use distinct original '+prefix+' IDs.');
  for(const selected of value)settlementRecordId(selected,prefix);
}
function settlementCash(value,unitsOnly=false) {
  exact(value,unitsOnly?SETTLEMENT_UNIT_FIELDS:SETTLEMENT_CASH_FIELDS,
    [...SETTLEMENT_UNIT_FIELDS,...(unitsOnly?[]:['date'])]);
  text(value.currency,'Original cash currency',40);integer(value.decimals,'Original asset decimals',0,12);
  settlementIds(value.unitSourceIds,'source');text(value.unitNote,'Original unit source',4000);
  if(unitsOnly)return;
  completionDate(value.date);
  if(value.usdValue!==undefined&&value.usdValue!==null) {
    text(value.usdValue,'Exact USD valuation',80);text(value.valuationNote,'Original valuation explanation',4000);
  }
  if(value.category!==undefined)need(['INVOICE','CUSTOMER','REFUND','OTHER'].includes(value.category),'GRANT_INVALID_INPUT','Use the original merchant cash category.');
  if(value.valuationSourceIds!==undefined)settlementIds(value.valuationSourceIds,'source');
  if(value.valuationNote!==undefined)text(value.valuationNote,'Original valuation explanation',4000,true);
  if(value.tranche!==undefined&&value.tranche!==null)integer(value.tranche,'Tranche attribution',0,3);
  if(value.allocations!==undefined) {
    need(Array.isArray(value.allocations),'GRANT_INVALID_INPUT','Cash allocations must be an array.');
    for(const allocation of value.allocations) {
      exact(allocation,['invoiceId','amountUsd'],['invoiceId','amountUsd']);
      settlementRecordId(allocation.invoiceId,'invoice');text(allocation.amountUsd,'Exact allocated USD',80);
    }
  }
}
function settlementReview(value) {
  exact(value,['name','selections'],['name','selections']);text(value.name,'Settlement review name',300);
  need(Array.isArray(value.selections)&&value.selections.length<=5000,'GRANT_INVALID_INPUT','Select original settlement rows.');
  for(const row of value.selections) {
    exact(row,['rowId','decision','reason','cashId','cash','deploymentIds','workIds'],['rowId','decision','reason','deploymentIds','workIds']);
    text(row.rowId,'Original settlement row',300);text(row.reason,'Settlement decision reason',4000);
    need(['RECORD_CASH','LINK_CASH','OBSERVE','OMIT'].includes(row.decision),'GRANT_INVALID_INPUT','Choose an original settlement receiving decision.');
    settlementIds(row.deploymentIds,'deployment');settlementIds(row.workIds,'work');
    if(row.decision==='RECORD_CASH'||row.decision==='LINK_CASH')settlementCash(row.cash,row.decision==='LINK_CASH');
    if(row.decision==='LINK_CASH')settlementRecordId(row.cashId,'cash');
  }
}
function settlementCorrection(value) {
  exact(value,SETTLEMENT_CORRECTION_FIELDS,['reviewId','rowId','expectedCashId','decision','reason']);
  id(value.reviewId,'settlement');text(value.rowId,'Original settlement row',300);
  if(value.expectedCashId!==null)settlementRecordId(value.expectedCashId,'cash');
  need(['CORRECT_CASH','LINK_CASH','VOID_CASH','RELINK'].includes(value.decision),'GRANT_INVALID_INPUT','Choose an original settlement correction.');
  text(value.reason,'Original correction reason',4000);
  if(value.cash!==undefined)settlementCash(value.cash,value.decision==='LINK_CASH');
  if(value.decision==='CORRECT_CASH')need(value.cash!==undefined,'GRANT_INVALID_INPUT','Supply the complete reviewed replacement cash fields.');
  if(value.decision==='LINK_CASH'){settlementRecordId(value.cashId,'cash');need(value.cash!==undefined,'GRANT_INVALID_INPUT','Supply the original unit fields for the selected existing cash.');}
  else need(value.cashId===undefined,'GRANT_INVALID_INPUT','An existing cash selection belongs to the link correction.');
  if(value.deploymentIds!==undefined)settlementIds(value.deploymentIds,'deployment');
  if(value.workIds!==undefined)settlementIds(value.workIds,'work');
}
function settlementArchive(bytes,filename) {
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=GRANT_MAX_SOURCE_BYTES,'GRANT_INVALID_INPUT','Use the complete original accounting archive within the native source limit.');
  text(filename,'Original accounting archive filename',240);
  need(!/[\x00-\x1f\x7f\\/]/.test(filename)&&!['.','..'].includes(filename),'GRANT_INVALID_INPUT','Use the original plain archive filename.');
  return {filename,contentBase64:bytes.toString('base64')};
}

export class GrantWorkspaceClient {
  #binding; #child = null; #connection = null; #opening = null; #closing = false; #close;
  #detaching = false; #detach = null; #pending = new Set();
  constructor(binding) { this.#binding = binding; }
  get summary() { return {schema:GRANT_AGENT_SCHEMA, label:this.#binding.label,
    selectionSha256:this.#binding.selectionSha256, allowStart:this.#binding.allowStart,
    connection:this.#connection ? this.#child ? 'OWNED_ORIGINAL_SERVICE' : 'BORROWED_ORIGINAL_SERVICE' : 'CLOSED',
    instanceId:this.#connection?.original.instanceId ?? null, activeRequests:this.#pending.size}; }
  async #readLaunch() {
    const input = this.#binding;
    const record = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(
      await readGrantAgentFile(join(input.directory, 'managed-launch.json'), GRANT_MAX_LAUNCH_BYTES, true)));
    need(record.schema === GRANT_LAUNCH_SCHEMA && record.state === 'LISTENING', 'GRANT_APPLICATION_NOT_RUNNING',
      'Start or recover the original Grant planning and delivery application, then open this alias.');
    need(record.selectionSha256 === input.selectionSha256, 'GRANT_SELECTION_CHANGED',
      'The original application uses another reviewed source or workspace selection. Reconcile its host connection.');
    const result = await readGrantWorkspaceLaunch({workspaceDirectory:input.directory,
      scenarioFile:input.scenarioFile, pythonExecutable:input.pythonExecutable,
      selectionSha256:input.selectionSha256, executionSourceDirectory:record.execution?.sourceDirectory,
      pid:record.pid, instanceId:record.instanceId, port:0, announcement:publicOriginal(record)});
    this.#connection = result; return result;
  }
  async #admit(task) {
    need(!this.#closing && !this.#detaching, 'GRANT_CLOSING',
      'This grant client is draining its original connection. Finish or retry that close before reopening.');
    const pending = Promise.resolve().then(task);
    this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  inspect() {
    return this.#admit(async () => {
      try {
        const connection = await this.#readLaunch();
        return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original};
      } catch (failure) {
        if (['ENOENT', 'GRANT_APPLICATION_NOT_RUNNING', 'GRANT_STARTUP_UNAVAILABLE', 'ECONNREFUSED'].includes(failure.code))
          return {...this.summary, connection:'ORIGINAL_SERVICE_UNAVAILABLE', reason:failure.code,
            recovery:this.#binding.allowStart ? 'Use open to start the original reviewed service.' : 'Start the original managed application, then open this alias.'};
        throw failure;
      }
    });
  }
  async open({expectedSelectionSha256} = {}) {
    need(!this.#closing && !this.#detaching, 'GRANT_CLOSING',
      'This grant client is draining its original connection. Finish or retry that close before reopening.');
    if (expectedSelectionSha256 !== undefined) need(sha(expectedSelectionSha256) === this.#binding.selectionSha256,
      'GRANT_SELECTION_CHANGED', 'Use the current host-reviewed workspace selection.');
    if (this.#opening) return this.#opening;
    this.#opening = (async () => {
      try { const existing = await this.#readLaunch(); return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:existing.original}; }
      catch (failure) {
        if (!['ENOENT', 'GRANT_APPLICATION_NOT_RUNNING', 'GRANT_STARTUP_UNAVAILABLE', 'ECONNREFUSED'].includes(failure.code)) throw failure;
        need(this.#binding.allowStart, 'GRANT_START_NOT_AUTHORIZED',
          'This alias borrows the existing application. Start it through its original Applications operation.');
      }
      need(!this.#child, 'GRANT_ORIGINAL_PROCESS_ACTIVE', 'Recover the current original grant child before opening another.');
      const binding = this.#binding;
      await mkdir(binding.directory, {mode:0o700, recursive:false}).catch(failure => { if (failure.code !== 'EEXIST') throw failure; });
      const selected = await inspectGrantWorkspaceSelection({workspaceDirectory:binding.directory,
        scenarioFile:binding.scenarioFile, pythonExecutable:binding.pythonExecutable});
      need(selected.selectionSha256 === binding.selectionSha256, 'GRANT_SELECTION_CHANGED', 'The reviewed original launch selection changed.');
      const child = spawn(process.execPath, [join(HERE, 'launcher.mjs'), '--python', binding.pythonExecutable,
        'serve', '--workspace', binding.directory, '--scenario', binding.scenarioFile, '--port', '0',
        '--source-directory', selected.selection.sourceDirectory, '--startup-format', 'managed',
        '--expected-selection-sha256', binding.selectionSha256],
      {stdio:['ignore', 'pipe', 'pipe'], windowsHide:true, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
      const owned = ownGrantLauncher(child); this.#child = owned;
      let lineBuffer = '';
      try {
        await new Promise((ready, reject) => {
          let settled = false;
          const finish = (failure, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            owned.startup = null; owned.startupData = null;
            failure ? reject(failure) : ready(value);
          };
          const timer = setTimeout(() => finish(error('GRANT_START_TIMEOUT',
            'The original service did not announce its listener.')), 30000);
          owned.startup = finish;
          owned.startupData = chunk => {
            lineBuffer += chunk.toString('utf8');
            if (Buffer.byteLength(lineBuffer) > GRANT_MAX_LAUNCH_BYTES)
              return finish(error('GRANT_START_OUTPUT_INVALID', 'The original startup output exceeded its bound.'));
            let cut;
            while ((cut = lineBuffer.indexOf('\n')) >= 0) {
              const line = lineBuffer.slice(0, cut); lineBuffer = lineBuffer.slice(cut + 1);
              try {
                const value = JSON.parse(line);
                if (value.schema === GRANT_LAUNCH_SCHEMA && value.state === 'LISTENING') finish(null, value);
              } catch {}
            }
          };
          owned.done.then(result => finish(error('GRANT_START_FAILED',
            'The original grant launcher closed before startup.', {
              exitCode:result.code, signal:result.signal, originalCode:result.error,
              diagnostics:result.diagnostics})));
          if (owned.firstError) finish(owned.firstError);
        });
        if (owned.firstError) throw owned.firstError;
        need(!owned.closed && child.exitCode === null && child.signalCode === null,
          'GRANT_START_FAILED', 'The original grant launcher stopped during startup.');
        const connection = await this.#readLaunch();
        owned.instanceId = connection.original.instanceId;
        if (owned.firstError) throw owned.firstError;
        need(!owned.closed && child.exitCode === null && child.signalCode === null,
          'GRANT_START_FAILED', 'The original grant launcher stopped while its listener was verified.');
        return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original};
      } catch (failure) {
        try {
          owned.stop();
          await owned.done;
          if (this.#child === owned) this.#child = null;
          if (owned.instanceId && this.#connection?.original.instanceId === owned.instanceId) this.#connection = null;
        } catch (cleanupFailure) {
          // The same child remains owned for detach/close retry. Never replace the
          // original startup or output failure with a secondary stop failure.
          owned.stopError ??= cleanupFailure;
          throw failure;
        }
        if (owned.firstError) throw failure;
        // A concurrently opened original application is authoritative. Read its
        // real launch only after our own original child and pipes have closed.
        try {
          const connection = await this.#readLaunch();
          return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original};
        } catch { throw failure; }
      }
    })();
    try { return await this.#opening; } finally { this.#opening = null; }
  }
  browser() {
    return this.#admit(async () => {
      const connection = await this.#readLaunch();
      return {schema:GRANT_AGENT_SCHEMA, url:connection.url, original:connection.original};
    });
  }
  #request(route, options) {
    return this.#admit(async () => transport(await this.#readLaunch(), route, options));
  }
  read(view, args = {}) {
    const pid = () => id(args.planId, 'plan'), cid = () => id(args.caseId, 'operation');
    const routes = {
      plans:() => '/api/plans',
      plan:() => '/api/plans/' + pid() + (args.revision === undefined ? '' : '/revision/' + integer(args.revision, 'Plan revision', 1, 1000000)),
      'plan-history':() => '/api/plans/' + pid() + '/history',
      'plan-comparison':() => '/api/plans/' + pid() + '/comparison' + planComparisonQuery(args),
      cases:() => '/api/operations' + (args.planId === undefined ? '' : '?planId=' + pid()),
      case:() => '/api/operations/' + cid(),
      'case-report':() => '/api/operations/' + cid() + '/report',
      'operating-workflows':() => '/api/operations/' + cid() + '/operating-workflows?expectedVersion=' +
        integer(args.expectedVersion, 'Original case version'),
      'cost-funding':() => '/api/operations/' + cid() + '/cost-funding',
      'funding-edition':() => '/api/operations/' + cid() + '/cost-funding/edition' +
        (args.revision===undefined?'':'?revision='+integer(args.revision,'Funding edition',1,1000000)),
      'funding-request':() => '/api/operations/' + cid() + '/cost-funding/request?requestId=' + encodeURIComponent(requestId(args.requestId)),
      expenses:() => '/api/operations/' + cid() + '/expense-attribution',
      'task-outcomes':() => '/api/operations/' + cid() + '/task-outcomes',
      'task-outcome':() => '/api/operations/' + cid() + '/task-outcomes/' + id(args.comparisonId,'task-outcomes') +
        (args.revision === undefined ? '' : '?revision=' + integer(args.revision,'Task comparison revision',1,1000000)),
      'supplier-account':() => '/api/operations/' + cid() + '/supplier-account' + supplierAccountQuery(args),
      performance:() => '/api/operations/' + cid() + '/performance' + performanceQuery(args),
      'cash-account':() => '/api/operations/' + cid() + '/cash-account' + cashAccountQuery(args),
      'account-reconciliation':() => '/api/operations/' + cid() + '/account-reconciliation' + accountReconciliationQuery(args),
      'account-reconciliation-statement-inputs':() => '/api/operations/' + cid() + '/account-reconciliation-statements/' + id(args.sourceId,'source') + '/inputs',
      amendments:() => '/api/operations/' + cid() + '/amendments',
      amendment:() => '/api/operations/' + cid() + '/amendments/' + id(args.amendmentId, 'amendment') +
        (args.revision === undefined ? '' : '?revision=' + integer(args.revision, 'Amendment edition', 1, 300)),
      'ledger-intake':() => '/api/operations/' + cid() + '/ledger-intake',
      'ledger-intake-original':() => '/api/operations/' + cid() + '/ledger-intakes/' + id(args.sourceId, 'source'),
      'case-history':() => '/api/operations/' + cid() + '/history?after=' + integer(args.after ?? 0, 'History cursor', 0) +
        '&limit=' + integer(args.limit ?? 100, 'History page size', 1, 200),
      'work-intakes':() => '/api/operations/' + cid() + '/work-intakes',
      'work-intake':() => '/api/operations/' + cid() + '/work-intakes/' + id(args.intakeId, 'intake') +
        (args.revision === undefined ? '' : '?revision=' + integer(args.revision, 'Intake edition', 1, 10000000)),
      forecasts:() => '/api/operations/' + cid() + '/forecasts',
      'forecast-comparison':() => '/api/operations/' + cid() + '/forecast-comparison' + forecastComparisonQuery(args),
      forecast:() => '/api/operations/' + cid() + '/forecasts/' + id(args.forecastId, 'forecast'),
      portfolios:() => '/api/operations/' + cid() + '/portfolios',
      portfolio:() => '/api/operations/' + cid() + '/portfolios/' + id(args.portfolioId, 'portfolio'),
      risks:() => '/api/operations/' + cid() + '/risk-register',
      'risk-register':() => '/api/operations/' + cid() + '/risk-register/' + id(args.reviewId,'review'),
      'risk-comparison':() => '/api/operations/' + cid() + '/risk-register-comparison' + riskComparisonQuery(args),
      'risk-history':() => {
        need(typeof args.riskId === 'string' && /^[a-z][a-z0-9-]{1,99}$/.test(args.riskId),
          'GRANT_INVALID_INPUT','Use the original stable risk ID.');
        return '/api/operations/' + cid() + '/risk-register-history/' + args.riskId;
      },
      engagements:() => '/api/operations/' + cid() + '/engagements',
      engagement:() => '/api/operations/' + cid() + '/engagements/' + id(args.reviewId, 'review'),
      review:() => '/api/operations/' + cid() + '/reviews/' + id(args.reviewId, 'review'),
      settlements:() => '/api/operations/' + cid() + '/settlements',
      settlement:() => '/api/operations/' + cid() + '/settlements/' + id(args.reviewId,'settlement'),
      'delivery-queue':() => '/api/operations/' + cid() + '/delivery-queue' +
        (args.asOfDate === undefined ? '' : '?asOfDate=' + encodeURIComponent(completionDate(args.asOfDate))),
      'installation-returns':() => '/api/operations/' + cid() + '/installation-returns',
      installations:() => '/api/operations/' + cid() + '/installations',
      installation:() => '/api/operations/' + cid() + '/installations/' + id(args.installationId,'installation') +
        (args.revision === undefined ? '' : '?revision=' + integer(args.revision,'Installation edition',1,500)),
      'installation-history':() => '/api/operations/' + cid() + '/installations/' + id(args.installationId,'installation') +
        '/history?limit=' + integer(args.limit ?? 25,'Installation history page',1,100) +
        (args.before === undefined ? '' : '&before=' + integer(args.before,'Earlier installation edition',1,500)),
      'delivery-agenda':() => '/api/operations/delivery-agenda' + deliveryAgendaQuery(args),
      'delivery-calendar':() => '/api/operations/' + cid() + '/delivery-calendar' + deliveryCalendarQuery(args),
      completion:() => '/api/operations/' + cid() + '/completion' +
        (args.asOfDate === undefined ? '' : '?asOfDate=' + encodeURIComponent(completionDate(args.asOfDate))),
    };
    need(Object.hasOwn(routes, view), 'GRANT_INVALID_VIEW', 'Choose a declared native grant view.');
    return this.#request(routes[view](), {});
  }
  workbook(action, body) {
    need(['inspect','project'].includes(action),'GRANT_WORKBOOK_ACTION','Choose original workbook inspection or projection.');
    exact(body, action === 'inspect' ? ['source','preview','headerRow'] : ['source','mapping'],
      action === 'inspect' ? ['source'] : ['source','mapping']);
    object(body.source,'Original workbook source');
    if (body.preview !== undefined) object(body.preview,'Original worksheet selection');
    if (body.mapping !== undefined) object(body.mapping,'Original workbook mapping');
    return this.#request('/api/source-tables/workbook/' + action,{body,mutation:false});
  }
  installationSources(action, input = {}) {
    const plan = planInstallationSourceOperation(action, input);
    if (plan.operation?.workspaceDirectory !== undefined)
      need(plan.operation.workspaceDirectory === this.#binding.directory, 'GRANT_INSTALLATION_SOURCE_CHANGED',
        'This saved operation belongs to another original workspace directory.');
    return this.#admit(() => performInstallationSourceOperation(plan,
      async (route, options) => transport(await this.#readLaunch(), route, options)));
  }
  planningSources(action, body) {
    return this.#admit(() => performGrantPlanningSourceOperation(this,action,body));
  }
  plan(action, planId, body) {
    id(planId, 'plan');
    const common = ['expectedRevision', 'scenarioPatch', 'planning'];
    const fields = {estimate:common, save:[...common, 'note', 'requestId'],
      restore:['expectedRevision', 'selectedRevision', 'note', 'requestId'], clone:['expectedRevision', 'name', 'requestId']};
    need(Object.hasOwn(fields, action), 'GRANT_INVALID_ACTION', 'Choose estimate, save, restore or clone.');
    exact(body, fields[action], action === 'estimate' ? ['expectedRevision'] : action === 'save'
      ? ['expectedRevision', 'note', 'requestId'] : fields[action]);
    integer(body.expectedRevision, 'Current plan revision', 1, 1000000);
    if (action !== 'estimate') requestId(body.requestId);
    return this.#request('/api/plans/' + planId + '/' + action,
      {body, originalRequestId:body.requestId, mutation:action !== 'estimate'});
  }
  createCase(body) {
    exact(body, ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'mode', 'calendarStart', 'actor', 'requestId'],
      ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'mode', 'actor', 'requestId']);
    id(body.planId, 'plan'); integer(body.selectedRevision, 'Selected revision', 1, 1000000);
    sha(body.expectedContentSha256); requestId(body.requestId);
    return this.#request('/api/operations', {body, originalRequestId:body.requestId});
  }
  command(caseId, body) {
    id(caseId, 'operation'); exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'action', 'data'],
      ['expectedVersion', 'requestId', 'actor', 'action', 'data']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    need(GRANT_CASE_ACTIONS.includes(body.action), 'GRANT_INVALID_ACTION', 'Choose the original case action.');
    object(body.data, 'Original action data');
    return this.#request('/api/operations/' + caseId + '/command', {body, originalRequestId:body.requestId});
  }
  operatingWorkflows(caseId, expectedVersion) {
    return this.read('operating-workflows', {caseId, expectedVersion});
  }
  accountReconciliationPreview(caseId, body) {
    id(caseId,'operation'); accountReconciliationInput(body);
    return this.#request('/api/operations/'+caseId+'/account-reconciliation-preview', {body,mutation:false});
  }
  accountReconciliationApply(caseId, body) {
    id(caseId,'operation'); accountReconciliationInput(body,true);
    return this.#request('/api/operations/'+caseId+'/account-reconciliation', {body,originalRequestId:body.requestId});
  }
  cashCorrectionPreview(caseId, body) {
    id(caseId, 'operation'); cashCorrectionInput(body);
    return this.#request('/api/operations/' + caseId + '/cash-correction-preview', {body, mutation:false});
  }
  cashCorrectionApply(caseId, body) {
    id(caseId, 'operation'); cashCorrectionInput(body, true);
    return this.#request('/api/operations/' + caseId + '/cash-correction', {body, originalRequestId:body.requestId});
  }
  ledgerIntakeInspect(caseId, file) {
    id(caseId, 'operation'); object(file, 'Original intake file');
    return this.#request('/api/operations/' + caseId + '/ledger-intake-inspect', {body:{file}, mutation:false});
  }
  ledgerIntakePreview(caseId, body) {
    id(caseId, 'operation'); exact(body, ['document', 'expectedVersion'], ['document']);
    object(body.document, 'Complete ledger intake');
    if (body.expectedVersion !== undefined) integer(body.expectedVersion, 'Current case version', 1, 10000000);
    return this.#request('/api/operations/' + caseId + '/ledger-intake-preview', {body, mutation:false});
  }
  ledgerIntakeApply(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['document', 'expectedVersion', 'expectedPreviewSha256', 'requestId', 'actor', 'note'],
      ['document', 'expectedVersion', 'expectedPreviewSha256', 'requestId', 'actor']);
    object(body.document, 'Complete ledger intake');
    integer(body.expectedVersion, 'Current case version', 1, 10000000);
    sha(body.expectedPreviewSha256); requestId(body.requestId);
    return this.#request('/api/operations/' + caseId + '/ledger-intake-apply', {body, originalRequestId:body.requestId});
  }
  statementInspect(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    exact(inputs, ['sourceFormat', 'source', 'statementOptions'], ['sourceFormat', 'source']);
    need(inputs.sourceFormat === 'OFX' || inputs.sourceFormat === 'MT940', 'GRANT_INVALID_INPUT',
      'Choose an original OFX / QFX or MT940 source format.'); object(inputs.source, 'Original bank source');
    return this.#request('/api/operations/' + caseId + '/statement-inspect', {body:{expectedVersion, inputs}, mutation:false});
  }
  statementPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Statement inputs');
    return this.#request('/api/operations/' + caseId + '/statement-preview', {body:{expectedVersion, inputs}, mutation:false});
  }
  statementReceive(caseId, body) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'inputs', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'inputs', 'expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.inputs, 'Statement inputs');
    const {inputs, expectedPreviewSha256, ...original} = body;
    return this.command(caseId, {...original, action:'statement.receive', data:{inputs, expectedPreviewSha256}});
  }
  statementSetupSave(caseId, body) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'id', 'expectedRevision', 'name', 'status', 'inputs'],
      ['expectedVersion', 'requestId', 'actor', 'note', 'expectedRevision', 'name']);
    const {expectedVersion, requestId, actor, note, ...data} = body;
    text(actor, 'Recording operator', 300); text(note, 'Statement setup reason', 12000);
    text(data.name, 'Statement setup name', 160);
    integer(data.expectedRevision, 'Current statement setup edition', 0);
    if (data.id !== undefined) {
      id(data.id, 'statement-setup');
      need(data.expectedRevision > 0, 'GRANT_INVALID_INPUT', 'Use the selected setup revision.');
    } else {
      need(data.expectedRevision === 0, 'GRANT_INVALID_INPUT', 'A new setup starts with revision zero.');
    }
    const status = data.status ?? 'ACTIVE';
    need(status === 'ACTIVE' || status === 'ARCHIVED', 'GRANT_INVALID_INPUT',
      'Choose an active or archived statement setup.');
    if (status === 'ARCHIVED') {
      need(data.id !== undefined && data.inputs === undefined, 'GRANT_INVALID_INPUT',
        'Archive the existing setup without replacing its saved settings.');
    } else {
      object(data.inputs, 'Original statement file and current mapping');
    }
    return this.command(caseId, {expectedVersion, requestId, actor, note,
      action:'statement-setup.save', data});
  }

  workIntakePreview(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'intakeId', 'revision', 'document'], ['expectedVersion', 'intakeId']);
    integer(body.expectedVersion, 'Current case version'); id(body.intakeId, 'intake');
    if (body.revision !== undefined) integer(body.revision, 'Saved intake edition', 1, 10000000);
    if (body.document !== undefined) object(body.document, 'Complete intake document');
    return this.#request('/api/operations/' + caseId + '/work-intake-preview', {body, mutation:false});
  }
  workIntakeUpload(caseId, body) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'name', 'kind', 'sourceId', 'file', 'format'],
      ['expectedVersion', 'requestId', 'actor', 'name', 'kind']);
    const {expectedVersion, requestId, actor, note, ...data} = body;
    need((data.sourceId !== undefined) !== (data.file !== undefined), 'GRANT_INVALID_INPUT',
      'Select one original case source or supply the original file.');
    return this.command(caseId, {expectedVersion, requestId, actor, ...(note === undefined ? {} : {note}),
      action:'work-intake.upload', data});
  }
  workIntakeSave(caseId, body) { return this.#workIntakeWrite(caseId, body, 'save'); }
  workIntakeApply(caseId, body) { return this.#workIntakeWrite(caseId, body, 'apply'); }
  #workIntakeWrite(caseId, body, action) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'intakeId', 'expectedRevision', 'document', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'intakeId', 'expectedRevision', ...(action === 'apply' ? ['expectedPreviewSha256'] : [])]);
    const {expectedVersion, requestId, actor, note, ...data} = body;
    id(data.intakeId, 'intake'); integer(data.expectedRevision, 'Saved intake edition', 1, 10000000);
    if (data.document !== undefined) object(data.document, 'Complete intake document');
    if (data.expectedPreviewSha256 !== undefined) sha(data.expectedPreviewSha256);
    return this.command(caseId, {expectedVersion, requestId, actor, ...(note === undefined ? {} : {note}),
      action:'work-intake.' + action, data});
  }
  amendmentPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Amendment inputs');
    return this.#request('/api/operations/' + caseId + '/amendment-preview',
      {body:{expectedVersion, inputs}, mutation:false});
  }
  engagementSeed(caseId, expectedVersion, reviewId) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    if (reviewId !== undefined) id(reviewId, 'review');
    return this.#request('/api/operations/' + caseId + '/engagement-seed',
      {body:{expectedVersion, ...(reviewId === undefined ? {} : {reviewId})}, mutation:false});
  }
  engagementPreview(caseId, expectedVersion, document) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    object(document, 'Complete Contributor Engagements document');
    return this.#request('/api/operations/' + caseId + '/engagement-preview',
      {body:{expectedVersion, document}, mutation:false});
  }
  engagementPrepare(caseId, body) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'document', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'note', 'document', 'expectedPreviewSha256']);
    text(body.actor, 'Recording operator', 300); text(body.note, 'Recorded engagement review note', 12000);
    object(body.document, 'Complete Contributor Engagements document'); sha(body.expectedPreviewSha256);
    const {document, expectedPreviewSha256, ...original} = body;
    return this.command(caseId, {...original, action:'engagement.prepare',
      data:{document, expectedPreviewSha256}});
  }
  engagementForecast(caseId, expectedVersion, selection) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    object(selection, 'Complete engagement to Forecast selection');
    return this.#request('/api/operations/' + caseId + '/engagement-forecast',
      {body:{expectedVersion, selection}, mutation:false});
  }
  engagementPortfolio(caseId, expectedVersion, selection) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    object(selection, 'Complete engagement to Portfolio selection');
    return this.#request('/api/operations/' + caseId + '/engagement-portfolio',
      {body:{expectedVersion, selection}, mutation:false});
  }
  engagementReceiving(caseId, body) {
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'reviewId', 'reviewSha256',
      'forecastId', 'portfolioId', 'forecastSelection', 'portfolioSelection'],
    ['expectedVersion', 'requestId', 'actor', 'note', 'reviewId', 'reviewSha256',
      'forecastId', 'portfolioId', 'forecastSelection', 'portfolioSelection']);
    text(body.actor, 'Recording operator', 300); text(body.note, 'Recorded engagement receiving note', 12000);
    id(body.reviewId, 'review'); sha(body.reviewSha256);
    id(body.forecastId, 'forecast'); id(body.portfolioId, 'portfolio');
    object(body.forecastSelection, 'Original normalized engagement to Forecast selection');
    object(body.portfolioSelection, 'Original normalized engagement to Portfolio selection');
    const {reviewId, reviewSha256, forecastId, portfolioId, forecastSelection, portfolioSelection, ...original} = body;
    return this.command(caseId, {...original, action:'engagement.receiving',
      data:{reviewId, reviewSha256, forecastId, portfolioId, forecastSelection, portfolioSelection}});
  }
  amendmentCalendarExport(caseId, selection) {
    id(caseId, 'operation'); object(selection, 'Amendment calendar selection');
    if (Object.hasOwn(selection, 'amendmentId')) {
      exact(selection, ['amendmentId','revision','expectedAmendmentSha256','expectedImpactSha256']);
      id(selection.amendmentId, 'amendment'); integer(selection.revision, 'Selected amendment edition', 1, 300);
      sha(selection.expectedAmendmentSha256);
    } else {
      exact(selection, ['expectedVersion','inputs','expectedPreviewSha256','expectedImpactSha256']);
      integer(selection.expectedVersion, 'Reviewed case version'); object(selection.inputs, 'Amendment inputs');
      sha(selection.expectedPreviewSha256);
    }
    sha(selection.expectedImpactSha256);
    return this.#request('/api/operations/' + caseId + '/amendment-calendar-export',
      {body:selection, mutation:false});
  }
  forecastPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Forecast inputs');
    return this.#request('/api/operations/' + caseId + '/forecast-preview', {body:{expectedVersion, inputs}, mutation:false});
  }
  forecastSave(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'inputs', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'inputs', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId); sha(body.expectedPreviewSha256);
    const {inputs, expectedPreviewSha256, ...original} = body; object(inputs, 'Forecast inputs');
    return this.#request('/api/operations/' + caseId + '/command',
      {body:{...original, action:'forecast.save', data:{inputs, expectedPreviewSha256}}, originalRequestId:body.requestId});
  }
  portfolioSeed(caseId, expectedVersion, forecastId, options = {}) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); id(forecastId, 'forecast');
    exact(options, ['installationSelections', 'inputs']);
    if (Object.hasOwn(options, 'installationSelections')) {
      need(Array.isArray(options.installationSelections) && options.installationSelections.length <= 100,
        'GRANT_INVALID_INPUT', 'Select at most 100 original Installation editions.');
      for (const selected of options.installationSelections) {
        exact(selected, ['taskId', 'installationId', 'installationRevision', 'installationSha256'],
          ['taskId', 'installationId', 'installationRevision', 'installationSha256']);
        text(selected.taskId, 'Original Portfolio task ID', 150);
        id(selected.installationId, 'installation');
        integer(selected.installationRevision, 'Saved installation edition', 1, 500);
        sha(selected.installationSha256);
      }
    }
    if (Object.hasOwn(options, 'inputs')) object(options.inputs, 'Complete Portfolio draft');
    return this.#request('/api/operations/' + caseId + '/portfolio-seed',
      {body:{expectedVersion, forecastId, ...options}, mutation:false});
  }
  portfolioPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Portfolio inputs');
    return this.#request('/api/operations/' + caseId + '/portfolio-preview',
      {body:{expectedVersion, inputs}, mutation:false});
  }
  portfolioSave(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'inputs', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'inputs', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId); sha(body.expectedPreviewSha256);
    const {inputs, expectedPreviewSha256, ...original} = body; object(inputs, 'Portfolio inputs');
    return this.#request('/api/operations/' + caseId + '/command',
      {body:{...original, action:'portfolio.save', data:{inputs, expectedPreviewSha256}}, originalRequestId:body.requestId});
  }
  portfolioSelection(caseId, expectedVersion, portfolioId, alternativeId) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); id(portfolioId, 'portfolio');
    need(typeof alternativeId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(alternativeId),
      'GRANT_INVALID_INPUT', 'Use the original saved alternative ID, including base for the base allocation.');
    return this.#request('/api/operations/' + caseId + '/portfolio-selection',
      {body:{expectedVersion, portfolioId, alternativeId}, mutation:false});
  }
  fundingSeed(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','revision'],['expectedVersion']);
    integer(body.expectedVersion,'Current case version');
    if(body.revision!==undefined)integer(body.revision,'Selected funding edition',1,1000000);
    return this.#request('/api/operations/'+caseId+'/funding-seed',{body,mutation:false});
  }
  fundingPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','inputs'],['expectedVersion','inputs']);
    integer(body.expectedVersion,'Current case version'); object(body.inputs,'Complete funding inputs');
    return this.#request('/api/operations/'+caseId+'/funding-preview',{body,mutation:false});
  }
  async fundingSave(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256','acceptedResult'],
      ['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.inputs,'Complete funding inputs'); requestId(body.requestId);
    const {inputs,expectedPreviewSha256,acceptedResult,...original}=body;
    const command={...original,action:'funding.save',data:{inputs,expectedPreviewSha256}};
    const ordered=value=>Array.isArray(value)?value.map(ordered):plain(value)
      ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
    const canonical=value=>JSON.stringify(ordered(value));
    const fingerprint=digest(Buffer.from(canonical({domain:'stellar-forge.sf47-operations.v1',programId:caseId,body:command})));
    const read=await this.read('funding-request',{caseId,requestId:body.requestId}), native=read.value;
    need(native?.caseId===caseId&&native.requestId===body.requestId&&typeof native.found==='boolean',
      'GRANT_FUNDING_REQUEST_CHANGED','The original funding request journal changed.');
    if(native.found) {
      need(native.fingerprint===fingerprint&&native.resultSha256===digest(Buffer.from(canonical(native.result))),
        'GRANT_FUNDING_REQUEST_CHANGED','The original request identifies another complete funding input.');
      if(acceptedResult!==undefined)need(canonical(native.result)===canonical(acceptedResult),
        'GRANT_FUNDING_ACCEPTANCE_CHANGED','The retained accepted response differs from the original commitment.');
    }else need(acceptedResult===undefined,'GRANT_FUNDING_COMMITMENT_MISSING',
      'The restored workspace lacks this accepted original funding save. Restore matching state before continuing.');
    // The unchanged native command recovers its original result before its case CAS.
    return this.command(caseId,command);
  }
  riskSeed(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','reviewId'],['expectedVersion']);
    integer(body.expectedVersion,'Current case version');
    if(body.reviewId!==undefined)id(body.reviewId,'review');
    return this.#request('/api/operations/'+caseId+'/risk-register-seed',{body,mutation:false});
  }
  riskPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','document'],['expectedVersion','document']);
    integer(body.expectedVersion,'Current case version'); object(body.document,'Complete delivery risk register');
    return this.#request('/api/operations/'+caseId+'/risk-register-preview',{body,mutation:false});
  }
  riskSave(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','document','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','note','document','expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.document,'Complete delivery risk register');
    text(body.note,'Delivery risk review note',12000);
    const {document,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'risk-register.save',data:{document,expectedPreviewSha256}});
  }
  riskRequest(caseId, body) {
    id(caseId,'operation'); exact(body,['command'],['command']);
    const command=body.command;
    exact(command,['expectedVersion','requestId','actor','note','action','data'],
      ['expectedVersion','requestId','actor','note','action','data']);
    need(command.action==='risk-register.save','GRANT_INVALID_INPUT','Use the complete original risk-register.save command.');
    integer(command.expectedVersion,'Original reviewed case version'); requestId(command.requestId);
    text(command.actor,'Original recorded operator',300); text(command.note,'Original delivery risk review note',12000);
    exact(command.data,['document','expectedPreviewSha256'],['document','expectedPreviewSha256']);
    object(command.data.document,'Complete original delivery risk register'); sha(command.data.expectedPreviewSha256);
    return this.#request('/api/operations/'+caseId+'/risk-register-request',{body,mutation:false});
  }
  taskOutcomesSeed(caseId, expectedVersion) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version');
    return this.#request('/api/operations/'+caseId+'/task-outcomes-seed',{body:{expectedVersion},mutation:false});
  }
  taskOutcomesPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','inputs'],['expectedVersion','inputs']);
    integer(body.expectedVersion,'Current case version'); object(body.inputs,'Complete customer task comparison inputs');
    return this.#request('/api/operations/'+caseId+'/task-outcomes-preview',{body,mutation:false});
  }
  taskOutcomesSave(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','inputs','expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.inputs,'Complete customer task comparison inputs');
    const {inputs,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'task-outcomes.save',data:{inputs,expectedPreviewSha256}});
  }
  installationReturnSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','installationId','revision','sha256'],['expectedVersion','installationId','revision','sha256']);
    integer(body.expectedVersion,'Current case version'); id(body.installationId,'installation');
    integer(body.revision,'Original Installation edition',1,500); sha(body.sha256);
    return this.#request('/api/operations/'+caseId+'/installation-return-seed',{body,mutation:false});
  }
  installationReturnPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','inputs'],['expectedVersion','inputs']);
    integer(body.expectedVersion,'Current receiving case version'); object(body.inputs,'Complete receiving observations');
    return this.#request('/api/operations/'+caseId+'/installation-return-preview',{body,mutation:false});
  }
  installationReturnReviewSeed(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','retainedReview'],['expectedVersion','retainedReview']);
    integer(body.expectedVersion,'Current owner case version');
    exact(body.retainedReview,['id','sha256'],['id','sha256']);
    id(body.retainedReview.id,'review'); sha(body.retainedReview.sha256);
    return this.#request('/api/operations/'+caseId+'/installation-return-review-seed',{body,mutation:false});
  }
  installationReturnReviewPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','inputs'],['expectedVersion','inputs']);
    integer(body.expectedVersion,'Current owner case version'); object(body.inputs,'Complete explicit owner decisions');
    return this.#request('/api/operations/'+caseId+'/installation-return-review-preview',{body,mutation:false});
  }
  installationReturn(caseId, body) {
    exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.inputs,'Complete receiving observations');
    text(body.note,'Receiving save reason',12000);
    const {inputs,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'installation.return',data:{inputs,expectedPreviewSha256}});
  }
  installationReturnStage(caseId, body) {
    exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256']);
    sha(body.expectedPreviewSha256); object(body.inputs,'Complete explicit owner decisions');
    text(body.note,'Owner receiving reason',12000);
    const {inputs,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'installation.return-stage',data:{inputs,expectedPreviewSha256}});
  }
  customerUseCalendar(caseId, body) {
    id(caseId,'operation');exact(body,['expectedVersion','installationRefs','asOfDate'],['expectedVersion']);
    integer(body.expectedVersion,'Current case version');
    if(body.installationRefs!==undefined)customerUseRefs(body.installationRefs);
    if(body.asOfDate!==undefined)completionDate(body.asOfDate);
    return this.#request('/api/operations/'+caseId+'/customer-use-calendar',{body,mutation:false});
  }
  customerUseCalendarExpand(caseId, body) {
    id(caseId,'operation');exact(body,['expectedVersion','document','pattern'],['expectedVersion','document','pattern']);
    integer(body.expectedVersion,'Current case version');object(body.document,'Complete Installation document');
    exact(body.pattern,['id','taskIds','buyerDeploymentIds','weekdays','includeDates','excludeDates','mode','fundingByBuyer','replacePattern'],
      ['id','taskIds','buyerDeploymentIds']);
    return this.#request('/api/operations/'+caseId+'/customer-use-calendar-expand',{body,mutation:false});
  }
  customerUseCalendarCohort(caseId, body) {
    id(caseId,'operation');exact(body,['expectedVersion','installationRefs','groupId','asOfAt'],['expectedVersion','groupId']);
    integer(body.expectedVersion,'Current case version');text(body.groupId,'Selected customer-use window',100);
    if(body.installationRefs!==undefined)customerUseRefs(body.installationRefs);
    if(body.asOfAt!==undefined)text(body.asOfAt,'Original receipt observation cutoff',100);
    return this.#request('/api/operations/'+caseId+'/customer-use-calendar-cohort',{body,mutation:false});
  }
  installationSeed(caseId, expectedVersion) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version');
    return this.#request('/api/operations/'+caseId+'/installation-seed',
      {body:{expectedVersion},mutation:false});
  }
  installationCommercial(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','sourceId','expectedSourceSha256'],['expectedVersion','sourceId','expectedSourceSha256']);
    integer(body.expectedVersion,'Current case version');id(body.sourceId,'source');sha(body.expectedSourceSha256);
    return this.#request('/api/operations/'+caseId+'/installation-commercial',{body,mutation:false});
  }
  installationCommercialSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','sourceId','expectedSourceSha256','quoteId','quoteSha256',
      'acceptanceId','acceptanceSha256','installationId','expectedRevision','document','resolutions'],
      ['expectedVersion','sourceId','expectedSourceSha256','quoteId','quoteSha256',
       'acceptanceId','acceptanceSha256','installationId','expectedRevision']);
    integer(body.expectedVersion,'Current case version');id(body.sourceId,'source');sha(body.expectedSourceSha256);
    for(const key of ['quoteId','acceptanceId'])need(typeof body[key]==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body[key]),
      'GRANT_INVALID_INPUT','Select the original quotation and customer-response UUIDs.');
    sha(body.quoteSha256);sha(body.acceptanceSha256);
    integer(body.expectedRevision,'Current Installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select the current Installation edition, or zero for a new Installation.');
    if(Object.hasOwn(body,'document'))object(body.document,'Complete editable Installation document');
    if(Object.hasOwn(body,'resolutions')){
      object(body.resolutions,'Reviewed accepted-scope field choices');
      const fields=['name','task.name','task.purpose','task.request','task.completeOutput','source.reference',
        'source.authority','source.changePolicy','receiving.acceptanceRule','assignments.commercialRef'];
      need(Object.entries(body.resolutions).every(([key,value])=>fields.includes(key)&&['accepted','current'].includes(value)),
        'GRANT_INVALID_INPUT','Keep the current or accepted value for each original conflicting field.');
    }
    return this.#request('/api/operations/'+caseId+'/installation-commercial-seed',{body,mutation:false});
  }
  installationWorkshares(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion',...WORKSHARE_SOURCE_FIELDS],['expectedVersion','sourceId','expectedSourceSha256']);
    integer(body.expectedVersion,'Current case version'); workshareSources(body);
    return this.#request('/api/operations/'+caseId+'/installation-workshares',{body,mutation:false});
  }
  installationWorkshareSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion',...WORKSHARE_SOURCE_FIELDS,'workshareCaseId','installationId','expectedRevision','document'],
      ['expectedVersion','sourceId','expectedSourceSha256','workshareCaseId','installationId','expectedRevision']);
    integer(body.expectedVersion,'Current case version'); workshareSources(body);
    text(body.workshareCaseId,'Original Workshare case',500);
    integer(body.expectedRevision,'Current installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select edition zero for a new installation or the original current installation edition.');
    if(Object.hasOwn(body,'document'))object(body.document,'Complete editable installation document');
    return this.#request('/api/operations/'+caseId+'/installation-workshare-seed',{body,mutation:false});
  }
  installationWorkflows(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','sourceId','expectedSourceSha256'],['expectedVersion','sourceId','expectedSourceSha256']);
    integer(body.expectedVersion,'Current case version'); id(body.sourceId,'source'); sha(body.expectedSourceSha256);
    return this.#request('/api/operations/'+caseId+'/installation-workflows',{body,mutation:false});
  }
  installationWorkflowSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','sourceId','expectedSourceSha256','cycleIds','installationId','expectedRevision','document'],
      ['expectedVersion','sourceId','expectedSourceSha256','cycleIds','installationId','expectedRevision']);
    integer(body.expectedVersion,'Current case version'); id(body.sourceId,'source'); sha(body.expectedSourceSha256);
    integer(body.expectedRevision,'Current installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select the current Installation edition, or zero for a new Installation.');
    need(Array.isArray(body.cycleIds)&&body.cycleIds.length>0&&body.cycleIds.length<=100&&
      body.cycleIds.every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))&&
      new Set(body.cycleIds).size===body.cycleIds.length,
      'GRANT_INVALID_INPUT','Select each original customer cycle once.');
    if(Object.hasOwn(body,'document'))object(body.document,'Complete editable installation document');
    return this.#request('/api/operations/'+caseId+'/installation-workflow-seed',{body,mutation:false});
  }
  installationCommissioningSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','installationId','expectedRevision','document'],
      ['expectedVersion','installationId','expectedRevision','document']);
    integer(body.expectedVersion,'Current case version');integer(body.expectedRevision,'Current Installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select the current Installation edition, or zero for a new Installation.');
    object(body.document,'Complete original Installation draft');
    return this.#request('/api/operations/'+caseId+'/installation-commissioning-seed',{body,mutation:false});
  }
  installationCommissioningReview(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','installationId','expectedRevision','document','reviews','actor','observedAt'],
      ['expectedVersion','installationId','expectedRevision','document','reviews','actor','observedAt']);
    integer(body.expectedVersion,'Current case version');integer(body.expectedRevision,'Current Installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select the current Installation edition, or zero for a new Installation.');
    object(body.document,'Complete original Installation draft');text(body.actor,'Recorded reviewing operator',500);
    text(body.observedAt,'Original review timestamp with timezone',100);
    need(Array.isArray(body.reviews)&&body.reviews.length>0&&body.reviews.length<=1001,
      'GRANT_INVALID_INPUT','Select one through 1001 explicit source-bound review rows.');
    for(const row of body.reviews){
      exact(row,['kind','id','state','expectedBasisSha256','note'],['kind','id','state','expectedBasisSha256','note']);
      need(['FUNDING','BUDGET','PLAN','OUTPUT'].includes(row.kind)&&['APPROVED','CHANGES_REQUIRED'].includes(row.state),
        'GRANT_INVALID_INPUT','Select the original commissioning review kind and decision.');
      sha(row.expectedBasisSha256);text(row.note,'Recorded decision reason',8000);
    }
    return this.#request('/api/operations/'+caseId+'/installation-commissioning-review',{body,mutation:false});
  }
  installationEffortSeed(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','installationId','expectedRevision','asOfDate','document'],
      ['expectedVersion','installationId','expectedRevision','asOfDate']);
    integer(body.expectedVersion,'Current case version');
    integer(body.expectedRevision,'Current installation edition',1,500);
    id(body.installationId,'installation');
    completionDate(body.asOfDate);
    if(Object.hasOwn(body,'document'))object(body.document,'Complete editable Installation document');
    return this.#request('/api/operations/'+caseId+'/installation-effort-seed',{body,mutation:false});
  }
  installationEffortSelection(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','forecastId','installationSelections','name','note'],
      ['expectedVersion','forecastId','installationSelections']);
    integer(body.expectedVersion,'Current case version'); id(body.forecastId,'forecast');
    need(Array.isArray(body.installationSelections)&&body.installationSelections.length>=1&&body.installationSelections.length<=100,
      'GRANT_INVALID_INPUT','Select one through 100 saved Installation editions.');
    for(const selected of body.installationSelections){
      exact(selected,['taskId','installationId','installationRevision','installationSha256'],
        ['taskId','installationId','installationRevision','installationSha256']);
      text(selected.taskId,'Original Portfolio task ID',150);
      id(selected.installationId,'installation');
      integer(selected.installationRevision,'Saved Installation edition',1,500);
      sha(selected.installationSha256);
    }
    if(Object.hasOwn(body,'name'))text(body.name,'Forecast name',300);
    if(Object.hasOwn(body,'note'))text(body.note,'Remaining-effort selection note',12000,true);
    return this.#request('/api/operations/'+caseId+'/installation-effort-selection',{body,mutation:false});
  }
  installationPreview(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','installationId','expectedRevision','document','returnReview'],
      ['expectedVersion','installationId','expectedRevision','document']);
    integer(body.expectedVersion,'Current case version'); integer(body.expectedRevision,'Current installation edition',0,500);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select edition zero for a new installation or the original current installation edition.');
    object(body.document,'Complete installation document');
    if(body.returnReview!==undefined){exact(body.returnReview,['id','sha256'],['id','sha256']);id(body.returnReview.id,'review');sha(body.returnReview.sha256);}
    return this.#request('/api/operations/'+caseId+'/installation-preview',{body,mutation:false});
  }
  installationSave(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','installationId','expectedRevision','document','expectedPreviewSha256','returnReview'],
      ['expectedVersion','requestId','actor','note','installationId','expectedRevision','document','expectedPreviewSha256']);
    integer(body.expectedVersion,'Current case version'); integer(body.expectedRevision,'Current installation edition',0,500);
    requestId(body.requestId); sha(body.expectedPreviewSha256);
    text(body.actor,'Actual installation operator',300); text(body.note,'Installation edition reason',12000);
    if(body.installationId!==null)id(body.installationId,'installation');
    need(body.installationId===null?body.expectedRevision===0:body.expectedRevision>=1,
      'GRANT_INVALID_INPUT','Select edition zero for a new installation or the original current installation edition.');
    object(body.document,'Complete installation document');
    if(body.returnReview!==undefined){exact(body.returnReview,['id','sha256'],['id','sha256']);id(body.returnReview.id,'review');sha(body.returnReview.sha256);}
    const {installationId,expectedRevision,document,expectedPreviewSha256,returnReview,...original}=body;
    return this.#request('/api/operations/'+caseId+'/command',{originalRequestId:body.requestId,
      body:{...original,action:'installation.save',data:{installationId,expectedRevision,document,expectedPreviewSha256,
        ...(returnReview===undefined?{}:{returnReview})}}});
  }
  workBillingCatalog(caseId){
    return this.#request(workBillingPath(caseId),{});
  }
  workBillingAuthority(caseId,authorityId){
    return this.#request(workBillingPath(caseId)+'/authorities/'+encodeURIComponent(hourlyAuthorityId(authorityId)),{});
  }
  workBillingSaveAuthority(caseId,body){
    hourlyAuthorityInput(body);
    return this.#request(workBillingPath(caseId)+'/authorities',{body,originalRequestId:body.requestId});
  }
  workBilling(caseId,chargeId){
    id(chargeId,'work-billing');
    return this.#request(workBillingPath(caseId,chargeId),{});
  }
  workBillingPreview(caseId,body){
    workBillingInput(body);
    return this.#request(workBillingPath(caseId)+'/preview',{body,mutation:false});
  }
  workBillingPrepare(caseId,body){
    workBillingInput(body,true);
    return this.#request(workBillingPath(caseId)+'/prepare',{body,originalRequestId:body.requestId});
  }
  workBillingApply(caseId,chargeId,body){
    id(chargeId,'work-billing');
    exact(body,['actor','expectedProposalSha256'],['actor','expectedProposalSha256']);
    text(body.actor,'Original recording operator',300);sha(body.expectedProposalSha256);
    return this.#request(workBillingPath(caseId,chargeId)+'/apply',{body,recovery:'Reopen this same hourly Work charge and resume its exact apply body. The retained native requests remain authoritative; do not prepare a replacement for an uncertain response.'});
  }
  workBillingCancel(caseId,chargeId,body){
    id(chargeId,'work-billing');
    exact(body,['requestId','actor','expectedProposalSha256','reason'],['requestId','actor','expectedProposalSha256','reason']);
    requestId(body.requestId);text(body.actor,'Recording operator',300);sha(body.expectedProposalSha256);text(body.reason,'Cancellation reason',6000);
    return this.#request(workBillingPath(caseId,chargeId)+'/cancel',{body,originalRequestId:body.requestId});
  }
  workBillingPreviewIssue(caseId,chargeId){
    id(chargeId,'work-billing');
    return this.#request(workBillingPath(caseId,chargeId)+'/preview-issue',{body:{},mutation:false});
  }
  workBillingIssue(caseId,chargeId,body){
    id(chargeId,'work-billing');
    exact(body,['actor','expectedIssuePreviewSha256','creditDecisionId'],['actor','expectedIssuePreviewSha256']);
    text(body.actor,'Original recording operator',300);sha(body.expectedIssuePreviewSha256);
    if(body.creditDecisionId!==undefined)text(body.creditDecisionId,'Original native credit decision',100);
    return this.#request(workBillingPath(caseId,chargeId)+'/issue',{body,recovery:'Read the same hourly Work charge and recover its exact retained issue review and credit decision. Reuse this original body; do not create another invoice or request.'});
  }
  workBillingRefresh(caseId,chargeId){
    id(chargeId,'work-billing');
    return this.#request(workBillingPath(caseId,chargeId)+'/refresh',{body:{},mutation:false});
  }
  expenseBillingCatalog(caseId){
    return this.#request(expenseBillingPath(caseId),{});
  }
  expenseBilling(caseId,chargeId){
    id(chargeId,'expense-billing');
    return this.#request(expenseBillingPath(caseId,chargeId),{});
  }
  expenseBillingPreview(caseId,body){
    expenseBillingInput(body);
    return this.#request(expenseBillingPath(caseId)+'/preview',{body,mutation:false});
  }
  expenseBillingPrepare(caseId,body){
    expenseBillingInput(body,true);
    return this.#request(expenseBillingPath(caseId)+'/prepare',{body,originalRequestId:body.requestId});
  }
  expenseBillingApply(caseId,chargeId,body){
    id(chargeId,'expense-billing');
    exact(body,['actor','expectedProposalSha256'],['actor','expectedProposalSha256']);
    text(body.actor,'Original recording operator',300);sha(body.expectedProposalSha256);
    return this.#request(expenseBillingPath(caseId,chargeId)+'/apply',{body,recovery:'Reopen this same expense charge and resume its exact apply body. The retained native requests remain authoritative; do not prepare a replacement for an uncertain response.'});
  }
  expenseBillingCancel(caseId,chargeId,body){
    id(chargeId,'expense-billing');
    exact(body,['requestId','actor','expectedProposalSha256','reason'],['requestId','actor','expectedProposalSha256','reason']);
    requestId(body.requestId);text(body.actor,'Recording operator',300);sha(body.expectedProposalSha256);text(body.reason,'Cancellation reason',6000);
    return this.#request(expenseBillingPath(caseId,chargeId)+'/cancel',{body,originalRequestId:body.requestId});
  }
  expenseBillingPreviewIssue(caseId,chargeId){
    id(chargeId,'expense-billing');
    return this.#request(expenseBillingPath(caseId,chargeId)+'/preview-issue',{body:{},mutation:false});
  }
  expenseBillingIssue(caseId,chargeId,body){
    id(chargeId,'expense-billing');
    exact(body,['actor','expectedIssuePreviewSha256','creditDecisionId'],['actor','expectedIssuePreviewSha256']);
    text(body.actor,'Original recording operator',300);sha(body.expectedIssuePreviewSha256);
    if(body.creditDecisionId!==undefined)text(body.creditDecisionId,'Original native credit decision',100);
    return this.#request(expenseBillingPath(caseId,chargeId)+'/issue',{body,recovery:'Read the same expense charge and recover its exact retained issue review and credit decision. Reuse this original body; do not create another invoice or request.'});
  }
  expenseBillingRefresh(caseId,chargeId){
    id(chargeId,'expense-billing');
    return this.#request(expenseBillingPath(caseId,chargeId)+'/refresh',{body:{},mutation:false});
  }
  commercialChanges(caseId,billingId,milestoneId){
    return this.#request(commercialPath(caseId,billingId,milestoneId)+'/changes',{});
  }
  commercialChange(caseId,changeId){
    return this.#request(commercialChangePath(caseId,changeId),{});
  }
  commercialChangePreview(caseId,billingId,milestoneId,body){
    commercialChangeSource(body);
    return this.#request(commercialPath(caseId,billingId,milestoneId)+'/changes/preview',{body,mutation:false});
  }
  commercialChangePrepare(caseId,billingId,milestoneId,body){
    commercialChangeSource(body,true);
    return this.#request(commercialPath(caseId,billingId,milestoneId)+'/changes/prepare',{body,originalRequestId:body.requestId});
  }
  commercialChangeApply(caseId,changeId,body){
    exact(body,['actor','expectedProposalSha256'],['actor','expectedProposalSha256']);
    text(body.actor,'Original operator',300);sha(body.expectedProposalSha256);
    return this.#request(commercialChangePath(caseId,changeId)+'/apply',{body,recovery:'Reopen this original milestone change and resume its same apply request.'});
  }
  commercialChangeCancel(caseId,changeId,body){
    exact(body,['actor','expectedProposalSha256','requestId','reason'],['actor','expectedProposalSha256','requestId','reason']);
    text(body.actor,'Operator',300);sha(body.expectedProposalSha256);requestId(body.requestId);text(body.reason,'Cancellation reason',6000);
    return this.#request(commercialChangePath(caseId,changeId)+'/cancel',{body,originalRequestId:body.requestId});
  }
  commercialChangePreviewIssue(caseId,changeId){
    return this.#request(commercialChangePath(caseId,changeId)+'/preview-issue',{body:{},mutation:false});
  }
  commercialChangeIssue(caseId,changeId,body){
    exact(body,['actor','expectedProposalSha256','expectedIssuePreviewSha256','creditDecisionId'],['actor','expectedIssuePreviewSha256']);
    text(body.actor,'Original operator',300);sha(body.expectedIssuePreviewSha256);
    if(body.expectedProposalSha256!==undefined)sha(body.expectedProposalSha256);
    if(body.creditDecisionId!==undefined)commercialIdentifier(body.creditDecisionId);
    return this.#request(commercialChangePath(caseId,changeId)+'/issue',{body,recovery:'Read the retained original issue review and resume the same correction issue request.'});
  }
  commercialChangeRefresh(caseId,changeId){
    return this.#request(commercialChangePath(caseId,changeId)+'/refresh',{body:{},mutation:false});
  }
  commercialConnections() {
    return this.#request('/api/operations/commercial-connections', {});
  }
  commercialConfigureConnection(body) {
    exact(body, ['id','label','baseUrl','actor','requestId'], ['id','label','baseUrl','actor','requestId']);
    commercialIdentifier(body.id, 'Receivables endpoint identifier');
    text(body.label, 'Receivables endpoint label', 160);
    text(body.baseUrl, 'Original receivables API URL', 2000);
    text(body.actor, 'Configuring operator', 1000); requestId(body.requestId);
    return this.#request('/api/operations/commercial-connections',
      {body, originalRequestId:body.requestId});
  }
  commercialCustomers(endpointId) {
    return this.#request('/api/operations/commercial-connections/' +
      encodeURIComponent(commercialIdentifier(endpointId, 'Receivables endpoint identifier')) + '/customers', {});
  }
  commercialList(caseId) {
    return this.#request(commercialPath(caseId), {});
  }
  commercialDetail(caseId, billingId) {
    return this.#request(commercialPath(caseId, billingId), {});
  }
  commercialSchedule(caseId, body) {
    exact(body, COMMERCIAL_SELECTION_FIELDS, COMMERCIAL_SELECTION_FIELDS);
    commercialSource(body);
    return this.#request(commercialPath(caseId) + '/schedule', {body, mutation:false});
  }
  commercialPrepare(caseId, body) {
    const fields = [...COMMERCIAL_SELECTION_FIELDS,'requestId','actor','expectedScheduleSha256',
      'endpointId','customerId','milestones','purchaseOrder','note'];
    exact(body, fields, fields.filter(key => !['purchaseOrder','note'].includes(key)));
    commercialSource(body); requestId(body.requestId);
    text(body.actor, 'Recording operator', 300); sha(body.expectedScheduleSha256);
    commercialIdentifier(body.endpointId, 'Receivables endpoint identifier');
    need(typeof body.customerId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.customerId),
      'GRANT_INVALID_INPUT', 'Choose the original saved accounting customer.');
    commercialMilestones(body.milestones);
    if (body.purchaseOrder !== undefined) text(body.purchaseOrder, 'Purchase order', 300, true);
    if (body.note !== undefined) text(body.note, 'Billing note', 6000, true);
    return this.#request(commercialPath(caseId) + '/prepare',
      {body, originalRequestId:body.requestId});
  }
  commercialDraft(caseId, billingId, milestoneId, body) {
    exact(body, ['actor'], ['actor']); text(body.actor, 'Recording operator', 300);
    return this.#request(commercialPath(caseId, billingId, milestoneId) + '/draft',
      {body, recovery:commercialRecovery(caseId, billingId, milestoneId, 'draft')});
  }
  commercialPreview(caseId, billingId, milestoneId) {
    return this.#request(commercialPath(caseId, billingId, milestoneId) + '/preview',
      {body:{}, mutation:false});
  }
  commercialIssue(caseId, billingId, milestoneId, body) {
    exact(body, ['actor','expectedIssuePreviewSha256'], ['actor','expectedIssuePreviewSha256']);
    text(body.actor, 'Recording operator', 300); sha(body.expectedIssuePreviewSha256);
    return this.#request(commercialPath(caseId, billingId, milestoneId) + '/issue',
      {body, recovery:commercialRecovery(caseId, billingId, milestoneId, 'reviewed issue')});
  }
  commercialRefresh(caseId, billingId) {
    return this.#request(commercialPath(caseId, billingId) + '/refresh',
      {body:{}, recovery:commercialRecovery(caseId, billingId, undefined, 'refresh')});
  }
  cohortSeed(caseId, expectedVersion, tranche) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); integer(tranche,'Cohort tranche',2,3);
    return this.#request('/api/operations/'+caseId+'/cohort-seed',
      {body:{expectedVersion,tranche},mutation:false});
  }
  cohortPreview(caseId, expectedVersion, inputs) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); object(inputs,'Original cohort review inputs');
    return this.#request('/api/operations/'+caseId+'/cohort-preview',
      {body:{expectedVersion,inputs},mutation:false});
  }
  cohortPrepare(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','inputs','expectedPreviewSha256']);
    const {inputs,expectedPreviewSha256,...original}=body;
    object(inputs,'Original cohort review inputs'); sha(expectedPreviewSha256);
    return this.command(caseId,{...original,action:'cohort.prepare',data:{inputs,expectedPreviewSha256}});
  }
  implementationSource(caseId, expectedVersion, sourceId, asOfAt) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); id(sourceId,'source');
    if (asOfAt !== undefined) implementationCutoff(asOfAt);
    return this.#request('/api/operations/'+caseId+'/implementation-source',
      {body:{expectedVersion,sourceId,...(asOfAt === undefined ? {} : {asOfAt})},mutation:false});
  }
  implementationPreview(caseId, expectedVersion, inputs) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version');
    object(inputs,'Original implementation review inputs');
    return this.#request('/api/operations/'+caseId+'/implementation-preview',
      {body:{expectedVersion,inputs},mutation:false});
  }
  implementationPrepare(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','inputs','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','inputs','expectedPreviewSha256']);
    const {inputs,expectedPreviewSha256,...original}=body;
    object(inputs,'Original implementation review inputs'); sha(expectedPreviewSha256);
    return this.command(caseId,{...original,action:'implementation.prepare',data:{inputs,expectedPreviewSha256}});
  }
  completionCorrectionsSeed(caseId, expectedVersion, outcomeId, reviewId) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); id(outcomeId,'outcome');
    if(reviewId!==undefined)id(reviewId,'review');
    return this.#request('/api/operations/'+caseId+'/completion-corrections-seed',
      {body:{expectedVersion,outcomeId,...(reviewId===undefined?{}:{reviewId})},mutation:false});
  }
  completionCorrectionsPreview(caseId, expectedVersion, inputs, asOfDate) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); completionCorrectionInputs(inputs);
    if(asOfDate!==undefined)completionDate(asOfDate);
    return this.#request('/api/operations/'+caseId+'/completion-corrections-preview',
      {body:{expectedVersion,inputs,...(asOfDate===undefined?{}:{asOfDate})},mutation:false});
  }
  completionCorrectionsSave(caseId, body) {
    exact(body,['expectedVersion','requestId','actor','note','inputs','asOfDate','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','inputs','asOfDate','expectedPreviewSha256']);
    completionCorrectionInputs(body.inputs);completionDate(body.asOfDate);sha(body.expectedPreviewSha256);
    const {inputs,asOfDate,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'completion.corrections.save',
      data:{inputs,asOfDate,expectedPreviewSha256}});
  }
  completionInstallations(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','tranche'],['expectedVersion','tranche']);
    integer(body.expectedVersion,'Current case version'); integer(body.tranche,'Completion tranche',1,3);
    return this.#request('/api/operations/'+caseId+'/completion-installations',{body,mutation:false});
  }
  completionInstallationsPreview(caseId, body) {
    id(caseId,'operation'); exact(body,['expectedVersion','inputs','asOfDate'],['expectedVersion','inputs']);
    integer(body.expectedVersion,'Current case version'); completionInstallationSelections(body.inputs);
    if(body.asOfDate!==undefined)completionDate(body.asOfDate);
    return this.#request('/api/operations/'+caseId+'/completion-installations-preview',{body,mutation:false});
  }
  completionSeed(caseId, expectedVersion, tranche) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version'); integer(tranche,'Completion tranche',1,3);
    return this.#request('/api/operations/'+caseId+'/completion-seed',
      {body:{expectedVersion,tranche},mutation:false});
  }
  completionPreview(caseId, expectedVersion, inputs) {
    id(caseId,'operation'); integer(expectedVersion,'Current case version');
    exact(inputs,['receiptId','asOfDate','summary','cohortReviewIds','implementationReviewIds','correctionReviewId'],['receiptId','summary']);
    if(inputs.correctionReviewId!==undefined)id(inputs.correctionReviewId,'review');
    if (inputs.cohortReviewIds !== undefined) cohortReviewIds(inputs.cohortReviewIds);
    if (inputs.implementationReviewIds !== undefined) implementationReviewIds(inputs.implementationReviewIds);
    id(inputs.receiptId,'cash');
    if (inputs.asOfDate !== undefined) completionDate(inputs.asOfDate);
    text(inputs.summary,'Completed tranche result',20000,true);
    return this.#request('/api/operations/'+caseId+'/completion-preview',
      {body:{expectedVersion,...inputs},mutation:false});
  }
  completionSave(caseId, body) { return this.command(caseId,completionCommandBody('save',body)); }
  completionPrepare(caseId, body) { return this.command(caseId,completionCommandBody('prepare',body)); }
  completionExtension(caseId, body) { return this.command(caseId,completionCommandBody('extension',body)); }
  completionSubmit(caseId, body) { return this.command(caseId,completionCommandBody('submit',body)); }
  completionDecision(caseId, body) { return this.command(caseId,completionCommandBody('decision',body)); }
  settlementPreview(caseId, expectedVersion, bytes, filename, selection) {
    id(caseId,'operation');integer(expectedVersion,'Current case version');
    if(selection!==undefined)settlementReview(selection);
    return this.#request('/api/operations/'+caseId+'/settlement/preview',
      {body:{expectedVersion,...settlementArchive(bytes,filename),...(selection??{})},mutation:false});
  }
  settlementReceive(caseId,bytes,body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','filename','name','selections','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','filename','name','selections','expectedPreviewSha256']);
    const {filename,name,selections,expectedPreviewSha256,...original}=body;
    sha(expectedPreviewSha256);settlementReview({name,selections});
    return this.command(caseId,{...original,action:'settlement.receive',
      data:{...settlementArchive(bytes,filename),name,selections,expectedPreviewSha256}});
  }
  settlementCorrectionPreview(caseId,body) {
    id(caseId,'operation');exact(body,['expectedVersion',...SETTLEMENT_CORRECTION_FIELDS],['expectedVersion',...SETTLEMENT_CORRECTION_FIELDS.slice(0,5)]);
    const {expectedVersion,...correction}=body;integer(expectedVersion,'Current case version');settlementCorrection(correction);
    return this.#request('/api/operations/'+caseId+'/settlement/correction-preview',{body,mutation:false});
  }
  settlementCorrect(caseId,body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','expectedPreviewSha256',...SETTLEMENT_CORRECTION_FIELDS],
      ['expectedVersion','requestId','actor','expectedPreviewSha256',...SETTLEMENT_CORRECTION_FIELDS.slice(0,5)]);
    const {expectedVersion,requestId,actor,note,expectedPreviewSha256,...correction}=body;
    sha(expectedPreviewSha256);settlementCorrection(correction);
    return this.command(caseId,{expectedVersion,requestId,actor,...(note===undefined?{}:{note}),action:'settlement.correct',
      data:{...correction,expectedPreviewSha256}});
  }
  supportPreview(caseId, expectedVersion, bytes, filename) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    return this.#request('/api/operations/' + caseId + '/support-preview',
      {body:{expectedVersion, ...supportHandoff(bytes, filename)}, mutation:false});
  }
  supportReceive(caseId, bytes, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'filename',
      'expectedPreviewSha256', 'deploymentId', 'deployment'],
    ['expectedVersion', 'requestId', 'actor', 'filename', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    sha(body.expectedPreviewSha256); text(body.actor, 'Receiving operator', 300);
    if (body.note !== undefined) text(body.note, 'Receiving note', 12000, true);
    const {filename, expectedPreviewSha256, deploymentId = null, deployment, ...original} = body;
    if (deploymentId !== null) {
      id(deploymentId, 'deployment');
      need(deployment === undefined || deployment === null ||
        (plain(deployment) && Object.keys(deployment).length === 0), 'GRANT_INVALID_INPUT',
      'Choose the existing deployment without competing replacement fields.');
    } else exact(deployment, SUPPORT_DEPLOYMENT_FIELDS);
    return this.#request('/api/operations/' + caseId + '/command', {originalRequestId:body.requestId,
      body:{...original, action:'support.receive', data:{...supportHandoff(bytes, filename),
        expectedPreviewSha256, deploymentId, ...(deployment === undefined ? {} : {deployment})}}});
  }
  expensePreview(caseId, expectedVersion, bytes, filename) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_MAX_SOURCE_BYTES,
      'GRANT_INPUT_TOO_LARGE', 'Choose the complete original issued source or accountant ZIP within 8 MiB.');
    text(filename, 'Original expense filename', 240);
    return this.#request('/api/operations/' + caseId + '/expense-preview',
      {body:{expectedVersion,filename,contentBase64:bytes.toString('base64')},mutation:false});
  }
  expenseReceive(caseId, bytes, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion','requestId','actor','note','filename','expectedPreviewSha256'],
      ['expectedVersion','requestId','actor','filename','expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    sha(body.expectedPreviewSha256); text(body.actor, 'Receiving operator', 300);
    text(body.filename, 'Original expense filename', 240);
    need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_MAX_SOURCE_BYTES,
      'GRANT_INPUT_TOO_LARGE', 'Use the exact reviewed original expense file within 8 MiB.');
    const {filename,expectedPreviewSha256,...original}=body;
    return this.command(caseId,{...original,action:'expense.receive',
      data:{filename,expectedPreviewSha256,contentBase64:bytes.toString('base64')}});
  }
  expenseSave(caseId, body) {
    exact(body,['expectedVersion','requestId','actor','note','data'],['expectedVersion','requestId','actor','data']);
    object(body.data,'Original expense attribution inputs');
    return this.command(caseId,{...body,action:'expense.save'});
  }
  expenseTransition(caseId, action, body) {
    need(['review','reopen','void'].includes(action),'GRANT_INVALID_ACTION','Choose the original expense review transition.');
    exact(body,['expectedVersion','requestId','actor','note','id','expectedContentSha256'],
      ['expectedVersion','requestId','actor','note','id','expectedContentSha256']);
    need(typeof body.id==='string' && /^expense-attribution-[a-f0-9]{32}$/.test(body.id),
      'GRANT_INVALID_INPUT','Select the retained expense attribution.');
    sha(body.expectedContentSha256);text(body.note,'Expense review note',12000);
    const {id:attributionId,expectedContentSha256,...original}=body;
    return this.command(caseId,{...original,action:'expense.'+action,data:{id:attributionId,expectedContentSha256}});
  }
  expenseRequest(caseId, body) {
    id(caseId,'operation');
    exact(body,['expectedVersion','requestId','actor','note','action','data'],
      ['expectedVersion','requestId','actor','action','data']);
    need(['expense.receive','expense.save','expense.review','expense.reopen','expense.void'].includes(body.action),
      'GRANT_INVALID_ACTION','Select a complete original expense request.');
    requestId(body.requestId);object(body.data);
    return this.#request('/api/operations/'+caseId+'/expense-request',{body,mutation:false});
  }
  buyerPreview(caseId, expectedVersion, bytes, filename) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    return this.#request('/api/operations/' + caseId + '/buyer-preview',
      {body:{expectedVersion, ...buyerHandoff(bytes, filename)}, mutation:false});
  }
  buyerReceive(caseId, bytes, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'filename',
      'expectedPreviewSha256', 'deploymentId', 'deployment', 'selections'],
    ['expectedVersion', 'requestId', 'actor', 'filename', 'expectedPreviewSha256', 'selections']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    sha(body.expectedPreviewSha256); text(body.actor, 'Receiving operator', 300);
    if (body.note !== undefined) text(body.note, 'Receiving note', 12000, true);
    const {filename, expectedPreviewSha256, deploymentId = null, deployment, selections, ...original} = body;
    buyerSelections(selections);
    if (deploymentId !== null) {
      id(deploymentId, 'deployment');
      need(deployment === undefined || deployment === null ||
        (plain(deployment) && Object.keys(deployment).length === 0), 'GRANT_INVALID_INPUT',
      'Choose the existing deployment without competing replacement fields.');
    } else {
      exact(deployment, SUPPORT_DEPLOYMENT_FIELDS, ['name', 'operator', 'role']);
      need(['BUYER', 'BOTH'].includes(deployment.role), 'GRANT_INVALID_INPUT',
        'Select the original buyer or combined merchant/buyer deployment role.');
    }
    return this.#request('/api/operations/' + caseId + '/command', {originalRequestId:body.requestId,
      body:{...original, action:'buyer.receive', data:{...buyerHandoff(bytes, filename),
        expectedPreviewSha256, deploymentId, ...(deployment === undefined ? {} : {deployment}), selections}}});
  }
  download(kind, args) {
    object(args);
    const routes = {
      plan:() => '/api/plans/' + id(args.planId, 'plan') + '/export.zip' +
        (args.revision === undefined ? '' : '?revision=' + integer(args.revision,'Selected plan revision',1,1000000)),
      'risk-comparison':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/export.zip' + riskComparisonQuery(args,'risk-comparison'),
      'risk-comparison-json':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/export.json' + riskComparisonQuery(args,'risk-comparison-json'),
      'risk-comparison-report':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/export.html' + riskComparisonQuery(args,'risk-comparison-report'),
      'risk-comparison-risks':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/risks.csv' + riskComparisonQuery(args,'risk-comparison-risks'),
      'risk-comparison-actions':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/actions.csv' + riskComparisonQuery(args,'risk-comparison-actions'),
      'risk-comparison-context':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register-comparison/context.csv' + riskComparisonQuery(args,'risk-comparison-context'),
      'forecast-comparison':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/export.zip' + forecastComparisonQuery(args,true),
      'forecast-comparison-report':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/report.html' + forecastComparisonQuery(args,true),
      'forecast-comparison-json':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/comparison.json' + forecastComparisonQuery(args,true),
      'forecast-comparison-changes':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/changes.csv' + forecastComparisonQuery(args,true),
      'forecast-comparison-impact':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/impact.csv' + forecastComparisonQuery(args,true),
      'forecast-comparison-daily':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/daily.csv' + forecastComparisonQuery(args,true),
      'forecast-comparison-work':() => '/api/operations/' + id(args.caseId,'operation') + '/forecast-comparison/work.csv' + forecastComparisonQuery(args,true),
      'plan-comparison':() => '/api/plans/' + id(args.planId,'plan') + '/comparison/export.zip' + planComparisonQuery(args,true),
      'plan-comparison-report':() => '/api/plans/' + id(args.planId,'plan') + '/comparison/report.html' + planComparisonQuery(args,true),
      'plan-comparison-changes':() => '/api/plans/' + id(args.planId,'plan') + '/comparison/changes.csv' + planComparisonQuery(args,true),
      'plan-comparison-impact':() => '/api/plans/' + id(args.planId,'plan') + '/comparison/impact.csv' + planComparisonQuery(args,true),
      'plan-comparison-daily':() => '/api/plans/' + id(args.planId,'plan') + '/comparison/daily.csv' + planComparisonQuery(args,true),
      scenario:() => '/api/plans/' + id(args.planId, 'plan') + '/scenario.json',
      'daily-csv':() => '/api/plans/' + id(args.planId, 'plan') + '/daily.csv',
      'costs-csv':() => '/api/plans/' + id(args.planId, 'plan') + '/costs.csv',
      case:() => '/api/operations/' + id(args.caseId, 'operation') + '/export.zip',
      'cost-funding':() => '/api/operations/' + id(args.caseId,'operation') + '/cost-funding/export.zip?revision=' +
        integer(args.revision,'Funding edition',1,1000000) + '&expectedVersion=' +
        integer(args.expectedVersion,'Reviewed case version') + '&expectedReportSha256=' + sha(args.expectedReportSha256),
      'work-billing':() => workBillingPath(args.caseId,id(args.chargeId,'work-billing'))+'/export.zip',
      'expense-billing':() => expenseBillingPath(args.caseId,id(args.chargeId,'expense-billing'))+'/export.zip',
      'expense-attributions':() => '/api/operations/' + id(args.caseId,'operation') + '/expense-attributions.csv',
      'expense-sources':() => '/api/operations/' + id(args.caseId,'operation') + '/expense-sources.csv',
      'expense-html':() => '/api/operations/' + id(args.caseId,'operation') + '/expense-attribution.html',
      'task-outcomes':() => '/api/operations/' + id(args.caseId,'operation') + '/task-outcomes/' +
        id(args.comparisonId,'task-outcomes') + '/export.zip?revision=' + integer(args.revision,'Task comparison revision',1,1000000) +
        '&expectedVersion=' + integer(args.expectedVersion,'Reviewed export case version'),
      'supplier-account':() => '/api/operations/' + id(args.caseId,'operation') + '/supplier-account/export.zip' + supplierAccountQuery(args,true),
      performance:() => '/api/operations/' + id(args.caseId,'operation') + '/performance/export.zip' + performanceQuery(args,true),
      'cash-account':() => '/api/operations/' + id(args.caseId,'operation') + '/cash-account/export.zip' + cashAccountQuery(args,true),
      'account-reconciliation':() => '/api/operations/' + id(args.caseId,'operation') + '/account-reconciliation/export.zip' + accountReconciliationQuery(args,true),
      'risk-register':() => '/api/operations/' + id(args.caseId,'operation') + '/risk-register/' + id(args.reviewId,'review') + '/export.zip',
      engagement:() => '/api/operations/' + id(args.caseId, 'operation') + '/engagements/' + id(args.reviewId, 'review') + '/export.zip',
      forecast:() => '/api/operations/' + id(args.caseId, 'operation') + '/forecasts/' + id(args.forecastId, 'forecast') + '/export.zip',
      portfolio:() => '/api/operations/' + id(args.caseId, 'operation') + '/portfolios/' + id(args.portfolioId, 'portfolio') + '/export.zip',
      'delivery-queue':() => '/api/operations/' + id(args.caseId,'operation') + '/delivery-queue/export.zip' +
        (args.asOfDate === undefined ? '' : '?asOfDate=' + encodeURIComponent(completionDate(args.asOfDate))),
      installation:() => '/api/operations/' + id(args.caseId,'operation') + '/installations/' + id(args.installationId,'installation') +
        '/export.zip?revision=' + integer(args.revision,'Selected installation edition',1,500),
      'installation-return':() => '/api/operations/' + id(args.caseId,'operation') + '/installation-returns/' + id(args.reviewId,'review') + '/export.zip',
      commercial:() => commercialPath(args.caseId, args.billingId) + '/export.zip',
      'commercial-change':() => commercialChangePath(args.caseId,args.changeId)+'/export.zip',
      source:() => '/api/operations/' + id(args.caseId, 'operation') + '/sources/' + id(args.sourceId, 'source'),
      settlement:() => '/api/operations/' + id(args.caseId,'operation') + '/settlements/' + id(args.reviewId,'settlement') + '/export',
      'customer-use-calendar':() => '/api/operations/' + id(args.caseId,'operation') + '/customer-use-calendar/export.' +
        deliveryCalendarFormat(args.format ?? 'json') + customerUseQuery(args),
      'delivery-agenda':() => '/api/operations/delivery-agenda/export.' +
        deliveryCalendarFormat(args.format) + deliveryAgendaQuery(args, true),
      'delivery-calendar':() => '/api/operations/' + id(args.caseId,'operation') + '/delivery-calendar/export.' +
        deliveryCalendarFormat(args.format) + deliveryCalendarQuery(args),
      'completion-corrections':() => '/api/operations/' + id(args.caseId,'operation') + '/completion-corrections/' + id(args.reviewId,'review') + '/export.zip',
      completion:() => '/api/operations/' + id(args.caseId,'operation') + '/completion-reviews/' + id(args.reviewId,'review') + '/export.zip',
      cohort:() => '/api/operations/' + id(args.caseId,'operation') + '/cohort-reviews/' + id(args.reviewId,'review') + '/export.zip',
      implementation:() => '/api/operations/' + id(args.caseId,'operation') + '/implementation-reviews/' + id(args.reviewId,'review') + '/export.zip',
      'implementation-original':() => '/api/operations/' + id(args.caseId,'operation') + '/implementation-originals/' + id(args.sourceId,'source') + '/' + sha(args.sha256),
    };
    need(Object.hasOwn(routes, kind), 'GRANT_INVALID_DOWNLOAD', 'Choose a complete original grant export or source.');
    return this.#request(routes[kind](), {});
  }
  importBundle(kind, bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_BUNDLE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use the complete original bundle up to 32 MiB.');
    exact(body, ['name', 'requestId', 'actor'], ['name', 'requestId']);
    requestId(body.requestId); text(body.name, 'Received name', 300);
    need(['plan', 'case'].includes(kind), 'GRANT_INVALID_IMPORT', 'Choose a complete planning or operating-case bundle.');
    if (kind === 'case') text(body.actor, 'Receiving operator', 300);
    return this.#request((kind === 'case' ? '/api/operations/import' : '/api/import-bundle') + '?name=' + encodeURIComponent(body.name),
      {body:bytes, contentType:'application/zip', originalRequestId:body.requestId,
        headers:{'X-Request-ID':body.requestId, ...(kind === 'case' ? {'X-Recorded-By':encodeURIComponent(body.actor)} : {})}});
  }
  importScenario(bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use original scenario bytes up to 8 MiB.');
    exact(body, ['name', 'requestId', 'note', 'planning', 'filename'], ['name', 'requestId']);
    requestId(body.requestId);
    return this.#request('/api/import-scenario', {body:{...body, sourceBase64:bytes.toString('base64')}, originalRequestId:body.requestId});
  }
  attach(caseId, bytes, body) {
    id(caseId, 'operation');
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'An original source attachment fits 8 MiB.');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'filename', 'kind', 'mediaType', 'sourceUrl', 'observedAt'],
      ['expectedVersion', 'requestId', 'actor', 'filename', 'kind', 'mediaType']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    const {expectedVersion, requestId:request, actor, note = '', ...data} = body;
    return this.#request('/api/operations/' + caseId + '/command', {originalRequestId:request,
      body:{expectedVersion, requestId:request, actor, note, action:'source.add', data:{...data, contentBase64:bytes.toString('base64')}}});
  }
  intake(bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use a complete original source-intake packet up to 8 MiB.');
    exact(body, ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'calendarStart', 'actor', 'requestId'],
      ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'actor', 'requestId']);
    requestId(body.requestId); id(body.planId, 'plan'); sha(body.expectedContentSha256);
    return this.#request('/api/operations/intake', {originalRequestId:body.requestId,
      body:{...body, packetBase64:bytes.toString('base64')}});
  }
  detach(expectedInstanceId) {
    if (this.#detach) {
      return this.#detach.then(result => {
        if (expectedInstanceId !== undefined) need(result.originalInstanceId === expectedInstanceId,
          'GRANT_INSTANCE_CONFLICT', 'The pending detach belongs to another original instance.');
        return result;
      });
    }
    // Freeze admission before any await. Already accepted reads and writes keep
    // their original request identity and complete before the launcher is stopped.
    this.#detaching = true;
    const detaching = (async () => {
      if (this.#opening) {
        try { await this.#opening; } catch {}
        // A failed open may still own its original child after a stop failure.
      }
      await Promise.allSettled([...this.#pending]);
      const owned = this.#child, connection = this.#connection;
      if (expectedInstanceId !== undefined) need(connection?.original.instanceId === expectedInstanceId,
        'GRANT_INSTANCE_CONFLICT', 'Read the original instance before closing this connection.');
      let result;
      if (owned) {
        need(!owned.instanceId || owned.instanceId === connection?.original.instanceId, 'GRANT_INSTANCE_CONFLICT',
          'This client may stop only its original owned grant instance.');
        owned.stop();
        const outcome = await owned.done;
        if (this.#child === owned) this.#child = null;
        if (this.#connection === connection) this.#connection = null;
        result = {schema:GRANT_AGENT_SCHEMA, state:'OWNED_ORIGINAL_SERVICE_CLOSED',
          originalInstanceId:owned.instanceId, result:outcome};
      } else {
        if (this.#connection === connection) this.#connection = null;
        result = {schema:GRANT_AGENT_SCHEMA, state:'BORROWED_CONNECTION_RELEASED',
          originalInstanceId:connection?.original.instanceId ?? null};
      }
      this.#detaching = false;
      return result;
    })();
    this.#detach = detaching;
    const releaseAttempt = () => { if (this.#detach === detaching) this.#detach = null; };
    detaching.then(releaseAttempt, releaseAttempt);
    // Failed drain keeps admission closed and the same child/connection retained.
    // A later detach or permanent close retries those owners, not a new launcher.
    return detaching;
  }
  close() {
    this.#closing = true;
    if (!this.#close) {
      const closing = this.detach(); this.#close = closing;
      closing.catch(() => { if (this.#close === closing) this.#close = null; });
    }
    return this.#close;
  }
}
