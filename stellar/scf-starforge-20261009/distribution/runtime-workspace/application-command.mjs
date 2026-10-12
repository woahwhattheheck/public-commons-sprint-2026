// MIT. Optional private terminal and original CLI URL capture inside the managed runner.
import { constants } from 'node:fs';
import { open, readdir, lstat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, operationId,
  recordId, operationLease, operationRunning, tailFile, plain, need, digest, now } from './storage.mjs';
import { defaultApplicationProviders } from './application-providers.mjs';
import { observeApplicationStartup } from './application-provider.mjs';

const providers = await defaultApplicationProviders();

const TERMINAL = fileURLToPath(new URL('./application-terminal.py', import.meta.url));
const MAX_INPUT = 4096;
export async function applicationEnvironment(path, expectedSha256) {
  if (!path) return { environment: process.env, sha256: null };
  absolute(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077) && first.size <= 65536 &&
      (process.getuid === undefined || first.uid === process.getuid()), 'APPLICATION_PRIVATE_ENVIRONMENT_REQUIRED');
    bytes = await handle.readFile();
    const after = await handle.stat();
    need(first.size === after.size && first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs &&
      bytes.length === first.size, 'APPLICATION_ENVIRONMENT_CHANGED');
  } finally { await handle.close(); }
  const sha256 = digest(bytes);
  need(expectedSha256 === undefined || expectedSha256 === sha256, 'APPLICATION_ENVIRONMENT_CHANGED',
    'Review the current private environment file before starting this application', 409);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'APPLICATION_ENVIRONMENT_JSON_REQUIRED'); }
  need(plain(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([name, value]) =>
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && typeof value === 'string' && !value.includes('\0') &&
    Buffer.byteLength(value) <= 8192), 'APPLICATION_ENVIRONMENT_VALUES_INVALID');
  need(!['HOME', 'CODEX_HOME'].some(name => Object.hasOwn(value, name)), 'APPLICATION_ENVIRONMENT_HOME_RESERVED');
  return { environment: { ...process.env, ...value }, sha256 };
}
export async function prepareApplicationCommand(request, directory, originalArgs) {
  const provider = providers.forRequest(request);
  await provider?.verifyLaunch?.(request, directory);
  const { environment } = await applicationEnvironment(request.environmentFile, request.environmentSha256);
  if (provider?.prepareChild) return provider.prepareChild(request, directory, originalArgs, environment);
  if (request.terminal) {
    for (const name of ['terminal-inputs', 'terminal-pending']) {
      try { await makePrivate(join(directory, name)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(join(directory, name)); }
    }
    const python = absolute(request.terminalPython ?? '/usr/bin/python3');
    await access(python, constants.X_OK);
    return { executable: python, args: ['-I', TERMINAL, '--operation', directory],
      options: { cwd: request.homeDirectory, shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe', 3] } };
  }
  return { executable: process.execPath, args: originalArgs,
    options: { cwd: request.homeDirectory, shell: false, env: environment,
      stdio: ['ignore', request.applicationId ? 'pipe' : 'inherit', request.applicationId ? 'pipe' : 'inherit', 3] } };
}
export function observeApplicationOutput(request, directory, context = {}) {
  const provider = providers.forRequest(request);
  return provider ? provider.createObserver(request, directory, context) :
    observeApplicationStartup(request, directory, () => null);
}
async function terminalRequest(root, id) {
  const directory = join(root, 'operations', operationId(id));
  const request = await readJSON(join(directory, 'request.json'));
  need(request.operation === 'managed-run' && request.terminal === true, 'APPLICATION_TERMINAL_REQUIRED');
  return { directory, request };
}
export async function readApplicationTerminal(root, { operationId: id, applicationId } = {}) {
  const { directory, request } = await terminalRequest(root, id);
  need(request.applicationId === recordId(applicationId), 'APPLICATION_OPERATION_CHANGED');
  const process = await readJSON(join(directory, 'terminal-process.json'), true);
  const result = await readJSON(join(directory, 'terminal-exit.json'), true);
  const device = await readJSON(join(directory, 'terminal-device.json'), true);
  const active = !result && await operationRunning(join(directory, 'worker.lock'));
  const names = (await readdir(join(directory, 'terminal-inputs')).catch(error =>
    error.code === 'ENOENT' ? [] : Promise.reject(error))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  const receipts = await Promise.all(names.map(name => readJSON(join(directory, 'terminal-inputs', name))));
  receipts.sort((a, b) => b.sequence - a.sequence);
  let output = { text: '', totalBytes: 0, offset: 0 };
  try { output = await tailFile(join(directory, 'worker.log')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { operationId: id, ready: active && Boolean(process) && device?.inputTTY === true && device?.outputTTY === true, active, process, device, result,
    output, inputs: receipts.slice(0, 40) };
}
export async function sendApplicationTerminal(root, { operationId: id, applicationId, inputId, text } = {}) {
  const { directory, request } = await terminalRequest(root, id);
  need(request.applicationId === recordId(applicationId), 'APPLICATION_OPERATION_CHANGED');
  operationId(inputId);
  need(typeof text === 'string' && text.length > 0 && Buffer.byteLength(text) <= MAX_INPUT &&
    !/[\u0000-\u0002\u0005-\u0008\u000b\u000c\u000e-\u0019\u001b-\u001f\u007f]/.test(text),
    'APPLICATION_TERMINAL_INPUT_INVALID', 'Send at most 4 KiB of terminal text or an explicit interrupt');
  const sha256 = digest(Buffer.from(text)), receiptPath = join(directory, 'terminal-inputs', inputId + '.json');
  const lease = await operationLease(join(directory, 'terminal-input.lock'));
  try {
    let receipt = await readJSON(receiptPath, true);
    if (receipt) {
      need(receipt.sha256 === sha256, 'APPLICATION_TERMINAL_INPUT_ID_REUSED');
      if (receipt.state !== 'QUEUED') return receipt;
    }
    need(!await readJSON(join(directory, 'terminal-exit.json'), true) &&
      !await readJSON(join(directory, 'stop.json'), true) &&
      Boolean(await readJSON(join(directory, 'terminal-process.json'), true)) &&
      (await readJSON(join(directory, 'terminal-device.json'), true))?.inputTTY === true &&
      await operationRunning(join(directory, 'worker.lock')), 'APPLICATION_TERMINAL_NOT_RUNNING');
    if (!receipt) {
      const previous = await readJSON(join(directory, 'terminal-sequence.json'), true);
      const sequence = (previous?.sequence ?? 0) + 1;
      need(Number.isSafeInteger(sequence) && sequence <= 100000, 'APPLICATION_TERMINAL_INPUT_LIMIT');
      await saveJSON(join(directory, 'terminal-sequence.json'), { sequence }, true);
      receipt = { schema: 'stellar-forge.application-terminal-input.v1', inputId, sequence,
        operationId: id, applicationId, sha256, bytes: Buffer.byteLength(text), state: 'QUEUED', createdAt: now() };
      await saveJSON(receiptPath, receipt);
    }
    const pending = join(directory, 'terminal-pending', String(receipt.sequence).padStart(12, '0') + '-' + inputId + '.json');
    try { await saveJSON(pending, { ...receipt, text }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return await readJSON(receiptPath);
  } finally { await lease.close(); }
}
