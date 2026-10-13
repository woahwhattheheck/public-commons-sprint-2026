// SPDX-License-Identifier: MIT
// Complete retained provider capture -> original migration-acceptance inputs.
import {sha256Utf8} from './sha256.mjs';
import {parseExactJSON} from '../../workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs';
export const CAPTURE_SCHEMA='airtable-netsuite.capture.v1';
export const MAPPING_SCHEMA='airtable-netsuite.mapping.v1';
const NAME=/^[a-z][a-z0-9_]{0,62}$/, ID=/^[A-Za-z0-9_-]{1,160}$/, SHA=/^[a-f0-9]{64}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=v=>JSON.parse(JSON.stringify(v));
export function requireValue(ok,message){if(!ok)throw new Error(message);}
export function json(value){return JSON.stringify(value,null,2)+'\n';}
export function digest(content){requireValue(typeof content==='string','Complete UTF-8 source required.');return sha256Utf8(content);}
export function file(path,content){return {path,content,...digest(content)};}
function name(v){requireValue(typeof v==='string'&&NAME.test(v),'Use a unique explicit normalized native identifier: '+v);return v;}
function string(v,label){requireValue(typeof v==='string'&&v.trim().length>0,label+' is required.');return v;}
function number(v,label,max=1000000){requireValue(/^(0|[1-9]\d*)$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)<=max,label+' must be a bounded nonnegative integer.');return Number(v);}
function unique(rows,key,label){const seen=new Set();for(const r of rows){const k=key(r);requireValue(!seen.has(k),'Repeated '+label+': '+k);seen.add(k);}return seen;}
function calendarDate(year,month,day){const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];return year>=1&&year<=9999&&month>=1&&month<=12&&day>=1&&day<=days[month-1];}
function timestamp(v,label){
 const m=typeof v==='string'&&/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|([+-])(\d\d):(\d\d))$/.exec(v);
 requireValue(m&&calendarDate(Number(m[1]),Number(m[2]),Number(m[3]))&&Number(m[4])<=23&&Number(m[5])<=59&&Number(m[6])<=59&&(m[8]==='Z'||Number(m[10])<=23&&Number(m[11])<=59)&&Number.isFinite(Date.parse(v)),label+' must be a valid calendar timestamp with explicit timezone.');
 return v;
}
function body(page,label){requireValue(page&&typeof page.body==='string'&&SHA.test(page.sha256),'Retain the exact '+label+' response body/hash.');const d=digest(page.body);requireValue(d.bytes===page.bytes&&d.sha256===page.sha256,'Original '+label+' body differs.');requireValue(page.status===200,'Original '+label+' response was not successful.');timestamp(page.receivedAt,label+' response time');return parseExactJSON(page.body);}
function cfg(capture){const c=capture.configuration;requireValue(c?.schema==='airtable-netsuite.capture-config.v1'&&c.operationId===capture.operationId,'Original configuration and capture operation differ.');requireValue(c&&Array.isArray(c.airtable?.tables)&&Array.isArray(c.netsuite?.queries),'Both original provider selections are required.');requireValue(/^app[A-Za-z0-9]+$/.test(c.airtable.baseId),'Select the original Airtable base ID.');requireValue(/^[a-z0-9-]+\.suitetalk\.api\.netsuite\.com$/.test(c.netsuite.accountHost),'Select the original NetSuite REST account hostname.');unique(c.airtable.tables,x=>x.tableId,'Airtable table');unique(c.netsuite.queries,x=>x.id,'SuiteQL selection');for(const x of [...c.airtable.tables,...c.netsuite.queries]){string(x.scope?.population,'Selected population');requireValue(['all-live','filtered-live'].includes(x.scope?.coverage),'State full live or selected live population.');string(x.scope?.inactive,'Inactive-record inclusion/exclusion');requireValue(x.scope?.deleted==='not-observed-by-list','List exports must explicitly retain the deleted-record coverage boundary.');}return c;}
function pages(rows,label){requireValue(Array.isArray(rows)&&rows.length>0,label+' has no complete pages.');}
function canonicalObject(v){if(Array.isArray(v))return v.map(canonicalObject);if(v&&typeof v==='object'){const out=Object.create(null);for(const k of Object.keys(v).sort())out[k]=canonicalObject(v[k]);return out;}return v;}
export function canonical(v){return JSON.stringify(canonicalObject(v));}
function schemaFor(raw,id){requireValue(Array.isArray(raw.tables),'Complete Airtable base schema is missing.');const t=raw.tables.find(x=>x.id===id);requireValue(t&&Array.isArray(t.fields),'Selected Airtable table is absent in the original base schema: '+id);unique(t.fields,x=>x.id,'schema field');return t;}
function aliasObject(row){requireValue(row&&typeof row==='object'&&!Array.isArray(row),'SuiteQL rows must be objects.');const o=Object.create(null);for(const [k,v]of Object.entries(row)){const key=k.toLowerCase();requireValue(!own(o,key),'SuiteQL aliases collide after documented case normalization: '+k);o[key]=v;}return o;}
/** Validates complete pagination and raw identities. No transformation or acceptance occurs here. */
export function inspectCapture(capture){
 requireValue(capture?.schema===CAPTURE_SCHEMA&&capture.state==='complete','Select a complete original provider capture.');
 requireValue(ID.test(capture.operationId),'Original capture operation ID required.');
 timestamp(capture.startedAt,'Capture start');timestamp(capture.completedAt,'Capture end');
 requireValue(Date.parse(capture.completedAt)>=Date.parse(capture.startedAt),'Capture ends before it starts.');
 const c=cfg(capture),before=body(capture.airtable.schemaBefore,'Airtable initial schema'),after=body(capture.airtable.schemaAfter,'Airtable final schema');
 requireValue(capture.airtable.baseId===c.airtable.baseId&&capture.netsuite.accountHost===c.netsuite.accountHost,'Original provider account identity differs.');
 requireValue(capture.consistency?.mode==='observed-interval'||capture.consistency?.mode==='quiesced','Declare observed interval or evidenced quiescence.');
 if(capture.consistency.mode==='quiesced')string(capture.consistency.evidence,'Retained quiescence evidence');
 const tables=new Map(),queries=new Map(),populations=[];
 requireValue(capture.airtable.tables.length===c.airtable.tables.length&&capture.netsuite.queries.length===c.netsuite.queries.length,'Provider selection coverage differs.');
 unique(capture.airtable.tables,x=>x.tableId,'captured table');unique(capture.netsuite.queries,x=>x.id,'captured query');
 for(const spec of c.airtable.tables){
  requireValue(/^tbl[A-Za-z0-9]+$/.test(spec.tableId),'Use the original Airtable table ID.');
  const old=schemaFor(before,spec.tableId),current=schemaFor(after,spec.tableId);
  requireValue(canonical(old)===canonical(current),'The selected Airtable schema changed during capture: '+spec.tableId);
  const t=capture.airtable.tables.find(x=>x.tableId===spec.tableId);requireValue(t,'Original Airtable table capture missing.');pages(t.pages,spec.tableId);
  const records=[],seenOffsets=new Set();let offset=null;
  for(let i=0;i<t.pages.length;i++){
   const p=t.pages[i],b=body(p,spec.tableId+' page '+i);
   requireValue(p.request?.offset===offset,'Airtable offset chain differs.');
   requireValue(p.request.selectionSha256===digest(canonical({baseId:c.airtable.baseId,selection:spec})).sha256,'Airtable selected population differs.');
   requireValue(p.request?.pageSize===100&&p.request?.returnFieldsByFieldId===true,'Retain full field-ID pages with pageSize 100.');
   requireValue(Array.isArray(b.records)&&b.records.length<=100,'Airtable records page differs.');
   requireValue(offset===null||!seenOffsets.has(offset),'Repeated Airtable offset.');if(offset!==null)seenOffsets.add(offset);
   for(const r of b.records){requireValue(typeof r.id==='string'&&/^rec[A-Za-z0-9]+$/.test(r.id)&&r.fields&&typeof r.fields==='object'&&!Array.isArray(r.fields),'Original Airtable record shape differs.');for(const k of Object.keys(r.fields))requireValue(old.fields.some(f=>f.id===k),'Airtable returned an unknown field ID: '+k);records.push(r);}
   offset=own(b,'offset')?string(b.offset,'Opaque Airtable offset'):null;
   requireValue(i===t.pages.length-1?offset===null:offset!==null,'Airtable export stopped before its terminal page or retained trailing pages.');
  }
  unique(records,r=>r.id,'Airtable stable record ID');tables.set(spec.tableId,{schema:old,records,spec});
  populations.push({provider:'airtable',id:spec.tableId,records:records.length,pages:t.pages.length,scope:copy(spec.scope)});
 }
 for(const spec of c.netsuite.queries){
  requireValue(ID.test(spec.id)&&typeof spec.q==='string'&&/^\s*SELECT\b/i.test(spec.q)&&/\bORDER\s+BY\b/i.test(spec.q),'Retain a reviewed SELECT with deterministic ORDER BY.');
  requireValue(spec.order?.unique===true&&Array.isArray(spec.order.aliases)&&spec.order.aliases.length>0,'Document the unique ordering aliases.');
  const q=capture.netsuite.queries.find(x=>x.id===spec.id);requireValue(q,'Original SuiteQL query capture missing.');pages(q.pages,spec.id);
  requireValue(q.pages.length<=1000,'SuiteQL page limit reached.');const limit=number(spec.limit??1000,'SuiteQL page size',1000);requireValue(limit>0,'Positive SuiteQL page size required.');
  const rows=[];let total=null;
  for(let i=0;i<q.pages.length;i++){
   const p=q.pages[i],b=body(p,spec.id+' page '+i),offset=i*limit;
   requireValue(p.request?.offset===offset&&p.request?.limit===limit,'SuiteQL requested page chain differs.');
   requireValue(p.request.querySha256===digest(canonical({q:spec.q,params:spec.params??[]})).sha256,'SuiteQL query/parameters changed.');
   requireValue(number(b.offset,'SuiteQL response offset')===offset&&Array.isArray(b.items),'SuiteQL page offset/items differ.');
   requireValue(number(b.count,'SuiteQL count',1000)===b.items.length&&b.items.length<=limit,'SuiteQL count differs.');
   const t=number(b.totalResults,'SuiteQL totalResults',100000);if(total===null)total=t;requireValue(total===t,'SuiteQL population count changed between pages.');
   requireValue(typeof b.hasMore==='boolean','SuiteQL hasMore is absent.');requireValue(i===q.pages.length-1?!b.hasMore:b.hasMore,'SuiteQL capture lacks its final page or has trailing pages.');
   if(b.hasMore)requireValue(b.items.length===limit,'A nonterminal SuiteQL page is short.');
   for(const row of b.items)rows.push(aliasObject(row));
  }
  requireValue(rows.length===total,'SuiteQL complete row count differs.');
  const ceiling=Math.min(100000,1000*limit);
  if(rows.length===ceiling)requireValue(spec.countQuery&&q.countBefore&&q.countAfter,'At the documented REST/page ceiling, retain an independently reviewed same-population count query before and after capture.');
  if(spec.countQuery){
   const countSpec=spec.countQuery;requireValue(countSpec.samePopulationAsSelection===true&&typeof countSpec.reviewEvidence==='string'&&countSpec.reviewEvidence.trim(),'Retain the same-population count query review.');
   requireValue(typeof countSpec.q==='string'&&/^\s*SELECT\b/i.test(countSpec.q)&&typeof countSpec.alias==='string','Retain explicit independent count query and alias.');
   for(const [label,page]of [['before',q.countBefore],['after',q.countAfter]]){
    const b=body(page,spec.id+' independent count '+label);
    requireValue(page.request?.offset===0&&page.request?.limit===1&&page.request?.querySha256===digest(canonical({q:countSpec.q,params:countSpec.params??[]})).sha256,'Independent count query request changed.');
    requireValue(Array.isArray(b.items)&&b.items.length===1&&b.hasMore===false&&number(b.count,'Count-query row count')===1&&number(b.totalResults,'Count-query total')===1&&number(b.offset,'Count-query offset')===0,'Independent count query must return one complete aggregate row.');
    const result=aliasObject(b.items[0]),key=countSpec.alias.toLowerCase();requireValue(own(result,key)&&/^(0|[1-9]\d*)$/.test(result[key]),'Independent population count must remain an exact integer.');
    requireValue(BigInt(result[key])===BigInt(rows.length),'Independent selected-population count differs from captured complete rows.');
   }
  }

  unique(rows,row=>canonical(spec.order.aliases.map(a=>{const k=a.toLowerCase();requireValue(own(row,k)&&row[k]!==null,'Ordering identity is missing: '+a);return row[k];})),'SuiteQL stable ordering identity');
  queries.set(spec.id,{rows,spec});
  populations.push({provider:'netsuite',id:spec.id,records:rows.length,pages:q.pages.length,scope:copy(spec.scope)});
 }
 return {configuration:c,tables,queries,populations,consistency:copy(capture.consistency)};
}
const TYPES={text:['text','VARCHAR'],integer:['bigint','BIGINT'],decimal:['decimal',null],boolean:['bool','BOOLEAN'],date:['date','DATE'],timestamp:['timestamp','TIMESTAMP WITH TIME ZONE']};
function missingValue(policy,label){requireValue(policy&&['error','null','value'].includes(policy.mode),'Explicit missing-cell policy required: '+label);if(policy.mode==='error')throw Error('Original mapped cell is absent: '+label);return policy.mode==='null'?null:copy(policy.value);}
function rawCell(row,selector,provider,ctx){
 requireValue(selector&&typeof selector==='object','Original source selector required.');
 if(provider==='airtable'){
  if(selector.recordId===true)return row.id;
  if(selector.linkRecordId===true){requireValue(row._link,'Select a linked-record expansion.');return row._link.recordId;}
  if(selector.linkOrdinal===true){requireValue(row._link,'Select a linked-record expansion.');return String(row._link.ordinal);}
  if(selector.linkedFieldId){requireValue(row._link?.targetRow,'Original linked record is outside the captured target population.');requireValue(ctx.linkSchema.fields.some(f=>f.id===selector.linkedFieldId),'Mapped linked field absent in captured schema.');return own(row._link.targetRow.fields,selector.linkedFieldId)?row._link.targetRow.fields[selector.linkedFieldId]:missingValue(selector.missing,selector.linkedFieldId);}
  if(selector.createdTime===true){requireValue(own(row,'createdTime'),'Original record creation time missing.');return row.createdTime;}
  requireValue(typeof selector.fieldId==='string'&&ctx.schema.fields.some(x=>x.id===selector.fieldId),'Mapped Airtable field ID absent in retained schema.');
  return own(row.fields,selector.fieldId)?row.fields[selector.fieldId]:missingValue(selector.missing,selector.fieldId);
 }
 requireValue(typeof selector.alias==='string'&&selector.alias.length>0,'Explicit NetSuite alias required.');const key=selector.alias.toLowerCase();
 return own(row,key)?row[key]:missingValue(selector.missing,selector.alias);
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
 if(c.type==='text')requireValue(typeof v==='string','Text conversion must be explicit for '+c.name);
 else if(c.type==='integer'){requireValue(typeof v==='string'&&/^-?(?:0|[1-9]\d*)$/.test(v),'Exact integer text required: '+c.name);const n=BigInt(v);requireValue(n>=-9223372036854775808n&&n<=9223372036854775807n,'BIGINT range exceeded.');v=n.toString();}
 else if(c.type==='decimal')v=exactDecimal(v,c);
 else if(c.type==='boolean')requireValue(typeof v==='boolean','Boolean must be actual boolean or explicitly mapped: '+c.name);
 else if(c.type==='date'){requireValue(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&calendarDate(Number(v.slice(0,4)),Number(v.slice(5,7)),Number(v.slice(8,10))),'Valid ISO date required.');}
 else if(c.type==='timestamp'){timestamp(v,'Column '+c.name);requireValue(!/\.\d{7,}/.test(v),'Timestamp exceeds microsecond native precision.');}
 return {value:v,cell:{type:c.type,value:c.type==='boolean'?(v?'true':'false'):v}};
}
function validateColumn(c){
 name(c.name);requireValue(own(TYPES,c.type),'Select supported exact scalar type for '+c.name);
 requireValue(typeof c.nullable==='boolean','Declare nullability for '+c.name);
 if(c.type==='decimal')requireValue(Number.isInteger(c.precision)&&c.precision>=1&&c.precision<=38&&Number.isInteger(c.scale)&&c.scale>=0&&c.scale<=c.precision,'Declare DECIMAL precision/scale.');
 requireValue(c.airtable&&c.netsuite,'Both independent provider selectors required.');
}
function project(records,table,provider,ctx){
 const rows=[],cells=[],origins=[],missing=[];
 for(let i=0;i<records.length;i++){
  const row=records[i],out=Object.create(null),typedRow=[];
  for(const col of table.columns){const selector=col[provider];if(provider==='airtable'&&selector.fieldId&&!own(row.fields,selector.fieldId))missing.push({row:i,recordId:row.id,column:col.name,fieldId:selector.fieldId,policy:copy(selector.missing)});const value=rawCell(row,selector,provider,ctx);const t=typed(value,{...col,valueMap:selector.valueMap??col.valueMap});out[col.name]=t.value;typedRow.push(t.cell);}
  rows.push(out);cells.push(typedRow);origins.push(provider==='airtable'?{row:i,recordId:row.id,...(row._link?{linkedRecordId:row._link.recordId,linkOrdinal:row._link.ordinal}:{})}:{row:i,identity:ctx.spec.order.aliases.map(k=>row[k.toLowerCase()])});
 }
 const key=row=>canonical(table.primaryKey.map(k=>{requireValue(row[k]!==null,'Null in original business identity.');return row[k];}));unique(rows,key,provider+' business key '+table.name);
 return {rows,cells,origins,missing};
}

