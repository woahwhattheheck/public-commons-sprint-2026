// MIT. Private job records and immutable results under the original Linux fleet lease.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, unlink, link } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { canonical, digest, plain, JOB_ID, HASH, jobError } from './config.mjs';

const RECORD_SCHEMA = 'stellar-forge.application-job.v1';
const MAX_RECORD = 2097152;
const STATES = new Set(['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING',
  'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const PENDING = new Set(['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING']);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fail = (code, status = 503) => { throw jobError(code, status); };

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(path) !== path)
    fail('JOB_PRIVATE_DIRECTORY_REQUIRED');
}
async function flushDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readPrivate(path, limit) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > limit) fail('JOB_PRIVATE_FILE_INVALID');
    const body = await handle.readFile();
    if (body.length > limit) fail('JOB_PRIVATE_FILE_TOO_LARGE');
    return body;
  } finally { await handle.close(); }
}
function validateRow(row, identity) {
  if (!plain(row) || row.schema !== RECORD_SCHEMA || !JOB_ID.test(row.id ?? '') ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || !STATES.has(row.state) ||
      !instant(row.createdAt) || !instant(row.updatedAt) || typeof row.functionId !== 'string' ||
      !HASH.test(row.claimTokenHash ?? '') || !HASH.test(row.inputSha256 ?? '') || !plain(row.input) ||
      digest(canonical(row.input)) !== row.inputSha256 || !plain(row.source) ||
      canonical(row.source) !== canonical(identity) || !plain(row.payment) ||
      !Array.isArray(row.attempts) || row.attempts.length > 100 || !Array.isArray(row.history) || row.history.length > 512)
    fail('JOB_RECORD_INVALID');
  if (row.settlement !== null && (!plain(row.settlement) || !HASH.test(row.settlement.id ?? '') ||
      row.settlement.orderReference !== row.id)) fail('JOB_SETTLEMENT_RECORD_INVALID');
  if (row.result !== null && (!plain(row.result) || !HASH.test(row.result.sha256 ?? '') ||
      !Number.isSafeInteger(row.result.bytes) || row.result.bytes < 0 || row.result.bytes > 67108864 ||
      !/^[a-f0-9]{64}\.bin$/.test(row.result.file ?? '') || row.result.file !== row.result.sha256 + '.bin'))
    fail('JOB_RESULT_RECORD_INVALID');
  return row;
}

