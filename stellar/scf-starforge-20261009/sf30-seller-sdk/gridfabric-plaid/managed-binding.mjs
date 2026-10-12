// MIT. Source-owned binding for the original GridFabric workspace and Applications lifecycle.
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {readDistributionSpecification} from '../../distribution/specification.mjs';
import {openGridFabricSnapshot} from './sqlite-store.mjs';
import {sourceIdentity} from './server.mjs';
import {connectGridFabricOperator} from './sdk/http-client.mjs';

export const GRIDFABRIC_BINDING_SCHEMA='stellar-forge.gridfabric-application-binding.v1';
export const GRIDFABRIC_STARTUP_SCHEMA='stellar-forge.gridfabric-application-startup.v1';
export const GRIDFABRIC_SOURCE_PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/';
export const GRIDFABRIC_MANAGED_OPERATION='GRIDFABRIC-MANAGED-APPLICATION-RECEIVING-20261012-1FB3';
export const GRIDFABRIC_HASH=/^[a-f0-9]{64}$/;
export const GRIDFABRIC_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COMMIT=/^[a-f0-9]{40}$/,plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const gridFabricCanonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(gridFabricCanonical(value[key]))]))
  :Array.isArray(value)?value.map(item=>JSON.parse(gridFabricCanonical(item))):value);
export const gridFabricSame=(a,b)=>gridFabricCanonical(a)===gridFabricCanonical(b);
export const gridFabricHash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array
  ?value:gridFabricCanonical(value)).digest('hex');