function expanded(table,ctx,inspection){
 const spec=table.airtableRows??{mode:'records'};
 if(spec.mode==='records')return {records:ctx.records,ctx};
 requireValue(spec.mode==='links'&&typeof spec.fieldId==='string','Explicit Airtable records or links projection required.');
 const field=ctx.schema.fields.find(f=>f.id===spec.fieldId);requireValue(field?.type==='multipleRecordLinks','Selected expansion must be a linked-record field.');
 const target=inspection.tables.get(field.options?.linkedTableId);requireValue(target,'Retain the complete selected linked table.');
 const index=new Map(target.records.map(r=>[r.id,r])),records=[];
 for(const row of ctx.records){
  const links=own(row.fields,spec.fieldId)?row.fields[spec.fieldId]:missingValue(spec.missing,spec.fieldId);
  requireValue(Array.isArray(links)&&links.every(id=>typeof id==='string'&&/^rec[A-Za-z0-9]+$/.test(id)),'Linked records must retain the complete original ID array.');
  links.forEach((id,ordinal)=>records.push({...row,_link:{recordId:id,ordinal,targetRow:index.get(id)}}));
 }
 return {records,ctx:{...ctx,linkSchema:target.schema}};
}

function relations(mapping,results){
 unique(mapping.relationships??[],x=>x.id,'relationship ID');
 const out=[];
 for(const r of mapping.relationships??[]){
  requireValue(ID.test(r.id)&&Array.isArray(r.childColumns)&&Array.isArray(r.parentColumns)&&r.childColumns.length>0&&r.childColumns.length===r.parentColumns.length,'Explicit relationship identity/columns required.');
  const child=results.find(x=>x.name===r.childTable),parent=results.find(x=>x.name===r.parentTable);requireValue(child&&parent,'Relationship table absent.');
  for(const [t,cs]of [[child,r.childColumns],[parent,r.parentColumns]])for(const c of cs)requireValue(t.columns.some(x=>x.name===c),'Relationship column absent.');
  requireValue(['allow-all-null','reject'].includes(r.nulls),'Declare nullable relationship policy.');
  for(const side of ['airtable','netsuite']){
   const parentKeys=parent[side].rows.map(x=>canonical(r.parentColumns.map(c=>x[c])));requireValue(new Set(parentKeys).size===parentKeys.length,'Relationship parent identity is not unique: '+r.id+' / '+side);
   const parents=new Set(parentKeys);const orphans=[];
   child[side].rows.forEach((row,index)=>{const values=r.childColumns.map(c=>row[c]);if(values.every(x=>x===null)&&r.nulls==='allow-all-null')return;if(values.some(x=>x===null)||!parents.has(canonical(values)))orphans.push({row:index,key:values});});
   out.push({id:r.id,provider:side,childTable:r.childTable,parentTable:r.parentTable,orphans,count:orphans.length});
  }
 }
 return out;
}
/** Expected tables are projected only from independently retained SuiteQL pages. */
export function prepareProviderMigration({capture,mapping}){
 const inspected=inspectCapture(capture);
 requireValue(mapping?.schema===MAPPING_SCHEMA&&ID.test(mapping.id),'Reviewed provider mapping required.');
 requireValue(Array.isArray(mapping.tables)&&mapping.tables.length>0&&mapping.tables.length<=50,'Select one to fifty explicit mapped tables.');
 unique(mapping.tables,x=>x.name,'mapped native table');const results=[],files=[];
 for(const t of mapping.tables){
  name(t.name);requireValue(Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=500,'Declare complete selected business columns.');unique(t.columns,c=>c.name,'mapped column');t.columns.forEach(validateColumn);
  requireValue(Array.isArray(t.primaryKey)&&t.primaryKey.length>0&&new Set(t.primaryKey).size===t.primaryKey.length&&t.primaryKey.every(k=>t.columns.some(c=>c.name===k&&!c.nullable)),'Declare nonnull unique business-key columns.');
  const a=inspected.tables.get(t.airtableTableId),n=inspected.queries.get(t.netsuiteQueryId);requireValue(a&&n,'Mapped original provider table/query missing.');
  const expandedSource=expanded(t,a,inspected);
  const left=project(expandedSource.records,t,'airtable',expandedSource.ctx),right=project(n.rows,t,'netsuite',n);
  requireValue(left.rows.length<=1000000&&right.rows.length<=1000000,'Projected full source exceeds the original native row cap.');
  const columns=t.columns.map(c=>({name:c.name,type:c.type==='decimal'?'DECIMAL('+c.precision+','+c.scale+')':TYPES[c.type][1]}));
  const sourcePath='inputs/'+t.name+'.json',expectedPath='expected/'+t.name+'.json';
  files.push(file(sourcePath,json(left.rows)));
  files.push(file(expectedPath,json({schema:'dlthub.expected-table.v1',table:t.name,complete:true,rowCount:right.rows.length,columns,rows:right.cells})));
  results.push({name:t.name,columns:copy(t.columns),primaryKey:copy(t.primaryKey),sourcePath,expectedPath,airtable:left,netsuite:right,sourceTableId:t.airtableTableId,expectedQueryId:t.netsuiteQueryId});
 }
 const relationshipReport=relations(mapping,results);
 const projection={schema:'airtable-netsuite.projection.v1',operationId:capture.operationId,mappingId:mapping.id,capture:digest(json(capture)),mapping:digest(json(mapping)),populations:inspected.populations,consistency:inspected.consistency,tables:results.map(t=>({name:t.name,sourceTableId:t.sourceTableId,expectedQueryId:t.expectedQueryId,sourcePath:t.sourcePath,expectedPath:t.expectedPath,sourceRows:t.airtable.rows.length,expectedRows:t.netsuite.rows.length,columns:t.columns,primaryKey:t.primaryKey,sourceOrigins:t.airtable.origins,expectedOrigins:t.netsuite.origins,missingCells:t.airtable.missing})),relationships:relationshipReport,coverage:{deleted:'not-observed-by-list',attachments:'metadata remains in full original response; attachment binaries require a separately retained download',snapshot:'Complete selected pagination; observed interval is not a transactional cross-provider snapshot.'}};
 files.push(file('capture.json',json(capture)),file('mapping.json',json(mapping)),file('projection.json',json(projection)));
 const manifest={schema:'airtable-netsuite.prepared.v1',operationId:capture.operationId,mappingId:mapping.id,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})),tables:projection.tables.map(({name,sourcePath,expectedPath,columns,primaryKey,sourceRows,expectedRows})=>({name,sourcePath,expectedPath,columns,primaryKey,sourceRows,expectedRows})),relationships:relationshipReport,consistency:inspected.consistency};
 return {manifest,files};
}
/** Actual IDs are returned by the existing source.retain writer; no new writer. */
export function bindProviderPipeline(prepared,sourceIds,options={}){
 requireValue(prepared?.manifest?.schema==='airtable-netsuite.prepared.v1','Select the complete prepared original source.');
 for(const d of prepared.manifest.files){const f=prepared.files.find(x=>x.path===d.path);requireValue(f&&digest(f.content).sha256===d.sha256&&digest(f.content).bytes===d.bytes,'Prepared member differs: '+d.path);}
 const captured=prepared.files.find(x=>x.path==='capture.json'),mapped=prepared.files.find(x=>x.path==='mapping.json');
 requireValue(captured&&mapped,'Original capture and mapping source must travel with binding.');
 const reopened=prepareProviderMigration({capture:JSON.parse(captured.content),mapping:JSON.parse(mapped.content)});
 requireValue(canonical(reopened.manifest)===canonical(prepared.manifest),'Prepared table/source binding differs from complete original inputs.');
 const tables=prepared.manifest.tables,selectedIds=new Set();
 const select=path=>{const id=sourceIds[path];requireValue(typeof id==='string'&&ID.test(id),'Retain the original native source before binding '+path);requireValue(!selectedIds.has(id),'Source and independent expected files require distinct retained source IDs.');selectedIds.add(id);return id;};
 const resources=tables.map(t=>({name:t.name,tableName:t.name,sourceId:select(t.sourcePath),format:'json',columns:t.columns.map(c=>({name:c.name,data_type:TYPES[c.type][0],nullable:c.nullable,...(c.type==='decimal'?{precision:c.precision,scale:c.scale}:{}),...(c.type==='timestamp'?{timezone:true}:{})})),primaryKey:t.primaryKey,writeDisposition:'replace',schemaContract:{tables:'evolve',columns:'freeze',data_type:'freeze'},maxTableNesting:0,notes:'Complete selected Airtable source; independent SuiteQL comparison retained.'}));
 const acceptance=tables.map(t=>({table:t.name,expectedSourceId:select(t.expectedPath),columns:t.columns.map(c=>({name:c.name,cellType:c.type})),primaryKey:t.primaryKey,ignoredRightColumns:['_dlt_id','_dlt_load_id']}));
 return {schema:'dlthub.pipeline-input.v1',title:options.title??'Airtable / NetSuite source reconciliation',pipelineName:name(options.pipelineName??'airtable_netsuite'),datasetName:name(options.datasetName??'airtable_netsuite'),phase:'baseline',resources,acceptance,limits:{maxRows:Math.max(1,...tables.flatMap(t=>[t.sourceRows,t.expectedRows])),maxBytes:536870912,workers:1},sourceEvidence:prepared.manifest.files.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),sourceBoundary:'Complete retained selected provider pages; independent expected values are from NetSuite. Original dlt writes only its selected local DuckDB receiving destination.',notes:'Review complete relationships and original provider scope in projection.json. Provider lists do not prove deletions. Both provider populations retain their original observed interval.'};
}

