// MIT. One owned child of the original collection CLI for a private browser host.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { initializationDirectory, optionalInitializationBytes,
  retainInitializationRecord } from '../initialization.mjs';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const REQUEST = /^[a-f0-9-]{36}$/;
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
  ? error.code : 'COLLECTION_RUN_FAILED';
function need(value, code) {
  if (!value) throw Object.assign(new Error(code), { code, status: 409 });
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const path = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0');
const view = run => run ? {
  launchId: run.launchId, requestId: run.requestId, collectionId: run.collectionId,
  manifestSha256: run.manifestSha256, intentIds: [...run.intentIds],
  workspaceByIntent: { ...run.workspaceByIntent }, state: run.state,
  startedAt: run.startedAt, completedAt: run.completedAt ?? null,
  exitCode: run.exitCode ?? null, signal: run.signal ?? null,
  error: run.error ?? null,
} : null;

export async function createCollectionBrowserRunner({
  collections, approvals, environment = process.env,
} = {}) {
  need(collections && typeof collections.inspect === 'function'
    && typeof collections.directory === 'string', 'COLLECTION_CONTROLLER_REQUIRED');
  need(approvals && plain(approvals.environment)
    && typeof approvals.revoke === 'function', 'COLLECTION_APPROVAL_BROKER_REQUIRED');
  need(plain(environment), 'COLLECTION_ENVIRONMENT_REQUIRED');
  const brokerEnvironment = approvals.environment;
  need(typeof brokerEnvironment.SF81_APPROVAL_SOCKET === 'string'
    && typeof brokerEnvironment.SF81_APPROVAL_TOKEN === 'string',
    'COLLECTION_APPROVAL_BROKER_REQUIRED');
  // This is the original host's environment, copied only into its owned child.
  const childEnvironment = { ...environment,
    SF81_APPROVAL_SOCKET: brokerEnvironment.SF81_APPROVAL_SOCKET,
    SF81_APPROVAL_TOKEN: brokerEnvironment.SF81_APPROVAL_TOKEN };
  const directory = join(collections.directory, 'browser-runs');
  await initializationDirectory(directory, { create: true });
  const requests = new Map();
  let active = null, latest = null, closing = false, starting = false, closePromise, startingCompletion;

  async function readRecord(file) {
    const bytes = await optionalInitializationBytes(file, 512 * 1024);
    if (bytes === null) return null;
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'COLLECTION_RUN_RECORD_INVALID'); }
  }
  async function loadRun(requestId) {
    need(typeof requestId === 'string' && REQUEST.test(requestId), 'COLLECTION_RUN_REQUEST_INVALID');
    if (requests.has(requestId)) return requests.get(requestId);
    const path = join(directory, requestId);
    try { await initializationDirectory(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const saved = await readRecord(join(path, 'request.json'));
    if (!saved) return null;
    need(saved.schema === 'stellar-forge.sf88.collection-browser-run.v1'
      && saved.requestId === requestId && saved.launchId === requestId
      && typeof saved.collectionId === 'string' && HASH.test(saved.manifestSha256)
      && Array.isArray(saved.intentIds) && saved.intentIds.length > 0
      && saved.intentIds.every(intent => typeof intent === 'string')
      && plain(saved.workspaceByIntent) && typeof saved.selection === 'string'
      && typeof saved.startedAt === 'string', 'COLLECTION_RUN_RECORD_INVALID');
    need(saved.selection === JSON.stringify({ id: saved.collectionId,
      expectedManifestSha256: saved.manifestSha256, intentIds: saved.intentIds,
      workspaceByIntent: saved.workspaceByIntent }), 'COLLECTION_RUN_RECORD_INVALID');
    const result = await readRecord(join(path, 'result.json'));
    need(!result || result.schema === 'stellar-forge.sf88.collection-browser-result.v1'
      && result.requestId === requestId && result.manifestSha256 === saved.manifestSha256
      && ['FINISHED', 'PAUSED', 'NEEDS_REVIEW'].includes(result.state), 'COLLECTION_RUN_RECORD_INVALID');
    const run = { ...saved, path, state: result?.state ?? 'REOPENED',
      completedAt: result?.completedAt ?? null, exitCode: result?.exitCode ?? null,
      signal: result?.signal ?? null, error: result?.error ?? null, child: null, completion: null };
    return run;
  }
  async function retained(launchId) {
    const run = await loadRun(launchId);
    need(run, 'COLLECTION_RUN_NOT_FOUND');
    return run;
  }
  async function revoke(run) {
    const result = await Promise.allSettled(run.intentIds.map(intent => Promise.resolve().then(() => approvals.revoke(intent))));
    const failure = result.find(item => item.status === 'rejected');
    if (failure) run.error ??= { code: codeOf(failure.reason) };
  }
  async function inspect(launchId) {
    return view(launchId === undefined ? active ?? latest : await retained(launchId));
  }
  async function start({
    requestId, id, expectedManifestSha256, intentIds, workspace, workspaceByIntent = {},
  } = {}) {
    need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
    need(typeof requestId === 'string' && REQUEST.test(requestId)
      && typeof id === 'string' && HASH.test(expectedManifestSha256),
      'COLLECTION_RUN_REQUEST_INVALID');
    need(Array.isArray(intentIds) && intentIds.length > 0 && intentIds.length <= 500
      && intentIds.every(intent => typeof intent === 'string')
      && new Set(intentIds).size === intentIds.length, 'COLLECTION_INTENT_REQUIRED');
    need(plain(workspaceByIntent)
      && Object.entries(workspaceByIntent).every(([intent, directory]) =>
        intentIds.includes(intent) && path(directory)), 'COLLECTION_WORKSPACE_MAP_INVALID');
    need(workspace === undefined || path(workspace), 'COLLECTION_WORKSPACE_MAP_INVALID');
    need(workspace === undefined || Object.keys(workspaceByIntent).length === 0,
      'COLLECTION_ONE_WORKSPACE_SOURCE_REQUIRED');
    const mapping = Object.fromEntries(intentIds.filter(intent =>
      workspace !== undefined || Object.hasOwn(workspaceByIntent, intent))
      .map(intent => [intent, workspace ?? workspaceByIntent[intent]]));
    const selection = JSON.stringify({ id, expectedManifestSha256, intentIds, workspaceByIntent: mapping });
    need(Buffer.byteLength(selection) <= 256 * 1024, 'COLLECTION_RUN_REQUEST_TOO_LARGE');
    const prior = requests.get(requestId) ?? await loadRun(requestId);
    if (prior) {
      need(prior.selection === selection, 'COLLECTION_RUN_REQUEST_CHANGED');
      return { ...view(prior), reused: true };
    }
    need(!active && !starting, 'COLLECTION_RUN_ACTIVE');
    need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
    starting = true;
    let settleStarting;
    startingCompletion = new Promise(done => { settleStarting = done; });
    try {
      const snapshot = await collections.inspect(id);
      need(snapshot.manifestSha256 === expectedManifestSha256, 'COLLECTION_MANIFEST_CHANGED');
      const items = new Map(snapshot.items.map(item => [item.intentId, item]));
      need(intentIds.every(intent => items.has(intent)), 'COLLECTION_INTENT_UNKNOWN');
      need(intentIds.every(intent => items.get(intent).state === 'QUEUED'),
        'COLLECTION_RUN_REVIEW_REQUIRED');
      need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
      const run = { launchId: requestId, requestId, collectionId: id,
        manifestSha256: expectedManifestSha256, intentIds: [...intentIds],
        workspaceByIntent: mapping, selection, startedAt: new Date().toISOString(),
        state: 'STARTING', child: null, completion: null };
      run.path = join(directory, requestId);
      await initializationDirectory(run.path, { create: true });
      const retainedRequest = { schema: 'stellar-forge.sf88.collection-browser-run.v1',
        launchId: run.launchId, requestId, collectionId: id, manifestSha256: expectedManifestSha256,
        intentIds: run.intentIds, workspaceByIntent: mapping, selection, startedAt: run.startedAt,
        queueRoot: collections.queueRoot };
      try { await retainInitializationRecord(join(run.path, 'request.json'), retainedRequest); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const raced = await loadRun(requestId);
        need(raced?.selection === selection, 'COLLECTION_RUN_REQUEST_CHANGED');
        return { ...view(raced), reused: true };
      }
      // The permanent request is saved before dispatch. Reopening it after host
      // loss only exposes its original selection and queue history.
      need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
      while (requests.size >= 32) requests.delete(requests.keys().next().value);
      requests.set(requestId, run);
      active = latest = run;
      let complete;
      run.completion = new Promise(done => { complete = done; });
      let stderrTail = '', finished = false;
      const finish = async (exitCode, signal, failure) => {
        if (finished) return;
        finished = true;
        run.exitCode = exitCode; run.signal = signal;
        if (failure) run.error = { code: codeOf(failure) };
        if (!run.error) {
          for (const line of stderrTail.split('\n').reverse()) {
            try {
              const parsed = JSON.parse(line);
              if (/^[A-Z0-9_]{1,120}$/.test(parsed?.error ?? '')) {
                run.error = { code: parsed.error }; break;
              }
            } catch {}
          }
        }
        const paused = run.state === 'PAUSING';
        await revoke(run);
        run.state = paused ? 'PAUSED'
          : failure || signal || exitCode !== 0 ? 'NEEDS_REVIEW' : 'FINISHED';
        run.completedAt = new Date().toISOString();
        run.child = null;
        try {
          await retainInitializationRecord(join(run.path, 'result.json'), {
            schema: 'stellar-forge.sf88.collection-browser-result.v1',
            requestId, manifestSha256: run.manifestSha256, state: run.state,
            completedAt: run.completedAt, exitCode, signal, error: run.error ?? null,
          });
        } catch (error) {
          run.error ??= { code: codeOf(error) }; run.state = 'NEEDS_REVIEW';
        }
        if (active === run) active = null;
        complete(view(run));
      };
      const args = [CLI, 'run', '--directory', collections.directory, '--id', id,
        '--manifest-sha256', expectedManifestSha256,
        ...intentIds.flatMap(intent => ['--intent', intent]),
        ...Object.entries(mapping).flatMap(([intent, directory]) =>
          ['--workspace-for', intent + '=' + directory])];
      try {
        run.child = spawn(process.execPath, args, { env: childEnvironment,
          shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        // Authoritative results stay in the original collection/inbox, never a
        // second parsed stdout journal. Drain both streams without exposing them.
        run.child.stdout.resume();
        run.child.stderr.setEncoding('utf8');
        run.child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-8192); });
        run.child.once('error', error => { void finish(null, null, error); });
        run.child.once('close', (code, signal) => { void finish(code, signal); });
        run.state = 'RUNNING';
        if (Number.isInteger(run.child.pid)) {
          try { await retainInitializationRecord(join(run.path, 'process.json'), {
            schema: 'stellar-forge.sf88.collection-browser-process.v1',
            requestId, pid: run.child.pid, observedAt: new Date().toISOString(),
          }); }
          catch (error) { run.error ??= { code: codeOf(error) }; await pause({ launchId: run.launchId }); }
        }
      } catch (error) { await finish(null, null, error); }
      return view(run);
    } finally {
      starting = false; settleStarting(); startingCompletion = null;
    }
  }
  async function pause({ launchId } = {}) {
    const run = await retained(launchId);
    if (active !== run || run.child === null) return view(run);
    if (run.state !== 'PAUSING') {
      run.state = 'PAUSING';
      // Revoke the original review before signalling its original CLI's abort
      // handler; that handler retains queue outcomes and finishes native cleanup.
      await revoke(run);
      if (run.child && run.child.exitCode === null && run.child.signalCode === null)
        run.child.kill('SIGTERM');
    }
    return view(run);
  }
  function owns(launchId, intent) {
    const run = active;
    need(run && run.launchId === launchId && run.state === 'RUNNING', 'COLLECTION_RUN_NOT_ACTIVE');
    need(run.intentIds.includes(intent), 'COLLECTION_INTENT_UNKNOWN');
    return view(run);
  }
  // Reopen the most recent retained selection without launching an old child.
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!REQUEST.test(entry.name)) continue;
    need(entry.isDirectory() && !entry.isSymbolicLink(), 'COLLECTION_RUN_RECORD_INVALID');
    const run = await loadRun(entry.name);
    if (run && (!latest || run.startedAt > latest.startedAt)) latest = run;
  }
  return {
    inspect, start, pause, owns,
    get busy() { return active !== null || starting; },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await startingCompletion;
        const run = active;
        if (run) {
          await pause({ launchId: run.launchId });
          await run.completion;
        }
      })();
      return closePromise;
    },
  };
}
