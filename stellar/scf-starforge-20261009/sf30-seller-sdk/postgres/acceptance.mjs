#!/usr/bin/env node
// MIT. One actual PostgreSQL/pg-wire/original-seller workflow; no wallet or CI.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgresQueryFile, readPostgresSourceFile, describePostgresFile } from './config.mjs';
import { startPostgresSeller } from './launch.mjs';
import { compilePostgresQueries } from './declaration.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sf30-postgres-'));
const child = fork(fileURLToPath(new URL('./acceptance-db.mjs', import.meta.url)), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
let source, session;
const message = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Database fixture deadline exceeded')), 30000);
  child.once('error', reject);
  child.once('message', result => { clearTimeout(timer); resolve(result); });
});
try {
  const ready = await message(); assert.ok(ready.version.includes('PostgreSQL'));
  const original = JSON.parse(await readFile(new URL('./example-source.json', import.meta.url)));
  const offline = describePostgresFile(await readPostgresSourceFile(fileURLToPath(new URL('./example-source.json', import.meta.url))));
  assert.equal(offline.queries.catalog.valueEncoding, 'postgres-text');
  assert.ok(!JSON.stringify(offline).includes('database.merchant.example'));
  original.connection = { host: '127.0.0.1', port: ready.port, user: 'postgres', database: 'postgres', tls: 'disable-loopback' };
  original.poolSize = 1; original.maxPending = 2;
  original.queries.catalog.maxRows = 2;
  original.queries.catalog.sql = 'SELECT * FROM merchant.catalog WHERE region=$1::text AND id>$2::bigint ORDER BY id';
  original.queries.catalog.columns = ['id', 'title', 'price_cents', 'precise', 'active', 'extra'];
  original.queries.large = { sql: "SELECT repeat('x', 100000) AS value", columns: ['value'], maxBytes: 1024 };
  original.queries.write = { sql: 'SELECT merchant.forbidden_write() AS changed', columns: ['changed'] };
  original.queries.guard = { sql: 'SELECT count(*) AS count FROM merchant.write_guard', columns: ['count'] };
  original.queries.pause = { sql: 'SELECT pg_sleep($1::double precision) AS slept', parameterOrder: ['seconds'],
    parameters: { seconds: { type: 'number', minimum: 0, maximum: 1 } }, columns: ['slept'], timeoutMs: 120 };
  original.queries.quoted = { sql: "SELECT $quoted$not a $1; statement$quoted$ AS value /* outer /* nested */ end */", columns: ['value'] };
  const sourcePath = join(directory, 'source.json'), servicePath = join(directory, 'service.json');
  await writeFile(sourcePath, JSON.stringify(original), { mode: 0o600 });
  await writeFile(servicePath, await readFile(new URL('./example-service.json', import.meta.url)), { mode: 0o600 });
  ({ source } = await openPostgresQueryFile(sourcePath));
  const first = await source.query('catalog', { region: 'north' });
  assert.equal(first.rowCount, 2); assert.equal(first.truncated, true);
  assert.equal(first.rows[0].id, '9007199254740993'); assert.equal(first.rows[0].price_cents, '9223372036854775807');
  assert.equal(first.rows[0].precise, '12345678901234567890.123456789'); assert.equal(first.rows[0].title, 'Café 東京');
  assert.equal(first.rows[0].active, 'true'); assert.equal(first.rows[1].extra, null);
  assert.ok(first.rows[0].extra.includes('9007199254740993')); assert.ok(!JSON.stringify(first).includes('NEVER_PUBLIC'));
  const next = await source.query('catalog', { region: 'north', after_id: first.rows.at(-1).id });
  assert.equal(next.rowCount, 1); assert.equal(next.truncated, false);
  assert.equal((await source.query('quoted', {})).rows[0].value, 'not a $1; statement');
  const pair = source.route('catalog');
  assert.equal(pair.admit({ method: 'GET', query: { region: ['north', 'north'] } }).status, 422);
  assert.equal(pair.admit({ method: 'GET', query: { region: 'north', sql: 'DROP TABLE merchant.catalog' } }).status, 422);
  assert.equal((await source.query('catalog', { region: "north' OR TRUE --" })).rowCount, 0);
  await assert.rejects(source.query('large', {}), { code: 'QUERY_RESULT_TOO_LARGE' });
  await assert.rejects(source.query('write', {}), { code: 'QUERY_READ_ONLY_VIOLATION' });
  assert.equal((await source.query('guard', {})).rows[0].count, '0');
  const pending = source.query('pause', { seconds: 0.3 });
  const queued = source.query('pause', { seconds: 0.1 });
  await assert.rejects(source.query('catalog', { region: 'north' }), { code: 'SOURCE_BUSY' });
  assert.equal(pair.admit({ method: 'GET', query: { region: 'north' } }).status, 429);
  const timed = await Promise.allSettled([pending, queued]);
  assert.ok(timed.every(result => result.status === 'rejected' && result.reason.code === 'QUERY_TIMEOUT'));
  // The WASM server runs in its own process; a delayed SQL operation cannot
  // block this adapter's event loop or deadline. Its serial engine is disclosed.
  assert.equal((await source.query('catalog', { region: 'north' })).rowCount, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source.query('catalog', { region: 'north' }, { signal: controller.signal }), { code: 'QUERY_ABORTED' });
  await source.close(); source = null;
  session = await startPostgresSeller({ sourceFile: sourcePath, configFile: servicePath, port: 0, operationsPort: 0 });
  const challenge = await fetch(session.seller.url + '/catalog?region=north');
  assert.equal(challenge.status, 402); assert.ok(challenge.headers.get('payment-required'));
  assert.equal(session.source.status().active, 0);
  assert.equal((await fetch(session.seller.url + '/_seller/offers')).status, 200);
  assert.equal((await fetch(session.operations.url)).status, 200);
  const actual = await session.source.route('catalog').handler({ method: 'GET', query: { region: 'north' } });
  assert.equal(actual.status, 200); assert.equal(actual.body.rows[0].id, '9007199254740993');
  assert.throws(() => compilePostgresQueries({ broken: { sql: 'SELECT $2::text AS value', parameters: { value: { type: 'string' } }, parameterOrder: ['value'], columns: ['value'] } }));
  console.log(JSON.stringify({ result: 'PASS', engine: ready.version, driver: 'pg 8.23.1 / pg-cursor 2.22.1',
    adapter: 'PGlite 0.5.8 / pglite-socket 0.2.11', workflow: 'named-query, exact-values, paging, projection, read-only, overload, deadlines, recovery, original-seller-402, operations', payments: 0 }));
} finally {
  await session?.close(); await source?.close();
  child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true });
}
