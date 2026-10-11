// MIT. Optional private case persistence for the original SF74 workspace.
import {constants} from 'node:fs';
import {mkdir, lstat, open, readdir, rename, unlink, link, readlink, readFile} from 'node:fs/promises';
import {resolve, join, isAbsolute, dirname} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {parseWorkspace, MAX_WORKSPACE_BYTES} from './workspace-file.mjs';
import {parseRuntime, MAX_RUNTIME_BYTES} from './runtime-support.mjs';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REVISION = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const CASE_STATUSES = Object.freeze(['new', 'in_progress', 'waiting', 'ready', 'closed', 'archived']);
const META_KEYS = ['merchant', 'owner', 'status', 'followUpOn', 'nextAction', 'notes'];
const CASE_LIMIT = 2000;
const fail = (code, detail, status = 422) => Object.assign(new Error(detail), {code, status});

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw fail('INVALID_CASE', `Invalid ${label}`);
  return value;
}
function text(value, maximum, label) {
  if (typeof value !== 'string' || encoder.encode(value).length > maximum ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      decoder.decode(encoder.encode(value)) !== value)
    throw fail('INVALID_CASE', `Invalid ${label}`);
  return value;
}
export function caseMetadata(value = {}) {
  record(value, META_KEYS, 'case metadata');
  const result = {
    merchant:text(value.merchant ?? '', 480, 'merchant'),
    owner:text(value.owner ?? '', 480, 'owner'),
    status:value.status ?? 'new',
    followUpOn:text(value.followUpOn ?? '', 10, 'follow-up date'),
    nextAction:text(value.nextAction ?? '', 2400, 'next action'),
    notes:text(value.notes ?? '', 16000, 'case notes'),
  };
  if (!CASE_STATUSES.includes(result.status)) throw fail('INVALID_CASE', 'Unknown work status');
  const date = result.followUpOn;
  if (date && (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date))
    throw fail('INVALID_CASE', 'Follow-up date must be an actual YYYY-MM-DD date');
  return result;
}
function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw fail('INVALID_CASE_ID', 'Invalid case identifier');
  return value;
}
function revision(value) {
  if (typeof value !== 'string' || !REVISION.test(value)) throw fail('INVALID_REVISION', 'Invalid case revision');
  return value;
}
async function directory(path, create = false) {
  if (create) await mkdir(path, {recursive:true, mode:0o700});
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('CASE_STORE_UNAVAILABLE', 'Case storage requires a real directory', 503);
  if (process.platform !== 'win32' && (stat.mode & 0o077))
    throw fail('CASE_STORE_UNAVAILABLE', 'Case storage directory must be private (mode 0700)', 503);
}
async function readBytes(path, limit) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit ||
        (process.platform !== 'win32' && (stat.mode & 0o077)))
      throw fail('CASE_STORAGE_INVALID', 'Stored case file has an invalid type, size or privacy mode', 503);
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > limit)
      throw fail('CASE_STORAGE_INVALID', 'Stored case changed during reading', 503);
    return bytes;
  } finally { await handle.close(); }
}
async function jsonFile(path, limit = 65000) {
  try { return JSON.parse(decoder.decode(await readBytes(path, limit))); }
  catch (error) {
    if (error.code === 'ENOENT' || error.status) throw error;
    throw fail('CASE_STORAGE_INVALID', 'Stored case metadata is unreadable', 503);
  }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
// Publish complete bytes exclusively. A stopped process may leave a private staging
// file, but never a truncated object at its permanent content address.
async function publishOnce(path, bytes) {
  const staging = join(dirname(path), '.staging-' + randomUUID());
  let handle;
  try {
    handle = await open(staging, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync();
    await handle.close(); handle = null;
    await link(staging, path);
  } finally {
    if (handle) await handle.close().catch(()=>{});
    await unlink(staging).catch(()=>{});
  }
}
async function sameBytes(path, bytes) {
  if (digest(await readBytes(path, bytes.length)) !== digest(bytes))
    throw fail('CASE_STORAGE_INVALID', 'An existing case version has different bytes', 503);
}
async function writeOnce(path, bytes) {
  try { await sameBytes(path, bytes); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await publishOnce(path, bytes); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await sameBytes(path, bytes);
  }
}

function privateRoot(path) {
  if (typeof path !== 'string' || !isAbsolute(path))
    throw fail('INVALID_CASE_DIRECTORY', 'Choose an absolute private case directory');
  return resolve(path);
}
async function writerHost() {
  const host = {hostname:hostname(), platform:process.platform, bootId:null, pidNamespace:null};
  if (process.platform === 'linux') {
    host.bootId = await readFile('/proc/sys/kernel/random/boot_id', 'utf8').then(value=>value.trim()).catch(()=>null);
    host.pidNamespace = await readlink('/proc/self/ns/pid').catch(()=>null);
  }
  return host;
}
function writerState(owner, host) {
  if (!owner.host || owner.host.hostname !== host.hostname || owner.host.platform !== host.platform)
    return 'foreign';
  // A PID from another Linux namespace cannot be checked in this process. A
  // different boot is deliberately not inferred to be local: storage may be mounted.
  if (host.platform === 'linux' && (!host.bootId || !host.pidNamespace ||
      owner.host.bootId !== host.bootId || owner.host.pidNamespace !== host.pidNamespace))
    return 'foreign';
  try { process.kill(owner.pid, 0); return 'active'; }
  catch (error) {
    if (error.code === 'ESRCH') return 'stopped';
    return 'unknown';
  }
}
async function currentWriter(root) {
  let name = '.writer.lock';
  for (let generation = 0; generation < 4096; generation++) {
    let bytes;
    try { bytes = await readBytes(join(root,name), 4096); }
    catch (error) {
      if (error.code === 'ENOENT') return {name, generation, owner:null};
      throw error;
    }
    let owner;
    try { owner = JSON.parse(decoder.decode(bytes)); }
    catch { throw fail('CASE_WRITER_INVALID', 'Writer ownership record is unreadable; preserve it for local recovery.', 503); }
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
        typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt)))
      throw fail('CASE_WRITER_INVALID', 'Writer ownership record is invalid; preserve it for local recovery.', 503);
    const ownerSha256 = digest(bytes), key = digest(name + '\0' + ownerSha256);
    const nextName = '.writer-' + key + '.lock';
    const recoveryPath = join(root, '.writer-recovery-' + key + '.json');
    const forward = {schema:'stellar-forge.merchant-case-writer-recovery.v1',
      previousLock:name, ownerSha256, nextLock:nextName};
    const forwardBytes = encoder.encode(JSON.stringify(forward) + '\n');
    try { await sameBytes(recoveryPath, forwardBytes); }
    catch (error) {
      if (error.code === 'ENOENT')
        return {name, generation, owner, ownerSha256, nextName, recoveryPath, forwardBytes};
      throw error;
    }
    name = nextName;
  }
  throw fail('CASE_WRITER_INVALID', 'The writer recovery chain is too long; preserve the directory for local recovery.', 503);
}

