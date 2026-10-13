/** Visible assessment receiving chapter for the existing authenticated browser course.
 * The caller owns the browser, page, recording and original native operation.
 */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const cases = ['all-published-watersheds', 'all-computed-memberships',
  'july-fully-supported', 'draft-2026'];
const requireValue = (value, message) => { if (!value) throw Error(message); };
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const sourceChoices = rows => rows.map(({ source_collection_id, source_id }) =>
  ({ source_collection_id, source_id }));
const terminal = task => ['complete', 'failed', 'interrupted', 'cancelled'].includes(task?.state);

async function identity(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const part of createReadStream(path)) { hash.update(part); bytes += part.length; }
  return { bytes, sha256: hash.digest('hex') };
}
async function atomicJSON(path, value) {
  const temporary = path + '.writing';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}

/** Operate the same prepared original Workspace; return its completed chapter journal. */
export async function runAssessmentReceivingChapter({
  page, preparationDirectory, receivingReceipt, outputDirectory, operatorURL,
  timeout = 120000, redact = value => String(value),
}) {
  requireValue(page && typeof page.locator === 'function', 'Use the existing browser course page.');
  requireValue(Number.isFinite(timeout) && timeout > 0, 'Use a positive browser operation timeout.');
  const root = resolve(preparationDirectory), output = resolve(outputDirectory);
  const workspace = receivingReceipt.original_workspace_key;
  requireValue(typeof workspace === 'string' && workspace, 'Retain the original operator Workspace key.');
  const operatorLocation = new URL(operatorURL), origin = operatorLocation.origin;
  requireValue(['http:', 'https:'].includes(operatorLocation.protocol), 'Use the existing HTTP operator URL.');
  const capability = new URLSearchParams(operatorLocation.hash.slice(1)).get('token') || '';
  const callerRedact = redact;
  redact = value => {
    let text = String(callerRedact(value));
    for (const secret of [operatorURL, capability, origin].filter(Boolean))
      text = text.split(secret).join('[private operator]');
    return text.replace(/#token=[^\s"'<>]+/g, '#token=[redacted]');
  };
  const journal = { schema: 'upstate.assessment-browser-chapter/v1', state: 'running',
    project_id: receivingReceipt.project_id, workspace_key: workspace,
    original_report_operation_id: receivingReceipt.operation_id,
    started_at: new Date().toISOString(), inputs: [], steps: [], downloads: [], screenshots: [] };
  await mkdir(join(output, 'downloads'), { recursive: true });
  const receiptPath = join(output, 'assessment-browser.json');
  let prior = null;
  try { prior = JSON.parse(await readFile(receiptPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior) requireValue(prior.schema === journal.schema &&
    prior.project_id === journal.project_id && prior.workspace_key === workspace &&
    prior.original_report_operation_id === journal.original_report_operation_id,
    'Resume this chapter with its original project and report operation.');
  journal.requests = { ...(prior?.requests || {}) };
  let inputsReady = false;
  const checkpoint = () => atomicJSON(receiptPath, journal);
  async function original(path) {
    const actual = resolve(root, path), before = await identity(actual);
    const value = JSON.parse(await readFile(actual, 'utf8'));
    requireValue(canonical(before) === canonical(await identity(actual)),
      'An original preparation receipt changed while being read.');
    journal.inputs.push({ path, ...before });
    return value;
  }
  function responseAt(path, payload = {}) {
    return response => {
      const url = new URL(response.url());
      if (url.origin !== origin || url.pathname !== path) return false;
      let body; try { body = response.request().postDataJSON(); } catch { body = null; }
      if (!body) body = Object.fromEntries(url.searchParams);
      return Object.entries(payload).every(([key, value]) => body[key] === value);
    };
  }
  async function originalJSON(response, label) {
    requireValue(response.ok(), label + ' returned HTTP ' + response.status());
    const value = await response.json();
    requireValue(!value.error, label + ': ' + redact(value.error?.message || value.error || ''));
    return value;
  }
  async function screenshot(name, focus) {
    if (focus) await page.locator(focus).scrollIntoViewIfNeeded();
    const path = join(output, name + '.png');
    await page.screenshot({ path, fullPage: !focus, animations: 'disabled' });
    journal.screenshots.push(relative(output, path));
    await checkpoint();
  }
  async function originalWorkspace() {
    await page.locator('#workspace-select').waitFor({ state: 'visible' });
    await page.locator('#workspace-select option[value="' + workspace + '"]').waitFor({ state: 'attached' });
    if (await page.locator('#workspace-select').inputValue() !== workspace) {
      const changed = page.waitForResponse(async response => {
        if (!responseAt('/api/state')(response) || !response.ok()) return false;
        try { return (await response.json()).workspace_key === workspace; } catch { return false; }
      }, { timeout });
      await page.locator('#workspace-select').selectOption(workspace);
      await changed;
    }
    requireValue(await page.locator('#workspace-select').inputValue() === workspace,
      'Open the retained original assessment Workspace.');
  }
  async function openContext(expected) {
    await originalWorkspace();
    await page.locator('[data-view="assessment-context"]').click();
    const select = page.locator('[data-ac-editions]');
    await select.locator('option[value="' + expected.id + '"]').waitFor({ state: 'attached' });
    const pending = page.waitForResponse(responseAt('/api/assessment-context/edition',
      { workspace, id: expected.id }), { timeout });
    await select.selectOption(expected.id);
    const edition = await originalJSON(await pending, 'Saved assessment context');
    requireValue(edition.id === expected.id &&
      canonical(edition.summary) === canonical(expected.summary) &&
      edition.result.rows.length === expected.summary.assessment_row_count,
      'The displayed assessment differs from its original preparation receipt.');
    await page.waitForFunction(({ id, title }) =>
      document.querySelector('[data-ac-result] h2')?.textContent.trim() === title &&
      [...document.querySelectorAll('[data-ac-result] [data-ac-action="prepare-report"]')]
        .some(button => button.dataset.context === id),
      { id: expected.id, title: edition.title }, { timeout });
    requireValue((await page.locator('[data-ac-result] h2').innerText()).trim() === edition.title,
      'The visible context title differs from the opened original edition.');
    return edition;
  }
  async function downloadContext(edition, name, filename) {
    const expected = edition.files.find(member => basename(member.path) === filename);
    requireValue(expected, 'The complete context omitted ' + filename);
    const pending = page.waitForEvent('download', { timeout });
    await page.locator('[data-ac-result] .ac-downloads')
      .getByRole('link', { name: filename, exact: true }).click();
    const item = await pending, path = join(output, 'downloads', name + '-' + filename);
    await item.saveAs(path);
    requireValue(!(await item.failure()), 'Downloading the original context failed.');
    const actual = await identity(path);
    requireValue(actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
      'The browser context download changed the original ' + filename + '.');
    journal.downloads.push({ case: name, role: filename, path: relative(output, path), ...actual });
    return path;
  }
  async function refreshedState() {
    const pending = page.waitForResponse(async response => {
      if (!responseAt('/api/state')(response) || !response.ok()) return false;
      try { return (await response.json()).workspace_key === workspace; } catch { return false; }
    }, { timeout });
    await page.locator('.top-actions [data-action="refresh"]').click();
    return originalJSON(await pending, 'Original retained queue');
  }
  async function taskDetails(id) {
    if (!(await page.locator('#task-panel').isVisible()))
      await page.locator('.top-actions [data-action="tasks"]').click();
    const pending = page.waitForResponse(responseAt('/api/task', { id }), { timeout });
    await page.locator('#task-list [data-action="task-open"][data-id="' + id + '"]').click();
    const task = await originalJSON(await pending, 'Original retained task');
    requireValue(task.id === id && task.workspace === workspace &&
      task.action === 'assessment.context.report', 'Open the original assessment report task.');
    return task;
  }
  async function prepareReport(expected, report) {
    let wanted = '', latest = null, finish;
    const seen = new Map(), completion = new Promise(resolve => { finish = resolve; });
    const observe = task => {
      if (!task?.id) return;
      seen.set(task.id, task);
      if (task.id === wanted && terminal(task)) { latest = task; finish(task); }
    };
    const listener = async response => {
      if (!responseAt('/api/state')(response) || !response.ok()) return;
      try { for (const task of (await response.json()).tasks || []) observe(task); } catch {}
    };
    page.on('response', listener);
    let timer;
    try {
      // Refresh through the visible desk before acting: a retained operator process
      // can still have an older report module loaded after its disk source changed.
      const catalogResponse = page.waitForResponse(responseAt('/api/assessment-context/catalog',
        { workspace }), { timeout });
      await page.locator('[data-ac-action="reload"]').click();
      const catalog = await originalJSON(await catalogResponse, 'Current assessment report catalogue');
      requireValue(catalog.report_version === report.version,
        'Restart the existing operator with the installed source before continuing this preparation: ' +
        'loaded report ' + String(catalog.report_version || 'unversioned') +
        ', prepared report ' + String(report.version) + '.');
      const state = await refreshedState();
      const owned = (state.tasks || []).filter(task =>
        task.workspace === workspace && task.action === 'assessment.context.report');
      const previous = journal.requests[expected.id];
      const matches = task => task.result?.context_id === expected.id &&
        task.result?.operation_id === report.operation_id &&
        canonical(task.result.source) === canonical(report.source) &&
        !task.result.parcel_id && !task.result.selected_delivery_id;
      let task = previous ? owned.find(item => item.id === previous.task_id) :
        owned.find(matches);
      requireValue(!previous || task, 'The chapter original task is absent from the retained queue: ' +
        String(previous?.task_id || ''));
      if (!task) task = owned.find(item =>
        ['queued', 'running'].includes(item.state) && item.payload?.context_id === expected.id &&
        !item.payload.parcel_id && !item.payload.delivery_id && item.payload.report_version === report.version);
      if (task && ['failed', 'interrupted', 'cancelled'].includes(task.state)) {
        await taskDetails(task.id);
        const resumed = page.waitForResponse(responseAt('/api/task/resume', { id: task.id }), { timeout });
        await page.locator('#detail-body [data-action="task-resume"][data-id="' + task.id + '"]').click();
        task = await originalJSON(await resumed, 'Resume original assessment task');
        await page.locator('[data-action="detail-close"]').click();
      }
      if (!task) {
        const controls = page.locator('[data-ac-result] .ac-report');
        await controls.locator('[data-ac-report-delivery]').selectOption('');
        const submitted = page.waitForResponse(responseAt('/api/actions',
          { workspace, action: 'assessment.context.report' }), { timeout });
        await controls.locator('[data-ac-action="prepare-report"][data-context="' + expected.id + '"]').click();
        task = await originalJSON(await submitted, 'Original assessment report preparation');
      }
      requireValue(task?.workspace === workspace && task.action === 'assessment.context.report',
        'The browser selected a different Workspace or operation.');
      wanted = task.id;
      journal.requests[expected.id] = { task_id: task.id, operation_id: task.operation_id,
        report_operation_id: report.operation_id, source: report.source, state: task.state };
      await checkpoint();
      observe(task); if (seen.has(wanted)) observe(seen.get(wanted));
      const completed = latest || await Promise.race([completion, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('The original report-source task did not finish within the receiving timeout.')), timeout);
      })]);
      requireValue(completed.state === 'complete',
        'The original report-source task ' + completed.state + ': ' + redact(completed.error?.message || ''));
      requireValue(matches(completed) && completed.result.title === report.title,
        'The completed UI task changed the retained assessment report source or title.');
      journal.requests[expected.id].state = completed.state;
      await checkpoint();
      await taskDetails(completed.id);
      await page.locator('#detail-body [data-action="assessment-context-report-open"][data-task="' +
        completed.id + '"]').click();
      if (await page.locator('#task-panel').isVisible())
        await page.locator('[data-action="tasks-close"]').click();
      const selected = report.delivery_selection?.observed_context_sources?.length ?
        report.delivery_selection.observed_context_sources : [report.source];
      await page.waitForFunction(({ title, ids }) => {
        if (document.querySelector('[data-scientific-report-field="title"]')?.value !== title) return false;
        const rows = [...document.querySelectorAll('.scientific-report-order > li')];
        return rows.length === ids.length && rows.every((row, index) =>
          row.querySelector('small')?.textContent.trim().endsWith(' · ' + ids[index]));
      }, { title: report.title, ids: selected.map(row => row.source_id) }, { timeout });
      const pending = page.waitForResponse(responseAt('/api/source-reports/scientific-preview'), { timeout });
      await page.locator('[data-scientific-report-action="preview"]').click();
      const preview = await originalJSON(await pending, 'Prepared scientific source preview');
      requireValue(preview.workspace_key === workspace &&
        canonical(sourceChoices(preview.sources)) === canonical(selected),
        'The composer changed the exact prepared source order or kept an older selection.');
      journal.steps.push({ action: 'assessment_to_scientific_report', context_id: expected.id,
        task_id: completed.id, report_operation_id: completed.result.operation_id,
        title: report.title, sources: selected, preview_id: preview.id });
    } finally {
      if (timer) clearTimeout(timer);
      page.off('response', listener);
    }
  }

  try {
    const selection = await original('selection.json');
    const prepared = await original('assessment-preparation.json');
    requireValue(selection.schema === 'upstate.assessment-receiving-preparation/v1' &&
      prepared.schema === selection.schema && selection.project_id === receivingReceipt.project_id &&
      resolve(selection.workspace) === resolve(receivingReceipt.original_workspace),
      'Use the original assessment preparation and its matching report receiver.');
    const codePaths = ['model/station_study.py', 'model/station_geography.py',
      'model/assessment_context.py', 'model/assessment_report_context.py',
      'model/assessment_map_context.py', 'model/scientific_figures.py', 'model/scientific_map_figures.py',
      'model/station_assessment_context.py', 'model/station_inventory.py', 'model/station_wbd_context.py',
      'model/common.py', 'source/observed-report-20261013/prepare_assessment.py'];
    journal.model_source = [];
    for (const path of codePaths) {
      const sources = (selection.model_source || []).filter(item => item.path.endsWith('/' + path));
      requireValue(sources.length === 1, 'The preparation lacks its original implementation: ' + path);
      const actual = await identity(join(receivingReceipt.application, path));
      requireValue(actual.bytes === sources[0].bytes && actual.sha256 === sources[0].sha256,
        'The installed source differs from this preparation: ' + path +
        '. Complete a fresh preparation output with the current source before browser receiving.');
      journal.model_source.push({ path, ...actual });
    }
    const study = await original('prepared/study-all164.json');
    requireValue(prepared.cases?.['study-all164']?.state === 'complete' &&
      study.project_id === selection.project_id, 'Complete the original all-editions station study.');
    const inputs = [];
    for (const name of cases) {
      requireValue(prepared.cases?.['context-' + name]?.state === 'complete',
        'Complete the original assessment case ' + name + '.');
      const context = await original('prepared/context-' + name + '.json');
      const report = await original('prepared/' + name + '-report.json');
      requireValue(context.project_id === selection.project_id && report.workspace_id === selection.project_id &&
        report.context_id === context.id && canonical(context.report_source) === canonical(report.source),
        'Keep each context and report source in their original preparation case.');
      inputs.push({ name, context, report });
    }
    if (prior?.inputs_ready) requireValue(canonical(prior.inputs) === canonical(journal.inputs),
      'Resume the chapter with the same complete original preparation receipts.');
    inputsReady = true; journal.inputs_ready = true;
    await checkpoint();
    await originalWorkspace();
    await page.locator('[data-view="station-geography"]').click();
    const stationSelect = page.locator('[data-sg-editions]');
    await stationSelect.locator('option[value="' + study.id + '"]').waitFor({ state: 'attached' });
    const stationResponse = page.waitForResponse(responseAt('/api/station-geography/edition',
      { workspace, id: study.id }), { timeout });
    await stationSelect.selectOption(study.id);
    const station = await originalJSON(await stationResponse, 'Original all-editions station study');
    requireValue(station.id === study.id && canonical(station.summary) === canonical(study.summary),
      'The displayed station study differs from the completed original.');
    await page.waitForFunction(({ id, title }) =>
      document.querySelector('[data-sg-summary] code')?.textContent === id.slice(0, 12) &&
      document.querySelector('[data-sg-summary] h2')?.textContent.trim() === title,
      { id: study.id, title: station.title || station.result?.title }, { timeout });
    await screenshot('01-original-station-study', '[data-sg-summary]');
    await page.locator('[data-sg-action="assessment-context"]').click();
    await page.locator('[data-ac-field="station_geography_id"]').waitFor({ state: 'visible' });
    await page.waitForFunction(id => document.querySelector('[data-ac-field="station_geography_id"]')?.value === id &&
      document.querySelectorAll('[data-ac-inventory-toggle]:checked').length === 3, study.id, { timeout });
    requireValue(await page.locator('[data-ac-field="station_geography_id"]').inputValue() === study.id,
      'Station geography opened a different assessment source study.');
    requireValue(await page.locator('[data-ac-inventory-toggle]:checked').count() === 3,
      'The all-editions assessment handoff did not retain all three original inventories.');
    journal.steps.push({ action: 'station_to_assessment', geography_id: study.id,
      inventory_count: 3, source_summary: study.source_summary });
    await screenshot('02-original-assessment-inventories', '[data-ac-form-area]');
    for (const [index, input] of inputs.entries()) {
      const { name, context, report } = input;
      const edition = await openContext(context);
      await screenshot(String(index + 3).padStart(2, '0') + '-' + name, '[data-ac-result]');
      const html = await downloadContext(edition, name, 'OPEN_ASSESSMENT_CONTEXT.html');
      await downloadContext(edition, name, 'context.json');
      await downloadContext(edition, name, 'assessment-rows.csv');
      await downloadContext(edition, name, 'assessment-context.zip');
      // Open the actual downloaded, self-contained report in the same recorded page.
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.locator('h1').waitFor({ state: 'visible' });
      requireValue((await page.locator('h1').innerText()).trim() === edition.title,
        'The downloaded context report changed its original title.');
      journal.steps.push({ action: 'open_downloaded_context_html', context_id: context.id,
        title: (await page.locator('h1').innerText()).trim(), path: relative(output, html) });
      await screenshot(String(index + 3).padStart(2, '0') + '-' + name + '-downloaded-html');
      await page.goto(operatorURL, { waitUntil: 'domcontentloaded' });
      await openContext(context);
      await prepareReport(context, report);
      await screenshot(String(index + 3).padStart(2, '0') + '-' + name + '-scientific-composer',
        '.scientific-report-editions');
      await checkpoint();
    }
    journal.state = 'complete';
    return journal;
  } catch (error) {
    journal.state = 'failed'; journal.error = redact(error?.stack || error);
    if (!page.isClosed()) try { await screenshot('assessment-failure-state'); } catch {}
    throw error;
  } finally {
    journal.finished_at = new Date().toISOString();
    if (!inputsReady && prior?.inputs_ready) {
      journal.attempted_inputs = journal.inputs;
      journal.inputs = prior.inputs; journal.inputs_ready = true;
    }
    await checkpoint();
  }
}


