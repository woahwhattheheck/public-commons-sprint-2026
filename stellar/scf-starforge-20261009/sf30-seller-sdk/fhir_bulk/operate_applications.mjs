#!/usr/bin/env node
// MIT. Receive the original FHIR workspace through the installed Applications UI.
import { createRequire } from 'node:module';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import {
  absolute, privateDirectory, readJSON, saveJSON, digest, operationLease, need, now,
} from '../../distribution/runtime-workspace/storage.mjs';

const SCHEMA = 'stellar-forge.fhir-bulk-applications-receiving.v1';
const OPERATION = 'SCF-FHIR-BULK-APPLICATIONS-450E-20261012';
const PREFIX = 'stellar/scf-starforge-20261009';
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  need(['--runtime-directory', '--runtime-workspace', '--receiving', '--out',
    '--credentials-file', '--environment-file', '--chromium', '--label'].includes(name) &&
    typeof value === 'string' && value && !value.startsWith('--') && !Object.hasOwn(args, name),
  'FHIR_APPLICATIONS_ARGUMENTS', 'Use --runtime-directory READY_RUNTIME --runtime-workspace PRIVATE_RUNTIME_WORKSPACE --receiving OPERATED_FHIR_BULK.json --out PRIVATE_OUTPUT.');
  args[name] = name === '--label' ? value : absolute(value);
}
for (const name of ['--runtime-directory', '--runtime-workspace', '--receiving', '--out'])
  need(args[name], 'FHIR_APPLICATIONS_ARGUMENT_REQUIRED', name + ' is required.');
need(Number(process.versions.node.split('.')[0]) >= 22, 'FHIR_APPLICATIONS_NODE_REQUIRED', 'Use Node 22 or newer.');

