/**
 * Compare a complete adoption plan with an original frozen Operations cohort.
 * Native review classifications remain authoritative; this module joins them to
 * planned purchase opportunities without turning requests or task uses into sales.
 */
import {COHORT_PLAN_SCHEMA, COHORT_PLAN_REPORT_SCHEMA, evaluateCohortPlan, compareCohortPlans} from './cohort_planning.mjs';

export const COHORT_DELIVERY_INPUT_SCHEMA = 'stellar-forge.sf47-cohort-delivery-input.v1';
export const COHORT_DELIVERY_COMPARISON_SCHEMA = 'stellar-forge.sf47-cohort-delivery-comparison.v1';
const EDITION_SCHEMA = 'stellar-forge.sf47-cohort-plan-edition.v1';
const REVIEW_SCHEMA = 'stellar-forge.sf47-cohort-evaluation.v1';
const LIMIT = 8 * 1024 * 1024;
const SCALE = 10n ** 30n;
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(sortJson(value));
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
  return value;
}
export class CohortDeliveryError extends Error {
  constructor(code, message, path = '') { super(message); this.name = 'CohortDeliveryError'; this.code = code; this.path = path; }
}
function fail(code, message, path = '') { throw new CohortDeliveryError(code, message, path); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_COMPARISON', path + ' must be a JSON object.', path);
  return value;
}
function text(value, path, maximum = 20000) {
  if (typeof value !== 'string' || value.length > maximum) fail('INVALID_COMPARISON', path + ' must be text within ' + maximum + ' characters.', path);
  return value;
}
function list(value, path, maximum = 100000) {
  if (!Array.isArray(value) || value.length > maximum) fail('INVALID_COMPARISON', path + ' must be an array within ' + maximum + ' rows.', path);
  return value;
}
function unique(rows, key, path) {
  const found = new Set();
  for (const row of rows) {
    object(row, path);
    const id = text(row[key], path + '.' + key, 500);
    if (!id || found.has(id)) fail('DUPLICATE_IDENTITY', 'Each ' + path + ' needs a distinct ' + key + '.', path);
    found.add(id);
  }
  return rows;
}
function byteLength(value) {
  let length = 0;
  for (const char of value) { const code = char.codePointAt(0); length += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
  return length;
}
function jsonSource(value, path) {
  object(value, path);
  let raw; try { raw = JSON.stringify(value); } catch { fail('INVALID_COMPARISON', path + ' must be complete JSON.', path); }
  if (byteLength(raw) > LIMIT) fail('COMPARISON_TOO_LARGE', path + ' exceeds the original 8 MiB attachment bound.', path);
  return copy(value);
}
function timestamp(value, path) {
  text(value, path, 100);
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,30}))?([Zz]|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!m) fail('INVALID_COMPARISON_CLOCK', path + ' needs its original timezone-bearing ISO timestamp.', path);
  const source = m[1] + 'T' + m[2] + ':' + m[3] + ':' + (m[4] || '00') + '.000Z';
  const epoch = Date.parse(source);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== source) fail('INVALID_COMPARISON_CLOCK', path + ' is not a valid calendar time.', path);
  const zone = m[6], parts = zone.slice(1).replace(':', '');
  const hours = /^[Zz]$/.test(zone) ? 0 : Number(parts.slice(0, 2));
  const minutes = /^[Zz]$/.test(zone) || parts.length === 2 ? 0 : Number(parts.slice(2));
  if (hours > 23 || minutes > 59) fail('INVALID_COMPARISON_CLOCK', path + ' has an invalid timezone offset.', path);
  const offset = (hours * 60 + minutes) * 60000 * (zone[0] === '-' ? -1 : 1);
  const utc = epoch - offset;
  const day = new Date(utc).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('INVALID_COMPARISON_CLOCK', path + ' exceeds the supported calendar.', path);
  return {source:value, ticks:BigInt(utc / 1000) * SCALE + BigInt((m[5] || '').padEnd(30, '0')), day};
}
function seconds(ticks) {
  const sign = ticks < 0n ? '-' : '', n = ticks < 0n ? -ticks : ticks;
  const fraction = (n % SCALE).toString().padStart(30, '0').replace(/0+$/, '');
  return sign + (n / SCALE).toString() + (fraction ? '.' + fraction : '');
}
function dayOf(value) { return value ? timestamp(value, 'Original observation time').day : null; }
function checkedPlan(document) {
  const source = object(document, 'planDocument');
  if(source.schema===COHORT_RECORDED_COST_PLAN_SCHEMA)return evaluateCohortPlan(reopenCohortRecordedCostPlan(source).candidate);
  const plan = source.schema === EDITION_SCHEMA ? source.plan : source.schema === 'stellar-forge.sf47-delivery-schedule-report.v1' ? source.candidate :
    source.schema === COHORT_PLAN_REPORT_SCHEMA && source.kind === 'PLAN' ? source.input : source;
  if (!plan || plan.schema !== COHORT_PLAN_SCHEMA) fail('PLAN_DOCUMENT_REQUIRED', 'Select the full adoption plan, saved edition, or original plan report.', 'planDocument');
  return evaluateCohortPlan(plan);
}
function checkedReview(document) {
  const review = object(document, 'review'), c = object(review.cohort, 'review.cohort');
  if (review.purpose !== 'COHORT_EVALUATION' || c.schema !== REVIEW_SCHEMA)
    fail('FROZEN_COHORT_REQUIRED', 'Select a complete original frozen COHORT_EVALUATION review.', 'review');
  text(review.id, 'review.id', 200);
  const snapshot = object(review.snapshot, 'review.snapshot');
  object(snapshot.program, 'review.snapshot.program'); object(c.source, 'review.cohort.source');
  if (snapshot.program.id !== c.source.programId) fail('REVIEW_SOURCE_CONFLICT', 'The frozen review and its original case identity differ.', 'review');
  if (!Number.isSafeInteger(review.version) || review.version !== c.source.version + 1)
    fail('REVIEW_SOURCE_CONFLICT', 'The frozen review must retain its original preparation version.', 'review.version');
  for (const [path, hash] of [['businessSha256',review.businessSha256],['measurementSha256',c.source.measurementSha256],['previewSha256',c.previewSha256],['planContentSha256',c.source.planContentSha256]])
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('REVIEW_SOURCE_REQUIRED', 'Retain the original ' + path + '.', 'review.' + path);
  object(c.inputs, 'review.cohort.inputs'); object(c.window, 'review.cohort.window'); object(c.rule, 'review.cohort.rule');
  timestamp(c.window.asOfAt, 'review.cohort.window.asOfAt');
  for (const key of ['intents','selectedDeployments','targets']) unique(list(c[key], 'review.cohort.' + key, 10000), key === 'targets' ? 'key' : 'id', key);
  for (const key of ['observations','excludedObservations','issues','amounts','outcomes','products']) list(c[key], 'review.cohort.' + key, 10000);
  for (const key of ['operations','facilitators']) unique(list(c.inputs[key], 'review.cohort.inputs.' + key, 10000), 'id', key);
  unique(list(c.inputs.bindings, 'review.cohort.inputs.bindings', 10000), 'purchaseId', 'purchase associations');
  list(review.cohortHistory, 'review.cohortHistory', 100000);
  for (const intent of c.intents) {
    list(intent.purchaseIds, 'intent.purchaseIds', 10000); list(intent.completions, 'intent.completions', 100000);
    for (const field of ['inWindow','unplaced','attempted','settled','completeInWindow','independentCompleteInWindow','grossCompleteInWindow','laterCompletion','refundedAfterSettlement','cancelledAfterSettlement','teamOperated'])
      if (typeof intent[field] !== 'boolean') fail('REVIEW_FIELD_REQUIRED', 'Retain original intent classification ' + field + '.', 'intent.' + field);
    if (intent.firstAttemptAt) timestamp(intent.firstAttemptAt, 'intent.firstAttemptAt');
    for (const completion of intent.completions) timestamp(completion.completedAt, 'completion.completedAt');
  }
  return c;
}
export function seedCohortDeliveryComparison(planDocument, review, options = {}) {
  const plan = checkedPlan(planDocument); checkedReview(review);
  return {
    schema:COHORT_DELIVERY_INPUT_SCHEMA,
    planDocument:jsonSource(planDocument, 'planDocument'), review:jsonSource(review, 'review'),
    links:[], assignments:[],
    title:options.title || plan.input.name + ' — recorded delivery',
    note:options.note || '',
    recording:{editionId:options.editionId || '', createdAt:options.createdAt || '', actor:options.actor || '', planSourceId:options.planSourceId || ''}
  };
}
function normalizeInput(raw) {
  object(raw, 'input');
  if (raw.schema !== COHORT_DELIVERY_INPUT_SCHEMA) fail('INVALID_COMPARISON_SCHEMA', 'Use ' + COHORT_DELIVERY_INPUT_SCHEMA + '.', 'schema');
  const allowed = ['schema','planDocument','review','links','assignments','title','note','recording','commercial'];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail('UNKNOWN_COMPARISON_FIELD', 'Unknown comparison input: ' + key, key);
  const input = {
    schema:COHORT_DELIVERY_INPUT_SCHEMA,
    planDocument:jsonSource(raw.planDocument, 'planDocument'),review:jsonSource(raw.review, 'review'),
    links:list(raw.links || [], 'links', 10000).map((row,i) => {
      object(row, 'links.' + i);
      if (!['buyer','merchant','operation','facilitator'].includes(row.kind)) fail('INVALID_IDENTITY_LINK', 'Choose buyer, merchant, operation or facilitator.', 'links.' + i);
      return {kind:row.kind,plannedId:text(row.plannedId,'links.plannedId',500),observedId:text(row.observedId,'links.observedId',500),note:text(row.note || '','links.note')};
    }),
    assignments:list(raw.assignments || [], 'assignments', 10000).map(row => ({
      intentId:text(row.intentId,'assignments.intentId',500),targetId:text(row.targetId,'assignments.targetId',700),note:text(row.note || '','assignments.note')
    })),
    title:text(raw.title || 'Cohort delivery comparison','title',500),note:text(raw.note || '','note'),
    recording:{editionId:'',createdAt:'',actor:'',planSourceId:'',...object(raw.recording || {},'recording')}
  };
  for (const [key,value] of Object.entries(input.recording)) text(value,'recording.'+key,key === 'actor' ? 500 : 200);
  if (input.recording.createdAt) timestamp(input.recording.createdAt,'recording.createdAt');
  if(raw.commercial!==undefined)input.commercial=cmNormalize(raw.commercial);
  return input;
}
function buildJoins(plan, c, links) {
  const categories = {
    buyer:[plan.input.buyers,c.selectedDeployments.filter(row => ['BUYER','BOTH'].includes(row.role))],
    merchant:[plan.input.merchants,c.selectedDeployments.filter(row => ['MERCHANT','BOTH'].includes(row.role))],
    facilitator:[plan.input.facilitators,c.inputs.facilitators],
    operation:[plan.input.operations,c.inputs.operations]
  };
  const explicit = new Map();
  for (const link of links) {
    const key = link.kind + ':' + link.plannedId;
    if (explicit.has(key)) fail('DUPLICATE_IDENTITY_LINK', 'Each planned identity has one selected observed identity.', key);
    if (!link.note.trim()) fail('IDENTITY_LINK_NOTE_REQUIRED', 'Describe why these original identities refer to the same participant or useful operation.', key);
    const [planned,observed] = categories[link.kind];
    if (!planned.some(row => row.id === link.plannedId) || !observed.some(row => row.id === link.observedId))
      fail('UNKNOWN_IDENTITY_LINK', 'Select identities retained by these two original source documents.', key);
    explicit.set(key,link);
  }
  const joins = [], maps = Object.fromEntries(Object.keys(categories).map(key => [key,new Map()]));
  for (const kind of ['buyer','merchant','facilitator','operation']) {
    const [planned,observed] = categories[kind];
    for (const row of planned) {
      const chosen = explicit.get(kind + ':' + row.id);
      let match = chosen ? observed.find(value => value.id === chosen.observedId) : null, basis = chosen ? 'OPERATOR_ASSOCIATION' : 'UNMATCHED';
      if (!chosen) {
        const identity = row.deploymentId || row.id;
        const candidates = observed.filter(value => value.id === identity);
        if (candidates.length === 1) {
          const candidate = candidates[0];
          const same = kind === 'operation'
            ? maps.merchant.get(row.merchantId) === candidate.merchantDeploymentId && row.scope === candidate.scope && row.expectedOutput === candidate.expectedOutput
            : !!row.operatorId && row.operatorId === candidate.operatorId;
          if (same) { match = candidate; basis = 'ORIGINAL_IDENTITY'; }
        }
      }
      if (match) maps[kind].set(row.id,match.id);
      joins.push({kind,plannedId:row.id,plannedLabel:row.label || row.id,observedId:match?.id || null,
        observedLabel:match?.label || match?.name || match?.id || null,basis,note:chosen?.note || '',
        plannedOperatorId:row.operatorId || null,observedOperatorId:match?.operatorId || null,
        sourceIds:[...new Set([...(row.sourceIds || []),...(match?.sourceIds || [])])]});
    }
  }
  return {joins,maps};
}
function sum(rows,key) { return rows.reduce((n,row) => n + (row[key] || 0),0); }
function count(rows,key) { return rows.filter(row => row[key]).length; }
function delta(actual,planned) { return planned === null || planned === undefined || actual === null || actual === undefined ? null : actual - planned; }
function currentCompletion(intent, cutoff) {
  return intent.completions.filter(row => row.current && timestamp(row.completedAt,'completion.completedAt').ticks <= cutoff.ticks)
    .slice().sort((a,b) => { const first=timestamp(a.completedAt,'completion.completedAt').ticks, second=timestamp(b.completedAt,'completion.completedAt').ticks; return first<second?-1:first>second?1:0; })[0] || null;
}
export function compareCohortDelivery(raw) {
  const input = normalizeInput(raw), plan = checkedPlan(input.planDocument), c = checkedReview(input.review);
  if (plan.source.programId !== c.source.programId) fail('COMPARISON_CASE_MISMATCH','Select the adoption plan and frozen cohort from the same original case.','review');
  if (plan.window.tranche !== c.inputs.tranche) fail('COMPARISON_TRANCHE_MISMATCH','Select the original review for the plan’s tranche.','review');
  const cutoff = timestamp(c.window.asOfAt,'review.window.asOfAt');
  const {joins,maps} = buildJoins(plan,c,input.links), issues = [];
  if (plan.source.planContentSha256 !== c.source.planContentSha256) issues.push({code:'PLAN_REVISION_CHANGED',message:'The recorded cohort uses a different pinned plan revision. Both original rules and sources are retained.'});
  if (canonical(plan.rule) !== canonical(c.rule)) issues.push({code:'PROPOSED_RULE_CHANGED',message:'The original proposed rules differ. Target columns preserve each document’s own requirement.'});
  if (plan.window.start !== c.window.start || plan.window.end !== c.window.end) issues.push({code:'WINDOW_CHANGED',message:'The planned and observed UTC windows differ. Dates are aligned as recorded; comparison does not shift either window.'});
  for (const join of joins) if (!join.observedId) issues.push({code:'IDENTITY_UNMATCHED',kind:join.kind,id:join.plannedId,message:'Associate '+join.plannedLabel+' with its original recorded '+join.kind+' to place matching intents.'});
  const schedules = new Map(plan.input.schedules.map(row => [row.id,row]));
  const plannedTargets = [
    ...plan.occurrences.filter(row => row.plannedPaymentRequests > 0).map(row => ({
      id:'occurrence:'+row.id,kind:'OCCURRENCE',sourceId:row.id,label:row.label,scheduleId:row.scheduleId,
      operationId:row.operationId,buyerId:row.buyerId,merchantId:row.merchantId,facilitatorId:row.facilitatorId,
      date:row.date,scheduledAt:row.scheduledAt,plannedCompleteAt:row.plannedCompleteAt,
      paymentKind:row.paymentKind,network:row.network,asset:row.asset,
      plannedPaymentRequests:row.plannedPaymentRequests,plannedPaidPurchases:row.plannedPaidPurchases,
      plannedCompletePurchases:row.plannedCompletePurchases,independentPurchaseOpportunities:row.independentPurchaseOpportunities,
      plannedUsefulTasks:row.scheduledTasks,atomicAmount:row.atomicAmount,sourceOccurrenceIds:[row.id]
    })),
    ...plan.fundingGroups.filter(row => row.plannedPaymentRequests > 0).map(row => ({
      id:'funding:'+row.id,kind:'FUNDING_GROUP',sourceId:row.id,label:row.label,scheduleId:null,
      operationId:row.operationId,buyerId:row.buyerId,merchantId:row.merchantId,facilitatorId:row.facilitatorId,
      date:row.date,scheduledAt:row.date+'T00:00:00Z',plannedCompleteAt:row.firstUsefulResultAt,
      paymentKind:'FUNDED',network:row.network,asset:row.asset,
      plannedPaymentRequests:row.plannedPaymentRequests,plannedPaidPurchases:row.plannedPaidPurchases,
      plannedCompletePurchases:row.plannedCompletePurchases,independentPurchaseOpportunities:row.independentPurchaseOpportunities,
      plannedUsefulTasks:row.scheduledTasks,atomicAmount:row.atomicAmount,sourceOccurrenceIds:row.useOccurrenceIds
    }))
  ];
  const targetMap = new Map(), index = new Map();
  for (const row of plannedTargets) {
    row.observedOperationId=maps.operation.get(row.operationId)||null;
    row.observedBuyerId=maps.buyer.get(row.buyerId)||null;
    row.observedMerchantId=maps.merchant.get(row.merchantId)||null;
    row.observedFacilitatorId=row.facilitatorId ? maps.facilitator.get(row.facilitatorId)||null : null;
    row.dueAtCutoff=!!row.plannedCompleteAt && timestamp(row.plannedCompleteAt,'plannedCompleteAt').ticks<=cutoff.ticks;
    row.intentIds=[]; targetMap.set(row.id,row);
    if (row.observedOperationId && row.observedBuyerId && row.observedMerchantId && (!row.facilitatorId || row.observedFacilitatorId)) {
      const key=canonical([row.observedOperationId,row.observedBuyerId,row.observedMerchantId,row.network]);
      if(!index.has(key))index.set(key,[]); index.get(key).push(row);
    }
  }
  const bindingMap=new Map(c.inputs.bindings.map(row=>[row.purchaseId,row]));
  const observedOperations=new Map(c.inputs.operations.map(row=>[row.id,row]));
  const observationMap=new Map(c.observations.map(row=>[row.purchaseId,row]));
  const assignments=new Map();
  for(const row of input.assignments) {
    if(assignments.has(row.intentId))fail('DUPLICATE_INTENT_ASSIGNMENT','Assign one original intent to one planned payment opportunity.','assignments');
    if(!c.intents.some(intent=>intent.id===row.intentId)||!targetMap.has(row.targetId))fail('UNKNOWN_INTENT_ASSIGNMENT','Select an original intent group and retained planned payment opportunity.','assignments');
    if(!row.note.trim())fail('INTENT_ASSIGNMENT_NOTE_REQUIRED','Describe the source basis for the selected placement.','assignments');
    assignments.set(row.intentId,row);
  }
  const records=[],candidateGroups=new Map();
  for(const intent of c.intents) {
    const bindings=intent.purchaseIds.map(id=>bindingMap.get(id)).filter(Boolean);
    const one=key=>{const values=[...new Set(bindings.map(row=>row[key]).filter(Boolean))];return values.length===1?values[0]:null;};
    const operationId=one('operationId'),buyerDeploymentId=one('buyerDeploymentId'),facilitatorId=one('facilitatorId');
    const merchantDeploymentId=observedOperations.get(operationId)?.merchantDeploymentId||null;
    const assets=[...new Set(intent.purchaseIds.map(id=>observationMap.get(id)?.original?.asset).filter(Boolean))];
    const asset=assets.length===1?assets[0]:null,firstDay=dayOf(intent.firstAttemptAt);
    const candidateGroupId=operationId&&buyerDeploymentId&&merchantDeploymentId
      ?canonical([operationId,buyerDeploymentId,merchantDeploymentId,intent.network,asset,facilitatorId]):null;
    if(candidateGroupId&&!candidateGroups.has(candidateGroupId)){
      const candidates=(index.get(canonical([operationId,buyerDeploymentId,merchantDeploymentId,intent.network]))||[])
        .filter(row=>row.asset===asset && (!row.facilitatorId || row.observedFacilitatorId===facilitatorId));
      const byDate=new Map();for(const row of candidates){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
      candidateGroups.set(candidateGroupId,{id:candidateGroupId,targetIds:candidates.map(row=>row.id),targetSet:new Set(candidates.map(row=>row.id)),byDate});
    }
    const candidateGroup=candidateGroups.get(candidateGroupId),dated=candidateGroup?.byDate.get(firstDay)||[],selected=assignments.get(intent.id);
    // Explicit placement can retain a changed date, but cannot silently assign
    // another customer, operation, network or asset to the opportunity.
    if(selected&&!candidateGroup?.targetSet.has(selected.targetId))
      fail('INTENT_IDENTITY_CONFLICT','The selected opportunity has different participant, operation, facilitator, network or asset identities. Correct its identity associations before placing this intent.','assignments.'+intent.id);
    const target=selected?targetMap.get(selected.targetId):dated.length===1?dated[0]:null;
    const completed=currentCompletion(intent,cutoff);
    const lateness=target&&completed&&target.plannedCompleteAt ? timestamp(completed.completedAt,'completedAt').ticks-timestamp(target.plannedCompleteAt,'plannedCompleteAt').ticks:null;
    const row={
      id:intent.id,intentId:intent.intentId,purchaseIds:copy(intent.purchaseIds),buyerOperatorId:intent.buyerOperatorId,
      buyerDeploymentId,operationId,merchantDeploymentId,facilitatorId,network:intent.network,asset,
      firstAttemptAt:intent.firstAttemptAt,firstAttemptDate:firstDay,
      currentCompletedAt:completed?.completedAt||null,completionDate:completed?dayOf(completed.completedAt):null,
      targetId:target?.id||null,placement:selected?'OPERATOR_ASSIGNMENT':target?'ORIGINAL_IDENTITIES_AND_UTC_DATE':dated.length>1?'AMBIGUOUS_DATE':candidateGroup?.targetIds.length?'DATE_UNMATCHED':'IDENTITY_UNMATCHED',
      candidateGroupId,assignmentNote:selected?.note||'',
      attempted:intent.attempted,settled:intent.settled,inWindow:intent.inWindow,unplaced:intent.unplaced,
      completeInWindow:intent.completeInWindow,independentCompleteInWindow:intent.independentCompleteInWindow,
      grossCompleteInWindow:intent.grossCompleteInWindow,laterCompletion:intent.laterCompletion,
      refundedAfterSettlement:intent.refundedAfterSettlement,cancelledAfterSettlement:intent.cancelledAfterSettlement,
      teamOperated:intent.teamOperated,lateAfterPlan:lateness!==null&&lateness>0n,
      latenessSeconds:lateness===null?null:seconds(lateness),sourceIssues:copy(intent.issues||[]),
      sourceIds:[...new Set(intent.purchaseIds.flatMap(id=>[...(observationMap.get(id)?.original?.sourceIds||[]),...(bindingMap.get(id)?.sourceIds||[])]))]
    };
    records.push(row);if(target)target.intentIds.push(intent.id);
  }
  const recordMap=new Map(records.map(row=>[row.id,row]));
  const rows=plannedTargets.map(target=>{
    const actual=target.intentIds.map(id=>recordMap.get(id));
    const observedIntents=actual.length,complete=count(actual,'completeInWindow'),independent=count(actual,'independentCompleteInWindow');
    return {...target,observedIntents,observedAttempted:count(actual,'attempted'),observedComplete:complete,observedIndependentComplete:independent,
      grossComplete:count(actual,'grossCompleteInWindow'),refunded:count(actual,'refundedAfterSettlement'),
      cancelledAfterSettlement:count(actual,'cancelledAfterSettlement'),lateAfterPlan:count(actual,'lateAfterPlan'),
      completionDelta:complete-target.plannedCompletePurchases,
      remainingDue:target.dueAtCutoff?Math.max(0,target.plannedCompletePurchases-complete):0,
      additionalIntents:Math.max(0,observedIntents-target.plannedPaymentRequests),
      state:!target.observedOperationId||!target.observedBuyerId||!target.observedMerchantId||(target.facilitatorId&&!target.observedFacilitatorId)?'ASSOCIATION_REQUIRED':
        complete>0&&complete>=target.plannedCompletePurchases?'DELIVERED':
        actual.some(row=>row.refundedAfterSettlement||row.cancelledAfterSettlement)?'ADJUSTED':
        actual.some(row=>row.currentCompletedAt&&!row.completeInWindow)?'DELIVERED_OUTSIDE_REVIEW_SCOPE':
        !target.dueAtCutoff?'PLANNED_LATER':target.plannedCompletePurchases===0?'NO_PAID_COMPLETION_PLANNED':actual.length?'IN_PROGRESS':'AWAITING_RECORD',
      note:target.scheduleId?schedules.get(target.scheduleId)?.note||'':''
    };
  });
  const dayMap=new Map();
  function day(date){if(!date)return null;if(!dayMap.has(date))dayMap.set(date,{date,plannedPaymentRequests:0,plannedCompletePurchases:0,plannedUsefulTasks:0,observedIntents:0,completedFromAttempts:0,completedOnDate:0,independentCompletedOnDate:0,lateAfterPlan:0,unmatchedIntents:0});return dayMap.get(date);}
  for(const row of plan.days){const target=day(row.date);target.plannedUsefulTasks=row.scheduledTasks;}
  for(const row of rows){const target=day(row.date);target.plannedPaymentRequests+=row.plannedPaymentRequests;target.plannedCompletePurchases+=row.plannedCompletePurchases;}
  for(const record of records){
    const first=day(record.firstAttemptDate);
    if(first){first.observedIntents++;first.completedFromAttempts+=Number(record.completeInWindow);first.unmatchedIntents+=Number(!record.targetId);}
    const completion=day(record.completionDate);
    if(completion){completion.completedOnDate++;completion.independentCompletedOnDate+=Number(record.independentCompleteInWindow);completion.lateAfterPlan+=Number(record.lateAfterPlan);}
  }
  const operatorMap=new Map();
  function operator(id,label){const key=id||'unassigned';if(!operatorMap.has(key))operatorMap.set(key,{operatorId:id||null,labels:[],plannedBuyerIds:[],observedBuyerIds:[],plannedPaidPurchases:0,plannedIndependentOpportunities:0,observedIntents:0,observedComplete:0,observedIndependentComplete:0,unmatchedIntents:0});const value=operatorMap.get(key);if(label&&!value.labels.includes(label))value.labels.push(label);return value;}
  const deployments=new Map(c.selectedDeployments.map(row=>[row.id,row]));
  const opportunitiesByBuyer=new Map();
  for(const row of rows){if(!opportunitiesByBuyer.has(row.buyerId))opportunitiesByBuyer.set(row.buyerId,[]);opportunitiesByBuyer.get(row.buyerId).push(row);}
  for(const buyer of plan.input.buyers){
    const observed=deployments.get(maps.buyer.get(buyer.id)),row=operator(observed?.operatorId||buyer.operatorId,buyer.label);
    row.plannedBuyerIds.push(buyer.id);if(observed&&!row.observedBuyerIds.includes(observed.id))row.observedBuyerIds.push(observed.id);
    const selected=opportunitiesByBuyer.get(buyer.id)||[];row.plannedPaidPurchases+=sum(selected,'plannedPaidPurchases');row.plannedIndependentOpportunities+=sum(selected,'independentPurchaseOpportunities');
  }
  for(const record of records){const row=operator(record.buyerOperatorId,deployments.get(record.buyerDeploymentId)?.name);row.observedIntents++;row.observedComplete+=Number(record.completeInWindow);row.observedIndependentComplete+=Number(record.independentCompleteInWindow);row.unmatchedIntents+=Number(!record.targetId);if(record.buyerDeploymentId&&!row.observedBuyerIds.includes(record.buyerDeploymentId))row.observedBuyerIds.push(record.buyerDeploymentId);}
  const observedTargets=new Map(c.targets.map(row=>[row.key,row])),plannedTargetMap=new Map(plan.targets.map(row=>[row.key,row]));
  const targets=[...new Set([...plannedTargetMap.keys(),...observedTargets.keys()])].sort().map(key=>{
    const a=observedTargets.get(key),p=plannedTargetMap.get(key);
    return {key,plannedRequirement:p?.expected??null,observedRequirement:a?.expected??null,planned:p?.planned??null,observed:a?.actual??null,observedMet:a?.met??null,delta:delta(a?.actual,p?.planned),planningStatus:p?.status||null};
  });
  const unmatched=records.filter(row=>!row.targetId);
  if(unmatched.length)issues.push({code:'RECORDED_INTENTS_UNMATCHED',message:unmatched.length+' original intent groups remain visible without a planned opportunity. Review identity links and explicit placements.'});
  const summary={
    plannedUsefulTasks:plan.summary.scheduledTasks,plannedPaymentRequests:sum(rows,'plannedPaymentRequests'),plannedPaidPurchases:sum(rows,'plannedPaidPurchases'),
    plannedCompletePurchases:sum(rows,'plannedCompletePurchases'),plannedIndependentOpportunities:sum(rows,'independentPurchaseOpportunities'),
    observedIntents:records.length,observedInWindow:count(records,'inWindow'),observedAttempted:count(records,'attempted'),
    observedComplete:count(records,'completeInWindow'),observedIndependentComplete:count(records,'independentCompleteInWindow'),
    matchedIntents:records.length-unmatched.length,unmatchedIntents:unmatched.length,unplacedIntents:count(records,'unplaced'),
    grossComplete:count(records,'grossCompleteInWindow'),refundedAfterSettlement:count(records,'refundedAfterSettlement'),
    cancelledAfterSettlement:count(records,'cancelledAfterSettlement'),lateAfterPlan:count(records,'lateAfterPlan'),remainingDue:sum(rows,'remainingDue'),
    teamOperatedIntents:count(records,'teamOperated'),nativeReady:c.ready,
    completionDelta:count(records,'completeInWindow')-sum(rows,'plannedCompletePurchases')
  };
  const report = {
    schema:COHORT_DELIVERY_COMPARISON_SCHEMA,engineVersion:1,title:input.title,input,summary,
    source:{programId:plan.source.programId,plan:copy(plan.source),reviewId:input.review.id,reviewVersion:input.review.version,
      measurementSha256:c.source.measurementSha256,previewSha256:c.previewSha256,observed:copy(c.source),
      plannedWindow:copy(plan.window),observedWindow:copy(c.window),nativeMode:input.review.snapshot.program.mode},
    planReport:plan,joins,rows,records,unmatched,candidateGroups:[...candidateGroups.values()].map(({id,targetIds})=>({id,targetIds})),days:[...dayMap.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    operators:[...operatorMap.values()].sort((a,b)=>(a.operatorId||'').localeCompare(b.operatorId||'')),targets,issues,
    nativeMetrics:copy(c.metrics),nativeIssues:copy(c.issues),amounts:copy(c.amounts),outcomes:copy(c.outcomes),products:copy(c.products)
  };
  if(input.commercial!==undefined)report.commercial=cmReconcile(report,input.commercial);
  return report;
}
export function reopenCohortDeliveryComparison(document) {
  if(!document||document.schema!==COHORT_DELIVERY_COMPARISON_SCHEMA||document.engineVersion!==1)
    fail('COMPARISON_DOCUMENT_REQUIRED','Open the complete saved delivery comparison.','document');
  const fresh=compareCohortDelivery(document.input);
  if(canonical(fresh)!==canonical(document))fail('COMPARISON_SOURCE_CHANGED','The saved comparison differs from its retained plan, original review or identity associations. Keep the original file and regenerate from its complete input.','document');
  return fresh;
}
function cell(value) {
  if(value===null||value===undefined)return '';
  let s=typeof value==='object'?JSON.stringify(value):String(value);
  if(/^\s*[=+@]/.test(s)||/^[\t\r\n]/.test(s)||(/^\s*-/.test(s)&&!/^-\d+(?:\.\d+)?$/.test(s)))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
export function exportCohortDeliveryCsv(document) {
  const report=reopenCohortDeliveryComparison(document),rows=[['section','id','date','metric','planned','observed','difference','detail']];
  const add=(section,id,date,metric,planned,observed,difference,detail)=>rows.push([section,id,date,metric,planned,observed,difference,detail]);
  for(const row of report.targets)add('target',row.key,'','target',row.planned,row.observed,row.delta,row);
  for(const row of report.rows)add('opportunity',row.id,row.date,'completed purchases',row.plannedCompletePurchases,row.observedComplete,row.completionDelta,row);
  for(const row of report.records)add('original_intent',row.id,row.firstAttemptDate,'recorded classification',null,row.completeInWindow,null,row);
  for(const row of report.days)add('UTC_date',row.date,row.date,'completions from first attempts',row.plannedCompletePurchases,row.completedFromAttempts,row.completedFromAttempts-row.plannedCompletePurchases,row);
  for(const row of report.operators)add('buyer_operator',row.operatorId,'','independent completions',row.plannedIndependentOpportunities,row.observedIndependentComplete,row.observedIndependentComplete-row.plannedIndependentOpportunities,row);
  for(const row of report.joins)add('identity',row.plannedId,'',row.kind,null,row.observedId,null,row);
  for(const row of report.amounts)add('native_amount',row.network+':'+row.asset,'','amountAtomic',null,row.amountAtomic,null,row);
  for(const row of report.outcomes)add('native_outcome',row.id,dayOf(row.completedAt),'qualifies',null,row.qualifies,null,row);
  for(const row of report.products)add('native_product',row.id,dayOf(row.completedAt),'completeInWindow',null,row.completeInWindow,null,row);
  for(const row of [...report.issues,...report.nativeIssues])add('finding',row.id||row.code,'',row.code,null,null,null,row);
  if(report.commercial){const c=report.commercial;
    for(const key of ['revenue','totalCost','contribution'])add('commercial',c.currency,'',key,c.planned?.[key]??null,c.actual[key==='revenue'?'adjustedRevenue':key],c.differences[key],{currency:c.currency,transactionScope:c.transactionScope,feeTreatment:c.feeTreatment,coverage:c.coverage});
    for(const row of c.assets)add('commercial_asset',row.network+':'+row.asset,'','atomic amount',row.plannedAtomic,row.observedAtomic,row.differenceAtomic,row);
    for(const row of c.opportunities)add('commercial_opportunity',row.id,'','atomic amount',row.plannedAtomic,row.observedAtomic,row.differenceAtomic,row);
    for(const row of c.transactions)add('commercial_transaction',row.id,dayOf(row.settledAt),'valued settlement',null,row.valuedAmount,null,row);
    for(const row of c.costs)add('commercial_cost',row.id,row.originalCost?row.periodEnd:dayOf(row.occurredAt),'recorded cost',null,row.calculatedAmount,null,row);
    for(const row of c.adjustments)add('commercial_adjustment',row.id,dayOf(row.occurredAt),row.kind,null,row.amount,null,row);
    for(const row of c.choices.valuations)add('commercial_valuation',row.network+':'+row.asset,dayOf(row.asOfAt),'whole-unit value',null,row.unitValue,null,row);
    for(const row of c.services)add('commercial_service',row.id,'','known recorded cost',row.plannedCost,row.knownRecordedCost,null,row);
    if(c.originalCostIntake){for(const row of c.originalCostIntake.rows)add('original_cost_balance',row.sourceKey,row.periodEnd,row.unit,row.quantity,row.selectedQuantity,row.unselectedQuantity,row);
      for(const row of c.originalCostIntake.overlaps)add('original_cost_overlap',row.workId,'','distinct cost review',null,row.reviewedDistinctCosts,null,row);}
    for(const row of c.issues)add('commercial_finding',row.id||row.code,'',row.code,null,null,null,row);
  }
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
function htmlTable(headers,rows) { return '<div class="table"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v===null||v===undefined?'—':typeof v==='object'?JSON.stringify(v):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'; }
export function exportCohortDeliveryHtml(document) {
  const r=reopenCohortDeliveryComparison(document),s=r.source;
  const table=htmlTable;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(r.title)+'</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1440px;margin:2rem auto;padding:0 1rem}h1{font-size:1.8rem}h2{font-size:1.2rem;margin-top:2rem}p,td{overflow-wrap:anywhere}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{padding:.6rem;border:1px solid #c4c4c4;text-align:left;vertical-align:top}th{background:#f3f3f3}small{color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:1rem 0}@media print{.table{overflow:visible}body{max-width:none;font-size:10pt}th{break-after:avoid}tr{break-inside:avoid}}</style></head><body>'+
    '<h1>'+esc(r.title)+'</h1><p>'+esc(r.input.planDocument.plan?.name||r.planReport.input.name)+'</p><p>Planned: '+esc(s.plannedWindow.start)+' through '+esc(s.plannedWindow.end)+' UTC. Recorded: '+esc(s.observedWindow.start)+' through '+esc(s.observedWindow.end)+' UTC, observed through '+esc(s.observedWindow.asOfAt)+'.</p>'+
    '<p>Case '+esc(s.programId)+' · '+esc(s.nativeMode)+' · tranche '+esc(s.plannedWindow.tranche)+' · frozen review '+esc(s.reviewId)+'.</p>'+
    '<p>'+esc(r.input.note)+'</p><h2>Delivery overview</h2>'+table(['Measure','Count'],Object.entries(r.summary).map(([k,v])=>[label(k),v]))+
    '<p>Useful tasks and payment opportunities retain their original units. The recorded completion and independence columns use the frozen cohort’s classifications. Each original intent appears once. Current completion dates include later delivered work; cohort completion columns retain the original window. Remaining due is calculated only for matched planned opportunities due by the recorded cutoff.</p>'+
    cmHtml(r)+'<h2>Original proposed targets</h2>'+table(['Target','Plan requirement','Review requirement','Planned','Recorded','Difference','Review met'],r.targets.map(x=>[label(x.key),x.plannedRequirement,x.observedRequirement,x.planned,x.observed,x.delta,x.observedMet]))+
    '<h2>Planned payment opportunities</h2>'+table(['Opportunity / identity','UTC date','Planned completions','Recorded completions','Independent','Due remaining','Late','State','Original intents'],r.rows.map(x=>[x.label+'\n'+x.id,x.date,x.plannedCompletePurchases,x.observedComplete,x.observedIndependentComplete,x.remainingDue,x.lateAfterPlan,label(x.state),x.intentIds]))+
    '<h2>Daily delivery</h2><p>First-attempt columns group the original intent cohort. Delivered-on-date counts current completed outputs on their actual UTC completion date.</p>'+table(['UTC date','Planned purchases','Recorded first attempts','Completed from those attempts','Delivered on date','Independent on date','Unmatched'],r.days.map(x=>[x.date,x.plannedCompletePurchases,x.observedIntents,x.completedFromAttempts,x.completedOnDate,x.independentCompletedOnDate,x.unmatchedIntents]))+
    '<h2>Accountable buyer operators</h2>'+table(['Operator','Names','Planned paid','Planned independent','Recorded intents','Complete','Independent','Unmatched'],r.operators.map(x=>[x.operatorId,x.labels.join('; '),x.plannedPaidPurchases,x.plannedIndependentOpportunities,x.observedIntents,x.observedComplete,x.observedIndependentComplete,x.unmatchedIntents]))+
    '<h2>Original recorded intents</h2>'+table(['Original intent / group','Purchase observations','Operation','First attempt','Current completed output','Placement','Native complete / independent','Refund / cancellation','Source findings'],r.records.map(x=>[String(x.intentId||'Unidentified')+'\n'+x.id,x.purchaseIds,x.operationId,x.firstAttemptAt,x.currentCompletedAt,x.targetId||x.placement,String(x.completeInWindow)+' / '+String(x.independentCompleteInWindow),String(x.refundedAfterSettlement)+' / '+String(x.cancelledAfterSettlement),x.sourceIssues]))+
    '<h2>Selected identity associations</h2>'+table(['Kind','Planned identity','Recorded identity','Basis','Operator note'],r.joins.map(x=>[x.kind,x.plannedLabel+'\n'+x.plannedId,(x.observedLabel||'Unassigned')+'\n'+(x.observedId||''),x.basis,x.note]))+
    '<h2>Original amounts by network and asset</h2>'+table(['Network','Asset','Atomic amount','Settled in window','Native XLM fee stroops','Unknown fees','Unresolved amounts'],r.amounts.map(x=>[x.network,x.asset,x.amountAtomic,x.settledInWindowAtomic,x.knownFeesAtomic,x.unknownFeeTransactions,x.unresolvedAmountTransactions]))+
    '<h2>Recorded outcomes and complete products</h2>'+table(['Kind','Identity','Completed','Qualification / completion','Original detail'],[...r.outcomes.map(x=>[x.kind,x.id,x.completedAt,x.qualifies,x]),...r.products.map(x=>['Parent product',x.id,x.completedAt,x.completeInWindow,x])])+
    '<h2>Source differences and original review findings</h2>'+table(['Finding','Identity','Description'],[...r.issues,...r.nativeIssues].map(x=>[x.code,x.id||'',x.message]))+
    '<details><summary>Complete comparison JSON and original source documents</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details>'+
    '<small>Plan content '+esc(s.plan.planContentSha256)+' · cohort measurement '+esc(s.measurementSha256)+' · original review '+esc(s.previewSha256)+'</small></body></html>\n';
}


// Commercial reconciliation shares the complete original comparison document.
export const COHORT_COMMERCIAL_SCHEMA='stellar-forge.sf47-cohort-commercial.v1';
const cmZero={n:0n,s:0};
function cmDecimal(value,path,signed=false){
  if(typeof value!=='string'||value.length>300||!new RegExp(signed?'^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,30})?$':'^(?:0|[1-9]\\d*)(?:\\.\\d{1,30})?$').test(value))
    fail('COMMERCIAL_DECIMAL_REQUIRED',path+' needs exact ordinary decimal text (up to 30 fractional digits).',path);
  const negative=value[0]==='-',parts=(negative?value.slice(1):value).split('.');
  return {n:BigInt(parts[0]+(parts[1]||''))*(negative?-1n:1n),s:(parts[1]||'').length};
}

function cmExact(value,path,signed=false){
  if(typeof value!=='string'||value.length>2000||!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)||(!signed&&value.startsWith('-')))
    fail('COMMERCIAL_SOURCE_DECIMAL','Retain the complete exact calculated decimal at '+path+'.',path);
  const negative=value[0]==='-',parts=(negative?value.slice(1):value).split('.');
  return {n:BigInt(parts[0]+(parts[1]||''))*(negative?-1n:1n),s:(parts[1]||'').length};
}

function cmText(value){
  if(!value.n)return '0';
  const sign=value.n<0n?'-':'',digits=(value.n<0n?-value.n:value.n).toString().padStart(value.s+1,'0');
  return sign+(value.s?(digits.slice(0,-value.s)+'.'+digits.slice(-value.s)).replace(/0+$/,'').replace(/\.$/,''):digits);
}
const cmAdd=(a,b)=>{const s=Math.max(a.s,b.s);return {n:a.n*10n**BigInt(s-a.s)+b.n*10n**BigInt(s-b.s),s};};
const cmSub=(a,b)=>cmAdd(a,{n:-b.n,s:b.s});
const cmMul=(a,b)=>({n:a.n*b.n,s:a.s+b.s});
const cmSum=rows=>rows.reduce((a,b)=>cmAdd(a,b),cmZero);
function cmAtomic(value,path,nullable=false){
  if(value===null&&nullable)return null;
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,299})$/.test(value))fail('COMMERCIAL_ATOMIC_REQUIRED',path+' must retain canonical atomic integer text.',path);
  return value;
}
function cmFields(value,allowed,path){
  object(value,path);
  for(const key of Object.keys(value))if(!allowed.includes(key))fail('UNKNOWN_COMMERCIAL_FIELD','Unknown '+path+' field '+key+'.',path+'.'+key);
  return value;
}
function cmRequired(value,path,max=2000){
  text(value,path,max);if(!value.trim())fail('COMMERCIAL_SOURCE_REQUIRED',path+' requires its original identity or source basis.',path);return value;
}
function cmNullable(value,path){return value===null||value===undefined||value===''?null:cmText(cmDecimal(value,path));}
function cmKey(network,asset){return JSON.stringify([network,asset]);}
function cmTxKey(network,hash){return JSON.stringify([network,hash.toLowerCase()]);}
function cmNormalize(raw){
  cmFields(raw,['schema','currency','transactionScope','feeTreatment','costCoverage','coverageNote','valuations','costs','adjustments','transactionAllocations','note','originalCosts'],'commercial');
  if(raw.schema!==COHORT_COMMERCIAL_SCHEMA)fail('COMMERCIAL_SCHEMA_REQUIRED','Use '+COHORT_COMMERCIAL_SCHEMA+'.','commercial.schema');
  const currency=cmRequired(raw.currency,'commercial.currency',16);
  if(!/^[A-Z][A-Z0-9._-]{0,15}$/.test(currency))fail('COMMERCIAL_CURRENCY_REQUIRED','Select one explicit reporting currency.','commercial.currency');
  const choose=(value,allowed,path)=>{if(!allowed.includes(value))fail('COMMERCIAL_CHOICE_REQUIRED',path+' must be '+allowed.join(' or ')+'.',path);return value;};
  const valuations=list(raw.valuations||[],'commercial.valuations',1000).map((row,i)=>{
    const path='commercial.valuations.'+i;cmFields(row,['network','asset','atomicDecimals','unitValue','asOfAt','sourceReference'],path);
    if(!Number.isSafeInteger(row.atomicDecimals)||row.atomicDecimals<0||row.atomicDecimals>30)fail('COMMERCIAL_UNIT_REQUIRED','Enter the original asset decimal places (0–30).',path+'.atomicDecimals');
    if(row.asset==='native:XLM'&&row.atomicDecimals!==7)fail('COMMERCIAL_FEE_UNIT','Native XLM retains its seven-decimal stroop unit.',path+'.atomicDecimals');
    const asOfAt=cmRequired(row.asOfAt,path+'.asOfAt',100);timestamp(asOfAt,path+'.asOfAt');
    return {network:cmRequired(row.network,path+'.network',500),asset:cmRequired(row.asset,path+'.asset',500),
      atomicDecimals:row.atomicDecimals,unitValue:cmText(cmDecimal(row.unitValue,path+'.unitValue')),asOfAt,
      sourceReference:cmRequired(row.sourceReference,path+'.sourceReference')};
  });
  if(new Set(valuations.map(row=>cmKey(row.network,row.asset))).size!==valuations.length)fail('DUPLICATE_COMMERCIAL_VALUATION','Keep one selected dated valuation per exact network and asset.','commercial.valuations');
  const costs=unique(list(raw.costs||[],'commercial.costs',10000).map((row,i)=>{
    const path='commercial.costs.'+i;cmFields(row,['id','label','serviceId','costType','amount','activeHours','hourlyCost','occurredAt','sourceReference'],path);
    const costType=choose(row.costType,['SUPPLIER','LABOR','PAYMENT_FEE','OTHER'],path+'.costType');
    const occurredAt=cmRequired(row.occurredAt,path+'.occurredAt',100);timestamp(occurredAt,path+'.occurredAt');
    const amount=cmNullable(row.amount,path+'.amount'),activeHours=cmNullable(row.activeHours,path+'.activeHours'),hourlyCost=cmNullable(row.hourlyCost,path+'.hourlyCost');
    if(costType==='LABOR'&&amount!==null)fail('COMMERCIAL_LABOR_BASIS','Labor is calculated from original active hours and hourly cost; leave amount blank.',path);
    if(costType!=='LABOR'&&(activeHours!==null||hourlyCost!==null))fail('COMMERCIAL_COST_BASIS','Active hours and hourly cost belong to a labor row.',path);
    return {id:cmRequired(row.id,path+'.id',200),label:cmRequired(row.label,path+'.label',500),serviceId:text(row.serviceId||'',path+'.serviceId',700),
      costType,amount,activeHours,hourlyCost,occurredAt,sourceReference:cmRequired(row.sourceReference,path+'.sourceReference')};
  }),'id','commercial.costs');
  const adjustments=unique(list(raw.adjustments||[],'commercial.adjustments',10000).map((row,i)=>{
    const path='commercial.adjustments.'+i;cmFields(row,['id','label','kind','amount','occurredAt','sourceReference','refundCashId','intentIds'],path);
    const kind=choose(row.kind,['REFUND','OTHER_REVENUE'],path+'.kind'),occurredAt=cmRequired(row.occurredAt,path+'.occurredAt',100);timestamp(occurredAt,path+'.occurredAt');
    const refundCashId=text(row.refundCashId||'',path+'.refundCashId',500);
    if(refundCashId&&kind!=='REFUND')fail('COMMERCIAL_REFUND_BASIS','An original refund cash row belongs to a refund adjustment.',path);
    return {id:cmRequired(row.id,path+'.id',200),label:cmRequired(row.label,path+'.label',500),kind,
      amount:cmText(cmDecimal(row.amount,path+'.amount')),occurredAt,sourceReference:cmRequired(row.sourceReference,path+'.sourceReference'),refundCashId,
      intentIds:[...new Set(list(row.intentIds||[],path+'.intentIds',10000).map(id=>cmRequired(id,path+'.intentIds',500)))]};
  }),'id','commercial.adjustments');
  const allocations=list(raw.transactionAllocations||[],'commercial.transactionAllocations',10000).map((row,i)=>{
    const path='commercial.transactionAllocations.'+i;cmFields(row,['network','transactionHash','parts','note'],path);
    const parts=unique(list(row.parts,path+'.parts',10000).map(part=>{
      cmFields(part,['targetId','amountAtomic'],path+'.parts');
      return {targetId:cmRequired(part.targetId,path+'.parts.targetId',700),amountAtomic:cmAtomic(part.amountAtomic,path+'.parts.amountAtomic')};
    }),'targetId',path+'.parts');
    if(!parts.length)fail('COMMERCIAL_ALLOCATION_CONFLICT','Choose the original opportunities funded by this transaction.',path);
    return {network:cmRequired(row.network,path+'.network',500),transactionHash:cmRequired(row.transactionHash,path+'.transactionHash',500),parts,note:cmRequired(row.note,path+'.note')};
  });
  if(new Set(allocations.map(row=>cmTxKey(row.network,row.transactionHash))).size!==allocations.length)fail('COMMERCIAL_ALLOCATION_CONFLICT','Retain one whole allocation per original network/transaction.','commercial.transactionAllocations');
  const costCoverage=choose(raw.costCoverage,['PARTIAL','COMPLETE'],'commercial.costCoverage');
  const coverageNote=text(raw.coverageNote||'','commercial.coverageNote',20000);
  if(costCoverage==='COMPLETE'&&!coverageNote.trim())fail('COMMERCIAL_COVERAGE_NOTE','Describe the source confirming complete selected-window cost coverage.','commercial.coverageNote');
  return {schema:COHORT_COMMERCIAL_SCHEMA,currency,
    transactionScope:choose(raw.transactionScope,['SETTLED_IN_WINDOW','FIRST_ATTEMPT_IN_WINDOW'],'commercial.transactionScope'),
    feeTreatment:choose(raw.feeTreatment,['SEPARATE','INCLUDE_AS_COST'],'commercial.feeTreatment'),costCoverage,coverageNote,
    valuations,costs,adjustments,transactionAllocations:allocations,note:text(raw.note||'','commercial.note',20000),
    ...(Object.hasOwn(raw,'originalCosts')?{originalCosts:ocNormalize(raw.originalCosts)}:{})};
}
export function seedCohortCommercialChoices(document,options={}){
  const report=document?.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?reopenCohortDeliveryComparison(document):compareCohortDelivery(document);
  return cmNormalize({schema:COHORT_COMMERCIAL_SCHEMA,currency:options.currency||report.planReport.currencies[0]?.currency||'USD',
    transactionScope:'SETTLED_IN_WINDOW',feeTreatment:'SEPARATE',costCoverage:'PARTIAL',coverageNote:'',
    valuations:[],costs:[],adjustments:[],transactionAllocations:[],note:''});
}
function cmReconcile(report,choices){
  const c=report.input.review.cohort,plan=report.planReport,cutoff=timestamp(c.window.asOfAt,'review.cohort.window.asOfAt'),issues=[];
  const finding=(code,message,id='')=>issues.push({code,message,id});
  const sourceTxs=list(c.transactions,'review.cohort.transactions',10000),byId=new Map(report.records.map(row=>[row.id,row])),targetMap=new Map(report.rows.map(row=>[row.id,row]));
  const priceMap=new Map(choices.valuations.map(row=>[cmKey(row.network,row.asset),row])),allocationMap=new Map(choices.transactionAllocations.map(row=>[cmTxKey(row.network,row.transactionHash),row]));
  const knownTxs=new Set(),usedAllocations=new Set();
  const value=(atomic,network,asset,fee=false)=>{
    if(atomic===null)return null;const quote=priceMap.get(cmKey(network,asset));
    if(atomic==='0')return cmZero;if(!quote)return null;
    if(fee&&quote.atomicDecimals!==7)fail('COMMERCIAL_FEE_UNIT','Native XLM network fees retain their original seven-decimal stroop unit.','commercial.valuations');
    return cmMul({n:BigInt(atomic),s:quote.atomicDecimals},cmExact(quote.unitValue,'valuation.unitValue'));
  };
  const transactionRows=sourceTxs.map((original,index)=>{
    object(original,'review.cohort.transactions.'+index);
    const key=cmTxKey(cmRequired(original.network,'transaction.network',500),cmRequired(original.transactionHash,'transaction.hash',500));
    if(knownTxs.has(key))fail('COMMERCIAL_SOURCE_CONFLICT','The frozen review repeats a canonical network/transaction. Reopen its original native review.','review.cohort.transactions');
    knownTxs.add(key);
    const asset=cmRequired(original.asset,'transaction.asset',500),amount=cmAtomic(original.amountAtomic,'transaction.amountAtomic',true),fees=cmAtomic(original.feesAtomic,'transaction.feesAtomic',true);
    const groupIds=list(original.groupIds,'transaction.groupIds',10000);
    const candidateIds=[...new Set(groupIds.map(id=>byId.get(id)?.targetId).filter(Boolean))].filter(id=>{const row=targetMap.get(id);return row.network===original.network&&row.asset===asset;});
    let parts=[],allocationBasis='UNASSIGNED',allocationNote='',selected=allocationMap.get(key);
    if(selected){
      usedAllocations.add(key);
      if(amount===null||selected.parts.some(row=>!candidateIds.includes(row.targetId))||selected.parts.reduce((n,row)=>n+BigInt(row.amountAtomic),0n)!==BigInt(amount))
        fail('COMMERCIAL_ALLOCATION_CONFLICT','Allocate the complete original known amount across its placed matching opportunities. The parts must equal that transaction exactly.','commercial.transactionAllocations.'+index);
      parts=copy(selected.parts);allocationBasis='OPERATOR_ALLOCATION';allocationNote=selected.note;
    }else if(candidateIds.length===1&&groupIds.every(id=>byId.get(id)?.targetId===candidateIds[0])){
      parts=[{targetId:candidateIds[0],amountAtomic:amount}];allocationBasis='ORIGINAL_INTENT_PLACEMENT';
    }
    const included=choices.transactionScope==='SETTLED_IN_WINDOW'?original.settlesInWindow===true:original.firstAttemptInWindow===true;
    const observedValue=value(amount,original.network,asset),feeValue=value(fees,original.network,'native:XLM',true);
    if(included&&amount===null)finding('SETTLEMENT_AMOUNT_UNRESOLVED','The original transaction has an unresolved quantity; known subtotals remain separate.',key);
    if(included&&amount!=='0'&&observedValue===null&&amount!==null)finding('ASSET_VALUATION_REQUIRED','Enter a dated '+choices.currency+' value and original decimal unit for '+original.network+' / '+asset+'.',key);
    if(included&&(!parts.length||parts.some(row=>row.amountAtomic===null)))finding('PAYMENT_ALLOCATION_REQUIRED','Place the original intent or allocate its shared transaction across the retained original opportunities.',key);
    return {id:key,network:original.network,asset,transactionHash:original.transactionHash,amountAtomic:amount,feesAtomic:fees,
      settledAt:original.settledAt,settlesInWindow:original.settlesInWindow,firstAttemptInWindow:original.firstAttemptInWindow,
      included,purchaseIds:copy(original.purchaseIds),groupIds:copy(groupIds),sourceIds:copy(original.sourceIds||[]),
      candidateTargetIds:candidateIds,parts,allocationBasis,allocationNote,
      valuedAmount:observedValue===null?null:cmText(observedValue),valuedNetworkFee:feeValue===null?null:cmText(feeValue),
      valuation:copy(priceMap.get(cmKey(original.network,asset))||null),networkFeeValuation:copy(priceMap.get(cmKey(original.network,'native:XLM'))||null),
      original:copy(original)};
  });
  for(const [key]of allocationMap)if(!usedAllocations.has(key))fail('COMMERCIAL_ALLOCATION_CONFLICT','The selected transaction is absent from this original frozen review.',key);
  const selected=transactionRows.filter(row=>row.included),plannedAssets=new Map(plan.assets.map(row=>[cmKey(row.network,row.asset),row])),assetGroups=new Map();
  for(const row of selected){const key=cmKey(row.network,row.asset);if(!assetGroups.has(key))assetGroups.set(key,[]);assetGroups.get(key).push(row);}
  const assets=[...new Set([...plannedAssets.keys(),...assetGroups.keys()])].sort().map(key=>{
    const p=plannedAssets.get(key),rows=assetGroups.get(key)||[],basis=p||rows[0],unresolved=rows.filter(x=>x.amountAtomic===null).length;
    const known=rows.reduce((n,x)=>n+BigInt(x.amountAtomic||'0'),0n).toString(),actual=unresolved?null:known,planned=p?.atomicAmount??(p?null:'0');
    return {network:basis.network,asset:basis.asset,plannedAtomic:planned,knownPlannedAtomic:p?.knownAtomicAmount??planned,
      observedAtomic:actual,knownObservedAtomic:known,differenceAtomic:planned===null||actual===null?null:(BigInt(actual)-BigInt(planned)).toString(),
      transactions:rows.length,unresolvedTransactions:unresolved,unpricedPaymentRequests:p?.unpricedPaymentRequests||0,
      selectedValue:rows.some(row=>row.valuedAmount===null)?null:cmText(cmSum(rows.map(row=>cmExact(row.valuedAmount,'valuedAmount')))),
      valuation:copy(priceMap.get(key)||null)};
  });
  const opportunities=report.rows.map(row=>{
    const allocations=selected.flatMap(tx=>tx.parts.filter(part=>part.targetId===row.id).map(part=>({transactionId:tx.id,amountAtomic:part.amountAtomic})));
    const pending=selected.filter(tx=>!tx.parts.length&&tx.candidateTargetIds.includes(row.id));
    const unresolved=allocations.some(part=>part.amountAtomic===null)||pending.length>0;
    const observed=unresolved?null:allocations.reduce((n,part)=>n+BigInt(part.amountAtomic),0n).toString();
    return {id:row.id,label:row.label,network:row.network,asset:row.asset,fundingGroupId:row.kind==='FUNDING_GROUP'?row.sourceId:null,
      sourceOccurrenceIds:copy(row.sourceOccurrenceIds),plannedAtomic:row.atomicAmount,observedAtomic:observed,
      differenceAtomic:row.atomicAmount===null||observed===null?null:(BigInt(observed)-BigInt(row.atomicAmount)).toString(),
      allocations,unresolvedTransactionIds:pending.map(tx=>tx.id),intentIds:copy(row.intentIds)};
  });
  const serviceMap=new Map((plan.servicePricing||[]).map(row=>[row.id,row]));
  const inPeriod=(at,path)=>{
    const start=c.window.start,end=c.window.end;
    if(typeof start!=='string'||typeof end!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
      fail('COMMERCIAL_CLOCK_CONFLICT','Select an original frozen cohort review with its complete recorded window before entering actual costs or adjustments.',path);
    timestamp(start+'T00:00:00Z','review.cohort.window.start');
    timestamp(end+'T00:00:00Z','review.cohort.window.end');
    const clock=timestamp(at,path);if(clock.ticks>cutoff.ticks||clock.day<start||clock.day>end)
      fail('COMMERCIAL_CLOCK_CONFLICT','Use an actual cost or adjustment inside the original recorded window and cutoff.',path);
  };
  const costs=choices.costs.map(row=>{
    inPeriod(row.occurredAt,'commercial.costs.'+row.id+'.occurredAt');
    if(row.serviceId&&!serviceMap.has(row.serviceId))fail('COMMERCIAL_COST_SOURCE_CHANGED','Select the original complete service-cost component from this plan.','commercial.costs.'+row.id+'.serviceId');
    const amount=row.costType==='LABOR'?(row.activeHours===null||row.hourlyCost===null?null:cmText(cmMul(cmExact(row.activeHours,'activeHours'),cmExact(row.hourlyCost,'hourlyCost')))):row.amount;
    return {...copy(row),calculatedAmount:amount,service:row.serviceId?copy(serviceMap.get(row.serviceId)):null};
  });
  const originalCostIntake=ocCompile(report,choices,serviceMap);
  if(originalCostIntake){
    const ids=new Set(costs.map(row=>row.id));
    for(const row of originalCostIntake.costs){if(ids.has(row.id))fail('COMMERCIAL_ORIGINAL_IDENTITY','Keep manual and original-source cost row identities distinct.',row.id);ids.add(row.id);costs.push(row);}
    if(originalCostIntake.unreviewedOverlaps.length)finding('ORIGINAL_WORK_INVOICE_OVERLAP','Review linked Work and invoice costs: remove a duplicated selection or record the actual source showing that both are distinct costs. Complete cost remains unspecified.');
  }
  const refundCash=list(c.refundCash||[],'review.cohort.refundCash',10000),refundMap=new Map(refundCash.map(row=>[row.id,row])),joinedRefunds=new Set();
  const joinedRefundIntents=new Set(),selectedGroupIds=new Set(selected.flatMap(row=>row.groupIds));
  const adjustments=choices.adjustments.map(row=>{
    for(const id of row.intentIds){if(row.kind!=='REFUND'||!byId.get(id)?.refundedAfterSettlement||!selectedGroupIds.has(id)||joinedRefundIntents.has(id))fail('COMMERCIAL_REFUND_SOURCE_CHANGED','Associate each selected original refunded intent with one actual refund amount.',id);joinedRefundIntents.add(id);}
    inPeriod(row.occurredAt,'commercial.adjustments.'+row.id+'.occurredAt');let originalRefund=null;
    if(row.refundCashId){
      originalRefund=refundMap.get(row.refundCashId);
      if(!originalRefund||originalRefund.state==='VOID'||joinedRefunds.has(row.refundCashId))fail('COMMERCIAL_REFUND_SOURCE_CHANGED','Select each retained original refund cash row at most once.','commercial.adjustments.'+row.id);
      joinedRefunds.add(row.refundCashId);
      if(originalRefund.inWindow!==true||originalRefund.atCutoff!==true)fail('COMMERCIAL_CLOCK_CONFLICT','The selected original refund is outside this recorded window or cutoff.','commercial.adjustments.'+row.id);
      if(originalRefund.currency===choices.currency&&originalRefund.amount!==null&&originalRefund.amount!==undefined&&cmText(cmExact(String(originalRefund.amount),'originalRefund.amount'))!==row.amount)
        fail('COMMERCIAL_REFUND_SOURCE_CHANGED','The entered refund value differs from its original same-currency cash amount.','commercial.adjustments.'+row.id);
    }
    return {...copy(row),originalRefund:copy(originalRefund)};
  });
  const unreviewedRefundIntents=report.records.filter(row=>row.refundedAfterSettlement&&selectedGroupIds.has(row.id)&&!joinedRefundIntents.has(row.id));
  const unreviewedRefunds=refundCash.filter(row=>row.inWindow&&row.atCutoff&&row.state!=='VOID'&&!joinedRefunds.has(row.id));
  if(unreviewedRefundIntents.length)finding('REFUNDED_INTENT_VALUE_REQUIRED','Associate '+unreviewedRefundIntents.length+' original refunded intents with their source-backed refund values. Adjusted contribution remains incomplete.');
  if(unreviewedRefunds.length)finding('REFUND_RECONCILIATION_REQUIRED','Review '+unreviewedRefunds.length+' original refund cash rows and record their selected-currency values. Adjusted contribution remains incomplete.');
  const paymentUnknown=selected.filter(row=>row.valuedAmount===null).length,feeUnknown=selected.filter(row=>row.valuedNetworkFee===null).length,costUnknown=costs.filter(row=>row.calculatedAmount===null).length;
  const knownPayments=cmSum(selected.filter(row=>row.valuedAmount!==null).map(row=>cmExact(row.valuedAmount,'valuedAmount')));
  const knownFees=cmSum(selected.filter(row=>row.valuedNetworkFee!==null).map(row=>cmExact(row.valuedNetworkFee,'valuedNetworkFee')));
  const knownCosts=cmSum(costs.filter(row=>row.calculatedAmount!==null).map(row=>cmExact(row.calculatedAmount,'cost')));
  const refunds=cmSum(adjustments.filter(row=>row.kind==='REFUND').map(row=>cmExact(row.amount,'refund')));
  const otherRevenue=cmSum(adjustments.filter(row=>row.kind==='OTHER_REVENUE').map(row=>cmExact(row.amount,'otherRevenue')));
  const costComplete=choices.costCoverage==='COMPLETE'&&!costUnknown&&(choices.feeTreatment==='SEPARATE'||!feeUnknown)&&!originalCostIntake?.unreviewedOverlaps.length;
  const costTotal=cmAdd(knownCosts,choices.feeTreatment==='INCLUDE_AS_COST'?knownFees:cmZero),net=cmAdd(cmSub(knownPayments,refunds),otherRevenue);
  const baseline=plan.currencies.find(row=>row.currency===choices.currency)||null;
  const actual={grossSettlementValue:paymentUnknown?null:cmText(knownPayments),refunds:cmText(refunds),otherRevenue:cmText(otherRevenue),
    adjustedRevenue:paymentUnknown||unreviewedRefunds.length||unreviewedRefundIntents.length?null:cmText(net),
    networkFeeValue:feeUnknown?null:cmText(knownFees),recordedCost:costUnknown?null:cmText(knownCosts),
    totalCost:costComplete?cmText(costTotal):null,
    contribution:paymentUnknown||unreviewedRefunds.length||unreviewedRefundIntents.length||!costComplete?null:cmText(cmSub(net,costTotal))};
  const differences={};for(const [key,actualKey]of [['revenue','adjustedRevenue'],['totalCost','totalCost'],['contribution','contribution']])
    differences[key]=baseline?.[key]===null||baseline?.[key]===undefined||actual[actualKey]===null?null:cmText(cmSub(cmExact(actual[actualKey],'actual',true),cmExact(baseline[key],'planned',true)));
  if(choices.costCoverage==='PARTIAL')finding('COST_COVERAGE_PARTIAL','Record the remaining costs and source basis for complete coverage to calculate the full contribution.');
  if(costUnknown)finding('RECORDED_COST_UNRESOLVED','Complete '+costUnknown+' original cost amounts or labor terms.');
  if(choices.feeTreatment==='INCLUDE_AS_COST'&&feeUnknown)finding('NETWORK_FEE_VALUE_UNRESOLVED','Retain original unknown fees and add exact native:XLM valuations before treating network fees as a complete cost.');
  if(!baseline)finding('PLANNED_CURRENCY_UNAVAILABLE','The selected plan has no '+choices.currency+' commercial baseline. Complete planned values remain in its original currency rows.');
  const services=(plan.servicePricing||[]).map(service=>{
    const rows=costs.filter(row=>row.serviceId===service.id);
    return {id:service.id,label:service.label,scheduleIds:copy(service.scheduleIds),fundingGroupIds:copy(service.fundingGroupIds||[]),
      currency:service.currency,plannedCost:service.totalCost,plannedRevenue:service.revenue,
      recordedCostIds:rows.map(row=>row.id),knownRecordedCost:cmText(cmSum(rows.filter(row=>row.calculatedAmount!==null).map(row=>cmExact(row.calculatedAmount,'cost')))),
      unresolvedCosts:rows.filter(row=>row.calculatedAmount===null).length,
      note:'Original complete service component; each recorded cost enters the whole reconciliation once. Individual component coverage is not inferred from a whole-case declaration.'};
  });
  return {schema:'stellar-forge.sf47-cohort-commercial-report.v1',currency:choices.currency,transactionScope:choices.transactionScope,feeTreatment:choices.feeTreatment,
    window:copy(c.window),choices:copy(choices),planned:copy(baseline),plannedCurrencies:copy(plan.currencies),actual,differences,
    knownSubtotals:{grossSettlementValue:cmText(knownPayments),networkFeeValue:cmText(knownFees),recordedCost:cmText(knownCosts),totalCost:cmText(costTotal)},
    coverage:{costCoverage:choices.costCoverage,costCoverageNote:choices.coverageNote,unvaluedTransactions:paymentUnknown,
      unvaluedFeeTransactions:feeUnknown,unresolvedCosts:costUnknown,unreviewedRefundCashIds:unreviewedRefunds.map(row=>row.id),unreviewedRefundIntentIds:unreviewedRefundIntents.map(row=>row.id),
      unallocatedTransactionIds:selected.filter(row=>!row.parts.length).map(row=>row.id)},
    assets,opportunities,transactions:transactionRows,costs,adjustments,originalRefundCash:copy(refundCash),services,issues,note:choices.note,
    ...(originalCostIntake?{originalCostIntake}: {})};
}
function cmHtml(report){
  const r=report.commercial;if(!r)return '';
  const t=htmlTable;
  return '<h2>Commercial reconciliation</h2><p>'+esc(r.currency)+' · '+esc(r.transactionScope)+' · network fees '+esc(r.feeTreatment)+'. Values use the explicitly selected dated asset valuations. The complete plan remains its original prospective baseline; the recorded cutoff and source windows remain visible.</p>'+
    t(['Measure','Planned','Recorded / valued','Difference'],[['Revenue',r.planned?.revenue,r.actual.adjustedRevenue,r.differences.revenue],['Total cost',r.planned?.totalCost,r.actual.totalCost,r.differences.totalCost],['Contribution',r.planned?.contribution,r.actual.contribution,r.differences.contribution]])+
    t(['Recorded measure','Value'],Object.entries(r.actual))+
    '<h3>Payment amounts by exact network and asset</h3>'+t(['Network','Asset','Planned atomic','Recorded atomic','Difference','Known recorded subtotal'],r.assets.map(row=>[row.network,row.asset,row.plannedAtomic,row.observedAtomic,row.differenceAtomic,row.knownObservedAtomic]))+
    '<h3>Original payment opportunities</h3>'+t(['Opportunity','Funding group','Planned atomic','Allocated atomic','Difference','Unresolved transactions'],r.opportunities.map(row=>[row.label+' / '+row.id,row.fundingGroupId,row.plannedAtomic,row.observedAtomic,row.differenceAtomic,row.unresolvedTransactionIds]))+
    '<h3>Dated valuation sources</h3>'+t(['Network','Asset','Decimal places','Value per whole unit','As of','Original source'],r.choices.valuations.map(row=>[row.network,row.asset,row.atomicDecimals,row.unitValue,row.asOfAt,row.sourceReference]))+
    '<h3>Original transactions and allocation</h3>'+t(['Network / transaction','Amount atomic','Fee stroops','Included','Valued amount','Original intents','Allocations','Basis'],r.transactions.map(row=>[row.network+' / '+row.transactionHash,row.amountAtomic,row.feesAtomic,row.included,row.valuedAmount,row.groupIds,row.parts,row.allocationBasis+' '+row.allocationNote]))+
    '<h3>Recorded service costs</h3>'+t(['Original cost','Service component','Kind','Occurred','Amount','Active hours','Hourly cost','Original source'],r.costs.map(row=>[row.label+' / '+row.id,row.serviceId,row.costType,row.occurredAt,row.calculatedAmount,row.activeHours,row.hourlyCost,row.sourceReference]))+
    ocHtml(r)+'<h3>Original shared service components</h3>'+t(['Service','Funding groups','Planned currency / cost','Recorded currency / known cost','Original cost rows'],r.services.map(row=>[row.label,row.fundingGroupIds,row.currency+' / '+row.plannedCost,r.currency+' / '+row.knownRecordedCost,row.recordedCostIds]))+
    '<h3>Refunds and revenue adjustments</h3>'+t(['Original adjustment','Kind','Value','Occurred','Original refund cash','Source'],r.adjustments.map(row=>[row.label,row.kind,row.amount,row.occurredAt,row.refundCashId,row.sourceReference]))+
    '<h3>Commercial coverage and findings</h3><p>'+esc(r.choices.coverageNote)+'</p>'+t(['Finding','Source','Action'],r.issues.map(row=>[row.code,row.id,row.message]))+
    '<details><summary>Complete commercial sources, known subtotals and original refund cash</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details>';
}


export const COHORT_ORIGINAL_COSTS_SCHEMA='stellar-forge.sf47-cohort-original-costs.v1';
function ocDay(value,path){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('COMMERCIAL_ORIGINAL_PERIOD','Select an explicit original UTC civil date.',path);
  timestamp(value+'T00:00:00Z',path);return value;
}
function ocInput(document){
  const raw=document?.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?document.input:document;
  const input=normalizeInput(raw);checkedReview(input.review);checkedPlan(input.planDocument);return input;
}
function ocSourceKey(kind,id,lineId=''){return JSON.stringify([kind,id,lineId]);}
function ocCatalog(input){
  const review=input.review,records=review.snapshot.records;
  if(!records||!Array.isArray(records.work)||!Array.isArray(records.invoices)||!Array.isArray(records.contributors))
    fail('COMMERCIAL_ORIGINAL_RECORDS_REQUIRED','Select the complete native frozen review with its original Work, supplier invoices and contributor records.','review.snapshot.records');
  const work=unique(list(records.work,'original work',10000),'id','original work');
  const invoices=unique(list(records.invoices,'original invoices',10000),'id','original invoices');
  const contributors=new Map(unique(list(records.contributors,'original contributors',10000),'id','original contributors').map(row=>[row.id,row]));
  const sourceMap=new Map(unique(list(review.snapshot.sources,'original sources',10000),'id','original sources').map(row=>[row.id,row]));
  const workMap=new Map(work.map(row=>[row.id,row])),rows=[];
  function source(record,linked=[]){
    const contributor=contributors.get(record.contributorId)||null;
    const sourceIds=[...new Set([record,contributor,...linked].filter(Boolean).flatMap(row=>row.sourceIds||[]))].sort();
    return {record:copy(record),contributor:copy(contributor),linkedWork:copy(linked),
      attachments:sourceIds.map(id=>copy(sourceMap.get(id)||{id,missing:true}))};
  }
  for(const row of work){
    const start=ocDay(row.startDate,'work.startDate'),end=ocDay(row.endDate,'work.endDate');
    if(start>end)fail('COMMERCIAL_ORIGINAL_PERIOD','The original Work interval is reversed.',row.id);
    rows.push({sourceKey:ocSourceKey('WORK',row.id),kind:'WORK',recordId:row.id,lineId:'',
      label:row.description,contributorId:row.contributorId,contributorName:contributors.get(row.contributorId)?.name||row.contributorId,
      state:row.state,costId:row.costId||'',fundingBasis:row.fundingBasis||'',unit:'HOURS',
      quantity:cmText(cmExact(row.hours,'original recorded hours')),periodStart:start,periodEnd:end,workIds:[row.id],source:source(row)});
  }
  for(const row of invoices){
    if(row.currency!=='USD')fail('COMMERCIAL_ORIGINAL_CURRENCY','Original supplier invoice lines retain their native USD liability. Select the complete native invoice record.',row.id);
    const day=ocDay(row.issuedDate,'invoice.issuedDate');
    for(const line of unique(list(row.lines,'original invoice lines',200),'id','original invoice lines')){
      const ids=list(line.workIds||[],'invoice linked work',10000),linked=ids.map(id=>workMap.get(id)||{id,missing:true});
      rows.push({sourceKey:ocSourceKey('INVOICE_LINE',row.id,line.id),kind:'INVOICE_LINE',recordId:row.id,lineId:line.id,
        label:row.number+' / '+line.description,contributorId:row.contributorId,contributorName:contributors.get(row.contributorId)?.name||row.contributorId,
        state:row.state,costId:line.costId||'',fundingBasis:'',unit:'USD',
        quantity:cmText(cmExact(line.amountUsd,'original invoice line amount')),periodStart:day,periodEnd:day,workIds:copy(ids),source:source(row,linked)});
    }
  }
  return {schema:'stellar-forge.sf47-cohort-original-cost-catalog.v1',reviewId:review.id,businessSha256:review.businessSha256,
    programId:review.snapshot.program.id,window:copy(review.cohort.window),rows,
    note:'Work quantities are original recorded hours. Invoice quantities are original USD liabilities. Original source states and civil dates do not imply paid cash or accepted customer work.'};
}
export function inspectCohortOriginalCosts(document){
  const input=ocInput(document),catalog=ocCatalog(input),selection=input.commercial?.originalCosts?
    ocNormalize(input.commercial.originalCosts):{schema:COHORT_ORIGINAL_COSTS_SCHEMA,selections:[],overlapReviews:[],note:''};
  const originals=new Map(catalog.rows.map(row=>[row.sourceKey,row]));
  return {...catalog,selection:copy(selection),sourceReviews:selection.selections.map(row=>{
    const current=originals.get(row.sourceKey)||null;
    return {selectionId:row.id,sourceKey:row.sourceKey,status:!current?'MISSING':canonical(row.source)===canonical(current.source)?'UNCHANGED':'CHANGED',
      retainedSource:copy(row.source),currentSource:current?copy(current.source):null};
  })};
}
function ocNormalize(raw){
  cmFields(raw,['schema','selections','overlapReviews','note'],'commercial.originalCosts');
  if(raw.schema!==COHORT_ORIGINAL_COSTS_SCHEMA)fail('COMMERCIAL_ORIGINAL_SCHEMA','Use '+COHORT_ORIGINAL_COSTS_SCHEMA+'.','commercial.originalCosts');
  const selections=unique(list(raw.selections||[],'original cost selections',10000).map((row,i)=>{
    const p='commercial.originalCosts.selections.'+i;
    cmFields(row,['id','sourceKey','serviceId','quantity','unitCost','valuationAt','valuationSource','periodStart','periodEnd','allocationNote','source'],p);
    const quantity=cmText(cmDecimal(row.quantity,p+'.quantity'));
    if(quantity==='0')fail('COMMERCIAL_ORIGINAL_QUANTITY','Select a positive portion of the original Work or invoice line.',p);
    const valuationAt=text(row.valuationAt||'',p+'.valuationAt',100);if(valuationAt)timestamp(valuationAt,p+'.valuationAt');
    const start=ocDay(row.periodStart,p+'.periodStart'),end=ocDay(row.periodEnd,p+'.periodEnd');
    if(start>end)fail('COMMERCIAL_ORIGINAL_PERIOD','The selected cost interval must be in date order.',p);
    return {id:cmRequired(row.id,p+'.id',200),sourceKey:cmRequired(row.sourceKey,p+'.sourceKey',1000),
      serviceId:text(row.serviceId||'',p+'.serviceId',700),quantity,unitCost:cmNullable(row.unitCost,p+'.unitCost'),
      valuationAt,valuationSource:text(row.valuationSource||'',p+'.valuationSource',20000),
      periodStart:start,periodEnd:end,allocationNote:cmRequired(row.allocationNote,p+'.allocationNote',20000),
      source:jsonSource(row.source,p+'.source')};
  }),'id','original cost selections');
  const overlapReviews=list(raw.overlapReviews||[],'original overlap reviews',10000).map((row,i)=>{
    const p='commercial.originalCosts.overlapReviews.'+i;cmFields(row,['workId','invoiceId','lineId','note'],p);
    return {workId:cmRequired(row.workId,p+'.workId',500),invoiceId:cmRequired(row.invoiceId,p+'.invoiceId',500),
      lineId:cmRequired(row.lineId,p+'.lineId',200),note:cmRequired(row.note,p+'.note',20000)};
  });
  const keys=overlapReviews.map(x=>JSON.stringify([x.workId,x.invoiceId,x.lineId]));
  if(new Set(keys).size!==keys.length)fail('COMMERCIAL_ORIGINAL_OVERLAP','Keep one explicit review for each original Work/invoice-line association.','commercial.originalCosts.overlapReviews');
  return {schema:COHORT_ORIGINAL_COSTS_SCHEMA,selections,overlapReviews,note:text(raw.note||'','commercial.originalCosts.note',20000)};
}
export function selectCohortOriginalCosts(document,selection){
  cmFields(selection,['selections','overlapReviews','note','acceptSourceIds'],'original cost intake');
  const input=ocInput(document),catalog=ocCatalog(input),rows=new Map(catalog.rows.map(row=>[row.sourceKey,row]));
  if(!input.commercial)input.commercial=seedCohortCommercialChoices(input);
  const accepted=list(selection.acceptSourceIds||[],'reviewed original selection IDs',10000);
  if(accepted.some(id=>typeof id!=='string')||new Set(accepted).size!==accepted.length)
    fail('COMMERCIAL_ORIGINAL_SOURCE_CHANGED','Select each explicit original-source acceptance once.','original cost intake.acceptSourceIds');
  const selections=list(selection.selections,'original cost selection',10000).map((row,i)=>{
    cmFields(row,['id','sourceKey','serviceId','quantity','unitCost','valuationAt','valuationSource','periodStart','periodEnd','allocationNote','source'],'original cost selection.'+i);
    const existing=input.commercial.originalCosts?.selections?.find(previous=>previous.id===row.id);
    const retain=Object.hasOwn(row,'source')?row.source:existing?.source;
    if(retain!==undefined&&!accepted.includes(row.id))return {...copy(row),source:copy(retain)};
    const original=rows.get(row.sourceKey);
    if(!original)fail('COMMERCIAL_ORIGINAL_SOURCE_CHANGED','Select an existing original Work or invoice line from the complete frozen review.','original cost selection.'+i);
    return {...copy(row),source:copy(original.source)};
  });
  if(accepted.some(id=>!selections.some(row=>row.id===id)))
    fail('COMMERCIAL_ORIGINAL_SOURCE_CHANGED','Accept the source only for a retained selection.','original cost intake.acceptSourceIds');
  input.commercial.originalCosts=ocNormalize({schema:COHORT_ORIGINAL_COSTS_SCHEMA,selections,
    overlapReviews:selection.overlapReviews||[],note:selection.note||''});
  return input;
}
export function receiveCohortOriginalCosts(document,selection){
  return compareCohortDelivery(selectCohortOriginalCosts(document,selection));
}
function ocCompile(report,choices,serviceMap){
  const selection=choices.originalCosts;if(!selection)return null;
  const catalog=ocCatalog(report.input),map=new Map(catalog.rows.map(row=>[row.sourceKey,row]));
  const window=catalog.window,start=ocDay(window.start,'original cohort start'),end=ocDay(window.end,'original cohort end');
  const cutoff=timestamp(window.asOfAt,'original cutoff').day,used=new Map(),costs=[];
  for(const row of selection.selections){
    const original=map.get(row.sourceKey),path='commercial.originalCosts.selections.'+row.id;
    if(!original||canonical(original.source)!==canonical(row.source))
      fail('COMMERCIAL_ORIGINAL_SOURCE_CHANGED','The original Work, invoice, linked Work, contributor or source metadata changed. Inspect the complete current record and explicitly receive the reviewed selection again.',path);
    if(original.state==='VOID'||!original.source.contributor||original.source.attachments.some(x=>x.missing)||original.source.linkedWork.some(x=>x.missing))
      fail('COMMERCIAL_ORIGINAL_SOURCE_CHANGED','Select a retained, non-void original cost with its complete contributor and source context.',path);
    if(row.serviceId&&!serviceMap.has(row.serviceId))fail('COMMERCIAL_COST_SOURCE_CHANGED','Select the complete original shared service component.',path+'.serviceId');
    if(row.periodStart<original.periodStart||row.periodEnd>original.periodEnd||
       row.periodStart<start||row.periodEnd>end||row.periodEnd>cutoff||
       (original.kind==='INVOICE_LINE'&&(row.periodStart!==original.periodStart||row.periodEnd!==original.periodEnd)))
      fail('COMMERCIAL_ORIGINAL_PERIOD','Keep selected Work portions within their original interval, review window and cutoff date. Invoice lines retain their original issue date.',path);
    const q=cmExact(row.quantity,'selected quantity'),total=cmAdd(used.get(row.sourceKey)||cmZero,q);
    if(cmSub(total,cmExact(original.quantity,'original quantity')).n>0n)
      fail('COMMERCIAL_ORIGINAL_QUANTITY','The complete selected portions exceed this original Work hours or invoice-line USD amount.',path+'.quantity');
    used.set(row.sourceKey,total);
    let rate=row.unitCost;
    if(original.kind==='INVOICE_LINE'&&choices.currency==='USD'){
      if(rate!==null&&cmText(cmExact(rate,'unit cost'))!=='1')fail('COMMERCIAL_ORIGINAL_VALUATION','An original USD invoice amount retains a USD-per-USD rate of one.',path+'.unitCost');
      rate='1';
    }else if(rate!==null&&(!row.valuationAt||!row.valuationSource.trim()))
      fail('COMMERCIAL_ORIGINAL_VALUATION','Retain the actual dated source for the hourly cost or reporting-currency value per original USD.',path);
    const amount=rate===null?null:cmText(cmMul(q,cmExact(rate,'unit cost')));
    costs.push({id:'original:'+row.id,label:original.label,serviceId:row.serviceId,costType:original.kind==='WORK'?'LABOR':'SUPPLIER',
      amount:original.kind==='WORK'?null:amount,activeHours:original.kind==='WORK'?row.quantity:null,hourlyCost:original.kind==='WORK'?rate:null,
      occurredAt:row.periodEnd,periodStart:row.periodStart,periodEnd:row.periodEnd,dateBasis:original.kind==='WORK'?'ENTERED_PORTION_OF_ORIGINAL_WORK_INTERVAL':'ORIGINAL_INVOICE_ISSUE_DATE',
      sourceReference:row.allocationNote,calculatedAmount:amount,service:row.serviceId?copy(serviceMap.get(row.serviceId)):null,
      originalCost:{selectionId:row.id,sourceKey:row.sourceKey,kind:original.kind,recordId:original.recordId,lineId:original.lineId,
        unit:original.unit,quantity:row.quantity,unitCost:rate,valuationAt:row.valuationAt,valuationSource:row.valuationSource,
        state:original.state,contributorId:original.contributorId,contributorName:original.contributorName,workIds:copy(original.workIds),source:copy(row.source)}});
  }
  const reviews=new Map(selection.overlapReviews.map(row=>[JSON.stringify([row.workId,row.invoiceId,row.lineId]),row])),overlaps=[];
  const selectedWork=new Set(costs.filter(x=>x.originalCost.kind==='WORK').map(x=>x.originalCost.recordId));
  for(const original of catalog.rows.filter(x=>x.kind==='INVOICE_LINE'&&used.has(x.sourceKey))){
    for(const id of original.workIds)if(selectedWork.has(id)){
      const key=JSON.stringify([id,original.recordId,original.lineId]),review=reviews.get(key)||null;
      overlaps.push({workId:id,invoiceId:original.recordId,lineId:original.lineId,
        workSelectionIds:costs.filter(x=>x.originalCost.kind==='WORK'&&x.originalCost.recordId===id).map(x=>x.originalCost.selectionId),
        invoiceSelectionIds:costs.filter(x=>x.originalCost.sourceKey===original.sourceKey).map(x=>x.originalCost.selectionId),
        reviewedDistinctCosts:!!review,note:review?.note||''});
    }
  }
  const usedReviews=new Set(overlaps.map(row=>JSON.stringify([row.workId,row.invoiceId,row.lineId])));
  const unusedOverlapReviews=selection.overlapReviews.filter(row=>!usedReviews.has(JSON.stringify([row.workId,row.invoiceId,row.lineId])));
  const balances=catalog.rows.map(row=>({...copy(row),selectedQuantity:cmText(used.get(row.sourceKey)||cmZero),
    unselectedQuantity:cmText(cmSub(cmExact(row.quantity,'original quantity'),used.get(row.sourceKey)||cmZero))}));
  return {...catalog,rows:balances,costs,overlaps,unusedOverlapReviews,unreviewedOverlaps:overlaps.filter(row=>!row.reviewedDistinctCosts),
    selection:copy(selection),note:'Cost portions use recorded civil dates. Invoice issue-date liability and entered Work-hour valuation remain separate from original payment cash and funding eligibility.'};
}
function ocHtml(commercial){
  const r=commercial.originalCostIntake;if(!r)return '';
  return '<h3>Original case cost intake</h3><p>'+esc(r.note)+'</p>'+
    htmlTable(['Original record','Kind / state','Contributor','Source quantity / unit','Selected','Unselected','Original dates'],
      r.rows.map(x=>[x.label+' / '+x.recordId+(x.lineId?' / '+x.lineId:''),x.kind+' / '+x.state,x.contributorName,x.quantity+' '+x.unit,x.selectedQuantity,x.unselectedQuantity,x.periodStart+' through '+x.periodEnd]))+
    htmlTable(['Selected original cost','Service','Portion / unit','Value per unit','Selected dates','Valuation source','Allocation source'],
      r.costs.map(x=>[x.id,x.serviceId,x.originalCost.quantity+' '+x.originalCost.unit,x.originalCost.unitCost,x.periodStart+' through '+x.periodEnd,x.originalCost.valuationSource,x.sourceReference]))+
    '<h4>Linked Work and invoice cost review</h4>'+
    htmlTable(['Original Work','Invoice / line','Distinct costs reviewed','Actual source explanation'],
      r.overlaps.map(x=>[x.workId,x.invoiceId+' / '+x.lineId,x.reviewedDistinctCosts,x.note]));
}


/** Read the complete saved native task comparison; its original writer remains authoritative. */
export const COHORT_TASK_MEASUREMENT_SCHEMA='stellar-forge.sf47-cohort-task-measurement.v1';
const TASK_OUTCOMES_SCHEMA='stellar-forge.sf47-customer-task-outcomes.v1';
export function inspectCohortTaskMeasurements(value){
  const original=jsonSource(value?.value?.edition?value.value:value,'taskMeasurement'),edition=object(original.edition,'taskMeasurement.edition'),source=object(original.source,'taskMeasurement.source');
  if(edition.schema!==TASK_OUTCOMES_SCHEMA||!/^task-outcomes-[a-f0-9]{32}$/.test(edition.id||'')||
    !Number.isSafeInteger(edition.revision)||edition.revision<1||!/^source-[a-f0-9]{32}$/.test(source.id||'')||
    source.mediaType!=='application/vnd.stellar-forge.customer-task-outcomes+json'||!Number.isSafeInteger(source.bytes)||source.bytes<1||
    !/^[a-f0-9]{64}$/.test(source.sha256||'')||!source.customerTaskOutcomes||
    canonical(source.customerTaskOutcomes)!==canonical({schema:TASK_OUTCOMES_SCHEMA,id:edition.id,revision:edition.revision,sha256:edition.sha256}))
    fail('COST_PLAN_MEASUREMENT_SOURCE','Select the complete original saved Task Outcomes response, including source metadata and edition.','taskMeasurement');
  const captured=object(edition.source,'taskMeasurement.edition.source'),caseSource=object(captured.case,'taskMeasurement.edition.source.case');
  if(!/^operation-[a-f0-9]{32}$/.test(caseSource.id||'')||!Array.isArray(captured.sources)||!Array.isArray(captured.deployments)||!Array.isArray(captured.purchases))
    fail('COST_PLAN_MEASUREMENT_SOURCE','Retain the original case, attachments, deployment and purchase context.','taskMeasurement.edition.source');
  const document=object(edition.document,'taskMeasurement.edition.document');
  for(const field of ['title','customer','task','unit'])cmRequired(document[field],'taskMeasurement.document.'+field);
  object(edition.report,'taskMeasurement.edition.report');timestamp(edition.savedAt,'taskMeasurement.edition.savedAt');
  for(const field of ['sha256','reportSha256','previewSha256'])if(!/^[a-f0-9]{64}$/.test(edition[field]||''))fail('COST_PLAN_MEASUREMENT_SOURCE','Retain every complete original edition digest.','taskMeasurement.edition.'+field);
  const observed=[{kind:'INSTALLED',observationId:'',label:'Initial installed method',method:document.installed,
    status:document.status,comparison:document.comparison,conclusion:document.conclusion,acceptance:null,
    deploymentIds:document.deploymentIds,purchaseIds:document.purchaseIds},
    ...list(document.followups||[],'taskMeasurement.followups',100).map(row=>({...copy(row),kind:'FOLLOWUP',observationId:row.id}))];
  const observations=observed.map((row,i)=>{
    const path='taskMeasurement.observations['+i+']',method=object(row.method,path+'.method');
    if(!['OBSERVED','ESTIMATED','MIXED','UNRECORDED'].includes(method.basis)||!['DRAFT','REVIEWED'].includes(row.status))
      fail('COST_PLAN_MEASUREMENT_SOURCE','Retain the original measurement basis and reviewed state.',path);
    for(const field of ['name','sourceReference','population','period','output','quality','notes'])text(method[field],path+'.'+field);
    for(const field of ['sourceIds','effort','costs'])list(method[field],path+'.'+field,1000);
    if(method.observedAt!==null)timestamp(method.observedAt,path+'.observedAt');
    const quantity=method.completedTasks;
    if(quantity!==null&&(typeof quantity!=='string'||!/^(0|[1-9][0-9]{0,12})$/.test(quantity)||BigInt(quantity)>1000000000000n))
      fail('COST_PLAN_MEASUREMENT_SOURCE','Retain the original whole completed-task count.',path+'.completedTasks');
    const unavailable=[];
    if(quantity===null||quantity==='0')unavailable.push('Enter a positive completed-task count in the original comparison.');
    if(method.basis==='UNRECORDED')unavailable.push('Record the measurement basis in the original comparison.');
    return {kind:row.kind,observationId:row.observationId,label:row.label,quantity,unit:document.unit,
      basis:method.basis,observedAt:method.observedAt,status:row.status,comparison:copy(row.comparison),
      acceptance:copy(row.acceptance??null),conclusion:row.conclusion,method:copy(method),
      deploymentIds:copy(row.deploymentIds),purchaseIds:copy(row.purchaseIds),usable:!unavailable.length,unavailable};
  });
  unique(observations.filter(row=>row.kind==='FOLLOWUP'),'observationId','taskMeasurement recurring observations');
  return {schema:COHORT_TASK_MEASUREMENT_SCHEMA+'.catalog',original,caseId:caseSource.id,comparisonId:edition.id,
    revision:edition.revision,sourceId:source.id,sourceSha256:source.sha256,title:document.title,customer:document.customer,
    task:document.task,unit:document.unit,installation:copy(document.installation),observations};
}
function fpTaskMeasurement(value,caseId){
  cmFields(value,['schema','original','kind','observationId','serviceBasis','caseId'],'measurement');
  if(value.schema!==COHORT_TASK_MEASUREMENT_SCHEMA)fail('COST_PLAN_MEASUREMENT_SOURCE','Use the original selected task measurement.','measurement.schema');
  const catalog=inspectCohortTaskMeasurements(value.original);
  const selectedCaseId=value.caseId??catalog.caseId;
  if(!/^operation-[a-f0-9]{32}$/.test(selectedCaseId)||(caseId&&selectedCaseId!==caseId))
    fail('COST_PLAN_MEASUREMENT_CASE','Select the actual case holding this complete saved measurement. Keep its original producer case separately.','measurement.caseId');
  if(!['INSTALLED','FOLLOWUP'].includes(value.kind)||typeof value.observationId!=='string')
    fail('COST_PLAN_MEASUREMENT_SELECTION','Select the installed method or one exact recurring observation.','measurement');
  const selected=catalog.observations.find(row=>row.kind===value.kind&&row.observationId===value.observationId);
  if(!selected||!selected.usable)fail('COST_PLAN_MEASUREMENT_SELECTION',selected?.unavailable.join(' ')||'The original selected observation is absent.','measurement');
  const measurement={schema:COHORT_TASK_MEASUREMENT_SCHEMA,original:catalog.original,kind:value.kind,
    observationId:value.observationId,serviceBasis:cmRequired(value.serviceBasis,'measurement.serviceBasis',12000),...(value.caseId===undefined?{}:{caseId:value.caseId})};
  const outputSource=catalog.customer+' · '+catalog.title+'; '+catalog.comparisonId+' revision '+catalog.revision+
    '; '+(selected.kind==='INSTALLED'?'installed method':'observation '+selected.observationId)+
    '; '+selected.basis+'; source '+catalog.sourceId+' / '+catalog.sourceSha256+'. '+measurement.serviceBasis;
  return {measurement,selected,catalog,outputQuantity:selected.quantity,outputUnit:selected.unit,outputSource};
}
/** Explicit acceptance replaces the selected denominator and retains every earlier selected basis. */
export function bindCohortRecordedCostMeasurement(allocation,original,selection){
  object(allocation,'allocation');cmFields(selection,['kind','observationId','serviceBasis','caseId'],'measurement selection');
  const next=copy(allocation),bound=fpTaskMeasurement({schema:COHORT_TASK_MEASUREMENT_SCHEMA,original,
    kind:selection.kind,observationId:selection.observationId??'',serviceBasis:selection.serviceBasis,...(selection.caseId===undefined?{}:{caseId:selection.caseId})});
  if(next.measurement&&canonical(next.measurement)!==canonical(bound.measurement)){
    next.measurementHistory=[...(next.measurementHistory||[]),{measurement:copy(next.measurement),
      outputQuantity:next.outputQuantity,outputUnit:next.outputUnit,outputSource:next.outputSource}];
  }
  Object.assign(next,{measurement:bound.measurement,outputQuantity:bound.outputQuantity,outputUnit:bound.outputUnit,outputSource:bound.outputSource});
  return jsonSource(next,'allocation');
}

/** Complete original actual-cost basis for a prospective adoption plan. */
export const COHORT_RECORDED_COST_PLAN_SCHEMA='stellar-forge.sf47-cohort-recorded-cost-plan.v1';
function fpDivide(a,b,path){
  if(!b.n)fail('COST_PLAN_OUTPUT_REQUIRED','Enter a positive measured output quantity.',path);
  const places=12,n=a.n*10n**BigInt(b.s+places),d=b.n*10n**BigInt(a.s);
  return cmText({n:(n+d-1n)/d,s:places});
}
function fpSource(value){
  return value.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?reopenCohortDeliveryComparison(value):compareCohortDelivery(value);
}
export function seedCohortRecordedCostPlan(recordedDocument,planDocument){
  const source=fpSource(recordedDocument),plan=checkedPlan(planDocument).input;
  if(!source.commercial)fail('COST_PLAN_COMMERCIAL_REQUIRED','Calculate the complete commercial reconciliation first.','recordedDocument');
  return {name:plan.name+' · recorded cost basis',note:'',quantityBasis:'COMPLETED_TASKS',allocations:[]};
}
export function planCohortFromRecordedCosts(recordedDocument,planDocument,raw){
  return fpPlanFromRecordedCosts(recordedDocument,planDocument,raw,false);
}
// Only complete historical documents can select the preceding calculation for exact reopening.
function fpPlanFromRecordedCosts(recordedDocument,planDocument,raw,legacyUnits){
  const sourceDocument=fpSource(recordedDocument),baseline=checkedPlan(jsonSource(planDocument,'planDocument')),candidate=copy(baseline.input);
  const commercial=sourceDocument.commercial;
  if(!commercial)fail('COST_PLAN_COMMERCIAL_REQUIRED','Calculate the complete commercial reconciliation first.','recordedDocument');
  if(sourceDocument.source.programId!==candidate.source.programId)fail('COST_PLAN_SOURCE_CASE','Use recorded results and a prospective plan from the same original case.','planDocument');
  if(commercial.originalCostIntake?.unreviewedOverlaps.length)fail('COST_PLAN_COST_OVERLAP','Resolve the invoice-linked Work cost overlap in the original comparison before planning from those costs.','recordedDocument');
  cmFields(raw,['name','note','quantityBasis','allocations'],'choices');
  if(raw.quantityBasis!==undefined&&raw.quantityBasis!=='COMPLETED_TASKS')fail('COST_PLAN_QUANTITY_BASIS','Measured output quantities count completed useful tasks.','choices.quantityBasis');
  const choices={name:cmRequired(raw.name,'choices.name',500),note:text(raw.note??'','choices.note'),...(legacyUnits?{}:{quantityBasis:'COMPLETED_TASKS'}),allocations:[]};
  const mappings=unique(list(raw.allocations,'choices.allocations',10000),'id','choices.allocations');
  if(!mappings.length)fail('COST_PLAN_SELECTION_REQUIRED','Choose at least one measured output and future schedule.','choices.allocations');
  const totals=new Map(),targets=new Set(),derivations=[];
  for(const [index,mapping]of mappings.entries()){
    const path='choices.allocations['+index+']';
    cmFields(mapping,['id','targetScheduleId','sourceServiceId','outputQuantity','outputUnit','outputSource','supplierCoverage','laborCoverage','coverageNote','costs','measurement','measurementHistory'],path);
    let measured=mapping.measurement?fpTaskMeasurement(mapping.measurement,sourceDocument.source.programId):null;
    const row={id:mapping.id,targetScheduleId:cmRequired(mapping.targetScheduleId,path+'.targetScheduleId',500),
      sourceServiceId:cmRequired(mapping.sourceServiceId,path+'.sourceServiceId',500),
      outputQuantity:cmText(cmDecimal(mapping.outputQuantity??measured?.outputQuantity,path+'.outputQuantity')),
      outputUnit:cmRequired(mapping.outputUnit??measured?.outputUnit,path+'.outputUnit',300),outputSource:cmRequired(mapping.outputSource??measured?.outputSource,path+'.outputSource'),
      supplierCoverage:mapping.supplierCoverage,laborCoverage:mapping.laborCoverage,
      coverageNote:cmRequired(mapping.coverageNote,path+'.coverageNote'),costs:[]};
    if(measured){
      if(row.outputQuantity!==measured.outputQuantity||row.outputUnit!==measured.outputUnit||row.outputSource!==measured.outputSource)
        fail('COST_PLAN_MEASUREMENT_CHANGED','The selected count, unit or original reference differs from the retained measurement. Explicitly select a new measurement or return this allocation to manual input.',path);
      row.measurement=measured.measurement;
    }
    if(mapping.measurementHistory!==undefined){
      row.measurementHistory=list(mapping.measurementHistory,path+'.measurementHistory',1000).map((previous,i)=>{
        cmFields(previous,['measurement','outputQuantity','outputUnit','outputSource'],path+'.measurementHistory.'+i);
        const retained=fpTaskMeasurement(previous.measurement);
        if(previous.outputQuantity!==retained.outputQuantity||previous.outputUnit!==retained.outputUnit||previous.outputSource!==retained.outputSource)
          fail('COST_PLAN_MEASUREMENT_CHANGED','Retain the complete preceding measurement selection.',path+'.measurementHistory.'+i);
        return copy(previous);
      });
    }
    if(cmDecimal(row.outputQuantity,path).n===0n)fail('COST_PLAN_OUTPUT_REQUIRED','Enter the actual positive useful-output quantity, with its original measurement basis.',path);
    if(!['PARTIAL','COMPLETE'].includes(row.supplierCoverage)||!['PARTIAL','COMPLETE'].includes(row.laborCoverage))
      fail('COST_PLAN_COVERAGE_REQUIRED','Explicitly classify supplier and labor coverage as PARTIAL or COMPLETE.',path);
    const schedule=candidate.schedules.find(item=>item.id===row.targetScheduleId);
    const service=commercial.services.find(item=>item.id===row.sourceServiceId);
    if(!schedule||targets.has(schedule.id)||!service)fail('COST_PLAN_SELECTION_REQUIRED','Select one distinct future schedule and one original commercial service per allocation.',path);
    targets.add(schedule.id);
    if(schedule.economics&&schedule.economics.currency!==commercial.currency)fail('COST_PLAN_CURRENCY','Use the same entered currency for the source costs and the selected future schedule.',path);
    const occurrences=baseline.occurrences.filter(item=>item.scheduleId===schedule.id);
    if(!occurrences.length||occurrences.some(item=>item.date<=dayOf(commercial.window.asOfAt)))
      fail('COST_PLAN_FUTURE_SCHEDULE','Choose a schedule whose complete occurrences begin after the recorded comparison cutoff day. Keep completed work in its original plan.',path);
    let supplier=cmZero,hours=cmZero,labor=cmZero,supplierUnknown=false,laborUnknown=false,hoursUnknown=false;
    const contributions=[];
    unique(list(mapping.costs,path+'.costs',100000),'costId',path+'.costs');
    for(const selection of mapping.costs){
      cmFields(selection,['costId','share'],path+'.costs');
      const cost=commercial.costs.find(item=>item.id===selection.costId);
      if(!cost||cost.serviceId!==service.id||!['SUPPLIER','LABOR','OTHER'].includes(cost.costType))
        fail('COST_PLAN_COST_SELECTION','Select a supplier, other delivery cost or labor row from this original service. Keep payment fees in their original payment model.',path);
      const share=cmDecimal(selection.share,path+'.share');
      if(share.n<=0n||cmSub(share,{n:1n,s:0}).n>0n)fail('COST_PLAN_SHARE','Each selected share must be greater than zero and at most one.',path);
      const total=cmAdd(totals.get(cost.id)||cmZero,share);
      if(cmSub(total,{n:1n,s:0}).n>0n)fail('COST_PLAN_SHARE_EXCEEDED','The selected portions of '+cost.id+' exceed its complete recorded quantity or amount across mappings.',path);
      totals.set(cost.id,total);row.costs.push({costId:cost.id,share:cmText(share)});
      const amount=cost.calculatedAmount===null?null:cmMul(cmExact(cost.calculatedAmount,path),share);
      const active=cost.costType==='LABOR'&&cost.activeHours!==null?cmMul(cmExact(cost.activeHours,path),share):null;
      if(cost.costType==='LABOR'){if(amount===null)laborUnknown=true;else labor=cmAdd(labor,amount);if(active===null)hoursUnknown=true;else hours=cmAdd(hours,active);}
      else if(amount===null)supplierUnknown=true;else supplier=cmAdd(supplier,amount);
      contributions.push({costId:cost.id,costType:cost.costType,share:cmText(share),amount:amount===null?null:cmText(amount),activeHours:active===null?null:cmText(active),originalCost:copy(cost)});
    }
    const output=cmDecimal(row.outputQuantity,path),completeSupplier=row.supplierCoverage==='COMPLETE'&&!supplierUnknown,
      completeHours=row.laborCoverage==='COMPLETE'&&!hoursUnknown,completeLabor=completeHours&&!laborUnknown;
    const requestOutput=cmMul(output,{n:BigInt(schedule.requestsPerTask),s:0});
    const next={unitCost:completeSupplier?fpDivide(supplier,legacyUnits?output:requestOutput,path):null,
      activeHoursPerTask:completeHours?fpDivide(hours,output,path):null,
      hourlyCost:completeLabor?(hours.n?fpDivide(labor,hours,path):labor.n===0n?'0':null):null};
    derivations.push({id:row.id,targetScheduleId:row.targetScheduleId,sourceServiceId:row.sourceServiceId,
      outputQuantity:row.outputQuantity,outputUnit:row.outputUnit,outputSource:row.outputSource,
      ...(legacyUnits?{}:{quantityBasis:{kind:'COMPLETED_TASKS',completedTasks:row.outputQuantity,requestsPerTask:schedule.requestsPerTask,
        correspondingRequests:cmText(requestOutput),supplierCostPerTask:completeSupplier?fpDivide(supplier,output,path):null,
        interpretation:'One measured useful output corresponds to one complete future task; supplier cost is distributed across that task’s underlying requests.'}}),
      sourceService:copy(service),originalEconomics:copy(schedule.economics),derivedEconomics:copy(next),
      ...(measured?{measurement:{...copy(measured.selected),comparisonId:measured.catalog.comparisonId,revision:measured.catalog.revision,
        sourceId:measured.catalog.sourceId,sourceSha256:measured.catalog.sourceSha256,customer:measured.catalog.customer,task:measured.catalog.task,
        serviceBasis:measured.measurement.serviceBasis,...(measured.measurement.caseId===undefined?{}:{originCaseId:measured.catalog.caseId,selectedCaseId:measured.measurement.caseId})}}:{}),
      supplierCoverage:row.supplierCoverage,laborCoverage:row.laborCoverage,coverageNote:row.coverageNote,
      knownSupplierCost:cmText(supplier),knownLaborCost:cmText(labor),knownActiveHours:cmText(hours),
      supplierComplete:completeSupplier,laborComplete:completeLabor,hoursComplete:completeHours,contributions,
      rounding:'Nonnegative derived rates are ceiling-rounded to 12 fractional places; original amounts and hours remain exact.'});
    if(!schedule.economics)schedule.economics={currency:commercial.currency,unitRevenue:null,unitCost:null,feePerPayment:null,activeHoursPerTask:null,hourlyCost:null};
    Object.assign(schedule.economics,next);choices.allocations.push(row);
  }
  candidate.name=choices.name;
  const report=evaluateCohortPlan(candidate);
  const comparison=compareCohortPlans(planDocument,report.input,{title:choices.name,note:choices.note});
  const costBalances=commercial.costs.map(cost=>({costId:cost.id,costType:cost.costType,serviceId:cost.serviceId,
    selectedShare:cmText(totals.get(cost.id)||cmZero),unselectedShare:cmText(cmSub({n:1n,s:0},totals.get(cost.id)||cmZero))}));
  return jsonSource({schema:COHORT_RECORDED_COST_PLAN_SCHEMA,sourceDocument,planDocument:copy(planDocument),choices,
    candidate:report.input,report,comparison,derivations,costBalances},'recordedCostPlan');
}
export function reopenCohortRecordedCostPlan(document){
  if(document?.schema!==COHORT_RECORDED_COST_PLAN_SCHEMA)fail('COST_PLAN_DOCUMENT_REQUIRED','Open the complete recorded-cost planning document.','document');
  const result=fpPlanFromRecordedCosts(document.sourceDocument,document.planDocument,document.choices,document.choices?.quantityBasis===undefined);
  if(canonical(result)!==canonical(document))fail('COST_PLAN_DOCUMENT_CHANGED','The retained recorded-cost planning document differs from its full source and explicit choices.','document');
  return result;
}
export function exportCohortRecordedCostPlanCsv(document){
  const result=reopenCohortRecordedCostPlan(document),rows=[['section','id','complete_json'],
    ['recorded_source','original',JSON.stringify(result.sourceDocument)],['baseline_plan','original',JSON.stringify(result.planDocument)],
    ...result.derivations.map(row=>['derived_schedule',row.targetScheduleId,JSON.stringify(row)]),
    ...result.costBalances.map(row=>['recorded_cost_balance',row.costId,JSON.stringify(row)]),
    ...(result.choices.allocations.some(row=>row.measurement||row.measurementHistory?.length)?[['planning_choices','original',JSON.stringify(result.choices)]]:[]),
    ['candidate_plan','successor',JSON.stringify(result.candidate)],['comparison','complete',JSON.stringify(result.comparison)]];
  return rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
