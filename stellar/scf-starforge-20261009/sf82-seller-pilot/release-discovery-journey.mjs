// MIT. One complete original CLI setup → merchant publication → host restart.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initReleaseStore, stageRelease } from './releases.mjs';
import { readReleaseCatalogConfig } from './release-catalog.mjs';
import { startReleaseConsole } from './release-console.mjs';
import { requestCatalogOperator } from '../sf60-durable-catalog-transaction/operator.mjs';

const runFile = promisify(execFile), cliFile = fileURLToPath(new URL('./release-cli.mjs', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'sf82-discovery-setup-'));
const store = join(work, 'releases'), setup = join(work, 'discovery');
const common = ['--store', store, '--setup', setup];
const cli = async (...args) => {
  const result = await runFile(process.execPath, [cliFile, ...args], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.stdout.includes('BEGIN PRIVATE KEY'), false);
  return JSON.parse(result.stdout);
};
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const example = name => readFile(new URL('./examples/' + name, import.meta.url)).then(JSON.parse);
let host, consoleSession, quoteSignatures = 0;

async function startHost(extra = []) {
  const child = spawn(process.execPath, [cliFile, 'catalog-run', ...common, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '', resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const deadline = setTimeout(() => { child.kill('SIGTERM'); rejectReady(new Error('Discovery CLI startup timed out')); }, 30000);
  child.stdout.on('data', bytes => {
    output += bytes;
    try { const value = JSON.parse(output); clearTimeout(deadline); resolveReady(value); } catch { /* Complete JSON object may span chunks. */ }
  });
  child.stderr.on('data', bytes => { errors += bytes; });
  child.once('error', error => { clearTimeout(deadline); rejectReady(error); });
  const done = new Promise(resolve => child.once('close', (code, signal) => {
    clearTimeout(deadline); rejectReady(new Error('Discovery CLI exited before readiness: ' + errors)); resolve({ code, signal });
  }));
  try {
    const value = await ready;
    return { child, value, get output() { return output; }, async stop() {
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      try { const result = await done; assert.equal(result.code, 0, errors); }
      finally { clearTimeout(timeout); }
    } };
  } catch (error) { child.kill('SIGTERM'); await done; throw error; }
}

try {
  await initReleaseStore(store);
  const spec = await example('upstream-openapi.json');
  spec.paths['/archive'] = structuredClone(spec.paths['/dataset']); spec.paths['/archive'].get.operationId = 'archive';
  const selections = await example('upstream-selections.json');
  selections[0].accepts.push({ ...selections[0].accepts[0], asset: 'DEMO_NONPAYABLE_ASSET_B',
    payTo: 'DEMO_NONPAYABLE_RECIPIENT_B', amount: '30000' });
  selections.push({ ...structuredClone(selections[0]), path: '/archive' });
  const bindings = [{ method: 'GET', path: '/dataset', id: 'dataset', response: { rows: [] }, validateInput: true },
    { method: 'GET', path: '/archive', id: 'archive', response: { archived: true }, validateInput: true }];
  const specFile = join(work, 'spec.json'), selectionsFile = join(work, 'selection.json'), bindingsFile = join(work, 'bindings.json');
  await save(specFile, spec); await save(selectionsFile, selections); await save(bindingsFile, bindings);
  const retained = await stageRelease(store, { id: 'first', spec: specFile, config: selectionsFile,
    bindings: bindingsFile, runtime: { port: 0 } });
  const initialized = await cli('catalog-init', ...common, '--id', 'first', '--seller', 'merchant-setup');
  assert.equal(initialized.state, 'CONFIGURED');
  assert.equal(initialized.source.digest, retained.digest);
  assert.deepEqual(initialized.permissions.allowedRecipients, ['DEMO_NONPAYABLE_RECIPIENT', 'DEMO_NONPAYABLE_RECIPIENT_B']);
  assert.equal(initialized.source.resources.length, 2);
  assert.ok(initialized.source.resources.every(row => row.payment.length === 2));
  const enrollment = await readFile(initialized.enrollmentFile, 'utf8');
  assert.equal(enrollment.includes(work), false); assert.equal(enrollment.includes('PRIVATE KEY'), false);
  assert.equal((await stat(setup)).mode & 0o777, 0o700);
  assert.equal((await stat(join(setup, 'seller-key.pem'))).mode & 0o777, 0o600);
  const originalKey = await readFile(join(setup, 'seller-key.pem'));
  await assert.rejects(cli('catalog-init', ...common, '--id', 'first', '--seller', 'merchant-setup'));
  assert.deepEqual(await readFile(join(setup, 'seller-key.pem')), originalKey); originalKey.fill(0);
  assert.deepEqual(await cli('catalog-inspect', ...common), initialized);

  host = await startHost();
  const launch = new URL((await readFile(host.value.launchFile, 'utf8')).trim());
  assert.equal(host.output.includes(launch.hash.slice(1)), false);
  assert.equal((await stat(host.value.launchFile)).mode & 0o777, 0o600);
  const workspaceResponse = await fetch(host.value.workspaceOrigin + '/api/status', {
    headers: { 'x-workspace-token': launch.hash.slice(1) }, redirect: 'error' });
  assert.equal(workspaceResponse.status, 200); assert.equal((await workspaceResponse.json()).committedOperations, 0);
  const config = await readReleaseCatalogConfig(initialized.connectionFile);
  consoleSession = await startReleaseConsole(store, { port: 0, catalogConfig: config });
  const call = async (path, body) => {
    const options = { headers: { 'x-release-token': consoleSession.token }, redirect: 'error' };
    if (body !== undefined) Object.assign(options, { method: 'POST', body: JSON.stringify(body),
      headers: { ...options.headers, origin: consoleSession.url, 'content-type': 'application/json' } });
    const response = await fetch(consoleSession.url + path, options), value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  await call('/api/activate', { id: 'first', expectedGeneration: 0, reason: 'First merchant discovery setup' });
  const running = await call('/api/run', { expectedGeneration: 1 });
  const quote = await fetch(running.runtime.observed.listener + '/api/dataset?region=north', { redirect: 'error' });
  assert.equal(quote.status, 402); await quote.arrayBuffer();
  const review = await call('/api/catalog/review', { id: 'first' });
  const publication = await call('/api/catalog/apply', { reviewId: review.id });
  assert.equal(publication.decision, 'COMMITTED'); quoteSignatures += publication.signaturesIssued;
  assert.equal(quoteSignatures, 4); assert.ok(publication.status.rows.every(row => row.state === 'MATCHES'));
  const discovery = await fetch(host.value.discoveryOrigin + '/discovery/resources?limit=20', { redirect: 'error' });
  assert.equal(discovery.status, 200); assert.equal((await discovery.json()).resources.length, 2);
  const oldLaunchFile = host.value.launchFile;
  await host.stop(); host = null;
  await assert.rejects(readFile(oldLaunchFile), { code: 'ENOENT' });
  assert.equal((await cli('catalog-inspect', ...common)).publicKeySha256, initialized.publicKeySha256);

  host = await startHost(['--no-workspace']);
  assert.equal(Object.hasOwn(host.value, 'workspaceOrigin'), false);
  assert.equal(host.value.publicKeySha256, initialized.publicKeySha256);
  const status = await requestCatalogOperator({ directory: config.directory, operation: 'status' });
  assert.equal(status.committedOperations, 2); assert.equal(status.activeResources, 2);
  const resumed = await call('/api/catalog?id=first');
  assert.ok(resumed.rows.every(row => row.state === 'MATCHES'));
  const noChange = await call('/api/catalog/review', { id: 'first' });
  const unchanged = await call('/api/catalog/apply', { reviewId: noChange.id });
  assert.equal(unchanged.decision, 'UNCHANGED'); assert.equal(unchanged.signaturesIssued, 0);
  await call('/api/stop', { instanceId: running.console.instanceId });
  await host.stop(); host = null;
  console.log(JSON.stringify({ result: 'PASS', setupResources: 2, retainedRecipients: 2,
    paymentAlternatives: 4, originalQuoteSignatures: quoteSignatures, originalCatalogOperations: 2,
    paymentCalls: 0, hostedActions: 0,
    journey: ['original retained merchant', 'source-derived private CLI setup', 'create-only key preservation',
      'public enrollment export', 'original writer and browser launch', 'private browser capability',
      'original merchant console publication', 'owned grouped shutdown', 'headless same-key restart',
      'original journal reconciliation', 'zero-write unchanged publication'] }));
} finally {
  await consoleSession?.close(); await host?.stop(); await rm(work, { recursive: true, force: true });
}