export async function openJobStore(directory, source) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('JOB_PRIVATE_DIRECTORY_REQUIRED', 400);
  await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  let closed = false, closing = false, tail = Promise.resolve(), fault = null;
  const recordDirectory = join(directory, 'records'), resultDirectory = join(directory, 'results');
  const rows = new Map();
  function assertOpen() {
    if (closed || closing) fail('JOB_STORE_CLOSED');
    lease.assertHeld();
  }
  async function atomic(path, bytes) {
    assertOpen();
    const parent = path.slice(0, path.lastIndexOf('/'));
    const temp = join(parent, '.job-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      assertOpen(); await rename(temp, path); await flushDirectory(parent);
    } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
  }
  // A crash can leave the complete temporary file linked to its immutable name.
  // Only this store's private UUID temporaries are retired under the original lease.
  async function recoverResultTemps() {
    let changed = false;
    for (const name of await readdir(resultDirectory)) {
      if (!/^\.result-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(name)) continue;
      assertOpen();
      const path = join(resultDirectory, name);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || ![1, 2].includes(info.nlink) || info.mode & 0o077 || info.size > 67108864)
          fail('JOB_RESULT_TEMP_INVALID');
        if (info.nlink === 2) {
          const body = await handle.readFile();
          if (body.length > 67108864) fail('JOB_RESULT_TEMP_INVALID');
          const retained = await lstat(join(resultDirectory, digest(body) + '.bin'));
          if (!retained.isFile() || retained.isSymbolicLink() || retained.ino !== info.ino ||
              retained.dev !== info.dev || retained.nlink !== 2) fail('JOB_RESULT_TEMP_INVALID');
        }
        assertOpen();
        const current = await lstat(path);
        if (current.ino !== info.ino || current.dev !== info.dev || current.isSymbolicLink())
          fail('JOB_RESULT_TEMP_CHANGED');
        await unlink(path); changed = true;
      } finally { await handle.close(); }
    }
    if (changed) await flushDirectory(resultDirectory);
  }
  async function retainSource(filename, value, expected, limit) {
    const path = join(directory, filename), body = Buffer.from(value);
    if (body.length > limit || digest(body) !== expected) fail('JOB_SOURCE_SNAPSHOT_INVALID');
    try {
      if (digest(await readPrivate(path, limit)) !== expected) fail('JOB_SOURCE_SNAPSHOT_CHANGED');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomic(path, body);
    }
  }
  async function save(row) {
    validateRow(row, source.identity);
    const bytes = Buffer.from(JSON.stringify(row) + '\n');
    if (bytes.length > MAX_RECORD) fail('JOB_RECORD_TOO_LARGE');
    try {
      await atomic(join(recordDirectory, row.id + '.json'), bytes);
      rows.set(row.id, structuredClone(row)); fault = null;
    } catch (error) {
      // A completed rename remains the actual state even if its final directory
      // flush reported failure. Refresh memory from the named complete record.
      try {
        const actual = validateRow(JSON.parse((await readPrivate(join(recordDirectory, row.id + '.json'), MAX_RECORD)).toString('utf8')), source.identity);
        rows.set(row.id, actual);
      } catch { /* Preserve the last readable committed row. */ }
      fault = 'JOB_STORAGE_UNAVAILABLE';
      throw jobError(error.code?.startsWith('JOB_') ? error.code : fault, 503);
    }
  }
  function serial(operation) {
    const pending = tail.then(async () => { assertOpen(); return operation(); });
    tail = pending.catch(() => {});
    return pending;
  }
  try {
    await privateDirectory(recordDirectory); await privateDirectory(resultDirectory);
    const sourcePath = join(directory, 'source.json');
    let retained;
    try { retained = JSON.parse((await readPrivate(sourcePath, MAX_RECORD)).toString('utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      retained = { schema: 'stellar-forge.job-merchant-state.v1', source: source.identity,
        configPath: source.configPath, configuration: source.raw, createdAt: new Date().toISOString() };
      await atomic(sourcePath, Buffer.from(JSON.stringify(retained) + '\n'));
    }
    if (!plain(retained) || retained.schema !== 'stellar-forge.job-merchant-state.v1' ||
        canonical(retained.source) !== canonical(source.identity)) fail('JOB_MERCHANT_SOURCE_CHANGED', 409);
    await retainSource('config-source.json', source.configSource, source.identity.configSha256, 1048576);
    await retainSource('application-source.mjs', source.applicationSource, source.identity.applicationSha256, 4194304);
    await recoverResultTemps();
    const files = (await readdir(recordDirectory)).filter(file => file.endsWith('.json'));
    if (files.length > source.compiled.maxJobs) fail('JOB_RETAINED_CAPACITY_EXCEEDED');
    for (const file of files) {
      const id = file.slice(0, -5);
      if (!JOB_ID.test(id)) fail('JOB_RECORD_FILENAME_INVALID');
      const row = validateRow(JSON.parse((await readPrivate(join(recordDirectory, file), MAX_RECORD)).toString('utf8')), source.identity);
      if (row.id !== id || !Object.hasOwn(source.compiled.functions, row.functionId)) fail('JOB_RECORD_SOURCE_MISMATCH');
      rows.set(id, row);
    }
  } catch (error) { closed = true; await lease.close(); throw error; }

  return Object.freeze({ directory, recordDirectory, resultDirectory,
    get fault() { return fault; },
    rows() { assertOpen(); return [...rows.values()].map(row => structuredClone(row)); },
    get(id) { assertOpen(); const row = rows.get(id); if (!row) fail('JOB_NOT_FOUND', 404); return structuredClone(row); },
    async create(row) {
      return serial(async () => {
        if (rows.has(row.id)) fail('JOB_REFERENCE_EXISTS', 409);
        if (rows.size >= source.compiled.maxJobs) fail('JOB_RETAINED_CAPACITY_EXCEEDED', 429);
        if ([...rows.values()].filter(item => PENDING.has(item.state)).length >= source.compiled.maxPending) fail('JOB_QUEUE_FULL', 429);
        await save(row); return structuredClone(row);
      });
    },
    async update(id, expectedRevision, change) {
      return serial(async () => {
        const previous = rows.get(id);
        if (!previous) fail('JOB_NOT_FOUND', 404);
        if (expectedRevision !== undefined && expectedRevision !== previous.revision) fail('JOB_REVISION_CHANGED', 409);
        const next = await change(structuredClone(previous));
        if (next === null) return structuredClone(previous);
        if (!plain(next) || next.id !== previous.id || next.inputSha256 !== previous.inputSha256 ||
            next.functionId !== previous.functionId || next.claimTokenHash !== previous.claimTokenHash ||
            canonical(next.payment) !== canonical(previous.payment)) fail('JOB_IMMUTABLE_IDENTITY_CHANGED');
        next.revision = previous.revision + 1; next.updatedAt = new Date().toISOString();
        if (!Number.isSafeInteger(next.revision)) fail('JOB_REVISION_EXHAUSTED');
        await save(next); return structuredClone(next);
      });
    },
    async writeResult(body) {
      return serial(async () => {
        if (!Buffer.isBuffer(body) || body.length > 67108864) fail('JOB_RESULT_TOO_LARGE', 413);
        const sha256 = digest(body), filename = sha256 + '.bin', path = join(resultDirectory, filename);
        const temp = join(resultDirectory, '.result-' + randomUUID() + '.tmp');
        let handle;
        try {
          handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
          assertOpen();
          try { await link(temp, path); }
          catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const retained = await readPrivate(path, 67108864);
            if (retained.length !== body.length || digest(retained) !== sha256) fail('JOB_RESULT_CONTENT_CONFLICT');
          }
          await unlink(temp); await flushDirectory(resultDirectory);
          return { bytes: body.length, sha256, file: filename };
        } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
      });
    },
    async readResult(result) {
      assertOpen();
      if (!plain(result) || !HASH.test(result.sha256 ?? '') || result.file !== result.sha256 + '.bin') fail('JOB_RESULT_RECORD_INVALID');
      const body = await readPrivate(join(resultDirectory, result.file), 67108864);
      if (body.length !== result.bytes || digest(body) !== result.sha256) fail('JOB_RESULT_CHANGED');
      return body;
    },
    async close() {
      if (closed) return;
      await tail; closing = true; closed = true; await lease.close();
    },
  });
}
