// MIT. One actual SQL Server receiving run through the maintained source and release owner.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, rename, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readMssqlSourceFile, openMssqlSourceFile } from './config.mjs';
import { compileMssqlQueries, bindMssqlParameters } from './declaration.mjs';
import { inspectMssqlCatalog } from './catalog.mjs';
import { prepareMssqlSeller, verifyPreparedMssqlSeller } from './prepare.mjs';
import { inspectMssqlRelease } from '../../sf82-seller-pilot/release-mssql.mjs';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';
import { initReleaseStore, stageRelease, inspectRelease, listReleases,
  compareReleases, activateRelease, runActiveRelease, releaseStatus } from '../../sf82-seller-pilot/releases.mjs';
import { buildUnpaidRequest, readLimitedResponse, decodePaymentRequired } from '../developer/request.mjs';

const SCHEMA = 'stellar-forge.mssql-receiving.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
const require = createRequire(import.meta.url);

async function inputBytes(path, maximum = 1048576) {
  const handle = await open(resolve(path), 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('MSSQL_RECEIVING_INPUT_INVALID');
    const value = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (value.length > maximum || BigInt(value.length) !== before.size ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs)
      fail('MSSQL_RECEIVING_INPUT_CHANGED');
    return value;
  } finally { await handle.close(); }
}
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

