// MIT. Complete original SF88 collection archives inside the Facility workspace.
import { constants } from 'node:fs';
import { open, mkdir, link, unlink, realpath } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readCollectionArchive, parseCollectionManifest } from '../../../../../sf88-operator-buyer-cli/resource-library/collection-package.mjs';
import { absolute, directory, requireValue, verifyFile, digest } from '../../../../../sf88-operator-buyer-cli/resource-library/files.mjs';

export const COLLECTION_ARCHIVE_LIMIT = 16 * 1024 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const CHUNK = 128 * 1024;
const same = (a,b) => ['dev','ino','size','mtimeMs','ctimeMs'].every(key => a[key] === b[key]);
const need = requireValue;
async function writeAll(file,bytes) {
  let offset=0;
  while(offset<bytes.length) {
    const {bytesWritten}=await file.write(bytes,offset,bytes.length-offset,null);
    need(bytesWritten>0,'FACILITY_COLLECTION_WRITE_FAILED',500);offset+=bytesWritten;
  }
}
async function syncDirectory(path) {
  if(process.platform==='win32')return;
  const file=await open(path,'r');try{await file.sync();}finally{await file.close();}
}
export async function collectionShelf(workspace) {
  const root=join(await directory(workspace,true),'buyer-collections');
  await mkdir(root,{mode:0o700,recursive:true});return directory(root,true);
}
export function collectionArchivePath(workspace,sha256) {
  need(HASH.test(sha256??''),'FACILITY_COLLECTION_DIGEST_REQUIRED');
  return join(absolute(workspace),'buyer-collections',sha256+'.tar');
}
async function nativeArchive(path,expectedSha256,{signal,onObject}={}) {
  let metadata;
  const result=await readCollectionArchive(path,{expectedSha256,maxBytes:COLLECTION_ARCHIVE_LIMIT,signal,onObject,
    onManifest(manifest,bytes){metadata=Buffer.from(bytes);}});
  return {...result,manifestBytes:metadata};
}
async function publishArchive(workspace,temporary,identity,{signal}={}) {
  const inspected=await nativeArchive(temporary,identity.sha256,{signal});
  need(inspected.bytes===identity.bytes,'FACILITY_COLLECTION_LENGTH_CHANGED',409);
  const target=collectionArchivePath(workspace,identity.sha256);
  try{await link(temporary,target);await syncDirectory(dirname(target));}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const retained=await nativeArchive(target,identity.sha256,{signal});
    need(retained.bytes===identity.bytes&&retained.manifestSha256===inspected.manifestSha256,
      'FACILITY_COLLECTION_ARCHIVE_CHANGED',409);
  }
  return {path:target,archiveSha256:identity.sha256,archiveBytes:identity.bytes,
    manifestBytes:inspected.manifestBytes,manifest:inspected.manifest};
}
/** Copy the selected original file once; the unchanged native reader validates all members. */
export async function retainCollectionArchive(workspace,archive,{expectedSha256,signal}={}) {
  archive=absolute(archive);
  if(expectedSha256!==undefined&&expectedSha256!=='')need(HASH.test(expectedSha256),'COLLECTION_SHA256_INVALID');
  const shelf=await collectionShelf(workspace),temporary=join(shelf,'.receiving-'+randomUUID()+'.tar');
  const input=await open(archive,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let output;
  try{
    const before=await input.stat();
    need(before.isFile()&&before.size<=COLLECTION_ARCHIVE_LIMIT&&await realpath(archive)===archive,
      'FACILITY_COLLECTION_ORIGINAL_FILE_REQUIRED');
    output=await open(temporary,'wx',0o600);
    const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let bytes=0;
    while(true){
      signal?.throwIfAborted();
      const {bytesRead}=await input.read(buffer,0,buffer.length,bytes);if(!bytesRead)break;
      bytes+=bytesRead;need(bytes<=before.size,'FACILITY_COLLECTION_SOURCE_CHANGED',409);
      const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);await writeAll(output,chunk);
    }
    need(bytes===before.size&&same(before,await input.stat()),'FACILITY_COLLECTION_SOURCE_CHANGED',409);
    const sha256=hash.digest('hex');
    need(!expectedSha256||sha256===expectedSha256,'COLLECTION_ARCHIVE_DIGEST_CHANGED',409);
    await output.sync();await output.close();output=null;
    const result=await publishArchive(workspace,temporary,{sha256,bytes},{signal});
    return {...result,name:basename(archive)};
  }finally{
    try{await input.close();}finally{
      try{if(output)await output.close();}finally{
        await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
      }
    }
  }
}
/** The original reader calls the sink only after its declared object identity is checked. */
export async function readRetainedCollection(workspace,entry,options={}) {
  const result=await nativeArchive(collectionArchivePath(workspace,entry.archiveSha256),entry.archiveSha256,options);
  need(result.bytes===entry.archiveBytes&&digest(result.manifestBytes)===entry.manifestSha256&&
    result.manifestBytes.length===entry.manifestBytes,'FACILITY_COLLECTION_SOURCE_CHANGED',409);
  return result;
}
export function readCollectionMembers(metadata,{query='',offset=0,limit=50}={}) {
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,
    'FACILITY_COLLECTION_PAGE_INVALID');
  need(typeof query==='string'&&query.length<=2000,'FACILITY_COLLECTION_QUERY_INVALID');
  const manifest=parseCollectionManifest(metadata),q=query.trim().toLocaleLowerCase();
  const all=manifest.collection.members.filter(member=>!q||[member.name,member.intentId,member.url,
    member.annotation?.note,...(member.annotation?.tags??[])].some(value=>String(value??'').toLocaleLowerCase().includes(q)));
  return {collection:manifest.collection.id,revision:manifest.collection.revision,total:all.length,offset,limit,
    items:all.slice(offset,offset+limit).map(member=>({member,
      eligible:member.bytes<=64*1024*1024&&[200,204].includes(member.httpStatus),
      selectionNote:member.bytes>64*1024*1024?'This response exceeds the original reporter’s 64 MiB source limit.':
        ![200,204].includes(member.httpStatus)?'The original delivered HTTP status is not 200 or 204.':
        'The complete response is checked as GeoJSON when retained for reporting.'}))};
}
/** Stream one exact full archive into the complete project transfer. */
export async function* collectionArchiveParts(workspace,entry,{signal}={}) {
  const path=collectionArchivePath(workspace,entry.archiveSha256);
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat();need(before.isFile()&&before.size===entry.archiveBytes,'FACILITY_COLLECTION_LENGTH_CHANGED',409);
    const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let offset=0;
    yield {type:'collection-archive',sha256:entry.archiveSha256,bytes:entry.archiveBytes};
    while(offset<before.size){
      signal?.throwIfAborted();
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);
      need(bytesRead>0,'FACILITY_COLLECTION_ARCHIVE_TRUNCATED',409);
      const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);
      yield {type:'collection-part',offset,base64:bytes.toString('base64')};offset+=bytesRead;
    }
    need(same(before,await file.stat())&&hash.digest('hex')===entry.archiveSha256,
      'FACILITY_COLLECTION_ARCHIVE_CHANGED',409);
    yield {type:'collection-end',sha256:entry.archiveSha256};
  }finally{await file.close();}
}
/** Receive original archive bytes as part of the existing atomic project import. */
export async function receiveArchiveParts(workspace,{sha256,bytes},{signal}={}) {
  need(HASH.test(sha256??'')&&Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=COLLECTION_ARCHIVE_LIMIT,
    'FACILITY_COLLECTION_ARCHIVE_IDENTITY_INVALID');
  const shelf=await collectionShelf(workspace),temporary=join(shelf,'.transfer-'+randomUUID()+'.tar');
  let file=await open(temporary,'wx',0o600),offset=0,finished=false;
  const hash=createHash('sha256');
  async function close(){
    if(file){await file.close().catch(()=>{});file=null;}
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  return {
    sha256,
    async write(part){
      signal?.throwIfAborted();need(!finished&&file&&part.offset===offset&&typeof part.base64==='string'&&
        part.base64.length<=Math.ceil(CHUNK/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(part.base64),
        'FACILITY_COLLECTION_PART_INVALID');
      const chunk=Buffer.from(part.base64,'base64');
      need(chunk.length>0&&chunk.toString('base64')===part.base64&&offset+chunk.length<=bytes,
        'FACILITY_COLLECTION_PART_INVALID');
      await writeAll(file,chunk);hash.update(chunk);offset+=chunk.length;
    },
    async finish(value){
      need(!finished&&value.sha256===sha256&&offset===bytes&&hash.digest('hex')===sha256,
        'FACILITY_COLLECTION_ARCHIVE_DIGEST_CHANGED');
      finished=true;await file.sync();await file.close();file=null;
      try{return await publishArchive(workspace,temporary,{sha256,bytes},{signal});}
      finally{await close();}
    },
    close
  };
}
/** Reuse the buyer's anonymous, fully verified native download descriptor. */
export async function downloadCollectionArchive(workspace,entry,{signal}={}) {
  const shelf=await collectionShelf(workspace);
  return verifyFile({deliveryStatus:'SAVED',path:collectionArchivePath(workspace,entry.archiveSha256),
    bytes:entry.archiveBytes,sha256:entry.archiveSha256},
  {roots:[shelf],maxFileBytes:COLLECTION_ARCHIVE_LIMIT,indexBytes:0,tempRoot:shelf,spool:true,signal});
}

export { parseCollectionManifest };

/** Receive a browser's original File as a complete archive, bound to its retained digest. */
export async function retainUploadedCollection(workspace,readable,{expectedSha256,expectedBytes,signal}={}) {
  need(HASH.test(expectedSha256??'')&&Number.isSafeInteger(expectedBytes)&&expectedBytes>=1024&&expectedBytes<=COLLECTION_ARCHIVE_LIMIT,
    'FACILITY_COLLECTION_UPLOAD_IDENTITY_REQUIRED');
  const shelf=await collectionShelf(workspace),temporary=join(shelf,'.upload-'+randomUUID()+'.tar');
  let file=await open(temporary,'wx',0o600),bytes=0;
  const hash=createHash('sha256');
  try{
    for await(const chunk of readable){
      signal?.throwIfAborted();bytes+=chunk.length;
      need(bytes<=expectedBytes,'FACILITY_COLLECTION_UPLOAD_LENGTH_CHANGED');
      hash.update(chunk);await writeAll(file,chunk);
    }
    need(bytes===expectedBytes&&hash.digest('hex')===expectedSha256,'FACILITY_COLLECTION_UPLOAD_DIGEST_CHANGED');
    await file.sync();await file.close();file=null;
    return await publishArchive(workspace,temporary,{sha256:expectedSha256,bytes},{signal});
  }finally{
    if(file)await file.close().catch(()=>{});
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
