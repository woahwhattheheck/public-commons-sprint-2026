// MIT. Complete original file receiving using the maintained SF31 and SF88 surfaces.
import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink,readdir,mkdir,rename} from 'node:fs/promises';
import {resolve,join,dirname,basename,sep,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createPublicHttpsFetch,normalizeBuyerTransport} from '../../sf31-buyer-client/public-transport.mjs';
import {VerifiedFile} from '../../sf88-operator-buyer-cli/node/result.mjs';
import {ObjectDelivery,ObjectReport} from '../../sf88-operator-buyer-cli/node/object.mjs';
const ownedDeliveries=new WeakSet();
export function captureObjectDelivery(delivery){
  need(delivery instanceof ObjectDelivery,'PMTILES_ORIGINAL_OBJECT_DELIVERY_REQUIRED');
  if(ownedDeliveries.has(delivery))return delivery;
  const copy=Object.freeze(new ObjectDelivery(Object.freeze(new ObjectReport(delivery.report.record,delivery.report.process))));
  ownedDeliveries.add(copy);return copy;
}
import {privateDirectory,writeBytes,readBytes,writeJson,readJson,exists,syncDirectory}
  from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,identifier,text,rights,hash,digest,clone,pathName,HASH,timestamp,validatePaths} from './model.mjs';
