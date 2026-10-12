// MIT. Managed settlement delivery and original SF98 receiving.
const $ = id => document.getElementById(id);
const base = 'releases/delivery';
const HEX = /^[a-f0-9]{64}$/;
const TRANSFER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BUFFER_LIMIT = 128 * 1024 * 1024;
const explanations = {
  SF98_DELIVERY_NOT_INITIALIZED: 'Start this original merchant once to establish its retained delivery source.',
  SF98_DELIVERY_SOURCE_CHANGED: 'The original producer source differs from this store’s retained delivery binding. Open its original producer and delivery history.',
  FLEET_DELIVERY_SOURCE_CHANGED: 'New original receipts arrived after the displayed source. Refresh and inspect the retained transfers before capturing the current source.',
  FLEET_DELIVERY_TRANSFER_CHANGED: 'This transfer ID identifies a different retained capture. Inspect it, or choose a new ID for the current source.',
  FLEET_DELIVERY_SOURCE_SHARED_BETWEEN_SLOTS: 'Two release stores select the same original source journal. Use each store’s retained producer binding.',
  SF98_DELIVERY_BUSY: 'Another original delivery operation owns the destination lease. Its owner appears in destination controls.',
  WORKSPACE_OPERATION_OUTCOME_UNKNOWN: 'The response was lost. Inspect the original destination state and retained transfer ID before repeating an action.',
  WORKSPACE_SESSION_REQUIRED: 'This workspace process restarted. Reload the page to open its current session.',
};
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}
const bytes = value => Number(value).toLocaleString() + ' B';
const date = value => value ? new Date(value).toLocaleString() : '—';
function pairs(target, entries) {
  target.replaceChildren();
  for (const [name, value] of entries) target.append(node('dt', name), node('dd', value ?? '—'));
}
function cells(values) {
  const row = node('tr');
  for (const value of values) {
    const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—')));
    row.append(cell);
  }
  return row;
}
function options(select, values) {
  const previous = select.value;
  if (JSON.stringify([...select.options].map(row => [row.value, row.textContent])) !== JSON.stringify(values)) {
    select.replaceChildren(...values.map(([value, title]) => { const item = node('option', title); item.value = value; return item; }));
    if (values.some(([value]) => value === previous)) select.value = previous;
  }
}
function query(scope, extra = {}) {
  return new URLSearchParams(Object.entries({ ...scope, ...extra }).filter(([, value]) => value !== undefined)).toString();
}
function tableMessage(target, message, count) {
  target.replaceChildren(); const row = node('tr'), cell = node('td', message); cell.colSpan = count; row.append(cell); target.append(row);
}
function quote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

