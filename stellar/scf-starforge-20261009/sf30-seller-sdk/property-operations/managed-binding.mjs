// MIT. Bind the complete maintained package to one original Socrata/Property workspace.
import {open,readFile,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from './propply.mjs';
import {readDistributionSpecification} from '../../distribution/specification.mjs';
import {readPropertyConnection,createPropertyOperationsClient} from './client.mjs';

export const PROPERTY_BINDING_SCHEMA='stellar-forge.property-application-binding.v1';
export const PROPERTY_STARTUP_SCHEMA='stellar-forge.property-application-startup.v1';
export const PROPERTY_SOURCE_PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/';
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const propertyBindingHash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function propertyApplicationNeed(value,code,message=code) {
  if(!value)throw Object.assign(new Error(message),{code,status:409});
}
const need=propertyApplicationNeed,same=(a,b)=>canonical(a)===canonical(b);
export function propertyAbsolute(value,label='Original path') {
  need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)&&value===resolve(value),
    'PROPERTY_APPLICATION_PATH',label+' must be an absolute original path.');
  return value;
}
function relativeFile(value) {
  need(typeof value==='string'&&value.length>0&&value.length<=1000&&!value.startsWith('/')&&!/[\\\x00-\x1f\x7f]/.test(value)&&
    !value.split('/').some(p=>!p||p==='.'||p==='..'),'PROPERTY_APPLICATION_SOURCE_DECLARATION');
  return value;
}
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export async function propertyOriginalFile(path,maximum=512*1024*1024,{privateOnly=false,bytes=false}={}) {
  propertyAbsolute(path);
  const before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink()&&await realpath(path)===path&&
    Number.isSafeInteger(before.size)&&before.size>=0&&before.size<=maximum,'PROPERTY_APPLICATION_FILE',
    'The original regular file is missing, redirected or exceeds its declared limit.');
  if(privateOnly)need(process.platform==='win32'||(before.mode&0o077)===0&&(!process.getuid||before.uid===process.getuid()),
    'PROPERTY_APPLICATION_PRIVATE_FILE','Keep original connection and host settings private.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const opened=await handle.stat();need(signature(opened)===signature(before),'PROPERTY_APPLICATION_FILE_CHANGED');
    const hash=createHash('sha256'),block=Buffer.alloc(256*1024),chunks=[];let length=0;
    for(;;){const n=(await handle.read(block,0,block.length,null)).bytesRead;if(!n)break;
      length+=n;need(length<=maximum,'PROPERTY_APPLICATION_FILE_CHANGED');hash.update(block.subarray(0,n));if(bytes)chunks.push(Buffer.from(block.subarray(0,n)));}
    need(length===before.size&&signature(await handle.stat())===signature(before)&&
      signature(await lstat(path))===signature(before)&&await realpath(path)===path,'PROPERTY_APPLICATION_FILE_CHANGED');
    return {bytes:length,sha256:hash.digest('hex'),...(bytes?{raw:Buffer.concat(chunks,length)}:{})};
  }finally{await handle.close();}
}
async function privateDirectory(path) {
  propertyAbsolute(path);const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(s.mode&0o077)===0&&(!process.getuid||s.uid===process.getuid())),
    'PROPERTY_APPLICATION_PRIVATE_DIRECTORY','Select an existing private original workspace or connection directory.');
  return path;
}
function decoded(raw){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
async function originalInput(inputPath,path,observed,privateOnly=false){
  if(!inputPath)return null;
  const input=await inputPath(path,'file',false,privateOnly);
  need(input.bytes===observed.bytes&&(!input.sha256||input.sha256===observed.sha256),'PROPERTY_APPLICATION_SOURCE_CHANGED');
  return {...input,sha256:observed.sha256};
}
/** Both original installed and adopted source roots retain the same parent merchant manifest. */
export async function readPropertyApplicationSource(sourceRoot,inputPath=null) {
  sourceRoot=await realpath(propertyAbsolute(sourceRoot,'Selected source root'));
  const manifestPath=join(dirname(sourceRoot),'manifest.json');
  const original=await propertyOriginalFile(manifestPath,4*1024*1024,{bytes:true}),manifest=decoded(original.raw);
  need(plain(manifest)&&manifest.schema==='stellar-forge.merchant-distribution-manifest.v1'&&
    manifest.packageName==='@tokenjunkielabs/starforge-merchant'&&COMMIT.test(manifest.sourceCommit??'')&&
    Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=10000&&
    Number.isSafeInteger(manifest.sourceBytes)&&manifest.sourceBytes>=0&&manifest.sourceBytes<=512*1024*1024,
    'PROPERTY_APPLICATION_SOURCE_DECLARATION','Select the complete original maintained merchant package.');
  const inputs=[],files=[],seen=new Set();let total=0;
  const manifestInput=await originalInput(inputPath,manifestPath,original);if(manifestInput)inputs.push(manifestInput);
  for(const expected of [...manifest.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)) {
    const path=relativeFile(expected.path);
    need(!seen.has(path)&&expected.packagePath==='source/'+path&&HASH.test(expected.sha256??'')&&
      Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&expected.bytes<=512*1024*1024,
      'PROPERTY_APPLICATION_SOURCE_DECLARATION');
    seen.add(path);total+=expected.bytes;need(total<=512*1024*1024,'PROPERTY_APPLICATION_SOURCE_DECLARATION');
    const observed=await propertyOriginalFile(join(sourceRoot,path),expected.bytes);
    need(observed.bytes===expected.bytes&&observed.sha256===expected.sha256,
      'PROPERTY_APPLICATION_SOURCE_CHANGED','The complete selected source differs: '+path);
    files.push({path,...observed});
    const input=await originalInput(inputPath,join(sourceRoot,path),observed);if(input)inputs.push(input);
  }
  need(total===manifest.sourceBytes,'PROPERTY_APPLICATION_SOURCE_DECLARATION');
  for(const path of [PROPERTY_SOURCE_PREFIX+'managed-launch.mjs',PROPERTY_SOURCE_PREFIX+'managed-binding.mjs',
    PROPERTY_SOURCE_PREFIX+'application-provider.mjs',PROPERTY_SOURCE_PREFIX+'client.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/server.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/workspace.mjs'])
    need(seen.has(path),'PROPERTY_APPLICATION_SOURCE_INCOMPLETE','The selected package omits '+path);
  const {spec,manifest:declared}=await readDistributionSpecification({sourceRoot});
  need(declared&&same(declared,manifest)&&spec.commands?.['property-application']===PROPERTY_SOURCE_PREFIX+'managed-launch.mjs'&&
    spec.applicationProviders?.['property-operations']===PROPERTY_SOURCE_PREFIX+'application-provider.mjs',
    'PROPERTY_APPLICATION_SOURCE_DECLARATION','Use the source-owned Property application contribution.');
  need(same(await propertyOriginalFile(manifestPath,4*1024*1024),{bytes:original.bytes,sha256:original.sha256}),
    'PROPERTY_APPLICATION_SOURCE_CHANGED');
  return {sourceRoot,inputs,files,source:{schema:'stellar-forge.property-application-source.v1',
    manifestSha256:original.sha256,manifestBytes:original.bytes,sourceCommit:manifest.sourceCommit,
    sourceFiles:files.length,sourceBytes:total}};
}
/** Mutable capture/property state is observed; only original workspace identity is bound. */
export async function inspectPropertyApplicationBinding({directory,sourceRoot,connectionFile,
  propertyHostFile=null,expectedCreatedAt=null,inputPath=null}={}) {
  directory=await privateDirectory(directory);
  sourceRoot=await realpath(propertyAbsolute(sourceRoot,'Selected source root'));
  connectionFile=propertyAbsolute(connectionFile??join(directory,'property-connection.json'),'Private connection file');
  await privateDirectory(dirname(connectionFile));
  const source=await readPropertyApplicationSource(sourceRoot,inputPath);
  const workspacePath=join(directory,'workspace.json');
  const observed=await propertyOriginalFile(workspacePath,32*1024*1024,{privateOnly:true,bytes:true}),workspace=decoded(observed.raw);
  need(plain(workspace)&&workspace.schema==='stellar-forge.socrata-workspace.v1'&&
    typeof workspace.createdAt==='string'&&Number.isFinite(Date.parse(workspace.createdAt))&&
    (expectedCreatedAt===null||workspace.createdAt===expectedCreatedAt),'PROPERTY_APPLICATION_WORKSPACE_CHANGED',
    'Select the original retained Socrata workspace.');
  const node={executable:await realpath(process.execPath),version:process.versions.node};
  need(Number(node.version.split('.')[0])>=24,'PROPERTY_APPLICATION_NODE_REQUIRED','The original property workspace requires Node 24 or later.');
  let host=null;
  const inputs=[...source.inputs];
  if(propertyHostFile!==null){
    propertyHostFile=propertyAbsolute(propertyHostFile,'Original host settings');
    const body=await propertyOriginalFile(propertyHostFile,1024*1024,{privateOnly:true,bytes:true}),value=decoded(body.raw);
    need(plain(value),'PROPERTY_APPLICATION_HOST_SETTINGS');host={path:propertyHostFile,bytes:body.bytes,sha256:body.sha256};
    const input=await originalInput(inputPath,propertyHostFile,host,true);if(input)inputs.push(input);
  }
  const identity={schema:PROPERTY_BINDING_SCHEMA,directory,createdAt:workspace.createdAt,connectionFile,
    source:source.source,node,host};
  return {binding:{...identity,bindingSha256:propertyBindingHash(identity)},sourceRoot,inputs,
    observed:{workspaceFile:{path:workspacePath,bytes:observed.bytes,sha256:observed.sha256},
      propertyId:workspace.property?.id??null,propertyRevision:workspace.property?.revision??0}};
}
export async function inspectRetainedPropertyConnection(file,binding,{missing=true,verifyOldSource=true}={}) {
  let original;try{original=await propertyOriginalFile(file,16384,{privateOnly:true,bytes:true});}
  catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
  const value=decoded(original.raw);
  need(plain(value)&&value.schema===PROPERTY_STARTUP_SCHEMA&&UUID.test(value.instanceId??'')&&
    value.directory===binding.directory&&value.createdAt===binding.createdAt&&value.connectionFile===file&&
    value.bindingSha256===binding.bindingSha256&&same(value.source,binding.source)&&same(value.node,binding.node)&&
    typeof value.sourceRoot==='string'&&Number.isSafeInteger(value.pid)&&value.pid>0,
    'PROPERTY_APPLICATION_CONNECTION_EXISTS','The retained announcement belongs to another workspace, source or host binding.');
  if(verifyOldSource){const previous=await readPropertyApplicationSource(propertyAbsolute(value.sourceRoot));
    need(same(previous.source,binding.source),'PROPERTY_APPLICATION_CONNECTION_EXISTS','The retained source differs from the selected source.');}
  await readPropertyConnection(file);
  return {value,raw:original.raw,bytes:original.bytes,sha256:original.sha256};
}
export async function verifyPropertyApplicationAnnouncement(file,expected) {
  const saved=await readPropertyConnection(file);
  need(same(saved,expected)&&saved.schema===PROPERTY_STARTUP_SCHEMA&&UUID.test(saved.instanceId??''),
    'PROPERTY_APPLICATION_STARTUP_CHANGED');
  const {binding}=await inspectPropertyApplicationBinding({directory:saved.directory,sourceRoot:saved.sourceRoot,
    connectionFile:file,propertyHostFile:saved.host?.path??null,expectedCreatedAt:saved.createdAt});
  need(binding.bindingSha256===saved.bindingSha256&&same(binding.source,saved.source)&&same(binding.node,saved.node),
    'PROPERTY_APPLICATION_STARTUP_CHANGED');
  const client=createPropertyOperationsClient({url:saved.url,expectedCreatedAt:saved.createdAt,timeoutMs:30000});
  try {const native=await client.status();return {announcement:saved,binding,native};}
  finally{await client.close();}
}
