// MIT — Complete, streamed, portable resource collections; no payment replay.
import { constants } from 'node:fs';
import { open, mkdir, unlink, link, rm, mkdtemp, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { absolute, directory, digest, requireValue, readSnapshot, verifyFile } from './files.mjs';
import { validateCollection } from './collections.mjs';

const SCHEMA = 'stellar-forge.sf88.resource-collection-package.v1';
const HASH = /^[a-f0-9]{64}$/;
const MAX_MANIFEST = 64 * 1024 * 1024;
const MAX_ARCHIVE = 16 * 1024 * 1024 * 1024;
const padding = length => (512-length%512)%512;
const bytesOf = value => Buffer.from(JSON.stringify(value)+'\n');
const equalStat = (a,b) => ['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const checkLimit = value => requireValue(Number.isSafeInteger(value) && value>=1024,'COLLECTION_BYTE_LIMIT_INVALID');

// POSIX USTAR regular files only. All names are our own ASCII content addresses.
function header(name,size) {
  requireValue(name==='manifest.json' || /^objects\/[a-f0-9]{64}$/.test(name),'COLLECTION_ARCHIVE_PATH_INVALID');
  requireValue(Number.isSafeInteger(size) && size>=0 && size<=0o77777777777,'USTAR_FILE_SIZE_INVALID');
  const out=Buffer.alloc(512);
  out.write(name,0,100,'ascii');
  const octal=(value,offset,length)=>out.write(value.toString(8).padStart(length-1,'0')+'\0',offset,length,'ascii');
  octal(0o600,100,8);octal(0,108,8);octal(0,116,8);octal(size,124,12);octal(0,136,12);
  out.fill(32,148,156);out[156]=48;out.write('ustar\0',257,6,'ascii');out.write('00',263,2,'ascii');
  out.write(out.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  return out;
}
function parseHeader(block) {
  const string=(offset,length)=>block.subarray(offset,offset+length).toString('ascii').replace(/\0.*$/s,'');
  const octal=string(124,12).trim();
  requireValue(/^[0-7]+$/.test(octal),'COLLECTION_ARCHIVE_HEADER_INVALID');
  const name=string(0,100),size=parseInt(octal,8);
  // Reject links, special files, prefixes, PAX, duplicate aliases and alternate encodings.
  requireValue(block.equals(header(name,size)),'COLLECTION_ARCHIVE_HEADER_INVALID');
  return {name,size};
}
async function writeAll(file,bytes) {
  let offset=0;
  while(offset<bytes.length) {
    const {bytesWritten}=await file.write(bytes,offset,bytes.length-offset,null);
    requireValue(bytesWritten>0,'COLLECTION_WRITE_FAILED',500);offset+=bytesWritten;
  }
}
async function syncDirectory(path) {
  if(process.platform==='win32')return;
  const file=await open(path,'r');try {await file.sync();} finally {await file.close();}
}
async function writeNew(path,bytes) {
  const partial=join(dirname(path),'.collection-'+randomUUID()+'.partial');
  const file=await open(partial,'wx',0o600);
  try {await writeAll(file,bytes);await file.sync();await file.close();await link(partial,path);await syncDirectory(dirname(path));}
  finally {await file.close().catch(()=>{});await unlink(partial).catch(()=>{});}
}
function makeManifest(collection) {
  validateCollection(collection);
  const objects=new Map();
  for(const r of collection.members) {
    requireValue(r.bytes<=0o77777777777,'USTAR_FILE_SIZE_INVALID');
    const previous=objects.get(r.sha256);
    requireValue(!previous || previous.bytes===r.bytes,'COLLECTION_OBJECT_CONFLICT');
    objects.set(r.sha256,{path:'objects/'+r.sha256,sha256:r.sha256,bytes:r.bytes});
  }
  return {schema:SCHEMA,collection,collectionSha256:digest(JSON.stringify(collection)),
    objects:[...objects.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
function parseManifest(bytes) {
  requireValue(bytes.length<=MAX_MANIFEST,'COLLECTION_METADATA_TOO_LARGE');
  let value;try {value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
  catch {requireValue(false,'COLLECTION_MANIFEST_INVALID');}
  requireValue(value?.schema===SCHEMA,'COLLECTION_MANIFEST_INVALID');
  const canonical=makeManifest(value.collection);
  requireValue(value.collectionSha256===canonical.collectionSha256 &&
    JSON.stringify(value.objects)===JSON.stringify(canonical.objects),'COLLECTION_MANIFEST_BINDING_INVALID');
  return value;
}

async function writeArchive(library,collection,file,{signal,maxBytes=MAX_ARCHIVE}={}) {
  checkLimit(maxBytes);
  const manifest=makeManifest(collection),metadata=bytesOf(manifest);
  requireValue(metadata.length<=MAX_MANIFEST,'COLLECTION_METADATA_TOO_LARGE');
  const expected=512+metadata.length+padding(metadata.length)+1024+
    manifest.objects.reduce((sum,o)=>sum+512+o.bytes+padding(o.bytes),0);
  requireValue(Number.isSafeInteger(expected) && expected<=maxBytes,'COLLECTION_BYTE_LIMIT_EXCEEDED');
  const hash=createHash('sha256');let bytes=0,completed=0;
  const write=async chunk=>{signal?.throwIfAborted();await writeAll(file,chunk);hash.update(chunk);bytes+=chunk.length;};
  await write(header('manifest.json',metadata.length));await write(metadata);await write(Buffer.alloc(padding(metadata.length)));
  for(const object of manifest.objects) {
    const record=collection.members.find(r=>r.sha256===object.sha256);
    // Same original full-file verifier and anonymous spool used by single downloads.
    const saved=await verifyFile(record,{...library.config,tempRoot:library.state,spool:true,signal});
    try {
      await write(header(object.path,object.bytes));
      let position=0;const buffer=Buffer.alloc(128*1024);
      while(position<object.bytes) {
        const {bytesRead}=await saved.file.read(buffer,0,Math.min(buffer.length,object.bytes-position),position);
        requireValue(bytesRead>0,'COLLECTION_SOURCE_TRUNCATED');
        await write(buffer.subarray(0,bytesRead));position+=bytesRead;
      }
      await write(Buffer.alloc(padding(object.bytes)));completed++;
    } finally {await saved.dispose();}
  }
  await write(Buffer.alloc(1024));await file.sync();
  requireValue(bytes===expected,'COLLECTION_LENGTH_MISMATCH');
  return {bytes,sha256:hash.digest('hex'),manifestSha256:digest(metadata),collectionId:collection.id,
    revision:collection.revision,memberCount:collection.members.length,objectCount:completed};
}
export async function exportCollection(library,{id,revision,destination,signal,maxBytes}={}) {
  const collection=library.collections.show(id,revision);
  destination=absolute(destination);await directory(dirname(destination),true);
  const partial=join(dirname(destination),'.collection-'+randomUUID()+'.partial');
  const file=await open(partial,'wx',0o600);
  try {
    const result=await writeArchive(library,collection,file,{signal,maxBytes});await file.close();
    signal?.throwIfAborted();await link(partial,destination);await syncDirectory(dirname(destination));
    return {path:destination,...result};
  } finally {await file.close().catch(()=>{});await unlink(partial).catch(()=>{});}
}
/** Original native download descriptor; the caller owns dispose exactly once. */
export async function prepareCollectionDownload(library,{id,revision,signal,maxBytes}={}) {
  const collection=library.collections.show(id,revision);
  let temporary=await mkdtemp(join(library.state,'.collection-download-'));
  const file=await open(join(temporary,'archive.tar'),'wx+',0o600);
  try {
    if(process.platform!=='win32') {await unlink(join(temporary,'archive.tar'));await rm(temporary,{recursive:true});temporary=null;}
    const result=await writeArchive(library,collection,file,{signal,maxBytes});
    return {...result,file,resource:{id:digest(JSON.stringify([id,collection.revision])),name:`${id}-r${collection.revision}.tar`},
      async dispose(){await file.close().catch(()=>{});if(temporary)await rm(temporary,{recursive:true,force:true});}};
  } catch(e) {await file.close();if(temporary)await rm(temporary,{recursive:true,force:true});throw e;}
}

/** Read one archive descriptor sequentially. Never dispatch archive paths to a shell. */
async function readArchive(archive,{signal,maxBytes=MAX_ARCHIVE,expectedSha256,onManifest,onObject}={}) {
  checkLimit(maxBytes);
  if(expectedSha256!==undefined)requireValue(HASH.test(expectedSha256),'COLLECTION_SHA256_INVALID');
  const file=await open(absolute(archive),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let position=0;const hash=createHash('sha256');
  try {
    const before=await file.stat();requireValue(before.isFile() && before.size<=maxBytes,'COLLECTION_ARCHIVE_SIZE_INVALID');
    async function take(size) {
      signal?.throwIfAborted();requireValue(size<=MAX_MANIFEST && position+size<=before.size,'COLLECTION_ARCHIVE_TRUNCATED');
      const out=Buffer.alloc(size);let offset=0;
      while(offset<size) {
        signal?.throwIfAborted();const r=await file.read(out,offset,size-offset,position+offset);
        requireValue(r.bytesRead>0,'COLLECTION_ARCHIVE_TRUNCATED');offset+=r.bytesRead;
      }
      position+=size;hash.update(out);return out;
    }
    const first=parseHeader(await take(512));
    requireValue(first.name==='manifest.json' && first.size<=MAX_MANIFEST,'COLLECTION_MANIFEST_REQUIRED');
    const metadata=await take(first.size),manifest=parseManifest(metadata);
    requireValue((await take(padding(first.size))).every(b=>b===0),'COLLECTION_PADDING_INVALID');
    await onManifest?.(manifest,metadata);
    for(const object of manifest.objects) {
      const entry=parseHeader(await take(512));
      requireValue(entry.name===object.path && entry.size===object.bytes,'COLLECTION_OBJECT_ORDER_INVALID');
      const sink=await onObject?.(object), objectHash=createHash('sha256');
      let remaining=object.bytes;
      try {
        while(remaining) {
          const chunk=await take(Math.min(128*1024,remaining));remaining-=chunk.length;objectHash.update(chunk);
          await sink?.write(chunk);
        }
        requireValue(objectHash.digest('hex')===object.sha256,'COLLECTION_OBJECT_DIGEST_CHANGED');
        await sink?.finish();
      } finally {await sink?.close();}
      requireValue((await take(padding(object.bytes))).every(b=>b===0),'COLLECTION_PADDING_INVALID');
    }
    requireValue((await take(1024)).every(b=>b===0) && position===before.size,'COLLECTION_ARCHIVE_TRAILER_INVALID');
    requireValue(equalStat(before,await file.stat()),'COLLECTION_ARCHIVE_CHANGED',409);
    const sha256=hash.digest('hex');
    requireValue(expectedSha256===undefined || sha256===expectedSha256,'COLLECTION_ARCHIVE_DIGEST_CHANGED');
    return {manifest,manifestSha256:digest(metadata),bytes:position,sha256};
  } finally {await file.close();}
}
export async function inspectCollectionArchive(archive,options={}) {return readArchive(archive,options);}

/** A resumable, create-only receiving directory. A manifest is published last. */
export async function receiveCollection({archive,destination,resume=false,signal,maxBytes,expectedSha256}={}) {
  destination=absolute(destination);await directory(dirname(destination),true);
  let metadata,manifestHash,initialized=false;
  const result=await readArchive(archive,{signal,maxBytes,expectedSha256,
    async onManifest(manifest,bytes) {
      metadata=bytes;manifestHash=digest(bytes);
      try {await mkdir(destination,{mode:0o700});initialized=true;}
      catch(e) {if(e.code!=='EEXIST')throw e;requireValue(resume,'COLLECTION_DESTINATION_EXISTS',409);}
      await directory(destination,true);
      const intake=bytesOf({schema:'stellar-forge.sf88.collection-intake.v1',manifestSha256:manifestHash});
      if(initialized)await writeNew(join(destination,'intake.json'),intake);
      else requireValue((await readSnapshot(join(destination,'intake.json'),4096)).equals(intake),'COLLECTION_RESUME_CONFLICT',409);
      await mkdir(join(destination,'objects'),{mode:0o700,recursive:true});await directory(join(destination,'objects'),true);
    },
    async onObject(object) {
      const target=join(destination,object.path),temporary=join(destination,'objects','.part-'+randomUUID());
      let existing=false;
      try {
        await lstat(target);existing=true;
        await verifyFile({deliveryStatus:'SAVED',path:target,bytes:object.bytes,sha256:object.sha256},
          {roots:[destination],maxFileBytes:object.bytes,indexBytes:0,signal});
      } catch(e) {if(e.code!=='ENOENT')throw e;}
      if(existing)return undefined; // Still hash every incoming byte in readArchive.
      const out=await open(temporary,'wx',0o600);
      return {write:chunk=>writeAll(out,chunk),async finish(){await out.sync();await out.close();await link(temporary,target);await syncDirectory(dirname(target));},
        async close(){await out.close().catch(()=>{});await unlink(temporary).catch(()=>{});}};
    }});
  const completed=join(destination,'manifest.json');
  try {await writeNew(completed,metadata);}
  catch(e) {if(e.code!=='EEXIST')throw e;requireValue((await readSnapshot(completed)).equals(metadata),'COLLECTION_RESUME_CONFLICT',409);}
  return {directory:destination,source:completed,roots:[destination],kind:'collection',
    manifestSha256:manifestHash,bytes:result.bytes,sha256:result.sha256,
    collectionId:result.manifest.collection.id,revision:result.manifest.collection.revision,
    memberCount:result.manifest.collection.members.length};
}

/** Explicit imported-source kind; never forge an original paid-inbox record. */
export async function readCollectionSource(config) {
  const metadata=await readSnapshot(config.source,MAX_MANIFEST),manifest=parseManifest(metadata);
  const root=await directory(dirname(config.source),true);
  const packageId=digest(metadata);
  const resources=manifest.collection.members.map(record=>{
    const {annotation,...original}=record;
    return {...original,id:digest(JSON.stringify(['collection',packageId,original.id])),
      path:join(root,'objects',record.sha256),status:'UNVERIFIED',
      source:{kind:'collection',path:config.source},inheritedAnnotation:annotation,
      origin:{manifestSha256:packageId,collectionId:manifest.collection.id,collectionRevision:manifest.collection.revision,
        resource:original,annotation}};
  });
  return {resources,details:{sourceSha256:packageId,sourceBytes:metadata.length,resourceCount:resources.length,
    collection:{id:manifest.collection.id,name:manifest.collection.name,revision:manifest.collection.revision,note:manifest.collection.note},
    jobCount:null,withoutFile:0,rejected:[]}};
}

/** Adopt received bytes into the original index, preserving later local edits. */
export async function openReceivedLibrary({directory:received,state,signal,indexBytes,maxFileBytes}={}) {
  received=await directory(received,true);
  const source=join(received,'manifest.json'),bytes=await readSnapshot(source,MAX_MANIFEST),manifest=parseManifest(bytes);
  const {openLibrary}=await import('./library.mjs');
  const library=await openLibrary({state,kind:'collection',source,roots:[received],indexBytes,
    maxFileBytes:maxFileBytes ?? Math.max(1024*1024*1024,...manifest.objects.map(o=>o.bytes))});
  try {
    if(library.status().scan?.sourceSha256!==digest(bytes))await library.scan({signal});
    let adopted;
    try {adopted=library.collections.show(manifest.collection.id);}
    catch(e) {if(e.code!=='COLLECTION_NOT_FOUND')throw e;}
    if(!adopted) {
      const current=await readCollectionSource(library.config);
      adopted=library.collections.save({id:manifest.collection.id,name:manifest.collection.name,note:manifest.collection.note,
        expectedRevision:0,operationId:'receive:'+digest(bytes),
        members:current.resources.map(r=>({id:r.id,sha256:r.sha256,annotationRevision:0}))});
    }
    return library;
  } catch(e) {await library.close();throw e;}
}
