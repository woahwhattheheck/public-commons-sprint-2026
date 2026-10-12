// MIT. Complete browser receiving of an original saved WQX review into Open Waters.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { startWaterQualityWorkspace } from './workspace.mjs';
import { canonicalJson } from './provider.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (actual, expected, label) => assert.equal(canonicalJson(actual), canonicalJson(expected), label);
const FORMATS = ['locations', 'results', 'crosswalk', 'report', 'bundle', 'references'];

export async function runOpenWatersBrowserJourney({ directory, outputDirectory, receiverDirectory, reviewId, options,
  planId = 'potomac-open-waters-browser', workspace: suppliedWorkspace, playwrightModule, browserExecutable } = {}) {
  assert(directory && outputDirectory && reviewId, 'Provide the retained native project, output directory, and saved review.');
  assert(options?.organizationId && options?.projectId, 'Provide the exact receiving organization and project for this plan.');
  outputDirectory = await privateDirectory(resolve(outputDirectory));
  const downloadDirectory = await privateDirectory(join(outputDirectory, 'downloads'));
  const { chromium } = createRequire(import.meta.url)(playwrightModule ?? process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const retainedSource = { async request() { throw new Error('The Open Waters receiving workflow must use its retained original source.'); } };
  const screenshots = [], downloads = [], errors = [], mutations = [], token = randomUUID().slice(0, 8);
  let workspace = suppliedWorkspace, receiver, browser, context, stage = 'open-original-project';
  async function progress(next) {
    stage = next; await atomicJson(outputDirectory, 'open-waters-browser-progress.json', { stage, planId, reviewId, updatedAt: new Date().toISOString() });
  }
  try {
    workspace ??= await startWaterQualityWorkspace({ directory, transport: retainedSource });
    const originalReview = await workspace.project.readReview(reviewId);
    const originalCapture = await workspace.project.capture(originalReview.captureId);
    browser = await chromium.launch({
      headless: true,
      ...(browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
    async function pageAt(url) {
      const page = await context.newPage(); page.setDefaultTimeout(120000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
      await page.goto(url);
      await page.waitForFunction(() => document.getElementById('notice') && document.querySelector('[data-tab="open-waters"]'));
      await page.locator('[data-tab="open-waters"]').click();
      await page.locator('#ow-form').waitFor({ state: 'visible' }); return page;
    }
    async function submit(page, selector, path) {
      const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
      await page.locator(selector).click(); const response = await waiting, value = await response.json();
      assert(response.ok(), JSON.stringify(value)); return value;
    }
    async function idle(page) { await page.waitForFunction(() => document.getElementById('ow-status').textContent !== 'Working'); }
    async function openPlan(page, id) {
      await page.selectOption('#ow-saved-plan', id);
      const waiting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/open-waters/' + encodeURIComponent(id) && response.request().method() === 'GET');
      await page.locator('#ow-open-plan').click();
      const response = await waiting, record = await response.json(); assert(response.ok(), JSON.stringify(record));
      await page.waitForFunction(expected => document.getElementById('ow-preview-title').textContent === 'Saved plan · ' + expected, id);
      await idle(page); return record;
    }
    async function shot(page, label, target = page) {
      const file = join(outputDirectory, label + '-' + token + '.png');
      await target.screenshot({ path: file, ...(target === page ? { fullPage: true } : {}) }); screenshots.push(file);
    }
    const page = await pageAt(workspace.url);
    await page.waitForFunction(id => [...document.getElementById('ow-review').options].some(item => item.value === id), reviewId);
    await page.selectOption('#ow-review', reviewId);
    const editor = page.locator('details').filter({ has: page.locator('#ow-options-json') });
    await editor.locator('summary').click(); await page.fill('#ow-options-json', JSON.stringify(options, null, 2));
    await page.locator('#ow-apply-json').click();
    assert.equal(await page.inputValue('#ow-organization'), options.organizationId);
    assert.equal(await page.inputValue('#ow-project'), options.projectId);
    await progress('preview-original-selection');
    const preview = await submit(page, '#ow-preview', '/api/open-waters/preview'); await idle(page);
    assert.equal(preview.captureSha256, originalCapture.captureSha256);
    assert.equal(preview.reviewId, reviewId);
    assert.equal(preview.summary.selectedResults, originalReview.analysis.inventory.selectedRows);
    assert.equal(preview.results.length, preview.summary.selectedResults);
    assert.equal(preview.options.organizationId, options.organizationId);
    assert.equal(preview.options.projectId, options.projectId);
    assert.equal(await page.locator('#ow-save').isEnabled(), true);
    if (preview.options.identityMode === 'compact')
      assert(preview.activities.every(row => [...row.destinationId].length <= 35), 'All compact activity identities fit the native field.');
    assert.equal(await page.locator('#ow-locations tr').count(), Math.max(1, Math.min(25, preview.locations.length)));
    assert.equal(await page.locator('#ow-activities tr').count(), Math.max(1, Math.min(25, preview.activities.length)));
    await shot(page, 'open-waters-identities', page.locator('#ow-preview-body'));

    await progress('inspect-original-limits-and-receiving-references');
    await page.locator('[data-ow-pane="translations"]').click();
    const limitTypes = [...new Set(preview.results.flatMap(row => (row.limits ?? []).map(limit => limit.type)))];
    for (const type of limitTypes) assert((await page.locator('#ow-limits').textContent()).includes(type));
    for (const mapping of preview.options.limitMappings)
      assert.equal(await page.getByLabel('Native field for limit type ' + mapping.type, { exact: true }).inputValue(), mapping.field ?? '');
    await shot(page, 'open-waters-limits', page.locator('#ow-preview-body'));

    await page.locator('[data-ow-pane="references"]').click();
    const familyValues = await page.locator('#ow-reference-kind option').evaluateAll(nodes => nodes.map(node => node.value));
    const families = [...new Set(preview.references.filter(item => item.kind === 'reference').map(item => item.name))];
    for (const family of families) assert(familyValues.includes(family), 'The reference editor uses native family ' + family);
    for (const requirement of preview.references) {
      if (requirement.kind === 'reference' && Object.hasOwn(preview.options.referenceValues, requirement.name))
        assert.equal(requirement.matched, preview.options.referenceValues[requirement.name].includes(requirement.value));
    }
    await page.selectOption('#ow-reference-filter', 'unknown');
    const unresolved = preview.references.filter(item => item.matched !== true && item.matched !== false).length;
    if (unresolved) assert((await page.locator('#ow-references').textContent()).includes('Receiving lookup required'));
    await page.selectOption('#ow-reference-filter', 'all');

    await page.locator('[data-ow-pane="results"]').click();
    assert.equal(await page.locator('#ow-results tr').count(), Math.max(1, Math.min(25, preview.results.length)));
    if (preview.results.length > 25) {
      const first = await page.locator('#ow-results tr').first().textContent();
      await page.locator('#ow-results-next').click();
      assert.notEqual(await page.locator('#ow-results tr').first().textContent(), first);
      assert((await page.locator('#ow-results-page').textContent()).startsWith('26–'));
      await page.locator('#ow-results-previous').click();
    }
    const withLimits = preview.results.find(row => row.limits?.length) ?? preview.results[0];
    if (withLimits) {
      await page.fill('#ow-result-search', withLimits.sourceRecordId);
      const row = page.locator('#ow-results tr').filter({ hasText: withLimits.sourceRecordId }).first();
      await row.getByRole('button', { name: 'Inspect / edit fields', exact: true }).click();
      await page.locator('#ow-detail').waitFor({ state: 'visible' });
      const detail = await page.locator('#ow-detail-content').textContent();
      assert(detail.includes(withLimits.sourceRecordId));
      for (const field of Object.keys(withLimits.fields)) assert(detail.includes(field));
      for (const limit of withLimits.limits ?? []) assert(detail.includes(limit.type));
      await page.locator('#ow-close-detail').click(); await page.fill('#ow-result-search', '');
      await page.waitForFunction(expected => document.querySelectorAll('#ow-results tr').length === Math.min(25, expected), preview.results.length);
    }

    await progress('save-or-reopen-original-plan');
    const existing = (await workspace.view()).openWaters.find(item => item.planId === planId);
    let saved;
    if (existing) {
      saved = await openPlan(page, planId);
      equal(saved.options, preview.options, 'An existing immutable plan must match this exact receiving operation.');
      assert.equal(saved.reviewSha256, preview.reviewSha256);
    } else {
      await page.fill('#ow-plan-id', planId);
      saved = await submit(page, '#ow-save', '/api/open-waters');
      await page.waitForFunction(id => document.getElementById('ow-preview-title').textContent === 'Saved plan · ' + id, planId);
      await idle(page);
    }
    assert.equal(saved.planId, planId);
    assert.equal(saved.captureSha256, preview.captureSha256);
    equal(saved.options, preview.options, 'Saved options match the complete native preview.');
    equal(saved.files.map(file => file.format).sort(), [...FORMATS].sort(), 'The complete plan exposes all six native receiving files.');
    await progress('download-complete-native-plan');
    let bundleFile;
    for (const file of saved.files) {
      const selector = page.locator('#ow-downloads a[href="/api/open-waters/' + encodeURIComponent(planId) + '/' + file.format + '"]');
      const path = join(downloadDirectory, file.filename);
      let bytes;
      try { bytes = await readFile(path); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const waiting = page.waitForEvent('download'); await selector.click(); const download = await waiting;
        await download.saveAs(path); await chmod(path, 0o600); bytes = await readFile(path);
      }
      assert.equal(bytes.length, file.bytes, file.format + ' native byte count'); assert.equal(hash(bytes), file.sha256, file.format + ' native hash');
      downloads.push({ format: file.format, filename: file.filename, path, bytes: bytes.length, sha256: hash(bytes) });
      if (file.format === 'bundle') bundleFile = path;
    }
    assert(bundleFile, 'The full native bundle is downloadable.');
    await page.locator('#ow-new').click(); await openPlan(page, planId);
    const reopenedResponse = await page.request.get(workspace.url + '/api/open-waters/' + encodeURIComponent(planId));
    assert(reopenedResponse.ok()); const reopened = await reopenedResponse.json();
    assert.equal(reopened.planSha256, saved.planSha256); equal(reopened.files, saved.files, 'Original immutable plan files reopen unchanged.');
    await page.locator('[data-ow-pane="results"]').click();
    await shot(page, 'open-waters-results');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert(mobile.content <= mobile.viewport, 'The complete receiving workspace fits the mobile viewport.');
    await shot(page, 'open-waters-mobile');

    await progress('receive-complete-bundle-in-fresh-workspace');
    const receivingDirectory = receiverDirectory ? resolve(receiverDirectory) : join(outputDirectory, 'received-workspace');
    receiver = await startWaterQualityWorkspace({ directory: receivingDirectory, transport: retainedSource });
    const receivingPage = await pageAt(receiver.url);
    const existingReceived = (await receiver.view()).openWaters.find(item => item.planId === planId);
    let received;
    if (existingReceived) {
      await receivingPage.waitForFunction(id => [...document.getElementById('ow-saved-plan').options].some(item => item.value === id), planId);
      received = await openPlan(receivingPage, planId);
    } else {
      const receiveDetails = receivingPage.locator('details').filter({ has: receivingPage.locator('#ow-receive-form') });
      await receiveDetails.locator('summary').click(); await receivingPage.locator('#ow-receive-file').setInputFiles(bundleFile);
      received = await submit(receivingPage, '#ow-receive', '/api/open-waters/receive');
      await receivingPage.waitForFunction(id => document.getElementById('ow-preview-title').textContent === 'Saved plan · ' + id, planId);
      await idle(receivingPage);
    }
    assert.equal(received.planId, saved.planId); assert.equal(received.planSha256, saved.planSha256);
    assert.equal(received.captureSha256, originalCapture.captureSha256);
    equal(received.options, saved.options, 'Portable receiving preserves every mapping decision.');
    equal(received.files, saved.files, 'Portable receiving preserves all six exact output members.');
    const receivedReview = await receiver.project.readReview(reviewId);
    equal(receivedReview.analysis, originalReview.analysis, 'The original saved scientific review reopens in the receiving workspace.');
    assert.equal(receivedReview.note, originalReview.note);
    assert.equal((await receiver.project.capture(originalReview.captureId)).captureSha256, originalCapture.captureSha256);
    const deliveredAgain = await receivingPage.request.get(receiver.url + '/api/open-waters/' + encodeURIComponent(planId) + '/results');
    assert(deliveredAgain.ok()); const resultBytes = await deliveredAgain.body();
    assert.equal(hash(resultBytes), saved.files.find(file => file.format === 'results').sha256);
    await receivingPage.locator('[data-ow-pane="references"]').click();
    await shot(receivingPage, 'open-waters-received');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert(mutations.every(path => ['/api/open-waters/preview', '/api/open-waters', '/api/open-waters/receive'].includes(path)), 'This receiving operation uses the original Open Waters workspace lifecycle.');
    const result = { status: 'PASS', planId, planSha256: saved.planSha256, captureSha256: originalCapture.captureSha256,
      reviewId, reviewSha256: saved.reviewSha256, summary: saved.summary, originalLimitTypes: limitTypes,
      nativeReferenceFamilies: families, receivingDirectory, mobile, downloads, screenshots, browserErrors: errors, mutations };
    await atomicJson(outputDirectory, 'open-waters-browser-result.json', result); await progress('complete'); return result;
  } catch (error) {
    await atomicJson(outputDirectory, 'open-waters-browser-failure.json', { stage, planId, reviewId, error: { message: error.message, code: error.code ?? null, stack: error.stack } }).catch(() => {});
    throw error;
  } finally {
    await context?.close(); await browser?.close(); await receiver?.close();
    if (!suppliedWorkspace) await workspace?.close();
  }
}
