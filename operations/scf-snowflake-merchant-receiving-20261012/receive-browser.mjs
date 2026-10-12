#!/usr/bin/env node
// MIT. Continue the complete original Snowflake native HTTP and browser receiving case.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--source-root', '--directory', '--original', '--playwright-module', '--browser-executable'].includes(argv[i]) ||
      !argv[i + 1] || options[argv[i]]) throw new Error('Select the complete source, original directory, same private operation, installed Playwright module and browser executable.');
  options[argv[i]] = argv[i + 1];
}
for (const name of ['--source-root', '--directory', '--playwright-module', '--browser-executable'])
  if (!options[name]) throw new Error('Missing required option ' + name);
process.umask(0o077);
const sourceRoot = await realpath(resolve(options['--source-root']));
const product = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake');
const browserExecutable = await realpath(resolve(options['--browser-executable']));
const playwrightModule = await realpath(resolve(options['--playwright-module']));
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const { startSnowflakeWorkspace } = await import(pathToFileURL(join(product, 'server.mjs')).href);
const releases = await import(pathToFileURL(join(sourceRoot, 'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).href);
const { readReleaseState } = releases;

const root = resolve(options['--directory']);
const workspace = join(root, 'workspace');
const original = await realpath(resolve(options['--original'] ?? dirname(fileURLToPath(import.meta.url))));
const receiptPath = join(root, 'operation.json');
const digest = value => createHash('sha256').update(value).digest('hex');
await mkdir(root, { recursive: true, mode: 0o700 });
const rootStat = await lstat(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.mode & 0o077 || await realpath(root) !== root)
  throw new Error('Select the original private operation directory.');
const sourceSelection = { sourceRoot, node: process.version, browserExecutable, playwrightModule, files: [] };
for (const path of ['declaration.mjs', 'store.mjs', 'source.mjs', 'edition.mjs', 'publisher.mjs', 'workspace.mjs',
  'server.mjs', 'transfer.mjs', 'cloud-delivery.mjs', 'public/app.js', 'public/index.html', 'public/style.css']) {
  const bytes = await readFile(join(product, path));
  sourceSelection.files.push({ path, bytes: bytes.length,
    gitBlobSha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') });
}
const sourceBytes = Buffer.from(JSON.stringify(sourceSelection, null, 2) + '\n');
const sourceSha256 = digest(sourceBytes);
const sourcePath = join(root, 'browser-source-' + sourceSha256 + '.json');
try { await writeFile(sourcePath, sourceBytes, { mode: 0o600, flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(sourcePath), sourceBytes); }
let receipt;
try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; receipt = { schema: 'c94.snowflake-merchant-operation.v1',
  operationId: 'C94-SNOWFLAKE-MERCHANT-20261012', startedAt: new Date().toISOString(),
  inputKind: 'retained SQL API contract fixture from the original native core journey',
  publicationId: '94c00000-0000-4000-8000-000000000001', steps: {} }; }
assert.equal(receipt.schema, 'c94.snowflake-merchant-operation.v1', 'Continue the original Snowflake receiving operation.');
assert.equal(receipt.operationId, 'C94-SNOWFLAKE-MERCHANT-20261012');
assert.equal(receipt.publicationId, '94c00000-0000-4000-8000-000000000001');
receipt.browserSourceSha256 = sourceSha256;
async function save() {
  const temporary = receiptPath + '.next';
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, receiptPath);
}
async function step(name, details) { receipt.steps[name] = { at: new Date().toISOString(), ...details }; await save(); console.log(JSON.stringify({ step: name, ...details })); }
let app;
try {
  receipt.status = 'RUNNING'; delete receipt.error; await save();
  const manifest = JSON.parse(await readFile(join(original, 'receiving.json'), 'utf8'));
  app = await startSnowflakeWorkspace({ directory: workspace, port: 0 });
  const token = new URL(app.url).hash.slice(1);
  async function api(path, value, { method = value === undefined ? 'GET' : 'POST', raw = false } = {}) {
    const response = await fetch(app.origin + path, { method, headers: { 'x-snowflake-workspace': token,
      ...(value === undefined ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' }) },
      body: value === undefined ? undefined : raw ? value : JSON.stringify(value), signal: AbortSignal.timeout(90000) });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!response.ok) throw Object.assign(new Error(path + ': ' + JSON.stringify(body)), { code: body.error, status: response.status });
    return body;
  }
  let transfer = await api('/api/transfers', { manifest });
  for (const part of transfer.partitions) {
    const bytes = await readFile(join(original, part.path));
    assert.equal(digest(bytes), part.sha256);
    if (!part.received) await api('/api/transfers/' + transfer.id + '/partitions/' + part.partition, bytes, { method: 'PUT', raw: true });
  }
  transfer = await api('/api/transfers/' + transfer.id + '/commit', {});
  assert.equal(transfer.status, 'RECEIVED'); assert.equal(transfer.editionId, manifest.editionId);
  const eid = manifest.editionId;
  const page = await api('/api/editions/' + eid + '/rows?limit=50');
  assert.equal(page.total, 2);
  assert.equal(page.rows[0].id, '9007199254740993');
  assert.equal(page.rows[0].amount, '12345678901234567890.123456789012345678');
  assert.equal(page.rows[0].memo, null);
  await step('http-original-folder-receiving-and-exact-rows', { transferId: transfer.id, editionId: eid, partitions: transfer.partitions.length, rows: page.total });
  let selected = await api('/api/editions/' + eid);
  if (selected.review?.decision !== 'ACCEPTED') await api('/api/editions/' + eid + '/review',
    { decision: 'ACCEPTED', actor: 'C94 native integration', note: 'Reviewed exact retained core fixture, native scalar/null representation and complete original partition bodies.' });
  const req = createRequire(join(sourceRoot, 'snowflake-native-receiving.mjs'));
  const { StrKey } = req('@stellar/stellar-sdk');
  const columns = page.columns.map(column => typeof column === 'string' ? column : column.name);
  const draft = { merchant: { name: 'C94 retained Snowflake merchant', origin: 'https://snowflake-c94.example',
    network: 'stellar:testnet', asset: StrKey.encodeContract(Buffer.alloc(32)), payTo: StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), maxTimeoutSeconds: 60 },
    queries: [{ name: 'ledger', method: 'GET', path: '/ledger',
      sql: 'SELECT ' + columns.map(name => '"' + name.replaceAll('"', '""') + '"').join(', ') + ' FROM records ORDER BY __sf30_row_number',
      columns, parameters: {}, publicInput: {}, maxRows: 100, maxBytes: 917504, timeoutMs: 1000,
      description: 'Exact reviewed retained edition', amount: '1' }] };
  const prepared = await api('/api/prepare', { editionId: eid, draft, publicationId: receipt.publicationId, runtime: { port: 0 } });
  assert.equal(prepared.status, 'PREPARED');
  const again = await api('/api/prepare', { editionId: eid, draft, publicationId: receipt.publicationId, runtime: { port: 0 } });
  assert.equal(again.releaseId, prepared.releaseId);
  const snapshot = join(prepared.releaseRoot, 'releases', prepared.releaseId, 'sqlite/snapshot.sqlite');
  const db = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const rows = db.prepare(draft.queries[0].sql).all().map(row => ({ ...row }));
    assert.deepEqual(rows, page.rows);
    const raw = db.prepare('SELECT partition_number, sha256, bytes, body FROM __sf30_snowflake_originals ORDER BY partition_number').all();
    assert.equal(raw.length, manifest.partitions.length);
    for (const [index, part] of raw.entries()) {
      assert.equal(part.sha256, manifest.partitions[index].sha256);
      assert.equal(part.bytes, manifest.partitions[index].bytes);
      assert.equal(digest(part.body), part.sha256);
    }
    await step('original-sqlite-workbench-and-native-sf82-snapshot', { publicationId: prepared.id, releaseId: prepared.releaseId,
      rows: rows.length, originalBodies: raw.length, snapshotSha256: digest(await readFile(snapshot)), repeatReleaseId: again.releaseId });
  } finally { db.close(); }
  const opened = await api('/api/release-console', { port: 0 });
  const releaseUrl = new URL(opened.url), releaseToken = releaseUrl.hash.slice(1);
  async function releaseApi(path, body) {
    const response = await fetch(releaseUrl.origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-release-token': releaseToken, origin: releaseUrl.origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(path + ': ' + JSON.stringify(result)), { status: response.status, code: result.error });
    return result;
  }
  let nativeState = await releases.readReleaseState(prepared.releaseRoot);
  if (nativeState.active !== prepared.releaseId) await releaseApi('/api/activate', { id: prepared.releaseId,
    expectedGeneration: nativeState.generation, reason: 'Original retained edition native merchant journey' });
  const status = await releaseApi('/api/status');
  assert.equal((await releases.readReleaseState(prepared.releaseRoot)).active, prepared.releaseId);
  assert.ok(JSON.stringify(status).includes(prepared.releaseId));
  for (const asset of ['/', '/app.mjs', '/client.mjs', '/receiving.mjs', '/style.css'])
    assert.equal((await fetch(releaseUrl.origin + asset)).status, 200);
  await step('original-release-console-selection-and-customer-receiving-assets', { releaseId: prepared.releaseId,
    generation: (await releases.readReleaseState(prepared.releaseRoot)).generation, assets: 5 });
  receipt.editionId = eid; receipt.releaseId = prepared.releaseId; receipt.releaseRoot = prepared.releaseRoot;
  receipt.status = 'API_PASSED'; await save();
  await runBrowserJourney({ app, original, root, receipt, step, prepared, draft });
} catch (error) {
  receipt.status = 'INTERRUPTED'; receipt.error = { code: error.code, message: error.message, stack: error.stack };
  await save().catch(() => {}); console.error(JSON.stringify(receipt.error)); process.exitCode = 1;
} finally {
  await app?.close(); receipt.closedAt = new Date().toISOString(); await save();
}
console.log(JSON.stringify({ operationId: receipt.operationId, status: receipt.status, steps: Object.keys(receipt.steps), receipt: receiptPath }));

async function runBrowserJourney({ original, root, receipt, step, draft }) {
  const temporary = join(root, 'browser-temporary');
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'downloads'), { recursive: true, mode: 0o700 });
  const receiver = await startSnowflakeWorkspace({ directory: join(root, 'browser-workspace'), port: 0 });
  let browser, context, page, consolePage;
  const errors = [], network = [];
  try {
    browser = await chromium.launch({ executablePath: browserExecutable,
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env: { ...process.env, TMPDIR: temporary } });
    context = await browser.newContext({ viewport: { width: 1360, height: 960 }, acceptDownloads: true });
    context.setDefaultTimeout(20000);
    page = await context.newPage();
    const track = target => {
      target.on('pageerror', error => errors.push({ page: new URL(target.url()).pathname, message: error.message }));
      target.on('response', response => { if (response.url().includes('/api/')) network.push({
        method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() }); });
    };
    track(page);
    await page.goto(receiver.url);
    await page.waitForFunction(() => document.getElementById('workspace-status').textContent.includes('captures running'));
    await page.locator('#receiving-files').setInputFiles(original);
    const selectedFiles = await page.locator('#receiving-files').evaluate(input => [...input.files].map(file => ({ name: file.name, path: file.webkitRelativePath, bytes: file.size })));
    await writeFile(join(root, 'browser-selected-input.json'), JSON.stringify(selectedFiles, null, 2) + '\n', { mode: 0o600 });
    await page.getByRole('button', { name: 'Receive selected files', exact: true }).click();
    await page.locator('#edition-detail').waitFor({ state: 'visible' });
    await page.locator('#edition-rows tbody tr').first().waitFor();
    const cells = await page.locator('#edition-rows td').allTextContents();
    assert.ok(cells.includes('9007199254740993'));
    assert.ok(cells.includes('12345678901234567890.123456789012345678'));
    assert.ok(cells.includes('NULL'));
    assert.equal(await page.locator('#edition-rows tbody tr').count(), 2);
    const manifest = JSON.parse(await readFile(join(original, 'receiving.json'), 'utf8'));
    // A previous process can have retained some partitions before interruption.
    // The original receiving workspace resumes those files; complete exact rows
    // and the original body download below verify the completed receiving.
    const uploadedPartitions = network.filter(item => item.method === 'PUT' &&
      item.path.includes('/partitions/') && item.status === 200).length;
    await step('browser-original-folder-received', { editionId: manifest.editionId, partitions: manifest.partitions.length,
      renderedRows: 2, uploadedPartitions, receiverDirectory: receiver.workspace.directory, exactIntegerDecimalAndNull: true });
    await page.locator('#edition-originals').click();
    const downloading = page.waitForEvent('download');
    await page.locator('#detail-dialog').getByRole('button', { name: 'Download original', exact: true }).first().click();
    const download = await downloading, target = join(root, 'downloads', 'partition-00000.json');
    await download.saveAs(target);
    assert.equal(createHash('sha256').update(await readFile(target)).digest('hex'), manifest.partitions[0].sha256);
    await page.locator('#dialog-close').click();
    if (!(await page.locator('#latest-review').textContent()).startsWith('ACCEPTED')) {
      await page.locator('#review-actor').fill('C94 browser operator');
      await page.locator('#review-note').fill('Reviewed the original received partition and exact retained integer, decimal and null values in this receiving workspace.');
      const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/review') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Save review', exact: true }).click();
      assert.equal((await response).status(), 200);
      await page.waitForFunction(() => document.getElementById('latest-review').textContent.startsWith('ACCEPTED'));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(root, 'browser-edition.jpg'), type: 'jpeg', quality: 72 });
    await page.locator('[data-tab="merchant"]').click();
    let saved = receipt.browserPublicationId ? receiver.workspace.store.getPublication(receipt.browserPublicationId) : null;
    if (saved) {
      await page.getByRole('button', { name: 'Open publication', exact: true }).first().click();
    } else {
      for (const [field, key] of [['name', 'name'], ['origin', 'origin'], ['network', 'network'],
        ['asset', 'asset'], ['payto', 'payTo'], ['timeout', 'maxTimeoutSeconds']])
        await page.locator('#merchant-' + field).fill(String(draft.merchant[key]));
      await page.locator('#merchant-queries').fill(JSON.stringify(draft.queries, null, 2));
      receipt.browserPublicationId = await page.locator('#publication-id').inputValue();
      await step('browser-merchant-request-selected', { publicationId: receipt.browserPublicationId, editionId: manifest.editionId });
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/prepare' && r.request().method() === 'POST');
      await page.locator('#prepare-merchant').click();
      const result = await response;
      assert.equal(result.status(), 201, await result.text());
      saved = await result.json();
      assert.equal(saved.id, receipt.browserPublicationId);
      assert.equal(saved.status, 'PREPARED');
    }
    await page.reload();
    await page.waitForFunction(() => document.getElementById('workspace-status').textContent.includes('captures running'));
    await page.locator('[data-tab="merchant"]').click();
    await page.getByRole('button', { name: 'Open publication', exact: true }).first().click();
    await page.waitForFunction(id => document.getElementById('publication-id').value === id, receipt.browserPublicationId);
    assert.equal(await page.locator('#merchant-name').inputValue(), draft.merchant.name);
    assert.equal(await page.locator('#merchant-origin').inputValue(), draft.merchant.origin);
    assert.equal(await page.locator('#merchant-name').evaluate(element => element.readOnly), true);
    assert.deepEqual(JSON.parse(await page.locator('#merchant-queries').inputValue()), draft.queries);
    const continued = page.waitForResponse(r => new URL(r.url()).pathname === '/api/publications/' + receipt.browserPublicationId + '/resume');
    await page.locator('#prepare-merchant').click();
    const continuation = await continued;
    assert.equal(continuation.status(), 200, await continuation.text());
    saved = await continuation.json();
    assert.equal(saved.id, receipt.browserPublicationId);
    assert.equal(saved.releaseId, 'snowflake-' + receipt.browserPublicationId);
    assert.equal(receiver.workspace.store.list('publications').items.length, 1);
    await step('browser-publication-reopen-and-original-continuation', {
      publicationId: saved.id, releaseId: saved.releaseId, originalReviewSequence: saved.request.reviewSequence,
      originalRequestSha256: saved.requestSha256, publicationCount: 1 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(root, 'browser-merchant.jpg'), type: 'jpeg', quality: 72 });
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.viewport, JSON.stringify(dimensions));
    await page.screenshot({ path: join(root, 'browser-mobile.jpg'), type: 'jpeg', quality: 75 });
    await page.setViewportSize({ width: 1360, height: 960 });
    const popup = context.waitForEvent('page');
    await page.locator('#release-console').click();
    consolePage = await popup; track(consolePage);
    await consolePage.waitForLoadState('domcontentloaded');
    await consolePage.getByRole('heading', { name: 'Seller releases', exact: true }).waitFor();
    await consolePage.locator('#release-list button[data-id="' + saved.releaseId + '"]').waitFor();
    if ((await readReleaseState(saved.releaseRoot)).active !== saved.releaseId) {
      await consolePage.locator('#reason').fill('Reviewed original Snowflake edition through browser receiving and merchant preparation');
      const activating = consolePage.waitForResponse(r => new URL(r.url()).pathname === '/api/activate');
      await consolePage.locator('#activate').click();
      const activated = await activating;
      assert.equal(activated.status(), 200, await activated.text());
    }
    await consolePage.waitForFunction(id => document.getElementById('selected').textContent === id, saved.releaseId);
    assert.equal((await readReleaseState(saved.releaseRoot)).active, saved.releaseId);
    await consolePage.screenshot({ path: join(root, 'browser-release-console.jpg'), type: 'jpeg', quality: 72 });
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'browser-network.json'), JSON.stringify(network, null, 2) + '\n', { mode: 0o600 });
    receipt.status = 'BROWSER_PASSED';
    await step('browser-native-release-selection-and-layout', { releaseId: saved.releaseId,
      generation: (await readReleaseState(saved.releaseRoot)).generation, mobile: dimensions,
      pageErrors: errors.length, originalPartitionDownloaded: manifest.partitions[0].sha256,
      screenshots: ['browser-edition.jpg', 'browser-merchant.jpg', 'browser-mobile.jpg', 'browser-release-console.jpg'] });
  } catch (error) {
    await writeFile(join(root, 'browser-failure.json'), JSON.stringify({ message: error.message, stack: error.stack,
      pageErrors: errors, network, page: page ? { url: new URL(page.url()).origin,
        notice: await page.locator('#notice').textContent().catch(() => null),
        text: (await page.locator('body').innerText().catch(() => '')).slice(0,14000) } : null,
      console: consolePage ? { notice: await consolePage.locator('#notice').textContent().catch(() => null),
        text: (await consolePage.locator('body').innerText().catch(() => '')).slice(0,14000) } : null }, null, 2),
      { mode: 0o600 }).catch(() => {});
    throw error;
  } finally {
    await context?.close(); await browser?.close(); await receiver.close();
  }
}
