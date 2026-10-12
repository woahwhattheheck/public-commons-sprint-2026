// MIT. Explicit immutable source bindings for a selected continuation runtime.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {absolute,digest,jsonBytes,parseJson,need,object} from './store.mjs';

const SOURCE_SCHEMA='stellar-forge.node-successor-runtime-source.v1';
const BINDING_SCHEMA='stellar-forge.node-successor-runtime-binding.v1';
const HASH=/^[a-f0-9]{64}$/;
const MAX_MANIFEST=4*1024*1024,MAX_FILE=64*1024*1024,MAX_TOTAL=512*1024*1024;
const copy=value=>parseJson(jsonBytes(value));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?
  Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(left,right)=>canonical(left)===canonical(right);
const sourceError='CONTINUATION_RUNTIME_SOURCE_CHANGED';
function checkSignal(signal){
  need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted,'OPERATION_ABORTED_BEFORE_START');
}
function keys(value,allowed){
  return object(value)&&Object.keys(value).every(key=>allowed.includes(key));
}
function localPath(value){
  need(typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes('\0')&&
    !isAbsolute(value)&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),
    'CONTINUATION_RUNTIME_RELATIVE_PATH_REQUIRED');
  return value;
}
async function canonicalDirectory(value){
  const path=absolute(value);
  need(path===value&&await realpath(path)===path&&(await lstat(path)).isDirectory(),
    'CONTINUATION_RUNTIME_CANONICAL_DIRECTORY_REQUIRED');
  return path;
}
function within(root,path){
  const rel=relative(root,path);
  return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);
}
async function readSource(path,{limit=MAX_FILE,signal,collect=false,buffer=Buffer.alloc(65536)}={}){
  checkSignal(signal);
  need(await realpath(dirname(path))===dirname(path),sourceError);
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(before.isFile()&&named.isFile()&&before.dev===named.dev&&before.ino===named.ino&&
      before.size<=BigInt(limit),sourceError);
    const hash=createHash('sha256'),parts=[];
    let count=0;
    for(;;){
      checkSignal(signal);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,count);
      if(bytesRead===0)break;
      count+=bytesRead;need(count<=limit,sourceError);
      const part=buffer.subarray(0,bytesRead);hash.update(part);
      if(collect)parts.push(Buffer.from(part));
    }
    const after=await handle.stat({bigint:true}),finalName=await lstat(path,{bigint:true});
    need(after.dev===before.dev&&after.ino===before.ino&&after.size===before.size&&
      after.mtimeNs===before.mtimeNs&&after.ctimeNs===before.ctimeNs&&
      finalName.isFile()&&finalName.dev===after.dev&&finalName.ino===after.ino&&
      BigInt(count)===after.size,sourceError);
    return{bytes:count,sha256:hash.digest('hex'),...(collect?{raw:Buffer.concat(parts,count)}:{})};
  }finally{await handle.close();}
}

/** Read and verify the caller-selected complete source manifest without running its code. */
export async function readSuccessorRuntimeSource(value,{signal}={}){
  need(keys(value,['directory','sourceManifestFile','sourceManifestSha256'])&&
    HASH.test(value.sourceManifestSha256??''),'CONTINUATION_RUNTIME_DESCRIPTOR_INVALID');
  const chosen=copy(value);checkSignal(signal);
  const directory=await canonicalDirectory(chosen.directory),manifestPath=absolute(chosen.sourceManifestFile);
  need(manifestPath===chosen.sourceManifestFile,'CONTINUATION_RUNTIME_MANIFEST_PATH_INVALID');
  const manifestBytes=await readSource(manifestPath,{limit:MAX_MANIFEST,signal,collect:true});
  need(manifestBytes.sha256===chosen.sourceManifestSha256,'CONTINUATION_RUNTIME_MANIFEST_CHANGED');
  const manifest=parseJson(manifestBytes.raw);
  need(keys(manifest,['schema','sourceDirectory','runtimeDirectory','files'])&&
    manifest.schema===SOURCE_SCHEMA&&manifest.runtimeDirectory===directory&&
    Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=10000,
    'CONTINUATION_RUNTIME_MANIFEST_INVALID');
  const sourceDirectory=await canonicalDirectory(manifest.sourceDirectory);
  need(within(sourceDirectory,directory),'CONTINUATION_RUNTIME_SOURCE_ROOT_INVALID');
  const prefix=relative(sourceDirectory,directory).split(sep).join('/'),paths=new Set();
  let total=0;
  const readBuffer=Buffer.alloc(65536);
  for(const entry of manifest.files){
    need(keys(entry,['path','bytes','sha256'])&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&
      entry.bytes<=MAX_FILE&&HASH.test(entry.sha256??''),'CONTINUATION_RUNTIME_FILE_INVALID');
    localPath(entry.path);need(!paths.has(entry.path),'CONTINUATION_RUNTIME_DUPLICATE_FILE');
    paths.add(entry.path);total+=entry.bytes;need(total<=MAX_TOTAL,'CONTINUATION_RUNTIME_SOURCE_LIMIT');
    const path=resolve(sourceDirectory,...entry.path.split('/'));
    need(within(sourceDirectory,path)&&path!==manifestPath,'CONTINUATION_RUNTIME_FILE_PATH_INVALID');
    const actual=await readSource(path,{limit:Math.max(1,entry.bytes),signal,buffer:readBuffer});
    need(actual.bytes===entry.bytes&&actual.sha256===entry.sha256,sourceError);
  }
  // These are the native entry, original financial transport, and the source
  // readers used at each continuation edge. The complete manifest may include
  // the rest of the installed source closure and any explicitly selected entry.
  const required=[
    'cli.mjs','config.mjs','execute.mjs','attempt-wire.mjs','request-body.mjs',
    'workspace.mjs','operation-ticket.mjs','node/client.mjs','node/runtime.mjs',
    'node/store.mjs','node/unpaid-continuation.mjs','node/expired-continuation.mjs',
    'node/authorization-dispatch.mjs','node/runtime-source.mjs',
    'node/file-reservation.mjs','node/reserved-entry.mjs',
  ].map(path=>prefix+'/'+path);
  const siblingPrefix=prefix.includes('/')?prefix.slice(0,prefix.lastIndexOf('/')+1):'';
  required.push(...[
    'sf31-buyer-client/buyer.mjs','sf31-buyer-client/response-file.mjs',
    'sf31-buyer-client/public-transport.mjs','sf81-buyer-operator-bridge/bridge.mjs',
    'sf82-checkout-evidence/evidence.mjs',
  ].map(path=>siblingPrefix+path));
  need(required.every(path=>paths.has(path)),'CONTINUATION_RUNTIME_SOURCE_INCOMPLETE');
  const manifestAgain=await readSource(manifestPath,{limit:MAX_MANIFEST,signal});
  need(manifestAgain.sha256===manifestBytes.sha256&&manifestAgain.bytes===manifestBytes.bytes,
    'CONTINUATION_RUNTIME_MANIFEST_CHANGED');
  checkSignal(signal);
  const binding={schema:BINDING_SCHEMA,directory,sourceDirectory,
    sourceManifestFile:manifestPath,sourceManifestSha256:manifestBytes.sha256,
    sourceManifestBytes:manifestBytes.bytes,filesSha256:digest(canonical(manifest.files)),
    fileCount:manifest.files.length,sourceBytes:total};
  return{...binding,sha256:digest(canonical(binding))};
}

