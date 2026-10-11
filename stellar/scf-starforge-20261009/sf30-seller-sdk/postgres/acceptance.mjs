// MIT. One focused actual PostgreSQL + original seller exercise, no CI entrypoint.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createPostgresQuerySource } from './source.mjs';
import { compilePostgresQueries } from './parameters.mjs';
import { startPostgresSeller } from './serve.mjs';
import { describePostgresSourceFile } from './config.mjs';
import { createNativeSellerServer } from '../native-factory.mjs';

/** connection must reference a disposable, operator-owned local cluster. */
export async function exercise(connection) {
  assert(['127.0.0.1', '::1'].includes(connection.host), 'Use a disposable loopback PostgreSQL cluster');
  const suffix = randomBytes(6).toString('hex'), schema = `sf30_accept_${suffix}`, role = `sf30_reader_${suffix}`;
  const owner = new pg.Client(connection);
  const directory = await mkdtemp(join(tmpdir(), 'sf30-postgres-accept-'));
  let source, limited, seller;
  await owner.connect();
  const version = (await owner.query('SHOW server_version')).rows[0].server_version;
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    await owner.query(`CREATE ROLE ${role} LOGIN`);
    await owner.query(`CREATE TABLE ${schema}.catalog (id bigint primary key, region text, label text, price numeric(28,8), secret text, data bytea, active boolean)`);
    await owner.query(`INSERT INTO ${schema}.catalog SELECT 9007199254740992::bigint+i, 'north', 'café '||i, 12345678901234567890.12345678, 'private', decode('00ff','hex'), true FROM generate_series(1,1001) i`);
    await owner.query(`CREATE INDEX ON ${schema}.catalog (region,id)`);
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await owner.query(`GRANT SELECT ON ${schema}.catalog TO ${role}`);
    const reader = { ...connection, user: role };
    const queries = {
      catalog: { sql: `SELECT id, label, price, data, active, secret FROM ${schema}.catalog WHERE region=$1::text AND id>$2::bigint ORDER BY id`,
        parameters: [{ name: 'region', type: 'string', maxLength: 80 }, { name: 'after_id', type: 'integer', default: '0', minimum: '0' }],
        columns: ['id', 'label', 'price', 'data', 'active'], maxRows: 10 },
      types: { sql: 'SELECT $1::numeric AS amount, $2::boolean AS enabled, $3::bigint AS n',
        parameters: [{ name: 'amount', type: 'decimal', minimum: '-0.2', maximum: '99999999999999999999.99' },
          { name: 'enabled', type: 'boolean' }, { name: 'n', type: 'integer' }], columns: ['amount', 'enabled', 'n'] },
      mode: { sql: "SELECT current_setting('transaction_read_only') AS mode", columns: ['mode'] },
      oversized: { sql: "SELECT repeat('x', 4096) AS data", columns: ['data'], maxBytes: 1024 },
      slow: { sql: 'SELECT pg_sleep($1::double precision)::text AS waited', parameters: [{ name: 'seconds', type: 'decimal', minimum: '0', maximum: '2' }], columns: ['waited'], timeoutMs: 100 },
      wait: { sql: 'SELECT pg_sleep($1::double precision)::text AS waited', parameters: [{ name: 'seconds', type: 'decimal', minimum: '0', maximum: '2' }], columns: ['waited'], timeoutMs: 1000 },
    };
    source = await createPostgresQuerySource({ connection: reader, queries, maxConnections: 2, maxPending: 4 });
    const page = await source.query('catalog', { region: 'north' });
    assert.equal(page.rowCount, 10); assert.equal(page.truncated, true);
    assert.deepEqual(Object.keys(page.rows[0]), ['id', 'label', 'price', 'data', 'active']);
    assert.equal(page.rows[0].id, '9007199254740993'); assert.equal(page.rows[0].price, '12345678901234567890.12345678');
    assert.equal(page.rows[0].data, '\\x00ff'); assert.equal(page.rows[0].active, 't');
    assert.equal((await source.query('catalog', { region: "north' OR TRUE --" })).rowCount, 0);
    assert.equal((await source.query('catalog', { region: 'north', after_id: page.rows.at(-1).id })).rows[0].id, '9007199254741003');
    assert.equal((await source.query('mode', {})).rows[0].mode, 'on');
    const typed = await source.query('types', { amount: '-0.100000000000000001', enabled: false, n: '9223372036854775807' });
    assert.equal(typed.rows[0].amount, '-0.100000000000000001'); assert.equal(typed.rows[0].enabled, 'f');
    await assert.rejects(source.query('types', { amount: '-0.200000000000000001', enabled: true, n: 1 }), { code: 'OUT_OF_RANGE' });
    await assert.rejects(source.query('catalog', { region: ['north', 'south'] }), { code: 'EXPECTED_STRING' });
    await assert.rejects(source.query('catalog', { region: 'north', sql: 'SELECT 1' }), { code: 'UNKNOWN_PARAMETER' });
    await assert.rejects(source.query('oversized', {}), { code: 'QUERY_RESULT_TOO_LARGE' });
    await assert.rejects(source.query('slow', { seconds: '0.5' }), { code: 'QUERY_TIMEOUT' });
    assert.equal((await source.query('mode', {})).rows[0].mode, 'on');
    limited = await createPostgresQuerySource({ connection: reader, queries, maxConnections: 1, maxPending: 2 });
    const abort = new AbortController();
    const first = limited.query('wait', { seconds: '0.6' }, { signal: abort.signal });
    const second = limited.query('mode', {});
    await assert.rejects(limited.query('mode', {}), { code: 'SOURCE_BUSY' });
    abort.abort(); await assert.rejects(first, { code: 'QUERY_ABORTED' });
    assert.equal((await second).rows[0].mode, 'on');
    await limited.close(); limited = null;
    assert.throws(() => compilePostgresQueries({ bad: { sql: 'SELECT 1 AS n; SELECT 2', columns: ['n'] } }), /one SELECT/);
    const sourceFile = join(directory, 'source.json'), configFile = join(directory, 'service.json');
    await writeFile(sourceFile, JSON.stringify({ schema: 'stellar-forge.postgres-source.v1', connectionStringEnv: 'ACCEPTANCE_DB',
      tls: 'disable', allowLocalDatabase: true, queries }), { mode: 0o600 });
    const config = JSON.parse(await readFile(new URL('./example-service.json', import.meta.url), 'utf8'));
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    const env = { ACCEPTANCE_DB: `postgresql://${role}@127.0.0.1:${connection.port}/${connection.database}` };
    const bindings = { catalog: { query: 'catalog', input: 'query' } };
    const offline = await describePostgresSourceFile(sourceFile);
    assert.equal(JSON.stringify(offline).includes(schema), false);
    seller = await startPostgresSeller({ configFile, sourceFile, bindings, env, port: 0 });
    let response = await fetch(seller.url + '/catalog?region=north');
    assert.equal(response.status, 402); assert(response.headers.get('payment-required'));
    assert.equal(seller.source.status().connected, 0);
    await seller.close(); seller = null;
    let verified = 0, settled = 0;
    const facilitatorClient = {
      async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }; },
      async verify() { verified++; return { isValid: false, invalidReason: 'acceptance_has_no_payment' }; },
      async settle() { settled++; throw new Error('Acceptance must never settle'); },
    };
    seller = await startPostgresSeller({ configFile, sourceFile, bindings, env, port: 0,
      nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient }) });
    response = await fetch(seller.url + '/catalog?region=north&after_id=invalid');
    assert.equal(response.status, 422); assert.equal((await response.json()).code, 'EXPECTED_INTEGER');
    response = await fetch(seller.url + '/catalog?region=north');
    assert.equal(response.status, 402); assert(response.headers.get('payment-required'));
    assert.equal(seller.source.status().connected, 0); assert.equal(verified, 0); assert.equal(settled, 0);
    const nativeData = await seller.source.route('catalog').handler({ method: 'GET', query: { region: 'north' } });
    assert.equal(nativeData.status, 200); assert.equal(nativeData.body.rows[0].id, page.rows[0].id);
    assert.equal((await owner.query(`SELECT count(*)::text AS n FROM ${schema}.catalog`)).rows[0].n, '1001');
    await seller.close(); seller = null; await source.close();
    await assert.rejects(source.query('mode', {}), { code: 'SOURCE_CLOSED' }); source = null;
    return { ok: true, postgres: version, node: process.version, rows: 1001,
      exercised: ['exact PostgreSQL data', 'bound values/projection/keyset paging', 'read-only transaction', 'source capacity/deadline/abort/recovery',
        'offline private source description', 'original SF30 challenge', 'original x402 2.28 admission before payment', 'source/seller shutdown'],
      paymentCalls: { verify: verified, settle: settled }, hostedActions: 0 };
  } finally {
    await seller?.close(); await limited?.close(); await source?.close();
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.query(`DROP ROLE IF EXISTS ${role}`);
    await owner.end(); await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const url = new URL(process.env.SF30_PG_ACCEPTANCE_URL ?? '');
    const result = await exercise({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) { process.stderr.write(JSON.stringify({ error: error?.code ?? error.name, message: error.message }) + '\n'); process.exitCode = 1; }
}
