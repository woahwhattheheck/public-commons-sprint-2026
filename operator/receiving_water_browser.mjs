#!/usr/bin/env node
/** Operate the receiving-water browser over an existing original Workspace. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

assert.equal(process.argv.length, 3, 'Usage: node operator/receiving_water_browser.mjs PRIVATE_CONTROL.json');
const controlPath = path.resolve(process.argv[2]);
const c = JSON.parse(await fs.readFile(controlPath, 'utf8'));
assert.ok(c.ready_file && c.output && (c.plan_id || c.analysis_id),
  'Select the original operator ready JSON, output directory and saved plan or analysis.');
const readyText = await fs.readFile(path.resolve(c.ready_file), 'utf8');
let ready;
try { ready = JSON.parse(readyText); }
catch {
  for (const line of readyText.split(/\r?\n/).reverse()) {
    try { const value = JSON.parse(line); if (value.operator_url) { ready = value; break; } }
    catch {}
  }
}
assert.ok(ready?.operator_url, 'The original server ready file has no current operator URL.');
const operatorURL = new URL(ready.operator_url);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(operatorURL.hostname),
  'Use the ready JSON from the existing local operator.');
const origin = operatorURL.origin;
const capability = new URLSearchParams(operatorURL.hash.slice(1)).get('token');
assert.ok(capability, 'The existing operator ready JSON must contain its capability.');
const workspace = c.workspace_key || ready.workspace_key;
assert.ok(workspace, 'Select the existing operator workspace.');
const output = path.resolve(c.output);
await fs.mkdir(output, {recursive: true, mode: 0o700});
const progress = path.join(output, 'receiving-water-browser.json');
const caseHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const selection = {workspace, plan_id: c.plan_id || null, analysis_id: c.analysis_id || null,
  subjects: c.subjects || null, paper: c.paper || 'letter', dpi: c.dpi || 220};
assert.ok(['letter', 'a4'].includes(selection.paper) && [150, 220, 300].includes(selection.dpi),
  'Choose the original supported map paper and resolution.');
const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const applicationNames = ['operator/receiving_water_browser.mjs', 'operator/server.py',
  'operator/web/app.mjs', 'operator/web/receiving_waters.mjs',
  'operator/web/receiving_water_spatial.mjs', 'operator/web/spatial.mjs',
  'model/receiving_water_spatial.py', 'model/spatial.py', 'model/spatial_exports.py',
  'model/cartography.py', 'model/rasters.py'];
const applicationFiles = await Promise.all(applicationNames.map(async name =>
  ({name, ...await fileRecord(path.join(applicationRoot, name))})));
const applicationIdentity = caseHash(applicationFiles.map(({name, bytes, sha256}) => ({name, bytes, sha256})));
const identity = caseHash({selection, application_identity: applicationIdentity});
let report;
try { report = JSON.parse(await fs.readFile(progress, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  report = {schema: 'upstate.receiving-water-browser-result/v1', identity, selection,
    stages: {}, cases: {}, attempts: []};
}
assert.equal(report.identity, identity, 'Keep each original receiving selection and application edition in its own output directory.');
const attempt = {started_at: new Date().toISOString(), page_errors: [], http_errors: []};
report.attempts.push(attempt);
report.complete = false;
report.application_identity = applicationIdentity;
report.application_files = applicationFiles;
const deadlineSeconds = c.task_timeout_seconds || 1800;
assert.ok(Number.isSafeInteger(deadlineSeconds) && deadlineSeconds > 0, 'Use a positive task observation duration.');
async function checkpoint() {
  const temporary = progress + '.' + randomUUID() + '.pending';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(report, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await fs.rename(temporary, progress);
  } finally { await fs.rm(temporary, {force: true}); }
}
async function fileRecord(filename) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); bytes += chunk.length; }
  return {path: path.resolve(filename), bytes, sha256: hash.digest('hex')};
}
await checkpoint();
const modules = c.node_modules || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
let chromium, browser, context, page;
const endpoint = (route, values = {}) => route + '?' + new URLSearchParams({workspace, ...values});
async function api(route, body) {
  const response = await context.request.fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Authorization: 'Bearer ' + capability, 'Content-Type': 'application/json'},
    data: body, timeout: 60000
  });
  const value = await response.json();
  assert.ok(response.ok(), JSON.stringify({route: new URL(origin + route).pathname, status: response.status(), value}));
  return value;
}
async function openBrowserContext() {
  context = await browser.newContext({viewport: {width: 1440, height: 1080},
    acceptDownloads: true, timezoneId: 'America/New_York'});
  await context.addInitScript(({origin, workspace}) => {
    if (location.origin === origin) sessionStorage.setItem('upstate-selected-workspace', workspace);
  }, {origin, workspace});
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => attempt.page_errors.push(String(error)));
  page.on('response', response => {
    if (response.url().startsWith(origin + '/api/') && response.status() >= 400)
      attempt.http_errors.push({status: response.status(), path: new URL(response.url()).pathname});
  });
  for (const file of applicationFiles.filter(row => row.name.startsWith('operator/web/'))) {
    const response = await context.request.get(origin + '/web/' + path.basename(file.name));
    assert.ok(response.ok(), 'Open the current original operator web source: ' + file.name);
    const body = await response.body();
    assert.equal(body.length, file.bytes, 'Served browser source differs: ' + file.name);
    assert.equal(createHash('sha256').update(body).digest('hex'), file.sha256,
      'Served browser source differs: ' + file.name);
  }
  await page.goto(operatorURL.href, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(key => document.querySelector('#workspace-select')?.value === key, workspace);
  const state = await api(endpoint('/api/state'));
  assert.equal(state.workspace_key, workspace);
  if (report.project_id) assert.equal(state.data.project.id, report.project_id);
  report.project_id = state.data.project.id;
  return state;
}
async function closeDialogs() {
  for (const [dialog, action] of [['#form-dialog', 'form-close'], ['#detail-dialog', 'detail-close']]) {
    if (await page.locator(dialog).evaluate(node => node.open))
      await page.locator(dialog + ' [data-action="' + action + '"]').first().click();
  }
}
async function navigate(view) {
  await closeDialogs();
  await page.locator('[data-view="' + view + '"]').first().click();
  await page.waitForFunction(value => document.querySelector('[data-view="' + value + '"]')?.getAttribute('aria-current') === 'page', view);
}
const attr = (name, value) => '[' + name + '=' + JSON.stringify(String(value)) + ']';
async function openWater(kind, id) {
  await navigate('receiving-waters');
  await page.locator('[data-action="water-open"]' + attr('data-kind', kind) + attr('data-id', id)).click();
  await page.locator('#water-selected' + attr('data-water-record-kind', kind)
    + attr('data-water-record-id', id) + '[aria-busy="false"] h2').waitFor();
}
async function readyMap() {
  await page.waitForFunction(() => {
    const error = document.querySelector('[data-spatial-error]');
    return (error && !error.hidden) || /^Map ready · /.test(document.querySelector('[data-spatial-status]')?.textContent || '');
  }, null, {timeout: deadlineSeconds * 1000});
  const message = await page.locator('[data-spatial-error]').evaluate(node => node.hidden ? '' : node.textContent);
  assert.equal(message, '', message);
}
async function openSavedReview(id, review) {
  const rendered = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/spatial/frame') return false;
    try {
      const request = response.request().postDataJSON();
      assert.deepEqual(request.reference, review.reference);
      assert.deepEqual(request.primary, review.primary);
      assert.deepEqual(request.view, review.view);
      return true;
    } catch { return false; }
  }, {timeout: deadlineSeconds * 1000});
  const [response] = await Promise.all([rendered,
    page.locator('[data-spatial-action="review-open"]' + attr('data-id', id)).click()]);
  assert.ok(response.ok(), 'The reopened original review frame failed to render.');
  await readyMap();
}
async function taskResult(stage) {
  const until = Date.now() + deadlineSeconds * 1000;
  for (;;) {
    const task = await api('/api/task?id=' + encodeURIComponent(stage.task_id));
    assert.equal(task.workspace, workspace);
    stage.state = task.state;
    if (task.state === 'complete') {
      stage.result = task.result; stage.completed_at = task.completed_at || new Date().toISOString();
      await checkpoint(); return task;
    }
    if (task.state === 'interrupted' && stage.request
        && stage.resume_attempt !== report.attempts.length) {
      assert.equal(task.action, stage.action);
      assert.deepEqual(task.payload, stage.request.payload);
      stage.resume_attempt = report.attempts.length;
      stage.resumed_at = new Date().toISOString();
      await checkpoint();
      const resumed = await api('/api/task/resume', {id: task.id});
      assert.equal(resumed.id, task.id);
      assert.equal(resumed.workspace, workspace);
      continue;
    }
    if (!['queued', 'running'].includes(task.state)) {
      stage.error = task.error; await checkpoint();
      throw Error('Original ' + stage.action + ' task ' + task.id + ' is ' + task.state + ': ' + JSON.stringify(task.error));
    }
    assert.ok(Date.now() < until, 'Original task remains active; resume the same progress file: ' + task.id);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
async function originalAction(key, action, click) {
  const stage = report.stages[key] ||= {action, created_at: new Date().toISOString()};
  assert.equal(stage.action, action);
  if (!stage.task_id && stage.request) {
    const state = await api(endpoint('/api/state'));
    const task = state.tasks.find(row => row.operation_id === stage.request.operation_id)
      || await api('/api/actions', stage.request);
    stage.task_id = task.id; await checkpoint();
  }
  if (!stage.task_id) {
    const route = '**/api/actions';
    let captured = false;
    const capture = async intercepted => {
      const request = intercepted.request().postDataJSON();
      if (!captured && request.action === action) {
        assert.equal(request.workspace, workspace);
        captured = true; stage.request = request; await checkpoint();
      }
      await intercepted.continue();
    };
    await page.route(route, capture);
    try {
      const response = page.waitForResponse(value => value.url() === origin + '/api/actions'
        && value.request().postDataJSON()?.action === action);
      await click();
      const queued = await response, task = await queued.json();
      assert.ok(queued.ok(), JSON.stringify(task)); assert.ok(task.id && captured);
      stage.task_id = task.id; await checkpoint();
      await page.locator('#detail-dialog[open]').waitFor();
    } finally { await page.unroute(route, capture); }
  }
  return taskResult(stage);
}
async function showTask(id) {
  await closeDialogs();
  if (!(await page.locator('#task-panel').isVisible()))
    await page.locator('[data-action="tasks"]').first().click();
  await page.locator('[data-action="refresh"]').first().click();
  await page.locator('[data-action="task-open"]' + attr('data-id', id)).click();
  await page.locator('#detail-dialog[open]').waitFor();
}
async function download(task, key) {
  await showTask(task.id);
  const current = await api('/api/task?id=' + encodeURIComponent(task.id));
  const ticket = (current._downloads || []).find(row => /\.zip$/i.test(row.filename || ''));
  assert.ok(ticket, 'The completed original map export must expose its complete ZIP.');
  const destination = path.join(output, key + '.zip');
  try {
    const existing = await fileRecord(destination);
    assert.equal(existing.sha256, ticket.sha256); assert.equal(existing.bytes, ticket.bytes);
    return existing;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const transferPromise = page.waitForEvent('download', {timeout: 60000});
  await page.locator('a' + attr('href', ticket.url + '?download=1')).first().click();
  const transfer = await transferPromise;
  assert.equal(await transfer.failure(), null);
  const temporary = destination + '.' + randomUUID() + '.pending';
  try {
    await transfer.saveAs(temporary);
    const actual = await fileRecord(temporary);
    assert.equal(actual.sha256, ticket.sha256); assert.equal(actual.bytes, ticket.bytes);
    const file = await fs.open(temporary, 'r');
    try { await file.sync(); } finally { await file.close(); }
    try { await fs.link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.equal((await fileRecord(destination)).sha256, actual.sha256);
    }
    return {...actual, path: destination};
  } finally { await fs.rm(temporary, {force: true}); }
}
function verifyReview(review, target, catalog) {
  assert.equal(review.project_id, report.project_id);
  assert.equal(review.mode, 'single');
  assert.ok(review.view?.crs && review.view.bounds?.length === 4);
  const layer = selected => catalog.layers.find(row => row.id === selected?.layer_id);
  const reference = layer(review.reference);
  assert.equal(reference?.owner_id, target.id);
  if (target.kind === 'plan') {
    assert.equal(reference.group, 'receiving-water-plan');
    assert.equal(reference.subject_id, target.subject);
    assert.equal(reference.geometry_role, 'contribution');
    assert.equal(review.reference.layer, 'receiving_water');
    assert.equal(review.primary, null);
    assert.equal(review.overlays.length, 2);
    for (const overlay of review.overlays) assert.equal(layer(overlay.selection)?.subject_id, target.subject);
  } else {
    assert.equal(reference.group, 'receiving-water-analysis');
    assert.equal(review.reference.layer, 'receiving_waters');
    if (target.subject)
      assert.deepEqual(review.reference.where, {subject_id: target.subject, kind: target.subject_kind});
    if (target.statistic !== 'areas') {
      const raster = layer(review.primary);
      assert.equal(raster.subject_id, target.subject); assert.equal(raster.subject_kind, target.subject_kind);
      assert.equal(raster.statistic, target.statistic); assert.equal(raster.run_id, target.run_id);
      if (target.quantity) assert.equal(raster.quantity, target.quantity);
      if (target.statistic.endsWith('_priority'))
        assert.deepEqual(review.scale, {mode: 'fixed', minimum: 0, maximum: 1});
    } else assert.equal(review.primary, null);
  }
  assert.ok(review.bindings.some(row => row.receiving_water_plan_id === report.plan_id));
}
async function openTarget(target) {
  await openWater(target.kind, target.id);
  if (target.kind === 'plan' && target.subject) {
    await page.locator('[data-water-filter="family"]').selectOption('');
    await page.locator('[data-water-search]').fill(target.subject);
  }
  if (target.kind === 'analysis' && target.subject) {
    await page.locator('[data-water-filter="kind"]').selectOption(target.subject_kind);
    await page.locator('[data-water-filter="family"]').selectOption('');
    await page.locator('[data-water-search]').fill(target.subject);
    await page.locator('[data-water-filter="run"]').selectOption(target.alternative_run_id || '');
    const quantity = target.statistic === 'increased_export_priority' ? 'increased'
      : target.statistic === 'avoided_export_priority' ? 'avoided' : 'physical';
    await page.locator('[data-water-filter="quantity"]').selectOption(quantity);
    if (target.statistic === 'change') {
      await page.locator('[data-action="water-subject"]' + attr('data-id', target.subject)
        + attr('data-subject-kind', target.subject_kind)).click();
      await page.locator('#detail-dialog[open]').waitFor();
    }
  }
  let selector = '[data-action="spatial-item"]' + attr('data-kind', 'receiving-water-' + target.kind)
    + attr('data-id', target.id) + attr('data-subject', target.subject || '')
    + attr('data-statistic', target.statistic);
  if (target.kind === 'analysis' && target.subject) selector += attr('data-subject-kind', target.subject_kind);
  if (target.quantity) selector += attr('data-quantity', target.quantity);
  if (target.alternative_run_id) selector += attr('data-run', target.alternative_run_id);
  await page.locator(selector).first().click();
  await readyMap();
}
function casesFor(plan, analysis) {
  const selected = subject => !c.subjects || c.subjects.some(row =>
    row.id === subject.id && (!row.kind || row.kind === (subject.kind || 'receptor')));
  const cases = plan.receptors.filter(selected).map(row =>
    ({kind: 'plan', id: plan.id, subject: row.id, subject_kind: 'receptor', statistic: 'areas'}));
  if (analysis) {
    cases.push({kind: 'analysis', id: analysis.id, statistic: 'areas'});
    for (const subject of analysis.subjects.filter(selected)) {
      const base = {kind: 'analysis', id: analysis.id, subject: subject.id, subject_kind: subject.kind};
      const files = subject.metrics.files || {};
      if (files.current_priority) cases.push({...base, statistic: 'current_priority', run_id: analysis.baseline_run_id});
      for (const run of analysis.alternative_run_ids) {
        const value = {...base, run_id: run, alternative_run_id: run};
        for (const statistic of ['current_priority', 'increased_export_priority', 'avoided_export_priority'])
          if (files[run + '_' + statistic]) cases.push({...value, statistic});
        for (const quantity of Object.keys(subject.metrics.baseline_physical || {}))
          if (files[run + '_' + quantity + '_change']) cases.push({...value, statistic: 'change', quantity});
      }
    }
  }
  assert.ok(cases.length, 'Choose existing original receiving areas.');
  return cases;
}
try {
  attempt.stage = 'browser_import';
  ({chromium} = modules
    ? await import(pathToFileURL(path.join(modules, 'playwright/index.mjs')).href)
    : await import('playwright'));
  attempt.stage = 'operator_connection';
  browser = await chromium.launch({headless: true, ...(c.chromium ? {executablePath: c.chromium} : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage']});
  await openBrowserContext();
  attempt.stage = 'source_records';
  const analysis = c.analysis_id ? await api(endpoint('/api/receiving-waters/analysis', {analysis_id: c.analysis_id})) : null;
  if (analysis) assert.equal(analysis.state, 'complete');
  const planId = c.plan_id || analysis.plan_id;
  if (analysis) assert.equal(planId, analysis.plan_id);
  const plan = await api(endpoint('/api/receiving-waters/plan', {plan_id: planId}));
  assert.equal(plan.state, 'complete');
  report.plan_id = plan.id; report.analysis_id = analysis?.id || null;
  const cases = casesFor(plan, analysis); report.total_cases = cases.length;
  const catalog = await api(endpoint('/api/spatial/catalog'));
  report.runtime = await api('/api/runtime');
  await checkpoint();
  attempt.stage = 'operate_maps';
  for (const target of cases) {
    const key = caseHash(target), row = report.cases[key] ||= {target};
    attempt.current_case = key; await checkpoint();
    await openTarget(target);
    const save = await originalAction(key + ':save', 'spatial.review.save',
      () => page.locator('[data-spatial-action="save"]').click());
    row.review_id = save.result.id;
    const review = await api(endpoint('/api/item', {kind: 'spatial_reviews', id: row.review_id}));
    verifyReview(review, target, catalog);
    row.bindings = review.bindings; row.view = review.view;
    await navigate('spatial');
    await openSavedReview(row.review_id, review);
    await page.locator('[data-spatial-input="export-review"]').selectOption(row.review_id);
    await page.locator('[data-spatial-input="export-paper"]').selectOption(selection.paper);
    await page.locator('[data-spatial-input="export-dpi"]').selectOption(String(selection.dpi));
    const exported = await originalAction(key + ':export', 'spatial.review.export',
      () => page.locator('[data-spatial-action="export-create"]').click());
    row.export_id = exported.result.id;
    row.archive = await download(exported, key);
    await closeDialogs();
    const screenshot = path.join(output, key + '-attempt-' + report.attempts.length + '.png');
    await page.screenshot({path: screenshot, fullPage: true});
    row.screenshot = await fileRecord(screenshot);
    row.saved_and_exported = true; await checkpoint();
  }
  attempt.stage = 'cold_reopen';
  await context.close(); context = null;
  await openBrowserContext();
  const reopenedCatalog = await api(endpoint('/api/spatial/catalog'));
  await navigate('spatial');
  for (const row of Object.values(report.cases)) {
    const review = await api(endpoint('/api/item', {kind: 'spatial_reviews', id: row.review_id}));
    await openSavedReview(row.review_id, review);
    verifyReview(review, row.target, reopenedCatalog);
    assert.deepEqual(review.bindings, row.bindings);
    assert.deepEqual(review.view, row.view);
    row.cold_reopened = true; await checkpoint();
  }
  assert.deepEqual(attempt.page_errors, []);
  assert.deepEqual(attempt.http_errors, []);
  attempt.complete = true; attempt.completed_at = new Date().toISOString();
  report.complete = true; await checkpoint();
  console.log(JSON.stringify({complete: true, project_id: report.project_id, plan_id: report.plan_id,
    analysis_id: report.analysis_id, cases: cases.length, progress}));
} catch (error) {
  attempt.error = {name: error.name, message: error.message, stack: error.stack};
  attempt.completed_at = new Date().toISOString(); await checkpoint(); throw error;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
}
