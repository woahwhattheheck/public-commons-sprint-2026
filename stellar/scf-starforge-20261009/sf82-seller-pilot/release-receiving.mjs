// MIT. Bind retained SF82 releases to the original SF101 receiving workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir, realpath, link, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { inspectRelease, readReleaseState } from './releases.mjs';
import { openReceivingWorkspace } from '../sf101-merchant-account-readiness/workspace/controller.mjs';
import { createReceivingWorkspaceHandler } from '../sf101-merchant-account-readiness/workspace/server.mjs';

const MIB = 1024 * 1024;
const ID = /^[a-z0-9]{8,13}-[a-f0-9]{16}$/;
const SHA = /^[a-f0-9]{64}$/;
const BINDING = 'stellar-forge.release-receiving-binding.v1';
const CONTEXT = 'stellar-forge.release-receiving-context.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
}
function fault(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function need(condition, code, message, status) { if (!condition) throw fault(code, message, status); }
function keys(value, allowed) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'RECEIVING_REQUEST_INVALID', 'Unknown receiving request field.');
}
function nativeId(value) { const digest = hash(value); return digest.slice(0, 12) + '-' + digest.slice(12, 28); }
function checkedId(value) {
  need(typeof value === 'string' && ID.test(value), 'RECEIVING_ID_INVALID', 'Use the saved receiving profile or review identity.');
  return value;
}
async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    (!process.getuid || stat.uid === process.getuid()), 'RECEIVING_PRIVATE_DIRECTORY_REQUIRED', 'Keep receiving bindings in the owned private workspace.');
}
async function bytes(path, maximum = MIB, privateMode = true) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    need(stat.isFile() && stat.size <= maximum && (!privateMode || !(stat.mode & 0o077)) &&
      (!process.getuid || stat.uid === process.getuid()), 'RECEIVING_SOURCE_FILE_INVALID', 'Expected an owned regular source file within its size limit.');
    const result = await file.readFile();
    need(result.length <= maximum, 'RECEIVING_SOURCE_TOO_LARGE', 'The source file exceeds its size limit.');
    return result;
  } finally { await file.close(); }
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fault('RECEIVING_JSON_INVALID', 'The retained receiving file must contain UTF-8 JSON.'); }
}
async function createJson(path, value) {
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); await file.close();
    await link(temporary, path);
    const parent = await open(dirname(path), constants.O_RDONLY);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await file.close().catch(() => {}); await rm(temporary, { force: true }); }
}

/** Host-selected JSON; browser requests never select source or workspace paths. */
export async function readReleaseReceivingConfig(path) {
  const config = parse(await bytes(resolve(path), 3 * MIB));
  keys(config, ['directory', 'assetMap', 'rpcEndpoints', 'proxyEnv', 'timeoutMs', 'feeOperations']);
  return config;
}

