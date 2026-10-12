// MIT. Private local operator controls; never mounted on the seller HTTP port.
import { createServer, createConnection } from 'node:net';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const MANAGERS = new WeakMap();
const OPERATION_LIMIT = 256;
const OPERATION_BYTES = 8 * 1024 * 1024;
const RETENTION = new Set(['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes']);
const operationId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const routeId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const controlError = code => Object.assign(new Error(code), { code,
  status: ['CACHE_CONTROL_REVIEW_STALE', 'CACHE_CONTROL_OPERATION_CONFLICT'].includes(code) ? 409 : 400 });
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/**
 * One process-local management authority shared by private sockets, the original
 * in-process workspace and release/MCP adapters. It never reads credentials or
 * contacts sources. Callers retain their review and operation in the existing
 * durable workspace before dispatch and recover the same operation after a lost
 * response. Reopening another runtime requires a new inspection.
 */
export function createCacheManagement(binding) {
  if (!binding || typeof binding.stats !== 'function' || typeof binding.invalidate !== 'function') {
    throw new TypeError('Original response cache binding required');
  }
  if (MANAGERS.has(binding)) return MANAGERS.get(binding);
  const instanceId = randomUUID(), operations = new Map();
  let revision = 0, signature = null, operationBytes = 0;
  function inspect(route) {
    if (route !== undefined && !routeId(route)) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    const routes = typeof binding.inspect === 'function' ? binding.inspect() :
      Object.fromEntries(Object.entries(binding.stats()).map(([id, stats]) => [id,
        { kind: 'legacy', revision: stats.revision ?? 0, generation: stats.generation ?? null,
          closed: Boolean(stats.closed), policy: null, limits: stats.limits ?? null, stats }]));
    if (!plain(routes)) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    if (route !== undefined && !Object.hasOwn(routes, route)) throw controlError('CACHE_CONTROL_ROUTE_UNKNOWN');
    // Counters and expiry sweeps do not make a reviewed policy stale. Credential
    // generations, retention policies, closed state and explicit invalidations do.
    const next = JSON.stringify(canonical(Object.fromEntries(Object.entries(routes).map(([id, row]) => [id,
      { kind: row.kind, revision: row.revision, generation: row.generation,
        cacheGeneration: row.cacheGeneration, closed: row.closed, policy: row.policy, limits: row.limits }]))));
    if (signature !== null && signature !== next) revision++;
    signature = next;
    return { schema: 'stellar-forge.response-cache-inspection.v1', instanceId, revision,
      capturedAt: new Date().toISOString(),
      routes: structuredClone(route === undefined ? routes : { [route]: routes[route] }),
      operationRetention: { limit: OPERATION_LIMIT, retained: operations.size, processMemory: true } };
  }
  function invoke(request) {
    if (!plain(request) || typeof request.op !== 'string') throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    const keys = {
      status: ['op'], invalidate: ['op', 'route'], inspect: ['op', 'route'],
      operation: ['op', 'operationId'],
      change: ['op', 'operationId', 'expectedInstanceId', 'expectedRevision', 'route', 'action', 'policy'],
    }[request.op];
    if (!keys || Object.keys(request).some(key => !keys.includes(key))) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    if (request.op === 'status') return binding.stats();
    if (request.op === 'inspect') return inspect(request.route);
    if (request.op === 'invalidate') {
      if (request.route !== undefined && !routeId(request.route)) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
      const before = inspect();
      if (request.route !== undefined && !Object.hasOwn(before.routes, request.route)) throw controlError('CACHE_CONTROL_ROUTE_UNKNOWN');
      const result = binding.invalidate(request.route);
      const after = inspect();
      if (after.revision === before.revision) revision++;
      return result;
    }
    if (!operationId(request.operationId)) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    if (request.op === 'operation') {
      const retained = operations.get(request.operationId);
      return retained ? { found: true, operation: structuredClone(retained.result) } :
        { found: false, instanceId, operationRetention: { limit: OPERATION_LIMIT, retained: operations.size, processMemory: true } };
    }
    if (!routeId(request.route) || !['invalidate', 'configure'].includes(request.action) ||
        typeof request.expectedInstanceId !== 'string' || !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 || request.action === 'invalidate' && Object.hasOwn(request, 'policy') ||
        request.action === 'configure' && (!plain(request.policy) || !Object.keys(request.policy).length ||
          Object.keys(request.policy).some(key => !RETENTION.has(key)))) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
    const retained = operations.get(request.operationId);
    if (retained) {
      if (retained.fingerprint !== fingerprint) throw controlError('CACHE_CONTROL_OPERATION_CONFLICT');
      return structuredClone(retained.result);
    }
    const before = inspect();
    if (before.instanceId !== request.expectedInstanceId || before.revision !== request.expectedRevision) {
      throw controlError('CACHE_CONTROL_REVIEW_STALE');
    }
    if (!Object.hasOwn(before.routes, request.route)) throw controlError('CACHE_CONTROL_ROUTE_UNKNOWN');
    if (before.routes[request.route].closed) throw controlError('CACHE_CONTROL_CLOSED');
    if (request.action === 'configure' && typeof binding.configure !== 'function') {
      throw controlError('CACHE_CONTROL_CONFIGURE_UNSUPPORTED');
    }
    // No await between comparison and mutation: a source credential generation
    // cannot turn over in the middle of this reviewed operation.
    const changed = request.action === 'configure' ? binding.configure(request.route, request.policy) :
      binding.invalidate(request.route);
    let after = inspect();
    if (after.revision === before.revision) { revision++; after = inspect(); }
    const result = { schema: 'stellar-forge.response-cache-operation.v1',
      operationId: request.operationId, route: request.route, action: request.action,
      expectedInstanceId: request.expectedInstanceId, expectedRevision: request.expectedRevision,
      completedAt: new Date().toISOString(), result: changed, inspection: after };
    const encodedBytes = Buffer.byteLength(JSON.stringify(result));
    while (operations.size && (operations.size >= OPERATION_LIMIT || operationBytes + encodedBytes > OPERATION_BYTES)) {
      const oldest = operations.keys().next().value;
      operationBytes -= operations.get(oldest).bytes; operations.delete(oldest);
    }
    const record = { fingerprint, result: structuredClone(result), bytes: encodedBytes };
    operations.set(request.operationId, record); operationBytes += encodedBytes;
    record.result.inspection.operationRetention.retained = operations.size;
    return structuredClone(record.result);
  }
  const dispatch = request => {
    try { return invoke(request); }
    catch (error) {
      if (/^CACHE_CONTROL_[A-Z_]+$/.test(error?.code ?? '')) throw error;
      throw controlError('CACHE_CONTROL_REQUEST_INVALID');
    }
  };
  const manager = Object.freeze({ instanceId, inspect, dispatch });
  MANAGERS.set(binding, manager);
  return manager;
}

