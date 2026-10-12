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
export const DATASET_SNAPSHOT_PARAMETER = Object.freeze({ name: 'snapshot', type: 'string',
  description: 'Optional retained snapshot SHA256 for the first page; omit to select current at admission. With a cursor it must match the cursor snapshot.',
  example: '' });
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

function selectedQuery(query = {}) {
  if (!object(query)) throw fault('INVALID_DATASET_QUERY', 'Query must contain scalar URL parameters', 400);
  const entries = query instanceof URLSearchParams ? [...query] : Object.entries(query);
  const native = Object.create(null);
  let snapshot = null;
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || Object.hasOwn(native, key) || key === 'snapshot' && snapshot !== null)
      throw fault('INVALID_DATASET_QUERY', 'Each query parameter must occur once', 400);
    if (key === 'snapshot') {
      if (!HASH.test(value)) throw fault('INVALID_DATASET_QUERY', 'snapshot must be a retained dataset SHA256', 400);
      snapshot = value;
    } else native[key] = value;
  }
  const cursor = cursorSnapshot(native);
  if (snapshot && cursor && snapshot !== cursor)
    throw fault('INVALID_DATASET_QUERY', 'snapshot and cursor select different datasets', 400);
  return { snapshot: cursor ?? snapshot, explicitSnapshot: snapshot !== null, query: native };
}

/** One process owns writes; independent requests retain their admitted generation.
 * All datasets are loaded by the original SF30 loader, never by a second parser. */
