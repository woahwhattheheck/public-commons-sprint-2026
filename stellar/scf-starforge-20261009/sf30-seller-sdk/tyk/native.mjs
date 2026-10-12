import { createHash, randomUUID } from 'node:crypto';

export const TYK_NATIVE_SCHEMA = 'stellar-forge.tyk-native-request.v1';
export const TYK_CONNECTION_SCHEMA = 'stellar-forge.tyk-connection.v1';
export const TYK_CAPTURE_SCHEMA = 'stellar-forge.tyk-api-capture.v1';
const SHA = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const sha = value => createHash('sha256').update(value).digest('hex');
function fail(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function object(value, label) { if (!plain(value)) throw fail('TYK_INPUT_INVALID', label + ' must be an object.'); return value; }
function keys(value, allowed, label) { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) throw fail('TYK_INPUT_INVALID', label + ' contains unsupported field ' + key + '.'); }
function text(value, label, maximum = 8192) { if (typeof value !== 'string' || !value.length || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw fail('TYK_INPUT_INVALID', label + ' must be nonempty text within its declared bound.'); return value; }
function id(value, label = 'API ID') { text(value, label, 1024); if (value === '.' || value === '..' || /[/\\\r\n]/u.test(value)) throw fail('TYK_INPUT_INVALID', label + ' must be one native path component.'); return value; }
function bool(value, label) { if (typeof value !== 'boolean') throw fail('TYK_INPUT_INVALID', label + ' must be a boolean.'); return value; }
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw fail('TYK_INPUT_INVALID', 'Value is not JSON serializable.');
}
function json(value, label) { try { return JSON.parse(value); } catch { throw fail('TYK_DEFINITION_INVALID', label + ' must contain valid JSON.'); } }
function nativeId(value) { try { return typeof value === 'string' ? id(value) : null; } catch { return null; } }
function digestObject(value) { return sha(canonical(value)); }
function normalizedIds(values) { if (!Array.isArray(values) || !values.length) throw fail('TYK_INPUT_INVALID', 'apiIds must contain selected native IDs.'); const output = values.map(value => id(value)); if (new Set(output).size !== output.length) throw fail('TYK_INPUT_INVALID', 'apiIds must not contain duplicates.'); return output; }
function unique(values) { return [...new Set(values.filter(value => value !== null && value !== undefined))]; }

