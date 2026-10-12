// MIT. One complete browser journey against retained original source and two real reporting desks.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rootPath = url => new URL(url).origin;
export async function runReportingBrowserJourney({
  chromium, baseUrl, receivingUrl, sourceFile, profile, definition, outputDirectory,
  executablePath, reviewer = 'Commissioning operator'
}) {
  assert(chromium?.launch, 'Pass the installed Playwright Chromium launcher.');
  assert(baseUrl && receivingUrl && rootPath(baseUrl) !== rootPath(receivingUrl), 'Use two separate live private reporting desks.');
  sourceFile = resolve(sourceFile); outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const sourceBytes = await readFile(sourceFile), originalCollection = JSON.parse(sourceBytes.toString('utf8'));
  assert.equal(originalCollection.schema, 'commons.open311.collection-export.v1');
  assert(originalCollection.originals.length > 0, 'Use a complete collection containing actual original response bytes.');
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), pageErrors = [], files = [], actions = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const runId = randomUUID(), filename = name => join(outputDirectory, runId + '-' + name);
  async function state(selected = page) {
    const result = await selected.evaluate(async () => {
      const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(result.status, 200); assert.equal(result.body.ok, true); return result.body.value;
  }
  async function saved(selected, path, action) {
    const responsePromise = selected.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await action(); const response = await responsePromise, envelope = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(envelope)); assert.equal(envelope.ok, true, JSON.stringify(envelope));
    await selected.locator('#pending-panel').waitFor({ state: 'hidden' });
    actions.push({ path, requestId: envelope.value.requestId, revision: envelope.value.revision });
    return envelope.value;
  }
  async function download(selected, locator, name) {
    const waiting = selected.waitForEvent('download'); await locator.click();
    const item = await waiting, path = filename(name); await item.saveAs(path);
    const bytes = await readFile(path); assert(bytes.length > 0);
    files.push({ name, path, bytes: bytes.length, sha256: hash(bytes), suggestedName: item.suggestedFilename() });
    return { path, bytes };
  }
  async function openView(selected, view) { await selected.locator('[data-view="' + view + '"]').click(); }
  async function fillDefinition(value) {
    await page.locator('#build-name').fill(value.name);
    await page.locator('#build-series').fill(value.seriesId);
    await page.locator('#build-profile').selectOption(profile.id + '@' + profile.revision);
    await page.locator('#build-zone').fill(value.displayTimeZone);
    await page.locator('#build-start').fill(value.period.start);
    await page.locator('#build-end').fill(value.period.end);
    await page.locator('#build-asof').fill(value.asOf);
    await page.locator('#build-target').selectOption(value.targetBasis);
    await page.locator('#build-commentary').fill(value.commentary || '');
    for (const field of ['group', 'status', 'reviewStatus', 'assignee'])
      await page.locator('#build-filter-' + field).fill((value.filters?.[field] ?? []).join('\n'));
  }
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#workspace-label').filter({ hasText: 'Workspace ' }).waitFor();
    const initial = await state(); assert.equal(initial.revision, 0); assert.equal(initial.sources.length, 0);
    await openView(page, 'sources'); await page.locator('#source-file').setInputFiles(sourceFile);
    const imported = await saved(page, '/api/import', () => page.locator('#source-form button[type="submit"]').click());
    assert.equal((await state()).sources.length, 1);
    await page.locator('#sources-table button', { hasText: 'Open source' }).first().click();
    await page.locator('#inspector').waitFor({ state: 'visible' });
    assert((await page.locator('#inspector-body').textContent()).includes(imported.sourceId));
    await page.locator('#inspector-close').click();

    await openView(page, 'rules'); await page.locator('#profile-new').click();
    await page.locator('details').filter({ has: page.locator('#profile-json') }).locator('summary').click();
    await page.locator('#profile-json').fill(JSON.stringify(profile, null, 2)); await page.locator('#profile-apply-json').click();
    assert.equal(await page.locator('#profile-id').inputValue(), profile.id);
    assert.equal(await page.locator('#profile-revision').inputValue(), String(profile.revision));
    await page.locator('#profile-name').fill(profile.name);
    // Exercise the visual nullable selector and target/calendar joins using the retained operator policy.
    if (profile.calendars?.length) {
      const calendar = profile.calendars[0];
      await page.locator('#calendars-table tbody tr').filter({ hasText: calendar.id + '@' + calendar.revision }).getByRole('button', { name: 'Edit draft', exact: true }).click();
      assert.equal(await page.locator('#calendar-zone').inputValue(), calendar.timeZone);
      await page.locator('#calendar-form button[type="submit"]').click();
    }
    if (profile.mappings?.length) {
      const mapping = profile.mappings[0];
      await page.locator('#mappings-table tbody tr').filter({ hasText: mapping.id }).getByRole('button', { name: 'Edit draft', exact: true }).click();
      assert.equal(await page.locator('#mapping-priority').inputValue(), String(mapping.priority));
      if (mapping.selector?.serviceCode === null) assert.equal(await page.locator('#mapping-service-mode').inputValue(), 'null');
      await page.locator('#mapping-form button[type="submit"]').click();
    }
    if (profile.policies?.length) {
      const policy = profile.policies[0];
      await page.locator('#policies-table tbody tr').filter({ hasText: policy.id + '@' + policy.revision }).getByRole('button', { name: 'Edit draft', exact: true }).click();
      assert.equal(await page.locator('#policy-priority').inputValue(), String(policy.priority));
      assert.equal(await page.locator('#policy-duration').inputValue(), String(policy.durationMinutes));
      await page.locator('#policy-form button[type="submit"]').click();
    }
    const savedProfile = await saved(page, '/api/profile', () => page.locator('#profile-save').click());
    assert.equal(savedProfile.profileId, profile.id + '@' + profile.revision);

    await openView(page, 'build');
    await page.locator('#build-sources input[value="' + imported.sourceId + '"]').check();
    await fillDefinition(definition);
    const built = await saved(page, '/api/build', () => page.locator('#build-form button[type="submit"]').click());
    await page.locator('#report-content').waitFor({ state: 'visible' });
    const reportAfterBuild = await page.evaluate(async id => (await (await fetch('/api/report?id=' + encodeURIComponent(id))).json()).value, built.reportId);
    assert(reportAfterBuild.rows.length > 0, 'Use a reporting period and observation cutoff containing the original collected cases.');
    const caseRow = reportAfterBuild.rows[0];
    await page.locator('#report-rows button[data-case-key]').first().click();
    await page.locator('#inspector').waitFor({ state: 'visible' });
    assert((await page.locator('#inspector-body').textContent()).includes(caseRow.sourceSha256));
    await page.locator('#inspector-close').click();
    await download(page, page.locator('[data-report-export="html"]'), 'report.html');
    await download(page, page.locator('[data-report-export="csv"]'), 'cases.csv');
    const reportPackage = await download(page, page.locator('[data-report-export="json"]'), 'selected-report-package.json');
    assert.equal(JSON.parse(reportPackage.bytes.toString('utf8')).selectedReportId, built.reportId);
    const template = await download(page, page.locator('[data-report-export="review"]'), 'review-template.json');
    assert.equal(JSON.parse(template.bytes.toString('utf8')).baseReportSha256, reportAfterBuild.sha256);

    await openView(page, 'reviews');
    await page.locator('#review-compose-report').selectOption(built.reportId);
    await page.locator('#review-author').fill(reviewer); await page.locator('#review-compose-start').click();
    await page.locator('#review-draft-base').filter({ hasText: built.reportId }).waitFor();
    await page.locator('#review-comment-kind').selectOption('report-comment');
    await page.locator('#review-comment-text').fill('Operational handover reviewed against the retained original collection.');
    await page.locator('#review-comment-form button[type="submit"]').click();
    await page.locator('#review-comment-kind').selectOption('request-comment');
    await page.locator('#review-comment-request').selectOption(caseRow.key);
    await page.locator('#review-comment-text').fill('Reviewed the retained source edition, calculation and original capture.');
    await page.locator('#review-comment-form button[type="submit"]').click();
    const returned = await download(page, page.locator('#review-draft-download'), 'review-return.json');
    const returnedBody = JSON.parse(returned.bytes.toString('utf8')); assert.equal(returnedBody.changes.length, 2);
    assert.equal(returnedBody.changes.find(change => change.kind === 'request-comment').sourceSha256, caseRow.sourceSha256);
    await page.locator('#review-file').setInputFiles(returned.path);
    const importedReview = await saved(page, '/api/review-import', () => page.locator('#review-import-form button[type="submit"]').click());
    await page.locator('#review-selected-meta').filter({ hasText: reviewer }).waitFor();
    const choices = page.locator('#review-changes input[type="checkbox"]'); assert.equal(await choices.count(), 2);
    for (let index = 0; index < await choices.count(); index++) await choices.nth(index).check();
    const incorporated = await saved(page, '/api/review-apply', () => page.locator('#review-apply-form button[type="submit"]').click());
    await page.locator('#report-title').waitFor();
    const reviewed = await page.evaluate(async id => (await (await fetch('/api/report?id=' + encodeURIComponent(id))).json()).value, incorporated.reportId);
    assert.equal(reviewed.predecessorId, built.reportId);
    assert.equal(reviewed.requestComments[caseRow.key].sourceSha256, caseRow.sourceSha256);
    assert.equal(reviewed.reviewerHistory.at(-1).reviewId, importedReview.reviewId);
    await page.locator('#compare-before').selectOption(built.reportId); await page.locator('#compare-after').selectOption(incorporated.reportId);
    await page.locator('#compare-form button[type="submit"]').click();
    await page.locator('#compare-result h4').waitFor();
    const screenshot = filename('reviewed-report.png'); await page.screenshot({ path: screenshot, fullPage: true });
    const screenshotBytes = await readFile(screenshot); files.push({ name: 'reviewed-report.png', path: screenshot, bytes: screenshotBytes.length, sha256: hash(screenshotBytes) });

    // Lose only the response after the real server has committed a new report; recover its exact retained command.
    const beforeRecovery = await state(); let committed = null;
    await openView(page, 'build');
    await fillDefinition({ ...definition, name: definition.name + ' · recovered command', seriesId: definition.seriesId + '-recovery' });
    await page.route('**/api/build', async route => {
      const upstream = await route.fetch(), envelope = await upstream.json();
      assert.equal(envelope.ok, true); committed = envelope.value; await route.abort('failed');
    }, { times: 1 });
    await page.locator('#build-form button[type="submit"]').click();
    await page.locator('#pending-panel').waitFor({ state: 'visible' });
    await page.locator('#pending-description').filter({ hasText: 'response was incomplete' }).waitFor();
    assert(committed?.requestId);
    await page.locator('#pending-inspect').click();
    await page.locator('#pending-description').filter({ hasText: 'saved successful result' }).waitFor();
    await page.locator('#pending-close').click(); await page.locator('#pending-panel').waitFor({ state: 'hidden' });
    const recovered = await state(); assert.equal(recovered.revision, beforeRecovery.revision + 1);
    assert.equal(recovered.reports.length, beforeRecovery.reports.length + 1);
    assert.equal(recovered.operations.filter(item => item.requestId === committed.requestId).length, 1);

    await openView(page, 'workspace');
    const full = await download(page, page.locator('#workspace-export'), 'complete-reporting-workspace.json');
    const receivingPage = await context.newPage(); receivingPage.on('pageerror', error => pageErrors.push(error.message));
    await receivingPage.goto(receivingUrl, { waitUntil: 'domcontentloaded' });
    await receivingPage.locator('#workspace-label').filter({ hasText: 'Workspace ' }).waitFor();
    const destination = await state(receivingPage); assert.equal(destination.revision, 0); assert.notEqual(destination.workspaceId, initial.workspaceId);
    await openView(receivingPage, 'workspace'); await receivingPage.locator('#receive-file').setInputFiles(full.path);
    const received = await saved(receivingPage, '/api/receive', () => receivingPage.locator('#receive-submit').click());
    assert.equal(received.originalWorkspaceId, initial.workspaceId); assert.equal(received.workspaceId, destination.workspaceId);
    const finalState = await state(receivingPage);
    assert.equal(finalState.sources.length, recovered.sources.length); assert.equal(finalState.profiles.length, recovered.profiles.length);
    assert.equal(finalState.reports.length, recovered.reports.length); assert.equal(finalState.reviews.length, recovered.reviews.length);
    await openView(receivingPage, 'reports'); await receivingPage.locator('#report-select').selectOption(incorporated.reportId);
    await receivingPage.locator('#report-open').click(); await receivingPage.locator('#report-content').waitFor({ state: 'visible' });
    const receivedReport = await receivingPage.evaluate(async id => (await (await fetch('/api/report?id=' + encodeURIComponent(id))).json()).value, incorporated.reportId);
    assert.equal(receivedReport.sha256, reviewed.sha256);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    const result = { schema: 'commons.open311.reporting-browser-journey.v1', runId, completedAt: new Date().toISOString(),
      source: { path: sourceFile, bytes: sourceBytes.length, sha256: hash(sourceBytes), originalWorkspaceId: originalCollection.workspaceId, collectionId: originalCollection.collection.id },
      workspaceId: initial.workspaceId, receivingWorkspaceId: destination.workspaceId, importedSourceId: imported.sourceId,
      profileId: savedProfile.profileId, reportId: built.reportId, reviewedReportId: incorporated.reportId, reviewedReportSha256: reviewed.sha256,
      caseCount: reportAfterBuild.rows.length, reviewId: importedReview.reviewId, recoveryRequestId: committed.requestId,
      finalRevision: recovered.revision, receivingRevision: finalState.revision, actions, files, pageErrors };
    await writeFile(filename('browser-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    await page.screenshot({ path: filename('browser-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); await browser.close(); }
}
