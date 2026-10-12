// MIT. Real browser walkthrough of the original received Kafka console.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, chmod, stat, rename, lstat, link, unlink, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--input') throw new Error('Use --input with the original private browser request');
const requestPath = resolve(args[1]);
const input = JSON.parse(await readFile(requestPath, 'utf8'));
assert.equal(input.schema, 'stellar-forge.kafka-native-customer-receiving.v1');
const output = resolve(input.outputDirectory);
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const expectedEvent = JSON.parse(await readFile(input.expectedEvent, 'utf8'));
const expectedQuery = JSON.parse(await readFile(input.expectedQuery, 'utf8'));
const connection = (await readFile(input.connectionFile, 'utf8')).replace(/\n$/, '');
const target = new URL(connection);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' ||
    target.search || !/^#[A-Za-z0-9_-]{40,64}$/.test(target.hash))
  throw new Error('Use the original private loopback console connection');
const token = target.hash.slice(1);
const sanitize = value => String(value).split(connection).join('[private console]')
  .split(token).join('[private capability]');
const digest = data => createHash('sha256').update(data).digest('hex');
const module = await import(pathToFileURL(resolve(input.playwrightModule)).href);
const chromium = module.chromium ?? module.default?.chromium;
if (!chromium) throw new Error('Use the existing complete Playwright module with Chromium');
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ headless: true,
  ...(input.browserExecutable ? { executablePath: resolve(input.browserExecutable) } : {}),
  args: ['--disable-dev-shm-usage'] });
