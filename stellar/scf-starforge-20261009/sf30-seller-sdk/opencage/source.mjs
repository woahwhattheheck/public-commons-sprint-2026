// MIT. Native provider bytes via the original SF30 upstream transport.
import { createUpstreamHandlers } from '../upstream.mjs';
import { UPSTREAM_ATTEMPT } from '../upstream-handler.mjs';
import { compileGeocodePlan, productFor, bindGeocodeQuery, queryParameters,
  handlerName, API_ORIGIN, API_PATH, PARAMETERS, object, fail } from './config.mjs';

const ERROR_STATES = new Map([[400,'INVALID_REQUEST'],[401,'AUTH_REQUIRED'],[402,'QUOTA_EXCEEDED'],
  [403,'DISABLED_OR_IP_DENIED'],[404,'ENDPOINT_NOT_FOUND'],[405,'METHOD_NOT_ALLOWED'],
  [408,'PROVIDER_TIMEOUT'],[410,'QUERY_TOO_LONG'],[426,'TLS_REQUIRED'],[429,'RATE_LIMITED'],[503,'PROVIDER_UNAVAILABLE']]);
export function providerState(status, count = null) {
  return status === 200 ? (count === 0 ? 'NO_RESULTS' : 'CANDIDATES') : ERROR_STATES.get(status) ?? 'PROVIDER_ERROR';
}
export function readGeocodeResponse(bytes, { httpStatus = 200, mode = null, query = {} } = {}) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { fail('GEOCODE_PROVIDER_JSON_INVALID'); }
  if (!object(value) || !object(value.status) || !Number.isInteger(value.status.code) ||
      typeof value.status.message !== 'string' || value.status.code !== httpStatus)
    fail('GEOCODE_PROVIDER_STATUS_INVALID');
  if (httpStatus !== 200) return {value,candidates:[],state:providerState(httpStatus),
    semantics:{httpStatus,providerStatus:value.status,rate:value.rate ?? null,licenses:value.licenses ?? [],
      coordinateReferenceSystem:'EPSG:4326',responseContainsCandidates:false}};
  if (!Array.isArray(value.results) || !Number.isSafeInteger(value.total_results) ||
      value.total_results !== value.results.length || value.results.length > 100 ||
      mode === 'reverse' && value.results.length > 1 ||
      mode === 'forward' && value.results.length > Number(query.limit ?? 10))
    fail('GEOCODE_PROVIDER_RESULTS_INVALID');
  for (const candidate of value.results) {
    if (!object(candidate) || typeof candidate.formatted !== 'string' || !object(candidate.geometry) ||
        !Number.isFinite(candidate.geometry.lat) || Math.abs(candidate.geometry.lat) > 90 ||
        !Number.isFinite(candidate.geometry.lng) || Math.abs(candidate.geometry.lng) > 180 ||
        !Number.isInteger(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 10)
      fail('GEOCODE_PROVIDER_CANDIDATE_INVALID');
  }
  if (value.licenses !== undefined && (!Array.isArray(value.licenses) ||
      value.licenses.some(item => !object(item)))) fail('GEOCODE_PROVIDER_LICENSE_INVALID');
  return {value,candidates:value.results,state:providerState(200,value.results.length),semantics:{
    httpStatus,providerStatus:value.status,returnedCandidates:value.results.length,
    coordinateReferenceSystem:'EPSG:4326',coordinateOrder:{query:'latitude,longitude',geojson:'longitude,latitude'},
    ordering:'PROVIDER_RELEVANCE_ORDER',confidenceMeaning:'SPATIAL_PRECISION_NOT_CORRECTNESS',
    rate:value.rate ?? null,ratePresence:Object.hasOwn(value,'rate') ? 'SUPPLIED' : 'ABSENT',
    licenses:value.licenses ?? [],timestamp:value.timestamp ?? null,
  }};
}
const failure = (status,code,extra = {},headers = {}) => ({
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers},
  body:{error:code,...extra},
});
export function createOpenCageSource(raw,{env=process.env,lookup,clock=Date.now}={}) {
  const plan=compileGeocodePlan(raw),bindings={};
  for (const product of plan.products) bindings[handlerName(product.id)] = {
    origin:API_ORIGIN,path:API_PATH,method:'GET',query:[...PARAMETERS[product.mode],'key'],
    responseHeaders:['content-type'],
    responseMode:'json',timeoutMs:plan.timeoutMs,maxResponseBytes:plan.maxResponseBytes,maxInFlight:1,
  };
  const native=createUpstreamHandlers({schema:'stellar-forge.seller-upstreams.v1',bindings},
    {...(lookup ? {lookup} : {}),env:{}});
  const totals={started:0,completed:0,failed:0,inFlight:0};
  let closed=false,lastStart=null,last=null;
  const key = () => {
    const value=env[plan.apiKeyEnv];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9]{32}$/.test(value)) fail('GEOCODE_API_KEY_REQUIRED');
    return value;
  };
  function admission() {
    if (closed) return failure(503,'GEOCODE_SOURCE_CLOSED');
    try { key(); } catch { return failure(503,'GEOCODE_API_KEY_REQUIRED'); }
    if (totals.inFlight) return failure(503,'GEOCODE_SOURCE_BUSY',{}, {'retry-after':'1'});
    const remaining=lastStart === null ? 0 : lastStart+plan.minIntervalMs-clock();
    if (remaining>0) return failure(429,'GEOCODE_LOCAL_RATE_LIMIT',{},
      {'retry-after':String(Math.max(1,Math.ceil(remaining/1000)))});
    return true;
  }
  function bindContext(product,context) {
    if (!object(context) || context.method !== 'GET' || !(context.url instanceof URL) ||
        context.url.pathname !== product.path || context.bodyPresent === true ||
        context.pathParams && Object.keys(context.pathParams).length) fail('GEOCODE_REQUEST_INVALID');
    return bindGeocodeQuery(product,context.url.searchParams);
  }
  async function perform(product,context,query) {
    const accepted=admission();
    if (accepted !== true) return {response:accepted,observation:{dispatched:false,providerStatus:null,
      state:accepted.body.error,bodyOrigin:'ORIGINAL_SF30_APPLICATION_ERROR',query,productId:product.id}};
    const outgoing=new URL(context.url);outgoing.search='';
    for (const [name,value] of Object.entries(query)) outgoing.searchParams.set(name,value);
    // The credential exists only in this private outgoing context. Neither the
    // original transport's snapshot nor the retained operation sees this URL.
    outgoing.searchParams.set('key',key());
    lastStart=clock();totals.started++;totals.inFlight++;
    const startedAt=new Date(lastStart).toISOString();
    let response,attempt,providerBody=null,semantics=null,bodyOrigin='ORIGINAL_SF30_APPLICATION_ERROR',state;
    try {
      response=await native[handlerName(product.id)]({...context,url:outgoing});
      attempt=response[UPSTREAM_ATTEMPT] ?? null;
      if (response.status === 200) {
        try {
          if (!(response.body instanceof Uint8Array)) fail('GEOCODE_PROVIDER_BODY_INVALID');
          const parsed=readGeocodeResponse(response.body,{mode:product.mode,query});
          semantics=parsed.semantics;state=parsed.state;bodyOrigin='OPENCAGE_NATIVE_JSON';
          response={...response,headers:{...response.headers,'cache-control':'no-store'}};
        } catch(error) { providerBody=response.body instanceof Uint8Array ? Buffer.from(response.body) : null;
          response=failure(502,error.code ?? 'GEOCODE_PROVIDER_RESPONSE_INVALID');state=response.body.error; }
      } else {
        const status=attempt?.upstreamStatus ?? (attempt?.dispatched ? attempt.status : null);
        state=Number.isInteger(status) ? providerState(status) : response.body?.error ?? 'TRANSPORT_ERROR';
      }
      if(response.status !== 200) totals.failed++;
      last={productId:product.id,startedAt,finishedAt:new Date(clock()).toISOString(),
        status:response.status,providerStatus:attempt?.upstreamStatus ?? (bodyOrigin === 'OPENCAGE_NATIVE_JSON' ? 200 : null),state};
      return {response,...(providerBody?{providerBody}:{}),observation:{...last,providerUrl:API_ORIGIN+API_PATH,query,mode:product.mode,
        dispatched:attempt?.dispatched === true,bodyOrigin,semantics,
        transport:attempt ? {dispatched:attempt.dispatched,status:attempt.status,
          upstreamStatus:attempt.upstreamStatus ?? null,error:attempt.error ?? null} : null}};
    } finally { outgoing.searchParams.delete('key');totals.inFlight--;totals.completed++; }
  }
  const handlers={};
  for(const product of plan.products) {
    handlers[handlerName(product.id,true)] = context => {
      try {bindContext(product,context);return admission();}
      catch(error){return failure(422,error.code ?? 'GEOCODE_REQUEST_INVALID');}
    };
    const handler=async context=>{
      let query;
      try {query=bindContext(product,context);}
      catch(error){return failure(422,error.code ?? 'GEOCODE_REQUEST_INVALID');}
      return (await perform(product,context,query)).response;
    };
    handler.snapshot=()=>native[handlerName(product.id)].snapshot();
    handlers[handlerName(product.id)]=handler;
  }
  return Object.freeze({plan,handlers:Object.freeze(handlers),
    inspect(){return {...totals,closed,keyConfigured:typeof env[plan.apiKeyEnv] === 'string' &&
      /^[a-zA-Z0-9]{32}$/.test(env[plan.apiKeyEnv]),minIntervalMs:plan.minIntervalMs,last:last && {...last}};},
    close(){closed=true;},
    async capture(productId,input,{signal}={}) {
      const product=productFor(plan,productId),query=bindGeocodeQuery(product,input);
      const url=new URL(product.path,'https://operator.invalid');url.search=queryParameters(query).toString();
      return perform(product,{method:'GET',url,headers:{},pathParams:{},bodyPresent:false,...(signal?{signal}:{})},query);
    },
  });
}
