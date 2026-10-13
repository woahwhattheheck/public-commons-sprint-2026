// SPDX-License-Identifier: MIT
// Bubble retained GET captures -> original local migration compiler.
// Exact scalar conversion is retained from the maintained provider adapter.
import {sha256Utf8} from './sha256.mjs';
import {parseExactJSON} from '../../workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs';
export const CAPTURE_SCHEMA='bubble.capture.v1';
export const BUNDLE_SCHEMA='bubble.reconciliation-capture.v1';
export const MAPPING_SCHEMA='bubble.mapping.v1';
const NAME=/^[a-z][a-z0-9_]{0,62}$/,ID=/^[A-Za-z0-9_-]{1,160}$/,SHA=/^[a-f0-9]{64}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=v=>JSON.parse(JSON.stringify(v));
export function requireValue(ok,message){if(!ok)throw Error(message);}
export function json(value){return JSON.stringify(value,null,2)+'\n';}
export function digest(content){requireValue(typeof content==='string','Retain complete UTF-8 source.');return sha256Utf8(content);}
export function file(path,content){return {path,content,...digest(content)};}
function name(v){requireValue(typeof v==='string'&&NAME.test(v),'Use an explicit normalized native table/column identifier: '+v);return v;}
function string(v,label){requireValue(typeof v==='string'&&v.trim().length>0,label+' is required.');return v;}
function number(v,label,max=10000000){requireValue(/^(0|[1-9]\d*)$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)<=max,label+' must be a bounded nonnegative integer.');return Number(v);}
function unique(rows,key,label){const seen=new Set();for(const r of rows){const k=key(r);requireValue(!seen.has(k),'Repeated '+label+': '+k);seen.add(k);}return seen;}
function canonicalObject(v){if(Array.isArray(v))return v.map(canonicalObject);if(v&&typeof v==='object'){const o=Object.create(null);for(const k of Object.keys(v).sort())o[k]=canonicalObject(v[k]);return o;}return v;}
export function canonical(v){return JSON.stringify(canonicalObject(v));}
function calendarDate(year,month,day){const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];return year>=1&&year<=9999&&month>=1&&month<=12&&day>=1&&day<=days[month-1];}
function timestamp(v,label){
 const m=typeof v==='string'&&/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|([+-])(\d\d):(\d\d))$/.exec(v);
 requireValue(m&&calendarDate(Number(m[1]),Number(m[2]),Number(m[3]))&&Number(m[4])<=23&&Number(m[5])<=59&&Number(m[6])<=59&&(m[8]==='Z'||Number(m[10])<=23&&Number(m[11])<=59)&&Number.isFinite(Date.parse(v)),label+' must be a valid calendar timestamp with explicit timezone.');
 return v;
}

