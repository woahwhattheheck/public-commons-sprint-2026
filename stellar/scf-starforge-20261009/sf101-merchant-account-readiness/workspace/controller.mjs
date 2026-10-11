// MIT. Retained merchant receiving work over the original SF101 evaluator.
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { sha256 } from '../readiness.mjs';
import { receivingActions } from '../merchant.mjs';
import { createReadTransport } from '../native-reader.mjs';
import { inspectMerchantReceiving, readMerchantReceivingPlan, compareMerchantReadiness } from '../receiving-session.mjs';
import { createReadinessFetch, readMerchantBundle, writeMerchantReview } from '../merchant-cli.mjs';

const MIB = 1024 * 1024;
const ID = /^[a-z0-9]{8,13}-[a-f0-9]{16}$/;
const PROFILE_FILES = ['seller.json', 'input-assets.json', 'input-rpc.json'];
const BUNDLE_FILES = ['review.json', 'review.html', 'options.csv', 'plan.json', 'asset-map.json', 'capture.json', 'manifest.json'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const workspaceFault = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const workspaceErrorCode = error => /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? error?.message ?? '')
  ? error.code ?? error.message : 'RECEIVING_WORKSPACE_FAILED';
const need = (condition, code, status) => { if (!condition) throw workspaceFault(code, status); };
const id = () => Date.now().toString(36) + '-' + randomBytes(8).toString('hex');
const checkId = value => { need(typeof value === 'string' && ID.test(value), 'INVALID_WORKSPACE_ID'); return value; };
const json = bytes => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw workspaceFault('INVALID_INPUT_JSON'); } };
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function keys(value, allowed) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'INVALID_WORKSPACE_REQUEST');
}
async function privateDirectory(path, create = false) {
  if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077), 'PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  if (process.getuid) need(info.uid === process.getuid(), 'WORKSPACE_OWNER_MISMATCH');
}
async function privateBytes(path, max = MIB) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && !(info.mode & 0o077) && info.size <= max, 'PRIVATE_WORKSPACE_FILE_REQUIRED');
    const bytes = await handle.readFile(); need(bytes.length <= max, 'WORKSPACE_FILE_TOO_LARGE'); return bytes;
  } finally { await handle.close(); }
}
async function writeNew(path, bytes) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function replaceJson(directory, name, value) {
  const temporary = join(directory, '.' + id() + '.tmp');
  try { await writeNew(temporary, encoded(value)); await rename(temporary, join(directory, name)); await syncDirectory(directory); }
  finally { await rm(temporary, { force: true }); }
}
function fileBytes(file) {
  keys(file, ['name', 'base64', 'sha256', 'bytes']);
  need(typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 180 &&
    typeof file.base64 === 'string' && file.base64.length <= Math.ceil(MIB / 3) * 4, 'CONFIGURATION_FILE_REQUIRED');
  const bytes = Buffer.from(file.base64, 'base64');
  need(bytes.length > 0 && bytes.length <= MIB && bytes.toString('base64') === file.base64, 'CONFIGURATION_ENCODING_INVALID');
  if (file.sha256 !== undefined) need(sha256(bytes) === file.sha256 && bytes.length === file.bytes, 'CONFIGURATION_DIGEST_MISMATCH');
  json(bytes); return bytes;
}
function normalizedLabel(value) {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= 120, 'PROFILE_LABEL_REQUIRED');
  return value.trim();
}
function normalizedOptions(value = {}) {
  keys(value, ['origin', 'proxyEnv', 'timeoutMs', 'feeOperations']);
  const result = { timeoutMs: value.timeoutMs ?? 12000, feeOperations: value.feeOperations ?? 0 };
  need(Number.isInteger(result.timeoutMs) && result.timeoutMs >= 1000 && result.timeoutMs <= 30000, 'INVALID_TIMEOUT');
    need(Number.isSafeInteger(result.feeOperations) && result.feeOperations >= 0 && result.feeOperations <= 100000, 'INVALID_FEE_OPERATIONS');
  if (value.origin) { need(typeof value.origin === 'string' && value.origin.length <= 2048, 'INVALID_PUBLIC_ORIGIN'); result.origin = value.origin; }
  if (value.proxyEnv) { need(typeof value.proxyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.proxyEnv), 'INVALID_PROXY_ENVIRONMENT'); result.proxyEnv = value.proxyEnv; }
  return result;
}

