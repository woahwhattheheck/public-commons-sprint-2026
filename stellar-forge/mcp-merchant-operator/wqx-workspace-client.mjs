// MIT. Typed WQX operations and resumable files over the original merchant MCP transport.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openMerchantFileClient } from './retained-download.mjs';
import { failure, identifier, plain, privateSupportDirectory, writePrivate } from './host-files.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

export const WQX_TRANSFER_CHUNK_BYTES = 65536;
export const WQX_DOWNLOAD_SCHEMA = 'stellar-forge.wqx-file-download.v1';
export const WQX_DOWNLOAD_STATE_SCHEMA = 'stellar-forge.wqx-file-download-state.v1';
export const WQX_TRANSFER_MAX_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = WQX_TRANSFER_MAX_BYTES;
const SHA = /^[0-9a-f]{64}$/;
const READ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNSCOPED = new Set(['status','files','input_files','file_read','file_release','input_begin','input_append','input_finish','input_status']);
const STATE_DIRECTORY = 'download-state';
const DESCRIPTOR_NAME = 'wqx-file.json';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message, details) => { throw Object.assign(failure('WQX_CLIENT_' + code, message), details); };
function object(value, label) {
  if (!plain(value)) fail('INPUT', label + ' must be a JSON object.');
  return value;
}
function sha256(value, label = 'SHA256') {
  if (typeof value !== 'string' || !SHA.test(value)) fail('INPUT', label + ' must be the complete lowercase SHA256.');
  return value;
}
function integer(value, label, maximum = Number.MAX_SAFE_INTEGER, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INPUT', label + ' is outside its supported integer range.');
  return value;
}
function filename(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || /[\\/\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..')
    fail('INPUT', 'Use one original basename of 1–180 characters without path separators or control characters.');
  return value;
}
function contentType(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 240 || /[\x00-\x1f\x7f]/.test(value))
    fail('INPUT', 'Use the original nonempty content type.');
  return value;
}
function readId(value) {
  if (typeof value !== 'string' || !READ_ID.test(value)) fail('REPLY', 'The original retained read ID is invalid.');
  return value;
}
export function validateWqxFile(value) {
  object(value, 'Retained file');
  sha256(value.fileId, 'fileId'); filename(value.name); contentType(value.contentType);
  integer(value.bytes, 'File bytes', MAX_FILE_BYTES); sha256(value.sha256);
  return value;
}
function fileIdentity(value) {
  validateWqxFile(value);
  return { fileId:value.fileId, name:value.name, contentType:value.contentType, bytes:value.bytes, sha256:value.sha256 };
}
function sameFile(left, right) {
  return ['fileId','name','contentType','bytes','sha256'].every(key => left?.[key] === right?.[key]);
}
function inputState(value, expected) {
  object(value, 'Original input status');
  identifier(value.inputId, 'inputId'); filename(value.name); contentType(value.contentType);
  sha256(value.sha256); integer(value.bytes, 'Input bytes', MAX_FILE_BYTES);
  integer(value.receivedBytes, 'Retained input bytes', value.bytes);
  if (!['RECEIVING','COMPLETE'].includes(value.status) ||
      value.status === 'COMPLETE' && (value.receivedBytes !== value.bytes || value.inputRef !== 'input:' + value.inputId) ||
      expected && ['inputId','name','contentType','bytes','sha256'].some(key => expected[key] !== undefined && value[key] !== expected[key]))
    fail('INPUT_CONFLICT', 'The original input status differs from this named source and byte identity.');
  return value;
}
function checkedChunk(value, args) {
  object(value, 'Original file range'); object(value.file, 'Original range metadata');
  const file = { ...value.file, fileId:value.fileId };
  validateWqxFile(file); readId(value.readId);
  const offset = args.offset ?? 0, limit = args.limit ?? WQX_TRANSFER_CHUNK_BYTES;
  const size = Math.min(limit, file.bytes - offset), next = offset + size;
  if (size < 0 || file.fileId !== args.fileId || file.sha256 !== args.expectedSha256 ||
      value.offset !== offset || value.bytesRead !== size || value.nextOffset !== (next < file.bytes ? next : null) ||
      args.readId && value.readId !== args.readId || value.encoding !== 'base64' || typeof value.data !== 'string')
    fail('RANGE_CONFLICT', 'The returned bytes differ from the requested original file, read or offset.');
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== value.data)
    fail('RANGE_INVALID', 'The original file range has noncanonical base64 or a different byte count.');
  return value;
}
function transportOptions(options, lifetime) {
  const signal = options.signal ? AbortSignal.any([options.signal,lifetime]) : lifetime;
  signal.throwIfAborted();
  return { requestSignal:signal, ...(options.timeoutMs === undefined ? {} : { timeoutMs:integer(options.timeoutMs,'Request timeout',1800000,1) }) };
}

