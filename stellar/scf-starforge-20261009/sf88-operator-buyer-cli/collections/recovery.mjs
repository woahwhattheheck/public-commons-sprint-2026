// MIT. Request Collections recovery over the original SF88 / SF101 state engine.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, dirname, join, sep } from 'node:path';
import { config, execution, need } from '../config.mjs';
import { openWorkspace } from '../workspace.mjs';
import { inspectWorkspaceRecovery, snapshotWorkspaceRecovery,
  verifyWorkspaceRecovery, restoreWorkspaceRecovery } from '../workspace-recovery.mjs';

export const COLLECTION_RECOVERY_SCHEMA = 'stellar-forge.sf88.collection-workspace-recovery.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UUID = /^[a-f0-9-]{36}$/;
const MAX_APPLICATION = 1024 * 1024;
const MAX_FILES = 9500;
const same = (a, b) => canonical(a) === canonical(b);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => root === path || path.startsWith(root + sep);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
  ? error.code : 'COLLECTION_RECOVERY_FAILED';
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function absolute(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && path !== sep && !path.includes('\0'), 'COLLECTION_RECOVERY_CANONICAL_PATH_REQUIRED');
  return path;
}
async function present(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateDirectory(path) {
  absolute(path);
  const st = await lstat(path);
  need(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid()
    && (st.mode & 0o077) === 0 && await realpath(path) === path,
  'COLLECTION_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
}
async function fileInfo(path, { maximum = 2 * 1024 ** 3, signal, contents = false } = {}) {
  absolute(path);
  need(await realpath(path) === path, 'COLLECTION_RECOVERY_CANONICAL_PATH_REQUIRED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true }), st = await file.stat();
    need(st.isFile() && st.nlink === 1 && st.uid === process.getuid()
      && (st.mode & 0o077) === 0 && st.size <= maximum,
    'COLLECTION_RECOVERY_PRIVATE_FILE_REQUIRED');
    const hash = createHash('sha256'), chunks = [];
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      need(!signal?.aborted, 'WORKSPACE_RECOVERY_INTERRUPTED');
      bytes += chunk.length; need(bytes <= maximum, 'COLLECTION_RECOVERY_FILE_TOO_LARGE');
      hash.update(chunk); if (contents) chunks.push(chunk);
    }
    const after = await file.stat({ bigint: true });
    need(bytes === st.size && ['dev','ino','size','mtimeNs','ctimeNs'].every(key =>
      before[key] === after[key]), 'COLLECTION_RECOVERY_SOURCE_CHANGED');
    return { path, bytes, sha256: hash.digest('hex'),
      ...(contents ? { raw: Buffer.concat(chunks) } : {}) };
  } finally { await file.close(); }
}
async function readJson(path, maximum = 32 * 1024 * 1024) {
  const data = await fileInfo(path, { maximum, contents: true });
  return { ...data, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.raw)) };
}
function statusIdentity(snapshot) {
  const { commands, ...original } = snapshot;
  return sha(canonical(original));
}
function profileHash(profile) {
  const { reviewSha256, ...content } = profile;
  return sha(canonical(content));
}
function inputView(info, kind) {
  return { path: info.path, bytes: info.bytes, sha256: info.sha256, kind };
}

