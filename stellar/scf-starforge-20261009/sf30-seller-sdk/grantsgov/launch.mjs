// MIT. Managed identity and lifecycle for the original Grants.gov research workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, privateDirectory, readPrivate, object, digest, identity, fault } from '../postgres/publisher/files.mjs';

export const GRANTS_STARTUP_SCHEMA = 'stellar-forge.grantsgov-workspace-startup.v1';
export const GRANTS_LAUNCH_FILES = Object.freeze([
  'launch.mjs','workspace.mjs','server.mjs','cli.mjs','source.mjs','transport.mjs',
  'capture.mjs','capture-storage.mjs','acquire.mjs','app.mjs','index.html','app.css','browser-assets.json',
]);
const SCHEMA = 'stellar-forge.grantsgov-workspace.v1';
const HASH = /^[a-f0-9]{64}$/;
const WORKSPACE_ID = /^GW-[a-f0-9-]{36}$/;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const changed = () => fault('GRANTS_MANAGED_INPUT_CHANGED',
  'Review the current Grants.gov workspace, buyer bindings and installed source before starting.',409);
const inode = value => ({dev:String(value.dev),ino:String(value.ino)});
const sameInode = (a,b) => a.dev===b.dev && a.ino===b.ino;
function expected(value) {
  if(value!==undefined&&!HASH.test(value))throw fault('GRANTS_MANAGED_HASH_REQUIRED');
}

/** Workspace JSON is atomically replaced as work advances. Bind the immutable
 * workspace ID, creation time and original private directory inode, not its
 * mutable revisions, captured pages or qualification records. */
export async function inspectGrantsWorkspace(directory,{expectedIdentity}={}) {
  absolute(directory);expected(expectedIdentity);await privateDirectory(directory);
  const before=await lstat(directory,{bigint:true});
  if(await realpath(directory)!==directory)throw fault('GRANTS_ORIGINAL_DIRECTORY_REQUIRED');
  const bytes=await readPrivate(join(directory,'workspace.json'),32*1024*1024);
  let saved;try{saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fault('GRANTS_WORKSPACE_FORMAT_INVALID');}
  const after=await lstat(directory,{bigint:true});
  if(!sameInode(before,after))throw changed();
  if(!object(saved)||saved.schema!==SCHEMA||!WORKSPACE_ID.test(saved.id??'')||
    !Number.isFinite(Date.parse(saved.createdAt))||
    ['queries','captures','editions','reviews','exports','merchants','requests'].some(key=>!object(saved[key])))
    throw fault('GRANTS_WORKSPACE_FORMAT_INVALID','Initialize or reopen the original Grants.gov workspace.');
  const value={schema:'stellar-forge.grantsgov-workspace-identity.v1',directory,
    directoryIdentity:inode(after),workspaceId:saved.id,createdAt:saved.createdAt};
  const sha256=identity(value);
  if(expectedIdentity!==undefined&&sha256!==expectedIdentity)throw changed();
  return {...value,sha256};
}

/** Reads host-selected directory references. Payer keys and policy stay in the
 * original SF88 workspace and are never loaded during application review. */
