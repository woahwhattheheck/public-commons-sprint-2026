// MIT. One native Redis merchant, original buyer and retained-release journey.
// Native TCP mode requires redis-server 7+. Optional upstash-rest uses an owned ephemeral database.
// Both modes use the existing local x402 facilitator fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { validateUpstashEndpoint } from './upstash-rest.mjs';
import { createRedisQuerySource } from './source.mjs';
import { compileRedisQueries } from './declaration.mjs';
import { prepareRedisSeller, verifyPreparedRedisSeller } from './prepare.mjs';
import { inspectSellerClientExport } from '../developer/client-export.mjs';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';
import { prepareBuyerResponseFile } from '../../sf31-buyer-client/response-file.mjs';
import { initReleaseStore, stageRelease, inspectRelease, compareReleases } from '../../sf82-seller-pilot/releases.mjs';
import { startReleaseConsole } from '../../sf82-seller-pilot/release-console.mjs';

const http = process.env.SF30_REDIS_JOURNEY_PROVIDER === 'upstash-rest';
if (process.env.SF30_REDIS_JOURNEY_PROVIDER && !http) throw new Error('REDIS_JOURNEY_PROVIDER_INVALID');
const { createClient } = http ? {} : await import('@redis/client');
const endpoint = http ? validateUpstashEndpoint(process.env.UPSTASH_REDIS_REST_URL) : null;
const seedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
if (http && (!seedToken || process.env.SF30_UPSTASH_JOURNEY_ALLOW_SEED !== 'owned-ephemeral-database'))
  throw new Error('UPSTASH_JOURNEY_REQUIRES_OWNED_EPHEMERAL_DATABASE');
const prefix = http ? 'sf30-journey:' + randomBytes(12).toString('hex') + ':' : '';
const key = value => prefix + value;
async function createRestSeed() {
  const seeded = new Set(); let opened = true;
  async function send(command, binary) {
    const headers = { authorization: 'Bearer ' + seedToken, 'user-agent': 'starforge-merchant/native-journey',
      'content-type': binary ? 'application/octet-stream' : 'application/json' };
    const url = binary ? endpoint + '/set/' + encodeURIComponent(command[1]) : endpoint;
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers,
      signal: AbortSignal.timeout(15000), body: binary ?? JSON.stringify(command) });
    const value = await response.json();
    if (response.status !== 200 || value.error) throw new Error('UPSTASH_SEED:' + String(value.error ?? response.status).slice(0,512));
    if (['SET','HSET','ZADD','XADD'].includes(command[0])) seeded.add(command[1]);
    return value.result;
  }
  return {
    get isOpen() { return opened; }, destroy() { opened = false; },
    info: section => send(['INFO', section]), sendCommand: command => send(command),
    set: (name, value) => Buffer.isBuffer(value) ? send(['SET',name],value) : send(['SET',name,value]),
    hSet: (name, fields) => send(['HSET',name,...Object.entries(fields).flat()]),
    zAdd: (name, rows) => send(['ZADD',name,...rows.flatMap(row => [String(row.score),row.value])]),
    cleanup: async () => { const count = seeded.size; if (count) await send(['DEL',...seeded]); seeded.clear(); return count; },
  };
}

const work = await mkdtemp(join(tmpdir(), 'sf30-redis-journey-'));
const output = process.env.SF30_REDIS_JOURNEY_OUTPUT;
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const shutdown = async server => { server.closeAllConnections?.(); await new Promise(done => server.close(done)); };
const portProbe = tcpServer(); await listen(portProbe);
const port = portProbe.address().port; await shutdown(portProbe);
const binary = process.env.REDIS_SERVER ?? 'redis-server';
let nativeLog = '', operator, database, source, verified = 0, settled = 0;
const password = http ? (process.env.UPSTASH_REDIS_REST_READ_TOKEN ?? seedToken) : randomBytes(24).toString('hex');
const envName = 'SF30_REDIS_JOURNEY_PASSWORD';
const priorEnv = process.env[envName]; process.env[envName] = password;
const engine = http ? null : spawn(binary, ['--bind', '127.0.0.1', '--port', String(port), '--save', '',
  '--appendonly', 'no', '--dir', work], { stdio: ['ignore', 'pipe', 'pipe'] });
