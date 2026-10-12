#!/usr/bin/env node
// MIT. Native Boston reporting commission over complete original created and updated collections.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = resolve(config.output), product = resolve(config.reportingProduct);
await mkdir(output, { recursive: true, mode: 0o700 });
const api = await import(pathToFileURL(join(product, 'index.mjs')));
const { canonicalJson } = await import(pathToFileURL(join(product, '../domain.mjs')));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const equal = (a, b, message) => check(canonicalJson(a) === canonicalJson(b), message);
const at = () => new Date().toISOString();
const journey = { schema: 'commons.open311.reporting-commissioning.v1', requestId: config.requestId,
  state: 'running', node: process.version, startedAt: at(), sourceEdition: config.edition,
  reportingSourceFiles: config.reportingSourceFiles, checks: [], files: [], browserErrors: [] };
let desk, receiver, http, browser;
async function save(name, value, contentType = 'application/json') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : json(value));
  await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  journey.files.push({ name, bytes: bytes.length, sha256: sha(bytes), contentType });
}
function action(workspace, extra = {}) { return { requestId: randomUUID(), expectedRevision: workspace.state().revision, ...extra }; }
async function sourceCollection() {
  const originalText = await readFile(join(config.collectionOutput, 'created-collection.json'), 'utf8');
  journey.sourceInput = { method: 'Complete original Boston created-case collection', path: 'created-collection.json', sha256: sha(originalText) };
  return originalText;
}

