// MIT. Durable operator custody around the original exact-decimal engine.
import { constants } from 'node:fs';
import { open, mkdir, readdir, lstat, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const JOB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const defaults = Object.freeze({ maxInputBytes: 8 * 1024 * 1024, maxReportBytes: 16 * 1024 * 1024,
  timeoutMs: 60000, maxHeapMiB: 256 });
export class ReconciliationServiceError extends Error {
  constructor(code) { super(code); this.name = 'ReconciliationServiceError'; this.code = code; }
}
const fail = code => { throw new ReconciliationServiceError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const checkJob = id => { if (typeof id !== 'string' || !JOB.test(id)) fail('INVALID_JOB_ID'); return id; };
const checkBundle = id => { if (typeof id !== 'string' || !SHA.test(id)) fail('INVALID_BUNDLE_ID'); return id; };
const now = () => new Date().toISOString();

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) ||
      (process.getuid && s.uid !== process.getuid())) fail('PRIVATE_DIRECTORY_REQUIRED');
}
async function syncDirectory(path) { const f = await open(path, constants.O_RDONLY); try { await f.sync(); } finally { await f.close(); } }
async function privateBytes(path, maximum = 1024 * 1024) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (!s.isFile() || s.size > maximum || (s.mode & 0o077)) fail('INVALID_PRIVATE_FILE');
    const b = await f.readFile();
    if (b.length > maximum) fail('INVALID_PRIVATE_FILE');
    return b;
  } finally { await f.close(); }
}
async function readJson(path, maximum) { return JSON.parse(await privateBytes(path, maximum)); }
async function atomic(path, bytes, { createOnly = false } = {}) {
  const temp = join(dirname(path), '.write-' + randomUUID());
  let file;
  try {
    file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    if (createOnly) await link(temp, path); else await rename(temp, path);
    await syncDirectory(dirname(path));
  } finally {
    if (file) await file.close().catch(() => {});
    await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
}
async function immutableJson(path, value) {
  try { await atomic(path, json(value), { createOnly: true }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}
async function copyInput(source, destination, maximum) {
  const input = await open(resolve(source), constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('INPUT_LIMIT_EXCEEDED');
    output = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead; if (size > maximum) fail('INPUT_LIMIT_EXCEEDED');
      const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await output.writeFile(chunk);
    }
    const after = await input.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        BigInt(size) !== before.size) fail('INPUT_CHANGED_DURING_IMPORT');
    await output.sync();
    return { sha256: hash.digest('hex'), bytes: size };
  } finally { await input.close(); if (output) await output.close(); }
}

// Listing validates retained metadata and its content identity; verified opening
// below also reads every pinned file. This keeps draft browsing independent of
// complete CSV sizes while preserving the distinction for operator callers.
async function bundleManifestAt(root, bundleId, limits) {
  checkBundle(bundleId);
  let manifest;
  try { manifest = await readJson(join(root, 'bundles', bundleId, 'bundle.json'), 32768); }
  catch (error) { if (error instanceof SyntaxError) fail('BUNDLE_CHANGED'); throw error; }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schema !== 'erp-reconciliation.bundle.v1' || manifest.bundleId !== bundleId ||
      typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) fail('BUNDLE_CHANGED');
  const pins = {};
  for (const kind of ['source', 'target', 'spec', 'engine']) {
    const pin = manifest[kind];
    const maximum = kind === 'spec' ? 256 * 1024 : kind === 'engine' ? 512 * 1024 : limits.maxInputBytes;
    if (!pin || typeof pin !== 'object' || Array.isArray(pin) || typeof pin.sha256 !== 'string' ||
        !SHA.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || pin.bytes > maximum) fail('BUNDLE_CHANGED');
    pins[kind] = { sha256: pin.sha256, bytes: pin.bytes };
  }
  if (sha(json(pins)) !== bundleId) fail('BUNDLE_CHANGED');
  return { schema: manifest.schema, bundleId, ...pins, createdAt: manifest.createdAt };
}

