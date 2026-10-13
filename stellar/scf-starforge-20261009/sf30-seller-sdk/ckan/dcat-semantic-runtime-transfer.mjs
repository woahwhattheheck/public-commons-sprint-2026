// MIT. Portable original semantic inputs and exact-lock recipient preparation.
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { object, fault } from '../postgres/publisher/files.mjs';
import { inspectDcatSemanticRuntime, prepareDcatSemanticRuntime } from './dcat-semantic-runtime.mjs';

const HELPER = fileURLToPath(new URL('./dcat_semantic_runtime_transfer.py', import.meta.url));
const MANIFEST = 'stellar-forge.dcat-semantic-runtime-transfer.v1';
const RECEIVED = 'stellar-forge.dcat-semantic-runtime-transfer-received.v1';
const HASH = /^[a-f0-9]{64}$/;
const need = (ok, code, message = code) => { if (!ok) throw fault(code, message); };
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !value.includes('\0'), 'DCAT_SEMANTIC_RUNTIME_TRANSFER_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function expected(value) {
  need(typeof value === 'string' && HASH.test(value), 'DCAT_SEMANTIC_RUNTIME_TRANSFER_EXPECTED_HASH_REQUIRED');
  return value;
}
async function invoke(python, args, { signal, onUpdate, phase } = {}) {
  absolute(python);
  need(process.platform === 'linux', 'DCAT_SEMANTIC_RUNTIME_LINUX_REQUIRED');
  await access(python, constants.X_OK);
  need(!signal?.aborted, 'DCAT_SEMANTIC_RUNTIME_TRANSFER_CANCELLED');
  await onUpdate?.({ phase: phase ?? 'VERIFYING_TRANSFER' });
  const environment = Object.fromEntries(['PATH', 'LANG', 'LC_ALL']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  environment.PYTHONDONTWRITEBYTECODE = '1';
  environment.PYTHONUNBUFFERED = '1';
  const result = await new Promise((done, reject) => {
    let child, timer, stdout = '', stderr = '', failure = null;
    const stop = () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      if (!timer) timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 15000);
    };
    try {
      child = spawn(python, ['-B', HELPER, ...args], { env: environment, shell: false,
        stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { reject(error); return; }
    child.stdout.on('data', raw => {
      stdout += raw.toString('utf8');
      if (Buffer.byteLength(stdout) > 33554432) {
        failure = fault('DCAT_SEMANTIC_RUNTIME_TRANSFER_OUTPUT_LIMIT'); stop();
      }
    });
    child.stderr.on('data', raw => {
      stderr += raw.toString('utf8');
      if (Buffer.byteLength(stderr) > 131072) {
        failure = fault('DCAT_SEMANTIC_RUNTIME_TRANSFER_ERROR_LIMIT'); stop();
      }
    });
    child.once('error', error => { failure = error; });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.once('close', (code, childSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (failure) { reject(failure); return; }
      if (signal?.aborted) {
        reject(fault('DCAT_SEMANTIC_RUNTIME_TRANSFER_CANCELLED',
          'The owned transfer helper stopped. Retained input and any identical received prefix remain available.')); return;
      }
      if (code !== 0) {
        let detail;
        try { detail = JSON.parse(stderr.trim()); } catch { detail = null; }
        reject(fault(typeof detail?.error === 'string' ? detail.error : 'DCAT_SEMANTIC_RUNTIME_TRANSFER_FAILED',
          typeof detail?.message === 'string' ? detail.message :
            'Original transfer helper ended (' + (childSignal ?? code) + ').')); return;
      }
      try {
        const value = JSON.parse(stdout);
        need(object(value), 'DCAT_SEMANTIC_RUNTIME_TRANSFER_RESULT_INVALID');
        done(value);
      } catch (error) { reject(error); }
    });
  });
  await onUpdate?.({ phase: result.status, receiptSha256: result.receiptSha256,
    bundleSha256: result.bundle?.sha256 ?? result.sha256 });
  return result;
}
export async function exportDcatSemanticRuntimeTransfer({ directory, out } = {}, context = {}) {
  absolute(directory); absolute(out);
  const runtime = await inspectDcatSemanticRuntime(directory);
  const result = await invoke(runtime.python.executable, ['export', '--directory', directory, '--out', out],
    { ...context, phase: 'EXPORTING_ORIGINAL_INPUTS' });
  need(result.schema === MANIFEST && result.status === 'EXPORTED' && result.file === out &&
    HASH.test(result.sha256 ?? '') && result.manifest?.sourceRuntimeReceiptSha256 === runtime.receiptSha256 &&
    result.manifest?.lockSha256 === runtime.lockSha256,
    'DCAT_SEMANTIC_RUNTIME_TRANSFER_RESULT_INVALID');
  return result;
}
export async function inspectDcatSemanticRuntimeTransfer({ file, expectedSha256, python } = {}, context = {}) {
  absolute(file); expected(expectedSha256);
  const result = await invoke(python, ['inspect', '--file', file, '--sha256', expectedSha256], context);
  need(result.schema === MANIFEST && result.status === 'VERIFIED_BYTES' && result.file === file &&
    result.sha256 === expectedSha256, 'DCAT_SEMANTIC_RUNTIME_TRANSFER_RESULT_INVALID');
  return result;
}
export async function receiveDcatSemanticRuntimeTransfer(
  { file, expectedSha256, directory, python } = {}, context = {}) {
  absolute(file); absolute(directory); expected(expectedSha256);
  const result = await invoke(python, ['receive', '--file', file, '--sha256', expectedSha256,
    '--directory', directory], { ...context, phase: 'RECEIVING_ORIGINAL_INPUTS' });
  need(result.schema === RECEIVED && result.status === 'READY_INPUTS' && result.directory === directory &&
    result.bundle?.sha256 === expectedSha256 && HASH.test(result.receiptSha256 ?? ''),
    'DCAT_SEMANTIC_RUNTIME_TRANSFER_RESULT_INVALID');
  return result;
}
export async function inspectDcatSemanticRuntimeTransferInputs(
  { directory, expectedTransferSha256, python } = {}, context = {}) {
  absolute(directory);
  if (expectedTransferSha256 !== undefined) expected(expectedTransferSha256);
  const result = await invoke(python, ['inspect-inputs', '--directory', directory,
    ...(expectedTransferSha256 ? ['--sha256', expectedTransferSha256] : [])], context);
  need(result.schema === RECEIVED && result.status === 'READY_INPUTS' && result.directory === directory &&
    HASH.test(result.receiptSha256 ?? '') &&
    (expectedTransferSha256 === undefined || result.receiptSha256 === expectedTransferSha256),
    'DCAT_SEMANTIC_RUNTIME_TRANSFER_RESULT_INVALID');
  return result;
}
export async function prepareDcatSemanticRuntimeFromTransfer(
  { transferDirectory, expectedTransferSha256, directory, python } = {}, context = {}) {
  absolute(transferDirectory); absolute(directory); absolute(python); expected(expectedTransferSha256);
  need(directory !== transferDirectory && !directory.startsWith(transferDirectory + '/') &&
    !transferDirectory.startsWith(directory + '/'), 'DCAT_SEMANTIC_RUNTIME_TRANSFER_SEPARATE_DIRECTORIES_REQUIRED');
  const received = await inspectDcatSemanticRuntimeTransferInputs(
    { directory: transferDirectory, expectedTransferSha256, python }, context);
  const result = await prepareDcatSemanticRuntime(
    { directory, python, transferDirectory, expectedTransferSha256 }, context);
  need(result.transfer?.receiptSha256 === received.receiptSha256 &&
    result.transfer?.bundleSha256 === received.bundle.sha256 &&
    result.transfer?.sourceRuntimeReceiptSha256 === received.sourceRuntimeReceiptSha256 &&
    result.lockSha256 === received.lockSha256, 'DCAT_SEMANTIC_RUNTIME_TRANSFER_PREPARATION_CHANGED');
  return result;
}
export const semanticRuntimeTransferCliOptions = {
  'semantic-runtime-export': ['directory', 'out'],
  'semantic-runtime-inspect-transfer': ['file', 'sha256', 'python'],
  'semantic-runtime-receive': ['file', 'sha256', 'directory', 'python'],
  'semantic-runtime-inspect-inputs': ['directory', 'transfer-sha256', 'python'],
  'semantic-runtime-prepare-received': ['transfer-directory', 'transfer-sha256', 'directory', 'python'],
};
export const semanticRuntimeTransferCliUsage = [
  '  dcat semantic-runtime-export --directory /private/prepared --out /private/semantic-runtime.zip',
  '  dcat semantic-runtime-inspect-transfer --file /private/semantic-runtime.zip --sha256 HASH --python /absolute/python',
  '  dcat semantic-runtime-receive --file /private/semantic-runtime.zip --sha256 HASH --directory /private/received-inputs --python /absolute/python',
  '  dcat semantic-runtime-inspect-inputs --directory /private/received-inputs --transfer-sha256 HASH --python /absolute/python',
  '  dcat semantic-runtime-prepare-received --transfer-directory /private/received-inputs --transfer-sha256 HASH --directory /private/recipient-runtime --python /absolute/python',
  'Transfer preserves complete original source, wheels and lock. Recipient installation is offline at its own final environment path.',
];
export async function executeDcatSemanticRuntimeTransferCommand(command, options, context = {}) {
  const path = name => absolute(options[name]);
  const hash = name => expected(options[name]);
  if (command === 'semantic-runtime-export')
    return exportDcatSemanticRuntimeTransfer({ directory: path('directory'), out: path('out') }, context);
  if (command === 'semantic-runtime-inspect-transfer')
    return inspectDcatSemanticRuntimeTransfer({ file: path('file'), expectedSha256: hash('sha256'),
      python: path('python') }, context);
  if (command === 'semantic-runtime-receive')
    return receiveDcatSemanticRuntimeTransfer({ file: path('file'), expectedSha256: hash('sha256'),
      directory: path('directory'), python: path('python') }, context);
  if (command === 'semantic-runtime-inspect-inputs')
    return inspectDcatSemanticRuntimeTransferInputs({ directory: path('directory'),
      ...(options['transfer-sha256'] ? { expectedTransferSha256: hash('transfer-sha256') } : {}),
      python: path('python') }, context);
  if (command === 'semantic-runtime-prepare-received')
    return prepareDcatSemanticRuntimeFromTransfer({ transferDirectory: path('transfer-directory'),
      expectedTransferSha256: hash('transfer-sha256'), directory: path('directory'), python: path('python') }, context);
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed semantic runtime transfer command.');
}
