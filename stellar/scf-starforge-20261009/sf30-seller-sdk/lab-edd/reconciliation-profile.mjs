// MIT. Explicit EQuIS3/4 structural projections for cross-profile receiving review.
import { canonicalJson, sha256 } from './model.mjs';
import { labError } from './table.mjs';
export const EQUIS_CROSS_PROFILE = Object.freeze({
  id:'equis-3-4-receiving',version:'1.0.0',
  profiles:['equis-lab-3','equis-lab-4'],
  references:[
    {title:'EarthSoft EQEDD section and test-key contract',url:'https://help.earthsoft.com/lib_eqedd_format.htm'},
    {title:'EarthSoft EFWEDD sections, parent relationships and test keys',url:'https://help.earthsoft.com/lib_efwedd-format.htm'}
  ],
  rules:[
    'Each original physical row and exact native field remains retained.',
    'Civil date/time projection joins declared date and time fields without assigning a time zone or changing the original token.',
    'Candidate groups use an exact reported laboratory sample ID only when the original complete native test relationship resolves it uniquely. Otherwise they use the exact source sample code in a separate namespace.',
    'Candidate groups retain civil analysis time, column and identifier, plus analyte/result type or batch assignment identity. Method, fraction and test type remain visible native identity differences rather than inferred equivalences.',
    'Method, fraction and test type are deliberately excluded only from the candidate-search key. A reviewed correspondence does not authorize replacing those source fields.',
    'A candidate group is a review location. Correspondence requires an explicit source-bound reviewer decision.',
    'Repeated embedded three-file test fields share one logical test projection only when every projected test field and the complete native test identity is equal. All original owner rows remain attached.',
    'Four-file test rows and all sample, result and batch rows remain separate entities, including exact duplicates.',
    'Unrecognized or incomplete calendar/key fields remain independent source entities.'
  ]
});
const TEST_ID=['sys_sample_code','lab_anl_method_name','analysis_date','analysis_time','total_or_dissolved','column_number','test_type','identifier'];
const TEST_METADATA=['lab_matrix_code','analysis_location','basis','container_id','dilution_factor','prep_method','prep_date','prep_time','leachate_method','leachate_date','leachate_time','lab_name_code','qc_level','lab_sample_id','percent_moisture','subsample_amount','subsample_amount_unit','analyst_name','instrument_id','instrument_lab','comment','preservative','final_volume','final_volume_unit'];
const DATE_FIELDS=Object.freeze({
  analysis_timestamp:['analysis_date','analysis_time'],
  prep_timestamp:['prep_date','prep_time'],
  leachate_timestamp:['leachate_date','leachate_time'],
  sample_timestamp:['sample_date','sample_time'],
  sample_receipt_timestamp:['sample_receipt_date','sample_receipt_time']
});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function civil(date,time){
  if(typeof date!=='string'||!date)return {status:'EMPTY',value:null};
  const combined=time===undefined?date:date+(time?' '+time:'');
  const match=/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(combined);
  if(!match)return {status:'UNPARSED',value:null};
  const year=Number(match[1]??match[6]),month=Number(match[2]??match[4]),day=Number(match[3]??match[5]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1])return {status:'UNPARSED',value:null};
  let value=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  if(match[7]===undefined)return {status:'DATE_ONLY',value};
  const hour=Number(match[7]),minute=Number(match[8]),second=Number(match[9]??0),zone=match[11]??'';
  if(hour>23||minute>59||second>59||zone&&zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59))return {status:'UNPARSED',value:null};
  const fraction=(match[10]??'').replace(/0+$/,'');
  value+='T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':'+String(second).padStart(2,'0')+(fraction?'.'+fraction:'')+zone;
  return {status:zone?'EXPLICIT_OFFSET':'CIVIL_TIME',value};
}
function nativeIdentity(kind,row){
  const fields=kind==='samples'?['sys_sample_code']:kind==='results'?[...TEST_ID,'cas_rn','result_type_code']:
    kind==='batches'?[...TEST_ID,'test_batch_type','test_batch_id']:TEST_ID;
  return fields.map(field=>({field,present:own(row.values,field),value:own(row.values,field)?row.values[field]:null}));
}
function selectedFields(kind,table,embedded){
  if(kind==='tests')return table.keys.filter(field=>TEST_ID.includes(field)||TEST_METADATA.includes(field));
  if(kind==='results'&&embedded)return table.keys.filter(field=>!TEST_METADATA.includes(field));
  return [...table.keys];
}
function fieldsFor(kind,table,row,embedded){
  const keys=selectedFields(kind,table,embedded),out={},used=new Set();
  for(const [field,[date,time]]of Object.entries(DATE_FIELDS)){
    if(!keys.includes(date)&&!keys.includes(time))continue;
    const raw=[date,time].filter(key=>keys.includes(key)).map(key=>({field:key,value:row.values[key]}));
    const parsed=civil(row.values[date],keys.includes(time)?row.values[time]:undefined);
    out[field]={kind:'civil-date-time',status:parsed.status,value:parsed.value,raw};
    for(const item of raw)used.add(item.field);
  }
  for(const field of keys)if(!used.has(field))out[field]={kind:'literal',status:'PRESENT',value:row.values[field],raw:[{field,value:row.values[field]}]};
  return out;
}
function candidate(kind,fields,context){
  const labId=context.labSampleIds.length===1?context.labSampleIds[0]:null;
  const names=kind==='samples'?[]:['analysis_timestamp','column_number','identifier'];
  if(kind==='results')names.push('cas_rn','result_type_code');
  if(kind==='batches')names.push('test_batch_type','test_batch_id');
  const required=kind==='samples'?[]:['analysis_timestamp',...(kind==='results'?['cas_rn','result_type_code']:[]),...(kind==='batches'?['test_batch_type','test_batch_id']:[])];
  const sample=labId??fields.sys_sample_code?.value??null;
  const values=[{field:'sample_reference',present:sample!==null,value:sample,scope:labId?'reported-lab-sample-id':'source-sample-code'},
    ...names.map(field=>({field,present:own(fields,field),value:fields[field]?.value??null}))];
  const complete=typeof sample==='string'&&sample!==''&&required.every(field=>typeof fields[field]?.value==='string'&&fields[field].value!==''&&
    (field!=='analysis_timestamp'||['CIVIL_TIME','EXPLICIT_OFFSET'].includes(fields[field].status)));
  return {complete,fields:values};
}
function sourceRow(table,row){
  return {recordId:row.recordId,rowSha256:row.sourceRowSha256??row.rowSha256,viewRowSha256:row.rowSha256,
    filename:table.filename,section:table.id,rowNumber:row.rowNumber,...(row.line===undefined?{}:{line:row.line})};
}
export function projectEQuisDelivery(delivery,{review=null}={}){
  if(!EQUIS_CROSS_PROFILE.profiles.includes(delivery?.source?.profile?.id)||delivery.source.profile.version!=='1.0.0')
    labError('CROSS_PROFILE','Select the installed versioned EQuIS3 or EQuIS4 profile for this mapping.');
  if(review&&(review.source.sourceSha256!==delivery.source.sourceSha256||review.source.profile.id!==delivery.source.profile.id))
    labError('CROSS_REVIEW_SOURCE','The projected review must belong to the same original source.');
  const tables=review?.tables??delivery.tables,embedded=delivery.source.profile.id==='equis-lab-3',entities=[],embeddedTests=new Map();
  const physical=[];
  for(const table of tables)for(const row of table.rows){
    physical.push(sourceRow(table,row));
    for(const kind of embedded&&table.id==='results'?['results','tests']:[table.id]){
      const fields=fieldsFor(kind,table,row,embedded),nativeKey=nativeIdentity(kind,row),ref=sourceRow(table,row);
      const groupKey=canonicalJson({nativeKey,fields});
      if(embedded&&kind==='tests'&&embeddedTests.has(groupKey)){embeddedTests.get(groupKey).rows.push(ref);continue;}
      const entity={kind,nativeKey,fields,rows:[ref],projection:embedded&&kind==='tests'?'embedded-test':'physical-row'};
      entities.push(entity);if(embedded&&kind==='tests')embeddedTests.set(groupKey,entity);
    }
  }
  for(const entity of entities){
    entity.rows.sort((a,b)=>a.filename.localeCompare(b.filename,'en')||a.rowNumber-b.rowNumber||a.recordId.localeCompare(b.recordId,'en'));
    entity.entityId='entity-'+sha256(canonicalJson([delivery.source.sourceSha256,entity.kind,entity.projection,entity.rows.map(row=>row.recordId)])).slice(0,32);
  }
  const testsByKey=new Map(),testsBySample=new Map();
  for(const entity of entities.filter(item=>item.kind==='tests')){
    const key=canonicalJson(entity.nativeKey),sample=entity.fields.sys_sample_code?.value??null;
    if(!testsByKey.has(key))testsByKey.set(key,[]);testsByKey.get(key).push(entity);
    if(!testsBySample.has(sample))testsBySample.set(sample,[]);testsBySample.get(sample).push(entity);
  }
  for(const entity of entities){
    const tests=entity.kind==='tests'?[entity]:entity.kind==='samples'?(testsBySample.get(entity.fields.sys_sample_code?.value??null)??[]):
      (testsByKey.get(canonicalJson(entity.nativeKey.filter(item=>TEST_ID.includes(item.field))))??[]);
    const values=tests.map(test=>test.fields.lab_sample_id?.value??null);
    const labSampleIds=values.length&&values.every(value=>typeof value==='string'&&value!=='')?[...new Set(values)].sort():[];
    entity.context={labSampleIds,testEntityIds:tests.map(test=>test.entityId).sort(),
      labSampleFields:tests.filter(test=>test.fields.lab_sample_id).map(test=>({entityId:test.entityId,
        value:test.fields.lab_sample_id.value,sourceRows:test.rows.map(row=>row.recordId),field:'lab_sample_id'}))};
    entity.candidate=candidate(entity.kind,entity.fields,entity.context);
    entity.entitySha256=sha256(canonicalJson(entity));
  }
  entities.sort((a,b)=>a.kind.localeCompare(b.kind,'en')||a.entityId.localeCompare(b.entityId,'en'));
  return {source:delivery.source,reviewSha256:review?.reviewSha256??null,entities,physical,
    fieldMap:{testIdentityFields:TEST_ID,testMetadataFields:TEST_METADATA,dateTimeFields:DATE_FIELDS,
      tables:tables.map(table=>({filename:table.filename,section:table.id,headers:table.headers,keys:table.keys}))}};
}
