// MIT. One actual operator and customer browser journey on an already delivered native edition.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { startWaterQualityWorkspace } from './workspace.mjs';
import { canonicalJson } from './provider.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b, label) => assert.equal(canonicalJson(a), canonicalJson(b), label);
const date = value => value ? value.slice(6) + '-' + value.slice(0, 2) + '-' + value.slice(3, 5) : '';
const profileControls = { Station: '#profile-station', Activity: '#profile-activity', Result: '#profile-result', ResultDetectionQuantitationLimit: '#profile-limits' };
export async function inspectWaterQualityWorkspace({ directory, outputDirectory, buyer, reviewId = 'march-versus-january',
  editionId = 'potomac-q1-water-quality', originalIntent = 'wqx-journey-page-0001', playwrightModule, browserExecutable } = {}) {
  outputDirectory = await privateDirectory(resolve(outputDirectory));
  const { chromium } = createRequire(import.meta.url)(playwrightModule ?? process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const deniedSource = { async request() { throw new Error('This retained browser workflow unexpectedly requested new source.'); } };
  let workspace, receiver, browser, context;
  const errors = [], mutations = [], downloads = [], screenshots = [];
  try {
    workspace = await startWaterQualityWorkspace({ directory, buyer, transport: deniedSource });
    const originalProject = await workspace.project.read(), originalReview = await workspace.project.readReview(reviewId);
    const originalEdition = await workspace.project.readEdition(editionId);
    const capture = await workspace.project.capture(originalReview.captureId);
    browser = await chromium.launch({ headless: true, ...(browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: browserExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
    await page.goto(workspace.url); await page.waitForFunction(() => document.getElementById('revision').textContent.startsWith('Saved revision'));
    async function submit(selector, path) {
      const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
      await page.locator(selector).click(); const response = await waiting;
      const value = await response.json(); assert(response.ok(), JSON.stringify(value)); return value;
    }
    async function openReview(id) {
      const row = page.locator('#reviews .record').filter({ has: page.locator('strong', { hasText: id }) });
      await row.getByRole('button', { name: 'Open saved review', exact: true }).click();
      await page.waitForFunction(expected => document.getElementById('saved-review-id').textContent === expected && !document.getElementById('saved-review').hidden, id);
      await page.locator('#analysis-body').waitFor({ state: 'visible' });
    }
    async function download(selector, file) {
      const waiting = page.waitForEvent('download'); await selector.click(); const item = await waiting;
      const target = join(outputDirectory, file); await item.saveAs(target); const bytes = await readFile(target);
      downloads.push({ file, bytes: bytes.length, sha256: hash(bytes) }); return { bytes, file: target };
    }
    await openReview(reviewId);
    const metricValues = await page.locator('#metrics strong').allTextContents();
    assert.equal(Number(metricValues[0]), originalReview.analysis.inventory.selectedRows);
    assert.equal(Number(metricValues[1]), originalReview.analysis.inventory.arithmeticRows);
    await page.selectOption('#group', ''); await page.selectOption('#row-filter', 'censored');
    const detailResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/result'));
    await page.locator('#observations button').first().click();
    const detail = await (await detailResponse).json();
    await page.locator('#record-detail').waitFor({ state: 'visible' });
    assert(detail.record && detail.stationRecords.length && detail.activityRecords.length && detail.limits.length);
    assert((await page.locator('#record-content').textContent()).includes('Not Detected'));
    assert((await page.locator('#record-content').textContent()).includes('Org_Identifier'));
    await page.locator('#close-record').click();

    // Actual native-source form preservation, including a characteristic containing a comma.
    const originalFilters = { ...originalProject.selection.filters };
    for (const key of ['siteid', 'characteristicName', 'startDateLo', 'startDateHi']) delete originalFilters[key];
    const richerFilters = { ...originalFilters, providers: ['NWIS'], sampleMedia: ['Water'] };
    await page.fill('#source-filters', JSON.stringify(richerFilters));
    await page.fill('#source-characteristics', '1,2-Dichloroethane\nChloride');
    assert.equal(await page.locator('#capture').isDisabled(), true);
    const richer = await submit('#project-form button[type=submit]', '/api/project');
    equal(richer.selection.filters.characteristicName, ['1,2-Dichloroethane', 'Chloride']);
    await page.waitForFunction(revision => document.getElementById('revision').textContent === 'Saved revision ' + revision, richer.revision);
    await page.fill('#title', originalProject.title + ' — source review');
    assert.equal(await page.locator('#capture').isDisabled(), true);
    const retitled = await submit('#project-form button[type=submit]', '/api/project');
    equal(retitled.selection, richer.selection, 'A title-only edit preserves every native filter and complete characteristic.');
    await page.waitForFunction(revision => document.getElementById('revision').textContent === 'Saved revision ' + revision, retitled.revision);
    await page.fill('#title', originalProject.title); await page.fill('#source-filters', JSON.stringify(originalFilters));
    await page.fill('#locations', (originalProject.selection.filters.siteid ?? []).join('\n'));
    await page.fill('#source-characteristics', (originalProject.selection.filters.characteristicName ?? []).join('\n'));
    await page.fill('#start', date(originalProject.selection.filters.startDateLo)); await page.fill('#end', date(originalProject.selection.filters.startDateHi));
    for (const [profile, selector] of Object.entries(profileControls)) await page.locator(selector).setChecked(originalProject.selection.profiles.includes(profile));
    await page.selectOption('#partition', originalProject.selection.partition);
    const restored = await submit('#project-form button[type=submit]', '/api/project'); equal(restored.selection, originalProject.selection);
    assert.equal(restored.title, originalProject.title);
    await page.waitForFunction(revision => document.getElementById('revision').textContent === 'Saved revision ' + revision, restored.revision);

    await page.locator('[data-tab=source]').click();
    const source = await page.evaluate(async id => (await fetch('/api/captures/' + id)).json(), originalReview.captureId);
    const resultResource = source.resources.find(row => row.profile === 'Result' && row.dataAvailable);
    const fileIndex = source.sourceFiles.findIndex(row => row.path === resultResource.bodyFile);
    const originalCsv = await download(page.locator('#source-files a[href="/api/captures/' + originalReview.captureId + '/files/' + fileIndex + '"]'), 'operator-original-result.csv');
    assert.equal(hash(originalCsv.bytes), resultResource.sha256);

    await page.locator('[data-tab=analysis]').click(); await page.fill('#analysis-start', originalReview.requestedOptions.window.start);
    assert.equal(await page.locator('#save-review').isDisabled(), true);
    const evaluation = await submit('#analyze', '/api/analysis'); assert.equal(evaluation.captureSha256, capture.captureSha256);
    await page.fill('#review-id', 'browser-sample-review'); await page.fill('#note', originalReview.note + '\nOriginal Result CSV and detection-limit detail reviewed in the operator workspace.');
    const review = await submit('#save-review', '/api/reviews');
    await page.waitForFunction(id => document.getElementById('saved-review-id').textContent === id, review.reviewId);
    const report = await download(page.locator('#review-downloads a[href$="/html"]'), 'operator-review.html');
    assert(report.bytes.includes(Buffer.from('Water quality')) || report.bytes.includes(Buffer.from(review.title)));
    const bundle = await download(page.locator('#review-downloads a[href$="/bundle"]'), 'complete-review.json');

    await page.locator('[data-tab=merchant]').click();
    await page.selectOption('#edition-review', review.reviewId); await page.fill('#edition-name', 'browser-quality-edition');
    const edition = await submit('#edition-form button[type=submit]', '/api/editions');
    assert.equal(edition.rowCount, 1035); assert.equal(edition.captureSha256, capture.captureSha256);
    await page.waitForFunction(() => [...document.getElementById('merchant-edition').options].some(row => row.value === 'browser-quality-edition'));
    await page.selectOption('#merchant-edition', editionId);
    await page.waitForFunction(() => !document.getElementById('reopen-purchase').disabled);
    await page.fill('#intent', originalIntent);
    const pageDelivery = await submit('#reopen-purchase', '/api/customer/reopen');
    assert(pageDelivery.rows.length > 0 && pageDelivery.metadata.nextCursor);
    const continued = await submit('#prepare-next-page', '/api/customer/prepare');
    equal(continued.prepared.previous, pageDelivery.metadata);
    assert.notEqual(continued.intentId, originalIntent);
    const continuedQuery = Object.fromEntries(new URL(continued.prepared.url).searchParams);
    equal({ ...Object.fromEntries(new URL(pageDelivery.url).searchParams), cursor: pageDelivery.metadata.nextCursor }, continuedQuery);
    const sourceMember = originalEdition.downloads.find(row => row.path === 'capture/' + resultResource.bodyFile);
    await page.selectOption('#customer-kind', 'source'); await page.selectOption('#customer-file', sourceMember.path);
    await page.fill('#intent', 'wqx-browser-prepare-original-csv');
    const sourcePrepared = await submit('#prepare-purchase', '/api/customer/prepare');
    assert.equal(sourcePrepared.prepared.kind, 'source'); assert.equal(sourcePrepared.prepared.expected.sha256, sourceMember.sha256);
    assert.equal(sourcePrepared.prepared.expected.contentType, sourceMember.contentType);
    await page.fill('#intent', 'wqx-journey-original-csv');
    const sourceDelivery = await submit('#reopen-purchase', '/api/customer/reopen');
    assert.equal(sourceDelivery.metadata.sha256, sourceMember.sha256);
    const buyerCsv = await download(page.locator('#customer-download'), 'buyer-original-result.csv'); assert.equal(hash(buyerCsv.bytes), sourceMember.sha256);
    await page.selectOption('#customer-kind', 'edition'); await page.fill('#intent', 'wqx-browser-prepare-edition');
    const manifestPrepared = await submit('#prepare-purchase', '/api/customer/prepare'); assert.equal(manifestPrepared.prepared.expected.path, 'edition.json');
    const customerShot = join(outputDirectory, 'water-quality-customer.png');
    await page.locator('#tab-merchant').screenshot({ path: customerShot }); screenshots.push(customerShot);
    await page.locator('[data-tab=analysis]').click(); await page.selectOption('#row-filter', 'all');
    const group = review.analysis.groups.find(row => row.summary.count >= 2) ?? review.analysis.groups.find(row => row.summary.count > 0);
    assert(group); await page.selectOption('#group', group.id);
    const desktopShot = join(outputDirectory, 'water-quality-review.png'); await page.screenshot({ path: desktopShot, fullPage: true }); screenshots.push(desktopShot);
    await page.setViewportSize({ width: 390, height: 844 });
    const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })); assert(widths.content <= widths.viewport);
    const mobileShot = join(outputDirectory, 'water-quality-mobile.png'); await page.screenshot({ path: mobileShot, fullPage: true }); screenshots.push(mobileShot);

    receiver = await startWaterQualityWorkspace({ directory: join(outputDirectory, 'received-in-browser'), transport: deniedSource });
    const receivingPage = await context.newPage(); receivingPage.setDefaultTimeout(30000);
    receivingPage.on('pageerror', error => errors.push(error.message));
    receivingPage.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
    await receivingPage.goto(receiver.url); await receivingPage.waitForFunction(async () => (await (await fetch('/api/workspace')).json()).token.length > 0);
    await receivingPage.locator('details').filter({ has: receivingPage.locator('#receive-form') }).locator('summary').click();
    await receivingPage.locator('#receive-file').setInputFiles(bundle.file);
    const receiving = receivingPage.waitForResponse(response => new URL(response.url()).pathname === '/api/receive');
    await receivingPage.locator('#receive').click(); const receivedResponse = await receiving; assert(receivedResponse.ok(), await receivedResponse.text());
    const received = await receivedResponse.json(); assert.equal(received.captureSha256, capture.captureSha256);
    await receivingPage.waitForFunction(id => document.getElementById('saved-review-id').textContent === id, review.reviewId);
    equal((await receiver.project.readReview(review.reviewId)).analysis, review.analysis);
    assert.equal((await receiver.project.capture(review.captureId)).captureSha256, capture.captureSha256);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert(!mutations.includes('/api/captures') && !mutations.includes('/api/customer/execute'), 'The browser opens the retained original customer results.');
    const result = { status: 'PASS', project: directory, originalCaptureSha256: capture.captureSha256,
      sourceSelectionPreserved: true, originalFieldsAndLimitsOpened: true, reviewId: review.reviewId,
      selectedReviewRows: review.analysis.inventory.selectedRows, editionRows: edition.rowCount,
      customerPageRows: pageDelivery.rows.length, customerContinuationPrepared: continued.intentId,
      exactOriginalCsvSha256: sourceMember.sha256, receivedReviewArchiveSha256: received.archiveSha256,
      mobile: widths, browserErrors: errors, mutations, downloads, screenshots };
    await atomicJson(outputDirectory, 'browser-result.json', result); return result;
  } finally { await context?.close(); await browser?.close(); await receiver?.close(); await workspace?.close(); }
}
