// One source-native ClickHouse workspace → fleet continuation. Scratch acceptance only.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, readFile, writeFile, cp, stat, rename } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join, resolve, relative, extname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const repo = process.env.CLICKHOUSE_FLEET_SOURCE ?? '/workspace/scratch/e49d179edb44/scf_engineering/fleet-database-adoption/source';
const base = '/workspace/scratch/e49d179edb44/scf_engineering/clickhouse-fleet-adoption';
const work = resolve(process.env.CLICKHOUSE_FLEET_OUTPUT ?? join(base, 'run-joined'));
const nativeRoot = process.env.CLICKHOUSE_JOURNEY_ROOT;
const mode = process.argv[2] ?? 'all';
assert(['all', 'browser', 'native'].includes(mode));
const sdk = join(repo, 'stellar/scf-starforge-20261009'), ch = join(sdk, 'sf30-seller-sdk/clickhouse');
const dist = join(repo, 'stellar-forge/developer-site/dist');
const original = process.env.CLICKHOUSE_FIXTURE_ROOT ?? '/workspace/scratch/6f7c5af20f40/clickhouse-workspace-check/retained-workspace';
const state = join(work, 'merchant-workspace'), directory = join(work, 'operator'), planFile = join(directory, 'fleet-plan.json');
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(done => setTimeout(done, ms));
const run = promisify(execFile), require = createRequire(join(repo, 'package.json'));
const { chromium } = await import(process.env.CLICKHOUSE_PLAYWRIGHT_ENTRY ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { startClickHouseWorkspace } = await import(join(ch, 'workspace/server.mjs'));
const { prepareClickHouseSeller } = await import(join(ch, 'prepare.mjs'));
const { prepareClickHouseRelease } = await import(join(sdk, 'sf82-seller-pilot/release-clickhouse.mjs'));
const { createNativeSellerServer } = await import(join(sdk, 'sf30-seller-sdk/native-factory.mjs'));
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { encodePaymentSignatureHeader } = require('@x402/core/http');
const { validateFleetDraft, importFleetDraft, importFleetSource } = await import(join(dist, 'fleet-onboarding.mjs'));
const { readFleetReleasePlan } = await import(join(sdk, 'merchant-fleet-gateway/release-operator.mjs'));
const { readReleaseState, inspectRelease } = await import(join(sdk, 'sf82-seller-pilot/releases.mjs'));
const { startFleetWorkspace } = await import(join(sdk, 'merchant-fleet-gateway/workspace/server.mjs'));
const { startMerchantMcp } = await import(join(repo, 'stellar-forge/mcp-merchant-operator/serve.mjs'));
const { MCP_VERSION } = await import(join(repo, 'stellar-forge/mcp-paid-agent/agent-server.mjs'));
await mkdir(work, { recursive: true, mode: 0o700 });
let receipt;
try { receipt = await read(join(work, 'receipt.json')); }
catch { receipt = { schema: 'scratch.clickhouse-fleet-journey.v1', startedAt: new Date().toISOString(), source: repo,
  originalFixture: original, stages: [], sourceHashes: {}, deliveries: [], browserErrors: [], complete: false }; }
async function mark(name, value = {}) {
  receipt.stages.push({ name, at: new Date().toISOString(), ...value }); await save(join(work, 'receipt.json'), receipt);
  console.log(JSON.stringify({ stage: name, ...value }));
}
const browserOptions = { executablePath: process.env.CLICKHOUSE_CHROMIUM_EXECUTABLE ?? '/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true, args: ['--no-sandbox', '--single-process', '--no-zygote', '--disable-gpu', '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=128', '--disable-background-networking', '--disable-dev-shm-usage'] };
let browser, merchantWorkspace, fleetWorkspace, staticServer, mcp, database, databaseClosed, facilitator;
const held = [];
async function reserve(port = 0) {
  const listener = createServer(); await new Promise((done, fail) => { listener.once('error', fail); listener.listen(port, '127.0.0.1', done); });
  held.push(listener); return listener.address().port;
}
async function closeHeld() { for (const item of held.splice(0)) await new Promise(done => item.close(done)); }
const attach = page => { page.setDefaultTimeout(30000); page.on('pageerror', error => receipt.browserErrors.push(error.message)); page.on('dialog', dialog => dialog.accept()); return page; };
const idle = page => page.waitForFunction(() => !document.getElementById('refresh').disabled);
async function browserAction(page, path, click, expected = 200) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/' + path && response.request().method() === 'POST');
  await click(); const response = await pending, value = await response.json(); assert.equal(response.status(), expected, JSON.stringify(value)); await idle(page); return value;
}
async function download(page, button, target) {
  const pending = page.waitForEvent('download'); await button.click(); const item = await pending; await item.saveAs(target); await idle(page); return target;
}
function jsonValues(text) {
  const values = []; let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; if (start < 0) { if (c !== '{') continue; start = i; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) { values.push(JSON.parse(text.slice(start, i + 1))); start = -1; }
  }
  return values;
}
async function command(id) {
  const packet = join(work, 'unpacked/clickhouse-fleet'), commands = (await read(join(packet, 'commands.json'))).commands;
  const args = commands.find(row => row.id === id).args;
  const result = await run(process.execPath, [join(sdk, 'distribution/cli.mjs'), ...args], { cwd: packet, env: process.env, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  return jsonValues(result.stdout).at(-1);
}

async function browserPhase() {
  if (receipt.browserComplete) return;
  if (!receipt.inputs) {
    const ports = { ingress: await reserve(), admin: await reserve(), database: await reserve(), facilitator: await reserve() };
    for (let attempt = 0; attempt < 40; attempt++) {
      const before = held.length;
      try { ports.merchant = await reserve(); for (let n = 1; n < 4; n++) await reserve(ports.merchant + n); break; }
      catch (error) { for (const item of held.splice(before)) await new Promise(done => item.close(done)); if (attempt === 39) throw error; }
    }
    await mkdir(state, { mode: 0o700 });
    await cp(join(original, 'revisions'), join(state, 'revisions'), { recursive: true });
    await cp(join(original, 'current.json'), join(state, 'current.json'));
    receipt.inputs = { ports }; await save(join(work, 'receipt.json'), receipt);
  }
  const { ports } = receipt.inputs, runtime = { facilitator: 'http://127.0.0.1:' + ports.facilitator, allowLocalFacilitator: true };
  merchantWorkspace = await startClickHouseWorkspace({ stateDirectory: state, port: 0, sellerPort: 0, releaseRuntime: { ...runtime, port: 0 },
    nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: runtime.facilitator }) }) });
  const inventory = await merchantWorkspace.model.state(), opened = await merchantWorkspace.model.open({ revision: inventory.currentRevision });
  receipt.originalReview = { revision: opened.id, reviewId: opened.review.id, checkedAt: opened.review.checkedAt,
    columnTypes: opened.review.inspection.columnTypes, sourceSha256: opened.sourceSha256 };
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true }), page = attach(await context.newPage());
  await page.goto(merchantWorkspace.url); await idle(page);
  await page.locator('nav [data-view="review"]').click(); await idle(page); await page.locator('#acknowledge').check();
  const prepared = await browserAction(page, 'prepare', () => page.locator('#prepare').click(), 201);
  const preparedFile = join(work, 'prepared-fleet-source.json');
  await download(page, page.getByRole('button', { name: 'Download fleet source', exact: true }), preparedFile);
  const preparedSource = await read(preparedFile);
  assert.deepEqual(preparedSource.clickhouseColumnTypes, receipt.originalReview.columnTypes);
  assert.deepEqual(preparedSource.runtime, runtime); assert.equal(preparedSource.clickhousePackage, prepared.directory);
  await page.locator('#retained-release-id').fill('reviewed-initial');
  await page.locator('#retained-release-label').fill('Reviewed ClickHouse source for the fleet');
  const staged = await browserAction(page, 'stage-release', () => page.locator('#stage-release').click());
  const retainedFile = join(work, 'retained-fleet-source.json');
  await download(page, page.getByRole('button', { name: 'Download retained fleet source', exact: true }), retainedFile);
  const retainedSource = await read(retainedFile);
  assert.deepEqual(retainedSource.clickhouseColumnTypes, preparedSource.clickhouseColumnTypes);
  assert.deepEqual(retainedSource.runtime, runtime); assert.notEqual(retainedSource.clickhousePackage, preparedSource.clickhousePackage);
  const inspected = await prepareClickHouseRelease(retainedSource.clickhousePackage, { columnTypes: retainedSource.clickhouseColumnTypes });
  assert.equal(inspected.clickhouse.executionSha256, staged.release.source.executionSha256);
  await page.screenshot({ path: join(work, 'merchant-source-desktop.png'), fullPage: true });
  const hosts = { analytics: new URL(opened.plan.publicOrigin).hostname, archive: 'clickhouse-archive.example' }, packages = {};
  for (const [tenant, alias, amount] of [['analytics', 'next', '27500'], ['archive', 'current', '15000'], ['archive', 'next', '17500']]) {
    const plan = structuredClone(opened.plan); plan.publicOrigin = 'https://' + hosts[tenant]; plan.paymentOptions[0].amount = amount;
    const planPath = join(work, tenant + '-' + alias + '-plan.json'), target = join(work, tenant + '-' + alias);
    await save(planPath, plan);
    try { await stat(target); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await prepareClickHouseSeller({ sourceFile: join(state, 'revisions', opened.id, 'source.json'), planFile: planPath, directory: target });
    }
    (packages[tenant] ??= {})[alias] = { clickhousePackage: target, clickhouseColumnTypes: retainedSource.clickhouseColumnTypes, runtime };
  }
  packages.analytics.current = { clickhousePackage: preparedSource.clickhousePackage, runtime };
  const native = { schema: 'stellar-forge.fleet-bootstrap.v1', gateway: { port: ports.ingress, adminPort: ports.admin },
    merchantPortStart: ports.merchant, slots: ['blue', 'green'], tenants: Object.keys(hosts).map(id => ({
      id, host: hosts[id], packages: packages[id], initial: { package: 'current', releaseId: 'initial' } })) };
  await save(join(work, 'source-input.json'), native);
  await page.close(); await merchantWorkspace.close(); merchantWorkspace = null;
  staticServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/fleet.html' : url.pathname));
      if (relative(dist, file).startsWith('..')) { res.writeHead(404); res.end(); return; }
      const body = await readFile(file), type = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => staticServer.listen(0, '127.0.0.1', done));
  const fleetPage = attach(await context.newPage()); await fleetPage.goto('http://127.0.0.1:' + staticServer.address().port + '/fleet.html');
  await fleetPage.locator('#fleet-file-input').setInputFiles(join(work, 'source-input.json'));
  await fleetPage.waitForFunction(() => document.querySelector('#fleet-status').textContent.startsWith('Setup opened.'));
  await fleetPage.locator('#fleet-folder').fill('clickhouse-fleet'); await fleetPage.locator('#fleet-directory').fill(directory);
  await fleetPage.locator('#fleet-mcp-directory').fill(join(work, 'merchant-mcp')); await fleetPage.locator('#fleet-workspace-port').fill('0');
  await fleetPage.locator('[data-fleet-step="1"]').click();
  const currentIndex = native.tenants[0].packages.current ? Object.keys(native.tenants[0].packages).indexOf('current') : -1;
  assert(currentIndex >= 0); const card = () => fleetPage.locator('.fleet-source-card').nth(currentIndex);
  await card().locator('input[type=file]').setInputFiles(retainedFile);
  await fleetPage.waitForFunction(() => document.querySelector('#fleet-status').textContent.startsWith('Imported ClickHouse'));
  const field = name => fleetPage.locator('[data-field="tenants.0.sources.' + currentIndex + '.' + name + '"]');
  assert.equal(await field('path').inputValue(), retainedSource.clickhousePackage); assert.equal(await field('name').inputValue(), 'current');
  await card().getByText(/Reviewed output schema/).click();
  const columns = await card().locator('tbody tr').allTextContents(); assert.equal(columns.length, 7);
  assert(columns[0].includes('record_id') && columns[0].includes('UInt64')); assert(columns[3].includes('Decimal(38, 7)'));
  await field('kind').selectOption('mysqlPackage'); assert.equal(await card().locator('table').count(), 0);
  await field('kind').selectOption('clickhousePackage'); assert.equal(await card().locator('table').count(), 0);
  await card().locator('input[type=file]').setInputFiles(retainedFile);
  await fleetPage.waitForFunction(() => document.querySelector('#fleet-status').textContent.startsWith('Imported ClickHouse'));
  await card().getByText(/Reviewed output schema/).click();
  await fleetPage.screenshot({ path: join(work, 'fleet-schema-desktop.png'), fullPage: true });
  await fleetPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await fleetPage.evaluate(() => document.documentElement.scrollWidth), 390);
  await fleetPage.screenshot({ path: join(work, 'fleet-schema-mobile.png'), fullPage: true });
  const draftPending = fleetPage.waitForEvent('download'); await fleetPage.locator('#fleet-download-draft').click();
  await (await draftPending).saveAs(join(work, 'downloaded-draft.json'));
  const draft = await read(join(work, 'downloaded-draft.json'));
  assert.deepEqual(draft.tenants[0].sources.find(row => row.name === 'current').clickhouseColumnTypes, receipt.originalReview.columnTypes);
  await fleetPage.reload(); await fleetPage.locator('#fleet-file-input').setInputFiles(join(work, 'downloaded-draft.json'));
  await fleetPage.waitForFunction(() => document.querySelector('#fleet-status').textContent.startsWith('Setup opened.'));
  await fleetPage.locator('[data-fleet-step="2"]').click(); assert.equal(await fleetPage.locator('#fleet-download-packet').isDisabled(), false);
  const zipPending = fleetPage.waitForEvent('download'); await fleetPage.locator('#fleet-download-packet').click();
  await (await zipPending).saveAs(join(work, 'clickhouse-fleet.zip'));
  assert.equal(await fleetPage.evaluate(() => document.documentElement.scrollWidth), 390);
  await fleetPage.screenshot({ path: join(work, 'fleet-launch-mobile.png'), fullPage: true });
  await browser.close(); browser = null; staticServer.closeAllConnections(); await new Promise(done => staticServer.close(done)); staticServer = null;
  await run('python3', ['-B', '-c', 'import zipfile,pathlib,sys\np=pathlib.Path(sys.argv[2]);p.mkdir(mode=0o700,exist_ok=True)\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert set(z.namelist())=={"clickhouse-fleet/"+n for n in ["fleet-setup.json","setup-input.json","commands.json","README.md"]}\n assert sum(i.file_size for i in z.infolist())<1048576\n z.extractall(p)', join(work, 'clickhouse-fleet.zip'), join(work, 'unpacked')]);
  const declaration = await read(join(work, 'unpacked/clickhouse-fleet/fleet-setup.json'));
  assert.deepEqual(declaration.tenants[0].packages.current, retainedSource);
  const imported = validateFleetDraft(importFleetDraft(JSON.stringify(declaration))); assert(imported.valid, JSON.stringify(imported.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(imported.declaration)), declaration);
  assert.deepEqual(importFleetSource(await readFile(retainedFile, 'utf8'), 'current').clickhouseColumnTypes, receipt.originalReview.columnTypes);
  receipt.inputs = { ...receipt.inputs, hosts, packages: Object.fromEntries(declaration.tenants.map(row => [row.id, row.packages])) };
  receipt.browserComplete = true; await closeHeld();
  await mark('Original prepared and retained source downloads imported into one eight-source fleet draft and native launch ZIP', {
    preparedSha256: hash(await readFile(preparedFile)), retainedSha256: hash(await readFile(retainedFile)),
    originalExecutionSha256: inspected.clickhouse.executionSha256, orderedColumns: columns.length, schemaPreserved: true,
    responsiveWidth: 390, browserErrors: receipt.browserErrors, zipSha256: hash(await readFile(join(work, 'clickhouse-fleet.zip'))) });
}

