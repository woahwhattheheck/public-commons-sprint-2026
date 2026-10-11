// SPDX-License-Identifier: MIT
// One native TLS/CONNECT -> interrupted acquisition -> original buyer review journey.
// CATALOG_TEST_CERT/KEY are ephemeral local fixture files; never merchant credentials.
import assert from 'node:assert/strict';
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { connect } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { discoverCatalog } from './discovery.mjs';
import { prepare } from './prepare.mjs';

const root = process.env.CATALOG_TEST_ROOT;
assert(root && process.env.CATALOG_TEST_CERT && process.env.CATALOG_TEST_KEY,
  'Set CATALOG_TEST_ROOT, CATALOG_TEST_CERT, CATALOG_TEST_KEY; see CATALOGS.md');
await mkdir(root, { recursive: true, mode: 0o700 });
const offsets = [], authorities = [], sockets = new Set();
let failOnce = true;
const row = i => ({ resource: `https://seller.fixture.example/data/${i}`, type: 'http',
  description: 'Local TLS exercise only </script><img src=x onerror=alert(1)>',
  accepts: [{ scheme: 'exact', network: 'stellar:testnet', amount: '17000',
    asset: 'LOCAL_UNFUNDED_SAMPLE_ASSET', payTo: 'LOCAL_UNFUNDED_SAMPLE_RECIPIENT', maxTimeoutSeconds: 60 }],
  extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } } } } });
const server = httpsServer({ cert: await readFile(process.env.CATALOG_TEST_CERT),
  key: await readFile(process.env.CATALOG_TEST_KEY) }, (request, response) => {
  assert.equal(request.socket.servername, 'catalog.fixture.example');
  assert.equal(request.method, 'GET');
  assert(!request.headers['payment-signature'] && !request.headers.authorization);
  const url = new URL(request.url, 'https://catalog.fixture.example');
  assert.equal(url.pathname, '/discovery/resources');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  offsets.push(offset);
  if (offset === 2 && failOnce) { failOnce = false; response.writeHead(503).end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ x402Version: 2, items: [row(0), row(1), row(2)].slice(offset, offset + 2),
    pagination: { offset, limit: 2, total: 3 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const proxy = httpServer();
proxy.on('connect', (request, client, head) => {
  authorities.push(request.url); assert.equal(request.url, 'catalog.fixture.example:443');
  const upstream = connect(server.address().port, '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    client.pipe(upstream); upstream.pipe(client);
  });
  for (const socket of [client, upstream]) {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.once('error', () => { client.destroy(); upstream.destroy(); });
  }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const captureDir = join(root, 'capture');
const input = { origin: 'https://catalog.fixture.example', limit: 2,
  sandboxGatewayIPv4: '198.18.24.1', proxy: `http://127.0.0.1:${proxy.address().port}`,
  captureDir, allPages: true, timeoutMs: 3000 };
const dependencies = { lookup: async () => [{ address: '198.18.24.1', family: 4 }] };
try {
  await assert.rejects(discoverCatalog(input, dependencies), { code: 'DISCOVERY_HTTP_503' });
  const first = await readFile(join(captureDir, 'page-000000.json'));
  assert.equal(JSON.parse(await readFile(join(captureDir, 'manifest.json'))).status, 'PARTIAL');
  const completed = await discoverCatalog(input, dependencies);
  assert.equal(completed.status, 'COMPLETE'); assert.equal(completed.pages, 2); assert.equal(completed.observedRows, 3);
  assert.deepEqual(offsets, [0, 2, 2]);
  assert.deepEqual(await readFile(join(captureDir, 'page-000000.json')), first);
  // Reordered configuration and a checkpoint interrupted after page commit both recover offline.
  const manifestPath = join(captureDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, pages: manifest.pages.slice(0, 1) }));
  await discoverCatalog(Object.fromEntries(Object.entries(input).reverse()), dependencies);
  assert.deepEqual(offsets, [0, 2, 2]);
  const configPath = join(root, 'buyer-review.json');
  const prepared = await prepare(['--discovery', join(captureDir, 'page-000000.json'), '--row', '0',
    '--accept', '0', '--intent-id', 'catalog-native-lifecycle', '--url', 'https://seller.fixture.example/data/0',
    '--method', 'GET', '--out', configPath]);
  assert.equal(prepared.acceptedTerms.maxAtomic, '17000');
  const review = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)),
    '--review', '--config', configPath], { encoding: 'utf8' }));
  assert.equal(review.mode, 'OFFLINE_REVIEW'); assert.equal(review.preparedFrom.originalListing.resource, row(0).resource);
  const pageHTML = await readFile(join(captureDir, 'page-000000.html'), 'utf8');
  assert(!pageHTML.includes('<img') && pageHTML.includes('&lt;img'));
  const lastPath = join(captureDir, 'page-000001.json'), last = await readFile(lastPath);
  await writeFile(lastPath, Buffer.concat([last, Buffer.from(' ')]));
  await assert.rejects(discoverCatalog(input, dependencies), { code: 'CATALOG_SAVED_PAGE_HASH_MISMATCH' });
  await writeFile(lastPath, last); await discoverCatalog(input, dependencies);
  await assert.rejects(discoverCatalog({ origin: input.origin, proxy: input.proxy },
    { lookup: async () => [{ address: '10.0.0.1', family: 4 }] }), { code: 'CATALOG_NETWORK_NONPUBLIC_DNS_ANSWER' });
  assert.deepEqual(offsets, [0, 2, 2]);
  console.log(JSON.stringify({ status: 'PASS', node: process.version, nativeTLS: true,
    connectAuthorities: authorities, requestedOffsets: offsets, savedPages: 2, observedRows: 3,
    completedPageRefetches: 0, originalBuyerReview: review.mode, quotedAtomic: review.acceptedTerms.maxAtomic,
    paymentsInitiated: 0, publicProviderRequests: 0, captureDir }));
} finally {
  for (const socket of sockets) socket.destroy();
  await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => server.close(resolve))]);
}