function configuration(capture){
 const c=capture.configuration;
 requireValue(c?.schema==='bubble.capture-config.v1'&&c.operationId===capture.operationId,'Original capture configuration/operation differs.');
 requireValue(c.endpoint&&typeof c.endpoint.origin==='string','Retain the explicit original Bubble app origin.');
 const host=/^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(c.endpoint.origin);
 requireValue(host&&host[1].length<=253&&host[1].split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))&&(!host[2]||Number(host[2])<=65535),'Use the exact lowercase HTTPS DNS application origin without credentials or a path.');
 requireValue(c.endpoint.versionPath===''||typeof c.endpoint.versionPath==='string'&&/^\/[A-Za-z0-9_-]{1,120}$/.test(c.endpoint.versionPath),'Select the exact live or explicit Bubble branch path.');
 requireValue(typeof c.authEnv==='string'&&/^[A-Z][A-Z0-9_]*$/.test(c.authEnv),'Retain only the configured environment variable name for authorization.');
 requireValue(['ordinary','enterprise'].includes(c.plan),'Declare the documented Bubble cursor plan limit.');
 requireValue(Array.isArray(c.types)&&c.types.length>0&&c.types.length<=50,'Select one to fifty original data types.');
 unique(c.types,x=>x.id,'selected type ID');
 for(const t of c.types){
  requireValue(ID.test(t.id)&&typeof t.typeName==='string'&&t.typeName.length>0&&t.typeName.length<=240&&!/[\\/\u0000-\u001f]/.test(t.typeName),'Retain the exact data-type API name and a stable local selection ID.');
  requireValue(['all-live','filtered-live'].includes(t.scope?.coverage),'Declare the selected live-record scope.');
  string(t.scope?.population,'Selected population');string(t.scope?.inactive,'Inactive-record coverage');
  requireValue(t.scope?.deleted==='not-observed-by-list','List capture cannot prove provider deletions.');
  requireValue(Array.isArray(t.partitions)&&t.partitions.length>0&&t.partitions.length<=10000,'Retain every explicitly selected query partition.');
  unique(t.partitions,x=>x.id,'partition ID');
  requireValue(t.partitioning?.mode===(t.partitions.length===1?'single':'reviewed-disjoint')&&['complete-declared','selected'].includes(t.partitioning?.populationCoverage),'Retain the explicit reviewed partition coverage.');
  string(t.partitioning.evidence,'Partition population review');
  for(const p of t.partitions){
   requireValue(ID.test(p.id)&&Array.isArray(p.constraints),'Retain the original partition identity and complete constraints.');
   for(const row of p.constraints)requireValue(row&&typeof row.key==='string'&&row.key&&typeof row.constraint_type==='string'&&row.constraint_type&&own(row,'value'),'Retain every actual constraint key, operator and complete value.');
   requireValue(typeof p.sort_field==='string'&&p.sort_field&&typeof p.descending==='boolean'&&Array.isArray(p.additional_sort_fields),'Select explicit original ordering fields and direction.');
   for(const row of p.additional_sort_fields)requireValue(row&&typeof row.sort_field==='string'&&row.sort_field&&typeof row.descending==='boolean','Retain additional ordering fields and direction.');
   if(p.expectedCount!==null&&p.expectedCount!==undefined){
    number(p.expectedCount.value,'Reviewed independent count',1000000000);string(p.expectedCount.source,'Count source locator');string(p.expectedCount.evidence,'Count source/review evidence');
   }
  }
 }
 return c;
}
export function selectionSha256(configuration,type,partition){
 return digest(canonical({endpoint:configuration.endpoint,type:{id:type.id,typeName:type.typeName,scope:type.scope},partition})).sha256;
}
function response(page,label,capture){
 requireValue(page&&typeof page.body==='string'&&SHA.test(page.sha256),'Retain the complete original '+label+' response.');
 const d=digest(page.body);requireValue(d.bytes===page.bytes&&d.sha256===page.sha256,'Original response bytes changed: '+label);
 requireValue(page.status===200,'Original capture response was unsuccessful: '+label);
 timestamp(page.receivedAt,label+' received time');
 requireValue(Date.parse(page.receivedAt)>=Date.parse(capture.startedAt)&&Date.parse(page.receivedAt)<=Date.parse(capture.completedAt),'A retained response is outside its declared observation interval.');
 const parsed=parseExactJSON(page.body);requireValue(parsed&&typeof parsed==='object'&&parsed.response&&typeof parsed.response==='object','Bubble Data API response envelope is absent.');
 return parsed.response;
}
/** Pagination covers the declared query population, never a transactional snapshot. */
export function inspectCapture(capture){
 requireValue(capture?.schema===CAPTURE_SCHEMA&&capture.state==='complete'&&ID.test(capture.operationId),'Choose a complete original Bubble capture.');
 timestamp(capture.startedAt,'Capture start');timestamp(capture.completedAt,'Capture end');
 requireValue(Date.parse(capture.completedAt)>=Date.parse(capture.startedAt),'Capture ends before it begins.');
 const c=configuration(capture);
 requireValue(['observed-interval','quiesced'].includes(capture.consistency?.mode),'Declare observation interval or evidenced quiescence.');
 requireValue(canonical(capture.consistency)===canonical(c.consistency),'Capture consistency differs from its original configuration.');
 if(capture.consistency.mode==='quiesced')string(capture.consistency.evidence,'Quiescence source evidence');
 requireValue(Array.isArray(capture.types)&&capture.types.length===c.types.length,'The complete selected data-type set differs.');
 unique(capture.types,t=>t.id,'captured type');
 const types=new Map(),populations=[],ceiling=c.plan==='enterprise'?10000000:50000;
 for(const spec of c.types){
  const captured=capture.types.find(t=>t.id===spec.id);
  requireValue(captured&&Array.isArray(captured.partitions)&&captured.partitions.length===spec.partitions.length,'A complete selected partition is missing.');
  unique(captured.partitions,p=>p.id,'captured partition');
  const records=[],origins=[],partitions=[];
  for(const partition of spec.partitions){
   const retained=captured.partitions.find(p=>p.id===partition.id);
   requireValue(retained&&Array.isArray(retained.pages)&&retained.pages.length>0,'Retain the complete original partition pages.');
   let cursor=0,total=null;const start=records.length;
   for(let i=0;i<retained.pages.length;i++){
    const page=retained.pages[i],b=response(page,spec.id+'/'+partition.id+'/'+i,capture);
    requireValue(page.request?.cursor===cursor&&page.request.limit===100&&page.request.exclude_remaining===false&&page.request.selectionSha256===selectionSha256(c,spec,partition),'Original request cursor, page size or selected query differs.');
    requireValue(number(b.cursor,'Response cursor',ceiling)===cursor&&Array.isArray(b.results),'Original response cursor/results differ.');
    const count=number(b.count,'Response page count',100),remaining=number(b.remaining,'Response remaining count',1000000000);
    requireValue(count===b.results.length,'Response count differs from complete retained rows.');
    const observed=cursor+count+remaining;if(total===null)total=observed;
    requireValue(observed===total,'The selected population count changed during pagination.');
    requireValue(total<=ceiling,'Partition exceeds the documented plan cursor ceiling; select explicit complete partitions or original full export.');
    requireValue(i===retained.pages.length-1?remaining===0:remaining>0,'Capture stopped before its terminal page or contains trailing pages.');
    requireValue(remaining===0||count>0,'A nonterminal page made no progress.');
    requireValue(cursor+count<=ceiling,'Page crosses the selected plan cursor ceiling.');
    for(let n=0;n<b.results.length;n++){
     const row=b.results[n];requireValue(row&&typeof row==='object'&&!Array.isArray(row)&&typeof row._id==='string'&&row._id.length>0&&row._id.length<=240,'Retain actual Bubble record IDs.');
     records.push(row);origins.push({recordId:row._id,partitionId:partition.id,page:i,pageRow:n,responseSha256:page.sha256});
    }
    cursor+=count;
   }
   requireValue(records.length-start===total,'Retained partition does not match its complete reported population.');
   requireValue(retained.countBefore&&retained.countAfter,'Retain the original first-page count and a separate same-query count after pagination.');
   requireValue(canonical(retained.countBefore)===canonical(retained.pages[0]),'Initial count must be the complete retained original first page.');
   for(const [label,countPage]of [['before',retained.countBefore],['after',retained.countAfter]]){
    const b=response(countPage,spec.id+'/'+partition.id+'/count-'+label,capture);
    requireValue(countPage.request?.cursor===0&&countPage.request.limit===100&&countPage.request.exclude_remaining===false&&countPage.request.selectionSha256===selectionSha256(c,spec,partition),'Observed count selects another original query.');
    requireValue(number(b.cursor,'Count response cursor')===0&&Array.isArray(b.results)&&number(b.count,'Observed count rows',100)===b.results.length&&b.results.length+number(b.remaining,'Observed remaining count',1000000000)===total,'The observed population count changed before/after pagination.');
   }
   requireValue(Date.parse(retained.countAfter.receivedAt)>=Date.parse(retained.pages.at(-1).receivedAt),'Following count predates the final retained page.');

   if(total===ceiling)requireValue(partition.expectedCount,'At the plan cursor ceiling, retain an independent same-population count and its source evidence.');
   if(partition.expectedCount)requireValue(number(partition.expectedCount.value,'Independent selected count',1000000000)===total,'The independently reviewed population count differs.');
   partitions.push({id:partition.id,records:total,pages:retained.pages.length,expectedCount:copy(partition.expectedCount??null),constraints:copy(partition.constraints)});
  }
  unique(records,row=>row._id,'Bubble record across selected partitions');
  requireValue(records.length<=1000000,'Retained type exceeds the original native one-million-row capacity.');
  types.set(spec.id,{spec,records,origins});
  populations.push({id:spec.id,typeName:spec.typeName,records:records.length,partitions,scope:copy(spec.scope),partitioning:copy(spec.partitioning)});
 }
 return {configuration:c,types,populations,consistency:copy(capture.consistency)};
}
const TYPES={text:['text','VARCHAR'],integer:['bigint','BIGINT'],decimal:['decimal',null],boolean:['bool','BOOLEAN'],date:['date','DATE'],timestamp:['timestamp','TIMESTAMP WITH TIME ZONE']};
function missingValue(policy,label){
 requireValue(policy&&['error','null','value'].includes(policy.mode),'Explicit missing-value policy required: '+label);
 if(policy.mode==='error')throw Error('Original mapped cell is absent: '+label);
 if(policy.mode==='null')return null;
 requireValue(own(policy,'value'),'Retain the explicit missing-cell replacement value.');return copy(policy.value);
}
function pointer(value,p,label){
 requireValue(typeof p==='string'&&(p===''||p.startsWith('/'))&&!/~(?:[^01]|$)/.test(p),'Use an exact JSON Pointer for '+label);
 if(p==='')return{found:true,value};
 for(const encoded of p.slice(1).split('/')){
  const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');
  if(value===null||typeof value!=='object'||!own(value,key))return{found:false};
  value=value[key];
 }
 return {found:true,value};
}
function rawCell(row,selector,inspection){
 requireValue(selector&&['record-id','field','list-item','list-ordinal'].includes(selector.kind),'Select explicit record, field or expanded-list source.');
 let selected;
 if(selector.kind==='record-id')selected={found:true,value:row.record._id};
 else if(selector.kind==='list-ordinal'){requireValue(own(row,'item'),'Use list ordinals only in a declared list table.');selected={found:true,value:String(row.ordinal)};}
 else if(selector.kind==='list-item'){requireValue(own(row,'item'),'Use list items only in a declared list table.');selected=pointer(row.item,selector.pointer??'','list item');}
 else selected=pointer(row.record,selector.pointer,'source field');
 let value=selected.found?selected.value:missingValue(selector.missing,selector.pointer??selector.kind);
 if(selector.lookup&&value!==null){
  const lookup=selector.lookup,target=inspection.types.get(lookup.typeId);
  requireValue(target,'Retain the complete independently selected lookup type: '+lookup.typeId);
  requireValue(typeof value==='string'||typeof value==='boolean','Lookup keys must be exact scalar identities.');
  const signature=canonical({typeId:lookup.typeId,keyPointer:lookup.keyPointer});
  inspection.lookupIndices??=new Map();let index=inspection.lookupIndices.get(signature);
  if(!index){index=new Map();for(const candidate of target.records){
   const key=pointer(candidate,lookup.keyPointer,'lookup identity');
   requireValue(key.found&&key.value!==null&&['string','boolean'].includes(typeof key.value),'Lookup identity is absent or not an exact scalar.');
   const k=canonical(key.value);requireValue(!index.has(k),'Lookup identity repeats in the captured type.');index.set(k,candidate);
  }inspection.lookupIndices.set(signature,index);}
  const found=index.get(canonical(value));
  if(!found)value=missingValue(lookup.missing,'captured lookup record '+String(value));
  else{const result=pointer(found,lookup.valuePointer,'lookup value');value=result.found?result.value:missingValue(lookup.missing,lookup.valuePointer);}
 }
 if(selector.encoding==='canonical-json')value=canonical(value);
 else requireValue(selector.encoding===undefined||selector.encoding==='scalar','Choose scalar or explicit canonical JSON text encoding.');
 return {value,missing:!selected.found};
}
function exactDecimal(v,c){
 requireValue(typeof v==='string'&&v.length<=256,'Exact decimal text required.');
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(v);requireValue(m,'Invalid exact decimal: '+v);
 const exp=Number(m[4]??0);requireValue(Number.isSafeInteger(exp)&&Math.abs(exp)<=100,'Decimal exponent exceeds declared domain.');
 let digits=(m[2]+(m[3]??'')).replace(/^0+(?=\d)/,''),scale=(m[3]?.length??0)-exp;
 if(!/[1-9]/.test(digits))return c.scale?'0.'+'0'.repeat(c.scale):'0';
 if(scale<0){digits+='0'.repeat(-scale);scale=0;}
 while(scale>c.scale&&digits.endsWith('0')){digits=digits.slice(0,-1);scale--;}
 requireValue(scale<=c.scale,'Decimal requires rounding; review its original value: '+v);
 digits+='0'.repeat(c.scale-scale);digits=digits.replace(/^0+(?=\d)/,'');
 requireValue(digits.length<=c.precision,'Decimal exceeds declared precision.');
 digits=digits.padStart(c.scale+1,'0');const sign=m[1]==='-'&&/[1-9]/.test(digits)?'-':'';
 return sign+(c.scale?digits.slice(0,-c.scale)+'.'+digits.slice(-c.scale):digits);
}
function typed(v,c){
 if(v===null){requireValue(c.nullable===true,'Null in required column '+c.name);return {value:null,cell:{type:'null'}};}
 if(c.valueMap){requireValue(v===null||['string','boolean'].includes(typeof v),'Mapped value must remain exact scalar.');const key=typeof v+':'+String(v);requireValue(own(c.valueMap,key),'Unmapped original enum/boolean '+c.name+': '+String(v));v=c.valueMap[key];}
 if(v===null){requireValue(c.nullable===true,'Mapped null in required column '+c.name);return {value:null,cell:{type:'null'}};}
 if(c.type==='text')requireValue(typeof v==='string','Text conversion must be explicit for '+c.name);
 else if(c.type==='integer'){requireValue(typeof v==='string'&&/^-?(?:0|[1-9]\d*)$/.test(v),'Exact integer text required: '+c.name);const n=BigInt(v);requireValue(n>=-9223372036854775808n&&n<=9223372036854775807n,'BIGINT range exceeded.');v=n.toString();}
 else if(c.type==='decimal')v=exactDecimal(v,c);
 else if(c.type==='boolean')requireValue(typeof v==='boolean','Boolean must be actual boolean or explicitly mapped: '+c.name);
 else if(c.type==='date'){requireValue(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&calendarDate(Number(v.slice(0,4)),Number(v.slice(5,7)),Number(v.slice(8,10))),'Valid ISO date required.');}
 else if(c.type==='timestamp'){timestamp(v,'Column '+c.name);requireValue(!/\.\d{7,}/.test(v),'Timestamp exceeds microsecond native precision.');}
 return {value:v,cell:{type:c.type,value:c.type==='boolean'?(v?'true':'false'):v}};
}

