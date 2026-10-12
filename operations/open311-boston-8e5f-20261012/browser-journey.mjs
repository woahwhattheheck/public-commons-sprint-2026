import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';

/**
 * Operate the actual Boston browser with retained, original source responses.
 * The caller starts the source and empty receiving servers with its source adapter.
 *
 * runBostonBrowserJourney({
 *   chromium, executablePath?, sourceUrl, receivingUrl, connectionId,
 *   outputDirectory, timeoutMs?,
 *   cases: [{ key, name, query, policy, sourceFiles: [absolutePath | {path,sha256?}],
 *             expectedPageRows: [40,40,4] }]
 * })
 *
 * Supply the original created-page case and both original update-period cases.
 * The helper derives every request identity, note and count from those input files.
 * It preserves the browser's actual query, mutation intent, originals and exports.
 * runBostonReportBrowserJourney accepts the same browser options, reportingUrl,
 * reportIds and outputDirectory after the caller has built the saved reports.
 */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isoLocal = value => {
  const date = new Date(value);
  assert(Number.isFinite(date.valueOf()), 'A source range needs an explicit valid timestamp.');
  return date.toISOString().slice(0, -1);
};
const keyName = value => {
  assert(/^[a-z0-9][a-z0-9_-]{0,80}$/.test(value), 'Use a simple unique output key.');
  return value;
};
const unwrap = value => value?.ok === true && Object.hasOwn(value, 'value') ? value.value : value;
const rangeKeys = basis => basis === 'updated' ? ['updated_after', 'updated_before'] : ['start_date', 'end_date'];
const requestRows = value => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.service_requests)) return value.service_requests;
  if (Array.isArray(value?.requests)) return value.requests;
  throw new Error('A retained source file must contain the original request array or documented wrapper.');
};
const describeError = error => ({ name: error.name, message: error.message, stack: error.stack });

