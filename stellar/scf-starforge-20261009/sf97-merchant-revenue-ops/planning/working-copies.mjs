// MIT. Original scenario schemas and document rules over the shared durable working store.
import { createSourceWorkingCopies } from './source-working-copies.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX=8*1024*1024;
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function shape(value,keys,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))
    throw fail('WORKING_COPY_INVALID','Use the original '+label+' fields.');
}
function documentShape(document) {
  shape(document,['label','scenarios','selectedScenarioId','routePage','selectedReviewVersion','detailScenarioId','basePlanId','pendingPlanSave'],'unfinished scenario');
  if(typeof document.label!=='string'||document.label.length>65536||!Array.isArray(document.scenarios)||
      document.scenarios.length<1||document.scenarios.length>12)
    throw fail('WORKING_COPY_INVALID','Retain a raw label and one to twelve original scenario alternatives.');
  const ids=new Set();
  for(const item of document.scenarios) {
    shape(item,['id','label','routes','sharedMonthlyFixedUsd','goal'],'scenario alternative');
    if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(item.id)||ids.has(item.id)||typeof item.label!=='string')
      throw fail('WORKING_COPY_INVALID','Scenario identities must be unique and their unfinished labels must remain text.');
    ids.add(item.id);
    if(item.routes!==undefined&&(!item.routes||typeof item.routes!=='object'||Array.isArray(item.routes)))
      throw fail('WORKING_COPY_INVALID','Keep route assumptions keyed by their original route IDs.');
    for(const values of Object.values(item.routes??{})) {
      shape(values,['unitPriceUsd','priceBasis','monthlyPaidTarget','perFulfilledUsd','perChallengeUsd'],'route assumption');
      if(Object.values(values).some(value=>value!==null&&!['string','number'].includes(typeof value)||
          typeof value==='number'&&!Number.isFinite(value)))
        throw fail('WORKING_COPY_INVALID','Keep unfinished assumptions as raw text, finite numbers or explicit unknown values.');
    }
    if(item.sharedMonthlyFixedUsd!==undefined&&item.sharedMonthlyFixedUsd!==null&&typeof item.sharedMonthlyFixedUsd!=='string')
      throw fail('WORKING_COPY_INVALID','Keep the unfinished fixed cost as text or an explicit unknown value.');
    if(item.goal!==undefined) {
      shape(item.goal,['monthlyContributionUsd','marginPct'],'scenario target');
      if(Object.values(item.goal).some(value=>typeof value!=='string'))
        throw fail('WORKING_COPY_INVALID','Keep unfinished targets as raw text.');
    }
  }
  if(!ids.has(document.selectedScenarioId)||!Number.isSafeInteger(document.routePage)||document.routePage<0||
      (document.detailScenarioId!==null&&!ids.has(document.detailScenarioId))||
      (document.selectedReviewVersion!==null&&!UUID.test(document.selectedReviewVersion??''))||
      (document.basePlanId!==null&&!UUID.test(document.basePlanId??'')))
    throw fail('WORKING_COPY_INVALID','Keep the original selected scenario, route page and saved review identities.');
  if(document.pendingPlanSave!==null) {
    shape(document.pendingPlanSave,['version','scenarios','requestId','label','selectedScenarioId','reviewSha256'],'pending comparison save');
    if(!UUID.test(document.pendingPlanSave.requestId??'')||!UUID.test(document.pendingPlanSave.version??'')||
       !HASH.test(document.pendingPlanSave.reviewSha256??''))
      throw fail('WORKING_COPY_INVALID','Retain the complete original pending comparison save identity.');
  }
  if(encode(document).length>MAX/2)throw fail('WORKING_COPY_TOO_LARGE','Unfinished scenario inputs support up to 4 MiB.');
  return structuredClone(document);
}
function summary(entry) {
  const record=entry.record;
  return {workingCopyId:record.workingCopyId,revision:entry.revision,
    label:record.document.label.trim().slice(0,160)||'Untitled scenario work',
    savedAt:record.savedAt,sourceVersion:record.source.version,scenarioCount:record.document.scenarios.length,
    selectedScenarioId:record.document.selectedScenarioId,receivedFrom:record.receivedFrom??null};
}
const family=createSourceWorkingCopies({
  directory:'scenario-working',
  recordSchema:'stellar-forge.merchant-scenario-working-revision.v1',
  packageSchema:'stellar-forge.merchant-scenario-working-copy.v1',
  inputsSchema:'stellar-forge.merchant-scenario-working-inputs.v1',
  listSchema:'stellar-forge.merchant-scenario-working-list.v1',
  stateSchema:'stellar-forge.merchant-scenario-working-state.v1',
  savedStatus:'SCENARIO_WORKING_COPY_SAVED',documentShape,summary,
  async verifySource({binding,document,actual}) {
    const routes=new Set(actual.routes.map(route=>route.routeId));
    for(const item of document.scenarios)if(Object.keys(item.routes??{}).some(id=>!routes.has(id)))
      throw fail('WORKING_ROUTE_CHANGED','An unfinished scenario refers to a route outside its original review.');
    if(document.pendingPlanSave&&document.pendingPlanSave.version!==binding.version)
      throw fail('WORKING_SOURCE_CHANGED','The pending comparison save belongs to another original pricing review.');
  }
});
export const openScenarioWorkingCopies=family.open;
export const captureScenarioWorkingBackup=family.captureBackup;
