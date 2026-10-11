// MIT. Source-native challenge-only operator acceptance for Tatum's original SF30 paid routes.
// No paid requests, payment credentials, upstream Tatum traffic or transaction calls.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node accept.mjs --seller http://127.0.0.1:PORT --config PRIVATE_SELLER_CONFIG';
async function jsonGet(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'error',
    signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (response.status !== 200) throw new Error('Original SF30 metadata request failed');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 131072) throw new Error('Metadata response too large');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function main(argv = process.argv.slice(2)) {
  const supplied = new Map();
  if (argv.length !== 4) throw new TypeError(USAGE);
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--seller', '--config'].includes(argv[i]) || supplied.has(argv[i]))
      throw new TypeError(USAGE);
    supplied.set(argv[i], argv[i + 1]);
  }
  const origin = new URL(supplied.get('--seller'));
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/' || !origin.port) throw new TypeError('Seller must be a loopback origin');
  const config = JSON.parse(await readFile(supplied.get('--config'), 'utf8'));
  if (config.schema !== 'stellar-forge.seller-service.v1' ||
      !Array.isArray(config.routes) || config.routes.length !== 3) {
    throw new TypeError('Expected original three-route pilot config');
  }
  const health = await jsonGet(origin + '_seller/health');
  const offers = await jsonGet(origin + '_seller/offers');
  if (health.schema !== config.schema || health.mode !== 'CHALLENGE_ONLY' ||
      !Array.isArray(health.routes) || health.routes.length !== 3 ||
      !Array.isArray(offers) || offers.length !== 3) {
    throw new Error('Original SF30 seller is not the matching challenge-only pilot');
  }
  const expected = new Map(config.routes.map(x => [x.id, x]));
  const checked = [];
  for (let index = 0; index < health.routes.length; index++) {
    const runtime = health.routes[index], offer = offers[index], route = expected.get(runtime.id);
    if (!route || !offer || runtime.method !== 'GET' || runtime.admission !== false ||
        offer.resource?.url !== runtime.url || offer.x402Version !== 2 ||
        offer.extensions?.bazaar?.info?.input?.method !== 'GET' ||
        !Array.isArray(offer.accepts) || offer.accepts.length !== 1) {
      throw new Error('Original seller route metadata differs from source config');
    }
    const terms = offer.accepts[0], wanted = route.definition.payment;
    for (const field of ['scheme', 'network', 'asset', 'payTo', 'amount']) {
      if (terms[field] !== wanted[field]) throw new Error('Original payment terms differ: ' + field);
    }
    if (terms.network !== 'stellar:testnet') throw new Error('Original offer changed network');
    const response = await fetch(origin + route.path.slice(1), { method: 'GET',
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status !== 402 || !response.headers.get('payment-required')) {
      throw new Error('Original seller did not challenge a payment-free GET: ' + runtime.id);
    }
    await response.body?.cancel();
    checked.push({ routeId: runtime.id, status: 402, network: terms.network });
  }
  console.log(JSON.stringify({ status: 'PASS', source: 'ORIGINAL_SF30_CHALLENGE_ONLY',
    routes: checked, originalOfferCount: offers.length, upstreamCalls: 0, payments: 0 }));
  return checked;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
