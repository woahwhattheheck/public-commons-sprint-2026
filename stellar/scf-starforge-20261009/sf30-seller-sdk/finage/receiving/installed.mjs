// MIT. Installed entrypoints for the original Finage customer receiving operation.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:os';
import { readDistributionSpecification } from '../../../distribution/specification.mjs';

const SOURCE_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const PRODUCT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/finage';
const DISTRIBUTION = 'stellar/scf-starforge-20261009/distribution';
const SHARED = 'stellar/scf-starforge-20261009/sf30-seller-sdk/databento/receiving/receiver.py';
export const FINAGE_RECEIVING_OPERATION_SCHEMA = 'finage.customer-receiving-operation/v1';
export const FINAGE_RECEIVING_INSTALLATION_SCHEMA = 'finage.customer-receiving-installation/v1';
export const FINAGE_RECEIVING_SOURCE_FILES = Object.freeze([
  SHARED,
  'stellar/scf-starforge-20261009/sf30-seller-sdk/databento/receiving/README.md',
  PRODUCT + '/warehouse.mjs',
  PRODUCT + '/receiving/receiver.py',
  PRODUCT + '/receiving/README.md',
  PRODUCT + '/receiving/operate.py',
  PRODUCT + '/receiving/read-views.mjs',
  PRODUCT + '/receiving/OPERATE.md',
  PRODUCT + '/receiving/installed.mjs',
  PRODUCT + '/receiving/cli.mjs',
  DISTRIBUTION + '/FINAGE.md',
  DISTRIBUTION + '/contributions/finage.json',
  DISTRIBUTION + '/specification.mjs',
]);
const EXECUTION_FILES = Object.freeze([
  SHARED, PRODUCT + '/receiving/receiver.py',
  PRODUCT + '/receiving/operate.py', PRODUCT + '/receiving/read-views.mjs',
]);
const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONFIG_LIMIT = 1024 * 1024;
const MANIFEST_LIMIT = 32 * 1024 * 1024;
const CHECKPOINT_LIMIT = 16 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = data => createHash('sha256').update(data).digest('hex');
const now = () => new Date().toISOString();

