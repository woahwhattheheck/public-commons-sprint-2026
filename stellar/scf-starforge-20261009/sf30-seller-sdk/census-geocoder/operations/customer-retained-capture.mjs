#!/usr/bin/env node
// One retained original Census response through the merged customer product.
// No discovery, Census HTTP capture, release activation, buyer execution or payment.
import assert from 'node:assert/strict';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

const SOURCE_HEAD = 'a590f72c3444b67d74ee98a27e85288085535bb0';
const OPERATION = 'scf-census-customer-retained-capture-e3e4-20261012';
const ORIGINAL = {
  editionId: '3afdc231-4506-4128-9ec3-b72f8a8acb56',
  batchId: '4ba028b7-c3df-480c-94b1-1f86b71ad88a',
  attemptId: '24fe46ba-10d6-4872-a307-f637425fbaac',
  reviewId: '9fa55794-35d9-453b-bb27-bbf47eb4c2d1',
  snapshot: '7480589a8f8244b12515f10432c00be2450586da163dd368a3417fca5330d877',
  responseSha256: '8f550e5b16e8f6922fce75b4bca661784b2c67c87f07c18f31304e4385331aad',
  responseBytes: 523, rows: 3, benchmark: '4', vintage: '4'
};
const P = 'stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/';
const M = 'stellar-forge/mcp-merchant-operator/';
const PINS = {
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/customer-intake.mjs": "80ea9ce282d1b53d58cd0ed8e5c7402a700c9759",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/customer-workflow.mjs": "b27fa286014e950d716b28a2470b94972fe475bf",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/workspace.mjs": "7a450869134457707a5b23193d3896a19e2a0978",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/edition.mjs": "93b260cad7be7644ce31de500fc20a2e8b8b699d",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/cli.mjs": "a9c6a600ac0dad4c6e1b02218b1e5be1e5cc97b2",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/index.mjs": "be89c769980de1bb73c809075439765721c7ff87",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/server.mjs": "3ab7109cb9e58e826337815b44836c059a53c0c5",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/public/customer-intake.mjs": "798c667f578e1f5e02f02f5e7b9f75976b9f071c",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/public/index.html": "8fc891d8b2900ec78e369dfcec4b63704c69e33d",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/public/app.mjs": "20d4a2adb1b48b8a3ebcd391c4a3ad3bf36deac2",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/public/style.css": "f2c0c5dd1c5f385711bc195e33f6656a3c589fa9",
  "stellar-forge/mcp-merchant-operator/census-geocoder-workspace.mjs": "712811e3316c9b332dfd9c05fe977f82e50139a3",
  "stellar-forge/mcp-merchant-operator/catalog/census-geocoder-workspace.mjs": "49ad1cbf0aa5e748bbb1d899feca9b0b849115cb",
  "stellar-forge/mcp-merchant-operator/census-geocoder-download.d.mts": "d98c62faca5531a6e575cb9e97fee9a20d8e2b54",
  "stellar-forge/mcp-merchant-operator/providers/census-geocoder-workspaces.mjs": "bacc169fca63847f4f2429ee27430ad173fbfb6b",
  "stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/recording.mjs": "951ccf84c81c4464e2de7f676287ae53f4c626e2",
  "stellar-forge/mcp-merchant-operator/config.mjs": "10b23ca6fb32bbc44721ebcbbead390072953128",
  "stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs": "ba207f66842f26d9ce65aa76c4c98cbcb43121fe",
  "stellar-forge/mcp-merchant-operator/serve.mjs": "3b01f62dc188f802e0aaecf9bd30dd1b5a89171d",
  "stellar-forge/mcp-merchant-operator/retained-download.mjs": "f204b2d032498e28dbab0f78620f17a888d8eea5",
  "stellar-forge/mcp-merchant-operator/census-geocoder-download.mjs": "3180903ecc3a83527f3388f493a90fdc019dea5f"
};
const hash = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(Buffer.from('blob ' + value.length + '\0')).update(value).digest('hex');
const stamp = () => new Date().toISOString();
const parse = args => {
  const allowed = new Set(['--source', '--edition', '--directory', '--playwright', '--browser']);
  if (args.includes('--help')) {
    process.stdout.write('Use Node 24 under the original native resource owner:\n' +
      '  node customer-retained-capture.mjs --source MERGED_SOURCE_ROOT --edition ORIGINAL_EDITION_DIRECTORY ' +
      '--directory PRIVATE_OPERATION_DIRECTORY --playwright EXISTING_PLAYWRIGHT_INDEX_MJS --browser EXISTING_CHROMIUM\n\n' +
      'The original edition is read by identity. The new customer workspace is separate; the retained paid continue4 record is untouched.\n' +
      'This program imports the original local recording, reviews mapping/corrections/exclusion, builds the native joined merchant edition,\n' +
      'receives every member over authenticated original MCP, exercises its saved-mapping browser, closes and reopens retained IDs.\n' +
      'A complete saved outcome is returned without another application or browser acquisition. A partial run reuses its same local IDs.\n');
    return null;
  }
  const value = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], item = args[index + 1];
    if (!allowed.has(key) || value[key] || !item || item.startsWith('--')) throw new Error('Use each required option once; see --help.');
    value[key] = resolve(item);
  }
  for (const key of allowed) if (!value[key]) throw new Error('Supply ' + key + '.');
  return value;
};
const options = parse(process.argv.slice(2));
if (options) await main(options);

