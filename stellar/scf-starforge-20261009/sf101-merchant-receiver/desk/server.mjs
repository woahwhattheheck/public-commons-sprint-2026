// MIT. Private order operations over the original SF101 checkout and access APIs.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { initializeMerchant, inspectOrder, prepareHandoff } from '../checkout.mjs';
import { orderHandoff, readCheckout, reference } from '../checkout-config.mjs';

const HOST = '127.0.0.1';
const WORKER = fileURLToPath(new URL('./access-worker.py', import.meta.url));
const ORIGINAL_ACCESS = fileURLToPath(new URL('../access.py', import.meta.url));
const MAX_PRODUCT_BYTES = 32 * 1024 * 1024;
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/desk.mjs', ['desk.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const RESPONSE_HEADERS = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const CONFLICTS = new Set([
  'ACCESS_REVISION_CONFLICT', 'OPERATION_ID_REUSED_WITH_DIFFERENT_REQUEST', 'TOKEN_REVISION_CONFLICT',
  'ACCESS_ALREADY_SUSPENDED', 'ACCESS_ALREADY_ENABLED', 'EXPIRY_UNCHANGED', 'NO_EXPIRY_CONFIGURED',
  'TOKEN_UNCHANGED', 'ORDER_NOT_ENTITLED', 'ORDER_ALREADY_ENROLLED', 'MERCHANT_STORE_NOT_INITIALIZED',
  'ORIGINAL_STORE_CONFLICT', 'EXPORT_ALREADY_EXISTS', 'SAVED_HANDOFF_DOES_NOT_MATCH_ORDER',
  'EXPORT_CHANGED',
]);

