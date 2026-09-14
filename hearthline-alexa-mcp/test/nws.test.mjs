import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchActiveAlerts, MAX_RESPONSE_BYTES } from '../src/nws.mjs';

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/geo+json', ...headers },
  });
}

test('NWS provider bounds and sanitizes every retained alert string', async () => {
  const hugeId = `alert\u0000-${'x'.repeat(400)}`;
  const hugeOnset = `2026-09-13T10:00:00Z\u0007-${'o'.repeat(100)}`;
  const hugeExpires = `2026-09-13T11:00:00Z\n${'e'.repeat(100)}`;
  const features = Array.from({ length: 25 }, (_, index) => ({
    id: index === 0 ? hugeId : `alert-${index}`,
    properties: {
      event: index === 0 ? 'Flood\u0000 Warning' : 'Flood Warning',
      severity: 'Severe',
      urgency: 'Immediate',
      headline: index === 0 ? 'Line\nBreak' : 'Flood warning',
      onset: index === 0 ? hugeOnset : null,
      expires: index === 0 ? hugeExpires : null,
      instruction: index === 0 ? 'Do this\u0007 now' : null,
    },
  }));
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /api\.weather\.gov\/alerts\/active\?point=/);
    assert.match(options.headers['User-Agent'], /HearthlineMCP/);
    return jsonResponse({ features });
  };

  const alerts = await fetchActiveAlerts({ latitude: 38.2, longitude: -85.7 }, { fetchImpl });
  assert.equal(alerts.length, 20);
  assert.equal(alerts[0].event, 'Flood Warning');
  assert.equal(alerts[0].headline, 'Line Break');
  assert.equal(alerts[0].instruction, 'Do this now');
  assert.ok(alerts[0].id.length <= 240);
  assert.ok(alerts[0].onset.length <= 80);
  assert.ok(alerts[0].expires.length <= 80);
  for (const value of [alerts[0].id, alerts[0].onset, alerts[0].expires]) {
    assert.doesNotMatch(value, /[\u0000-\u001F\u007F-\u009F]/);
  }
  assert.equal(alerts[1].onset, null);
  assert.equal(alerts[1].expires, null);
});

test('NWS provider rejects oversized declared Content-Length before body access and aborts transport', async () => {
  let bodyAccessed = false;
  let signal;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
    get body() {
      bodyAccessed = true;
      throw new Error('body must not be accessed');
    },
  };

  await assert.rejects(
    () => fetchActiveAlerts(
      { latitude: 38.2, longitude: -85.7 },
      { fetchImpl: async (_url, options) => { signal = options.signal; return response; } },
    ),
    /byte limit/,
  );
  assert.equal(bodyAccessed, false);
  assert.equal(signal.aborted, true);
});

test('NWS provider cancels and aborts an undeclared stream as soon as byte cap is crossed', async () => {
  let reads = 0;
  let cancelled = false;
  let released = false;
  let signal;
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            if (reads <= 9) return { done: false, value: chunk };
            return { done: true, value: undefined };
          },
          async cancel() { cancelled = true; },
          releaseLock() { released = true; },
        };
      },
    },
  };

  await assert.rejects(
    () => fetchActiveAlerts(
      { latitude: 38.2, longitude: -85.7 },
      { fetchImpl: async (_url, options) => { signal = options.signal; return response; } },
    ),
    /byte limit/,
  );
  assert.equal(reads, 9);
  assert.equal(cancelled, true);
  assert.equal(released, true);
  assert.equal(signal.aborted, true);
});

test('NWS provider rejects invalid coordinates before network access', async () => {
  let called = false;
  await assert.rejects(
    () => fetchActiveAlerts(
      { latitude: 100, longitude: 0 },
      { fetchImpl: async () => { called = true; } },
    ),
    /latitude/,
  );
  assert.equal(called, false);
});
