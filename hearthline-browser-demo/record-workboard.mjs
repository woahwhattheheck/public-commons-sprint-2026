#!/usr/bin/env node
// One actual household workflow. Requires an existing Playwright/Chromium install.
import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  output: { type: 'string', default: 'hearthline-workboard-recording' },
  dwell: { type: 'string', default: '2' },
  'no-video': { type: 'boolean', default: false },
} });
const dwell = Number(values.dwell);
if (!Number.isFinite(dwell) || dwell < 0 || dwell > 8) throw new Error('--dwell must be between 0 and 8 seconds');
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const statePath = join(output, 'live-workspace.json');
const log = createWriteStream(join(output, 'server.log'), { flags: 'wx', mode: 0o600 });
const timeline = [], pageErrors = [];
const started = performance.now();
let host, browser, context, page, native, url, phase = 'starting', recording;
const save = (name, data) => writeFile(join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const elapsed = () => Math.round((performance.now() - started) / 10) / 100;
const chapter = async label => {
  phase = label; timeline.push({ seconds: elapsed(), label });
  console.log(JSON.stringify({ phase: label, seconds: elapsed() }));
  if (dwell) await page.waitForTimeout(dwell * 1000);
};

async function startHost(port = 0) {
  const child = spawn(process.execPath, ['--max-old-space-size=128', join(here, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), HEARTHLINE_STORE: statePath, HEARTHLINE_EPHEMERAL: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  host = child;
  child.stderr.on('data', chunk => log.write(chunk));
  return await new Promise((done, fail) => {
    let pending = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Host startup timed out')); }, 15000);
    function finish(error, value) {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) fail(error); else done(value);
    }
    child.once('error', finish);
    child.once('exit', (code, signal) => finish(new Error('Host exited during startup: ' + (signal ?? code))));
    child.stdout.on('data', chunk => {
      log.write(chunk); pending += chunk.toString();
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n'), line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { const data = JSON.parse(line); if (data.url) finish(null, data.url); } catch {}
      }
    });
  });
}
async function stopHost() {
  const child = host; host = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(done => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
}
async function client(base) {
  let session, id = 1, protocol = '2025-11-25';
  async function rpc(method, params = {}, initialize = false, notification = false) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (!initialize) { headers['mcp-session-id'] = session; headers['mcp-protocol-version'] = protocol; }
    const response = await fetch(base + '/mcp', {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: id++ }), method, params }),
    });
    if (notification) { assert.equal(response.status, 202); return; }
    const body = await response.json();
    if (!response.ok || body?.error) throw new Error(body?.error?.message ?? 'MCP HTTP ' + response.status);
    if (initialize) session = response.headers.get('mcp-session-id');
    return body.result;
  }
  const initialized = await rpc('initialize', { protocolVersion: protocol, clientInfo: { name: 'Hearthline workboard recorder', version: '1.0.0' }, capabilities: {} }, true);
  assert.equal(initialized.protocolVersion, protocol); assert.ok(session);
  await rpc('notifications/initialized', {}, false, true);
  const tools = (await rpc('tools/list')).tools;
  assert.equal(tools.length, 12);
  return {
    tools: tools.map(tool => tool.name),
    async call(name, args = {}) {
      const result = await rpc('tools/call', { name, arguments: args });
      if (result.isError) throw new Error(result.content?.map(item => item.text ?? '').join(' ') || 'Native tool failed');
      return result.structuredContent;
    },
  };
}
async function idle() {
  await page.waitForFunction(() => !document.getElementById('prepare').disabled, null, { timeout: 15000 });
}
async function click(selector) { await page.locator(selector).click(); await idle(); }
async function visit() {
  await page.goto(url + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('connection').textContent.includes('12 tools'));
  await idle();
}
async function editTask(taskId, fields) {
  const card = page.locator('[data-task-id="' + taskId + '"]'), details = card.locator('details');
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  const form = details.locator('form');
  for (const [name, value] of Object.entries(fields)) {
    const input = form.locator('[name="' + name + '"]');
    if (name === 'status') await input.selectOption(value); else await input.fill(String(value));
  }
  await form.locator('button[type="submit"]').click(); await idle();
}
async function quickTask(taskId) {
  await page.locator('[data-task-id="' + taskId + '"]').getByRole('button', { name: /^(Mark done|Reopen task)$/ }).click();
  await idle();
}
const exec = promisify(execFile);
try {
  url = await startHost();
  native = await client(url);
  const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
  const { chromium } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
  browser = await chromium.launch({
    headless: true,
    slowMo: 80,
    ...(process.env.CHROMIUM_BINARY ? { executablePath: process.env.CHROMIUM_BINARY } : {}),
    args: ['--disable-dev-shm-usage', '--renderer-process-limit=1', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 }, locale: 'en-US',
    ...(!values['no-video'] ? { recordVideo: { dir: join(output, 'raw'), size: { width: 1440, height: 960 } } } : {}),
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  recording = page.video();
  await visit();
  await chapter('Open the persistent household workspace through the native 12-tool MCP service');
  await click('#prepare');
  let saved = (await native.call('hearthline_list_missions')).missions;
  assert.equal(saved.length, 1);
  const missionId = saved[0].id;
  const getMission = async () => (await native.call('hearthline_get_mission', { missionId })).mission;
  const getBoard = async () => (await native.call('hearthline_get_workboard', { missionId })).workboard;
  const inventory = async () => (await native.call('hearthline_get_inventory')).inventory;
  let mission = await getMission(), board = await getBoard();
  const water = board.tasks.find(task => task.id === 'supply_water');
  const batteries = board.tasks.find(task => task.id === 'supply_battery_pack');
  assert.ok(water && batteries);
  const shopping = mission.actions.find(action => action.kind === 'shopping_proposal');
  const reminder = mission.actions.find(action => action.kind === 'household_reminder');
  assert.ok(shopping && reminder);
  await chapter('Create a plan from the current supply gaps');

  await page.locator('#action').selectOption(shopping.id);
  await click('#approve'); await click('#execute');
  const originalShopping = (await getMission()).actions.find(action => action.id === shopping.id);
  assert.equal(originalShopping.status, 'complete');
  await chapter('Approve the original shopping handoff before recording the restock');

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await editTask(water.id, { assignee: 'Jordan', dueDate: tomorrow, notes: 'Water is counted and stored on the kitchen shelf.', quantityOnHand: water.target, status: 'done' });
  await editTask(batteries.id, { assignee: 'Taylor', dueDate: tomorrow, notes: 'Count the spare packs before the household check-in.', status: 'doing' });
  const addDetails = page.locator('.add-task');
  if (!await addDetails.evaluate(node => node.open)) await addDetails.locator('summary').click();
  const add = page.locator('#add-task-form');
  await add.locator('[name="title"]').fill('Secure the porch furniture');
  await add.locator('[name="assignee"]').fill('Sam');
  await add.locator('[name="dueDate"]').fill(tomorrow);
  await add.locator('[name="notes"]').fill('Move loose chairs into the garage and clear the drain.');
  await add.locator('button[type="submit"]').click(); await idle();
  board = await getBoard();
  const custom = board.tasks.find(task => task.title === 'Secure the porch furniture');
  assert.ok(custom);
  assert.equal(board.tasks.find(task => task.id === water.id).status, 'done');
  assert.equal((await inventory()).items.water, water.target);
  await chapter('Assign household work, record notes and finish one restock atomically');

  // A real second MCP client changes the saved task after the browser last read it.
  await native.call('hearthline_update_task', { missionId, taskId: custom.id, expectedRevision: custom.revision, changes: { notes: 'The second household client checked the drain.' } });
  await editTask(custom.id, { notes: 'An older form must not replace the newer household note.' });
  assert.match(await page.locator('#verdict').textContent(), /Stopped:/);
  assert.equal((await getBoard()).tasks.find(task => task.id === custom.id).notes, 'The second household client checked the drain.');
  await chapter('An outdated form recovers the current task without overwriting another client');

  await page.locator('#stock-form [name="battery_pack"]').fill(String(batteries.target));
  await page.locator('#stock-form button[type="submit"]').click(); await idle();
  await quickTask(batteries.id);
  await quickTask(custom.id);
  await quickTask('household_check_in');
  board = await getBoard();
  assert.equal(board.summary.done, board.summary.total);
  assert.equal(board.summary.supplyGaps, 0);
  await chapter('Finish the stock count and complete the household work');

  await page.locator('#action').selectOption(reminder.id);
  await click('#approve'); await click('#execute');
  let runtime = await (await fetch(url + '/demo/status')).json();
  assert.equal(runtime.localOutboxItems, 1); assert.equal(runtime.receipts, 2);
  assert.deepEqual((await getMission()).actions.find(action => action.id === shopping.id), originalShopping);
  const beforeRestart = { mission: await getMission(), workboard: await getBoard(), inventory: await inventory(), runtime };
  await save('before-host-reopen.json', beforeRestart);
  await chapter('Original approved shopping quantities remain intact after the stock changes');

  const port = Number(new URL(url).port), previousHostPid = host.pid;
  await stopHost();
  url = await startHost(port); native = await client(url); await visit();
  assert.notEqual(host.pid, previousHostPid);
  assert.equal(await page.locator('#mission-picker').inputValue(), missionId);
  const afterRestart = { mission: await getMission(), workboard: await getBoard(), inventory: await inventory(), runtime: await (await fetch(url + '/demo/status')).json() };
  assert.deepEqual(afterRestart.mission, beforeRestart.mission);
  assert.deepEqual(afterRestart.workboard, beforeRestart.workboard);
  assert.deepEqual(afterRestart.inventory, beforeRestart.inventory);
  await save('after-host-reopen.json', afterRestart);
  await chapter('Stop and reopen the whole host: assignments, notes, stock and completed work return');

  const stockBeforeReopen = await inventory();
  await quickTask(custom.id);
  assert.equal((await getBoard()).tasks.find(task => task.id === custom.id).status, 'todo');
  assert.deepEqual(await inventory(), stockBeforeReopen);
  await quickTask(custom.id);
  const runtimeDetails = page.locator('#runtime-details');
  if (!await runtimeDetails.evaluate(node => node.open)) await page.locator('#runtime-details > summary').click();
  await click('#replay');
  assert.match(await page.locator('#verdict').textContent(), /PASS: same receipt/);
  await page.locator('#runtime-details > summary').click();

  await click('#prepare');
  saved = (await native.call('hearthline_list_missions')).missions;
  assert.equal(saved.length, 2);
  const second = saved.find(item => item.id !== missionId);
  const secondMission = (await native.call('hearthline_get_mission', { missionId: second.id })).mission;
  assert.equal(secondMission.actions.some(action => action.kind === 'shopping_proposal'), false);
  assert.deepEqual(await inventory(), stockBeforeReopen);
  await page.locator('#mission-picker').selectOption(missionId); await click('#open-mission');
  await chapter('A new plan uses the restocked inventory; return to the original completed mission');

  const downloadPromise = page.waitForEvent('download');
  await click('#download-workspace');
  const download = await downloadPromise;
  await download.saveAs(join(output, 'downloaded-workspace.json'));
  const downloaded = JSON.parse(await readFile(join(output, 'downloaded-workspace.json'), 'utf8'));
  assert.equal(Object.keys(downloaded.missions).length, 2);
  assert.equal(downloaded.receipts.length, 2); assert.equal(downloaded.outbox.length, 1);
  assert.deepEqual(downloaded.missions[missionId].actions.find(action => action.id === shopping.id), originalShopping);
  assert.equal(downloaded.inventory.water, water.target);
  assert.equal(downloaded.inventory.battery_pack, batteries.target);
  await page.locator('#workboard').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'workboard-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workboard').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(output, 'workboard-mobile.png'), fullPage: true });
  await chapter('Download the real workspace and use the workboard on a narrow screen');
  assert.deepEqual(pageErrors, []);

  await context.close(); context = null;
  if (recording) {
    await recording.saveAs(join(output, 'hearthline-workboard.webm'));
    await rm(join(output, 'raw'), { recursive: true, force: true });
  }
  await browser.close(); browser = null; await stopHost();
  let duration = null;
  if (recording) {
    try {
      await exec('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-i', join(output, 'hearthline-workboard.webm'), '-c:v', 'libx264', '-threads', '1', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'hearthline-workboard.mp4')]);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', join(output, 'hearthline-workboard.webm')]);
      duration = Number(probe.stdout.trim()); assert.ok(duration > 0 && duration < 180, 'Captured video must be under three minutes');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const bytes = await readFile(join(output, 'downloaded-workspace.json'));
  const result = {
    status: 'passed', schema: 'hearthline.household-journey/v1', sourceCommit: process.env.GITHUB_SHA ?? 'local-unversioned',
    source: 'original Hearthline MCP and browser source', tools: native.tools, missionId, savedMissions: 2,
    completedTasks: beforeRestart.workboard.summary.total,
    localOutboxItems: 1, receipts: 2, originalShoppingPreserved: true, hostReopened: true,
    staleTaskRecovered: true, stockNotResetByNewMission: true, mobileWidth: 390, pageErrors,
    durationSeconds: duration, timeline, downloadedWorkspaceSha256: createHash('sha256').update(bytes).digest('hex'),
    weather: 'sample fixture', household: 'recording example', alexaDevice: false, externalMessage: false, purchase: false,
  };
  await save('journey.json', result);
  console.log(JSON.stringify({ status: result.status, output, savedMissions: 2, completedTasks: result.completedTasks, durationSeconds: duration }));
} catch (error) {
  const visible = await page?.evaluate(() => ({ connection: document.getElementById('connection')?.textContent, verdict: document.getElementById('verdict')?.textContent })).catch(() => null);
  await save('journey-failure.json', { status: 'failed', phase, error: error.stack, visible, timeline, pageErrors });
  console.error(error.stack); process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopHost();
  await new Promise(done => log.end(done));
}
