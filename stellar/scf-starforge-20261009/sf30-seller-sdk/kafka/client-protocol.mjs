// MIT. Node client contract for the original private Kafka/NDJSON workspace.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

export const KAFKA_CLIENT_SCHEMA = 'stellar-forge.kafka-workspace-client.v1';
export const KAFKA_CONNECTION_SCHEMA = 'stellar-forge.kafka-client-connection.v1';
export const KAFKA_LAUNCH_SCHEMA = 'stellar-forge.kafka-workspace-launch.v1';
export const KAFKA_LIMITS = Object.freeze({
  connectionBytes: 16384, requestBytes: 1024 * 1024, datasetRequestBytes: 131072,
  sourceBytes: 256 * 1024 * 1024, nativePacketBytes: 512 * 1024 * 1024,
  kafkaPacketBytes: 6 * 256 * 1024 * 1024 + 32 * 1024 * 1024,
  jsonBytes: 16 * 1024 * 1024, downloadBytes: 2 * 1024 * 1024 * 1024
});
export const KAFKA_CAPTURE_STATUSES = Object.freeze([
  'PREPARED','RUNNING','CANCELLING','CANCELLED','INTERRUPTED','COMPLETE',
  'LIMIT_REACHED','SOURCE_GAP','SOURCE_CHANGED','SOURCE_CONFLICT','ERROR'
]);
export class KafkaWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KafkaWorkspaceError';
    this.code = code;
    for (const name of ['status','outcomeUnknown','method','route','retainedFile'])
      if (details[name] !== undefined) this[name] = details[name];
  }
  toJSON() {
    const value = {code:this.code,message:this.message};
    for (const name of ['status','outcomeUnknown','method','route','retainedFile'])
      if (this[name] !== undefined) value[name] = this[name];
    return value;
  }
}
export const failure = (code, message, details) => new KafkaWorkspaceError(code,message,details);
export const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function exact(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value,key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
    throw failure('KAFKA_INVALID_PARAMS','Supply exactly the declared operation fields.');
  return value;
}
export function identifier(value, label = 'Identity') {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw failure('KAFKA_INVALID_PARAMS',label + ' must be an original lowercase SHA-256 identity.');
  return value;
}
export function operationName(value, label = 'Operation') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw failure('KAFKA_INVALID_PARAMS',label + ' must contain 1–128 original name characters.');
  return value;
}
export function integer(value, low, high, label = 'Value') {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw failure('KAFKA_INVALID_PARAMS',label + ' must be an integer from ' + low + ' to ' + high + '.');
  return value;
}
export function kafkaOffset(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) ||
      value.length > 19 || BigInt(value) > 9223372036854775807n)
    throw failure('KAFKA_INVALID_PARAMS','Kafka offsets must remain original nonnegative signed-64 decimal strings.');
  return value;
}
export function hostPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('KAFKA_HOST_FILE_INVALID','Select an original host file path.');
  return resolve(value);
}
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function utf8(bytes) {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { throw failure('KAFKA_JSON_INVALID','The original response must contain complete UTF-8 bytes.'); }
}

