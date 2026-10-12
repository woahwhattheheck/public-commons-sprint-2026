// MIT. Official USAspending read endpoints; original bytes are retained by the caller.
import { ORIGIN, SEARCH_PATH, COUNT_PATH, requireThat, canonical, sourceJSON, sha, now, awardKey } from './core.mjs';
const LIMIT=16*1024*1024;
export class ProviderError extends Error {
  constructor(message,details){super(message);Object.assign(this,{name:'ProviderError',code:'PROVIDER_REQUEST_FAILED',status:502,...details});}
}
function retryAt(value){
  if(!value)return null;const seconds=Number(value);
  return Number.isFinite(seconds)&&seconds>=0?new Date(Date.now()+seconds*1000).toISOString():Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
}
export class USAspendingClient {
  constructor({timeoutMs=45000,intervalMs=350}={}){
    requireThat(Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=120000,'TIMEOUT_INVALID');
    requireThat(Number.isInteger(intervalMs)&&intervalMs>=250&&intervalMs<=10000,'INTERVAL_INVALID');
    this.timeoutMs=timeoutMs;this.intervalMs=intervalMs;this.lastRequest=0;this.nextAllowedAt=null;this.tail=Promise.resolve();
  }
  request(path,{body,signal}={}){
    const invoke=()=>this._request(path,{body,signal});
    const running=this.tail.then(invoke,invoke);this.tail=running.catch(()=>{});return running;
  }
  async _request(path,{body,signal}){
    requireThat(path===SEARCH_PATH||path===COUNT_PATH||path==='/api/v2/awards/last_updated/'||/^\/api\/v2\/awards\/[^/]+\/$/.test(path),'PROVIDER_PATH_UNSUPPORTED');
    if(this.nextAllowedAt&&Date.parse(this.nextAllowedAt)>Date.now())throw new ProviderError('Provider retry time has not arrived',{retryAt:this.nextAllowedAt,providerStatus:429});
    const wait=Math.max(0,this.lastRequest+this.intervalMs-Date.now());
    if(wait)await new Promise((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimeout(timer);reject(signal.reason??new Error('Cancelled'));},timer=setTimeout(finish,wait);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
    signal?.throwIfAborted();
    const url=ORIGIN+path,method=body===undefined?'GET':'POST',encoded=body===undefined?undefined:canonical(body),startedAt=now();
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error('USAspending request timed out')),this.timeoutMs);
    let response,bytes=Buffer.alloc(0);this.lastRequest=Date.now();
    const request={method,url,body:body??null,bodySha256:encoded===undefined?null:sha(encoded),bodyBase64:encoded===undefined?null:Buffer.from(encoded).toString('base64')};
    try{
      response=await fetch(url,{method,body:encoded,redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),'User-Agent':'StellarForge-AwardResearch/1.0 (USAspending public research)'}});
      const length=Number(response.headers.get('content-length'));
      requireThat(!Number.isFinite(length)||length<=LIMIT,'PROVIDER_RESPONSE_TOO_LARGE');
      const parts=[];let size=0;
      for await(const part of response.body){size+=part.length;requireThat(size<=LIMIT,'PROVIDER_RESPONSE_TOO_LARGE');parts.push(part);}
      bytes=Buffer.concat(parts,size);
      const headers=Object.fromEntries(['content-type','date','etag','last-modified','retry-after','x-request-id'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>v!==null));
      const receipt={request,startedAt,finishedAt:now(),url:response.url,status:response.status,headers,bytes:bytes.length,sha256:sha(bytes)};
      if(!response.ok){
        this.nextAllowedAt=retryAt(response.headers.get('retry-after'));
        throw new ProviderError('USAspending returned HTTP '+response.status,{providerStatus:response.status,retryAt:this.nextAllowedAt,receipt,responseBase64:bytes.toString('base64')});
      }
      const value=sourceJSON(bytes);requireThat(value&&typeof value==='object','PROVIDER_JSON_REQUIRED');
      return {value,bytes,receipt};
    }catch(error){
      if(error instanceof ProviderError)throw error;
      throw new ProviderError(error.message,{cancelled:!!signal?.aborted,code:signal?.aborted?'OPERATION_CANCELLED':error.code??'PROVIDER_TRANSPORT_FAILED',receipt:{request,startedAt,finishedAt:now(),status:response?.status??null,bytes:bytes.length,sha256:sha(bytes)},responseBase64:bytes.toString('base64')});
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  search(request,options={}){return this.request(SEARCH_PATH,{...options,body:request});}
  count(filters,options={}){return this.request(COUNT_PATH,{...options,body:{filters,subawards:false,spending_level:'awards'}});}
  detail(key,options={}){return this.request('/api/v2/awards/'+encodeURIComponent(awardKey(key))+'/',options);}
  updated(options={}){return this.request('/api/v2/awards/last_updated/',options);}
}
