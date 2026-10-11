#!/usr/bin/env node
// MIT. Portable public-fixture PostgreSQL workspace → original fleet continuation.
// Experiment driver: execute once in the original PostgreSQL owner's admitted job.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, readFile, writeFile, stat, rename, unlink, readdir, open, lstat } from 'node:fs/promises';
import { spawn, fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join, resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const driverDirectory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.PG_FLEET_SOURCE ?? join(driverDirectory, '../..'));
const work = resolve(process.env.PG_FLEET_OUTPUT ?? join(process.cwd(), 'postgres-fleet-continuation'));
const python = process.env.PG_FLEET_PYTHON ?? 'python3';
const sdk = join(repo, 'stellar/scf-starforge-20261009'), postgres = join(sdk, 'sf30-seller-sdk/postgres');
const dist = join(repo, 'stellar-forge/developer-site/dist');
const directory = join(work, 'operator'), planFile = join(directory, 'fleet-plan.json');
const packet = join(work, 'unpacked/postgres-fleet');
const read = async file => JSON.parse(await readFile(file, 'utf8'));
async function save(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync();
    await handle.close(); handle = null; await rename(temporary, file);
    if (process.platform !== 'win32') {
      const parent = await open(dirname(file), 'r'); try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const run = promisify(execFile), require = createRequire(join(repo, 'package.json'));
const { main: startPostgresWorkspace } = await import(join(postgres, 'workspace/server.mjs'));
const { reviewPostgresSelection } = await import(join(sdk, 'sf82-seller-pilot/release-postgres-control.mjs'));
const { preparePostgresRelease } = await import(join(sdk, 'sf82-seller-pilot/release-postgres.mjs'));
const { startReleaseConsole } = await import(join(sdk, 'sf82-seller-pilot/release-console.mjs'));
const { initReleaseStore, readReleaseState, inspectRelease } = await import(join(sdk, 'sf82-seller-pilot/releases.mjs'));
const { readFleetReleasePlan } = await import(join(sdk, 'merchant-fleet-gateway/release-operator.mjs'));
const { bootstrapFleet } = await import(join(sdk, 'merchant-fleet-gateway/release-bootstrap.mjs'));
const { startFleetWorkspace } = await import(join(sdk, 'merchant-fleet-gateway/workspace/server.mjs'));
const { validateFleetDraft, importFleetDraft, importFleetSource } = await import(join(dist, 'fleet-onboarding.mjs'));
const { startMerchantMcp } = await import(join(repo, 'stellar-forge/mcp-merchant-operator/serve.mjs'));
const { MCP_VERSION } = await import(join(repo, 'stellar-forge/mcp-paid-agent/agent-server.mjs'));
const { encodePaymentSignatureHeader } = require('@x402/core/http');
const { Client } = createRequire(join(postgres, 'demo-database.mjs'))('pg');

await mkdir(work, { recursive: true, mode: 0o700 });
let receipt;
try { receipt = await read(join(work, 'receipt.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  receipt = { schema: 'scratch.postgres-fleet-journey.v1', startedAt: new Date().toISOString(), source: repo,
    fixture: 'Original public postgres/demo-database.mjs and example-seed.sql',
    stages: [], deliveries: [], browserErrors: [], sourceHashes: {}, complete: false };
}
async function mark(name, values = {}) {
  receipt.stages.push({ name, at: new Date().toISOString(), ...values });
  await save(join(work, 'receipt.json'), receipt);
  console.log(JSON.stringify({ stage: name, ...values }));
}
function jsonValues(text) {
  const values = []; let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) { if (char !== '{') continue; start = index; }
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && --depth === 0) { values.push(JSON.parse(text.slice(start, index + 1))); start = -1; }
  }
  return values;
}
async function command(id) {
  const commands = (await read(join(packet, 'commands.json'))).commands;
  const entry = commands.find(row => row.id === id); assert(entry, 'Original launch command ' + id);
  const result = await run(process.execPath, [join(sdk, 'distribution/cli.mjs'), ...entry.args], {
    cwd: packet, env: process.env, timeout: 90000, maxBuffer: 4 * 1024 * 1024,
  });
  const value = jsonValues(result.stdout).at(-1); assert(value, result.stdout); return value;
}
const bridgeFiles = [], held = [];
let database, databaseClosed, facilitator, merchantWorkspace, consoleWorkspace, fleetWorkspace, staticServer, mcp, terminal, client;
let sharedPublicDemo = false;
let terminateCleanup, cleanupPromise, releaseVerification, heldArrived, holdVerification = false, verifies = 0, settles = 0;
async function reserve(port = 0) {
  const listener = createServer();
  await new Promise((done, fail) => { listener.once('error', fail); listener.listen(port, '127.0.0.1', done); });
  held.push(listener); return listener.address().port;
}
async function releasePorts() {
  for (const listener of held.splice(0)) await new Promise(done => listener.close(done));
}
async function browserPhase(phase, data) {
  const input = join(work, phase + '-browser-input.json'), output = join(work, phase + '-browser.json');
  bridgeFiles.push(input); await save(input, { work, ...data });
  await run(python, ['-B', join(driverDirectory, 'browser.py'), phase, input, output], {
    env: process.env, timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  const result = await read(output); assert.deepEqual(result.browserErrors, []);
  receipt.browserErrors.push(...result.browserErrors); return result;
}
async function startDemo() {
  if (process.env.PG_FLEET_PUBLIC_DEMO_URL) {
    const uri = new URL(process.env.PG_FLEET_PUBLIC_DEMO_URL);
    assert(['postgres:', 'postgresql:'].includes(uri.protocol) && uri.hostname === '127.0.0.1',
      'The original public demo must use its selected loopback PostgreSQL connection');
    process.env.E49_POSTGRES_FLEET_URL = uri.href;
    client = new Client({ connectionString: uri.href }); await client.connect();
    const rows = await client.query('SELECT id::text,title,region,price_cents::text FROM sf30_demo.products ORDER BY id');
    const expected = [
      { id: '1', title: 'Example sensor', region: 'north', price_cents: '499' },
      { id: '2', title: 'Example actuator', region: 'south', price_cents: '725' },
      { id: '3', title: '東京 demo', region: 'north', price_cents: '900719925474099312345' },
      { id: '4', title: 'Example gateway', region: 'north', price_cents: '2499' },
    ];
    assert(JSON.stringify(rows.rows) === JSON.stringify(expected), 'Use the exact original public four-row demo for this continuation');
    const version = (await client.query('SELECT version() AS version')).rows[0].version;
    await client.end(); client = null; sharedPublicDemo = true;
    receipt.database = { engine: 'Original owner public PostgreSQL fixture', version, fixtureRows: 4, owner: 'original execution owner' };
    return;
  }
  // The original public fixture creates only its four fictional products.
  database = fork(join(postgres, 'demo-database.mjs'), [], {
    execArgv: ['--max-old-space-size=384'], env: { PATH: process.env.PATH ?? '' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = ''; database.stderr.on('data', data => { errors = (errors + data).slice(-12000); });
  databaseClosed = new Promise(done => {
    database.once('error', error => { errors += error.message; done(); });
    database.once('close', (code, signal) => { receipt.databaseExit = { code, signal }; done(); });
  });
  const ready = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error('Original public PostgreSQL demo did not become ready: ' + errors)), 60000);
    database.once('error', error => { clearTimeout(timer); fail(error); });
    database.once('exit', code => { clearTimeout(timer); fail(Error('Original PostgreSQL demo exited ' + code + ': ' + errors)); });
    database.on('message', value => { if (value?.event === 'ready') { clearTimeout(timer); done(value); } });
  });
  const uri = new URL(ready.uri); uri.password = randomBytes(16).toString('hex');
  process.env.E49_POSTGRES_FLEET_URL = uri.href;
  receipt.database = { engine: ready.engine, version: ready.version, fixtureRows: 4 };
}
async function startFacilitator() {
  facilitator = createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; }
    if (request.url === '/verify' && holdVerification) {
      holdVerification = false; heldArrived(); await new Promise(done => { releaseVerification = done; });
    }
    const value = request.url === '/supported' ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }
      : request.url === '/verify' ? (verifies++, { isValid: true, payer: 'LOCAL_NATIVE_POSTGRES_FIXTURE' })
      : request.url === '/settle' ? { success: true, network: 'stellar:testnet', payer: 'LOCAL_NATIVE_POSTGRES_FIXTURE',
        transaction: hash('LOCAL_NATIVE_POSTGRES_FIXTURE_' + (++settles)) } : null;
    response.writeHead(value ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
  });
  await new Promise((done, fail) => { facilitator.once('error', fail); facilitator.listen(receipt.inputs.ports.facilitator, '127.0.0.1', done); });
}
async function initializeInputs() {
  if (receipt.inputs) return;
  const ports = { ingress: await reserve(), admin: await reserve(), facilitator: await reserve() };
  for (let attempt = 0; attempt < 40; attempt++) {
    const before = held.length;
    try { ports.merchant = await reserve(); for (let index = 1; index < 4; index++) await reserve(ports.merchant + index); break; }
    catch (error) { for (const item of held.splice(before)) await new Promise(done => item.close(done)); if (attempt === 39) throw error; }
  }
  receipt.inputs = { ports, hosts: { products: 'pg-products.example', catalog: 'pg-catalog.example' } };
  await save(join(work, 'receipt.json'), receipt); await releasePorts();
}
const runtime = () => ({ facilitator: 'http://127.0.0.1:' + receipt.inputs.ports.facilitator, allowLocalFacilitator: true });
async function authorAndExport() {
  if (receipt.browserComplete) return;
  const sourcePath = join(work, 'existing-source.json');
  const source = await read(join(postgres, 'example-source.json'));
  source.connectionEnv = 'E49_POSTGRES_FLEET_URL'; source.tls = 'local-plaintext'; source.maxConnections = 1;
  await save(sourcePath, source);
  merchantWorkspace = await startPostgresWorkspace(['--source', sourcePath, '--output', join(work, 'exports'), '--port', '0']);
  const session = await (await fetch(merchantWorkspace.url + '/api/session')).json();
  const request = async (path, body, status = 200) => {
    const response = await fetch(merchantWorkspace.url + path, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-token': session.token }, body: JSON.stringify(body),
    });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  };
  let author;
  if (receipt.authorComplete) author = await read(join(work, 'author-browser.json'));
  else {
    author = await browserPhase('author', { url: merchantWorkspace.url, runtime: runtime(),
      publicOrigin: 'https://' + receipt.inputs.hosts.products,
      payment: { asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT' } });
    receipt.authorComplete = true;
    await mark('Original PostgreSQL browser authored and exported a reviewed fleet source without a separate release store', {
      inputManifestSha256: author.source.postgresInputManifestSha256, publicColumns: author.choices.columns,
      noFixedPort: !Object.hasOwn(author.source.runtime, 'port'), width: author.responsive.width,
    });
  }
  let exports = receipt.exports;
  if (!exports) {
    exports = [{ tenant: 'products', alias: 'current', amount: '10000', directory: author.exported.directory }];
    for (const [tenant, alias, amount] of [['products', 'next', '12500'], ['catalog', 'current', '20000'], ['catalog', 'next', '22500']]) {
      const choices = structuredClone(author.choices);
      choices.publicOrigin = 'https://' + receipt.inputs.hosts[tenant]; choices.payment.amount = amount;
      const preview = await request('/api/preview', choices);
      const exported = await request('/api/export', { ...choices, expectedPlanId: preview.planId }, 201);
      exports.push({ tenant, alias, amount, directory: exported.directory });
    }
    receipt.exports = exports; await save(join(work, 'receipt.json'), receipt);
  }
  await merchantWorkspace.close(); merchantWorkspace = null;
  const store = join(work, 'single-merchant-releases');
  try { await readReleaseState(store); } catch (error) { if (error.code !== 'ENOENT') throw error; await initReleaseStore(store); }
  consoleWorkspace = await startReleaseConsole(store, { port: 0 });
  staticServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const path = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/fleet.html' : url.pathname));
      if (relative(dist, path).startsWith('..')) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(path), type = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(done => staticServer.listen(0, '127.0.0.1', done));
  const { ports, hosts } = receipt.inputs;
  const native = { schema: 'stellar-forge.fleet-bootstrap.v1', gateway: { port: ports.ingress, adminPort: ports.admin },
    merchantPortStart: ports.merchant, slots: ['blue', 'green'], tenants: Object.keys(hosts).map(id => ({
      id, host: hosts[id], packages: {}, initial: { package: 'current', releaseId: 'initial' },
    })) };
  const handoff = await browserPhase('handoff', { consoleUrl: consoleWorkspace.operatorUrl,
    fleetUrl: 'http://127.0.0.1:' + staticServer.address().port + '/fleet.html', runtime: runtime(),
    packages: exports.map(item => ({ ...item, relativePath: relative(process.cwd(), item.directory) })),
    native, workspaceSource: author.source, directory, mcpDirectory: join(work, 'merchant-mcp'),
  });
  await consoleWorkspace.close(); consoleWorkspace = null;
  staticServer.closeAllConnections(); await new Promise(done => staticServer.close(done)); staticServer = null;
  await run(python, ['-B', '-c',
    'import zipfile,pathlib,sys\np=pathlib.Path(sys.argv[2]);p.mkdir(mode=0o700,exist_ok=True)\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert set(z.namelist())=={"postgres-fleet/"+n for n in ["fleet-setup.json","setup-input.json","commands.json","README.md"]}\n assert sum(i.file_size for i in z.infolist())<1048576\n z.extractall(p)',
    handoff.zipFile, join(work, 'unpacked')]);
  const declaration = await read(join(packet, 'fleet-setup.json'));
  for (const tenant of declaration.tenants) for (const [alias, source] of Object.entries(tenant.packages)) {
    assert.deepEqual(source, handoff.sources[tenant.id][alias]);
    const original = await reviewPostgresSelection({ postgresPackage: source.postgresPackage });
    assert.equal(source.postgresInputManifestSha256, original.postgres.inputManifestSha256);
    assert.equal(original.postgresPackage, source.postgresPackage);
  }
  const imported = validateFleetDraft(importFleetDraft(JSON.stringify(declaration))); assert(imported.valid, JSON.stringify(imported.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(imported.declaration)), declaration);
  const importedSource = importFleetSource(await readFile(join(work, 'products-current-fleet-source.json'), 'utf8'), 'current');
  assert.equal(importedSource.postgresInputManifestSha256, author.source.postgresInputManifestSha256);
  receipt.inputs.packages = handoff.sources; receipt.browserComplete = true;
  await mark('Both original source downloads preserved canonical paths and package review through the native fleet draft, reopen and ZIP', {
    sourceDownloads: exports.length + 1, canonicalRelativePaths: handoff.canonicalRelativePaths,
    reviewIdentityRoundtrip: handoff.reviewIdentityRoundtrip, typeChangeClearedReview: handoff.typeChangeClearedReview,
    width: handoff.fleetResponsive.width, zipSha256: hash(await readFile(handoff.zipFile)),
  });
}

async function startTerminal() {
  const child = spawn(process.execPath, [join(sdk, 'merchant-fleet-gateway/release-cli.mjs'), 'start',
    '--plan', planFile, '--directory', directory], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', consumed = 0, closed = false;
  child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-4 * 1024 * 1024); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16000); });
  const completion = new Promise(done => { child.once('error', error => { stderr += error.message; closed = true; done(); });
    child.once('close', (code, signal) => { closed = true; receipt.terminalExit = { code, signal }; done(); }); });
  const next = async () => {
    for (let attempt = 0; attempt < 600; attempt++) {
      const values = jsonValues(stdout);
      if (values.length > consumed) return values[consumed++];
      if (closed) throw Error('Original fleet CLI ended: ' + stderr);
      await delay(100);
    }
    throw Error('Original fleet CLI response timeout: ' + stderr);
  };
  const close = async () => {
    if (!closed) child.stdin.end('quit\n');
    let timer; await Promise.race([completion, new Promise(done => {
      timer = setTimeout(() => { if (!closed) child.kill('SIGTERM'); done(); }, 12000);
    })]); clearTimeout(timer); await completion;
  };
  terminal = { child, close, async call(line) { assert(!closed); child.stdin.write(line + '\n'); return next(); } };
  const initial = await next(); assert(initial.status && initial.commands, JSON.stringify(initial)); return initial;
}
function exchange(tenant, headers = {}) {
  const { ports, hosts } = receipt.inputs;
  return new Promise((done, fail) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: ports.ingress, method: 'GET',
      path: '/data/catalog?region=north&minimum_id=3', headers: { host: hosts[tenant], ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', fail);
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once('error', fail); request.setTimeout(30000, () => request.destroy(Error('Original fleet delivery timeout'))); request.end();
  });
}
async function buy(tenant, amount, label, title = 'Example gateway') {
  const unsigned = await exchange(tenant); assert.equal(unsigned.status, 402, unsigned.body.toString());
  const required = JSON.parse(Buffer.from(unsigned.headers['payment-required'], 'base64'));
  assert.equal(required.accepts[0].amount, amount);
  const response = await exchange(tenant, { 'payment-signature': encodePaymentSignatureHeader({ x402Version: 2,
    resource: required.resource, accepted: required.accepts[0], extensions: required.extensions,
    payload: { nativeFleetJourney: 'LOCAL_FACILITATOR_FIXTURE' } }) });
  assert.equal(response.status, 200, response.body.toString()); assert(response.headers['payment-response']);
  const value = JSON.parse(response.body); assert.equal(value.rows.length, 2);
  assert.deepEqual(value.rows.map(row => row.id), ['3', '4']);
  assert.equal(value.rows[0].title, '東京 demo'); assert.equal(value.rows[0].price_cents, '900719925474099312345');
  assert.equal(value.rows[1].title, title); assert.equal(value.rows[1].price_cents, '2499');
  assert(value.rows.every(row => !Object.hasOwn(row, 'internal_note') && Object.keys(row).length === 3));
  receipt.deliveries.push({ tenant, label, amount, bytes: response.body.length, sha256: hash(response.body),
    paymentFixture: 'original installed x402 SDK with the original public operations-journey local facilitator protocol' });
  await writeFile(join(work, label + '-response.json'), response.body, { mode: 0o600 });
  await save(join(work, 'receipt.json'), receipt); return value;
}
const bearer = randomBytes(32).toString('base64url'); let rpcId = 0;
async function wire(name, args = {}) {
  const response = await fetch(mcp.url, { method: 'POST', headers: {
    authorization: 'Bearer ' + bearer, accept: 'application/json, text/event-stream',
    'content-type': 'application/json', 'mcp-protocol-version': MCP_VERSION,
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200); const value = await response.json(); assert(value.result, JSON.stringify(value)); return value.result;
}
async function call(name, args) { const value = await wire(name, args); assert.equal(value.isError, false, JSON.stringify(value)); return value.structuredContent; }
async function startMcp() {
  mcp = await startMerchantMcp({ configPath: receipt.mcpConfiguration, port: 0,
    environment: { ...process.env, MCP_ACCESS_TOKEN: bearer } });
  const plan = await call('merchant_fleet_plan'); assert.equal(plan.digest, receipt.planDigest);
  assert(plan.tenants.every(tenant => tenant.packageSources.every(source => source.kind === 'POSTGRES_MERCHANT_PACKAGE')));
  return call('merchant_fleet_start', { expectedPlanDigest: plan.digest });
}
async function nativePhase() {
  if (!receipt.captureCancellationComplete) {
    const controller = new AbortController(); let requested = false, capturedError;
    try {
      await bootstrapFleet({ declarationFile: join(packet, 'fleet-setup.json'), directory,
        signal: controller.signal, onProgress(event) {
          if (event.phase === 'release-staging' && !requested) {
            requested = true;
            // Let the original stage enter its asynchronous file capture, then
            // cancel through the public signal supplied by its owning bootstrap.
            setImmediate(() => controller.abort(Error('Owned PostgreSQL capture interruption')));
          }
        } });
    } catch (error) { capturedError = error; }
    assert(requested && controller.signal.aborted && capturedError, 'Native package capture must observe its owner interruption');
    const store = join(directory, 'stores/products/blue');
    assert.equal((await readReleaseState(store)).generation, 0);
    assert.deepEqual(await readdir(join(store, 'releases')), [], 'Cancelled PostgreSQL capture must leave no committed release');
    const retained = await read(join(directory, 'bootstrap.json'));
    assert.equal(retained.status, 'PREPARING'); assert.equal(retained.lastError.phase, 'release-staging');
    receipt.captureCancellationComplete = true;
    await mark('Original bootstrap cancelled in-flight PostgreSQL capture and retained the same setup for its exported CLI to resume', {
      nativeStageObservedSignal: true, committedReleases: 0, retainedSetup: retained.status,
    });
  }
  const setup = await command('setup'), plan = await readFleetReleasePlan(planFile);
  assert.equal(setup.planDigest, plan.digest);
  if (receipt.planDigest) assert.equal(plan.digest, receipt.planDigest); else receipt.planDigest = plan.digest;
  if (!receipt.bootstrapComplete) {
    receipt.initialDigests = {};
    for (const tenant of plan.tenants) for (const [name, slot] of Object.entries(tenant.slots)) {
      assert.equal((await stat(slot.store)).mode & 0o777, 0o700);
      const state = await readReleaseState(slot.store); assert.equal(state.generation, name === 'blue' ? 1 : 0);
      if (name === 'blue') {
        const release = await inspectRelease(slot.store, 'initial');
        assert.equal(release.postgres.inputManifestSha256, receipt.inputs.packages[tenant.id].current.postgresInputManifestSha256);
        receipt.initialDigests[tenant.id] = release.digest;
      }
    }
    receipt.bootstrapComplete = true;
    await mark('Unchanged browser launch ZIP initialized four original private stores with both reviewed PostgreSQL releases', {
      planDigest: plan.digest, initialDigests: receipt.initialDigests, engine: receipt.database,
    });
  }
  if (!receipt.terminalComplete) {
    await startTerminal();
    const state = await terminal.call('status'); assert.equal(state.native.revision, 1);
    const next = receipt.inputs.packages.products.next, serviceFile = join(next.postgresPackage, 'service.json');
    const before = await readFile(serviceFile);
    try {
      // Whitespace preserves valid JSON but changes the reviewed original byte identity.
      await writeFile(serviceFile, Buffer.concat([before, Buffer.from('\n')]), { mode: 0o600 });
      const rejected = await terminal.call('stage products green next second'); assert(rejected.error, JSON.stringify(rejected));
      receipt.changedPackageRefusal = rejected.error;
    } finally { await writeFile(serviceFile, before, { mode: 0o600 }); }
    const staged = await terminal.call('stage products green next second');
    assert.equal(staged.release?.sourceKind, 'POSTGRES_MERCHANT_PACKAGE', JSON.stringify(staged));
    const original = await inspectRelease(join(directory, 'stores/products/green'), 'second');
    assert.equal(original.postgres.inputManifestSha256, next.postgresInputManifestSha256);
    await buy('products', '10000', 'cli-initial-products'); await buy('catalog', '20000', 'cli-initial-catalog');
    await terminal.close(); terminal = null; receipt.terminalComplete = true;
    await mark('Original fleet CLI rejected a changed reviewed package, then staged the restored exact source and served both native paid queries', {
      changedPackageRefusal: receipt.changedPackageRefusal, stagedDigest: original.digest,
      exactNumeric: '900719925474099312345', projectedColumns: ['id', 'title', 'price_cents'],
    });
  }
  if (!receipt.managedBrowserComplete) {
    fleetWorkspace = await startFleetWorkspace({ releasePlan: planFile, releaseDirectory: directory, port: 0 });
    const browser = await browserPhase('managed', { url: fleetWorkspace.url });
    assert(browser.operationsOpened); await fleetWorkspace.close(); fleetWorkspace = null;
    receipt.managedBrowserComplete = true;
    await mark('Original managed fleet displayed PostgreSQL sources and opened the native merchant Operations console', {
      width: browser.responsive.width, browserErrors: browser.browserErrors,
    });
  }
  if (!receipt.mcpConfiguration) {
    const initialized = await command('mcp-init'); await command('mcp-host');
    receipt.mcpConfiguration = initialized.configuration; await save(join(work, 'receipt.json'), receipt);
  }
  if (!receipt.lifecycleComplete) {
    await startMcp();
    const staged = await call('merchant_fleet_stage', { tenant: 'catalog', slot: 'green', package: 'next', releaseId: 'second' });
    assert.equal(staged.release.sourceKind, 'POSTGRES_MERCHANT_PACKAGE');
    const original = await inspectRelease(join(directory, 'stores/catalog/green'), 'second');
    assert.equal(original.postgres.inputManifestSha256, receipt.inputs.packages.catalog.next.postgresInputManifestSha256);
    const reviewed = await call('merchant_fleet_review', { tenant: 'products', slot: 'green', releaseId: 'second' });
    assert(reviewed.comparison.summary.paymentChanged > 0);
    const prepared = await call('merchant_fleet_prepare', { reviewId: reviewed.reviewId });
    const arrived = new Promise(done => { heldArrived = done; }); holdVerification = true;
    const draining = buy('products', '10000', 'inflight-original-products'); draining.catch(() => {});
    await Promise.race([arrived, delay(10000).then(() => { throw Error('Original request did not reach the selected facilitator'); })]);
    await call('merchant_fleet_activate', { candidateId: prepared.candidateId, expectedRevision: prepared.expectedRevision });
    const status = (await call('merchant_fleet_status')).fleet;
    const old = status.tenants.find(tenant => tenant.id === 'products').slots.find(slot => slot.name === 'blue');
    const retirement = { tenant: 'products', slot: 'blue', instanceId: old.instanceId, expectedRevision: status.native.revision };
    const waiting = await wire('merchant_fleet_retire', retirement); assert.equal(waiting.isError, true);
    releaseVerification(); releaseVerification = null; await draining;
    await call('merchant_fleet_retire', retirement); await buy('products', '12500', 'next-products');
    const rollback = await call('merchant_fleet_rollback_review', { targetRevision: 1 });
    await call('merchant_fleet_rollback', { reviewId: rollback.reviewId });
    await buy('products', '10000', 'rollback-products');
    client = new Client({ connectionString: process.env.E49_POSTGRES_FLEET_URL }); await client.connect();
    await client.query('UPDATE sf30_demo.products SET title = $1 WHERE id = 4', ['Updated gateway']);
    await client.end(); client = null;
    await buy('products', '10000', 'live-updated-products', 'Updated gateway');
    await mcp.close(); mcp = null; receipt.lifecycleComplete = true;
    await mark('Original MCP staged the second merchant, reviewed prices, drained before retiring and restored the original live-query release', {
      prices: ['10000', '12500', '10000'], retirementWaitedForRequest: true,
      originalLiveRowUpdated: true, comparison: reviewed.comparison.summary,
    });
  }
  if (!receipt.sourcesMoved) {
    receipt.sourceRelocations ??= {};
    for (const item of receipt.exports) {
      const path = item.directory, target = path + '-moved';
      const present = await exists(path), moved = await exists(target);
      assert(present !== moved, 'Exactly one original or moved PostgreSQL package must exist: ' + path);
      const retained = await inspectRelease(join(directory, 'stores', item.tenant,
        item.alias === 'current' ? 'blue' : 'green'), item.alias === 'current' ? 'initial' : 'second');
      const identity = { inputManifestSha256: retained.postgres.inputManifestSha256,
        executionSha256: retained.postgres.executionSha256 };
      assert.equal(identity.inputManifestSha256,
        receipt.inputs.packages[item.tenant][item.alias].postgresInputManifestSha256);
      const previous = receipt.sourceRelocations[path];
      if (previous) {
        assert.equal(previous.target, target); assert.deepEqual(previous.identity, identity);
      } else {
        receipt.sourceRelocations[path] = { target, identity, complete: false };
        await save(join(work, 'receipt.json'), receipt);
      }
      const inspect = async candidate => {
        const prepared = await preparePostgresRelease(candidate);
        assert.equal(prepared.postgres.inputManifestSha256, identity.inputManifestSha256);
        assert.equal(prepared.postgres.executionSha256, identity.executionSha256);
      };
      await inspect(present ? path : target);
      if (present) { await rename(path, target); await inspect(target); }
      receipt.sourceRelocations[path].complete = true;
      await save(join(work, 'receipt.json'), receipt);
    }
    receipt.sourcesMoved = true; await save(join(work, 'receipt.json'), receipt);
  }
  const resumed = await command('setup'); assert.equal(resumed.planDigest, receipt.planDigest);
  // Reapply the one owned public-fixture row when resuming after process interruption.
  client = new Client({ connectionString: process.env.E49_POSTGRES_FLEET_URL }); await client.connect();
  await client.query('UPDATE sf30_demo.products SET title = $1 WHERE id = 4', ['Updated gateway']);
  await client.end(); client = null;
  const reopened = await startMcp(); assert.equal(reopened.fleet.native.revision, 3);
  await buy('products', '10000', 'relocated-reopened-products', 'Updated gateway');
  for (const tenant of ['products', 'catalog'])
    assert.equal((await inspectRelease(join(directory, 'stores', tenant, 'blue'), 'initial')).digest, receipt.initialDigests[tenant]);
  await mcp.close(); mcp = null; receipt.complete = true;
  await mark('Source relocation and original setup/MCP reopen preserved revision 3, exact retained identities and the live PostgreSQL query', {
    revision: reopened.fleet.native.revision, planDigest: receipt.planDigest, verifies, settles,
  });
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    releaseVerification?.();
    const closeErrors = [];
    for (const owner of [terminal, fleetWorkspace, mcp, merchantWorkspace, consoleWorkspace]) {
      try { await owner?.close(); } catch (error) { closeErrors.push(error.message); }
    }
    try { await client?.end(); } catch (error) { closeErrors.push(error.message); }
    if (sharedPublicDemo) {
      const restore = new Client({ connectionString: process.env.E49_POSTGRES_FLEET_URL });
      try { await restore.connect(); await restore.query('UPDATE sf30_demo.products SET title = $1 WHERE id = 4', ['Example gateway']); }
      catch (error) { closeErrors.push(error.message); }
      finally { await restore.end().catch(error => closeErrors.push(error.message)); }
    }
    await releasePorts();
    for (const server of [staticServer, facilitator]) if (server) {
      server.closeAllConnections(); await new Promise(done => server.close(done));
    }
    if (database && database.exitCode === null && database.signalCode === null) {
      if (database.connected) database.send({ event: 'stop' }); else database.kill('SIGTERM');
      let timer; await Promise.race([databaseClosed, new Promise(done => {
        timer = setTimeout(() => { database.kill('SIGKILL'); done(); }, 10000);
      })]); clearTimeout(timer);
    }
    await databaseClosed;
    for (const file of bridgeFiles) await unlink(file).catch(error => { if (error.code !== 'ENOENT') closeErrors.push(error.message); });
    receipt.cleanupErrors = closeErrors; receipt.ownedProcessesClosed = closeErrors.length === 0;
    const paths = ['stellar-forge/developer-site/dist/fleet-onboarding.mjs', 'stellar-forge/developer-site/dist/fleet-setup.mjs',
      'stellar-forge/mcp-merchant-operator/config.mjs', 'stellar-forge/mcp-merchant-operator/fleet.mjs',
      'stellar-forge/mcp-merchant-operator/operator.mjs', 'stellar-forge/mcp-merchant-operator/serve.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-bootstrap.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/browser.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-postgres.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-postgres-control.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/postgres.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/workspace/public/app.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/workspace/server.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/demo-database.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/example-seed.sql'];
    for (const path of paths) {
      try { receipt.sourceHashes[path] = hash(await readFile(join(repo, path))); }
      catch (error) { receipt.sourceHashes[path] = { error: error.code }; }
    }
    receipt.finishedAt = new Date().toISOString(); await save(join(work, 'receipt.json'), receipt);
  })();
  return cleanupPromise;
}
terminateCleanup = () => { receipt.error = { message: 'Original owner interrupted the continuation' };
  void cleanup().finally(() => { process.exitCode = 130; process.exit(); }); };
process.once('SIGINT', terminateCleanup); process.once('SIGTERM', terminateCleanup);
try {
  assert(!receipt.complete, 'This output already contains the complete accepted journey; inspect its receipt.');
  await initializeInputs(); await startDemo(); await startFacilitator();
  await authorAndExport(); await nativePhase();
  assert.deepEqual(receipt.browserErrors, []); delete receipt.error;
} catch (error) {
  receipt.error = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
} finally {
  await cleanup(); process.off('SIGINT', terminateCleanup); process.off('SIGTERM', terminateCleanup);
  console.log(JSON.stringify({ work, browserComplete: receipt.browserComplete ?? false, complete: receipt.complete,
    ownedProcessesClosed: receipt.ownedProcessesClosed, cleanupErrors: receipt.cleanupErrors }));
}
