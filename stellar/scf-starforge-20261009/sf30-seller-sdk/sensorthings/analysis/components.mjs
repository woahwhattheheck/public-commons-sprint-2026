// MIT. Explicit positional analysis of retained SensorThings MultiDatastreams.
// Source arrays, original identifiers and scalar observation eligibility are unchanged.
import {OBSERVATION_COLUMNS,graphIndex,observationRows} from '../domain.mjs';
import {JsonNumber,entityId,numericId,fields,plain,identity,stable,sourceDocument,valueCell,instant,integer,text,fault} from '../contract.mjs';

export const COMPONENT_SCHEMA='stellar-forge.sensorthings-component-selection.v1';
export const COMPONENT_LIMITS=Object.freeze({selections:80,index:4095,rows:250000,pageRows:500,inventoryValues:200});
const HASH=/^[a-f0-9]{64}$/;
const OM='http://www.opengis.net/def/observationType/OGC-OM/2.0/';
export const COMPONENT_OM_TYPES=Object.freeze(['OM_CategoryObservation','OM_CountObservation','OM_Measurement','OM_Observation','OM_TruthObservation'].map(x=>OM+x));
export const COMPONENT_MEANING=Object.freeze({
  positions:'Zero-based positions in the original result, unitOfMeasurements, multiObservationDataTypes and ordered ObservedProperties; no positional sorting or unit conversion.',
  interpretation:'source-declared retains the original declared result type. numeric-json is an explicit operator interpretation of actual JSON numeric tokens and does not repair or certify a source declaration.',
  numbers:'Original numeric lexemes are retained. Exact decimal sample totals and extrema are separate from finite-number browser rendering.',
  time:'Explicit phenomenonTime events and intervals are retained. Missing or unresolved times remain unplaced; adjacent observations do not establish continuous coverage.',
  quality:'Original quality declarations and their absence are reported; neither is an automatic quality approval.',
  identity:'Each component keeps its parent observation occurrence, original observation identifier, component position and exact metadata binding.',
  comparison:'Retained editions and declared source scopes are compared; insertions, removals and metadata differences do not establish transactional snapshots or deletion at the service.',
  standards:'OGC SensorThings 1.1 section 12, requirement 42, and table 12: https://docs.ogc.org/is/18-088/18-088.html'
});
export const COMPONENT_COLUMNS=Object.freeze([...OBSERVATION_COLUMNS,
  'source_result','source_result_state','source_result_type','source_observation_type','source_observed_property','source_unit',
  'source_stream_key','component_series_key','component_index','component_name','component_binding_id','component_meaning_id',
  'component_occurrence_id','component_property','component_unit','component_observation_type','component_value','component_value_state',
  'component_value_type','component_result_pointer','component_source_pointer','component_pointer_state','component_alignment','component_interpretation','component_interpretation_note',
  'component_acknowledged_issues','component_declaration_issues','component_numeric_basis']);

function requireHash(value,label){if(!HASH.test(value??''))throw fault('ANALYSIS_COMPONENT_ID','Select an exact '+label+'.');return value;}
function count(map,key){map[key]=(map[key]??0)+1;}
function jsonOriginal(value){return value===undefined?null:JSON.stringify(value);}
function safeId(value){try{return entityId(value);}catch{return null;}}
function sourceEntity(item){return {entity:JSON.parse(JSON.stringify(item.record)),sourceJson:JSON.stringify(item.record),sourceRef:item.sourceRef};}
function unitIssue(unit){
  return !(plain(unit)&&['name','symbol','definition'].every(k=>Object.hasOwn(unit,k)&&(unit[k]===null||typeof unit[k]==='string')));
}

