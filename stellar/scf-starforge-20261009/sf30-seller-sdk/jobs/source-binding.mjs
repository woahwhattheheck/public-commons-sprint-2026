// MIT. Restore physical execution paths while preserving original paid-job identities.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJobMerchant, canonical, digest, plain, HASH, jobError } from './config.mjs';
import { acquireJobRecoveryLeases, inspectJobRecoveryState } from './recovery-state.mjs';

export const JOB_SOURCE_BINDING_SCHEMA = 'stellar-forge.job-source-binding.v1';
const MARKER = 'source-binding.json', HISTORY = 'source-bindings', MAX_BINDING = 65536;
const fail = (code, status = 409) => { throw jobError(code, status); };
const same = (left, right) => canonical(left) === canonical(right);
const hash = value => typeof value === 'string' && HASH.test(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

function absolute(value) {
  return typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !/[\x00-\x1f\x7f]/.test(value);
}
function identity(value) {
  if (!plain(value) || value.schema !== 'stellar-forge.job-source.v1' ||
      !hash(value.configSha256) || !hash(value.applicationSha256) ||
      !absolute(value.application) || !value.application.endsWith('.mjs')) fail('JOB_ORIGINAL_SOURCE_REQUIRED', 400);
  let origin; try { origin = new URL(value.publicOrigin); } catch { fail('JOB_ORIGINAL_SOURCE_REQUIRED', 400); }
  if (origin.protocol !== 'https:' || origin.origin !== value.publicOrigin || origin.username || origin.password)
    fail('JOB_ORIGINAL_SOURCE_REQUIRED', 400);
  return value;
}
async function privateDirectory(path, create = false) {
  if (!absolute(path)) fail('JOB_PRIVATE_DIRECTORY_REQUIRED', 400);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 ||
      await realpath(path) !== path) fail('JOB_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateBytes(path, limit) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > limit)
      fail('JOB_SOURCE_BINDING_FILE_INVALID');
    const bytes = await file.readFile();
    if (bytes.length > limit) fail('JOB_SOURCE_BINDING_FILE_INVALID');
    return bytes;
  } finally { await file.close(); }
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('JOB_SOURCE_BINDING_INVALID'); }
}
function validateBinding(value) {
  if (!plain(value) || value.schema !== JOB_SOURCE_BINDING_SCHEMA ||
      !absolute(value.directory) || !absolute(value.configPath) || !absolute(value.applicationPath) ||
      !value.applicationPath.endsWith('.mjs') || !plain(value.provenance) ||
      !hash(value.provenance.bundleManifestSha256) || !hash(value.provenance.profileSha256) ||
      !hash(value.provenance.reviewSha256) || !hash(value.provenance.stateSha256) ||
      value.previousBindingSha256 !== null && !hash(value.previousBindingSha256) ||
      !instant(value.adoptedAt)) fail('JOB_SOURCE_BINDING_INVALID');
  identity(value.source);
  return value;
}
async function readBinding(directory) {
  const file = join(directory, MARKER);
  let bytes;
  try { bytes = await privateBytes(file, MAX_BINDING); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return { file, bytes, sha256: digest(bytes), value: validateBinding(parse(bytes)) };
}
async function flush(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
async function writeTemporary(directory, bytes, lease) {
  const path = join(directory, '.binding-' + randomUUID() + '.tmp');
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await lease.assertHeld();
    await file.writeFile(bytes); await file.sync();
    return path;
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  } finally { await file.close(); }
}
async function preserveBinding(directory, previous, lease) {
  const history = join(directory, HISTORY);
  await privateDirectory(history, true);
  if (!previous) return history;
  const retained = join(history, previous.sha256 + '.json');
  try {
    if (digest(await privateBytes(retained, MAX_BINDING)) !== previous.sha256)
      fail('JOB_SOURCE_BINDING_HISTORY_CHANGED');
    return history;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = await writeTemporary(history, previous.bytes, lease);
  try {
    // The same original writer leases serialize every binding publication.
    // Atomic rename also leaves no two-link history inode after a crash.
    await lease.assertHeld();
    await rename(temp, retained); await flush(history);
    if (digest(await privateBytes(retained, MAX_BINDING)) !== previous.sha256)
      fail('JOB_SOURCE_BINDING_HISTORY_CHANGED');
  } finally { await unlink(temp).catch(() => {}); }
  return history;
}
function physicalMatches(source, original) {
  return source.identity.configSha256 === original.configSha256 &&
    source.identity.applicationSha256 === original.applicationSha256 &&
    source.identity.publicOrigin === original.publicOrigin;
}

/** Select an executable without changing the historical source attached to paid rows. */
export async function readJobMerchantSource({ configPath, directory } = {}) {
  if (!absolute(directory) || typeof configPath !== 'string') fail('JOB_SOURCE_PATHS_REQUIRED', 400);
  const binding = await readBinding(directory);
  if (!binding) return { ...await readJobMerchant(configPath), sourceBinding: null };
  const selected = binding.value;
  if (selected.directory !== directory || resolve(configPath) !== selected.configPath ||
      await realpath(configPath) !== selected.configPath ||
      await realpath(selected.applicationPath) !== selected.applicationPath)
    fail('JOB_SOURCE_BINDING_LOCATION_CHANGED');
  const source = await readJobMerchant(configPath, { applicationPath: selected.applicationPath });
  if (!physicalMatches(source, selected.source)) fail('JOB_MERCHANT_SOURCE_CHANGED');
  return { ...source, identity: Object.freeze(structuredClone(selected.source)),
    sourceBinding: Object.freeze({ file: binding.file, sha256: binding.sha256,
      adoptedAt: selected.adoptedAt, previousBindingSha256: selected.previousBindingSha256 }) };
}

/** Called by the original store after acquiring its lease, including direct store callers. */
export async function assertCurrentJobSourceBinding({ directory, source } = {}) {
  if (!source || !plain(source.identity)) fail('JOB_ORIGINAL_SOURCE_REQUIRED', 400);
  const binding = await readBinding(directory);
  if ((binding?.sha256 ?? null) !== (source.sourceBinding?.sha256 ?? null))
    fail('JOB_SOURCE_BINDING_CHANGED');
  if (binding && (!same(binding.value.source, source.identity) ||
      binding.value.directory !== directory || binding.value.configPath !== source.configPath ||
      binding.value.applicationPath !== source.applicationPath)) fail('JOB_SOURCE_BINDING_CHANGED');
}

async function retainedSource(directory, original) {
  const retained = parse(await privateBytes(join(directory, 'source.json'), 2097152));
  if (!plain(retained) || retained.schema !== 'stellar-forge.job-merchant-state.v1' ||
      !same(retained.source, original)) fail('JOB_MERCHANT_SOURCE_CHANGED');
  if (digest(await privateBytes(join(directory, 'config-source.json'), 1048576)) !== original.configSha256 ||
      digest(await privateBytes(join(directory, 'application-source.mjs'), 4194304)) !== original.applicationSha256)
    fail('JOB_SOURCE_SNAPSHOT_CHANGED');
}
function adoptionResult(binding, created) {
  const value = binding.value;
  return { schema: 'stellar-forge.job-source-adoption.v1', created,
    bindingFile: binding.file, bindingSha256: binding.sha256,
    directory: value.directory, configPath: value.configPath, applicationPath: value.applicationPath,
    source: structuredClone(value.source), adoptedAt: value.adoptedAt,
    previousBindingSha256: value.previousBindingSha256,
    provenance: structuredClone(value.provenance) };
}

/**
 * The typed SF101 receiving profile authenticates ciphertext and reviews every
 * restored root. This adapter rechecks that exact receiving state under the
 * original writer leases before publishing a physical source binding.
 */
export async function adoptRestoredJobSource({ configPath, directory, applicationPath, originalSource,
  bundleManifestSha256, profileSha256, reviewSha256, expectedStateSha256, expectedBindingSha256,
  deliveryDirectories = [] } = {}) {
  identity(originalSource);
  if (![configPath, directory, applicationPath].every(absolute) || !applicationPath.endsWith('.mjs') ||
      ![bundleManifestSha256, profileSha256, reviewSha256, expectedStateSha256].every(hash) ||
      expectedBindingSha256 !== null && !hash(expectedBindingSha256))
    fail('JOB_RESTORED_SOURCE_REVIEW_REQUIRED', 400);
  await privateDirectory(directory);
  if (await realpath(configPath) !== configPath || await realpath(applicationPath) !== applicationPath)
    fail('JOB_SOURCE_BINDING_LOCATION_CHANGED');
  const lease = await acquireJobRecoveryLeases({ directory, deliveryDirectories });
  try {
    await lease.assertHeld();
    const previous = await readBinding(directory);
    await retainedSource(directory, originalSource);
    const source = await readJobMerchant(configPath, { applicationPath });
    if (source.applicationPath !== applicationPath || !physicalMatches(source, originalSource))
      fail('JOB_MERCHANT_SOURCE_CHANGED');
    const provenance = { bundleManifestSha256, profileSha256, reviewSha256, stateSha256: expectedStateSha256 };
    // A committed marker is the durable outcome, even if its caller lost the
    // response and legitimate work has advanced since that restore completed.
    if (previous && previous.value.directory === directory && previous.value.configPath === configPath &&
        previous.value.applicationPath === applicationPath && same(previous.value.source, originalSource) &&
        same(previous.value.provenance, provenance)) {
      await lease.assertHeld();
      return adoptionResult(previous, false);
    }
    if (previous && !same(previous.value.source, originalSource)) fail('JOB_MERCHANT_SOURCE_CHANGED');
    if ((previous?.sha256 ?? null) !== expectedBindingSha256) fail('JOB_SOURCE_BINDING_CHANGED');
    const state = await inspectJobRecoveryState({ directory, deliveryDirectories });
    if (state.sha256 !== expectedStateSha256) fail('JOB_RESTORED_STATE_CHANGED');
    await lease.assertHeld();
    const selected = { schema: JOB_SOURCE_BINDING_SCHEMA, source: structuredClone(originalSource),
      directory, configPath, applicationPath, provenance,
      previousBindingSha256: previous?.sha256 ?? null, adoptedAt: new Date().toISOString() };
    const bytes = Buffer.from(JSON.stringify(selected) + '\n');
    const history = await preserveBinding(directory, previous, lease);
    const temp = await writeTemporary(history, bytes, lease);
    try {
      // Re-read the config/application and marker immediately before commit.
      // All cooperative job, event-delivery and result-delivery writers remain leased.
      const finalSource = await readJobMerchant(configPath, { applicationPath });
      if (finalSource.applicationPath !== applicationPath || !physicalMatches(finalSource, originalSource))
        fail('JOB_MERCHANT_SOURCE_CHANGED');
      if (((await readBinding(directory))?.sha256 ?? null) !== expectedBindingSha256)
        fail('JOB_SOURCE_BINDING_CHANGED');
      await lease.assertHeld();
      await rename(temp, join(directory, MARKER));
      await flush(directory); await flush(history);
    } finally { await unlink(temp).catch(() => {}); }
    const committed = await readBinding(directory);
    if (!committed || committed.sha256 !== digest(bytes)) fail('JOB_SOURCE_BINDING_COMMIT_CHANGED');
    await lease.assertHeld();
    return adoptionResult(committed, true);
  } finally { await lease.close(); }
}