/** Read-only CLI status. Requires the same local host/PID namespace as the writer. */
export async function inspectCaseWriter(path) {
  const root = privateRoot(path); await directory(root);
  const current = await currentWriter(root);
  if (!current.owner) return {state:'idle', lock:current.name, recoveredLocks:current.generation};
  return {state:writerState(current.owner, await writerHost()), lock:current.name,
    lockSha256:current.ownerSha256, recoveredLocks:current.generation,
    writer:{pid:current.owner.pid, startedAt:current.owner.startedAt, host:current.owner.host ?? null}};
}

/**
 * Explicit CLI recovery after the recorded writer process has stopped. Never unlink
 * a stale lock: a deterministic, create-only forwarding record fences its generation.
 * Concurrent recoveries publish identical bytes and cannot touch a newer writer.
 */
export async function recoverCaseWriter(path) {
  const root = privateRoot(path); await directory(root);
  const current = await currentWriter(root);
  if (!current.owner) return {recovered:false, state:'idle', lock:current.name, recoveredLocks:current.generation};
  const state = writerState(current.owner, await writerHost());
  if (state !== 'stopped')
    throw fail('CASE_WRITER_' + state.toUpperCase(), state === 'active'
      ? 'The recorded writer process is still running. Stop that process before explicit recovery.'
      : 'Writer process ownership cannot be checked in this host and PID namespace. Preserve its lock.', 409);
  // If an operator changed the ownership file, this record still refers only to the
  // old bytes. Normal writers follow a marker only when its ownership digest matches.
  await writeOnce(current.recoveryPath, current.forwardBytes);
  await syncDirectory(root);
  return {recovered:true, previousLock:current.name, previousWriterPid:current.owner.pid,
    previousLockSha256:current.ownerSha256, lock:current.nextName, recoveredLocks:current.generation + 1};
}

