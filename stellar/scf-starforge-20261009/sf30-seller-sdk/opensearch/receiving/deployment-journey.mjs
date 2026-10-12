// MIT. One complete native customer journey through the original OpenSearch workspace.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const required = name => {
  if (!process.env[name]) throw new Error('Configure ' + name + ' through the original receiving wrapper.');
  return process.env[name];
};
const root = resolve(required('OPENSEARCH_RECEIVING_DIRECTORY'));
const directory = resolve(required('OPENSEARCH_DEPLOYMENT_WORKSPACE'));
const packageDirectory = resolve(required('OPENSEARCH_SOURCE_PACKAGE'));
const originalPath = resolve(required('OPENSEARCH_ORIGINAL_JOURNEY'));
const nativeDirectory = resolve(required('OPENSEARCH_NATIVE_METADATA'));
const original = JSON.parse(await readFile(originalPath, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const delay = ms => new Promise(done => setTimeout(done, ms));
const operation = 'opensearch-managed-deployment-396c-20261012';
const originalDraft = 'e3f7a796-c2cd-44f7-bb42-c72e76994294';
const originalEdition = '49042fc669d38005ea9363a73c5fc9c9';
const originalPackage = '867732dab4e426b5710b3e332343d454';
const originalResultSha256 = '5cd0d983106d5691dc4680277590568beb3ec28de67004e8ba0ece0e53546825';
const release1 = 'ee290-flights-managed-v1', release2 = 'ee290-flights-managed-v2';
const client1 = 'ee290-flights-client-v1', client2 = 'ee290-flights-client-v2';
const title2 = 'Managed flight search — six-result edition';
const reportPath = join(root, 'deployment-journey.json');
await mkdir(root, { recursive: true, mode: 0o700 });
await mkdir(join(root, 'customer'), { recursive: true, mode: 0o700 });
await mkdir(join(root, 'screenshots'), { recursive: true, mode: 0o700 });
let report;
try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (report && report.operation !== operation) throw new Error('The retained receiving report belongs to another operation.');
report ??= { schema: 'stellar-forge.opensearch-deployment-journey.v1', operation, startedAt: now(),
  originalJourneySha256: hash(await readFile(originalPath)), originalResultSha256, stages: [], attempts: [], artifacts: [] };
report.state = 'RUNNING'; delete report.error; delete report.completedAt;
report.attempts.push({ startedAt: now(), runtime: process.version, nativeDirectory });
async function save() {
  const temporary = reportPath + '.tmp';
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, reportPath);
}
async function stage(name, values = {}) {
  const item = { name, completedAt: now(), ...values };
  const index = report.stages.findIndex(value => value.name === name);
  if (index < 0) report.stages.push(item); else report.stages[index] = item;
  await save(); process.stdout.write(JSON.stringify({ stage: name, ...values }) + '\n');
}
async function artifact(name, bytes) {
  const path = join(root, name);
  await writeFile(path, bytes, { mode: 0o600 });
  const item = { file: name, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  report.artifacts = [...report.artifacts.filter(value => value.file !== name), item];
  return item;
}
async function until(read, accept, label, milliseconds = 180000) {
  const deadline = Date.now() + milliseconds; let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(label + ' did not complete: ' + JSON.stringify(value));
}
let application, browser, context, page, origin, stopping = false;
const pageErrors = [];
async function api(path) {
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message ?? value.error), { code: value.error, status: response.status });
  return value;
}
async function bytes(path) {
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Receiving download returned ' + response.status + ': ' + await response.text());
  return Buffer.from(await response.arrayBuffer());
}
async function openApplication() {
  const filename = fileURLToPath(new URL('../workspace/server.mjs', import.meta.url));
  const sourceFile = join(root, 'managed-source.json'), planFile = join(packageDirectory, 'merchant-plan.json');
  const child = spawn(process.execPath, [filename, '--source', sourceFile, '--plan', planFile,
    '--workspace', directory, '--port', '0'], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', exit = null, ready;
  const done = new Promise(resolveDone => {
    child.once('error', error => { exit = { error: error.message }; resolveDone(exit); });
    child.once('exit', (code, signal) => { exit = { code, signal }; resolveDone(exit); });
  });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
    for (const line of stdout.split('\n')) {
      try { const value = JSON.parse(line); if (value.workspace && value.workspaceId) ready = value; } catch {}
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
  application = { child, done, get exit() { return exit; }, get stdout() { return stdout; }, get stderr() { return stderr; } };
  await until(async () => {
    if (exit) throw new Error('Original workspace exited before opening: ' + JSON.stringify(exit) + '\n' + stderr);
    return ready;
  }, Boolean, 'Original workspace opening', 45000);
  origin = ready.workspace;
  assert.equal(ready.workspaceId, '310cda5f-aff1-413b-93cc-2cc34d7a4cc7');
  return ready;
}
async function closeApplication() {
  if (!application) return;
  const current = application; application = null;
  if (!current.exit) current.child.kill('SIGTERM');
  let timer;
  try {
    await Promise.race([current.done, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Original workspace graceful close exceeded 100 seconds.')), 100000);
    })]);
  } catch (error) {
    if (!current.exit) current.child.kill('SIGKILL');
    await current.done; throw error;
  } finally {
    clearTimeout(timer);
    await artifact('workspace-process-' + (report.attempts.length) + '-' + current.child.pid + '.log',
      current.stdout + '\n' + current.stderr);
  }
  assert.equal(current.exit.code, 0, 'Original workspace must finish its graceful close.');
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  try { await context?.close(); } finally {
    try { await browser?.close(); } finally { await closeApplication(); }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  report.state = 'INTERRUPTED'; report.error = { message: 'Original receiving operation received ' + signal };
  void save().then(cleanup).finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});
