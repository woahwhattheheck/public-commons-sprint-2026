import {InputError,clean,day,safeJSON} from './parse.mjs';
import {hash} from './normalise.mjs';
const WQP='https://www.waterqualitydata.us';
const USGS='https://api.waterdata.usgs.gov';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_BYTES=Number(process.env.MEASUREMENTS_FETCH_BYTES)||128*1024*1024;
export function providerQuery(input) {
  const kind=input.kind;
  if(!['wqp','stations','usgs-daily'].includes(kind))throw new InputError('Choose chemistry, stations or USGS daily discharge');
  const from=day(input.from),to=day(input.to);if(from>to)throw new InputError('Start date must be before end date');
  if(kind==='usgs-daily') {
    const station=clean(input.stationId);if(!/^USGS-\d{8,15}$/.test(station))throw new InputError('USGS station must include the USGS- prefix and 8–15 digits');
    const u=new URL('/ogcapi/v0/collections/daily/items',USGS);
    u.search=new URLSearchParams({f:'json',limit:'10000',monitoring_location_id:station,parameter_code:'00060',statistic_id:'00003',datetime:`${from}/${to}`}).toString();
    return {kind,url:u.href,from,to};
  }
  const legacy=input.profile==='legacy',u=new URL(`/${legacy?'data':'wqx3'}/${kind==='stations'?'Station':'Result'}/search`,WQP);
  const date=d=>`${d.slice(5,7)}-${d.slice(8,10)}-${d.slice(0,4)}`;
  const params=new URLSearchParams({mimeType:'csv',zip:'no',sorted:'no',startDateLo:date(from),startDateHi:date(to),sampleMedia:'Water'});
  if(kind==='wqp'&&!legacy)params.set('dataProfile','fullPhysChem');
  if(clean(input.stationId)) params.set('siteid',clean(input.stationId));
  else if(clean(input.huc)) {if(!/^\d{8}$/.test(input.huc))throw new InputError('Provide an eight-digit HUC');params.set('huc',input.huc);}
  else throw new InputError('Provide a monitoring station identifier or an eight-digit HUC');
  if(clean(input.characteristic))params.set('characteristicName',clean(input.characteristic));
  u.search=params.toString();return {kind,url:u.href,from,to,profile:legacy?'WQX2.2':'WQX3.0',warnings:legacy?['Legacy WQP excludes USGS updates after 2024-03-11.']:[]};
}
function allowed(url,kind) {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password)throw new InputError('Provider returned an invalid continuation URL',502);
  if(kind==='usgs-daily' && u.origin===USGS && u.pathname==='/ogcapi/v0/collections/daily/items')return u;
  if(kind!=='usgs-daily'&&['www.waterqualitydata.us','waterqualitydata.us'].includes(u.hostname)&&/^\/(wqx3|data)\/(Result|Station)\/search$/.test(u.pathname))return u;
  throw new InputError('Provider continuation or redirect left the original public-data endpoint',502);
}
async function getText(url,kind,fetcher,signal) {
  allowed(url,kind);
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetcher(url,{headers:{Accept:kind==='usgs-daily'?'application/geo+json, application/json':'text/csv'},redirect:'manual',signal});
    if([429,502,503,504].includes(response.status)&&attempt<2){const retry=response.headers.get('retry-after'),seconds=Number(retry);await pause(Number.isFinite(seconds)?Math.max(0,Math.min(60,seconds))*1000:1000*2**attempt);continue;}
    if(response.status>=300&&response.status<400){const redirect=allowed(new URL(response.headers.get('location'),url).href,kind);const redirected=await fetcher(redirect,{redirect:'error',signal});return consume(redirected);}
    return consume(response);
  }
}
async function consume(response) {
  if(!response.ok)throw new InputError(`Water-data provider returned HTTP ${response.status}. The complete query URL remains available for file retrieval.`,502);
  const reader=response.body?.getReader();let length=0;const chunks=[];
  if(reader)try{while(true){const{value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES)throw new InputError('Provider download exceeds the configured process memory limit; use a narrower date window and import each complete window.',413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)));
  if(bytes[0]===0x50&&bytes[1]===0x4b)throw new InputError('Provider returned a ZIP archive despite zip=no. Extract its complete CSV and use file import.',502);
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new InputError('Provider data is not UTF-8 text',502);}
  if(/^\s*(<!doctype|<html)/i.test(text))throw new InputError('Provider returned an HTML page instead of data; the source has not been imported.',502);
  return {text,sha:hash(bytes),headers:{contentType:response.headers.get('content-type'),warning:response.headers.get('warning'),lastModified:response.headers.get('last-modified')}};
}
export async function fetchProvider(input,{fetcher=fetch,signal}={}) {
  const query=providerQuery(input),visited=new Set(),pages=[];let url=query.url,features=[];
  const timeout=AbortSignal.timeout(Number(process.env.MEASUREMENTS_FETCH_TIMEOUT_MS)||180000);
  const requestSignal=signal?AbortSignal.any([timeout,signal]):timeout;
  while(url) {
    if(visited.has(url))throw new InputError('Provider repeated a pagination link; no partial result was committed',502);
    visited.add(url);const page=await getText(url,query.kind,fetcher,requestSignal);
    pages.push({url,text:page.text,sha:page.sha,headers:page.headers});
    if(query.kind!=='usgs-daily')break;
    const value=safeJSON(page.text);if(value.type!=='FeatureCollection'||!Array.isArray(value.features))throw new InputError('USGS returned an unexpected GeoJSON structure',502);
    for(const f of value.features){const p=f.properties;if(p?.monitoring_location_id!==input.stationId||p?.parameter_code!=='00060'||p?.statistic_id!=='00003'||clean(p.time).slice(0,10)<query.from||clean(p.time).slice(0,10)>query.to)throw new InputError('USGS response contains a record outside the requested station, parameter, statistic or dates',502);}
    features.push(...value.features);
    const next=value.links?.find(x=>x.rel==='next');url=next?allowed(new URL(next.href,url).href,query.kind).href:null;
  }
  const text=query.kind==='usgs-daily'?JSON.stringify({type:'FeatureCollection',features,links:[],numberReturned:features.length}):pages[0].text;
  return {kind:query.kind,label:input.label||`${query.kind}: ${input.stationId||input.huc} ${query.from}–${query.to}`,text,
    origin:{type:'provider',retrievedAt:new Date().toISOString(),query,pages},mapping:input.mapping||{}};
}
