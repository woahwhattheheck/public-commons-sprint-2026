#!/usr/bin/env node
// MIT. One complete browser receiving operation over an original immutable WQX plan.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, readFile, realpath, lstat, chmod, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../../routescan/quota.mjs';
import { writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { startWaterQualityWorkspace } from '../workspace.mjs';
import { reviewWaterQualityManaged } from '../managed.mjs';
import { openWatersCanonical, openWatersHash } from '../openwaters.mjs';
import { REVIEW_SHEET_SCHEMA, normalizeReviewSheetDocument, reviewSheetSource, iterateReviewSheetTargets } from './model.mjs';
import { reviewSheetCsv, reviewSheetTsv, parseReviewSheetCsv } from './csv.mjs';
import { readReviewSheet, exportReviewSheet } from './workflow.mjs';

export const REVIEW_SHEET_BROWSER_SCHEMA = 'starforge.wqx-review-sheet-browser.v1';
export const REVIEW_SHEET_BROWSER_FORMATS = Object.freeze([
  'json', 'csv', 'tsv', 'report', 'native-locations', 'native-results',
  'native-crosswalk', 'native-report', 'native-references', 'native-bundle', 'bundle',
]);
const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (actual, expected, message) => assert.equal(openWatersCanonical(actual), openWatersCanonical(expected), message);
const compact = document => normalizeReviewSheetDocument(document);
const gc = () => globalThis.gc?.();
const retainedSource = { async request() { throw new Error('Reopen the retained original source for this receiving operation.'); } };
const privateOptions = { transport: retainedSource };

function selectedPath(value, name) {
  assert(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' && !value.includes('\0'),
    'Provide an absolute canonical ' + name + '.');
  return value;
}
function separate(left, right) {
  return left !== right && !left.startsWith(right + sep) && !right.startsWith(left + sep);
}
function configuration(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Provide the complete browser receiving configuration.');
  const keys = ['schema', 'operationId', 'directory', 'outputDirectory', 'receiverDirectory', 'sourcePlanId',
    'expectedSourcePlanSha256', 'expectedReviewSha256', 'expectedCaptureSha256', 'expectedManagedSourceSha256',
    'field', 'expectedValue', 'expectedTargets', 'reason', 'keepField', 'keepReason', 'newPlanId', 'reviewId',
    'playwrightModule', 'browserExecutable', 'browserArgs', 'browserLibraryPaths', 'browserTempDirectory', 'timeoutMs'];
  for (const name of Object.keys(input)) assert(keys.includes(name), 'Unknown browser receiving option: ' + name);
  assert(input.schema === undefined || input.schema === REVIEW_SHEET_BROWSER_SCHEMA, 'Use the current receiving configuration schema.');
  for (const name of ['operationId', 'sourcePlanId', 'newPlanId', 'reviewId'])
    assert(ID.test(input[name] ?? ''), 'Provide a stable ' + name + '.');
  assert(input.sourcePlanId !== input.newPlanId, 'Use a new native receiving plan name.');
  assert(SHA.test(input.expectedSourcePlanSha256 ?? ''), 'Bind the exact original source plan SHA-256.');
  for (const name of ['expectedReviewSha256', 'expectedCaptureSha256', 'expectedManagedSourceSha256'])
    assert(input[name] === undefined || SHA.test(input[name]), 'Use the exact ' + name + '.');
  for (const name of ['reason', 'keepReason'])
    assert(typeof input[name] === 'string' && input[name].trim() && input[name].length <= 2000, 'Provide the complete ' + name + '.');
  assert(input.expectedValue === undefined || typeof input.expectedValue === 'string', 'expectedValue is an exact string.');
  assert(input.expectedTargets === undefined || Number.isSafeInteger(input.expectedTargets) && input.expectedTargets > 50,
    'The full receiving cohort must span more than one displayed page.');
  assert(input.browserArgs === undefined || Array.isArray(input.browserArgs) && input.browserArgs.every(x => typeof x === 'string'),
    'browserArgs is an array of existing Chromium launch options.');
  assert(input.browserLibraryPaths === undefined || Array.isArray(input.browserLibraryPaths), 'browserLibraryPaths is an array of existing runtime directories.');
  for (const path of input.browserLibraryPaths ?? []) selectedPath(path, 'Chromium library directory');
  const timeoutMs = input.timeoutMs ?? 240000;
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000, 'Choose a supported native receiving timeout.');
  const outputDirectory = selectedPath(input.outputDirectory, 'output directory');
  const directory = selectedPath(input.directory, 'original project directory');
  const receiverDirectory = selectedPath(input.receiverDirectory ?? join(outputDirectory, 'received-project'), 'receiving project directory');
  assert(separate(directory, outputDirectory) && separate(directory, receiverDirectory) && receiverDirectory !== outputDirectory && !outputDirectory.startsWith(receiverDirectory + sep),
    'Keep the original project independent of the receiving outputs and received project.');
  return { ...input, schema: REVIEW_SHEET_BROWSER_SCHEMA, directory, outputDirectory, receiverDirectory,
    field: input.field ?? 'RESULT_STATUS', keepField: input.keepField ?? 'projectId',
    browserArgs: input.browserArgs ?? [], browserLibraryPaths: input.browserLibraryPaths ?? [], timeoutMs };
}
async function optionalJson(path, max = 4 * 1024 * 1024) {
  try { return await readPrivateJson(path, max); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function fileIdentity(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    assert(before.isFile() && before.nlink === 1 && !(before.mode & 0o077), 'Use an original private regular receiving file.');
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      digest.update(chunk); bytes += chunk.length;
    }
    const after = await file.stat(), named = await lstat(path);
    assert(before.size === bytes && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && before.ino === named.ino && before.dev === named.dev && !named.isSymbolicLink(),
    'The receiving file changed while it was read.');
    return { bytes, sha256: digest.digest('hex') };
  } finally { await file.close(); }
}
async function immutableBytes(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    equal(await fileIdentity(path), { bytes: bytes.length, sha256: hash(bytes) }, 'The original retained receiving file is unchanged.');
  }
  return { path, bytes: bytes.length, sha256: hash(bytes) };
}
function description(value, filename) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return { filename, bytes: bytes.length, sha256: hash(bytes) };
}
function nativeContent(plan) {
  return { locations: openWatersHash(plan.locations), activities: openWatersHash(plan.activities),
    results: openWatersHash(plan.results), summary: openWatersHash(plan.summary),
    references: openWatersHash(plan.references) };
}
function assertNative(plan, request) {
  assert.equal(plan.captureSha256, request.source.captureSha256, 'The original source capture remains exact.');
  assert.equal(plan.reviewSha256, request.source.reviewSha256, 'The original scientific review remains exact.');
  equal(nativeContent(plan), request.nativeContent, 'All original native rows, identifiers, fields, units, limits and issues remain exact.');
}
async function currentRecord(project, reviewId) {
  try { return await readReviewSheet({ project, reviewId }); }
  catch (error) { if (error.code === 'WQX_REVIEW_SHEET_NOT_FOUND') return null; throw error; }
}
function assertReview(record, request, previewSha256) {
  assert.equal(record.reviewId, request.reviewId);
  assert.equal(record.newPlanId, request.newPlanId);
  assert.equal(record.document.sourcePlanSha256, request.source.sourcePlanSha256);
  equal(compact(record.document), request.document, 'Every source-bound decision and explicit keep reason is retained.');
  if (previewSha256) assert.equal(record.previewSha256, previewSha256, 'Reopen the same reviewed native preview.');
}
async function closedProjectRead(directory, request, expectedReviewSha256) {
  const project = await openWaterQualityProject(directory, privateOptions);
  try {
    const record = await readReviewSheet({ project, reviewId: request.reviewId });
    assert.equal(record.status, 'COMPLETE'); assertReview(record, request);
    if (expectedReviewSha256) assert.equal(record.reviewSha256, expectedReviewSha256);
    const source = await project.readOpenWaters(request.source.sourcePlanId);
    assert.equal(source.planSha256, request.source.sourcePlanSha256); assertNative(source, request);
    const plan = await project.readOpenWaters(request.newPlanId); assertNative(plan, request);
    return { reviewSha256: record.reviewSha256, newPlanSha256: plan.planSha256, captureSha256: plan.captureSha256 };
  } finally { await project.close(); }
}