export async function verifySuccessorRuntimeSource(binding,{signal}={}){
  need(keys(binding,['schema','directory','sourceDirectory','sourceManifestFile',
    'sourceManifestSha256','sourceManifestBytes','filesSha256','fileCount','sourceBytes','sha256'])&&
    binding.schema===BINDING_SCHEMA&&HASH.test(binding.sha256??''),
    'CONTINUATION_RUNTIME_BINDING_INVALID');
  const expected=copy(binding);
  const current=await readSuccessorRuntimeSource({directory:expected.directory,
    sourceManifestFile:expected.sourceManifestFile,
    sourceManifestSha256:expected.sourceManifestSha256},{signal});
  need(same(current,expected),sourceError);
  return current;
}

function buyerOptions(buyer,directory){
  const runtime=buyer.runtime;
  return{runtimeDirectory:directory,stateDirectory:buyer.stateDirectory,
    operatorProfile:buyer.operatorProfile,datasetReportLimit:buyer.datasetReportLimit,
    inboxReportLimit:buyer.inboxReportLimit,node:runtime.node,environment:{...runtime.environment},
    timeoutMs:runtime.timeoutMs,cleanupGraceMs:runtime.cleanupGraceMs,outputLimit:runtime.outputLimit,
    ...(runtime.reserveFile===undefined?{}:{reserveFile:runtime.reserveFile}),
    ...(runtime.nativeFileReservation===undefined?{}:{nativeFileReservation:copy(runtime.nativeFileReservation)}),
    ...(runtime.nativeRuntimeSource?.directory===directory?{nativeRuntimeSource:copy(runtime.nativeRuntimeSource)}:{})};
}

/** Instantiate the selected source's own Buyer and recheck it before every native invocation. */
export async function createRuntimeBoundBuyer(buyer,binding,{signal}={}){
  const checked=await verifySuccessorRuntimeSource(binding,{signal});
  const {Buyer}=await import(pathToFileURL(join(checked.directory,'node/client.mjs')).href);
  need(typeof Buyer==='function','CONTINUATION_RUNTIME_BUYER_REQUIRED');
  return new Buyer({...buyerOptions(buyer,checked.directory),nativeRuntimeSource:checked});
}

/** Use the selected runtime's own client/store implementation after its source is verified. */
export async function successorOperation(parent,intentId,binding,{signal}={}){
  if(binding===undefined)return parent.buyer.operation(intentId);
  need(binding.directory!==parent.buyer.runtime.directory,'CONTINUATION_RUNTIME_MUST_BE_DISTINCT');
  return (await createRuntimeBoundBuyer(parent.buyer,binding,{signal})).operation(intentId);
}

/** Reconstruct the original parent using the already-loaded trusted Buyer class. */
export function originalRuntimeParent(operation,marker){
  if(marker.parentRuntimeDirectory===undefined)return operation.buyer.operation(marker.parentIntentId);
  const directory=absolute(marker.parentRuntimeDirectory);
  need(directory===marker.parentRuntimeDirectory&&
    HASH.test(marker.successorRuntimeSha256??''),'CONTINUATION_RUNTIME_PARENT_INVALID');
  return new operation.buyer.constructor(buyerOptions(operation.buyer,directory)).operation(marker.parentIntentId);
}