function validateColumn(c){
 name(c.name);requireValue(own(TYPES,c.type)&&typeof c.nullable==='boolean','Declare an exact supported type and nullability: '+c.name);
 if(c.type==='decimal')requireValue(Number.isInteger(c.precision)&&c.precision>=1&&c.precision<=38&&Number.isInteger(c.scale)&&c.scale>=0&&c.scale<=c.precision,'Declare exact DECIMAL precision and scale.');
 requireValue(c.source&&c.expected,'Both original independent selectors are required.');
}
function expand(table,side,ctx){
 const spec=table[side+'Rows']??{mode:'records'},out=[];
 requireValue(['records','list'].includes(spec.mode),'Select records or explicit list expansion.');
 for(let i=0;i<ctx.records.length;i++){
  const record=ctx.records[i],origin=ctx.origins[i];
  if(spec.mode==='records')out.push({record,origin});
  else{
   const p=pointer(record,spec.pointer,'list expansion');
   const values=p.found?p.value:missingValue(spec.missing,spec.pointer);
   requireValue(Array.isArray(values),'A list expansion requires an explicit full array; null/omitted lists need a reviewed array replacement.');
   values.forEach((item,ordinal)=>out.push({record,item,ordinal,origin}));
  }
 }
 requireValue(out.length<=1000000,'Expanded table exceeds native row capacity.');return out;
}
function project(table,side,ctx,inspection){
 const rows=[],cells=[],origins=[],missing=[];
 for(const [i,row]of expand(table,side,ctx).entries()){
  const value=Object.create(null),cell=[];
  for(const c of table.columns){
   const selected=rawCell(row,c[side],inspection),resolved=typed(selected.value,{...c,valueMap:c[side].valueMap??c.valueMap});
   value[c.name]=resolved.value;cell.push(resolved.cell);
   if(selected.missing)missing.push({row:i,recordId:row.record._id,column:c.name,selector:copy(c[side])});
  }
  rows.push(value);cells.push(cell);origins.push({row:i,...row.origin,...(own(row,'item')?{listOrdinal:row.ordinal}:{})});
 }
 unique(rows,row=>canonical(table.primaryKey.map(k=>{requireValue(row[k]!==null,'A primary key contains null.');return row[k];})),side+' business identity '+table.name);
 return {rows,cells,origins,missing};
}
function relationshipReport(mapping,tables){
 const rows=[];unique(mapping.relationships??[],r=>r.id,'relationship');
 for(const r of mapping.relationships??[]){
  requireValue(ID.test(r.id)&&Array.isArray(r.childColumns)&&Array.isArray(r.parentColumns)&&r.childColumns.length>0&&r.childColumns.length===r.parentColumns.length,'Retain explicit complete relationship keys.');
  const child=tables.find(t=>t.name===r.childTable),parent=tables.find(t=>t.name===r.parentTable);requireValue(child&&parent,'Relationship table absent.');
  for(const [t,cols]of [[child,r.childColumns],[parent,r.parentColumns]])for(const c of cols)requireValue(t.columns.some(x=>x.name===c),'Relationship column absent: '+c);
  requireValue(['allow-all-null','reject'].includes(r.nulls),'Declare the original relationship null policy.');
  for(const side of ['source','expected']){
   const keys=parent[side].rows.map(row=>canonical(r.parentColumns.map(k=>row[k])));
   requireValue(new Set(keys).size===keys.length,'Relationship parent identity is not unique.');
   const present=new Set(keys),orphans=[];
   child[side].rows.forEach((row,index)=>{const key=r.childColumns.map(k=>row[k]);
    if(key.every(x=>x===null)&&r.nulls==='allow-all-null')return;
    if(key.some(x=>x===null)||!present.has(canonical(key)))orphans.push({row:index,key});
   });
   rows.push({id:r.id,provider:side,childTable:r.childTable,parentTable:r.parentTable,orphans,count:orphans.length});
  }
 }
 return rows;
}
export function prepareProviderMigration({capture,mapping}){
 requireValue(capture?.schema===BUNDLE_SCHEMA&&capture.source&&capture.expected,'Retain separate complete source and expected Bubble captures.');
 requireValue(capture.source.operationId!==capture.expected.operationId,'Expected values require a separately retained original capture operation.');
 const sides={source:inspectCapture(capture.source),expected:inspectCapture(capture.expected)};
 requireValue(mapping?.schema===MAPPING_SCHEMA&&ID.test(mapping.id)&&Array.isArray(mapping.tables)&&mapping.tables.length>0&&mapping.tables.length<=50,'Choose one to fifty explicit reviewed mapping tables.');
 string(mapping.expectedBasis,'Independent expected-population basis');
 unique(mapping.tables,t=>t.name,'mapped table');
 const tables=[],files=[];
 for(const t of mapping.tables){
  name(t.name);requireValue(Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=500,'Retain every selected mapped column.');
  unique(t.columns,c=>c.name,'mapped column');t.columns.forEach(validateColumn);
  requireValue(Array.isArray(t.primaryKey)&&t.primaryKey.length>0&&new Set(t.primaryKey).size===t.primaryKey.length&&t.primaryKey.every(k=>t.columns.some(c=>c.name===k&&!c.nullable)),'Declare a complete nonnull business identity.');
  const source=sides.source.types.get(t.sourceTypeId),expected=sides.expected.types.get(t.expectedTypeId);
  requireValue(source&&expected,'Original mapped data type is absent from complete capture.');
  const left=project(t,'source',source,sides.source),right=project(t,'expected',expected,sides.expected);
  const columns=t.columns.map(c=>({name:c.name,type:c.type==='decimal'?'DECIMAL('+c.precision+','+c.scale+')':TYPES[c.type][1]}));
  const sourcePath='inputs/'+t.name+'.json',expectedPath='expected/'+t.name+'.json';
  files.push(file(sourcePath,json(left.rows)),file(expectedPath,json({schema:'dlthub.expected-table.v1',table:t.name,complete:true,rowCount:right.rows.length,columns,rows:right.cells})));
  tables.push({name:t.name,columns:copy(t.columns),primaryKey:copy(t.primaryKey),sourcePath,expectedPath,source:left,expected:right,sourceTypeId:t.sourceTypeId,expectedTypeId:t.expectedTypeId});
 }
 const relationships=relationshipReport(mapping,tables);
 const consistency={source:sides.source.consistency,expected:sides.expected.consistency,expectedBasis:mapping.expectedBasis};
 const projection={schema:'bubble.projection.v1',mappingId:mapping.id,capture:digest(json(capture)),mapping:digest(json(mapping)),captureOperations:{source:capture.source.operationId,expected:capture.expected.operationId},populations:{source:sides.source.populations,expected:sides.expected.populations},consistency,
  tables:tables.map(t=>({name:t.name,sourceTypeId:t.sourceTypeId,expectedTypeId:t.expectedTypeId,sourcePath:t.sourcePath,expectedPath:t.expectedPath,sourceRows:t.source.rows.length,expectedRows:t.expected.rows.length,columns:t.columns,primaryKey:t.primaryKey,sourceOrigins:t.source.origins,expectedOrigins:t.expected.origins,missingCells:{source:t.source.missing,expected:t.expected.missing}})),
  relationships,coverage:{deleted:'not-observed-by-list',privacy:'GET results are the population visible to the configured credential and privacy rules; hidden records/fields remain unknown.',partitions:'Complete pagination of the selected queries, with explicit reviewed partition coverage; live pages do not establish a transactional snapshot.',files:'Original file URLs/metadata remain in exact response bodies; file contents require separately retained authorized downloads.'}};
 files.push(file('capture.json',json(capture)),file('source-capture.json',json(capture.source)),file('expected-capture.json',json(capture.expected)),file('mapping.json',json(mapping)),file('projection.json',json(projection)));
 const manifest={schema:'bubble.prepared.v1',operationId:capture.source.operationId,expectedOperationId:capture.expected.operationId,mappingId:mapping.id,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})),
  tables:projection.tables.map(({name,sourcePath,expectedPath,columns,primaryKey,sourceRows,expectedRows})=>({name,sourcePath,expectedPath,columns,primaryKey,sourceRows,expectedRows})),relationships,consistency};
 return{manifest,files};
}
export function bindProviderPipeline(prepared,sourceIds,options={}){
 requireValue(prepared?.manifest?.schema==='bubble.prepared.v1'&&Array.isArray(prepared.files),'Choose the complete prepared Bubble originals.');
 unique(prepared.files,f=>f.path,'prepared member');unique(prepared.manifest.files,f=>f.path,'manifest member');
 requireValue(prepared.files.length===prepared.manifest.files.length,'Prepared complete member count differs.');
 for(const d of prepared.manifest.files){const f=prepared.files.find(x=>x.path===d.path);requireValue(f&&digest(f.content).sha256===d.sha256&&digest(f.content).bytes===d.bytes,'Prepared member changed: '+d.path);}
 const source=prepared.files.find(f=>f.path==='capture.json'),mapping=prepared.files.find(f=>f.path==='mapping.json');
 requireValue(source&&mapping,'Retain complete original captures and reviewed mapping.');
 const reopened=prepareProviderMigration({capture:JSON.parse(source.content),mapping:JSON.parse(mapping.content)});
 requireValue(canonical(reopened.manifest)===canonical(prepared.manifest),'Prepared binding differs from complete original inputs.');
 const ids=new Set(),select=path=>{const id=sourceIds[path];requireValue(typeof id==='string'&&ID.test(id)&&!ids.has(id),'Use each actual independently retained original source ID once: '+path);ids.add(id);return id;};
 const tables=prepared.manifest.tables;
 return {schema:'dlthub.pipeline-input.v1',title:options.title??'Bubble source and destination reconciliation',pipelineName:name(options.pipelineName??'bubble_migration'),datasetName:name(options.datasetName??'bubble_migration'),phase:'baseline',
  resources:tables.map(t=>({name:t.name,tableName:t.name,sourceId:select(t.sourcePath),format:'json',columns:t.columns.map(c=>({name:c.name,data_type:TYPES[c.type][0],nullable:c.nullable,...(c.type==='decimal'?{precision:c.precision,scale:c.scale}:{}),...(c.type==='timestamp'?{timezone:true}:{})})),primaryKey:t.primaryKey,writeDisposition:'replace',schemaContract:{tables:'evolve',columns:'freeze',data_type:'freeze'},maxTableNesting:0,notes:'Complete selected Bubble source; separately retained destination capture supplies expected values.'})),
  acceptance:tables.map(t=>({table:t.name,expectedSourceId:select(t.expectedPath),columns:t.columns.map(c=>({name:c.name,cellType:c.type})),primaryKey:t.primaryKey,ignoredRightColumns:['_dlt_id','_dlt_load_id']})),
  limits:{maxRows:Math.max(1,...tables.flatMap(t=>[t.sourceRows,t.expectedRows])),maxBytes:536870912,workers:1},
  sourceEvidence:prepared.manifest.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),
  sourceBoundary:'Only the original local DuckDB destination is written. Actual Bubble API capture is read-only; privacy-visible selected populations and complete expected originals are retained.',
  notes:'Review all relationships and original query/credential population boundaries in projection.json. Missing records are not inferred deletions.'};
}
export function compareCapturePopulations({before,after}){
 const a=inspectCapture(before),b=inspectCapture(after);
 requireValue(Date.parse(after.startedAt)>=Date.parse(before.completedAt),'Following capture must follow the original observed interval.');
 requireValue(canonical({endpoint:a.configuration.endpoint,types:a.configuration.types,plan:a.configuration.plan})===canonical({endpoint:b.configuration.endpoint,types:b.configuration.types,plan:b.configuration.plan}),'Compare only identical app, environment, query, ordering and selected populations.');
 const rows=[];
 for(const [id,old]of a.types){const current=b.types.get(id),prior=new Set(old.records.map(r=>r._id)),next=new Set(current.records.map(r=>r._id));
  rows.push({id,added:[...next].filter(x=>!prior.has(x)),notObservedInFollowingScope:[...prior].filter(x=>!next.has(x))});}
 return {schema:'bubble.population-change.v1',previous:digest(json(before)),current:digest(json(after)),rows,meaning:'Observed selected-population changes only. No deletion or vendor write is inferred.'};
}
