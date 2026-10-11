// MIT. Declarative merchant bindings composed with the shared SF30 HTTP handler.
import { lookup as systemLookup } from 'node:dns/promises';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { isIP } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { isPublicAddress } from '../sf31-buyer-client/public-transport.mjs';
import { createUpstreamHandler } from './upstream-handler.mjs';
import { compileAvailabilityPolicy, protectUpstream } from './upstream-readiness.mjs';
import { compileResponseContract } from './response-contract.mjs';
import { supportsSellerMethod } from './http-methods.mjs';

const SCHEMA = 'stellar-forge.seller-upstreams.v1';
const OWN = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const reserved = /^(?:host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|expect|proxy-.*|cookie|set-cookie|accept-encoding|content-encoding|content-type|origin|referer|forwarded|x-forwarded-.*|sec-.*|payment-.*|x-payment.*|extension-responses|settlement-overrides|x402-.*|www-authenticate)$/i;
const responseAllowed = new Set(['content-type','content-language','etag','last-modified','content-disposition']);
const bindingKeys = new Set(['origin','path','method','query','requestHeaders','headerEnv','responseHeaders','responseMode','timeoutMs','maxResponseBytes','maxInFlight','availability','responseContract']);
const bad = text => { throw new TypeError(text); };

function integer(value,fallback,max,name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) bad(`Invalid ${name}`);
  return result;
}
function headerList(values,name,check) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 32 || values.some(v => typeof v !== 'string')) bad(`Invalid ${name}`);
  const list = values.map(v => v.toLowerCase());
  if (list.some(v => !check(v)) || new Set(list).size !== list.length) bad(`Invalid or duplicate ${name}`);
  return list;
}
function headerName(name,credentials=false) {
  try { validateHeaderName(name); } catch { return false; }
  return !reserved.test(name) && (credentials || !['authorization','x-api-key','api-key','apikey'].includes(name.toLowerCase()));
}
function originURL(value,allowLoopback) {
  let url;
  try { url = new URL(value); } catch { bad('Upstream origin must be a canonical origin'); }
  if (typeof value !== 'string' || value !== url.origin || url.username || url.password || url.search || url.hash || url.pathname !== '/') bad('Upstream origin must be a canonical origin');
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && allowLoopback === true) return url;
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || isIP(host.replace(/^\[|\]$/g,'')) || !host.includes('.') ||
      host.length > 253 || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      ['localhost','local','localdomain','internal','home.arpa'].some(name => host === name || host.endsWith('.'+name))) {
    bad('Use public HTTPS port 443, or explicit --allow-loopback-upstream for http://127.0.0.1');
  }
  return url;
}
function pathKeys(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^\/(?:[A-Za-z0-9._~:-]+\/)*[A-Za-z0-9._~:-]*$/.test(value)) bad('Invalid upstream path template');
  const keys = [];
  for (const part of value.split('/')) {
    if (part === '.' || part === '..') bad('Upstream path must not contain dot segments');
    if (part.includes(':')) {
      if (!/^:[A-Za-z_][A-Za-z0-9_]*$/.test(part)) bad('Path parameters occupy one complete segment');
      keys.push(part.slice(1));
    }
  }
  return keys;
}
function queryMapping(value=[]) {
  if ((!Array.isArray(value) && !plain(value)) || Object.keys(value).length > 64) bad('Invalid query mapping');
  const pairs = Array.isArray(value) ? value.map(name => [name,name]) : Object.entries(value);
  const sources = new Set(),targets = new Set();
  for (const [source,target] of pairs) {
    if (typeof source !== 'string' || typeof target !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(source) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(target) ||
        sources.has(source) || targets.has(target)) bad('Invalid or ambiguous query mapping');
    sources.add(source); targets.add(target);
  }
  return Object.freeze(Object.fromEntries(pairs));
}

/** Read data only. No imports, network calls or environment expansion. */
export async function readUpstreamBindings(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1_048_576) bad('Upstreams must be a JSON file up to 1 MiB');
  const data = await readFile(path);
  if (data.length > 1_048_576) bad('Upstreams exceed 1 MiB');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}

