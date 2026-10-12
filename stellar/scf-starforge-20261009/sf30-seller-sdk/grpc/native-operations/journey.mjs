#!/usr/bin/env node
// MIT. One retained-record customer continuation over the installed original gRPC product.
import { mkdir, readFile, writeFile, open, readdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const SCHEMA = 'stellar-forge.grpc-operations-native-receiving.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => canonical(left) === canonical(right);
const stamp = () => new Date().toISOString();
const need = (condition, message) => { if (!condition) throw new Error(message); };
const pause = ms => new Promise(done => setTimeout(done, ms));

function argumentsOf(values) {
  const options = {};
  for (let i = 0; i < values.length; i++) {
    const name = values[i];
    need(['--work', '--workspace', '--source-root', '--source-commit', '--original-run', '--chromium', '--playwright-modules'].includes(name) &&
      !Object.hasOwn(options, name) && values[i + 1] && !values[i + 1].startsWith('--'), 'Select each original receiving argument once.');
    options[name] = values[++i];
  }
  for (const name of ['--work', '--workspace', '--source-root', '--source-commit', '--chromium']) need(options[name], 'Supply ' + name + '.');
  need(/^[a-f0-9]{40}$/.test(options['--source-commit']), 'Select the exact installed source commit.');
  return { work: resolve(options['--work']), workspace: resolve(options['--workspace']),
    sourceRoot: resolve(options['--source-root']), sourceCommit: options['--source-commit'],
    originalRun: options['--original-run'] ? resolve(options['--original-run']) : null,
    chromium: resolve(options['--chromium']),
    playwrightModules: options['--playwright-modules'] ?? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES };
}
async function atomic(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function filesAt(directory) {
  const files = [];
  async function visit(root, relative = '') {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
      need(!entry.isSymbolicLink(), 'Keep original call records as their native files.');
      if (entry.isDirectory()) await visit(path, name);
      else {
        need(entry.isFile(), 'Keep regular original call records.');
        const bytes = await readFile(path);
        files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function valueOf(result) {
  const pending = [result], seen = new Set();
  while (pending.length) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.isError) throw new Error(value.content?.find(item => item.type === 'text')?.text ?? 'Original merchant tool failed.');
    if (typeof value.schema === 'string' || value.case && value.revision || Array.isArray(value.items) ||
      typeof value.exportId === 'string' || typeof value.captureSha256 === 'string') return value;
    for (const key of ['structuredContent', 'result', 'delivery']) if (value[key] && typeof value[key] === 'object') pending.push(value[key]);
    for (const item of value.content ?? []) if (item.type === 'text') {
      try { pending.push(JSON.parse(item.text)); } catch {}
    }
  }
  throw new Error('The original merchant returned no complete structured result.');
}

export async function main(argv = process.argv.slice(2)) {
  const input = argumentsOf(argv), P = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
  need(input.work !== input.workspace && !input.workspace.startsWith(input.work + '/') &&
    !input.work.startsWith(input.workspace + '/'),
    'Keep the receiving journal outside the original workspace.');
  for (const path of [input.workspace, input.sourceRoot]) need(await realpath(path) === path, 'Use the original real source and workspace path.');
  await mkdir(input.work, { recursive: true, mode: 0o700 });
  need(await realpath(input.work) === input.work, 'Use the actual private receiving directory without parent aliases.');
  const info = await lstat(input.work);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077), 'Use the same private receiving directory.');
  const moduleAt = path => import(pathToFileURL(join(input.sourceRoot, path)).href);
  const { acquireStateLease } = await moduleAt('stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs');
  const lease = await acquireStateLease(input.work);
  try {
  const journalPath = join(input.work, 'journey.json');
  let journal = await optionalJson(journalPath), product, nativeClient, merchant, cold, coldClient, browser, page;
  const tokenEnv = 'SCF_GRPC_OPERATIONS_RECEIVING_TOKEN';
  const environment = { ...process.env, [tokenEnv]: process.env[tokenEnv] || randomBytes(32).toString('hex') };
  const binding = { work: input.work, workspace: input.workspace, sourceRoot: input.sourceRoot, originalRun: input.originalRun };
  if (!journal) journal = { schema: SCHEMA, id: randomUUID(), state: 'STARTED', startedAt: stamp(), input: binding,
    sourceEditions: [], phases: [], intents: {}, refs: {}, sessions: [] };
  need(journal.schema === SCHEMA && UUID.test(journal.id) && same(journal.input, binding), 'Continue this original receiving directory and its saved inputs.');
  const save = async () => { lease.assertHeld(); await atomic(journalPath, Buffer.from(JSON.stringify(journal, null, 2) + '\n')); };
  const intent = async (name, build) => {
    if (!journal.intents[name]) { journal.intents[name] = await build(); await save(); }
    return structuredClone(journal.intents[name]);
  };
  const phase = async (name, work) => {
    const old = journal.phases.find(value => value.name === name && value.state === 'COMPLETE');
    if (old) return old.result;
    let row = journal.phases.find(value => value.name === name);
    if (!row) { row = { name, state: 'STARTED', startedAt: stamp() }; journal.phases.push(row); }
    journal.state = 'STARTED'; delete journal.error; await save();
    const result = await work(); row.state = 'COMPLETE'; row.completedAt = stamp(); row.result = result; await save();
    process.stdout.write(JSON.stringify({ phase: name, state: 'COMPLETE', result }) + '\n');
    return result;
  };
  const remember = async (key, value) => {
    if (journal.refs[key] !== undefined) need(same(journal.refs[key], value), 'The retained original ' + key + ' changed.');
    else { journal.refs[key] = value; await save(); }
    return journal.refs[key];
  };
  async function stopBrowser() {
    if (!browser) return;
    const selected = browser;
    try { await selected.close(); browser = null; page = null; }
    catch (error) { throw Object.assign(error, { receivingResource: 'browser' }); }
  }
  async function closeAll() {
    const results = await Promise.allSettled([
      stopBrowser(),
      nativeClient ? nativeClient.close().then(() => { nativeClient = null; }) : Promise.resolve(),
      coldClient ? coldClient.close().then(() => { coldClient = null; }) : Promise.resolve(),
    ]);
    // Always reach every original native owner even when an earlier close failed.
    if (cold) {
      try { await cold.close(); cold = null; } catch (error) { results.push({ status: 'rejected', reason: error }); }
    }
    if (product) {
      try { await product.close(); product = null; merchant = null; } catch (error) { results.push({ status: 'rejected', reason: error }); }
    }
    const errors = results.filter(value => value.status === 'rejected').map(value => value.reason);
    if (errors.length) throw new AggregateError(errors, 'Continue closure of the original receiving resources.');
  }
  const session = { startedAt: stamp(), sourceCommit: input.sourceCommit, state: 'STARTED' };
  try {
    if (journal.state === 'COMPLETE') { process.stdout.write(JSON.stringify(journal) + '\n'); return journal; }
    journal.sessions.push(session);
    if (!journal.sourceEditions.some(value => value.commit === input.sourceCommit)) journal.sourceEditions.push({ commit: input.sourceCommit, selectedAt: stamp() });
    await save();
    const [{ initializeGrpcProduct, openGrpcProduct }, { GrpcProductClient, inspectReceivedGrpcProduct },
      { createGrpcOperationsClient }, receiving, { startGrpcWorkspace }] = await Promise.all([
      moduleAt('products/grpc-merchant/workspace.mjs'), moduleAt('products/grpc-merchant/client.mjs'),
      moduleAt(P + 'operations/client.mjs'), moduleAt(P + 'operations/receiving.mjs'),
      moduleAt(P + 'workspace/server.mjs'),
    ]);
    await phase('original-retained-records', async () => {
      const files = await filesAt(join(input.workspace, 'attempts'));
      const calls = [];
      for (const file of files.filter(value => value.path.endsWith('.json') && UUID.test(value.path.slice(0, -5)))) {
        const value = JSON.parse(await readFile(join(input.workspace, 'attempts', file.path), 'utf8'));
        calls.push({ id: value.id, revision: value.revision, method: value.method, phase: value.phase });
      }
      need(calls.length > 0 && calls.every(value => UUID.test(value.id)), 'Select an original workspace with retained native calls.');
      let originalRun = null;
      if (input.originalRun) {
        const bytes = await readFile(input.originalRun), value = JSON.parse(bytes.toString('utf8'));
        originalRun = { path: input.originalRun, bytes: bytes.length, sha256: digest(bytes), runId: value.runId ?? value.id ?? null };
      }
      await remember('originalCalls', { files, calls: calls.sort((a, b) => a.id.localeCompare(b.id)), sha256: digest(canonical(files)), originalRun });
      return { calls: calls.length, retainedFiles: files.length, originalCallFilesSha256: digest(canonical(files)), originalRun };
    });
    need(same(await filesAt(join(input.workspace, 'attempts')), journal.refs.originalCalls.files),
      'Original call records changed after the first receiving observation. Reconcile that original source before continuing.');
    const productDirectory = join(input.work, 'product');
    await initializeGrpcProduct({ directory: productDirectory, workspaceDirectory: input.workspace,
      workspace: 'operations', name: 'Retained gRPC operations' });
    product = await openGrpcProduct({ directory: productDirectory, port: 0, workspacePort: 0, sellerPort: 0,
      operationsPort: 0, tokenEnv }, { environment });
    nativeClient = createGrpcOperationsClient({ url: product.browserUrl });
    merchant = new GrpcProductClient({ directory: productDirectory, environment });
    const ready = await merchant.ready();
    await remember('productIdentity', { productId: ready.productId, workspace: ready.workspace,
      operatorWorkspaceId: ready.operatorWorkspaceId });
    session.nativeInstanceId = ready.nativeInstanceId; session.operatorWorkspaceId = ready.operatorWorkspaceId; await save();
    const native = (action, body) => nativeClient.request(action, body);
    async function pages(section, captureId) {
      const rows = []; let offset = 0, snapshot;
      for (;;) {
        const page = await native('read', { id: captureId, section, offset, limit: 2,
          ...(snapshot ? { expectedSnapshot: snapshot } : {}) });
        snapshot ??= page.snapshot; need(page.snapshot === snapshot && page.offset === offset, 'Retain the original complete page sequence.');
        rows.push(...page.items);
        if (page.nextOffset === null) { need(rows.length === page.total, 'Read every row in the original immutable selection.'); return { rows, total: page.total, snapshot }; }
        offset = page.nextOffset;
      }
    }
    await phase('immutable-capture-and-complete-pages', async () => {
      const request = await intent('capture', () => ({ id: randomUUID(), selection: { includeHealth: true } }));
      const captured = await native('capture', request);
      const replay = await native('capture', request);
      need(same(captured, replay), 'The original capture retry must return the first completed capture.');
      const records = {};
      for (const section of ['calls', 'health', 'timeline', 'methods', 'revisions']) {
        const value = await pages(section, captured.id);
        records[section] = { total: value.total, snapshot: value.snapshot };
        if (section === 'calls') need(same(value.rows.map(row => row.id).sort(), journal.refs.originalCalls.calls.map(row => row.id).sort()),
          'Capture every selected original call without adding a native operation.');
      }
      await remember('capture', captured);
      return { captureId: captured.id, captureSha256: captured.captureSha256, attempts: captured.attempts,
        outcomes: captured.outcomes, healthObservations: captured.healthObservations, tables: records };
    });
    await phase('reviewed-incident-and-stable-actions', async () => {
      const capture = journal.refs.capture, calls = journal.refs.originalCalls.calls;
      const first = await intent('incident-draft', () => ({ operationId: randomUUID(), caseId: randomUUID(),
        captureId: capture.id, expectedVersion: 0, edit: { title: 'Review of retained native gRPC call outcomes',
          severity: 'medium', state: 'investigating',
          summary: 'Review the original native call sequence and its saved terminal outcomes.',
          impact: 'The operator needs each original outcome and complete returned record when deciding how to continue.',
          findings: 'The case links the original captured calls and preserves their source revisions for review.',
          review: { state: 'draft', reviewer: 'SCF operations', note: '' },
          links: calls.map(value => ({ kind: 'call', id: value.id })),
          actions: [{ id: randomUUID(), title: 'Read the original terminal outcome and complete retained records',
            owner: 'SCF operations', state: 'in-progress', dueAt: null,
            note: 'Use the immutable capture and original operation IDs.' }] } }));
      const original = valueOf(await merchant.saveIncident(first));
      need(original.revision?.version === 1 && original.case.id === first.caseId, 'Save the first original incident revision.');
      const repeated = valueOf(await merchant.saveIncident(first));
      need(repeated.revision.sha256 === original.revision.sha256, 'Reuse the original saved incident operation.');
      for (const call of calls) {
        const detail = await native('read', { id: capture.id, section: 'call', recordId: call.id });
        need(detail.record.id === call.id, 'Read the original complete captured call.');
      }
      const second = await intent('incident-reviewed', () => ({ operationId: randomUUID(), caseId: first.caseId,
        captureId: capture.id, expectedVersion: 1, edit: { ...first.edit, state: 'monitoring',
          findings: 'The full original records were opened by their saved IDs. Recorded timing and native terminal outcomes remain attached to each source revision.',
          review: { state: 'reviewed', reviewer: 'SCF operations',
            note: 'Reviewed the actual retained original calls and the complete capture tables.' },
          actions: first.edit.actions.map(value => ({ ...value, state: 'completed',
            note: 'Each original captured record was read in full during this receiving.' })) } }));
      const reviewed = valueOf(await merchant.saveIncident(second));
      const historical = valueOf(await merchant.incident(first.caseId, 1));
      need(reviewed.revision.version === 2 && historical.revision.version === 1 &&
        reviewed.revision.edit.actions[0].id === historical.revision.edit.actions[0].id &&
        historical.currentVersion === 2, 'Retain the original action identity and both reviewed revisions.');
      await remember('caseId', first.caseId);
      await remember('reviewed', { version: reviewed.revision.version, sha256: reviewed.revision.sha256 });
      return { caseId: first.caseId, version: 2, sha256: reviewed.revision.sha256,
        actionId: reviewed.revision.edit.actions[0].id, historicalVersion: historical.revision.version };
    });
    await phase('native-five-file-receiving-and-cli', async () => {
      if (!journal.refs.nativeExport) await remember('nativeExport', await native('export', { id: journal.refs.caseId, version: 2 }));
      const directory = join(input.work, 'native-received-v2');
      const received = await receiving.receiveGrpcOperationsDownload(nativeClient, journal.refs.nativeExport, directory);
      const repeated = await receiving.receiveGrpcOperationsDownload(nativeClient, journal.refs.nativeExport, directory);
      need(same(received, repeated) && received.files.length === 5, 'Continue all five original native files in the same directory.');
      const { main: productMain } = await moduleAt('products/grpc-merchant/cli.mjs');
      const viaCli = await productMain(['operations', 'case', '--dir', productDirectory, '--case', journal.refs.caseId, '--version', '1']);
      const offline = await productMain(['operations', 'inspect', '--directory', directory]);
      need(viaCli.revision.version === 1 && offline.exportSha256 === journal.refs.nativeExport.exportSha256,
        'Use the installed forwarder and offline native receiving over the original files.');
      return { directory, exportSha256: received.exportSha256, files: received.files, incident: received.incident };
    });
    await phase('merchant-complete-file-transport', async () => {
      if (!journal.refs.merchantExport) {
        const exported = valueOf(await merchant.exportIncident({ caseId: journal.refs.caseId, version: 2 }));
        need(SHA.test(exported.exportId), 'Retain the original merchant export identity.');
        const inspected = await merchant.inspectExport(exported.exportId);
        await remember('merchantExport', { exportId: exported.exportId, manifestSha256: inspected.manifestSha256 });
      }
      const original = journal.refs.merchantExport, directory = join(input.work, 'merchant-received-v2');
      const received = await merchant.receive({ exportId: original.exportId, expectedManifestSha256: original.manifestSha256, directory });
      const repeated = await merchant.receive({ exportId: original.exportId, expectedManifestSha256: original.manifestSha256, directory });
      const offline = await inspectReceivedGrpcProduct(directory, { expectedExportId: original.exportId, expectedManifestSha256: original.manifestSha256 });
      need(received.operations.incident.sha256 === journal.refs.reviewed.sha256 &&
        repeated.operations.incident.sha256 === received.operations.incident.sha256 &&
        offline.kind === 'operations' && offline.files.length === 5,
        'Receive and reopen the same original complete merchant incident.');
      return { directory, exportId: original.exportId, manifestSha256: original.manifestSha256,
        files: offline.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), original: offline.original };
    });
    async function openCold() {
      if (cold) return;
      const directory = join(input.work, 'customer-workspace');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      cold = await startGrpcWorkspace({ stateDirectory: directory, port: 0, env: environment });
      coldClient = createGrpcOperationsClient({ url: cold.url });
    }
    await phase('cold-native-history-receive-and-reexport', async () => {
      await openCold();
      const bundle = await receiving.readGrpcOperationsBundle(join(input.work, 'native-received-v2', 'grpc-operations.json'));
      const request = await intent('cold-receive-v2', () => ({ operationId: randomUUID(), exportSha256: bundle.exportSha256 }));
      const received = await coldClient.request('receive', { operationId: request.operationId, bundle });
      const read = await coldClient.request('case', { id: journal.refs.caseId });
      const exported = await coldClient.request('export', { id: journal.refs.caseId, version: 2 });
      need(read.history.length === 2 && exported.exportSha256 === journal.refs.nativeExport.exportSha256 &&
        same(exported.files, journal.refs.nativeExport.files), 'Cold receiving preserves the complete original history and export bytes.');
      const local = await receiving.receiveGrpcOperationsDownload(coldClient, exported, join(input.work, 'customer-reexport-v2'));
      await coldClient.close(); coldClient = null; await cold.close(); cold = null;
      await openCold();
      const reopened = await coldClient.request('case', { id: journal.refs.caseId });
      need(reopened.revision.sha256 === read.revision.sha256, 'The original received customer history survives owner close and reopen.');
      return { received, history: reopened.history, exportSha256: local.exportSha256, files: local.files };
    });
    async function openBrowser() {
      if (browser) return;
      need(input.playwrightModules, 'Select the installed original Playwright module tree.');
      const runtime = createRequire(resolve(input.playwrightModules) + '/');
      const { chromium } = runtime('playwright');
      need((await lstat(input.chromium)).isFile(), 'Use the existing native Chromium executable.');
      browser = await chromium.launch({ executablePath: input.chromium, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
      page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
      page.on('dialog', dialog => dialog.accept().catch(() => {}));
    }
    async function nativePage() {
      await openBrowser();
      await page.goto(product.browserUrl, { waitUntil: 'networkidle' });
      await page.locator('[data-view="operations"]').click();
      await page.locator('[data-operations="refresh"]').click();
      await page.locator('[data-operations="cases"] [data-original-id="' + journal.refs.caseId + '"]').click();
      await page.locator('#grpc-ops-title').waitFor({ state: 'visible' });
    }
    await phase('native-browser-original-save-continuation', async () => {
      await nativePage();
      const before = await native('case', { id: journal.refs.caseId });
      if (!journal.refs.browserSaveIntent) {
        need(before.currentVersion === 2, 'Resume the original browser review from its retained second revision.');
        await page.locator('#grpc-ops-findings').fill(before.revision.edit.findings +
          '\nThe native browser opened the same saved incident and its original source cohorts.');
        let intercepted;
        await page.route('**/api/operations-save', async route => {
          const body = route.request().postDataJSON();
          if (body.id !== journal.refs.caseId || intercepted) { await route.continue(); return; }
          intercepted = (async () => {
            await remember('browserSaveIntent', { body, signature: JSON.stringify({ id: body.id, captureId: body.captureId,
              expectedVersion: body.expectedVersion, edit: body.edit }) });
            const response = await route.fetch();
            const result = await response.json();
            need(response.ok() && result.revision?.version === body.expectedVersion + 1, 'Retain the original native save before losing its reply.');
            await remember('browserSaveResult', { version: result.revision.version, sha256: result.revision.sha256 });
            await route.abort('failed');
          })();
          try { await intercepted; } catch (error) { try { await route.abort('failed'); } catch {} throw error; }
        });
        await page.locator('[data-operations="save"]').click();
        for (let i = 0; !intercepted && i < 100; i++) await pause(50);
        need(intercepted, 'The browser must submit its original incident save.');
        await intercepted;
        await page.unroute('**/api/operations-save');
      }
      // Rehydrate only the exact intent captured before the real request. This also
      // permits the same phase to continue after a lost browser process.
      const original = journal.refs.browserSaveIntent;
      await page.evaluate(({ workspace, intent }) => {
        const key = 'stellar-forge.grpc-workspace:' + location.origin + ':operations:' + workspace + ':save';
        sessionStorage.setItem(key, JSON.stringify(intent));
      }, { workspace: input.workspace, intent: original });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-view="operations"]').click();
      const pending = page.locator('[data-operations="pendingOperations"]');
      await pending.getByRole('button', { name: 'Continue saved incident save', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-operations="pendingOperations"]')?.textContent.includes('Saved save operation'));
      const recovered = await native('case', { id: journal.refs.caseId });
      need(recovered.currentVersion === original.body.expectedVersion + 1 &&
        recovered.revision.operationId === original.body.operationId &&
        (!journal.refs.browserSaveResult || recovered.revision.sha256 === journal.refs.browserSaveResult.sha256),
        'Recover the first browser save without creating another incident revision.');
      await remember('browserSaved', { version: recovered.currentVersion, sha256: recovered.revision.sha256 });
      await page.locator('#grpc-ops-section').selectOption('methods');
      await page.waitForFunction(() => !document.querySelector('#view-operations').inert && document.querySelector('#grpc-ops-section').value === 'methods');
      await page.locator('[data-operations="rowCount"]').waitFor({ state: 'visible' });
      await page.screenshot({ path: join(input.work, 'native-operations-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-operations="caseIdentity"]').scrollIntoViewIfNeeded();
      need(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Keep the actual incident editor within the mobile viewport.');
      await page.screenshot({ path: join(input.work, 'native-operations-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1050 });
      return { caseId: journal.refs.caseId, originalOperationId: original.body.operationId,
        version: recovered.currentVersion, sha256: recovered.revision.sha256,
        screenshots: ['native-operations-desktop.png', 'native-operations-mobile.png'] };
    });
    const consoleApi = async (path, options = {}) => {
      const response = await fetch(new URL('/operator/api/' + path, product.operatorUrl), {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: { authorization: 'Bearer ' + environment[tokenEnv],
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
      if (!response.ok) throw new Error('Original Console returned HTTP ' + response.status + ': ' + await response.text());
      return options.raw ? response : response.json();
    };
    await phase('merchant-console-editor-and-complete-customer', async () => {
      await openBrowser(); await page.goto(product.operatorUrl, { waitUntil: 'networkidle' });
      await page.locator('#access-token').fill(environment[tokenEnv]);
      await page.locator('#connect-form button[type="submit"]').click();
      await page.locator('#connected').waitFor({ state: 'visible' });
      const name = 'Operations receiving ' + journal.id;
      let profile = (await consoleApi('profiles')).profiles.find(value => value.name === name);
      if (!profile) {
        await page.locator('#new-profile').click(); await page.locator('#profile-name').fill(name);
        await page.locator('#profile-form button[type="submit"]').click();
        await page.waitForFunction(name => [...document.querySelector('#profiles').options].some(value => value.textContent.startsWith(name)), name);
        profile = (await consoleApi('profiles')).profiles.find(value => value.name === name);
      }
      need(profile, 'Keep the original saved Console profile.');
      await page.locator('#profiles').selectOption(profile.id);
      const profileState = await consoleApi('profile/' + profile.id);
      if (!profileState.hostBound || profileState.compositionBound === false) {
        await page.locator('#review-host').click();
        const review = await consoleApi('host-review/' + profile.id);
        session.consoleBindingReview = { profileId: profile.id, revision: review.profile.revision,
          contentSha256: review.contentSha256, before: review.before.configurationFingerprint,
          after: review.after.configurationFingerprint }; await save();
        await page.locator('#adopt-host-snapshot').click();
        for (let i = 0; i < 100; i++) {
          const selected = await consoleApi('profile/' + profile.id);
          if (selected.hostBound && selected.compositionBound !== false) { profile = selected.profile; break; }
          await pause(100);
        }
        const selected = await consoleApi('profile/' + profile.id);
        need(selected.hostBound && selected.compositionBound !== false, 'Retain the reviewed current host in the same original profile.');
      }
      await page.locator('[data-page="customers"]').click();
      await page.locator('#grpc-workspaces').click();
      await page.waitForFunction(() => [...document.querySelector('#grpc-workspace').options].some(value => value.value === 'operations'));
      await page.locator('#grpc-workspace').selectOption('operations');
      await page.locator('#grpc-status').click();
      await page.locator('[data-operations="refresh"]').click();
      await page.locator('[data-operations="cases"] [data-original-id="' + journal.refs.caseId + '"]').click();
      need(await page.locator('#grpc-ops-title').inputValue() === 'Review of retained native gRPC call outcomes',
        'Open the same original reviewed incident in Merchant Console.');
      await page.locator('#grpc-ops-section').selectOption('calls');
      await page.locator('#grpc-ops-search').fill(journal.refs.originalCalls.calls[0].method);
      await page.locator('[data-operations="filter"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-operations="heading"]').parentElement.inert && document.querySelector('[data-operations="table"] tbody tr'));
      await page.screenshot({ path: join(input.work, 'merchant-console-operations-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-operations="caseIdentity"]').scrollIntoViewIfNeeded();
      need(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Keep the original Console workbench inside the mobile viewport.');
      await page.screenshot({ path: join(input.work, 'merchant-console-operations-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1050 });
      if (!journal.refs.consoleExportIntent) await remember('consoleExportIntent',
        { profileId: profile.id, caseId: journal.refs.caseId, version: journal.refs.browserSaved.version });
      const exportSelection = journal.refs.consoleExportIntent;
      need(exportSelection.profileId === profile.id && exportSelection.caseId === journal.refs.caseId &&
        exportSelection.version === journal.refs.browserSaved.version, 'Continue the selected original Console incident revision.');
      if (!journal.refs.consoleExport) {
        // A completed original Store call survives loss of the browser response
        // and of this journal's next checkpoint. Reuse its first saved result.
        const saved = await consoleApi('profile/' + profile.id);
        const matching = saved.calls.filter(call => call.tool === 'merchant_grpc_operations_export' &&
          same(JSON.parse(call.argumentsJson), { workspace: 'operations', caseId: exportSelection.caseId,
            version: exportSelection.version })).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
        for (const selected of matching) {
          const call = await consoleApi('call/' + selected.id);
          if (call.state !== 'COMPLETE' || !call.resultJson) continue;
          const returned = valueOf(JSON.parse(call.resultJson));
          need(SHA.test(returned.exportId), 'The saved original Console export must retain its native identity.');
          const manifest = await merchant.inspectExport(returned.exportId);
          await remember('consoleExportCall', { id: call.id, requestSha256: call.requestSha256, resultSha256: call.resultSha256 });
          await remember('consoleExport', { exportId: returned.exportId, manifestSha256: manifest.manifestSha256 });
          break;
        }
      }
      if (!journal.refs.consoleExport) {
        // The existing Console owns the saved draft, native tool call, manifest
        // selection and receiving. The displayed action follows that same chain.
        await page.locator('[data-operations="export"]').click();
        for (let i = 0; i < 200; i++) {
          const selected = await page.locator('#customer-export').inputValue();
          const expected = await page.locator('#customer-sha').inputValue();
          if (SHA.test(selected) && SHA.test(expected)) {
            await remember('consoleExport', { exportId: selected, manifestSha256: expected }); break;
          }
          await pause(100);
        }
        need(journal.refs.consoleExport, 'Retain the selected original Console incident manifest.');
      }
      const original = journal.refs.consoleExport;
      const retainedProfile = await consoleApi('profile/' + profile.id);
      let delivery = retainedProfile.deliveries.find(value => value.identity?.exportId === original.exportId &&
        value.identity?.expectedManifestSha256 === original.manifestSha256);
      if (!delivery?.localFiles && !delivery?.active) {
        const host = await consoleApi('host');
        await consoleApi('customers', { body: { profileId: profile.id, family: 'grpc', workspace: 'operations',
          exportId: original.exportId, expectedManifestSha256: original.manifestSha256,
          expectedHostFingerprint: host.configurationFingerprint } });
      }
      for (let i = 0; i < 300; i++) {
        const current = await consoleApi('profile/' + profile.id);
        delivery = current.deliveries.find(value => value.identity?.exportId === original.exportId &&
          value.identity?.expectedManifestSha256 === original.manifestSha256);
        if (delivery?.localFiles && !delivery.active) break;
        if (delivery?.state === 'FAILED') throw new Error('Original customer receiving failed: ' + JSON.stringify(delivery.error));
        await pause(100);
      }
      need(delivery?.localFiles && !delivery.active, 'Finish the original Console customer receiving.');
      const manifest = await merchant.inspectExport(original.exportId);
      need(manifest.manifest.kind === 'operations' && manifest.manifest.files.length === 5, 'The Console receives the complete original incident.');
      const directory = join(input.work, 'merchant-received-latest');
      const received = await merchant.receive({ exportId: original.exportId, expectedManifestSha256: original.manifestSha256, directory });
      const archivePath = join(input.work, 'merchant-console-incident.tar.gz');
      if (!journal.refs.consoleArchive) {
        await remember('consoleArchiveIntent', { path: archivePath, deliveryId: delivery.id, exportId: original.exportId });
        let data;
        try { data = await readFile(archivePath); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const response = await consoleApi('customer-archive/' + delivery.id, { raw: true });
          data = Buffer.from(await response.arrayBuffer());
          need(data.length > 0, 'Receive the complete original Console customer archive.');
          await atomic(archivePath, data);
        }
        need(data.length > 0, 'Retain the first complete customer archive from this saved receiving intent.');
        await remember('consoleArchive', { path: archivePath, bytes: data.length, sha256: digest(data),
          deliveryId: delivery.id, exportId: original.exportId });
      }
      const bytes = await readFile(archivePath);
      need(bytes.length === journal.refs.consoleArchive.bytes && digest(bytes) === journal.refs.consoleArchive.sha256,
        'Preserve the original complete received customer archive.');
      await remember('consoleProfileId', profile.id);
      return { profileId: profile.id, deliveryId: delivery.id, exportId: original.exportId,
        manifestSha256: original.manifestSha256, incident: received.operations.incident,
        files: received.operations.files, archive: journal.refs.consoleArchive,
        screenshots: ['merchant-console-operations-desktop.png', 'merchant-console-operations-mobile.png'] };
    });
    await phase('following-reviewed-history-and-cold-reopen', async () => {
      await openCold();
      const bundle = await receiving.readGrpcOperationsBundle(join(input.work, 'merchant-received-latest', 'grpc-operations.json'));
      const request = await intent('cold-receive-latest', () => ({ operationId: randomUUID(), exportSha256: bundle.exportSha256 }));
      need(request.exportSha256 === bundle.exportSha256, 'Continue the same complete following incident export.');
      await coldClient.request('receive', { operationId: request.operationId, bundle });
      const current = await coldClient.request('case', { id: journal.refs.caseId });
      need(current.currentVersion === journal.refs.browserSaved.version && current.revision.sha256 === journal.refs.browserSaved.sha256,
        'Extend the received original history with its same reviewed successor.');
      const oldBundle = await receiving.readGrpcOperationsBundle(join(input.work, 'native-received-v2', 'grpc-operations.json'));
      const oldRequest = await intent('cold-earlier-prefix', () => ({ operationId: randomUUID(), exportSha256: oldBundle.exportSha256 }));
      await coldClient.request('receive', { operationId: oldRequest.operationId, bundle: oldBundle });
      const retained = await coldClient.request('case', { id: journal.refs.caseId });
      need(retained.currentVersion === current.currentVersion, 'A matching earlier export preserves the later received history.');
      const descriptor = await coldClient.request('export', { id: journal.refs.caseId, version: current.currentVersion });
      need(descriptor.exportSha256 === bundle.exportSha256, 'Re-export the exact original current incident after cold receiving.');
      await receiving.receiveGrpcOperationsDownload(coldClient, descriptor, join(input.work, 'customer-reexport-latest'));
      await coldClient.close(); coldClient = null; await cold.close(); cold = null;
      await stopBrowser(); await nativeClient.close(); nativeClient = null;
      await product.close(); product = null; merchant = null;
      need(same(await filesAt(join(input.workspace, 'attempts')), journal.refs.originalCalls.files),
        'All original native call bytes and IDs remain unchanged through the complete receiving.');
      product = await openGrpcProduct({ directory: productDirectory, port: 0, workspacePort: 0, sellerPort: 0,
        operationsPort: 0, tokenEnv }, { environment });
      nativeClient = createGrpcOperationsClient({ url: product.browserUrl });
      const reopened = await nativeClient.request('case', { id: journal.refs.caseId });
      need(reopened.currentVersion === current.currentVersion && reopened.revision.sha256 === current.revision.sha256,
        'Reopen the original product and its complete reviewed incident.');
      const offline = await inspectReceivedGrpcProduct(join(input.work, 'merchant-received-latest'),
        { expectedExportId: journal.refs.consoleExport.exportId, expectedManifestSha256: journal.refs.consoleExport.manifestSha256 });
      return { version: reopened.currentVersion, sha256: reopened.revision.sha256, history: reopened.history,
        originalCallFilesSha256: journal.refs.originalCalls.sha256, originalCalls: journal.refs.originalCalls.calls.length,
        receivedExportId: offline.exportId, receivedFiles: offline.files.length, workspaceReopened: true };
    });
    await closeAll();
    session.state = 'CLOSED'; session.endedAt = stamp();
    journal.state = 'COMPLETE'; journal.completedAt = stamp();
    journal.result = { caseId: journal.refs.caseId, captureId: journal.refs.capture.id,
      captureSha256: journal.refs.capture.captureSha256, incident: journal.refs.browserSaved,
      originalCalls: journal.refs.originalCalls.calls.length, originalCallFilesSha256: journal.refs.originalCalls.sha256,
      additionalNativeCalls: 0, customerFiles: 5, nativePhases: journal.phases.filter(value => value.state === 'COMPLETE').length,
      allOwnedResourcesClosed: true, sourceCommit: input.sourceCommit, consoleArchive: journal.refs.consoleArchive };
    await save(); process.stdout.write(JSON.stringify({ state: 'COMPLETE', result: journal.result }) + '\n');
    return journal;
  } catch (error) {
    journal.state = 'CONTINUATION_REQUIRED';
    journal.error = { code: error.code ?? error.name ?? 'RECEIVING_ERROR', message: error.message, recordedAt: stamp() };
    try { await closeAll(); session.state = 'CLOSED'; }
    catch (closeError) { session.state = 'CLOSE_INCOMPLETE'; session.closeError = { code: closeError.code ?? closeError.name, message: closeError.message }; }
    session.endedAt = stamp(); await save(); throw error;
  }
  } finally { await lease.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? error.name, message: error.message }) + '\n'); process.exitCode = 1; });