export function normalizeTykConnection(input) {
  keys(input, ['id', 'label', 'kind', 'baseUrl', 'authEnv', 'schema'], 'connection');
  if (input.schema !== undefined && input.schema !== TYK_CONNECTION_SCHEMA) throw fail('TYK_INPUT_INVALID', 'Unsupported connection schema.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.id || '')) throw fail('TYK_INPUT_INVALID', 'Connection ID must be a named host handle.');
  if (!['gateway', 'dashboard'].includes(input.kind)) throw fail('TYK_INPUT_INVALID', 'Connection kind must be gateway or dashboard.');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(input.authEnv || '')) throw fail('TYK_INPUT_INVALID', 'authEnv must name the existing credential environment variable.');
  let url;
  try { url = new URL(text(input.baseUrl, 'baseUrl')); } catch { throw fail('TYK_INPUT_INVALID', 'baseUrl must be an absolute HTTP URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('TYK_INPUT_INVALID', 'baseUrl must be an HTTP origin/base path without credentials, query or fragment.');
  url.pathname = url.pathname.replace(/\/+$/u, '') + '/';
  return Object.freeze({ schema: TYK_CONNECTION_SCHEMA, id: input.id, label: input.label === undefined ? input.id : text(input.label, 'label', 512), kind: input.kind, baseUrl: url.href, authEnv: input.authEnv });
}
export function tykConnectionSha256(connection) { return digestObject(normalizeTykConnection(connection)); }

// Select the original JSON value bytes, including every number and string escape.
// The entire response is separately retained as an HTTP exchange.
function jsonMemberText(source, wanted) {
  json(source, 'Original definition');
  let position = 0;
  const space = () => { while (/\s/u.test(source[position] || '') && position < source.length) position++; };
  const stringEnd = () => {
    const start = position++;
    while (position < source.length) { const ch = source[position++]; if (ch === '\\') position++; else if (ch === '"') return source.slice(start, position); }
    throw fail('TYK_DEFINITION_INVALID', 'Unterminated JSON string.');
  };
  const valueEnd = () => {
    space(); const first = source[position];
    if (first === '"') { stringEnd(); return; }
    if (first === '{' || first === '[') {
      const stack = [first === '{' ? '}' : ']']; position++;
      while (stack.length && position < source.length) {
        const ch = source[position];
        if (ch === '"') stringEnd();
        else { position++; if (ch === '{') stack.push('}'); else if (ch === '[') stack.push(']'); else if (ch === stack.at(-1)) stack.pop(); }
      }
      return;
    }
    while (position < source.length && !/[,\]}\s]/u.test(source[position])) position++;
  };
  space(); if (source[position++] !== '{') return null;
  let result = null;
  for (;;) {
    space(); if (source[position] === '}') break;
    const name = JSON.parse(stringEnd()); space(); position++; space();
    const start = position; valueEnd();
    if (name === wanted) { if (result !== null) throw fail('TYK_DEFINITION_INVALID', 'Repeated identity-bearing member ' + wanted + '.'); result = source.slice(start, position); }
    space(); if (source[position] === ',') { position++; continue; } break;
  }
  return result;
}
function definitionParts(source) {
  const document = object(json(source, 'definitionText'), 'definition');
  const wrapper = own(document, 'api_definition');
  const definition = wrapper ? object(document.api_definition, 'api_definition') : document;
  const oas = own(definition, 'openapi');
  const extension = oas && plain(definition['x-tyk-api-gateway']) ? definition['x-tyk-api-gateway'] : null;
  return { document, definition, wrapper, oas, extension };
}
export function inspectTykDefinition(definitionText, options = {}) {
  if (typeof definitionText !== 'string' || !definitionText.trim()) throw fail('TYK_DEFINITION_INVALID', 'definitionText must retain a complete original document.');
  const { document, definition, wrapper, oas, extension } = definitionParts(definitionText);
  const kind = oas ? 'oas' : 'classic';
  if (options.kind !== undefined && options.kind !== kind) throw fail('TYK_DEFINITION_INVALID', 'Definition does not match selected native kind.');
  if (!oas && !wrapper && !own(definition, 'api_id') && !own(definition, 'proxy') && !own(definition, 'name')) throw fail('TYK_DEFINITION_INVALID', 'JSON does not identify a native Classic or OpenAPI definition.');
  const embeddedId = nativeId(oas ? extension?.info?.id : definition.api_id);
  if (options.apiId && embeddedId && embeddedId !== options.apiId) throw fail('TYK_API_ID_MISMATCH', 'Selected API ID differs from the original definition.');
  const protocol = oas ? (extension?.info?.type || (definition['x-tyk-api-mcp'] ? 'mcp' : 'http')) : (definition.protocol || 'http');
  return {
    kind, apiId: embeddedId, sha256: sha(Buffer.from(definitionText, 'utf8')), bytes: Buffer.byteLength(definitionText),
    summary: {
      apiId: embeddedId, name: oas ? (extension?.info?.name ?? definition.info?.title ?? null) : (definition.name ?? null),
      kind, format: oas ? String(definition.openapi) : 'tyk-classic', protocol,
      envelope: wrapper ? 'dashboard-wrapper' : 'definition', databaseId: wrapper ? (definition.id ?? document.api_model?.id ?? null) : null,
      listenPath: oas ? (extension?.server?.listenPath?.value ?? null) : (definition.proxy?.listen_path ?? null),
      upstreamUrl: oas ? (extension?.upstream?.url ?? null) : (definition.proxy?.target_url ?? null),
      active: oas ? (extension?.info?.state?.active ?? null) : (definition.active ?? null),
      isOas: oas || definition.is_oas === true,
      nativeMigration: oas ? (extension?.info?.migration ?? null) : null
    }
  };
}
export function prepareTykDefinition(capture, targetInput) {
  const target = normalizeTykConnection(targetInput);
  object(capture, 'capture');
  if (capture.found === false || typeof capture.definitionText !== 'string') throw fail('TYK_SOURCE_REQUIRED', 'Hydrate the complete captured native definition before adaptation.');
  const source = inspectTykDefinition(capture.definitionText, { kind: capture.kind, apiId: capture.apiId });
  if (capture.sha256 !== source.sha256) throw fail('TYK_SOURCE_MISMATCH', 'Captured definition bytes changed.');
  const parts = definitionParts(capture.definitionText);
  let definitionText = capture.definitionText, transformation = 'UNCHANGED';
  if (source.kind === 'classic' && target.kind === 'gateway' && parts.wrapper) { definitionText = jsonMemberText(definitionText, 'api_definition'); transformation = 'UNWRAP_DASHBOARD_CLASSIC'; }
  if (source.kind === 'classic' && target.kind === 'dashboard' && !parts.wrapper) { definitionText = '{"api_definition":' + definitionText + '}'; transformation = 'WRAP_DASHBOARD_CLASSIC'; }
  return { schema: 'stellar-forge.tyk-definition-adaptation.v1', connectionId: target.id, connectionSha256: tykConnectionSha256(target), sourceSha256: source.sha256, kind: source.kind, apiId: source.apiId, transformation, definitionText, sha256: sha(Buffer.from(definitionText)), bytes: Buffer.byteLength(definitionText) };
}
const VERSION_QUERY = ['base_api_id', 'base_api_version_name', 'new_version_name', 'set_default'];
const IMPORT_QUERY = ['upstreamURL', 'listenPath', 'customDomain', 'allowList', 'validateRequest', 'mockResponse', 'authentication'];
const BOOLEAN_QUERY = new Set(['set_default', 'allowList', 'validateRequest', 'mockResponse', 'authentication', 'block']);
function selectedQuery(input, allowed) {
  if (input === undefined) return {};
  keys(input, allowed, 'query');
  const out = {};
  for (const key of Object.keys(input).sort()) out[key] = BOOLEAN_QUERY.has(key) ? bool(input[key], key) : text(input[key], key, 32768);
  return out;
}
function normalizeSelection(connection, input) {
  object(input, 'selection'); const operation = input.operation;
  if (operation === 'migrate') {
    keys(input, ['operation', 'mode', 'apiIds', 'abortOnFailure', 'overrideStaged'], 'migration selection');
    if (connection.kind !== 'dashboard') throw fail('TYK_OPERATION_UNSUPPORTED', 'Classic to OAS migration uses the original licensed Dashboard API.');
    if (!['dryRun', 'stage', 'promote', 'direct'].includes(input.mode)) throw fail('TYK_INPUT_INVALID', 'Select dryRun, stage, promote or direct explicitly.');
    const selected = { operation, mode: input.mode, apiIds: normalizedIds(input.apiIds), abortOnFailure: bool(input.abortOnFailure, 'abortOnFailure'), overrideStaged: bool(input.overrideStaged, 'overrideStaged') };
    if (selected.overrideStaged && selected.mode !== 'stage') throw fail('TYK_INPUT_INVALID', 'overrideStaged only applies to stage mode.');
    return selected;
  }
  if (operation === 'hotReload') {
    keys(input, ['operation', 'scope', 'block'], 'reload selection');
    if (connection.kind !== 'gateway') throw fail('TYK_OPERATION_UNSUPPORTED', 'Hot reload is a separately declared Gateway administration operation.');
    if (!['node', 'group'].includes(input.scope)) throw fail('TYK_INPUT_INVALID', 'Select node or group reload explicitly.');
    if (input.scope === 'group' && input.block !== undefined) throw fail('TYK_INPUT_INVALID', 'The original group reload endpoint has no block parameter.');
    return { operation, scope: input.scope, ...(input.block === undefined ? {} : { block: bool(input.block, 'block') }) };
  }
  if (!['create', 'import', 'update'].includes(operation)) throw fail('TYK_OPERATION_UNSUPPORTED', 'Select an original create, import, update, migrate or hotReload operation.');
  keys(input, ['operation', 'kind', 'definitionText', 'contentType', 'apiId', 'query'], 'definition selection');
  if (!['classic', 'oas'].includes(input.kind) || (operation === 'import' && input.kind !== 'oas')) throw fail('TYK_INPUT_INVALID', 'Import consumes plain OpenAPI; create/update require a selected Classic or OAS kind.');
  if (typeof input.definitionText !== 'string' || !input.definitionText.trim()) throw fail('TYK_INPUT_INVALID', 'definitionText must retain the complete submitted native bytes.');
  const contentType = input.contentType ?? 'application/json';
  if (!['application/json', 'application/x-yaml'].includes(contentType) || (contentType !== 'application/json' && (connection.kind !== 'dashboard' || input.kind !== 'oas'))) throw fail('TYK_OPERATION_UNSUPPORTED', 'The selected native endpoint accepts JSON only; Dashboard OAS additionally accepts application/x-yaml.');
  const apiId = input.apiId === undefined || input.apiId === null ? null : id(input.apiId);
  if (operation === 'update' && apiId === null) throw fail('TYK_INPUT_INVALID', 'Update requires the exact existing API ID.');
  let embeddedId = null;
  if (contentType === 'application/json') {
    const parts = definitionParts(input.definitionText);
    const inspection = inspectTykDefinition(input.definitionText, { kind: input.kind, ...(apiId ? { apiId } : {}) });
    embeddedId = inspection.apiId;
    if (input.kind === 'classic' && parts.wrapper !== (connection.kind === 'dashboard')) throw fail('TYK_DEFINITION_ENVELOPE', 'Select the native Classic envelope for this target; use prepareTykDefinition to review an explicit envelope adaptation.');
    if (operation === 'import' && parts.extension) throw fail('TYK_DEFINITION_INVALID', 'Native OAS import requires an OpenAPI document without x-tyk-api-gateway; create accepts the complete Tyk OAS definition.');
    if (operation !== 'import' && input.kind === 'oas' && !parts.extension) throw fail('TYK_DEFINITION_INVALID', 'Create/update requires the complete x-tyk-api-gateway definition; plain OpenAPI uses import.');
    if (operation === 'update' && embeddedId !== apiId) throw fail('TYK_API_ID_MISMATCH', 'Update payload must retain the same original native API ID as its route.');
  }
  const allowed = operation === 'update' ? [] : [...VERSION_QUERY, ...(operation === 'import' ? IMPORT_QUERY : []), ...(connection.kind === 'dashboard' && input.kind === 'oas' ? ['templateID'] : [])];
  return { operation, kind: input.kind, definitionText: input.definitionText, contentType, apiId, embeddedId, query: selectedQuery(input.query, allowed) };
}
export function planTykRequest(connectionInput, input) {
  const connection = normalizeTykConnection(connectionInput), selected = normalizeSelection(connection, input);
  let method, path, bodyText = null, contentType = null, query = {}, apiIds = [], mutation = true;
  const prefix = connection.kind === 'gateway' ? '/tyk/apis' : '/api/apis';
  if (selected.operation === 'migrate') {
    method = 'POST'; path = '/api/apis/migrate';
    bodyText = JSON.stringify({ mode: selected.mode, apiIDs: selected.apiIds, abortOnFailure: selected.abortOnFailure, overrideStaged: selected.overrideStaged });
    contentType = 'application/json'; apiIds = selected.apiIds; mutation = selected.mode !== 'dryRun';
  } else if (selected.operation === 'hotReload') {
    method = 'GET'; path = selected.scope === 'node' ? '/tyk/reload' : '/tyk/reload/group'; query = selected.block === undefined ? {} : { block: selected.block };
  } else {
    method = selected.operation === 'update' ? 'PUT' : 'POST';
    path = prefix + (selected.kind === 'oas' ? '/oas' : '') + (selected.operation === 'import' ? '/import' : selected.operation === 'update' ? '/' + encodeURIComponent(selected.apiId) : '');
    bodyText = selected.definitionText; contentType = selected.contentType; query = selected.query; apiIds = unique([selected.apiId, selected.embeddedId]);
  }
  const plan = { schema: TYK_NATIVE_SCHEMA, connectionId: connection.id, connectionSha256: tykConnectionSha256(connection), connectionKind: connection.kind, operation: selected.operation, kind: selected.kind ?? null, mode: selected.mode ?? null, expectedApiId: selected.apiId ?? null, method, path, query, bodyText, contentType, mutation, apiIds, relatedApiIds: typeof query.base_api_id === 'string' ? [id(query.base_api_id)] : [] };
  return Object.freeze({ ...plan, sha256: digestObject(plan) });
}
function validatePlan(connection, plan) {
  object(plan, 'plan'); if (plan.schema !== TYK_NATIVE_SCHEMA || !SHA.test(plan.sha256 || '')) throw fail('TYK_PLAN_INVALID', 'Unsupported native request plan.');
  const { sha256, ...core } = plan;
  if (digestObject(core) !== sha256 || plan.connectionSha256 !== tykConnectionSha256(connection) || plan.connectionId !== connection.id) throw fail('TYK_PLAN_MISMATCH', 'The complete reviewed request or named connection changed.');
  let selected;
  if (plan.operation === 'migrate') {
    const body = object(json(plan.bodyText, 'Migration body'), 'migration');
    keys(body, ['mode', 'apiIDs', 'abortOnFailure', 'overrideStaged'], 'migration');
    selected = { operation: 'migrate', mode: body.mode, apiIds: body.apiIDs, abortOnFailure: body.abortOnFailure, overrideStaged: body.overrideStaged };
  } else if (plan.operation === 'hotReload') selected = { operation: 'hotReload', scope: plan.path === '/tyk/reload' ? 'node' : 'group', ...(own(plan.query, 'block') ? { block: plan.query.block } : {}) };
  else selected = { operation: plan.operation, kind: plan.kind, definitionText: plan.bodyText, contentType: plan.contentType, ...(plan.expectedApiId === null ? {} : { apiId: plan.expectedApiId }), query: plan.query };
  if (canonical(planTykRequest(connection, selected)) !== canonical(plan)) throw fail('TYK_PLAN_MISMATCH', 'Plan does not match a complete original named API operation.');
  return plan;
}
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-encoding', 'date', 'etag', 'last-modified', 'retry-after', 'location', 'x-request-id', 'x-correlation-id', 'x-tyk-base-api-id'];
function safeSinkReference(value, label) { object(value, label); canonical(value); if (!Object.keys(value).length) throw fail('TYK_CAPTURE_SINK_INVALID', label + ' must identify the persisted full record.'); return value; }
function captureOptions(options) {
  const retainBodies = options.retainBodies !== false;
  if (!retainBodies && (typeof options.onExchange !== 'function' || typeof options.onDefinition !== 'function')) throw fail('TYK_CAPTURE_SINK_REQUIRED', 'Metadata captures require both full-record persistence callbacks.');
  return { ...options, retainBodies };
}
export function createTykTransport(connectionInput, options = {}) {
  const connection = normalizeTykConnection(connectionInput), connectionSha256 = tykConnectionSha256(connection);
  const environment = options.environment ?? process.env;
  const credential = environment[connection.authEnv];
  if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/u.test(credential)) throw fail('TYK_AUTH_UNAVAILABLE', 'The named target credential environment reference is unavailable.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw fail('TYK_TRANSPORT_UNAVAILABLE', 'The original HTTP fetch transport is unavailable.');
  const timeoutMs = options.timeoutMs ?? 120000, maximumResponseBytes = options.maximumResponseBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000 || !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1024 * 1024 * 1024) throw fail('TYK_INPUT_INVALID', 'Configure a positive timeout up to one hour and response byte bound up to 1 GiB.');
  async function request(spec, operationSignal) {
    const signals = [options.signal, operationSignal].filter(Boolean);
    if (signals.some(signal => signal.aborted)) throw fail('TYK_ABORTED', 'Operation was cancelled before dispatch.', { outcomeUnknown: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(fail('TYK_TIMEOUT', 'Native Tyk request timed out.')), timeoutMs); timer.unref?.();
    const signal = AbortSignal.any([...signals, controller.signal]);
    const endpoint = new URL(connection.baseUrl); endpoint.pathname += spec.path.replace(/^\/+/u, '');
    for (const [key, value] of Object.entries(spec.query ?? {})) endpoint.searchParams.set(key, String(value));
    const requestRecord = { method: spec.method, path: spec.path, query: spec.query ?? {}, bodySha256: spec.bodyText === null || spec.bodyText === undefined ? null : sha(Buffer.from(spec.bodyText)), ...(spec.sha256 ? { planSha256: spec.sha256 } : {}) };
    const startedAt = new Date().toISOString(), exchangeId = randomUUID(); let response = null, dispatched = false, chunks = [], received = 0;
    try {
      const headers = { Accept: 'application/json', [connection.kind === 'gateway' ? 'x-tyk-authorization' : 'Authorization']: credential };
      if (spec.contentType) headers['Content-Type'] = spec.contentType;
      dispatched = true;
      response = await fetcher(endpoint, { method: spec.method, headers, body: spec.bodyText ?? undefined, redirect: 'manual', signal });
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; const chunk = Buffer.from(part.value); received += chunk.length; if (received > maximumResponseBytes) { await reader.cancel(); throw fail('TYK_RESPONSE_TOO_LARGE', 'Original response exceeds the explicitly configured byte limit.'); } chunks.push(chunk); }
        } finally { reader.releaseLock(); }
      }
      const bytes = Buffer.concat(chunks, received); chunks = [];
      let bodyText = null, parsed = null;
      try { bodyText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch {}
      if (bodyText !== null) { try { parsed = JSON.parse(bodyText); } catch {} }
      const retainedHeaders = {}; for (const name of RESPONSE_HEADERS) { const value = response.headers.get(name); if (value !== null) retainedHeaders[name] = value; }
      return { schema: 'stellar-forge.tyk-http-exchange.v1', id: exchangeId, connectionId: connection.id, connectionSha256, request: requestRecord, startedAt, completedAt: new Date().toISOString(), status: response.status, statusText: response.statusText, ok: response.ok, headers: retainedHeaders, bodyBytes: bytes.length, bodySha256: sha(bytes), bodyBase64: bytes.toString('base64'), bodyText, json: parsed };
    } catch (error) {
      const partialBytes = Buffer.concat(chunks);
      const retainedHeaders = {}; if (response) for (const name of RESPONSE_HEADERS) { const value = response.headers.get(name); if (value !== null) retainedHeaders[name] = value; }
      const partialExchange = { schema: 'stellar-forge.tyk-http-exchange.v1', id: exchangeId, connectionId: connection.id, connectionSha256, request: requestRecord, startedAt, completedAt: new Date().toISOString(), status: response?.status ?? null, statusText: response?.statusText ?? null, ok: false, complete: false, headers: retainedHeaders, bodyBytes: partialBytes.length, bodySha256: sha(partialBytes), bodyBase64: partialBytes.toString('base64'), bodyText: null, json: null };
      const code = typeof error?.code === 'string' ? error.code : signal.aborted ? (controller.signal.aborted ? 'TYK_TIMEOUT' : 'TYK_ABORTED') : 'TYK_TRANSPORT_FAILED';
      throw fail(code, error?.message || 'Native Tyk request failed.', { outcomeUnknown: Boolean(dispatched && spec.mutation), dispatched, request: requestRecord, exchange: partialExchange, cause: error });
    } finally { clearTimeout(timer); }
  }
  async function retainedExchange(full, capture) {
    const bodyRef = typeof capture.onExchange === 'function' ? await capture.onExchange(full) : undefined;
    if (capture.retainBodies) return full;
    safeSinkReference(bodyRef, 'bodyRef');
    const { bodyBase64, bodyText, json: originalJson, ...metadata } = full; return { ...metadata, bodyRef };
  }
  async function retainedDefinition(full, capture) {
    const definitionRef = typeof capture.onDefinition === 'function' ? await capture.onDefinition(full) : undefined;
    if (capture.retainBodies) return full;
    safeSinkReference(definitionRef, 'definitionRef');
    const { definitionText, ...metadata } = full; return { ...metadata, definitionRef };
  }
  async function read(path, query, capture) {
    const full = await request({ method: 'GET', path, query, bodyText: null, contentType: null, mutation: false }, capture.signal);
    const retained = await retainedExchange(full, capture);
    if (!full.ok && !(capture.allowMissing && full.status === 404)) throw fail('TYK_HTTP_ERROR', 'Original Tyk read returned HTTP ' + full.status + '.', { status: full.status, outcomeUnknown: false, exchange: retained });
    return { full, retained };
  }
  async function captureApi(apiId, input = {}) {
    id(apiId); const capture = captureOptions(input), exchanges = [], prefix = connection.kind === 'gateway' ? '/tyk/apis' : '/api/apis';
    const classic = await read(prefix + '/' + encodeURIComponent(apiId), {}, capture); exchanges.push(classic.retained);
    if (classic.full.status === 404) return retainedDefinition({ schema: TYK_CAPTURE_SCHEMA, connectionId: connection.id, connectionSha256, apiId, found: false, kind: null, definitionText: null, sha256: null, bytes: 0, summary: { apiId }, exchanges }, capture);
    if (classic.full.bodyText === null) throw fail('TYK_CAPTURE_INVALID', 'Original API definition was not UTF-8 JSON.', { exchanges });
    const base = inspectTykDefinition(classic.full.bodyText, { apiId });
    let definitionText = classic.full.bodyText, inspection = base;
    if (base.summary.isOas) {
      const oas = await read(prefix + '/oas/' + encodeURIComponent(apiId), {}, { ...capture, allowMissing: false }); exchanges.push(oas.retained);
      if (oas.full.bodyText === null) throw fail('TYK_CAPTURE_INVALID', 'Original OAS definition was not UTF-8 JSON.', { exchanges });
      definitionText = oas.full.bodyText; inspection = inspectTykDefinition(definitionText, { kind: 'oas', apiId });
    }
    if (!inspection.apiId) throw fail('TYK_CAPTURE_INVALID', 'Native API read omitted its original API ID.', { exchanges });
    return retainedDefinition({ schema: TYK_CAPTURE_SCHEMA, connectionId: connection.id, connectionSha256, apiId: inspection.apiId, found: true, kind: inspection.kind, definitionText, sha256: inspection.sha256, bytes: inspection.bytes, summary: inspection.summary, exchanges }, capture);
  }
  async function captureInventory(input = {}) {
    const capture = captureOptions(input), startedAt = new Date().toISOString(), exchanges = [], pages = [], listed = [], seen = new Set(), duplicateApiIds = [];
    let page = 1, totalPages = 1;
    do {
      const path = connection.kind === 'gateway' ? '/tyk/apis' : '/api/apis';
      const query = connection.kind === 'gateway' ? { include_types: 'mcp' } : { p: page, sort: 'name' };
      const result = await read(path, query, capture); exchanges.push(result.retained);
      const body = result.full.json; let entries, reportedPages;
      if (connection.kind === 'gateway') { entries = body; reportedPages = 1; }
      else {
        object(body, 'Original Dashboard inventory'); entries = body.apis ?? [];
        reportedPages = body.pages;
        if (!Number.isSafeInteger(reportedPages) || reportedPages < 0) throw fail('TYK_CAPTURE_INVALID', 'Dashboard inventory omitted a valid total page count.', { exchanges });
        totalPages = Math.max(totalPages, reportedPages);
      }
      if (!Array.isArray(entries)) throw fail('TYK_CAPTURE_INVALID', 'Original inventory API returned an unsupported list shape.', { exchanges });
      const pageIds = [];
      for (const entry of entries) {
        const definition = plain(entry?.api_definition) ? entry.api_definition : entry;
        const apiId = nativeId(definition?.api_id) ?? nativeId(definition?.['x-tyk-api-gateway']?.info?.id);
        if (!apiId) throw fail('TYK_CAPTURE_INVALID', 'Original inventory item omitted its native API ID.', { exchanges });
        pageIds.push(apiId);
        if (seen.has(apiId)) duplicateApiIds.push(apiId); else { seen.add(apiId); listed.push(apiId); }
      }
      pages.push({ page, reportedPages, apiIds: pageIds, exchangeId: result.full.id, bodySha256: result.full.bodySha256 });
      await input.onProgress?.({ phase: 'inventory', page, reportedPages, uniqueApis: listed.length });
      page++;
    } while (connection.kind === 'dashboard' && page <= totalPages);
    const items = [];
    for (const apiId of listed) { items.push(await captureApi(apiId, { ...capture, allowMissing: true })); await input.onProgress?.({ phase: 'definitions', completed: items.length, total: listed.length, apiId }); }
    return { schema: 'stellar-forge.tyk-inventory-capture.v1', connectionId: connection.id, connectionSha256, startedAt, completedAt: new Date().toISOString(), items, pages, exchanges, consistency: { atomic: false, duplicateApiIds: unique(duplicateApiIds), disappearedApiIds: items.filter(item => !item.found).map(item => item.apiId), reportedPageCounts: unique(pages.map(entry => entry.reportedPages)), completePageWalk: page > totalPages } };
  }
  return Object.freeze({ connection, connectionSha256, execute: (plan, executeOptions = {}) => request(validatePlan(connection, plan), executeOptions.signal), captureApi, captureInventory });
}

