#!/usr/bin/env node
// MIT. One complete native receiving journey over the original managed fleet.
// Run on an existing Linux service account. All state stays in its new private case.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, lstat, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const exec = promisify(execFile);
const OPERATION = 'SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012';
const SOURCE_COMMIT = '79c1da0def815f37e5c9a9d651117a6564d3de01';
const PREFIX = 'stellar/scf-starforge-20261009/';
const COMPONENT = PREFIX + 'merchant-fleet-gateway/';
const SOURCE_PINS = {
  [COMPONENT + 'recovery.mjs']: '287d4d3da4cb339768c77182cb30e97222ee9d91',
  [COMPONENT + 'recovery-cli.mjs']: '4eca4c92d017f2d8c12a0c9429954cbfaed8d84f',
  [COMPONENT + 'RECOVERY.md']: '486e63c1c86bb5b56f00a4fa66a0a855d6778d08',
  [COMPONENT + 'deploy.mjs']: 'b4b6f44535e711e872c1dba8e6c036e3d6d89eb1',
  [PREFIX + 'sf101-merchant-recovery/workspace/local.mjs']: '7e24b7a2d1f2adbd0bac43c8e70b5ace2175b205',
  [PREFIX + 'distribution/contributions/merchant-fleet-recovery.json']: '0d3799ca145c275474ab6e11a65ad6c1077fb394',
  [COMPONENT + 'release-bootstrap.mjs']: '245321b2c37b8f1f869568827d209edbdb192924',
  [COMPONENT + 'deploy-runtime.mjs']: '2d667122ce6407d4f7ebedbfc3f7ab9376fc96d4',
  [PREFIX + 'sf30-seller-sdk/python/example-merchant.json']: '2e8dc4a62ccdd9be911f5a3373234ba8933ca28d',
  [PREFIX + 'sf30-seller-sdk/python/example-application.py']: '1813ce2e13ad68903257462d38f099b2c7696952',
};
const sha = value => createHash('sha256').update(value).digest('hex');
const gitBlob = value => createHash('sha1').update(Buffer.from('blob ' + value.length + '\0')).update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
function inside(parent, path) {
  const value = relative(parent, path);
  return value !== '' && !isAbsolute(value) && value !== '..' && !value.startsWith('../');
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateDirectory(path, { create = false } = {}) {
  if (create) await mkdir(path, { mode: 0o700 });
  const stat = await lstat(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'Use a real private directory: ' + path);
  assert.equal(await realpath(path), path, 'Use the canonical private path');
  assert.equal(stat.uid, process.getuid(), 'Private directory must have the actual service UID');
  assert.equal(stat.gid, process.getgid(), 'Private directory must have the actual service GID');
}
async function writeNew(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeNew(temporary, json(value));
  await rename(temporary, path);
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}
async function bindPort(port) {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
}
async function exchange(origin, path, { method = 'GET', body, host, session } = {}) {
  const url = new URL(origin);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.protocol, 'http:');
  const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((done, fail) => {
    let size = 0;
    const call = request({ hostname: '127.0.0.1', port: Number(url.port), method, path, agent: false,
      headers: { host: host ?? url.host, accept: 'application/json',
        ...(session ? { 'x-fleet-workspace': session } : {}),
        ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, response => {
      const parts = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) response.destroy(new Error('Original HTTP response exceeds 8 MiB'));
        else parts.push(chunk);
      });
      response.once('error', fail);
      response.once('aborted', () => fail(new Error('Original HTTP response was interrupted')));
      response.once('end', () => done({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(parts) }));
    });
    call.setTimeout(60000, () => call.destroy(new Error('Original HTTP operation timed out')));
    call.once('error', fail); call.end(bytes);
  });
}
async function api(origin, path, session, body) {
  const response = await exchange(origin, path, { session, ...(body === undefined ? {} : { method: 'POST', body }) });
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
  if (response.status !== 200)
    throw Object.assign(new Error('Original workspace returned HTTP ' + response.status + ': ' + (value.error ?? path)),
      { nativeResponse: value, nativeStatus: response.status });
  return value;
}
async function challenge(ingress, host, amount) {
  const response = await exchange(ingress, '/summary', { host, method: 'POST', body: { values: [2, 4, 6, 8], window: 2 } });
  assert.equal(response.status, 402);
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
  assert(Array.isArray(body.accepts) && body.accepts.some(row => row.amount === amount), 'Original seller must expose the selected release price');
  assert.equal(typeof response.headers['payment-required'], 'string');
  return { status: response.status, bodySha256: sha(response.bytes), amount,
    paymentRequiredSha256: sha(response.headers['payment-required']), resource: body.resource?.url ?? null };
}
async function ready(runtime, expectedRevision, expectedSlot, health, bundle) {
  let last;
  for (let count = 0; count < 100; count++) {
    try {
      const result = await health(bundle);
      if (result.revision === expectedRevision && result.merchants.find(row => row.id === 'alpha')?.slot === expectedSlot) return result;
      last = new Error('Original fleet has not selected the requested retained revision');
    } catch (error) { last = error; }
    await pause(100);
  }
  throw last;
}
function options(args) {
  const selected = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    assert(args[i]?.startsWith('--') && ['source', 'directory', 'python', 'pass-env', 'port-base'].includes(key) &&
      typeof value === 'string' && value && !value.startsWith('--') && !Object.hasOwn(selected, key), 'Invalid native journey arguments');
    selected[key] = value;
  }
  for (const key of ['source', 'directory', 'python', 'pass-env']) assert(selected[key], 'Supply --' + key);
  for (const key of ['source', 'directory', 'python']) {
    assert(isAbsolute(selected[key]), '--' + key + ' must be absolute');
    selected[key] = resolve(selected[key]);
  }
  assert(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(selected['pass-env']), 'Use a private environment variable name');
  const portBase = Number(selected['port-base'] ?? '24840');
  assert(Number.isSafeInteger(portBase) && portBase >= 1024 && portBase <= 65529, 'Choose seven consecutive unprivileged ports');
  return { source: selected.source, directory: selected.directory, python: selected.python,
    passphraseEnv: selected['pass-env'], portBase };
}

