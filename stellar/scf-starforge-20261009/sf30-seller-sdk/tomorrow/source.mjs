// MIT. Weather response interpretation and original SF30/SF31 provider transport.
import { createUpstreamHandlers, closeUpstreamHandlers } from '../upstream.mjs';
import { compileWeatherPlan, API_ORIGIN, fixedTime, object, need, fail, requestsFor } from './config.mjs';
import { createHash } from 'node:crypto';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function readTimeline(bytes, request) {
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('WEATHER_PROVIDER_JSON_INVALID'); }
  need(object(value?.data) && Array.isArray(value.data.timelines), 'WEATHER_TIMELINE_SHAPE_INVALID');
  const seen = new Set(), timelines = value.data.timelines.map(timeline => {
    need(object(timeline) && request.timesteps.includes(timeline.timestep) && !seen.has(timeline.timestep) && Array.isArray(timeline.intervals), 'WEATHER_TIMELINE_IDENTITY_INVALID');
    seen.add(timeline.timestep);
    fixedTime(timeline.startTime); fixedTime(timeline.endTime);
    need(Date.parse(timeline.startTime) <= Date.parse(timeline.endTime), 'WEATHER_PROVIDER_EXTENT_INVALID');
    let last = -Infinity;
    const intervals = timeline.intervals.map(interval => {
      need(object(interval) && object(interval.values), 'WEATHER_INTERVAL_INVALID');
      fixedTime(interval.startTime); const current = Date.parse(interval.startTime);
      need(current > last && current >= Date.parse(timeline.startTime) && current <= Date.parse(timeline.endTime), 'WEATHER_INTERVAL_ORDER_INVALID'); last = current;
      for (const field of request.fields) if (Object.hasOwn(interval.values, field)) {
        const v = interval.values[field]; need(v === null || ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v)), 'WEATHER_FIELD_VALUE_INVALID');
      }
      return { startTime: interval.startTime, values: structuredClone(interval.values) };
    });
    return { timestep: timeline.timestep, startTime: timeline.startTime, endTime: timeline.endTime, intervals };
  });
  return { value, timelines, returnedIntervals: timelines.reduce((n, t) => n + t.intervals.length, 0),
    returnedExtent: timelines.map(({ timestep, startTime, endTime }) => ({ timestep, startTime, endTime })),
    requestedTimestepsAbsent: request.timesteps.filter(timestep => !seen.has(timestep)) };
}
export function readPng(bytes, mime) {
  const b = Buffer.from(bytes);
  need(String(mime).split(';')[0].trim().toLowerCase() === 'image/png', 'WEATHER_TILE_MIME_INVALID');
  need(b.length >= 45 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.readUInt32BE(8) === 13 &&
    b.toString('ascii', 12, 16) === 'IHDR' && b.toString('ascii', b.length - 8, b.length - 4) === 'IEND', 'WEATHER_TILE_PNG_INVALID');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  need(width === 256 && height === 256, 'WEATHER_TILE_DIMENSIONS_INVALID');
  return { width, height, mime: 'image/png' };
}
export function createTomorrowSource(raw, { env = process.env, lookup, clock = Date.now } = {}) {
  const plan = compileWeatherPlan(raw), licensed = plan.usage.mode === 'licensed-service';
  const responseHeaders = ['content-type', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
    'x-ratelimit-limit-day', 'x-ratelimit-remaining-day', 'x-ratelimit-limit-hour', 'x-ratelimit-remaining-hour',
    'x-ratelimit-limit-second', 'x-ratelimit-remaining-second'];
  const common = { origin: API_ORIGIN, responseHeaders, timeoutMs: plan.timeoutMs,
    maxResponseBytes: plan.maxResponseBytes, maxInFlight: plan.maxInFlight,
    ...(licensed ? { headerEnv: { apikey: plan.apiKeyEnv } } : {}) };
  const native = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    weatherTimeline: { ...common, path: '/v4/timelines', method: 'POST', bodyType: 'json', responseMode: 'json' },
    weatherTile: { ...common, path: '/v4/map/tile/:zoom/:x/:y/:field/:timeFile', method: 'GET', responseMode: 'bytes' },
  } }, { env, ...(lookup ? { lookup } : {}) });
  const proxyFetch = plan.transport ? createPublicHttpsFetch({ timeoutMs: plan.timeoutMs, trustedProxy: plan.transport }) : null;
  async function throughOriginalProxy(request, signal) {
    const response = await proxyFetch(request.url, { method: request.method, redirect: 'manual', signal,
      headers: { accept: request.kind === 'tile' ? 'image/png' : 'application/json',
        ...(request.body ? { 'content-type': 'application/json' } : {}), ...(licensed ? { apikey: env[plan.apiKeyEnv] } : {}) },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}) });
    const headers = Object.fromEntries([...response.headers].filter(([name]) => name === 'content-type' || name === 'retry-after' || /^(?:x-)?rate-?limit(?:-|$)/i.test(name)));
    if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, headers, body: { error: 'WEATHER_PROVIDER_HTTP_STATUS', upstreamStatus: response.status } }; }
    const chunks = []; let size = 0; const reader = response.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      need(size <= plan.maxResponseBytes, 'WEATHER_RESPONSE_LIMIT'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return { status: response.status, headers, body: Buffer.concat(chunks, size) };
  }
  const starts = []; let inFlight = 0, closed = false, completed = 0;
  return Object.freeze({
    plan,
    inspect: () => ({ inFlight, completed, callsInWindow: starts.filter(t => t > clock() - 60000).length, closed }),
    async close() { closed = true; await closeUpstreamHandlers(native); },
    async capture(kind, work, { signal } = {}) {
      need(['timeline', 'tile'].includes(kind), 'WEATHER_CAPTURE_KIND_INVALID');
      const request = requestsFor(work).find(value => value.kind === kind); need(request, 'WEATHER_REQUEST_NOT_SELECTED');
      if (plan.usage.expiresAt) need(clock() < Date.parse(plan.usage.expiresAt), 'WEATHER_LICENSE_EXPIRED');
      while (starts.length && starts[0] <= clock() - 60000) starts.shift();
      need(!closed, 'WEATHER_SOURCE_CLOSED'); need(inFlight < plan.maxInFlight, 'WEATHER_SOURCE_BUSY');
      need(starts.length < plan.maxCallsPerMinute, 'WEATHER_LOCAL_CALL_BUDGET');
      const startedAt = new Date(clock()).toISOString(); starts.push(clock()); inFlight++;
      try {
        const tile = request.tile;
        const context = { method: request.method, url: new URL(request.url), headers: {}, pathParams: tile ? {
          zoom: String(tile.zoom), x: String(tile.x), y: String(tile.y), field: tile.field, timeFile: tile.time + '.png',
        } : {}, bodyPresent: kind === 'timeline', ...(request.body ? { body: request.body } : {}), ...(signal ? { signal } : {}) };
        const response = proxyFetch ? await throughOriginalProxy(request, signal) : await native[kind === 'timeline' ? 'weatherTimeline' : 'weatherTile'](context);
        const bytes = response.body instanceof Uint8Array ? Buffer.from(response.body) : null;
        const observation = { kind, method: request.method, url: request.url, startedAt, receivedAt: new Date(clock()).toISOString(),
          status: response.status, upstreamStatus: response.body?.upstreamStatus ?? (response.status === 200 ? 200 : null),
          contentType: response.headers?.['content-type'] ?? null, retryAfter: response.headers?.['retry-after'] ?? null,
          transport: proxyFetch ? 'ORIGINAL_SF31_EXPLICIT_CONNECT' : 'ORIGINAL_SF30_UPSTREAM',
          quota: Object.fromEntries(Object.entries(response.headers ?? {}).filter(([name]) => /^(?:x-)?rate-?limit(?:-|$)/i.test(name))),
          bytes: bytes?.length ?? 0, sha256: bytes ? digest(bytes) : null };
        if (response.status !== 200) return { observation, error: response.body?.error ?? 'WEATHER_PROVIDER_RESPONSE_FAILED', bytes: null };
        try {
          need(bytes, 'WEATHER_PROVIDER_BYTES_REQUIRED');
          const interpreted = kind === 'timeline' ? readTimeline(bytes, request.body) : readPng(bytes, observation.contentType);
          return { observation, bytes, interpreted };
        } catch (error) {
          return { observation, bytes: null, error: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WEATHER_PROVIDER_SHAPE_INVALID' };
        }
      } finally { inFlight--; completed++; }
    },
  });
}