function assertExchange(plan, exchange) {
  if (!exchange) return;
  if (exchange.connectionId !== plan.connectionId || exchange.connectionSha256 !== plan.connectionSha256 || exchange.request?.planSha256 !== plan.sha256) throw fail('TYK_RESPONSE_MISMATCH', 'Response belongs to a different reviewed native request.');
  if (typeof exchange.bodyBase64 !== 'string' || !SHA.test(exchange.bodySha256 || '')) throw fail('TYK_RESPONSE_MISMATCH', 'Hydrate the complete original HTTP exchange before reconciliation.');
  const bytes = Buffer.from(exchange.bodyBase64, 'base64');
  if (bytes.toString('base64') !== exchange.bodyBase64 || bytes.length !== exchange.bodyBytes || sha(bytes) !== exchange.bodySha256) throw fail('TYK_RESPONSE_MISMATCH', 'Original response byte identity changed.');
  if (exchange.bodyText !== null && (typeof exchange.bodyText !== 'string' || !Buffer.from(exchange.bodyText).equals(bytes))) throw fail('TYK_RESPONSE_MISMATCH', 'Original response text does not represent the retained exact bytes.');
}
function parsedExchange(exchange) {
  if (!exchange || exchange.complete === false) return null;
  if (typeof exchange.bodyText === 'string') { try { return JSON.parse(exchange.bodyText); } catch { return null; } }
  return plain(exchange.json) ? exchange.json : null;
}
export function responseTykApiIds(plan, exchange) {
  assertExchange(plan, exchange); const response = parsedExchange(exchange); if (!plain(response)) return [];
  const values = [];
  if (plan.operation === 'migrate') {
    values.push(...(Array.isArray(response.success?.apiIDs) ? response.success.apiIDs : []));
    for (const staged of Array.isArray(response.success?.stagedAPIs) ? response.success.stagedAPIs : []) values.push(staged?.classicAPIID, staged?.oasAPIID);
    for (const definition of Array.isArray(response.success?.definitions) ? response.success.definitions : []) {
      values.push(definition?.apiID, definition?.baseAPI?.['x-tyk-api-gateway']?.info?.id);
      for (const version of Array.isArray(definition?.versions) ? definition.versions : []) values.push(version?.['x-tyk-api-gateway']?.info?.id);
    }
  } else if (plan.connectionKind === 'gateway') values.push(response.key);
  else {
    // Dashboard ID is the public API identifier; Meta may be its database ID.
    values.push(response.ID, response.api_definition?.api_id, response['x-tyk-api-gateway']?.info?.id);
    if (plain(response.Meta)) values.push(response.Meta.api_definition?.api_id, response.Meta['x-tyk-api-gateway']?.info?.id);
  }
  return unique(values.map(nativeId).filter(Boolean));
}
// Compare full JSON without coercing native integer/decimal settings to Number.
// Equivalent spellings such as 1, 1.0 and 1e0 share a value; large integers stay exact.
function semanticJson(source) {
  json(source, 'Native JSON document');
  let position = 0;
  const space = () => { while (position < source.length && /\s/u.test(source[position])) position++; };
  function stringValue() {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '\\') position++;
      else if (char === '"') return JSON.parse(source.slice(start, position));
    }
    throw fail('TYK_DEFINITION_INVALID', 'Unterminated native JSON string.');
  }
  function numberValue(token) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(token);
    if (!match) throw fail('TYK_DEFINITION_INVALID', 'Invalid native JSON number.');
    let digits = (match[2] + (match[3] ?? '')).replace(/^0+/u, '');
    if (!digits) return 'n0';
    // Native JSON already has an explicit byte bound; avoid a giant exponent allocation.
    if ((match[4]?.length ?? 0) > 1024) return 'n' + token;
    let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
    const trailing = /0+$/u.exec(digits)?.[0].length ?? 0;
    if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
    return 'n' + match[1] + digits + 'e' + exponent.toString();
  }
  function value(depth) {
    if (depth > 1024) throw fail('TYK_DEFINITION_INVALID', 'Native JSON nesting exceeds comparison depth.');
    space(); const char = source[position];
    if (char === '"') return 's' + JSON.stringify(stringValue());
    if (char === '[') {
      position++; const items = []; space();
      if (source[position] === ']') { position++; return '[]'; }
      for (;;) { items.push(value(depth + 1)); space(); if (source[position++] === ']') break; }
      return '[' + items.join(',') + ']';
    }
    if (char === '{') {
      position++; const items = new Map(); space();
      if (source[position] === '}') { position++; return '{}'; }
      for (;;) {
        space(); const name = stringValue(); space(); position++;
        if (items.has(name)) throw fail('TYK_DEFINITION_INVALID', 'Repeated native JSON member prevents an unambiguous semantic comparison.');
        items.set(name, value(depth + 1)); space(); if (source[position++] === '}') break;
      }
      return '{' + [...items.keys()].sort().map(name => JSON.stringify(name) + ':' + items.get(name)).join(',') + '}';
    }
    const start = position;
    while (position < source.length && !/[,\]}\s]/u.test(source[position])) position++;
    const token = source.slice(start, position);
    if (token === 'true' || token === 'false' || token === 'null') return token;
    return numberValue(token);
  }
  const result = value(0); space();
  if (position !== source.length) throw fail('TYK_DEFINITION_INVALID', 'Native JSON contains trailing content.');
  return result;
}
export function compareTykDefinition(plan, capture) {
  const result = { matched: false, mode: null, submittedSha256: typeof plan.bodyText === 'string' ? sha(Buffer.from(plan.bodyText)) : null, observedSha256: capture?.sha256 ?? null, submittedSemanticSha256: null, observedSemanticSha256: null };
  if (!capture?.found || capture.kind !== plan.kind || typeof plan.bodyText !== 'string') return { ...result, reason: 'NO_MATCHING_NATIVE_DEFINITION' };
  if (typeof capture.definitionText !== 'string' || sha(Buffer.from(capture.definitionText)) !== capture.sha256) throw fail('TYK_SOURCE_MISMATCH', 'Hydrate the unchanged complete observed definition before comparison.');
  if (result.submittedSha256 === capture.sha256) return { ...result, matched: true, mode: 'EXACT_BYTES', reason: null };
  if (plan.contentType !== 'application/json') return { ...result, reason: 'NATIVE_TEXT_REPRESENTATION_DIFFERS' };
  try {
    const submitted = semanticJson(plan.bodyText), observed = semanticJson(capture.definitionText);
    result.submittedSemanticSha256 = sha(submitted); result.observedSemanticSha256 = sha(observed);
    return { ...result, matched: submitted === observed, mode: 'COMPLETE_JSON', reason: submitted === observed ? null : 'COMPLETE_NATIVE_JSON_DIFFERS' };
  } catch (error) { return { ...result, reason: typeof error?.code === 'string' ? error.code : 'JSON_COMPARISON_UNAVAILABLE' }; }
}

