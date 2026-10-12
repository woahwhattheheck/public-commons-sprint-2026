// MIT — UseTested's published observations remain source data, never a local scorer.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readBytes, readJson, writeBytes, writeJson, privateDirectory, now, object } from '../node/store.mjs';
export const SOURCE_LIMIT = 4 * 1024 * 1024;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireValue(ok, code, status = 400) {
  if (!ok) throw Object.assign(new Error(code), {code, status});
}
export function plain(value, limit, code) {
  requireValue(typeof value === 'string' && value.length <= limit && !value.includes('\0'), code);
  return value;
}
export function sourceURL(kind, input) {
  requireValue(['search','review'].includes(kind), 'SOURCE_READ_KIND_INVALID');
  const url = new URL('/v1/' + kind, 'https://usetested.com');
  url.searchParams.set(kind === 'search' ? 'q' : 'service', plain(input, 300, 'SOURCE_QUERY_INVALID'));
  return url.href;
}
export function parsePublished(raw, {kind, url}) {
  requireValue(raw instanceof Uint8Array && raw.length > 0 && raw.length <= SOURCE_LIMIT, 'SOURCE_SIZE_INVALID');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { requireValue(false, 'SOURCE_JSON_INVALID'); }
  requireValue(object(value), 'SOURCE_JSON_OBJECT_REQUIRED');
  const parsed = new URL(url);
  requireValue(parsed.origin === 'https://usetested.com' && parsed.pathname === '/v1/' + kind &&
    !parsed.username && !parsed.password && !parsed.hash, 'SOURCE_URL_INVALID');
  const rows = kind === 'search' ? value.results : [value.review ?? value];
  requireValue(Array.isArray(rows) && rows.length <= 10000, 'PUBLISHED_REVIEW_ROWS_INVALID');
  for (const row of rows) {
    requireValue(object(row) && typeof row.service === 'string' && row.service.length > 0 &&
      row.service.length <= 300, 'PUBLISHED_SERVICE_ID_REQUIRED');
  }
  // Keep every original field, including nulls, exact money text and methodology edition.
  return {value, rows};
}
export async function retainSource(state, raw, metadata) {
  const {kind, url} = metadata, parsed = parsePublished(raw, metadata);
  const sha256 = hash(raw), directory = await privateDirectory(join(state, 'sources'));
  const bytesPath = join(directory, sha256 + '.json'), metaPath = join(directory, sha256 + '.source.json');
  const source = {schema:'stellar-forge.review-job-source.v1',sha256,bytes:raw.length,
    provider:'UseTested',kind,url,acquisition:metadata.acquisition ?? 'operator-retained',
    retrievedAt:metadata.retrievedAt ?? null,importedAt:now(),rowCount:parsed.rows.length};
  requireValue(['direct-free-read','operator-retained'].includes(source.acquisition), 'SOURCE_ACQUISITION_INVALID');
  if (source.retrievedAt !== null) requireValue(typeof source.retrievedAt === 'string' &&
    Number.isFinite(Date.parse(source.retrievedAt)), 'SOURCE_DATE_INVALID');
  try { await writeBytes(bytesPath, raw, {exclusive:true}); }
  catch (e) { if (e.code !== 'EEXIST') throw e; requireValue(hash(await readBytes(bytesPath,SOURCE_LIMIT)) === sha256,'SOURCE_BYTES_CHANGED',409); }
  try { await writeJson(metaPath, source, {exclusive:true}); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const prior = await readJson(metaPath);
    // One exact body can be fetched repeatedly. Its original acquisition stays retained.
    requireValue(prior.sha256 === sha256 && prior.bytes === raw.length && prior.kind === kind,
      'SOURCE_METADATA_CONFLICT',409);
    return {source:prior,rows:parsed.rows};
  }
  return {source,rows:parsed.rows};
}
export async function loadSource(state, sha256) {
  requireValue(typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256), 'SOURCE_HASH_REQUIRED');
  const directory=join(state,'sources'), source=await readJson(join(directory,sha256+'.source.json'));
  const raw=await readBytes(join(directory,sha256+'.json'),SOURCE_LIMIT);
  requireValue(source.sha256 === sha256 && source.bytes === raw.length && hash(raw) === sha256,
    'SOURCE_BYTES_CHANGED',409);
  return {source,...parsePublished(raw,source)};
}
export async function fetchSource(state, {kind,query}, {signal,fetcher=globalThis.fetch}={}) {
  const url=sourceURL(kind,query), deadline=AbortSignal.timeout(30000);
  const response=await fetcher(url,{method:'GET',redirect:'error',
    headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,deadline]):deadline});
  requireValue(response.status === 200,'FREE_SOURCE_READ_FAILED',502);
  requireValue((response.headers.get('content-type')??'').toLowerCase().includes('json'),'SOURCE_JSON_REQUIRED',502);
  const reader=response.body.getReader(), parts=[];let size=0;
  try { for (;;) { const {value,done}=await reader.read(); if(done)break; size+=value.byteLength;
    requireValue(size<=SOURCE_LIMIT,'SOURCE_SIZE_INVALID',413);parts.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  return retainSource(state,Buffer.concat(parts),{kind,url,retrievedAt:now(),acquisition:'direct-free-read'});
}
export function catalogRows(raw) {
  requireValue(raw.length > 0 && raw.length <= 1048576,'CATALOG_SIZE_INVALID');
  let catalog;try{catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{requireValue(false,'CATALOG_JSON_INVALID');}
  requireValue(object(catalog),'CATALOG_OBJECT_REQUIRED');
  let rows;
  if(catalog.schema==='scf61-observed-native-page-v1') rows=catalog.nativeProviderRows;
  else if(catalog.mode==='ORIGINAL_UNSIGNED_CATALOG') rows=catalog.originalListings;
  else {
    requireValue(Object.hasOwn(catalog,'resources')!==Object.hasOwn(catalog,'items'),'CATALOG_ENVELOPE_INVALID');
    rows=catalog.resources??catalog.items;
  }
  requireValue(Array.isArray(rows)&&rows.length<=10000,'CATALOG_ROWS_INVALID');
  return rows.map((row,index)=>({index,resource:row.resource,description:row.description??null,
    type:row.type??'http',method:row.extensions?.bazaar?.info?.input?.method??'GET',
    accepts:Array.isArray(row.accepts)?row.accepts:[]}));
}
export async function retainCatalog(state,raw) {
  const rows=catalogRows(raw),sha256=hash(raw),directory=await privateDirectory(join(state,'catalogs'));
  try{await writeBytes(join(directory,sha256+'.json'),raw,{exclusive:true});}
  catch(e){if(e.code!=='EEXIST')throw e;requireValue(hash(await readBytes(join(directory,sha256+'.json'),1048576))===sha256,'CATALOG_BYTES_CHANGED',409);}
  return {sha256,bytes:raw.length,rows};
}