/** Trusted operator data, captured once; compiled objects contain private headers. */
export function compileUpstreamBindings(config,{allowLoopback=false,env=process.env}={}) {
  if (typeof allowLoopback !== 'boolean' || !plain(config) || config.schema !== SCHEMA || !plain(config.bindings) ||
      Object.keys(config).some(k => !['schema','bindings'].includes(k)) ||
      Object.keys(config.bindings).length < 1 || Object.keys(config.bindings).length > 64 || env === null || typeof env !== 'object' || Array.isArray(env)) bad('Expected seller-upstreams.v1 with 1–64 bindings');
  const compiled = Object.create(null);
  for (const [name,raw] of Object.entries(config.bindings)) {
    if (!/^[A-Za-z_$][\w$]{0,127}$/.test(name) || ['__proto__','prototype','constructor'].includes(name) || !plain(raw) ||
        Object.keys(raw).some(k => !bindingKeys.has(k))) bad('Invalid upstream binding');
    const url = originURL(raw.origin,allowLoopback), keys = pathKeys(raw.path);
    const requestHeaders = headerList(raw.requestHeaders,'requestHeaders',name => headerName(name));
    const responseHeaders = headerList(raw.responseHeaders,'responseHeaders',name => responseAllowed.has(name));
    const credentials = Object.create(null);
    if (raw.headerEnv !== undefined && (!plain(raw.headerEnv) || Object.keys(raw.headerEnv).length > 16)) bad('Invalid headerEnv');
    for (const [header,variable] of Object.entries(raw.headerEnv ?? {})) {
      const key = header.toLowerCase();
      if (!headerName(header,true) || OWN(credentials,key) || requestHeaders.includes(key) ||
          typeof variable !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) bad('Invalid credential header mapping');
      const value = OWN(env,variable) ? env[variable] : undefined;
      if (typeof value !== 'string' || !value || value.length > 8192) bad(`Missing or oversized environment variable: ${variable}`);
      try { validateHeaderValue(header,value); } catch { bad(`Invalid environment header value: ${variable}`); }
      credentials[key] = value;
    }
    const method = raw.method ?? 'GET', responseMode = raw.responseMode ?? 'json';
    if (!supportsSellerMethod(method) || !['json','bytes'].includes(responseMode)) bad('Invalid upstream method or responseMode');
    if (OWN(raw,'responseContract') && responseMode !== 'json') bad('Response contracts require JSON responseMode');
    const responseContract = OWN(raw,'responseContract') ? compileResponseContract(raw.responseContract,{method}).contract : undefined;
    compiled[name] = Object.freeze({origin:url.origin,hostname:url.hostname,local:url.protocol === 'http:',
      path:raw.path,pathKeys:Object.freeze(keys),method,query:queryMapping(raw.query),
      requestHeaders:Object.freeze(requestHeaders),responseHeaders:Object.freeze(responseHeaders),
      credentials:Object.freeze(credentials),responseMode,
      ...(responseContract === undefined ? {} : {responseContract}),
      timeoutMs:integer(raw.timeoutMs,10000,120000,'timeoutMs'),
      maxResponseBytes:integer(raw.maxResponseBytes,1_048_576,1_048_576,'maxResponseBytes'),
      maxInFlight:integer(raw.maxInFlight,16,256,'maxInFlight'),
      availability:compileAvailabilityPolicy(raw.availability)});
  }
  return Object.freeze(compiled);
}

/** Keep original route/method/payment identity, rather than silently rewriting config. */
export function validateUpstreamService(config,compiled) {
  if (!plain(config) || !Array.isArray(config.routes)) bad('Seller service routes required');
  const used = new Set();
  for (const route of config.routes) {
    if (!plain(route)) bad('Seller route must be an object');
    if (OWN(route,'admit')) bad('Custom admission functions use original serve.mjs with createUpstreamHandlers');
    if (!OWN(route,'handler')) continue;
    if (!OWN(compiled,route.handler)) bad(`Upstream binding missing for handler: ${route.handler}`);
    const bound = compiled[route.handler];
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (method !== bound.method) bad(`Seller/upstream method mismatch for handler: ${route.handler}`);
    const serviceKeys = new Set(String(route.path).split('/').filter(s => s.startsWith(':')).map(s => s.slice(1)));
    if (bound.pathKeys.some(key => !serviceKeys.has(key))) bad(`Missing seller path parameter for handler: ${route.handler}`);
    used.add(route.handler);
  }
  if (Object.keys(compiled).some(name => !used.has(name))) bad('Unused upstream binding; check handler names');
  return true;
}