/** Disappearance is evidence for review, not a provider deletion/tombstone. */
export function compareCapturePopulations({before,after}){
 const a=inspectCapture(before),b=inspectCapture(after);
 requireValue(Date.parse(after.startedAt)>=Date.parse(before.completedAt),'Following presence comparison must follow the original capture interval.');
 requireValue(canonical({airtable:a.configuration.airtable,netsuite:a.configuration.netsuite})===canonical({airtable:b.configuration.airtable,netsuite:b.configuration.netsuite}),'Compare only identical account, query, parameters and population scope.');
 const rows=[];
 for(const [provider,prior,current]of [['airtable',a.tables,b.tables],['netsuite',a.queries,b.queries]]){
  for(const [id,p]of prior){
   const q=current.get(id),key=provider==='airtable'?r=>r.id:r=>canonical(p.spec.order.aliases.map(k=>r[k.toLowerCase()]));
   const old=new Set((p.records??p.rows).map(key)),next=new Set((q.records??q.rows).map(key));
   rows.push({provider,id,added:[...next].filter(x=>!old.has(x)),notObservedInFollowingScope:[...old].filter(x=>!next.has(x))});
  }
 }
 return {schema:'airtable-netsuite.population-change.v1',previousOperationId:before.operationId,currentOperationId:after.operationId,previous:digest(json(before)),current:digest(json(after)),rows,meaning:'These are selected-population presence changes. No provider deletion is inferred or issued.'};
}