async function main(options) {
  const sourceRoot = await realpath(options['--source']);
  const originalDirectory = await realpath(options['--edition']);
  const directory = options['--directory'];
  assert.equal(sourceRoot, options['--source'], 'Use the canonical selected source root.');
  assert.equal(originalDirectory, options['--edition'], 'Use the original canonical edition path.');
  assert.equal(originalDirectory.split('/').at(-1), ORIGINAL.editionId, 'Select the original retained edition UUID.');
  const originalWorkspace = dirname(dirname(originalDirectory));
  assert(directory !== originalWorkspace && !directory.startsWith(originalWorkspace + '/'),
    'Keep the new operation outside the entire retained original geocoder workspace.');
  for (const [path, sha] of Object.entries(PINS)) assert.equal(blob(await readFile(join(sourceRoot, path))), sha, 'Source differs: ' + path);
  const native = suffix => import(pathToFileURL(join(sourceRoot, suffix)).href);
  const files = await native('stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs');
  const { readGeocoderRecording } = await native(P + 'recording.mjs');
  const { reopenEdition, writeExact, reviewSelection } = await native(P + 'edition.mjs');
  const { csvLine } = await native('stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/plan.mjs');
  const { initializeCensusGeocoderWorkspaceMerchant, readMerchantConfig } = await native(M + 'config.mjs');
  const { startMerchantMcp } = await native(M + 'serve.mjs');
  const { openMerchantFileClient } = await native(M + 'retained-download.mjs');
  const receiving = await native(M + 'census-geocoder-download.mjs');
  const original = await reopenEdition(originalDirectory);
  assert.equal(original.batchId, ORIGINAL.batchId);
  assert.equal(original.attemptId, ORIGINAL.attemptId);
  assert.equal(original.reviewId, ORIGINAL.reviewId);
  assert.equal(original.dataset.snapshot, ORIGINAL.snapshot);
  const recordingDirectory = join(originalDirectory, 'source');
  const recording = await readGeocoderRecording(recordingDirectory);
  assert.equal(recording.parsed.responseSha256, ORIGINAL.responseSha256);
  assert.equal(recording.originals['response.csv'].length, ORIGINAL.responseBytes);
  assert.equal(recording.input.records.length, ORIGINAL.rows);
  assert.equal(recording.benchmark.id, ORIGINAL.benchmark);
  assert.equal(recording.vintage.id, ORIGINAL.vintage);
  assert(original.sellerPath, 'Use the original reviewed edition with its public merchant profile.');
  const seller = JSON.parse(await readFile(original.sellerPath, 'utf8'));
  assert.equal(seller.schema, 'stellar-forge.seller-service.v1');
  assert.equal(seller.routes.length, 1);
  const profile = { label: 'Original retained public merchant terms', origin: seller.publicOrigin,
    path: seller.routes[0].path, payment: seller.routes[0].definition.payment };
  const recordedRows = recording.input.records;
  assert.deepEqual(recordedRows.map(row => row[0]), ['1', '2', '3']);
  const header = ['business_id', 'street', 'city', 'state', 'zip', 'census_id', 'note', 'note', ''];
  // Deliberate local demonstration fields; all actual geocoding remains the original response.
  const rows = recordedRows.map((row, index) => [
    index < 2 ? 'demonstration-account-A' : 'demonstration-account-B',
    index === 1 ? '' : row[1], row[2], row[3], row[4], row[0],
    index === 0 ? 'Quoted "customer" note\nsecond line' : 'Local receiving demonstration',
    'duplicate-header position ' + (index + 1), 'blank-header value ' + (index + 1)
  ]);
  rows.push(['demonstration-excluded', '', '', '', '', '4', 'Explicitly excluded; no provider request for this row.', '', 'kept']);
  const customerBytes = Buffer.from('\uFEFF' + csvLine(header) + rows.map(row => csvLine(row)).join(''), 'utf8');
  const badPlan = { idMode: 'column', columns: { id: 0, street: 1, city: 2, state: 3, zip: 4, urbanization: null },
    outputPrefix: 'census_', corrections: [], exclusions: [] };
  const plan = { ...badPlan, columns: { ...badPlan.columns, id: 5 },
    corrections: [{ row: 2, values: { street: recordedRows[1][1] }, reason: 'Restore the exact original public address before binding.' }],
    exclusions: [{ row: 4, reason: 'This retained local business row is outside the original three-address submission.' }] };
  const reviewPlan = { name: 'Retained public addresses with customer reconciliation', defaultLimit: 2, maxLimit: 3,
    note: 'Original Census response; demonstration customer columns and explicit row decisions remain private.' };
  const selectedReview = reviewSelection(reviewPlan, recording.parsed);

  await files.privateDirectory(directory, true);
  assert.equal(await realpath(directory), directory, 'Use a canonical private operation directory.');
  const releaseOperation = await files.acquireWorkspace(directory);
  const checkpoint = join(directory, 'customer-run.json');
  const binding = { operation: OPERATION, sourceHead: SOURCE_HEAD, sourcePins: PINS, originalDirectory,
    originalEditionId: ORIGINAL.editionId, originalResponseSha256: ORIGINAL.responseSha256,
    recordingSha256: recording.recordingSha256, customerInputSha256: hash(customerBytes) };
  let result;
  try { result = await files.readJson(checkpoint, 4 * 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') { await releaseOperation(); throw error; } }
  if (result) {
    try { assert.deepEqual(result.binding, binding, 'Continue only this exact original capture/customer operation.'); }
    catch (error) { await releaseOperation(); throw error; }
    if (result.state === 'COMPLETED') { await releaseOperation(); process.stdout.write(JSON.stringify(result) + '\n'); return; }
  } else result = { schema: 'stellar-forge.census-customer-native-operation.v1', binding, startedAt: stamp(),
    state: 'PREPARING', phases: {}, retainedIds: {}, providerRequestsIssued: 0, buyerExecutions: 0 };
  const persist = async () => { result.updatedAt = stamp(); await files.atomicJson(directory, 'customer-run.json', result); };
  const originalFetch = globalThis.fetch;
  let nonLocalAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
      nonLocalAttempts++; throw new Error('This retained-receiving operation has no external request: ' + url.origin);
    }
    return originalFetch(input, init);
  };
  let host = null, hostOpening = null, browser = null, browserOpening = null, stopping = null, stopped = false;
  const controller = new AbortController(), children = new Set();
  const environment = { ...process.env, MCP_OAUTH_CONFIG: undefined, MCP_CLIENT_ORIGINS: '',
    CENSUS_CUSTOMER_ACCESS_TOKEN: randomBytes(32).toString('hex') };
  let client, opened, failure, finalizing = false, finalOutcome = null, disposal = null, operationReleased = false;
  const phase = async (name, value) => { result.phases[name] = { completedAt: stamp(), ...value }; await persist(); };
  const ensureRunning = () => controller.signal.throwIfAborted();
  const closeOwned = () => {
    if (stopping) return stopping;
    const current = (async () => {
      await Promise.allSettled([hostOpening, browserOpening].filter(Boolean));
      const closures = [];
      if (browser) { const owner = browser; closures.push(owner.close().then(() => { if (browser === owner) browser = null; })); }
      if (host) { const owner = host; closures.push(owner.close().then(() => { if (host === owner) host = null; })); }
      const outcomes = await Promise.allSettled(closures);
      await Promise.allSettled([...children].map(item => item.done));
      const errors = outcomes.filter(item => item.status === 'rejected').map(item => item.reason);
      if (errors.length) throw new AggregateError(errors, 'Original customer owners have not finished closing.');
    })();
    stopping = current;
    void current.catch(() => { if (stopping === current) stopping = null; });
    return current;
  };
  const finishDisposal = () => {
    if (disposal) return disposal;
    const task = (async () => {
      await closeOwned();
      result.ownersClosed = true;
      result.nonLocalAttempts = nonLocalAttempts;
      if (result.state === 'CLOSE_INCOMPLETE' && finalOutcome) result.state = finalOutcome;
      delete result.cleanupError;
      await persist();
      if (!operationReleased) { await releaseOperation(); operationReleased = true; }
      process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
      globalThis.fetch = originalFetch;
    })();
    disposal = task;
    void task.catch(() => { if (disposal === task) disposal = null; });
    return task;
  };
  const interrupt = signal => {
    stopped = true;
    controller.abort(Object.assign(new Error('Interrupted by ' + signal), { code: 'CUSTOMER_OPERATION_INTERRUPTED' }));
    for (const child of children) child.process?.kill('SIGTERM');
    void (finalizing ? finishDisposal() : closeOwned()).catch(() => {});
  };
  const sigint = () => interrupt('SIGINT'), sigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  const cli = async (script, args) => {
    ensureRunning();
    const owner = { process: null, done: null };
    owner.done = new Promise((done, reject) => {
      owner.process = execFile(process.execPath, [join(sourceRoot, script), ...args],
        { cwd: directory, env: environment, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => error ? reject(Object.assign(error, { nativeStderr: stderr })) : done(JSON.parse(stdout)));
    });
    children.add(owner);
    try { return await owner.done; } finally { children.delete(owner); }
  };
  const call = (suffix, args = {}) => { ensureRunning(); return client.call('merchant_census_geocoder_' + suffix, { workspace: 'customers', ...args }); };
  const customer = async (action, payload) => (await call('customer', { action, payload })).result;
  const geocoderDirectory = join(directory, 'geocoder');
  const merchantDirectory = join(directory, 'merchant');
  const connectionPath = join(directory, 'census-connection.json');
  const customerPath = join(directory, 'customer-input.csv');
  const downloadDirectory = join(directory, 'received-edition');
  const startHost = async () => {
    ensureRunning(); stopping = null;
    hostOpening = startMerchantMcp({ configPath: join(merchantDirectory, 'merchant-mcp.json'), port: 0,
      tokenEnv: 'CENSUS_CUSTOMER_ACCESS_TOKEN', environment }).then(value => { host = value; return value; });
    await hostOpening; hostOpening = null; ensureRunning();
    client = await openMerchantFileClient({ url: host.url + '/mcp', tokenEnv: 'CENSUS_CUSTOMER_ACCESS_TOKEN',
      environment, signal: controller.signal, errorPrefix: 'CENSUS_CUSTOMER', clientName: 'starforge-census-customer-receiving' });
    let exists = true;
    try { await lstat(join(geocoderDirectory, 'workspace.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    opened = await call('open', { create: !exists });
    if (result.retainedIds.workspaceId) assert.equal(opened.native.id, result.retainedIds.workspaceId);
    else { result.retainedIds.workspaceId = opened.native.id; await persist(); }
  };
  try {
    await persist(); ensureRunning();
    await files.privateDirectory(geocoderDirectory, true);
    await writeExact(customerPath, customerBytes);
    const connection = { schema: 'stellar-forge.census-geocoder-workspace-connection.v1', workspaces: {
      customers: { label: 'Retained Census customer receiving', directory: geocoderDirectory,
        imports: { customer: { kind: 'customer-addresses', file: customerPath, label: 'Public-address customer demonstration', header: true },
          original: { kind: 'recording', directory: recordingDirectory, label: 'Original completed Census capture' } },
        merchants: { original: profile }, buyerWorkspaces: {}, runtime: { port: 0 } }
    } };
    await writeExact(connectionPath, files.bytes(connection));
    // The same original initializer completes its bound config/store if startup
    // previously ended between mkdir and publication; no replacement directory.
    await initializeCensusGeocoderWorkspaceMerchant({ directory: merchantDirectory, connection: connectionPath,
      name: 'Census retained customer reconciliation', resume: true });
    await readMerchantConfig(join(merchantDirectory, 'merchant-mcp.json'));
    const configuredMerchant = JSON.parse(await readFile(join(merchantDirectory, 'merchant-mcp.json'), 'utf8'));
    assert.equal(configuredMerchant.censusGeocoderWorkspaceConnection, connectionPath);
    assert.deepEqual(configuredMerchant.sources, {});
    await startHost();
    await phase('originalCapture', { editionId: ORIGINAL.editionId, responseSha256: ORIGINAL.responseSha256,
      responseBytes: recording.originals['response.csv'].length, records: recording.input.records.length,
      benchmark: recording.benchmark.id, vintage: recording.vintage.id });
    const source = await customer('source', { sourceImport: 'customer' });
    assert.equal(source.inputSha256, hash(customerBytes));
    assert.equal(source.rowCount, 4);
    result.retainedIds.sourceId = source.id;
    const invalid = await customer('preview', { sourceId: source.id, plan: badPlan, limit: 20 });
    assert.equal(invalid.summary.ready, false);
    assert(invalid.summary.invalidRows > 0);
    const invalidMapping = await customer('mapping', { sourceId: source.id, plan: badPlan, expectedReviewSha256: invalid.reviewSha256 });
    assert.equal(invalidMapping.state, 'REVIEW_REQUIRED');
    const preview = await customer('preview', { sourceId: source.id, plan, limit: 20 });
    assert.equal(preview.summary.ready, true);
    assert.equal(preview.summary.originalRows, 4);
    assert.equal(preview.summary.includedRows, 3);
    assert.equal(preview.summary.excludedRows, 1);
    assert.equal(preview.summary.correctedRows, 1);
    const mapping = await customer('mapping', { sourceId: source.id, plan, expectedReviewSha256: preview.reviewSha256 });
    assert.equal(mapping.state, 'READY');
    result.retainedIds.mappingId = mapping.id;
    const imported = (await call('import', { sourceImport: 'original' })).result;
    assert.equal(imported.responseSha256, ORIGINAL.responseSha256);
    assert.equal(imported.attempt.state, 'COMPLETE');
    assert.equal(imported.total, 3);
    const bound = await customer('bind', { mappingId: mapping.id, batchId: imported.batch.id, expectedReviewSha256: preview.reviewSha256 });
    assert.equal(bound.state, 'COMPLETE');
    Object.assign(result.retainedIds, { batchId: imported.batch.id, attemptId: imported.attempt.id, bindingId: bound.id });
    await phase('customerMapping', { sourceId: source.id, invalidMappingId: invalidMapping.id, mappingId: mapping.id,
      bindingId: bound.id, summary: mapping.summary, sourceColumns: source.columns, reviewSha256: preview.reviewSha256 });
    const current = await call('status', { offset: 0, limit: 100 });
    const matches = current.native.reviews.filter(item => item.batchId === imported.batch.id &&
      item.attemptId === imported.attempt.id && item.responseSha256 === ORIGINAL.responseSha256 &&
      files.identity(item.plan) === files.identity(selectedReview.plan));
    let review = result.retainedIds.reviewId ? matches.find(item => item.id === result.retainedIds.reviewId) : matches[0];
    if (!review) review = (await call('review', { batchId: imported.batch.id, attemptId: imported.attempt.id,
      responseSha256: ORIGINAL.responseSha256, plan: reviewPlan })).result;
    result.retainedIds.reviewId = review.id; await persist();
    const edition = (await call('edition', { reviewId: review.id, mappingId: mapping.id, profile: 'original' })).result;
    assert.equal(edition.customer.mappingId, mapping.id);
    assert.equal(edition.customer.originalRows, 4);
    assert.equal(edition.customer.responseSha256, ORIGINAL.responseSha256);
    assert.equal(edition.dataset.rowCount, 3);
    assert(edition.sellerPath);
    const newSeller = JSON.parse(await readFile(edition.sellerPath, 'utf8'));
    assert.equal(newSeller.publicOrigin, profile.origin);
    assert.equal(newSeller.routes[0].path, profile.path);
    assert.deepEqual(newSeller.routes[0].definition.payment, profile.payment);
    result.retainedIds.editionId = edition.id;
    result.retainedIds.datasetSnapshot = edition.dataset.snapshot;
    await phase('nativeEdition', { editionId: edition.id, operationId: edition.operationId,
      dataset: edition.dataset, customer: edition.customer, sellerCompiled: true, sellerStarted: false });
    const remote = { client, workspace: 'customers', editionId: edition.id, expectedWorkspaceId: opened.native.id,
      signal: controller.signal };
    const inspection = await receiving.inspectCensusGeocoderEdition(remote);
    const downloaded = await receiving.downloadCensusGeocoderEdition({ ...remote, directory: downloadDirectory,
      chunkSize: 193, expectedManifestSha256: inspection.manifestSha256 });
    const originalCustomer = await readFile(join(downloadDirectory, 'source/customer-input.csv'));
    assert(originalCustomer.equals(customerBytes));
    const joined = JSON.parse(await readFile(join(downloadDirectory, 'customer-results.json'), 'utf8'));
    assert.deepEqual(joined.originalHeader, header);
    assert.deepEqual(joined.rows.map(item => item.original), rows);
    assert.deepEqual(joined.rows.map(item => item.sourceRow), [1, 2, 3, 4]);
    const actualById = new Map(recording.parsed.rows.map(row => [row.record_id, row]));
    for (let index = 0; index < 3; index++) assert.deepEqual(joined.rows[index].result, actualById.get(recordedRows[index][0]));
    assert.equal(joined.rows[1].original[1], '');
    assert.equal(joined.rows[1].submittedAddress.street, recordedRows[1][1]);
    assert.equal(joined.rows[3].submission, 'EXCLUDED');
    assert.equal(joined.rows[3].result, null);
    const publicPage = (await call('query', { id: edition.id, query: 'limit=2' })).result;
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.body.page.total, 3);
    assert(publicPage.body.rows.every(row => !Object.hasOwn(row, 'business_id') && !Object.hasOwn(row, 'note')));
    await phase('completeReceiver', { editionId: downloaded.editionId, workspaceId: downloaded.workspaceId,
      manifestSha256: downloaded.manifestSha256, files: downloaded.files, bytes: downloaded.bytes,
      originalCustomerSha256: hash(originalCustomer), receivedDirectory: downloaded.directory,
      joinedRows: joined.rows.length, publicQueryRows: publicPage.body.page.returned });

    if (!result.phases.browser) {
      ensureRunning();
      const binding = await call('browser', { action: 'open', port: 0 });
      const { chromium } = await import(pathToFileURL(options['--playwright']).href);
      assert((await lstat(options['--browser'])).isFile());
      ensureRunning(); // No await between cancellation admission and registering the owned launch.
      browserOpening = chromium.launch({ executablePath: options['--browser'], headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] }).then(value => { browser = value; return value; });
      await browserOpening; browserOpening = null; ensureRunning();
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(binding.url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#connection')?.textContent === 'Local workspace · saved state');
      await page.locator('nav [data-panel="customer"]').click();
      await page.locator('#customer-source').selectOption(source.id);
      await page.locator('#customer-mapping').selectOption(mapping.id);
      await page.locator('#customer-reopen-mapping').click();
      await page.waitForFunction(id => document.querySelector('#customer-plan-note')?.textContent.includes('Reopened exact saved mapping ' + id), mapping.id);
      assert.equal(await page.locator('#customer-column-id').inputValue(), '5');
      assert.equal(await page.locator('#customer-rows tr').count(), 4);
      assert((await page.locator('#customer-rows').innerText()).includes('EXCLUDED'));
      await page.locator('#customer-filter').selectOption('corrected');
      await page.waitForFunction(() => document.querySelectorAll('#customer-rows tr').length === 1);
      assert((await page.locator('#customer-rows').innerText()).includes('Corrected: street'));
      await page.locator('#customer-filter').selectOption('all');
      await page.waitForFunction(() => document.querySelectorAll('#customer-rows tr').length === 4);
      const originalDownload = page.waitForEvent('download');
      await page.locator('#customer-download-input').click();
      const originalStream = await (await originalDownload).createReadStream();
      const chunks = []; for await (const chunk of originalStream) chunks.push(chunk);
      assert(Buffer.concat(chunks).equals(customerBytes));
      await page.locator('nav [data-panel="editions"]').click();
      await page.locator('#edition-selection').selectOption(edition.id);
      const customerDownload = page.waitForEvent('download');
      await page.locator('#download-customer-results-json').click();
      const stream = await (await customerDownload).createReadStream();
      const joinedChunks = []; for await (const chunk of stream) joinedChunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(joinedChunks).toString('utf8')), joined);
      await page.screenshot({ path: join(directory, 'customer-edition-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('nav [data-panel="customer"]').click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: join(directory, 'customer-mapping-mobile.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await browser.close(); browser = null;
      await call('browser', { action: 'close' });
      await phase('browser', { savedMappingReopened: true, originalDownloadMatched: true,
        customerDownloadMatched: true, mobileOverflow: false, pageErrors: errors, browserClosed: true });
    }
    await call('close', { instanceId: opened.instanceId });
    await host.close(); host = null; stopping = null;
    const nativeStatus = await cli(P + 'cli.mjs', ['--workspace', geocoderDirectory, 'status']);
    assert.equal(nativeStatus.id, result.retainedIds.workspaceId);
    assert(nativeStatus.editions.some(item => item.id === edition.id && item.state === 'COMPLETE'));
    const local = await cli(M + 'census-geocoder-download-cli.mjs', ['query', '--dir', downloadDirectory,
      '--workspace-id', result.retainedIds.workspaceId, '--edition', edition.id,
      '--manifest-sha256', inspection.manifestSha256, '--query', 'limit=2']);
    assert.equal(local.response.status, 200);
    assert.equal(local.response.body.page.total, 3);
    await startHost();
    const reopenedSource = await customer('inspect', { sourceId: source.id });
    const reopenedMapping = await customer('inspect', { mappingId: mapping.id, limit: 20 });
    assert.equal(reopenedSource.source.inputSha256, hash(customerBytes));
    assert.equal(reopenedMapping.mapping.reviewSha256, preview.reviewSha256);
    const again = await receiving.downloadCensusGeocoderEdition({ client, workspace: 'customers', editionId: edition.id,
      expectedWorkspaceId: result.retainedIds.workspaceId, expectedManifestSha256: inspection.manifestSha256,
      directory: downloadDirectory, chunkSize: 193, signal: controller.signal });
    assert.equal(again.manifestSha256, inspection.manifestSha256);
    assert.equal(again.edition.customer.bindingSha256, edition.customer.bindingSha256);
    const reopenedLocal = await receiving.reopenCensusGeocoderDownload({ directory: downloadDirectory,
      expectedWorkspaceId: result.retainedIds.workspaceId, expectedEditionId: edition.id,
      expectedManifestSha256: inspection.manifestSha256, signal: controller.signal });
    assert.equal(reopenedLocal.edition.dataset.snapshot, edition.dataset.snapshot);
    await phase('reopen', { sameWorkspaceId: opened.native.id, sameEditionId: again.editionId,
      sameManifestSha256: again.manifestSha256, sameCustomerBindingSha256: again.edition.customer.bindingSha256,
      nativeCliStatus: 'COMPLETE', receivingCliQuery: 'COMPLETE', localReopen: 'COMPLETE', reusedReceiver: again.resumed });
    assert.equal(nonLocalAttempts, 0);
    ensureRunning(); result.state = 'COMPLETED'; result.completedAt = stamp();
  } catch (error) {
    failure = error;
    result.state = stopped ? 'INTERRUPTED' : 'INCOMPLETE';
    result.error = { code: error.code ?? 'CUSTOMER_RECEIVING_FAILED', message: error.message };
  } finally {
    finalizing = true; finalOutcome = result.state;
    try { await finishDisposal(); }
    catch (error) {
      result.ownersClosed = false;
      result.state = 'CLOSE_INCOMPLETE';
      result.cleanupError = { code: error.code ?? 'CUSTOMER_CLOSE_FAILED', message: error.message };
      try { await persist(); } catch {}
      failure ??= error;
      // The exact live native handles and persistent signal path remain owned.
      // Do not turn failed disposal into an uncaught exception that exits the parent.
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (failure) process.exitCode = 1;
}
