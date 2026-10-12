// MIT. Resume the original SF101 entitlement through the original SF31 writer.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { need, privatePath, sha, validateHandoff } from './checkout-config.mjs';

const SCHEMA = 'stellar-forge.sf101.file-transfer.v1';
const CHUNK = 64 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const states = new Set(['NEW', 'PREPARING', 'TRANSFERRING', 'INTERRUPTED', 'REJECTED', 'COMPLETE']);
const privateRegular = info => info.isFile() && (info.mode & 0o077) === 0 && info.nlink === 1;
const codeOf = error => /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'FILE_TRANSFER_INTERRUPTED';

export async function canonicalDeliveryPath(destination) {
  privatePath(destination);
  need(!['.', '..'].includes(basename(destination)), 'PRIVATE_DELIVERY_OUTPUT_REQUIRED');
  return join(await realpath(dirname(destination)), basename(destination));
}

async function privateJson(path, optional = false) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | NOFOLLOW); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await handle.stat();
    need(privateRegular(info) && info.size <= 32768, 'PRIVATE_TRANSFER_RECORD_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length <= 32768, 'TRANSFER_RECORD_TOO_LARGE');
    return {value: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), info};
  } finally { await handle.close(); }
}

function partialPath(path, destination) {
  need(typeof path === 'string' && path !== destination && dirname(path) === dirname(destination) &&
    /^\.x402-response-[a-f0-9-]{36}\.partial$/.test(basename(path)), 'TRANSFER_PARTIAL_PATH_INVALID');
  return path;
}

async function inspectPartial(path, destination, maxBytes, expected = null, finalFile = false) {
  if (!finalFile) partialPath(path, destination);
  const regular = info => finalFile ? info.isFile() &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0) : privateRegular(info);
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const before = await handle.stat();
    need(regular(before) && before.size >= 0 && before.size <= maxBytes, 'TRANSFER_PARTIAL_FILE_INVALID');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(CHUNK);
    let position = 0;
    while (position < before.size) {
      const {bytesRead} = await handle.read(buffer, 0, Math.min(CHUNK, before.size - position), position);
      need(bytesRead > 0, 'TRANSFER_PARTIAL_CHANGED');
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat(), named = await lstat(path);
    need(regular(after) && regular(named) && before.dev === named.dev &&
      before.ino === named.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'TRANSFER_PARTIAL_CHANGED');
    const result = {path, bytes:position, sha256:hash.digest('hex'), dev:String(before.dev), ino:String(before.ino)};
    if (expected) need(['path', 'bytes', 'sha256', 'dev', 'ino'].every(key => result[key] === expected[key]),
      'TRANSFER_PARTIAL_CHANGED');
    return result;
  } finally { await handle.close(); }
}

export async function verifyExistingDeliveryFile(destination, expected) {
  let found;
  try { found = await inspectPartial(destination, destination, expected.bytes, null, true); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Object.assign(new Error('EXISTING_DELIVERY_FILE_MISMATCH'), {code:'EXISTING_DELIVERY_FILE_MISMATCH', cause:error});
  }
  need(found.bytes === expected.bytes && found.sha256 === expected.sha256, 'EXISTING_DELIVERY_FILE_MISMATCH');
  return found;
}

