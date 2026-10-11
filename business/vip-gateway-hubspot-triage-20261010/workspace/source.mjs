import { canonical, digest, integer, iso, nativeId, now, parse, plain, requireThat, sha, text, WorkspaceError } from './common.mjs';

export const DEFAULT_CONFIG = {
  triage: { portalId: '', stageStatus: {}, nextActionProperty: 'next_action_date', sourceProperty: 'hs_analytics_source', leadQualityProperty: null, lastRecordUpdateProperty: 'hs_lastmodifieddate', staleRecordDays: 7, minAgeDays: 2, lookbackDays: 90, minCohort: 10, maxAlerts: 40, maxPerOwner: 5 },
  scope: { pipelineIds: [], ownerIds: [] },
  context: { lastContactProperty: null, stageEnteredProperty: null, lostReasonProperty: null, amountProperty: 'amount', currencyProperty: 'deal_currency_code' }
};
const property = (value, label, nullable = false) => {
  if (nullable && (value === '' || value === null || value === undefined)) return null;
  requireThat(typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value), 'PROPERTY_NAME', `${label} must be an original HubSpot internal property name`); return value;
};
export function normalizeConfig(input) {
  requireThat(plain(input) && plain(input.triage) && plain(input.scope) && plain(input.context), 'CONFIG', 'Configuration needs triage, scope and context objects');
  const t = input.triage, c = input.context;
  requireThat(plain(t.stageStatus) && Object.keys(t.stageStatus).length <= 1000, 'STAGES', 'Declare the native stage status mapping');
  const stages = {};
  for (const [key, value] of Object.entries(t.stageStatus)) {
    requireThat(key.length > 0 && key.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(key) && ['open', 'won', 'lost'].includes(value), 'STAGES', 'Every native stage maps to open, won or lost'); Object.defineProperty(stages, key, { value, enumerable: true, writable: true });
  }
  const ids = (value, label) => { requireThat(Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length, 'SCOPE', `${label} must be distinct IDs`); return value.map(x => text(x, label, 128)); };
  return {
    triage: { portalId: nativeId(t.portalId, 'portalId', true) ?? '', stageStatus: stages,
      nextActionProperty: property(t.nextActionProperty, 'nextActionProperty'), sourceProperty: property(t.sourceProperty, 'sourceProperty'), leadQualityProperty: property(t.leadQualityProperty, 'leadQualityProperty', true), lastRecordUpdateProperty: property(t.lastRecordUpdateProperty, 'lastRecordUpdateProperty'),
      staleRecordDays: integer(t.staleRecordDays, 'staleRecordDays', 1, 90), minAgeDays: integer(t.minAgeDays, 'minAgeDays', 0, 30), lookbackDays: integer(t.lookbackDays, 'lookbackDays', 7, 730), minCohort: integer(t.minCohort, 'minCohort', 5, 100), maxAlerts: integer(t.maxAlerts, 'maxAlerts', 1, 250), maxPerOwner: integer(t.maxPerOwner, 'maxPerOwner', 1, 25) },
    scope: { pipelineIds: ids(input.scope.pipelineIds, 'pipelineIds'), ownerIds: ids(input.scope.ownerIds, 'ownerIds') },
    context: Object.fromEntries(Object.keys(DEFAULT_CONFIG.context).map(key => [key, property(c[key], key, true)]))
  };
}
export function sourceProperties(config) {
  return [...new Set(['createdate', 'dealstage', 'pipeline', 'hubspot_owner_id', 'hs_lastmodifieddate', config.triage.nextActionProperty, config.triage.sourceProperty, config.triage.leadQualityProperty, config.triage.lastRecordUpdateProperty, ...Object.values(config.context)].filter(Boolean))].sort();
}
export function recordBasis(record, config) {
  const properties = {};
  for (const key of sourceProperties(config)) properties[key] = Object.hasOwn(record.properties, key) ? record.properties[key] : null;
  return { id: String(record.id), properties };
}
export function validateRecord(record) {
  requireThat(plain(record) && plain(record.properties), 'DEAL_SHAPE', 'Every deal requires its original properties object');
  nativeId(record.id, 'deal id');
  requireThat(Object.keys(record.properties).length <= 1000, 'DEAL_SHAPE', 'A deal has too many properties');
  for (const [key, value] of Object.entries(record.properties)) requireThat(key.length <= 160 && (value === null || typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'boolean'), 'DEAL_SHAPE', 'Keep native property values as strings, null, booleans or safe integer counts; decimal and large integer text must stay strings');
  requireThat(Buffer.byteLength(JSON.stringify(record)) <= 1024 * 1024, 'DEAL_SIZE', 'A deal exceeds 1 MiB'); return record;
}
export function importDeals(bytes, declaredComplete) {
  const raw = parse(bytes, 'HubSpot deal export'), pages = Array.isArray(raw) ? [{ results: raw }] : Array.isArray(raw?.pages) ? raw.pages : [raw];
  requireThat(pages.length > 0 && pages.length <= 10000, 'DEAL_SHAPE', 'Export must contain at least one native response');
  const records = new Map(); let duplicateCount = 0;
  for (const page of pages) {
    requireThat(Array.isArray(page?.results), 'DEAL_SHAPE', 'Expected a native results array or a pages array of native responses');
    for (const row of page.results) {
      validateRecord(row); const old = records.get(row.id);
      if (old) { requireThat(canonical(old) === canonical(row), 'DUPLICATE_CHANGED', `Deal ${row.id} occurs with different original values; import a reconciled capture`); duplicateCount++; }
      else records.set(row.id, row);
      requireThat(records.size <= 100000, 'SOURCE_CAPACITY', 'Original triage accepts at most 100,000 unique deals');
    }
  }
  const nextAfter = pages.at(-1)?.paging?.next?.after ?? null;
  requireThat(!(declaredComplete && nextAfter !== null), 'PARTIAL_SOURCE', 'This response still has a next page; keep it partial or import the complete export');
  return { records: [...records.values()], pageCount: pages.length, duplicateCount, complete: Boolean(declaredComplete) && nextAfter === null, completeness: declaredComplete ? 'OPERATOR_DECLARED_COMPLETE' : 'PARTIAL_EXPORT', nextAfter };
}
export function normalizeSchema(kind, raw) {
  requireThat(['properties', 'pipelines'].includes(kind) && Array.isArray(raw?.results), 'SCHEMA_SHAPE', 'Use the original properties or pipelines response with results[]');
  requireThat(raw.results.length <= 10000, 'SCHEMA_CAPACITY', 'Schema has too many entries');
  for (const row of raw.results) {
    requireThat(plain(row), 'SCHEMA_SHAPE', 'Schema entries must be objects');
    if (kind === 'properties') property(row.name, 'property name');
    else requireThat(typeof row.id === 'string' && Array.isArray(row.stages) && row.stages.every(s => typeof s.id === 'string'), 'SCHEMA_SHAPE', 'Pipelines need original IDs and stages');
  }
  return raw;
}
export function selectedRecords(records, config) {
  return records.filter(row => (!config.scope.pipelineIds.length || config.scope.pipelineIds.includes(String(row.properties.pipeline ?? ''))) && (!config.scope.ownerIds.length || config.scope.ownerIds.includes(String(row.properties.hubspot_owner_id ?? ''))));
}
export function validateCapturedDefinitions(config, records, schemas) {
  if (schemas.properties) {
    const properties = new Set(normalizeSchema('properties', schemas.properties).results.map(row => row.name));
    const missing = sourceProperties(config).filter(name => !properties.has(name));
    requireThat(missing.length === 0, 'UNDEFINED_PROPERTIES', `These configured original properties are absent from the captured account schema: ${missing.join(', ')}`);
  }
  if (schemas.pipelines) {
    const pipelines = new Map();
    for (const pipeline of normalizeSchema('pipelines', schemas.pipelines).results) {
      requireThat(!pipelines.has(pipeline.id), 'AMBIGUOUS_PIPELINE', 'Captured pipeline definitions repeat a native ID');
      const stages = new Set(pipeline.stages.map(stage => stage.id));
      requireThat(stages.size === pipeline.stages.length, 'AMBIGUOUS_STAGE', 'A captured pipeline repeats a native stage ID');
      pipelines.set(pipeline.id, stages);
    }
    for (const row of records) {
      const pipeline = String(row.properties.pipeline ?? ''), stage = String(row.properties.dealstage ?? '');
      requireThat(pipelines.has(pipeline) && pipelines.get(pipeline).has(stage), 'PIPELINE_STAGE', `Deal ${row.id} stage ${stage} does not belong to its captured native pipeline ${pipeline}`);
    }
  }
}
export function mappedContext(record, config) {
  return Object.fromEntries(Object.entries(config.context).map(([key, source]) => [key.replace(/Property$/, ''), { property: source, value: source && Object.hasOwn(record.properties, source) ? record.properties[source] : null }]));
}
export function makeProvider({ tokenEnv = null, providerOrigin = 'https://api.hubapi.com', development = false, environment = process.env, trace = () => {} } = {}) {
  const origin = new URL(providerOrigin);
  requireThat(origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password, 'PROVIDER_ORIGIN', 'Provider origin must not contain a path or credentials');
  const local = origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname);
  requireThat(origin.origin === 'https://api.hubapi.com' || development && local, 'PROVIDER_ORIGIN', 'Use the official HubSpot API or an explicitly selected local development source');
  if (tokenEnv !== null) requireThat(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv), 'TOKEN_ENV', 'Use an environment variable name for the HubSpot token');
  const token = () => tokenEnv ? environment[tokenEnv] : null;
  const binding = () => sha((token() ?? '') + '\n' + origin.origin);
  async function request(path, { method = 'GET', body, signal, mutating = false, onRetry = () => {} } = {}) {
    requireThat(typeof path === 'string' && path.startsWith('/crm/') && !path.startsWith('//'), 'PROVIDER_PATH', 'Only original CRM API paths are supported');
    requireThat(local && development || typeof token() === 'string' && token().length > 0, 'PROVIDER_NOT_CONFIGURED', `Set the configured ${tokenEnv ?? 'HubSpot token'} environment value on the operator host`);
    let last;
    for (let attempt = 0; attempt < (mutating ? 1 : 4); attempt++) {
      signal?.throwIfAborted(); const startedAt = now(); const target = new URL(path, origin); const headers = { Accept: 'application/json' };
      if (token()) headers.Authorization = `Bearer ${token()}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let response, bytes;
      try {
        response = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; requireThat(size <= 16 * 1024 * 1024, 'PROVIDER_SIZE', 'A provider response exceeds 16 MiB'); chunks.push(chunk); }
        bytes = Buffer.concat(chunks);
        trace({ method, path, requestBody: body ?? null, startedAt, completedAt: now(), status: response.status, correlationId: response.headers.get('x-hubspot-correlation-id') }, bytes);
      } catch (error) { if (signal?.aborted) throw signal.reason; error.mayHaveExecuted = mutating; throw error; }
      if (response.ok) return { data: parse(bytes, 'HubSpot response'), bytes, status: response.status };
      last = new WorkspaceError('HUBSPOT_HTTP_' + response.status, `HubSpot returned HTTP ${response.status}; inspect the retained response`, response.status === 429 ? 429 : 502);
      last.mayHaveExecuted = mutating && (response.status >= 500 || response.status === 408);
      const transient = response.status === 429 || response.status >= 500;
      const retry = response.headers.get('retry-after');
      let delay = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - Date.now()) : 500 * 2 ** attempt;
      delay = Math.max(250, delay);
      last.retryAt = new Date(Date.now() + Math.min(delay, 86400000)).toISOString();
      if (!transient || mutating || attempt === 3 || delay > 10000) throw last;
      onRetry({ retryAt: last.retryAt, status: response.status, attempt: attempt + 1 });
      await new Promise((resolve, reject) => { const done = () => { signal?.removeEventListener('abort', abort); resolve(); }; const timer = setTimeout(done, delay); const abort = () => { clearTimeout(timer); reject(signal.reason); }; signal?.addEventListener('abort', abort, { once: true }); });
    }
    throw last;
  }
  return { request, binding, info: () => ({ configured: Boolean(local && development || token()), tokenEnv, origin: origin.origin, kind: development ? 'LOCAL_DEVELOPMENT_HTTP' : 'HUBSPOT' }) };
}