/** The supplied native client's call() returns the original structured tool value. */
export class WqxWorkspaceClient {
  #client; #workspace; #lifetime = new AbortController();
  constructor({ client, workspace } = {}) {
    if (!client || typeof client.call !== 'function' || typeof client.endpoint !== 'string' ||
        !client.endpoint.trim() || client.endpoint.length > 4096 || /[\x00-\x1f\x7f]/.test(client.endpoint))
      fail('CONFIGURATION', 'Use the existing merchant MCP client with its stable endpoint identity.');
    if (workspace !== undefined) identifier(workspace, 'Workspace alias');
    this.#client = client; this.#workspace = workspace;
  }
  get workspace() { return this.#workspace; }
  get endpoint() { return this.#client.endpoint; }
  get closed() { return this.#lifetime.signal.aborted; }
  /** Only client reads/waits are closed; original workspace operations retain their IDs. */
  close() { this.#lifetime.abort(failure('WQX_CLIENT_CLOSED','This WQX client is closed.')); }
  async call(name, args = {}, options = {}) {
    if (typeof name !== 'string' || !/^merchant_wqx_[a-z][a-z_]*$/.test(name))
      fail('INPUT', 'Select one original merchant_wqx tool name.');
    object(args, 'Tool arguments');
    const native = { ...args }, short = name.slice('merchant_wqx_'.length);
    if (native.workspace !== undefined) {
      identifier(native.workspace, 'Workspace alias');
      if (this.#workspace !== undefined && native.workspace !== this.#workspace)
        fail('WORKSPACE_CONFLICT', 'These arguments belong to a different configured workspace alias.');
    }
    if (short === 'status') {
      if (native.workspace === undefined && this.#workspace !== undefined) native.workspace = this.#workspace;
    } else if (!UNSCOPED.has(short)) {
      native.workspace ??= this.#workspace;
      identifier(native.workspace, 'Workspace alias');
    } else if (native.workspace !== undefined) fail('INPUT', 'Retained file and named-input operations use their original IDs without a workspace field.');
    return this.#client.call(name,native,transportOptions(options,this.#lifetime.signal));
  }
  status(args = {}, options) { return this.call('merchant_wqx_status',args,options); }
  inventory(args, options) { return this.call('merchant_wqx_inventory',args,options); }
  record(args, options) { return this.call('merchant_wqx_record',args,options); }
  result(args, options) { return this.call('merchant_wqx_result',args,options); }
  files(args = {}, options) { return this.call('merchant_wqx_files',args,options); }
  inputFiles(args = {}, options) { return this.call('merchant_wqx_input_files',args,options); }
  captureImport(args, options) { return this.call('merchant_wqx_capture_import',args,options); }
  captureCancel(args, options) { return this.call('merchant_wqx_capture_cancel',args,options); }
  targets(args, options) { return this.call('merchant_wqx_targets',args,options); }
  async file(args, options) { return validateWqxFile(await this.call('merchant_wqx_file',args,options)); }
  async fileRead(args, options) {
    object(args,'File read'); sha256(args.fileId,'fileId'); sha256(args.expectedSha256);
    integer(args.offset ?? 0,'Byte offset',MAX_FILE_BYTES);
    integer(args.limit ?? WQX_TRANSFER_CHUNK_BYTES,'Chunk bytes',WQX_TRANSFER_CHUNK_BYTES,1);
    if (args.readId !== undefined) readId(args.readId);
    return checkedChunk(await this.call('merchant_wqx_file_read',args,options),args);
  }
  fileRelease(args, options) {
    object(args,'File release'); sha256(args.fileId,'fileId'); readId(args.readId);
    return this.call('merchant_wqx_file_release',args,options);
  }
  async inputBegin(args, options) {
    object(args,'Named input'); identifier(args.inputId,'inputId'); filename(args.name);
    contentType(args.contentType ?? 'application/octet-stream'); integer(args.bytes,'Input bytes',MAX_FILE_BYTES); sha256(args.sha256);
    return inputState(await this.call('merchant_wqx_input_begin',args,options),args);
  }
  async inputAppend(args, options) {
    object(args,'Input append'); identifier(args.inputId,'inputId'); sha256(args.sha256);
    integer(args.offset,'Input offset',MAX_FILE_BYTES);
    if (typeof args.dataBase64 !== 'string') fail('INPUT','Use canonical base64 for the exact next input bytes.');
    const bytes = Buffer.from(args.dataBase64,'base64');
    if (bytes.length < 1 || bytes.length > WQX_TRANSFER_CHUNK_BYTES || bytes.toString('base64') !== args.dataBase64)
      fail('INPUT','Append 1–65,536 original bytes in canonical base64.');
    const result = inputState(await this.call('merchant_wqx_input_append',args,options),args);
    if (result.receivedBytes < args.offset + bytes.length)
      fail('INPUT_CONFLICT','The original append response did not retain this complete range.');
    return result;
  }
  async inputFinish(args, options) {
    object(args,'Input finish'); identifier(args.inputId,'inputId'); sha256(args.sha256);
    const result = inputState(await this.call('merchant_wqx_input_finish',args,options),args);
    if (result.status !== 'COMPLETE') fail('INPUT_INCOMPLETE','The original input has not completed its full-byte verification.');
    return result;
  }
  async inputStatus(args, options) {
    object(args,'Input status'); identifier(args.inputId,'inputId');
    return inputState(await this.call('merchant_wqx_input_status',args,options),args);
  }
  async tableExport(args, options) { return validateWqxFile(await this.call('merchant_wqx_table_export',args,options)); }
  tableImport(args, options) { return this.call('merchant_wqx_table_import',args,options); }
  decisionsPreview(args, options) { return this.call('merchant_wqx_decisions_preview',args,options); }
  decisionsSave(args, options) { return this.call('merchant_wqx_decisions_save',args,options); }
  receive(args, options) { return this.call('merchant_wqx_receive',args,options); }
  projectSave(args, options) { return this.call('merchant_wqx_project_save',args,options); }
  captureStart(args, options) { return this.call('merchant_wqx_capture_start',args,options); }
  analyze(args, options) { return this.call('merchant_wqx_analyze',args,options); }
  reviewSave(args, options) { return this.call('merchant_wqx_review_save',args,options); }
  planPreview(args, options) { return this.call('merchant_wqx_plan_preview',args,options); }
  planSave(args, options) { return this.call('merchant_wqx_plan_save',args,options); }
  editionPrepare(args, options) { return this.call('merchant_wqx_edition_prepare',args,options); }
  merchantStage(args, options) { return this.call('merchant_wqx_merchant_stage',args,options); }
  merchantStart(args, options) { return this.call('merchant_wqx_merchant_start',args,options); }
  merchantStop(args, options) { return this.call('merchant_wqx_merchant_stop',args,options); }
  customerPrepare(args, options) { return this.call('merchant_wqx_customer_prepare',args,options); }
  customerExecute(args, options) { return this.call('merchant_wqx_customer_execute',args,options); }
  customerReopen(args, options) { return this.call('merchant_wqx_customer_reopen',args,options); }
  uploadFile(input, options) { return uploadWqxInput(this,input,options); }
  downloadFile(input, options) { return downloadWqxFile(this,input,options); }
}

export async function openWqxWorkspaceClient({ client, workspace, url, tokenEnv, environment, signal } = {}) {
  if (client !== undefined && url !== undefined) fail('CONFIGURATION','Choose an existing client or its MCP endpoint.');
  const original = client ?? await openMerchantFileClient({ url, tokenEnv, environment, signal,
    errorPrefix:'WQX',clientName:'starforge-wqx-workspace-client' });
  return new WqxWorkspaceClient({ client:original,workspace });
}
const stableKeys = ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'];
function sameIdentity(left, right) { return stableKeys.every(key => left[key] === right[key]); }
async function regular(path, flags = constants.O_RDONLY, { maximum = MAX_FILE_BYTES, privateFile = false } = {}) {
  const handle = await open(resolve(path),flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),0o600);
  try {
    const info = await handle.stat({bigint:true});
    if (!info.isFile() || info.size > BigInt(maximum) || privateFile && (info.nlink !== 1n ||
        process.platform !== 'win32' && ((info.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid()))))
      fail('FILE_INVALID','Use a stable regular file within its declared limit; retained transfer files must be private, owned and independent.');
    return {handle,info};
  } catch(error) { await handle.close(); throw error; }
}
async function hashPrefix(handle, length) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(WQX_TRANSFER_CHUNK_BYTES); let offset = 0;
  while (offset < length) {
    const {bytesRead} = await handle.read(buffer,0,Math.min(buffer.length,length-offset),offset);
    if (!bytesRead) fail('FILE_CHANGED','The selected file ended before its original byte count.');
    hash.update(buffer.subarray(0,bytesRead)); offset += bytesRead;
  }
  return hash;
}
async function stableHash(handle, before) {
  const hash = await hashPrefix(handle,Number(before.size));
  if (!sameIdentity(before,await handle.stat({bigint:true}))) fail('FILE_CHANGED','The selected file changed while its original hash was read.');
  return hash.digest('hex');
}
async function localJSON(path, maximum = 1048576) {
  const {handle,info} = await regular(path,constants.O_RDONLY,{maximum,privateFile:true});
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== Number(info.size) || !sameIdentity(info,await handle.stat({bigint:true})))
      fail('FILE_CHANGED','A retained transfer record changed during its read.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch { fail('CHECKPOINT_INVALID','Read the complete original private JSON record.'); }
    return object(value,'Retained JSON');
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path,constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function removeOwned(path) {
  let selected;
  try { selected = await regular(path,constants.O_RDONLY,{privateFile:true}); }
  catch(error) { if (error.code === 'ENOENT') return; throw error; }
  await selected.handle.close(); await unlink(path);
}
async function withDownload(directory, operation) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/')
    fail('CONFIGURATION','Choose a private directory dedicated to this one retained download.');
  const root = resolve(directory);
  try { await mkdir(root,{mode:0o700}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) fail('CONFIGURATION','Use the canonical private download directory without symlink components.');
  const stateDirectory = join(root,STATE_DIRECTORY);
  const names = await readdir(root);
  if (names.length && !names.includes(STATE_DIRECTORY)) fail('DIRECTORY_IN_USE','Choose an empty directory or this original download directory.');
  try { await mkdir(stateDirectory,{mode:0o700}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(stateDirectory);
  if (await realpath(stateDirectory) !== stateDirectory) fail('DIRECTORY_IN_USE','The original transfer directory changed identity.');
  const lease = await acquireStateLease(stateDirectory);
  try { return await operation({root,stateDirectory,lease}); } finally { await lease.close(); }
}
async function saveCheckpoint(context, state) {
  context.lease.assertHeld();
  const temporary = join(context.stateDirectory,'checkpoint.next'), path = join(context.stateDirectory,'checkpoint.json');
  await removeOwned(temporary);
  await writePrivate(temporary,JSON.stringify(state,null,2)+'\n');
  context.lease.assertHeld(); await rename(temporary,path); await syncDirectory(context.stateDirectory);
}
async function verifiedLocal(path, file) {
  const {handle,info} = await regular(path,constants.O_RDONLY,{maximum:file.bytes,privateFile:true});
  try {
    if (Number(info.size) !== file.bytes || await stableHash(handle,info) !== file.sha256)
      fail('FILE_CHANGED','The retained local file differs from the original complete byte identity.');
  } finally { await handle.close(); }
}
function validCheckpoint(state, file, selectedName, endpointSha256) {
  if (state.schema !== WQX_DOWNLOAD_STATE_SCHEMA || !sameFile(state.file,file) || state.filename !== selectedName ||
      endpointSha256 !== undefined && state.endpointSha256 !== endpointSha256 ||
      !['DOWNLOADING','COMPLETE'].includes(state.status) || !SHA.test(state.prefixSha256 ?? '') ||
      !Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > file.bytes ||
      state.status === 'COMPLETE' && (state.offset !== file.bytes || state.prefixSha256 !== file.sha256) ||
      state.readId !== null && state.readId !== undefined && !READ_ID.test(state.readId))
    fail('CHECKPOINT_CONFLICT','This directory belongs to another file, endpoint or retained byte prefix.');
}
function resultFor(context,state,resumedBytes) {
  return {schema:WQX_DOWNLOAD_SCHEMA,status:'COMPLETE',directory:context.root,filename:join(context.root,state.filename),
    file:state.file,bytes:state.file.bytes,sha256:state.file.sha256,resumedBytes};
}

/** Held source descriptor + server's original receivedBytes provide upload resume. */
export async function uploadWqxInput(client, { path, inputId, name, contentType: type = 'application/octet-stream',
  expectedSha256, maximumBytes = MAX_FILE_BYTES } = {}, {signal,chunkSize = WQX_TRANSFER_CHUNK_BYTES,onProgress,timeoutMs} = {}) {
  identifier(inputId,'inputId'); integer(maximumBytes,'Maximum input bytes',MAX_FILE_BYTES);
  integer(chunkSize,'Chunk size',WQX_TRANSFER_CHUNK_BYTES,1);
  if (typeof path !== 'string' || !path || path.includes('\0')) fail('INPUT','Select the local source file.');
  name = filename(name ?? basename(path)); contentType(type);
  if(expectedSha256 !== undefined) sha256(expectedSha256);
  const {handle,info} = await regular(path,constants.O_RDONLY,{maximum:maximumBytes});
  let selected, retained;
  try {
    signal?.throwIfAborted();
    selected = {inputId,name,contentType:type,bytes:Number(info.size),sha256:await stableHash(handle,info)};
    if(expectedSha256 !== undefined && selected.sha256 !== expectedSha256)
      fail('FILE_CHANGED','The selected source differs from the expected original SHA256.');
    retained = inputState(await client.inputBegin(selected,{signal,timeoutMs}),selected);
    const resumedBytes = retained.receivedBytes, buffer = Buffer.alloc(chunkSize);
    while (retained.receivedBytes < selected.bytes) {
      signal?.throwIfAborted();
      const offset = retained.receivedBytes, length = Math.min(chunkSize,selected.bytes-offset); let total = 0;
      while(total < length) {
        const {bytesRead} = await handle.read(buffer,total,length-total,offset+total);
        if(!bytesRead) fail('FILE_CHANGED','The selected source ended during the original input append.');
        total += bytesRead;
      }
      if(!sameIdentity(info,await handle.stat({bigint:true}))) fail('FILE_CHANGED','The source changed before its next original append.');
      retained = inputState(await client.inputAppend({inputId,sha256:selected.sha256,offset,dataBase64:buffer.subarray(0,length).toString('base64')},{signal,timeoutMs}),selected);
      await onProgress?.({inputId,status:retained.status,bytes:retained.receivedBytes,total:selected.bytes,sha256:selected.sha256});
    }
    if(!sameIdentity(info,await handle.stat({bigint:true}))) fail('FILE_CHANGED','The selected source changed before full input completion.');
    retained = inputState(await client.inputFinish({inputId,sha256:selected.sha256},{signal,timeoutMs}),selected);
    if(retained.status !== 'COMPLETE') fail('INPUT_INCOMPLETE','The original input has not completed.');
    return {...retained,resumedBytes};
  } catch(error) {
    Object.assign(error,{inputId,...(selected?{sha256:selected.sha256,bytes:selected.bytes}:{}),
      ...(retained?{receivedBytes:retained.receivedBytes}:{})});
    throw error;
  } finally { await handle.close(); }
}

/** A per-directory original flock owns checkpoint, exact prefix and publication. */
export async function downloadWqxFile(client, {file,directory,name} = {},
  {signal,chunkSize = WQX_TRANSFER_CHUNK_BYTES,onProgress,timeoutMs} = {}) {
  const selected = fileIdentity(file), selectedName = filename(name ?? selected.name);
  if([STATE_DIRECTORY,DESCRIPTOR_NAME].includes(selectedName)) fail('INPUT','Choose a local --name outside the two reserved transfer names.');
  integer(chunkSize,'Chunk size',WQX_TRANSFER_CHUNK_BYTES,1);
  const endpointSha256 = digest(client.endpoint + '\n' + (client.workspace ?? ''));
  return withDownload(directory,async context => {
    const allowed = new Set([STATE_DIRECTORY,DESCRIPTOR_NAME,selectedName]);
    if((await readdir(context.root)).some(entry => !allowed.has(entry))) fail('DIRECTORY_IN_USE','The selected directory contains another operation’s files.');
    let state;
    try { state = await localJSON(join(context.stateDirectory,'checkpoint.json')); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
    const resumedBytes = state?.offset ?? 0;
    if(state) validCheckpoint(state,selected,selectedName,endpointSha256);
    else {
      if((await readdir(context.root)).some(entry => entry !== STATE_DIRECTORY)) fail('CHECKPOINT_MISSING','Keep the original checkpoint alongside its downloaded file.');
      state = {schema:WQX_DOWNLOAD_STATE_SCHEMA,endpointSha256,file:selected,filename:selectedName,status:'DOWNLOADING',
        offset:0,prefixSha256:digest(Buffer.alloc(0)),readId:null,createdAt:new Date().toISOString()};
      await saveCheckpoint(context,state);
    }
    const destination = join(context.root,selectedName), partial = join(context.stateDirectory,'payload.part');
    try {
      await verifiedLocal(destination,selected);
      state = {...state,status:'COMPLETE',offset:selected.bytes,prefixSha256:selected.sha256,readId:null};
      await saveCheckpoint(context,state);
      await removeOwned(partial);
      await saveDescriptor(context,selected);
      return resultFor(context,state,resumedBytes);
    } catch(error) { if(error.code !== 'ENOENT') throw error; }
    if(state.status === 'COMPLETE') fail('FILE_CHANGED','The completed original file is missing.');
    let opened;
    try { opened = await regular(partial,constants.O_RDWR,{maximum:selected.bytes,privateFile:true}); }
    catch(error) {
      if(error.code !== 'ENOENT') throw error;
      if(state.offset) fail('FILE_CHANGED','The original checkpointed partial file is missing.');
      const handle = await open(partial,'wx+',0o600); opened = {handle,info:await handle.stat({bigint:true})};
    }
    const {handle,info} = opened; let activeReadId = state.readId, emptyRead = false;
    try {
      if(Number(info.size) < state.offset) fail('FILE_CHANGED','The partial file is shorter than its saved prefix.');
      const hash = await hashPrefix(handle,state.offset);
      if(hash.copy().digest('hex') !== state.prefixSha256) fail('FILE_CHANGED','The retained partial prefix differs from its checkpoint.');
      await handle.truncate(state.offset);
      while(state.offset < selected.bytes || selected.bytes === 0 && !emptyRead) {
        signal?.throwIfAborted(); context.lease.assertHeld();
        const args = {fileId:selected.fileId,expectedSha256:selected.sha256,offset:state.offset,limit:chunkSize,
          ...(activeReadId?{readId:activeReadId}:{})};
        let value;
        try { value = await client.fileRead(args,{signal,timeoutMs}); }
        catch(error) {
          if(!activeReadId || !String(error.code ?? '').endsWith('_READ_NOT_FOUND')) throw error;
          activeReadId = null; delete args.readId;
          value = await client.fileRead(args,{signal,timeoutMs});
        }
        checkedChunk(value,args);
        if(!sameFile({...value.file,fileId:value.fileId},selected)) fail('RANGE_CONFLICT','The native read metadata differs from the selected original descriptor.');
        const bytes = Buffer.from(value.data,'base64'); activeReadId = value.nextOffset === null ? null : value.readId;
        let written = 0;
        while(written < bytes.length) {
          const result = await handle.write(bytes,written,bytes.length-written,state.offset+written);
          if(!result.bytesWritten) fail('WRITE_FAILED','The private download did not advance.');
          written += result.bytesWritten;
        }
        hash.update(bytes); await handle.sync(); emptyRead = true;
        state = {...state,offset:state.offset+bytes.length,prefixSha256:hash.copy().digest('hex'),readId:activeReadId,updatedAt:new Date().toISOString()};
        await saveCheckpoint(context,state);
        await onProgress?.({fileId:selected.fileId,name:selected.name,status:'DOWNLOADING',bytes:state.offset,total:selected.bytes,sha256:selected.sha256});
      }
      if(hash.digest('hex') !== selected.sha256) fail('FILE_CHANGED','The full downloaded bytes differ from the original SHA256.');
      await handle.sync(); context.lease.assertHeld();
      // The original lease owns this private destination; an existing file must
      // be the exact original completion before the retained part is discarded.
      let exists = false;
      try { await lstat(destination); exists = true; } catch(error) { if(error.code !== 'ENOENT') throw error; }
      if(exists) { await verifiedLocal(destination,selected); await removeOwned(partial); }
      else await rename(partial,destination);
      await syncDirectory(context.root); await syncDirectory(context.stateDirectory);
      state = {...state,status:'COMPLETE',readId:null,offset:selected.bytes,prefixSha256:selected.sha256};
      await saveCheckpoint(context,state); await saveDescriptor(context,selected);
      return resultFor(context,state,resumedBytes);
    } catch(error) {
      Object.assign(error,{fileId:selected.fileId,sha256:selected.sha256,receivedBytes:state.offset,directory:context.root});
      throw error;
    } finally {
      await handle.close();
      if(activeReadId) await client.fileRelease({fileId:selected.fileId,readId:activeReadId},{timeoutMs:2000}).catch(()=>{});
    }
  });
}
async function saveDescriptor(context,file) {
  const path = join(context.root,DESCRIPTOR_NAME);
  try {
    const current = await localJSON(path);
    if(JSON.stringify(current) !== JSON.stringify(file)) fail('CHECKPOINT_CONFLICT','The existing local descriptor belongs to another file.');
  } catch(error) {
    if(error.code !== 'ENOENT') throw error;
    await writePrivate(path,file); await syncDirectory(context.root);
  }
}

/** Offline complete-file verification: no MCP client or source operation. */
export async function reopenWqxDownload({directory,expectedSha256} = {}) {
  if(expectedSha256 !== undefined) sha256(expectedSha256);
  return withDownload(directory,async context => {
    const state = await localJSON(join(context.stateDirectory,'checkpoint.json'));
    const file = fileIdentity(state.file); filename(state.filename);
    validCheckpoint(state,file,state.filename);
    if(state.status !== 'COMPLETE' || expectedSha256 !== undefined && file.sha256 !== expectedSha256)
      fail('CHECKPOINT_CONFLICT','Open the completed original download matching its expected SHA256.');
    const descriptor = await localJSON(join(context.root,DESCRIPTOR_NAME));
    if(!sameFile(descriptor,file)) fail('CHECKPOINT_CONFLICT','The retained descriptor differs from its original checkpoint.');
    await verifiedLocal(join(context.root,state.filename),file);
    return {...resultFor(context,state,file.bytes),status:'REOPENED'};
  });
}
