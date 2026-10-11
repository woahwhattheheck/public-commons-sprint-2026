#!/usr/bin/env node
// MIT. One actual DuckDB/Parquet → original SF30 lifecycle; no payment simulator.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startDuckdbSeller } from './merchant.mjs';
const python = process.argv[2] ?? 'python3';
const temporary = await mkdtemp(join(tmpdir(), 'sf30-duckdb-exercise-'));
const directory = join(temporary, 'merchant');
let session;
try {
  const created = await promisify(execFile)(python,
    ['-I', fileURLToPath(new URL('./create-example.py', import.meta.url)), directory], { timeout: 30000 });
  const seed = JSON.parse(created.stdout);
  const sourceFile = join(directory, 'source.json'), configFile = join(directory, 'service.json');
  const config = JSON.parse(await readFile(sourceFile, 'utf8'));
  config.maxWorkers = 1; config.maxPending = 2; config.queries.catalog.maxRows = 2;
  config.queries.large = { sql: "SELECT repeat('x', 2000000) AS value", parameters: {}, columns: ['value'], maxBytes: 1024, timeoutMs: 5000 };
  config.queries.slow = { sql: 'SELECT SUM(SIN(i)) AS total FROM range(1000000000) AS r(i)', parameters: {}, columns: ['total'], timeoutMs: 200 };
  await writeFile(sourceFile, JSON.stringify(config));
  session = await startDuckdbSeller({ sourceFile, configFile, python, port: 0, operationsPort: 0 });
  const unpaid = await fetch(session.seller.url + '/catalog?region=north');
  assert.equal(unpaid.status, 402);
  assert.ok(unpaid.headers.get('payment-required'));
  assert.equal(session.source.status().completed, 0);
  assert.equal((await fetch(session.operations.url)).status, 200);
  assert.equal((await fetch(session.seller.url + '/_seller/docs')).status, 200);
  const route = session.source.route('catalog');
  assert.equal(route.admit({ method: 'GET', query: { region: 'north', sql: 'SELECT 1' } }).status, 422);
  assert.equal(session.source.status().completed, 0);
  // Changing the operator's config cannot change the already-open declaration.
  const changed = structuredClone(config); changed.queries.catalog.sql = "SELECT 'changed' AS value";
  await writeFile(sourceFile, JSON.stringify(changed));
  const application = await route.handler({ method: 'GET', query: { region: 'north' } });
  assert.equal(application.status, 200);
  const rows = application.body;
  assert.equal(rows.rows[1].price, '900719925474099312345.123456');
  assert.equal(rows.rows[1].title, '東京 demo');
  assert.equal(rows.truncated, true);
  assert.ok(!Object.hasOwn(rows.rows[0], 'internal_note'));
  const next = await session.source.query('catalog', { region: 'north', after_id: rows.rows.at(-1).id });
  assert.equal(next.rows[0].id, '4');
  const sales = await session.source.query('regionalSales', { region: 'north' });
  assert.deepEqual(sales.rows[0], { region: 'north', events: '2', total: '599.010000' });
  await assert.rejects(session.source.query('large'), issue => issue.code === 'RESULT_TOO_LARGE');
  const slow = assert.rejects(session.source.query('slow'), issue => issue.code === 'QUERY_TIMEOUT');
  const pending = session.source.query('catalog', { region: 'north' });
  await assert.rejects(session.source.query('catalog', { region: 'north' }), issue => issue.code === 'SOURCE_BUSY');
  await slow; await pending;
  const stats = session.source.status(), inspection = session.source.inspect();
  await session.close();
  assert.equal(session.source.status().active, 0);
  assert.equal(session.source.status().state, 'CLOSED');
  console.log(JSON.stringify({ result: 'PASS', workflow: 'Local DuckDB + approved Parquet → original SF30 seller and operations',
    engineVersion: seed.engineVersion, sourceVersion: inspection.engineVersion, integerAndDecimalStrings: true,
    unicodeAndProjection: true, keysetResume: true, actualParquetAggregate: true, immutableDeclaration: true,
    oversizedRowSuppressed: true, deadlineAndQueueRecovery: true,
    originalUnpaidStatus: 402, originalOperations: 200, completedQueries: stats.completed,
    sourceClosed: true, paymentOperations: 0, hostedActions: 0 }, null, 2));
} finally {
  await session?.close().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