export class MerchantDeskError extends Error {
  constructor(code, status = 422) { super(code); this.code = code; this.status = status; }
}
const need = (condition, code, status) => { if (!condition) throw new MerchantDeskError(code, status); };
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, required = [], optional = []) {
  need(object(value), 'JSON_OBJECT_REQUIRED');
  need(required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'DESK_FIELDS_INVALID');
}
function text(value, limit, code) {
  need(typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value), code);
  return value;
}
function normalizedPath(value) {
  need(typeof value === 'string' && isAbsolute(value) && value !== sep && resolve(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value), 'NORMALIZED_PRIVATE_PATH_REQUIRED');
  return value;
}
function within(root, path) { return path === root || path.startsWith(root + sep); }
async function privateDirectory(path, { allowAbsent = false } = {}) {
  normalizedPath(path);
  try {
    const info = await lstat(path);
    need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && await realpath(path) === path,
      'PRIVATE_REAL_DIRECTORY_REQUIRED');
    return true;
  } catch (error) {
    if (!allowAbsent || error.code !== 'ENOENT') throw error;
    await privateDirectory(resolve(path, '..'));
    return false;
  }
}
async function privateFile(path, maximum) {
  normalizedPath(path);
  need(await realpath(path) === path, 'PRIVATE_REAL_FILE_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && (info.mode & 0o077) === 0 && info.size > 0 && info.size <= maximum,
      'PRIVATE_REGULAR_FILE_REQUIRED');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
function relativeFileName(value) {
  text(value, 2048, 'APPROVED_FILE_NAME_INVALID');
  need(!isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'),
    'APPROVED_FILE_NAME_INVALID');
  return value;
}
function checkoutReference(value) {
  // These references cannot round-trip the original checkout's argparse or
  // delivery-URL interface. Existing inventory/access references stay native.
  need(reference(value) && !value.startsWith('-') && value !== '.' && value !== '..',
    'CHECKOUT_ORDER_REFERENCE_INVALID');
  return value;
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function fingerprint(handle) {
  const digest = createHash('sha256');
  for await (const bytes of handle.createReadStream({ autoClose: false, start: 0 })) digest.update(bytes);
  return digest.digest('hex');
}
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function environment(provided, claimEnv) {
  const env = { PYTHONDONTWRITEBYTECODE: '1' };
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT'])
    if (typeof provided[name] === 'string') env[name] = provided[name];
  if (claimEnv) env[claimEnv] = provided[claimEnv];
  return env;
}
function errorCode(error) {
  const code = error?.code ?? error?.message;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(code) && code.includes('_')
    ? code : 'MERCHANT_DESK_UNAVAILABLE';
}
function statusFor(error) {
  const code = errorCode(error);
  if (CONFLICTS.has(code)) return 409;
  if (code === 'ORDER_NOT_FOUND' || code === 'EXPORT_NOT_FOUND') return 404;
  if (Number.isInteger(error?.status)) return error.status;
  if (/UNAVAILABLE|OUTCOME_UNKNOWN|TIMED_OUT|WORKER|START_FAILED|OPERATION_FAILED|SOURCE_REQUIRED/.test(code)) return 503;
  return 422;
}
function query(url, permitted) {
  const keys = [...url.searchParams.keys()];
  need(new Set(keys).size === keys.length && keys.every(key => permitted.includes(key)), 'DESK_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
function pageLimit(raw, fallback = 100) {
  if (raw === undefined) return fallback;
  need(typeof raw === 'string' && /^[1-9][0-9]{0,2}$/.test(raw) && Number(raw) <= 500,
    'LIMIT_MUST_BE_1_TO_500');
  return Number(raw);
}
async function requestBody(req) {
  need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''), 'JSON_CONTENT_TYPE_REQUIRED', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    need(size <= 16384, 'DESK_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new MerchantDeskError('DESK_JSON_INVALID', 400); }
}

/** Start the owner-local desk; the caller owns signals and private URL output. */
export async function startMerchantDesk({ config, filesRoot, outputRoot, claimEnvs = [],
  actor = 'merchant-operator', port = 0, env = process.env } = {}) {
  normalizedPath(config); normalizedPath(filesRoot); normalizedPath(outputRoot);
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'DESK_PORT_INVALID');
  text(actor, 120, 'INVALID_ACTOR');
  need(Array.isArray(claimEnvs) && claimEnvs.length <= 32 && new Set(claimEnvs).size === claimEnvs.length &&
    claimEnvs.every(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(name)), 'CLAIM_ENV_NAMES_INVALID');
  const configFile = await privateFile(config, 131072); await configFile.handle.close();
  await privateDirectory(filesRoot); await privateDirectory(outputRoot);
  const compiled = await readCheckout(config);
  await privateDirectory(compiled.state, { allowAbsent: true });
  need(!within(filesRoot, config) && [outputRoot, compiled.state, compiled.outbox]
    .every(path => !within(filesRoot, path) && !within(path, filesRoot)), 'PRODUCT_ROOT_MUST_EXCLUDE_MERCHANT_STATE');
  need(!within(compiled.state, outputRoot) && !within(outputRoot, compiled.state) &&
    !within(compiled.outbox, outputRoot) && !within(outputRoot, compiled.outbox), 'EXPORT_ROOT_MUST_EXCLUDE_MERCHANT_STATE');
  need(!within(compiled.state, compiled.outbox) && !within(compiled.outbox, compiled.state),
    'ORIGINAL_STATE_AND_OUTBOX_MUST_BE_SEPARATE');
  try { const source = await lstat(ORIGINAL_ACCESS); need(source.isFile() && !source.isSymbolicLink(), 'ORIGINAL_ACCESS_SOURCE_REQUIRED', 503); }
  catch { throw new MerchantDeskError('ORIGINAL_ACCESS_SOURCE_REQUIRED', 503); }
  const provided = environment(env);
  const allowedEnvs = [...claimEnvs];
  for (const name of allowedEnvs) if (typeof env[name] === 'string') provided[name] = env[name];
  function claimAvailable(name) {
    const size = typeof provided[name] === 'string' ? Buffer.byteLength(provided[name]) : 0;
    return size >= 32 && size <= 1024;
  }
  function claimName(name) {
    need(allowedEnvs.includes(name) && claimAvailable(name), 'APPROVED_CLAIM_ENV_UNAVAILABLE');
    return name;
  }
  const assets = new Map(await Promise.all([...ASSETS].map(async ([url, [filename, type]]) =>
    [url, { type, bytes: await readFile(new URL(filename, import.meta.url)) }])));
  const capability = randomBytes(32).toString('hex');
  const expectedAuthorization = Buffer.from('Bearer ' + capability);
  const exports = new Map();
  const operations = new Set();
  let origin, stopping = false, closing, activeWorkers = 0, pendingMutations = 0;
  let mutationTail = Promise.resolve();

  function worker(action, args = {}, { claimEnv, mutation = false } = {}) {
    need(activeWorkers < 8, 'MERCHANT_DESK_BUSY', 503);
    activeWorkers += 1;
    return new Promise((done, fail) => {
      let child, timer, finished = false, timedOut = false, overflow = false, size = 0;
      const chunks = [];
      const settle = (error, result) => {
        if (finished) return; finished = true; clearTimeout(timer); activeWorkers -= 1;
        if (error) fail(error); else done(result);
      };
      try {
        child = spawn(compiled.python.options.executable, [WORKER], {
          env: environment(provided, claimEnv), stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true,
        });
      } catch { settle(new MerchantDeskError('ORIGINAL_ACCESS_START_FAILED', 503)); return; }
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, action === 'support' ? 60000 : 15000);
      child.once('error', () => settle(new MerchantDeskError('ORIGINAL_ACCESS_START_FAILED', 503)));
      child.stdout.on('data', bytes => {
        size += bytes.length;
        if (size > 2 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
        else chunks.push(bytes);
      });
      child.stdin.on('error', () => {});
      child.once('close', code => {
        if (timedOut || overflow) return settle(new MerchantDeskError(mutation
          ? 'ORIGINAL_ACCESS_OUTCOME_UNKNOWN' : 'ORIGINAL_ACCESS_WORKER_LIMIT', 503));
        let response;
        try { response = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return settle(new MerchantDeskError(mutation ? 'ORIGINAL_ACCESS_OUTCOME_UNKNOWN' : 'ORIGINAL_ACCESS_RESULT_INVALID', 503)); }
        if (response?.ok === false && typeof response.error === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(response.error))
          return settle(new MerchantDeskError(response.error, statusFor({ code: response.error })));
        if (code !== 0 || response?.ok !== true || !object(response.result))
          return settle(new MerchantDeskError(mutation ? 'ORIGINAL_ACCESS_OUTCOME_UNKNOWN' : 'ORIGINAL_ACCESS_RESULT_INVALID', 503));
        settle(null, response.result);
      });
      child.stdin.end(JSON.stringify({ action, state: compiled.state, arguments: args }));
    });
  }
  function mutate(operation) {
    need(!stopping && pendingMutations < 32, 'MERCHANT_DESK_BUSY', 503);
    pendingMutations += 1;
    const promise = mutationTail.then(operation);
    mutationTail = promise.catch(() => {});
    return promise.finally(() => { pendingMutations -= 1; });
  }
  async function initialized() {
    if (!await privateDirectory(compiled.state, { allowAbsent: true })) return false;
    try {
      const file = await privateFile(join(compiled.state, 'merchant.sqlite3'), Number.MAX_SAFE_INTEGER);
      await file.handle.close(); return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function requireStore() { need(await initialized(), 'MERCHANT_STORE_NOT_INITIALIZED', 409); }
  async function registerExport(name) {
    await privateDirectory(outputRoot);
    const { handle, info } = await privateFile(join(outputRoot, name), MAX_EXPORT_BYTES);
    try {
      const sha256 = await fingerprint(handle);
      need(sameFile(info, await handle.stat()), 'EXPORT_CHANGED', 409);
      const metadata = { name, bytes: info.size, sha256, download: '/api/exports/' + encodeURIComponent(name) };
      exports.set(name, { ...metadata, info });
      return metadata;
    } finally { await handle.close(); }
  }
  async function listFiles(after, limit) {
    await privateDirectory(filesRoot);
    if (after !== undefined) relativeFileName(after);
    const files = [], todo = [filesRoot]; let inspected = 0, skipped = 0;
    while (todo.length) {
      const directory = todo.pop();
      const stream = await opendir(directory);
      for await (const entry of stream) {
        inspected += 1;
        need(inspected <= 10000, 'FILES_ROOT_TOO_LARGE');
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) { skipped += 1; continue; }
        if (entry.isDirectory()) {
          need(relative(filesRoot, path).split(sep).length <= 64, 'FILES_ROOT_TOO_DEEP');
          need(await realpath(path) === path, 'APPROVED_FILE_CHANGED');
          todo.push(path); continue;
        }
        if (!entry.isFile()) { skipped += 1; continue; }
        let info;
        try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') { skipped += 1; continue; } throw error; }
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > MAX_PRODUCT_BYTES) {
          skipped += 1; continue;
        }
        const name = relative(filesRoot, path).split(sep).join('/');
        try { relativeFileName(name); } catch { skipped += 1; continue; }
        files.push({ name, bytes: info.size });
      }
    }
    files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const selected = files.filter(file => after === undefined || file.name > after);
    const page = selected.slice(0, limit);
    return { schema: 'stellar-forge.sf101.desk-files.v1', files: page,
      nextAfter: selected.length > limit ? page.at(-1).name : null, skipped };
  }
  async function handoff(ref, enrollment) {
    checkoutReference(ref);
    await requireStore(); await privateDirectory(outputRoot);
    const name = 'handoff-' + hash(ref) + '.json', output = join(outputRoot, name);
    if (enrollment) {
      let existing = false;
      try { await worker('show', { ref }); existing = true; }
      catch (error) { if (errorCode(error) !== 'ORDER_NOT_FOUND') throw error; }
      need(!existing, 'ORDER_ALREADY_ENROLLED', 409);
      const file = join(filesRoot, relativeFileName(enrollment.file));
      need(within(filesRoot, file), 'APPROVED_FILE_NAME_INVALID');
      await privateDirectory(filesRoot);
      const approved = await privateFile(file, MAX_PRODUCT_BYTES); await approved.handle.close();
      const result = await prepareHandoff(compiled, { ref, output, file,
        claimEnv: claimName(enrollment.claimEnv), env: provided });
      const { output: _privateOutput, ...summary } = result;
      return { ...summary, ...await registerExport(name) };
    }
    // A deterministic create-only handoff survives a lost browser response and
    // desk restart. Reuse requires equality with the original order and terms.
    try {
      const saved = await privateFile(output, 131072);
      let value;
      try { value = JSON.parse(await saved.handle.readFile({ encoding: 'utf8' })); }
      finally { await saved.handle.close(); }
      const order = await inspectOrder(compiled, ref);
      need(canonical(value) === canonical(orderHandoff(compiled, order)), 'SAVED_HANDOFF_DOES_NOT_MATCH_ORDER', 409);
      return { status: 'ORIGINAL_ORDER_HANDOFF_RECOVERED', orderReference: ref,
        originalOrderState: order.state, sourceSha256: order.sourceSha256, sourceBytes: order.sourceBytes,
        ...await registerExport(name) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await prepareHandoff(compiled, { ref, output });
    const { output: _privateOutput, ...summary } = result;
    return { ...summary, ...await registerExport(name) };
  }
  function reply(req, res, status, value, type = 'application/json; charset=utf-8', extra = {}) {
    if (res.destroyed || res.writableEnded) return;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(type.startsWith('application/json') ? JSON.stringify(value) : value);
    res.writeHead(status, { ...RESPONSE_HEADERS, 'content-type': type, 'content-length': bytes.length, ...extra });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  async function download(req, res, name) {
    const saved = exports.get(name);
    need(saved, 'EXPORT_NOT_FOUND', 404);
    await privateDirectory(outputRoot);
    const { handle, info } = await privateFile(join(outputRoot, name), MAX_EXPORT_BYTES);
    try {
      need(sameFile(saved.info, info) && await fingerprint(handle) === saved.sha256 && sameFile(info, await handle.stat()),
        'EXPORT_CHANGED', 409);
      res.writeHead(200, { ...RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8',
        'content-length': saved.bytes, 'content-disposition': `attachment; filename="${name}"` });
      await pipeline(handle.createReadStream({ start: 0, autoClose: false }), res);
    } finally { await handle.close().catch(() => {}); }
  }
  async function handleRequest(req, res) {
    need(!stopping, 'MERCHANT_DESK_STOPPING', 503);
    let hostCount = 0, authorizationCount = 0, originCount = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (name === 'host') hostCount += 1;
      if (name === 'authorization') authorizationCount += 1;
      if (name === 'origin') originCount += 1;
    }
    need(hostCount === 1 && req.headers.host === new URL(origin).host && originCount <= 1 &&
      (!req.headers.origin || req.headers.origin === origin) &&
      !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'PRIVATE_DESK_ORIGIN_REQUIRED', 403);
    need(typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//') &&
      req.url.length <= 8192 && !/[\x00-\x20\x7f\\]/.test(req.url), 'DESK_TARGET_INVALID', 400);
    const url = new URL(req.url, origin);
    if (['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname) && !url.search) {
      const asset = assets.get(url.pathname); return reply(req, res, 200, asset.bytes, asset.type);
    }
    need(url.pathname.startsWith('/api/'), 'DESK_ROUTE_NOT_FOUND', 404);
    const supplied = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
    need(authorizationCount === 1 && supplied.length === expectedAuthorization.length &&
      timingSafeEqual(supplied, expectedAuthorization), 'PRIVATE_DESK_CAPABILITY_REQUIRED', 401);
    if (req.method === 'GET') {
      if (url.pathname === '/api/session') {
        query(url, []);
        const ready = await initialized();
        const native = ready ? await worker('status') : null;
        const route = compiled.service.routes[0];
        return reply(req, res, 200, { schema: 'stellar-forge.sf101.merchant-desk.v1', initialized: ready, native,
          checkout: { routeId: route.id, method: 'GET', resourceUrl: route.offer.resource.url,
            description: route.offer.resource.description ?? route.description ?? '', payment: structuredClone(compiled.terms) },
          roots: { filesRoot, outputRoot }, actor,
          claimEnvs: allowedEnvs.map(name => ({ name, available: claimAvailable(name) })) });
      }
      if (url.pathname === '/api/files') {
        const q = query(url, ['after', 'limit']);
        return reply(req, res, 200, await listFiles(q.after, pageLimit(q.limit)));
      }
      if (url.pathname === '/api/orders') {
        const q = query(url, ['after', 'limit', 'status']); await requireStore();
        return reply(req, res, 200, await worker('list', { ...(q.after ? { after: q.after } : {}),
          limit: pageLimit(q.limit), status: q.status ?? 'all' }));
      }
      if (url.pathname.startsWith('/api/orders/')) {
        query(url, []); const ref = decodeURIComponent(url.pathname.slice('/api/orders/'.length));
        need(reference(ref), 'ORDER_REFERENCE_INVALID'); await requireStore();
        return reply(req, res, 200, await worker('show', { ref }));
      }
      if (url.pathname.startsWith('/api/exports/')) {
        query(url, []); const name = decodeURIComponent(url.pathname.slice('/api/exports/'.length));
        return download(req, res, name);
      }
      throw new MerchantDeskError('DESK_ROUTE_NOT_FOUND', 404);
    }
    need(req.method === 'POST', 'DESK_METHOD_NOT_ALLOWED', 405);
    query(url, []);
    const input = await requestBody(req);
    if (url.pathname === '/api/initialize') {
      fields(input);
      return reply(req, res, 200, await mutate(async () => {
        await privateDirectory(compiled.state, { allowAbsent: true });
        const result = await initializeMerchant(compiled);
        return { ...result, initialized: true };
      }));
    }
    if (url.pathname === '/api/enroll') {
      fields(input, ['ref', 'file', 'claimEnv']);
      return reply(req, res, 201, await mutate(() => handoff(input.ref, input)));
    }
    if (url.pathname === '/api/handoff') {
      fields(input, ['ref']);
      return reply(req, res, 200, await mutate(() => handoff(input.ref)));
    }
    if (url.pathname === '/api/file-health') {
      fields(input, ['ref']); await requireStore();
      need(reference(input.ref), 'ORDER_REFERENCE_INVALID');
      return reply(req, res, 200, await worker('verify-file', { ref: input.ref }));
    }
    if (url.pathname === '/api/access') {
      fields(input, ['ref', 'action', 'expectedRevision', 'operationId', 'reason'], ['expiresAt', 'claimEnv']);
      need(reference(input.ref), 'ORDER_REFERENCE_INVALID');
      need(Number.isInteger(input.expectedRevision) && input.expectedRevision >= 0 && input.expectedRevision < 2147483647,
        'INVALID_EXPECTED_REVISION');
      text(input.reason, 500, 'INVALID_REASON');
      need(typeof input.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId), 'INVALID_OPERATION_ID');
      need(['suspend', 'resume', 'expire', 'clear-expiry', 'rotate-token'].includes(input.action), 'INVALID_ACTION');
      if (input.action !== 'expire') need(!Object.hasOwn(input, 'expiresAt'), 'EXPIRY_ONLY_FOR_EXPIRE_ACTION');
      if (input.action !== 'rotate-token') need(!Object.hasOwn(input, 'claimEnv'), 'CLAIM_ENV_ONLY_FOR_TOKEN_ROTATION');
      const selectedEnv = input.action === 'rotate-token' ? claimName(input.claimEnv) : undefined;
      return reply(req, res, 200, await mutate(async () => {
        await requireStore();
        return worker('access', { ...input, actor }, { claimEnv: selectedEnv, mutation: true });
      }));
    }
    if (url.pathname === '/api/support' || url.pathname === '/api/receipt') {
      const receipt = url.pathname === '/api/receipt';
      fields(input, receipt ? ['ref'] : []);
      if (receipt) need(reference(input.ref), 'ORDER_REFERENCE_INVALID');
      return reply(req, res, 201, await mutate(async () => {
        await requireStore(); await privateDirectory(outputRoot);
        const name = (receipt ? 'receipt-' + hash(input.ref).slice(0, 16) : 'support') + '-' + Date.now() + '-' + randomBytes(8).toString('hex') + '.json';
        const result = await worker(receipt ? 'receipt' : 'support', { output: join(outputRoot, name), ...(receipt ? { ref: input.ref } : {}) });
        const { path: _privatePath, ...summary } = result;
        return { ...summary, ...await registerExport(name) };
      }));
    }
    throw new MerchantDeskError('DESK_ROUTE_NOT_FOUND', 404);
  }
  const server = createServer((req, res) => {
    const operation = handleRequest(req, res).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      reply(req, res, statusFor(error), { error: errorCode(error) });
    });
    operations.add(operation); operation.finally(() => operations.delete(operation));
  });
  server.requestTimeout = 15000; server.headersTimeout = 8000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
    origin = `http://${HOST}:${server.address().port}`;
  } catch (error) { server.close(); throw error; }
  const close = () => closing ??= (async () => {
    stopping = true;
    await new Promise((done, fail) => {
      server.close(error => error ? fail(error) : done());
      server.closeIdleConnections?.();
    });
    await Promise.allSettled([...operations]);
    await mutationTail;
    exports.clear();
    for (const name of allowedEnvs) delete provided[name];
  })();
  return { origin, token: capability, url: origin + '/#token=' + capability, server, close };
}
