import {open,mkdir,realpath,lstat,link,unlink,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,sep} from 'node:path';

export const MiB=1024*1024;
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function fail(message,code='HDF5_INPUT',status=400){throw Object.assign(new Error(message),{code,status});}
export function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function only(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Unexpected request fields.');}
export function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value))fail('Use an original operation or workspace ID.');return value;}
export function hash(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('Use a complete SHA-256 identity.');return value;}
export async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
export async function privateDirectory(path,{create=false}={}){
  path=resolve(path);const created=create?await mkdir(path,{mode:0o700,recursive:true}):undefined;
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||typeof process.getuid==='function'&&(info.uid!==process.getuid()||info.mode&0o077))fail('Use a canonical operator-owned private directory.','HDF5_DIRECTORY',409);
  if(create){
    if(created){for(let entry=path;;entry=dirname(entry)){await syncDirectory(dirname(entry));if(entry===resolve(created))break;}}
    else await syncDirectory(dirname(path));
  }
  return path;
}
export async function read(path,limit=16*MiB){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await handle.stat({bigint:true});
    if(!info.isFile()||info.size>BigInt(limit))fail('File exceeds the selected byte limit.');
    const bytes=await handle.readFile();const after=await handle.stat({bigint:true});
    if(bytes.length>limit||!same(info,after))fail('File changed during reading.','HDF5_FILE_CHANGED',409);
    return bytes;
  }finally{await handle.close();}
}
export function same(a,b){return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);}
export async function exact(path,bytes){
  const temporary=path+'.incoming-'+randomUUID();const handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;if(!(await read(path,Math.max(bytes.length,1))).equals(bytes))fail('Existing immutable file belongs to different bytes.','HDF5_FILE_CHANGED',409);}
    await syncDirectory(dirname(path));
  }finally{await unlink(temporary);}
}
export async function verifiedFile(path,expected,limit=512*MiB,{signal}={}){
  signal?.throwIfAborted();
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await handle.stat({bigint:true});
    if(!info.isFile()||info.size>BigInt(limit))fail('Expected a bounded regular file.');
    const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let total=0;
    while(true){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,total);if(!bytesRead)break;total+=bytesRead;if(total>limit)fail('File exceeds its selected limit.');digest.update(buffer.subarray(0,bytesRead));}
    signal?.throwIfAborted();
    const observed={bytes:total,sha256:digest.digest('hex')};
    if(!same(info,await handle.stat({bigint:true}))||expected&&(expected.bytes!==total||expected.sha256!==observed.sha256))fail('Retained file differs from its selected identity.','HDF5_FILE_CHANGED',409);
    return {handle,info,...observed};
  }catch(error){await handle.close();throw error;}
}
export async function copyExact(source,target,expected){
  const input=await verifiedFile(source,expected);const temporary=target+'.incoming-'+randomUUID();let output;
  try{
    output=await open(temporary,'wx',0o600);const buffer=Buffer.alloc(MiB);let offset=0;
    while(offset<input.bytes){const {bytesRead}=await input.handle.read(buffer,0,Math.min(buffer.length,input.bytes-offset),offset);if(!bytesRead)fail('Source ended during copy.');await output.writeFile(buffer.subarray(0,bytesRead));offset+=bytesRead;}
    if(!same(input.info,await input.handle.stat({bigint:true})))fail('Source changed during copy.');
    await output.sync();await output.close();output=null;
    try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;const prior=await verifiedFile(target,input);await prior.handle.close();}
    await syncDirectory(dirname(target));return {bytes:input.bytes,sha256:input.sha256};
  }finally{await output?.close();await input.handle.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function selectedPath(path,roots){
  path=resolve(path);const canonical=await realpath(path);
  if(path!==canonical||!roots.some(root=>path===root||path.startsWith(root+sep)))fail('Choose a file from a host-configured input directory.','HDF5_INPUT_SCOPE',403);
  return path;
}