export async function startCacheControl({ socketPath, controlFile, binding, management } = {}) {
  if (Boolean(socketPath) === Boolean(controlFile) || typeof binding?.stats !== 'function')
    throw new TypeError('Choose an explicit socket path or private control file');
  if (socketPath && process.platform === 'win32') throw new TypeError('Use controlFile on platforms without Unix sockets');
  const manager = management ?? createCacheManagement(binding);
  if (typeof manager?.dispatch !== 'function' || typeof manager?.inspect !== 'function') {
    throw new TypeError('Original cache management authority required');
  }
  const path = resolve(socketPath ?? controlFile);
  if (socketPath && Buffer.byteLength(path) > 100) throw new TypeError('Socket path must be at most 100 bytes');
  const directory = dirname(path);
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 ||
      process.getuid && parent.uid !== process.getuid()) throw new TypeError('Control directory must be owned by this operator with mode 0700');
  try { await lstat(path); throw new TypeError('Control path already exists; choose a fresh path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clients = new Set(), token = controlFile ? randomBytes(32).toString('hex') : null;
  const server = createServer(socket => {
    if (clients.size >= 8) { socket.destroy(); return; }
    clients.add(socket); socket.once('close', () => clients.delete(socket));
    socket.on('error', () => {}); socket.setTimeout(3000, () => socket.destroy());
    let buffer = '', answered = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      if (answered) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 4096) { socket.destroy(); return; }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      answered = true;
      try {
        const request = JSON.parse(buffer.slice(0, end));
        if (!plain(request)) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
        if (token && (typeof request.token !== 'string' || request.token.length !== token.length ||
            !timingSafeEqual(Buffer.from(request.token), Buffer.from(token)))) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
        const clean = { ...request }; if (token) delete clean.token;
        // Release control sockets keep their established route-ID projection
        // for legacy calls. Reviewed operations use the session's canonical
        // binding IDs and the same operation/revision authority.
        let result;
        if (management && ['status', 'invalidate'].includes(clean.op)) {
          if (Object.keys(clean).some(key => !['op', 'route'].includes(key)) ||
              clean.route !== undefined && !routeId(clean.route) ||
              clean.op === 'status' && clean.route !== undefined) throw controlError('CACHE_CONTROL_REQUEST_INVALID');
          result = clean.op === 'status' ? binding.stats() : binding.invalidate(clean.route);
        } else result = manager.dispatch(clean);
        socket.end(JSON.stringify({ ok: true, result }) + '\n');
      } catch (error) {
        const code = /^CACHE_CONTROL_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'CACHE_CONTROL_REQUEST_INVALID';
        socket.end(JSON.stringify({ ok: false, error: code }) + '\n');
      }
    });
  });
  let identity;
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      if (controlFile) server.listen(0, '127.0.0.1', done); else server.listen(path, done);
    });
    if (controlFile) {
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ schema: 'stellar-forge.response-cache-control.v1',
        host: '127.0.0.1', port: server.address().port, token }) + '\n'); await file.sync(); }
      finally { await file.close(); }
    } else await chmod(path, 0o600);
    identity = await lstat(path);
  } catch (error) {
    for (const socket of clients) socket.destroy();
    if (server.listening) await new Promise(done => server.close(done));
    throw error;
  }
  let closing;
  return { ...(socketPath ? { socketPath: path } : { controlFile: path }), management: manager, close: () => closing ??= (async () => {
    for (const socket of clients) socket.destroy();
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
    try {
      const current = await lstat(path);
      if (current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })() };
}

function callControl(connection, request) {
  return new Promise((done, reject) => {
    const socket = createConnection(connection);
    let body = '', finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; socket.destroy(); error ? reject(error) : done(result);
    };
    socket.setEncoding('utf8'); socket.setTimeout(3000, () => finish(new Error('CACHE_CONTROL_TIMEOUT')));
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.once('error', () => finish(new Error('CACHE_CONTROL_UNAVAILABLE')));
    socket.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 524288) return finish(new Error('CACHE_CONTROL_RESPONSE_LIMIT'));
      if (!body.includes('\n')) return;
      try {
        const response = JSON.parse(body.slice(0, body.indexOf('\n')));
        if (response.ok !== true) {
          const code = /^CACHE_CONTROL_[A-Z_]+$/.test(response.error ?? '') ? response.error : 'CACHE_CONTROL_REQUEST_REJECTED';
          return finish(controlError(code));
        }
        finish(null, response.result);
      } catch { finish(controlError('CACHE_CONTROL_REQUEST_REJECTED')); }
    });
    socket.once('end', () => { if (!finished) finish(new Error('CACHE_CONTROL_RESPONSE_INCOMPLETE')); });
  });
}