async function acquireWriter(root) {
  const current = await currentWriter(root);
  if (current.owner) throw fail('CASE_STORE_BUSY', 'Another save owns the writer lock. Retry, or inspect the writer before explicit stopped-process recovery.', 409);
  const owner = {schema:'stellar-forge.merchant-case-writer.v1', token:randomUUID(),
    pid:process.pid, startedAt:new Date().toISOString(), host:await writerHost()};
  const bytes = encoder.encode(JSON.stringify(owner) + '\n'), path = join(root,current.name);
  try { await publishOnce(path, bytes); }
  catch (error) {
    if (error.code === 'EEXIST') throw fail('CASE_STORE_BUSY', 'Another save is in progress. Your draft is retained; retry this save.', 409);
    throw error;
  }
  return {path, bytes};
}
async function releaseWriter(lock) {
  await sameBytes(lock.path, lock.bytes);
  await unlink(lock.path);
}
function summary(value, rev) {
  return {id:value.id, revision:rev, previousRevision:value.previousRevision,
    name:value.name, createdAt:value.createdAt, updatedAt:value.updatedAt,
    metadata:value.metadata, inputs:value.inputs, sources:value.sources,
    workspaceBytes:value.workspaceBytes, runtimeSupport:value.runtimeSupport?.summary ?? null};
}

