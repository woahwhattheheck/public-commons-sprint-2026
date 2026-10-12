// MIT. Source-defined, lossless public API acquisition. No arbitrary URL proxy.
import {createHash} from 'node:crypto';
import {parseExactJSON} from './exact-json.mjs';
import {CAPTURE_KINDS,SOURCE_CONTRACT} from './schema.mjs';
export const SOURCE_ORIGIN = 'https://api.stellar.expert';
export const hashBytes = b => createHash('sha256').update(b).digest('hex');
export const fault = (code,message,status=400,details={}) => Object.assign(new Error(message),{code,status,...details});
const fail = (message) => { throw fault('STELLAR_SOURCE_INPUT',message); };
const str = (v,max=300) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const account = v => /^G[A-Z2-7]{55}$/.test(v??'');
export function normalizeAsset(value) {
  if (!str(value,100) || !(value==='XLM' || /^[A-Za-z0-9]{1,12}-G[A-Z2-7]{55}(?:-[12])?$/.test(value))) fail('Use XLM or an exact Stellar asset code and issuer.');
  return value;
}
export function canonicalQuery(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('Choose a source query.');
  const kind=CAPTURE_KINDS.find(k=>k.id===raw.kind); if(!kind) fail('Unknown source query kind.');
  const allowed=new Set(['kind',...kind.fields]);
  if(Object.keys(raw).some(k=>!allowed.has(k))) fail('This source query contains an unsupported field.');
  const q={kind:raw.kind};
  if(kind.fields.includes('network')) {
    q.network=raw.network??'public';if(!['public','testnet'].includes(q.network)) fail('Choose public or testnet.');
  }
  if(kind.fields.includes('asset')) q.asset=normalizeAsset(raw.asset);
  for(const name of ['search','domain','timestamp','sequence']) if(raw[name]!==undefined&&raw[name]!=='') {
    if(!str(raw[name],name==='search'?300:255)) fail('Invalid '+name);q[name]=raw[name];
  }
  if(q.kind==='domain'&&(!q.domain||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(q.domain))) fail('Enter a domain name without a URL path.');
  if(q.domain)q.domain=q.domain.toLowerCase();
  if(q.kind==='ledger-time'&&(!q.timestamp||!(/^\d+$/.test(q.timestamp)||Number.isFinite(Date.parse(q.timestamp)))))fail('Enter a Unix timestamp or RFC 3339 date.');
  if(q.kind==='ledger-sequence'&&!/^[1-9]\d*$/.test(q.sequence??''))fail('Enter a positive ledger sequence.');
  if(q.search&&q.kind==='directory'&&q.search.length<5)fail('Directory search requires at least five characters.');
  if(q.search&&q.kind==='blocked-domains'&&q.search.length<2)fail('Domain search requires at least two characters.');
  for(const name of ['address','tag']) if(raw[name]!==undefined) {
    if(!Array.isArray(raw[name])||!raw[name].length||raw[name].length>(name==='address'?50:10)||
       raw[name].some(v=>!str(v,128)||(name==='address'&&!account(v)))||new Set(raw[name]).size!==raw[name].length)fail('Invalid '+name+' list.');
    q[name]=[...raw[name]];
  }
  if(kind.fields.includes('sort')) {q.sort=raw.sort??'rating';if(!['rating','created','payments','trades','trustlines','volume','volume7d'].includes(q.sort))fail('Invalid asset sort.');}
  if(kind.fields.includes('order')) {q.order=raw.order??'desc';if(!['asc','desc'].includes(q.order))fail('Invalid order.');}
  if(kind.paginated) {
    const max=q.kind==='blocked-domains'?1000:200;q.limit=raw.limit??100;
    if(!Number.isInteger(q.limit)||q.limit<1||q.limit>max)fail('Invalid page size.');
  }
  return q;
}
export function sourceUrl(raw) {
  const q=canonicalQuery(raw),p='/explorer/',n=q.network,a=encodeURIComponent(q.asset??'');
  const path={assets:p+n+'/asset',holders:p+n+'/asset/'+a+'/holders',rating:p+n+'/asset/'+a+'/rating',
    supply:p+n+'/asset/'+a+'/supply',directory:p+'directory',tags:p+'directory/tags',
    'blocked-domains':p+'directory/blocked-domains',domain:p+'directory/blocked-domains/'+encodeURIComponent(q.domain??''),
    'ledger-time':p+n+'/ledger/sequence-from-timestamp','ledger-sequence':p+n+'/ledger/timestamp-from-sequence'}[q.kind];
  const url=new URL(path,SOURCE_ORIGIN);
  for(const [key,value]of Object.entries(q)) {
    if(['kind','network','asset','domain'].includes(key))continue;
    if(Array.isArray(value))for(const item of value)url.searchParams.append(key+'[]',item);
    else url.searchParams.set(key,String(value));
  }
  return url.href;
}
function immutableFilters(url) {
  return [...url.searchParams].filter(([k])=>!['cursor','limit','order','sort'].includes(k))
    .sort(([a,x],[b,y])=>a.localeCompare(b)||x.localeCompare(y));
}
export function checkedNext(href,current,original) {
  if(typeof href!=='string'||href.length>8192)throw fault('STELLAR_SOURCE_PAGING','The provider returned an invalid next link.',502);
  const next=new URL(href,current),first=new URL(original);
  if(next.origin!==SOURCE_ORIGIN||next.username||next.password||next.hash||
    next.pathname.replace(/\/$/,'')!==first.pathname.replace(/\/$/,''))
    throw fault('STELLAR_SOURCE_PAGING','The next page changed the selected source endpoint.',502);
  // Observed Open API asset links omit search, including their self link. Keep
  // the provider cursor and explicitly inherit the original selected filters.
  // Any filter the provider does supply must agree with the original request.
  const expected=immutableFilters(first),provided=immutableFilters(next);
  for(const[key,value]of provided)if(!expected.some(([k,v])=>k===key&&v===value))
    throw fault('STELLAR_SOURCE_PAGING','The next page changed a selected source filter.',502);
  for(const key of new Set(expected.map(([k])=>k))){
    const originals=first.searchParams.getAll(key),actual=next.searchParams.getAll(key);
    if(actual.length&&JSON.stringify(actual.slice().sort())!==JSON.stringify(originals.slice().sort()))
      throw fault('STELLAR_SOURCE_PAGING','The provider changed a repeated query filter.',502);
    if(!actual.length)for(const value of originals)next.searchParams.append(key,value);
  }
  for(const key of ['order','sort'])if(first.searchParams.has(key)){
    if(next.searchParams.has(key)&&next.searchParams.get(key)!==first.searchParams.get(key))
      throw fault('STELLAR_SOURCE_PAGING','The provider next page changed the selected ordering.',502);
    if(!next.searchParams.has(key))next.searchParams.set(key,first.searchParams.get(key));
  }
  const allowed=new Set([...first.searchParams.keys(),'cursor','sort','order','limit']);
  if([...next.searchParams.keys()].some(k=>!allowed.has(k)))throw fault('STELLAR_SOURCE_PAGING','The provider next page added an unknown query field.',502);
  if(!next.searchParams.has('cursor'))throw fault('STELLAR_SOURCE_PAGING','The provider next page has no continuation cursor.',502);
  return next.href;
}
export function retryTime(value,now=Date.now()) {
  if(value&&/^\d+$/.test(value))return new Date(now+Math.min(86400,Number(value))*1000).toISOString();
  const time=Date.parse(value);return new Date(Number.isFinite(time)?Math.max(now,time):now+60000).toISOString();
}
export async function fetchSourcePage(url,{query,originalUrl=url,fetchImpl=fetch,signal}={}) {
  if(new URL(url).origin!==SOURCE_ORIGIN)throw fault('STELLAR_SOURCE_ORIGIN','Use the original provider origin.');
  const startedAt=new Date().toISOString(),timeout=AbortSignal.timeout(25000);
  const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:query.kind==='supply'?'text/plain':'application/json',
    'user-agent':'Starforge-StellarExpert-Workspace/1.0 (retained public research; '+SOURCE_CONTRACT.documentation+')'},signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const chunks=[];let count=0;
  for await(const part of response.body??[]) {
    count+=part.length;if(count>8*1024*1024)throw fault('STELLAR_SOURCE_PAGE_LIMIT','This source page exceeds 8 MiB.',413);chunks.push(Buffer.from(part));
  }
  const body=Buffer.concat(chunks),finishedAt=new Date().toISOString();
  const receipt={url,status:response.status,startedAt,finishedAt,bytes:body.length,sha256:hashBytes(body),
    contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),
    retryAfter:response.headers.get('retry-after')};
  if(!response.ok)return {body,receipt,error:{code:response.status===429?'STELLAR_SOURCE_RATE_LIMIT':'STELLAR_SOURCE_HTTP',
    message:'StellarExpert returned HTTP '+response.status+'.',status:response.status,
    ...(response.status===429||response.status===503?{retryAt:retryTime(receipt.retryAfter)}:{})}};
  return decodeSourcePage(body,receipt,{query,originalUrl});
}
export function decodeSourcePage(body,receipt,{query,originalUrl=receipt.url}={}) {
  const url=receipt.url;
  try {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(body);let data,records,nextUrl=null;
  if(query.kind==='supply') {
    const supply=text.trim();if(!/^\d+(?:\.\d+)?$/.test(supply))throw fault('STELLAR_SOURCE_SHAPE','Supply did not contain decimal asset units.',502);
    data={asset:query.asset,supply_units:supply};records=[data];
  } else {
    data=parseExactJSON(text);
    const paginated=CAPTURE_KINDS.find(k=>k.id===query.kind).paginated;
    if(paginated) {
      if(!data?._embedded||!Array.isArray(data._embedded.records))throw fault('STELLAR_SOURCE_SHAPE','The source did not contain its documented records array.',502);
      records=data._embedded.records;
      const href=data?._links?.next?.href;
      // Horizon-style APIs commonly advertise next even on the final nonempty page.
      // Completion is an observed empty page or an absent next link, never a short-page guess.
      if(records.length&&href){
        nextUrl=checkedNext(href,url,originalUrl);
        const advertised=new URL(href,url);
        const inheritedQuery=[...new URL(originalUrl).searchParams].filter(([key])=>!advertised.searchParams.has(key));
        receipt={...receipt,continuation:{providerHref:href,effectiveUrl:nextUrl,inheritedQuery}};
      }
    } else if(query.kind==='tags') {
      if(!Array.isArray(data))throw fault('STELLAR_SOURCE_SHAPE','Directory tags must be an array.',502);
      records=data;
    } else {
      if(!data||typeof data!=='object'||Array.isArray(data))throw fault('STELLAR_SOURCE_SHAPE','Expected a source object.',502);
      records=[data];
    }
  }
  return {body,receipt,data,records,nextUrl};
  } catch(error) {
    return {body,receipt,error:{code:error.code??'STELLAR_SOURCE_SHAPE',message:error.code?error.message:'The source JSON did not match its documented shape.',status:502}};
  }

}
