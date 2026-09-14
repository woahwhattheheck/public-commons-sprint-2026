import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  WEB3_BUNDLE_BYTES,
  WEB3_BUNDLE_SHA256,
  WEB3_BUNDLE_SRI,
  WEB3_TARBALL_SHA512,
} from '../build.mjs';
import {
  DeploymentVerificationError,
  FILE_CONTRACT,
  SOURCE,
  VENDOR_CONTRACT,
  gitBlobSha1,
  normalizeBaseUrl,
  verifyDeployment,
} from '../verify-deploy.mjs';

const forgedVendorBody = Buffer.from(`var solanaWeb3={};\n${'x'.repeat(100_000)}`, 'utf8');
const forgedVendorSri = `sha384-${createHash('sha384').update(forgedVendorBody).digest('base64')}`;
const forgedVendorLock = JSON.stringify({
  schema: 'cookie-crumbs/vendor-lock/v1',
  package: VENDOR_CONTRACT.package,
  tarballSha512: VENDOR_CONTRACT.tarballSha512,
  bundlePath: VENDOR_CONTRACT.bundlePath,
  bundleBytes: forgedVendorBody.byteLength,
  bundleSri: forgedVendorSri,
});

const pinnedVendorLock = JSON.stringify({
  schema: 'cookie-crumbs/vendor-lock/v1',
  package: VENDOR_CONTRACT.package,
  tarballSha512: VENDOR_CONTRACT.tarballSha512,
  bundlePath: VENDOR_CONTRACT.bundlePath,
  bundleBytes: VENDOR_CONTRACT.bundleBytes,
  bundleSri: VENDOR_CONTRACT.bundleSri,
});

const sameSizeAttackerBundle = Buffer.alloc(VENDOR_CONTRACT.bundleBytes, 0x78);
Buffer.from('var solanaWeb3={};\n', 'utf8').copy(sameSizeAttackerBundle);

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
  '/site/vendor-lock.json': { type: 'application/json; charset=utf-8', body: pinnedVendorLock },
  '/site/vendor/solana-web3.iife.min.js': { type: 'application/javascript; charset=utf-8', body: sameSizeAttackerBundle },
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

test('build and deployment verifier share the independently proved vendor identity', () => {
  assert.equal(VENDOR_CONTRACT.tarballSha512, WEB3_TARBALL_SHA512);
  assert.equal(VENDOR_CONTRACT.bundleBytes, WEB3_BUNDLE_BYTES);
  assert.equal(VENDOR_CONTRACT.bundleSri, WEB3_BUNDLE_SRI);
  assert.equal(VENDOR_CONTRACT.bundleSha256, WEB3_BUNDLE_SHA256);
  assert.equal(VENDOR_CONTRACT.bundleBytes, 463_860);
  assert.equal(VENDOR_CONTRACT.bundleSri, 'sha384-I45YF+S0YGWIolUyTksLk9TNtTqaDgZg8e6T1OoBoJvvFmphqYNIPZw3Kl0TkZNN');
  assert.equal(VENDOR_CONTRACT.bundleSha256, '09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3');
});

test('normalizes directory and index URLs without retaining query or fragment', () => {
  assert.equal(normalizeBaseUrl('https://example.test/a/b').href, 'https://example.test/a/b/');
  assert.equal(normalizeBaseUrl('https://example.test/a/b/index.html?x=1#y').href, 'https://example.test/a/b/');
});

test('rejects embedded URL credentials before any request', () => {
  assert.throws(() => normalizeBaseUrl('https://user:secret@example.test/site/'), (error) => error instanceof DeploymentVerificationError && error.code === 'CREDENTIALS_FORBIDDEN');
});

test('rejects a forged self-consistent vendor lock instead of trusting served metadata', async () => {
  const overrides = {
    '/site/vendor-lock.json': { type: 'application/json; charset=utf-8', body: forgedVendorLock },
    '/site/vendor/solana-web3.iife.min.js': { type: 'application/javascript; charset=utf-8', body: forgedVendorBody },
  };
  await withServer(overrides, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'VENDOR_SOURCE_MISMATCH'));
});

test('rejects attacker vendor bytes even when their size and marker match the approved bundle', async () => {
  await withServer({}, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'VENDOR_SRI_MISMATCH'));
});

test('fails closed on any first-party byte drift before vendor verification', async () => {
  const overrides = { '/site/styles.css': { type: 'text/css; charset=utf-8', body: `${canonical['/site/styles.css'].body}\n/* injected */` } };
  await withServer(overrides, async (baseUrl) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(canonical) }), 'SOURCE_BLOB_MISMATCH'));
});

test('fails closed when vendor lock claims a different package generation', async () => {
  const bad = JSON.parse(pinnedVendorLock);
  bad.tarballSha512 = '0'.repeat(128);
  const overrides = { '/site/vendor-lock.json': { type: 'application/json', body: JSON.stringify(bad) } };
  await withServer(overrides, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'VENDOR_SOURCE_MISMATCH'));
});

test('fails closed on incorrect Content-Type or missing first-party asset', async () => {
  await withServer({ '/site/styles.css': { type: 'text/plain', body: canonical['/site/styles.css'].body } }, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'CONTENT_TYPE_MISMATCH'));
  await withServer({ '/site/receipt.mjs': { status: 404, type: 'text/plain', body: 'gone' } }, async (baseUrl, routes) => expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'HTTP_STATUS'));
});

test('validates timeout and byte-limit options before network activity', async () => {
  await expectCode(verifyDeployment('https://example.test/', { timeoutMs: 0 }), 'INVALID_TIMEOUT');
  await expectCode(verifyDeployment('https://example.test/', { maxBytes: 0 }), 'INVALID_MAX_BYTES');
  await expectCode(verifyDeployment('https://example.test/', { maxBytes: 400_000 }), 'INVALID_MAX_BYTES');
});
