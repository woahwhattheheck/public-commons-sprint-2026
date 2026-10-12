// MIT. Server-owned OAuth 2 client credentials for the original SF30 merchant.
// No refresh-token grant, discovery, buyer input, background refresh or API retry.
import { createHash } from 'node:crypto';
import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from '../sf31-buyer-client/public-transport.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = new Set(['tokenEndpoint', 'clientIdEnv', 'clientSecretEnv', 'authMethod', 'scope',
  'audience', 'timeoutMs', 'refreshSkewMs', 'failureCooldownMs', 'maxWaiters', 'defaultExpiresInSeconds']);
const scopePattern = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/;
const issue = code => Object.assign(new Error(code), { name: 'OAuthCredentialError', code });
const fail = code => { throw issue(code); };
function integer(value, fallback, min, max, field) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new TypeError(`Invalid OAuth ${field}`);
  return n;
}
function endpoint(value, allowLoopback) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Invalid OAuth tokenEndpoint'); }
  if (typeof value !== 'string' || value !== url.href || value.length > 2048 ||
      url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
    throw new TypeError('OAuth tokenEndpoint must be canonical without credentials, query or fragment');
  }
  if (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1') return url;
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || isIP(host.replace(/^\[|\]$/g, '')) ||
      !host.includes('.') || host.length > 253 || host.split('.').some(part =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      ['localhost', 'local', 'localdomain', 'internal', 'home.arpa'].some(name =>
        host === name || host.endsWith('.' + name))) {
    throw new TypeError('OAuth requires public HTTPS port 443 or explicit local-development loopback');
  }
  return url;
}
function credentials(config, env) {
  const read = key => {
    const value = Object.hasOwn(env, key) ? env[key] : undefined;
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096 ||
        /[\x00-\x1f\x7f]/.test(value) || !value.isWellFormed()) fail('OAUTH_CREDENTIALS_UNAVAILABLE');
    return value;
  };
  const id = read(config.clientIdEnv), secret = read(config.clientSecretEnv);
  return { id, secret, key: createHash('sha256').update(JSON.stringify([id, secret])).digest('hex') };
}

/** Validate operator declaration without a connection or secret capture. */
export function compileOAuthClientCredentials(raw, { allowLoopback = false, env = process.env, validateCredentials = true } = {}) {
  if (!plain(raw) || Object.keys(raw).some(key => !keys.has(key)) ||
      typeof allowLoopback !== 'boolean' || typeof validateCredentials !== 'boolean' || env === null || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('Invalid OAuth declaration');
  const url = endpoint(raw.tokenEndpoint, allowLoopback);
  for (const key of ['clientIdEnv', 'clientSecretEnv']) {
    if (typeof raw[key] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw[key]))
      throw new TypeError(`Invalid OAuth ${key}`);
  }
  if (raw.clientIdEnv === raw.clientSecretEnv) throw new TypeError('OAuth credential variables must differ');
  const authMethod = raw.authMethod ?? 'client_secret_basic';
  if (!['client_secret_basic', 'client_secret_post'].includes(authMethod)) throw new TypeError('Invalid OAuth authMethod');
  if (raw.scope !== undefined && (typeof raw.scope !== 'string' || raw.scope.length > 2048 || !scopePattern.test(raw.scope)))
    throw new TypeError('Invalid OAuth scope');
  if (raw.audience !== undefined && (typeof raw.audience !== 'string' || !raw.audience || raw.audience.length > 2048 ||
      /[\x00-\x1f\x7f]/.test(raw.audience) || !raw.audience.isWellFormed())) throw new TypeError('Invalid OAuth audience');
  const config = Object.freeze({ tokenEndpoint: url.href, clientIdEnv: raw.clientIdEnv,
    clientSecretEnv: raw.clientSecretEnv, authMethod,
    ...(raw.scope === undefined ? {} : { scope: raw.scope }),
    ...(raw.audience === undefined ? {} : { audience: raw.audience }),
    timeoutMs: integer(raw.timeoutMs, 10000, 1, 120000, 'timeoutMs'),
    refreshSkewMs: integer(raw.refreshSkewMs, 30000, 0, 300000, 'refreshSkewMs'),
    failureCooldownMs: integer(raw.failureCooldownMs, 1000, 1, 300000, 'failureCooldownMs'),
    maxWaiters: integer(raw.maxWaiters, 256, 1, 4096, 'maxWaiters'),
    ...(raw.defaultExpiresInSeconds === undefined ? {} : {
      defaultExpiresInSeconds: integer(raw.defaultExpiresInSeconds, undefined, 1, 2147483647, 'defaultExpiresInSeconds') }) });
  if (validateCredentials) {
    try { credentials(config, env); }
    catch { throw new TypeError('OAuth clientIdEnv/clientSecretEnv must name available, nonempty credential variables'); }
  }
  return config;
}

