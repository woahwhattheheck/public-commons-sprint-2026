// MIT. Reuse the original buyer's private, durable file primitives.
import {realpath,lstat,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {native} from './runtime.mjs';
const original=await native('sf88-operator-buyer-cli/node/store.mjs');
export const {need,digest,now,object,jsonBytes,parseJson,readBytes,readJson,writeBytes,writeJson}=original;
export function canonical(path){
  original.need(typeof path==='string'&&resolve(path)===path,'CANONICAL_PATH_REQUIRED');
  return path;
}
export async function privateDirectory(path,{create=true}={}){
  canonical(path);
  await original.privateDirectory(path,{create});
  original.need(await realpath(path)===path,'CANONICAL_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function privateJson(path,limit=65536){
  canonical(path);
  original.need(await realpath(path)===path,'CANONICAL_PRIVATE_FILE_REQUIRED');
  const info=await lstat(path);
  original.need(info.isFile()&&!info.isSymbolicLink()&&(process.platform==='win32'||(info.mode&0o077)===0),'PRIVATE_FILE_REQUIRED');
  return original.readJson(path,limit);
}
export async function publish(path,bytes){
  canonical(path);await privateDirectory(dirname(path),{create:false});
  original.need(Buffer.isBuffer(bytes),'FILE_BYTES_REQUIRED');
  await original.writeBytes(path,bytes,{exclusive:true});
  return {path,bytes:bytes.length,sha256:original.digest(bytes)};
}
