// MIT. Original KiWIS QueryServices capture and lossless source projection.
import {createHash} from 'node:crypto';
import {readLabZip} from '../../lab-edd/zip.mjs';
export const SOURCE_SCHEMA='starforge.kiwis-source.v1';
export const RETAINED_SOURCE_SCHEMA='starforge.kiwis-retained-source.v1';
export const canonical=value=>JSON.stringify(order(value));
function order(value){return Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function fail(code,message,details){throw Object.assign(Error(message),{code,status:code==='KIWIS_HTTP'?502:code.includes('CHANGED')?409:400,...(details?{details}:{}),...(details?.retryAfter?{retryAfter:details.retryAfter}:{})});}
export const same=(a,b)=>canonical(a)===canonical(b);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const text=(v,label)=>{if(typeof v!=='string'||!v.trim())fail('KIWIS_SELECTION','Select an explicit '+label+'.');return v;};
export function exactJson(bytes,{types}={}){
  const input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return JSON.parse(input,function(key,value,context){
    if(types){
      let fields=types.get(this);if(!fields){fields=new Map();types.set(this,fields);}
      fields.set(key,value===null?'null':Array.isArray(value)?'array':typeof value);
    }
    if(typeof value!=='number')return value;
    if(!context||typeof context.source!=='string')fail('KIWIS_RUNTIME','Use the installed Node runtime with lossless JSON source support.');
    return context.source;
  });
}
export function endpointSelection(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('KIWIS_SELECTION','Select the original KiWIS endpoint and datasource.');
  const url=new URL(text(input.endpoint,'KiWIS endpoint'));
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.search)fail('KIWIS_ENDPOINT','Use the original HTTP endpoint without embedded credentials, query or fragment.');
  const datasource=input.datasource===null?null:String(input.datasource??'0');
  if(datasource!==null&&!/^[0-9]+$/.test(datasource))fail('KIWIS_DATASOURCE','Select the original numeric datasource or explicit provider-default null.');
  return {endpoint:url.href,datasource};
}
export function explicitInstant(value){
  if(typeof value!=='string')return null;
  const parts=/^(\d{4}-\d\d-\d\d)T([0-2]\d):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if(!parts||Number(parts[2])>23||(parts[5]?.slice(3).replace(/0/g,'')??''))return null;
  const day=Date.parse(parts[1]+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==parts[1])return null;
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;
}
export function captureSelection(input){
  const connection=endpointSelection(input);
  if(!Array.isArray(input.series)||!input.series.length)fail('KIWIS_SERIES','Select the complete series programme by original ts_id.');
  const ids=new Set();
  const series=input.series.map(value=>{
    if(!value||typeof value!=='object')fail('KIWIS_SERIES','Select each original time series and its full requested window.');
    const tsId=String(value.tsId??'');if(!/^[0-9]+$/.test(tsId)||ids.has(tsId))fail('KIWIS_SERIES','Each original ts_id must occur once in the selected programme.');ids.add(tsId);
    if(value.period==='complete'){
      if(value.from!==undefined||value.to!==undefined||value.chunkSeconds!==undefined)fail('KIWIS_WINDOW','A complete-period selection must not include dated windows or query partitions.');
      return {tsId,period:'complete'};
    }
    if(value.period!==undefined)fail('KIWIS_WINDOW','Select period complete or explicit original from/to timestamps.');
    const from=text(value.from,'inclusive source start'),to=text(value.to,'inclusive source end');
    if(explicitInstant(from)===null||explicitInstant(to)===null||explicitInstant(from)>explicitInstant(to))
      fail('KIWIS_WINDOW','Select an ordered, explicit source window with original timezone offsets.');
    if(value.chunkSeconds!==undefined&&(!Number.isSafeInteger(value.chunkSeconds)||value.chunkSeconds<=0||
      !Number.isSafeInteger(value.chunkSeconds*1000)))fail('KIWIS_WINDOW','Select a positive exact query partition length in seconds.');
    return {tsId,from,to,...(value.chunkSeconds!==undefined?{chunkSeconds:value.chunkSeconds}:{})};
  });
  return {...connection,series,timezone:text(input.timezone??'UTC','response timezone')};
}
export function requestURL(connection,request,parameters={}){
  const url=new URL(connection.endpoint);
  for(const [key,value]of Object.entries({service:'kisters',type:'queryServices',datasource:connection.datasource,request,format:'json',...parameters}))
    if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  return url.href;
}
export function captureRequests(selection){
  const requests=[{key:'quality',request:'getQualityCodes',parameters:{}},
    {key:'release-classes',request:'getReleaseStateClasses',parameters:{}}];
  for(const selected of selection.series){
    requests.push({key:'metadata:'+selected.tsId,request:'getTimeseriesList',parameters:{ts_id:selected.tsId,returnfields:'all'},tsId:selected.tsId});
    const windows=[],start=explicitInstant(selected.from),end=explicitInstant(selected.to);
    if(selected.period==='complete')windows.push({period:'complete'});
    else if(selected.chunkSeconds===undefined||start===end)windows.push({from:selected.from,to:selected.to});
    else for(let from=start;from<end;){
      const to=Math.min(end,from+selected.chunkSeconds*1000);
      windows.push({from:from===start?selected.from:new Date(from).toISOString(),to:to===end?selected.to:new Date(to).toISOString()});
      from=to;
    }
    for(let index=0;index<windows.length;index++){
      const window=windows[index];
      requests.push({key:'values:'+selected.tsId+(windows.length>1?':'+index:''),request:'getTimeseriesValues',
        tsId:selected.tsId,windowIndex:index,window,parameters:{ts_id:selected.tsId,...window,timezone:selection.timezone,
          returnfields:'Timestamp,Value,Interpolation Type,Quality Code,Quality Code Name,Quality Code Description,Data Comment,Release State',metadata:'true',md_returnfields:'all',valuesasstring:'true',useprecision:'false'}});
    }
  }
  return requests;
}
function retainedPlannedRequests(selection,responses=[]){
  const current=captureRequests(selection),values=responses.filter(response=>response?.request==='getTimeseriesValues');
  if(!values.length)return current;
  // Reopen an older complete edition or its exact partial capture without changing an already-returned request.
  const legacy=current.map(spec=>spec.request==='getTimeseriesValues'?{...spec,parameters:{...spec.parameters,returnfields:'Timestamp,Value,Quality Code'}}:spec);
  const legacyByKey=new Map(legacy.map(spec=>[spec.key,spec]));
  return values.every(response=>{
    const spec=legacyByKey.get(response.key);
    return spec?.request==='getTimeseriesValues'&&response.url===requestURL(selection,spec.request,spec.parameters);
  })?legacy:current;
}
export function decodeResponse(source,{types,signal}={}){
  if(!source||typeof source.base64!=='string'||!/^[0-9a-f]{64}$/.test(source.sha256??'')||
    !Number.isSafeInteger(source.bytes)||source.bytes<0)fail('KIWIS_SOURCE','Retain the complete original response.');
  let bytes=Buffer.from(source.base64,'base64');
  if(bytes.toString('base64')!==source.base64||bytes.length!==source.bytes||digest(bytes)!==source.sha256)fail('KIWIS_SOURCE_CHANGED','The original KiWIS response bytes changed.');
  if(source.archiveMember!==undefined){
    if(typeof source.archiveMember!=='string'||!source.archiveMember)fail('KIWIS_ARCHIVE_MEMBER','Select the exact original JSON member.');
    const files=readLabZip(bytes,{maxBytes:268435456,maxMembers:128,signal});
    const member=files.find(file=>file.filename===source.archiveMember);
    if(!member)fail('KIWIS_ARCHIVE_MEMBER','The selected original JSON member is absent.',{archiveMember:source.archiveMember});
    if(source.archiveMemberSha256!==undefined&&source.archiveMemberSha256!==member.sha256||
      source.archiveMemberBytes!==undefined&&source.archiveMemberBytes!==member.bytes.length)
      fail('KIWIS_SOURCE_CHANGED','The selected original ZIP member changed.');
    bytes=member.bytes;
  }
  let json;
  try{json=exactJson(bytes,{types});}catch(error){if(error.code)throw error;fail('KIWIS_FORMAT','The original response is not complete UTF-8 JSON.',{request:source.url,sha256:source.sha256,archiveMember:source.archiveMember});}
  if(json&&typeof json==='object'&&!Array.isArray(json)&&(own(json,'error')||own(json,'errors')))
    fail('KIWIS_PROVIDER','The selected response is a provider error.',{response:json,request:source.url});
  return json;
}
function dataTables(json,label){
  const tables=Array.isArray(json)?json:[json];
  if(tables.some(table=>!table||typeof table!=='object'||Array.isArray(table)))fail('KIWIS_FORMAT','The '+label+' response requires original object records.');
  return tables;
}
function declaredColumns(value,types,originalType=Array.isArray(value)?'array':typeof value){
  const columns=Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
  if(!['string','array'].includes(originalType)||!columns.length||
    columns.some((name,index)=>typeof name!=='string'||!name.trim()||
      Array.isArray(value)&&types?.get(value)?.get(String(index))!==undefined&&types.get(value).get(String(index))!=='string')||
    new Set(columns).size!==columns.length)
    fail('KIWIS_COLUMNS','Retain complete distinct nonempty original string column names.');
  return columns;
}
function scalarTypes(value,types){
  return Array.isArray(value)?value.map((item,index)=>types?.get(value)?.get(String(index))??
    (item===null?'null':Array.isArray(item)?'array':typeof item)):
    Object.fromEntries(Object.entries(value).map(([key,item])=>[key,types?.get(value)?.get(key)??
      (item===null?'null':Array.isArray(item)?'array':typeof item)]));
}
function catalogueRows(json,types){
  const rows=[];
  const add=(columns,data,tableIndex,firstRow,headerRowIndex)=>{
    for(let offset=0;offset<data.length;offset++){
      const row=data[offset],rowIndex=firstRow+offset;
      if(!Array.isArray(row)||row.length!==columns.length)fail('KIWIS_ROW','A catalogue row differs from its original column declaration.');
      const originalTypes=scalarTypes(row,types);
      rows.push({tableIndex,rowIndex,...(headerRowIndex!==undefined?{headerRowIndex}:{}),columns,
        fields:Object.fromEntries(columns.map((name,index)=>[name,row[index]])),original:row,originalTypes,
        fieldTypes:Object.fromEntries(columns.map((name,index)=>[name,originalTypes[index]]))});
    }
  };
  if(Array.isArray(json)&&json.length&&Array.isArray(json[0])){
    add(declaredColumns(json[0],types),json.slice(1),0,1,0);return rows;
  }
  const tables=dataTables(json,'catalogue');
  for(let tableIndex=0;tableIndex<tables.length;tableIndex++){
    const table=tables[tableIndex];
    if(own(table,'data')){
      if(!Array.isArray(table.data))fail('KIWIS_COLUMNS','The original catalogue table needs its complete row array.');
      add(declaredColumns(table.columns,types,types?.get(table)?.get('columns')),table.data,tableIndex,0);
    }else rows.push({tableIndex,rowIndex:null,fields:table,original:table,fieldTypes:scalarTypes(table,types)});
  }
  return rows;
}
export function catalogueRecords(source){
  const types=new WeakMap(),json=decodeResponse(source,{types});
  return catalogueRows(json,types);
}
function projectValues(selection,specifications,byKey,editionSha256,metadataFor,decodeFor){
  const series=[],observations=[];
  for(const selected of selection.series){
    const metadata=metadataFor(selected),seriesTables=new Map();
    const valueSpecifications=specifications.filter(spec=>spec.request==='getTimeseriesValues'&&spec.tsId===selected.tsId);
    for(const specification of valueSpecifications){
      const valuesResponse=byKey.get(specification.key),decoded=decodeFor(valuesResponse),types=decoded.types,
        original=dataTables(decoded.json,'time-series values');
      for(let tableIndex=0;tableIndex<original.length;tableIndex++){
        const table=original[tableIndex];
        if(String(table.ts_id??'')!==selected.tsId)fail('KIWIS_IDENTITY','A returned values table differs from the selected original ts_id.',{selected:selected.tsId,returned:table.ts_id});
        const columns=declaredColumns(table.columns,types,types?.get(table)?.get('columns'));
        if(!Array.isArray(table.data))fail('KIWIS_COLUMNS','Retain the original time-series column declaration and complete row array.');
        const timestampIndex=columns.indexOf('Timestamp'),valueIndex=columns.indexOf('Value'),qualityIndex=columns.indexOf('Quality Code');
        if(timestampIndex<0||valueIndex<0||qualityIndex<0)fail('KIWIS_COLUMNS','The response must retain Timestamp, Value and Quality Code.');
        const seriesId='series-'+digest(canonical([selection.endpoint,selection.datasource,selected.tsId,tableIndex])).slice(0,32);
        const seriesMetadata=Object.fromEntries(Object.entries(table).filter(([key])=>key!=='data'));
        let item=seriesTables.get(tableIndex);
        if(!item){item={seriesId,tsId:selected.tsId,selected,tableIndex,columns,metadata,returned:[],responses:[]};
          seriesTables.set(tableIndex,item);series.push(item);}
        item.returned.push({windowIndex:specification.windowIndex,window:specification.window,metadata:seriesMetadata,tablePresent:true});
        item.responses.push({key:specification.key,sha256:valuesResponse.sha256,rows:table.data.length,tablePresent:true});
        table.data.forEach((row,rowIndex)=>{
          if(!Array.isArray(row)||row.length!==columns.length)fail('KIWIS_ROW','An original observation differs from its complete column declaration.');
          if(row.some(value=>typeof value!=='string'&&value!==null&&typeof value!=='boolean'))fail('KIWIS_VALUE','Retain original scalar values without inferred coercions.');
          const originalTypes=scalarTypes(row,types),fields=Object.fromEntries(columns.map((name,index)=>[name,row[index]])),
            fieldTypes=Object.fromEntries(columns.map((name,index)=>[name,originalTypes[index]]));
          const sourceIdentity={editionSha256,responseSha256:valuesResponse.sha256,requestKey:specification.key,
            windowIndex:specification.windowIndex,tableIndex,rowIndex,...(valuesResponse.archiveMember?{archiveMember:valuesResponse.archiveMember}:{})};
          const recordId='kiwis-'+digest(canonical(sourceIdentity)).slice(0,32);
          observations.push({recordId,rowSha256:digest(canonical({columns,row})),seriesId,tsId:selected.tsId,sourceIdentity,
            timestamp:row[timestampIndex],value:row[valueIndex],quality:row[qualityIndex],fields,original:row,originalTypes,fieldTypes,
            typedRowSha256:digest(canonical({columns,row,types:originalTypes}))});
        });
      }
    }
    if(!seriesTables.size){
      const tableIndex=0,seriesId='series-'+digest(canonical([selection.endpoint,selection.datasource,selected.tsId,tableIndex])).slice(0,32);
      const item={seriesId,tsId:selected.tsId,selected,tableIndex,columns:[],metadata,returned:[],responses:[]};
      seriesTables.set(tableIndex,item);series.push(item);
    }
    for(const item of seriesTables.values()){
      const returnedByWindow=new Map(item.returned.map(value=>[value.windowIndex,value]));
      const responsesByKey=new Map(item.responses.map(value=>[value.key,value]));
      item.returned=valueSpecifications.map(specification=>returnedByWindow.get(specification.windowIndex)??
        {windowIndex:specification.windowIndex,window:specification.window,metadata:null,tablePresent:false});
      item.responses=valueSpecifications.map(specification=>responsesByKey.get(specification.key)??
        {key:specification.key,sha256:byKey.get(specification.key).sha256,rows:0,tablePresent:false});
      item.coverage=valueSpecifications.map((specification,index)=>({
        windowIndex:specification.windowIndex,window:specification.window,requestKey:specification.key,
        responseSha256:item.responses[index].sha256,rows:item.responses[index].rows,
        status:!item.responses[index].tablePresent?'NO_TABLE':item.responses[index].rows?'VALUES':'EMPTY_TABLE'}));
    }
  }
  return {series,observations};
}
function decoded(source){const types=new WeakMap();return {json:decodeResponse(source,{types}),types};}
export function projectCapture(capture){
  if(capture?.schema===RETAINED_SOURCE_SCHEMA)return projectRetainedCapture(capture);
  if(capture?.schema!==SOURCE_SCHEMA)fail('KIWIS_SOURCE','Open a complete original KiWIS source edition.');
  const selection=captureSelection(capture.selection);
  if(!same(selection,capture.selection)||!Array.isArray(capture.responses))fail('KIWIS_SELECTION','The retained capture selection differs from its original programme.');
  const specifications=retainedPlannedRequests(selection,capture.responses),expected=new Map(specifications.map(spec=>[spec.key,spec]));
  const byKey=new Map();
  for(const response of capture.responses){
    if(!expected.has(response.key)||byKey.has(response.key))fail('KIWIS_RESPONSE','Retain one complete original response for each selected request.');
    const spec=expected.get(response.key);
    if(response.url!==requestURL(selection,spec.request,spec.parameters)||response.request!==spec.request||
      !Number.isInteger(response.status)||response.status<200||response.status>299)
      fail('KIWIS_REQUEST_CHANGED','The original response request differs from the selected programme.');
    decodeResponse(response);byKey.set(response.key,response);
  }
  if(expected.size!==byKey.size)fail('KIWIS_INCOMPLETE','The original capture programme has unfinished source requests.');
  const binding={schema:SOURCE_SCHEMA,selection,responses:capture.responses.map(({key,url,bytes,sha256,request})=>({key,url,bytes,sha256,request}))};
  const editionSha256=digest(canonical(binding));
  if(capture.editionSha256!==editionSha256)fail('KIWIS_SOURCE_CHANGED','The complete source edition identity differs from its original response set.');
  return {schema:'starforge.kiwis-projection.v1',editionSha256,selection,
    ...projectValues(selection,specifications,byKey,editionSha256,selected=>catalogueRecords(byKey.get('metadata:'+selected.tsId)),decoded),
    qualityCodes:catalogueRecords(byKey.get('quality')),releaseStateClasses:catalogueRecords(byKey.get('release-classes'))};
}
export async function captureKiWIS(input,{fetch:transport=globalThis.fetch,signal,checkpoint=null,onCheckpoint=async()=>{}}={}){
  const selection=captureSelection(input);
  if(typeof transport!=='function')fail('KIWIS_TRANSPORT','Select the installed HTTP transport.');
  const specs=retainedPlannedRequests(selection,checkpoint?.responses??[]);
  if(checkpoint&&(!same(checkpoint.selection,selection)||checkpoint.schema!=='starforge.kiwis-capture-progress.v1'))fail('KIWIS_CHECKPOINT','Resume the original selected capture programme.');
  const prior=new Map((checkpoint?.responses??[]).map(response=>[response.key,response]));
  if(prior.size!==(checkpoint?.responses?.length??0))fail('KIWIS_CHECKPOINT','A retained request occurs twice.');
  const responses=[];
  for(const spec of specs){
    signal?.throwIfAborted();const url=requestURL(selection,spec.request,spec.parameters);
    let retained=prior.get(spec.key);
    if(retained){
      if(retained.url!==url||retained.request!==spec.request)fail('KIWIS_CHECKPOINT','A resumed source request differs from its original URL.');
      decodeResponse(retained);
    }else{
      const response=await transport(url,{method:'GET',headers:{Accept:'application/json'},signal,redirect:'error'});
      if(!response.ok)fail('KIWIS_HTTP','The original provider request returned HTTP '+response.status+'.',
        {status:response.status,url,retryAfter:response.headers.get('retry-after'),completed:responses.map(r=>r.key)});
      const bytes=Buffer.from(await response.arrayBuffer());
      retained={key:spec.key,request:spec.request,url,status:response.status,retrievedAt:new Date().toISOString(),
        contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),
        bytes:bytes.length,sha256:digest(bytes),base64:bytes.toString('base64')};
      decodeResponse(retained);
    }
    responses.push(retained);
    await onCheckpoint({schema:'starforge.kiwis-capture-progress.v1',selection,totalRequests:specs.length,responses:[...responses]});
  }
  if([...prior.keys()].some(key=>!specs.some(spec=>spec.key===key)))fail('KIWIS_CHECKPOINT','A retained request is outside the original selected programme.');
  const capture={schema:SOURCE_SCHEMA,selection,responses};
  capture.editionSha256=digest(canonical({schema:SOURCE_SCHEMA,selection,
    responses:responses.map(({key,url,bytes,sha256,request})=>({key,url,bytes,sha256,request}))}));
  projectCapture(capture);return capture;
}