async function removePartial(partial, destination) {
  if (!partial) return;
  partialPath(partial.path, destination);
  let info;
  try { info = await lstat(partial.path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  need(privateRegular(info) && String(info.dev) === partial.dev && String(info.ino) === partial.ino,
    'TRANSFER_PARTIAL_CHANGED');
  await unlink(partial.path);
}

async function openSession(raw, inputDestination) {
  const handoff = validateHandoff(raw), destination = await canonicalDeliveryPath(inputDestination);
  need(process.platform === 'linux', 'RESUMABLE_TRANSFER_LINUX_FLOCK_REQUIRED');
  const directory = dirname(destination), statePath = destination + '.sf101-transfer.json';
  const leasePath = join(directory, '.' + basename(destination) + '.sf101-transfer.lock');
  const reservationPath = join(directory, '.' + basename(destination) + '.x402-download.lock');
  const lease = await open(leasePath, constants.O_CREAT | constants.O_RDWR | NOFOLLOW, 0o600);
  let closed = false, state;
  async function assertLease() {
    need(!closed, 'FILE_TRANSFER_CLOSED');
    const [owned, named] = await Promise.all([lease.stat(), lstat(leasePath)]);
    need(privateRegular(owned) && privateRegular(named) && owned.dev === named.dev && owned.ino === named.ino,
      'FILE_TRANSFER_LEASE_CHANGED');
  }
  async function persist(changes) {
    await assertLease();
    const next = {...state, ...changes, revision:state.revision + 1, updatedAt:new Date().toISOString()};
    const temp = join(directory, '.sf101-transfer-' + randomUUID() + '.tmp');
    let file;
    try {
      file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
      await file.writeFile(JSON.stringify(next) + '\n'); await file.sync(); await file.close(); file = null;
      await assertLease(); await rename(temp, statePath); state = next;
      const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
    } finally { await file?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
    return state;
  }
  function validatePartial(value) {
    if (value === null) return;
    need(value && typeof value === 'object', 'TRANSFER_RECORD_INVALID');
    partialPath(value.path, destination);
    need(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= handoff.file.bytes &&
      /^[a-f0-9]{64}$/.test(value.sha256 ?? '') && /^\d+$/.test(value.dev ?? '') &&
      /^\d+$/.test(value.ino ?? ''), 'TRANSFER_RECORD_INVALID');
  }
  try {
    await assertLease();
    const acquired = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      {stdio:['ignore', 'pipe', 'pipe', lease.fd], timeout:10000});
    need(!acquired.error && acquired.status === 0,
      acquired.status === 73 ? 'FILE_TRANSFER_ACTIVE' : 'RESUMABLE_TRANSFER_LINUX_FLOCK_REQUIRED');
    const record = await privateJson(statePath, true);
    state = record?.value ?? {schema:SCHEMA, handoffSha256:sha(JSON.stringify(handoff)), destination,
      expected:handoff.file, etag:'"sha256-' + handoff.file.sha256 + '"', status:'NEW', revision:0,
      attempts:0, partial:null, active:null, reservationTag:null};
    need(state?.schema === SCHEMA && state.handoffSha256 === sha(JSON.stringify(handoff)) &&
      state.destination === destination && state.expected?.bytes === handoff.file.bytes &&
      state.expected?.sha256 === handoff.file.sha256 && state.etag === '"sha256-' + handoff.file.sha256 + '"' &&
      states.has(state.status) && Number.isSafeInteger(state.revision) && state.revision >= 0 &&
      Number.isSafeInteger(state.attempts) && state.attempts >= 0, 'TRANSFER_HANDOFF_MISMATCH');
    validatePartial(state.partial);
    if (state.active) partialPath(state.active.path, destination);
    if (state.discarded) validatePartial(state.discarded);
    if (state.reservationTag !== null) need(/^sf101-[a-f0-9-]{36}$/.test(state.reservationTag ?? ''), 'TRANSFER_RECORD_INVALID');
    if (state.discarded) {
      await removePartial(state.discarded, destination);
      await persist({discarded:null});
    }
    const completed = await verifyExistingDeliveryFile(destination, handoff.file);
    if (!completed && state.status === 'COMPLETE') await persist({status:'NEW', completedFile:null,
      lastError:'PREVIOUS_DELIVERY_FILE_MISSING'});
    if (completed && state.status !== 'COMPLETE') {
      const original = await privateJson(reservationPath, true);
      if (original && state.reservationTag && original.value.reservationTag === state.reservationTag &&
          original.value.destination === destination && (!state.active || original.value.partialPath === state.active.path)) {
        const activePath = partialPath(original.value.partialPath, destination);
        let named;
        try { named = await lstat(activePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (named && named.isFile() && (named.mode & 0o077) === 0 &&
            String(named.dev) === completed.dev && String(named.ino) === completed.ino) await unlink(activePath);
        const reservationInfo = await lstat(reservationPath);
        need(reservationInfo.dev === original.info.dev && reservationInfo.ino === original.info.ino,
          'TRANSFER_RESERVATION_CHANGED');
        await unlink(reservationPath);
      }
      await removePartial(state.partial, destination);
      await persist({status:'COMPLETE', partial:null, active:null, reservationTag:null, lastError:null,
        completedFile:{path:destination, bytes:completed.bytes, sha256:completed.sha256}, lastMode:'EXISTING_LOCAL_FILE'});
    }

    // A live owner holds the retained file-description flock even in another PID
    // namespace. Only an exact original SF31 reservation from this generation is
    // reclaimed; a legacy/unrelated writer's reservation is never removed.
    if (['PREPARING', 'TRANSFERRING'].includes(state.status)) {
      const reservation = await privateJson(reservationPath, true);
      let activePath = state.active?.path;
      if (reservation) {
        const original = reservation.value;
        need(original.destination === destination && original.reservationTag === state.reservationTag &&
          (!activePath || original.partialPath === activePath), 'TRANSFER_RESERVATION_UNRECOGNIZED');
        activePath = partialPath(original.partialPath, destination);
        const named = await lstat(reservationPath);
        need(named.dev === reservation.info.dev && named.ino === reservation.info.ino,
          'TRANSFER_RESERVATION_CHANGED');
        await unlink(reservationPath);
      }
      let active = null;
      if (activePath) {
        try { active = await inspectPartial(activePath, destination, handoff.file.bytes); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      let previous = state.partial;
      if (previous) previous = await inspectPartial(previous.path, destination, handoff.file.bytes, previous);
      const retained = active && (!previous || active.bytes >= previous.bytes) ? active : previous;
      const other = retained === active ? previous : active;
      const rejected = retained?.bytes === handoff.file.bytes && retained.sha256 !== handoff.file.sha256;
      await persist({status:rejected ? 'REJECTED' : 'INTERRUPTED', partial:retained,
        active:null, reservationTag:null, lastError:'PREVIOUS_PROCESS_INTERRUPTED'});
      if (other && other.path !== retained?.path) await removePartial(other, destination);
    }
  } catch (error) { closed = true; await lease.close(); throw error; }

  return {
    handoff, destination, statePath, get state() { return state; }, persist, assertLease,
    async close() { if (!closed) { closed = true; await lease.close(); } },
  };
}

function validateResponse(response, expected, etag, offset) {
  need(response instanceof Response && response.body && !response.bodyUsed && !response.body.locked,
    'ENTITLEMENT_NOT_AVAILABLE');
  if (response.status === 412) need(false, 'DELIVERY_SOURCE_CHANGED');
  need(response.status === 200 || (offset > 0 && response.status === 206), 'ENTITLEMENT_NOT_AVAILABLE');
  const encoding = response.headers.get('content-encoding');
  need(encoding === null || encoding.trim().toLowerCase() === 'identity', 'DELIVERY_ENCODING_CHANGED');
  const responseTag = response.headers.get('etag');
  if (responseTag !== null) need(responseTag === etag, 'DELIVERY_SOURCE_CHANGED');
  const resumed = response.status === 206 ? offset : 0;
  if (resumed) {
    need(responseTag === etag && response.headers.get('content-range') ===
      'bytes ' + resumed + '-' + (expected.bytes - 1) + '/' + expected.bytes, 'DELIVERY_RANGE_MISMATCH');
  } else need(response.headers.get('content-range') === null, 'DELIVERY_RANGE_MISMATCH');
  const length = response.headers.get('content-length');
  if (length !== null) need(/^\d+$/.test(length) && Number(length) === expected.bytes - resumed,
    'DELIVERY_LENGTH_MISMATCH');
  return resumed;
}

async function composedResponse(prefix, response, totalBytes) {
  let file = null, remote = null, offset = 0, closed = false;
  if (prefix?.bytes) file = await open(prefix.path, constants.O_RDONLY | NOFOLLOW);
  if (response?.body) remote = response.body.getReader();
  async function close() {
    if (closed) return;
    closed = true;
    await file?.close().catch(() => {}); file = null;
    if (remote) { try { remote.releaseLock(); } catch {} }
  }
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (file && offset < prefix.bytes) {
          const chunk = Buffer.allocUnsafe(Math.min(CHUNK, prefix.bytes - offset));
          const {bytesRead} = await file.read(chunk, 0, chunk.length, offset);
          need(bytesRead > 0, 'TRANSFER_PARTIAL_CHANGED');
          offset += bytesRead; controller.enqueue(chunk.subarray(0, bytesRead)); return;
        }
        if (file) { await file.close(); file = null; }
        if (remote) {
          const next = await remote.read();
          if (!next.done) { controller.enqueue(next.value); return; }
        }
        await close(); controller.close();
      } catch (error) { await close(); controller.error(error); }
    },
    async cancel(reason) {
      if (remote) { try { void remote.cancel(reason).catch(() => {}); } catch {} }
      await close();
    },
  });
  const headers = new Headers(response?.headers);
  headers.delete('content-range'); headers.set('content-length', String(totalBytes));
  return new Response(body, {status:200, headers});
}

/** Owns transfer recovery only. fetchDelivery must use the original exact-path
 * entitlement transport; no buyer, signer, ledger or payment operation is called. */
export async function resumeEntitledFile({handoff, destination, fetchDelivery, signal, timeoutMs = 30000}) {
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'DELIVERY_TIMEOUT_INVALID');
  need(signal === undefined || signal instanceof AbortSignal, 'DELIVERY_SIGNAL_INVALID');
  const session = await openSession(handoff, destination);
  let writer, response, previous = session.state.partial, httpRequests = 0, timer = null;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  try {
    need(session.state.status !== 'REJECTED', 'TRANSFER_RESTART_REQUIRED');
    if (previous) previous = await inspectPartial(previous.path, session.destination, session.handoff.file.bytes, previous);
    const localComplete = previous?.bytes === session.handoff.file.bytes;
    if (localComplete) need(previous.sha256 === session.handoff.file.sha256, 'TRANSFER_RESTART_REQUIRED');
    if (controller.signal.aborted) throw controller.signal.reason;
    const reservationTag = 'sf101-' + randomUUID();
    await session.persist({status:'PREPARING', reservationTag, active:null, lastError:null});
    writer = await prepareBuyerResponseFile({destination:session.destination, maxBytes:session.handoff.file.bytes,
      expectedBytes:session.handoff.file.bytes, expectedSha256:session.handoff.file.sha256, timeoutMs, reservationTag});
    await session.persist({status:'TRANSFERRING', active:{path:writer.partialPath}, attempts:session.state.attempts + 1});
    let resumedBytes = localComplete ? previous.bytes : 0, mode = localComplete ? 'LOCAL_PARTIAL' : 'FULL';
    timer = setTimeout(() => controller.abort(Object.assign(new Error('DELIVERY_TIMEOUT'), {code:'DELIVERY_TIMEOUT'})), timeoutMs);
    if (!localComplete) {
      const headers = {};
      if (previous?.bytes) {
        headers.range = 'bytes=' + previous.bytes + '-';
        headers['if-range'] = session.state.etag;
        headers['if-match'] = session.state.etag;
      }
      httpRequests = 1;
      response = await fetchDelivery(headers, controller.signal);
      resumedBytes = validateResponse(response, session.handoff.file, session.state.etag, previous?.bytes ?? 0);
      mode = resumedBytes ? 'RESUMED' : previous?.bytes ? 'RESTARTED_FULL_RESPONSE' : 'FULL';
    }
    const composed = await composedResponse(resumedBytes ? previous : null, response, session.handoff.file.bytes);
    const saved = await writer.save({response:composed}, {signal:controller.signal});
    clearTimeout(timer);
    await session.persist({status:'COMPLETE', partial:null, active:null, reservationTag:null, lastError:null,
      completedFile:{path:saved.path, bytes:saved.bytes, sha256:saved.sha256}, lastMode:mode});
    const cleanupWarnings = [...saved.cleanupWarnings];
    try { await removePartial(previous, session.destination); }
    catch (error) { cleanupWarnings.push({path:previous?.path, code:codeOf(error)}); }
    return {saved:{...saved, cleanupWarnings}, httpRequests, transfer:{mode, resumedBytes,
      receivedBytes:saved.bytes - resumedBytes, statePath:session.statePath}};
  } catch (error) {
    if (!(error instanceof Error)) error = Object.assign(new Error('FILE_TRANSFER_INTERRUPTED'), {code:'FILE_TRANSFER_INTERRUPTED'});
    // Save the exact partial produced by SF31, then retire the older checkpoint.
    // If persistence fails, the active generation stays recoverable next launch.
    await writer?.abort().catch(() => {});
    let retained = previous;
    if (typeof error.partialPath === 'string') {
      const candidate = await inspectPartial(error.partialPath, session.destination, session.handoff.file.bytes);
      if (!retained || candidate.bytes >= retained.bytes) retained = candidate;
    }
    const rejected = retained?.bytes === session.handoff.file.bytes && retained.sha256 !== session.handoff.file.sha256;
    try {
      await session.persist({status:rejected ? 'REJECTED' : 'INTERRUPTED', partial:retained,
        active:null, reservationTag:null, lastError:codeOf(error)});
      if (previous && retained?.path !== previous.path) await removePartial(previous, session.destination);
      if (error.partialPath && retained?.path !== error.partialPath) {
        const unused = await inspectPartial(error.partialPath, session.destination, session.handoff.file.bytes);
        await removePartial(unused, session.destination);
      }
    } catch (checkpointError) {
      error.checkpointError = codeOf(checkpointError);
    }
    error.transferState = session.statePath;
    error.partialPath = retained?.path ?? error.partialPath ?? null;
    error.retainedBytes = retained?.bytes ?? 0;
    error.resumable = Boolean(retained && !rejected);
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (response?.body && !response.body.locked && !response.bodyUsed) {
      try { void response.body.cancel().catch(() => {}); } catch {}
    }
    await writer?.abort().catch(() => {});
    await session.close();
  }
}

export async function inspectFileTransfer({handoff, destination}) {
  const session = await openSession(handoff, destination);
  try {
    const partial = session.state.partial ? await inspectPartial(session.state.partial.path,
      session.destination, session.handoff.file.bytes, session.state.partial) : null;
    return {status:session.state.status, destination:session.destination, statePath:session.statePath,
      retainedBytes:partial?.bytes ?? 0, expectedBytes:session.handoff.file.bytes,
      attempts:session.state.attempts, resumable:partial !== null && session.state.status !== 'REJECTED',
      ...(partial ? {partialPath:partial.path} : {}),
      ...(session.state.lastError ? {lastError:session.state.lastError} : {})};
  } finally { await session.close(); }
}

export async function resetFileTransfer({handoff, destination}) {
  const session = await openSession(handoff, destination);
  try {
    let final;
    try { final = await lstat(session.destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(!final, 'DELIVERY_FILE_ALREADY_EXISTS');
    const previous = session.state.partial;
    // Only this recorded original writer file is eligible; final output is untouched.
    await session.persist({status:'NEW', partial:null, active:null, reservationTag:null, lastError:null, discarded:previous});
    await removePartial(previous, session.destination);
    await session.persist({discarded:null});
    return {status:'FILE_TRANSFER_RESET', destination:session.destination, statePath:session.statePath,
      removedPartialBytes:previous?.bytes ?? 0};
  } finally { await session.close(); }
}

