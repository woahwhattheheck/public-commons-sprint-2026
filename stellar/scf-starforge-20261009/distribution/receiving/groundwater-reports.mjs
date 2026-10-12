#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The complete original Groundwater selection through maintained source and runtime receiving.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openGitSource } from '../git-source.mjs';
import { createRuntimeWorkspace, openRuntimeWorkspace } from '../runtime-workspace/model.mjs';
import { startRuntimeWorkspace } from '../runtime-workspace/server.mjs';
import { inspectRuntimeInstall, installRuntime, runtimeCommand } from '../runtime-install.mjs';
import { exportRuntimeTransfer, inspectRuntimeTransfer, beginRuntimeTransferReceive,
  receiveRuntimeTransferPart, completeRuntimeTransferReceive, installReceivedRuntime } from '../runtime-transfer.mjs';
import { MAX_MANIFEST_BYTES } from '../runtime-transfer-lock.mjs';
import { plain, need, absolute, privateDirectory, makePrivate, regular, readJSON,
  saveJSON, digest, canonical, json, operationLease } from '../runtime-workspace/storage.mjs';

const SCHEMA = 'stellar-forge.groundwater-distribution-receiving.v1';
const RESULT = 'stellar-forge.groundwater-distribution-result.v1';
const PREFIX = 'stellar/scf-starforge-20261009/distribution/';
const CORE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/groundwater/';
const SELECTION = 'groundwater-reports';
const SHA = /^[a-f0-9]{40}$/;
const same = (a, b) => json(canonical(a)) === json(canonical(b));
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const uuidFor = value => {
  const h = digest(value);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
};
const now = () => new Date().toISOString();
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateRoot(path) {
  try { return await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return privateDirectory(path); }
}
function abort(signal) { if (signal?.aborted) throw signal.reason ?? new Error('Stopped'); }
async function pause(signal) {
  abort(signal);
  await new Promise((done, reject) => {
    const stop = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Stopped')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); done(); }, 500);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
async function retain(path, value) {
  const old = await readJSON(path, true);
  if (old) { need(same(old, value), 'GROUNDWATER_RECEIVING_RECORD_CHANGED', path); return old; }
  try { await saveJSON(path, value); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(same(await readJSON(path), value), 'GROUNDWATER_RECEIVING_RECORD_CHANGED', path);
  }
  return value;
}
async function fileIdentity(path, maximum = 64 * 1024 * 1024) {
  need(await realpath(path) === path, 'GROUNDWATER_RECEIVING_REAL_FILE_REQUIRED', path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'GROUNDWATER_RECEIVING_FILE_INVALID', path);
    const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024); let position = 0;
    while (position < first.size) {
      const part = await handle.read(buffer, 0, Math.min(buffer.length, first.size - position), position);
      need(part.bytesRead > 0, 'GROUNDWATER_RECEIVING_FILE_CHANGED', path);
      hash.update(buffer.subarray(0, part.bytesRead)); position += part.bytesRead;
    }
    const last = await handle.stat();
    need(first.ino === last.ino && first.dev === last.dev && first.size === last.size &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
    'GROUNDWATER_RECEIVING_FILE_CHANGED', path);
    return { path, bytes: first.size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
function inputValue(value) {
  const fields = ['schema', 'operationId', 'repository', 'ref', 'directory', 'python',
    'cache', 'offlineSource', 'offlineInstall', 'pins', 'nodeHeaders', 'waitMilliseconds', 'browser'];
  need(plain(value) && value.schema === SCHEMA && Object.keys(value).every(key => fields.includes(key)),
    'GROUNDWATER_RECEIVING_INPUT_INVALID');
  need(typeof value.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.operationId),
    'GROUNDWATER_RECEIVING_OPERATION_REQUIRED');
  need(SHA.test(value.ref ?? ''), 'GROUNDWATER_RECEIVING_COMMIT_REQUIRED');
  for (const key of ['repository', 'directory', 'python', 'cache']) absolute(value[key]);
  if (value.nodeHeaders !== undefined) absolute(value.nodeHeaders);
  for (const key of ['offlineSource', 'offlineInstall']) need(typeof value[key] === 'boolean',
    'GROUNDWATER_RECEIVING_NETWORK_SELECTION_REQUIRED', key);
  need(value.pins === undefined || plain(value.pins), 'GROUNDWATER_RECEIVING_PINS_INVALID');
  need(value.waitMilliseconds === undefined || Number.isSafeInteger(value.waitMilliseconds) &&
    value.waitMilliseconds >= 1000 && value.waitMilliseconds <= 3600000, 'GROUNDWATER_RECEIVING_WAIT_INVALID');
  if (value.browser !== undefined) {
    need(plain(value.browser) && Object.keys(value.browser).every(key => ['package', 'executable'].includes(key)),
      'GROUNDWATER_RECEIVING_BROWSER_INVALID');
    absolute(value.browser.package); absolute(value.browser.executable);
  }
  const disjoint = (a, b) => a !== b && !a.startsWith(b + '/') && !b.startsWith(a + '/');
  need(disjoint(value.repository, value.directory) && disjoint(value.cache, value.directory),
    'GROUNDWATER_RECEIVING_DIRECTORY_OVERLAP');
  return JSON.parse(JSON.stringify(value));
}
async function scienceContract() {
  const value = await readJSON(fileURLToPath(new URL('./groundwater-sources.json', import.meta.url)));
  need(value.schema === 'stellar-forge.groundwater-original-source.v1' && value.sourcePrefix === CORE &&
    SHA.test(value.sourceHead ?? '') && SHA.test(value.sourceCapsule ?? '') && value.files?.length === 64 &&
    new Set(value.files.map(item => item.path)).size === 64, 'GROUNDWATER_SCIENTIFIC_SOURCE_CONTRACT_CHANGED');
  for (const item of value.files) need(typeof item.path === 'string' && !item.path.startsWith('/') &&
    item.path.split('/').every(p => p && p !== '.' && p !== '..') && !/[\\\u0000-\u0020]/.test(item.path) &&
    SHA.test(item.gitBlob ?? '') && Number.isSafeInteger(item.bytes) && item.bytes >= 0,
  'GROUNDWATER_SCIENTIFIC_SOURCE_CONTRACT_CHANGED');
  return value;
}
async function verifyExecutor(input, contract) {
  const source = openGitSource({ repository: input.repository, ref: input.ref, offline: input.offlineSource });
  need(source.commit === input.ref, 'GROUNDWATER_RECEIVING_SOURCE_CHANGED');
  const own = fileURLToPath(import.meta.url);
  need(own === join(input.repository, PREFIX, 'receiving/groundwater-reports.mjs'),
    'GROUNDWATER_RECEIVING_EXECUTOR_PATH', 'Execute the original caller from the selected checkout.');
  const entries = source.tree.filter(item => item.path.startsWith(PREFIX));
  const bytes = source.readFiles(entries), manifest = [];
  for (const entry of entries) {
    const current = await regular(join(input.repository, entry.path));
    need(gitBlob(current) === entry.blob && current.equals(bytes.get(entry.path)),
      'GROUNDWATER_RECEIVING_EXECUTOR_CHANGED', entry.path);
    manifest.push({ path: entry.path, gitBlob: entry.blob, bytes: current.length, sha256: digest(current) });
  }
  const byPath = new Map(source.tree.map(item => [item.path, item]));
  for (const item of contract.files) need(byPath.get(CORE + item.path)?.blob === item.gitBlob,
    'GROUNDWATER_SCIENTIFIC_COMMIT_CHANGED', item.path);
  return { sourceCommit: source.commit, files: manifest };
}
async function verifyScience(sourceRoot, contract, expectedCommit) {
  const manifestPath = join(dirname(sourceRoot), 'manifest.json');
  const manifest = await readJSON(manifestPath);
  need(manifest.sourceCommit === expectedCommit && manifest.sourceSelection?.id === SELECTION,
    'GROUNDWATER_SCIENTIFIC_PACKAGE_CHANGED');
  const result = [];
  for (const expected of contract.files) {
    const name = CORE + expected.path, entry = manifest.files.find(item => item.path === name);
    need(entry?.gitBlob === expected.gitBlob && entry.bytes === expected.bytes,
      'GROUNDWATER_SCIENTIFIC_MEMBER_MISSING', name);
    const path = join(sourceRoot, name);
    need(await realpath(path) === path, 'GROUNDWATER_SCIENTIFIC_MEMBER_PATH', name);
    const bytes = await regular(path);
    need(bytes.length === expected.bytes && gitBlob(bytes) === expected.gitBlob &&
      digest(bytes) === entry.sha256, 'GROUNDWATER_SCIENTIFIC_MEMBER_CHANGED', name);
    result.push({ path: name, bytes: bytes.length, gitBlob: expected.gitBlob, sha256: entry.sha256 });
  }
  return { sourceHead: contract.sourceHead, sourceCapsule: contract.sourceCapsule,
    installedCommit: expectedCommit, sourceRoot, files: result, count: result.length,
    bytes: result.reduce((sum, item) => sum + item.bytes, 0) };
}
async function waitOperation(model, id, input, { signal, progress }, sourceBuild = false) {
  const started = Date.now(); let last = '';
  for (;;) {
    abort(signal);
    const state = await model.state(), op = state.operations.find(item => item.id === id);
    need(op, 'GROUNDWATER_ORIGINAL_OPERATION_MISSING', id);
    const signature = [op.phase, op.sourceBuildStage, op.workerActive].join('/');
    if (signature !== last) { await progress({ phase: sourceBuild ? 'SOURCE_BUILD' : 'RUNTIME_PREPARATION',
      operationId: id, state: op.phase, stage: op.sourceBuildStage ?? null }); last = signature; }
    if (op.phase === 'SUCCEEDED') return op;
    if (op.phase === 'FAILED' || op.displayPhase === 'INTERRUPTED') {
      const error = Object.assign(new Error(op.error?.message ?? 'Continue the retained original operation.'), {
        code: op.error?.code ?? 'GROUNDWATER_ORIGINAL_OPERATION_INTERRUPTED', operationId: id, original: op });
      try { error.workerLog = await model.logs({ operationId: id }); } catch {}
      throw error;
    }
    need(Date.now() - started < (input.waitMilliseconds ?? 1800000),
      'GROUNDWATER_ORIGINAL_OPERATION_WAIT', id);
    await pause(signal);
  }
}
async function beginOriginal(model, request, input, options, sourceBuild = false) {
  const prior = (await model.state()).operations.find(item => item.id === request.requestId);
  await model.begin(request);
  if (prior && prior.phase !== 'SUCCEEDED' && !prior.workerActive) {
    if (sourceBuild) {
      try { await model.recoverSourceBuildOperation(request.requestId); }
      catch (error) { if (!['RUNTIME_WORKSPACE_OPERATION_RUNNING', 'DISTRIBUTION_BUILD_ALREADY_RUNNING'].includes(error.code)) throw error; }
    } else if (prior.phase === 'QUEUED') await model.resumeQueued(request.requestId);
  }
  return waitOperation(model, request.requestId, input, options, sourceBuild);
}
async function command(runtime, args, signal) {
  abort(signal);
  const selected = await runtimeCommand({ directory: runtime, args });
  const child = spawn(selected.executable, selected.args, { cwd: selected.cwd,
    shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', bytes = 0, failure = null;
  const take = stream => chunk => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) { failure = new Error('Original command output exceeds the bounded receipt.'); child.kill('SIGTERM'); return; }
    if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
  };
  child.stdout.on('data', take('stdout')); child.stderr.on('data', take('stderr'));
  const stop = () => child.kill('SIGTERM');
  signal?.addEventListener('abort', stop);
  let code, killed;
  try {
    [code, killed] = await new Promise((done, reject) => {
      child.once('error', reject); child.once('close', (code, stopped) => done([code, stopped]));
    });
  } finally { signal?.removeEventListener('abort', stop); }
  abort(signal);
  need(!failure && code === 0 && !killed, 'GROUNDWATER_INSTALLED_COMMAND_FAILED',
    failure?.message ?? args.join(' ') + ': ' + stderr.slice(-2000));
  return { command: args, exitCode: code, stdout, stderr };
}
async function sourceUi(directory, review, expectedArchive, expectedWorkspace, input, signal) {
  abort(signal);
  const server = await startRuntimeWorkspace({ directory, port: 0 });
  let browser;
  try {
    const token = new URL(server.url).hash.slice(1);
    const api = async (path, value) => {
      const response = await fetch(server.origin + path, { method: value === undefined ? 'GET' : 'POST',
        headers: { 'x-runtime-workspace-token': token, origin: server.origin,
          ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal });
      const result = await response.json();
      need(response.ok, 'GROUNDWATER_OPERATOR_READBACK_FAILED', result.message ?? path);
      return result;
    };
    const state = await api('/api/state');
    need(state.workspaceId === expectedWorkspace, 'GROUNDWATER_OPERATOR_WORKSPACE_CHANGED');
    const original = await api('/api/source-builds/review?reviewId=' + review.reviewId);
    need(same(original, review), 'GROUNDWATER_OPERATOR_REVIEW_CHANGED');
    const builds = await api('/api/source-builds/state');
    const saved = builds.builds.find(item => item.reviewId === review.reviewId);
    need(saved?.requestId === review.requestId && saved.phase === 'SUCCEEDED' &&
      saved.archive?.sha256 === expectedArchive.sha256, 'GROUNDWATER_OPERATOR_BUILD_CHANGED');
    const download = await api('/api/source-builds/download', { reviewId: review.reviewId });
    need(download.sha256 === expectedArchive.sha256 && download.bytes === expectedArchive.bytes,
      'GROUNDWATER_OPERATOR_DOWNLOAD_CHANGED');
    const response = await fetch(download.url, { signal });
    need(response.ok, 'GROUNDWATER_OPERATOR_DOWNLOAD_FAILED');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; need(bytes <= expectedArchive.bytes, 'GROUNDWATER_OPERATOR_DOWNLOAD_CHANGED'); hash.update(chunk);
    }
    need(bytes === expectedArchive.bytes && hash.digest('hex') === expectedArchive.sha256,
      'GROUNDWATER_OPERATOR_DOWNLOAD_CHANGED');
    let visible = { state: 'not_requested' };
    if (input.browser) {
      const require = createRequire(join(input.browser.package, 'package.json')), pw = require(input.browser.package);
      browser = await pw.chromium.launch({ executablePath: input.browser.executable, headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.locator('nav button[data-view="source-builds"]').click();
      const card = page.locator('article[data-review-id="' + review.reviewId + '"]');
      await card.waitFor({ state: 'visible' });
      need((await card.innerText()).includes(expectedArchive.sha256), 'GROUNDWATER_VISIBLE_ARCHIVE_CHANGED');
      await card.getByRole('button', { name: 'Open product', exact: true }).click();
      const panel = page.locator('[data-review-panel]');
      await panel.waitFor({ state: 'visible' });
      need((await panel.innerText()).includes(review.sourceCommit), 'GROUNDWATER_VISIBLE_REVIEW_CHANGED');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('nav button[data-view="source-builds"]').click();
      await page.locator('article[data-review-id="' + review.reviewId + '"]').waitFor({ state: 'visible' });
      visible = { state: 'complete', workspaceId: expectedWorkspace, reviewId: review.reviewId,
        sourceCommit: review.sourceCommit, originalArchiveSha256: expectedArchive.sha256, reopened: true };
      await browser.close(); browser = null;
    }
    return { state: 'complete', workspaceId: expectedWorkspace, reviewId: review.reviewId,
      requestId: review.requestId, sourceCommit: review.sourceCommit, archive: expectedArchive,
      visible, stopped: true };
  } finally { try { if (browser) await browser.close(); } finally { await server.close(); } }
}
async function checkedRuntime(directory, input, contract, profileId, expectedLock) {
  const result = await inspectRuntimeInstall({ directory, load: true, source: true, python: input.python });
  need(result.ready && result.status === 'READY' && result.sourceCommit === input.ref &&
    result.profileId === profileId && (!expectedLock || result.lockSha256 === expectedLock),
  'GROUNDWATER_READY_RUNTIME_CHANGED');
  return { inspection: result, scientific: await verifyScience(result.sourceRoot, contract, input.ref) };
}
async function verifyCompleted(value, input, contract) {
  need(value.schema === RESULT && value.state === 'complete' && value.operationId === input.operationId &&
    value.inputSha256 === digest(json(canonical(input))), 'GROUNDWATER_COMPLETED_RECEIPT_CHANGED');
  const original = await checkedRuntime(value.original.directory, input, contract, value.profileId, value.lockSha256);
  const received = await checkedRuntime(value.received.directory, input, contract, value.profileId, value.lockSha256);
  need(original.inspection.installationId === received.inspection.installationId &&
    original.inspection.installationId === value.installationId, 'GROUNDWATER_RECEIVED_IDENTITY_CHANGED');
  const transfer = await inspectRuntimeTransfer({ directory: value.transfer.directory, verify: true });
  const receiving = await inspectRuntimeTransfer({ directory: value.receiving.directory, verify: true });
  need(transfer.complete && receiving.complete && transfer.manifestSha256 === value.transfer.manifestSha256 &&
    receiving.manifestSha256 === value.transfer.manifestSha256, 'GROUNDWATER_COMPLETED_TRANSFER_CHANGED');
  const model = await openRuntimeWorkspace({ directory: value.workspace.directory });
  try {
    const state = await model.state();
    need(state.workspaceId === value.workspace.id, 'GROUNDWATER_COMPLETED_WORKSPACE_CHANGED');
    const review = await model.sourceBuildsReadReview(value.reviewId);
    need(review.requestId === value.sourceBuildOperationId && review.selectionSha256 === value.selectionSha256,
      'GROUNDWATER_COMPLETED_REVIEW_CHANGED');
    const source = await model.sourceBuildsDownload(value.reviewId);
    try { need(source.sha256 === value.sourceArchive.sha256 && source.bytes === value.sourceArchive.bytes,
      'GROUNDWATER_COMPLETED_ARCHIVE_CHANGED'); } finally { await source.handle.close(); }
  } finally { await model.close(); }
  for (const expected of value.files) {
    const observed = await fileIdentity(expected.path, Math.max(expected.bytes, 1));
    need(observed.bytes === expected.bytes && observed.sha256 === expected.sha256,
      'GROUNDWATER_COMPLETED_ARTIFACT_UNAVAILABLE', expected.path);
  }
  return { ...value, replayed: true };
}
export async function runGroundwaterDistributionReceiving(value, { signal, progress = async () => {} } = {}) {
  const input = inputValue(value), contract = await scienceContract();
  await privateRoot(input.directory);
  const lease = await operationLease(join(input.directory, 'worker.lock'));
  let model;
  try {
    const requestFile = join(input.directory, 'request.json');
    await retain(requestFile, input);
    const complete = await readJSON(join(input.directory, 'result.json'), true);
    if (complete) return await verifyCompleted(complete, input, contract);
    const executor = await verifyExecutor(input, contract);
    await retain(join(input.directory, 'executor-source.json'), executor);
    await progress({ phase: 'EXACT_SOURCE', sourceCommit: input.ref, scientificFiles: contract.files.length });
    const workspace = join(input.directory, 'workspace');
    if (!await exists(workspace)) await createRuntimeWorkspace({ directory: workspace });
    need(await exists(join(workspace, 'workspace.json')), 'GROUNDWATER_WORKSPACE_CREATION_INTERRUPTED',
      'Preserve this original managed workspace and use its maintained initialization recovery.');
    model = await openRuntimeWorkspace({ directory: workspace });
    const workspaceId = (await model.state()).workspaceId;
    await retain(join(input.directory, 'workspace-identity.json'), { directory: workspace, workspaceId });
    const review = await model.sourceBuildsReview({ repository: input.repository, ref: input.ref, selection: SELECTION,
      offline: input.offlineSource, python: input.python });
    need(review.commands.groundwater && review.commands['groundwater-report'] &&
      review.applications.includes('groundwater-reports'), 'GROUNDWATER_FULL_PRODUCT_REGISTRATION_MISSING');
    await retain(join(input.directory, 'source-review.json'), review);
    const sourceRequest = { requestId: review.requestId, operation: 'source-build',
      reviewId: review.reviewId, selectionSha256: review.selectionSha256 };
    await retain(join(input.directory, 'source-request.json'), sourceRequest);
    const built = await beginOriginal(model, sourceRequest, input, { signal, progress }, true);
    need(built.result?.status === 'SOURCE_READY', 'GROUNDWATER_SOURCE_NOT_READY');
    const archive = await model.sourceBuildsDownload(review.reviewId);
    const sourceArchive = { path: built.result.build.archive, bytes: archive.bytes, sha256: archive.sha256 };
    await archive.handle.close();
    await retain(join(input.directory, 'source-archive.json'), sourceArchive);
    const profile = await model.review({ archiveId: built.result.archive.id,
      selection: { native: true, features: ['schema', 'openapi', 'mcp'], operator: true, pins: input.pins ?? {} } });
    await retain(join(input.directory, 'runtime-profile.json'), profile);
    const prepare = { requestId: uuidFor(input.operationId + '/prepare'), operation: 'prepare',
      archiveId: built.result.archive.id, name: 'groundwater-original', selection: profile.selection, profileId: profile.profileId };
    await retain(join(input.directory, 'prepare-request.json'), prepare);
    // A stopped original preparation recovers through the existing runtime operation.
    // Retain that successor request before dispatch; never recreate the old target.
    const recoveryFile = join(input.directory, 'prepare-recovery-request.json');
    let preparationRequest = await readJSON(recoveryFile, true);
    const priorPrepare = (await model.state()).operations.find(item => item.id === prepare.requestId);
    if (!preparationRequest && priorPrepare && !priorPrepare.workerActive &&
      (priorPrepare.phase === 'FAILED' || priorPrepare.displayPhase === 'INTERRUPTED')) {
      need(priorPrepare.targetId, 'GROUNDWATER_ORIGINAL_PREPARATION_TARGET_MISSING');
      preparationRequest = { requestId: uuidFor(input.operationId + '/recover-preparation'), operation: 'recover',
        runtimeId: priorPrepare.targetId, name: 'groundwater-original-recovered', install: false,
        offline: input.offlineInstall, cache: input.cache,
        ...(input.nodeHeaders ? { nodeHeaders: input.nodeHeaders } : {}) };
      await retain(recoveryFile, preparationRequest);
    }
    const prepared = await beginOriginal(model, preparationRequest ?? prepare, input, { signal, progress });
    const originalDirectory = prepared.result.directory;
    abort(signal);
    await progress({ phase: 'ORIGINAL_INSTALL', profileId: profile.profileId, directory: originalDirectory });
    await installRuntime({ directory: originalDirectory, offline: input.offlineInstall, cache: input.cache,
      ...(input.nodeHeaders ? { nodeHeaders: input.nodeHeaders } : {}) });
    abort(signal);
    const original = await checkedRuntime(originalDirectory, input, contract, profile.profileId);
    await retain(join(input.directory, 'original-scientific-source.json'), original.scientific);
    const originalCommands = [
      await command(originalDirectory, ['source'], signal),
      await command(originalDirectory, ['registrations', '--command', 'groundwater'], signal),
      await command(originalDirectory, ['registrations', '--command', 'groundwater-report'], signal),
      await command(originalDirectory, ['groundwater', '--python', input.python, '--help'], signal),
    ];
    await retain(join(input.directory, 'original-commands.json'), originalCommands);
    const originalEntry = await model.attach({ directory: originalDirectory, label: 'Groundwater original installation' });
    await saveJSON(join(input.directory, 'original-handoff.json'), await model.handoff(originalEntry.runtimeId), true);
    const transferDirectory = join(input.directory, 'transfer');
    await progress({ phase: 'ORIGINAL_TRANSFER', lockSha256: original.inspection.lockSha256 });
    await exportRuntimeTransfer({ runtimeDirectory: originalDirectory, directory: transferDirectory, cache: input.cache,
      expectedLockSha256: original.inspection.lockSha256, offline: input.offlineInstall, partBytes: 8 * 1024 * 1024,
      signal, onProgress: async event => progress({ phase: 'TRANSFER', original: event }) });
    const transfer = await inspectRuntimeTransfer({ directory: transferDirectory, verify: true });
    need(transfer.complete && transfer.state.phase === 'COMPLETE', 'GROUNDWATER_TRANSFER_INCOMPLETE');
    const receivingDirectory = join(input.directory, 'receiving');
    const manifest = await regular(join(transferDirectory, 'manifest.json'), MAX_MANIFEST_BYTES);
    await beginRuntimeTransferReceive({ directory: receivingDirectory, manifest, manifestSha256: transfer.manifestSha256 });
    for (const part of transfer.manifest.parts) {
      abort(signal);
      await receiveRuntimeTransferPart({ directory: receivingDirectory, index: part.index,
        file: join(transferDirectory, 'parts', part.name), signal });
    }
    await completeRuntimeTransferReceive({ directory: receivingDirectory, signal,
      onProgress: async event => progress({ phase: 'RECEIVING', original: event }) });
    const receivedDirectory = join(input.directory, 'groundwater-received');
    await progress({ phase: 'OFFLINE_INSTALL', directory: receivedDirectory });
    await installReceivedRuntime({ directory: receivingDirectory, runtimeDirectory: receivedDirectory,
      python: input.python, nodeHeaders: input.nodeHeaders ?? null, signal,
      onProgress: async event => progress({ phase: 'OFFLINE_INSTALL', original: event }) });
    const received = await checkedRuntime(receivedDirectory, input, contract, profile.profileId, original.inspection.lockSha256);
    need(original.inspection.installationId === received.inspection.installationId, 'GROUNDWATER_RECEIVED_IDENTITY_CHANGED');
    await retain(join(input.directory, 'received-scientific-source.json'), received.scientific);
    const receivedCommands = [
      await command(receivedDirectory, ['source'], signal),
      await command(receivedDirectory, ['registrations', '--command', 'groundwater-report'], signal),
      await command(receivedDirectory, ['groundwater', '--python', input.python, '--help'], signal),
    ];
    await retain(join(input.directory, 'received-commands.json'), receivedCommands);
    const receivedEntry = await model.attach({ directory: receivedDirectory, label: 'Groundwater received installation' });
    const comparison = await model.compare({ before: originalEntry.runtimeId, after: receivedEntry.runtimeId });
    need(!comparison.sourceChanged && !comparison.profileChanged && comparison.dependencies.length === 0,
      'GROUNDWATER_RECEIVED_PROFILE_CHANGED');
    await retain(join(input.directory, 'runtime-comparison.json'), comparison);
    await saveJSON(join(input.directory, 'received-handoff.json'), await model.handoff(receivedEntry.runtimeId), true);
    await model.close(); model = null;
    await progress({ phase: 'OPERATOR_REOPEN', workspaceId });
    const operator = await sourceUi(workspace, review, sourceArchive, workspaceId, input, signal);
    const files = [sourceArchive];
    for (const path of [join(transferDirectory, 'manifest.json'),
      ...transfer.manifest.parts.map(part => join(transferDirectory, 'parts', part.name)),
      ...['request.json', 'executor-source.json', 'source-review.json', 'source-request.json', 'runtime-profile.json',
        'prepare-request.json', 'workspace-identity.json', 'source-archive.json', 'original-scientific-source.json',
        'received-scientific-source.json', 'original-commands.json', 'received-commands.json', 'runtime-comparison.json',
        'original-handoff.json', 'received-handoff.json'].map(name => join(input.directory, name))])
      files.push(await fileIdentity(path));
    if (await exists(recoveryFile)) files.push(await fileIdentity(recoveryFile));
    const result = { schema: RESULT, state: 'complete', operationId: input.operationId,
      directory: input.directory,
      inputSha256: digest(json(canonical(input))), completedAt: now(), sourceCommit: input.ref, selection: SELECTION,
      scientificSource: { sourceHead: contract.sourceHead, sourceCapsule: contract.sourceCapsule,
        files: contract.files.length, bytes: original.scientific.bytes },
      workspace: { directory: workspace, id: workspaceId }, reviewId: review.reviewId,
      sourceBuildOperationId: review.requestId, selectionSha256: review.selectionSha256,
      sourceArchive, profileId: profile.profileId, installationId: original.inspection.installationId,
      lockSha256: original.inspection.lockSha256,
      original: { directory: originalDirectory, runtimeId: originalEntry.runtimeId, inspection: original.inspection },
      received: { directory: receivedDirectory, runtimeId: receivedEntry.runtimeId, inspection: received.inspection },
      transfer: { directory: transferDirectory, id: transfer.manifest.transferId, manifestSha256: transfer.manifestSha256,
        parts: transfer.parts.length, payloadBytes: transfer.manifest.payload.bytes },
      receiving: { directory: receivingDirectory }, operator, files,
      scientificExecution: 'The existing publisher/model/portal operation is retained by its original owner.',
      modelRunsStarted: 0, sellerStarts: 0, buyerRequests: 0 };
    await retain(join(input.directory, 'result.json'), result);
    return result;
  } catch (error) {
    await saveJSON(join(input.directory, 'last-observation.json'), {
      schema: RESULT, state: 'incomplete', operationId: input.operationId, observedAt: now(),
      code: error.code ?? 'GROUNDWATER_DISTRIBUTION_ERROR', message: String(error.message ?? error),
      operation: error.original ?? null, workerLog: error.workerLog ?? null,
      request: join(input.directory, 'request.json') }, true).catch(() => {});
    throw error;
  } finally { try { if (model) await model.close(); } finally { await lease.close(); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = signal => { if (!controller.signal.aborted) controller.abort(new Error('Stopped by ' + signal)); };
  const term = () => stop('SIGTERM'), interrupt = () => stop('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', interrupt);
  try {
    need(process.argv.length === 3, 'GROUNDWATER_RECEIVING_INPUT_FILE_REQUIRED',
      'node groundwater-reports.mjs /absolute/original-receiving-input.json');
    const result = await runGroundwaterDistributionReceiving(await readJSON(absolute(process.argv[2])), {
      signal: controller.signal, progress: value => process.stdout.write(JSON.stringify(value) + '\n') });
    process.stdout.write(JSON.stringify({ state: result.state, operationId: result.operationId,
      sourceCommit: result.sourceCommit, originalRequest: result.sourceBuildOperationId,
      sourceArchive: result.sourceArchive, transfer: result.transfer,
      result: join(result.directory, 'result.json'), directory: result.workspace.directory }) + '\n');
  } catch (error) { process.stderr.write((error.code ?? 'GROUNDWATER_DISTRIBUTION_ERROR') + ': ' + error.message + '\n'); process.exitCode = 1; }
  finally { process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt); }
}
