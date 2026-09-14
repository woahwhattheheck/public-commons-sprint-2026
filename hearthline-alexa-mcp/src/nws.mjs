const NWS = 'https://api.weather.gov';

export const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_ALERT_ID_CHARS = 240;
const MAX_TIMESTAMP_CHARS = 80;

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeNullableText(value, max) {
  if (value == null) return null;
  const text = safeText(value, max);
  return text || null;
}

function assertCoordinate(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and between ${min} and ${max}`);
  }
}

function declaredContentLength(response) {
  const raw = response.headers?.get?.('content-length');
  if (raw == null || raw === '') return null;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) throw new Error('NWS response has invalid Content-Length');
  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) throw new Error('NWS response has invalid Content-Length');
  return value;
}

async function readBoundedBody(response, controller, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = declaredContentLength(response);
  if (declared != null && declared > maxBytes) {
    controller.abort('NWS response byte limit exceeded');
    throw new Error(`NWS response exceeds ${maxBytes} byte limit`);
  }

  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('NWS response body is not a readable stream');
  }

  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('NWS response body yielded non-byte data');
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort('NWS response byte limit exceeded');
        try { await reader.cancel('NWS response byte limit exceeded'); } catch { /* best-effort cancellation */ }
        throw new Error(`NWS response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock?.(); } catch { /* reader may already be detached */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedJson(response, controller) {
  const bytes = await readBoundedBody(response, controller);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('NWS response is not valid UTF-8');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('NWS response is not valid JSON');
  }
}

export async function fetchActiveAlerts({ latitude, longitude }, options = {}) {
  assertCoordinate(latitude, -90, 90, 'latitude');
  assertCoordinate(longitude, -180, 180, 'longitude');
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const url = `${NWS}/alerts/active?point=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': options.userAgent ?? 'HearthlineMCP/0.1 (hackathon-demo)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NWS alerts request failed with HTTP ${response.status}`);
    const body = await readBoundedJson(response, controller);
    if (!Array.isArray(body?.features)) throw new Error('NWS response missing features array');
    return body.features.slice(0, 20).map((feature) => {
      const p = feature?.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties)
        ? feature.properties
        : {};
      return {
        id: safeText(feature?.id ?? p.id ?? '', MAX_ALERT_ID_CHARS),
        event: safeText(p.event ?? 'Unknown alert', 160),
        severity: safeText(p.severity ?? 'Unknown', 40),
        urgency: safeText(p.urgency ?? 'Unknown', 40),
        headline: safeText(p.headline ?? p.event ?? 'Weather alert', 500),
        onset: safeNullableText(p.onset, MAX_TIMESTAMP_CHARS),
        expires: safeNullableText(p.expires, MAX_TIMESTAMP_CHARS),
        instruction: p.instruction == null ? null : safeNullableText(p.instruction, 2000),
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
