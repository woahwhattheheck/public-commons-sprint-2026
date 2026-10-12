/** MIT. OAuth resource discovery and read-only receiving for the original MCP endpoint. */
import { createHash } from 'node:crypto';
import { createPublicHttpsFetch } from '../../stellar/scf-starforge-20261009/sf31-buyer-client/public-transport.mjs';
import { resourceMetadataLocation, validateOAuthResourceConfig } from './oauth-resource.mjs';
import { MCP_VERSION } from './http-tools.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const authToken = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const parameter = new RegExp('^(' + authToken + ')\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(' + authToken + '))\\s*$');
const parameterStart = new RegExp('^' + authToken + '[ \\t]*=');
const schemeStart = new RegExp('^(' + authToken + ')(?:[ \\t]+(.*))?$');

export class OAuthOperatorError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'OAuthOperatorError'; this.code = code; this.details = details;
  }
}
function fail(code, message, details) { throw new OAuthOperatorError(code, message, details); }
function httpsUrl(value, label = 'URL') {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value))
    fail('INVALID_URL', label + ' must be an explicit HTTPS URL');
  let url;
  try { url = new URL(value); } catch { fail('INVALID_URL', label + ' must be an explicit HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    fail('INVALID_URL', label + ' must use HTTPS without credentials or a fragment');
  return url;
}
function scopeList(value, label) {
  if (!Array.isArray(value) || value.length > 256 || value.some(x => typeof x !== 'string' || !scopeToken.test(x)))
    fail('INVALID_METADATA', label + ' must contain OAuth scope tokens');
  return [...new Set(value)];
}

/** Commas inside quoted auth parameters are data, including escaped quotes. */
export function parseBearerChallenges(header) {
  if (!header) return [];
  if (typeof header !== 'string' || header.length > 16384 || /[\r\n\0]/.test(header))
    fail('INVALID_CHALLENGE', 'Malformed authentication challenge');
  const segments = []; let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) { segments.push(header.slice(start, i).trim()); start = i + 1; }
  }
  if (quoted || escaped) fail('INVALID_CHALLENGE', 'Unterminated authentication challenge');
  segments.push(header.slice(start).trim());
  const challenges = []; let current = null;
  function addParameter(segment) {
    if (!current || !segment) return;
    const match = parameter.exec(segment);
    if (!match) { if (current.scheme === 'bearer') fail('INVALID_CHALLENGE', 'Malformed Bearer parameter'); return; }
    const name = match[1].toLowerCase();
    if (Object.hasOwn(current.parameters, name)) fail('INVALID_CHALLENGE', 'Repeated authentication parameter');
    current.parameters[name] = match[2] === undefined ? match[3] : match[2].replace(/\\(.)/g, '$1');
  }
  for (const segment of segments) {
    if (!segment) continue;
    if (parameterStart.test(segment)) { addParameter(segment); continue; }
    const match = schemeStart.exec(segment);
    if (!match) fail('INVALID_CHALLENGE', 'Malformed authentication scheme');
    current = { scheme: match[1].toLowerCase(), parameters: Object.create(null) };
    challenges.push(current); addParameter(match[2]);
  }
  return challenges.filter(x => x.scheme === 'bearer').map(x => ({ ...x.parameters }));
}

function challengeSummary(header) {
  return parseBearerChallenges(header).map(parameters => {
    const result = {};
    if (parameters.resource_metadata) result.resourceMetadata = httpsUrl(parameters.resource_metadata, 'Resource metadata URL').href;
    if (parameters.scope !== undefined) result.scopes = scopeList(parameters.scope.split(' ').filter(Boolean), 'Challenge scope');
    if (['invalid_request', 'invalid_token', 'insufficient_scope', 'access_denied', 'temporarily_unavailable'].includes(parameters.error)) result.error = parameters.error;
    // Provider descriptions and arbitrary challenge parameters may echo credentials.
    return result;
  });
}

function retryAfter(value) {
  if (!value) return undefined;
  if (/^\d{1,9}$/.test(value)) return { seconds: Number(value) };
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? { at: new Date(milliseconds).toISOString() } : undefined;
}

/** Metadata defaults to the existing connect-time DNS-pinned SF31 transport.
 * A named trusted origin uses the embedding fetch, with redirects still refused.
 * Authenticated requests are restricted separately to the exact configured resource.
 */
