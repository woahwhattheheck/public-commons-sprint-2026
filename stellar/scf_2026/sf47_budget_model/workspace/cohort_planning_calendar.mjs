/**
 * Receive the native saved Customer-use Calendar in the original adoption planner.
 * The complete source selection and Cohort seed travel with every editable edition.
 */
import {CohortPlanningError, seedCohortPlan, normalizeCohortPlan} from './cohort_planning.mjs';

export const COHORT_PLAN_CALENDAR_SOURCE_SCHEMA = 'stellar-forge.sf47-cohort-plan-calendar-source.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  value && typeof value === 'object' ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value);
function fail(message, path='calendarSelection') { throw new CohortPlanningError('CALENDAR_PLANNING_SOURCE', message, path); }
function list(value, label) { if(!Array.isArray(value))fail('Retain the complete native '+label+'.',label);return value; }
function same(actual, expected, message) { if(canonical(actual)!==canonical(expected))fail(message); }
function identities(rows) {
  return rows.map(row=>({id:row.id,revision:row.revision,sha256:row.sha256})).sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);
}

/**
 * nativeSeed is the original customer-use-calendar-cohort response, including
 * customerUse.selection. calendarSelection is the complete original calendar read.
 * The operation prepares a new complete plan; it does not mutate either source.
 */
