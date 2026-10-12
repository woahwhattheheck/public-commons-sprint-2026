// MIT. Portable application continuity over the original merchant snapshot and job lease.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir, readlink, symlink, rename, unlink, rm, chmod } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, posix, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openJobStore } from '../../sf30-seller-sdk/jobs/store.mjs';
import { compileJobMerchant, canonical, digest, plain, jobError, JOB_ID, HASH } from '../../sf30-seller-sdk/jobs/config.mjs';
import { readApplication, parseApplicationProfile, applicationFromSources, readPrivateFile, jsonBytes } from './configuration.mjs';
import { validateExecution } from './worker.mjs';
import { run as encryptedRecovery } from '../../sf101-merchant-recovery/recover.mjs';

export const SNAPSHOT_SCHEMA = 'stellar-forge.sf101.api-application-snapshot.v1';
export const RESTORATION_SCHEMA = 'stellar-forge.sf101.api-application-restoration.v1';
export const BINDING_SCHEMA = 'stellar-forge.sf101.api-application-execution-binding.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const SNAPSHOT_FILE = 'application-snapshot.json';
const MAX_ENTRIES = 9500, MAX_FILE = 2 * 1024 ** 3, MAX_TOTAL = 4 * 1024 ** 3;
const MAX_MANIFEST = 12 * 1024 ** 2, CHUNK = 1024 * 1024;
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCELLING']);
const fail = (code, status = 409) => { throw jobError(code, status); };
const inside = (root, path) => path === root || path.startsWith(root + sep);
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = bytes => JSON.parse(decode(bytes));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const entryKey = entry => entry.root + '\0' + entry.path;
const stamp = info => [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeNs, info.ctimeNs].join(':');
const bridgePath = fileURLToPath(new URL('./recovery-bridge.py', import.meta.url));