export async function openDatasetVersions({ directory: suppliedDirectory, initialConfig,
  retentionMs, maxVersions, maxRetainedBytes, maxCachedVersions = 2,
  maxResidentRows = 1000000, collectOnOpen = true, now = Date.now } = {}) {
  if (typeof suppliedDirectory !== 'string' || !suppliedDirectory || typeof now !== 'function')
    throw new TypeError('A private directory and clock are required');
  if (typeof collectOnOpen !== 'boolean') throw new TypeError('collectOnOpen must be boolean');
  integer(maxCachedVersions, 'maxCachedVersions', 1, 16);
  integer(maxResidentRows, 'maxResidentRows', 1, 16000000);
  const root = resolve(suppliedDirectory), generations = join(root, 'versions');
  await directory(root); await directory(generations);
  const unlock = await acquire(root), resident = new Map(), known = new Map(), scope = new AsyncLocalStorage();
  let state, tail = Promise.resolve(), memoryTail = Promise.resolve(), closing = false;
  const serialize = task => {
    if (closing) return Promise.reject(fault('DATASET_STORE_CLOSED', 'Dataset store is closing'));
    const result = tail.then(task); tail = result.catch(() => {}); return result;
  };
  const memory = task => {
    const result = memoryTail.then(task); memoryTail = result.catch(() => {}); return result;
  };
  const residentRows = () => [...resident.values()].reduce((sum, entry) => sum + entry.description.rowCount, 0);
  function remember(id, description) {
    let entry = known.get(id);
    if (!entry) { entry = { dataset: null, description, readers: 0, loading: 0 }; known.set(id, entry); }
    else entry.description = description;
    return entry;
  }
  function evictFor(rows, incoming) {
    if (rows > maxResidentRows) return false;
    while (resident.size >= maxCachedVersions || residentRows() + rows > maxResidentRows) {
      const victim = [...resident].find(([id, entry]) => id !== incoming && !entry.readers && !entry.loading);
      if (!victim) return false;
      resident.delete(victim[0]); victim[1].dataset = null;
    }
    return true;
  }
  function cache(id, dataset) {
    const entry = remember(id, dataset.describe());
    if (entry.dataset) { resident.delete(id); resident.set(id, entry); return entry; }
    if (!evictFor(entry.description.rowCount, id)) return null;
    entry.dataset = dataset; resident.set(id, entry); return entry;
  }
  function ensureResident(id, entry, signal) {
    if (closing) return Promise.reject(fault('DATASET_STORE_CLOSED', 'Dataset store is closing'));
    if (entry.dataset) { resident.delete(id); resident.set(id, entry); return Promise.resolve(entry); }
    entry.loading++;
    return memory(async () => {
      signal?.throwIfAborted();
      if (entry.dataset) { resident.delete(id); resident.set(id, entry); return entry; }
      const record = state.versions.find(version => version.snapshot === id);
      if (!record) throw fault('DATASET_SNAPSHOT_EXPIRED', 'This snapshot is no longer retained; start a new query', 410);
      if (!evictFor(entry.description.rowCount, id))
        throw fault('DATASET_CACHE_CAPACITY', 'Active dataset requests fill the parsed-data cache; retry after they complete', 429);
      const loaded = await loadVersion(record);
      signal?.throwIfAborted();
      if (!cache(id, loaded.dataset))
        throw fault('DATASET_CACHE_CAPACITY', 'Active dataset requests fill the parsed-data cache; retry after they complete', 429);
      return entry;
    }).finally(() => { entry.loading--; });
  }
  function compareExpected(expectedSnapshot, expectedRevision) {
    if (!HASH.test(expectedSnapshot ?? '')) throw new TypeError('expectedSnapshot must be the current dataset SHA256');
    if (expectedRevision !== undefined) integer(expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    if (expectedSnapshot !== state.current)
      throw fault('DATASET_CURRENT_CHANGED', 'Current snapshot differs from the operator expected snapshot');
    if (expectedRevision !== undefined && expectedRevision !== state.revision)
      throw fault('DATASET_REVISION_CHANGED', 'Dataset state changed after the operator inspected it; read status again');
  }
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
        const before = await input.stat({ bigint: true });
        if (!before.isFile() || before.size > BigInt(maxBytes)) throw new TypeError('CSV must be regular and within maxBytes');
        const output = await open(join(temporary, 'data.csv'), 'wx', 0o600), hash = createHash('sha256');
        try {
          for await (const chunk of input.createReadStream({ autoClose: false })) {
            sourceBytes += chunk.length;
            if (sourceBytes > maxBytes) throw new RangeError('CSV exceeds maxBytes');
            hash.update(chunk); await output.writeFile(chunk);
          }
          await output.sync();
        } finally { await output.close(); }
        const after = await input.stat({ bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
            before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
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
        dataset: description,
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
    if (manifest.dataset !== undefined &&
        JSON.stringify(canonical(manifest.dataset)) !== JSON.stringify(canonical(dataset.describe())))
      throw fault('DATASET_GENERATION_CHANGED', 'Stored dataset description changed');
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
      (known.get(v.snapshot)?.readers ?? 0) === 0 && (known.get(v.snapshot)?.loading ?? 0) === 0);
  }
  async function collectInternal() {
    const remove = removable();
    if (!remove.length) return [];
    const ids = new Set(remove.map(v => v.snapshot));
    await persist({ ...state, revision: state.revision + 1,
      versions: state.versions.filter(v => !ids.has(v.snapshot)) });
    for (const id of ids) {
      resident.delete(id); known.delete(id);
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
        if (staged.dataset.describe().rowCount > maxResidentRows)
          throw new RangeError('Current dataset exceeds maxResidentRows; increase the parsed-data row budget');
        await install(staged);
        await persist({ schema: SCHEMA, revision: 1, current: staged.record.snapshot,
          contractHash: staged.contractHash, settings: policy, versions: [staged.record] });
        cache(staged.record.snapshot, staged.dataset);
      } finally { await rm(staged.temporary, { recursive: true, force: true }); }
    } else {
      if (initialConfig || retentionMs !== undefined || maxVersions !== undefined || maxRetainedBytes !== undefined)
        throw new TypeError('Existing stores retain their initialized settings; reopen without initialization options');
      // Portable capture keeps every stored generation; live reopen still collects by default.
      if (collectOnOpen) await collectInternal();
      // Preserve the original full restart validation, one generation at a time.
      // Only compact descriptions survive for cold generations; current is last.
      for (const record of [...state.versions.filter(v => v.snapshot !== state.current),
        state.versions.find(v => v.snapshot === state.current)]) {
        for (const entry of resident.values()) entry.dataset = null;
        resident.clear();
        const loaded = await loadVersion(record);
        remember(record.snapshot, loaded.dataset.describe());
        if (record.snapshot === state.current && loaded.dataset.describe().rowCount > maxResidentRows)
          throw new RangeError('Current dataset exceeds maxResidentRows; increase the parsed-data row budget');
        cache(record.snapshot, loaded.dataset);
      }
    }
  } catch (error) { await unlock(); throw error; }

  function select(query, allowSnapshot) {
    const selection = selectedQuery(query), id = selection.snapshot ?? state.current;
    if (selection.explicitSnapshot && !allowSnapshot)
      throw fault('INVALID_DATASET_QUERY', 'This route does not advertise a snapshot selector; use its original cursor or current query', 400);
    const record = state.versions.find(v => v.snapshot === id);
    if (!record || record.expiresAt !== null && record.expiresAt <= now())
      throw fault('DATASET_SNAPSHOT_EXPIRED', 'This snapshot is no longer retained; start a new query', 410);
    return { id, entry: known.get(id), query: selection.query };
  }
  function pin(context, { allowSnapshot = true } = {}) {
    const request = scope.getStore();
    if (!request) throw new TypeError('Wrap the original HTTP handler with versions.wrapRequest()');
    if (!request.pin) {
      if (request.closed || request.disconnected) throw new Error('Dataset request disconnected before admission');
      request.pin = select(context.query, allowSnapshot);
      request.pin.entry.readers++;
      request.pin.ready = ensureResident(request.pin.id, request.pin.entry, context.signal);
    }
    return request.pin.ready.then(() => {
      context.signal?.throwIfAborted();
      return request.pin;
    });
  }
  const errorResponse = error => {
    if (!error.code || ![400, 409, 410, 429].includes(error.status)) throw error;
    return { status: error.status, ...(error.status === 429 ? { headers: { 'retry-after': '1' } } : {}),
      body: { error: error.code, message: error.message } };
  };
  const result = {
    directory: root,
    describe: () => structuredClone(known.get(state.current).description),
    status: () => ({ schema: SCHEMA, revision: state.revision, current: state.current,
      settings: { ...state.settings }, retainedSourceBytes: state.versions.reduce((sum, v) => sum + v.sourceBytes, 0),
      cache: { maxCachedVersions, maxResidentRows, residentVersions: resident.size,
        residentRows: residentRows() },
      versions: state.versions.map(v => ({ ...v, readers: known.get(v.snapshot)?.readers ?? 0,
        loading: known.get(v.snapshot)?.loading ?? 0, resident: resident.has(v.snapshot),
        rowCount: known.get(v.snapshot)?.description.rowCount,
        status: v.snapshot === state.current ? 'CURRENT' : v.expiresAt <= now() ? 'EXPIRED' : 'RETAINED' })) }),
    async admit(context, options) {
      try {
        const selected = await pin(context, options);
        return selected.entry.dataset.admit({ ...context, query: selected.query });
      } catch (error) { return errorResponse(error); }
    },
    async handle(context, options) {
      try {
        const selected = await pin(context, options);
        return selected.entry.dataset.handle({ ...context, query: selected.query });
      } catch (error) { return errorResponse(error); }
    },
    wrapRequest(handler) {
      if (typeof handler !== 'function') throw new TypeError('Original request handler is required');
      return (req, res) => scope.run({ pin: null, closed: false, disconnected: false }, () => {
        const request = scope.getStore(); let released = false, handlerDone = false, responseDone = false;
        const release = () => {
          if (released || !handlerDone || !responseDone) return;
          released = true; res.removeListener('finish', onResponse); res.removeListener('close', onResponse);
          request.closed = true;
          if (request.pin) request.pin.entry.readers--;
        };
        const onResponse = () => {
          responseDone = true; request.disconnected = !res.writableFinished; release();
        };
        const completed = () => { handlerDone = true; release(); };
        res.once('finish', onResponse); res.once('close', onResponse);
        try {
          const pending = handler(req, res);
          if (pending && typeof pending.then === 'function') return Promise.resolve(pending).finally(completed);
          completed(); return pending;
        } catch (error) { handlerDone = responseDone = true; release(); throw error; }
      });
    },
    collect: () => serialize(collectInternal),
    refresh: ({ configPath, expectedSnapshot, expectedRevision } = {}) => serialize(() => memory(async () => {
      if (typeof configPath !== 'string' || !configPath)
        throw new TypeError('Refresh requires a dataset configPath and expectedSnapshot');
      compareExpected(expectedSnapshot, expectedRevision);
      const staged = await stage(configPath);
      try {
        if (staged.contractHash !== state.contractHash)
          throw fault('DATASET_CONTRACT_CHANGED', 'Dataset columns, filters, ordering or page contract changed; use a separate seller route');
        if (staged.dataset.describe().rowCount > maxResidentRows)
          throw fault('DATASET_CACHE_CAPACITY', 'New current dataset exceeds maxResidentRows; restart with a larger parsed-data budget');
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
        }
        remember(staged.record.snapshot, staged.dataset.describe());
        try {
          await persist({ ...state, revision: state.revision + 1, current: staged.record.snapshot, versions: nextVersions });
        } catch (error) {
          if (!state.versions.some(version => version.snapshot === staged.record.snapshot)) known.delete(staged.record.snapshot);
          throw error;
        }
        // Promotion need not evict a pinned buyer. A cold current generation can
        // load after that buyer completes; parsed-cache pressure never retires disk.
        cache(staged.record.snapshot, staged.dataset);
        return { changed: true, ...result.status() };
      } finally { await rm(staged.temporary, { recursive: true, force: true }); }
    })),
    activate: ({ snapshot, expectedSnapshot, expectedRevision } = {}) => serialize(() => memory(async () => {
      if (expectedRevision === undefined) throw new TypeError('Activation requires the current expectedRevision from status');
      compareExpected(expectedSnapshot, expectedRevision);
      if (!HASH.test(snapshot ?? '')) throw new TypeError('snapshot must be a retained dataset SHA256');
      const record = state.versions.find(version => version.snapshot === snapshot);
      if (!record) throw fault('DATASET_SNAPSHOT_EXPIRED', 'Only a still-stored generation can be activated', 410);
      if (snapshot === state.current) return { changed: false, ...result.status() };
      // Explicit operator activation can rescue a stored expired generation that
      // collection has not removed. Native requests alone never extend retention.
      const loaded = await loadVersion(record);
      if (loaded.dataset.describe().rowCount > maxResidentRows)
        throw fault('DATASET_CACHE_CAPACITY', 'Selected current dataset exceeds maxResidentRows; restart with a larger parsed-data budget');
      const at = now(), nextVersions = state.versions.map(version => version.snapshot === snapshot ?
        { ...version, activatedAt: at, expiresAt: null } : version.snapshot === state.current ?
          { ...version, expiresAt: at + state.settings.retentionMs } : version);
      await persist({ ...state, revision: state.revision + 1, current: snapshot, versions: nextVersions });
      remember(snapshot, loaded.dataset.describe()); cache(snapshot, loaded.dataset);
      return { changed: true, ...result.status() };
    })),
    async close() {
      if (closing) return;
      closing = true; await tail; await memoryTail;
      for (const entry of resident.values()) if (!entry.readers) entry.dataset = null;
      resident.clear();
      await unlock();
    },
  };
  return Object.freeze(result);
}
