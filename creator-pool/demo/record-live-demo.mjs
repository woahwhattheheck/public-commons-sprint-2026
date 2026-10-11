import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { startLocal } from '../backend/scripts/start-local.mjs';

// All campaign mutations are ordinary interactions with the original web UI.
// API calls below only read the actual original on-chain state.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.CP_CAPTURE_OUTPUT || path.join(root, 'capture');
const data = process.env.CP_CAPTURE_DATA_DIR || path.join(root, 'recorded-state');
const port = process.env.PORT || '8877';
const base = `http://127.0.0.1:${port}`;
const source = process.env.CP_CAPTURE_SOURCE || 'afcc48eccc32859762b57236f159c1f0b4bce1a6';
const playwright = (await import(process.env.PLAYWRIGHT_MODULE || 'playwright')).default;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await fs.mkdir(out, { recursive: true });
let startupError, browser, context, page, video, zero, finishedAt;
const scenes = [], checkpoints = [], requests = [], errors = [];
const env = { ...process.env, CP_DATA_DIR: data, PORT: port,
  RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8855' };
const running = startLocal({ env }).catch(error => { startupError = error; });
const elapsed = () => Math.max(0, (performance.now() - zero) / 1000);
async function readState() {
  const response = await fetch(base + '/api/state', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Original state read returned ${response.status}`);
  return response.json();
}
async function waitState(label, accepts) {
  for (let i = 0; i < 80; i++) {
    const state = await readState();
    if (accepts(state)) {
      const checkpoint = { label, seconds: elapsed(), state };
      checkpoints.push(checkpoint);
      console.log(JSON.stringify({ milestone: label, seconds: checkpoint.seconds,
        campaign: state.campaigns[0], submissions: state.submissions.map(s => ({id:s.id,status:s.status,creator:s.creatorActor})) }));
      await delay(450);
      return state;
    }
    await delay(200);
  }
  throw new Error(`The original chain did not reach ${label}`);
}
function scene(text) { scenes.push({ seconds: elapsed(), text }); }
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await delay(250);
  await locator.click();
}
async function type(locator, text, speed = 14) {
  await locator.scrollIntoViewIfNeeded();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: speed });
}
async function show(locator, milliseconds) {
  await locator.scrollIntoViewIfNeeded();
  await delay(milliseconds);
}
function timecode(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
}

try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (startupError) throw startupError;
    try { await readState(); ready = true; break; } catch { await delay(200); }
  }
  if (!ready) throw new Error('The original local application did not start.');
  const initial = await readState();
  assert.equal(initial.mode, 'local');
  assert.equal(initial.asset.symbol, 'CPDEMO');
  assert.equal(initial.asset.nonMonetaryDemo, true);
  assert.equal(initial.campaigns.length, 0, 'Use a new empty CP_CAPTURE_DATA_DIR; retained campaigns are never reset.');
  browser = await playwright.chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  context = await browser.newContext({ viewport: { width: 1600, height: 900 },
    timezoneId: 'UTC', recordVideo: { dir: out, size: { width: 1600, height: 900 } } });
  zero = performance.now();
  page = await context.newPage();
  video = page.video();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (response.url().startsWith(base + '/api/') && response.request().method() === 'POST') {
      try { requests.push({ seconds: elapsed(), path: new URL(response.url()).pathname,
        status: response.status(), response: await response.json() }); } catch {}
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#appMain').waitFor({ state: 'visible' });
  scene('Creator Pool: one funded campaign, two creators.\nActual local EVM; CPDEMO is a non-monetary demo asset.');
  await delay(6500);

  scene('The sponsor sets a 250 CPDEMO pool and a 100 CPDEMO reward.\nCreating the campaign and funding it are separate actions.');
  await click(page.locator('#newCampaignBtn'));
  const drawer = page.locator('#drawer');
  await type(drawer.locator('input[name="title"]'), 'Creator Pool launch samples');
  await type(drawer.locator('textarea[name="brief"]'), 'Demo roles submit two attributed Creator Pool source samples. Sponsor selects work; creators claim rewards.', 7);
  await type(drawer.locator('input[name="reward"]'), '100', 100);
  await type(drawer.locator('input[name="budget"]'), '250', 100);
  await drawer.locator('select[name="deadlineZone"]').selectOption('UTC');
  await drawer.locator('input[name="deadline"]').fill(new Date(Date.now() + 86400000).toISOString().slice(0,16));
  await show(drawer.locator('.launch-plan'), 4000);
  await click(page.locator('#createCampaignSubmit'));
  let state = await waitState('campaign-created', s => s.campaigns.length === 1 && s.campaigns[0].metadataMatches === true);
  const cid = state.campaigns[0].id;
  await show(page.locator('.sponsor-ledger'), 2000);

  scene('Funding moves 250 CPDEMO into the actual campaign contract.\nNo creator reward is reserved or paid yet.');
  await click(page.locator(`[data-focus-key="fund:${cid}"]`));
  await waitState('campaign-funded', s => s.campaigns[0].fundedAtomic === '250000000');
  await show(page.locator('.sponsor-ledger'), 4500);

  const sourceBase = `https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/${source}/creator-pool/`;
  scene('Creator A submits an attributed public source sample.\nThe contract records the work; sponsor selection comes next.');
  await click(page.locator('#roleCreator'));
  await page.locator('#actorSelect').selectOption('creatorA');
  let form = page.locator('#detailPanel form');
  await type(form.locator('input[name="title"]'), 'Demo sample A - campaign explainer');
  await type(form.locator('input[name="workUrl"]'), sourceBase + 'README.md', 2);
  await type(form.locator('textarea[name="notes"]'), 'Demo role linking TokenJunkieLabs public source; no outside creator attribution.', 4);
  await show(page.locator('#submitWorkBtn'), 1000);
  await click(page.locator('#submitWorkBtn'));
  state = await waitState('creator-a-submitted', s => s.submissions.length === 1 && s.submissions[0].metadataMatches === true);
  const sidA = state.submissions[0].id;
  await delay(2000);

  scene('Creator B uses a separate draft and identity.\nRefreshing preserves the selected creator and unsent work.');
  form = page.locator('#detailPanel form');
  await form.locator('select[name="creator"]').selectOption('creatorB');
  form = page.locator('#detailPanel form');
  const bTitle = 'Demo sample B - reward accounting';
  const bUrl = sourceBase + 'contracts/CreatorPool.sol';
  const bNotes = 'Demo role linking TokenJunkieLabs public source; no outside creator attribution.';
  await type(form.locator('input[name="title"]'), bTitle);
  await type(form.locator('input[name="workUrl"]'), bUrl, 2);
  await type(form.locator('textarea[name="notes"]'), bNotes, 4);
  await click(page.locator('#refreshBtn'));
  await delay(500);
  assert.equal(await page.locator('#actorSelect').inputValue(), 'creatorB');
  form = page.locator('#detailPanel form');
  assert.equal(await form.locator('select[name="creator"]').inputValue(), 'creatorB');
  assert.equal(await form.locator('input[name="title"]').inputValue(), bTitle);
  assert.equal(await form.locator('input[name="workUrl"]').inputValue(), bUrl);
  assert.equal(await form.locator('textarea[name="notes"]').inputValue(), bNotes);
  await click(page.locator('#submitWorkBtn'));
  state = await waitState('creator-b-submitted', s => s.submissions.length === 2 && s.submissions.every(x => x.metadataMatches === true));
  const sidB = state.submissions.find(s => s.id !== sidA).id;
  await delay(2000);

  scene('The sponsor reviews each submission and confirms the reservation.\nTwo approvals reserve 200 CPDEMO; they do not pay the creators.');
  await click(page.locator('#roleSponsor'));
  await click(page.locator(`[data-focus-key="approve-review:${sidA}"]`));
  await show(drawer.getByRole('button', { name: 'Confirm selection and reserve', exact: true }), 4000);
  await click(drawer.getByRole('button', { name: 'Confirm selection and reserve', exact: true }));
  await waitState('creator-a-approved', s => s.submissions.find(x => x.id === sidA)?.status === 'approved');
  await click(page.locator(`[data-focus-key="approve-review:${sidB}"]`));
  await show(drawer.getByRole('button', { name: 'Confirm selection and reserve', exact: true }), 4000);
  await click(drawer.getByRole('button', { name: 'Confirm selection and reserve', exact: true }));
  await waitState('creator-b-approved', s => s.campaigns[0].reservedAtomic === '200000000');
  await show(page.locator('.sponsor-ledger'), 3000);

  scene('Creator A claims 100 CPDEMO through the original claim action.\nThe other approved reward remains reserved.');
  await click(page.locator('#roleCreator'));
  await page.locator('#actorSelect').selectOption('creatorA');
  await click(page.locator(`[data-focus-key="claim:${sidA}"]`));
  await waitState('creator-a-paid', s => s.submissions.find(x => x.id === sidA)?.status === 'claimed');
  await show(page.locator('.budget-grid'), 4000);

  scene('Closing returns only the 50 CPDEMO that is still uncommitted.\nCreator B keeps the right to claim the reserved 100 CPDEMO.');
  await click(page.locator('#roleSponsor'));
  await click(page.locator(`[data-focus-key="close-start:${cid}"]`));
  await show(page.locator('.detail-actions'), 5000);
  await click(page.locator(`[data-focus-key="close:${cid}"]`));
  state = await waitState('closed-with-reward-reserved', s => s.campaigns[0].closed === true);
  assert.equal(state.campaigns[0].reservedAtomic, '100000000');
  assert.equal(state.campaigns[0].refundedAtomic, '50000000');
  await show(page.locator('.sponsor-ledger'), 6000);

  scene('Creator B claims after the campaign has closed.\nThe reserved reward is paid by the same campaign contract.');
  await click(page.locator('#roleCreator'));
  await page.locator('#actorSelect').selectOption('creatorB');
  await show(page.locator(`[data-focus-key="claim:${sidB}"]`), 3000);
  await click(page.locator(`[data-focus-key="claim:${sidB}"]`));
  state = await waitState('creator-b-paid-after-close', s => s.submissions.find(x => x.id === sidB)?.status === 'claimed');
  assert.equal(state.campaigns[0].paidAtomic, '200000000');
  assert.equal(state.campaigns[0].availableAtomic, '0');
  assert.equal(state.campaigns[0].reservedAtomic, '0');
  assert.equal(state.poolBalanceAtomic, '0');
  assert.equal(state.balances.creatorA, '100000000');
  assert.equal(state.balances.creatorB, '100000000');
  assert.equal(errors.length, 0, errors.join('; '));
  await delay(2000);

  scene('Funded 250 = paid to creators 200 + refunded to sponsor 50.\nBoth rewards are claimed; no campaign funds remain locked.');
  await click(page.locator('#roleSponsor'));
  await show(page.locator('.sponsor-ledger'), 6500);
  await page.screenshot({ path: path.join(out, 'final-accounting.png') });
  await show(page.locator('#timeline'), 4500);
  finishedAt = elapsed();
  assert.ok(finishedAt <= 180, `Continuous capture exceeded the official180-second maximum: ${finishedAt}`);
  await fs.writeFile(path.join(out, 'final-state.json'), JSON.stringify(state, null, 2));
} catch (error) {
  errors.push(error.stack || error.message);
  if (page) {
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(out, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  process.exitCode = 1;
} finally {
  finishedAt ??= zero ? elapsed() : 0;
  if (context) await context.close();
  let rawVideo = null;
  if (video) rawVideo = await video.path();
  if (browser) await browser.close();
  process.emit('SIGTERM');
  await running;
  await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify({
    source, startedUTC: new Date(Date.now() - finishedAt * 1000).toISOString(),
    durationSeconds: finishedAt, rawVideo: rawVideo && path.basename(rawVideo),
    viewport: {width:1600,height:900}, originalLauncher:true,
    mutations:'Original UI only; checkpoint API calls are read-only.',
    scenes, checkpoints, requests, errors
  }, null, 2));
  const captions = scenes.map((item,i) => `${i+1}\n${timecode(item.seconds)} --> ${timecode(scenes[i+1]?.seconds ?? finishedAt)}\n${item.text}\n`).join('\n');
  await fs.writeFile(path.join(out, 'Creator-Pool-Live-Demo.srt'), captions);
  console.log(JSON.stringify({complete: errors.length===0, seconds:finishedAt, rawVideo, errors}));
}
