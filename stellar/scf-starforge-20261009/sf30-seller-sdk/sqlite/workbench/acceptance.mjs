// MIT. One native operator journey; no payment simulation and no test framework.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { startWorkbench } from './server.mjs';
const root = await mkdtemp(join(tmpdir(), 'sf30-workbench-'));
const database = join(root, 'inventory.sqlite'), workspace = join(root, 'workspace');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const db = new DatabaseSync(database);
db.exec("CREATE TABLE inventory(id INTEGER PRIMARY KEY,title TEXT,region TEXT,payload BLOB); INSERT INTO inventory VALUES(9007199254740993,'PRIVATE_PREVIEW_SENTINEL','north',X'00FF'),(2,'Public item','south',NULL)");
db.close(); const original = hash(await readFile(database));
let session, handlers;
try {
  session = await startWorkbench({ database, workspace });
  async function request(path, data, options = {}) {
    const result = await fetch(session.origin + path, { method: data ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + session.token, ...(data ? { 'content-type': 'application/json' } : {}), ...options.headers },
      ...(data ? { body: JSON.stringify(data) } : {}), ...options });
    return { status: result.status, value: await result.json() };
  }
  assert.equal((await fetch(session.origin + '/api/state')).status, 401);
  assert.equal((await request('/api/state', null, { headers: { origin: 'https://other.example' } })).status, 403);
  const initial = (await request('/api/state')).value;
  const tables = (await request('/api/schema')).value;
  assert.deepEqual(tables.tables, [{ name: 'inventory', type: 'table' }]);
  const columns = (await request('/api/schema?table=inventory')).value;
  assert.deepEqual(columns.columns.map(column => column.name), ['id', 'title', 'region', 'payload']);
  const query = { name: 'catalog', path: '/catalog', method: 'GET', description: 'Selected inventory rows.', amount: '10000',
    sql: 'SELECT id,title,payload FROM inventory WHERE region=$region ORDER BY id', columns: ['id', 'title', 'payload'],
    parameters: { region: { type: 'string', maxLength: 64 } }, publicInput: { region: 'public-region-example' }, maxRows: 100 };
  const result = await request('/api/preview', { query, input: { region: 'north' } });
  assert.equal(result.status, 200); assert.equal(result.value.rows[0].id, '9007199254740993');
  assert.deepEqual(result.value.rows[0].payload, { $base64: 'AP8=' });
  const injected = await request('/api/preview', { query, input: { region: "north' OR 1=1 --" } });
  assert.equal(injected.value.rowCount, 0);
  const draft = { merchant: { name: 'Inventory API', origin: 'https://merchant.example', network: 'stellar:testnet',
    asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60 }, queries: [query,
    { ...query, name: 'summary', path: '/summary', method: 'POST', sql: 'SELECT COUNT(*) AS item_count FROM inventory WHERE region=$region', columns: ['item_count'] }] };
  const checked = await request('/api/inspect', { draft });
  assert.equal(checked.status, 200); assert.equal(checked.value.offers.length, 2);
  assert.deepEqual(checked.value.offers[0].extensions.bazaar.info.output.example.rows, []);
  const missingPublic = structuredClone(draft);
  missingPublic.queries[0].parameters.region.default = 'PRIVATE_DEFAULT'; missingPublic.queries[0].publicInput = {};
  assert.equal((await request('/api/inspect', { draft: missingPublic })).status, 422);
  const ambiguous = structuredClone(draft); ambiguous.queries.push({ ...query, name: 'catalog_case', path: '/CATALOG' });
  assert.equal((await request('/api/inspect', { draft: ambiguous })).status, 422);
  const saved = await request('/api/save', { draft, revision: initial.revision });
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/save', { draft, revision: initial.revision })).status, 409);
  const released = await request('/api/export', { name: 'pilot-1', revision: saved.value.revision });
  assert.equal(released.status, 200);
  assert.equal((await request('/api/export', { name: '../escape', revision: saved.value.revision })).status, 422);
  assert.equal((await request('/api/export', { name: 'pilot-1', revision: saved.value.revision })).status, 409);
  for (const name of released.value.files) {
    const path = join(released.value.directory, name), bytes = await readFile(path);
    assert.equal(bytes.includes(Buffer.from('PRIVATE_PREVIEW_SENTINEL')), false);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  handlers = await import(pathToFileURL(join(released.value.directory, 'handlers.mjs')).href);
  assert.equal(handlers.admit_0({ method: 'GET', query: { region: 'north' } }), true);
  assert.equal((await handlers.query_0({ method: 'GET', query: { region: 'north' } })).body.rows[0].id, '9007199254740993');
  assert.equal((await handlers.query_1({ method: 'POST', body: { region: 'north' } })).body.rows[0].item_count, '1');
  await handlers.source.close(); handlers = null;
  await session.close(); session = await startWorkbench({ database, workspace });
  const resumed = (await request('/api/state')).value;
  assert.equal(resumed.revision, saved.value.revision); assert.equal(resumed.draft.queries.length, 2); assert.equal(resumed.exports.length, 1);
  assert.equal(hash(await readFile(database)), original);
  console.log(JSON.stringify({ result: 'PASS', workflow: 'native SQLite → protected HTTP workspace → compiled GET/POST offers → private release → original generated handlers → restart',
    routes: 2, exactInteger: '9007199254740993', databaseUnchanged: true, previewRowsExported: false, paymentsAttempted: 0 }));
} finally { await handlers?.source.close(); await session?.close(); await rm(root, { recursive: true, force: true }); }
