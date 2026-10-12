// MIT. Optional private terminal and original CLI URL capture inside the managed runner.
import { blockscoutStartup } from './application-blockscout.mjs';
import { jobCheckoutStartup } from './application-job-checkout.mjs';
import { datasetBuyerStartup } from './application-dataset-buyer.mjs';
import { tenderlyStartup } from './application-tenderly.mjs';
import { eventFeedOutputReader, eventFeedStartup, verifyEventFeedLaunch } from './application-event-feed.mjs';
import { constants } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { open, readdir, lstat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, operationId,
  recordId, operationLease, operationRunning, tailFile, plain, need, digest, now } from './storage.mjs';

import { preparePythonManagedChild, observePythonApplicationOutput } from '../python-runtime/application-lifecycle.mjs';

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
    /^[A-Z_][A-Z0-9_]{0,127}$/.test(name) && typeof value === 'string' && !value.includes('\0') &&
    Buffer.byteLength(value) <= 8192), 'APPLICATION_ENVIRONMENT_VALUES_INVALID');
  need(!['HOME', 'CODEX_HOME'].some(name => Object.hasOwn(value, name)), 'APPLICATION_ENVIRONMENT_HOME_RESERVED');
  return { environment: { ...process.env, ...value }, sha256 };
}
export async function prepareApplicationCommand(request, directory, originalArgs) {
  await verifyEventFeedLaunch(request, directory);
  const { environment } = await applicationEnvironment(request.environmentFile, request.environmentSha256);
  if (request.pythonCommand) return preparePythonManagedChild(dirname(dirname(directory)), request, environment);
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
function privateUrl(text) {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        Number(url.port || 80) < 1 || Number(url.port || 80) > 65535 ||
        url.username || url.password || text.length > 4096) return null;
    return url.href;
  } catch { return null; }
}
export function observeApplicationOutput(request, directory, context = {}) {
  if (request.pythonCommand) return observePythonApplicationOutput(request, directory, context);
  let buffer = '', seen = false, datasetMarker = false, saveError = null, closed = false, saving = Promise.resolve();
  const decoder = new StringDecoder('utf8');
  const eventOutput = eventFeedOutputReader(request);
  function line(text) {
    if (seen || !request.applicationId) return;
    // Read only the maintained CLI's startup announcement. Later user-entered
    // terminal text and provider payloads cannot select a different application.
    text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    if (request.command === 'job-workspace') {
      if (!text.startsWith('{"schema":"stellar-forge.sf88.job-workspace-launch.v1",')) return;
      saving = saving.then(async () => {
        if (seen) return;
        const startup = await jobCheckoutStartup(request, text);
        const url = startup && privateUrl(startup.url);
        if (!url) return;
        seen = true;
        await saveJSON(join(directory, 'application-url.json'), {
          schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
          operationId: directory.split('/').at(-1), command: request.command,
          source: 'original-command-stdout', observedAt: now(), url, original: startup.original,
        });
      }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });
      return;
    }
    if (request.command === 'blockscout' || request.command === 'tenderly-workspace') {
      const tenderly = request.command === 'tenderly-workspace';
      if (!text.startsWith(tenderly ? '{"schema":"stellar-forge.tenderly-workspace-startup.v1",' :
        '{"schema":"stellar-forge.blockscout-startup.v1",')) return;
      saving = saving.then(async () => {
        if (seen) return;
        const startup = await (tenderly ? tenderlyStartup : blockscoutStartup)(request, text);
        const url = startup && privateUrl(startup.url);
        if (!url) return;
        seen = true;
        await saveJSON(join(directory, 'application-url.json'), {
          schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
          operationId: directory.split('/').at(-1), command: request.command,
          source: 'original-command-stdout', observedAt: now(), url, original: startup.original,
        });
      }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });
      return;
    }
    if (eventOutput) {
      for (const value of eventOutput(text)) {
        saving = saving.then(async () => {
          if (seen) return;
          const startup = await eventFeedStartup(request, directory, value);
          const url = startup && privateUrl(startup.url);
          if (!url) return;
          seen = true;
          await saveJSON(join(directory, 'application-url.json'), {
            schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
            operationId: directory.split('/').at(-1), command: request.command,
            source: 'original-command-stdout', observedAt: now(), url,
            links: startup.links, original: startup.original,
          });
        }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });
      }
      return;
    }
    let candidate = null;
    if (request.command === 'buyer-dataset-workspace') candidate = datasetBuyerStartup(request, text);
    if (request.command === 'openapi-workspace' && text.startsWith('API merchant workspace: '))
      candidate = text.slice('API merchant workspace: '.length);
    if (request.command === 'buyer-object-workspace' && text.startsWith('Object buyer workspace: '))
      candidate = text.slice('Object buyer workspace: '.length);
    if (request.command === 'commerce-console' && text.startsWith('Commerce workspace: '))
      candidate = text.slice('Commerce workspace: '.length);
    if (request.command === 'dataset-workspace') {
      if (text.startsWith('Dataset workspace —')) datasetMarker = true;
      else if (datasetMarker && text.startsWith('http://')) { candidate = text; datasetMarker = false; }
    }
    if (request.command === 'dataset' && request.args[0] === 'xml') {
      const match = text.match(/"console"\s*:\s*"([^"]+)"/);
      if (match) candidate = match[1];
    }
    if (['postgres-publisher', 'sheets-publisher', 'postgres-workspace'].includes(request.command)) {
      const field = request.command === 'postgres-workspace' ? 'workspace' : 'url';
      const match = text.match(new RegExp('"' + field + '"\\s*:\\s*"([^"]+)"'));
      if (match) candidate = match[1];
    }
    if (request.command === 'goldrush' && request.args[0] === 'workbench') {
      try {
        const ready = JSON.parse(text), stateIndex = request.args.indexOf('--state');
        if (ready.status === 'GOLDRUSH_WORKBENCH_READY' && stateIndex >= 0 &&
            ready.state === request.args[stateIndex + 1] && typeof ready.url === 'string') candidate = ready.url;
      } catch {}
    }
    if (request.command === 'research-workspace') {
      try {
        const ready = JSON.parse(text);
        const directoryIndex = request.args.indexOf('--dir');
        if (ready.mode === 'RESEARCH_DOSSIER_WORKSPACE' && directoryIndex >= 0 &&
            ready.directory === request.args[directoryIndex + 1] && typeof ready.url === 'string')
          candidate = ready.url;
      } catch {}
    }
    if (request.command === 'buyer-expenses') {
      try {
        const ready = JSON.parse(text), stateIndex = request.args.indexOf('--state');
        const portIndex = request.args.indexOf('--port');
        if (plain(ready) && stateIndex >= 0 && ready.state === request.args[stateIndex + 1] &&
            typeof ready.url === 'string') {
          const address = new URL(ready.url);
          const selectedPort = portIndex < 0 ? 0 : Number(request.args[portIndex + 1]);
          if (address.protocol === 'http:' && address.hostname === '127.0.0.1' &&
              address.pathname === '/' && !address.search && /^[#][A-Za-z0-9_-]{43}$/.test(address.hash) &&
              Number.isInteger(selectedPort) && (selectedPort === 0 || Number(address.port || 80) === selectedPort))
            candidate = ready.url;
        }
      } catch {}
    }
    if (request.command === 'merchant-recovery-remote' &&
        request.args[0] === 'workspace' && request.args[1] === 'serve') {
      try {
        const ready = JSON.parse(text), configIndex = request.args.indexOf('--config'),
          directoryIndex = request.args.indexOf('--directory');
        if (ready.status === 'MERCHANT_RECOVERY_WORKSPACE_READY' &&
            configIndex >= 0 && directoryIndex >= 0 &&
            ready.configFile === request.args[configIndex + 1] &&
            ready.directory === request.args[directoryIndex + 1] &&
            typeof ready.url === 'string') candidate = ready.url;
      } catch {}
    }
    const url = candidate && privateUrl(candidate);
    if (!url) return;
    seen = true;
    saving = saveJSON(join(directory, 'application-url.json'), {
      schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
      operationId: directory.split('/').at(-1), command: request.command,
      source: 'original-command-stdout', observedAt: now(), url,
    }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });
  }
  return {
    write(bytes) {
      if (!request.applicationId || seen) return;
      buffer += decoder.write(bytes);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const text of lines) line(text);
      if (buffer.length > 16384) buffer = buffer.slice(-16384);
    },
    async close() {
      if (!closed) { closed = true; buffer += decoder.end(); if (buffer) line(buffer); }
      await saving; if (saveError) throw saveError;
    },
  };
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
