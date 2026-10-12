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
 return{table,beginDate:begin,endDate:end,products:[...included]};
}
export async function* iterateEditionRows(store,edition,options={}){
 const selected=rowSelection(edition,options),table=selected.table;
 if(table==='coverage'){for(const row of coverageRows(edition))yield row;return;}
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
export async function compareEditions(store,left,right,table='observations'){
 const mismatches=compatibility(left,right,table),context={
  left:{id:left.id,query:left.query,sourceSha256:left.sourceSha256},right:{id:right.id,query:right.query,sourceSha256:right.sourceSha256},
  metadataChanged:stable(left.pages.filter(p=>p.kind==='metadata').map(p=>({resource:p.resource,sha256:p.sha256})))!==stable(right.pages.filter(p=>p.kind==='metadata').map(p=>({resource:p.resource,sha256:p.sha256})))};
 if(mismatches.length)return{schema:'stellar-forge.coops-comparison.v1',compatible:false,mismatches,context,added:[],removed:[],changed:[],ambiguous:[],scopeAdded:[],scopeRemoved:[],note:'Different station, datum, units or time basis requires explicit engineering reconciliation; no automatic numerical comparison.'};
 const [a,b]=await Promise.all([editionRows(store,left,{table,limit:250000}),editionRows(store,right,{table,limit:250000})]);
 const map=rows=>{const m=new Map();for(const r of rows){const v=m.get(r.recordId)||[];v.push(r);m.set(r.recordId,v);}return m;},am=map(a.rows),bm=map(b.rows);
 const out={schema:'stellar-forge.coops-comparison.v1',compatible:true,mismatches,context,added:[],removed:[],changed:[],ambiguous:[],scopeAdded:[],scopeRemoved:[]};
 const overlapStart=left.query.beginDate>right.query.beginDate?left.query.beginDate:right.query.beginDate,overlapEnd=left.query.endDate<right.query.endDate?left.query.endDate:right.query.endDate;
 const sharedProducts=left.query.products.filter(p=>right.query.products.includes(p));
 const within=r=>!r.timestamp||(r.timestamp>=overlapStart+' 00:00'&&r.timestamp<=overlapEnd+' 23:59:59'&&sharedProducts.includes(r.product));
 for(const id of new Set([...am.keys(),...bm.keys()])){
  const x=am.get(id)||[],y=bm.get(id)||[];
  if(x.length>1||y.length>1){out.ambiguous.push({recordId:id,left:x,right:y,reason:'Duplicate source timestamps/keys remain explicit; occurrence order is not an identity.'});continue;}
  if(!x.length){(within(y[0])?out.added:out.scopeAdded).push(y[0]);continue;}
  if(!y.length){(within(x[0])?out.removed:out.scopeRemoved).push(x[0]);continue;}
  if(stable(comparable(x[0]))!==stable(comparable(y[0])))out.changed.push({recordId:id,before:x[0],after:y[0]});
 }
 out.counts=Object.fromEntries(['added','removed','changed','ambiguous','scopeAdded','scopeRemoved'].map(k=>[k,out[k].length]));
 out.note='Compare original fields only; changed window/products, metadata, duplicate keys and observation edits remain separate. No value is automatically adopted.';return out;
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
