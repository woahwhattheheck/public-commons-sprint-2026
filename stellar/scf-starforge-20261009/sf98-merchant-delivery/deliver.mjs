// MIT. Explicit operator-side HMAC webhook drain for original SF98 paid events.
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { openOutbox } from './outbox.mjs';

const MAX_ATTEMPTS = 8;
const NOW = () => Date.now();
function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 || b === 88 && c === 99 || b === 0 && c === 2) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113 ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 192 && b === 0 && c === 2) return false;
  return true;
}
function publicIPv6(address) {
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase();
  // Only global unicast; reject IPv4-mapped, documentation and local ranges.
  const first = parseInt(value.split(':')[0] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !value.startsWith('2001:db8:') && value !== '2001:db8::';
}
export function publicAddress(address) {
  return publicIPv4(address) || publicIPv6(address);
}
export function validateDestination(raw, allowedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password ||
      url.search || url.hash || isIP(url.hostname) ||
      !/^[a-z0-9][a-z0-9.-]{2,252}$/i.test(url.hostname) ||
      !url.hostname.includes('.') || url.hostname.endsWith('.') ||
      url.hostname.includes('..') || url.pathname === '/' ||
      url.hostname.toLowerCase() !== allowedHost?.toLowerCase()) {
    throw new TypeError('Explicit public HTTPS webhook URL and exact --allow-host required');
  }
  return url;
}
export async function pinnedPublicLookup(hostname, resolver = lookup) {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || !records.length ||
      records.length > 16 || records.some(x => !publicAddress(x.address) || x.family !== isIP(x.address)))
    throw new Error('WEBHOOK_DESTINATION_DNS_NOT_PUBLIC');
  const first = records[0];
  return (name, options, done) => {
    if (name !== hostname) return done(new Error('WEBHOOK_HOST_MISMATCH'));
    if (options?.all) done(null, [{ address: first.address, family: first.family }]);
    else done(null, first.address, first.family);
  };
}
export async function sendSignedWebhook({ event, url, allowedHost, secret,
  resolver = lookup, transport = request, clock = NOW }) {
  const endpoint = validateDestination(url, allowedHost);
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024)
    throw new Error('A private operator HMAC secret of 32-1024 bytes is required');
  const dnsLookup = await pinnedPublicLookup(endpoint.hostname, resolver);
  // Minimal message: no payment header, transaction hash, signer, wallet, buyer request or response body.
  const payload = JSON.stringify({
    schema: 'stellar-forge.sf98.webhook.v1',
    eventId: event.id, occurredAt: event.at,
    routeId: event.routeId, method: event.method,
    network: event.network, amountAtomic: event.amountAtomic,
    assetDigest: event.assetDigest, orderReference: event.orderReference,
    settlement: 'ORIGINAL_NATIVE_SUCCESS',
  });
  const timestamp = String(Math.floor(clock() / 1000));
  const digest = createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
  return await new Promise((resolve, reject) => {
    const call = transport(endpoint, {
      method: 'POST', agent: false, lookup: dnsLookup, timeout: 7000,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        'idempotency-key': event.id,
        'x-sf98-timestamp': timestamp,
        'x-sf98-signature': 'sha256=' + digest,
        'user-agent': 'sf98-native-merchant-delivery/1',
      },
    }, response => {
      const code = response.statusCode || 0;
      response.resume();
      resolve({ ok: code >= 200 && code < 300, httpStatus: code });
    });
    call.on('timeout', () => call.destroy(new Error('WEBHOOK_TIMEOUT')));
    call.on('error', reject);
    call.end(payload);
  });
}
export async function drainOnce(outbox, options) {
  const { url, allowedHost, secret, send = sendSignedWebhook,
    clock = NOW, limit = 10 } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Limit must be 1-100');
  validateDestination(url, allowedHost);
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32)
    throw new Error('WEBHOOK_SECRET_NOT_SET');
  const rows = await outbox.rows();
  let delivered = 0, attempted = 0, skipped = 0, exhausted = 0;
  for (const row of rows) {
    if (attempted >= limit) break;
    const prior = row.state;
    if (prior?.state === 'DELIVERED' || prior?.state === 'EXHAUSTED' ||
        prior?.state === 'RETRY' && Date.parse(prior.nextAt) > clock()) {
      skipped++; continue;
    }
    const attempt = (prior?.attempt ?? 0) + 1;
    let result;
    try { result = await send({ event: row.event, url, allowedHost, secret, clock }); }
    catch { result = { ok: false, httpStatus: null }; }
    const status = result.ok ? 'DELIVERED' : attempt >= MAX_ATTEMPTS ? 'EXHAUSTED' : 'RETRY';
    const delayMs = Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** (attempt - 1));
    const nextAt = status === 'RETRY' ? new Date(clock() + delayMs).toISOString() : null;
    await outbox.recordDelivery({
      id: row.event.id, state: status, attempt, at: new Date(clock()).toISOString(),
      httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null, nextAt,
    });
    attempted++;
    if (status === 'DELIVERED') delivered++;
    if (status === 'EXHAUSTED') exhausted++;
  }
  return { ...await outbox.status(), attemptThisRun: attempted,
    deliveredThisRun: delivered, exhaustedThisRun: exhausted, skippedThisRun: skipped };
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!['status', 'drain', 'requeue'].includes(command)) {
    throw new Error('Usage: deliver.mjs status|drain|requeue --state /private/outbox [--url https://merchant.example/webhook --allow-host merchant.example --secret-env SF98_WEBHOOK_SECRET --limit 10] [--id SHA256]');
  }
  if (rest.length % 2) throw new TypeError('Option requires value');
  const opts = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--state', '--url', '--allow-host', '--secret-env', '--limit', '--id'].includes(rest[i]) ||
        opts.has(rest[i])) throw new TypeError('Invalid or duplicate option: ' + rest[i]);
    opts.set(rest[i], rest[i + 1]);
  }
  if (!opts.has('--state')) throw new Error('--state is required');
  const outbox = await openOutbox(opts.get('--state'));
  let result;
  if (command === 'status') result = await outbox.status();
  if (command === 'requeue') {
    await outbox.requeue(opts.get('--id'));
    result = await outbox.status();
  }
  if (command === 'drain') {
    const secretName = opts.get('--secret-env') || 'SF98_WEBHOOK_SECRET';
    if (!/^[A-Z][A-Z0-9_]{1,64}$/.test(secretName)) throw new TypeError('Invalid secret env name');
    const rawLimit = opts.get('--limit') || '10';
    if (!/^[1-9][0-9]{0,2}$/.test(rawLimit)) throw new TypeError('Invalid limit');
    result = await drainOnce(outbox, {
      url: opts.get('--url'), allowedHost: opts.get('--allow-host'),
      secret: process.env[secretName], limit: Number(rawLimit),
    });
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch(e => { process.stderr.write(String(e?.message ?? e) + '\n'); process.exitCode = 1; });
}