export class FinageReceivingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FinageReceivingError';
    this.code = code;
    this.details = details;
  }
}
function require(value, code, message, details) {
  if (!value) throw new FinageReceivingError(code, message, details);
}
function text(value, label, maximum = 4096) {
  require(typeof value === 'string' && value.trim() && value.length <= maximum && !value.includes('\0'),
    'CONFIGURATION', 'Provide ' + label + ' as a nonempty string.');
  return value;
}
function absolute(value, label) {
  return resolve(text(value, label));
}
function within(root, filename) {
  const value = relative(root, filename);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('../'));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function equal(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
async function document(filename, maximum = CONFIG_LIMIT, optional = false) {
  let info;
  try { info = await lstat(filename); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  require(info.isFile() && !info.isSymbolicLink() && info.size <= maximum,
    'DOCUMENT', 'Select a regular original JSON file within its supported size.', { path: filename, maximum });
  const bytes = await readFile(filename);
  require(bytes.length <= maximum, 'DOCUMENT_SIZE', 'The JSON document grew while reading.', { path: filename });
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { throw new FinageReceivingError('DOCUMENT_JSON', 'The original document is not complete UTF-8 JSON.',
    { path: filename, message: error.message }); }
  require(plain(value), 'DOCUMENT_JSON', 'The original document must be a JSON object.', { path: filename });
  return { path: filename, value, bytes: bytes.length, sha256: sha(bytes) };
}
async function identity(filename) {
  const info = await lstat(filename);
  require(info.isFile() && !info.isSymbolicLink(), 'SOURCE_FILE', 'Select the original regular source file.', { path: filename });
  const digest = createHash('sha256'), git = createHash('sha1');
  git.update('blob ' + info.size + '\0');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length; digest.update(chunk); git.update(chunk);
  }
  require(bytes === info.size, 'SOURCE_CHANGED', 'The selected file changed while reading.', { path: filename });
  return { bytes, sha256: digest.digest('hex'), gitBlob: git.digest('hex') };
}
async function sourceFile(root, path) {
  const absolutePath = await realpath(resolve(root, path));
  require(within(root, absolutePath), 'SOURCE_PATH', 'The original receiving source leaves the selected installation.', { path });
  return { path, absolutePath, ...await identity(absolutePath) };
}

/** Inspect the real installed manifest and every original receiving dependency. */
export async function inspectFinageReceivingInstallation({ sourceCommit } = {}) {
  if (sourceCommit !== undefined) require(COMMIT.test(sourceCommit), 'SOURCE_COMMIT', 'Use a full forty-character Git commit.');
  const root = await realpath(SOURCE_ROOT);
  const distribution = await readDistributionSpecification({ sourceRoot: root });
  const manifest = distribution.manifest;
  if (manifest && sourceCommit !== undefined) {
    require(manifest.sourceCommit === sourceCommit, 'SOURCE_COMMIT',
      'The requested commit differs from this installed original archive.',
      { requested: sourceCommit, installed: manifest.sourceCommit });
  }
  const registration = distribution.sources.find(item => item.id === 'finage');
  require(registration, 'FINAGE_REGISTRATION', 'This source has no Finage distribution contribution.');
  require(distribution.spec.commands['finage-warehouse'] === PRODUCT + '/warehouse.mjs' &&
    distribution.spec.commands['finage-receive'] === PRODUCT + '/receiving/cli.mjs',
    'FINAGE_REGISTRATION', 'The installed commands do not select the original Finage receiving entries.');
  const expected = new Map((manifest?.files ?? []).map(item => [item.path, item]));
  const files = [];
  for (const path of FINAGE_RECEIVING_SOURCE_FILES) {
    const file = await sourceFile(root, path);
    if (manifest) {
      const entry = expected.get(path);
      require(entry && entry.bytes === file.bytes && entry.sha256 === file.sha256 && entry.gitBlob === file.gitBlob,
        'INSTALLED_SOURCE_CHANGED', 'The original receiving file differs from the installed archive manifest.', { path });
    }
    files.push(file);
  }
  return {
    schema: FINAGE_RECEIVING_INSTALLATION_SCHEMA,
    sourceRoot: root, sourceCommit: manifest?.sourceCommit ?? sourceCommit ?? null,
    sourceBasis: manifest ? 'original installed archive manifest and actual source bytes' :
      'actual source bytes; Git commit is an explicit operator declaration',
    installedArchive: Boolean(manifest),
    packageName: distribution.spec.name,
    packageVersion: manifest?.packageVersion ?? null,
    registration: { id: registration.id, path: registration.path },
    files,
    commands: {
      warehouse: 'starforge finage-warehouse',
      receiving: 'starforge finage-receive',
    },
    receiver: resolve(root, PRODUCT, 'receiving/receiver.py'),
    program: resolve(root, PRODUCT, 'receiving/operate.py'),
    reader: resolve(root, PRODUCT, 'receiving/read-views.mjs'),
    guide: resolve(root, DISTRIBUTION, 'FINAGE.md'),
    python: { minimum: '3.11', platform: 'Linux/macOS', dependencies: 'standard library only' },
    browser: 'The complete operated reading stage uses an explicitly selected existing Chromium and Playwright runtime.',
  };
}

async function selectedDelivery(selection) {
  const supplied = typeof selection === 'string' ? { directory: selection } : selection;
  require(plain(supplied), 'DELIVERY_SELECTION', 'Select each actual original complete export directory.');
  const directory = await realpath(absolute(supplied.directory, 'the original export directory'));
  const info = await lstat(directory);
  require(info.isDirectory(), 'DELIVERY_DIRECTORY', 'The selected export must be a directory.');
  const manifest = await document(resolve(directory, 'manifest.json'), MANIFEST_LIMIT);
  if (supplied.manifest_sha256 !== undefined) {
    require(HASH.test(supplied.manifest_sha256) && supplied.manifest_sha256 === manifest.sha256,
      'MANIFEST_CHANGED', 'The selected original export manifest differs from its supplied identity.');
  }
  const value = manifest.value;
  require(value.schema === 'tj.finage-market-delivery.v1' &&
    ['customer', 'operator'].includes(value.audience) &&
    value.allSelectedRecordsProcessed === true && typeof value.assessmentReady === 'boolean' &&
    Number.isSafeInteger(value.customerRecords) && value.customerRecords > 0 &&
    typeof value.editionId === 'string' && value.editionId,
    'FINAGE_DELIVERY', 'Select an original complete Finage export with customer rows.');
  return {
    selection: { directory, manifest_sha256: manifest.sha256,
      label: supplied.label === undefined ? value.editionId : text(supplied.label, 'the original export label') },
    original: { editionId: value.editionId, audience: value.audience,
      customerRecords: value.customerRecords, assessmentReady: value.assessmentReady,
      sourceCoverage: value.sourceCoverage, manifest: { bytes: manifest.bytes, sha256: manifest.sha256 } },
  };
}
function browserConfiguration(value) {
  if (value === undefined) return undefined;
  require(plain(value) && Object.keys(value).every(key => ['node', 'playwright_module', 'chromium_executable'].includes(key)),
    'BROWSER_CONFIGURATION', 'Use the existing Node, Playwright module and Chromium executable paths.');
  return {
    node: absolute(value.node ?? process.execPath, 'the browser Node executable'),
    playwright_module: absolute(value.playwright_module, 'the existing Playwright module'),
    chromium_executable: absolute(value.chromium_executable, 'the existing Chromium executable'),
  };
}
async function createConfiguration(filename, config) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temp = resolve(dirname(filename), '.' + basename(filename) + '.pending-' + randomUUID());
  const bytes = Buffer.from(json(config), 'utf8');
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    try {
      await link(temp, filename);
      const parent = await open(dirname(filename), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return { reused: false, path: filename, bytes: bytes.length, sha256: sha(bytes) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await document(filename);
      require(equal(previous.value, config), 'CONFIGURATION_EXISTS',
        'This configuration already identifies another receiving operation; its original bytes are preserved.',
        { path: filename });
      return { reused: true, path: filename, bytes: previous.bytes, sha256: previous.sha256 };
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Prepare only the existing operation's configuration; no rows, decisions or provider calls are made. */
export async function prepareFinageReceivingOperation({
  operationId, actor, output, configFile, deliveries, filter, sourceCommit,
  python = process.env.FINAGE_PYTHON_EXECUTABLE || 'python3', browser,
} = {}) {
  text(operationId, 'a stable receiving operation ID', 512);
  text(actor, 'the named receiving operator', 512);
  text(python, 'the selected Python executable');
  require(Array.isArray(deliveries) && deliveries.length === 2, 'DELIVERY_SELECTION',
    'Select the two actual original customer exports in their intended order.');
  if (filter !== undefined) require(plain(filter), 'QUERY_FILTER', 'The optional filter is one original exact-text query object.');
  const installation = await inspectFinageReceivingInstallation({ sourceCommit });
  require(installation.sourceCommit && COMMIT.test(installation.sourceCommit), 'SOURCE_COMMIT',
    'Use the original installed archive, or supply the exact source-checkout commit explicitly.');
  const selected = [];
  for (const value of deliveries) selected.push(await selectedDelivery(value));
  require(selected[0].selection.manifest_sha256 !== selected[1].selection.manifest_sha256,
    'DELIVERY_SELECTION', 'The two selections identify the same original manifest.');
  const root = absolute(output, 'the new receiving output directory');
  const filename = absolute(configFile ?? root + '.receiving.json', 'the receiving configuration path');
  require(!within(root, filename), 'CONFIGURATION_LOCATION',
    'Keep the configuration beside the output directory; the original operation owns its output contents.');
  const browserConfig = browserConfiguration(browser);
  const byPath = new Map(installation.files.map(item => [item.path, item]));
  const executionSources = EXECUTION_FILES.map(path => byPath.get(path));
  const config = {
    schema: FINAGE_RECEIVING_OPERATION_SCHEMA,
    operation_id: operationId, output: root, actor, source_pin: installation.sourceCommit,
    receiver_command: [python, installation.receiver],
    receiver_source_files: executionSources.map(item => item.absolutePath),
    deliveries: selected.map(item => item.selection),
    ...(filter === undefined ? {} : { filter }),
    ...(browserConfig === undefined ? {} : { browser: browserConfig }),
    installed_source: {
      schema: FINAGE_RECEIVING_INSTALLATION_SCHEMA,
      source_commit: installation.sourceCommit, source_root: installation.sourceRoot,
      source_basis: installation.sourceBasis, installed_archive: installation.installedArchive,
      program: installation.program, files: executionSources,
    },
  };
  const receipt = await createConfiguration(filename, config);
  return {
    schema: 'finage.customer-receiving-preparation/v1', ...receipt,
    operationId, sourceCommit: installation.sourceCommit, sourceBasis: installation.sourceBasis,
    output: root, deliveries: selected.map(item => item.original),
    configuration: config,
    originalValidation: 'The original Python receiver verifies every manifest member and the complete CSV/NDJSON contract during receiving.',
    browserConfigured: Boolean(browserConfig),
    completeOperation: browserConfig ? 'All original receiving stages are configured.' :
      'The final desktop/mobile reading stage still needs existing Chromium and Playwright paths in this same configuration.',
    run: ['starforge', 'finage-receive', 'run', '--config', filename],
    resume: ['starforge', 'finage-receive', 'resume', '--config', filename],
    inspect: ['starforge', 'finage-receive', 'inspect', '--config', filename],
  };
}

async function operationConfiguration(configFile) {
  const filename = await realpath(absolute(configFile, 'the original receiving configuration'));
  const item = await document(filename);
  const value = item.value;
  require(value.schema === FINAGE_RECEIVING_OPERATION_SCHEMA && typeof value.output === 'string' &&
    isAbsolute(value.output) && typeof value.operation_id === 'string' &&
    Array.isArray(value.receiver_command) && value.receiver_command.length === 2 &&
    value.receiver_command.every(part => typeof part === 'string' && part) &&
    Array.isArray(value.receiver_source_files) && value.receiver_source_files.length > 0 &&
    value.receiver_source_files.every(part => typeof part === 'string' && isAbsolute(part)) &&
    typeof value.actor === 'string' && value.actor.trim() && COMMIT.test(value.source_pin ?? '') &&
    Array.isArray(value.deliveries) && value.deliveries.length === 2 &&
    value.deliveries.every(item => plain(item) && typeof item.directory === 'string' &&
      isAbsolute(item.directory) && HASH.test(item.manifest_sha256 ?? '') &&
      typeof item.label === 'string' && item.label),
    'OPERATION_CONFIGURATION', 'Select the prepared original receiving operation configuration.');
  return { ...item, config: value };
}

/** Read retained native results. Recorded PIDs and stage names are not live-process assertions. */
export async function inspectFinageReceivingOperation({ configFile } = {}) {
  const input = await operationConfiguration(configFile), config = input.config;
  const output = resolve(config.output);
  const checkpoint = await document(resolve(output, 'receiving-checkpoint.json'), CHECKPOINT_LIMIT, true);
  const result = await document(resolve(output, 'RECEIVING_RESULT.json'), CHECKPOINT_LIMIT, true);
  if (checkpoint) {
    require(checkpoint.value.schema === FINAGE_RECEIVING_OPERATION_SCHEMA &&
      checkpoint.value.intent?.operation_id === config.operation_id &&
      checkpoint.value.intent?.actor === config.actor &&
      equal(checkpoint.value.intent?.receiver_command, config.receiver_command) &&
      equal(checkpoint.value.intent?.filter ?? null, config.filter ?? null) &&
      equal(checkpoint.value.intent?.inputs?.map(item => ({
        directory: item.directory, manifest_sha256: item.manifest_sha256, label: item.label,
      })), config.deliveries.map(item => ({
        directory: item.directory, manifest_sha256: item.manifest_sha256, label: item.label,
      }))),
      'OPERATION_IDENTITY', 'The saved native checkpoint belongs to different original inputs or receiving decisions.');
  }
  if (result) require(result.value.schema === FINAGE_RECEIVING_OPERATION_SCHEMA &&
    result.value.operation_id === config.operation_id && result.value.actor === config.actor &&
    equal(result.value.original_inputs?.map(item => ({
      directory: item.directory, manifest_sha256: item.manifest_sha256, label: item.label,
    })), config.deliveries.map(item => ({
      directory: item.directory, manifest_sha256: item.manifest_sha256, label: item.label,
    }))), 'OPERATION_IDENTITY',
    'The saved result belongs to different original inputs or receiving decisions.');
  return {
    schema: 'finage.customer-receiving-status/v1', observedAt: now(),
    configuration: { path: input.path, bytes: input.bytes, sha256: input.sha256 },
    operationId: config.operation_id, actor: config.actor, sourceCommit: config.source_pin,
    output, status: result?.value.status ?? checkpoint?.value.status ??
      checkpoint?.value.stages?.[checkpoint?.value.active_stage]?.status ?? (checkpoint ? 'retained' : 'prepared'),
    activeStageRecorded: checkpoint?.value.active_stage ?? null,
    stages: checkpoint?.value.stages ?? {},
    commands: checkpoint?.value.commands ?? [],
    attempts: checkpoint?.value.attempts ?? [],
    sourceRevisions: checkpoint?.value.source_revisions ?? [],
    outputs: checkpoint?.value.outputs ?? {},
    originalInputs: checkpoint?.value.intent?.inputs ?? config.deliveries,
    result: result?.value ?? null,
    resultFile: result ? { path: result.path, bytes: result.bytes, sha256: result.sha256 } : null,
    checkpointFile: checkpoint ? { path: checkpoint.path, bytes: checkpoint.bytes, sha256: checkpoint.sha256 } : null,
    processState: 'Use the existing native execution owner for live-process state; this view reports saved product records.',
  };
}

/** Run or resume the same original Python program from its selected installed source. */
export async function runFinageReceivingOperation({ configFile, resume = false } = {}) {
  require(typeof resume === 'boolean', 'OPERATION_MODE', 'Choose run or resume explicitly.');
  const input = await operationConfiguration(configFile), config = input.config;
  const installation = await inspectFinageReceivingInstallation({ sourceCommit: config.source_pin });
  const byPath = new Map(installation.files.map(item => [item.path, item]));
  require(config.receiver_command[1] === installation.receiver &&
    equal(config.receiver_source_files, EXECUTION_FILES.map(path => byPath.get(path).absolutePath)),
    'SELECTED_INSTALLATION', 'Continue this operation from its originally selected receiving installation.',
    { selectedReceiver: config.receiver_command[1], currentReceiver: installation.receiver });
  require(config.installed_source?.program === installation.program &&
    equal(config.installed_source?.files, EXECUTION_FILES.map(path => byPath.get(path))),
    'SELECTED_SOURCE_CHANGED',
    'The selected receiving program changed. Restore the original release or use the original program’s explicit source-revision workflow.');
  const args = [installation.program, '--config', input.path, ...(resume ? ['--resume'] : [])];
  return new Promise((resolveRun, reject) => {
    const child = spawn(config.receiver_command[0], args, { stdio: 'inherit', shell: false, windowsHide: true });
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    const detach = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', error => { detach(); reject(error); });
    child.once('close', (code, signal) => {
      detach();
      resolveRun({ code: code ?? 128 + (constants.signals[signal] ?? 1), signal,
        configuration: input.path, output: config.output, operationId: config.operation_id });
    });
  });
}