async function jsonFile(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function api(page, path) {
  const response = await page.context().request.get(new URL(path, page.url()).href);
  const body = await response.json();
  assert(response.ok(), 'GET ' + path + ': ' + JSON.stringify(body));
  assert.notEqual(body?.ok, false, 'GET ' + path + ': ' + JSON.stringify(body));
  return unwrap(body);
}
async function mutation(page, path, action) {
  const pending = page.waitForResponse(response =>
    new URL(response.url()).pathname === path && response.request().method() === 'POST');
  await action();
  const response = await pending, body = await response.json();
  assert(response.ok(), path + ': ' + JSON.stringify(body));
  assert.notEqual(body?.ok, false, path + ': ' + JSON.stringify(body));
  const intent = response.request().postDataJSON();
  assert.equal(typeof intent.requestId, 'string');
  assert(Number.isSafeInteger(intent.expectedRevision));
  return { value: unwrap(body), requestId: intent.requestId, intent, status: response.status() };
}
async function saveDownload(page, action, path) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
  await download.saveAs(path);
  const failure = await download.failure();
  assert.equal(failure, null, 'The browser download must finish.');
  const bytes = await readFile(path);
  return { path, name: download.suggestedFilename(), bytes: bytes.length, sha256: digest(bytes) };
}
async function visibleText(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) =>
    document.querySelector(selector)?.textContent.includes(expected), { selector, expected });
}
async function field(page, selector, value) {
  await page.locator(selector).fill(String(value));
}
async function openDetails(page, selector) {
  const details = page.locator(selector);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
async function readOriginals(sourceFiles, expectedRows) {
  assert(Array.isArray(sourceFiles) && sourceFiles.length, 'Each case needs its complete original source files.');
  const originals = [];
  for (const entry of sourceFiles) {
    const file = typeof entry === 'string' ? { path: entry } : entry;
    assert(isAbsolute(file.path), 'Original source paths must be absolute.');
    const bytes = await readFile(file.path);
    const sha256 = digest(bytes);
    if (file.sha256) assert.equal(sha256, file.sha256, 'The retained original file changed.');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const rows = requestRows(value);
    for (const row of rows) assert(row && row.service_request_id !== undefined && row.service_request_id !== null,
      'Every original row needs its provider request identity.');
    originals.push({ path: file.path, sha256, bytes, rows });
  }
  if (expectedRows) assert.deepEqual(originals.map(item => item.rows.length), expectedRows);
  return originals;
}
function sameQuery(actual, selected) {
  const dates = new Set(['start_date', 'end_date', 'updated_after', 'updated_before']);
  for (const [key, value] of Object.entries(selected)) {
    if (key === 'page') continue;
    if (dates.has(key)) assert.equal(Date.parse(actual[key]), Date.parse(value), 'Source date instant: ' + key);
    else assert.equal(String(actual[key]), String(value), 'Source filter: ' + key);
  }
  assert.equal(actual.page, undefined, 'The collection traversal owns its original page sequence.');
  if (selected.per_page !== undefined) assert.equal(actual.page_size, undefined, 'Use the provider per_page argument.');
}
async function fillCollection(page, selected, connection) {
  await page.locator('[data-view="collections"]').click();
  await page.locator('#collection-new').click();
  await field(page, '#collection-name', selected.name);
  const basis = selected.policy?.timeBasis ?? 'created', strategy = selected.policy?.strategy ?? 'windows';
  await page.locator('#collection-time-basis').selectOption(basis);
  await page.locator('#collection-strategy').selectOption(strategy);
  const [start, end] = rangeKeys(basis), query = selected.query;
  await field(page, '#collection-start', isoLocal(query[start]));
  await field(page, '#collection-end', isoLocal(query[end]));
  if (await page.locator('#collection-additional-range').isVisible()) {
    await openDetails(page, '#collection-additional-range');
    const [otherStart, otherEnd] = rangeKeys(basis === 'created' ? 'updated' : 'created');
    await field(page, '#collection-other-start', query[otherStart] ? isoLocal(query[otherStart]) : '');
    await field(page, '#collection-other-end', query[otherEnd] ? isoLocal(query[otherEnd]) : '');
  }
  await field(page, '#collection-service', query.service_code ?? '');
  await field(page, '#collection-status', query.status ?? '');
  for (const input of await page.locator('[data-collection-extension]').all()) {
    const key = await input.getAttribute('data-collection-extension');
    await input.fill(query[key] === undefined ? '' : String(query[key]));
  }
  if (await page.locator('#collection-source-size').isVisible()) {
    const sizeKey = connection.responseLimitParameter || 'page_size';
    await field(page, '#collection-source-size', query[sizeKey] ?? connection.responseLimit);
  }
  if (await page.locator('#collection-extended').isVisible())
    await page.locator('#collection-extended').setChecked(query.extensions === true || query.extensions === 'true');
  const precision = page.locator('#collection-form details').filter({
    has: page.locator('summary', { hasText: 'Date intervals and query precision' })
  });
  if (await precision.getAttribute('open') === null) await precision.locator('summary').click();
  const policy = selected.policy ?? {};
  for (const [id, value] of [
    ['collection-max-days', policy.maxWindowDays ?? 90],
    ['collection-min-ms', policy.minimumWindowMs ?? 1000],
    ['collection-overlap-ms', policy.boundaryOverlapMs ?? 1000],
    ['collection-quantum-ms', policy.queryQuantumMs ?? 1000]
  ]) await field(page, '#' + id, value);
}
async function collectMembers(page, collectionId) {
  const all = [];
  let offset = 0, collection;
  do {
    const result = await api(page, '/api/collection?' + new URLSearchParams({
      id: collectionId, offset: String(offset), limit: '100'
    }));
    collection = result.collection; all.push(...result.items);
    if (result.nextOffset === null || result.nextOffset === undefined) break;
    assert(result.nextOffset > offset, 'Member traversal must make progress.');
    offset = result.nextOffset;
  } while (true);
  return { collection, members: all };
}
function validateOriginalExport(envelope, originals) {
  assert.equal(envelope.schema, 'commons.open311.collection-export.v1');
  const expected = originals.map(item => item.sha256).sort();
  assert.deepEqual(envelope.originals.map(item => item.raw.sha256).sort(), expected,
    'The complete collection must retain every selected source response.');
  for (const item of envelope.originals) {
    assert.equal(item.raw.encoding, 'base64');
    assert.notEqual(item.raw.complete, false);
    const bytes = Buffer.from(item.raw.body, 'base64');
    assert.equal(digest(bytes), item.raw.sha256);
    assert.equal(bytes.length, item.raw.bytes);
    const original = originals.find(value => value.sha256 === item.raw.sha256);
    assert(original && bytes.equals(original.bytes), 'Original response bytes must survive the browser workflow.');
  }
  const expectedIds = [...new Set(originals.flatMap(item => item.rows.map(row => String(row.service_request_id))))].sort();
  assert.deepEqual(envelope.requests.map(row => String(row.serviceRequestId)).sort(), expectedIds);
  return expectedIds;
}
async function reviewOriginalCase(page, collectionId, output, selected) {
  const list = await api(page, '/api/requests?' + new URLSearchParams({ collection: collectionId, offset: '0', limit: '100' }));
  if (!list.items.length) return null;
  const row = list.items.find(item => item.source?.status_notes || item.source?.notes?.length) ?? list.items[0];
  await page.locator('#collection-open').click();
  await field(page, '#filter-q', row.serviceRequestId);
  await page.locator('#request-filters button[type="submit"]').click();
  await page.locator('#request-rows').getByRole('button', { name: String(row.serviceRequestId), exact: true }).click();
  await visibleText(page, '#detail-title', row.serviceRequestId);
  const renderedSource = JSON.parse(await page.locator('#detail-source').textContent());
  assert.deepEqual(renderedSource, row.source);
  if (typeof row.source?.status_notes === 'string' && row.source.status_notes)
    await visibleText(page, '#detail-source-notes', row.source.status_notes);
  const publicNote = Array.isArray(row.source?.notes) ? row.source.notes.find(item => typeof item?.description === 'string' && item.description) : null;
  if (publicNote) await visibleText(page, '#detail-source-notes', publicNote.description);
  await page.locator('#review-status').selectOption('in_progress');
  await field(page, '#review-assignee', 'Municipal operations');
  await field(page, '#review-note', 'Reviewed original source status and public notes in the retained Boston response.');
  await field(page, '#review-due', '');
  const saved = await mutation(page, '/api/reviews', () => page.locator('#review-form button[type="submit"]').click());
  assert.equal(saved.intent.expectedSourceSha256, row.sourceSha256);
  assert.equal(saved.intent.captureId, row.captureId);
  const detail = await api(page, '/api/request?' + new URLSearchParams({ collection: collectionId, id: row.serviceRequestId }));
  assert.equal((detail.review ?? detail.item.review).status, 'in_progress');
  assert.deepEqual(detail.item.source, row.source);
  await page.screenshot({ path: join(output, selected.key + '-source-review.png'), fullPage: true });
  await page.locator('#close-detail').click();
  await page.locator('[data-view="collections"]').click();
  return { serviceRequestId: row.serviceRequestId, sourceSha256: row.sourceSha256, captureId: row.captureId,
    sourceStatus: row.status, publicNoteCount: row.source?.notes?.length ?? 0, mutation: saved };
}

export async function runBostonBrowserJourney(options) {
  const { chromium, sourceUrl, receivingUrl, connectionId, cases } = options;
  assert(chromium && sourceUrl && receivingUrl && connectionId);
  assert(Array.isArray(cases) && cases.length, 'Supply the complete retained Boston cases.');
  assert.notEqual(new URL(sourceUrl).origin, new URL(receivingUrl).origin, 'Receiving uses a separate local server.');
  const output = resolve(options.outputDirectory);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const result = { schema: 'commons.open311.boston-browser-journey.v1', startedAt: new Date().toISOString(),
    state: 'RUNNING', sourceUrl, receivingUrl, connectionId, cases: [], files: [], pageErrors: [] };
  const browser = await chromium.launch({ headless: true,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}), args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'UTC', viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage(); page.setDefaultTimeout(options.timeoutMs ?? 180000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    const initial = await api(page, '/api/state');
    const connection = initial.connections.find(item => item.id === connectionId);
    assert(connection, 'The caller must save the exact Boston connection before browser operation.');
    result.workspaceId = initial.workspaceId; result.connection = connection;
    await page.locator('#active-connection').selectOption(connectionId);
    for (const selected of cases) {
      keyName(selected.key); assert(selected.name && selected.query);
      const originals = await readOriginals(selected.sourceFiles, selected.expectedPageRows);
      await fillCollection(page, selected, connection);
      const created = await mutation(page, '/api/collections', () => page.locator('#collection-create').click());
      const collectionId = created.value.collection?.id;
      assert(collectionId, 'The original Save operation must return its saved collection identity.');
      sameQuery(created.intent.query, selected.query);
      assert.equal(created.intent.policy.timeBasis ?? 'created', selected.policy?.timeBasis ?? 'created');
      assert.equal(created.intent.policy.strategy ?? 'windows', selected.policy?.strategy ?? 'windows');
      await page.waitForFunction(id => document.getElementById('collection-choice')?.value === id, collectionId);
      const run = await mutation(page, '/api/collection-run', () => page.locator('#collection-run').click());
      const saved = await collectMembers(page, collectionId);
      assert.equal(saved.collection.state, 'COMPLETE', 'All selected original pages should reach a short terminal response.');
      await visibleText(page, '#collection-state', 'COMPLETE');
      const captureMembers = saved.members.filter(item => item.capture);
      assert.deepEqual(captureMembers.map(item => item.capture.rowCount), originals.map(item => item.rows.length));
      if ((selected.policy?.strategy ?? 'windows') === 'pages') {
        assert.deepEqual(captureMembers.map(item => item.page), originals.map((_, i) => i + 1));
        assert.deepEqual(captureMembers.map(item => item.state), originals.map((_, i) => i + 1 === originals.length ? 'CAPTURED' : 'PAGED'));
      }
      const originalDownloads = [];
      for (let i = 0; i < captureMembers.length; i++) {
        const member = captureMembers[i];
        const tableRow = member.page
          ? page.locator('#collection-windows tr').filter({ hasText: new RegExp('^Page ' + member.page + ' ·') })
          : page.locator('#collection-windows tr').nth(i);
        await tableRow.getByRole('button', { name: member.page ? 'Page' : 'Window', exact: true }).click();
        const inspected = JSON.parse(await page.locator('#inspector-content').textContent());
        assert.equal(inspected.id, member.id);
        if (member.page) assert.equal(inspected.page, member.page);
        await page.locator('#inspector-close').click();
        const download = await saveDownload(page,
          () => tableRow.getByRole('button', { name: 'Original', exact: true }).click(),
          join(output, selected.key + '-original-' + (i + 1) + '.json'));
        assert.equal(download.sha256, originals[i].sha256);
        originalDownloads.push(download); result.files.push(download);
      }
      const review = await reviewOriginalCase(page, collectionId, output, selected);
      const exports = {};
      for (const [kind, extension] of [['json', 'json'], ['csv', 'csv'], ['report', 'html']]) {
        exports[kind] = await saveDownload(page, () => page.locator('#collection-export-' + kind).click(),
          join(output, selected.key + '-collection.' + extension));
        result.files.push(exports[kind]);
      }
      const envelope = JSON.parse(await readFile(exports.json.path, 'utf8'));
      const requestIds = validateOriginalExport(envelope, originals);
      if (review) assert(envelope.requests.some(row => row.serviceRequestId === review.serviceRequestId &&
        row.review?.status === 'in_progress'), 'The collection export includes its source-linked review.');
      await page.screenshot({ path: join(output, selected.key + '-collection.png'), fullPage: true });
      result.cases.push({ key: selected.key, name: selected.name, collectionId, query: saved.collection.query,
        policy: saved.collection.policy, summary: saved.collection, sourceCounts: originals.map(item => item.rows.length),
        sourceHashes: originals.map(item => item.sha256), requestIds, created, run, review, exports,
        members: saved.members.map(item => ({ id: item.id, page: item.page ?? null, state: item.state,
          captureId: item.capture?.id ?? null, rowCount: item.capture?.rowCount ?? null })) });
      await jsonFile(join(output, 'boston-browser-journey.json'), result);
    }
    const workspaceFile = await saveDownload(page, () => page.locator('#collection-export-workspace').click(),
      join(output, 'boston-complete-workspace.json'));
    result.files.push(workspaceFile);
    const complete = JSON.parse(await readFile(workspaceFile.path, 'utf8'));
    assert(complete.payload.collections.length >= cases.length);
    const receiving = await browser.newContext({ acceptDownloads: true, timezoneId: 'UTC', viewport: { width: 1440, height: 1050 } });
    const receivedPage = await receiving.newPage(); receivedPage.setDefaultTimeout(options.timeoutMs ?? 180000);
    receivedPage.on('pageerror', error => result.pageErrors.push(error.message));
    await receivedPage.goto(receivingUrl, { waitUntil: 'domcontentloaded' });
    const empty = await api(receivedPage, '/api/state');
    assert.equal(empty.connections.length, 0); assert.equal(empty.captures.length, 0);
    await receivedPage.locator('[data-view="handover"]').click();
    await receivedPage.locator('#receive-file').setInputFiles(workspaceFile.path);
    const receipt = await mutation(receivedPage, '/api/receive', () => receivedPage.locator('#receive-submit').click());
    await receivedPage.reload({ waitUntil: 'domcontentloaded' });
    const reopened = await api(receivedPage, '/api/state');
    assert.equal(reopened.workspaceId, result.workspaceId);
    for (const savedCase of result.cases) {
      assert(reopened.collections.some(item => item.id === savedCase.collectionId && item.state === 'COMPLETE'));
      const response = await receivedPage.context().request.get(new URL('/api/export?' + new URLSearchParams({
        kind: 'json', collection: savedCase.collectionId
      }), receivingUrl).href);
      assert(response.ok());
      const body = await response.body(), envelope = JSON.parse(body);
      assert.deepEqual(envelope.originals.map(item => item.raw.sha256).sort(), [...savedCase.sourceHashes].sort());
      assert.deepEqual(envelope.requests.map(row => row.serviceRequestId).sort(), [...savedCase.requestIds].sort());
      if (savedCase.review) assert(envelope.requests.some(row => row.serviceRequestId === savedCase.review.serviceRequestId &&
        row.review?.status === 'in_progress'));
      const path = join(output, savedCase.key + '-received-collection.json');
      await writeFile(path, body, { mode: 0o600 });
      result.files.push({ path, bytes: body.length, sha256: digest(body), name: path.split('/').at(-1) });
    }
    await receivedPage.locator('#active-connection').selectOption(connectionId);
    await receivedPage.locator('[data-view="collections"]').click();
    await receivedPage.locator('#collection-choice').selectOption(result.cases[0].collectionId);
    await visibleText(receivedPage, '#collection-state', 'COMPLETE');
    await receivedPage.screenshot({ path: join(output, 'boston-received-workspace.png'), fullPage: true });
    const sourceStillOpen = await api(page, '/api/state');
    assert.equal(sourceStillOpen.workspaceId, result.workspaceId);
    result.receiving = { originalDestinationId: empty.workspaceId, workspaceId: reopened.workspaceId,
      revision: reopened.revision, collectionCount: reopened.collections.length, receipt };
    assert.deepEqual(result.pageErrors, [], 'The operator pages must finish without browser exceptions.');
    result.state = 'SUCCEEDED';
  } catch (error) {
    result.state = 'FAILED'; result.error = describeError(error); throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await jsonFile(join(output, 'boston-browser-journey.json'), result);
    await browser.close();
  }
  return result;
}

export async function runBostonReportBrowserJourney(options) {
  const { chromium, reportingUrl, reportIds } = options;
  assert(chromium && reportingUrl && Array.isArray(reportIds) && reportIds.length);
  const output = resolve(options.outputDirectory); await mkdir(output, { recursive: true, mode: 0o700 });
  const result = { schema: 'commons.open311.boston-report-browser-journey.v1',
    state: 'RUNNING', startedAt: new Date().toISOString(), reports: [], files: [], pageErrors: [] };
  const browser = await chromium.launch({ headless: true,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}), args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'UTC', viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage(); page.setDefaultTimeout(options.timeoutMs ?? 90000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await page.goto(reportingUrl, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < reportIds.length; i++) {
      const reportId = reportIds[i], report = await api(page, '/api/report?' + new URLSearchParams({ id: reportId }));
      await page.locator('[data-view="reports"]').click();
      await page.locator('#report-select').selectOption(reportId);
      await page.locator('#report-open').click();
      await visibleText(page, '#report-identity', reportId);
      const coverageText = await page.locator('#report-coverage').textContent();
      for (const coverage of report.coverage) {
        const updated = coverage.selectionTimeBasis === 'updated', [start, end] = rangeKeys(updated ? 'updated' : 'created');
        assert(coverageText.includes(updated ? 'Source update period:' : 'Source creation period:'));
        assert(coverageText.includes(String(coverage.query[start])) && coverageText.includes(String(coverage.query[end])));
        if (coverage.populationDescription) assert(coverageText.includes(coverage.populationDescription));
      }
      const row = report.rows.find(item => item.sourceStatusNotes || item.sourceClosedAt || item.source?.notes?.length) ?? report.rows[0];
      let inspected = null;
      if (row) {
        await field(page, '#report-search', row.serviceRequestId);
        const button = page.locator('#report-rows button[data-case-key]');
        const keys = await button.evaluateAll(nodes => nodes.map(node => node.dataset.caseKey));
        const index = keys.indexOf(row.key); assert(index >= 0, 'The saved source case must be visible.');
        await button.nth(index).click();
        inspected = JSON.parse(await page.locator('#inspector-body').textContent());
        assert.equal(inspected.sourceClosedAt, row.sourceClosedAt ?? null);
        assert.equal(inspected.sourceStatusNotes, row.sourceStatusNotes ?? null);
        assert.deepEqual(inspected.originalPublicNotes, row.source?.notes ?? null);
        assert.equal(inspected['Source case-closure duration'].minutes, row.resolutionMinutes);
        assert.deepEqual(inspected.originalSource, row.source);
        await visibleText(page, '#inspector-body', 'Source case-closure duration');
        await page.screenshot({ path: join(output, 'boston-report-' + (i + 1) + '-case.png'), fullPage: true });
        await page.locator('#inspector-close').click();
      }
      const exports = {};
      for (const [kind, extension] of [['html', 'html'], ['csv', 'csv'], ['json', 'json']]) {
        exports[kind] = await saveDownload(page, () => page.locator('[data-report-export="' + kind + '"]').click(),
          join(output, 'boston-report-' + (i + 1) + '.' + extension));
        result.files.push(exports[kind]);
      }
      await page.screenshot({ path: join(output, 'boston-report-' + (i + 1) + '.png'), fullPage: true });
      result.reports.push({ reportId, sha256: report.sha256, rows: report.rows.length,
        coverage: report.coverage, inspected, exports });
    }
    assert.deepEqual(result.pageErrors, []);
    result.state = 'SUCCEEDED';
  } catch (error) {
    result.state = 'FAILED'; result.error = describeError(error); throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await jsonFile(join(output, 'boston-report-browser-journey.json'), result);
    await browser.close();
  }
  return result;
}
