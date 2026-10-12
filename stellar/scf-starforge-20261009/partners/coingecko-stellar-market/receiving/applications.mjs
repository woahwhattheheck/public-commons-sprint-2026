// MIT. Operate one retained CoinGecko project through the original installed Applications lifecycle.
import { readFile, writeFile, mkdir, rename, lstat, realpath, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const HASH = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function save(path, value) {
  const temporary = path + '.' + randomUUID() + '.next';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
function uuidFor(text) {
  const hex = sha(text);
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-a' + hex.slice(17,20) + '-' + hex.slice(20,32);
}
const originalModule = (source, path) => import(pathToFileURL(join(source, path)).href);
const B = 'stellar/scf-starforge-20261009/';
const R = B + 'distribution/runtime-workspace/';
const C = B + 'partners/coingecko-stellar-market/';


const same = (left, right) => isDeepStrictEqual(left, right);
const SOURCE_CONTINUATION_SCHEMA = 'stellar-forge.coingecko-source-continuation.v1';
function managedConfigurationSnapshot(value, configurationFile = null) {
  const snapshot = plain(value?.configuration) ? value.configuration : value;
  const path = configurationFile === null ? null : resolve(configurationFile);
  need(plain(snapshot) && Array.isArray(snapshot.profiles) && snapshot.profiles.length <= 128 &&
    (path === null ? snapshot.path === null && snapshot.sha256 === null && snapshot.profiles.length === 0 :
      snapshot.path === path && HASH.test(snapshot.sha256 ?? '')),
  'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_REQUIRED');
  const ids = new Set();
  for (const profile of snapshot.profiles) {
    need(plain(profile) && typeof profile.id === 'string' &&
      /^[A-Za-z0-9._:-]{1,160}$/.test(profile.id) && !ids.has(profile.id) &&
      typeof profile.name === 'string' && profile.name.trim().length > 0 && profile.name.length <= 240 &&
      typeof profile.network === 'string' && profile.network.length > 0 && profile.network.length <= 128 &&
      typeof profile.configPath === 'string' && profile.configPath === resolve(profile.configPath) &&
      typeof profile.workspacePath === 'string' && profile.workspacePath === resolve(profile.workspacePath) &&
      HASH.test(profile.configSha256 ?? '') && plain(profile.workspaceIdentity) &&
      ['device', 'inode'].every(key => typeof profile.workspaceIdentity[key] === 'string' &&
        /^\d+$/.test(profile.workspaceIdentity[key])),
    'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_REQUIRED');
    ids.add(profile.id);
  }
  return snapshot;
}
async function receivingDriverIdentity() {
  const path = fileURLToPath(import.meta.url), before = await lstat(path);
  need(before.isFile() && !before.isSymbolicLink() && before.size <= 1024 * 1024 &&
    await realpath(path) === path, 'SOURCE_CONTINUATION_RECEIVER_PATH_CHANGED');
  const bytes = await readFile(path), after = await lstat(path);
  need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === before.size,
  'SOURCE_CONTINUATION_RECEIVER_CHANGED');
  return { path, bytes: bytes.length, sha256: sha(bytes) };
}
function noApplicationEffects(state) {
  return plain(state) && state.schema === 'stellar-forge.coingecko-applications-checkpoint.v1' &&
    ['requests', 'completed', 'runs'].every(key => plain(state[key]) && Object.keys(state[key]).length === 0) &&
    ['reviewId', 'applicationId', 'connection', 'connectionErrors', 'originalCounts', 'receivedProjectId']
      .every(key => !Object.hasOwn(state, key));
}
async function originalJSONFile(descriptor, limit = 4 * 1024 * 1024) {
  need(plain(descriptor) && typeof descriptor.path === 'string' && descriptor.path === resolve(descriptor.path) &&
    HASH.test(descriptor.sha256 ?? ''), 'SOURCE_CONTINUATION_ORIGINAL_REQUIRED');
  const path = descriptor.path, before = await lstat(path);
  need(before.isFile() && !before.isSymbolicLink() && before.size <= limit &&
    await realpath(path) === path, 'SOURCE_CONTINUATION_ORIGINAL_PATH_CHANGED');
  const bytes = await readFile(path), after = await lstat(path);
  need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
    bytes.length === before.size && sha(bytes) === descriptor.sha256,
  'SOURCE_CONTINUATION_ORIGINAL_CHANGED');
  return { path, bytes, sha256: descriptor.sha256, value: JSON.parse(bytes) };
}
/** Read the ended pre-application attempt before selecting a corrected original source. */
export async function readCoinGeckoSourceContinuation(path, selection) {
  path = resolve(path);
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= 65536 &&
    await realpath(path) === path, 'SOURCE_CONTINUATION_DESCRIPTOR_REQUIRED');
  const bytes = await readFile(path), descriptor = JSON.parse(bytes);
  need(plain(descriptor) && descriptor.schema === SOURCE_CONTINUATION_SCHEMA &&
    typeof descriptor.reason === 'string' && descriptor.reason.trim().length > 0 &&
    descriptor.reason.length <= 6000 && plain(descriptor.predecessor),
  'SOURCE_CONTINUATION_DESCRIPTOR_REQUIRED');
  const files = {};
  for (const name of ['manifest', 'checkpoint', 'terminal', 'runtime'])
    files[name] = await originalJSONFile(descriptor.predecessor[name]);
  if (descriptor.predecessor.configuration !== undefined)
    files.configuration = await originalJSONFile(descriptor.predecessor.configuration);
  need(new Set(Object.values(files).map(file => file.path)).size === Object.keys(files).length,
    'SOURCE_CONTINUATION_ORIGINALS_AMBIGUOUS');
  const previous = files.manifest.value, checkpoint = files.checkpoint.value;
  const terminal = files.terminal.value, runtime = files.runtime.value;
  need(previous.schema === 'stellar-forge.coingecko-applications-receiving.v1' &&
    checkpoint.manifestSha256 === files.manifest.sha256 && noApplicationEffects(checkpoint) &&
    plain(checkpoint.originalBinding) && plain(checkpoint.originalBinding.identity) &&
    plain(checkpoint.originalBinding.database) && plain(checkpoint.originalBinding.project),
  'SOURCE_CONTINUATION_APPLICATION_ALREADY_REACHED');
  need(terminal.state === 'failed' && Number.isInteger(terminal.exit_code) && terminal.exit_code !== 0 &&
    Number.isFinite(Date.parse(terminal.started_at)) && Number.isFinite(Date.parse(terminal.ended_at)) &&
    Date.parse(terminal.ended_at) >= Date.parse(terminal.started_at) &&
    Number.isFinite(Date.parse(checkpoint.createdAt)) &&
    Date.parse(checkpoint.createdAt) <= Date.parse(terminal.ended_at),
  'SOURCE_CONTINUATION_TERMINAL_FAILURE_REQUIRED');
  need((runtime.state === 'READY' || runtime.status === 'READY') &&
    runtime.directory === previous.runtimeDirectory && runtime.sourceRoot === previous.sourceRoot &&
    /^[a-f0-9]{40}$/.test(runtime.sourceCommit ?? '') &&
    ['installationId', 'profileId', 'profileSha256', 'lockSha256', 'sourceManifestSha256']
      .every(key => HASH.test(runtime[key] ?? '')) &&
    (!previous.sourceManifestSha256 || previous.sourceManifestSha256 === runtime.sourceManifestSha256),
  'SOURCE_CONTINUATION_ORIGINAL_RUNTIME_CHANGED');
  need(plain(selection) && previous.operationPrefix === selection.operationPrefix &&
    previous.projectId === selection.projectId &&
    previous.workspaceDirectory === selection.workspaceDirectory &&
    previous.actor === selection.actor &&
    same(previous.originalSources, selection.originalSources) &&
    (previous.configurationFile ?? null) === (selection.configurationFile ?? null) &&
    [previous.allowLocalMerchant, selection.allowLocalMerchant]
      .every(value => value === undefined || typeof value === 'boolean') &&
    (previous.allowLocalMerchant === true) === (selection.allowLocalMerchant === true) &&
    checkpoint.originalBinding.directory === previous.workspaceDirectory &&
    checkpoint.originalBinding.project.id === previous.projectId,
  'SOURCE_CONTINUATION_BUSINESS_SELECTION_CHANGED');
  const configurationFile = previous.configurationFile ?? null;
  need(configurationFile === null || typeof configurationFile === 'string' && configurationFile.length > 0,
    'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_REQUIRED');
  let originalConfiguration = null;
  if (checkpoint.originalConfiguration !== undefined)
    originalConfiguration = managedConfigurationSnapshot(checkpoint.originalConfiguration, configurationFile);
  if (files.configuration) {
    const recorded = managedConfigurationSnapshot(files.configuration.value, configurationFile);
    need(originalConfiguration === null || same(originalConfiguration, recorded),
      'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_CHANGED');
    originalConfiguration = recorded;
  }
  if (configurationFile === null) {
    const empty = { path: null, sha256: null, profiles: [] };
    need(originalConfiguration === null || same(originalConfiguration, empty),
      'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_CHANGED');
    originalConfiguration = empty;
  }
  need(originalConfiguration !== null, 'SOURCE_CONTINUATION_CONFIGURATION_EVIDENCE_REQUIRED');
  need(!await exists(join(dirname(files.checkpoint.path), 'NATIVE_APPLICATIONS_RECEIVING_RESULT.json')),
    'SOURCE_CONTINUATION_COMPLETED_RECEIVING_EXISTS');
  // Keep the reviewed descriptor itself bound while reading its original sources.
  const after = await lstat(path);
  need(after.dev === info.dev && after.ino === info.ino && after.size === info.size &&
    after.mtimeMs === info.mtimeMs && after.ctimeMs === info.ctimeMs &&
    sha(await readFile(path)) === sha(bytes), 'SOURCE_CONTINUATION_DESCRIPTOR_CHANGED');
  return { path, bytes, sha256: sha(bytes), descriptor, files, previous, checkpoint, terminal, runtime,
    originalConfiguration };
}
async function publishOriginal(path, bytes) {
  const current = await exists(path);
  if (current) {
    need(current.isFile() && !current.isSymbolicLink() && (await readFile(path)).equals(bytes),
      'SOURCE_CONTINUATION_HISTORY_CHANGED');
    return;
  }
  const temporary = path + '.' + randomUUID() + '.next';
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await lstat(path);
      need(existing.isFile() && !existing.isSymbolicLink() && (await readFile(path)).equals(bytes),
        'SOURCE_CONTINUATION_HISTORY_CHANGED');
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function retainSourceContinuation(continuation, input, inputBytes, output, selected, receiver) {
  need(resolve(output) !== dirname(continuation.files.checkpoint.path) &&
    input.consoleDirectory !== continuation.previous.consoleDirectory &&
    input.runtimeHome !== continuation.previous.runtimeHome &&
    input.receivingDirectory !== continuation.previous.receivingDirectory,
  'SOURCE_CONTINUATION_SEPARATE_PREFIX_REQUIRED');
  need(selected.sourceCommit !== continuation.runtime.sourceCommit ||
    selected.sourceManifestSha256 !== continuation.runtime.sourceManifestSha256,
  'SOURCE_CONTINUATION_SOURCE_UNCHANGED');
  const root = join(output, 'source-history', continuation.sha256);
  await mkdir(root, { recursive: true, mode: 0o700 });
  need(await realpath(root) === root, 'SOURCE_CONTINUATION_HISTORY_PATH_CHANGED');
  await publishOriginal(join(root, 'continuation.json'), continuation.bytes);
  const originals = {};
  for (const [name, file] of Object.entries(continuation.files)) {
    await publishOriginal(join(root, name + '.json'), file.bytes);
    originals[name] = { path: join(root, name + '.json'), originalPath: file.path,
      bytes: file.bytes.length, sha256: file.sha256 };
  }
  const receipt = {
    schema: 'stellar-forge.coingecko-source-continuation-receipt.v1',
    businessOperation: input.operationPrefix, reason: continuation.descriptor.reason,
    descriptor: { path: continuation.path, bytes: continuation.bytes.length, sha256: continuation.sha256 },
    predecessor: originals, originalBinding: continuation.checkpoint.originalBinding,
    originalRuntime: continuation.runtime, originalTerminal: continuation.terminal,
    originalConfiguration: continuation.originalConfiguration,
    receiver, originalConfiguredDriver: input.sourceContinuationReceiver?.originalDriver ?? null,
    successorManifestSha256: sha(inputBytes),
    selectedRuntime: Object.fromEntries(['schema', 'state', 'directory', 'installationId', 'profileId',
      'profileSha256', 'lockSha256', 'sourceCommit', 'sourceManifestSha256', 'sourceRoot', 'dependencyRoot']
      .map(key => [key, selected[key] ?? null])),
  };
  const receiptPath = join(root, 'SOURCE_CONTINUATION_RECEIPT.json');
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  await publishOriginal(receiptPath, receiptBytes);
  return { path: receiptPath, bytes: receiptBytes.length, sha256: sha(receiptBytes),
    descriptorSha256: continuation.sha256,
    predecessorManifestSha256: continuation.files.manifest.sha256,
    predecessorCheckpointSha256: continuation.files.checkpoint.sha256,
    predecessorSourceCommit: continuation.runtime.sourceCommit,
    selectedSourceCommit: selected.sourceCommit };
}

export async function receiveCoinGeckoApplication({ manifest, output }) {
  manifest = resolve(manifest); output = resolve(output);
  const inputBytes = await readFile(manifest), input = JSON.parse(inputBytes);
  need(input.schema === 'stellar-forge.coingecko-applications-receiving.v1' &&
    typeof input.operationPrefix === 'string' && input.operationPrefix.length < 160 &&
    /^[a-f0-9-]{36}$/.test(input.projectId ?? '') && Array.isArray(input.originalSources) &&
    input.originalSources.length > 0 && typeof input.playwrightModule === 'string' && input.playwrightModule.length > 0 &&
    input.originalSources.every(item =>
      plain(item) && typeof item.fileId === 'string' && HASH.test(item.sha256)),
  'ORIGINAL_RECEIVING_SELECTION_REQUIRED');
  need(input.browserArgs === undefined || Array.isArray(input.browserArgs) &&
    input.browserArgs.length <= 32 &&
    input.browserArgs.every(value => typeof value === 'string' && value.length <= 4096),
  'BROWSER_ARGUMENTS_INVALID');
  need(input.allowLocalMerchant === undefined || typeof input.allowLocalMerchant === 'boolean',
    'LOCAL_MERCHANT_SELECTION_INVALID');
  let continuation = null, receiver = null;
  if (input.sourceContinuation !== undefined) {
    need(plain(input.sourceContinuation) && typeof input.sourceContinuation.path === 'string' &&
      HASH.test(input.sourceContinuation.sha256 ?? ''), 'SOURCE_CONTINUATION_SELECTION_REQUIRED');
    continuation = await readCoinGeckoSourceContinuation(input.sourceContinuation.path, input);
    need(continuation.sha256 === input.sourceContinuation.sha256, 'SOURCE_CONTINUATION_SELECTION_CHANGED');
    need(output !== dirname(continuation.files.checkpoint.path), 'SOURCE_CONTINUATION_SEPARATE_PREFIX_REQUIRED');
    receiver = await receivingDriverIdentity();
    if (input.sourceContinuationReceiver !== undefined) {
      const pinned = input.sourceContinuationReceiver;
      need(plain(pinned) && pinned.path === receiver.path && pinned.sha256 === receiver.sha256 &&
        typeof pinned.originalDriver === 'string' && pinned.originalDriver.length > 0,
      'SOURCE_CONTINUATION_RECEIVER_CHANGED');
    }
  } else need(input.sourceContinuationReceiver === undefined, 'SOURCE_CONTINUATION_SELECTION_REQUIRED');
  await mkdir(output, { recursive: true, mode: 0o700 });
  if (continuation) need(await realpath(output) === output, 'SOURCE_CONTINUATION_OUTPUT_PATH_CHANGED');
  const checkpointPath = join(output, 'application-checkpoint.json');
  let state = await exists(checkpointPath) ? await json(checkpointPath) : {
    schema: 'stellar-forge.coingecko-applications-checkpoint.v1',
    manifestSha256: sha(inputBytes), createdAt: new Date().toISOString(),
    requests: {}, completed: {}, runs: {},
  };
  need(state.manifestSha256 === sha(inputBytes), 'ORIGINAL_RECEIVING_MANIFEST_CHANGED');
  if (continuation) {
    if (state.sourceContinuation) {
      need(state.sourceContinuation.descriptorSha256 === continuation.sha256 &&
        state.sourceContinuation.predecessorManifestSha256 === continuation.files.manifest.sha256,
      'SOURCE_CONTINUATION_CHECKPOINT_CHANGED');
    } else {
      need(noApplicationEffects(state) && !state.runtimeId && !state.originalBinding,
        'SOURCE_CONTINUATION_PREFIX_ALREADY_USED');
      state.sourceContinuation = { descriptorSha256: continuation.sha256,
        predecessorManifestSha256: continuation.files.manifest.sha256 };
      state.originalBinding = continuation.checkpoint.originalBinding;
      state.originalStartedAt = continuation.checkpoint.originalStartedAt ?? continuation.checkpoint.createdAt;
    }
  } else need(!state.sourceContinuation, 'SOURCE_CONTINUATION_SELECTION_REQUIRED');
  const persist = () => save(checkpointPath, state);
  await persist();
  const report = (name, value) => process.stdout.write(JSON.stringify({
    stage: name, at: new Date().toISOString(), ...value,
  }) + '\n');
  const stage = async (name, fn) => {
    if (state.completed[name]) { report(name, { reopened: true }); return state.completed[name]; }
    const result = await fn();
    state.completed[name] = { ...result, completedAt: new Date().toISOString() };
    await persist(); report(name, { completed: true, ...result }); return result;
  };
  const source = resolve(input.sourceRoot), runtime = resolve(input.runtimeDirectory);
  const market = resolve(input.workspaceDirectory), projectId = input.projectId;
  need(await realpath(source) === source && await realpath(runtime) === runtime &&
    await realpath(market) === market, 'ORIGINAL_CANONICAL_PATHS_REQUIRED');
  const { inspectMerchantRuntime } = await originalModule(source, B + 'sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtime, { load: false,
    ...(input.sourceManifestSha256 ? { expectedManifest: input.sourceManifestSha256 } : {}) });
  need(selected.sourceRoot === source && selected.state === 'READY', 'SELECTED_INSTALLED_SOURCE_REQUIRED');
  const native = await originalModule(source, C + 'workspace/managed.mjs');
  const observedConfiguration = managedConfigurationSnapshot(
    await native.readMarketManagedConfiguration(input.configurationFile ? resolve(input.configurationFile) : null),
    input.configurationFile ?? null);
  if (continuation) need(same(observedConfiguration, continuation.originalConfiguration),
    'SOURCE_CONTINUATION_CONFIGURATION_CHANGED');
  if (state.originalConfiguration !== undefined)
    need(same(state.originalConfiguration, observedConfiguration), 'ORIGINAL_MANAGED_CONFIGURATION_CHANGED');
  else {
    state.originalConfiguration = observedConfiguration;
    await persist();
  }
  const observedBinding = await native.inspectMarketBinding(market, { projectId });
  if (!state.originalBinding) {
    state.originalBinding = observedBinding;
    await persist();
  }
  const initialBinding = state.originalBinding;
  need(observedBinding.identity.device === initialBinding.identity.device &&
    observedBinding.identity.inode === initialBinding.identity.inode &&
    observedBinding.database.device === initialBinding.database.device &&
    observedBinding.database.inode === initialBinding.database.inode,
  'ORIGINAL_DATABASE_REPLACED');
  if (continuation) {
    const receipt = await retainSourceContinuation(continuation, input, inputBytes, output, selected, receiver);
    state.sourceContinuation = receipt;
    await persist();
    report('corrected-source-continuation', { ...receipt, originalDatabaseRetained: true });
  }
  const { createRuntimeWorkspace, openRuntimeWorkspace } = await originalModule(source, R + 'model.mjs');
  const consoleDirectory = resolve(input.consoleDirectory);
  if (!await exists(join(consoleDirectory, 'workspace.json'))) {
    await createRuntimeWorkspace({ directory: consoleDirectory, runtimeHome: resolve(input.runtimeHome) });
  }
  let model = await openRuntimeWorkspace({ directory: consoleDirectory }), activeRun = null;
  const application = async () => {
    const list = await model.applicationsState();
    const rows = list.applications ?? list.items;
    need(Array.isArray(rows), 'APPLICATION_CATALOG_RESPONSE_REQUIRED');
    return rows.find(item => item.id === state.applicationId);
  };
  async function waitFor(name, observe, accept, milliseconds = 180000) {
    const end = Date.now() + milliseconds; let current;
    while (Date.now() < end) {
      current = await observe();
      if (accept(current)) return current;
      if (current && (['FAILED', 'LAUNCH_FAILED', 'UNAVAILABLE'].includes(current.phase) ||
          name === 'connection' && ['FAILED', 'LAUNCH_FAILED', 'INTERRUPTED'].includes(current.adoption?.phase)) && name !== 'ended')
        throw Object.assign(new Error(name + ' failed: ' + JSON.stringify(current.result ?? current.error ?? current)),
          { code: 'ORIGINAL_APPLICATION_FAILED' });
      await delay(750);
    }
    throw Object.assign(new Error(name + ' did not finish; reopen the retained operation.'),
      { code: 'ORIGINAL_OPERATION_RETAINED', current });
  }
  async function api(url, path, options = {}) {
    const target = new URL(path, new URL(url).origin);
    const response = await fetch(target, { ...options, redirect: 'error',
      headers: { accept: 'application/json', ...(options.body ? {
        'content-type': 'application/json', 'x-workspace-request': '1',
      } : {}), ...options.headers }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Object.assign(new Error(await response.text()),
      { code: 'ORIGINAL_HTTP_' + response.status });
    return response.json();
  }
  async function download(url, path) {
    const response = await fetch(new URL(path, new URL(url).origin), {
      redirect: 'error', signal: AbortSignal.timeout(120000),
    });
    need(response.ok, 'ORIGINAL_DOWNLOAD_FAILED');
    return Buffer.from(await response.arrayBuffer());
  }
  async function list(url, kind, selectedProject = projectId) {
    const items = [];
    for (let offset = 0; ; ) {
      const page = await api(url, '/api/projects/' + selectedProject + '/' + kind + '?offset=' + offset + '&limit=100');
      need(Array.isArray(page.items) && Number.isSafeInteger(page.total), 'ORIGINAL_PAGE_REQUIRED');
      items.push(...page.items); offset += page.items.length;
      if (offset >= page.total) return items;
      need(page.items.length > 0, 'ORIGINAL_PAGE_INCOMPLETE');
    }
  }
  async function sources(url, selectedProject = projectId, restored = false) {
    const files = await list(url, 'files', selectedProject), observed = [];
    for (const original of input.originalSources) {
      const file = files.find(item => restored ? item.sha256 === original.sha256 : item.id === original.fileId);
      need(file && file.sha256 === original.sha256, 'ORIGINAL_SOURCE_METADATA_CHANGED');
      const bytes = await download(url, '/api/files/' + file.id + '/download');
      need(sha(bytes) === original.sha256, 'ORIGINAL_SOURCE_BYTES_CHANGED');
      observed.push({ originalFileId: original.fileId, fileId: file.id, bytes: bytes.length, sha256: sha(bytes) });
    }
    return observed;
  }
  async function retainedWrite(url, key, path, body, selectedProject = projectId) {
    if (!state.requests[key]) {
      const project = selectedProject ? await api(url, '/api/projects/' + selectedProject) : null;
      state.requests[key] = { path, body: { actor: input.actor ?? 'CoinGecko receiving operator',
        opId: input.operationPrefix + ':' + key, ...(project ? { revision: project.project.revision } : {}),
        ...body } };
      await persist();
    }
    const original = state.requests[key];
    need(original.path === path, 'ORIGINAL_WRITE_TARGET_CHANGED');
    return api(url, original.path, { method: 'POST', body: JSON.stringify(original.body) });
  }
  const unfinished = run => Boolean(run && (run.active ||
    ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(run.phase)));
  const originalRun = (current, id) => current?.current?.id === id ? current.current :
    current?.runs?.find(item => item.id === id);
  async function recoverRun(run) {
    let current = await application(), retained = originalRun(current, run.requestId);
    if (!unfinished(retained) || retained.active) return current;
    let recovery;
    try {
      recovery = await model.applicationsRecover({ applicationId: state.applicationId,
        operationId: run.requestId });
    } catch (error) {
      if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING') throw error;
      return application();
    }
    (run.recoveries ??= []).push({ observedAt: new Date().toISOString(), result: recovery });
    await persist();
    current = await application();
    if (recovery.commandActive && !originalRun(current, run.requestId)?.active) {
      // The native lifecycle recognizes a surviving command with a lost worker.
      // Stop that same recorded command before giving a later start a new ID.
      await stopRun(run);
      return application();
    }
    return current;
  }
  async function running(run, name) {
    activeRun = run.requestId;
    const current = await waitFor(name, application, value => {
      need(value?.current?.id === run.requestId, 'ORIGINAL_APPLICATION_RUN_CHANGED');
      need(unfinished(value.current) && !value.current.stop, 'ORIGINAL_APPLICATION_RUN_ENDED');
      return Boolean(value.current.privateUrl);
    });
    run.url = current.current.privateUrl;
    run.launch = await api(run.url, '/api/managed-launch');
    need(new URL(run.url).searchParams.get('project') === projectId &&
      run.launch.directory === market && run.launch.workspace.project.id === projectId,
    'ORIGINAL_PROJECT_DEEP_LINK_CHANGED');
    await persist();
    return current;
  }
  async function start(name) {
    let run = state.runs[name] ??= {
      requestId: uuidFor(input.operationPrefix + ':' + name), previous: [],
    };
    await persist();
    let current = await application();
    need(!unfinished(current?.current) || current.current.id === run.requestId,
      'ANOTHER_ORIGINAL_APPLICATION_RUN_IS_UNFINISHED');
    let retained = originalRun(current, run.requestId);
    if (unfinished(retained)) {
      if (retained.stop) await stopRun(run);
      else current = await recoverRun(run);
      current = await application();
      retained = originalRun(current, run.requestId);
      if (unfinished(retained)) return running(run, name);
    }
    if (retained) {
      run.terminal = { phase: retained.phase, result: retained.result ?? null,
        observedAt: new Date().toISOString() };
      const previous = [...(run.previous ?? []),
        Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'previous'))];
      run = state.runs[name] = {
        requestId: uuidFor(input.operationPrefix + ':' + name + ':' + previous.length), previous,
      };
      await persist();
    }
    if (!run.reviewId) {
      const review = await model.applicationsStartReview({ applicationId: state.applicationId });
      run.reviewId = review.id; run.selection = review.command.args;
      await persist();
    }
    const started = await model.applicationsStart({ applicationId: state.applicationId,
      requestId: run.requestId, reviewId: run.reviewId });
    need(started.operationId === run.requestId, 'ORIGINAL_APPLICATION_RUN_CHANGED');
    return running(run, name);
  }
  async function stopRun(run) {
    let current = await application(), retained = originalRun(current, run.requestId);
    if (unfinished(retained)) {
      await model.applicationsStop({ applicationId: state.applicationId, operationId: run.requestId });
      const deadline = Date.now() + 120000;
      for (;;) {
        current = await application(); retained = originalRun(current, run.requestId);
        if (!unfinished(retained)) break;
        if (retained.phase === 'INTERRUPTED' && !retained.active) {
          // A dead worker cannot consume its retained stop marker. The original
          // recovery records its observed end without relaunching that command.
          try {
            const result = await model.applicationsRecover({
              applicationId: state.applicationId, operationId: run.requestId,
            });
            (run.recoveries ??= []).push({ observedAt: new Date().toISOString(), result });
            await persist();
          } catch (error) {
            if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING') throw error;
          }
        }
        if (Date.now() >= deadline) throw Object.assign(
          new Error('Original application shutdown remains retained at ' + retained.phase),
          { code: 'ORIGINAL_OPERATION_RETAINED', current: retained });
        await delay(750);
      }
    }
    if (retained) {
      run.terminal = { phase: retained.phase, result: retained.result ?? null,
        observedAt: new Date().toISOString() };
      await persist();
    }
    if (activeRun === run.requestId) activeRun = null;
  }
  async function stop(name) {
    const run = state.runs[name];
    if (!run) return;
    await stopRun(run);
    if (run.launch) {
      const record = await native.readMarketLaunch(join(market, 'managed-launches', run.launch.instanceId + '.json'));
      need(record.status === 'CLOSED', 'ORIGINAL_LAUNCH_NOT_CLOSED');
    }
    need(!(await exists(join(market, 'operator-runtime.json'))), 'ORIGINAL_WORKSPACE_LEASE_RETAINED');
  }
  try {
    await stage('attach-save-connect', async () => {
      const attached = await model.attach({ directory: runtime, label: 'CoinGecko original managed receiving' });
      state.runtimeId = attached.runtimeId; await persist();
      if (!state.reviewId) {
        const review = await model.applicationsReview({
          runtimeId: state.runtimeId, kind: 'coingecko', label: input.applicationLabel ?? 'CoinGecko retained research',
          settings: { workspaceDirectory: market, projectId, port: input.port ?? 0,
            ...(input.configurationFile ? { configurationFile: resolve(input.configurationFile) } : {}),
            ...(input.allowLocalMerchant === true ? { allowLocalMerchant: true } : {}) },
        });
        state.reviewId = review.id; await persist();
      }
      const saved = await model.applicationsSave({ requestId: uuidFor(input.operationPrefix + ':save'),
        reviewId: state.reviewId });
      state.applicationId = saved.applicationId; await persist();
      if (saved.connectionError) {
        (state.connectionErrors ??= []).push({
          observedAt: new Date().toISOString(), error: saved.connectionError,
        });
        await persist();
      }
      // Saving is idempotent; the native connect operation also resumes a
      // retained queued or interrupted adoption of this exact installation.
      state.connection = await model.applicationsConnect({ applicationId: state.applicationId });
      await persist();
      const ready = await waitFor('connection', application, value => Boolean(value?.release), 300000);
      need(ready.release.sourceCommit === selected.sourceCommit, 'ORIGINAL_APPLICATION_SOURCE_CHANGED');
      return { runtimeId: attached.runtimeId, applicationId: state.applicationId,
        releaseId: ready.release.id, sourceCommit: selected.sourceCommit, originalProjectId: projectId };
    });
    await stage('start-original-research', async () => {
      const current = await start('first'), url = current.current.privateUrl;
      const project = await api(url, '/api/projects/' + projectId);
      const originals = await sources(url);
      const rows = {};
      for (const kind of ['requests','collections','captures','snapshots','comparisons','notes','provider-plans','jobs'])
        rows[kind] = (await list(url, kind)).length;
      need(rows.requests >= 5 && rows.captures >= 10 && rows.snapshots >= 2 && rows.comparisons >= 1,
        'COMPLETE_ORIGINAL_RESEARCH_REQUIRED');
      state.originalCounts = rows; await persist();
      return { projectId, revision: project.project.revision, originalSources: originals, counts: rows,
        instanceId: state.runs.first.launch.instanceId };
    });
    if (!state.completed['stop-and-reopen']) {
      let current = await application();
      if (!current?.current?.active) current = await start('first');
      await stage('research-edit-and-browser', async () => {
        const url = current.current.privateUrl, comparisons = await list(url, 'comparisons');
        const note = await retainedWrite(url, 'managed-research-note', '/api/projects/' + projectId + '/notes', {
          note: { targetType: 'comparison', targetId: comparisons[0].id,
            title: 'Managed research delivery and source continuity',
            text: 'This comparison retains the original five CoinGecko endpoint families and their captured provider sources. The installed Applications workflow opens this same project, its request collection, snapshots and provider plan. Source downloads were checked against the original input hashes. Future acquisition should be evaluated against the original request and provider observation time recorded in each capture.',
            type: 'research', status: 'reviewed',
            sourceFileIds: input.originalSources.map(item => item.fileId) },
        });
        let browserResult = null;
        if (input.playwrightModule) {
          const imported = await import(pathToFileURL(resolve(input.playwrightModule)).href);
          const chromium = imported.chromium ?? imported.default?.chromium;
          need(chromium, 'ORIGINAL_BROWSER_RUNTIME_REQUIRED');
          const browserArgs = input.browserArgs ??
            (process.platform === 'linux' && process.getuid?.() === 0 ?
              ['--no-sandbox', '--disable-dev-shm-usage'] : []);
          const browser = await chromium.launch({ headless: true, args: browserArgs,
            ...(input.browserExecutable ? { executablePath: resolve(input.browserExecutable) } : {}) });
          try {
            const errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
            await page.locator('#project-select').waitFor();
            need(await page.locator('#project-select').inputValue() === projectId, 'BROWSER_PROJECT_SELECTION_CHANGED');
            need(!/could not open/i.test(await page.locator('#main').innerText()), 'BROWSER_WORKSPACE_FAILED');
            await page.screenshot({ path: join(output, 'coingecko-managed-desktop.png'), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({ path: join(output, 'coingecko-managed-mobile.png'), fullPage: true });
            need(errors.length === 0, 'BROWSER_RUNTIME_ERROR');
            browserResult = { desktop: [1440,960], mobile: [390,844], errors };
            await context.close();
          } finally { await browser.close(); }
        }
        return { noteId: note.value.id, originalComparisonId: comparisons[0].id, browser: browserResult };
      });
    }
    await stage('stop-and-reopen', async () => {
      await stop('first'); await model.close();
      model = await openRuntimeWorkspace({ directory: consoleDirectory });
      const current = await start('second'), originalSources = await sources(current.current.privateUrl);
      need(state.runs.first.launch.instanceId !== state.runs.second.launch.instanceId,
        'REOPENED_INSTANCE_ID_REUSED');
      return { applicationId: state.applicationId, projectId, originalSources,
        closedInstanceId: state.runs.first.launch.instanceId,
        reopenedInstanceId: state.runs.second.launch.instanceId };
    });
    if (!state.completed['interrupt-and-recover'] && !state.runs.second.interrupted) {
      const current = await application();
      if (!current?.current?.active) await start('second');
    }
    await stage('interrupt-and-recover', async () => {
      let current = await application(), run = state.runs.second;
      if (!run.interrupted) {
        need(current?.current?.id === run.requestId && current.current.active, 'ORIGINAL_INTERRUPT_TARGET_REQUIRED');
        const live = await api(current.current.privateUrl, '/api/managed-launch');
        need(live.instanceId === run.launch.instanceId && live.pid === run.launch.pid, 'ORIGINAL_INTERRUPT_INSTANCE_CHANGED');
        run.interrupted = { instanceId: live.instanceId, pid: live.pid, at: new Date().toISOString() };
        await persist();
      }
      current = await application();
      if (current?.current?.id === run.requestId && current.current.active) {
        const live = await api(current.current.privateUrl, '/api/managed-launch');
        need(live.instanceId === run.interrupted.instanceId && live.pid === run.interrupted.pid,
          'ORIGINAL_INTERRUPT_INSTANCE_CHANGED');
        try { process.kill(live.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await waitFor('ended', application, value => !value?.current?.active, 120000);
      activeRun = null;
      current = await recoverRun(run);
      const ended = originalRun(current, run.requestId);
      need(!unfinished(ended) && !ended?.privateUrl, 'INTERRUPTED_RUN_NOT_RECONCILED');
      current = await start('recovered');
      const originalSources = await sources(current.current.privateUrl);
      return { originalRunId: run.requestId, originalInstance: run.interrupted,
        recoveredRunId: state.runs.recovered.requestId, projectId, originalSources };
    });
    if (!state.completed['final-stop-and-reopen-data']) {
      const current = await application();
      if (!current?.current?.active) await start('recovered');
    }
    await stage('handover-source-and-receiving', async () => {
      const current = await application();
      need(current?.current?.privateUrl, 'ORIGINAL_RECOVERED_APPLICATION_REQUIRED');
      const url = current.current.privateUrl;
      const result = await retainedWrite(url, 'complete-managed-handover', '/api/projects/' + projectId + '/exports',
        { name: 'Complete CoinGecko managed research and recovery' });
      const bytes = await download(url, '/api/exports/' + result.value.id + '/download');
      const archivePath = join(output, 'coingecko-managed-complete-handover.json.gz');
      await writeFile(archivePath, bytes, { mode: 0o600 });
      const recovery = await originalModule(source, C + 'workspace/recovery.mjs');
      const archive = recovery.readProjectArchive(bytes);
      need(archive.runtime.files.some(file => file.path.endsWith('/workspace/managed.mjs')),
        'PORTABLE_MANAGED_LAUNCH_SOURCE_MISSING');
      const { startMarketWorkspace } = await originalModule(source, C + 'workspace/server.mjs');
      const receiving = await startMarketWorkspace({ directory: resolve(input.receivingDirectory), port: 0 });
      try {
        const restored = await retainedWrite(receiving.url, 'receive-complete-managed-handover', '/api/restore',
          { name: 'Received CoinGecko managed research', contentBase64: bytes.toString('base64') }, null);
        const restoredId = restored.value.project.id;
        const originalSources = await sources(receiving.url, restoredId, true);
        state.receivedProjectId = restoredId; await persist();
        return { exportId: result.value.id, archivePath, bytes: bytes.length, sha256: sha(bytes),
          restoredProjectId: restoredId, originalSources, runtimeFiles: archive.runtime.files.length };
      } finally { await receiving.close(); }
    });
    await stage('final-stop-and-reopen-data', async () => {
      await stop('recovered');
      const binding = await native.inspectMarketBinding(market, { projectId });
      need(binding.identity.device === initialBinding.identity.device &&
        binding.identity.inode === initialBinding.identity.inode &&
        binding.database.device === initialBinding.database.device &&
        binding.database.inode === initialBinding.database.inode,
      'ORIGINAL_DATABASE_REPLACED');
      const { MarketModel } = await originalModule(source, C + 'workspace/model.mjs');
      const retained = new MarketModel(market), received = new MarketModel(resolve(input.receivingDirectory));
      try {
        const original = retained.project(projectId), restored = received.project(state.receivedProjectId);
        need(original.counts.jobs === state.originalCounts.jobs, 'UNREQUESTED_NATIVE_JOB_CREATED');
        return { projectId, receivedProjectId: state.receivedProjectId, counts: original.counts,
          receivedCounts: restored.counts, originalDatabase: binding.database, newPurchases: 0 };
      } finally { received.close(); retained.close(); }
    });
    const result = { schema: 'stellar-forge.coingecko-applications-receiving-result.v1',
      completedAt: new Date().toISOString(), applicationId: state.applicationId,
      projectId, receivedProjectId: state.receivedProjectId, runtimeDirectory: runtime,
      sourceCommit: selected.sourceCommit, sourceManifestSha256: selected.sourceManifestSha256,
      stages: state.completed, runs: state.runs,
      ...(state.sourceContinuation ? { sourceContinuation: state.sourceContinuation } : {}), newPurchases: 0 };
    await save(join(output, 'NATIVE_APPLICATIONS_RECEIVING_RESULT.json'), result);
    return result;
  } finally {
    if (activeRun) {
      const current = await application().catch(() => null);
      if (current?.current?.id === activeRun && current.current.active) {
        const owned = Object.values(state.runs).find(run => run.requestId === activeRun);
        if (owned) await stopRun(owned).catch(() => {});
      }
    }
    await model.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    need(['--manifest','--out'].includes(args[i]) && args[i + 1], 'USE_MANIFEST_AND_OUT');
    options[args[i].slice(2)] = args[i + 1];
  }
  receiveCoinGeckoApplication({ manifest: options.manifest, output: options.out }).then(result =>
    process.stdout.write(JSON.stringify({ complete: true, applicationId: result.applicationId,
      projectId: result.projectId, stages: Object.keys(result.stages).length, newPurchases: 0 }) + '\n')
  ).catch(error => { process.stderr.write(JSON.stringify({ code: error.code, message: error.message,
    stack: error.stack }) + '\n'); process.exitCode = 1; });
}
