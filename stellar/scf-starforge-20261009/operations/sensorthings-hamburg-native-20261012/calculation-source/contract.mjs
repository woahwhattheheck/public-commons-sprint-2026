// MIT. SensorThings Part 1 Sensing 1.1 source and operating contracts.
import {createHash} from 'node:crypto';
import {JsonNumber,parseSource} from '../ogc/source.mjs';
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';
export {JsonNumber};
import {ENTITIES,SOURCE_CONTRACT} from './schema.mjs';
export {WORKSPACE_SCHEMA,EDITION_SCHEMA,SOURCE_CONTRACT,ENTITIES,ACTIONS,workspaceSchema} from './schema.mjs';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof JsonNumber);
export const canonical=v=>v instanceof JsonNumber?v: Array.isArray(v)?v.map(canonical):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const stable=v=>JSON.stringify(canonical(v));
export const identity=v=>sha(Buffer.from(stable(v)));
export const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export const now=()=>new Date().toISOString();
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code:'SENSORTHINGS_'+code,status,details});
export function text(value,label,maximum=200,{empty=false}={}){
  if(typeof value!=='string'||value.length>maximum||(!empty&&!value.trim())||/[\u0000-\u001f\u007f]/u.test(value))
    throw fault('FIELD','Supply '+label+' as a single-line string of at most '+maximum+' characters.');
  return value;
}
export function integer(value,label,minimum,maximum){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw fault('FIELD','Supply '+label+' between '+minimum+' and '+maximum+'.');
  return value;
}
export function fields(value,names,required=[]){
  if(!plain(value)||Object.keys(value).some(k=>!names.includes(k))||required.some(k=>!Object.hasOwn(value,k)))
    throw fault('FIELDS','Use the declared fields, including '+required.join(', ')+'.');
  return value;
}
export function sourceDocument(bytes){
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  // The existing exact scanner rejects repeated JSON keys and excessive depth.
  // The existing OGC decoder then retains typed numeric lexemes, unlike a
  // string-only decoder, so numeric results remain distinct from categories.
  parseExactJSON(decoded);
  return parseSource(bytes);
}
export function valueCell(value){
  if(value===undefined)return {state:'missing',type:'missing',value:''};
  if(value===null)return {state:'null',type:'null',value:''};
  if(value instanceof JsonNumber)return {state:'value',type:'number',value:value.text};
  return {state:'value',type:Array.isArray(value)?'array':typeof value,
    value:typeof value==='string'?value:JSON.stringify(value)};
}
export function numericId(value){
  if(!(value instanceof JsonNumber))return null;
  const m=/^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.text);
  if(!m||value.text.length>4096)throw fault('ENTITY_ID','The numeric source identifier cannot be represented safely.');
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,'');
  if(!digits)return '0';
  let exponent=BigInt(m[4]??'0')-BigInt((m[3]??'').length);
  while(digits.endsWith('0')){digits=digits.slice(0,-1);exponent++;}
  return m[1]+digits+'e'+exponent;
}
export function entityId(value){
  if(typeof value==='string')return {type:'string',value,key:'string:'+JSON.stringify(value)};
  if(value instanceof JsonNumber)return {type:'number',value:value.text,key:'number:'+numericId(value)};
  throw fault('ENTITY_ID','The provider entity must retain a string or numeric @iot.id.',422);
}
export function pointer(value,path){
  if(typeof path!=='string'||path.length>4096||(path!==''&&!path.startsWith('/'))||/~(?![01])/u.test(path))throw fault('POINTER','Use an RFC 6901 JSON pointer.');
  if(path==='')return value;
  for(const k of path.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))){
    if((!plain(value)&&!Array.isArray(value))||!Object.hasOwn(value,k))return undefined;
    value=value[k];
  }
  return value;
}
export const escapePointer=k=>String(k).replace(/~/g,'~0').replace(/\//g,'~1');
export function sourceConfig(input){
  fields(input,['label','serviceUrl','authorizationEnv','allowLoopback','license','requestTimeoutMs','maxPageBytes'],['label','serviceUrl','license']);
  const service=new URL(text(input.serviceUrl,'the advertised service root',2048));
  const allowLoopback=input.allowLoopback===true;
  if(service.username||service.password||service.hash||service.search||
      !(service.protocol==='https:'||(allowLoopback&&service.protocol==='http:'&&['127.0.0.1','[::1]'].includes(service.hostname))))
    throw fault('SERVICE_URL','Use an explicit HTTPS service root; loopback HTTP requires a host-selected reference source.');
  service.pathname=service.pathname.replace(/\/?$/,'/');
  if(input.authorizationEnv!==undefined&&!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.authorizationEnv))throw fault('AUTH_ENV','Use the environment-variable name, not a credential value.');
  fields(input.license,['name','url','attribution','sourceUrl','note'],['name','url','attribution','sourceUrl']);
  for(const k of ['name','url','attribution','sourceUrl'])text(input.license[k],'the retained source licence '+k,4096);
  for(const k of ['url','sourceUrl']){const u=new URL(input.license[k]);if(u.protocol!=='https:'||u.username||u.password)throw fault('LICENSE_URL','Use the original public HTTPS licence and source URLs.');}
  return {label:text(input.label,'a source label'),serviceUrl:service.href,authorizationEnv:input.authorizationEnv??null,allowLoopback,
    license:structuredClone(input.license),requestTimeoutMs:integer(input.requestTimeoutMs??45000,'request timeout',1000,180000),
    maxPageBytes:integer(input.maxPageBytes??4*1024*1024,'page bytes',1024,16*1024*1024)};
}
export function sourceURL(value,config,base=config.serviceUrl){
  text(value,'an original service URL',16384);
  const url=new URL(value,base),root=new URL(config.serviceUrl);
  let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{throw fault('SOURCE_URL','Malformed source URL.');}
  const rootPath=decodeURIComponent(root.pathname);
  if(url.username||url.password||url.hash||url.origin!==root.origin||
      !(decoded===rootPath.replace(/\/$/,'')||decoded.startsWith(rootPath))||
      decoded.split('/').some(p=>p==='.'||p==='..')||/[\u0000-\u001f\u007f\\]/u.test(decoded))
    throw fault('SOURCE_SCOPE','The provider link leaves the host-selected service root. It remains source evidence and will not be fetched.',422,{url:url.href});
  return url.href;
}
export function queryURL(base,input,config,{catalog=false}={}){
  input=input??{};fields(input,['filter','orderBy','top','count','expandFeatureOfInterest'],[]);
  const u=new URL(sourceURL(base,config));
  if(u.search)throw fault('QUERY_BASE','Add query options only to an original navigation or collection URL without an existing query.');
  if(input.filter!==undefined)u.searchParams.set('$filter',text(input.filter,'the exact provider filter',8192));
  if(input.orderBy!==undefined)u.searchParams.set('$orderby',text(input.orderBy,'the exact provider ordering',1024));
  if(input.top!==undefined)u.searchParams.set('$top',String(integer(input.top,'the requested top',0,1000000)));
  if(input.count!==undefined){if(typeof input.count!=='boolean')throw fault('QUERY','count must be boolean.');u.searchParams.set('$count',String(input.count));}
  if(input.expandFeatureOfInterest!==undefined){if(catalog||typeof input.expandFeatureOfInterest!=='boolean')throw fault('QUERY','FeatureOfInterest expansion is an explicit observation-query boolean.');if(input.expandFeatureOfInterest)u.searchParams.set('$expand','FeatureOfInterest');}
  if(catalog&&input.top===undefined)u.searchParams.set('$top','25');
  return u.href;
}
export function collection(doc,config,url){
  if(!plain(doc)||!Array.isArray(doc.value))throw fault('COLLECTION','The provider did not return a SensorThings value array.',422);
  if(doc.value.some(v=>!plain(v)))throw fault('COLLECTION_ROW','A collection member is not an entity object.',422);
  let next=null;if(Object.hasOwn(doc,'@iot.nextLink')){
    if(typeof doc['@iot.nextLink']!=='string'||!doc['@iot.nextLink'])throw fault('NEXT_LINK','The original nextLink is malformed.',422);
    next=sourceURL(doc['@iot.nextLink'],config,url);
  }
  const count=valueCell(doc['@iot.count']);
  return {rows:doc.value,next,count,continuationLiteral:doc['@iot.nextLink']??null};
}
export function serviceCatalog(doc,config,receipt){
  if(!plain(doc)||!Array.isArray(doc.value))throw fault('SERVICE_DOCUMENT','The service root did not return its advertised collections.',422);
  const entries={};
  for(const item of doc.value){
    if(!plain(item)||!ENTITIES.includes(item.name)||typeof item.url!=='string')continue;
    if(entries[item.name])throw fault('SERVICE_DOCUMENT','The service root repeats a collection.',422);
    entries[item.name]=sourceURL(item.url,config,receipt.url);
  }
  for(const name of ['Things','Datastreams','Sensors','ObservedProperties','Observations','FeaturesOfInterest'])
    if(!entries[name])throw fault('SERVICE_DOCUMENT','The required '+name+' collection is not advertised.',422);
  return {entries,serverSettings:doc.serverSettings===undefined?null:JSON.parse(JSON.stringify(doc.serverSettings)),
    receipt,sourceContract:SOURCE_CONTRACT,snapshot:'not_established'};
}
export function selectedStream(record,kind,config,sourceRef){
  if(!['Datastreams','MultiDatastreams'].includes(kind)||!plain(record))throw fault('STREAM','Select an original stream catalogue member.');
  const id=entityId(record['@iot.id']);
  if(typeof record['@iot.selfLink']!=='string')throw fault('STREAM_LINK','The selected stream has no original selfLink.',422);
  const url=sourceURL(record['@iot.selfLink'],config,sourceRef.url);
  const observationLink=record['Observations@iot.navigationLink'];
  if(typeof observationLink!=='string')throw fault('STREAM_LINK','The selected stream has no original Observations navigationLink.',422);
  return {key:identity({kind,url,id:id.key}),kind,id,url,observationsUrl:sourceURL(observationLink,config,url),
    name:valueCell(record.name),description:valueCell(record.description),sourceRef,
    selectedJson:JSON.stringify(record),metadataMeaning:streamMeaning(record,kind)};
}
export function streamMeaning(record,kind){
  const names=kind==='MultiDatastreams'?['unitOfMeasurements','multiObservationDataTypes','ObservedProperties']:
    ['unitOfMeasurement','observationType','ObservedProperty'];
  return Object.fromEntries(['name','description',...names,'properties'].map(k=>[k,valueCell(record[k])]));
}
export function linksFromEntity(entity,kind,config,url,{history=false}={}){
  const relationships={Datastreams:{Thing:'Things',Sensor:'Sensors',ObservedProperty:'ObservedProperties'},
    MultiDatastreams:{Thing:'Things',Sensor:'Sensors',ObservedProperties:'ObservedProperties'},
    Things:{Locations:'Locations',...(history?{HistoricalLocations:'HistoricalLocations'}:{})},
    HistoricalLocations:{Locations:'Locations'},Observations:{FeatureOfInterest:'FeaturesOfInterest'}};
  const output=[];
  for(const [name,targetKind]of Object.entries(relationships[kind]??{})){
    if(name==='FeatureOfInterest'&&plain(entity[name])&&Object.hasOwn(entity[name],'feature'))continue;
    const value=entity[name+'@iot.navigationLink'];
    if(value!==undefined){if(typeof value!=='string')throw fault('NAVIGATION','The provider navigationLink is not a URL.',422);
      output.push({name,kind:targetKind,url:sourceURL(value,config,typeof entity['@iot.selfLink']==='string'?sourceURL(entity['@iot.selfLink'],config,url):url),collection:['Locations','HistoricalLocations','ObservedProperties'].includes(name)&&!(kind==='Datastreams'&&name==='ObservedProperty')});}
  }
  return output;
}
export function instant(value){
  if(typeof value!=='string')return {state:'not_text',utc:null};
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if(!m)return {state:'unresolved_source_literal',utc:null};
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),fraction=m[7]??'';
  if(second===60)return {state:'leap_second_retained',utc:null};
  if(fraction.length>9)return {state:'precision_retained_without_normalization',utc:null};
  if(year<1||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return {state:'invalid_calendar',utc:null};
  const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);calendar.setUTCHours(hour,minute,second,0);
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day)return {state:'invalid_calendar',utc:null};
  let offset=0;if(m[8]!=='Z'){
    const digits=m[8].slice(1).replace(':',''),h=Number(digits.slice(0,2)),n=Number(digits.slice(2));
    if(h>23||n>59)return {state:'invalid_offset',utc:null};offset=(h*60+n)*(m[8][0]==='-'?-1:1);
  }
  const utc=new Date(calendar.getTime()-offset*60000);
  if(!Number.isFinite(utc.getTime())||utc.getUTCFullYear()<0||utc.getUTCFullYear()>9999)return {state:'outside_sortable_range',utc:null};
  return {state:'explicit_instant',utc:utc.toISOString().slice(0,19)+'.'+fraction.padEnd(9,'0')+'Z'};
}
export function timeCell(value){
  const source=valueCell(value);
  if(source.state!=='value'||source.type!=='string')return {...source,kind:source.state,startUtc:null,endUtc:null};
  const pieces=value.split('/');
  if(pieces.length===1){const t=instant(value);return {...source,kind:t.state,startUtc:t.utc,endUtc:null};}
  if(pieces.length!==2)return {...source,kind:'unresolved_source_literal',startUtc:null,endUtc:null};
  const a=instant(pieces[0]),b=instant(pieces[1]);
  return {...source,kind:a.utc&&b.utc?(a.utc<=b.utc?'explicit_interval':'reversed_interval'):'unresolved_source_interval',startUtc:a.utc,endUtc:b.utc};
}
export function recordSummary(record,kind,ref){
  const id=valueCell(record['@iot.id']);
  return {kind,id,name:valueCell(record.name),description:valueCell(record.description),selfLink:valueCell(record['@iot.selfLink']),
    unit:valueCell(record.unitOfMeasurement??record.unitOfMeasurements),observationType:valueCell(record.observationType??record.multiObservationDataTypes),
    sourceRef:ref,entityJson:JSON.stringify(record)};
}