export function retainedSelection(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!own(input,'datasource'))
    fail('KIWIS_SELECTION','Declare the original datasource explicitly; use null for provider-default.');
  const endpoint=endpointSelection({...input,datasource:input.datasource===null?'0':input.datasource}).endpoint;
  const datasource=input.datasource===null?null:String(input.datasource);
  if(datasource!==null&&!/^[0-9]+$/.test(datasource))fail('KIWIS_DATASOURCE','Retain the explicit original numeric datasource or null.');
  if(!Array.isArray(input.series)||!input.series.length)fail('KIWIS_SERIES','Select the original retained time-series programme.');
  const ids=new Set(),series=input.series.map(value=>{
    const tsId=String(value?.tsId??'');
    if(!/^[0-9]+$/.test(tsId)||ids.has(tsId))fail('KIWIS_SERIES','Select each original ts_id once.');ids.add(tsId);
    if(value.period==='complete'){
      if(value.from!==undefined||value.to!==undefined||value.chunkSeconds!==undefined)fail('KIWIS_WINDOW','A complete-period source keeps its original period selection.');
      return {tsId,period:'complete'};
    }
    if(value.period!==undefined)fail('KIWIS_WINDOW','Retain period complete or an explicit original from/to window.');
    const from=text(value.from,'original source start'),to=text(value.to,'original source end');
    if(explicitInstant(from)===null||explicitInstant(to)===null||explicitInstant(from)>explicitInstant(to))
      fail('KIWIS_WINDOW','Retain ordered source timestamps with explicit offsets.');
    return {tsId,from,to};
  });
  const timezone=input.timezone===null?null:text(input.timezone??'UTC','original response timezone');
  return {endpoint,datasource,series,timezone};
}
function retainedResponse(input,selection){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.key!=='string'||!input.key.trim())
    fail('KIWIS_RESPONSE','Retain a unique original response key.');
  const provided=input.origin?.kind==='provided-original-file';
  if(provided&&(typeof input.origin.filename!=='string'||!input.origin.filename||
    /[\\/\u0000-\u001f]/.test(input.origin.filename)))fail('KIWIS_ORIGIN','Name the original supplied file without inventing an HTTP receipt.');
  let url=null;
  if(input.url!==undefined){
    if(typeof input.url!=='string')fail('KIWIS_REQUEST_CHANGED','Retain the original HTTP URL exactly.');
    try{url=new URL(input.url);}catch{fail('KIWIS_REQUEST_CHANGED','The original HTTP URL is invalid.');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)fail('KIWIS_REQUEST_CHANGED','Retain the original credential-free HTTP request.');
    const endpoint=new URL(url);endpoint.search='';
    if(endpoint.href!==selection.endpoint)fail('KIWIS_REQUEST_CHANGED','A retained response belongs to another selected endpoint.');
    for(const key of ['service','type','format','request','datasource','ts_id','period','from','to','timezone'])
      if(url.searchParams.getAll(key).length>1)fail('KIWIS_REQUEST_CHANGED','The original request has an ambiguous '+key+' parameter.');
    if(url.searchParams.get('service')!=='kisters'||url.searchParams.get('type')!=='queryServices'||url.searchParams.get('format')!=='json')
      fail('KIWIS_REQUEST_CHANGED','Retain the original JSON KiWIS QueryServices request.');
    if(selection.datasource===null?url.searchParams.has('datasource'):url.searchParams.get('datasource')!==selection.datasource)
      fail('KIWIS_DATASOURCE','Retain the exact original explicit or provider-default datasource.');
  }else if(!provided)fail('KIWIS_ORIGIN','A response needs its actual HTTP receipt or explicit provided-original-file provenance.');
  if(input.status!==undefined&&(!Number.isInteger(input.status)||input.status<200||input.status>299))
    fail('KIWIS_REQUEST_CHANGED','The retained source records an unsuccessful original HTTP response.');
  if(!provided&&(input.status===undefined||!url))fail('KIWIS_ORIGIN','Retain the actual HTTP status and URL.');
  if(!url&&input.status!==undefined)fail('KIWIS_ORIGIN','A supplied file without an HTTP URL must not acquire an inferred HTTP status.');
  const request=input.request??url?.searchParams.get('request')??input.origin?.request;
  if(typeof request!=='string'||!request.trim()||url&&url.searchParams.get('request')!==request||
    input.origin?.request!==undefined&&input.origin.request!==request)
    fail('KIWIS_REQUEST_CHANGED','Bind the response to its original request or supplied-file request provenance.');
  if(input.origin?.sha256!==undefined&&input.origin.sha256!==input.sha256||
    input.origin?.bytes!==undefined&&input.origin.bytes!==input.bytes)
    fail('KIWIS_SOURCE_CHANGED','The provided original-file provenance differs from its full bytes.');
  return {...input,request};
}
const retainedBinding=capture=>({schema:RETAINED_SOURCE_SCHEMA,selection:capture.selection,
  responses:capture.responses.map(response=>Object.fromEntries(Object.entries(response).filter(([key])=>key!=='base64')))});
