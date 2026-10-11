#!/usr/bin/env node
// One complete local operating example on the published AGX relay and two profiles.
import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { open, readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory, atomic, need } from './custody.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const native = join(dirname(fileURLToPath(import.meta.resolve('@nostr-agx/cli/package.json'))), 'dist/agx.js');
const cli = join(here, 'cli.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [flag, output] = process.argv.slice(2);
need(flag === '--out' && typeof output === 'string' && process.argv.length === 4, 'USE_NATIVE_JOURNEY_OUT_ABSOLUTE_NEW_DIRECTORY');
const out = resolve(output);
await privateDirectory(out, true);
const agxHome = join(out, 'agx-home');
await privateDirectory(agxHome, true);
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', AGX_HOME: agxHome };
const children = new Set();
const summary = { schema: 'erp-reconciliation.agx-native-journey.v1', startedAt: new Date().toISOString(), node: process.version,
  packages: { '@nostr-agx/cli': '0.3.0', '@nostr-agx/core': '0.3.0' }, steps: [] };

function progress(name, details = {}) {
  summary.steps.push({ name, ...details });
  process.stdout.write(JSON.stringify({ step: name, ...details }) + '\n');
}

async function command(file, args, { allowed = [0], commandEnv = env } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    children.add(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.stdout.on('data', b => { stdout += b; if (stdout.length > 1048576) child.kill('SIGKILL'); });
    child.stderr.on('data', b => { if (stderr.length < 16384) stderr += b; });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer); children.delete(child);
      if (!allowed.includes(code)) return reject(Object.assign(new Error('NATIVE_COMMAND_FAILED'), { details: { command: [file, ...args], code, stderr } }));
      try { accept({ code, value: stdout.trim() ? JSON.parse(stdout) : null }); }
      catch { reject(new Error('NATIVE_COMMAND_JSON_FAILED')); }
    });
  });
}

async function daemon(args, logName, extra = {}) {
  const log = await open(join(out, logName), 'wx', 0o600);
  const child = spawn(process.execPath, [native, ...args], { env: { ...env, ...extra }, stdio: ['ignore', log.fd, log.fd] });
  children.add(child);
  child.once('close', () => { children.delete(child); void log.close(); });
  await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolveStop => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    child.once('close', () => { clearTimeout(timer); resolveStop(); });
    child.kill('SIGTERM');
  });
}

async function freePort() {
  const socket = createServer();
  await new Promise((yes, no) => { socket.once('error', no); socket.listen(0, '127.0.0.1', yes); });
  const port = socket.address().port;
  await new Promise(yes => socket.close(yes));
  return port;
}
async function waitRelay(port, child) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    need(child.exitCode === null && child.signalCode === null, 'NATIVE_RELAY_EXITED');
    const connected = await new Promise(yes => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); yes(true); });
      socket.once('error', () => yes(false));
    });
    if (connected) return;
    await delay(100);
  }
  throw new Error('NATIVE_RELAY_START_TIMEOUT');
}
async function waitProvider(child, logName) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    need(child.exitCode === null && child.signalCode === null, 'NATIVE_PROVIDER_EXITED');
    if ((await readFile(join(out, logName), 'utf8')).includes('watching for messages')) return;
    await delay(100);
  }
  throw new Error('NATIVE_PROVIDER_START_TIMEOUT');
}

