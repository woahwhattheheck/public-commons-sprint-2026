// MIT. Declarative merchant bindings composed with the shared SF30 HTTP handler.
import { lookup as systemLookup } from 'node:dns/promises';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { isIP } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { isPublicAddress } from '../sf31-buyer-client/public-transport.mjs';
import { createUpstreamHandler } from './upstream-handler.mjs';
import { compileAvailabilityPolicy, protectUpstream } from './upstream-readiness.mjs';
import { compileResponseContract } from './response-contract.mjs';
import { compileUpstreamIdempotency, configuredUpstreamIdempotency } from './upstream-idempotency-config.mjs';
import { supportsSellerMethod } from './http-methods.mjs';
import { createUpstreamOperationControl } from './upstream-operation-control.mjs';
import { compileOAuthClientCredentials, createOAuthClientCredentials } from './oauth-client-credentials.mjs';
import { compileOAuthConnection } from './oauth-connections/profile.mjs';
import { createOAuthConnectionProvider } from './oauth-connections/provider.mjs';
import { compileUpstreamCache, createConfiguredCachedUpstream } from './response-cache/config.mjs';
import { createCacheControlBinding } from './response-cache/bind.mjs';
import { createCacheManagement } from './response-cache/control.mjs';
import { compileUpstreamStreamPolicy } from './upstream-stream.mjs';
import { compileSupplierAccounts } from './supplier-quota/config.mjs';
import { createSupplierQuotaRegistry, attachSupplierQuota } from './supplier-quota/application.mjs';
import { compileUpstreamTls, upstreamTlsReferences } from './upstream-tls/config.mjs';
import { loadUpstreamTls, deferUpstreamTls } from './upstream-tls/profile.mjs';
import { compileUpstreamTransports, upstreamTransportReferences, createUpstreamTransports } from './upstream-transports.mjs';