/** Continue the same report course into its original editable Study records. */
export async function runReceivedAssessmentChapter({
  page, receivingReceipt, outputDirectory, operatorURL,
  timeout = 120000, redact = value => String(value),
}) {
  requireValue(page && typeof page.locator === 'function', 'Use the existing recorded browser page.');
  requireValue(Number.isFinite(timeout) && timeout > 0, 'Use a positive receiving timeout.');
  const selected = receivingReceipt.selected_study_receiving;
  if (!selected) return { schema: 'upstate.received-assessment-browser/v1', state: 'not_applicable',
    reason: 'This original report receipt has no selected Study receiving result.' };
  const workspace = selected.workspace_key, study = selected.study_id;
  requireValue(typeof workspace === 'string' && workspace && /^[a-f0-9]{64}$/.test(study || ''),
    'Use the original selected Study and its actual receiving Workspace.');
  const location = new URL(operatorURL), origin = location.origin;
  requireValue(['http:', 'https:'].includes(location.protocol), 'Use the existing HTTP operator.');
  const capability = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const callerRedact = redact;
  redact = value => {
    let text = String(callerRedact(value));
    for (const secret of [operatorURL, capability, origin].filter(Boolean))
      text = text.split(secret).join('[private operator]');
    return text.replace(/#token=[^\s"'<>]+/g, '#token=[redacted]');
  };
  const output = resolve(outputDirectory);
  await mkdir(join(output, 'downloads'), { recursive: true });
  const journalPath = join(output, 'received-assessment-browser.json');
  let prior = null;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const journal = { schema: 'upstate.received-assessment-browser/v1', state: 'running',
    project_id: receivingReceipt.project_id, workspace_key: workspace, study_id: study,
    original_report_operation_id: receivingReceipt.operation_id, started_at: new Date().toISOString(),
    sources: [], steps: [], downloads: [], screenshots: [], submitted_actions: [],
    requests: { ...(prior?.requests || {}) } };
  if (prior) requireValue(prior.schema === journal.schema && prior.project_id === journal.project_id &&
    prior.workspace_key === workspace && prior.study_id === study &&
    prior.original_report_operation_id === journal.original_report_operation_id,
    'Resume the same original received Study, report operation and Workspace.');
  let saves = Promise.resolve(), activeBinding = null, requestFailure = null;
  const checkpoint = () => {
    const snapshot = JSON.parse(JSON.stringify(journal));
    saves = saves.then(() => atomicJSON(journalPath, snapshot));
    return saves;
  };
  const binding = row => ({ ...row.source, source_body_sha256: row.source_body_sha256 });
  const token = row => canonical(binding(row));
  function responseAt(path, values = {}) {
    return response => {
      const url = new URL(response.url());
      if (url.origin !== origin || url.pathname !== path) return false;
      let data; try { data = response.request().postDataJSON(); } catch { data = null; }
      if (!data) data = Object.fromEntries(url.searchParams);
      return Object.entries(values).every(([key, value]) => canonical(data[key]) === canonical(value));
    };
  }
  async function originalJSON(response, label) {
    requireValue(response.ok(), label + ' returned HTTP ' + response.status());
    const value = await response.json();
    requireValue(!value.error, label + ': ' + redact(value.error?.message || value.error || ''));
    return value;
  }
  const requestListener = request => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname !== '/api/actions') return;
    let data; try { data = request.postDataJSON(); } catch { data = null; }
    if (!activeBinding || data?.workspace !== workspace ||
      data.action !== 'assessment.context.adopt_source' ||
      canonical(data.payload) !== canonical(activeBinding) || !data.operation_id) {
      requestFailure = Error('The received assessment chapter submitted an unrelated queued action.');
      return;
    }
    const key = canonical(activeBinding), previous = journal.requests[key];
    if (previous?.operation_id && previous.operation_id !== data.operation_id) {
      requestFailure = Error('Source receiving replaced its original queue operation.');
      return;
    }
    journal.requests[key] = { ...previous, source: { ...activeBinding },
      operation_id: data.operation_id, state: 'submitted' };
    journal.submitted_actions.push({ workspace, action: data.action,
      operation_id: data.operation_id, source: { ...activeBinding } });
    checkpoint().catch(error => { requestFailure = error; });
  };
  page.on('request', requestListener);
  async function screenshot(name, focus) {
    if (focus) await page.locator(focus).scrollIntoViewIfNeeded();
    const path = join(output, name + '.png');
    await page.screenshot({ path, fullPage: !focus, animations: 'disabled' });
    journal.screenshots.push(relative(output, path));
    await checkpoint();
  }
  async function workspaceSelected() {
    await page.locator('#workspace-select').waitFor({ state: 'visible' });
    await page.locator('#workspace-select option[value="' + workspace + '"]').waitFor({ state: 'attached' });
    if (await page.locator('#workspace-select').inputValue() !== workspace) {
      const pending = page.waitForResponse(async response => {
        if (!responseAt('/api/state')(response) || !response.ok()) return false;
        try { return (await response.json()).workspace_key === workspace; } catch { return false; }
      }, { timeout });
      await page.locator('#workspace-select').selectOption(workspace);
      await pending;
    }
    requireValue(await page.locator('#workspace-select').inputValue() === workspace,
      'Open the original selected Study receiving Workspace.');
  }
  async function refreshState() {
    const pending = page.waitForResponse(async response => {
      if (!responseAt('/api/state')(response) || !response.ok()) return false;
      try { return (await response.json()).workspace_key === workspace; } catch { return false; }
    }, { timeout });
    await page.locator('.top-actions [data-action="refresh"]').click();
    return originalJSON(await pending, 'Retained receiving queue');
  }
  async function openStudy() {
    await workspaceSelected();
    await page.locator('[data-view="study-transfer"]').click();
    const root = page.locator('[data-study-received]');
    await root.locator('[data-received-action="refresh"]').waitFor({ state: 'visible' });
    async function listPage(action) {
      const pending = page.waitForResponse(responseAt('/api/study-transfer/received', { workspace }), { timeout });
      await root.locator('[data-received-action="' + action + '"]').click();
      const value = await originalJSON(await pending, 'Original received Study catalogue');
      requireValue(Array.isArray(value.items) && Number.isSafeInteger(value.offset) &&
        Number.isSafeInteger(value.limit) && value.limit > 0,
        'The received Study catalogue lost its page identity.');
      return value;
    }
    let current = await listPage('refresh');
    const backwards = new Set();
    while (current.offset > 0) {
      requireValue(!backwards.has(current.offset), 'The received Study catalogue repeated a page.');
      backwards.add(current.offset);
      current = await listPage('previous');
    }
    const visited = new Set();
    while (!current.items.some(row => row.id === study)) {
      requireValue(!visited.has(current.offset) && current.next_offset !== null &&
        Number.isSafeInteger(current.next_offset) && current.next_offset > current.offset,
        'The original selected Study is absent from the complete receiving catalogue.');
      visited.add(current.offset);
      current = await listPage('next');
    }
    const pending = page.waitForResponse(responseAt('/api/study-transfer/received-detail',
      { workspace, study_id: study }), { timeout });
    await root.locator('[data-received-action="open"][data-id="' + study + '"]').click();
    const detail = await originalJSON(await pending, 'Original received Study');
    requireValue(detail.id === study && detail.workspace_key === workspace,
      'The receiving view selected another Study or Workspace.');
    await page.waitForFunction(title =>
      document.querySelector('.st-received-detail > h4')?.textContent.trim() === title,
      detail.title, { timeout });
    requireValue(Array.isArray(detail.assessment_sources),
      'Install the current assessment Study receiver before continuing this chapter.');
    return detail;
  }
  const rowButton = (action, index) => page.locator(
    '.st-received-assessments [data-received-action="assessment-' + action +
    '"][data-assessment-source="' + index + '"]');
  async function openContext(id, expectedSummary, trigger, parcelID = null) {
    const pending = page.waitForResponse(responseAt('/api/assessment-context/edition',
      { workspace, id }), { timeout });
    const parcelPending = parcelID ? page.waitForResponse(responseAt('/api/assessment-context/parcels',
      { workspace, id: parcelID }), { timeout }) : null;
    await trigger();
    const edition = await originalJSON(await pending, 'Received saved assessment context');
    requireValue(edition.id === id && canonical(edition.summary) === canonical(expectedSummary) &&
      edition.result?.rows?.length === expectedSummary.assessment_row_count,
      'The received context changed the original assessment counts or edition.');
    await page.waitForFunction(({ id, title }) =>
      document.querySelector('[data-ac-editions]')?.value === id &&
      document.querySelector('[data-ac-result] h2')?.textContent.trim() === title &&
      [...document.querySelectorAll('[data-ac-result] [data-ac-action="prepare-report"]')]
        .some(button => button.dataset.context === id),
      { id, title: edition.title }, { timeout });
    await page.waitForFunction(summary => {
      const counts = Object.fromEntries([...document.querySelectorAll('[data-ac-result] .ac-summary > div')]
        .map(row => [row.querySelector('span')?.textContent.trim(), row.querySelector('strong')?.textContent.trim()]));
      return [['Inventories', summary.inventory_count ?? 1], ['Stations', summary.station_count],
        ['Assessment rows', summary.assessment_row_count], ['Watersheds', summary.watershed_count]]
        .every(([label, value]) => counts[label] === String(value));
    }, expectedSummary, { timeout });
    let parcel = null;
    if (parcelPending) {
      parcel = await originalJSON(await parcelPending, 'Received saved parcel associations');
      requireValue(parcel.id === parcelID && parcel.context_id === id,
        'The received parcel associations select another original context.');
      await page.waitForFunction(({ id, title }) =>
        document.querySelector('[data-ac-parcel-editions]')?.value === id &&
        document.querySelector('[data-ac-parcel-result] h3')?.textContent.trim() === title,
        { id: parcelID, title: parcel.title }, { timeout });
      await page.waitForFunction(count => {
        const row = [...document.querySelectorAll('[data-ac-parcel-result] .ac-summary > div')]
          .find(item => item.querySelector('span')?.textContent.trim() === 'Parcels');
        return row?.querySelector('strong')?.textContent.trim() === String(count);
      }, parcel.summary.parcel_count, { timeout });
    }
    return { edition, parcel };
  }
  async function contextDownload(edition, index) {
    const filename = 'assessment-context.zip';
    const expected = edition.files.find(row => basename(row.path) === filename);
    requireValue(expected, 'The editable context omitted its complete original ZIP.');
    const pending = page.waitForEvent('download', { timeout });
    await page.locator('[data-ac-result] .ac-downloads')
      .getByRole('link', { name: filename, exact: true }).click();
    const item = await pending;
    const path = join(output, 'downloads', String(index + 1).padStart(2, '0') + '-' + filename);
    await item.saveAs(path);
    requireValue(!(await item.failure()), 'Downloading the received context failed.');
    const actual = await identity(path);
    requireValue(actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
      'The received context download differs from its exact saved ZIP.');
    journal.downloads.push({ context_id: edition.id, role: filename, path: relative(output, path), ...actual });
  }
  async function stationOpened(id, trigger, expectedSummary = null) {
    const pending = page.waitForResponse(responseAt('/api/station-geography/edition',
      { workspace, id }), { timeout });
    await trigger();
    const edition = await originalJSON(await pending, 'Received Station geography');
    requireValue(edition.id === id && (!expectedSummary ||
      canonical(edition.summary) === canonical(expectedSummary)),
      'The received Station desk changed its original study identity.');
    await page.waitForFunction(({ id, title }) =>
      document.querySelector('[data-sg-editions]')?.value === id &&
      document.querySelector('[data-sg-summary] code')?.textContent === id.slice(0, 12) &&
      document.querySelector('[data-sg-summary] h2')?.textContent.trim() === title,
      { id, title: edition.title || edition.result?.title }, { timeout });
    return edition;
  }
  async function taskDetails(id) {
    if (!(await page.locator('#task-panel').isVisible()))
      await page.locator('.top-actions [data-action="tasks"]').click();
    const pending = page.waitForResponse(responseAt('/api/task', { id }), { timeout });
    await page.locator('#task-list [data-action="task-open"][data-id="' + id + '"]').click();
    const task = await originalJSON(await pending, 'Original assessment source receiving task');
    requireValue(task.id === id && task.workspace === workspace &&
      task.action === 'assessment.context.adopt_source',
      'Resume the original assessment source receiving task.');
    return task;
  }
  async function adopt(row, index) {
    const wanted = binding(row), key = token(row), previous = journal.requests[key];
    activeBinding = wanted;
    const sameResult = task => canonical(task.result?.source) === canonical(wanted);
    const sameTask = task => task.workspace === workspace &&
      task.action === 'assessment.context.adopt_source' &&
      (canonical(task.payload) === canonical(wanted) || sameResult(task));
    let state = await refreshState();
    const owned = (state.tasks || []).filter(task =>
      task.workspace === workspace && task.action === 'assessment.context.adopt_source');
    let task = previous?.task_id ? owned.find(item => item.id === previous.task_id) :
      previous?.operation_id ? owned.find(item => item.operation_id === previous.operation_id) :
      owned.find(item => sameTask(item) && item.state === 'complete') || owned.find(sameTask);
    requireValue(!previous?.task_id && !previous?.operation_id || task,
      'Retain the original source receiving task before resuming: ' +
      String(previous?.task_id || previous?.operation_id || ''));
    if (task) requireValue(sameTask(task), 'The retained receiving task selects another original source.');
    if (task && ['failed', 'interrupted', 'cancelled'].includes(task.state)) {
      await taskDetails(task.id);
      const pending = page.waitForResponse(responseAt('/api/task/resume', { id: task.id }), { timeout });
      await page.locator('#detail-body [data-action="task-resume"][data-id="' + task.id + '"]').click();
      task = await originalJSON(await pending, 'Resume original source receiving');
      await page.locator('[data-action="detail-close"]').click();
    }
    if (!task) {
      const pending = page.waitForResponse(responseAt('/api/actions',
        { workspace, action: 'assessment.context.adopt_source', payload: wanted }), { timeout });
      await rowButton('receive', index).click();
      task = await originalJSON(await pending, 'Receive this original assessment source');
    }
    requireValue(task?.id && sameTask(task), 'The receiving UI submitted another source or Workspace.');
    journal.requests[key] = { ...journal.requests[key], source: wanted, task_id: task.id,
      operation_id: task.operation_id, state: task.state };
    await checkpoint();
    const deadline = Date.now() + timeout;
    while (!terminal(task)) {
      requireValue(Date.now() < deadline, 'The original source receiving task remains ' + task.state +
        '; resume its retained task ' + task.id + ' in this same chapter.');
      await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - Date.now())));
      state = await refreshState();
      task = (state.tasks || []).find(item => item.id === task.id) || task;
      requireValue(sameTask(task), 'The original receiving task changed its selected source.');
    }
    journal.requests[key].state = task.state;
    await checkpoint();
    requireValue(task.state === 'complete', 'Source receiving ' + task.state + ': ' +
      redact(task.error?.message || task.error || task.id));
    requireValue(sameResult(task) && /^[a-f0-9]{64}$/.test(task.result.context_id || '') &&
      /^[a-f0-9]{64}$/.test(task.result.station_geography_id || '') &&
      (!task.result.parcel_id || /^[a-f0-9]{64}$/.test(task.result.parcel_id)),
      'The completed receiving operation lost its original source or actual editable IDs.');
    await taskDetails(task.id);
    const opened = await openContext(task.result.context_id, row.summary, () =>
      page.locator('#detail-body [data-action="assessment-context-source-open"][data-task="' +
        task.id + '"]').click(), task.result.parcel_id);
    if (await page.locator('#task-panel').isVisible())
      await page.locator('[data-action="tasks-close"]').click();
    journal.steps.push({ action: 'receive_editable_assessment', source: wanted,
      task_id: task.id, operation_id: task.operation_id, context_id: task.result.context_id,
      station_geography_id: task.result.station_geography_id, parcel_id: task.result.parcel_id });
    activeBinding = null;
    return { ...opened, station_id: task.result.station_geography_id };
  }
  try {
    await checkpoint();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const detail = await openStudy();
    const rows = detail.assessment_sources;
    journal.sources = rows.map(row => ({ ...binding(row), context_id: row.context_id,
      parcel_id: row.parcel_id, source_project_id: row.source_project_id,
      original_selection: row.original_selection, summary: row.summary }));
    if (prior?.sources_ready) requireValue(canonical(prior.sources) === canonical(journal.sources),
      'Resume this Study with its exact original assessment source identities.');
    journal.sources_ready = true;
    if (!rows.length) {
      journal.state = 'not_applicable';
      journal.reason = 'This selected Study contains no original assessment report sources.';
      return journal;
    }
    for (const [index, row] of rows.entries()) {
      requireValue(/^[a-f0-9]{64}$/.test(row.source?.source_collection_id || '') &&
        typeof row.source?.source_id === 'string' && row.source.source_id &&
        /^[a-f0-9]{64}$/.test(row.source_body_sha256 || ''),
        'The Study lost its retained original assessment source binding.');
      if (index) await openStudy();
      const label = String(index + 1).padStart(2, '0');
      await screenshot(label + '-received-assessment-source', '.st-received-assessments');
      await rowButton('report', index).click();
      await page.waitForFunction(({ id, title }) => {
        const rows = [...document.querySelectorAll('.scientific-report-order > li')];
        return rows.length === 1 && rows[0].querySelector('small')?.textContent.trim().endsWith(' · ' + id) &&
          document.querySelector('[data-scientific-report-field="title"]')?.value === title;
      }, { id: row.source.source_id, title: row.title || '' }, { timeout });
      const previewResponse = page.waitForResponse(responseAt('/api/source-reports/scientific-preview'), { timeout });
      await page.locator('[data-scientific-report-action="preview"]').click();
      const preview = await originalJSON(await previewResponse, 'Exact retained assessment report source');
      requireValue(preview.workspace_key === workspace &&
        canonical(sourceChoices(preview.sources)) === canonical([row.source]),
        'Opening this report source retained another source or changed its original order.');
      journal.steps.push({ action: 'received_source_to_report', source: binding(row),
        preview_id: preview.id, sources: [row.source] });
      await screenshot(label + '-original-source-composer', '.scientific-report-editions');
      await openStudy();
      let opened;
      if (row.native) {
        opened = await openContext(row.native.context.id, row.native.context.summary,
          () => rowButton(row.native.parcel ? 'parcels' : 'open', index).click(),
          row.native.parcel?.id || null);
        opened.station_id = row.native.station.id;
      } else opened = await adopt(row, index);
      await contextDownload(opened.edition, index);
      await screenshot(label + '-editable-context-desktop', '[data-ac-result]');
      if (opened.parcel) await screenshot(label + '-editable-parcels', '[data-ac-parcel-result]');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot(label + '-editable-context-narrow', '[data-ac-result]');
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (row.native) {
        await openStudy();
        await stationOpened(opened.station_id, () => rowButton('stations', index).click(),
          row.native.station.summary);
      } else {
        await page.locator('[data-view="station-geography"]').click();
        const select = page.locator('[data-sg-editions]');
        await select.locator('option[value="' + opened.station_id + '"]').waitFor({ state: 'attached' });
        await stationOpened(opened.station_id, () => select.selectOption(opened.station_id));
      }
      await screenshot(label + '-editable-stations', '[data-sg-summary]');
      journal.steps.push({ action: 'open_received_editable_geography', source: binding(row),
        context_id: opened.edition.id, station_geography_id: opened.station_id,
        parcel_id: opened.parcel?.id || null, summary: opened.edition.summary });
      requireValue(!requestFailure, requestFailure?.message || '');
      await checkpoint();
    }
    requireValue(!requestFailure, requestFailure?.message || '');
    journal.state = 'complete';
    return journal;
  } catch (error) {
    journal.state = 'failed'; journal.error = redact(error?.stack || error);
    if (!page.isClosed()) try { await screenshot('received-assessment-failure'); } catch {}
    throw error;
  } finally {
    page.off('request', requestListener);
    journal.finished_at = new Date().toISOString();
    await checkpoint();
  }
}
