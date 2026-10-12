#!/usr/bin/env node
// MIT. Original Boston data through the complete geographic customer operating workflow.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const timestamp = () => new Date().toISOString();
const execute = promisify(execFile);

export async function runGISCommissioning(config) {
  const product = resolve(config.gisProduct ?? config.product);
  const collectionOutput = resolve(config.collectionOutput);
  const reportingOutput = resolve(config.reportingOutput ?? join(collectionOutput, 'reporting'));
  const output = resolve(config.output);
  const api = await import(pathToFileURL(join(product, 'index.mjs')));
  const { canonical } = await import(pathToFileURL(join(product, 'shared.mjs')));
  const equal = (a, b, message) => check(canonical(a) === canonical(b), message);
  const journey = { schema: 'commons.open311.gis-customer-commissioning.v1', runId: randomUUID(),
    startedAt: timestamp(), state: 'running', node: process.version,
    edition: config.edition, sourceFiles: config.sourceFiles ?? [], phases: [], files: [], browserErrors: [] };
  const savedNames = new Set();
  let browser, sender, receiver, provider, reopened;
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const name of ['inputs', 'downloads', 'screenshots', 'merchant-exports'])
    await mkdir(join(output, name), { mode: 0o700 });
  async function recordFile(name, contentType) {
    check(!savedNames.has(name), 'A completed output file was recorded twice: ' + name);
    const bytes = await readFile(join(output, name));
    savedNames.add(name);
    journey.files.push({ name, bytes: bytes.length, sha256: sha(bytes), contentType });
    return bytes;
  }
  async function save(name, value, contentType = 'application/json') {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : json(value));
    await mkdir(dirname(join(output, name)), { recursive: true, mode: 0o700 });
    await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    await recordFile(name, contentType);
    return bytes;
  }
  function phase(name, result) {
    const value = { name, completedAt: timestamp(), ...result };
    journey.phases.push(value);
    console.log('OPEN311_GIS_PHASE ' + JSON.stringify(value));
  }
  async function screenshot(page, name) {
    await page.screenshot({ path: join(output, 'screenshots', name), fullPage: true });
    await recordFile('screenshots/' + name, 'image/png');
  }
  async function waitRevision(page, revision) {
    await page.waitForFunction(expected => {
      const value = document.getElementById('workspace-revision')?.textContent ?? '';
      return new RegExp('Edition\\s+' + expected + '\\b').test(value);
    }, revision);
    await page.locator('.pending-status').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.getElementById('main')?.getAttribute('aria-busy') === 'false');
  }
  async function submit(page, pathname, work) {
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === pathname && response.request().method() === 'POST');
    responsePromise.catch(() => {});
    await work();
    const response = await responsePromise, result = await response.json();
    check(response.ok() && result.ok !== false, pathname + ': ' + json(result.error ?? result));
    const value = Object.hasOwn(result, 'value') ? result.value : result;
    if (Number.isSafeInteger(value.revision)) await waitRevision(page, value.revision);
    return value;
  }
  async function navigate(page, view, selector) {
    await page.locator('.sidebar a[data-view="' + view + '"]').click();
    await page.waitForFunction(expected => document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('data-view') === expected, view);
    await page.locator(selector).waitFor({ state: 'visible' });
  }
  async function download(page, locator, name) {
    const pending = page.waitForEvent('download');
    await locator.click();
    const file = await pending, problem = await file.failure();
    check(!problem, 'The browser could not download ' + name + ': ' + problem);
    await file.saveAs(join(output, name));
    return recordFile(name, 'application/octet-stream');
  }
  async function importBrowserSource(page, item, reportId) {
    await navigate(page, 'sources', '#source-form');
    const inspected = await submit(page, '/api/inspect-source',
      () => page.locator('#source-file').setInputFiles(item.path));
    if (reportId && inspected.selectedReportId !== reportId)
      await submit(page, '/api/inspect-source',
        () => page.locator('#source-report').selectOption(reportId));
    await page.locator('#source-form input[name="name"]').fill(item.name);
    const result = await submit(page, '/api/import',
      () => page.locator('#source-form button[type="submit"]').click());
    return result.source;
  }
  async function makeHandoff(page, name, sourceIds, predecessorId = '') {
    await navigate(page, 'packages', '#handoff-form');
    await page.locator('#handoff-form input[name="name"]').fill(name);
    await page.locator('#handoff-form select[name="predecessorId"]').selectOption(predecessorId);
    const values = await page.locator('#handoff-form input[name="sourceIds"]').evaluateAll(nodes => nodes.map(node => node.value));
    for (const id of values)
      await page.locator('#handoff-form input[name="sourceIds"][value="' + id + '"]').setChecked(sourceIds.includes(id));
    const result = await submit(page, '/api/handoff',
      () => page.locator('#handoff-form button[type="submit"]').click());
    return result.handoff;
  }
  async function selectCases(page, handoffId, keys) {
    await navigate(page, 'cases', '#case-handoff');
    await page.locator('#case-handoff').selectOption(handoffId);
    await page.waitForFunction(id => {
      const rows = document.querySelectorAll('#main [data-action="case-detail"]');
      return rows.length > 0 && [...rows].every(row => row.dataset.handoffId === id);
    }, handoffId);
    await page.locator('[data-action="clear-selection"]').click();
    const requested = new Set(keys), selected = new Set();
    for (;;) {
      const visible = await page.locator('#main [data-select-key]').evaluateAll(nodes => nodes.map(node => node.dataset.selectKey));
      for (const key of visible) if (requested.has(key)) {
        await page.locator('[data-select-key="' + key + '"]').setChecked(true); selected.add(key);
      }
      const next = page.locator('[data-action="page-next"]');
      if (await next.isDisabled()) break;
      const before = await page.locator('.table-footer > span').innerText();
      await next.click();
      await page.waitForFunction(previous => document.querySelector('.table-footer > span')?.textContent !== previous, before);
    }
    equal([...selected].sort(), [...requested].sort(), 'The browser selection omitted a case on another page.');
    const count = await page.locator('.table-toolbar > span').innerText();
    check(count.startsWith(String(keys.length) + ' selected'), 'The browser did not retain the full selection across pages.');
  }

  try {
    const createdFile = join(collectionOutput, 'created-collection.json');
    const updatedFile = join(collectionOutput, 'updated-collection.json');
    const emptyFile = join(collectionOutput, 'empty-updated-collection.json');
    const reportFile = join(reportingOutput, 'combined-observed-report-package.json');
    const originals = [
      { name: 'Boston original created-case collection', path: createdFile, expectedRows: 84 },
      { name: 'Boston original updated-case collection', path: updatedFile, expectedRows: 21 },
      { name: 'Boston original empty updated period', path: emptyFile, expectedRows: 0 },
      { name: 'Boston combined source service report', path: reportFile, expectedRows: 104 }
    ];
    for (const [index, item] of originals.entries()) {
      const bytes = await readFile(item.path);
      await save('inputs/' + basename(item.path), bytes);
      item.path = join(output, 'inputs', basename(item.path));
      item.sha256 = sha(bytes); item.bytes = bytes.length; item.originalText = bytes.toString('utf8');
      if (index === 3) {
        const bundle = JSON.parse(item.originalText);
        const candidate = config.reportId ?? bundle.selectedReportId;
        const reports = bundle.records.filter(record => record.kind === 'report' && record.value.rows.length === 104);
        check(candidate || reports.length === 1, 'Choose the exact combined Boston report from this complete package.');
        item.reportId = candidate ?? reports[0].id;
      }
      const inspected = api.inspectSource(item.originalText, item.reportId ? { reportId: item.reportId } : {});
      check(inspected.summary?.rows === item.expectedRows, 'The retained original source population differs: ' + item.name);
      item.inspection = inspected;
    }
    const originalCreated = JSON.parse(originals[0].originalText), originalUpdated = JSON.parse(originals[1].originalText);
    const originalRecords = new Map([...originalCreated.requests, ...originalUpdated.requests].map(row => [row.serviceRequestId, row]));
    check(originalRecords.size === 104, 'The complete original collections do not contain 104 distinct request identities.');
    journey.originalInputs = originals.map(({ path, name, sha256, bytes, reportId, expectedRows }) =>
      ({ path, name, sha256, bytes, reportId, expectedRows }));
    const senderDirectory = join(output, 'sender-workspace'), receiverDirectory = join(output, 'receiver-workspace');
    for (const directory of [senderDirectory, receiverDirectory]) {
      const initialized = api.openWorkspace(directory); initialized.close();
    }
    sender = await api.serveGIS({ directory: senderDirectory });
    receiver = await api.serveGIS({ directory: receiverDirectory });
    const originalReceiverId = receiver.workspace.state().workspaceId;
    const playwright = await import(pathToFileURL(config.playwrightModule));
    const { chromium } = playwright.default ?? playwright;
    browser = await chromium.launch({
      executablePath: config.chromiumExecutablePath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs ?? 45000);
    page.on('pageerror', error => journey.browserErrors.push({ page: 'sender', message: error.message, stack: error.stack }));
    await page.goto(sender.url, { waitUntil: 'domcontentloaded' });
    await page.locator('#main h1').filter({ hasText: 'Geographic handoff' }).waitFor();
    const imported = [];
    for (const item of originals) imported.push(await importBrowserSource(page, item, item.reportId));
    equal(imported.map(source => source.counts.rows), [84, 21, 0, 104], 'The browser imported a different source population.');
    for (const source of imported) {
      const original = originals.find(item => item.sha256 === source.sha256);
      check(sender.workspace.source(source.id).originalText === original.originalText, 'A saved GIS source changed its original bytes.');
    }
    await screenshot(page, '01-original-sources.png');
    phase('original-city-and-report-import', { sources: imported.map(source => ({ id: source.id, name: source.name, rows: source.counts.rows, sha256: source.sha256 })) });

    const selectedSourceIds = imported.slice(0, 3).map(source => source.id);
    const originalHandoff = await makeHandoff(page, 'Boston geographic service review', selectedSourceIds);
    check(originalHandoff.counts.rows === 104 && originalHandoff.counts.located === 104, 'The original combined handoff lost real case identities or locations.');
    const reportHandoff = await makeHandoff(page, 'Boston report-derived geographic handoff', [imported[3].id]);
    const reportRows = sender.workspace.handoff({ id: reportHandoff.id, limit: 1000 }).items;
    check(reportRows.length === 104 && reportRows.every(row => row.reportContext?.reportId === originals[3].reportId),
      'The report-derived handoff lost its selected report context.');
    const sourceRows = sender.workspace.handoff({ id: originalHandoff.id, limit: 1000 }).items;
    for (const row of sourceRows) {
      check(originalRecords.has(row.serviceRequestId), 'A GIS row has no original municipal case.');
      check(row.geometry?.type === 'Point' && row.geometry.coordinates[0] === Number(row.source.long) &&
        row.geometry.coordinates[1] === Number(row.source.lat), 'The GIS point differs from the original longitude/latitude.');
    }
    const editRows = [sourceRows[0], sourceRows.at(-1), sourceRows[1]];
    const keys = editRows.map(row => row.key);
    check(new Set(keys).size === 3, 'Choose three distinct original cases for the internal analyst work.');
    await navigate(page, 'cases', '#case-handoff');
    await page.locator('#case-handoff').selectOption(originalHandoff.id);
    await page.waitForFunction(id => document.querySelector('#main [data-action="case-detail"]')?.dataset.handoffId === id, originalHandoff.id);
    check(await page.locator('#main table tbody tr').count() === 100, 'The first source page does not contain 100 of 104 cases.');
    const withNotes = sourceRows.find(row => row.sourceStatusNotes);
    check(withNotes, 'The original Boston selection has no retained source status note.');
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/handoff' && url.searchParams.get('q') === withNotes.serviceRequestId;
    });
    await page.locator('#case-query').fill(withNotes.serviceRequestId);
    const searchValue = await (await searched).json();
    check(searchValue.value.items.some(row => row.key === withNotes.key), 'The actual source case search did not return its original case.');
    await page.locator('[data-action="case-detail"][data-key="' + withNotes.key + '"]').click();
    await page.locator('#detail-dialog').waitFor({ state: 'visible' });
    check((await page.locator('#detail-content').innerText()).includes(withNotes.sourceStatusNotes), 'The case panel lost the source closure note.');
    await screenshot(page, '02-original-case-detail.png');
    await page.locator('#close-detail').click();
    await page.locator('#case-query').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#main table tbody tr').length === 100);
    await screenshot(page, '03-map-and-cases.png');
    await navigate(page, 'packages', '#handoff-form');
    const gpkgBytes = await download(page,
      page.locator('[data-action="export"][data-kind="gpkg"][data-handoff-id="' + originalHandoff.id + '"]'),
      'downloads/boston-analyst-original.gpkg');
    const decoded = api.readGeoPackage(gpkgBytes, { directory: output });
    check(decoded.rows.length === 104 && decoded.metadata.handoffId === originalHandoff.id, 'The original GIS download has a different handoff or population.');
    const returnedPath = join(output, 'inputs', 'boston-analyst-return.gpkg');
    await copyFile(join(output, 'downloads', 'boston-analyst-original.gpkg'), returnedPath);
    const edited = new DatabaseSync(returnedPath);
    try {
      const statement = edited.prepare('UPDATE open311_features SET assigned_team=?,work_order_id=?,priority=?,action=?,analyst_note=? WHERE feature_key=?');
      edited.exec('BEGIN IMMEDIATE');
      for (const [index, row] of editRows.entries()) {
        const result = statement.run('TJLabs internal commissioning desk', 'TJL-GIS-' + row.serviceRequestId,
          index === 2 ? 'review' : 'normal', index === 2 ? 'defer' : 'dispatch',
          'Internal commissioning assignment for the retained original case. Source geography and source disposition remain attached.', row.key);
        check(Number(result.changes) === 1, 'The native GIS edit did not select exactly one original feature.');
      }
      edited.exec('COMMIT');
    } catch (error) { try { edited.exec('ROLLBACK'); } catch {} throw error; }
    finally { edited.close(); }
    await recordFile('inputs/boston-analyst-return.gpkg', 'application/geopackage+sqlite3');
    phase('complete-gis-handoff-and-native-analyst-file', { originalHandoff, reportHandoff, originalCaseCount: sourceRows.length, selectedOriginalCases: editRows.map(row => row.serviceRequestId) });

    await navigate(page, 'review', '#return-form');
    await page.locator('#return-form select[name="handoffId"]').selectOption(originalHandoff.id);
    await page.locator('#return-form input[name="analyst"]').fill('TJLabs GIS commissioning operator');
    await page.locator('#return-form input[name="name"]').fill('Boston retained-source dispatch review');
    await page.locator('#return-file').setInputFiles(returnedPath);
    const receivedReturn = await submit(page, '/api/return', () => page.locator('#return-form button[type="submit"]').click());
    const returned = sender.workspace.returned(receivedReturn.returned.id);
    equal(returned.summary.counts, { changes: 3, conflicts: 0, missing: 0, unchanged: 101 }, 'The analyst return did not isolate the three actual edits.');
    const changes = editRows.map(row => returned.changes.find(change => change.key === row.key));
    check(changes.every(Boolean), 'A returned native edit has no source-linked proposal.');
    await page.locator('[data-review-choice="' + changes[0].id + '"]').selectOption('accept');
    await page.locator('[data-review-choice="' + changes[2].id + '"]').selectOption('reject');
    await page.locator('#decision-form input[name="reviewer"]').fill('TJLabs commissioning reviewer');
    await page.locator('#decision-form textarea[name="note"]').fill('Accept the first internal dispatch assignment; retain the deferred proposal as rejected.');
    const firstDecision = await submit(page, '/api/decision', () => page.locator('#decision-form button[type="submit"]').click());
    check(firstDecision.decision.accepted === 1 && firstDecision.decision.rejected === 1, 'The first partial review selected different proposals.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-review-choice="' + changes[1].id + '"]').waitFor();
    check(await page.locator('[data-review-choice]').count() === 1, 'Saved proposals remained selectable after a partial review.');
    await screenshot(page, '04-partial-review-history.png');
    await page.locator('[data-review-choice="' + changes[1].id + '"]').selectOption('accept');
    await page.waitForFunction(async ({ directory, returnId, changeId }) => {
      const db = await new Promise((resolve, reject) => {
        const opening = indexedDB.open('open311-geographic-handoff', 1);
        opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
      });
      try {
        const draft = await new Promise((resolve, reject) => {
          const reading = db.transaction('saved').objectStore('saved').get('drafts:directory:' + directory);
          reading.onsuccess = () => resolve(reading.result); reading.onerror = () => reject(reading.error);
        });
        return draft?.decision?.reviewChoices?.returnId === returnId &&
          draft.decision.reviewChoices.values?.[changeId] === 'accept';
      } finally { db.close(); }
    }, { directory: senderDirectory, returnId: returned.summary.id, changeId: changes[1].id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-review-choice="' + changes[1].id + '"]').waitFor();
    check(await page.locator('[data-review-choice="' + changes[1].id + '"]').inputValue() === 'accept', 'The original pending reviewer choice did not survive reload.');
    const secondDecision = await submit(page, '/api/decision', () => page.locator('#decision-form button[type="submit"]').click());
    const reviewedHandoff = secondDecision.handoff;
    await page.waitForFunction(() => document.querySelectorAll('[data-review-choice]').length === 0);
    check(reviewedHandoff.counts.dispatchReady === 2, 'The final review did not retain exactly two dispatch-ready cases.');
    const finalReturn = sender.workspace.returned(returned.summary.id);
    check(finalReturn.decisions.length === 2, 'The complete analyst review history was not retained.');
    phase('partial-review-and-persistent-operator-choice', { returnId: returned.summary.id, originalFileSha256: returned.summary.sha256,
      decisions: [firstDecision.decision, secondDecision.decision], reviewedHandoff });

    await selectCases(page, reviewedHandoff.id, keys.slice(0, 2));
    await navigate(page, 'dispatch', '#dispatch-form');
    await page.locator('#dispatch-form input[name="name"]').fill('Boston internal commissioning dispatch');
    await page.locator('#dispatch-form select[name="handoffId"]').selectOption(reviewedHandoff.id);
    await page.locator('#dispatch-form input[name="destination"]').fill('TJLabs receiving desk');
    await page.locator('#dispatch-form select[name="scope"]').selectOption('selected');
    await page.locator('#dispatch-form textarea[name="note"]').fill('Complete internal operating handover from two accepted original-case assignments.');
    const mapping = [
      { name: 'request', field: 'serviceRequestId' }, { name: 'assigned_team', field: 'assignedTeam' },
      { name: 'work_order', field: 'workOrderId' }, { name: 'longitude', field: 'longitude' },
      { name: 'latitude', field: 'latitude' }, { name: 'source_status', field: 'sourceStatus' },
      { name: 'source_notes', field: 'sourceStatusNotes' }, { name: 'operator_note', field: 'note' }
    ];
    await page.locator('#dispatch-form details').evaluate(node => { node.open = true; });
    await page.locator('#dispatch-form textarea[name="columns"]').fill(json(mapping));
    const madeDispatch = await submit(page, '/api/dispatch', () => page.locator('#dispatch-form button[type="submit"]').click());
    const dispatch = sender.workspace.dispatch(madeDispatch.dispatch.id);
    equal(dispatch.rows.map(row => row.key).sort(), keys.slice(0, 2).sort(), 'The dispatch lost its cross-page selected cases.');
    equal(dispatch.definition.columns, mapping, 'The saved destination mapping differs from the operator selection.');
    const dispatchFiles = {};
    for (const kind of ['gpkg', 'geojson', 'csv', 'json', 'html']) {
      const body = await download(page,
        page.locator('[data-action="export"][data-kind="' + kind + '"][data-dispatch-id="' + dispatch.summary.id + '"]'),
        'downloads/boston-dispatch.' + kind);
      dispatchFiles[kind] = { bytes: body.length, sha256: sha(body) };
      if (kind === 'gpkg') check(api.readGeoPackage(body, { directory: output }).rows.length === 2, 'The dispatch GeoPackage lost a selected row.');
      else {
        const expected = sender.workspace.exportFile({ kind, dispatchId: dispatch.summary.id }).body;
        check(body.equals(Buffer.from(expected)), 'The complete browser dispatch differs from its saved native edition: ' + kind);
      }
    }
    const csvRows = api.csvDecode((await readFile(join(output, 'downloads', 'boston-dispatch.csv'))).toString('utf8'));
    check(csvRows.length === 2 && csvRows.every(row => row.feature_key && row.source_sha256 && row.handoff_id && row.handoff_sha256),
      'The mapped dispatch CSV lost its original case identities.');
    await screenshot(page, '05-reviewed-dispatch.png');
    const senderPackageBytes = await download(page, page.locator('#download-workspace'), 'downloads/boston-complete-gis-workspace.json');
    const senderPackage = JSON.parse(senderPackageBytes.toString('utf8'));
    api.validateWorkspacePackage(senderPackageBytes.toString('utf8'), { directory: output });
    equal(senderPackage.records.filter(record => record.kind === 'source').map(record => record.value.sha256).sort(),
      originals.map(item => item.sha256).sort(), 'The complete workspace lost an original municipal or reporting file.');
    phase('mapped-reviewed-dispatch-and-complete-exports', { dispatch: dispatch.summary, mapping,
      files: dispatchFiles, workspaceBytes: senderPackageBytes.length, workspaceSha256: sha(senderPackageBytes) });

    const receivingPage = await context.newPage();
    receivingPage.setDefaultTimeout(config.timeoutMs ?? 45000);
    receivingPage.on('pageerror', error => journey.browserErrors.push({ page: 'receiver', message: error.message, stack: error.stack }));
    await receivingPage.goto(receiver.url, { waitUntil: 'domcontentloaded' });
    await navigate(receivingPage, 'receiving', '#receiving-form');
    await receivingPage.locator('#receiving-file').setInputFiles(join(output, 'downloads', 'boston-complete-gis-workspace.json'));
    let committedReceiving = null, resolveReceivingOutcome;
    const receivingRequest = {}, receivingOutcome = new Promise(resolve => { resolveReceivingOutcome = resolve; });
    await receivingPage.route(receiver.url + 'api/receive', async route => {
      try {
        const input = route.request().postDataJSON();
        receivingRequest.requestId = input.requestId; receivingRequest.expectedRevision = input.expectedRevision;
        const response = await route.fetch(), result = await response.json();
        if (!response.ok() || result.ok === false) {
          resolveReceivingOutcome({ error: result.error ?? result });
          await route.fulfill({ response }); return;
        }
        committedReceiving = result.value;
        await route.abort('failed');
        resolveReceivingOutcome({ value: committedReceiving });
      } catch (error) {
        resolveReceivingOutcome({ error: { message: error.message } });
        await route.abort('failed').catch(() => {});
      }
    }, { times: 1 });
    await receivingPage.locator('#receiving-form button[type="submit"]').click();
    let receivingTimer;
    const outcome = await Promise.race([receivingOutcome, new Promise(resolve => {
      receivingTimer = setTimeout(() => resolve({ error: { message: 'The real receiving action did not return before the operator timeout.' } }), config.timeoutMs ?? 45000);
    })]).finally(() => clearTimeout(receivingTimer));
    check(!outcome.error, 'The actual receiving operation failed: ' + json(outcome.error));
    await receivingPage.locator('.pending-status').waitFor({ state: 'visible' });
    check(committedReceiving?.workspaceId === senderPackage.workspaceId,
      'The real receiving action did not commit before its response was interrupted.');
    check(receiver.workspace.state().workspaceId !== originalReceiverId,
      'The receiving directory did not adopt the incoming original workspace identity.');
    await receivingPage.reload({ waitUntil: 'domcontentloaded' });
    await waitRevision(receivingPage, committedReceiving.revision);
    const recoveredOperation = receiver.workspace.operation(receivingRequest.requestId);
    equal(recoveredOperation.result, committedReceiving, 'Reload recovery returned a different receiving action.');
    check(!Object.hasOwn(recoveredOperation.input, 'originalText') && recoveredOperation.input.originalFile?.sha256 === sha(senderPackageBytes),
      'The received operation did not retain the compact identity of its incoming complete file.');
    const receivedPackage = receiver.workspace.workspaceExport();
    equal(receivedPackage.records, senderPackage.records, 'The independently received original files and operating records changed.');
    for (const original of senderPackage.operations)
      equal(receivedPackage.operations.find(operation => operation.requestId === original.requestId), original,
        'An original source/review action changed during receiving.');
    await navigate(receivingPage, 'overview', '#main h1');
    await screenshot(receivingPage, '06-received-workspace.png');
    const continued = await makeHandoff(receivingPage, 'Receiving desk continued Boston review', selectedSourceIds, reviewedHandoff.id);
    check(continued.counts.rows === 104 && continued.counts.dispatchReady === 2,
      'The receiving operator could not continue the complete reviewed handoff.');
    const receivedBytes = await download(receivingPage, receivingPage.locator('#download-workspace'), 'downloads/boston-received-editable-workspace.json');
    phase('browser-receive-response-recovery-and-continued-work', { originalInitializationId: originalReceiverId,
      workspaceId: receiver.workspace.state().workspaceId, receivingRequest, receivingOperation: recoveredOperation.result,
      compactInput: recoveredOperation.input, continuedHandoff: continued, receivedBytes: receivedBytes.length });
    await browser.close(); browser = null;
    await receiver.close(); receiver = null;
    await sender.close(); sender = null;

    reopened = api.openWorkspace(receiverDirectory, { create: false });
    equal(reopened.dispatch(dispatch.summary.id).rows, dispatch.rows, 'Independent native reopen changed the accepted dispatch rows.');
    check(reopened.handoff({ id: continued.id, limit: 1000 }).items.length === 104, 'Independent reopen lost the continued case population.');
    const reopenedBytes = Buffer.from(reopened.exportFile({ kind: 'workspace' }).body);
    await save('downloads/boston-reopened-workspace.json', reopenedBytes);
    reopened.close(); reopened = null;

    const cliDirectory = join(output, 'cli-received-workspace'), cliRequestId = randomUUID();
    const cli = await execute(process.execPath, [join(product, 'cli.mjs'), 'receive', '--workspace', cliDirectory,
      '--file', join(output, 'downloads', 'boston-received-editable-workspace.json'),
      '--request-id', cliRequestId, '--expected-revision', '0'], { maxBuffer: 2 * 1024 * 1024 });
    const cliResult = JSON.parse(cli.stdout);
    await save('cli-receiving-result.json', cliResult);
    reopened = api.openWorkspace(cliDirectory, { create: false });
    const thirdPackage = reopened.workspaceExport();
    const preceding = JSON.parse(receivedBytes.toString('utf8'));
    equal(thirdPackage.records, preceding.records, 'The command-line receiving hop changed the complete prior operating records.');
    check(thirdPackage.workspaceId === senderPackage.workspaceId && thirdPackage.revision === preceding.revision + 1,
      'The command-line receiving hop did not preserve the original workspace and next edition.');
    const thirdBytes = Buffer.from(reopened.exportFile({ kind: 'workspace' }).body);
    await save('downloads/boston-cli-received-workspace.json', thirdBytes);
    reopened.close(); reopened = null;
    phase('independent-reopen-and-installed-cli-receiving', { cliResult, senderBytes: senderPackageBytes.length,
      continuedReceivingBytes: receivedBytes.length, secondReceivingBytes: thirdBytes.length,
      secondReceivingGrowthBytes: thirdBytes.length - receivedBytes.length });

    const { MerchantOpen311GISWorkspaces, readGISWorkspaceConfiguration } = await import(pathToFileURL(join(product, 'mcp.mjs')));
    const { Open311GISMerchantClient, GIS_HOST_SCHEMA } = await import(pathToFileURL(join(product, 'mcp-client.mjs')));
    const hostPath = join(output, 'merchant-gis-host.json');
    await save('merchant-gis-host.json', { schema: GIS_HOST_SCHEMA, workspaces: {
      sender: { label: 'Boston original GIS operating desk', directory: senderDirectory, inputs: {} },
      recipient: { label: 'Boston received GIS operating desk', directory: cliDirectory, inputs: {
        original: { label: 'Complete original geographic handover', path: join(output, 'downloads', 'boston-complete-gis-workspace.json'),
          sha256: sha(senderPackageBytes), kind: 'workspace', format: 'json' }
      } }
    } });
    const host = await readGISWorkspaceConfiguration(hostPath);
    provider = new MerchantOpen311GISWorkspaces({ open311GISWorkspaces: host, exportsDirectory: join(output, 'merchant-exports') });
    const client = new Open311GISMerchantClient((name, args) => provider.call(name, args), 'recipient');
    const status = await client.status(), completeRows = [];
    let offset = 0;
    for (;;) {
      const page = await client.handoff({ id: continued.id, expectedRevision: status.revision, offset, limit: 17 });
      completeRows.push(...page.items);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    check(completeRows.length === 104 && new Set(completeRows.map(row => row.key)).size === 104,
      'The installed merchant client omitted an original source row across pages.');
    const file = await client.downloadFile({ kind: 'workspace', expectedRevision: status.revision }, { limit: 196608 });
    check(file.bytes.equals(thirdBytes), 'The typed merchant download differs from the complete independently received workspace.');
    await save('downloads/boston-merchant-workspace.json', file.bytes);
    const mapped = await client.downloadFile({ kind: 'csv', dispatchId: dispatch.summary.id, expectedRevision: status.revision }, { limit: 4096 });
    check(mapped.bytes.equals(await readFile(join(output, 'downloads', 'boston-dispatch.csv'))),
      'The installed merchant export changed the reviewed destination file.');
    const recovered = await client.operation(cliRequestId);
    check(recovered?.state === 'SUCCEEDED' && recovered.result.workspaceId === senderPackage.workspaceId,
      'The installed merchant client could not recover the existing CLI receiving operation.');
    await provider.close(); provider = null;
    phase('installed-merchant-paging-and-complete-file-receiving', { workspaceId: status.workspaceId, revision: status.revision,
      uniqueCases: completeRows.length, downloadedBytes: file.bytesRead, downloadedSha256: file.file.sha256,
      dispatchCsvBytes: mapped.bytesRead, recoveredRequestId: cliRequestId });
    check(journey.browserErrors.length === 0, 'The actual browser reported an application error.');
    journey.state = 'passed';
  } catch (error) {
    journey.state = 'failed';
    journey.error = { message: error.message, code: error.code, status: error.status, details: error.details, stack: error.stack };
    if (browser) {
      try {
        for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries())
          await screenshot(page, 'failure-' + index + '.png');
      } catch (captureError) { journey.captureError = captureError.message; }
    }
  } finally {
    if (provider) await provider.close().catch(error => { journey.closeError = error.message; });
    if (reopened) reopened.close();
    if (browser) await browser.close().catch(error => { journey.closeError = error.message; });
    if (receiver) await receiver.close().catch(error => { journey.closeError = error.message; });
    if (sender) await sender.close().catch(error => { journey.closeError = error.message; });
    journey.completedAt = timestamp();
    await writeFile(join(output, 'journey.json'), json(journey), { flag: 'wx', mode: 0o600 });
    console.log('OPEN311_GIS_COMPLETE ' + JSON.stringify({ state: journey.state, output, phases: journey.phases.length,
      files: journey.files.length, error: journey.error }));
  }
  return journey;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runGISCommissioning(JSON.parse(await readFile(process.argv[2], 'utf8')));
  if (result.state !== 'passed') process.exitCode = 1;
}
