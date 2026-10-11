// MIT. Tomorrow.io's documented fields, units and exact request selection.
import { normalizeBuyerTransport } from '../../sf31-buyer-client/public-transport.mjs';
export const PLAN_SCHEMA = 'stellar-forge.tomorrow-plan.v1';
export const API_ORIGIN = 'https://api.tomorrow.io';
export const ATTRIBUTION = Object.freeze({ label: 'Powered by Tomorrow.io', url: 'https://www.tomorrow.io/' });
export const CONTRACT = Object.freeze({
  timelines: 'https://docs.tomorrow.io/reference/post-timelines',
  maps: 'https://docs.tomorrow.io/reference/get-map-tile',
  formats: 'https://docs.tomorrow.io/reference/api-formats',
  fields: 'https://docs.tomorrow.io/reference/data-layers-core',
  solar: 'https://docs.tomorrow.io/reference/solar',
  evaluation: 'https://support.tomorrow.io/hc/en-us/articles/31227543026708-How-to-Use-the-Tomorrow-io-API',
  terms: 'https://www.tomorrow.io/legal/terms-of-service/',
  mcp: 'https://api.tomorrow.io/v4/tomorrow-weather/mcp',
});
export const TIMESTEPS = ['1m', '5m', '15m', '30m', '1h', '1d', 'current'];
export const FIELD_UNITS = Object.freeze({
  temperature: { metric: '°C', imperial: '°F' },
  temperatureApparent: { metric: '°C', imperial: '°F' },
  dewPoint: { metric: '°C', imperial: '°F' },
  windSpeed: { metric: 'm/s', imperial: 'mph' },
  windGust: { metric: 'm/s', imperial: 'mph' },
  windDirection: { metric: 'degrees', imperial: 'degrees' },
  precipitationIntensity: { metric: 'mm/hr', imperial: 'in/hr' },
  precipitationProbability: { metric: '%', imperial: '%' },
  humidity: { metric: '%', imperial: '%' },
  cloudCover: { metric: '%', imperial: '%' },
  visibility: { metric: 'km', imperial: 'mi' },
  weatherCode: { metric: 'provider code', imperial: 'provider code' },
  solarGHI: { metric: 'W/m²', imperial: 'Btu/ft²' },
});
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
export function need(value, code) { if (!value) fail(code); }
export function text(value, label, maximum = 256) {
  need(typeof value === 'string' && value.trim().length && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value), label);
  return value.trim();
}
export function id(value) { need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value), 'WEATHER_ID_INVALID'); return value; }
export function integer(value, min, max, code) { need(Number.isSafeInteger(value) && value >= min && value <= max, code); return value; }
export function finite(value, min, max, code) { need(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, code); return value; }
export function fixedTime(value, instant = Date.now()) {
  need(typeof value === 'string', 'WEATHER_TIME_REQUIRED');
  const relative = /^now(?:(Plus|Minus)(\d{1,6})(m|h|d))?$/.exec(value);
  if (relative) return new Date(instant + (relative[1] === 'Minus' ? -1 : 1) * Number(relative[2] ?? 0) * ({ m: 60000, h: 3600000, d: 86400000 }[relative[3]] ?? 1)).toISOString();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  need(parts && Number.isFinite(Date.parse(value)), 'WEATHER_EXPLICIT_TIME_OFFSET_REQUIRED');
  const [, y, m, d, h, minute, s = '0', oh = '0', om = '0'] = parts;
  const calendar = new Date(Date.UTC(+y, +m - 1, +d));
  need(+y >= 1000 && calendar.getUTCFullYear() === +y && calendar.getUTCMonth() === +m - 1 && calendar.getUTCDate() === +d && +h < 24 && +minute < 60 && +s < 60 && +oh < 24 && +om < 60, 'WEATHER_TIME_INVALID');
  return value;
}
export function compileWeatherPlan(raw = {}) {
  need(object(raw) && (raw.schema === undefined || raw.schema === PLAN_SCHEMA), 'WEATHER_PLAN_INVALID');
  const usage = raw.usage ?? { mode: 'keyless-evaluation', retentionSeconds: 0, exportRaw: false };
  need(object(usage) && ['keyless-evaluation', 'licensed-service'].includes(usage.mode), 'WEATHER_USAGE_MODE_REQUIRED');
  const licensed = usage.mode === 'licensed-service';
  if (!licensed) need((usage.retentionSeconds ?? 0) === 0 && usage.exportRaw !== true, 'WEATHER_EVALUATION_IS_EPHEMERAL');
  const apiKeyEnv = raw.apiKeyEnv ?? 'TOMORROW_API_KEY';
  need(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv), 'WEATHER_KEY_REFERENCE_INVALID');
  const transport = raw.transport ? normalizeBuyerTransport(raw.transport) : null;
  if (transport) need(transport.origin === API_ORIGIN && transport.proxyEnv, 'WEATHER_EXPLICIT_PROXY_REFERENCE_REQUIRED');
  const fieldUnits = structuredClone(FIELD_UNITS);
  for (const [field, units] of Object.entries(raw.fieldUnits ?? {})) {
    need(/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(field) && object(units), 'WEATHER_FIELD_INVALID');
    fieldUnits[field] = { metric: text(units.metric, 'WEATHER_UNIT_REQUIRED', 40), imperial: text(units.imperial, 'WEATHER_UNIT_REQUIRED', 40) };
  }
  return {
    schema: PLAN_SCHEMA, apiKeyEnv, fieldUnits, transport,
    usage: { mode: usage.mode, licenseReference: licensed ? text(usage.licenseReference, 'WEATHER_LICENSE_REFERENCE_REQUIRED', 1024) : null,
      retentionSeconds: licensed ? integer(usage.retentionSeconds, 1, 31536000, 'WEATHER_LICENSE_RETENTION_REQUIRED') : 0,
      exportRaw: licensed && usage.exportRaw === true,
      expiresAt: usage.expiresAt ? fixedTime(usage.expiresAt) : null },
    timeoutMs: integer(raw.timeoutMs ?? 30000, 1, 120000, 'WEATHER_TIMEOUT_INVALID'),
    maxResponseBytes: integer(raw.maxResponseBytes ?? 1048576, 1, 1048576, 'WEATHER_RESPONSE_LIMIT_INVALID'),
    maxCallsPerMinute: integer(raw.maxCallsPerMinute ?? 10, 1, 100000, 'WEATHER_CALL_BUDGET_INVALID'),
    maxInFlight: integer(raw.maxInFlight ?? 2, 1, 32, 'WEATHER_CONCURRENCY_INVALID'),
  };
}
export function normalizeWork(input, plan, instant = Date.now()) {
  need(object(input) && object(input.location) && object(input.window), 'WEATHER_WORK_REQUIRED');
  const latitude = finite(input.location.latitude, -90, 90, 'WEATHER_LATITUDE_INVALID');
  const longitude = finite(input.location.longitude, -180, 180, 'WEATHER_LONGITUDE_INVALID');
  const timezone = input.window.timezone ?? 'UTC';
  if (timezone !== 'auto') { try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('WEATHER_TIMEZONE_INVALID'); } }
  const startTime = fixedTime(input.window.startTime, instant), endTime = fixedTime(input.window.endTime, instant);
  need(Date.parse(startTime) < Date.parse(endTime), 'WEATHER_WINDOW_REVERSED');
  const units = input.units ?? 'metric'; need(['metric', 'imperial'].includes(units), 'WEATHER_UNITS_INVALID');
  const fields = input.fields ?? ['temperature', 'windGust', 'precipitationIntensity'];
  need(Array.isArray(fields) && fields.length && fields.length <= 64 && new Set(fields).size === fields.length && fields.every(field => Object.hasOwn(plan.fieldUnits, field)), 'WEATHER_FIELD_SELECTION_INVALID');
  const timesteps = input.timesteps ?? ['1h'];
  need(Array.isArray(timesteps) && timesteps.length && new Set(timesteps).size === timesteps.length && timesteps.every(value => TIMESTEPS.includes(value)), 'WEATHER_TIMESTEPS_INVALID');
  const thresholds = input.thresholds ?? [];
  need(Array.isArray(thresholds) && thresholds.length <= 128, 'WEATHER_THRESHOLDS_INVALID');
  const seen = new Set();
  const rules = thresholds.map((rule, index) => {
    need(object(rule) && fields.includes(rule.field) && ['gte', 'lte', 'gt', 'lt'].includes(rule.operator) && Number.isFinite(rule.value), 'WEATHER_THRESHOLD_INVALID');
    const ruleId = id(rule.id ?? 'rule-' + (index + 1)); need(!seen.has(ruleId), 'WEATHER_DUPLICATE_RULE'); seen.add(ruleId);
    const unit = plan.fieldUnits[rule.field][units];
    need(rule.unit === undefined || rule.unit === unit, 'WEATHER_THRESHOLD_UNIT_MISMATCH');
    return { id: ruleId, field: rule.field, operator: rule.operator, value: rule.value, unit, label: text(rule.label ?? rule.field, 'WEATHER_THRESHOLD_LABEL') };
  });
  let tile = null;
  if (input.tile !== null && input.tile !== false) {
    const selected = input.tile ?? {};
    const zoom = integer(selected.zoom ?? 8, 1, 12, 'WEATHER_TILE_ZOOM_INVALID');
    need(Math.abs(latitude) <= 85.0511287798066, 'WEATHER_TILE_MERCATOR_LATITUDE');
    const n = 2 ** zoom, radians = latitude * Math.PI / 180;
    const x = Math.min(n - 1, Math.floor((longitude + 180) / 360 * n));
    const y = Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n)));
    const field = selected.field ?? 'precipitationIntensity'; need(Object.hasOwn(plan.fieldUnits, field), 'WEATHER_TILE_FIELD_INVALID');
    tile = { zoom, x, y, field, time: fixedTime(selected.time ?? startTime, instant) };
  }
  return { id: input.id ? id(input.id) : undefined, title: text(input.title, 'WEATHER_WORK_TITLE'),
    location: { label: text(input.location.label ?? input.title, 'WEATHER_LOCATION_LABEL'), latitude, longitude },
    window: { startTime, endTime, timezone, dailyStartHour: integer(input.window.dailyStartHour ?? 6, 0, 23, 'WEATHER_DAILY_START_INVALID') },
    units, fields: [...fields], timesteps: [...timesteps], thresholds: rules, tile };
}
export function requestsFor(work) {
  const body = { location: [work.location.latitude, work.location.longitude], fields: [...work.fields], units: work.units,
    timesteps: [...work.timesteps], ...work.window };
  const requests = [{ kind: 'timeline', method: 'POST', url: API_ORIGIN + '/v4/timelines', body }];
  if (work.tile) {
    const t = work.tile;
    requests.push({ kind: 'tile', method: 'GET', url: API_ORIGIN + '/v4/map/tile/' + t.zoom + '/' + t.x + '/' + t.y + '/' +
      encodeURIComponent(t.field) + '/' + encodeURIComponent(t.time + '.png'), tile: { ...t } });
  }
  return requests;
}
