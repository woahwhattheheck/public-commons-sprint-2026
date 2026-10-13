// SPDX-License-Identifier: MIT
// ClickHouse planning over the retained original Sling exact-comparison contract.
import { canonical,copy,objectDigest,requireValue,verifyDocumentDigest } from '../vendor/sling/migration/common.mjs';
import { compareObservations } from '../vendor/sling/migration/compare.mjs';

const TYPES=new Set(['text','integer','decimal','boolean','date','timestamp','binary','float64']);
const ID=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export function identifier(value){
  requireValue(typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value),'identifier','Select an explicit ClickHouse identifier.');
  return '\u0060'+value.replaceAll('\\','\\\\').replaceAll('\u0060','\\\u0060')+'\u0060';
}
export function relation(parts){requireValue(Array.isArray(parts)&&parts.length===2,'relation','Select the exact [database,table] pair.');return parts.map(identifier).join('.');}
export function literal(value){requireValue(typeof value==='string'&&!value.includes('\0'),'literal','Select a complete string.');return "'"+value.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";}
export function profile(value){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'profile','Select a retained connection declaration.');
  requireValue(typeof value.id==='string'&&ID.test(value.id),'profile_id','Use an explicit connection ID.');
  for(const name of ['endpointEnv','userEnv','passwordEnv'])requireValue(typeof value[name]==='string'&&/^[A-Z_][A-Z0-9_]{0,127}$/.test(value[name]),'profile_environment','Select existing host environment variable names.',{field:name});
  requireValue(Array.isArray(value.databases)&&value.databases.length&&value.databases.every(x=>typeof x==='string'&&ID.test(x)),'profile_databases','Declare the approved database names.');
  requireValue(Array.isArray(value.versions)&&value.versions.length&&value.versions.every(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x)),'profile_versions','Declare the exact observed and supported server versions.');
  requireValue(['read','write'].includes(value.mode),'profile_mode','Declare read or write for the connection.');
  return {id:value.id,endpointEnv:value.endpointEnv,userEnv:value.userEnv,passwordEnv:value.passwordEnv,allowLocal:value.allowLocal===true,
    databases:[...new Set(value.databases)],versions:[...new Set(value.versions)],mode:value.mode==='write'?'write':'read',
    endpointIdentity:typeof value.endpointIdentity==='string'?value.endpointIdentity:null};
}
export function nativeType(type){
  requireValue(typeof type==='string'&&type.length>0&&type.length<2048,'column_type','Retain each exact native column type.');
  let base=type.trim(),nullable=false,lowCardinality=false;
  while(/^(Nullable|LowCardinality)\(/.test(base)){
    const found=/^(Nullable|LowCardinality)\(([\s\S]+)\)$/.exec(base);requireValue(found,'column_type','Unbalanced native type wrapper.');
    nullable||=found[1]==='Nullable';lowCardinality||=found[1]==='LowCardinality';base=found[2];
  }
  let cellType=null,precision=null,scale=null;
  if(/^(U?Int)(8|16|32|64|128|256)$/.test(base))cellType='integer';
  else if(base==='Bool')cellType='boolean';
  else if(/^Float(32|64)$/.test(base))cellType='float64';
  else if(/^(String|FixedString\(\d+\))$/.test(base))cellType='binary';
  else if(/^(UUID|IPv4|IPv6)$/.test(base))cellType='text';
  else if(/^(Date|Date32)$/.test(base))cellType='date';
  else if(/^DateTime(?:64\(\d+(?:,\s*'[^']+')?\)|(?:\('[^']+'\))?)$/.test(base))cellType='timestamp';
  else{
    let m=/^Decimal\((\d+),\s*(\d+)\)$/.exec(base);
    if(m){precision=Number(m[1]);scale=Number(m[2]);cellType='decimal';}
    m=/^Decimal(32|64|128|256)\((\d+)\)$/.exec(base);
    if(m){precision={32:9,64:18,128:38,256:76}[m[1]];scale=Number(m[2]);cellType='decimal';}
  }
  return {type,base,nullable,lowCardinality,cellType,...(precision===null?{}:{precision,scale})};
}
export function exportProjection(columns){
  requireValue(Array.isArray(columns)&&columns.length>0&&columns.length<=512,'columns','Retain the complete nonempty column declaration.');
  const names=new Set(),values=[],masks=[],shape=[];
  for(const [index,column] of columns.entries()){
    requireValue(!names.has(column.name),'duplicate_column','Column names must be unique.');names.add(column.name);
    const type=nativeType(column.type);requireValue(type.cellType,'unsupported_native_type','This native type needs an explicitly reviewed scalar query projection; it is not flattened automatically.',{column:column.name,type:column.type});
    const name=identifier(column.name),value='assumeNotNull('+name+')';
    let expression=value;
    if(type.cellType==='binary')expression='base64Encode('+value+')';
    else if(type.cellType==='float64')expression='toString(reinterpretAsUInt64(toFloat64('+value+')))';
    else if(type.cellType==='boolean')expression='toString(toUInt8('+value+'))';
    else if(type.cellType==='timestamp')expression="concat(toString(toTimeZone("+value+", 'UTC')), 'Z')";
    else expression='toString('+value+')';
    values.push(expression+' AS '+identifier('v'+index));masks.push('toString(isNull('+name+')) AS '+identifier('n'+index));
    shape.push({name:column.name,...type,ordinal:index,wire:type.cellType==='float64'?'uint64-ieee754':type.cellType==='binary'?'base64':'clickhouse-text'});
  }
  return {sql:[...values,...masks].join(', '),columns:shape};
}
export function exportSql(table,{columns,final=false,maxRows=250000}={}){
  requireValue(Number.isSafeInteger(maxRows)&&maxRows>0&&maxRows<=1000000,'row_limit','Select a complete-export row cap up to one million.');
  const projection=exportProjection(columns);
  return {sql:'SELECT '+projection.sql+' FROM '+relation(table)+(final?' FINAL':'')+' LIMIT '+(maxRows+1)+' FORMAT JSONCompactStrings',columns:projection.columns,maxRows};
}
function checkedColumn(raw){
  const parsed=nativeType(raw.type);identifier(raw.name);
  requireValue(parsed.cellType,'unsupported_native_type','Select a supported scalar native column or an explicitly reviewed source query projection.',{column:raw.name,type:raw.type});
  requireValue(raw.cellType===undefined||TYPES.has(raw.cellType),'cell_type','Select an exact supported cell encoding.');
  if(raw.left)identifier(raw.left);if(raw.right)identifier(raw.right);
  return{name:raw.name,type:raw.type,cellType:raw.cellType??parsed.cellType,...(raw.left?{left:raw.left}:{}),...(raw.right?{right:raw.right}:{})};
}
export function compileAcceptance(input){
  requireValue(input?.schema==='altinity.acceptance-input.v1','input_schema','Select the complete Altinity acceptance input.');
  const source=profile(input.source),target=profile(input.target);
  requireValue(target.mode==='write','write_profile','The candidate target must explicitly allow its owned ingestion operation.');
  requireValue(Array.isArray(input.tables)&&input.tables.length>0&&input.tables.length<=5,'table_limit','Select one to five complete table mappings.');
  const issues=[],tables=[],names=new Set(),targets=new Set();
  for(const raw of input.tables){
    relation(raw.source);relation(raw.target);
    requireValue(source.databases.includes(raw.source[0])&&target.databases.includes(raw.target[0]),'database_scope','A table is outside the reviewed connection database scope.');
    requireValue(raw.target[1].startsWith('commission_'),'candidate_name','New candidate tables use the commission_ prefix.');
    requireValue(canonical(raw.source)!==canonical(raw.target)||source.id!==target.id,'same_target','The immutable candidate must differ from the original source.');
    const id=JSON.stringify(raw.source);requireValue(!names.has(id),'duplicate_table','Select each original source table once.');names.add(id);
    const targetId=JSON.stringify(raw.target);requireValue(!targets.has(targetId),'duplicate_target','Each candidate target relation must be unique before native effects.');targets.add(targetId);
    requireValue(Array.isArray(raw.columns)&&raw.columns.length>0,'columns','Declare all business columns.');
    const columns=raw.columns.map(checkedColumn);requireValue(new Set(columns.map(c=>c.name)).size===columns.length,'duplicate_column','Business names must be unique.');
    const primaryKey=raw.primaryKey??[],orderBy=raw.orderBy??primaryKey;
    requireValue(Array.isArray(primaryKey)&&Array.isArray(orderBy)&&orderBy.length>0,'sorting_key','Explicitly select the native ORDER BY key.');
    const selected=new Set(columns.map(c=>c.name));
    for(const name of [...primaryKey,...orderBy])requireValue(selected.has(name),'key_missing','Keys must name retained business columns.');
    const engine=raw.engine??'MergeTree';
    requireValue(['MergeTree','ReplacingMergeTree'].includes(engine),'table_engine','This commissioning edition supports explicit MergeTree and ReplacingMergeTree candidates.');
    let versionColumn=raw.versionColumn??null,deletedColumn=raw.deletedColumn??null;
    if(engine==='ReplacingMergeTree'){
      requireValue(versionColumn&&selected.has(versionColumn),'version_column','ReplacingMergeTree requires a retained version column.');
      requireValue(primaryKey.length&&canonical(orderBy)===canonical(primaryKey),'replacement_key','The ORDER BY deduplication key must equal the reviewed logical primary key.');
      requireValue(raw.final===true,'final_required','Logical ReplacingMergeTree acceptance must use FINAL.');
      if(deletedColumn)requireValue(selected.has(deletedColumn),'deleted_column','The delete column must be retained.');
    }
    if(raw.sourceFinal!==undefined)requireValue(typeof raw.sourceFinal==='boolean','source_final','Select source FINAL explicitly.');
    const table={id,source:copy(raw.source),target:copy(raw.target),columns,primaryKey:copy(primaryKey),orderBy:copy(orderBy),engine,versionColumn,deletedColumn,
      sourceFinal:raw.sourceFinal===true,final:raw.final===true,phase:raw.phase??'baseline',maxRows:raw.maxRows??250000,maxBytes:raw.maxBytes??536870912,
      sourceBoundary:raw.sourceBoundary??null,sourceExpectedUuid:raw.sourceExpectedUuid??null};
    requireValue(table.sourceExpectedUuid===null||/^[0-9a-fA-F-]{36}$/.test(table.sourceExpectedUuid),'source_uuid','Select the exact native source UUID.');
    requireValue(['baseline','incremental','rollback'].includes(table.phase),'phase','Select the native comparison phase.');
    requireValue(Number.isSafeInteger(table.maxBytes)&&table.maxBytes>=1024&&table.maxBytes<=536870912,'byte_limit','Select a bounded full export up to 512 MiB.');
    exportSql(table.source,{columns:columns.map(c=>({name:c.left??c.name,type:c.type})),final:table.sourceFinal,maxRows:table.maxRows});
    requireValue(typeof table.sourceBoundary==='string'&&table.sourceBoundary.length>0,'source_boundary','Record the actual quiesced source or agreed snapshot boundary; separate native requests do not create a cross-table transaction.');
    if(deletedColumn)issues.push({code:'delete_projection_required',tableId:id,severity:'error',message:'Select an approved source view and candidate view that exclude the same tombstones; the adapter does not silently discard deleted records.'});
    const ddlColumns=columns.map(c=>identifier(c.right??c.name)+' '+c.type).join(',\n  ');
    const engineArgs=engine==='ReplacingMergeTree'?'('+identifier(columns.find(c=>c.name===versionColumn)?.right??versionColumn)+')':'';
    table.createSql='CREATE TABLE '+relation(table.target)+' (\n  '+ddlColumns+'\n) ENGINE = '+engine+engineArgs+' ORDER BY ('+orderBy.map(k=>identifier(columns.find(c=>c.name===k)?.right??k)).join(', ')+')';
    tables.push(table);
  }
  requireValue(new Set(tables.map(t=>t.phase)).size===1,'phase','All tables in one operation use the same comparison phase.');
  const body={schema:'altinity.acceptance-plan.v1',title:input.title??'ClickHouse migration acceptance',source,target,tables,
    limits:{maxThreads:2,maxMemoryBytes:536870912},issues,ready:!issues.some(i=>i.severity==='error'),
    rollback:{mode:'retained-consumer-selection',engineDowngrade:false,priorTablesRetained:true},
    sourceEvidence:copy(input.sourceEvidence??[]),authorNotes:input.notes??''};
  return {...body,planId:objectDigest(body)};
}
export function comparisonPlan(plan){
  verifyDocumentDigest(plan,'planId');requireValue(plan.schema==='altinity.acceptance-plan.v1','plan_schema','Select the original acceptance plan.');
  const body={schema:'slingdata.migration-plan.v1',ready:plan.ready,issues:plan.issues,
    origin:{schema:plan.schema,planId:plan.planId,contract:'original full-row comparison adapter'},
    selectedStreams:plan.tables.map(t=>({id:t.id,ready:plan.ready,name:t.source[1],namespace:t.source[0],
      mode:t.primaryKey.length?'incremental':'full-refresh',primaryKey:t.primaryKey,updateKey:null,businessColumns:t.columns.map(c=>c.name),
      ignoredLeftColumns:[],ignoredRightColumns:[],columnMaps:{left:Object.fromEntries(t.columns.map(c=>[c.name,c.left??c.name])),right:Object.fromEntries(t.columns.map(c=>[c.name,c.right??c.name]))},
      cellTypes:Object.fromEntries(t.columns.map(c=>[c.name,c.cellType]))}))};
  return {...body,planId:objectDigest(body)};
}
export function compareAcceptance(plan,observed){
  const selected=comparisonPlan(plan);
  requireValue(observed?.acceptancePlanId===plan.planId,'observation_plan','Native exports must bind the original complete acceptance plan.');
  requireValue(observed.planId===selected.planId,'comparison_plan','Native exports identify another comparison projection.');
  const native=compareObservations(selected,observed);
  const result={schema:'altinity.acceptance-report.v1',planId:plan.planId,comparisonPlanId:selected.planId,
    readyForCutover:native.readyForCutover&&observed.sourceStable===true&&observed.targetIdentityVerified===true,equal:native.equal,errors:[...native.errors,...(observed.sourceStable===true?[]:['The native source changed across the retained transfer.']),...(observed.targetIdentityVerified===true?[]:['The exact target UUID/schema is unverified.'])],nativeReport:native};
  return {...result,reportId:objectDigest(result)};
}
