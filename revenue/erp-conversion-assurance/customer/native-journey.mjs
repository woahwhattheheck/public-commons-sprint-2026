#!/usr/bin/env node
// MIT. Operate one complete supplied-export customer case through native AGX and receiving.
import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { readFile, open, mkdir, lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { initializePeer, openPeer, peerDirectory, bindRetainedJob } from '../agx/provider.mjs';
import { privateDirectory, atomic, need } from '../agx/custody.mjs';
import { startConversionWorkspace } from '../scap-workspace/server.mjs';
import { createCustomer, openCustomer, customerSummary, archiveOperation } from './workspace.mjs';
import { startCustomerWorkspace } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [flag, destination] = process.argv.slice(2);
need(flag === '--out' && isAbsolute(destination ?? '') && process.argv.length === 4,
  'USE_NATIVE_JOURNEY_OUT_ABSOLUTE_PRIVATE_DIRECTORY');
const out = resolve(destination), journalFile = join(out, 'journey.json');
process.umask(0o077);
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
async function ensure(path) { if (!await exists(path)) await privateDirectory(path, true); else await privateDirectory(path); }
await ensure(out);
const digest = value => createHash('sha256').update(value).digest('hex');
const json = path => readFile(path, 'utf8').then(JSON.parse);
const state = await exists(journalFile) ? await json(journalFile) : {
  schema: 'erp-reconciliation.customer-native-journey.v1',
  operation: 'ELLAVOX-CUSTOMER-INSTALL-RECOVERY-RD12-20261012',
  startedAt: new Date().toISOString(), node: process.version, steps: [], checkpoints: {},
};
need(state.schema === 'erp-reconciliation.customer-native-journey.v1', 'ORIGINAL_CUSTOMER_JOURNEY_REQUIRED');
const save = () => atomic(journalFile, state);
async function checkpoint(name, value) {
  state.checkpoints[name] = value;
  const step = { name, observedAt: new Date().toISOString(), ...value };
  const previous = state.steps.findIndex(item => item.name === name);
  if (previous < 0) state.steps.push(step); else state.steps[previous] = step;
  await save();
  process.stdout.write(JSON.stringify({ step: name, ...value }) + '\n');
}
const agxRequire = createRequire(new URL('../agx/package.json', import.meta.url));
const nativePackage = agxRequire.resolve('@nostr-agx/cli/package.json');
need((await json(nativePackage)).version === '0.3.0', 'PINNED_AGX_VERSION_REQUIRED');
const native = join(dirname(nativePackage), 'dist/agx.js');
const client = join(here, '..', 'agx', 'cli.mjs');
const localRequire = createRequire(import.meta.url);
const playwrightModule = process.env.ERP_CUSTOMER_PLAYWRIGHT_MODULE ||
  (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const { chromium } = localRequire(playwrightModule);
const browserExecutable = process.env.ERP_CUSTOMER_BROWSER_EXECUTABLE;
need(browserExecutable && await exists(browserExecutable), 'EXISTING_CHROMIUM_EXECUTABLE_REQUIRED');
const children = new Set(), sessions = new Set(), browserErrors = [];
let browser, relay, providerProcess, page;
const originalHome = join(out, 'original-agx-home'), originalProvider = join(out, 'original-provider');
const customerRoot = join(out, 'customer'), receivedRoot = join(out, 'received-customer');
const inputs = join(out, 'inputs'), downloads = join(out, 'downloads'), screenshots = join(out, 'screenshots');
for (const path of [originalHome, inputs, downloads, screenshots, join(out, 'tmp')]) await ensure(path);
process.env.TMPDIR = join(out, 'tmp');

async function command(file, args, { home = originalHome, allowed = [0], extra = {} } = {}) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, [file, ...args], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: process.env.TMPDIR,
        AGX_HOME: home, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 2 * 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', data => { if (stderr.length < 16384) stderr += data; });
    child.once('error', error => { clearTimeout(timer); children.delete(child); no(error); });
    child.once('close', code => {
      clearTimeout(timer); children.delete(child);
      if (!allowed.includes(code)) return no(Object.assign(new Error('NATIVE_COMMAND_FAILED'), {
        code: 'NATIVE_COMMAND_FAILED', details: { executable: file, command: args.slice(0, 2), exit: code, stderr },
      }));
      try { yes({ code, value: stdout.trim() ? JSON.parse(stdout) : null, stderr }); }
      catch { no(new Error('NATIVE_COMMAND_JSON_REQUIRED')); }
    });
  });
}
async function daemon(args, name, home = originalHome, extra = {}) {
  const logName = name + '-' + Date.now() + '.log';
  const log = await open(join(out, logName), 'wx', 0o600);
  const child = spawn(process.execPath, [native, ...args], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', AGX_HOME: home, TMPDIR: process.env.TMPDIR, ...extra },
    stdio: ['ignore', log.fd, log.fd],
  });
  children.add(child);
  child.once('close', () => { children.delete(child); void log.close(); });
  await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); });
  return { child, logName };
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(done => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.once('close', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
}
async function freePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise(yes => server.close(yes));
  return port;
}
async function waitFor(check, code, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(150); }
  throw Object.assign(new Error(code), { code });
}
async function relayReady(port, child) {
  return waitFor(async () => {
    need(child.exitCode === null && child.signalCode === null, 'RELAY_EXITED');
    return new Promise(yes => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); yes(true); });
      socket.once('error', () => yes(false));
    });
  }, 'RELAY_START_TIMEOUT', 10000);
}
async function providerReady(process) {
  await waitFor(async () => {
    need(process.child.exitCode === null && process.child.signalCode === null, 'PROVIDER_EXITED');
    return (await readFile(join(out, process.logName), 'utf8')).includes('watching for messages');
  }, 'PROVIDER_START_TIMEOUT', 15000);
}
async function identity(profile) {
  if (state.checkpoints['identity-' + profile]) {
    const current = (await command(native, ['identity', 'show', '--profile', profile, '--json'])).value;
    need(current.pubkey === state.checkpoints['identity-' + profile].pubkey, 'ORIGINAL_AGX_IDENTITY_CHANGED');
    return current;
  }
  const shown = await command(native, ['identity', 'show', '--profile', profile, '--json'], { allowed: [0, 3] });
  need(shown.code === 0 || /has no identity/.test(shown.stderr), 'ORIGINAL_AGX_IDENTITY_READ_FAILED');
  const value = shown.code === 0 ? shown.value :
    (await command(native, ['identity', 'new', '--profile', profile, '--json'])).value;
  need(/^[a-f0-9]{64}$/.test(value.pubkey ?? '') && typeof value.npub === 'string', 'AGX_PUBLIC_IDENTITY_REQUIRED');
  await checkpoint('identity-' + profile, { pubkey: value.pubkey, npub: value.npub });
  return value;
}
async function configureRelay(home, address) {
  for (const profile of ['provider', 'caller'])
    await command(native, ['config', 'set', 'relays', address, '--profile', profile, '--json'], { home });
}
function observe(current) {
  current.on('pageerror', error => browserErrors.push({ page: current.url().split('#')[0], message: error.message }));
  current.on('console', message => { if (message.type() === 'error') browserErrors.push({ page: current.url().split('#')[0], message: message.text() }); });
}
async function newPage(url) {
  const current = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  observe(current); current.setDefaultTimeout(30000);
  await current.goto(url, { waitUntil: 'networkidle' });
  await current.locator('#profileTitle').filter({ hasText: 'Finance export reconciliation' }).waitFor();
  return current;
}
async function uiResponse(current, action, pathname) {
  const pending = current.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === 'POST', { timeout: 60000 });
  await action();
  const response = await pending, body = await response.json();
  need(response.ok(), body.error ?? 'BROWSER_OPERATION_FAILED');
  await current.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  return body;
}
async function readApi(current, path) {
  return current.evaluate(async path => {
    const response = await fetch(path, { cache: 'no-store',
      headers: { 'x-erp-workspace-token': sessionStorage.getItem('erp-workspace-token') } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'WORKSPACE_READ_FAILED');
    return value;
  }, path);
}
async function openRun(current, jobId) {
  await current.locator('[data-view="runs"]').click();
  await current.locator('#refreshJobs').click();
  await current.getByRole('button', { name: 'Open run ' + jobId, exact: true }).click();
  await current.locator('#jobDetail h2').filter({ hasText: jobId }).waitFor();
}
async function completeJob(service, jobId, expected) {
  const job = await waitFor(async () => {
    const value = await service.getJob(jobId);
    if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(value.state)) throw new Error('ORIGINAL_JOB_' + value.state);
    return value.state === 'COMPLETED' ? value : null;
  }, 'RETAINED_JOB_COMPLETION_TIMEOUT');
  need(job.result.status === expected, 'COMPARISON_OUTCOME_CONFLICT');
  return job;
}
async function findStaged(service, jobId, previousJobId) {
  if (state.checkpoints['stage-' + jobId]) return state.checkpoints['stage-' + jobId].bundleId;
  const page = await service.listBundles({ limit: 1000 });
  for (const bundle of page.bundles) {
    const { spec } = await service.getBundle(bundle.bundleId);
    if (spec.dataset === 'supplied-fund-account-2025' &&
        (spec.workspace?.previous?.jobId ?? null) === (previousJobId ?? null)) return bundle.bundleId;
  }
  return null;
}
async function stageOriginal(current) {
  await current.locator('#dataset').fill('supplied-fund-account-2025');
  await current.locator('#conversionOwner').fill('Customer receiving operator');
  await current.locator('#period').fill('Fiscal year 2025');
  await current.locator('#sourceSystem').fill('Supplied source ledger export');
  await current.locator('#targetSystem').fill('Supplied converted ledger export');
  await current.locator('#coverage').fill('All three records from the repository sample exports, grouped by fiscal year and fund, including debits and credits at exact cents.');
  await current.locator('#resources').fill('Complete source and target CSV exports; receiving operator reviews the first result and its linked correction.');
  await current.locator('#timeline').fill('Review the initial discrepancy, receive the corrected export, then back up and reopen the complete customer history.');
  await current.locator('#sourceFile').setInputFiles(join(inputs, 'source.csv'));
  await current.locator('#sourceMeta').filter({ hasText: 'source.csv' }).waitFor();
  await current.locator('#targetFile').setInputFiles(join(inputs, 'incorrect-target.csv'));
  await current.locator('#targetMeta').filter({ hasText: 'incorrect-target.csv' }).waitFor();
  const fields = { fiscal_year: ['FiscalYr', 'FY'], fund: ['FundCode', 'FundID'],
    account: ['GLAccount', 'AccountID'], debits: ['Debit', 'DebitAmt'], credits: ['Credit', 'CreditAmt'] };
  for (const [name, columns] of Object.entries(fields)) for (const [index, side] of ['source', 'target'].entries())
    await current.getByRole('combobox', { name: side + ' column for ' + name, exact: true }).selectOption(columns[index]);
  return uiResponse(current, () => current.locator('#stageMapping').click(), '/api/stage');
}
async function ensureRun(current, service, jobId, expected, previousJobId = null) {
  let job;
  try { job = await service.getJob(jobId); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!job) {
    const retained = await findStaged(service, jobId, previousJobId);
    if (retained) {
      await current.locator('[data-view="bundles"]').click();
      await current.locator('#refreshBundles').click();
      await current.locator('.bundle-item').filter({ hasText: retained }).getByRole('button', { name: 'Open mapping', exact: true }).click();
    } else {
      let staged;
      if (previousJobId) {
        await openRun(current, previousJobId);
        await current.getByRole('button', { name: 'Create linked correction', exact: true }).click();
        await current.locator('#correctionReason').fill('Replace the target debit for fund 100, account 40001 with the exact value in the complete supplied target export.');
        await current.locator('#targetFile').setInputFiles(join(inputs, 'corrected-target.csv'));
        await current.locator('#targetMeta').filter({ hasText: 'corrected-target.csv' }).waitFor();
        staged = await uiResponse(current, () => current.locator('#stageMapping').click(), '/api/stage');
      } else staged = await stageOriginal(current);
      await checkpoint('stage-' + jobId, { bundleId: staged.bundle.bundleId });
    }
    await current.locator('#jobId').fill(jobId);
    job = await uiResponse(current, () => current.locator('#executeJob').click(), '/api/execute');
    await checkpoint('admission-' + jobId, { jobId, bundleId: job.bundleId });
  }
  if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.state)) {
    await openRun(current, jobId);
    await uiResponse(current, () => current.getByRole('button', { name: 'Recover original run', exact: true }).click(),
      '/api/jobs/' + jobId + '/recover');
  }
  job = await completeJob(service, jobId, expected);
  await openRun(current, jobId);
  await current.locator('#reviewForm').waitFor();
  await checkpoint('comparison-' + jobId, { jobId, bundleId: job.bundleId, state: job.state,
    status: job.result.status, reportSha256: job.result.report.sha256, reportBytes: job.result.report.bytes });
  return job;
}
async function review(current, service, job, decision) {
  const reviewer = 'Customer receiving operator';
  const existing = (await service.getReviews(job.jobId)).find(item => item.reviewer === reviewer && item.decision === decision);
  if (existing) return existing;
  await current.locator('#reviewer').fill(reviewer);
  await current.locator('#reviewDecision').selectOption(decision);
  await current.locator('#reviewComment').fill(decision === 'accepted'
    ? 'The corrected complete export matches all three original records and both fund totals. The initial report and requested change remain in the linked history.'
    : 'The complete initial target differs by one cent for fund 100, account 40001. Receive the corrected complete target export while retaining this original report.');
  await current.locator('select[data-scenario="initial-review"]').selectOption(decision === 'accepted' ? 'passed' : 'failed');
  await current.getByRole('textbox', { name: 'UAT observation: Initial export and discrepancy review', exact: true })
    .fill('All supplied records and grouped balances were inspected against their retained source and target exports.');
  await current.locator('select[data-scenario="corrected-review"]').selectOption(decision === 'accepted' ? 'passed' : 'not_applicable');
  const result = await uiResponse(current, () => current.locator('#reviewForm').getByRole('button', { name: 'Record review', exact: true }).click(), '/api/review');
  await checkpoint('review-' + job.jobId, { jobId: job.jobId, decision, reviewId: result.reviewId, reportSha256: result.reportSha256 });
  return result;
}
async function download(current, action, path) {
  const pending = current.waitForEvent('download', { timeout: 60000 });
  await action();
  const artifact = await pending;
  await artifact.saveAs(path);
  need(!(await artifact.failure()), 'BROWSER_DOWNLOAD_FAILED');
  return { path, bytes: (await lstat(path)).size, sha256: digest(await readFile(path)) };
}
async function getTransfer(current, kind) {
  const data = await readApi(current, '/api/customer/transfers');
  return data.transfers.find(item => item.type === kind && (kind !== 'restore' || item.destinationName === 'received-customer'));
}
async function readyTransfer(current, id, { allowUpload = false } = {}) {
  let continued = false;
  return waitFor(async () => {
    const value = await readApi(current, '/api/customer/transfers/' + id);
    if (value.recovering) return null;
    if (value.state === 'READY') return value;
    if (value.state === 'AWAITING_UPLOAD') {
      need(allowUpload, 'ORIGINAL_CUSTOMER_UPLOAD_REQUIRED');
      return value;
    }
    if (['FAILED', 'INTERRUPTED'].includes(value.state)) {
      if (continued) throw new Error(value.error?.code ?? 'CUSTOMER_TRANSFER_FAILED');
      continued = true;
      await current.getByRole('button', { name: 'Refresh transfers', exact: true }).click();
      await uiResponse(current, () => current.locator('[data-transfer-id="' + id + '"]')
        .getByRole('button', { name: 'Continue saved transfer', exact: true }).click(),
      '/api/customer/transfers/' + id + '/continue');
    }
    return null;
  }, 'CUSTOMER_TRANSFER_COMPLETION_TIMEOUT', 180000);
}
async function remoteDelivery(home, root, profiles, phase, jobs) {
  await configureRelay(home, state.relay);
  providerProcess = await daemon(['serve', '--profile', 'provider', '--handler', join(here, '..', 'agx', 'handler.mjs'),
    '--poll-interval', '200', '--no-reply'], 'provider-' + phase, home, { ERP_AGX_ROOT: root });
  await providerReady(providerProcess);
  const results = [];
  try {
    for (const job of jobs) {
      const delivery = join(out, 'agent-' + phase + '-' + job.jobId);
      let result;
      if (await exists(join(delivery, 'result.json'))) {
        result = await json(join(delivery, 'result.json'));
        need(digest(await readFile(join(delivery, 'report.json'))) === job.result.report.sha256, 'RETAINED_DELIVERY_CHANGED');
      } else result = (await command(client, ['fetch', '--peer', profiles.provider.npub, '--profile', 'caller',
        '--agx-home', home, '--request', join(downloads, job.jobId + '.request.json'), '--out', delivery, '--execute'],
        { home, allowed: job.result.status === 'FAIL' ? [2] : [0] })).value;
      need(result.state === 'COMPLETED' && result.result.report.sha256 === job.result.report.sha256,
        'REMOTE_RETAINED_REPORT_CHANGED');
      const attempts = (await readdir(join(peerDirectory(root, profiles.caller.pubkey), 'jobs', job.jobId, 'attempts'))).length;
      need(attempts === 1, 'RETAINED_ENGINE_RERAN');
      results.push({ jobId: job.jobId, status: result.result.status, reportSha256: result.result.report.sha256, attempts });
    }
  } finally { await stop(providerProcess.child); providerProcess = null; }
  await checkpoint('agent-' + phase, { protocol: '@nostr-agx/cli@0.3.0', reports: results });
}
async function capture(current, prefix) {
  const saved = [];
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'phone', width: 390, height: 844 }]) {
    await current.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const view of ['intake', 'runs', 'bundles', 'profile']) {
      await current.locator('[data-view="' + view + '"]').click();
      if (view === 'profile') await current.locator('#customerRefresh').click();
      await current.waitForFunction(() => !document.body.hasAttribute('aria-busy') &&
        !document.querySelector('#profileView')?.hasAttribute('aria-busy'));
      const filename = prefix + '-' + view + '-' + viewport.name + '.png';
      await current.screenshot({ path: join(screenshots, filename), fullPage: true });
      const width = await current.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      need(width.document <= width.viewport + 2, 'BROWSER_PAGE_OVERFLOW_' + view);
      saved.push({ filename, width: viewport.width, height: viewport.height });
    }
  }
  await checkpoint(prefix + '-screens', { views: saved });
}

