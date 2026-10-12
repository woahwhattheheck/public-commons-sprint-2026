// MIT. Retained customer request collections over the original SF88 buyer inbox.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, execution, need } from '../config.mjs';
import { openQueue } from '../queue.mjs';
import { readRequestBody } from '../request-body.mjs';
import { loadOperationTicket, operationTicketView } from '../operation-ticket.mjs';
import {
  initializationDirectory, initializationBytes, optionalInitializationBytes,
  retainInitializationFile, retainInitializationRecord,
} from '../initialization.mjs';

const ROOT = 'stellar-forge.sf88.collections.v1';
const MANIFEST = 'stellar-forge.sf88.collection.v1';
const PREVIEW = 'stellar-forge.sf88.collection-preview.v1';
const STATUS = 'stellar-forge.sf88.collection-status.v1';
const EXPORT = 'stellar-forge.sf88.collection-export.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 500;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_RECORD_BYTES = 32 * 1024 * 1024;
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = () => new Date().toISOString();
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'COLLECTION_OPERATION_FAILED';
const fail = code => { throw Object.assign(new Error(code), { code }); };
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hashValue = value => digest(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !value.includes('\0'), 'COLLECTION_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function collectionId(value) {
  need(typeof value === 'string' && ID.test(value) && value !== '.' && value !== '..', 'COLLECTION_ID_INVALID');
  return value;
}
function parse(bytes, code = 'COLLECTION_RECORD_INVALID') {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(code); }
}
async function record(path, limit = MAX_RECORD_BYTES) {
  return parse(await initializationBytes(path, limit));
}
async function optionalRecord(path, limit = MAX_RECORD_BYTES) {
  const bytes = await optionalInitializationBytes(path, limit);
  return bytes === null ? null : parse(bytes);
}
async function regularBytes(path, limit) {
  absolute(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= limit, 'COLLECTION_INPUT_INVALID');
    const bytes = await handle.readFile();
    need(bytes.length === info.size && bytes.length <= limit, 'COLLECTION_INPUT_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
async function fingerprint(path, limit = 1048576) {
  const bytes = await regularBytes(path, limit);
  return { path, sha256: digest(bytes), bytes: bytes.length };
}
function totalsFor(items) {
  const groups = new Map();
  for (const item of items) {
    const terms = item.operation.expect;
    const key = canonical([terms.network, terms.asset, terms.payTo, terms.scheme, terms.paymentFlow ?? 'authorization']);
    let group = groups.get(key);
    if (!group) {
      group = { network: terms.network, asset: terms.asset, payTo: terms.payTo,
        scheme: terms.scheme, paymentFlow: terms.paymentFlow ?? 'authorization', itemCount: 0, maxAtomic: 0n };
      groups.set(key, group);
    }
    group.itemCount += 1;
    group.maxAtomic += BigInt(terms.maxAtomic);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({ ...group, maxAtomic: group.maxAtomic.toString() }));
}
async function capture(configFiles) {
  need(Array.isArray(configFiles) && configFiles.length > 0 && configFiles.length <= MAX_ITEMS &&
    configFiles.every(path => typeof path === 'string'), 'COLLECTION_CONFIG_FILES_REQUIRED');
  const captures = [], identities = new Set();
  let total = 0;
  for (let index = 0; index < configFiles.length; index += 1) {
    const path = absolute(configFiles[index]);
    const raw = await initializationBytes(path, 65536);
    const cfg = await config(path);
    need(raw.equals(await initializationBytes(path, 65536)) && same(parse(raw), cfg), 'COLLECTION_INPUT_CHANGED');
    const { op, owner, download } = execution(cfg);
    need(!identities.has(op.intentId), 'COLLECTION_DUPLICATE_INTENT');
    identities.add(op.intentId);
    const body = await readRequestBody(op);
    const ticket = await loadOperationTicket(op);
    const dependencies = {
      signer: await fingerprint(cfg.signerModule),
      policy: await fingerprint(owner.policy),
    };
    total += raw.length + (body?.length ?? 0) + (ticket?.sourceBytes?.length ?? 0);
    need(total <= MAX_INPUT_BYTES, 'COLLECTION_INPUT_BYTES_EXCEEDED');
    const item = {
      index, intentId: op.intentId,
      sourceConfig: { path, sha256: digest(raw), bytes: raw.length },
      operation: op,
      body: body === undefined ? null : { sha256: digest(body), bytes: body.length },
      ticket: ticket ? { ...operationTicketView(ticket), bytes: ticket.sourceBytes.length } : null,
      dependencies, responseDestination: download?.destination ?? null,
    };
    captures.push({ item, cfg, raw, body, ticket });
  }
  const value = { schema: PREVIEW, itemCount: captures.length,
    items: captures.map(entry => entry.item), totals: totalsFor(captures.map(entry => entry.item)) };
  return { captures, preview: { ...value, previewSha256: hashValue(value) } };
}

/** Review original files without enqueueing, importing a signer or opening a payment ledger. */
export async function previewCollection({ configFiles } = {}) {
  return (await capture(configFiles)).preview;
}

// The kernel owns the coordination lock; terminating a process releases it.
async function acquire(directory) {
  need(process.platform === 'linux', 'COLLECTION_LINUX_FLOCK_REQUIRED');
  await initializationDirectory(directory);
  const path = join(directory, '.collection.lock');
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()), 'COLLECTION_LOCK_INVALID');
    await new Promise((accept, reject) => {
      let settled = false;
      const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
        { shell: false, stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : accept();
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(Object.assign(new Error('COLLECTION_LOCK_TIMEOUT'), { code: 'COLLECTION_LOCK_TIMEOUT' }));
      }, 5000);
      child.once('error', () => finish(Object.assign(new Error('COLLECTION_FLOCK_UNAVAILABLE'), { code: 'COLLECTION_FLOCK_UNAVAILABLE' })));
      child.once('exit', status => finish(status === 0 ? null :
        Object.assign(new Error(status === 75 ? 'COLLECTION_BUSY' : 'COLLECTION_LOCK_FAILED'),
          { code: status === 75 ? 'COLLECTION_BUSY' : 'COLLECTION_LOCK_FAILED' })));
    });
    const current = await lstat(path);
    need(current.dev === info.dev && current.ino === info.ino && current.nlink === 1, 'COLLECTION_LOCK_REPLACED');
    return () => handle.close();
  } catch (error) { await handle.close(); throw error; }
}
async function withLock(directory, action) {
  const release = await acquire(directory);
  try { return await action(); } finally { await release(); }
}
function itemFiles(captured, destination, queueRoot) {
  const directory = join(destination, 'inputs', String(captured.item.index));
  const operation = { ...captured.item.operation,
    ...(captured.body === undefined ? {} : { bodyFile: join(directory, 'request-body.bin') }),
    ...(captured.ticket === null ? {} : { ticketFile: join(directory, 'operation-ticket.json') }) };
  const cfg = { ...captured.cfg, operation };
  const configured = json(cfg);
  const files = [
    { name: 'original-config.json', bytes: captured.raw },
    { name: 'config.json', bytes: configured },
    ...(captured.body === undefined ? [] : [{ name: 'request-body.bin', bytes: Buffer.from(captured.body) }]),
    ...(captured.ticket === null ? [] : [{ name: 'operation-ticket.json', bytes: captured.ticket.sourceBytes }]),
  ];
  const originalJob = join(queueRoot, 'jobs', digest(captured.item.intentId));
  const queueOperation = { ...operation,
    ...(captured.body === undefined ? {} : { bodyFile: join(originalJob, 'request-body.bin') }),
    ...(captured.ticket === null ? {} : { ticketFile: join(originalJob, 'operation-ticket.json') }) };
  return { directory, files, entry: { ...captured.item,
    configFile: join(directory, 'config.json'), configSha256: digest(configured), queueSourceConfigSha256: digest(configured),
    queueConfigSha256: digest(json({ ...cfg, operation: queueOperation })), queueOperation,
    files: files.map(file => ({ name: file.name, bytes: file.bytes.length, sha256: digest(file.bytes) })) } };
}
function checkedManifest(value, id, queueRoot) {
  need(value?.schema === MANIFEST && value.id === id && value.queueRoot === queueRoot &&
    typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 160 &&
    HASH.test(value.previewSha256) && Array.isArray(value.items) &&
    value.items.length > 0 && value.items.length <= MAX_ITEMS, 'COLLECTION_MANIFEST_INVALID');
  const ids = new Set();
  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index];
    need(item.index === index && typeof item.intentId === 'string' && !ids.has(item.intentId) &&
      item.operation?.intentId === item.intentId && HASH.test(item.configSha256) &&
      HASH.test(item.queueConfigSha256) && HASH.test(item.queueSourceConfigSha256) &&
      item.configFile === join(value.directory, 'inputs', String(index), 'config.json') && Array.isArray(item.files) && item.files.length >= 2 &&
      item.files.every(file => ['original-config.json', 'config.json', 'request-body.bin', 'operation-ticket.json'].includes(file.name) &&
        HASH.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0), 'COLLECTION_MANIFEST_INVALID');
    ids.add(item.intentId);
    execution({ operation: item.operation, operator: {
      python: '/original/python', actor: 'collection-review', service: 'collection-review',
      policy: item.dependencies?.policy?.path, ledger: '/original/ledger',
    }, signerModule: item.dependencies?.signer?.path, evidenceDir: '/original/evidence' });
  }
  need(same(totalsFor(value.items), value.totals), 'COLLECTION_TOTALS_CHANGED');
  return value;
}
function originalJobMatches(item, job) {
  return job.operation?.intentId === item.intentId && job.sourceConfigSha256 === item.queueSourceConfigSha256 &&
    job.configSha256 === item.queueConfigSha256 && job.bodySha256 === (item.body?.sha256 ?? null) &&
    same(job.operation, item.queueOperation) && same(job.dependencies, item.dependencies) &&
    (job.operationTicket?.sha256 ?? null) === (item.ticket?.sha256 ?? null);
}
function selection(manifest, intentIds) {
  need(Array.isArray(intentIds) && intentIds.length > 0 && intentIds.length <= manifest.items.length &&
    intentIds.every(id => typeof id === 'string') && new Set(intentIds).size === intentIds.length,
    'COLLECTION_INTENT_REQUIRED');
  const byId = new Map(manifest.items.map(item => [item.intentId, item]));
  need(intentIds.every(id => byId.has(id)), 'COLLECTION_INTENT_REQUIRED');
  return intentIds.map(id => byId.get(id));
}
function collectionState(items, prepared) {
  if (!prepared) return 'PREPARING';
  if (items.some(item => item.state === 'REVIEW_REQUIRED')) return 'REVIEW_REQUIRED';
  if (items.some(item => item.state === 'RUNNING_OR_INTERRUPTED')) return 'NEEDS_REVIEW';
  const queued = items.filter(item => item.state === 'QUEUED').length;
  const pending = items.filter(item => item.state === 'PREPARED').length;
  if (pending === items.length) return 'PREPARED';
  if (pending) return 'ENQUEUE_PARTIAL';
  if (queued === items.length) return 'QUEUED';
  if (queued) return 'PARTIAL';
  if (items.every(item => item.state === 'CANCELLED')) return 'CANCELLED';
  return 'FINISHED';
}
function interruptedOrFailed(job) {
  if (job.state === 'RUNNING_OR_INTERRUPTED' || job.state === 'REVIEW_REQUIRED') return true;
  if (job.state === 'CANCELLED') return false;
  const result = job.outcome;
  return !result || Boolean(job.lastError || result.error || result.evidenceError || result.interrupted ||
    result.responseCleanupError || result.responseFile?.status === 'FAILED') ||
    !Number.isInteger(result.httpStatus) || result.httpStatus < 200 || result.httpStatus >= 300;
}
function actionResult(intentId, state, error) {
  return { intentId, state, ...(error ? { error: { code: codeOf(error) } } : {}) };
}

