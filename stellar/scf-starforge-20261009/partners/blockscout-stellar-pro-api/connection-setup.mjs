// MIT. Review, prepare, retain and receive a complete original Blockscout connection package.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat, readdir, mkdir, rename, unlink, rmdir } from 'node:fs/promises';
import { dirname, basename, join, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareProduct, validatePlan, planSha, plain, error } from './product.mjs';
import { connectionForPlan, connectionIdentity, connectionSummary } from './connection.mjs';
import { preparePackage, readPackage, readJSON, PACKAGE_FILES } from './cli.mjs';
import { privateDirectory, syncDirectory } from './accounting.mjs';

export const REVIEW_SCHEMA = 'stellar-forge.blockscout-connection-review.v1';
export const BUNDLE_SCHEMA = 'stellar-forge.blockscout-connection-package.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const fail = (code, status = 400) => { throw error(code, status); };
const exactFields = (value, keys) => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('BLOCKSCOUT_CONNECTION_CHANGE_INVALID');
};
const absolute = value => {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.length > 3000)
    fail('BLOCKSCOUT_ABSOLUTE_OUTPUT_REQUIRED');
  return value;
};
// The first connection release rendered this placeholder for an implicit PRO
// source. It remains a read-compatibility representation of already exported
// reviews; new reviews use null until an operator supplies an actual review time.
function connectionChanges(source, plan, historicalLegacyTime = false) {
  const beforeConnection = connectionSummary(source);
  if (historicalLegacyTime && source.connection === undefined)
    beforeConnection.reviewedAt = '2026-10-11T00:00:00.000Z';
  const rows = [];
  for (const [name, before, after] of [
    ['Provider connection', beforeConnection, connectionSummary(plan)],
    ['Provider account', source.accountAlias, plan.accountAlias],
    ['Credential environment', source.apiKeyEnv, plan.apiKeyEnv],
    ['Selected data chains and prices', source.chains, plan.chains],
    ['Local usage and retention limits', source.limits, plan.limits]
  ]) if (!same(before, after)) rows.push({ name, before, after });
  return rows;
}
export function reviewConnection(inputPlan, changes, expectedPlanSha256) {
  const source = validatePlan(inputPlan), sourcePlanSha256 = planSha(source);
  if (!digest(expectedPlanSha256) || sourcePlanSha256 !== expectedPlanSha256)
    fail('BLOCKSCOUT_CONNECTION_SOURCE_CHANGED', 409);
  exactFields(changes, ['connection', 'accountAlias', 'apiKeyEnv', 'limits']);
  if (!plain(changes.connection)) fail('BLOCKSCOUT_CONNECTION_REQUIRED');
  if (changes.limits !== undefined && !plain(changes.limits)) fail('BLOCKSCOUT_CONNECTION_CHANGE_INVALID');
  const selectedChains = changes.connection.mode === 'instance'
    ? source.chains.filter(row => row.chainId === changes.connection.chainId) : source.chains;
  const candidate = { ...source, accountAlias: changes.accountAlias ?? source.accountAlias,
    apiKeyEnv: changes.apiKeyEnv ?? source.apiKeyEnv, chains: selectedChains,
    limits: { ...source.limits, ...changes.limits }, connection: changes.connection };
  const prepared = prepareProduct(candidate), plan = prepared.plan;
  const sourceIdentity = connectionIdentity(source), targetIdentity = connectionIdentity(plan);
  const newAccount = !same(sourceIdentity, targetIdentity);
  if (newAccount && plan.accountAlias === source.accountAlias)
    fail('BLOCKSCOUT_NEW_CONNECTION_ACCOUNT_REQUIRED', 409);
  const selected = { schema: REVIEW_SCHEMA, sourcePlanSha256, plan };
  const reviewSha256 = hash(JSON.stringify(selected));
  const rows = connectionChanges(source, plan);
  return { ...selected, sourcePlan: source, reviewSha256, planSha256: prepared.planSha256,
    connection: connectionSummary(plan), changes: rows,
    requiresNewMerchantState: newAccount || source.accountAlias !== plan.accountAlias,
    routes: prepared.imported.offers.map(row => ({ method: row.method, path: row.path, offer: row.seller })) };
}
function checkReview(value) {
  if (!plain(value) || value.schema !== REVIEW_SCHEMA || !digest(value.sourcePlanSha256) ||
      !digest(value.reviewSha256) || !digest(value.planSha256)) fail('BLOCKSCOUT_CONNECTION_REVIEW_INVALID');
  const prepared = prepareProduct(value.plan);
  if (prepared.planSha256 !== value.planSha256 || !same(prepared.plan, value.plan) ||
      hash(JSON.stringify({ schema: REVIEW_SCHEMA, sourcePlanSha256: value.sourcePlanSha256, plan: value.plan })) !== value.reviewSha256)
    fail('BLOCKSCOUT_CONNECTION_REVIEW_CHANGED', 409);
  const source = validatePlan(value.sourcePlan);
  if (planSha(source) !== value.sourcePlanSha256 || !same(source, value.sourcePlan))
    fail('BLOCKSCOUT_CONNECTION_REVIEW_SOURCE_CHANGED', 409);
  const reconstructed = reviewConnection(source, { connection: prepared.plan.connection,
    accountAlias: prepared.plan.accountAlias, apiKeyEnv: prepared.plan.apiKeyEnv,
    limits: prepared.plan.limits }, value.sourcePlanSha256);
  for (const key of ['reviewSha256', 'planSha256', 'connection', 'requiresNewMerchantState', 'routes'])
    if (!same(value[key], reconstructed[key])) fail('BLOCKSCOUT_CONNECTION_REVIEW_CHANGED', 409);
  if (!same(value.changes, reconstructed.changes) &&
      (source.connection !== undefined || !same(value.changes, connectionChanges(source, prepared.plan, true))))
    fail('BLOCKSCOUT_CONNECTION_REVIEW_CHANGED', 409);
  return { ...prepared, review: reconstructed };
}
async function privateRead(path, maximum = 2097152) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > maximum)
      fail('BLOCKSCOUT_CONNECTION_FILE_INVALID', 503);
    const bytes = await file.readFile();
    if (bytes.length !== info.size || bytes.length > maximum) fail('BLOCKSCOUT_CONNECTION_FILE_CHANGED', 409);
    return bytes;
  } finally { await file.close(); }
}
async function optionalJSON(path) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateRead(path))); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function atomicJSON(path, value) {
  const pending = path + '.writing';
  const bytes = Buffer.from(json(value));
  const file = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077) fail('BLOCKSCOUT_CONNECTION_FILE_INVALID', 503);
    await file.truncate(0); await file.writeFile(bytes); await file.sync();
  } finally { await file.close(); }
  await rename(pending, path); await syncDirectory(dirname(path));
}
async function withLock(directory, id, fn) {
  await privateDirectory(directory, false);
  const path = join(directory, '.connection-' + id + '.lock');
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077) fail('BLOCKSCOUT_CONNECTION_LOCK_INVALID', 503);
    const held = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', file.fd], timeout: 10000 });
    if (held.error || held.status !== 0)
      fail(held.status === 73 ? 'BLOCKSCOUT_CONNECTION_PREPARATION_ACTIVE' : 'BLOCKSCOUT_CONNECTION_LOCK_UNAVAILABLE', 409);
    const current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino)
      fail('BLOCKSCOUT_CONNECTION_LOCK_CHANGED', 409);
    return await fn();
  } finally { await file.close(); }
}
async function clearOwnedStage(stage) {
  let info;
  try { info = await lstat(stage); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    fail('BLOCKSCOUT_CONNECTION_STAGE_CHANGED', 409);
  const allowed = new Set([...PACKAGE_FILES, 'package.json', 'connection-package.json', 'connection-package.json.writing']);
  const entries = await readdir(stage);
  for (const name of entries) {
    const stat = await lstat(join(stage, name));
    if (!allowed.has(name) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077)
      fail('BLOCKSCOUT_CONNECTION_STAGE_CHANGED', 409);
  }
  for (const name of entries) await unlink(join(stage, name));
  await rmdir(stage);
}
async function captureBundle(review, directory) {
  await readPackage(directory, { expectedPlanSha256: review.planSha256 });
  const manifest = await readJSON(join(directory, 'package.json'));
  const files = {};
  for (const name of PACKAGE_FILES) {
    const bytes = await privateRead(join(directory, name), 1048576);
    if (hash(bytes) !== manifest.files[name].sha256 || bytes.length !== manifest.files[name].bytes)
      fail('BLOCKSCOUT_CONNECTION_PACKAGE_CHANGED', 409);
    files[name] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return { schema: BUNDLE_SCHEMA, createdAt: new Date().toISOString(), review, manifest, files };
}
export function inspectConnectionBundle(value) {
  if (!plain(value) || value.schema !== BUNDLE_SCHEMA || !plain(value.manifest) || !plain(value.files))
    fail('BLOCKSCOUT_CONNECTION_BUNDLE_INVALID');
  const prepared = checkReview(value.review);
  const manifest = value.manifest;
  if (manifest.schema !== 'stellar-forge.blockscout-package.v1' || manifest.planSha256 !== prepared.planSha256 ||
      !plain(manifest.files) || Object.keys(manifest.files).length !== PACKAGE_FILES.length ||
      Object.keys(value.files).length !== PACKAGE_FILES.length)
    fail('BLOCKSCOUT_CONNECTION_BUNDLE_INVALID');
  let total = 0;
  for (const name of PACKAGE_FILES) {
    const content = value.files[name], expected = manifest.files[name];
    if (typeof content !== 'string' || !plain(expected) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0 ||
        !digest(expected.sha256)) fail('BLOCKSCOUT_CONNECTION_BUNDLE_INVALID');
    const bytes = Buffer.from(content, 'utf8'); total += bytes.length;
    if (total > 1048576 || expected.bytes !== bytes.length || expected.sha256 !== hash(bytes))
      fail('BLOCKSCOUT_CONNECTION_BUNDLE_CHANGED', 409);
  }
  let plan;
  try { plan = JSON.parse(value.files['plan.json']); } catch { fail('BLOCKSCOUT_CONNECTION_BUNDLE_INVALID'); }
  if (!same(plan, prepared.plan)) fail('BLOCKSCOUT_CONNECTION_BUNDLE_PLAN_CHANGED', 409);
  return { reviewSha256: value.review.reviewSha256, sourcePlanSha256: value.review.sourcePlanSha256,
    planSha256: prepared.planSha256, connection: connectionSummary(prepared.plan),
    plan: prepared.plan, review: prepared.review, files: PACKAGE_FILES.length, bytes: total };
}
/** Publish a fresh package atomically; reopen the same completed operation after a lost return. */
export async function prepareConnectionPackage(review, directory) {
  checkReview(review); absolute(directory);
  const parent = dirname(directory), id = hash(directory), marker = directory + '.connection-review.json';
  const stage = join(parent, '.' + basename(directory) + '.connection-pending');
  return withLock(parent, id, async () => {
    const ownership = { schema: REVIEW_SCHEMA, reviewSha256: review.reviewSha256,
      sourcePlanSha256: review.sourcePlanSha256, planSha256: review.planSha256, directory };
    const retained = await optionalJSON(marker);
    if (retained && !same(retained, ownership)) fail('BLOCKSCOUT_CONNECTION_DESTINATION_CHANGED', 409);
    let exists = false;
    try { await lstat(directory); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (exists) {
      if (!retained) fail('BLOCKSCOUT_CONNECTION_DESTINATION_EXISTS', 409);
      const bytes = await privateRead(join(directory, 'connection-package.json'));
      const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (inspectConnectionBundle(bundle).reviewSha256 !== review.reviewSha256)
        fail('BLOCKSCOUT_CONNECTION_PACKAGE_CHANGED', 409);
      const current = await captureBundle(review, directory);
      if (!same(current.manifest, bundle.manifest) || !same(current.files, bundle.files))
        fail('BLOCKSCOUT_CONNECTION_PACKAGE_CHANGED', 409);
      return { status: 'PREPARED_RECOVERED', directory, reviewSha256: review.reviewSha256,
        planSha256: review.planSha256, connection: connectionSummary(review.plan), bundle };
    }
    if (!retained) {
      try { await lstat(stage); fail('BLOCKSCOUT_CONNECTION_STAGE_CHANGED', 409); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      await atomicJSON(marker, ownership);
    }
    await clearOwnedStage(stage);
    await preparePackage(review.plan, stage, { instructionsDirectory: directory });
    await readPackage(stage, { expectedPlanSha256: review.planSha256 });
    const bundle = await captureBundle(review, stage);
    await atomicJSON(join(stage, 'connection-package.json'), bundle);
    await rename(stage, directory); await syncDirectory(parent);
    return { status: 'PREPARED', directory, reviewSha256: review.reviewSha256,
      planSha256: review.planSha256, connection: connectionSummary(review.plan), bundle };
  });
}
export async function receiveConnectionBundle(value, directory, expectedReviewSha256) {
  const selected = inspectConnectionBundle(value);
  if (!digest(expectedReviewSha256) || selected.reviewSha256 !== expectedReviewSha256)
    fail('BLOCKSCOUT_CONNECTION_REVIEW_CHANGED', 409);
  // Rebuild the local trusted entry against the receiving installation.
  // Exported handlers are retained for review and are never evaluated here.
  const result = await prepareConnectionPackage(value.review, directory);
  return { ...result, status: result.status === 'PREPARED' ? 'RECEIVED' : 'RECEIVED_RECOVERED',
    sourceFiles: selected.files, sourceBytes: selected.bytes };
}
export async function retainConnectionPackage(review, exportsDirectory) {
  await privateDirectory(exportsDirectory);
  const directory = join(exportsDirectory, review.reviewSha256);
  const result = await prepareConnectionPackage(review, directory);
  const bytes = await privateRead(join(directory, 'connection-package.json'));
  return { status: result.status, id: review.reviewSha256, directory,
    planSha256: review.planSha256, connection: result.connection,
    bundle: { bytes: bytes.length, sha256: hash(bytes), download: '/api/connection/packages/' + review.reviewSha256 } };
}
export async function readRetainedConnection(exportsDirectory, id) {
  if (!digest(id)) fail('BLOCKSCOUT_CONNECTION_ID_INVALID');
  await privateDirectory(exportsDirectory, false);
  const directory = join(exportsDirectory, id);
  await privateDirectory(directory, false);
  const bytes = await privateRead(join(directory, 'connection-package.json'));
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('BLOCKSCOUT_CONNECTION_BUNDLE_INVALID'); }
  if (inspectConnectionBundle(value).reviewSha256 !== id) fail('BLOCKSCOUT_CONNECTION_BUNDLE_CHANGED', 409);
  return { bytes, sha256: hash(bytes), value };
}
export async function listRetainedConnections(exportsDirectory, { after = '', limit = 20 } = {}) {
  if (after !== '' && !digest(after) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    fail('BLOCKSCOUT_CONNECTION_PAGE_INVALID');
  await privateDirectory(exportsDirectory);
  const names = (await readdir(exportsDirectory)).filter(name => /^[a-f0-9]{64}$/.test(name))
    .sort().filter(id => id > after);
  const ids = names.slice(0, limit), items = [];
  for (const id of ids) {
    const row = await readRetainedConnection(exportsDirectory, id);
    const reviewed = row.value.review;
    items.push({ id, createdAt: row.value.createdAt, planSha256: reviewed.planSha256,
      connection: connectionSummary(reviewed.plan), bytes: row.bytes.length, sha256: row.sha256 });
  }
  return { items, nextAfter: names.length > limit ? ids.at(-1) : null };
}
