// MIT. Private local operator controls; never mounted on the seller HTTP port.
import { createServer, createConnection } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startCacheControl({ socketPath, controlFile, binding } = {}) {
  if (Boolean(socketPath) === Boolean(controlFile) || typeof binding?.stats !== 'function')
    throw new TypeError('Choose an explicit socket path or private control file');
  if (socketPath && process.platform === 'win32') throw new TypeError('Use controlFile on platforms without Unix sockets');
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
        if (!request || Array.isArray(request) || Object.keys(request).some(key => !['op', 'route', ...(token ? ['token'] : [])].includes(key)) ||
            request.route !== undefined && (typeof request.route !== 'string' || request.route.length > 64)) throw new TypeError();
        if (token && (typeof request.token !== 'string' || request.token.length !== token.length ||
            !timingSafeEqual(Buffer.from(request.token), Buffer.from(token)))) throw new TypeError();
        const result = request.op === 'status' && request.route === undefined ? binding.stats() :
          request.op === 'invalidate' ? binding.invalidate(request.route) : (() => { throw new TypeError(); })();
        socket.end(JSON.stringify({ ok: true, result }) + '\n');
      } catch { socket.end(JSON.stringify({ ok: false, error: 'CACHE_CONTROL_REQUEST_INVALID' }) + '\n'); }
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
  return { ...(socketPath ? { socketPath: path } : { controlFile: path }), close: () => closing ??= (async () => {
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
      if (Buffer.byteLength(body) > 131072) return finish(new Error('CACHE_CONTROL_RESPONSE_LIMIT'));
      if (!body.includes('\n')) return;
      try {
        const response = JSON.parse(body.slice(0, body.indexOf('\n')));
        if (response.ok !== true) throw new TypeError();
        finish(null, response.result);
      } catch { finish(new Error('CACHE_CONTROL_REQUEST_REJECTED')); }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [op, flag, socketPath, routeFlag, route] = process.argv.slice(2);
  if (!['status', 'invalidate'].includes(op) || !['--socket', '--control-file'].includes(flag) || !socketPath ||
      process.argv.length > 7 || routeFlag !== undefined && (op !== 'invalidate' || routeFlag !== '--route' || !route)) {
    process.stderr.write('Usage: node control.mjs status|invalidate --socket|--control-file PATH [--route ROUTE_ID]\n'); process.exitCode = 1;
  } else (flag === '--socket' ? callCacheControl : callCacheControlFile)(socketPath, { op, ...(route ? { route } : {}) }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
