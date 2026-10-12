#!/usr/bin/env node
// MIT. Operate the original eLTSS browser over completed native receiving.
import { createReadStream, constants } from 'node:fs';
import { mkdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  absolute, privateDirectory, readJSON, saveJSON, operationLease, need, now,
} from '../../distribution/runtime-workspace/storage.mjs';

const SCHEMA = 'stellar-forge.eltss-browser-receiving.v1';
const OPERATION = 'SCF-ELTSS-CAREPLAN-BROWSER-450E-20261012';
const NATIVE = 'SCF-ELTSS-CAREPLAN-WORKBENCH-450E-20261012';
const WORKSPACE = 'stellar-forge.eltss-workspace.v1';

export function originalEltssReceiving(value) {
  need(value?.schema === 'stellar-forge.eltss-operated.v1' &&
    value.operation === NATIVE && typeof value.completedAt === 'string' &&
    typeof value.workspace === 'string' && typeof value.workspaceId === 'string',
  'ELTSS_BROWSER_NATIVE_RECEIVING_REQUIRED', 'Open the completed original native care-plan operation.');
  for (const key of ['sourceIds', 'editionIds', 'reviewSetIds', 'assessmentIds', 'buildIds', 'handoffIds'])
    need(Array.isArray(value[key]) && value[key].length && value[key].every(id => /^[a-f0-9]{64}$/.test(id)),
      'ELTSS_BROWSER_NATIVE_SELECTION_REQUIRED', 'The original receiving result must retain its complete ' + key + '.');
  return value;
}
function originalURL(value) {
  const url = new URL(value);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && /^#[A-Za-z0-9_-]{43}$/.test(url.hash),
  'ELTSS_BROWSER_ORIGINAL_URL_REQUIRED', 'Use the private address emitted by the selected native operator.');
  return url;
}
export async function originalEltssState(urlText, native) {
  const url = originalURL(urlText);
  const response = await fetch(new URL('/api/state', url), {
    headers: { Authorization: 'Bearer ' + url.hash.slice(1) }, redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  need(response.ok, 'ELTSS_BROWSER_NATIVE_READ_FAILED', 'Original workspace returned HTTP ' + response.status);
  const state = await response.json();
  need(state.schema === WORKSPACE && state.workspaceId === native.workspaceId,
    'ELTSS_BROWSER_WORKSPACE_CHANGED', 'The selected original workspace UUID changed.');
  for (const [key, ids] of [
    ['sources', native.sourceIds], ['editions', native.editionIds], ['reviewSets', native.reviewSetIds],
    ['assessments', native.assessmentIds], ['builds', native.buildIds], ['handoffs', native.handoffIds],
    ['decisions', native.decisionIds ?? []], ['corrections', native.correctionIds ?? []],
    ['editionComparisons', native.editionComparisonIds ?? []], ['receivings', native.receivingIds ?? []],
    ['artifacts', native.artifactIds ?? []],
  ]) {
    const observed = new Set((state[key] ?? []).map(row => row.id));
    need(ids.every(id => observed.has(id)), 'ELTSS_BROWSER_ORIGINAL_RECORD_MISSING',
      'The original ' + key + ' selection is absent from the selected workspace.');
  }
  return state;
}
async function fileIdentity(path) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink(), 'ELTSS_BROWSER_FILE_REQUIRED');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
    hash.update(chunk); size += chunk.length;
  }
  need(size === info.size, 'ELTSS_BROWSER_FILE_CHANGED');
  return { file: path, bytes: size, sha256: hash.digest('hex') };
}
export async function eltssBrowserReady(page) {
  await page.waitForFunction(() => {
    const content = document.querySelector('#content'), status = document.querySelector('#connection-state');
    const error = document.querySelector('#error');
    return content?.getAttribute('aria-busy') === 'false' &&
      (status?.textContent === 'Private workspace connected' || error && !error.hidden);
  }, null, { timeout: 120000 });
  const error = page.locator('#error');
  need(!await error.isVisible(), 'ELTSS_BROWSER_OPERATOR_ERROR', await error.textContent());
}

