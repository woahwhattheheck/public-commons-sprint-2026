// MIT. Actual SQLite concurrency and lifecycle exercise; no payment simulation.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createSqliteQuerySource } from './source.mjs';
import { openSqliteQueryFile } from './config.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sf30-sqlite-pool-'));
const database = join(directory, 'merchant.sqlite');
const db = new DatabaseSync(database);
db.exec("CREATE TABLE inventory(id INTEGER PRIMARY KEY, title TEXT, internal_note TEXT); BEGIN");
const insert = db.prepare('INSERT INTO inventory VALUES (?, ?, ?)');
for (let id = 1; id <= 100000; id++) insert.run(id, id === 1 ? '東京 🛰️' : `Part ${id}`, 'PRIVATE');
insert.run(9007199254740993n, 'Exact', 'PRIVATE'); db.exec('COMMIT'); db.close();
const sha = async () => createHash('sha256').update(await readFile(database)).digest('hex');
const original = await sha();
const queries = {
  item: { sql: 'SELECT id, title FROM inventory WHERE id=$id', columns: ['id', 'title'],
    parameters: { id: { type: 'integer', minimum: '1' } }, timeoutMs: 2000 },
  slow: { sql: 'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000000000) SELECT sum(n) AS total FROM seq',
    columns: ['total'], timeoutMs: 600 },
  queued: { sql: 'SELECT id FROM inventory WHERE id=1', columns: ['id'], timeoutMs: 50 },
};
const sources = [];
const make = async options => {
  const source = await createSqliteQuerySource({ database, queries, ...options });
  sources.push(source); return source;
};
const failCode = promise => promise.then(() => 'UNEXPECTED_SUCCESS', error => error.code);
const waitFor = async predicate => {
  const deadline = performance.now() + 4000;
  while (!predicate()) { assert(performance.now() < deadline, 'state transition deadline'); await delay(5); }
};
try {
  // Config forwarding and a fast lookup running independently of a long query.
  await writeFile(join(directory, 'source.json'), JSON.stringify({
    schema: 'stellar-forge.sqlite-source.v1', database: 'merchant.sqlite', queries,
    workerCount: 2, maxPending: 8,
  }));
  const pool = await openSqliteQueryFile(join(directory, 'source.json')); sources.push(pool);
  assert.equal(pool.stats().readyWorkers, 2);
  const slow = failCode(pool.query('slow', {}));
  const parallelStart = performance.now();
  const fast = await pool.query('item', { id: '9007199254740993' });
  const parallelLookupMs = performance.now() - parallelStart;
  assert.deepEqual(fast.rows, [{ id: '9007199254740993', title: 'Exact' }]);
  assert.equal(pool.stats().running, 1, 'slow query must still be executing');
  assert.equal(await slow, 'QUERY_TIMEOUT');
  const serial = await make({ workerCount: 1 });
  const serialSlow = failCode(serial.query('slow', {}));
  const serialStart = performance.now();
  await serial.query('item', { id: '1' });
  const serialLookupMs = performance.now() - serialStart;
  assert.equal(await serialSlow, 'QUERY_TIMEOUT');
  assert(serialLookupMs > parallelLookupMs, 'record actual head-of-line wait, not claimed CPU speedup');
  await serial.close();

  // A burst repairs the retired slot, multiplexes exact results, and stays read-only.
  const burst = await Promise.all(Array.from({ length: 8 }, (_, index) => pool.query('item', { id: String(index + 1) })));
  assert.deepEqual(burst.map(result => result.rows[0].id), Array.from({ length: 8 }, (_, i) => String(i + 1)));
  assert.equal(burst[0].rows[0].title, '東京 🛰️');
  assert(!JSON.stringify(burst).includes('PRIVATE'));
  await waitFor(() => pool.stats().readyWorkers === 2);

  // Both workers busy: queued timeout/cancellation must not kill either worker.
  const a = new AbortController(), b = new AbortController(), queued = new AbortController();
  const first = failCode(pool.query('slow', {}, { signal: a.signal }));
  const second = failCode(pool.query('slow', {}, { signal: b.signal }));
  const cancelled = failCode(pool.query('item', { id: '1' }, { signal: queued.signal }));
  const expires = failCode(pool.query('queued', {}));
  queued.abort(); assert.equal(await cancelled, 'QUERY_ABORTED');
  assert.equal(await expires, 'QUERY_TIMEOUT');
  assert.equal(pool.stats().running, 2); assert.equal(pool.stats().retiringWorkers, 0);
  a.abort(); assert.equal(await first, 'QUERY_ABORTED');
  const recovered = await pool.query('item', { id: '2' });
  assert.equal(recovered.rows[0].id, '2');
  assert.equal(pool.stats().running, 1, 'healthy peer query survives another worker abort');
  b.abort(); assert.equal(await second, 'QUERY_ABORTED');

  // Capacity is source-wide, not multiplied by worker count; queued close settles all.
  const capped = await make({ workerCount: 2, maxPending: 3 });
  const jobs = [failCode(capped.query('slow', {})), failCode(capped.query('slow', {})), failCode(capped.query('item', { id: '1' }))];
  await assert.rejects(capped.query('item', { id: '1' }), { code: 'SOURCE_BUSY' });
  assert.equal(capped.route('item').admit({ method: 'GET', query: { id: '1' } }).status, 429);
  assert.equal(capped.stats().running, 2); assert.equal(capped.stats().queued, 1);
  const close = capped.close(); assert.equal(capped.close(), close); await close;
  assert.deepEqual(await Promise.all(jobs), ['SOURCE_CLOSED', 'SOURCE_CLOSED', 'SOURCE_CLOSED']);
  assert.equal(capped.stats().processes, 0);

  // Real process failures: make a replacement database open fail after stopping both
  // readers. No worker code is swapped, no test-only process hooks are installed.
  const degraded = await make({ workerCount: 2, maxPending: 8 });
  const x = new AbortController(), y = new AbortController();
  const dx = failCode(degraded.query('slow', {}, { signal: x.signal }));
  const dy = failCode(degraded.query('slow', {}, { signal: y.signal }));
  await rename(database, `${database}.offline`);
  try {
    x.abort(); y.abort(); await Promise.all([dx, dy]);
    await waitFor(() => degraded.stats().processes === 0);
    const unavailable = await failCode(degraded.query('item', { id: '1' }));
    assert.notEqual(unavailable, 'UNEXPECTED_SUCCESS');
    assert.notEqual(unavailable, 'QUERY_TIMEOUT', 'startup failure settles queued work directly');
    const count = degraded.stats().workerStarts;
    await delay(50); assert.equal(degraded.stats().workerStarts, count, 'no background restart loop');
  } finally { await rename(`${database}.offline`, database); }
  assert.equal((await degraded.query('item', { id: '1' })).rows[0].title, '東京 🛰️');

  // Repeated aborts cannot transiently over-spawn or replay work after close.
  const storm = await make({ workerCount: 3, maxPending: 12 });
  for (let round = 0; round < 4; round++) {
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const aborts = controllers.map(controller => failCode(storm.query('slow', {}, { signal: controller.signal })));
    controllers.forEach(controller => controller.abort());
    assert.deepEqual(await Promise.all(aborts), Array(3).fill('QUERY_ABORTED'));
    const repairs = await Promise.all(Array.from({ length: 9 }, (_, i) => storm.query('item', { id: String(i + 1) })));
    assert.equal(repairs.length, 9); assert(storm.stats().peakProcesses <= 3);
  }
  const summary = { result: 'PASS', databaseRows: 100001,
    parallelLookupMs: +parallelLookupMs.toFixed(2), serialLookupMs: +serialLookupMs.toFixed(2),
    pool: pool.stats(), storm: storm.stats() };
  for (const source of sources) {
    await source.close(); assert.equal(source.stats().processes, 0);
    assert.equal(source.stats().pending, 0);
    await assert.rejects(source.query('item', { id: '1' }), { code: 'SOURCE_CLOSED' });
  }
  for (const value of [0, 9, 1.5, '2'])
    await assert.rejects(make({ workerCount: value }), /workerCount/);
  await assert.rejects(make({ workerCount: 3, queries: { invalid: { sql: 'SELECT * FROM missing_table', columns: ['id'] } } }), { code: 'QUERY_PREPARE_FAILED' });
  assert.equal(await sha(), original);
  console.log(JSON.stringify({ ...summary, unchangedSha256: original }, null, 2));
} finally {
  await Promise.all(sources.map(source => source.close()));
  await rm(directory, { recursive: true, force: true });
}