export const MAX_RESOURCE_BYTES=2147483648;
export const MAX_METADATA_BYTES=16777216;
export const FILE_CHUNK_BYTES=262144;
export class ResourceFile extends VerifiedFile{
  constructor(directory,record){super();this.directory=resolve(directory);this.record=clone(record);}
  get path(){return join(this.directory,'objects',this.record.sha256);}
  _metadata(){return {path:this.path,bytes:this.record.bytes,sha256:this.record.sha256};}
}
export async function retainJson(path,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  need(bytes.length<=MAX_METADATA_BYTES,'PMTILES_JSON_SIZE_LIMIT','This retained document exceeds sixteen MiB. Split the selected source or edition before saving it.');
  await privateDirectory(dirname(path));
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;need((await readBytes(path,bytes.length)).equals(bytes),'PMTILES_RETAINED_JSON_CHANGED');}
  return {bytes:bytes.length,sha256:hash(bytes)};
}
export async function fileDescriptor(path,{limit=MAX_RESOURCE_BYTES,signal}={}){
  need(isAbsolute(path),'PMTILES_ABSOLUTE_FILE_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size>=0n&&before.size<=BigInt(limit),'PMTILES_FILE_SIZE_OR_TYPE_INVALID');
    const h=createHash('sha256');let count=0;
    for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:FILE_CHUNK_BYTES})){
      signal?.throwIfAborted();h.update(chunk);count+=chunk.length;
    }
    const after=await file.stat({bigint:true});
    need(count===Number(before.size)&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&
      before.ctimeNs===after.ctimeNs,'PMTILES_SOURCE_FILE_CHANGED');
    return {bytes:count,sha256:h.digest('hex')};
  }finally{await file.close();}
}
export async function retainFile(source,destination,{expected,limit=MAX_RESOURCE_BYTES,signal,onProgress}={}){
  need(isAbsolute(source)&&isAbsolute(destination),'PMTILES_ABSOLUTE_FILE_REQUIRED');
  await privateDirectory(dirname(destination));
  if(await exists(destination)){
    const old=await fileDescriptor(destination,{limit,signal});
    need(expected&&old.bytes===expected.bytes&&old.sha256===expected.sha256,'PMTILES_EXISTING_DESTINATION_CHANGED');
    return old;
  }
  const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
  const temporary=join(dirname(destination),'.receiving-'+randomUUID());
  let output,closed=false;
  try{
    const before=await input.stat({bigint:true});
    need(before.isFile()&&before.size>=0n&&before.size<=BigInt(limit),'PMTILES_SOURCE_FILE_SIZE_OR_TYPE_INVALID');
    output=await open(temporary,'wx',0o600);
    const h=createHash('sha256');let count=0;
    for await(const chunk of input.createReadStream({autoClose:false,highWaterMark:FILE_CHUNK_BYTES})){
      signal?.throwIfAborted();count+=chunk.length;need(count<=limit,'PMTILES_RESOURCE_TOO_LARGE');
      h.update(chunk);await output.writeFile(chunk);onProgress?.({bytes:count,total:Number(before.size)});
    }
    const after=await input.stat({bigint:true});
    need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      count===Number(before.size),'PMTILES_SOURCE_FILE_CHANGED');
    const result={bytes:count,sha256:h.digest('hex')};
    if(expected)need(result.bytes===expected.bytes&&result.sha256===expected.sha256,'PMTILES_SOURCE_HASH_CHANGED');
    await output.sync();await output.close();closed=true;
    try{await link(temporary,destination);}
    catch(error){if(error.code!=='EEXIST')throw error;const prior=await fileDescriptor(destination,{limit,signal});
      need(prior.bytes===result.bytes&&prior.sha256===result.sha256,'PMTILES_EXISTING_DESTINATION_CHANGED');}
    await syncDirectory(dirname(destination));return result;
  }finally{
    await input.close();if(output&&!closed)await output.close();
    await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
}
function resourceInput(input){
  identifier(input.requestId);text(input.name,240);
  need(['pmtiles','style','sprite-json','sprite-png','glyph','document'].includes(input.kind),'PMTILES_RESOURCE_KIND_INVALID');
  const maxBytes=input.maxBytes??MAX_RESOURCE_BYTES;
  need(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=MAX_RESOURCE_BYTES,'PMTILES_RESOURCE_LIMIT_INVALID');
  if(input.expected)need(HASH.test(input.expected.sha256??'')&&Number.isSafeInteger(input.expected.bytes)&&
    input.expected.bytes>0&&input.expected.bytes<=maxBytes,'PMTILES_EXPECTED_RESOURCE_INVALID');
  return {requestId:input.requestId,name:input.name,kind:input.kind,rights:rights(input.rights),maxBytes,
    expected:input.expected??null};
}
async function finishResource(directory,core,capture,sourceFile,observed,source,{signal,onProgress}={}){
  const objectPath=join(directory,'objects',observed.sha256);
  if(sourceFile.startsWith(join(directory,'captures')+sep)){
    const actual=await fileDescriptor(sourceFile,{limit:core.maxBytes,signal});
    need(actual.bytes===observed.bytes&&actual.sha256===observed.sha256,'PMTILES_SOURCE_HASH_CHANGED');
    try{await link(sourceFile,objectPath);}catch(error){if(error.code!=='EEXIST')throw error;await new ResourceFile(directory,observed).verify({signal});}
    await syncDirectory(dirname(objectPath));
  }else await retainFile(sourceFile,objectPath,{expected:observed,limit:core.maxBytes,signal,onProgress});
  const record={id:'resource-'+digest({requestId:core.requestId,sha256:observed.sha256,kind:core.kind}).slice(0,24),
    name:core.name,kind:core.kind,...observed,rights:core.rights,source:clone(source),
    capture,createdAt:timestamp()};
  await retainJson(join(directory,capture,'complete.json'),record);return record;
}
export async function importLocalResource(directory,input,{signal,onProgress}={}){
  input=clone(input);
  directory=resolve(directory);const core=resourceInput(input);
  need(isAbsolute(input.path),'PMTILES_ABSOLUTE_SOURCE_REQUIRED');
  const capture='captures/'+core.requestId,root=join(directory,capture);
  await privateDirectory(root);await privateDirectory(join(directory,'objects'));
  const request={schema:'starforge.pmtiles-source-request.v1',...core,source:{kind:'LOCAL',path:resolve(input.path)}};
  await retainJson(join(root,'request.json'),request);
  if(await exists(join(root,'complete.json'))){
    const saved=await readJson(join(root,'complete.json'),MAX_METADATA_BYTES);
    await new ResourceFile(directory,saved).verify({signal});return saved;
  }
  const observed=await fileDescriptor(input.path,{limit:core.maxBytes,signal});
  need(observed.bytes>0,'PMTILES_EMPTY_SOURCE');
  if(core.expected)need(observed.sha256===core.expected.sha256&&observed.bytes===core.expected.bytes,'PMTILES_SOURCE_HASH_CHANGED');
  return finishResource(directory,core,capture,input.path,observed,{kind:'LOCAL',path:resolve(input.path),
    selectedAt:timestamp(),requestSha256:digest(request)},{signal,onProgress});
}
export async function importObjectResource(directory,input,delivery,{signal,onProgress}={}){
  input=clone(input);
  need(delivery instanceof ObjectDelivery,'PMTILES_ORIGINAL_OBJECT_DELIVERY_REQUIRED');
  directory=resolve(directory);const core=resourceInput(input);
  delivery=captureObjectDelivery(delivery);
  const observed=await delivery.verify({signal}),fullReceipt=clone(delivery.report.record);
  need(delivery.receiptRecorded,'PMTILES_OBJECT_RECEIPT_REQUIRED');
  if(core.expected)need(core.expected.bytes===observed.bytes&&core.expected.sha256===observed.sha256,'PMTILES_SOURCE_HASH_CHANGED');
  need(observed.bytes>0&&observed.bytes<=core.maxBytes,'PMTILES_RESOURCE_TOO_LARGE');
  const capture='captures/'+core.requestId,root=join(directory,capture);
  await privateDirectory(root);await privateDirectory(join(directory,'objects'));
  await retainJson(join(root,'request.json'),{schema:'starforge.pmtiles-source-request.v1',...core,
    source:{kind:'SF88_OBJECT',sessionId:delivery.report.native.sessionId,
      configurationSha256:delivery.report.native.configurationSha256,snapshot:delivery.report.native.expectedSnapshot,
      bytes:observed.bytes,sha256:observed.sha256}});
  const receipt=await retainJson(join(root,'sf88-object-receipt.json'),fullReceipt);
  if(await exists(join(root,'complete.json'))){
    const saved=await readJson(join(root,'complete.json'),MAX_METADATA_BYTES);
    await new ResourceFile(directory,saved).verify({signal});return saved;
  }
  return finishResource(directory,core,capture,delivery.path,observed,{kind:'SF88_OBJECT',
    sessionId:delivery.report.native.sessionId,configurationSha256:delivery.report.native.configurationSha256,
    snapshot:delivery.report.native.expectedSnapshot,receiptRecorded:true,receiptPath:capture+'/sf88-object-receipt.json',
    receiptSha256:receipt.sha256},{signal,onProgress});
}
export async function acquireHttpsResource(directory,input,{signal,onProgress,transport}={}){
  input=clone(input);
  directory=resolve(directory);const core=resourceInput(input),url=new URL(input.url);
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'),
    'PMTILES_PUBLIC_HTTPS_REQUIRED');
  const profile=transport?normalizeBuyerTransport(transport):null;
  const request={schema:'starforge.pmtiles-source-request.v1',...core,source:{kind:'HTTPS',url:url.href,
    method:'GET',headers:{accept:'application/octet-stream'},transport:profile}};
  if(input.etag){text(input.etag,2048);need(!/[\r\n]/.test(input.etag),'PMTILES_ETAG_INVALID');request.source.headers['if-match']=input.etag;}
  const capture='captures/'+core.requestId,root=join(directory,capture);
  await privateDirectory(root);await privateDirectory(join(directory,'objects'));
  await retainJson(join(root,'request.json'),request);
  if(await exists(join(root,'complete.json'))){
    const saved=await readJson(join(root,'complete.json'),MAX_METADATA_BYTES);
    await new ResourceFile(directory,saved).verify({signal});return saved;
  }
  const attempt='attempt-'+randomUUID(),attemptRoot=join(root,attempt);await privateDirectory(attemptRoot);
  const partial=join(attemptRoot,'response.bin'),startedAt=timestamp();
  let writer,response,bytes=0,h=createHash('sha256');
  try{
    response=await createPublicHttpsFetch({timeoutMs:300000,trustedProxy:profile})(url.href,{
      method:'GET',headers:request.source.headers,signal});
    const headers=Object.fromEntries(response.headers.entries());
    await retainJson(join(attemptRoot,'response.json'),{url:response.url,status:response.status,headers,startedAt,receivedAt:timestamp()});
    need(response.status===200,'PMTILES_SOURCE_HTTP_STATUS','The original source returned HTTP '+response.status+'. Select its actual final URL or resolve its response.');
    const declared=response.headers.get('content-length');
    if(declared!==null)need(/^\d+$/.test(declared)&&Number(declared)>0&&Number(declared)<=core.maxBytes,'PMTILES_RESOURCE_TOO_LARGE');
    writer=await open(partial,'wx',0o600);
    for await(const chunk of response.body){
      signal?.throwIfAborted();const data=Buffer.from(chunk);bytes+=data.length;
      need(bytes<=core.maxBytes,'PMTILES_RESOURCE_TOO_LARGE');
      h.update(data);await writer.writeFile(data);onProgress?.({bytes,total:declared===null?null:Number(declared)});
    }
    need(bytes>0&&(declared===null||bytes===Number(declared)),'PMTILES_SOURCE_LENGTH_CHANGED');
    const observed={bytes,sha256:h.digest('hex')};
    if(core.expected)need(observed.bytes===core.expected.bytes&&observed.sha256===core.expected.sha256,'PMTILES_SOURCE_HASH_CHANGED');
    await writer.sync();await writer.close();writer=null;
    return await finishResource(directory,core,capture,partial,observed,{kind:'HTTPS',url:url.href,
      requestSha256:digest(request),responsePath:capture+'/'+attempt+'/response.json',responseBytesPath:capture+'/'+attempt+'/response.bin',
      status:response.status,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),
      contentType:response.headers.get('content-type'),startedAt,receivedAt:timestamp()},{signal,onProgress});
  }catch(error){
    if(writer){await writer.sync().catch(()=>{});await writer.close();writer=null;}
    try{await response?.body?.cancel();}catch{}
    await retainJson(join(attemptRoot,'error.json'),{code:error.code??'PMTILES_SOURCE_FAILED',message:String(error.message??error),
      bytes,at:timestamp()});throw error;
  }
}
export async function resourceBytes(directory,record,limit=MAX_METADATA_BYTES){
  return new ResourceFile(directory,record).bytes({limit});
}
export async function copyTree(source,destination,{signal,maxBytes=17179869184,exclude=()=>false}={}){
  source=resolve(source);destination=resolve(destination);
  need(source!==destination&&!destination.startsWith(source+sep)&&!source.startsWith(destination+sep),'PMTILES_SEPARATE_RECEIVING_DIRECTORY_REQUIRED');
  const files=[];let total=0;
  async function visit(relative){
    const parent=join(source,relative);
    need((await lstat(parent)).isDirectory()&&await realpath(parent)===parent,'PMTILES_SOURCE_DIRECTORY_CHANGED');
    const rows=await readdir(parent,{withFileTypes:true});
    for(const row of rows.sort((a,b)=>a.name.localeCompare(b.name))){
      const path=relative?relative+'/'+row.name:row.name;pathName(path);if(exclude(path,row))continue;
      signal?.throwIfAborted();
      if(row.isDirectory()){await visit(path);continue;}
      need(row.isFile()&&!row.isSymbolicLink(),'PMTILES_NONFILE_SOURCE_MEMBER');
      const descriptor=await fileDescriptor(join(source,path),{limit:MAX_RESOURCE_BYTES,signal});
      total+=descriptor.bytes;need(total<=maxBytes,'PMTILES_HANDOVER_SIZE_LIMIT');
      await retainFile(join(source,path),join(destination,path),{expected:descriptor,signal});
      files.push({path,...descriptor});
    }
  }
  await privateDirectory(destination);await visit('');if(files.length)validatePaths(files);return {files,bytes:total};
}
export async function verifyFiles(directory,files,{signal}={}){
  directory=resolve(directory);validatePaths(files);
  for(const row of files){
    const path=join(directory,row.path);need(await realpath(dirname(path))===dirname(path),'PMTILES_RECEIVED_DIRECTORY_CHANGED');
    const actual=await fileDescriptor(path,{limit:MAX_RESOURCE_BYTES,signal});
    need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'PMTILES_RECEIVED_FILE_CHANGED',row.path);
  }
  return {files:files.length,bytes:files.reduce((n,r)=>n+r.bytes,0)};
}
