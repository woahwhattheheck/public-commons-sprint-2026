// MIT. Original SF30 provider transport and native merchant; only weather policy is added.
import {native} from './runtime.mjs';
import {SCHEMA,FAMILIES,QUERY_NAMES,MAX_RESPONSE_BYTES,providerProfile,providerUrl,requestFromQuery,
 publicQuery,parsePayload,normalizeRequest,need,keys,clone,ATTRIBUTION} from './contract.mjs';
const {normalizeSellerPaymentOptions}=await native('sf30-seller-sdk/seller.mjs');
const {createUpstreamHandlers,closeUpstreamHandlers}=await native('sf30-seller-sdk/upstream.mjs');
export function compileProduct(input){
 keys(input,['schema','publicOrigin','provider','payment','prices','maxInFlight']);
 need(input.schema===SCHEMA,'WEATHER_PRODUCT_SCHEMA_INVALID');const provider=providerProfile(input.provider);
 if(input.publicOrigin!==undefined){const u=new URL(input.publicOrigin);need(u.protocol==='https:'&&u.origin===input.publicOrigin&&!u.username&&!u.password,'PUBLIC_ORIGIN_INVALID');}
 need(input.prices&&Object.keys(input.prices).length===3&&Object.keys(FAMILIES).every(k=>Object.hasOwn(input.prices,k)),'THREE_WEATHER_PRICES_REQUIRED');
 const maxInFlight=input.maxInFlight??4;need(Number.isSafeInteger(maxInFlight)&&maxInFlight>=1&&maxInFlight<=32,'SOURCE_CONCURRENCY_INVALID');
 const routes=[],bindings={};const today=new Date().toISOString().slice(0,10);
 for(const [family,f]of Object.entries(FAMILIES)){
  const payment=normalizeSellerPaymentOptions({payment:{...input.payment,amount:input.prices[family]}})[0];
  need((payment.extra?.paymentFlow??'authorization')==='authorization','WEATHER_BUFFERED_AUTHORIZATION_REQUIRED');
  const example=normalizeRequest({family,model:f.model,latitude:40.7128,longitude:-74.006,timezone:'America/New_York',
   startDate:family==='history'?'2026-03-07':today,endDate:family==='history'?'2026-03-09':today,
   variables:['temperature_2m','precipitation','wind_speed_10m'],units:{temperature:'celsius',wind:'kmh',precipitation:'mm'},cellSelection:'land'});
  const qp=publicQuery(example),handler=f.operation;
  routes.push({id:f.operation,path:f.merchantPath,handler,admit:'admit'+handler[0].toUpperCase()+handler.slice(1),
   definition:{method:'GET',serviceName:'Weather operations',tags:['weather','operations','data'],
    description:f.meaning+' Exact site, selected model, '+f.maxDays+'-day maximum window and hourly variables are reviewed before use.',
    queryParameters:[...[...qp].map(([name,value])=>({name,type:'string',description:name.replaceAll('_',' '),required:true,example:value})),{name:'elevation',type:'string',description:'Explicit site elevation in metres, or nan to disable elevation downscaling.',required:false,example:'10'}],
    outputExample:{latitude:40.71,longitude:-74.01,timezone:'America/New_York',utc_offset_seconds:-14400,
     hourly_units:{time:'unixtime',temperature_2m:'°C'},hourly:{time:[1772928000],temperature_2m:[8]}},payment}});
  const origin=new URL(providerUrl(example,provider)).origin;
  bindings[handler]={origin,path:f.path,method:'GET',query:[...QUERY_NAMES,...(provider.mode==='professional'?['apikey']:[])],
   requestHeaders:[],responseHeaders:['content-type'],responseMode:'bytes',timeoutMs:90000,maxResponseBytes:MAX_RESPONSE_BYTES,maxInFlight,
   availability:{failureThreshold:3,resetAfterMs:30000,maxResetAfterMs:300000}};
 }
 return {product:clone(input),provider,service:{schema:'stellar-forge.seller-service.v1',...(input.publicOrigin?{publicOrigin:input.publicOrigin}:{}),
  handlerTimeoutMs:100000,requestTimeoutMs:120000,routes},upstreams:{schema:'stellar-forge.seller-upstreams.v1',bindings}};
}
export function createWeatherMerchant(input,{env=process.env,sourceOrigins,allowLoopbackSource=false}={}){
 const compiled=compileProduct(input);
 if(sourceOrigins!==undefined){
  need(allowLoopbackSource===true,'EXPLICIT_LOCAL_SOURCE_EXERCISE_REQUIRED');keys(sourceOrigins,Object.keys(FAMILIES));
  for(const [family,origin]of Object.entries(sourceOrigins)){
   const u=new URL(origin);need(u.origin===origin&&u.protocol==='http:'&&u.hostname==='127.0.0.1','LOCAL_SOURCE_ORIGIN_INVALID');
   compiled.upstreams.bindings[FAMILIES[family].operation].origin=origin;
  }
 }
 // Resolve only the declared host credential. It is absent from every public
 // request/offer/capture identity, and cannot be supplied by the buyer.
 let key;if(compiled.provider.mode==='professional'){
  const example={family:'forecast',latitude:0,longitude:0,timezone:'UTC',startDate:'2026-10-11',endDate:'2026-10-11',variables:['temperature_2m']};
  key=providerUrl(example,compiled.provider,{env,credential:true}).searchParams.get('apikey');
 }
 const upstreams=createUpstreamHandlers(compiled.upstreams,{env,allowLoopback:allowLoopbackSource}),handlers={};
 for(const [family,f]of Object.entries(FAMILIES)){
  const original=upstreams[f.operation],invalid=error=>({status:400,headers:{'content-type':'application/json'},body:{error:error.code??'WEATHER_REQUEST_INVALID'}});
  const prepare=context=>{
   need(context.method==='GET'&&context.url instanceof URL,'WEATHER_GET_REQUIRED');
   const request=requestFromQuery(family,context.url.searchParams),url=new URL(context.url);
   if(key!==undefined)url.searchParams.set('apikey',key);
   return {request,context:{...context,url}};
  };
  handlers['admit'+f.operation[0].toUpperCase()+f.operation.slice(1)]=context=>{
   try{const selected=prepare(context);return original.admit?.(selected.context)??true;}catch(error){return invalid(error);}
  };
  handlers[f.operation]=async context=>{
   let selected;try{selected=prepare(context);}catch(error){return invalid(error);}
   const result=await original(selected.context);if(result.status!==200)return result;
   try{parsePayload(result.body,selected.request);}catch(error){return {status:502,headers:{'content-type':'application/json'},body:{error:error.code??'WEATHER_SOURCE_CONTRACT_FAILED'}};}
   return {...result,headers:{...result.headers,'content-type':'application/json; charset=utf-8',
    'x-weather-provider':'Open-Meteo','x-weather-family':family,'x-weather-retrieved-at':new Date().toISOString(),
    link:'<'+ATTRIBUTION.url+'>; rel="author", <'+ATTRIBUTION.licenceUrl+'>; rel="license"'}};
  };
 }
 return {config:compiled.service,handlers,compiled,snapshot:()=>({providerMode:compiled.provider.mode,
  operations:Object.fromEntries(Object.entries(upstreams).map(([k,h])=>[k,h.snapshot()]))}),close:()=>closeUpstreamHandlers(upstreams)};
}
