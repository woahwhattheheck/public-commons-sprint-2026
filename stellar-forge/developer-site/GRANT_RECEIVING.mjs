// MIT. Complete application receiving through the owner's controlled Playwright Page.
// This module starts no server, browser, provider, purchase, model or submission.
import { constants } from 'node:fs';
import { open, readFile, mkdir, realpath, link, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readBrowserAssets } from '../../stellar/scf-starforge-20261009/distribution/browser-assets.mjs';

const SCHEMA = 'stellar-forge.grant-application-visual-receiving.v1';
const SOURCE = 'stellar-forge/developer-site/';
const EXAMPLE = '/examples/fred-briefing-20261012/';
const REPORT = EXAMPLE + 'stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/';
const FILM = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/stellar-forge-scf46-presentation.mp4';
const COMPANION = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/Stellar-Forge-SCF-Presentation-Editable-Companion-20261011.zip';
const PINS = {
  '/grant.html': '58bc561b3ade39547a15ea724c9650305d08576f',
  '/grant.css': '01a3767cead0e77fba53f661e83fe01abd8e28f9',
  '/grant-data/application.md': '40ac3d76a35d2b0e993245c5354abb00a9059645',
  '/grant-data/budget.csv': 'c62afa352e881c2cf81fe937649fe63fea3ceab5',
  '/grant-data/product-and-finance.md': 'f945864b5326bf312abc6327d37c0a197f7632a6',
  '/grant-data/source-index.json': 'f49317db29b0cf95cb52b1574cee4f3ed372fa37',
  [REPORT + 'briefing.html']: '8627f43f3edac20f4b700d7bd6f51359f44df120',
  [REPORT + 'briefing-measures.csv']: '95d1e0c3c5118cb65dd6172663550e8e9d560e60',
  [REPORT + 'briefing.json']: 'd5799ef78d081722b82b202d268927bad70529f9',
  [EXAMPLE + 'START_HERE.md']: 'cf5c5b92b26db361c306068392476abadee3df52',
  [EXAMPLE + 'package-manifest.json']: '9d8a5cf0c52dd4f291f3b936108483119c3fb9a8',
  [EXAMPLE + 'stellar-forge-economic-briefing-20261012.zip']: '1afed5aef5210a761c6e700ab5eedfbe99271df2',
};
const DOWNLOADS = [
  ['/grant-data/application.md', 'Application.md'],
  ['/grant-data/budget.csv', 'Six_Package_Budget.csv'],
  ['/grant-data/product-and-finance.md', 'Product_and_Finance.md'],
  ['/grant-data/source-index.json', 'Source_Index.json'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitHash = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const html = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function need(value, message) { if (!value) throw new Error(message); }

async function regular(path, max = 16 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    need(stat.isFile() && stat.size <= max, 'Select an ordinary complete receiving file: ' + path);
    const bytes = await file.readFile();
    need(bytes.length === stat.size, 'The receiving file changed while reading: ' + path);
    return bytes;
  } finally { await file.close(); }
}
async function maybe(path) {
  try { return await regular(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function retain(path, bytes) {
  const existing = await maybe(path);
  if (existing) {
    need(existing.equals(bytes), 'Keep the original different receiving file: ' + path);
    return;
  }
  const temporary = path + '.preparing-' + randomUUID();
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await regular(path)).equals(bytes), 'Another receiving result owns: ' + path);
    }
    const directory = await open(resolve(path, '..'), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}
async function selectedSources(root, sourcePins = null) {
  need(sourcePins === null || (sourcePins && typeof sourcePins === 'object' && !Array.isArray(sourcePins)),
    'Use the explicit route-to-blob source pins from the application composer.');
  for (const [route, sha] of Object.entries(sourcePins || {})) {
    need(Object.hasOwn(PINS, route) && typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha),
      'Retain a selected original route and its actual Git blob: ' + route);
  }
  const selectedPins = { ...PINS, ...(sourcePins || {}) };
  const manifestPath = join(root, SOURCE, 'browser-assets.json');
  const manifest = await regular(manifestPath);
  const assets = await readBrowserAssets(pathToFileURL(manifestPath));
  const selected = new Map();
  for (const [route, expected] of Object.entries(selectedPins)) {
    const asset = assets.get(route);
    need(asset, 'The selected original package does not serve ' + route);
    const bytes = await regular(fileURLToPath(asset.url));
    need(gitHash(bytes) === expected, 'The reviewed original source differs: ' + route);
    selected.set(route, { bytes, type: asset.type, git_blob: expected, sha256: hash(bytes) });
  }
  const homeAsset = assets.get('/index.html');
  need(homeAsset, 'The complete selected Site home is missing.');
  const homeBytes = await regular(fileURLToPath(homeAsset.url));
  selected.set('/index.html', { bytes: homeBytes, type: homeAsset.type, git_blob: gitHash(homeBytes), sha256: hash(homeBytes) });
  const reportHtml = selected.get(REPORT + 'briefing.html').bytes.toString('utf8');
  const embedded = reportHtml.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/);
  need(embedded, 'The original report data is missing.');
  const report = JSON.parse(embedded[1]);
  need(report.schema === 'stellar-forge.fred-briefing-model.v1', 'Use the original retained economic report.');
  need(same(report, JSON.parse(selected.get(REPORT + 'briefing.json').bytes)), 'Original report and data differ.');
  return { assets, selected, report, manifest: { bytes: manifest.length, sha256: hash(manifest), routes: assets.size } };
}
async function downloaded(page, locator, maximum = 16 * 1024 * 1024) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    locator.click(),
  ]);
  const stream = await download.createReadStream();
  need(stream, 'The original browser download is unavailable.');
  const chunks = []; let count = 0;
  for await (const chunk of stream) {
    count += chunk.length;
    need(count <= maximum, 'The download exceeds this selected receiving bound.');
    chunks.push(chunk);
  }
  const failure = await download.failure();
  need(!failure, 'The original browser download failed: ' + failure);
  const bytes = Buffer.concat(chunks);
  const name = download.suggestedFilename();
  await download.delete();
  return { bytes, suggested_filename: name };
}
function readout(result, files) {
  const link = (name, label) => {
    const file = files.find(item => item.name === name);
    return file ? '<a href="' + html(file.name) + '">' + html(label) + '</a>' : '';
  };
  const figures = files.filter(file => file.kind === 'capture').map(file =>
    '<figure><img loading="lazy" src="' + html(file.name) + '" alt="' + html(file.caption) +
    '"><figcaption>' + html(file.caption) + '</figcaption></figure>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Stellar Forge — application receiving</title><style>body{margin:0;background:#f3f3f3;color:#222;font:16px/1.65 Arial,Helvetica,sans-serif}' +
    'main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:clamp(32px,5vw,52px);line-height:1.08;letter-spacing:-1px}' +
    'h2{font-size:25px;border-top:1px solid #ccc;padding-top:24px}a{color:inherit;text-underline-offset:4px}.meta{font:12px/1.6 monospace;overflow-wrap:anywhere}' +
    '.downloads{display:flex;flex-wrap:wrap;gap:12px}.downloads a{border:1px solid #aaa;background:white;padding:10px 14px}' +
    'figure{margin:24px 0;background:#fff;border:1px solid #ccc}img{width:100%;display:block}figcaption{padding:12px 16px;font-size:13px}' +
    'table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border:1px solid #ccc;text-align:left;vertical-align:top}' +
    '@media print{main{padding:0}figure{break-inside:avoid}a{color:#000}}</style><main>' +
    '<p class="meta">STELLAR FORGE / ORIGINAL APPLICATION RECEIVING</p><h1>The complete application,<br>opened and retained.</h1>' +
    '<p>The original installed reader was exercised in its existing browser. These downloads retain the reviewed manuscript, six-package budget and financing assumptions; the images show the actual application and economic report.</p>' +
    '<div class="downloads">' + link('Application.md', 'Complete application') + link('Six_Package_Budget.csv', 'Six-package budget') +
    link('Product_and_Finance.md', 'Product and finance') + link('Source_Index.json', 'Source and measure index') +
    link('SCF_Application.pdf', 'Printed application') + '</div>' +
    '<h2>Proposed work and observed baseline</h2><table><tbody><tr><th>Requested delivery</th><td>USD 38,000 equivalent in XLM; 400 prospective delivery hours; six packages over 150 days from actual award acceptance.</td></tr>' +
    '<tr><th>Working baseline</th><td>18 team-operated testnet purchases totaling 411,000 stroops; fees recorded separately. Independent customer adoption remains a funded milestone.</td></tr>' +
    '<tr><th>Native receiving</th><td>' + html(result.completed_at) + '; original browser view restored; no purchase, model or submission action.</td></tr></tbody></table>' +
    '<h2>Reuse the economic report</h2><p>The retained report contains ' + result.economics.selected_observations + ' selected source observations and ' +
    result.economics.comparisons + ' comparisons. Filters change the displayed rows; the downloads keep the complete original report.</p><div class="downloads">' +
    link('Economic_Briefing.html', 'Open economic report') + link('Economic_Measures.csv', 'All measures') +
    link('Economic_Report_Data.json', 'Report data') + link('Economic_Opening_Guide.md', 'Opening and receiving guide') +
    link('Economic_Briefing_Package.zip', 'Complete economic source package') + '</div>' +
    '<h2>Product and team</h2><p><a href="' + FILM + '">Open the published product/team film</a> · <a href="' + COMPANION + '">Download the editable film companion</a>.</p>' +
    '<p>' + html(result.film.status === 'METADATA_READ' ? 'The existing player loaded the published film metadata during this receiving.' :
      'The published film links were matched to the selected source; remote playback was not requested in this run.') + '</p>' +
    '<h2>Actual application and report views</h2>' + figures +
    '<h2>Source and receiving record</h2><p class="meta">Original selected source ' + html(result.selection.source_commit) +
    '<br>Operation ' + html(result.selection.operation_id) + '</p><p>' + link('Receiving_Result.json', 'Complete receiving result') +
    '. This local receiving report does not claim a new publication of the owner-private hosted Site.</p></main></html>\n';
}

/**
 * Continue the original grant application's visual receiving with an owner-controlled Page.
 * sourceRoot is the selected package's source root (contains stellar-forge/ and stellar/).
 * sourcePins optionally selects a later composed application edition; omitted pins retain the original source.
 * No browser, context, listener, provider or financial calculation is constructed.
 */
export async function inspectGrantApplication(page, {
  sourceRoot, outputDirectory, expectedOrigin, sourceCommit, sourcePins = null,
  operationId = 'DCE4-SCF-GRANT-APPLICATION-RECEIVING-20261012',
  readPublishedFilm = true, printPdf = true,
} = {}) {
  need(page && typeof page.goto === 'function' && typeof page.viewportSize === 'function',
    'Pass the original owner-controlled Playwright Page.');
  need(typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(sourceCommit), 'Retain the actual selected source commit.');
  need(typeof operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(operationId), 'Retain the original receiving operation ID.');
  need(typeof readPublishedFilm === 'boolean' && typeof printPdf === 'boolean', 'Choose explicit film and print options.');
  const initialUrl = page.url(), initialViewport = page.viewportSize();
  need(initialViewport && initialViewport.width > 0 && initialViewport.height > 0,
    'Pass the existing Page with its explicit viewport so the original view can be restored.');
  const origin = new URL(expectedOrigin);
  need(origin.origin === expectedOrigin && origin.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.port,
    'Use the original loopback listener origin printed by the installed command.');
  need(new URL(initialUrl).origin === expectedOrigin && new URL(initialUrl).pathname === '/grant.html',
    'Open the original grant.html reader on this Page before continuing.');
  need(!printPdf || typeof page.pdf === 'function', 'Use the original Chromium Page for the requested print artifact.');
  const initial = await page.evaluate(() => ({
    scroll: { x: scrollX, y: scrollY },
    activeFilm: [...document.querySelectorAll('video')].some(video => !video.paused || video.seeking || video.currentTime !== 0),
  }));
  need(!initial.activeFilm, 'Keep a started film with its current viewer; pass the original reader at the film start before receiving.');
  const root = await realpath(resolve(sourceRoot));
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true, mode: 0o700 });
  need(await realpath(output) === output, 'Use an ordinary original receiving directory.');
  const originals = await selectedSources(root, sourcePins);
  const selection = {
    schema: SCHEMA, operation_id: operationId, source_commit: sourceCommit,
    source_root: root, origin: expectedOrigin, manifest: originals.manifest,
    read_published_film: readPublishedFilm, print_pdf: printPdf,
    files: [...originals.selected].map(([route, item]) => ({
      route, bytes: item.bytes.length, git_blob: item.git_blob, sha256: item.sha256,
    })),
  };
  await retain(join(output, 'selection.json'), json(selection));
  const completedBytes = await maybe(join(output, 'RESULT.json'));
  if (completedBytes) {
    const completed = JSON.parse(completedBytes);
    need(completed.status === 'COMPLETE' && same(completed.selection, selection), 'Keep the other completed source receiving.');
    for (const artifact of completed.artifacts) {
      const path = resolve(output, artifact.path);
      const rel = relative(output, path);
      need(rel && !rel.startsWith('..') && !isAbsolute(rel), 'A retained receiving artifact leaves its directory.');
      const bytes = await regular(path, 32 * 1024 * 1024);
      need(bytes.length === artifact.bytes && hash(bytes) === artifact.sha256, 'Retain or restore the original completed artifact: ' + artifact.path);
    }
    return { ...completed, reused: true };
  }
  const attemptId = 'attempt-' + randomUUID();
  const attempt = join(output, attemptId);
  await mkdir(attempt, { mode: 0o700 });
  const files = [], steps = [], failures = [], pageErrors = [], blocked = [];
  const artifact = async (name, bytes, extra = {}) => {
    need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), 'Use a plain retained artifact name.');
    await retain(join(attempt, name), bytes);
    const result = { name, path: attemptId + '/' + name, bytes: bytes.length, sha256: hash(bytes), ...extra };
    files.push(result); return result;
  };
  const capture = async (name, caption) => artifact(name, await page.screenshot({ fullPage: false, animations: 'disabled' }), { kind: 'capture', caption, viewport: page.viewportSize() });
  const errorListener = error => pageErrors.push(String(error.message || error));
  const approvedFilmUrls = new Set([FILM]);
  const allowedRequest = request => {
    if (!['GET','HEAD'].includes(request.method())) return false;
    const url = new URL(request.url());
    if (['data:','blob:','about:'].includes(url.protocol)) return true;
    if (url.origin === expectedOrigin) return originals.assets.has(url.pathname);
    let first = request;
    while (first.redirectedFrom()) first = first.redirectedFrom();
    if (readPublishedFilm && (approvedFilmUrls.has(request.url()) || approvedFilmUrls.has(first.url()))) {
      approvedFilmUrls.add(request.url()); return true;
    }
    return false;
  };
  const guard = async route => {
    if (!allowedRequest(route.request())) {
      blocked.push({ method: route.request().method(), url: route.request().url() });
      await route.abort('blockedbyclient');
    } else await route.fallback();
  };
  const responseBytes = async (response, route) => {
    need(response && response.status() === 200, 'The original reader did not return HTTP 200 for ' + route);
    const bytes = await response.body(), selected = originals.selected.get(route);
    if (selected) need(bytes.equals(selected.bytes), 'The visible listener serves another original source: ' + route);
    return { route, status: response.status(), bytes: bytes.length, sha256: hash(bytes) };
  };
  const navigate = async route => responseBytes(await page.goto(expectedOrigin + route, { waitUntil: 'load', timeout: 30000 }), route);
  const anchor = async id => {
    await page.locator('nav[aria-label="Application sections"] a[href="#' + id + '"]').click();
    await page.waitForFunction(value => location.hash === '#' + value && document.getElementById(value), id);
    await page.locator('#' + id).scrollIntoViewIfNeeded();
  };
  let restored = false, result;
  page.on('pageerror', errorListener);
  await page.route('**/*', guard);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    steps.push({ name: 'application_open', ...(await navigate('/grant.html')) });
    need(await page.title() === 'Stellar Discovery Trust Layer — SCF #46 application', 'Open the original complete application.');
    await capture('01_Application_Desktop.png', 'The complete reviewed application in the original local reader.');
    const contents = await page.locator('nav[aria-label="Application sections"] a').evaluateAll(items => items.map(item => ({
      id: item.hash.slice(1), text: item.textContent.trim(),
    })));
    const expectedSections = [
      'project-and-requested-outcome',
      'customer-problem-need-and-adoption',
      'why-stellar-and-what-we-contribute',
      'defined-architecture-and-operating-behavior',
      'working-product-and-demonstrated-results',
      'three-funded-tranches-and-six-priced-deliverables',
      'threat-response-and-outcome-measurement',
      'delivery-capacity-payment-timing-and-sustainability',
      'applicant-experience-and-submission',
      'open-the-existing-work',
    ];
    if (originals.selected.get('/grant.html').bytes.toString('utf8').includes('<!-- grant-reviewer-entry:start -->')) {
      expectedSections.unshift('review-the-product');
    }
    need(same(contents.map(item => item.id), expectedSections), 'Retain every original application section and the selected working-product opening.');
    for (const item of contents) {
      await anchor(item.id);
      need((await page.locator('#' + item.id).innerText()).trim(), 'An application section is empty: ' + item.id);
    }
    steps.push({ name: 'complete_application_navigation', sections: contents });
    await anchor('three-funded-tranches-and-six-priced-deliverables');
    await capture('02_Funded_Work_Desktop.png', 'The three funded tranches and six priced delivery packages.');
    await anchor('delivery-capacity-payment-timing-and-sustainability');
    await capture('03_Capacity_and_Cash_Desktop.png', 'The original capacity and receipt-based financing assumptions.');
    await page.goto(expectedOrigin + '/grant.html', { waitUntil: 'load' });
    for (const [route, name] of DOWNLOADS) {
      const downloadedFile = await downloaded(page, page.locator('a[download][href=".' + route + '"]').first());
      need(downloadedFile.bytes.equals(originals.selected.get(route).bytes), 'The application download changed: ' + route);
      const saved = await artifact(name, downloadedFile.bytes, { kind: 'download', source_route: route, suggested_filename: downloadedFile.suggested_filename });
      steps.push({ name: 'application_download', route, artifact: saved.path, sha256: saved.sha256 });
    }
    const sourceIndex = JSON.parse(originals.selected.get('/grant-data/source-index.json').bytes);
    need(sourceIndex.application.sha256 === hash(originals.selected.get('/grant-data/application.md').bytes) &&
      sourceIndex.product_and_finance.sha256 === hash(originals.selected.get('/grant-data/product-and-finance.md').bytes),
      'The original manuscript source identities are not coherent.');
    const filmLinks = await page.locator('a[href],video source[src]').evaluateAll(items => items.map(item => item.href || item.src));
    need(filmLinks.includes(FILM) && filmLinks.includes(COMPANION), 'The published film and companion links are missing.');
    let film = { status: 'SOURCE_LINKS_MATCHED', url: FILM, companion_url: COMPANION };
    if (readPublishedFilm) {
      const media = await page.locator('video').evaluate(async (video, expected) => {
        if (video.querySelector('source')?.src !== expected) throw new Error('The film source changed.');
        await new Promise((resolve, reject) => {
          let timer;
          const clear = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', failed); };
          const ready = () => { clear(); resolve(); };
          const failed = () => { clear(); reject(new Error('The published film metadata could not be loaded.')); };
          timer = setTimeout(failed, 45000);
          video.addEventListener('loadedmetadata', ready, { once: true }); video.addEventListener('error', failed, { once: true });
          video.preload = 'metadata'; video.load();
        });
        return { duration_seconds: video.duration, width: video.videoWidth, height: video.videoHeight, ready_state: video.readyState };
      }, FILM);
      need(Number.isFinite(media.duration_seconds) && Math.abs(media.duration_seconds - 212) <= 2 && media.width > 0 && media.height > 0,
        'The published film metadata differs from the selected source.');
      const companionResponse = await page.request.head(COMPANION, { timeout: 30000, maxRedirects: 5 });
      try {
        need(companionResponse.ok(), 'The published editable film companion did not open.');
        const length = companionResponse.headers()['content-length'];
        if (length !== undefined) need(Number(length) === sourceIndex.sources.find(item => item.id === 'film').editable_companion_bytes,
          'The published editable film companion size differs from its original source.');
        film = { ...film, ...media, status: 'METADATA_READ', companion_status: companionResponse.status(),
          companion_content_length: length === undefined ? null : Number(length), companion_read: 'HEAD; source asset is not duplicated here' };
      } finally { await companionResponse.dispose(); }
    }
    steps.push({ name: 'published_film', ...film });
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate('/grant.html');
    need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The application overflows the phone viewport.');
    await capture('04_Application_Phone.png', 'The same complete application at 390-pixel phone width.');
    await anchor('three-funded-tranches-and-six-priced-deliverables');
    const candidates = page.locator('.application-prose .table-scroll');
    let scrolled = null;
    for (let index = 0; index < await candidates.count(); index++) {
      const table = candidates.nth(index);
      const width = await table.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }));
      if (width.scroll <= width.client + 1) continue;
      await table.focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(index => document.querySelectorAll('.application-prose .table-scroll')[index].scrollLeft > 0, index);
      scrolled = { index, ...width, scroll_left: await table.evaluate(node => node.scrollLeft) };
      await table.evaluate(node => { node.scrollLeft = 0; });
      break;
    }
    need(scrolled, 'The phone table scrolling control was not exercised.');
    await anchor('three-funded-tranches-and-six-priced-deliverables');
    await capture('05_Funded_Work_Phone.png', 'The priced work remains available through its labelled, keyboard-scrollable phone table.');
    steps.push({ name: 'phone_reading', viewport: page.viewportSize(), horizontal_table: scrolled, page_overflow: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('/grant.html');
    if (printPdf) {
      const printed = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true });
      need(printed.subarray(0,5).toString() === '%PDF-', 'The original browser did not produce the application print document.');
      await artifact('SCF_Application.pdf', printed, { kind: 'print', source_route: '/grant.html' });
    }
    // Follow the page's existing economic-report URL on this same Page.
    const reportLink = page.locator('a[href=".' + REPORT + 'briefing.html"]').first();
    need(await reportLink.count() === 1, 'The application economic-report link is missing.');
    const observedReportUrl = await reportLink.getAttribute('href');
    steps.push({ name: 'economic_report_open', original_href: observedReportUrl, ...(await navigate(REPORT + 'briefing.html')) });
    const browserReport = await page.locator('#report-data').textContent();
    need(same(JSON.parse(browserReport), originals.report), 'The economic view no longer contains its complete original report.');
    await artifact('Economic_Briefing.html', originals.selected.get(REPORT + 'briefing.html').bytes, { kind: 'report', source_route: REPORT + 'briefing.html' });
    await capture('06_Economic_Summary_Desktop.png', 'The retained economic source, original missing markers and selected comparisons.');
    await page.locator('[data-view="measures"]').click();
    need(await page.locator('[data-view="measures"]').getAttribute('aria-pressed') === 'true', 'The report did not open Measures.');
    const series = await page.locator('#series-filter option').evaluateAll(items => items.map(item => item.value).filter(Boolean));
    const states = await page.locator('#status-filter option').evaluateAll(items => items.map(item => item.value).filter(Boolean));
    need(same(series, originals.report.series.map(item => item.id)), 'The report series choices differ.');
    need(same(states, Object.keys(originals.report.totals)), 'The report source-state choices differ.');
    const filterChecks = [];
    for (const selectedSeries of series) {
      await page.locator('#series-filter').selectOption(selectedSeries);
      await page.locator('#status-filter').selectOption('');
      const expected = originals.report.measures.filter(item => item.series === selectedSeries).length;
      const count = await page.locator('#measure-body tr').count();
      need(count === Math.min(100, expected), 'The selected series view is incomplete: ' + selectedSeries);
      filterChecks.push({ series: selectedSeries, expected, visible: count });
    }
    await page.locator('#series-filter').selectOption('');
    for (const state of states) {
      await page.locator('#status-filter').selectOption(state);
      const expected = originals.report.measures.filter(item => item.state === state).length;
      const count = await page.locator('#measure-body tr').count();
      need(count === Math.min(100, expected), 'The source-state view is incomplete: ' + state);
      filterChecks.push({ state, expected, visible: count });
    }
    await page.locator('#status-filter').selectOption('');
    need(await page.locator('#measure-body tr').count() === Math.min(100, originals.report.measures.length), 'The original first comparison page is incomplete.');
    const pagination = [];
    while (!await page.locator('#next').isDisabled()) {
      pagination.push(await page.locator('#measure-count').innerText());
      await page.locator('#next').click();
    }
    pagination.push(await page.locator('#measure-count').innerText());
    need(pagination.length === Math.ceil(originals.report.measures.length / 100), 'The report pagination does not cover the complete original result.');
    while (!await page.locator('#previous').isDisabled()) await page.locator('#previous').click();
    await page.locator('#status-filter').selectOption(states.find(value => value !== 'READY') || states[0]);
    await capture('07_Economic_Missing_Source_Desktop.png', 'Unavailable source values remain distinct from available comparisons.');
    const csv = await downloaded(page, page.locator('#download-csv'));
    need(csv.bytes.equals(originals.selected.get(REPORT + 'briefing-measures.csv').bytes), 'The report CSV differs from the original complete measures.');
    await artifact('Economic_Measures.csv', csv.bytes, { kind: 'download', suggested_filename: csv.suggested_filename });
    const data = await downloaded(page, page.locator('#download-json'));
    need(same(JSON.parse(data.bytes), originals.report), 'The downloaded report data differs from the original complete report.');
    await artifact('Economic_Report_Data.json', data.bytes, { kind: 'download', suggested_filename: data.suggested_filename });
    await page.locator('[data-view="sources"]').click();
    need(await page.locator('#sources article').count() === series.length, 'The report source cards are incomplete.');
    await capture('08_Economic_Sources_Desktop.png', 'The selected method, original publisher, units, dates and source locations.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-view="measures"]').click();
    need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The economic report overflows the phone viewport.');
    await capture('09_Economic_Measures_Phone.png', 'The same retained economic report and source-state filter on a phone-width page.');
    for (const [route,name] of [
      [EXAMPLE + 'START_HERE.md','Economic_Opening_Guide.md'],
      [EXAMPLE + 'stellar-forge-economic-briefing-20261012.zip','Economic_Briefing_Package.zip'],
    ]) {
      const response = await page.request.get(expectedOrigin + route);
      try {
        const proof = await responseBytes(response, route);
        await artifact(name, await response.body(), { kind: 'download', source_route: route });
        steps.push({ name: 'retained_economic_handoff', ...proof });
      } finally { await response.dispose(); }
    }
    const economics = { selected_observations: originals.report.selectedRows, comparisons: originals.report.measures.length,
      report_id: originals.report.reportId, series, states, filters: filterChecks, pagination };
    steps.push({ name: 'economic_controls_and_downloads', ...economics });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('/grant.html');
    const [homeResponse] = await Promise.all([
      page.waitForResponse(response => response.url() === expectedOrigin + '/index.html' && response.request().isNavigationRequest()),
      page.locator('.site-header a.brand').click(),
    ]);
    steps.push({ name: 'original_site_home', ...(await responseBytes(homeResponse, '/index.html')) });
    const grantEntry = page.locator('a[href="./grant.html"],a[href="/grant.html"],a[href="grant.html"]').first();
    need(await grantEntry.count() === 1, 'The existing home does not lead back to the complete application.');
    const [reopened] = await Promise.all([
      page.waitForResponse(response => response.url() === expectedOrigin + '/grant.html' && response.request().isNavigationRequest()),
      grantEntry.click(),
    ]);
    steps.push({ name: 'same_entry_reopen', ...(await responseBytes(reopened, '/grant.html')) });
    need(pageErrors.length === 0 && blocked.length === 0, 'Keep the actual page errors/blocked requests before claiming a completed receiving.');
    result = {
      schema: SCHEMA, status: 'COMPLETE', selection, completed_at: new Date().toISOString(),
      original_view_restored: false, purchase_calls: 0, model_calls: 0, submission_calls: 0,
      film, economics, steps, artifacts: files, page_errors: pageErrors, blocked_requests: blocked,
      hosted_site_publication: 'Original publisher-owned Site; this receiving makes no publication claim.',
    };
  } catch (error) {
    failures.push(String(error.message || error));
  } finally {
    try {
      await page.setViewportSize(initialViewport);
      await responseBytes(await page.goto(initialUrl, { waitUntil: 'load', timeout: 30000 }), '/grant.html');
      await page.evaluate(scroll => window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' }), initial.scroll);
      await page.waitForFunction(scroll => Math.abs(scrollX - scroll.x) <= 1 && Math.abs(scrollY - scroll.y) <= 1,
        initial.scroll, { timeout: 5000 });
      need(page.url() === initialUrl && same(page.viewportSize(), initialViewport), 'The original reader view did not restore.');
      restored = true;
    } catch (error) { failures.push('Original view restore: ' + String(error.message || error)); }
    await page.unroute('**/*', guard).catch(error => failures.push('Reader route cleanup: ' + error.message));
    page.off('pageerror', errorListener);
  }
  if (pageErrors.length || blocked.length) failures.push('The original browser reported page errors or blocked requests.');
  if (failures.length || !result || !restored) {
    await retain(join(attempt, 'INCOMPLETE.json'), json({
      schema: SCHEMA, status: 'INCOMPLETE', selection, attempts: attemptId,
      original_view_restored: restored, failures, steps, artifacts: files,
      page_errors: pageErrors, blocked_requests: blocked, ended_at: new Date().toISOString(),
    }));
    throw new Error('The original receiving remains incomplete: ' + failures.join('; '));
  }
  result.original_view_restored = true;
  result.completed_at = new Date().toISOString();
  // The user-facing result is saved inside this attempt; RESULT.json is its
  // durable completion pointer. Neither is published before view restoration.
  const userResult = { ...result, artifacts: [...files] };
  await artifact('Receiving_Result.json', json(userResult), { kind: 'record' });
  await artifact('GRANT_REVIEW.html', Buffer.from(readout(result, files)), { kind: 'overview' });
  await retain(join(output, 'RESULT.json'), json(result));
  return result;
}
