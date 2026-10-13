// MIT. Actual browser continuation for the retained GSA catalogue correction course.
import { readFile, writeFile, mkdir, rename, unlink, open, lstat } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const SCHEMA = 'commons.dcat-correction-browser.v1';
const OPERATION = 'SCF-DCAT-CORRECTION-WORKBENCH-390E-20261013';
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const need = (condition, code, message = code) => {
  if (!condition) throw Object.assign(new Error(message), { code });
};
const errorValue = error => ({ code: error?.code ?? error?.name ?? 'BROWSER_COURSE_FAILED',
  message: String(error?.message ?? error).replace(/https?:\/\/127\.0\.0\.1:\d+\/?#[^\s"']+/g, '[private listener]').slice(0, 4000) });
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  need(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077), 'BROWSER_PRIVATE_DIRECTORY_REQUIRED', path);
}
async function readPrivate(path) {
  const file = await open(path, 'r');
  try {
    const before = await file.stat(), named = await lstat(path);
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && !named.isSymbolicLink() &&
      named.dev === before.dev && named.ino === before.ino, 'BROWSER_PRIVATE_FILE_REQUIRED', path);
    const raw = await file.readFile(), after = await file.stat();
    need(raw.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs &&
      after.ctimeMs === before.ctimeMs, 'BROWSER_INPUT_CHANGED', path);
    return raw;
  } finally { await file.close(); }
}
async function maybe(path) {
  try { return await readPrivate(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function save(path, value, exact = false) {
  await privateDirectory(dirname(path));
  const raw = Buffer.isBuffer(value) ? value : json(value), prior = await maybe(path);
  if (exact && prior) {
    need(prior.equals(raw), 'BROWSER_RETAINED_OUTPUT_CHANGED', path); return;
  }
  const temporary = path + '.pending-' + randomUUID(), handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  const parent = await open(dirname(path), 'r'); try { await parent.sync(); } finally { await parent.close(); }
}
async function delay(ms, signal) {
  signal?.throwIfAborted();
  await new Promise((done, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Interrupted')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); done(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function endpoint(listener) {
  const url = new URL(listener.url), origin = new URL(listener.origin);
  need(url.origin === origin.origin && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    url.pathname === '/' && !url.search && !url.username && !url.password && url.hash.length >= 33,
    'BROWSER_ORIGINAL_LOOPBACK_REQUIRED');
  return { url: url.href, origin: url.origin, token: url.hash.slice(1) };
}
/**
 * Uses an already open original workbench listener and an installed Playwright
 * runtime. The caller owns the listener/workspace; this module owns its browser.
 * A saved request is retried with its exact original UUID after interruption.
 */
export async function runDcatCorrectionBrowser({
  playwright, listener, outputDirectory, catalog, baselineDocumentPath, author,
  signal, timeoutMs = 120000, executablePath, correctionId = null, inspectOnly = false,
} = {}) {
  need(playwright?.chromium && isAbsolute(outputDirectory ?? '') &&
    (inspectOnly || isAbsolute(baselineDocumentPath ?? '')), 'BROWSER_COURSE_OPTIONS');
  need(UUID.test(catalog?.id ?? '') && HASH.test(catalog?.sha256 ?? '') &&
    Number.isSafeInteger(catalog?.bytes) && catalog.bytes > 0 &&
    typeof author === 'string' && author.trim() && author.length <= 160, 'BROWSER_COURSE_SELECTION');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'BROWSER_COURSE_TIMEOUT');
  if (inspectOnly) need(UUID.test(correctionId ?? ''), 'BROWSER_CORRECTION_REQUIRED');
  const target = endpoint(listener), out = resolve(outputDirectory);
  await privateDirectory(out);
  const selection = { schema: SCHEMA, operation: OPERATION, catalog, author,
    mode: inspectOnly ? 'received-inspection' : 'correction-course', correctionId,
    baselineDocumentPath: inspectOnly ? null : resolve(baselineDocumentPath) };
  await save(join(out, 'selection.json'), selection, true);
  let baseline, first;
  if (!inspectOnly) {
    baseline = await readPrivate(baselineDocumentPath);
    need(baseline.length === catalog.bytes && sha(baseline) === catalog.sha256, 'BROWSER_ORIGINAL_CATALOG_CHANGED');
    const parsed = JSON.parse(baseline.toString('utf8').replace(/^\uFEFF/, ''));
    need(Array.isArray(parsed.dataset) && parsed.dataset.length === 344 &&
      typeof parsed.dataset[0]?.title === 'string' && parsed.dataset[0]?.identifier === 'GSA-2015-02-26-1' &&
      parsed.dataset[0]?.dataQuality === true && Array.isArray(parsed.dataset[0]?.distribution),
      'BROWSER_COMPLETE_ORIGINAL_GSA_REQUIRED');
    first = { identifier: parsed.dataset[0].identifier, title: parsed.dataset[0].title };
  }
  const journalPath = join(out, 'progress.json'), retained = await maybe(journalPath);
  const journal = retained ? JSON.parse(retained) : { schema: SCHEMA, operation: OPERATION, phases: {} };
  need(journal.schema === SCHEMA && journal.operation === OPERATION && journal.phases, 'BROWSER_JOURNAL_CHANGED');
  let journalWrites = Promise.resolve();
  const persist = () => { const snapshot = structuredClone(journal); return journalWrites = journalWrites.then(() => save(journalPath, snapshot)); };
  await persist();
  const result = { schema: SCHEMA, operation: OPERATION, startedAt: new Date().toISOString(),
    complete: false, mode: selection.mode, catalog, correctionId, downloads: [], screenshots: [],
    observations: [], pageErrors: [], errors: [], cleanup: [] };
  let browser, context, page, closingBrowser, phaseName = null, responseWrites = Promise.resolve(), responseFailure = null;
  const headers = { authorization: 'Bearer ' + target.token };
  const cancelled = () => signal?.throwIfAborted();
  async function api(path, body) {
    cancelled();
    const response = body === undefined
      ? await page.request.get(target.origin + '/api/' + path, { headers, timeout: timeoutMs })
      : await page.request.post(target.origin + '/api/' + path,
        { headers: { ...headers, 'content-type': 'application/json' }, data: JSON.stringify(body), timeout: timeoutMs });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { throw Object.assign(new Error('The original listener returned invalid JSON.'), { code: 'BROWSER_LISTENER_JSON' }); }
    need(response.ok(), 'BROWSER_LISTENER_' + response.status(), value.message ?? value.error ?? text.slice(0, 1000));
    return value;
  }
  const state = () => api('status');
  const panel = name => page.getByRole('heading', { name, exact: true }).locator('..');
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  async function renderAction(action) {
    const marker = randomUUID();
    await page.locator('.dcat-corrections').evaluateAll((nodes, value) => {
      for (const node of nodes) node.dataset.coursePreviousRender = value;
    }, marker);
    await action();
    await page.waitForFunction(value => {
      const current = document.querySelector('.dcat-corrections');
      return current && current.dataset.coursePreviousRender !== value;
    }, marker, { timeout: timeoutMs });
    if (responseFailure) throw responseFailure;
  }
  async function refresh() {
    await renderAction(() => button(page, 'Refresh workspace').click());
  }
  async function selectDraft(id, revisionId) {
    await refresh();
    await renderAction(() => page.getByLabel('Saved correction draft', { exact: true }).selectOption(id));
    await page.getByLabel('Revision', { exact: true }).waitFor();
    if (revisionId) await renderAction(() => page.getByLabel('Revision', { exact: true }).selectOption(revisionId));
    await page.getByLabel('JSON pointer', { exact: true }).waitFor();
  }
  async function screenshot(name) {
    cancelled();
    const path = join(out, 'screenshots', name + '.png');
    await privateDirectory(dirname(path));
    const raw = await page.screenshot({ fullPage: true });
    await save(path, raw);
    result.screenshots.push({ name, file: path, bytes: raw.length, sha256: sha(raw),
      viewport: page.viewportSize(), viewedByOperator: false });
  }
  async function download(name, control, expected = null) {
    cancelled();
    const waiting = page.waitForEvent('download', { timeout: timeoutMs });
    await control.click();
    const value = await waiting, failure = await value.failure();
    need(!failure, 'BROWSER_DOWNLOAD_FAILED', failure ?? '');
    const stream = await value.createReadStream();
    need(stream, 'BROWSER_DOWNLOAD_STREAM_MISSING');
    const chunks = []; let length = 0;
    for await (const chunk of stream) { length += chunk.length; need(length <= 268435456, 'BROWSER_DOWNLOAD_LIMIT'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks), identity = { bytes: raw.length, sha256: sha(raw) };
    if (expected) need(identity.bytes === expected.bytes && identity.sha256 === expected.sha256, 'BROWSER_DOWNLOAD_IDENTITY_CHANGED', name);
    const file = join(out, 'downloads', name);
    await save(file, raw, true);
    const receipt = { name, suggestedFilename: value.suggestedFilename(), file, ...identity };
    result.downloads.push(receipt); await value.delete(); return { receipt, raw };
  }
  function observedResult(action, body, current) {
    const drafts = current.dcat?.corrections?.drafts ?? [];
    const draft = drafts.find(item => item.id === (action === 'create' ? body.requestId : body.correctionId));
    if (action === 'create') return draft ?? null;
    if (action === 'materialize') return draft?.materializations.find(item => item.requestId === body.requestId) ?? null;
    return draft?.revisions.find(item => item.id === body.requestId) ?? null;
  }
  async function settle(entry) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (entry.rejection) throw Object.assign(new Error(entry.rejection.message ?? entry.rejection.error), { code: 'BROWSER_ORIGINAL_REQUEST_REJECTED' });
      const current = await state(), actual = observedResult(entry.action, entry.request, current);
      if (actual && !current.active) {
        entry.result = actual; entry.complete = true; await persist(); return actual;
      }
      const operationId = entry.response?.operationId ?? entry.response?.id;
      if (!current.active && current.operation?.id === operationId &&
          ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(current.operation.state)) {
        entry.failure = current.operation; await persist();
        throw Object.assign(new Error(current.operation.error?.message ?? current.operation.state),
          { code: 'BROWSER_ORIGINAL_OPERATION_FAILED' });
      }
      await delay(200, signal);
    }
    throw Object.assign(new Error('The exact original request remains retained in progress.json.'), { code: 'BROWSER_ORIGINAL_OPERATION_PENDING' });
  }
  async function mutate(name, action, interact) {
    let entry = journal.phases[name];
    if (!entry) {
      phaseName = name;
      try { await interact(); } finally { phaseName = null; }
      await responseWrites;
      if (responseFailure) throw responseFailure;
      entry = journal.phases[name];
      need(entry?.action === action && UUID.test(entry.request?.requestId ?? ''), 'BROWSER_MUTATION_INTENT_MISSING', name);
    } else {
      need(entry.action === action && entry.requestSha256 === sha(json(entry.request)), 'BROWSER_MUTATION_INTENT_CHANGED', name);
      const current = await state(), actual = observedResult(action, entry.request, current);
      if (actual && !current.active) { entry.result = actual; entry.complete = true; await persist(); return actual; }
      if (!current.active) {
        entry.response = await api('dcat/corrections/' + action, entry.request); await persist();
      }
    }
    return await settle(entry);
  }

  async function openPointer(pointer) {
    const field = page.getByLabel('JSON pointer', { exact: true });
    await field.fill(pointer);
    await renderAction(() => button(panel('Browse the complete saved revision'), 'Open pointer').click());
    await field.waitFor();
    need(await field.inputValue() === pointer, 'BROWSER_POINTER_CHANGED');
  }
  async function inspectEveryRevision(id) {
    let current = await state();
    const draft = current.dcat?.corrections?.drafts?.find(item => item.id === id);
    need(draft && draft.revisions.length >= 3 && draft.materializations.length, 'BROWSER_COMPLETE_CORRECTION_REQUIRED');
    for (const revision of draft.revisions) {
      await selectDraft(id, revision.id);
      const browser = panel('Browse the complete saved revision');
      const document = await download('document-' + revision.id + '.json',
        button(browser, 'Download complete document'), { sha256: revision.documentSha256, bytes: revision.documentBytes });
      const record = await download('revision-' + revision.id + '.json',
        button(browser, 'Download complete revision and changes'), { sha256: revision.sha256, bytes: revision.bytes });
      const value = JSON.parse(record.raw);
      need(value.id === revision.id && value.documentSha256 === revision.documentSha256 &&
        value.documentBytes === revision.documentBytes && Array.isArray(value.operations) && Array.isArray(value.changes),
        'BROWSER_DOWNLOADED_REVISION_CHANGED');
      need(document.raw.length > 0, 'BROWSER_EMPTY_DOCUMENT');
      result.observations.push({ kind: 'complete-revision-downloads', revisionId: revision.id,
        documentSha256: revision.documentSha256, revisionSha256: revision.sha256,
        operationCount: value.operations.length, changeCount: value.changes.length });
    }
    await selectDraft(id, draft.headRevisionId);
    await openPointer('/dataset');
    const browser = panel('Browse the complete saved revision');
    need((await browser.textContent()).includes('344 immediate children'), 'BROWSER_GSA_RECORD_COUNT_CHANGED');
    await renderAction(() => button(browser, 'Next rows').click());
    await renderAction(() => button(panel('Browse the complete saved revision'), 'Previous rows').click());
    const identifier = first?.identifier ?? 'GSA-2015-02-26-1';
    await page.getByLabel('Find within selected children', { exact: true }).fill(identifier);
    await renderAction(() => button(panel('Browse the complete saved revision'), 'Find').click());
    const matches = await panel('Browse the complete saved revision').locator('tbody tr').count();
    need(matches > 0 && matches < 344, 'BROWSER_RECORD_SEARCH_CHANGED');
    await openPointer('/dataset/0/title');
    await panel('Browse the complete saved revision').getByText('Complete selected JSON value', { exact: true }).click();
    await screenshot('desktop-complete-title');
    await openPointer('/dataset/0/dataQuality');
    need((await panel('Browse the complete saved revision').textContent()).includes('Selected type: boolean'),
      'BROWSER_TYPED_BOOLEAN_MISSING');
    await openPointer('/dataset/0/distribution');
    await screenshot('desktop-distribution-and-history');
    for (const width of [1365, 390]) {
      await page.setViewportSize({ width, height: 920 });
      await openPointer('/dataset/0/title');
      await screenshot('complete-workbench-' + width);
      const layout = await page.evaluate(() => ({ viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth }));
      result.observations.push({ kind: 'layout', ...layout });
      need(layout.documentWidth <= layout.viewport + 2 && layout.bodyWidth <= layout.viewport + 2,
        'BROWSER_HORIZONTAL_PAGE_OVERFLOW', JSON.stringify(layout));
    }
    await page.setViewportSize({ width: 1365, height: 920 });
    current = await state();
    result.revisions = current.dcat.corrections.drafts.find(item => item.id === id).revisions;
  }
  async function queue(operation) {
    const composer = panel('Compose a typed change set');
    await composer.getByLabel('Edit', { exact: true }).selectOption(operation.op);
    await composer.getByLabel('Destination JSON pointer', { exact: true }).fill(operation.path);
    if (operation.from !== undefined)
      await composer.getByLabel('Source JSON pointer for move', { exact: true }).fill(operation.from);
    if (operation.valueText !== undefined)
      await composer.getByLabel('Complete JSON literal for add or replace', { exact: true }).fill(operation.valueText);
    await renderAction(() => button(composer, 'Add to change set').click());
  }
  async function closeBrowser() {
    if (closingBrowser) return await closingBrowser;
    if (!browser) return;
    const owned = browser; browser = null;
    closingBrowser = owned.close().then(() => {
      result.cleanup.push({ owner: 'browser', closed: true, at: new Date().toISOString() });
    });
    return await closingBrowser;
  }
  const onAbort = () => { closeBrowser().catch(error => { result.errors.push(errorValue(error)); }); };
  try {
    cancelled();
    browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    signal?.addEventListener('abort', onAbort, { once: true });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1365, height: 920 } });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', error => result.pageErrors.push(errorValue(error)));
    await page.route('**/api/dcat/corrections/*', async route => {
      const request = route.request(), action = new URL(request.url()).pathname.split('/').at(-1);
      if (request.method() !== 'POST' || !['create', 'save', 'restore', 'materialize'].includes(action)) {
        await route.continue(); return;
      }
      try {
        need(phaseName, 'BROWSER_MUTATION_OUTSIDE_COURSE');
        const requestValue = request.postDataJSON(), requestSha256 = sha(json(requestValue));
        need(UUID.test(requestValue?.requestId ?? ''), 'BROWSER_STABLE_REQUEST_REQUIRED');
        const previous = journal.phases[phaseName];
        need(!previous || previous.requestSha256 === requestSha256, 'BROWSER_PHASE_REQUEST_CHANGED');
        journal.phases[phaseName] = previous ?? { action, request: requestValue, requestSha256,
          preparedAt: new Date().toISOString(), complete: false };
        await persist(); // The real request cannot leave the browser before its full intent is retained.
        await route.continue();
      } catch (error) { responseFailure = error; await route.abort('failed'); }
    });
    page.on('response', response => {
      const request = response.request(), url = new URL(response.url());
      if (url.origin !== target.origin || request.method() !== 'POST' ||
          !/^\/api\/dcat\/corrections\/(create|save|restore|materialize)$/.test(url.pathname)) return;
      responseWrites = responseWrites.then(async () => {
        const body = request.postDataJSON();
        const entry = Object.values(journal.phases).find(item => item.request?.requestId === body.requestId);
        need(entry, 'BROWSER_RESPONSE_WITHOUT_RETAINED_REQUEST');
        entry.response = await response.json(); entry.httpStatus = response.status();
        if (!response.ok()) entry.rejection = entry.response;
        await persist();
      }).catch(error => { responseFailure = error; });
    });
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.getByRole('heading', { name: 'Catalogue corrections', exact: true }).waitFor();
    await download('CORRECTION_WORKBENCH.md', button(page, 'Download correction operating guide'));
    if (inspectOnly) {
      await inspectEveryRevision(correctionId);
      const current = await state(), draft = current.dcat.corrections.drafts.find(item => item.id === correctionId);
      result.correctionId = correctionId; result.materialization = draft.materializations.at(-1);
    } else {
      const draft = await mutate('create', 'create', async () => {
        const start = panel('Start a saved correction draft');
        await renderAction(() => start.getByLabel('Exact retained source', { exact: true }).selectOption('catalog:' + catalog.id));
        await start.getByLabel('Draft label', { exact: true }).fill('GSA complete catalogue · correction workbench exercise');
        await start.getByLabel('Editor', { exact: true }).fill(author);
        await start.getByLabel('Reason for this saved revision', { exact: true }).fill(
          'Separate complete GSA catalogue draft for exercising the correction interface. Restore original bytes before materialization.');
        await button(start, 'Create correction draft').click();
      });
      result.correctionId = draft.id;
      result.initialRevisionId = draft.revisions[0]?.id;
      need(UUID.test(result.initialRevisionId ?? '') && draft.revisions[0].documentSha256 === catalog.sha256,
        'BROWSER_INITIAL_SOURCE_REVISION_CHANGED');
      await selectDraft(draft.id, (await state()).dcat.corrections.drafts.find(row => row.id === draft.id).headRevisionId);
      const edited = await mutate('save', 'save', async () => {
        await openPointer('/dataset/0/title');
        const operations = [
          { op: 'replace', path: '/dataset/0/title', valueText: JSON.stringify(first.title + ' · correction interface exercise') },
          { op: 'replace', path: '/dataset/0/dataQuality', valueText: 'false' },
          { op: 'add', path: '/_correctionExercise', valueText:
            '{"purpose":"Separate interface exercise; restore the original before materialization","exactInteger":900719925474099312345,"exactDecimal":1.2300000000000000001}' },
          { op: 'move', from: '/dataset/0', path: '/dataset/1' },
        ];
        for (const item of operations) await queue(item);
        let rows = panel('Compose a typed change set').locator('tbody tr');
        await renderAction(() => button(rows.nth(3), 'Up').click());
        rows = panel('Compose a typed change set').locator('tbody tr');
        await renderAction(() => button(rows.nth(2), 'Down').click());
        await queue({ op: 'add', path: '/_removedBeforeSaving', valueText: 'null' });
        await renderAction(() => button(panel('Compose a typed change set').locator('tbody tr').nth(4), 'Remove edit').click());
        const changed = await download('ordered-change-set.json', button(panel('Compose a typed change set'), 'Download change set'));
        const changeSet = JSON.parse(changed.raw);
        const selectedOperations = values => values.map(item => [item.op, item.path, item.from ?? null, item.valueText ?? null]);
        need(JSON.stringify(selectedOperations(changeSet.operations)) === JSON.stringify(selectedOperations(operations)), 'BROWSER_CHANGE_ORDER_CHANGED');
        await renderAction(() => button(panel('Compose a typed change set'), 'Preview all changes').click());
        const preview = panel('Complete change preview');
        await preview.getByLabel('Editor for this saved revision', { exact: true }).fill(author);
        await preview.getByLabel('Reason for this saved revision', { exact: true }).fill(
          'Exercise four exact typed operations on the complete retained catalogue in this separately labelled draft.');
        const changes = preview.locator('details');
        need(await changes.count() === 4, 'BROWSER_COMPLETE_PREVIEW_MISSING');
        for (let i = 0; i < 4; i++) await changes.nth(i).locator('summary').click();
        await screenshot('complete-ordered-change-preview');
        await button(preview, 'Save attributed revision').click();
      });
      result.editedRevisionId = edited.id;
      const restored = await mutate('restore', 'restore', async () => {
        await selectDraft(draft.id, result.initialRevisionId);
        const restoration = panel('Revision history and restoration');
        await restoration.getByLabel('Restoring editor', { exact: true }).fill(author);
        await restoration.getByLabel('Restoration reason', { exact: true }).fill(
          'Restore the complete original GSA catalogue byte for byte after the separately retained interface exercise.');
        await button(restoration, 'Restore this earlier version as a new revision').click();
      });
      result.restoredRevisionId = restored.id;
      need(restored.documentSha256 === catalog.sha256 && restored.documentBytes === catalog.bytes,
        'BROWSER_RESTORATION_CHANGED_ORIGINAL');
      const materialization = await mutate('materialize', 'materialize', async () => {
        await selectDraft(draft.id, restored.id);
        const preparation = panel('Retain a candidate for the existing review');
        await preparation.getByLabel('Retained document label', { exact: true }).fill('GSA original restored from correction history');
        await preparation.getByLabel('Document profile', { exact: true }).selectOption('3.0');
        await preparation.getByLabel('Use in migration review', { exact: true }).selectOption('candidate');
        await preparation.getByLabel('Preparing editor', { exact: true }).fill(author);
        await preparation.getByLabel('Candidate preparation reason', { exact: true }).fill(
          'Retain the exact restored original as a separate candidate through the original review controls.');
        await button(preparation, 'Retain selected revision for review').click();
      });
      result.materialization = materialization;
      need(materialization.sha256 === catalog.sha256 && materialization.bytes === catalog.bytes &&
        materialization.revisionId === restored.id && materialization.correctionId === draft.id,
        'BROWSER_MATERIALIZED_DOCUMENT_CHANGED');
      await selectDraft(draft.id, restored.id);
      const retained = panel('Retain a candidate for the existing review');
      await retained.getByLabel('Use in migration review', { exact: true }).selectOption('candidate');
      await renderAction(() => button(retained, 'Use in migration review').last().click());
      const review = panel('Prepare a complete migration review');
      need(await review.getByLabel('Original source', { exact: true }).inputValue() === catalog.id &&
        await review.getByLabel('Candidate source', { exact: true }).inputValue() === materialization.catalogId &&
        await review.getByLabel('Preceding catalogue edition', { exact: true }).inputValue() === '' &&
        !(await review.getByLabel('Normalize a flat DCAT-US 3.0 catalogue', { exact: true }).isChecked()),
        'BROWSER_MIGRATION_SELECTION_CHANGED');
      result.observations.push({ kind: 'original-migration-controls', sourceId: catalog.id,
        candidateId: materialization.catalogId, comparisonId: '', normalizeV3: false });
      await screenshot('materialized-candidate-original-review-controls');
      await inspectEveryRevision(draft.id);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Catalogue corrections', exact: true }).waitFor();
      await selectDraft(draft.id, restored.id);
      await screenshot('browser-reload-retained-history');
    }
    await responseWrites;
    if (responseFailure) throw responseFailure;
    need(result.pageErrors.length === 0, 'BROWSER_PAGE_ERRORS', JSON.stringify(result.pageErrors));
    result.complete = true;
  } catch (error) { result.errors.push(errorValue(error)); }
  finally {
    signal?.removeEventListener('abort', onAbort);
    try { await closeBrowser(); }
    catch (error) { result.complete = false; result.errors.push(errorValue(error)); result.cleanup.push({ owner: 'browser', closed: false }); }
    await responseWrites;
    if (responseFailure) { result.complete = false; result.errors.push(errorValue(responseFailure)); }
    result.finishedAt = new Date().toISOString();
    await save(join(out, 'result.json'), result);
  }
  need(result.complete, 'BROWSER_COURSE_INCOMPLETE', 'Read the complete retained result.json and original request journal.');
  return result;
}
export async function inspectDcatCorrectionBrowser(options = {}) {
  return await runDcatCorrectionBrowser({ ...options, inspectOnly: true });
}
