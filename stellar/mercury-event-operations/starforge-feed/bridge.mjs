// MIT. Native Mercury HTTP delivery into the original retained Starforge feed.
import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FeedError, isRecord, parseEventPayload, requireId } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/model.mjs';
import { readRequestBody, sendJson } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/receiver.mjs';

export const BRIDGE_SCHEMA = 'stellar-forge.mercury-feed-bridge.v1';
export const SOURCE_KEY_ENV = 'MERCURY_STARFORGE_FEED_KEY';
export const HMAC_ENV = 'MERCURY_STARFORGE_HMAC';
export const TOKEN_ENV = 'MERCURY_STARFORGE_TOKEN';
export const DELIVERY_PATH = '/events/mercury';
const HEX = /^[a-f0-9]{64}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const sha = value => createHash('sha256').update(value).digest('hex');

function header(headers, name) {
  const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new FeedError('INVALID_MERCURY_HEADERS', 401);
  return value;
}
function equal(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function configuredSecret(resolveSecret, name) {
  if (!ENV.test(name ?? '')) throw new FeedError('INVALID_CREDENTIAL_VARIABLE', 422);
  const secret = resolveSecret(name);
  if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret)) throw new FeedError('BRIDGE_CREDENTIAL_UNAVAILABLE', 503, { variable: name });
  return secret;
}
export function validateMercuryScope(scope, { allowLocalProvider = false } = {}) {
  if (!isRecord(scope) || Object.keys(scope).some(key => !['network', 'provider_scope', 'provider_base', 'contracts'].includes(key)) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(scope.network ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(scope.provider_scope ?? '') ||
      typeof scope.provider_base !== 'string' || /[\x00-\x20\x7f]/.test(scope.provider_base) ||
      !Array.isArray(scope.contracts) || !scope.contracts.length || scope.contracts.length > 1000 ||
      scope.contracts.some(contract => !CONTRACT.test(contract)) || new Set(scope.contracts).size !== scope.contracts.length)
    throw new FeedError('INVALID_MERCURY_SCOPE', 422);
  let provider;
  try { provider = new URL(scope.provider_base); } catch { throw new FeedError('INVALID_MERCURY_PROVIDER', 422); }
  if (provider.username || provider.password || provider.search || provider.hash ||
      provider.protocol !== 'https:' && !(allowLocalProvider && provider.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(provider.hostname)))
    throw new FeedError('INVALID_MERCURY_PROVIDER', 422);
  return { network: scope.network, provider_scope: scope.provider_scope,
    provider_base: scope.provider_base.replace(/\/+$/, ''), contracts: [...scope.contracts].sort() };
}

/** Matches mercury_ops.delivery.deliver_http: a plain UTF-8 secret signs raw bytes.
 * Source authentication is checked before JSON is parsed or private feed state changes. */
export function verifyMercuryDelivery({ headers, rawBody, scope, signingSecret, bearerToken }) {
  if (!Buffer.isBuffer(rawBody) || !rawBody.length) throw new FeedError('EVENT_BODY_REQUIRED', 422);
  if (typeof signingSecret !== 'string' || !signingSecret || typeof bearerToken !== 'string' || !bearerToken)
    throw new FeedError('BRIDGE_CREDENTIAL_UNAVAILABLE', 503);
  const eventId = header(headers, 'idempotency-key'), suppliedDigest = header(headers, 'x-mercury-ops-payload-sha256');
  const signature = header(headers, 'x-mercury-ops-signature'), authorization = header(headers, 'authorization');
  if (!HEX.test(eventId) || !HEX.test(suppliedDigest) || !HEX.test(signature) ||
      !equal(authorization, 'Bearer ' + bearerToken)) throw new FeedError('MERCURY_AUTHENTICATION_FAILED', 401);
  const bodySha256 = sha(rawBody), expected = createHmac('sha256', Buffer.from(signingSecret, 'utf8')).update(rawBody).digest('hex');
  if (!equal(expected, signature) || !equal(bodySha256, suppliedDigest)) throw new FeedError('MERCURY_SIGNATURE_INVALID', 401);
  let event;
  try { event = parseEventPayload(rawBody); }
  catch (error) { if (error instanceof FeedError) throw error; throw new FeedError('INVALID_MERCURY_JSON', 422); }
  if (!isRecord(event) || event.schema !== 'mercury-ops.event.v1' || event.event_id !== eventId || !isRecord(event.canonical))
    throw new FeedError('INVALID_MERCURY_ENVELOPE', 422);
  for (const field of ['network', 'provider_scope', 'provider_base'])
    if (event[field] !== scope[field]) throw new FeedError('MERCURY_SCOPE_MISMATCH', 409, { field });
  if (!scope.contracts.includes(event.canonical.contract_id)) throw new FeedError('MERCURY_CONTRACT_OUTSIDE_SCOPE', 409);
  // The original engine builds the event identity from these exact sorted scope
  // fields and the documented signed 32-bit canonical row ID.
  const rowId = event.provider_row_id;
  if (!Number.isInteger(rowId) || rowId < -2147483648 || rowId > 2147483647 || event.canonical.id !== rowId)
    throw new FeedError('MERCURY_ROW_ID_MISMATCH', 422);
  const identity = { network: event.network, provider_base: event.provider_base, provider_row_id: rowId, provider_scope: event.provider_scope };
  if (sha(JSON.stringify(identity)) !== eventId) throw new FeedError('MERCURY_EVENT_ID_MISMATCH', 409);
  return { eventId, bodySha256, event };
}

export async function startMercuryFeedBridge({ store, sourceId, scope, port = 8494,
  tokenEnv = TOKEN_ENV, hmacSecretEnv = HMAC_ENV, sourceKeyEnv = SOURCE_KEY_ENV,
  secretResolver = name => process.env[name], allowLocalProvider = false } = {}) {
  if (!store || !Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Existing event store and valid port required');
  requireId(sourceId);
  const selected = validateMercuryScope(scope, { allowLocalProvider });
  for (const name of [tokenEnv, hmacSecretEnv, sourceKeyEnv]) configuredSecret(secretResolver, name);
  const source = () => {
    const value = store.definition('source', sourceId, { enabled: true });
    if (value.typePointer !== '/canonical/contract_id' || value.occurredAtPointer !== null || value.secretEnv !== sourceKeyEnv)
      throw new FeedError('BRIDGE_SOURCE_CHANGED', 409);
    return value;
  };
  source();
  let inFlight = 0, closing;
  const server = createServer((request, response) => {
    (async () => {
      if (request.method === 'GET' && request.url === '/_mercury-feed/ready') {
        source();
        for (const name of [tokenEnv, hmacSecretEnv, sourceKeyEnv]) configuredSecret(secretResolver, name);
        return sendJson(response, 200, { schema: BRIDGE_SCHEMA, ready: true });
      }
      if (request.url !== DELIVERY_PATH) throw new FeedError('NOT_FOUND', 404);
      if (request.method !== 'POST') throw new FeedError('POST_REQUIRED', 405);
      if (inFlight >= 32) { request.resume(); return sendJson(response, 429, { error: 'BRIDGE_BUSY' }, { 'retry-after': '1' }); }
      inFlight++;
      try {
        const active = source();
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding'])
          throw new FeedError('RAW_JSON_REQUIRED', 415);
        for (const name of ['authorization', 'idempotency-key', 'x-mercury-ops-payload-sha256', 'x-mercury-ops-signature']) {
          let count = 0;
          for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index].toLowerCase() === name) count++;
          if (count !== 1) throw new FeedError('INVALID_MERCURY_HEADERS', 401);
        }
        const rawBody = await readRequestBody(request, active.maxEventBytes);
        const accepted = verifyMercuryDelivery({ headers: request.headers, rawBody, scope: selected,
          signingSecret: configuredSecret(secretResolver, hmacSecretEnv), bearerToken: configuredSecret(secretResolver, tokenEnv) });
        if (source().revision !== active.revision) throw new FeedError('BRIDGE_SOURCE_CHANGED', 409);
        const secret = configuredSecret(secretResolver, sourceKeyEnv);
        const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
        const timestamp = String(Math.floor(store.now() / 1000));
        const signature = createHmac('sha256', key).update(accepted.eventId + '.' + timestamp + '.').update(rawBody).digest('base64');
        const receipt = store.acceptWebhook(sourceId, {
          'webhook-id': accepted.eventId, 'webhook-timestamp': timestamp, 'webhook-signature': 'v1,' + signature,
        }, rawBody);
        sendJson(response, 200, { schema: 'stellar-forge.mercury-feed-ack.v1',
          storeId: receipt.storeId, sourceId, eventId: receipt.eventId, sequence: receipt.sequence,
          sourceBodySha256: receipt.sourceBodySha256, duplicate: receipt.duplicate, retained: receipt.retained });
      } finally { inFlight--; }
    })().catch(error => {
      request.resume();
      if (response.headersSent) return response.destroy();
      const known = error instanceof FeedError, status = known ? error.status : 503;
      sendJson(response, status, { error: known ? error.code : 'MERCURY_FEED_UNAVAILABLE', ...(known ? error.details : {}) },
        status >= 500 ? { 'retry-after': '1' } : {});
    });
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, url: origin + DELIVERY_PATH, scope: selected,
    close: () => closing ??= new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections(); }) };
}
