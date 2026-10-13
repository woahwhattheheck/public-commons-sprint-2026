#!/usr/bin/env node
/** Reopen an actual received scientific report through its original Sources desk. */
import { createRequire } from 'node:module';
import { runAssessmentReceivingChapter } from './assessment_browser.mjs';

// The installed application can be separate from the runtime's Node packages.
// Resolve the application's normal package first; use the explicit runtime-owned
// module directory only when that package cannot be resolved.
const requirePackage = createRequire(import.meta.url);
let playwrightModule;
try {
  playwrightModule = requirePackage.resolve('playwright');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  const directory = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!directory) throw new Error(
    'Install Playwright for this application or set CODEX_PRIMARY_RUNTIME_NODE_MODULES ' +
    'to the existing runtime Node module directory.', { cause: error });
  playwrightModule = requirePackage.resolve(resolve(directory, 'playwright'));
}
const { chromium } = requirePackage(playwrightModule);

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  'url-file': { type: 'string' }, 'receiving-receipt': { type: 'string' },
  output: { type: 'string' }, 'browser-channel': { type: 'string' },
  'assessment-preparation': { type: 'string' },
  headed: { type: 'boolean', default: false }, video: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (args.help) {
  process.stdout.write('Usage: node source/observed-report-20261013/receive_browser.mjs --url-file PRIVATE_OPERATOR_URL_FILE --receiving-receipt scientific-report-receiving.json --output DIRECTORY [--assessment-preparation ORIGINAL_PREPARATION_DIRECTORY] [--video] [--headed] [--browser-channel CHANNEL]\n');
  process.exit(0);
}
const output = resolve(args.output || 'scientific-report-browser');
const journal = {
  schema: 'upstate.scientific-report-browser/v1', started_at: new Date().toISOString(),
  state: 'running', steps: [], downloads: [], screenshots: [], browser_errors: [],
};
let browser, context, page, privateURL = '', origin = '', capability = '';
const actionRequests = [];
const requireValue = (value, message) => { if (!value) throw Error(message); };
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function redact(value) {
  let text = String(value);
  for (const secret of [privateURL, capability, origin].filter(Boolean))
    text = text.split(secret).join('[private operator]');
  return text.replace(/#token=[^\s"'<>]+/g, '#token=[redacted]');
}
const choices = rows => rows.map(({ source_collection_id, source_id }) => ({ source_collection_id, source_id }));
function responseAt(path, id) {
  return response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === path && (!id || url.searchParams.get('id') === id);
  };
}
async function originalJSON(response, label) {
  requireValue(response.ok(), label + ' returned HTTP ' + response.status());
  const value = await response.json();
  requireValue(!value.error, label + ': ' + redact(value.error?.message || value.error || ''));
  return value;
}
async function fileIdentity(path) {
  const checksum = createHash('sha256'); let bytes = 0;
  for await (const part of createReadStream(path)) { checksum.update(part); bytes += part.length; }
  return { bytes, sha256: checksum.digest('hex') };
}
async function shot(name, focus) {
  if (focus) await page.locator(focus).scrollIntoViewIfNeeded();
  const path = join(output, name + '.png');
  await page.screenshot({ path, fullPage: !focus, animations: 'disabled' });
  journal.screenshots.push(relative(output, path));
}
async function sourcesDesk(workspace) {
  await page.locator('#workspace-select').waitFor({ state: 'visible' });
  if (await page.locator('#workspace-select').inputValue() !== workspace) {
    const pending = page.waitForResponse(async response => {
      if (!responseAt('/api/state')(response) || !response.ok()) return false;
      try { return (await response.json()).workspace_key === workspace; } catch { return false; }
    });
    await page.locator('#workspace-select').selectOption(workspace);
    await pending;
  }
  await page.locator('[data-view="sources"]').click();
  await page.locator('.scientific-report-editions').waitFor({ state: 'visible' });
}
async function openEdition(receipt) {
  const pending = page.waitForResponse(responseAt('/api/source-reports/scientific-edition', receipt.edition_id));
  await page.locator('[data-scientific-report-action="open"][data-id="' + receipt.edition_id + '"]').click();
  const detail = await originalJSON(await pending, 'Saved scientific report');
  requireValue(detail.workspace_key === receipt.restored_workspace_key &&
    canonical(detail.edition) === canonical(receipt.edition),
    'The Sources desk opened a different report edition or Workspace.');
  await page.locator('[data-scientific-report-detail]').waitFor({ state: 'visible' });
  const frame = page.frameLocator('[data-scientific-report-detail] iframe');
  await frame.locator('h1').waitFor({ state: 'visible' });
  requireValue((await frame.locator('h1').innerText()).trim() === receipt.title,
    'The report frame changed the retained title.');
  journal.steps.push({ action: 'open_saved_report', edition_id: detail.edition.id,
    workspace_key: detail.workspace_key, source_count: detail.edition.source_count });
  return detail;
}
async function download(locator, expected, filename, role) {
  const pending = page.waitForEvent('download');
  await locator.click();
  const item = await pending, path = join(output, 'downloads', filename);
  await item.saveAs(path);
  requireValue(!(await item.failure()), 'The original report download failed: ' + role);
  const actual = await fileIdentity(path);
  requireValue(actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
    'The browser download changed the original ' + role + '.');
  journal.downloads.push({ role, path: relative(output, path), ...actual });
}
async function preview(expected, workspace) {
  const pending = page.waitForResponse(responseAt('/api/source-reports/scientific-preview'));
  await page.locator('[data-scientific-report-action="preview"]').click();
  const value = await originalJSON(await pending, 'Ordered report source preview');
  requireValue(value.workspace_key === workspace &&
    canonical(choices(value.sources)) === canonical(expected),
    'The composer preview changed its displayed original source order.');
  journal.steps.push({ action: 'preview_ordered_sources', sources: choices(value.sources),
    source_count: value.source_count });
  return value;
}
async function main() {
  requireValue(args['url-file'] && args['receiving-receipt'],
    'Provide the original private operator URL file and completed native receiving receipt.');
  await mkdir(join(output, 'downloads'), { recursive: true });
  const receipt = JSON.parse(await readFile(resolve(args['receiving-receipt']), 'utf8'));
  requireValue(receipt.schema === 'upstate.scientific-report-receiving-workflow/v1' &&
    receipt.state === 'complete' && receipt.edition?.id === receipt.edition_id &&
    receipt.browser_handoff?.workspace_key === receipt.restored_workspace_key,
    'Choose the completed original report receiving operation.');
  journal.operation_id = receipt.operation_id;
  journal.project_id = receipt.project_id;
  journal.edition_id = receipt.edition_id;
  journal.workspace_key = receipt.restored_workspace_key;
  privateURL = (await readFile(resolve(args['url-file']), 'utf8')).trim();
  const url = new URL(privateURL);
  requireValue(['http:', 'https:'].includes(url.protocol), 'Use the actual operator HTTP or HTTPS URL.');
  origin = url.origin;
  capability = new URLSearchParams(url.hash.slice(1)).get('token') || '';
  browser = await chromium.launch({ headless: !args.headed,
    ...(args['browser-channel'] ? { channel: args['browser-channel'] } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    acceptDownloads: true, ...(args.video ? {
      recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 1000 } }
    } : {}) });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => journal.browser_errors.push(redact(error.message)));
  page.on('request', request => {
    if (request.method() === 'POST' && responseAt('/api/actions')({ url: () => request.url() })) {
      let body; try { body = request.postDataJSON(); } catch { body = {}; }
      actionRequests.push({ action: body.action || null, operation_id: body.operation_id || null });
    }
  });
  await page.goto(privateURL, { waitUntil: 'domcontentloaded' });
  if (args['assessment-preparation']) {
    journal.assessment_chapter = await runAssessmentReceivingChapter({
      page, preparationDirectory: args['assessment-preparation'], receivingReceipt: receipt,
      outputDirectory: join(output, 'assessment'), operatorURL: privateURL, redact,
    });
  }
  const reportActionStart = actionRequests.length;
  await sourcesDesk(receipt.restored_workspace_key);
  const detail = await openEdition(receipt);
  await shot('01-reopened-scientific-report', '[data-scientific-report-detail]');
  for (const role of ['report_pdf', 'report_html', 'report_markdown', 'report_data']) {
    const member = detail.files.find(row => row.role === role);
    requireValue(member, 'The saved report omitted ' + role);
    const row = page.locator('[data-scientific-report-files] tbody tr, [data-scientific-report-detail] tbody tr')
      .filter({ has: page.getByRole('cell', { name: member.path, exact: true }) });
    await download(row.getByRole('link', { name: 'Download', exact: true }), member,
      member.path.split('/').pop(), role);
  }
  requireValue(detail.archive, 'The completed report ZIP is absent from the received edition.');
  await download(page.getByRole('link', { name: 'Download report ZIP', exact: true }),
    receipt.report_archive, 'scientific-report.zip', 'complete_report_zip');
  await page.locator('[data-scientific-report-action="revise"]').click();
  requireValue((await page.locator('[data-scientific-report-field="title"]').inputValue()) === receipt.title,
    'Reusing the report changed its title.');
  for (const field of ['name', 'organization', 'email'])
    requireValue((await page.locator('[data-scientific-report-field="' + field + '"]').inputValue()) ===
      String(receipt.render_identity.contact?.[field] ?? ''), 'Reusing the report changed its ' + field + '.');
  await preview(receipt.sources, receipt.restored_workspace_key);
  if (receipt.sources.length > 1) {
    const ordered = receipt.sources.slice();
    [ordered[0], ordered[1]] = [ordered[1], ordered[0]];
    await page.locator('[data-scientific-report-action="down"][data-index="0"]').click();
    await preview(ordered, receipt.restored_workspace_key);
    await page.locator('[data-scientific-report-action="up"][data-index="1"]').click();
    await preview(receipt.sources, receipt.restored_workspace_key);
  }
  await shot('02-ordered-report-composer', '.scientific-report-editions');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sourcesDesk(receipt.restored_workspace_key);
  await preview(receipt.sources, receipt.restored_workspace_key);
  await openEdition(receipt);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('03-received-report-mobile', '[data-scientific-report-detail]');
  journal.mobile_viewport = { width: 390, height: 844 };
  if (receipt.selected_study_receiving) {
    const selected = receipt.selected_study_receiving;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await sourcesDesk(selected.workspace_key);
    await openEdition({ ...receipt, restored_workspace_key: selected.workspace_key });
    await shot('04-selected-study-report', '[data-scientific-report-detail]');
    journal.selected_study = { study_id: selected.study_id, workspace_key: selected.workspace_key,
      retained_records: selected.original_nodes.length, edition_id: selected.edition_id };
  }
  journal.assessment_action_requests = actionRequests.slice(0, reportActionStart);
  journal.action_requests = actionRequests.slice(reportActionStart);
  requireValue(journal.action_requests.length === 0,
    'Reopening the original report unexpectedly submitted a new queued operation.');
  requireValue(journal.browser_errors.length === 0,
    'The original Sources report journey returned a browser error.');
  journal.state = 'complete';
}
try { await main(); }
catch (error) {
  journal.state = 'failed'; journal.error = redact(error?.stack || error);
  if (page && !page.isClosed()) try { await shot('failure-state'); } catch {}
  process.exitCode = 1;
}
finally {
  if (context) await context.close().catch(() => {});
  if (args.video && page?.video()) {
    try {
      const video = await page.video().path(), destination = join(output, 'scientific-report-journey.webm');
      await rename(video, destination); journal.video = relative(output, destination);
    } catch (error) { journal.video_error = redact(error.message); }
  }
  if (browser) await browser.close().catch(() => {});
  journal.finished_at = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'scientific-report-browser.json'), JSON.stringify(journal, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ state: journal.state, output, edition_id: journal.edition_id || null,
    error: journal.error ? redact(journal.error.split('\n')[0]) : null }) + '\n');
}