async function bundleAt(root, bundleId, limits) {
  checkBundle(bundleId);
  const dir = join(root, 'bundles', bundleId);
  const bundle = await bundleManifestAt(root, bundleId, limits);
  const pins = {};
  for (const [kind, name] of [['source', 'source.csv'], ['target', 'target.csv'], ['spec', 'spec.json'], ['engine', 'engine.mjs']]) {
    const maximum = kind === 'spec' ? 256 * 1024 : kind === 'engine' ? 512 * 1024 : limits.maxInputBytes;
    const b = await privateBytes(join(dir, name), maximum);
    pins[kind] = { sha256: sha(b), bytes: b.length };
    if (pins[kind].sha256 !== bundle[kind]?.sha256 || pins[kind].bytes !== bundle[kind]?.bytes) fail('BUNDLE_CHANGED');
  }
  if (sha(json(pins)) !== bundleId) fail('BUNDLE_CHANGED');
  return bundle;
}
async function queueLease(root) {
  const deadline = Date.now() + 10000;
  for (;;) {
    try { return await acquireStateLease(join(root, 'runtime', 'queue')); }
    catch (error) {
      if (error.message !== 'FLEET_STATE_ALREADY_OWNED') throw error;
      if (Date.now() >= deadline) fail('QUEUE_BUSY');
      await delay(10);
    }
  }
}
function publicJob(request, state, reused) {
  return { schema: 'erp-reconciliation.job.v1', jobId: request.jobId, bundleId: request.bundleId,
    state: state?.state ?? 'QUEUED', createdAt: request.createdAt, updatedAt: state?.updatedAt ?? request.createdAt,
    ...(reused === undefined ? {} : { reused }), ...(state?.result ? { result: state.result } : {}),
    ...(state?.error ? { error: state.error } : {}) };
}
async function jobRecords(root, jobId) {
  const dir = join(root, 'jobs', checkJob(jobId));
  const request = await readJson(join(dir, 'request.json'));
  if (request.schema !== 'erp-reconciliation.request.v1' || request.jobId !== jobId) fail('JOB_CHANGED');
  const state = await exists(join(dir, 'state.json')) ? await readJson(join(dir, 'state.json')) : null;
  return { dir, request, state };
}

