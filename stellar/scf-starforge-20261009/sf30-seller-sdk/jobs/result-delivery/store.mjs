// MIT. Private, durable sender state under the original merchant identity.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { HASH, deliveryError, plain, validateManifest, validateAcknowledgment, merchantIdentity } from './wire.mjs';
const SCHEMA = 'stellar-forge.job-result-delivery-state.v1';
const SOURCE_SCHEMA = 'stellar-forge.job-result-delivery-source.v1';
const STATES = new Set(['QUEUED', 'SENDING', 'RETRY', 'DELIVERED', 'EXHAUSTED']);
const MAX_RECORD_BYTES = 262144, MAX_RECORDS = 100000;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const copy = value => structuredClone(value);
const fail = (code, status = 409) => { throw deliveryError(code, status); };
function checkSource(value) {
  const source = merchantIdentity(value);
  if (!HASH.test(source.configSha256 ?? '') || !HASH.test(source.applicationSha256 ?? '')) fail('JRD_MERCHANT_SOURCE_INVALID');
  let url; try { url = new URL(source.publicOrigin); } catch { fail('JRD_MERCHANT_SOURCE_INVALID'); }
  if (source.publicOrigin !== url.origin || !(url.protocol === 'https:' || url.protocol === 'http:' &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) fail('JRD_MERCHANT_SOURCE_INVALID');
  return source;
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || await realpath(path) !== path)
    fail('JRD_PRIVATE_DIRECTORY_REQUIRED');
}
async function readPrivate(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > MAX_RECORD_BYTES)
      fail('JRD_STATE_FILE_INVALID');
    const bytes = await file.readFile();
    if (bytes.length > MAX_RECORD_BYTES || bytes.length !== stat.size) fail('JRD_STATE_FILE_INVALID');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('JRD_STATE_JSON_INVALID'); }
  } finally { await file.close(); }
}
async function flushDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
function checkedRecord(row, source) {
  if (!plain(row) || row.schema !== SCHEMA || !HASH.test(row.id ?? '') ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || !STATES.has(row.state) ||
      !iso(row.createdAt) || !iso(row.updatedAt) || !Number.isSafeInteger(row.attemptCount) || row.attemptCount < 0 ||
      !Number.isSafeInteger(row.retryBase) || row.retryBase < 0 || row.retryBase > row.attemptCount ||
      !Array.isArray(row.attempts) || row.attempts.length > 64 || row.attempts.length > row.attemptCount ||
      !Array.isArray(row.history) || row.history.length > 64 ||
      !(row.nextAttemptAt === null || iso(row.nextAttemptAt))) fail('JRD_STATE_RECORD_INVALID');
  const manifest = validateManifest(row.manifest);
  if (manifest.deliveryId !== row.id || JSON.stringify(manifest.merchant) !== JSON.stringify(source)) fail('JRD_STATE_SOURCE_MISMATCH');
  for (const attempt of row.attempts) {
    if (!plain(attempt) || typeof attempt.id !== 'string' || !/^[a-f0-9-]{36}$/.test(attempt.id) ||
        !Number.isSafeInteger(attempt.number) || attempt.number < 1 || attempt.number > row.attemptCount ||
        !iso(attempt.startedAt) || !(attempt.finishedAt === null || iso(attempt.finishedAt)) ||
        !['SENDING', 'DELIVERED', 'RETRY', 'EXHAUSTED', 'INTERRUPTED'].includes(attempt.state))
      fail('JRD_STATE_ATTEMPT_INVALID');
  }
  if (row.attemptCount && (!row.attempts.length || row.attempts.at(-1).number !== row.attemptCount))
    fail('JRD_STATE_ATTEMPT_INVALID');
  if (row.state === 'SENDING' && (row.attempts.at(-1)?.state !== 'SENDING' || row.attempts.at(-1)?.finishedAt !== null))
    fail('JRD_STATE_ATTEMPT_INVALID');
  if (row.state === 'RETRY' && !iso(row.nextAttemptAt) || row.state !== 'RETRY' && row.nextAttemptAt !== null)
    fail('JRD_STATE_RETRY_INVALID');
  if (row.state === 'DELIVERED') validateAcknowledgment(row.receipt, manifest);
  else if (row.receipt !== null) fail('JRD_STATE_RECEIPT_INVALID');
  return { ...copy(row), manifest };
}
/** One Linux lease owns the durable queue. Result bytes remain in the original completed job. */
export async function openDeliveryStore(directory, sourceIdentity, { clock = Date.now } = {}) {
  const source = checkSource(sourceIdentity);
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('JRD_ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  const lease = await acquireStateLease(directory), recordsPath = join(directory, 'records');
  let closed = false, accepting = true, closingPromise, fault = null, tail = Promise.resolve();
  const rows = new Map();
  const now = () => new Date(clock()).toISOString();
  const assertHeld = () => { if (closed) fail('JRD_STORE_CLOSED', 503); lease.assertHeld(); };
  const assertOpen = () => { assertHeld(); if (!accepting) fail('JRD_STORE_CLOSING', 503); };
  async function atomic(path, value) {
    assertHeld();
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    if (bytes.length > MAX_RECORD_BYTES) fail('JRD_STATE_RECORD_TOO_LARGE');
    const temporary = join(dirname(path), '.jrd-' + randomUUID() + '.tmp');
    let file;
    try {
      file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
      assertHeld(); await rename(temporary, path); await flushDirectory(dirname(path));
    } finally {
      if (file) await file.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function save(value) {
    const row = checkedRecord(value, source), path = join(recordsPath, row.id + '.json');
    try { await atomic(path, row); rows.set(row.id, row); fault = null; return copy(row); }
    catch (error) {
      // A rename can commit before directory fsync fails. Retain the named state before another operation.
      try { rows.set(row.id, checkedRecord(await readPrivate(path), source)); } catch {}
      fault = 'JRD_STORAGE_UNAVAILABLE';
      throw Object.assign(deliveryError(fault, 503), { cause: error });
    }
  }
  function serial(operation) {
    assertOpen();
    const result = tail.then(() => { assertHeld(); return operation(); });
    tail = result.catch(() => {}); return result;
  }
  function current(id) {
    assertHeld();
    if (typeof id !== 'string' || !HASH.test(id)) fail('JRD_DELIVERY_ID_INVALID', 400);
    if (!rows.has(id)) fail('JRD_DELIVERY_NOT_FOUND', 404);
    return copy(rows.get(id));
  }
  function changed(row, action, detail = {}) {
    if (!Number.isSafeInteger(row.revision + 1)) fail('JRD_REVISION_EXHAUSTED');
    row.revision++; row.updatedAt = now();
    row.history = [...row.history.slice(-63), { at: row.updatedAt, action, ...detail }];
    return row;
  }
  try {
    await privateDirectory(recordsPath);
    const names = await readdir(recordsPath);
    if (names.filter(name => name.endsWith('.json')).length > MAX_RECORDS) fail('JRD_STORE_CAPACITY_REACHED');
    const sourcePath = join(directory, 'source.json');
    try {
      const retained = await readPrivate(sourcePath);
      if (retained.schema !== SOURCE_SCHEMA || !iso(retained.createdAt) ||
          JSON.stringify(checkSource(retained.merchant)) !== JSON.stringify(source)) fail('JRD_STORE_SOURCE_MISMATCH');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (names.some(name => name.endsWith('.json'))) fail('JRD_STORE_SOURCE_REQUIRED');
      await atomic(sourcePath, { schema: SOURCE_SCHEMA, merchant: source, createdAt: now() });
    }
    for (const name of names) {
      if (/^\.jrd-[a-f0-9-]{36}\.tmp$/.test(name)) {
        const path = join(recordsPath, name), stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077) fail('JRD_STATE_FILE_INVALID');
        await unlink(path); continue;
      }
      if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('JRD_STATE_FILE_INVALID');
      const row = checkedRecord(await readPrivate(join(recordsPath, name)), source);
      if (name !== row.id + '.json') fail('JRD_STATE_FILE_INVALID');
      rows.set(row.id, row);
    }
    for (const value of rows.values()) {
      if (value.state !== 'SENDING') continue;
      const row = copy(value); row.state = 'RETRY'; row.nextAttemptAt = now(); row.error = 'JRD_SENDER_INTERRUPTED';
      Object.assign(row.attempts.at(-1), { state: 'INTERRUPTED', finishedAt: now(), code: row.error });
      await save(changed(row, 'sender-recovered'));
    }
  } catch (error) { closed = true; accepting = false; await lease.close(); throw error; }
  return {
    directory, source: Object.freeze(copy(source)),
    get fault() { return fault; },
    rows() { assertOpen(); return [...rows.values()].map(copy); },
    get(id) { assertOpen(); return current(id); },
    enqueue(manifest) {
      return serial(async () => {
        const value = validateManifest(manifest);
        if (JSON.stringify(value.merchant) !== JSON.stringify(source)) fail('JRD_STORE_SOURCE_MISMATCH');
        const existing = rows.get(value.deliveryId);
        if (existing) {
          // First enqueue freezes completion metadata, even if the job label changes later.
          value.job.completedAt = existing.manifest.job.completedAt;
          if (JSON.stringify(value) !== JSON.stringify(existing.manifest)) fail('JRD_DELIVERY_IDENTITY_CONFLICT');
          return { created: false, row: copy(existing) };
        }
        if (rows.size >= MAX_RECORDS) fail('JRD_STORE_CAPACITY_REACHED');
        const at = now(), row = { schema: SCHEMA, id: value.deliveryId, manifest: value, state: 'QUEUED',
          revision: 1, createdAt: at, updatedAt: at, attemptCount: 0, retryBase: 0, attempts: [],
          receipt: null, nextAttemptAt: null, error: null, history: [{ at, action: 'queued' }] };
        return { created: true, row: await save(row) };
      });
    },
    begin(id, { attemptLimit = 8 } = {}) {
      return serial(async () => {
        if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 100)
          fail('JRD_ATTEMPT_LIMIT_INVALID', 400);
        const row = current(id);
        if (!['QUEUED', 'RETRY'].includes(row.state)) fail('JRD_DELIVERY_NOT_SENDABLE');
        if (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > clock()) fail('JRD_RETRY_NOT_DUE');
        // Read the budget in the same serialized operation as begin; an operator may have just requeued this row.
        if (row.attemptCount - row.retryBase >= attemptLimit) {
          row.state = 'EXHAUSTED'; row.nextAttemptAt = null; row.error = 'JRD_ATTEMPT_LIMIT_REACHED';
          return save(changed(row, 'attempt-limit-reached'));
        }
        if (!Number.isSafeInteger(row.attemptCount + 1)) fail('JRD_ATTEMPT_COUNT_EXHAUSTED');
        row.state = 'SENDING'; row.error = null; row.nextAttemptAt = null; row.attemptCount++;
        const attempt = { id: randomUUID(), number: row.attemptCount, state: 'SENDING', startedAt: now(),
          finishedAt: null, httpStatus: null, code: null };
        row.attempts = [...row.attempts.slice(-63), attempt];
        return save(changed(row, 'send-started', { attemptId: attempt.id }));
      });
    },
    finish(id, attemptId, { receipt = null, code = null, httpStatus = null, nextAttemptAt = null, exhausted = false } = {}) {
      return serial(async () => {
        const row = current(id), attempt = row.attempts.at(-1);
        if (row.state !== 'SENDING' || !attempt || attempt.id !== attemptId) fail('JRD_ATTEMPT_CONFLICT');
        if (receipt) {
          row.receipt = validateAcknowledgment(receipt, row.manifest); row.state = 'DELIVERED'; row.error = null;
        } else {
          if (typeof code !== 'string' || !/^JRD_[A-Z_]+$/.test(code) || !exhausted && !iso(nextAttemptAt))
            fail('JRD_SEND_OUTCOME_INVALID', 400);
          row.state = exhausted ? 'EXHAUSTED' : 'RETRY'; row.error = code;
        }
        row.nextAttemptAt = row.state === 'RETRY' ? nextAttemptAt : null;
        Object.assign(attempt, { state: row.state, finishedAt: now(), code: row.error,
          httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null });
        return save(changed(row, 'send-finished', { attemptId }));
      });
    },
    requeue({ id, expectedRevision, reason } = {}) {
      return serial(async () => {
        const row = current(id);
        if (!Number.isSafeInteger(expectedRevision) || row.revision !== expectedRevision) fail('JRD_REVISION_CONFLICT');
        if (!['RETRY', 'EXHAUSTED'].includes(row.state)) fail('JRD_DELIVERY_NOT_RETRYABLE');
        if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))
          fail('JRD_RETRY_REASON_REQUIRED', 400);
        row.state = 'QUEUED'; row.nextAttemptAt = null; row.error = null; row.retryBase = row.attemptCount;
        return save(changed(row, 'operator-requeued', { reason: reason.trim() }));
      });
    },
    exhaust(id, code = 'JRD_ATTEMPT_LIMIT_REACHED') {
      return serial(async () => {
        const row = current(id);
        if (!['QUEUED', 'RETRY'].includes(row.state)) fail('JRD_DELIVERY_NOT_SENDABLE');
        if (!/^JRD_[A-Z_]+$/.test(code)) fail('JRD_SEND_OUTCOME_INVALID', 400);
        row.state = 'EXHAUSTED'; row.nextAttemptAt = null; row.error = code;
        return save(changed(row, 'attempt-limit-reached'));
      });
    },
    close() {
      if (!closingPromise) {
        accepting = false;
        closingPromise = (async () => { await tail; closed = true; await lease.close(); })();
      }
      return closingPromise;
    },
  };
}
