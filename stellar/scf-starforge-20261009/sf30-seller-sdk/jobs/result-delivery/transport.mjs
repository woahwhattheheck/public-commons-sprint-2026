// MIT. Signed whole-result POST, original SF98 HTTPS/DNS selection, and exact receiver acknowledgment.
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { pinnedPublicLookup, validateDestination } from '../../../sf98-merchant-delivery/deliver.mjs';
import { createSignatureHmac, signManifest, digest, manifestHeaderFor, validateAcknowledgment,
  validateManifest, validateSecret, deliveryError } from './wire.mjs';
function interruptible(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? deliveryError('JRD_SEND_CANCELLED'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function retryAfter(value, now) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const milliseconds = /^[0-9]{1,10}$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > now && milliseconds <= 8640000000000000 ? new Date(milliseconds).toISOString() : null;
}
/** A custom resolver/transport is an embedding seam. The default route sends only to the configured public HTTPS endpoint. */
export async function sendSignedResult({ manifest, body, allowedHost, secret, signal,
  timeoutMs = 15000, resolver = lookup, transport = request, clock = Date.now } = {}) {
  const value = validateManifest(manifest), endpoint = validateDestination(value.destination.url, allowedHost);
  validateSecret(secret);
  if (!Buffer.isBuffer(body) || body.length !== value.result.bytes || digest(body) !== value.result.sha256) throw deliveryError('JRD_ORIGINAL_RESULT_CHANGED', 409);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw deliveryError('JRD_TIMEOUT_INVALID');
  const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  attemptSignal.throwIfAborted();
  const dnsLookup = await interruptible(pinnedPublicLookup(endpoint.hostname, resolver), attemptSignal);
  attemptSignal.throwIfAborted();
  const manifestHeader = manifestHeaderFor(value), timestamp = String(Math.floor(clock() / 1000));
  const signature = createSignatureHmac(secret, timestamp, manifestHeader).update(body).digest('hex');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; if (error) reject(error); else resolve(result); };
    const call = transport(endpoint, { method: 'POST', agent: false, lookup: dnsLookup, timeout: timeoutMs, signal: attemptSignal, headers: {
      'content-type': value.result.contentType, 'content-length': String(body.length), accept: 'application/json', 'accept-encoding': 'identity',
      'idempotency-key': value.deliveryId, 'x-content-sha256': value.result.sha256, 'x-sfjobs-manifest': manifestHeader, 'x-sfjobs-timestamp': timestamp,
      'x-sfjobs-manifest-signature': signManifest(secret, timestamp, manifestHeader),
      'x-sfjobs-signature': 'sha256=' + signature, 'user-agent': 'starforge-job-result-delivery/1',
    } }, response => {
      const httpStatus = response.statusCode ?? 0;
      const base = { httpStatus, retryAfter: retryAfter(response.headers['retry-after'], clock()) };
      if (httpStatus < 200 || httpStatus >= 300) { response.destroy(); finish(null, { ...base, ok: false, code: 'JRD_HTTP_REJECTED' }); return; }
      if (!/^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') ||
          response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); finish(null, { ...base, ok: false, code: 'JRD_ACKNOWLEDGMENT_INVALID' }); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) { response.destroy(); finish(null, { ...base, ok: false, code: 'JRD_ACKNOWLEDGMENT_TOO_LARGE' }); }
        else chunks.push(chunk);
      });
      response.on('error', () => finish(null, { ...base, ok: false, code: 'JRD_ACKNOWLEDGMENT_INTERRUPTED' }));
      response.on('aborted', () => finish(null, { ...base, ok: false, code: 'JRD_ACKNOWLEDGMENT_INTERRUPTED' }));
      response.on('end', () => {
        try {
          if (!response.complete) throw deliveryError('JRD_ACKNOWLEDGMENT_INTERRUPTED');
          const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          const receipt = validateAcknowledgment(raw, value); finish(null, { ...base, ok: true, receipt });
        } catch (error) { finish(null, { ...base, ok: false, code: /^JRD_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JRD_ACKNOWLEDGMENT_INVALID' }); }
      });
    });
    call.once('timeout', () => call.destroy(deliveryError('JRD_SEND_TIMEOUT', 503)));
    call.once('error', error => finish(error)); call.end(body);
  });
}
