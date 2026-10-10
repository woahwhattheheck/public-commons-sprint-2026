// MIT. SF-44 public developer onboarding for the genuine PR451 BazaarCatalog implementation.
// No wallet, payment, settlement, seller verification, grant application or mainnet IO.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BazaarCatalog, createDiscoveryServer } from '../../../scf46-stellar-bazaar/src/catalog.mjs';

const upstream = new URL('../../../scf46-stellar-bazaar/src/catalog.mjs', import.meta.url);
const PINNED_SOURCE_BLOB = '0f95a2f3c95d10ef6e8410d10f2ba24a7c9a44de';

export async function sourceProvenance() {
  const bytes = await readFile(upstream);
  const blobSha = createHash('sha1').update('blob ' + bytes.byteLength + '\0').update(bytes).digest('hex');
  return { actualGitBlob: blobSha, baselineGitBlob: PINNED_SOURCE_BLOB, baselineMatches: blobSha === PINNED_SOURCE_BLOB };
}

export function developmentOnlyRecord() {
  // Developer-only local fixture, not a validated registration. Deliberately invalid recipient.
  return {
    resource: {
      url: 'https://example.org/sf44/weather',
      serviceName: 'Dev Forecast Sample',
      tags: ['weather', 'forecast'],
      description: 'Example weather forecast endpoint; not a commercial paid service'
    },
    accepts: [{ network: 'stellar:testnet', scheme: 'exact', payTo: 'INVALID_DEMO_RECIPIENT_NOT_A_WALLET',
      asset: 'NONPAYABLE_DEMO_ASSET', amount: '10000' }],
    extensions: {
      bazaar: {
        info: {
          input: { type: 'http', method: 'GET', description: 'Fetch a forecast for an example city' },
          output: { type: 'json' }
        },
        schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
      }
    }
  };
}

export async function startLocalDevelopmentCatalog() {
  // Fixture seed ONLY in this isolated LOCAL demonstration process. Production
  // must independently verify settlement, seller identity, payTo binding and
  // full Bazaar JSON Schema before calling the trusted-only insertValidated hook.
  const catalog = new BazaarCatalog();
  catalog.insertValidated(developmentOnlyRecord());
  const server = createServer(createDiscoveryServer(catalog));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port,
    catalog,
    async close() { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
  };
}

async function getJson(url) {
  const start = performance.now();
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (!response.ok) throw new Error('Discovery status ' + response.status + ': ' + (body.error || 'unknown'));
  return { status: response.status, elapsedMs: Math.round((performance.now() - start) * 1000) / 1000, body };
}

export async function inspectLocalDiscovery(baseUrl, { query = 'weather', network = 'stellar:testnet' } = {}) {
  // This starter probes only explicit loopback and never loads wallet material.
  const root = new URL(baseUrl);
  if (root.protocol !== 'http:' || root.hostname !== '127.0.0.1' || root.username ||
      root.password || root.pathname !== '/' || root.search || root.hash)
    throw new TypeError('This starter only probes http://127.0.0.1:<port>/');
  if (!Number.isInteger(Number(root.port)) || Number(root.port) < 1)
    throw new TypeError('Explicit loopback port required');
  if (typeof query !== 'string' || !query.trim() || query.length > 1024)
    throw new TypeError('Valid discovery query required');
  if (!['stellar:testnet', 'stellar:pubnet'].includes(network))
    throw new TypeError('Explicit supported Stellar network required');
  const listUrl = new URL('/discovery/resources', root);
  listUrl.searchParams.set('type', 'http');
  listUrl.searchParams.set('network', network);
  const searchUrl = new URL('/discovery/search', root);
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('network', network);
  const [listing, search] = await Promise.all([getJson(listUrl), getJson(searchUrl)]);
  if (!Array.isArray(listing.body.resources) || !Array.isArray(search.body.resources))
    throw new TypeError('Unexpected Bazaar response shape');
  const candidates = search.body.resources.map(row => {
    const terms = (Array.isArray(row.accepts) ? row.accepts : [])
      .filter(accept => accept?.network === network && accept.scheme === 'exact')
      .map(accept => ({ network: accept.network, scheme: accept.scheme, payTo: accept.payTo }));
    return {
      resourceUrl: row.resource?.url,
      routeType: row.extensions?.bazaar?.info?.input?.type,
      matchingPaymentTerms: terms,
      disposition: terms.length
        ? 'REQUIRES_SEPARATE_SELLER_PROOF_AND_WALLET_AUTHORIZATION'
        : 'DECLINE_UNSUPPORTED_PAYMENT_TERMS'
    };
  });
  return {
    mode: 'LOOPBACK_DISCOVERY_ONLY',
    actualHttpRequests: 2,
    status: [listing.status, search.status],
    requestMs: { list: listing.elapsedMs, search: search.elapsedMs },
    listCount: listing.body.resources.length,
    searchCount: search.body.resources.length,
    candidates,
    buyerAutoPayment: false,
    settlementReceipt: null,
    payableEndpointDemonstrated: false
  };
}

export async function runLocalOnboarding() {
  const started = performance.now();
  const demo = await startLocalDevelopmentCatalog();
  try {
    const observation = await inspectLocalDiscovery(demo.baseUrl);
    return {
      ...observation,
      source: await sourceProvenance(),
      elapsedMsToFirstDiscoverableFixture: Math.round((performance.now() - started) * 1000) / 1000,
      elapsedMsToFirstPaidEndpoint: null,
      environment: { node: process.version, origin: demo.baseUrl, fixture: true }
    };
  } finally { await demo.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'serve') {
    startLocalDevelopmentCatalog().then(demo => {
      console.log(JSON.stringify({ mode: 'LOCAL_FIXTURE_ONLY', baseUrl: demo.baseUrl, processId: process.pid }));
      process.once('SIGINT', () => { demo.close().then(() => { process.exitCode = 0; }); });
      process.once('SIGTERM', () => { demo.close().then(() => { process.exitCode = 0; }); });
    }).catch(error => { console.error(error); process.exitCode = 1; });
  } else {
    runLocalOnboarding().then(result => {
      console.log(JSON.stringify(result, null, 2));
    }).catch(error => { console.error(error); process.exitCode = 1; });
  }
}
