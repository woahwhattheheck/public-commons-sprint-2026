// MIT. Stateless, network-bound HTTP frontdoor for TWO independent x402 v2 Stellar facilitators.
// Cryptographic verify/settle belongs to the operator's native @x402/stellar backends.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { boundedBodyBytes, BodyReadError } from './body-read.mjs';
import { validatedExtensionResponsesHeader } from '../sf54-cataloging-sidechannel/header.mjs';

export const NETWORKS = Object.freeze(['stellar:testnet', 'stellar:pubnet']);
const DEFAULT_MAX_BODY = 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 32;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_BODY_TIMEOUT_MS = 8000;

export function originOnly(raw, {allowLoopbackHttp = false} = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('Missing facilitator origin');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('Invalid facilitator origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopbackHttp && local && url.protocol === 'http:')) ||
      !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Facilitator URL must be a credential-free HTTPS origin (or explicitly enabled HTTP loopback)');
  }
  return url.origin;
}

const hash = text => createHash('sha256').update(text).digest();
function authorized(actual, token) {
  if (token === null) return true;
  const bearer = /^Bearer ([^\s]+)$/i.exec(actual ?? '')?.[1] ?? '';
  return timingSafeEqual(hash(bearer), hash(token));
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function json(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  res.end(JSON.stringify(body));
}
function targetNetwork(bytes) {
  let request;
  try { request = JSON.parse(bytes.toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
  const requirements = request?.paymentRequirements;
  const payload = request?.paymentPayload;
  const network = requirements?.network;
  // Both independent v2 descriptors must bind the SAME native Stellar ledger.
  if (!NETWORKS.includes(network) || payload?.accepted?.network !== network) {
    throw new HttpError(400, 'NETWORK_NOT_BOUND');
  }
  if (payload.x402Version !== 2 ||
      typeof requirements?.scheme !== 'string' || !requirements.scheme ||
      payload?.accepted?.scheme !== requirements.scheme) {
    throw new HttpError(400, 'X402_V2_SCHEME_MISMATCH');
  }
  return network;
}
async function readLimited(response, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new HttpError(502, 'UPSTREAM_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'UPSTREAM_EMPTY_BODY');
  const parts = [];
  let count = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maxBytes) throw new HttpError(502, 'UPSTREAM_RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const raw = Buffer.concat(parts, count);
  let data;
  try { data = JSON.parse(raw.toString('utf8')); }
  catch { throw new HttpError(502, 'UPSTREAM_NOT_JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(502, 'UPSTREAM_NOT_OBJECT');
  return {raw, data};
}

function distinctCommonExtensions(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
  const others = new Set(b.map(x => JSON.stringify(x)));
  return a.filter(x => others.has(JSON.stringify(x)));
}
export function combineSupported(results) {
  if (!Array.isArray(results) || results.length !== 2) throw new HttpError(502, 'SUPPORTED_MISSING_NETWORK');
  const kinds = [], signingAddresses = new Set();
  for (let i = 0; i < NETWORKS.length; i++) {
    const network = NETWORKS[i];
    const src = results[i];
    if (!Array.isArray(src?.kinds) || !src.kinds.length) throw new HttpError(502, 'SUPPORTED_MISSING_NETWORK');
    for (const kind of src.kinds) {
      // A misconfigured upstream may not advertise the other ledger as its own.
      if (kind?.network !== network || kind?.x402Version !== 2 || typeof kind?.scheme !== 'string') {
        throw new HttpError(502, 'SUPPORTED_NETWORK_MISMATCH');
      }
      kinds.push(kind);
    }
    // ORIGINAL @x402/core x402Facilitator.getSupported() keys signers by the
    // scheme's CAIP FAMILY, not concrete network. @x402/stellar ExactStellarScheme
    // advertises caipFamily = 'stellar:*' on BOTH testnet and pubnet.
    const signers = src.signers;
    if (!signers || typeof signers !== 'object' || Array.isArray(signers) ||
        Object.keys(signers).some(x => x !== 'stellar:*') ||
        !Array.isArray(signers['stellar:*']) || !signers['stellar:*'].length ||
        signers['stellar:*'].some(x => typeof x !== 'string' || !x)) {
      throw new HttpError(502, 'SUPPORTED_BAD_SIGNERS');
    }
    for (const signer of signers['stellar:*']) signingAddresses.add(signer);
  }
  return {kinds, extensions: distinctCommonExtensions(results[0].extensions, results[1].extensions),
    signers: {'stellar:*': [...signingAddresses]}};
}

/**
 * upstreams: { 'stellar:testnet': {origin, bearer?}, 'stellar:pubnet': {origin, bearer?} }
 * Does not generate signatures, relay an unknown destination, or perform settlement itself.
 */
export function makeFrontdoor({upstreams, inboundToken = null, allowLoopbackHttp = false,
  maxBodyBytes = DEFAULT_MAX_BODY, maxConcurrent = DEFAULT_MAX_CONCURRENT,
  timeoutMs = DEFAULT_TIMEOUT_MS, bodyTimeoutMs = DEFAULT_BODY_TIMEOUT_MS,
  fetchImpl = fetch} = {}) {
  if (inboundToken !== null && (typeof inboundToken !== 'string' || inboundToken.length < 16)) {
    throw new TypeError('Inbound token must be at least 16 characters');
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 ||
      !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1) throw new TypeError('Invalid limits');
  const peers = {};
  for (const network of NETWORKS) {
    const cfg = upstreams?.[network];
    peers[network] = {origin: originOnly(cfg?.origin, {allowLoopbackHttp}), bearer: cfg?.bearer ?? null};
    if (peers[network].bearer !== null && (typeof peers[network].bearer !== 'string' || !peers[network].bearer)) {
      throw new TypeError('Bad upstream auth configuration');
    }
  }
  let inflight = 0;
  const queryPeer = async (network, path, raw = null) => {
    const peer = peers[network];
    const headers = {accept: 'application/json'};
    if (raw) headers['content-type'] = 'application/json';
    if (peer.bearer) headers.authorization = `Bearer ${peer.bearer}`;
    const response = await fetchImpl(peer.origin + path, {
      method: raw ? 'POST' : 'GET', headers, body: raw ?? undefined,
      redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status >= 300 && response.status < 400) throw new HttpError(502, 'UPSTREAM_REDIRECT_DENIED');
    const result = await readLimited(response, maxBodyBytes * 2);
    // A malformed optional header cannot turn a genuine settlement response into
    // a retryable 502. Keep only valid original facilitator extension JSON.
    const extensionResponses = raw
      ? validatedExtensionResponsesHeader(response.headers.get('extension-responses')) : null;
    return {status: response.status, ...result, extensionResponses};
  };
  return createServer(async (req, res) => {
    const url = (() => {
      if (typeof req.url !== 'string' || req.url.length > 4096 ||
          !req.url.startsWith('/') || req.url.startsWith('//')) return null;
      try { return new URL(req.url,'http://localhost'); } catch { return null; }
    })();
    const discovery = req.method === 'GET' &&
      ['/discovery/resources','/discovery/search'].includes(url?.pathname);
    const pathname = url && !url.hash && (!url.search || discovery) ? url.pathname : null;
    if (req.method === 'GET' && pathname === '/healthz') {
      json(res, 200, {status: 'configured', networks: NETWORKS}); return;
    }
    if (!authorized(req.headers.authorization, inboundToken)) {
      json(res, 401, {error: 'UNAUTHORIZED'}); return;
    }
    if (!((req.method === 'GET' && ['/supported', '/readyz','/discovery/resources','/discovery/search'].includes(pathname)) ||
          (req.method === 'POST' && ['/verify', '/settle'].includes(pathname)))) {
      json(res, 404, {error: 'ROUTE_NOT_FOUND'}); return;
    }
    if (inflight >= maxConcurrent) {
      json(res, pathname === '/readyz' ? 503 : 429, {error: pathname === '/readyz' ? 'NOT_READY' : 'BUSY'});
      return;
    }
    inflight++;
    try {
      if (discovery) {
        if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))
          throw new HttpError(400,'DISCOVERY_BODY_NOT_ACCEPTED');
        const networks = url.searchParams.getAll('network');
        if (networks.length !== 1 || !NETWORKS.includes(networks[0]))
          throw new HttpError(400,'DISCOVERY_NETWORK_REQUIRED');
        // Route one original query and its cursor to the same network's journal.
        const peer = await queryPeer(networks[0],pathname+url.search);
        res.writeHead(peer.status,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        res.end(peer.raw);
        return;
      }
      if (pathname === '/supported' || pathname === '/readyz') {
        // Read both original facilitator capabilities on EVERY readiness request.
        // Reuse the same CAIP-family, network, scheme and signer validation as
        // native /supported; never infer readiness from configuration alone.
        const peersResult = await Promise.all(NETWORKS.map(x => queryPeer(x, '/supported')));
        if (peersResult.some(x => x.status !== 200)) throw new HttpError(502, 'UPSTREAM_SUPPORTED_FAILED');
        const supported = combineSupported(peersResult.map(x => x.data));
        if (pathname === '/readyz') {
          // A small operator signal, not an upstream inventory or ledger proof.
          json(res, 200, {status: 'ready', networks: NETWORKS.map(network => ({
            network, schemes: supported.kinds.filter(kind => kind.network === network).map(kind => kind.scheme)
          }))});
        } else {
          json(res, 200, supported);
        }
        return;
      }
      const type = req.headers['content-type'] ?? '';
      if (!/^application\/json\s*(?:;|$)/i.test(type)) throw new HttpError(415, 'JSON_REQUIRED');
      const bytes = await boundedBodyBytes(req, maxBodyBytes, bodyTimeoutMs);
      const network = targetNetwork(bytes);
      const peer = await queryPeer(network, pathname, bytes);
      if (peer.data.network !== undefined && peer.data.network !== network) {
        throw new HttpError(502, 'UPSTREAM_NETWORK_MISMATCH');
      }
      // The response is validated as JSON, then forwarded BYTE-FOR-BYTE and with the native status.
      res.writeHead(peer.status, {'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        ...(peer.extensionResponses ? {'EXTENSION-RESPONSES':peer.extensionResponses} : {})});
      res.end(peer.raw);
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      const controlled = err instanceof HttpError || err instanceof BodyReadError;
      const code = controlled ? err.code : isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
      const status = controlled ? err.status : isTimeout ? 504 : 502;
      // An expired inbound socket has been terminated. Do not write after close.
      if (!res.destroyed) json(res, pathname === '/readyz' ? 503 : status,
        {error: pathname === '/readyz' ? 'NOT_READY' : code});
    } finally { inflight--; }
  });
}