function captureRecords(value) {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : value.items;
  if (!Array.isArray(items)) throw fail('TYK_RECONCILE_INVALID', 'Readback must be capture records or {items}.');
  for (const entry of items) { object(entry, 'capture'); id(entry.apiId); if (entry.found && typeof entry.definitionText !== 'string') throw fail('TYK_SOURCE_REQUIRED', 'Reconciliation requires hydrated complete native definitions.'); if (entry.found && sha(Buffer.from(entry.definitionText)) !== entry.sha256) throw fail('TYK_SOURCE_MISMATCH', 'Readback definition bytes changed.'); }
  return items;
}
function jsonArrayTexts(source) {
  if (!Array.isArray(json(source, 'Original JSON array'))) return [];
  const values = []; let position = 1;
  const space = () => { while (position < source.length && /\s/u.test(source[position])) position++; };
  const quoted = () => { position++; while (position < source.length) { const ch = source[position++]; if (ch === '\\') position++; else if (ch === '"') break; } };
  for (;;) {
    space(); if (source[position] === ']') return values;
    const start = position, stack = [];
    while (position < source.length) {
      const ch = source[position];
      if (ch === '"') { quoted(); continue; }
      if (!stack.length && (ch === ',' || ch === ']')) break;
      position++;
      if (ch === '{') stack.push('}'); else if (ch === '[') stack.push(']'); else if (ch === stack.at(-1)) stack.pop();
    }
    values.push(source.slice(start, position).trim()); if (source[position] === ']') return values; position++;
  }
}
export function readTykMigrationDefinitions(exchange) {
  const result = new Map();
  if (typeof exchange?.bodyText !== 'string') return result;
  try {
    const success = jsonMemberText(exchange.bodyText, 'success'), definitions = success && jsonMemberText(success, 'definitions');
    if (!definitions) return result;
    for (const row of jsonArrayTexts(definitions)) {
      const values = [jsonMemberText(row, 'baseAPI')];
      const versions = jsonMemberText(row, 'versions'); if (versions) values.push(...jsonArrayTexts(versions));
      for (const definitionText of values.filter(Boolean)) {
        const inspection = inspectTykDefinition(definitionText, { kind: 'oas' });
        if (!inspection.apiId) continue;
        if (result.has(inspection.apiId) && result.get(inspection.apiId) !== definitionText) return new Map();
        result.set(inspection.apiId, definitionText);
      }
    }
  } catch { return new Map(); }
  return result;
}