try {
  const sourceText = await sourceCollection(), sourceEnvelope = JSON.parse(sourceText);
  await save('original-collection.json', sourceText);
  const sourceRecord = api.validateSource(sourceText);
  desk = api.openWorkspace(join(output, 'reporting-workspace'));
  const firstInput = action(desk, { originalText: sourceText }), first = desk.importSource(firstInput);
  const repeat = desk.importSource(action(desk, { originalText: sourceText }));
  check(repeat.reused && repeat.sourceId === first.sourceId && desk.state().sources.length === 1, 'Repeated source import created another edition.');
  equal(desk.importSource(firstInput), first, 'Recovered original import result changed.');
  equal(desk.source(first.sourceId).envelope, sourceEnvelope, 'Import changed the complete original collection.');
  journey.checks.push({ name: 'native-original-import-and-exact-recovery', sourceId: first.sourceId,
    originalSha256: sourceRecord.sha256, originalBytes: sourceRecord.bytes, originalRequests: sourceEnvelope.requests.length });
  const profile = JSON.parse(await readFile(join(product, 'examples/boston-case-review-profile.json'), 'utf8'));
  const savedProfile = desk.putProfile(action(desk, { profile }));
  await save('operator-profile.json', profile);
  const definition = { name: 'Boston created cases — 8 October service review',
    seriesId: 'boston-created-case-review', sourceIds: [first.sourceId], profileId: savedProfile.profileId,
    period: { start: '2026-10-08T08:00:00Z', end: '2026-10-08T12:00:00Z' }, asOf: at(), displayTimeZone: 'America/New_York',
    cohort: 'requestedAt', targetBasis: 'policyDueAt', filters: {},
    commentary: 'Published requests in the selected creation period, grouped with their original source processing states and the selected TJLabs internal review target.' };
  await save('report-definition.json', definition);
  const made = desk.build(action(desk, { definition })), report = desk.report(made.reportId);
  const inPeriod = sourceEnvelope.requests.filter(row => Date.parse(row.requestedAt) >= Date.parse(definition.period.start) && Date.parse(row.requestedAt) < Date.parse(definition.period.end));
  check(report.totals.intake === inPeriod.length && report.totals.intake > 0, 'The original creation-period population differs.');
  for (const row of report.rows) {
    const original = sourceEnvelope.requests.find(item => item.key === row.key);
    const expectedClosed = original.status === 'closed' ? Date.parse(original.updatedAt) : null;
    check(row.sourceClosedAt === (expectedClosed === null ? null : new Date(expectedClosed).toISOString()), 'Original case-closure timestamp changed.');
    check(row.resolutionMinutes === (expectedClosed === null ? null : (expectedClosed - Date.parse(original.requestedAt)) / 60000), 'Case-closure duration changed.');
    check(row.sourceStatusNotes === (original.source.status_notes == null ? null : typeof original.source.status_notes === 'string' ? original.source.status_notes : canonicalJson(original.source.status_notes)), 'Original closure disposition changed.');
  }
  check(report.rows.filter(row => row.sourceClosedAt !== null).length === 36, 'The original 36 closed cases differ.');
  check(report.totals.unmappedServices === 0, 'An original mapped Boston service code was lost.');
  check(report.rows.every(row => row.serviceCode !== null || row.group === 'Unmapped service'), 'Blank original service codes were silently mapped.');
  check(report.rows.every(row => row.sourceSha256 === sourceEnvelope.requests.find(item => item.key === row.key).sourceSha256), 'A report selected a different original source version.');
  const expected = desk.build(action(desk, { definition: { ...definition, name: 'Provider expectations for the retained period',
    seriesId: 'boston-provider-expectations', targetBasis: 'sourceExpectedAt' } }));
  const expectedReport = desk.report(expected.reportId);
  check(expectedReport.totals.assessedTargets === 0 && expectedReport.totals.unassessedTargets === inPeriod.length &&
    expectedReport.totals.completedOnTime.percentage === null, 'Missing provider expectations changed the eligible target denominator.');
  const changedText = await readFile(join(config.collectionOutput, 'updated-collection.json'), 'utf8');
  const emptyText = await readFile(join(config.collectionOutput, 'empty-updated-collection.json'), 'utf8');
  const changedSource = desk.importSource(action(desk, { originalText: changedText }));
  const emptySource = desk.importSource(action(desk, { originalText: emptyText }));
  const combinedDefinition = { ...definition, name: 'Boston observed cases and retained update feed',
    seriesId: 'boston-observed-created-and-updated-cases',
    sourceIds: [first.sourceId, changedSource.sourceId, emptySource.sourceId],
    period: { start: '2026-09-01T00:00:00Z', end: '2026-10-09T00:00:00Z' },
    commentary: 'Observed cases from the exact retained creation window and changed-case filters, including older cases returned by the update feed.' };
  const combinedBuilt = desk.build(action(desk, { definition: combinedDefinition }));
  const combinedReport = desk.report(combinedBuilt.reportId);
  check(combinedReport.totals.intake === 104, 'Combined original created/update observations must retain 104 distinct cases.');
  check(combinedReport.coverage.filter(item => item.selectionTimeBasis === 'updated').length === 2, 'Updated-feed selection is missing from source coverage.');
  check(combinedReport.coverage.every(item => item.traversal === 'pages'), 'The original provider page traversal is missing.');
  check(combinedReport.coverage.filter(item => item.selectionTimeBasis === 'updated').every(item => item.populationDescription.includes('changed cases')), 'Updated observations need their population interpretation.');
  await save('combined-observed-report.html', desk.exportFile({ kind: 'html', reportId: combinedReport.id }).body, 'text/html');
  await save('combined-observed-report.csv', desk.exportFile({ kind: 'csv', reportId: combinedReport.id }).body, 'text/csv');
  await save('combined-observed-report-package.json', desk.exportFile({ kind: 'json', reportId: combinedReport.id }).body);
  journey.checks.push({ name: 'created-and-updated-source-reporting', createdCases: report.totals.intake,
    changedCases: JSON.parse(changedText).requests.length, combinedCases: combinedReport.totals.intake,
    reportId: combinedReport.id, coverage: combinedReport.coverage.map(item => ({sourceId:item.sourceId,timeBasis:item.selectionTimeBasis,traversal:item.traversal})) });
  const cutoff = new Date(Math.min(...sourceEnvelope.originals.map(r => Date.parse(r.capture.capturedAt))) - 1).toISOString();
  const historical = desk.build(action(desk, { definition: { ...definition, seriesId: 'boston-before-first-observation', asOf: cutoff } }));
  const historicalReport = desk.report(historical.reportId);
  check(historicalReport.totals.intake === 0 && historicalReport.totals.unobservedAtCutoff === sourceEnvelope.requests.length,
    'A request first observed after the cutoff was included in the historical report.');
  journey.checks.push({ name: 'actual-source-period-semantics-and-denominators', reportId: report.id,
    intake: report.totals.intake, originalStatuses: report.groups.sourceStatus, unmappedServices: report.totals.unmappedServices,
    missingProviderTargets: expectedReport.totals.unassessedTargets, historicalUnobserved: historicalReport.totals.unobservedAtCutoff,
    targetPerformance: report.totals.currentlyWithinTarget });
  const calendar = api.normalizeCalendar({ ...profile.calendars[0], id: 'boundary-calendar', name: 'Operator calendar boundary exercise',
    dateOverrides: { '2026-11-02': [] }, sourceReferences: ['TJLabs operator-selected closure and daylight-saving boundary exercise.'] });
  const resolver = api.calendarResolver([calendar]), clockStart = Date.parse('2026-10-30T20:30:00Z');
  const deadline = resolver.add('boundary-calendar@1', clockStart, 120);
  check(new Date(deadline).toISOString() === '2026-11-03T15:30:00.000Z', 'The weekend/closure/DST target deadline is incorrect.');
  check(resolver.between('boundary-calendar@1', clockStart, deadline) === 120, 'Resolved working intervals do not reproduce the target duration.');
  check(resolver.add('boundary-calendar@1', clockStart, 0) === clockStart, 'A valid zero target duration changed its origin.');
  let repeatedBoundary = false;
  try { api.resolveLocal('2026-11-01', '01:30', 'America/New_York', 'reject'); } catch (error) { repeatedBoundary = error.code === 'AMBIGUOUS_LOCAL_BOUNDARY'; }
  check(repeatedBoundary, 'An ambiguous local working boundary was silently chosen.');
  check(api.resolveLocal('2026-11-01', '01:30', 'America/New_York', 'later') -
    api.resolveLocal('2026-11-01', '01:30', 'America/New_York', 'earlier') === 3600000, 'Explicit repeated-boundary selection is incorrect.');
  await save('resolved-calendar-boundary.json', { calendar, origin: new Date(clockStart).toISOString(), durationMinutes: 120,
    deadline: new Date(deadline).toISOString(), resolvedIntervals: resolver.intervals() });
  journey.checks.push({ name: 'working-time-weekend-closure-and-daylight-saving', deadline: new Date(deadline).toISOString(), businessMinutes: 120 });
  const exports = {};
  for (const kind of ['json', 'csv', 'html', 'review']) {
    const exported = desk.exportFile({ kind, reportId: report.id, expectedRevision: desk.state().revision });
    const name = kind === 'json' ? 'complete-report-package.json' : kind === 'review' ? 'review-template.json' : 'service-report.' + kind;
    exports[kind] = exported.body; await save(name, exported.body, exported.contentType);
  }
  const receiverDirectory = join(output, 'received-reporting-workspace');
  receiver = api.openWorkspace(receiverDirectory);
  const received = receiver.receive(exports.json, { requestId: randomUUID(), expectedRevision: 0 });
  check(received.workspaceId !== desk.state().workspaceId, 'The independent receiving workspace reused the sender identity.');
  equal(receiver.report(report.id), report, 'The received immutable report changed.');
  equal(receiver.source(first.sourceId).envelope, sourceEnvelope, 'The received complete original source changed.');
  check(receiver.operation(firstInput.requestId).archived, 'The receiver lost the original import operation history.');
  receiver.close(); receiver = api.openWorkspace(receiverDirectory, { create: false });
  check(receiver.exportFile({ kind: 'html', reportId: report.id }).body === exports.html &&
    receiver.exportFile({ kind: 'csv', reportId: report.id }).body === exports.csv, 'The reopened customer report differs from the original edition.');
  const returned = JSON.parse(exports.review); returned.reviewer = 'TJLabs commissioning operator';
  returned.changes = [
    { id: 'management-comment', kind: 'report-comment', comment: 'The original source closure reasons remain visible beside each case status. This edition preserves every selected provider version and its observation cutoff.' },
    { id: 'case-disposition-review', kind: 'request-comment', key: report.rows[0].key, sourceSha256: report.rows[0].sourceSha256,
      comment: 'Review the original disposition and the selected source version before assigning the next internal action.' }
  ];
  const returnedText = json(returned);
  await save('reviewer-return.json', returnedText);
  const importedReview = receiver.importReview(action(receiver, { originalText: returnedText }));
  const changedProfile = structuredClone(profile); changedProfile.revision = 2; changedProfile.calendars[0].revision = 2;
  changedProfile.policies[0].revision = 2; changedProfile.policies[0].durationMinutes = 480;
  changedProfile.policies[0].calendarKey = changedProfile.calendars[0].id + '@2';
  const nextProfile = receiver.putProfile(action(receiver, { profile: changedProfile }));
  const nextReport = receiver.build(action(receiver, { definition: { ...definition, profileId: nextProfile.profileId,
    name: 'Boston created cases — revised operator target' } }));
  check(receiver.exportFile({ kind: 'html', reportId: report.id }).body === exports.html, 'A later calendar/policy edition changed a saved report.');
  let staleBase = false;
  try { receiver.applyReview(action(receiver, { selection: { reviewId: importedReview.reviewId, changeIds: returned.changes.map(c => c.id) } })); }
  catch (error) { staleBase = error.code === 'REVIEW_BASE_CHANGED' && error.details?.before?.id === report.id && error.details?.after?.id === nextReport.reportId; }
  check(staleBase, 'A changed review base was incorporated without its visible report comparison.');
  const applied = receiver.applyReview(action(receiver, { selection: { reviewId: importedReview.reviewId,
    changeIds: returned.changes.map(c => c.id), rebaseToReportId: nextReport.reportId } }));
  const successor = receiver.report(applied.reportId);
  check(successor.predecessorId === nextReport.reportId && successor.requestComments[report.rows[0].key].sourceSha256 === report.rows[0].sourceSha256,
    'The incorporated reviewer return lost its original request version or predecessor.');
  await save('report-comparison.json', receiver.compare(report.id, successor.id));
  await save('received-successor-package.json', receiver.exportFile({ kind: 'json', reportId: successor.id }).body);
  await save('received-successor-report.html', receiver.exportFile({ kind: 'html', reportId: successor.id }).body, 'text/html');
  journey.checks.push({ name: 'independent-receive-reopen-and-review-successor', originalWorkspaceId: desk.state().workspaceId,
    receivedWorkspaceId: received.workspaceId, baseReportId: report.id, revisedProfile: nextProfile.profileId,
    priorEdition: nextReport.reportId, successorReportId: successor.id, reviewId: importedReview.reviewId,
    sourceVersion: report.rows[0].sourceSha256, incorporatedChanges: returned.changes.length });
  http = await api.serveReporting({ directory: receiverDirectory, host: '127.0.0.1', port: 0 });
  const launch = await (await fetch(http.launch.url + 'api/launch')).json();
  equal(launch, http.launch, 'The live reporting startup differs from its selected binding.');
  check(launch.binding.schema === api.BINDING_SCHEMA && launch.binding.sha256 === launch.bindingSha256, 'Applications nested startup binding differs.');
  const landing = await fetch(http.launch.url), cookie = landing.headers.get('set-cookie')?.split(';')[0];
  check(landing.ok && cookie, 'The reporting browser session did not start.');
  const stateResponse = await fetch(http.launch.url + 'api/state', { headers: { Cookie: cookie } }), stateBody = await stateResponse.json();
  check(stateResponse.ok && stateBody.ok && stateBody.value.workspaceId === received.workspaceId, 'The authenticated browser API selected another workspace.');
  const wrongOrigin = await fetch(http.launch.url + 'api/build', { method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  check(wrongOrigin.status === 403, 'The private reporting action accepted a different origin.');
  const apiExport = await fetch(http.launch.url + 'api/export?kind=csv&reportId=' + encodeURIComponent(successor.id), { headers: { Cookie: cookie } });
  check(await apiExport.text() === receiver.exportFile({ kind: 'csv', reportId: successor.id }).body, 'The authenticated report CSV differs from the immutable edition.');
  if (config.options?.uiRunner) {
    const uiPath = join(output, 'browser-journey.mjs');
    await writeFile(uiPath, config.options.uiRunner, { flag: 'wx', mode: 0o600 });
    const ui = await import(pathToFileURL(uiPath));
    check(typeof ui.runReportingBrowserJourney === 'function', 'The complete browser operation export is missing.');
    const playwright = await import(pathToFileURL(config.playwrightModule)), { chromium } = playwright.default ?? playwright;
    const operatorDirectory = join(output, 'browser-operator-workspace'), browserReceivingDirectory = join(output, 'browser-receiving-workspace');
    for (const directory of [operatorDirectory, browserReceivingDirectory]) {
      const initialized = api.openWorkspace(directory); initialized.close();
    }
    let operatorDesk, receivingDesk;
    try {
      operatorDesk = await api.serveReporting({ directory: operatorDirectory, port: 0 });
      receivingDesk = await api.serveReporting({ directory: browserReceivingDirectory, port: 0 });
      journey.browser = await ui.runReportingBrowserJourney({ chromium, baseUrl: operatorDesk.launch.url,
        receivingUrl: receivingDesk.launch.url, sourceFile: join(output, 'original-collection.json'),
        profile, definition, outputDirectory: join(output, 'browser'),
        executablePath: config.chromiumExecutablePath, reviewer: 'TJLabs commissioning operator' });
    } finally {
      if (receivingDesk) await receivingDesk.close();
      if (operatorDesk) await operatorDesk.close();
    }
  } else {
    const playwright = await import(pathToFileURL(config.playwrightModule)), { chromium } = playwright.default ?? playwright;
    browser = await chromium.launch({ headless: true, ...(config.chromiumExecutablePath ? { executablePath: config.chromiumExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => journey.browserErrors.push(error.message));
    await page.goto(http.launch.url);
    await page.waitForLoadState('networkidle');
    check((await page.locator('body').textContent()).includes('Open311'), 'The reporting desk did not render.');
    await page.screenshot({ path: join(output, 'reporting-desk.png'), fullPage: true });
    check(journey.browserErrors.length === 0, 'The reporting desk raised browser errors.');
    await browser.close(); browser = null;
    journey.browser = { landing: true, pageErrors: [] };
  }
  if (config.options?.bostonUiRunnerPath) {
    const ui = await import(pathToFileURL(config.options.bostonUiRunnerPath));
    const playwright = await import(pathToFileURL(config.playwrightModule)), { chromium } = playwright.default ?? playwright;
    journey.bostonDrilldown = await ui.runBostonReportBrowserJourney({ chromium,
      executablePath: config.chromiumExecutablePath, reportingUrl: http.launch.url,
      reportIds: [report.id, combinedReport.id], outputDirectory: join(output, 'boston-report-drilldown'), timeoutMs: 90000 });
  }
  journey.checks.push({ name: 'private-reporting-http-api-and-browser', workspaceId: received.workspaceId,
    bindingSha256: launch.bindingSha256, browser: journey.browser });
  const { main } = await import(pathToFileURL(join(product, 'cli.mjs')));
  let cliState;
  await main(['state', '--workspace', receiverDirectory], { output: value => { cliState = value; } });
  check(cliState.workspaceId === received.workspaceId && cliState.reports.some(r => r.id === successor.id), 'The reporting CLI state differs from the reopened report workspace.');
  journey.checks.push({ name: 'reporting-command-module-read', command: 'open311-reporting state', workspaceId: cliState.workspaceId, revision: cliState.revision });
  journey.state = 'passed'; journey.reportId = successor.id; journey.reportSha256 = successor.sha256;
} catch (error) {
  journey.state = 'failed'; journey.error = { code: error.code, message: error.message, details: error.details, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (http) await http.close().catch(error => { journey.closeError = error.message; });
  if (receiver) receiver.close();
  if (desk) desk.close();
  journey.completedAt = at();
  await writeFile(join(output, 'journey.json'), json(journey), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ state: journey.state, output, checks: journey.checks.length, reportId: journey.reportId, error: journey.error }));
}