const SCHEMA = 'stellar-forge.seller-upstreams.v1';
const OWN = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const reserved = /^(?:host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|expect|proxy-.*|cookie|set-cookie|accept-encoding|content-encoding|content-type|origin|referer|forwarded|x-forwarded-.*|sec-.*|payment-.*|x-payment.*|extension-responses|settlement-overrides|x402-.*|www-authenticate)$/i;
const responseAllowed = new Set(['content-type','content-language','etag','last-modified','content-disposition','x-credits-remaining','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']);
const bindingKeys = new Set(['origin','path','method','query','requestHeaders','headerEnv','responseHeaders','responseMode','timeoutMs','maxResponseBytes','maxRequestBytes','bodyType','maxInFlight','availability','responseContract','idempotency','cache','oauth2','oauthConnection','stream','supplierAccount','tls','transport']);
const bad = text => { throw new TypeError(text); };
const handlerRuntimes = new WeakMap();
const handlerSupplierQuotas = new WeakMap();

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
  if (['http:','https:'].includes(url.protocol) && url.hostname === '127.0.0.1' && allowLoopback === true) return url;
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || isIP(host.replace(/^\[|\]$/g,'')) || !host.includes('.') ||
      host.length > 253 || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      ['localhost','local','localdomain','internal','home.arpa'].some(name => host === name || host.endsWith('.'+name))) {
    bad('Use public HTTPS port 443, or explicit --allow-loopback-upstream for HTTP(S) on 127.0.0.1');
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
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(source) || !/^\$?[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(target) ||
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

/** Sorted environment REFERENCES for offline review. No environment access,
 * imports, provider construction or network activity. Full compile is separate. */
export function upstreamCredentialReferences(config) {
  if (!plain(config) || config.schema !== SCHEMA || !plain(config.bindings)) bad('Expected seller-upstreams.v1');
  const references = new Set();
  const add = value => {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) bad('Invalid credential environment reference');
    references.add(value);
  };
  for (const reference of upstreamTransportReferences(config)) add(reference);
  for (const binding of Object.values(config.bindings)) {
    if (!plain(binding)) bad('Invalid upstream binding');
    for (const reference of upstreamTlsReferences(binding.tls)) add(reference);
    if (binding.headerEnv !== undefined) {
      if (!plain(binding.headerEnv)) bad('Invalid headerEnv');
      for (const value of Object.values(binding.headerEnv)) add(value);
    }
    if (binding.oauth2 !== undefined) {
      if (!plain(binding.oauth2)) bad('Invalid OAuth declaration');
      add(binding.oauth2.clientIdEnv); add(binding.oauth2.clientSecretEnv);
    }
    if (binding.oauthConnection !== undefined) {
      if (!plain(binding.oauthConnection)) bad('Invalid OAuth connection declaration');
      add(binding.oauthConnection.directoryEnv);
      if (binding.oauthConnection.clientSecretEnv !== undefined) add(binding.oauthConnection.clientSecretEnv);
    }
    if (binding.idempotency !== undefined) {
      if (!plain(binding.idempotency)) bad('Invalid idempotency declaration');
      add(binding.idempotency.keyEnv);
    }
  }
  return Object.freeze([...references].sort());
}

function resolveCredentialHeaders(references,env) {
  const credentials = Object.create(null);
  for (const [header,variable] of Object.entries(references)) {
    const value = OWN(env,variable) ? env[variable] : undefined;
    if (typeof value !== 'string' || !value || value.length > 8192) bad(`Missing or oversized environment variable: ${variable}`);
    try { validateHeaderValue(header,value); } catch { bad(`Invalid environment header value: ${variable}`); }
    credentials[header] = value;
  }
  return Object.freeze(credentials);
}

/** Trusted operator data. Deferred credentials retain validated references only;
 * the shared handler resolves their values inside an admitted backend attempt. */
export function compileUpstreamBindings(config,{allowLoopback=false,env=process.env,deferCredentials=false}={}) {
  if (typeof allowLoopback !== 'boolean' || typeof deferCredentials !== 'boolean' || !plain(config) || config.schema !== SCHEMA || !plain(config.bindings) ||
      Object.keys(config).some(k => !['schema','bindings','supplierAccounts','transports'].includes(k)) ||
      Object.keys(config.bindings).length < 1 || Object.keys(config.bindings).length > 64 || env === null || typeof env !== 'object' || Array.isArray(env)) bad('Expected seller-upstreams.v1 with 1–64 bindings');
  compileSupplierAccounts(config.supplierAccounts, config.bindings);
  const transports = compileUpstreamTransports(config.transports,config.bindings);
  const compiled = Object.create(null);
  const operationDirectories = new Set(), admissionNames = new Set();
  for (const [name,raw] of Object.entries(config.bindings)) {
    if (!/^[A-Za-z_$][\w$]{0,127}$/.test(name) || ['__proto__','prototype','constructor'].includes(name) || !plain(raw) ||
        Object.keys(raw).some(k => !bindingKeys.has(k))) bad('Invalid upstream binding');
    const url = originURL(raw.origin,allowLoopback), keys = pathKeys(raw.path);
    const tls = compileUpstreamTls(raw.tls,{origin:url.origin});
    const requestHeaders = headerList(raw.requestHeaders,'requestHeaders',name => headerName(name));
    const responseHeaders = headerList(raw.responseHeaders,'responseHeaders',name => responseAllowed.has(name));
    const credentialRefs = Object.create(null);
    if (raw.headerEnv !== undefined && (!plain(raw.headerEnv) || Object.keys(raw.headerEnv).length > 16)) bad('Invalid headerEnv');
    for (const [header,variable] of Object.entries(raw.headerEnv ?? {})) {
      const key = header.toLowerCase();
      if (!headerName(header,true) || OWN(credentialRefs,key) || requestHeaders.includes(key) ||
          typeof variable !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) bad('Invalid credential header mapping');
      credentialRefs[key] = variable;
    }
    const credentials = deferCredentials ? Object.freeze(Object.create(null)) : resolveCredentialHeaders(credentialRefs,env);
    const oauth2 = raw.oauth2 === undefined ? undefined : compileOAuthClientCredentials(raw.oauth2,
      {allowLoopback,env,validateCredentials:!deferCredentials});
    const oauthConnection = raw.oauthConnection === undefined ? undefined : compileOAuthConnection(raw.oauthConnection,{resourceOrigin:url.origin,allowLoopback});
    if (oauth2 && oauthConnection) bad('Select one OAuth grant flow for an upstream binding');
    if ((oauth2 || oauthConnection) && OWN(credentialRefs,'authorization')) bad('OAuth cannot be combined with an authorization headerEnv');
    const transport = raw.transport === undefined ? undefined : transports[raw.transport];
    if (transport?.mode === 'environment-proxy' && (url.protocol !== 'https:' ||
        oauth2 && new URL(oauth2.tokenEndpoint).protocol !== 'https:'))
      bad('Proxy profiles require HTTPS upstream and OAuth token origins');
    const method = raw.method ?? 'GET', responseMode = raw.responseMode ?? 'json';
    if (!supportsSellerMethod(method) || !['json','bytes','sse','ndjson'].includes(responseMode)) bad('Invalid upstream method or responseMode');
    const bodyType=raw.bodyType??'json';
    if (!['json','form-data'].includes(bodyType)||bodyType==='form-data'&&!['POST','PUT','PATCH'].includes(method)) bad('Invalid upstream bodyType');
    const streaming = ['sse','ndjson'].includes(responseMode);
    if (streaming && (method === 'HEAD' || OWN(raw,'cache') || OWN(raw,'idempotency') || OWN(raw,'responseContract')))
      bad('Streaming bindings require a response body and cannot combine buffered caching, idempotency or responseContract');
    if (!streaming && OWN(raw,'stream')) bad('stream settings require sse or ndjson responseMode');
    const stream = streaming ? compileUpstreamStreamPolicy(raw.stream,responseMode) : undefined;
    if (OWN(raw,'responseContract') && responseMode !== 'json') bad('Response contracts require JSON responseMode');
    const responseContract = OWN(raw,'responseContract') ? compileResponseContract(raw.responseContract,{method}).contract : undefined;
    const maxResponseBytes = integer(raw.maxResponseBytes,1_048_576,1_048_576,'maxResponseBytes');
    const idempotency = compileUpstreamIdempotency(raw.idempotency,{env,method,maxResponseBytes,requestHeaders,credentials:credentialRefs});
    if (idempotency) {
      if (OWN(config.bindings,idempotency.admission) || admissionNames.has(idempotency.admission) ||
          operationDirectories.has(idempotency.stateDir)) bad('Idempotency admission names and state directories must be distinct');
      admissionNames.add(idempotency.admission); operationDirectories.add(idempotency.stateDir);
    }
    const binding = {origin:url.origin,hostname:url.hostname,local:url.protocol === 'http:',
      path:raw.path,pathKeys:Object.freeze(keys),method,query:queryMapping(raw.query),
      bodyType,maxRequestBytes:integer(raw.maxRequestBytes,1_048_576,16*1_048_576,'maxRequestBytes'),
      requestHeaders:Object.freeze(requestHeaders),responseHeaders:Object.freeze(responseHeaders),
      credentials,...(deferCredentials ? {credentialRefs:Object.freeze(credentialRefs)} : {}),responseMode,...(idempotency ? {idempotency} : {}),
      ...(raw.supplierAccount === undefined ? {} : {supplierAccount:raw.supplierAccount}),
      ...(transport ? {transport} : {}),
      ...(stream ? {stream} : {}),
      ...(oauth2 ? {oauth2} : {}),
      ...(oauthConnection ? {oauthConnection} : {}),
      ...(tls ? {tls} : {}),
      ...(responseContract === undefined ? {} : {responseContract}),
      timeoutMs:integer(raw.timeoutMs,10000,120000,'timeoutMs'),
      maxResponseBytes,
      maxInFlight:integer(raw.maxInFlight,16,256,'maxInFlight'),
      availability:compileAvailabilityPolicy(raw.availability)};
    compiled[name] = Object.freeze({...binding,cache:compileUpstreamCache(raw.cache,binding)});
  }
  return Object.freeze(compiled);
}

/** Keep original route/method/payment identity, rather than silently rewriting config. */
export function validateUpstreamService(config,compiled) {
  if (!plain(config) || !Array.isArray(config.routes)) bad('Seller service routes required');
  const used = new Set();
  for (const route of config.routes) {
    if (!plain(route)) bad('Seller route must be an object');
    if (!OWN(route,'handler')) {
      if (OWN(route,'admit')) bad('Custom admission requires an upstream handler binding');
      continue;
    }
    if (!OWN(compiled,route.handler)) bad(`Upstream binding missing for handler: ${route.handler}`);
    const bound = compiled[route.handler];
    if (bound.idempotency ? route.admit !== bound.idempotency.admission : OWN(route,'admit')) {
      bad(`Use the configured idempotency admission for handler: ${route.handler}`);
    }
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (method !== bound.method) bad(`Seller/upstream method mismatch for handler: ${route.handler}`);
    if (['POST','PUT','PATCH'].includes(method)&&(route.definition?.bodyType??route.offer?.extensions?.bazaar?.info?.input?.bodyType??'json')!==bound.bodyType) bad(`Seller/upstream body type mismatch for handler: ${route.handler}`);
    const declaredMime = String(route.offer?.resource?.mimeType ?? '').split(';')[0].trim().toLowerCase();
    const declaredFormat = route.definition?.responseFormat ??
      (declaredMime === 'text/event-stream' ? 'sse' :
        ['application/x-ndjson','application/ndjson'].includes(declaredMime) ? 'ndjson' : 'json');
    if ((['sse','ndjson'].includes(bound.responseMode) || ['sse','ndjson'].includes(declaredFormat)) &&
        declaredFormat !== bound.responseMode) bad(`Seller/upstream stream format mismatch for handler: ${route.handler}`);
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
export function createUpstreamHandlers(config,{allowLoopback=false,env=process.env,lookup=systemLookup,deferCredentials=false}={}) {
  if (typeof lookup !== 'function') bad('lookup must be a function');
  const compiled = compileUpstreamBindings(config,{allowLoopback,env,deferCredentials});
  const handlers = Object.create(null), providers = new Map();
  // Paid launch resolves TLS before other resources. Challenge-only launch
  // retains references until the original admitted supplier attempt.
  const tlsProfiles = new Map();
  for (const binding of Object.values(compiled)) {
    if (!binding.tls) continue;
    const key = JSON.stringify(binding.tls);
    if (!tlsProfiles.has(key)) tlsProfiles.set(key,(deferCredentials ? deferUpstreamTls : loadUpstreamTls)(binding.tls,{env,origin:binding.origin}));
  }
  const transports = createUpstreamTransports(compiled,{env});
  let supplierQuotas;
  try {
  supplierQuotas = createSupplierQuotaRegistry(config);
  for (const [name,binding] of Object.entries(compiled)) {
    const agent = transports.agentFor(binding.transport?.profile);
    const key = binding.oauthConnection ? JSON.stringify(['authorizationCode',binding.origin,binding.oauthConnection,binding.transport ?? null]) :
      binding.oauth2 ? JSON.stringify({oauth2:binding.oauth2,transport:binding.transport ?? null}) : null;
    const runtime = {allowLoopback,env,lookup,...(agent ? {agent} : {})};
    if (key && !providers.has(key)) providers.set(key,binding.oauthConnection ?
      createOAuthConnectionProvider(binding.oauthConnection,{resourceOrigin:binding.origin,...runtime}) :
      createOAuthClientCredentials(binding.oauth2,{...runtime,validateCredentials:!deferCredentials}));
    const provider = key ? providers.get(key) : undefined;
    const supplierQuota = binding.supplierAccount ? supplierQuotas.controller(binding.supplierAccount) : undefined;
    const tls = binding.tls ? tlsProfiles.get(JSON.stringify(binding.tls)) : undefined;
    const options = {...(supplierQuota ? {supplierQuota} : {}),...(provider ? {credentialProvider:provider} : {}),baseUrl:binding.origin,path:binding.path,method:binding.method,
      ...(tls ? {tls} : {}),
      bodyType:binding.bodyType,maxRequestBytes:binding.maxRequestBytes,
      query:binding.query,headers:binding.credentialRefs ? () => resolveCredentialHeaders(binding.credentialRefs,env) : binding.credentials,
      requestHeaders:binding.requestHeaders,
      responseHeaders:[...new Set(['content-type',...binding.responseHeaders])],responseType:binding.responseMode,
      ...(binding.stream ? {stream:binding.stream} : {}),
      ...(binding.responseContract === undefined ? {} : {responseContract:binding.responseContract}),
      timeoutMs:binding.timeoutMs,maxResponseBytes:binding.maxResponseBytes,maxInFlight:binding.maxInFlight,
      ...(binding.idempotency ? {idempotency:configuredUpstreamIdempotency(binding.idempotency)} : {}),
      allowLocal:binding.local,...(agent ? {agent} : binding.local ? {} : {lookup:publicLookup(binding,lookup)})};
    if (binding.cache) handlers[name] = createConfiguredCachedUpstream(options,binding.cache,binding.availability);
    else {
      const handler = createUpstreamHandler(options);
      handlers[name] = binding.availability ? protectUpstream(handler,binding.availability,
        {maxInFlight:binding.maxInFlight}) : handler;
    }
    if (binding.oauthConnection) {
      const originalSnapshot=handlers[name].snapshot;
      handlers[name].snapshot=()=>{
        const {oauth2:legacyLabel,...base}=originalSnapshot();
        return Object.freeze({...base,oauthConnection:provider.snapshot()});
      };
    }
    if (supplierQuota) handlers[name] = attachSupplierQuota(handlers[name], supplierQuota,
      {preflight:!binding.cache && !binding.idempotency});
    if (tls) {
      const originalSnapshot = handlers[name].snapshot;
      handlers[name].snapshot = () => Object.freeze({...originalSnapshot(),tls:tls.snapshot()});
    }
    handlers[name] = transports.retain(handlers[name],binding.transport);
    if (binding.idempotency) handlers[binding.idempotency.admission] = handlers[name].admit;
  }
  } catch(error) {
    transports.destroy();
    const cleanup = new Set([...providers.values(),...Object.values(handlers).flatMap(handler => [handler.cache,handler.idempotency])].filter(Boolean));
    for (const control of cleanup) Promise.resolve().then(() => control.close()).catch(() => {});
    Promise.resolve().then(() => supplierQuotas?.close()).catch(() => {});
    throw error;
  }
  let closing;
  handlerSupplierQuotas.set(handlers,supplierQuotas);
  handlerRuntimes.set(handlers,options => closing ??= (async () => {
    // Retain original buffered requests and streams through their completion;
    // the original OAuth provider then persists any in-flight rotating grant.
    await transports.drain();
    try {
    const failures = [];
    const drain = async operations => {
      const results = await Promise.allSettled(operations.map(operation => Promise.resolve().then(operation)));
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      return results.map(result => result.status === 'fulfilled' ? result.value : undefined);
    };
    const cacheControls = new Set(Object.values(handlers).map(handler => handler.cache).filter(Boolean));
    const cacheResults = await drain([...cacheControls].map(control => () => control.close(options)));
    await drain([...providers.values()].map(provider => () => provider.close()));
    const idempotencyControls = new Set(Object.values(handlers).map(handler => handler.idempotency).filter(Boolean));
    await drain([...idempotencyControls].map(control => () => control.close()));
    await drain([() => supplierQuotas.close()]);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Original upstream resources did not all close');
    return cacheResults;
    } finally { transports.destroy(); }
  })());
  return Object.freeze(handlers);
}

/** Drain the original seller before releasing its private credentials/state. */
export function closeUpstreamHandlers(handlers, options) {
  const close = handlerRuntimes.get(handlers);
  if (!close) throw new TypeError('Original upstream handlers required');
  return close(options);
}

/** Compose opt-in backend admission with the original seller's schema admission.
 * The original config stays unchanged; the returned config goes to startSellerService.
 * No credentials, origins, request values or response contents enter the snapshot. */
export function createUpstreamApplication(config,bindings,options={}) {
  const compiled = compileUpstreamBindings(bindings,options);
  validateUpstreamService(config,compiled);
  const originals = createUpstreamHandlers(bindings,options), handlers = {...originals};
  const supplierQuotas = handlerSupplierQuotas.get(originals);
  const operationControl = createUpstreamOperationControl(compiled,originals,{
    closeHandlers:closeOptions => closeUpstreamHandlers(originals,closeOptions)});
  const caches = new Map(Object.entries(originals).filter(([,handler]) => handler.cache).map(([name,handler]) => [name,handler.cache]));
  const cacheBinding = createCacheControlBinding(caches, { routeIds: Object.fromEntries([...caches.keys()].map(name =>
    [name, config.routes.filter(route => route.handler === name).map(route => route.id)])) });
  const cacheManagement = createCacheManagement(cacheBinding);
  const service = structuredClone(config);
  service.maxRequestBytes=Math.max(config.maxRequestBytes??1048576,...Object.values(compiled).map(binding=>binding.maxRequestBytes));
  let sequence = 0;
  for (const route of service.routes) {
    if (compiled[route.handler]) route.maxRequestBytes=compiled[route.handler].maxRequestBytes;
    const handler = originals[route.handler];
    if (typeof handler?.admit !== 'function') continue;
    let name;
    do { name = `__sf30UpstreamAvailability${sequence++}`; } while (OWN(handlers,name));
    handlers[name] = handler.admit;
    route.admit = name;
  }
  return {config:service,handlers:Object.freeze(handlers),operationControl,cacheBinding,cacheManagement,
    ...(supplierQuotas.names.length ? {supplierQuotaSnapshot:() => supplierQuotas.snapshot()} : {}),
    invalidateCache:cacheBinding.invalidate,
    close:options => operationControl.close(options),
    snapshot:() => ({
    schema:'stellar-forge.seller-upstream-availability.v1',capturedAt:new Date().toISOString(),
    bindings:Object.entries(compiled).map(([name,binding]) => ({name,method:binding.method,
      routes:service.routes.filter(route=>route.handler===name).map(route=>({id:route.id,path:route.path})),
      protected:binding.availability !== null,...(binding.cache ? {cachePolicy:{...binding.cache,...caches.get(name).inspect().policy}} : {}),...originals[name].snapshot()})),
    semantics:{availability:'Original backend response health, not payment or settlement status',
      recovery:'One backend trial; admitted requests are not capacity reservations',
      retention:supplierQuotas.names.length ? 'Availability uses process memory; supplier quotas retain the original account ledger across restarts' : 'Process memory; restart resets availability and counters',
      requests:'No automatic probes or retries; each backend call uses the original handler'},
  })};
}