function responseSuccess(plan, exchange, response) {
  if (!exchange?.ok || exchange.complete === false || !plain(response)) return false;
  if (plan.operation === 'migrate') return plain(response.success) || plain(response.failure) || plain(response.skipped);
  if (plan.connectionKind === 'gateway') return String(response.status).toLowerCase() === 'ok' && (plan.operation === 'hotReload' || response.action === (plan.operation === 'update' ? 'modified' : 'added'));
  return String(response.Status).toLowerCase() === 'ok';
}
export function reconcileTykRequest(plan, beforeInput = [], afterInput = [], exchange = null) {
  if (!plan || plan.schema !== TYK_NATIVE_SCHEMA || !SHA.test(plan.sha256 || '')) throw fail('TYK_PLAN_INVALID', 'Use the original complete reviewed native plan.');
  const { sha256: reviewedSha, ...reviewedCore } = plan;
  if (digestObject(reviewedCore) !== reviewedSha) throw fail('TYK_PLAN_MISMATCH', 'Reviewed plan changed before reconciliation.');
  assertExchange(plan, exchange);
  const before = captureRecords(beforeInput), after = captureRecords(afterInput), response = parsedExchange(exchange);
  for (const records of [before, after]) {
    if (new Set(records.map(item => item.apiId)).size !== records.length) throw fail('TYK_RECONCILE_INVALID', 'Readback contains duplicate native API identities.');
    for (const item of records) if (item.connectionId !== plan.connectionId || item.connectionSha256 !== plan.connectionSha256) throw fail('TYK_SOURCE_MISMATCH', 'Readback belongs to a different reviewed target connection.');
  }
  const returnedIds = responseTykApiIds(plan, exchange);
  const stagedIds = plan.operation === 'migrate' && ['stage', 'promote'].includes(plan.mode) ? plan.apiIds.map(apiId => 'staging-' + apiId) : [];
  const readbackApiIds = unique([...plan.apiIds, ...(plan.relatedApiIds ?? []), ...returnedIds, ...stagedIds]);
  const beforeMap = new Map(before.map(item => [item.apiId, item])), afterMap = new Map(after.map(item => [item.apiId, item]));
  const acknowledged = responseSuccess(plan, exchange, response);
  const items = readbackApiIds.map(apiId => {
    const prior = beforeMap.get(apiId), current = afterMap.get(apiId);
    let state = 'UNOBSERVED';
    if (current) state = !current.found ? 'ABSENT' : prior?.found && prior.sha256 === current.sha256 ? 'UNCHANGED' : 'CHANGED';
    let exactSubmittedBytes = false;
    if (current?.found && typeof plan.bodyText === 'string' && plan.operation !== 'migrate') exactSubmittedBytes = sha(Buffer.from(plan.bodyText)) === current.sha256;
    return { apiId, state, beforeSha256: prior?.sha256 ?? null, afterSha256: current?.sha256 ?? null, beforeKind: prior?.kind ?? null, afterKind: current?.kind ?? null, exactSubmittedBytes, correspondence: current && plan.operation !== 'migrate' ? compareTykDefinition(plan, current) : null, providerReturned: returnedIds.includes(apiId) };
  });
  const successIds = Array.isArray(response?.success?.apiIDs) ? response.success.apiIDs : [];
  const stageResults = Array.isArray(response?.success?.stagedAPIs) ? response.success.stagedAPIs : [];
  const definitionResults = Array.isArray(response?.success?.definitions) ? response.success.definitions : [];
  const successfulSelections = unique([...successIds, ...stageResults.map(item => item?.classicAPIID), ...definitionResults.map(item => item?.apiID)]);
  const selectedCoverage = plan.apiIds.every(apiId => successfulSelections.includes(apiId));
  const failures = Array.isArray(response?.failure?.errors) ? response.failure.errors : [];
  const skipped = Array.isArray(response?.skipped?.apis) ? response.skipped.apis : [];
  const evidence = { readbackApiIds, providerReturnedApiIds: returnedIds, responseId: exchange?.id ?? null, responseBodySha256: exchange?.bodySha256 ?? null, responseStatus: exchange?.status ?? null, nativeAcknowledged: acknowledged, confirmation: null, relatedApiIds: plan.relatedApiIds ?? [], activation: plan.connectionKind === 'gateway' && ['create', 'import', 'update'].includes(plan.operation) ? 'RELOAD_REQUIRED' : plan.operation === 'hotReload' ? 'RELOAD_REQUESTED' : 'NATIVE_DASHBOARD', migration: plan.operation === 'migrate' && response ? { success: response.success ?? null, failure: response.failure ?? null, skipped: response.skipped ?? null, abortedOnFailure: response.abortedOnFailure ?? false } : null };
  let state = 'UNKNOWN';
  if (plan.operation === 'hotReload') state = acknowledged ? 'ACCEPTED' : 'UNKNOWN';
  else if (plan.operation === 'migrate') {
    if (acknowledged && plan.mode === 'dryRun') state = !selectedCoverage || failures.length || (response.failure?.count ?? 0) > 0 || skipped.length ? 'PARTIAL' : 'CONFIRMED';
    else if (acknowledged) {
      const definitions = readTykMigrationDefinitions(exchange);
      const selectedOutputs = plan.mode === 'stage' ? stageResults.map(row => row.oasAPIID) : plan.apiIds;
      const outputCoverage = plan.mode !== 'stage' || plan.apiIds.every(apiId => stageResults.some(row => row.classicAPIID === apiId && nativeId(row.oasAPIID)));
      const affected = unique([...selectedOutputs, ...definitions.keys(), ...(plan.mode === 'stage' ? [] : successIds)]);
      const matched = outputCoverage && affected.length > 0 && affected.every(apiId => definitions.has(apiId) && compareTykDefinition({ ...plan, kind: 'oas', bodyText: definitions.get(apiId), contentType: 'application/json' }, afterMap.get(apiId)).matched);
      evidence.migration.readbackDefinitionMatches = affected.map(apiId => ({ apiId, originalDefinitionReturned: definitions.has(apiId), correspondence: definitions.has(apiId) ? compareTykDefinition({ ...plan, kind: 'oas', bodyText: definitions.get(apiId), contentType: 'application/json' }, afterMap.get(apiId)) : null }));
      state = !selectedCoverage || failures.length || skipped.length || (response.failure?.count ?? 0) > 0 ? 'PARTIAL' : matched ? 'CONFIRMED' : 'ACCEPTED';
      if (state === 'CONFIRMED') evidence.confirmation = 'NATIVE_MIGRATION_DEFINITION_MATCH';
    }
  } else if (acknowledged) {
    const targets = returnedIds.length ? returnedIds : plan.apiIds;
    const current = targets.map(apiId => afterMap.get(apiId));
    const allRead = current.length > 0 && current.every(item => item?.found && item.kind === plan.kind);
    const corresponding = targets.every(apiId => compareTykDefinition(plan, afterMap.get(apiId)).matched);
    state = allRead && corresponding && !(plan.relatedApiIds?.length) ? 'CONFIRMED' : 'ACCEPTED';
    if (state === 'CONFIRMED') evidence.confirmation = 'CURRENT_NATIVE_CONFIGURATION_MATCH';
    if (state === 'CONFIRMED' && plan.connectionKind === 'gateway') evidence.activation = 'ACTIVE_READBACK_OBSERVED';
    if (plan.expectedApiId && returnedIds.length && !returnedIds.includes(plan.expectedApiId)) state = 'DIVERGED';
  } else if ((!exchange || exchange.complete === false) && plan.apiIds.length > 0 && !(plan.relatedApiIds?.length) && plan.apiIds.every(apiId => compareTykDefinition(plan, afterMap.get(apiId)).matched)) {
    state = 'CONFIRMED'; evidence.confirmation = 'CURRENT_NATIVE_CONFIGURATION_MATCH';
    if (plan.connectionKind === 'gateway') evidence.activation = 'ACTIVE_READBACK_OBSERVED';
  } else if (items.length && items.every(item => item.state === 'UNCHANGED')) state = 'UNCHANGED';
  else if (items.length && items.every(item => item.state === 'ABSENT')) state = 'ABSENT';
  else if (items.some(item => item.state === 'CHANGED')) state = 'DIVERGED';
  return { schema: 'stellar-forge.tyk-native-reconciliation.v1', planSha256: plan.sha256, state, items, evidence, response: { acknowledged, status: exchange?.status ?? null, complete: exchange ? exchange.complete !== false : false } };
}
