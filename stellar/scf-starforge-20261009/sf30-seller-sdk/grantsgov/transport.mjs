// MIT. Read-only Grants.gov transport; public data slices, receipt hashes, no token custody.
import {SOURCE_VERSION,API_ORIGIN,SEARCH_PATH,DETAIL_PATH,buildSearchRequest,opportunityId,
  canonical,sha,sourceJSON,object,need,fault,jsonMemberSlice,decodeSourceRecord,safeInteger} from './source.mjs';

const SAFE_HEADERS = new Set(['date','content-type','etag','last-modified','retry-after',
  'x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']);
function retainedHeaders(headers) {
  return Object.fromEntries([...new Headers(headers)].filter(([key]) => SAFE_HEADERS.has(key.toLowerCase())));
}
function sanitiseData(text) {
  const payload = sourceJSON(Buffer.from(text));
  need(object(payload), 'GRANTS_PROVIDER_DATA_ABSENT', 'Grants.gov returned no public data object.', 502);
  const redactions = [];
  let clean = text;
  for (const key of ['accessKey','token']) {
    if (payload[key]) {
      const slice = jsonMemberSlice(clean,key);
      need(slice, 'GRANTS_SOURCE_JSON_INVALID');
      clean = clean.slice(0,slice.start) + 'null' + clean.slice(slice.end);
      redactions.push('/data/' + key);
    }
  }
  return {bytes:Buffer.from(clean),originalSha256:sha(Buffer.from(text)),redactions};
}
export function sourceFromResponse({kind,requestBody,requestBytes=null,responseBytes,status=200,
  headers={},startedAt=null,capturedAt=new Date().toISOString(),attempts=[]}) {
  need(['search','detail'].includes(kind), 'GRANTS_SOURCE_KIND_INVALID');
  need(Buffer.isBuffer(responseBytes) || responseBytes instanceof Uint8Array, 'GRANTS_SOURCE_BYTES_REQUIRED');
  const original = Buffer.from(responseBytes);
  need(original.length <= 16 * 1024 * 1024, 'GRANTS_RESPONSE_TOO_LARGE');
  const raw = new TextDecoder('utf-8',{fatal:true}).decode(original);
  let envelope;
  try { envelope = sourceJSON(original); }
  catch (error) { throw fault('GRANTS_RESPONSE_JSON_INVALID','The provider response is not valid JSON.',502,
    {receipt:{status,bodySha256:sha(original),bytes:original.length,capturedAt,headers:retainedHeaders(headers)}}); }
  need(object(envelope), 'GRANTS_RESPONSE_ENVELOPE_INVALID', 'The provider response envelope is invalid.',502);
  const receipt = {status,headers:retainedHeaders(headers),startedAt,capturedAt,
    bodySha256:sha(original),bytes:original.length};
  if (status !== 200 || Number(envelope.errorcode) !== 0 || !object(envelope.data)) {
    const code = status===401 ? 'GRANTS_AUTHENTICATION' : status===403 ? 'GRANTS_PERMISSION' :
      status===429 ? 'GRANTS_RATE_LIMIT' : status===404 || !envelope.data ? 'GRANTS_RECORD_UNAVAILABLE' :
      status>=500 ? 'GRANTS_PROVIDER_UNAVAILABLE' : 'GRANTS_PROVIDER_ERROR';
    throw fault(code,'Grants.gov returned ' + status + ', error code ' + String(envelope.errorcode ?? 'absent') +
      ': ' + String(envelope.msg ?? '').slice(0,500),status >= 400 ? status : 502,
      {receipt,providerErrorCode:envelope.errorcode ?? null});
  }
  const slice = jsonMemberSlice(raw,'data');
  need(slice, 'GRANTS_RESPONSE_DATA_ABSENT', 'The provider data member is absent.',502);
  const data = sanitiseData(slice.text);
  const bodyBytes = requestBytes ? Buffer.from(requestBytes) : Buffer.from(JSON.stringify(requestBody));
  const record = {
    schema:SOURCE_VERSION,kind,
    request:{url:API_ORIGIN+(kind==='search'?SEARCH_PATH:DETAIL_PATH),method:'POST',
      body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bodyBytes)),
      base64:bodyBytes.toString('base64'),sha256:sha(bodyBytes)},
    response:receipt,
    envelope:{errorcode:Number(envelope.errorcode),msg:String(envelope.msg ?? ''),
      excludedFields:['token'],tokenRetained:false},
    data:{base64:data.bytes.toString('base64'),sha256:sha(data.bytes),bytes:data.bytes.length,
      originalSha256:data.originalSha256,byteExact:data.redactions.length===0,redactions:data.redactions,
      wirePointer:'/data'},
    attempts
  };
  need(canonical(record.request.body) === canonical(requestBody), 'GRANTS_REQUEST_BODY_MISMATCH');
  const payload = decodeSourceRecord(record);
  if (kind === 'search' && Array.isArray(payload.errorMsgs) && payload.errorMsgs.length)
    throw fault('GRANTS_SEARCH_REJECTED','The provider rejected one or more search parameters.',422,
      {receipt,providerMessages:payload.errorMsgs.map(v=>String(v).slice(0,500))});
  if (kind === 'detail' && Array.isArray(payload.errorMessages) && payload.errorMessages.length)
    throw fault('GRANTS_DETAIL_REJECTED','The provider reported opportunity errors.',422,
      {receipt,providerMessages:payload.errorMessages.map(v=>String(v).slice(0,500))});
  return {...record,payload};
}
function retryAfter(headers, capturedAt) {
  const value = new Headers(headers).get('retry-after');
  if (!value) return null;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value)*1000 : Date.parse(value)-Date.parse(capturedAt);
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0,Math.ceil(milliseconds));
}
function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(fault('GRANTS_CANCELLED','The capture was paused.',409));
  return new Promise((resolve,reject) => {
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const timer=setTimeout(()=>{cleanup();resolve();},milliseconds);
    const abort=()=>{clearTimeout(timer);cleanup();reject(fault('GRANTS_CANCELLED','The capture was paused.',409));};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
async function readBody(response, maximum, signal) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel(); throw fault('GRANTS_RESPONSE_TOO_LARGE','The provider response exceeds the capture limit.',502);
  }
  if (!response.body?.getReader) {
    const bytes=Buffer.from(await response.arrayBuffer());
    need(bytes.length<=maximum,'GRANTS_RESPONSE_TOO_LARGE');return bytes;
  }
  const reader=response.body.getReader(),parts=[];let total=0;
  try {
    while (true) {
      if (signal?.aborted) throw fault('GRANTS_CANCELLED','The capture was paused.',409);
      const item=await reader.read();if(item.done)break;
      total+=item.value.length;
      need(total<=maximum,'GRANTS_RESPONSE_TOO_LARGE','The provider response exceeds the capture limit.',502);
      parts.push(Buffer.from(item.value));
    }
    return Buffer.concat(parts,total);
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}
export function createGrantsTransport({fetchImpl=globalThis.fetch,timeoutMs=30000,minimumIntervalMs=1000,
  maximumResponseBytes=16*1024*1024,maxAttempts=3,maximumRetryWaitMs=30000,
  userAgent='Starforge-GrantsResearch/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)'}={}) {
  need(typeof fetchImpl==='function','GRANTS_FETCH_REQUIRED');
  safeInteger(timeoutMs,'timeoutMs',1000,120000);
  safeInteger(minimumIntervalMs,'minimumIntervalMs',0,60000);
  safeInteger(maximumResponseBytes,'maximumResponseBytes',1024,16*1024*1024);
  safeInteger(maxAttempts,'maxAttempts',1,5);
  safeInteger(maximumRetryWaitMs,'maximumRetryWaitMs',0,60000);
  let nextAllowed=0, queue=Promise.resolve();
  const run=async(kind,body,{signal}={})=>{
    const attempts=[],requestBytes=Buffer.from(JSON.stringify(body));
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      await wait(Math.max(0,nextAllowed-Date.now()),signal);
      const startedAt=new Date().toISOString(),controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      let response,raw;
      try{
        response=await fetchImpl(API_ORIGIN+(kind==='search'?SEARCH_PATH:DETAIL_PATH),{
          method:'POST',redirect:'error',credentials:'omit',
          headers:{'content-type':'application/json','accept':'application/json','user-agent':userAgent},
          body:requestBytes,signal:combined
        });
        raw=await readBody(response,maximumResponseBytes,combined);
      }catch(error){
        clearTimeout(timer);nextAllowed=Date.now()+minimumIntervalMs;
        if(signal?.aborted)throw fault('GRANTS_CANCELLED','The original capture was paused.',409,{attempts});
        const issue={attempt,startedAt,capturedAt:new Date().toISOString(),
          code:controller.signal.aborted?'GRANTS_TIMEOUT':error.code??'GRANTS_TRANSPORT'};
        attempts.push(issue);
        if(error.code==='GRANTS_RESPONSE_TOO_LARGE')throw Object.assign(error,{attempts});
        if(attempt===maxAttempts)throw fault(issue.code,'The Grants.gov request did not return a complete response.',502,{attempts});
        await wait(Math.min(1000*2**(attempt-1),maximumRetryWaitMs),signal);continue;
      }finally{clearTimeout(timer);}
      const capturedAt=new Date().toISOString();nextAllowed=Date.now()+minimumIntervalMs;
      const receipt={attempt,startedAt,capturedAt,status:response.status,bodySha256:sha(raw),bytes:raw.length,
        headers:retainedHeaders(response.headers)};
      attempts.push(receipt);
      if(response.status===429 || response.status>=500){
        const indicated=retryAfter(response.headers,capturedAt);
        const delay=indicated??Math.min(1000*2**(attempt-1),maximumRetryWaitMs);
        if(attempt<maxAttempts && delay<=maximumRetryWaitMs){await wait(delay,signal);continue;}
        throw fault(response.status===429?'GRANTS_RATE_LIMIT':'GRANTS_PROVIDER_UNAVAILABLE',
          'Grants.gov is temporarily unavailable; resume this retained capture.',response.status,
          {receipt,attempts,retryAfterMs:delay,retryAt:new Date(Date.now()+delay).toISOString()});
      }
      return sourceFromResponse({kind,requestBody:body,requestBytes,responseBytes:raw,
        status:response.status,headers:response.headers,startedAt,capturedAt,attempts});
    }
    throw fault('GRANTS_TRANSPORT');
  };
  const serial=(kind,body,options)=>{
    const pending=queue.then(()=>run(kind,body,options));
    queue=pending.catch(()=>{});return pending;
  };
  return {
    schema:'stellar-forge.grantsgov-transport.v1',
    search:(query,startRecord=0,options={})=>serial('search',buildSearchRequest(query,startRecord),options),
    detail:(identifier,options={})=>serial('detail',{opportunityId:Number(opportunityId(identifier))},options)
  };
}
