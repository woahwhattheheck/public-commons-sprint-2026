// MIT. Weather response interpretation and original SF30/SF31 provider transport.
import { createUpstreamHandlers, closeUpstreamHandlers } from '../upstream.mjs';
import { compileWeatherPlan, API_ORIGIN, fixedTime, object, need, fail, requestsFor, weatherRequestVariants } from './config.mjs';
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

/** Preserve a bounded provider failure independently of JSON and stream cleanup. */
export async function readProviderError(response, { apiKey } = {}) {
  const safe = (value, limit = 1200) => {
    if (!['string', 'number'].includes(typeof value)) return null;
    let text = String(value);
    if (apiKey) for (const secret of new Set([apiKey, encodeURIComponent(apiKey), JSON.stringify(apiKey).slice(1, -1)]))
      if (secret) text = text.replaceAll(secret, '[redacted]');
    text = text.replace(/([?&](?:apikey|api_key|access_token|token)=)[^&\s"'<>]*/gi, '$1[redacted]')
      .replace(/("(?:apikey|api_key|access_token|authorization)"\s*:\s*")[^"]*/gi, '$1[redacted]')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/=-]+/gi, '$1[redacted]');
    return text.slice(0, limit);
  };
  const limit = 65536, chunks = [];
  let observedBytes = 0, retainedBytes = 0, truncated = false, reader;
  let bodyState = response.body ? 'COMPLETE' : 'ABSENT', readError = null;
  try {
    reader = response.body?.getReader();
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = Buffer.from(value); observedBytes += chunk.length;
      const part = chunk.subarray(0, Math.max(0, limit - retainedBytes));
      if (part.length) { chunks.push(part); retainedBytes += part.length; }
      if (observedBytes > limit) { truncated = true; bodyState = 'TRUNCATED'; break; }
    }
  } catch (error) {
    bodyState = 'READ_FAILED';
    readError = { code: safe(error.code ?? error.name), message: safe(error.message, 400) };
  } finally {
    if (reader) {
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  }
  const bytes = Buffer.concat(chunks, retainedBytes);
  let text = '', parsed = null, parseState = bytes.length ? 'TEXT' : 'EMPTY';
  if (bytes.length) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = bytes.toString('utf8'); parseState = 'INVALID_UTF8'; }
    if (parseState !== 'INVALID_UTF8') try { parsed = JSON.parse(text); parseState = 'JSON'; } catch {}
  }
  const normalize = value => object(value)
    ? { code: safe(value.code), type: safe(value.type), message: safe(value.message ?? value.detail ?? value.description) }
    : { code: null, type: null, message: safe(value) };
  const errors = (Array.isArray(parsed) ? parsed : Array.isArray(parsed?.errors) ? parsed.errors : [])
    .slice(0, 5).map(normalize);
  const nested = object(parsed?.error) ? parsed.error : null;
  const providerError = {
    code: safe(parsed?.code ?? nested?.code ?? errors[0]?.code),
    type: safe(parsed?.type ?? nested?.type ?? errors[0]?.type),
    message: safe(parsed?.message ?? nested?.message ?? parsed?.detail ?? parsed?.error ?? errors[0]?.message ?? (typeof parsed === 'string' ? parsed : null) ?? (parseState === 'TEXT' ? text : null)),
    ...(errors.length ? { errors } : {}),
  };
  const headerNames = ['content-type', 'content-length', 'content-encoding', 'x-request-id', 'x-correlation-id', 'cf-ray'];
  const providerDiagnostic = { bodyState, observedBytes, retainedBytes, bodySha256: digest(bytes),
    truncated, parseState, text: safe(text, 4096), readError,
    headers: Object.fromEntries(headerNames.flatMap(name => response.headers.has(name) ? [[name, safe(response.headers.get(name), 300)]] : [])) };
  return { providerError, providerDiagnostic };
}

export function createTomorrowSource(raw, { env = process.env, lookup, clock = Date.now } = {}) {
  const plan = compileWeatherPlan(raw), licensed = plan.usage.mode === 'licensed-service';
  const responseHeaders = ['content-type'];
  const common = { origin: API_ORIGIN, responseHeaders, timeoutMs: plan.timeoutMs,
    maxResponseBytes: plan.maxResponseBytes, maxInFlight: plan.maxInFlight,
    ...(licensed ? { headerEnv: { apikey: plan.apiKeyEnv } } : {}) };
  const native = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    weatherTimeline: { ...common, path: '/v4/timelines', method: 'POST', bodyType: 'json', responseMode: 'json' },
  } }, { env, ...(lookup ? { lookup } : {}) });
  const publicFetch = createPublicHttpsFetch({ timeoutMs: plan.timeoutMs,
    ...(plan.transport ? { trustedProxy: plan.transport } : {}), ...(lookup ? { lookup } : {}) });
  async function throughOriginalTransport(request, signal) {
    const response = await publicFetch(request.url, { method: request.method, redirect: 'manual', signal,
      headers: { accept: request.kind === 'tile' ? 'image/png' : 'application/json',
        ...(request.body ? { 'content-type': 'application/json' } : {}), ...(licensed ? { apikey: env[plan.apiKeyEnv] } : {}) },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}) });
    const headers = Object.fromEntries([...response.headers].filter(([name]) => name === 'content-type' || name === 'retry-after' || /^(?:x-)?rate-?limit(?:-|$)/i.test(name)));
    if (response.status !== 200) {
      const failure = await readProviderError(response, { apiKey: licensed ? env[plan.apiKeyEnv] : undefined });
      return { status: response.status, headers, body: { error: 'WEATHER_PROVIDER_HTTP_STATUS',
        upstreamStatus: response.status, ...failure } };
    }
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
    async capture(kind, work, { signal, request: selectedRequest } = {}) {
      need(['timeline', 'tile'].includes(kind), 'WEATHER_CAPTURE_KIND_INVALID');
      const originalRequest = requestsFor(work).find(value => value.kind === kind); need(originalRequest, 'WEATHER_REQUEST_NOT_SELECTED');
      const request = selectedRequest ?? originalRequest;
      const allowed = weatherRequestVariants(work).flat().filter(value => value.kind === kind);
      need(allowed.some(value => JSON.stringify(value) === JSON.stringify(request)), 'WEATHER_REQUEST_CHANGED');
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
        const usePublicTransport = !!plan.transport || kind === 'tile';
        const response = usePublicTransport ? await throughOriginalTransport(request, signal) : await native.weatherTimeline(context);
        const bytes = response.body instanceof Uint8Array ? Buffer.from(response.body) : null;
        const observation = { kind, method: request.method, url: request.url, startedAt, receivedAt: new Date(clock()).toISOString(),
          status: response.status, upstreamStatus: response.body?.upstreamStatus ?? (response.status === 200 ? 200 : null),
          providerError: response.body?.providerError ?? null,
          providerDiagnostic: response.body?.providerDiagnostic ?? null,
          contentType: response.headers?.['content-type'] ?? null, retryAfter: response.headers?.['retry-after'] ?? null,
          transport: usePublicTransport ? (plan.transport ? 'ORIGINAL_SF31_EXPLICIT_CONNECT' : 'ORIGINAL_SF31_PUBLIC_HTTPS') : 'ORIGINAL_SF30_UPSTREAM',
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
