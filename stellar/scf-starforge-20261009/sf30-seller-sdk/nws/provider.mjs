// MIT. Read the actual NWS resource graph and retain source response bodies.
import {createHash} from 'node:crypto';
import {stable} from '../stellar-expert/store.mjs';
import {PRODUCTS,SOURCE_CONTRACT} from './schema.mjs';
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export function fault(code,message,status=400,extra={}){return Object.assign(new Error(message),{code,status,...extra});}
export const text=(value,label,max=200,empty=false)=>{
  if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw fault('NWS_INPUT','Enter '+label+'.');
  return value.trim();
};
export function normaliseSite(input){
  const number=(value,min,max,label)=>{const n=typeof value==='number'?value:Number(value);
    if(value===null||value===''||typeof value==='boolean'||!Number.isFinite(n)||n<min||n>max)
      throw fault('NWS_COORDINATE','Enter a valid '+label+'.');
    return Number(n.toFixed(4));};
  const stationId=text(input.stationId??input.station??'','an observation station identifier',16,true).toUpperCase();
  if(stationId&&!/^[A-Z0-9]{3,12}$/.test(stationId))throw fault('NWS_STATION','Use an identifier from the site’s observation station catalog.');
  if(input.active!==undefined&&typeof input.active!=='boolean')throw fault('NWS_INPUT','Site activity must be a boolean.');
  return {label:text(input.label,'a site name'),latitude:number(input.latitude,-90,90,'latitude'),
    longitude:number(input.longitude,-180,180,'longitude'),stationId,
    owner:text(input.owner??'','a site owner',240,true),note:text(input.note??'','a site note',12000,true),active:input.active!==false};
}
export const pointString=site=>site.latitude+','+site.longitude;
export function sourceUrl(value){
  let u;try{u=new URL(value);}catch{throw fault('NWS_SOURCE_URL','The source returned an invalid resource URL.',502);}
  if(u.protocol!=='https:'||u.hostname!=='api.weather.gov'||u.port||u.username||u.password||u.hash)
    throw fault('NWS_SOURCE_URL','Use an original api.weather.gov HTTPS resource.',502);
  return u.href;
}
export function urlKey(value){const u=new URL(sourceUrl(value));u.searchParams.sort();return u.href;}
export function validateTaskUrl(kind,value,{stationId}={}){
  const url=sourceUrl(value),path=new URL(url).pathname;
  const patterns={
    point:/^\/points\/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/,
    forecast:/^\/gridpoints\/[A-Z0-9]{3,6}\/\d+,\d+\/forecast$/,
    hourly:/^\/gridpoints\/[A-Z0-9]{3,6}\/\d+,\d+\/forecast\/hourly$/,
    grid:/^\/gridpoints\/[A-Z0-9]{3,6}\/\d+,\d+$/,
    stations:/^(?:\/gridpoints\/[A-Z0-9]{3,6}\/\d+,\d+\/stations|\/stations)$/,
    observations:/^\/stations\/[A-Za-z0-9]{3,12}\/observations$/,
    'active-alerts':/^\/alerts(?:\/.*)?$/,alerts:/^\/alerts(?:\/.*)?$/
  };
  if(!patterns[kind]?.test(path))throw fault('NWS_SOURCE_SCOPE','The returned resource differs from this capture’s '+kind+' selection.',502);
  if(kind==='observations'&&stationId&&path.split('/')[2].toUpperCase()!==stationId)
    throw fault('NWS_SOURCE_SCOPE','The observation continuation changed station.',502);
  return url;
}
function instant(value,label){if(typeof value!=='string'||!/\dT\d/.test(value)||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))
  throw fault('NWS_TIME','Use an ISO8601 '+label+' with a UTC offset.');return new Date(value).toISOString();}