export function seedCohortPlanFromCalendar(nativeSeed, calendarSelection, options={}) {
  const source = nativeSeed?.source, view = calendarSelection;
  if(view?.schema !== 'stellar-forge.sf47-customer-use-calendar.v1.selection' ||
      !source || !nativeSeed.customerUse || !view.source)fail('Select the complete original calendar and matching native Customer-use Cohort seed.');
  const groupId = options.groupId ?? nativeSeed.customerUse.groupId;
  const selectedGroup = list(view.groups,'calendar groups').find(row=>row.id===groupId);
  if(!selectedGroup || selectedGroup.tranche == null || selectedGroup.planChanged)
    fail('Select a saved calendar window for the current original tranche and plan.');
  if(source.programId!==view.source.caseId || source.version!==view.source.caseVersion ||
      source.planContentSha256!==view.source.planContentSha256 ||
      source.planContentSha256!==selectedGroup.planContentSha256 ||
      nativeSeed.customerUse.caseVersion!==source.version || nativeSeed.customerUse.groupId!==groupId)
    fail('The calendar and native seed select different original cases, versions, plans or windows. Read the selected editions together.');
  same(nativeSeed.rule,selectedGroup.rule,'Retain the same complete original deployment rule in the calendar and native seed.');
  if(nativeSeed.rule.target.tranche!==selectedGroup.tranche ||
      nativeSeed.inputs?.windowStart!==selectedGroup.startDate || nativeSeed.inputs?.windowEnd!==selectedGroup.endDate)
    fail('The calendar and native seed must retain the same original dated window.');
  const actualDays=(Date.parse(selectedGroup.endDate+'T00:00:00Z')-Date.parse(selectedGroup.startDate+'T00:00:00Z'))/86400000+1;
  if(actualDays!==nativeSeed.rule.target.proposed_window.consecutive_calendar_days)
    fail('The saved customer-use dates do not span the selected original tranche window. Select the matching original Installation calendar.');
  const chosen = list(view.calendars,'saved Installation calendars').filter(row=>row.groupId===groupId);
  if(!chosen.length)fail('The selected original window contains no saved Installation calendar.');
  same(identities(chosen),identities(list(nativeSeed.customerUse.selection,'native seed Installation selection')),
    'The calendar and native seed must select identical Installation IDs, revisions and SHA-256 values.');
  const availableRefs=identities(list(view.selection,'calendar Installation selection'));
  for(const selected of identities(chosen))if(!availableRefs.some(row=>canonical(row)===canonical(selected)))
    fail('A selected calendar is absent from its original edition inventory.');
  const nativeOperations=list(nativeSeed.inputs.operations,'native useful operations');
  const plan=seedCohortPlan(nativeSeed,{...options,windowStart:selectedGroup.startDate,
    name:options.name??'Customer use '+selectedGroup.startDate+' through '+selectedGroup.endDate});
  plan.calendar={timezone:'UTC',weekdays:[1,2,3,4,5,6,7],excludedDates:[]};
  plan.fundingGroups=[];plan.schedules=[];plan.operations=[];
  let nativeOperationIndex=0;
  for(const selected of chosen) {
    const calendar=selected.document, taskMap=new Map(), fundingMap=new Map();
    if(calendar.schema!=='stellar-forge.sf47-customer-use-calendar.v1' ||
        calendar.startDate!==selectedGroup.startDate || calendar.endDate!==selectedGroup.endDate ||
        calendar.tranche!==selectedGroup.tranche)fail('Retain the complete selected native calendar document.');
    const edition={installationId:selected.id,revision:selected.revision,sha256:selected.sha256};
    for(const task of list(calendar.tasks,'useful tasks')) {
      const original=nativeOperations[nativeOperationIndex++];
      if(!original || original.label!==task.name || original.scope!==task.request || original.expectedOutput!==task.completeOutput)
        fail('The native useful-operation sequence differs from the selected complete Installation tasks.');
      if(!plan.merchants.some(row=>row.id===original.merchantDeploymentId))
        fail('A selected Installation merchant is missing from the original seed inventory.');
      const operation={id:original.id,label:original.label,merchantId:original.merchantDeploymentId,
        scope:original.scope,expectedOutput:original.expectedOutput,
        sourcePeriod:'',sourceIds:copy(original.sourceIds||[]),
        sourceNote:(original.sourceNote||'')+'\nOriginal priced unit: '+task.pricedUnit+
          '\nInstallation '+selected.id+' edition '+selected.revision+' / task '+task.id};
      plan.operations.push(operation);taskMap.set(task.id,operation);
    }
    for(const [index,funding] of list(calendar.settlements,'funding groups').entries()) {
      const operation=taskMap.get(funding.taskId);
      if(!operation)fail('A funding group references an absent native task.');
      const id='calendar-funding:'+selected.id+':r'+selected.revision+':'+index;
      fundingMap.set(funding.id,id);
      plan.fundingGroups.push({id,label:(operation.label+' · '+funding.kind+' · '+funding.id).slice(0,500),
        kind:funding.kind,date:funding.date,buyerId:funding.buyerDeploymentId,operationId:operation.id,
        facilitatorId:null,atomicUnitPrice:null,network:'',asset:'',economics:null,
        origin:{...edition,taskId:funding.taskId,fundingId:funding.id},
        sourceIds:[...new Set([...(calendar.sourceIds||[]),...(funding.sourceIds||[])])],
        sourceNote:(funding.note||'')+'\nOriginal native receipt references: '+JSON.stringify(funding.purchaseIds||[])});
    }
    for(const [index,entry] of list(calendar.entries,'dated useful results').entries()) {
      const operation=taskMap.get(entry.taskId);
      if(!operation)fail('A dated useful result references an absent native task.');
      const funded=['PURCHASE','ALLOWANCE_USE'].includes(entry.mode);
      const fundingGroupIds=list(entry.fundingIds,'dated-use funding references').map(id=>{
        if(!fundingMap.has(id))fail('A dated useful result references an absent native funding group.');
        return fundingMap.get(id);
      });
      if(funded!==Boolean(fundingGroupIds.length))fail('Retain the native use mode and its original funding references.');
      const task=calendar.tasks.find(row=>row.id===entry.taskId);
      plan.schedules.push({id:'calendar-use:'+selected.id+':r'+selected.revision+':'+index,
        label:(operation.label+' · '+entry.date+' · '+entry.mode).slice(0,500),
        operationId:operation.id,buyerId:entry.buyerDeploymentId,facilitatorId:null,capacityPoolId:null,
        cadence:{kind:'EXPLICIT_DATES',dates:[entry.date]},tasksPerDate:entry.state==='CANCELLED'?0:1,
        requestsPerTask:1,timeUtc:'12:00',deliveryDelayMinutes:0,excludedDates:[],
        payment:funded?{kind:'FUNDED',atomicUnitPrice:null,network:'',asset:''}:{kind:'UNPAID',atomicUnitPrice:'0',network:'',asset:''},
        fundingGroupIds,economics:null,origin:{...edition,entryId:entry.id,taskId:entry.taskId,mode:entry.mode,state:entry.state},
        note:(entry.note||'')+'\nSelected source period: '+entry.sourcePeriod+'\nOriginal priced unit: '+task.pricedUnit+
          '\nOriginal source references: '+JSON.stringify(entry.sourceIds||[])+
          '\nThe native calendar supplies a UTC date. 12:00 UTC is an editable planning placement within that date.'});
    }
  }
  if(nativeOperationIndex!==nativeOperations.length)fail('The native seed contains useful operations outside this exact calendar selection.');
  plan.calendarSource={schema:COHORT_PLAN_CALENDAR_SOURCE_SCHEMA,groupId,selection:copy(view),cohortSeed:copy(nativeSeed)};
  plan.note='Prepared from the complete saved Customer-use Calendar and its matching native Cohort seed. Explicit funding groups retain their original identities and useful-result relationships. Enter commercial terms on Funding groups and active delivery costs on Schedules. Cancelled entries remain as zero-task schedules. The complete original selection is retained with this plan.';
  return normalizeCohortPlan(plan);
}