function operatorTransport({ trustedOrigins = [], fetchImpl = globalThis.fetch, timeoutMs = 10000,
  maxBytes = 1024 * 1024, credentialResource = null } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024)
    fail('INVALID_LIMIT', 'Timeout must be 100–120000 ms and response limit 1 KiB–8 MiB');
  if (!Array.isArray(trustedOrigins) || trustedOrigins.length > 32 || typeof fetchImpl !== 'function')
    fail('INVALID_TRANSPORT', 'Explicit trusted origins and a fetch implementation are required');
  const trusted = new Set(trustedOrigins.map(value => {
    const url = httpsUrl(value, 'Trusted origin');
    if (url.pathname !== '/' || url.search) fail('INVALID_ORIGIN', 'Trusted entries must be exact HTTPS origins');
    return url.origin;
  }));
  const publicFetch = createPublicHttpsFetch({ timeoutMs });
  const expectedResource = credentialResource === null ? null : httpsUrl(credentialResource, 'Resource').href;
  const observations = [];
  async function request(value, { method = 'GET', headers = {}, body, authenticated = false, expectJson = true } = {}) {
    const url = httpsUrl(value), requestHeaders = new Headers(headers);
    if (authenticated && (expectedResource === null || url.href !== expectedResource))
      fail('CREDENTIAL_TARGET', 'Authenticated requests must target the exact configured resource');
    if (!authenticated && requestHeaders.has('authorization'))
      fail('CREDENTIAL_TARGET', 'Discovery never accepts an authorization header');
    if (requestHeaders.has('cookie')) fail('CREDENTIAL_TARGET', 'Operator requests do not accept cookies');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response, reader;
    try {
      const transport = authenticated || trusted.has(url.origin) ? fetchImpl : publicFetch;
      response = await transport(url.href, { method, headers: Object.fromEntries(requestHeaders),
        ...(body === undefined ? {} : { body }), redirect: 'manual', signal: controller.signal });
      if (!response || !Number.isInteger(response.status) || !response.headers)
        fail('INVALID_RESPONSE', 'Transport returned no HTTP response');
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        fail('REDIRECT_REFUSED', 'Configure the final endpoint explicitly; redirects are not followed', { url: url.href, status: response.status });
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel(); fail('RESPONSE_TOO_LARGE', 'Response exceeds the configured byte limit', { url: url.href, maxBytes });
      }
      let length = 0; const chunks = [];
      if (response.body) {
        reader = response.body.getReader();
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          length += chunk.byteLength;
          if (length > maxBytes) {
            await reader.cancel(); fail('RESPONSE_TOO_LARGE', 'Response exceeds the configured byte limit', { url: url.href, maxBytes });
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      const bytes = Buffer.concat(chunks, length);
      const observation = { url: url.href, method, status: response.status, bytes: length, sha256: digest(bytes) };
      const retry = retryAfter(response.headers.get('retry-after'));
      if (retry) observation.retryAfter = retry;
      observations.push(observation);
      let json;
      if (expectJson && response.status >= 200 && response.status < 300 && response.status !== 202 && length) {
        if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
          fail('CONTENT_TYPE', 'This operator requires a complete JSON response', observation);
        try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { fail('INVALID_JSON', 'Endpoint returned invalid JSON or UTF-8', observation); }
      }
      return { ...observation, headers: response.headers, json };
    } catch (error) {
      if (error instanceof OAuthOperatorError) throw error;
      fail(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED',
        controller.signal.aborted ? 'Request exceeded its complete-response deadline' : 'HTTPS request failed; check DNS, TLS and explicitly selected origins',
        { url: url.href, method });
    } finally { clearTimeout(timer); reader?.releaseLock(); }
  }
  return { request, observations };
}

function requireSuccess(response) {
  if (response.status < 200 || response.status >= 300)
    fail('HTTP_STATUS', 'Endpoint did not return success', {
      url: response.url, status: response.status, ...(response.retryAfter ? { retryAfter: response.retryAfter } : {}),
      ...(response.status === 401 || response.status === 403 ? { challenges: challengeSummary(response.headers.get('www-authenticate')) } : {}),
    });
  if (!plain(response.json)) fail('INVALID_METADATA', 'Endpoint must return a JSON object', { url: response.url });
  return response.json;
}

