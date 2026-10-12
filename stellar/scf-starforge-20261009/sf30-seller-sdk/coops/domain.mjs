// MIT. Source-grounded coastal tables, coverage, edition comparisons and handoff.
import {COLUMNS,TABLES,SOURCE_CONTRACT,PRODUCTS} from './schema.mjs';
import {decodeSource,fault,hashBytes} from './provider.mjs';
import {stable,jsonBytes} from '../stellar-expert/store.mjs';
import {csvBytes} from '../stellar-expert/domain.mjs';
const str=v=>v===undefined?'':v===null?'null':typeof v==='object'?JSON.stringify(v):String(v);
const kind=v=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':typeof v;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const escape=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=v=>v!==null&&v!==undefined&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(String(v));
function sourceRow(edition,page,table,recordId,sourceRecord){
 const m=edition.stationMetadata??{};
 return{...Object.fromEntries(COLUMNS.map(k=>[k,''])),editionId:edition.id,profileId:edition.profile.id,profileName:edition.profile.label,
 stationId:edition.query.stationId,stationName:str(m.name),latitude:str(m.lat),longitude:str(m.lng),table,recordId,
 timeZone:edition.query.timeZone,datum:edition.query.datum,units:edition.query.units,
 sourcePageSha256:page.sha256,sourceRecord,sourceObservedAt:page.sourceObservedAt??page.finishedAt??'',sourceUrl:page.url};
}
export function flagsFor(product,row){
 const values=typeof row.f==='string'?row.f.split(','):Array.isArray(row.f)?row.f.map(str):[];
 let meanings=[],inferred='',excludedSamples='';
 if(product==='water_level'&&row.q==='p'){meanings=['excluded_one_second_sample_count','flat_limit_exceeded','rate_limit_exceeded','expected_level_limit_exceeded'];excludedSamples=values[0]??'';}
 else if(product==='water_level'&&row.q==='v'){meanings=['inferred_value','flat_limit_exceeded','rate_limit_exceeded','expected_level_limit_exceeded'];inferred=values[0]??'';}
 else if(product==='hourly_height'){meanings=['inferred_value','expected_level_limit_exceeded'];inferred=values[0]??'';}
 return{flags:str(row.f),quality:str(row.q),inferred,excludedSamples,
 flagMeaning:JSON.stringify({basis:meanings.length?'NOAA response field contract':'Unrecognized or absent source quality/product; flags remain uninterpreted',positions:values.map((value,index)=>({index,value,meaning:meanings[index]??'unmapped_original_flag'}))})};
}
function utc(value,timeZone){
 if(timeZone!=='gmt')return'';
 const text=value.replace(' ','T')+(value.length===16?':00':'')+'Z',t=Date.parse(text);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===text.slice(0,19)?new Date(t).toISOString():'';
}
function inWindow(timestamp,query){return timestamp>=query.beginDate+' 00:00'&&timestamp<query.endExclusiveDate+' 00:00';}
function dataRows(edition,page,body){
 const source=page.product==='predictions'?body.predictions:body.data,table=page.product==='predictions'?'predictions':'observations';
 if(!Array.isArray(source))return[];
 const rows=[];
 for(let i=0;i<source.length;i++){
  const value=source[i];if(!inWindow(value.t,edition.query))continue;
  const event=str(value.type??value.ty),id=page.product+'@'+value.t+(event?'#'+event:'');
  const row=sourceRow(edition,page,table,id,(page.product==='predictions'?'predictions':'data')+'['+i+']');
  Object.assign(row,{product:page.product,productKind:PRODUCTS[page.product].kind,timestamp:value.t,timestampUtc:utc(value.t,edition.query.timeZone),
   field:'water_level_height',value:str(value.v),valueType:kind(value.v),unit:edition.query.units==='metric'?'m':'ft',
   sigma:str(value.s),eventType:event,detailsJson:JSON.stringify(value),...flagsFor(page.product,value)});
  rows.push(row);
 }
 return rows;
}
function metadataRows(edition,page,body){
 const rows=[];let visited=0;
 function walk(value,path=''){
  if(++visited>50000)throw fault('COOPS_METADATA_CAPACITY','This complete metadata resource exceeds 50000 entries; retain its original and choose a narrower projection.',413);
  if(value!==null&&typeof value==='object'&&Object.keys(value).length){
   for(const [key,item]of Object.entries(value))walk(item,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'));return;
  }
  const r=sourceRow(edition,page,'metadata',page.resource+':'+path,path);
  Object.assign(r,{metadataKind:page.resource,metadataPath:path,field:path.split('/').at(-1)??'',value:str(value),valueType:kind(value),unit:'',detailsJson:JSON.stringify({resourceUnits:body.units??null,datum:body.datum??null,epoch:body.epoch??null,sourcePath:path})});rows.push(r);
 }
 walk(body);return rows;
}
export function rowSelection(edition,{table='observations',beginDate,endDate,products}={}){
 if(!TABLES.some(t=>t.id===table))throw fault('COOPS_TABLE','Choose an advertised coastal source table.');
 const begin=beginDate??edition.query.beginDate,end=endDate??edition.query.endDate;
 for(const value of [begin,end])if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fault('COOPS_DATE','Use a real selected calendar date.');
 if(begin<edition.query.beginDate||end>edition.query.endDate||end<begin)throw fault('COOPS_SELECTED_WINDOW','The selected projection must lie inside its retained source edition.');
 const included=products??edition.query.products;
 if(!Array.isArray(included)||!included.length||new Set(included).size!==included.length||included.some(p=>!edition.query.products.includes(p)))throw fault('COOPS_SELECTED_PRODUCTS','Select original products from this edition.');
 if(['coverage','metadata'].includes(table)&&(begin!==edition.query.beginDate||end!==edition.query.endDate))throw fault('COOPS_CONTEXT_WINDOW','Coverage and station metadata describe the complete original edition. Select its full dates or inspect a data table for a narrower period.');
 if(table==='metadata'&&(included.length!==edition.query.products.length||edition.query.products.some(p=>!included.includes(p))))throw fault('COOPS_METADATA_SCOPE','Station metadata is shared edition context; retain the full original product selection.');
 return{table,beginDate:begin,endDate:end,products:[...included]};
}
export async function* iterateEditionRows(store,edition,options={}){
 const selected=rowSelection(edition,options),table=selected.table;
 if(table==='coverage'){for(const row of coverageRows(edition))if(selected.products.includes(row.product))yield row;return;}
 for(const page of edition.pages){
  if(page.unavailable)continue;
  if(table==='metadata'&&page.kind!=='metadata'||table==='observations'&&(page.kind!=='data'||page.product==='predictions')||table==='predictions'&&page.product!=='predictions')continue;
  if(page.kind==='data'&&(!selected.products.includes(page.product)||page.endDate<selected.beginDate||page.beginDate>selected.endDate))continue;
  const bytes=await store.object(page.sha256),decoded=decodeSource(bytes,page,edition.query);
  if(decoded.unavailable)continue;
  for(const row of (page.kind==='metadata'?metadataRows(edition,page,decoded.body):dataRows(edition,page,decoded.body))){
   if(row.timestamp&&(row.timestamp<selected.beginDate+' 00:00'||row.timestamp>selected.endDate+' 23:59:59'))continue;
   yield row;
  }
 }
}
export async function coverageSummary(store,edition){
 const byProduct={};
 for(const product of edition.query.products){
  const pages=edition.pages.filter(p=>p.product===product),timestamps=new Map(),quality={};
  const step=product==='predictions'?(edition.query.predictionInterval==='h'?60:edition.query.predictionInterval==='6'?6:null):PRODUCTS[product].stepMinutes;
  const expected=step&&edition.query.timeZone!=='lst_ldt'?edition.query.days*1440/step:null,grid=expected===null?null:new Uint8Array(expected);
  let returnedRecords=0,outsideWindowRecords=0,rowsInsideWindow=0,populatedNumericValues=0,offGridRecords=0,gridCount=0;
  const begin=Date.parse(edition.query.beginDate+'T00:00:00Z');
  for(const page of pages){
   if(page.unavailable)continue;const decoded=decodeSource(await store.object(page.sha256),page,edition.query);returnedRecords+=decoded.records;
   if(decoded.rows)for(const r of decoded.rows)if(!inWindow(r.t,edition.query))outsideWindowRecords++;
   for(const r of dataRows(edition,page,decoded.body)){
    rowsInsideWindow++;if(numeric(r.value)&&!['null','missing'].includes(r.valueType))populatedNumericValues++;
    const q=r.quality||'not_reported';quality[q]=(quality[q]??0)+1;
    const signature=hashBytes(Buffer.from(stable({value:r.value,valueType:r.valueType,quality:r.quality,flags:r.flags}))),prior=timestamps.get(r.recordId);
    if(prior){prior.count++;if(prior.signature!==signature)prior.conflict=true;}else timestamps.set(r.recordId,{count:1,signature,conflict:false});
    const instant=utc(r.timestamp,'gmt'),t=instant?Date.parse(instant):NaN,index=(t-begin)/(step*60000);
    if(step&&Number.isSafeInteger(index)&&index>=0&&index<(expected??Infinity)){if(grid&&!grid[index]){grid[index]=1;gridCount++;}}else if(step)offGridRecords++;
   }
  }
  let duplicateTimestampKeys=0,conflictingDuplicates=0;for(const item of timestamps.values()){if(item.count>1)duplicateTimestampKeys++;if(item.conflict)conflictingDuplicates++;}
  const tasks=edition.coverage.filter(t=>t.product===product);
  byProduct[product]={kind:PRODUCTS[product].kind,returnedRecords,rowsInsideWindow,outsideWindowRecords,populatedNumericValues,unavailableValues:rowsInsideWindow-populatedNumericValues,
   uniqueTimestampKeys:timestamps.size,duplicateTimestampKeys,conflictingDuplicates,offGridRecords,quality,expectedTimestamps:expected,missingTimestamps:expected===null?null:Math.max(0,expected-gridCount),
   expectedBasis:expected===null?'No fixed slot count for high/low events or local daylight/standard time.':String(step)+'-minute grid over inclusive dates in the declared fixed time basis.',
   sourceTasks:tasks.length,completeTasks:tasks.filter(t=>t.state==='COMPLETE').length,unavailableTasks:tasks.filter(t=>t.state==='UNAVAILABLE').length,
   sourceComplete:tasks.length>0&&tasks.every(t=>['COMPLETE','UNAVAILABLE'].includes(t.state)),
   completeObservations:PRODUCTS[product].kind==='observation'&&expected!==null&&gridCount===expected&&conflictingDuplicates===0&&populatedNumericValues===rowsInsideWindow&&tasks.every(t=>t.state==='COMPLETE')};
 }
 return byProduct;
}
function coverageRows(edition){
 const rows=[];
 for(const [product,summary]of Object.entries(edition.summary?.products??{}))for(const [field,value]of Object.entries(summary)){
  const row=sourceRow(edition,{sha256:edition.sourceSha256,url:SOURCE_CONTRACT.documentation,sourceObservedAt:edition.createdAt},'coverage',product+'#'+field,'Derived from every retained product response and requested grid');
  Object.assign(row,{product,productKind:PRODUCTS[product].kind,field,value:str(value),valueType:kind(value),unit:field.includes('Records')||field.includes('Values')||field.includes('Timestamps')?'count':'',detailsJson:JSON.stringify({calculation:'Source coverage only; no data value imputation.',query:edition.query})});rows.push(row);
 }
 return rows;
}
export async function editionRows(store,edition,{table='observations',offset=0,limit=100,beginDate,endDate,products}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>250000)throw fault('COOPS_ROW_RANGE','Choose a nonnegative offset and one to 250000 records.');
 const selection=rowSelection(edition,{table,beginDate,endDate,products}),rows=[];let total=0;
 for await(const row of iterateEditionRows(store,edition,selection)){if(total>=offset&&rows.length<limit)rows.push(row);total++;}
 return{table,columns:COLUMNS,total,offset,limit,selection,rows};
}
export async function summarizeEdition(store,edition){
 const products=await coverageSummary(store,edition),metadata=edition.pages.filter(p=>p.kind==='metadata');
 return{stationId:edition.query.stationId,stationName:edition.stationMetadata?.name??null,units:edition.query.units,datum:edition.query.datum,timeZone:edition.query.timeZone,
  products,metadataResources:metadata.map(p=>({resource:p.resource,sha256:p.sha256,url:p.url})),metadataUnavailable:edition.metadataUnavailable??[],
  sourceComplete:edition.complete,sourceFailures:edition.failedResponses?.length??0,
  notes:['Station datums/epochs remain separate original evidence. The entered datum is not converted.','Source-complete means all declared requests reached a recorded outcome; it does not fill missing measurements.','Preliminary and verified f[0] have different meanings.','Tide predictions are retained separately from measurements.']};
}
function compatibility(left,right,table){
 const fields=['stationId','units','datum','timeZone'];if(table==='predictions')fields.push('predictionInterval');
 return fields.filter(k=>left.query[k]!==right.query[k]).map(field=>({field,left:left.query[field],right:right.query[field]}));
}
function comparable(row){return Object.fromEntries(['product','timestamp','field','value','valueType','unit','sigma','quality','flags','eventType','metadataKind','metadataPath','detailsJson'].map(k=>[k,row[k]]));}
const CHANGE_KINDS=['added','removed','changed','ambiguous','scopeAdded','scopeRemoved'];
export function comparisonSummary(left,right,table='observations'){
 if(!TABLES.some(t=>t.id===table))throw fault('COOPS_TABLE','Choose an advertised coastal source table.');
 const mismatches=compatibility(left,right,table);
 return{schema:'stellar-forge.coops-comparison.v1',table,compatible:mismatches.length===0,mismatches,
  context:{left:{id:left.id,query:left.query,sourceSha256:left.sourceSha256},right:{id:right.id,query:right.query,sourceSha256:right.sourceSha256},
   metadataChanged:stable(left.pages.filter(p=>p.kind==='metadata').map(p=>({resource:p.resource,sha256:p.sha256})))!==stable(right.pages.filter(p=>p.kind==='metadata').map(p=>({resource:p.resource,sha256:p.sha256})))},
  counts:Object.fromEntries(CHANGE_KINDS.map(k=>[k,0])),...Object.fromEntries(CHANGE_KINDS.map(k=>[k,[]])),previewLimit:200,
  note:mismatches.length?'Different station, datum, units or time basis requires explicit engineering reconciliation; no automatic numerical comparison.':
   'Counts cover every original selected record. The console retains at most 200 examples per change kind; the complete JSON export streams all changes. Changed window/products, metadata and duplicate keys remain separate. No value is automatically adopted.'};
}
function comparisonPartitions(left,right,table){
 if(table==='metadata')return [...new Set([...left.pages,...right.pages].filter(p=>p.kind==='metadata').map(p=>p.resource))].sort().map(resource=>({table,resource}));
 if(table==='coverage')return[{table}];
 const products=[...new Set([...left.query.products,...right.query.products])].filter(p=>table==='predictions'?p==='predictions':p!=='predictions').sort();
 const intervals=[left,right].map(e=>({begin:e.query.beginDate,end:e.query.endDate})).sort((a,b)=>a.begin.localeCompare(b.begin)),merged=[];
 for(const item of intervals){const prior=merged.at(-1);if(prior&&item.begin<=prior.end){if(item.end>prior.end)prior.end=item.end;}else merged.push({...item});}
 const partitions=[];
 for(const product of products)for(const interval of merged){
  const final=Date.parse(interval.end+'T00:00:00Z');
  for(let first=Date.parse(interval.begin+'T00:00:00Z');first<=final;first+=7*86400000)
   partitions.push({table,product,beginDate:new Date(first).toISOString().slice(0,10),endDate:new Date(Math.min(final,first+6*86400000)).toISOString().slice(0,10)});
 }
 return partitions;
}
async function comparisonRows(store,edition,partition){
 const options={table:partition.table};let source=edition;
 if(partition.resource!==undefined)source={...edition,pages:edition.pages.filter(p=>p.kind==='metadata'&&p.resource===partition.resource)};
 if(partition.product){
  if(!edition.query.products.includes(partition.product))return new Map();
  options.beginDate=partition.beginDate>edition.query.beginDate?partition.beginDate:edition.query.beginDate;
  options.endDate=partition.endDate<edition.query.endDate?partition.endDate:edition.query.endDate;
  if(options.beginDate>options.endDate)return new Map();options.products=[partition.product];
 }
 const rows=new Map();
 for await(const row of iterateEditionRows(store,source,options)){const prior=rows.get(row.recordId);if(prior)prior.push(row);else rows.set(row.recordId,[row]);}
 return rows;
}
export async function* iterateComparisonChanges(store,left,right,table='observations'){
 if(!comparisonSummary(left,right,table).compatible)return;
 const overlapStart=left.query.beginDate>right.query.beginDate?left.query.beginDate:right.query.beginDate,
  overlapEnd=left.query.endDate<right.query.endDate?left.query.endDate:right.query.endDate,
  sharedProducts=left.query.products.filter(p=>right.query.products.includes(p));
 const within=row=>table==='metadata'||(!row.timestamp?sharedProducts.includes(row.product):
  row.timestamp>=overlapStart+' 00:00'&&row.timestamp<=overlapEnd+' 23:59:59'&&sharedProducts.includes(row.product));
 // At most one source resource or seven-day product partition is held at a time.
 // The original response pages, duplicate rows and source identities are unchanged.
 for(const partition of comparisonPartitions(left,right,table)){
  const am=await comparisonRows(store,left,partition),bm=await comparisonRows(store,right,partition);
  for(const id of new Set([...am.keys(),...bm.keys()])){
   const x=am.get(id)||[],y=bm.get(id)||[];
   if(x.length>1||y.length>1){yield{kind:'ambiguous',record:{recordId:id,left:x,right:y,reason:'Duplicate source timestamps/keys remain explicit; occurrence order is not an identity.'}};continue;}
   if(!x.length){yield{kind:within(y[0])?'added':'scopeAdded',record:y[0]};continue;}
   if(!y.length){yield{kind:within(x[0])?'removed':'scopeRemoved',record:x[0]};continue;}
   if(stable(comparable(x[0]))!==stable(comparable(y[0])))yield{kind:'changed',record:{recordId:id,before:x[0],after:y[0]}};
  }
 }
}
export function recordComparisonChange(summary,change){
 if(!CHANGE_KINDS.includes(change.kind))throw fault('COOPS_COMPARISON','The comparison produced an unknown change kind.');
 summary.counts[change.kind]++;if(summary[change.kind].length<summary.previewLimit)summary[change.kind].push(change.record);
}
export async function compareEditions(store,left,right,table='observations'){
 const summary=comparisonSummary(left,right,table);
 for await(const change of iterateComparisonChanges(store,left,right,table))recordComparisonChange(summary,change);
 return summary;
}
export async function exportEdition(store,edition,annotations,table,format){
 if(format==='source-package'){
  const responses=[];for(const receipt of edition.pages){const body=await store.object(receipt.sha256);responses.push({receipt,base64:body.toString('base64')});}
  const failedResponses=[];for(const receipt of edition.failedResponses??[]){const body=await store.object(receipt.sha256);failedResponses.push({receipt,base64:body.toString('base64')});}
  const bytes=jsonBytes({schema:'stellar-forge.coops-capture-package.v1',edition,annotations,responses,failedResponses,source:SOURCE_CONTRACT});
  return{bytes,extension:'source.json',type:'application/json; charset=utf-8',note:'Every retained original accepted/unavailable response and failed attempt is included. Imported source observed times remain original.'};
 }
 const selected=await editionRows(store,edition,{table,limit:format==='report'?1000:250000});
 if(format==='json')return{bytes:jsonBytes({schema:'stellar-forge.coops-table.v1',edition,annotations,...selected}),extension:table+'.json',type:'application/json; charset=utf-8'};
 if(format==='csv')return{bytes:csvBytes(selected.columns,selected.rows),extension:table+'.csv',type:'text/csv; charset=utf-8'};
 if(format!=='report')throw fault('COOPS_EXPORT','Choose JSON, CSV, report or source-package.');
 const show=selected.rows.slice(0,1000),fields=table==='metadata'?['metadataKind','metadataPath','value','valueType']:['product','timestamp','value','unit','quality','flags','sourcePageSha256'];
 const document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coastal source handoff</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#16303c}table{border-collapse:collapse;width:100%;font-size:.8rem}td,th{border-bottom:1px solid #cad8de;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf4f5;padding:1rem}section{overflow:auto}h1{line-height:1.15}.pin{font:12px monospace;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}thead{display:table-header-group}}</style><h1>Coastal source handoff</h1><p>'+escape(edition.profile.label)+' · NOAA '+escape(edition.query.stationId)+'</p><p class="pin">Edition '+escape(edition.id)+'</p><h2>Selected source basis</h2><pre>'+escape(JSON.stringify(edition.query,null,2))+'</pre><h2>Coverage and datum evidence</h2><pre>'+escape(JSON.stringify(edition.summary,null,2))+'</pre><h2>Recorded review</h2><pre>'+escape(JSON.stringify(annotations,null,2))+'</pre><h2>'+escape(table)+' · '+selected.total+' records</h2><p>This readable view contains the first '+show.length+' records. The complete selected CSV/JSON and source package are separate native exports.</p><section><table><thead><tr>'+fields.map(k=>'<th>'+escape(k)+'</th>').join('')+'</tr></thead><tbody>'+show.map(r=>'<tr>'+fields.map(k=>'<td>'+escape(r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></section><h2>Original source register</h2><ul>'+edition.pages.map(p=>'<li>'+escape(p.kind==='metadata'?p.resource:p.product)+' — <a href="'+escape(p.url)+'">'+escape(p.url)+'</a> <span class="pin">'+escape(p.sha256)+'</span></li>').join('')+'</ul><p>Original values, quality flags and reference datum remain attached. This handoff contains no datum conversion, interpolation, project-specific model or design certification.</p></html>';
 return{bytes:Buffer.from(document),extension:table+'.html',type:'text/html; charset=utf-8'};
}
