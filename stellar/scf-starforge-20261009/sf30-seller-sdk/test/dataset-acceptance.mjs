// MIT. Focused dataset + original SF30 application integration; no network spend.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDatasetConfig, loadCsvDataset } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';

const dataset = await loadDatasetConfig(new URL('../examples/inventory-dataset.json', import.meta.url));
const context = query => ({ query });
const query = { where_category: 'widget', fields: 'sku,description,units', limit: '1' };
const firstContext = context(query);
assert.equal(dataset.admit(firstContext), true);
const first = dataset.handle(firstContext);
assert.equal(first.status, 200);
assert.equal(first.body.page.total, 3);
assert.deepEqual(first.body.rows, [{ sku: 'W-001', description: 'Widget, small', units: 12 }]);
const second = dataset.handle(context({ ...query, cursor: first.body.page.nextCursor }));
assert.equal(second.body.rows[0].description, 'Widget "medium"');
const third = dataset.handle(context({ ...query, cursor: second.body.page.nextCursor }));
assert.equal(third.body.rows[0].description, 'Widget large\nwith case');
assert.equal(third.body.page.nextCursor, null);
assert.equal(dataset.handle(context({ where_available: 'false' })).body.page.total, 2);
assert.equal(dataset.handle(context({ fields: 'rating', where_sku: 'W-002' })).body.rows[0].rating, null);
assert.equal(dataset.admit(context({ fields: 'internal_note' })).status, 400);
assert.equal(dataset.admit(context({ limit: ['1', '2'] })).status, 400);
assert.equal(dataset.admit(context({ where_available: 'yes' })).status, 400);
assert.equal(dataset.admit(context({ ...query, fields: 'sku', cursor: first.body.page.nextCursor })).status, 400);
const changed = JSON.parse(Buffer.from(first.body.page.nextCursor, 'base64url'));
changed.s = '0'.repeat(64);
assert.equal(dataset.admit(context({ ...query, cursor: Buffer.from(JSON.stringify(changed)).toString('base64url') })).status, 409);
first.body.rows[0].sku = 'mutated';
assert.equal(dataset.handle(context(query)).body.rows[0].sku, 'W-001');

const temporary = await mkdtemp(join(tmpdir(), 'sf30-dataset-'));
try {
  const file = join(temporary, 'typed.csv');
  await writeFile(file, '\uFEFFid,ok\r\n0,true\r\n1,false');
  assert.equal((await loadCsvDataset({ file, name: 'typed', columns: { id: 'integer', ok: 'boolean' } })).describe().rowCount, 2);
  await writeFile(file, 'id,ok\n9007199254740993,true\n');
  await assert.rejects(loadCsvDataset({ file, name: 'typed', columns: { id: 'integer' } }), /requires integer/);
  await writeFile(file, 'id\n"unterminated');
  await assert.rejects(loadCsvDataset({ file, name: 'typed', columns: { id: 'string' } }), /unterminated/);
} finally { await rm(temporary, { recursive: true, force: true }); }

// Public-shaped but deliberately fictional terms; no wallet or live settlement.
const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '100',
  asset: 'FICTIONAL_TEST_ASSET', payTo: 'FICTIONAL_TEST_RECIPIENT', maxTimeoutSeconds: 60 };
const config = await buildDatasetSellerConfig(dataset, { payment, origin: 'https://dataset.example', path: '/data' });
assert.equal(config.routes[0].admit, 'admitDataset');
assert.equal(config.routes[0].definition.payment.amount, '100');
assert(!JSON.stringify(config).includes('Widget, small'));
console.log('PASS dataset: CSV parsing, typed projection, indexed equality, cursor traversal, validation, original offer compiler');

if (!process.argv.includes('--core-only')) {
  const { startSellerService } = await import('../serve.mjs');
  let verified = 0, handled = 0, settled = 0, settlementFails = false;
  const handlers = { admitDataset: dataset.admit, queryDataset: ctx => { handled++; return dataset.handle(ctx); } };
  const nativeFactory = async () => ({
    async processHTTPRequest(ctx) {
      verified++;
      if (ctx.adapter.getHeader('payment-signature') !== 'fixture-only') return {
        type: 'payment-error', response: { status: 402, headers: {}, body: { error: 'Payment required' } },
      };
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {}, declaredExtensions: {},
        cancellationDispatcher: { cancel: async () => ({}) } };
    },
    async processSettlement() { settled++; return settlementFails ? { success: false } : { success: true, headers: {} }; },
    createFailurePathSettlementHeaders() { return {}; },
  });
  const service = await startSellerService({ config, port: 0, handlers, nativeFactory });
  const port = service.server.address().port;
  const fetchLocal = (query, paid = false) => fetch(`http://127.0.0.1:${port}/data?${new URLSearchParams(query)}`,
    { headers: paid ? { 'payment-signature': 'fixture-only' } : {}, signal: AbortSignal.timeout(5000) });
  try {
    let response = await fetchLocal({ fields: 'internal_note' }, true);
    assert.equal(response.status, 400); await response.text();
    assert.equal(verified, 0); assert.equal(handled, 0);
    response = await fetchLocal(query);
    assert.equal(response.status, 402); await response.text();
    assert.equal(handled, 0); assert.equal(settled, 0);
    response = await fetchLocal(query, true);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rows[0].sku, 'W-001');
    assert.equal(handled, 1); assert.equal(settled, 1);
    settlementFails = true;
    response = await fetchLocal(query, true);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'SETTLEMENT_RESULT_UNAVAILABLE');
    console.log('PASS original SF30 HTTP: invalid query pre-verification, unpaid withheld, verified dataset delivery, failed settlement withheld');
  } finally { await service.close(); }
}
