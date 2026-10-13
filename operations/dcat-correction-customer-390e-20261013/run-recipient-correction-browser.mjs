// MIT. Actual standalone recipient and author reconciliation in the original correction customer course.
import { readFile, mkdir, open, lstat, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const SCHEMA = 'commons.dcat-recipient-correction-browser.v1';
const OPERATION = 'SCF-DCAT-RECIPIENT-CORRECTIONS-390E-20261013';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const same = (a, b) => json(a).equals(json(b));
const errorValue = error => ({ code: error?.code ?? error?.name ?? 'RECIPIENT_COURSE_FAILED',
  message: String(error?.message ?? error).replace(/https?:\/\/127\.0\.0\.1:\d+\/?#[^\s"']+/g, '[private listener]').slice(0, 3000) });
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const value = await lstat(path);
  need(value.isDirectory() && !value.isSymbolicLink() && !(value.mode & 0o077), 'RECIPIENT_PRIVATE_DIRECTORY_REQUIRED');
}
async function read(path) {
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await h.stat(); need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && before.size <= 268435456,
      'RECIPIENT_PRIVATE_FILE_REQUIRED');
    const raw = await h.readFile(), after = await h.stat();
    need(raw.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'RECIPIENT_FILE_CHANGED'); return raw;
  } finally { await h.close(); }
}
async function maybe(path) { try { return await read(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function save(path, value, exact = false) {
  await directory(dirname(path));
  const raw = Buffer.isBuffer(value) ? value : json(value), before = await maybe(path);
  if (exact && before) { need(before.equals(raw), 'RECIPIENT_OWNED_OUTPUT_CHANGED'); return; }
  const pending = path + '.pending-' + randomUUID(), h = await open(pending, 'wx', 0o600);
  try { await h.writeFile(raw); await h.sync(); } finally { await h.close(); }
  try { await rename(pending, path); } catch (error) { await unlink(pending).catch(() => {}); throw error; }
  const parent = await open(dirname(path), 'r'); try { await parent.sync(); } finally { await parent.close(); }
}
async function delay(ms, signal) {
  signal?.throwIfAborted();
  await new Promise((done, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? Error('Interrupted')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); done(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function endpoint(listener) {
  const value = new URL(listener.url);
  need(value.origin === new URL(listener.origin).origin && value.protocol === 'http:' && value.hostname === '127.0.0.1' &&
    value.pathname === '/' && !value.search && !value.username && !value.password && value.hash.length >= 33, 'RECIPIENT_ORIGINAL_LISTENER_REQUIRED');
  return { url: value.href, origin: value.origin, token: value.hash.slice(1) };
}
/** Reuses the actual listener. Keeps author authentication in an ephemeral context; only offline recipient storage persists. */
export async function runDcatRecipientCorrectionBrowser({
  playwright, listener, outputDirectory, catalog, baselineDocumentPath, author, exchangeCodec,
  signal, timeoutMs = 120000, executablePath, inspectOnly = false, selection: inspectedSelection,
} = {}) {
  need(playwright?.chromium && exchangeCodec?.validateCorrectionProposal && isAbsolute(outputDirectory ?? '') &&
    typeof author === 'string' && author.trim() === author && author.length <= 160 && author.length > 0,
    'RECIPIENT_BROWSER_OPTIONS');
  need(UUID.test(catalog?.id ?? '') && HASH.test(catalog?.sha256 ?? '') && Number.isSafeInteger(catalog?.bytes), 'RECIPIENT_CATALOG_SELECTION');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'RECIPIENT_TIMEOUT_INVALID');
  const out = resolve(outputDirectory), target = endpoint(listener);
  await directory(out);
  const selected = { schema: SCHEMA, operation: OPERATION, catalog, author,
    mode: inspectOnly ? 'received-inspection' : 'recipient-course',
    selection: inspectOnly ? inspectedSelection : null };
  if (inspectOnly) need(UUID.test(inspectedSelection?.correctionId ?? '') && UUID.test(inspectedSelection?.exchangeId ?? '') &&
    UUID.test(inspectedSelection?.proposalId ?? '') && UUID.test(inspectedSelection?.decisionId ?? ''), 'RECIPIENT_INSPECTION_SELECTION');
  await save(join(out, 'selection.json'), selected, true);
  const rawProgress = await maybe(join(out, 'progress.json'));
  const journal = rawProgress ? JSON.parse(rawProgress) : { schema: SCHEMA, operation: OPERATION, phases: {} };
  need(journal.schema === SCHEMA && journal.operation === OPERATION, 'RECIPIENT_PROGRESS_CHANGED');
  let writes = Promise.resolve(), responses = Promise.resolve(), responseFailure = null, phaseName = null;
  const persist = () => { const snapshot = structuredClone(journal); return writes = writes.then(() => save(join(out, 'progress.json'), snapshot)); };
  await persist();
  const result = { schema: SCHEMA, operation: OPERATION, mode: selected.mode, catalog, startedAt: new Date().toISOString(),
    complete: false, correctionId: null, exchangeId: null, proposalId: null, editionId: null, decisionId: null,
    authorRevisionId: null, adoptedRevisionId: null, downloads: [], screenshots: [], observations: [],
    pageErrors: [], errors: [], cleanup: [], requests: {} };
  let context, persistentContext, page, offline, closing;
  const headers = { authorization: 'Bearer ' + target.token };
  const panel = (p, name) => p.getByRole('heading', { name, exact: true }).locator('..');
  const button = (p, name) => p.getByRole('button', { name, exact: true });
  async function api(path, body, raw) {
    signal?.throwIfAborted();
    const response = body === undefined ? await context.request.get(target.origin + '/api/' + path, { headers, timeout: timeoutMs }) :
      await context.request.post(target.origin + '/api/' + path, { timeout: timeoutMs,
        headers: { ...headers, 'content-type': raw ? 'application/octet-stream' : 'application/json',
          ...(raw ? { 'x-dcat-sha256': body.expectedSha256 } : {}) },
        data: raw ?? JSON.stringify(body) });
    const value = await response.json();
    need(response.ok(), 'RECIPIENT_HTTP_' + response.status()); return value;
  }
  const state = () => api('status');
  async function rendered(p, root, action) {
    const marker = randomUUID();
    await p.locator(root).evaluateAll((nodes, value) => { for (const n of nodes) n.dataset.courseOld = value; }, marker);
    await action();
    await p.waitForFunction(({ root, marker }) => {
      const node = document.querySelector(root);
      if (root === '#recipient-app') return node && node.firstElementChild && node.firstElementChild.dataset.courseOld !== marker && !node.inert;
      return node && node.dataset.courseOld !== marker;
    }, { root, marker }, { timeout: timeoutMs });
    if (responseFailure) throw responseFailure;
    if (p === offline) need(!(await p.locator('#recipient-notice .error').count()), 'RECIPIENT_OFFLINE_ACTION_FAILED');
  }
  async function offlineAction(action) {
    const marker = randomUUID();
    await offline.locator('#recipient-app > *').evaluateAll((nodes, value) => { for (const n of nodes) n.dataset.courseOld = value; }, marker);
    await action();
    await offline.waitForFunction(value => {
      const app = document.querySelector('#recipient-app');
      return app?.firstElementChild && app.firstElementChild.dataset.courseOld !== value && !app.inert;
    }, marker, { timeout: timeoutMs });
    need(!(await offline.locator('#recipient-notice .error').count()), 'RECIPIENT_OFFLINE_ACTION_FAILED');
  }
  async function refresh() { await rendered(page, '.dcat-corrections', () => button(page, 'Refresh workspace').click()); }
  async function selectDraft(id, revision) {
    await refresh();
    await rendered(page, '.dcat-corrections', () => page.getByLabel('Saved correction draft', { exact: true }).selectOption(id));
    if (revision) await rendered(page, '.dcat-corrections', () => page.getByLabel('Revision', { exact: true }).selectOption(revision));
    await page.getByRole('heading', { name: 'Recipient catalogue corrections', exact: true }).waitFor();
  }
  async function download(p, name, control, expected) {
    signal?.throwIfAborted();
    const wait = p.waitForEvent('download', { timeout: timeoutMs });
    if (typeof control === 'function') await control(); else await control.click();
    const item = await wait; need(!(await item.failure()), 'RECIPIENT_DOWNLOAD_FAILED');
    const stream = await item.createReadStream(); need(stream, 'RECIPIENT_DOWNLOAD_MISSING');
    const chunks = []; let bytes = 0;
    for await (const chunk of stream) { bytes += chunk.length; need(bytes <= 268435456, 'RECIPIENT_DOWNLOAD_TOO_LARGE'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks), digest = sha(raw);
    if (expected) need(digest === expected.sha256 && bytes === expected.bytes, 'RECIPIENT_DOWNLOAD_CHANGED');
    const file = join(out, 'downloads', digest.slice(0, 20) + '-' + name);
    await save(file, raw, true); await item.delete();
    const receipt = { name, file, sha256: digest, bytes, suggestedFilename: item.suggestedFilename() };
    result.downloads.push(receipt); return { raw, receipt };
  }
  async function screenshot(p, name) {
    const raw = await p.screenshot({ fullPage: true }), file = join(out, 'screenshots', name + '.png');
    await save(file, raw);
    result.screenshots.push({ name, file, bytes: raw.length, sha256: sha(raw), viewport: p.viewportSize(), viewedByOperator: false });
  }
  async function layouts(p, name) {
    for (const width of [1365, 390]) {
      await p.setViewportSize({ width, height: 920 });
      await screenshot(p, name + '-' + width);
      const actual = await p.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
      result.observations.push({ kind: 'layout', surface: name, ...actual });
      need(actual.documentWidth <= actual.viewport + 2 && actual.bodyWidth <= actual.viewport + 2, 'RECIPIENT_HORIZONTAL_PAGE_OVERFLOW');
    }
    await p.setViewportSize({ width: 1365, height: 920 });
  }
  function outcome(entry, current) {
    const correction = current.dcat.corrections, request = entry.request;
    if (entry.scope === 'corrections') {
      const draft = correction.drafts.find(x => x.id === (entry.action === 'create' ? request.requestId : request.correctionId));
      return entry.action === 'create' ? draft : draft?.revisions.find(x => x.id === request.requestId);
    }
    const rows = entry.action === 'issue' ? correction.exchanges.issues : entry.action === 'receive' ? correction.exchanges.proposals : correction.exchanges.decisions;
    // An adoption revision without its decision is partial, not a completed apply.
    return rows.find(x => x.id === request.requestId);
  }
  async function settle(entry) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const current = await state(), value = outcome(entry, current);
      if (value && !current.active) { entry.result = value; entry.complete = true; await persist(); return value; }
      if (entry.rejection) throw Object.assign(Error('Original request rejected'), { code: 'RECIPIENT_REQUEST_REJECTED' });
      const operationId = entry.response?.operationId ?? entry.response?.id;
      if (!current.active && current.operation?.id === operationId && ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(current.operation.state)) {
        entry.failure = current.operation; await persist(); need(false, 'RECIPIENT_ORIGINAL_OPERATION_INCOMPLETE');
      }
      await delay(200, signal);
    }
    need(false, 'RECIPIENT_ORIGINAL_OPERATION_PENDING');
  }
  async function mutate(name, scope, action, interact) {
    let entry = journal.phases[name];
    if (entry) {
      need(entry.scope === scope && entry.action === action && entry.requestSha256 === sha(json(entry.request)), 'RECIPIENT_INTENT_CHANGED');
      const current = await state(), value = outcome(entry, current);
      if (value && !current.active) { entry.result = value; entry.complete = true; await persist(); return value; }
      if (!current.active) {
        let raw;
        if (action === 'receive') {
          raw = await read(entry.file.file);
          need(raw.length === entry.file.bytes && sha(raw) === entry.request.expectedSha256, 'RECIPIENT_REPLAY_FILE_CHANGED');
        }
        entry.rejection = null;
        entry.response = await api('dcat/' + scope + '/' + action +
          (action === 'receive' ? '?requestId=' + entry.request.requestId : ''), entry.request, raw);
        await persist();
      }
    } else {
      phaseName = name;
      try { await interact(); } finally { phaseName = null; }
      await responses; if (responseFailure) throw responseFailure;
      entry = journal.phases[name];
      need(entry && entry.scope === scope && entry.action === action, 'RECIPIENT_MUTATION_INTENT_MISSING');
    }
    return await settle(entry);
  }
  async function queueAuthor(operation) {
    const composer = panel(page, 'Compose a typed change set');
    await composer.getByLabel('Edit', { exact: true }).selectOption(operation.op);
    await composer.getByLabel('Destination JSON pointer', { exact: true }).fill(operation.path);
    await composer.getByLabel('Complete JSON literal for add or replace', { exact: true }).fill(operation.valueText);
    await rendered(page, '.dcat-corrections', () => button(composer, 'Add to change set').click());
  }
  async function proposalSnapshot(name) {
    const got = await download(offline, name + '.json', button(offline, 'Download complete return JSON'));
    const value = exchangeCodec.readCorrectionProposalFile(got.raw), checked = await exchangeCodec.validateCorrectionProposal(value);
    need(value.issue.id === result.exchangeId && value.issue.baseline.documentSha256 === catalog.sha256, 'RECIPIENT_PROPOSAL_BINDING_CHANGED');
    journal.workingProposal = got.receipt; await persist();
    const working = await download(offline, name + '-working.html', button(offline, 'Download complete working HTML'));
    const workingValue = exchangeCodec.readCorrectionProposalFile(working.raw);
    await exchangeCodec.validateCorrectionProposal(workingValue);
    need(same(workingValue, value), 'RECIPIENT_WORKING_HTML_CHANGED');
    journal.workingFile = working.receipt; await persist();
    return { ...got, value, checked };
  }
  async function queueRecipient(operation) {
    const composer = panel(offline, 'Compose exact typed changes');
    await composer.getByLabel('Operation', { exact: true }).selectOption(operation.op);
    await offline.waitForFunction(() => !document.querySelector('#recipient-app').inert);
    await composer.getByLabel('Destination JSON pointer', { exact: true }).fill(operation.path);
    await composer.getByLabel('Complete JSON literal for add or replace', { exact: true }).fill(operation.valueText);
    await offlineAction(() => button(composer, 'Add to change set').click());
  }
  async function inspectExchange(selectedIds, scope) {
    const current = await state(), draft = current.dcat.corrections.drafts.find(x => x.id === selectedIds.correctionId);
    need(draft, 'RECIPIENT_DRAFT_MISSING');
    await selectDraft(draft.id, draft.headRevisionId);
    await rendered(page, '.dcat-corrections', () => page.getByLabel('Saved recipient issue', { exact: true }).selectOption(selectedIds.exchangeId));
    const issue = await api('dcat/exchanges/issues/' + selectedIds.exchangeId);
    for (const [kind, name, label] of [
      ['recipient', 'recipient.html', 'Download complete recipient working HTML'],
      ['initial-proposal', 'initial-proposal.json', 'Download complete initial proposal JSON'],
      ['issue', 'issue.json', 'Download complete issued source package']]) {
      const got = await download(page, scope + '-' + name, button(page, label));
      if (kind === 'initial-proposal') {
        const decoded = exchangeCodec.readCorrectionProposalFile(got.raw); await exchangeCodec.validateCorrectionProposal(decoded);
        need(decoded.issue.id === issue.id, 'RECIPIENT_ISSUE_DOWNLOAD_CHANGED');
      }
    }
    const files = panel(page, 'Complete issued catalogue and files').locator('tbody tr');
    need(await files.count() === issue.files.length, 'RECIPIENT_ORIGINAL_FILE_ROWS_MISSING');
    for (let i = 0; i < issue.files.length; i++) {
      const file = issue.files[i];
      await download(page, scope + '-original-' + i + '.bin', button(files.nth(i), 'Download original file'), file);
    }
    await rendered(page, '.dcat-corrections', () => page.getByLabel('Received proposal', { exact: true }).selectOption(selectedIds.proposalId));
    const proposal = await api('dcat/exchanges/proposals/' + selectedIds.proposalId);
    await download(page, scope + '-exact-return.html', button(page, 'Download complete original returned file'), proposal);
    const decisions = panel(page, 'Saved author adoption history').locator('tbody tr');
    const decision = current.dcat.corrections.exchanges.decisions.find(x => x.id === selectedIds.decisionId);
    need(decision && decision.proposalId === proposal.id, 'RECIPIENT_ADOPTION_DECISION_MISSING');
    const selectedRow = decisions.filter({ hasText: decision.revisionId });
    await download(page, scope + '-adoption.json', button(selectedRow, 'Download full adoption decision'));
    for (const revision of draft.revisions) {
      await selectDraft(draft.id, revision.id);
      const area = panel(page, 'Browse the complete saved revision');
      await download(page, scope + '-document-' + revision.id + '.json', button(area, 'Download complete document'),
        { sha256: revision.documentSha256, bytes: revision.documentBytes });
      await download(page, scope + '-revision-' + revision.id + '.json', button(area, 'Download complete revision and changes'),
        { sha256: revision.sha256, bytes: revision.bytes });
    }
    await selectDraft(draft.id, draft.headRevisionId);
    await layouts(page, scope + '-author-history');
    return { draft, issue, proposal, decision };
  }
  async function close() {
    if (closing) return await closing;
    if (!context && !persistentContext) return;
    const authorContext = context, recipientContext = persistentContext; context = null; persistentContext = null;
    closing = (async () => {
      let failure;
      for (const [owner, owned] of [['author-context', authorContext], ['offline-context', recipientContext]]) {
        if (!owned) continue;
        try { await owned.close(); result.cleanup.push({ owner, closed: true }); }
        catch (error) { result.cleanup.push({ owner, closed: false, error: errorValue(error) }); failure ??= error; }
      }
      if (failure) throw failure;
      result.cleanup.push({ owner: 'browser-context', closed: true });
    })();
    return await closing;
  }
  const onAbort = () => { close().catch(error => result.errors.push(errorValue(error))); };
  try {
    signal?.throwIfAborted();
    await directory(join(out, 'browser-profile'));
    persistentContext = await playwright.chromium.launchPersistentContext(join(out, 'browser-profile'), {
      headless: true, acceptDownloads: true, viewport: { width: 1365, height: 920 },
      ...(executablePath ? { executablePath } : {}) });
    signal?.addEventListener('abort', onAbort, { once: true });
    context = await persistentContext.browser().newContext({ acceptDownloads: true, viewport: { width: 1365, height: 920 } });
    page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', e => result.pageErrors.push(errorValue(e)));
    await page.route('**/api/dcat/**', async route => {
      const request = route.request(), url = new URL(request.url()), match = /^\/api\/dcat\/(corrections|exchanges)\/(create|save|issue|receive|apply)$/.exec(url.pathname);
      if (request.method() !== 'POST' || !match) return await route.continue();
      try {
        need(phaseName, 'RECIPIENT_UNOWNED_MUTATION');
        const [, scope, action] = match, raw = action === 'receive' ? request.postDataBuffer() : null;
        const body = raw ? { requestId: url.searchParams.get('requestId'), expectedSha256: request.headers()['x-dcat-sha256'] } : request.postDataJSON();
        need(UUID.test(body.requestId ?? ''), 'RECIPIENT_REQUEST_UUID_REQUIRED');
        let file = null;
        if (raw) {
          need(sha(raw) === body.expectedSha256, 'RECIPIENT_ORIGINAL_UPLOAD_CHANGED');
          const path = join(out, 'uploads', body.expectedSha256 + '.html'); await save(path, raw, true);
          file = { file: path, sha256: body.expectedSha256, bytes: raw.length };
        }
        const requestSha256 = sha(json(body)), old = journal.phases[phaseName];
        need(!old || old.requestSha256 === requestSha256, 'RECIPIENT_REQUEST_REPLACED');
        journal.phases[phaseName] = old ?? { scope, action, request: body, requestSha256, file, complete: false, preparedAt: new Date().toISOString() };
        await persist(); await route.continue();
      } catch (error) { responseFailure = error; await route.abort('failed'); }
    });
    page.on('response', response => {
      const request = response.request(), url = new URL(response.url());
      if (url.origin !== target.origin || request.method() !== 'POST' ||
        !/^\/api\/dcat\/(corrections|exchanges)\/(create|save|issue|receive|apply)$/.test(url.pathname)) return;
      responses = responses.then(async () => {
        const id = url.pathname.endsWith('/receive') ? url.searchParams.get('requestId') : request.postDataJSON().requestId;
        const entry = Object.values(journal.phases).find(x => x.request.requestId === id);
        need(entry, 'RECIPIENT_REPLY_WITHOUT_INTENT');
        entry.response = await response.json(); entry.httpStatus = response.status();
        if (!response.ok()) entry.rejection = entry.response;
        await persist();
      }).catch(error => { responseFailure = error; });
    });
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.getByRole('heading', { name: 'Catalogue corrections', exact: true }).waitFor();
    const launch = await api('launch'), currentCatalog = (await state()).dcat.catalogs.find(row => row.id === catalog.id);
    need(UUID.test(launch.instanceId ?? '') && Number.isSafeInteger(launch.pid) && launch.pid > 0 &&
      launch.project?.sourceKind === 'dcat-us' && currentCatalog?.sha256 === catalog.sha256 &&
      currentCatalog.bytes === catalog.bytes, 'RECIPIENT_AUTHENTICATED_WORKSPACE_CHANGED');
    result.listener = { instanceId: launch.instanceId, pid: launch.pid, directory: launch.directory,
      project: launch.project, origin: target.origin };
    if (inspectOnly) {
      Object.assign(result, inspectedSelection);
      await inspectExchange(inspectedSelection, 'received');
    } else {
      need(isAbsolute(baselineDocumentPath ?? ''), 'RECIPIENT_BASELINE_REQUIRED');
      const raw = await read(baselineDocumentPath);
      need(raw.length === catalog.bytes && sha(raw) === catalog.sha256, 'RECIPIENT_BASELINE_CHANGED');
      const catalogValue = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
      need(catalogValue.dataset?.length === 344 && catalogValue.dataset[0].identifier === 'GSA-2015-02-26-1', 'RECIPIENT_ORIGINAL_GSA_REQUIRED');
      const title = catalogValue.dataset[0].title;
      const recipientTitle = title + ' · recipient proposed correction';
      const authorTitle = title + ' · concurrent author correction';
      const draft = await mutate('create', 'corrections', 'create', async () => {
        const start = panel(page, 'Start a saved correction draft');
        await rendered(page, '.dcat-corrections', () => start.getByLabel('Exact retained source', { exact: true }).selectOption('catalog:' + catalog.id));
        await start.getByLabel('Draft label', { exact: true }).fill('GSA complete catalogue · independent recipient exchange exercise');
        await start.getByLabel('Editor', { exact: true }).fill(author);
        await start.getByLabel('Reason for this saved revision', { exact: true }).fill('Separate saved draft for the complete recipient proposal and concurrent author reconciliation.');
        await button(start, 'Create correction draft').click();
      });
      result.correctionId = draft.id;
      await selectDraft(draft.id, draft.revisions[0].id);
      const issued = await mutate('issue', 'exchanges', 'issue', async () => {
        const form = panel(page, 'Issue the selected catalogue revision');
        await form.getByLabel('Issue label', { exact: true }).fill('Complete original GSA catalogue recipient exercise');
        await form.getByLabel('Issuing editor', { exact: true }).fill(author);
        await form.getByLabel('Intended recipient', { exact: true }).fill('Independent catalogue reviewer');
        await form.getByLabel('Purpose of the recipient correction request', { exact: true }).fill(
          'Propose attributed exact catalogue edits while preserving every original file and saved edition.');
        await button(form, 'Save complete recipient issue').click();
      });
      result.exchangeId = issued.id;
      await selectDraft(draft.id, draft.revisions[0].id);
      await rendered(page, '.dcat-corrections', () => page.getByLabel('Saved recipient issue', { exact: true }).selectOption(issued.id));
      const html = await download(page, 'issued-recipient.html', button(page, 'Download complete recipient working HTML'));
      const initial = exchangeCodec.readCorrectionProposalFile(html.raw);
      await exchangeCodec.validateCorrectionProposal(initial);
      need(initial.issue.id === issued.id && initial.editions.length === 0, 'RECIPIENT_ISSUED_HTML_CHANGED');
      journal.senderProposalId ??= initial.proposalId; need(journal.senderProposalId === initial.proposalId, 'RECIPIENT_PROPOSAL_ID_CHANGED'); await persist();
      offline = await persistentContext.newPage(); offline.setDefaultTimeout(timeoutMs);
      offline.on('pageerror', e => result.pageErrors.push(errorValue(e)));
      offline.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
      await offline.route('http://**/*', async route => { result.errors.push({ code: 'RECIPIENT_UNEXPECTED_NETWORK' }); await route.abort(); });
      await offline.route('https://**/*', async route => { result.errors.push({ code: 'RECIPIENT_UNEXPECTED_NETWORK' }); await route.abort(); });
      const opening = journal.returnedFile ?? journal.workingFile ?? html.receipt;
      const openingRaw = await read(opening.file);
      need(openingRaw.length === opening.bytes && sha(openingRaw) === opening.sha256, 'RECIPIENT_PORTABLE_CHECKPOINT_CHANGED');
      const openingValue = exchangeCodec.readCorrectionProposalFile(openingRaw);
      await exchangeCodec.validateCorrectionProposal(openingValue);
      need(openingValue.issue.id === issued.id && openingValue.proposalId === initial.proposalId, 'RECIPIENT_PORTABLE_CHECKPOINT_ID_CHANGED');
      await offline.goto(pathToFileURL(opening.file).href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await offline.getByRole('heading', { name: 'Issued catalogue and return', exact: true }).waitFor();
      let backupRestored = false, portableProposal = null;
      if (!journal.returnedFile && journal.workingProposal) {
        const source = await read(journal.workingProposal.file);
        need(source.length === journal.workingProposal.bytes && sha(source) === journal.workingProposal.sha256, 'RECIPIENT_PORTABLE_JSON_CHANGED');
        portableProposal = exchangeCodec.readCorrectionProposalFile(source);
        await exchangeCodec.validateCorrectionProposal(portableProposal);
        need(portableProposal.issue.id === issued.id && portableProposal.proposalId === initial.proposalId, 'RECIPIENT_PORTABLE_JSON_ID_CHANGED');
      }
      if (await button(offline, 'Restore saved local changes').count()) {
        if (journal.returnedFile || openingValue.editions.length || portableProposal?.editions.length) {
          await download(offline, 'local-backup-before-bound-return.json', button(offline, 'Continue from this file'));
          await offline.waitForFunction(() => !document.querySelector('#recipient-app').inert);
        } else {
          await offlineAction(() => button(offline, 'Restore saved local changes').click()); backupRestored = true;
        }
      }
      if (!journal.returnedFile && journal.workingProposal && !backupRestored) {
        const retained = await read(journal.workingProposal.file);
        need(retained.length === journal.workingProposal.bytes && sha(retained) === journal.workingProposal.sha256,
          'RECIPIENT_PORTABLE_JSON_CHANGED');
        const pending = exchangeCodec.readCorrectionProposalFile(retained); await exchangeCodec.validateCorrectionProposal(pending);
        need(pending.issue.id === issued.id && pending.proposalId === initial.proposalId, 'RECIPIENT_PORTABLE_JSON_ID_CHANGED');
        // The JSON checkpoint is committed first. It remains usable if the next HTML export was interrupted.
        if (!same(pending, openingValue)) {
          await download(offline, 'before-restoring-complete-json-checkpoint.json',
            () => offline.getByLabel('Open another saved edition of this same proposal', { exact: true }).setInputFiles(journal.workingProposal.file));
          await offline.waitForFunction(() => !document.querySelector('#recipient-app').inert);
        }
      }
      let snapshot = await proposalSnapshot('before-recipient-continuation');
      const operations = [
        { op: 'replace', path: '/dataset/0/title', valueText: JSON.stringify(recipientTitle) },
        { op: 'replace', path: '/dataset/0/dataQuality', valueText: 'false' },
        { op: 'add', path: '/_recipientExercise', valueText: '{"exactInteger":900719925474099312345,"exactDecimal":1.2300000000000000001,"purpose":"Separate recipient exercise"}' },
      ];
      if (!snapshot.value.editions.length) {
        need(snapshot.value.draft.operations.length <= operations.length &&
          same(snapshot.value.draft.operations, operations.slice(0, snapshot.value.draft.operations.length)), 'RECIPIENT_QUEUED_PREFIX_CHANGED');
        await offline.getByLabel('Recipient editor', { exact: true }).fill(author.slice(0, 140) + ' · recipient');
        await offline.getByLabel('Reason for the next saved edition', { exact: true }).fill('Three exact typed edits proposed on the complete original catalogue.');
        for (let i = snapshot.value.draft.operations.length; i < operations.length; i++) {
          await queueRecipient(operations[i]); snapshot = await proposalSnapshot('queued-recipient-' + (i + 1));
        }
        await offlineAction(() => button(offline, 'Preview complete change set').click());
        await download(offline, 'recipient-preview.json', button(offline, 'Download full preview and resulting document'));
        await offlineAction(() => button(offline, 'Save attributed recipient edition').click());
        snapshot = await proposalSnapshot('saved-recipient-edition');
      }
      need(snapshot.value.editions.length === 1 && same(snapshot.value.editions[0].operations, operations), 'RECIPIENT_SAVED_EDITION_CHANGED');
      result.editionId = snapshot.value.editions[0].id;
      const unfinished = { op: 'add', path: '/_notAdopted', valueText: '{"queued":true}' };
      if (!snapshot.value.draft.operations.length) await queueRecipient(unfinished);
      snapshot = await proposalSnapshot('queued-unfinished-work');
      need(same(snapshot.value.draft.operations, [unfinished]), 'RECIPIENT_UNFINISHED_QUEUE_CHANGED');
      await offline.getByLabel('Reason for the next saved edition', { exact: true }).fill('Unfinished work retained for the recipient; excluded from this saved-edition adoption.');
      await panel(offline, 'Compose exact typed changes').getByLabel('Complete JSON literal for add or replace', { exact: true }).fill('{"unfinished":');
      snapshot = await proposalSnapshot('complete-return-with-unfinished-work');
      need(snapshot.value.draft.editor.valueText === '{"unfinished":', 'RECIPIENT_UNFINISHED_LITERAL_LOST');
      await offline.getByLabel('JSON pointer', { exact: true }).fill('/dataset');
      await offlineAction(() => button(offline, 'Open pointer').click());
      need((await panel(offline, 'Browse the complete catalogue').textContent()).includes('344 immediate children'), 'RECIPIENT_RECORDS_MISSING');
      await offlineAction(() => button(offline, 'Next rows').click());
      await offlineAction(() => button(offline, 'Previous rows').click());
      await offline.getByLabel('Find children', { exact: true }).fill('GSA-2015-02-26-1');
      await offlineAction(() => button(offline, 'Find').click());
      await layouts(offline, 'standalone-recipient');
      const originalFiles = panel(offline, 'Every original file').locator('tbody tr');
      need(await originalFiles.count() === initial.issue.files.length, 'RECIPIENT_EMBEDDED_FILE_COUNT');
      for (let i = 0; i < initial.issue.files.length; i++)
        await download(offline, 'standalone-original-' + i + '.bin', button(originalFiles.nth(i), 'Download complete file'), initial.issue.files[i]);
      await download(offline, 'saved-recipient-document.json', button(panel(offline, 'Saved recipient history'), 'Download saved document'),
        { sha256: snapshot.value.editions[0].documentSha256, bytes: snapshot.value.editions[0].documentBytes });
      await download(offline, 'saved-recipient-edition.json', button(panel(offline, 'Saved recipient history'), 'Download full attributed edition'));
      // Browsing changes the editor; restore the deliberately unfinished literal before the complete return.
      await panel(offline, 'Compose exact typed changes').getByLabel('Complete JSON literal for add or replace', { exact: true }).fill('{"unfinished":');
      let returned = await download(offline, 'complete-return.html', button(offline, 'Download complete working HTML'));
      if (journal.returnedFile) {
        const retained = await read(journal.returnedFile.file);
        need(retained.length === journal.returnedFile.bytes && sha(retained) === journal.returnedFile.sha256, 'RECIPIENT_RETAINED_RETURN_CHANGED');
        returned = { raw: retained, receipt: journal.returnedFile };
      }
      const returnValue = exchangeCodec.readCorrectionProposalFile(returned.raw), checked = await exchangeCodec.validateCorrectionProposal(returnValue);
      need(returnValue.editions[0].id === result.editionId && same(returnValue.draft.operations, [unfinished]) &&
        returnValue.draft.editor.valueText === '{"unfinished":' && checked.currentText.includes('900719925474099312345') &&
        checked.currentText.includes('1.2300000000000000001') && !checked.currentText.includes('"_notAdopted"'), 'RECIPIENT_COMPLETE_RETURN_CHANGED');
      result.returnedFile = returned.receipt;
      journal.returnedFile = returned.receipt; await persist();
      await offline.goto(pathToFileURL(returned.receipt.file).href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await offline.getByRole('heading', { name: 'Issued catalogue and return', exact: true }).waitFor();
      if (await button(offline, 'Continue from this file').count()) {
        await download(offline, 'prior-local-backup-before-exact-return.json', button(offline, 'Continue from this file'));
        await offline.waitForFunction(() => !document.querySelector('#recipient-app').inert);
      }
      need(await panel(offline, 'Compose exact typed changes').getByLabel('Complete JSON literal for add or replace', { exact: true }).inputValue() === '{"unfinished":',
        'RECIPIENT_REOPENED_UNFINISHED_LITERAL_CHANGED');
      const reopened = await proposalSnapshot('reopened-complete-return');
      need(reopened.value.editions[0].id === result.editionId && same(reopened.value.draft.operations, [unfinished]),
        'RECIPIENT_REOPENED_EDITION_CHANGED');
      await layouts(offline, 'reopened-standalone-return');
      const concurrent = await mutate('concurrent-author', 'corrections', 'save', async () => {
        const current = (await state()).dcat.corrections.drafts.find(x => x.id === draft.id);
        await selectDraft(draft.id, current.headRevisionId);
        await queueAuthor({ op: 'replace', path: '/dataset/0/title', valueText: JSON.stringify(authorTitle) });
        await rendered(page, '.dcat-corrections', () => button(panel(page, 'Compose a typed change set'), 'Preview all changes').click());
        const preview = panel(page, 'Complete change preview');
        await preview.getByLabel('Editor for this saved revision', { exact: true }).fill(author);
        await preview.getByLabel('Reason for this saved revision', { exact: true }).fill('Concurrent author title edit after issuing the unchanged original catalogue.');
        await button(preview, 'Save attributed revision').click();
      });
      result.authorRevisionId = concurrent.id;
      const received = await mutate('receive', 'exchanges', 'receive', async () => {
        await selectDraft(draft.id, concurrent.id);
        await rendered(page, '.dcat-corrections', () => page.getByLabel('Returned working HTML or JSON', { exact: true }).setInputFiles(returned.receipt.file));
        await button(page, 'Receive complete proposal').click();
      });
      result.proposalId = received.id;
      const accepted = await mutate('adopt', 'exchanges', 'apply', async () => {
        await selectDraft(draft.id, concurrent.id);
        await rendered(page, '.dcat-corrections', () => page.getByLabel('Received proposal', { exact: true }).selectOption(received.id));
        await rendered(page, '.dcat-corrections', () => page.getByLabel('Saved recipient edition for reconciliation', { exact: true }).selectOption(result.editionId));
        await rendered(page, '.dcat-corrections', () => button(page, 'Compare issued, current and returned catalogue').click());
        need(await button(page, 'Save reconciled author revision').isDisabled(), 'RECIPIENT_CONFLICT_DID_NOT_REQUIRE_CHOICE');
        await download(page, 'unresolved-reconciliation.json', button(page, 'Download complete reconciliation and choices'));
        await rendered(page, '.dcat-corrections', () => page.getByLabel('Choice for /dataset/0/title', { exact: true }).selectOption('returned'));
        const resolved = await download(page, 'complete-reconciliation.json', button(page, 'Download complete reconciliation and choices'));
        const preview = JSON.parse(resolved.raw);
        need(preview.complete && preview.saveable && preview.conflictCount === 1 && preview.unresolvedCount === 0 &&
          preview.rows.some(x => x.path === '/dataset/0/title' && x.choice === 'returned') &&
          !preview.rows.some(x => x.path === '/_notAdopted'), 'RECIPIENT_RECONCILIATION_CHANGED');
        result.preview = { sha256: preview.previewSha256, resultSha256: preview.documentSha256,
          conflicts: preview.conflictCount, operations: preview.operationsCount, download: resolved.receipt };
        await page.getByLabel('Accepting author', { exact: true }).fill(author);
        await page.getByLabel('Reason for the author decision', { exact: true }).fill('Adopt the selected saved recipient edition, explicitly preferring its title over the concurrent author title; retain unfinished work separately.');
        await button(page, 'Save reconciled author revision').click();
      });
      result.decisionId = accepted.id; result.adoptedRevisionId = accepted.revisionId;
      const full = await inspectExchange(result, 'producer');
      need(full.draft.revisions.length === 3 && full.draft.revisions[1].id === concurrent.id &&
        full.draft.revisions[2].id === accepted.revisionId && full.proposal.editions.length === 1 &&
        same(full.proposal.draft.operations, [unfinished]) && full.proposal.draft.editor.valueText === '{"unfinished":',
        'RECIPIENT_ADOPTION_HISTORY_CHANGED');
      const previewInput = journal.phases.adopt.request;
      need(previewInput.expectedRevisionId === concurrent.id && previewInput.editionId === result.editionId &&
        previewInput.choices.some(x => x.path === '/dataset/0/title' && x.choice === 'returned'), 'RECIPIENT_ADOPTION_REQUEST_CHANGED');
      result.preview ??= { sha256: previewInput.expectedPreviewSha256 };
      result.observations.push({ kind: 'explicit-three-way-adoption', conflictPath: '/dataset/0/title',
        issuedSha256: catalog.sha256, concurrentRevisionId: concurrent.id, savedRecipientEditionId: result.editionId,
        adoptedRevisionId: accepted.revisionId, unfinishedExcluded: true, completeOriginalFiles: initial.issue.files.length });
    }
    result.requests = Object.fromEntries(Object.entries(journal.phases).map(([key, value]) => [key,
      { scope: value.scope, action: value.action, request: value.request, requestSha256: value.requestSha256, complete: value.complete }]));
    await responses; if (responseFailure) throw responseFailure;
    need(!result.pageErrors.length && !result.errors.length, 'RECIPIENT_BROWSER_ERRORS');
    result.complete = true;
  } catch (error) { result.errors.push(errorValue(error)); }
  finally {
    signal?.removeEventListener('abort', onAbort);
    try { await close(); } catch (error) { result.cleanup.push({ owner: 'browser-context', closed: false }); result.errors.push(errorValue(error)); result.complete = false; }
    await responses;
    if (responseFailure) { result.complete = false; result.errors.push(errorValue(responseFailure)); }
    result.finishedAt = new Date().toISOString(); await save(join(out, 'result.json'), result);
  }
  need(result.complete, 'RECIPIENT_BROWSER_INCOMPLETE'); return result;
}
export async function inspectDcatRecipientCorrectionBrowser(options = {}) {
  return await runDcatRecipientCorrectionBrowser({ ...options, inspectOnly: true });
}
