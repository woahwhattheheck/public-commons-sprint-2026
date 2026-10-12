// MIT. Bounded original NOAA requests and source-package validation.
import {createHash} from 'node:crypto';
import {SOURCE_CONTRACT,PRODUCTS} from './schema.mjs';
import {stable} from '../stellar-expert/store.mjs';
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const urlKey=value=>hashBytes(Buffer.from(value));
export function fault(code,message,status=400,details={}){return Object.assign(new Error(message),{code,status,...details});}
export function text(v,label,max=200,empty=false){if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw fault('COOPS_INPUT','Supply '+label+' of at most '+max+' characters.');return v;}
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const day=86400000;
const dateValue=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fault('COOPS_DATE','Use a real YYYY-MM-DD calendar date.');return Date.parse(value+'T00:00:00Z');};
const date=t=>new Date(t).toISOString().slice(0,10);
const datums=['MLLW','MHHW','MHW','MTL','MSL','MLW','NAVD','STND','IGLD','LWD','CRD'];
export function normaliseStation(input){
 const stationId=text(input.stationId,'the original seven-digit NOAA water-level station ID',7);
 if(!/^\d{7}$/.test(stationId))throw fault('COOPS_STATION','This coastal product uses an explicit seven-digit water-level/tide station ID.');
 if(input.active!==undefined&&typeof input.active!=='boolean')throw fault('COOPS_STATION','Station active must be boolean.');
 return{stationId,label:text(input.label,'a station profile name',160),owner:text(input.owner??'','the responsible team',200,true),note:text(input.note??'','a profile note',12000,true),active:input.active!==false};
}
export function makeQuery(profile,input){
 if(!Array.isArray(input.products)||input.products.length<1||input.products.length>3||new Set(input.products).size!==input.products.length||input.products.some(p=>!Object.hasOwn(PRODUCTS,p)))throw fault('COOPS_PRODUCTS','Choose distinct declared water-level, hourly-height or prediction products.');
 const begin=dateValue(input.beginDate),end=dateValue(input.endDate),days=(end-begin)/day+1;
 if(days<1||days>366)throw fault('COOPS_WINDOW','Select an inclusive calendar window of one to 366 days.');
 if(!['metric','english'].includes(input.units)||!['gmt','lst','lst_ldt'].includes(input.timeZone)||!datums.includes(input.datum))throw fault('COOPS_BASIS','Choose explicit units, time zone and datum.');
 const interval=input.predictionInterval??'6';if(!['6','h','hilo'].includes(interval))throw fault('COOPS_PREDICTION_INTERVAL','Choose six-minute, hourly or high/low predictions.');
 return{stationId:profile.stationId,products:[...input.products],beginDate:input.beginDate,endDate:input.endDate,endExclusiveDate:date(end+day),days,units:input.units,timeZone:input.timeZone,datum:input.datum,predictionInterval:interval,
  endpointMeaning:'Inclusive local-calendar dates in the selected provider time basis; no daylight-time conversion is inferred.'};
}
function allowedUrl(value){
 let u;try{u=new URL(value);}catch{throw fault('COOPS_URL','The selected NOAA source URL is invalid.');}
 if(u.protocol!=='https:'||u.hostname!=='api.tidesandcurrents.noaa.gov'||u.port||u.username||u.password||u.hash)throw fault('COOPS_URL','Use the original HTTPS CO-OPS API origin.');
 if(u.pathname!==new URL(SOURCE_CONTRACT.dataApi).pathname&&!/^\/mdapi\/prod\/webapi\/stations\/\d{7}(?:\/[a-z]+)?\.json$/.test(u.pathname))throw fault('COOPS_URL','The source URL is outside the selected station/data API.');
 return u;
}
export function stationTask(query){
 const u=new URL(SOURCE_CONTRACT.metadataApi+'/stations/'+query.stationId+'.json');u.searchParams.set('units',query.units);
 return{id:'metadata-station',kind:'metadata',resource:'station',url:u.href,required:true,dependency:null};
}
export function dataTasks(query){
 const tasks=[],begin=dateValue(query.beginDate),end=dateValue(query.endDate);
 for(const product of query.products){
  const cap=PRODUCTS[product].maxDays;
  for(let t=begin,index=0;t<=end;t+=cap*day,index++){
   const a=date(t),b=date(Math.min(end,t+(cap-1)*day)),u=new URL(SOURCE_CONTRACT.dataApi);
   for(const [key,value]of Object.entries({product,application:'StellarForge_Coastal_Source_Operations',begin_date:a.replaceAll('-','')+' 00:00',end_date:b.replaceAll('-','')+' 23:59',station:query.stationId,datum:query.datum,time_zone:query.timeZone,units:query.units,format:'json'}))u.searchParams.set(key,value);
   if(product==='predictions')u.searchParams.set('interval',query.predictionInterval);
   tasks.push({id:product+'-'+index,kind:'data',product,url:u.href,beginDate:a,endDate:b,required:true,dependency:'metadata-station'});
  }
 }
 return tasks;
}
export function requestPlan(profile,input){
 const query=makeQuery(profile,input),tasks=[stationTask(query),...dataTasks(query)];
 return{schema:'stellar-forge.coops-request-plan.v1',profile:structuredClone(profile),query,tasks,metadataPolicy:'After the station response, retain its actual advertised datum, prior-datum, detail, sensor, notice, disclaimer, benchmark and tide-offset resources. Do not invent absent resources.',planSha256:hashBytes(Buffer.from(stable({stationId:query.stationId,query,tasks})))};
}
const metadataResources=['details','sensors','datums','supersededdatums','notices','disclaimers','benchmarks','tidepredoffsets'];
export function stationRecord(body,query){
 const list=Array.isArray(body.stations)?body.stations:Array.isArray(body.stationList)?body.stationList:[body],matches=list.filter(s=>plain(s)&&String(s.id)===query.stationId);
 if(matches.length!==1)throw fault('COOPS_STATION_IDENTITY','The actual station metadata does not contain exactly the selected station.',502);
 return matches[0];
}
export function metadataTasks(body,query){
 const station=stationRecord(body,query),tasks=[],unavailable=[];
 for(const resource of metadataResources){
  const selected=station[resource]??(resource==='tidepredoffsets'?station.tidePredOffsets:undefined);
  const source=typeof selected==='string'?selected:selected?.self;
  if(!source){unavailable.push({resource,reason:'No resource URL in this original station record.'});continue;}
  try{
   const u=allowedUrl(source);if(u.pathname!==new URL(SOURCE_CONTRACT.metadataApi+'/stations/'+query.stationId+'/'+resource+'.json').pathname)throw fault('COOPS_METADATA_BINDING','The advertised resource differs from this selected station.');
   // Units are an explicit MDAPI parameter, not a conversion of returned values.
   for(const key of [...u.searchParams.keys()])if(key!=='units')throw fault('COOPS_METADATA_BINDING','The advertised resource has an unsupported parameter.');
   u.searchParams.set('units',query.units);
   tasks.push({id:'metadata-'+resource,kind:'metadata',resource,url:u.href,required:true,dependency:'metadata-station',advertisedUrl:source});
  }catch(error){unavailable.push({resource,reason:error.message,advertisedUrl:source});}
 }
 return{station:structuredClone(station),tasks,unavailable};
}
export function decodeSource(bytes,task,query){
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fault('COOPS_SOURCE_JSON','The retained NOAA response is not valid UTF-8 JSON.',502);}
 if(!plain(body))throw fault('COOPS_SOURCE_SHAPE','The original NOAA response must be an object.',502);
 if(body.error!==undefined){
  const message=typeof body.error==='string'?body.error:String(body.error?.message??JSON.stringify(body.error));
  if(task.kind==='data'&&/no data (?:was |were )?found/i.test(message))return{body,rows:[],records:0,unavailable:true,reason:message};
  throw fault('COOPS_SOURCE_ERROR',message.slice(0,4000),422,{retryable:false});
 }
 if(task.kind==='metadata'){
  if(task.resource==='station')stationRecord(body,query);
  else if(body.id!==undefined&&String(body.id)!==query.stationId)throw fault('COOPS_STATION_IDENTITY','The returned metadata identifies another station.',502);
  return{body,records:1,unavailable:false};
 }
 const rows=task.product==='predictions'?body.predictions:body.data;
 if(!Array.isArray(rows))throw fault('COOPS_SOURCE_SHAPE','The actual '+task.product+' response has no expected record array.',502);
 if(body.metadata?.id!==undefined&&String(body.metadata.id)!==query.stationId)throw fault('COOPS_STATION_IDENTITY','The returned data identifies another station.',502);
 if(rows.length>100000||rows.some(row=>!plain(row)||typeof row.t!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(row.t)))throw fault('COOPS_SOURCE_SHAPE','The original NOAA record array has unsupported timestamps or exceeds the source envelope.',502);
 return{body,rows,records:rows.length,unavailable:false};
}
async function readResponse(response,maximum){
 const length=response.headers.get('content-length');if(length&&/^\d+$/.test(length)&&Number(length)>maximum){await response.body?.cancel();throw fault('COOPS_RESPONSE_CAPACITY','The original response exceeds 32 MiB.',413);}
 const chunks=[];let size=0;if(response.body)for await(const chunk of response.body){size+=chunk.length;if(size>maximum){await response.body.cancel().catch(()=>{});throw fault('COOPS_RESPONSE_CAPACITY','The original response grew beyond 32 MiB.',413);}chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks,size);
}
export async function fetchCoopsResponse(task,{userAgent,fetchImpl=fetch,signal}={}){
 let url=allowedUrl(task.url).href,redirects=[],response;
 const startedAt=new Date().toISOString(),timeout=AbortSignal.timeout(60000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 for(let i=0;i<4;i++){
  response=await fetchImpl(url,{headers:{accept:'application/json','user-agent':userAgent,'accept-encoding':'identity'},redirect:'manual',signal:combined});
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get('location');await response.body?.cancel();if(!location||i===3)throw fault('COOPS_REDIRECT','The original NOAA request exceeded its redirect boundary.',502);
  const next=allowedUrl(new URL(location,url).href).href;
  if(new URL(next).pathname!==new URL(task.url).pathname||stable([...new URL(next).searchParams].sort())!==stable([...new URL(task.url).searchParams].sort()))throw fault('COOPS_REDIRECT','The NOAA redirect changes the selected source query.',502);
  redirects.push({url,status:response.status,location:next});url=next;
 }
 const body=await readResponse(response,32*1024*1024),finishedAt=new Date().toISOString(),digest=hashBytes(body);
 const receipt={url:task.url,finalUrl:url,sha256:digest,bytes:body.length,responseSha256:digest,responseBytes:body.length,
  sourceObservedAt:finishedAt,startedAt,finishedAt,transport:'native-https',statusObserved:response.status,
  contentType:response.headers.get('content-type'),contentEncoding:response.headers.get('content-encoding'),
  etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),
  bodyRepresentation:'Fetch response body bytes; content encoding, if any, has been decoded by the runtime. No separate wire-byte claim.',
  redirects};
 let error=null;
 if(!response.ok)error={code:'COOPS_HTTP',message:'NOAA returned HTTP '+response.status+'. The original response remains retained.',status:response.status,retryable:response.status===429||response.status>=500};
 return{body,receipt,error};
}
export function normaliseBundle(input){
 const bytes=typeof input==='string'?Buffer.from(input):Buffer.from(JSON.stringify(input));
 if(bytes.length>64*1024*1024)throw fault('COOPS_IMPORT_CAPACITY','Use a complete source package of at most 64 MiB.',413);
 let bundle;try{bundle=typeof input==='string'?JSON.parse(input):structuredClone(input);}catch{throw fault('COOPS_IMPORT','The source package is not JSON.');}
 if(!plain(bundle)||bundle.schema!=='stellar-forge.coops-capture-package.v1'||!plain(bundle.edition)||!Array.isArray(bundle.responses)||bundle.responses.length>128)throw fault('COOPS_IMPORT','Use the original complete CO-OPS source package.');
 const e=bundle.edition,fields=['schema','workspaceId','captureId','profile','query','planSha256','stationMetadata','metadataUnavailable','pages','failedResponses','coverage','complete','sourcePackageSha256','originalSource'];
 if(e.schema!=='stellar-forge.coops-edition.v1'||!Array.isArray(e.pages)||!Array.isArray(e.failedResponses)||e.pages.length!==bundle.responses.length||!Array.isArray(bundle.failedResponses)||bundle.failedResponses.length!==e.failedResponses.length||e.pages.length+e.failedResponses.length>128)throw fault('COOPS_IMPORT_MANIFEST','The original edition does not match its response manifest.');
 if(hashBytes(Buffer.from(stable(Object.fromEntries(fields.map(k=>[k,e[k]])))))!==e.id||hashBytes(Buffer.from(stable(e.pages.map(r=>({url:r.url,sha256:r.sha256,bytes:r.bytes})))))!==e.sourceSha256)throw fault('COOPS_IMPORT_MANIFEST','The declared edition or accepted source digest changed.');
 const profile=e.profile,query=makeQuery(normaliseStation(profile),e.query),byUrl=new Map(),failedResponses=[];
 if(stable(query)!==stable(e.query))throw fault('COOPS_IMPORT_QUERY','The declared original query does not match its supported source contract.');
 let total=0;
 for(const [index,response]of bundle.responses.entries()){
  if(stable(response.receipt)!==stable(e.pages[index]))throw fault('COOPS_IMPORT_MANIFEST','An accepted response differs from its exact ordered edition receipt.');
  if(!plain(response)||typeof response.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.base64)||!plain(response.receipt))throw fault('COOPS_IMPORT','A source response has no exact native bytes/receipt.');
  const raw=Buffer.from(response.base64,'base64'),r=response.receipt;allowedUrl(r.url);
  if(raw.length>32*1024*1024||(total+=raw.length)>256*1024*1024||raw.length!==r.bytes||hashBytes(raw)!==r.sha256||byUrl.has(r.url))throw fault('COOPS_IMPORT_IDENTITY','The original source bytes, size, URL or digest changed.');
  if(r.statusObserved!==null&&r.statusObserved!==undefined&&(!Number.isInteger(r.statusObserved)||r.statusObserved<100||r.statusObserved>599))throw fault('COOPS_IMPORT_TRANSPORT','Keep an actual HTTP status or an explicit unavailable status.');
  byUrl.set(r.url,{body:raw,receipt:{...r,imported:true}});
 }
 for(const [index,response]of bundle.failedResponses.entries()){
  if(!plain(response)||!plain(response.receipt)||stable(response.receipt)!==stable(e.failedResponses[index])||typeof response.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.base64))throw fault('COOPS_IMPORT_MANIFEST','A failed original attempt differs from its retained receipt.');
  const body=Buffer.from(response.base64,'base64'),r=response.receipt;allowedUrl(r.url);
  if(body.length!==r.bytes||hashBytes(body)!==r.sha256||body.length>32*1024*1024||(total+=body.length)>256*1024*1024)throw fault('COOPS_IMPORT_IDENTITY','The original failed response bytes changed.');
  failedResponses.push({body,receipt:r});
 }
 if(!byUrl.has(stationTask(query).url))throw fault('COOPS_IMPORT_STATION','The original station response is absent.');
 return{bundle,profile,query,responses:byUrl,failedResponses,bytes,annotations:Array.isArray(bundle.annotations)?bundle.annotations:[]};
}
export function importedResponse(bundle,task){
 const found=bundle.responses.get(task.url);if(!found)throw fault('COOPS_IMPORT_MISSING','The selected original package does not contain this exact task URL. No network fallback was made.',422,{retryable:false});
 const status=found.receipt.statusObserved,error=status>=400?{code:'COOPS_HTTP',message:'The original imported response has HTTP '+status+'.',status,retryable:false}:null;
 return{...found,error};
}
