// MIT. Original collection recovery, receiving and retained operation history.
const element = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
};
const append = (e, ...rows) => { e.append(...rows); return e; };
const human = value => String(value ?? '—').replaceAll('_', ' ');
const LIVE = new Set(['RUNNING', 'CANCELLING']);
const ID = /^[a-f0-9-]{36}$/;
const HASH = /^[a-f0-9]{64}$/;
const messages = {
  COLLECTION_RECOVERY_REVIEW_CHANGED: 'Original work changed after review. Review it again before creating a backup.',
  COLLECTION_RECOVERY_RECEIVER_OVERLAPS_TARGET: 'Keep the receiving operation directory outside the original state root.',
  COLLECTION_RECOVERY_TARGET_BINDING_CHANGED: 'The receiving target does not match the original canonical root in this backup.',
  COLLECTION_RECOVERY_TARGET_CHANGED: 'The existing target differs from this backup. Its files were left in place.',
  COLLECTION_RECOVERY_BUSY: 'The retained recovery operation is still active.',
  COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED: 'Verify this exact backup and select its original record before restoring.',
  WORKSPACE_RECOVERY_DESTINATION_NOT_EMPTY: 'The original target contains files. Open that workspace, or choose a separate receiving host with the same original path.',
  WORKSPACE_RECOVERY_PASSPHRASE_REQUIRED: 'Set the named passphrase environment variable in the server terminal, then restart this host.',
  COLLECTION_RECOVERY_SOURCE_NOT_OPEN: 'Open the original collections workspace before reviewing a new backup.',
};
function errorText(error) {
  const code = error.code ?? error.message ?? 'RECOVERY_FAILED';
  return (messages[code] ?? human(code)) + ' [' + code + ']';
}
function table(headers, rows) {
  const wrap = element('div', null, 'table-wrap'); wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', headers.join(', '));
  const t = element('table'), head = element('tr'), body = element('tbody');
  for (const h of headers) { const th = element('th', h); th.scope = 'col'; head.append(th); }
  for (const row of rows) {
    const tr = element('tr');
    for (const value of row) tr.append(append(element('td'),
      value instanceof Node ? value : element('span', value ?? '—')));
    body.append(tr);
  }
  if (!rows.length) { const td = element('td', 'No entries.'); td.colSpan = headers.length; body.append(append(element('tr'), td)); }
  t.append(append(element('thead'), head), body); wrap.append(t); return wrap;
}
function facts(entries) {
  const dl = element('dl', null, 'recovery-facts');
  for (const [label, value] of entries) dl.append(element('dt', label), element('dd', value ?? '—'));
  return dl;
}
function field(form, name, label, { value = '', placeholder = '', required = false, type = 'text' } = {}) {
  const box = element('div'), id = 'recovery-' + name, input = element('input');
  input.id = id; input.name = name; input.type = type; input.value = value;
  input.placeholder = placeholder; input.required = required; input.spellcheck = false;
  input.autocomplete = 'off'; box.append(Object.assign(element('label', label), { htmlFor: id }), input);
  form.append(box); return input;
}
function button(text, action, cls) {
  const b = element('button', text, cls); b.type = 'button';
  b.addEventListener('click', action); return b;
}
function detail(label, content, open = false) {
  const d = element('details', null, 'recovery-detail'); d.open = open;
  d.append(element('summary', label), content); return d;
}
export function createCollectionRecoveryPanel({ host, api, onOpen, onBusy = () => {} }) {
  let connected = false, visible = false, status = null, busy = false, generation = 0;
  let selectedId = null, selected = null, selectedGeneration = 0, offset = 0, historyGeneration = 0;
  let reviewed = null, pending = null, downloading = null, polling = false, storeKey = '';
  const title = element('h2', 'Backup and receiving');
  const note = element('p', '', 'notice'); note.hidden = true; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const sourceArea = element('section', null, 'panel'), sourceForm = element('form', null, 'recovery-form');
  const sourceRoot = field(sourceForm, 'stateRoot', 'Original private state root', { required: true, placeholder: '/absolute/private/customer-state' });
  const output = field(sourceForm, 'output', 'New encrypted backup directory', { required: true, placeholder: '/absolute/private/handoffs/october-backup' });
  const pass = field(sourceForm, 'passEnv', 'Passphrase environment variable', { value: 'SF88_BACKUP_PASSPHRASE', required: true });
  const quiesced = field(sourceForm, 'quiesced', 'Other writers to this original inbox and its operator workspaces are stopped', { type: 'checkbox' });
  const reviewButton = button('Review original workspace', () => guarded(async () => {
    if (!sourceRoot.reportValidity()) return;
    const path = sourceRoot.value, result = await api('/api/recovery/review', { stateRoot: path });
    if (sourceRoot.value !== path) { reviewed = null; say('The root changed while being reviewed. Review the selected root again.'); return; }
    reviewed = result.profile; renderReview(); controls(); say('Review the actual source, saved attempts and runtime requirements, then create its encrypted backup.');
  }));
  const createButton = button('Create encrypted backup', () => guarded(async () => {
    if (!sourceForm.reportValidity() || !reviewed) return;
    if (!quiesced.checked) { say('Stop other writers to the same inbox and operator workspaces, then acknowledge their state.', true); return; }
    await start('SNAPSHOT', { stateRoot: reviewed.stateRoot, output: output.value,
      passEnv: pass.value, expectedReviewSha256: reviewed.reviewSha256, quiesced: true });
  }), 'primary');
  const reviewHost = element('div');
  sourceForm.append(append(element('div', null, 'form-actions'), reviewButton, createButton));
  sourceForm.addEventListener('submit', e => { e.preventDefault(); reviewButton.click(); });
  sourceRoot.addEventListener('input', () => { reviewed = null; renderReview(); controls(); });
  sourceArea.append(element('h3', 'Create a complete operating backup'),
    element('p', 'The backup includes the original collection store, inbox, configured operator ledgers and keys, retained request inputs, attempts, evidence and saved delivery files. Signing wallet values stay in their existing environment.', 'muted'),
    sourceForm, reviewHost);

  const receiving = element('section', null, 'panel'), receivingForm = element('form', null, 'recovery-form');
  const bundle = field(receivingForm, 'bundle', 'Retained encrypted backup directory', { required: true, placeholder: '/absolute/private/handoffs/october-backup' });
  const receivingPass = field(receivingForm, 'receivingPassEnv', 'Passphrase environment variable', { value: 'SF88_BACKUP_PASSPHRASE', required: true });
  const python = field(receivingForm, 'python', 'Existing Python 3.11+ executable', { value: '/usr/bin/python3', required: true });
  const verifyButton = button('Verify and inspect backup', () => guarded(async () => {
    if (!receivingForm.reportValidity()) return;
    await start('VERIFY', { bundle: bundle.value, passEnv: receivingPass.value, python: python.value });
  }), 'primary');
  receivingForm.append(append(element('div', null, 'form-actions'), verifyButton));
  receivingForm.addEventListener('submit', e => { e.preventDefault(); verifyButton.click(); });
  receiving.append(element('h3', 'Receive an existing backup'),
    element('p', 'Verification decrypts to private temporary storage and checks the original files and ledger bindings. Restore uses the exact original absolute state root. Existing populated targets are preserved.', 'muted'),
    receivingForm);

  const activeArea = element('section', null, 'panel'), selectedBody = element('div'), selectedActions = element('div', null, 'form-actions');
  const cancelButton = button('Cancel recovery operation', () => guarded(async () => {
    const id = selectedId; await api('/api/recovery/' + id + '/cancel', {}); await loadSelected(id);
  }));
  const resumeButton = button('Resume retained operation', () => guarded(async () => {
    const id = selectedId; const view = await api('/api/recovery/' + id + '/resume', {});
    if (selectedId === id) accept(view); await loadHistory();
  }));
  const restoreButton = button('Restore original state', () => guarded(async () => {
    const item = selected, result = item?.result;
    if (!result?.application?.profile) return;
    if (!confirm('Restore the verified original state at ' + result.application.profile.stateRoot + '? The receiving operation will not execute any saved request.')) return;
    await start('RESTORE', { bundle: result.bundle, passEnv: item.options.passEnv,
      python: item.options.python ?? python.value, expected: result.recordSha256,
      expectedStateRoot: result.application.profile.stateRoot });
  }), 'primary');
  const openButton = button('Open restored collections', () => guarded(async () => {
    const id = selectedId; const result = await api('/api/recovery/' + id + '/open', {});
    await onOpen(result); say('Original collection and attempt history opened. No request was started.');
  }), 'primary');
  const downloadButton = button('Save encrypted backup files', () => guarded(downloadBundle));
  const refreshSelected = button('Refresh operation', () => guarded(async () => {
    if (selectedId) await loadSelected(selectedId); await loadHistory();
  }));
  const cancelDownload = button('Cancel file receiving', () => downloading?.abort());
  selectedActions.append(cancelButton, resumeButton, restoreButton, openButton, downloadButton, refreshSelected, cancelDownload);
  activeArea.append(element('h3', 'Retained operation'), selectedBody, selectedActions);

  const uncertain = element('section', null, 'panel'), pendingText = element('p', null, 'mono');
  const recoverReply = button('Recover the same request', () => guarded(async () => {
    const chosen = pending; if (!chosen) return;
    let view;
    try { view = await api('/api/recovery/' + chosen.requestId); }
    catch (error) { if (error.code !== 'COLLECTION_RECOVERY_OPERATION_NOT_FOUND') throw error;
      view = await api('/api/recovery/start', { requestId: chosen.requestId, kind: chosen.kind, options: chosen.options }); }
    forgetPending(); selectedId = view.requestId; selectedGeneration += 1; accept(view); await loadHistory();
  }), 'primary');
  const discardRejected = button('Clear rejected selection', () => guarded(async () => {
    if (!pending?.responseError) return;
    try {
      const view = await api('/api/recovery/' + pending.requestId);
      forgetPending(); selectedId = view.requestId; selectedGeneration += 1; accept(view); return;
    } catch (error) {
      if (error.code !== 'COLLECTION_RECOVERY_OPERATION_NOT_FOUND') throw error;
      forgetPending(); selectedId = null; selected = null; renderSelected();
      say('The completed error reply has no retained operation. Correct the selection and prepare a new request.');
    }
  }));
  uncertain.append(element('h3', 'Request awaiting its original reply'), pendingText,
    element('p', 'The exact request ID and selection remain saved in this tab. Recover its result before preparing another operation.'), recoverReply, discardRejected);

  const historyArea = element('section', null, 'panel'), historyBody = element('div'), pageLabel = element('span', '', 'muted');
  const previous = button('Previous', () => guarded(async () => { offset = Math.max(0, offset - 50); await loadHistory(); }));
  const next = button('More', () => guarded(async () => { offset += 50; await loadHistory(); }));
  historyArea.append(append(element('div', null, 'section-heading'), element('h3', 'Recovery history'),
    button('Refresh history', () => guarded(loadHistory))), historyBody,
    append(element('div', null, 'form-actions'), previous, next, pageLabel));
  host.append(append(element('section', null, 'panel'), title,
    element('p', 'A working handoff retains operating state as well as the results index. Review, capture, verify and reopen it here. The original request runner remains an explicit separate action.')),
    note, uncertain, sourceArea, receiving, activeArea, historyArea);
  function say(text, error = false) { note.textContent = text; note.hidden = !text; note.dataset.kind = error ? 'error' : 'status'; }
  function rememberPending(value) { pending = value; try { sessionStorage.setItem(storeKey, JSON.stringify(value)); } catch {} controls(); }
  function forgetPending() { pending = null; try { sessionStorage.removeItem(storeKey); } catch {} controls(); }
  async function guarded(fn) {
    if (!connected || busy) return;
    busy = true; controls();
    try { await fn(); } catch (error) { if (connected) say(errorText(error), true); }
    finally { busy = false; controls(); }
  }
  function controls() {
    sourceArea.hidden = !status?.directory;
    const live = LIVE.has(selected?.state), isComplete = selected?.state === 'COMPLETED';
    for (const b of [reviewButton, createButton, verifyButton, resumeButton, restoreButton, openButton, downloadButton, previous, next, recoverReply])
      b.disabled = !connected || busy;
    createButton.disabled ||= !reviewed || Boolean(pending);
    verifyButton.disabled ||= Boolean(pending);
    cancelButton.hidden = !live; cancelButton.disabled = !connected || busy || selected?.state === 'CANCELLING';
    resumeButton.hidden = selected?.state !== 'UNFINISHED';
    restoreButton.hidden = !isComplete || selected?.kind !== 'VERIFY'
      || !['ABSENT', 'EMPTY'].includes(selected?.result?.target?.state);
    openButton.hidden = !isComplete || !selected?.result?.reopened
      || Boolean(selected?.result?.reopenError) || Boolean(status?.directory);
    downloadButton.hidden = !isComplete || !selected?.result?.bundle;
    cancelDownload.hidden = !downloading; cancelDownload.disabled = !downloading;
    activeArea.hidden = !selected;
    uncertain.hidden = !pending;
    discardRejected.hidden = !pending?.responseError; discardRejected.disabled = busy || !connected;
    pendingText.textContent = pending ? pending.kind + ' · ' + pending.requestId : '';
    previous.disabled ||= offset === 0;
    next.disabled ||= !historyArea.dataset.hasMore || historyArea.dataset.hasMore === 'false';
    onBusy(Boolean(busy || live || pending));
  }
  function renderProfile(p) {
    return append(element('div'),
      facts([['Original state root', p.stateRoot], ['Collections store', p.directory], ['Original inbox', p.queueRoot],
        ['Restore mode', p.restoreMode], ['Source review SHA-256', p.reviewSha256]]),
      detail('Collections · ' + p.collections.length,
        table(['Collection', 'Requests', 'State', 'Manifest SHA-256'], p.collections.map(x => [x.name || x.id, x.itemCount, human(x.state), x.manifestSha256])), true),
      detail('Original queued work and attempts · ' + p.jobs.length,
        table(['Request', 'State', 'Attempt', 'Operator'], p.jobs.map(x => [x.intentId, human(x.state), x.attemptId, x.operator])), true),
      detail('Original operator workspaces', table(['Directory'], p.operators.map(x => [x]))),
      detail('Saved and missing deliveries · ' + p.deliveries.length,
        table(['Request', 'File', 'Availability', 'Bytes', 'SHA-256'], p.deliveries.map(x => [x.intentId, x.path,
          x.available ? 'Retained' : 'Not present', x.bytes, x.sha256])), true),
      detail('Exact retained inputs · ' + p.retainedInputs.length,
        table(['Kind', 'Original path', 'Bytes', 'SHA-256'], p.retainedInputs.map(x => [x.kind, x.path, x.bytes, x.sha256]))),
      detail('Additional original file selections', table(['Original path'], (p.selected ?? []).map(x => [typeof x === 'string' ? x : JSON.stringify(x)]))),
      detail('Missing optional files', table(['Original reference'], (p.missing ?? []).map(x => [typeof x === 'string' ? x : JSON.stringify(x)]))),
      detail('Runtime and environment requirements', element('pre', JSON.stringify(p.runtime, null, 2))));
  }
  function renderReview() { reviewHost.replaceChildren(...(reviewed ? [renderProfile(reviewed)] : [])); }
  function accept(view) { selected = view; renderSelected(); controls(); }
  function renderSelected() {
    if (!selected) { selectedBody.replaceChildren(); return; }
    const r = selected.result;
    const nodes = [facts([['Operation', selected.requestId], ['Action', selected.kind], ['State', human(selected.state)],
      ['Requested', selected.createdAt], ['Completed', selected.completedAt]])];
    if (selected.error) nodes.push(element('p', errorText(selected.error), 'notice'));
    if (selected.persistenceError) nodes.push(element('p', 'Result journal write needs recovery: ' + selected.persistenceError, 'notice'));
    if (selected.state === 'UNFINISHED') nodes.push(element('p', 'The original request has no completed result. Resume this same ID to reconcile any completed publication before continuing.'));
    if (r) {
      nodes.push(facts([['Backup directory', r.bundle], ['Original record SHA-256', r.recordSha256],
        ['Original target', r.target?.path], ['Target at operation completion', human(r.target?.state)],
        ['Outcome', human(r.status)], ['Requests executed by receiving', '0']]));
      if (r.archiveWarning) nodes.push(element('p', 'The published original state is retained, but this backup path changed: ' + r.archiveWarning, 'notice'));
      if (r.reopenError) nodes.push(element('p', 'Files were restored; original reopen needs attention: ' + r.reopenError, 'notice'));
      if (r.application?.profile) nodes.push(renderProfile(r.application.profile));
      if (r.reopened) nodes.push(detail('Reopened original state', facts([['Requests', r.reopened.requests],
        ['Unresolved original attempts', r.reopened.unresolvedAttempts?.length ?? 0],
        ['Original command', r.reopened.argv?.join(' ')]]), true));
    }
    if (selected.progress?.length) nodes.push(detail('Native progress',
      table(['Observed', 'Phase / event', 'Detail'], selected.progress.map(x =>
        [x.observedAt, x.phase ?? x.state ?? x.type ?? 'Progress', JSON.stringify(x)])), true));
    selectedBody.replaceChildren(...nodes);
  }
  async function loadSelected(id) {
    const current = ++selectedGeneration, binding = generation;
    selectedId = id; const value = await api('/api/recovery/' + id);
    if (binding !== generation || !connected || current !== selectedGeneration || selectedId !== id) return;
    accept(value);
  }
  async function loadHistory() {
    if (!connected) return;
    const binding = generation, current = ++historyGeneration, page = offset;
    const value = await api('/api/recovery/history', { offset: page, limit: 50 });
    if (!connected || binding !== generation || current !== historyGeneration || offset !== page) return;
    historyArea.dataset.hasMore = String(value.hasMore);
    pageLabel.textContent = value.total ? (page + 1) + '–' + (page + value.rows.length) + ' of ' + value.total : 'No retained operations.';
    historyBody.replaceChildren(table(['Operation', 'Action', 'State', 'Requested', 'Backup / target'],
      value.rows.map(row => [button(row.requestId, () => guarded(() => loadSelected(row.requestId))), row.kind,
        human(row.state), row.createdAt, row.options.output ?? row.options.bundle])));
    if (!selectedId && value.activeRequestId) await loadSelected(value.activeRequestId);
    controls();
  }
  async function start(kind, options) {
    if (pending) throw Object.assign(new Error('COLLECTION_RECOVERY_PENDING_REPLY'), { code: 'COLLECTION_RECOVERY_PENDING_REPLY' });
    const request = { requestId: crypto.randomUUID(), kind, options };
    rememberPending(request); selectedId = request.requestId; selectedGeneration += 1;
    try {
      const view = await api('/api/recovery/start', request);
      if (!connected) return;
      forgetPending(); accept(view); await loadHistory();
      say('Retained ' + kind.toLowerCase() + ' operation started. Its exact ID stays in recovery history.');
    } catch (error) {
      // A completed provider error can be cleared only after its original ID is confirmed absent.
      if (typeof error.code === 'string' && connected) rememberPending({ ...request, responseError: error.code });
      say('Recover the original request reply: ' + errorText(error), true);
    }
  }
  async function descriptors() {
    const id = selectedId, binding = generation;
    const result = await api('/api/recovery/' + id + '/files', {});
    if (!connected || binding !== generation || id !== selectedId) throw new Error('PRIVATE_SESSION_REQUIRED');
    for (const file of result.files) {
      if (!/^(manifest\.json|objects\/[0-9]{6}\.gcm)$/.test(file.relativePath)
        || !HASH.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
        throw new Error('COLLECTION_RECOVERY_BUNDLE_INVALID');
    }
    return result;
  }
  async function downloadBundle() {
    if (!window.showDirectoryPicker) {
      const result = await descriptors();
      const list = element('div', null, 'export-files');
      for (const file of result.files) list.append(button(file.relativePath + ' · ' + file.bytes + ' bytes',
        () => guarded(async () => {
          if (file.bytes > 32 * 1024 * 1024) throw new Error('LARGE_FILE_USE_HOST_DIRECTORY_OR_DIRECTORY_PICKER');
          const bytes = await api(file.downloadUrl, undefined, { blob: true });
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer()))]
            .map(x => x.toString(16).padStart(2, '0')).join('');
          if (!connected) throw new Error('PRIVATE_SESSION_REQUIRED');
          if (bytes.size !== file.bytes || digest !== file.sha256) throw new Error('COLLECTION_DOWNLOAD_CHANGED');
          const url = URL.createObjectURL(bytes), link = element('a'); link.href = url; link.download = file.name;
          document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        })));
      selectedBody.append(detail('Encrypted files: retain objects/ as a subdirectory', list, true));
      say('Save manifest.json at the backup root and each numbered file under objects/. The original complete directory is also available on this host. Verify the assembled backup before restore.');
      return;
    }
    // The user's directory picker runs before any asynchronous network call.
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    const result = await descriptors(), name = 'collection-backup-' + result.requestId;
    let exists = false;
    try { await directory.getDirectoryHandle(name); exists = true; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (exists) throw new Error('RECEIVING_DIRECTORY_ALREADY_EXISTS');
    const target = await directory.getDirectoryHandle(name, { create: true }), controller = new AbortController();
    downloading = controller; controls();
    let completed = 0;
    try {
      for (const file of result.files) {
        if (controller.signal.aborted || !connected) throw new Error('COLLECTION_DOWNLOAD_CANCELLED');
        const parts = file.relativePath.split('/'); let parent = target;
        if (parts.length === 2) parent = await target.getDirectoryHandle(parts[0], { create: true });
        const output = await parent.getFileHandle(parts.at(-1), { create: true }), writable = await output.createWritable();
        try {
          const response = await api(file.downloadUrl, undefined, { stream: true, signal: controller.signal });
          if (response.headers.get('x-content-sha256') !== file.sha256
            || response.headers.get('content-length') !== String(file.bytes)) throw new Error('COLLECTION_DOWNLOAD_CHANGED');
          let bytes = 0;
          const reader = response.body.getReader();
          try {
            for (;;) { const part = await reader.read(); if (part.done) break;
              bytes += part.value.byteLength; if (bytes > file.bytes) throw new Error('COLLECTION_DOWNLOAD_CHANGED');
              await writable.write(part.value); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          if (bytes !== file.bytes || controller.signal.aborted) throw new Error('COLLECTION_DOWNLOAD_CHANGED');
          await writable.close(); completed += 1;
          say('Receiving encrypted files: ' + completed + ' of ' + result.files.length + '.');
        } catch (error) { await writable.abort().catch(() => {}); throw error; }
      }
      say('Encrypted backup files received in ' + name + '. Verify that retained directory through the native receiver before restore.');
    } catch (error) {
      say(errorText(error) + ' The partial folder ' + name + ' remains visible with ' + completed + ' completed files.', true);
    } finally { downloading = null; controls(); }
  }
  return {
    async connect(value) {
      const changed = status?.recoveryDirectory !== value.recoveryDirectory;
      generation += 1; status = value; connected = true;
      storeKey = 'starforge.collection-recovery.' + location.origin + '.' + value.recoveryDirectory;
      if (changed) { selectedId = null; selected = null; reviewed = null; offset = 0; pending = null; }
      try {
        const saved = JSON.parse(sessionStorage.getItem(storeKey) ?? 'null');
        if (saved && ID.test(saved.requestId ?? '') && ['SNAPSHOT','VERIFY','RESTORE'].includes(saved.kind)) pending = saved;
      } catch {}
      renderReview(); renderSelected(); controls(); await loadHistory();
    },
    disconnect() { connected = false; generation += 1; downloading?.abort(); controls(); },
    setVisible(value) { visible = value; if (visible && connected) void guarded(loadHistory); },
    async refresh() {
      if (!connected || busy || polling) return;
      polling = true;
      try {
        const id = selectedId;
        if (id && LIVE.has(selected?.state)) {
          await loadSelected(id);
          if (!LIVE.has(selected?.state)) await loadHistory();
        }
      } catch (error) { if (connected) say(errorText(error), true); }
      finally { polling = false; }
    },
  };
}