export const callCacheControl = (socketPath, request) => callControl({ path: resolve(socketPath) }, request);

export async function callCacheControlFile(controlFile, request) {
  const info = await lstat(controlFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || (info.mode & 0o077) !== 0 ||
      process.getuid && info.uid !== process.getuid()) throw new TypeError('Private operator-owned control file required');
  const data = JSON.parse(await readFile(controlFile, 'utf8'));
  if (data.schema !== 'stellar-forge.response-cache-control.v1' || data.host !== '127.0.0.1' ||
      !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || !/^[0-9a-f]{64}$/.test(data.token ?? ''))
    throw new TypeError('Invalid local control descriptor');
  return callControl({ host: data.host, port: data.port }, { ...request, token: data.token });
}

const USAGE = `Usage: node control.mjs status|invalidate|inspect|operation|change --socket|--control-file PATH
  invalidate|inspect: [--route ROUTE_OR_BINDING]
  operation: --operation-id ID
  change: --operation-id ID --expected-instance UUID --expected-revision NUMBER
          --route ROUTE_OR_BINDING --action invalidate|configure [--policy JSON]

Inspect supplies the current process instance, revision, canonical binding names
and retention limits. Changes use that reviewed inspection. Recover a lost
response with operation and the same ID before replaying the original change.`;

function cliRequest(args) {
  const [op, ...rest] = args;
  if (!['status', 'invalidate', 'inspect', 'operation', 'change'].includes(op)) throw new TypeError(USAGE);
  const values = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--socket', '--control-file', '--route', '--operation-id', '--expected-instance',
      '--expected-revision', '--action', '--policy'].includes(rest[i]) || values.has(rest[i]) ||
      typeof rest[i + 1] !== 'string' || !rest[i + 1]) throw new TypeError(USAGE);
    values.set(rest[i], rest[i + 1]);
  }
  if (values.has('--socket') === values.has('--control-file')) throw new TypeError(USAGE);
  const supported = new Set(['--socket', '--control-file',
    ...(op === 'invalidate' || op === 'inspect' ? ['--route'] : []),
    ...(op === 'operation' ? ['--operation-id'] : []),
    ...(op === 'change' ? ['--route', '--operation-id', '--expected-instance', '--expected-revision', '--action', '--policy'] : [])]);
  if ([...values.keys()].some(key => !supported.has(key))) throw new TypeError(USAGE);
  const request = { op };
  for (const [flag, field] of [['--route', 'route'], ['--operation-id', 'operationId'],
    ['--expected-instance', 'expectedInstanceId'], ['--action', 'action']]) {
    if (values.has(flag)) request[field] = values.get(flag);
  }
  if (values.has('--expected-revision')) {
    if (!/^[0-9]+$/.test(values.get('--expected-revision'))) throw new TypeError(USAGE);
    request.expectedRevision = Number(values.get('--expected-revision'));
  }
  if (values.has('--policy')) {
    try { request.policy = JSON.parse(values.get('--policy')); } catch { throw new TypeError('Policy must be JSON'); }
  }
  if (op === 'operation' && !operationId(request.operationId) || op === 'change' &&
      (!operationId(request.operationId) || !routeId(request.route) ||
        typeof request.expectedInstanceId !== 'string' || !Number.isSafeInteger(request.expectedRevision) ||
        !['invalidate', 'configure'].includes(request.action) ||
        request.action === 'configure' && !plain(request.policy) ||
        request.action === 'invalidate' && Object.hasOwn(request, 'policy'))) throw new TypeError(USAGE);
  return { path: values.get('--socket') ?? values.get('--control-file'),
    call: values.has('--socket') ? callCacheControl : callCacheControlFile, request };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(USAGE + '\n');
  else Promise.resolve().then(() => cliRequest(args)).then(({ call, path, request }) => call(path, request)).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
