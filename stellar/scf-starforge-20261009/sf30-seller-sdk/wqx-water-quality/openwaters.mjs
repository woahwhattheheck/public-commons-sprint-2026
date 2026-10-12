// MIT. Source-preserving preparation for the published Open Waters tab importer.
import { createHash } from 'node:crypto';
import { OPEN_WATERS_CONTRACT } from './openwaters-contract.mjs';

export const OPEN_WATERS_SCHEMA = 'starforge.wqx-open-waters-plan.v1';
export const OPEN_WATERS_BUNDLE_SCHEMA = 'starforge.wqx-open-waters-bundle.v1';
export const OPEN_WATERS_LIMIT_FIELDS = Object.freeze(['METHOD_DETECTION_LEVEL','LAB_REPORTING_LEVEL','PQL','LOWER_QUANT_LIMIT','UPPER_QUANT_LIMIT']);
const fields = OPEN_WATERS_CONTRACT.fields;
const byLevel = Object.fromEntries(['M','S'].map(level => [level, new Map(fields.filter(x => x.level === level).map(x => [x.name,x]))]));
const SAMPLE = {
 MONLOC_ID:'Location_Identifier', ACTIVITY_ID:'Activity_ActivityIdentifier', ACT_TYPE:'Activity_TypeCode', ACT_MEDIA:'Activity_Media',
 ACT_SUBMEDIA:'Activity_MediaSubdivision', ACT_START_DT:'Activity_StartDate', ACT_START_TIME:'Activity_StartTime',
 ACT_END_DT:'Activity_EndDate', ACT_END_TIME:'Activity_EndTime', ACT_TIME_ZONE:'Activity_StartTimeZone',
 RELATIVE_DEPTH_NAME:'Activity_ActivityRelativeDepth', ACT_DEPTHHEIGHT_MSR:'Activity_DepthHeightMeasure', ACT_DEPTHHEIGHT_MSR_UNIT:'Activity_DepthHeightMeasureUnit',
 TOP_DEPTHHEIGHT_MSR:'Activity_TopDepthMeasure', TOP_DEPTHHEIGHT_MSR_UNIT:'Activity_TopDepthMeasureUnit',
 BOT_DEPTHHEIGHT_MSR:'Activity_BottomDepthMeasure', BOT_DEPTHHEIGHT_MSR_UNIT:'Activity_BottomDepthMeasureUnit',
 DEPTH_REF_POINT:'Activity_BottomDepthAltitudeReferencePoint', ACT_COMMENT:'Activity_Comment',
 BIO_ASSEMBLAGE_SAMPLED:'ActivityBiological_AssemblageSampled', BIO_DURATION_MSR:'BiologicalHabitat_CollectionDurationMeasure',
 BIO_DURATION_MSR_UNIT:'BiologicalHabitat_CollectionDurationMeasureUnit', BIO_SAMP_COMPONENT:'Activity_BottomDepthSamplingComponent',
 BIO_REACH_LEN_MSR:'ReachLength_Measure', BIO_REACH_LEN_MSR_UNIT:'ReachLength_MeasureUnit',
 BIO_REACH_WID_MSR:'ReachWidth_Measure', BIO_REACH_WID_MSR_UNIT:'ReachWidth_MeasureUnit', BIO_PASS_COUNT:'ReachWidth_Pass',
 BIO_NET_TYPE:'ActivityBiological_NetType', BIO_NET_AREA_MSR:'ActivityBiological_NetAreaMeasure', BIO_NET_AREA_MSR_UNIT:'ActivityBiological_NetAreaMeasureUnit',
 BIO_NET_MESHSIZE_MSR:'ActivityBiological_NetMeshSizeMeasure', BIO_MESHSIZE_MSR_UNIT:'ActivityBiological_NetMeshSizeMeasureUnit',
 BIO_BOAT_SPEED_MSR:'ActivityBiological_BoatSpeedMeasure', BIO_BOAT_SPEED_MSR_UNIT:'ActivityBiological_BoatSpeedMeasureUnit',
 BIO_CURR_SPEED_MSR:'ActivityBiological_CurrentSpeedMeasure', BIO_CURR_SPEED_MSR_UNIT:'ActivityBiological_CurrentSpeedMeasureUnit',
 BIO_TOXICITY_TEST_TYPE:'ActivityBiological_ToxicityTestType',
 SAMP_COLL_METHOD_ID:'SampleCollectionMethod_Identifier', SAMP_COLL_METHOD_CTX:'SampleCollectionMethod_IdentifierContext',
 SAMP_COLL_EQUIP:'SampleCollectionMethod_EquipmentName', SAMP_COLL_EQUIP_COMMENT:'SampleCollectionMethod_EquipmentComment',
 SAMP_PREP_ID:'SamplePrepMethod_Identifier', SAMP_PREP_CTX:'SamplePrepMethod_IdentifierContext', SAMP_PREP_CONT_TYPE:'SamplePrepMethod_ContainerType',
 SAMP_PREP_CONT_COLOR:'SamplePrepMethod_ContainerColor', SAMP_PREP_CHEM_PRESERV:'SamplePrepMethod_ChemicalPreservativeUsed',
 SAMP_PREP_THERM_PRESERV:'SamplePrepMethod_ThermalPreservativeUsed', SAMP_PREP_STORAGE_DESC:'SamplePrepMethod_TransportStorageDescription'
};
const RESULT = {
 DATA_LOGGER_LINE:'Result_DataLoggerLine', RESULT_DETECT_CONDITION:'Result_ResultDetectionCondition', CHAR_NAME:'Result_Characteristic',
 METHOD_SPECIATION_NAME:'Result_MethodSpeciation', RESULT_SAMP_FRACTION:'Result_SampleFraction',
 RESULT_MSR:'Result_Measure', RESULT_MSR_UNIT:'Result_MeasureUnit', RESULT_MSR_QUAL:'Result_MeasureQualifierCode',
 RESULT_STATUS:'Result_MeasureStatusIdentifier', STATISTIC_BASE_CODE:'Result_StatisticalBase', RESULT_VALUE_TYPE:'Result_MeasureType',
 WEIGHT_BASIS:'Result_WeightBasis', TIME_BASIS:'Result_TimeBasis', TEMP_BASIS:'Result_MeasureTemperatureBasis',
 PARTICLESIZE_BASIS:'Result_MeasureParticleSizeBasis', PRECISION_VALUE:'DataQuality_PrecisionValue', BIAS_VALUE:'DataQuality_BiasValue',
 CONFIDENCE_INTERVAL_VALUE:'DataQuality_ConfidenceIntervalValue', UPPER_CONFIDENCE_LIMIT:'DataQuality_UpperConfidenceLimitValue',
 LOWER_CONFIDENCE_LIMIT:'DataQuality_LowerConfidenceLimitValue', RESULT_COMMENT:'DataQuality_ResultComment',
 DEPTH_HEIGHT_MSR:'ResultDepthHeight_Measure', DEPTH_HEIGHT_MSR_UNIT:'ResultDepthHeight_MeasureUnit', DEPTHALTITUDEREFPOINT:'ResultDepthHeight_AltitudeReferencePoint',
 BIO_INTENT_NAME:'ResultBiological_Intent', BIO_INDIVIDUAL_ID:'ResultBiological_IndividualIdentifier', BIO_SUBJECT_TAXONOMY:'ResultBiological_Taxon',
 BIO_UNIDENTIFIED_SPECIES_ID:'ResultBiological_UnidentifiedSpeciesIdentifier', BIO_SAMPLE_TISSUE_ANATOMY:'ResultBiological_SampleTissueAnatomy',
 GRP_SUMM_COUNT_WEIGHT_MSR:'GroupSummaryWeight_Measure', GRP_SUMM_COUNT_WEIGHT_MSR_UNIT:'GroupSummaryWeight_MeasureUnit',
 ANALYTIC_METHOD_ID:'ResultAnalyticalMethod_Identifier', ANALYTIC_METHOD_CTX:'ResultAnalyticalMethod_IdentifierContext',
 LAB_NAME:'LabInfo_Name', LAB_ANALYSIS_START_DT:'LabInfo_AnalysisStartDate', LAB_ANALYSIS_START_TIME:'LabInfo_AnalysisStartTime',
 LAB_ANALYSIS_END_DT:'LabInfo_AnalysisEndDate',
 LAB_SAMP_PREP_ID:'LabSamplePrepMethod_Identifier', LAB_SAMP_PREP_CTX:'LabSamplePrepMethod_IdentifierContext',
 LAB_SAMP_PREP_START_DT:'LabSamplePrepMethod_StartDate', LAB_SAMP_PREP_START_TIME:'LabSamplePrepMethod_StartTime',
 LAB_SAMP_PREP_END_DT:'LabSamplePrepMethod_EndDate', DILUTION_FACTOR:'LabSamplePrepMethod_DilutionFactor'
};
const LOCATION = {
 MONLOC_ID:'Location_Identifier', MONLOC_NAME:'Location_Name', MONLOC_TYPE:'Location_Type', MONLOC_DESC:'Location_Description',
 HUC_EIGHT:'Location_HUCEightDigitCode', HUC_TWELVE:'Location_HUCTwelveDigitCode', TRIBAL_LAND_IND:'Location_TribalLandIndicator',
 TRIBAL_LAND_NAME:'Location_TribalLand', LATITUDE_MSR:'Location_Latitude', LONGITUDE_MSR:'Location_Longitude',
 SOURCE_MAP_SCALE:'Location_SourceMapScale', HORIZ_COLL_METHOD:'Location_HorzCollectionMethod', HORIZ_REF_DATUM:'Location_HorzCoordReferenceSystemDatum',
 VERT_MEASURE:'Location_VerticalMeasure', VERT_MEASURE_UNIT:'Location_VerticalMeasureUnit', VERT_COLL_METHOD:'Location_VertCollectionMethod',
 VERT_REF_DATUM:'Location_VertCoordReferenceSystemDatum', COUNTRY_CODE:'Location_CountryCode', STATE_CODE:'Location_StatePostalCode',
 COUNTY_CODE:'Location_CountyCode', WELL_TYPE:'Location_WellType', AQUIFER_NAME:'Location_LocalAquifer', FORMATION_TYPE:'Location_AquiferFormationType',
 WELLHOLE_DEPTH_MSR:'Location_WellHoleDepthMeasure', WELLHOLE_DEPTH_MSR_UNIT:'Location_WellHoleDepthUnit'
};
export const OPEN_WATERS_FIELD_CHOICES = Object.freeze({
 location:Object.freeze(Object.keys(LOCATION).filter(x=>x!=='MONLOC_ID')),
 activity:Object.freeze(Object.keys(SAMPLE).filter(x=>!['MONLOC_ID','ACTIVITY_ID'].includes(x))),
 result:Object.freeze([...Object.keys(RESULT),...OPEN_WATERS_LIMIT_FIELDS,'DETECTION_LIMIT_UNIT']),
 translation:Object.freeze([...new Set(fields.map(x=>x.name))].filter(x=>!['MONLOC_ID','ACTIVITY_ID',...OPEN_WATERS_LIMIT_FIELDS,'DETECTION_LIMIT_UNIT'].includes(x)))
});
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const text = x => x == null ? '' : String(x);
const present = x => x !== null && x !== undefined && x !== '';
function fail(message, code='WQX_OPEN_WATERS_INVALID', status=400) { throw Object.assign(new Error(message),{code,status}); }
export function openWatersCanonical(value) {
 if (Array.isArray(value)) return '['+value.map(x => x === undefined ? 'null' : openWatersCanonical(x)).join(',')+']';
 if (value && typeof value==='object') return '{'+Object.keys(value).filter(k => value[k] !== undefined).sort().map(k=>JSON.stringify(k)+':'+openWatersCanonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const openWatersHash = value => createHash('sha256').update(typeof value==='string' || Buffer.isBuffer(value) ? value : openWatersCanonical(value)).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
function object(value, name) {
 if (!value || typeof value!=='object' || Array.isArray(value)) fail(name+' must be an object.');
 return value;
}
function string(value,name,{empty=true,max=24000}={}) {
 if (typeof value!=='string' || value.length>max || (!empty && !value.trim())) fail(name+' must be '+(empty?'':'a nonempty ')+'text value of at most '+max+' characters.');
 return value;
}
function collection(value,name,fn) {
 if (value===undefined) return [];
 if (!Array.isArray(value) || value.length>100000) fail(name+' must be an array of mapping choices.');
 return value.map(fn);
}
function unique(rows,key,name) {
 const seen=new Set();
 for (const row of rows) { const id=key(row); if(seen.has(id)) fail('Repeated '+name+' mapping.'); seen.add(id); }
 return rows;
}
function fieldChoices(value,level,allowed) {
 if (value===undefined) return {};
 object(value,'fields'); const out={};
 for(const [k,v] of Object.entries(value)) {
  if(!byLevel[level].has(k) || (allowed && !allowed.has(k))) fail('Choose a published '+level+' receiving field: '+k);
  out[k]=string(v,'Value for '+k);
 }
 return out;
}
export function normalizeOpenWatersOptions(input={}) {
 object(input,'Open Waters options');
 const allowed=new Set(['organizationId','projectId','locationMode','identityMode','locationOverrides','activityOverrides','resultOverrides','fieldTranslations','limitMappings','referenceValues','notes']);
 for(const k of Object.keys(input)) if(!allowed.has(k)) fail('Unknown Open Waters option '+k+'.');
 const locationMode=input.locationMode??'create', identityMode=input.identityMode??'compact';
 if(!['create','existing'].includes(locationMode)) fail('Choose create or existing monitoring locations.');
 if(!['compact','source'].includes(identityMode)) fail('Choose compact or source identities.');
 const identities=(key,level,allowedFields)=>unique(collection(input[key],key,row=>{
  object(row,key); const sourceKey=string(row.sourceKey,key+'.sourceKey',{empty:false,max:4096});
  const result={sourceKey,fields:fieldChoices(row.fields,level,allowedFields)};
  if(row.id!==undefined) result.id=string(row.id,key+'.id',{empty:false,max:35});
  if(row.mode!==undefined) { if(key!=='locationOverrides'||!['create','existing'].includes(row.mode)) fail('Only a location can select create or existing mode.'); result.mode=row.mode; }
  return result;
 }),row=>row.sourceKey,key);
 const locationFields=new Set(OPEN_WATERS_FIELD_CHOICES.location);
 const activityFields=new Set(OPEN_WATERS_FIELD_CHOICES.activity);
 const resultFields=new Set(OPEN_WATERS_FIELD_CHOICES.result);
 const resultOverrides=unique(collection(input.resultOverrides,'resultOverrides',row=>{
  object(row,'result override');
  return {sourceRecordId:string(row.sourceRecordId,'sourceRecordId',{empty:false,max:100}),fields:fieldChoices(row.fields,'S',resultFields)};
 }),row=>row.sourceRecordId,'result');
 const fieldTranslations=unique(collection(input.fieldTranslations,'fieldTranslations',row=>{
  object(row,'field translation'); const field=string(row.field,'field',{empty:false,max:100});
  if(!OPEN_WATERS_FIELD_CHOICES.translation.includes(field))
   fail('Use identity or limit mappings for '+field+'.');
  return {field,from:string(row.from,'from'),to:string(row.to,'to'),reason:string(row.reason??'Operator field translation','reason',{empty:false,max:2000})};
 }),row=>openWatersCanonical([row.field,row.from]),'field/value');
 const limitMappings=unique(collection(input.limitMappings,'limitMappings',row=>{
  object(row,'limit mapping'); if(row.field!==null&&!OPEN_WATERS_LIMIT_FIELDS.includes(row.field)) fail('Choose a published limit field, or null to retain a limit in the source record.');
  return {type:string(row.type,'limit type',{empty:false,max:200}),field:row.field,reason:string(row.reason??'Operator limit representation','limit reason',{empty:false,max:2000})};
 }),row=>row.type,'limit type');
 const referenceValues={};
 for(const [k,v] of Object.entries(object(input.referenceValues??{},'referenceValues'))) {
  if(!fields.some(x=>x.reference===k)) fail('Unknown native reference family '+k+'.');
  if(!Array.isArray(v)||v.some(x=>typeof x!=='string')) fail('Reference values for '+k+' must be an array of exact native codes.');
  referenceValues[k]=[...new Set(v)].sort();
 }
 return {organizationId:string(input.organizationId??'','organizationId',{max:120}),projectId:string(input.projectId??'','projectId',{max:200}),
  locationMode,identityMode,locationOverrides:identities('locationOverrides','M',locationFields),activityOverrides:identities('activityOverrides','S',activityFields),
  resultOverrides,fieldTranslations,limitMappings,referenceValues,notes:string(input.notes??'','notes')};
}
const issue = (code,field,message,severity='error') => ({code,severity,field:field??null,message});
function change(row,field,value,reason) {
 const from=row.fields[field]??'',to=text(value);
 if(from!==to) { row.changes.push({field,from,to,reason}); row.fields[field]=to; }
}
function mapped(record,mapping,fallbacks=[]) {
 const out={};
 for(const [dest,header] of Object.entries(mapping)) {
  const source=[record,...fallbacks].find(x=>x && present(x[header]));
  if(source) out[dest]=text(source[header]);
 }
 return out;
}
function nativeIdentity(sourceId,key,mode) {
 const id=text(sourceId);
 if(mode==='source'||(id.length<=35&&id.trim()===id&&!/[\t\r\n\0]/.test(id))) return id;
 if(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return id.replaceAll('-','');
 return 'WQX-'+openWatersHash(key).slice(0,30);
}
function cleanCells(row,level,opt) {
 for(const [field,original] of Object.entries({...row.fields})) {
  const rule=opt.fieldTranslations.find(x=>x.field===field&&x.from===original);
  if(rule) change(row,field,rule.to,rule.reason);
  const value=row.fields[field];
  if(value!==value.trim()) change(row,field,value.trim(),'The published receiver trims surrounding whitespace; original source is retained.');
  if(/[\t\r\n]/.test(row.fields[field]) && /COMMENT|DESC/.test(field))
   change(row,field,JSON.stringify(row.fields[field]).slice(1,-1),'Escape text line/tab separators for the native unquoted tab importer.');
 }
 if(level==='M') {
  const tribal=(row.fields.TRIBAL_LAND_IND??'').toLowerCase();
  if(['true','false'].includes(tribal)) change(row,'TRIBAL_LAND_IND',tribal==='true'?'Y':'N','Boolean tribal-land indicator represented by the native Y/N field.');
 }
 if(level==='S' && row.fields.RESULT_MSR_QUAL?.startsWith('[')) {
  try {
   const codes=JSON.parse(row.fields.RESULT_MSR_QUAL);
   if(Array.isArray(codes)&&codes.length===1&&typeof codes[0]==='string')
    change(row,'RESULT_MSR_QUAL',codes[0],'Unwrap one original qualifier from the WQX3 list representation.');
  } catch {}
 }
}
function validateFields(row,level,{required=true}={}) {
 const table=byLevel[level];
 for(const rule of table.values()) {
  const v=row.fields[rule.name]??'';
  if(required&&rule.required&&!v) row.issues.push(issue('REQUIRED_FIELD',rule.name,'Supply '+rule.aliases[0]+' for the native receiver.'));
  if(!v) continue;
  if(/[\t\r\n\0]/.test(v)) row.issues.push(issue('TAB_IMPORT_SEPARATOR',rule.name,'This value contains a separator that the native paste importer cannot quote.'));
  if(rule.length!==null && v.length>rule.length) row.issues.push(issue('FIELD_LENGTH',rule.name,'The native field accepts '+rule.length+' characters; this value has '+v.length+'.'));
  if(rule.dataType==='int'&&!/^[+-]?\d+$/.test(v)) row.issues.push(issue('INTEGER_FIELD',rule.name,'Use the native integer representation.'));
  if(rule.dataType==='int'&&(!Number.isSafeInteger(Number(v))||Number(v)<-2147483648||Number(v)>2147483647))
   row.issues.push(issue('INTEGER_RANGE',rule.name,'This value exceeds the receiver’s 32-bit integer range.'));
  if(rule.dataType==='datetime' && !rule.name.endsWith('_TIME')) {
   const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
   const date=m?new Date(v+'T00:00:00Z'):null;
   if(!m||Number(m[1])<1900||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v)
    row.issues.push(issue('DATE_FIELD',rule.name,'Use an actual ISO calendar date from 1900 onward for the published receiver.'));
  }
  if(rule.name.endsWith('_TIME') && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,7})?)?$/.test(v))
   row.issues.push(issue('TIME_FIELD',rule.name,'Use the reported 24-hour local time.'));
 }
}
function checkReferences(row,level,opt,refs) {
 for(const [field,value] of Object.entries(row.fields)) {
  const spec=byLevel[level].get(field); if(!spec?.reference||!value) continue;
  const matched=own(opt.referenceValues,spec.reference)?opt.referenceValues[spec.reference].includes(value):null;
  const key=openWatersCanonical(['reference',spec.reference,value]);
  if(!refs.has(key)) refs.set(key,{kind:'reference',name:spec.reference,value,context:null,count:0,matched});
  refs.get(key).count++;
  if(matched===false) row.issues.push(issue('REFERENCE_VALUE',field,'The supplied '+spec.reference+' catalog does not contain '+value+'.'));
 }
 const pairs=[['collection-method','SAMP_COLL_METHOD_ID','SAMP_COLL_METHOD_CTX'],['sample-preparation-method','SAMP_PREP_ID','SAMP_PREP_CTX'],
  ['analytical-method','ANALYTIC_METHOD_ID','ANALYTIC_METHOD_CTX'],['laboratory-preparation-method','LAB_SAMP_PREP_ID','LAB_SAMP_PREP_CTX']];
 if(level==='S') for(const [kind,id,context] of pairs) if(row.fields[id]) {
  const value=row.fields[id],ctx=row.fields[context]??'',key=openWatersCanonical([kind,value,ctx]);
  if(!refs.has(key))refs.set(key,{kind,name:id,value,context:ctx,count:0,matched:null});
  refs.get(key).count++;
  if(!ctx)row.issues.push(issue('METHOD_CONTEXT',context,'Provide the original method context so the receiver does not substitute the receiving organization.'));
 }
}
function identityCollisions(rows,field) {
 const seen=new Map();
 for(const row of rows) {
  const value=row.destinationId;
  if(seen.has(value)) {
   const first=seen.get(value),description='Distinct source identities map to the same receiving ID '+value+'.';
   first.issues.push(issue('IDENTITY_COLLISION',field,description));row.issues.push(issue('IDENTITY_COLLISION',field,description));
  } else seen.set(value,row);
 }
}
function nativeResultChecks(row) {
 const f=row.fields;
 if(!f.CHAR_NAME)row.issues.push(issue('CHARACTERISTIC_REQUIRED','CHAR_NAME','The published result receiver requires a characteristic.'));
 if(!f.RESULT_MSR&&!f.RESULT_DETECT_CONDITION)row.issues.push(issue('RESULT_OR_CONDITION','RESULT_MSR','Retain a source result or a reported detection condition.'));
 if(f.RESULT_MSR?.includes(','))row.issues.push(issue('RECEIVER_VALUE_REWRITE','RESULT_MSR','The native receiver strips commas from result values; supply an explicit representation.'));
 if(['ND','DNQ','NR','PAQL','PBQL'].includes(f.RESULT_MSR)||['ND','DNQ','NR','PAQL','PBQL'].includes(f.RESULT_DETECT_CONDITION))
  row.issues.push(issue('RECEIVER_CONDITION_REWRITE','RESULT_DETECT_CONDITION','This native shorthand rewrites both value and condition; choose full source terms explicitly.'));
 const required=f.RESULT_DETECT_CONDITION==='Not Detected'?['METHOD_DETECTION_LEVEL','LAB_REPORTING_LEVEL','PQL','UPPER_QUANT_LIMIT']:
  f.RESULT_DETECT_CONDITION==='Present Below Quantification Limit'?['METHOD_DETECTION_LEVEL','LAB_REPORTING_LEVEL','PQL','LOWER_QUANT_LIMIT']:
  f.RESULT_DETECT_CONDITION==='Present Above Quantification Limit'?['METHOD_DETECTION_LEVEL','LAB_REPORTING_LEVEL','PQL','UPPER_QUANT_LIMIT']:null;
 if(required&&!required.some(k=>f[k])) row.issues.push(issue('DETECTION_REPRESENTATION','RESULT_DETECT_CONDITION','Choose a reported limit representation used by this published detection-condition receiver; the exact original limits remain attached.'));
 if(OPEN_WATERS_LIMIT_FIELDS.some(k=>f[k])&&!f.DETECTION_LIMIT_UNIT)
  row.issues.push(issue('LIMIT_UNIT_REQUIRED','DETECTION_LIMIT_UNIT','Retain the reported unit for the selected native limit fields.'));
 if(Boolean(f.BIO_INTENT_NAME)!==Boolean(f.BIO_SUBJECT_TAXONOMY))row.issues.push(issue('BIOLOGICAL_PAIR','BIO_SUBJECT_TAXONOMY','The native receiver expects biological intent and taxonomy together.'));
}
function limitsFor(row,opt) {
 const defaults=new Map(OPEN_WATERS_LIMIT_FIELDS.map(name=>[byLevel.S.get(name).aliases[0],name]));
 const selected=new Map(opt.limitMappings.map(x=>[x.type,x]));
 const limits=(row.originalLimits??[]).map(x=>{
  const chosen=selected.get(x.type),targetField=chosen?chosen.field:(defaults.get(x.type)??null);
  return {id:x.id,type:x.type??null,value:x.value??null,unit:x.unit??null,comment:x.comment??null,origin:x.origin??null,source:x.source??null,
   targetField,choiceReason:chosen?.reason??(targetField?'Exact published limit-type alias':null)};
 });
 const units=new Set();
 for(const limit of limits) {
  if(!limit.targetField) { row.issues.push(issue('LIMIT_RETAINED_IN_SOURCE',null,'Original '+text(limit.type)+' is retained in the source/comment for a receiving choice.','review'));continue; }
  if(!present(limit.value)||!present(limit.unit)) { row.issues.push(issue('LIMIT_VALUE_UNIT',limit.targetField,'A native limit representation requires its original value and unit.'));continue; }
  const v=text(limit.value),existing=row.fields[limit.targetField];
  if(present(existing)&&existing!==v)row.issues.push(issue('LIMIT_SLOT_CONFLICT',limit.targetField,'Different original limits map to this single receiving field.'));
  else row.fields[limit.targetField]=v;
  units.add(limit.unit);
 }
 if(units.size>1)row.issues.push(issue('LIMIT_UNIT_CONFLICT','DETECTION_LIMIT_UNIT','The published receiver has one unit field for all five limit values.'));
 if(units.size===1)row.fields.DETECTION_LIMIT_UNIT=[...units][0];
 return limits;
}
const identityKey = record => openWatersCanonical([record.ProviderName??null,record.Org_Identifier??null,record.Location_Identifier??null]);
const activityKey = record => openWatersCanonical([record.ProviderName??null,record.Org_Identifier??null,record.Activity_ActivityIdentifier??null]);
const pointer = row => openWatersCanonical([row.id,row.source?.sha256??null,row.source?.index??null]);
const hasError = row => row.issues.some(x=>x.severity==='error');
const issueCounts = rows => {
 const counts={};for(const row of rows)for(const value of row.issues)counts[value.code]=(counts[value.code]??0)+1;return counts;
};
export function buildOpenWatersPlan({review,model,options={},planId=null}) {
 if(!review||!model||review.captureSha256!==model.captureSha256||!Array.isArray(review.analysis?.observations))
  fail('Open the original saved review and matching WQX source.', 'WQX_OPEN_WATERS_SOURCE',409);
 const opt=normalizeOpenWatersOptions(options);
 if(planId!==null&&(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(planId)))fail('Choose a stable receiving plan name.');
 const selected=new Set(review.analysis.observations.map(pointer));
 const rows=model.rows.filter(x=>selected.has(pointer(x)));
 if(rows.length!==review.analysis.observations.length)fail('The saved review no longer matches its complete original result pointers.','WQX_OPEN_WATERS_SOURCE',409);
 const refs=new Map(),globalIssues=[],locationRows=new Map(),activityRows=new Map();
 if(!opt.organizationId.trim())globalIssues.push(issue('ORGANIZATION_REQUIRED',null,'Choose the receiving Open Waters organization.'));
 if(!opt.projectId.trim())globalIssues.push(issue('PROJECT_REQUIRED',null,'Choose the existing receiving project on the native sample import page.'));
 const locOverrides=new Map(opt.locationOverrides.map(x=>[x.sourceKey,x])),actOverrides=new Map(opt.activityOverrides.map(x=>[x.sourceKey,x]));
 const resultOverrides=new Map(opt.resultOverrides.map(x=>[x.sourceRecordId,x]));
 for(const original of rows) {
  const sk=original.stationKey??identityKey(original.record),ak=original.activityKey??activityKey(original.record);
  if(!locationRows.has(sk)) {
   const sourceRows=(original.stationRecords??[]).filter(x=>!x.duplicate),record=sourceRows[0]?.record??original.record;
   const override=locOverrides.get(sk),id=nativeIdentity(original.locationId,sk,opt.identityMode);
   const location={sourceKey:sk,sourceId:original.locationId,destinationId:override?.id??id,mode:override?.mode??opt.locationMode,
    source:sourceRows.map(x=>x.source),fields:mapped(record,LOCATION),changes:[],issues:[]};
   change(location,'MONLOC_ID',location.destinationId,'Stable receiving identity; the full original identity is retained in the crosswalk.');
   for(const [k,v]of Object.entries(override?.fields??{}))change(location,k,v,'Saved monitoring-location receiving choice.');
   cleanCells(location,'M',opt);
   location.destinationId=location.fields.MONLOC_ID??'';
   validateFields(location,'M',{required:location.mode==='create'});
   if(location.mode==='existing')location.issues=location.issues.filter(x=>x.field==='MONLOC_ID');
   if(!location.destinationId)location.issues.push(issue('LOCATION_ID_REQUIRED','MONLOC_ID','Choose a receiving monitoring-location ID.'));
   if(sourceRows.some(x=>x.conflictingDuplicate))location.issues.push(issue('SOURCE_LOCATION_CONFLICT',null,'The selected monitoring location has different retained source versions.'));
   if(location.mode==='create')checkReferences(location,'M',opt,refs);
   else {
    const key=openWatersCanonical(['monitoring-location',location.destinationId,opt.organizationId]);
    refs.set(key,{kind:'monitoring-location',name:'MONLOC_ID',value:location.destinationId,context:opt.organizationId,count:1,matched:null});
   }
   locationRows.set(sk,location);
  }
  if(!activityRows.has(ak)) {
   const sourceRows=(original.activityRecords??[]).filter(x=>!x.duplicate),record=sourceRows[0]?.record??original.record,override=actOverrides.get(ak);
   const activity={sourceKey:ak,sourceId:original.activityId,destinationId:override?.id??nativeIdentity(original.activityId,ak,opt.identityMode),
    source:sourceRows.map(x=>x.source),fields:mapped(record,SAMPLE,[original.record]),changes:[],issues:[]};
   change(activity,'ACTIVITY_ID',activity.destinationId,'Stable receiving identity; the original WQX3 identifier remains in the crosswalk.');
   change(activity,'MONLOC_ID',locationRows.get(sk).destinationId,'Use the matching receiving monitoring-location identity.');
   for(const [k,v]of Object.entries(override?.fields??{}))change(activity,k,v,'Saved activity receiving choice.');
   cleanCells(activity,'S',opt);activity.destinationId=activity.fields.ACTIVITY_ID??'';
   validateFields(activity,'S');
   if(sourceRows.some(x=>x.conflictingDuplicate))activity.issues.push(issue('SOURCE_ACTIVITY_CONFLICT',null,'The selected activity has different retained source versions.'));
   if(original.record.Activity_EndTimeZone&&original.record.Activity_StartTimeZone&&original.record.Activity_EndTimeZone!==original.record.Activity_StartTimeZone)
    activity.issues.push(issue('ACTIVITY_TIMEZONE_RETAINED',null,'The receiver has one activity time-zone field; the original end-zone remains in the source.','review'));
   checkReferences(activity,'S',opt,refs);
   activityRows.set(ak,activity);
  }
 }
 const locations=[...locationRows.values()],activities=[...activityRows.values()];
 identityCollisions(locations,'MONLOC_ID');identityCollisions(activities,'ACTIVITY_ID');
 for(const row of locations)row.ready=!hasError(row);
 for(const row of activities)row.ready=!hasError(row);
 const results=[];
 for(const original of rows) {
  const sk=original.stationKey??identityKey(original.record),ak=original.activityKey??activityKey(original.record);
  const location=locationRows.get(sk),activity=activityRows.get(ak);
  const row={sourceRecordId:original.id,nativeResultId:original.resultId,sourceKey:original.resultKey,
   source:original.source,sourceRecordSha256:original.recordSha256,
   destinationActivityId:activity.destinationId,destinationLocationId:location.destinationId,
   fields:{...activity.fields,...mapped(original.record,RESULT)},changes:[],issues:[],originalLimits:original.limits??[]};
  row.limits=limitsFor(row,opt);
  const override=resultOverrides.get(row.sourceRecordId);
  for(const [k,v]of Object.entries(override?.fields??{}))change(row,k,v,'Saved result receiving choice.');
  row.issues=row.issues.filter(x=>!(x.code==='LIMIT_SLOT_CONFLICT'&&own(override?.fields??{},x.field))&&
    !(x.code==='LIMIT_UNIT_CONFLICT'&&own(override?.fields??{},'DETECTION_LIMIT_UNIT'))&&
    !(x.code==='LIMIT_VALUE_UNIT'&&present(row.fields[x.field])&&present(row.fields.DETECTION_LIMIT_UNIT)));
  cleanCells(row,'S',opt);
  const originalComment=row.fields.RESULT_COMMENT??'';
  const provenance={provider:original.provider,organizationId:original.organizationId,locationId:original.locationId,activityId:original.activityId,resultId:original.resultId,
   recordSha256:original.recordSha256,limits:row.limits.map(({type,value,unit,comment,origin})=>({type,value,unit,comment,origin}))};
  const comment=(originalComment?originalComment+' | ':'')+'WQX source '+JSON.stringify(provenance);
  change(row,'RESULT_COMMENT',comment,'Retain source identity and every reported detection limit inside the native result comment.');
  validateFields(row,'S');nativeResultChecks(row);checkReferences({fields:Object.fromEntries(Object.entries(row.fields).filter(([k])=>!own(SAMPLE,k))),issues:row.issues},'S',opt,refs);
  if(original.duplicate)row.issues.push(issue('EXACT_DUPLICATE',null,'This exact retained source row already has an original occurrence.'));
  if(original.conflictingDuplicate)row.issues.push(issue('SOURCE_RESULT_CONFLICT',null,'The original result has different retained source versions.'));
  if((original.issues??[]).some(x=>['MISSING_RESULT_IDENTITY','MISSING_ACTIVITY_IDENTITY','MISSING_STATION_IDENTITY','ACTIVITY_RESULT_FIELD_DIFFERENCE'].includes(x.code)))
   row.issues.push(issue('SOURCE_JOIN_REVIEW',null,'Review the original source identity or activity/result disagreement before native import.'));
  if(hasError(activity))row.issues.push(issue('ACTIVITY_RECEIVING_CHOICE','ACTIVITY_ID','Complete the matching activity’s receiving choices.'));
  if(hasError(location))row.issues.push(issue('LOCATION_RECEIVING_CHOICE','MONLOC_ID','Complete the matching monitoring-location identity or receiving fields before importing its results.'));
  if(globalIssues.length)row.issues.push(issue('RECEIVING_CONTEXT_REQUIRED',null,'Choose the receiving organization and project.'));
  row.ready=!hasError(row);delete row.originalLimits;results.push(row);
 }
 for(const key of locOverrides.keys())if(!locationRows.has(key))fail('A monitoring-location override does not belong to this saved review.');
 for(const key of actOverrides.keys())if(!activityRows.has(key))fail('An activity override does not belong to this saved review.');
 for(const key of resultOverrides.keys())if(!results.some(x=>x.sourceRecordId===key))fail('A result override does not belong to this saved review.');
 const all=[{issues:globalIssues},...locations,...activities,...results],summary={
  sourceResults:model.rows.length,selectedResults:results.length,distinctActivities:activities.length,distinctStations:locations.length,
  readyResults:results.filter(x=>x.ready).length,reviewResults:results.filter(x=>!x.ready).length,
  readyLocations:locations.filter(x=>x.mode==='create'&&x.ready).length,existingLocations:locations.filter(x=>x.mode==='existing').length,
  issueCounts:issueCounts(all),mappedLimits:results.reduce((n,x)=>n+x.limits.filter(y=>y.targetField).length,0),
  retainedLimits:results.reduce((n,x)=>n+x.limits.filter(y=>!y.targetField).length,0)};
 const content={schema:OPEN_WATERS_SCHEMA,planId,reviewId:review.reviewId,reviewSha256:review.reviewSha256,captureId:review.captureId,captureSha256:review.captureSha256,
  title:review.title,sourceContract:OPEN_WATERS_CONTRACT.source,fieldChoices:OPEN_WATERS_FIELD_CHOICES,options:opt,summary,issues:globalIssues,locations,activities,results,
  references:[...refs.values()].sort((a,b)=>openWatersCanonical([a.kind,a.name,a.value,a.context]).localeCompare(openWatersCanonical([b.kind,b.name,b.value,b.context])))};
 return {...content,planSha256:openWatersHash(content)};
}
export function verifyOpenWatersPlan(plan) {
 if(!plan||plan.schema!==OPEN_WATERS_SCHEMA||!Array.isArray(plan.results)||!Array.isArray(plan.locations)||!Array.isArray(plan.activities))
  fail('Choose a complete saved Open Waters receiving plan.','WQX_OPEN_WATERS_PLAN',409);
 const {planSha256,files,...content}=plan;
 if(openWatersHash(content)!==planSha256)fail('The saved receiving plan changed.','WQX_OPEN_WATERS_PLAN_CHANGED',409);
 return {...content,planSha256};
}
export function openWatersPlanSummary(input) {
 const p=verifyOpenWatersPlan(input);return {planId:p.planId,reviewId:p.reviewId,reviewSha256:p.reviewSha256,planSha256:p.planSha256,
  captureSha256:p.captureSha256,organizationId:p.options.organizationId,projectId:p.options.projectId,title:p.title,summary:p.summary};
}
export function parseOpenWatersPaste(value,level) {
 if(!['M','S'].includes(level)||typeof value!=='string')fail('Choose monitoring-location or sample/result tab text.');
 const lines=value.split(/[\r\n]/).filter(Boolean);
 if(!lines.length)fail('Include the original native import header.');
 const headers=lines[0].split('\t'),mapping=new Map(),known=byLevel[level];
 for(let column=0;column<headers.length;column++) {
  const alias=headers[column].toUpperCase().trim();
  for(const spec of known.values())if(spec.aliases.some(x=>x.toUpperCase().trim()===alias)) {
   if(mapping.has(spec.name))fail('Two headers map to the same native field '+spec.name+'.');
   mapping.set(spec.name,column);
  }
 }
 if(mapping.size!==headers.length)fail('Every exported header must match exactly one native alias.');
 return {headers,fields:[...mapping.keys()],rows:lines.slice(1).map((line,index)=>{
  const cells=line.split('\t');if(cells.length!==headers.length)fail('Native row '+(index+2)+' has a different column count.');
  return Object.fromEntries([...mapping].map(([name,column])=>[name,cells[column]]));
 })};
}
function paste(plan,level) {
 const rows=(level==='M'?plan.locations.filter(x=>x.mode==='create'&&x.ready):plan.results.filter(x=>x.ready));
 const columns=fields.filter(x=>x.level===level&&(x.required||rows.some(row=>present(row.fields[x.name]))));
 const lines=[columns.map(x=>x.aliases[0]).join('\t')];
 for(const row of rows)lines.push(columns.map(x=>row.fields[x.name]??'').join('\t'));
 const value=lines.join('\r\n')+'\r\n',parsed=parseOpenWatersPaste(value,level);
 for(let i=0;i<rows.length;i++)for(const spec of columns)if(parsed.rows[i][spec.name]!==text(rows[i].fields[spec.name]))
  fail('A prepared tab value changed while rendering.','WQX_OPEN_WATERS_PASTE_CHANGED',409);
 return value;
}
const html = value => text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvCell = value => '"'+text(value).replaceAll('"','""')+'"';
export function renderOpenWatersReport(input) {
 const p=verifyOpenWatersPlan(input),s=p.summary;
 const table=(headers,rows)=>'<table><thead><tr>'+headers.map(x=>'<th>'+html(x)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(x=>'<td>'+html(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const issues=[...p.issues.map(x=>['Receiving context','',x.field,x.code,x.message]),
  ...p.locations.flatMap(x=>x.issues.map(i=>['Monitoring location',x.sourceId,i.field,i.code,i.message])),
  ...p.activities.flatMap(x=>x.issues.map(i=>['Activity',x.sourceId,i.field,i.code,i.message])),
  ...p.results.flatMap(x=>x.issues.map(i=>['Result',x.nativeResultId,i.field,i.code,i.message]))];
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html(p.title)+' / Open Waters</title>'+
 '<style>body{font:14px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1500px;margin:32px}h1{font-size:25px}h2{font-size:19px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}code{overflow-wrap:anywhere}p{max-width:100ch}@media(max-width:700px){body{margin:14px}table{display:block;overflow:auto}}</style>'+
 '<h1>'+html(p.title)+' — Open Waters receiving</h1><p>Organization '+html(p.options.organizationId)+' · project '+html(p.options.projectId)+' · saved plan '+html(p.planId??'preview')+'</p>'+
 '<p>'+s.selectedResults+' selected original results; '+s.readyResults+' locally compatible result rows; '+s.reviewResults+' results with receiving choices; '+s.distinctActivities+' original activities.</p>'+
 '<h2>Receive the prepared data</h2><ol><li>Open the stated receiving organization and project in Open Waters. Retain its normal backup and existing activity inventory before import.</li>'+
 '<li>Review the reference requirements and identity crosswalk. Add or select the exact original methods and accepted reference values in the native Reference Data screen.</li>'+
 '<li>For new locations, open Import Data → Monitoring Locations and paste the complete locations TSV, including headers, using the standard column layout. Review and complete that original native import.</li>'+
 '<li>Open Import Data → Samples / Results, choose the receiving project, and paste the complete prepared results TSV including headers with the standard layout. The file contains '+s.readyResults+' locally compatible rows. Complete the native validation screen and reconcile those activities against this crosswalk.</li>'+
 '<li>Resolve the remaining receiving choices in the saved workspace and save a new plan. Use the original plan and native activity inventory to avoid importing the same result twice.</li>'+
 '<li>Retain the complete bundle alongside the native import record. It contains the saved review, original capture, original native identifiers, mapping choices and full result/limit crosswalk.</li></ol>'+
 '<p>Open Waters applies its receiving organization’s reference tables, configured translations and characteristic defaults. The native validation page supplies the receiving database result. Its EPA submission option is a separate scientific and organizational decision.</p>'+
 '<h2>Original source and saved choices</h2><p>Capture <code>'+html(p.captureSha256)+'</code><br>Review <code>'+html(p.reviewSha256)+'</code><br>Plan <code>'+html(p.planSha256)+'</code></p><p>'+html(p.options.notes)+'</p>'+
 '<h2>Monitoring locations</h2>'+table(['Original identity','Receiving ID','Mode','Locally compatible'],p.locations.map(x=>[x.sourceKey,x.destinationId,x.mode,x.ready?'Yes':'Receiving choice']))+
 '<h2>Activity crosswalk</h2>'+table(['Original identity','Receiving ID','Reported local date','Locally compatible'],p.activities.map(x=>[x.sourceKey,x.destinationId,x.fields.ACT_START_DT,x.ready?'Yes':'Receiving choice']))+
 '<h2>Receiving references</h2>'+table(['Kind','Reference','Value','Context','Occurrences','Supplied catalog match'],p.references.map(x=>[x.kind,x.name,x.value,x.context,x.count,x.matched===null?'Native receiving check':x.matched?'Matched':'Choose native value']))+
 '<h2>Receiving choices</h2>'+table(['Source kind','Source ID','Receiving field','Reason','Detail'],issues)+
 '<h2>Field and limit choices</h2>'+table(['Field or limit type','Original value','Receiving representation','Reason'],[
 ...p.options.fieldTranslations.map(x=>[x.field,x.from,x.to,x.reason]),...p.options.limitMappings.map(x=>[x.type,'Reported value',x.field??'Original source and comment',x.reason])])+
 '<h2>Upstream interface</h2><p><a href="https://github.com/open-environment/open-waters">Open Environment / Open Waters</a>, '+html(p.sourceContract.directory)+
 '/App_Docs/ImportColumnsConfig.xml, Git blob <code>'+html(p.sourceContract.configurationBlob)+'</code>. The source-backed adapter matches the published aliases, field sizes and unquoted tab/line parsing.</p></html>';
}
export function openWatersArtifact(input,format) {
 const plan=verifyOpenWatersPlan(input),name=plan.planId??'open-waters-preview';
 if(format==='locations')return {bytes:Buffer.from(paste(plan,'M')),mime:'text/tab-separated-values; charset=utf-8',filename:name+'-locations.tsv'};
 if(format==='results')return {bytes:Buffer.from(paste(plan,'S')),mime:'text/tab-separated-values; charset=utf-8',filename:name+'-results.tsv'};
 if(format==='crosswalk')return {bytes:Buffer.from(json(plan)),mime:'application/json',filename:name+'-crosswalk.json'};
 if(format==='report')return {bytes:Buffer.from(renderOpenWatersReport(plan)),mime:'text/html; charset=utf-8',filename:name+'-receiving.html'};
 if(format==='references') {
  const columns=['kind','name','value','context','count','matched'];
  return {bytes:Buffer.from([columns.map(csvCell).join(','),...plan.references.map(row=>columns.map(k=>csvCell(row[k]===null?'':row[k])).join(','))].join('\r\n')+'\r\n'),
   mime:'text/csv; charset=utf-8',filename:name+'-references.csv'};
 }
 fail('Choose locations, results, crosswalk, report, references, or the complete project bundle.');
}