export function makeQuery(site,input={},createdAt=new Date().toISOString()){
  const products=input.products??PRODUCTS;
  if(!Array.isArray(products)||!products.length||products.some(p=>!PRODUCTS.includes(p))||new Set(products).size!==products.length)
    throw fault('NWS_PRODUCTS','Choose distinct listed weather products.');
  const observationEnd=instant(input.observationEnd??createdAt,'observation end time'),
    observationStart=instant(input.observationStart??new Date(Date.parse(observationEnd)-86400000).toISOString(),'observation start time');
  if(Date.parse(observationStart)>=Date.parse(observationEnd))throw fault('NWS_TIME','Observation start must precede its end.');
  if(!['us','si'].includes(input.units??'us'))throw fault('NWS_UNITS','Choose us or si forecast units.');
  return {latitude:site.latitude,longitude:site.longitude,stationId:site.stationId??'',
    products:[...PRODUCTS.filter(p=>products.includes(p))],units:input.units??'us',observationStart,observationEnd,
    initialUrls:input.initialUrls??{},pointUrl:'https://api.weather.gov/points/'+pointString(site)};
}
export function pointPlan(body,query){
  const properties=body.properties;
  const task=(kind,url)=>url?{kind,url:validateTaskUrl(kind,url),state:'PENDING',pages:[],termination:null}:
    {kind,url:null,state:'UNAVAILABLE',pages:[],termination:'The current point response does not expose this resource.'};
  const withUnits=url=>{if(!url||query.units==='us')return url;const u=new URL(url);u.searchParams.set('units',query.units);return u.href;};
  const tasks=[];
  for(const [product,property]of [['forecast','forecast'],['hourly','forecastHourly'],['grid','forecastGridData']])
    if(query.products.includes(product))tasks.push(task(product,product==='grid'?properties[property]:withUnits(properties[property])));
  tasks.push(task('stations',properties.observationStations));
  if(query.products.includes('alerts')){
    const point=pointString(query),active='https://api.weather.gov/alerts/active?point='+point;
    const history=query.initialUrls.alerts??'https://api.weather.gov/alerts?point='+point+'&limit=500';
    if(new URL(history).searchParams.get('point')!==point)throw fault('NWS_SOURCE_SCOPE','The imported alert history belongs to another point.',409);
    tasks.push(task('active-alerts',active),task('alerts',history));
  }
  return {tasks,mapping:{gridId:properties.gridId??properties.cwa??null,gridX:properties.gridX??null,gridY:properties.gridY??null,
    timeZone:properties.timeZone??null,forecastOffice:properties.forecastOffice??null,forecastZone:properties.forecastZone??null,
    county:properties.county??null,fireWeatherZone:properties.fireWeatherZone??null,relativeLocation:properties.relativeLocation??null,
    forecast:properties.forecast??null,forecastHourly:properties.forecastHourly??null,
    forecastGridData:properties.forecastGridData??null,observationStations:properties.observationStations??null}};
}
export function observationUrl(query,stationId){
  if(query.initialUrls.observations){
    const u=new URL(validateTaskUrl('observations',query.initialUrls.observations,{stationId}));
    if(instant(u.searchParams.get('start'),'observation start')!==query.observationStart||
       instant(u.searchParams.get('end'),'observation end')!==query.observationEnd)
      throw fault('NWS_SOURCE_SCOPE','The imported observations differ from their stated interval.',409);
    return u.href;
  }
  const u=new URL('https://api.weather.gov/stations/'+stationId+'/observations');
  u.searchParams.set('start',query.observationStart);u.searchParams.set('end',query.observationEnd);u.searchParams.set('limit','500');
  return u.href;
}
export function decodeSource(body,kind,query,receipt){
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
  catch{throw fault('NWS_SOURCE_JSON','The retained response is not complete UTF-8 JSON.',502);}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fault('NWS_SOURCE_SHAPE','The provider returned an unexpected document.',502);
  const collection=['stations','observations','alerts','active-alerts'].includes(kind);
  if(collection&&(data.type!=='FeatureCollection'||!Array.isArray(data.features)))
    throw fault('NWS_SOURCE_SHAPE','The provider did not return a GeoJSON feature collection for '+kind+'.',502);
  if(!collection&&(data.type!=='Feature'||!data.properties||typeof data.properties!=='object'))
    throw fault('NWS_SOURCE_SHAPE','The provider did not return a GeoJSON feature for '+kind+'.',502);
  if(['forecast','hourly'].includes(kind)&&!Array.isArray(data.properties.periods))
    throw fault('NWS_SOURCE_SHAPE','The forecast response has no complete periods array.',502);
  const features=collection?data.features:[];
  if(features.some(f=>!f||f.type!=='Feature'||!f.properties||typeof f.properties!=='object'))
    throw fault('NWS_SOURCE_SHAPE','A source feature has an invalid shape.',502);
  let next=data.pagination?.next??null,termination=next?null:'SOURCE_CONTINUATION_EXHAUSTED';
  if(next!==null&&typeof next!=='string')throw fault('NWS_SOURCE_PAGING','The provider continuation is not a URL.',502);
  const unusedNext=next;
  if(collection&&!features.length){next=null;termination='EMPTY_SOURCE_PAGE';}
  if(kind==='observations'&&features.length){
    const stamps=features.map(f=>Date.parse(f.properties.timestamp)),valid=stamps.every(Number.isFinite),
      descending=valid&&stamps.every((t,i)=>i===0||t<=stamps[i-1]);
    if(descending&&Math.min(...stamps)<=Date.parse(query.observationStart)){next=null;termination='REQUESTED_START_REACHED';}
  }
  if(next)next=validateTaskUrl(kind,next,{stationId:receipt.stationId??query.stationId});
  const records=collection?features.length:['forecast','hourly'].includes(kind)?data.properties.periods.length:
    kind==='grid'?Object.values(data.properties).reduce((sum,p)=>sum+(Array.isArray(p?.values)?p.values.length:0),0):1;
  return {data,features,records,nextUrl:next,unusedNext:next===null?unusedNext:null,termination};
}
export function retryTime(value,now=Date.now()){
  if(typeof value!=='string'||!value.trim())return null;
  const ms=/^\d+(?:\.\d+)?$/.test(value)?now+Number(value)*1000:Date.parse(value);
  return Number.isFinite(ms)?new Date(Math.max(now,ms)).toISOString():null;
}
async function bytesOf(response,max){
  const chunks=[];let length=0;
  if(!response.body)return Buffer.alloc(0);
  for await(const chunk of response.body){const b=Buffer.from(chunk);length+=b.length;
    if(length>max)throw fault('NWS_SOURCE_SIZE','The source response exceeds32 MiB. Its request can be narrowed.',413);
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
export async function fetchNwsResponse(task,{query,userAgent,fetchImpl=fetch,signal,cached}={}){
  const requested=validateTaskUrl(task.kind,task.url,{stationId:task.stationId??query.stationId});
  text(userAgent,'an identifying User-Agent',512);
  const startedAt=new Date().toISOString(),redirects=[],headers={'User-Agent':userAgent,Accept:'application/geo+json'};
  if(cached?.etag)headers['If-None-Match']=cached.etag;
  if(cached?.lastModified)headers['If-Modified-Since']=cached.lastModified;
  let url=requested,response,wire=Buffer.alloc(0);
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  for(let n=0;n<9;n++){
    try{response=await fetchImpl(url,{method:'GET',headers,redirect:'manual',signal:combined});}
    catch(error){
      if(error.name==='AbortError'||error.name==='TimeoutError')throw error;
      throw fault('NWS_SOURCE_TRANSPORT','The NWS HTTPS request could not complete. Resume this capture when the source connection is available.',503,{retryable:true});
    }
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location'),next=location?sourceUrl(new URL(location,url).href):null;
      redirects.push({url,status:response.status,headers:Object.fromEntries(response.headers)});
      await response.body?.cancel().catch(()=>{});
      if(!next||redirects.some(r=>r.url===next))throw fault('NWS_SOURCE_REDIRECT','The source redirects do not reach a distinct weather resource.',502);
      url=validateTaskUrl(task.kind,next,{stationId:task.stationId??query.stationId});continue;
    }
    break;
  }
  if(!response||[301,302,303,307,308].includes(response.status))throw fault('NWS_SOURCE_REDIRECT','The source exceeded eight redirects.',502);
  wire=await bytesOf(response,32*1024*1024);
  const finishedAt=new Date().toISOString(),observedHeaders=Object.fromEntries(response.headers),status=response.status;
  let body=wire,sourceObservedAt=finishedAt;
  if(status===304){
    if(!cached?.body)throw fault('NWS_CACHE_SOURCE','The source revalidated a body that is not retained.',409);
    body=cached.body;sourceObservedAt=cached.sourceObservedAt??cached.finishedAt??null;
  }
  const receipt={url:requested,effectiveUrl:url,method:'GET',status,statusObserved:true,
    headers:observedHeaders,headersObserved:true,redirects,requestHeaders:headers,
    transport:'native-https',bodyRepresentation:'decoded-http-response-bytes',startedAt,finishedAt,
    sourceObservedAt,bytes:body.length,sha256:hashBytes(body),responseBytes:wire.length,responseSha256:hashBytes(wire),
    revalidated:status===304,revalidationSource:status===304?cached.sha256:null,
    etag:response.headers.get('etag')??(status===304?cached.etag:null),
    lastModified:response.headers.get('last-modified')??(status===304?cached.lastModified:null)};
  let error=null;
  if(status!==304&&(status<200||status>=300)){
    let problem;try{problem=JSON.parse(wire.toString('utf8'));}catch{}
    const retryAt=retryTime(response.headers.get('retry-after'))??(status===429?new Date(Date.now()+60000).toISOString():null);
    error={code:status===429?'NWS_RATE_LIMIT':'NWS_PROVIDER_RESPONSE',
      message:typeof problem?.detail==='string'?problem.detail.slice(0,1000):'The provider returned HTTP'+status+'.',
      status,retryAt,retryable:status===429||status>=500};
  }
  return {body,wire,receipt,error};
}
function sourcePage(entry,container){
  const requestUrl=sourceUrl(entry.request?.url??entry.url??entry.receipt?.url),
    meta=entry.response??entry.receipt??entry;
  let body;
  if(typeof entry.body==='string')body=Buffer.from(entry.body,'utf8');
  else if(typeof entry.bodyBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.bodyBase64))
    body=Buffer.from(entry.bodyBase64,'base64');
  else throw fault('NWS_SOURCE_IMPORT','A source page requires its complete body text or base64 bytes.');
  if(body.length>32*1024*1024||meta.bytes!==undefined&&meta.bytes!==body.length||
     meta.sha256!==undefined&&meta.sha256!==hashBytes(body))
    throw fault('NWS_SOURCE_IMPORT','A source page differs from its recorded byte count or SHA-256.',409);
  let wire=body;
  if(entry.wireBase64!==undefined){
    if(typeof entry.wireBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.wireBase64))
      throw fault('NWS_SOURCE_IMPORT','The retained wire response must contain complete base64 bytes.');
    wire=Buffer.from(entry.wireBase64,'base64');
  }
  if(wire.length>32*1024*1024||meta.responseBytes!==undefined&&meta.responseBytes!==wire.length||
     meta.responseSha256!==undefined&&meta.responseSha256!==hashBytes(wire))
    throw fault('NWS_SOURCE_IMPORT','The wire response differs from its recorded byte count or SHA-256.',409);
  const status=meta.status??null,headers=meta.headers??null;
  if(status!==null&&(!Number.isInteger(status)||status<100||status>599))throw fault('NWS_SOURCE_IMPORT','The source status is invalid.');
  if(headers!==null&&(!headers||typeof headers!=='object'||Array.isArray(headers)||
     Object.entries(headers).some(([k,v])=>typeof v!=='string'||/[\r\n]/.test(k+v))))
    throw fault('NWS_SOURCE_IMPORT','The source response headers are invalid.');
  return {url:requestUrl,bodyBase64:body.toString('base64'),wireBase64:wire.toString('base64'),receipt:{
    url:requestUrl,effectiveUrl:sourceUrl(meta.effectiveUrl??meta.url??requestUrl),method:'GET',
    status,statusObserved:meta.statusObserved??status!==null,headers,headersObserved:meta.headersObserved??headers!==null,
    bodyRepresentation:meta.bodyRepresentation??'retained-source-response',
    transport:meta.transport??container.captureInterface??'retained-source-package',
    sourceObservedAt:meta.sourceObservedAt??meta.finishedAt??entry.observedAt??null,
    capturedOn:meta.capturedOn??container.capturedOn??null,startedAt:meta.startedAt??null,finishedAt:meta.finishedAt??null,
    bytes:body.length,sha256:hashBytes(body),responseBytes:wire.length,responseSha256:hashBytes(wire),
    revalidated:meta.revalidated??status===304,revalidationSource:meta.revalidationSource??null,
    originalSourceId:entry.id??null,sourceFile:entry.file??null,
    etag:meta.etag??headers?.etag??null,lastModified:meta.lastModified??headers?.['last-modified']??null,
    original:meta
  }};
}
export function normaliseBundle(bundle){
  if(!bundle||typeof bundle!=='object'||!['commons.nws-source-capture.v1','stellar-forge.nws-capture-package.v1'].includes(bundle.schema))
    throw fault('NWS_SOURCE_IMPORT','Choose a retained NWS capture package.');
  const site=normaliseSite(bundle.site),entries=bundle.pages??bundle.responses;
  if(!Array.isArray(entries)||!entries.length||entries.length>2000)throw fault('NWS_SOURCE_IMPORT','The source package must contain one to2000 original responses.');
  const pages=entries.map(entry=>sourcePage(entry,bundle));
  if(pages.reduce((sum,p)=>sum+p.receipt.bytes,0)>256*1024*1024)throw fault('NWS_SOURCE_IMPORT','The source package exceeds256 MiB.');
  const keys=new Set();for(const page of pages){const k=urlKey(page.url);if(keys.has(k))throw fault('NWS_SOURCE_IMPORT','Use one original response per URL in a source package.');keys.add(k);}
  let selection=bundle.query??{};
  if(bundle.schema==='commons.nws-source-capture.v1'){
    const finite=bundle.coverage?.boundedObservations;
    const observations=finite?.pageIds?.[0]?entries.find(p=>p.id===finite.pageIds[0])?.request?.url:null;
    const alerts=bundle.coverage?.pointAlertHistory?.pageIds?.[0]?entries.find(p=>p.id===bundle.coverage.pointAlertHistory.pageIds[0])?.request?.url:null;
    selection={products:PRODUCTS,units:'us',observationStart:finite?.start,observationEnd:finite?.end,
      initialUrls:{...(observations?{observations}:{}),...(alerts?{alerts}:{})}};
    if(!finite?.start||!finite?.end)throw fault('NWS_SOURCE_IMPORT','The imported observation history requires its original start and end.');
  }
  const query=makeQuery(site,selection,selection.observationEnd);
  if(!keys.has(urlKey(query.pointUrl)))throw fault('NWS_SOURCE_IMPORT','Include the original point discovery response.');
  return {schema:'stellar-forge.nws-capture-package.v1',site,query,pages,
    sourceMetadata:{provider:bundle.provider??SOURCE_CONTRACT.provider,capturedOn:bundle.capturedOn??null,
      captureInterface:bundle.captureInterface??null,bodyProvenance:bundle.bodyProvenance??null,originalSource:bundle.originalSource??bundle.source??null},
    annotations:Array.isArray(bundle.annotations)?bundle.annotations:[]};
}
export function importedResponse(bundle,task){
  const found=bundle.pages.find(p=>urlKey(p.url)===urlKey(task.url));
  if(!found)throw fault('NWS_IMPORT_PAGE_MISSING','The retained source package has no response for '+task.url+'.',409,{retryable:false});
  const body=Buffer.from(found.bodyBase64,'base64'),receipt={...found.receipt,url:task.url,originalRequestUrl:found.url};
  return {body,wire:Buffer.from(found.wireBase64,'base64'),receipt,error:receipt.status!==null&&(receipt.status<200||receipt.status>=300)&&receipt.status!==304?
    {code:'NWS_IMPORTED_PROVIDER_RESPONSE',message:'The source package contains HTTP'+receipt.status+'.',status:502,retryable:false}:null};
}
