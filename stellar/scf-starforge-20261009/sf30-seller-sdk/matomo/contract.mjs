// MIT. Native Matomo source selection; no tracking or management writes.
import { fault, identity, object } from '../postgres/publisher/files.mjs';

export const SOURCE_SCHEMA = 'stellar-forge.matomo-source.v1';
export const SCOPE_SCHEMA = 'stellar-forge.matomo-report-selection.v1';
export const CAPTURE_SCHEMA = 'stellar-forge.matomo-capture.v1';
export const MODES = Object.freeze(['reporting-api', 'wordpress']);
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export const HASH = /^[a-f0-9]{64}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const BAD = /[\x00-\x1f\x7f]/;
export const plain = value => object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function only(value, keys, code = 'MATOMO_FIELDS_INVALID') {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
  return value;
}
export function identifier(value, label = 'operation') {
  if (typeof value !== 'string' || !ID.test(value)) throw fault('MATOMO_ID_INVALID', 'Choose a stable ' + label + ' ID, up to 96 simple characters.');
  return value;
}
export function text(value, label, limit = 4096, {empty = false} = {}) {
  if (typeof value !== 'string' || value.length > limit || BAD.test(value) || !empty && !value.trim())
    throw fault('MATOMO_TEXT_INVALID', 'Supply ' + label + ' as plain text.');
  return value;
}
export function integer(value, fallback, low, high, code) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
}
export function sourceConfig(input, {allowLoopback = false} = {}) {
  only(input, ['schema', 'mode', 'endpoint', 'siteId', 'authorization', 'transport', 'timeoutMs', 'maxResponseBytes', 'minIntervalMs', 'label']);
  if (input.schema !== SOURCE_SCHEMA || !MODES.includes(input.mode)) throw fault('MATOMO_SOURCE_SCHEMA');
  let url;
  try { url = new URL(input.endpoint); } catch { throw fault('MATOMO_ENDPOINT_INVALID'); }
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.href !== input.endpoint ||
      url.protocol !== 'https:' && !(allowLoopback && local && url.protocol === 'http:') ||
      /%2f|%5c/i.test(url.pathname) || url.pathname.includes('//') || url.pathname.includes('\\'))
    throw fault('MATOMO_ENDPOINT_INVALID', 'Use the exact canonical HTTPS Matomo endpoint, without credentials or a fragment.');
  let siteId = null;
  if (input.mode === 'reporting-api') {
    if (url.search) throw fault('MATOMO_ENDPOINT_QUERY', 'Keep report parameters out of the saved Reporting API endpoint.');
    const site = String(input.siteId ?? '');
    if (!/^[1-9][0-9]{0,14}$/.test(site) || !Number.isSafeInteger(Number(site))) throw fault('MATOMO_SINGLE_SITE_REQUIRED');
    siteId = site;
  } else {
    if (input.siteId !== undefined && input.siteId !== null) throw fault('MATOMO_WORDPRESS_SITE_CONTEXT', 'Matomo for WordPress selects its own site context.');
    if (url.search) {
      const keys = [...url.searchParams.keys()];
      if (keys.length !== 1 || keys[0] !== 'rest_route' || url.searchParams.get('rest_route') !== '/matomo/v1')
        throw fault('MATOMO_WORDPRESS_ENDPOINT', 'Use the native WordPress REST base, including its unchanged rest_route form when selected.');
    } else if (!url.pathname.replace(/\/$/, '').endsWith('/matomo/v1')) throw fault('MATOMO_WORDPRESS_ENDPOINT');
  }
  const authorization = input.authorization ?? {};
  only(authorization, input.mode === 'reporting-api' ? ['tokenEnv'] : ['headerEnv'], 'MATOMO_AUTH_CONFIGURATION');
  for (const value of Object.values(authorization)) if (typeof value !== 'string' || !ENV.test(value)) throw fault('MATOMO_AUTH_CONFIGURATION');
  let transport = null;
  if (input.transport !== undefined && input.transport !== null) {
    only(input.transport, ['mode', 'proxyEnv'], 'MATOMO_TRANSPORT_CONFIGURATION');
    if (!['direct', 'environment-proxy'].includes(input.transport.mode) ||
        input.transport.mode === 'direct' && input.transport.proxyEnv !== undefined ||
        input.transport.mode === 'environment-proxy' && (!ENV.test(input.transport.proxyEnv ?? '') || url.protocol !== 'https:'))
      throw fault('MATOMO_TRANSPORT_CONFIGURATION');
    transport = {...input.transport};
  }
  return {schema: SOURCE_SCHEMA, mode: input.mode, endpoint: url.href, siteId,
    label: text(input.label ?? 'Matomo reporting source', 'a source label', 160),
    authorization: {...authorization}, ...(transport ? {transport} : {}),
    timeoutMs: integer(input.timeoutMs, 30000, 100, 120000, 'MATOMO_TIMEOUT'),
    maxResponseBytes: integer(input.maxResponseBytes, 1048576, 1024, 1048576, 'MATOMO_PAGE_BYTE_LIMIT'),
    minIntervalMs: integer(input.minIntervalMs, 750, 0, 60000, 'MATOMO_REQUEST_INTERVAL')};
}
function literalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fault('MATOMO_LITERAL_DATE_REQUIRED');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw fault('MATOMO_LITERAL_DATE_REQUIRED');
  return value;
}
export function reportingScope(input) {
  only(input, ['period', 'date', 'segment', 'language']);
  if (!['day', 'week', 'month', 'year', 'range'].includes(input.period)) throw fault('MATOMO_PERIOD_INVALID');
  const dates = String(input.date ?? '').split(',');
  if (input.period === 'range') {
    if (dates.length !== 2 || literalDate(dates[0]) > literalDate(dates[1])) throw fault('MATOMO_RANGE_INVALID');
  } else if (dates.length !== 1) throw fault('MATOMO_SINGLE_PERIOD_REQUIRED');
  else literalDate(dates[0]);
  const language = input.language ?? 'en';
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw fault('MATOMO_LANGUAGE_INVALID');
  return {period: input.period, date: dates.join(','), segment: text(input.segment ?? '', 'the exact segment expression', 8192, {empty: true}), language};
}
export function selection(input) {
  only(input, ['schema', 'catalogId', 'reportId', 'scope', 'pageSize', 'maxRows', 'maxRequests', 'maxBytes', 'maxDepth', 'subtables', 'note']);
  if (input.schema !== SCOPE_SCHEMA) throw fault('MATOMO_SELECTION_SCHEMA');
  return {schema: SCOPE_SCHEMA, catalogId: identifier(input.catalogId, 'catalog'),
    reportId: text(input.reportId, 'the discovered report ID', 1024), scope: reportingScope(input.scope),
    pageSize: integer(input.pageSize, 100, 1, 1000, 'MATOMO_PAGE_SIZE'),
    maxRows: integer(input.maxRows, 250000, 1, 1000000, 'MATOMO_CAPTURE_ROW_LIMIT'),
    maxRequests: integer(input.maxRequests, 5000, 1, 10000, 'MATOMO_CAPTURE_REQUEST_LIMIT'),
    maxBytes: integer(input.maxBytes, 134217728, 1024, 536870912, 'MATOMO_CAPTURE_BYTE_LIMIT'),
    maxDepth: integer(input.maxDepth, 32, 0, 128, 'MATOMO_SUBTABLE_DEPTH'),
    subtables: input.subtables === undefined ? true : typeof input.subtables === 'boolean' ? input.subtables : (()=>{throw fault('MATOMO_SUBTABLE_SELECTION');})(),
    note: text(input.note ?? 'Selected native processed report and its retained archive rows.', 'the source selection note', 2000)};
}
export function reportIdentity(report) {
  if (!plain(report) || !NAME.test(report.module ?? '') || !NAME.test(report.action ?? '')) throw fault('MATOMO_REPORT_METADATA_INVALID');
  const parameters = report.parameters ?? {};
  if (!plain(parameters) || Object.keys(parameters).some(key => !NAME.test(key))) throw fault('MATOMO_REPORT_PARAMETERS_INVALID');
  const result = {module: report.module, action: report.action, parameters};
  return typeof report.uniqueId === 'string' && report.uniqueId ? report.uniqueId : identity(result);
}
export function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code) ? error.code : 'MATOMO_OPERATION_FAILED';
  return {code, message: code, status: Number.isInteger(error?.status) ? error.status : 500};
}
