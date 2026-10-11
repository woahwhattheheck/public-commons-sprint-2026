// MIT. Portable original runtime source and lock-bound public npm cache transport.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir, link, unlink, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { prepareRuntimeInstall, installRuntime, inspectRuntimeInstall, recoverRuntime } from './runtime-install.mjs';
import { verifyRuntimeProfile } from './runtime-profile.mjs';
import { privateDirectory, makePrivate, operationLease, saveJSON, now } from './runtime-workspace/storage.mjs';
import { TRANSFER_SCHEMA, TRANSFER_STATE_SCHEMA, MAX_PART_BYTES, MAX_MANIFEST_BYTES, DEFAULT_MAX_BYTES,
  plain, digest, json, canonical, fail, need, validHash, integrityHashes, verifyIntegrity,
  describeRuntimeLock, verifyTransferManifest, partName } from './runtime-transfer-lock.mjs';

const STATE = 'transfer-state.json', MANIFEST = 'manifest.json';
const SAME = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const checkAbort = signal => { if (signal?.aborted) throw fail('RUNTIME_TRANSFER_INTERRUPTED', 'The retained transfer can be resumed'); };
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function smallFile(path, maximum = 4 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'RUNTIME_TRANSFER_REGULAR_FILE_REQUIRED');
    const bytes = await handle.readFile(), last = await handle.stat();
    need(SAME(first, last) && bytes.length === first.size, 'RUNTIME_TRANSFER_INPUT_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
async function readRecord(path, optional = false) {
  try { return parse(await smallFile(path, MAX_MANIFEST_BYTES)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function ensurePrivate(path) {
  try { return await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return privateDirectory(path); }
}
async function fileIdentity(path, { maximum = DEFAULT_MAX_BYTES, integrity = null, signal, handle: suppliedHandle = null } = {}) {
  const handle = suppliedHandle ?? await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'RUNTIME_TRANSFER_REGULAR_FILE_REQUIRED');
    const algorithms = [...new Set(['sha256', ...integrityHashesIf(integrity).map(item => item.algorithm)])];
    const hashes = Object.fromEntries(algorithms.map(algorithm => [algorithm, createHash(algorithm)]));
    const buffer = Buffer.allocUnsafe(256 * 1024); let offset = 0;
    while (true) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      need(offset <= maximum, 'RUNTIME_TRANSFER_FILE_LIMIT');
      for (const hash of Object.values(hashes)) hash.update(buffer.subarray(0, bytesRead));
    }
    need(SAME(first, await handle.stat()) && offset === first.size, 'RUNTIME_TRANSFER_INPUT_CHANGED');
    const results = Object.fromEntries(Object.entries(hashes).map(([algorithm, hash]) => [algorithm, hash.digest()]));
    if (integrity) verifyIntegrity(Object.fromEntries(Object.entries(results).map(([algorithm, bytes]) => [algorithm, bytes.toString('base64')])), integrity);
    return { bytes: offset, sha256: results.sha256.toString('hex') };
  } finally { if (!suppliedHandle) await handle.close(); }
}
function integrityHashesIf(value) { return value === null ? [] : integrityHashes(value); }
async function immutableBytes(path, bytes) {
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try { await link(temporary, path); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = await smallFile(path, Math.max(bytes.length, 1));
    need(current.equals(bytes), 'RUNTIME_TRANSFER_IMMUTABLE_CONFLICT');
  } finally { await unlink(temporary).catch(() => {}); }
  await syncDirectory(dirname(path));
}
async function publishFile(temporary, destination, expected) {
  try { await link(temporary, destination); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = await fileIdentity(destination, { maximum: expected.bytes });
    need(equal(current, expected), 'RUNTIME_TRANSFER_IMMUTABLE_CONFLICT');
  } finally { await unlink(temporary).catch(() => {}); }
  await syncDirectory(dirname(destination));
}
async function saveState(root, value) {
  await saveJSON(join(root, STATE), { schema: TRANSFER_STATE_SCHEMA, ...value, updatedAt: now() }, true);
}
function sanitizedNpmEnvironment(root) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (/^(npm_config_|npm_token$|node_auth_token$)/i.test(key)) delete environment[key];
  return { ...environment, npm_config_update_notifier: 'false',
    npm_config_userconfig: join(root, 'npm-user-config'), npm_config_globalconfig: join(root, 'npm-global-config') };
}
async function npmCommand(root, npm, arguments_, { leaseFd, signal, capture = false } = {}) {
  need(typeof npm === 'string' && npm && !npm.includes('\0'), 'RUNTIME_TRANSFER_NPM_INVALID');
  checkAbort(signal);
  await immutableBytes(join(root, 'npm-user-config'), Buffer.alloc(0));
  await immutableBytes(join(root, 'npm-global-config'), Buffer.alloc(0));
  const log = await open(join(root, 'npm-' + randomUUID() + '.log'), 'wx', 0o600);
  try {
    return await new Promise((done, reject) => {
      const child = spawn(npm, arguments_, { cwd: root, shell: false, windowsHide: true,
        env: sanitizedNpmEnvironment(root), stdio: ['ignore', capture ? 'pipe' : log.fd, log.fd, leaseFd ?? 'ignore'] });
      let output = '', overflow = false, timer;
      const stop = () => {
        if (child.exitCode !== null) return;
        child.kill('SIGTERM');
        timer ??= setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 6000);
        timer.unref();
      };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop);
        process.off('SIGINT', stop); process.off('SIGTERM', stop); };
      signal?.addEventListener('abort', stop, { once: true });
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      if (capture) child.stdout.on('data', bytes => {
        if (output.length + bytes.length > 4 * 1024 * 1024) { overflow = true; stop(); }
        else output += bytes.toString('utf8');
      });
      child.once('error', error => { cleanup(); reject(fail(error.code === 'ENOENT' ?
        'RUNTIME_TRANSFER_NPM_UNAVAILABLE' : 'RUNTIME_TRANSFER_NPM_FAILED')); });
      child.once('close', (code, childSignal) => {
        cleanup();
        if (code !== 0 || overflow || signal?.aborted) reject(fail(signal?.aborted ? 'RUNTIME_TRANSFER_INTERRUPTED' :
          'RUNTIME_TRANSFER_NPM_FAILED', 'The selected npm operation did not complete; its private log is retained'));
        else done({ code, signal: childSignal, output });
      });
    });
  } finally { await log.sync().catch(() => {}); await log.close(); }
}
async function runtimeInputs(runtimeDirectory, { verifySource = true } = {}) {
  const directory = await privateDirectory(resolve(runtimeDirectory));
  const original = await inspectRuntimeInstall({ directory, load: false, source: verifySource });
  need(original.status === 'READY' && original.ready && original.lockMatches,
    'RUNTIME_TRANSFER_READY_RUNTIME_REQUIRED', 'Select an unchanged original READY installation');
  const names = ['runtime-install.json', 'install-state.json', 'runtime-profile.json', 'package.json', 'package-lock.json'];
  const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await smallFile(join(directory, name),
    name === 'package-lock.json' ? 16 * 1024 * 1024 : 4 * 1024 * 1024)])));
  const plan = parse(bytes['runtime-install.json']), state = parse(bytes['install-state.json']);
  const profile = verifyRuntimeProfile(parse(bytes['runtime-profile.json']));
  const packageJson = parse(bytes['package.json']), lock = parse(bytes['package-lock.json']);
  need(state.phase === 'READY' && state.lockSha256 === digest(bytes['package-lock.json']) &&
    plan.profileId === profile.profileId && plan.profileSha256 === digest(bytes['runtime-profile.json']) &&
    plan.packageJsonSha256 === digest(bytes['package.json']) && equal(profile.packageJson, packageJson) &&
    original.installationId === plan.installationId && original.lockSha256 === state.lockSha256,
  'RUNTIME_TRANSFER_RUNTIME_CHANGED');
  const archive = await fileIdentity(join(directory, 'source.tgz'), { maximum: 64 * 1024 * 1024 });
  need(archive.sha256 === plan.archiveSha256, 'RUNTIME_TRANSFER_SOURCE_CHANGED');
  const inventory = describeRuntimeLock(lock, packageJson);
  const runtime = { installationId: plan.installationId, profileId: profile.profileId,
    archiveSha256: archive.sha256, profileSha256: plan.profileSha256, packageJsonSha256: plan.packageJsonSha256,
    lockSha256: state.lockSha256, sourceCommit: plan.source.sourceCommit,
    packageName: plan.source.packageName, packageVersion: plan.source.packageVersion };
  return { directory, runtime, inventory, profile, bytes, archive };
}
export async function reviewRuntimeTransfer({ runtimeDirectory } = {}) {
  need(typeof runtimeDirectory === 'string' && runtimeDirectory, 'RUNTIME_TRANSFER_RUNTIME_REQUIRED');
  const inputs = await runtimeInputs(runtimeDirectory);
  return { schema: 'stellar-forge.runtime-transfer-review.v1', runtimeDirectory: inputs.directory,
    runtime: inputs.runtime, selection: inputs.profile.selection, host: inputs.profile.host,
    dependencies: inputs.profile.dependencies, inventory: inputs.inventory,
    ready: inputs.inventory.supported, offlineDefault: true, maximumPartBytes: MAX_PART_BYTES };
}
async function retainedPackage(root, artifact, cache, { npm, offline, leaseFd, signal } = {}) {
  const identity = digest(json(canonical(artifact)));
  const receiptFile = join(root, 'package-receipts', identity + '.json');
  const retained = await readRecord(receiptFile, true);
  if (retained) {
    need(equal(retained.input, artifact), 'RUNTIME_TRANSFER_PACKAGE_RECEIPT_CHANGED');
    const observed = await fileIdentity(join(root, 'artifacts', retained.sha256 + '.tgz'),
      { maximum: 512 * 1024 * 1024, integrity: artifact.integrity, signal });
    need(observed.sha256 === retained.sha256 && observed.bytes === retained.bytes, 'RUNTIME_TRANSFER_PACKAGE_CHANGED');
    return { ...artifact, ...observed };
  }
  const temporary = await makePrivate(join(root, 'package-work', randomUUID()));
  const response = await npmCommand(root, npm, ['pack', artifact.resolved, '--json', '--ignore-scripts',
    '--global=false', '--workspaces=false', '--registry=https://registry.npmjs.org',
    '--pack-destination', temporary, '--cache', cache, '--no-audit', '--no-fund', ...(offline ? ['--offline'] : [])],
  { leaseFd, signal, capture: true });
  let packed;
  try { packed = JSON.parse(response.output); } catch { throw fail('RUNTIME_TRANSFER_PACK_RESPONSE_INVALID'); }
  need(Array.isArray(packed) && packed.length === 1 && packed[0].name === artifact.name &&
    packed[0].version === artifact.version && typeof packed[0].filename === 'string' &&
    basename(packed[0].filename) === packed[0].filename && /^[a-zA-Z0-9@._+-]+\.tgz$/.test(packed[0].filename),
  'RUNTIME_TRANSFER_PACK_IDENTITY_MISMATCH');
  const source = join(temporary, packed[0].filename);
  const observed = await fileIdentity(source, { maximum: 512 * 1024 * 1024, integrity: artifact.integrity, signal });
  need(observed.bytes > 0, 'RUNTIME_TRANSFER_EMPTY_PACKAGE');
  // This is the original fetched tarball, verified against the retained npm lock.
  await publishFile(source, join(root, 'artifacts', observed.sha256 + '.tgz'), observed);
  await saveJSON(receiptFile, { input: artifact, ...observed });
  await rm(temporary, { recursive: true, force: true });
  return { ...artifact, ...observed };
}
async function writePayload(root, files, partBytes, signal) {
  const parts = [], payloadHash = createHash('sha256'); let total = 0, part = null;
  async function finish() {
    if (!part) return;
    await part.handle.sync(); await part.handle.close();
    const record = { index: parts.length, name: partName(parts.length), offset: total - part.bytes,
      bytes: part.bytes, sha256: part.hash.digest('hex') };
    await publishFile(part.temporary, join(root, 'parts', record.name), { bytes: record.bytes, sha256: record.sha256 });
    parts.push(record); part = null;
  }
  try {
    for (const file of files) {
      const input = await open(file.source, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await input.stat();
        need(before.isFile() && before.size === file.bytes, 'RUNTIME_TRANSFER_INPUT_CHANGED');
        const fileHash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024); let offset = 0;
        while (offset < file.bytes) {
          checkAbort(signal);
          const read = await input.read(buffer, 0, Math.min(buffer.length, file.bytes - offset), offset);
          need(read.bytesRead > 0, 'RUNTIME_TRANSFER_INPUT_CHANGED');
          offset += read.bytesRead; const bytes = buffer.subarray(0, read.bytesRead);
          fileHash.update(bytes); payloadHash.update(bytes);
          let position = 0;
          while (position < bytes.length) {
            if (!part) {
              const temporary = join(root, 'parts', partName(parts.length) + '.pending-' + randomUUID());
              part = { temporary, handle: await open(temporary, 'wx', 0o600), bytes: 0, hash: createHash('sha256') };
            }
            const slice = bytes.subarray(position, position + Math.min(partBytes - part.bytes, bytes.length - position));
            await part.handle.writeFile(slice); part.hash.update(slice);
            part.bytes += slice.length; total += slice.length; position += slice.length;
            if (part.bytes === partBytes) await finish();
          }
        }
        need(SAME(before, await input.stat()) && fileHash.digest('hex') === file.sha256, 'RUNTIME_TRANSFER_INPUT_CHANGED');
      } finally { await input.close(); }
    }
    await finish();
    return { parts, payload: { bytes: total, sha256: payloadHash.digest('hex'), partBytes } };
  } finally {
    if (part) { await part.handle.close().catch(() => {}); await unlink(part.temporary).catch(() => {}); }
  }
}
export async function exportRuntimeTransfer({ runtimeDirectory, directory, cache, npm = 'npm',
  offline = true, partBytes = MAX_PART_BYTES, maxBytes = DEFAULT_MAX_BYTES,
  expectedLockSha256, signal, onProgress = async () => {} } = {}) {
  need(typeof runtimeDirectory === 'string' && runtimeDirectory && typeof directory === 'string' && directory &&
    typeof cache === 'string' && cache && typeof offline === 'boolean' &&
    Number.isSafeInteger(partBytes) && partBytes >= 64 * 1024 && partBytes <= MAX_PART_BYTES &&
    Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= DEFAULT_MAX_BYTES, 'RUNTIME_TRANSFER_OPTIONS_INVALID');
  const root = resolve(directory), cachePath = await realpath(resolve(cache));
  need(disjoint(root, resolve(runtimeDirectory)) && disjoint(root, cachePath), 'RUNTIME_TRANSFER_DIRECTORY_OVERLAP');
  let created = false;
  try { await makePrivate(root); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(root); }
  need((await lstat(cachePath)).isDirectory(), 'RUNTIME_TRANSFER_CACHE_DIRECTORY_REQUIRED');
  const lease = await operationLease(join(root, 'transfer.lock'));
  let state = await readRecord(join(root, STATE), true);
  try {
    need(created || state?.mode === 'EXPORT', 'RUNTIME_TRANSFER_EXISTING_DIRECTORY');
    const binding = { runtimeDirectory: resolve(runtimeDirectory), cache: cachePath, offline, partBytes, maxBytes,
      expectedLockSha256: expectedLockSha256 ?? null };
    if (state) {
      need(state.mode === 'EXPORT' && equal(state.binding, binding), 'RUNTIME_TRANSFER_REQUEST_CHANGED');
      if (state.phase === 'COMPLETE') return inspectRuntimeTransfer({ directory: root, verify: true });
    }
    if (!state) {
      state = { mode: 'EXPORT', phase: 'REVIEWING', binding, runtime: null, createdAt: now(),
        completedPackages: 0, totalPackages: 0 };
      await saveState(root, state);
    }
    const inputs = await runtimeInputs(runtimeDirectory);
    need(inputs.inventory.supported, 'RUNTIME_TRANSFER_LOCK_SOURCE_UNSUPPORTED',
      'The selected lock includes package sources which cannot be carried as public npm artifacts');
    if (expectedLockSha256 !== undefined)
      need(validHash(expectedLockSha256) && inputs.runtime.lockSha256 === expectedLockSha256, 'RUNTIME_TRANSFER_REVIEW_CHANGED');
    if (state.runtime) need(equal(state.runtime, inputs.runtime), 'RUNTIME_TRANSFER_RUNTIME_CHANGED');
    state = { ...state, phase: 'PACKAGES', runtime: inputs.runtime,
      totalPackages: inputs.inventory.publicArtifacts, error: null };
    await saveState(root, state);
    for (const name of ['artifacts', 'package-work', 'package-receipts', 'parts']) await ensurePrivate(join(root, name));
    const artifacts = [], counted = new Set(); let payloadBytes = inputs.archive.bytes;
    for (const name of ['runtime-profile.json', 'package.json', 'package-lock.json']) {
      await immutableBytes(join(root, name), inputs.bytes[name]); payloadBytes += inputs.bytes[name].length;
    }
    for (const artifact of inputs.inventory.artifacts) {
      checkAbort(signal);
      const retained = await retainedPackage(root, artifact, cachePath, { npm, offline, leaseFd: lease.fd, signal });
      artifacts.push(retained);
      if (!counted.has(retained.sha256)) { counted.add(retained.sha256); payloadBytes += retained.bytes; }
      need(payloadBytes <= maxBytes, 'RUNTIME_TRANSFER_PAYLOAD_LIMIT');
      state = { ...state, phase: 'PACKAGES', completedPackages: artifacts.length };
      await saveState(root, state); await onProgress({ phase: state.phase, completed: artifacts.length, total: state.totalPackages });
    }
    const files = [{ path: 'source.tgz', source: join(inputs.directory, 'source.tgz'), ...inputs.archive },
      ...['runtime-profile.json', 'package.json', 'package-lock.json'].map(path => ({
        path, source: join(root, path), bytes: inputs.bytes[path].length, sha256: digest(inputs.bytes[path]) }))];
    const seen = new Set();
    for (const artifact of artifacts) if (!seen.has(artifact.sha256)) {
      seen.add(artifact.sha256);
      files.push({ path: 'artifacts/' + artifact.sha256 + '.tgz', source: join(root, 'artifacts', artifact.sha256 + '.tgz'),
        bytes: artifact.bytes, sha256: artifact.sha256 });
    }
    let offset = 0;
    for (const file of files) { file.offset = offset; offset += file.bytes; }
    need(offset <= maxBytes, 'RUNTIME_TRANSFER_PAYLOAD_LIMIT');
    state = { ...state, phase: 'PARTS' }; await saveState(root, state);
    await onProgress({ phase: 'PARTS', bytes: offset });
    const payload = await writePayload(root, files, partBytes, signal);
    const current = await runtimeInputs(runtimeDirectory, { verifySource: false });
    need(equal(current.runtime, inputs.runtime), 'RUNTIME_TRANSFER_RUNTIME_CHANGED');
    const identity = { runtime: inputs.runtime, ...payload,
      files: files.map(({ source, ...file }) => file), artifacts };
    const manifest = { schema: TRANSFER_SCHEMA, transferId: digest(json(canonical(identity))),
      createdAt: state.createdAt, ...identity };
    verifyTransferManifest(manifest, { maxBytes });
    const bytes = Buffer.from(json(manifest));
    need(bytes.length <= MAX_MANIFEST_BYTES, 'RUNTIME_TRANSFER_MANIFEST_LIMIT');
    await immutableBytes(join(root, MANIFEST), bytes);
    state = { ...state, phase: 'COMPLETE', transferId: manifest.transferId,
      manifestSha256: digest(bytes), completedAt: now(), parts: manifest.parts.length, payloadBytes: offset };
    await saveState(root, state); await onProgress({ phase: 'COMPLETE', transferId: manifest.transferId });
    return inspectRuntimeTransfer({ directory: root });
  } catch (error) {
    if (state) await saveState(root, { ...state, error: { code: error.code ?? 'RUNTIME_TRANSFER_FAILED', at: now() } }).catch(() => {});
    throw error;
  } finally { await lease.close(); }
}

