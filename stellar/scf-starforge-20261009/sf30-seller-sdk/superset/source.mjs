// MIT. Original Superset query results -> explicit typed/value-presence dataset semantics.
import {parseExact,JsonNumber,stringifyExact,canonicalExact,displayExact} from './exact-json.mjs';
import {datasetSemanticIdentity,validateDatasetSemantics} from '../dataset-semantics.mjs';
import {object,identity,digest,fault,bytes,MiB} from './files.mjs';
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const HASH=/^[a-f0-9]{64}$/;
const SCHEMA='stellar-forge.superset-semantics.v1';
const textDecoder=new TextDecoder('utf-8',{fatal:true});
const plain=raw=>JSON.parse(textDecoder.decode(raw));
const csvCell=value=>{const s=String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export function checkedBytes(ref,read) {
  if(!object(ref)||!HASH.test(ref.sha256??'')||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>256*MiB)
    throw fault('SUPERSET_SOURCE_IDENTITY','An original response byte identity is invalid.');
  const raw=read(ref.sha256);
  if(!Buffer.isBuffer(raw)||raw.length!==ref.bytes||digest(raw)!==ref.sha256)
    throw fault('SUPERSET_SOURCE_CHANGED','Retained native response bytes differ from their original identity.',409);
  return raw;
}
export function readCapture(capture,read) {
  const {sha256,...unsigned}=capture;
  if(capture.schema!=='stellar-forge.superset-capture.v1'||identity(unsigned)!==sha256||
      !object(capture.source)||!Array.isArray(capture.entries)||!capture.entries.length)
    throw fault('SUPERSET_CAPTURE_IDENTITY','Choose a complete retained native Superset capture.',409);
  for(let index=0;index<capture.entries.length;index++){
    const entry=capture.entries[index];
    if(entry.sequence!==index||entry.method!=='GET'||typeof entry.url!=='string')throw fault('SUPERSET_CAPTURE_ENTRY','A native capture entry is invalid.');
    const url=new URL(entry.url),base=new URL(capture.source.baseUrl);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.username||url.password||url.hash)
      throw fault('SUPERSET_CAPTURE_ENTRY','A native capture entry has a different source origin.');
    checkedBytes(entry.body,read);
  }
  for(const [ref,labels]of [[capture.metadataBefore,['chart-before']],[capture.metadataAfter,['chart-after']],[capture.result,['chart-data','async-result']]]){
    if(!capture.entries.some(entry=>entry.status===200&&labels.includes(entry.label)&&
        entry.body.sha256===ref?.sha256&&entry.body.bytes===ref?.bytes))
      throw fault('SUPERSET_CAPTURE_BINDING','A selected source body is absent from its original successful native response.',409);
  }
  const metadata=plain(checkedBytes(capture.metadataBefore,read)).result;
  const after=plain(checkedBytes(capture.metadataAfter,read)).result;
  const raw=checkedBytes(capture.result,read),ordinary=plain(raw),exact=parseExact(raw);
  if(!object(metadata)||metadata.id!==capture.source.chartId||(metadata.uuid??null)!==capture.source.chartUuid||
      !object(after)||typeof metadata.query_context!=='string'||!Array.isArray(ordinary.result)||
      !Array.isArray(exact.result)||ordinary.result.length!==capture.queryCount)
    throw fault('SUPERSET_CAPTURE_BINDING','The original chart and complete query-result list differ.',409);
  const definition=v=>identity({id:v.id,uuid:v.uuid,datasource_id:v.datasource_id,datasource_uuid:v.datasource_uuid,
    datasource_type:v.datasource_type,query_context:v.query_context,params:v.params});
  if(definition(metadata)!==capture.definitionSha256||definition(after)!==capture.definitionSha256)
    throw fault('SUPERSET_CHART_CHANGED','The retained chart definition changed across this capture.',409);
  const context=JSON.parse(metadata.query_context);
  if(!object(context)||!Array.isArray(context.queries))throw fault('SUPERSET_SAVED_CONTEXT','The original saved context is invalid.');
  const queries=ordinary.result.map((query,ordinal)=>{
    if(!object(query))throw fault('SUPERSET_QUERY_SHAPE','Native query '+ordinal+' is not a query result.',409);
    const hasRows=Array.isArray(query.data),hasColumns=Array.isArray(query.colnames)&&Array.isArray(query.coltypes);
    if(query.status==='success'&&(!hasRows||!hasColumns)||
        hasColumns&&(query.colnames.length!==query.coltypes.length||query.colnames.some(c=>typeof c!=='string'||!c)||query.coltypes.some(t=>!Number.isSafeInteger(t)))||
        hasRows&&query.data.some(row=>!object(row)))
      throw fault('SUPERSET_QUERY_SHAPE','Native query '+ordinal+' has an invalid row or column declaration.',409);
    return{ordinal,status:query.status,error:query.error??null,rows:hasRows?query.data.length:null,nativeRowCount:query.rowcount??null,
      columns:hasColumns?query.colnames.map((name,i)=>({name,nativeType:query.coltypes[i]})):[],
      cached:query.is_cached??null,queriedAt:query.queried_dttm??null,cachedAt:query.cached_dttm??null,
      from:query.from_dttm??null,to:query.to_dttm??null,
      appliedFilters:query.applied_filters??[],rejectedFilters:query.rejected_filters??[],
      rowLimit:context.queries[ordinal]?.row_limit??null,rowOffset:context.queries[ordinal]?.row_offset??0};
  });
  return{metadata,context,queries,ordinary:ordinary.result,exact:exact.result};
}
function sourceValue(row,name) {
  return !own(row,name)?{state:'missing',value:null}:row[name]===null?{state:'null',value:null}:{state:'value',value:row[name]};
}
function inferred(values,nativeType) {
  const present=values.filter(x=>x.state==='value').map(x=>x.value);
  if(present.length&&present.every(v=>typeof v==='boolean'))return{type:'boolean',encoding:'native',nullable:true};
  if(present.length&&present.every(v=>v instanceof JsonNumber)){
    if(present.every(v=>/^-?(0|[1-9]\d*)$/.test(v.source)&&v.source!=='-0'&&Number.isSafeInteger(Number(v.source))))
      return{type:'integer',encoding:'native',nullable:true};
    if(present.every(v=>Number.isFinite(Number(v.source))&&JSON.stringify(Number(v.source))===v.source))
      return{type:'number',encoding:'native',nullable:true};
    return{type:'string',encoding:'text',nullable:false};
  }
  if(!present.length||present.every(v=>typeof v==='string'))return{type:'string',encoding:'native',nullable:false};
  return{type:'string',encoding:'json',nullable:false};
}
function encoded(cell,plan){
  if(cell.state!=='value')return'';
  if(plan.encoding==='json')return stringifyExact(cell.value);
  return cell.value instanceof JsonNumber?cell.value.source:String(cell.value);
}
export function buildEdition(capture,read,selection) {
  const native=readCapture(capture,read);
  if(!object(selection)||!Number.isSafeInteger(selection.queryOrdinal)||selection.queryOrdinal<0||
      selection.queryOrdinal>=native.queries.length)throw fault('SUPERSET_QUERY_SELECTION','Select one native query ordinal.');
  const ordinal=selection.queryOrdinal,query=native.ordinary[ordinal],exact=native.exact[ordinal],overview=native.queries[ordinal];
  if(query.status!=='success'||query.error)throw fault('SUPERSET_QUERY_NOT_SUCCESSFUL','The selected native query did not complete successfully.',409);
  if(new Set(query.colnames).size!==query.colnames.length)
    throw fault('SUPERSET_DUPLICATE_NATIVE_COLUMNS','The original row dictionaries cannot disambiguate duplicate native column names; update the source chart aliases.');
  if(!Array.isArray(selection.columns)||!selection.columns.length||selection.columns.length>32||
      new Set(selection.columns).size!==selection.columns.length||selection.columns.some(n=>!query.colnames.includes(n)))
    throw fault('SUPERSET_COLUMN_SELECTION','Select 1–32 distinct native columns; every selected value retains a presence column.');
  const name=String(selection.name??'').trim();
  if(!name||name.length>128||/[\x00-\x1f\x7f]/.test(name))throw fault('SUPERSET_EDITION_NAME','Use a printable dataset name of at most 128 characters.');
  const key=selection.key??[];
  if(!Array.isArray(key)||new Set(key).size!==key.length||key.some(n=>!selection.columns.includes(n)))
    throw fault('SUPERSET_ROW_KEY','The row key must use distinct selected native columns.');
  const used=new Set(),plans=selection.columns.map(sourceField=>{
    const sourceOrdinal=query.colnames.indexOf(sourceField);
    let alias=/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(sourceField)&&!['constructor','prototype','__proto__'].includes(sourceField)?sourceField:'column_'+(sourceOrdinal+1);
    if(used.has(alias)||used.has(alias+'_state'))alias='column_'+(sourceOrdinal+1);
    while(used.has(alias)||used.has(alias+'_state'))alias+='x';
    used.add(alias);used.add(alias+'_state');
    const values=exact.data.map(row=>sourceValue(row,sourceField));
    return{name:alias,stateColumn:alias+'_state',sourceField,sourceOrdinal,nativeType:query.coltypes[sourceOrdinal],
      ...inferred(values,query.coltypes[sourceOrdinal])};
  });
  const keys=new Set();
  for(const row of exact.data)if(key.length){
    const cells=key.map(n=>sourceValue(row,n));
    if(cells.some(c=>c.state!=='value'))throw fault('SUPERSET_ROW_KEY_NULL','Every reviewed row key must be present and non-null.');
    const k=stringifyExact(canonicalExact(cells.map(c=>c.value)));
    if(keys.has(k))throw fault('SUPERSET_ROW_KEY_DUPLICATE','The selected native row key is not unique.');
    keys.add(k);
  }
  const columns={},meanings=[];
  for(const plan of plans){
    columns[plan.name]={type:plan.type,nullable:plan.nullable};
    columns[plan.stateColumn]={type:'string',nullable:false};
    const definition={sourceName:plan.sourceField,sourceOrdinal:plan.sourceOrdinal,nativeType:plan.nativeType};
    const projectedDefinition={name:plan.name,datatype:plan.type==='number'?'double':plan.type,required:!plan.nullable};
    meanings.push({name:plan.name,type:plan.type,nullable:plan.nullable,sourceField:plan.sourceField,
      role:'value',stateColumn:plan.stateColumn,encoding:plan.encoding,sourceDefinition:definition,projectedDefinition,
      issues:plan.encoding==='native'?[]:[{code:plan.encoding==='text'?'EXACT_NUMERIC_TEXT':'EXACT_JSON_VALUE',
        message:plan.encoding==='text'?'The original numeric JSON token is retained as text.':'The original JSON value is retained as exact JSON text.'}]});
    meanings.push({name:plan.stateColumn,type:'string',nullable:false,sourceField:plan.sourceField,
      role:'state',valueColumn:plan.name,encoding:'native',
      sourceDefinition:{...definition,role:'source-presence',values:['value','null','missing']},
      projectedDefinition:{name:plan.stateColumn,datatype:'string',required:true},issues:[]});
  }
  const schemaSha256=identity({colnames:query.colnames,coltypes:query.coltypes});
  const semantics={schema:SCHEMA,
    source:{provider:'apache-superset',protocolVersion:'6.1',baseUrl:capture.source.baseUrl,
      chartId:capture.source.chartId,chartUuid:capture.source.chartUuid,datasourceUuid:native.metadata.datasource_uuid??null,
      queryOrdinal:ordinal,queryContextSha256:digest(Buffer.from(native.metadata.query_context)),
      principalSha256:identity(capture.source.principal),captureManifestSha256:capture.sha256,schemaSha256},
    columns:meanings,primaryKey:{source:key,projected:key.map(n=>plans.find(p=>p.sourceField===n).name),complete:key.length>0},
    aboutUrl:{value:new URL('explore/?slice_id='+capture.source.chartId,capture.source.baseUrl).href},
    virtualColumns:[],issues:[{code:'NATIVE_QUERY_SCOPE',message:'Rows are the selected native query result, with its saved filters, offset, row limit and resolved time range.'}],
    query:{savedContextSha256:digest(Buffer.from(native.metadata.query_context)),rowLimit:overview.rowLimit,rowOffset:overview.rowOffset},
    csvw:{tableSchema:{columns:meanings.map(m=>m.projectedDefinition)}}};
  const {captureManifestSha256,schemaSha256:unused,...sourceMeaning}=semantics.source;
  semantics.definitionSha256=datasetSemanticIdentity({...semantics,source:sourceMeaning});
  semantics.sha256=datasetSemanticIdentity(semantics);
  validateDatasetSemantics(semantics,Object.entries(columns).map(([column,spec])=>({name:column,...spec})));
  const physical=plans.flatMap(p=>[p.name,p.stateColumn]);
  const rows=[physical.map(csvCell).join(',')];
  for(const row of exact.data)rows.push(plans.flatMap(plan=>{
    const cell=sourceValue(row,plan.sourceField);return[encoded(cell,plan),cell.state];
  }).map(csvCell).join(','));
  const csv=Buffer.from(rows.join('\n')+'\n');
  const maxLimit=selection.maxLimit??250,defaultLimit=selection.defaultLimit??50;
  if(!Number.isSafeInteger(maxLimit)||maxLimit<1||maxLimit>1000||!Number.isSafeInteger(defaultLimit)||defaultLimit<1||defaultLimit>maxLimit)
    throw fault('SUPERSET_PAGE_LIMIT','Choose native dataset page limits from 1 to 1000.');
  const filterNames=(selection.filters??selection.columns.slice(0,6)).map(n=>{
    const p=plans.find(p=>p.sourceField===n);if(!p)throw fault('SUPERSET_FILTER','Use selected native filter columns.');return p.name;
  });
  if(filterNames.length>8||new Set(filterNames).size!==filterNames.length)throw fault('SUPERSET_FILTER','Choose at most eight distinct filter columns.');
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,columns,filters:filterNames,
    sorts:plans.slice(0,6).map(p=>p.name),ranges:[],defaultLimit,maxLimit,
    maxBytes:256*MiB,maxRows:1000000,maxCellChars:1024*1024,semantics};
  const selectionExact={name,queryOrdinal:ordinal,columns:[...selection.columns],key:[...key],
    filters:filterNames.map(n=>plans.find(p=>p.name===n).sourceField),defaultLimit,maxLimit};
  const lineage={schema:'stellar-forge.superset-edition-lineage.v1',captureSha256:capture.sha256,
    source:capture.source,chart:{id:native.metadata.id,uuid:native.metadata.uuid,title:native.metadata.slice_name,
      datasourceId:native.metadata.datasource_id,datasourceUuid:native.metadata.datasource_uuid??null},
    query:overview,queryCount:native.queries.length,selection:selectionExact,columns:plans,
    rows:exact.data.length,semanticsSha256:semantics.sha256,definitionSha256:semantics.definitionSha256,
    csv:{sha256:digest(csv),bytes:csv.length}};
  return{csv,config,semantics,lineage,selection:selectionExact};
}
export function compareEditions(left,right,read) {
  const a=readCapture(left.capture,read),b=readCapture(right.capture,read);
  const comparable=selection=>({queryOrdinal:selection.queryOrdinal,columns:selection.columns,key:selection.key});
  if(identity(comparable(left.selection))!==identity(comparable(right.selection)))
    throw fault('SUPERSET_COMPARISON_SELECTION','Compare editions with the same reviewed field, key and query selection.');
  const {columns,key,queryOrdinal}=left.selection,rowsA=a.exact[queryOrdinal].data,rowsB=b.exact[queryOrdinal].data;
  const indexed=(rows)=>new Map(rows.map((row,index)=>{
    const rowKey=key.length?stringifyExact(canonicalExact(key.map(n=>sourceValue(row,n)))):String(index);
    return[rowKey,row];
  }));
  const before=indexed(rowsA),after=indexed(rowsB),changes=[];let unchanged=0;
  for(const [rowKey,row] of before){
    if(!after.has(rowKey)){changes.push({key:rowKey,change:'removed',fields:columns,before:columns.map(n=>sourceValue(row,n)),after:null});continue;}
    const next=after.get(rowKey),fields=columns.filter(n=>
      stringifyExact(canonicalExact(sourceValue(row,n)))!==stringifyExact(canonicalExact(sourceValue(next,n))));
    if(fields.length)changes.push({key:rowKey,change:'changed',fields,before:fields.map(n=>sourceValue(row,n)),after:fields.map(n=>sourceValue(next,n))});
    else unchanged++;
  }
  for(const [rowKey,row] of after)if(!before.has(rowKey))changes.push({key:rowKey,change:'added',fields:columns,before:null,after:columns.map(n=>sourceValue(row,n))});
  return{schema:'stellar-forge.superset-comparison.v1',beforeRows:rowsA.length,afterRows:rowsB.length,
    keyMode:key.length?'selected-native-key':'native-result-order',key,unchanged,
    added:changes.filter(c=>c.change==='added').length,removed:changes.filter(c=>c.change==='removed').length,
    changed:changes.filter(c=>c.change==='changed').length,
    changes:changes.map(change=>({...change,before:change.before?.map(c=>({state:c.state,text:c.state==='value'?displayExact(c.value):null}))??null,
      after:change.after?.map(c=>({state:c.state,text:c.state==='value'?displayExact(c.value):null}))??null}))};
}
