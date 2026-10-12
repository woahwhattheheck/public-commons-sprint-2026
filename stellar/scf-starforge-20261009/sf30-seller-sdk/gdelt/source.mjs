// MIT. Retain original official GDELT responses; resume one selected update.
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runGdeltPython } from './python.mjs';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { readBytes, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { CAPTURE, GKG_CAPTURE, GKG_CODEBOOK_URL, LIMITS, MANIFEST_URL, ATTRIBUTION, CODEBOOK_URL, need, plain, clone,
  canonical, hash, digest, jsonBytes, isHash, batchId, parseManifest, parseTable } from './model.mjs';

export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function durableDirectory(path) {
  path = resolve(path);
  await privateDirectory(path);
  // Repeated calls settle the mkdir-before-fsync boundary, including ancestors.
  for (let current=path;; current=dirname(current)) {
    await syncDirectory(current);
    if (current === dirname(current)) break;
  }
  return path;
}
export async function optionalJson(path, max=LIMITS.captureBytes) {
  try { return await readPrivateJson(path,max); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** Caller holds the original project/capture lock. Use atomic rename, avoiding
 * temporary hard-link aliases across a killed no-overwrite publication. */
export async function exactFile(directory, name, bytes) {
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name), 'Use one retained flat filename.');
  const path=join(directory,name);
  let existing;
  try { existing=await readBytes(path,Math.max(bytes.length,1)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) need(existing.equals(bytes), 'Retained immutable bytes differ: '+name, 'GDELT_FILE_CONFLICT',409);
  else await writeBytes(path,bytes);
  await syncDirectory(directory);
}
function md5(bytes) { return createHash('md5').update(bytes).digest('hex'); }
export function gdeltCaptureFormat(value) {
  need(value?.schema===CAPTURE||value?.schema===GKG_CAPTURE,'Select an original Events/Mentions or GKG capture.');
  return value.schema===GKG_CAPTURE?'gkg':'events-mentions';
}
export function gdeltCaptureCodebook(value) {
  return gdeltCaptureFormat(value)==='gkg'?GKG_CODEBOOK_URL:CODEBOOK_URL;
}
function sourceIdentity(value) {
  return { schema:value.schema, batch:value.batch, manifest:value.manifest, sources:value.sources,
    attribution:ATTRIBUTION, codebookUrl:gdeltCaptureCodebook(value) };
}
export function inspectGdeltCapture(capture) {
  const format=gdeltCaptureFormat(capture),kinds=format==='gkg'?['gkg']:['events','mentions'];
  need(capture.attribution === ATTRIBUTION && capture.codebookUrl === gdeltCaptureCodebook(capture) && isHash(capture.captureId) &&
    capture.captureId === digest(sourceIdentity(capture)), 'The retained GDELT capture identity changed.');
  const batch=batchId(capture.batch), manifest=validateManifestRecord(capture.manifest,batch,format);
  need(Array.isArray(capture.sources) && capture.sources.length===kinds.length,'A complete source capture retains its exact declared source family.');
  const models={};
  for (const descriptor of manifest.selected) {
    const choices=capture.sources.filter(item=>item.kind===descriptor.kind);
    need(choices.length===1,'The retained original source inventory changed.');
    const source=choices[0], bytes=sourceBytes(source);
    need(canonical(source.request)===canonical(descriptor) && source.url===descriptor.url && source.status===200 &&
      bytes.length===descriptor.bytes && md5(bytes)===descriptor.md5,'Original ZIP differs from its published GDELT manifest.');
    need(plain(source.table) && source.table.member===descriptor.member && typeof source.table.text==='string' &&
      Buffer.byteLength(source.table.text)===source.table.bytes && hash(Buffer.from(source.table.text))===source.table.sha256 &&
      /^[a-f0-9]{8}$/.test(source.table.crc32 ?? ''),'The original decoded GDELT table changed.');
    models[source.kind]=parseTable(source.table.text,source.kind,batch);
  }
  return { captureId:capture.captureId,batch,
    ...(format==='gkg'?{format,articles:models.gkg,events:[],mentions:[],counts:{articles:models.gkg.length}}:
      {events:models.events,mentions:models.mentions,counts:{events:models.events.length,mentions:models.mentions.length}}),attribution:ATTRIBUTION,
    sources:capture.sources.map(source=>({kind:source.kind,url:source.request.advertisedUrl,
      zipBytes:source.bytes,zipSha256:source.sha256,md5:source.request.md5,tableSha256:source.table.sha256,
      tableBytes:source.table.bytes,receivedAt:source.receivedAt})) };
}
export function sourceBytes(source) {
  need(plain(source) && typeof source.zipBase64==='string' && source.zipBase64.length<=Math.ceil(LIMITS.zipBytes/3)*4,
    'Invalid retained GDELT ZIP bytes.');
  const bytes=Buffer.from(source.zipBase64,'base64');
  need(bytes.length<=LIMITS.zipBytes && bytes.toString('base64')===source.zipBase64 &&
    bytes.length===source.bytes && hash(bytes)===source.sha256,'Retained GDELT ZIP encoding or hash changed.');
  return bytes;
}
export function validateManifestRecord(record,selectedBatch,format='events-mentions') {
  need(plain(record) && [MANIFEST_URL,'https://data.gdeltproject.org/gdeltv2/masterfilelist.txt'].includes(record.url) &&
    [200,206].includes(record.status) && typeof record.body==='string' &&
    Buffer.byteLength(record.body)===record.bytes && hash(Buffer.from(record.body))===record.sha256 &&
    typeof record.receivedAt==='string' && Number.isFinite(Date.parse(record.receivedAt)),
    'Use a complete retained official GDELT manifest response.');
  if (record.status===206) {
    const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(record.headers?.['content-range']??'');
    need(match,'A partial manifest retains its original Content-Range.');
    const [start,end,total]=match.slice(1).map(Number);
    need([start,end,total].every(Number.isSafeInteger)&&start>=0&&end>=start&&total>end&&end-start+1===record.bytes,
      'The retained manifest range differs from its original response bytes.');
  }
  // Optional complete-line extraction is explicit, with the full range body retained.
  let text=record.body;
  if (record.status===206) {
    const start=Number(/^bytes (\d+)-/.exec(record.headers['content-range'])[1]);
    if (start>0) text=text.slice(text.indexOf('\n')+1);
    if (!text.endsWith('\n')) text=text.slice(0,text.lastIndexOf('\n')+1);
  }
  return parseManifest(text,{selectedBatch,format});
}
async function responseBytes(response,limit,signal) {
  const length=response.headers.get('content-length');
  need(length===null || /^\d+$/.test(length) && Number(length)<=limit,'Source response exceeds the selected capacity.','GDELT_SOURCE_TOO_LARGE',413);
  need(response.body,'GDELT returned an empty HTTP body.','GDELT_SOURCE_UNAVAILABLE',502);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true) {
      signal.throwIfAborted();
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.length;need(size<=limit,'Source response exceeds its selected capacity.','GDELT_SOURCE_TOO_LARGE',413);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,size);
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
function cooldown(response) {
  const value=response.headers.get('retry-after');
  if(value && /^\d+$/.test(value)) {
    const seconds=Number(value),when=Date.now()+seconds*1000;
    if(Number.isSafeInteger(seconds)&&Number.isFinite(new Date(when).valueOf()))
      return new Date(when).toISOString();
  }
  const when=Date.parse(value??'');
  if(Number.isFinite(when))return new Date(Math.max(Date.now(),when)).toISOString();
  return new Date(Date.now()+60000).toISOString();
}
async function originalGet(url,{limit,signal,fetchImpl=globalThis.fetch,headers={}}={}) {
  const parsed=new URL(url);
  need(parsed.origin==='https://data.gdeltproject.org' && !parsed.username && !parsed.password &&
    !parsed.hash && !parsed.search && /^\/gdeltv2\/(?:lastupdate\.txt|masterfilelist\.txt|\d{14}\.(?:(?:export|mentions)\.CSV|gkg\.csv)\.zip)$/.test(parsed.pathname),
    'Use the selected official GDELT source URL.');
  const abort=AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]);
  const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:abort,
    headers:{accept:'application/octet-stream','accept-encoding':'identity',...headers}});
  if (![200,206].includes(response.status)) {
    const retryAt=[429,503].includes(response.status)?cooldown(response):null;
    await response.body?.cancel().catch(()=>{});
    throw Object.assign(new Error('GDELT returned HTTP '+response.status+'.'),{
      code:response.status===429?'GDELT_RATE_LIMITED':'GDELT_SOURCE_UNAVAILABLE',
      status:response.status>=400&&response.status<=599?response.status:502,...(retryAt?{retryAt}:{})});
  }
  let bytes;
  try {
    need(!response.headers.get('content-encoding') || response.headers.get('content-encoding')==='identity',
      'Preserve the original unencoded GDELT response bytes.');
    bytes=await responseBytes(response,limit,abort);
  } catch(error) {
    await response.body?.cancel().catch(()=>{});
    throw error;
  }
  const retainedHeaders={};
  for(const name of ['content-type','content-length','content-range','date','etag','last-modified']) {
    const value=response.headers.get(name);
    if(value!==null&&value.length<=2048)retainedHeaders[name]=value;
  }
  return {url,status:response.status,headers:retainedHeaders,receivedAt:new Date().toISOString(),
    bytes:bytes.length,sha256:hash(bytes),bodyBytes:bytes};
}
export async function discoverGdelt({signal,fetchImpl,history=false,format='events-mentions'}={}) {
  need(typeof history==='boolean','history must be boolean.');
  need(['events-mentions','gkg'].includes(format),'Choose the original source family before source discovery.');
  const url=history?'https://data.gdeltproject.org/gdeltv2/masterfilelist.txt':MANIFEST_URL;
  const record=await originalGet(url,{limit:LIMITS.manifestBytes,signal,fetchImpl,
    headers:history?{range:'bytes=-262144'}:{}});
  const {bodyBytes,...metadata}=record;
  const manifest={...metadata,body:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bodyBytes)};
  const selected=validateManifestRecord(manifest,undefined,format);
  return {manifest,...selected};
}
export async function decodeGdeltZip(bytes,member,{python,signal}={}) {
  const table=await runGdeltPython('zip_decode.py',{member,zip_base64:bytes.toString('base64')},
    {python,signal,maxOutputBytes:LIMITS.tableBytes*2+65536});
  need(table.member===member&&table.bytes===Buffer.byteLength(table.text)&&hash(Buffer.from(table.text))===table.sha256,
    'The standard ZIP decoder returned a changed table.');
  return table;
}
export async function verifyGdeltCapture(capture,options={}) {
  const model=inspectGdeltCapture(capture);
  for(const source of capture.sources) {
    const decoded=await decodeGdeltZip(sourceBytes(source),source.request.member,options);
    need(canonical(decoded)===canonical(source.table),'Decoded source differs from its original ZIP.','GDELT_SOURCE_BINDING_CHANGED');
  }
  return model;
}
export async function readGdeltCapture(directory) {
  const capture=await readPrivateJson(join(resolve(directory),'capture.json'),LIMITS.captureBytes);
  inspectGdeltCapture(capture);return capture;
}
export async function storeGdeltCapture(directory,capture,{verified=false,...options}={}) {
  directory=await durableDirectory(directory);
  const model=verified?inspectGdeltCapture(capture):await verifyGdeltCapture(capture,options);
  await withPrivateLock(directory,'capture.lock',()=>exactFile(directory,'capture.json',jsonBytes(capture)));
  return {directory,captureId:capture.captureId,model};
}
export async function captureGdelt({directory,batch,manifest:suppliedManifest,format='events-mentions',signal,fetchImpl,python,onProgress}={}) {
  need(['events-mentions','gkg'].includes(format),'Choose the original source family.');
  directory=await durableDirectory(directory);
  if(batch!==undefined)batchId(batch);
  const selection={batch:batch??null,manifestSha256:suppliedManifest?.sha256??null,...(format==='gkg'?{format}:{})};
  return withPrivateLock(directory,'capture.lock',async()=>{
    const complete=await optionalJson(join(directory,'capture.json'));
    const current=await optionalJson(join(directory,'progress.json'));
    if(current)need(canonical(current.selection)===canonical(selection),'This acquisition ID belongs to another source selection.','GDELT_OPERATION_CONFLICT',409);
    if(complete) {
      const model=inspectGdeltCapture(complete);
      need((batch===undefined||model.batch===batch)&&gdeltCaptureFormat(complete)===format,'Completed capture belongs to another update or source family.');
      return {directory,capture:complete,model,reused:true};
    }
    const progress=current??{schema:'stellar-forge.gdelt-acquisition.v1',selection,state:'CAPTURING',
      startedAt:new Date().toISOString(),manifest:null,sources:[],lastError:null};
    need(progress.schema==='stellar-forge.gdelt-acquisition.v1'&&Array.isArray(progress.sources),'Retained acquisition progress changed.');
    if(progress.lastError?.retryAt&&Date.parse(progress.lastError.retryAt)>Date.now())
      throw Object.assign(new Error('Continue the same acquisition after GDELT’s retained retry time.'),
        {code:'GDELT_RATE_LIMITED',status:429,retryAt:progress.lastError.retryAt});
    await atomicJson(directory,'progress.json',progress);
    try {
      if(!progress.manifest) {
        progress.manifest=suppliedManifest??(await discoverGdelt({signal,fetchImpl,format})).manifest;
        validateManifestRecord(progress.manifest,batch,format);
        await atomicJson(directory,'progress.json',progress);
      }
      const selected=validateManifestRecord(progress.manifest,batch,format);
      for(const request of selected.selected) {
        signal?.throwIfAborted();
        let source=progress.sources.find(item=>item.kind===request.kind);
        if(!source) {
          const received=await originalGet(request.url,{limit:Math.max(request.bytes,1),signal,fetchImpl});
          const {bodyBytes,...metadata}=received;
          need(received.status===200&&bodyBytes.length===request.bytes&&md5(bodyBytes)===request.md5,
            'GDELT ZIP differs from its exact advertised size or MD5.','GDELT_SOURCE_CHANGED',409);
          source={kind:request.kind,request,...metadata,zipBase64:bodyBytes.toString('base64'),table:null};
          progress.sources.push(source);progress.lastError=null;
          await atomicJson(directory,'progress.json',progress);
          await onProgress?.({phase:'SOURCE_RETAINED',kind:request.kind,batch:selected.batch,bytes:source.bytes,sha256:source.sha256});
        } else need(canonical(source.request)===canonical(request),'Retained source request changed.');
        if(!source.table) {
          source.table=await decodeGdeltZip(sourceBytes(source),request.member,{python,signal});
          parseTable(source.table.text,request.kind,selected.batch);
          await atomicJson(directory,'progress.json',progress);
        }
      }
      const capture={schema:format==='gkg'?GKG_CAPTURE:CAPTURE,batch:selected.batch,manifest:progress.manifest,
        sources:progress.sources,attribution:ATTRIBUTION,codebookUrl:format==='gkg'?GKG_CODEBOOK_URL:CODEBOOK_URL};
      capture.captureId=digest(sourceIdentity(capture));
      const model=inspectGdeltCapture(capture);
      need(jsonBytes(capture).length<=LIMITS.captureBytes,'Complete source capture exceeds192 MiB.','GDELT_SOURCE_TOO_LARGE',413);
      await exactFile(directory,'capture.json',jsonBytes(capture));
      progress.state='COMPLETE';progress.completedAt=new Date().toISOString();progress.lastError=null;
      await atomicJson(directory,'progress.json',progress);
      return {directory,capture,model,reused:false};
    } catch(error) {
      progress.state='INTERRUPTED';progress.lastError={code:error.code??'GDELT_CAPTURE_INTERRUPTED',
        message:String(error.message).slice(0,2048),at:new Date().toISOString(),retryAt:error.retryAt??null};
      await atomicJson(directory,'progress.json',progress);
      throw error;
    }
  });
}