export function authorizationMetadataCandidates(issuer) {
  const url = httpsUrl(issuer, 'Issuer');
  if (url.search) fail('INVALID_ISSUER', 'Issuer must not contain a query');
  const path = url.pathname === '/' ? '' : url.pathname;
  return [...new Set([
    url.origin + '/.well-known/oauth-authorization-server' + path,
    url.origin + '/.well-known/openid-configuration' + path,
    ...(path ? [url.origin + path.replace(/\/$/, '') + '/.well-known/openid-configuration'] : []),
  ])];
}

/** Discover actual public metadata and key compatibility; never sends a token. */
export async function discoverOAuthResource({ resource, issuer, expectedAuthorizationServer, ...transportOptions } = {}) {
  const location = resourceMetadataLocation(resource), { request, observations } = operatorTransport(transportOptions);
  const initial = await request(location.resource, { expectJson: false });
  if (![200, 401, 403, 404, 405].includes(initial.status))
    fail('RESOURCE_HTTP_STATUS', 'Resource discovery request failed', { status: initial.status, retryAfter: initial.retryAfter });
  const challenges = challengeSummary(initial.headers.get('www-authenticate'));
  const advertisedLocations = [...new Set(challenges.map(x => x.resourceMetadata).filter(Boolean))];
  if (advertisedLocations.length > 1) fail('AMBIGUOUS_METADATA', 'Resource advertised conflicting metadata locations');
  const candidates = [...new Set([...advertisedLocations, location.metadataUrl,
    new URL('/.well-known/oauth-protected-resource', location.resource).href])];
  let metadata, metadataUrl;
  for (const candidate of candidates) {
    const response = await request(candidate);
    if ([404, 405].includes(response.status)) continue;
    metadata = requireSuccess(response); metadataUrl = response.url; break;
  }
  if (!metadata) fail('METADATA_NOT_FOUND', 'No protected-resource metadata was found', { attempted: candidates });
  if (metadata.resource !== location.resource) fail('RESOURCE_MISMATCH', 'Protected-resource metadata does not name the configured resource', { metadataUrl });
  if (!Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.length ||
      metadata.authorization_servers.length > 16) fail('INVALID_METADATA', 'Resource must advertise one or more authorization servers');
  const issuers = [...new Set(metadata.authorization_servers.map(value => {
    const url = httpsUrl(value, 'Advertised issuer');
    if (url.search) fail('INVALID_ISSUER', 'Advertised issuer must not contain a query');
    return value; // Exact issuer strings, including trailing slash, are identity.
  }))];
  const selectedIssuer = issuer ?? (issuers.length === 1 ? issuers[0] : undefined);
  if (!selectedIssuer) fail('ISSUER_SELECTION_REQUIRED', 'Select one advertised issuer explicitly', { authorizationServers: issuers });
  if (!issuers.includes(selectedIssuer)) fail('ISSUER_MISMATCH', 'Selected issuer is not advertised by this resource');
  if (expectedAuthorizationServer && expectedAuthorizationServer.issuer !== selectedIssuer)
    fail('ISSUER_MISMATCH', 'Selected issuer differs from the pinned server configuration');
  const supportedScopes = metadata.scopes_supported === undefined ? [] : scopeList(metadata.scopes_supported, 'Supported scopes');
  if (metadata.bearer_methods_supported !== undefined && (!Array.isArray(metadata.bearer_methods_supported) ||
      !metadata.bearer_methods_supported.includes('header'))) fail('BEARER_METHOD', 'Resource metadata must support bearer tokens in request headers');
  let authorization, authorizationMetadataUrl;
  for (const candidate of authorizationMetadataCandidates(selectedIssuer)) {
    const response = await request(candidate);
    if ([404, 405].includes(response.status)) continue;
    authorization = requireSuccess(response); authorizationMetadataUrl = response.url;
    if (authorization.issuer !== selectedIssuer) fail('ISSUER_MISMATCH', 'Authorization metadata issuer must match exactly', { authorizationMetadataUrl });
    break;
  }
  if (!authorization) fail('AS_METADATA_NOT_FOUND', 'No authorization server metadata was found');
  const compatibilityProblems = [];
  const endpoints = {};
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'registration_endpoint']) {
    if (authorization[key] !== undefined) endpoints[key] = httpsUrl(authorization[key], key).href;
  }
  if (!endpoints.authorization_endpoint) compatibilityProblems.push('authorization_endpoint is missing');
  if (!endpoints.token_endpoint) compatibilityProblems.push('token_endpoint is missing');
  const pkceS256 = Array.isArray(authorization.code_challenge_methods_supported) && authorization.code_challenge_methods_supported.includes('S256');
  if (!pkceS256) compatibilityProblems.push('Authorization metadata must advertise PKCE S256 for a browser client');
  if (Array.isArray(authorization.response_types_supported) && !authorization.response_types_supported.includes('code'))
    compatibilityProblems.push('Authorization code response type is not advertised');
  let keySet = null;
  if (endpoints.jwks_uri) {
    if (expectedAuthorizationServer && new URL(expectedAuthorizationServer.jwksUri).href !== endpoints.jwks_uri)
      fail('JWKS_MISMATCH', 'Discovered JWKS differs from the explicitly pinned server configuration');
    const response = await request(endpoints.jwks_uri), document = requireSuccess(response);
    if (!Array.isArray(document.keys) || !document.keys.length || document.keys.length > 256 || document.keys.some(key => !plain(key)))
      fail('INVALID_JWKS', 'JWKS must contain 1–256 public keys');
    if (document.keys.some(key => ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field))))
      fail('PRIVATE_JWKS', 'Published JWKS must contain public asymmetric keys only');
    const usable = document.keys.filter(key => ['RSA', 'EC', 'OKP'].includes(key.kty) &&
      (!key.use || key.use === 'sig') && (!key.key_ops || Array.isArray(key.key_ops) && key.key_ops.includes('verify')) &&
      (!expectedAuthorizationServer || !key.alg || expectedAuthorizationServer.algorithms.includes(key.alg)));
    if (!usable.length) compatibilityProblems.push('No public signing key matches the configured access-token algorithms');
    keySet = { url: response.url, bytes: response.bytes, sha256: response.sha256, usableKeyCount: usable.length,
      keys: document.keys.map(key => Object.fromEntries(['kid', 'kty', 'alg', 'use', 'key_ops'].filter(field => key[field] !== undefined).map(field => [field, key[field]]))) };
  } else compatibilityProblems.push('jwks_uri is required by this JWT resource-server implementation');
  return { schema: 'stellar-forge.mcp-oauth-discovery.v1', resource: location.resource, metadataUrl,
    authorizationServers: issuers, selectedIssuer, authorizationMetadataUrl, endpoints,
    supportedScopes, challenges, pkceS256,
    registration: { clientIdMetadataDocuments: authorization.client_id_metadata_document_supported === true,
      dynamicRegistration: Boolean(endpoints.registration_endpoint), preRegistration: true },
    authorizationResponseIssuerParameter: authorization.authorization_response_iss_parameter_supported === true,
    keySet, compatible: compatibilityProblems.length === 0, compatibilityProblems, observations };
}

