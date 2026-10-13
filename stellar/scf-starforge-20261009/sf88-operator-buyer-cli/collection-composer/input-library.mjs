// MIT — Private, resumable local files for the original request-plan editor.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { initializationDirectory, initializationBytes, optionalInitializationBytes,
  retainInitializationFile, retainInitializationRecord, syncInitializationDirectory } from '../initialization.mjs';
import { need, fields } from './plan.mjs';
import { INPUT_UPLOAD_SCHEMA, INPUT_CHUNK_BYTES, INPUT_LIMITS, validateInputManifest,
  inputManifestJson, inputId, inputChunkLength } from './input-format.mjs';
const STATUS = 'stellar-forge.sf88.collection-input-status.v1';
const INPUT = 'stellar-forge.sf88.collection-input.v1';
const UPLOAD = 'stellar-forge.sf88.collection-input-retention.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { need(false, 'COLLECTION_INPUT_RECORD_INVALID'); }
};
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'COLLECTION_INPUT_UNAVAILABLE';
const filename = name => {
  const result = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0,150);
  return result && result !== '.' && result !== '..' ? result : 'saved-input.bin';
};
function privateFile(info) {
  return info.isFile() && (info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid());
}
function unchanged(a,b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
/** Full verification uses one bounded buffer and the same held regular-file descriptor. */
async function verifyFile(path, bytes, expected, manifest) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(privateFile(before) && before.size === bytes, 'COLLECTION_INPUT_FILE_CHANGED');
    const digest = createHash('sha256'), buffer = Buffer.alloc(INPUT_CHUNK_BYTES);
    let offset = 0;
    while (offset < bytes) {
      const length = Math.min(buffer.length,bytes-offset); let read = 0;
      while (read < length) {
        const part = await handle.read(buffer,read,length-read,offset+read);
        need(part.bytesRead > 0, 'COLLECTION_INPUT_FILE_CHANGED'); read += part.bytesRead;
      }
      const part = buffer.subarray(0,length);
      if (manifest) need(hash(part) === manifest.chunkSha256[offset / INPUT_CHUNK_BYTES],
        'COLLECTION_INPUT_FILE_CHANGED');
      digest.update(part); offset += length;
    }
    const actual = digest.digest('hex'), after = await handle.stat();
    need(unchanged(before,after) && (!expected || actual === expected), 'COLLECTION_INPUT_FILE_CHANGED');
    return actual;
  } finally { await handle.close(); }
}
async function chunkBytes(source, expected) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    need(source.length === expected, 'COLLECTION_INPUT_CHUNK_SIZE_INVALID');
    return Buffer.from(source);
  }
  need(source && typeof source[Symbol.asyncIterator] === 'function', 'COLLECTION_INPUT_CHUNK_REQUIRED');
  const parts = []; let bytes = 0;
  for await (const part of source) {
    need(Buffer.isBuffer(part) || part instanceof Uint8Array, 'COLLECTION_INPUT_CHUNK_INVALID');
    bytes += part.length;
    need(bytes <= expected, 'COLLECTION_INPUT_CHUNK_SIZE_INVALID');
    parts.push(part);
  }
  need(bytes === expected, 'COLLECTION_INPUT_CHUNK_SIZE_INVALID');
  return Buffer.concat(parts,bytes);
}
export function openCollectionInputLibrary({directory,mutate,live,inspectCatalog}) {
  need(typeof directory === 'string' && typeof mutate === 'function' && typeof live === 'function'
    && typeof inspectCatalog === 'function', 'COLLECTION_INPUT_LIBRARY_INVALID');
  const root = join(directory,'local-inputs');
  const folder = id => join(root,inputId(id));
  const chunkPath = (id,index) => join(folder(id),'chunks',String(index).padStart(6,'0') + '.bin');
  async function rootExists() {
    live();
    try { await initializationDirectory(root); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function retained(id) {
    live(); inputId(id);
    need(await rootExists(), 'COLLECTION_INPUT_NOT_FOUND');
    const base = folder(id);
    try { await initializationDirectory(base); }
    catch (error) { if (error.code === 'ENOENT') need(false,'COLLECTION_INPUT_NOT_FOUND'); throw error; }
    const raw = await optionalInitializationBytes(join(base,'upload.json'),16384);
    need(raw !== null, 'COLLECTION_INPUT_NOT_FOUND');
    const record = parse(raw);
    fields(record,['schema','uploadId','manifest','createdAt'],'COLLECTION_INPUT_RECORD_INVALID');
    const manifest = validateInputManifest(record.manifest);
    need(record.schema === UPLOAD && record.uploadId === id
      && hash(inputManifestJson(manifest)) === id
      && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt)),
      'COLLECTION_INPUT_RECORD_INVALID');
    return {...record,manifest};
  }
  async function ready(record,verify = true) {
    const path = join(folder(record.uploadId),'input.json');
    const raw = await optionalInitializationBytes(path,16384);
    if (raw === null) return null;
    const value = parse(raw), manifest = record.manifest;
    fields(value,['schema','id','kind','name','bytes','sha256','path','createdAt','catalog'],
      'COLLECTION_INPUT_RECORD_INVALID');
    need(value.schema === INPUT && value.id === record.uploadId && value.kind === manifest.kind
      && value.name === manifest.name && value.bytes === manifest.bytes
      && /^[a-f0-9]{64}$/.test(value.sha256 ?? '') && value.path === join(folder(record.uploadId),'source.bin')
      && value.createdAt === record.createdAt, 'COLLECTION_INPUT_RECORD_INVALID');
    if (manifest.kind === 'catalog') need(value.catalog && Number.isSafeInteger(value.catalog.rowCount)
      && value.catalog.rowCount >= 0 && (value.catalog.source === null || typeof value.catalog.source === 'string'),
      'COLLECTION_INPUT_RECORD_INVALID');
    else need(value.catalog === undefined, 'COLLECTION_INPUT_RECORD_INVALID');
    if (verify) await verifyFile(value.path,value.bytes,value.sha256,manifest);
    return value;
  }
  async function chunks(record,verify = true) {
    const receivedChunks = []; let receivedBytes = 0;
    await initializationDirectory(join(folder(record.uploadId),'chunks'));
    for (let index=0; index<record.manifest.chunkSha256.length; index++) {
      const path = chunkPath(record.uploadId,index), length = inputChunkLength(record.manifest,index);
      if (verify) {
        const bytes = await optionalInitializationBytes(path,INPUT_CHUNK_BYTES);
        if (bytes === null) continue;
        need(bytes.length === length && hash(bytes) === record.manifest.chunkSha256[index],
          'COLLECTION_INPUT_CHUNK_CHANGED');
      } else {
        const file = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          .catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if (file === null) continue;
        try { const info=await file.stat();
          need(privateFile(info) && info.size===length,'COLLECTION_INPUT_CHUNK_CHANGED');
        } finally { await file.close(); }
      }
      receivedChunks.push(index); receivedBytes += length;
    }
    return {receivedChunks,receivedBytes};
  }
  async function status(record,verify = true) {
    const input = await ready(record,verify);
    const progress = input
      ? {receivedBytes:input.bytes,receivedChunks:record.manifest.chunkSha256.map((_,index)=>index)}
      : await chunks(record,verify);
    return {schema:STATUS,uploadId:record.uploadId,manifest:record.manifest,
      phase:input?'READY':'UPLOADING',...progress,chunkBytes:INPUT_CHUNK_BYTES,...(input?{input}:{})};
  }
  async function begin({manifest}={}) {
    manifest = validateInputManifest(manifest);
    const uploadId = hash(inputManifestJson(manifest));
    return mutate(async()=>{
      await initializationDirectory(root,{create:true});
      await initializationDirectory(folder(uploadId),{create:true});
      await initializationDirectory(join(folder(uploadId),'chunks'),{create:true});
      const record = await retainInitializationRecord(join(folder(uploadId),'upload.json'),
        {schema:UPLOAD,uploadId,manifest,createdAt:new Date().toISOString()},
        {resume:true,ignore:['createdAt']});
      return status(record);
    });
  }
  async function inspect({uploadId}={}) { return status(await retained(uploadId)); }
  async function receiveChunk({uploadId,index,source}={}) {
    inputId(uploadId);
    return mutate(async()=>{
      const record = await retained(uploadId), expected = inputChunkLength(record.manifest,index);
      const bytes = await chunkBytes(source,expected), sha256 = hash(bytes);
      need(sha256 === record.manifest.chunkSha256[index], 'COLLECTION_INPUT_CHUNK_HASH_MISMATCH');
      if (!await ready(record,false)) await retainInitializationFile(chunkPath(uploadId,index),bytes,{resume:true});
      return {schema:'stellar-forge.sf88.collection-input-chunk.v1',uploadId,index,bytes:expected,sha256};
    });
  }
  async function complete({uploadId}={}) {
    inputId(uploadId);
    return mutate(async()=>{
      const record = await retained(uploadId);
      if (await ready(record)) return status(record,false);
      const available = await chunks(record);
      need(available.receivedChunks.length === record.manifest.chunkSha256.length,
        'COLLECTION_INPUT_UPLOAD_INCOMPLETE');
      const base = folder(uploadId), target = join(base,'source.bin');
      const temporary = join(base,'.assembling-'+randomUUID());
      const file = await open(temporary,'wx',0o600), digest = createHash('sha256');
      let bytes = 0;
      try {
        try {
          for (let index=0; index<record.manifest.chunkSha256.length; index++) {
            const part = await initializationBytes(chunkPath(uploadId,index),INPUT_CHUNK_BYTES);
            need(part.length === inputChunkLength(record.manifest,index)
              && hash(part) === record.manifest.chunkSha256[index], 'COLLECTION_INPUT_CHUNK_CHANGED');
            digest.update(part); bytes += part.length; await file.writeFile(part);
          }
          need(bytes === record.manifest.bytes, 'COLLECTION_INPUT_SIZE_INVALID');
          await file.sync();
        } finally { await file.close(); }
        const sha256 = digest.digest('hex');
        try { await link(temporary,target); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await verifyFile(target,bytes,sha256,record.manifest);
        }
        await syncInitializationDirectory(base);
        const catalog = record.manifest.kind === 'catalog' ? await inspectCatalog({path:target}) : null;
        if (catalog) need(catalog.sha256 === sha256 && catalog.bytes === bytes,
          'COLLECTION_INPUT_CATALOG_CHANGED');
        const input = {schema:INPUT,id:uploadId,kind:record.manifest.kind,name:record.manifest.name,
          bytes,sha256,path:target,createdAt:record.createdAt,
          ...(catalog?{catalog:{source:catalog.source,rowCount:catalog.rows.length}}:{})};
        await retainInitializationRecord(join(base,'input.json'),input,{resume:true});
        // The immutable READY record is durable before removing duplicate chunk bytes.
        // A resumed READY upload uses the complete source; interrupted cleanup is harmless.
        for (let index=0; index<record.manifest.chunkSha256.length; index++)
          await unlink(chunkPath(uploadId,index)).catch(error=>{if(error.code!=='ENOENT')throw error;});
        await syncInitializationDirectory(join(base,'chunks'));
        return {schema:STATUS,uploadId,manifest:record.manifest,phase:'READY',
          receivedBytes:bytes,receivedChunks:record.manifest.chunkSha256.map((_,index)=>index),
          chunkBytes:INPUT_CHUNK_BYTES,input};
      } finally { await unlink(temporary).catch(()=>{}); }
    });
  }
  async function list({kind,query='',offset=0,limit=50}={}) {
    live();
    need(kind === undefined || Object.hasOwn(INPUT_LIMITS,kind), 'COLLECTION_INPUT_KIND_INVALID');
    need(typeof query === 'string' && query.length<=180
      && Number.isSafeInteger(offset) && offset>=0 && Number.isSafeInteger(limit) && limit>=1 && limit<=100,
      'COLLECTION_INPUT_LIST_INVALID');
    const inputs = [];
    if (await rootExists()) {
      const entries = await readdir(root,{withFileTypes:true});
      for (const entry of entries) {
        if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;
        try {
          const record = await retained(entry.name);
          if ((kind && record.manifest.kind!==kind)
            || !record.manifest.name.toLowerCase().includes(query.toLowerCase())) continue;
          const input = await ready(record,false);
          const progress = input ? {receivedBytes:input.bytes} : await chunks(record,false);
          inputs.push({id:entry.name,name:record.manifest.name,kind:record.manifest.kind,bytes:record.manifest.bytes,
            phase:input?'READY':'UPLOADING',receivedBytes:progress.receivedBytes,createdAt:record.createdAt,
            ...(input?{sha256:input.sha256}:{})});
        } catch(error) { inputs.push({id:entry.name,name:entry.name,phase:'UNAVAILABLE',error:codeOf(error)}); }
      }
    }
    inputs.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'') || a.id.localeCompare(b.id));
    return {schema:'stellar-forge.sf88.collection-inputs.v1',inputs:inputs.slice(offset,offset+limit),
      total:inputs.length,offset,limit,hasMore:offset+limit<inputs.length,limits:INPUT_LIMITS,chunkBytes:INPUT_CHUNK_BYTES};
  }
  async function file({uploadId}={}) {
    const record = await retained(uploadId), input = await ready(record);
    need(input, 'COLLECTION_INPUT_NOT_READY');
    return {path:input.path,name:filename(input.name),bytes:input.bytes,sha256:input.sha256,
      contentType:input.kind==='catalog'?'application/json':'application/octet-stream'};
  }
  async function catalog({uploadId}={}) {
    const record = await retained(uploadId);
    need(record.manifest.kind==='catalog', 'COLLECTION_INPUT_CATALOG_REQUIRED');
    const input = await ready(record); need(input, 'COLLECTION_INPUT_NOT_READY');
    const value = await inspectCatalog({path:input.path});
    need(value.sha256===input.sha256 && value.bytes===input.bytes, 'COLLECTION_INPUT_CATALOG_CHANGED');
    return value;
  }
  return Object.freeze({begin,inspect,receiveChunk,complete,list,file,catalog});
}
