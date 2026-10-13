#!/usr/bin/env node
/**
 * Operate the original Profile workbench with Playwright and retain screenshots.
 * Run from the cumulative application root, with Playwright and Chromium installed.
 * The private original-operator URL stays local; reports contain scientific source URLs.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  url: { type: 'string' }, 'url-file': { type: 'string' }, profile: { type: 'string' },
  workspace: { type: 'string' }, output: { type: 'string' }, 'run-label': { type: 'string' },
  headed: { type: 'boolean', default: false }, video: { type: 'boolean', default: false },
  'browser-channel': { type: 'string' }, 'browser-executable': { type: 'string' }, help: { type: 'boolean', default: false },
} });
if (args.help) {
  process.stdout.write('Usage: node source/run_profile_workbench_browser.mjs --url-file PRIVATE_URL_FILE --profile BASELINE_PROFILE_ID [--workspace ID] [--output DIRECTORY] [--video] [--headed] [--browser-channel NAME | --browser-executable PATH]\nECO_OPERATOR_URL or --url also supplies the original private operator URL. Only use a retained 15-row baseline with code 82 usle_c=0.20.\n');
  process.exit(0);
}
const sourceURL = 'https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf';
const runLabel = args['run-label'] || new Date().toISOString().replace(/[:.]/g, '-');
let title = 'Working source alternative · Cape Fear corn C=0.25 · ' + runLabel;
const output = resolve(args.output || join('artifacts', 'profile-workbench', runLabel));
const journal = {
  schema: 'upstate.profile-workbench-journey/v1', started_at: new Date().toISOString(),
  status: 'running', baseline_profile_id: args.profile || null, title,
  scientific_alternative: {
    lucode: 82, field: 'usle_c', baseline: 0.20, alternative: 0.25,
    source: sourceURL, doi: '10.1016/j.scitotenv.2016.12.103',
    location: 'PDF page 13 / printed page 14, Cape Fear corn', review_state: 'working',
  },
  steps: [], screenshots: [], browser_errors: [],
};
let browser, context, page, privateURL = '', origin = '', capability = '', journalWritable = false;
const reportPath = join(output, 'journey.json');
const redact = value => {
  let result = String(value);
  for (const secret of [privateURL, capability, origin].filter(Boolean)) result = result.split(secret).join('[private operator]');
  return result.replace(/#token=[^\s"'<>]+/g, '#token=[redacted]');
};
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
function browserRuntime() {
  requireValue(!(args['browser-channel'] && args['browser-executable']),
    'Choose a browser channel or an explicit executable path.');
  return { kind: args['browser-executable'] ? 'executable' : args['browser-channel'] ? 'channel' : 'bundled',
    executable_path: args['browser-executable'] ? resolve(args['browser-executable']) : null,
    channel: args['browser-channel'] || null, headless: !args.headed };
}
const bodyOf = response => { try { return response.request().postDataJSON() || {}; } catch { return {}; } };
const isRead = (operation, criteria = {}) => response => {
  if (new URL(response.url()).pathname !== '/api/profile-workbench/' + operation) return false;
  const body = bodyOf(response);
  return Object.entries(criteria).every(([key, value]) => body[key] === value);
};
async function nativeJSON(response, label) {
  requireValue(response.ok(), label + ' returned HTTP ' + response.status());
  const value = await response.json();
  requireValue(!value.error, label + ': ' + redact(value.error?.message || value.error || ''));
  return value;
}
async function clickRead(locator, operation, criteria = {}) {
  const response = page.waitForResponse(isRead(operation, criteria));
  await locator.click();
  return nativeJSON(await response, operation);
}
const profileButton = id => page.locator('[data-pw-library] [data-pw-action="open"][data-pw-id=' + JSON.stringify(id) + ']');
async function deskReady() {
  const navigation = page.locator('[data-view="profile-workbench"]');
  await navigation.waitFor({ state: 'visible' });
  if (!(await page.locator('.profile-workbench [data-pw-library]').isVisible())) {
    const catalog = page.waitForResponse(isRead('catalog'));
    await navigation.click();
    await nativeJSON(await catalog, 'profile catalog');
  }
  await page.locator('.profile-workbench [data-pw-library]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const message = document.querySelector('.profile-workbench [data-pw-message]')?.textContent || '';
    return !/^(Reading saved scientific profiles|Opening the saved profile)/.test(message);
  });
}
async function changeWorkspace(id) {
  const select = page.locator('#workspace-select');
  if (await select.inputValue() === id) return;
  const stateResponse = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/state' || !response.ok()) return false;
    try { return (await response.json()).workspace_key === id; } catch { return false; }
  });
  await select.selectOption(id);
  await stateResponse;
  await deskReady();
  await page.waitForFunction(expected => document.querySelector('#workspace-select')?.value === expected, id);
}
async function findBaseline() {
  if (args.workspace) await changeWorkspace(args.workspace);
  await deskReady();
  if (await profileButton(args.profile).count()) return;
  if (!args.workspace) {
    const choices = await page.locator('#workspace-select option').evaluateAll(nodes =>
      nodes.filter(node => node.value && !node.disabled).map(node => node.value));
    for (const id of choices) {
      await changeWorkspace(id);
      if (await profileButton(args.profile).count()) return;
    }
  }
  throw Error('The retained baseline profile was not found in the available workspace choices.');
}
async function shot(name, focus) {
  if (focus) await page.locator(focus).scrollIntoViewIfNeeded();
  const path = join(output, name + '.png');
  await page.screenshot({ path, fullPage: !focus, animations: 'disabled' });
  journal.screenshots.push(relative(output, path));
}
function row82(record) { return record.table.rows.find(row => Number(row.lucode) === 82); }
function assertSaved(record) {
  requireValue(record.profile_id === journal.saved_profile_id, 'The reopened profile ID differs from the saved revision.');
  requireValue(record.table.rows.length === 15, 'The saved coefficient table changed the retained row count.');
  requireValue(Number(row82(record)?.usle_c) === 0.25, 'The saved code 82 coefficient is not 0.25.');
  requireValue(record.review_state?.status === 'working', 'The new revision did not retain its working review state.');
  requireValue(Boolean(record.table.sha256), 'The reopened native table did not supply its retained SHA-256.');
}

async function writeJournal() {
  if (!journalWritable) return;
  const pending = join(output, '.journey.pending.json');
  await writeFile(pending, redact(JSON.stringify(journal, null, 2)) + '\n', { mode: 0o600 });
  await rename(pending, reportPath);
}
async function continueJournal() {
  const runtime = browserRuntime();
  let previous;
  try { previous = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    requireValue(previous.schema === journal.schema && previous.baseline_profile_id === args.profile,
      'This output retains another original profile journey.');
    requireValue(!args.workspace || !previous.workspace_id || previous.workspace_id === args.workspace,
      'Continue the saved profile journey in its original workspace.');
    requireValue(!args['run-label'] || previous.title === title,
      'Continue the saved profile journey with its original run label.');
    title = previous.title;
    const attempts = [...(previous.attempts || []), {
      started_at: previous.started_at, ended_at: previous.completed_at || null,
      status: previous.status, error: previous.error || null,
      browser_errors: previous.browser_errors || [],
      browser_runtime: previous.browser_runtime || null,
    }];
    Object.assign(journal, previous, { title, status: 'running',
      started_at: new Date().toISOString(), attempts, browser_errors: [] });
    delete journal.error; delete journal.completed_at;
  }
  journal.browser_runtime = runtime;
  journalWritable = true;
  await writeJournal();
}
function validSave(request) {
  requireValue(request?.workspace === journal.workspace_id &&
    request.action === 'profile.edition.save' &&
    request.payload?.base_profile_id === args.profile &&
    typeof request.operation_id === 'string',
    'The retained save request belongs to another original profile selection.');
}
async function taskJSON(response, label) {
  requireValue(response.ok(), label + ' returned HTTP ' + response.status());
  const value = await response.json();
  requireValue(value.id && value.action === 'profile.edition.save' &&
    value.workspace === journal.workspace_id && value.payload?.base_profile_id === args.profile,
    label + ' did not return the selected original profile task.');
  if (journal.save_request) {
    requireValue(value.operation_id === journal.save_request.operation_id,
      'The native task has a different original save operation.');
  }
  return value;
}
async function continueSavedProfile() {
  const headers = { Authorization: 'Bearer ' + capability };
  let task;
  if (journal.save_request) validSave(journal.save_request);
  if (journal.save_task_id) {
    task = await taskJSON(await page.request.get(origin + '/api/task?id=' +
      encodeURIComponent(journal.save_task_id), { headers, maxRedirects: 0 }), 'Read retained profile save');
    requireValue(task.id === journal.save_task_id, 'The native operator returned another retained task.');
  } else {
    task = await taskJSON(await page.request.post(origin + '/api/actions',
      { headers, data: journal.save_request, maxRedirects: 0 }), 'Continue retained profile save');
    journal.save_task_id = task.id;
    await writeJournal();
  }
  if (['failed', 'interrupted', 'cancelled'].includes(task.state)) {
    task = await taskJSON(await page.request.post(origin + '/api/task/resume',
      { headers, data: { id: task.id }, maxRedirects: 0 }), 'Resume original profile save');
  }
  const deadline = Date.now() + 180000;
  while (task.state !== 'complete') {
    requireValue(!['failed', 'interrupted', 'cancelled'].includes(task.state),
      'Original profile save is ' + task.state + ': ' + redact(task.error?.message || task.id));
    requireValue(Date.now() < deadline, 'Original profile save remains active: ' + task.id);
    await page.waitForTimeout(1000);
    task = await taskJSON(await page.request.get(origin + '/api/task?id=' + encodeURIComponent(task.id),
      { headers, maxRedirects: 0 }), 'Observe original profile save');
  }
  requireValue(task.result?.profile_id && task.result.profile_id !== args.profile,
    'The original save has no retained working profile edition.');
  if (journal.saved_profile_id) requireValue(journal.saved_profile_id === task.result.profile_id,
    'The original save reopened another profile edition.');
  journal.saved_profile_id = task.result.profile_id;
  journal.steps.push({ step: 'Continue original saved working profile',
    task_id: task.id, profile_id: journal.saved_profile_id });
  await writeJournal();
}

async function main() {
  await mkdir(output, { recursive: true });
  requireValue(args.profile && /^[A-Za-z0-9_.:-]+$/.test(args.profile), 'Supply the actual retained baseline profile ID with --profile.');
  await continueJournal();
  privateURL = (args['url-file'] ? await readFile(args['url-file'], 'utf8') : args.url || process.env.ECO_OPERATOR_URL || '').trim();
  requireValue(privateURL, 'Supply the original private operator URL through --url-file, --url or ECO_OPERATOR_URL.');
  let parsed;
  try { parsed = new URL(privateURL); } catch { throw Error('The private operator URL is not a valid URL.'); }
  requireValue(['http:', 'https:'].includes(parsed.protocol), 'The operator URL must use HTTP or HTTPS.');
  origin = parsed.origin; capability = new URLSearchParams(parsed.hash.slice(1)).get('token') || '';
  requireValue(capability, 'Use the original operator startup URL containing its capability fragment.');
  browser = await chromium.launch({ headless: !args.headed,
    ...(args['browser-channel'] ? { channel: args['browser-channel'] } : {}),
    ...(args['browser-executable'] ? { executablePath: resolve(args['browser-executable']) } : {}) });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, locale: 'en-US',
    ...(args.video ? { recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 1000 } } } : {}),
  });
  // Retain the original UI request before it crosses the network. A lost
  // response can then reuse the same operation rather than saving a new edition.
  await context.route('**/api/actions', async route => {
    const request = route.request().postDataJSON();
    if (request?.action === 'profile.edition.save') {
      validSave(request);
      requireValue(!journal.save_request, 'Continue the already-retained profile save.');
      journal.save_request = request;
      await writeJournal();
    }
    await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', error => { if (journal.browser_errors.length < 20) journal.browser_errors.push(redact(error.message)); });
  await page.goto(privateURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#workspace-select').waitFor({ state: 'visible' });
  await findBaseline();
  const selectedWorkspace = await page.locator('#workspace-select').inputValue();
  requireValue(!journal.workspace_id || journal.workspace_id === selectedWorkspace,
    'The retained profile journey opened another workspace.');
  journal.workspace_id = selectedWorkspace;
  await writeJournal();
  const baseline = await clickRead(profileButton(args.profile), 'inspect', { profile_id: args.profile });
  requireValue(baseline.profile_id === args.profile, 'The native inspector returned a different baseline profile.');
  requireValue(Array.isArray(baseline.table?.rows) && baseline.table.rows.length === 15, 'The selected baseline is not the retained 15-row reference table.');
  requireValue(Number(row82(baseline)?.usle_c) === 0.20, 'The selected reference does not contain code 82 usle_c=0.20.');
  requireValue(!journal.baseline_table_sha256 || journal.baseline_table_sha256 === baseline.table.sha256,
    'The original baseline coefficient table changed during continuation.');
  journal.baseline_table_sha256 = baseline.table.sha256;
  journal.steps.push({ step: 'Open retained baseline', profile_id: baseline.profile_id, rows: 15, lucode: 82, usle_c: row82(baseline).usle_c });
  await page.locator('[data-pw-action="revise"]').waitFor({ state: 'visible' });
  await shot('01-original-profile');
  await writeJournal();

  if (journal.save_request || journal.save_task_id) {
    await continueSavedProfile();
  } else {
  await page.locator('[data-pw-action="revise"]').click();
  await page.locator('[data-pw-field="profile.title"]').fill(title);
  const references = page.locator('[data-pw-field="profile.references"]');
  const existingReferences = (await references.inputValue()).trim();
  await references.fill(existingReferences + '\nHamel et al. (2017), DOI 10.1016/j.scitotenv.2016.12.103; Cape Fear corn USLE C=0.25, PDF p.13 / printed p.14. ' + sourceURL);
  await page.locator('[data-pw-field="revision.author"]').fill('TokenJunkieLabs engineering');
  await page.locator('[data-pw-field="revision.title"]').fill('Hamel et al. 2017 · Cape Fear corn working source alternative');
  await page.locator('[data-pw-field="revision.vintage"]').fill('Hamel et al. 2017 published source');
  await page.locator('[data-pw-field="revision.reason"]').fill('Evaluate the published Cape Fear corn USLE C=0.25 as a working source alternative to the retained regional cropland code 82 C=0.20. Preserve all other coefficient cells, row identities and source descriptions.');
  const cell = page.locator('input[aria-label="usle_c, land-cover code 82"]');
  await cell.waitFor({ state: 'visible' });
  await cell.fill('-0.01');
  const validity = await cell.evaluate(node => ({ valid: node.validity.valid, message: node.validationMessage, min: node.min, max: node.max }));
  let invalidNative = null;
  if (validity.valid) {
    invalidNative = await clickRead(page.locator('[data-pw-action="preview"]'), 'preview');
    requireValue(invalidNative.valid === false, 'The negative native USLE C coefficient was unexpectedly accepted.');
  } else {
    await page.locator('[data-pw-action="preview"]').click();
  }
  requireValue(await page.locator('[data-pw-action="save"]').isDisabled(), 'Save remained enabled for an invalid coefficient.');
  journal.steps.push({ step: 'Correct invalid coefficient', field: 'usle_c', lucode: 82, rejected_value: '-0.01',
    browser_rejected: !validity.valid, validation_message: validity.message, native_errors: invalidNative?.errors || [] });
  await shot('02-invalid-coefficient', '[data-pw-table-editor]');
  await cell.fill('0.25');
  const preview = await clickRead(page.locator('[data-pw-action="preview"]'), 'preview');
  requireValue(preview.valid === true, 'The native materializer rejected the corrected working source alternative: ' + JSON.stringify(preview.errors || []));
  const plannedChanges = preview.diff?.table?.changed || [];
  requireValue(plannedChanges.length === 1 && Number(plannedChanges[0].lucode) === 82 && plannedChanges[0].column === 'usle_c',
    'The preview does not contain exactly the intended code 82 USLE C change.');
  journal.steps.push({ step: 'Review native selection', valid: preview.valid, table_changes: plannedChanges, coverage: preview.coverage });
  await page.locator('[data-pw-action="save"]').waitFor({ state: 'visible' });
  await shot('03-native-preview', '[data-pw-preview]');

  const saveResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/actions' && bodyOf(response).action === 'profile.edition.save');
  await page.locator('[data-pw-action="save"]').click();
  const task = await nativeJSON(await saveResponse, 'save working profile');
  journal.save_task_id = task.id;
  await writeJournal();
  const savedButton = page.locator('[data-pw-library] [data-pw-action="open"]').filter({ has: page.getByText(title, { exact: true }) });
  await savedButton.waitFor({ state: 'visible', timeout: 180000 });
  journal.saved_profile_id = await savedButton.getAttribute('data-pw-id');
  requireValue(journal.saved_profile_id && journal.saved_profile_id !== args.profile, 'The saved revision did not acquire its own native profile ID.');
  journal.steps.push({ step: 'Save working source alternative', task_id: task.id, profile_id: journal.saved_profile_id });
  await writeJournal();
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#workspace-select').waitFor({ state: 'visible' });
  await deskReady();
  const reopened = await clickRead(profileButton(journal.saved_profile_id), 'inspect', { profile_id: journal.saved_profile_id });
  assertSaved(reopened);
  journal.saved_table_sha256 = reopened.table.sha256;
  journal.steps.push({ step: 'Reopen saved revision', profile_id: reopened.profile_id, table_sha256: reopened.table.sha256,
    review_state: reopened.review_state, rows: reopened.table.rows.length, lucode: 82, usle_c: row82(reopened).usle_c });
  await page.locator('[data-pw-reference]').waitFor({ state: 'visible' });
  await shot('04-saved-reopened-profile');
  await writeJournal();

  await page.locator('[data-pw-reference]').selectOption(args.profile);
  const comparison = await clickRead(page.locator('[data-pw-action="compare"]'), 'compare',
    { left_profile_id: args.profile, right_profile_id: journal.saved_profile_id });
  const changes = comparison.diff?.table?.changed || [];
  requireValue(changes.length === 1 && Number(changes[0].lucode) === 82 && changes[0].column === 'usle_c'
    && Number(changes[0].before) === 0.20 && Number(changes[0].after) === 0.25,
    'The reopened comparison differs from the intended source alternative.');
  requireValue(!(comparison.diff?.table?.added || []).length && !(comparison.diff?.table?.removed || []).length,
    'The reopened comparison changed native land-cover row identities.');
  journal.steps.push({ step: 'Compare reopened revision', left_profile_id: args.profile, right_profile_id: journal.saved_profile_id, diff: comparison.diff });
  await page.locator('[data-pw-comparison] h3').waitFor({ state: 'visible' });
  await shot('05-saved-revision-comparison', '[data-pw-comparison]');
  requireValue(journal.browser_errors.length === 0, 'The browser reported an application error; inspect the retained journey report.');
  journal.status = 'complete';
}
try {
  await main();
} catch (error) {
  journal.status = 'failed'; journal.error = redact(error.message || error);
  if (page && await page.locator('.profile-workbench [data-pw-main]').isVisible().catch(() => false)) {
    await shot('failure-current-workbench').catch(() => {});
  }
  process.exitCode = 1;
} finally {
  const video = page?.video();
  await context?.close().catch(() => {});
  if (args.video && video) {
    try { const path = await video.path(); const destination = join(output, 'profile-workbench-journey.webm'); await rename(path, destination); journal.video = relative(output, destination); }
    catch (error) { journal.video_error = redact(error.message || error); }
  }
  await browser?.close().catch(() => {});
  journal.completed_at = new Date().toISOString();
  await mkdir(output, { recursive: true });
  const report = reportPath;
  await writeJournal();
  process.stdout.write(JSON.stringify({ status: journal.status, report, saved_profile_id: journal.saved_profile_id || null }) + '\n');
}
