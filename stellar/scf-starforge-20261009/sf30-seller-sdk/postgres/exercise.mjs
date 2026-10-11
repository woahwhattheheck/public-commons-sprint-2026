#!/usr/bin/env node
// MIT. One original PostgreSQL protocol + SF30 workflow; no payment simulator.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgresSourceFile, readPostgresSourceFile } from './config.mjs';
import { startPostgresMerchant } from './merchant.mjs';
import { compilePostgresQueries } from './declaration.mjs';
import { boundedProjectedStatement } from './stream.mjs';
import { Client } from 'pg';

const directory = await mkdtemp(join(tmpdir(), 'sf30-postgres-'));
const child = fork(fileURLToPath(new URL('./demo-database.mjs', import.meta.url)), [], {
  execArgv: [], env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
let source, session;
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DEMO_POSTGRES_START_TIMEOUT')), 30000);
    child.once('error', issue => { clearTimeout(timer); reject(issue); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('DEMO_POSTGRES_EXIT_' + code)); });
    child.on('message', message => { if (message?.event === 'ready') { clearTimeout(timer); resolve(message); } });
  });
  const config = JSON.parse(await readFile(new URL('./example-source.json', import.meta.url), 'utf8'));
  config.tls = 'local-plaintext'; config.maxConnections = 1; config.maxPending = 2;
  config.queries.catalog.maxRows = 2;
  config.queries.transaction = { sql: "SELECT current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation",
    parameters: {}, columns: ['readonly', 'isolation'] };
  config.queries.large = { sql: "SELECT repeat('x',1000000) AS value", parameters: {}, columns: ['value'], maxBytes: 1024 };
  config.queries.stream = { sql: "SELECT id, id::numeric(30,10) AS amount FROM generate_series(1,20) AS id",
    parameters: {}, columns: ['id', 'amount'], maxRows: 17, maxBytes: 8192 };
  config.queries.escaped = { sql: "SELECT repeat(chr(34),100) AS value FROM generate_series(1,20)",
    parameters: {}, columns: ['value'], maxRows: 20, maxBytes: 1024 };
  config.queries.slow = { sql: "SELECT 'done'::text AS value FROM pg_sleep(0.35)", parameters: {}, columns: ['value'], timeoutMs: 75 };
  const filename = join(directory, 'source.json');
  await writeFile(filename, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  const declaration = await readPostgresSourceFile(filename);
  assert.equal(declaration.description.catalog.columns.length, 5);
  // Verify the new guard at the actual protocol boundary: the million-byte
  // field is NULL before pg receives it, while the private flag signals failure.
  const wire = new Client({ connectionString: ready.uri });
  await wire.connect();
  try {
    const bounded = await wire.query(boundedProjectedStatement(compilePostgresQueries(config.queries).large));
    assert.deepEqual(Object.values(bounded.rows[0]), [null, true]);
    assert.ok(Buffer.byteLength(JSON.stringify(bounded.rows)) < 100);
  } finally { await wire.end(); }
  ({ source } = await openPostgresSourceFile(filename, { env: { SF30_POSTGRES_URL: ready.uri } }));
  const streamed = await source.query('stream', {});
  assert.equal(streamed.rowCount, 17); assert.equal(streamed.truncated, true);
  assert.equal(streamed.rows.at(-1).amount, '17.0000000000');
  assert.deepEqual(streamed.columnTypes, [{ name: 'id', oid: 23 }, { name: 'amount', oid: 1700 }]);
  const rows = await source.query('catalog', { region: 'north' });
  assert.equal(rows.rows[1].price_cents, '900719925474099312345');
  assert.equal(rows.rows[1].title, '東京 demo');
  assert.equal(rows.truncated, true);
  assert.ok(!Object.hasOwn(rows.rows[0], 'internal_note'));
  const next = await source.query('catalog', { region: 'north', after_id: rows.rows.at(-1).id });
  assert.equal(next.rows[0].id, '4');
  const transaction = await source.query('transaction', {});
  assert.deepEqual(transaction.rows[0], { readonly: 'on', isolation: 'repeatable read' });
  assert.equal((await source.query('catalog', { region: "north' OR 1=1 --" })).rowCount, 0);
  const route = source.route('catalog');
  const before = source.status().completed;
  assert.equal(route.admit({ method: 'GET', query: { region: 'north', sql: 'DELETE' } }).status, 422);
  assert.equal(source.status().completed, before);
  await assert.rejects(source.query('large', {}), issue => issue.code === 'QUERY_RESULT_TOO_LARGE');
  await assert.rejects(source.query('escaped', {}), issue => issue.code === 'QUERY_RESULT_TOO_LARGE');
  const slow = assert.rejects(source.query('slow', {}), issue => issue.code === 'QUERY_TIMEOUT');
  const pending = source.query('catalog', { region: 'north' });
  await assert.rejects(source.query('catalog', { region: 'north' }), issue => issue.code === 'SOURCE_BUSY');
  await slow; await pending;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source.query('catalog', { region: 'north' }, { signal: controller.signal }), issue => issue.code === 'QUERY_ABORTED');
  const seller = JSON.parse(await readFile(new URL('./example-service.json', import.meta.url), 'utf8'));
  session = await startPostgresMerchant({ source, config: seller, bindings: config.bindings, port: 0 });
  const unpaid = await fetch(session.url + '/catalog?region=north');
  assert.equal(unpaid.status, 402);
  assert.ok(unpaid.headers.get('payment-required'));
  assert.ok(!(await unpaid.text()).includes('900719925474099312345'));
  assert.equal((await fetch(session.url + '/_seller/docs')).status, 200);
  const application = await route.handler({ method: 'GET', query: { region: 'north' } });
  assert.equal(application.status, 200);
  assert.equal(application.body.rows[1].price_cents, '900719925474099312345');
  const inspection = source.inspect(), status = source.status();
  await session.close(); session = null;
  await assert.rejects(source.query('catalog', { region: 'north' }), issue => issue.code === 'SOURCE_CLOSED');
  console.log(JSON.stringify({ result: 'PASS', workflow: 'PostgreSQL TCP → named query source → original SF30',
    databaseEngine: ready.engine, serverVersion: inspection.serverVersion,
    driver: 'pg 8.23.1 / pg-cursor 2.22.1', exactNumeric: true, projection: true, keysetResume: true,
    streamingAcrossBatches: true, oversizedFieldSuppressedAtServer: true, escapedJsonBudget: true,
    readOnlyTransaction: true, typedAdmission: true, timeoutAndQueueRecovery: true,
    originalUnpaidStatus: 402, originalDeveloperPortal: 200,
    completedSourceQueries: status.completed, sourceClosed: true,
    paymentOperations: 0, hostedActions: 0 }, null, 2));
} finally {
  await session?.close().catch(() => {});
  await source?.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit').catch(() => {});
    if (child.connected) child.send({ event: 'stop' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await stopped; clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
