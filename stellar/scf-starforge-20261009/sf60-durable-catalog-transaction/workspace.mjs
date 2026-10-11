#!/usr/bin/env node
// MIT. Browser operator for the existing SF60 writer. Never signs or pays.
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as FS } from 'node:fs';
import { mkdir, lstat, realpath, open, rename, unlink, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestCatalogOperator } from './operator.mjs';
import { reviewCatalogRevision, assertReviewedRevision, reconcileCatalogRevision } from './workspace-revisions.mjs';
import { validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';

const SCHEMA = 'stellar-forge.catalog-workspace-operation/v1';
const STATE_SCHEMA = 'stellar-forge.catalog-workspace/v1';
const MAX_BODY = 512 * 1024, MAX_RECORD = 5 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fail(code, status = 400) { throw Object.assign(new Error(code), { httpStatus: status }); }
function fields(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_FIELDS');
}
function text(value, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail('INVALID_TEXT');
  return value;
}
function safeCode(error) {
  // Backend parser messages may contain source excerpts. Expose only machine codes.
  const message = String(error?.message ?? 'REQUEST_FAILED');
  return /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(message) ? message : 'REQUEST_FAILED';
}
const now = () => new Date().toISOString();
function privateKeyGuard(value) {
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/.test(stable(value))) fail('PRIVATE_KEY_INPUT_NOT_ALLOWED');
}
async function privateDirectory(path, create = false) {
  const target = resolve(path);
  if (create) await mkdir(target, { recursive: true, mode: 0o700 });
  const meta = await lstat(target);
  if (!meta.isDirectory() || meta.isSymbolicLink() || await realpath(target) !== target ||
      (meta.mode & 0o077) || (process.getuid && meta.uid !== process.getuid())) fail('OWNED_PRIVATE_REAL_DIRECTORY_REQUIRED');
  return target;
}
async function syncDirectory(path) {
  const file = await open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function readPrivate(path, limit = MAX_RECORD) {
  const file = await open(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.nlink !== 1 || (meta.mode & 0o077) ||
        (process.getuid && meta.uid !== process.getuid()) || meta.size < 1 || meta.size > limit) fail('PRIVATE_RECORD_INVALID');
    const buffer = Buffer.alloc(meta.size + 1); let count = 0;
    while (count < buffer.length) {
      const part = await file.read(buffer, count, buffer.length - count, null);
      if (!part.bytesRead) break;
      count += part.bytesRead;
    }
    if (count !== meta.size) fail('PRIVATE_RECORD_CHANGED');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))); }
    catch { fail('PRIVATE_RECORD_JSON_INVALID'); }
  } finally { await file.close(); }
}
async function writePrivate(directory, name, document, exclusive = false) {
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  if (bytes.length > MAX_RECORD) fail('RECORD_TOO_LARGE');
  const target = join(directory, name), temp = exclusive ? target : join(directory, `.${randomUUID()}.tmp`);
  let file, published = false;
  try {
    file = await open(temp, 'wx', 0o600); await file.writeFile(bytes); await file.sync();
    await file.close(); file = null;
    if (!exclusive) await rename(temp, target);
    published = true; await syncDirectory(directory);
  } finally {
    await file?.close();
    if (!published && !exclusive) await unlink(temp).catch(() => {});
  }
}
function verifyRecord(record, expectedId) {
  if (!plain(record) || record.schema !== SCHEMA || record.id !== expectedId || !uuid(record.id) ||
      !['admit', 'apply-withdrawal'].includes(record.operation) ||
      !['prepared', 'sending', 'succeeded', 'rejected', 'unknown'].includes(record.phase) ||
      record.digest !== hash(stable({ operation: record.operation, input: record.input }))) fail('OPERATION_RECORD_INVALID');
  return record;
}
function brief(record) {
  const { declaration, request, ...summary } = record.summary;
  return { id: record.id, operation: record.operation, phase: record.phase, digest: record.digest,
    createdAt: record.createdAt, updatedAt: record.updatedAt, summary: { ...summary, sequence: summary.sequence ?? request?.sequence },
    error: record.error ?? null, policySha256: record.policySha256,
    reconciliation: record.reconciliation?.verdict ?? null };
}
function validateIntent(operation, input) {
  privateKeyGuard(input);
  if (operation === 'admit') {
    fields(input, ['sellerId', 'sequence', 'sourceURL', 'observedAt', 'sourceBase64', 'proofs']);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.sellerId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1) fail('SELLER_OR_SEQUENCE_INVALID');
    if (typeof input.sourceBase64 !== 'string' || input.sourceBase64.length > 87384) fail('SOURCE_SIZE_INVALID');
    const source = Buffer.from(input.sourceBase64, 'base64');
    if (!source.length || source.length > 65536 || source.toString('base64') !== input.sourceBase64) fail('ORIGINAL_SOURCE_BASE64_INVALID');
    let entry;
    try { entry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); }
    catch { fail('OFFER_JSON_INVALID'); }
    privateKeyGuard(entry);
    if (!plain(entry) || !Array.isArray(input.proofs) || input.proofs.length < 1 ||
        Buffer.byteLength(JSON.stringify(input.proofs)) > 384 * 1024) fail('OFFER_OR_PROOFS_INVALID');
    for (const pair of input.proofs) fields(pair, ['nonce', 'proof']);
    if (typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt)) ||
        new Date(input.observedAt).toISOString() !== input.observedAt) fail('CANONICAL_OBSERVATION_TIME_REQUIRED');
    const sourceURL = new URL(text(input.sourceURL));
    if (sourceURL.protocol !== 'https:' || sourceURL.username || sourceURL.password || sourceURL.hash) fail('HTTPS_SOURCE_URL_REQUIRED');
    const validated = validateCatalogEntry(entry);
    return { catalogKey: validated.id, sellerId: input.sellerId, sequence: input.sequence, sourceURL: input.sourceURL,
      observedAt: input.observedAt, sourceSha256: hash(source), sourceBytes: source.length,
      paymentProofs: input.proofs.length, declaration: entry };
  }
  if (operation === 'apply-withdrawal') {
    fields(input, ['envelope']);
    if (!plain(input.envelope) || !plain(input.envelope.request) ||
        Buffer.byteLength(JSON.stringify(input.envelope)) > 128 * 1024) fail('WITHDRAWAL_ENVELOPE_INVALID');
    return { sellerId: text(input.envelope.request.sellerId, 128),
      catalogKey: text(input.envelope.request.catalogKey), request: input.envelope.request };
  }
  fail('UNKNOWN_MUTATION');
}
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') fail('JSON_CONTENT_TYPE_REQUIRED', 415);
  if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > MAX_BODY)) fail('BODY_TOO_LARGE', 413);
  let size = 0; const parts = [];
  for await (const part of req) { size += part.length; if (size > MAX_BODY) fail('BODY_TOO_LARGE', 413); parts.push(part); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { fail('INVALID_JSON'); }
}
function exactToken(received, secret) {
  if (typeof received !== 'string') return false;
  const bytes = Buffer.from(received), expected = Buffer.from(secret);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

/** Attach to an already-running original operator. This server owns only its
 * private UI operation records, never the catalog journal or daemon lifecycle.
 */
export async function openCatalogWorkspace({ directory, stateDirectory, port = 0 } = {}) {
  if (process.platform === 'win32') fail('POSIX_PRIVATE_PERMISSIONS_REQUIRED');
  if (typeof directory !== 'string' || typeof stateDirectory !== 'string') fail('CATALOG_AND_WORKSPACE_DIRECTORIES_REQUIRED');
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('PORT_INVALID');
  directory = await privateDirectory(directory);
  stateDirectory = await privateDirectory(stateDirectory, true);
  if (directory === stateDirectory || stateDirectory.startsWith(directory + '/') || directory.startsWith(stateDirectory + '/')) fail('SEPARATE_WORKSPACE_DIRECTORY_REQUIRED');
  const lockPath = join(stateDirectory, '.workspace.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  let lockIdentity, server, closePromise, closing = false, origin;
  const active = new Set(), requests = new Set(), memoryOutcomes = new Map(), connections = new Set();
  const summaries = new Map();
  let mutationQueue = Promise.resolve(), pendingWrites = 0;
  const secret = randomBytes(32).toString('hex');
  const assetRoot = new URL('./workspace-ui/', import.meta.url);
  const call = (operation, input = {}, requestId) => requestCatalogOperator({ directory, operation, input, ...(requestId ? { requestId } : {}) });
  const recordPath = id => { if (!uuid(id)) fail('INVALID_OPERATION_ID'); return join(stateDirectory, `${id}.json`); };
  const readRecord = async id => memoryOutcomes.get(id) ?? verifyRecord(await readPrivate(recordPath(id)), id);
  const save = async (record, exclusive = false) => {
    await writePrivate(stateDirectory, `${record.id}.json`, record, exclusive);
    memoryOutcomes.delete(record.id); summaries.set(record.id, brief(record));
  };
  const serialize = fn => {
    if (closing) return Promise.reject(Object.assign(new Error('WORKSPACE_CLOSING'), { httpStatus: 503 }));
    if (pendingWrites >= 16) return Promise.reject(Object.assign(new Error('WORKSPACE_BUSY'), { httpStatus: 503 }));
    pendingWrites++;
    const job = mutationQueue.then(fn);
    mutationQueue = job.catch(() => {}).finally(() => { pendingWrites--; });
    return job;
  };
  const removeLock = async () => {
    await lock.close();
    const current = await lstat(lockPath);
    if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) {
      await unlink(lockPath); await syncDirectory(stateDirectory);
    }
  };
  const listOperations = async (offset, limit) => {
    // Keep only compact metadata in memory; selecting an operation reads its
    // full original input/result. Paging never rereads all uploaded files.
    const rows = [...summaries.values()];
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit) };
  };
  const perform = async (id, digest) => {
    const record = await readRecord(id);
    if (record.digest !== digest) fail('REVIEW_DIGEST_CHANGED', 409);
    if (record.phase !== 'prepared') return record; // Never replay sent operations.
    const status = await call('status');
    if (status.policySha256 !== record.policySha256) fail('SELLER_POLICY_CHANGED_REVIEW_AGAIN', 409);
    await assertReviewedRevision(record, call);
    record.phase = 'sending'; record.updatedAt = now();
    await save(record); // Durable intent precedes any possible native send.
    try {
      record.result = await call(record.operation, record.input, record.id);
      record.phase = 'succeeded';
    } catch (error) {
      record.phase = error.commandSent === true && !Number.isInteger(error.statusCode) ? 'unknown' : 'rejected';
      record.error = safeCode(error);
      record.commandSent = error.commandSent === true;
      if (Number.isInteger(error.statusCode)) record.backendStatus = error.statusCode;
    }
    record.updatedAt = now();
    try { await save(record); }
    catch {
      // A known success stays recoverable in this process even if persistence
      // fails. On restart the durable 'sending' record becomes unknown.
      record.persistenceError = 'OUTCOME_NOT_SAVED_EXPORT_NOW';
      memoryOutcomes.set(id, structuredClone(record)); summaries.set(id, brief(record));
    }
    return record;
  };
  function headers(res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }
  const send = (res, status, result) => {
    if (res.destroyed || res.writableEnded) return;
    const bytes = JSON.stringify(result);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(bytes) }); res.end(bytes);
  };
  const pageInt = (value, fallback, max) => {
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail('PAGINATION_INVALID');
    return Number(value);
  };
  async function route(req, res) {
    headers(res);
    const hostCount = req.rawHeaders.filter((_, i) => i % 2 === 0).filter(name => name.toLowerCase() === 'host').length;
    if (!origin || req.socket.localAddress !== '127.0.0.1' || req.socket.remoteAddress !== '127.0.0.1' ||
        req.headers.host !== origin.slice(7) || hostCount !== 1) fail('LOCAL_HOST_REQUIRED', 403);
    if (closing) fail('WORKSPACE_CLOSING', 503);
    const url = new URL(req.url, origin);
    if (url.origin !== origin || url.hash || [...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size) fail('REQUEST_URL_INVALID');
    if (req.headers.origin && req.headers.origin !== origin) fail('SAME_ORIGIN_REQUIRED', 403);
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) fail('SAME_ORIGIN_REQUIRED', 403);
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/revisions.js': ['revisions.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (Object.hasOwn(assets, url.pathname) && req.method === 'GET') {
      if (url.search) fail('STATIC_QUERY_NOT_ALLOWED');
      const [name, type] = assets[url.pathname];
      const bytes = await readFile(new URL(name, assetRoot));
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'content-length': bytes.length }); res.end(bytes); return;
    }
    if (!url.pathname.startsWith('/api/')) fail('NOT_FOUND', 404);
    if (!exactToken(req.headers['x-workspace-token'], secret)) fail('WORKSPACE_SESSION_REQUIRED', 401);
    if (req.method === 'POST' && req.headers.origin !== origin) fail('SAME_ORIGIN_REQUIRED', 403);
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await call('status'));
    if (req.method === 'GET' && ['/api/list', '/api/search'].includes(url.pathname)) {
      const params = Object.fromEntries(url.searchParams);
      if (Object.keys(params).length > 16) fail('QUERY_PARAMETERS_INVALID');
      const page = await call(url.pathname.slice(5), { params });
      return send(res, 200, { ...page, resources: page.resources.map(entry => ({ ...entry, catalogKey: validateCatalogEntry(entry).id })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/lookup') return send(res, 200, await call('lookup', { catalogKey: text(url.searchParams.get('key')) }));
    if (req.method === 'GET' && url.pathname === '/api/history') return send(res, 200, await call('history', { lifecycleId: text(url.searchParams.get('id')) }));
    if (req.method === 'GET' && url.pathname === '/api/operations') {
      const offset = pageInt(url.searchParams.get('offset'), 0, 1000000), limit = pageInt(url.searchParams.get('limit'), 20, 100);
      if (!limit) fail('PAGINATION_INVALID');
      return send(res, 200, await listOperations(offset, limit));
    }
    const selected = url.pathname.match(/^\/api\/operations\/([a-f0-9-]+)(\/inspect)?$/);
    if (req.method === 'GET' && selected) {
      const record = await readRecord(selected[1]);
      if (!selected[2]) return send(res, 200, record);
      const currentStatus = await call('status');
      const observed = await reconcileCatalogRevision(record, call, { includeInspection: true });
      const { inspection, ...reconciliation } = observed ?? {};
      const catalogKey = record.summary.catalogKey ?? record.result?.catalogKey;
      const lookup = inspection?.lookup ?? (catalogKey ? await call('lookup', { catalogKey }) : null);
      const lifecycleId = lookup?.current?.lifecycleId ?? record.result?.lifecycleId;
      const history = inspection?.history ?? (lifecycleId ? await call('history', { lifecycleId }) : null);
      return send(res, 200, { operation: brief(record), status: currentStatus, lookup, history,
        reconciliation: observed ? reconciliation : null,
        interpretation: 'Inspection does not resubmit or change the recorded outcome. A matching original revision is an observation, not a reconstructed command receipt.' });
    }
    const reconciliationTarget = url.pathname.match(/^\/api\/operations\/([a-f0-9-]+)\/reconcile$/);
    if (req.method === 'POST' && reconciliationTarget) {
      const input = await body(req); fields(input, ['digest']);
      return send(res, 200, await serialize(async () => {
        const record = await readRecord(reconciliationTarget[1]);
        if (record.digest !== input.digest) fail('REVIEW_DIGEST_CHANGED', 409);
        const observation = await reconcileCatalogRevision(record, call);
        if (!observation) fail('RECONCILIATION_NOT_SUPPORTED');
        record.reconciliation = observation; record.updatedAt = now();
        // Keep the original phase and receipt, including a known outcome that
        // previously survived only in memory. Saving does not send a command.
        const previousPersistenceError = record.persistenceError;
        delete record.persistenceError;
        try { await save(record); }
        catch {
          record.persistenceError = previousPersistenceError ?? 'RECONCILIATION_NOT_SAVED_EXPORT_NOW';
          memoryOutcomes.set(record.id, structuredClone(record)); summaries.set(record.id, brief(record));
        }
        return record;
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/review') {
      const input = await body(req); fields(input, ['operation', 'input']);
      const summary = validateIntent(input.operation, input.input);
      if (Buffer.byteLength(JSON.stringify(input)) > MAX_BODY - 1024) fail('COMMAND_TOO_LARGE', 413);
      return send(res, 201, await serialize(async () => {
        const status = await call('status');
        if (!status.sellers.some(seller => seller.sellerId === summary.sellerId)) fail('SELLER_NOT_IN_STARTUP_POLICY');
        const createdAt = now(), record = { schema: SCHEMA, id: randomUUID(), operation: input.operation,
          input: input.input, summary, digest: hash(stable(input)), phase: 'prepared', createdAt, updatedAt: createdAt,
          policySha256: status.policySha256, reviewedJournalHead: status.journalHead };
        record.revisionReview = await reviewCatalogRevision(record, call);
        await save(record, true); return record;
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/execute') {
      const input = await body(req); fields(input, ['id', 'digest']);
      if (!uuid(input.id) || typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest)) fail('INVALID_REVIEW_REFERENCE');
      return send(res, 200, await serialize(() => perform(input.id, input.digest)));
    }
    if (req.method === 'POST' && url.pathname === '/api/prepare-withdrawal') {
      const input = await body(req); fields(input, ['sellerId', 'catalogKey', 'sourceURL', 'reason']);
      privateKeyGuard(input);
      for (const key of Object.keys(input)) text(input[key], key === 'reason' ? 512 : 4096);
      return send(res, 200, await call('prepare-withdrawal', input));
    }
    fail('NOT_FOUND', 404);
  }
  try {
    lockIdentity = await lock.stat(); await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now() }) + '\n'); await lock.sync();
    const binding = hash(directory); let config;
    try { config = await readPrivate(join(stateDirectory, 'workspace.json'), 4096); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      config = { schema: STATE_SCHEMA, catalogDirectorySha256: binding, createdAt: now() };
      await writePrivate(stateDirectory, 'workspace.json', config, true);
    }
    if (config.schema !== STATE_SCHEMA || config.catalogDirectorySha256 !== binding) fail('WORKSPACE_CATALOG_BINDING_MISMATCH');
    for (const name of await readdir(stateDirectory)) {
      const id = name.slice(0, -5);
      if (!name.endsWith('.json') || !uuid(id)) continue;
      const record = await readRecord(id);
      summaries.set(id, brief(record));
      if (record.phase === 'sending') {
        record.phase = 'unknown'; record.error = 'WORKSPACE_INTERRUPTED_AFTER_INTENT'; record.updatedAt = now(); await save(record);
      }
    }
    await call('status'); // Fail startup without an actual original daemon.
    server = createServer((req, res) => {
      requests.add(req); req.once('close', () => requests.delete(req));
      const job = route(req, res).catch(error => {
        if (error.code === 'ENOENT') send(res, 404, { error: 'NOT_FOUND' });
        else send(res, error.httpStatus ?? (Number.isInteger(error.statusCode) ? 422 : 502), { error: safeCode(error) });
      });
      active.add(job); job.finally(() => active.delete(job));
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
    server.maxHeadersCount = 32;
    server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    origin = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    if (server?.listening) await new Promise(done => server.close(done));
    await removeLock().catch(() => {}); throw error;
  }
  return {
    origin,
    // Session token only in a URL fragment, never sent in navigation or logs.
    // Treat this return value / private CLI launch file as an access capability.
    launchURL: `${origin}/#${secret}`,
    close() {
      if (!closePromise) closePromise = (async () => {
        closing = true;
        const stopped = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
        server.closeIdleConnections();
        // Incomplete browser bodies have not entered the command queue. End
        // them now; fully admitted native commands retain completion ownership.
        for (const req of requests) if (!req.complete) req.destroy();
        await mutationQueue;
        await Promise.allSettled([...active]);
        for (const socket of connections) socket.destroy();
        await stopped; await removeLock();
      })();
      return closePromise;
    },
  };
}

const USAGE = 'node workspace.mjs --directory ORIGINAL_CATALOG --state PRIVATE_UI_STATE --launch-file NEW_PRIVATE_FILE [--port 0]';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let service, launch;
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(USAGE);
    else {
      if (args.length % 2) fail(USAGE);
      const options = {}, seen = new Set(); let launchFile;
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!['--directory', '--state', '--launch-file', '--port'].includes(key) || seen.has(key) || !value || value.startsWith('--')) fail(USAGE);
        seen.add(key);
        if (key === '--directory') options.directory = value;
        if (key === '--state') options.stateDirectory = value;
        if (key === '--launch-file') launchFile = value;
        if (key === '--port') { if (!/^\d{1,5}$/.test(value)) fail('PORT_INVALID'); options.port = Number(value); }
      }
      if (!launchFile) fail(USAGE);
      launch = await open(launchFile, 'wx', 0o600);
      service = await openCatalogWorkspace(options);
      await launch.writeFile(service.launchURL + '\n'); await launch.sync(); await launch.close(); launch = null;
      console.log(JSON.stringify({ state: 'LISTENING', origin: service.origin, launchFile: resolve(launchFile), instructions: 'Open the URL in the private launch file in your local browser. Do not share or commit that file.' }));
      const stop = () => service.close().catch(error => { console.error(safeCode(error)); process.exitCode = 1; });
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    }
  } catch (error) {
    await launch?.close(); await service?.close();
    console.error(error.message === USAGE ? USAGE : safeCode(error)); process.exitCode = 1;
  }
}
