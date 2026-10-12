// MIT. Native Eurostat response capture and portable reviewed source declarations.
import { open, lstat, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytes, digest, identity, readPrivate, readJson, createFile, privateDirectory, syncDirectory } from '../postgres/publisher/files.mjs';
import { EUROSTAT_SOURCE_SCHEMA, EUROSTAT_CAPTURE_SCHEMA, MAX_RESPONSE_BYTES, object, need, fault, stable,
  parseJsonStat, inspectCube, normalizeQuery, queryColumns } from './model.mjs';

export const API_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/';
export const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const decode = input => new TextDecoder('utf-8', { fatal: true }).decode(input);
const only = (v, keys, code) => need(object(v) && Object.keys(v).every(k => keys.includes(k)), code);
export function officialUrl(input) {
  need(typeof input === 'string' && input.length <= 8192, 'EUROSTAT_URL_INVALID');
  let u; try { u = new URL(input); } catch { throw fault('EUROSTAT_URL_INVALID'); }
  need(u.href.startsWith(API_BASE) && u.origin === 'https://ec.europa.eu' && !u.username && !u.password &&
    !u.hash && ID.test(u.pathname.slice(new URL(API_BASE).pathname.length)), 'EUROSTAT_OFFICIAL_URL_REQUIRED',
    'Use the direct Eurostat Statistics API dataset URL.');
  const options = new Map();
  for (const [key, value] of u.searchParams) {
    const k = key.toLowerCase();
    need(/^[a-z][a-z0-9_]{0,127}$/.test(k) && value.length >= 1 && value.length <= 256 &&
      !/[\u0000-\u001f\u007f]/.test(value), 'EUROSTAT_QUERY_PARAMETER');
    const all = options.get(k) ?? []; need(!all.includes(value), 'EUROSTAT_QUERY_DUPLICATE');
    all.push(value); options.set(k, all);
  }
  for (const key of ['lang', 'format', 'lasttimeperiod', 'sincetimeperiod', 'untiltimeperiod', 'geolevel'])
    need(!options.has(key) || options.get(key).length === 1, 'EUROSTAT_QUERY_PARAMETER');
  need(!options.has('lang') || ['EN','FR','DE'].includes(options.get('lang')[0].toUpperCase()), 'EUROSTAT_LANGUAGE');
  need(!options.has('format') || options.get('format')[0].toUpperCase() === 'JSON', 'EUROSTAT_FORMAT');
  need(!options.has('geo') || !options.has('geolevel'), 'EUROSTAT_GEOGRAPHY_FILTER');
  const timeGroups = [options.has('time'), options.has('time_period'), options.has('lasttimeperiod'),
    options.has('sincetimeperiod') || options.has('untiltimeperiod')].filter(Boolean).length;
  need(timeGroups <= 1, 'EUROSTAT_TIME_FILTER', 'Choose exact periods, a range, or lastTimePeriod.');
  if (options.has('lasttimeperiod')) need(/^[1-9][0-9]{0,3}$/.test(options.get('lasttimeperiod')[0]), 'EUROSTAT_TIME_FILTER');
  return u.href;
}
export function buildSourceUrl(value) {
  only(value, ['dataset','language','dimensions','time','geoLevel'], 'EUROSTAT_REQUEST_INVALID');
  need(typeof value.dataset === 'string' && ID.test(value.dataset), 'EUROSTAT_DATASET_CODE');
  const u = new URL(API_BASE + value.dataset), lang = value.language ?? 'EN';
  u.searchParams.set('lang', lang);
  const dimensions = value.dimensions ?? {};
  need(object(dimensions), 'EUROSTAT_QUERY_PARAMETER');
  for (const [key, values] of Object.entries(dimensions)) {
    need(!['lang','format','lasttimeperiod','sincetimeperiod','untiltimeperiod','geolevel','time','time_period'].includes(key.toLowerCase()),
      'EUROSTAT_RESERVED_PARAMETER');
    need(Array.isArray(values) && values.length > 0 && values.every(v => typeof v === 'string'), 'EUROSTAT_QUERY_PARAMETER');
    for (const v of values) u.searchParams.append(key, v);
  }
  if (value.geoLevel !== undefined) u.searchParams.set('geoLevel', value.geoLevel);
  if (value.time !== undefined) {
    only(value.time, ['periods','since','until','last'], 'EUROSTAT_TIME_FILTER');
    const t=value.time;
    if (t.periods !== undefined) { need(Array.isArray(t.periods) && t.periods.length > 0, 'EUROSTAT_TIME_FILTER');
      for (const p of t.periods) { need(typeof p === 'string', 'EUROSTAT_TIME_FILTER'); u.searchParams.append('time',p); } }
    if (t.since !== undefined) u.searchParams.set('sinceTimePeriod',t.since);
    if (t.until !== undefined) u.searchParams.set('untilTimePeriod',t.until);
    if (t.last !== undefined) { need(Number.isSafeInteger(t.last), 'EUROSTAT_TIME_FILTER'); u.searchParams.set('lastTimePeriod',String(t.last)); }
  }
  return officialUrl(u.href);
}
/** Public source inputs may be mode 0644. The retained copy is always private. */
export async function readOriginalFile(path, maximum = MAX_RESPONSE_BYTES) {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before=await file.stat(); need(before.isFile() && before.size <= maximum, 'EUROSTAT_INPUT_FILE');
    const data=Buffer.alloc(before.size+1); let n=0;
    while(n<data.length) { const part=await file.read(data,n,data.length-n,null); if(!part.bytesRead)break; n+=part.bytesRead; }
    const after=await file.stat();
    need(n===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs,
      'EUROSTAT_INPUT_CHANGED');
    return data.subarray(0,n);
  } finally { await file.close(); }
}
export function describeCapture({ body, sourceUrl, retrievedAt, transport = {kind:'operator-retained-original',httpStatus:null} }) {
  need(Buffer.isBuffer(body) && body.length > 0 && body.length <= MAX_RESPONSE_BYTES, 'EUROSTAT_RESPONSE_SIZE');
  sourceUrl=officialUrl(sourceUrl);
  need(typeof retrievedAt==='string' && /^\d{4}-\d\d-\d\dT/.test(retrievedAt) && Number.isFinite(Date.parse(retrievedAt)), 'EUROSTAT_RETRIEVED_AT');
  only(transport,['kind','httpStatus','headers','operationId','attempt','nativeFileUploadId','note'],'EUROSTAT_TRANSPORT_RECORD');
  need(typeof transport.kind==='string' && transport.kind.length<=128 && (transport.httpStatus===null ||
    Number.isSafeInteger(transport.httpStatus) && transport.httpStatus>=100 && transport.httpStatus<=599), 'EUROSTAT_TRANSPORT_RECORD');
  if(transport.headers!==undefined) need(Array.isArray(transport.headers) && transport.headers.length<=256 &&
    transport.headers.every(x=>Array.isArray(x)&&x.length===2&&x.every(v=>typeof v==='string'&&v.length<=16384)&&
    !['authorization','cookie','set-cookie','proxy-authorization'].includes(x[0].toLowerCase())), 'EUROSTAT_PUBLIC_HEADERS');
  const cube=parseJsonStat(decode(body)), response={file:'response.json',bytes:body.length,sha256:digest(body)};
  const id=identity({sourceUrl,retrievedAt,responseSha256:response.sha256});
  return {capture:{schema:EUROSTAT_CAPTURE_SCHEMA,id,sourceUrl,retrievedAt,transport,
    response,cube:inspectCube(cube)},cube};
}
export async function retainCapture(directory, input) {
  const {capture,cube}=describeCapture(input), destination=join(directory,capture.id);
  await privateDirectory(directory,true);
  const prepared=bytes(capture);
  let exists=false; try{await lstat(destination);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(exists) {
    const original=await readCapture(join(destination,'capture.json'));
    need(original.captureBytes.equals(prepared) && original.body.equals(input.body), 'EUROSTAT_CAPTURE_EXISTS_CHANGED',undefined,409);
  } else {
    const temp=join(directory,'.capture-'+randomUUID());await privateDirectory(temp,true);
    try{
      await createFile(join(temp,'response.json'),input.body);await createFile(join(temp,'capture.json'),prepared);
      await syncDirectory(temp);await rename(temp,destination);await syncDirectory(directory);
    }catch(e){await rm(temp,{recursive:true,force:true});throw e;}
  }
  return {capture,cube,captureFile:join(destination,'capture.json'),captureSha256:digest(prepared),reused:exists};
}
export async function readCapture(path) {
  const captureBytes=await readPrivate(path,4*1024*1024), capture=JSON.parse(decode(captureBytes));
  need(capture.schema===EUROSTAT_CAPTURE_SCHEMA && HASH.test(capture.id??'') &&
    capture.response?.file==='response.json' && HASH.test(capture.response.sha256??''), 'EUROSTAT_CAPTURE_INVALID');
  const body=await readPrivate(join(dirname(path),'response.json'),MAX_RESPONSE_BYTES);
  need(body.length===capture.response.bytes && digest(body)===capture.response.sha256,'EUROSTAT_RESPONSE_CHANGED');
  const rebuilt=describeCapture({body,sourceUrl:capture.sourceUrl,retrievedAt:capture.retrievedAt,transport:capture.transport});
  need(stable(rebuilt.capture)===stable(capture),'EUROSTAT_CAPTURE_CHANGED');
  return {capture,cube:rebuilt.cube,body,captureBytes,captureFile:path,captureSha256:digest(captureBytes)};
}
export async function readSource(sourceFile) {
  const original=await readPrivate(sourceFile,262144), config=JSON.parse(decode(original));
  only(config,['schema','captures','queries'],'EUROSTAT_SOURCE_CONFIG');
  need(config.schema===EUROSTAT_SOURCE_SCHEMA && object(config.captures) && Object.keys(config.captures).length<=1000 &&
    object(config.queries) && Object.keys(config.queries).length<=1000,'EUROSTAT_SOURCE_CONFIG');
  const captures=Object.create(null);
  for(const [id, ref] of Object.entries(config.captures)){
    need(HASH.test(id) && object(ref) && typeof ref.file==='string' && !ref.file.includes('\\') &&
      !ref.file.startsWith('/') && ref.file.split('/').every(p=>p && p!=='.' && p!=='..') &&
      HASH.test(ref.sha256??''),'EUROSTAT_CAPTURE_REFERENCE');
    const captureFile=resolve(dirname(sourceFile),ref.file);
    need(!relative(dirname(sourceFile),captureFile).startsWith('..'+sep),'EUROSTAT_CAPTURE_REFERENCE');
    const c=await readCapture(captureFile);
    need(c.capture.id===id && c.captureSha256===ref.sha256,'EUROSTAT_CAPTURE_REFERENCE_CHANGED');
    captures[id]=c;
  }
  const queries=Object.create(null);
  for(const [name,v] of Object.entries(config.queries)){
    need(/^[a-z][a-z0-9_-]{0,63}$/.test(name),'EUROSTAT_QUERY_NAME');
    const c=captures[v?.captureId];need(c,'EUROSTAT_QUERY_CAPTURE_MISSING');
    const normalized=normalizeQuery(v,c.cube);
    need(stable(normalized)===stable(v),'EUROSTAT_QUERY_NOT_NORMALIZED');
    const columnTypes=queryColumns(c.cube).map(({name,type,nullable})=>({name,type,nullable}));
    queries[name]={...normalized,columns:columnTypes.map(x=>x.name),columnTypes,parameters:[],
      captureSha256:c.captureSha256,responseSha256:c.capture.response.sha256,
      dimensionColumns:queryColumns(c.cube),sourceUrl:c.capture.sourceUrl,sourceUpdated:c.cube.updated};
  }
  return {config,original,hash:digest(original),bytes:original.length,captures,queries};
}
export async function inspectEurostatSource(sourceFile) {
  const s=await readSource(sourceFile);
  return {hash:s.hash,bytes:s.bytes,config:s.config,queries:s.queries,
    captures:Object.fromEntries(Object.entries(s.captures).map(([id,c])=>[id,{...c.capture,captureSha256:c.captureSha256}]))};
}
/** Exactly one public GET. The caller writes its original intent before this call.
 * Body prefixes are returned on interrupted/oversized transfers; only complete
 * bodies may become captures. A 413 warning is an explicit later continuation. */
export async function acquireResponse(sourceUrl, {fetchImpl=fetch,timeoutMs=60000,maxBytes=MAX_RESPONSE_BYTES,signal}={}) {
  sourceUrl=officialUrl(sourceUrl);
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000&&Number.isSafeInteger(maxBytes)&&
    maxBytes>=1024&&maxBytes<=MAX_RESPONSE_BYTES,'EUROSTAT_ACQUISITION_LIMIT');
  const startedAt=new Date().toISOString(), controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let response=null,body=Buffer.alloc(0),bodyComplete=false,error=null;
  const chunks=[];let received=0,reader;
  try {
    response=await fetchImpl(sourceUrl,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal:controller.signal});
    reader=response.body?.getReader();
    if(reader) while(true) {
      const part=await reader.read();if(part.done){bodyComplete=true;break;}
      const chunk=Buffer.from(part.value);const remaining=maxBytes-received;
      if(chunk.length>remaining){chunks.push(chunk.subarray(0,remaining));received+=remaining;throw fault('EUROSTAT_RESPONSE_TOO_LARGE');}
      chunks.push(chunk);received+=chunk.length;
    } else bodyComplete=true;
  }catch(e){error={code:typeof e.code==='string'?e.code:controller.signal.aborted?'EUROSTAT_REQUEST_ABORTED':'EUROSTAT_REQUEST_FAILED',
    message:String(e.message??e).slice(0,2000)};try{await reader?.cancel();}catch{}}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  body=Buffer.concat(chunks);
  const headers=response?[...response.headers].filter(([k])=>!['set-cookie','authorization','cookie'].includes(k.toLowerCase())):[];
  let state=error?'INCOMPLETE':!response?.ok?'HTTP_ERROR':'RECEIVED',cube=null;
  if(bodyComplete&&body.length)try{cube=parseJsonStat(decode(body));
    if(response?.ok)state=inspectCube(cube).state;
  }catch(e){if(e.code==='EUROSTAT_ASYNC_PENDING')state='PENDING_ASYNC';
    else if(response?.ok)state='SOURCE_INVALID';error??={code:e.code??'EUROSTAT_JSON_INVALID',message:e.message};}
  return {schema:'stellar-forge.eurostat-acquisition-result.v1',sourceUrl,startedAt,finishedAt:new Date().toISOString(),
    httpStatus:response?.status??null,headers,body,bodyComplete,bodyBytes:body.length,bodySha256:digest(body),state,error,
    cube:cube?inspectCube(cube):null};
}
