// MIT. Storage location for an original SF88 dataset; request identities stay unchanged.
import {AsyncLocalStorage} from 'node:async_hooks';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import * as original from './node/store.mjs';

export const DATASET_LOCATION_FILE='.sf88-location.json';
const scope=new AsyncLocalStorage();
const HASH=/^[a-f0-9]{64}$/;
const schema='stellar-forge.sf88.dataset-location.v1';
const need=original.need;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const exact=path=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0');
const inside=(root,path)=>path===root||path.startsWith(root+sep);

/** Only this original session's files are relocated. Ledger, policy, workspace,
 * approval channel, wallet and external request capabilities keep their paths. */
export function datasetStoragePath(path) {
  const selected=scope.getStore();
  if(!selected||typeof path!=='string'||!inside(selected.sourceDirectory,path))return path;
  return join(selected.directory,relative(selected.sourceDirectory,path));
}
export function datasetSourcePath(path) {
  const selected=scope.getStore();
  if(!selected||typeof path!=='string'||!inside(selected.directory,path))return path;
  return join(selected.sourceDirectory,relative(selected.directory,path));
}
export function datasetLocation() {
  const value=scope.getStore();
  return value?{...value}:null;
}
async function privateRoot(path) {
  need(exact(path),'DATASET_ABSOLUTE_SESSION_REQUIRED');
  const info=await fs.lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await fs.realpath(path)===path&&
    (process.platform==='win32'||(info.mode&0o077)===0&&
      (!process.getuid||info.uid===process.getuid())),'DATASET_PRIVATE_DIRECTORY_REQUIRED');
}
async function rawFile(path,limit,optional=false) {
  let handle;
  try{handle=await fs.open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{
    const info=await handle.stat();
    need(info.isFile()&&info.nlink===1&&info.size<=limit&&
      (process.platform==='win32'||(info.mode&0o077)===0&&
        (!process.getuid||info.uid===process.getuid())),'DATASET_PRIVATE_FILE_REQUIRED');
    const raw=await handle.readFile();
    need(raw.length<=limit,'DATASET_FILE_LIMIT_EXCEEDED');
    return raw;
  }finally{await handle.close();}
}
async function select(directory) {
  await privateRoot(directory);
  const raw=await rawFile(join(directory,DATASET_LOCATION_FILE),16384,true);
  if(raw===null)return {directory,sourceDirectory:directory,relocated:false};
  const value=original.parseJson(raw);
  need(value?.schema===schema&&exact(value.sourceDirectory)&&
    value.sourceDirectory!==sep&&HASH.test(value.sessionSha256??'')&&HASH.test(value.archiveSha256??'')&&
    HASH.test(value.manifestSha256??'')&&HASH.test(value.configurationSha256??'')&&
    typeof value.operation==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.operation),
    'DATASET_LOCATION_INVALID');
  need(directory===value.sourceDirectory||
    !inside(directory,value.sourceDirectory)&&!inside(value.sourceDirectory,directory),
    'DATASET_LOCATION_ROOTS_OVERLAP');
  const session=await rawFile(join(directory,'session.json'),262144);
  const definition=original.parseJson(session);
  need(hash(session)===value.sessionSha256&&definition.directory===value.sourceDirectory&&
    definition.configurationSha256===value.configurationSha256,'DATASET_LOCATION_SESSION_CHANGED');
  const manifest=await rawFile(join(directory,'.sf88-portable-history',value.archiveSha256+'.json'),
    32*1024*1024);
  need(hash(manifest)===value.manifestSha256,'DATASET_LOCATION_MANIFEST_CHANGED');
  const selected=original.parseJson(manifest);
  need(selected.schema==='stellar-forge.sf88.dataset-session-archive.v1'&&
    selected.sourceDirectory===value.sourceDirectory&&
    selected.sessionSha256===value.sessionSha256&&
    selected.configurationSha256===value.configurationSha256,
    'DATASET_LOCATION_MANIFEST_CHANGED');
  return {directory,sourceDirectory:value.sourceDirectory,relocated:directory!==value.sourceDirectory,
    archiveSha256:value.archiveSha256,manifestSha256:value.manifestSha256,
    sessionSha256:value.sessionSha256,configurationSha256:value.configurationSha256,
    operation:value.operation};
}

/** An async-local selection is explicit to this original public call; it does
 * not patch Node's filesystem or change stat/inode observations. Nested readers
 * use the same selection while unrelated operations keep their own directory. */
export async function withDatasetSessionLocation(directory,work) {
  need(typeof work==='function','DATASET_LOCATION_CALLBACK_REQUIRED');
  const current=scope.getStore();
  if(current&&(directory===current.directory||directory===current.sourceDirectory))
    return work(current.sourceDirectory);
  const selected=await select(directory);
  return scope.run(selected,()=>work(selected.sourceDirectory));
}
export function datasetLocatedResult(value) {
  const selected=scope.getStore();
  if(!selected?.relocated||!value||typeof value!=='object'||Array.isArray(value))return value;
  return {...value,storageDirectory:selected.directory,sourceDirectory:selected.sourceDirectory,
    storageLocation:{schema,archiveSha256:selected.archiveSha256,
      operation:selected.operation}};
}
export async function resolveDatasetSessionPath(directory,path) {
  return withDatasetSessionLocation(directory,logical=>{
    need(exact(path)&&inside(logical,path),'DATASET_SESSION_MEMBER_REQUIRED');
    return datasetStoragePath(path);
  });
}

// Explicit filesystem adapters used only by the original dataset modules.
export const open=(path,...args)=>fs.open(datasetStoragePath(path),...args);
export const mkdir=(path,...args)=>fs.mkdir(datasetStoragePath(path),...args);
export const lstat=(path,...args)=>fs.lstat(datasetStoragePath(path),...args);
export const stat=(path,...args)=>fs.stat(datasetStoragePath(path),...args);
export const readdir=(path,...args)=>fs.readdir(datasetStoragePath(path),...args);
export const realpath=(path,...args)=>fs.realpath(datasetStoragePath(path),...args);
export const unlink=(path,...args)=>fs.unlink(datasetStoragePath(path),...args);
export const rename=(from,to,...args)=>fs.rename(datasetStoragePath(from),datasetStoragePath(to),...args);
export const link=(from,to,...args)=>fs.link(datasetStoragePath(from),datasetStoragePath(to),...args);

export async function datasetPrivateStateDirectory(path,options) {
  await original.privateDirectory(datasetStoragePath(path),options);
  return path;
}
export const datasetReadStateBytes=(path,...args)=>original.readBytes(datasetStoragePath(path),...args);
export const datasetReadStateJson=(path,...args)=>original.readJson(datasetStoragePath(path),...args);
export const datasetWriteStateBytes=(path,...args)=>original.writeBytes(datasetStoragePath(path),...args);
export const datasetStateExists=(path,...args)=>original.exists(datasetStoragePath(path),...args);
export const datasetSyncStateDirectory=(path,...args)=>original.syncDirectory(datasetStoragePath(path),...args);
export async function datasetPrepareWriteReservations(entries,options) {
  const pool=await original.prepareWriteReservations(entries.map(entry=>
    ({...entry,path:datasetStoragePath(entry.path)})),options);
  if(!pool)return pool;
  return Object.freeze({...pool,
    write:(path,...args)=>pool.write(datasetStoragePath(path),...args),
    writeBytes:(path,...args)=>pool.writeBytes(datasetStoragePath(path),...args),
    writeJson:(path,...args)=>pool.writeJson(datasetStoragePath(path),...args)});
}