let context, completed;
const errors = [], steps = [], responses = [];
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(sanitize(error.message)));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === target.origin && response.status() >= 400)
      responses.push({ path: url.pathname, status: response.status() });
  });
  async function ready() {
    await page.waitForFunction(() => document.body.dataset.busy !== 'true');
    const error = await page.locator('#notice').getAttribute('data-error');
    if (error === 'true') throw new Error(await page.locator('#notice').innerText());
  }
  async function select(id, value) {
    await page.locator('#' + id).selectOption(value);
    await ready();
  }
  async function saveDownload(action, filename) {
    const pending = page.waitForEvent('download');
    await action();
    const download = await pending;
    const path = join(output, filename);
    await download.saveAs(path);
    await chmod(path, 0o600);
    const error = await download.failure();
    if (error) throw new Error(error);
    const bytes = await readFile(path);
    await ready();
    return { filename, bytes: bytes.length, sha256: digest(bytes) };
  }

  await page.goto(connection, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(({ capture, projection, build }) =>
    [...document.querySelectorAll('#kafka-capture-select option')].some(option => option.value === capture) &&
    [...document.querySelectorAll('#kafka-projection-select option')].some(option => option.value === projection) &&
    [...document.querySelectorAll('#build-select option')].some(option => option.value === build),
    { capture: input.capture, projection: input.projection, build: input.build });
  await ready();
  const launch = await page.evaluate(async () => {
    const token = sessionStorage.getItem('sf30-ndjson-console-token');
    const response = await fetch('/api/launch', { headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error('Original launch status ' + response.status);
    return response.json();
  });
  assert.equal(launch.schema, 'stellar-forge.kafka-workspace-launch.v1');
  assert.equal(launch.status, 'KAFKA_WORKSPACE_READY');
  assert.equal(launch.workspace, input.workspace);
  assert.equal(launch.bindingSha256, input.bindingSha256);
  steps.push({ phase: 'managed-console-open', status: 'COMPLETE', workspaceId: launch.workspaceId });

  await select('kafka-capture-select', input.capture);
  await page.waitForFunction(id => document.querySelector('#kafka-capture-detail').textContent.includes(id), input.capture);
  assert.equal((await page.locator('#kafka-capture-status').innerText()).trim(), 'COMPLETE');
  const inspectName = 'Inspect partition ' + expectedEvent.partition + ' offset ' + expectedEvent.offset;
  let attempts = 0;
  while (!(await page.getByRole('button', { name: inspectName, exact: true }).count())) {
    if (await page.locator('#kafka-messages-next').isDisabled() || ++attempts > 20000)
      throw new Error('The selected retained event is missing from its original message history');
    await page.locator('#kafka-messages-next').click();
    await ready();
  }
  await page.getByRole('button', { name: inspectName, exact: true }).click();
  await ready();
  await page.waitForFunction(id => document.querySelector('#kafka-message-detail').textContent.includes(id), expectedEvent.id);
  await page.locator('#kafka-value-view').selectOption('base64');
  const base64Value = await page.locator('#kafka-message-value').innerText();
  assert.equal(base64Value, expectedEvent.valueBase64 === null ? 'null — Kafka tombstone' :
    expectedEvent.valueBase64 || '(empty byte string)');
  let exactJson = null;
  if (typeof expectedEvent.valueJson === 'string') {
    await page.locator('#kafka-value-view').selectOption('json');
    exactJson = await page.locator('#kafka-message-value').innerText();
    assert.equal(exactJson, expectedEvent.valueJson);
  }
  const eventDownload = await saveDownload(() => page.locator('#kafka-download-message').click(), 'native-event.json');
  const event = JSON.parse(await readFile(join(output, eventDownload.filename), 'utf8'));
  for (const key of ['id', 'sha256', 'clusterId', 'topicId', 'topic', 'partition', 'offset',
    'keyBase64', 'valueBase64', 'headers', 'valueJson']) assert.deepEqual(event[key], expectedEvent[key]);
  await page.locator('#history').screenshot({ path: join(output, 'source-history.png') });
  await chmod(join(output, 'source-history.png'), 0o600);
  steps.push({ phase: 'complete-message-inspection', status: 'COMPLETE', event: expectedEvent.id,
    exactJsonSha256: exactJson === null ? null : digest(exactJson), download: eventDownload });

  await select('kafka-projection-select', input.projection);
  await page.locator('#kafka-open-projection').click();
  await ready();
  assert.equal(await page.locator('#source-select').inputValue(), input.source);
  assert.equal(await page.locator('#dataset-workspace').getAttribute('open'), '');
  if (!(await page.locator('#columns-body tr').count())) throw new Error('Original suggested mapping did not open');
  await select('build-select', input.build);
  await page.locator('#query-limit').fill('50');
  const queryResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/query' && response.request().method() === 'POST');
  await page.locator('#query-form button[type="submit"]').click();
  const nativeQuery = await (await queryResponse).json();
  await ready();
  assert.deepEqual(nativeQuery.response, expectedQuery.response);
  assert.deepEqual(nativeQuery.dataset, expectedQuery.dataset);
  await writeFile(join(output, 'browser-native-query.json'), JSON.stringify(nativeQuery, null, 2) + '\n', { mode: 0o600 });
  steps.push({ phase: 'original-mapping-and-dataset-query', status: 'COMPLETE',
    source: input.source, build: input.build, snapshot: nativeQuery.dataset.snapshot,
    total: nativeQuery.response.body.page.total, returned: nativeQuery.response.body.page.returned });

  await select('kafka-export-projection', input.projection);
  await select('kafka-export-build', input.build);
  const archive = await saveDownload(() => page.locator('#kafka-export-form button[type="submit"]').click(),
    'browser-kafka-project.zip');
  await page.locator('#handoff').screenshot({ path: join(output, 'customer-handoff.png') });
  await chmod(join(output, 'customer-handoff.png'), 0o600);
  steps.push({ phase: 'whole-project-browser-download', status: 'COMPLETE', projection: input.projection,
    build: input.build, archive });
  const merchantInput = { sourcePin: input.sourcePin, build: input.build, request: input.merchant };
  const merchantKey = digest(JSON.stringify(merchantInput));
  const retainedMerchantInput = join(output, 'merchant-input.json');
  const retainedMerchant = join(output, 'merchant-download.json');
  const merchantPath = join(output, 'native-merchant.zip');
  async function syncPath(path) {
    const descriptor = await open(path, 'r');
    try { await descriptor.sync(); }
    finally { await descriptor.close(); }
  }
  async function retainJson(path, value) {
    const data = JSON.stringify(value) + '\n';
    const temporary = path + '.pending-' + randomUUID();
    let descriptor, owned = false;
    try {
      descriptor = await open(temporary, 'wx', 0o600);
      owned = true;
      await descriptor.writeFile(data);
      await descriptor.sync();
      await descriptor.close();
      descriptor = null;
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await lstat(path)).isFile() || await readFile(path, 'utf8') !== data)
          throw new Error('The original merchant receiving input changed');
      }
      await syncPath(dirname(path));
    } finally {
      if (descriptor) await descriptor.close().catch(() => {});
      if (owned) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  await retainJson(retainedMerchantInput, { inputSha256: merchantKey, input: merchantInput });
  let merchantArchive;
  try {
    const saved = JSON.parse(await readFile(retainedMerchant, 'utf8'));
    assert.equal(saved.inputSha256, merchantKey);
    assert.equal(saved.archive.filename, 'native-merchant.zip');
    if ((await lstat(merchantPath)).isSymbolicLink()) throw new Error('Use the retained original merchant ZIP');
    const bytes = await readFile(merchantPath);
    assert.equal(bytes.length, saved.archive.bytes);
    assert.equal(digest(bytes), saved.archive.sha256);
    merchantArchive = saved.archive;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      if ((await lstat(merchantPath)).isSymbolicLink()) throw new Error('Use the retained original merchant ZIP');
      const bytes = await readFile(merchantPath);
      merchantArchive = { filename: 'native-merchant.zip', bytes: bytes.length, sha256: digest(bytes) };
      await retainJson(retainedMerchant, { inputSha256: merchantKey, archive: merchantArchive });
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
    }
  }
  await select('merchant-build', input.build);
  await page.locator('#merchant-origin').fill(input.merchant.origin);
  await page.locator('#merchant-path').fill(input.merchant.path);
  await page.locator('#merchant-payment').fill(JSON.stringify(input.merchant.payment, null, 2));
  if (!merchantArchive) {
    const pending = page.waitForEvent('download');
    await page.locator('#merchant-form button[type="submit"]').click();
    const download = await pending;
    const temporary = join(output, '.native-merchant-' + randomUUID() + '.zip');
    let pendingFile, ownedTemporary = false;
    try {
      pendingFile = await open(temporary, 'wx', 0o600);
      ownedTemporary = true;
      await pendingFile.close();
      pendingFile = null;
      await download.saveAs(temporary);
      await chmod(temporary, 0o600);
      const failure = await download.failure();
      if (failure) throw new Error(failure);
      await syncPath(temporary);
      const bytes = await readFile(temporary);
      merchantArchive = { filename: 'native-merchant.zip', bytes: bytes.length, sha256: digest(bytes) };
      try { await link(temporary, merchantPath); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if ((await lstat(merchantPath)).isSymbolicLink() || digest(await readFile(merchantPath)) !== merchantArchive.sha256)
          throw new Error('A different original merchant ZIP is already retained');
      }
      await syncPath(output);
    } finally {
      if (pendingFile) await pendingFile.close().catch(() => {});
      if (ownedTemporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await retainJson(retainedMerchant, { inputSha256: merchantKey, archive: merchantArchive });
    await ready();
  }
  await page.locator('#merchant').screenshot({ path: join(output, 'merchant-customer-sdk.png') });
  await chmod(join(output, 'merchant-customer-sdk.png'), 0o600);
  steps.push({ phase: 'original-merchant-and-generated-customer-sdk', status: 'COMPLETE',
    build: input.build, origin: input.merchant.origin, path: input.merchant.path,
    payment: input.merchant.payment, archive: merchantArchive });
  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  await page.waitForFunction(id => [...document.querySelectorAll('#kafka-capture-select option')].some(option => option.value === id), input.capture);
  await select('kafka-capture-select', input.capture);
  assert.equal((await page.locator('#kafka-capture-status').innerText()).trim(), 'COMPLETE');
  steps.push({ phase: 'same-console-browser-reopen', status: 'COMPLETE', capture: input.capture });
  if (errors.length || responses.length) throw new Error('Original browser errors: ' + JSON.stringify({ errors, responses }));
  completed = { schema: 'stellar-forge.kafka-native-browser-receiving.v1', operation: input.operation,
    sourcePin: input.sourcePin, status: 'COMPLETE', startedAt, completedAt: new Date().toISOString(),
    browser: await browser.version(), steps, archive, merchantArchive, errors, responses,
    screenshots: ['source-history.png', 'customer-handoff.png', 'merchant-customer-sdk.png'] };
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'ERROR',
    message: sanitize(error.message), steps, errors, responses, observedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  throw new Error(sanitize(error.message));
} finally {
  if (context) await context.close();
  await browser.close();
}
completed.closed = true;
const temporary = join(output, '.result-' + process.pid + '.json');
await writeFile(temporary, JSON.stringify(completed, null, 2) + '\n', { mode: 0o600 });
await rename(temporary, join(output, 'result.json'));
console.log(JSON.stringify({ status: completed.status, operation: completed.operation,
  sourcePin: completed.sourcePin, phases: completed.steps.length, archive: completed.archive }));
