// MIT. Standard Webhooks v1 HMAC over the original request bytes.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FeedError } from './model.mjs';

function header(headers, name) {
  const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new FeedError('INVALID_WEBHOOK_HEADERS', 401);
  return value;
}
function decodeSecret(value) {
  if (typeof value !== 'string') throw new FeedError('SOURCE_SECRET_UNAVAILABLE', 503);
  const encoded = value.startsWith('whsec_') ? value.slice(6) : value;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new FeedError('SOURCE_SECRET_UNAVAILABLE', 503);
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 24 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new FeedError('SOURCE_SECRET_UNAVAILABLE', 503);
  return key;
}
export function verifyStandardWebhook({ headers, rawBody, secret, now = Date.now(), toleranceSeconds = 300 }) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('Raw webhook body must be a Buffer');
  const eventId = header(headers, 'webhook-id'), timestamp = header(headers, 'webhook-timestamp'), signatures = header(headers, 'webhook-signature');
  if (!/^[\x21-\x7e]{1,256}$/.test(eventId) || !/^[0-9]{1,12}$/.test(timestamp)) throw new FeedError('INVALID_WEBHOOK_HEADERS', 401);
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) throw new FeedError('WEBHOOK_TIMESTAMP_EXPIRED', 401);
  const expected = createHmac('sha256', decodeSecret(secret)).update(eventId + '.' + timestamp + '.').update(rawBody).digest();
  let valid = false;
  for (const candidate of signatures.split(' ')) {
    if (!candidate.startsWith('v1,')) continue;
    const encoded = candidate.slice(3);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) continue;
    const received = Buffer.from(encoded, 'base64');
    if (received.length === expected.length) valid = timingSafeEqual(received, expected) || valid;
  }
  if (!valid) throw new FeedError('WEBHOOK_SIGNATURE_INVALID', 401);
  return { eventId, timestamp: seconds };
}