export async function openReconciliationService(options = {}) {
  if (typeof options.directory !== 'string' || !options.directory) fail('DIRECTORY_REQUIRED');
  const root = resolve(options.directory);
  await privateDirectory(root);
  for (const d of ['bundles', 'jobs', 'runtime']) await privateDirectory(join(root, d));
  await privateDirectory(join(root, 'runtime', 'queue'));
  const supplied = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = options[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value <= 0 || (key === 'maxHeapMiB' && value < 64)) fail('INVALID_LIMIT');
    supplied[key] = value;
  }
  const initialization = await queueLease(root);
  let configuration;
  try {
    const initialized = await exists(join(root, 'service.json'));
    if (!await exists(join(root, 'hmac.key'))) {
      // An established service must retain its original HMAC identity. A missing
      // key is an operator restore, never permission to silently replace it.
      if (initialized) fail('HMAC_KEY_MISSING');
      await atomic(join(root, 'hmac.key'), Buffer.from(randomBytes(32).toString('hex')), { createOnly: true });
    }
    const secret = await privateBytes(join(root, 'hmac.key'), 256);
    if (!/^[a-f0-9]{64}$/.test(secret.toString())) fail('INVALID_HMAC_KEY');
    if (!initialized) await immutableJson(join(root, 'service.json'), {
      schema: 'erp-reconciliation.service.v1', ...supplied, hmacKeySha256: sha(secret),
    });
    if (!initialized) await syncDirectory(dirname(root));
    configuration = await readJson(join(root, 'service.json'));
    if (configuration.hmacKeySha256 !== sha(secret)) fail('HMAC_KEY_CHANGED');
  } finally { await initialization.close(); }
  if (configuration.schema !== 'erp-reconciliation.service.v1') fail('INVALID_SERVICE_CONFIGURATION');
  for (const [key] of Object.entries(defaults)) {
    if (!Number.isSafeInteger(configuration[key]) || configuration[key] <= 0 ||
        (key === 'maxHeapMiB' && configuration[key] < 64)) fail('INVALID_SERVICE_CONFIGURATION');
    if (options[key] !== undefined && configuration[key] !== options[key]) fail('SERVICE_CONFIGURATION_MISMATCH');
  }

  async function launch() {
    const child = spawn(process.execPath, [join(here, 'job-worker.mjs'), '--directory', root], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: 'ignore', detached: false,
    });
    await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); });
    child.unref();
  }
  async function observeJob(jobId) {
    const { request, state } = await jobRecords(root, jobId);
    if (state?.state !== 'RUNNING') return publicJob(request, state);
    let lease;
    try { lease = await acquireStateLease(join(root, 'runtime')); }
    catch (e) {
      if (e.message === 'FLEET_STATE_ALREADY_OWNED') return publicJob(request, state);
      throw e;
    }
    try {
      // Completion may happen after the first read; retain the lease while
      // re-reading so a completed result is never relabeled as interrupted.
      const latest = await jobRecords(root, jobId);
      return publicJob(latest.request, latest.state?.state === 'RUNNING'
        ? { ...latest.state, state: 'INTERRUPTED', error: { code: 'WORKER_INTERRUPTED' } }
        : latest.state);
    } finally { await lease.close(); }
  }
  async function getJob(jobId) {
    const admission = await queueLease(root);
    try { return await observeJob(jobId); }
    finally { await admission.close(); }
  }
  async function stageBundleFromPaths({ source, target, spec } = {}, expectedPins = {}) {
    if (![source, target, spec].every(x => typeof x === 'string' && x.length)) fail('INPUT_PATH_REQUIRED');
    if (resolve(source) === resolve(target)) fail('DISTINCT_EXPORTS_REQUIRED');
    const temp = join(root, 'bundles', '.stage-' + randomUUID());
    await privateDirectory(temp);
    try {
      const pins = {
        source: await copyInput(source, join(temp, 'source.csv'), configuration.maxInputBytes),
        target: await copyInput(target, join(temp, 'target.csv'), configuration.maxInputBytes),
        spec: await copyInput(spec, join(temp, 'spec.json'), 256 * 1024),
        engine: await copyInput(join(here, '..', 'reconcile.mjs'), join(temp, 'engine.mjs'), 512 * 1024),
      };
      for (const [kind, expected] of Object.entries(expectedPins)) {
        if (pins[kind].sha256 !== expected.sha256 || pins[kind].bytes !== expected.bytes) fail('BUNDLE_CHANGED');
      }
      const bundleId = sha(json(pins));
      const bundle = { schema: 'erp-reconciliation.bundle.v1', bundleId, ...pins, createdAt: now() };
      await atomic(join(temp, 'bundle.json'), json(bundle), { createOnly: true });
      await syncDirectory(temp);
      try { await rename(temp, join(root, 'bundles', bundleId)); await syncDirectory(join(root, 'bundles')); }
      catch (e) { if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e; }
      return await bundleAt(root, bundleId, configuration);
    } finally {
      // Only this call's private temporary staging files are removed.
      for (const n of ['source.csv', 'target.csv', 'spec.json', 'engine.mjs', 'bundle.json']) await unlink(join(temp, n)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      const { rmdir } = await import('node:fs/promises');
      await rmdir(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
  }
  async function stageBundle(paths = {}) { return stageBundleFromPaths(paths); }
  async function getBundle(bundleId) {
    const bundle = await bundleAt(root, bundleId, configuration);
    const bytes = await privateBytes(join(root, 'bundles', bundleId, 'spec.json'), 256 * 1024);
    if (sha(bytes) !== bundle.spec.sha256 || bytes.length !== bundle.spec.bytes) fail('BUNDLE_CHANGED');
    let spec;
    try { spec = JSON.parse(bytes.toString('utf8')); }
    catch { fail('SPEC_INVALID'); }
    return { bundle, spec };
  }
  async function listBundles({ limit = 100, after = '' } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || typeof after !== 'string' ||
        (after !== '' && !SHA.test(after))) fail('INVALID_PAGE');
    const ids = (await readdir(join(root, 'bundles'))).filter(id => SHA.test(id) && id > after).sort();
    const selected = ids.slice(0, limit), bundles = [];
    for (const id of selected) bundles.push(await bundleManifestAt(root, id, configuration));
    return { bundles, nextCursor: ids.length > limit ? selected.at(-1) : null };
  }
  async function reviseBundle({ bundleId, source, target, spec } = {}) {
    const original = await bundleAt(root, bundleId, configuration);
    const directory = join(root, 'bundles', bundleId);
    const paths = {}, expectedPins = {};
    for (const [kind, replacement, name] of [
      ['source', source, 'source.csv'], ['target', target, 'target.csv'], ['spec', spec, 'spec.json'],
    ]) {
      paths[kind] = replacement === undefined ? join(directory, name) : replacement;
      if (replacement === undefined) expectedPins[kind] = original[kind];
    }
    // Staging snapshots the current engine, while omitted input/spec files must
    // still copy byte-for-byte from the fully verified original bundle.
    return stageBundleFromPaths(paths, expectedPins);
  }
  async function execute({ jobId, bundleId } = {}) {
    checkJob(jobId); checkBundle(bundleId);
    const bundle = await bundleAt(root, bundleId, configuration);
    const admission = await queueLease(root);
    try {
      const dir = join(root, 'jobs', jobId); await privateDirectory(dir);
      const created = await immutableJson(join(dir, 'request.json'), { schema: 'erp-reconciliation.request.v1',
        jobId, bundleId, createdAt: now(), engineSha256: bundle.engine.sha256 });
      await syncDirectory(join(root, 'jobs'));
      const { request } = await jobRecords(root, jobId);
      if (request.bundleId !== bundleId) fail('JOB_INPUT_CONFLICT');
      let output = await observeJob(jobId);
      if (output.state === 'QUEUED') { await launch(); output = await observeJob(jobId); }
      return { ...output, reused: !created };
    } finally { await admission.close(); }
  }
  async function listJobs({ limit = 100, after = '' } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || typeof after !== 'string') fail('INVALID_PAGE');
    const ids = (await readdir(join(root, 'jobs'))).filter(x => JOB.test(x) && x > after).sort();
    const selected = ids.slice(0, limit), jobs = [];
    for (const id of selected) {
      try { jobs.push(await getJob(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return { jobs, nextCursor: ids.length > limit ? selected.at(-1) : null };
  }
  let verifiedReport = null;
  async function reportBytes(jobId) {
    const { dir, state } = await jobRecords(root, jobId);
    if (state?.state !== 'COMPLETED' || !state.result?.report) fail('REPORT_NOT_READY');
    // A completed job never replaces its report. Retain one verified byte
    // snapshot, so successive 8 KiB transport slices do not reread/hash a full
    // report thousands of times. This buffer is never exposed to callers.
    if (verifiedReport?.jobId === jobId && verifiedReport.report.sha256 === state.result.report.sha256 &&
        verifiedReport.report.bytes === state.result.report.bytes) return verifiedReport;
    const bytes = await privateBytes(join(dir, 'report.json'), configuration.maxReportBytes);
    if (sha(bytes) !== state.result.report.sha256 || bytes.length !== state.result.report.bytes) fail('REPORT_CHANGED');
    verifiedReport = { jobId, bytes, report: state.result.report };
    return verifiedReport;
  }
  async function exportReport({ jobId, destination } = {}) {
    if (typeof destination !== 'string' || !destination) fail('DESTINATION_REQUIRED');
    const { bytes, report } = await reportBytes(jobId);
    const path = resolve(destination);
    await atomic(path, bytes, { createOnly: true });
    return { jobId, ...report, destination: path };
  }
  async function readReportChunk({ jobId, reportSha256, offset = 0, length = 8192 } = {}) {
    if (!SHA.test(reportSha256 ?? '') || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > 8192) fail('INVALID_REPORT_RANGE');
    const { bytes, report } = await reportBytes(jobId);
    if (report.sha256 !== reportSha256) fail('REPORT_HASH_CONFLICT');
    if (offset > bytes.length) fail('INVALID_REPORT_RANGE');
    const chunk = bytes.subarray(offset, Math.min(offset + length, bytes.length));
    const next = offset + chunk.length;
    return { jobId, reportSha256, offset, bytes: chunk.length, totalBytes: bytes.length,
      nextOffset: next, done: next === bytes.length,
      encoding: 'base64', data: chunk.toString('base64') };
  }
  async function exportReplay({ jobId, destination } = {}) {
    if (typeof destination !== 'string' || !destination) fail('DESTINATION_REQUIRED');
    const { dir, request, state } = await jobRecords(root, jobId);
    if (state?.state !== 'COMPLETED' || !state.result?.report) fail('REPORT_NOT_READY');
    const bundle = await bundleAt(root, request.bundleId, configuration);
    if (request.engineSha256 !== bundle.engine.sha256) fail('ENGINE_CHANGED');
    const { bytes: deliveredReport, report } = await reportBytes(jobId);
    if (report.sha256 !== state.result.report.sha256) fail('REPORT_CHANGED');
    const secret = await privateBytes(join(root, 'hmac.key'), 256);
    if (!/^[a-f0-9]{64}$/.test(secret.toString()) || sha(secret) !== configuration.hmacKeySha256) fail('HMAC_KEY_CHANGED');
    const reviewDirectory = join(dir, 'reviews');
    const reviewNames = await exists(reviewDirectory)
      ? (await readdir(reviewDirectory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort() : [];
    const reviewsCapturedAt = now();
    const output = resolve(destination);
    // mkdir without recursive is the create-only destination reservation. An
    // existing directory fails before this operation acquires any cleanup scope.
    await mkdir(output, { mode: 0o700 });
    const files = {};
    const put = async (name, bytes) => {
      await atomic(join(output, name), bytes, { createOnly: true });
      files[name] = { sha256: sha(bytes), bytes: bytes.length };
    };
    try {
      await privateDirectory(output);
      await syncDirectory(dirname(output));
      const bundleDirectory = join(root, 'bundles', request.bundleId);
      for (const [kind, name, maximum] of [
        ['source', 'source.csv', configuration.maxInputBytes],
        ['target', 'target.csv', configuration.maxInputBytes],
        ['spec', 'spec.json', 256 * 1024], ['engine', 'engine.mjs', 512 * 1024],
      ]) {
        const bytes = await privateBytes(join(bundleDirectory, name), maximum);
        if (bytes.length !== bundle[kind].bytes || sha(bytes) !== bundle[kind].sha256) fail('BUNDLE_CHANGED');
        await put(name, bytes);
      }
      const originalBundle = await privateBytes(join(bundleDirectory, 'bundle.json'));
      if (JSON.stringify(JSON.parse(originalBundle)) !== JSON.stringify(bundle)) fail('BUNDLE_CHANGED');
      await put('bundle.json', originalBundle);
      const originalRequest = await privateBytes(join(dir, 'request.json'));
      if (JSON.stringify(JSON.parse(originalRequest)) !== JSON.stringify(request)) fail('JOB_CHANGED');
      await put('request.json', originalRequest);
      const originalState = await privateBytes(join(dir, 'state.json'));
      if (JSON.stringify(JSON.parse(originalState)) !== JSON.stringify(state)) fail('JOB_CHANGED');
      await put('state.json', originalState);
      await put('report.json', deliveredReport);
      const originalConfiguration = await privateBytes(join(root, 'service.json'));
      if (JSON.stringify(JSON.parse(originalConfiguration)) !== JSON.stringify(configuration)) fail('INVALID_SERVICE_CONFIGURATION');
      await put('service.json', originalConfiguration);
      await put('hmac.key', secret);
      await mkdir(join(output, 'reviews'), { mode: 0o700 });
      await syncDirectory(output);
      // The existing service has immutable review events, so one captured name
      // set is sufficient; later reviews belong to a subsequent export.
      for (const name of reviewNames) {
        const bytes = await privateBytes(join(reviewDirectory, name), 32768);
        const review = JSON.parse(bytes);
        if (review.schema !== 'erp-reconciliation.review.v1' || review.reviewId + '.json' !== name ||
            review.jobId !== jobId || review.reportSha256 !== report.sha256 ||
            !['accepted', 'changes_requested'].includes(review.decision)) fail('REVIEW_REPORT_CONFLICT');
        await put('reviews/' + name, bytes);
      }
      const runner = String.raw`#!/usr/bin/env node
import { constants } from 'node:fs';
import { open, readFile, lstat, mkdir, link, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const root = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
async function bytesAt(name, maximum) {
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || (before.mode & 0o077n)) fail('INVALID_PRIVATE_FILE');
    const bytes = await file.readFile();
    const after = await file.stat({ bigint: true });
    if (BigInt(bytes.length) !== before.size || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('REPLAY_FILE_CHANGED');
    return bytes;
  } finally { await file.close(); }
}
async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('node replay.mjs [--out NEW_REPORT_FILENAME.json] [--manifest-sha256 EXPORT_RECEIPT_DIGEST]\n');
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--out', '--manifest-sha256'].includes(key) || Object.hasOwn(options, key) ||
        typeof value !== 'string' || !value || value.startsWith('--')) fail('INVALID_ARGUMENT');
    options[key] = value;
  }
  const outputName = options['--out'] ?? 'replayed-report.json';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.json$/.test(outputName)) fail('INVALID_OUTPUT_FILENAME');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) fail('PRIVATE_DIRECTORY_REQUIRED');
  const manifestBytes = await bytesAt('export.json', 8 * 1024 * 1024);
  if (options['--manifest-sha256'] && hash(manifestBytes) !== options['--manifest-sha256']) fail('EXPORT_MANIFEST_CONFLICT');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'erp-reconciliation.replay-export.v1' || !manifest.files ||
      typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('INVALID_EXPORT_MANIFEST');
  const fixed = new Set(['source.csv', 'target.csv', 'spec.json', 'engine.mjs', 'bundle.json',
    'request.json', 'state.json', 'report.json', 'service.json', 'hmac.key', 'replay.mjs', 'README.txt']);
  for (const name of fixed) if (!manifest.files[name]) fail('INVALID_EXPORT_MANIFEST');
  const reviewInfo = await lstat(join(root, 'reviews'));
  if (!reviewInfo.isDirectory() || reviewInfo.isSymbolicLink() || (reviewInfo.mode & 0o077)) fail('PRIVATE_DIRECTORY_REQUIRED');
  for (const [name, pin] of Object.entries(manifest.files)) {
    if ((!fixed.has(name) && !/^reviews\/[a-f0-9-]{36}\.json$/.test(name)) || !pin ||
        !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || !/^[a-f0-9]{64}$/.test(pin.sha256)) fail('INVALID_EXPORT_MANIFEST');
    const bytes = await bytesAt(name, pin.bytes);
    if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) fail('REPLAY_FILE_CHANGED');
  }
  const request = JSON.parse(await bytesAt('request.json', 1048576));
  const bundle = JSON.parse(await bytesAt('bundle.json', 1048576));
  const state = JSON.parse(await bytesAt('state.json', 1048576));
  if (request.jobId !== manifest.jobId || request.bundleId !== manifest.bundleId ||
      bundle.bundleId !== manifest.bundleId || request.engineSha256 !== manifest.engineSha256 ||
      manifest.engineSha256 !== manifest.files['engine.mjs'].sha256 ||
      manifest.reportSha256 !== manifest.files['report.json'].sha256 || state.state !== 'COMPLETED' ||
      state.result?.report?.sha256 !== manifest.reportSha256 ||
      state.result.report.bytes !== manifest.files['report.json'].bytes) fail('INVALID_EXPORT_MANIFEST');
  for (const [kind, name] of [['source', 'source.csv'], ['target', 'target.csv'], ['spec', 'spec.json'], ['engine', 'engine.mjs']]) {
    if (bundle[kind]?.sha256 !== manifest.files[name].sha256 ||
        bundle[kind]?.bytes !== manifest.files[name].bytes) fail('INVALID_EXPORT_MANIFEST');
  }
  const config = JSON.parse(await bytesAt('service.json', 1048576));
  if (![config.maxHeapMiB, config.timeoutMs, config.maxReportBytes].every(x => Number.isSafeInteger(x) && x > 0) ||
      config.maxHeapMiB < 64) fail('INVALID_SERVICE_CONFIGURATION');
  const secretBytes = await bytesAt('hmac.key', 256), secret = secretBytes.toString();
  if (!/^[a-f0-9]{64}$/.test(secret) || hash(secretBytes) !== config.hmacKeySha256) fail('HMAC_KEY_CHANGED');
  const output = join(root, outputName);
  try { await lstat(output); fail('EEXIST'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const attempt = join(root, '.replay-' + randomUUID());
  await mkdir(attempt, { mode: 0o700 });
  let child, timer, timedOut = false;
  try {
    const temporaryReport = join(attempt, 'report.json');
    child = spawn(process.execPath, ['--max-old-space-size=' + config.maxHeapMiB,
      join(root, 'engine.mjs'), '--spec', join(root, 'spec.json'), '--source', join(root, 'source.csv'),
      '--target', join(root, 'target.csv'), '--out', temporaryReport],
      { env: { ERP_RECON_HMAC_KEY: secret }, stdio: ['ignore', 'ignore', 'inherit'] });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, config.timeoutMs);
    const exitCode = await new Promise((yes, no) => { child.once('error', no); child.once('close', code => yes(code)); });
    clearTimeout(timer); timer = null;
    if (timedOut) fail('JOB_TIMEOUT');
    if (![0, 2].includes(exitCode)) fail('ENGINE_FAILED');
    const outputInfo = await lstat(temporaryReport);
    if (outputInfo.size > config.maxReportBytes) fail('REPORT_LIMIT_EXCEEDED');
    const replayedBytes = await readFile(temporaryReport), replayed = JSON.parse(replayedBytes);
    const delivered = JSON.parse(await bytesAt('report.json', config.maxReportBytes));
    const comparisonStatus = replayed.status;
    if (exitCode !== (comparisonStatus === 'PASS' ? 0 : comparisonStatus === 'FAIL' ? 2 : -1)) fail('REPORT_INVALID');
    delete replayed.generated_at; delete delivered.generated_at;
    const matchesDeliveredReport = isDeepStrictEqual(replayed, delivered);
    await link(temporaryReport, output);
    const saved = await open(output, constants.O_RDONLY); try { await saved.sync(); } finally { await saved.close(); }
    const directory = await open(root, constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
    process.stdout.write(JSON.stringify({ schema: 'erp-reconciliation.replay.v1', jobId: manifest.jobId,
      bundleId: manifest.bundleId, originalReportSha256: manifest.reportSha256, replayedReportSha256: hash(replayedBytes),
      bytes: replayedBytes.length, status: comparisonStatus, matchesDeliveredReport, report: outputName }, null, 2) + '\n');
    process.exitCode = matchesDeliveredReport ? exitCode : 1;
  } finally { if (timer) clearTimeout(timer); await rm(attempt, { recursive: true, force: true }); }
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ schema: 'erp-reconciliation.replay-error.v1',
    error: { code: typeof error.code === 'string' ? error.code : 'REPLAY_FAILED' } }) + '\n');
  process.exitCode = 1;
});
`;
      await put('replay.mjs', Buffer.from(runner));
      await put('README.txt', Buffer.from('PRIVATE ERP RECONCILIATION REPLAY\n\n'
        + 'This package contains the exact customer inputs, mapping, retained engine, original report, review events and HMAC key.\n'
        + 'Keep the directory private (0700), files private (0600), and transfer it only through the agreed private customer delivery route.\n\n'
        + 'Node.js 22+: node replay.mjs\n'
        + 'Optional: node replay.mjs --out replay-002.json --manifest-sha256 DIGEST_FROM_EXPORT_RECEIPT\n'
        + 'The runner verifies every inventoried file, keeps the delivered report intact, and creates a new replayed report.\n'
        + 'The generated timestamp changes. matchesDeliveredReport compares all other parsed report content.\n'
        + 'Exit 0: matching PASS. Exit 2: matching discrepancy report (FAIL). Exit 1: execution error or replay difference.\n'));
      const manifest = { schema: 'erp-reconciliation.replay-export.v1', jobId, bundleId: request.bundleId,
        reportSha256: report.sha256, engineSha256: request.engineSha256, createdAt: now(),
        reviewsCapturedAt, reviewCount: reviewNames.length, files, command: 'node replay.mjs' };
      const manifestBytes = json(manifest);
      if (manifestBytes.length > 8 * 1024 * 1024) fail('REPLAY_MANIFEST_LIMIT_EXCEEDED');
      await atomic(join(output, 'export.json'), manifestBytes, { createOnly: true });
      return { schema: manifest.schema, jobId, bundleId: request.bundleId, reportSha256: report.sha256,
        directory: output, manifest: { sha256: sha(manifestBytes), bytes: manifestBytes.length },
        files: Object.keys(files).length + 1, reviewCount: reviewNames.length, command: manifest.command };
    } catch (error) {
      const { rm } = await import('node:fs/promises');
      await rm(output, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function review({ jobId, reportSha256, reviewer, decision, note = '' } = {}) {
    if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 200 ||
        !['accepted', 'changes_requested'].includes(decision) || typeof note !== 'string' || note.length > 4000)
      fail('INVALID_REVIEW');
    const { report } = await reportBytes(jobId);
    if (report.sha256 !== reportSha256) fail('REVIEW_REPORT_CONFLICT');
    const review = { schema: 'erp-reconciliation.review.v1', reviewId: randomUUID(), jobId, reportSha256,
      reviewer: reviewer.trim(), decision, note, createdAt: now() };
    const dir = join(root, 'jobs', jobId, 'reviews'); await privateDirectory(dir);
    await atomic(join(dir, review.reviewId + '.json'), json(review), { createOnly: true });
    await syncDirectory(join(root, 'jobs', jobId));
    return review;
  }
  async function getReviews(jobId) {
    await jobRecords(root, jobId);
    const dir = join(root, 'jobs', jobId, 'reviews');
    if (!await exists(dir)) return [];
    const output = [];
    for (const name of (await readdir(dir)).sort()) if (/^[a-f0-9-]{36}\.json$/.test(name)) output.push(await readJson(join(dir, name)));
    return output.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async function cancel(jobId) {
    const { dir } = await jobRecords(root, jobId);
    const current = await getJob(jobId);
    if (!['QUEUED', 'RUNNING'].includes(current.state)) return current;
    await immutableJson(join(dir, 'cancel.json'), { requestedAt: now() });
    if (current.state === 'QUEUED') await launch();
    return { ...await getJob(jobId), cancellationRequested: true };
  }
  async function recover(jobId) {
    const admission = await queueLease(root);
    let lease;
    try {
      lease = await acquireStateLease(join(root, 'runtime'));
      const { dir, request, state } = await jobRecords(root, jobId);
      if (state?.state === 'COMPLETED') return publicJob(request, state, true);
      if (!state || !['RUNNING', 'INTERRUPTED', 'FAILED', 'CANCELLED'].includes(state.state)) fail('RECOVERY_NOT_REQUIRED');
      const bundle = await bundleAt(root, request.bundleId, configuration);
      if (request.engineSha256 !== bundle.engine.sha256) fail('ENGINE_CHANGED');
      if (state.attemptId && state.state !== 'CANCELLED') {
        const reportPath = join(dir, 'attempts', state.attemptId, 'engine-report.json');
        try {
          const execution = await readJson(join(dir, 'attempts', state.attemptId, 'execution.json'));
          await completeReport(root, dir, request, bundle, state, reportPath, configuration, execution);
          return await observeJob(jobId);
        } catch (e) {
          if (!['ENOENT', 'REPORT_INVALID', 'REPORT_LIMIT_EXCEEDED'].includes(e.code)) throw e;
        }
      }
      await unlink(join(dir, 'cancel.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
      await atomic(join(dir, 'state.json'), json({ state: 'QUEUED', updatedAt: now(), recoveredFrom: state.state }));
    } finally { if (lease) await lease.close(); await admission.close(); }
    await launch(); return await getJob(jobId);
  }
  return Object.freeze({ configuration: Object.freeze(configuration), stageBundle, getBundle, listBundles, reviseBundle, execute, getJob, listJobs,
    exportReport, readReportChunk, exportReplay, review, getReviews, cancel, recover });
}

async function completeReport(root, dir, request, bundle, state, reportPath, limits, execution) {
  let bytes, report;
  try {
    bytes = await privateBytes(reportPath, limits.maxReportBytes);
    report = JSON.parse(bytes);
  } catch (e) {
    if (e.code === 'ENOENT') throw e;
    fail(e.code === 'INVALID_PRIVATE_FILE' ? 'REPORT_LIMIT_EXCEEDED' : 'REPORT_INVALID');
  }
  if (report.schema !== 'ERP-CONVERSION-RECON-V1' || !['PASS', 'FAIL'].includes(report.status) ||
      !execution || execution.signal || execution.reason ||
      execution.code !== (report.status === 'PASS' ? 0 : 2) ||
      report.source?.sha256 !== bundle.source.sha256 || report.target?.sha256 !== bundle.target.sha256 ||
      report.spec_sha256 !== bundle.spec.sha256 || !report.counts || !Array.isArray(report.discrepancies) ||
      !Array.isArray(report.totals) || !Array.isArray(report.group_discrepancies) ||
      ![report.source.rows, report.target.rows, report.source.unique_keys, report.target.unique_keys,
        ...Object.values(report.counts)].every(x => Number.isSafeInteger(x) && x >= 0)) fail('REPORT_INVALID');
  // Final report bytes are separate from the attempt path an old engine may still own.
  await atomic(join(dir, 'report.json'), bytes);
  const result = { status: report.status, counts: report.counts, source: report.source, target: report.target,
    spec_sha256: report.spec_sha256, report: { id: 'report', sha256: sha(bytes), bytes: bytes.length } };
  const { error: previousError, ...completedState } = state;
  await atomic(join(dir, 'state.json'), json({ ...completedState, state: 'COMPLETED', updatedAt: now(), result }));
  return publicJob(request, { state: 'COMPLETED', updatedAt: now(), result });
}

export async function runReconciliationWorker(directory) {
  const root = resolve(directory);
  await openReconciliationService({ directory: root });
  let lease;
  const startup = await queueLease(root);
  try {
    try { lease = await acquireStateLease(join(root, 'runtime')); }
    catch (e) { if (e.message === 'FLEET_STATE_ALREADY_OWNED') return; throw e; }
  } finally { await startup.close(); }
  const limits = await readJson(join(root, 'service.json'));
  let stopping = false, activeChild = null;
  const stop = () => { stopping = true; activeChild?.kill('SIGTERM'); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    for (;;) {
      if (stopping) break;
      lease.assertHeld();
      let records = null;
      const admission = await queueLease(root);
      try {
        const candidates = [];
        for (const id of (await readdir(join(root, 'jobs'))).filter(x => JOB.test(x))) {
          let record;
          try { record = await jobRecords(root, id); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
          if (record.state?.state === 'RUNNING') {
            await atomic(join(record.dir, 'state.json'), json({ ...record.state, state: 'INTERRUPTED',
              updatedAt: now(), error: { code: 'WORKER_INTERRUPTED' } }));
          } else if (!record.state || record.state.state === 'QUEUED') candidates.push(record);
        }
        candidates.sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt) || a.request.jobId.localeCompare(b.request.jobId));
        records = candidates[0] ?? null;
        if (!records) {
          // Enqueue and final worker release share this short native lease. A new
          // request either enters this worker's next scan or launches after release.
          await lease.close(); lease = null;
        }
      } finally { await admission.close(); }
      if (!records) break;
      const { dir, request } = records;
      const jobId = request.jobId;
      if (stopping) break;
      if (await exists(join(dir, 'cancel.json'))) {
        await atomic(join(dir, 'state.json'), json({ state: 'CANCELLED', updatedAt: now() })); continue;
      }
      const attemptId = randomUUID();
      const attempt = join(dir, 'attempts', attemptId); await privateDirectory(attempt);
      await syncDirectory(join(dir, 'attempts')); await syncDirectory(dir);
      const state = { state: 'RUNNING', attemptId, updatedAt: now() };
      await atomic(join(dir, 'state.json'), json(state));
      let reason = null;
      try {
        const bundle = await bundleAt(root, request.bundleId, limits);
        if (request.engineSha256 !== bundle.engine.sha256) fail('ENGINE_CHANGED');
        const bundleDir = join(root, 'bundles', request.bundleId);
        const secret = (await privateBytes(join(root, 'hmac.key'), 256)).toString();
        if (!/^[a-f0-9]{64}$/.test(secret) || sha(Buffer.from(secret)) !== limits.hmacKeySha256) fail('INVALID_HMAC_KEY');
        const reportPath = join(attempt, 'engine-report.json');
        const child = spawn(process.execPath, ['--max-old-space-size=' + limits.maxHeapMiB,
          join(bundleDir, 'engine.mjs'), '--spec', join(bundleDir, 'spec.json'),
          '--source', join(bundleDir, 'source.csv'), '--target', join(bundleDir, 'target.csv'),
          '--out', reportPath], { env: { ERP_RECON_HMAC_KEY: secret }, stdio: ['ignore', 'ignore', 'pipe'] });
        activeChild = child;
        let diagnostic = Buffer.alloc(0);
        child.stderr.on('data', chunk => { if (diagnostic.length < 16384) diagnostic = Buffer.concat([diagnostic, chunk]).subarray(0, 16384); });
        const deadline = setTimeout(() => { reason = 'JOB_TIMEOUT'; child.kill('SIGKILL'); }, limits.timeoutMs);
        let observing = false;
        const monitor = setInterval(async () => {
          if (observing) return; observing = true;
          try {
            if (await exists(join(dir, 'cancel.json'))) { reason = 'JOB_CANCELLED'; child.kill('SIGKILL'); }
            if (await exists(reportPath) && (await lstat(reportPath)).size > limits.maxReportBytes) {
              reason = 'REPORT_LIMIT_EXCEEDED'; child.kill('SIGKILL');
            }
          } catch { reason = 'JOB_OBSERVATION_FAILED'; child.kill('SIGKILL'); }
          finally { observing = false; }
        }, 100);
        let exit;
        try { exit = await new Promise((yes, no) => { child.once('error', no); child.once('close', (code, signal) => yes({ code, signal })); }); }
        finally { clearTimeout(deadline); clearInterval(monitor); activeChild = null; }
        if (diagnostic.length) await atomic(join(attempt, 'diagnostic.txt'), diagnostic);
        await atomic(join(attempt, 'execution.json'), json({ ...exit, reason, completedAt: now() }));
        if (stopping) fail('WORKER_INTERRUPTED');
        if (reason) fail(reason);
        if (![0, 2].includes(exit.code)) fail('ENGINE_FAILED');
        await bundleAt(root, request.bundleId, limits);
        await completeReport(root, dir, request, bundle, state, reportPath, limits, { ...exit, reason });
      } catch (e) {
        const code = e instanceof ReconciliationServiceError ? e.code : 'EXECUTION_FAILED';
        await atomic(join(dir, 'state.json'), json({ ...state,
          state: code === 'WORKER_INTERRUPTED' ? 'INTERRUPTED' : code === 'JOB_CANCELLED' ? 'CANCELLED' : 'FAILED',
          updatedAt: now(), error: { code } }));
      }
    }
  } finally {
    process.off('SIGTERM', stop); process.off('SIGINT', stop); if (lease) await lease.close();
  }
}
