// MIT. Exact local files for the original Huwise facilitator receiving operation.
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, link, unlink, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const failure = (code, message) => Object.assign(new Error(message), {code});
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const stable = (a,b) => ['dev','ino','size','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
export async function privateDirectory(input, create = true) {
  const path = resolve(input);
  if (create) await mkdir(path, {recursive:true, mode:0o700});
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path ||
      process.platform !== 'win32' && ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
    throw failure('HUWISE_RECEIVING_DIRECTORY','Use an owned canonical private receiving directory.');
  return path;
}
async function directorySync(path) {
  const handle = await open(path,'r');
  try {await handle.sync();} finally {await handle.close();}
}
async function originalHandle(path, maximum) {
  const handle = await open(path,flags);
  try {
    const stat = await handle.stat({bigint:true});
    if (!stat.isFile() || stat.size > BigInt(maximum))
      throw failure('HUWISE_RECEIVING_FILE','Use a complete regular file within its declared size.');
    return {handle,stat};
  } catch (error) {await handle.close();throw error;}
}
export async function originalBytes(path, maximum = 16777216) {
  const {handle,stat} = await originalHandle(path,maximum);
  try {
    const bytes = await handle.readFile(), after = await handle.stat({bigint:true});
    if (!stable(stat,after) || BigInt(bytes.length) !== stat.size)
      throw failure('HUWISE_RECEIVING_FILE_CHANGED','The original file changed while it was read.');
    return bytes;
  } finally {await handle.close();}
}
export async function originalJSON(path, maximum = 16777216) {
  const bytes = await originalBytes(path,maximum);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function optionalJSON(path) {
  try {return await originalJSON(path);} catch (error) {if(error.code !== 'ENOENT')throw error;return null;}
}
export async function fileInfo(path, maximum = 2147483648) {
  const {handle,stat} = await originalHandle(path,maximum), hash=createHash('sha256');
  let count=0;
  try {
    for await (const chunk of handle.createReadStream({autoClose:false})) {hash.update(chunk);count+=chunk.length;}
    if (!stable(stat,await handle.stat({bigint:true})) || BigInt(count) !== stat.size)
      throw failure('HUWISE_RECEIVING_FILE_CHANGED','The original file changed during verification.');
    return {bytes:count,sha256:hash.digest('hex')};
  } finally {await handle.close();}
}
export async function atomicJSON(path,value) {
  const parent=dirname(path), temporary=join(parent,'.huwise-receiving-'+randomUUID());
  try {
    const handle=await open(temporary,'wx',0o600);
    try {await handle.writeFile(encoded(value));await handle.sync();} finally {await handle.close();}
    await rename(temporary,path);await directorySync(parent);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function keepBytes(path,bytes) {
  if(!Buffer.isBuffer(bytes))throw failure('HUWISE_RECEIVING_BYTES','Retain the full original byte buffer.');
  const parent=dirname(path), temporary=join(parent,'.huwise-receiving-'+randomUUID());
  const expected={bytes:bytes.length,sha256:digest(bytes)};
  try {
    const handle=await open(temporary,'wx',0o600);
    try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
    try {await link(temporary,path);}
    catch(error){if(error.code!=='EEXIST')throw error;if(!equal(await fileInfo(path,bytes.length),expected))throw failure('HUWISE_RECEIVING_OUTPUT_CHANGED','A retained receiving filename has different original bytes.');}
    await directorySync(parent);return expected;
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export const keepJSON = (path,value) => keepBytes(path,encoded(value));
export async function keepFile(source,destination,expected) {
  const parent=dirname(destination),temporary=join(parent,'.huwise-receiving-'+randomUUID());
  const {handle:input,stat}=await originalHandle(source,expected?.bytes ?? 2147483648);
  let output;
  const hash=createHash('sha256');let bytes=0;
  try {
    output=await open(temporary,'wx',0o600);
    for await(const chunk of input.createReadStream({autoClose:false})){
      hash.update(chunk);bytes+=chunk.length;
      let offset=0;while(offset<chunk.length){const written=await output.write(chunk,offset,chunk.length-offset);if(written.bytesWritten<1)throw failure('HUWISE_RECEIVING_WRITE','The original file copy stopped before completion.');offset+=written.bytesWritten;}
    }
    if(!stable(stat,await input.stat({bigint:true}))||BigInt(bytes)!==stat.size)throw failure('HUWISE_RECEIVING_FILE_CHANGED','The source file changed during receiving.');
    const value={bytes,sha256:hash.digest('hex')};
    if(expected&&!equal(value,{bytes:expected.bytes,sha256:expected.sha256}))throw failure('HUWISE_RECEIVING_HASH','The complete file differs from its retained size or SHA256.');
    await output.sync();await output.close();output=null;
    try{await link(temporary,destination);}
    catch(error){if(error.code!=='EEXIST')throw error;if(!equal(await fileInfo(destination,bytes),value))throw failure('HUWISE_RECEIVING_OUTPUT_CHANGED','The original received file differs from the selected output.');}
    await directorySync(parent);return value;
  } finally {
    try {await output?.close();} finally {await input.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
