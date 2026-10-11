// MIT. Record the existing product UI and source-backed presentation cards.
// No payment, signing, replacement API or fabricated product state is supplied.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node record.mjs /private/capture-config.json');
const cfg = JSON.parse(await readFile(inputPath));
const film = JSON.parse(await readFile(new URL('./film.json', import.meta.url)));
const { chromium } = await import(pathToFileURL(cfg.playwright));
const { openCommerce } = await import(pathToFileURL(join(cfg.source, 'stellar/scf-starforge-20261009/sf66-demo-launcher/commerce.mjs')));
const { startCommerceConsole } = await import(pathToFileURL(join(cfg.source, 'stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs')));
const journey = JSON.parse(await readFile(cfg.nativeJourney));
const observed = JSON.parse(await readFile(cfg.chainObservation));
const response = await readFile(cfg.nativeResponse);
const digest = createHash('sha256').update(response).digest('hex');
if (response.length !== journey.responseFile.bytes || digest !== journey.responseFile.sha256 ||
    observed.result.transaction !== journey.chain.hash || observed.result.amountAtomic !== journey.chain.transfer.amountAtomic ||
    observed.result.status !== 'TOKEN_TRANSFER_MATCHED_TESTNET') throw new Error('Retained sources do not agree.');
await mkdir(cfg.output, { recursive: true });
await mkdir(join(cfg.output, 'frames'), { recursive: true });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mono = value => '<code>' + esc(value) + '</code>';
const pause = ms => new Promise(done => setTimeout(done, ms));
function card(body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Stellar Forge presentation</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:#202020;font:24px Arial,sans-serif;padding:64px 72px;line-height:1.4}
  h1{font-size:64px;line-height:1.08;letter-spacing:-2px;margin:16px 0 28px;max-width:1160px}h2{font-size:34px;margin:4px 0 20px}
  p{margin:16px 0;max-width:1160px;color:#555}small,.eyebrow{font-size:16px;letter-spacing:1.6px;color:#666;text-transform:uppercase}
  .line{height:1px;background:#ccc;margin:32px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}.cell{border:1px solid #ccc;padding:26px;min-height:176px}
  .two{grid-template-columns:1fr 1fr}.four{grid-template-columns:repeat(4,1fr)}.num{font-size:46px;letter-spacing:-1px}.name{font-size:52px;letter-spacing:-1.5px}
  .small{font-size:20px}.tag{display:inline-block;border:1px solid #aaa;padding:6px 12px;font-size:17px;margin-right:10px}
  code,pre{font:20px 'DejaVu Sans Mono',monospace;overflow-wrap:anywhere}pre{border:1px solid #ccc;background:#f7f7f7;padding:26px;line-height:1.65;white-space:pre-wrap}
  .wide{font-size:18px}.receipt{display:grid;grid-template-columns:200px 1fr;gap:14px;font-size:20px}.receipt>span{color:#666}
  </style><body>${body}</body></html>`;
}
function cardFor(id) {
  if (id === 'title') return card(`<div class="eyebrow">SCF #46 · Developer tooling · Open Track</div><h1>Stellar Discovery<br>Trust Layer</h1><p style="font-size:32px">Stellar Forge: from a merchant API<br>to a paid, retained result.</p><div class="line"></div><span class="tag">Original product walkthrough</span><span class="tag">11 October 2026</span>`);
  if (id === 'team') return card(`<div class="eyebrow">The builder</div><div class="name">${esc(film.founder)}</div><p>Individual applicant · TokenJunkie Labs</p><div class="line"></div><div class="grid two"><div class="cell"><h2>Product direction</h2><p class="small">Priorities, relationship work and decisions about what the product should deliver.</p></div><div class="cell"><h2>AI-assisted engineering</h2><p class="small">Design, implementation, independent review and native engineering exercises.</p></div></div><p class="small">AI assistance is disclosed for the source, documentation and this captioned presentation.</p>`);
  if (id === 'purpose') return card(`<div class="eyebrow">An operator journey</div><h1>Sell a useful operation.<br>Keep a useful result.</h1><div class="grid four"><div class="cell"><small>01</small><h2>Publish</h2><p class="small">Merchant operation and complete terms</p></div><div class="cell"><small>02</small><h2>Review</h2><p class="small">Concrete request and spending limit</p></div><div class="cell"><small>03</small><h2>Pay</h2><p class="small">Configured native Stellar flow</p></div><div class="cell"><small>04</small><h2>Retain</h2><p class="small">Response, intent and accounting</p></div></div>`);
  if (id === 'transaction') return card(`<div class="eyebrow">Retained original native testnet purchase · 11 October 2026</div><h1>0.005 testnet XLM</h1><div class="grid"><div class="cell"><small>Network outcome</small><div class="num">SUCCESS</div><p class="small">Ledger ${journey.chain.ledger.toLocaleString('en-US')}</p></div><div class="cell"><small>Authorized transfer</small><div class="num">${esc(journey.chain.transfer.amountAtomic)}</div><p class="small">Atomic units · native XLM SAC</p></div><div class="cell"><small>Independent observation</small><h2>Matched</h2><p class="small">Transaction + SEP-41 transfer event</p></div></div><p class="wide">Transaction ${mono(journey.chain.hash)}</p><p class="small">Isolated local testnet execution. Public ingress and production workspace approval were not exercised in this run.</p>`);
  if (id === 'response') return card(`<div class="eyebrow">Original saved merchant file</div><h1 style="font-size:48px">native-paid-response.json</h1><span class="tag">${response.length} bytes</span><span class="tag">application/json</span><pre>${esc(JSON.stringify(JSON.parse(response), null, 2))}</pre><div class="receipt"><span>SHA-256</span>${mono(digest)}<span>Original outcome</span><strong>${esc(journey.outcome.status)}</strong><span>Actual counts</span><strong>${journey.approveCalls} approval · ${journey.signCalls} signature · ${journey.merchantCalls} merchant invocation</strong></div>`);
  if (id === 'plan') return card(`<div class="eyebrow">Prospective development · current application model</div><h1 style="font-size:54px">From working product<br>to independent merchant use.</h1><div class="grid"><div class="cell"><small>Day 30</small><h2>Installation</h2><p class="small">Merchant HTTP/MCP setup, authority handover and repairs.</p></div><div class="cell"><small>Day 90</small><h2>Deployment</h2><p class="small">Provider installation, operational response and alerts.</p></div><div class="cell"><small>Day 150</small><h2>Mainnet use</h2><p class="small">Rollout, production recovery, remediation and handover.</p></div></div><p><strong>$38,000 · 400 future hours · 150 modeled days</strong></p><p class="small">Track attributable purchases, delivered products, recovery and repeat use.</p>`);
  if (id === 'close') return card(`<div class="eyebrow">Maintained open source</div><h1>Install. Inspect. Integrate.</h1><p style="font-size:30px">Merchant service · buyer workspace · retained results</p><div class="line"></div><p>Stellar Discovery Trust Layer<br><strong>${esc(film.founder)}</strong> · Individual applicant</p><p class="small">Product source: ${mono(film.sourceCommit.slice(0, 12))}</p><p class="small">github.com/woahwhattheheck/public-commons-sprint-2026</p>`);
  throw new Error('No presentation card for ' + id);
}
let session, ui, browser, activePage, recording = false;
const frames = [], chapters = [], errors = [];
const start = performance.now();
let frameLoop;
async function openSession() {
  session = await openCommerce(cfg.session);
  ui = await startCommerceConsole(session, { port: 0 });
  return session.status();
}
async function chapter(spec, setup, action) {
  if (setup) await setup();
  const at = (performance.now() - start) / 1000;
  const row = { ...spec, start: at };
  chapters.push(row);
  console.log(JSON.stringify({ chapter: spec.id, seconds: spec.seconds }));
  const began = performance.now();
  if (action) await action();
  await pause(Math.max(0, spec.seconds * 1000 - (performance.now() - began)));
  row.end = (performance.now() - start) / 1000;
  await activePage.screenshot({ path: join(cfg.output, spec.id + '.png') });
}
try {
  let status = await openSession();
  browser = await chromium.launch({ executablePath: cfg.chromium, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 700 }, deviceScaleFactor: 1 });
  const cards = await context.newPage(), merchant = await context.newPage(), buyer = await context.newPage();
  for (const page of [merchant,buyer]) page.on('pageerror', error => errors.push(error.message));
  await merchant.goto(status.seller.docs);
  await merchant.locator('#detail:not([hidden])').waitFor();
  await buyer.goto(ui.operatorUrl);
  await buyer.locator('#review:not([disabled])').waitFor();
  activePage = cards;
  await cards.setContent(cardFor('title'));
  recording = true;
  frameLoop = (async () => {
    while (recording) {
      const before = performance.now();
      const file = 'frames/' + String(frames.length).padStart(6, '0') + '.jpg';
      await activePage.screenshot({ path: join(cfg.output, file), type: 'jpeg', quality: 88 });
      frames.push({ file, at: (before - start) / 1000 });
      await pause(Math.max(0, 160 - (performance.now() - before)));
    }
  })();
  for (const spec of film.chapters) {
    if (['title','team','purpose','transaction','response','plan','close'].includes(spec.id)) {
      await chapter(spec, async () => { activePage = cards; await cards.setContent(cardFor(spec.id)); });
    } else if (spec.id === 'seller') {
      await chapter(spec, async () => { activePage = merchant; await merchant.evaluate(() => scrollTo(0,0)); }, async () => {
        await pause(6500); await merchant.locator('[data-operation="patch-record"]').click();
        await merchant.locator('#detail').scrollIntoViewIfNeeded();
      });
    } else if (spec.id === 'request') {
      await chapter(spec, null, async () => {
        await merchant.locator('[data-parameter="recordId"]').fill('actual-patch');
        await merchant.locator('#query').fill('{"unit":"XLM"}');
        await merchant.locator('#body').fill(await readFile(cfg.requestBody, 'utf8'));
        await pause(3500); await merchant.locator('#send').click();
        await merchant.locator('#result:not([hidden])').waitFor();
        await merchant.locator('#result').scrollIntoViewIfNeeded();
        await pause(6500);
        await merchant.getByText('Original decoded payment requirements', { exact: true }).click();
        await merchant.locator('#challenge').scrollIntoViewIfNeeded();
      });
    } else if (spec.id === 'review') {
      await chapter(spec, async () => { activePage = buyer; await buyer.evaluate(() => scrollTo(0,0)); }, async () => {
        await pause(6000); await buyer.locator('#review').click();
        await buyer.waitForFunction(() => document.querySelector('#review-note').textContent.includes('current reviewed request'));
        await buyer.locator('#terms').scrollIntoViewIfNeeded();
      });
    } else if (spec.id === 'details') {
      await chapter(spec, null, async () => { await buyer.locator('#request-details summary').click(); await buyer.locator('#request-details').scrollIntoViewIfNeeded(); });
    } else if (spec.id === 'cancel') {
      await chapter(spec, null, async () => {
        await buyer.locator('#operation-select').selectOption(cfg.secondIntent);
        await buyer.waitForFunction(intent => document.querySelector('#intent').textContent === intent, cfg.secondIntent);
        await pause(3500); await buyer.locator('#cancel').click();
        await buyer.waitForFunction(() => document.querySelector('#operation-state').textContent === 'Cancelled');
        await buyer.locator('#execute-heading').scrollIntoViewIfNeeded();
      });
    } else if (spec.id === 'reopen') {
      await chapter(spec, null, async () => {
        await ui.close(); ui = null;
        status = await openSession();
        await buyer.goto(ui.operatorUrl); await buyer.locator('#operation-select:not([disabled])').waitFor();
        await buyer.locator('#operation-select').selectOption(cfg.secondIntent);
        await buyer.waitForFunction(() => document.querySelector('#operation-state').textContent === 'Cancelled');
        await buyer.evaluate(() => scrollTo(0,0));
      });
    }
  }
} finally {
  recording = false;
  await frameLoop;
  await browser?.close();
  await ui?.close();
  const first = frames[0]?.at ?? 0;
  for (const frame of frames) frame.at -= first;
  for (const chapter of chapters) { chapter.start = Math.max(0, chapter.start-first); if(chapter.end) chapter.end -= first; }
  await writeFile(join(cfg.output, 'capture.json'), JSON.stringify({ film, frames, chapters, errors,
    sourceCommit: film.sourceCommit, responseBytes: response.length, responseSha256: digest,
    transaction: journey.chain.hash, originalNativeSource: journey.source,
    observationAt: observed.observedAt, capturedAt: new Date().toISOString(),
  }, null, 2));
}