/** Callback runs inside the shared handler's one Node socket connection/deadline. */
function publicLookup(binding,lookup) {
  return (host,options,callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    Promise.resolve().then(async () => {
      if (host !== binding.hostname) throw new Error('UPSTREAM_DNS_PIN_MISMATCH');
      const rows = await lookup(host,{all:true,verbatim:true});
      if (!Array.isArray(rows) || !rows.length || rows.length > 64 || rows.some(row =>
        !row || !isPublicAddress(row.address) || ![4,6].includes(row.family) || isIP(row.address) !== row.family)) throw new Error('UPSTREAM_DNS_NOT_PUBLIC');
      const {address,family} = rows[0];
      if (options?.all) callback(null,[{address,family}]); else callback(null,address,family);
    }).catch(() => callback(new Error('UPSTREAM_DNS_NOT_PUBLIC')));
  };
}

/** One shared transport, no duplicate exchange/decompression/payment implementation. */
export function createUpstreamHandlers(config,{allowLoopback=false,env=process.env,lookup=systemLookup}={}) {
  if (typeof lookup !== 'function') bad('lookup must be a function');
  const compiled = compileUpstreamBindings(config,{allowLoopback,env});
  const handlers = Object.create(null);
  for (const [name,binding] of Object.entries(compiled)) {
    const handler = createUpstreamHandler({baseUrl:binding.origin,path:binding.path,method:binding.method,
      query:binding.query,headers:binding.credentials,requestHeaders:binding.requestHeaders,
      responseHeaders:[...new Set(['content-type',...binding.responseHeaders])],responseType:binding.responseMode,
      ...(binding.responseContract === undefined ? {} : {responseContract:binding.responseContract}),
      timeoutMs:binding.timeoutMs,maxResponseBytes:binding.maxResponseBytes,maxInFlight:binding.maxInFlight,
      allowLocal:binding.local,...(binding.local ? {} : {lookup:publicLookup(binding,lookup)})});
    handlers[name] = binding.availability ? protectUpstream(handler,binding.availability,
      {maxInFlight:binding.maxInFlight}) : handler;
  }
  return Object.freeze(handlers);
}

/** Compose opt-in backend admission with the original seller's schema admission.
 * The original config stays unchanged; the returned config goes to startSellerService.
 * No credentials, origins, request values or response contents enter the snapshot. */
export function createUpstreamApplication(config,bindings,options={}) {
  const compiled = compileUpstreamBindings(bindings,options);
  validateUpstreamService(config,compiled);
  const originals = createUpstreamHandlers(bindings,options), handlers = {...originals};
  const service = structuredClone(config);
  let sequence = 0;
  for (const route of service.routes) {
    const handler = originals[route.handler];
    if (typeof handler?.admit !== 'function') continue;
    let name;
    do { name = `__sf30UpstreamAvailability${sequence++}`; } while (OWN(handlers,name));
    handlers[name] = handler.admit;
    route.admit = name;
  }
  return {config:service,handlers:Object.freeze(handlers),snapshot:() => ({
    schema:'stellar-forge.seller-upstream-availability.v1',capturedAt:new Date().toISOString(),
    bindings:Object.entries(compiled).map(([name,binding]) => ({name,method:binding.method,
      protected:binding.availability !== null,...originals[name].snapshot()})),
    semantics:{availability:'Original backend response health, not payment or settlement status',
      recovery:'One backend trial; admitted requests are not capacity reservations',
      retention:'Process memory; restart resets availability and counters',
      requests:'No automatic probes or retries; each backend call uses the original handler'},
  })};
}
