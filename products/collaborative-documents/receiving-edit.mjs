// SPDX-License-Identifier: MIT
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, relative, sep, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectOriginalSource } from './managed.mjs';

const SCHEMA = 'stellar-forge.collaborative-documents-receiving-edit.v1';
const MAX_DOCUMENT = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
function need(value, code, message) {
  if (!value) throw Object.assign(new Error(message), { code });
}
function issue(code, message) { return Object.assign(new Error(message), { code }); }
function publicFailure(error) {
  return { code: /^[A-Z0-9_:-]{1,120}$/.test(error?.code || '') ? error.code : 'NATIVE_EDIT_FAILED',
    message: 'The retained original native edit remains available for this operation.' };
}
async function exists(path) {
  try { await fs.lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function regular(path) {
  const stat = await fs.lstat(path);
  need(stat.isFile() && !stat.isSymbolicLink(), 'EDIT_FILE_TYPE', 'Use a retained regular file.');
  return stat;
}
async function body(path, maximum = MAX_DOCUMENT) {
  const stat = await regular(path);
  need(stat.size <= maximum, 'EDIT_FILE_SIZE', 'The selected native file exceeds its permitted size.');
  const bytes = await fs.readFile(path);
  need(bytes.length === stat.size && bytes.length <= maximum, 'EDIT_FILE_CHANGED', 'The retained file changed while reading.');
  return bytes;
}
async function readJSON(path) { return JSON.parse((await body(path, 4 * 1024 * 1024)).toString('utf8')); }
async function syncDirectory(path) {
  const fd = await fs.open(path, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function immutable(path, bytes) {
  if (await exists(path)) {
    need((await body(path)).equals(bytes), 'EDIT_IMMUTABLE_CHANGED', 'The retained original edit bytes differ.');
    return;
  }
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.pending-' + randomUUID(), fd = await fs.open(temp, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  try { await fs.link(temp, path); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await body(path)).equals(bytes), 'EDIT_IMMUTABLE_CHANGED', 'The retained original edit bytes differ.');
  } finally { await fs.unlink(temp); }
  await syncDirectory(dirname(path));
}
async function atomic(path, bytes) {
  const temp = path + '.pending-' + randomUUID(), fd = await fs.open(temp, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  await fs.rename(temp, path); await syncDirectory(dirname(path));
}
function safeRelative(value) {
  need(typeof value === 'string' && value && !isAbsolute(value) && !value.includes('\\') &&
    !value.split('/').some(part => !part || part === '.' || part === '..'), 'EDIT_RELATIVE_PATH', 'Use an edit-relative artifact path.');
  return value;
}
async function descriptor(root, path) {
  const bytes = await body(path);
  return { path: safeRelative(relative(root, path).split(sep).join('/')), bytes: bytes.length, sha256: hash(bytes) };
}
async function checkedFile(root, selected) {
  safeRelative(selected?.path);
  need(Number.isSafeInteger(selected.bytes) && selected.bytes >= 0 && /^[a-f0-9]{64}$/.test(selected.sha256),
    'EDIT_DESCRIPTOR_INVALID', 'The retained edit file descriptor is invalid.');
  const bytes = await body(join(root, selected.path));
  need(bytes.length === selected.bytes && hash(bytes) === selected.sha256, 'EDIT_OUTPUT_CHANGED', 'The complete selected edit bytes changed.');
  return bytes;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function samePersistence(retained, snapshot) {
  return !!retained && retained.sha256 === snapshot.sha256 && retained.bytes === snapshot.bytes &&
    retained.stateVectorBase64 === snapshot.stateVectorBase64 &&
    retained.stateVectorSha256 === snapshot.stateVectorSha256;
}
function identityMatches(expected, observed) {
  return ['projectId', 'documentId', 'tenantId', 'documentName', 'epochId', 'deploymentId', 'schemaId', 'field']
    .every(key => expected[key] === observed?.[key]);
}

/**
 * Own one original Hocuspocus/Yjs edit within the existing receiving programme.
 * Construction has no side effects: retain this owner before calling run().
 * Actor and short-lived session credentials are private closure values. Only
 * actor.id enters retained intent. Caller closes this owner before checkpoint.
 */
export function openReceivingEdit(options = {}) {
  const chosen = { ...options, actor: options.actor ? { ...options.actor } : null };
  const controller = new AbortController(), tasks = new Set(), sockets = new Set();
  const parentSignal = chosen.signal || null;
  let stopping = false, closed = false, closePromise = null, runPromise = null;
  let sourceRoot, directory, request, identity, selection, native, Y, lease;
  let socket = null, provider = null, doc = null, candidate = null;
  let providerDestroyed = false, socketDestroyed = false, docDestroyed = false, candidateDestroyed = false;
  let firstFailure = null, initialToken = null, tokenWork = null;
  let authenticated = false, synced = false, pending = 0, revision = 0, result = null, deadline = null;
  const fail = error => {
    firstFailure ||= error instanceof Error ? error : issue('NATIVE_EDIT_FAILED', 'The original edit failed.');
    if (!controller.signal.aborted) controller.abort(firstFailure);
    return firstFailure;
  };
  const parentAbort = () => fail(issue('NATIVE_EDIT_INTERRUPTED', 'The original receiving edit was interrupted.'));
  if (parentSignal?.aborted) parentAbort();
  else parentSignal?.addEventListener('abort', parentAbort, { once: true });
  function check() {
    need(!stopping && !closed, 'NATIVE_EDIT_CLOSING', 'The original edit owner is closing.');
    if (controller.signal.aborted) throw firstFailure || controller.signal.reason;
  }
  function track(work) {
    const task = Promise.resolve(work); tasks.add(task);
    task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }
  async function pause(ms) {
    check();
    await new Promise((done, reject) => {
      const timer = setTimeout(finish, ms);
      function finish() { controller.signal.removeEventListener('abort', abort); done(); }
      function abort() { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); reject(firstFailure || controller.signal.reason); }
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    check();
  }
  async function api(path, method = 'GET') {
    check();
    return track((async () => {
      let response;
      try {
        response = await fetch(new URL(path, chosen.origin), { method, redirect: 'error', signal: controller.signal,
          headers: { authorization: 'Bearer ' + chosen.actor.token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
          ...(method === 'POST' ? { body: '{}' } : {}) });
        const chunks = []; let length = 0;
        for await (const chunk of response.body || []) {
          length += chunk.length;
          need(length <= 4 * 1024 * 1024, 'EDIT_HTTP_SIZE', 'The original response exceeds its selected limit.');
          chunks.push(Buffer.from(chunk));
        }
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw issue('EDIT_HTTP_JSON', 'The original native API did not return valid JSON.'); }
        if (!response.ok) {
          const code = /^[A-Z0-9_:-]{1,120}$/.test(value?.error?.code || '') ? value.error.code : 'EDIT_HTTP_FAILED';
          throw Object.assign(issue(code, 'The original host rejected this receiving edit request.'), { status: response.status });
        }
        check(); return value;
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    })());
  }
  const route = suffix => '/api/projects/' + encodeURIComponent(chosen.projectId) + '/documents/' + encodeURIComponent(chosen.documentId) + suffix;
  async function session() {
    const value = await api(route('/session'), 'POST');
    need(identityMatches(identity, value) && value.actor?.id === chosen.actor.id,
      'EDIT_SESSION_CHANGED', 'The current host selected another actor, document, epoch, schema or deployment.');
    need(value.access === 'write', 'EDIT_WRITE_GRANT_REQUIRED', 'The current original document grant must permit editing.');
    const url = new URL(value.websocketUrl), origin = new URL(chosen.origin);
    need(url.protocol === (origin.protocol === 'https:' ? 'wss:' : 'ws:') && url.host === origin.host &&
      url.pathname === '/collaboration/' + chosen.projectId && !url.search && !url.hash && !url.username && !url.password,
      'EDIT_SOCKET_SELECTION', 'Use the original selected host and project collaboration address.');
    need(typeof value.token === 'string' && value.token.length >= 20 && value.token.length <= 8192,
      'EDIT_SESSION_TOKEN', 'The original host did not return a valid private native session.');
    return value;
  }
  async function freshToken() {
    check();
    if (initialToken) { const token = initialToken; initialToken = null; return token; }
    if (!tokenWork) tokenWork = track(session()).then(value => { check(); return value.token; })
      .finally(() => { tokenWork = null; });
    return tokenWork;
  }
  async function persistence() {
    const value = await api(route('/persistence'));
    need(value.projectId === identity.projectId && value.documentId === identity.documentId &&
      value.documentName === identity.documentName && value.epochId === identity.epochId,
      'EDIT_EPOCH_CHANGED', 'The original physical document epoch changed.');
    need(value.deploymentState === 'running', 'EDIT_DEPLOYMENT_STOPPED', 'The selected original deployment is no longer running.');
    return value;
  }
  function snapshot(target) {
    const bytes = Buffer.from(Y.encodeStateAsUpdate(target)), vector = Buffer.from(Y.encodeStateVector(target));
    need(bytes.length <= MAX_DOCUMENT, 'EDIT_DOCUMENT_SIZE', 'The complete native document exceeds 32 MiB.');
    return { update: bytes, sha256: hash(bytes), bytes: bytes.length,
      stateVectorBase64: vector.toString('base64'), stateVectorSha256: hash(vector) };
  }
  function publicSnapshot(value) {
    return { sha256: value.sha256, bytes: value.bytes, stateVectorBase64: value.stateVectorBase64, stateVectorSha256: value.stateVectorSha256 };
  }
  async function nativePersisted() {
    for (;;) {
      check();
      if (synced && authenticated && pending === 0) {
        const at = revision, current = snapshot(doc), observed = await persistence();
        if (at === revision && pending === 0 && samePersistence(observed.persisted, current))
          return { current, persisted: observed.persisted, observedAt: observed.observedAt };
      }
      await pause(200);
    }
  }
  async function run() {
    if (runPromise) return runPromise;
    need(!stopping && !closed, 'NATIVE_EDIT_CLOSED', 'The original edit owner is closed.');
    runPromise = (async () => {
      check();
      const timeout = chosen.timeoutMs ?? 60000;
      need(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 300000, 'EDIT_TIMEOUT', 'Select a receiving edit timeout between 1 and 300 seconds.');
      deadline = setTimeout(() => fail(issue('EDIT_TIMEOUT', 'The native edit did not reach complete persisted state within the selected operation timeout.')), timeout);
      for (const key of ['sourceRoot', 'runtimeReadyFile', 'directory'])
        need(typeof chosen[key] === 'string' && isAbsolute(chosen[key]), 'EDIT_PATH_REQUIRED', 'Select absolute original source, runtime receipt and private operation paths.');
      sourceRoot = await fs.realpath(chosen.sourceRoot);
      directory = resolve(chosen.directory);
      const rel = relative(sourceRoot, directory);
      need(rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel), 'EDIT_DIRECTORY_SELECTION', 'Keep edit state outside the unchanged original application source.');
      const url = new URL(chosen.origin);
      need(['http:', 'https:'].includes(url.protocol) && url.origin === chosen.origin && !url.username && !url.password,
        'EDIT_ORIGIN_REQUIRED', 'Select the original application origin without credentials or a path.');
      need(chosen.actor && typeof chosen.actor.token === 'string' && chosen.actor.token.length >= 24 && chosen.actor.token.length <= 1024,
        'EDIT_ACTOR_REQUIRED', 'Use the existing private original actor.');
      for (const key of ['projectId', 'documentId', 'tenantId', 'epochId', 'documentName', 'deploymentId', 'requestId'])
        need(typeof chosen[key] === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(chosen[key]), 'EDIT_ID_REQUIRED', 'Select the exact original ' + key + '.');
      need(typeof chosen.actor.id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(chosen.actor.id), 'EDIT_ACTOR_ID', 'Select the original actor identity.');
      need(typeof chosen.text === 'string' && chosen.text.length > 0 && chosen.text.length <= 16384 && !/[\u0000-\u001f\u007f]/u.test(chosen.text),
        'EDIT_TEXT_REQUIRED', 'Supply one explicit paragraph without control characters, up to 16384 characters.');
      const original = await inspectOriginalSource({ directory: sourceRoot });
      const [{ selectRuntime }, leases, migration] = await Promise.all([
        import(pathToFileURL(join(sourceRoot, 'native/selection.mjs')).href),
        import(pathToFileURL(join(sourceRoot, 'vendor/stellar-expert/store.mjs')).href),
        import(pathToFileURL(join(sourceRoot, 'core/migration.mjs')).href),
      ]);
      selection = await selectRuntime({ sourceRoot, runtimeReadyFile: chosen.runtimeReadyFile });
      native = await migration.nativeSchema(); Y = native.Y;
      identity = Object.freeze({ projectId: chosen.projectId, documentId: chosen.documentId, tenantId: chosen.tenantId,
        documentName: chosen.documentName, epochId: chosen.epochId, deploymentId: chosen.deploymentId,
        schemaId: native.shared.SCHEMA_ID, field: native.shared.FIELD_NAME });
      need(identity.schemaId === selection.schemaSelection.schemaId && identity.field === selection.schemaSelection.field,
        'EDIT_NATIVE_SCHEMA', 'The installed original native schema differs from its retained selected receipt.');
      request = { schema: SCHEMA, sourceRoot, sourceManifestSha256: original.manifestSha256,
        runtimeReadyFile: await fs.realpath(chosen.runtimeReadyFile), runtimeSelectionSha256: selection.selectionSha256,
        origin: chosen.origin, actorId: chosen.actor.id, identity, requestId: chosen.requestId, text: chosen.text };
      directory = await leases.privateDirectory(directory, { create: true });
      lease = await leases.acquireWorkspaceLease(directory);
      const requestPath = join(directory, 'request.json');
      if (await exists(requestPath)) need(chosen.resume === true, 'EDIT_RESUME_REQUIRED', 'Resume the same retained original receiving edit explicitly.');
      await immutable(requestPath, json(request)); await lease.assert();
      const host = await api('/api/session');
      need(host.actor?.id === chosen.actor.id && host.runtime?.selectionSha256 === selection.selectionSha256,
        'EDIT_HOST_SELECTION', 'The original host actor or installed runtime differs from the receiving selection.');
      const firstSession = await session(); initialToken = firstSession.token;
      const completedPath = join(directory, 'result.json');
      if (await exists(completedPath)) {
        const completed = await readJSON(completedPath);
        need(completed.schema === SCHEMA && completed.state === 'PERSISTED' && same(completed.request, request),
          'EDIT_RESULT_SELECTION', 'The completed edit belongs to another retained operation.');
        need(Array.isArray(completed.files) && completed.files.length > 0, 'EDIT_RESULT_FILES', 'The completed edit is missing its full native files.');
        for (const row of completed.files) await checkedFile(directory, row);
        const persisted = await persistence();
        need(samePersistence(persisted.persisted, completed.persisted), 'EDIT_COMPLETED_STATE_CHANGED',
          'The original document changed after this completed receiving edit.');
        result = completed; return structuredClone(result);
      }
      const providerRow = selection.packages.find(row => row.name === '@hocuspocus/provider');
      const socketRow = selection.packages.find(row => row.name === 'ws');
      need(providerRow && socketRow, 'EDIT_NATIVE_PACKAGES', 'The original selected provider and WebSocket packages are required.');
      const [providers, socketModule] = await Promise.all([
        import(pathToFileURL(providerRow.modulePath).href), import(pathToFileURL(socketRow.modulePath).href),
      ]);
      const NativeSocket = socketModule.WebSocket || socketModule.default;
      const owner = { stopping: () => stopping || closed || controller.signal.aborted };
      const OwnedSocket = class extends NativeSocket {
        constructor(address, protocols) {
          need(!owner.stopping(), 'EDIT_SOCKET_CLOSING', 'The original native socket owner is closing.');
          super(address, protocols, { origin: chosen.origin, maxPayload: MAX_DOCUMENT + 65536 });
          let done;
          const row = { socket: this, done: false, closed: new Promise(resolve => { done = resolve; }) };
          sockets.add(row);
          this.once('close', () => { row.done = true; done(); });
          this.on('error', () => {});
        }
      };
      doc = new Y.Doc();
      doc.on('update', () => { revision++; });
      socket = new providers.HocuspocusProviderWebsocket({ url: firstSession.websocketUrl, autoConnect: false,
        WebSocketPolyfill: OwnedSocket,
        onMaxAttemptsFailed: () => fail(issue('EDIT_CONNECTION_FAILED', 'The original native connection could not open.')) });
      provider = new providers.HocuspocusProvider({ websocketProvider: socket, name: identity.documentName, document: doc,
        token: freshToken,
        onAuthenticated: () => { authenticated = true; },
        onAuthenticationFailed: () => fail(issue('EDIT_NATIVE_AUTHENTICATION', 'The current original native document grant rejected the session.')),
        onSynced: ({ state }) => { synced = !!state; },
        onUnsyncedChanges: ({ number }) => { pending = Number(number) || 0; },
        onStatus: ({ status }) => { if (status !== 'connected') { synced = false; authenticated = false; } },
        onMaxAttemptsFailed: () => fail(issue('EDIT_CONNECTION_FAILED', 'The original native connection exhausted its attempts.')) });
      provider.attach();
      track(socket.connect()).catch(() => { if (!stopping) fail(issue('EDIT_CONNECTION_FAILED', 'The original native connection failed.')); });
      while (!synced || !authenticated) await pause(50);
      const candidatePath = join(directory, 'candidate', 'intent.json');
      let retained;
      if (await exists(candidatePath)) {
        retained = await readJSON(candidatePath);
        need(retained.schema === SCHEMA && same(retained.request, request), 'EDIT_CANDIDATE_SELECTION', 'The retained native candidate belongs to another edit.');
        need(Array.isArray(retained.files) && retained.files.length === 4, 'EDIT_CANDIDATE_FILES', 'The candidate must retain all four original native files.');
        for (const row of retained.files) await checkedFile(directory, row);
      } else {
        const before = await nativePersisted();
        candidate = new Y.Doc();
        Y.applyUpdate(candidate, before.current.update);
        const baselineVector = Y.encodeStateVector(candidate), fragment = candidate.getXmlFragment(identity.field);
        candidate.transact(() => {
          const paragraph = new Y.XmlElement('paragraph'), value = new Y.XmlText();
          value.insert(0, chosen.text); paragraph.insert(0, [value]); fragment.insert(fragment.length, [paragraph]);
        }, chosen.requestId);
        const content = native.prosemirror.yDocToProsemirrorJSON(candidate, identity.field);
        migration.validateJSON(content, native.schema);
        need([...candidate.share.keys()].every(key => key === identity.field), 'EDIT_NATIVE_FIELD', 'The candidate introduced an unselected native field.');
        const candidateState = snapshot(candidate), update = Buffer.from(Y.encodeStateAsUpdate(candidate, baselineVector));
        // Candidate transaction IDs are durably retained before any provider sees
        // the update. Recovery reuses these exact Yjs IDs, including after a
        // process loss between provider apply and the final persistence receipt.
        const stage = join(directory, 'candidate.pending-' + randomUUID());
        await fs.mkdir(stage, { mode: 0o700 });
        await immutable(join(stage, 'before.yjs'), before.current.update);
        await immutable(join(stage, 'candidate.yjs'), candidateState.update);
        await immutable(join(stage, 'update.yjs'), update);
        await immutable(join(stage, 'candidate-content.json'), json(content));
        const files = (await Promise.all(['before.yjs', 'candidate.yjs', 'update.yjs', 'candidate-content.json']
          .map(name => descriptor(stage, join(stage, name))))).map(row => ({ ...row, path: 'candidate/' + row.path }));
        retained = { schema: SCHEMA, request, before: publicSnapshot(before.current),
          candidate: publicSnapshot(candidateState), files, createdAt: now() };
        await immutable(join(stage, 'intent.json'), json(retained));
        await syncDirectory(stage);
        await fs.rename(stage, join(directory, 'candidate'));
        await syncDirectory(directory);
        candidate.destroy(); candidateDestroyed = true; candidate = null;
      }
      const updateFile = retained.files.find(row => row.path === 'candidate/update.yjs');
      const candidateFile = retained.files.find(row => row.path === 'candidate/candidate.yjs');
      need(updateFile && candidateFile, 'EDIT_CANDIDATE_FILES', 'The complete retained candidate and its native update are required.');
      const update = await checkedFile(directory, updateFile), retainedCandidate = await checkedFile(directory, candidateFile);
      const inspected = await migration.inspectBinary(retainedCandidate, identity.field);
      need(hash(inspected.bytes) === retained.candidate.sha256 && inspected.bytes.length === retained.candidate.bytes &&
        inspected.vector.toString('base64') === retained.candidate.stateVectorBase64 &&
        hash(inspected.vector) === retained.candidate.stateVectorSha256,
        'EDIT_CANDIDATE_BINARY', 'The retained original candidate binary no longer matches its complete native descriptor.');
      await session(); await lease.assert(); check();
      Y.applyUpdate(doc, update, chosen.requestId);
      provider.flushPendingUpdates?.();
      const saved = await nativePersisted();
      const savedBinary = await migration.inspectBinary(saved.current.update, identity.field);
      const content = savedBinary.json;
      const candidateContains = inspected.json.content?.some(node => node.type === 'paragraph' &&
        node.content?.map(item => item.text || '').join('') === chosen.text);
      const currentContains = content.content?.some(node => node.type === 'paragraph' &&
        node.content?.map(item => item.text || '').join('') === chosen.text);
      need(candidateContains && currentContains, 'EDIT_CONTENT_MISSING', 'The retained paragraph is absent from the complete native document.');
      const output = 'persisted-' + saved.current.sha256;
      await immutable(join(directory, output + '.yjs'), saved.current.update);
      await immutable(join(directory, output + '.json'), json(content));
      const files = await Promise.all(['request.json', 'candidate/intent.json', ...retained.files.map(row => row.path), output + '.yjs', output + '.json']
        .map(name => descriptor(directory, join(directory, name))));
      const completed = { schema: SCHEMA, state: 'PERSISTED', request, instanceId: host.instanceId,
        before: retained.before, candidate: retained.candidate, persisted: publicSnapshot(saved.current),
        nativeReceipt: saved.persisted, observedAt: saved.observedAt, files, completedAt: now() };
      await lease.assert(); await immutable(completedPath, json(completed));
      result = completed; return structuredClone(result);
    })().catch(async error => {
      fail(error);
      if (directory && lease) {
        try { await atomic(join(directory, 'last-failure.json'), json({ schema: SCHEMA, at: now(), error: publicFailure(error) })); } catch {}
      }
      throw error;
    }).finally(() => { clearTimeout(deadline); deadline = null; });
    return runPromise;
  }
  async function drainSockets() {
    let first;
    for (const row of sockets) {
      if (row.done) continue;
      if (row.socket.readyState === row.socket.CLOSED || row.socket.readyState === 3) { row.done = true; continue; }
      try {
        if (row.socket.readyState === 0) row.socket.terminate();
        else row.socket.close(1000, 'Receiving edit closed');
      } catch (error) { first ||= error; }
    }
    // A completed network notification is not a process/resource close. If an
    // actual socket will not finish, retain this owner and its lease for retry.
    const live = [...sockets].filter(row => !row.done);
    if (live.length) {
      let timer;
      try {
        await Promise.race([Promise.all(live.map(row => row.closed)), new Promise((_, reject) => {
          timer = setTimeout(() => reject(issue('EDIT_SOCKET_CLOSE_PENDING', 'The original socket remains owned; retry close on this owner.')), 10000);
        })]);
      } finally { clearTimeout(timer); }
    }
    if (first) throw first;
  }
  async function close() {
    if (closed) return { state: 'CLOSED' };
    if (closePromise) return closePromise;
    stopping = true; clearTimeout(deadline); deadline = null;
    if (!controller.signal.aborted) controller.abort(issue('EDIT_CLOSING', 'The original edit is closing.'));
    closePromise = (async () => {
      let first;
      const keep = error => { first ||= error; };
      try { if (socket && !socketDestroyed) socket.disconnect(); } catch (error) { keep(error); }
      try { await drainSockets(); } catch (error) { keep(error); }
      if (runPromise) await Promise.allSettled([runPromise]);
      while (tasks.size) await Promise.allSettled([...tasks]);
      if (tokenWork) await Promise.allSettled([tokenWork]);
      if (provider && !providerDestroyed) try { provider.destroy(); providerDestroyed = true; } catch (error) { keep(error); }
      if (socket && !socketDestroyed) try { socket.destroy(); socketDestroyed = true; } catch (error) { keep(error); }
      try { await drainSockets(); } catch (error) { keep(error); }
      if ((!provider || providerDestroyed) && (!socket || socketDestroyed) && [...sockets].every(row => row.done)) {
        if (candidate && !candidateDestroyed) try { candidate.destroy(); candidateDestroyed = true; } catch (error) { keep(error); }
        if (doc && !docDestroyed) try { doc.destroy(); docDestroyed = true; } catch (error) { keep(error); }
      }
      if (first) throw first;
      need((!provider || providerDestroyed) && (!socket || socketDestroyed) && (!doc || docDestroyed) &&
        (!candidate || candidateDestroyed) && [...sockets].every(row => row.done),
        'EDIT_CLOSE_INCOMPLETE', 'The original native edit still owns resources.');
      if (lease) { await lease.close(); lease = null; }
      parentSignal?.removeEventListener('abort', parentAbort);
      initialToken = null; chosen.actor = null; closed = true;
      return { state: 'CLOSED' };
    })();
    const attempt = closePromise;
    try { return await attempt; } finally { if (closePromise === attempt) closePromise = null; }
  }
  return {
    run, close,
    inspect: () => ({ schema: SCHEMA, state: closed ? 'CLOSED' : stopping ? 'CLOSING' : result ? 'PERSISTED' : runPromise ? 'RUNNING' : 'NEW',
      identity: identity ? structuredClone(identity) : null, activeSockets: [...sockets].filter(row => !row.done).length,
      authenticated, synced, pendingUpdates: pending }),
  };
}