export async function openCaseStore(path) {
  const root = privateRoot(path);
  await directory(root, true);
  const casePath = id => join(root, identifier(id));

  async function head(id) {
    await directory(casePath(id));
    const result = await jsonFile(join(casePath(id), 'head.json'), 1024);
    if (result.schema !== 'stellar-forge.merchant-case-head.v1' || result.id !== id)
      throw fail('CASE_STORAGE_INVALID', 'Stored case identity is inconsistent', 503);
    return revision(result.revision);
  }
  async function version(id, rev) {
    const folder = casePath(id);
    await directory(folder); await directory(join(folder, 'versions'));
    const bytes = await readBytes(join(folder, 'versions', revision(rev) + '.json'), 65000);
    if (digest(bytes) !== rev) throw fail('CASE_STORAGE_INVALID', 'Stored case metadata bytes changed', 503);
    const result = JSON.parse(decoder.decode(bytes));
    if (result.schema !== 'stellar-forge.merchant-case-version.v1' || result.id !== id ||
        (result.previousRevision !== null && !REVISION.test(result.previousRevision)) ||
        !Number.isSafeInteger(result.workspaceBytes) || result.workspaceBytes < 1 || result.workspaceBytes > MAX_WORKSPACE_BYTES ||
        typeof result.name !== 'string' || !result.inputs || typeof result.inputs !== 'object' ||
        !Number.isFinite(Date.parse(result.createdAt)) || !Number.isFinite(Date.parse(result.updatedAt)))
      throw fail('CASE_STORAGE_INVALID', 'Stored case version is invalid', 503);
    revision(result.workspaceSha256);
    if(result.runtimeSupport!=null) {
      record(result.runtimeSupport,['sha256','bytes','summary'],'stored runtime support');
      revision(result.runtimeSupport.sha256);
      if(!Number.isSafeInteger(result.runtimeSupport.bytes)||result.runtimeSupport.bytes<1||
        result.runtimeSupport.bytes>MAX_RUNTIME_BYTES||!result.runtimeSupport.summary)
        throw fail('CASE_STORAGE_INVALID','Stored runtime support metadata is invalid',503);
    }
    caseMetadata(result.metadata);
    return result;
  }
  async function read(id, requestedRevision = null) {
    try {
      const currentRevision = await head(id);
      const selected = requestedRevision === null ? currentRevision : revision(requestedRevision);
      const stored = await version(id, selected);
      await directory(join(casePath(id), 'workspaces'));
      const bytes = await readBytes(join(casePath(id), 'workspaces', stored.workspaceSha256 + '.json'), MAX_WORKSPACE_BYTES);
      if (bytes.length !== stored.workspaceBytes || digest(bytes) !== stored.workspaceSha256)
        throw fail('CASE_STORAGE_INVALID', 'Saved workspace bytes changed', 503);
      const workspaceText = decoder.decode(bytes), workspace = await parseWorkspace(workspaceText);
      if (workspace.name !== stored.name || JSON.stringify(workspace.inputs) !== JSON.stringify(stored.inputs))
        throw fail('CASE_STORAGE_INVALID', 'Saved workspace and case summary disagree', 503);
      let supportText=null;
      if(stored.runtimeSupport) {
        await directory(join(casePath(id),'runtime'));
        const ref=stored.runtimeSupport;
        const runtimeBytes=await readBytes(join(casePath(id),'runtime',ref.sha256+'.json'),MAX_RUNTIME_BYTES);
        if(runtimeBytes.length!==ref.bytes||digest(runtimeBytes)!==ref.sha256)
          throw fail('CASE_STORAGE_INVALID','Saved runtime support bytes changed',503);
        supportText=decoder.decode(runtimeBytes);
        const support=parseRuntime(supportText);
        if(JSON.stringify(support.summary)!==JSON.stringify(ref.summary))
          throw fail('CASE_STORAGE_INVALID','Saved runtime support summary disagrees',503);
      }
      return {...summary(stored, selected), currentRevision, workspaceText, supportText};
    } catch (error) {
      if (error.code === 'ENOENT') throw fail('CASE_NOT_FOUND', 'Case or saved revision was not found', 404);
      throw error;
    }
  }
  async function list({q = '', status = '', dueOn = '', offset = 0, limit = 100} = {}) {
    text(q, 1000, 'search');
    if (status && !CASE_STATUSES.includes(status)) throw fail('INVALID_CASE_QUERY', 'Unknown work status');
    if (dueOn) caseMetadata({followUpOn:dueOn});
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw fail('INVALID_CASE_QUERY', 'Invalid case list page');
    const found = [], unavailable = [], needle = q.toLocaleLowerCase();
    for (const entry of await readdir(root, {withFileTypes:true})) {
      if (!ID.test(entry.name)) continue;
      try {
        const current = await head(entry.name), value = await version(entry.name, current);
        const row = summary(value, current);
        if (status ? row.metadata.status !== status : row.metadata.status === 'archived') continue;
        if (dueOn && (!row.metadata.followUpOn || row.metadata.followUpOn > dueOn || ['closed','archived'].includes(row.metadata.status))) continue;
        if (needle && ![row.name, row.metadata.merchant, row.metadata.owner, row.metadata.nextAction, ...Object.values(row.inputs)]
          .join(' ').toLocaleLowerCase().includes(needle)) continue;
        found.push(row);
      } catch { unavailable.push(entry.name); }
    }
    found.sort((a,b) => (a.metadata.followUpOn || '9999').localeCompare(b.metadata.followUpOn || '9999') ||
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return {enabled:true, cases:found.slice(offset, offset + limit), total:found.length,
      offset, limit, nextOffset:offset + limit < found.length ? offset + limit : null, unavailable};
  }
  async function history(id, {before = null, limit = 20} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail('INVALID_CASE_QUERY', 'Invalid history page');
    const currentRevision = await head(id);
    let next = before === null ? currentRevision : revision(before);
    const revisions = [], seen = new Set();
    while (next && revisions.length < limit) {
      if (seen.has(next)) throw fail('CASE_STORAGE_INVALID', 'Case history contains a cycle', 503);
      seen.add(next);
      const value = await version(id,next);
      revisions.push(summary(value,next)); next = value.previousRevision;
    }
    return {id, currentRevision, revisions, nextBefore:next};
  }
  async function save(input) {
    record(input, ['id','expectedRevision','workspaceText','metadata','supportText'], 'case save');
    const id = identifier(input.id);
    if (input.expectedRevision !== null) revision(input.expectedRevision);
    const metadata = caseMetadata(input.metadata);
    const workspace = await parseWorkspace(input.workspaceText);
    const workspaceBytes = encoder.encode(input.workspaceText), workspaceSha256 = digest(workspaceBytes);
    // Omitted preserves a support attachment for existing API clients; explicit
    // null removes it from this new version without erasing retained history.
    const hasSupport=Object.hasOwn(input,'supportText');
    const support=hasSupport&&input.supportText!==null?parseRuntime(input.supportText):null;
    const supportBytes=support?encoder.encode(input.supportText):null;
    const suppliedSupport=support?{sha256:digest(supportBytes),bytes:supportBytes.length,summary:support.summary}:null;
    const lock = await acquireWriter(root);
    let temp;
    try {
      let currentRevision = null, current = null;
      try { currentRevision = await head(id); current = await version(id,currentRevision); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const runtimeSupport=hasSupport?suppliedSupport:current?.runtimeSupport??null;
      // Retrying the same request after a lost HTTP response returns its existing revision.
      if (current && current.workspaceSha256 === workspaceSha256 && JSON.stringify(current.metadata) === JSON.stringify(metadata) &&
          JSON.stringify(current.runtimeSupport??null)===JSON.stringify(runtimeSupport) &&
          [currentRevision,current.previousRevision].includes(input.expectedRevision))
        return {case:summary(current,currentRevision), unchanged:true};
      if (input.expectedRevision !== currentRevision)
        throw Object.assign(fail('CASE_CONFLICT', 'A newer case version exists. Open it or save your draft as a separate case.', 409), {currentRevision});
      if (!current && (await readdir(root)).filter(name=>ID.test(name)).length >= CASE_LIMIT)
        throw fail('CASE_LIMIT_REACHED', `The case directory holds ${CASE_LIMIT} cases; select another private directory.`, 409);
      const folder = casePath(id);
      await directory(folder,true); await directory(join(folder,'versions'),true); await directory(join(folder,'workspaces'),true);
      const now = new Date().toISOString();
      const value = {schema:'stellar-forge.merchant-case-version.v1', id, previousRevision:currentRevision,
        createdAt:current?.createdAt || now, updatedAt:now, metadata, name:workspace.name, inputs:workspace.inputs,
        sources:workspace.summary, workspaceBytes:workspaceBytes.length, workspaceSha256, runtimeSupport};
      const versionBytes = encoder.encode(JSON.stringify(value) + '\n'), newRevision = digest(versionBytes);
      await writeOnce(join(folder,'workspaces',workspaceSha256 + '.json'),workspaceBytes);
      await syncDirectory(join(folder,'workspaces'));
      if(supportBytes) {
        await directory(join(folder,'runtime'),true);
        await writeOnce(join(folder,'runtime',runtimeSupport.sha256+'.json'),supportBytes);
        await syncDirectory(join(folder,'runtime'));
      }
      await writeOnce(join(folder,'versions',newRevision + '.json'),versionBytes);
      await syncDirectory(join(folder,'versions'));
      temp = join(folder,'.head-' + randomUUID());
      await writeOnce(temp,encoder.encode(JSON.stringify({schema:'stellar-forge.merchant-case-head.v1',id,revision:newRevision}) + '\n'));
      await rename(temp,join(folder,'head.json')); temp = null;
      await syncDirectory(folder); await syncDirectory(root);
      return {case:summary(value,newRevision), unchanged:false};
    } finally {
      if (temp) await unlink(temp).catch(()=>{});
      await releaseWriter(lock);
    }
  }
  return Object.freeze({list,read,save,history});
}
