// MIT. Capture complete native state under its original workspace/release leases.
import { readdir, lstat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { canonical, sha256, fail } from '../common.mjs';
import { grpcEnvironmentNames, validateGrpcConfig } from '../config.mjs';
import { inspectGrpcWorkspaceBinding, assertGrpcWorkspaceBinding } from '../workspace/binding.mjs';
import { GRPC_TRANSFER_MANIFEST, GRPC_TRANSFER_FILE_BYTES, GRPC_TRANSFER_MAX_FILES,
  GRPC_TRANSFER_COUNTS, transferPath, createGrpcTransferManifest, validateGrpcTransferManifest } from './manifest.mjs';
import { transferDirectory, transferRead, transferJson, transferWrite, copyTransferFile } from './files.mjs';

const UUID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const SHA = '[a-f0-9]{64}';
const rootDirectories = new Set(['revisions', 'prepared', 'intents', 'attempts', 'reflections', 'upgrades', 'operations']);
const rootDocuments = /^(?:current|revisions|reflections)\.json$|^review-[a-f0-9]{64}\.json$/;
const sameBinding = (left, right) => canonical(left) === canonical(right);
const savedKeys = new Set(['schema', 'state', 'phase', 'id', 'instanceId', 'releaseId', 'revision', 'generation',
  'selectionSha256', 'sourceSha256', 'sourceFiles', 'selectedCurrent', 'createdAt', 'updatedAt', 'startedAt',
  'stoppedAt', 'finishedAt', 'pid', 'directory', 'mode', 'error', 'reason', 'previous', 'active', 'history']);
function safeObservation(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4096) return undefined;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
    return value;
  }
  if (Array.isArray(value)) return value.map(safeObservation).filter(value => value !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => savedKeys.has(key) ||
    ['path', 'sha256', 'bytes', 'device', 'inode', 'identity'].includes(key))
    .map(([key, entry]) => [key, safeObservation(entry)]).filter(([, entry]) => entry !== undefined));
}
export function transferCounts(files, health) {
  const sets = Object.fromEntries(GRPC_TRANSFER_COUNTS.map(key => [key, new Set()]));
  const patterns = {
    revisions: new RegExp('^workspace/revisions/(' + SHA + ')\\.json$'),
    reflections: new RegExp('^workspace/reflections/(' + UUID + ')\\.json$'),
    attempts: new RegExp('^workspace/attempts/(' + UUID + ')\\.json$'),
    upgrades: new RegExp('^workspace/upgrades/(' + UUID + ')\\.json$'),
    incidents: new RegExp('^workspace/operations/cases/(' + UUID + ')/[0-9]{10}\\.json$'),
    preparations: new RegExp('^workspace/prepared/(' + UUID + ')/workspace-release\\.json$'),
    releases: /^workspace\/merchant-releases\/releases\/([a-z0-9][a-z0-9_-]{0,63})\//,
  };
  for (const file of files) for (const [kind, pattern] of Object.entries(patterns)) {
    const match = pattern.exec(file.path); if (match) sets[kind].add(match[1]);
  }
  for (const entry of health) sets.health.add(entry.id);
  return Object.fromEntries(Object.entries(sets).map(([key, entries]) => [key, entries.size]));
}
export async function captureGrpcTransferSnapshot({ root, directory, id, expectedBinding, maxBytes,
  assertHeld, visitHealthPrefixes, signal, onProgress = async () => {} }) {
  assertHeld();
  const before = await inspectGrpcWorkspaceBinding(root);
  if (expectedBinding && !sameBinding(before, expectedBinding)) fail('GRPC_MANAGED_WORKSPACE_CHANGED', 409);
  await transferDirectory(directory, true);
  const committed = await transferJson(join(directory, GRPC_TRANSFER_MANIFEST));
  if (committed) {
    const value = validateGrpcTransferManifest(committed);
    if (value.id !== id || !sameBinding(value.origin.binding, expectedBinding ?? before))
      fail('GRPC_TRANSFER_ID_CONFLICT', 409);
    return value;
  }
  // Only this transfer's unpublished private snapshot is disposable. Once its
  // manifest exists, every retry uses that frozen edition instead.
  for (const entry of await readdir(directory)) {
    if (!['workspace', 'observations'].includes(entry)) fail('GRPC_TRANSFER_SNAPSHOT_DIRECTORY_IN_USE', 409);
    const path = join(directory, entry); await transferDirectory(path);
    await rm(path, { recursive: true, force: false });
  }
  const files = [], health = [], environmentNames = new Set();
  let total = 0, visited = 0, lastProgressAt = 0;
  const charge = size => {
    if (!Number.isSafeInteger(size) || size < 0 || size > GRPC_TRANSFER_FILE_BYTES ||
      files.length >= GRPC_TRANSFER_MAX_FILES || total + size > maxBytes)
      fail('GRPC_TRANSFER_TOO_LARGE', 413);
  };
  const progress = async force => {
    if (force || Date.now() - lastProgressAt >= 2000) {
      lastProgressAt = Date.now(); await onProgress({ files: files.length, bytes: total });
    }
  };
  const copy = async (source, path, kind = 'workspace', prefixBytes) => {
    signal?.throwIfAborted(); assertHeld(); transferPath(path);
    const size = prefixBytes ?? (await lstat(source)).size; charge(size);
    const result = await copyTransferFile({ source, destination: join(directory, path),
      prefixBytes, maximum: Math.min(GRPC_TRANSFER_FILE_BYTES, maxBytes - total), signal });
    total += result.bytes; files.push({ path, ...result, kind }); await progress(false);
  };
  const document = async (path, value) => {
    transferPath(path);
    const bytes = Buffer.from(JSON.stringify(value) + '\n'); charge(bytes.length);
    await transferWrite(join(directory, path), bytes, { cap: GRPC_TRANSFER_FILE_BYTES });
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes), kind: 'observation' });
    total += bytes.length; await progress(false);
  };
  const observation = async (source, path) => {
    const bytes = await transferRead(source, 1048576);
    let original;
    try { original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('GRPC_TRANSFER_OBSERVATION_INVALID', 409); }
    await document(path, { schema: 'stellar-forge.grpc-workspace-runtime-observation.v1',
      originPath: source.slice(root.length + 1), bytes: bytes.length, sha256: sha256(bytes),
      record: safeObservation(original) });
  };
  async function walk(source, prefix, kind = 'workspace') {
    await transferDirectory(source);
    for (const name of (await readdir(source)).sort()) {
      if (++visited > GRPC_TRANSFER_MAX_FILES * 3) fail('GRPC_TRANSFER_TOO_MANY_ENTRIES', 413);
      const path = prefix + '/' + name; transferPath(path);
      const full = join(source, name), stat = await lstat(full);
      if (stat.isSymbolicLink()) fail('GRPC_TRANSFER_SYMBOLIC_LINK_REJECTED', 409);
      if (stat.isDirectory()) await walk(full, path, kind);
      else if (stat.isFile()) {
        await copy(full, path, kind);
        if (new RegExp('^workspace/(?:revisions/' + SHA + '|reflections/' + UUID + ')\\.json$').test(path)) {
          const value = await transferJson(join(directory, path), 11534336);
          for (const name of grpcEnvironmentNames(validateGrpcConfig(value.source ?? value.request?.source))) environmentNames.add(name);
        }
      } else fail('GRPC_TRANSFER_SPECIAL_FILE_REJECTED', 409);
    }
  }
  for (const name of (await readdir(root)).sort()) {
    signal?.throwIfAborted();
    const path = join(root, name);
    if (rootDirectories.has(name)) await walk(path, 'workspace/' + name);
    else if (rootDocuments.test(name)) await copy(path, 'workspace/' + name);
    else if (name === 'run.json') await observation(path, 'observations/runtime/workspace.json');
    else if (name === 'managed-launches') {
      await transferDirectory(path);
      for (const launch of (await readdir(path)).sort()) {
        if (!new RegExp('^' + UUID + '\\.json$').test(launch)) fail('GRPC_TRANSFER_LAUNCH_PATH_INVALID', 409);
        await observation(join(path, launch), 'observations/managed-launches/' + launch);
      }
    } else if (name === 'merchant-releases.receiving')
      await walk(path, 'observations/release-receiving', 'observation');
    else if (name === '.grpc-transfer-source.json' || name === '.grpc-transfer-receiving.json')
      await copy(path, 'observations/prior-transfer/' + name.slice(1), 'observation');
    else if (name === '.grpc-transfer-observations')
      await walk(path, 'observations/prior-transfer/observations', 'observation');
    else if (!['health', 'merchant-releases', 'lease.lock', 'temporary', 'transfers'].includes(name))
      fail('GRPC_TRANSFER_UNREVIEWED_WORKSPACE_PATH', 409);
  }
  await visitHealthPrefixes(async entry => {
    signal?.throwIfAborted(); assertHeld();
    await copy(join(entry.directory, 'operation.json'), 'workspace/health/' + entry.id + '/operation.json');
    const path = 'workspace/health/' + entry.id + '/events.ndjson';
    if (entry.bytes) await copy(join(entry.directory, 'events.ndjson'), path, 'health-prefix', entry.bytes);
    else {
      charge(0); await transferWrite(join(directory, path), Buffer.alloc(0));
      files.push({ path, bytes: 0, sha256: sha256(Buffer.alloc(0)), kind: 'health-prefix' });
    }
    health.push({ id: entry.id, throughSequence: entry.throughSequence,
      snapshotSha256: entry.snapshotSha256, bytes: entry.bytes });
  });
  const releaseRoot = join(root, 'merchant-releases');
  let hasReleases = false;
  try { await transferDirectory(releaseRoot); hasReleases = true; }
  catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  if (hasReleases) {
    const { acquireReleaseLease } = await import('../../../sf82-seller-pilot/release-process.mjs');
    const { readReleaseState, inspectRelease } = await import('../../../sf82-seller-pilot/releases.mjs');
    const releaseLease = await acquireReleaseLease(releaseRoot, 'state.lock');
    if (!releaseLease) fail('GRPC_TRANSFER_RELEASE_LEASE_UNAVAILABLE', 409);
    try {
      await releaseLease.assert(); await readReleaseState(releaseRoot);
      await copy(join(releaseRoot, 'state.json'), 'workspace/merchant-releases/state.json');
      const releases = join(releaseRoot, 'releases'); await transferDirectory(releases);
      for (const releaseId of (await readdir(releases)).sort()) {
        if (releaseId.startsWith('.stage-')) continue;
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(releaseId)) fail('GRPC_TRANSFER_RELEASE_PATH_INVALID', 409);
        const original = join(releases, releaseId); await transferDirectory(original);
        await inspectRelease(releaseRoot, releaseId);
        const record = await transferJson(join(original, 'release.json'), 4194304);
        if (!record?.grpc || !Array.isArray(record.files)) fail('GRPC_TRANSFER_NATIVE_GRPC_RELEASE_REQUIRED', 409);
        const prefix = 'workspace/merchant-releases/releases/' + releaseId;
        await copy(join(original, 'release.json'), prefix + '/release.json');
        for (const entry of record.files) {
          if (entry.file === 'release.json') fail('GRPC_TRANSFER_RELEASE_FILE_INVALID', 409);
          transferPath(prefix + '/' + entry.file);
          await copy(join(original, entry.file), prefix + '/' + entry.file);
          const retained = files.at(-1);
          if (retained.bytes !== entry.bytes || retained.sha256 !== entry.sha256)
            fail('GRPC_TRANSFER_RELEASE_SOURCE_CHANGED', 409);
        }
        const source = await transferJson(join(original, 'grpc/package/source.json'), 65536);
        for (const name of grpcEnvironmentNames(validateGrpcConfig(source))) environmentNames.add(name);
        for (const file of ['pilot-runtime.json', 'runtime-readiness.json']) {
          try { await observation(join(original, file), 'observations/releases/' + releaseId + '/' + file); }
          catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
        }
        try { await walk(join(original, 'grpc-runtime'), 'observations/releases/' + releaseId + '/grpc-runtime', 'observation'); }
        catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
      }
      await releaseLease.assert();
    } finally { await releaseLease.close(); }
    try { await observation(join(releaseRoot, 'runtime.json'), 'observations/runtime/releases.json'); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    for (const name of (await readdir(releaseRoot)).sort()) {
      if (['state.json', 'releases', 'runtime.json', 'run.lock', 'state.lock'].includes(name) ||
        /^\.sf82-(?:run|state)\.lock\.lifetime$/.test(name) || name.startsWith('state.json.')) continue;
      const path = join(releaseRoot, name), info = await lstat(path);
      if (info.isDirectory() && !info.isSymbolicLink())
        await walk(path, 'observations/release-store/' + name, 'observation');
      else if (info.isFile()) await copy(path, 'observations/release-store/' + name, 'observation');
      else fail('GRPC_TRANSFER_RELEASE_OBSERVATION_INVALID', 409);
    }
  }
  assertHeld(); await assertGrpcWorkspaceBinding(root, before);
  const value = createGrpcTransferManifest({ id, createdAt: new Date().toISOString(),
    origin: { directory: root, binding: before }, counts: transferCounts(files, health),
    environmentNames: [...environmentNames], health, files, bytes: total });
  await progress(true);
  await transferWrite(join(directory, GRPC_TRANSFER_MANIFEST), value, { exclusive: true });
  return value;
}