// This pure boundary also supports a factual report over acquired originals.
// sourceIdentity is either an actual immutable native edition or a named original
// source manifest; a file analysis is never assigned a fabricated native edition ID.
export function bindComponentMetadata({sourceIdentity,streamKey,streamId,streamRecord,streamSourceRef,observedProperties}){
  if(!plain(sourceIdentity)||!plain(streamRecord)||!Array.isArray(observedProperties)||typeof streamKey!=='string'||!streamKey)
    throw fault('ANALYSIS_COMPONENT_METADATA','Supply the exact original stream and ordered property records.');
  if(sourceIdentity.kind==='native-edition')requireHash(sourceIdentity.id,'native source edition');
  else if(sourceIdentity.kind==='received-originals')requireHash(sourceIdentity.manifestSha256,'original source manifest');
  else throw fault('ANALYSIS_COMPONENT_METADATA','Use a native edition or retained original source manifest identity.');
  const units=Array.isArray(streamRecord.unitOfMeasurements)?streamRecord.unitOfMeasurements:[],
    types=Array.isArray(streamRecord.multiObservationDataTypes)?streamRecord.multiObservationDataTypes:[],
    properties=observedProperties,issues=[];
  if(!Array.isArray(streamRecord.unitOfMeasurements))issues.push('COMPONENT_UNITS_NOT_ARRAY');
  if(!Array.isArray(streamRecord.multiObservationDataTypes))issues.push('COMPONENT_TYPES_NOT_ARRAY');
  if(streamRecord.observationType!==OM+'OM_ComplexObservation')issues.push('COMPLEX_OBSERVATION_TYPE_NOT_DECLARED');
  if(!properties.length)issues.push('COMPONENT_PROPERTIES_UNAVAILABLE');
  const aligned=units.length===types.length&&types.length===properties.length&&properties.length>0;
  if(!aligned)issues.push('COMPONENT_METADATA_LENGTH_MISMATCH');
  const n=Math.max(units.length,types.length,properties.length);
  if(n>COMPONENT_LIMITS.index+1)throw fault('ANALYSIS_COMPONENT_CAPACITY','The declared component array exceeds 4,096 positions.',413);
  const propertyKeys=properties.map(x=>safeId(x.record?.['@iot.id'])?.key??null),
    duplicateProperties=propertyKeys.some((key,i)=>key&&propertyKeys.indexOf(key)!==i);
  // Repeated property IDs may be meaningful (for example, multiple depths).
  // They are retained as positional metadata and never collapsed by ID.
  const components=[];
  for(let index=0;index<n;index++){
    const p=properties[index],unit=units[index],declaredType=types[index],local=[...issues];
    if(!p||!plain(p.record))local.push('COMPONENT_PROPERTY_UNAVAILABLE');
    if(unitIssue(unit))local.push('COMPONENT_UNIT_DECLARATION_MALFORMED');
    if(!COMPONENT_OM_TYPES.includes(declaredType))local.push('COMPONENT_TYPE_NOT_TABLE12_VALUE');
    const property=p?sourceEntity(p):null,
      meaning={index,propertyJson:property?.sourceJson??null,unit:valueCell(unit),declaredType:valueCell(declaredType),
        complexObservationType:valueCell(streamRecord.observationType),metadataCounts:{properties:properties.length,units:units.length,types:types.length}},
      meaningId=identity(meaning),
      binding={schema:COMPONENT_SCHEMA,sourceIdentity,streamKey,streamId,index,meaningId,streamSourceRef,
        streamSourceJson:JSON.stringify(streamRecord),orderedProperties:properties.map(x=>({sourceJson:JSON.stringify(x.record),sourceRef:x.sourceRef}))},
      bindingId=identity(binding),seriesKey='component-'+identity({streamKey,index,meaningId}).slice(0,40);
    components.push({index,bindingId,meaningId,seriesKey,name:typeof p?.record?.name==='string'?p.record.name:'Component '+index,
      property,unit:unit===undefined?null:JSON.parse(JSON.stringify(unit)),unitState:valueCell(unit).state,unitJson:jsonOriginal(unit),
      declaredType:declaredType===undefined?null:declaredType,declaredTypeState:valueCell(declaredType).state,
      declaredTypeRecognized:COMPONENT_OM_TYPES.includes(declaredType),numericTypeDeclared:[OM+'OM_Measurement',OM+'OM_CountObservation'].includes(declaredType),
      metadataAligned:aligned,declaredComponentCount:units.length,sourceRef:streamSourceRef,issues:[...new Set(local)],binding});
  }
  return {sourceIdentity,streamKey,streamId,sourceRef:streamSourceRef,sourceJson:JSON.stringify(streamRecord),
    name:typeof streamRecord.name==='string'?streamRecord.name:'',description:typeof streamRecord.description==='string'?streamRecord.description:'',
    observationType:valueCell(streamRecord.observationType),metadataCounts:{properties:properties.length,units:units.length,types:types.length},
    metadataAligned:aligned,duplicatePropertyIdsRetained:duplicateProperties,issues:[...new Set(issues)],components};
}
export async function componentCatalog(store,edition,{streamKeys=null,graph=null}={}){
  graph??=await graphIndex(store,edition);
  const selected=edition.plan.streams.filter(x=>x.kind==='MultiDatastreams'&&(!streamKeys||streamKeys.includes(x.key))),streams=[];
  if(streamKeys&&selected.length!==new Set(streamKeys).size)throw fault('ANALYSIS_COMPONENT_STREAM','Select retained MultiDatastreams only.');
  for(const chosen of selected){
    const item=graph.streams.get(chosen.key);
    if(!item)throw fault('ANALYSIS_COMPONENT_METADATA','The beginning MultiDatastream metadata is not retained.',409);
    const descriptor=bindComponentMetadata({sourceIdentity:{kind:'native-edition',id:edition.id},streamKey:chosen.key,streamId:chosen.id,
      streamRecord:item.record,streamSourceRef:item.sourceRef,observedProperties:graph.relation(item,'ObservedProperties')}),
      things=graph.relation(item,'Thing'),sensors=graph.relation(item,'Sensor'),locations=things.flatMap(t=>graph.relation(t,'Locations'));
    streams.push({...descriptor,kind:'MultiDatastreams',things:things.map(sourceEntity),sensors:sensors.map(sourceEntity),locations:locations.map(sourceEntity)});
  }
  return {schema:'stellar-forge.sensorthings-component-catalogue.v1',editionId:edition.id,streams,sourceScope:edition.scope,
    sourceIssues:edition.issues,license:edition.source.license,meaning:COMPONENT_MEANING};
}
function normalizePeriod(value){
  if(value===null)return null;
  fields(value,['start','end'],['start','end']);const a=instant(value.start),b=instant(value.end);
  if(!a.utc||!b.utc||a.utc>=b.utc)throw fault('ANALYSIS_COMPONENT_PERIOD','Choose an increasing explicitly offset-qualified start and exclusive end.');
  return {start:value.start,end:value.end,startUtc:a.utc,endUtc:b.utc};
}
export function normalizeComponentSelection(input,edition){
  fields(input,['streamKeys','componentSelections','period','view','timeBasis','viewerId'],['streamKeys','componentSelections','period','view']);
  if(!Array.isArray(input.streamKeys)||input.streamKeys.length<1||input.streamKeys.length>20||new Set(input.streamKeys).size!==input.streamKeys.length)
    throw fault('ANALYSIS_COMPONENT_STREAM','Choose one to twenty distinct retained MultiDatastreams.');
  for(const key of input.streamKeys)if(!edition.plan.streams.some(x=>x.key===key&&x.kind==='MultiDatastreams'))
    throw fault('ANALYSIS_COMPONENT_STREAM','Each component must belong to a retained MultiDatastream.');
  if(!Array.isArray(input.componentSelections)||!input.componentSelections.length||input.componentSelections.length>COMPONENT_LIMITS.selections)
    throw fault('ANALYSIS_COMPONENT_SELECTION','Choose one to eighty explicit component positions.');
  if(!['events','numeric','map'].includes(input.view))throw fault('ANALYSIS_COMPONENT_VIEW','Choose events, numeric or map.');
  if(input.timeBasis!==undefined&&input.timeBasis!=='phenomenonTime')throw fault('ANALYSIS_COMPONENT_TIME','Keep phenomenonTime as the view basis; resultTime and validTime remain separate.');
  const seen=new Set(),covered=new Set(),componentSelections=input.componentSelections.map(c=>{
    fields(c,['streamKey','index','bindingId','interpretation'],['streamKey','index','bindingId','interpretation']);
    if(!input.streamKeys.includes(c.streamKey))throw fault('ANALYSIS_COMPONENT_STREAM','A selected component belongs to an unselected stream.');
    integer(c.index,'zero-based component index',0,COMPONENT_LIMITS.index);requireHash(c.bindingId,'component metadata binding');
    const key=c.streamKey+'/'+c.index;if(seen.has(key))throw fault('ANALYSIS_COMPONENT_SELECTION','Select each original stream position once.');
    seen.add(key);covered.add(c.streamKey);
    fields(c.interpretation,['mode','acknowledgedIssues','note'],['mode','acknowledgedIssues','note']);
    const v=c.interpretation;
    if(!['source-declared','numeric-json'].includes(v.mode)||!Array.isArray(v.acknowledgedIssues)||new Set(v.acknowledgedIssues).size!==v.acknowledgedIssues.length||
      v.acknowledgedIssues.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9_]{1,120}$/.test(x)))
      throw fault('ANALYSIS_COMPONENT_INTERPRETATION','Choose an explicit interpretation and distinct original declaration issue codes.');
    if(typeof v.note!=='string'||v.note.length>8000||(v.mode==='numeric-json'&&!v.note.trim()))
      throw fault('ANALYSIS_COMPONENT_INTERPRETATION','Numeric JSON interpretation needs the operator reasoning, up to 8,000 characters.');
    return {streamKey:c.streamKey,index:c.index,bindingId:c.bindingId,
      interpretation:{mode:v.mode,acknowledgedIssues:[...v.acknowledgedIssues],note:v.note}};
  });
  if(covered.size!==input.streamKeys.length)throw fault('ANALYSIS_COMPONENT_SELECTION','Choose at least one position for each selected source stream.');
  return {streamKeys:[...input.streamKeys],componentSelections,period:normalizePeriod(input.period),view:input.view,
    viewerId:input.viewerId==null?null:requireHash(input.viewerId,'installed viewer'),timeBasis:'phenomenonTime',
    intervalPolicy:'source-explicit-only',instantPolicy:'events-only',unresolvedTimePolicy:'retain-unplaced',componentPolicy:'explicit-original-position'};
}
export function validateComponentChoice(choice,descriptor){
  if(!descriptor||descriptor.bindingId!==choice.bindingId)throw fault('ANALYSIS_COMPONENT_BINDING','The component metadata or source identity changed. Select and review the exact new binding.',409);
  const unknown=choice.interpretation.acknowledgedIssues.filter(x=>!descriptor.issues.includes(x));
  if(unknown.length)throw fault('ANALYSIS_COMPONENT_INTERPRETATION','Acknowledgments must cite this exact original component declaration.',409);
  if(choice.interpretation.mode==='numeric-json'){
    if(!descriptor.metadataAligned||descriptor.property===null||descriptor.unitState==='missing')
      throw fault('ANALYSIS_COMPONENT_ALIGNMENT','Numeric interpretation cannot resolve missing or differently sized source metadata arrays.',409);
    const unresolved=descriptor.issues.filter(x=>!choice.interpretation.acknowledgedIssues.includes(x));
    if(unresolved.length)throw fault('ANALYSIS_COMPONENT_INTERPRETATION','Acknowledge every retained declaration issue before interpreting this component numerically.',409);
  }
  return descriptor;
}
export async function validateComponentBindings(store,edition,selection,{graph=null}={}){
  const normalized=normalizeComponentSelection({streamKeys:selection.streamKeys,componentSelections:selection.componentSelections,period:selection.period?
    {start:selection.period.start,end:selection.period.end}:null,view:selection.view,timeBasis:selection.timeBasis,viewerId:selection.viewerId},edition);
  if(stable(normalized)!==stable(selection))throw fault('ANALYSIS_COMPONENT_SELECTION','The retained selection differs from its normalized original contract.',409);
  const catalogue=await componentCatalog(store,edition,{streamKeys:selection.streamKeys,graph}),bound=[];
  for(const choice of selection.componentSelections){
    const stream=catalogue.streams.find(x=>x.streamKey===choice.streamKey),descriptor=stream?.components.find(x=>x.index===choice.index);
    validateComponentChoice(choice,descriptor);
    bound.push({choice,descriptor,stream});
  }
  return {catalogue,bound};
}
function sourceStreamKey(row,edition){return edition.plan.streams.find(x=>x.kind===row.stream_kind&&x.id.type===row.stream_id_type&&x.id.value===row.stream_id)?.key??null;}
function inPeriod(row,selection){
  if(!selection.period)return true;
  const t=row.phenomenon_start_utc,e=row.phenomenon_end_utc,{startUtc:a,endUtc:b}=selection.period;
  if(!t||!['explicit_instant','explicit_interval'].includes(row.phenomenon_time_kind))return true;
  return row.phenomenon_time_kind==='explicit_interval'?t<b&&e>a:t>=a&&t<b;
}
export function projectComponentRow(value,{choice,descriptor,stream}){
  const source=value.row,record=sourceDocument(Buffer.from(source.observation_json,'utf8')),array=Array.isArray(record.result),
    supplied=array&&Object.hasOwn(record.result,choice.index),cell=array?valueCell(supplied?record.result[choice.index]:undefined):{state:'unavailable',type:'unavailable',value:''},
    aligned=array&&descriptor.metadataAligned&&record.result.length===descriptor.declaredComponentCount,
    issues=[...JSON.parse(source.issues||'[]'),...descriptor.issues];
  if(!array)issues.push('MULTIDATASTREAM_RESULT_NOT_ARRAY');
  else if(!supplied)issues.push('SELECTED_COMPONENT_MISSING');
  if(array&&!aligned)issues.push('COMPONENT_RESULT_LENGTH_MISMATCH');
  const requestedComponentPointer=value.original.sourceRef.jsonPointer+'/result/'+choice.index,
    pointerState=supplied?'present':array?'missing':Object.hasOwn(record,'result')?'parent_not_array':'result_missing',
    componentSourceRef={...value.original.sourceRef,jsonPointer:supplied?requestedComponentPointer:
      Object.hasOwn(record,'result')?value.original.sourceRef.jsonPointer+'/result':value.original.sourceRef.jsonPointer},
    componentOccurrenceId=identity({observationOccurrenceId:value.original.occurrenceId,index:choice.index,bindingId:descriptor.bindingId}),
    row={...source,source_result:source.result,source_result_state:source.result_state,source_result_type:source.result_type,
      source_observation_type:source.observation_type,source_observed_property:source.observed_property,source_unit:source.unit,
      // These display fields are an explicitly identified component projection.
      // The complete original fields and observation JSON remain alongside them.
      result:cell.value,result_state:cell.state,result_type:cell.type,
      observation_type:typeof descriptor.declaredType==='string'?descriptor.declaredType:'',
      observed_property:JSON.stringify(descriptor.property?[{entity:JSON.parse(descriptor.property.sourceJson),source:descriptor.property.sourceRef}]:[]),
      unit:descriptor.unitJson??'',source_stream_key:choice.streamKey,component_series_key:descriptor.seriesKey,
      component_index:String(choice.index),component_name:descriptor.name,component_binding_id:descriptor.bindingId,component_meaning_id:descriptor.meaningId,
      component_occurrence_id:componentOccurrenceId,component_property:descriptor.property?.sourceJson??'',component_unit:descriptor.unitJson??'',
      component_observation_type:typeof descriptor.declaredType==='string'?descriptor.declaredType:'',
      component_value:cell.value,component_value_state:cell.state,component_value_type:cell.type,
      component_result_pointer:requestedComponentPointer,component_source_pointer:componentSourceRef.jsonPointer,component_pointer_state:pointerState,component_alignment:aligned?'aligned':'unresolved',
      component_interpretation:choice.interpretation.mode,component_interpretation_note:choice.interpretation.note,
      component_acknowledged_issues:JSON.stringify(choice.interpretation.acknowledgedIssues),
      component_declaration_issues:JSON.stringify(descriptor.issues),
      component_numeric_basis:choice.interpretation.mode==='numeric-json'?'explicit_original_json_number_interpretation':'original_declared_observation_type',
      issues:JSON.stringify([...new Set(issues)])},
    original={...value.original,observationKey:value.original.key,
      key:value.original.key?value.original.key+'/component/'+choice.index:null,
      semanticHash:identity({observation:{...record,result:supplied?record.result[choice.index]:null},originalResultState:valueCell(record.result).state,
        originalArrayLength:array?record.result.length:null,componentMeaningId:descriptor.meaningId,index:choice.index,value:cell,interpretation:choice.interpretation}),
      parentSemanticHash:value.original.semanticHash,componentSourceRef,componentOccurrenceId,componentPointerState:pointerState};
  return {row,original,streamKey:descriptor.seriesKey,sourceStreamKey:choice.streamKey,component:{choice,descriptor},sourceStream:stream};
}
function componentNumberIdentity(row){
  if(row.component_alignment!=='aligned')return {eligible:false,reason:'original_component_alignment_unresolved'};
  if(row.result_state!=='value'||row.result_type!=='number')return {eligible:false,reason:'not_an_original_json_number'};
  if(row.component_interpretation==='source-declared'&&![OM+'OM_Measurement',OM+'OM_CountObservation'].includes(row.component_observation_type))
    return {eligible:false,reason:'component_type_not_declared_numeric'};
  if(!['source-declared','numeric-json'].includes(row.component_interpretation))return {eligible:false,reason:'component_interpretation_unavailable'};
  if(row.phenomenon_time_kind!=='explicit_instant')return {eligible:false,reason:'phenomenon_time_not_an_explicit_instant'};
  let exact;try{exact=numericId(new JsonNumber(row.result));}catch{return {eligible:false,reason:'invalid_original_number'};}
  if(row.component_interpretation==='source-declared'&&row.component_observation_type===OM+'OM_CountObservation'&&exact!=='0'&&BigInt(exact.slice(exact.lastIndexOf('e')+1))<0n)
    return {eligible:false,reason:'declared_count_is_not_integral'};
  return {eligible:true,reason:null,canonical:exact};
}
export function componentExactEligibility(row){
  const base=componentNumberIdentity(row);if(!base.eligible)return base;
  const exponent=base.canonical==='0'?0n:BigInt(base.canonical.slice(base.canonical.lastIndexOf('e')+1));
  if(exponent>4096n||exponent< -4096n)return {eligible:false,reason:'outside_exact_decimal_exponent_range'};
  return {eligible:true,reason:null,basis:row.component_numeric_basis,representation:'bounded-exact-decimal',exponentBound:4096,sourceDeclarationRewritten:false};
}
export function componentNumericEligibility(row){
  const base=componentNumberIdentity(row);if(!base.eligible)return base;
  const exact=base.canonical,browser=Number(row.result);
  if(!Number.isFinite(browser))return {eligible:false,reason:'outside_finite_browser_range'};
  if(browser===0&&exact!=='0')return {eligible:false,reason:'nonzero_result_underflows_in_browser'};
  return {eligible:true,reason:null,basis:row.component_numeric_basis,sourceDeclarationRewritten:false};
}
export async function* selectedComponentRows(store,edition,selection){
  const graph=await graphIndex(store,edition),{bound}=await validateComponentBindings(store,edition,selection,{graph}),
    byStream=new Map();let countRows=0;
  for(const b of bound){const rows=byStream.get(b.choice.streamKey)??[];rows.push(b);byStream.set(b.choice.streamKey,rows);}
  for await(const value of observationRows(store,edition,{graph})){
    const key=sourceStreamKey(value.row,edition),choices=byStream.get(key);
    if(!choices||!inPeriod(value.row,selection))continue;
    for(const b of choices){
      if(++countRows>COMPONENT_LIMITS.rows)throw fault('ANALYSIS_COMPONENT_CAPACITY','The selected view exceeds 250,000 component occurrences; select fewer positions or a smaller source window.',413);
      yield projectComponentRow(value,b);
    }
  }
}

