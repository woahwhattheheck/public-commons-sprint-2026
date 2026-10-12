#!/usr/bin/env node
// MIT. Native reporting journey over the complete original Helsinki collection.
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
  try {
    const originalText = await readFile(join(config.collectionOutput, 'collection.json'), 'utf8');
    journey.sourceInput = { method: 'Original completed collection browser export', path: 'collection.json', sha256: sha(originalText) };
    return originalText;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { openWorkspace } = await import(pathToFileURL(join(config.product, 'workspace.mjs')));
  const { createClient } = await import(pathToFileURL(join(config.product, 'client.mjs')));
  const retained = new Map(config.retained.captures.map(entry => [entry.receipt.url, entry]));
  function clientFactory(connection) {
    let selected;
    const client = createClient(connection, { fetchImpl: async (url, init) => {
      check(init.method === 'GET', 'The retained source boundary must receive the original civic GET.');
      selected = retained.get(String(url));
      check(selected, 'An exact complete original is required for URL ' + url);
      const bytes = Buffer.from(selected.raw.body, 'base64');
      check(bytes.length === selected.raw.bytes && sha(bytes) === selected.raw.sha256, 'Retained original bytes changed.');
      return new Response(bytes, { status: selected.receipt.status ?? 200,
        headers: selected.receipt.headers ?? { 'content-type': selected.raw.contentType } });
    } });
    return Object.fromEntries(['services', 'requests', 'service', 'request', 'token', 'discovery'].map(method => [method, async (...args) => {
      selected = null; const result = await client[method](...args), original = selected;
      check(original && original.raw.sha256 === result.raw.sha256, 'Original source decoding changed the response.');
      return { ...result, receipt: { ...original.receipt, method: original.receipt.method ?? null,
        status: original.receipt.status ?? null, headers: original.receipt.headers ?? null,
        startedAt: original.receipt.startedAt ?? null, durationMs: original.receipt.durationMs ?? null,
        kind: result.receipt.kind, query: result.receipt.query, coverage: result.receipt.coverage,
        replayedAt: at(), replaySource: 'Complete original commissioning input', replayTransportStatus: original.receipt.status ?? 200 } };
    }]));
  }
  const source = openWorkspace(join(output, 'original-collection-workspace'), { clientFactory });
  try {
    source.putConnection(action(source, { connection: config.connection }));
    await source.capture(action(source, { connectionId: config.connection.id, kind: 'services', query: { locale: 'en' } }));
    const created = source.createCollection(action(source, { connectionId: config.connection.id,
      name: 'Helsinki original collection for service reporting', query: config.fallbackQuery,
      policy: { maxWindowDays: 90, queryQuantumMs: 1000, minimumWindowMs: 1000, boundaryOverlapMs: 1000 } }));
    await source.runCollection(action(source, { collectionId: created.collection.id }));
    const detail = source.collectionInfo({ id: created.collection.id, limit: 100 });
    check(detail.collection.capResolved, 'The original collection has an unresolved source cap.');
    const exported = source.export({ kind: 'json', collection: created.collection.id });
    await save('original-collection-workspace.json', source.export({ kind: 'workspace' }).body);
    journey.sourceInput = { method: 'Original native collection workspace over complete retained source responses',
      collectionId: created.collection.id, sha256: sha(exported.body), summary: detail.collection };
    return exported.body;
  } finally { source.close(); }
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
  const profile = JSON.parse(await readFile(join(product, 'examples/weekday-review-profile.json'), 'utf8'));
  const savedProfile = desk.putProfile(action(desk, { profile }));
  await save('operator-profile.json', profile);
  const definition = { name: 'Helsinki published requests — 1–12 October service review',
    seriesId: 'helsinki-october-service-review', sourceIds: [first.sourceId], profileId: savedProfile.profileId,
    period: { start: '2026-10-01T00:00:00Z', end: '2026-10-12T00:00:00Z' }, asOf: at(), displayTimeZone: 'Europe/Helsinki',
    cohort: 'requestedAt', targetBasis: 'policyDueAt', filters: {},
    commentary: 'Published requests in the selected creation period, grouped with their original source processing states and the selected TJLabs internal review target.' };
  await save('report-definition.json', definition);
  const made = desk.build(action(desk, { definition })), report = desk.report(made.reportId);
  const inPeriod = sourceEnvelope.requests.filter(row => Date.parse(row.requestedAt) >= Date.parse(definition.period.start) && Date.parse(row.requestedAt) < Date.parse(definition.period.end));
  check(report.totals.intake === inPeriod.length && report.totals.intake > 0, 'The original creation-period population differs.');
  check(report.rows.every(row => row.resolutionMinutes === null), 'Helsinki last-update time was used as physical resolution.');
  check(report.rows.every(row => row.serviceCode !== null || row.group === 'Unmapped service'), 'Blank original service codes were silently mapped.');
  check(report.rows.every(row => row.sourceSha256 === sourceEnvelope.requests.find(item => item.key === row.key).sourceSha256), 'A report selected a different original source version.');
  const expected = desk.build(action(desk, { definition: { ...definition, name: 'Provider expectations for the retained period',
    seriesId: 'helsinki-provider-expectations', targetBasis: 'sourceExpectedAt' } }));
  const expectedReport = desk.report(expected.reportId);
  check(expectedReport.totals.assessedTargets === 0 && expectedReport.totals.unassessedTargets === inPeriod.length &&
    expectedReport.totals.completedOnTime.percentage === null, 'Missing provider expectations changed the eligible target denominator.');
  const cutoff = new Date(Math.min(...sourceEnvelope.originals.map(r => Date.parse(r.capture.capturedAt))) - 1).toISOString();
  const historical = desk.build(action(desk, { definition: { ...definition, seriesId: 'helsinki-before-first-observation', asOf: cutoff } }));
  const historicalReport = desk.report(historical.reportId);
  check(historicalReport.totals.intake === 0 && historicalReport.totals.unobservedAtCutoff === sourceEnvelope.requests.length,
    'A request first observed after the cutoff was included in the historical report.');
  journey.checks.push({ name: 'actual-source-period-semantics-and-denominators', reportId: report.id,
    intake: report.totals.intake, originalStatuses: report.groups.sourceStatus, unmappedServices: report.totals.unmappedServices,
    missingProviderTargets: expectedReport.totals.unassessedTargets, historicalUnobserved: historicalReport.totals.unobservedAtCutoff,
    targetPerformance: report.totals.currentlyWithinTarget });
  const calendar = api.normalizeCalendar({ ...profile.calendars[0], id: 'boundary-calendar', name: 'Operator calendar boundary exercise',
    dateOverrides: { '2026-10-26': [] }, sourceReferences: ['TJLabs operator-selected closure and daylight-saving boundary exercise.'] });
  const resolver = api.calendarResolver([calendar]), clockStart = Date.parse('2026-10-23T13:30:00Z');
  const deadline = resolver.add('boundary-calendar@1', clockStart, 120);
  check(new Date(deadline).toISOString() === '2026-10-27T08:30:00.000Z', 'The weekend/closure/DST target deadline is incorrect.');
  check(resolver.between('boundary-calendar@1', clockStart, deadline) === 120, 'Resolved working intervals do not reproduce the target duration.');
  check(resolver.add('boundary-calendar@1', clockStart, 0) === clockStart, 'A valid zero target duration changed its origin.');
  let repeatedBoundary = false;
  try { api.resolveLocal('2026-10-25', '03:30', 'Europe/Helsinki', 'reject'); } catch (error) { repeatedBoundary = error.code === 'AMBIGUOUS_LOCAL_BOUNDARY'; }
  check(repeatedBoundary, 'An ambiguous local working boundary was silently chosen.');
  check(api.resolveLocal('2026-10-25', '03:30', 'Europe/Helsinki', 'later') -
    api.resolveLocal('2026-10-25', '03:30', 'Europe/Helsinki', 'earlier') === 3600000, 'Explicit repeated-boundary selection is incorrect.');
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
    { id: 'management-comment', kind: 'report-comment', comment: 'The original service-code gaps remain visible for the receiving team to map. This edition preserves every selected provider source version and its observation cutoff.' },
    { id: 'request-mapping-review', kind: 'request-comment', key: report.rows[0].key, sourceSha256: report.rows[0].sourceSha256,
      comment: 'Review the appropriate council service group for this published request before assigning an operator category.' }
  ];
  const returnedText = json(returned);
  await save('reviewer-return.json', returnedText);
  const importedReview = receiver.importReview(action(receiver, { originalText: returnedText }));
  const changedProfile = structuredClone(profile); changedProfile.revision = 2; changedProfile.calendars[0].revision = 2;
  changedProfile.policies[0].revision = 2; changedProfile.policies[0].durationMinutes = 480;
  changedProfile.policies[0].calendarKey = changedProfile.calendars[0].id + '@2';
  const nextProfile = receiver.putProfile(action(receiver, { profile: changedProfile }));
  const nextReport = receiver.build(action(receiver, { definition: { ...definition, profileId: nextProfile.profileId,
    name: 'Helsinki published requests — revised operator target' } }));
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
