import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  DeploymentVerificationError,
  FILE_CONTRACT,
  SOURCE,
  VENDOR_CONTRACT,
  gitBlobSha1,
  normalizeBaseUrl,
  verifyDeployment,
} from '../verify-deploy.mjs';

const vendorBody = `var solanaWeb3={};\n${'x'.repeat(100_000)}`;
const vendorSri = `sha384-${createHash('sha384').update(vendorBody).digest('base64')}`;
const vendorLock = JSON.stringify({
  schema: 'cookie-crumbs/vendor-lock/v1',
  package: VENDOR_CONTRACT.package,
  tarballSha512: VENDOR_CONTRACT.tarballSha512,
  bundlePath: VENDOR_CONTRACT.bundlePath,
  bundleBytes: Buffer.byteLength(vendorBody),
  bundleSri: vendorSri,
});

const canonical = Object.freeze({
  '/site/index.html': {
    type: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Cookie Crumbs · test</title><button id="connect-wallet"></button><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><script src="./vendor/solana-web3.iife.min.js"></script><script type="module" src="./app.js"></script>',
  },
  '/site/app.js': {
    type: 'application/javascript; charset=utf-8',
    body: "import { composeReceipt } from './receipt.mjs'; import { transactionSignedBy } from './provenance.mjs'; const RPC='https://rpc.cookiescan.io'; const wallet=window.nightly?.solana; const memo='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'; function f(tx, expectedSigner){ return transactionSignedBy(tx, expectedSigner); } void composeReceipt; void RPC; void wallet; void memo; void f;",
  },
  '/site/provenance.mjs': {
    type: 'text/javascript; charset=utf-8',
    body: "export function transactionSignedBy(){ const entry={signer:true,pubkey:''}; const expected=''; return entry.signer !== true ? false : publicKeyText(entry.pubkey) === expected; } function publicKeyText(x){return String(x)}",
  },
  '/site/receipt.mjs': {
    type: 'text/javascript; charset=utf-8',
    body: "export const RECEIPT_PREFIX = 'cookie-crumbs:v1'; export const MAX_MEMO_BYTES = 480; throw new Error('Duplicate Cookie Crumbs field');",
  },
  '/site/styles.css': {
    type: 'text/css; charset=utf-8',
    body: '.wallet-card, .panel { display:block } @media (max-width: 760px) { .panel { display:grid } }',
  },
  '/site/vendor-lock.json': { type: 'application/json; charset=utf-8', body: vendorLock },
  '/site/vendor/solana-web3.iife.min.js': { type: 'application/javascript; charset=utf-8', body: vendorBody },
});

function contractFor(routes) {
  return Object.fromEntries(Object.entries(FILE_CONTRACT).map(([path, contract]) => {
    const route = routes[`/site/${path}`];
    return [path, { ...contract, gitBlobSha1: gitBlobSha1(Buffer.from(route.body, 'utf8')) }];
  }));
}

async function withServer(overrides, callback) {
  const routesObject = { ...canonical, ...overrides };
  const routes = new Map(Object.entries(routesObject));
  const server = createServer((request, response) => {
    const route = routes.get(request.url);
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(route.status ?? 200, { 'content-type': route.type, ...(route.headers ?? {}) });
    response.end(route.body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}/site/`, routesObject);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function expectCode(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DeploymentVerificationError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('computes Git blob identity using the canonical blob header', () => {
  assert.equal(gitBlobSha1(Buffer.from('hello\n', 'utf8')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('pins every first-party published runtime file to hardened source blobs', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FILE_CONTRACT).map(([path, contract]) => [path, contract.gitBlobSha1])),
    {
      'index.html': '066cda664bc1e317beaf62bd6530605f54aba60d',
      'app.js': '36abb9290cc4693ddcf81ac7c6d1d895a1e580f5',
      'provenance.mjs': '8d6691b4b5002f963c42076fead68d9f1b6ecdc5',
      'receipt.mjs': 'befbf85080201ed458b1555bf77442f85fcfe442',
      'styles.css': '63e8dbc8c6c7cb4efea6dfc2a7135cff435c3d74',
    },
  );
  assert.equal(SOURCE.generation, 'cookie-crumbs/source-hardening-v2');
});

test('normalizes directory and index URLs without retaining query or fragment', () => {
  assert.equal(normalizeBaseUrl('https://example.test/a/b').href, 'https://example.test/a/b/');
  assert.equal(normalizeBaseUrl('https://example.test/a/b/index.html?x=1#y').href, 'https://example.test/a/b/');
});

test('rejects embedded URL credentials before any request', () => {
  assert.throws(() => normalizeBaseUrl('https://user:secret@example.test/site/'), (error) => error instanceof DeploymentVerificationError && error.code === 'CREDENTIALS_FORBIDDEN');
});

test('accepts complete source-bound deployment and hash-bound local vendor', async () => {
  await withServer({}, async (baseUrl, routes) => {
    const receipt = await verifyDeployment(baseUrl, { fileContract: contractFor(routes), now: () => new Date('2026-09-14T12:00:00.000Z') });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.schema, 'cookie-crumbs/deployment-receipt/v2');
    assert.equal(receipt.checkedAt, '2026-09-14T12:00:00.000Z');
    assert.equal(receipt.files.length, 5);
    assert.equal(receipt.vendor.package, VENDOR_CONTRACT.package);
    assert.equal(receipt.vendor.tarballSha512, VENDOR_CONTRACT.tarballSha512);
    assert.equal(receipt.vendor.sri, vendorSri);
  });
});

test('fails closed on any first-party byte drift', async () => {
  const overrides = { '/site/styles.css': { type: 'text/css; charset=utf-8', body: `${canonical['/site/styles.css'].body}\n/* injected */` } };
  await withServer(overrides, async (baseUrl) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(canonical) }), 'SOURCE_BLOB_MISMATCH'));
});

test('fails closed when the served vendor bytes drift from their build lock', async () => {
  const overrides = { '/site/vendor/solana-web3.iife.min.js': { type: 'application/javascript; charset=utf-8', body: `${vendorBody}tamper` } };
  await withServer(overrides, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'VENDOR_SIZE_MISMATCH'));
});

test('fails closed when vendor lock claims a different package generation', async () => {
  const bad = JSON.parse(vendorLock);
  bad.tarballSha512 = '0'.repeat(128);
  const overrides = { '/site/vendor-lock.json': { type: 'application/json', body: JSON.stringify(bad) } };
  await withServer(overrides, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'VENDOR_SOURCE_MISMATCH'));
});

test('fails closed on incorrect Content-Type or missing asset', async () => {
  await withServer({ '/site/styles.css': { type: 'text/plain', body: canonical['/site/styles.css'].body } }, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'CONTENT_TYPE_MISMATCH'));
  await withServer({ '/site/receipt.mjs': { status: 404, type: 'text/plain', body: 'gone' } }, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'HTTP_STATUS'));
});

test('validates timeout and byte-limit options before network activity', async () => {
  await expectCode(verifyDeployment('https://example.test/', { timeoutMs: 0 }), 'INVALID_TIMEOUT');
  await expectCode(verifyDeployment('https://example.test/', { maxBytes: 0 }), 'INVALID_MAX_BYTES');
});
