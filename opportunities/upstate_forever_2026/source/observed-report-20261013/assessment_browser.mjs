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
