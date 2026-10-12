// MIT. Installed Applications receiving over the original NocoDB workspace and managed worker.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, realpath, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCF = 'stellar/scf-starforge-20261009';
const SDK = SCF + '/sf30-seller-sdk';
const RUNTIME = SCF + '/distribution/runtime-workspace';
const HASH = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesOf = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const need = (value, code, message) => { if (!value) throw failure(code, message); };
const absolute = path => {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !/[\0\r\n]/.test(path),
    'APPLICATION_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return path;
};
const inside = (root, path) => {
  const part = relative(root, path);
  return part === '' || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep);
};
async function privateDirectory(path, create = false) {
  if (create) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const value = await lstat(path);
  need(value.isDirectory() && !value.isSymbolicLink() && !(value.mode & 0o077) &&
    await realpath(path) === path, 'APPLICATION_RECEIVING_PRIVATE_DIRECTORY_REQUIRED', path);
}
async function privateBytes(path, optional = false, maximum = 16 * 1024 * 1024) {
  let file;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.size <= maximum,
      'APPLICATION_RECEIVING_PRIVATE_FILE_REQUIRED', path);
    const bytes = await file.readFile();
    need(bytes.length === info.size, 'APPLICATION_RECEIVING_PRIVATE_FILE_CHANGED', path);
    return bytes;
  } finally { await file.close(); }
}
async function readJson(path, optional = false) {
  const bytes = await privateBytes(path, optional);
  return bytes === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function save(path, value) {
  await privateDirectory(dirname(path));
  const target = await privateBytes(path, true);
  if (target !== null) need(!(await lstat(path)).isSymbolicLink(), 'APPLICATION_RECEIVING_TARGET_CHANGED');
  const temporary = path + '.' + randomUUID() + '.partial';
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(bytesOf(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
async function waitFor(read, code, maximum = 180000) {
  const deadline = Date.now() + maximum;
  do {
    const value = await read();
    if (value) return value;
    await new Promise(done => setTimeout(done, 300));
  } while (Date.now() < deadline);
  throw failure(code);
}
const exact = (actual, expected, label) => assert.deepEqual(actual, expected, label);
function sourceView(state, expected) {
  need(state.directory === expected.directory && state.selectedVersion === expected.version.id,
    'APPLICATION_RECEIVING_SOURCE_SELECTION_CHANGED');
  const version = state.versions.find(item => item.id === expected.version.id);
  need(version && version.sourceSha256 === expected.version.sourceSha256 &&
    version.observationSha256 === expected.version.observationSha256,
    'APPLICATION_RECEIVING_SOURCE_VERSION_CHANGED');
  need(state.publisher.directory === expected.publisher.directory &&
    state.publisher.targetDirectory === expected.publisher.targetDirectory &&
    state.publisher.running === false && state.active === null,
    'APPLICATION_RECEIVING_ORIGINAL_PUBLISHER_CHANGED');
  const capture = state.captures.find(item => item.manifestSha256 === expected.version.observationSha256);
  need(capture && capture.rowCount === 1000, 'APPLICATION_RECEIVING_CAPTURE_CHANGED');
  return {
    selectedVersion: state.selectedVersion, draftRevision: state.draftRevision,
    sourceSha256: version.sourceSha256, observationSha256: version.observationSha256,
    captureId: capture.id, rows: capture.rowCount, captures: state.pages.capturesTotal,
    versions: state.pages.versionsTotal, discoveries: state.pages.discoveriesTotal,
    publisherDirectory: state.publisher.directory, targetDirectory: state.publisher.targetDirectory,
    publisherRunning: state.publisher.running,
  };
}
async function nativeStatus(url) {
  const parsed = new URL(url);
  need(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' &&
    /^#token=[a-f0-9]{64}$/.test(parsed.hash), 'APPLICATION_RECEIVING_NATIVE_URL_INVALID');
  const response = await fetch(parsed.origin + '/api/status', {
    headers: { 'x-nocodb-workspace-token': parsed.hash.slice('#token='.length) },
    signal: AbortSignal.timeout(10000),
  });
  need(response.ok, 'APPLICATION_RECEIVING_NATIVE_STATUS_FAILED', String(response.status));
  return response.json();
}

/**
 * Sequential leg of the one receiving operation. The caller holds its native
 * operation lease and has closed the original core/payment owners. This uses
 * the existing READY runtime, original Applications UI and managed workers.
 * No provider capture, dependency installation, publisher extraction or payment
 * is started here. All local URL/token and raw worker records stay private.
 */
export async function receiveNocoDBApplications({
  operationId, inputSha256, sourceRoot, sourceManifestSha256, runtimeDirectory,
  coreDirectory, outputDirectory, browser: browserSelection,
} = {}) {
  need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(operationId ?? '') &&
    HASH.test(inputSha256 ?? '') && HASH.test(sourceManifestSha256 ?? ''),
    'APPLICATION_RECEIVING_ORIGINAL_INTENT_REQUIRED');
  for (const value of [sourceRoot, runtimeDirectory, coreDirectory, outputDirectory,
    browserSelection?.module, browserSelection?.executable]) absolute(value);
  need(!inside(sourceRoot, outputDirectory) && !inside(outputDirectory, sourceRoot),
    'APPLICATION_RECEIVING_PRIVATE_OUTPUT_REQUIRED');
  await privateDirectory(coreDirectory);
  await privateDirectory(outputDirectory, true);
  const resultFile = join(outputDirectory, 'result.json'), intentFile = join(outputDirectory, 'intent.json');
  const importAt = path => import(pathToFileURL(join(sourceRoot, path)).href);
  const [{ inspectMerchantRuntime }, runtimeModel, { startRuntimeWorkspace }, launch,
    authoring, { datasetControl }, { chromium }] = await Promise.all([
    importAt(SCF + '/sf46-release/runtime-package.mjs'), importAt(RUNTIME + '/model.mjs'),
    importAt(RUNTIME + '/server.mjs'), importAt(SDK + '/nocodb/workspace/launch.mjs'),
    importAt(SDK + '/nocodb/workspace/model.mjs'), importAt(SDK + '/dataset-refresh/service.mjs'),
    import(pathToFileURL(browserSelection.module).href),
  ]);
  const runtime = await inspectMerchantRuntime(runtimeDirectory, {
    expectedManifest: sourceManifestSha256, load: false,
  });
  need(runtime.sourceRoot === sourceRoot && runtime.directory === runtimeDirectory &&
    runtime.sourceManifestSha256 === sourceManifestSha256,
    'APPLICATION_RECEIVING_READY_SOURCE_CHANGED');
  const core = await readJson(join(coreDirectory, 'result.json'));
  const original = await readJson(join(coreDirectory, 'intent.json'));
  need(core.state === 'PASS' && core.source.manifestSha256 === sourceManifestSha256 &&
    original.authoring?.film?.version && original.authoring.film.publisher,
    'APPLICATION_RECEIVING_ORIGINAL_CORE_REQUIRED');
  const expected = {
    directory: join(coreDirectory, 'authoring', 'film'),
    version: original.authoring.film.version,
    publisher: original.authoring.film.publisher,
  };
  need(core.film.workspaceVersion === expected.version.id &&
    core.film.sourceSha256 === expected.version.sourceSha256 &&
    core.film.captureSha256 === expected.version.observationSha256,
    'APPLICATION_RECEIVING_ORIGINAL_FILM_CHANGED');
  exact(digest(await privateBytes(expected.version.sourceFile)), expected.version.sourceSha256,
    'Same immutable original source file.');
  const nativeIdentity = await launch.inspectNocoDBAuthoring(expected.directory);
  const selectedSource = await launch.inspectNocoDBLaunchSource(join(sourceRoot, SDK, 'nocodb/workspace'));
  const basis = {
    schema: 'stellar-forge.nocodb-applications-receiving-intent.v1',
    operationId, inputSha256, sourceManifestSha256,
    runtimeDirectory, sourceRoot, sourceCommit: runtime.sourceCommit,
    workspaceDirectory: expected.directory, workspaceIdentity: nativeIdentity.sha256,
    settingsSha256: nativeIdentity.settingsSha256, sourceSha256: selectedSource.sha256,
    version: expected.version, publisher: expected.publisher,
  };
  let intent = await readJson(intentFile, true);
  if (intent) exact(intent.basis, basis, 'Same retained Applications receiving intent.');
  else { intent = { basis, createdAt: now(), requests: {}, launches: {}, stages: {} }; await save(intentFile, intent); }
  intent.attempts ??= {};
  intent.interruptedRuns ??= [];
  intent.cleanups ??= {};
  const completed = await readJson(resultFile, true);
  if (completed?.state === 'PASS') {
    exact(completed.inputSha256, inputSha256);
    for (const file of completed.completedFiles)
      exact(digest(await privateBytes(file.file)), file.sha256, 'Retained Applications result file.');
    return { file: resultFile, sha256: digest(await privateBytes(resultFile)), value: completed };
  }
  const directory = join(outputDirectory, 'runtime-workspace');
  let initialized = true;
  try { await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; initialized = false; }
  if (!initialized) await runtimeModel.createRuntimeWorkspace({ directory });
  const model = await runtimeModel.openRuntimeWorkspace({ directory });
  const report = { schema: 'stellar-forge.nocodb-applications-receiving-result.v1',
    operationId, inputSha256, sourceManifestSha256, runtimeDirectory,
    sourceCommit: runtime.sourceCommit, state: 'RUNNING', startedAt: completed?.startedAt ?? now(),
    source: { version: expected.version.id, sourceSha256: expected.version.sourceSha256,
      observationSha256: expected.version.observationSha256, rows: 1000 },
    browserErrors: [], stages: intent.stages };
  let browser, context, page, service, nativePage, currentOwnedRun = null;
  const checkpoint = async (name, value) => {
    intent.stages[name] = value; await save(intentFile, intent);
    report.stages = intent.stages; await save(resultFile, report);
    console.log(JSON.stringify({ phase: 'NOCODB_APPLICATIONS', operationId, stage: name }));
  };
  const application = async () => {
    const state = await model.applicationsState();
    need(state.catalog.some(item => item.id === 'nocodb-authoring' &&
      item.command === 'nocodb-source'), 'APPLICATION_RECEIVING_CATALOG_ENTRY_MISSING');
    return intent.applicationId ? state.applications.find(item => item.id === intent.applicationId) : null;
  };
  const attemptKey = name => name + (intent.attempts[name] ? '-recovery-' + intent.attempts[name] : '');
  const startRequest = name => intent.requests[attemptKey(name) + '-start'];
  const stopRequest = name => intent.requests[attemptKey(name) + '-stop'];
  const expectedRuns = () => intent.interruptedRuns.length +
    ['first', 'second'].filter(name => startRequest(name)).length;
  const terminalRun = app => app?.current?.active === false &&
    ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(app.current.phase) &&
    app.current.result !== null && app.current.result !== undefined;
  const drainOwnedRun = async run => {
    let entry = intent.cleanups[run];
    if (!entry) {
      entry = { applicationId: intent.applicationId, operationId: run,
        request: { applicationId: intent.applicationId, operationId: run }, requestedAt: now() };
      intent.cleanups[run] = entry;
      await save(intentFile, intent); // retained before original Stop, including a lost Stop receipt
    }
    exact(entry.request, { applicationId: intent.applicationId, operationId: run });
    let app = await application();
    need(app?.current?.id === run, 'APPLICATION_RECEIVING_CLEANUP_RUN_CHANGED');
    if (!terminalRun(app)) {
      await model.applicationsStop(entry.request);
      app = await waitFor(async () => {
        const value = await application();
        need(value?.current?.id === run, 'APPLICATION_RECEIVING_CLEANUP_RUN_CHANGED');
        return terminalRun(value) ? value : false;
      }, 'APPLICATION_RECEIVING_CLEANUP_NOT_DRAINED', 180000);
    }
    entry.terminal ??= { observedAt: now(), applicationId: app.id, operationId: run,
      phase: app.phase, nativePhase: app.current.phase, active: false,
      instanceId: app.current.url?.original?.instanceId ?? null, result: app.current.result };
    exact(entry.terminal.operationId, app.current.id);
    exact(entry.terminal.nativePhase, app.current.phase);
    exact(entry.terminal.result, app.current.result);
    await save(intentFile, intent);
    report.cleanupTransitions = Object.values(intent.cleanups).map(value => ({
      applicationId: value.applicationId, operationId: value.operationId,
      requestedAt: value.requestedAt, terminal: value.terminal ?? null,
    }));
    await save(resultFile, report);
    return app;
  };
  const resumeStage = async name => {
    const request = startRequest(name);
    if (intent.stages[name + '-stopped'] || !request ||
        !intent.cleanups[request.body.requestId]) return;
    currentOwnedRun = request.body.requestId;
    const stopped = await drainOwnedRun(currentOwnedRun);
    // A retained normal UI Stop can finish the same accepted stage. Otherwise
    // this original run ended during failure cleanup: keep its complete history
    // and request a new reviewed run only after its terminal state is positive.
    if (stopped.phase === 'STOPPED' && stopRequest(name) &&
        intent.stages[name + '-source-open']?.operationId === currentOwnedRun) return;
    const key = attemptKey(name), archivedStages = {};
    for (const stage of [name + '-source-open', name + '-stopped',
      ...(name === 'first' ? ['console-reopened'] : [])]) {
      if (intent.stages[stage]) archivedStages[stage] = intent.stages[stage];
    }
    need(!intent.interruptedRuns.some(value => value.operationId === currentOwnedRun),
      'APPLICATION_RECEIVING_CLEANUP_ALREADY_ADOPTED');
    intent.interruptedRuns.push({ stage: name, attempt: key, operationId: currentOwnedRun,
      requestKey: key + '-start', stopRequestKey: stopRequest(name) ? key + '-stop' : null,
      launch: intent.launches[name] ?? null, stages: archivedStages,
      cleanup: intent.cleanups[currentOwnedRun], continuedAt: now() });
    intent.attempts[name] = (intent.attempts[name] ?? 0) + 1;
    for (const stage of Object.keys(archivedStages)) delete intent.stages[stage];
    delete intent.launches[name];
    await save(intentFile, intent);
    currentOwnedRun = null;
  };
  const refreshPage = async () => {
    await page.goto(service.url); await page.locator('[data-view="applications"]').click();
    await page.locator('#application-kind').waitFor();
    if (intent.applicationId) {
      const selected = page.locator('[data-application-id="' + intent.applicationId + '"]');
      await selected.waitFor(); await selected.click();
    }
  };
  const receivedPost = async (path, trigger, key, { loseReply = false } = {}) => {
    need(!intent.requests[key], 'APPLICATION_RECEIVING_REQUEST_ALREADY_RETAINED', key);
    const routeName = '**' + path;
    let outcome, dispatched = false, routeError;
    await page.route(routeName, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      try {
        const request = route.request().postDataJSON();
        intent.requests[key] = { path, body: request, retainedAt: now() };
        await save(intentFile, intent); // exact UI UUID retained before native dispatch
        if (path === '/api/applications/start') currentOwnedRun = request.requestId;
        const response = await route.fetch();
        const text = await response.text();
        let body; try { body = JSON.parse(text); } catch { body = null; }
        outcome = { status: response.status(), body };
        intent.requests[key].response = outcome;
        if (loseReply && response.ok()) intent.requests[key].replyWithheld = true;
        await save(intentFile, intent);
        dispatched = true;
        if (loseReply && response.ok()) await route.abort('failed');
        else await route.fulfill({ response });
      } catch (error) {
        routeError = error; dispatched = true;
        await route.abort('failed').catch(() => {});
      }
    }, { times: 1 });
    try {
      await trigger();
      await waitFor(() => dispatched, 'APPLICATION_RECEIVING_UI_REQUEST_NOT_DISPATCHED');
      if (routeError) throw routeError;
      need(outcome?.status >= 200 && outcome.status < 300,
        'APPLICATION_RECEIVING_NATIVE_REQUEST_FAILED', JSON.stringify(outcome));
      return outcome.body;
    } finally { await page.unroute(routeName).catch(() => {}); }
  };
  const waitRunning = async name => waitFor(async () => {
    const app = await application(), request = startRequest(name)?.body;
    if (!app?.current || app.current.id !== request?.requestId) return false;
    if (app.current.active && app.current.privateUrl && app.phase === 'RUNNING') return app;
    if (['FAILED', 'UNAVAILABLE', 'STOPPED', 'CANCELLED'].includes(app.phase))
      throw failure('APPLICATION_RECEIVING_ORIGINAL_LAUNCH_ENDED', JSON.stringify({
        applicationId: app.id, operationId: app.current.id, phase: app.phase, result: app.current.result,
      }));
    return false;
  }, 'APPLICATION_RECEIVING_NATIVE_READY_NOT_OBSERVED', 300000);
  const ensureStart = async (name, loseReply = false) => {
    const key = attemptKey(name) + '-start';
    if (!intent.requests[key]) {
      await refreshPage();
      const button = page.getByRole('button', { name: 'Review start', exact: true });
      await waitFor(() => button.isEnabled(), 'APPLICATION_RECEIVING_START_REVIEW_UNAVAILABLE', 300000);
      const reviewResponse = page.waitForResponse(value =>
        new URL(value.url()).pathname === '/api/applications/start-review' &&
        value.request().method() === 'POST');
      await button.click(); const response = await reviewResponse;
      need(response.ok(), 'APPLICATION_RECEIVING_START_REVIEW_FAILED', await response.text());
      const reviewed = await response.json();
      exact(reviewed.applicationId, intent.applicationId);
      const startButton = page.getByRole('button', { name: 'Start reviewed application', exact: true });
      await startButton.waitFor();
      await receivedPost('/api/applications/start', () => startButton.click(), key, { loseReply });
    } else {
      // The original UI's saved UUID is authoritative after a process/browser
      // interruption. This reopens that same retained managed request.
      const request = intent.requests[key].body;
      exact(request.applicationId, intent.applicationId);
      currentOwnedRun = request.requestId;
      await model.applicationsStart(request);
      const current = await application();
      if (current?.current?.id === request.requestId && !current.current.active &&
          ['QUEUED', 'PENDING', 'INTERRUPTED'].includes(current.current.phase))
        await model.applicationsRecover({ applicationId: intent.applicationId, operationId: request.requestId });
    }
    currentOwnedRun = intent.requests[key].body.requestId;
    if (loseReply && intent.requests[key].replyWithheld && !intent.requests[key].replyRecovered) {
      // Reload retains the original browser request and exercises its normal
      // Recover control. A different-origin restart uses the model replay above.
      await page.reload(); await page.locator('[data-view="applications"]').click();
      await page.locator('[data-application-id="' + intent.applicationId + '"]').waitFor();
      const recover = page.getByRole('button', { name: 'Recover last application request', exact: true });
      if (await recover.isVisible()) {
        let replayBody;
        const replay = page.waitForResponse(value =>
          new URL(value.url()).pathname === '/api/applications/start' &&
          value.request().method() === 'POST' &&
          (replayBody = value.request().postDataJSON()).requestId === currentOwnedRun);
        await recover.click(); const response = await replay;
        need(response.ok(), 'APPLICATION_RECEIVING_SAME_START_RECOVERY_FAILED');
        exact(replayBody, intent.requests[key].body, 'Original lost-response request UUID and review.');
        intent.requests[key].replyRecoveryMode = 'ORIGINAL_BROWSER_RECOVER';
      } else {
        await model.applicationsStart(intent.requests[key].body);
        intent.requests[key].replyRecoveryMode = 'ORIGINAL_MODEL_REPLAY_AFTER_BROWSER_REOPEN';
      }
      intent.requests[key].replyRecovered = true; await save(intentFile, intent);
    }
    const app = await waitRunning(name);
    exact(app.kind, 'nocodb-authoring');
    exact(app.settings.workspaceDirectory, expected.directory);
    exact(app.settings.port, 0);
    exact(app.settings.connectionsFile ?? null, null);
    exact(app.runtime.sourceManifestSha256, sourceManifestSha256);
    const launchRecord = app.current.url;
    need(launchRecord?.source === 'original-command-stdout' &&
      launchRecord.operationId === currentOwnedRun && launchRecord.applicationId === app.id,
      'APPLICATION_RECEIVING_ORIGINAL_STARTUP_REQUIRED');
    const native = launchRecord.original;
    exact(native.directory, expected.directory);
    exact(native.workspaceIdentity, nativeIdentity.sha256);
    exact(native.settingsSha256, nativeIdentity.settingsSha256);
    exact(native.sourceDirectory, join(sourceRoot, SDK, 'nocodb/workspace'));
    exact(native.sourceSha256, selectedSource.sha256);
    exact(native.sourceFiles, selectedSource.files);
    exact(native.publisherDirectory, expected.publisher.directory);
    exact(native.targetDirectory, expected.publisher.targetDirectory);
    need(native.launchSourceDirectory !== native.sourceDirectory &&
      typeof native.instanceId === 'string' && Number.isSafeInteger(native.pid),
      'APPLICATION_RECEIVING_MANAGED_EXECUTION_REQUIRED');
    intent.launches[name] = { applicationId: app.id, operationId: currentOwnedRun,
      instanceId: native.instanceId, pid: native.pid, workspaceIdentity: native.workspaceIdentity,
      settingsSha256: native.settingsSha256, sourceSha256: native.sourceSha256,
      selectedSourceDirectory: native.sourceDirectory, executedSourceDirectory: native.launchSourceDirectory,
      privateUrl: app.current.privateUrl };
    await save(intentFile, intent);
    await refreshPage();
    const link = page.getByRole('link', { name: 'Open application', exact: true });
    await link.waitFor();
    exact(await link.getAttribute('href'), app.current.privateUrl, 'Open uses this original managed run.');
    const opened = context.waitForEvent('page');
    await link.click(); nativePage = await opened;
    nativePage.on('pageerror', error => report.browserErrors.push({ surface: name, message: error.message }));
    await nativePage.locator('#versions').waitFor();
    const state = await nativeStatus(app.current.privateUrl), view = sourceView(state, expected);
    await nativePage.screenshot({ path: join(outputDirectory, name + '-source-desktop.png'), fullPage: true });
    await checkpoint(name + '-source-open', {
      applicationId: app.id, revision: app.revision, operationId: currentOwnedRun,
      instanceId: native.instanceId, workspaceIdentity: native.workspaceIdentity,
      sourceSha256: native.sourceSha256, source: view,
    });
    return { app, view };
  };
  const ensureStop = async name => {
    const run = startRequest(name)?.body.requestId;
    need(run, 'APPLICATION_RECEIVING_ORIGINAL_RUN_REQUIRED');
    currentOwnedRun = run;
    if (intent.stages[name + '-stopped']) { currentOwnedRun = null; return; }
    let app = await application();
    need(app?.current?.id === run, 'APPLICATION_RECEIVING_STOP_RUN_CHANGED');
    if (!stopRequest(name)) {
      await refreshPage();
      const button = page.getByRole('button', { name: 'Stop application', exact: true });
      await waitFor(() => button.isEnabled(), 'APPLICATION_RECEIVING_STOP_UNAVAILABLE');
      await receivedPost('/api/applications/stop', () => button.click(), attemptKey(name) + '-stop');
    } else {
      exact(stopRequest(name).body, { applicationId: intent.applicationId, operationId: run });
      await model.applicationsStop(stopRequest(name).body);
    }
    app = await waitFor(async () => {
      const value = await application();
      need(value?.current?.id === run, 'APPLICATION_RECEIVING_STOP_RUN_CHANGED');
      return !value.current.active && value.phase === 'STOPPED' ? value : false;
    }, 'APPLICATION_RECEIVING_ORIGINAL_DRAIN_NOT_COMPLETE', 180000);
    const reopened = await authoring.openNocoDBAuthoring({ directory: expected.directory });
    let saved;
    try { saved = sourceView(await reopened.status(), expected); }
    finally { await reopened.close(); }
    exact(saved, intent.stages[name + '-source-open'].source,
      'Original source state and workspace lease reopen after Stop.');
    await checkpoint(name + '-stopped', {
      applicationId: app.id, operationId: run, phase: app.phase,
      active: app.current.active, originalOutcome: app.current.result?.state, source: saved,
    });
    currentOwnedRun = null;
    await nativePage?.close(); nativePage = null;
  };
  try {
    const attached = await model.attach({ directory: runtimeDirectory, label: 'NocoDB receiving runtime' });
    need(attached.status === 'READY', 'APPLICATION_RECEIVING_READY_RUNTIME_REQUIRED');
    intent.runtimeId ??= attached.runtimeId;
    exact(intent.runtimeId, attached.runtimeId);
    await save(intentFile, intent);
    browser = await chromium.launch({ executablePath: browserSelection.executable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on('pageerror', error => report.browserErrors.push({ surface: 'applications', message: error.message }));
    service = await startRuntimeWorkspace({ directory, port: 0 });
    await refreshPage();
    if (!intent.applicationId) {
      if (intent.requests.save) {
        const value = await model.applicationsSave(intent.requests.save.body);
        intent.applicationId = value.applicationId;
      } else {
        await page.getByRole('button', { name: 'New application', exact: true }).click();
        await page.locator('#application-label').fill('NocoDB captured film source');
        await page.locator('#application-runtime').selectOption(attached.runtimeId);
        await page.locator('#application-kind').selectOption('nocodb-authoring');
        await page.locator('#application-setting-workspaceDirectory').fill(expected.directory);
        await page.locator('#application-setting-port').fill('0');
        const reviewResponse = page.waitForResponse(value =>
          new URL(value.url()).pathname === '/api/applications/review' &&
          value.request().method() === 'POST');
        await page.getByRole('button', { name: 'Review application', exact: true }).click();
        const response = await reviewResponse;
        need(response.ok(), 'APPLICATION_RECEIVING_CONFIGURATION_REVIEW_FAILED', await response.text());
        const reviewed = await response.json();
        exact(reviewed.kind, 'nocodb-authoring');
        exact(reviewed.settings.workspaceDirectory, expected.directory);
        exact(reviewed.runtime.sourceManifestSha256, sourceManifestSha256);
        const saved = await receivedPost('/api/applications/save',
          () => page.getByRole('button', { name: 'Save application', exact: true }).click(), 'save');
        intent.applicationId = saved.applicationId;
      }
      await save(intentFile, intent);
    }
    const connected = await waitFor(async () => {
      const app = await application();
      if (app?.release) return app;
      if (app?.adoption && !app.adoption.active &&
          ['FAILED', 'INTERRUPTED'].includes(app.adoption.phase))
        throw failure('APPLICATION_RECEIVING_ADOPTION_NOT_COMPLETE', JSON.stringify({
          applicationId: app.id, operationId: app.adoption.id, phase: app.adoption.phase,
        }));
      return false;
    }, 'APPLICATION_RECEIVING_ORIGINAL_ADOPTION_NOT_COMPLETE', 300000);
    await checkpoint('original-application-saved', {
      applicationId: connected.id, revision: connected.revision, runtimeId: connected.runtimeId,
      sourceCommit: connected.runtime.sourceCommit, sourceManifestSha256: connected.runtime.sourceManifestSha256,
      release: connected.release, workspaceIdentity: nativeIdentity.sha256,
    });
    await resumeStage('first');
    if (!intent.stages['first-stopped']) {
      if (!stopRequest('first')) {
        const first = await ensureStart('first', true);
        exact(first.app.totalRuns, expectedRuns(), 'No additional run for the same lost Start reply.');
        if (!intent.stages['console-reopened']) {
          const before = intent.launches.first;
          await service.close(); service = null;
          exact(sourceView(await nativeStatus(before.privateUrl), expected), first.view);
          service = await startRuntimeWorkspace({ directory, port: 0 });
          await refreshPage();
          const retained = await application();
          exact(retained.current.id, before.operationId);
          exact(retained.current.privateUrl, before.privateUrl);
          exact(retained.current.url.original.instanceId, before.instanceId);
          exact(retained.totalRuns, first.app.totalRuns);
          const link = page.getByRole('link', { name: 'Open application', exact: true });
          await link.waitFor();
          exact(await link.getAttribute('href'), before.privateUrl);
          await page.screenshot({ path: join(outputDirectory, 'applications-desktop.png'), fullPage: true });
          await page.setViewportSize({ width: 412, height: 915 });
          await page.screenshot({ path: join(outputDirectory, 'applications-mobile.png'), fullPage: true });
          need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'APPLICATION_RECEIVING_MOBILE_OVERFLOW');
          await page.setViewportSize({ width: 1440, height: 1000 });
          await checkpoint('console-reopened', {
            applicationId: retained.id, operationId: before.operationId,
            instanceId: before.instanceId, samePrivateUrl: true, originalRuns: retained.totalRuns,
          });
        }
      }
      await ensureStop('first');
    }
    await resumeStage('second');
    if (!intent.stages['second-stopped']) {
      if (!stopRequest('second')) {
        const second = await ensureStart('second');
        need(second.app.current.id !== intent.launches.first.operationId &&
          second.app.current.url.original.instanceId !== intent.launches.first.instanceId,
          'APPLICATION_RECEIVING_NEW_REVIEWED_INSTANCE_REQUIRED');
        exact(second.app.revision, intent.stages['original-application-saved'].revision);
        exact(second.app.totalRuns, expectedRuns());
        exact(second.view, intent.stages['first-source-open'].source,
          'Same original captures, selected source and publisher after a reviewed restart.');
      }
      await ensureStop('second');
    }
    const finalApplication = await application();
    exact(finalApplication.totalRuns, expectedRuns());
    exact(finalApplication.totalRuns, intent.interruptedRuns.length + 2);
    exact(finalApplication.phase, 'STOPPED');
    exact(finalApplication.current.active, false);
    const schema = await datasetControl(expected.publisher.targetDirectory, 'schema');
    exact(schema.versions.current, core.film.second.snapshot,
      'Applications did not replace the original published film edition.');
    exact(digest(await privateBytes(expected.version.sourceFile)), expected.version.sourceSha256);
    const finalIdentity = await launch.inspectNocoDBAuthoring(expected.directory);
    exact(finalIdentity.sha256, nativeIdentity.sha256);
    const files = [];
    for (const name of ['first-source-desktop.png', 'second-source-desktop.png',
      'applications-desktop.png', 'applications-mobile.png']) {
      const file = join(outputDirectory, name), bytes = await privateBytes(file);
      files.push({ file, sha256: digest(bytes), bytes: bytes.length });
    }
    need(report.browserErrors.length === 0, 'APPLICATION_RECEIVING_BROWSER_ERROR',
      JSON.stringify(report.browserErrors));
    Object.assign(report, {
      state: 'PASS', completedAt: now(), applicationId: finalApplication.id,
      applicationRevision: finalApplication.revision, runtimeId: finalApplication.runtimeId,
      originalRunIds: ['first', 'second'].map(name => intent.launches[name].operationId),
      originalInstanceIds: ['first', 'second'].map(name => intent.launches[name].instanceId),
      originalRuns: finalApplication.totalRuns, completedReceivingRuns: 2,
      interruptedRuns: intent.interruptedRuns.map(value => ({
        stage: value.stage, operationId: value.operationId,
        instanceId: value.launch?.instanceId ?? value.cleanup.terminal.instanceId,
        terminalPhase: value.cleanup.terminal.phase,
        nativeTerminalPhase: value.cleanup.terminal.nativePhase,
      })),
      allOriginalRunIds: [...intent.interruptedRuns.map(value => value.operationId),
        ...['first', 'second'].map(name => intent.launches[name].operationId)],
      finalPhase: finalApplication.phase,
      lostStartReplyRecovered: startRequest('first').replyWithheld === true &&
        startRequest('first').replyRecovered === true,
      startReplyRecoveryMode: startRequest('first').replyRecoveryMode,
      consoleReopenedWithoutNewRun: true, sameWorkspaceIdentity: finalIdentity.sha256,
      sameSourceVersion: expected.version.id, samePublisherDirectory: true,
      publishedSnapshot: schema.versions.current, completedFiles: files,
      scope: 'Original installed Applications review/save/start/Open/Stop/reopen over the same captured NocoDB source; no provider request, publication or payment.',
    });
    await save(resultFile, report);
    return { file: resultFile, sha256: digest(await privateBytes(resultFile)), value: report };
  } catch (error) {
    report.state = 'FAIL'; report.failedAt = now();
    report.error = { code: /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'NOCODB_APPLICATIONS_RECEIVING_FAILED',
      message: String(error.message).replace(/S[A-Z2-7]{55}/g, '[private signing key]') };
    await save(resultFile, report);
    throw error;
  } finally {
    const cleanup = [];
    try {
      if (currentOwnedRun && intent.applicationId) {
        await drainOwnedRun(currentOwnedRun);
      }
    } catch (error) { cleanup.push({ scope: 'original-managed-run', code: error.code ?? 'CLOSE_FAILED' }); }
    for (const [scope, close] of [
      ['source-browser', () => nativePage?.close()], ['runtime-browser', () => page?.close()],
      ['browser-context', () => context?.close()], ['browser', () => browser?.close()],
      ['runtime-console', () => service?.close()], ['runtime-model', () => model.close()],
    ]) try { await close(); } catch (error) { cleanup.push({ scope, code: error.code ?? 'CLOSE_FAILED' }); }
    if (cleanup.length) {
      report.state = 'FAIL'; report.cleanupErrors = cleanup;
      await save(resultFile, report);
      throw failure('APPLICATION_RECEIVING_CLEANUP_FAILED', JSON.stringify(cleanup));
    }
  }
}
