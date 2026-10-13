/** Explicit adapter from the retained WQP interpretation to load inputs.
 * It never matches a station, substitutes a detection limit, or changes source rows.
 */
import {InputError} from './parse.mjs';
export const WQP_LOAD_MAPPING='measurements-wqp-characteristics-loads/v1';
export const WQP_SOLIDS_LOAD_MAPPING='measurements-wqp-characteristics-loads/v2';
const clone=x=>JSON.parse(JSON.stringify(x));
const text=x=>x==null?'':String(x).trim();
const fail=s=>{throw new InputError(s);};
const dimensionFields=['resultDepth','resultDepthUnit','resultDepthReference',
 'activityDepth','activityDepthUnit','activityDepthReference','relativeDepth',
 'timeBasis','temperatureBasis','weightBasis'];
const ordinaryIssues=new Set(['unit-from-single-detection-limit','censored-result',
 'qualified-result','review-source-status']);
export function canonicalWQPLoadSample(row,join){
 if(row?.sourceKind!=='wqp'||!row.raw||typeof row.raw!=='object')
  fail('Select a complete original WQP record for the canonical load mapping.');
 const ci=row.characteristicInterpretation,di=row.detectionInterpretation;
 const solidsEdition=ci?.edition==='wqp-characteristics/v2';
 if(!['wqp-characteristics/v1','wqp-characteristics/v2'].includes(ci?.edition)||di?.edition!=='wqp-detection-conditions/v2')
  fail('Canonical loads require the explicit WQP characteristic and detection interpretation editions.');
 for(const field of ['stationId','sampledDate','characteristic','parameter','basis','speciation',
   'fraction','unit','value','lower','upper','censor','detection','detectionLimits','method',
   'methodContext','methodName','qualifier','status','medium','issues',...dimensionFields])
  if(!Object.hasOwn(row,field))fail('Retain original canonical WQP field: '+field);
 if(!Array.isArray(row.detectionLimits)||!Array.isArray(row.issues))
  fail('Retain complete original WQP limits and interpretation issues.');
 if(row.stationId!==join.station_id||row.sampledDate!==join.date)
  fail('Canonical WQP station or original reporting date differs from its selected flow join.');
 for(const [source,interpreted] of [['characteristic','sourceCharacteristic'],['speciation','sourceSpeciation'],
  ['fraction','sourceFraction'],['basis','chemicalBasis'],['method','method'],
  ['methodContext','methodContext'],['methodName','methodName'],...dimensionFields.map(k=>[k,k])])
  if(text(row[source])!==text(ci[interpreted]))fail('Canonical WQP interpretation differs from its retained '+source+'.');
 if(ci.chemicalConversion!=='none')fail('This WQP load mapping does not perform chemical-basis conversion.');
 let solidsContext={};
 if(solidsEdition){
  for(const field of ['solidsBasis','solidsBasisSource','solidsConversion'])
   if(!Object.hasOwn(ci,field))fail('Retain original WQP solids interpretation: '+field);
  const name=text(row.characteristic).toLowerCase().replace(/\s+/g,' ');
  const expected=ci.unitKind==='concentration'?(name==='total suspended solids'?'total-suspended-solids':name==='suspended sediment concentration'?'suspended-sediment-concentration':null):null;
  if(ci.solidsConversion!=='none'||ci.solidsBasis!==expected||ci.solidsBasisSource!==(expected?'explicit-characteristic':null))
   fail('The retained WQP solids interpretation differs from its original characteristic.');
  if(row.parameter==='tss'&&expected!=='total-suspended-solids'||row.parameter==='ssc'&&expected!=='suspended-sediment-concentration')
   fail('The retained WQP solids parameter differs from its original quantity.');
  solidsContext={solids_basis:ci.solidsBasis,solids_basis_source:ci.solidsBasisSource,solids_conversion:ci.solidsConversion};
 }
 const mapping=solidsEdition?WQP_SOLIDS_LOAD_MAPPING:WQP_LOAD_MAPPING;
 const issues=row.issues.filter(issue=>!ordinaryIssues.has(issue));
 if(ci.unitKind!=='concentration'||row.unit!=='mg/L')
  issues.push('This source quantity is not a mass concentration in mg/L; retain it as context.');
 if(!text(row.basis)||row.basis==='unspecified')
  issues.push('The source chemical or mass basis is unspecified; retain it as context.');
 if(!text(row.fraction))issues.push('The original sample fraction is unspecified.');
 if(!text(row.method))issues.push('The original analytical method is unspecified.');
 if(text(row.medium).toLowerCase()!=='water')issues.push('The original medium is not Water.');
 if(row.review?.state==='exclude')issues.push('The original Measurements review excludes this record.');
 if(row.variantCount>1&&(!text(row.id)||!text(row.selectedVersion)||row.selectedVersion!==row.id))
  issues.push(row.selectedVersion?'A different original source version is selected.':'The original source-version conflict is unresolved.');
 if(di.conflictingDirections||!di.conditionRecognized)
  issues.push('The retained detection interpretation is conflicting or unrecognized.');
 let value=null,limit=null;
 if(row.censor==='none'){
  if(typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<0||
     row.lower!==row.value||row.upper!==row.value)
   issues.push('The original uncensored concentration is missing or has inconsistent bounds.');
  else value=row.value;
 }else if(row.censor==='left'){
  if(row.value!==null||row.lower!==null||typeof row.upper!=='number'||!Number.isFinite(row.upper)||row.upper<0)
   issues.push('The original finite left-censor bound is unresolved.');
  else limit=row.upper;
  // The kernel separately admits only explicit supported source conditions.
  // A right bound or inequality without a published condition is never relabeled.
  if(!text(row.detection))issues.push('The left-censor source condition needs an explicit supported mapping.');
 }else{
  issues.push('Finite load envelopes do not support this original censor direction: '+row.censor);
 }
 const series_context={
  mapping,characteristic_edition:ci.edition,detection_edition:di.edition,
  parameter:row.parameter,chemical_basis:row.basis,source_speciation:row.speciation,
  normalized_unit:row.unit,unit_kind:ci.unitKind,
  source_unit_basis:ci.sourceUnitBasis,basis_source:ci.basisSource,
  microbial_count_method:ci.microbialCountMethod,turbidity_scale:ci.turbidityScale,
  ...solidsContext,
  ...Object.fromEntries(dimensionFields.map(k=>[k,row[k]]))
 };
 return {
  sample_id:join.sample_id,station_id:row.stationId,date:row.sampledDate,
  characteristic:row.characteristic,sample_fraction:row.fraction,
  method_id:row.method,method_context:row.methodContext,
  value,unit:row.unit,detection_condition:row.censor==='none'?'':row.detection,
  limit_value:limit,limit_unit:row.unit,qualifier:row.qualifier,result_status:row.status,
  source_mapping:mapping,series_context,
  integration_issues:[...new Set(issues)],flow_study_original_sample:clone(row),
  canonical_original:clone(row)
 };
}
