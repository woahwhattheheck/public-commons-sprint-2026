#!/usr/bin/env node
// One portable native consumer of the retained NocoDB source and original merchant product.
// This is operation orchestration. It does not implement a source connector, publisher,
// release engine, buyer transport, payment signer, or replacement recovery store.
import assert from 'node:assert/strict';
import { readFile, mkdir, chmod, rename, open, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SDK_PATH = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const RELEASE_PATH = 'stellar/scf-starforge-20261009/sf82-seller-pilot';
const MCP_PATH = 'stellar-forge/mcp-merchant-operator';
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stamp = () => new Date().toISOString();
const absolute = (value, name) => {
  assert.equal(typeof value, 'string', name + ' must be an absolute path.');
  assert(isAbsolute(value) && !value.includes('\0'), name + ' must be an absolute path.');
  return resolve(value);
};
const optional = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
async function saveBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.partial';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
const save = (path, value) => saveBytes(path, jsonBytes(value));
const errorView = error => ({ code: error.code ?? null, message: error.message,
  stack: error.stack?.slice(0, 10000) ?? null });
async function availablePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}
async function waitFor(action, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await action(); if (value) return value;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + label + '.');
    await new Promise(done => setTimeout(done, 120));
  }
}
function exactRows(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + ': complete row count.');
  assert.deepEqual(actual, expected, label + ': every reviewed typed value and row order.');
  return { rows: actual.length, valuesSha256: hash(jsonBytes(actual)) };
}
function sortRows(rows, order) {
  // The consumer compares the selected ordering of the original projected values.
  // It does not recalculate the provider's scalar conversion or native CSV codec.
  return rows.map((row, ordinal) => ({ row, ordinal })).sort((left, right) => {
    for (const item of order) {
      const a = left.row[item.column], b = right.row[item.column];
      if (a === b) continue;
      if (a === null || b === null) return a === null ? 1 : -1;
      return (a < b ? -1 : 1) * (item.direction === 'asc' ? 1 : -1);
    }
    return left.ordinal - right.ordinal;
  }).map(item => item.row);
}
async function paged(read, expectedRows, query = {}) {
  const rows = []; let cursor, pages = 0, snapshot;
  const seen = new Set();
  do {
    const parameters = new URLSearchParams({ ...query, limit: '250', ...(cursor ? { cursor } : {}) });
    // An original continuation cursor already binds its snapshot; the selector is first-page only.
    if (cursor) parameters.delete('snapshot');
    const result = await read(parameters.toString());
    assert(Array.isArray(result.rows), 'Original dataset rows are required.');
    if (!snapshot) snapshot = result.dataset.snapshot;
    assert.equal(result.dataset.snapshot, snapshot, 'All original pages retain one snapshot.');
    rows.push(...result.rows); pages++;
    assert(rows.length <= expectedRows && pages <= expectedRows + 1, 'Complete pagination bounds.');
    cursor = result.page.nextCursor;
    if (cursor) { assert(!seen.has(cursor), 'Original cursor must advance.'); seen.add(cursor); }
  } while (cursor);
  assert.equal(rows.length, expectedRows, 'The original cursor reached the complete selected dataset.');
  return { rows, pages, snapshot };
}
function unpackTar(gzip, exportId, expected) {
  const data = gunzipSync(gzip, { maxOutputLength: 136 * 1024 * 1024 });
  const files = new Map(); let offset = 0;
  while (offset + 512 <= data.length && data.subarray(offset, offset + 512).some(value => value !== 0)) {
    const header = data.subarray(offset, offset + 512);
    const text = (start, size) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
    const name = text(0, 100), bytes = Number.parseInt(text(124, 12).trim(), 8);
    assert.equal(text(156, 1), '0', 'Original customer archive contains regular files only.');
    assert(Number.isSafeInteger(bytes) && bytes >= 0 && offset + 512 + bytes <= data.length);
    assert(name.startsWith(exportId + '/') && !name.slice(exportId.length + 1).includes('/'));
    const file = name.slice(exportId.length + 1), identity = expected.find(row => row.name === file);
    assert(identity && !files.has(file), 'Only the six original reviewed customer files are received.');
    const content = data.subarray(offset + 512, offset + 512 + bytes);
    assert.equal(content.length, identity.bytes); assert.equal(hash(content), identity.sha256);
    files.set(file, Buffer.from(content)); offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  assert.equal(files.size, 6); assert(data.subarray(offset).every(value => value === 0));
  return files;
}

const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--input') {
  console.error('Usage: node nocodb-native-consumer.mjs --input /absolute/private/receiving-input.json');
  process.exitCode = 2;
} else {
  await main(absolute(argv[1], 'input'));
}
async function main(inputFile) {
  const inputBytes = await readFile(inputFile), input = JSON.parse(inputBytes);
  assert.equal(input.schema, 'stellar-forge.nocodb-native-receiving-input.v1');
  assert(ID.test(input.operationId), 'Supply the existing provider operation identity, up to 64 characters.');
  assert(HASH.test(input.consumerSha256));
  assert.equal(hash(await readFile(fileURLToPath(import.meta.url))), input.consumerSha256, 'Exact consumer selection.');
  const sourceRoot = absolute(input.sourceRoot, 'sourceRoot');
  const output = absolute(input.outputDirectory, 'outputDirectory');
  const contains = (parent, child) => { const tail = relative(parent, child);
    return !tail || !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep); };
  assert(!contains(sourceRoot, output) && !contains(output, sourceRoot),
    'Keep private receiving outputs separate from the public source tree.');
  assert(object(input.sourceManifest) && HASH.test(input.sourceManifest.sha256));
  const sourceManifestFile = absolute(input.sourceManifest.file, 'sourceManifest.file');
  const sourceManifestBytes = await readFile(sourceManifestFile);
  assert.equal(hash(sourceManifestBytes), input.sourceManifest.sha256, 'Exact selected source manifest.');
  const sourceManifest = JSON.parse(sourceManifestBytes);
  assert(Array.isArray(sourceManifest.files) && sourceManifest.files.length > 0);
  const selectedSourcePaths = new Set();
  for (const entry of sourceManifest.files) {
    assert(typeof entry.path === 'string' && entry.path && !isAbsolute(entry.path));
    const path = resolve(sourceRoot, entry.path), tail = relative(sourceRoot, path);
    assert(tail && tail !== '..' && !tail.startsWith('..' + sep) && HASH.test(entry.sha256));
    assert.equal(entry.path, tail.split(sep).join('/'), 'Use canonical source manifest paths.');
    assert(!selectedSourcePaths.has(entry.path), 'One identity per selected source file.');
    selectedSourcePaths.add(entry.path);
    const bytes = await readFile(path); assert.equal(hash(bytes), entry.sha256, 'Selected source: ' + entry.path);
  }
  const requiredSourcePaths = [
    ...['nocodb/declaration.mjs', 'nocodb/capture.mjs', 'nocodb/values.mjs',
      'nocodb/publisher/model.mjs', 'nocodb/deployment.mjs', 'dataset-refresh/service.mjs',
      'nocodb/workspace/model.mjs', 'nocodb/workspace/server.mjs',
      'nocodb/workspace/browser.mjs', 'nocodb/workspace/index.html',
      'nocodb/workspace/style.css'].map(path => SDK_PATH + '/' + path),
    RELEASE_PATH + '/release-console.mjs', RELEASE_PATH + '/releases.mjs',
    MCP_PATH + '/serve.mjs',
  ];
  for (const path of requiredSourcePaths)
    assert(selectedSourcePaths.has(path), 'Manifest must cover the executed native source: ' + path);
  assert(Array.isArray(input.sources) && input.sources.length === 2);
  assert.equal(new Set(input.sources.map(item => item.id)).size, 2);
  assert.equal(input.sources.filter(item => item.primary === true).length, 1);
  assert(input.sources.some(item => item.id === 'film' && item.expectedRows === 1000 && item.primary));
  assert(input.sources.some(item => item.id === 'actor' && item.expectedRows === 200));
  assert(object(input.browser), 'Provide the existing Hatch browser runtime for this composed journey.');
  absolute(input.browser.module, 'browser.module'); absolute(input.browser.executable, 'browser.executable');
  assert(object(input.merchant) && object(input.merchant.payment));
  const origin = new URL(input.merchant.origin);
  assert(origin.protocol === 'https:' && origin.origin === input.merchant.origin);
  assert(typeof input.merchant.path === 'string' && input.merchant.path.startsWith('/') &&
    !input.merchant.path.includes('?') && !input.merchant.path.includes('#'));
  assert(/^[0-9]+$/.test(input.merchant.payment.amount) && /^[0-9]+$/.test(input.merchant.nextAmount));
  assert.notEqual(input.merchant.payment.amount, input.merchant.nextAmount);
  const SDK = join(sourceRoot, SDK_PATH), RELEASE = join(sourceRoot, RELEASE_PATH), MCP = join(sourceRoot, MCP_PATH);
  const imports = await Promise.all([
    import(pathToFileURL(join(SDK, 'nocodb/declaration.mjs')).href),
    import(pathToFileURL(join(SDK, 'nocodb/capture.mjs')).href),
    import(pathToFileURL(join(SDK, 'nocodb/values.mjs')).href),
    import(pathToFileURL(join(SDK, 'nocodb/publisher/model.mjs')).href),
    import(pathToFileURL(join(SDK, 'nocodb/deployment.mjs')).href),
    import(pathToFileURL(join(SDK, 'dataset-refresh/service.mjs')).href),
    import(pathToFileURL(join(RELEASE, 'release-console.mjs')).href),
    import(pathToFileURL(join(RELEASE, 'releases.mjs')).href),
    import(pathToFileURL(join(MCP, 'serve.mjs')).href),
    import(pathToFileURL(input.browser.module).href),
    import(pathToFileURL(join(SDK, 'nocodb/workspace/model.mjs')).href),
    import(pathToFileURL(join(SDK, 'nocodb/workspace/server.mjs')).href),
  ]);
  const [{ readNocoDBSourceFile }, { readNocoDBCapture, bindNocoDBCapture },
    { projectedNocoDBValue }, { openNocoDBPublisher }, deployment, { datasetControl },
    { startReleaseConsole }, { initReleaseStore, inspectRelease, releaseStatus },
    { startMerchantMcp }, { chromium }, authoringModel, authoringServer] = imports;
  const captured = [];
  for (const item of input.sources) {
    assert(ID.test(item.id) && HASH.test(item.sourceSha256) && HASH.test(item.captureSha256));
    const sourceFile = absolute(item.sourceFile, 'sourceFile');
    assert.equal(hash(await readFile(sourceFile)), item.sourceSha256, 'Original provider declaration.');
    const declaration = await readNocoDBSourceFile(sourceFile);
    assert.equal(declaration.config.connection.kind, 'capture', 'Reuse the original completed provider capture.');
    assert.equal(declaration.config.connection.sha256, item.captureSha256);
    const capture = await readNocoDBCapture(declaration.captureFile, item.captureSha256);
    const records = bindNocoDBCapture(capture, declaration.config);
    assert.equal(records.length, item.expectedRows); assert.equal(capture.manifest.rowCount, item.expectedRows);
    const query = declaration.queries[item.query]; assert(query, 'Select an actual reviewed original query.');
    assert(Array.isArray(item.publicColumns) && item.publicColumns.length && new Set(item.publicColumns).size === item.publicColumns.length);
    for (const name of item.publicColumns) assert(Object.hasOwn(query.projection, name), 'Use original projected public aliases.');
    assert(item.publicColumns.includes(item.orderColumn), 'The selected original order must use a public column.');
    const rows = records.map(record => Object.fromEntries(item.publicColumns.map(name =>
      [name, projectedNocoDBValue(record, query.projection[name])])));
    assert.equal(new Set(rows.map(row => JSON.stringify(row[item.orderColumn]))).size, rows.length,
      'Use the actual unique primary record projection for the receiving order.');
    captured.push({ ...item, sourceFile, declaration, capture, originalRows: rows });
  }
  const intentFile = join(output, 'intent.json'), inputSha256 = hash(inputBytes);
  let prior = null, outputExists = true;
  try {
    const directoryInfo = await lstat(output);
    assert(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink() && !(directoryInfo.mode & 0o077),
      'Reopen the same original private receiving directory.');
    prior = await optional(intentFile);
    assert(prior && prior.inputSha256 === inputSha256, 'An existing directory must retain this exact receiving intent.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; outputExists = false; }
  if (!outputExists) {
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await mkdir(output, { mode: 0o700 });
  }
  const intent = prior ?? { schema: 'stellar-forge.nocodb-native-receiving-intent.v1',
    operationId: input.operationId, inputSha256, createdAt: stamp(), requests: {}, plans: {}, handoffs: {} };
  await save(intentFile, intent);
  const completed = await optional(join(output, 'result.json'));
  if (completed?.state === 'PASS') {
    assert.equal(completed.inputSha256, inputSha256);
    console.log('PASS retained original NocoDB receiving result; no repeated native operation.');
    return;
  }
  const report = await optional(join(output, 'progress.json')) ?? {
    schema: 'stellar-forge.nocodb-native-receiving-result.v1', operationId: input.operationId,
    inputSha256, consumerSha256: input.consumerSha256, state: 'RUNNING', startedAt: stamp(),
    runtime: process.version, source: { manifestSha256: input.sourceManifest.sha256,
      files: sourceManifest.files.length, refs: input.sourceRefs ?? {} }, checks: [], browserErrors: [],
    scope: 'Original retained NocoDB v3 actor/film captures; original authoring, publisher, dataset versions, SF82 and customer exporter.',
    observationScope: 'Two film publications retain one actual provider observation. Their reviewed CSV row order differs.',
    paymentScope: 'Original development challenge, snapshot-pinned SF88 configuration, and offline generated customer request. No signer or settlement.',
  };
  const checkpoint = async (name, value = {}) => {
    report.checks.push({ name, at: stamp(), ...value }); await save(join(output, 'progress.json'), report);
    console.log('NOCODB', name, JSON.stringify(value));
  };
  const requestId = async key => {
    if (!intent.requests[key]) { intent.requests[key] = randomUUID(); await save(intentFile, intent); }
    return intent.requests[key];
  };
  const keep = new Set(); let browser, context, consoleHost, mcpHost, publisher;
  const close = async item => { if (!item) return; try { await item.close(); } finally { keep.delete(item); } };
  const own = item => { keep.add(item); return item; };
  const actualFetch = globalThis.fetch;
  let rpcId = 0, mcpToken = '', releaseStore, exportsDirectory, configPath, publisherDirectory, targetDirectory;
  const consoleApi = async (path, body, raw = false, extra = {}) => {
    const response = await actualFetch(consoleHost.url + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-release-token': consoleHost.token, ...extra,
        ...(body === undefined ? {} : { 'content-type': 'application/json', origin: consoleHost.url }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
    if (raw) return response;
    const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value;
  };
  const rpc = async (method, params = {}) => {
    const response = await actualFetch(mcpHost.url, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        authorization: 'Bearer ' + mcpToken, 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, 200); const value = await response.json();
    assert(!value.error, JSON.stringify(value.error)); return value.result;
  };
  const call = async (name, args = {}) => {
    const result = await rpc('tools/call', { name, arguments: args });
    assert(!result.isError, JSON.stringify(result.structuredContent)); return result.structuredContent;
  };
  const startMcp = async () => {
    mcpToken = randomUUID() + randomUUID();
    mcpHost = own(await startMerchantMcp({ configPath, port: 0, environment: { ...process.env, MCP_ACCESS_TOKEN: mcpToken } }));
    const ready = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'nocodb-original-native-receiving', version: '1' } });
    assert.equal(ready.protocolVersion, '2025-11-25');
  };
  const challenge = async (listener, amount, name) => {
    const response = await actualFetch(listener + input.merchant.path + '?limit=2', { signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(response.status, 402);
    const required = response.headers.get('payment-required');
    const payment = required ? JSON.parse(Buffer.from(required, 'base64')) : JSON.parse(bytes);
    assert(JSON.stringify(payment).includes('"amount":"' + amount + '"'), 'Exact selected merchant amount.');
    await save(join(output, name + '-challenge.json'), payment);
    return { status: response.status, bytes: bytes.length, bodySha256: hash(bytes), amount };
  };
  const planInput = (source, direction) => ({ title: input.operationId + ' ' + source.id + ' ' + direction,
    query: source.query, input: {}, sourceHash: source.sourceSha256,
    dataset: { name: 'NocoDB ' + source.id + ' development receiving',
      columns: Object.fromEntries(source.publicColumns.map(name => {
        const spec = source.declaration.queries[source.query].projection[name];
        return [name, { type: spec.type, nullable: spec.nullable }];
      })), filters: [], ranges: [], sorts: [source.orderColumn],
      maxCellChars: 65536, defaultLimit: 50, maxLimit: 250, maxPageBytes: 2 * 1024 * 1024 },
    extraction: { order: [{ column: source.orderColumn, direction }], maxRows: Math.max(source.expectedRows, 2000),
      maxBytes: 16 * 1024 * 1024, maxRowBytes: 1024 * 1024, timeoutMs: 120000 } });
  const openPublisher = async source => {
    const directory = source.publisherDirectory;
    const existing = await optional(join(directory, 'workspace.json'));
    if (!existing) {
      try { await lstat(directory); throw new Error('Retained partial publisher needs its original initialization recovery: ' + source.id); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return own(await openNocoDBPublisher({ directory, create: !existing, sourceFile: source.sourceFile,
      targetDirectory: source.targetDirectory, ...(source.primary ? {
        seller: 'http://127.0.0.1:' + intent.sellerPort, resource: input.merchant.origin + input.merchant.path } : {}) }));
  };
  const retainedPlan = async (native, key, spec) => {
    if (intent.plans[key]) {
      const saved = native.plan(intent.plans[key].id);
      assert.equal(saved.data.digest, intent.plans[key].digest); return saved;
    }
    // The original savePlan has no caller UUID. Recover its exact unique title/source
    // from its native history before ever considering another saved plan.
    let offset = 0, matches = [];
    for (;;) {
      const state = native.status({ limit: 100, plansOffset: offset });
      matches.push(...state.plans.filter(plan => plan.data.title === spec.title));
      if (state.pages.plans.next === null) break; offset = state.pages.plans.next;
    }
    assert(matches.length <= 1, 'A single original native plan owns this receiving intent.');
    const plan = matches[0] ?? await native.savePlan(spec);
    assert.equal(plan.data.sourceHash, spec.sourceHash); assert.equal(plan.data.query, spec.query);
    assert.deepEqual(plan.data.extraction.order, spec.extraction.order);
    intent.plans[key] = { id: plan.id, digest: plan.data.digest }; await save(intentFile, intent); return plan;
  };
  const extracted = async (native, key, plan, expected) => {
    const id = await requestId(key); let run;
    try { run = native.run(id); } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
    if (!run) { const operation = native.startExtraction(plan.id, { id }); await operation.completion; }
    run = native.run(id);
    if (['INTERRUPTED', 'FAILED', 'CANCELLED'].includes(run.state)) {
      // Reconcile only a complete original candidate; do not reissue its read.
      run = await native.recover(id);
    }
    assert(['READY', 'REVIEWED', 'PUBLISHED', 'PUBLICATION_UNKNOWN'].includes(run.state), JSON.stringify(run.data));
    assert.equal(run.plan, plan.id);
    const candidate = await native.candidate(id);
    const pages = await paged(async query => {
      const response = candidate.dataset.handle({ query: new URLSearchParams(query) });
      assert.equal(response.status, 200); return response.body;
    }, expected.length);
    exactRows(pages.rows, expected, key);
    return { run, candidate, pages };
  };
  const publishInitial = async (native, run) => {
    if (run.state === 'PUBLISHED') return run;
    if (run.state === 'PUBLICATION_UNKNOWN' || run.state === 'REVIEWED' && !(await native.target()).initializable) {
      const recovered = await native.recover(run.id);
      assert.equal(recovered.state, 'PUBLISHED', 'Reconcile original publication before another command.'); return recovered;
    }
    if (run.state !== 'REVIEWED') run = await native.review(run.id, {
      reviewer: 'Original NocoDB receiving operation', note: 'Complete retained provider capture and public projection reviewed.', initialize: true });
    const published = await native.publish(run.id, run.data.review.id);
    assert.equal(published.state, 'PUBLISHED', JSON.stringify(published.data)); return published;
  };
  try {
    if (!intent.sellerPort) { intent.sellerPort = await availablePort(); await save(intentFile, intent); }
    browser = own(await chromium.launch({ executablePath: input.browser.executable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] }));
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const adopted = await runAuthoringStage({ sourceRoot, output, captured, context,
      authoringModel, authoringServer, readNocoDBSourceFile, readNocoDBCapture, bindNocoDBCapture,
      projectedNocoDBValue, checkpoint, requestId, report, intent, intentFile });
    const primary = adopted.find(source => source.primary), secondary = adopted.find(source => !source.primary);
    assert(primary && secondary);
    publisherDirectory = primary.publisherDirectory; targetDirectory = primary.targetDirectory;
    releaseStore = join(output, 'merchant', 'releases'); exportsDirectory = join(output, 'merchant', 'customer-exports');
    configPath = join(output, 'merchant', 'merchant-mcp.json');
    await mkdir(dirname(releaseStore), { recursive: true, mode: 0o700 });
    await initReleaseStore(releaseStore); await mkdir(exportsDirectory, { recursive: true, mode: 0o700 });

    // Both authoring workspaces hand off their own existing original publisher.
    publisher = await openPublisher(secondary);
    const actorPlan = await retainedPlan(publisher, 'actor-ascending', planInput(secondary, 'asc'));
    const actorExpected = sortRows(secondary.originalRows, actorPlan.data.extraction.order);
    const actorExtract = await extracted(publisher, 'actor-extraction', actorPlan, actorExpected);
    const actorPublished = await publishInitial(publisher, actorExtract.run);
    report.actor = { workspaceVersion: secondary.version, planId: actorPlan.id, runId: actorPublished.id,
      captureSha256: secondary.capture.manifestSha256, snapshot: actorPublished.data.publication.snapshot,
      candidateDigest: actorExtract.candidate.manifest.candidateDigest,
      ...exactRows(actorExtract.pages.rows, actorExpected, 'All actual actor values') };
    await close(publisher); publisher = null;
    await checkpoint('Original actor authoring and publisher retain all 200 actual records', report.actor);

    publisher = await openPublisher(primary);
    const planA = await retainedPlan(publisher, 'film-ascending', planInput(primary, 'asc'));
    const planB = await retainedPlan(publisher, 'film-descending', planInput(primary, 'desc'));
    const expectedA = sortRows(primary.originalRows, planA.data.extraction.order);
    const expectedB = sortRows(primary.originalRows, planB.data.extraction.order);
    const filmA = await extracted(publisher, 'film-a-extraction', planA, expectedA);
    const publishedA = await publishInitial(publisher, filmA.run);
    const snapshotA = publishedA.data.publication.snapshot;
    report.film = { workspaceVersion: primary.version, captureSha256: primary.capture.manifestSha256,
      sourceSha256: primary.sourceSha256, first: { planId: planA.id, planDigest: planA.data.digest,
        runId: publishedA.id, candidateDigest: filmA.candidate.manifest.candidateDigest, snapshot: snapshotA,
        ...exactRows(filmA.pages.rows, expectedA, 'All actual film values') } };
    const termsA = { origin: input.merchant.origin, path: input.merchant.path, payment: input.merchant.payment };
    const termsB = { ...termsA, payment: { ...termsA.payment, amount: input.merchant.nextAmount } };
    const prepare = async (native, runId, terms, id) => {
      const review = await deployment.reviewNocoDBDeployment({ publisher: native, runId, terms });
      const directory = join(output, 'deployment-packages', id);
      const prepared = await deployment.prepareNocoDBDeployment({ publisher: native, runId, terms,
        expectedReviewSha256: review.reviewSha256, directory });
      const inspected = await deployment.inspectNocoDBDeployment(directory);
      assert.equal(prepared.sourceSha256, inspected.sourceSha256);
      assert.equal(prepared.candidateDigest, inspected.candidateDigest);
      assert.equal(prepared.files.length, 5);
      for (const file of prepared.files) {
        const received = await deployment.readNocoDBDeploymentFile(directory, file.file);
        assert.equal(hash(received.bytes), file.sha256); assert.equal(received.bytes.length, file.bytes);
      }
      const staged = await deployment.stageNocoDBDeployment({ packageDirectory: directory, releaseDirectory: releaseStore,
        id, label: 'NocoDB original ' + id, runtime: { port: intent.sellerPort },
        expectedSourceSha256: prepared.sourceSha256 });
      await save(join(output, id + '-deployment.json'), { review, prepared, release: staged.release });
      return { review, prepared, release: staged.release };
    };
    const releaseA = await prepare(publisher, publishedA.id, termsA, 'nocodb-a');
    assert.equal(releaseA.prepared.dataset.datasetDirectory, targetDirectory);
    await close(publisher); publisher = null;

    consoleHost = own(await startReleaseConsole(releaseStore, { port: 0, clientExportsDirectory: exportsDirectory }));
    let state = await consoleApi('/api/status');
    // The original selection state decides whether an accepted command is needed.
    if (state.state.active !== releaseA.release.id) {
      assert.equal(state.runtime.state, 'STOPPED');
      state = await consoleApi('/api/activate', { id: releaseA.release.id,
        expectedGeneration: state.state.generation, reason: 'Run the reviewed original NocoDB film release.' });
    }
    assert.equal(state.runtime.state, 'STOPPED', 'This operator owns no prior unobserved merchant process.');
    state = await consoleApi('/api/run', { expectedGeneration: state.state.generation });
    assert.equal(state.runtime.state, 'RUNNING');
    const firstInstance = state.runtime.observed.instanceId;
    const listener = 'http://127.0.0.1:' + intent.sellerPort;
    assert.equal(state.runtime.observed.listener, listener);
    const firstChallenge = await challenge(listener, termsA.payment.amount, 'film-release-a');
    const firstPage = await datasetControl(targetDirectory, 'preview', {
      query: new URLSearchParams({ snapshot: snapshotA, limit: '2' }).toString() });
    assert(firstPage.page.nextCursor); assert.deepEqual(firstPage.rows, expectedA.slice(0, 2));
    await save(join(output, 'original-film-a-first-page.json'), firstPage);
    const allA = await paged(query => datasetControl(targetDirectory, 'preview', { query }), primary.expectedRows, { snapshot: snapshotA });
    exactRows(allA.rows, expectedA, 'Complete original running film A');
    await checkpoint('Reviewed package starts the original same-store merchant', { ...firstChallenge,
      snapshot: snapshotA, sourceSha256: primary.sourceSha256, releaseDigest: releaseA.release.digest,
      completeRows: allA.rows.length, pages: allA.pages });

    const connectionFile = join(output, 'merchant', 'publishers.json');
    const connection = { schema: 'stellar-forge.merchant-publisher-connection.v1',
      workspaces: Object.fromEntries(adopted.map(source => [source.id, { kind: 'nocodb',
        label: 'Original retained ' + source.id, directory: source.publisherDirectory,
        ...(source.primary ? { seller: listener, resource: input.merchant.origin + input.merchant.path } : {}) }])) };
    const config = { schema: 'stellar-forge.merchant-mcp.v1', name: 'Original NocoDB receiving',
      releaseStore, exportsDirectory, sources: {}, publisherConnection: connectionFile };
    for (const [path, value] of [[connectionFile, connection], [configPath, config]]) {
      const previous = await optional(path);
      if (previous) assert.deepEqual(previous, value, 'Reopen the exact original host declaration.');
      else await save(path, value);
    }
    await startMcp();
    const opened = await call('merchant_publisher_open', { publisher: primary.id });
    assert.equal(opened.native.runs.filter(run => run.id === publishedA.id).length, 1);
    const sourceView = await call('merchant_publisher_source', { publisher: primary.id });
    assert.equal(sourceView.hash, primary.sourceSha256);
    assert.equal(sourceView.observation.manifestSha256, primary.capture.manifestSha256);
    const offer = await call('merchant_publisher_buyer_offer', { publisher: primary.id, runId: publishedA.id, query: 'limit=2' });
    assert.equal(offer.snapshot, snapshotA);
    let buyer = intent.handoffs.filmA;
    if (!buyer) {
      const prepared = await call('merchant_publisher_buyer_prepare', { publisher: primary.id,
        runId: publishedA.id, query: 'limit=2', offerSha256: offer.offerSha256, acceptIndex: 0,
        intentId: input.operationId + '-film-a' });
      buyer = { handoffId: prepared.handoffId, configSha256: prepared.configSha256,
        offerSha256: prepared.offerSha256, configText: prepared.configText };
      intent.handoffs.filmA = buyer; await save(intentFile, intent);
    }
    const pinned = await call('merchant_publisher_buyer_read', { publisher: primary.id,
      runId: publishedA.id, handoffId: buyer.handoffId });
    assert.equal(hash(Buffer.from(pinned.configText)), buyer.configSha256);
    assert.equal(pinned.configText, buyer.configText);
    assert(pinned.configText.includes(snapshotA));
    await saveBytes(join(output, 'film-a-buyer.json'), Buffer.from(pinned.configText));
    await checkpoint('Original SF88 handoff pins the reviewed first film snapshot', {
      handoffId: buyer.handoffId, snapshot: snapshotA, configSha256: buyer.configSha256 });

    const runB = await requestId('film-b-extraction');
    const extractionArgs = { publisher: primary.id, planId: planB.id, planDigest: planB.data.digest, runId: runB };
    await call('merchant_publisher_extract', extractionArgs);
    const ready = await waitFor(async () => {
      const result = await call('merchant_publisher_inspect', { publisher: primary.id, runId: runB, query: 'limit=2' });
      if (['EXTRACTING'].includes(result.run.state)) return false;
      assert(['READY', 'REVIEWED', 'PUBLISHED', 'PUBLICATION_UNKNOWN'].includes(result.run.state), JSON.stringify(result.run));
      return result;
    }, 'the same original film B extraction');
    const repeated = await call('merchant_publisher_extract', extractionArgs);
    assert.equal(repeated.replayed, true); assert.equal(repeated.run.id, runB);
    const allB = await paged(async query =>
      (await call('merchant_publisher_inspect', { publisher: primary.id, runId: runB, query })).preview,
      primary.expectedRows);
    exactRows(allB.rows, expectedB, 'All actual film B values');
    assert.notEqual(allB.snapshot, snapshotA);
    let reviewedB = ready.run;
    if (intent.publicationBDispatched && reviewedB.state !== 'PUBLISHED')
      reviewedB = await call('merchant_publisher_recover', { publisher: primary.id, runId: runB });
    if (!['REVIEWED', 'PUBLISHED', 'PUBLICATION_UNKNOWN'].includes(reviewedB.state)) {
      const target = await call('merchant_publisher_target', { publisher: primary.id });
      reviewedB = await call('merchant_publisher_review', { publisher: primary.id, runId: runB,
        candidateDigest: ready.run.data.candidate.candidateDigest,
        reviewer: 'Original NocoDB receiving operation',
        note: 'The same 1,000 captured film values; explicit descending public record order.',
        expectedSnapshot: target.versions.current, expectedRevision: target.versions.revision });
    }
    if (reviewedB.state === 'REVIEWED') {
      // A controlled lost client reply follows ONE successful original publication.
      // The original native state, rather than another publish call, resolves it.
      intent.publicationBDispatched = true; await save(intentFile, intent);
      try {
        const reply = await rpc('tools/call', { name: 'merchant_publisher_publish', arguments: {
          publisher: primary.id, runId: runB, reviewId: reviewedB.data.review.id } });
        await save(join(output, 'withheld-original-publication-reply.json'), reply);
        intent.publicationBReplyWithheld = true; await save(intentFile, intent);
        throw Object.assign(new Error('Controlled loss of the original publication reply.'), { code: 'CONTROLLED_REPLY_LOSS' });
      } catch (error) { if (error.code !== 'CONTROLLED_REPLY_LOSS') throw error; }
    }
    const reconciledB = intent.publicationBReconciled
      ? (await call('merchant_publisher_inspect', { publisher: primary.id, runId: runB })).run
      : await call('merchant_publisher_recover', { publisher: primary.id, runId: runB });
    assert.equal(reconciledB.state, 'PUBLISHED');
    intent.publicationBReconciled = true; await save(intentFile, intent);
    let historyOffset = 0, publicationCommands = 0;
    for (;;) {
      const original = await call('merchant_publisher_status', { publisher: primary.id, limit: 100, historyOffset });
      publicationCommands += original.native.history.filter(event => event.run === runB && event.kind === 'PUBLICATION_STARTED').length;
      if (original.native.pages.history.next === null) break; historyOffset = original.native.pages.history.next;
    }
    assert.equal(reconciledB.data.publication.snapshot, allB.snapshot);
    const schemaB = await datasetControl(targetDirectory, 'schema');
    assert.equal(schemaB.versions.current, allB.snapshot);
    const servedB = await paged(query => datasetControl(targetDirectory, 'preview', { query }), primary.expectedRows);
    exactRows(servedB.rows, expectedB, 'Complete current original film B');
    report.film.second = { planId: planB.id, planDigest: planB.data.digest, runId: runB,
      snapshot: allB.snapshot, candidateDigest: reconciledB.data.candidate.candidateDigest,
      publication: reconciledB.data.publication, ...exactRows(servedB.rows, expectedB, 'Original film B receiving') };
    await checkpoint('Original MCP publishes and reconciles the second complete film ordering', {
      rows: servedB.rows.length, snapshot: allB.snapshot, captureSha256: primary.capture.manifestSha256,
      extractionReplayed: true, publicationMode: reconciledB.data.publication.mode,
      originalPublishCommands: publicationCommands });
    await call('merchant_publisher_close', { publisher: primary.id, instanceId: opened.instanceId });
    await close(mcpHost); mcpHost = null;

    publisher = await openPublisher(primary);
    const releaseB = await prepare(publisher, runB, termsB, 'nocodb-b');
    const nativeB = publisher.run(runB);
    assert.equal(nativeB.data.candidate.extraction.observation.capture.manifestSha256, primary.capture.manifestSha256);
    await close(publisher); publisher = null;
    const comparison = await consoleApi('/api/diff?from=nocodb-a&to=nocodb-b');
    await save(join(output, 'original-merchant-comparison.json'), comparison);
    state = await consoleApi('/api/status');
    state = await consoleApi('/api/activate', { id: releaseB.release.id, expectedGeneration: state.state.generation,
      reason: 'Select reviewed second film merchant terms against the same retained dataset.' });
    assert.equal(state.runtime.state, 'RESTART_REQUIRED');
    assert.equal(state.runtime.observed.instanceId, firstInstance);
    state = await consoleApi('/api/restart', { instanceId: firstInstance, expectedGeneration: state.state.generation });
    assert.equal(state.runtime.state, 'RUNNING'); assert.notEqual(state.runtime.observed.instanceId, firstInstance);
    assert.equal(state.runtime.observed.listener, listener);
    const secondChallenge = await challenge(listener, termsB.payment.amount, 'film-release-b');
    const continuedA = await datasetControl(targetDirectory, 'preview', {
      query: new URLSearchParams({ limit: '2', cursor: firstPage.page.nextCursor }).toString() });
    assert.equal(continuedA.dataset.snapshot, snapshotA); assert.deepEqual(continuedA.rows, expectedA.slice(2, 4));
    await save(join(output, 'original-film-a-next-page-after-restart.json'), continuedA);
    await checkpoint('Original SF82 restart retains the earlier snapshot cursor and current dataset', {
      ...secondChallenge, currentSnapshot: allB.snapshot, retainedSnapshot: snapshotA,
      releaseDigest: releaseB.release.digest, datasetDirectoryUnchanged: true });

    const clientId = 'nocodb-film-client';
    const client = await receiveClient({ context, consoleHost, consoleApi, output, clientId,
      report, checkpoint, expectedRelease: releaseB.release, expectedAmount: termsB.payment.amount,
      snapshot: allB.snapshot, resourcePath: input.merchant.path, operationId: input.operationId, intent, intentFile });
    report.customer = client;
    state = await consoleApi('/api/status');
    state = await consoleApi('/api/stop', { instanceId: state.runtime.observed.instanceId });
    assert.equal(state.runtime.state, 'STOPPED');
    state = await consoleApi('/api/rollback', { to: releaseA.release.id, expectedGeneration: state.state.generation,
      reason: 'Restore original merchant terms while retaining the current complete film dataset.' });
    assert.equal(state.state.active, releaseA.release.id);
    await close(consoleHost); consoleHost = null;

    // The same MCP process owner now starts the retained original rollback selection.
    await startMcp();
    const reopened = await call('merchant_publisher_open', { publisher: primary.id });
    const savedRuns = reopened.native.runs.map(run => run.id).sort();
    assert.deepEqual(savedRuns, [publishedA.id, runB].sort());
    const retainedBuyer = await call('merchant_publisher_buyer_read', { publisher: primary.id,
      runId: publishedA.id, handoffId: buyer.handoffId });
    assert.equal(retainedBuyer.configText, buyer.configText);
    let status = await call('merchant_status');
    assert.equal(status.runtime.state, 'STOPPED'); assert.equal(status.state.active, releaseA.release.id);
    status = await call('merchant_start', { expectedGeneration: status.state.generation,
      expectedDigest: releaseA.release.digest });
    assert.equal(status.runtime.state, 'RUNNING');
    const rollback = await challenge(listener, termsA.payment.amount, 'film-rollback-a');
    const afterRollback = await datasetControl(targetDirectory, 'preview', { query: 'limit=2' });
    assert.equal(afterRollback.dataset.snapshot, allB.snapshot); assert.deepEqual(afterRollback.rows, expectedB.slice(0, 2));
    const savedClient = await call('merchant_client_export_status', { exportId: clientId, includeOffers: true });
    assert.equal(savedClient.state, 'COMPLETE'); assert.equal(savedClient.manifestFile.sha256, client.manifestSha256);
    const first = await call('merchant_client_export_file', { exportId: clientId, file: 'seller-client.mjs',
      expectedManifestSha256: client.manifestSha256, limit: 512 });
    assert(first.nextOffset !== null);
    const oldInstance = status.operator.instanceId;
    await close(mcpHost); mcpHost = null;
    await startMcp();
    status = await call('merchant_status');
    assert.equal(status.runtime.state, 'STOPPED');
    assert.equal(status.operator.managesRunningSeller, false);
    assert.equal(status.state.active, releaseA.release.id);
    const afterClose = await call('merchant_publisher_open', { publisher: primary.id });
    assert.notEqual(afterClose.instanceId, reopened.instanceId);
    assert.deepEqual(afterClose.native.runs.map(run => run.id).sort(), savedRuns);
    const manifest = await call('merchant_client_export_manifest', { exportId: clientId });
    assert.equal(manifest.manifestFile.sha256, client.manifestSha256);
    let chunk = await call('merchant_client_export_file', { exportId: clientId, file: 'seller-client.mjs',
      expectedManifestSha256: client.manifestSha256, expectedSha256: first.file.sha256,
      offset: first.nextOffset, limit: 8192 });
    const received = [Buffer.from(first.data, 'base64')];
    for (;;) {
      received.push(Buffer.from(chunk.data, 'base64'));
      if (chunk.nextOffset === null) break;
      chunk = await call('merchant_client_export_file', { exportId: clientId, file: 'seller-client.mjs',
        expectedManifestSha256: client.manifestSha256, expectedSha256: first.file.sha256,
        readId: chunk.readId, offset: chunk.nextOffset, limit: 8192 });
    }
    const customerModule = Buffer.concat(received);
    assert.equal(customerModule.length, first.file.bytes); assert.equal(hash(customerModule), first.file.sha256);
    assert.deepEqual(customerModule, await readFile(join(output, 'received-client', 'seller-client.mjs')));
    await call('merchant_client_export_file_release', { exportId: clientId, readId: chunk.readId });
    await checkpoint('MCP close drains its original seller and reopen resumes the retained customer bytes', {
      ...rollback, endedInstance: oldInstance, selectedRelease: releaseA.release.id,
      currentDataset: allB.snapshot, stateAfterClose: status.runtime.state,
      originalPublisherRuns: savedRuns.length, clientSha256: first.file.sha256, clientBytes: first.file.bytes });
    await close(mcpHost); mcpHost = null;
    for (const entry of sourceManifest.files)
      assert.equal(hash(await readFile(join(sourceRoot, entry.path))), entry.sha256, 'Source remained unchanged: ' + entry.path);
    for (const source of captured) {
      assert.equal(hash(await readFile(source.sourceFile)), source.sourceSha256);
      const original = await readNocoDBCapture(source.declaration.captureFile, source.captureSha256);
      assert.equal(original.manifestSha256, source.captureSha256);
    }
    assert.deepEqual(report.browserErrors, []);
    report.state = 'PASS'; report.completedAt = stamp();
    await save(join(output, 'result.json'), report);
    console.log('PASS complete original NocoDB source, publisher, merchant and customer receiving.');
  } catch (error) {
    report.state = 'FAIL'; report.failedAt = stamp(); report.error = errorView(error);
    await save(join(output, 'result.json'), report); throw error;
  } finally {
    for (const item of [...keep].reverse()) {
      try { await close(item); } catch (error) {
        report.cleanupErrors ??= []; report.cleanupErrors.push(errorView(error));
      }
    }
    if (report.cleanupErrors?.length) {
      report.state = 'FAIL'; await save(join(output, 'result.json'), report);
      process.exitCode = 1;
    }
  }
}

async function runAuthoringStage({ sourceRoot, output, captured, context, authoringModel, authoringServer,
  readNocoDBSourceFile, readNocoDBCapture, bindNocoDBCapture, projectedNocoDBValue,
  checkpoint, requestId, report, intent, intentFile }) {
  const adopted = [];
  intent.authoring ??= {};
  for (const original of captured) {
    const directory = join(output, 'authoring', original.id), targetDirectory = join(directory, 'dataset');
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    let exists = true;
    try { await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    const workspace = await authoringModel.openNocoDBAuthoring({ directory, create: !exists, targetDirectory });
    let service, page;
    try {
      const retained = intent.authoring[original.id] ??= {};
      if (!retained.importArgs) {
        const state = await workspace.status();
        retained.importArgs = { sourceFile: original.sourceFile, title: 'Actual NocoDB ' + original.id,
          expectedDraftRevision: state.draftRevision, requestId: await requestId('import-' + original.id) };
        await save(intentFile, intent);
      }
      const imported = await workspace.importSource(retained.importArgs);
      assert.equal(imported.capture.manifestSha256, original.captureSha256);
      assert.equal(imported.capture.rowCount, original.expectedRows);
      const capturedReview = await workspace.inspectCapture(imported.capture.id);
      await save(join(output, original.id + '-capture-review.json'), capturedReview);
      service = await authoringServer.serveNocoDBAuthoring({ workspace, port: 0 });
      page = await context.newPage();
      page.on('pageerror', error => report.browserErrors.push({ source: original.id, message: error.message }));
      await page.goto(service.url);
      await page.locator('#draft-fields').waitFor();
      const buttonReady = selector => waitFor(() => page.locator(selector).isEnabled(), selector);
      const mutation = async (routeName, selector, field) => {
        const route = '**/api/' + routeName;
        await page.route(route, async intercepted => {
          if (intercepted.request().method() !== 'POST') { await intercepted.continue(); return; }
          retained[field] = intercepted.request().postDataJSON();
          await save(intentFile, intent); // retain the real browser request before native dispatch
          await intercepted.continue();
        }, { times: 1 });
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/' + routeName &&
          value.request().method() === 'POST');
        await buttonReady(selector); await page.click(selector);
        const result = await response; assert(result.ok(), await result.text());
        await page.locator('#recovery').waitFor({ state: 'hidden' });
      };
      let version;
      if (!retained.versionArgs) {
        await mutation('preview', '#preview-draft', 'previewArgs');
        const preview = await workspace.preview(retained.previewArgs); // exact native request replay
        assert.equal(preview.allRowsChecked, true);
        assert(preview.reports[original.query]);
        await page.locator('#preview').waitFor();
        await save(join(output, original.id + '-original-preview.json'), preview);
        await page.fill('#reviewer', 'Original NocoDB receiving operation');
        await page.fill('#change-note', 'Reviewed the original complete ' + original.expectedRows +
          '-record capture, all selected field identities, exact scalar encodings and public aliases.');
        await mutation('version', '#save-version', 'versionArgs');
      }
      const saved = await workspace.saveVersion(retained.versionArgs);
      version = saved.version;
      assert.equal(version.observationSha256, original.captureSha256);
      assert.equal(version.sourceSha256, hash(await readFile(version.sourceFile)));
      assert.equal(saved.selectedVersion, version.id);
      await page.reload(); await page.locator('#versions').waitFor();
      const screenshot = join(output, original.id + '-authoring-desktop.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      await page.setViewportSize({ width: 412, height: 915 });
      await page.screenshot({ path: join(output, original.id + '-authoring-mobile.png'), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Original source authoring fits the mobile viewport.');
      if (!retained.publisherArgs) {
        retained.publisherArgs = { expectedSelectedVersion: version.id,
          requestId: await requestId('publisher-' + original.id) };
        await save(intentFile, intent);
      }
      const publisher = await workspace.openPublisher(retained.publisherArgs);
      assert.equal(publisher.sourceVersion, version.id);
      assert.equal(publisher.sourceSha256, version.sourceSha256);
      const settings = await optional(join(publisher.publisherDirectory, 'workspace.json'));
      assert.equal(settings.schema, 'stellar-forge.nocodb-publisher-workspace.v1');
      assert.equal(settings.targetDirectory, targetDirectory);
      assert.equal(hash(await readFile(settings.sourceFile)), version.sourceSha256);
      retained.version = { id: version.id, sourceFile: version.sourceFile,
        sourceSha256: version.sourceSha256, observationSha256: version.observationSha256 };
      retained.publisher = { directory: publisher.publisherDirectory, targetDirectory };
      await save(intentFile, intent);
      await page.close(); page = null;
      await service.close(); service = null;
      // Reopen the actual authoring owner and the same immutable request receipt.
      const reopened = await authoringModel.openNocoDBAuthoring({ directory });
      try {
        const recovered = await reopened.saveVersion(retained.versionArgs);
        assert.equal(recovered.version.id, version.id);
        assert.equal(recovered.version.sourceSha256, version.sourceSha256);
      } finally { await reopened.close(); }
      const declaration = await readNocoDBSourceFile(settings.sourceFile);
      const capture = await readNocoDBCapture(declaration.captureFile, original.captureSha256);
      const records = bindNocoDBCapture(capture, declaration.config);
      const projections = value => Object.fromEntries(Object.entries(value.queries).map(([name, query]) => [name, query.projection]));
      assert.deepEqual(projections(declaration), projections(original.declaration),
        'First reviewed source preserves every actual normalized field and scalar policy.');
      const query = declaration.queries[original.query];
      const originalRows = records.map(record => Object.fromEntries(original.publicColumns.map(name =>
        [name, projectedNocoDBValue(record, query.projection[name])])));
      exactRows(originalRows, original.originalRows, original.id + ' saved source preserves captured values');
      adopted.push({ ...original, sourceFile: settings.sourceFile, sourceSha256: version.sourceSha256,
        immutableSourceFile: version.sourceFile, declaration, capture, originalRows,
        version: version.id, publisherDirectory: publisher.publisherDirectory, targetDirectory });
      await checkpoint('Original ' + original.id + ' authoring saves and reopens its reviewed source', {
        records: records.length, version: version.id, sourceSha256: version.sourceSha256,
        captureSha256: original.captureSha256, completeFieldSelectionRetained: true,
        samePublisherDirectory: true });
    } finally {
      try { await page?.close(); } finally {
        if (service) await service.close();
        else await workspace.close();
      }
    }
  }
  return adopted;
}

async function receiveClient({ context, consoleHost, consoleApi, output, clientId,
  report, checkpoint, expectedRelease, expectedAmount, snapshot, resourcePath, operationId, intent, intentFile }) {
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push({ source: 'customer-console', message: error.message }));
  try {
    await page.goto(consoleHost.operatorUrl);
    await page.locator('#runtime').waitFor();
    await waitFor(async () => (await page.locator('#runtime').textContent())?.includes('RUNNING'),
      'the original running merchant in its customer console');
    await page.fill('#client-export-id', clientId);
    let retained = await consoleApi('/api/clients/inspect?exportId=' + encodeURIComponent(clientId));
    if (retained.state === 'NOT_FOUND') {
      await page.route('**/api/clients/generate', async route => {
        const response = await route.fetch({ timeout: 120000 });
        if (!response.ok()) { await route.fulfill({ response }); return; }
        const bytes = await response.body();
        await saveBytes(join(output, 'withheld-original-client-reply.json'), bytes);
        intent.clientReplyWithheld = true; await save(intentFile, intent);
        await route.abort('failed'); // one real native export; only its browser reply is lost
      }, { times: 1 });
      intent.clientGenerateCommands = (intent.clientGenerateCommands ?? 0) + 1; await save(intentFile, intent);
      await waitFor(() => page.locator('#client-generate').isEnabled(), 'customer generation control');
      await page.click('#client-generate');
      await waitFor(async () => (await page.locator('#client-notice').textContent())?.includes('Inspect retained client'),
        'original UI handoff recovery after the lost reply');
      assert.equal(intent.clientReplyWithheld, true);
    } else assert.equal(retained.state, 'COMPLETE', 'Preserve and inspect any interrupted original export before another generation.');
    const inspectedResponse = page.waitForResponse(value =>
      new URL(value.url()).pathname === '/api/clients/inspect' && value.request().method() === 'GET');
    await waitFor(() => page.locator('#client-inspect').isEnabled(), 'original retained-client inspection');
    await page.click('#client-inspect');
    const response = await inspectedResponse; assert(response.ok(), await response.text());
    retained = await response.json();
    assert.equal(retained.state, 'COMPLETE');
    assert.equal(retained.manifest.provenance.releaseId, expectedRelease.id);
    assert.equal(retained.manifest.provenance.releaseDigest, expectedRelease.digest);
    assert.equal(retained.files.length, 5);
    await waitFor(async () => await page.locator('#client-files tr').count() === 6,
      'the six original customer files after the response renders');
    await page.screenshot({ path: join(output, 'customer-handover-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: join(output, 'customer-handover-mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Original customer handover fits the mobile viewport.');
    const downloaded = page.waitForEvent('download');
    await page.click('#client-package'); const download = await downloaded;
    const archive = Buffer.from(await readFile(await download.path()));
    const expected = [...retained.manifest.files, retained.manifestFile];
    const received = unpackTar(archive, clientId, expected);
    const receivedDirectory = join(output, 'received-client');
    await mkdir(receivedDirectory, { recursive: true, mode: 0o700 });
    for (const [name, content] of received) await saveBytes(join(receivedDirectory, name), content);
    await saveBytes(join(output, clientId + '.tar.gz'), archive);
    await save(join(output, 'customer-handover.json'), retained);
    const originalModule = retained.files.find(file => file.name === 'seller-client.mjs');
    const fileQuery = new URLSearchParams({ exportId: clientId, file: originalModule.name,
      expectedManifestSha256: retained.manifestFile.sha256, expectedSha256: originalModule.sha256 });
    const range = await consoleApi('/api/clients/download?' + fileQuery, undefined, true, { range: 'bytes=512-1023' });
    assert.equal(range.status, 206);
    const rangeBytes = Buffer.from(await range.arrayBuffer());
    assert.deepEqual(rangeBytes, received.get(originalModule.name).subarray(512, 1024));
    const customer = await import(pathToFileURL(join(receivedDirectory, 'seller-client.mjs')).href);
    const operation = customer.operations.find(value => value.method === 'GET' && value.path === resourcePath);
    assert(operation, 'Original generated client exposes the reviewed resource.');
    const request = customer.buildRequest(operation.id, { query: { limit: '2', snapshot } }, {
      intentId: operationId + '-customer-offline', acceptIndex: 0, maxAtomic: expectedAmount });
    assert.equal(new URL(request.url).searchParams.get('snapshot'), snapshot);
    assert(JSON.stringify(request).includes(expectedAmount));
    await save(join(output, 'original-customer-request.json'), request);
    const result = { exportId: clientId, manifestSha256: retained.manifestFile.sha256,
      sourceSha256: retained.sourceSha256, filesSha256: retained.filesSha256,
      files: expected.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
      archiveSha256: hash(archive), archiveBytes: archive.length,
      releaseId: expectedRelease.id, releaseDigest: expectedRelease.digest,
      offlineRequestSha256: hash(jsonBytes(request)), snapshot,
      generateCommands: intent.clientGenerateCommands ?? 0,
      controlledReplyLoss: intent.clientReplyWithheld === true,
      rangeBytes: rangeBytes.length };
    await checkpoint('Customer browser recovers one original export and receives all six reviewed files', {
      exportId: clientId, manifestSha256: result.manifestSha256, archiveSha256: result.archiveSha256,
      archiveBytes: archive.length, files: expected.length, generationCommands: result.generateCommands,
      offlineRequestSha256: result.offlineRequestSha256 });
    return result;
  } finally { await page.close(); }
}