function rpcResult(response, id) {
  const message = requireSuccess(response);
  if (message.jsonrpc !== '2.0' || message.id !== id || !plain(message.result) || Object.hasOwn(message, 'error'))
    fail('MCP_RESPONSE', 'MCP request did not return the expected JSON-RPC result', { status: response.status });
  return message.result;
}

/** Uses an opaque token only at the configured endpoint. Lists every tool page.
 * Deliberately does not call any tool, approve a quote, sign or execute a payment.
 */
export async function probeOAuthResource({ config, token, maxPages = 64, ...transportOptions } = {}) {
  const normalized = validateOAuthResourceConfig(config);
  if (typeof token !== 'string' || !token || Buffer.byteLength(token) > normalized.maxTokenBytes || !/^[A-Za-z0-9._~+/-]+=*$/.test(token))
    fail('INVALID_TOKEN_INPUT', 'Access token must be a single nonempty value within the configured byte limit');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 256) fail('INVALID_LIMIT', 'Tool page limit must be 1–256');
  const { request, observations } = operatorTransport({ ...transportOptions, credentialResource: normalized.resource });
  let sessionId, protocolVersion, initialized = false, termination = { required: false }, failure, result, sequence = 0;
  const scrub = value => {
    if (typeof value === 'string') {
      let result = value.split(token).join('[redacted]');
      if (sessionId) result = result.split(sessionId).join('[redacted]');
      return result;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  const headers = () => ({ authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream',
    'content-type': 'application/json', ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) });
  async function call(method, params = {}, notification = false) {
    const id = notification ? undefined : ++sequence;
    const response = await request(normalized.resource, { method: 'POST', authenticated: true, headers: headers(),
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }) });
    if (method === 'initialize' && response.status >= 200 && response.status < 300) {
      const returned = response.headers.get('mcp-session-id');
      if (returned !== null) {
        if (!/^[\x21-\x7e]{1,1024}$/.test(returned)) fail('MCP_SESSION', 'MCP returned an invalid session header');
        sessionId = returned; termination = { required: true };
      }
    }
    if (notification) {
      if (response.status !== 202) fail('MCP_NOTIFICATION', 'Initialized notification must receive HTTP 202', { status: response.status });
      return;
    }
    return rpcResult(response, id);
  }
  try {
    const hello = await call('initialize', { protocolVersion: MCP_VERSION, capabilities: {},
      clientInfo: { name: 'starforge-oauth-operator', version: '1.0.0' } });
    if (hello.protocolVersion !== MCP_VERSION) fail('MCP_VERSION', 'Endpoint selected a protocol version this installed operator does not support', { supported: MCP_VERSION });
    protocolVersion = hello.protocolVersion;
    if (!plain(hello.serverInfo) || typeof hello.serverInfo.name !== 'string' || typeof hello.serverInfo.version !== 'string')
      fail('MCP_IDENTITY', 'Endpoint must return its MCP server identity');
    if (!plain(hello.capabilities?.tools)) fail('MCP_CAPABILITY', 'Endpoint does not advertise tools');
    await call('notifications/initialized', {}, true); initialized = true;
    const catalog = [], seenNames = new Set(), seenCursors = new Set();
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const listed = await call('tools/list', cursor === undefined ? {} : { cursor });
      if (!Array.isArray(listed.tools)) fail('MCP_CATALOG', 'Tool page must contain a tools array');
      for (const tool of listed.tools) {
        if (!plain(tool) || typeof tool.name !== 'string' || !/^[-A-Za-z0-9_.]{1,128}$/.test(tool.name) || !plain(tool.inputSchema) || seenNames.has(tool.name))
          fail('MCP_CATALOG', 'Tool catalog contains an invalid or repeated tool');
        seenNames.add(tool.name);
        catalog.push({ name: tool.name, inputSchemaSha256: digest(JSON.stringify(tool.inputSchema)),
          ...(plain(tool.outputSchema) ? { outputSchemaSha256: digest(JSON.stringify(tool.outputSchema)) } : {}) });
        if (catalog.length > 10000) fail('MCP_CATALOG_LIMIT', 'Tool catalog exceeds the complete receiving limit');
      }
      if (listed.nextCursor === undefined || listed.nextCursor === null) break;
      if (typeof listed.nextCursor !== 'string' || !listed.nextCursor || listed.nextCursor.length > 4096 || seenCursors.has(listed.nextCursor))
        fail('MCP_CURSOR', 'Tool pagination returned an invalid or repeated cursor');
      seenCursors.add(listed.nextCursor); cursor = listed.nextCursor;
      if (page + 1 === maxPages) fail('MCP_CATALOG_LIMIT', 'More tool pages remain; catalog was not reported as complete', { maxPages });
    }
    result = { schema: 'stellar-forge.mcp-oauth-probe.v1', resource: normalized.resource, tokenProvided: true,
      initialized, protocolVersion, serverInfo: { name: hello.serverInfo.name, version: hello.serverInfo.version },
      tools: catalog, toolCount: catalog.length, catalogComplete: true };
  } catch (error) { failure = error; }
  finally {
    if (sessionId) {
      try {
        const ended = await request(normalized.resource, { method: 'DELETE', authenticated: true,
          headers: { ...headers(), 'MCP-Protocol-Version': protocolVersion ?? MCP_VERSION }, expectJson: false });
        termination = { required: true, status: ended.status,
          state: ended.status >= 200 && ended.status < 300 ? 'closed' : ended.status === 405 ? 'unsupported' : 'failed' };
      } catch (error) { termination = { required: true, state: 'failed', code: error.code ?? 'REQUEST_FAILED' }; }
    }
  }
  if (failure) {
    throw new OAuthOperatorError(failure.code ?? 'PROBE_FAILED', failure instanceof OAuthOperatorError ? failure.message : 'MCP connection check failed',
      scrub({ ...(failure instanceof OAuthOperatorError ? failure.details : {}), initialized, termination, observations }));
  }
  return scrub({ ...result, termination, observations });
}
