// MIT. Amberdata product selection; execution stays with the original SF30 sources.
import { createHash } from 'node:crypto';
import { compilePythonMerchant } from '../../python/config.mjs';

export const PLAN_SCHEMA = 'stellar-forge.amberdata-research-plan.v1';
export const PAGE_SCHEMA = 'stellar-forge.amberdata-page.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const fail = message => { throw new TypeError(message); };
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
function keys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Unsupported ' + label + ' fields.');
}
function bounded(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail(label + ' must be an integer from ' + low + ' to ' + high + '.');
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(label + ' requires an exact UTC ISO timestamp with milliseconds.');
  return Date.parse(value);
}

export function compilePlan(input) {
  keys(input, ['schema', 'label', 'publicOrigin', 'provider', 'window', 'units', 'limits', 'payment', 'prices', 'workerCount'], 'plan');
  if (input.schema !== PLAN_SCHEMA) fail('Expected ' + PLAN_SCHEMA);
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 120 || /[\x00-\x1f\x7f]/.test(input.label)) fail('A short product label is required.');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { fail('publicOrigin requires HTTPS.'); }
  if (origin.protocol !== 'https:' || origin.origin !== input.publicOrigin || origin.username || origin.password) fail('publicOrigin must be one canonical HTTPS origin.');
  keys(input.provider, ['apiVersion', 'exchange', 'instrument', 'instrumentsShape'], 'provider');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.provider.apiVersion ?? '') || !token.test(input.provider.exchange ?? '') || !token.test(input.provider.instrument ?? '')) fail('Select the original API version, exchange and instrument.');
  if (!['array', 'instrument-map'].includes(input.provider.instrumentsShape)) fail('instrumentsShape must explicitly select array or instrument-map.');
  keys(input.window, ['startDate', 'endDate', 'timeInterval'], 'window');
  const start = date(input.window.startDate, 'startDate'), end = date(input.window.endDate, 'endDate');
  if (end <= start || end - start > 731 * 86400000) fail('The inclusive-start/exclusive-end window must be positive and at most 731 days.');
  if (!['minutes', 'hours', 'days'].includes(input.window.timeInterval)) fail('Select minutes, hours or days.');
  keys(input.units, ['base', 'quote', 'volume', 'volumeKind', 'dailyBoundaryMinutes', 'source'], 'units');
  for (const key of ['base', 'quote', 'volume']) if (typeof input.units[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,32}$/.test(input.units[key])) fail('Explicit base, quote and volume units are required.');
  if (!['base', 'contracts'].includes(input.units.volumeKind) || (input.units.volumeKind === 'base' && input.units.volume !== input.units.base)) fail('Volume must retain its actual base or contract unit.');
  if (input.provider.exchange.toLowerCase() === 'bitmex' && input.units.volumeKind !== 'contracts') fail('BitMEX volume is contracts; this example does not perform an unreviewed conversion.');
  bounded(input.units.dailyBoundaryMinutes, 0, 1439, 'dailyBoundaryMinutes');
  if (typeof input.units.source !== 'string' || !input.units.source.startsWith('https://docs.amberdata.io/') || input.units.source.length > 500) fail('Retain the first-party source for the selected unit and daily boundary.');
  keys(input.limits, ['maxResponseBytes', 'maxInputBytes', 'maxRows', 'maxPages', 'timeoutMs', 'continuationTtlSeconds'], 'limits');
  bounded(input.limits.maxResponseBytes, 1024, 262144, 'maxResponseBytes');
  bounded(input.limits.maxInputBytes, 1024, 524288, 'maxInputBytes');
  bounded(input.limits.maxRows, 1, 2000, 'maxRows');
  bounded(input.limits.maxPages, 1, 16, 'maxPages');
  bounded(input.limits.timeoutMs, 100, 20000, 'timeoutMs');
  bounded(input.limits.continuationTtlSeconds, 60, 86400, 'continuationTtlSeconds');
  keys(input.prices, ['spot_instruments', 'spot_ohlcv', 'ohlcv_summary'], 'prices');
  for (const key of ['spot_instruments', 'spot_ohlcv', 'ohlcv_summary']) if (!/^[1-9][0-9]{0,18}$/.test(input.prices[key] ?? '')) fail('Each named operation needs a positive atomic price string.');
  bounded(input.workerCount ?? 2, 1, 8, 'workerCount');
  const plan = structuredClone(input);
  plan.workerCount ??= 2;
  plan.selectionSha256 = digest({ provider: plan.provider, window: plan.window, units: plan.units, limits: plan.limits });
  // The original compiler validates payment terms and the actual input examples.
  compilePythonMerchant(merchantDeclaration(plan), { baseDir: '/' });
  return Object.freeze(plan);
}