function safeRelative(value, empty = false) {
  return typeof value === 'string' && value.length <= 2048 &&
    (empty && value === '' || value.length > 0 && !value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value) &&
      value.split('/').every(part => part && part !== '.' && part !== '..'));
}
function safeLink(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    !isAbsolute(value) && !value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value);
}
async function directory(path, { privateMode = false } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === '/')
    fail('APP_RECOVERY_ABSOLUTE_DIRECTORY_REQUIRED', 400);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
      privateMode && info.mode & 0o077) fail('APP_RECOVERY_REAL_DIRECTORY_REQUIRED', 400);
  return path;
}
async function newDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === '/')
    fail('APP_RECOVERY_NEW_DIRECTORY_REQUIRED', 400);
  await directory(dirname(path));
  await mkdir(path, { mode: 0o700 });
  try { await chmod(path, 0o700); } catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeNew(path, bytes, mode = 0o600) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function streamFile(path, destination = null, { max = MAX_FILE, privateMode = false, expected } = {}) {
  const named = await lstat(path, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.size > BigInt(max) ||
      privateMode && (named.mode & 0o077n || named.nlink !== 1n))
    fail('APP_RECOVERY_REGULAR_FILE_REQUIRED');
  const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output = null;
  const hash = createHash('sha256'); let bytes = 0;
  try {
    const before = await source.stat({ bigint: true });
    if (stamp(before) !== stamp(named)) fail('APP_RECOVERY_SOURCE_CHANGED');
    if (destination) output = await open(destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > max) fail('APP_RECOVERY_FILE_TOO_LARGE', 413);
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk); if (output) await output.writeFile(chunk);
    }
    if (stamp(await source.stat({ bigint: true })) !== stamp(before) ||
        stamp(await lstat(path, { bigint: true })) !== stamp(before) || bytes !== Number(before.size))
      fail('APP_RECOVERY_SOURCE_CHANGED');
    const result = { sha256: hash.digest('hex'), bytes, mode: before.mode & 0o111n ? 0o700 : 0o600,
      sourceStamp: stamp(before) };
    if (expected && (result.sha256 !== expected.sha256 || result.bytes !== expected.bytes))
      fail('APP_RECOVERY_CONTENT_CHANGED');
    if (output) await output.sync();
    return result;
  } finally { await output?.close(); await source.close(); }
}
/** C94 remains the only merchant database snapshot/restore implementation. */
export function merchantRecovery(action, values, { python } = {}) {
  const body = jsonBytes(values);
  if (body.length > MAX_MANIFEST) return Promise.reject(jobError('APP_RECOVERY_INPUT_TOO_LARGE', 413));
  return new Promise((accept, reject) => {
    let child, out = [], err = [], outBytes = 0, errBytes = 0, failure = null;
    try {
      child = spawn(python || process.env.STARFORGE_PYTHON || process.env.PYTHON || 'python3',
        [bridgePath, action], { stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      // Large native SQLite/file snapshots run to their original completion. A
      // caller receives a result only after the owned subprocess has exited.
      child.on('error', () => { failure = jobError('APP_MERCHANT_RECOVERY_UNAVAILABLE', 503); });
      child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        outBytes += chunk.length;
        if (outBytes > MAX_MANIFEST) { failure = jobError('APP_RECOVERY_REPLY_TOO_LARGE', 503); child.kill('SIGKILL'); }
        else out.push(chunk);
      });
      child.stderr.on('data', chunk => {
        errBytes += chunk.length;
        if (errBytes > 262144) { failure = jobError('APP_RECOVERY_REPLY_TOO_LARGE', 503); child.kill('SIGKILL'); }
        else err.push(chunk);
      });
      child.once('close', code => {
        if (failure) { reject(failure); return; }
        try {
          const value = json(Buffer.concat(code === 0 ? out : err));
          if (code !== 0) {
            const safe = /^[A-Z][A-Z0-9_]{1,100}$/.test(value.error ?? '') ? value.error : 'APP_MERCHANT_RECOVERY_FAILED';
            reject(jobError(safe, 409)); return;
          }
          accept(value);
        } catch { reject(jobError('APP_MERCHANT_RECOVERY_UNAVAILABLE', 503)); }
      });
      child.stdin.end(body);
    } catch { child?.kill('SIGKILL'); reject(jobError('APP_MERCHANT_RECOVERY_UNAVAILABLE', 503)); }
  });
}
function normalizeBindings(bindings, dataRoots, environment) {
  if (!Array.isArray(bindings) || bindings.length > 64) fail('APP_RECOVERY_ENVIRONMENT_BINDINGS_REQUIRED', 400);
  const roots = new Set(dataRoots.map(root => 'data-' + root.name)), seen = new Set();
  return bindings.map(item => {
    const path = item.path === '.' ? '' : item.path ?? '';
    const root = item.dataRoot !== undefined ? 'data-' + item.dataRoot : item.root;
    if (!plain(item) || typeof item.environment !== 'string' || !environment.includes(item.environment) ||
        seen.has(item.environment) || !roots.has(root) || !safeRelative(path, true))
      fail('APP_RECOVERY_ENVIRONMENT_BINDING_INVALID', 400);
    seen.add(item.environment);
    return { environment: item.environment, root, path };
  }).sort((a, b) => compare(a.environment, b.environment));
}
function capturePaths(runtime) {
  return runtime.captureFiles ?? { profile: runtime.profilePath, gateway: runtime.profile.gateway,
    key: runtime.profile.key, merchant: runtime.profile.merchant };
}
async function capturedObject(snapshot, entry, max = MAX_FILE) {
  const path = join(snapshot, 'objects', entry.sha256 + '.bin');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.nlink !== 1)
    fail('APP_RECOVERY_OBJECT_REQUIRED');
  const bytes = await readPrivateFile(path, max);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail('APP_RECOVERY_CONTENT_CHANGED');
  return bytes;
}
function manifestEntries(manifest) {
  if (!plain(manifest) || manifest.schema !== SNAPSHOT_SCHEMA ||
      typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
      !HASH.test(manifest.profileSha256 ?? '') || !HASH.test(manifest.gatewaySha256 ?? '') ||
      !plain(manifest.source) || !HASH.test(manifest.source.configSha256 ?? '') ||
      !HASH.test(manifest.source.applicationSha256 ?? '') ||
      typeof manifest.source.application !== 'string' || !isAbsolute(manifest.source.application) ||
      !plain(manifest.application) || !safeRelative(manifest.application.entry) ||
      !Array.isArray(manifest.roots) || manifest.roots.length < 3 || manifest.roots.length > 19 ||
      !Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRIES ||
      !Array.isArray(manifest.environmentBindings) || manifest.environmentBindings.length > 64 ||
      !plain(manifest.merchant) || !HASH.test(manifest.merchant.manifestSha256 ?? '') ||
      !HASH.test(manifest.merchant.databaseSha256 ?? '') ||
      !HASH.test(manifest.encryptionPlanSha256 ?? ''))
    fail('APP_RECOVERY_MANIFEST_INVALID');
  const roots = new Map();
  for (const item of manifest.roots) {
    if (!plain(item) || typeof item.id !== 'string' || roots.has(item.id) ||
        !['original', 'native', 'application', 'data'].includes(item.kind) ||
        (item.kind === 'data' ? !NAME.test(item.name ?? '') || item.id !== 'data-' + item.name : item.id !== item.kind))
      fail('APP_RECOVERY_ROOT_INVALID');
    roots.set(item.id, item);
  }
  if (!['original', 'native', 'application'].every(id => roots.get(id)?.kind === id)) fail('APP_RECOVERY_ROOT_INVALID');
  const entries = new Map(); let bytes = 0;
  for (const entry of manifest.entries) {
    if (!plain(entry) || !roots.has(entry.root) || !safeRelative(entry.path, true) ||
        !['directory', 'file', 'symlink'].includes(entry.kind) || entries.has(entryKey(entry)) ||
        entry.path === '' && entry.kind !== 'directory')
      fail('APP_RECOVERY_ENTRY_INVALID');
    if (entry.kind === 'file') {
      if (!HASH.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 || entry.bytes > MAX_FILE || ![0o600, 0o700].includes(entry.mode))
        fail('APP_RECOVERY_FILE_INVALID');
      bytes += entry.bytes;
    }
    if (entry.kind === 'symlink' &&
        (!['application', 'data'].includes(roots.get(entry.root).kind) || !safeLink(entry.target)))
      fail('APP_RECOVERY_LINK_INVALID');
    entries.set(entryKey(entry), entry);
  }
  if (bytes > MAX_TOTAL) fail('APP_RECOVERY_TOTAL_TOO_LARGE', 413);
  for (const id of roots.keys()) if (entries.get(id + '\0')?.kind !== 'directory') fail('APP_RECOVERY_ROOT_MISSING');
  for (const entry of entries.values()) {
    const parts = entry.path.split('/').filter(Boolean);
    for (let count = 0; count < parts.length; count++)
      if (entries.get(entry.root + '\0' + parts.slice(0, count).join('/'))?.kind !== 'directory')
        fail('APP_RECOVERY_PARENT_INVALID');
  }
  function resolved(root, path, chain = new Set()) {
    if (!safeRelative(path, true)) fail('APP_RECOVERY_LINK_ESCAPES_ROOT');
    const parts = path.split('/').filter(Boolean);
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join('/'), item = entries.get(root + '\0' + prefix);
      if (!item) fail('APP_RECOVERY_LINK_TARGET_MISSING');
      if (item.kind === 'symlink') {
        const key = entryKey(item);
        if (chain.size >= 64 || chain.has(key)) fail('APP_RECOVERY_LINK_CYCLE');
        const next = new Set(chain); next.add(key);
        const target = posix.normalize(posix.join(posix.dirname(prefix), item.target, ...parts.slice(count)));
        return resolved(root, target === '.' ? '' : target, next);
      }
      if (count < parts.length && item.kind !== 'directory') fail('APP_RECOVERY_LINK_TARGET_INVALID');
    }
    return entries.get(root + '\0' + path);
  }
  for (const entry of entries.values()) if (entry.kind === 'symlink') resolved(entry.root, entry.path);
  if (entries.get('application\0' + manifest.application.entry)?.kind !== 'file' ||
      entries.get('application\0' + manifest.application.entry).sha256 !== manifest.source.applicationSha256)
    fail('APP_RECOVERY_APPLICATION_ENTRY_CHANGED');
  return { roots, entries, logicalBytes: bytes, resolved };
}
async function logicalRuntime(snapshot, manifest, entries, reader = (entry, max) => capturedObject(snapshot, entry, max)) {
  const get = async (name, max = 1048576) => {
    const item = entries.get('original\0' + name);
    if (item?.kind !== 'file') fail('APP_RECOVERY_ORIGINAL_SOURCE_MISSING');
    return reader(item, max);
  };
  const profileBytes = await get('application.json'), profile = parseApplicationProfile(profileBytes);
  const configBytes = await get('merchant.json'), gatewayBytes = await get('gateway.json');
  const keyBytes = await get('application.key', 256);
  const applicationBytes = await reader(entries.get('application\0' + manifest.application.entry), 4194304);
  const raw = json(configBytes), compiled = compileJobMerchant(raw, { baseDir: dirname(profile.merchant) });
  if (canonical(profile.source) !== canonical(manifest.source) ||
      compiled.publicOrigin !== profile.source.publicOrigin) fail('APP_RECOVERY_SOURCE_IDENTITY_CHANGED');
  const source = { configPath: profile.merchant, raw, compiled, identity: profile.source,
    configSource: configBytes.toString('utf8'), applicationSource: decode(applicationBytes) };
  const runtime = applicationFromSources(profile.merchant, profileBytes, source, gatewayBytes, keyBytes.toString('ascii').trim());
  if (runtime.profileSha256 !== manifest.profileSha256 || runtime.profile.gatewaySha256 !== manifest.gatewaySha256)
    fail('APP_RECOVERY_LOGICAL_PROFILE_CHANGED');
  const originalNames = [...entries.values()].filter(entry => entry.root === 'original' && entry.kind === 'file').map(entry => entry.path).sort();
  if (canonical(originalNames) !== canonical(['application.json', 'application.key', 'gateway.json', 'merchant.json']))
    fail('APP_RECOVERY_ORIGINAL_FILES_CHANGED');
  const dataRoots = manifest.roots.filter(root => root.kind === 'data').map(root => ({ name: root.name }));
  if (canonical(normalizeBindings(manifest.environmentBindings, dataRoots, compiled.environment)) !== canonical(manifest.environmentBindings))
    fail('APP_RECOVERY_ENVIRONMENT_BINDING_INVALID');
  return runtime;
}
async function readImage(snapshot) {
  snapshot = await directory(resolve(snapshot), { privateMode: true });
  const info = await lstat(join(snapshot, SNAPSHOT_FILE));
  if (info.mode & 0o077) fail('APP_RECOVERY_MANIFEST_MUST_BE_PRIVATE');
  const manifestBytes = await readPrivateFile(join(snapshot, SNAPSHOT_FILE), MAX_MANIFEST);
  const manifest = json(manifestBytes), indexes = manifestEntries(manifest);
  await directory(join(snapshot, 'objects'), { privateMode: true });
  return { snapshot, manifest, manifestBytes, manifestSha256: digest(manifestBytes), ...indexes };
}
async function verifyObjects(image) {
  const expected = new Map();
  for (const entry of image.entries.values()) if (entry.kind === 'file') {
    if (expected.has(entry.sha256) && expected.get(entry.sha256) !== entry.bytes) fail('APP_RECOVERY_OBJECT_CONFLICT');
    expected.set(entry.sha256, entry.bytes);
  }
  const names = (await readdir(join(image.snapshot, 'objects'))).sort();
  if (canonical(names) !== canonical([...expected.keys()].map(hash => hash + '.bin').sort()))
    fail('APP_RECOVERY_OBJECT_CLOSURE_CHANGED');
  let bytes = 0;
  for (const [sha256, size] of expected) {
    await streamFile(join(image.snapshot, 'objects', sha256 + '.bin'), null,
      { privateMode: true, expected: { sha256, bytes: size } });
    bytes += size;
  }
  return { objects: expected.size, bytes };
}
async function nativeFacts(image, runtime) {
  const sourceEntry = image.entries.get('native\0source.json');
  const configEntry = image.entries.get('native\0config-source.json');
  const applicationEntry = image.entries.get('native\0application-source.mjs');
  if (sourceEntry?.kind !== 'file' || configEntry?.kind !== 'file' || applicationEntry?.kind !== 'file' ||
      configEntry.sha256 !== runtime.source.identity.configSha256 ||
      applicationEntry.sha256 !== runtime.source.identity.applicationSha256)
    fail('APP_RECOVERY_NATIVE_SOURCE_MISSING');
  const retained = json(await capturedObject(image.snapshot, sourceEntry, 2097152));
  if (retained.schema !== 'stellar-forge.job-merchant-state.v1' ||
      canonical(retained.source) !== canonical(runtime.source.identity) ||
      retained.configPath !== runtime.source.configPath || canonical(retained.configuration) !== canonical(runtime.source.raw))
    fail('APP_RECOVERY_NATIVE_SOURCE_CHANGED');
  for (const entry of image.entries.values()) if (entry.root === 'native') {
    const valid = entry.kind === 'directory' && ['', 'records', 'results'].includes(entry.path) ||
      entry.kind === 'file' && (['source.json', 'config-source.json', 'application-source.mjs'].includes(entry.path) ||
        /^records\/[A-Za-z0-9][A-Za-z0-9._:-]{0,79}\.json$/.test(entry.path) ||
        /^results\/[a-f0-9]{64}\.bin$/.test(entry.path) && entry.path === 'results/' + entry.sha256 + '.bin');
    if (!valid) fail('APP_RECOVERY_NATIVE_LAYOUT_CHANGED');
  }
  const records = [...image.entries.values()].filter(entry => entry.root === 'native' && entry.path.startsWith('records/'));
  const counts = {}; let retainedResultBytes = 0, unresolvedExecutions = 0;
  const ids = new Set();
  for (const entry of records) {
    if (entry.kind !== 'file' || !/^records\/[A-Za-z0-9][A-Za-z0-9._:-]{0,79}\.json$/.test(entry.path))
      fail('APP_RECOVERY_NATIVE_RECORD_INVALID');
    const row = json(await capturedObject(image.snapshot, entry, 2097152));
    validateExecution(runtime, row);
    if (!JOB_ID.test(row.id ?? '') || row.id + '.json' !== posix.basename(entry.path) ||
        row.schema !== 'stellar-forge.application-job.v1' || ids.has(row.id) ||
        canonical(row.source) !== canonical(runtime.source.identity) || digest(canonical(row.input)) !== row.inputSha256)
      fail('APP_RECOVERY_NATIVE_RECORD_CHANGED');
    ids.add(row.id); counts[row.state] = (counts[row.state] || 0) + 1;
    if (ACTIVE.has(row.state)) unresolvedExecutions++;
    if (row.result) {
      const body = image.entries.get('native\0results/' + row.result.file);
      if (body?.kind !== 'file' || body.sha256 !== row.result.sha256 || body.bytes !== row.result.bytes)
        fail('APP_RECOVERY_NATIVE_RESULT_MISSING');
      retainedResultBytes += row.result.bytes;
    }
  }
  return { executions: records.length, counts, retainedResultBytes, interruptedOnStart: unresolvedExecutions };
}
/** Inspect exact bytes without opening or normalizing the native queue. */
export async function inspectApplicationSnapshot(snapshot, options = {}) {
  const image = await readImage(snapshot), objects = await verifyObjects(image);
  if (canonical((await readdir(image.snapshot)).sort()) !== canonical([SNAPSHOT_FILE, 'encryption-plan.json', 'merchant', 'objects'].sort()))
    fail('APP_RECOVERY_IMAGE_CLOSURE_CHANGED');
  const runtime = await logicalRuntime(image.snapshot, image.manifest, image.entries);
  const native = await nativeFacts(image, runtime);
  const merchant = await merchantRecovery('inspect', { snapshot: image.snapshot }, options);
  const planBytes = await readPrivateFile(join(image.snapshot, 'encryption-plan.json'), 262144);
  if (digest(planBytes) !== image.manifest.encryptionPlanSha256) fail('APP_RECOVERY_ENCRYPTION_PLAN_CHANGED');
  if (merchant.manifestSha256 !== image.manifest.merchant.manifestSha256 ||
      merchant.databaseSha256 !== image.manifest.merchant.databaseSha256)
    fail('APP_RECOVERY_MERCHANT_SNAPSHOT_CHANGED');
  const totalBytes = objects.bytes + merchant.imageBytes + image.manifestBytes.length + planBytes.length;
  // The completed image is one ordinary immutable root of the original encrypted engine.
  if (totalBytes > MAX_TOTAL || objects.objects + merchant.imageEntries + 4 > 10000)
    fail('APP_RECOVERY_ENCRYPTED_ENGINE_LIMIT', 413);
  return { schema: SNAPSHOT_SCHEMA, snapshot: image.snapshot, manifestSha256: image.manifestSha256,
    createdAt: image.manifest.createdAt, source: runtime.source.identity, profileSha256: runtime.profileSha256,
    application: image.manifest.application, dataRoots: image.manifest.roots.filter(root => root.kind === 'data').map(root => root.name),
    environmentBindings: image.manifest.environmentBindings, native, merchant, objects: objects.objects, bytes: totalBytes,
    encryptionPlan: join(image.snapshot, 'encryption-plan.json') };
}
/** The original job store lease fixes execution state until the image is complete. */
export async function snapshotApplication(runtime, { directory: destination, applicationRoot,
    dataRoots, environmentBindings, python } = {}) {
  destination = resolve(destination);
  applicationRoot = applicationRoot ?? runtime.recoveryApplicationRoot;
  if (typeof applicationRoot !== 'string' || !applicationRoot) fail('APP_RECOVERY_APPLICATION_ROOT_REQUIRED', 400);
  applicationRoot = await directory(resolve(applicationRoot));
  dataRoots = dataRoots ?? runtime.recoveryDataRoots ?? [];
  environmentBindings = environmentBindings ?? runtime.recoveryEnvironmentBindings ?? [];
  if (!Array.isArray(dataRoots) || dataRoots.length > 16) fail('APP_RECOVERY_DATA_ROOTS_REQUIRED', 400);
  const selected = [], names = new Set();
  for (const item of dataRoots) {
    if (!plain(item) || !NAME.test(item.name ?? '') || names.has(item.name)) fail('APP_RECOVERY_DATA_ROOT_INVALID', 400);
    names.add(item.name); selected.push({ name: item.name, path: await directory(resolve(item.path)) });
  }
  const roots = [applicationRoot, ...selected.map(item => item.path)];
  for (let first = 0; first < roots.length; first++) {
    if (inside(roots[first], destination) || inside(destination, roots[first]) ||
        inside(roots[first], runtime.profile.store) || inside(runtime.profile.store, roots[first]) ||
        inside(roots[first], runtime.gateway.state) || inside(runtime.gateway.state, roots[first]))
      fail('APP_RECOVERY_SOURCE_OVERLAP', 400);
    for (let second = 0; second < first; second++)
      if (inside(roots[first], roots[second]) || inside(roots[second], roots[first])) fail('APP_RECOVERY_SOURCE_OVERLAP', 400);
  }
  if (inside(runtime.profile.store, destination) || inside(destination, runtime.profile.store) ||
      inside(runtime.gateway.state, destination) || inside(destination, runtime.gateway.state))
    fail('APP_RECOVERY_SOURCE_OVERLAP', 400);
  const physicalEntry = runtime.executionSource?.identity.application ?? runtime.source.identity.application;
  const entryPath = relative(applicationRoot, physicalEntry).split(sep).join('/');
  if (!safeRelative(entryPath) || !inside(applicationRoot, physicalEntry)) fail('APP_RECOVERY_APPLICATION_ROOT_REQUIRED', 400);
  const bindings = normalizeBindings(environmentBindings, selected, runtime.source.compiled.environment);
  const files = capturePaths(runtime);
  for (const path of Object.values(files)) if (inside(destination, resolve(path))) fail('APP_RECOVERY_SOURCE_OVERLAP', 400);
  const store = await openJobStore(runtime.profile.store, runtime.source);
  let created = false;
  try {
    const rows = store.rows();
    for (const row of rows) {
      validateExecution(runtime, row);
      if (row.result) await store.readResult(row.result);
    }
    await newDirectory(destination); created = true;
    const objectDirectory = join(destination, 'objects');
    await mkdir(objectDirectory, { mode: 0o700 });
    const entries = [], objects = new Map(), observed = new Map(); let logicalBytes = 0;
    const add = entry => {
      if (entries.length >= MAX_ENTRIES) fail('APP_RECOVERY_ENTRY_LIMIT', 413);
      if (entry.kind === 'file') { logicalBytes += entry.bytes; if (logicalBytes > MAX_TOTAL) fail('APP_RECOVERY_TOTAL_TOO_LARGE', 413); }
      entries.push(entry); return entry;
    };
    function observe(path, marker) {
      if (observed.has(path) && observed.get(path) !== marker) fail('APP_RECOVERY_SOURCE_CHANGED');
      observed.set(path, marker);
    }
    async function file(path, root, relativePath, expectedSha256) {
      if (!safeRelative(relativePath)) fail('APP_RECOVERY_ENTRY_INVALID');
      const temporary = join(objectDirectory, '.capture-' + randomUUID());
      try {
        const value = await streamFile(path, temporary);
        if (expectedSha256 && value.sha256 !== expectedSha256) fail('APP_RECOVERY_SOURCE_CHANGED');
        observe(path, value.sourceStamp);
        if (objects.has(value.sha256)) {
          if (objects.get(value.sha256) !== value.bytes) fail('APP_RECOVERY_OBJECT_CONFLICT');
          await unlink(temporary);
        } else {
          await rename(temporary, join(objectDirectory, value.sha256 + '.bin'));
          objects.set(value.sha256, value.bytes);
        }
        return add({ root, path: relativePath, kind: 'file', sha256: value.sha256, bytes: value.bytes, mode: value.mode });
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    async function tree(sourceRoot, root, relativePath = '', allowLinks = true, depth = 0) {
      if (depth > 128 || !safeRelative(relativePath, true)) fail('APP_RECOVERY_SOURCE_DEPTH', 413);
      const path = relativePath ? join(sourceRoot, ...relativePath.split('/')) : sourceRoot;
      const info = await lstat(path, { bigint: true });
      if (info.isSymbolicLink()) {
        if (!allowLinks) fail('APP_RECOVERY_NATIVE_LINK_INVALID');
        const target = await readlink(path);
        if (!safeLink(target) || !inside(sourceRoot, resolve(dirname(path), target)) ||
            !inside(sourceRoot, await realpath(path))) fail('APP_RECOVERY_LINK_ESCAPES_ROOT');
        observe(path, stamp(info)); add({ root, path: relativePath, kind: 'symlink', target }); return;
      }
      if (info.isFile()) { await file(path, root, relativePath); return; }
      if (!info.isDirectory()) fail('APP_RECOVERY_SOURCE_TYPE_UNSUPPORTED');
      observe(path, stamp(info)); add({ root, path: relativePath, kind: 'directory' });
      for (const name of (await readdir(path)).sort()) {
        if (!safeRelative(name) || name.includes('/')) fail('APP_RECOVERY_ENTRY_INVALID');
        await tree(sourceRoot, root, relativePath ? relativePath + '/' + name : name, allowLinks, depth + 1);
      }
    }
    add({ root: 'original', path: '', kind: 'directory' });
    await file(files.profile, 'original', 'application.json', runtime.profileSha256);
    await file(files.gateway, 'original', 'gateway.json', runtime.profile.gatewaySha256);
    await file(files.merchant, 'original', 'merchant.json', runtime.source.identity.configSha256);
    await file(files.key, 'original', 'application.key');
    add({ root: 'native', path: '', kind: 'directory' });
    for (const name of ['source.json', 'config-source.json', 'application-source.mjs'])
      await file(join(runtime.profile.store, name), 'native', name);
    for (const name of ['records', 'results']) {
      observe(join(runtime.profile.store, name), stamp(await lstat(join(runtime.profile.store, name), { bigint: true })));
      add({ root: 'native', path: name, kind: 'directory' });
    }
    for (const row of [...rows].sort((a, b) => compare(a.id, b.id)))
      await file(join(runtime.profile.store, 'records', row.id + '.json'), 'native', 'records/' + row.id + '.json');
    // Named immutable result files are native state, including results retained
    // before an interrupted row commit. Temporary writer files are not state.
    for (const name of (await readdir(store.resultDirectory)).sort()) {
      if (!/^[a-f0-9]{64}\.bin$/.test(name)) continue;
      await file(join(store.resultDirectory, name), 'native', 'results/' + name, name.slice(0, -4));
    }
    await tree(applicationRoot, 'application');
    for (const item of selected) await tree(item.path, 'data-' + item.name);
    const merchant = await merchantRecovery('snapshot', { state: runtime.gateway.state, destination: join(destination, 'merchant') }, { python });
    // Source/data owners have stopped their writers. This also detects a file,
    // directory membership or link changing across the common capture cutoff.
    for (const [path, marker] of observed)
      if (stamp(await lstat(path, { bigint: true })) !== marker) fail('APP_RECOVERY_SOURCE_CHANGED');
    const retainedRows = store.rows();
    if (retainedRows.length !== rows.length || retainedRows.some((row, index) => row.id !== rows[index].id || row.revision !== rows[index].revision))
      fail('APP_RECOVERY_NATIVE_STATE_CHANGED');
    const encryptionPlan = jsonBytes({ schema: PLAN_SCHEMA, roots: [{ name: 'application', path: destination }] });
    await writeNew(join(destination, 'encryption-plan.json'), encryptionPlan);
    const manifest = { schema: SNAPSHOT_SCHEMA, createdAt: new Date().toISOString(),
      profileSha256: runtime.profileSha256, gatewaySha256: runtime.profile.gatewaySha256, source: runtime.source.identity,
      application: { sourceRoot: applicationRoot, entry: entryPath, logicalEntry: runtime.source.identity.application },
      roots: [{ id: 'original', kind: 'original' }, { id: 'native', kind: 'native' },
        { id: 'application', kind: 'application', sourcePath: applicationRoot },
        ...selected.map(item => ({ id: 'data-' + item.name, kind: 'data', name: item.name, sourcePath: item.path }))],
      environmentBindings: bindings, merchant, encryptionPlanSha256: digest(encryptionPlan),
      capture: { writer: 'original-openJobStore-lease', nativeRows: rows.length, databaseCutoffAt: merchant.createdAt,
        previousRestorationSha256: runtime.executionBinding?.restorationSha256 ?? null },
      entries: entries.sort((a, b) => compare(entryKey(a), entryKey(b))) };
    const manifestBytes = jsonBytes(manifest);
    if (manifestBytes.length > MAX_MANIFEST) fail('APP_RECOVERY_MANIFEST_TOO_LARGE', 413);
    manifestEntries(manifest);
    await writeNew(join(destination, SNAPSHOT_FILE), manifestBytes);
    await syncDirectory(objectDirectory); await syncDirectory(destination);
    const result = await inspectApplicationSnapshot(destination, { python });
    await syncDirectory(dirname(destination));
    return result;
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { await store.close(); }
}

function materializedRoots(root, manifest) {
  const paths = new Map([['original', join(root, 'original')], ['native', join(root, 'executions')],
    ['application', join(root, 'application')]]);
  for (const item of manifest.roots) if (item.kind === 'data') paths.set(item.id, join(root, 'data', item.name));
  return paths;
}
const materializedPath = (roots, entry) => entry.path ? join(roots.get(entry.root), ...entry.path.split('/')) : roots.get(entry.root);
async function readMaterialized(roots, entry, max) {
  const path = materializedPath(roots, entry), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.nlink !== 1)
    fail('APP_RESTORED_SOURCE_FILE_REQUIRED');
  const bytes = await readPrivateFile(path, max);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail('APP_RESTORED_SOURCE_CHANGED');
  return bytes;
}
async function verifyMaterialized(image, roots, selected) {
  const children = new Map();
  for (const entry of image.entries.values()) {
    if (!selected.has(entry.root) || entry.path === '') continue;
    const parent = posix.dirname(entry.path);
    const key = entry.root + '\0' + (parent === '.' ? '' : parent);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(posix.basename(entry.path));
  }
  for (const names of children.values()) names.sort();
  for (const entry of image.entries.values()) {
    if (!selected.has(entry.root)) continue;
    const path = materializedPath(roots, entry);
    const info = await lstat(path);
    if (entry.kind === 'directory') {
      await directory(path, { privateMode: true });
      const expected = children.get(entryKey(entry)) ?? [];
      if (canonical((await readdir(path)).sort()) !== canonical(expected)) fail('APP_RESTORED_SOURCE_CLOSURE_CHANGED');
    } else if (entry.kind === 'file') {
      if ((info.mode & 0o111 ? 0o700 : 0o600) !== entry.mode) fail('APP_RESTORED_SOURCE_MODE_CHANGED');
      await streamFile(path, null, { privateMode: true, expected: entry });
    } else {
      if (!info.isSymbolicLink() || await readlink(path) !== entry.target ||
          !inside(roots.get(entry.root), await realpath(path))) fail('APP_RESTORED_LINK_CHANGED');
    }
  }
}
async function environmentPath(root, suffix) {
  const path = suffix ? join(root, ...suffix.split('/')) : root;
  let existing = path;
  for (;;) {
    try {
      if (!inside(root, await realpath(existing))) fail('APP_RESTORED_DATA_PATH_ESCAPES_ROOT');
      return path;
    } catch (error) {
      if (error.code !== 'ENOENT' || existing === root) throw error;
      existing = dirname(existing);
    }
  }
}
/** Original profiles and explicit restored bindings share the same operator API. */
export async function readApplicationRuntime(profilePath) {
  profilePath = resolve(profilePath);
  const descriptorBytes = await readPrivateFile(profilePath, MAX_MANIFEST);
  const descriptor = json(descriptorBytes);
  if (descriptor.schema !== RESTORATION_SCHEMA) return readApplication(profilePath);
  const root = await directory(dirname(profilePath), { privateMode: true });
  if (descriptor.root !== root || descriptor.sourceManifest !== 'source-manifest.json' ||
      !HASH.test(descriptor.snapshotManifestSha256 ?? '') || !HASH.test(descriptor.gatewaySha256 ?? '') ||
      !HASH.test(descriptor.merchantSnapshotSha256 ?? '') || typeof descriptor.restoredAt !== 'string' ||
      !Number.isFinite(Date.parse(descriptor.restoredAt)))
    fail('APP_RESTORATION_DESCRIPTOR_INVALID');
  if ((await lstat(profilePath)).mode & 0o077) fail('APP_RESTORATION_DESCRIPTOR_MUST_BE_PRIVATE');
  const manifestBytes = await readPrivateFile(join(root, descriptor.sourceManifest), MAX_MANIFEST);
  if (digest(manifestBytes) !== descriptor.snapshotManifestSha256) fail('APP_RESTORATION_SOURCE_MANIFEST_CHANGED');
  const manifest = json(manifestBytes), indexes = manifestEntries(manifest), roots = materializedRoots(root, manifest);
  if (descriptor.profileSha256 !== manifest.profileSha256 ||
      canonical(descriptor.source) !== canonical(manifest.source) ||
      descriptor.merchantSnapshotSha256 !== manifest.merchant.manifestSha256)
    fail('APP_RESTORATION_LOGICAL_IDENTITY_CHANGED');
  const image = { manifest, ...indexes };
  await verifyMaterialized(image, roots, new Set(['original', 'application']));
  const runtime = await logicalRuntime(null, manifest, indexes.entries,
    (entry, max) => readMaterialized(roots, entry, max));
  const gatewayBytes = await readPrivateFile(join(root, 'gateway.json'));
  const gateway = json(gatewayBytes);
  if (digest(gatewayBytes) !== descriptor.gatewaySha256 ||
      canonical(gateway) !== canonical({ ...runtime.gateway, state: join(root, 'merchant') }))
    fail('APP_RESTORATION_GATEWAY_CHANGED');
  await directory(join(root, 'merchant'), { privateMode: true });
  await directory(roots.get('native'), { privateMode: true });
  const environmentPaths = Object.create(null);
  for (const item of manifest.roots) if (item.kind === 'data') await directory(roots.get(item.id), { privateMode: true });
  for (const item of manifest.environmentBindings)
    environmentPaths[item.environment] = await environmentPath(roots.get(item.root), item.path);
  const physicalApplication = join(roots.get('application'), ...manifest.application.entry.split('/'));
  const executionBinding = { schema: BINDING_SCHEMA, snapshotManifestSha256: descriptor.snapshotManifestSha256,
    restorationSha256: digest(descriptorBytes), source: runtime.source.identity, application: physicalApplication };
  return { ...runtime, profilePath, logicalProfile: runtime.profile,
    profile: { ...runtime.profile, merchant: join(root, 'original', 'merchant.json'),
      gateway: join(root, 'gateway.json'), key: join(root, 'original', 'application.key'), store: roots.get('native') },
    gateway, executionSource: { ...runtime.source, identity: { ...runtime.source.identity, application: physicalApplication } },
    executionBinding, environmentPaths,
    captureFiles: { profile: join(root, 'original', 'application.json'), gateway: join(root, 'original', 'gateway.json'),
      merchant: join(root, 'original', 'merchant.json'), key: join(root, 'original', 'application.key') },
    recoveryApplicationRoot: roots.get('application'),
    recoveryDataRoots: manifest.roots.filter(item => item.kind === 'data').map(item => ({ name: item.name, path: roots.get(item.id) })),
    recoveryEnvironmentBindings: manifest.environmentBindings };
}
/** Install to a new path; C94 alone rebinds original paid files in SQLite. */
export async function restoreApplication(snapshot, destination, options = {}) {
  snapshot = resolve(snapshot); destination = resolve(destination);
  if (inside(snapshot, destination) || inside(destination, snapshot)) fail('APP_RECOVERY_DESTINATION_OVERLAP', 400);
  const inspected = await inspectApplicationSnapshot(snapshot, options), image = await readImage(snapshot);
  if (image.manifestSha256 !== inspected.manifestSha256) fail('APP_RECOVERY_MANIFEST_CHANGED');
  const runtime = await logicalRuntime(snapshot, image.manifest, image.entries);
  let created = false;
  try {
    await newDirectory(destination); created = true;
    await mkdir(join(destination, 'data'), { mode: 0o700 });
    const roots = materializedRoots(destination, image.manifest);
    const entries = [...image.entries.values()];
    for (const entry of entries.filter(item => item.kind === 'directory').sort((a, b) =>
      a.path.split('/').length - b.path.split('/').length || compare(entryKey(a), entryKey(b))))
      await mkdir(materializedPath(roots, entry), { mode: 0o700 });
    for (const entry of entries) if (entry.kind === 'file') {
      const target = materializedPath(roots, entry);
      await streamFile(join(snapshot, 'objects', entry.sha256 + '.bin'), target, { privateMode: true, expected: entry });
      if (entry.mode === 0o700) await chmod(target, 0o700);
    }
    for (const entry of entries) if (entry.kind === 'symlink')
      await symlink(entry.target, materializedPath(roots, entry));
    await verifyMaterialized(image, roots, new Set(image.manifest.roots.map(item => item.id)));
    const merchant = await merchantRecovery('restore', { snapshot: join(snapshot, 'merchant'),
      destination: join(destination, 'merchant') }, options);
    if (merchant.snapshotManifestSha256 !== image.manifest.merchant.manifestSha256)
      fail('APP_RECOVERY_MERCHANT_SNAPSHOT_CHANGED');
    const gatewayBytes = jsonBytes({ ...runtime.gateway, state: join(destination, 'merchant') });
    await writeNew(join(destination, 'gateway.json'), gatewayBytes);
    await writeNew(join(destination, 'source-manifest.json'), image.manifestBytes);
    const descriptor = { schema: RESTORATION_SCHEMA, root: destination, restoredAt: new Date().toISOString(),
      sourceManifest: 'source-manifest.json', snapshotManifestSha256: image.manifestSha256,
      merchantSnapshotSha256: image.manifest.merchant.manifestSha256,
      gatewaySha256: digest(gatewayBytes), profileSha256: runtime.profileSha256, source: runtime.source.identity };
    const descriptorBytes = jsonBytes(descriptor), profilePath = join(destination, 'application.json');
    await writeNew(profilePath, descriptorBytes);
    const restored = await readApplicationRuntime(profilePath);
    // Opening the original store validates exact immutable rows and source
    // snapshots. Its existing worker, when started, owns interruption recovery.
    const store = await openJobStore(restored.profile.store, restored.source);
    try {
      for (const row of store.rows()) {
        validateExecution(restored, row);
        if (row.result) await store.readResult(row.result);
      }
    } finally { await store.close(); }
    for (const entry of entries.filter(item => item.kind === 'directory').reverse())
      await syncDirectory(materializedPath(roots, entry));
    await syncDirectory(join(destination, 'data')); await syncDirectory(destination); await syncDirectory(dirname(destination));
    return { schema: RESTORATION_SCHEMA, profile: profilePath, state: restored.gateway.state,
      store: restored.profile.store, application: restored.executionSource.identity.application,
      source: restored.source.identity, profileSha256: restored.profileSha256,
      snapshotManifestSha256: image.manifestSha256, restorationSha256: digest(descriptorBytes),
      environmentBindings: image.manifest.environmentBindings, native: inspected.native, merchant };
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

/** Encrypt the completed immutable image with the original merchant engine. */
export async function encryptApplicationSnapshot(snapshot, destination, passEnvironment, options = {}) {
  const inspected = await inspectApplicationSnapshot(snapshot, options);
  destination = resolve(destination);
  if (inside(inspected.snapshot, destination) || inside(destination, inspected.snapshot))
    fail('APP_RECOVERY_DESTINATION_OVERLAP', 400);
  // A decrypted image may live at a different path from its original plan.
  // Bind the original encryptor to the image just inspected, using an owned
  // temporary plan rather than modifying any retained image bytes.
  const planDirectory = join(dirname(destination), '.api-application-plan-' + randomUUID());
  let created = false;
  try {
    await newDirectory(planDirectory); created = true;
    const planPath = join(planDirectory, 'plan.json');
    await writeNew(planPath, jsonBytes({ schema: PLAN_SCHEMA, roots: [{ name: 'application', path: inspected.snapshot }] }));
    const encrypted = await encryptedRecovery(['snapshot', '--plan', planPath,
      '--out', destination, '--pass-env', passEnvironment, '--quiesced']);
    return { ...encrypted, snapshotManifestSha256: inspected.manifestSha256, source: inspected.source };
  } finally { if (created) await rm(planDirectory, { recursive: true, force: true }); }
}
/** Authenticate/decrypt using the original engine, then install the native runtime. */
export async function restoreEncryptedApplication(bundle, destination, passEnvironment, options = {}) {
  destination = resolve(destination); bundle = resolve(bundle);
  const temporary = join(dirname(destination), '.api-application-decrypted-' + randomUUID());
  let created = false;
  try {
    await encryptedRecovery(['restore', '--bundle', bundle, '--out', temporary, '--pass-env', passEnvironment]);
    created = true;
    return await restoreApplication(join(temporary, 'application'), destination, options);
  } finally {
    if (created) await rm(temporary, { recursive: true, force: true });
  }
}