async function manifestAt(root, expectedSha256) {
  const bytes = await smallFile(join(root, MANIFEST), MAX_MANIFEST_BYTES), sha256 = digest(bytes);
  if (expectedSha256 !== undefined) need(validHash(expectedSha256) && expectedSha256 === sha256,
    'RUNTIME_TRANSFER_MANIFEST_HASH_MISMATCH');
  const manifest = verifyTransferManifest(parse(bytes));
  return { manifest, bytes, sha256 };
}
export async function inspectRuntimeTransfer({ directory, verify = false } = {}) {
  const root = await privateDirectory(resolve(directory));
  const state = await readRecord(join(root, STATE));
  need(state?.schema === TRANSFER_STATE_SCHEMA && ['EXPORT', 'RECEIVE'].includes(state.mode),
    'RUNTIME_TRANSFER_STATE_INVALID');
  if (!(await exists(join(root, MANIFEST))))
    return { schema: 'stellar-forge.runtime-transfer-inspection.v1', directory: root, state,
      complete: false, manifest: null, manifestSha256: null, parts: [] };
  const selected = await manifestAt(root, state.manifestSha256);
  if (state.transferId) need(state.transferId === selected.manifest.transferId, 'RUNTIME_TRANSFER_STATE_CHANGED');
  if (state.runtime) need(equal(state.runtime, selected.manifest.runtime), 'RUNTIME_TRANSFER_STATE_CHANGED');
  const parts = [];
  for (const part of selected.manifest.parts) {
    const filename = join(root, 'parts', part.name), present = await exists(filename);
    let status = !present ? 'MISSING' : present.isFile() && !present.isSymbolicLink() && present.size === part.bytes ? 'PRESENT' : 'INVALID';
    if (verify && status === 'PRESENT') {
      const observed = await fileIdentity(filename, { maximum: part.bytes });
      status = observed.sha256 === part.sha256 ? 'VERIFIED' : 'INVALID';
    }
    parts.push({ ...part, status });
  }
  const complete = parts.every(part => ['PRESENT', 'VERIFIED'].includes(part.status));
  return { schema: 'stellar-forge.runtime-transfer-inspection.v1', directory: root,
    state, manifest: selected.manifest, manifestSha256: selected.sha256, parts, complete,
    missingParts: parts.filter(part => part.status === 'MISSING').map(part => part.index),
    invalidParts: parts.filter(part => part.status === 'INVALID').map(part => part.index),
    cacheDirectory: state.mode === 'RECEIVE' ? join(root, 'cache') : null,
    filesDirectory: state.mode === 'RECEIVE' && state.filesReady ? join(root, 'files') : null };
}
export async function beginRuntimeTransferReceive({ directory, manifest, manifestSha256, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  need(typeof directory === 'string' && directory && validHash(manifestSha256), 'RUNTIME_TRANSFER_RECEIVE_OPTIONS_INVALID');
  const bytes = Buffer.isBuffer(manifest) ? manifest : typeof manifest === 'string' ? Buffer.from(manifest) : Buffer.from(json(manifest));
  need(bytes.length <= MAX_MANIFEST_BYTES && digest(bytes) === manifestSha256, 'RUNTIME_TRANSFER_MANIFEST_HASH_MISMATCH');
  const selected = verifyTransferManifest(parse(bytes), { maxBytes });
  const root = resolve(directory);
  let created = false;
  try { await makePrivate(root); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(root); }
  const lease = await operationLease(join(root, 'transfer.lock'));
  try {
    const existing = await readRecord(join(root, STATE), true);
    if (!created) need(existing && existing.mode === 'RECEIVE' && existing.manifestSha256 === manifestSha256 &&
      existing.transferId === selected.transferId, 'RUNTIME_TRANSFER_EXISTING_DIRECTORY');
    if (!existing) {
      await ensurePrivate(join(root, 'parts'));
      await immutableBytes(join(root, MANIFEST), bytes);
      await saveState(root, { mode: 'RECEIVE', phase: 'RECEIVING', createdAt: now(),
        manifestSha256, transferId: selected.transferId, runtime: selected.runtime,
        filesReady: false, cachedArtifacts: [], installations: [] });
    }
    return inspectRuntimeTransfer({ directory: root });
  } finally { await lease.close(); }
}
export async function receiveRuntimeTransferPart({ directory, index, body, file, signal } = {}) {
  const root = await privateDirectory(resolve(directory)), lease = await operationLease(join(root, 'transfer.lock'));
  let temporary, inputHandle;
  try {
    const state = await readRecord(join(root, STATE));
    need(state.mode === 'RECEIVE', 'RUNTIME_TRANSFER_RECEIVER_REQUIRED');
    const { manifest } = await manifestAt(root, state.manifestSha256);
    need(Number.isSafeInteger(index) && index >= 0 && index < manifest.parts.length &&
      Boolean(body) !== Boolean(file), 'RUNTIME_TRANSFER_PART_OPTIONS_INVALID');
    const part = manifest.parts[index], destination = join(root, 'parts', part.name);
    const reused = Boolean(await exists(destination));
    if (reused) {
      const current = await fileIdentity(destination, { maximum: part.bytes });
      need(current.sha256 === part.sha256 && current.bytes === part.bytes, 'RUNTIME_TRANSFER_PART_CHANGED');
      }
    let iterable = body, first;
    if (file) {
      inputHandle = await open(resolve(file), constants.O_RDONLY | constants.O_NOFOLLOW);
      first = await inputHandle.stat();
      need(first.isFile() && first.size === part.bytes, 'RUNTIME_TRANSFER_PART_SIZE_MISMATCH');
      iterable = inputHandle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 });
    }
    need(iterable && typeof iterable[Symbol.asyncIterator] === 'function', 'RUNTIME_TRANSFER_PART_STREAM_REQUIRED');
    temporary = destination + '.pending-' + randomUUID();
    const output = await open(temporary, 'wx', 0o600), hash = createHash('sha256'); let bytes = 0;
    try {
      for await (const chunk of iterable) {
        checkAbort(signal);
        need(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array, 'RUNTIME_TRANSFER_BINARY_REQUIRED');
        bytes += chunk.length; need(bytes <= part.bytes, 'RUNTIME_TRANSFER_PART_SIZE_MISMATCH');
        await output.writeFile(chunk); hash.update(chunk);
      }
      need(bytes === part.bytes && hash.digest('hex') === part.sha256, 'RUNTIME_TRANSFER_PART_HASH_MISMATCH');
      if (inputHandle) need(SAME(first, await inputHandle.stat()), 'RUNTIME_TRANSFER_INPUT_CHANGED');
      await output.sync();
    } finally { await output.close(); }
    await publishFile(temporary, destination, { bytes: part.bytes, sha256: part.sha256 }); temporary = null;
    await saveState(root, { ...state, phase: state.filesReady ? state.phase : 'RECEIVING',
      lastReceivedPart: index, error: null });
    return { index, sha256: part.sha256, bytes: part.bytes, status: 'VERIFIED', reused };
  } finally {
    if (inputHandle) await inputHandle.close().catch(() => {});
    if (temporary) await unlink(temporary).catch(() => {});
    await lease.close();
  }
}
async function* payloadChunks(root, manifest, signal) {
  const hash = createHash('sha256'); let total = 0;
  for (const part of manifest.parts) {
    const input = await open(join(root, 'parts', part.name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await input.stat(), partHash = createHash('sha256');
      need(before.isFile() && before.size === part.bytes, 'RUNTIME_TRANSFER_PART_SIZE_MISMATCH');
      let offset = 0;
      const buffer = Buffer.allocUnsafe(256 * 1024);
      while (offset < part.bytes) {
        checkAbort(signal);
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, part.bytes - offset), offset);
        need(bytesRead > 0, 'RUNTIME_TRANSFER_PART_SIZE_MISMATCH');
        const chunk = buffer.subarray(0, bytesRead);
        partHash.update(chunk); hash.update(chunk); offset += bytesRead; total += bytesRead;
        yield chunk;
      }
      need(SAME(before, await input.stat()) && partHash.digest('hex') === part.sha256, 'RUNTIME_TRANSFER_PART_HASH_MISMATCH');
    } finally { await input.close(); }
  }
  need(total === manifest.payload.bytes && hash.digest('hex') === manifest.payload.sha256, 'RUNTIME_TRANSFER_PAYLOAD_HASH_MISMATCH');
}
async function reconstructFiles(root, manifest, signal) {
  const outputRoot = await ensurePrivate(join(root, 'files'));
  await ensurePrivate(join(outputRoot, 'artifacts'));
  let fileIndex = 0, output = null, position = 0, hash = null, temporary = null;
  async function begin() {
    const file = manifest.files[fileIndex];
    temporary = join(outputRoot, file.path) + '.pending-' + randomUUID();
    output = await open(temporary, 'wx', 0o600); position = 0; hash = createHash('sha256');
  }
  async function finish() {
    const file = manifest.files[fileIndex];
    need(position === file.bytes && hash.digest('hex') === file.sha256, 'RUNTIME_TRANSFER_FILE_HASH_MISMATCH');
    await output.sync(); await output.close(); output = null;
    await publishFile(temporary, join(outputRoot, file.path), { bytes: file.bytes, sha256: file.sha256 });
    temporary = null; fileIndex++;
  }
  try {
    for await (const bytes of payloadChunks(root, manifest, signal)) {
      let offset = 0;
      while (offset < bytes.length) {
        need(fileIndex < manifest.files.length, 'RUNTIME_TRANSFER_PAYLOAD_OVERFLOW');
        if (!output) await begin();
        const file = manifest.files[fileIndex], length = Math.min(file.bytes - position, bytes.length - offset);
        const slice = bytes.subarray(offset, offset + length);
        await output.writeFile(slice); hash.update(slice); position += length; offset += length;
        if (position === file.bytes) await finish();
      }
    }
    need(!output && fileIndex === manifest.files.length, 'RUNTIME_TRANSFER_PAYLOAD_INCOMPLETE');
  } finally {
    if (output) await output.close().catch(() => {});
    if (temporary) await unlink(temporary).catch(() => {});
  }
  return outputRoot;
}
async function validateReceivedFiles(root, manifest, signal) {
  const filesRoot = await privateDirectory(join(root, 'files'));
  for (const file of manifest.files) {
    const current = await fileIdentity(join(filesRoot, file.path), { maximum: file.bytes, signal });
    need(current.sha256 === file.sha256 && current.bytes === file.bytes, 'RUNTIME_TRANSFER_FILE_CHANGED');
  }
  const profile = verifyRuntimeProfile(parse(await smallFile(join(filesRoot, 'runtime-profile.json'))));
  const packageJson = parse(await smallFile(join(filesRoot, 'package.json')));
  const lock = parse(await smallFile(join(filesRoot, 'package-lock.json'), 16 * 1024 * 1024));
  need(profile.profileId === manifest.runtime.profileId && equal(packageJson, profile.packageJson) &&
    profile.source.sourceCommit === manifest.runtime.sourceCommit &&
    profile.source.packageName === manifest.runtime.packageName &&
    profile.source.packageVersion === manifest.runtime.packageVersion,
  'RUNTIME_TRANSFER_RECEIVED_PROFILE_MISMATCH');
  const inventory = describeRuntimeLock(lock, packageJson);
  need(inventory.supported && inventory.artifacts.length === manifest.artifacts.length, 'RUNTIME_TRANSFER_RECEIVED_LOCK_MISMATCH');
  for (const artifact of inventory.artifacts) {
    const retained = manifest.artifacts.find(item => item.resolved === artifact.resolved && item.integrity === artifact.integrity);
    need(retained && equal(artifact, (({ bytes, sha256, ...rest }) => rest)(retained)), 'RUNTIME_TRANSFER_RECEIVED_LOCK_MISMATCH');
    const observed = await fileIdentity(join(filesRoot, 'artifacts', retained.sha256 + '.tgz'),
      { maximum: retained.bytes, integrity: retained.integrity, signal });
    need(observed.sha256 === retained.sha256 && observed.bytes === retained.bytes, 'RUNTIME_TRANSFER_RECEIVED_PACKAGE_MISMATCH');
  }
  return { filesRoot, profile, inventory };
}
export async function completeRuntimeTransferReceive({ directory, npm = 'npm', populateCache = true,
  signal, onProgress = async () => {} } = {}) {
  need(typeof populateCache === 'boolean', 'RUNTIME_TRANSFER_OPTIONS_INVALID');
  const root = await privateDirectory(resolve(directory)), lease = await operationLease(join(root, 'transfer.lock'));
  let state = await readRecord(join(root, STATE));
  try {
    need(state.mode === 'RECEIVE', 'RUNTIME_TRANSFER_RECEIVER_REQUIRED');
    const { manifest } = await manifestAt(root, state.manifestSha256);
    if (!state.filesReady) {
      state = { ...state, phase: 'RECONSTRUCTING', error: null }; await saveState(root, state);
      await onProgress({ phase: state.phase, bytes: manifest.payload.bytes });
      await reconstructFiles(root, manifest, signal);
      await validateReceivedFiles(root, manifest, signal);
      state = { ...state, filesReady: true, phase: 'RECEIVED', receivedAt: now() }; await saveState(root, state);
    } else await validateReceivedFiles(root, manifest, signal);
    if (populateCache) {
      const cache = await ensurePrivate(join(root, 'cache'));
      const unique = [...new Map(manifest.artifacts.map(artifact => [artifact.sha256, artifact])).values()];
      const cached = new Set(); // A cache is disposable: repopulate the exact retained bytes on reopening.
      for (let offset = 0; offset < unique.length; offset += 64) {
        checkAbort(signal);
        const batch = unique.slice(offset, offset + 64);
        await npmCommand(root, npm, ['cache', 'add',
          ...batch.map(artifact => join(root, 'files', 'artifacts', artifact.sha256 + '.tgz')),
          '--cache', cache, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
          '--registry=https://registry.npmjs.org'], { leaseFd: lease.fd, signal });
        for (const artifact of batch) cached.add(artifact.sha256);
        state = { ...state, phase: 'CACHE', cachedArtifacts: [...cached], error: null };
        await saveState(root, state);
        await onProgress({ phase: 'CACHE', completed: cached.size, total: unique.length });
      }
      state = { ...state, phase: 'CACHE_READY', cacheDirectory: cache, cacheCompletedAt: now(), error: null };
      await saveState(root, state);
    }
    return inspectRuntimeTransfer({ directory: root });
  } catch (error) {
    await saveState(root, { ...state, error: { code: error.code ?? 'RUNTIME_TRANSFER_FAILED', at: now() } }).catch(() => {});
    throw error;
  } finally { await lease.close(); }
}
/** Read retained bytes for the existing authenticated workspace download path. */
export async function openRuntimeTransferDownload({ directory, kind, index } = {}) {
  const root = await privateDirectory(resolve(directory)), state = await readRecord(join(root, STATE));
  const selected = await manifestAt(root, state.manifestSha256);
  let name, expected;
  if (kind === 'manifest') { name = MANIFEST; expected = { bytes: selected.bytes.length, sha256: selected.sha256 }; }
  else {
    need(kind === 'part' && Number.isSafeInteger(index) && index >= 0 && index < selected.manifest.parts.length,
      'RUNTIME_TRANSFER_DOWNLOAD_INVALID');
    const part = selected.manifest.parts[index]; name = 'parts/' + part.name; expected = part;
  }
  const path = join(root, name), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const observed = await fileIdentity(path, { maximum: expected.bytes, handle });
    need(observed.sha256 === expected.sha256 && observed.bytes === expected.bytes, 'RUNTIME_TRANSFER_DOWNLOAD_CHANGED');
  } catch (error) { await handle.close(); throw error; }
  return { handle, file: kind === 'manifest' ? 'runtime-transfer-' + selected.manifest.transferId.slice(0, 12) + '.json' :
    selected.manifest.parts[index].name, bytes: expected.bytes,
    type: kind === 'manifest' ? 'application/json' : 'application/octet-stream', sha256: expected.sha256 };
}
function disjoint(a, b) { return a !== b && !a.startsWith(b + '/') && !b.startsWith(a + '/'); }
export async function installReceivedRuntime({ directory, runtimeDirectory, npm = 'npm', python = 'python3',
  nodeHeaders = null, install = true, recoverFrom = null, signal, onProgress = async () => {} } = {}) {
  need(typeof runtimeDirectory === 'string' && runtimeDirectory && typeof install === 'boolean',
    'RUNTIME_TRANSFER_INSTALL_OPTIONS_INVALID');
  // Exact receipt/cache work completes before the original installer receives a new target.
  await completeRuntimeTransferReceive({ directory, npm, signal, onProgress });
  const root = await privateDirectory(resolve(directory)), target = resolve(runtimeDirectory);
  need(disjoint(root, target), 'RUNTIME_TRANSFER_INSTALL_DIRECTORY_OVERLAP');
  const lease = await operationLease(join(root, 'transfer.lock'));
  const state = await readRecord(join(root, STATE));
  const { manifest } = await manifestAt(root, state.manifestSha256);
  const receiptRoot = await ensurePrivate(join(root, 'installations'));
  const recordPath = join(receiptRoot, digest(target) + '.json');
  let record = await readRecord(recordPath, true);
  try {
    checkAbort(signal);
    const binding = { runtimeDirectory: target, manifestSha256: state.manifestSha256, nodeHeaders,
      python, recoverFrom: recoverFrom ? resolve(recoverFrom) : null };
    if (record) need(equal(record.binding, binding), 'RUNTIME_TRANSFER_INSTALL_REQUEST_CHANGED');
    else {
      need(!(await exists(target)), 'RUNTIME_TRANSFER_NEW_RUNTIME_REQUIRED');
      record = { schema: 'stellar-forge.runtime-transfer-installation.v1', binding,
        phase: 'PREPARING', createdAt: now(), runtime: manifest.runtime };
      await saveJSON(recordPath, record);
    }
    const received = await validateReceivedFiles(root, manifest, signal);
    let result;
    if (recoverFrom && !(await exists(target))) {
      const originalReceipt = await readRecord(join(receiptRoot, digest(resolve(recoverFrom)) + '.json'), true);
      if (originalReceipt) need(originalReceipt.binding.manifestSha256 === state.manifestSha256 &&
        equal(originalReceipt.runtime, manifest.runtime), 'RUNTIME_TRANSFER_RECOVERY_SOURCE_MISMATCH');
      else {
        const previous = await inspectRuntimeInstall({ directory: resolve(recoverFrom), load: false });
        need(previous.installationId === manifest.runtime.installationId && previous.profileId === manifest.runtime.profileId &&
          previous.sourceCommit === manifest.runtime.sourceCommit, 'RUNTIME_TRANSFER_RECOVERY_SOURCE_MISMATCH');
      }
      result = await recoverRuntime({ from: resolve(recoverFrom), directory: target, offline: true,
        cache: join(root, 'cache'), npm, python, nodeHeaders, install: false });
    } else if (!(await exists(target))) {
      result = await prepareRuntimeInstall({ directory: target, archive: join(received.filesRoot, 'source.tgz'),
        sha256: manifest.runtime.archiveSha256, ...received.profile.selection, python });
    }
    // An interrupted preparation keeps its original files. Its own recover operation,
    // into another new directory, is the supported continuation if no plan was committed.
    let observed;
    try { observed = await inspectRuntimeInstall({ directory: target, load: false }); }
    catch (error) {
      record = { ...record, phase: 'PREPARATION_INTERRUPTED', error: { code: error.code ?? 'RUNTIME_INSTALL_INSPECTION_FAILED' } };
      await saveJSON(recordPath, record, true);
      throw fail('RUNTIME_TRANSFER_PREPARATION_INTERRUPTED',
        'Use runtime-transfer recover with this retained runtime as --from and a new --runtime directory');
    }
    need(observed.installationId === manifest.runtime.installationId &&
      observed.profileId === manifest.runtime.profileId && observed.sourceCommit === manifest.runtime.sourceCommit,
    'RUNTIME_TRANSFER_INSTALL_IDENTITY_MISMATCH');
    const retainedLock = await smallFile(join(received.filesRoot, 'package-lock.json'), 16 * 1024 * 1024);
    await immutableBytes(join(target, 'package-lock.json'), retainedLock);
    record = { ...record, phase: 'PREPARED', preparedAt: record.preparedAt ?? now(), error: null };
    await saveJSON(recordPath, record, true);
    await onProgress({ phase: 'PREPARED', runtimeDirectory: target });
    if (install) {
      record = { ...record, phase: 'INSTALLING' }; await saveJSON(recordPath, record, true);
      result = await installRuntime({ directory: target, offline: true, cache: join(root, 'cache'), npm, nodeHeaders });
      observed = await inspectRuntimeInstall({ directory: target, load: true, source: true });
      need(observed.status === 'READY' && observed.ready && observed.lockSha256 === manifest.runtime.lockSha256,
        'RUNTIME_TRANSFER_INSTALLED_READBACK_MISMATCH');
      record = { ...record, phase: 'READY', completedAt: now(), inspection: observed };
    } else record = { ...record, phase: 'PREPARED' };
    await saveJSON(recordPath, record, true);
    const installations = [...new Set([...(state.installations ?? []), digest(target)])];
    await saveState(root, { ...state, installations });
    return { status: record.phase, transferId: manifest.transferId, manifestSha256: state.manifestSha256,
      runtimeDirectory: target, record, result: result ?? observed };
  } catch (error) {
    if (record) await saveJSON(recordPath, { ...record, error: { code: error.code ?? 'RUNTIME_TRANSFER_INSTALL_FAILED', at: now() } }, true).catch(() => {});
    throw error;
  } finally { await lease.close(); }
}