export function upstreamBindings(plan) {
  const common = {
    origin: 'https://api.amberdata.com', method: 'GET',
    headerEnv: { 'x-api-key': 'AMBERDATA_API_KEY', 'api-version': 'AMBERDATA_API_VERSION' },
    responseHeaders: ['etag', 'last-modified'], responseMode: 'json',
    timeoutMs: plan.limits.timeoutMs, maxResponseBytes: plan.limits.maxResponseBytes, maxInFlight: 1,
  };
  return { schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    spot_instruments: { ...common, path: '/markets/spot/exchanges/information', query: ['exchange', 'instrument', 'timeFormat', 'includeInactive', 'cursor'] },
    spot_ohlcv: { ...common, path: '/markets/spot/ohlcv/:instrument', query: ['exchange', 'startDate', 'endDate', 'timeInterval', 'timeFormat', 'cursor'] },
  } };
}

export function merchantDeclaration(plan) {
  const continuation = { type: 'object', properties: { continuation: { type: 'string', minLength: 1, maxLength: 2000 } }, additionalProperties: false };
  const sourceIdentity = { type: 'object', properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 }, format: { const: 'parquet' },
    sha256: { type: 'string', minLength: 64, maxLength: 64 }, bytes: { type: 'integer', minimum: 8, maximum: 268435456 },
  }, required: ['url', 'format', 'sha256', 'bytes'], additionalProperties: false };
  const cloudsync = { type: 'object', properties: {
    schema: { const: 'stellar-forge.amberdata-cloudsync.v1' }, original: sourceIdentity,
    decoder: { type: 'object', properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 }, version: { type: 'string', minLength: 1, maxLength: 80 },
      numberFormat: { const: 'binary64-roundtrip-json' }, originalRowsSha256: { type: 'string', minLength: 64, maxLength: 64 },
      originalRowsBytes: { type: 'integer', minimum: 2, maximum: 4194304 },
    }, required: ['name', 'version', 'numberFormat', 'originalRowsSha256', 'originalRowsBytes'], additionalProperties: false },
    interval: { type: 'string', enum: ['minutes', 'hours', 'days'] },
    rowsBody: { type: 'string', minLength: 2, maxLength: plan.limits.maxInputBytes },
    rowsSha256: { type: 'string', minLength: 64, maxLength: 64 },
  }, required: ['schema', 'original', 'decoder', 'interval', 'rowsBody', 'rowsSha256'], additionalProperties: false };
  const payment = operation => ({ ...plan.payment, amount: plan.prices[operation] });
  const providerFunction = (operation, path, description) => ({
    path, method: 'GET', description, payment: payment(operation), inputSchema: continuation, example: {},
    timeoutMs: Math.min(120000, plan.limits.timeoutMs + 15000), maxInputBytes: 12288,
    maxOutputBytes: 1048576, output: { format: 'json' },
  });
  return {
    schema: 'stellar-forge.python-merchant.v1', application: 'application.py',
    publicOrigin: plan.publicOrigin, serviceName: plan.label, tags: ['market-data', 'research', 'python'],
    workerCount: plan.workerCount ?? 2, maxPending: 16, startupTimeoutMs: 10000, shutdownTimeoutMs: 10000,
    environment: ['AMBERDATA_API_KEY', 'AMBERDATA_PAGE_KEY', 'AMBERDATA_SOURCE_ROOT', 'AMBERDATA_NODE_EXECUTABLE'],
    lifecycle: { startup: 'startup', shutdown: 'shutdown' },
    functions: {
      spot_instruments: providerFunction('spot_instruments', '/spot/instruments', 'Read the selected Amberdata spot instrument and its actual availability; one deliberate original provider page.'),
      spot_ohlcv: providerFunction('spot_ohlcv', '/spot/ohlcv', 'Read one original Amberdata OHLCV page for the retained exchange, instrument and explicit time window.'),
      ohlcv_summary: {
        path: '/research/ohlcv-summary', method: 'POST', description: 'Summarize original Amberdata REST pages or retained CloudSync candles, with source identities, exact decimal values, interval coverage and optional cross-interval comparison.',
        payment: payment('ohlcv_summary'),
        inputSchema: { type: 'object', properties: {
          pages: { type: 'array', minItems: 1, maxItems: plan.limits.maxPages, items: {
            type: 'object', properties: { body: { type: 'string', minLength: 2, maxLength: plan.limits.maxResponseBytes } }, required: ['body'], additionalProperties: true,
          } },
          cloudsync,
          compareCloudsync: { type: 'array', minItems: 1, maxItems: 2, items: cloudsync },
        }, additionalProperties: false,
          oneOf: [
            { required: ['pages'], properties: { pages: {} }, additionalProperties: false },
            { required: ['cloudsync'], properties: { cloudsync: {}, compareCloudsync: {} }, additionalProperties: false },
          ],
        },
        // A complete empty original-shaped page is a compilation example, never market data.
        example: { pages: [{ body: JSON.stringify({ status: 200, payload: { metadata: { 'api-version': plan.provider.apiVersion }, data: [] } }), request: { cursor: null } }] },
        timeoutMs: 15000, maxInputBytes: plan.limits.maxInputBytes, maxOutputBytes: 524288, output: { format: 'json' },
      },
    },
  };
}
