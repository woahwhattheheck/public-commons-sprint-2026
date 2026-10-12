// MIT. Retained read-only SensorThings requests; no automatic provider retries.
import {join} from 'node:path';
import {readOwned,privateDirectory} from '../stellar-expert/store.mjs';
import {sha,identity,json,now,fault,sourceURL,sourceDocument,plain} from './contract.mjs';
const HEADER_NAMES=['content-type','content-length','content-encoding','date','etag','last-modified','location','retry-after','cache-control','vary','warning','server'];
const cleanHeaders=headers=>Object.fromEntries(HEADER_NAMES.flatMap(k=>{const v=typeof headers?.get==='function'?headers.get(k):headers?.[k];return v===null||v===undefined?[]:[[k,String(v)]];}));
const readJson=async(path,max=1024*1024)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,max)));
async function maybe(path){try{return await readJson(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function retryAfter(value,observedAt){
  if(typeof value!=='string')return null;
  let time;if(/^\d+$/.test(value))time=Date.parse(observedAt)+Number(value)*1000;else time=Date.parse(value);
  return Number.isFinite(time)&&time>Date.parse(observedAt)?new Date(time).toISOString():null;
}
export async function originalRequest(config,url,{signal,fetchImpl=fetch,environment=process.env,transport}={}){
  url=sourceURL(url,config);const startedAt=now();
  if(transport){
    const source=await transport.request(url,{signal});
    if(!plain(source)||source.url!==url||!Buffer.isBuffer(source.body)||source.body.length>config.maxPageBytes||
        !Number.isInteger(source.status)||source.status<100||source.status>599||typeof source.capturedAt!=='string'||!Number.isFinite(Date.parse(source.capturedAt)))
      throw fault('RECORDING','The host-selected recording is not a complete original response.',422);
    return {body:source.body,url,requestedUrl:url,status:source.status,headers:cleanHeaders(source.headers),startedAt,
      completedAt:now(),sourceCapturedAt:source.capturedAt,representation:'RECORDED_ORIGINAL_APPLICATION_BODY',
      originalReceipt:source.originalReceipt??null,complete:true,error:null};
  }
  const headers={Accept:'application/json','User-Agent':'StellarForge-SensorThings/1.0'};
  if(config.authorizationEnv){
    const value=environment[config.authorizationEnv];
    if(typeof value!=='string'||!value||/[\r\n]/.test(value))throw fault('CREDENTIAL_UNAVAILABLE','The host-selected authorization environment value is unavailable.',503);
    headers.Authorization=value;
  }
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(config.requestTimeoutMs)]):AbortSignal.timeout(config.requestTimeoutMs);
  let response,chunks=[],length=0,complete=false,error=null;
  try{
    response=await fetchImpl(url,{method:'GET',headers,redirect:'manual',signal:combined});
    const reader=response.body?.getReader();
    if(reader){
      try{while(true){const part=await reader.read();if(part.done){complete=true;break;}
        const available=config.maxPageBytes-length;
        if(part.value.length>available){if(available>0){chunks.push(Buffer.from(part.value.subarray(0,available)));length+=available;}
          error={code:'BODY_LIMIT',message:'The original response exceeds the selected page limit. Its received prefix is retained.'};await reader.cancel();break;}
        chunks.push(Buffer.from(part.value));length+=part.value.length;
      }}finally{reader.releaseLock();}
    }else complete=true;
  }catch(e){error={code:combined.aborted?'INTERRUPTED':'TRANSPORT',message:'The provider read did not return a complete body.'};}
  return {body:Buffer.concat(chunks,length),url:response?.url||url,requestedUrl:url,status:response?.status??null,
    headers:cleanHeaders(response?.headers),startedAt,completedAt:now(),sourceCapturedAt:now(),
    representation:'ORIGINAL_APPLICATION_BODY_AFTER_HTTP_CONTENT_DECODING',complete,error};
}
/** A request identity is bound before HTTP. A complete retained receipt reopens
 * without HTTP. An interrupted request needs a distinct, explicitly resumed
 * attempt; this function never silently reuses its identity for another read. */
export async function retainedGet(store,config,{requestId,url,cause,signal,fetchImpl,environment,transport}={}){
  if(!/^[a-f0-9]{64}$/.test(requestId??''))throw fault('REQUEST_ID','Use the original deterministic request identity.');
  url=sourceURL(url,config);const directory=join(store.root,'receipts');
  await privateDirectory(directory);
  const requestPath=join(directory,'sensorthings-'+requestId+'-request.json'),responsePath=join(directory,'sensorthings-'+requestId+'-response.json');
  const selection={schema:'stellar-forge.sensorthings-request.v1',requestId,url,method:'GET',
    sourceConfigurationSha256:identity(config),authorizationEnv:config.authorizationEnv??null,cause:cause??null};
  let recorded=await maybe(responsePath);
  if(recorded){
    if(recorded.schema!=='stellar-forge.sensorthings-response.v1'||recorded.requestId!==requestId||
      recorded.requestSha256!==identity(selection)||recorded.requestedUrl!==url)throw fault('RECEIPT_CHANGED','The original response binding differs.',409);
    const body=await store.object(recorded.sha256);if(body.length!==recorded.bytes)throw fault('RECEIPT_CHANGED','The original response length differs.',409);
    return {receipt:recorded,body,reused:true};
  }
  const prior=await maybe(requestPath);
  if(prior){
    if(prior.requestSha256!==identity(selection))throw fault('REQUEST_CHANGED','The request identity belongs to another selection.',409);
    throw fault('REQUEST_INTERRUPTED','This original request began without a finalized response. Resume the capture explicitly to retain a new read attempt.',409,{requestId});
  }
  const request={...selection,requestSha256:identity(selection),startedAt:now()};
  await store.immutable(requestPath,json(request));
  let response;
  try{response=await originalRequest(config,url,{signal,fetchImpl,environment,transport});}
  catch(e){response={body:Buffer.alloc(0),url,requestedUrl:url,status:null,headers:{},startedAt:request.startedAt,completedAt:now(),
      sourceCapturedAt:null,representation:transport?'RECORDED_ORIGINAL_APPLICATION_BODY':'ORIGINAL_APPLICATION_BODY_AFTER_HTTP_CONTENT_DECODING',
      complete:false,error:{code:e.code??'REQUEST_UNAVAILABLE',message:e.message}};}
  const object=await store.putObject(response.body);
  const {body,...metadata}=response;
  recorded={schema:'stellar-forge.sensorthings-response.v1',requestId,requestSha256:request.requestSha256,...metadata,
    ...object,retryNotBefore:retryAfter(response.headers['retry-after'],response.completedAt)};
  await store.immutable(responsePath,json(recorded));
  return {receipt:recorded,body,reused:false};
}
export function decodeResponse(response){
  const r=response.receipt;
  if(!r.complete)throw fault('INCOMPLETE_RESPONSE','The original response body is incomplete; its prefix and error remain retained.',502,{requestId:r.requestId,error:r.error});
  if(r.status!==200)throw fault('HTTP_RESPONSE','The provider returned HTTP '+r.status+'. Its original body and headers remain retained.',r.status===429?429:502,
    {requestId:r.requestId,httpStatus:r.status,retryNotBefore:r.retryNotBefore,location:r.headers.location??null});
  if(!/\b(?:application|text)\/(?:[a-z0-9.-]+\+)?json\b/i.test(r.headers['content-type']??''))
    throw fault('RESPONSE_TYPE','The provider did not identify this response as JSON; the complete original body remains retained.',422,{requestId:r.requestId});
  try{return sourceDocument(response.body);}catch(e){if(e.code?.startsWith('SENSORTHINGS_'))throw e;
    throw fault('RESPONSE_JSON','The provider returned ambiguous, malformed or unsupported JSON; its complete original body remains retained.',422,{requestId:r.requestId});}
}
export async function recordedTransport(path){
  const bytes=await readOwned(path,128*1024*1024),bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(bundle?.schema!=='stellar-forge.sensorthings-original-responses.v1'||!Array.isArray(bundle.responses))throw fault('RECORDING_SCHEMA','Use a complete original SensorThings response bundle.');
  const pages=new Map();
  for(const item of bundle.responses){
    if(!plain(item)||typeof item.url!=='string'||typeof item.bodyBase64!=='string')throw fault('RECORDING_SCHEMA','An original response is incomplete.');
    const body=Buffer.from(item.bodyBase64,'base64');
    if(body.toString('base64')!==item.bodyBase64||sha(body)!==item.sha256||body.length!==item.bytes)
      throw fault('RECORDING_HASH','An original recorded response differs from its declared bytes.',409);
    const rows=pages.get(item.url)??[];rows.push({...item,body,originalReceipt:{bundleSha256:sha(bytes),source:bundle.source??null,
      sourceRequestId:item.requestId??null,sha256:item.sha256,bytes:item.bytes,capturedAt:item.capturedAt}});pages.set(item.url,rows);
  }
  const offsets=new Map();
  return {mode:'RECORDED_ORIGINAL_RESPONSES',sha256:sha(bytes),async request(url){
    const index=offsets.get(url)??0,rows=pages.get(url);
    if(!rows||index>=rows.length)throw fault('RECORDING_URL','No unused original response is retained for this exact URL. No substitute response will be generated.',404,{url,index});
    offsets.set(url,index+1);return rows[index];
  }};
}
export async function requestReceipt(store,requestId){
  const r=await readJson(join(store.root,'receipts','sensorthings-'+requestId+'-response.json'));
  const body=await store.object(r.sha256);if(body.length!==r.bytes)throw fault('RECEIPT_CHANGED','The original response length differs.',409);return {receipt:r,body};
}
