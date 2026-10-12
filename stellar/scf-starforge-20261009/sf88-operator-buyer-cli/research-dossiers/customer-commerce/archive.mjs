// MIT. Stream the complete original customer handover through the paid-file transport.
import {createHash} from 'node:crypto';
import {lstat,readdir,link,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {exists,digest,parseJson,syncDirectory} from '../../node/store.mjs';
import {openResearchSource,readResearchHostFile} from '../workspace-files.mjs';
import {PORTABLE_LIMIT,writePortableFile} from '../portable.mjs';
import {customerFields,customerHash,requireCustomerUpdate as need} from '../customer-updates/contracts.mjs';
import {customerUpdateDigest,customerUpdateSame} from '../customer-updates/context.mjs';
import {CUSTOMER_FILE_LIMIT,customerDirectory,customerFilename,withCustomerOperation,
  readCustomerJson,retainCustomerBytes,retainCustomerJson,describeCustomerFile,
  copyCustomerFile,inspectCustomerHandover} from '../customer-updates/files.mjs';

export const RESEARCH_PAID_ARCHIVE_LIMIT=32*1024*1024;
export const RESEARCH_PAID_ARCHIVE_NAME='research-customer.handover.gz';
const MAGIC=Buffer.from('SF88-RESEARCH-CUSTOMER-HANDOVER\n','ascii');
const MAX_FRAME=MAGIC.length+4+6*CUSTOMER_FILE_LIMIT+PORTABLE_LIMIT+128*1024*1024;
const OPERATION='paid-archive-operation.json',RESULT='paid-archive-result.json';
const SOURCE_MANIFEST='source-handover.json';
const OP_SCHEMA='sf88-research-paid-archive-operation/v1';
const RESULT_SCHEMA='sf88-research-paid-archive-completed/v1';
const PORTABLE_TEMP=/^\.portable-write-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const clone=value=>structuredClone(value);
const code='RESEARCH_PAID_ARCHIVE_';
function check(condition,suffix){need(condition,code+suffix);}
function stop(signal){check(!signal?.aborted,'ABORTED');}
function inputSignal(signal){
  check(signal===undefined||signal instanceof AbortSignal,'SIGNAL_INVALID');return signal;
}
function selectedPath(value,optional=false){
  if(value===undefined&&optional)return null;
  check(typeof value==='string'&&value.length>0&&!value.includes('\0'),'PATH_REQUIRED');return resolve(value);
}
function archivePins(sha256,bytes){
  customerHash(sha256,code+'SHA256_REQUIRED');
  check(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=RESEARCH_PAID_ARCHIVE_LIMIT,'SIZE_INVALID');
  return {sha256,bytes};
}
function memberLimit(file){
  return file.kind==='dossier'?PORTABLE_LIMIT:file.kind==='europe-pmc'?128*1024*1024:CUSTOMER_FILE_LIMIT;
}
function metadata(path,bytes,sha256){
  return {name:RESEARCH_PAID_ARCHIVE_NAME,path,bytes,sha256,contentType:'application/gzip'};
}
const cleanupOwners=new WeakMap();
function preserveCleanup(error,cleanup,close){
  if(!error||typeof error!=='object')return;
  let state=cleanupOwners.get(error);
  if(!state){
    state={owners:[],errors:[]};cleanupOwners.set(error,state);
    if(typeof error.close==='function')state.owners.push({close:error.close.bind(error),closed:false});
    try{Object.defineProperty(error,'close',{configurable:true,value:async()=>{
      let failure;
      for(const owner of state.owners){
        if(owner.closed)continue;
        try{await owner.close();owner.closed=true;}catch(caught){failure??=caught;}
      }
      if(failure)throw failure;
    }});}catch{}
  }
  state.errors.push(cleanup);
  const closer=close??(cleanup!==error&&typeof cleanup?.close==='function'?cleanup.close.bind(cleanup):null);
  if(closer)state.owners.push({close:closer,closed:false});
  try{Object.defineProperty(error,'cleanupError',{value:state.errors[0],configurable:true});}catch{}
  try{Object.defineProperty(error,'cleanupErrors',{value:state.errors,configurable:true});}catch{}
}
async function withSource(path,maximum,sha256,work){
  const source=await openResearchSource(path,maximum,{sha256});
  let failure;
  try{return await work(source);}
  catch(error){failure=error;throw error;}
  finally{
    try{await source.close();}
    catch(error){
      if(failure)preserveCleanup(failure,error,()=>source.close());
      else{preserveCleanup(error,error,()=>source.close());throw error;}
    }
  }
}
async function through(input,codec,signal,work){
  const ended=pipeline(input,codec,...(signal?[{signal}]:[])).then(()=>null,error=>error);
  let failure;
  try{
    const result=await work(codec);
    const pipelineError=await ended;if(pipelineError)throw pipelineError;
    return result;
  }catch(error){failure=error;throw error;}
  finally{
    input.destroy();codec.destroy();
    const pipelineError=await ended;
    if(pipelineError&&failure&&pipelineError!==failure)
      preserveCleanup(failure,pipelineError);
  }
}

/** Validate the original manifest without inventing a second dossier format.
 * The original complete dossier compiler still runs before export and after
 * retained receiving. This transport also checks every declared original byte.
 */
function manifestFiles(manifest){
  customerFields(manifest,['schema','createdAt','selection','files'],code+'MANIFEST_INVALID');
  check(manifest.schema==='sf88-research-customer-handover/v1'&&Array.isArray(manifest.files)&&
    manifest.files.length>=6&&manifest.files.length<=7,'MANIFEST_INVALID');
  customerFields(manifest.selection,['workspaceId','dossierId','revision','projectId','delivery','work','sourceWorkspace'],
    code+'SELECTION_INVALID');
  const selected=manifest.selection;
  check(/^research_[a-f0-9]{64}$/.test(selected.workspaceId)&&/^d_[a-f0-9-]{36}$/.test(selected.dossierId)&&
    selected.delivery?.revision===selected.revision&&selected.delivery?.projectId===selected.projectId&&
    selected.work?.id===selected.delivery?.workId&&selected.work?.sha256===selected.delivery?.workSha256,
    'SELECTION_CHANGED');
  check(Array.isArray(selected.delivery.files)&&selected.delivery.files.length===4,'REPORTS_INVALID');
  const {sha256:workSha,...workBody}=selected.work;
  check(customerUpdateDigest(workBody)===workSha,'WORK_CHANGED');
  const expected=new Map([['dossier.research.json.gz',{kind:'dossier'}],
    ['work.review.json',{kind:'work',...selected.work.snapshot}],
    ...selected.delivery.files.map(row=>[row.name,{kind:'report',format:row.format,sha256:row.sha256,bytes:row.bytes}]),
    ...(selected.sourceWorkspace?[['europe-pmc.workspace.json.gz',{kind:'europe-pmc'}]]:[])]);
  const names=new Set();
  check(expected.size===manifest.files.length,'ROSTER_CHANGED');
  for(const file of manifest.files){
    customerFields(file,['name','kind','format','bytes','sha256','contentType'],code+'MEMBER_INVALID');
    customerFilename(file.name);
    const key=file.name.toLowerCase();
    check(file.name!=='handover.json'&&!names.has(key),'MEMBER_NAME_COLLISION');names.add(key);
    customerHash(file.sha256,code+'MEMBER_SHA256_INVALID');
    check(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=memberLimit(file),'MEMBER_SIZE_INVALID');
    check(typeof file.contentType==='string'&&file.contentType.length>0&&file.contentType.length<=1024,
      'MEMBER_CONTENT_TYPE_INVALID');
    const match=expected.get(file.name);
    check(match&&file.kind===match.kind&&(match.format===undefined||file.format===match.format)&&
      (match.sha256===undefined||file.sha256===match.sha256)&&(match.bytes===undefined||file.bytes===match.bytes),
      'MEMBER_CHANGED');
  }
  return manifest.files;
}
class FrameCursor{
  constructor(stream,signal){
    this.iterator=stream[Symbol.asyncIterator]();this.signal=signal;
    this.buffer=Buffer.alloc(0);this.offset=0;this.total=0;this.limit=MAX_FRAME;this.done=false;
  }
  async fill(){
    while(this.offset===this.buffer.length&&!this.done){
      stop(this.signal);
      const next=await this.iterator.next();
      if(next.done){this.done=true;this.buffer=Buffer.alloc(0);this.offset=0;break;}
      check(next.value instanceof Uint8Array,'STREAM_INVALID');
      this.buffer=Buffer.from(next.value.buffer,next.value.byteOffset,next.value.byteLength);
      this.offset=0;this.total+=this.buffer.length;
      check(this.total<=this.limit,'FRAME_SIZE_LIMIT');
    }
    return this.offset<this.buffer.length;
  }
  async *take(bytes){
    let left=bytes;
    while(left>0){
      check(await this.fill(),'TRUNCATED');stop(this.signal);
      const count=Math.min(left,this.buffer.length-this.offset,65536);
      const part=this.buffer.subarray(this.offset,this.offset+count);
      this.offset+=count;left-=count;yield part;
    }
  }
  async read(bytes){
    const result=Buffer.allocUnsafe(bytes);let offset=0;
    for await(const part of this.take(bytes)){part.copy(result,offset);offset+=part.length;}
    return result;
  }
  async end(){check(!await this.fill(),'TRAILING_DATA');}
  async close(){await this.iterator.return?.();}
}
async function readFrame(stream,signal,{onManifest,onFile}={}){
  const cursor=new FrameCursor(stream,signal);
  try{
    check((await cursor.read(MAGIC.length)).equals(MAGIC),'MAGIC_INVALID');
    const length=(await cursor.read(4)).readUInt32BE(0);
    check(length>0&&length<=CUSTOMER_FILE_LIMIT,'MANIFEST_SIZE_INVALID');
    const manifestBody=await cursor.read(length),manifest=parseJson(manifestBody);
    const files=manifestFiles(manifest),manifestSha256=digest(manifestBody);
    cursor.limit=MAGIC.length+4+length+files.reduce((total,file)=>total+file.bytes,0);
    check(cursor.limit<=MAX_FRAME&&cursor.total<=cursor.limit,'FRAME_SIZE_LIMIT');
    await onManifest?.({manifest,manifestBody,manifestSha256,manifestBytes:length});
    for(const file of files){
      const hash=createHash('sha256');let consumed=false;
      const body=(async function*(){
        for await(const part of cursor.take(file.bytes)){hash.update(part);yield part;}
        check(hash.digest('hex')===file.sha256,'MEMBER_BYTES_CHANGED');consumed=true;
      })();
      if(onFile)await onFile(file,body);else for await(const _part of body){}
      check(consumed,'MEMBER_NOT_CONSUMED');
    }
    await cursor.end();stop(signal);
    return {manifest,manifestBody,manifestSha256,manifestBytes:length};
  }finally{await cursor.close();}
}
async function inspectArchive(path,pins,signal,handlers){
  stop(signal);
  return withSource(path,RESEARCH_PAID_ARCHIVE_LIMIT,pins.sha256,async source=>{
    check(source.bytes===pins.bytes,'BYTES_CHANGED');stop(signal);
    return through(source.stream,createGunzip({chunkSize:65536}),signal,async codec=>{
      const frame=await readFrame(codec,signal,handlers);
      check(codec.bytesWritten===source.bytes,'COMPRESSED_TRAILING_DATA');
      return {...frame,archive:metadata(path,source.bytes,source.sha256)};
    });
  });
}
function publicInspection(value){
  return {schema:'sf88-research-paid-archive-inspected/v1',archive:value.archive,
    manifestSha256:value.manifestSha256,manifestBytes:value.manifestBytes,
    manifest:clone(value.manifest),selection:clone(value.manifest.selection),files:clone(value.manifest.files)};
}
export async function inspectResearchPaidArchive({path,expectedSha256,expectedBytes,signal}={}){
  const file=selectedPath(path),pins=archivePins(expectedSha256,expectedBytes),selectedSignal=inputSignal(signal);
  return publicInspection(await inspectArchive(file,pins,selectedSignal));
}
async function readRecord(root,name){
  if(!await exists(join(root,name)))return null;
  const saved=await readCustomerJson(join(root,name),65536);
  // Reuse the original metadata publisher's same-inode stopped-link repair.
  await retainCustomerBytes(root,name,saved.body);
  return saved.value;
}
function operation(kind,manifestSha256,manifestBytes,archive){
  return {schema:OP_SCHEMA,kind,manifestSha256,manifestBytes,
    ...(archive?{archive:{bytes:archive.bytes,sha256:archive.sha256}}:{})};
}
function validateOperation(value,kind,manifestSha256,pins){
  customerFields(value,['schema','kind','manifestSha256','manifestBytes','archive'],code+'OPERATION_CHANGED');
  check(value.schema===OP_SCHEMA&&value.kind===kind&&value.manifestSha256===manifestSha256&&
    Number.isSafeInteger(value.manifestBytes)&&value.manifestBytes>0&&value.manifestBytes<=CUSTOMER_FILE_LIMIT,
    'OPERATION_CHANGED');
  if(kind==='RECEIVE'){
    customerFields(value.archive,['bytes','sha256'],code+'OPERATION_CHANGED');
    check(value.archive.sha256===pins.sha256&&value.archive.bytes===pins.bytes,'OPERATION_CHANGED');
  }else check(value.archive===undefined,'OPERATION_CHANGED');
  return value;
}
function completion(op,archive){
  return {schema:RESULT_SCHEMA,kind:op.kind,manifestSha256:op.manifestSha256,manifestBytes:op.manifestBytes,
    archive:{name:RESEARCH_PAID_ARCHIVE_NAME,bytes:archive.bytes,sha256:archive.sha256,contentType:'application/gzip'}};
}
async function finishCompletion(root,op,archive,existing){
  const value=completion(op,archive);
  check(!existing||customerUpdateSame(existing,value),'RESULT_CHANGED');
  await retainCustomerJson(root,RESULT,value);
}
async function finishPortablePublication(path,pins){
  const verified=await describeCustomerFile(path,{...pins,maximum:Math.max(pins.bytes,1)});
  const before=await lstat(path);
  check(before.isFile()&&!before.isSymbolicLink(),'FILE_CHANGED');
  for(const name of await readdir(dirname(path))){
    if(!PORTABLE_TEMP.test(name))continue;
    const candidate=join(dirname(path),name);
    let current;try{current=await lstat(candidate);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(current.isFile()&&!current.isSymbolicLink()&&current.dev===before.dev&&current.ino===before.ino)
      await unlink(candidate);
  }
  await syncDirectory(dirname(path));
  return verified;
}
function invalidTemporary(error){
  const value=String(error?.code??'');
  return value==='ENOENT'||value==='JSON_INVALID'||value==='Z_DATA_ERROR'||value==='Z_BUF_ERROR'||
    value.startsWith(code)||value.startsWith('CUSTOMER_UPDATE_')||value.startsWith('RESEARCH_HOST_')||
    value==='ERR_STREAM_PREMATURE_CLOSE';
}
async function recoverArchivePublication(root,op,signal){
  const destination=join(root,RESEARCH_PAID_ARCHIVE_NAME);
  for(const name of (await readdir(root)).filter(value=>PORTABLE_TEMP.test(value)).sort()){
    stop(signal);const path=join(root,name);let inspected,before;
    try{
      before=await lstat(path);
      if(!before.isFile()||before.isSymbolicLink()||before.size<=0||before.size>RESEARCH_PAID_ARCHIVE_LIMIT||
        process.platform!=='win32'&&((before.mode&0o077)!==0||process.getuid&&before.uid!==process.getuid()))continue;
      const file=await describeCustomerFile(path,{maximum:RESEARCH_PAID_ARCHIVE_LIMIT});
      if(op.archive&&(file.sha256!==op.archive.sha256||file.bytes!==op.archive.bytes))continue;
      inspected=await inspectArchive(path,file,signal);
      if(inspected.manifestSha256!==op.manifestSha256||inspected.manifestBytes!==op.manifestBytes)continue;
    }catch(error){stop(signal);if(invalidTemporary(error))continue;throw error;}
    const current=await lstat(path);
    check(current.isFile()&&!current.isSymbolicLink()&&current.dev===before.dev&&current.ino===before.ino&&
      current.size===before.size&&current.mtimeMs===before.mtimeMs&&current.ctimeMs===before.ctimeMs,
      'PUBLICATION_CHANGED');
    try{await link(path,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
    await finishPortablePublication(destination,inspected.archive);
    return true;
  }
  return false;
}
async function *sourceFrame(source,manifestBody,signal){
  const size=Buffer.alloc(4);size.writeUInt32BE(manifestBody.length,0);
  yield MAGIC;yield size;yield manifestBody;
  for(const file of source.files){
    stop(signal);
    const original=await openResearchSource(file.path,memberLimit(file),{sha256:file.sha256});
    let failure;
    try{
      check(original.bytes===file.bytes,'SOURCE_MEMBER_CHANGED');
      for await(const part of original.stream){stop(signal);yield part;}
    }catch(error){failure=error;throw error;}
    finally{
      try{await original.close();}
      catch(error){
        if(failure)preserveCleanup(failure,error,()=>original.close());
        else{preserveCleanup(error,error,()=>original.close());throw error;}
      }
    }
  }
  stop(signal);
}
async function publishArchive(root,source,manifestBody,signal){
  const path=join(root,RESEARCH_PAID_ARCHIVE_NAME),input=Readable.from(sourceFrame(source,manifestBody,signal));
  const saved=await through(input,createGzip({level:9,chunkSize:65536}),signal,async compressed=>{
    const body=(async function*(){
      let count=0;
      for await(const chunk of compressed){
        stop(signal);count+=chunk.length;check(count<=RESEARCH_PAID_ARCHIVE_LIMIT,'SIZE_LIMIT');yield chunk;
      }
      check(count>0,'EMPTY');
    })();
    return writePortableFile(path,{filename:RESEARCH_PAID_ARCHIVE_NAME,contentType:'application/gzip',body});
  });
  await finishPortablePublication(path,{bytes:saved.bytes,sha256:saved.sha256});
}
export async function createResearchPaidArchive({directory,sourceDirectory,manifestSha256,signal}={}){
  const destination=selectedPath(directory),donor=selectedPath(sourceDirectory,true);
  customerHash(manifestSha256,code+'MANIFEST_SHA256_REQUIRED');
  const selectedSignal=inputSignal(signal);
  return withCustomerOperation(destination,async root=>{
    stop(selectedSignal);
    const payload=join(root,RESEARCH_PAID_ARCHIVE_NAME);
    let op=await readRecord(root,OPERATION),source;
    const saved=await readRecord(root,RESULT);
    if(op)validateOperation(op,'CREATE',manifestSha256);
    else{
      check(!saved&&!await exists(payload),'UNOWNED_OUTPUT');
      check(donor,'SOURCE_REQUIRED');
      source=await inspectCustomerHandover(donor,{manifestSha256});
      manifestFiles(source.manifest);stop(selectedSignal);
      op=operation('CREATE',source.manifestSha256,source.manifestBytes);
      await retainCustomerJson(root,OPERATION,op);
    }
    let existed=await exists(payload);
    if(!existed){
      check(!saved,'COMPLETED_FILE_MISSING');
      existed=await recoverArchivePublication(root,op,selectedSignal);
      if(!existed){
        check(donor,'SOURCE_REQUIRED');
        source??=await inspectCustomerHandover(donor,{manifestSha256:op.manifestSha256});
        check(source.manifestBytes===op.manifestBytes,'SOURCE_CHANGED');
        manifestFiles(source.manifest);
        const body=await readResearchHostFile(join(source.directory,'handover.json'),CUSTOMER_FILE_LIMIT,
          {sha256:op.manifestSha256});
        check(body.length===op.manifestBytes,'SOURCE_CHANGED');
        await retainCustomerBytes(root,SOURCE_MANIFEST,body);
        stop(selectedSignal);await publishArchive(root,source,body,selectedSignal);
      }
    }
    const pins=await describeCustomerFile(payload,{maximum:RESEARCH_PAID_ARCHIVE_LIMIT,
      ...(saved?{bytes:saved.archive?.bytes,sha256:saved.archive?.sha256}:{})});
    const inspected=await inspectArchive(payload,pins,selectedSignal);
    check(inspected.manifestSha256===op.manifestSha256&&inspected.manifestBytes===op.manifestBytes,'MANIFEST_CHANGED');
    await finishPortablePublication(payload,inspected.archive);
    await retainCustomerBytes(root,SOURCE_MANIFEST,inspected.manifestBody);
    stop(selectedSignal);await finishCompletion(root,op,inspected.archive,saved);
    return {schema:'sf88-research-paid-archive/v1',directory:root,manifestSha256:op.manifestSha256,
      manifestBytes:op.manifestBytes,selection:clone(inspected.manifest.selection),archive:inspected.archive,
      reused:Boolean(saved)||existed};
  });
}
async function recoverMemberPublication(root,file,signal){
  const destination=join(root,file.name);
  for(const name of (await readdir(root)).filter(value=>PORTABLE_TEMP.test(value)).sort()){
    stop(signal);const path=join(root,name);let before;
    try{
      before=await lstat(path);
      if(!before.isFile()||before.isSymbolicLink()||before.size!==file.bytes||
        process.platform!=='win32'&&((before.mode&0o077)!==0||process.getuid&&before.uid!==process.getuid()))continue;
      await describeCustomerFile(path,{bytes:file.bytes,sha256:file.sha256,maximum:Math.max(file.bytes,1)});
    }catch(error){stop(signal);if(invalidTemporary(error))continue;throw error;}
    const current=await lstat(path);
    check(current.isFile()&&!current.isSymbolicLink()&&current.dev===before.dev&&current.ino===before.ino&&
      current.size===before.size&&current.mtimeMs===before.mtimeMs&&current.ctimeMs===before.ctimeMs,
      'PUBLICATION_CHANGED');
    try{await link(path,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
    await finishPortablePublication(destination,{bytes:file.bytes,sha256:file.sha256});
    return true;
  }
  return false;
}
async function retainMember(root,file,body,signal){
  const path=join(root,file.name),pins={sha256:file.sha256,bytes:file.bytes};
  if(await exists(path)||await recoverMemberPublication(root,file,signal)){
    await finishPortablePublication(path,pins);
    for await(const _part of body)stop(signal);
    return;
  }
  // The original publisher owns each full member. Failure before its final
  // link leaves the original archive available to repeat this same extraction.
  try{
    await writePortableFile(path,{filename:file.name,contentType:file.contentType,body});
  }catch(error){if(error.code!=='EEXIST')throw error;}
  await finishPortablePublication(path,pins);stop(signal);
}
export async function receiveResearchPaidArchive({directory,path,expectedSha256,expectedBytes,manifestSha256,signal}={}){
  const destination=selectedPath(directory),donor=selectedPath(path,true),pins=archivePins(expectedSha256,expectedBytes);
  customerHash(manifestSha256,code+'MANIFEST_SHA256_REQUIRED');
  const selectedSignal=inputSignal(signal);
  return withCustomerOperation(destination,async root=>{
    stop(selectedSignal);
    const payload=join(root,RESEARCH_PAID_ARCHIVE_NAME);
    let op=await readRecord(root,OPERATION);
    const saved=await readRecord(root,RESULT);
    if(op)validateOperation(op,'RECEIVE',manifestSha256,pins);
    else{
      check(!saved&&!await exists(payload),'UNOWNED_OUTPUT');check(donor,'SOURCE_REQUIRED');
      // Full expected compressed hash and the complete frame are checked
      // before fixing immutable input or publishing any extracted member.
      const inspected=await inspectArchive(donor,pins,selectedSignal);
      check(inspected.manifestSha256===manifestSha256,'MANIFEST_CHANGED');
      op=operation('RECEIVE',manifestSha256,inspected.manifestBytes,pins);
      stop(selectedSignal);await retainCustomerJson(root,OPERATION,op);
    }
    if(!await exists(payload)){
      check(!saved,'COMPLETED_FILE_MISSING');
      if(!await recoverArchivePublication(root,op,selectedSignal)){
        check(donor,'SOURCE_REQUIRED');stop(selectedSignal);
        await copyCustomerFile(donor,payload,{...pins,maximum:RESEARCH_PAID_ARCHIVE_LIMIT});
      }
    }
    await finishPortablePublication(payload,pins);stop(selectedSignal);
    const handoverDirectory=await customerDirectory(join(root,'handover'),{create:!saved});
    if(saved){
      const inspected=await inspectArchive(payload,pins,selectedSignal);
      check(inspected.manifestSha256===op.manifestSha256&&inspected.manifestBytes===op.manifestBytes,'MANIFEST_CHANGED');
      const handover=await inspectCustomerHandover(handoverDirectory,{manifestSha256:op.manifestSha256});
      check(customerUpdateSame(handover.manifest,inspected.manifest),'HANDOVER_CHANGED');
      await retainCustomerBytes(handoverDirectory,'handover.json',inspected.manifestBody);
      await finishCompletion(root,op,inspected.archive,saved);
      return {schema:'sf88-research-paid-archive-received/v1',directory:root,archive:inspected.archive,
        manifestSha256:op.manifestSha256,handover,reused:true};
    }
    const inspected=await inspectArchive(payload,pins,selectedSignal,{
      onManifest:frame=>{
        check(frame.manifestSha256===op.manifestSha256&&frame.manifestBytes===op.manifestBytes,'MANIFEST_CHANGED');
      },
      onFile:(file,body)=>retainMember(handoverDirectory,file,body,selectedSignal),
    });
    // Publish the native manifest only after every member and the complete
    // compressed input have passed. Original native receiving remains separate.
    await retainCustomerBytes(handoverDirectory,'handover.json',inspected.manifestBody);
    const handover=await inspectCustomerHandover(handoverDirectory,{manifestSha256:op.manifestSha256});
    check(customerUpdateSame(handover.manifest,inspected.manifest),'HANDOVER_CHANGED');
    stop(selectedSignal);await finishCompletion(root,op,inspected.archive,saved);
    return {schema:'sf88-research-paid-archive-received/v1',directory:root,archive:inspected.archive,
      manifestSha256:op.manifestSha256,handover,reused:false};
  });
}