/**
 * Execute or resume one original browser receiving operation. The complete native
 * planner, decision workflow, table codec and original workspace own all domain work.
 */
export async function runReviewSheetBrowserReceiving(input) {
  const config = configuration(input);
  await privateDirectory(config.outputDirectory);
  assert.equal(await realpath(config.outputDirectory), config.outputDirectory);
  return withPrivateLock(config.outputDirectory, 'browser-receiving.lock', async () => {
    const directories = {};
    for (const name of ['draft', 'exports', 'screenshots', 'temporary'])
      directories[name] = await privateDirectory(join(config.outputDirectory, name));
    await privateDirectory(dirname(config.receiverDirectory));
    let workspace, context, page, browser, request, progress, stage = 'open-original-source';
    const errors = [], requests = [], selections = [], assets = [];
    const requestFile = join(config.outputDirectory, 'request.json');
    const progressFile = join(config.outputDirectory, 'progress.json');
    const resultFile = join(config.outputDirectory, 'result.json');
    async function checkpoint(next, extra = {}) {
      stage = next;
      progress = { ...(progress ?? {}), ...extra, schema: REVIEW_SHEET_BROWSER_SCHEMA,
        operationId: config.operationId, requestSha256: request?.requestSha256 ?? null,
        stage, updatedAt: new Date().toISOString() };
      await atomicJson(config.outputDirectory, 'progress.json', progress);
    }
    function retainedPath(value) {
      assert(typeof value === 'string' && !isAbsolute(value) && !value.split(/[\\/]/).some(x => x === '..' || !x),
        'Use a retained relative receiving filename.');
      return join(config.outputDirectory, value);
    }
    async function rememberFile(path, meta = {}) {
      return { ...meta, file: relative(config.outputDirectory, path), ...await fileIdentity(path) };
    }
    async function checkFiles(records) {
      for (const item of records) equal(await fileIdentity(retainedPath(item.file)),
        { bytes: item.bytes, sha256: item.sha256 }, 'The completed original receiving member is still exact.');
    }
    async function stopWorkspace() {
      await context?.close(); context = null; page = null;
      if (workspace) { await workspace.close(); workspace = null; }
    }
    try {
      workspace = await startWaterQualityWorkspace({ directory: config.directory, ...privateOptions });
      const sourcePlan = await workspace.project.readOpenWaters(config.sourcePlanId);
      assert.equal(sourcePlan.planSha256, config.expectedSourcePlanSha256);
      for (const [option, field] of [['expectedReviewSha256', 'reviewSha256'], ['expectedCaptureSha256', 'captureSha256']])
        if (config[option]) assert.equal(sourcePlan[field], config[option]);
      const source = reviewSheetSource(sourcePlan);
      const cohort = [...iterateReviewSheetTargets(sourcePlan, { kind: 'result', field: config.field, attentionOnly: false })];
      assert(cohort.length > 50, 'Select a real, repeated receiving field spanning multiple displayed pages.');
      assert.equal(cohort.length, sourcePlan.results.length, 'The selected field covers every original native result.');
      if (config.expectedTargets !== undefined) assert.equal(cohort.length, config.expectedTargets);
      const values = [...new Set(cohort.map(row => row.currentValue))];
      assert.equal(values.length, 1, 'Choose one exact existing receiving value across the complete cohort.');
      const value = values[0];
      if (config.expectedValue !== undefined) assert.equal(value, config.expectedValue);
      assert(cohort.every(row => row.type === 'text' || row.type === 'enum'), 'Use an original text or enum receiving field.');
      const keepTargets = [...iterateReviewSheetTargets(sourcePlan, { kind: 'settings', field: config.keepField, attentionOnly: false })];
      assert.equal(keepTargets.length, 1, 'Select one original receiving setting for the explicit keep reason.');
      const keepTarget = keepTargets[0];
      const initialDocument = compact({ schema: REVIEW_SHEET_SCHEMA, sourcePlanId: source.sourcePlanId,
        sourcePlanSha256: source.sourcePlanSha256,
        decisions: cohort.map(row => ({ targetId: row.targetId, action: 'set', value, reason: config.reason })) });
      const document = compact({ ...initialDocument, decisions: [...initialDocument.decisions,
        { targetId: keepTarget.targetId, action: 'keep', reason: config.keepReason }] });
      const managed = await reviewWaterQualityManaged({ directory: config.directory, planId: source.sourcePlanId,
        reviewId: source.reviewId, ...(config.expectedManagedSourceSha256 ? { expectedSourceSha256: config.expectedManagedSourceSha256 } : {}) });
      const driverBytes = await readFile(fileURLToPath(import.meta.url));
      const content = { schema: REVIEW_SHEET_BROWSER_SCHEMA, operationId: config.operationId, source,
        newPlanId: config.newPlanId, reviewId: config.reviewId, document, documentSha256: openWatersHash(document),
        nativeContent: nativeContent(sourcePlan), selection: { kind: 'result', field: config.field, value,
          targets: cohort.length, targetIdsSha256: openWatersHash(cohort.map(row => row.targetId).sort()),
          reason: config.reason, keep: { targetId: keepTarget.targetId, field: config.keepField,
            currentValue: keepTarget.currentValue, reason: config.keepReason } },
        runtime: { managedSource: managed.source, driver: { bytes: driverBytes.length, sha256: hash(driverBytes) } } };
      request = { ...content, requestSha256: openWatersHash(content) };
      const prior = await optionalJson(requestFile);
      if (prior) equal(prior, request, 'Resume this original operation with its exact source, receiving decisions and source code.');
      else await atomicJson(config.outputDirectory, 'request.json', request, { exclusive: true });
      progress = await optionalJson(progressFile);
      if (progress) assert.equal(progress.requestSha256, request.requestSha256);
      const completed = await optionalJson(resultFile);
      if (completed) {
        assert.equal(completed.status, 'PASS'); assert.equal(completed.requestSha256, request.requestSha256);
        await checkFiles([...completed.files, ...completed.downloads, ...completed.screenshots]);
        await stopWorkspace();
        await closedProjectRead(config.directory, request, completed.review.reviewSha256);
        await closedProjectRead(config.receiverDirectory, request, completed.review.reviewSha256);
        return { ...completed, reused: true };
      }
      await checkpoint('source-and-operation-bound', { startedAt: progress?.startedAt ?? new Date().toISOString(),
        exports: progress?.exports ?? {}, receiverExports: progress?.receiverExports ?? {}, files: progress?.files ?? {},
        screenshots: progress?.screenshots ?? {} });
      const { chromium } = createRequire(import.meta.url)(config.playwrightModule ?? process.env.PLAYWRIGHT_MODULE ?? 'playwright');
      const temp = config.browserTempDirectory ? await privateDirectory(selectedPath(config.browserTempDirectory, 'browser temp directory')) : null;
      browser = await chromium.launch({ headless: true,
        ...(config.browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?
          { executablePath: config.browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
        args: [...new Set(['--no-sandbox', '--disable-dev-shm-usage', ...config.browserArgs])],
        ...(temp || config.browserLibraryPaths.length ? { env: { ...process.env,
          ...(temp ? { TMPDIR: temp, TMP: temp, TEMP: temp } : {}),
          ...(config.browserLibraryPaths.length ? { LD_LIBRARY_PATH: [...config.browserLibraryPaths, process.env.LD_LIBRARY_PATH ?? ''].filter(Boolean).join(':') } : {}) } : {}) });
      const browserVersion = browser.version();
      async function idle() {
        await page.waitForFunction(() => document.getElementById('tab-review-sheets').getAttribute('aria-busy') === 'false');
      }
      async function jsonResponse(response) {
        const value = await response.json();
        assert(response.ok(), JSON.stringify(value).slice(0,4000)); return value;
      }
      async function clickForJson(selector, pathname, method = 'POST', predicate = () => true) {
        const waiting = page.waitForResponse(response => response.request().method() === method &&
          new URL(response.url()).pathname === pathname && predicate(new URL(response.url())));
        await page.locator(selector).click();
        const result = await jsonResponse(await waiting); await idle(); return result;
      }
      async function visibleDetails(selector) {
        const details = page.locator(selector).locator('xpath=ancestor::details[1]');
        if (await details.count() && !(await details.evaluate(node => node.open))) await details.locator(':scope > summary').click();
      }
      async function openPage(label) {
        context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
        page = await context.newPage(); page.setDefaultTimeout(config.timeoutMs); page.setDefaultNavigationTimeout(config.timeoutMs);
        page.on('pageerror', error => errors.push({ workspace: label, message: error.message }));
        page.on('request', incoming => {
          const url = new URL(incoming.url());
          if (incoming.method() === 'POST') requests.push({ workspace: label, method: 'POST', path: url.pathname });
          if (url.pathname.endsWith('/targets') && url.searchParams.get('limit') === '1000')
            selections.push({ workspace: label, path: url.pathname, query: Object.fromEntries(url.searchParams) });
        });
        await page.goto(workspace.url);
        await page.waitForFunction(() => Boolean(document.querySelector('[data-tab="review-sheets"]')));
        await page.locator('[data-tab="review-sheets"]').click();
        await page.locator('#rs-load-form').waitFor({ state: 'visible' });
        for (const file of managed.source.files.filter(item => item.path.startsWith('ui/'))) {
          const path = file.path === 'ui/index.html' ? '/' : '/' + file.path.slice(3);
          const response = await page.request.get(workspace.url + path);
          assert(response.ok(), 'The original managed browser asset is served.');
          const body = await response.body();
          assert.equal(body.length, file.bytes); assert.equal(hash(body), file.sha256);
          assets.push({ workspace: label, path, bytes: body.length, sha256: hash(body) }); await response.dispose();
        }
        assert.equal(managed.source.files.filter(item => item.path.startsWith('ui/')).length, 5,
          'This receiving operation uses the complete five-asset browser edition.');
      }
      async function openSource() {
        await page.waitForFunction(id => [...document.getElementById('rs-source-plan').options].some(row => row.value === id), source.sourcePlanId);
        await page.selectOption('#rs-source-plan', source.sourcePlanId);
        const opened = await clickForJson('#rs-load', '/api/review-sheets/source/' + encodeURIComponent(source.sourcePlanId), 'GET');
        equal(opened, source, 'The browser opened the same immutable source identity.');
      }
      async function filter() {
        const pathname = '/api/review-sheets/source/' + encodeURIComponent(source.sourcePlanId) + '/targets';
        if (await page.inputValue('#rs-field') !== config.field) {
          const waiting = page.waitForResponse(response => response.request().method() === 'GET' &&
            new URL(response.url()).pathname === pathname && new URL(response.url()).searchParams.get('field') === config.field);
          await page.fill('#rs-field', config.field); await jsonResponse(await waiting); await idle();
        }
        if (await page.inputValue('#rs-kind') !== 'result') {
          const waiting = page.waitForResponse(response => response.request().method() === 'GET' &&
            new URL(response.url()).pathname === pathname && new URL(response.url()).searchParams.get('kind') === 'result');
          await page.selectOption('#rs-kind', 'result'); await jsonResponse(await waiting); await idle();
        }
        if (await page.locator('#rs-attention').isChecked()) {
          const waiting = page.waitForResponse(response => response.request().method() === 'GET' &&
            new URL(response.url()).pathname === pathname && new URL(response.url()).searchParams.get('attentionOnly') === 'false');
          await page.locator('#rs-attention').uncheck(); await jsonResponse(await waiting); await idle();
        }
        assert.equal(await page.locator('#rs-targets tr').count(), 50);
        const first = await page.locator('#rs-targets tr').first().textContent();
        await clickForJson('#rs-next', pathname, 'GET', url => url.searchParams.get('offset') === '50');
        assert.notEqual(await page.locator('#rs-targets tr').first().textContent(), first);
        await clickForJson('#rs-previous', pathname, 'GET', url => url.searchParams.get('offset') === '0');
      }
      async function receiveDownload(selector, directory, expected, { retain = true } = {}) {
        const waiting = page.waitForEvent('download');
        await page.locator(selector).click(); const download = await waiting;
        if (expected.filename) assert.equal(download.suggestedFilename(), expected.filename);
        const temporary = join(directories.temporary, 'download-' + randomUUID());
        try {
          await download.saveAs(temporary); await chmod(temporary, 0o600);
          assert.equal(await download.failure(), null);
          const actual = await fileIdentity(temporary);
          if (expected.bytes !== undefined) equal(actual, { bytes: expected.bytes, sha256: expected.sha256 }, 'The actual browser download matches the original native export bytes.');
          let file = null;
          if (retain) {
            const name = expected.filename ?? download.suggestedFilename();
            assert(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name), 'Use an original safe native download filename.');
            const target = join(directory, name);
            const handle = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); }
            try { await link(temporary, target); }
            catch (error) { if (error.code !== 'EEXIST') throw error; equal(await fileIdentity(target), actual, 'The original browser download already exists with the same bytes.'); }
            await unlink(temporary);
            const folder = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await folder.sync(); } finally { await folder.close(); }
            file = relative(config.outputDirectory, target);
          }
          return { filename: expected.filename ?? download.suggestedFilename(), ...actual,
            ...(file ? { file } : {}), downloadedAt: new Date().toISOString() };
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); await download.delete().catch(() => {}); }
      }
      async function screenshot(name) {
        if (progress.screenshots[name]) { await checkFiles([progress.screenshots[name]]); return; }
        const file = join(directories.screenshots, name + '.png');
        await page.screenshot({ path: file, fullPage: false }); await chmod(file, 0o600);
        progress.screenshots[name] = await rememberFile(file, { label: name });
        await checkpoint(stage);
      }
      async function readOnly() {
        assert(await page.locator('#rs-save').isDisabled());
        assert(await page.locator('#rs-new-plan').evaluate(node => node.readOnly));
        assert(await page.locator('#rs-review-id').evaluate(node => node.readOnly));
        assert(await page.locator('#rs-targets input, #rs-targets select, #rs-targets textarea').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.disabled)));
        assert(await page.locator('#rs-decisions button').evaluateAll(nodes => nodes.every(node => node.disabled)));
      }
      async function openSaved() {
        await page.waitForFunction(id => [...document.getElementById('rs-saved-review').options].some(row => row.value === id), request.reviewId);
        await page.selectOption('#rs-saved-review', request.reviewId);
        const record = await clickForJson('#rs-open-saved', '/api/review-sheets/' + encodeURIComponent(request.reviewId), 'GET');
        assertReview(record, request); return record;
      }
      async function exactExports(side) {
        const state = side === 'source' ? progress.exports : progress.receiverExports;
        const links = await page.locator('#rs-downloads a').evaluateAll(nodes => nodes.map(node => new URL(node.href).pathname.split('/').at(-1)));
        equal([...links].sort(), [...REVIEW_SHEET_BROWSER_FORMATS].sort(), 'All eleven native decision and receiving exports are visible.');
        for (const format of REVIEW_SHEET_BROWSER_FORMATS) {
          await checkpoint(side + '-export-' + format);
          const native = await exportReviewSheet({ project: workspace.project, reviewId: request.reviewId, format });
          const expected = description(native.bytes, native.filename); native.bytes = null; gc();
          if (side === 'receiver') {
            const original = progress.exports[format];
            assert(original, 'First retain the original complete source exports.');
            equal({ filename: original.filename, bytes: original.bytes, sha256: original.sha256 }, expected,
              'The received original native model reproduces the exact complete source export.');
          }
          const previous = state[format];
          if (previous) {
            equal({ filename: previous.filename, bytes: previous.bytes, sha256: previous.sha256 }, expected);
            await checkFiles([side === 'source' ? previous : progress.exports[format]]);
          } else {
            const selector = '#rs-downloads a[href="/api/review-sheets/' + encodeURIComponent(request.reviewId) + '/' + format + '"]';
            state[format] = { format, ...await receiveDownload(selector, directories.exports, expected, { retain: side === 'source' }) };
            await checkpoint(stage);
          }
          gc();
        }
      }
      async function assertOriginalAndSaved(record) {
        assert.equal(record.status, 'COMPLETE'); assertReview(record, request);
        const original = await workspace.project.readOpenWaters(source.sourcePlanId);
        assert.equal(original.planSha256, source.sourcePlanSha256); equal(original.options, sourcePlan.options); assertNative(original, request);
        const saved = await workspace.project.readOpenWaters(request.newPlanId);
        assert.equal(saved.planSha256, record.newPlanSha256); assertNative(saved, request);
        assert.equal(record.document.decisions.filter(row => row.action === 'set').length, cohort.length);
        const kept = record.document.decisions.find(row => row.targetId === keepTarget.targetId);
        equal(kept, { targetId: keepTarget.targetId, action: 'keep', reason: config.keepReason });
        return { reviewId: record.reviewId, reviewSha256: record.reviewSha256, requestSha256: record.requestSha256,
          newPlanId: record.newPlanId, newPlanSha256: saved.planSha256, previewSha256: record.previewSha256,
          sourcePlanId: source.sourcePlanId, sourcePlanSha256: source.sourcePlanSha256,
          reviewSourceSha256: source.reviewSha256, captureSha256: source.captureSha256, decisionCounts: record.decisionCounts,
          summary: saved.summary, files: record.files };
      }
      await openPage('source');
      await checkpoint('select-complete-original-cohort');
      await openSource(); await filter();
      const beforeSelections = selections.length;
      await page.locator('#rs-select-filtered').click(); await idle();
      assert.equal((await page.locator('#rs-selection-count').textContent()).replaceAll(',', ''), cohort.length + ' selected across pages');
      const selectedRequests = selections.slice(beforeSelections);
      equal(selectedRequests.map(row => Number(row.query.offset)), Array.from({ length: Math.ceil(cohort.length / 1000) }, (_, index) => index * 1000),
        'All matching targets use the original supported 1000-row pages.');
      assert(selectedRequests.every(row => row.query.limit === '1000' && row.query.field === config.field && row.query.kind === 'result' && row.query.attentionOnly === 'false'));
      await page.selectOption('#rs-bulk-action', 'set'); await page.fill('#rs-bulk-value', value); await page.fill('#rs-bulk-reason', config.reason);
      await page.locator('#rs-apply-bulk').click(); await idle();
      assert.equal((await page.locator('#rs-draft-count').textContent()).replaceAll(',', ''), cohort.length + ' recorded decisions');

      await checkpoint('complete-editable-table-roundtrip');
      const csvName = source.sourcePlanId + '-decisions.csv';
      if (!progress.files.initialCsv) {
        const expected = description(reviewSheetCsv(sourcePlan, initialDocument, { attentionOnly: false }), csvName); gc();
        await page.selectOption('#rs-table-format', 'csv');
        progress.files.initialCsv = await receiveDownload('#rs-export-table', directories.draft, expected); await idle(); await checkpoint(stage);
      } else await checkFiles([progress.files.initialCsv]);
      const parsed = parseReviewSheetCsv(await readFile(retainedPath(progress.files.initialCsv.file), 'utf8'));
      equal(parsed, initialDocument, 'The complete browser CSV retains every selected source-bound decision.');
      const edited = compact({ ...parsed, decisions: [...parsed.decisions, { targetId: keepTarget.targetId, action: 'keep', reason: config.keepReason }] });
      equal(edited, document);
      const tsvPath = join(directories.draft, source.sourcePlanId + '-keep-reason.tsv');
      if (!progress.files.importedTsv) {
        const bytes = Buffer.from(reviewSheetTsv(sourcePlan, edited, { attentionOnly: false }));
        await immutableBytes(tsvPath, bytes); progress.files.importedTsv = await rememberFile(tsvPath, { format: 'tsv' }); await checkpoint(stage);
      } else await checkFiles([progress.files.importedTsv]);
      gc();
      await visibleDetails('#rs-import-form'); await page.locator('#rs-import-file').setInputFiles(tsvPath);
      const imported = await clickForJson('#rs-import-form button[type="submit"]', '/api/review-sheets/import-table');
      equal(compact(imported), document, 'The UI imported every set decision and the explicit keep reason.');
      assert.equal((await page.locator('#rs-draft-count').textContent()).replaceAll(',', ''), (cohort.length + 1) + ' recorded decisions');
      if (!progress.files.importedJson) {
        progress.files.importedJson = await receiveDownload('#rs-export-json', directories.draft,
          { filename: source.sourcePlanId + '-decisions.json' });
        equal(compact(JSON.parse(await readFile(retainedPath(progress.files.importedJson.file), 'utf8'))), document);
        await checkpoint(stage);
      } else { await checkFiles([progress.files.importedJson]); equal(compact(JSON.parse(await readFile(retainedPath(progress.files.importedJson.file), 'utf8'))), document); }

      await checkpoint('preview-complete-native-plan');
      await page.fill('#rs-new-plan', request.newPlanId); await page.fill('#rs-review-id', request.reviewId);
      let preview = await clickForJson('#rs-preview', '/api/review-sheets/preview');
      assert.equal(preview.newPlanId, request.newPlanId); equal(preview.document, document); assertNative(preview.plan, request);
      assert.equal(preview.decisionCounts.set, cohort.length); assert.equal(preview.decisionCounts.keep, 1);
      const previewSha256 = preview.previewSha256;
      await page.locator('#rs-show-preview').click();
      await page.locator('#tab-open-waters').waitFor({ state: 'visible' }); await page.locator('#ow-preview-body').waitFor({ state: 'visible' });
      assert.equal(await page.inputValue('#ow-organization'), sourcePlan.options.organizationId);
      assert.equal(await page.inputValue('#ow-project'), sourcePlan.options.projectId);
      await page.locator('[data-ow-pane="results"]').click();
      assert.equal(await page.locator('#ow-results tr').count(), Math.min(25, cohort.length));
      await page.locator('[data-tab="review-sheets"]').click(); await idle();
      assert.equal(await page.inputValue('#rs-new-plan'), request.newPlanId);
      assert.equal(await page.inputValue('#rs-review-id'), request.reviewId);
      assert.equal(await page.locator('#rs-state').textContent(), 'Preview current');
      await page.locator('#rs-preview-output').scrollIntoViewIfNeeded(); await screenshot('complete-native-preview');
      preview = null; gc();

      await checkpoint('save-or-reopen-original-decision-review');
      let record = await currentRecord(workspace.project, request.reviewId);
      if (record) {
        assertReview(record, request, previewSha256); record = await openSaved();
        if (record.status === 'PREPARED') {
          assert.equal(await page.inputValue('#rs-review-id'), request.reviewId);
          assert.equal(await page.inputValue('#rs-new-plan'), request.newPlanId);
          record = await clickForJson('#rs-save', '/api/review-sheets');
        }
      } else record = await clickForJson('#rs-save', '/api/review-sheets');
      assertReview(record, request, previewSha256);
      const saved = await assertOriginalAndSaved(record); await readOnly();
      await exactExports('source');
      await checkpoint('revise-and-reopen-saved-decisions');
      await page.locator('#rs-revise').click(); await idle();
      assert.notEqual(await page.inputValue('#rs-new-plan'), request.newPlanId);
      assert.notEqual(await page.inputValue('#rs-review-id'), request.reviewId);
      assert(!(await page.locator('#rs-new-plan').evaluate(node => node.readOnly)));
      assert(await page.locator('#rs-save').isDisabled());
      assert.equal((await page.locator('#rs-draft-count').textContent()).replaceAll(',', ''), document.decisions.length + ' recorded decisions');
      record = await openSaved(); assert.equal(record.reviewSha256, saved.reviewSha256); await readOnly();
      await page.locator('#rs-exports').scrollIntoViewIfNeeded(); await screenshot('saved-complete-exports');
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert(mobile.content <= mobile.viewport, 'The complete receiving workspace fits the mobile viewport.');
      await page.locator('#rs-exports').scrollIntoViewIfNeeded(); await screenshot('saved-mobile');

      await checkpoint('stop-and-fresh-start-original-project'); await stopWorkspace(); gc();
      workspace = await startWaterQualityWorkspace({ directory: config.directory, ...privateOptions });
      await openPage('source-cold-reopen'); record = await openSaved();
      assert.equal(record.reviewSha256, saved.reviewSha256); await assertOriginalAndSaved(record); await readOnly();
      await checkpoint('original-cold-reopen-complete', { originalColdReopen: { completedAt: new Date().toISOString(),
        reviewSha256: record.reviewSha256, newPlanSha256: record.newPlanSha256 } });
      await stopWorkspace(); gc();

      await checkpoint('receive-full-decision-and-source-bundle');
      workspace = await startWaterQualityWorkspace({ directory: config.receiverDirectory, ...privateOptions });
      await openPage('receiver');
      record = await currentRecord(workspace.project, request.reviewId);
      if (record?.status === 'COMPLETE' && progress.portableReceive) { assertReview(record, request); record = await openSaved(); }
      else {
        if (record) assertReview(record, request, previewSha256);
        await visibleDetails('#rs-receive-form');
        await page.locator('#rs-receive-file').setInputFiles(retainedPath(progress.exports.bundle.file));
        record = await clickForJson('#rs-receive-form button[type="submit"]', '/api/review-sheets/receive');
        await checkpoint(stage, { portableReceive: { completedAt: new Date().toISOString(), reviewId: record.reviewId,
          reviewSha256: record.reviewSha256, bundleSha256: progress.exports.bundle.sha256 } });
      }
      assert.equal(record.reviewSha256, saved.reviewSha256);
      await assertOriginalAndSaved(record); await readOnly();
      await exactExports('receiver');
      record = await openSaved(); assert.equal(record.reviewSha256, saved.reviewSha256);
      await page.locator('#rs-exports').scrollIntoViewIfNeeded(); await screenshot('received-complete-project');
      await checkpoint('stop-and-fresh-start-received-project'); await stopWorkspace(); gc();
      workspace = await startWaterQualityWorkspace({ directory: config.receiverDirectory, ...privateOptions });
      await openPage('receiver-cold-reopen'); record = await openSaved();
      assert.equal(record.reviewSha256, saved.reviewSha256); await assertOriginalAndSaved(record); await readOnly();
      await checkpoint('received-cold-reopen-complete', { receiverColdReopen: { completedAt: new Date().toISOString(),
        reviewSha256: record.reviewSha256, newPlanSha256: record.newPlanSha256 } });
      await stopWorkspace(); await browser.close(); browser = null;
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const allowed = new Set(['/api/review-sheets/table', '/api/review-sheets/import-table',
        '/api/review-sheets/preview', '/api/review-sheets', '/api/review-sheets/receive']);
      assert(requests.every(row => allowed.has(row.path)), 'The whole operation uses the existing receiving workspace actions.');
      const result = { schema: REVIEW_SHEET_BROWSER_SCHEMA, status: 'PASS', operationId: request.operationId,
        requestSha256: request.requestSha256, managedSourceSha256: request.runtime.managedSource.sha256,
        startedAt: progress.startedAt, completedAt: new Date().toISOString(), source, selection: request.selection,
        documentSha256: request.documentSha256, review: saved, browserVersion, nodeVersion: process.version,
        receiverDirectory: config.receiverDirectory, files: Object.values(progress.files),
        downloads: REVIEW_SHEET_BROWSER_FORMATS.map(format => progress.exports[format]),
        receivedDownloads: REVIEW_SHEET_BROWSER_FORMATS.map(format => progress.receiverExports[format]),
        screenshots: Object.values(progress.screenshots), mobile, originalColdReopen: progress.originalColdReopen,
        receiverColdReopen: progress.receiverColdReopen, portableReceive: progress.portableReceive, assets, selections, requests, browserErrors: errors,
        finalState: { sourceWorkspace: 'CLOSED', receivingWorkspace: 'CLOSED', browser: 'CLOSED' } };
      await atomicJson(config.outputDirectory, 'result.json', result, { exclusive: true });
      await checkpoint('complete');
      return result;
    } catch (error) {
      await atomicJson(config.outputDirectory, 'failure.json', { schema: REVIEW_SHEET_BROWSER_SCHEMA,
        operationId: config.operationId, requestSha256: request?.requestSha256 ?? null, stage,
        observedAt: new Date().toISOString(), error: { message: error.message, code: error.code ?? null, stack: error.stack } }).catch(() => {});
      throw error;
    } finally {
      await stopWorkspace().catch(() => {}); await browser?.close().catch(() => {});
    }
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: node browser-receiving.mjs --config /absolute/receiving.json\n' +
      'Execute or resume the complete source-bound bulk-review browser receiving operation.\n');
    return 0;
  }
  assert(argv.length === 2 && argv[0] === '--config', 'Use --config with the complete receiving configuration.');
  const configFile = resolve(argv[1]);
  const bytes = await readFile(configFile); assert(bytes.length <= 1024 * 1024, 'The receiving configuration is too large.');
  const result = await runReviewSheetBrowserReceiving(JSON.parse(bytes.toString('utf8')));
  process.stdout.write(json({ status: result.status, operationId: result.operationId, requestSha256: result.requestSha256,
    reviewId: result.review.reviewId, newPlanId: result.review.newPlanId, results: result.selection.targets,
    sourceExports: result.downloads.length, receivedExports: result.receivedDownloads.length,
    browserVersion: result.browserVersion, reused: result.reused ?? false }));
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(json({ error: error.message, code: error.code ?? null })); process.exitCode = 1; });