export async function readGrantsLaunchBuyers(file,{expectedSha256}={}) {
  expected(expectedSha256);
  if(file===undefined||file===null){
    if(expectedSha256!==undefined)throw fault('GRANTS_BUYER_BINDINGS_REQUIRED');
    return {file:null,sha256:null,buyerWorkspaces:[]};
  }
  absolute(file,'buyer bindings file');
  if(await realpath(file)!==file)throw fault('GRANTS_BUYER_BINDINGS_PATH_CHANGED');
  const bytes=await readPrivate(file,1024*1024),sha256=digest(bytes);
  if(expectedSha256!==undefined&&expectedSha256!==sha256)throw changed();
  let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fault('GRANTS_BUYER_BINDINGS_INVALID');}
  if(!Array.isArray(parsed)||parsed.length>32)throw fault('GRANTS_BUYER_BINDINGS_INVALID');
  const ids=new Set(),directories=new Set(),buyerWorkspaces=[];
  for(const binding of parsed){
    if(!object(binding)||Object.keys(binding).some(key=>!['id','directory'].includes(key))||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(binding.id??'')||ids.has(binding.id))
      throw fault('GRANTS_BUYER_BINDINGS_INVALID');
    const directory=absolute(binding.directory,'original buyer workspace');
    await privateDirectory(directory);
    if(await realpath(directory)!==directory||directories.has(directory))
      throw fault('GRANTS_BUYER_BINDINGS_INVALID');
    ids.add(binding.id);directories.add(directory);buyerWorkspaces.push({id:binding.id,directory});
  }
  return {file,sha256,buyerWorkspaces};
}
async function sourceFile(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size>2*1024*1024)throw fault('GRANTS_MANAGED_SOURCE_INVALID');
    const bytes=await handle.readFile(),after=await handle.stat();
    if(bytes.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||
      before.ctimeMs!==after.ctimeMs)throw changed();
    return {bytes:bytes.length,sha256:digest(bytes)};
  }finally{await handle.close();}
}
export async function inspectGrantsLaunchSource(directory,{expectedSha256}={}){
  absolute(directory,'Grants.gov source directory');expected(expectedSha256);
  if(await realpath(directory)!==directory||!(await lstat(directory)).isDirectory())
    throw fault('GRANTS_MANAGED_SOURCE_INVALID');
  const files=[];for(const name of GRANTS_LAUNCH_FILES)files.push({name,...await sourceFile(join(directory,name))});
  const value={schema:'stellar-forge.grantsgov-launch-source.v1',files},sha256=identity(value);
  if(expectedSha256!==undefined&&sha256!==expectedSha256)throw changed();
  return {...value,directory,sha256};
}
export async function prepareGrantsManagedLaunch({directory,sourceDirectory,
  expectedSourceSha256,expectedWorkspaceIdentity,buyersFile,expectedBuyersSha256}={}){
  absolute(directory);absolute(sourceDirectory);
  if(!HASH.test(expectedSourceSha256??'')||!HASH.test(expectedWorkspaceIdentity??'')||
    Boolean(buyersFile)!==Boolean(expectedBuyersSha256))throw fault('GRANTS_MANAGED_REVIEW_REQUIRED');
  const source=await inspectGrantsLaunchSource(sourceDirectory,{expectedSha256:expectedSourceSha256});
  const executed=await inspectGrantsLaunchSource(SOURCE_DIRECTORY,{expectedSha256:expectedSourceSha256});
  const workspace=await inspectGrantsWorkspace(directory,{expectedIdentity:expectedWorkspaceIdentity});
  const buyers=await readGrantsLaunchBuyers(buyersFile,{expectedSha256:expectedBuyersSha256});
  return {directory,expectedWorkspaceIdentity,source,executed,workspace,buyers};
}
export async function grantsManagedStartup({launch,workspace,service}={}){
  if(!launch||!workspace||!service||launch.directory!==workspace.directory)
    throw fault('GRANTS_MANAGED_REVIEW_REQUIRED');
  const current=await inspectGrantsWorkspace(workspace.directory,{expectedIdentity:launch.expectedWorkspaceIdentity});
  const native=await workspace.snapshot();
  if(native.id!==current.workspaceId||native.createdAt!==current.createdAt)throw changed();
  await inspectGrantsLaunchSource(launch.source.directory,{expectedSha256:launch.source.sha256});
  await inspectGrantsLaunchSource(launch.executed.directory,{expectedSha256:launch.source.sha256});
  await readGrantsLaunchBuyers(launch.buyers.file,{
    expectedSha256:launch.buyers.sha256??undefined});
  return {schema:GRANTS_STARTUP_SCHEMA,status:'GRANTS_WORKSPACE_READY',
    instanceId:service.instanceId,pid:process.pid,directory:workspace.directory,
    workspaceId:current.workspaceId,workspaceIdentity:current.sha256,
    sourceDirectory:launch.source.directory,launchSourceDirectory:launch.executed.directory,
    sourceSha256:launch.source.sha256,sourceFiles:launch.source.files,
    buyersFile:launch.buyers.file,buyersSha256:launch.buyers.sha256,
    buyerWorkspaces:launch.buyers.buyerWorkspaces.map(({id})=>id),
    grantsWorkspace:service.url};
}
