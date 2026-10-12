// MIT. FilmDrop reads use the maintained SF31 transport and SF88 private store.
import { join } from 'node:path';
import { createPublicHttpsFetch, normalizeBuyerTransport } from '../../../sf31-buyer-client/public-transport.mjs';
import { createSourceBearerAuth } from '../../../sf31-buyer-client/source-auth.mjs';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, exists, need, intent }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, sha256, publicURL } from '../provider.mjs';

export const PROCESSING_CONTRACT = 'scf-filmdrop-contract/v1';
const MAX_BODY = 64 * 1024 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const stamp = () => new Date().toISOString();
const digest = value => sha256(canonicalJson(value));
const hashPattern = /^[a-f0-9]{64}$/;
const reference = value => { need(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value), 'PROCESSING_CREDENTIAL_ENV_INVALID'); return value; };

export function normalizeDeployment(input) {
  need(object(input), 'PROCESSING_DEPLOYMENT_REQUIRED');
  const url = new URL(publicURL(input.baseUrl));
  need(!url.search, 'PROCESSING_DEPLOYMENT_QUERY_UNSUPPORTED');
  const baseUrl = url.href.replace(/\/+$/, '');
  const result = { id: intent(input.id), title: String(input.title || input.id).slice(0, 160), baseUrl,
    pageSize: input.pageSize ?? 100, maxPages: input.maxPages ?? 100000,
    timeoutMs: input.timeoutMs ?? 120000, maxResponseBytes: input.maxResponseBytes ?? MAX_BODY,
    credential: null };
  need(Number.isSafeInteger(result.pageSize) && result.pageSize >= 1 && result.pageSize <= 1000, 'PROCESSING_PAGE_SIZE_INVALID');
  need(Number.isSafeInteger(result.maxPages) && result.maxPages > 0 && result.maxPages <= 100000, 'PROCESSING_PAGE_LIMIT_INVALID');
  need(Number.isSafeInteger(result.timeoutMs) && result.timeoutMs >= 1000 && result.timeoutMs <= 300000, 'PROCESSING_TIMEOUT_INVALID');
  need(Number.isSafeInteger(result.maxResponseBytes) && result.maxResponseBytes > 0 && result.maxResponseBytes <= MAX_BODY, 'PROCESSING_RESPONSE_LIMIT_INVALID');
  if (input.credential !== undefined && input.credential !== null) {
    const c = input.credential;
    need(object(c) && typeof c.header === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,100}$/.test(c.header) &&
      !/^(host|cookie|proxy-|connection|content-length|transfer-encoding)/i.test(c.header), 'PROCESSING_CREDENTIAL_HEADER_INVALID');
    const prefix = c.prefix ?? '';
    need(typeof prefix === 'string' && prefix.length <= 80 && !/[\r\n\0]/.test(prefix), 'PROCESSING_CREDENTIAL_PREFIX_INVALID');
    need(c.header.toLowerCase() !== 'authorization' || /^Bearer $/i.test(prefix), 'PROCESSING_AUTHORIZATION_REQUIRES_BEARER');
    result.credential = { envRef: reference(c.envRef), header: c.header, prefix };
  }
  return result;
}

export function processingUrl(value, baseUrl) {
  const base = new URL(baseUrl), url = new URL(publicURL(value, baseUrl + '/'));
  const prefix = base.pathname.replace(/\/+$/, '');
  need(url.origin === base.origin && (prefix === '' || url.pathname === prefix || url.pathname.startsWith(prefix + '/')),
    'PROCESSING_RESPONSE_ORIGIN_OR_PREFIX_CHANGED');
  return url.href;
}

function pointer(document, ref) {
  need(typeof ref === 'string' && ref.startsWith('#/'), 'PROCESSING_EXTERNAL_SCHEMA_REFERENCE_UNSUPPORTED');
  let value = document;
  for (const part of ref.slice(2).split('/')) value = value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  need(object(value), 'PROCESSING_SCHEMA_REFERENCE_MISSING'); return value;
}

