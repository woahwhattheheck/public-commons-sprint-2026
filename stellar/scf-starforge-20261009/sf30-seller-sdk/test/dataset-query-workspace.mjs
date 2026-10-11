// MIT. One product journey: native CSV -> ordered pages -> original offer -> operator HTTP.
// No network beyond loopback, credentials, wallets, simulated settlements, or CI.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCsvDataset, loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { startDatasetWorkspace } from '../dataset-workspace.mjs';

const spec = new URL('../examples/query-workspace-dataset.json', import.meta.url);
const dataset = await loadDatasetConfig(spec);
const query = (text, source = dataset) => source.handle({ query: new URLSearchParams(text) });
const ids = response => response.body.rows.map(row => row.sku);
assert.deepEqual(ids(query('where_category=widget&where_available=true&gte_units=10&sort=-units&fields=sku,units&limit=100')),
  ['W-005', 'W-001', 'W-007']);
assert.deepEqual(ids(query('gte_units=12&lte_units=12&sort=-sku&limit=100')), ['W-007', 'W-003', 'W-001']);
assert.deepEqual(ids(query('gt_units=20&sort=-units&limit=100')), ['P-004']);
assert.deepEqual(ids(query('gte_updated_at=2026-10-04&lte_updated_at=2026-10-09&sort=updated_at&limit=100')),
  ['W-003', 'P-004', 'W-005', 'P-006', 'W-007']);
assert.deepEqual(ids(query('where_units=&sort=-units')), ['P-006']);
assert.equal(query('gt_units=25&lte_units=12').body.page.total, 0);
const ordered = ['P-004', 'W-005', 'W-001', 'W-003', 'W-007', 'P-008', 'W-002', 'P-006'];
let all = [], cursor = null;
do {
  const q = new URLSearchParams({ sort: '-units', fields: 'sku,units', limit: all.length ? '3' : '2' });
  if (cursor) q.set('cursor', cursor);
  const page = query(q.toString()); assert.equal(page.status, 200);
  all.push(...ids(page)); cursor = page.body.page.nextCursor;
} while (cursor);
assert.deepEqual(all, ordered);
assert.deepEqual(ids(query('sort=units&limit=100')), ['W-002', 'P-008', 'W-001', 'W-003', 'W-007', 'W-005', 'P-004', 'P-006']);
const first = query('sort=-units&fields=sku&limit=1');
const continuation = first.body.page.nextCursor;
assert.equal(query(new URLSearchParams({ sort: 'units', fields: 'sku', cursor: continuation }).toString()).status, 400);
for (const invalid of ['gt_units=1&gte_units=2', 'gt_units=', 'gte_units=NaN', 'gte_available=false',
  'sort=internal_cost', 'fields=internal_cost', 'where_category=widget&where_category=part'])
  assert.equal(query(invalid).status, 400, invalid);
assert.ok(!JSON.stringify(query('limit=100')).includes('PRIVATE'));

const config = await buildDatasetSellerConfig(dataset, { origin: 'https://merchant.example',
  payment: { scheme: 'exact', network: 'stellar:testnet', asset: 'EXAMPLE_ASSET_NOT_DEPLOYED',
    amount: '10000', payTo: 'EXAMPLE_RECIPIENT_NOT_DEPLOYED', maxTimeoutSeconds: 60 } });
const names = config.routes[0].definition.queryParameters.map(p => p.name);
assert.equal(names.length, 19); assert.ok(names.includes('gte_units') && names.includes('sort'));

const temp = await mkdtemp(join(tmpdir(), 'sf30-query-workspace-'));
let app;
try {
  const original = JSON.parse(await readFile(spec, 'utf8'));
  await writeFile(join(temp, 'data.csv'), (await readFile(new URL('../examples/query-workspace-dataset.csv', import.meta.url), 'utf8')).replace('27,1.2', '28,1.2'));
  const replacement = await loadCsvDataset({ ...original, file: join(temp, 'data.csv') });
  assert.equal(query(new URLSearchParams({ sort: '-units', fields: 'sku', cursor: continuation }).toString(), replacement).status, 409);
  app = await startDatasetWorkspace({ datasetPath: spec, port: 0, resource: 'https://merchant.example/data' });
  const auth = { authorization: `Bearer ${app.token}` };
  assert.equal((await fetch(app.origin + '/api/schema')).status, 401);
  assert.equal((await fetch(app.origin + '/api/schema', { headers: { ...auth, origin: 'https://other.example' } })).status, 403);
  const meta = await (await fetch(app.origin + '/api/schema', { headers: auth })).json();
  assert.equal(meta.dataset.snapshot, dataset.describe().snapshot); assert.equal(meta.queryParameters.length, 19);
  const response = await fetch(app.origin + '/api/query', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'gte_units=12&sort=-units&fields=sku,units&limit=2' }) });
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.deepEqual(output.result.rows.map(row => row.sku), ['P-004', 'W-005']);
  assert.equal(output.mode, 'LOCAL_OPERATOR_PREVIEW'); assert.ok(output.curl.includes('--data-urlencode'));
  assert.ok(!output.curl.includes('Bearer')); assert.ok(!JSON.stringify(output).includes('PRIVATE'));
  console.log(JSON.stringify({ result: 'PASS', rows: all.length, queryParameters: names.length,
    snapshot: dataset.describe().snapshot, workflow: 'native dataset / typed ranges / stable pages / original offer / authenticated local HTTP' }));
} finally { if (app) await app.close(); await rm(temp, { recursive: true, force: true }); }