export function bindFleetDeliveryControls({ request, getReleases, isBusy, setBusy }) {
  let stopped = false, scopeKey = null, epoch = 0, reading = null, mutation = null, download = null;
  let working = false, state = null, transfers = null, selected = null, after, updated = null, closePromise;
  const drafts = new Map();
  const scope = () => ({ tenant: $('delivery-tenant').value, slot: $('delivery-slot').value });
  const draftKey = key => 'stellar-forge.fleet-delivery.v1/' + key;
  function notice(message, error = false) {
    if (stopped) return;
    $('delivery-notice').textContent = message; $('delivery-notice').dataset.error = String(error);
    $('delivery-notice').hidden = !message;
  }
  function remember() {
    if (!scopeKey) return;
    const value = { transferId: $('delivery-transfer-id').value };
    drafts.set(scopeKey, value);
    try { sessionStorage.setItem(draftKey(scopeKey), JSON.stringify(value)); } catch {}
  }
  function restore() {
    let value = drafts.get(scopeKey);
    if (!value) try { value = JSON.parse(sessionStorage.getItem(draftKey(scopeKey))); } catch {}
    $('delivery-transfer-id').value = typeof value?.transferId === 'string' ? value.transferId.slice(0, 64) : '';
  }
  function selectedSlot() {
    const value = scope(), tenant = getReleases()?.tenants?.find(row => row.id === value.tenant);
    return tenant?.slots.find(row => row.name === value.slot);
  }
  function renderControls() {
    if (stopped) return;
    const unavailable = !scopeKey || working || isBusy();
    $('delivery-tenant').disabled = working; $('delivery-slot').disabled = working;
    $('delivery-refresh').disabled = unavailable || Boolean(reading);
    $('delivery-first').disabled = unavailable || Boolean(reading) || after === undefined;
    $('delivery-next').disabled = unavailable || Boolean(reading) || !transfers?.next;
    $('delivery-transfer-id').disabled = working;
    $('delivery-create-transfer').disabled = unavailable || !HEX.test(state?.destinations?.source?.fingerprint ?? '');
    $('delivery-drain').disabled = unavailable || !state?.initialized || !state.destinations.destinations.length;
    $('delivery-start').disabled = unavailable || !state?.initialized || state.destinations.worker.owner.active || state.destinations.worker.activeHere;
    $('delivery-stop').disabled = unavailable || !state?.initialized ||
      !(state.destinations.worker.activeHere || state.destinations.worker.owner.active);
    $('delivery-download').disabled = unavailable || !selected;
    $('delivery-download-stop').hidden = !download;
    $('delivery-transfer-list').querySelectorAll('button').forEach(button => { button.disabled = unavailable; });
    const link = $('delivery-controls');
    link.hidden = !state?.workspacePath;
    if (state?.workspacePath) link.href = state.workspacePath;
  }
  function renderState() {
    const slot = selectedSlot(), producer = state?.producer;
    $('delivery-scope').textContent = scopeKey ? scope().tenant + ' / ' + scope().slot : 'Select a merchant';
    $('delivery-observed').textContent = updated ? 'Delivery observed ' + date(updated) : 'Refresh to read original delivery state.';
    if (!state) {
      pairs($('delivery-producer'), [['Merchant process', slot?.owned ? 'Owned and running' : 'Stopped or outside this process']]);
      tableMessage($('delivery-destinations'), 'Original destination state is not currently displayed.', 7);
      return renderControls();
    }
    pairs($('delivery-producer'), [
      ['Producer', !state.initialized ? 'Start this merchant once to initialize delivery' :
        producer?.owned && producer.phase === 'RUNNING' ? 'Running in this fleet' : producer?.phase ?? 'Retained source'],
      ['Payment mode', producer?.mode ?? '—'],
      ['Release', producer ? producer.releaseId + ' / ' + producer.releaseDigest : '—'],
      ['Native instance', producer?.instanceId ?? '—'],
      ['Original receipts', state.destinations?.source.events ?? 0],
      ['Journal warnings', producer?.journalWarnings ?? 0],
      ['Last journal warning', producer?.lastWriteFailure ? date(producer.lastWriteFailure.at) + ' · ' + producer.lastWriteFailure.code : '—'],
      ['Delivery worker', state.destinations ? state.destinations.worker.activeHere ? 'Running here' :
        state.destinations.worker.owner.active ? 'Running in another original delivery process' :
        state.destinations.worker.previousRunNeedsReopen ? 'Stopped; previous run can be reopened' : 'Stopped' : '—'],
      ['Source fingerprint', state.destinations?.source.fingerprint ?? '—'],
    ]);
    const rows = state.destinations?.destinations ?? [];
    if (!rows.length) tableMessage($('delivery-destinations'), state.initialized ?
      'Open destination controls to enroll an HTTPS receiver.' : 'Delivery initializes on the original merchant’s first start.', 7);
    else {
      $('delivery-destinations').replaceChildren(...rows.map(row => cells([
        row.label ? row.label + ' · ' + row.id : row.id,
        row.error ?? (row.paused ? 'Paused' : row.continuity),
        row.sourceEventsRemaining ?? '—', row.outbox?.pending ?? '—', row.outbox?.delivered ?? '—',
        row.outbox?.exhausted ?? '—', row.secretAvailable ? row.secretEnv + ' · ready' : row.secretEnv ? row.secretEnv + ' · required' : '—',
      ])));
    }
    renderControls();
  }
  function renderTransfers() {
    const rows = transfers?.transfers ?? [], errors = transfers?.errors ?? [];
    if (!rows.length && !errors.length) tableMessage($('delivery-transfer-list'), 'No retained delivery transfer on this page.', 5);
    else {
      $('delivery-transfer-list').replaceChildren(...rows.map(row => {
        const inspect = node('button', 'Inspect'); inspect.type = 'button';
        inspect.addEventListener('click', () => { void inspectTransfer(row.id, row.fingerprint); });
        return cells([row.id, date(row.createdAt), row.source.events, row.destinations.length, inspect]);
      }), ...errors.map(row => cells([row.id, 'Original transfer unreadable', '—', '—', row.code])));
    }
    $('delivery-page').textContent = after ? 'Transfers after ' + after : 'First transfer page';
    renderControls();
  }
  function renderSelected() {
    $('delivery-review').hidden = !selected;
    if (!selected) { $('delivery-files').replaceChildren(); return renderControls(); }
    $('delivery-review-title').textContent = 'Delivery transfer · ' + selected.id;
    pairs($('delivery-transfer-identity'), [
      ['Exchange fingerprint', selected.fingerprint], ['Captured', date(selected.createdAt)],
      ['Original receipts', selected.source.events], ['Destinations', selected.destinations.length],
      ['Original files', selected.files.length], ['Uncompressed size', bytes(selected.totalBytes)],
      ['Retained source fingerprint', selected.source.fingerprint],
    ]);
    $('delivery-files').replaceChildren(...selected.files.map(file => cells([file.name, bytes(file.bytes), node('code', file.sha256)])));
    const directory = 'TRANSFER_DIRECTORY', target = 'NEW_PRIVATE_DIRECTORY';
    $('delivery-receive-commands').textContent =
      'mkdir -m 700 ' + quote(directory) + '\n' +
      'tar -xzf ' + quote(selected.id + '-delivery.tar.gz') + ' -C ' + quote(directory) + '\n' +
      'starforge-merchant delivery-destinations inspect --workspace "$PWD/' + directory + '"\n' +
      'starforge-merchant delivery-destinations receive --workspace "$PWD/' + target + '" --from "$PWD/' + directory +
      '" --fingerprint ' + selected.fingerprint + '\n';
    renderControls();
  }
  async function refresh() {
    if (stopped || !scopeKey || working) return;
    reading?.abort(); const controller = new AbortController(); reading = controller;
    const generation = epoch, selectedScope = scope();
    renderControls();
    const result = await Promise.allSettled([
      request(base + '?' + query(selectedScope), undefined, { signal: controller.signal }),
      request(base + '/transfers?' + query(selectedScope, { after, limit: 25 }), undefined, { signal: controller.signal }),
    ]);
    if (stopped || generation !== epoch || controller.signal.aborted) return;
    reading = null;
    state = result[0].status === 'fulfilled' ? result[0].value : null;
    transfers = result[1].status === 'fulfilled' ? result[1].value : null;
    updated = new Date().toISOString();
    const failures = result.filter(row => row.status === 'rejected');
    if (failures.length) notice(failures.map(row => explanations[row.reason?.message] ?? row.reason?.message ?? 'Original delivery read failed.').join(' '), true);
    else notice('');
    renderState(); renderTransfers();
  }
  async function inspectTransfer(id, expectedFingerprint, { internal = false } = {}) {
    if (stopped || working || !internal && isBusy()) return;
    reading?.abort(); const controller = new AbortController(); reading = controller;
    const generation = epoch;
    renderControls();
    try {
      const result = await request(base + '/transfer?' + query(scope(), { id, expectedFingerprint }), undefined, { signal: controller.signal });
      if (stopped || generation !== epoch || controller.signal.aborted) return;
      selected = result; $('delivery-transfer-id').value = id; remember(); renderSelected(); notice('');
    } catch (error) {
      if (!stopped && generation === epoch && !controller.signal.aborted) notice(explanations[error.message] ?? error.message, true);
    } finally { if (reading === controller) reading = null; renderControls(); }
  }
  function perform(action, input, transfer = false) {
    if (stopped || working || isBusy()) return;
    const selectedScope = scope(), generation = epoch;
    reading?.abort(); reading = null; working = true; setBusy(true); renderControls();
    const pending = (async () => {
      let outcome, failure;
      try { outcome = await request(base + (transfer ? '/transfer' : '/control'),
        transfer ? { ...selectedScope, ...input } : { ...selectedScope, action, input }); }
      catch (error) { failure = error; }
      finally { working = false; if (!stopped) setBusy(false); }
      if (stopped || generation !== epoch) return;
      await refresh();
      if (stopped || generation !== epoch) return;
      if (failure) return notice(explanations[failure.message] ??
        'Inspect the current delivery state and retained transfer before repeating the operation. ' + failure.message, true);
      if (transfer) {
        await inspectTransfer(outcome.id, outcome.fingerprint, { internal: true });
        if (!stopped) notice(outcome.retained ? 'Reopened the existing original delivery transfer.' : 'The complete original delivery transfer is retained.');
      } else notice(action === 'start' ? 'The original delivery worker started.' : action === 'stop' ?
        'The original delivery worker stop was recorded.' : 'Original delivery cycle completed. Inspect each destination’s current outcome.');
    })();
    mutation = pending; pending.finally(() => { if (mutation === pending) mutation = null; }).catch(() => {});
    return pending;
  }
  async function savePackage() {
    if (stopped || !selected || working || isBusy()) return;
    const capture = selected, selectedScope = scope(), generation = epoch;
    if (typeof window.showSaveFilePicker !== 'function' && capture.totalBytes > BUFFER_LIMIT)
      return notice('Use native browser file saving for this package size, or open the retained directory from the CLI. The manifest also exposes each exact file through MCP.', true);
    const controller = new AbortController(); download = controller; working = true; setBusy(true); renderControls();
    let writer, stream, completed = false;
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({ suggestedName: capture.id + '-delivery.tar.gz',
          types: [{ description: 'Compressed delivery exchange', accept: { 'application/gzip': ['.gz'] } }] });
        writer = await handle.createWritable();
      }
      controller.signal.throwIfAborted();
      const response = await request(base + '/download?' + query(selectedScope, {
        id: capture.id, expectedFingerprint: capture.fingerprint }), undefined, { raw: true, signal: controller.signal });
      if (!response.headers.get('content-type')?.startsWith('application/gzip')) throw new Error('DELIVERY_ARCHIVE_RESPONSE_INVALID');
      stream = response.body.getReader(); const chunks = []; let received = 0;
      while (true) {
        controller.signal.throwIfAborted(); const { value, done } = await stream.read(); if (done) break;
        received += value.length;
        if (writer) await writer.write(value);
        else { if (received > BUFFER_LIMIT) throw new Error('DELIVERY_BROWSER_MEMORY_LIMIT'); chunks.push(value); }
        if (!stopped && generation === epoch) $('delivery-download-progress').textContent = 'Received ' + bytes(received) + ' of the compressed transfer.';
      }
      if (writer) await writer.close();
      else {
        const url = URL.createObjectURL(new Blob(chunks, { type: 'application/gzip' }));
        const link = node('a'); link.href = url; link.download = capture.id + '-delivery.tar.gz';
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      completed = true;
      if (!stopped && generation === epoch) notice(writer ? 'Delivery package saved. Use the displayed original receiving commands.' :
        'The complete delivery package was sent to browser downloads. Use the displayed original receiving commands.');
    } catch (error) {
      if (!stopped && generation === epoch) notice(controller.signal.aborted || error.name === 'AbortError' ?
        'Download stopped. The same retained transfer is available to download again.' :
        explanations[error.message] ?? error.message, !controller.signal.aborted && error.name !== 'AbortError');
    } finally {
      if (!completed) { await stream?.cancel().catch(() => {}); await writer?.abort().catch(() => {}); }
      download = null; working = false; if (!stopped) setBusy(false); renderControls();
    }
  }
  function update() {
    if (stopped) return;
    const releases = getReleases(), tenants = releases?.tenants ?? [];
    $('fleet-delivery').hidden = !tenants.length;
    if (!tenants.length) return;
    options($('delivery-tenant'), tenants.map(row => [row.id, row.id + ' · ' + row.host]));
    const tenant = tenants.find(row => row.id === $('delivery-tenant').value);
    options($('delivery-slot'), (tenant?.slots ?? []).map(row => [row.name,
      row.name + (row.serving ? ' · serving' : row.owned ? ' · running' : ' · stopped')]));
    const next = (releases.planDigest ?? '') + '/' + scope().tenant + '/' + scope().slot;
    if (next !== scopeKey) {
      remember(); reading?.abort(); reading = null; epoch++; scopeKey = next;
      state = null; transfers = null; selected = null; after = undefined; updated = null;
      restore(); renderState(); renderTransfers(); renderSelected(); void refresh();
    } else renderControls();
  }
  $('delivery-tenant').addEventListener('change', () => { $('delivery-slot').replaceChildren(); update(); });
  $('delivery-slot').addEventListener('change', update);
  $('delivery-transfer-id').addEventListener('input', remember);
  $('delivery-refresh').addEventListener('click', () => { void refresh(); });
  $('delivery-first').addEventListener('click', () => { after = undefined; void refresh(); });
  $('delivery-next').addEventListener('click', () => { if (transfers?.next) { after = transfers.next; void refresh(); } });
  $('delivery-transfer-form').addEventListener('submit', event => {
    event.preventDefault(); const id = $('delivery-transfer-id').value;
    if (!TRANSFER_ID.test(id)) return notice('Use a new transfer ID with 1–64 lowercase letters, digits, underscores or hyphens.', true);
    const expectedSourceFingerprint = state?.destinations?.source?.fingerprint;
    if (!HEX.test(expectedSourceFingerprint ?? '')) return notice('Refresh the original source before capturing a transfer.', true);
    remember(); void perform('transfer', { id, expectedSourceFingerprint }, true);
  });
  $('delivery-drain').addEventListener('click', () => { void perform('drain', {}); });
  $('delivery-start').addEventListener('click', () => { void perform('start', {}); });
  $('delivery-stop').addEventListener('click', () => { void perform('stop', {}); });
  $('delivery-download').addEventListener('click', () => { void savePackage(); });
  $('delivery-download-stop').addEventListener('click', () => download?.abort(new Error('DOWNLOAD_CANCELLED')));
  return { update, refresh, close() {
    if (closePromise) return closePromise;
    remember(); stopped = true; epoch++; reading?.abort(); download?.abort(new Error('WORKSPACE_CLOSED'));
    closePromise = Promise.resolve(mutation).catch(() => {}); return closePromise;
  } };
}