// Resolve on the actual TLS socket; all answers must pass original SF31 policy.
function publicLookup(hostname, lookup) {
  return (host, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    Promise.resolve().then(async () => {
      if (host !== hostname) fail('OAUTH_DNS_REJECTED');
      const rows = await lookup(host, { all: true, verbatim: true });
      if (!Array.isArray(rows) || !rows.length || rows.length > 64 || rows.some(row =>
        !row || ![4, 6].includes(row.family) || isIP(row.address) !== row.family || !isPublicAddress(row.address)))
        fail('OAUTH_DNS_REJECTED');
      const { address, family } = rows[0];
      if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family);
    }).catch(() => callback(issue('OAUTH_DNS_REJECTED')));
  };
}
const formPart = value => new URLSearchParams({ x: value }).toString().slice(2);
function tokenRequest(config, identity, { lookup, signal, now, agent }) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.tokenEndpoint), started = now();
    const form = new URLSearchParams({ grant_type: 'client_credentials' });
    if (config.scope !== undefined) form.set('scope', config.scope);
    if (config.audience !== undefined) form.set('audience', config.audience);
    const headers = { accept: 'application/json', 'accept-encoding': 'identity',
      'content-type': 'application/x-www-form-urlencoded' };
    if (config.authMethod === 'client_secret_basic') {
      headers.authorization = 'Basic ' + Buffer.from(`${formPart(identity.id)}:${formPart(identity.secret)}`).toString('base64');
    } else { form.set('client_id', identity.id); form.set('client_secret', identity.secret); }
    const body = Buffer.from(form.toString());
    headers['content-length'] = String(body.length);
    let request, response, timer, done = false, bytes = 0;
    const chunks = [];
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      response?.destroy(); request?.destroy();
      if (error) reject(error); else resolve(result);
    };
    const bad = code => finish(issue(code));
    const abort = () => bad('OAUTH_ABORTED');
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => bad('OAUTH_TIMEOUT'), config.timeoutMs);
    try {
      request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'POST', headers, agent: agent ?? false, maxHeaderSize: 16384,
        ...(url.protocol === 'https:' ? { ...(agent === undefined ? {lookup: publicLookup(url.hostname, lookup)} : {}),
          rejectUnauthorized: true, minVersion: 'TLSv1.2' } : {}),
      }, res => {
        response = res;
        res.on('error', () => bad('OAUTH_RESPONSE_INCOMPLETE'));
        res.on('aborted', () => bad('OAUTH_RESPONSE_INCOMPLETE'));
        if (res.statusCode >= 300 && res.statusCode < 400) return bad('OAUTH_REDIRECT_REFUSED');
        if (res.statusCode !== 200) {
          const error = issue(res.statusCode === 429 ? 'OAUTH_RATE_LIMITED' : 'OAUTH_TOKEN_REJECTED');
          // Only a numeric delay is retained, never response text/headers/secrets.
          const retry = res.headers['retry-after'];
          if (typeof retry === 'string' && /^\d{1,9}$/.test(retry)) error.retryAfterMs = Math.min(Number(retry) * 1000, 300000);
          return finish(error);
        }
        if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '') ||
            !['identity', undefined].includes(res.headers['content-encoding'])) return bad('OAUTH_RESPONSE_INVALID');
        const length = res.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || BigInt(length) > 65536n)) return bad('OAUTH_RESPONSE_TOO_LARGE');
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 65536) return bad('OAUTH_RESPONSE_TOO_LARGE');
          chunks.push(chunk);
        });
        res.once('end', () => {
          if (done) return;
          if (!res.complete) return bad('OAUTH_RESPONSE_INCOMPLETE');
          try {
            const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
            if (!plain(value) || typeof value.access_token !== 'string' || value.access_token.length > 8000 ||
                !/^[A-Za-z0-9\-._~+/]+=*$/.test(value.access_token) ||
                typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer') return bad('OAUTH_RESPONSE_INVALID');
            const rawLifetime = value.expires_in ?? config.defaultExpiresInSeconds;
            const lifetime = typeof rawLifetime === 'string' && /^[1-9]\d{0,9}$/.test(rawLifetime) ? Number(rawLifetime) : rawLifetime;
            if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 2147483647) return bad('OAUTH_EXPIRY_REQUIRED');
            if (value.scope !== undefined && (typeof value.scope !== 'string' || value.scope.length > 2048 || !scopePattern.test(value.scope)))
              return bad('OAUTH_SCOPE_INVALID');
            if (config.scope && value.scope !== undefined && config.scope.split(' ').some(scope => !value.scope.split(' ').includes(scope)))
              return bad('OAUTH_SCOPE_INSUFFICIENT');
            const expiresAt = started + lifetime * 1000;
            const refreshAt = expiresAt - Math.min(config.refreshSkewMs, lifetime * 100);
            if (now() >= refreshAt) return bad('OAUTH_TOKEN_TOO_OLD');
            finish(null, { authorization: `Bearer ${value.access_token}`, expiresAt, refreshAt });
          } catch { bad('OAUTH_RESPONSE_INVALID'); }
        });
      });
      request.on('error', error => bad(error?.code === 'OAUTH_DNS_REJECTED' ? 'OAUTH_DNS_REJECTED' : 'OAUTH_UNAVAILABLE'));
      request.on('upgrade', (_res, socket) => { socket.destroy(); bad('OAUTH_RESPONSE_INVALID'); });
      request.end(body);
    } catch { bad('OAUTH_UNAVAILABLE'); }
  });
}

