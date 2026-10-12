// MIT. Private connection and transport for the original ODK Central workspace listener.
import {constants} from 'node:fs';
import {open, lstat, realpath, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const ODK_CONNECTION_SCHEMA = 'stellar-forge.odk-central-live-connection.v1';
export const ODK_STARTUP_SCHEMA = 'stellar-forge.odk-central-workspace-startup.v1';
export const ODK_CONNECTION_FILENAME = 'odk.connection.json';
export const ODK_MAX_RESPONSE_BYTES = 8 * 1024 * 1024 * 1024;
export const ODK_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const ODK_MAX_CONTROL_BYTES = 2 * 1024 * 1024;
export const ODK_HASH = /^[a-f0-9]{64}$/;
export const ODK_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const odkDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const odkPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function odkFailure(code, message, status = 400, details) {
  return Object.assign(new Error(message), {code, status, ...(details ? {details, data: details} : {})});
}
export function odkNeed(value, code, message, status = 400) {
  if (!value) throw odkFailure(code, message || code, status);
}
export function odkExact(value, allowed, required = []) {
  odkNeed(odkPlain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)),
  'ODK_CONFIGURATION_INVALID', 'Use the declared Central configuration fields.');
}
export function odkAbsolute(value) {
  odkNeed(typeof value === 'string' && isAbsolute(value) && value.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(value), 'ODK_PATH_INVALID', 'Choose an absolute host-owned path.');
  return resolve(value);
}
export async function odkPrivateDirectory(path) {
  path = odkAbsolute(path);
  const information = await lstat(path);
  odkNeed(information.isDirectory() && !information.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || !(information.mode & 0o077) &&
      (!process.getuid || information.uid === process.getuid())),
  'ODK_PRIVATE_DIRECTORY_REQUIRED', 'Use the original owned private directory.');
  return {path, dev: String(information.dev), ino: String(information.ino)};
}
function privateFile(info) {
  return info.isFile() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()));
}
export async function odkReadPrivateFile(path, maximum = ODK_MAX_RESPONSE_BYTES) {
  path = odkAbsolute(path);
  odkNeed(await realpath(path) === path, 'ODK_PRIVATE_FILE_REQUIRED', 'Use a canonical private file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    odkNeed(privateFile(before) && before.size <= maximum,
      'ODK_PRIVATE_FILE_REQUIRED', 'Use an owned private regular file within the declared size limit.');
    const bytes = await file.readFile(), after = await file.stat();
    odkNeed(bytes.length === before.size && bytes.length <= maximum &&
      ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]),
    'ODK_PRIVATE_FILE_CHANGED', 'The selected private file changed during reading.', 409);
    return {path, bytes, sha256: odkDigest(bytes)};
  } finally { await file.close(); }
}
/** Stream a private selected file; large original archives never become a single Buffer. */
export async function odkInspectPrivateFile(path,maximum=ODK_MAX_RESPONSE_BYTES){
  path=odkAbsolute(path);
  odkNeed(await realpath(path)===path,'ODK_PRIVATE_FILE_REQUIRED','Use a canonical private original file.');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat();
    odkNeed(privateFile(before)&&before.size<=maximum,'ODK_PRIVATE_FILE_REQUIRED',
      'Use an owned private regular file within the declared size limit.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=0;
    while(position<before.size){
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-position),position);
      odkNeed(bytesRead>0,'ODK_PRIVATE_FILE_CHANGED','The original selected file changed.',409);
      hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
    }
    const after=await file.stat();
    odkNeed(['dev','ino','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]),
      'ODK_PRIVATE_FILE_CHANGED','The original selected file changed during reading.',409);
    return {path,bytes:position,sha256:hash.digest('hex'),dev:before.dev,ino:before.ino,
      mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs};
  }finally{await file.close();}
}
export function odkParseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw odkFailure('ODK_JSON_INVALID', 'The selected source is not complete UTF-8 JSON.'); }
}
export async function odkReadPrivateJson(path, maximum = 1024 * 1024) {
  const source = await odkReadPrivateFile(path, maximum);
  return {...source, value: odkParseJson(source.bytes)};
}
/** The existing writer owns replacement; this helper preserves private atomic publication. */
export async function odkWritePrivateJson(path, value, {replace = false} = {}) {
  path = odkAbsolute(path);
  await odkPrivateDirectory(dirname(path));
  try {
    const found = await lstat(path);
    odkNeed(replace && privateFile(found) && !found.isSymbolicLink(),
      'ODK_PRIVATE_OUTPUT_EXISTS', 'Choose an unused private output or the same original connection.', 409);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temporary = join(dirname(path), '.odk-' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  catch (error) { await file.close(); await unlink(temporary).catch(() => {}); throw error; }
  finally { await file.close(); }
  try {
    if (!replace) {
      const {link} = await import('node:fs/promises');
      await link(temporary, path); await unlink(temporary);
    } else await rename(temporary, path);
    const folder = await open(dirname(path), 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return {path, sha256: odkDigest(bytes), bytes: bytes.length};
}
function liveUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw odkFailure('ODK_CONNECTION_INVALID', 'The original private listener URL is invalid.'); }
  odkNeed(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && /^#token=[a-f0-9]{64}$/.test(url.hash) &&
    /^\d+$/.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65535,
  'ODK_CONNECTION_INVALID', 'Use the original private loopback Central listener.');
  return url;
}
export async function readCentralConnection(path, {directory} = {}) {
  const source = await odkReadPrivateJson(path, 32768), value = source.value;
  odkExact(value, ['schema','instanceId','directory','directoryIdentity','workspaceId',
    'operator','pid','startedAt','origin','url'],
  ['schema','instanceId','directory','directoryIdentity','workspaceId','operator','pid','startedAt','origin','url']);
  const selected = await odkPrivateDirectory(value.directory);
  odkNeed(value.schema === ODK_CONNECTION_SCHEMA && ODK_UUID.test(value.instanceId ?? '') &&
    ODK_UUID.test(value.workspaceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.operator === 'string' && value.operator.trim() === value.operator &&
    value.operator.length >= 1 && value.operator.length <= 240 && !/[\x00-\x1f\x7f]/.test(value.operator) &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) &&
    odkPlain(value.directoryIdentity) && value.directoryIdentity.dev === selected.dev &&
    value.directoryIdentity.ino === selected.ino &&
    (!directory || selected.path === odkAbsolute(directory)) &&
    source.path === join(selected.path, ODK_CONNECTION_FILENAME),
  'ODK_CONNECTION_CHANGED', 'The original Central workspace binding changed. Review its current connection.', 409);
  const url = liveUrl(value.url);
  odkNeed(value.origin === url.origin, 'ODK_CONNECTION_INVALID', 'The original listener origin changed.');
  return {path:source.path,sha256:source.sha256,value,token:decodeURIComponent(url.hash.slice(7))};
}
export function odkConnectionView(connection) {
  const value = connection.value;
  return {instanceId: value.instanceId, workspaceId: value.workspaceId, operator: value.operator,
    startedAt: value.startedAt, origin: value.origin, pid: value.pid};
}
export async function odkRequest(connection, path, {
  method = 'GET', body, signal, maximum = ODK_MAX_CONTROL_BYTES, fetchImpl = fetch,
  raw = false, readOnly = method === 'GET', timeoutMs = 120000,
} = {}) {
  const url = new URL(path,connection.value.origin);
  odkNeed(url.origin === connection.value.origin && url.pathname.startsWith('/api/') &&
    !url.username && !url.password && !url.hash && ['GET','POST'].includes(method),
  'ODK_REQUEST_ROUTE_INVALID', 'Choose an original Central workspace API operation.');
  odkNeed(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= ODK_MAX_RESPONSE_BYTES &&
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1,
  'ODK_RESPONSE_LIMIT_INVALID', 'Use the declared original response limit and timeout.');
  let serialized;
  if (body !== undefined) {
    serialized = JSON.stringify(body);
    odkNeed(typeof serialized === 'string' && Buffer.byteLength(serialized) <= ODK_MAX_INPUT_BYTES,
      'ODK_REQUEST_TOO_LARGE', 'The original control request exceeds 64 MiB.', 413);
  }
  const operationId = body?.reportId ?? body?.exportId ?? body?.id ?? null;
  const timeout = AbortSignal.timeout(timeoutMs), controller = new AbortController();
  const relay = selected => { if (!controller.signal.aborted) controller.abort(selected.reason); };
  const onTimeout = () => relay(timeout), onAbort = () => relay(signal);
  timeout.addEventListener('abort',onTimeout,{once:true});
  if (signal) { signal.addEventListener('abort',onAbort,{once:true}); if(signal.aborted)onAbort(); }
  let response,handedOff=false;
  try {
    response = await fetchImpl(url,{method,redirect:'error',signal:controller.signal,
      headers:{Authorization:'Bearer '+connection.token,...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(serialized===undefined?{}:{body:serialized})});
    const advertised=response.headers.get('content-length');
    const responseMaximum=raw&&!response.ok?ODK_MAX_CONTROL_BYTES:maximum;
    odkNeed(advertised===null || /^\d+$/.test(advertised) && Number(advertised)<=responseMaximum,
      'ODK_RESPONSE_TOO_LARGE','The original response exceeds the selected byte limit.',413);
    if(raw&&response.ok) {
      handedOff=true;
      return {response,async release(){
        timeout.removeEventListener('abort',onTimeout);signal?.removeEventListener('abort',onAbort);
        controller.abort();
        if(response.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
      }};
    }
    const chunks=[];let length=0;
    if(response.body)for await(const chunk of response.body){
      length+=chunk.length;
      odkNeed(length<=responseMaximum,'ODK_RESPONSE_TOO_LARGE','The original response exceeds the selected byte limit.',413);
      chunks.push(chunk);
    }
    if(advertised!==null)odkNeed(length===Number(advertised),
      'ODK_RESPONSE_INCOMPLETE','The original listener response ended before its declared byte count.',502);
    const value=odkParseJson(Buffer.concat(chunks));
    if(!response.ok||value?.ok===false){
      const native=odkPlain(value?.error)?value.error:{};
      const message=String(native.message||'The original Central operation failed.')
        .split(connection.token).join('[redacted]').slice(0,4000);
      const details={...(odkPlain(native.details)?native.details:
        native.details===undefined?{}:{nativeDetails:native.details}),
        originalResponse:true,operationId:native.operationId??operationId,
        originalStatus:native.status??response.status,
        ...(response.headers.get('retry-after')?{retryAfter:response.headers.get('retry-after')}:{})};
      throw Object.assign(odkFailure(typeof native.code==='string'&&native.code.length<=100?
        native.code:'ODK_REQUEST_FAILED',message,Number.isInteger(native.status)&&native.status>=400&&native.status<=599?native.status:response.status>=400?response.status:502,details),{operationId:details.operationId});
    }
    return value;
  }catch(error){
    if(error.details?.originalResponse)throw error;
    const details={...(odkPlain(error.details)?error.details:{}),
      operationId,dispatch:readOnly?'read':'unknown'};
    if(error.code&&String(error.code).startsWith('ODK_')){
      error.details=details;error.data=details;error.operationId=operationId;throw error;
    }
    throw Object.assign(odkFailure('ODK_CONNECTION_UNAVAILABLE',
      readOnly?'The original Central listener did not return this read. Reopen its saved application and connection.':
      'The original Central listener did not return the operation. Inspect its retained state and reuse the same original ID and input.',
      503,details),{operationId});
  }finally{
    if(!handedOff){
      timeout.removeEventListener('abort',onTimeout);signal?.removeEventListener('abort',onAbort);
      if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
    }
  }
}
export async function inspectCentralListener(connection, options) {
  const state=await odkRequest(connection,'/api/state',{...options,maximum:64*1024*1024});
  odkNeed(state?.schema==='stellar-forge.odk-central-workspace.v1' &&
    ODK_UUID.test(state.id??'') && state.id===connection.value.workspaceId &&
    Number.isSafeInteger(state.revision) && state.revision>=0,
  'ODK_LISTENER_CHANGED','The authenticated listener differs from the selected original Central workspace.',409);
  return state;
}
/** A remote client borrows the Applications listener; close never stops that application. */
export class CentralWorkspaceClient {
  #connection; #fetch; #closed=false;
  constructor(connection,{fetchImpl=fetch}={}){
    this.#connection=connection;this.#fetch=fetchImpl;
  }
  get binding(){return odkConnectionView(this.#connection);}
  async #current(){
    odkNeed(!this.#closed,'ODK_CLIENT_CLOSED','Reconnect this original Central client.',409);
    const current=await readCentralConnection(this.#connection.path,{directory:this.#connection.value.directory});
    odkNeed(current.sha256===this.#connection.sha256,
      'ODK_CONNECTION_CHANGED','The original Central application restarted. Inspect and reconnect to its current instance.',409);
    return current;
  }
  async state(options={}){return inspectCentralListener(await this.#current(),{...options,fetchImpl:this.#fetch});}
  async action(method,input={},options={}){
    odkNeed(CENTRAL_ACTIONS.has(method),'ODK_ACTION_INVALID','Choose a declared original Central action.');
    const value=await odkRequest(await this.#current(),'/api/actions/'+method,{
      ...options,method:'POST',body:input,readOnly:CENTRAL_READ_ACTIONS.has(method),
      maximum:64*1024*1024,fetchImpl:this.#fetch});
    if(value?.ok!==true||!Object.hasOwn(value,'result')){
      const operationId=input.reportId??input.exportId??input.id??null;
      throw Object.assign(odkFailure('ODK_ACTION_RESPONSE_INVALID',
        'The original Central action did not return its complete result.',502,
        {operationId,dispatch:CENTRAL_READ_ACTIONS.has(method)?'read':'unknown'}),{operationId});
    }
    return value.result;
  }
  connect(input,options){return this.action('connect',{...input,id:input.id??randomUUID()},options);}
  projects(input,options){return this.action('projects',input,options);}
  forms(input,options){return this.action('forms',input,options);}
  createPlan(input,options){return this.action('createPlan',{...input,id:input.id??randomUUID()},options);}
  capture(input,options){return this.action('capture',{...input,id:input.id??randomUUID()},options);}
  resume(input,options){return this.action('resume',input,options);}
  pause(input,options){return this.action('pause',input,options);}
  wait(input,options){return this.action('wait',input,options);}
  sourceFile(input,options){return this.action('sourceFile',input,options);}
  exportFile(input,options){return this.action('exportFile',input,options);}
  edition(input,options){return this.action('edition',input,options);}
  rows(input,options){return this.action('rows',input,options);}
  row(input,options){return this.action('row',input,options);}
  resources(input,options){return this.action('resources',input,options);}
  quality(input,options){return this.action('quality',input,options);}
  review(input,options){return this.action('review',input,options);}
  compare(input,options){return this.action('compare',input,options);}
  exportDataset(input,options){return this.action('exportDataset',{...input,exportId:input.exportId??randomUUID()},options);}
  report(input,options){return this.action('report',{...input,reportId:input.reportId??randomUUID()},options);}
  backup(input={},options){return this.action('backup',{...input,id:input.id??randomUUID()},options);}
  prepareRelease(input,options){return this.action('prepareRelease',input,options);}
  releaseStatus(input={},options){return this.action('releaseStatus',input,options);}
  activateRelease(input,options){return this.action('activateRelease',input,options);}
  rollbackRelease(input,options){return this.action('rollbackRelease',input,options);}
  async captureStatus(id,options={}){
    return odkRequest(await this.#current(),'/api/captures/'+encodeURIComponent(id),
      {...options,maximum:64*1024*1024,fetchImpl:this.#fetch});
  }
  close(){this.#closed=true;}
}
export const CENTRAL_READ_ACTIONS=new Set(['projects','forms','wait','sourceFile','exportFile','edition','rows','row','resources','quality','compare','releaseStatus']);
export const CENTRAL_ACTIONS=new Set(['connect','createPlan','capture','resume','pause','review',
  'exportDataset','report','backup','prepareRelease','activateRelease','rollbackRelease',...CENTRAL_READ_ACTIONS]);
export async function connectCentralWorkspace({connectionFile,directory,fetchImpl=fetch}){
  const connection=await readCentralConnection(connectionFile,{directory});
  await inspectCentralListener(connection,{fetchImpl});
  return new CentralWorkspaceClient(connection,{fetchImpl});
}
