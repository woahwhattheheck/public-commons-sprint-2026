// MIT. Version continuity around the original SF30 CSV loader and cursor contract.
import { constants } from 'node:fs';
import { open, mkdir, rename, rm, lstat, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join, resolve } from 'node:path';
import { loadDatasetConfig } from '../dataset-handler.mjs';

const SCHEMA = 'stellar-forge.dataset-versions.v1';
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const integer = (value, name, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
};

async function privateFile(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function jsonFile(path, maxBytes = 65536) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new TypeError('Expected a regular, size-limited JSON file');
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new RangeError('JSON file exceeds size limit');
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
  } finally { await handle.close(); }
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Version storage must be a real directory');
  if (process.platform !== 'win32' && (info.mode & 0o077))
    throw new TypeError('Version storage must be private (chmod 700)');
}
async function acquire(directoryPath) {
  const path = join(directoryPath, 'writer.lock');
  const lock = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await privateFile(path, encode(lock));
      return async () => {
        const current = (await jsonFile(path)).value;
        if (current.token === lock.token) await rm(path);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const before = await lstat(path), old = (await jsonFile(path)).value;
      if (!Number.isSafeInteger(old.pid) || old.pid < 1 || typeof old.token !== 'string')
        throw fault('DATASET_LOCK_INVALID', 'Invalid writer lock; inspect this private state directory');
      let alive = true;
      try { process.kill(old.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
      if (alive || attempt) throw fault('DATASET_WRITER_RUNNING', 'The dataset version store already has a live writer');
      const after = await lstat(path);
      if (before.ino !== after.ino || before.dev !== after.dev) continue;
      await rm(path); // A crashed process has no in-flight requests to retain.
    }
  }
  throw fault('DATASET_WRITER_RUNNING', 'Concurrent writer acquired the version store');
}

function contractOf(description) {
  const { snapshot: _snapshot, rowCount: _rows, ...contract } = description;
  return digest(JSON.stringify(canonical(contract)));
}
function validateState(state) {
  if (!object(state) || state.schema !== SCHEMA || !HASH.test(state.current ?? '') ||
      !HASH.test(state.contractHash ?? '') || !Array.isArray(state.versions) || !object(state.settings))
    throw new TypeError('Invalid dataset version state');
  integer(state.revision, 'revision', 1, Number.MAX_SAFE_INTEGER);
  settings(state.settings);
  if (!state.versions.length || state.versions.length > state.settings.maxVersions)
    throw new TypeError('Invalid retained version count');
  const seen = new Set();
  for (const version of state.versions) {
    if (!object(version) || !HASH.test(version.snapshot ?? '') || seen.has(version.snapshot) ||
        !HASH.test(version.configHash ?? '') || !HASH.test(version.csvHash ?? '') ||
        !Number.isSafeInteger(version.sourceBytes) || version.sourceBytes < 1 ||
        !Number.isSafeInteger(version.activatedAt) || version.activatedAt < 0 ||
        (version.expiresAt !== null && (!Number.isSafeInteger(version.expiresAt) || version.expiresAt < 0)))
      throw new TypeError('Invalid retained dataset version');
    seen.add(version.snapshot);
  }
  if (!seen.has(state.current) || state.versions.find(v => v.snapshot === state.current).expiresAt !== null ||
      state.versions.some(v => v.snapshot !== state.current && v.expiresAt === null))
    throw new TypeError('Invalid active dataset version');
  if (state.versions.reduce((sum, v) => sum + v.sourceBytes, 0) > state.settings.maxRetainedBytes)
    throw new TypeError('Retained source byte budget exceeded');
  return state;
}
function settings({ retentionMs = 60 * 60 * 1000, maxVersions = 4,
  maxRetainedBytes = 256 * 1024 * 1024 } = {}) {
  return {
    retentionMs: integer(retentionMs, 'retentionMs', 1000, 7 * 24 * 60 * 60 * 1000),
    maxVersions: integer(maxVersions, 'maxVersions', 2, 16),
    maxRetainedBytes: integer(maxRetainedBytes, 'maxRetainedBytes', 1024, 2 * 1024 * 1024 * 1024),
  };
}

// Select a generation only. The ORIGINAL loader still validates the entire cursor,
// filter identity, selected fields, offsets and page bounds before any payment.
function cursorSnapshot(query) {
  const values = query instanceof URLSearchParams ? query.getAll('cursor') :
    Object.hasOwn(query ?? {}, 'cursor') ? [query.cursor] : [];
  if (!values.length) return null;
  const text = values[0];
  if (values.length !== 1 || typeof text !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(text))
    throw fault('INVALID_DATASET_QUERY', 'Invalid cursor', 400);
  let value;
  try {
    const bytes = Buffer.from(text, 'base64url');
    if (bytes.toString('base64url') !== text) throw new Error();
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw fault('INVALID_DATASET_QUERY', 'Invalid cursor', 400); }
  if (!object(value) || value.v !== 1 || !HASH.test(value.s ?? '') ||
      Object.keys(value).sort().join(',') !== 'n,q,s,v')
    throw fault('INVALID_DATASET_QUERY', 'Invalid cursor', 400);
  return value.s;
}

/** One process owns writes; independent requests retain their admitted generation.
 * All datasets are loaded by the original SF30 loader, never by a second parser. */
export async function openDatasetVersions({ directory: suppliedDirectory, initialConfig,
  retentionMs, maxVersions, maxRetainedBytes, now = Date.now } = {}) {
  if (typeof suppliedDirectory !== 'string' || !suppliedDirectory || typeof now !== 'function')
    throw new TypeError('A private directory and clock are required');
  const root = resolve(suppliedDirectory), generations = join(root, 'versions');
  await directory(root); await directory(generations);
  const unlock = await acquire(root), resident = new Map(), scope = new AsyncLocalStorage();
  let state, tail = Promise.resolve(), closing = false;
  const serialize = task => {
    if (closing) return Promise.reject(fault('DATASET_STORE_CLOSED', 'Dataset store is closing'));
    const result = tail.then(task); tail = result.catch(() => {}); return result;
  };
  const persist = async next => {
    validateState(next);
    const temporary = join(root, `.state-${randomUUID()}.json`);
    try {
      await privateFile(temporary, encode(next));
      await rename(temporary, join(root, 'state.json'));
      await syncDirectory(root);
      state = next;
    } finally { await rm(temporary, { force: true }); }
  };
  async function stage(configPath) {
    const absolute = resolve(configPath), { value: config } = await jsonFile(absolute);
    if (!object(config) || config.schema !== 'stellar-forge.csv-dataset.v1' ||
        typeof config.file !== 'string' || !config.file)
      throw new TypeError('An original csv-dataset.v1 config is required');
    const maxBytes = integer(config.maxBytes ?? 64 * 1024 * 1024, 'maxBytes', 1, 256 * 1024 * 1024);
    const temporary = join(generations, `.stage-${randomUUID()}`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      const input = await open(resolve(dirname(absolute), config.file),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let sourceBytes = 0, csvHash;
      try {
        const before = await input.stat();
        if (!before.isFile() || before.size > maxBytes) throw new TypeError('CSV must be regular and within maxBytes');
        const output = await open(join(temporary, 'data.csv'), 'wx', 0o600), hash = createHash('sha256');
        try {
          for await (const chunk of input.createReadStream({ autoClose: false })) {
            sourceBytes += chunk.length;
            if (sourceBytes > maxBytes) throw new RangeError('CSV exceeds maxBytes');
            hash.update(chunk); await output.writeFile(chunk);
          }
          await output.sync();
        } finally { await output.close(); }
        const after = await input.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
          throw fault('DATASET_SOURCE_CHANGED', 'CSV changed while staging; replace source files atomically');
        csvHash = hash.digest('hex');
      } finally { await input.close(); }
      const stagedConfig = { ...config, file: './data.csv' };
      const configBytes = encode(Object.fromEntries(Object.keys(stagedConfig).sort().map(key => [key, stagedConfig[key]])));
      await privateFile(join(temporary, 'dataset.json'), configBytes);
      const dataset = await loadDatasetConfig(join(temporary, 'dataset.json'));
      const description = dataset.describe(), snapshot = description.snapshot;
      if (!HASH.test(snapshot)) throw new TypeError('Original loader did not return a SHA256 snapshot');
      const record = { snapshot, configHash: digest(configBytes), csvHash, sourceBytes,
        activatedAt: now(), expiresAt: null };
      await privateFile(join(temporary, 'manifest.json'), encode({
        schema: 'stellar-forge.dataset-generation.v1', ...record, contractHash: contractOf(description),
      }));
      await syncDirectory(temporary);
      return { temporary, record, dataset, contractHash: contractOf(description) };
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }
  async function loadVersion(record, expectedContract = state.contractHash) {
    const path = join(generations, record.snapshot);
    if (!(await lstat(path)).isDirectory()) throw new TypeError('Dataset generation must be a real directory');
    const { bytes } = await jsonFile(join(path, 'dataset.json'));
    if (digest(bytes) !== record.configHash) throw fault('DATASET_GENERATION_CHANGED', 'Stored dataset configuration changed');
    const manifest = (await jsonFile(join(path, 'manifest.json'))).value;
    if (manifest.snapshot !== record.snapshot || manifest.csvHash !== record.csvHash ||
        manifest.configHash !== record.configHash || manifest.sourceBytes !== record.sourceBytes ||
        manifest.contractHash !== expectedContract)
      throw fault('DATASET_GENERATION_CHANGED', 'Stored dataset manifest changed');
    const info = await lstat(join(path, 'data.csv'));
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.sourceBytes)
      throw fault('DATASET_GENERATION_CHANGED', 'Stored dataset file changed');
    const dataset = await loadDatasetConfig(join(path, 'dataset.json'));
    if (dataset.describe().snapshot !== record.snapshot || contractOf(dataset.describe()) !== expectedContract)
      throw fault('DATASET_GENERATION_CHANGED', 'Stored original dataset snapshot changed');
    return { dataset, readers: 0 };
  }
  async function install(staged) {
    try { await rename(staged.temporary, join(generations, staged.record.snapshot)); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      // A crash may leave a complete immutable generation before state.json was
      // promoted. Reuse it only after the same ORIGINAL loader checks its identity.
      await loadVersion(staged.record, staged.contractHash);
    }
    await syncDirectory(generations);
  }
  function removable() {
    return state.versions.filter(v => v.snapshot !== state.current && v.expiresAt <= now() &&
      (resident.get(v.snapshot)?.readers ?? 0) === 0);
  }
  async function collectInternal() {
    const remove = removable();
    if (!remove.length) return [];
    const ids = new Set(remove.map(v => v.snapshot));
    await persist({ ...state, revision: state.revision + 1,
      versions: state.versions.filter(v => !ids.has(v.snapshot)) });
    for (const id of ids) {
      resident.delete(id);
      await rm(join(generations, id), { recursive: true, force: true });
    }
    await syncDirectory(generations);
    return [...ids];
  }
  try {
    for (const entry of await readdir(generations)) {
      if (/^\.stage-[a-f0-9-]{36}$/.test(entry))
        await rm(join(generations, entry), { recursive: true, force: true });
    }
    try { state = validateState((await jsonFile(join(root, 'state.json'), 256 * 1024)).value); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!state) {
      if (!initialConfig) throw new TypeError('Initialize this version store with an original dataset config');
      const staged = await stage(initialConfig);
      try {
        const policy = settings({ retentionMs, maxVersions, maxRetainedBytes });
        if (staged.record.sourceBytes > policy.maxRetainedBytes) throw new RangeError('Dataset exceeds retained source byte budget');
        await install(staged);
        await persist({ schema: SCHEMA, revision: 1, current: staged.record.snapshot,
          contractHash: staged.contractHash, settings: policy, versions: [staged.record] });
        resident.set(staged.record.snapshot, { dataset: staged.dataset, readers: 0 });
      } finally { await rm(staged.temporary, { recursive: true, force: true }); }
    } else {
      if (initialConfig || retentionMs !== undefined || maxVersions !== undefined || maxRetainedBytes !== undefined)
        throw new TypeError('Existing stores retain their initialized settings; reopen without initialization options');
      await collectInternal();
      for (const record of state.versions) resident.set(record.snapshot, await loadVersion(record));
    }
  } catch (error) { await unlock(); throw error; }

  function select(query) {
    const id = cursorSnapshot(query) ?? state.current;
    const record = state.versions.find(v => v.snapshot === id);
    if (!record || record.expiresAt !== null && record.expiresAt <= now())
      throw fault('DATASET_SNAPSHOT_EXPIRED', 'This snapshot is no longer retained; start a new query', 410);
    return { id, entry: resident.get(id) };
  }
  function pin(context) {
    const request = scope.getStore();
    if (!request) throw new TypeError('Wrap the original HTTP handler with versions.wrapRequest()');
    if (!request.pin) {
      if (request.closed) throw new Error('Dataset request disconnected before admission');
      request.pin = select(context.query);
      request.pin.entry.readers++;
    }
    return request.pin;
  }
  const errorResponse = error => {
    if (!error.code || ![400, 409, 410].includes(error.status)) throw error;
    return { status: error.status, body: { error: error.code, message: error.message } };
  };
  const result = {
    directory: root,
    describe: () => resident.get(state.current).dataset.describe(),
    status: () => ({ schema: SCHEMA, revision: state.revision, current: state.current,
      settings: { ...state.settings }, retainedSourceBytes: state.versions.reduce((sum, v) => sum + v.sourceBytes, 0),
      versions: state.versions.map(v => ({ ...v, readers: resident.get(v.snapshot)?.readers ?? 0,
        rowCount: resident.get(v.snapshot)?.dataset.describe().rowCount,
        status: v.snapshot === state.current ? 'CURRENT' : v.expiresAt <= now() ? 'EXPIRED' : 'RETAINED' })) }),
    admit(context) {
      try { return pin(context).entry.dataset.admit(context); } catch (error) { return errorResponse(error); }
    },
    handle(context) {
      try { return pin(context).entry.dataset.handle(context); } catch (error) { return errorResponse(error); }
    },
    wrapRequest(handler) {
      if (typeof handler !== 'function') throw new TypeError('Original request handler is required');
      return (req, res) => scope.run({ pin: null, closed: false }, () => {
        const request = scope.getStore(); let released = false;
        const release = () => {
          if (released) return;
          released = true; res.removeListener('finish', release); res.removeListener('close', release);
          request.closed = true;
          if (request.pin) request.pin.entry.readers--;
        };
        res.once('finish', release); res.once('close', release);
        try { return handler(req, res); } catch (error) { release(); throw error; }
      });
    },
    collect: () => serialize(collectInternal),
    refresh: ({ configPath, expectedSnapshot } = {}) => serialize(async () => {
      if (typeof configPath !== 'string' || !HASH.test(expectedSnapshot ?? ''))
        throw new TypeError('Refresh requires a dataset configPath and expectedSnapshot');
      if (expectedSnapshot !== state.current)
        throw fault('DATASET_CURRENT_CHANGED', 'Current snapshot differs from the operator expected snapshot');
      const staged = await stage(configPath);
      try {
        if (staged.contractHash !== state.contractHash)
          throw fault('DATASET_CONTRACT_CHANGED', 'Dataset columns, filters, ordering or page contract changed; use a separate seller route');
        if (staged.record.snapshot === state.current) {
          if (staged.record.configHash !== state.versions.find(v => v.snapshot === state.current).configHash)
            throw fault('DATASET_GENERATION_CONFLICT', 'The same snapshot has different runtime configuration');
          return { changed: false, ...result.status() };
        }
        await collectInternal();
        const existing = state.versions.find(v => v.snapshot === staged.record.snapshot);
        const retainedBytes = state.versions.reduce((sum, v) => sum + v.sourceBytes, 0) + (existing ? 0 : staged.record.sourceBytes);
        if (!existing && state.versions.length >= state.settings.maxVersions || retainedBytes > state.settings.maxRetainedBytes)
          throw fault('DATASET_RETENTION_CAPACITY', 'Protected generations fill the retention capacity; refresh after their retention ends');
        if (existing && (existing.configHash !== staged.record.configHash || existing.csvHash !== staged.record.csvHash))
          throw fault('DATASET_GENERATION_CONFLICT', 'The same snapshot has different runtime configuration');
        const at = now(), nextVersions = state.versions.map(v => v.snapshot === state.current ?
          { ...v, expiresAt: at + state.settings.retentionMs } : v.snapshot === staged.record.snapshot ?
            { ...v, activatedAt: at, expiresAt: null } : v);
        if (!existing) {
          await install(staged);
          nextVersions.push({ ...staged.record, activatedAt: at });
          resident.set(staged.record.snapshot, { dataset: staged.dataset, readers: 0 });
        }
        await persist({ ...state, revision: state.revision + 1, current: staged.record.snapshot, versions: nextVersions });
        return { changed: true, ...result.status() };
      } finally { await rm(staged.temporary, { recursive: true, force: true }); }
    }),
    async close() {
      if (closing) return;
      closing = true; await tail;
      await unlock();
    },
  };
  return Object.freeze(result);
}