/** No report, job or payment engine is duplicated here. Bindings reference the original controller records. */
export function createReleaseReceivingConsole(root, {
  directory = resolve(root) + '.receiving', assetMap, rpcEndpoints, proxyEnv,
  timeoutMs = 12000, feeOperations = 0, environment = process.env, sdk,
} = {}) {
  root = resolve(root);
  need(typeof directory === 'string' && directory === resolve(directory), 'RECEIVING_DIRECTORY_INVALID', 'Choose an absolute normalized receiving workspace.');
  need(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000 &&
    Number.isSafeInteger(feeOperations) && feeOperations >= 0 && feeOperations <= 100000,
  'RECEIVING_OPTIONS_INVALID', 'Use a 1000–30000 ms timeout and 0–100000 fee operations.');
  need(proxyEnv === undefined || typeof proxyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(proxyEnv),
    'RECEIVING_PROXY_INVALID', 'Use the configured proxy environment variable name.');
  const options = { timeoutMs, feeOperations, ...(proxyEnv ? { proxyEnv } : {}) };
  const sourceFile = (name, value) => {
    if (value === undefined) return undefined;
    const data = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    need(data.length <= MIB, 'RECEIVING_CONFIGURATION_TOO_LARGE', 'Receiving asset and RPC maps are limited to 1 MiB each.');
    return { name, bytes: data.length, sha256: hash(data), base64: data.toString('base64') };
  };
  const assets = sourceFile('release-assets.json', assetMap), rpc = sourceFile('release-rpc.json', rpcEndpoints);
  let workspace = null, mounted = null, retiring = false, closing = null, operations = Promise.resolve(), canonicalRoot;
  const mutate = fn => {
    if (retiring) return Promise.reject(fault('RECEIVING_CONSOLE_CLOSING', 'The release console is closing.', 503));
    const next = operations.then(fn); operations = next.catch(() => {}); return next;
  };
  const requireWorkspace = () => {
    need(workspace, 'RECEIVING_WORKSPACE_CLOSED', 'Open receiving in this console, or close its current browser/MCP owner before reopening.', 409);
    return workspace;
  };
  async function storeIdentity() { canonicalRoot ??= await realpath(root); return hash(canonicalRoot); }
  async function source(releaseId, expectedGeneration) {
    need(typeof releaseId === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(releaseId),
      'RECEIVING_RELEASE_REQUIRED', 'Choose a prepared release.');
    const state = await readReleaseState(root);
    if (expectedGeneration !== undefined) {
      need(Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0,
        'RECEIVING_GENERATION_REQUIRED', 'Use the current selection generation.');
      need(state.generation === expectedGeneration, 'RELEASE_CONFLICT', 'The release selection changed. Refresh this release review.', 409);
    }
    const release = await inspectRelease(root, releaseId);
    const seller = await bytes(join(root, 'releases', releaseId, 'seller-service.json'), MIB, false);
    need(hash(seller) === release.source.serviceConfigSha256, 'RECEIVING_RELEASE_SOURCE_CHANGED', 'The retained seller configuration changed. Restore or stage its original release.', 409);
    return { state, release, seller };
  }
  function actionGeneration(value) {
    need(Number.isSafeInteger(value) && value >= 0, 'RECEIVING_GENERATION_REQUIRED', 'Refresh and use the current selection generation.');
  }
  function bindingPath(releaseId, bindingId) {
    need(typeof releaseId === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(releaseId),
      'RECEIVING_RELEASE_REQUIRED', 'Choose a prepared release.');
    return join(directory, 'release-bindings', releaseId, checkedId(bindingId) + '.json');
  }
  async function binding(releaseId, bindingId) {
    const record = parse(await bytes(bindingPath(releaseId, bindingId), 16384));
    need(object(record), 'RECEIVING_BINDING_CHANGED', 'Expected the saved release binding.', 409);
    const { bindingSha256, ...content } = record, { id, createdAt, ...identity } = content;
    need(record.schema === BINDING && id === bindingId && record.releaseId === releaseId &&
      record.storeSha256 === await storeIdentity() && hash(stable(content)) === bindingSha256 &&
      nativeId(stable(identity)) === id && Number.isFinite(Date.parse(createdAt)) &&
      ['storeSha256', 'releaseDigest', 'configurationSha256', 'profileRequestDigest', 'planDigest']
        .every(key => typeof record[key] === 'string' && SHA.test(record[key])) &&
      ID.test(record.profileId) && Number.isSafeInteger(record.preparedGeneration) && record.preparedGeneration >= 0 &&
      Number.isSafeInteger(record.configurationBytes) && record.configurationBytes > 0 && record.configurationBytes <= MIB,
    'RECEIVING_BINDING_CHANGED', 'The retained release-to-receiving binding changed.', 409);
    return record;
  }
  async function bound(current, bindingId) {
    const record = await binding(current.release.id, bindingId), native = requireWorkspace();
    const profile = await native.getProfile(record.profileId), seller = profile.files.find(file => file.name === 'seller.json');
    need(record.releaseDigest === current.release.digest && record.configurationSha256 === hash(current.seller) &&
      record.configurationBytes === current.seller.length && profile.configurationSha256 === record.configurationSha256 &&
      seller?.sha256 === record.configurationSha256 && seller.bytes === record.configurationBytes &&
      profile.planDigest === record.planDigest && profile.requestDigest === record.profileRequestDigest,
    'RECEIVING_RELEASE_MISMATCH', 'This receiving profile belongs to another exact seller configuration or release.', 409);
    return { ...record, sourceCurrent: true, selectionCurrent: record.preparedGeneration === current.state.generation };
  }
  async function saveBinding(current, profile) {
    const seller = profile.files.find(file => file.name === 'seller.json');
    need(profile.configurationSha256 === hash(current.seller) && seller?.sha256 === hash(current.seller) &&
      seller.bytes === current.seller.length, 'RECEIVING_RELEASE_MISMATCH', 'Choose a receiving review of this exact retained seller configuration.', 409);
    const content = { schema: BINDING, storeSha256: await storeIdentity(), releaseId: current.release.id,
      releaseDigest: current.release.digest, configurationSha256: hash(current.seller), configurationBytes: current.seller.length,
      preparedGeneration: current.state.generation, profileId: profile.id, profileRequestDigest: profile.requestDigest,
      planDigest: profile.planDigest };
    const bindingId = nativeId(stable(content)), path = bindingPath(current.release.id, bindingId);
    await privateDirectory(join(directory, 'release-bindings'));
    await privateDirectory(join(directory, 'release-bindings', current.release.id));
    try { return await binding(current.release.id, bindingId); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const record = { ...content, id: bindingId, createdAt: new Date().toISOString() };
    record.bindingSha256 = hash(stable(record));
    try { await createJson(path, record); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return binding(current.release.id, bindingId);
  }
  async function bindings(releaseId, after) {
    if (after !== undefined) checkedId(after);
    let entries;
    try { entries = await readdir(join(directory, 'release-bindings', releaseId), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { rows: [], nextCursor: null }; throw error; }
    const rows = [];
    for (const entry of entries) {
      const name = entry.name.replace(/\.json$/, '');
      if (entry.isFile() && entry.name.endsWith('.json') && ID.test(name)) rows.push(await binding(releaseId, name));
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const start = after === undefined ? 0 : rows.findIndex(row => row.id === after) + 1;
    need(after === undefined || start > 0, 'RECEIVING_CURSOR_CHANGED', 'Refresh the receiving profile list.');
    const page = rows.slice(start, start + 20);
    return { rows: page, nextCursor: start + page.length < rows.length ? page.at(-1).id : null };
  }
  async function reviewFor(selected, reviewId) {
    const result = await requireWorkspace().getReview(checkedId(reviewId));
    need(result.record.profileId === selected.profileId && result.record.planDigest === selected.planDigest,
      'RECEIVING_REVIEW_MISMATCH', 'Choose a review from this retained release profile.', 409);
    return result;
  }
  async function status({ releaseId, bindingId, reviewId, bindingAfter, reviewAfter, offset = 0 } = {}) {
    const native = workspace;
    const result = { schema: 'stellar-forge.release-receiving-status.v1', directory,
      state: retiring ? 'CLOSING' : native ? 'OPEN' : 'CLOSED',
      configuration: { timeoutMs, feeOperations, proxyEnv: proxyEnv ?? null, assetMapConfigured: Boolean(assets), rpcMapConfigured: Boolean(rpc) } };
    if (!releaseId) return { ...result, workspace: native ? await native.status() : null };
    const current = await source(releaseId);
    Object.assign(result, { release: current.release, generation: current.state.generation, selectedRelease: current.state.active,
      workspace: native ? await native.status() : null, bindings: { rows: [], nextCursor: null } });
    if (!native) return result;
    result.bindings = await bindings(releaseId, bindingAfter);
    bindingId ??= result.bindings.rows.find(row => row.preparedGeneration === current.state.generation)?.id ?? result.bindings.rows[0]?.id;
    if (!bindingId) return result;
    result.binding = await bound(current, bindingId);
    result.reviews = await native.listReviews({ profileId: result.binding.profileId, ...(reviewAfter ? { after: reviewAfter } : {}), limit: 20 });
    reviewId ??= result.reviews.rows[0]?.id;
    if (!reviewId) return result;
    const checked = await reviewFor(result.binding, reviewId);
    result.review = { record: checked.record };
    if (checked.report) {
      need(Number.isSafeInteger(offset) && offset >= 0 && offset <= checked.report.options.length,
        'RECEIVING_OPTION_OFFSET_INVALID', 'Refresh the receiving option page.');
      const { options: rows, ...report } = checked.report, page = rows.slice(offset, offset + 20);
      result.review.report = { ...report, options: page, optionOffset: offset, optionsTotal: rows.length,
        nextOptionOffset: offset + page.length < rows.length ? offset + page.length : null };
      const ids = new Set(page.map(row => row.optionId));
      result.review.actions = checked.actions.filter(row => ids.has(row.optionId));
    }
    return result;
  }
  async function closeWorkspace() {
    const selected = workspace;
    mounted?.close(); mounted = null;
    if (selected) {
      try { await selected.close(); }
      finally { if (workspace === selected) workspace = null; }
    }
    return { state: 'CLOSED', directory };
  }
  return {
    status,
    open: () => mutate(async () => {
      if (!workspace) workspace = await openReceivingWorkspace({ directory, environment, sdk });
      return status();
    }),
    closeWorkspace: () => mutate(closeWorkspace),
    prepare: input => mutate(async () => {
      keys(input, ['releaseId', 'expectedGeneration']); actionGeneration(input.expectedGeneration);
      const native = requireWorkspace(), current = await source(input.releaseId, input.expectedGeneration);
      const seller = { name: 'seller-service.json', bytes: current.seller.length, sha256: hash(current.seller), base64: current.seller.toString('base64') };
      const label = 'Release ' + current.release.id + ' · selection ' + current.state.generation;
      const request = { label, seller, ...(assets ? { assets } : {}), ...(rpc ? { rpc } : {}), options };
      const profileId = nativeId(stable({ store: await storeIdentity(), release: current.release.digest,
        generation: current.state.generation, request }));
      const profile = await native.createProfile(request, { id: profileId });
      return { binding: await saveBinding(current, profile) };
    }),
    available: async ({ releaseId, after } = {}) => {
      const current = await source(releaseId), native = requireWorkspace();
      const page = await native.listReviews({ ...(after ? { after } : {}), limit: 20 }), profiles = new Map(), rows = [];
      for (const record of page.rows) {
        if (!profiles.has(record.profileId)) profiles.set(record.profileId, await native.getProfile(record.profileId));
        const profile = profiles.get(record.profileId), seller = profile.files.find(file => file.name === 'seller.json');
        rows.push({ ...record, compatible: profile.configurationSha256 === hash(current.seller) &&
          seller?.sha256 === hash(current.seller) && seller.bytes === current.seller.length });
      }
      return { rows, nextCursor: page.nextCursor };
    },
    attach: input => mutate(async () => {
      keys(input, ['releaseId', 'expectedGeneration', 'reviewId']); actionGeneration(input.expectedGeneration);
      const native = requireWorkspace(), current = await source(input.releaseId, input.expectedGeneration);
      const review = await native.getReview(checkedId(input.reviewId));
      need(review.record.state === 'COMPLETED', 'RECEIVING_COMPLETED_REVIEW_REQUIRED', 'Choose a completed retained review.');
      const profile = await native.getProfile(review.record.profileId);
      return { binding: await saveBinding(current, profile), reviewId: review.record.id };
    }),
    start: input => mutate(async () => {
      keys(input, ['releaseId', 'expectedGeneration', 'bindingId', 'requestId', 'mode', 'captureReviewId', 'previousReviewId']);
      actionGeneration(input.expectedGeneration);
      const native = requireWorkspace(), id = checkedId(input.requestId);
      let saved;
      try { saved = await native.getReview(id); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // An acknowledged or uncertain saved start is a read of its original
      // intent even if a later release selection has advanced.
      const current = await source(input.releaseId, saved ? undefined : input.expectedGeneration);
      const selected = await bound(current, input.bindingId);
      const review = await native.startReview({ id, profileId: selected.profileId,
        mode: input.mode, ...(input.captureReviewId ? { captureReviewId: input.captureReviewId } : {}),
        ...(input.previousReviewId ? { previousReviewId: input.previousReviewId } : {}) });
      return { binding: selected, review };
    }),
    cancel: input => mutate(async () => {
      keys(input, ['releaseId', 'bindingId', 'reviewId']);
      const selected = await binding(input.releaseId, input.bindingId);
      await reviewFor(selected, input.reviewId);
      return requireWorkspace().cancelReview(input.reviewId);
    }),
    export: async ({ releaseId, bindingId, reviewId }) => {
      const current = await source(releaseId), selected = await bound(current, bindingId);
      await reviewFor(selected, reviewId);
      return requireWorkspace().exportReview(reviewId);
    },
    selectionContext: async input => {
      keys(input, ['releaseId', 'expectedGeneration', 'bindingId', 'reviewId']); actionGeneration(input.expectedGeneration);
      const current = await source(input.releaseId, input.expectedGeneration), selected = await bound(current, input.bindingId);
      const result = await reviewFor(selected, input.reviewId);
      need(result.record.state === 'COMPLETED', 'RECEIVING_COMPLETED_REVIEW_REQUIRED', 'Choose a completed receiving review to include with this operation.', 409);
      return { schema: CONTEXT, releaseId: current.release.id, releaseDigest: current.release.digest,
        configurationSha256: selected.configurationSha256, preparedGeneration: selected.preparedGeneration,
        expectedGeneration: current.state.generation, bindingId: selected.id, profileId: selected.profileId,
        reviewId: result.record.id, planDigest: selected.planDigest, manifestSha256: result.record.manifestSha256,
        completedAt: result.report.completedAt, mode: result.report.mode, status: result.report.status, summary: result.report.summary };
    },
    handle: async (req, res, options) => {
      const native = requireWorkspace();
      mounted ??= createReceivingWorkspaceHandler({ workspace: native, ...options });
      return mounted(req, res);
    },
    close() {
      if (closing) return closing;
      retiring = true;
      closing = operations.then(closeWorkspace); operations = closing.catch(() => {});
      return closing;
    },
  };
}
