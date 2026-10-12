// MIT. Optional private terminal and original CLI URL capture inside the managed runner.
import { constants } from 'node:fs';
import { readdir, lstat, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, operationId,
  recordId, operationLease, operationRunning, tailFile, plain, need, digest, json, canonical, now } from './storage.mjs';
import { applicationEnvironment } from './application-environment.mjs';
export { applicationEnvironment };
import { defaultApplicationProviders, readApplicationProvider, applicationProviderForKind,
  validateApplicationProviderBinding } from './application-providers.mjs';
import { observeApplicationStartup } from './application-provider.mjs';

const preparedProviders = new WeakMap();
const selectionHash = value => digest(json(canonical(value)));
const sameSelection = (left, right) => selectionHash(left) === selectionHash(right);
const receivedProviderPath = directory => join(directory, 'application-provider.json');
function checkedReceiving(value, request, directory) {
  const { integrity, ...body } = value ?? {};
  need(value?.schema === 'stellar-forge.application-provider-receiving.v1' &&
    value.requestHash === request.requestHash && value.applicationId === request.applicationId &&
    value.applicationRunId === operationId(basename(directory)) &&
    /^[a-f0-9]{64}$/.test(value.applicationRevision ?? '') &&
    integrity?.sha256 === selectionHash(body),
  'APPLICATION_PROVIDER_RECEIVING_CHANGED', 'The retained provider selection differs from this original request.');
  validateApplicationProviderBinding(value.applicationProvider);
  return value;
}
function acceptedSelection(selected, request) {
  need(selected.binding.command === request.command &&
    selected.provider.matchRequest(request) === true,
  'APPLICATION_PROVIDER_REQUEST_CHANGED', 'The selected provider does not accept this original managed command.');
  return selected.provider;
}
async function loadRequestProvider(request, directory) {
  need(plain(request), 'APPLICATION_PROVIDER_REQUEST_INVALID');
  if (!request.applicationId) {
    need(request.applicationProvider === undefined, 'APPLICATION_PROVIDER_APPLICATION_REQUIRED');
    return null;
  }
  if (request.applicationProvider !== undefined) {
    const expected = validateApplicationProviderBinding(request.applicationProvider);
    return acceptedSelection(await readApplicationProvider({
      id: expected.id, kind: expected.kind, expected,
    }), request);
  }
  // Preserve older request bytes. The immutable application revision supplies its
  // kind, while the same operation retains its selected source in one sidecar.
  const scoped = request.operation === 'managed-run' && /^[a-f0-9]{64}$/.test(request.requestHash ?? '') &&
    basename(dirname(directory)) === 'operations' && /^[a-f0-9-]{36}$/.test(basename(directory));
  if (scoped) {
    const received = await readJSON(receivedProviderPath(directory), true);
    if (received) {
      const expected = checkedReceiving(received, request, directory).applicationProvider;
      return acceptedSelection(await readApplicationProvider({
        id: expected.id, kind: expected.kind, expected,
      }), request);
    }
    const root = dirname(dirname(directory)), id = operationId(basename(directory));
    const applicationId = recordId(request.applicationId);
    const run = await readJSON(join(root, 'applications', applicationId, 'runs', id + '.json'), true);
    if (run) {
      need(run.schema === 'stellar-forge.application-run.v1' && run.id === id &&
        run.applicationId === applicationId && run.request?.requestId === id &&
        /^[a-f0-9]{64}$/.test(run.revision ?? '') &&
        run.requestHash === selectionHash({ applicationId, requestId: id, reviewId: run.reviewId }),
      'APPLICATION_PROVIDER_RUN_CHANGED');
      if (request.clientRequestHash) need(selectionHash(run.request) === request.clientRequestHash,
        'APPLICATION_PROVIDER_RUN_CHANGED', 'The application run differs from the original client request.');
      else for (const key of ['operation', 'homeId', 'releaseId', 'applicationId', 'command', 'args',
        'terminal', 'terminalPython', 'environmentFile', 'environmentSha256', 'pythonCommand',
        'buyerRunbook', 'jobResultReceiver', 'stellarApplication']) {
        if (Object.hasOwn(run.request, key))
          need(sameSelection(run.request[key], request[key]), 'APPLICATION_PROVIDER_RUN_CHANGED');
      }
      const application = await readJSON(join(root, 'applications', applicationId, 'revisions', run.revision + '.json'));
      need(application.schema === 'stellar-forge.runtime-application.v1' &&
        application.id === applicationId && application.revision === run.revision,
      'APPLICATION_PROVIDER_REVISION_CHANGED', 'Open the original saved application revision for this run.');
      const applicationBody = { kind: application.kind, label: application.label,
        runtimeId: application.runtimeId, runtime: application.runtime,
        ...(application.providerId === undefined ? {} : { providerId: application.providerId }),
        settings: application.settings, homeId: application.homeId, homeDirectory: application.homeDirectory,
        adoption: application.adoption, resourceKey: application.resourceKey };
      need(selectionHash(applicationBody) === application.revision, 'APPLICATION_PROVIDER_REVISION_CHANGED',
        'The saved application revision content differs from the original run.');
      const selected = await applicationProviderForKind(application.kind, { id: application.providerId ?? null });
      acceptedSelection(selected, request);
      const body = { schema: 'stellar-forge.application-provider-receiving.v1',
        applicationId, applicationRevision: run.revision, applicationRunId: id,
        requestHash: request.requestHash, applicationProvider: selected.binding, createdAt: now() };
      const value = { ...body, integrity: { sha256: selectionHash(body) } };
      try { await saveJSON(receivedProviderPath(directory), value); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = checkedReceiving(await readJSON(receivedProviderPath(directory)), request, directory);
        need(existing.applicationRevision === run.revision &&
          sameSelection(existing.applicationProvider, selected.binding), 'APPLICATION_PROVIDER_RECEIVING_CHANGED');
      }
      return selected.provider;
    }
  }
  // Older direct managed callers without an Applications run retain their exact
  // command-match contract, including the original global ambiguity check.
  return (await defaultApplicationProviders()).forRequest(request);
}
function requestProvider(request, directory) {
  const cached = preparedProviders.get(request);
  if (cached?.directory === directory) return cached;
  const entry = { directory, resolved: false, provider: null, promise: null };
  entry.promise = loadRequestProvider(request, directory).then(provider => {
    entry.provider = provider; entry.resolved = true; return provider;
  }).catch(error => {
    if (preparedProviders.get(request) === entry) preparedProviders.delete(request);
    throw error;
  });
  entry.promise.catch(() => {});
  preparedProviders.set(request, entry);
  return entry;
}
const selectedObserver = (provider, request, directory, context) => provider
  ? provider.createObserver(request, directory, context)
  : observeApplicationStartup(request, directory, () => null);


const TERMINAL = fileURLToPath(new URL('./application-terminal.py', import.meta.url));
const MAX_INPUT = 4096;
export async function prepareApplicationCommand(request, directory, originalArgs) {
  preparedProviders.delete(request);
  const provider = await requestProvider(request, directory).promise;
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
  const selected = requestProvider(request, directory);
  if (selected.resolved) return selectedObserver(selected.provider, request, directory, context);
  // Direct observer callers keep the synchronous write/close object. The actual
  // managed runner has already awaited preparation, so its observer is immediate.
  let closed = false, completion = null;
  let pending = selected.promise.then(provider => selectedObserver(provider, request, directory, context));
  pending.catch(() => {});
  return {
    write(bytes) {
      if (closed) return;
      const retained = Buffer.from(bytes);
      pending = pending.then(observer => { observer.write(retained); return observer; });
      pending.catch(() => {});
    },
    close() {
      if (!completion) { closed = true; completion = pending.then(observer => observer.close()); }
      return completion;
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