let verifies = 0, settles = 0, holdVerification = false, heldArrived, releaseVerification;
const bearer = randomBytes(32).toString('base64url'); let rpcId = 0;
async function wire(name, args = {}) {
  const response = await fetch(mcp.url, { method: 'POST', headers: { authorization: 'Bearer ' + bearer, accept: 'application/json, text/event-stream',
    'content-type': 'application/json', 'mcp-protocol-version': MCP_VERSION }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200); const result = await response.json(); assert(result.result, JSON.stringify(result)); return result.result;
}
async function call(name, args) { const result = await wire(name, args); assert.equal(result.isError, false, JSON.stringify(result)); return result.structuredContent; }
async function startMcp() {
  mcp = await startMerchantMcp({ configPath: receipt.mcpConfiguration, port: 0, environment: { ...process.env, MCP_ACCESS_TOKEN: bearer } });
  const plan = await call('merchant_fleet_plan'); assert.equal(plan.digest, receipt.planDigest);
  assert(plan.tenants.every(tenant => tenant.packageSources.every(source => source.kind === 'CLICKHOUSE_MERCHANT_PACKAGE')));
  return call('merchant_fleet_start', { expectedPlanDigest: plan.digest });
}
const queryInput = { account: 'merchant-demo', after_ledger: '0', after_record_id: '0', minimum_amount: '0' };
function exchange(tenant, headers = {}) {
  const body = Buffer.from(JSON.stringify(queryInput)), { ports, hosts } = receipt.inputs;
  return new Promise((done, fail) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: ports.ingress, method: 'POST', path: '/transfers',
      headers: { host: hosts[tenant], 'content-type': 'application/json', 'content-length': body.length, ...headers } }, response => {
      const chunks = []; response.on('data', value => chunks.push(value)); response.on('error', fail);
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', fail); request.setTimeout(30000, () => request.destroy(Error('Fleet delivery timeout'))); request.end(body);
  });
}
async function buy(tenant, amount, label) {
  const unpaid = await exchange(tenant); assert.equal(unpaid.status, 402, unpaid.body.toString());
  const required = JSON.parse(Buffer.from(unpaid.headers['payment-required'], 'base64')); assert.equal(required.accepts[0].amount, amount);
  assert.equal(required.accepts[1].amount, '9007199254740993');
  const paid = await exchange(tenant, { 'payment-signature': encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource,
    accepted: required.accepts[0], extensions: required.extensions, payload: { nativeFleetJourney: 'LOCAL_FACILITATOR_FIXTURE' } }) });
  assert.equal(paid.status, 200, paid.body.toString()); assert(paid.headers['payment-response']);
  const value = JSON.parse(paid.body); assert.equal(value.rows[0].record_id, '18446744073709551615');
  assert.equal(value.rows[0].ledger, '9007199254740993'); assert.equal(value.rows[0].amount, '123456789012345678901234567890.1234567');
  assert.equal(value.rows[0].memo, null); assert.equal(value.rows[1].memo, '\\N');
  receipt.deliveries.push({ tenant, label, amount, options: required.accepts, httpStatus: paid.status, bytes: paid.body.length, sha256: hash(paid.body),
    paymentFixture: 'original installed x402 SDK with a local controlled facilitator' });
  await writeFile(join(work, label + '-response.json'), paid.body, { mode: 0o600 }); await save(join(work, 'receipt.json'), receipt); return value;
}
async function nativePhase() {
  assert(receipt.browserComplete); assert(nativeRoot, 'Use the original admitted ClickHouse binary directory');
  const inheritedFd = process.env.CLICKHOUSE_BINARY_FD === undefined ? null : Number(process.env.CLICKHOUSE_BINARY_FD);
  if (inheritedFd !== null) assert(Number.isSafeInteger(inheritedFd) && inheritedFd >= 3, 'Original sealed ClickHouse descriptor');
  const executable = inheritedFd === null ? join(nativeRoot, 'clickhouse') : '/proc/self/fd/3';
  const binaryInfo = await stat(inheritedFd === null ? executable : '/proc/self/fd/' + inheritedFd);
  assert.equal(binaryInfo.size, 799107680, 'Original pinned ClickHouse executable size');
  const { ports } = receipt.inputs, serverRoot = join(work, 'database-' + randomUUID()); await mkdir(serverRoot, { mode: 0o700 });
  const password = randomUUID(), endpoint = 'http://127.0.0.1:' + ports.database + '/';
  const config = '<clickhouse><logger><level>warning</level><console>true</console><log>' + serverRoot + '/native.log</log><errorlog>' + serverRoot + '/native-error.log</errorlog><size>2M</size><count>1</count></logger>' +
    '<listen_host>127.0.0.1</listen_host><http_port>' + ports.database + '</http_port><path>' + serverRoot + '/data/</path><tmp_path>' + serverRoot + '/tmp/</tmp_path><access_control_path>' + serverRoot + '/access/</access_control_path>' +
    '<max_thread_pool_size>256</max_thread_pool_size><background_pool_size>2</background_pool_size><background_schedule_pool_size>2</background_schedule_pool_size><background_buffer_flush_schedule_pool_size>1</background_buffer_flush_schedule_pool_size>' +
    '<background_message_broker_schedule_pool_size>1</background_message_broker_schedule_pool_size><background_distributed_schedule_pool_size>1</background_distributed_schedule_pool_size><background_move_pool_size>1</background_move_pool_size><background_fetches_pool_size>1</background_fetches_pool_size><background_common_pool_size>2</background_common_pool_size>' +
    '<mark_cache_size>16777216</mark_cache_size><uncompressed_cache_size>0</uncompressed_cache_size><merge_tree><number_of_free_entries_in_pool_to_lower_max_size_of_merge>0</number_of_free_entries_in_pool_to_lower_max_size_of_merge><number_of_free_entries_in_pool_to_execute_mutation>0</number_of_free_entries_in_pool_to_execute_mutation><number_of_free_entries_in_pool_to_execute_optimize_entire_partition>0</number_of_free_entries_in_pool_to_execute_optimize_entire_partition></merge_tree>' +
    '<users><default><password>' + password + '</password><networks><ip>127.0.0.1</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></default></users><profiles><default><max_memory_usage>268435456</max_memory_usage><max_threads>2</max_threads></default></profiles><quotas><default/></quotas></clickhouse>';
  await writeFile(join(serverRoot, 'server.xml'), config, { mode: 0o600 });
  database = spawn(executable, ['server', '--config-file', join(serverRoot, 'server.xml')], { env: { ...process.env, CLICKHOUSE_WATCHDOG_ENABLE: '0' },
    stdio: inheritedFd === null ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'ignore', 'pipe', inheritedFd] });
  let nativeError = ''; database.stderr.on('data', data => { nativeError = (nativeError + data).slice(-16000); });
  databaseClosed = new Promise(done => { database.once('error', error => { nativeError = error.message; done(); }); database.once('close', (code, signal) => { receipt.databaseExit = { code, signal }; done(); }); });
  const admin = async sql => {
    const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'x-clickhouse-user': 'default', 'x-clickhouse-key': password }, body: sql });
    const text = await response.text(); assert(response.ok, text); return text;
  };
  let ready = false;
  for (let n = 0; n < 160; n++) {
    if (database.exitCode !== null) throw Error(nativeError);
    try { if ((await fetch(endpoint + 'ping', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, nativeError);
  receipt.databaseVersion = (await admin('SELECT version()')).trim();
  for (const sql of (await readFile(join(ch, 'examples/seed.sql'), 'utf8')).split(';').map(value => value.trim()).filter(Boolean)) await admin(sql);
  await admin("CREATE USER merchant IDENTIFIED BY '" + password + "'"); await admin('GRANT SELECT ON starforge_example.transfers TO merchant');
  process.env.CLICKHOUSE_MERCHANT_URL = endpoint; process.env.CLICKHOUSE_MERCHANT_USER = 'merchant'; process.env.CLICKHOUSE_MERCHANT_PASSWORD = password;
  facilitator = createServer(async (request, response) => {
    for await (const data of request) { void data; }
    if (request.url === '/verify' && holdVerification) { holdVerification = false; heldArrived(); await new Promise(done => { releaseVerification = done; }); }
    const value = request.url === '/supported' ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }
      : request.url === '/verify' ? (verifies++, { isValid: true, payer: 'LOCAL_NATIVE_CLICKHOUSE_FIXTURE' })
      : request.url === '/settle' ? { success: true, network: 'stellar:testnet', transaction: hash('LOCAL_NATIVE_CLICKHOUSE_FIXTURE_' + (++settles)), payer: 'LOCAL_NATIVE_CLICKHOUSE_FIXTURE' } : null;
    response.writeHead(value ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
  });
  await new Promise(done => facilitator.listen(ports.facilitator, '127.0.0.1', done));
  if (!receipt.bootstrapComplete) {
    const setup = await command('setup'), plan = await readFleetReleasePlan(planFile); assert.equal(setup.planDigest, plan.digest); receipt.planDigest = plan.digest;
    receipt.initialDigests = {};
    for (const tenant of plan.tenants) for (const [slot, value] of Object.entries(tenant.slots)) {
      const saved = await readReleaseState(value.store); assert.equal(saved.generation, slot === 'blue' ? 1 : 0); assert.equal((await stat(value.store)).mode & 0o777, 0o700);
      if (slot === 'blue') { const release = await inspectRelease(value.store, 'initial'); assert.deepEqual(release.clickhouse.columnTypes, receipt.originalReview.columnTypes); receipt.initialDigests[tenant.id] = release.digest; }
    }
    receipt.bootstrapComplete = true;
    await mark('Unchanged browser ZIP created four original private stores with every reviewed ClickHouse type retained', { planDigest: plan.digest, initialDigests: receipt.initialDigests, version: receipt.databaseVersion });
  }
  if (!receipt.fleetBrowserComplete) {
    fleetWorkspace = await startFleetWorkspace({ releasePlan: planFile, releaseDirectory: directory, port: 0 });
    await buy('analytics', '25000', 'initial-analytics'); await buy('archive', '15000', 'initial-archive');
    browser = await chromium.launch(browserOptions); const context = await browser.newContext({ viewport: { width: 1280, height: 960 } }), page = attach(await context.newPage());
    await page.goto(fleetWorkspace.url); await page.waitForFunction(() => document.querySelector('#release-link')?.textContent === 'Managed releases linked');
    await page.locator('#release-tenant').selectOption('analytics'); assert.match(await page.locator('#release-package').textContent(), /ClickHouse/);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.screenshot({ path: join(work, 'managed-clickhouse-mobile.png'), fullPage: true });
    await browser.close(); browser = null; await fleetWorkspace.close(); fleetWorkspace = null; receipt.fleetBrowserComplete = true;
    await mark('The original managed fleet served exact ClickHouse values through its installed SDK and retained browser controls', { browserErrors: receipt.browserErrors, width: 390 });
  }
  if (!receipt.mcpConfiguration) { const initialized = await command('mcp-init'); await command('mcp-host'); receipt.mcpConfiguration = initialized.configuration; await save(join(work, 'receipt.json'), receipt); }
  if (!receipt.lifecycleComplete) {
    await startMcp();
    const staged = await call('merchant_fleet_stage', { tenant: 'analytics', slot: 'green', package: 'next', releaseId: 'next' });
    assert.equal(staged.release.sourceKind, 'CLICKHOUSE_MERCHANT_PACKAGE');
    const next = await inspectRelease(join(directory, 'stores/analytics/green'), 'next'); assert.deepEqual(next.clickhouse.columnTypes, receipt.originalReview.columnTypes);
    const reviewed = await call('merchant_fleet_review', { tenant: 'analytics', slot: 'green', releaseId: 'next' });
    assert(reviewed.comparison.summary.paymentChanged > 0); const prepared = await call('merchant_fleet_prepare', { reviewId: reviewed.reviewId });
    const arrived = new Promise(done => { heldArrived = done; }); holdVerification = true;
    const draining = buy('analytics', '25000', 'inflight-original-analytics');
    draining.catch(() => {}); // Keep an early delivery error for the awaited result and owned cleanup.
    await Promise.race([arrived, wait(10000).then(() => { throw Error('Original in-flight request did not reach facilitator'); })]);
    await call('merchant_fleet_activate', { candidateId: prepared.candidateId, expectedRevision: prepared.expectedRevision });
    const status = (await call('merchant_fleet_status')).fleet, old = status.tenants.find(row => row.id === 'analytics').slots.find(row => row.name === 'blue');
    const retirement = { tenant: 'analytics', slot: 'blue', instanceId: old.instanceId, expectedRevision: status.native.revision };
    const held = await wire('merchant_fleet_retire', retirement); assert.equal(held.isError, true, JSON.stringify(held));
    releaseVerification(); releaseVerification = null; await draining;
    await call('merchant_fleet_retire', retirement); await buy('analytics', '27500', 'next-analytics');
    const rollback = await call('merchant_fleet_rollback_review', { targetRevision: 1 }); await call('merchant_fleet_rollback', { reviewId: rollback.reviewId });
    await buy('analytics', '25000', 'rollback-analytics'); await mcp.close(); mcp = null;
    receipt.lifecycleComplete = true;
    await mark('Original same-directory MCP staged the complete reviewed source, compared prices, drained before retirement and rolled back', { prices: ['25000', '27500', '25000'], retirementWaitedForRequest: true, nativeSourceKind: staged.release.sourceKind, comparison: reviewed.comparison.summary });
  }
  if (!receipt.sourcesMoved) {
    const paths = new Set(Object.values(receipt.inputs.packages).flatMap(packages => Object.values(packages).map(source => source.clickhousePackage)));
    for (const path of paths) await rename(path, path + '-moved'); receipt.sourcesMoved = true; await save(join(work, 'receipt.json'), receipt);
  }
  const resumed = await command('setup'); assert.equal(resumed.planDigest, receipt.planDigest);
  const reopened = await startMcp(); assert.equal(reopened.fleet.native.revision, 3);
  await buy('analytics', '25000', 'relocated-reopened-analytics');
  for (const tenant of ['analytics', 'archive']) assert.equal((await inspectRelease(join(directory, 'stores', tenant, 'blue'), 'initial')).digest, receipt.initialDigests[tenant]);
  await mcp.close(); mcp = null; receipt.complete = true;
  await mark('Source relocation and original setup/MCP reopen preserved the retained selection and live ClickHouse delivery', { revision: reopened.fleet.native.revision, planDigest: receipt.planDigest, verifies, settles });
}

try {
  if (mode !== 'native') await browserPhase();
  await closeHeld(); if (mode !== 'browser') await nativePhase();
  assert.deepEqual(receipt.browserErrors, []); delete receipt.error;
} catch (error) { receipt.error = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack); }
finally {
  releaseVerification?.(); await browser?.close().catch(() => {}); await merchantWorkspace?.close().catch(() => {});
  await fleetWorkspace?.close().catch(() => {}); await mcp?.close().catch(() => {}); await closeHeld();
  if (staticServer) { staticServer.closeAllConnections(); await new Promise(done => staticServer.close(done)); }
  if (database && database.exitCode === null) database.kill('SIGTERM');
  if (databaseClosed) { let timer; await Promise.race([databaseClosed, new Promise(done => { timer = setTimeout(() => { database.kill('SIGKILL'); done(); }, 10000); })]); clearTimeout(timer); await databaseClosed; }
  if (facilitator) { facilitator.closeAllConnections(); await new Promise(done => facilitator.close(done)); }
  const paths = ['stellar-forge/developer-site/dist/fleet-onboarding.mjs', 'stellar-forge/developer-site/dist/fleet-setup.mjs',
    'stellar-forge/mcp-merchant-operator/config.mjs', 'stellar-forge/mcp-merchant-operator/fleet.mjs', 'stellar-forge/mcp-merchant-operator/operator.mjs', 'stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs', 'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/browser.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-bootstrap.mjs', 'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs',
    'stellar/scf-starforge-20261009/sf82-seller-pilot/release-clickhouse.mjs', 'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/model.mjs', 'stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/server.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/public/app.mjs'];
  for (const path of paths) receipt.sourceHashes[path] = hash(await readFile(join(repo, path)));
  receipt.ownedProcessesClosed = true; receipt.finishedAt = new Date().toISOString();
  await save(join(work, 'receipt.json'), receipt);
  console.log(JSON.stringify({ work, mode, browserComplete: receipt.browserComplete ?? false, complete: receipt.complete, ownedProcessesClosed: true }));
}
