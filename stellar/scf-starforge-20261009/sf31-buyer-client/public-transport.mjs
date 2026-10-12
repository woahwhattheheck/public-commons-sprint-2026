// MIT. SF31 connect-time public HTTPS transport. Node 22+, no dependencies.
import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { Readable } from 'node:stream';
import { MAX_REQUEST_BODY_BYTES } from './request-body.mjs';
import { parseExplicitProxy, oneShotConnectAgent } from '../sf85-live-402-capture/proxy-connect.mjs';

const denied4 = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24],
  ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24],
  ['224.0.0.0',4], ['240.0.0.0',4]
]) denied4.addSubnet(ip, prefix, 'ipv4');
// The managed-cloud 198.18/15 HTTPS egress overlay is never public by default.
// A trusted caller must approve its ONE exact current DNS address per fetch.
const managedOverlay4 = new BlockList();
managedOverlay4.addSubnet('198.18.0.0', 15, 'ipv4');
const isManagedOverlayAddress = address =>
  typeof address === 'string' && isIP(address) === 4 &&
  managedOverlay4.check(address, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const denied6 = new BlockList();
for (const [ip, prefix] of [
  ['2001::',23], ['2001:db8::',32], ['2002::',16], ['3fff::',20]
]) denied6.addSubnet(ip, prefix, 'ipv6');

export class PublicTransportError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'PublicTransportError'; this.code = code;
  }
}
const fail = code => { throw new PublicTransportError(code); };
/** Conservative public-unicast policy, not a routability or ownership oracle. */
export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  return family === 4 ? !denied4.check(address, 'ipv4')
    : family === 6 && global6.check(address, 'ipv6') && !denied6.check(address, 'ipv6');
}
function checkedURL(input) {
  let url;
  try { url = new URL(input); } catch { fail('BAD_PUBLIC_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    fail('BAD_PUBLIC_URL');
  // Explicit custom HTTPS ports are not open network access: the production
  // transport only serves 443. No IP literals, private names, or single labels.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.port && url.port !== '443') fail('PUBLIC_HTTPS_PORT_REQUIRED');
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') ||
      ['localhost','local','localdomain','internal','home.arpa'].some(
        name => host === name || host.endsWith('.' + name))) fail('UNSAFE_RESOURCE_HOST');
  if (host.length > 253 || host.split('.').some(
    part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) fail('BAD_PUBLIC_URL');
  url.hostname = host;
  return url;
}
/** Trusted operator configuration only; an offer cannot select its own proxy. */
export function normalizeBuyerTransport(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['mode','origin','proxyUrl','proxyEnv'].includes(key)) ||
      value.mode !== 'explicit-connect') fail('INVALID_BUYER_TRANSPORT');
  const target = checkedURL(value.origin);
  if (value.origin !== target.origin) fail('BUYER_TRANSPORT_EXACT_ORIGIN_REQUIRED');
  if ((value.proxyUrl === undefined) === (value.proxyEnv === undefined))
    fail('ONE_EXPLICIT_PROXY_SOURCE_REQUIRED');
  if (value.proxyEnv !== undefined) {
    if (typeof value.proxyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.proxyEnv))
      fail('INVALID_PROXY_ENVIRONMENT_NAME');
    return Object.freeze({mode:'explicit-connect', origin:target.origin, proxyEnv:value.proxyEnv});
  }
  // This original parser rejects credentials, paths, queries and fragments.
  parseExplicitProxy(value.proxyUrl);
  return Object.freeze({mode:'explicit-connect', origin:target.origin,
    proxyUrl:new URL(value.proxyUrl).origin});
}
/** Resolve only the explicitly named proxy variable; never auto-detect a proxy. */
export function resolveBuyerProxy(value, environment = process.env) {
  const profile = normalizeBuyerTransport(value);
  const raw = profile.proxyEnv === undefined ? profile.proxyUrl : environment?.[profile.proxyEnv];
  if (profile.proxyEnv !== undefined && typeof raw !== 'string')
    fail('BUYER_PROXY_ENVIRONMENT_REQUIRED');
  return Object.freeze(parseExplicitProxy(raw));
}
/** Explicit operator-owned source access; never derive this from remote links. */
export function normalizeSourceAuthorization(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['origin','scheme'].includes(key)) ||
      value.scheme !== 'Bearer') fail('INVALID_SOURCE_AUTHORIZATION');
  const target = checkedURL(value.origin);
  if (value.origin !== target.origin) fail('SOURCE_AUTHORIZATION_EXACT_ORIGIN_REQUIRED');
  return Object.freeze({origin:target.origin, scheme:'Bearer'});
}
function requestData(init, paymentAuthorization = false, sourceAuthorization = null) {
  const allowed = new Set(['method', 'headers', 'body', 'redirect', 'signal']);
  if (Object.keys(init).some(key => !allowed.has(key)) ||
      (init.redirect !== undefined && init.redirect !== 'manual')) fail('UNSUPPORTED_FETCH_OPTION');
  const method = String(init.method ?? 'GET').toUpperCase();
  if (!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method)) fail('BAD_METHOD');
  let body;
  if (init.body != null) {
    if (typeof init.body !== 'string' && !(init.body instanceof Uint8Array)) fail('NONREPLAYABLE_BODY');
    body = Buffer.from(init.body);
    if (body.length > MAX_REQUEST_BODY_BYTES || ['GET','HEAD'].includes(method)) fail('BAD_REQUEST_BODY');
  }
  const headers = new Headers(init.headers);
  // A caller may supply PAYMENT-SIGNATURE only via SF31's approved retry;
  // transport/framing/routing headers can never override the pinned connection.
  for (const name of headers.keys()) {
    if (/^(host|connection|content-length|transfer-encoding|te|trailer|upgrade|expect|proxy-.*|cookie|accept-encoding)$/i.test(name))
      fail('FORBIDDEN_TRANSPORT_HEADER');
  }
  if (headers.has('authorization')) {
    const value = headers.get('authorization');
    const payment = paymentAuthorization && /^Payment [A-Za-z0-9_-]{1,65528}$/.test(value);
    const source = sourceAuthorization !== null && value.length <= 16391 &&
      /^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(value);
    if (!payment && !source) fail('FORBIDDEN_TRANSPORT_HEADER');
  }
  if (sourceAuthorization !== null && (headers.has('payment-signature') || headers.has('x-payment')))
    fail('SOURCE_AUTHORIZATION_PAYMENT_HEADER_FORBIDDEN');
  headers.set('accept-encoding', 'identity');
  if (body !== undefined) headers.set('content-length', String(body.length));
  if (init.signal !== undefined && !(init.signal instanceof AbortSignal)) fail('BAD_ABORT_SIGNAL');
  return {method, headers: Object.fromEntries(headers), body};
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', stop);
    signal.addEventListener('abort', stop, {once:true});
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); }
    );
  });
}
/**
 * Fetch subset consumed by ORIGINAL SF31. lookup/requestImpl are trusted
 * dependency-injection seams for local tests, NEVER untrusted request options.
 * createPublicBuyer() exposes neither seam. Defaults use actual OS DNS and TLS.
 */
