// MIT. Reviewed mass-concentration representations over the original WQX scientific engine.
import { WATER_QUALITY_GROUP_FIELDS, normalizeAnalysisOptions, summarizeWaterQuality,
  classifyWaterQualityResult, waterQualityResultSourceParts, compareWaterQualityReports } from '../analysis.mjs';
import { CONCENTRATION_UNIT_PROFILE, convertConcentrationRecord } from '../concentration-units.mjs';
import { verifyOpenWatersPlan, openWatersHash, openWatersCanonical } from '../openwaters.mjs';
import { normalizeReviewSheetDocument, iterateReviewSheetTargets } from '../review-sheet/model.mjs';
import { concentrationReportForDocument } from '../review-sheet/concentrations.mjs';

export const STANDARDIZED_ANALYSIS_SCHEMA = 'starforge.wqx-standardized-analysis.v1';
export const STANDARDIZED_COMPARISON_SCHEMA = 'starforge.wqx-standardized-comparison.v1';
const same = (a,b) => openWatersCanonical(a) === openWatersCanonical(b);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const copy = value => structuredClone(value);
const str = value => value === undefined || value === null ? '' : String(value);
const empty = value => value === null || value === undefined || typeof value === 'string' && !value.trim();
const HASH = /^[0-9a-f]{64}$/;
export function standardizedFail(message, code = 'WQX_STANDARDIZED_INVALID', status = 400) {
  throw Object.assign(new Error(message), {code,status});
}
function exactObject(input, keys, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key)))
    standardizedFail('Use the supported ' + label + ' fields.');
  return input;
}
export function normalizeStandardizedOptions(input = {}) {
  exactObject(input, ['window','baselineWindow','includeEstimated','characteristics','siteIds','allowedQualifiers'], 'scientific selection');
  for (const key of ['window','baselineWindow']) if (input[key] !== undefined && input[key] !== null)
    exactObject(input[key], ['start','end'], key);
  return normalizeAnalysisOptions(input);
}
function boundOperator(value) { return value === '≤' ? '<=' : value === '≥' ? '>=' : value; }
function measureIdentity(value) {
  if (empty(value)) return {kind:'empty'};
  const result = classifyWaterQualityResult({value,limits:[]});
  if (result.bound) return {kind:'bound',operator:boundOperator(result.bound.operator),
    numerator:result.bound.number.numerator,denominator:result.bound.number.denominator};
  if (result.numeric) return {kind:'decimal',numerator:result.numeric.numerator,denominator:result.numeric.denominator};
  return {kind:'text',value};
}
function sameQuantity(value, unit, expectedValue, expectedUnit) {
  return same(measureIdentity(value),measureIdentity(expectedValue)) &&
    (empty(unit) && empty(expectedUnit) || unit === expectedUnit);
}
function limitSource(limit) {
  return {id:limit.id??null,type:limit.type??null,value:limit.value??null,unit:limit.unit??null,
    comment:limit.comment??null,origin:limit.origin??null,source:limit.source??null};
}
function planBinding(plan, resultPlan, document) {
  return {captureId:plan.captureId,captureSha256:plan.captureSha256,sourceReviewId:plan.reviewId,
    sourceReviewSha256:plan.reviewSha256,sourcePlanId:plan.planId,sourcePlanSha256:plan.planSha256,
    resultingPlanId:resultPlan.planId,resultingPlanSha256:resultPlan.planSha256,
    documentSha256:openWatersHash(document)};
}
function cohort(model, plan) {
  if (!model || !Array.isArray(model.rows) || model.captureSha256 !== plan.captureSha256)
    standardizedFail('Open the complete original capture selected by this receiving plan.', 'WQX_STANDARDIZED_SOURCE',409);
  const byPointer = new Map();
  for (const row of model.rows) {
    const key = openWatersCanonical([row.id,row.source?.sha256??null,row.source?.index??null]);
    if (byPointer.has(key)) standardizedFail('The original source pointer occurs more than once.', 'WQX_STANDARDIZED_SOURCE',409);
    byPointer.set(key,row);
  }
  const ids = new Set(), rows = [];
  for (const source of plan.results) {
    if (ids.has(source.sourceRecordId)) standardizedFail('Resolve the repeated original result identity before creating paired analysis.', 'WQX_STANDARDIZED_SOURCE',409);
    ids.add(source.sourceRecordId);
    const key = openWatersCanonical([source.sourceRecordId,source.source?.sha256??null,source.source?.index??null]), row = byPointer.get(key);
    if (!row || row.resultKey !== source.sourceKey || row.resultId !== source.nativeResultId ||
      (source.sourceRecordSha256 != null && source.sourceRecordSha256 !== row.recordSha256) ||
      !same((row.limits??[]).map(limitSource),(source.limits??[]).map(limitSource)))
      standardizedFail('The selected result or one of its original reported limits changed.', 'WQX_STANDARDIZED_SOURCE',409);
    rows.push(row);
  }
  return {...model,rows};
}
function sourceParts(row) {
  return Object.fromEntries(Object.entries(waterQualityResultSourceParts(row)).map(([key,value])=>[key,openWatersHash(value)]));
}
function reviewReasons(plan, document) {
  const decisions = new Map(document.decisions.filter(row => row.reason).map(row=>[row.targetId,row]));
  const result = new Map();
  if (!decisions.size) return result;
  for (const target of iterateReviewSheetTargets(plan,{kind:'result',attentionOnly:false})) {
    const decision = decisions.get(target.targetId); if (!decision) continue;
    if (!result.has(target.sourceKey)) result.set(target.sourceKey,[]);
    // The complete marker stays in the native decision document. Display the analyst's own reason here.
    const reason = decision.reason.split('\nWQX_CONCENTRATION_')[0];
    const list = result.get(target.sourceKey);
    if (reason && !list.some(row=>row.reason===reason && row.action===decision.action))
      list.push({action:decision.action,reason});
  }
  return result;
}
function projection(report) {
  const {observations,...rest}=report;
  return rest;
}
function unchangedClassification(a,b,id) {
  for (const key of ['classification','censoring','estimated','qualified','qualifiers','unknownQualifiers','unknownValueType','included','exclusion'])
    if (!same(a[key],b[key])) standardizedFail('The representation changed scientific eligibility for ' + id + '. Keep the original source classification.',
      'WQX_STANDARDIZED_CLASSIFICATION_CHANGED',409);
}
function transformedRow(row, choice) {
  const converted = convertConcentrationRecord({source:choice.source,value:row.value,unit:row.unit,limits:row.limits??[]},
    {targetUnit:choice.targetUnit});
  if (converted.state !== 'PREPARED' || !converted.result ||
      !sameQuantity(converted.result.value,converted.result.unit,choice.after.RESULT_MSR,choice.after.RESULT_MSR_UNIT))
    standardizedFail('This receiving choice contains a quantity edit beyond an exact unit representation for ' + row.id +
      '. Keep that original scientific value or record its source correction separately.', 'WQX_STANDARDIZED_QUANTITY_CHANGED',409);
  if (converted.limits.length !== choice.reportedLimits.length)
    standardizedFail('The complete reported-limit list changed.', 'WQX_STANDARDIZED_SOURCE',409);
  for (let index=0;index<converted.limits.length;index++) {
    const actual=converted.limits[index], expected=choice.reportedLimits[index];
    if (actual.original.id !== expected.original.id || !actual.converted || !expected.converted ||
      !sameQuantity(actual.converted.value,actual.converted.unit,expected.converted.value,expected.converted.unit))
      standardizedFail('The independently reviewed limit differs from its original source conversion.', 'WQX_STANDARDIZED_QUANTITY_CHANGED',409);
  }
  const limits=(row.limits??[]).map((limit,index)=>({...limit,value:converted.limits[index].converted.value,
    unit:converted.limits[index].converted.unit}));
  return {row:{...row,value:converted.result.value,unit:converted.result.unit,limits},converted};
}
export function analyzeStandardizedWaterQuality({model,sourcePlan,resultPlan,document,options={}}={}) {
  const source=verifyOpenWatersPlan(sourcePlan), resulting=verifyOpenWatersPlan(resultPlan);
  document=normalizeReviewSheetDocument(document); options=normalizeStandardizedOptions(options);
  if (source.captureSha256!==resulting.captureSha256 || source.reviewSha256!==resulting.reviewSha256 ||
      source.results.length!==resulting.results.length || !same(source.results.map(x=>x.sourceRecordId).sort(),resulting.results.map(x=>x.sourceRecordId).sort()))
    standardizedFail('The reviewed plan must retain the complete original study cohort.', 'WQX_STANDARDIZED_SOURCE',409);
  const input=cohort(model,source), concentration=concentrationReportForDocument(source,document,{resultPlan:resulting});
  const choices=new Map(concentration.rows.map(row=>[row.sourceRecordId,row])), transformed=new Map();
  const rows=input.rows.map(row=>{
    const choice=choices.get(row.id);
    if (!choice) return row;
    const selected=transformedRow(row,choice); transformed.set(row.id,{...selected,choice});
    return selected.row;
  });
  const original=summarizeWaterQuality(input,options), reviewed=summarizeWaterQuality({...input,rows},options);
  for (const key of ['sourceRows','selectedRows','filteredRows','uniqueResults','activities','stations','duplicates','conflicts',
    'estimated','qualified','censored','missing','nonNumeric','invalidDates','arithmeticRows','excludedRows'])
    if (original.inventory[key]!==reviewed.inventory[key])
      standardizedFail('An exact representation changed the original scientific population.', 'WQX_STANDARDIZED_CLASSIFICATION_CHANGED',409);
  const raw=new Map(input.rows.map(row=>[row.id,row])), after=new Map(reviewed.observations.map(row=>[row.id,row]));
  const reasons=reviewReasons(source,document), originalGroup=new Map();
  for (const group of original.groups) for (const id of group.observationIds) originalGroup.set(id,group);
  const observations=original.observations.map(row=>{
    const changed=after.get(row.id), conversion=transformed.get(row.id);
    if (!changed) standardizedFail('The reviewed observation is missing.', 'WQX_STANDARDIZED_SOURCE',409);
    unchangedClassification(row.analysis,changed.analysis,row.id);
    const parts=sourceParts(raw.get(row.id));
    const values=conversion?{profileId:CONCENTRATION_UNIT_PROFILE.id,profileVersion:CONCENTRATION_UNIT_PROFILE.version,
      choiceSha256:conversion.choice.choiceSha256,targetUnit:conversion.choice.targetUnit,reason:conversion.choice.reason,
      originalResult:copy(conversion.converted.result.original),result:copy(conversion.converted.result),
      limits:conversion.converted.limits.map(value=>({original:copy(value.original),converted:copy(value.converted)}))}:null;
    return {...row,sourceParts:parts,sourceSemanticSha256:openWatersHash(parts),reviewReasons:reasons.get(row.id)??[],
      reporting:{value:changed.value,unit:changed.unit,valueState:changed.valueState,limits:changed.limits,analysis:changed.analysis,conversion:values}};
  });
  const groups=reviewed.groups.map(group=>{
    const components=new Map();
    for (const id of group.observationIds) {
      const part=originalGroup.get(id); if (!part) continue;
      if (!components.has(part.id)) components.set(part.id,{groupId:part.id,key:part.key,unit:part.dimensions.unit,count:0});
      components.get(part.id).count++;
    }
    return {reportingGroupId:group.id,reportingUnit:group.dimensions.unit,
      sourceGroups:[...components.values()].sort((a,b)=>a.key.localeCompare(b.key)),
      convertedResults:group.observationIds.filter(id=>transformed.has(id)).length};
  });
  const selectedConversions=observations.filter(row=>row.reporting.conversion);
  const selectedReportedLimits=selectedConversions.reduce((n,row)=>n+row.reporting.conversion.limits.filter(x=>x.converted.factor).length,0);
  const content={schema:STANDARDIZED_ANALYSIS_SCHEMA,source:planBinding(source,resulting,document),profile:CONCENTRATION_UNIT_PROFILE,
    options,title:source.title,inventory:{...reviewed.inventory,inputSourceRows:model.rows.length,sourcePlanResults:source.results.length,
      sourceReportedLimits:input.rows.reduce((n,row)=>n+(row.limits??[]).length,0),
      selectedReportedLimits:observations.reduce((n,row)=>n+(row.limits??[]).length,0),
      chosenSourceResults:choices.size,convertedResults:selectedConversions.length,
      convertedPopulatedResults:selectedConversions.filter(row=>!empty(row.value)).length,
      convertedEmptyResults:selectedConversions.filter(row=>empty(row.value)).length,
      convertedReportedLimits:selectedReportedLimits,unchangedResults:observations.length-selectedConversions.length,
      originalGroups:original.groups.length,reportingGroups:reviewed.groups.length},
    original:projection(original),reviewed:projection(reviewed),groups,observations,
    concentration:{proposalSha256:concentration.proposalSha256,documentSha256:concentration.documentSha256,summary:concentration.summary},
    sourceNotes:[...original.sourceNotes,
      'Only saved, paired concentration choices select a reporting representation. Every result and every reported limit is converted independently from its original source unit.',
      'Original and reporting summaries use the same descriptive scientific engine, population, qualifications and censoring rules. Positive unit factors retain the original inequalities.',
      'A missing result with an unspecified unit stays missing with that unit state, even when its separately reported limits have reviewed concentration units.',
      'Scientific grouping retains every original group dimension except an explicitly reviewed unit. Receiving edits to names, methods, qualifiers or values are not silently adopted as scientific source corrections.',
      'The original source, complete receiving decisions and both representations remain available in the portable review. Unit conversion does not increase source precision or establish a temporal or causal trend.'
    ],sources:[...original.sources,{title:'NIST metric SI prefixes',url:CONCENTRATION_UNIT_PROFILE.source}]};
  return {...content,analysisSha256:openWatersHash(content)};
}
export function verifyStandardizedAnalysis(input) {
  if (!input || input.schema!==STANDARDIZED_ANALYSIS_SCHEMA || !Array.isArray(input.observations) || !HASH.test(input.analysisSha256??''))
    standardizedFail('Choose a complete saved reporting-unit analysis.', 'WQX_STANDARDIZED_CHANGED',409);
  const {analysisSha256,...content}=input;
  if (openWatersHash(content)!==analysisSha256) standardizedFail('The reporting-unit analysis changed.', 'WQX_STANDARDIZED_CHANGED',409);
  normalizeStandardizedOptions(input.options);
  return input;
}
function index(report) {
  const result=new Map();
  for (const row of report.observations) {
    const key=row.resultKey??row.id;
    if (!result.has(key)) result.set(key,[]);
    result.get(key).push(row);
  }
  return result;
}
function reviewQuantity(row) {
  return {value:row.reporting.value,unit:row.reporting.unit,limits:row.reporting.limits.map(limit=>({type:limit.type??null,value:limit.value??null,unit:limit.unit??null,origin:limit.origin??null})).sort((a,b)=>openWatersCanonical(a).localeCompare(openWatersCanonical(b)))};
}
function rowVersion(row) {
  return {id:row.id,resultKey:row.resultKey,nativeResultId:row.resultId,date:row.date,source:row.source,
    sourceSemanticSha256:row.sourceSemanticSha256,value:row.value,unit:row.unit,
    reporting:reviewQuantity(row),included:row.reporting.analysis.included,exclusion:row.reporting.analysis.exclusion,
    choiceSha256:row.reporting.conversion?.choiceSha256??null,reason:row.reporting.conversion?.reason??null};
}
export function compareStandardizedAnalyses(currentInput,previousInput) {
  const current=verifyStandardizedAnalysis(currentInput),previous=verifyStandardizedAnalysis(previousInput);
  const a=index(current),b=index(previous),rows=[],unchanged=[];
  const counts={added:0,removed:0,sourceChanged:0,choiceChanged:0,choiceBindingChanged:0,representationChanged:0,ambiguous:0,unchanged:0};
  for (const key of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const aa=a.get(key)??[],bb=b.get(key)??[];
    const av=new Set(aa.map(row=>row.sourceSemanticSha256)),bv=new Set(bb.map(row=>row.sourceSemanticSha256));
    if (av.size>1 || bv.size>1 || [...aa,...bb].some(row=>row.conflictingDuplicate)) {
      counts.ambiguous++;rows.push({resultKey:key,status:'AMBIGUOUS',currentVersions:av.size,previousVersions:bv.size});continue;
    }
    const x=aa.find(row=>!row.duplicate)??aa[0],y=bb.find(row=>!row.duplicate)??bb[0];
    if (!y) {counts.added++;rows.push({resultKey:key,status:'ADDED',current:rowVersion(x),previous:null});continue;}
    if (!x) {counts.removed++;rows.push({resultKey:key,status:'REMOVED',current:null,previous:rowVersion(y)});continue;}
    const sourceChanged=x.sourceSemanticSha256!==y.sourceSemanticSha256;
    const choiceBindingChanged=(x.reporting.conversion?.choiceSha256??null)!==(y.reporting.conversion?.choiceSha256??null);
    const choiceChanged=(x.reporting.conversion?.targetUnit??null)!==(y.reporting.conversion?.targetUnit??null) ||
      (x.reporting.conversion?.reason??null)!==(y.reporting.conversion?.reason??null) || !same(x.reviewReasons,y.reviewReasons);
    const representationChanged=!same(reviewQuantity(x),reviewQuantity(y));
    if (choiceBindingChanged) counts.choiceBindingChanged++;
    if (!sourceChanged&&!choiceChanged&&!representationChanged) {counts.unchanged++;unchanged.push(key);continue;}
    if (sourceChanged) counts.sourceChanged++;if(choiceChanged)counts.choiceChanged++;if(representationChanged)counts.representationChanged++;
    rows.push({resultKey:key,status:sourceChanged?(choiceChanged?'SOURCE_AND_CHOICES_CHANGED':'SOURCE_CHANGED'):'CHOICES_CHANGED',
      sourceChanged,choiceChanged,choiceBindingChanged,representationChanged,changedSourceParts:Object.keys(x.sourceParts).filter(part=>x.sourceParts[part]!==y.sourceParts[part]),
      current:rowVersion(x),previous:rowVersion(y)});
  }
  const content={schema:STANDARDIZED_COMPARISON_SCHEMA,currentAnalysisSha256:current.analysisSha256,
    previousAnalysisSha256:previous.analysisSha256,currentSource:current.source,previousSource:previous.source,
    optionsEquivalent:same(current.options,previous.options),currentOptions:current.options,previousOptions:previous.options,
    counts,rows,unchanged,originalGroups:compareWaterQualityReports(current.original,previous.original),
    reportingGroups:compareWaterQualityReports(current.reviewed,previous.reviewed),
    sourceNotes:[
      'Source changes use the original scientific capture-comparison semantics for complete result, station, activity and reported-limit records.',
      'Choice changes and resulting representation changes are shown independently from source changes.',
      'Group comparisons require the same complete scientific dimensions and reporting unit. Counts and both selected options remain visible.',
      'Different source windows can add or remove selected records without indicating an edited source result. Descriptive differences do not establish a trend.'
    ]};
  return {...content,comparisonSha256:openWatersHash(content)};
}
export const STANDARDIZED_OBSERVATION_FIELDS=Object.freeze([...new Set([
  'id','resultKey','activityKey','stationKey','resultId','date','time','timeZone',...WATER_QUALITY_GROUP_FIELDS,
  'value','valueState','detectionCondition','valueType','qualifier','status','recordSha256'
])]);
