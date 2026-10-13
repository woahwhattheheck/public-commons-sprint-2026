// SPDX-License-Identifier: MIT
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';
import { SCHEMA_ID, FIELD_NAME, createContentExtensions } from '../reference/schema.mjs';

export { SCHEMA_ID, FIELD_NAME };
const encoder = new TextEncoder();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function need(value, code, message) { if (!value) throw Object.assign(new Error(message), { code }); }
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function equalIdentity(expected, session) {
  return ['projectId', 'documentId', 'tenantId', 'documentName', 'epochId', 'schemaId', 'field'].every(key => expected[key] === session[key]);
}
function cleanError(error) { return { code: error?.code || 'EDITOR_ERROR', message: String(error?.message || error) }; }
function actorShade(actorId) {
  let hash = 0;
  for (const ch of String(actorId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const level = [46, 66, 87, 111, 130][hash % 5].toString(16).padStart(2, '0');
  return '#' + level.repeat(3);
}
// Observe the original browser sockets, including a socket the provider has
// already replaced in its own field. A disconnect notification is not closure.
class SocketCustody {
  constructor() {
    this.rows = new Set(); this.stopping = false;
    const owner = this, Native = globalThis.WebSocket;
    this.WebSocket = class extends Native {
      constructor(...args) {
        need(!owner.stopping, 'EDITOR_CLOSING', 'The original editor connection is closing.');
        super(...args);
        let finish;
        const row = { socket: this, done: false, closed: new Promise(resolve => { finish = resolve; }) };
        owner.rows.add(row);
        this.addEventListener('close', () => { row.done = true; finish(); }, { once: true });
      }
    };
  }
  async drain() {
    this.stopping = true;
    let first;
    for (const row of this.rows) {
      if (row.done) continue;
      if (row.socket.readyState === globalThis.WebSocket.CLOSED) { row.done = true; continue; }
      try { row.socket.close(1000, 'Original editor closed'); } catch (error) { first ||= error; }
    }
    await Promise.all([...this.rows].filter(row => !row.done).map(row => row.closed));
    if (first) throw first;
  }
}
const commandNames = {
  paragraph: 'setParagraph', heading2: 'toggleHeading', heading3: 'toggleHeading',
  bold: 'toggleBold', italic: 'toggleItalic', strike: 'toggleStrike', code: 'toggleCode',
  bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote',
  undo: 'undo', redo: 'redo',
};

/**
 * Open one original, authorized physical Yjs document. Session credentials never
 * enter IndexedDB, the exported inspector, the URL, or an operator request.
 */
export async function createCollaborativeEditor({
  element, instanceId, actor, projectId, document: selectedDocument,
  requestSession, readPersistence, onState = () => {}, onEpochChange = () => {}, isCurrent = () => true,
}) {
  need(element instanceof HTMLElement, 'EDITOR_ELEMENT_REQUIRED', 'Select the document editor element.');
  need(selectedDocument && projectId && instanceId && actor?.id, 'EDITOR_IDENTITY_REQUIRED', 'The host and document identities are required.');
  need(selectedDocument.schemaId === SCHEMA_ID && selectedDocument.field === FIELD_NAME,
    'EDITOR_SCHEMA_UNSUPPORTED', 'This installed editor does not contain the document’s selected schema and field. Its retained source remains available.');
  const expected = Object.freeze({
    projectId, documentId: selectedDocument.id, tenantId: selectedDocument.tenantId,
    documentName: selectedDocument.documentName, epochId: selectedDocument.epochId,
    schemaId: selectedDocument.schemaId, field: selectedDocument.field,
  });
  let session = await requestSession();
  need(isCurrent(), 'EDITOR_SELECTION_CHANGED', 'The selected editor changed while authorization was being read.');
  need(equalIdentity(expected, session), 'EDITOR_IDENTITY_CHANGED', 'The authorized document changed while it was opening. Refresh its current view.');
  need(session.actor?.id === actor.id && ['read', 'write'].includes(session.access),
    'EDITOR_SESSION_MISMATCH', 'The document session does not match the current host actor.');
  const websocket = new URL(session.websocketUrl, location.href);
  need(['ws:', 'wss:'].includes(websocket.protocol), 'EDITOR_SOCKET_INVALID', 'The host returned an invalid collaboration address.');
  need(typeof session.token === 'string' && session.token, 'EDITOR_TOKEN_MISSING', 'The host did not return a document session.');
  const identity = Object.freeze({ ...expected, instanceId, actorId: actor.id, deploymentId: session.deploymentId, access: session.access });
  // Each content restore has a new epoch. The previous cache is retained under
  // its original key and cannot be connected to the replacement document.
  const cacheName = 'tiptap-migration:' + [instanceId, actor.id, projectId, expected.tenantId,
    expected.documentId, expected.epochId, expected.schemaId, expected.field].map(encodeURIComponent).join(':');
  const doc = new Y.Doc();
  let local = null, provider = null, editor = null, socket = null;
  const custody = new SocketCustody(), tasks = new Set();
  let stopping = false, localDestroyed = false, providerDestroyed = false, socketDestroyed = false, editorDestroyed = false, docDestroyed = false;
  let closed = false, closing = null, retired = false, suspended = false, offline = false;
  let localTimer = null, remoteTimer = null, localWork = Promise.resolve(), remoteWork = null;
  let change = 0, tokenWork = null, initialToken = session.token;
  let state = {
    identity, cacheName, network: 'opening', initialSync: false, authenticated: false,
    localReady: false, localPersisted: false, saved: false, pendingUpdates: 0,
    persisted: null, local: null, peers: [], error: null, retired: false, offline: false,
    editable: session.access === 'write', words: 0, characters: 0,
  };
  const emit = () => { if (!closed) { try { onState(structuredClone(state)); } catch (error) { state = { ...state, observerError: cleanError(error) }; } } };
  const set = patch => { state = { ...state, ...patch }; emit(); };
  function retire(reason, replacement = null) {
    if (retired || closed) return;
    retired = true;
    editor?.setEditable(false);
    provider?.configuration.websocketProvider.disconnect();
    set({ retired: true, editable: false, saved: false, network: 'retired', error: { code: 'DOCUMENT_EPOCH_RETIRED', message: reason } });
    try { onEpochChange({ identity, replacement, reason }); } catch (error) { state = { ...state, observerError: cleanError(error) }; }
  }
  async function snapshot() {
    const at = change;
    const update = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    return {
      update, change: at, sha256: await sha256(update), bytes: update.byteLength,
      stateVectorBase64: base64(vector), stateVectorSha256: await sha256(vector),
    };
  }
  function scheduleLocal() {
    clearTimeout(localTimer);
    if (stopping || closed) return;
    localTimer = setTimeout(() => { flushLocal().catch(error => set({ localPersisted: false, error: cleanError(error) })); }, 180);
  }
  async function flushLocal() {
    need(!closed, 'EDITOR_CLOSED', 'The editor is closed.');
    clearTimeout(localTimer);
    const run = async () => {
      need(local, 'EDITOR_CACHE_UNAVAILABLE', 'The original document cache is not open.');
      const candidate = await snapshot();
      await storeState(local, true);
      // The original provider owns binary persistence. This metadata is a
      // receipt for that complete selected state, never an alternate document.
      await local.set('migration:last-flush', {
        schema: 'tjlabs.tiptap-local-flush.v1', identity, sha256: candidate.sha256,
        bytes: candidate.bytes, stateVectorBase64: candidate.stateVectorBase64,
        stateVectorSha256: candidate.stateVectorSha256, savedAt: new Date().toISOString(),
      });
      const same = candidate.change === change;
      set({ localPersisted: same, local: {
        sha256: candidate.sha256, bytes: candidate.bytes,
        stateVectorBase64: candidate.stateVectorBase64, stateVectorSha256: candidate.stateVectorSha256,
      } });
      if (!same && !closing) scheduleLocal();
      return candidate;
    };
    localWork = localWork.then(run, run);
    return localWork;
  }
  async function freshToken() {
    if (closed || stopping || retired || offline || suspended || !isCurrent()) throw Object.assign(new Error('This document connection is not active.'), { code: 'EDITOR_CONNECTION_PAUSED' });
    if (initialToken) { const value = initialToken; initialToken = null; return value; }
    if (!tokenWork) tokenWork = (async () => {
      const value = await requestSession();
      if (!equalIdentity(expected, value) || value.actor?.id !== actor.id) {
        retire('This document now has another physical epoch or access binding. The original local state is retained.', value);
        throw Object.assign(new Error('Document session identity changed.'), { code: 'DOCUMENT_EPOCH_CHANGED' });
      }
      if (closed || stopping || retired || offline || suspended) throw Object.assign(new Error('The editor was closed or paused while authorization was renewed.'), { code: 'EDITOR_CONNECTION_PAUSED' });
      need(value.access === 'read' || value.access === 'write', 'EDITOR_ACCESS_INVALID', 'The host returned an invalid document access mode.');
      session = value;
      editor?.setEditable(value.access === 'write');
      set({ editable: value.access === 'write' });
      return value.token;
    })().finally(() => { tokenWork = null; });
    return tokenWork;
  }
  function scheduleRemote(milliseconds = 1400) {
    clearTimeout(remoteTimer);
    if (closed || stopping || retired || suspended) return;
    remoteTimer = setTimeout(() => { checkPersisted().catch(() => {}); }, milliseconds);
  }
  async function checkPersisted() {
    if (closed || stopping || retired || suspended) return null;
    if (remoteWork) return remoteWork;
    remoteWork = (async () => {
      try {
        const receipt = await readPersistence();
        if (closed) return null;
        if (receipt.documentId !== identity.documentId || receipt.documentName !== identity.documentName || receipt.epochId !== identity.epochId) {
          retire('The receiving host replaced this document epoch. Download any remaining local state before opening the current document.', receipt);
          return null;
        }
        const current = await snapshot();
        if (closed || retired) return null;
        const retained = receipt.persisted;
        // State vectors omit deletion information. Complete v1 binary equality
        // is required alongside the vector, including deletion-only changes.
        const saved = !!retained && current.change === change
          && retained.sha256 === current.sha256 && retained.bytes === current.bytes
          && retained.stateVectorBase64 === current.stateVectorBase64
          && retained.stateVectorSha256 === current.stateVectorSha256;
        set({ saved, persisted: retained || null, deploymentState: receipt.deploymentState,
          current: { sha256: current.sha256, bytes: current.bytes, stateVectorSha256: current.stateVectorSha256 },
          error: state.error?.code === 'PERSISTENCE_READ_FAILED' ? null : state.error,
        });
        return { saved, identity, persisted: retained || null, local: current };
      } catch (error) {
        if (!closed && !stopping && !retired) {
          if (error?.status === 401 || error?.status === 403) {
            editor?.setEditable(false);
            provider?.configuration.websocketProvider.disconnect();
            set({ editable: false, authenticated: false, saved: false, network: 'authorization-required', error: cleanError(error) });
          } else set({ saved: false, error: { code: 'PERSISTENCE_READ_FAILED', message: String(error?.message || error) } });
        }
        throw error;
      } finally {
        remoteWork = null;
        scheduleRemote(state.saved ? 3000 : 1400);
      }
    })();
    return remoteWork;
  }
  function onUpdate() {
    change++;
    set({ localPersisted: false, saved: false });
    scheduleLocal();
    scheduleRemote(450);
  }
  function admit(work) {
    need(!stopping && !closed, 'EDITOR_CLOSING', 'The original editor is closing.');
    const task = Promise.resolve().then(work);
    tasks.add(task);
    task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }
  async function close() {
    if (closed) return { state: 'CLOSED' };
    if (closing) return closing;
    stopping = true;
    const attempt = (async () => {
      let first;
      const retain = error => { first ||= error; };
      try { if (!editorDestroyed) editor?.setEditable(false); } catch (error) { retain(error); }
      clearTimeout(localTimer); clearTimeout(remoteTimer);
      try { if (!providerDestroyed) provider?.flushPendingUpdates?.(); } catch (error) { retain(error); }
      try { if (!socketDestroyed) socket?.disconnect(); } catch (error) { retain(error); }
      // Native connection attempts and HTTP renewals remain owned until settled.
      try { await custody.drain(); } catch (error) { retain(error); }
      while (tasks.size) await Promise.allSettled([...tasks]);
      await Promise.allSettled([tokenWork, remoteWork, localWork].filter(Boolean));
      // Keep the exact live document and persistence owner if the final save
      // fails. A later close retries those same objects.
      if (local && !localDestroyed && state.localReady) {
        let flushFailed = false;
        try { await flushLocal(); } catch (error) { flushFailed = true; retain(error); }
        if (flushFailed || !state.localPersisted) {
          state = { ...state, error: cleanError(first || new Error('The original local state is not retained.')) };
          emit(); throw first || new Error('The original local state is not retained.');
        }
      }
      doc.off('update', onUpdate);
      if (editor && !editorDestroyed) try { editor.destroy(); editorDestroyed = true; } catch (error) { retain(error); }
      if (provider && !providerDestroyed) try { provider.destroy(); providerDestroyed = true; } catch (error) { retain(error); }
      if (socket && !socketDestroyed) try { socket.destroy(); socketDestroyed = true; } catch (error) { retain(error); }
      try { await custody.drain(); } catch (error) { retain(error); }
      // Do not destroy dependencies under an incompletely closed view/provider.
      if ((!editor || editorDestroyed) && (!provider || providerDestroyed) && (!socket || socketDestroyed)) {
        if (local && !localDestroyed) try { await local.destroy(); localDestroyed = true; } catch (error) { retain(error); }
        if ((!local || localDestroyed) && !docDestroyed) try { doc.destroy(); docDestroyed = true; } catch (error) { retain(error); }
      }
      if (first) throw first;
      need((!editor || editorDestroyed) && (!provider || providerDestroyed) && (!socket || socketDestroyed) &&
        (!local || localDestroyed) && docDestroyed, 'EDITOR_CLOSE_INCOMPLETE', 'The original editor still owns a resource.');
      closed = true; state = { ...state, editable: false, network: 'closed' };
      return { state: 'CLOSED' };
    })();
    closing = attempt;
    try { return await attempt; } finally { if (closing === attempt) closing = null; }
  }
  const failedOwner = { identity, cacheName, close,
    inspect: () => structuredClone({ ...state, closed, closing: stopping, json: closed ? null : editor?.getJSON() || null }) };
  function updateTextState() {
    if (!editor || closed) return;
    const text = editor.getText();
    set({ characters: text.length, words: text.trim() ? text.trim().split(/\s+/u).length : 0 });
  }
  try {
    local = new IndexeddbPersistence(cacheName, doc);
    await local.whenSynced;
    need(!closed && isCurrent(), 'EDITOR_CLOSED', 'The editor selection changed before its local document loaded.');
    set({ localReady: true });
    doc.on('update', onUpdate);
    socket = new HocuspocusProviderWebsocket({ url: websocket.href, autoConnect: false,
      WebSocketPolyfill: custody.WebSocket,
      onMaxAttemptsFailed: ({ error }) => set({ network: 'disconnected', error: cleanError(error || new Error('The collaboration connection needs to be reopened.')) }),
    });
    provider = new HocuspocusProvider({
      websocketProvider: socket, name: identity.documentName, document: doc,
      token: freshToken,
      onStatus: ({ status }) => set({ network: offline ? 'offline' : status }),
      onAuthenticated: () => set({ authenticated: true, error: null }),
      onAuthenticationFailed: ({ reason }) => {
        editor?.setEditable(false);
        set({ authenticated: false, editable: false, saved: false, network: 'authorization-required',
          error: { code: 'COLLABORATION_AUTHENTICATION_FAILED', message: String(reason || 'The host rejected this document session.') } });
      },
      onSynced: ({ state: synced }) => { set({ initialSync: !!synced }); scheduleRemote(0); },
      onUnsyncedChanges: ({ number }) => { set({ pendingUpdates: Number(number) || 0 }); scheduleRemote(300); },
      onAwarenessChange: ({ states }) => {
        const peers = (states || []).map(peer => ({ clientId: peer.clientId,
          name: String(peer.user?.name || peer.name || 'Editor'), color: String(peer.user?.color || '#555555') }));
        set({ peers });
      },
      onClose: ({ event } = {}) => {
        if (!closed && !retired) set({ network: offline ? 'offline' : suspended ? 'paused' : 'disconnected',
          lastClose: { code: event?.code ?? null, reason: String(event?.reason || '') } });
      },
      onMaxAttemptsFailed: ({ error }) => set({ network: 'disconnected', error: cleanError(error || new Error('The collaboration connection needs to be reopened.')) }),
    });
    provider.attach();
    editor = new Editor({
      element, editable: session.access === 'write',
      extensions: [
        ...createContentExtensions(),
        Collaboration.configure({ document: doc, field: identity.field }),
        CollaborationCaret.configure({ provider, user: { name: actor.name || actor.id, color: actorShade(actor.id) } }),
      ],
      // The retained Yjs state is the only content initializer.
      enableContentCheck: true,
      onContentError: ({ error, disableCollaboration }) => {
        disableCollaboration?.();
        retire('The installed editor cannot represent this retained content. Its original binary state is preserved for review.');
        set({ error: cleanError(error || new Error('The document contains unsupported schema content.')) });
      },
      onUpdate: updateTextState, onSelectionUpdate: () => emit(),
      editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': selectedDocument.title || 'Collaborative document', spellcheck: 'true' } },
    });
    updateTextState();
    await flushLocal();
    // Preserve native connect/retry behavior without treating its initial sync
    // as a durable-store acknowledgement.
    const connecting = socket.connect();
    tasks.add(connecting); connecting.then(() => tasks.delete(connecting), () => tasks.delete(connecting));
    scheduleRemote(0);
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { error.editorOwner = failedOwner; error.closeFailedEditor = close; error.editorCleanupError = cleanupError; }
    throw error;
  }
  const api = {
    identity, cacheName,
    inspect: () => structuredClone({ ...state, closed, closing: stopping, json: closed ? null : editor?.getJSON() || null }),
    async exportState() {
      const current = await flushLocal();
      return {
        filename: identity.documentId + '-' + identity.epochId + '.yjs',
        bytes: current.update,
        manifest: { schema: 'tjlabs.tiptap-editor-state.v1', identity, cacheName,
          nativeFormat: 'Y.encodeStateAsUpdate/v1', sha256: current.sha256, bytes: current.bytes,
          stateVectorBase64: current.stateVectorBase64, stateVectorSha256: current.stateVectorSha256,
          exportedAt: new Date().toISOString(), serverPersisted: state.persisted,
        },
      };
    },
    async flush() {
      await flushLocal();
      provider.flushPendingUpdates?.();
      return checkPersisted();
    },
    checkPersisted,
    format(name) {
      if (closed || stopping || retired || !editor?.isEditable || !commandNames[name]) return false;
      let chain = editor.chain().focus();
      const command = commandNames[name];
      if (typeof chain[command] !== 'function') return false;
      chain = name === 'heading2' ? chain[command]({ level: 2 }) : name === 'heading3' ? chain[command]({ level: 3 }) : chain[command]();
      return chain.run();
    },
    formatState(name) {
      if (closed || stopping || !editor) return { enabled: false, active: false };
      const active = name === 'heading2' ? editor.isActive('heading', { level: 2 })
        : name === 'heading3' ? editor.isActive('heading', { level: 3 }) : editor.isActive(name);
      let enabled = !retired && editor.isEditable && !!commandNames[name];
      if (enabled) {
        const chain = editor.can().chain();
        const command = commandNames[name];
        if (typeof chain[command] !== 'function') enabled = false;
        else enabled = (name === 'heading2' ? chain[command]({ level: 2 }) : name === 'heading3' ? chain[command]({ level: 3 }) : chain[command]()).run();
      }
      return { enabled, active };
    },
    async setOffline(value) {
      need(!closed && !stopping && !retired, 'EDITOR_CLOSED', 'This document connection cannot be reopened.');
      await flushLocal();
      need(!stopping && !closed, 'EDITOR_CLOSING', 'The original editor is closing.');
      offline = !!value;
      if (offline) {
        provider.flushPendingUpdates?.();
        provider.configuration.websocketProvider.disconnect();
        set({ offline: true, network: 'offline' });
      } else {
        const renewed = await requestSession();
        need(!stopping && !closed, 'EDITOR_CLOSING', 'The original editor is closing.');
        if (!equalIdentity(expected, renewed) || renewed.actor?.id !== actor.id) {
          retire('The original offline state belongs to an earlier document epoch. It remains available to download.', renewed);
          return;
        }
        session = renewed; initialToken = renewed.token;
        editor.setEditable(renewed.access === 'write');
        set({ offline: false, network: 'connecting', editable: renewed.access === 'write', error: null });
        await provider.configuration.websocketProvider.connect();
        scheduleRemote(0);
      }
    },
    retire,
    suspend() {
      if (closed || stopping || retired) return;
      suspended = true;
      provider.flushPendingUpdates?.();
      provider.configuration.websocketProvider.disconnect();
      clearTimeout(remoteTimer);
      flushLocal().catch(error => set({ localPersisted: false, error: cleanError(error) }));
      set({ network: 'paused' });
    },
    async resume() {
      if (closed || stopping || retired) return;
      suspended = false;
      if (!offline) {
        const renewed = await requestSession();
        need(!stopping && !closed, 'EDITOR_CLOSING', 'The original editor is closing.');
        if (!equalIdentity(expected, renewed) || renewed.actor?.id !== actor.id) {
          retire('The document changed while this page was suspended. Open its current epoch explicitly.', renewed);
          return;
        }
        session = renewed; initialToken = renewed.token;
        editor.setEditable(renewed.access === 'write');
        await provider.configuration.websocketProvider.connect();
      }
      scheduleRemote(0);
    },
    close,
  };
  for (const name of ['exportState', 'flush', 'setOffline', 'resume']) {
    const original = api[name]; api[name] = (...args) => admit(() => original(...args));
  }
  return api;
}
