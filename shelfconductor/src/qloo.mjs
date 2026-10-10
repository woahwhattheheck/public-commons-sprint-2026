// SPDX-License-Identifier: MIT
import {InputError,requireText} from './core.mjs';
const ORIGIN='https://hackathon.api.qloo.com';
// Bound the upstream byte stream before allocation or JSON parsing: provider
// Content-Length headers alone are not trustworthy.
const MAX_QLOO_JSON_BYTES=1_500_000;
export class UpstreamError extends Error { constructor(code,detail){super(detail);this.code=code;} }
async function readJsonWithinLimit(response){
  const declared=response.headers?.get('content-length');
  if(declared!==null&&declared!==undefined&&/^\d+$/.test(declared)&&Number(declared)>MAX_QLOO_JSON_BYTES){
    void response.body?.cancel?.().catch(()=>{});
    throw new UpstreamError('QLOO_RESPONSE_TOO_LARGE','Qloo response exceeds the 1.5MB safety limit');
  }
  if(!response.body||typeof response.body.getReader!=='function')throw new UpstreamError('UPSTREAM_BAD_JSON','Qloo returned no readable JSON body');
  const reader=response.body.getReader();let total=0;const chunks=[];
  try {
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw new UpstreamError('UPSTREAM_BAD_JSON','Qloo sent a non-byte response');
      total+=value.byteLength;
      if(total>MAX_QLOO_JSON_BYTES){
        void reader.cancel().catch(()=>{});
        throw new UpstreamError('QLOO_RESPONSE_TOO_LARGE','Qloo response exceeds the 1.5MB safety limit');
      }
      chunks.push(value);
    }
  }catch(error){
    if(error instanceof UpstreamError)throw error;
    throw new UpstreamError('UPSTREAM_UNAVAILABLE','Qloo response stream failed');
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new UpstreamError('UPSTREAM_BAD_JSON','Qloo returned invalid JSON or UTF-8');}
}
function entities(data){
  const items=data?.results?.entities??data?.entities??data?.results;
  if(!Array.isArray(items))throw new UpstreamError('UNEXPECTED_QLOO_RESPONSE','Search returned no identifiable entity collection');
  return items;
}
const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function makeQlooClient({apiKey,fetchImpl=fetch,now=()=>Date.now(),maxCalls=24}={}){
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>120) throw new Error('maxCalls 1..120 required');
  const calls=[];const cache=new Map();const inflight=new Map();
  async function get(path,params){
    if(!apiKey)throw new UpstreamError('NO_QLOO_KEY','Set QLOO_API_KEY server-side to use live mode');
    const u=new URL(path,ORIGIN);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
    const key=u.toString();const stamp=now();const cached=cache.get(key);
    if(cached&&cached.until>stamp)return cached.body;
    if(inflight.has(key))return inflight.get(key);
    const job=(async()=>{
      const time=now();while(calls.length&&calls[0]<=time-60000)calls.shift();
      if(calls.length>=maxCalls)throw new UpstreamError('QLOO_LOCAL_BUDGET','Local quota reached; retry after 60 seconds');
      calls.push(time); // failures consume a slot too
      let response;
      try {response=await fetchImpl(u,{method:'GET',headers:{'X-Api-Key':apiKey,Accept:'application/json'},signal:AbortSignal.timeout(8500)});}
      catch {throw new UpstreamError('UPSTREAM_UNAVAILABLE','Qloo request failed or timed out');}
      if(!response.ok)throw new UpstreamError(response.status===429?'QLOO_RATE_LIMITED':response.status===401?'QLOO_AUTH_FAILED':'QLOO_HTTP_ERROR',`Qloo HTTP ${response.status}`);
      const body=await readJsonWithinLimit(response);
      if(body?.success===false)throw new UpstreamError('QLOO_REJECTED','Qloo did not accept the request');
      cache.set(key,{body,until:now()+300000});return body;
    })().finally(()=>inflight.delete(key));
    inflight.set(key,job);return job;
  }
  async function resolveBook(title){
    const name=requireText(title,'seed title',120);
    const data=await get('/search',{query:name,types:'urn:entity:book',take:12});
    const candidates=entities(data).filter(e=>e&&typeof e==='object');
    const exact=candidates.filter(e=>norm(e.name??e.properties?.name)===norm(name));
    const unique=Array.from(new Set(exact.map(e=>e.entity_id??e.id).filter(id=>typeof id==='string'&&id)));
    if(unique.length!==1)throw new UpstreamError('AMBIGUOUS_SEED',`Seed "${name}" resolved to ${unique.length} exact Qloo entity IDs; choose a less ambiguous title`);
    return {title:name,qloo_id:unique[0]};
  }
  async function recommendBooks(ids){
    if(!Array.isArray(ids)||ids.length<1||ids.length>4||ids.some(id=>typeof id!=='string'||!id||id.length>150))throw new InputError('INVALID_INPUT','1..4 resolved Qloo book IDs required');
    return get('/v2/insights',{'filter.type':'urn:entity:book','signal.interests.entities':ids.join(','),take:30});
  }
  return {resolveBook,recommendBooks};
}