let exactRuntimeChecked = false;
function exactRuntime() {
  if (exactRuntimeChecked) return;
  let source;
  JSON.parse('9007199254740993',(_key,value,context) => {source=context?.source;return value;});
  if (source !== '9007199254740993' || typeof JSON.rawJSON !== 'function')
    throw failure('KAFKA_NODE_RUNTIME','Use the maintained Node runtime with JSON source-text access and JSON.rawJSON (Node 22.16 or newer).');
  exactRuntimeChecked = true;
}
/** A JSON numeric lexeme, never coerced into a JavaScript Number. */
export class KafkaJsonNumber {
  constructor(source) {
    if (typeof source !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(source))
      throw failure('KAFKA_JSON_INVALID','Supply one exact JSON numeric token.');
    this.source = source;
    Object.freeze(this);
  }
  toString() { return this.source; }
  valueOf() { throw new TypeError('Use KafkaJsonNumber.source for the exact numeric token.'); }
  toJSON() { return {$kafkaNumber:this.source}; }
  [Symbol.toPrimitive](hint) { if (hint === 'string') return this.source; return this.valueOf(); }
}
export function parseKafkaJson(text) {
  exactRuntime();
  if (typeof text !== 'string') throw failure('KAFKA_JSON_INVALID','Supply original JSON text.');
  try {
    return JSON.parse(text,(_key,value,context) => {
      if (typeof value !== 'number') return value;
      return Number.isSafeInteger(value) && String(value) === context.source
        ? value : new KafkaJsonNumber(context.source);
    });
  } catch (error) {
    if (error instanceof KafkaWorkspaceError) throw error;
    throw failure('KAFKA_JSON_INVALID','The original operation returned invalid JSON.');
  }
}
export function stringifyKafkaJson(value, space = 0) {
  exactRuntime();
  try {
    const text = JSON.stringify(value,function(key,item) {
      if (this[key] instanceof KafkaJsonNumber) return JSON.rawJSON(this[key].source);
      if (typeof item === 'number' && (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item)))
        throw failure('KAFKA_JSON_INVALID','Use KafkaJsonNumber for an exact integer outside the JavaScript safe range.');
      if (typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol' || item === undefined)
        throw failure('KAFKA_JSON_INVALID','Use declared JSON values; represent exact numeric tokens with KafkaJsonNumber.');
      return item;
    },space);
    if (text === undefined) throw failure('KAFKA_JSON_INVALID','Supply a complete JSON value.');
    return text;
  } catch (error) {
    if (error instanceof KafkaWorkspaceError) throw error;
    throw failure('KAFKA_JSON_INVALID','The selected request cannot be represented as exact JSON.');
  }
}
export function sameFile(a,b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export async function readKafkaHostFile(filename, maximum, {privateFile = false, sha256} = {}) {
  const path = hostPath(filename);
  const handle = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size > BigInt(maximum) ||
        privateFile && (before.nlink !== 1n || process.platform !== 'win32' &&
          ((before.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid()))))
      throw failure('KAFKA_HOST_FILE_INVALID','Select a complete regular file within its original size and privacy limits.');
    const chunks=[]; let size=0;
    for (;;) {
      const part=Buffer.allocUnsafe(Math.min(65536,maximum-size+1));
      const {bytesRead}=await handle.read(part,0,part.length,null);
      if (!bytesRead) break;
      size+=bytesRead;
      if (size>maximum) throw failure('KAFKA_HOST_FILE_CHANGED','The original file grew beyond its declared limit.');
      chunks.push(part.subarray(0,bytesRead));
    }
    const after=await handle.stat({bigint:true}), current=await lstat(path,{bigint:true});
    if (!sameFile(before,after) || !sameFile(after,current) || BigInt(size)!==before.size)
      throw failure('KAFKA_HOST_FILE_CHANGED','The selected file changed during its original read.');
    const bytes=Buffer.concat(chunks,size);
    if (sha256!==undefined && hash(bytes)!==identifier(sha256,'File SHA-256'))
      throw failure('KAFKA_HOST_FILE_CHANGED','The original bytes differ from their declared SHA-256.');
    return bytes;
  } finally { await handle.close(); }
}
function consoleValue(value) {
  let url;
  try { url=new URL(value); } catch {}
  const port=Number(url?.port || 80);
  if (typeof value!=='string' || value!==value.trim() || !url ||
      url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password ||
      url.pathname!=='/' || url.search || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash) ||
      !Number.isInteger(port) || port<1 || port>65535 ||
      value!==url.origin + '/#' + url.hash.slice(1))
    throw failure('KAFKA_CONNECTION_INVALID','Select the complete private URL printed by the original local Kafka console.');
  return {origin:url.origin,port,token:url.hash.slice(1),url:value};
}
/** Reads the original private connection file, including a managed Applications URL record. */
export async function readKafkaWorkspaceConnection(filename) {
  const path=hostPath(filename);
  let bytes;
  try { bytes=await readKafkaHostFile(path,KAFKA_LIMITS.connectionBytes,{privateFile:true}); }
  catch (error) {
    if (error instanceof KafkaWorkspaceError) throw error;
    throw failure('KAFKA_CONNECTION_UNAVAILABLE','Open the original Kafka Application and select its current private connection file.');
  }
  let text=utf8(bytes), application;
  if (text.endsWith('\n')) text=text.slice(0,-1);
  if (text.startsWith('{')) {
    const record=parseKafkaJson(text);
    if (!plain(record) || record.schema!=='stellar-forge.application-url.v1' ||
        record.command!=='dataset-kafka' || record.source!=='original-command-stdout' ||
        typeof record.applicationId!=='string' || !record.applicationId ||
        typeof record.operationId!=='string' || !record.operationId ||
        typeof record.observedAt!=='string' || !Number.isFinite(Date.parse(record.observedAt)) ||
        !plain(record.original) || record.original.schema!==KAFKA_LAUNCH_SCHEMA)
      throw failure('KAFKA_CONNECTION_INVALID','Select the original dataset-kafka Applications URL record.');
    const original={};
    for(const key of ['schema','workspace','workspaceId','bindingSha256','sourceRoot','pid'])
      original[key]=record.original[key];
    application={applicationId:record.applicationId,operationId:record.operationId,
      observedAt:record.observedAt,original:Object.freeze(original)};
    text=record.url;
  }
  const selected=consoleValue(text);
  const result={schema:KAFKA_CONNECTION_SCHEMA,connectionFile:path,
    origin:selected.origin,port:selected.port,fileSha256:hash(bytes)};
  if (application) result.application=Object.freeze(application);
  Object.defineProperties(result,{
    token:{value:selected.token,enumerable:false},consoleUrl:{value:selected.url,enumerable:false}
  });
  return Object.freeze(result);
}
export function validateKafkaLaunch(launch,connection,definition,previous) {
  if (!plain(launch) || launch.schema!==KAFKA_LAUNCH_SCHEMA || launch.status!=='KAFKA_WORKSPACE_READY' ||
      typeof launch.workspace!=='string' || !isAbsolute(launch.workspace) ||
      typeof launch.workspaceId!=='string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(launch.workspaceId) ||
      typeof launch.bindingSha256!=='string' || !/^[a-f0-9]{64}$/.test(launch.bindingSha256) ||
      typeof launch.sourceRoot!=='string' || !isAbsolute(launch.sourceRoot) ||
      !plain(launch.python) || typeof launch.python.executable!=='string' ||
      !Number.isSafeInteger(launch.pid) || launch.pid<1 || launch.console!==connection.consoleUrl)
    throw failure('KAFKA_CONNECTION_INVALID','The authenticated process did not return its original Kafka workspace launch.');
  const expected=connection.application?.original;
  if (expected && ['workspace','workspaceId','bindingSha256','sourceRoot','pid'].some(key => expected[key]!==launch[key]) ||
      definition.expectedWorkspaceId!==undefined && definition.expectedWorkspaceId!==launch.workspaceId ||
      definition.expectedBindingSha256!==undefined && definition.expectedBindingSha256!==launch.bindingSha256 ||
      previous && (previous.workspace!==launch.workspace || previous.workspaceId!==launch.workspaceId ||
        previous.bindingSha256!==launch.bindingSha256))
    throw failure('KAFKA_BINDING_CHANGED','The selected connection belongs to a different original workspace or source binding.');
  return Object.freeze({workspace:launch.workspace,workspaceId:launch.workspaceId,bindingSha256:launch.bindingSha256});
}
export function requestPath(route,query={}) {
  const params=new URLSearchParams();
  for (const [key,value] of Object.entries(query)) if (value!==undefined) params.set(key,String(value));
  return route + (params.size ? '?' + params.toString() : '');
}
export function page(input={}, maximum=200) {
  exact(input,[],['offset','limit']);
  return {offset:integer(input.offset??0,0,1000000000,'Page offset'),
    limit:integer(input.limit??50,1,maximum,'Page size')};
}
export function captureRevision(request) {
  exact(request,['capture','expectedRevision']);
  identifier(request.capture,'Capture');integer(request.expectedRevision,1,1000000000,'Capture revision');
  return request;
}
export function prepareCaptureRequest(request) {
  exact(request,['inspection','operation','ranges']);
  identifier(request.inspection,'Inspection');operationName(request.operation);
  if (!Array.isArray(request.ranges) || request.ranges.length<1 || request.ranges.length>4096)
    throw failure('KAFKA_INVALID_PARAMS','Select 1–4096 exact original partition ranges.');
  const seen=new Set();
  for (const range of request.ranges) {
    exact(range,['partition','start','end']);integer(range.partition,0,2147483647,'Partition');
    kafkaOffset(range.start);kafkaOffset(range.end);
    if (seen.has(range.partition) || BigInt(range.end)<BigInt(range.start))
      throw failure('KAFKA_INVALID_PARAMS','Each partition must have one ordered original offset interval.');
    seen.add(range.partition);
  }
  return request;
}
export function projectRequest(request) {
  exact(request,['operation','captures','view','decode','deletePolicy','acceptIncomplete','label']);
  operationName(request.operation);
  if (!Array.isArray(request.captures) || request.captures.length<1 || request.captures.length>64 ||
      !['events','latest-per-partition-key'].includes(request.view) || !['json','bytes'].includes(request.decode) ||
      !['retain','tombstone','tombstone-or-goldsky'].includes(request.deletePolicy) ||
      typeof request.acceptIncomplete!=='boolean' || typeof request.label!=='string')
    throw failure('KAFKA_INVALID_PARAMS','Select the native capture revisions and explicit projection semantics.');
  const seen=new Set();
  for (const selected of request.captures) {
    exact(selected,['id','revision']);identifier(selected.id,'Capture');integer(selected.revision,1,1000000000,'Capture revision');
    if (seen.has(selected.id)) throw failure('KAFKA_INVALID_PARAMS','Select each original capture once.');
    seen.add(selected.id);
  }
  return request;
}
