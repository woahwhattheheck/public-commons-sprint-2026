// MIT. Original retained fleet → customer SDK browser, terminal and MCP journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, chmod, stat, open, rename, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.FLEET_CLIENT_SOURCE ?? join(here, '../..'));
const base = resolve(process.env.FLEET_CLIENT_OUTPUT ?? join(here, 'run-native'));
const sdk = join(repo, 'stellar/scf-starforge-20261009'), fleet = join(sdk, 'merchant-fleet-gateway');
const { bootstrapFleet } = await import(join(fleet, 'release-bootstrap.mjs'));
const { openFleetReleaseOperator } = await import(join(fleet, 'release-operator.mjs'));
const { dispatchFleetCommand } = await import(join(fleet, 'release-cli.mjs'));
const { startFleetWorkspace } = await import(join(fleet, 'workspace/server.mjs'));
const { main: mcpMain, startMerchantMcp } = await import(join(repo, 'stellar-forge/mcp-merchant-operator/serve.mjs'));
const { preparePackage } = await import(join(sdk, 'sf30-seller-sdk/jsonrpc/cli.mjs'));
const { validatePlan: validateRpcPlan } = await import(join(sdk, 'sf30-seller-sdk/jsonrpc/config.mjs'));
const { CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST } = await import(join(sdk, 'sf30-seller-sdk/developer/client-export.mjs'));
const require = createRequire(join(resolve(process.env.FLEET_CLIENT_NODE_MODULES ??
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? join(repo, 'node_modules')), 'runtime-loader.cjs'));
const { chromium } = require('playwright');
const { StrKey } = createRequire(join(repo, 'package.json'))('@stellar/stellar-sdk');
const pythonExecutable = process.env.FLEET_CLIENT_PYTHON ?? process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3';
const run = promisify(execFile), sha = value => createHash('sha256').update(value).digest('hex');
await mkdir(base, { recursive: true, mode: 0o700 }); await chmod(base, 0o700);
const receiptFile = join(base, 'receipt.json');
let receipt;
try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  receipt = { schema: 'scratch.fleet-customer-handover.v1', state: 'RUNNING', base,
    source: repo, milestones: [], providerReads: [], browserErrors: [], exports: {} };
}
const alreadyAccepted = receipt.state === 'PASS';
async function save(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'; let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync();
    await handle.close(); handle = null; await rename(temporary, file);
    const folder = await open(dirname(file), 'r'); try { await folder.sync(); } finally { await folder.close(); }
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function record(name, values = {}) {
  receipt.milestones.push({ name, at: new Date().toISOString(), ...values });
  await save(receiptFile, receipt); console.log(JSON.stringify({ phase: name, ...values }));
}
const waitFor = async (work, note) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await work()) return; await new Promise(done => setTimeout(done, 80)); }
  throw new Error(note);
};
const listen = server => new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const closeServer = server => new Promise(done => {
  if (!server?.listening) return done(); server.close(done); server.closeIdleConnections();
});
async function ports() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const start = 21000 + Math.floor(Math.random() * 28000), reservations = [];
    try {
      for (let n = 0; n < 6; n++) {
        const server = createServer(); reservations.push(server);
        await new Promise((done, fail) => { server.once('error', fail); server.listen(start + n, '127.0.0.1', done); });
      }
      return start;
    } catch {} finally { await Promise.all(reservations.map(closeServer)); }
  }
  throw new Error('No six-port block available for the original fleet');
}
let workspace, browser, cli, mcp, sessionKey, rpcId = 0, closing = false;
const bearer = randomBytes(32).toString('hex'), directory = join(base, 'fleet');
const provider = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) body += part;
    const request = JSON.parse(body); receipt.providerReads.push(request.method);
    assert.equal(request.method, 'getNetwork'); assert.equal(request.id, 'sf30:getNetwork'); assert.equal(req.url, '/rpc');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      result: { passphrase: 'Test SDF Network ; September 2015', protocolVersion: 27 } }));
  } catch { res.writeHead(500); res.end(); }
});
async function workspaceCall(path, payload, expected = 200) {
  const response = await fetch(workspace.url + '/api/' + path, {
    method: payload === undefined ? 'GET' : 'POST', headers: { 'x-fleet-workspace': sessionKey,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(45000),
  });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const slot = (status, tenant = 'rpc', name = 'blue') =>
  (status.releaseStatus ?? status).tenants.find(row => row.id === tenant).slots.find(row => row.name === name);
const query = input => new URLSearchParams(input).toString();
const amount = (review, id) => review.snapshot.operations.find(row => row.id === id).offer.accepts[0].amount;
function exportIdentity(review) {
  return { tenant: review.tenant, slot: review.slot, exportId: review.exportId, mode: review.mode,
    filesSha256: review.filesSha256, manifestSha256: review.manifestFile.sha256,
    provenance: review.manifest.provenance, files: review.files.map(file => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })) };
}
async function wire(method, params) {
  const response = await fetch(mcp.url, { method: 'POST', headers: { authorization: 'Bearer ' + bearer,
    'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.error, undefined); return value.result;
}
async function call(name, args = {}, expectedError = false) {
  const result = await wire('tools/call', { name, arguments: args });
  assert.equal(Boolean(result.isError), expectedError, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}
async function openMcp() {
  mcp = await startMerchantMcp({ configPath: receipt.mcpConfiguration, port: 0, environment: { ...process.env, MCP_ACCESS_TOKEN: bearer } });
  await wire('initialize', {}); const plan = await call('merchant_fleet_plan');
  return call('merchant_fleet_start', { expectedPlanDigest: plan.digest });
}
async function absent(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(700) }); return false; } catch { return true; }
}
async function verifyDownload(destination, manifest) {
  for (const file of [...manifest.manifest.files, manifest.manifestFile]) {
    const bytes = await readFile(join(destination, file.name));
    assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
  }
}
async function browserPhase() {
  workspace = await startFleetWorkspace({ releasePlan: receipt.planFile, releaseDirectory: directory, port: 0 });
  sessionKey = (await (await fetch(workspace.url + '/api/session')).json()).session;
  let status = await workspaceCall('status');
  browser = await chromium.launch({
    ...(process.env.FLEET_CLIENT_CHROMIUM ? { executablePath: process.env.FLEET_CLIENT_CHROMIUM } : {}),
    headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--renderer-process-limit=1'],
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1024 }, acceptDownloads: true });
  page.on('pageerror', error => receipt.browserErrors.push(error.message)); page.setDefaultTimeout(30000);
  await page.goto(workspace.url); await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Connected');
  const idle = () => page.waitForFunction(() => !document.querySelector('#client-refresh').disabled);
  await idle();
  async function select(tenant, name) {
    const row = page.locator('#release-processes tbody tr').filter({ hasText: tenant === 'rpc' ? 'rpc-' : 'python-' }).filter({ hasText: name });
    await row.getByRole('button', { name: 'Customer SDKs', exact: true }).click(); await idle();
    assert.equal(await page.locator('#client-tenant').inputValue(), tenant);
    assert.equal(await page.locator('#client-slot').inputValue(), name);
  }
  async function inspect(id) {
    await page.locator('#client-export-id').fill(id);
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/releases/clients/inspect');
    await page.locator('#client-inspect').click(); const response = await pending;
    const result = await response.json(); assert.equal(response.status(), 200, JSON.stringify(result)); await idle(); return result;
  }
  async function ensureExport(tenant, name, id) {
    await select(tenant, name);
    let review = await inspect(id);
    if (review.state === 'NOT_FOUND') {
      const current = slot(await workspaceCall('status'), tenant, name);
      const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/releases/clients/generate');
      await page.locator('#client-generate').click(); const response = await pending; review = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(review));
      assert.equal(review.manifest.provenance.instanceId, current.instanceId);
      await idle();
    }
    assert.equal(review.state, 'COMPLETE'); assert.equal(review.tenant, tenant); assert.equal(review.slot, name);
    receipt.exports[tenant + '/' + name + '/' + id] = exportIdentity(review);
    return review;
  }
  const blue = await ensureExport('rpc', 'blue', 'shared-customer');
  assert.equal(amount(blue, 'getTransaction'), '19000');
  const python = await ensureExport('python', 'blue', 'shared-customer');
  assert.equal(amount(python, 'summarize'), '20000');
  assert.notEqual(blue.manifestFile.sha256, python.manifestFile.sha256);
  assert.equal(JSON.stringify(blue).includes(base), false);
  await select('rpc', 'blue'); await inspect('shared-customer');
  const firstFile = blue.files.find(row => row.name === 'seller-client.mjs');
  const download = page.waitForEvent('download'); await page.locator('[data-client-file="seller-client.mjs"]').click();
  const downloaded = await download, filePath = join(base, 'browser-seller-client.mjs'); await downloaded.saveAs(filePath);
  assert.equal(sha(await readFile(filePath)), firstFile.sha256);
  const packageDownload = page.waitForEvent('download'); await page.locator('#client-package').click();
  const archive = await packageDownload, archivePath = join(base, 'browser-client.tar.gz'); await archive.saveAs(archivePath);
  const unpacked = join(base, 'archive-review'); await mkdir(unpacked, { recursive: true, mode: 0o700 });
  await run(pythonExecutable, ['-B', '-c',
    'import tarfile,sys,pathlib\np=pathlib.Path(sys.argv[2])\nwith tarfile.open(sys.argv[1]) as t:\n m=t.getmembers();assert len(m)==6 and all(x.isfile() and x.name.startswith("shared-customer/") and ".." not in pathlib.PurePosixPath(x.name).parts for x in m)\n t.extractall(p,filter="data")',
    archivePath, unpacked]);
  const blueManifest = await workspaceCall('releases/clients/inspect?' + query({ tenant: 'rpc', slot: 'blue', exportId: 'shared-customer' }));
  await verifyDownload(join(unpacked, 'shared-customer'), { manifest: blueManifest.manifest, manifestFile: blueManifest.manifestFile });
  // Throttle this real browser response to exercise original cancel-and-await on scope change.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 256, uploadThroughput: 1048576 });
  await page.locator('[data-client-file="seller-client.mjs"]').click();
  await page.waitForFunction(() => !document.querySelector('#client-download-stop').hidden);
  await page.locator('#client-tenant').selectOption('python');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await idle(); assert.equal(await page.locator('#client-tenant').inputValue(), 'python');
  assert.equal(await page.locator('#client-export-id').inputValue(), 'shared-customer');
  assert.equal(await page.locator('#client-review').isHidden(), true);
  await cdp.detach();
  await record('Original browser generated scoped RPC and Python SDKs, verified complete archive bytes and cancelled a real transfer before switching merchants',
    { rpcAmount: amount(blue, 'getTransaction'), pythonAmount: amount(python, 'summarize'),
      payloads: CLIENT_EXPORT_FILES.length, sameIdIsolated: true, browserFileSha256: firstFile.sha256 });
  status = await workspaceCall('status');
  if (status.status.revision === 1) {
    await workspaceCall('releases/stage', { tenant: 'rpc', slot: 'green', package: 'next', releaseId: 'rpc-v2' });
    const review = (await workspaceCall('releases/review', { tenant: 'rpc', slot: 'green', releaseId: 'rpc-v2' })).result;
    const prepared = (await workspaceCall('releases/prepare', { reviewId: review.reviewId })).result;
    await workspaceCall('activate', { candidateId: prepared.candidateId, expectedRevision: prepared.expectedRevision });
    status = await workspaceCall('status');
  }
  assert.equal(status.status.revision, 2);
  await page.locator('#refresh').click(); await idle();
  const green = await ensureExport('rpc', 'green', 'shared-customer');
  assert.equal(amount(green, 'getTransaction'), '23000');
  const prior = slot(await workspaceCall('status'), 'rpc', 'blue');
  if (prior.owned) await workspaceCall('releases/retire', { tenant: 'rpc', slot: 'blue', instanceId: prior.instanceId, expectedRevision: 2 });
  await page.locator('#refresh').click(); await idle(); await select('rpc', 'blue'); await inspect('shared-customer');
  assert.equal(await page.locator('#client-generate').isDisabled(), true);
  assert.equal(await page.locator('#client-package').isEnabled(), true);
  const retained = await workspaceCall('releases/clients/inspect?' + query({ tenant: 'rpc', slot: 'blue', exportId: 'shared-customer' }));
  assert.equal(retained.manifestFile.sha256, blue.manifestFile.sha256);
  const legacy = join(directory, 'clients/rpc/blue/legacy-customer');
  await mkdir(legacy, { recursive: true, mode: 0o700 });
  for (const name of CLIENT_EXPORT_FILES) {
    const original = await readFile(join(directory, 'clients/rpc/blue/shared-customer', name)), destination = join(legacy, name);
    try { assert.equal(sha(await readFile(destination)), sha(original)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(destination, original, { mode: 0o600 }); }
  }
  let legacyReview = await inspect('legacy-customer');
  if (legacyReview.state === 'LEGACY_FILES_RETAINED') {
    const before = legacyReview.filesSha256, pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/releases/clients/adopt');
    await page.locator('#client-adopt').click(); const response = await pending; legacyReview = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(legacyReview)); await idle(); assert.equal(legacyReview.filesSha256, before);
  }
  assert.equal(legacyReview.state, 'COMPLETE');
  await page.screenshot({ path: join(base, 'fleet-customer-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: join(base, 'fleet-customer-mobile.png'), fullPage: true });
  await record('Replacement terms remain isolated by slot; retired original SDKs and inspected legacy payloads remain deliverable through the existing browser',
    { prices: ['19000', '23000'], retainedManifestSha256: blue.manifestFile.sha256,
      legacyFilesSha256: legacyReview.filesSha256, width: 390 });
  await browser.close(); browser = null; const url = workspace.url; await workspace.close(); workspace = null;
  await waitFor(() => absent(url), 'Fleet customer workspace listener stayed open');
  receipt.browserComplete = true; await save(receiptFile, receipt);
}
async function terminalPhase() {
  cli = await openFleetReleaseOperator({ planFile: receipt.planFile, directory });
  const listing = await dispatchFleetCommand(cli, 'client-list rpc blue');
  assert(listing.entries.some(row => row.exportId === 'shared-customer'));
  assert.equal((await dispatchFleetCommand(cli, 'status')).native.revision, 2);
  const manifest = await dispatchFleetCommand(cli, 'client-manifest rpc blue shared-customer');
  assert.equal(manifest.manifestFile.sha256, receipt.exports['rpc/blue/shared-customer'].manifestSha256);
  const destination = join(base, 'Client  A');
  if (!receipt.downloadInterrupted) {
    const controller = new AbortController();
    let progress = 0;
    try {
      await cli.downloadClient({ tenant: 'rpc', slot: 'blue', exportId: 'shared-customer',
        expectedManifestSha256: manifest.manifestFile.sha256, directory: destination, signal: controller.signal,
        onProgress: async value => {
          progress += value.bytes; receipt.downloadInterrupted = true;
          await save(receiptFile, receipt);
          controller.abort(new Error('Pause after an original durable file checkpoint'));
        } });
      assert.fail('The deliberate first-download interruption did not occur');
    } catch (error) { assert(controller.signal.aborted, error.message); }
    assert(progress > 0);
  }
  const downloaded = await dispatchFleetCommand(cli, 'client-download rpc blue shared-customer ' +
    manifest.manifestFile.sha256 + ' ' + JSON.stringify(destination));
  assert.equal(downloaded.state, 'COMPLETE'); assert.equal(downloaded.directory, destination);
  assert.equal(downloaded.resumed, true); assert(downloaded.resumedBytes > 0);
  await verifyDownload(destination, manifest);
  await assert.rejects(() => dispatchFleetCommand(cli, 'client-download python blue shared-customer ' +
    manifest.manifestFile.sha256 + ' ' + JSON.stringify(destination)));
  const single = await cli.clientList({ tenant: 'rpc', slot: 'blue', limit: 1 });
  assert(single.nextAfter); const next = await dispatchFleetCommand(cli, 'client-list rpc blue ' + single.nextAfter + ' 1');
  assert.equal(next.entries.length, 1); assert.notEqual(next.entries[0].exportId, single.entries[0].exportId);
  await cli.close(); cli = null; receipt.terminalComplete = true;
  await record('Original terminal retained-reader resumed a cancelled download into an exact double-space directory and recovered all six original files',
    { destination, resumedBytes: downloaded.resumedBytes, files: downloaded.files,
      manifestSha256: manifest.manifestFile.sha256, paginatedScope: true });
}
async function mcpPhase() {
  if (!receipt.mcpConfiguration) {
    const initialized = await mcpMain(['init-fleet', '--dir', join(base, 'merchant-mcp'), '--plan', receipt.planFile, '--fleet-directory', directory]);
    receipt.mcpConfiguration = initialized.configuration; await save(receiptFile, receipt);
  }
  let running = await openMcp();
  const definitions = (await wire('tools/list', {})).tools.filter(tool => tool.name.startsWith('merchant_fleet_client_'));
  assert.equal(definitions.length, 7);
  const scope = { tenant: 'rpc', slot: 'blue', exportId: 'shared-customer' };
  const original = await call('merchant_fleet_client_status', scope), manifest = await call('merchant_fleet_client_manifest', scope);
  assert.equal(manifest.manifestFile.sha256, receipt.exports['rpc/blue/shared-customer'].manifestSha256);
  assert.equal(amount(original, 'getTransaction'), '19000');
  const file = manifest.manifest.files.find(row => row.name === 'seller-client.mjs'), chunks = [];
  let offset = 0, readId;
  do {
    const value = await call('merchant_fleet_client_file', { ...scope, file: file.name, expectedManifestSha256: manifest.manifestFile.sha256,
      expectedSha256: file.sha256, offset, limit: 4096, ...(readId ? { readId } : {}) });
    const bytes = Buffer.from(value.data, 'base64'); assert.equal(value.offset, offset); assert.equal(value.bytesRead, bytes.length);
    chunks.push(bytes); offset += bytes.length; readId = value.readId;
    if (value.nextOffset === null) break;
  } while (offset < file.bytes);
  assert.equal(offset, file.bytes); assert.equal(sha(Buffer.concat(chunks)), file.sha256);
  await call('merchant_fleet_client_file_release', { ...scope, readId });
  await call('merchant_fleet_client_file', { tenant: 'python', slot: 'blue', exportId: scope.exportId,
    file: file.name, expectedManifestSha256: manifest.manifestFile.sha256, expectedSha256: file.sha256 }, true);
  const green = running.fleet.tenants.find(row => row.id === 'rpc').slots.find(row => row.name === 'green');
  let generated = await call('merchant_fleet_client_status', { tenant: 'rpc', slot: 'green', exportId: 'mcp-customer' });
  if (generated.state === 'NOT_FOUND') generated = await call('merchant_fleet_client_generate',
    { tenant: 'rpc', slot: 'green', id: 'mcp-customer', instanceId: green.instanceId });
  assert.equal(generated.state, 'COMPLETE'); assert.equal(amount(generated, 'getTransaction'), '23000');
  const started = await call('merchant_fleet_client_file', { ...scope, file: file.name, expectedManifestSha256: manifest.manifestFile.sha256,
    expectedSha256: file.sha256, offset: 0, limit: 1 });
  const oldURL = mcp.url, before = Date.now(); await mcp.close(); mcp = null;
  assert(Date.now() - before < 20000); await waitFor(() => absent(oldURL), 'MCP customer endpoint stayed open');
  running = await openMcp(); assert.equal(running.fleet.native.revision, 2);
  await call('merchant_fleet_client_file', { ...scope, file: file.name, expectedManifestSha256: manifest.manifestFile.sha256,
    expectedSha256: file.sha256, offset: 1, limit: 1, readId: started.readId }, true);
  const restored = await call('merchant_fleet_client_status', scope);
  assert.equal(restored.manifestFile.sha256, manifest.manifestFile.sha256);
  await call('merchant_fleet_stop', { managerId: running.managerId });
  await mcp.close(); mcp = null; receipt.mcpComplete = true;
  await record('Actual authenticated MCP exposed seven scoped customer tools, generated current terms, read exact original chunks and reopened retained exports after closing native snapshots',
    { tools: definitions.map(tool => tool.name), readBytes: offset, sourceSha256: file.sha256,
      previousManifestRetained: manifest.manifestFile.sha256, newAmount: amount(generated, 'getTransaction') });
}

async function cleanup() {
  if (closing) return; closing = true; const errors = [];
  for (const owner of [browser, workspace, cli, mcp]) try { await owner?.close(); } catch (error) { errors.push(error.message); }
  await closeServer(provider); receipt.cleanupErrors = errors; receipt.ownedProcessesClosed = !errors.length;
  const paths = [
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-clients.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-cli.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/browser.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/clients.mjs',
    'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/style.css',
    'stellar-forge/mcp-merchant-operator/fleet.mjs', 'stellar-forge/mcp-merchant-operator/operator.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    'stellar/scf-starforge-20261009/sf82-seller-pilot/release-client.mjs',
    'stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/client.mjs',
  ];
  receipt.sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(join(repo, path)))])));
  receipt.finishedAt = new Date().toISOString(); await save(receiptFile, receipt);
}
if (!alreadyAccepted) {
try {
  await listen(provider);
  const input = join(base, 'rpc-current'), next = join(base, 'rpc-next'), python = join(base, 'python-current');
  if (!receipt.planFile) {
    // Reuse the public original examples. All addresses are public fixture bytes;
    // this journey exercises original challenge-mode merchant metadata and SDKs.
    const planSource = await readFile(join(sdk, 'sf30-seller-sdk/jsonrpc/example-plan.json'));
    const pythonSource = await readFile(join(sdk, 'sf30-seller-sdk/python/example-merchant.json'));
    const applicationSource = await readFile(join(sdk, 'sf30-seller-sdk/python/example-application.py'));
    const payment = { network: 'stellar:testnet', asset: StrKey.encodeContract(Buffer.alloc(32, 7)),
      payTo: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8)), maxTimeoutSeconds: 60 };
    const plan = validateRpcPlan({ ...JSON.parse(planSource), publicOrigin: 'https://rpc.fleet.example',
      endpointEnv: 'FLEET_CLIENT_RPC_URL', payment,
      operations: [{ method: 'getTransaction', amountAtomic: '19000' }] });
    const pythonDeclaration = { ...JSON.parse(pythonSource), publicOrigin: 'https://python.fleet.example',
      python: pythonExecutable, workerCount: 1 };
    for (const spec of Object.values(pythonDeclaration.functions))
      spec.payment = { ...payment, scheme: 'exact', amount: '20000' };
    const profile = { schema: 'scratch.fleet-customer-public-inputs.v1',
      planExampleSha256: sha(planSource), pythonExampleSha256: sha(pythonSource),
      applicationSha256: sha(applicationSource), planSha256: sha(JSON.stringify(plan)),
      pythonDeclarationSha256: sha(JSON.stringify(pythonDeclaration)) };
    if (receipt.publicInputs) assert.deepEqual(receipt.publicInputs, profile, 'Continue the same original public inputs.');
    else { receipt.publicInputs = profile; await save(receiptFile, receipt); }
    try { await stat(input); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await preparePackage(plan, input); }
    assert.deepEqual(JSON.parse(await readFile(join(input, 'plan.json'), 'utf8')), plan);
    await mkdir(python, { recursive: true, mode: 0o700 }); await chmod(python, 0o700);
    const application = join(python, pythonDeclaration.application);
    try { assert.equal(sha(await readFile(application)), profile.applicationSha256); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(application, applicationSource, { flag: 'wx', mode: 0o600 });
    }
    try { assert.deepEqual(JSON.parse(await readFile(join(python, 'merchant.json'), 'utf8')), pythonDeclaration); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await save(join(python, 'merchant.json'), pythonDeclaration);
    }
    const revised = structuredClone(plan); revised.operations.find(row => row.method === 'getTransaction').amountAtomic = '23000';
    try { await stat(next); } catch (error) { if (error.code !== 'ENOENT') throw error; await preparePackage(revised, next); }
    const start = receipt.ports ?? await ports(); receipt.ports = start;
    const declarationFile = join(base, 'fleet-setup.json'), declaration = {
      schema: 'stellar-forge.fleet-bootstrap.v1', gateway: { port: start, adminPort: start + 1 }, merchantPortStart: start + 2,
      slots: ['blue', 'green'], tenants: [
        { id: 'rpc', host: new URL(plan.publicOrigin).host, packages: {
          current: { jsonrpcPackage: input, runtime: { allowLoopbackUpstream: true } },
          next: { jsonrpcPackage: next, runtime: { allowLoopbackUpstream: true } } }, initial: { package: 'current', releaseId: 'rpc-v1' } },
        { id: 'python', host: 'python.fleet.example', packages: { current: { python: join(python, 'merchant.json') } },
          initial: { package: 'current', releaseId: 'python-v1' } },
      ],
    };
    await save(declarationFile, declaration);
    const initialized = await bootstrapFleet({ declarationFile, directory }); receipt.planFile = initialized.planFile;
    await record('Original bootstrap retained four stores from the public RPC and Python merchant examples');
  }
  const plan = JSON.parse(await readFile(join(input, 'plan.json'), 'utf8'));
  process.env[plan.endpointEnv] = 'http://127.0.0.1:' + provider.address().port + '/rpc';
  if (!receipt.browserComplete) await browserPhase();
  if (!receipt.terminalComplete) await terminalPhase();
  if (!receipt.mcpComplete) await mcpPhase();
  assert.deepEqual(receipt.browserErrors, []); receipt.state = 'PASS'; delete receipt.failure;
} catch (error) {
  receipt.state = 'FAILED'; receipt.failure = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await cleanup(); console.log(JSON.stringify({ state: receipt.state, receipt: receiptFile,
    milestones: receipt.milestones.length, browserErrors: receipt.browserErrors.length, ownedProcessesClosed: receipt.ownedProcessesClosed,
    failure: receipt.failure ?? null }));
}

}

export const completion = Object.freeze({ source: repo, base, directory, planFile: receipt.planFile,
  receiptFile, receipt: structuredClone(receipt) });
if (alreadyAccepted) console.log(JSON.stringify({ state: receipt.state, receipt: receiptFile,
  milestones: receipt.milestones.length, reused: true }));
if (receipt.state === 'PASS' && process.env.FLEET_CLIENT_DISCOVERY_PHASE) {
  assert.equal(receipt.ownedProcessesClosed, true, 'Close every original SDK handle before the discovery continuation.');
  const phaseFile = resolve(process.env.FLEET_CLIENT_DISCOVERY_PHASE);
  const phase = await import(pathToFileURL(phaseFile).href);
  assert.equal(typeof phase.runFleetDiscoveryPhase, 'function', 'Select the original discovery phase module.');
  await phase.runFleetDiscoveryPhase(completion);
}
