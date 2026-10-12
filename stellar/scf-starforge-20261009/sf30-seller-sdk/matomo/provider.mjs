// MIT. Matomo reads composed through the original SF30 upstream and multipart wire path.
import { createUpstreamHandlers, closeUpstreamHandlers } from '../upstream.mjs';
import { UPSTREAM_ATTEMPT } from '../upstream-handler.mjs';
import { encodeMultipart } from '../multipart.mjs';
import { fault, digest, stamp } from '../postgres/publisher/files.mjs';
import { sourceConfig, plain } from './contract.mjs';
import { parseNative, scalarText } from './values.mjs';

const ROUTES = Object.freeze({
  reports: {method: 'API.getReportMetadata', wordpress: 'api/report_metadata'},
  segments: {method: 'API.getSegmentsMetadata', wordpress: 'api/segments_metadata'},
  site: {method: 'SitesManager.getSiteFromId', wordpress: 'api/settings'},
  version: {method: 'API.getMatomoVersion', wordpress: 'api/matomo_version'},
  processed: {method: 'API.getProcessedReport', wordpress: 'api/processed_report'},
});
function nativeFields(kind, payload, config) {
  const route = ROUTES[kind];
  if (!route || !plain(payload)) throw fault('MATOMO_READ_OPERATION_INVALID');
  const fields = [];
  const add = (key, value) => {
    const item = scalarText(value);
    if (item !== null) fields.push([key, item]);
  };
  if (config.mode === 'reporting-api') {
    add('module', 'API'); add('method', route.method); add('format', 'json'); add('idSite', config.siteId);
  }
  const scope = payload.scope ?? {};
  if (['reports', 'processed'].includes(kind)) {
    add('period', scope.period); add('date', scope.date);
    add('language', scope.language ?? 'en');
  }
  if (kind === 'reports') {
    add('hideMetricsDoc', '0'); add('showSubtableReports', '1');
  } else if (kind === 'segments') add('hideImplementationData', '0');
  else if (kind === 'processed') {
    const report = payload.report;
    if (!plain(report) || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(report.module ?? '') ||
        !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(report.action ?? '')) throw fault('MATOMO_REPORT_METADATA_INVALID');
    add('apiModule', report.module); add('apiAction', report.action);
    add('segment', scope.segment ?? '');
    add('showTimer', '0'); add('hideMetricsDoc', '0'); add('showRawMetrics', '1');
    add('format_metrics', '0'); add('filter_limit', payload.limit); add('filter_offset', payload.offset);
    add('filter_sort_column', 'label'); add('filter_sort_order', 'asc');
    add('expanded', '0'); add('flat', '0');
    for (const [key, value] of Object.entries(report.parameters ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(key)) throw fault('MATOMO_REPORT_PARAMETERS_INVALID');
      add('apiParameters[' + key + ']', value);
    }
    if (payload.idSubtable !== null && payload.idSubtable !== undefined) add('idSubtable', payload.idSubtable);
  }
  if (fields.length > 63 || fields.some(([key, value]) => value.length > 16384 || /[\0\r\n]/.test(key)))
    throw fault('MATOMO_REQUEST_FIELDS_LIMIT');
  return fields;
}
function secretValue(env, name) {
  if (!name) return null;
  const value = env[name];
  if (typeof value !== 'string' || value.length < 8 || value.length > 8192 || /[\0\r\n]/.test(value))
    throw fault('MATOMO_CREDENTIAL_UNAVAILABLE', 'Configure the selected source credential environment reference.');
  return value;
}
function waitFor(ms, signal) {
  if (ms <= 0) { signal?.throwIfAborted(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(fault('MATOMO_CANCELLED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, {once: true});
    if (signal?.aborted) stop();
  });
}
export function createMatomoSource(input, {env = process.env, allowLoopback = false, lookup} = {}) {
  const config = sourceConfig(input, {allowLoopback}), instances = new Map();
  const token = secretValue(env, config.authorization.tokenEnv);
  const authorization = secretValue(env, config.authorization.headerEnv);
  const secrets = [token, authorization, authorization?.replace(/^[A-Za-z]+\s+/, '')].filter(Boolean);
  const active = new Map(); let lastDispatch = 0, closed = false, closing = null;
  function prepared(kind, payload) {
    const route = ROUTES[kind], fields = nativeFields(kind, payload, config), endpoint = new URL(config.endpoint);
    let method, query, context, request;
    if (config.mode === 'reporting-api') {
      method = 'POST'; query = {};
      const publicFields = Object.fromEntries(fields);
      const multipart = encodeMultipart({fields: {...publicFields, ...(token ? {token_auth: token} : {})}});
      context = {method, url: new URL('https://matomo-request.invalid/'), headers: {'content-type': multipart.contentType},
        bodyType: 'form-data', rawBody: multipart.raw};
      request = {method, endpoint: endpoint.href, encoding: 'multipart/form-data', fields: publicFields,
        authenticated: Boolean(token), credentialsRetained: false};
    } else {
      method = 'GET'; query = {};
      if (endpoint.searchParams.has('rest_route')) fields.unshift(['rest_route', '/matomo/v1/' + route.wordpress]);
      else endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/' + route.wordpress;
      endpoint.search = '';
      const url = new URL('https://matomo-request.invalid/'), publicUrl = new URL(endpoint);
      fields.forEach(([name, value], index) => {
        const alias = 'p' + index; query[alias] = name; url.searchParams.append(alias, value); publicUrl.searchParams.append(name, value);
      });
      context = {method, url, headers: {}};
      request = {method, endpoint: publicUrl.href, encoding: 'native-wordpress-rest-query',
        fields: Object.fromEntries(fields), authenticated: Boolean(authorization), credentialsRetained: false};
    }
    const binding = {origin: endpoint.origin, path: endpoint.pathname, method, query,
      responseMode: 'bytes', retainErrorResponse: true, responseHeaders: ['content-type', 'content-language', 'etag', 'last-modified'],
      timeoutMs: config.timeoutMs, maxResponseBytes: config.maxResponseBytes, maxInFlight: 1,
      maxRequestBytes: 262144, ...(method === 'POST' ? {bodyType: 'form-data'} : {}),
      ...(config.mode === 'wordpress' && config.authorization.headerEnv ? {headerEnv: {authorization: config.authorization.headerEnv}} : {})};
    const upstream = {schema: 'stellar-forge.seller-upstreams.v1', bindings: {matomoRead: binding}};
    if (config.transport) { upstream.transports = {matomo: config.transport}; binding.transport = 'matomo'; }
    return {request, context, upstream};
  }
  async function read(kind, payload, {signal} = {}) {
    if (closed) throw fault('MATOMO_SOURCE_CLOSED');
    if (active.size) throw fault('MATOMO_SOURCE_BUSY', 'Finish the current retained Matomo read first.', 409);
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    const operation = (async () => {
      await waitFor(Math.max(0, config.minIntervalMs - (Date.now() - lastDispatch)), controller.signal);
      const plan = prepared(kind, payload), key = JSON.stringify(plan.upstream);
      let handlers = instances.get(key);
      if (!handlers) {
        handlers = createUpstreamHandlers(plan.upstream, {env, allowLoopback, ...(lookup ? {lookup} : {})});
        instances.set(key, handlers);
      }
      controller.signal.throwIfAborted();
      const startedAt = stamp(); lastDispatch = Date.now();
      const response = await handlers.matomoRead({...plan.context, signal: controller.signal});
      const completedAt = stamp(), attempt = response[UPSTREAM_ATTEMPT] ?? {};
      const result = {request: plan.request, startedAt, completedAt, dispatched: attempt.dispatched === true,
        status: attempt.upstreamStatus ?? response.body?.upstreamStatus ?? response.status,
        transportStatus: response.status, headers: response.headers ?? {}, body: null, bodyBytes: 0, bodySha256: null,
        responseRetained: false, ok: false, error: null};
      if (!(response.body instanceof Uint8Array)) {
        result.error = /^[A-Z][A-Z0-9_]{0,100}$/.test(response.body?.error ?? '') ? response.body.error : 'MATOMO_RESPONSE_UNAVAILABLE';
        return result;
      }
      const raw = Buffer.from(response.body);
      if (secrets.some(value => raw.includes(Buffer.from(value)) || raw.includes(Buffer.from(encodeURIComponent(value))))) {
        result.error = 'MATOMO_CREDENTIAL_IN_RESPONSE'; return result;
      }
      result.body = raw; result.bodyBytes = raw.length; result.bodySha256 = digest(raw); result.responseRetained = true;
      let value;
      try { value = parseNative(raw); }
      catch (error) { result.error = error.code; return result; }
      if (value?.result === 'error') { result.error = 'MATOMO_API_ERROR'; return result; }
      result.ok = response.status >= 200 && response.status < 300;
      if (!result.ok) result.error = 'MATOMO_HTTP_ERROR';
      return result;
    })();
    active.set(operation, controller);
    try { return await operation; }
    finally { active.delete(operation); signal?.removeEventListener('abort', cancel); }
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled([...active.keys()]);
      for (const handlers of instances.values()) await closeUpstreamHandlers(handlers);
      instances.clear();
    })();
    return closing;
  }
  return Object.freeze({config, read, describeRequest: (kind, payload) => prepared(kind, payload).request, close});
}