export function readProcessingContract(body, deployment, metadata = {}) {
  need(Buffer.isBuffer(body) && body.length > 0 && body.length <= MAX_BODY, 'PROCESSING_OPENAPI_BYTES_REQUIRED');
  need(metadata.status === undefined || metadata.status === null || Number.isSafeInteger(metadata.status) && metadata.status >= 100 && metadata.status <= 599, 'PROCESSING_SOURCE_HTTP_STATUS_INVALID');
  if (metadata.sha256 !== undefined) need(hashPattern.test(metadata.sha256) && sha256(body) === metadata.sha256, 'PROCESSING_SOURCE_HASH_MISMATCH');
  let doc; try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { need(false, 'PROCESSING_OPENAPI_JSON_INVALID'); }
  need(object(doc) && /^3\./.test(doc.openapi || '') && object(doc.paths), 'PROCESSING_OPENAPI_REQUIRED');
  const routes = {};
  const endings = { instances: '/workflows/instances', runs: '/workflows/runs', sources: '/workflows/sources',
    definitions: '/workflows/definitions', lambdaLogs: '/workflows/logs/lambda', batchLogs: '/workflows/logs/batch' };
  for (const [name, ending] of Object.entries(endings)) {
    const matches = Object.entries(doc.paths).filter(([path, item]) => path.replace(/\/+$/, '').endsWith(ending) && object(item?.get));
    need(matches.length <= 1, 'PROCESSING_ROUTE_AMBIGUOUS');
    if (!matches.length) continue;
    const [path, item] = matches[0], operation = item.get;
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(p => p.$ref ? pointer(doc, p.$ref) : p);
    routes[name] = { path, operationId: operation.operationId ?? null,
      query: parameters.filter(p => p.in === 'query').map(p => ({ name: p.name, required: p.required === true,
        schema: p.schema?.$ref ? pointer(doc, p.schema.$ref) : p.schema ?? {} })) };
  }
  need(routes.instances && routes.runs, 'PROCESSING_WORKFLOW_ROUTES_REQUIRED');
  const runNames = routes.runs.query.map(p => p.name);
  const workflowFilter = runNames.includes('workflow_ids') ? 'workflow_ids' : runNames.includes('workflow_id') ? 'workflow_id' : null;
  need(workflowFilter && runNames.includes('limit') && routes.instances.query.some(p => p.name === 'limit'), 'PROCESSING_NATIVE_FILTER_CONTRACT_REQUIRED');
  return { schema: PROCESSING_CONTRACT, sourceSha256: sha256(body), sourceBytes: body.length,
    sourceUrl: metadata.url ?? null, sourceStatus: metadata.status ?? null, sourceCapturedAt: metadata.capturedAt ?? null,
    openapi: doc.openapi, info: { title: doc.info?.title ?? null, version: doc.info?.version ?? null },
    baseUrl: deployment.baseUrl, routes, workflowFilter };
}