async function put(root, name, value) {
  const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  const file = await open(join(root, name), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return { file: name, bytes: bytes.length, sha256: hash(bytes) };
}

function resultSummary(result) {
  return { serverVersion: result.serverVersion, rowCount: result.rowCount,
    truncated: result.truncated, sha256: hash(jsonBytes(result)),
    columnCount: result.columns.length, valueEncoding: result.valueEncoding };
}
function wireInput(method, input) {
  if (['POST', 'PUT', 'PATCH'].includes(method)) return { body: JSON.stringify(input) };
  return { query: Object.fromEntries(Object.entries(input).map(([name, value]) => {
    if (!['string', 'number', 'boolean'].includes(typeof value) ||
        typeof value === 'number' && !Number.isFinite(value))
      fail('MSSQL_RECEIVING_QUERY_WIRE_VALUE_INVALID');
    return [name, String(value)];
  })) };
}
function safeCode(issue) {
  const code = issue?.code ?? issue?.message;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(code)
    ? code : 'MSSQL_RECEIVING_FAILED';
}

/**
 * Use an existing host-owned source, public merchant plan, and typed input.
 * Outputs stay in a fresh private directory. The SQL principal only performs the
 * configured read operations; the merchant starts on its original loopback listener.
 */
export async function receiveMssqlSeller({ sourceFile, planFile, inputFile, query,
  table, routeId, directory, environment = process.env } = {}) {
  if (![sourceFile, planFile, inputFile, query, directory].every(value => typeof value === 'string' && value.length))
    fail('MSSQL_RECEIVING_ARGUMENTS_REQUIRED');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 16) fail('MSSQL_RECEIVING_NODE_22_16_REQUIRED');
  let driverVersion;
  try { driverVersion = JSON.parse(await readFile(require.resolve('mssql/package.json'), 'utf8')).version; }
  catch { fail('MSSQL_DRIVER_UNAVAILABLE'); }
  if (driverVersion !== '12.7.4') fail('MSSQL_RECEIVING_PINNED_DRIVER_REQUIRED');

  const inputRaw = await inputBytes(inputFile), input = parse(inputRaw);
  const original = await readMssqlSourceFile(sourceFile);
  const queries = compileMssqlQueries(original.config.queries);
  if (!Object.hasOwn(queries, query)) fail('QUERY_NOT_FOUND');
  bindMssqlParameters(queries[query], input);
  // mkdir without recursive/exist-ok preserves an earlier operation and its outputs.
  const root = resolve(directory);
  await mkdir(root, { mode: 0o700 });
  if (await realpath(root) !== root) fail('MSSQL_RECEIVING_CANONICAL_DIRECTORY_REQUIRED');
  const report = { schema: SCHEMA, startedAt: new Date().toISOString(), status: 'RUNNING',
    runtime: { node: process.versions.node, platform: process.platform, mssql: driverVersion },
    files: [], stages: [] };
  let step = 'runtime', source, session;
  try {
    report.sourceModules = {};
    for (const name of ['receive.mjs', 'config.mjs', 'source.mjs', 'catalog.mjs', 'declaration.mjs', 'prepare.mjs',
      'merchant.mjs', '../../sf82-seller-pilot/release-mssql.mjs', '../../sf82-seller-pilot/release-process.mjs',
      '../../sf82-seller-pilot/releases.mjs'])
      report.sourceModules[name] = hash(await readFile(new URL(name, import.meta.url)));
    report.files.push(await put(root, 'input.json', inputRaw));
    const store = join(root, 'releases'), id = 'receiving-v1';
    await initReleaseStore(store);
    // Exercise the existing release owner's actual platform prerequisite before
    // database work. Linux acquires its retained flock inode; other platforms
    // retain the original exclusive owner-directory and process-liveness path.
    const lease = await acquireReleaseLease(store, 'state.lock');
    try { report.runtime.releaseLease = lease?.identity.schema ?? null; }
    finally { await lease?.close(); }
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });
    step = 'prepare';
    const authored = join(root, 'prepared');
    const prepared = await prepareMssqlSeller({ sourceFile, planFile, directory: authored });
    const verified = await verifyPreparedMssqlSeller(authored);
    same(verified.manifestSha256, prepared.manifestSha256, 'MSSQL_RECEIVING_PACKAGE_CHANGED');
    const packagedSource = join(authored, 'source.json');
    const packaged = await readMssqlSourceFile(packagedSource);
    same(packaged.config.queries, original.config.queries, 'MSSQL_RECEIVING_SOURCE_CHANGED');
    const expected = structuredClone(original.config); expected.bindings = packaged.config.bindings;
    if (expected.connection.caFile) expected.connection.caFile = 'database-ca.pem';
    same(packaged.config, expected, 'MSSQL_RECEIVING_SOURCE_CHANGED');
    const service = parse(await inputBytes(join(authored, 'service.json')));
    const bindings = packaged.config.bindings;
    const candidates = service.routes.filter(route => bindings[route.id]?.query === query);
    const selected = routeId ? candidates.find(route => route.id === routeId) : candidates.length === 1 ? candidates[0] : undefined;
    if (!selected) fail('MSSQL_RECEIVING_ROUTE_SELECTION_REQUIRED');
    const openapi = parse(await inputBytes(join(authored, 'openapi.json'), 16777216));
    const operation = Object.values(openapi.paths).flatMap(item => Object.values(item))
      .find(value => value.operationId === selected.id);
    if (!operation) fail('MSSQL_RECEIVING_CLIENT_OPERATION_MISSING');
    const client = await import(pathToFileURL(join(authored, 'client', 'seller-client.mjs')).href);
    same(client.source.sourceSha256, prepared.files['openapi.json'].sha256, 'MSSQL_RECEIVING_CLIENT_CHANGED');
    const customerOperation = client.operations.find(value => value.id === selected.id);
    if (!customerOperation) fail('MSSQL_RECEIVING_CLIENT_OPERATION_MISSING');
    same(customerOperation.offer, selected.offer, 'MSSQL_RECEIVING_CLIENT_CHANGED');
    report.package = { manifestSha256: prepared.manifestSha256, files: Object.keys(prepared.files).length,
      clientOpenapiSha256: client.source.sourceSha256, routeCount: service.routes.length };
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });

    step = 'catalog';
    const catalog = await inspectMssqlCatalog(packagedSource, { environment });
    report.files.push(await put(root, 'catalog.json', catalog));
    report.catalog = { serverVersion: catalog.serverVersion, tables: catalog.tables.length, truncated: catalog.truncated };
    if (table !== undefined) {
      const columns = await inspectMssqlCatalog(packagedSource, { environment, table });
      report.files.push(await put(root, 'columns.json', columns));
      report.catalog.columns = columns.columns.length;
    }
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });

    step = 'query';
    ({ source } = await openMssqlSourceFile(packagedSource, { environment }));
    const preflight = source.preflight();
    const initial = await source.query(query, input);
    report.files.push(await put(root, 'preflight.json', preflight));
    report.files.push(await put(root, 'query.json', initial));
    report.query = resultSummary(initial);
    await source.close(); source = undefined;
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });

    step = 'retain';
    const staged = await stageRelease(store, { id, label: 'SQL Server native receiving',
      mssqlPackage: authored, runtime: { port: 0 } });
    report.release = { id, digest: staged.digest, executionSha256: staged.mssql.executionSha256 };
    // Move only this command's generated authoring package. All retained reads
    // and the original release child below must now resolve the staged copy.
    await rename(authored, join(root, 'prepared-authoring-moved'));
    const retainedDirectory = join(store, 'releases', id);
    const inspected = await inspectRelease(store, id);
    same(inspected.digest, staged.digest, 'MSSQL_RECEIVING_RELEASE_CHANGED');
    const retained = await inspectMssqlRelease(retainedDirectory);
    same(retained.mssql.executionSha256, staged.mssql.executionSha256, 'MSSQL_RECEIVING_RELEASE_CHANGED');
    const list = await listReleases(store);
    if (list.errors.length || list.releases.length !== 1 || list.releases[0].id !== id)
      fail('MSSQL_RECEIVING_RELEASE_LIST_CHANGED');
    const comparison = await compareReleases(store, null, id);
    report.files.push(await put(root, 'release-comparison.json', comparison));
    const activation = await activateRelease(store, id, { expectedGeneration: 0, reason: 'Native SQL Server receiving' });
    report.release.generation = activation.state.generation;
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });

    step = 'reopen-query';
    ({ source } = await openMssqlSourceFile(join(retainedDirectory, 'mssql', 'package', 'source.json'), { environment }));
    same(source.preflight().queries, preflight.queries, 'MSSQL_RECEIVING_PROJECTION_CHANGED');
    const reopened = await source.query(query, input);
    same(reopened.columnTypes, initial.columnTypes, 'MSSQL_RECEIVING_PROJECTION_CHANGED');
    report.files.push(await put(root, 'reopened-query.json', reopened));
    report.reopenedQuery = resultSummary(reopened);
    await source.close(); source = undefined;
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });

    step = 'merchant';
    session = await runActiveRelease(store, { expectedGeneration: activation.state.generation,
      handleSignals: true, env: environment });
    if (session.mode !== 'CHALLENGE_ONLY' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url))
      fail('MSSQL_RECEIVING_MERCHANT_MODE_CHANGED');
    const request = buildUnpaidRequest(operation, wireInput(customerOperation.method, input), session.url);
    const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(15000) });
    const body = await readLimitedResponse(response);
    if (response.status !== 402) fail('MSSQL_RECEIVING_CHALLENGE_UNAVAILABLE');
    const paymentRequired = decodePaymentRequired(response.headers.get('payment-required'));
    same(paymentRequired.accepts, selected.offer.accepts, 'MSSQL_RECEIVING_PAYMENT_TERMS_CHANGED');
    report.files.push(await put(root, 'merchant-challenge.json', {
      status: response.status, paymentRequired, body }));
    report.merchant = { mode: session.mode, status: response.status, paymentOptions: paymentRequired.accepts.length,
      instanceId: session.observation.instanceId, releaseDigest: session.observation.releaseDigest };
    const stopped = await session.close(); session = undefined;
    if (stopped.forced) fail('MSSQL_RECEIVING_MERCHANT_FORCED_STOP');
    const status = await releaseStatus(store);
    if (status.runtime.state !== 'STOPPED') fail('MSSQL_RECEIVING_MERCHANT_STILL_RUNNING');
    report.files.push(await put(root, 'release-status.json', status));
    report.stages.push({ stage: step, completedAt: new Date().toISOString() });
    report.status = 'COMPLETED';
  } catch (issue) {
    report.status = 'FAILED'; report.failure = { stage: step, code: safeCode(issue) };
  } finally {
    const cleanup = await Promise.allSettled([source?.close(), session?.close()]);
    if (cleanup.some(result => result.status === 'rejected')) {
      report.status = 'FAILED'; report.failure ??= { stage: 'close', code: 'MSSQL_RECEIVING_CLOSE_FAILED' };
    }
    report.completedAt = new Date().toISOString();
    await put(root, 'receiving.json', report);
  }
  return { directory: root, report: join(root, 'receiving.json'), ...report };
}
