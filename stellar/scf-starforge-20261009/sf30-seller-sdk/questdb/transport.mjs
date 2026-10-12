// MIT. Native HTTP GET execution with one request, response backpressure and cancellation.
import http from 'node:http';
import https from 'node:https';
import { fail, bounded, stamp } from './common.mjs';

export function requestLifetime(signal,timeoutMs) {
  const controller=new AbortController();let timeout=false;
  const forward=()=>controller.abort(signal.reason);
  if(signal!==undefined && typeof signal?.addEventListener!=='function')throw fail('QUESTDB_ABORT_SIGNAL_REQUIRED');
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const timer=setTimeout(()=>{timeout=true;controller.abort();},timeoutMs);timer.unref?.();
  return {signal:controller.signal,get timeout(){return timeout;},cancel(){controller.abort();},
    close(){clearTimeout(timer);signal?.removeEventListener('abort',forward);}};
}
function header(response,name) {
  const value=response.headers[name];
  return typeof value==='string'&&value.length<=4096?value:null;
}
export async function questDbRequest(connection,{path='api/v1/sql/execute',sql,limit,count=false,format='json',
  timeoutMs=30000,maxBytes=1048576,signal,onChunk}={}) {
  bounded(timeoutMs,100,3600000,'QUESTDB_REQUEST_TIMEOUT_INVALID');
  bounded(maxBytes,1,8589934592,'QUESTDB_REQUEST_LIMIT_INVALID');
  const url=new URL(path,connection.baseUrl);
  url.searchParams.set('query',sql);
  if(limit!==undefined)url.searchParams.set('limit',String(limit));
  if(format==='json'){url.searchParams.set('quoteLargeNum','true');url.searchParams.set('count',count?'true':'false');}
  else{url.searchParams.set('fmt','csv');url.searchParams.set('timeout',String(Math.ceil(timeoutMs/1000)));}
  if(Buffer.byteLength(url.href)>131072)throw fail('QUESTDB_ENCODED_QUERY_TOO_LARGE');
  const lifetime=requestLifetime(signal,timeoutMs),startedAt=stamp();
  let req,response,total=0;
  const summary={method:'GET',url:url.href,endpoint:url.origin+url.pathname,startedAt,quoteLargeNum:format==='json',
    countRequested:count,statementTimeoutMs:timeoutMs,format};
  try {
    if(lifetime.signal.aborted)throw fail('QUERY_ABORTED');
    response=await new Promise((resolve,reject)=>{
      req=(url.protocol==='https:'?https:http).request(url,{method:'GET',headers:{...connection.headers,
        accept:format==='json'?'application/json':'text/csv','statement-timeout':String(timeoutMs)},
        signal:lifetime.signal},resolve);
      req.once('error',reject);req.end();
    });
    summary.httpStatus=response.statusCode;
    summary.responseHeaders=Object.fromEntries(['content-type','content-length','etag','last-modified','date','retry-after'].map(key=>[key,header(response,key)]).filter(([,value])=>value!==null));
    if(response.statusCode!==200) {
      const parts=[];let retained=0;
      for await(const chunk of response){const remaining=65536-retained;if(remaining>0){parts.push(chunk.subarray(0,remaining));retained+=Math.min(chunk.length,remaining);}if(chunk.length>remaining){response.destroy();break;}}
      const body=Buffer.concat(parts).toString('utf8');let provider;
      try{const parsed=JSON.parse(body);provider=typeof parsed.error==='string'?{error:parsed.error.slice(0,4096),position:parsed.position}:undefined;}catch{}
      const retryAfter=header(response,'retry-after');
      throw fail(response.statusCode===401||response.statusCode===403?'QUESTDB_AUTHORIZATION_FAILED':
        response.statusCode===429?'QUESTDB_RATE_LIMITED':'QUESTDB_PROVIDER_ERROR',
        provider?.error??'QuestDB returned HTTP '+response.statusCode,
        {httpStatus:response.statusCode,provider,request:summary,retryAfter,bodyPreview:body.slice(0,4096)});
    }
    const encoding=header(response,'content-encoding');
    if(encoding && encoding.toLowerCase()!=='identity')throw fail('QUESTDB_UNSUPPORTED_CONTENT_ENCODING');
    for await(const chunk of response) {
      if(lifetime.signal.aborted)throw fail(lifetime.timeout?'QUERY_TIMEOUT':'QUERY_ABORTED');
      total+=chunk.length;if(total>maxBytes)throw fail('QUERY_RESULT_TOO_LARGE','Increase the reviewed byte limit or narrow the source query.',{maximum:maxBytes,observed:total});
      await onChunk?.(chunk);
    }
    if(!response.complete)throw fail('QUESTDB_RESPONSE_INCOMPLETE');
    const length=header(response,'content-length');
    if(length && /^\d+$/.test(length) && BigInt(length)!==BigInt(total))throw fail('QUESTDB_RESPONSE_LENGTH_CHANGED');
    return {...summary,completedAt:stamp(),bytes:total,complete:true};
  } catch(issue) {
    if(lifetime.signal.aborted)throw fail(lifetime.timeout?'QUERY_TIMEOUT':'QUERY_ABORTED',
      lifetime.timeout?'The native query exceeded its deadline.':'The native source request was cancelled.',
      {request:summary,receivedBytes:total,serverCompletion:'unconfirmed'});
    if(issue?.name==='QuestDbSourceError')throw issue;
    throw fail('QUESTDB_CONNECTION_FAILED','The native HTTP response could not be completed.',
      {request:summary,receivedBytes:total,transportCode:typeof issue?.code==='string'?issue.code:undefined,serverCompletion:'unconfirmed'});
  } finally {response?.destroy();req?.destroy();lifetime.close();}
}
