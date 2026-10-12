#!/usr/bin/env node
/** Original Analysis browser -> collector -> retained publication receiving.
 * Called only by analysis_lineage_native.py with its immutable configuration.
 */
import { promises as fs, createWriteStream } from 'node:fs';
import { constants as FS } from 'node:fs';
import { join, dirname, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { runAnalysisLineageMcpJourney } from './analysis_lineage_mcp.mjs';

const SCHEMA = 'stellar-forge.analysis-lineage-native-receiving.v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ID = /^[a-f0-9]{32}$/, SHA = /^[a-f0-9]{64}$/;
const need = (value, message) => { if (!value) throw new Error(message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function regular(path, limit = 64 * 1024 * 1024) {
  const handle = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= limit, 'A bounded original regular file is required: ' + path);
    const bytes = await handle.readFile(), after = await handle.stat();
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === before.size,
      'Original file changed during read');
    return bytes;
  } finally { await handle.close(); }
}
async function present(path) { try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function record(path) {
  const handle = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await handle.stat(); need(before.isFile(), 'Original file must be regular');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const block of handle.createReadStream({ autoClose: false })) { hash.update(block); bytes += block.length; }
    const after = await handle.stat();
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes === before.size,
      'Original file changed during verification');
    return { path: resolve(path), bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function directory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const s = await fs.lstat(path);
  need(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077) &&
    (!process.getuid || s.uid === process.getuid()), 'Use an original caller-owned private directory');
  return path;
}
async function syncDirectory(path) { const h = await fs.open(path, FS.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }
async function write(path, bytes, { immutable = false } = {}) {
  bytes = Buffer.from(bytes);
  if (immutable && await present(path)) {
    need((await regular(path, bytes.length + 1)).equals(bytes), 'Original immutable file changed: ' + path);
    return;
  }
  const pending = path + '.pending';
  await fs.unlink(pending).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const h = await fs.open(pending, 'wx', 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  await fs.rename(pending, path);
  await syncDirectory(dirname(path));
}
async function verifyArtifacts(value, root) {
  if (Array.isArray(value)) { for (const item of value) await verifyArtifacts(item, root); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && isAbsolute(value.path) && value.path.startsWith(root + sep) &&
      Number.isSafeInteger(value.bytes) && SHA.test(value.sha256 ?? '')) {
    const actual = await record(value.path);
    need(actual.bytes === value.bytes && actual.sha256 === value.sha256, 'Retained receiving file changed: ' + value.path);
  }
  for (const item of Object.values(value)) await verifyArtifacts(item, root);
}
async function waitFor(fn, description, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('Original continuation is still waiting for ' + description);
}
async function stopChild(child, signal = 'SIGINT') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([new Promise(r => child.once('exit', r)), delay(20_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
  }
}

class Collector {
  constructor(configuration, log) {
    this.config = configuration; this.pending = new Map(); this.finished = false;
    this.child = spawn(configuration.node, [join(HERE, 'analysis_lineage_collector.mjs'),
      '--directory', join(configuration.directory, 'collector'), '--operation-id', configuration.operation_id],
      { cwd: configuration.checkout, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.pipe(log, { end: false });
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.rejectReady = rejectReady;
      const lines = createInterface({ input: this.child.stdout });
      lines.on('line', line => {
        try {
          need(Buffer.byteLength(line) <= 2 * 1024 * 1024, 'Collector control reply exceeds its bound');
          const value = JSON.parse(line);
          if (value.state === 'READY') {
            need(value.operationId === configuration.operation_id && value.identity?.workspaceId &&
              isAbsolute(value.connectionFile) && isAbsolute(value.producerTokenFile), 'Original collector READY identity changed');
            this.identity = value; resolveReady(value); return;
          }
          const pending = this.pending.get(value.id);
          if (!pending) throw new Error('Unexpected original collector action reply');
          this.pending.delete(value.id);
          if (value.ok) pending.resolve(value.result);
          else pending.reject(new Error(typeof value.error === 'string' ? value.error : JSON.stringify(value.error)));
        } catch (error) { rejectReady(error); for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
      });
      this.child.once('error', rejectReady);
      this.child.once('exit', (code, signal) => {
        this.finished = true;
        const error = new Error('Original collector helper ended: ' + code + '/' + signal);
        rejectReady(error); for (const p of this.pending.values()) p.reject(error); this.pending.clear();
      });
    });
  }
  async call(id, action, args = {}) {
    await this.ready; need(!this.finished, 'Original collector helper is not running');
    need(!this.pending.has(id), 'Original collector action is already pending');
    const answer = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(JSON.stringify({ id, action, args }) + '\n', error => {
      if (error) { this.pending.get(id)?.reject(error); this.pending.delete(id); }
    });
    return answer;
  }
  async close() {
    if (this.finished) return;
    try {
      await Promise.race([this.call('close-' + randomUUID().replaceAll('-', ''), 'close'), delay(15_000)]);
    } finally {
      this.child.stdin.end(); await stopChild(this.child, 'SIGTERM');
    }
  }
}

async function main(argv) {
  need(argv.length === 4 && argv[0] === '--configuration' && argv[2] === '--phase' &&
    ['publish', 'restore'].includes(argv[3]), 'Use the original configuration and publish/restore phase');
  const phase = argv[3], configPath = resolve(argv[1]), configRaw = await regular(configPath, 1024 * 1024);
  const c = JSON.parse(configRaw), configurationSha = digest(configRaw);
  need(c.schema === SCHEMA && ID.test(c.workspace_id) && ID.test(c.root_job_id) && isAbsolute(c.directory) &&
    isAbsolute(c.analysis_directory) && isAbsolute(c.checkout), 'Original receiving configuration is invalid');
  const root = await directory(resolve(c.directory)), output = await directory(join(root, 'output'));
  need(configPath === join(root, 'browser-' + phase + '-configuration.json'), 'Original configuration path changed');
  const resultPath = join(root, 'browser-' + phase + '-result.json');
  if (await present(resultPath)) {
    const result = JSON.parse(await regular(resultPath));
    need(result.schema === SCHEMA && result.phase === phase && result.operation_id === c.operation_id &&
      result.workspace_id === c.workspace_id && result.configuration_sha256 === configurationSha,
      'Completed browser result has another original configuration');
    await verifyArtifacts(result, root);
    console.log(JSON.stringify({ state: 'COMPLETE', phase, reused: true, result: resultPath }));
    return;
  }
  const journalPath = join(root, 'browser-' + phase + '-journal.json');
  let journal = await present(journalPath) ? JSON.parse(await regular(journalPath)) : {
    schema: SCHEMA, phase, operation_id: c.operation_id, workspace_id: c.workspace_id,
    configuration_sha256: configurationSha, requests: {}, files: {}, screenshots: {}, steps: {},
    browser_journal: null, created_at: new Date().toISOString(),
  };
  need(journal.schema === SCHEMA && journal.phase === phase && journal.operation_id === c.operation_id &&
    journal.workspace_id === c.workspace_id && journal.configuration_sha256 === configurationSha,
    'Original browser journal binding changed');
  let writes = Promise.resolve();
  function checkpoint() {
    const captured = json(journal);
    writes = writes.then(() => write(journalPath, captured));
    return writes;
  }
  await checkpoint();

  let host, collector, context, privateRuntime, childOutput, collectorOutput, page, primaryError;
  const browserErrors = [];
  async function api(path, body) {
    const response = await fetch(host.origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'X-Analysis-Capability': host.capability, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || 'Original Analysis request failed'), { code: value.error, status: response.status });
    return value;
  }
  async function seedBrowser() {
    const p = journal.requests.plan, publication = journal.requests.publication;
    const saved = journal.browser_journal || {
      schema: 'stellar-forge.analysis-lineage-browser.v1', workspace_id: c.workspace_id,
      selected_plan_id: null, plan_requests: {}, publication_requests: {}, retired_requests: [],
    };
    need(saved.schema === 'stellar-forge.analysis-lineage-browser.v1' && saved.workspace_id === c.workspace_id &&
      saved.plan_requests && saved.publication_requests && Array.isArray(saved.retired_requests),
      'Original browser recovery journal changed');
    // The actual route request was saved before dispatch. It may be newer than
    // the last browser-journal capture when the original process was interrupted.
    if (p) {
      const previous = saved.plan_requests[p.id];
      need(!previous || same(previous.body, p), 'Original captured review request differs from browser history');
      if (!previous) saved.plan_requests[p.id] = { body: p, state: 'PENDING', error: null };
      saved.selected_plan_id = p.id;
    } else if (c.plan_id) saved.selected_plan_id = c.plan_id;
    if (publication) {
      need(publication.plan_id === (p?.id || c.plan_id), 'Original captured publication has another plan');
      const previous = saved.publication_requests[publication.plan_id];
      need(!previous || same(previous.body, publication), 'Original captured publication differs from browser history');
      if (!previous) saved.publication_requests[publication.plan_id] = { body: publication, state: 'PENDING', error: null };
    }
    journal.browser_journal = saved; await checkpoint();
    const key = 'sf-analysis-lineage-v1:' + c.workspace_id;
    await context.addInitScript(({ key, saved }) => {
      if (location.protocol === 'http:' && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    }, { key, saved });
  }
  async function captureBrowser() {
    const raw = await page.evaluate(key => localStorage.getItem(key), 'sf-analysis-lineage-v1:' + c.workspace_id);
    if (raw) {
      const value = JSON.parse(raw);
      need(value.workspace_id === c.workspace_id, 'Original browser workspace changed');
      journal.browser_journal = value; await checkpoint();
    }
  }
  async function captureFile(map, key, finalPath, produce) {
    const old = journal[map][key];
    if (old?.state === 'COMPLETE') {
      const actual = await record(old.path);
      need(actual.bytes === old.bytes && actual.sha256 === old.sha256, 'Retained capture changed');
      return { path: old.path, bytes: old.bytes, sha256: old.sha256 };
    }
    const pending = finalPath + '.captured';
    let captured = old;
    if (captured) {
      need(captured.state === 'CAPTURED' && captured.path === finalPath && captured.pending === pending,
        'Original captured file binding changed');
      const source = await present(finalPath) ? finalPath : pending;
      const actual = await record(source);
      need(actual.bytes === captured.bytes && actual.sha256 === captured.sha256, 'Original captured bytes changed');
    } else {
      await fs.unlink(pending).catch(e => { if (e.code !== 'ENOENT') throw e; });
      await produce(pending);
      const actual = await record(pending);
      captured = { state: 'CAPTURED', path: finalPath, pending, bytes: actual.bytes, sha256: actual.sha256 };
      journal[map][key] = captured; await checkpoint();
    }
    if (await present(finalPath)) {
      const actual = await record(finalPath);
      need(actual.bytes === captured.bytes && actual.sha256 === captured.sha256, 'Original final capture differs');
      await fs.unlink(pending).catch(e => { if (e.code !== 'ENOENT') throw e; });
    } else await fs.rename(pending, finalPath);
    await syncDirectory(dirname(finalPath));
    journal[map][key] = { state: 'COMPLETE', path: finalPath, bytes: captured.bytes, sha256: captured.sha256 };
    await checkpoint();
    return { path: finalPath, bytes: captured.bytes, sha256: captured.sha256 };
  }
  async function download(name) {
    return captureFile('files', name, join(output, (phase === 'restore' ? 'restored-' : '') + 'lineage-' + name), async pending => {
      const event = page.waitForEvent('download');
      await page.locator('[data-lineage-download="' + name + '"]').click();
      const item = await event;
      need((await item.failure()) === null, 'Original browser download failed');
      await item.saveAs(pending);
      await fs.chmod(pending, 0o600);
    });
  }
  async function screenshot(name, width) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => ({ width: innerWidth,
      scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    need(geometry.scroll <= geometry.width + 1, 'Original lineage page overflows its viewport');
    return captureFile('screenshots', name, join(output, 'lineage-' + phase + '-' + name + '.png'),
      async pending => { await page.screenshot({ path: pending, type: 'png', fullPage: true }); await fs.chmod(pending, 0o600); });
  }
  async function openPlan(identifier) {
    await page.locator('#lineage-plan-id').fill(identifier);
    await page.locator('#lineage-open-plan').click();
    await page.locator('#lineage-plan-panel').waitFor({ state: 'visible' });
    await waitFor(async () => !(await page.locator('#lineage-plan-refresh').isDisabled()), 'the exact original publication');
    const plan = await api('/api/lineage/plans/' + identifier);
    need(plan.id === identifier && plan.workspace_id === c.workspace_id &&
      plan.request.job_id === c.root_job_id, 'Original saved plan changed');
    return plan;
  }
  async function currentJob(plan) {
    const fresh = await api('/api/lineage/plans/' + plan.id);
    const request = journal.requests.publication;
    if (!fresh.publication && !request) return null;
    const id = fresh.publication?.job_id || request.id;
    let job;
    try { job = await api('/api/jobs/' + id); }
    catch (error) {
      if (!fresh.publication && request && (error.status === 404 || error.code === 'ANALYSIS_JOB_NOT_FOUND')) return null;
      throw error;
    }
    need(job.id === id && job.kind === 'lineage-publish' &&
      same(job.request, { id, plan_id: plan.id, plan_sha256: plan.plan_sha256 }),
      'Original publication request changed');
    return job;
  }

  try {
    let connectionFile = null;
    if (phase === 'publish') {
      collectorOutput = createWriteStream(join(root, 'collector.stderr.log'), { flags: 'a', mode: 0o600 });
      collector = new Collector(c, collectorOutput);
      const ready = await collector.ready;
      if (journal.collector_workspace_id) need(journal.collector_workspace_id === ready.identity.workspaceId, 'Original collector workspace changed');
      journal.collector_workspace_id = ready.identity.workspaceId;
      connectionFile = join(root, 'lineage-connections.json');
      const connection = { schema: 'stellar-forge.analysis-lineage-connections.v1', connections: [{
        name: 'receiving', label: 'Original receiving collector', connection_file: ready.connectionFile,
        expected_workspace_id: ready.identity.workspaceId, token_file: ready.producerTokenFile, request_timeout_ms: 10_000,
      }] };
      await write(connectionFile, json(connection), { immutable: true }); await checkpoint();
    }
    const command = ['-B', '-m', 'stellar_forge_buyer.analysis_workspace', '--database', c.analysis_directory];
    if (phase === 'publish') command.push('--checkout', c.checkout, '--node', c.node, '--lineage-connections', connectionFile);
    command.push('serve', '--port', '0');
    childOutput = createWriteStream(join(root, 'analysis-' + phase + '.log'), { flags: 'a', mode: 0o600 });
    const child = spawn(c.python, command, { cwd: c.checkout, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    host = { child };
    child.stdout.pipe(childOutput, { end: false }); child.stderr.pipe(childOutput, { end: false });
    let spawnError; child.once('error', error => { spawnError = error; });
    const launch = await waitFor(async () => {
      if (spawnError) throw spawnError;
      need(child.exitCode === null && child.signalCode === null, 'Original Analysis server ended before ready');
      try {
        const value = JSON.parse(await regular(join(c.analysis_directory, 'analysis-launch.json'), 65_536));
        if (value.pid !== child.pid) return false;
        need(value.workspace_id === c.workspace_id, 'Original Analysis launch workspace changed');
        return value;
      } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }, 'the original Analysis host');
    const address = new URL(launch.url);
    need(address.protocol === 'http:' && address.hostname === '127.0.0.1' && address.hash.length > 1,
      'Original Analysis host capability is invalid');
    host.origin = address.origin; host.capability = address.hash.slice(1);
    const nativeConfig = await api('/api/lineage/configuration');
    need(nativeConfig.workspace_id === c.workspace_id && (phase !== 'restore' || nativeConfig.can_publish === false),
      'Original offline receiving configuration changed');
    const tempRoot = await fs.realpath(c.temporary_root || tmpdir());
    need((await fs.stat(tempRoot)).isDirectory(), 'Existing temporary root is required');
    privateRuntime = await fs.mkdtemp(join(tempRoot, 'analysis-lineage-native-')); await fs.chmod(privateRuntime, 0o700);
    const { chromium } = await import(pathToFileURL(c.playwright).href);
    context = await chromium.launchPersistentContext(join(privateRuntime, 'browser'), {
      headless: true, executablePath: c.chromium, viewport: { width: 1440, height: 1000 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { ...process.env, TMPDIR: privateRuntime },
      acceptDownloads: true,
    });
    await seedBrowser();
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    if (phase === 'publish') {
      await context.route(host.origin + '/api/lineage/plans', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const request = route.request().postDataJSON();
        need(request.job_id === c.root_job_id && request.expected_workspace_id === journal.collector_workspace_id,
          'Original frozen review target changed');
        if (journal.requests.plan) need(same(journal.requests.plan, request), 'Original plan request changed');
        else journal.requests.plan = request;
        await checkpoint();
        const response = await route.fetch();
        if (!journal.steps.plan_reply && response.status() === 201) {
          const raw = await response.body(), value = JSON.parse(raw);
          need(value.id === request.id && same(value.request, request), 'Actual saved review receipt changed');
          journal.steps.plan_reply = { state: 'CAPTURED_FOR_DISCARD', status: response.status(),
            plan_id: request.id, response_sha256: digest(raw), bytes: raw.length };
          await checkpoint(); await route.abort('failed');
          journal.steps.plan_reply.state = 'ACTUAL_REPLY_DISCARDED'; await checkpoint(); return;
        }
        return route.fulfill({ response });
      });
      await context.route(host.origin + '/api/start/lineage-publish', async route => {
        const request = route.request().postDataJSON();
        need(ID.test(request.id) && request.plan_id === journal.requests.plan?.id &&
          SHA.test(request.plan_sha256), 'Original publication request is invalid');
        if (journal.requests.publication) need(same(journal.requests.publication, request), 'Original publication request changed');
        else journal.requests.publication = request;
        await checkpoint(); return route.continue();
      });
    }
    await page.goto(host.origin + '/lineage#' + host.capability);
    await waitFor(async () => (await page.locator('#lineage-workspace').textContent()) === c.workspace_id &&
      !(await page.locator('#lineage-refresh').isDisabled()), 'the original lineage operator page');

    let plan;
    if (phase === 'restore') {
      plan = await openPlan(c.plan_id);
      need(plan.plan_sha256 === c.plan_sha256 && plan.publication?.job_id === c.publication_job_id &&
        plan.publication.status === 'ACCEPTED', 'Original restored accepted publication changed');
    } else {
      if (!journal.requests.plan) {
        await page.locator('#lineage-job').fill(c.root_job_id);
        await page.locator('#lineage-include-sql').uncheck();
        await page.locator('#lineage-review').click();
        await page.locator('#lineage-review-panel').waitFor({ state: 'visible' });
        await waitFor(async () => !(await page.locator('#lineage-connection').isDisabled()), 'the actual review');
        await page.locator('#lineage-connection').selectOption('receiving');
        await page.locator('#lineage-title').fill('Retained Analysis lineage receiving');
        await page.locator('#lineage-note').fill('Publish the exact original completed source, query/export and workbook history to the selected collector.');
        await page.locator('#lineage-save-plan').click();
        await waitFor(() => journal.requests.plan, 'the original captured review request');
        await waitFor(async () => !(await page.locator('#lineage-refresh').isDisabled()), 'review reply recovery');
      }
      if (await page.locator('#lineage-recovery').isVisible()) {
        await page.locator('#lineage-recover-plan').click();
        await waitFor(async () => !(await page.locator('#lineage-refresh').isDisabled()), 'the exact saved-review continuation');
      }
      plan = await openPlan(journal.requests.plan.id);
      need(same(plan.request, journal.requests.plan), 'Original saved review request changed');
      if (!journal.steps.plan_reply) {
        journal.steps.plan_reply = { state: 'ORIGINAL_SAVE_RECOVERED_WITHOUT_DISCARD_RECEIPT', plan_id: plan.id };
        await checkpoint();
      }
      await captureBrowser();
      const source = await download('events.json');
      need(source.sha256 === plan.events_sha256 && source.bytes === plan.events_bytes, 'Frozen event source changed');
      if (plan.publication?.status !== 'ACCEPTED') {
        const arm = await collector.call('arm-' + plan.id, 'arm_loss', {
          operationId: plan.operation_id, sourceSha256: plan.events_sha256,
        });
        journal.steps.collector_loss_arm = arm; await checkpoint();
        let job = await currentJob(plan);
        if (!job) {
          const control = journal.requests.publication ? '#lineage-continue' : '#lineage-publish';
          await page.locator(control).click();
          await waitFor(() => journal.requests.publication, 'the original publication request');
        }
        job = await waitFor(async () => {
          const value = await currentJob(plan); return value && value.status !== 'RUNNING' ? value : false;
        }, 'the original interrupted publication', 120_000);
        await page.locator('#lineage-read-publication').click();
        await waitFor(async () => !(await page.locator('#lineage-refresh').isDisabled()), 'the original attempt read');
        const after = await api('/api/lineage/plans/' + plan.id);
        if (after.publication?.status !== 'ACCEPTED') {
          need(['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.status), 'Original publication requires explicit attention');
          journal.steps.interrupted_publication = { id: job.id, status: job.status, error: job.error, progress: job.progress };
          await checkpoint();
          const restarted = await collector.call('restart-' + plan.id, 'restart');
          journal.steps.collector_restart = restarted; await checkpoint();
          await page.locator('#lineage-continue').click();
          await waitFor(async () => {
            const value = await currentJob(plan); return value?.status === 'COMPLETE' ? value : false;
          }, 'the same source/key acknowledgement', 120_000);
        }
      }
      await page.locator('#lineage-plan-refresh').click();
      await waitFor(async () => !(await page.locator('#lineage-refresh').isDisabled()), 'the accepted original publication');
      plan = await api('/api/lineage/plans/' + plan.id);
      need(plan.publication?.status === 'ACCEPTED' && plan.publication.accepted?.native?.receipt?.source?.id === plan.events_sha256,
        'Original collector acknowledgement is absent');
      const job = await currentJob(plan);
      need(job.status === 'COMPLETE', 'Original Analysis publication is not complete');
      journal.requests.publication = job.request; await checkpoint();
      const sourceArgs = { operationId: plan.operation_id, sourcePath: source.path, sourceSha256: plan.events_sha256,
        sourceName: plan.source_name, sourceUrl: plan.source_url, eventCount: plan.summary.event_count };
      journal.steps.collector_verification = await collector.call('verify-' + plan.id, 'verify', sourceArgs);
      await checkpoint();
      journal.steps.collector_receiving = await collector.call('receive-' + plan.id, 'export_restore', sourceArgs);
      await checkpoint();
    }

    await waitFor(async () => (await page.locator('#lineage-publication-status').textContent()) === 'Recorded by the collector',
      'the accepted receipt display');
    const files = {};
    for (const name of ['handover.zip', 'report.html', 'events.json', 'native-bindings.json', 'receipts.json', 'manifest.json'])
      files[name] = await download(name);
    if (phase === 'restore') need(files['handover.zip'].sha256 === c.original_handover.sha256 &&
      files['handover.zip'].bytes === c.original_handover.bytes, 'Cold-restored handover differs from the original accepted edition');
    const screenshots = { desktop: await screenshot('desktop', 1440), mobile: await screenshot('mobile', 390) };
    await captureBrowser();
    need(browserErrors.length === 0, 'Original browser reported an unhandled application error: ' + browserErrors.join('; '));
    // The browser has finished. Retire Chromium before the same live Analysis
    // service receives the original MCP file/reopen continuation.
    await context.close(); context = null;
    const mcp = await runAnalysisLineageMcpJourney({ directory: root, checkout: c.checkout,
      analysisDirectory: c.analysis_directory, operationId: c.operation_id, phase,
      workspaceId: c.workspace_id, rootJobId: c.root_job_id, plan,
      publicationRequest: phase === 'publish' ? journal.requests.publication :
        { id: c.publication_job_id, plan_id: c.plan_id, plan_sha256: c.plan_sha256 },
      originalHandover: files['handover.zip'] });
    journal.steps.mcp = mcp; await checkpoint();
    const result = { schema: SCHEMA, phase, status: 'COMPLETE', operation_id: c.operation_id,
      workspace_id: c.workspace_id, configuration_sha256: configurationSha,
      root_job_id: c.root_job_id, plan_id: plan.id, plan_sha256: plan.plan_sha256,
      publication_job_id: plan.publication.job_id, events_sha256: plan.events_sha256,
      publication: plan.publication, files, screenshots, steps: journal.steps,
      browser_errors: browserErrors, completed_at: new Date().toISOString() };
    await verifyArtifacts(result, root);
    await write(resultPath, json(result), { immutable: true });
    journal.completed_at = result.completed_at; delete journal.interruption; await checkpoint();
    console.log(JSON.stringify({ state: 'COMPLETE', phase, result: resultPath, ...await record(resultPath) }));
  } catch (error) {
    primaryError = error;
    await writes.catch(() => {});
    journal.interruption = { at: new Date().toISOString(), message: error.message };
    try { await write(journalPath, json(journal)); } catch { /* Original native requests remain in their last durable journal. */ }
    throw error;
  } finally {
    // Retire every actual owned process even when artifact/journal publication failed.
    const failures = [];
    try { await writes; } catch (error) { failures.push(error); }
    try { if (context) await context.close(); } catch (error) { failures.push(error); }
    try { if (host?.child) await stopChild(host.child); } catch (error) { failures.push(error); }
    try { if (collector) await collector.close(); } catch (error) { failures.push(error); }
    for (const stream of [childOutput, collectorOutput]) if (stream) {
      try { await new Promise(resolve => stream.end(resolve)); } catch (error) { failures.push(error); }
    }
    if (privateRuntime) { try { await fs.rm(privateRuntime, { recursive: true }); } catch (error) { failures.push(error); } }
    if (!primaryError && failures.length) throw failures[0];
  }
}

await main(process.argv.slice(2));