export async function runFleetRecoveryJourney(input) {
  const { source, directory, python, passphraseEnv, portBase } = input;
  assert.equal(process.platform, 'linux', 'The original native fleet requires Linux flock');
  assert(typeof process.getuid === 'function' && process.getuid() > 0 &&
    typeof process.getgid === 'function' && process.getgid() > 0, 'Run under the actual nonroot service UID and GID');
  assert(typeof process.env[passphraseEnv] === 'string' && process.env[passphraseEnv].length >= 16,
    'Provision and retain the passphrase through the host private environment before running');
  assert.equal(await realpath(source), source);
  assert(!inside(source, directory) && !inside(directory, source) && source !== directory);
  const uid = process.getuid(), gid = process.getgid();
  const [user, group, pythonVersion, flockVersion] = await Promise.all([
    exec('id', ['-un']), exec('id', ['-gn']), exec(python, ['--version']), exec('flock', ['--version']),
  ]);
  const serviceUser = user.stdout.trim(), serviceGroup = group.stdout.trim();
  assert(/^[a-z_][a-z0-9_-]{0,30}$/.test(serviceUser) && serviceUser !== 'root');
  assert(/^[a-z_][a-z0-9_-]{0,30}$/.test(serviceGroup) && serviceGroup !== 'root');
  const pins = [];
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    const bytes = await readFile(join(source, path));
    assert.equal(gitBlob(bytes), expected, 'Selected published source changed: ' + path);
    pins.push({ path, gitBlob: expected, bytes: bytes.length, sha256: sha(bytes) });
  }
  const rootBefore = await exists(directory);
  if (rootBefore) {
    await privateDirectory(directory);
    const existing = await exists(join(directory, 'journey.json'));
    if (existing) {
      const saved = JSON.parse(await readFile(join(directory, 'journey.json'), 'utf8'));
      assert.equal(saved.operationId, OPERATION);
      assert.equal(stable(saved.input), stable(input));
      if (saved.state === 'COMPLETE') return saved;
      throw Object.assign(new Error('Continue this retained native case from its actual phase; the whole journey is not replayed'),
        { code: 'FLEET_JOURNEY_RETAINED', record: join(directory, 'journey.json'), phase: saved.phase });
    }
    assert.equal((await readdir(directory)).length, 0, 'Use a new or empty owned private native case');
  } else await privateDirectory(directory, { create: true });
  const root = directory, inputs = join(root, 'inputs'), stateParent = join(root, 'state'),
    hosts = join(root, 'hosts'), recovery = join(root, 'recovery'), retired = join(root, 'retired');
  for (const path of [inputs, stateParent, hosts, recovery, retired]) await privateDirectory(path, { create: true });
  const stateRoot = join(stateParent, 'fleet'), sourceBundle = join(hosts, 'original'),
    receivedBundle = join(hosts, 'received'), bootstrapFile = join(inputs, 'bootstrap.json'),
    deploymentFile = join(inputs, 'host.json'), planFile = join(recovery, 'fleet-recovery-plan.json'),
    encrypted = join(recovery, 'encrypted'), plaintext = join(recovery, 'plaintext'),
    captureOperation = join(recovery, 'capture-operation'), receiveOperation = join(recovery, 'receive-operation'),
    targetsFile = join(recovery, 'targets.json');
  const recordFile = join(root, 'journey.json');
  const record = { schema: 'stellar-forge.fleet-recovery-native-journey.v1',
    operationId: OPERATION, input, state: 'OPERATING', phase: 'prepared', createdAt: new Date().toISOString(),
    source: { selectedCommit: SOURCE_COMMIT, verifiedFiles: pins },
    environment: { uid, gid, serviceUser, serviceGroup, node: process.version, nodeExecutable: process.execPath,
      python, pythonVersion: (pythonVersion.stdout || pythonVersion.stderr).trim(), flock: flockVersion.stdout.trim() },
    paths: { root, stateRoot, sourceBundle, receivedBundle, bootstrapFile, deploymentFile,
      planFile, encrypted, plaintext, captureOperation, receiveOperation, targetsFile, retired },
    stages: [] };
  await writeNew(recordFile, json(record));
  const stage = async (name, run) => {
    record.phase = name; await atomic(recordFile, record);
    const result = await run();
    record.stages.push({ name, completedAt: new Date().toISOString(), result }); await atomic(recordFile, record);
    process.stdout.write(JSON.stringify({ operationId: OPERATION, stage: name, complete: true }) + '\n');
    return result;
  };
  const imports = await Promise.all([
    import(pathToFileURL(join(source, COMPONENT, 'release-bootstrap.mjs'))),
    import(pathToFileURL(join(source, COMPONENT, 'deploy.mjs'))),
    import(pathToFileURL(join(source, COMPONENT, 'deploy-runtime.mjs'))),
    import(pathToFileURL(join(source, COMPONENT, 'recovery.mjs'))),
  ]);
  const [{ bootstrapFleet }, { generateFleetDeployment, checkFleetBundle },
    { runFleetDeployment, fleetDeploymentHealth }, receiver] = imports;
  let runtime = null;
  const close = async () => {
    if (runtime) { const owned = runtime; await owned.close(); await owned.completion; runtime = null; }
  };
  let failure;
  try {
    await stage('original-bootstrap-and-host', async () => {
      for (let port = portBase; port < portBase + 7; port++) await bindPort(port);
      const base = JSON.parse(await readFile(join(source, PREFIX, 'sf30-seller-sdk/python/example-merchant.json'), 'utf8'));
      const app = await readFile(join(source, PREFIX, 'sf30-seller-sdk/python/example-application.py'));
      const merchants = [];
      for (const id of ['alpha', 'bravo']) {
        const merchant = join(inputs, id); await privateDirectory(merchant, { create: true });
        const packages = {};
        for (const version of id === 'alpha' ? ['current', 'next'] : ['current']) {
          const folder = join(merchant, version); await privateDirectory(folder, { create: true });
          await writeNew(join(folder, 'example-application.py'), app);
          const config = structuredClone(base);
          config.publicOrigin = 'https://' + id + '.fleet-recovery.example';
          config.serviceName = id + ' original Python merchant'; config.python = python; config.workerCount = 1;
          for (const definition of Object.values(config.functions)) definition.payment.amount = version === 'next' ? '31000' : '10000';
          await writeNew(join(folder, 'merchant.json'), json(config));
          packages[version] = { python: join(folder, 'merchant.json'), pythonRoot: folder };
        }
        merchants.push({ id, host: id + '.fleet-recovery.example', packages,
          initial: { package: 'current', releaseId: id + '-v1', label: 'Original initial ' + id } });
      }
      await writeNew(bootstrapFile, json({ schema: 'stellar-forge.fleet-bootstrap.v1',
        gateway: { port: portBase, adminPort: portBase + 1 }, merchantPortStart: portBase + 3,
        slots: ['blue', 'green'], tenants: merchants }));
      const bootstrap = await bootstrapFleet({ declarationFile: bootstrapFile, directory: stateRoot });
      await writeNew(deploymentFile, json({ schema: 'stellar-forge.fleet-host.v1',
        fleet: 'fleet-recovery-native', planFile: bootstrap.planFile, stateRoot,
        releaseDirectory: stateRoot, gatewayStateDirectory: join(stateRoot, 'gateway'),
        workspacePort: portBase + 2, serviceUser, serviceGroup, serviceUid: uid, serviceGid: gid,
        node: process.execPath, readOnlyRoots: [inputs], stopSeconds: 180 }));
      const generated = await generateFleetDeployment(deploymentFile, sourceBundle, { sourceRoot: source });
      const checked = await checkFleetBundle(sourceBundle);
      assert.equal(checked.planDigest, bootstrap.planDigest);
      return { bootstrap, deployment: { bundle: checked.bundle, planDigest: checked.planDigest,
        serviceUid: checked.serviceUid, serviceGid: checked.serviceGid, artifacts: checked.artifacts }, generated };
    });
    const served = await stage('native-release-and-customer-handover', async () => {
      runtime = await runFleetDeployment({ bundle: sourceBundle, handleSignals: true });
      const session = (await api(runtime.workspace, '/api/session')).session;
      const before = await fleetDeploymentHealth(sourceBundle);
      assert.equal(before.revision, 1);
      const first = await challenge(runtime.merchantIngress, 'alpha.fleet-recovery.example', '10000');
      const bravo = await challenge(runtime.merchantIngress, 'bravo.fleet-recovery.example', '10000');
      const staged = (await api(runtime.workspace, '/api/releases/stage', session,
        { tenant: 'alpha', slot: 'green', package: 'next', releaseId: 'alpha-v2' })).result;
      const reviewed = (await api(runtime.workspace, '/api/releases/review', session,
        { tenant: 'alpha', slot: 'green', releaseId: 'alpha-v2' })).result;
      const prepared = (await api(runtime.workspace, '/api/releases/prepare', session, { reviewId: reviewed.reviewId })).result;
      await api(runtime.workspace, '/api/activate', session,
        { candidateId: prepared.candidateId, expectedRevision: prepared.expectedRevision });
      const health = await ready(runtime, 2, 'green', fleetDeploymentHealth, sourceBundle);
      const selected = await challenge(runtime.merchantIngress, 'alpha.fleet-recovery.example', '31000');
      const unchanged = await challenge(runtime.merchantIngress, 'bravo.fleet-recovery.example', '10000');
      assert.equal(unchanged.bodySha256, bravo.bodySha256);
      const status = await api(runtime.workspace, '/api/status', session);
      const slot = status.releaseStatus.tenants.find(row => row.id === 'alpha').slots.find(row => row.name === 'green');
      await api(runtime.workspace, '/api/releases/clients/generate', session,
        { tenant: 'alpha', slot: 'green', instanceId: slot.instanceId, id: 'recovery-customer-v2' });
      const clients = await api(runtime.workspace, '/api/releases/clients?tenant=alpha&slot=green', session);
      const client = clients.entries.find(row => row.exportId === 'recovery-customer-v2');
      assert(client && client.state === 'COMPLETION_RETAINED' && /^[a-f0-9]{64}$/.test(client.manifestFile.sha256));
      await close();
      return { before, first, bravo, staged, health, selected, client };
    });
    const captured = await stage('stopped-native-encrypted-capture', async () => {
      const prepared = await receiver.prepareFleetRecoveryPlan({ deploymentBundle: sourceBundle, planFile, quiesced: true });
      const result = await receiver.captureFleetRecovery({ planFile, bundleDirectory: encrypted,
        operationDirectory: captureOperation, passphraseEnv, expectedPlanSha256: prepared.sha256, quiesced: true });
      assert.equal(result.status, 'FLEET_CAPTURED');
      assert.equal(result.summary.planDigest, served.health.planDigest);
      assert.equal(result.summary.links.revisions.at(-1).revision, 2);
      const reopened = await receiver.captureFleetRecovery({ planFile, bundleDirectory: encrypted,
        operationDirectory: captureOperation, passphraseEnv, expectedPlanSha256: prepared.sha256 });
      assert.equal(reopened.snapshotId, result.snapshotId);
      return { prepared: { planFile, sha256: prepared.sha256, summary: prepared.summary, source: prepared.source },
        result, originalRoots: prepared.plan.merchantFleet.roots };
    });
    await stage('preserve-only-this-new-stopped-source', async () => {
      const expected = new Set([stateRoot, sourceBundle, inputs]);
      assert.equal(captured.originalRoots.length, expected.size);
      const preserved = [];
      for (const root of captured.originalRoots) {
        assert(expected.delete(root.path) && inside(directory, root.path), 'Only this operation newly created sources may move');
        const stat = await lstat(root.path);
        assert.equal(stat.uid, uid); assert.equal(stat.gid, gid);
        const destination = join(retired, root.name);
        assert.equal(await exists(destination), null);
        const pending = { name: root.name, original: root.path, destination, device: stat.dev, inode: stat.ino };
        record.pendingPreservation = pending; await atomic(recordFile, record);
        await rename(root.path, destination);
        const moved = await lstat(destination);
        assert.equal(moved.dev, stat.dev); assert.equal(moved.ino, stat.ino);
        assert.equal(await exists(root.path), null);
        preserved.push(pending); record.preservedSources = preserved; delete record.pendingPreservation;
        await atomic(recordFile, record);
      }
      assert.equal(expected.size, 0);
      return { preserved };
    });
    const received = await stage('authenticated-restore-and-original-path-receiving', async () => {
      const common = { bundleDirectory: encrypted, restoreDirectory: plaintext,
        passphraseEnv, expectedManifestSha256: captured.result.snapshotId };
      const restored = await receiver.restoreFleetRecovery(common);
      assert.equal(restored.status, 'FLEET_RESTORED');
      await writeNew(targetsFile, json({ schema: 'stellar-forge.fleet-recovery-targets.v1',
        sourcePlanSha256: captured.prepared.sha256, destinationParents: [directory], deploymentBundle: receivedBundle }));
      const selection = { ...common, targetFile: targetsFile, operationDirectory: receiveOperation };
      const review = await receiver.inspectRestoredFleet(selection);
      assert(review.availability.every(row => row.state === 'ABSENT'));
      const receivingInput = { ...selection, expectedReviewSha256: review.reviewSha256, quiesced: true };
      const result = await receiver.prepareRestoredFleet(receivingInput);
      assert.equal(result.status, 'FLEET_RECEIVING_COMPLETE');
      const checked = await checkFleetBundle(receivedBundle);
      assert.equal(checked.planDigest, served.health.planDigest);
      assert.equal(result.originalDeploymentBundle, sourceBundle);
      record.receivingInput = receivingInput;
      return { restored, review, result, bundle: { bundle: checked.bundle,
        planDigest: checked.planDigest, artifacts: checked.artifacts } };
    });
    await stage('received-native-use-rollback-and-same-state-reopen', async () => {
      runtime = await runFleetDeployment({ bundle: receivedBundle, handleSignals: true });
      const session = (await api(runtime.workspace, '/api/session')).session;
      const reopened = await ready(runtime, 2, 'green', fleetDeploymentHealth, receivedBundle);
      const challengeV2 = await challenge(runtime.merchantIngress, 'alpha.fleet-recovery.example', '31000');
      assert.equal(challengeV2.bodySha256, served.selected.bodySha256);
      const clients = await api(runtime.workspace, '/api/releases/clients?tenant=alpha&slot=green', session);
      const client = clients.entries.find(row => row.exportId === 'recovery-customer-v2');
      assert.equal(stable(client), stable(served.client), 'Complete original customer export and provenance must reopen unchanged');
      const rollbackReview = (await api(runtime.workspace, '/api/releases/review-rollback', session, { targetRevision: 1 })).result;
      const rollback = (await api(runtime.workspace, '/api/releases/rollback', session, { reviewId: rollbackReview.reviewId })).result;
      const rolled = await ready(runtime, 3, 'blue', fleetDeploymentHealth, receivedBundle);
      const challengeV1 = await challenge(runtime.merchantIngress, 'alpha.fleet-recovery.example', '10000');
      assert.equal(challengeV1.bodySha256, served.first.bodySha256);
      await close();
      runtime = await runFleetDeployment({ bundle: receivedBundle, handleSignals: true });
      const finalHealth = await ready(runtime, 3, 'blue', fleetDeploymentHealth, receivedBundle);
      await close();
      const receipt = await receiver.prepareRestoredFleet(record.receivingInput);
      assert.equal(stable(receipt), stable(received.result), 'Completed receiving must return its original receipt after native use');
      const ports = [];
      for (let port = portBase; port < portBase + 7; port++) { await bindPort(port); ports.push(port); }
      return { reopened, challengeV2, client, rollback, rolled, challengeV1,
        finalHealth, completedReceivingReceipt: receipt, releasedListenerPorts: ports };
    });
    record.phase = 'complete'; record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await atomic(recordFile, record);
    process.stdout.write(JSON.stringify({ operationId: OPERATION, state: record.state,
      record: recordFile, snapshotId: captured.result.snapshotId,
      receivingOperationId: received.result.operationId, completedAt: record.completedAt }) + '\n');
    return record;
  } catch (error) {
    failure = error;
    record.state = 'NEEDS_CONTINUATION'; record.error = { name: error.name, code: error.code ?? null,
      message: error.message, ...(error.nativeStatus ? { nativeStatus: error.nativeStatus, nativeResponse: error.nativeResponse } : {}) };
    await atomic(recordFile, record).catch(() => {});
    throw error;
  } finally {
    try { await close(); }
    catch (error) {
      record.state = 'SHUTDOWN_NEEDS_CONTINUATION'; record.shutdownError = { code: error.code ?? null, message: error.message };
      await atomic(recordFile, record).catch(() => {});
      if (!failure) throw error;
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Run the published original fleet recovery receiving journey on an existing Linux service account.\n' +
      'node recovery-journey.mjs --source /absolute/source-at-' + SOURCE_COMMIT +
      ' --directory /absolute/new-private-case --python /absolute/python3 --pass-env EXISTING_PRIVATE_VARIABLE [--port-base 24840]\n');
    return;
  }
  return runFleetRecoveryJourney(options(args));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(JSON.stringify({ operationId: OPERATION,
    error: error.code ?? error.name, message: error.message, record: error.record ?? null }) + '\n'); process.exitCode = 1; });
}