try {
  const source = await readFile(join(here, '..', 'source.sample.csv'));
  const target = await readFile(join(here, '..', 'target.sample.csv'));
  const incorrect = target.toString().replace('2025,100,40001,1.00,0.00', '2025,100,40001,1.01,0.00');
  need(incorrect !== target.toString(), 'ORIGINAL_COMPLETE_SAMPLE_REQUIRED');
  for (const [name, bytes] of [['source.csv', source], ['incorrect-target.csv', Buffer.from(incorrect)], ['corrected-target.csv', target]]) {
    const path = join(inputs, name);
    if (await exists(path)) need(digest(await readFile(path)) === digest(bytes), 'ORIGINAL_INPUT_CHANGED');
    else await atomic(path, bytes, true);
  }
  await checkpoint('complete-source-exports', { sourceBytes: source.length, targetBytes: target.length,
    sourceSha256: digest(source), targetSha256: digest(target), originalRecords: 3,
    preparation: 'Initial target contains one declared one-cent difference; the corrected target is the complete supplied target.sample.csv.' });
  const profiles = { provider: await identity('provider'), caller: await identity('caller') };
  const port = await freePort(); state.relay = 'ws://127.0.0.1:' + port; await save();
  relay = await daemon(['relay', '--port', String(port)], 'relay');
  await relayReady(port, relay.child);
  await configureRelay(originalHome, state.relay);
  await command(native, ['identity', 'allow', profiles.caller.npub, '--profile', 'provider', '--json']);
  await initializePeer(originalProvider, profiles.caller.pubkey);
  const original = await openPeer(originalProvider, profiles.caller.pubkey);
  const financeProfile = await json(join(here, 'finance-profile.json'));
  browser = await chromium.launch({ executablePath: browserExecutable, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { ...process.env, TMPDIR: process.env.TMPDIR } });
  const originalSession = await startConversionWorkspace({ directory: peerDirectory(originalProvider, profiles.caller.pubkey),
    service: original.service, profile: financeProfile, port: 0 });
  sessions.add(originalSession);
  page = await newPage(originalSession.url);
  const first = await ensureRun(page, original.service, 'finance-original-2025', 'FAIL');
  await review(page, original.service, first, 'changes_requested');
  await bindRetainedJob(originalProvider, profiles.caller.pubkey, { jobId: first.jobId, bundleId: first.bundleId,
    requestOut: join(downloads, first.jobId + '.request.json') });
  await page.close(); page = null; await originalSession.close(); sessions.delete(originalSession);
  const keyBefore = digest(await readFile(join(peerDirectory(originalProvider, profiles.caller.pubkey), 'hmac.key')));
  if (!await exists(customerRoot)) await createCustomer({ directory: customerRoot,
    name: 'Finance implementation review', peer: profiles.caller.pubkey,
    adoptProvider: originalProvider, adoptAgxHome: originalHome });
  const customer = await openCustomer(customerRoot);
  need(digest(await readFile(join(customer.serviceDirectory, 'hmac.key'))) === keyBefore, 'ADOPTED_SERVICE_KEY_CHANGED');
  need((await customer.service.getJob(first.jobId)).result.report.sha256 === first.result.report.sha256, 'ADOPTED_REPORT_CHANGED');
  need((await customer.service.getReviews(first.jobId)).length === 1, 'ADOPTED_REVIEW_CHANGED');
  await checkpoint('original-customer-adoption', { customerId: customer.configuration.customerId,
    originalJob: first.jobId, reportSha256: first.result.report.sha256, reviews: 1, retainedHmacIdentity: true });
  const customerSession = await startCustomerWorkspace({ directory: customerRoot, port: 0 });
  sessions.add(customerSession);
  page = await newPage(customerSession.url);
  const second = await ensureRun(page, customer.service, 'finance-corrected-2025', 'PASS', first.jobId);
  await review(page, customer.service, second, 'accepted');
  const secondBundle = await customer.service.getBundle(second.bundleId);
  need(secondBundle.spec.workspace.previous.jobId === first.jobId &&
    secondBundle.spec.workspace.previous.bundleId === first.bundleId, 'LINKED_CORRECTION_CHANGED');
  await page.locator('[data-view="profile"]').click();
  await page.locator('#customerRefresh').click();
  const request2 = join(downloads, second.jobId + '.request.json');
  if (!await exists(request2)) await download(page, () => page.getByRole('button', {
    name: 'Prepare agent request for ' + second.jobId, exact: true }).click(), request2);
  const request = await json(request2);
  need(Object.keys(request).length === 2 && request.jobId === second.jobId && request.bundleId === second.bundleId,
    'BROWSER_AGENT_REQUEST_CHANGED');
  await remoteDelivery(customer.agxHome, customer.providerRoot, profiles, 'adopted', [first, second]);

  await page.locator('#customerRefresh').click();
  let backup = await getTransfer(page, 'backup');
  if (!backup) backup = await uiResponse(page, () => page.locator('#customerCreateBackup').click(), '/api/customer/backups');
  backup = await readyTransfer(page, backup.id);
  await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click();
  const backupPath = join(downloads, 'complete-customer.zip');
  const backupDownload = await download(page, () => page.getByRole('button', { name: 'Download backup ' + backup.id, exact: true }).click(), backupPath);
  need(backupDownload.sha256 === backup.receipt.sha256, 'DOWNLOADED_BACKUP_CHANGED');
  await atomic(join(downloads, 'complete-customer-receipt.json'), backup.receipt);
  await checkpoint('browser-complete-backup', { id: backup.id, bytes: backupDownload.bytes, sha256: backupDownload.sha256,
    files: backup.receipt.files, sourceBytes: backup.receipt.sourceBytes });
  let receiving = await getTransfer(page, 'restore');
  if (receiving) receiving = await readyTransfer(page, receiving.id, { allowUpload: true });
  if (!receiving || receiving.state === 'AWAITING_UPLOAD') {
    await page.locator('#customerReceivingName').fill('received-customer');
    await page.locator('#customerReceivingFile').setInputFiles(backupPath);
    await page.locator('#customerReceivingSha').fill(backup.receipt.sha256);
    // The customer form reuses a matching retained upload plan after reopening.
    await page.locator('#customerReceive').click();
    receiving = await waitFor(() => getTransfer(page, 'restore'), 'BROWSER_RECEIVING_ADMISSION_TIMEOUT');
  }
  receiving = await readyTransfer(page, receiving.id);
  await checkpoint('browser-customer-receiving', { id: receiving.id, customerId: receiving.receipt.customer.customerId,
    archiveSha256: receiving.receipt.archiveSha256, files: receiving.receipt.files, counts: receiving.receipt.counts });
  await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click();
  await page.getByRole('button', { name: 'Open restored workspace received-customer', exact: true }).click();
  const link = page.getByRole('link', { name: 'Review restored customer', exact: true });
  await link.waitFor();
  const receivedUrl = await link.getAttribute('href');
  const receivedPage = await newPage(receivedUrl);
  const received = await openCustomer(receivedRoot);
  const before = await customerSummary(customerRoot), after = await customerSummary(receivedRoot);
  need(after.customer.customerId === before.customer.customerId &&
    after.jobs.length === 2 && after.bundles.length === 2 && after.reviews.length === 2, 'RESTORED_HISTORY_CHANGED');
  need(digest(await readFile(join(received.serviceDirectory, 'hmac.key'))) === keyBefore, 'RESTORED_HMAC_CHANGED');
  for (const job of [first, second]) {
    const retained = await received.service.getJob(job.jobId);
    need(retained.result.report.sha256 === job.result.report.sha256 && retained.bundleId === job.bundleId, 'RESTORED_JOB_CHANGED');
    const binding = await json(join(received.providerRoot, 'peers', profiles.caller.pubkey, 'bindings', job.jobId + '.json'));
    need(binding.bundleId === job.bundleId && binding.peer === profiles.caller.pubkey, 'RESTORED_AGENT_BINDING_CHANGED');
  }
  await openRun(receivedPage, second.jobId);
  await capture(receivedPage, 'received-customer');
  await openRun(page, second.jobId);
  await capture(page, 'original-customer');
  await remoteDelivery(received.agxHome, received.providerRoot, profiles, 'restored', [first, second]);
  await checkpoint('full-history-reopened', { customerId: after.customer.customerId,
    jobs: after.jobs.length, bundles: after.bundles.length, reviews: after.reviews.length,
    retainedHmacIdentity: true, originalAndCorrectedReportsRetained: true, browserErrors: browserErrors.length });
  need(browserErrors.length === 0, 'BROWSER_ERRORS_RECORDED');
  state.status = 'PASS'; state.finishedAt = new Date().toISOString(); state.browserErrors = browserErrors;
  await save();
  process.stdout.write(JSON.stringify({ status: state.status, customerId: after.customer.customerId,
    jobs: 2, bundles: 2, reviews: 2, screenshots: state.checkpoints['received-customer-screens'].views.length +
      state.checkpoints['original-customer-screens'].views.length, output: out }) + '\n');
} catch (error) {
  state.status = 'FAILED'; state.finishedAt = new Date().toISOString();
  state.error = { code: error.code ?? error.message, ...(error.details ? { details: error.details } : {}) };
  state.browserErrors = browserErrors; await save();
  if (page && !page.isClosed()) await page.screenshot({ path: join(screenshots, 'original-failure.png'), fullPage: true }).catch(() => {});
  process.stderr.write(JSON.stringify({ status: 'FAILED', error: state.error, output: out }) + '\n');
  process.exitCode = 1;
} finally {
  if (providerProcess) await stop(providerProcess.child);
  if (browser) await browser.close().catch(() => {});
  for (const session of sessions) await session.close().catch(() => {});
  if (relay) await stop(relay.child);
  for (const child of children) await stop(child);
  await save();
}
