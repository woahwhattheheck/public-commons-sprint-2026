// MIT. Portable SF49 source delivery through the original SF74/SF77 receiver.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  BUNDLE_SCHEMA,SOURCE_EDITION_LIMITS,inspectSourceEditionWorkorder,receiveSourceEditionWorkorder
} from './source-edition-workorder.mjs';
import {
  privateDirectory,fileDigest
} from '../../scf-starforge-20261009/sf30-seller-sdk/duckdb/cloud-delivery/files.mjs';

export const SOURCE_ARCHIVE_SCHEMA='stellar-forge.sf49.source-edition-archive.v1';
export const SOURCE_ARCHIVE_LIMITS=Object.freeze({
  fileBytes:SOURCE_EDITION_LIMITS.fileBytes,sourceBytes:SOURCE_EDITION_LIMITS.sourceBytes,
  handoffBytes:SOURCE_EDITION_LIMITS.handoffBytes,termsBytes:SOURCE_EDITION_LIMITS.termsBytes,
  // The original accepted inventory, plus its exact manifest. ZIP framing and
  // bounded compression overhead have a separate upload allowance.
  expandedBytes:SOURCE_EDITION_LIMITS.bundleBytes+SOURCE_EDITION_LIMITS.metadataBytes,
  archiveBytes:SOURCE_EDITION_LIMITS.bundleBytes+SOURCE_EDITION_LIMITS.metadataBytes+16*1024**2,
  members:72,metadataBytes:SOURCE_EDITION_LIMITS.metadataBytes
});
const NATIVE=fileURLToPath(new URL('./source-edition-archive.py',import.meta.url));
const SHA=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const problem=(code,message=code,status=422)=>Object.assign(new Error(message),{code,status});
const ensure=(value,code,message)=>{if(!value)throw problem(code,message);};
function record(value,keys,label) {
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>keys.includes(key)),'SF49_ARCHIVE_INPUT_INVALID','Invalid '+label);
}
async function privateRoot(value) {
  const root=await privateDirectory(resolve(value)),info=await lstat(root);
  ensure((info.mode&0o077)===0,'SF49_ARCHIVE_PRIVATE_DIRECTORY_REQUIRED');
  return root;
}
function inventory(value) {
  return [...value.manifest.files.map(file=>({path:file.path,bytes:String(file.bytes),sha256:file.sha256})),
    {path:'manifest.json',bytes:String(value.manifestBytes),sha256:value.manifestSha256}];
}
function envelope(value) {
  return {schema:SOURCE_ARCHIVE_SCHEMA,originalSchema:BUNDLE_SCHEMA,
    operationId:value.operationId,bundleId:value.bundleId,manifestSha256:value.manifestSha256,
    generatedAt:value.generatedAt,files:inventory(value)};
}
export function validateSourceArchiveManifest(value) {
  record(value,['schema','originalSchema','operationId','bundleId','manifestSha256','generatedAt','files'],'source archive manifest');
  ensure(value.schema===SOURCE_ARCHIVE_SCHEMA&&value.originalSchema===BUNDLE_SCHEMA,'SF49_ARCHIVE_SCHEMA_INVALID');
  ensure(typeof value.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.operationId)&&
    SHA.test(value.bundleId)&&SHA.test(value.manifestSha256),'SF49_ARCHIVE_IDENTITY_INVALID');
  ensure(typeof value.generatedAt==='string'&&value.generatedAt.length<=64&&Number.isFinite(Date.parse(value.generatedAt)),
    'SF49_ARCHIVE_TIME_INVALID');
  ensure(Array.isArray(value.files)&&value.files.length>=7&&value.files.length<SOURCE_ARCHIVE_LIMITS.members,
    'SF49_ARCHIVE_INVENTORY_INVALID');
  const names=new Set();let total=0;
  for(const file of value.files) {
    record(file,['path','bytes','sha256'],'archive source file');
    ensure(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.includes('\\')&&
      !file.path.split('/').some(part=>!part||part==='.'||part==='..')&&!names.has(file.path),
      'SF49_ARCHIVE_PATH_INVALID');
    ensure(typeof file.bytes==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(file.bytes)&&
      Number.isSafeInteger(Number(file.bytes))&&Number(file.bytes)<=SOURCE_ARCHIVE_LIMITS.fileBytes&&SHA.test(file.sha256),'SF49_ARCHIVE_FILE_PIN_INVALID');
    total+=Number(file.bytes);names.add(file.path);
  }
  ensure(names.has('manifest.json')&&total<=SOURCE_ARCHIVE_LIMITS.expandedBytes,'SF49_ARCHIVE_SIZE_LIMIT');
  const original=value.files.find(file=>file.path==='manifest.json');
  ensure(original.sha256===value.manifestSha256,'SF49_ARCHIVE_MANIFEST_PIN_INVALID');
  return value;
}
function sameEnvelope(actual,inspected) {
  validateSourceArchiveManifest(actual);
  ensure(canonical(actual)===canonical(envelope(inspected)),'SF49_ARCHIVE_ORIGINAL_BINDING_CHANGED',
    'The archive does not contain exactly the original source bundle and its declared files.');
}
async function native(input,{python=process.env.SCF_PYTHON||'python3',environment=process.env,signal}={}) {
  ensure(typeof python==='string'&&python&&!python.includes('\0'),'SF49_ARCHIVE_PYTHON_INVALID');
  ensure(Number.isSafeInteger(SOURCE_EDITION_LIMITS.handoffBytes)&&SOURCE_EDITION_LIMITS.handoffBytes>0&&
    SOURCE_EDITION_LIMITS.handoffBytes<=SOURCE_EDITION_LIMITS.fileBytes,'SF49_ARCHIVE_NATIVE_HANDOFF_LIMIT');
  // Only the original server-derived constant crosses this private child ABI.
  // Browser metadata cannot select or expand the archive policy.
  const request=Buffer.from(JSON.stringify({...input,nativeHandoffBytes:SOURCE_EDITION_LIMITS.handoffBytes})+'\n');
  ensure(request.length<=SOURCE_ARCHIVE_LIMITS.metadataBytes,'SF49_ARCHIVE_METADATA_LIMIT');
  if(signal?.aborted)throw problem('SF49_ARCHIVE_ABORTED','The original archive operation was cancelled.',409);
  return new Promise((accept,reject)=>{
    let child,spawnError=null,protocolError=null,stdoutBytes=0,stderrBytes=0,killTimer=null;
    const chunks=[];
    const stop=()=>{
      if(child&&!child.killed)child.kill('SIGTERM');
      if(!killTimer) {killTimer=setTimeout(()=>child?.kill('SIGKILL'),5000);killTimer.unref?.();}
    };
    const abort=()=>{protocolError=problem('SF49_ARCHIVE_ABORTED','The original archive operation was cancelled.',409);stop();};
    try {child=spawn(python,['-B',NATIVE],{env:environment,stdio:['pipe','pipe','pipe'],shell:false});}
    catch(error){reject(error);return;}
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',error=>{spawnError=error;});
    child.stdout.on('data',chunk=>{
      stdoutBytes+=chunk.length;
      if(stdoutBytes>4*SOURCE_ARCHIVE_LIMITS.metadataBytes) {
        protocolError=problem('SF49_ARCHIVE_RESULT_LIMIT');stop();return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data',chunk=>{
      stderrBytes+=chunk.length;
      if(stderrBytes>256*1024){protocolError=problem('SF49_ARCHIVE_DIAGNOSTIC_LIMIT');stop();}
    });
    child.stdin.on('error',error=>{if(error.code!=='EPIPE'){protocolError=error;stop();}});
    child.once('close',(code,exitSignal)=>{
      signal?.removeEventListener('abort',abort);if(killTimer)clearTimeout(killTimer);
      if(spawnError){reject(problem('SF49_ARCHIVE_PYTHON_UNAVAILABLE','Use the configured Python 3 interpreter for source archives.',503));return;}
      if(protocolError){reject(protocolError);return;}
      let result;
      try {result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      catch {reject(problem('SF49_ARCHIVE_NATIVE_INTERRUPTED',
        'No completed native archive result was returned. Continue this same saved transfer to reconcile its original files.',409));return;}
      if(result?.ok===true&&code===0&&!exitSignal){accept(result.result);return;}
      reject(problem(result?.error||'SF49_ARCHIVE_NATIVE_FAILED',
        result?.message||'The original source archive could not complete.',result?.error?.includes('ALREADY_RUNNING')?409:422));
    });
    child.stdin.end(request);
    if(signal?.aborted)abort();
  });
}
export async function exportSourceEditionArchive({directory,destination,...options}) {
  const original=await inspectSourceEditionWorkorder({directory});
  const source=await realpath(resolve(directory)),output=resolve(destination);
  await privateRoot(dirname(output));
  ensure(output!==source&&!output.startsWith(source+sep),'SF49_ARCHIVE_OUTPUT_INSIDE_SOURCE',
    'Save the archive outside the original source bundle.');
  const manifest=envelope(original);
  const result=await native({action:'archive',source,destination:output,inventory:manifest.files,manifest},options);
  return {schema:SOURCE_ARCHIVE_SCHEMA,operationId:original.operationId,bundleId:original.bundleId,
    manifestSha256:original.manifestSha256,archive:result.archive,members:result.members,
    reused:result.reused??false,reconciled:result.reconciled??false,
    filename:'source-edition-'+original.operationId+'.zip',path:output,
    original};
}
export async function inspectSourceEditionArchive({archive,...options}) {
  const path=await realpath(resolve(archive));
  const result=await native({action:'inspect',archive:path},options);
  validateSourceArchiveManifest(result.manifest);
  return {schema:SOURCE_ARCHIVE_SCHEMA,archive:result.archive,members:result.members,
    manifest:result.manifest};
}
export async function receiveSourceEditionArchive({archive,stagingDirectory,destination,...options}) {
  const source=await realpath(resolve(archive)),stage=await privateRoot(stagingDirectory),target=resolve(destination);
  ensure(target!==stage&&!target.startsWith(stage+sep)&&!stage.startsWith(target+sep),
    'SF49_ARCHIVE_RECEIVING_DIRECTORY_INVALID','Use separate retained intake and original receiving directories.');
  const before=await fileDigest(source,SOURCE_ARCHIVE_LIMITS.archiveBytes);
  const result=await native({action:'extract',archive:source,destination:stage},options);
  ensure(result.archive?.bytes===before.bytes&&result.archive?.sha256===before.sha256,
    'SF49_ARCHIVE_SOURCE_CHANGED');
  const original=await inspectSourceEditionWorkorder({directory:stage});
  sameEnvelope(result.manifest,original);
  const received=await receiveSourceEditionWorkorder({directory:stage,destination:target});
  ensure(received.bundleId===original.bundleId&&received.manifestSha256===original.manifestSha256,
    'SF49_ARCHIVE_RECEIVING_CHANGED');
  return {schema:SOURCE_ARCHIVE_SCHEMA,archive:before,manifest:result.manifest,
    received:{...received},source:{operationId:original.operationId,bundleId:original.bundleId,
      manifestSha256:original.manifestSha256}};
}