export async function openReceivingWorkspace({ directory, environment = process.env, sdk } = {}) {
  need(typeof directory === 'string' && directory === resolve(directory), 'ABSOLUTE_NORMALIZED_WORKSPACE_REQUIRED');
  await privateDirectory(directory, true);
  need(await realpath(directory) === directory, 'CANONICAL_WORKSPACE_DIRECTORY_REQUIRED');
  const lease = await acquireStateLease(directory), profilesRoot = join(directory, 'profiles'), reviewsRoot = join(directory, 'reviews');
  let stopping = false, closing, pumpPromise, active = null, storageError = null;
  let mutations = Promise.resolve();
  const mutate = task => { const pending = mutations.then(task); mutations = pending.catch(() => {}); return pending; };
  const queue = [];
  const admit = () => { lease.assertHeld(); need(!stopping && !storageError, 'WORKSPACE_NOT_ACCEPTING', 503); };
  const profilePath = value => join(profilesRoot, checkId(value));
  const reviewPath = value => join(reviewsRoot, checkId(value));
  const state = async value => { const path = reviewPath(value); await privateDirectory(path); const record = json(await privateBytes(join(path, 'state.json')));
    need(record.schema === 'stellar-forge.receiving-workspace-review.v1' && record.id === value, 'REVIEW_RECORD_INVALID'); return record; };
  const setState = async record => { lease.assertHeld(); await replaceJson(reviewPath(record.id), 'state.json', record); return record; };

  async function profile(value) {
    const path = profilePath(value); await privateDirectory(path);
    const record = json(await privateBytes(join(path, 'profile.json')));
    need(record.schema === 'stellar-forge.receiving-workspace-profile.v1' && record.id === value && Array.isArray(record.files), 'PROFILE_RECORD_INVALID');
    need(record.files.length >= 1 && record.files.length <= 3 && new Set(record.files.map(file => file.name)).size === record.files.length, 'PROFILE_FILES_INVALID');
    const inputs = {};
    for (const file of record.files) {
      need(PROFILE_FILES.includes(file.name), 'PROFILE_FILE_INVALID');
      const bytes = await privateBytes(join(path, file.name));
      need(bytes.length === file.bytes && sha256(bytes) === file.sha256, 'PROFILE_DIGEST_MISMATCH'); inputs[file.name] = bytes;
    }
    need(inputs['seller.json'], 'SELLER_CONFIGURATION_REQUIRED');
    return { record, path, inputs };
  }
  async function createProfile(input, operation = {}, importRequestDigest) {
    admit(); keys(input, ['label', 'seller', 'assets', 'rpc', 'options']);
    keys(operation, ['id']); if (operation.id !== undefined) checkId(operation.id);
    const label = normalizedLabel(input.label), options = normalizedOptions(input.options), sourceFiles = [['seller.json', input.seller], ['input-assets.json', input.assets], ['input-rpc.json', input.rpc]].filter(([, file]) => file !== undefined && file !== null);
    need(sourceFiles.some(([name]) => name === 'seller.json'), 'SELLER_CONFIGURATION_REQUIRED');
    const buffers = sourceFiles.map(([name, file]) => ({ name, originalName: file.name, bytes: fileBytes(file) }));
    const files = buffers.map(file => ({ name: file.name, originalName: file.originalName, bytes: file.bytes.length, sha256: sha256(file.bytes) }));
    const requestDigest = sha256(encoded({ label, options, files, ...(importRequestDigest ? { importRequestDigest } : {}) }));
    const profileId = operation.id ?? id(), destination = profilePath(profileId);
    let exists = false; try { await lstat(destination); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const existing = await profile(profileId);
      const fingerprint = existing.record.requestDigest ?? sha256(encoded({ label: existing.record.label, options: existing.record.options, files: existing.record.files }));
      need(fingerprint === requestDigest, 'PROFILE_REQUEST_CONFLICT', 409); return existing.record;
    }
    const path = join(profilesRoot, '.' + profileId + '-' + randomBytes(4).toString('hex') + '.stage');
    await mkdir(path, { mode: 0o700 }); let published = false;
    try {
      for (const file of buffers) await writeNew(join(path, file.name), file.bytes);
      let compiled;
      try { compiled = await readMerchantReceivingPlan(join(path, 'seller.json'), { origin: options.origin }); }
      catch (error) {
        if (/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '')) throw error;
        throw workspaceFault(error?.message === 'Duplicate payment network, asset and payTo option' ? 'DUPLICATE_PAYMENT_OPTION' : 'SELLER_CONFIG_INVALID');
      }
      const record = { schema: 'stellar-forge.receiving-workspace-profile.v1', id: profileId, label, createdAt: new Date().toISOString(),
        options, plan: compiled.plan, planDigest: compiled.planDigest, configurationSha256: compiled.configuration.sha256, requestDigest, files };
      await writeNew(join(path, 'profile.json'), encoded(record)); await syncDirectory(path);
      await rename(path, destination); published = true; await syncDirectory(profilesRoot); return record;
    } catch (error) { await rm(published ? destination : path, { recursive: true, force: true }); throw error; }
  }
  async function report(value) {
    const record = await state(value); need(record.state === 'COMPLETED', 'COMPLETED_REVIEW_REQUIRED', 409);
    await retainedManifest(value, record);
    const result = await readMerchantBundle(join(reviewPath(value), 'bundle'), 'review.json');
    need(result.schema === 'stellar-forge.seller-sac-readiness.v1' && result.planDigest === record.planDigest, 'REVIEW_PLAN_MISMATCH');
    return { record, report: result };
  }
  async function retainedManifest(value, record) {
    const bytes = await privateBytes(join(reviewPath(value), 'bundle', 'manifest.json'));
    if (record.state === 'COMPLETED') need(record.manifestSha256 === sha256(bytes), 'RETAINED_MANIFEST_DIGEST_MISMATCH');
    return { bytes, manifest: json(bytes) };
  }
  function captureBindings(capture, selected, manifest) {
    need(capture.configurationSha256 === selected.record.configurationSha256 && capture.planDigest === selected.record.planDigest &&
      capture.publicOrigin === selected.record.plan.publicOrigin, 'CAPTURE_SELLER_PLAN_MISMATCH', 409);
    need(JSON.stringify(capture.inputAssetMap) === JSON.stringify(selected.inputs['input-assets.json'] ? json(selected.inputs['input-assets.json']) : null),
      'CAPTURE_ASSET_MAP_MISMATCH');
    need(capture.feeOperations === selected.record.options.feeOperations, 'CAPTURE_FEE_OPERATIONS_MISMATCH');
    const sourceFiles = manifest.sources?.workspaceProfile?.files ??
      [['seller.json', manifest.sources?.seller], ['input-assets.json', manifest.sources?.assetMap], ['input-rpc.json', manifest.sources?.rpcMap]]
        .filter(([, source]) => source).map(([name, source]) => ({ ...source, name }));
    need(Array.isArray(sourceFiles) && sourceFiles.length === selected.record.files.length &&
      selected.record.files.every(file => sourceFiles.some(source => source.name === file.name && source.bytes === file.bytes && source.sha256 === file.sha256)),
      'CAPTURE_PROFILE_FILES_MISMATCH');
  }
  async function retainedCapture(value, selected) {
    const record = await state(value); need(record.state === 'COMPLETED', 'COMPLETED_REVIEW_REQUIRED', 409);
    const { manifest } = await retainedManifest(value, record);
    const capture = await readMerchantBundle(join(reviewPath(value), 'bundle'), 'capture.json');
    captureBindings(capture, selected, manifest); return capture;
  }
  async function runOne(reviewId) {
    let record = await mutate(async () => {
      const pending = await state(reviewId);
      if (stopping || pending.state !== 'QUEUED') return null;
      active = { id: reviewId, abort: new AbortController(), cancel: false };
      return setState({ ...pending, state: 'RUNNING', startedAt: new Date().toISOString() });
    });
    if (!record) return;
    try {
      const selected = await profile(record.profileId), options = selected.record.options;
      const capture = record.captureReviewId ? await retainedCapture(record.captureReviewId, selected) : undefined;
      const previous = record.previousReviewId ? (await report(record.previousReviewId)).report : null;
      const nativeFetch = capture ? undefined : await createReadinessFetch(options.proxyEnv, { environment, timeoutMs: options.timeoutMs });
      const controller = active.abort;
      const fetchImpl = nativeFetch ? (url, init = {}) => {
        controller.signal.throwIfAborted();
        return nativeFetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
      } : undefined;
      const bundle = await inspectMerchantReceiving({ configPath: join(selected.path, 'seller.json'), origin: options.origin,
        assetMap: selected.inputs['input-assets.json'] ? json(selected.inputs['input-assets.json']) : undefined,
        rpcEndpoints: capture ? capture.endpoints : selected.inputs['input-rpc.json'] ? json(selected.inputs['input-rpc.json']) : undefined,
        environment: capture ? {} : environment, timeoutMs: options.timeoutMs, feeOperations: options.feeOperations, capture, sdk, fetchImpl, liveTransport: !capture });
      if (active.cancel) throw workspaceFault('REVIEW_CANCELLED');
      if (previous) bundle.report.comparison = compareMerchantReadiness(previous, bundle.report);
      const manifest = await writeMerchantReview(join(reviewPath(reviewId), 'bundle'), bundle.report,
        { seller: bundle.report.configuration, workspaceProfile: { id: selected.record.id, files: selected.record.files } }, bundle);
      await syncDirectory(join(reviewPath(reviewId), 'bundle'));
      await syncDirectory(reviewPath(reviewId));
      record = await mutate(() => setState({ ...record, state: 'COMPLETED', completedAt: bundle.report.completedAt,
        observedMode: bundle.report.mode, summary: bundle.report.summary, status: bundle.report.status,
        readCount: bundle.report.readCount, manifestSha256: sha256(encoded(manifest)) }));
    } catch (error) {
      record = await mutate(() => setState({ ...record, state: active.cancel ? 'CANCELLED' : 'FAILED', completedAt: new Date().toISOString(), errorCode: active.cancel ? 'REVIEW_CANCELLED' : workspaceErrorCode(error) }));
    } finally { active = null; }
    return record;
  }
  function pump() {
    if (pumpPromise || stopping || storageError) return;
    pumpPromise = (async () => { while (!stopping && queue.length) await runOne(queue.shift()); })()
      .catch(error => { storageError = workspaceErrorCode(error); })
      .finally(() => { pumpPromise = null; if (!stopping && queue.length && !storageError) pump(); });
  }
  async function startReview(input) {
    admit(); keys(input, ['id', 'profileId', 'mode', 'captureReviewId', 'previousReviewId']); checkId(input.id);
    need(['live', 'replay'].includes(input.mode), 'REVIEW_MODE_REQUIRED');
    need(input.mode === 'replay' ? !!input.captureReviewId : !input.captureReviewId, 'CAPTURE_SELECTION_INVALID');
    const selected = await profile(input.profileId);
    if (input.previousReviewId) await report(input.previousReviewId);
    if (input.captureReviewId) {
      await report(input.captureReviewId);
      await retainedCapture(input.captureReviewId, selected);
    }
    const request = { profileId: selected.record.id, mode: input.mode, captureReviewId: input.captureReviewId ?? null, previousReviewId: input.previousReviewId ?? null };
    const fingerprint = sha256(encoded(request)), destination = reviewPath(input.id);
    let existingPath = false;
    try { await lstat(destination); existingPath = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existingPath) {
      const existing = await state(input.id); need(existing.requestDigest === fingerprint, 'REVIEW_REQUEST_CONFLICT', 409); return existing;
    }
    const path = join(reviewsRoot, '.' + input.id + '-' + randomBytes(4).toString('hex') + '.stage');
    await mkdir(path, { mode: 0o700 }); let published = false;
    const record = { schema: 'stellar-forge.receiving-workspace-review.v1', id: input.id, ...request, requestDigest: fingerprint,
      profileLabel: selected.record.label, planDigest: selected.record.planDigest, createdAt: new Date().toISOString(), state: 'QUEUED' };
    try { await writeNew(join(path, 'state.json'), encoded(record)); await syncDirectory(path);
      await rename(path, destination); published = true; await syncDirectory(reviewsRoot); }
    catch (error) { await rm(published ? destination : path, { recursive: true, force: true }); throw error; }
    queue.push(record.id); pump(); return record;
  }
  async function cancelReview(value) {
    admit(); const record = await state(value);
    if (record.state === 'QUEUED') {
      const index = queue.indexOf(value); if (index >= 0) queue.splice(index, 1);
      return setState({ ...record, state: 'CANCELLED', completedAt: new Date().toISOString(), errorCode: 'REVIEW_CANCELLED' });
    }
    if (record.state === 'RUNNING' && active?.id === value) {
      active.cancel = true; active.abort.abort(workspaceFault('REVIEW_CANCELLED'));
      return { ...record, cancellationRequested: true };
    }
    return record;
  }
  async function listing(root, after, limit, read, accept = () => true) {
    need(after === undefined || ID.test(after), 'INVALID_WORKSPACE_CURSOR');
    need(Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_WORKSPACE_PAGE_SIZE');
    const names = (await readdir(root, { withFileTypes: true })).filter(row => row.isDirectory() && ID.test(row.name) && (!after || row.name < after)).map(row => row.name).sort().reverse();
    const rows = []; let last;
    for (const name of names) {
      const item = await read(name); last = name;
      if (accept(item)) rows.push(item);
      if (rows.length === limit) break;
    }
    return { rows, nextCursor: last && names.at(-1) !== last ? last : null };
  }
  async function bundleFiles(value) {
    const root = join(reviewPath(value), 'bundle'); await privateDirectory(root);
    const { bytes: manifestBytes, manifest } = await retainedManifest(value, await state(value));
    need(manifest.schema === 'stellar-forge.merchant-readiness-manifest.v1' && Array.isArray(manifest.files) && manifest.files.length === 6, 'INVALID_MERCHANT_MANIFEST');
    const found = new Set(), files = [];
    for (const entry of manifest.files) {
      need(BUNDLE_FILES.includes(entry.name) && entry.name !== 'manifest.json' && !found.has(entry.name), 'INVALID_BUNDLE_MEMBER'); found.add(entry.name);
      const bytes = await privateBytes(join(root, entry.name), 80 * MIB);
      need(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, 'MANIFEST_DIGEST_MISMATCH');
      files.push({ name: entry.name, bytes: bytes.length, sha256: entry.sha256, base64: bytes.toString('base64') });
    }
    files.push({ name: 'manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes), base64: manifestBytes.toString('base64') }); return files;
  }
  async function exportReview(value) {
    const checked = await report(value), selected = await profile(checked.record.profileId);
    const result = { schema: 'stellar-forge.receiving-workspace-export.v1', exportedAt: new Date().toISOString(),
      profile: { label: selected.record.label, options: selected.record.options, files: selected.record.files.map(file => ({ ...file, base64: selected.inputs[file.name].toString('base64') })) },
      review: checked.record, bundle: await bundleFiles(value) };
    return encoded(result);
  }
  async function importReview(input, operation = {}) {
    admit(); keys(input, ['schema', 'exportedAt', 'profile', 'review', 'bundle']);
    keys(operation, ['id']); if (operation.id !== undefined) checkId(operation.id);
    need(input.schema === 'stellar-forge.receiving-workspace-export.v1' && object(input.profile) && Array.isArray(input.profile.files) && Array.isArray(input.bundle) && input.bundle.length === 7, 'INVALID_RECEIVING_EXPORT');
    need(input.profile.files.length >= 1 && input.profile.files.length <= 3 && new Set(input.profile.files.map(file => file.name)).size === input.profile.files.length, 'PROFILE_FILES_INVALID');
    const sources = {};
    for (const file of input.profile.files) {
      need(PROFILE_FILES.includes(file.name), 'PROFILE_FILE_INVALID');
      const source = { name: file.originalName ?? file.name, base64: file.base64, bytes: file.bytes, sha256: file.sha256 };
      const bytes = fileBytes(source);
      sources[file.name] = { ...source, bytes: bytes.length, sha256: sha256(bytes) };
    }
    const buffers = new Map(); let total = 0;
    for (const file of input.bundle) {
      need(object(file) && BUNDLE_FILES.includes(file.name) && !buffers.has(file.name) && typeof file.base64 === 'string', 'INVALID_BUNDLE_MEMBER');
      need(file.base64.length <= 108 * MIB, 'BUNDLE_TOO_LARGE');
      const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
      need(total <= 96 * MIB && bytes.toString('base64') === file.base64 && bytes.length === file.bytes && sha256(bytes) === file.sha256, 'EXPORT_DIGEST_MISMATCH'); buffers.set(file.name, bytes);
    }
    const manifest = json(buffers.get('manifest.json'));
    if (input.review?.manifestSha256 !== undefined)
      need(input.review.manifestSha256 === sha256(buffers.get('manifest.json')), 'RETAINED_MANIFEST_DIGEST_MISMATCH');
    need(manifest.schema === 'stellar-forge.merchant-readiness-manifest.v1' && Array.isArray(manifest.files) && manifest.files.length === 6 && new Set(manifest.files.map(file => file.name)).size === 6, 'INVALID_MERCHANT_MANIFEST');
    for (const entry of manifest.files) need(entry.name !== 'manifest.json' && buffers.has(entry.name) && buffers.get(entry.name).length === entry.bytes && sha256(buffers.get(entry.name)) === entry.sha256, 'MANIFEST_DIGEST_MISMATCH');
    const sourceReport = json(buffers.get('review.json')), capture = json(buffers.get('capture.json'));
    need(sourceReport.schema === 'stellar-forge.seller-sac-readiness.v1' && Array.isArray(sourceReport.options) && capture.schema === 'stellar-forge.sf101.merchant-capture.v1', 'INVALID_RECEIVING_REPORT');
    const label = normalizedLabel(input.profile.label);
    const requestDigest = sha256(encoded({ label, options: normalizedOptions(input.profile.options),
      files: PROFILE_FILES.filter(name => sources[name]).map(name => ({ name, originalName: sources[name].name, bytes: sources[name].bytes, sha256: sources[name].sha256 })),
      bundle: BUNDLE_FILES.map(name => ({ name, bytes: buffers.get(name).length, sha256: sha256(buffers.get(name)) })) }));
    const reviewId = operation.id ?? id(), destination = reviewPath(reviewId);
    let exists = false; try { await lstat(destination); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const existing = await state(reviewId);
      need(existing.mode === 'imported' && existing.requestDigest === requestDigest, 'IMPORT_REQUEST_CONFLICT', 409);
      await report(reviewId); return { profile: (await profile(existing.profileId)).record, review: existing };
    }
    // A retry after publishing the profile but before publishing its review reuses
    // the same private source object. Its digest also binds the exact import work.
    const importedProfileId = reviewId.split('-')[0] + '-' + sha256('receiving-import-profile:' + reviewId).slice(0, 16);
    let existingProfile = false;
    try { await lstat(profilePath(importedProfileId)); existingProfile = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const selected = await createProfile({ label, options: input.profile.options,
      seller: sources['seller.json'], assets: sources['input-assets.json'], rpc: sources['input-rpc.json'] }, { id: importedProfileId }, requestDigest);
    const path = join(reviewsRoot, '.' + reviewId + '-' + randomBytes(4).toString('hex') + '.stage');
    let owned = false, published = false;
    try {
      need(sourceReport.planDigest === selected.planDigest && capture.planDigest === selected.planDigest && manifest.planDigest === selected.planDigest &&
        sourceReport.configuration?.sha256 === selected.configurationSha256 && capture.configurationSha256 === selected.configurationSha256, 'CAPTURE_SELLER_PLAN_MISMATCH');
      captureBindings(capture, await profile(selected.id), manifest);
      createReadTransport({ capture });
      await mkdir(path, { mode: 0o700 }); owned = true; await mkdir(join(path, 'bundle'), { mode: 0o700 });
      for (const [name, bytes] of buffers) await writeNew(join(path, 'bundle', name), bytes);
      await readMerchantBundle(join(path, 'bundle'), 'review.json'); await readMerchantBundle(join(path, 'bundle'), 'capture.json');
      await syncDirectory(join(path, 'bundle'));
      const record = { schema: 'stellar-forge.receiving-workspace-review.v1', id: reviewId, profileId: selected.id, profileLabel: selected.label,
        createdAt: new Date().toISOString(), completedAt: sourceReport.completedAt, state: 'COMPLETED', mode: 'imported', requestDigest,
        planDigest: selected.planDigest, observedMode: sourceReport.mode, summary: sourceReport.summary, status: sourceReport.status,
        readCount: sourceReport.readCount, manifestSha256: sha256(buffers.get('manifest.json')), importedAt: new Date().toISOString() };
      await writeNew(join(path, 'state.json'), encoded(record)); await syncDirectory(path);
      await rename(path, destination); published = true; await syncDirectory(reviewsRoot); return { profile: selected, review: record };
    } catch (error) { if (owned) await rm(published ? destination : path, { recursive: true, force: true });
      if (!existingProfile) await rm(profilePath(selected.id), { recursive: true, force: true }); throw error; }
  }

  try {
    await privateDirectory(profilesRoot, true); await privateDirectory(reviewsRoot, true);
    // Recover an incomplete final directory from an earlier interrupted writer while
    // retaining its bytes outside the namespace used for visible profiles and reviews.
    for (const [root, filename] of [[profilesRoot, 'profile.json'], [reviewsRoot, 'state.json']]) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !ID.test(entry.name)) continue;
        try { await lstat(join(root, entry.name, filename)); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await rename(join(root, entry.name), join(root, '.' + entry.name + '-' + randomBytes(4).toString('hex') + '.interrupted'));
          await syncDirectory(root);
        }
      }
    }
    for (const entry of (await readdir(reviewsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && ID.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const record = await state(entry.name);
      if (record.state === 'QUEUED') queue.push(record.id);
      if (record.state === 'RUNNING') {
        let retained, manifestSha256;
        try { const files = await bundleFiles(record.id); manifestSha256 = files.find(file => file.name === 'manifest.json').sha256;
          retained = await readMerchantBundle(join(reviewPath(record.id), 'bundle'), 'review.json'); }
        catch {}
        await setState(retained?.planDigest === record.planDigest ? { ...record, state: 'COMPLETED', completedAt: retained.completedAt,
          observedMode: retained.mode, summary: retained.summary, status: retained.status, readCount: retained.readCount, manifestSha256, recoveredCompletion: true } :
          { ...record, state: 'INTERRUPTED', completedAt: new Date().toISOString(), errorCode: 'REVIEW_PROCESS_INTERRUPTED' });
      }
    }
  } catch (error) { await lease.close(); throw error; }
  pump();
  return {
    createProfile: (input, operation) => mutate(() => createProfile(input, operation)),
    startReview: input => mutate(() => startReview(input)),
    cancelReview: value => mutate(() => cancelReview(value)),
    importReview: (input, operation) => mutate(() => importReview(input, operation)),
    exportReview,
    async listProfiles({ after, limit = 50 } = {}) { return listing(profilesRoot, after, limit, async value => (await profile(value)).record); },
    async listReviews({ profileId, after, limit = 50 } = {}) { if (profileId) checkId(profileId); return listing(reviewsRoot, after, limit, state, record => !profileId || record.profileId === profileId); },
    async getProfile(value) { return (await profile(value)).record; },
    async getReview(value) {
      const record = await state(value);
      if (record.state !== 'COMPLETED') return { record };
      const result = await report(value);
      return { ...result, actions: result.report.options.map(row => ({ optionId: row.optionId,
        actions: (row.readiness?.reasons ?? [row.errorCode]).filter(code => receivingActions[code]).map(code => ({ code, text: receivingActions[code] })) })) };
    },
    async compare({ previousId, currentId }) { return compareMerchantReadiness((await report(previousId)).report, (await report(currentId)).report); },
    async status() { return { schema: 'stellar-forge.receiving-workspace.v1', activeReview: active?.id ?? null, queued: queue.length, stopping, storageError }; },
    close() {
      if (closing) return closing;
      stopping = true;
      closing = (async () => { const keepAlive = setInterval(() => {}, 1000);
        try { await mutations; await pumpPromise; await mutations; } finally { clearInterval(keepAlive); await lease.close(); } })();
      return closing;
    },
  };
}