export async function operateEltssBrowser({ page, url, native, output }) {
  originalEltssReceiving(native); originalURL(url); output = absolute(output);
  await mkdir(output, { recursive: true, mode: 0o700 }); await privateDirectory(output);
  const lease = await operationLease(join(output, 'browser.lock'));
  const journalPath = join(output, 'BROWSER_JOURNEY.json'), resultPath = join(output, 'OPERATED_ELTSS_BROWSER.json');
  const binding = { nativeOperation: native.operation, nativeCompletedAt: native.completedAt,
    workspace: native.workspace, workspaceId: native.workspaceId,
    sourceIds: native.sourceIds, editionIds: native.editionIds, reviewSetIds: native.reviewSetIds,
    assessmentIds: native.assessmentIds, buildIds: native.buildIds, handoffIds: native.handoffIds };
  let journal;
  const errors = [], onError = error => errors.push({ at: now(), message: error.message });
  page.on('pageerror', onError);
  const save = async (name, value) => {
    const path = join(output, name); await saveJSON(path, value, true); return fileIdentity(path);
  };
  const checkpoint = async () => { journal.updatedAt = now(); await saveJSON(journalPath, journal, true); };
  const progress = async step => {
    journal.activeStep = { step, at: now() }; await checkpoint();
    process.stdout.write(JSON.stringify({ operation: OPERATION, workspaceId: native.workspaceId, step }) + '\n');
  };
  const screen = async name => {
    const path = join(output, name + '.png');
    await page.screenshot({ path, fullPage: true });
    const result = await fileIdentity(path); journal.screens[name] = result; await checkpoint(); return result;
  };
  const nav = async view => {
    await progress('Open ' + view);
    await page.locator('nav [data-view="' + view + '"]').click(); await eltssBrowserReady(page);
  };
  const select = async (key, value) => {
    await progress('Select ' + key + ': ' + value);
    await page.locator('[data-select="' + key + '"]').selectOption(value); await eltssBrowserReady(page);
  };
  const selectedResponse = async (action, path) => {
    await progress('Native response ' + path);
    const [response] = await Promise.all([
      page.waitForResponse(value => new URL(value.url()).pathname === path, { timeout: 120000 }),
      action(),
    ]);
    const body = await response.json();
    need(response.ok(), 'ELTSS_BROWSER_ORIGINAL_ACTION_FAILED', JSON.stringify(body));
    await eltssBrowserReady(page); return body;
  };
  const receive = async (key, action, filename, expectedBytes = null) => {
    const retained = journal.downloads[key];
    if (retained) {
      const current = await fileIdentity(retained.file);
      need(current.bytes === retained.bytes && current.sha256 === retained.sha256,
        'ELTSS_BROWSER_RETAINED_FILE_CHANGED');
      return retained;
    }
    await progress('Receive ' + key);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), action()]);
    const path = join(output, filename); await download.saveAs(path);
    need(await download.failure() === null, 'ELTSS_BROWSER_DOWNLOAD_FAILED');
    const result = await fileIdentity(path);
    need(expectedBytes === null || result.bytes === expectedBytes, 'ELTSS_BROWSER_ORIGINAL_SIZE_CHANGED');
    journal.downloads[key] = result; await checkpoint(); return result;
  };
  try {
    try { journal = await readJSON(journalPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      journal = { schema: SCHEMA, operation: OPERATION, binding, startedAt: now(),
        screens: {}, downloads: {}, observations: {}, failures: [] };
    }
    need(JSON.stringify(journal.binding) === JSON.stringify(binding),
      'ELTSS_BROWSER_RECEIVING_CHANGED', 'Continue the same completed native receiving selection.');
    const before = await originalEltssState(url, native);
    if (journal.completedAt) {
      const result = await readJSON(resultPath);
      for (const file of [...Object.values(result.screens), ...Object.values(result.downloads)]) {
        const current = await fileIdentity(file.file);
        need(current.sha256 === file.sha256 && current.bytes === file.bytes, 'ELTSS_BROWSER_RETAINED_FILE_CHANGED');
      }
      return result;
    }
    journal.observations.before = await save('ORIGINAL_WORKSPACE_BEFORE.json', before);
    await checkpoint();
    await page.goto(url); await eltssBrowserReady(page);
    await screen('01-overview');

    await nav('sources');
    for (const [index, sourceId] of native.sourceIds.entries()) {
      await select('source', sourceId);
      const descriptor = before.sources.find(item => item.id === sourceId);
      await receive('source-' + sourceId,
        () => page.locator('[data-action="download-source"][data-id="' + sourceId + '"]').click(),
        'SOURCE_' + (index + 1) + '.bin', descriptor.bytes);
    }
    await screen('02-original-sources');

    await nav('acquisition');
    await screen('03-source-acquisition');

    await nav('careplans');
    for (const editionId of native.editionIds) {
      await page.locator('[data-action="open-edition"][data-id="' + editionId + '"]').click();
      await eltssBrowserReady(page);
    }
    need(await page.locator('[data-action="graph-node"]').count() >= native.carePlanIds.length,
      'ELTSS_BROWSER_CAREPLAN_SELECTION_MISSING');
    await screen('04-careplans-and-references');

    await nav('requirements'); await select('reviewSet', native.reviewSetIds.at(-1));
    need(await page.locator('.field-list [data-action="field-select"]').count() === 56,
      'ELTSS_BROWSER_COMPLETE_FIELD_REVIEW_REQUIRED');
    await page.locator('[data-action="field-select"][data-index="0"]').click();
    await screen('05-complete-field-review');
    await page.locator('[data-action="field-select"][data-index="55"]').click();
    await screen('06-final-published-field');

    await nav('review');
    const assessmentId = native.correctedAssessmentId ?? native.assessmentIds.at(-1);
    const cellsPath = '/api/assessments/' + encodeURIComponent(assessmentId) + '/cells';
    let cells = await selectedResponse(
      () => page.locator('[data-select="assessment"]').selectOption(assessmentId), cellsPath);
    const cellPages = [cells], offsets = new Set([cells.offset]);
    while (cells.nextOffset !== null && cells.nextOffset !== undefined) {
      need(!offsets.has(cells.nextOffset), 'ELTSS_BROWSER_ASSESSMENT_CURSOR_REPEATED');
      cells = await selectedResponse(
        () => page.locator('[data-action="page-next"][data-key="assessmentCells"]').click(), cellsPath);
      offsets.add(cells.offset); cellPages.push(cells);
    }
    need(cellPages.reduce((sum, item) => sum + item.rows.length, 0) === cellPages[0].total,
      'ELTSS_BROWSER_ASSESSMENT_INCOMPLETE');
    journal.observations.fieldCells = await save('ORIGINAL_ASSESSMENT_PAGES.json', { assessmentId, pages: cellPages });
    await receive('assessment-' + assessmentId,
      () => page.locator('[data-action="download-assessment"][data-id="' + assessmentId + '"]').click(),
      'COMPLETE_FIELD_CELLS.jsonl');
    await screen('07-assessment-and-decisions');

    await nav('corrections');
    if (native.editionComparisonIds?.length) {
      const id = native.editionComparisonIds.at(-1);
      await select('editionComparison', id);
      await receive('edition-changes-' + id,
        () => page.locator('[data-action="download-edition-comparison"][data-id="' + id + '"]').click(),
        'COMPLETE_EDITION_CHANGES.jsonl');
    }
    await screen('08-authored-corrections');

    await nav('datasets'); const buildId = native.buildIds.at(-1);
    await select('build', buildId);
    await page.locator('form[data-submit="native-query"] input[data-type="integer"]').fill('1');
    const queryPath = '/api/builds/' + encodeURIComponent(buildId) + '/query';
    let query = await selectedResponse(
      () => page.getByRole('button', { name: 'Run native query', exact: true }).click(), queryPath);
    need(query.response?.status === 200, 'ELTSS_BROWSER_NATIVE_QUERY_FAILED');
    const queries = [query];
    if (query.response.body?.page?.nextCursor) {
      query = await selectedResponse(
        () => page.getByRole('button', { name: 'Next page', exact: true }).click(), queryPath);
      need(query.response?.status === 200, 'ELTSS_BROWSER_NATIVE_QUERY_FAILED'); queries.push(query);
    }
    journal.observations.query = await save('ORIGINAL_NATIVE_QUERY.json', { buildId, queries });
    await receive('dataset-' + buildId,
      () => page.locator('[data-action="download-dataset"][data-id="' + buildId + '"]').click(),
      'COMPLETE_NATIVE_DATASET.zip');
    await receive('native-packet-' + buildId,
      () => page.locator('[data-action="download-packet"][data-id="' + buildId + '"]').click(),
      'ORIGINAL_CUSTOMER_PACKET.zip');
    await screen('09-native-datasets');

    await nav('delivery'); const handoffId = native.handoffIds.at(-1);
    await select('handoff', handoffId);
    await receive('handoff-' + handoffId,
      () => page.locator('[data-action="download-handoff"][data-id="' + handoffId + '"]').click(),
      'COMPLETE_CAREPLAN_HANDOFF.zip');
    await receive('workspace',
      () => page.getByRole('button', { name: 'Download complete editable workspace', exact: true }).click(),
      'COMPLETE_EDITABLE_WORKSPACE.zip');
    await screen('10-complete-delivery');

    await page.setViewportSize({ width: 390, height: 844 });
    await nav('overview'); await screen('11-compact-overview');
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.reload(); await eltssBrowserReady(page); await screen('12-reopened-workspace');
    const after = await originalEltssState(url, native);
    journal.observations.after = await save('ORIGINAL_WORKSPACE_AFTER.json', after);
    for (const key of ['sources', 'plans', 'builds', 'editions', 'reviewSets', 'assessments', 'decisions',
      'corrections', 'editionComparisons', 'handoffs', 'receivings', 'artifacts']) {
      need(JSON.stringify((before[key] ?? []).map(row => row.id).sort()) ===
        JSON.stringify((after[key] ?? []).map(row => row.id).sort()),
      'ELTSS_BROWSER_REOPEN_CHANGED', 'The original ' + key + ' identities changed during the receiving view.');
    }
    need(errors.length === 0, 'ELTSS_BROWSER_SCRIPT_FAILED', JSON.stringify(errors));
    const result = { schema: SCHEMA, operation: OPERATION, completedAt: now(), binding,
      workspace: native.workspace, workspaceId: native.workspaceId, sourceIds: native.sourceIds,
      editionIds: native.editionIds, reviewSetIds: native.reviewSetIds, assessmentIds: native.assessmentIds,
      buildIds: native.buildIds, handoffIds: native.handoffIds, fieldCount: 56,
      assessedCells: cellPages[0].total, screens: journal.screens, downloads: journal.downloads,
      observations: journal.observations, browserErrors: errors, journey: journalPath };
    await saveJSON(resultPath, result, true); journal.completedAt = result.completedAt; await checkpoint();
    return result;
  } catch (error) {
    if (journal) {
      journal.failures.push({ at: now(), code: error.code ?? null, message: error.message });
      await checkpoint().catch(() => {});
    }
    throw error;
  } finally {
    page.off('pageerror', onError); await lease.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    need(['--receiving', '--startup', '--out', '--playwright', '--chromium'].includes(key) &&
      value && !value.startsWith('--') && !Object.hasOwn(options, key),
    'ELTSS_BROWSER_ARGUMENTS', 'Use --receiving OPERATED_ELTSS.json --startup ORIGINAL_STARTUP.json --out PRIVATE_OUTPUT.');
    options[key] = absolute(value);
  }
  for (const key of ['--receiving', '--startup', '--out'])
    need(options[key], 'ELTSS_BROWSER_ARGUMENT_REQUIRED', key + ' is required.');
  need(Number(process.versions.node.split('.')[0]) >= 22, 'ELTSS_BROWSER_NODE_REQUIRED');
  const native = originalEltssReceiving(await readJSON(options['--receiving']));
  const startup = await readJSON(options['--startup']);
  need(startup.schema === 'stellar-forge.eltss-startup.v1' &&
    startup.workspace === native.workspace && startup.workspaceId === native.workspaceId,
  'ELTSS_BROWSER_STARTUP_CHANGED');
  await originalEltssState(startup.url, native);
  let playwright;
  if (options['--playwright']) playwright = await import(pathToFileURL(options['--playwright']).href);
  else {
    try { playwright = await import('playwright'); }
    catch (error) {
      need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'ELTSS_BROWSER_PLAYWRIGHT_REQUIRED');
      playwright = createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
    }
  }
  const browser = await playwright.chromium.launch({
    headless: true, ...(options['--chromium'] ? { executablePath: options['--chromium'] } : {}),
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1080 } });
    const page = await context.newPage();
    const result = await operateEltssBrowser({ page, url: startup.url, native, output: options['--out'] });
    process.stdout.write(JSON.stringify({ state: 'complete', operation: result.operation,
      workspaceId: result.workspaceId, result: join(options['--out'], 'OPERATED_ELTSS_BROWSER.json'),
      screens: Object.keys(result.screens).length, files: Object.keys(result.downloads).length }) + '\n');
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'ELTSS_BROWSER', message: error.message }) + '\n'); process.exitCode = 1; });
