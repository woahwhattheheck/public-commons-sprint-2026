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
// The search endpoint may offer hints on an exact-name miss, not authorization
// to use a fuzzy hit as the user's chosen entity. Bounded inputs/results make
// this deterministic and safe to display as text only.
const canonicalName = value => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
function similarity(left, right) {
  const a = Array.from(canonicalName(left).slice(0,160));
  const b = Array.from(canonicalName(right).slice(0,160));
  const at = new Set(a.join('').split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const bt = new Set(b.join('').split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const union = new Set([...at,...bt]);
  const jaccard = union.size ? [...at].filter(x=>bt.has(x)).length / union.size : 0;
  // Bounded Levenshtein: O(160^2) worst case for each of at most 10 hits.
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++) {
    const current=[i+1];
    for(let j=0;j<b.length;j++)
      current.push(Math.min(current[j]+1,previous[j+1]+1,previous[j]+(a[i]===b[j]?0:1)));
    previous=current;
  }
  const lev=1-(previous[b.length]/Math.max(a.length,b.length,1));
  return 0.55*jaccard + 0.45*Math.max(0,lev);
}
function suggestedSeeds(seed,candidates) {
  return candidates
    .filter(x=>typeof x.id==='string' && x.id.trim() && typeof x.name==='string' && x.name.trim())
    .map(x=>({id:x.id, name:x.name.slice(0,160), rank:x.rank,
      score:similarity(seed,x.name)}))
    .filter(x=>canonicalName(x.name)!==canonicalName(seed))
    .sort((a,b)=>b.score-a.score || a.rank-b.rank || a.id.localeCompare(b.id,'en'))
    .slice(0,3)
    .map(({id,name})=>({id,name,reason:'did_you_mean'}));
}
export async function resolveEntity(seed,key,fetcher=fetch){
  const {url,data}=await qlooGet('/search',{query:seed,types:'urn:entity:artist,urn:entity:movie,urn:entity:book,urn:entity:videogame',take:10},key,fetcher);
  const candidates=searchCandidates(data);
  // Related search hits cannot substitute for the user's requested entity.
  const exact=candidates.filter(x=>canonicalName(x.name)===canonicalName(seed));
  if(!exact.length) {
    const err=new QlooError('NO_MATCH',`Qloo did not resolve a taste seed named "${seed}"`);
    err.suggestions=suggestedSeeds(seed,candidates);
    throw err;
  }
  // Names can be shared by different cultural entities across Qloo domains.
  const uniqueIds=new Set(exact.map(x=>x.id.trim().toLocaleLowerCase('en')));
  if(uniqueIds.size>1)
    throw new QlooError('AMBIGUOUS_SEED',`Qloo found multiple entities named "${seed}"; choose a more specific seed.`);
  const best=exact[0];
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
