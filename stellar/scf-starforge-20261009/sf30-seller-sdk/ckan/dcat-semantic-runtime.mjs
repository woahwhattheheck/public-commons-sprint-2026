// MIT. Prepare and inspect a separate original semantic Python runtime.
import { join, resolve, isAbsolute, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, realpath, readdir, open, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { object, readPrivate, privateDirectory, createFile, digest, bytes, fault }
  from '../postgres/publisher/files.mjs';

const SCHEMA = 'stellar-forge.dcat-semantic-prepared-runtime.v1';
const ROOT = fileURLToPath(new URL('./', import.meta.url));
const VENDOR = join(ROOT, 'vendor', 'semantic-operator');
const HELPER = join(ROOT, 'dcat_semantic_runtime.py');
const VENDOR_SHA = '2fff66af17de2e0c5f4c35ba0e765a3bf0ea44f8347b78f72e14c54d973286b0';
const RUNTIME_SHA = '8f148b0b6a3c0ae2660d55b4c300fba76ac1f7805e4e693ff76c3b3297b0cb04';
const PINNED = { rdflib: '7.6.0', pyshacl: '0.40.1', cryptography: '50.0.1', pyld: '3.3.0' };
const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE = 536870912, MAX_TOTAL = 2147483648;
const need = (ok, code, message = code) => { if (!ok) throw fault(code, message); };
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !value.includes('\0'), 'DCAT_SEMANTIC_RUNTIME_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function member(value) {
  need(typeof value === 'string' && value.length <= 4096 && !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'DCAT_SEMANTIC_RUNTIME_MEMBER_INVALID');
  return value;
}
async function hashFile(path, maximum = MAX_FILE) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= maximum, 'DCAT_SEMANTIC_RUNTIME_FILE_INVALID');
    const hash = createHash('sha256'); let size = 0;
    for await (const block of handle.createReadStream({ autoClose: false })) {
      size += block.length; need(size <= maximum, 'DCAT_SEMANTIC_RUNTIME_FILE_TOO_LARGE'); hash.update(block);
    }
    const after = await handle.stat();
    need(size === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'DCAT_SEMANTIC_RUNTIME_FILE_CHANGED');
    return { bytes: size, sha256: hash.digest('hex'), mode: before.mode & 0o7777 };
  } finally { await handle.close(); }
}
async function regularBytes(path, maximum = 16777216) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= maximum, 'DCAT_SEMANTIC_RUNTIME_FILE_INVALID');
    const raw = await handle.readFile(), after = await handle.stat();
    need(raw.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'DCAT_SEMANTIC_RUNTIME_FILE_CHANGED');
    return raw;
  } finally { await handle.close(); }
}
async function verifySource() {
  const manifestRaw = await regularBytes(join(VENDOR, 'source-manifest.json'));
  const selectedRaw = await regularBytes(join(VENDOR, 'selected-runtime.json'));
  need(digest(manifestRaw) === VENDOR_SHA && digest(selectedRaw) === RUNTIME_SHA,
    'DCAT_SEMANTIC_RUNTIME_SOURCE_CHANGED');
  const manifest = JSON.parse(manifestRaw), selected = JSON.parse(selectedRaw);
  need(selected.original_manifest_sha256 === VENDOR_SHA && Array.isArray(selected.files),
    'DCAT_SEMANTIC_RUNTIME_SOURCE_CHANGED');
  const originals = new Map(manifest.files.map(value => [value.path, value]));
  for (const value of selected.files) {
    const original = originals.get(member(value.path));
    need(original && original.bytes === value.bytes && original.sha256 === value.sha256 &&
      original.git_blob === value.git_blob, 'DCAT_SEMANTIC_RUNTIME_SOURCE_CHANGED');
    const actual = await hashFile(join(VENDOR, value.path));
    need(actual.bytes === value.bytes && actual.sha256 === value.sha256, 'DCAT_SEMANTIC_RUNTIME_SOURCE_CHANGED');
  }
  return { manifestSha256: VENDOR_SHA, runtimeManifestSha256: RUNTIME_SHA, files: selected.files };
}
async function verifyInventory(root, expected) {
  need(Array.isArray(expected) && expected.length <= 20000, 'DCAT_SEMANTIC_RUNTIME_INVENTORY_INVALID');
  const all = new Map(); let bytesTotal = 0;
  for (const value of expected) {
    member(value.path); need(!all.has(value.path), 'DCAT_SEMANTIC_RUNTIME_INVENTORY_INVALID'); all.set(value.path, value);
    const path = join(root, value.path), info = await lstat(path);
    if (value.kind === 'symlink') {
      const { readlink } = await import('node:fs/promises');
      need(info.isSymbolicLink() && await readlink(path) === value.target, 'DCAT_SEMANTIC_RUNTIME_FILE_CHANGED');
    } else {
      need(value.kind === 'file' && HASH.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) &&
        value.bytes >= 0 && value.bytes <= MAX_FILE, 'DCAT_SEMANTIC_RUNTIME_INVENTORY_INVALID');
      const actual = await hashFile(path);
      need(actual.bytes === value.bytes && actual.sha256 === value.sha256 && actual.mode === value.mode,
        'DCAT_SEMANTIC_RUNTIME_FILE_CHANGED', 'The prepared runtime file changed: ' + value.path);
      bytesTotal += actual.bytes;
    }
  }
  need(bytesTotal <= MAX_TOTAL, 'DCAT_SEMANTIC_RUNTIME_INVENTORY_LIMIT');
  let seen = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = member(prefix + entry.name);
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
      else {
        need(all.has(path) && (entry.isFile() || entry.isSymbolicLink()), 'DCAT_SEMANTIC_RUNTIME_EXTRA_FILE',
          'The prepared environment contains an unrecorded file: ' + path); seen++;
      }
    }
  }
  await walk(root);
  need(seen === all.size, 'DCAT_SEMANTIC_RUNTIME_INVENTORY_CHANGED');
}
export async function inspectDcatSemanticRuntime(directory, { expectedSha256 } = {}) {
  absolute(directory); await privateDirectory(directory);
  const raw = await readPrivate(join(directory, 'runtime.json'), 16777216), receiptSha256 = digest(raw);
  need(expectedSha256 === undefined || expectedSha256 === receiptSha256, 'DCAT_SEMANTIC_RUNTIME_RECEIPT_CHANGED');
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  need(object(record) && record.schema === SCHEMA && record.directory === directory && record.status === 'READY' &&
    object(record.source) && record.source.manifestSha256 === VENDOR_SHA &&
    record.source.runtimeManifestSha256 === RUNTIME_SHA && object(record.inventories) &&
    object(record.python) && Array.isArray(record.packages) && Array.isArray(record.files) &&
    HASH.test(record.selectionSha256 ?? '') && HASH.test(record.lockSha256 ?? ''),
    'DCAT_SEMANTIC_RUNTIME_RECEIPT_INVALID');
  await verifySource();
  for (const key of ['source', 'wheels', 'environment'])
    await verifyInventory(join(directory, key), record.inventories[key]);
  for (const file of record.files) {
    const actual = await hashFile(join(directory, member(file.path)));
    need(actual.bytes === file.bytes && actual.sha256 === file.sha256, 'DCAT_SEMANTIC_RUNTIME_RECEIPT_FILE_CHANGED');
  }
  need(digest(await readPrivate(join(directory, 'selection.json'), 16777216)) === record.selectionSha256 &&
    digest(await readPrivate(join(directory, 'requirements.lock'), 1048576)) === record.lockSha256,
    'DCAT_SEMANTIC_RUNTIME_SELECTION_CHANGED');
  const executable = join(directory, 'environment', 'bin', 'python');
  need(record.python.executable === executable && await realpath(executable) === record.python.target,
    'DCAT_SEMANTIC_RUNTIME_INTERPRETER_CHANGED');
  const identity = await hashFile(record.python.target);
  need(identity.sha256 === record.python.targetSha256, 'DCAT_SEMANTIC_RUNTIME_INTERPRETER_CHANGED');
  await access(executable, constants.X_OK);
  const actual = new Map(record.packages.map(value => [value.name, value.version]));
  need(actual.size === record.packages.length && Object.entries(PINNED).every(([name, version]) => actual.get(name) === version),
    'DCAT_SEMANTIC_RUNTIME_DEPENDENCY_CHANGED');
  if (record.transfer !== undefined) {
    need(object(record.transfer) && HASH.test(record.transfer.receiptSha256 ?? '') &&
      HASH.test(record.transfer.bundleSha256 ?? '') && HASH.test(record.transfer.sourceRuntimeReceiptSha256 ?? '') &&
      record.transfer.lockSha256 === record.lockSha256,
      'DCAT_SEMANTIC_RUNTIME_TRANSFER_RECEIPT_CHANGED');
    const selection = JSON.parse(await readPrivate(join(directory, 'selection.json'), 16777216));
    need(JSON.stringify(selection.transfer) === JSON.stringify(record.transfer),
      'DCAT_SEMANTIC_RUNTIME_TRANSFER_RECEIPT_CHANGED');
  }
  return { ...record, receiptSha256, receiptBytes: raw.length };
}
export async function verifyDcatSemanticRuntimeEnvironment(environment = process.env, { expectedSha256 } = {}) {
  const directory = environment.SCF_DCAT_SEMANTIC_RUNTIME;
  if (directory === undefined || directory === '') {
    need(!environment.SCF_DCAT_SEMANTIC_RUNTIME_SHA256 && expectedSha256 === undefined,
      'DCAT_SEMANTIC_RUNTIME_SELECTION_INCOMPLETE');
    return null;
  }
  absolute(directory);
  const selectedHash = environment.SCF_DCAT_SEMANTIC_RUNTIME_SHA256;
  need(HASH.test(selectedHash ?? '') && (expectedSha256 === undefined || expectedSha256 === selectedHash),
    'DCAT_SEMANTIC_RUNTIME_RECEIPT_SELECTION_REQUIRED',
    'Select the exact runtime receipt digest from semantic-runtime-environment.');
  const selectedPython = absolute(environment.SCF_DCAT_SEMANTIC_PYTHON);
  const record = await inspectDcatSemanticRuntime(directory, { expectedSha256: selectedHash });
  need(selectedPython === record.python.executable, 'DCAT_SEMANTIC_RUNTIME_PYTHON_SELECTION_CHANGED');
  return { schema: 'stellar-forge.dcat-semantic-runtime-binding.v1', directory,
    receiptSha256: record.receiptSha256, receiptBytes: record.receiptBytes, python: record.python.executable,
    sourceManifestSha256: record.source.manifestSha256,
    runtimeManifestSha256: record.source.runtimeManifestSha256,
    requirementsSha256: record.source.requirementsSha256, lockSha256: record.lockSha256 };
}
export async function prepareDcatSemanticRuntime({ directory, python, wheelhouse, transferDirectory, expectedTransferSha256 } = {}, { signal, onUpdate } = {}) {
  absolute(directory); absolute(python);
  if (wheelhouse !== undefined) absolute(wheelhouse);
  if (transferDirectory !== undefined) {
    absolute(transferDirectory);
    need(wheelhouse === undefined && HASH.test(expectedTransferSha256 ?? ''),
      'DCAT_SEMANTIC_RUNTIME_TRANSFER_SELECTION_REQUIRED');
  } else need(expectedTransferSha256 === undefined, 'DCAT_SEMANTIC_RUNTIME_TRANSFER_SELECTION_REQUIRED');
  need(process.platform === 'linux', 'DCAT_SEMANTIC_RUNTIME_LINUX_REQUIRED');
  await verifySource(); await access(python, constants.X_OK);
  const argv = ['-B', HELPER, 'prepare', '--directory', directory, '--python', python, '--vendor', VENDOR,
    ...(wheelhouse ? ['--wheelhouse', wheelhouse] : []),
    ...(transferDirectory ? ['--transfer-directory', transferDirectory, '--transfer-sha256', expectedTransferSha256] : [])];
  const environment = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  environment.PYTHONDONTWRITEBYTECODE = '1'; environment.PYTHONUNBUFFERED = '1';
  need(!signal?.aborted, 'DCAT_SEMANTIC_RUNTIME_CANCELLED');
  await onUpdate?.({ phase: 'PREPARING', directory });
  await new Promise((done, reject) => {
    let child, timer, output = '', failure = null;
    const stop = () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      if (!timer) timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 15000);
    };
    try {
      child = spawn(python, argv, { env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { reject(error); return; }
    const consume = block => {
      output += block.toString('utf8');
      if (Buffer.byteLength(output) > 131072) { failure = fault('DCAT_SEMANTIC_RUNTIME_OUTPUT_LIMIT'); stop(); }
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('error', error => { failure = error; });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.once('close', (code, childSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (failure) reject(failure);
      else if (signal?.aborted) reject(fault('DCAT_SEMANTIC_RUNTIME_CANCELLED', 'Preparation stopped after its owned child drained; inspect the retained progress and logs.'));
      else if (code !== 0) reject(fault('DCAT_SEMANTIC_RUNTIME_PREPARATION_FAILED',
        'The original dependency preparation ended (' + (childSignal ?? code) + '). Inspect ' +
        join(directory, 'progress.json') + ' and its original private attempt logs.'));
      else done();
    });
  });
  const result = await inspectDcatSemanticRuntime(directory);
  await onUpdate?.({ phase: 'READY', directory, receiptSha256: result.receiptSha256 });
  return result;
}
export async function writeDcatSemanticRuntimeEnvironment({ directory, out, input } = {}) {
  absolute(directory); absolute(out);
  if (input !== undefined) absolute(input);
  const runtime = await inspectDcatSemanticRuntime(directory);
  let values = {};
  if (input) values = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(input, 65536)));
  need(object(values) && Object.keys(values).length <= 125 && Object.entries(values).every(([key, value]) =>
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) && typeof value === 'string' && !value.includes('\0') &&
    Buffer.byteLength(value) <= 8192) && !Object.hasOwn(values, 'HOME') && !Object.hasOwn(values, 'CODEX_HOME'),
    'DCAT_SEMANTIC_RUNTIME_ENVIRONMENT_INVALID');
  values = { ...values, SCF_DCAT_SEMANTIC_PYTHON: runtime.python.executable, SCF_DCAT_SEMANTIC_RUNTIME: directory,
    SCF_DCAT_SEMANTIC_RUNTIME_SHA256: runtime.receiptSha256 };
  const raw = bytes(values); need(raw.length <= 65536, 'DCAT_SEMANTIC_RUNTIME_ENVIRONMENT_TOO_LARGE');
  await privateDirectory(dirname(out));
  try { await createFile(out, raw); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readPrivate(out, 65536)).equals(raw), 'DCAT_SEMANTIC_RUNTIME_ENVIRONMENT_EXISTS',
      'Choose a new private environment file; the existing selection remains unchanged.');
  }
  return { schema: 'stellar-forge.dcat-semantic-runtime-environment.v1', out, bytes: raw.length,
    sha256: digest(raw), runtimeDirectory: directory, runtimeReceiptSha256: runtime.receiptSha256,
    semanticPython: runtime.python.executable };
}
export const semanticRuntimeCliOptions = {
  'semantic-runtime-prepare': ['directory', 'python', 'wheelhouse'],
  'semantic-runtime-inspect': ['directory'],
  'semantic-runtime-environment': ['directory', 'out', 'input'],
};
export const semanticRuntimeCliUsage = [
  '  dcat semantic-runtime-prepare --directory /absolute/private/runtime --python /absolute/python [--wheelhouse /absolute/wheels]',
  '  dcat semantic-runtime-inspect --directory /absolute/private/runtime',
  '  dcat semantic-runtime-environment --directory /absolute/private/runtime --out /absolute/private/environment.json [--input /absolute/private/existing.json]',
  'Deployment creates a separate owned Python environment and retains original wheel/lock/import receipts. No catalogue project is opened.',
];
export async function executeDcatSemanticRuntimeCommand(command, options, context = {}) {
  const required = name => {
    need(typeof options[name] === 'string' && options[name], 'DCAT_COMMAND_ARGUMENTS', 'Supply --' + name + '.');
    return absolute(options[name]);
  };
  if (command === 'semantic-runtime-prepare')
    return prepareDcatSemanticRuntime({ directory: required('directory'), python: required('python'),
      ...(options.wheelhouse ? { wheelhouse: required('wheelhouse') } : {}) }, context);
  if (command === 'semantic-runtime-inspect') return inspectDcatSemanticRuntime(required('directory'));
  if (command === 'semantic-runtime-environment')
    return writeDcatSemanticRuntimeEnvironment({ directory: required('directory'), out: required('out'),
      ...(options.input ? { input: required('input') } : {}) });
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed semantic runtime command.');
}
