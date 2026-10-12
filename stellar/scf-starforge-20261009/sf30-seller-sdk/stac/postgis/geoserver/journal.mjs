// MIT. One native kernel lease, original durable file helpers, retained publication effects.
import { constants } from 'node:fs';
import { open, lstat, readdir, unlink, link, realpath, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { acquireStateLease } from '../../../../merchant-fleet-gateway/state-lease.mjs';
import { readPrivate, readJson, bytes, digest, identity, atomicJson, syncDirectory } from '../../../postgres/publisher/files.mjs';
import { exactFile, durableDirectory } from '../../../wfs/source.mjs';
import { need, absolute, relativeFile, operationId, hash, validateReceipt, publicProfile, RECEIVING_SCHEMA, MiB, parseExactJSON } from './contract.mjs';

export async function optionalJson(path, maximum=64*MiB) {
  try{return await readJson(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function verifyFile(path,{maximum=2*1024*MiB,signal}={}) {
  signal?.throwIfAborted();
  need(await realpath(path)===resolve(path),'GEOSERVER_SOURCE_PATH');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),
      'GEOSERVER_SOURCE_FILE','Use the canonical original regular source file within its declared size.');
    const source=createHash('sha256'),buffer=Buffer.allocUnsafe(64*1024);let size=0;
    while(true){
      signal?.throwIfAborted();const read=await handle.read(buffer,0,buffer.length,size);
      if(read.bytesRead===0)break;size+=read.bytesRead;
      need(size<=maximum,'GEOSERVER_SOURCE_LIMIT');source.update(buffer.subarray(0,read.bytesRead));
    }
    signal?.throwIfAborted();
    const after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      current.dev===before.dev&&current.ino===before.ino&&BigInt(size)===before.size,
      'GEOSERVER_SOURCE_CHANGED');
    return {bytes:size,sha256:source.digest('hex')};
  } finally {await handle.close();}
}
export async function retainCopy(source,target,expected,{signal}={}) {
  await durableDirectory(dirname(target));hash(expected.sha256);
  const existing=await optionalStat(target);
  if(existing){
    const observed=await verifyFile(target,{maximum:expected.bytes,signal});
    need(observed.bytes===expected.bytes&&observed.sha256===expected.sha256,'GEOSERVER_RETAINED_FILE_CHANGED');
    await syncDirectory(dirname(target));return observed;
  }
  const prior=await verifyFile(source,{maximum:expected.bytes,signal});
  need(prior.bytes===expected.bytes&&prior.sha256===expected.sha256,'GEOSERVER_SOURCE_MEMBER_CHANGED');
  const temporary=join(dirname(target),'.geoserver-copy-'+randomUUID());
  const destination=await open(temporary,'wx',0o600);
  const owned=await destination.stat({bigint:true});let destinationClosed=false;
  try{
    signal?.throwIfAborted();
    const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stream=input.createReadStream({autoClose:false,signal});
      let position=0;const sourceHash=createHash('sha256');
      try{for await(const part of stream){
        signal?.throwIfAborted();sourceHash.update(part);
        need(position+part.length<=expected.bytes,'GEOSERVER_SOURCE_MEMBER_CHANGED');
        let offset=0;while(offset<part.length){const written=await destination.write(part,offset,part.length-offset,position+offset);
          need(written.bytesWritten>0,'GEOSERVER_COPY_WRITE');offset+=written.bytesWritten;}
        position+=part.length;
      }}finally{stream.destroy();}
      need(position===expected.bytes&&sourceHash.digest('hex')===expected.sha256,'GEOSERVER_SOURCE_MEMBER_CHANGED');
    }finally{await input.close();}
    await destination.sync();await destination.close();destinationClosed=true;
    signal?.throwIfAborted();
    try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
    await syncDirectory(dirname(target));
    const retained=await verifyFile(target,{maximum:expected.bytes,signal});
    need(retained.bytes===expected.bytes&&retained.sha256===expected.sha256,'GEOSERVER_RETAINED_FILE_CHANGED');
    return retained;
  }finally{
    try{if(!destinationClosed)await destination.close();}
    finally{const current=await optionalStat(temporary,true);
      if(current&&current.dev===owned.dev&&current.ino===owned.ino)await unlink(temporary);}
  }
}
async function optionalStat(path,bigint=false){
  try{return await lstat(path,{bigint});}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function readReceiving(directory,manifestSha256,{signal}={}) {
  absolute(directory);hash(manifestSha256);
  const source=join(directory,'postgis-receiving.json');
  const observed=await verifyFile(source,{maximum:64*MiB,signal});
  need(observed.sha256===manifestSha256,'POSTGIS_RECEIVING_MANIFEST_CHANGED');
  const raw=await readFile(source);
  need(digest(raw)===manifestSha256,'POSTGIS_RECEIVING_MANIFEST_CHANGED');
  const receipt=validateReceipt(parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
  for(const file of receipt.files){
    signal?.throwIfAborted();
    const found=await verifyFile(join(directory,relativeFile(file.path)),{maximum:file.bytes,signal});
    need(found.bytes===file.bytes&&found.sha256===file.sha256,'POSTGIS_RECEIVING_MEMBER_CHANGED',file.path);
  }
  return {receipt,raw};
}
export async function openPublicationJournal(directory,profile,{hostSources=[],nativeBinding=null}={}) {
  absolute(directory);await durableDirectory(directory);
  const lease=await acquireStateLease(directory);let closed=false,closeDiagnostic=null;
  function assertHeld(){need(!closed,'GEOSERVER_JOURNAL_CLOSED');lease.assertHeld();}
  try{
    const selected={schema:'starforge.geoserver-workspace.v1',profileSha256:identity({profile,nativeBinding}),profile:publicProfile(profile),nativeBinding};
    await exactFile(join(directory,'workspace.json'),bytes(selected));await syncDirectory(directory);
    for(const name of ['operations','objects','private-objects','receipts','host','export-checkpoints'])await durableDirectory(join(directory,name));
    const file=async(path,data)=>{assertHeld();await exactFile(path,data);await syncDirectory(dirname(path));};
    for(const source of hostSources){need(['geoserver-profile.json','postgis-reader.json'].includes(source.name)&&Buffer.isBuffer(source.bytes),'GEOSERVER_HOST_SOURCE');
      await file(join(directory,'host',source.name),source.bytes);}
    const object=async(data,{private:privateObject=false,contentType='application/octet-stream'}={})=>{
      need(Buffer.isBuffer(data),'GEOSERVER_OBJECT_BYTES');const sha256=digest(data);
      await file(join(directory,privateObject?'private-objects':'objects',sha256),data);
      return {sha256,bytes:data.length,contentType,...(privateObject?{private:true}:{})};
    };
    const objectBytes=async reference=>{
      assertHeld();hash(reference.sha256);
      const raw=await readPrivate(join(directory,reference.private?'private-objects':'objects',reference.sha256),reference.bytes);
      need(raw.length===reference.bytes&&digest(raw)===reference.sha256,'GEOSERVER_OBJECT_CHANGED');return raw;
    };
    const operationDirectory=id=>join(directory,'operations',operationId(id));
    const state=async id=>{
      assertHeld();const result=await optionalJson(join(operationDirectory(id),'state.json'));
      if(!result)return null;
      need(result.schema==='starforge.geoserver-operation.v1'&&result.id===id,'GEOSERVER_OPERATION_CHANGED');
      const request=await readJson(join(operationDirectory(id),'request.json'),64*MiB);
      need(result.requestSha256===identity(request),'GEOSERVER_OPERATION_REQUEST_CHANGED');return result;
    };
    const save=async value=>{
      assertHeld();operationId(value.id);
      need(value.schema==='starforge.geoserver-operation.v1','GEOSERVER_OPERATION_SCHEMA');
      await atomicJson(operationDirectory(value.id),'state.json',value);return value;
    };
    const begin=async request=>{
      assertHeld();operationId(request.operationId);
      const path=operationDirectory(request.operationId);await durableDirectory(path);
      await file(join(path,'request.json'),bytes(request));
      const existing=await state(request.operationId);if(existing)return existing;
      const value={schema:'starforge.geoserver-operation.v1',id:request.operationId,
        requestSha256:identity(request),kind:request.kind,state:'PREPARING',createdAt:new Date().toISOString(),
        profileSha256:selected.profileSha256,steps:[],history:[]};
      await save(value);return value;
    };
    const retainReceiving=async(source,manifestSha256,options={})=>{
      assertHeld();const original=await readReceiving(source,manifestSha256,options);
      const target=join(directory,'receipts',manifestSha256);await durableDirectory(target);
      for(const member of original.receipt.files)
        await retainCopy(join(source,member.path),join(target,member.path),member,options);
      await file(join(target,'postgis-receiving.json'),original.raw);
      return {directory:target,receipt:original.receipt,manifestSha256};
    };
    const response=async(value,{private:privateObject=false}={})=>{
      const body=await object(value.bytes,{private:privateObject,contentType:value.headers['content-type']??'application/octet-stream'});
      return {url:value.url,status:value.status,headers:value.headers,receivedAt:value.receivedAt,body};
    };
    const list=async()=>{
      assertHeld();const names=await readdir(join(directory,'operations'));const result=[];
      for(const id of names.sort()){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))continue;
        const row=await state(id);if(row)result.push(row);}
      return result;
    };
    const close=async()=>{
      if(closed)return;
      closed=true;
      // The original Linux lease closes its descriptor once. Preserve its first diagnostic.
      try{await lease.close();}catch(error){closeDiagnostic=error;throw error;}
    };
    return {directory,profileSha256:selected.profileSha256,assertHeld,file,object,objectBytes,
      operationDirectory,state,save,begin,list,retainReceiving,response,
      request:async id=>{assertHeld();return readJson(join(operationDirectory(id),'request.json'),64*MiB);},
      plan:async id=>{assertHeld();return readJson(join(operationDirectory(id),'review.json'),64*MiB);},
      savePlan:async(id,plan)=>{await file(join(operationDirectory(id),'review.json'),bytes(plan));return plan;},
      close};
  }catch(error){
    try{await lease.close();}catch(cleanup){error.cleanupError=cleanup.code??cleanup.message;}
    throw error;
  }
}
export async function walkFiles(directory,{signal,skip=()=>false}={}) {
  const result=[];
  async function walk(root,prefix=''){
    for(const entry of await readdir(root,{withFileTypes:true})){
      signal?.throwIfAborted();const relative=prefix+entry.name;if(skip(relative,entry))continue;
      need(!entry.isSymbolicLink(),'GEOSERVER_HANDOVER_SYMLINK');
      if(entry.isDirectory())await walk(join(root,entry.name),relative+'/');
      else{need(entry.isFile(),'GEOSERVER_HANDOVER_MEMBER');const observed=await verifyFile(join(root,entry.name),{signal});
        result.push({path:relative,...observed});}
      need(result.length<=1000000,'GEOSERVER_HANDOVER_MEMBER_LIMIT');
    }
  }
  await walk(directory);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function inspectGeoServerHandover(directory,{expectedManifestSha256,signal}={}) {
  absolute(directory);const raw=await readPrivate(join(directory,'geoserver-receiving.json'),64*MiB);
  if(expectedManifestSha256)need(digest(raw)===hash(expectedManifestSha256),'GEOSERVER_HANDOVER_MANIFEST_CHANGED');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(manifest.schema===RECEIVING_SCHEMA&&Array.isArray(manifest.files),'GEOSERVER_HANDOVER_SCHEMA');
  const paths=new Set();
  for(const file of manifest.files){
    relativeFile(file.path);need(!paths.has(file.path)&&file.path!=='geoserver-receiving.json','GEOSERVER_HANDOVER_DUPLICATE');
    paths.add(file.path);const observed=await verifyFile(join(directory,file.path),{maximum:file.bytes,signal});
    need(observed.bytes===file.bytes&&observed.sha256===file.sha256,'GEOSERVER_HANDOVER_MEMBER_CHANGED',file.path);
  }
  return {manifest,manifestSha256:digest(raw),directory};
}