async function ui(selector, path = '/api/deployment', { reload = false } = {}) {
  const [response] = await Promise.all([
    page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === 'POST', { timeout: 200000 }),
    page.locator(selector).click({ timeout: 30000 }),
  ]);
  const initial = await response.json();
  if (!response.ok()) throw new Error('UI request failed: ' + JSON.stringify(initial));
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  const result = initial.id ? await until(() => api('/api/operations/' + encodeURIComponent(initial.id)),
    value => value.state !== 'RUNNING', initial.kind + ' original request') : initial;
  if (result.state && result.state !== 'COMPLETE')
    throw Object.assign(new Error(result.kind + ': ' + JSON.stringify(result.error)), { operation: result.id });
  await until(() => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('stellar-forge-opensearch:') && key.endsWith(':pending'))
    .map(key => localStorage.getItem(key)).filter(Boolean)), value => value.length === 0, 'Browser saved-request recovery', 45000);
  await until(() => page.locator('#new-draft').isEnabled(), Boolean, 'Workspace interface ready', 45000);
  await stage('request-' + result.id, { requestId: result.id, kind: result.kind, state: result.state,
    ...(reload ? { browserReopenedAfterResponse: true, browserReopenedDuringRequest: initial.state === 'RUNNING' } : {}) });
  return result;
}
async function deployment() {
  await page.locator('[data-view="deployment"]').click();
  await page.locator('#deployment-refresh').click();
  await until(() => page.locator('#deployment-status').textContent(), value => value.includes('Generation'), 'Deployment status');
  return api('/api/deployment/status');
}
async function select(id, reason) {
  let status = await deployment();
  if (status.state.active === id) return status;
  await page.locator('#deployment-release').selectOption(id);
  await page.locator('#deployment-reason').fill(reason);
  await ui('#deployment-activate');
  status = await api('/api/deployment/status');
  assert.equal(status.state.active, id);
  return status;
}
async function ensureRunning(id) {
  let status = await select(id, 'Managed customer receiving selection');
  if (status.runtime.state === 'STOPPED') await ui('#deployment-run');
  else if (status.console.managesRunningSeller && status.runtime.observed?.releaseId !== id)
    await ui('#deployment-restart');
  status = await api('/api/deployment/status');
  assert.equal(status.runtime.state, 'RUNNING', JSON.stringify(status.runtime));
  assert.equal(status.runtime.observed.releaseId, id);
  assert.equal(status.console.managesRunningSeller, true);
  return status;
}
async function stagePackage(packageId, id, label, reload = false) {
  const status = await deployment();
  if (status.releases.some(release => release.id === id)) return;
  await page.locator('#deployment-package').selectOption(packageId);
  await page.locator('#deployment-id').fill(id);
  await page.locator('#deployment-label').fill(label);
  await ui('#deployment-stage', '/api/deployment', { reload });
}
async function inspectSeller(status, name) {
  const listener = status.runtime.observed.listener;
  assert.match(listener, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  const openapiResponse = await fetch(listener + '/_seller/openapi.json');
  assert.equal(openapiResponse.status, 200);
  const rawOpenapi = Buffer.from(await openapiResponse.arrayBuffer()), openapi = JSON.parse(rawOpenapi);
  assert.equal(openapi.paths['/search/flights'].post.operationId, 'flight_search');
  const docs = await fetch(listener + '/_seller/docs'); assert.equal(docs.status, 200); await docs.arrayBuffer();
  const response = await fetch(listener + '/search/flights', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ country: 'US', minimum_price: 0 }) });
  assert.equal(response.status, 402);
  const challenge = await response.json();
  assert.equal(challenge.accepts[0].amount, '10000');
  assert.equal(challenge.resource.url, 'https://search.example.com/search/flights');
  await artifact('customer/' + name + '-openapi.json', rawOpenapi);
  const release = status.releases.find(value => value.id === status.state.active);
  await stage(name, { releaseId: release.id, releaseDigest: release.digest,
    executionSha256: release.opensearch.executionSha256, instanceId: status.console.instanceId,
    pid: status.runtime.observed.pid, mode: status.runtime.observed.mode, listener,
    paymentRequiredStatus: response.status, advertisedUrl: challenge.resource.url,
    openapiSha256: hash(rawOpenapi), generation: status.state.generation });
  return { instanceId: status.console.instanceId, listener, executionSha256: release.opensearch.executionSha256,
    releaseDigest: release.digest };
}
function unpackClient(raw) {
  const tar = gunzipSync(raw), files = new Map(); let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && !files.has(name));
    assert.equal(String.fromCharCode(header[156]), '0');
    files.set(name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
async function handover(id, releaseId) {
  await deployment();
  let list = await api('/api/deployment/clients');
  if (!list.entries.some(value => value.exportId === id)) {
    await page.locator('#deployment-client-id').fill(id);
    await ui('#deployment-client-generate');
    list = await api('/api/deployment/clients');
  }
  const entry = list.entries.find(value => value.exportId === id);
  assert.ok(entry?.manifestFile?.sha256, 'Original customer export completion must be retained.');
  const inspect = await api('/api/deployment/client?exportId=' + encodeURIComponent(id));
  const raw = await bytes('/api/deployment/client-download?' + new URLSearchParams({
    exportId: id, expectedManifestSha256: entry.manifestFile.sha256 }));
  const members = unpackClient(raw);
  const manifestBytes = members.get(id + '/client-export.json');
  assert.ok(manifestBytes); assert.equal(hash(manifestBytes), entry.manifestFile.sha256);
  const manifest = JSON.parse(manifestBytes);
  const customerDirectory = join(root, 'customer', id);
  await mkdir(customerDirectory, { recursive: true, mode: 0o700 });
  for (const file of [...manifest.files, { name: 'client-export.json', bytes: manifestBytes.length, sha256: hash(manifestBytes) }]) {
    const body = members.get(id + '/' + file.name);
    assert.ok(body); assert.equal(body.length, file.bytes); assert.equal(hash(body), file.sha256);
    assert.equal(basename(file.name), file.name);
    await writeFile(join(customerDirectory, file.name), body, { mode: 0o600 });
  }
  assert.equal(members.size, manifest.files.length + 1);
  const customer = await import(pathToFileURL(join(customerDirectory, 'seller-client.mjs')));
  const request = customer.buildRequest('flight_search', { body: { country: 'US', minimum_price: 0 } },
    { intentId: 'opensearch-customer-request-' + id, acceptIndex: 0, maxAtomic: '10000' });
  assert.equal(request.url, 'https://search.example.com/search/flights');
  assert.equal(request.method, 'POST');
  const archive = await artifact('customer/' + id + '-client.tar.gz', raw);
  const handoverBytes = await bytes('/api/deployment/handover?releaseId=' + encodeURIComponent(releaseId));
  assert.ok(handoverBytes.toString().includes(releaseId));
  const handoverFile = await artifact('customer/' + releaseId + '-deployment.md', handoverBytes);
  await artifact('customer/' + id + '-inspection.json', JSON.stringify(inspect, null, 2) + '\n');
  await page.locator('#deployment-clients-refresh').click();
  await stage('customer-' + id, { releaseId, manifestSha256: entry.manifestFile.sha256,
    fileCount: members.size, archive, handover: handoverFile, generatedRequest: { method: request.method, url: request.url } });
  return { id, manifestSha256: entry.manifestFile.sha256, archiveSha256: archive.sha256 };
}
async function screenshot(name, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('#view-deployment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(root, 'screenshots', name + '.png'), fullPage: true });
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth }));
  assert.ok(geometry.document <= width && geometry.body <= width, JSON.stringify(geometry));
  const raw = await readFile(join(root, 'screenshots', name + '.png'));
  const file = { file: 'screenshots/' + name + '.png', bytes: raw.length, sha256: hash(raw) };
  report.artifacts = [...report.artifacts.filter(value => value.file !== file.file), file];
  await stage('layout-' + name, { ...geometry, file });
}
try {
  assert.equal(original.state, 'PASS');
  assert.equal(original.stages.find(value => value.name === 'native-capture').resultSha256, originalResultSha256);
  await writeFile(join(root, 'managed-source.json'), JSON.stringify(original.sourceDeclaration, null, 2) + '\n', { mode: 0o600 });
  const engine = JSON.parse(await readFile(join(nativeDirectory, 'native-engine.json'), 'utf8'));
  report.engine = engine; report.workspaceDirectory = directory;
  await openApplication();
  const moduleRoot = required('OPENSEARCH_PLAYWRIGHT_ROOT');
  const require = createRequire(import.meta.url), { chromium } = require(moduleRoot);
  browser = await chromium.launch({ executablePath: required('OPENSEARCH_BROWSER_EXECUTABLE'), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-view="deployment"]').waitFor({ state: 'visible' });
  const starting = await api('/api/state');
  const baseline = await bytes('/api/editions/' + originalEdition + '/result.json');
  assert.equal(hash(baseline), originalResultSha256);
  const carrier = await api('/api/packages/' + originalPackage);
  assert.equal(carrier.directory, packageDirectory);
  assert.equal(carrier.files.length, 11);
  for (const file of carrier.files) {
    const copied = await readFile(join(carrier.directory, file.name));
    assert.equal(copied.length, file.bytes); assert.equal(hash(copied), file.sha256);
  }
  await stage('original-portable-workspace', { workspaceId: starting.workspaceId, draftId: originalDraft,
    editionId: originalEdition, packageId: originalPackage, packageDirectory, fileCount: carrier.files.length,
    resultSha256: hash(baseline), sourceProfileSha256: starting.sourceProfileSha256 });
  await stagePackage(originalPackage, release1, 'Flight search — seven-result release', true);
  const running1 = await ensureRunning(release1);
  const first = await inspectSeller(running1, 'first-running-release');
  const firstClient = await handover(client1, release1);
  await screenshot('deployment-desktop-v1', 1440, 1050);

  let current = await api('/api/state'), upgrade = current.drafts.find(value => value.title === title2);
  if (!upgrade) {
    await page.locator('#new-draft').click();
    await page.locator('#draft-title').fill(title2);
    const query = structuredClone(original.sourceDeclaration.queries.flights);
    query.pageSize = 2; query.maxHits = 6;
    await page.locator('#query-json').fill(JSON.stringify(query, null, 2));
    const saved = await ui('#save', '/api/drafts');
    upgrade = saved.result.draft;
  } else {
    await page.locator('#draft-list .draft').filter({ hasText: title2 }).click();
  }
  current = await api('/api/state');
  let edition = current.editions.find(value => value.draftId === upgrade.id);
  if (!edition) {
    const captured = await ui('#capture', '/api/capture');
    edition = await api('/api/editions/' + captured.result.editionId);
  } else edition = await api('/api/editions/' + edition.id);
  assert.equal(edition.result.hitCount, 6);
  assert.equal(edition.result.hits.length, 6);
  assert.equal(edition.result.pages, 3);
  assert.equal(edition.result.snapshotReleased, true);
  const upgradedRaw = await bytes('/api/editions/' + edition.id + '/result.json');
  await artifact('customer/upgrade-original-result.json', upgradedRaw);
  await stage('native-query-upgrade', { draftId: upgrade.id, revision: upgrade.revision, editionId: edition.id,
    hitCount: edition.result.hitCount, pages: edition.result.pages, snapshotReleased: edition.result.snapshotReleased,
    resultSha256: hash(upgradedRaw), source: edition.result.source });
  current = await api('/api/state');
  let upgradePackage = current.packages.find(value => value.draftId === upgrade.id);
  if (!upgradePackage) {
    await page.locator('#draft-list .draft').filter({ hasText: title2 }).click();
    const prepared = await ui('#prepare', '/api/prepare');
    upgradePackage = prepared.result.package;
  }
  await stagePackage(upgradePackage.id, release2, 'Flight search — six-result release');
  await deployment();
  await page.locator('#deployment-release').selectOption(release2);
  await page.locator('#deployment-compare').click();
  const comparison = await api('/api/deployment/compare?from=' + release1 + '&to=' + release2);
  assert.notEqual(comparison.before.opensearch.executionSha256, comparison.after.opensearch.executionSha256);
  assert.equal(comparison.summary.paymentChanged, 0);
  assert.ok(comparison.runtimeChanges.some(value => value.field === 'opensearch'));
  await artifact('customer/release-upgrade-comparison.json', JSON.stringify(comparison, null, 2) + '\n');
  await screenshot('deployment-upgrade-comparison', 1440, 1050);
  const selected = await select(release2, 'Use the reviewed six-result native query');
  assert.equal(selected.runtime.state, 'RESTART_REQUIRED');
  assert.equal(selected.runtime.observed.releaseId, release1);
  const stillServing = await fetch(first.listener + '/_seller/openapi.json');
  assert.equal(stillServing.status, 200); await stillServing.arrayBuffer();
  await ui('#deployment-restart');
  const second = await inspectSeller(await api('/api/deployment/status'), 'upgraded-running-release');
  assert.notEqual(second.instanceId, first.instanceId);
  assert.notEqual(second.executionSha256, first.executionSha256);
  const secondClient = await handover(client2, release2);
  await screenshot('deployment-mobile-390', 390, 844);
  await screenshot('deployment-mobile-320', 320, 720);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#deployment-reason').fill('Return customer installation to the retained seven-result query');
  await ui('#deployment-rollback');
  let status = await api('/api/deployment/status');
  assert.equal(status.state.active, release1);
  assert.equal(status.runtime.state, 'RESTART_REQUIRED');
  await ui('#deployment-restart');
  const restored = await inspectSeller(await api('/api/deployment/status'), 'rolled-back-running-release');
  assert.equal(restored.executionSha256, first.executionSha256);
  assert.notEqual(restored.instanceId, second.instanceId);
  assert.equal(hash(await bytes('/api/editions/' + originalEdition + '/result.json')), originalResultSha256);
  await screenshot('deployment-rollback-desktop', 1440, 1050);
  await ui('#deployment-stop');
  status = await api('/api/deployment/status'); assert.equal(status.runtime.state, 'STOPPED');
  const beforeClose = { workspaceId: starting.workspaceId, generation: status.state.generation,
    active: status.state.active, previous: status.state.previous, releases: status.releases.map(value => ({ id: value.id, digest: value.digest })),
    editionId: edition.id, clients: [firstClient, secondClient] };
  await context.close(); context = null; page = null;
  await closeApplication();
  const reopened = await openApplication();
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }); page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-view="deployment"]').waitFor({ state: 'visible' });
  status = await deployment();
  assert.equal(reopened.workspaceId, beforeClose.workspaceId);
  assert.equal(status.state.generation, beforeClose.generation);
  assert.equal(status.state.active, beforeClose.active); assert.equal(status.state.previous, beforeClose.previous);
  assert.deepEqual(status.releases.map(value => ({ id: value.id, digest: value.digest })), beforeClose.releases);
  assert.equal(hash(await bytes('/api/editions/' + originalEdition + '/result.json')), originalResultSha256);
  for (const client of beforeClose.clients) {
    const raw = await bytes('/api/deployment/client-download?' + new URLSearchParams({
      exportId: client.id, expectedManifestSha256: client.manifestSha256 }));
    assert.equal(hash(raw), client.archiveSha256);
  }
  await ensureRunning(release1);
  await inspectSeller(await api('/api/deployment/status'), 'fresh-process-running-release');
  await page.locator('#deployment-clients-refresh').click();
  await screenshot('deployment-fresh-process', 1440, 1050);
  await ui('#deployment-stop');
  assert.equal((await api('/api/deployment/status')).runtime.state, 'STOPPED');
  await stage('fresh-process-customer-reopen', { ...beforeClose, originalResultSha256,
    customerArchivesIdentical: true, newProcessOpenedRetainedRelease: true });
  assert.deepEqual(pageErrors, []);
  await stage('browser-completion', { pageErrors, desktopWidth: 1440, mobileWidths: [390, 320] });
  report.state = 'PASS'; report.completedAt = now();
} catch (error) {
  report.state = 'FAIL'; report.completedAt = now();
  report.error = { name: error.name, code: error.code, message: error.message, operation: error.operation, stack: error.stack };
  try { await page?.screenshot({ path: join(root, 'screenshots', 'receiving-failure.png'), fullPage: true }); } catch {}
  process.stderr.write(JSON.stringify({ error: report.error }) + '\n'); process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) { report.state = 'FAIL'; report.cleanupError = { message: error.message }; process.exitCode = 1; }
  await save();
  process.stdout.write(JSON.stringify({ state: report.state, reportPath, completedAt: report.completedAt }) + '\n');
}