export function createPublicHttpsFetch({
  timeoutMs=30_000, lookup=systemLookup, requestImpl=httpsRequest,
  sandboxGatewayIPv4=null, trustedProxy=null, paymentAuthorization=false, sourceAuthorization=null
}={}) {
  if (typeof paymentAuthorization !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 ||
      typeof lookup !== 'function' || typeof requestImpl !== 'function' ||
      (sandboxGatewayIPv4 !== null && !isManagedOverlayAddress(sandboxGatewayIPv4)) ||
      (sandboxGatewayIPv4 !== null && trustedProxy !== null))
    throw new TypeError('Invalid transport configuration');
  const profile = trustedProxy === null ? null : normalizeBuyerTransport(trustedProxy);
  const source = sourceAuthorization === null ? null : normalizeSourceAuthorization(sourceAuthorization);
  if (source !== null && paymentAuthorization) fail('SOURCE_AND_PAYMENT_AUTHORIZATION_CONFLICT');
  if (source !== null && profile !== null && source.origin !== profile.origin)
    fail('SOURCE_AUTHORIZATION_PROXY_ORIGIN_MISMATCH');
  const proxy = profile === null ? null : resolveBuyerProxy(profile);
  return async function publicHttpsFetch(input, init={}) {
    const url = checkedURL(input);
    if (profile !== null && url.origin !== profile.origin) fail('BUYER_TRANSPORT_ORIGIN_MISMATCH');
    if (source !== null && url.origin !== source.origin) fail('SOURCE_AUTHORIZATION_ORIGIN_MISMATCH');
    const {method, headers, body} = requestData(init, paymentAuthorization, source);
    const controller = new AbortController();
    const {signal} = controller;
    const stop = () => controller.abort(init.signal.reason);
    if (init.signal?.aborted) controller.abort(init.signal.reason);
    else init.signal?.addEventListener('abort', stop, {once:true});
    // Deadline includes DNS, TLS, response and downstream body consumption.
    const timer = setTimeout(() => controller.abort(new PublicTransportError('PUBLIC_HTTPS_TIMEOUT')), timeoutMs);
    let incoming, stopTunnel;
    const cleanup = () => {
      clearTimeout(timer); init.signal?.removeEventListener('abort', stop); stopTunnel?.();
    };
    try {
      signal.throwIfAborted();
      let connection;
      if (profile !== null) {
        // The operator approves this exact origin and explicit resolving proxy.
        // Preserve the original merchant SNI/TLS and HTTP request inside it.
        const tunnel = oneShotConnectAgent({target:url, proxy, resolveAtProxy:true, signal});
        stopTunnel = tunnel.stop;
        connection = {agent:tunnel.agent};
      } else {
        const answers = await abortable(lookup(url.hostname, {all:true, verbatim:true}), signal);
        signal.throwIfAborted();
        if (!Array.isArray(answers) || !answers.length || answers.length > 64 || answers.some(
          row => !row || ![4,6].includes(row.family) || isIP(row.address) !== row.family))
          fail('NONPUBLIC_DNS_ANSWER');
        if (sandboxGatewayIPv4 === null) {
          if (answers.some(row => !isPublicAddress(row.address))) fail('NONPUBLIC_DNS_ANSWER');
        } else {
          // Fail closed on stale/mixed DNS, including one public plus one gateway.
          // Original hostname, port, SNI, TLS and pinned lookup remain unchanged.
          if (answers.length !== 1 || answers[0].family !== 4 ||
              answers[0].address !== sandboxGatewayIPv4)
            fail('SANDBOX_GATEWAY_DNS_MISMATCH');
        }
        // Copy validated primitives: the trusted resolver's mutable return object
        // cannot alter the address after policy validation.
        const {address, family} = answers[0];
        const pinnedLookup = (host, options, callback) => {
          if (typeof options === 'function') { callback = options; options = {}; }
          if (host !== url.hostname) { callback(new PublicTransportError('DNS_PIN_HOST_MISMATCH')); return; }
          if (options?.all) callback(null, [{address, family}]);
          else callback(null, address, family);
        };
        connection = {lookup:pinnedLookup, family, autoSelectFamily:false, agent:false};
      }
      incoming = await new Promise((resolve, reject) => {
        const req = requestImpl({
          protocol:'https:', hostname:url.hostname, port:443,
          // href preserves an explicit empty query, which URL.search drops.
          // SF31 binds this exact resource identity before approving payment.
          path:url.href.slice(url.origin.length), method, headers,
          ...connection, servername:url.hostname, rejectUnauthorized:true,
          checkServerIdentity, minVersion:'TLSv1.2', maxHeaderSize:65_536, signal
        }, resolve);
        req.once('error', reject);
        req.end(body);
      });
      signal.throwIfAborted();
      const responseHeaders = new Headers();
      for (let i=0; i<incoming.rawHeaders.length; i+=2)
        responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i+1]);
      if (responseHeaders.has('content-encoding') && responseHeaders.get('content-encoding').toLowerCase() !== 'identity')
        fail('UNSUPPORTED_CONTENT_ENCODING');
      // No redirects, automatic auth, cookies, implicit proxy, pooled socket or
      // reconnect: at most one original request per invocation.
      incoming.once('close', cleanup);
      const noBody = method === 'HEAD' || [204,205,304].includes(incoming.statusCode);
      const stream = noBody ? null : Readable.toWeb(incoming, {
        strategy: {highWaterMark:65_536, size:chunk => chunk.byteLength}
      });
      if (noBody) incoming.resume();
      const response = new Response(stream, {status:incoming.statusCode, headers:responseHeaders});
      Object.defineProperty(response, 'url', {value:url.href});
      return response;
    } catch (error) {
      incoming?.destroy(); cleanup();
      throw error;
    }
  };
}
