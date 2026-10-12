import { promises as fs, constants } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sorobanWorkspaceFiles } from '../soroban-events/engine.mjs';

export const files = sorobanWorkspaceFiles;
export const now = () => new Date().toISOString();
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const plain = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  need(value !== undefined && typeof value !== 'bigint', 'INVALID_JSON', 'Use the lossless value codec for native values.');
  return JSON.stringify(value);
}
export const jsonBytes = (value) => Buffer.from(canonical(value) + '\n');
export class StellarIndexerError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'StellarIndexerError'; this.code = code; this.details = details; }
}
export function need(condition, code, message, details = {}) {
  if (!condition) throw new StellarIndexerError(code, message, details);
}
export function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'INVALID_ARGUMENT',
    name + ' must be a whole number in the supported range.', { minimum, maximum }); return value;
}
export function text(value, name, maximum = 300) {
  need(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f]/.test(value), 'INVALID_ARGUMENT', 'Supply ' + name + '.'); return value;
}
export function identifier(value) {
  need(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value),
    'INVALID_ID', 'Select an original workspace object identifier.'); return value;
}
export function selected(map, id, label = 'Object') {
  identifier(id); need(own(map, id), 'NOT_FOUND', label + ' is not retained in this workspace.', { id }); return map[id];
}
export function hash(value, name = 'SHA-256') {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_ARGUMENT', 'Supply the complete ' + name + '.'); return value;
}
export async function privateDirectory(directory) {
  need(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory,
    'INVALID_DIRECTORY', 'Select an absolute private workspace directory.');
  await files.privateDirectory(directory);
  const stat = await fs.stat(directory);
  need((stat.mode & 0o077) === 0, 'DIRECTORY_NOT_PRIVATE', 'The selected workspace must be accessible only to its owner.', { directory });
  return directory;
}
export async function exists(directory, path) {
  try { await fs.stat(await files.filePath(directory, path)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function withLock(directory, name, work) {
  let release;
  const deadline = Date.now() + 5000;
  while (!release) {
    try { release = await files.acquireLock(directory, name); }
    catch (error) {
      if (error.code !== 'WORKSPACE_BUSY' || Date.now() >= deadline) throw error;
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  try { return await work(); } finally { await release(); }
}
export function publicError(error, secrets = []) {
  let message = String(error?.message ?? 'The native operation failed.');
  for (const secret of secrets) if (typeof secret === 'string' && secret) message = message.split(secret).join('[private]');
  return { code: String(error?.code ?? error?.name ?? 'NATIVE_OPERATION_FAILED'), message,
    status: Number.isInteger(error?.status) ? error.status : null, at: now() };
}

/** Every container is tagged; original objects cannot collide with codec tags. */
export function encodeValue(value, ancestors = new Set()) {
  if (value === null) return { t: 'null' };
  if (value === undefined) return { t: 'undefined' };
  if (typeof value === 'string' || typeof value === 'boolean') return { t: typeof value, v: value };
  if (typeof value === 'number') return { t: 'number', v: Number.isNaN(value) ? 'NaN' :
    value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value };
  if (typeof value === 'bigint') return { t: 'bigint', v: value.toString() };
  need(typeof value === 'object' && !ancestors.has(value), 'NATIVE_VALUE_UNSUPPORTED',
    'The native SDK result must be a finite, serializable value tree.');
  const next = new Set(ancestors); next.add(value);
  if (value instanceof Date) return { t: 'date', v: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  if (value instanceof ArrayBuffer) return { t: 'bytes', kind: 'ArrayBuffer', v: Buffer.from(value).toString('base64') };
  if (ArrayBuffer.isView(value)) return { t: 'bytes', kind: Buffer.isBuffer(value) ? 'Buffer' : value.constructor.name,
    v: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (Array.isArray(value)) return { t: 'array', v: Array.from(value, (item) => encodeValue(item, next)) };
  if (value instanceof Map) return { t: 'map', v: [...value].map(([key,item]) => [encodeValue(key,next),encodeValue(item,next)]) };
  if (value instanceof Set) return { t: 'set', v: [...value].map((item) => encodeValue(item,next)) };
  need(plain(value) && Object.getOwnPropertySymbols(value).length === 0, 'NATIVE_VALUE_UNSUPPORTED',
    'The SDK returned an unsupported object type.', { type: value.constructor?.name ?? null });
  return { t: 'object', v: Object.keys(value).map((key) => [key, encodeValue(value[key], next)]) };
}
export function decodeValue(node) {
  need(plain(node) && typeof node.t === 'string', 'INVALID_NATIVE_VALUE', 'Supply an original lossless native value.');
  switch (node.t) {
    case 'null': return null;
    case 'undefined': return undefined;
    case 'string': need(typeof node.v === 'string','INVALID_NATIVE_VALUE','Invalid native string.'); return node.v;
    case 'boolean': need(typeof node.v === 'boolean','INVALID_NATIVE_VALUE','Invalid native boolean.'); return node.v;
    case 'number':
      if (typeof node.v === 'number' && Number.isFinite(node.v)) return node.v;
      need(['NaN','Infinity','-Infinity','-0'].includes(node.v),'INVALID_NATIVE_VALUE','Invalid native number.');
      return node.v === '-0' ? -0 : Number(node.v);
    case 'bigint':
      need(typeof node.v === 'string' && /^-?(0|[1-9][0-9]*)$/.test(node.v),'INVALID_NATIVE_VALUE','Invalid native integer.'); return BigInt(node.v);
    case 'date': {
      const date = node.v === null ? new Date(NaN) : new Date(node.v);
      need(node.v === null || date.toISOString() === node.v,'INVALID_NATIVE_VALUE','Invalid native date.'); return date;
    }
    case 'array': need(Array.isArray(node.v),'INVALID_NATIVE_VALUE','Invalid native array.'); return node.v.map(decodeValue);
    case 'object': {
      need(Array.isArray(node.v),'INVALID_NATIVE_VALUE','Invalid native object.'); const result = {};
      for (const pair of node.v) {
        need(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !own(result,pair[0]),
          'INVALID_NATIVE_VALUE','Invalid native object member.');
        Object.defineProperty(result,pair[0],{value:decodeValue(pair[1]),enumerable:true,writable:true,configurable:true});
      } return result;
    }
    case 'map': return new Map(node.v.map(([key,value]) => [decodeValue(key),decodeValue(value)]));
    case 'set': return new Set(node.v.map(decodeValue));
    case 'bytes': {
      need(typeof node.v === 'string','INVALID_NATIVE_VALUE','Invalid native bytes.');
      const bytes = Buffer.from(node.v,'base64');
      need(bytes.toString('base64') === node.v,'INVALID_NATIVE_VALUE','Native bytes must use canonical base64.');
      if (node.kind === 'Buffer') return bytes;
      const buffer = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      if (node.kind === 'ArrayBuffer') return buffer;
      if (node.kind === 'DataView') return new DataView(buffer);
      const types = {Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,
        Float32Array,Float64Array,BigInt64Array,BigUint64Array};
      need(own(types,node.kind) && bytes.length % types[node.kind].BYTES_PER_ELEMENT === 0,
        'INVALID_NATIVE_VALUE','Native byte view has an invalid type or length.'); return new types[node.kind](buffer);
    }
    default: throw new StellarIndexerError('INVALID_NATIVE_VALUE','Unknown native value encoding.',{type:node.t});
  }
}
export function displayValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value,-0))) return { $number: Object.is(value,-0) ? '-0' : String(value) };
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    return { $bytes: bytes.toString('base64'), encoding:'base64' };
  }
  if (Array.isArray(value)) return value.map(displayValue);
  if (value instanceof Map) return { $map:[...value].map(([key,item])=>[displayValue(key),displayValue(item)]) };
  if (value instanceof Set) return { $set:[...value].map(displayValue) };
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,displayValue(item)]));
  return value;
}
export function connection(alias, input) {
  text(alias,'connection alias',80);
  need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias) && plain(input), 'INVALID_CONNECTION','Supply a named private SDK connection.');
  need(['stellar:pubnet','stellar:testnet'].includes(input.network), 'INVALID_NETWORK','Select Stellar public network or testnet.');
  text(input.consumerToken,'private consumer token',16384);
  const raw = input.apiUrl ?? (input.network === 'stellar:pubnet' ? 'https://api.stellarindexer.com' : 'https://api-testnet.stellarindexer.com');
  const url = new URL(raw);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'INVALID_CONNECTION','Use an HTTPS API base URL without embedded credentials.');
  return { alias, network:input.network, apiUrl:url.href.replace(/\/$/,''), consumerToken:input.consumerToken };
}
export const publicConnection = ({alias,network,apiUrl}) => ({alias,network,apiUrl});
export async function descriptor(directory, relative, contentType = 'application/octet-stream') {
  const path = await files.filePath(directory,relative), handle = await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({bigint:true});
    need(before.isFile() && before.size <= BigInt(Number.MAX_SAFE_INTEGER),'INVALID_SOURCE','Source must be a regular file.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024*1024);
    let offset = 0; const size = Number(before.size);
    while(offset<size) { const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-offset),offset);
      need(bytesRead>0,'SOURCE_CHANGED','Original source ended during capture.');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead; }
    const after=await handle.stat({bigint:true});
    need(before.ino===after.ino && before.size===after.size && before.mtimeNs===after.mtimeNs && before.ctimeNs===after.ctimeNs,
      'SOURCE_CHANGED','Original source changed during capture.');
    return {path:relative,bytes:size,sha256:hash.digest('hex'),contentType,mode:Number(before.mode & 0o777n)};
  } finally {await handle.close();}
}
export async function copyDescriptor(origin, item, destination, relative = item.path) {
  files.relativeFile(relative); await files.sourceFileRange(origin,item,0,1);
  await privateDirectory(destination);
  if(await exists(destination,relative)) {
    await files.sourceFileRange(destination,{...item,path:relative},0,1); return {...item,path:relative};
  }
  const temporary=relative+'.pending-'+randomUUID();
  const source=await files.filePath(origin,item.path), target=await files.filePath(destination,relative,true);
  const pending=await files.filePath(destination,temporary,true);
  try {
    await fs.copyFile(source,pending,constants.COPYFILE_EXCL);await fs.chmod(pending,0o600);
    await files.sourceFileRange(destination,{...item,path:temporary},0,1);
    const handle=await fs.open(pending,'r');try{await handle.sync();}finally{await handle.close();}
    try{await fs.link(pending,target);}catch(error){if(error.code!=='EEXIST')throw error;await files.sourceFileRange(destination,{...item,path:relative},0,1);}
    const parent=await fs.open(dirname(target),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await fs.unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {...item,path:relative};
}
export async function collectFiles(directory, prefix='') {
  const entries=await fs.readdir(prefix?join(directory,prefix):directory,{withFileTypes:true}), result=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=prefix?prefix+'/'+entry.name:entry.name;
    if(/\.pending-[a-f0-9-]+$/.test(entry.name))continue;
    need(!entry.isSymbolicLink(),'INVALID_SOURCE','Retained source must not contain external links.',{path});
    if(entry.isDirectory())result.push(...await collectFiles(directory,path));
    else if(entry.isFile())result.push(await descriptor(directory,path,path.endsWith('.json')?'application/json':'application/octet-stream'));
    else need(false,'INVALID_SOURCE','Retained source contains a nonregular entry.',{path});
  } return result;
}