/** One private collection store bound to an existing original SF88 queue. */
export async function openCollections({ directory, queueRoot } = {}) {
  directory = absolute(directory);
  await initializationDirectory(directory, { create: true });
  const rootFile = join(directory, 'collections.json');
  const retained = await optionalRecord(rootFile, 65536);
  if (retained) {
    need(retained.schema === ROOT && typeof retained.queueRoot === 'string', 'COLLECTION_STORE_INVALID');
    need(queueRoot === undefined || queueRoot === retained.queueRoot, 'COLLECTION_QUEUE_BINDING_CHANGED');
    queueRoot = retained.queueRoot;
  }
  queueRoot = absolute(queueRoot);
  const queue = await openQueue(queueRoot);
  const collectionsPath = join(directory, 'collections');
  await initializationDirectory(collectionsPath, { create: true });
  await retainInitializationRecord(rootFile, { schema: ROOT, queueRoot, createdAt: retained?.createdAt ?? date() },
    { resume: true, ignore: ['createdAt'] });
  let closed = false, active = null, runBusy = false;
  const live = () => need(!closed, 'COLLECTION_STORE_CLOSED');
  const pathFor = id => join(collectionsPath, collectionId(id));

  async function original(id, expected) {
    live();
    const path = pathFor(id);
    let bytes;
    try { bytes = await initializationBytes(join(path, 'manifest.json'), MAX_RECORD_BYTES); }
    catch (error) { if (error.code === 'ENOENT') fail('COLLECTION_NOT_FOUND'); throw error; }
    const manifest = checkedManifest(parse(bytes), id, queueRoot), sha256 = digest(bytes);
    need(expected === undefined || HASH.test(expected) && expected === sha256, 'COLLECTION_MANIFEST_CHANGED');
    need(manifest.directory === path, 'COLLECTION_DIRECTORY_BINDING_CHANGED');
    return { path, bytes, manifest, sha256 };
  }
  async function preparedAt(original) {
    const ready = await optionalRecord(join(original.path, 'prepared.json'), 65536);
    if (ready === null) return false;
    need(ready.schema === 'stellar-forge.sf88.collection-prepared.v1' &&
      ready.manifestSha256 === original.sha256, 'COLLECTION_PREPARATION_CHANGED');
    return true;
  }
  async function readJob(item) {
    let job;
    try { job = await queue.show(item.intentId); }
    catch (error) {
      if (error.code === 'ENOENT' && (item.adoptedOriginalJob ||
          await optionalRecord(join(dirname(item.configFile), 'enqueued.json'), 65536)))
        fail('COLLECTION_ORIGINAL_JOB_MISSING');
      throw error;
    }
    need(originalJobMatches(item, job), 'COLLECTION_ORIGINAL_JOB_CHANGED');
    return job;
  }
  async function runsAt(path) {
    const entries = await readdir(join(path, 'runs'), { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    const runs = [];
    for (const entry of entries) {
      if (!/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      need(entry.isDirectory() && !entry.isSymbolicLink(), 'COLLECTION_RUN_INVALID');
      const request = await optionalRecord(join(path, 'runs', entry.name, 'request.json'));
      if (!request) continue;
      const result = await optionalRecord(join(path, 'runs', entry.name, 'result.json'));
      runs.push({ runId: entry.name, startedAt: request.startedAt, intentIds: request.intentIds,
        state: result?.state ?? 'RUNNING_OR_INTERRUPTED', result });
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async function inspect(id) {
    const saved = await original(id);
    const ready = await preparedAt(saved), items = [];
    for (const item of saved.manifest.items) {
      let job = null, error = null, state = ready ? 'PREPARED' : 'MISSING_INPUT';
      try { job = await readJob(item); state = job.state; }
      catch (cause) {
        if (cause.code !== 'ENOENT') { error = { code: codeOf(cause) }; state = 'REVIEW_REQUIRED'; }
      }
      items.push({ index: item.index, intentId: item.intentId, sourceConfig: item.sourceConfig,
        operation: item.operation, body: item.body, ticket: item.ticket,
        responseDestination: item.responseDestination, state, job, error });
    }
    const common = ['--directory', directory, '--id', id];
    const pinned = [...common, '--manifest-sha256', saved.sha256];
    return { schema: STATUS, id, name: saved.manifest.name, directory: saved.path, queueRoot,
      manifestSha256: saved.sha256, previewSha256: saved.manifest.previewSha256,
      createdAt: saved.manifest.createdAt, state: collectionState(items, ready),
      itemCount: items.length, totals: saved.manifest.totals, items,
      runs: await runsAt(saved.path),
      commands: {
        inspect: [process.execPath, CLI, 'show', ...common],
        enqueue: [process.execPath, CLI, 'enqueue', ...pinned],
        run: [process.execPath, CLI, 'run', ...pinned, '--remaining'],
        export: [process.execPath, CLI, 'export', ...pinned, '--out', '/absolute/new-collection-export'],
      } };
  }
  async function list() {
    live();
    const names = await readdir(collectionsPath, { withFileTypes: true });
    const collections = [];
    for (const entry of names) {
      if (!ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = pathFor(entry.name);
      const marker = async name => lstat(join(path, name)).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      // An unrelated source/export directory is not an interrupted collection.
      if (!await marker('manifest.json') && !await marker('.collection.lock')) continue;
      try {
        const view = await inspect(entry.name);
        const { items, runs, commands, ...summary } = view;
        collections.push(summary);
      } catch (error) {
        collections.push({ id: entry.name, name: entry.name, state: error.code === 'COLLECTION_NOT_FOUND' ? 'PREPARING' : 'REVIEW_REQUIRED',
          directory: pathFor(entry.name), error: { code: codeOf(error) } });
      }
    }
    collections.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id));
    return { schema: ROOT, directory, queueRoot, collections };
  }
  async function create({ id, name, configFiles, expectedPreviewSha256 } = {}) {
    live(); collectionId(id);
    need(typeof name === 'string' && name.trim().length > 0 && name.length <= 160 &&
      !/[\u0000-\u001f\u007f]/.test(name) && HASH.test(expectedPreviewSha256), 'COLLECTION_INVALID_INPUT');
    const destination = pathFor(id);
    await initializationDirectory(destination, { create: true });
    return withLock(destination, async () => {
      let existing = null;
      try { existing = await original(id); }
      catch (error) { if (error.code !== 'COLLECTION_NOT_FOUND') throw error; }
      if (existing) {
        need(existing.manifest.name === name && existing.manifest.previewSha256 === expectedPreviewSha256, 'COLLECTION_ID_CONFLICT');
        if (await preparedAt(existing)) return inspect(id);
      }
      const captured = await capture(configFiles);
      need(captured.preview.previewSha256 === expectedPreviewSha256, 'COLLECTION_PREVIEW_CHANGED');
      const inputs = captured.captures.map(value => itemFiles(value, destination, queueRoot));
      for (const input of inputs) {
        let job;
        try { job = await queue.show(input.entry.intentId); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (job && !originalJobMatches(input.entry, job)) {
          const item = input.entry;
          need((job.sourceConfigSha256 === item.sourceConfig.sha256 ||
              job.configSha256 === item.queueConfigSha256) &&
            same(job.operation, item.queueOperation) && same(job.dependencies, item.dependencies) &&
            job.bodySha256 === (item.body?.sha256 ?? null) &&
            (job.operationTicket?.sha256 ?? null) === (item.ticket?.sha256 ?? null),
            'COLLECTION_ORIGINAL_JOB_CHANGED');
          input.entry = { ...item, queueSourceConfigSha256: job.sourceConfigSha256,
            queueConfigSha256: job.configSha256, adoptedOriginalJob: true };
        }
      }
      const manifest = { schema: MANIFEST, id, name, directory: destination, queueRoot,
        createdAt: existing?.manifest.createdAt ?? date(), previewSha256: expectedPreviewSha256,
        itemCount: inputs.length, totals: captured.preview.totals, items: inputs.map(input => input.entry) };
      need(!existing || same(manifest, existing.manifest), 'COLLECTION_ID_CONFLICT');
      const bytes = json(manifest), manifestSha256 = digest(bytes);
      need(bytes.length <= MAX_RECORD_BYTES, 'COLLECTION_MANIFEST_TOO_LARGE');
      await retainInitializationFile(join(destination, 'manifest.json'), bytes, { resume: true });
      await initializationDirectory(join(destination, 'inputs'), { create: true });
      await initializationDirectory(join(destination, 'runs'), { create: true });
      for (const input of inputs) {
        await initializationDirectory(input.directory, { create: true });
        for (const file of input.files)
          await retainInitializationFile(join(input.directory, file.name), file.bytes, { resume: true });
      }
      await retainInitializationRecord(join(destination, 'prepared.json'),
        { schema: 'stellar-forge.sf88.collection-prepared.v1', manifestSha256, completedAt: date() },
        { resume: true, ignore: ['completedAt'] });
      return inspect(id);
    });
  }
  async function verifyInput(item) {
    const base = dirname(item.configFile);
    for (const file of item.files) {
      let bytes;
      try { bytes = await initializationBytes(join(base, file.name), Math.max(file.bytes, 1)); }
      catch (error) { if (error.code === 'ENOENT') fail('COLLECTION_INPUT_MISSING'); throw error; }
      need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'COLLECTION_INPUT_CHANGED');
    }
    for (const value of Object.values(item.dependencies))
      need(same(await fingerprint(value.path), value), 'COLLECTION_DEPENDENCY_CHANGED');
  }
  async function enqueue({ id, expectedManifestSha256 } = {}) {
    need(HASH.test(expectedManifestSha256), 'COLLECTION_MANIFEST_REQUIRED');
    const initial = await original(id, expectedManifestSha256);
    return withLock(initial.path, async () => {
      const saved = await original(id, expectedManifestSha256);
      need(await preparedAt(saved), 'COLLECTION_INPUT_MISSING');
      const results = [];
      for (const item of saved.manifest.items) {
        try {
          let job;
          try { job = await readJob(item); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (!job) {
            await verifyInput(item);
            job = await queue.enqueue(item.configFile);
            need(originalJobMatches(item, job), 'COLLECTION_ORIGINAL_JOB_CHANGED');
          }
          await retainInitializationRecord(join(dirname(item.configFile), 'enqueued.json'),
            { schema: 'stellar-forge.sf88.collection-enqueued.v1', intentId: item.intentId,
              sourceConfigSha256: job.sourceConfigSha256, configSha256: job.configSha256, observedAt: date() },
            { resume: true, ignore: ['observedAt'] });
          results.push(actionResult(item.intentId, job.state));
        } catch (error) {
          results.push(actionResult(item.intentId, 'REVIEW_REQUIRED', error));
          break;
        }
      }
      return { ...await inspect(id), action: { kind: 'ENQUEUE', results } };
    });
  }
  async function act(kind, { id, intentIds, expectedManifestSha256 } = {}) {
    need(HASH.test(expectedManifestSha256), 'COLLECTION_MANIFEST_REQUIRED');
    const initial = await original(id, expectedManifestSha256);
    return withLock(initial.path, async () => {
      const saved = await original(id, expectedManifestSha256), selected = selection(saved.manifest, intentIds);
      const results = [];
      for (const item of selected) {
        try {
          let job = await readJob(item);
          if (kind === 'CANCEL') {
            if (job.state === 'QUEUED') job = await queue.cancel(item.intentId);
            else if (job.state !== 'CANCELLED') {
              results.push(actionResult(item.intentId, 'ALREADY_ATTEMPTED')); continue;
            }
          } else {
            need(job.attempt?.kind === 'EXECUTE', 'INBOX_EXECUTION_ATTEMPT_REQUIRED');
            job = await queue.recover(item.intentId);
          }
          need(originalJobMatches(item, job), 'COLLECTION_ORIGINAL_JOB_CHANGED');
          results.push(actionResult(item.intentId, job.state));
        } catch (error) { results.push(actionResult(item.intentId, 'REVIEW_REQUIRED', error)); }
      }
      return { ...await inspect(id), action: { kind, results } };
    });
  }
  async function run({ id, intentIds, expectedManifestSha256, signal, workspaceByIntent = {} } = {}) {
    need(HASH.test(expectedManifestSha256), 'COLLECTION_MANIFEST_REQUIRED');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(object(workspaceByIntent) && Object.values(workspaceByIntent).every(value =>
      typeof value === 'string' && isAbsolute(value)), 'COLLECTION_WORKSPACE_MAP_INVALID');
    need(!runBusy, 'COLLECTION_BUSY');
    runBusy = true;
    try {
    const initial = await original(id, expectedManifestSha256);
    const selected = selection(initial.manifest, intentIds);
    need(Object.keys(workspaceByIntent).every(value => intentIds.includes(value)), 'COLLECTION_WORKSPACE_MAP_INVALID');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const completion = withLock(initial.path, async () => {
      const saved = await original(id, expectedManifestSha256);
      need(await preparedAt(saved), 'COLLECTION_INPUT_MISSING');
      const runId = randomUUID(), runPath = join(saved.path, 'runs', runId);
      await initializationDirectory(runPath, { create: true });
      await initializationDirectory(join(runPath, 'entries'), { create: true });
      const request = { schema: 'stellar-forge.sf88.collection-run.v1', runId,
        manifestSha256: saved.sha256, intentIds, startedAt: date(), pid: process.pid, host: hostname() };
      await retainInitializationRecord(join(runPath, 'request.json'), request);
      const results = [];
      let state = 'FINISHED';
      try {
        for (const item of selected) {
          if (controller.signal.aborted) { state = 'PAUSED'; break; }
          let job;
          try {
            job = await readJob(item);
            if (job.state === 'QUEUED') job = await queue.run(item.intentId, {
              signal: controller.signal,
              ...(workspaceByIntent[item.intentId] ? { workspace: workspaceByIntent[item.intentId] } : {}),
            });
            need(originalJobMatches(item, job), 'COLLECTION_ORIGINAL_JOB_CHANGED');
            const result = actionResult(item.intentId, job.state);
            results.push(result);
            await retainInitializationRecord(join(runPath, 'entries', String(item.index) + '.json'),
              { ...result, observedAt: date(), attemptId: job.attempt?.id ?? null });
            if (interruptedOrFailed(job)) { state = controller.signal.aborted ? 'PAUSED' : 'NEEDS_REVIEW'; break; }
          } catch (error) {
            results.push(actionResult(item.intentId, 'REVIEW_REQUIRED', error));
            state = controller.signal.aborted ? 'PAUSED' : 'NEEDS_REVIEW';
            break;
          }
        }
      } finally {
        await retainInitializationRecord(join(runPath, 'result.json'),
          { ...request, completedAt: date(), state, results });
      }
      return { ...await inspect(id), action: { kind: 'RUN', runId, state, results } };
    });
    active = { controller, completion };
    try { return await completion; }
    finally { signal?.removeEventListener('abort', abort); active = null; }
    } finally { runBusy = false; }
  }
  async function exportCollection({ id, directory: out, expectedManifestSha256 } = {}) {
    const saved = await original(id, expectedManifestSha256);
    out = absolute(out);
    need(out !== directory && out !== collectionsPath && !out.startsWith(collectionsPath + '/') &&
      out !== queueRoot && !out.startsWith(queueRoot + '/'), 'COLLECTION_EXPORT_DIRECTORY_CONFLICT');
    await initializationDirectory(out, { create: true });
    return withLock(out, async () => {
      const prior = await optionalRecord(join(out, 'manifest.json'));
      if (prior) {
        need(prior.schema === EXPORT && prior.id === id && prior.manifestSha256 === saved.sha256, 'COLLECTION_EXPORT_CONFLICT');
        const names = ['collection.json', 'results.json', 'requests.csv', 'review.html'];
        need(Array.isArray(prior.files) && prior.files.length === names.length &&
          new Set(prior.files.map(file => file?.name)).size === names.length &&
          prior.files.every(file => names.includes(file?.name) && HASH.test(file.sha256) &&
            Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_RECORD_BYTES),
          'COLLECTION_EXPORT_INVALID');
        for (const file of prior.files) {
          const bytes = await initializationBytes(join(out, file.name), MAX_RECORD_BYTES);
          need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'COLLECTION_EXPORT_CHANGED');
        }
        return { ...prior, directory: out, reused: true };
      }
      let snapshot = await optionalRecord(join(out, 'results.json'));
      if (snapshot) need(snapshot.schema === STATUS && snapshot.id === id && snapshot.manifestSha256 === saved.sha256, 'COLLECTION_EXPORT_CONFLICT');
      else {
        snapshot = await inspect(id);
        await retainInitializationFile(join(out, 'results.json'), json(snapshot));
      }
      const payloads = [
        { name: 'collection.json', bytes: saved.bytes },
        { name: 'results.json', bytes: json(snapshot) },
        { name: 'requests.csv', bytes: Buffer.from(renderCollectionCsv(snapshot)) },
        { name: 'review.html', bytes: Buffer.from(renderCollectionReport(snapshot)) },
      ];
      for (const file of payloads) {
        need(file.bytes.length <= MAX_RECORD_BYTES, 'COLLECTION_EXPORT_TOO_LARGE');
        await retainInitializationFile(join(out, file.name), file.bytes, { resume: true });
      }
      const manifest = { schema: EXPORT, id, manifestSha256: saved.sha256,
        completedAt: date(), files: payloads.map(file =>
          ({ name: file.name, bytes: file.bytes.length, sha256: digest(file.bytes) })) };
      await retainInitializationRecord(join(out, 'manifest.json'), manifest);
      return { ...manifest, directory: out };
    });
  }
  return Object.freeze({
    directory, queueRoot, preview: input => { live(); return previewCollection(input); },
    create, list, inspect, enqueue, run,
    cancel: input => act('CANCEL', input), recover: input => act('RECOVER', input),
    export: exportCollection,
    async close() {
      if (closed) return;
      if (active) {
        active.controller.abort();
        await active.completion.catch(() => {});
      }
      closed = true;
    },
  });
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const cell = value => {
  const text = String(value ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
};
export function renderCollectionCsv(snapshot) {
  const header = ['index', 'intent_id', 'method', 'url', 'network', 'asset', 'recipient',
    'maximum_atomic', 'queue_state', 'http_status', 'buyer_status', 'response_status', 'response_path', 'response_bytes', 'response_sha256'];
  const rows = snapshot.items.map(item => {
    const outcome = item.job?.outcome, response = outcome?.responseFile;
    return [item.index, item.intentId, item.operation.method, item.operation.url,
      item.operation.expect.network, item.operation.expect.asset, item.operation.expect.payTo,
      item.operation.expect.maxAtomic, item.state, outcome?.httpStatus, outcome?.status,
      response?.status, response?.path ?? response?.destination ?? item.responseDestination,
      response?.bytes, response?.sha256].map(cell).join(',');
  });
  return [header.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}
export function renderCollectionReport(snapshot) {
  const rows = snapshot.items.map(item => {
    const outcome = item.job?.outcome, response = outcome?.responseFile;
    return '<tr><td><strong>' + escape(item.intentId) + '</strong><br>' + escape(item.operation.method) +
      ' <code>' + escape(item.operation.url) + '</code></td><td>' + escape(item.state) +
      '</td><td>' + escape(item.operation.expect.maxAtomic) + '<br><small>' +
      escape(item.operation.expect.network) + '<br>' + escape(item.operation.expect.asset) +
      '</small></td><td>' + escape(outcome?.status ?? item.job?.recovery?.observationStatus ?? '') +
      '<br>' + escape(outcome?.httpStatus ?? '') + '</td><td>' + escape(response?.status ?? '') +
      '<br><code>' + escape(response?.path ?? response?.destination ?? item.responseDestination ?? '') +
      '</code><br><small>' + escape(response?.sha256 ?? '') + '</small></td></tr>';
  }).join('');
  const totals = snapshot.totals.map(group => '<tr><td>' + escape(group.network) +
    '</td><td><code>' + escape(group.asset) + '</code></td><td><code>' + escape(group.payTo) +
    '</code></td><td>' + escape(group.paymentFlow) + '</td><td>' + group.itemCount +
    '</td><td>' + group.maxAtomic + '</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escape(snapshot.name) + '</title><style>body{margin:32px auto;padding:0 20px;max-width:1280px;background:#fff;color:#202020;font:15px/1.5 system-ui,sans-serif}h1{font-size:26px}h2{margin-top:32px;font-size:19px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;vertical-align:top;border:1px solid #bbb;overflow-wrap:anywhere}th{background:#eee}code,small{font-size:12px}code{white-space:pre-wrap}dl{display:grid;grid-template-columns:160px 1fr;gap:4px}dd{margin:0;overflow-wrap:anywhere}@media print{body{margin:0;font-size:11px}tr{break-inside:avoid}}</style>' +
    '<h1>' + escape(snapshot.name) + '</h1><p>Customer request collection · ' + escape(snapshot.state) +
    '</p><dl><dt>Collection</dt><dd>' + escape(snapshot.id) + '</dd><dt>Original inbox</dt><dd><code>' +
    escape(snapshot.queueRoot) + '</code></dd><dt>Source review</dt><dd><code>' + escape(snapshot.manifestSha256) +
    '</code></dd><dt>Created</dt><dd>' + escape(snapshot.createdAt) + '</dd></dl>' +
    '<h2>Reviewed maximums</h2><p>Each total sums the selected request caps in one exact network, asset, recipient and payment flow. The original buyer retains actual payment terms and outcomes for every request.</p>' +
    '<table><thead><tr><th>Network</th><th>Asset</th><th>Recipient</th><th>Flow</th><th>Requests</th><th>Maximum atomic</th></tr></thead><tbody>' + totals + '</tbody></table>' +
    '<h2>Original requests and delivery results</h2><table><thead><tr><th>Request</th><th>Inbox state</th><th>Request cap</th><th>Buyer response</th><th>Retained delivery</th></tr></thead><tbody>' +
    rows + '</tbody></table><p>Open results.json for the complete original queue outcomes, recovery records and source paths. Retain the existing inbox, operator ledger, evidence and delivery files alongside this handoff.</p></html>\n';
}
