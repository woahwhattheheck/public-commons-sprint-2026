import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  DeploymentVerificationError,
  FILE_CONTRACT,
  SOURCE,
  gitBlobSha1,
  normalizeBaseUrl,
  verifyDeployment,
} from '../verify-deploy.mjs';

const canonical = Object.freeze({
  '/site/index.html': {
    type: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Cookie Crumbs · test</title><button id="connect-wallet"></button><link href="./styles.css"><script type="module" src="./app.js"></script>',
  },
  '/site/app.js': {
    type: 'application/javascript; charset=utf-8',
    body: "import { composeReceipt } from './receipt.mjs'; const RPC='https://rpc.cookiescan.io'; const wallet=window.nightly?.solana; const memo='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'; void composeReceipt; void RPC; void wallet; void memo;",
  },
  '/site/receipt.mjs': {
    type: 'text/javascript; charset=utf-8',
    body: "export const RECEIPT_PREFIX = 'cookie-crumbs:v1'; export const MAX_MEMO_BYTES = 480; throw new Error('Duplicate Cookie Crumbs field');",
  },
  '/site/styles.css': {
    type: 'text/css; charset=utf-8',
    body: '.wallet-card, .panel { display:block } @media (max-width: 760px) { .panel { display:grid } }',
  },
});

function contractFor(routes) {
  return Object.fromEntries(Object.entries(FILE_CONTRACT).map(([path, contract]) => {
    const route = routes[`/site/${path}`];
    return [path, {
      ...contract,
      gitBlobSha1: gitBlobSha1(Buffer.from(route.body, 'utf8')),
    }];
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

test('pins every published runtime file to the integrated source blobs', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FILE_CONTRACT).map(([path, contract]) => [path, contract.gitBlobSha1])),
    {
      'index.html': 'af4d1a0ce8ae835092d480c319f2ba2234bf97a4',
      'app.js': '31e2ca50c8d02a4f0bd390687337835c45d65d27',
      'receipt.mjs': 'befbf85080201ed458b1555bf77442f85fcfe442',
      'styles.css': '63e8dbc8c6c7cb4efea6dfc2a7135cff435c3d74',
    },
  );
});

test('normalizes directory and index URLs without retaining query or fragment', () => {
  assert.equal(normalizeBaseUrl('https://example.test/a/b').href, 'https://example.test/a/b/');
  assert.equal(normalizeBaseUrl('https://example.test/a/b/index.html?x=1#y').href, 'https://example.test/a/b/');
});

test('rejects embedded URL credentials before any request', () => {
  assert.throws(
    () => normalizeBaseUrl('https://user:secret@example.test/site/'),
    (error) => error instanceof DeploymentVerificationError && error.code === 'CREDENTIALS_FORBIDDEN',
  );
});

test('accepts a complete deployment and emits byte- and source-bound receipts', async () => {
  await withServer({}, async (baseUrl, routes) => {
    const receipt = await verifyDeployment(baseUrl, {
      fileContract: contractFor(routes),
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.checkedAt, '2026-09-14T12:00:00.000Z');
    assert.equal(receipt.source.commit, SOURCE.commit);
    assert.equal(receipt.files.length, 4);
    assert.deepEqual(receipt.files.map((file) => file.path), ['index.html', 'app.js', 'receipt.mjs', 'styles.css']);
    for (const file of receipt.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.match(file.observedGitBlobSha1, /^[0-9a-f]{40}$/);
      assert.equal(file.observedGitBlobSha1, file.expectedGitBlobSha1);
      assert.ok(file.bytes > 0);
      assert.equal(file.status, 200);
    }
  });
});

test('fails closed on any byte drift from the pinned source blob', async () => {
  const overrides = {
    '/site/styles.css': {
      type: 'text/css; charset=utf-8',
      body: `${canonical['/site/styles.css'].body}\n/* injected */`,
    },
  };
  await withServer(overrides, async (baseUrl) => {
    await expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(canonical) }), 'SOURCE_BLOB_MISMATCH');
  });
});

test('fails closed when a required marker is missing even if its blob is expected', async () => {
  const overrides = {
    '/site/app.js': { type: 'application/javascript', body: "import './receipt.mjs';" },
  };
  await withServer(overrides, async (baseUrl, routes) => {
    await expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'MARKER_MISSING');
  });
});

test('fails closed on an incorrect Content-Type', async () => {
  const overrides = {
    '/site/styles.css': { type: 'text/plain', body: canonical['/site/styles.css'].body },
  };
  await withServer(overrides, async (baseUrl, routes) => {
    await expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'CONTENT_TYPE_MISMATCH');
  });
});

test('fails closed when an asset is missing', async () => {
  const overrides = {
    '/site/receipt.mjs': { status: 404, type: 'text/plain', body: 'gone' },
  };
  await withServer(overrides, async (baseUrl, routes) => {
    await expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes) }), 'HTTP_STATUS');
  });
});

test('enforces a per-file byte ceiling while streaming', async () => {
  await withServer({}, async (baseUrl, routes) => {
    await expectCode(verifyDeployment(baseUrl, { fileContract: contractFor(routes), maxBytes: 32 }), 'BODY_TOO_LARGE');
  });
});

test('validates timeout and byte-limit options before network activity', async () => {
  await expectCode(verifyDeployment('https://example.test/', { timeoutMs: 0 }), 'INVALID_TIMEOUT');
  await expectCode(verifyDeployment('https://example.test/', { maxBytes: 0 }), 'INVALID_MAX_BYTES');
});
