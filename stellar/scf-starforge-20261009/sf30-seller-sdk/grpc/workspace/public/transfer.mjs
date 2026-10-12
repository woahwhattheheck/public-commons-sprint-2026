// MIT. Complete original-workspace migration controls.
const CHUNK = 1048576, MAX_ARCHIVE = 64 * 1024 ** 3 + 256 * 1024 ** 2;
const SHA = /^[a-f0-9]{64}$/;
const displayBytes = value => Number.isFinite(value) ? new Intl.NumberFormat().format(value) + ' B' : '—';
const short = value => value ? value.slice(0, 12) : '—';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function element(tag, text, className) {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = text;
  if (className) value.className = className; return value;
}
function control(label, action) {
  const value = element('button', label); value.type = 'button'; value.addEventListener('click', action); return value;
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let text = ''; for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function mountGrpcTransfer({ root, json, api, notice, storageKey }) {
  if (!root) throw new Error('Workspace migration panel is missing.');
  const key = storageKey + ':transfer:v1';
  let saved = { schema: 'stellar-forge.grpc-transfer-browser.v1' }, storageIssue = null;
  try {
    const text = sessionStorage.getItem(key);
    if (text) {
      const value = JSON.parse(text);
      if (value?.schema !== saved.schema) throw new Error('Saved migration selection has an unsupported format.');
      saved = value;
    }
  } catch (issue) { storageIssue = issue; }
  let inventory = null, draftSaved = true, busy = null, controller = null, cancelling = false;
  let capture = null, receipt = null, inspected = null, opened = null;
  let capturePage = { offset: 0, snapshot: null }, receiptPage = { offset: 0, snapshot: null };
  let filePage = { offset: 0, snapshot: null }, generation = 0, refreshPending = false, poll = null;
  function retain(patch) {
    if (storageIssue) throw new Error('This window’s migration selection could not be read. Use saved captures or receipts in a fresh window.');
    const next = { ...saved, ...patch };
    sessionStorage.setItem(key, JSON.stringify(next)); saved = next;
  }
  const $ = id => root.querySelector('[data-transfer="' + id + '"]');
  root.classList.add('grpc-transfer');
  root.innerHTML = '<div class="transfer-heading"><div><h2>Move the complete workspace</h2><p>Capture saved source, original calls, health observations, contract reviews, incident history, customer preparations and staged gRPC releases. Receiving opens the same records at an explicitly selected new location.</p></div><button type="button" data-transfer="refresh">Refresh saved transfers</button></div>' +
    '<p class="transfer-status" data-transfer="status" role="status" aria-live="polite">Select a saved capture or create a complete archive.</p>' +
    '<div class="transfer-toolbar"><button type="button" data-transfer="cancel" hidden>Cancel current transfer</button><button type="button" data-transfer="pause" hidden>Pause upload</button></div>' +
    '<div class="transfer-columns"><article><h3>1. Capture saved work</h3><label>Maximum native payload bytes<input data-transfer="budget" inputmode="numeric" value="8589934592"></label><p class="hint" data-transfer="capture-hint">The current saved source and all retained history are selected together.</p><div class="actions"><button type="button" data-transfer="capture">Capture saved workspace</button><button type="button" data-transfer="continue-capture" class="secondary" disabled>Continue selected capture</button></div><div class="transfer-scroll"><table><thead><tr><th>Saved capture</th><th>State</th><th>Archive</th><th></th></tr></thead><tbody data-transfer="captures"></tbody></table></div><div class="transfer-pager" data-transfer="capture-pages"></div></article>' +
    '<article><h3>2. Select an archive</h3><p>Use a completed capture from this host, or upload a saved archive with its exact SHA-256. Uploads retain their original byte position across interruptions.</p><label>Archive file<input type="file" data-transfer="file" accept=".gz,.tgz,application/gzip"></label><label>Expected archive SHA-256<input data-transfer="upload-sha" autocomplete="off" spellcheck="false" maxlength="64" placeholder="64 lowercase hexadecimal characters"></label><div class="actions"><button type="button" data-transfer="upload">Upload and inspect</button><button type="button" data-transfer="inspect" class="secondary" disabled>Inspect selected archive</button></div><p class="mono" data-transfer="upload-status"></p><div data-transfer="inspection" class="transfer-summary">No archive is selected.</div></article></div>' +
    '<article class="transfer-detail"><div class="transfer-heading"><h3>Selected capture</h3><div class="actions"><button type="button" data-transfer="download" disabled>Download complete archive</button><button type="button" data-transfer="manifest" class="secondary" disabled>Download source manifest</button><button type="button" data-transfer="use-capture" class="secondary" disabled>Use for receiving</button></div></div><div data-transfer="capture-detail"></div>' +
    '<div class="transfer-filters"><label>File path<input data-transfer="search" placeholder="Filter retained paths"></label><label>File role<select data-transfer="file-kind"><option value="">All files</option><option value="workspace">Native workspace</option><option value="health-prefix">Committed health history</option><option value="observation">Historical runtime observations</option></select></label><button type="button" data-transfer="filter" class="secondary">Filter files</button></div>' +
    '<div class="transfer-scroll"><table><thead><tr><th>Original path</th><th>Role</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody data-transfer="files"></tbody></table></div><div class="transfer-pager" data-transfer="file-pages"></div></article>' +
    '<div class="transfer-columns"><article><h3>3. Receive at a new location</h3><p>The native receiver checks the full archive, publishes the selected workspace once and validates its original records. A repeated receipt keeps later edits in that workspace.</p><label>New absolute workspace directory<input data-transfer="directory" autocomplete="off" spellcheck="false" placeholder="/private/workspaces/merchant-received"></label><div class="actions"><button type="button" data-transfer="receive" disabled>Receive complete workspace</button><button type="button" data-transfer="continue-receive" class="secondary" disabled>Continue saved receiving</button></div><div data-transfer="receipt-detail" class="transfer-summary">Choose an inspected archive and a new workspace location.</div><div class="actions"><button type="button" data-transfer="open" disabled>Start received editor</button><button type="button" data-transfer="close" class="secondary" disabled>Close received editor</button><span data-transfer="open-link"></span></div></article>' +
    '<article><h3>Receiving history</h3><p>Original archive identity, receiving operation and relocated workspace stay linked. Each opened editor receives its own current native owner.</p><div class="transfer-scroll"><table><thead><tr><th>Receiving operation</th><th>State</th><th>Location</th><th></th></tr></thead><tbody data-transfer="receipts"></tbody></table></div><div class="transfer-pager" data-transfer="receipt-pages"></div></article></div>';
  $('upload-sha').value = saved.uploadIntent?.sha256 ?? '';
  $('directory').value = saved.receiveIntent?.directory ?? '';
  function status(message, error = false) {
    $('status').textContent = message; $('status').dataset.error = String(error);
    notice(message, error ? 'error' : '');
  }
  function setButtons() {
    const locked = Boolean(busy);
    for (const button of root.querySelectorAll('button')) button.disabled = locked;
    for (const input of root.querySelectorAll('input, select')) input.disabled = locked;
    $('capture').disabled = locked || !draftSaved || !inventory;
    $('continue-capture').disabled = locked || !capture?.input || capture.state === 'COMPLETED';
    $('download').disabled = $('manifest').disabled = $('use-capture').disabled = locked || capture?.state !== 'COMPLETED';
    $('inspect').disabled = locked || !saved.archiveSelection;
    $('receive').disabled = locked || !inspected;
    $('continue-receive').disabled = locked || !saved.receiveIntent || receipt?.id === saved.receiveIntent.id && receipt.state === 'COMPLETED';
    $('open').disabled = locked || receipt?.state !== 'COMPLETED';
    $('close').disabled = locked || !receipt?.runningHere;
    $('cancel').hidden = !busy?.id || !['capture', 'receive'].includes(busy.kind);
    $('cancel').disabled = cancelling;
    $('pause').hidden = busy?.kind !== 'upload'; $('pause').disabled = !controller || controller.signal.aborted;
    $('capture-hint').textContent = draftSaved ?
      'The current saved source and all retained history are selected together.' :
      'Save the current source, route and plan edits before capturing this workspace.';
  }
  function metrics(parent, counts) {
    const list = element('dl', undefined, 'transfer-metrics');
    for (const [name, value] of Object.entries(counts ?? {})) {
      list.append(element('dt', name), element('dd', String(value)));
    }
    parent.append(list);
  }
  function archiveSummary(value) {
    const area = $('inspection'); area.replaceChildren();
    if (!value) { area.append(element('p', saved.archiveSelection ? 'Selected archive is ready for full inspection.' : 'No archive is selected.')); return; }
    area.append(element('strong', 'Complete archive inspected'), element('p', displayBytes(value.bytes)),
      element('p', 'Archive SHA-256: ' + value.sha256, 'mono'),
      element('p', 'Manifest SHA-256: ' + value.manifestSha256, 'mono'),
      element('p', 'Source: ' + value.manifest.origin.directory, 'mono'));
    metrics(area, value.manifest.counts);
    area.append(element('p', 'Credential environment names: ' + (value.manifest.environmentNames.join(', ') || 'none')));
  }
  function captureSummary(value) {
    const area = $('capture-detail'); area.replaceChildren();
    if (!value) { area.append(element('p', 'Select a saved capture to inspect its source edition and files.')); return; }
    area.append(element('strong', value.id, 'mono'), element('p', value.state + ' · ' + (value.phase ?? 'saved intent')));
    if (value.progress) area.append(element('p', value.progress.files + ' files · ' + displayBytes(value.progress.bytes)));
    if (value.error) area.append(element('p', value.error, 'mono'));
    if (value.manifest) {
      area.append(element('p', 'Captured ' + value.manifest.createdAt + ' from ' + value.manifest.origin.directory),
        element('p', 'Manifest SHA-256: ' + value.manifest.sha256, 'mono'));
      metrics(area, value.manifest.counts);
      area.append(element('p', 'Required environment names: ' + (value.manifest.environmentNames.join(', ') || 'none')),
        element('p', value.manifest.health.length + ' health histories retain their exact committed prefixes. Historical process and receiving observations remain available in the manifest.'));
    }
    if (value.archive) area.append(element('p', displayBytes(value.archive.bytes) + ' · archive SHA-256 ' + value.archive.sha256, 'mono'));
  }
  function receiptSummary(value) {
    const area = $('receipt-detail'); area.replaceChildren(); $('open-link').replaceChildren();
    if (!value) { area.append(element('p', saved.receiveIntent ? 'Saved receiving operation ' + saved.receiveIntent.id + ' is ready to continue.' : 'Choose an inspected archive and a new workspace location.')); return; }
    area.append(element('strong', value.id, 'mono'), element('p', value.state + ' · ' + value.request.directory, 'mono'));
    if (value.error) area.append(element('p', value.error, 'mono'));
    if (value.result) {
      metrics(area, value.result.counts);
      area.append(element('p', 'Original transfer: ' + value.result.transferId, 'mono'),
        element('p', 'Archive SHA-256: ' + value.result.archiveSha256, 'mono'),
        element('p', 'Current source revision: ' + (value.binding?.current?.revision ?? 'empty workspace'), 'mono'),
        element('p', 'Provide these environment names in the receiving host before an intentional upstream call: ' +
          (value.result.environmentNames.join(', ') || 'none')));
    }
    if (opened?.id === value.id && value.runningHere) {
      const link = element('a', 'Open received editor'); link.href = opened.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; $('open-link').append(link);
    }
  }
  function pager(target, value, action) {
    const area = $(target); area.replaceChildren(element('span', value.total ?
      (value.offset + 1) + '–' + Math.min(value.offset + value.items.length, value.total) + ' of ' + value.total : '0 records'));
    if (value.offset) area.append(control('Previous', () => perform('page', () => action(Math.max(0, value.offset - 50)))));
    if (value.nextOffset !== null) area.append(control('Next', () => perform('page', () => action(value.nextOffset))));
  }
  async function captures(offset = 0) {
    const value = await json('transfer-list', { kind: 'captures', offset, limit: 50,
      ...(offset ? { expectedSnapshot: capturePage.snapshot } : {}) });
    capturePage = { offset, snapshot: value.snapshot };
    const area = $('captures'); area.replaceChildren();
    for (const row of value.items) {
      const tr = element('tr'); tr.append(element('td', short(row.id), 'mono'), element('td', row.state),
        element('td', displayBytes(row.archiveBytes)));
      const action = element('td'); action.append(control('Inspect', () => perform('read', () => selectCapture(row.id)))); tr.append(action); area.append(tr);
    }
    pager('capture-pages', value, captures); return value;
  }
  async function receipts(offset = 0) {
    const value = await json('transfer-list', { kind: 'receipts', offset, limit: 50,
      ...(offset ? { expectedSnapshot: receiptPage.snapshot } : {}) });
    receiptPage = { offset, snapshot: value.snapshot };
    const area = $('receipts'); area.replaceChildren();
    for (const row of value.items) {
      const tr = element('tr'); tr.append(element('td', short(row.id), 'mono'), element('td', row.state),
        element('td', row.directory ?? '', 'mono'));
      const action = element('td'); action.append(control('Open record', () => perform('read', () => selectReceipt(row.id)))); tr.append(action); area.append(tr);
    }
    pager('receipt-pages', value, receipts);
  }
  async function files(offset = 0) {
    if (!capture?.manifest) { $('files').replaceChildren(); $('file-pages').replaceChildren(); return; }
    const id = capture.id, selected = generation;
    const body = { id, offset, limit: 50, ...(offset ? { expectedSnapshot: filePage.snapshot } : {}) };
    if ($('search').value) body.search = $('search').value;
    if ($('file-kind').value) body.kind = $('file-kind').value;
    const value = await json('transfer-files', body);
    if (selected !== generation || capture?.id !== id) return;
    filePage = { offset, snapshot: value.snapshot };
    const area = $('files'); area.replaceChildren();
    for (const file of value.items) {
      const tr = element('tr'); tr.append(element('td', file.path, 'mono'), element('td', file.kind),
        element('td', displayBytes(file.bytes)), element('td', file.sha256, 'mono')); area.append(tr);
    }
    pager('file-pages', value, files);
  }
  async function selectCapture(id) {
    const next = await json('transfer-read', { id }); generation++;
    retain({ selectedCapture: id, captureIntent: next.input }); capture = next; captureSummary(capture); await files();
  }
  async function selectReceipt(id) {
    const next = await json('transfer-receipt', { id });
    retain({ selectedReceipt: id, receiveIntent: { id, ...next.request } });
    receipt = next; $('directory').value = next.request.directory; receiptSummary(receipt);
  }
  async function inspectSelection() {
    const selection = saved.archiveSelection;
    if (!selection) throw new Error('Select a completed capture or upload first.');
    const value = await json('transfer-inspect', { archive: selection }, { signal: controller?.signal });
    if (!equal(selection, saved.archiveSelection)) throw new Error('The archive selection changed during inspection.');
    inspected = value; archiveSummary(value); return value;
  }
  async function refresh() {
    const value = await captures(); await receipts();
    if (saved.selectedCapture) await selectCapture(saved.selectedCapture);
    if (saved.selectedReceipt) await selectReceipt(saved.selectedReceipt);
    setButtons(); return value;
  }
  async function perform(kind, action, id = null) {
    if (busy) return;
    busy = { kind, id }; controller = new AbortController(); setButtons();
    try { return await action(); }
    catch (issue) { status((issue.name === 'AbortError' ? 'The operation remains saved for continuation.' : issue.message), true); }
    finally {
      clearInterval(poll); poll = null; busy = null; controller = null; cancelling = false; setButtons();
    }
  }
  function pollCapture(id) {
    poll = setInterval(async () => {
      if (refreshPending) return; refreshPending = true;
      try { const value = await json('transfer-read', { id }); if (busy?.id === id) { capture = value; captureSummary(value); } }
      catch {} finally { refreshPending = false; }
    }, 2000);
  }
  async function runCapture(input) {
    retain({ captureIntent: input, selectedCapture: input.id });
    busy.id = input.id; setButtons(); pollCapture(input.id);
    status('Capturing the saved native workspace as operation ' + input.id + '…');
    capture = await json('transfer-capture', input, { signal: controller.signal });
    captureSummary(capture); await files(); await captures();
    status('Complete workspace archive retained: ' + displayBytes(capture.archive.bytes) + '.');
  }
  $('capture').addEventListener('click', () => perform('capture', async () => {
    if (!draftSaved) throw new Error('Save the current source, route and plan edits first.');
    const text = $('budget').value;
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 64 * 1024 ** 3)
      throw new Error('Choose a byte limit from 1 through 68,719,476,736.');
    const current = await json('transfer-list', { kind: 'captures', limit: 1 });
    await runCapture({ id: crypto.randomUUID(), maxBytes: Number(text), expectedBinding: current.binding });
  }));
  $('continue-capture').addEventListener('click', () => perform('capture', () => runCapture(capture.input), capture?.id));
  $('refresh').addEventListener('click', () => perform('read', refresh));
  $('filter').addEventListener('click', () => perform('read', () => files()));
  $('use-capture').addEventListener('click', () => perform('inspect', async () => {
    retain({ archiveSelection: { kind: 'capture', id: capture.id } }); inspected = null;
    await inspectSelection(); status('The selected complete capture is ready for receiving.');
  }));
  $('inspect').addEventListener('click', () => perform('inspect', async () => {
    await inspectSelection(); status('The full archive membership and bytes match its saved manifest.');
  }));
  $('upload').addEventListener('click', () => perform('upload', async () => {
    const file = $('file').files[0], expected = $('upload-sha').value.trim();
    if (!file || !file.size || file.size > MAX_ARCHIVE || !SHA.test(expected))
      throw new Error('Choose the saved archive and its exact lowercase SHA-256.');
    let intent = saved.uploadIntent;
    if (!intent || intent.sha256 !== expected || intent.bytes !== file.size) {
      intent = { id: crypto.randomUUID(), name: file.name, bytes: file.size, sha256: expected };
      retain({ uploadIntent: intent });
    }
    let state;
    try { state = await json('transfer-upload-status', { id: intent.id }); }
    catch (issue) { if (issue.status !== 404 && issue.code !== 'ENOENT') throw issue; }
    if (state && (state.sha256 !== intent.sha256 || state.bytes !== intent.bytes)) throw new Error('The saved upload identity changed.');
    let offset = state?.receivedBytes ?? 0;
    while (state?.state !== 'COMPLETED') {
      controller.signal.throwIfAborted();
      const content = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + CHUNK)).arrayBuffer());
      state = await json('transfer-upload', { id: intent.id, sha256: intent.sha256, bytes: intent.bytes, offset,
        base64: base64(content), chunkSha256: await digest(content) }, { signal: controller.signal });
      if (state.sha256 !== intent.sha256 || state.bytes !== file.size ||
        !Number.isSafeInteger(state.receivedBytes) || state.receivedBytes < offset + content.length ||
        state.receivedBytes > file.size || state.receivedBytes === offset && state.state !== 'COMPLETED')
        throw new Error('The original upload byte position changed.');
      offset = state.receivedBytes;
      $('upload-status').textContent = intent.id + ' · ' + displayBytes(offset) + ' / ' + displayBytes(file.size);
    }
    retain({ archiveSelection: { kind: 'upload', id: intent.id } }); inspected = null;
    await inspectSelection(); status('Complete uploaded archive retained and inspected.');
  }));
  $('download').addEventListener('click', () => perform('download', async () => {
    const value = await json('transfer-download', { id: capture.id, expectedManifestSha256: capture.manifest.sha256 });
    if (value.sha256 !== capture.archive.sha256 || value.bytes !== capture.archive.bytes ||
      !/^\/api\/stream-files\/[a-f0-9]{64}$/.test(value.url)) throw new Error('The original archive download changed.');
    const a = element('a'); a.href = value.url; a.download = value.filename; a.rel = 'noopener'; a.click();
    status('The complete archive download has started. Its SHA-256 remains visible in the selected capture.');
  }));
  $('manifest').addEventListener('click', () => perform('download', async () => {
    const response = await api('transfer-manifest-file', { id: capture.id, expectedManifestSha256: capture.manifest.sha256 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== Number(response.headers.get('content-length')) ||
      await digest(bytes) !== response.headers.get('x-content-sha256')) throw new Error('The original manifest file changed.');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    try { const a = element('a'); a.href = url; a.download = 'grpc-workspace-transfer.json'; a.click(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
  }));
  async function runReceive(input) {
    retain({ receiveIntent: input, selectedReceipt: input.id }); busy.id = input.id; setButtons();
    status('Receiving and reopening original records at ' + input.directory + '…');
    receipt = await json('transfer-receive', input, { signal: controller.signal });
    receiptSummary(receipt); await receipts(); status('Complete workspace received. Start its native editor when ready.');
  }
  $('receive').addEventListener('click', () => perform('receive', async () => {
    if (!inspected) throw new Error('Inspect the complete selected archive first.');
    const directory = $('directory').value.trim();
    if (!directory.startsWith('/') || directory === '/') throw new Error('Enter a new absolute workspace directory.');
    const request = { archive: saved.archiveSelection, directory, expectedSha256: inspected.sha256,
      expectedBytes: inspected.bytes, expectedManifestSha256: inspected.manifestSha256 };
    const old = saved.receiveIntent;
    const input = old && equal(Object.fromEntries(Object.entries(old).filter(([name]) => name !== 'id')), request) ?
      old : { id: crypto.randomUUID(), ...request };
    await runReceive(input);
  }));
  $('continue-receive').addEventListener('click', () => perform('receive', () => runReceive(saved.receiveIntent), saved.receiveIntent?.id));
  $('open').addEventListener('click', () => perform('open', async () => {
    receipt = await json('transfer-receipt', { id: receipt.id });
    opened = await json('transfer-open', { id: receipt.id, expectedBinding: receipt.binding });
    const target = new URL(opened.url);
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port ||
      target.pathname !== '/' || target.search || !/^#[a-f0-9]{64}$/.test(target.hash)) throw new Error('The received editor returned an invalid private location.');
    receipt = await json('transfer-receipt', { id: receipt.id }); receiptSummary(receipt);
    status('The received native editor is running. Open its private link.');
  }));
  $('close').addEventListener('click', () => perform('close', async () => {
    receipt = await json('transfer-close', { id: receipt.id }); opened = null; receiptSummary(receipt);
    status('The received editor and its owned native resources have closed.');
  }));
  $('cancel').addEventListener('click', async () => {
    if (!busy?.id || cancelling) return; const id = busy.id; cancelling = true; setButtons();
    try { await json('transfer-cancel', { id }); status('The original transfer has settled. Its saved operation remains available.'); }
    catch (issue) { status(issue.message, true); } finally { cancelling = false; setButtons(); }
  });
  $('pause').addEventListener('click', () => { controller?.abort(); setButtons(); });
  captureSummary(null); archiveSummary(null); receiptSummary(null); setButtons();
  return {
    update(value, savedDraft = true) {
      inventory = value; draftSaved = savedDraft; setButtons();
    },
    async resume() {
      if (storageIssue) { status(storageIssue.message, true); return; }
      await perform('read', refresh); archiveSummary(inspected);
    },
    isBusy() { return Boolean(busy); },
    clear() { clearInterval(poll); controller?.abort(); generation++; },
  };
}