/** One private, lazy token cache. Caller cancellation does not cancel other waiters. */
export function createOAuthClientCredentials(raw, {
  allowLoopback = false, env = process.env, lookup = systemLookup, now = () => performance.now(), validateCredentials = true, agent,
} = {}) {
  if (typeof lookup !== 'function' || typeof now !== 'function') throw new TypeError('Invalid OAuth runtime');
  const config = compileOAuthClientCredentials(raw, { allowLoopback, env, validateCredentials });
  if (agent !== undefined && (!(agent instanceof HttpAgent) || agent.protocol !== new URL(config.tokenEndpoint).protocol))
    throw new TypeError('OAuth agent must be a Node Agent for the configured protocol');
  let closed = false, cached = null, pending = null, currentKey = null, blockedUntil = 0, generation = 0, lastError = null;
  const totals = { tokenRequests: 0, cacheHits: 0, renewals: 0, failures: 0, cancellations: 0, rotations: 0, invalidations: 0 };
  function reset() {
    generation++; cached = null; blockedUntil = 0;
    const old = pending; pending = null; old?.controller.abort();
  }
  function begin(identity) {
    const record = { controller: new AbortController(), generation, waiters: 0, settled: false, promise: null };
    totals.tokenRequests++;
    record.promise = tokenRequest(config, identity, { lookup, signal: record.controller.signal, now, agent }).then(token => {
      if (closed || record.generation !== generation) fail('OAUTH_STATE_CHANGED');
      // A secret rotation during an exchange cannot install or return an old token.
      if (credentials(config, env).key !== identity.key) fail('OAUTH_CREDENTIALS_CHANGED');
      cached = token; blockedUntil = 0; lastError = null; totals.renewals++;
      return token;
    }).catch(error => {
      const safe = error?.name === 'OAuthCredentialError' ? error : issue('OAUTH_UNAVAILABLE');
      if (record.generation === generation && !closed) {
        cached = null; lastError = safe.code;
        if (safe.code !== 'OAUTH_ABORTED') {
          totals.failures++; blockedUntil = now() + Math.max(config.failureCooldownMs, safe.retryAfterMs ?? 0);
        }
      }
      throw safe;
    }).finally(() => {
      record.settled = true;
      if (pending === record) pending = null;
    });
    // begin() installs a waiter synchronously; this also handles close-before-wait.
    record.promise.catch(() => {});
    pending = record;
    return record;
  }
  function wait(record, signal) {
    if (record.waiters >= config.maxWaiters) return Promise.reject(issue('OAUTH_WAITER_CAPACITY'));
    record.waiters++;
    return new Promise((resolve, reject) => {
      let done = false;
      function finish(error, token) {
        if (done) return;
        done = true; signal?.removeEventListener('abort', abort); record.waiters--;
        if (!record.waiters && !record.settled && error?.code === 'OAUTH_ABORTED') {
          if (pending === record) { pending = null; generation++; }
          record.controller.abort();
        }
        if (error) reject(error); else resolve(Object.freeze({ authorization: token.authorization }));
      }
      const abort = () => { totals.cancellations++; finish(issue('OAUTH_ABORTED')); };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      record.promise.then(token => finish(null, token), error => finish(error));
    });
  }
  async function headers({ signal } = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('OAUTH_SIGNAL_INVALID');
    if (closed) fail('OAUTH_CLOSED');
    if (signal?.aborted) fail('OAUTH_ABORTED');
    let identity;
    try { identity = credentials(config, env); }
    catch (error) { reset(); currentKey = null; lastError = 'OAUTH_CREDENTIALS_UNAVAILABLE'; throw error; }
    if (currentKey !== identity.key) {
      if (currentKey !== null) totals.rotations++;
      reset(); currentKey = identity.key;
    }
    if (cached && now() < cached.refreshAt) {
      totals.cacheHits++;
      return Object.freeze({ authorization: cached.authorization });
    }
    if (now() < blockedUntil) fail('OAUTH_COOLDOWN');
    return wait(pending ?? begin(identity), signal);
  }
  const snapshot = () => {
    const time = now(), valid = cached !== null && time < cached.expiresAt;
    return Object.freeze({ state: closed ? 'closed' : pending ? 'refreshing' : time < blockedUntil ? 'cooldown' :
      cached && time < cached.refreshAt ? 'ready' : 'empty', hasToken: valid,
      expiresInMs: valid ? Math.max(0, Math.floor(cached.expiresAt - time)) : 0,
      refreshInMs: valid ? Math.max(0, Math.floor(cached.refreshAt - time)) : 0,
      retryInMs: Math.max(0, Math.ceil(blockedUntil - time)), waiters: pending?.waiters ?? 0,
      ...totals, lastError });
  };
  return Object.freeze({ headers, snapshot, generation: () => generation,
    // A delayed 401 for an older bearer must not invalidate its replacement.
    // The supplied value remains private; it is never included in diagnostics.
    invalidate(expectedAuthorization) {
      if (expectedAuthorization !== undefined && (!cached || cached.authorization !== expectedAuthorization)) return snapshot();
      if (!closed) { totals.invalidations++; reset(); lastError = null; }
      return snapshot();
    },
    close() { if (!closed) { closed = true; reset(); currentKey = null; } return snapshot(); } });
}