function decimal(value){
  const canonical=numericId(new JsonNumber(value));
  if(canonical==='0')return {n:0n,e:0};
  const at=canonical.lastIndexOf('e'),e=BigInt(canonical.slice(at+1));
  if(e>4096n||e< -4096n)throw fault('ANALYSIS_COMPONENT_NUMBER','The exact decimal exponent exceeds the bounded analysis representation.');
  return {n:BigInt(canonical.slice(0,at)),e:Number(e)};
}
function decimalAdd(a,b){
  if(a.n===0n)return {...b};if(b.n===0n)return {...a};
  const e=Math.min(a.e,b.e);return {n:a.n*10n**BigInt(a.e-e)+b.n*10n**BigInt(b.e-e),e};
}
function decimalCompare(a,b){const d=decimalAdd(a,{n:-b.n,e:b.e});return d.n<0n?-1:d.n>0n?1:0;}
function decimalText(value){
  let {n,e}=value;if(n===0n)return '0';const sign=n<0n?'-':'';if(n<0n)n=-n;
  let digits=String(n);while(digits.endsWith('0')){digits=digits.slice(0,-1);e++;}
  if(e>=0&&digits.length+e<=4096)return sign+digits+'0'.repeat(e);
  if(e<0&&-e<=4096){const p=digits.length+e;return sign+(p>0?digits.slice(0,p)+'.'+digits.slice(p):'0.'+'0'.repeat(-p)+digits);}
  return sign+digits+'e'+e;
}
function decimalMean(sum,countValues,places=12){
  if(!countValues)return null;
  let n=sum.n,denominator=BigInt(countValues),e=sum.e+places;
  if(e>=0)n*=10n**BigInt(e);else denominator*=10n**BigInt(-e);
  const negative=n<0n;if(negative)n=-n;
  let q=n/denominator;const remainder=n%denominator;
  if(remainder*2n>denominator||(remainder*2n===denominator&&q%2n===1n))q++;
  if(negative)q=-q;
  return {exactNumerator:decimalText(sum),exactDenominator:String(countValues),decimal:decimalText({n:q,e:-places}),
    decimalPlaces:places,rounding:'half-even',meaning:'Arithmetic mean of selected original eligible samples, without time weighting.'};
}
function numberAccumulator(){return {count:0,sum:{n:0n,e:0},min:null,max:null};}
function accumulateNumber(a,row,sourceRef){
  const v=decimal(row.result),evidence={lexeme:row.result,sourceRef,observationId:row.observation_id,
    observationIdType:row.observation_id_type,observationOccurrenceId:row.occurrence_id,componentIndex:Number(row.component_index),
    componentOccurrenceId:row.component_occurrence_id,phenomenonTime:row.phenomenon_time};
  a.count++;a.sum=decimalAdd(a.sum,v);
  if(a.min===null||decimalCompare(v,a.min.value)<0)a.min={value:v,evidence};
  if(a.max===null||decimalCompare(v,a.max.value)>0)a.max={value:v,evidence};
}
function finishNumbers(a){
  return {count:a.count,sumExact:a.count?decimalText(a.sum):null,mean:decimalMean(a.sum,a.count),
    minimum:a.min?.evidence??null,maximum:a.max?.evidence??null,
    rangeExact:a.count?decimalText(decimalAdd(a.max.value,{n:-a.min.value.n,e:a.min.value.e})):null,
    continuousDuration:null,timeWeightedMean:null,unitConversion:null};
}
function utcNanoseconds(utc){
  const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(utc??'');if(!m)return null;
  const milliseconds=Date.parse(m[1]+'Z');if(!Number.isFinite(milliseconds))return null;
  return BigInt(milliseconds)*1000000n+BigInt((m[2]??'').padEnd(9,'0')||'0');
}
function inventory(a,state,value){
  const key=identity({state,value}),old=a.values.get(key);if(old){old.count++;return;}
  if(a.values.size>=COMPONENT_LIMITS.inventoryValues){a.omittedOccurrences++;return;}
  a.values.set(key,{state,value,count:1});
}
function finishInventory(a){return {values:[...a.values.values()],omittedOccurrences:a.omittedOccurrences,maximumDistinctValues:COMPONENT_LIMITS.inventoryValues};}
export function createComponentStatistics(){
  return {rows:0,resultStates:Object.create(null),resultTypes:Object.create(null),categories:{values:new Map(),omittedOccurrences:0},
    quality:{values:new Map(),omittedOccurrences:0},timeKinds:Object.create(null),qualityStates:Object.create(null),
    numericEligibleRows:0,numericExcludedRows:0,numericExclusionReasons:Object.create(null),
    exactNumericEligibleRows:0,exactNumericExcludedRows:0,exactNumericExclusionReasons:Object.create(null),
    declarationIssueCounts:Object.create(null),rowIssueCounts:Object.create(null),numeric:numberAccumulator(),days:new Map(),times:new Map(),
    observationKeys:new Map(),componentOccurrences:new Set(),firstUtc:null,lastUtc:null,instantEvents:0,explicitIntervals:0,unplacedOccurrences:0};
}
export function accumulateComponentStatistics(s,value){
  const {row,original}=value;s.rows++;count(s.resultStates,row.result_state);count(s.resultTypes,row.result_type);
  count(s.timeKinds,row.phenomenon_time_kind);count(s.qualityStates,row.result_quality_state);
  inventory(s.quality,row.result_quality_state,row.result_quality);
  if(row.result_state==='value'&&row.result_type!=='number')inventory(s.categories,row.result_type,row.result);
  for(const code of JSON.parse(row.component_declaration_issues||'[]'))count(s.declarationIssueCounts,code);
  for(const code of JSON.parse(row.issues||'[]'))count(s.rowIssueCounts,code);
  if(row.phenomenon_time_kind==='explicit_instant'){
    s.instantEvents++;s.times.set(row.phenomenon_start_utc,(s.times.get(row.phenomenon_start_utc)??0)+1);
  }else if(row.phenomenon_time_kind==='explicit_interval')s.explicitIntervals++;else s.unplacedOccurrences++;
  if(row.phenomenon_start_utc&&['explicit_instant','explicit_interval'].includes(row.phenomenon_time_kind)){
    if(!s.firstUtc||row.phenomenon_start_utc<s.firstUtc)s.firstUtc=row.phenomenon_start_utc;
    const end=row.phenomenon_end_utc||row.phenomenon_start_utc;if(!s.lastUtc||end>s.lastUtc)s.lastUtc=end;
  }
  if(original.key){const list=s.observationKeys.get(original.key)??[];list.push(original.semanticHash);s.observationKeys.set(original.key,list);}
  s.componentOccurrences.add(row.component_occurrence_id);
  const numeric=componentNumericEligibility(row),exact=componentExactEligibility(row);
  if(numeric.eligible)s.numericEligibleRows++;
  else{s.numericExcludedRows++;count(s.numericExclusionReasons,numeric.reason);}
  if(exact.eligible){s.exactNumericEligibleRows++;accumulateNumber(s.numeric,row,original.componentSourceRef);}
  else{s.exactNumericExcludedRows++;count(s.exactNumericExclusionReasons,exact.reason);}
  if(row.phenomenon_time_kind==='explicit_instant'&&row.phenomenon_start_utc){
    const day=row.phenomenon_start_utc.slice(0,10),d=s.days.get(day)??{day,events:0,numeric:numberAccumulator(),qualityStates:Object.create(null),missingResults:0};
    d.events++;count(d.qualityStates,row.result_quality_state);if(row.result_state!=='value')d.missingResults++;
    if(exact.eligible)accumulateNumber(d.numeric,row,original.componentSourceRef);s.days.set(day,d);
  }
}
export function finishComponentStatistics(s){
  const ordered=[...s.times.keys()].sort(),gaps=new Map(),adjacentGaps=[];let largest=null;
  const detailLimit=10000;
  for(let i=1;i<ordered.length;i++){
    const a=utcNanoseconds(ordered[i-1]),b=utcNanoseconds(ordered[i]);if(a===null||b===null)continue;
    const ns=b-a,key=decimalText({n:ns,e:-9});gaps.set(key,(gaps.get(key)??0)+1);
    if(adjacentGaps.length<detailLimit)adjacentGaps.push({fromUtc:ordered[i-1],toUtc:ordered[i],seconds:key,leftOccurrences:s.times.get(ordered[i-1]),rightOccurrences:s.times.get(ordered[i])});
    if(largest===null||ns>largest.ns)largest={ns,fromUtc:ordered[i-1],toUtc:ordered[i],seconds:key};
  }
  return {rows:s.rows,resultStates:s.resultStates,resultTypes:s.resultTypes,categories:finishInventory(s.categories),
    qualityValues:finishInventory(s.quality),timeKinds:s.timeKinds,qualityStates:s.qualityStates,
    numericEligibleRows:s.numericEligibleRows,numericExcludedRows:s.numericExcludedRows,numericExclusionReasons:s.numericExclusionReasons,
    browserNumericEligibleRows:s.numericEligibleRows,browserNumericExcludedRows:s.numericExcludedRows,browserNumericExclusionReasons:s.numericExclusionReasons,
    exactNumericEligibleRows:s.exactNumericEligibleRows,exactNumericExcludedRows:s.exactNumericExcludedRows,exactNumericExclusionReasons:s.exactNumericExclusionReasons,
    numericEligibilityMeaning:{numericEligibleRows:'Finite browser plotting eligibility; retained for compatibility.',
      exactNumericEligibleRows:'Original aligned, explicitly interpreted numeric instant samples within the bounded exact-decimal representation. These determine numericSummary.'},
    declarationIssueCounts:s.declarationIssueCounts,rowIssueCounts:s.rowIssueCounts,numericSummary:finishNumbers(s.numeric),
    firstUtc:s.firstUtc,lastUtc:s.lastUtc,instantEvents:s.instantEvents,explicitIntervals:s.explicitIntervals,unplacedOccurrences:s.unplacedOccurrences,
    distinctObservationKeys:s.observationKeys.size,duplicateObservationKeys:[...s.observationKeys.values()].filter(x=>x.length>1).length,
    changedDuplicateKeys:[...s.observationKeys.values()].filter(x=>new Set(x).size>1).length,
    distinctComponentOccurrences:s.componentOccurrences.size,
    timeline:{distinctInstantTimes:ordered.length,duplicateInstantTimes:[...s.times.values()].filter(x=>x>1).length,
      duplicateInstants:[...s.times].filter(([,count])=>count>1).slice(0,detailLimit).map(([utc,count])=>({utc,count})),
      adjacentGaps,detailLimit,omittedDuplicateInstants:Math.max(0,[...s.times.values()].filter(x=>x>1).length-detailLimit),
      omittedAdjacentGaps:Math.max(0,ordered.length-1-adjacentGaps.length),
      adjacentGapSeconds:[...gaps].map(([seconds,count])=>({seconds,count})),
      largestAdjacentGap:largest?{fromUtc:largest.fromUtc,toUtc:largest.toUtc,seconds:largest.seconds}:null,
      continuousCoverage:null,expectedSampleCount:null,interpolation:null,meaning:'Gaps describe separations between observed distinct instants; they do not fill intervals or establish a service schedule.'},
    days:[...s.days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(d=>({day:d.day,events:d.events,qualityStates:d.qualityStates,
      missingResults:d.missingResults,numericSummary:finishNumbers(d.numeric)}))};
}
export async function describeComponentSelection(store,edition,selection){
  const {catalogue,bound}=await validateComponentBindings(store,edition,selection),stats=new Map(),
    streams=bound.map(({choice,descriptor,stream})=>{
      stats.set(descriptor.seriesKey,createComponentStatistics());
      return {key:descriptor.seriesKey,sourceStreamKey:choice.streamKey,id:stream.streamId,name:stream.name,kind:'MultiDatastreamComponent',
        componentIndex:choice.index,componentName:descriptor.name,componentBindingId:descriptor.bindingId,componentMeaningId:descriptor.meaningId,
        sourceRef:stream.sourceRef,sourceJson:stream.sourceJson,component:descriptor,interpretation:choice.interpretation,
        observationType:descriptor.declaredType,unit:descriptor.unit,observedProperties:descriptor.property?[descriptor.property]:[],
        locations:stream.locations,things:stream.things,sensors:stream.sensors,
        nativeViewer:{metadataCompatible:false,issues:[{code:'explicit_component_projection_required',sourceRef:stream.sourceRef}],
          meaning:'The original upstream STA client does not implicitly convert a MultiDatastream into a scalar Datastream.'}};
    });
  const originalObservations=new Map();let total=0,events=0,intervals=0,unplaced=0;
  for await(const value of selectedComponentRows(store,edition,selection)){
    accumulateComponentStatistics(stats.get(value.streamKey),value);total++;
    if(value.row.phenomenon_time_kind==='explicit_instant')events++;else if(value.row.phenomenon_time_kind==='explicit_interval')intervals++;else unplaced++;
    const key=value.original.observationKey;
    if(key){const old=originalObservations.get(key)??new Map();old.set(value.original.occurrenceId,value.row.observation_json);originalObservations.set(key,old);}
  }
  for(const s of streams)Object.assign(s,finishComponentStatistics(stats.get(s.key)));
  return {schema:'stellar-forge.sensorthings-analysis-summary.v1',analysisKind:'explicit-multidatastream-components',editionId:edition.id,selection,
    sourceScope:edition.scope,sourceIssues:edition.issues,license:edition.source.license,catalogue,
    totalOccurrences:total,distinctObservationKeys:originalObservations.size,
    duplicateObservationKeys:[...originalObservations.values()].filter(x=>x.size>1).length,
    changedDuplicateKeys:[...originalObservations.values()].filter(x=>new Set(x.values()).size>1).length,
    instantEvents:events,explicitIntervals:intervals,unplacedOccurrences:unplaced,streams,meaning:COMPONENT_MEANING};
}
export async function componentRowsPage(store,edition,selection,{offset=0,limit=100}={}){
  integer(offset,'component row offset',0,Number.MAX_SAFE_INTEGER);integer(limit,'component page rows',1,COMPONENT_LIMITS.pageRows);
  const rows=[];let total=0;
  for await(const value of selectedComponentRows(store,edition,selection)){
    if(total>=offset&&rows.length<limit)rows.push({...value.row,stream_key:value.streamKey,source:value.original.sourceRef,
      componentSource:value.original.componentSourceRef,numeric:componentNumericEligibility(value.row),exactNumeric:componentExactEligibility(value.row)});total++;
  }
  return {editionId:edition.id,selection,columns:[...COMPONENT_COLUMNS,'stream_key'],rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
const csvCell=value=>{const s=value==null?'':String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export function componentCSVHeader(){return [...COMPONENT_COLUMNS,'stream_key'].map(csvCell).join(',')+'\r\n';}
export function componentCSVRow(value){return [...COMPONENT_COLUMNS.map(k=>value.row[k]),value.streamKey].map(csvCell).join(',')+'\r\n';}
export async function* componentCSV(store,edition,selection){
  yield componentCSVHeader();for await(const value of selectedComponentRows(store,edition,selection))yield componentCSVRow(value);
}
export async function compareComponentSelection(store,left,right,selection){
  await validateComponentBindings(store,left,selection);
  const rightCatalog=await componentCatalog(store,right,{streamKeys:selection.streamKeys}),
    rightSelections=selection.componentSelections.map(choice=>{
      const descriptor=rightCatalog.streams.find(x=>x.streamKey===choice.streamKey)?.components.find(x=>x.index===choice.index);
      if(!descriptor)throw fault('ANALYSIS_COMPONENT_COMPARISON','A selected original position is unavailable in the later edition. Retain the later source and make an explicit revised selection.',409);
      return {...choice,bindingId:descriptor.bindingId,
        // Comparison preserves the original interpretation as a proposal, but
        // does not acknowledge newly introduced source declaration issues.
        interpretation:{...choice.interpretation,acknowledgedIssues:choice.interpretation.acknowledgedIssues.filter(x=>descriptor.issues.includes(x))}};
    }),rightSelection={...selection,componentSelections:rightSelections};
  // A new issue cannot receive an inferred operator acknowledgment.
  await validateComponentBindings(store,right,rightSelection);
  const maps=[new Map(),new Map()],unkeyed=[];let side=0;
  for(const [edition,selected]of [[left,selection],[right,rightSelection]]){
    for await(const value of selectedComponentRows(store,edition,selected)){
      if(!value.original.key){unkeyed.push({side:side===0?'left':'right',sourceRef:value.original.sourceRef,componentIndex:Number(value.row.component_index)});continue;}
      const a=maps[side].get(value.original.key)??[];a.push(value);maps[side].set(value.original.key,a);
    }side++;
  }
  const counts={same:0,changed:0,observedOnlyLeft:0,observedOnlyRight:0,ambiguous:0,unkeyed:unkeyed.length},
    changes=[],parentContextChanges=[],keys=new Set([...maps[0].keys(),...maps[1].keys()]);
  for(const key of keys){
    const a=maps[0].get(key)??[],b=maps[1].get(key)??[];let kind;
    if(a.length>1||b.length>1)kind='ambiguous';
    else if(!a.length)kind='observedOnlyRight';else if(!b.length)kind='observedOnlyLeft';
    else kind=a[0].original.semanticHash===b[0].original.semanticHash?'same':'changed';
    counts[kind]++;
    if(kind==='same'&&a[0].original.parentSemanticHash!==b[0].original.parentSemanticHash)
      parentContextChanges.push({key,meaning:'Selected component semantic value is unchanged, while an unselected parent value or related original source context differs.',
        left:{parentSemanticHash:a[0].original.parentSemanticHash,row:a[0].row,sourceRef:a[0].original.sourceRef},
        right:{parentSemanticHash:b[0].original.parentSemanticHash,row:b[0].row,sourceRef:b[0].original.sourceRef}});
    if(kind!=='same')changes.push({key,kind,left:a.map(v=>({row:v.row,sourceRef:v.original.sourceRef,componentSourceRef:v.original.componentSourceRef})),
      right:b.map(v=>({row:v.row,sourceRef:v.original.sourceRef,componentSourceRef:v.original.componentSourceRef}))});
  }
  const leftCatalog=await componentCatalog(store,left,{streamKeys:selection.streamKeys}),
    metadata=selection.componentSelections.map(c=>{
      const a=leftCatalog.streams.find(x=>x.streamKey===c.streamKey).components.find(x=>x.index===c.index),
        b=rightCatalog.streams.find(x=>x.streamKey===c.streamKey).components.find(x=>x.index===c.index);
      return {streamKey:c.streamKey,index:c.index,leftBindingId:a.bindingId,rightBindingId:b.bindingId,
        componentMeaningUnchanged:a.meaningId===b.meaningId,left:a,right:b};
    });
  const context=edition=>({editionId:edition.id,scope:edition.scope,license:edition.source.license,
    pages:edition.pages.filter(p=>p.kind!=='Observations').map(p=>({streamKey:p.streamKey,phase:p.phase,url:p.url,
      sha256:p.receipt.sha256,bytes:p.receipt.bytes,sourceCapturedAt:p.receipt.sourceCapturedAt??p.receipt.completedAt}))});
  return {schema:'stellar-forge.sensorthings-analysis-comparison.v1',analysisKind:'explicit-multidatastream-components',
    leftEditionId:left.id,rightEditionId:right.id,selection,rightSelection,rightSelectionStatus:'comparison_only_not_an_accepted_revision',counts,changes,parentContextChanges,unkeyed,
    componentMetadata:metadata,sourceContext:{left:context(left),right:context(right)},meaning:COMPONENT_MEANING};
}
