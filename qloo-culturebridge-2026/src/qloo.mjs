import {KINDS,normalizeInsights} from './engine.mjs';
// Hackathon-issued credentials are scoped to the fixed hackathon service, not production.
const ORIGIN = 'https://hackathon.api.qloo.com';
const MAX_WAIT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class QlooError extends Error {
  constructor(code, message) { super(message);this.code=code;this.name='QlooError' }
}
// Real fetch exposes a byte stream: reject oversized provider responses before
// allocating the whole body. In-process JSON-only mocks keep the same contract.
async function boundedJson(response) {
  const lengthText = response.headers?.get?.('content-length');
  if (lengthText && /^\d+$/.test(lengthText) && Number(lengthText) > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch { /* best effort */ }
    throw new QlooError('RESPONSE', 'Qloo response exceeds the 1 MiB byte limit');
  }
  if (!response.body?.getReader) {
    try {
      const value = await response.json();
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_RESPONSE_BYTES)
        throw new QlooError('RESPONSE', 'Qloo response exceeds the 1 MiB byte limit');
      return value;
    } catch (err) {
      if (err instanceof QlooError) throw err;
      throw new QlooError('RESPONSE', 'Qloo returned invalid or unreadable JSON');
    }
  }
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new QlooError('RESPONSE', 'Qloo response exceeds the 1 MiB byte limit');
      }
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts, bytes).toString('utf8'));
  } catch (err) {
    if (err instanceof QlooError) throw err;
    throw new QlooError('RESPONSE', 'Qloo returned invalid or unreadable JSON');
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
async function qlooGet(path,params,key,fetcher=fetch){
  const u = new URL(path,ORIGIN);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  const res=await fetcher(u,{headers:{'X-Api-Key':key,Accept:'application/json'},
    redirect:'manual', // Never forward the server-only API key to a redirect target.
    signal:AbortSignal.timeout(MAX_WAIT_MS)});
  if(res.status>=300&&res.status<400)
    throw new QlooError('REDIRECT','Qloo redirected the live API request; credentials were not forwarded');
  if(!res.ok){const category=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH':'UPSTREAM';
    throw new QlooError(category,`Qloo ${category.toLowerCase()} (HTTP ${res.status})`);}
  const data=await boundedJson(res);
  if(typeof data!=='object'||data===null || !(
    Array.isArray(data) || Array.isArray(data.results) ||
    Array.isArray(data.entities) || Array.isArray(data.results?.entities) ||
    Array.isArray(data.results?.items) || Array.isArray(data.data?.results) ||
    Array.isArray(data.data?.results?.entities) || Array.isArray(data.data?.entities)
  )) throw new QlooError('RESPONSE','Qloo response did not contain a recognized entity collection');
  return {url:u.toString(),data};
}
function searchCandidates(doc) {
  // Qloo search results may be returned as flat arrays or a named `entities` collection.
  return normalizeInsights(doc).filter(x=>x.id);
}
export async function resolveEntity(seed,key,fetcher=fetch){
  const {url,data}=await qlooGet('/search',{query:seed,types:'urn:entity:artist,urn:entity:movie,urn:entity:book,urn:entity:videogame',take:10},key,fetcher);
  const candidates=searchCandidates(data);
  const target=seed.toLowerCase();
  const best=candidates.find(x=>x.name.toLowerCase()===target)||candidates[0];
  if(!best)throw new QlooError('NO_MATCH',`Qloo did not resolve a taste seed named "${seed}"`);
  return {id:best.id,name:best.name,url};
}
export async function insightForSeed(seedId,kind,key,fetcher=fetch){
  return qlooGet('/v2/insights',{'filter.type':KINDS[kind],'signal.interests.entities':seedId,take:40,'feature.explainability':true},key,fetcher);
}
export async function buildLiveComparison({seedA,seedB,kind,fetcher=fetch,key=process.env.QLOO_API_KEY}){
  if(!key)throw new QlooError('NOT_CONFIGURED','Live Qloo mode requires a server-side QLOO_API_KEY. Demo mode is available separately.');
  const trace=[];
  const add=(step,detail)=>trace.push({step,status:'done',detail});
  const [a,b]=await Promise.all([resolveEntity(seedA,key,fetcher),resolveEntity(seedB,key,fetcher)]);
  add('resolve',`${seedA} → ${a.name}; ${seedB} → ${b.name}. Two Qloo entity searches.`);
  const [ia,ib]=await Promise.all([insightForSeed(a.id,kind,key,fetcher),insightForSeed(b.id,kind,key,fetcher)]);
  add('retrieve',`Qloo returned separate ${kind} insight collections. Each collection is evaluated independently.`);
  return {resultsA:ia.data,resultsB:ib.data,trace,queries:[a.url,b.url,ia.url,ib.url]};
}
