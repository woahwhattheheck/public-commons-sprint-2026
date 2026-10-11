// MIT. Private local operator controls; never mounted on the seller HTTP port.
import { createServer, createConnection } from 'node:net';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startCacheControl({ socketPath, binding } = {}) {
  if (process.platform === 'win32') throw new TypeError('Private cache control requires a Unix-domain socket');
  if (typeof socketPath !== 'string' || !socketPath || typeof binding?.stats !== 'function')
    throw new TypeError('Explicit socket path and bound cache required');
  const path = resolve(socketPath);
  if (Buffer.byteLength(path) > 100) throw new TypeError('Socket path must be at most 100 bytes');
  const directory = dirname(path);
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 ||
      process.getuid && parent.uid !== process.getuid()) throw new TypeError('Socket directory must be owned by this operator with mode 0700');
  try { await lstat(path); throw new TypeError('Socket path already exists; choose a fresh path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clients = new Set();
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
        if (!request || Array.isArray(request) || Object.keys(request).some(key => !['op', 'route'].includes(key)) ||
            request.route !== undefined && (typeof request.route !== 'string' || request.route.length > 64)) throw new TypeError();
        const result = request.op === 'status' && request.route === undefined ? binding.stats() :
          request.op === 'invalidate' ? binding.invalidate(request.route) : (() => { throw new TypeError(); })();
        socket.end(JSON.stringify({ ok: true, result }) + '\n');
      } catch { socket.end(JSON.stringify({ ok: false, error: 'CACHE_CONTROL_REQUEST_INVALID' }) + '\n'); }
    });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(path, done); });
  await chmod(path, 0o600);
  const identity = await lstat(path);
  let closing;
  return { socketPath: path, close: () => closing ??= (async () => {
    for (const socket of clients) socket.destroy();
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
    try {
      const current = await lstat(path);
      if (current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })() };
}

export function callCacheControl(socketPath, request) {
  return new Promise((done, reject) => {
    const socket = createConnection(resolve(socketPath));
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [op, flag, socketPath, routeFlag, route] = process.argv.slice(2);
  if (!['status', 'invalidate'].includes(op) || flag !== '--socket' || !socketPath ||
      process.argv.length > 7 || routeFlag !== undefined && (op !== 'invalidate' || routeFlag !== '--route' || !route)) {
    process.stderr.write('Usage: node control.mjs status|invalidate --socket PATH [--route ROUTE_ID]\n'); process.exitCode = 1;
  } else callCacheControl(socketPath, { op, ...(route ? { route } : {}) }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
