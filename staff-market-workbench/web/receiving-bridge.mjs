/**
 * Receiving mount for the original market-workbench host.
 * Business actions use its retained operation/revision transport. Source/field
 * reads and exact native downloads are GET requests and preserve workspace revision.
 */
export function mountReceivingBridge(element, {
  request, mutate, getState, refresh: refreshHost, onOpenAnalysis, note
} = {}) {
  if (!element?.ownerDocument || typeof request !== 'function' ||
      typeof mutate !== 'function' || typeof getState !== 'function') {
    throw new TypeError('Provide the original workspace request, mutate and state functions.');
  }

  const document = element.ownerDocument;
  const holder = document.createElement('div');
  holder.className = 'receiving-host';
  const status = document.createElement('p');
  status.className = 'muted';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Loading saved receiving work…';
  holder.append(status);
  element.replaceChildren(holder);

  let destroyed = false;
  let mount = null;
  let mountedWorkspaceId = null;
  let latestState = null;
  let loadSequence = 0;
  let appliedSequence = 0;
  let modulePromise = null;
  const savedKinds = new Set(['handoff', 'return-review', 'annual-review']);
  const actions = new Set([
    'inspectSnapshot', 'previewHandoff', 'createHandoff', 'exportHandoff',
    'exportRecord', 'importHandoff', 'previewReturn', 'reviewReturn',
    'compareHandoffs', 'reviewAnnualChange'
  ]);

  function workspaceId() {
    const id = getState()?.workspace?.id;
    if (typeof id !== 'string' || !id) {
      throw new Error('Open the original market workspace before receiving work.');
    }
    return id;
  }

  function validId(value, label) {
    if (typeof value !== 'string' || !value) throw new Error('Select the original ' + label + '.');
    return encodeURIComponent(value);
  }

  function liveFor(id) {
    return !destroyed && holder.parentNode === element && getState()?.workspace?.id === id;
  }

  function assertLive(id = mountedWorkspaceId) {
    if (!id || !liveFor(id)) {
      throw new Error('The receiving view changed. Reopen it in the current workspace.');
    }
  }

  function reportError(error) {
    if (destroyed || holder.parentNode !== element) return;
    const message = error?.message ?? String(error);
    if (!mount) {
      status.textContent = message;
      status.className = 'notice';
      holder.replaceChildren(status);
    }
    if (typeof note === 'function') note(message, true);
  }

  async function readDownload(kind, identity, record) {
    const window = document.defaultView;
    const response = await window.fetch('/api/extensions/receiving/download/' +
      encodeURIComponent(kind) + '/' + validId(identity, 'receiving document'),
      {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw Object.assign(new Error(value.error || 'The original receiving export could not be read.'),
        {code: value.code, status: response.status, details: value.details});
    }
    const raw = await response.arrayBuffer();
    if (raw.byteLength > 32 * 1024 * 1024) throw new Error('The receiving export exceeds 32 MiB.');
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1];
    if (!filename) throw new Error('The original receiving export filename was not returned.');
    const digest = await window.crypto.subtle.digest('SHA-256', raw);
    return {schema: record.schema, kind: 'export', filename,
      mime: response.headers.get('Content-Type') || 'application/octet-stream',
      content: new window.TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw),
      encoding: 'utf-8', bytes: raw.byteLength,
      sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')};
  }

  async function api(action, payload = {}) {
    const id = mountedWorkspaceId;
    assertLive(id);
    let result;
    if (action === 'snapshot') {
      result = await request('/api/extensions/receiving/document/snapshot/' +
        validId(payload.id, 'reviewed pricing snapshot'));
    } else if (action === 'document') {
      if (!savedKinds.has(payload.kind)) throw new Error('Select a saved receiving document.');
      result = await request('/api/extensions/receiving/document/' +
        encodeURIComponent(payload.kind) + '/' + validId(payload.id, 'receiving document'));
    } else if (action === 'inspectSnapshot') {
      const selected = payload.snapshot ?? payload.snapshotId;
      result = await request('/api/extensions/receiving/document/snapshot-fields/' +
        validId(typeof selected === 'object' && selected ? selected.id : selected,
          'reviewed pricing snapshot'));
    } else if (action === 'exportHandoff') {
      const selected = payload.handoff;
      const identity = typeof selected === 'object' && selected ? selected.id : selected;
      const record = await request('/api/extensions/receiving/document/handoff/' +
        validId(identity, 'receiving handoff'));
      if (record.id !== identity || record.kind !== 'handoff' ||
          (selected?.sha256 && record.sha256 !== selected.sha256)) {
        throw new Error('The requested handoff differs from the saved original edition.');
      }
      const format = payload.format || record.profile.format;
      if (!['csv', 'tsv', 'json'].includes(format)) throw new Error('Choose CSV, TSV or JSON.');
      assertLive(id);
      result = await readDownload('handoff-' + format, identity, record);
    } else if (action === 'exportRecord') {
      if (!savedKinds.has(payload.kind)) throw new Error('Select a saved receiving document.');
      const record = await request('/api/extensions/receiving/document/' +
        encodeURIComponent(payload.kind) + '/' + validId(payload.id, 'receiving document'));
      if (record.id !== payload.id || record.kind !== payload.kind) {
        throw new Error('The selected original receiving record was not returned.');
      }
      assertLive(id);
      result = await readDownload(payload.kind, payload.id, record);
    } else {
      if (!actions.has(action)) throw new Error('Unknown receiving workspace action.');
      const envelope = await mutate('/api/extensions/receiving/' + encodeURIComponent(action), payload);
      if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, 'result')) {
        throw new Error('The workspace did not return its receiving operation result.');
      }
      result = envelope.result;
    }
    assertLive(id);
    return result;
  }

  function validateState(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.snapshots) ||
        !Array.isArray(value.handoffs) || !Array.isArray(value.returnReviews) ||
        !Array.isArray(value.annualReviews)) {
      throw new Error('The original workspace did not return its saved receiving index.');
    }
    return value;
  }

  async function loadState(apply = true) {
    if (destroyed) return null;
    const id = workspaceId();
    const sequence = ++loadSequence;
    if (mountedWorkspaceId && mountedWorkspaceId !== id) {
      mount?.dispose();
      mount = null;
      latestState = null;
      mountedWorkspaceId = null;
      holder.replaceChildren(status);
      status.textContent = 'Loading this workspace’s receiving work…';
    }

    const value = validateState(await request('/api/extensions/receiving/state'));
    if (!liveFor(id)) return null;
    if (latestState && Number.isSafeInteger(value.revision) &&
        Number.isSafeInteger(latestState.revision) && value.revision < latestState.revision) {
      return {state: latestState, snapshots: latestState.snapshots};
    }
    if (sequence < appliedSequence) return latestState ? {state: latestState, snapshots: latestState.snapshots} : null;
    latestState = value;
    appliedSequence = sequence;
    const next = {state: value, snapshots: value.snapshots};
    if (!apply) return next;

    if (mount) {
      mount.update(next);
      return next;
    }
    modulePromise ??= import('/extensions/receiving/browser.mjs').catch(error => {
      modulePromise = null;
      throw error;
    });
    const {mountReceiving} = await modulePromise;
    if (!liveFor(id) || sequence < appliedSequence) return null;
    mountedWorkspaceId = id;
    mount = mountReceiving(holder, {
      ...next,
      api,
      onSaved: async ({result}) => {
        if (!liveFor(id)) return null;
        try {
          if (typeof refreshHost === 'function') await refreshHost(false);
          if (!liveFor(id)) return null;
          return await loadState(false);
        } catch (error) {
          if (liveFor(id) && typeof note === 'function') {
            note('Saved ' + result.id + '. The receiving index could not refresh: ' +
              (error?.message ?? String(error)), true);
          }
          return null;
        }
      },
      onOpenAnalysis: typeof onOpenAnalysis === 'function' ? async payload => {
        assertLive(id);
        if (typeof payload?.analysisId !== 'string' || !payload.analysisId ||
            payload.sourceRow?.id !== payload.analysisId ||
            payload.sourceRow?.data?.id !== payload.analysisId) {
          throw new Error('This saved correction does not identify its original pricing analysis.');
        }
        return onOpenAnalysis(payload);
      } : undefined
    });
    return next;
  }

  const controller = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadSequence++;
      mount?.dispose();
      mount = null;
      latestState = null;
      if (holder.parentNode === element) holder.remove();
    },
    refresh() {
      return loadState().catch(error => {
        reportError(error);
        throw error;
      });
    }
  };
  controller.ready = controller.refresh().catch(() => null);
  return controller;
}