export function routeRequest(contract, name, query = {}) {
  const route = contract.routes[name]; need(route, 'PROCESSING_DOCUMENTED_ROUTE_MISSING');
  const base = new URL(contract.baseUrl), basePath = base.pathname.replace(/\/+$/, '');
  const path = basePath && (route.path === basePath || route.path.startsWith(basePath + '/'))
    ? route.path : basePath + (route.path.startsWith('/') ? route.path : '/' + route.path);
  const url = new URL(path, base.origin);
  const names = new Set(route.query.map(p => p.name));
  for (const [key, value] of Object.entries(query)) {
    need(names.has(key), 'PROCESSING_QUERY_PARAMETER_NOT_DOCUMENTED');
    for (const item of Array.isArray(value) ? value : [value]) {
      need(['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item)), 'PROCESSING_QUERY_VALUE_INVALID');
      url.searchParams.append(key, String(item));
    }
  }
  for (const p of route.query) need(!p.required || url.searchParams.has(p.name), 'PROCESSING_REQUIRED_QUERY_MISSING');
  return { method: 'GET', url: processingUrl(url.href, contract.baseUrl), headers: { accept: 'application/json' } };
}

export function nextProcessingRequest(document, current, contract, { immutableQuery = {}, rowsKey = null } = {}) {
  const links = (document.links ?? []).filter(v => v && v.rel === 'next');
  need(links.length <= 1, 'PROCESSING_MULTIPLE_NEXT_LINKS');
  if (!links.length) return null;
  const link = links[0]; need(typeof link.href === 'string' && (!link.method || link.method.toUpperCase() === 'GET'), 'PROCESSING_NEXT_LINK_INVALID');
  const url = new URL(processingUrl(new URL(link.href, current.url).href, contract.baseUrl));
  need(url.pathname === new URL(current.url).pathname, 'PROCESSING_PAGINATION_ROUTE_CHANGED');
  for (const [name, value] of Object.entries(immutableQuery))
    need(canonicalJson(url.searchParams.getAll(name)) === canonicalJson((Array.isArray(value) ? value : [value]).map(String)),
      'PROCESSING_PAGINATION_SELECTION_CHANGED');
  if (rowsKey !== null) need(Array.isArray(document[rowsKey]), 'PROCESSING_PAGE_RECORDS_INVALID');
  return { method: 'GET', url: url.href, headers: { accept: 'application/json' } };
}

function retainedHeaders(headers) {
  const safe = {}, redacted = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (/^(set-cookie|authorization|proxy-authorization|authentication-info)$/i.test(name)) redacted.push(name);
    else safe[name.toLowerCase()] = String(value);
  }
  return { headers: safe, redactedHeaders: redacted };
}
function selectedRequest(request, deployment) {
  need(request?.method === 'GET', 'PROCESSING_READ_ONLY_REQUEST_REQUIRED');
  return { method: 'GET', url: processingUrl(request.url, deployment.baseUrl), headers: { accept: 'application/json' } };
}
function retryAt(value, now = Date.now()) {
  if (value === undefined || value === null) return null;
  const number = Number(value), time = /^\d+(?:\.\d+)?$/.test(String(value)) ? now + number * 1000 : Date.parse(value);
  return Number.isFinite(time) ? new Date(Math.max(now, time)).toISOString() : null;
}

export async function readProcessingCapture(directory, expectedRequestHash) {
  const request = await readJson(join(directory, 'request.json'));
  need(request.requestHash === digest(request.request) && (!expectedRequestHash || request.requestHash === expectedRequestHash), 'PROCESSING_REQUEST_HASH_MISMATCH');
  if (!await exists(join(directory, 'response.bin'))) return null;
  const raw = await readBytes(join(directory, 'response.bin'), MAX_BODY);
  let record;
  if (await exists(join(directory, 'response.json'))) record = await readJson(join(directory, 'response.json'));
  else {
    const head = await readJson(join(directory, 'response-head.json'));
    need(head.requestHash === request.requestHash, 'PROCESSING_RESPONSE_REQUEST_MISMATCH');
    record = { ...head, bytes: raw.length, sha256: sha256(raw), retainedAt: stamp(), recoveredReceipt: true };
    try { await writeJson(join(directory, 'response.json'), record, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = await readJson(join(directory, 'response.json')); }
  }
  need(record.requestHash === request.requestHash && raw.length === record.bytes && sha256(raw) === record.sha256, 'PROCESSING_RESPONSE_HASH_MISMATCH');
  let document = null, parseError = null;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { parseError = 'PROCESSING_RESPONSE_JSON_INVALID'; }
  return { request: request.request, requestHash: request.requestHash, record, raw, document, parseError };
}

export function createProcessingProvider({ deployment: input, transport, environment = process.env, credentialsAuthorized = true } = {}) {
  const deployment = normalizeDeployment(input);
  const profiles = (transport ? Array.isArray(transport) ? transport : [transport] : []).map(normalizeBuyerTransport);
  const origin = new URL(deployment.baseUrl).origin, profile = profiles.find(p => p.origin === origin);
  need(!profiles.length || profile, 'PROCESSING_TRANSPORT_ORIGIN_NOT_CONFIGURED');
  const sourceAuth = deployment.credential?.header.toLowerCase() === 'authorization'
    ? createSourceBearerAuth({ bindings: [{ origin, tokenEnv: deployment.credential.envRef }], environment, timeoutMs: deployment.timeoutMs }) : null;
  const fetch = createPublicHttpsFetch({ timeoutMs: deployment.timeoutMs, ...(profile ? { trustedProxy: profile } : {}),
    ...(sourceAuth ? { sourceAuthorization: sourceAuth.authorizationForOrigin(origin) } : {}) });
  async function capture(request, { directory, signal } = {}) {
    request = selectedRequest(request, deployment);
    await privateDirectory(directory);
    const requestHash = digest(request), requestPath = join(directory, 'request.json');
    if (await exists(requestPath)) {
      const retained = await readProcessingCapture(directory, requestHash);
      if (retained) return retained;
      need(false, 'PROCESSING_ATTEMPT_INCOMPLETE_USE_NEW_ATTEMPT');
    }
    await writeJson(requestPath, { request, requestHash, startedAt: stamp() }, { exclusive: true });
    const headers = { ...request.headers };
    let response;
    try {
      if (deployment.credential) {
        need(credentialsAuthorized === true, 'PROCESSING_LOCAL_CREDENTIAL_CONFIGURATION_REQUIRED');
        if (sourceAuth) Object.assign(headers, await sourceAuth.requestHeaders({ url: request.url, method: 'GET', signal }));
        else {
          const c = deployment.credential, secret = environment[c.envRef];
          need(typeof secret === 'string' && secret.length > 0 && secret.length <= 16384 && !/[\r\n\0]/.test(secret), 'PROCESSING_CREDENTIAL_ENV_UNAVAILABLE');
          headers[c.header] = c.prefix + secret;
        }
      }
      response = await fetch(request.url, { method: 'GET', headers, redirect: 'manual', signal });
      const head = { requestHash, status: response.status, ...retainedHeaders(Object.fromEntries(response.headers)),
        capturedAt: stamp(), imported: false };
      head.retryAt = retryAt(head.headers['retry-after']);
      await writeJson(join(directory, 'response-head.json'), head, { exclusive: true });
      const chunks = []; let size = 0;
      for await (const part of response.body ?? []) {
        size += part.length; need(size <= deployment.maxResponseBytes, 'PROCESSING_RESPONSE_SIZE_LIMIT'); chunks.push(Buffer.from(part));
      }
      const raw = Buffer.concat(chunks, size);
      await writeBytes(join(directory, 'response.bin'), raw, { exclusive: true });
      await writeJson(join(directory, 'response.json'), { ...head, bytes: size, sha256: sha256(raw), retainedAt: stamp() }, { exclusive: true });
      return await readProcessingCapture(directory, requestHash);
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      await writeJson(join(directory, 'error.json'), { code: /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'PROCESSING_TRANSPORT_FAILED',
        status: response?.status ?? null, at: stamp() });
      throw error;
    }
  }
  async function importResponse(request, { directory, body, metadata } = {}) {
    request = selectedRequest(request, deployment);
    need(Buffer.isBuffer(body) && body.length <= deployment.maxResponseBytes && object(metadata), 'PROCESSING_CAPTURE_BYTES_AND_METADATA_REQUIRED');
    need(metadata.status === null || Number.isSafeInteger(metadata.status) && metadata.status >= 100 && metadata.status <= 599, 'PROCESSING_ACTUAL_HTTP_STATUS_REQUIRED');
    if (metadata.url !== undefined) need(processingUrl(metadata.url, deployment.baseUrl) === request.url, 'PROCESSING_IMPORTED_URL_MISMATCH');
    if (metadata.method !== undefined) need(metadata.method === 'GET', 'PROCESSING_IMPORTED_METHOD_MISMATCH');
    if (metadata.sha256 !== undefined) need(sha256(body) === metadata.sha256, 'PROCESSING_IMPORTED_HASH_MISMATCH');
    await privateDirectory(directory);
    const requestHash = digest(request), record = { requestHash, status: metadata.status, ...retainedHeaders(metadata.headers),
      capturedAt: metadata.capturedAt ?? null, importedAt: stamp(), imported: true, retryAt: retryAt(retainedHeaders(metadata.headers).headers['retry-after']),
      bytes: body.length, sha256: sha256(body) };
    if (await exists(join(directory, 'response.json'))) {
      const prior = await readProcessingCapture(directory, requestHash);
      need(prior.record.sha256 === record.sha256 && prior.record.status === record.status, 'PROCESSING_IMPORT_IDENTITY_CONFLICT'); return prior;
    }
    if (await exists(join(directory, 'request.json'))) {
      const priorRequest = await readJson(join(directory, 'request.json'));
      need(priorRequest.requestHash === requestHash && digest(priorRequest.request) === requestHash, 'PROCESSING_IMPORT_IDENTITY_CONFLICT');
    } else await writeJson(join(directory, 'request.json'), { request, requestHash, startedAt: null }, { exclusive: true });
    if (!await exists(join(directory, 'response-head.json'))) await writeJson(join(directory, 'response-head.json'), record, { exclusive: true });
    if (await exists(join(directory, 'response.bin'))) need(sha256(await readBytes(join(directory, 'response.bin'), MAX_BODY)) === record.sha256, 'PROCESSING_IMPORT_IDENTITY_CONFLICT');
    else await writeBytes(join(directory, 'response.bin'), body, { exclusive: true });
    await writeJson(join(directory, 'response.json'), record, { exclusive: true });
    return await readProcessingCapture(directory, requestHash);
  }
  return Object.freeze({ deployment, capture, importResponse, close: () => sourceAuth?.close() });
}
