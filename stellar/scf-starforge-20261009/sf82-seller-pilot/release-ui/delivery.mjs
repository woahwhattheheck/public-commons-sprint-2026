// MIT. Direct release-store settlement controls and original receiving handover.
const $ = id => document.getElementById(id);
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/, HEX = /^[a-f0-9]{64}$/;
const BUFFER_LIMIT = 128 * 1024 * 1024;
const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = String(text); return value; };
const bytes = value => Number(value ?? 0).toLocaleString() + ' B';
const date = value => value ? new Date(value).toLocaleString() : '—';
const query = value => new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined)).toString();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function save(blob, filename) {
  const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function pairs(target, entries) {
  target.replaceChildren();
  for (const [name, value] of entries) target.append(node('dt', name), node('dd', value ?? '—'));
}
function row(values) {
  const result = node('tr');
  for (const value of values) { const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); result.append(cell); }
  return result;
}
export function bindDeliveryControls({ request, getSnapshot, isBusy, setBusy }) {
  let stopped = false, store = null, epoch = 0, state = null, listing = null, selected = null;
  let after, reading, mutation, downloading, downloadDone, closePromise, working = false;
  let pending = {}, observed = null;
  const draftKey = () => 'stellar-forge.release-delivery.v1/' + store;
  const transferId = () => $('delivery-transfer-id').value.trim();
  const current = ticket => !stopped && ticket === epoch && getSnapshot()?.root === store;
  function message(text = '', error = false) {
    if (stopped) return;
    $('delivery-notice').textContent = text; $('delivery-notice').classList.toggle('error', error);
  }
  function draft() { return { schema: 'stellar-forge.release-delivery-draft.v1', releaseStore: store,
    transferId: transferId(), pending }; }
  function remember() {
    if (!store) return;
    try { sessionStorage.setItem(draftKey(), JSON.stringify(draft())); }
    catch { message('The draft remains open. Download it to retain these capture requests across a browser restart.', true); }
  }
  function acceptDraft(value, { merge = false } = {}) {
    if (!value || value.schema !== 'stellar-forge.release-delivery-draft.v1' || value.releaseStore !== store ||
        typeof value.transferId !== 'string' || value.transferId && !ID.test(value.transferId) ||
        !value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending))
      throw new Error('Open a delivery draft for this release store.');
    for (const [key, body] of Object.entries(value.pending)) {
      if (!ID.test(key) || !body || Object.keys(body).some(name => !['id', 'expectedSourceFingerprint'].includes(name)) ||
          body.id !== key || !HEX.test(body.expectedSourceFingerprint ?? '') ||
          merge && pending[key] && pending[key].expectedSourceFingerprint !== body.expectedSourceFingerprint)
        throw new Error('A saved capture ID has a different original request. Keep both drafts and inspect that retained transfer.');
    }
    pending = merge ? { ...pending, ...value.pending } : { ...value.pending };
    $('delivery-transfer-id').value = value.transferId;
  }
  function context() {
    const next = getSnapshot()?.root;
    if (!next || next === store) return;
    remember(); reading?.abort(); downloading?.abort(new Error('DELIVERY_SCOPE_CHANGED'));
    epoch++; store = next; state = null; listing = null; selected = null; after = undefined; observed = null; pending = {};
    $('delivery-transfer-id').value = '';
    try {
      const saved = sessionStorage.getItem(draftKey());
      if (saved) acceptDraft(JSON.parse(saved));
    } catch (error) { message(error.message, true); }
    renderReview(); render();
  }
  function buttons(blocked = isBusy()) {
    if (stopped) return;
    const unavailable = blocked || working || !store;
    $('delivery-refresh').disabled = unavailable;
    $('delivery-transfer-id').disabled = unavailable;
    $('delivery-inspect').disabled = unavailable || !ID.test(transferId());
    $('delivery-create-transfer').disabled = unavailable || !ID.test(transferId()) ||
      !pending[transferId()] && !HEX.test(state?.destinations?.source?.fingerprint ?? '');
    $('delivery-create-transfer').textContent = pending[transferId()] ? 'Resume saved capture' : 'Capture reviewed source';
    $('delivery-first').disabled = unavailable || after === undefined;
    $('delivery-next').disabled = unavailable || !listing?.next;
    $('delivery-drain').disabled = unavailable || !state?.initialized || !state.destinations?.destinations?.length;
    $('delivery-start').disabled = unavailable || !state?.initialized ||
      state.destinations?.worker?.activeHere || state.destinations?.worker?.owner?.active;
    $('delivery-stop').disabled = unavailable || !state?.initialized ||
      !(state.destinations?.worker?.activeHere || state.destinations?.worker?.owner?.active);
    $('delivery-download').disabled = unavailable || !selected;
    $('delivery-download-stop').hidden = !downloading;
    $('delivery-download-stop').disabled = !downloading;
    $('delivery-save-draft').disabled = !store || working;
    $('delivery-open-draft').disabled = unavailable;
    for (const button of $('delivery-transfer-list').querySelectorAll('button')) button.disabled = unavailable;
    $('delivery-pending-ids').replaceChildren(...Object.keys(pending).sort().map(id => { const option = node('option'); option.value = id; return option; }));
    $('delivery-pending').textContent = pending[transferId()]
      ? 'This ID retains the exact source fingerprint sent before its response was confirmed: ' + pending[transferId()].expectedSourceFingerprint
      : Object.keys(pending).length ? Object.keys(pending).length + ' other capture request(s) remain in the saved draft. Select their IDs to inspect or resume.' : '';
  }
  function render() {
    const producer = state?.producer;
    $('delivery-state').textContent = state
      ? state.initialized ? 'Original settlement delivery · observed ' + date(observed) : 'Start this seller once to establish its original delivery source.'
      : 'Refresh to read this store’s original producer and destination state.';
    pairs($('delivery-producer'), [
      ['Release store', store], ['Producer', producer?.owned ? 'Owned by this console' : producer?.phase ?? 'Not initialized'],
      ['Payment mode', producer?.mode], ['Retained release', producer?.releaseId],
      ['Original instance', producer?.instanceId], ['Original source receipts', state?.destinations?.source?.events],
      ['Reviewed source fingerprint', state?.destinations?.source?.fingerprint],
      ['Journal warnings', producer?.journalWarnings ?? 0],
      ['Last journal warning', producer?.lastWriteFailure ? date(producer.lastWriteFailure.at) + ' · ' + producer.lastWriteFailure.code : '—'],
    ]);
    const controls = $('delivery-controls'); controls.hidden = !state?.workspacePath;
    if (state?.workspacePath) controls.href = state.workspacePath;
    const destinations = $('delivery-destinations'); destinations.replaceChildren();
    for (const entry of state?.destinations?.destinations ?? []) {
      const title = node('div'); title.append(node('strong', entry.id), node('div', entry.label ?? ''));
      const endpoint = node('div'); endpoint.append(node('div', entry.url ?? entry.destination?.url ?? ''),
        node('div', 'Signing reference: ' + (entry.secretEnv ?? entry.destination?.secretEnv ?? '—')));
      destinations.append(row([title, endpoint, entry.paused ? 'Paused' : 'Enabled',
        entry.cursor?.count ?? '—', entry.error ?? ('Pending ' + (entry.outbox?.pending ?? 0) + ' · delivered ' + (entry.outbox?.delivered ?? 0) + ' · exhausted ' + (entry.outbox?.exhausted ?? 0)),
        entry.revision ?? entry.destination?.revision ?? '—']));
    }
    if (!destinations.childNodes.length) { const empty = node('td', 'Open delivery controls to enroll a receiver with its HTTPS endpoint and signing environment reference.'); empty.colSpan = 6; const r = node('tr'); r.append(empty); destinations.append(r); }
    const transfers = $('delivery-transfer-list'); transfers.replaceChildren();
    for (const entry of listing?.transfers ?? []) {
      const inspect = node('button', 'Inspect'); inspect.addEventListener('click', () => inspectTransfer(entry.id, entry.fingerprint));
      transfers.append(row([entry.id, date(entry.createdAt), entry.source?.events,
        entry.destinations?.length, entry.fingerprint, inspect]));
    }
    for (const entry of listing?.errors ?? []) transfers.append(row([entry.id, 'Read failed', '—', '—', entry.code, 'Inspect the original retained directory']));
    if (!transfers.childNodes.length) { const cell = node('td', after ? 'No further retained exchanges.' : 'No retained exchanges on this page.'); cell.colSpan = 6; const r = node('tr'); r.append(cell); transfers.append(r); }
    buttons();
  }
  function renderReview() {
    $('delivery-review').hidden = !selected;
    if (!selected) return;
    $('delivery-review-title').textContent = selected.id + ' · original destination exchange';
    pairs($('delivery-transfer-identity'), [
      ['Exchange fingerprint', selected.fingerprint], ['Source fingerprint', selected.source?.fingerprint],
      ['Original source receipts', selected.source?.events], ['Created', date(selected.createdAt)],
      ['Native files', selected.files?.length], ['Original file bytes', bytes(selected.totalBytes)],
    ]);
    const target = $('delivery-files'); target.replaceChildren();
    for (const file of selected.files ?? []) target.append(row([file.name, bytes(file.bytes), file.sha256]));
    const folder = selected.id + '-delivery';
    $('delivery-receiving-command').textContent =
      'mkdir -m 700 ' + quote(folder) + '\n' +
      'tar -xzf ' + quote(selected.id + '-delivery.tar.gz') + ' -C ' + quote(folder) + '\n' +
      'starforge delivery-destinations inspect --workspace ' + quote(folder) + '\n' +
      'starforge delivery-destinations receive --from ' + quote(folder) +
      ' --workspace ' + quote(folder + '-received') + ' --fingerprint ' + quote(selected.fingerprint);
    $('delivery-native-command').textContent = 'starforge release-delivery download --store ' + quote(store) +
      ' --id ' + quote(selected.id) + ' --fingerprint ' + quote(selected.fingerprint) +
      ' --directory ' + quote(folder + '-download');
    buttons();
  }
  async function refreshInside(ticket) {
    reading?.abort(); const controller = new AbortController(); reading = controller;
    const results = await Promise.allSettled([
      request('/api/delivery/status', undefined, { signal: controller.signal }),
      request('/api/delivery/transfers?' + query({ after }), undefined, { signal: controller.signal }),
    ]);
    if (!current(ticket) || controller.signal.aborted) return;
    state = results[0].status === 'fulfilled' ? results[0].value : null;
    listing = results[1].status === 'fulfilled' ? results[1].value : null;
    observed = state ? new Date().toISOString() : null;
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
    render(); if (errors.length) message(errors.join(' '), true);
    if (reading === controller) reading = null;
  }
  async function refresh() {
    if (stopped || working) return;
    context(); if (!store) return;
    const ticket = ++epoch; await refreshInside(ticket);
  }
  function perform(work) {
    if (stopped || working || isBusy() || !store) return;
    reading?.abort(); reading = null; const ticket = ++epoch;
    working = true; setBusy(true); buttons();
    const task = (async () => {
      try { await work(ticket); }
      catch (error) { if (current(ticket)) message(error.message, true); }
      finally { working = false; if (!stopped) { setBusy(false); buttons(); } }
    })();
    mutation = task; task.finally(() => { if (mutation === task) mutation = null; }).catch(() => {});
    return task;
  }
  function inspectTransfer(id = transferId(), expectedFingerprint) {
    if (!ID.test(id)) return;
    return perform(async ticket => {
      const value = await request('/api/delivery/manifest?' + query({ id, expectedFingerprint }));
      if (!current(ticket)) return;
      selected = value; $('delivery-transfer-id').value = id;
      if (pending[id]?.expectedSourceFingerprint === value.source?.fingerprint) delete pending[id];
      remember(); renderReview(); message('The original retained exchange and all native file identities are available.');
    });
  }
  function capture() {
    const id = transferId(); if (!ID.test(id)) return;
    const body = pending[id] ?? { id, expectedSourceFingerprint: state?.destinations?.source?.fingerprint };
    if (!HEX.test(body.expectedSourceFingerprint ?? '')) return message('Refresh and review the original source before capturing it.', true);
    return perform(async ticket => {
      pending[id] = { ...body }; remember();
      message('Retaining the exact reviewed source and original destination histories…');
      let result;
      try { result = await request('/api/delivery/transfer', body); }
      catch (error) {
        if (current(ticket)) { await refreshInside(ticket); message('The exact capture request remains saved. Inspect this ID or resume it. ' + error.message, true); }
        return;
      }
      if (!current(ticket)) return;
      if (result.id !== id || result.source?.fingerprint !== body.expectedSourceFingerprint)
        throw new Error('The returned exchange differs from this saved source request. Inspect the retained ID.');
      delete pending[id]; remember();
      selected = await request('/api/delivery/manifest?' + query({ id, expectedFingerprint: result.fingerprint }));
      if (!current(ticket)) return;
      renderReview(); await refreshInside(ticket);
      if (current(ticket)) message(result.retained ? 'Reopened the original saved capture.' : 'The complete original exchange is retained and ready for receiving.');
    });
  }
  function control(action) {
    return perform(async ticket => {
      const result = await request('/api/delivery/control', { action, input: {} });
      if (!current(ticket)) return;
      await refreshInside(ticket);
      if (current(ticket)) message(action === 'start' ? 'The original delivery worker started.' : action === 'stop'
        ? 'The original worker stop was recorded.' : 'Original delivery cycle finished. Review each destination outcome.');
      return result;
    });
  }
  async function download() {
    if (stopped || working || isBusy() || !selected) return;
    const capture = selected, ticket = ++epoch;
    if (typeof window.showSaveFilePicker !== 'function' && capture.totalBytes > BUFFER_LIMIT)
      return message('Use the displayed resumable CLI download for this exchange size.', true);
    const controller = new AbortController(); downloading = controller; working = true; setBusy(true); buttons();
    const task = (async () => {
      let writer, stream, completed = false;
      try {
        if (typeof window.showSaveFilePicker === 'function') {
          const handle = await window.showSaveFilePicker({ suggestedName: capture.id + '-delivery.tar.gz',
            types: [{ description: 'Original delivery exchange', accept: { 'application/gzip': ['.gz'] } }] });
          writer = await handle.createWritable();
        }
        controller.signal.throwIfAborted();
        const response = await request('/api/delivery/download?' + query({ id: capture.id, expectedFingerprint: capture.fingerprint }),
          undefined, { raw: true, signal: controller.signal });
        if (!response.headers.get('content-type')?.startsWith('application/gzip')) throw new Error('The original archive response is invalid.');
        stream = response.body.getReader(); const chunks = []; let received = 0;
        while (true) {
          controller.signal.throwIfAborted(); const { value, done } = await stream.read(); if (done) break;
          received += value.length;
          if (writer) await writer.write(value);
          else { if (received > BUFFER_LIMIT) throw new Error('Use the resumable native download for this exchange size.'); chunks.push(value); }
          if (current(ticket)) $('delivery-download-progress').textContent = 'Received ' + bytes(received) + ' of the compressed exchange.';
        }
        if (writer) await writer.close();
        else save(new Blob(chunks, { type: 'application/gzip' }), capture.id + '-delivery.tar.gz');
        completed = true;
        if (current(ticket)) message('The original exchange was saved. Use the displayed original receiving commands.');
      } catch (error) {
        if (current(ticket)) message(controller.signal.aborted || error.name === 'AbortError'
          ? 'Download stopped. This same retained exchange remains available.' : error.message, !controller.signal.aborted);
      } finally {
        if (!completed) { await stream?.cancel().catch(() => {}); await writer?.abort().catch(() => {}); }
        downloading = null; working = false;
        if (!stopped) { setBusy(false); buttons(); }
      }
    })();
    downloadDone = task; try { await task; } finally { if (downloadDone === task) downloadDone = null; }
  }
  $('delivery-transfer-id').addEventListener('input', () => { remember(); buttons(); });
  $('delivery-refresh').addEventListener('click', () => { void refresh(); });
  $('delivery-first').addEventListener('click', () => { after = undefined; void refresh(); });
  $('delivery-next').addEventListener('click', () => { if (listing?.next) { after = listing.next; void refresh(); } });
  $('delivery-transfer-form').addEventListener('submit', event => { event.preventDefault(); void capture(); });
  $('delivery-inspect').addEventListener('click', () => { void inspectTransfer(); });
  for (const action of ['drain', 'start', 'stop']) $('delivery-' + action).addEventListener('click', () => { void control(action); });
  $('delivery-download').addEventListener('click', () => { void download(); });
  $('delivery-download-stop').addEventListener('click', () => downloading?.abort(new Error('DOWNLOAD_STOPPED')));
  $('delivery-save-draft').addEventListener('click', () => save(new Blob([JSON.stringify(draft(), null, 2) + '\n'], { type: 'application/json' }), 'delivery-draft.json'));
  $('delivery-open-draft').addEventListener('click', () => $('delivery-draft-file').click());
  $('delivery-draft-file').addEventListener('change', event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || file.size > 1048576) return message('Choose a delivery draft up to 1 MiB.', true);
    void perform(async ticket => {
      const value = JSON.parse(await file.text());
      if (!current(ticket)) return;
      acceptDraft(value, { merge: true }); remember(); buttons(); message('The saved capture requests are restored for this release store.');
    });
  });
  return { refresh, buttons, close() {
    if (closePromise) return closePromise;
    remember(); stopped = true; epoch++; reading?.abort(); downloading?.abort(new Error('DELIVERY_CLOSED'));
    closePromise = Promise.allSettled([mutation, downloadDone].filter(Boolean));
    return closePromise;
  } };
}