/** Exact original controller projections; no signer import, request or payment. */
export async function inspectCollectionRecovery({ collections, stateRoot, signal } = {}) {
  need(collections && typeof collections.inspectRecoverySource === 'function',
    'COLLECTION_RECOVERY_CONTROLLER_REQUIRED');
  await privateDirectory(stateRoot);
  const source = await collections.inspectRecoverySource();
  const required = new Set(), optional = new Set(), operators = new Map(), files = new Map();
  const within = path => {
    absolute(path);
    need(inside(stateRoot, path), 'COLLECTION_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
    return path;
  };
  async function include(path, { missing = false, kind = 'input', expected } = {}) {
    if (path === undefined || path === null) return null;
    within(path);
    const exists = await present(path);
    if (!exists) {
      need(missing, 'COLLECTION_RECOVERY_DEPENDENCY_MISSING'); optional.add(path);
      return { path, available: false, kind, ...(expected ?? {}) };
    }
    required.add(path);
    if (exists.isDirectory()) { await privateDirectory(path); return { path, kind: 'directory', available: true }; }
    const observed = await fileInfo(path, { signal });
    if (expected) need(observed.sha256 === expected.sha256 && observed.bytes === expected.bytes,
      'COLLECTION_RECOVERY_RETAINED_FILE_CHANGED');
    if (!files.has(path)) files.set(path, inputView(observed, kind));
    return { ...inputView(observed, kind), available: true };
  }
  within(source.directory); within(source.queueRoot);
  await include(source.directory); await include(source.queueRoot);
  async function original(cfg, path) {
    const { owner, op, download } = execution(cfg), directory = dirname(owner.ledger);
    within(directory);
    need(owner.ledger === join(directory, 'reservations.sqlite')
      && owner.policy === join(directory, 'policy.json'),
    'COLLECTION_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
    let native = operators.get(directory);
    if (!native) {
      const workspace = await openWorkspace(['--dir', directory], { accounting: true });
      native = { directory, workspace, execution: execution(workspace.config) };
      operators.set(directory, native); await include(directory);
    }
    need(['actor','service','python','policy','ledger'].every(key =>
      owner[key] === native.execution.owner[key])
      && cfg.signerModule === native.workspace.config.signerModule
      && cfg.evidenceDir === native.workspace.config.evidenceDir
      && cfg.trustedPayer === native.workspace.config.trustedPayer,
    'COLLECTION_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
    if (path) await include(path, { kind: 'request_configuration' });
    await include(op.bodyFile, { kind: 'request_body' });
    await include(op.ticketFile, { kind: 'operation_ticket' });
    await include(cfg.evidenceDir, { missing: true, kind: 'evidence_directory' });
    await include(download?.destination, { missing: true, kind: 'response_destination' });
    return directory;
  }
  const collectionsView = [];
  for (const entry of source.collections) {
    const manifest = entry.manifest;
    within(manifest.directory);
    for (const item of manifest.items) {
      const cfg = await config(item.configFile);
      await original(cfg, item.configFile);
      for (const file of item.files) await include(join(dirname(item.configFile), file.name), {
        kind: file.name === 'original-config.json' ? 'original_configuration' : 'retained_input',
        expected: { bytes: file.bytes, sha256: file.sha256 },
      });
      // The original source filename remains evidence in the manifest. Its
      // exact bytes already live in original-config.json, including when the
      // external source filename is no longer present.
    }
    collectionsView.push({ id: manifest.id, name: manifest.name,
      directory: manifest.directory, manifestSha256: entry.manifestSha256,
      itemCount: manifest.items.length, state: entry.snapshot.state,
      statusSha256: statusIdentity(entry.snapshot) });
  }
  const jobs = [], deliveries = [];
  for (const job of source.jobs) {
    const path = join(source.queueRoot, 'jobs', job.id, 'execution.json');
    const cfg = await config(path), operator = await original(cfg, path);
    const current = await fileInfo(path, { maximum: 65536, signal });
    need(current.sha256 === job.configSha256, 'COLLECTION_RECOVERY_INBOX_CHANGED');
    for (const dependency of Object.values(job.dependencies ?? {})) {
      const observed = await fileInfo(dependency.path, { maximum: 1048576, signal });
      need(observed.sha256 === dependency.sha256 && observed.bytes === dependency.bytes,
        'COLLECTION_RECOVERY_ORIGINAL_DEPENDENCY_CHANGED');
    }
    await include(job.evidencePath, { missing: true, kind: 'original_evidence' });
    const response = job.outcome?.responseFile;
    if (response?.status === 'SAVED') {
      need(HASH.test(response.sha256 ?? '') && Number.isSafeInteger(response.bytes)
        && response.bytes >= 0, 'COLLECTION_RECOVERY_RESPONSE_INVALID');
      deliveries.push({ intentId: job.operation.intentId,
        ...await include(response.path, { missing: true, kind: 'saved_response',
          expected: { sha256: response.sha256, bytes: response.bytes } }) });
    }
    if (response?.partialPath) await include(response.partialPath, { missing: true, kind: 'partial_response' });
    jobs.push({ id: job.id, intentId: job.operation.intentId, operator,
      configSha256: job.configSha256, sourceConfigSha256: job.sourceConfigSha256,
      attemptId: job.attempt?.id ?? null, state: job.state, statusSha256: sha(canonical(job)) });
  }
  need(operators.size > 0 && operators.size <= 64, 'COLLECTION_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  need(required.size + optional.size <= MAX_FILES, 'COLLECTION_RECOVERY_FILE_LIMIT');
  const operatorPaths = [...operators.keys()].sort();
  const roots = [source.directory, source.queueRoot].filter((path, index, all) =>
    all.indexOf(path) === index && !all.some(other => other !== path && inside(other, path)));
  // The native optionalInclude list is the large exact-path form. Required
  // inputs were checked above and are checked again in the capture hook; no
  // broad parent directory is added merely to reduce the number of paths.
  const extra = [...new Set([...required, ...optional])].filter(path =>
    !roots.some(root => inside(root, path)) && !operatorPaths.some(root => inside(root, path))).sort();
  const nativeOptions = { directory: operatorPaths[0], operators: operatorPaths.slice(1),
    stateRoot, include: roots, optionalInclude: extra };
  const native = await inspectWorkspaceRecovery(nativeOptions);
  const profile = { schema: COLLECTION_RECOVERY_SCHEMA, directory: source.directory,
    queueRoot: source.queueRoot, stateRoot, headerSha256: source.headerSha256,
    collections: collectionsView.sort((a, b) => a.id.localeCompare(b.id)),
    jobs: jobs.sort((a, b) => a.id.localeCompare(b.id)), operators: operatorPaths,
    retainedInputs: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    deliveries, selected: native.selected, missing: [...optional].sort(),
    runtime: native.runtime, restoreMode: native.restoreMode,
    walletEnvironmentExported: false, automaticExecution: false };
  profile.reviewSha256 = profileHash(profile);
  need(Buffer.byteLength(JSON.stringify({ schema: COLLECTION_RECOVERY_SCHEMA,
    operationId: '00000000-0000-0000-0000-000000000000', profile })) <= MAX_APPLICATION,
  'COLLECTION_RECOVERY_APPLICATION_TOO_LARGE');
  return { profile, native, nativeOptions };
}

function validateApplication(record) {
  const app = record.application, profile = app?.profile;
  need(record.schema === 'stellar-forge.sf88.workspace-recovery.v2'
    && app?.schema === COLLECTION_RECOVERY_SCHEMA && UUID.test(app.operationId ?? '')
    && profile?.schema === COLLECTION_RECOVERY_SCHEMA
    && profile.stateRoot === record.plan.stateRoot
    && HASH.test(profile.reviewSha256 ?? '') && profileHash(profile) === profile.reviewSha256
    && Array.isArray(profile.collections) && Array.isArray(profile.jobs)
    && Array.isArray(profile.operators) && Array.isArray(profile.retainedInputs)
    && Array.isArray(profile.deliveries) && Array.isArray(profile.missing),
  'COLLECTION_RECOVERY_APPLICATION_INVALID');
  const within = path => {
    absolute(path); need(inside(profile.stateRoot, path), 'COLLECTION_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
  };
  for (const path of [profile.directory, profile.queueRoot, ...profile.operators]) within(path);
  need(same([...profile.operators].sort(),
    [record.plan, ...record.plan.operators].map(item => item.directory).sort()),
  'COLLECTION_RECOVERY_OPERATOR_BINDING_INVALID');
  const ids = new Set();
  for (const item of profile.collections) {
    need(ID.test(item.id ?? '') && !ids.has(item.id)
      && item.directory === join(profile.directory, 'collections', item.id)
      && HASH.test(item.manifestSha256 ?? '') && HASH.test(item.statusSha256 ?? ''),
    'COLLECTION_RECOVERY_COLLECTION_BINDING_INVALID');
    ids.add(item.id);
  }
  for (const item of profile.retainedInputs) {
    within(item.path);
    need(HASH.test(item.sha256 ?? '') && Number.isSafeInteger(item.bytes) && item.bytes >= 0,
      'COLLECTION_RECOVERY_INPUT_BINDING_INVALID');
  }
  for (const item of profile.jobs) {
    need(HASH.test(item.id ?? '') && sha(item.intentId) === item.id
      && HASH.test(item.configSha256 ?? '') && HASH.test(item.sourceConfigSha256 ?? '')
      && HASH.test(item.statusSha256 ?? '') && profile.operators.includes(item.operator),
    'COLLECTION_RECOVERY_INBOX_BINDING_INVALID');
  }
  return app;
}
async function inspectSnapshot({ record, map }) {
  const { profile } = validateApplication(record);
  const header = await readJson(map(join(profile.directory, 'collections.json')), 65536);
  need(header.sha256 === profile.headerSha256
    && header.value.schema === 'stellar-forge.sf88.collections.v1'
    && header.value.queueRoot === profile.queueRoot, 'COLLECTION_RECOVERY_STORE_BINDING_CHANGED');
  for (const item of profile.collections) {
    const manifest = await readJson(map(join(item.directory, 'manifest.json')));
    need(manifest.sha256 === item.manifestSha256
      && manifest.value.schema === 'stellar-forge.sf88.collection.v1'
      && manifest.value.directory === item.directory
      && manifest.value.id === item.id && manifest.value.queueRoot === profile.queueRoot,
    'COLLECTION_RECOVERY_MANIFEST_CHANGED');
  }
  for (const input of profile.retainedInputs) {
    const observed = await fileInfo(map(input.path));
    need(observed.bytes === input.bytes && observed.sha256 === input.sha256,
      'COLLECTION_RECOVERY_INPUT_CHANGED');
  }
  for (const item of profile.jobs) {
    const base = join(profile.queueRoot, 'jobs', item.id);
    for (const [name, expected] of [['execution.json', item.configSha256],
      ['source-config.json', item.sourceConfigSha256]]) {
      need((await fileInfo(map(join(base, name)))).sha256 === expected,
        'COLLECTION_RECOVERY_INBOX_CHANGED');
    }
    const request = await readJson(map(join(base, 'request.json')));
    need(request.value.id === item.id && request.value.operation?.intentId === item.intentId,
      'COLLECTION_RECOVERY_INBOX_BINDING_INVALID');
    const attemptPath = map(join(base, 'attempt.json'));
    const attempt = await present(attemptPath) ? (await readJson(attemptPath)).value : null;
    need((attempt?.id ?? null) === item.attemptId, 'COLLECTION_RECOVERY_ATTEMPT_CHANGED');
  }
}

/** The original application lease drains only its own collection writers. */
export async function snapshotCollectionRecovery({ collections, stateRoot, output,
  expectedReviewSha256, operationId, passEnv = 'SF88_BACKUP_PASSPHRASE', quiesced } = {}, context = {}) {
  need(quiesced === true, 'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
  need(HASH.test(expectedReviewSha256 ?? '') && UUID.test(operationId ?? ''),
    'COLLECTION_RECOVERY_REVIEW_REQUIRED');
  return collections.withRecoveryLock(async () => {
    const inspected = await inspectCollectionRecovery({ collections, stateRoot, signal: context.signal });
    need(inspected.profile.reviewSha256 === expectedReviewSha256, 'COLLECTION_RECOVERY_REVIEW_CHANGED');
    const application = { schema: COLLECTION_RECOVERY_SCHEMA, operationId, profile: inspected.profile };
    const result = await snapshotWorkspaceRecovery({ ...inspected.nativeOptions,
      output, passEnv, quiesced: true }, { ...context, prepareSnapshot: async ({ staged, stateRoot: root, plan }) => {
        const current = await inspectCollectionRecovery({ collections, stateRoot, signal: context.signal });
        need(current.profile.reviewSha256 === expectedReviewSha256, 'COLLECTION_RECOVERY_REVIEW_CHANGED');
        await inspectSnapshot({ record: { schema: plan.schema, plan, application },
          map: path => join(staged, path.slice(root.length + 1)) });
        return application;
      } });
    return { ...result, encryptedFiles: await collectionBundleFiles(output, { expectedRecordSha256: result.recordSha256 }), bundle: absolute(output), collectionCount: application.profile.collections.length,
      requestCount: application.profile.jobs.length, executionStarted: false };
  });
}

export async function verifyCollectionRecovery(options, context = {}) {
  const encryptedFiles = await collectionBundleFiles(options.bundle, { expectedRecordSha256: options.expected });
  const result = await verifyWorkspaceRecovery(options, { ...context, inspectSnapshot });
  await collectionBundleFiles(options.bundle, { expectedRecordSha256: result.recordSha256, expectedFiles: encryptedFiles });
  return { ...result, encryptedFiles, bundle: absolute(options.bundle),
    collectionCount: result.application.profile.collections.length,
    requestCount: result.application.profile.jobs.length, executionStarted: false };
}

async function reopen(profile) {
  const { openCollections } = await import('./model.mjs');
  let collections;
  try {
    collections = await openCollections({ directory: profile.directory, queueRoot: profile.queueRoot, existingOnly: true });
    const source = await collections.inspectRecoverySource();
    need(source.headerSha256 === profile.headerSha256
      && source.collections.length === profile.collections.length
      && source.jobs.length === profile.jobs.length, 'COLLECTION_RECOVERY_REOPEN_CHANGED');
    const saved = new Map(profile.collections.map(item => [item.id, item]));
    for (const item of source.collections) {
      const expected = saved.get(item.manifest.id);
      need(expected && item.manifestSha256 === expected.manifestSha256
        && statusIdentity(item.snapshot) === expected.statusSha256, 'COLLECTION_RECOVERY_REOPEN_CHANGED');
    }
    const jobs = new Map(profile.jobs.map(item => [item.id, item]));
    for (const job of source.jobs) need(jobs.get(job.id)?.statusSha256 === sha(canonical(job)),
      'COLLECTION_RECOVERY_REOPEN_CHANGED');
    return { directory: profile.directory, queueRoot: profile.queueRoot,
      collections: profile.collections.map(({ id, name, itemCount, state, manifestSha256 }) =>
        ({ id, name, itemCount, state, manifestSha256 })),
      requests: source.jobs.length, unresolvedAttempts: source.jobs.filter(job =>
        job.state === 'RUNNING_OR_INTERRUPTED').map(job => ({
          intentId: job.operation.intentId, attemptId: job.attempt.id, state: job.state,
        })),
      argv: ['starforge', 'buyer-collections-workspace', '--directory', profile.directory],
      executionStarted: false };
  } finally { await collections?.close(); }
}
export async function restoreCollectionRecovery(options, context = {}) {
  need(typeof options.expected === 'string' && HASH.test(options.expected),
    'COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
  const encryptedFiles = await collectionBundleFiles(options.bundle, { expectedRecordSha256: options.expected });
  const result = await restoreWorkspaceRecovery(options, { ...context, inspectSnapshot: async input => {
    await inspectSnapshot(input);
    const target = input.record.plan.stateRoot;
    if (options.receivingDirectory !== undefined) need(
      !inside(target, absolute(options.receivingDirectory))
      && !inside(options.receivingDirectory, target),
    'COLLECTION_RECOVERY_RECEIVER_OVERLAPS_TARGET');
    if (options.expectedStateRoot !== undefined) need(options.expectedStateRoot === target,
      'COLLECTION_RECOVERY_TARGET_BINDING_CHANGED');
  } });
  let reopened = null, reopenError = null;
  try { reopened = await reopen(result.application.profile); } catch (error) { reopenError = codeOf(error); }
  let archiveWarning = null;
  try { await collectionBundleFiles(options.bundle, { expectedRecordSha256: result.recordSha256, expectedFiles: encryptedFiles }); }
  catch (error) { archiveWarning = codeOf(error); }
  return { ...result, encryptedFiles, archiveWarning, bundle: absolute(options.bundle), reopened, reopenError, executionStarted: false };
}

/** Reconcile an interrupted receiving publication by the exact retained files.
 * It never overwrites a populated root or starts original requests. */
export async function reconcileCollectionRestore(options, context = {}) {
  need(HASH.test(options.expected ?? ''), 'COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
  const encryptedFiles = await collectionBundleFiles(options.bundle, { expectedRecordSha256: options.expected });
  const verified = await verifyWorkspaceRecovery(options, { ...context, inspectSnapshot: async input => {
    await inspectSnapshot(input);
    const target = input.record.plan.stateRoot;
    await privateDirectory(target);
    if (options.receivingDirectory !== undefined) need(
      !inside(target, absolute(options.receivingDirectory)) && !inside(options.receivingDirectory, target),
      'COLLECTION_RECOVERY_RECEIVER_OVERLAPS_TARGET');
    if (options.expectedStateRoot !== undefined) need(options.expectedStateRoot === target,
      'COLLECTION_RECOVERY_TARGET_BINDING_CHANGED');
    const known = new Set(input.record.files.map(item => item.path));
    async function inspectDirectory(path, rel = '') {
      for (const item of await readdir(path, { withFileTypes: true })) {
        const name = rel ? rel + '/' + item.name : item.name;
        need(known.has(name), 'COLLECTION_RECOVERY_TARGET_CHANGED');
        if (item.isDirectory() && !item.isSymbolicLink()) await inspectDirectory(join(path, item.name), name);
      }
    }
    await inspectDirectory(target);
    for (const item of input.record.files) {
      const path = join(target, item.path);
      if (item.kind === 'directory') await privateDirectory(path);
      else {
        const observed = await fileInfo(path, { signal: context.signal });
        need(observed.bytes === item.size && observed.sha256 === item.sha256,
          'COLLECTION_RECOVERY_TARGET_CHANGED');
      }
    }
  } });
  await collectionBundleFiles(options.bundle, { expectedRecordSha256: verified.recordSha256, expectedFiles: encryptedFiles });
  const reopened = await reopen(verified.application.profile);
  return { ...verified, encryptedFiles, status: 'COLLECTION_EXISTING_STATE_MATCHES_BACKUP',
    bundle: absolute(options.bundle), publicationRecovered: true, reopened,
    executionStarted: false, originalStateRetained: true };
}

/** Native encrypted members only. No decrypted key, source or response file. */
export async function collectionBundleFiles(bundle, { expectedRecordSha256, expectedFiles } = {}) {
  await privateDirectory(bundle);
  const manifest = await readJson(join(bundle, 'manifest.json'), 32 * 1024 * 1024);
  need(manifest.value.schema === 'stellar-forge.merchant-recovery.v1'
    && Array.isArray(manifest.value.entries), 'COLLECTION_RECOVERY_BUNDLE_INVALID');
  if (expectedRecordSha256 !== undefined) need(HASH.test(expectedRecordSha256)
    && manifest.value.entries.some(item => item.kind === 'file' && item.path === 'record'
      && item.sha256 === expectedRecordSha256), 'COLLECTION_RECOVERY_BUNDLE_CHANGED');
  const names = ['manifest.json', ...manifest.value.entries.filter(item => item.kind === 'file')
    .map(item => item.object)];
  need(names.length <= 10001 && new Set(names).size === names.length
    && names.every(name => name === 'manifest.json' || /^objects\/[0-9]{6}\.gcm$/.test(name)),
  'COLLECTION_RECOVERY_BUNDLE_INVALID');
  const files = [];
  for (const name of names) {
    const file = await fileInfo(join(bundle, name), { maximum: 2 * 1024 ** 3 + 64 });
    if (name !== 'manifest.json') {
      const entry = manifest.value.entries.find(item => item.object === name);
      need(entry?.cipherSha256 === file.sha256 && entry.size === file.bytes,
        'COLLECTION_RECOVERY_BUNDLE_CHANGED');
    }
    files.push({ name, ...file });
  }
  if (expectedFiles !== undefined) {
    const identity = values => values.map(({name,bytes,sha256}) => ({name,bytes,sha256}));
    need(Array.isArray(expectedFiles) && same(identity(files), identity(expectedFiles)),
      'COLLECTION_RECOVERY_BUNDLE_CHANGED');
  }
  return files;
}
