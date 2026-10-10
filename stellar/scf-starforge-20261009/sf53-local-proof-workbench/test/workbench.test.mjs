// One focused local contract check. No network outside 127.0.0.1, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readOriginalEvidence, startWorkbench } from '../serve.mjs';

const smokeSuccess = () => ({
  status: 'PASS', discovered: 1, merchantGet402: 1,
  executedPaymentCalls: 0, signedRequests: 0, testnetTransactions: 0,
  cancelledReplay: true, protocol: '2025-11-25',
});
const sourceSuccess = () => ({
  status: 'PASS_SOURCE_CONTRACTS_ONLY',
  sources: [{ id: 'catalog', status: 'PIN_MATCH', actualGitBlob: 'a'.repeat(40), expectedGitBlob: 'a'.repeat(40) },
    { id: 'mcp_broker', status: 'SOURCE_CHANGED', actualGitBlob: 'b'.repeat(40), expectedGitBlob: 'c'.repeat(40) }],
  warnings: ['review accepted source drift'], failures: [],
  unverifiedGates: [{gate:'testnet',state:'EXTERNAL_ACCEPTANCE_REQUIRED'}],
});

test('source-native runner accepts only an unspendable local smoke and keeps real release drift visible', async () => {
  let a = 0, b = 0;
  const report = await readOriginalEvidence({
    smokeRunner: async () => { a++; return smokeSuccess(); },
    releaseRunner: async (opts) => { assert.equal(opts.strictPins, false); b++; return sourceSuccess(); },
    observedAt: '2026-10-10T07:00:00.000Z',
  });
  assert.equal(a, 1); assert.equal(b, 1);
  assert.equal(report.commerce.status, 'PASS_LOCAL_SOURCE_SMOKE');
  assert.equal(report.release.status, 'PASS_SOURCE_CONTRACTS_ONLY');
  assert.equal(report.release.changedPins, 1);
  assert.equal(report.release.warnings.length, 1);
  assert.equal(report.restrictions.browserCanTriggerPayment, false);
});

test('positive paid or signed activity cannot be mislabeled as safe local acceptance', async () => {
  const report = await readOriginalEvidence({
    smokeRunner: async () => ({...smokeSuccess(), signedRequests: 1}),
    releaseRunner: async () => sourceSuccess(),
  });
  assert.equal(report.commerce.status, 'FAIL_INVARIANT');
  const failure = await readOriginalEvidence({
    smokeRunner: async () => {throw Error('read-only source incompatibility');},
    releaseRunner: async () => ({ ...sourceSuccess(), status: 'FAIL_SOURCE_PREFLIGHT', failures: ['missing export'] }),
  });
  assert.equal(failure.commerce.status, 'FAIL');
  assert.equal(failure.release.status, 'FAIL_SOURCE_PREFLIGHT');
});

test('browser exposes a frozen read-only source report, rejects rebinding/writes and serves CSP', async () => {
  const report = await readOriginalEvidence({ smokeRunner: async()=>smokeSuccess(), releaseRunner: async()=>sourceSuccess() });
  const workbench = await startWorkbench({ report });
  try {
    const base = workbench.url;
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /Local proof workbench/);
    const r = await fetch(base + '/api/report');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), report);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(base + '/api/report', { headers: { Host: 'attacker.invalid' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }); req.on('error', reject); req.end();
    });
    assert.equal(badHost, 403);
    const noWrites = await fetch(base + '/api/report', { method:'POST', body:'{}' });
    assert.equal(noWrites.status, 405);
    const missing = await fetch(base + '/payment');
    assert.equal(missing.status, 404);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } finally { await workbench.close(); }
});
