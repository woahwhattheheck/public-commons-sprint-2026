// MIT. Transfer the original SF101 encrypted files; recover.mjs owns authentication and restore.
import { constants, createWriteStream } from 'node:fs';
import { lstat, realpath, mkdir, readdir, readFile, writeFile, open, rename, unlink, link } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run as recover } from './recover.mjs';
import { acquireDeliveryLease } from '../sf98-merchant-delivery/delivery-lock.mjs';

const OP_SCHEMA = 'stellar-forge.merchant-recovery-transfer.v1';
const REMOTE_SCHEMA = 'stellar-forge.merchant-recovery-remote.v1';
const OWNER_SCHEMA = 'stellar-forge.merchant-recovery-download.v1';
const MAX_MANIFEST = 12 * 1024 ** 2;
const MAX_DESCRIPTOR = 16384;
const MAX_TOTAL = 4 * 1024 ** 3;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const OWNER_FILE = '.sf101-remote.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (root, file) => root === file || file.startsWith(root + '/');
function need(ok, code, message = code) { if (!ok) { const error = new Error(message); error.code = code; throw error; } }
function absolute(value, name) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'INVALID_PATH', 'Use an absolute normalized ' + name);
  return value;
}
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function directory(file, create = false) {
  absolute(file, 'private directory');
  if (create) { try { await mkdir(file, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const st = await lstat(file);
  need(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0 && await realpath(file) === file,
    'PRIVATE_DIRECTORY_REQUIRED', 'Use a real 0700 directory: ' + file);
}
async function bytes(file, maximum = MAX_MANIFEST) {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await fd.stat();
    need(st.isFile() && st.nlink === 1 && st.size <= maximum, 'INVALID_PRIVATE_FILE');
    const value = await fd.readFile(); need(value.length <= maximum, 'FILE_GREW'); return value;
  } finally { await fd.close(); }
}
async function syncDirectory(file) {
  const fd = await open(file, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomicJSON(file, value) {
  const temporary = join(dirname(file), '.sf101-state-' + randomUUID());
  let fd;
  try {
    fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await fd.writeFile(JSON.stringify(value, null, 2) + '\n'); await fd.sync(); await fd.close(); fd = null;
    await rename(temporary, file); await syncDirectory(dirname(file));
  } finally { await fd?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function digestFile(file, expectedBytes, allowedLinks = 1) {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const digest = createHash('sha256'); let size = 0;
  try {
    const st = await fd.stat();
    need(st.isFile() && st.nlink === allowedLinks && (expectedBytes === undefined || st.size === expectedBytes), 'LOCAL_OBJECT_SIZE_CHANGED');
    await pipeline(fd.createReadStream({ autoClose: false }), new Writable({ write(chunk, _encoding, done) {
      size += chunk.length; digest.update(chunk); done();
    } }));
    const after = await fd.stat();
    need((expectedBytes === undefined || size === expectedBytes) && after.size === st.size &&
      after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs, 'LOCAL_OBJECT_SIZE_CHANGED');
    return digest.digest('hex');
  } finally { await fd.close(); }
}
function validateDescriptor(value, snapshot) {
  need(object(value) && value.schema === REMOTE_SCHEMA && HEX.test(value.snapshotId ?? '') &&
    (!snapshot || value.snapshotId === snapshot) && object(value.manifest) &&
    value.manifest.key === `bundles/${value.snapshotId}/manifest.json` && value.manifest.sha256 === value.snapshotId &&
    Number.isSafeInteger(value.manifest.bytes) && value.manifest.bytes > 0 && value.manifest.bytes <= MAX_MANIFEST &&
    Number.isSafeInteger(value.files) && value.files >= 0 && value.files <= 10000 &&
    Number.isSafeInteger(value.plainBytes) && value.plainBytes >= 0 && value.plainBytes <= MAX_TOTAL &&
    Number.isSafeInteger(value.encryptedBytes) && value.encryptedBytes === value.plainBytes &&
    Number.isInteger(value.roots) && value.roots >= 1 && value.roots <= 20 &&
    typeof value.createdAt === 'string' && value.createdAt.length <= 64 && Number.isFinite(Date.parse(value.createdAt)),
    'INVALID_REMOTE_SNAPSHOT', 'Remote snapshot metadata does not match the selected original format');
  return value;
}
function descriptorOf(manifest, raw) {
  const snapshotId = hash(raw);
  return validateDescriptor({ schema: REMOTE_SCHEMA, snapshotId, createdAt: manifest.createdAt,
    manifest: { key: `bundles/${snapshotId}/manifest.json`, bytes: raw.length, sha256: snapshotId },
    files: manifest.fileCount, plainBytes: manifest.totalPlainBytes, encryptedBytes: manifest.totalPlainBytes,
    roots: manifest.roots.length }, snapshotId);
}
// This transport validator only selects bounded ciphertext paths. The original
// recover.mjs authenticates the manifest and every decrypted file before restore.
function membersOf(manifest, descriptor) {
  need(object(manifest) && manifest.schema === 'stellar-forge.merchant-recovery.v1' &&
    Array.isArray(manifest.entries) && manifest.entries.length <= 10000 &&
    manifest.fileCount === descriptor.files && manifest.totalPlainBytes === descriptor.plainBytes,
    'INVALID_REMOTE_MANIFEST');
  const result = []; let total = 0;
  for (const entry of manifest.entries) {
    need(object(entry) && ['file', 'directory'].includes(entry.kind), 'INVALID_REMOTE_ENTRY');
    if (entry.kind === 'directory') continue;
    const name = `objects/${String(result.length + 1).padStart(6, '0')}.gcm`;
    need(entry.object === name && Number.isSafeInteger(entry.size) && entry.size >= 0 &&
      entry.size <= 2 * 1024 ** 3 && HEX.test(entry.cipherSha256 ?? ''), 'INVALID_REMOTE_OBJECT');
    total += entry.size; need(total <= MAX_TOTAL, 'REMOTE_SNAPSHOT_TOO_LARGE');
    result.push({ name, bytes: entry.size, sha256: entry.cipherSha256 });
  }
  need(result.length === descriptor.files && total === descriptor.encryptedBytes, 'REMOTE_COUNTS_DIFFER');
  return result;
}
async function readRemoteJSON(store, key, maximum, expectedHash) {
  const result = await store.get({ key }); const chunks = []; let length = 0;
  try {
    need(result.bytes === undefined || result.bytes <= maximum, 'REMOTE_JSON_TOO_LARGE');
    for await (const chunk of result.body) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += data.length;
      need(length <= maximum, 'REMOTE_JSON_TOO_LARGE'); chunks.push(data);
    }
    const raw = Buffer.concat(chunks);
    need(!expectedHash || hash(raw) === expectedHash, 'REMOTE_MANIFEST_DIGEST_MISMATCH');
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), raw,
      versionId: result.versionId ?? null };
  } finally { result.body?.destroy?.(); result.cancel?.(); }
}
async function download(store, key, file, item) {
  if (await exists(file)) {
    // A process can stop after our create-only link and before unlinking its
    // temporary name. Reconcile only that exact owned inode and ciphertext.
    const info = await lstat(file);
    if (info.isFile() && !info.isSymbolicLink() && info.nlink === 2) {
      const matches = [];
      for (const name of await readdir(dirname(file))) if (/^\.sf101-download-[a-f0-9-]{36}$/.test(name)) {
        const candidate = join(dirname(file), name), st = await lstat(candidate);
        if (st.isFile() && !st.isSymbolicLink() && st.ino === info.ino && st.dev === info.dev && st.nlink === 2)
          matches.push(candidate);
      }
      need(matches.length === 1 && await digestFile(file, item.bytes, 2) === item.sha256,
        'LOCAL_PUBLICATION_LINK_CHANGED');
      await unlink(matches[0]); await syncDirectory(dirname(file));
    }
    need(await digestFile(file, item.bytes) === item.sha256, 'LOCAL_ENCRYPTED_OBJECT_CHANGED',
      'A retained encrypted file changed; use a new download destination');
    return { reused: true, bytes: item.bytes };
  }
  const temporary = join(dirname(file), '.sf101-download-' + randomUUID());
  const remote = await store.get({ key }); const digest = createHash('sha256'); let size = 0;
  try {
    need(remote.bytes === undefined || remote.bytes === item.bytes, 'REMOTE_OBJECT_SIZE_MISMATCH');
    const meter = new Transform({ transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > item.bytes) return done(Object.assign(new Error('Remote encrypted object exceeds its manifest'), { code: 'REMOTE_OBJECT_TOO_LARGE' }));
      digest.update(chunk); done(null, chunk);
    } });
    await pipeline(remote.body, meter, createWriteStream(temporary, {
      flags: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600,
    }));
    need(size === item.bytes && digest.digest('hex') === item.sha256, 'REMOTE_CIPHERTEXT_DIGEST_MISMATCH');
    const fd = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await fd.sync(); } finally { await fd.close(); }
    // link is an atomic, create-only publication in the destination directory.
    await link(temporary, file); await unlink(temporary); await syncDirectory(dirname(file));
    return { reused: false, bytes: size, versionId: remote.versionId ?? null };
  } finally {
    remote.body?.destroy?.(); remote.cancel?.();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function summary(state) {
  return { operationId: state.id, command: state.command, status: state.status,
    snapshotId: state.snapshotId ?? null, store: state.store, completionKey: state.snapshotId ? `snapshots/${state.snapshotId}.json` : null,
    bundle: state.binding.bundle ?? state.binding.bundleOut ?? state.binding.out ?? null,
    ...(state.command === 'restore' ? { destination: state.binding.out } : {}),
    files: state.descriptor?.files ?? null, plainBytes: state.descriptor?.plainBytes ?? null,
    encryptedBytes: state.descriptor?.encryptedBytes ?? null, progress: state.progress,
    verified: Boolean(state.verification), verifiedAt: state.verification?.at ?? null,
    remoteReceipt: state.remoteReceipt ?? null, originalRestore: state.originalRestore ?? null,
    createdAt: state.createdAt, updatedAt: state.updatedAt,
    ...(state.lastError ? { lastError: state.lastError } : {}) };
}
function bindingOf(options, store) {
  const binding = { command: options.command, storeFingerprint: hash(JSON.stringify(store.identity)) };
  if (options.command === 'push') binding.bundle = absolute(options.bundle, 'existing encrypted bundle');
  else {
    need(HEX.test(options.snapshot ?? ''), 'SNAPSHOT_ID_REQUIRED'); binding.snapshot = options.snapshot;
    binding.out = absolute(options.out, options.command === 'restore' ? 'new plaintext restore directory' : 'encrypted download directory');
    if (options.command === 'restore') binding.bundleOut = absolute(options.bundleOut, 'encrypted download directory');
  }
  return binding;
}
async function loadOperation(operations, id) {
  need(ID.test(id ?? ''), 'OPERATION_ID_REQUIRED'); await directory(operations);
  await directory(join(operations, id));
  const state = JSON.parse(await bytes(join(operations, id, 'operation.json'), 1024 * 1024));
  need(state.schema === OP_SCHEMA && state.id === id && object(state.binding), 'INVALID_TRANSFER_JOURNAL');
  return state;
}
async function save(state, dir, status = state.status) {
  state.status = status; state.updatedAt = stamp(); await atomicJSON(join(dir, 'operation.json'), state);
}
async function retainReceipt(dir, key, receipt) {
  const fd = await open(join(dir, 'receipts.ndjson'), constants.O_WRONLY | constants.O_APPEND |
    constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const st = await fd.stat(); need(st.isFile() && st.nlink === 1 && !(st.mode & 0o077), 'PRIVATE_RECEIPT_FILE_REQUIRED');
    await fd.writeFile(JSON.stringify({ at: stamp(), key, ...receipt }) + '\n'); await fd.sync();
  } finally { await fd.close(); }
}
async function begin(options, store) {
  need(ID.test(options.id ?? ''), 'OPERATION_ID_REQUIRED');
  const operations = absolute(options.operations, 'transfer operations directory');
  await directory(operations, true);
  const binding = bindingOf(options, store);
  const selected = [binding.bundle, binding.bundleOut, binding.out].filter(Boolean);
  for (const file of selected) need(!inside(operations, file) && !inside(file, operations), 'TRANSFER_PATH_OVERLAP');
  if (binding.bundleOut) need(!inside(binding.bundleOut, binding.out) && !inside(binding.out, binding.bundleOut), 'RESTORE_PATH_OVERLAP');
  const dir = join(operations, options.id);
  if (await exists(dir)) {
    await directory(dir);
    if (await exists(join(dir, 'operation.json'))) {
      const state = await loadOperation(operations, options.id);
      need(JSON.stringify(state.binding) === JSON.stringify(binding), 'TRANSFER_SELECTION_CHANGED',
        'Resume the same operation with its original store, snapshot and paths');
      return { dir, state };
    }
    need((await readdir(dir)).every(name => /^\.sf101-state-[a-f0-9-]{36}$/.test(name)), 'UNRECOGNIZED_OPERATION_DIRECTORY');
  } else await mkdir(dir, { mode: 0o700 });
  if (options.command === 'restore') need(!await exists(binding.out), 'RESTORE_DESTINATION_EXISTS',
    'Original recovery requires a new plaintext destination');
  const state = { schema: OP_SCHEMA, id: options.id, command: options.command, binding,
    store: store.identity, status: 'PREPARED', snapshotId: options.snapshot ?? null,
    progress: { nextObject: 0, written: 0, reused: 0, bytesWritten: 0 }, createdAt: stamp() };
  await save(state, dir); return { dir, state };
}
async function push(options, store, state, dir) {
  const bundle = state.binding.bundle; await directory(bundle);
  const manifestPath = join(bundle, 'manifest.json'); const raw = await bytes(manifestPath);
  const manifest = JSON.parse(raw), descriptor = descriptorOf(manifest, raw);
  need(!state.snapshotId || state.snapshotId === descriptor.snapshotId, 'ORIGINAL_SNAPSHOT_CHANGED');
  state.snapshotId = descriptor.snapshotId; state.descriptor = descriptor;
  const members = membersOf(manifest, descriptor);
  if (!state.verification) {
    const original = await recover(['verify', '--bundle', bundle, '--pass-env', options.passEnv]);
    need(original.status === 'SNAPSHOT_VERIFIED' && hash(await bytes(manifestPath)) === state.snapshotId,
      'ORIGINAL_SNAPSHOT_CHANGED');
    state.verification = { at: stamp(), snapshotId: state.snapshotId, original };
    await save(state, dir, 'VERIFIED');
  }
  for (let index = state.progress.nextObject; index < members.length; index++) {
    const item = members[index];
    const receipt = await store.putImmutable({ key: `bundles/${state.snapshotId}/${item.name}`,
      file: join(bundle, item.name), bytes: item.bytes, sha256: item.sha256, contentType: 'application/octet-stream' });
    await retainReceipt(dir, `bundles/${state.snapshotId}/${item.name}`, receipt);
    state.progress.nextObject = index + 1;
    state.progress[receipt.reused ? 'reused' : 'written']++;
    if (!receipt.reused) state.progress.bytesWritten += item.bytes;
    await save(state, dir, 'UPLOADING');
  }
  need(hash(await bytes(manifestPath)) === state.snapshotId, 'ORIGINAL_SNAPSHOT_CHANGED');
  const manifestReceipt = await store.putImmutable({ key: descriptor.manifest.key, file: manifestPath,
    bytes: raw.length, sha256: state.snapshotId, contentType: 'application/json' });
  await retainReceipt(dir, descriptor.manifest.key, manifestReceipt);
  const descriptorFile = join(dir, 'snapshot.json'); await atomicJSON(descriptorFile, descriptor);
  const descriptorBytes = await bytes(descriptorFile, MAX_DESCRIPTOR);
  await save(state, dir, 'COMPLETING');
  const receipt = await store.putImmutable({ key: `snapshots/${state.snapshotId}.json`, file: descriptorFile,
    bytes: descriptorBytes.length, sha256: hash(descriptorBytes), contentType: 'application/json' });
  await retainReceipt(dir, `snapshots/${state.snapshotId}.json`, receipt);
  state.remoteReceipt = { manifestVersionId: manifestReceipt.versionId ?? null,
    completionVersionId: receipt.versionId ?? null, completionSha256: hash(descriptorBytes),
    manifestRequestId: manifestReceipt.requestId ?? null, manifestPutRequestId: manifestReceipt.putRequestId ?? null,
    completionRequestId: receipt.requestId ?? null, completionPutRequestId: receipt.putRequestId ?? null };
  delete state.lastError; await save(state, dir, 'COMPLETE'); return summary(state);
}
async function ownedDownload(bundle, state, dir, options, descriptor) {
  const owner = { schema: OWNER_SCHEMA, operationId: state.id, snapshotId: state.snapshotId,
    storeFingerprint: state.binding.storeFingerprint };
  const ownerText = JSON.stringify(owner) + '\n'; const marker = join(bundle, OWNER_FILE);
  if (await exists(bundle)) {
    await directory(bundle);
    if (await exists(marker)) {
      const retained = (await bytes(marker, MAX_DESCRIPTOR)).toString('utf8');
      if (retained === ownerText) return false;
    }
    // A separately completed download can be reused for a new restore after
    // authenticating its original files. An incomplete other operation is kept.
    if (options.command === 'restore' && await exists(join(bundle, 'manifest.json'))) {
      need(hash(await bytes(join(bundle, 'manifest.json'))) === state.snapshotId, 'EXISTING_BUNDLE_IS_DIFFERENT');
      const verified = await recover(['verify', '--bundle', bundle, '--pass-env', options.passEnv]);
      need(verified.files === descriptor.files && verified.bytes === descriptor.plainBytes, 'EXISTING_BUNDLE_IS_DIFFERENT');
      state.verification = { at: stamp(), snapshotId: state.snapshotId, original: verified };
      state.adoptedBundle = true; await save(state, dir, 'DOWNLOADED'); return true;
    }
    // The only pre-marker interrupted creation that can be resumed is empty.
    need((await readdir(bundle)).length === 0 && state.downloadCreationIntent === true,
      'DOWNLOAD_DIRECTORY_BELONGS_TO_ANOTHER_OPERATION');
  } else {
    state.downloadCreationIntent = true; await save(state, dir, 'DOWNLOADING');
    await mkdir(bundle, { mode: 0o700 });
  }
  await writeFile(marker, ownerText, { flag: 'wx', mode: 0o600 });
  await syncDirectory(bundle); return false;
}
async function pullOrRestore(options, store, state, dir) {
  const catalog = await readRemoteJSON(store, `snapshots/${state.snapshotId}.json`, MAX_DESCRIPTOR);
  const descriptor = validateDescriptor(catalog.value, state.snapshotId);
  if (state.descriptor) need(JSON.stringify(state.descriptor) === JSON.stringify(descriptor), 'REMOTE_SELECTION_CHANGED');
  state.descriptor = descriptor; await save(state, dir);
  const bundle = state.binding.bundleOut ?? state.binding.out;
  const adopted = await ownedDownload(bundle, state, dir, options, descriptor);
  if (!adopted) {
    await directory(join(bundle, 'objects'), true);
    await download(store, descriptor.manifest.key, join(bundle, 'manifest.json'), descriptor.manifest);
    const raw = await bytes(join(bundle, 'manifest.json'));
    need(raw.length === descriptor.manifest.bytes && hash(raw) === state.snapshotId, 'REMOTE_MANIFEST_DIGEST_MISMATCH');
    const members = membersOf(JSON.parse(raw), descriptor);
    // Existing final files are rehashed on resume. Only the interrupted object
    // is fetched again; completed native ciphertext files are retained.
    state.progress = { nextObject: 0, written: 0, reused: 0, bytesWritten: 0 };
    for (const item of members) {
      const result = await download(store, `bundles/${state.snapshotId}/${item.name}`, join(bundle, item.name), item);
      state.progress.nextObject++; state.progress[result.reused ? 'reused' : 'written']++;
      if (!result.reused) state.progress.bytesWritten += item.bytes;
      await save(state, dir, 'DOWNLOADING');
    }
    await save(state, dir, 'DOWNLOADED');
  }
  if (options.command === 'restore') {
    let result;
    if (await exists(options.out)) {
      need(state.restoreStarted, 'RESTORE_DESTINATION_EXISTS');
      // Reconcile a completed original restore whose final journal write was
      // interrupted. Every original directory and plaintext digest must match;
      // this path never overwrites or removes an existing restored file.
      const verified = await recover(['verify', '--bundle', bundle, '--pass-env', options.passEnv]);
      const manifestBytes = await bytes(join(bundle, 'manifest.json'));
      need(hash(manifestBytes) === state.snapshotId, 'ORIGINAL_SNAPSHOT_CHANGED');
      const manifest = JSON.parse(manifestBytes); await directory(options.out);
      for (const entry of manifest.entries) {
        const file = join(options.out, ...entry.path.split('/'));
        if (entry.kind === 'directory') await directory(file);
        else need(await digestFile(file, entry.size) === entry.sha256, 'RESTORE_OUTCOME_INCOMPLETE',
          'The interrupted destination is incomplete or changed; retain it and select a new restore operation and destination');
      }
      result = { status: 'RESTORED_TO_NEW_DIR', destination: options.out, files: verified.files,
        bytes: verified.bytes, reconciled: true };
    } else {
      state.restoreStarted = true; await save(state, dir, 'RESTORING');
      result = await recover(['restore', '--bundle', bundle, '--out', options.out, '--pass-env', options.passEnv]);
    }
    need(result.status === 'RESTORED_TO_NEW_DIR', 'ORIGINAL_RESTORE_INCOMPLETE');
    state.originalRestore = result;
    state.verification = { at: stamp(), snapshotId: state.snapshotId, original: result };
  } else {
    const result = await recover(['verify', '--bundle', bundle, '--pass-env', options.passEnv]);
    need(result.status === 'SNAPSHOT_VERIFIED', 'ORIGINAL_VERIFICATION_INCOMPLETE');
    state.verification = { at: stamp(), snapshotId: state.snapshotId, original: result };
  }
  state.remoteReceipt = { completionVersionId: catalog.versionId, completionSha256: hash(catalog.raw) };
  delete state.lastError; await save(state, dir, 'COMPLETE'); return summary(state);
}
async function inventory(options, store) {
  const limit = options.limit ?? 20;
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_LIST_LIMIT');
  const page = await store.list({ prefix: 'snapshots/', cursor: options.cursor, limit });
  const snapshots = []; let ignoredObjects = 0;
  for (const entry of page.objects) {
    const match = /^snapshots\/([a-f0-9]{64})\.json$/.exec(entry.key);
    if (!match) { ignoredObjects++; continue; }
    const item = await readRemoteJSON(store, entry.key, MAX_DESCRIPTOR);
    const descriptor = validateDescriptor(item.value, match[1]);
    snapshots.push({ snapshotId: descriptor.snapshotId, createdAt: descriptor.createdAt,
      files: descriptor.files, plainBytes: descriptor.plainBytes, encryptedBytes: descriptor.encryptedBytes,
      roots: descriptor.roots, completionKey: entry.key, versionId: item.versionId,
      authentication: 'VERIFY_WITH_ORIGINAL_RECOVERY_BEFORE_RESTORE' });
  }
  return { status: 'REMOTE_SNAPSHOTS', store: store.identity, snapshots,
    nextCursor: page.nextCursor ?? null, ignoredObjects };
}

export async function runRemote(options, { store: suppliedStore } = {}) {
  need(object(options) && ['push', 'list', 'pull', 'restore', 'status'].includes(options.command), 'INVALID_REMOTE_COMMAND');
  if (options.command === 'status') return summary(await loadOperation(absolute(options.operations, 'operations directory'), options.id));
  if (options.command !== 'list') need(/^[A-Z][A-Z0-9_]{4,63}$/.test(options.passEnv ?? ''), 'PASSPHRASE_VARIABLE_REQUIRED');
  const store = suppliedStore ?? await (await import('./remote-s3.mjs')).openS3Store(options.config);
  let lease, state, dir;
  try {
    need(object(store.identity), 'REMOTE_STORE_IDENTITY_REQUIRED');
    if (options.command === 'list') return await inventory(options, store);
    const operations = absolute(options.operations, 'operations directory'); await directory(operations, true);
    lease = await acquireDeliveryLease(operations, { purpose: 'drain' });
    ({ state, dir } = await begin(options, store));
    if (state.status === 'COMPLETE') return { ...summary(state), alreadyComplete: true };
    return options.command === 'push' ? await push(options, store, state, dir) : await pullOrRestore(options, store, state, dir);
  } catch (error) {
    if (state && dir) {
      state.lastError = { at: stamp(), code: error.code ?? 'TRANSFER_FAILED', message: String(error.message).slice(0, 500),
        ...Object.fromEntries(['status', 'httpStatusCode', 'providerCode', 'requestId', 'putRequestId', 'retryAfter',
          'retryable', 'mayHaveCommitted', 'reconciliationCode', 'reconciliationStatus'].filter(key =>
          ['string', 'number', 'boolean'].includes(typeof error[key])).map(key => [key, error[key]])) };
      await save(state, dir).catch(() => {});
      error.operation = summary(state);
    }
    throw error;
  } finally { await lease?.release(); if (!suppliedStore) await store.close?.(); }
}