export function gridFabricNeed(value,code,message=code,details={}) {
  if(!value)throw Object.assign(new Error(message),{code,status:409,details});
}
const need=gridFabricNeed;
export function gridFabricAbsolute(value,label='Original path') {
  need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)&&
    value===resolve(value),'GRIDFABRIC_APPLICATION_PATH',label+' must be an absolute original path.');
  return value;
}
function relativeFile(value) {
  need(typeof value==='string'&&value.length>0&&value.length<=1000&&!value.startsWith('/')&&
    !/[\\\x00-\x1f\x7f]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..'),
    'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION');
  return value;
}
export async function gridFabricPrivateDirectory(path) {
  gridFabricAbsolute(path);const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(stat.mode&0o077)===0&&(!process.getuid||stat.uid===process.getuid())),
    'GRIDFABRIC_APPLICATION_PRIVATE_DIRECTORY','Choose an existing private original workspace or connection directory.');
  return path;
}
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
/** Bounded verification; bytes are collected only for explicitly small original metadata. */
export async function gridFabricOriginalFile(path,maximum=512*1024*1024,{privateOnly=false,bytes=false}={}) {
  gridFabricAbsolute(path);
  const before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink()&&await realpath(path)===path&&
    Number.isSafeInteger(before.size)&&before.size>=0&&before.size<=maximum,
    'GRIDFABRIC_APPLICATION_FILE','Keep the original regular file and its complete declared length.');
  if(privateOnly)need(process.platform==='win32'||(before.mode&0o077)===0&&(!process.getuid||before.uid===process.getuid()),
    'GRIDFABRIC_APPLICATION_PRIVATE_FILE','Keep original connection and ready files private.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    need(signature(await handle.stat())===signature(before),'GRIDFABRIC_APPLICATION_FILE_CHANGED');
    const hash=createHash('sha256'),block=Buffer.alloc(256*1024),parts=[];let count=0;
    for(;;){const length=(await handle.read(block,0,block.length,null)).bytesRead;if(!length)break;
      count+=length;need(count<=maximum,'GRIDFABRIC_APPLICATION_FILE_CHANGED');
      hash.update(block.subarray(0,length));if(bytes)parts.push(Buffer.from(block.subarray(0,length)));}
    need(count===before.size&&signature(await handle.stat())===signature(before)&&
      signature(await lstat(path))===signature(before)&&await realpath(path)===path,'GRIDFABRIC_APPLICATION_FILE_CHANGED');
    return {bytes:count,sha256:hash.digest('hex'),...(bytes?{raw:Buffer.concat(parts,count)}:{})};
  }finally{await handle.close();}
}
const decoded=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
async function originalInput(inputPath,path,identity,privateOnly=false) {
  if(!inputPath)return null;
  const observed=await inputPath(path,'file',false,privateOnly);
  need(observed.bytes===identity.bytes&&(!observed.sha256||observed.sha256===identity.sha256),
    'GRIDFABRIC_APPLICATION_SOURCE_CHANGED');
  return {...observed,sha256:identity.sha256};
}
function sourcePathFromNative(path) {
  const absolute=resolve('/',GRIDFABRIC_SOURCE_PREFIX,path),value=relative('/',absolute).split(sep).join('/');
  return relativeFile(value);
}
/** Use the maintained complete merchant manifest in both installed and adopted source roots. */
export async function readGridFabricApplicationSource(sourceRoot,inputPath=null) {
  sourceRoot=await realpath(gridFabricAbsolute(sourceRoot,'Selected source root'));
  const manifestPath=join(dirname(sourceRoot),'manifest.json');
  const original=await gridFabricOriginalFile(manifestPath,8*1024*1024,{bytes:true}),manifest=decoded(original.raw);
  need(plain(manifest)&&manifest.schema==='stellar-forge.merchant-distribution-manifest.v1'&&
    manifest.packageName==='@tokenjunkielabs/starforge-merchant'&&COMMIT.test(manifest.sourceCommit??'')&&
    Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=20000&&
    Number.isSafeInteger(manifest.sourceBytes)&&manifest.sourceBytes>=0&&manifest.sourceBytes<=512*1024*1024,
    'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION','Select the complete maintained merchant package and its original manifest.');
  const inputs=[],files=[],seen=new Map();let total=0;
  const manifestInput=await originalInput(inputPath,manifestPath,original);if(manifestInput)inputs.push(manifestInput);
  for(const expected of [...manifest.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)) {
    const path=relativeFile(expected.path);
    need(!seen.has(path)&&expected.packagePath==='source/'+path&&GRIDFABRIC_HASH.test(expected.sha256??'')&&
      Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&expected.bytes<=512*1024*1024,
      'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION');
    total+=expected.bytes;need(total<=512*1024*1024,'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION');
    const actual=await gridFabricOriginalFile(join(sourceRoot,path),expected.bytes);
    need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'GRIDFABRIC_APPLICATION_SOURCE_CHANGED',
      'The complete selected source differs: '+path);
    const member={path,...actual};files.push(member);seen.set(path,member);
    const input=await originalInput(inputPath,join(sourceRoot,path),actual);if(input)inputs.push(input);
  }
  need(total===manifest.sourceBytes,'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION');
  const native=sourceIdentity();
  need(native.schema==='stellar-forge.gridfabric-native-source.v1'&&Array.isArray(native.modules)&&
    native.sha256===gridFabricHash(JSON.stringify(native.modules)),'GRIDFABRIC_APPLICATION_NATIVE_SOURCE');
  for(const member of native.modules) {
    const retained=seen.get(sourcePathFromNative(member.path));
    need(retained&&retained.bytes===member.bytes&&retained.sha256===member.sha256,
      'GRIDFABRIC_APPLICATION_NATIVE_SOURCE','The executing native module differs from the selected full source.',{path:member.path});
  }
  for(const path of ['managed-launch.mjs','managed-binding.mjs','application-provider.mjs',
    'sdk/contract.mjs','sdk/client.mjs','sdk/http-client.mjs','sdk/download.mjs','sdk/receiving.mjs',
    'mcp/provider.mjs','mcp/workspace.mjs','mcp/setup.mjs','mcp/catalog.mjs'])
    need(seen.has(GRIDFABRIC_SOURCE_PREFIX+path),'GRIDFABRIC_APPLICATION_SOURCE_INCOMPLETE',
      'The selected source omits '+GRIDFABRIC_SOURCE_PREFIX+path);
  const {spec,manifest:declared}=await readDistributionSpecification({sourceRoot});
  need(declared&&gridFabricSame(declared,manifest)&&
    spec.commands?.['gridfabric-application']===GRIDFABRIC_SOURCE_PREFIX+'managed-launch.mjs'&&
    spec.commands?.['gridfabric-plaid']===GRIDFABRIC_SOURCE_PREFIX+'cli.mjs'&&
    spec.applicationProviders?.['gridfabric-plaid']===GRIDFABRIC_SOURCE_PREFIX+'application-provider.mjs',
    'GRIDFABRIC_APPLICATION_SOURCE_DECLARATION','Use the original GridFabric contribution with both native and managed commands.');
  need(gridFabricSame(await gridFabricOriginalFile(manifestPath,8*1024*1024),
    {bytes:original.bytes,sha256:original.sha256}),'GRIDFABRIC_APPLICATION_SOURCE_CHANGED');
  return {sourceRoot,inputs,files,native,source:{schema:'stellar-forge.gridfabric-application-source.v1',
    manifestSha256:original.sha256,manifestBytes:original.bytes,sourceCommit:manifest.sourceCommit,
    sourceFiles:files.length,sourceBytes:total,nativeSourceSha256:native.sha256}};
}
/** Read original SQLite metadata through its existing read-only snapshot API. This acquires no writer lease. */
export async function readGridFabricWorkspaceIdentity(directory) {
  await gridFabricPrivateDirectory(directory);
  let marker;try{marker=await lstat(join(directory,'.gridfabric-restore.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  need(!marker,'GRIDFABRIC_RESTORE_IN_PROGRESS','Finish the original restore before managing this workspace.');
  const snapshot=openGridFabricSnapshot(join(directory,'gridfabric.sqlite'));let original=null;
  try {for(const row of snapshot.records())if(row.table==='meta'&&row.id==='workspace'){original=row.data;break;}}
  finally{snapshot.close();}
  need(plain(original)&&original.schema==='stellar-forge.gridfabric-plaid.workspace.v1'&&
    GRIDFABRIC_UUID.test(original.workspace_id??'')&&typeof original.created_at==='string'&&
    Number.isFinite(Date.parse(original.created_at))&&Number.isSafeInteger(original.revision)&&original.revision>=0,
    'GRIDFABRIC_APPLICATION_WORKSPACE','Select the existing initialized or completely restored native workspace.');
  return {workspaceId:original.workspace_id,workspaceCreatedAt:original.created_at,
    revision:original.revision,name:original.name??null};
}
export function requireGridFabricNode() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  need(major>22||major===22&&minor>=16,'GRIDFABRIC_APPLICATION_NODE_REQUIRED',
    'Use Node 22.16 or later with the original node:sqlite and Linux flock runtime.');
}
export async function inspectGridFabricApplicationBinding({directory,sourceRoot,connectionFile,readyFile,
  expectedWorkspaceId=null,inputPath=null}={}) {
  requireGridFabricNode();
  directory=await gridFabricPrivateDirectory(directory);
  sourceRoot=await realpath(gridFabricAbsolute(sourceRoot));
  connectionFile=gridFabricAbsolute(connectionFile??join(directory,'gridfabric-connection.txt'));
  readyFile=gridFabricAbsolute(readyFile??join(dirname(connectionFile),'gridfabric-application-ready.json'));
  await gridFabricPrivateDirectory(dirname(connectionFile));await gridFabricPrivateDirectory(dirname(readyFile));
  need(connectionFile!==readyFile&&!['gridfabric.sqlite','gridfabric.sqlite-wal','gridfabric.sqlite-shm','.gridfabric-restore.json']
    .some(name=>connectionFile===join(directory,name)||readyFile===join(directory,name)),
    'GRIDFABRIC_APPLICATION_CONNECTION_PATH');
  for(const path of [connectionFile,readyFile]) {
    const part=relative(sourceRoot,path);
    need(part==='..'||part.startsWith('..'+sep)||part.startsWith(sep),
      'GRIDFABRIC_APPLICATION_CONNECTION_PATH','Keep operational files outside selected application source.');
  }
  const source=await readGridFabricApplicationSource(sourceRoot,inputPath),observed=await readGridFabricWorkspaceIdentity(directory);
  need(expectedWorkspaceId===null||expectedWorkspaceId===observed.workspaceId,'GRIDFABRIC_APPLICATION_WORKSPACE_CHANGED');
  const node={executable:await realpath(process.execPath),version:process.versions.node};
  const identity={schema:GRIDFABRIC_BINDING_SCHEMA,directory,workspaceId:observed.workspaceId,
    workspaceCreatedAt:observed.workspaceCreatedAt,connectionFile,readyFile,source:source.source,node};
  const inputs=[...source.inputs];
  if(inputPath)inputs.push(await inputPath(directory,'directory',false,true));
  return {binding:{...identity,bindingSha256:gridFabricHash(identity)},sourceRoot,inputs,observed};
}
export function validateGridFabricAnnouncement(value,binding=null) {
  need(plain(value)&&value.schema===GRIDFABRIC_STARTUP_SCHEMA&&['PUBLISHING','READY'].includes(value.status)&&
    GRIDFABRIC_UUID.test(value.instanceId??'')&&GRIDFABRIC_UUID.test(value.applicationRequestId??'')&&
    GRIDFABRIC_UUID.test(value.workspaceId??'')&&typeof value.workspaceCreatedAt==='string'&&
    Number.isFinite(Date.parse(value.workspaceCreatedAt))&&GRIDFABRIC_HASH.test(value.bindingSha256??'')&&
    Number.isSafeInteger(value.pid)&&value.pid>0&&plain(value.source)&&plain(value.node)&&
    GRIDFABRIC_HASH.test(value.connection?.sha256??'')&&Number.isSafeInteger(value.connection?.bytes)&&
    value.connection.bytes>0&&value.connection.bytes<=16384,'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  for(const field of ['directory','sourceRoot','connectionFile','readyFile'])gridFabricAbsolute(value[field]);
  let url;try{url=new URL(value.url);}catch{need(false,'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&Number(url.port)<=65535&&
    url.pathname==='/'&&!url.search&&!url.username&&!url.password&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash),
    'GRIDFABRIC_APPLICATION_STARTUP_CHANGED','Retain the original private loopback URL and fragment token.');
  const raw=Buffer.from(value.url+'\n');
  need(raw.length===value.connection.bytes&&gridFabricHash(raw)===value.connection.sha256,
    'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  const identity={schema:GRIDFABRIC_BINDING_SCHEMA,directory:value.directory,workspaceId:value.workspaceId,
    workspaceCreatedAt:value.workspaceCreatedAt,connectionFile:value.connectionFile,readyFile:value.readyFile,
    source:value.source,node:value.node};
  need(gridFabricHash(identity)===value.bindingSha256,'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  if(binding)need(gridFabricSame(identity,Object.fromEntries(Object.entries(binding).filter(([key])=>key!=='bindingSha256'))),
    'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  return value;
}
/** A matching PUBLISHING or READY record binds its exact plaintext file; arbitrary existing files are rejected. */
export async function inspectRetainedGridFabricStartup(binding,{missing=true}={}) {
  let ready=null,connection=null;
  try{ready=await gridFabricOriginalFile(binding.readyFile,32768,{privateOnly:true,bytes:true});}
  catch(error){if(error.code!=='ENOENT'||!missing)throw error;}
  try{connection=await gridFabricOriginalFile(binding.connectionFile,16384,{privateOnly:true,bytes:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!ready){need(!connection,'GRIDFABRIC_APPLICATION_CONNECTION_EXISTS',
    'This existing plaintext connection has no matching managed record. Select a new private managed connection path.');return null;}
  const value=validateGridFabricAnnouncement(decoded(ready.raw),binding);
  if(connection)need(connection.bytes===value.connection.bytes&&connection.sha256===value.connection.sha256&&
    connection.raw.equals(Buffer.from(value.url+'\n')),'GRIDFABRIC_APPLICATION_CONNECTION_CHANGED');
  return {value,ready,connection};
}
export async function verifyGridFabricApplicationAnnouncement(readyFile,expected) {
  gridFabricAbsolute(readyFile);
  const original=await gridFabricOriginalFile(readyFile,32768,{privateOnly:true,bytes:true}),value=decoded(original.raw);
  need(gridFabricSame(value,expected)&&value.status==='READY'&&value.readyFile===readyFile,'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  validateGridFabricAnnouncement(value);
  const {binding}=await inspectGridFabricApplicationBinding({directory:value.directory,sourceRoot:value.sourceRoot,
    connectionFile:value.connectionFile,readyFile,expectedWorkspaceId:value.workspaceId});
  need(binding.bindingSha256===value.bindingSha256,'GRIDFABRIC_APPLICATION_BINDING_CHANGED');
  const retained=await inspectRetainedGridFabricStartup(binding,{missing:false});
  need(retained.connection&&gridFabricSame(retained.value,value),'GRIDFABRIC_APPLICATION_CONNECTION_CHANGED');
  const client=await connectGridFabricOperator({connectionFile:binding.connectionFile,expectedWorkspaceId:binding.workspaceId,
    expectedWorkspace:binding.directory,expectedSourceSha256:binding.source.nativeSourceSha256,timeoutMs:30000});
  try {return {announcement:value,binding,native:client.identity,state:await client.state()};}
  finally{await client.close();}
}
