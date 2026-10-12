import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const configFile = process.argv[2];
if (!configFile) throw new Error('Pass the original receiving reading-view configuration.');
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
const output = path.resolve(config.output);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const source = {};
for (const key of ['html', 'filtered_html']) {
  const bytes = await fs.readFile(config[key]);
  source[key] = { path: path.resolve(config[key]), bytes: bytes.length, sha256: sha(bytes) };
}
const checkpointFile = path.join(output, 'reading-view-checkpoint.json');
let checkpoint;
try {
  checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
  insist(JSON.stringify(checkpoint.sources) === JSON.stringify(source),
    'The original exported reading view changed; preserve the existing result and select its source deliberately.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  checkpoint = { schema: 'finage.customer-reading-view/v1', sources: source, startedAt: new Date().toISOString(), stages: {}, attempts: [] };
}
checkpoint.attempts.push({ startedAt: new Date().toISOString() });
async function save() {
  const temporary = checkpointFile + '.pending-' + process.pid;
  await fs.writeFile(temporary, JSON.stringify(checkpoint, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, checkpointFile);
}
await save();
const require = createRequire(pathToFileURL(path.resolve(config.playwright_module)));
const { chromium } = require(path.resolve(config.playwright_module));
const browser = await chromium.launch({
  executablePath: config.chromium_executable, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
async function stage(name, work) {
  if (checkpoint.stages[name]?.status === 'COMPLETE') return;
  try {
    const result = await work();
    checkpoint.stages[name] = { status: 'COMPLETE', completedAt: new Date().toISOString(), ...result };
    await save();
  } catch (error) {
    checkpoint.stages[name] = { status: 'INTERRUPTED', at: new Date().toISOString(), error: String(error) };
    await save();
    throw error;
  }
}
async function inspectReadingView(file, viewport, screenshot) {
  await page.setViewportSize(viewport);
  await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: 'load' });
  const observed = await page.evaluate(() => ({
    title: document.title, heading: document.querySelector('h1')?.textContent || '',
    body: document.body.innerText,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    rows: document.querySelectorAll('tbody tr').length,
    columns: [...document.querySelectorAll('thead th')].map(x => x.textContent),
    links: [...document.querySelectorAll('a[href]')].map(x => ({ label: x.textContent.trim(), href: x.getAttribute('href') })),
    tables: [...document.querySelectorAll('table')].map(x => {
      const parent = x.parentElement;
      return { width: x.scrollWidth, parentWidth: parent.clientWidth, overflowX: getComputedStyle(parent).overflowX };
    })
  }));
  insist(observed.heading.includes(config.expected_brand), 'The existing reading view must identify Finage.');
  insist(observed.body.includes(config.original_edition_id), 'The reading view omitted the original received edition.');
  insist(observed.documentWidth <= observed.viewportWidth + 1, 'The original reading view overflows the page instead of its table.');
  insist(observed.rows > 0, 'The original reading view did not render its retained selected records.');
  insist(observed.links.some(x => /ndjson/i.test(x.href)) && observed.links.some(x => /\.csv$/i.test(x.href)),
    'The reading view must link the full exact NDJSON and CSV selections.');
  for (const link of observed.links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.href) || link.href.startsWith('#')) continue;
    const target = path.resolve(path.dirname(file), link.href);
    const relative = path.relative(path.dirname(file), target);
    insist(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
      'An original reading-view link escaped its delivered directory.');
    await fs.access(target);
  }
  const target = path.join(output, screenshot);
  await page.screenshot({ path: target, fullPage: true });
  const bytes = await fs.readFile(target);
  return {
    title: observed.title, heading: observed.heading,
    originalRowsShown: observed.rows, columns: observed.columns,
    viewport, documentWidth: observed.documentWidth,
    originalLinks: observed.links, tableScrolling: observed.tables,
    screenshot: { path: target, bytes: bytes.length, sha256: sha(bytes) }
  };
}
try {
  await stage('desktop_complete_selection', () =>
    inspectReadingView(config.html, { width: 1280, height: 900 }, 'finage-customer-desktop.png'));
  await stage('mobile_complete_selection', () =>
    inspectReadingView(config.html, { width: 390, height: 844 }, 'finage-customer-mobile.png'));
  await stage('filtered_original_selection', async () => {
    const view = await inspectReadingView(config.filtered_html, { width: 1280, height: 900 }, 'finage-customer-filtered.png');
    insist((await page.locator('body').innerText()).includes(String(config.filtered_records)),
      'The filtered reading view omitted its selected record count.');
    return { ...view, filteredRecords: config.filtered_records };
  });
  insist(errors.length === 0, 'The existing static reading view raised an actual page error.');
  checkpoint.status = 'COMPLETE';
  checkpoint.completedAt = new Date().toISOString();
  await save();
  const result = {
    ...checkpoint, deliveryId: config.delivery_id,
    originalEditionId: config.original_edition_id,
    originalCustomerRecords: config.original_customer_records,
    originalAssessmentReady: config.original_assessment_ready,
    pageErrors: errors, productWrites: 0
  };
  await fs.writeFile(path.join(output, 'READING_VIEW_RESULT.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: 'COMPLETE', result: path.join(output, 'READING_VIEW_RESULT.json') }) + '\n');
} finally {
  await browser.close();
}