function retainedValueSpecification(response,selected,selection,index){
  const parameters=response.url?new URL(response.url).searchParams:null;
  const provided=response.origin?.selection;
  const tsId=parameters?.get('ts_id')??provided?.tsId;
  if(String(tsId??'')!==selected.tsId)fail('KIWIS_IDENTITY','The original values request differs from its selected ts_id.');
  const timezone=parameters?(parameters.has('timezone')?parameters.get('timezone'):null):(provided?.timezone??null);
  if(timezone!==selection.timezone)fail('KIWIS_REQUEST_CHANGED','Retain the exact requested or provider-default response timezone.');
  const period=parameters?.get('period')??provided?.period;
  let window;
  if(selected.period==='complete'){
    if(period!=='complete'||parameters&&(parameters.has('from')||parameters.has('to'))||
      !parameters&&(provided?.from!==undefined||provided?.to!==undefined))
      fail('KIWIS_WINDOW','The retained values must preserve the original complete-period request.');
    window={period:'complete'};
  }else{
    if(period!==undefined&&period!==null)fail('KIWIS_WINDOW','The retained window must preserve its original from/to request.');
    const from=parameters?.get('from')??provided?.from,to=parameters?.get('to')??provided?.to;
    const a=explicitInstant(from),b=explicitInstant(to);
    if(a===null||b===null||a>b||a<explicitInstant(selected.from)||b>explicitInstant(selected.to))
      fail('KIWIS_WINDOW','The retained values window differs from the selected original programme.');
    window={from,to};
  }
  return {key:response.key,request:'getTimeseriesValues',tsId:selected.tsId,windowIndex:index,window};
}
function retainedParts(capture){
  const selection=retainedSelection(capture.selection);
  if(!same(selection,capture.selection)||!Array.isArray(capture.responses))fail('KIWIS_SELECTION','Retain the complete explicit original-file selection.');
  const byKey=new Map(),cache=new Map(),responses=[];
  for(const original of capture.responses){
    const response=retainedResponse(original,selection);
    if(!same(original,response)||byKey.has(response.key))fail('KIWIS_RESPONSE','Retain each normalized original response once.');
    const value=decoded(response);cache.set(response.key,value);byKey.set(response.key,response);responses.push(response);
  }
  const select=request=>responses.filter(response=>response.request===request);
  const quality=select('getQualityCodes'),release=select('getReleaseStateClasses'),metadataResponses=select('getTimeseriesList');
  if(quality.length!==1||release.length!==1||!metadataResponses.length)
    fail('KIWIS_INCOMPLETE','Retain the original quality catalogue, release classes and complete selected-station time-series catalogue.');
  const catalogues=responses.filter(response=>response.request!=='getTimeseriesValues').map(response=>{
    const value=cache.get(response.key),records=catalogueRows(value.json,value.types);
    return {key:response.key,request:response.request,bytes:response.bytes,sha256:response.sha256,
      ...(response.url!==undefined?{url:response.url}:{}),...(response.status!==undefined?{status:response.status}:{}),
      ...(response.archiveMember?{archiveMember:response.archiveMember}:{}),...(response.origin?{origin:response.origin}:{}),
      records:records.map(row=>({...row,sourceIdentity:{requestKey:response.key,responseSha256:response.sha256,
        ...(response.archiveMember?{archiveMember:response.archiveMember}:{})}}))};
  });
  const metadata=catalogues.filter(catalogue=>catalogue.request==='getTimeseriesList').flatMap(catalogue=>catalogue.records);
  const selectedIds=new Set(selection.series.map(series=>series.tsId));
  const valuesById=new Map(selection.series.map(series=>[series.tsId,[]]));
  for(const response of select('getTimeseriesValues')){
    const tsId=String(response.url?new URL(response.url).searchParams.get('ts_id')??'':response.origin?.selection?.tsId??'');
    if(!selectedIds.has(tsId))fail('KIWIS_IDENTITY','Select every original values response by its exact requested ts_id.');
    valuesById.get(tsId).push(response);
  }
  const specifications=[];
  for(const selected of selection.series){
    if(!metadata.some(row=>String(row.fields.ts_id??'')===selected.tsId))
      fail('KIWIS_IDENTITY','The complete original time-series catalogue does not contain a selected ts_id.',{tsId:selected.tsId});
    const values=valuesById.get(selected.tsId);
    if(!values.length||selected.period==='complete'&&values.length!==1)
      fail('KIWIS_INCOMPLETE','Retain one complete-period response or every original selected window for each time series.',{tsId:selected.tsId});
    const parts=values.map((response,index)=>retainedValueSpecification(response,selected,selection,index));
    if(selected.period!=='complete'){
      let frontier=explicitInstant(selected.from);
      for(const part of [...parts].sort((a,b)=>explicitInstant(a.window.from)-explicitInstant(b.window.from))){
        if(explicitInstant(part.window.from)>frontier)fail('KIWIS_INCOMPLETE','A retained request window is missing from the original programme.');
        frontier=Math.max(frontier,explicitInstant(part.window.to));
      }
      if(frontier!==explicitInstant(selected.to))fail('KIWIS_INCOMPLETE','The original selected request window is unfinished.');
    }
    specifications.push(...parts);
  }
  return {selection,byKey,cache,specifications,catalogues,metadata,
    qualityCodes:catalogues.find(catalogue=>catalogue.key===quality[0].key).records,
    releaseStateClasses:catalogues.find(catalogue=>catalogue.key===release[0].key).records};
}
function projectRetainedCapture(capture){
  if(capture.editionSha256!==digest(canonical(retainedBinding(capture))))
    fail('KIWIS_SOURCE_CHANGED','The original retained response set or provenance changed.');
  const parts=retainedParts(capture);
  const values=projectValues(parts.selection,parts.specifications,parts.byKey,capture.editionSha256,()=>parts.metadata,
    response=>parts.cache.get(response.key));
  for(const series of values.series)series.metadataSelection=parts.metadata.filter(row=>String(row.fields.ts_id??'')===series.tsId)
    .map(row=>({requestKey:row.sourceIdentity.requestKey,tableIndex:row.tableIndex,rowIndex:row.rowIndex}));
  return {schema:'starforge.kiwis-projection.v1',sourceSchema:RETAINED_SOURCE_SCHEMA,editionSha256:capture.editionSha256,
    selection:parts.selection,...values,catalogues:parts.catalogues,qualityCodes:parts.qualityCodes,releaseStateClasses:parts.releaseStateClasses};
}
export function importKiWISResponses({selection:input,responses:original}){
  const selection=retainedSelection(input);
  if(!Array.isArray(original))fail('KIWIS_SOURCE','Retain every original response and its exact bytes.');
  const responses=original.map(response=>retainedResponse(response,selection));
  const capture={schema:RETAINED_SOURCE_SCHEMA,selection,responses};
  capture.editionSha256=digest(canonical(retainedBinding(capture)));
  projectRetainedCapture(capture);return capture;
}
