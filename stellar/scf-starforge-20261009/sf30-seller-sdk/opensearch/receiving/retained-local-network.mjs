// MIT. Receiving-only network boundary for a retained OpenSearch workspace.
// Install before importing the product. This mode permits only HTTP connections
// to loopback servers opened by this process. It never supplies a query provider.
import net from 'node:net';
import tls from 'node:tls';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

let installed;
export function installLocalOnlyNetwork() {
  if (installed) return installed;
  const origins = new Set(), active = new Map(), sockets = new Set(), denied = [];
  const listenerAddresses = new WeakMap();
  const counts = { loopbackConnections: 0, loopbackRequests: 0 };
  const nativeConnect = net.Socket.prototype.connect;
  const nativeListen = net.Server.prototype.listen;
  const nativeClose = net.Server.prototype.close;
  const nativeFetch = globalThis.fetch;
  const error = kind => {
    denied.push({ kind, at: new Date().toISOString() });
    return Object.assign(new Error('Retained review permits only its owned loopback HTTP servers: ' + kind),
      { code: 'OPENSEARCH_RETAINED_NETWORK_DISABLED' });
  };
  const blocked = kind => function () { throw error(kind); };
  function options(args) {
    const first = args[0];
    if (Array.isArray(first)) return first[0] ?? {};
    if (first && typeof first === 'object') return first;
    if (typeof first === 'number' || (typeof first === 'string' && /^[0-9]+$/.test(first)))
      return { port: Number(first), host: typeof args[1] === 'string' ? args[1] : undefined };
    return { path: first };
  }
  function endpoint(value) {
    const port = Number(value.port), host = value.host ?? value.hostname;
    if (value.path !== undefined || value.fd !== undefined || value.handle !== undefined ||
        !['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535)
      throw error('non-owned socket endpoint');
    return (host === '::1' ? '[::1]' : host) + ':' + port;
  }
  net.Server.prototype.listen = function (...args) {
    const value = options(args), port = Number(value.port), host = value.host;
    if (value.path !== undefined || value.fd !== undefined || value.handle !== undefined ||
        !['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535)
      throw error('non-loopback listener');
    let address;
    const generation = Symbol('owned listener');
    this.once('listening', () => {
      const bound = this.address();
      address = (bound.address === '::1' ? '[::1]' : bound.address) + ':' + bound.port;
      active.set(address, generation); listenerAddresses.set(this, { address, generation }); origins.add('http://' + address);
    });
    this.once('close', () => { if (address && active.get(address) === generation) active.delete(address); });
    return Reflect.apply(nativeListen, this, args);
  };
  net.Server.prototype.close = function (...args) {
    const owner = listenerAddresses.get(this);
    if (owner && active.get(owner.address) === owner.generation) active.delete(owner.address);
    listenerAddresses.delete(this);
    return Reflect.apply(nativeClose, this, args);
  };
  net.Socket.prototype.connect = function (...args) {
    const address = endpoint(options(args));
    if (!active.has(address)) throw error('socket outside owned listeners');
    counts.loopbackConnections++;
    sockets.add(this); this.once('close', () => sockets.delete(this));
    return Reflect.apply(nativeConnect, this, args);
  };
  tls.connect = blocked('TLS');
  http2.connect = blocked('HTTP/2');
  dgram.createSocket = blocked('datagram');
  for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr',
    'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse']) {
    if (typeof dns[name] === 'function') dns[name] = blocked('DNS ' + name);
    if (typeof dns.promises?.[name] === 'function') dns.promises[name] = blocked('DNS ' + name);
    if (typeof dns.Resolver?.prototype[name] === 'function')
      dns.Resolver.prototype[name] = blocked('DNS resolver ' + name);
    if (typeof dns.promises?.Resolver?.prototype[name] === 'function')
      dns.promises.Resolver.prototype[name] = blocked('DNS resolver ' + name);
  }
  for (const name of ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync'])
    childProcess[name] = blocked('child process ' + name);
  workers.Worker = class { constructor() { throw error('worker thread'); } };
  if (globalThis.WebSocket) globalThis.WebSocket = class { constructor() { throw error('WebSocket'); } };
  globalThis.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    let url;
    try { url = new URL(raw); } catch { throw error('invalid fetch URL'); }
    if (url.protocol !== 'http:' || url.username || url.password || !active.has(url.host))
      throw error('fetch outside owned listeners');
    counts.loopbackRequests++;
    return nativeFetch(input, { ...init, redirect: 'error' });
  };
  syncBuiltinESMExports();
  installed = Object.freeze({
    sourceFactory() { throw error('provider source opening'); },
    snapshot() {
      return { schema: 'stellar-forge.retained-local-network.v1',
        externalTransport: 'disabled', permittedTransport: 'owned-loopback-http',
        processId: process.pid, originsOpened: [...origins].sort(),
        activeOrigins: [...active.keys()].sort(), ...counts, deniedAttempts: structuredClone(denied) };
    },
    closeIdleConnections() { for (const socket of sockets) socket.destroy(); },
  });
  return installed;
}