let relay, server;
try {
  const port = await freePort();
  relay = await daemon(['relay', '--port', String(port)], 'relay.log');
  await waitRelay(port, relay);
  const provider = (await command(native, ['identity', 'new', '--profile', 'provider', '--json'])).value;
  const caller = (await command(native, ['identity', 'new', '--profile', 'caller', '--json'])).value;
  for (const profile of ['provider', 'caller']) await command(native, ['config', 'set', 'relays', 'ws://127.0.0.1:' + port, '--profile', profile, '--json']);
  await command(native, ['identity', 'allow', caller.npub, '--profile', 'provider', '--json']);
  await atomic(join(out, 'public-profiles.json'), { provider, caller, relay: 'ws://127.0.0.1:' + port });
  progress('original-relay-and-two-profiles', { provider: provider.pubkey, caller: caller.pubkey, port });

  const root = join(out, 'provider-jobs');
  const base = ['--root', root, '--peer', caller.pubkey];
  await command(cli, ['init', ...base]);
  const inputs = join(out, 'inputs'); await privateDirectory(inputs, true);
  const spec = { version: 1, dataset: 'fictional-ledger-native-agx', keys: ['account', 'fund'],
    amounts: [{ name: 'balance', scale: 2, tolerance: '0.00' }], group_by: ['fund'],
    source_columns: { account: 'account', fund: 'fund', balance: 'balance' },
    target_columns: { account: 'account_code', fund: 'fund_code', balance: 'converted_balance' } };
  const source = ['account,fund,balance'], incorrect = ['account_code,fund_code,converted_balance'], corrected = [...incorrect];
  for (let i = 1; i <= 120; i++) {
    const id = 'EXAMPLE-' + String(i).padStart(4, '0'), fund = i % 2 ? 'GENERAL' : 'CAPITAL';
    source.push(`${id},${fund},100.00`); incorrect.push(`${id},${fund},100.01`); corrected.push(`${id},${fund},100.00`);
  }
  await atomic(join(inputs, 'source.csv'), Buffer.from(source.join('\n') + '\n'), true);
  await atomic(join(inputs, 'incorrect.csv'), Buffer.from(incorrect.join('\n') + '\n'), true);
  await atomic(join(inputs, 'corrected.csv'), Buffer.from(corrected.join('\n') + '\n'), true);
  await atomic(join(inputs, 'spec.json'), spec, true);
  const request1 = join(out, 'request-1.json'), request2 = join(out, 'request-2.json');
  const staged = await command(cli, ['stage', ...base, '--job', 'native-run-1', '--source', join(inputs, 'source.csv'), '--target', join(inputs, 'incorrect.csv'), '--spec', join(inputs, 'spec.json'), '--request-out', request1]);
  progress('original-service-staged', { jobId: staged.value.request.jobId, bundleId: staged.value.request.bundleId });

  async function startProvider(logName) {
    const child = await daemon(['serve', '--profile', 'provider', '--handler', join(here, 'handler.mjs'), '--poll-interval', '200', '--no-reply'], logName, { ERP_AGX_ROOT: root });
    await waitProvider(child, logName); return child;
  }
  server = await startProvider('provider-1.log');
  const remote = ['--peer', provider.npub, '--profile', 'caller', '--agx-home', agxHome];
  const first = await command(cli, ['fetch', ...remote, '--request', request1, '--out', join(out, 'delivery-1'), '--execute'], { allowed: [2] });
  need(first.value.state === 'COMPLETED' && first.value.result.status === 'FAIL' && first.value.result.report.bytes > 8192, 'EXPECTED_FULL_DIFFERENCE_REPORT');
  const report1 = JSON.parse(await readFile(join(out, 'delivery-1', 'report.json')));
  need(report1.discrepancies.length === 120, 'EXPECTED_ALL_120_DIFFERENCES');
  progress('encrypted-full-report-delivery', { state: first.value.state, status: first.value.result.status, differences: report1.discrepancies.length,
    reportBytes: first.value.result.report.bytes, chunks: Math.ceil(first.value.result.report.bytes / 8192), reportSha256: first.value.result.report.sha256 });

  const review = await command(cli, ['operate', ...base, '--', 'review', '--job-id', 'native-run-1', '--report-sha256', first.value.result.report.sha256,
    '--reviewer', 'Native example operator', '--decision', 'changes_requested', '--note', 'All 120 fictional balances differ by one cent; replace the target export with the corrected exact values.']);
  need(review.value.reportSha256 === first.value.result.report.sha256, 'REVIEW_IDENTITY_CONFLICT');

  await stop(server); server = await startProvider('provider-2.log');
  const replay = await command(cli, ['fetch', ...remote, '--request', request1, '--out', join(out, 'delivery-reopened'), '--execute'], { allowed: [2] });
  need(replay.value.reused === true && replay.value.result.report.sha256 === first.value.result.report.sha256, 'REOPENED_RESULT_CHANGED');
  const serviceRoot = staged.value.directory;
  need((await readdir(join(serviceRoot, 'jobs', 'native-run-1', 'attempts'))).length === 1, 'REPLAY_RERAN_ENGINE');
  progress('provider-restart-and-idempotent-result', { reused: replay.value.reused, sameReport: true, attempts: 1 });

  const secondStage = await command(cli, ['stage', ...base, '--job', 'native-run-2', '--source', join(inputs, 'source.csv'), '--target', join(inputs, 'corrected.csv'), '--spec', join(inputs, 'spec.json'), '--request-out', request2]);
  const second = await command(cli, ['fetch', ...remote, '--request', request2, '--out', join(out, 'delivery-2'), '--execute']);
  need(second.value.result.status === 'PASS' && secondStage.value.request.bundleId !== staged.value.request.bundleId, 'CORRECTED_RUN_DID_NOT_PASS');
  await command(cli, ['operate', ...base, '--', 'review', '--job-id', 'native-run-2', '--report-sha256', second.value.result.report.sha256,
    '--reviewer', 'Native example operator', '--decision', 'accepted', '--note', 'Reviewed all 120 fictional balances and both fund totals after correcting the previous target export.']);
  progress('corrected-bundle-and-reviewed-pass', { jobId: second.value.jobId, status: second.value.result.status, reportSha256: second.value.result.report.sha256 });

  // Two simultaneous original submissions plus an old-job status request cover
  // service queue admission while the same native provider continues serving.
  const queueSource = ['account,fund,balance'], queueTarget = ['account_code,fund_code,converted_balance'];
  for (let i = 1; i <= 50000; i++) {
    const row = `QUEUE-EXAMPLE-${String(i).padStart(6, '0')},GENERAL,1.00`;
    queueSource.push(row); queueTarget.push(row);
  }
  await atomic(join(inputs, 'queue-source.csv'), Buffer.from(queueSource.join('\n') + '\n'), true);
  await atomic(join(inputs, 'queue-target.csv'), Buffer.from(queueTarget.join('\n') + '\n'), true);
  const queueRequests = [];
  for (const jobId of ['native-queue-1', 'native-queue-2']) {
    const stagedQueue = await command(cli, ['stage', ...base, '--job', jobId, '--source', join(inputs, 'queue-source.csv'), '--target', join(inputs, 'queue-target.csv'), '--spec', join(inputs, 'spec.json'), '--request-out', join(out, jobId + '.request.json')]);
    queueRequests.push(stagedQueue.value.request);
  }
  const { request } = await import('./client.mjs');
  const nativeOptions = { peer: provider.npub, profile: 'caller', agxHome, timeoutMs: 30000 };
  const pending = queueRequests.map(payload => request(nativeOptions, 'finance.reconcile', payload));
  const oldStatus = request(nativeOptions, 'finance.reconcile.status', staged.value.request);
  const admitted = await Promise.all(pending);
  const retainedStatus = await oldStatus;
  need(retainedStatus.state === 'COMPLETED' && retainedStatus.result.report.sha256 === first.value.result.report.sha256, 'CONCURRENT_OLD_STATUS_CHANGED');
  for (let i = 0; i < admitted.length; i++) need(admitted[i].jobId === queueRequests[i].jobId && admitted[i].bundleId === queueRequests[i].bundleId && ['QUEUED', 'RUNNING', 'COMPLETED'].includes(admitted[i].state), 'NATIVE_QUEUE_ADMISSION_FAILED');
  const queueDeliveries = [];
  for (const [index, payload] of queueRequests.entries()) {
    const received = await command(cli, ['fetch', ...remote, '--request', join(out, payload.jobId + '.request.json'), '--out', join(out, 'queue-delivery-' + (index + 1))]);
    need(received.value.result.status === 'PASS' && received.value.result.source.rows === 50000, 'NATIVE_QUEUE_RESULT_FAILED');
    queueDeliveries.push({ jobId: payload.jobId, rows: received.value.result.source.rows, reportSha256: received.value.result.report.sha256 });
  }
  progress('paired-native-queue-and-old-job-status', { admissionStates: admitted.map(job => ({ jobId: job.jobId, state: job.state })), retainedReportUnchanged: true, completed: queueDeliveries });

  const exported = await command(cli, ['operate', ...base, '--', 'export-replay', '--job-id', 'native-run-2', '--destination', join(out, 'complete-replay')]);
  need(exported.value.reportSha256 === second.value.result.report.sha256 && exported.value.reviewCount === 1, 'REPLAY_EXPORT_IDENTITY_CONFLICT');
  const replayed = await command(join(out, 'complete-replay', 'replay.mjs'), ['--manifest-sha256', exported.value.manifest.sha256]);
  need(replayed.value.matchesDeliveredReport === true && replayed.value.originalReportSha256 === second.value.result.report.sha256, 'PRIVATE_REPLAY_CHANGED');
  progress('complete-private-replay-export', { files: exported.value.files, reviews: exported.value.reviewCount, manifestSha256: exported.value.manifest.sha256,
    originalReportSha256: replayed.value.originalReportSha256, replayedReportSha256: replayed.value.replayedReportSha256, matchesDeliveredReport: replayed.value.matchesDeliveredReport });
  summary.status = 'PASS'; summary.finishedAt = new Date().toISOString();
  summary.originalEngineSha256 = hash(await readFile(join(here, '..', 'reconcile.mjs')));
  await atomic(join(out, 'journey.json'), summary, true);
} catch (error) {
  summary.status = 'FAILED'; summary.error = { code: error.code ?? error.message, ...(error.details ? { details: error.details } : {}) };
  await atomic(join(out, 'journey.json'), summary, true);
  process.stderr.write(JSON.stringify({ state: 'FAILED', error: summary.error }) + '\n'); process.exitCode = 1;
} finally {
  await stop(server); await stop(relay);
  for (const child of children) await stop(child);
}