engine?.stdout.on('data', value => { nativeLog = (nativeLog + value).slice(-8192); });
engine?.stderr.on('data', value => { nativeLog = (nativeLog + value).slice(-8192); });
const facilitator = createServer(async (req, res) => {
  for await (const chunk of req) { /* Original native SDK request body. */ }
  const result = req.url === '/supported' ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }
    : req.url === '/verify' ? (verified++, { isValid: true, payer: 'LOCAL_REDIS_JOURNEY' })
    : req.url === '/settle' ? { success: true, network: 'stellar:testnet',
      transaction: createHash('sha256').update('LOCAL_REDIS_JOURNEY_' + ++settled).digest('hex'), payer: 'LOCAL_REDIS_JOURNEY' } : null;
  res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
});
try {
  if (!http) {
  await Promise.race([
    new Promise((resolve, reject) => {
      const onData = () => { if (nativeLog.includes('Ready to accept connections')) { engine.stdout.off('data', onData); resolve(); } };
      engine.stdout.on('data', onData); engine.once('error', reject);
      engine.once('exit', code => reject(new Error('REDIS_START_FAILED:' + code + ':' + nativeLog))); onData();
    }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('REDIS_START_TIMEOUT')), 10000); timer.unref(); }),
  ]);
  database = createClient({ socket: { host: '127.0.0.1', port, reconnectStrategy: false }, database: 2 });
  database.on('error', () => {}); await database.connect();
  } else database = await createRestSeed();
  const serverInfo = await database.info('server');
  const version = typeof serverInfo === 'string' ? serverInfo.match(/^redis_version:(.+)$/m)?.[1]?.trim() : undefined;
  if (!version) throw new Error('REDIS_SERVER_VERSION_UNAVAILABLE');
  if (!http) await database.sendCommand(['ACL', 'SETUSER', 'merchant', 'reset', 'on', '>' + password,
    '~merchant:*', '+ping', '+eval_ro', '+strlen', '+get', '+hstrlen', '+hmget', '+zrange', '+xrange', '+select']);
  const binaryValue = Buffer.from([255, 0, 239, 187, 191]);
  await database.set(key('merchant:availability:catalog'), binaryValue);
  await database.hSet(key('merchant:catalog:north'), { product_id: 'SKU-001', name: 'Bearing', price_atomic: '9007199254740993' });
  await database.zAdd(key('merchant:rankings:daily'), [{ score: 1.25, value: 'first' }, { score: 2.5, value: 'second' }, { score: 3.75, value: 'third' }]);
  await database.sendCommand(['XADD', key('merchant:events'), '1-0', 'event_type', 'created', 'event_type', 'updated', 'product_id', 'SKU-001', 'quantity', '3']);
  await database.sendCommand(['XADD', key('merchant:events'), '2-0', 'event_type', 'sold', 'product_id', 'SKU-002']);
  await database.sendCommand(['XADD', key('merchant:events'), '3-0', 'event_type', 'restocked', 'product_id', 'SKU-003', 'quantity', '7']);
  await database.set(key('merchant:large'), 'x'.repeat(1025));
  await database.set(key('merchant:binary-large'), Buffer.alloc(800, 255));
  const declaration = JSON.parse(await readFile(new URL('./example-source.json', import.meta.url)));
  declaration.connection = http ? { transport: 'upstash-rest', endpoint, tokenEnv: envName }
    : { host: '127.0.0.1', port, database: 2, username: 'merchant', passwordEnv: envName, tls: 'local-plaintext' };
  if (http) for (const query of Object.values(declaration.queries)) query.key = key(query.key);
  declaration.queries.catalog.fields.missing = 'missing_field';
  declaration.queries.leaderboard.maxRows = 2; declaration.queries.leaderboard.parameters.offset.maximum = '2';
  declaration.queries.events.maxRows = 2;
  const queries = { ...declaration.queries,
    oversized: { kind: 'get', key: key('merchant:large'), maxBytes: 1024 },
    encodedOversized: { kind: 'get', key: key('merchant:binary-large'), maxBytes: 1024 },
    offsetBoundary: { ...declaration.queries.leaderboard, maxRows: 1,
      parameters: { offset: { type: 'integer', minimum: '0', maximum: '2', enum: ['0', '2'], default: '0' } } },
    afterBoundary: { ...declaration.queries.events, parameters: { after: { type: 'string', maxLength: 41, enum: ['-'], default: '-' } } },
  };
  const connection = http ? { transport: 'upstash-rest', endpoint, token: password }
    : { socket: { host: '127.0.0.1', port }, database: 2, username: 'merchant', password };
  await assert.rejects(createRedisQuerySource({ connection: { ...connection, ...(http ? { token: 'wrong' } : { password: 'wrong' }) }, queries }), error =>
    ['SOURCE_ACCESS_DENIED', 'QUERY_UNAVAILABLE'].includes(error.code));
  source = await createRedisQuerySource({ connection, queries, maxConnections: 2, maxPending: 8 });
  assert.deepEqual((await source.query('availability', {})).rows[0].availability, { base64: binaryValue.toString('base64') });
  const catalog = await source.query('catalog', {}); assert.equal(catalog.rows[0].priceAtomic, '9007199254740993'); assert.equal(catalog.rows[0].missing, null);
  const ranks = await source.query('leaderboard', {}); assert.equal(ranks.rowCount, 2); assert.deepEqual(ranks.nextInput, { offset: '2' });
  assert.equal((await source.query('leaderboard', ranks.nextInput)).rows[0].itemId, 'third');
  const events = await source.query('events', {}); assert.equal(events.rows[0].eventType, 'updated'); assert.equal(events.rows[1].quantity, null);
  assert.equal((await source.query('events', events.nextInput)).rows[0].id, '3-0');
  assert.equal((await source.query('offsetBoundary', {})).continuationUnavailable, 'INPUT_LIMIT');
  assert.equal((await source.query('afterBoundary', {})).continuationUnavailable, 'INPUT_LIMIT');
  for (const name of ['oversized', 'encodedOversized']) assert.equal((await source.route(name).handler({ query: {} })).status, 413);
  const invalid = source.route('catalog').admit({ query: { region: 'elsewhere' } }); assert.equal(invalid.status, 422);
  assert.throws(() => compileRedisQueries({ bad: { kind: 'get', key: '\ud800' } }));
  assert.throws(() => compileRedisQueries({ bad: { ...declaration.queries.events,
    parameters: { after: { type: 'string', maxLength: 41, enum: ['bad'] } } } }));
  const nativeStatus = source.status(); await source.close(); source = null;
  // The merchant ACL independently rejects mutation and undeclared key access.
  if (!http) {
  const reader = createClient({ ...connection, disableClientInfo: true }); reader.on('error', () => {});
  await reader.connect();
  try { await assert.rejects(reader.set(key('merchant:forbidden'), 'x'), /NOPERM/); await assert.rejects(reader.get('other:key'), /NOPERM/); }
  finally { reader.destroy(); }
  } else await assert.rejects(database.sendCommand(['EVAL_RO', "return redis.call('SET', KEYS[1], 'x')", '1', key('merchant:forbidden')]), /read.?only|write commands/i);

  await listen(facilitator);
  const authoring = join(work, 'authoring'); await mkdir(authoring);
  const sourceFile = join(authoring, 'source.json'), planFile = join(authoring, 'plan.json');
  const plan = JSON.parse(await readFile(new URL('./example-merchant-plan.json', import.meta.url)));
  plan.routes[1].parameterDescriptions = { region: 'Reviewed region' };
  await write(sourceFile, declaration); await write(planFile, plan);
  const firstPackage = await prepareRedisSeller({ sourceFile, planFile, directory: join(authoring, 'first') });
  await verifyPreparedRedisSeller(firstPackage.directory);
  const root = join(work, 'releases'); await initReleaseStore(root);
  const runtime = { port: 0, allowLocalFacilitator: true, facilitator: `http://127.0.0.1:${facilitator.address().port}` };
  await stageRelease(root, { id: 'first', redisPackage: firstPackage.directory, runtime });
  declaration.queries.leaderboard.maxRows = 1; plan.payment.amount = '20000';
  await write(sourceFile, declaration); await write(planFile, plan);
  const secondPackage = await prepareRedisSeller({ sourceFile, planFile, directory: join(authoring, 'second') });
  await stageRelease(root, { id: 'second', redisPackage: secondPackage.directory, runtime });
  const comparison = await compareReleases(root, 'first', 'second'); assert.equal(comparison.summary.paymentChanged, 4);
  assert.ok(comparison.runtimeChanges.some(change => change.field === 'redis'));
  await rm(authoring, { recursive: true });
  const retained = await inspectRelease(root, 'first'); assert.equal(retained.redis.queries.leaderboard.maxRows, 2);
  const clientDirectory = join(root, 'releases', 'first', 'redis', 'package', 'client');
  assert.equal((await inspectSellerClientExport({ directory: clientDirectory })).state, 'COMPLETE');
  const generated = await import(pathToFileURL(join(clientDirectory, 'seller-client.mjs')));
  assert.equal(generated.operations.length, 4);
  operator = await startReleaseConsole(root, { port: 0 });
  const call = async (path, value) => {
    const response = await fetch(operator.url + path, { method: 'POST', headers: {
      'x-release-token': operator.token, origin: operator.url, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  await call('/api/activate', { id: 'first', expectedGeneration: 0, reason: 'Original native Redis merchant' });
  let state = await call('/api/run', { expectedGeneration: 1 });
  const deliveries = [];
  const buy = async (route, query, amount, name) => {
    const buyer = new X402BuyerClient({ fetchImpl: (url, options) => {
      const target = new URL(url); return fetch(state.runtime.observed.listener + target.pathname + target.search, options);
    } });
    const client = generated.createSellerClient({ buyer });
    const destination = join(work, name + '.json');
    const saved = await prepareBuyerResponseFile({ destination, maxBytes: 65536, expectedContentType: 'application/json' });
    try {
      const result = await client.call(route, { query }, { intentId: 'native-redis-' + name, maxAtomic: amount,
        approve: () => true, sign: async ({ challenge, accepted }) => ({ x402Version: 2, resource: challenge.resource,
          accepted, extensions: challenge.extensions, payload: { nativeRedisJourney: 'LOCAL_PROTOCOL' } }) });
      assert.equal(result.status, 'DELIVERED_REPORTED_SETTLED', JSON.stringify({ reason: result.reason, httpStatus: result.httpStatus }));
      const file = await saved.save(result), bytes = await readFile(destination);
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
      deliveries.push({ name, bytes: bytes.length, sha256: file.sha256 }); return JSON.parse(bytes);
    } finally { await saved.abort(); }
  };
  assert.deepEqual((await buy('availability', {}, '10000', 'availability')).rows[0].availability, { base64: binaryValue.toString('base64') });
  assert.equal((await buy('catalog', { region: 'north' }, '10000', 'catalog')).rows[0].priceAtomic, '9007199254740993');
  assert.equal((await buy('leaderboard', { offset: '0' }, '10000', 'rank-first')).rowCount, 2);
  assert.equal((await buy('events', { after: '-' }, '10000', 'events')).rows[0].eventType, 'updated');
  const firstInstance = state.console.instanceId;
  await call('/api/activate', { id: 'second', expectedGeneration: 1, reason: 'Updated ranking page and price' });
  state = await call('/api/restart', { expectedGeneration: 2, instanceId: firstInstance });
  assert.equal((await buy('leaderboard', { offset: '0' }, '20000', 'rank-upgraded')).rowCount, 1);
  await call('/api/rollback', { expectedGeneration: 2, reason: 'Restore retained merchant terms and query' });
  state = await call('/api/restart', { expectedGeneration: 3, instanceId: state.console.instanceId });
  assert.equal((await buy('leaderboard', { offset: '0' }, '10000', 'rank-restored')).rowCount, 2);
  await call('/api/stop', { instanceId: state.console.instanceId });
  const removedSeedKeys = http ? await database.cleanup() : undefined;
  const result = { result: 'PASS', redisVersion: version, nativeClient: http ? 'Upstash REST (HTTPS RESP2)' : '@redis/client@6.2.1', database: http ? 0 : 2,
    ...(http ? { provider: 'upstash-rest', removedSeedKeys, credentialMode: process.env.UPSTASH_REDIS_REST_READ_TOKEN ? 'DEDICATED_READ_TOKEN' : 'OWNED_EPHEMERAL_DATABASE' } : {}),
    nativeStatus, nativeVerifies: verified, nativeSettlements: settled, facilitator: 'LOCAL_PROTOCOL_FIXTURE',
    journeys: [http ? 'native Upstash HTTPS, authentication and read-only Lua' : 'ACL and authenticated database selection', 'binary and exact scalar preservation', 'native rank and stream pagination',
      'original generated client and buyer response files', 'retained source after authoring removal', 'native child upgrade and rollback'],
    deliveries };
  if (output) await write(output, result); console.log(JSON.stringify(result));
} finally {
  await operator?.close(); await source?.close(); if (database?.isOpen) database.destroy();
  if (facilitator.listening) await shutdown(facilitator);
  if (engine?.exitCode === null) { const exited = once(engine, 'exit'); engine.kill('SIGTERM'); await exited; }
  if (priorEnv === undefined) delete process.env[envName]; else process.env[envName] = priorEnv;
  await rm(work, { recursive: true, force: true });
}