const output = args['--out'], runtimeDirectory = args['--runtime-directory'];
const runtimeWorkspace = args['--runtime-workspace'];
try { await mkdir(output, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await privateDirectory(output);
const lease = await operationLease(join(output, 'receiving.lock'));
const journalPath = join(output, 'APPLICATIONS_JOURNEY.json');
let journal, host, browser, model, page, hostOwned = false;
const errors = [], pendingCaptures = new Set();
let captureError = null;
const nativeBytes = await readFile(args['--receiving']);
const native = JSON.parse(nativeBytes.toString('utf8'));
need(native.operation === 'SCF-FHIR-BULK-DATA-WORKBENCH-450E-20261012' &&
  typeof native.workspace === 'string' && typeof native.workspaceId === 'string' &&
  Array.isArray(native.sourceIds) && native.sourceIds.length && Array.isArray(native.buildIds) && native.buildIds.length &&
  Array.isArray(native.operationIds) && native.operationIds.length && typeof native.planId === 'string',
'FHIR_APPLICATIONS_NATIVE_RECEIVING_REQUIRED', 'Select the completed original FHIR acquisition and native receiving result.');

const binding = {
  runtimeDirectory, runtimeWorkspace, receivingPath: args['--receiving'], receivingSha256: digest(nativeBytes),
  workspace: absolute(native.workspace), workspaceId: native.workspaceId,
  credentialsFile: args['--credentials-file'] ?? null, environmentFile: args['--environment-file'] ?? null,
};
let writes = Promise.resolve();
async function checkpoint() {
  writes = writes.then(async () => {
    journal.updatedAt = now();
    await saveJSON(journalPath, journal, true);
  });
  return writes;
}
async function privateJSON(name, value) {
  const path = join(output, name);
  await saveJSON(path, value, true);
  const bytes = await readFile(path);
  return { file: path, bytes: bytes.length, sha256: digest(bytes) };
}
async function fileIdentity(path) {
  const bytes = await readFile(path);
  return { file: path, bytes: bytes.length, sha256: digest(bytes) };
}
async function collectCaptures() {
  await Promise.all([...pendingCaptures]);
  if (captureError) throw captureError;
}
function watch(target) {
  target.on('pageerror', error => errors.push({ message: error.message, at: now() }));
  target.on('response', response => {
    const request = response.request(), url = new URL(response.url());
    if (request.method() === 'GET' || !url.pathname.startsWith('/api/applications/')) return;
    const capture = (async () => {
      const value = { at: now(), path: url.pathname, method: request.method(),
        body: request.postDataJSON(), status: response.status(), response: await response.json() };
      journal.applicationRequests.push(value);
      await checkpoint();
    })().catch(error => { captureError = error; });
    pendingCaptures.add(capture);
    capture.finally(() => pendingCaptures.delete(capture));
  });
}
async function readHost(path) {
  const url = new URL(host.url), response = await fetch(new URL(path, url), {
    headers: { 'X-Runtime-Workspace-Token': url.hash.slice(1) },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  need(response.ok, 'FHIR_APPLICATIONS_HOST_READ_FAILED', 'The original runtime host returned HTTP ' + response.status);
  return response.json();
}
async function originalState(urlText) {
  const url = new URL(urlText), response = await fetch(new URL('/api/state', url), {
    headers: { Authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  need(response.ok, 'FHIR_APPLICATIONS_NATIVE_READ_FAILED');
  const state = await response.json();
  need(state.schema === 'stellar-forge.fhir-bulk-workspace.v1' && state.workspaceId === native.workspaceId,
    'FHIR_APPLICATIONS_ORIGINAL_WORKSPACE_CHANGED');
  for (const [key, expected, field] of [
    ['sources', native.sourceIds, 'id'], ['builds', native.buildIds, 'id'],
    ['plans', [native.planId], 'id'], ['operations', native.operationIds, 'operationId'],
    ['comparisons', [native.comparisonId], 'id'],
  ]) {
    const observed = new Set((state[key] ?? []).map(row => row[field]));
    need(expected.every(id => observed.has(id)), 'FHIR_APPLICATIONS_ORIGINAL_RECORD_MISSING', 'The original ' + key + ' collection differs from native receiving.');
  }
  return state;
}
async function appState() {
  const state = await model.applicationsState({ historyLimit: 30 });
  const selected = state.applications.find(item => item.id === journal.applicationId);
  need(selected && selected.kind === 'fhir-bulk' &&
    selected.settings.workspaceDirectory === native.workspace &&
    selected.runtime.directory === runtimeDirectory, 'FHIR_APPLICATIONS_RECORD_CHANGED');
  return selected;
}
async function waitForApplication(predicate, label, timeout = 240000) {
  const deadline = Date.now() + timeout;
  let current;
  do {
    current = await appState();
    if (predicate(current)) return current;
    if (current.phase === 'UNAVAILABLE' || current.error)
      throw new Error(label + ': ' + JSON.stringify(current.error ?? current));
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  await privateJSON('LAST_APPLICATION_STATE.json', current);
  throw new Error(label + ' has not completed; continue the same saved application and operation.');
}
async function runtimeReady() {
  await page.locator('#connection').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const node = document.querySelector('#connection');
    return node && ['Connected', 'Operation in progress'].includes(node.textContent);
  }, null, { timeout: 60000 });
}
async function fhirReady(target) {
  await target.waitForFunction(() => {
    const content = document.querySelector('#content'), status = document.querySelector('#connection-state');
    return content && content.getAttribute('aria-busy') !== 'true' &&
      status?.textContent === 'Private workspace connected';
  }, null, { timeout: 60000 });
}
async function refreshedSelection() {
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('[data-view="applications"]').click();
  const selected = await appState();
  await page.locator('#application-library-search').fill(selected.label);
  await page.locator('#application-library-runtime').selectOption('');
  await page.locator('#application-library-phase').selectOption('');
  await page.locator('[data-application-id="' + selected.id + '"]').click();
  return selected;
}
async function saveScreen(target, name) {
  const path = join(output, name + '.png');
  await target.screenshot({ path, fullPage: true });
  return fileIdentity(path);
}
async function clickResponse(target, button, route) {
  const [response] = await Promise.all([
    target.waitForResponse(value => new URL(value.url()).pathname === route && value.request().method() === 'POST', { timeout: 120000 }),
    target.getByRole('button', { name: button, exact: true }).click(),
  ]);
  const body = await response.json();
  need(response.ok(), 'FHIR_APPLICATIONS_UI_ACTION_FAILED', JSON.stringify(body));
  await collectCaptures();
  return body;
}
async function openHost(startRuntimeWorkspace) {
  host = await startRuntimeWorkspace({ directory: runtimeWorkspace, port: journal.hostPort ?? 0 });
  hostOwned = true;
  journal.hostPort = Number(new URL(host.url).port || 80);
  journal.hosts.push({ at: now(), origin: host.origin });
  await checkpoint();
  await page.goto(host.url);
  await runtimeReady();
}
async function ensureApplication() {
  const initial = await model.state();
  const attached = initial.runtimes.find(item => item.directory === runtimeDirectory);
  if (!attached) {
    if (!await page.locator('#attach-details').evaluate(node => node.open))
      await page.locator('#attach-details summary').click();
    await page.locator('#attach-directory').fill(runtimeDirectory);
    await page.locator('#attach-label').fill('FHIR Bulk Data original runtime');
    await clickResponse(page, 'Open runtime', '/api/attach');
  }
  const state = await model.state();
  const runtime = state.runtimes.find(item => item.directory === runtimeDirectory);
  need(runtime?.phase === 'READY', 'FHIR_APPLICATIONS_READY_RUNTIME_REQUIRED');
  journal.runtimeId = runtime.id;
  await checkpoint();
  await page.locator('[data-view="applications"]').click();
  await page.locator('#application-kind').waitFor({ state: 'attached', timeout: 60000 });
  const applications = await model.applicationsState({ historyLimit: 30 });
  need(applications.catalog.some(item => item.id === 'fhir-bulk'),
    'FHIR_APPLICATIONS_PROVIDER_MISSING', 'Receive the cumulative distribution containing the FHIR Applications provider.');
  const matching = applications.applications.filter(item => item.kind === 'fhir-bulk' &&
    item.settings?.workspaceDirectory === native.workspace && item.runtime?.directory === runtimeDirectory);
  need(matching.length <= 1, 'FHIR_APPLICATIONS_MULTIPLE_ORIGINALS', 'Select the already retained original application before continuing.');
  if (journal.applicationId) {
    need(matching.length === 1 && matching[0].id === journal.applicationId, 'FHIR_APPLICATIONS_RECORD_CHANGED');
  } else if (matching.length) {
    journal.applicationId = matching[0].id;
  } else {
    await page.getByRole('button', { name: 'New application', exact: true }).click();
    await page.locator('#application-label').fill(args['--label'] ?? 'FHIR Bulk Data · original receiving');
    await page.locator('#application-runtime').selectOption(runtime.id);
    await page.locator('#application-kind').selectOption('fhir-bulk');
    await page.locator('#application-setting-workspaceDirectory').fill(native.workspace);
    await page.locator('#application-setting-port').fill('0');
    if (args['--credentials-file']) await page.locator('#application-setting-credentialsFile').fill(args['--credentials-file']);
    if (args['--environment-file']) await page.locator('#application-setting-environmentFile').fill(args['--environment-file']);
    const review = await clickResponse(page, 'Review application', '/api/applications/review');
    need(review.kind === 'fhir-bulk' && review.settings.workspaceDirectory === native.workspace &&
      review.command.args.includes(native.workspaceId), 'FHIR_APPLICATIONS_REVIEW_CHANGED');
    journal.configurationReview = review;
    await checkpoint();
    const saved = await clickResponse(page, 'Save application', '/api/applications/save');
    journal.applicationId = saved.applicationId;
  }
  await checkpoint();
  const selected = await appState();
  need((selected.settings.credentialsFile ?? null) === binding.credentialsFile &&
    (selected.settings.environmentFile ?? null) === binding.environmentFile,
  'FHIR_APPLICATIONS_SETTINGS_CHANGED', 'Continue with the existing application’s selected authentication and environment files.');
  await refreshedSelection();
  if (selected.phase === 'CONNECTING') {
    if (selected.adoption?.phase === 'INTERRUPTED' || selected.adoption?.phase === 'FAILED')
      await clickResponse(page, 'Continue runtime connection', '/api/applications/connect');
    await waitForApplication(value => value.release && value.phase !== 'CONNECTING', 'Original runtime connection');
    await refreshedSelection();
  }
  journal.configuration = await privateJSON('SAVED_APPLICATION.json', await appState());
  journal.screens.configuration = await saveScreen(page, '01-saved-application');
  await checkpoint();
}
async function runEdition(index) {
  const key = 'run-' + (index + 1);
  let part = journal.runs.find(item => item.key === key);
  if (part?.completedAt) return;
  if (!part) { part = { key, startedAt: now(), operationIds: [], screens: {} }; journal.runs.push(part); await checkpoint(); }
  let current = await refreshedSelection();
  if (!current.current?.active) {
    if (['INTERRUPTED', 'QUEUED'].includes(current.phase) || current.current?.phase === 'QUEUED') {
      await clickResponse(page, 'Continue original start', '/api/applications/recover');
    } else {
      const review = await clickResponse(page, 'Review start', '/api/applications/start-review');
      need(review.applicationId === journal.applicationId && review.command.args.includes(native.workspaceId),
        'FHIR_APPLICATIONS_START_REVIEW_CHANGED');
      part.startReview = review;
      await checkpoint();
      await clickResponse(page, 'Start reviewed application', '/api/applications/start');
    }
  }
  current = await waitForApplication(value => value.phase === 'RUNNING' && value.current?.privateUrl,
    'Original FHIR application startup');
  if (!part.operationIds.includes(current.current.id)) part.operationIds.push(current.current.id);
  part.startedApplication = await privateJSON(key + '-application-start.json', current);
  await checkpoint();
  await refreshedSelection();
  const [target] = await Promise.all([
    page.waitForEvent('popup', { timeout: 60000 }),
    page.getByRole('link', { name: 'Open application', exact: true }).click(),
  ]);
  watch(target);
  await fhirReady(target);
  const before = await originalState(current.current.privateUrl);
  part.originalBefore = await privateJSON(key + '-original-before.json', before);
  part.screens.overview = await saveScreen(target, key + '-fhir-overview');
  for (const section of ['exports', 'sources', 'datasets']) {
    await target.locator('[data-section="' + section + '"]').click();
    await fhirReady(target);
  }
  await target.locator('[data-section="query"]').click();
  await fhirReady(target);
  const buildId = native.buildIds.at(-1);
  await target.locator('[data-field="build-selector"]').selectOption(buildId);
  await fhirReady(target);
  await target.getByRole('button', { name: 'Clear query', exact: true }).click();
  await fhirReady(target);
  await target.locator('[data-field="query-limit"]').fill('5');
  const queryPath = '/api/builds/' + encodeURIComponent(buildId) + '/query';
  const [queryResponse] = await Promise.all([
    target.waitForResponse(value => new URL(value.url()).pathname === queryPath, { timeout: 120000 }),
    target.getByRole('button', { name: 'Run native query', exact: true }).click(),
  ]);
  const queried = await queryResponse.json();
  need(queryResponse.ok() && queried.response?.status === 200 &&
    queried.response.body?.page?.total === before.builds.find(item => item.id === buildId)?.rowCount,
  'FHIR_APPLICATIONS_ORIGINAL_QUERY_CHANGED');
  part.query = await privateJSON(key + '-native-query.json', { buildId, result: queried });
  await fhirReady(target);
  part.screens.query = await saveScreen(target, key + '-native-query');
  if (index === 0 && !journal.workspacePacket) {
    await target.locator('[data-section="delivery"]').click(); await fhirReady(target);
    const [download] = await Promise.all([
      target.waitForEvent('download', { timeout: 120000 }),
      target.getByRole('button', { name: 'Download editable workspace', exact: true }).click(),
    ]);
    const path = join(output, 'FHIR_Applications_Editable_Workspace.zip');
    await download.saveAs(path);
    need(await download.failure() === null && (await stat(path)).size > 0, 'FHIR_APPLICATIONS_DOWNLOAD_FAILED');
    journal.workspacePacket = await fileIdentity(path);
    part.screens.delivery = await saveScreen(target, key + '-delivery');
    await checkpoint();
  } else if (journal.workspacePacket) {
    const original = await fileIdentity(journal.workspacePacket.file);
    need(original.sha256 === journal.workspacePacket.sha256, 'FHIR_APPLICATIONS_DELIVERY_CHANGED');
  }
  const after = await originalState(current.current.privateUrl);
  part.originalAfter = await privateJSON(key + '-original-after.json', after);
  for (const name of ['sources', 'builds', 'plans', 'comparisons', 'operations']) {
    const field = name === 'operations' ? 'operationId' : 'id';
    need(JSON.stringify(before[name].map(row => row[field]).sort()) === JSON.stringify(after[name].map(row => row[field]).sort()),
      'FHIR_APPLICATIONS_REOPEN_CHANGED', 'Application receiving changed the original ' + name + ' collection.');
  }
  await target.close();
  await refreshedSelection();
  await clickResponse(page, 'Stop application', '/api/applications/stop');
  const stopped = await waitForApplication(value => value.phase === 'STOPPED' &&
    value.current?.id === current.current.id && !value.current.active, 'Original FHIR shutdown');
  part.stoppedApplication = await privateJSON(key + '-application-stopped.json', stopped);
  await refreshedSelection();
  part.screens.stopped = await saveScreen(page, key + '-application-stopped');
  part.completedAt = now();
  await checkpoint();
}
try {
  const existing = await readJSON(journalPath, true);
  if (existing) {
    need(existing.schema === SCHEMA && JSON.stringify(existing.binding) === JSON.stringify(binding),
      'FHIR_APPLICATIONS_RECEIVING_CHANGED', 'Use the same original output directory, receiving record and runtime.');
    journal = existing;
  } else {
    journal = { schema: SCHEMA, operation: OPERATION, binding, startedAt: now(),
      hosts: [], runs: [], applicationRequests: [], screens: {}, failures: [] };
  }
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const modelModule = await import(pathToFileURL(join(runtime.sourceRoot, PREFIX, 'distribution/runtime-workspace/model.mjs')).href);
  const serverModule = await import(pathToFileURL(join(runtime.sourceRoot, PREFIX, 'distribution/runtime-workspace/server.mjs')).href);
  const provider = await import(pathToFileURL(join(runtime.sourceRoot, PREFIX, 'sf30-seller-sdk/fhir_bulk/application-provider.mjs')).href);
  await provider.inspectFhirApplicationWorkspace(native.workspace, native.workspaceId);
  if (journal.runtimeSource) need(journal.runtimeSource.sourceCommit === runtime.sourceCommit &&
    journal.runtimeSource.sourceManifestSha256 === runtime.sourceManifestSha256, 'FHIR_APPLICATIONS_RUNTIME_CHANGED');
  else journal.runtimeSource = { sourceCommit: runtime.sourceCommit, sourceRoot: runtime.sourceRoot,
    sourceManifestSha256: runtime.sourceManifestSha256, profileId: runtime.profileId };
  await checkpoint();
  if (journal.completedAt) {
    const result = await readJSON(join(output, 'OPERATED_FHIR_APPLICATIONS.json'));
    need(result.workspaceId === native.workspaceId, 'FHIR_APPLICATIONS_RESULT_CHANGED');
    process.stdout.write(JSON.stringify({ state: 'complete', reopened: true, result: join(output, 'OPERATED_FHIR_APPLICATIONS.json') }) + '\n');
  } else {
    try { await stat(join(runtimeWorkspace, 'workspace.json')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await modelModule.createRuntimeWorkspace({ directory: runtimeWorkspace });
    }
    model = await modelModule.openRuntimeWorkspace({ directory: runtimeWorkspace });
    let playwright;
    try { playwright = await import('playwright'); }
    catch (error) {
      need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'FHIR_APPLICATIONS_PLAYWRIGHT_REQUIRED');
      playwright = createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
    }
    browser = await playwright.chromium.launchPersistentContext(join(output, 'browser-profile'), {
      headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1080 },
      ...(args['--chromium'] ? { executablePath: args['--chromium'] } : {}),
    });
    page = browser.pages()[0] ?? await browser.newPage(); watch(page);
    await openHost(serverModule.startRuntimeWorkspace);
    await ensureApplication();
    await runEdition(0);
    // Reopen the maintained Runtime workspace host and the same saved application.
    await host.close(); hostOwned = false;
    await openHost(serverModule.startRuntimeWorkspace);
    await refreshedSelection();
    await runEdition(1);
    await collectCaptures();
    need(errors.length === 0, 'FHIR_APPLICATIONS_BROWSER_ERRORS', JSON.stringify(errors));
    const state = await appState();
    const history = await model.applicationsHistory({ applicationId: journal.applicationId, limit: 30 });
    const operatedIds = journal.runs.flatMap(item => item.operationIds);
    need(new Set(operatedIds).size >= 2 && operatedIds.every(id => history.runs.some(item => item.id === id)),
      'FHIR_APPLICATIONS_HISTORY_CHANGED');
    const result = { schema: SCHEMA, operation: OPERATION, completedAt: now(), runtimeDirectory,
      runtimeWorkspace, source: journal.runtimeSource, nativeReceiving: binding,
      applicationId: journal.applicationId, workspace: native.workspace, workspaceId: native.workspaceId,
      sourceIds: native.sourceIds, buildIds: native.buildIds, originalExportOperationIds: native.operationIds,
      applicationOperationIds: operatedIds, state, history, runs: journal.runs,
      workspacePacket: journal.workspacePacket, browserErrors: errors,
      journey: journalPath };
    await privateJSON('OPERATED_FHIR_APPLICATIONS.json', result);
    journal.completedAt = result.completedAt; await checkpoint();
    process.stdout.write(JSON.stringify({ state: 'complete', result: join(output, 'OPERATED_FHIR_APPLICATIONS.json'),
      applicationId: journal.applicationId, workspaceId: native.workspaceId,
      applicationOperationIds: operatedIds, delivery: journal.workspacePacket }) + '\n');
  }
} catch (error) {
  if (journal) {
    journal.failures.push({ at: now(), code: error.code ?? null, message: error.message });
    await checkpoint().catch(() => {});
  }
  throw error;
} finally {
  await collectCaptures().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (hostOwned && host) await host.close().catch(() => {});
  if (model) await model.close().catch(() => {});
  await lease.close();
}
