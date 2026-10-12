// MIT. Industrial operator for the original Census workspace and merchant engines.
const $ = id => document.getElementById(id), json = value => JSON.stringify(value, null, 2);
const short = value => value ? String(value).slice(0, 16) : '—';
const value = id => $(id).value;
const checked = name => [...document.querySelectorAll('input[name="' + name + '"]:checked')].map(input => input.value);
const words = id => value(id).split(',').map(item => item.trim()).filter(Boolean);
const node = (tag, content) => { const element = document.createElement(tag); if (content !== undefined) element.textContent = String(content); return element; };
const storageKey = 'starforge-geocoder:' + location.origin;
let token = location.hash.slice(1), state = null, busy = false, activeAction = '', batchView = null, offset = 0;
let inspectionVersion = 0, fileVersion = 0, fileReadOwner = 0, buyerReview = null, publicationReview = null, stateVersion = 0;
try { if (token) sessionStorage.setItem(storageKey, token); else token = sessionStorage.getItem(storageKey) ?? ''; } catch {}
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
function notice(message, error = false) {
  $('notice').textContent = message; $('notice').hidden = !message; $('notice').dataset.error = String(error);
}
function handle(fn) { Promise.resolve().then(fn).catch(error => notice(error.message, true)); }
function selectPanel(name) {
  for (const panel of document.querySelectorAll('section[id^="panel-"]')) panel.hidden = panel.id !== 'panel-' + name;
  for (const button of document.querySelectorAll('[data-panel]')) {
    if (button.dataset.panel === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function options(id, entries, label, { placeholder = 'Select a retained item', selected } = {}) {
  const element = $(id), previous = selected ?? element.value;
  element.replaceChildren();
  const empty = node('option', placeholder); empty.value = ''; element.append(empty);
  for (const entry of entries) { const item = node('option', label(entry)); item.value = String(entry.id); element.append(item); }
  if (entries.some(entry => String(entry.id) === previous)) element.value = previous;
}
function facts(id, entries) {
  $(id).replaceChildren(...entries.map(([label, content]) => {
    const entry = node('div'); entry.append(node('b', label), node('span', content ?? '—')); return entry;
  }));
}
async function api(path, init = {}, binary = false) {
  const response = await fetch(path, { ...init, cache: 'no-store',
    headers: { authorization: 'Bearer ' + token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  if (binary && response.ok) return { blob: await response.blob(), filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'download' };
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? result.error ?? 'The retained response could not be read.'), { code: result.error });
  return result;
}
async function refresh() {
  const revision = ++stateVersion, next = await api('/api/state');
  if (revision !== stateVersion) return;
  state = next; render(); return next;
}
async function perform(action, payload = {}) {
  if (busy) throw new Error('Wait for the current operation, or cancel its active source request.');
  busy = true; activeAction = action; const revision = ++stateVersion; renderControls();
  $('connection').textContent = action;
  try {
    const result = await api('/api/action', { method: 'POST', body: json({ action, payload }) });
    if (revision === stateVersion) { state = result.state; render(); }
    $('operation-result').textContent = json({ action, result: result.result });
    notice(action + ' completed. The retained state is updated.');
    return result.result;
  } catch (error) {
    $('operation-result').textContent = json({ action, error: error.code, message: error.message });
    try { await refresh(); } catch {}
    throw error;
  } finally { busy = false; activeAction = ''; renderControls(); }
}
async function download(kind, id) {
  if (!id) throw new Error('Select the retained item to download.');
  const file = await api('/api/download?' + new URLSearchParams({ kind, id }), {}, true);
  const url = URL.createObjectURL(file.blob), link = node('a'); link.href = url; link.download = file.filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderDiscovery() {
  const discoveries = state.metadata.filter(item => item.kind === 'benchmarks' && item.state === 'COMPLETE');
  options('discovery', discoveries, item => item.createdAt + ' · ' + short(item.exchange.sha256));
  const selected = discoveries.find(item => item.id === value('discovery'));
  options('benchmark', selected?.options ?? [], item => item.benchmarkName + ' · ID ' + item.id, { placeholder: 'Choose an explicit benchmark' });
  const vintages = state.metadata.filter(item => item.kind === 'vintages' && item.state === 'COMPLETE' && item.benchmark === value('benchmark'));
  options('vintage-discovery', vintages, item => item.createdAt + ' · ' + short(item.exchange.sha256));
  const vintage = vintages.find(item => item.id === value('vintage-discovery'));
  options('vintage', vintage?.options ?? [], item => item.vintageName + ' · ID ' + item.id, { placeholder: 'Choose an explicit vintage' });
  $('discovery-note').textContent = selected ? 'Official metadata captured ' + selected.exchange.receivedAt + '. A Current alias can refer to different source data on a later capture.' : 'Read the official metadata to make a retained selection.';
}
function renderBatches() {
  const rows = [...state.batches].reverse();
  options('batch-selection', rows, item => item.label + ' · ' + item.input.count + ' addresses');
  $('batch-list').replaceChildren(...rows.map(batch => {
    const row = node('tr'), label = node('td', batch.label); label.append(node('small', batch.id));
    row.append(label, node('td', batch.input.count), node('td', batch.selection.benchmark.benchmarkName + (batch.selection.vintage ? ' / ' + batch.selection.vintage.vintageName : '')),
      node('td', batch.attempts.at(-1)?.state ?? 'READY'));
    const cell = node('td'), open = node('button', 'Open batch'); open.type = 'button';
    open.addEventListener('click', () => handle(async () => { $('batch-selection').value = batch.id; offset = 0; buyerReview = null; await loadBatch(); selectPanel('review'); }));
    cell.append(open); row.append(cell); return row;
  }));
}
function renderReview() {
  const batch = state.batches.find(item => item.id === value('batch-selection'));
  facts('batch-facts', [['Batch', batch?.id], ['Addresses', batch?.input.count], ['Benchmark', batch?.selection.benchmark.benchmarkName],
    ['Vintage', batch?.selection.vintage?.vintageName ?? 'Locations only'], ['Latest attempt', batch?.attempts.at(-1)?.state],
    ['Captured response', batchView?.responseSha256], ...Object.entries(batchView?.counts ?? {})]);
  $('capture-details').textContent = batchView ? json({ batch: batchView.batch, attempt: batchView.attempt }) : '';
  $('matches').replaceChildren(...(batchView?.rows ?? []).map(result => {
    const row = node('tr');
    for (const content of [result.record_id, result.input_address, result.match_status + (result.match_type ? ' / ' + result.match_type : ''),
      result.matched_address ?? '—', result.coordinate_text ?? '—', [result.tract_geoid, result.block_geoid].filter(Boolean).join(' / ') || '—'])
      row.append(node('td', content));
    return row;
  }));
  $('page-info').textContent = batchView?.rows ? 'Rows ' + (batchView.rows.length ? batchView.offset + 1 : 0) + '–' +
    (batchView.offset + batchView.rows.length) + ' of ' + batchView.total : '';
  if (!$('columns').childElementCount) {
    for (const [name, spec] of Object.entries(state.columns)) {
      const label = node('label'), input = node('input'); label.className = 'check'; input.type = 'checkbox';
      input.name = 'column'; input.value = name; input.checked = true;
      if (['record_id', 'match_status'].includes(name)) input.dataset.required = 'true';
      label.append(input, node('span', name + ' · ' + spec.type + (spec.nullable ? '?' : ''))); $('columns').append(label);
    }
  }
}
function renderEditions() {
  options('review-selection', [...state.reviews].reverse(), item => item.plan.name + ' · ' + item.selectedRows + ' rows · ' + short(item.id));
  options('edition-selection', [...state.editions].reverse(), item => (item.dataset?.name ?? 'Edition') + ' · ' + item.state + ' · ' + short(item.id));
  const edition = state.editions.find(item => item.id === value('edition-selection'));
  facts('edition-facts', [['Edition', edition?.id], ['State', edition?.state], ['Rows', edition?.dataset?.rowCount],
    ['Snapshot', edition?.dataset?.snapshot], ['Merchant terms', edition ? edition.hasSeller ? 'Included' : 'Not configured' : null]]);
}
const publisher = () => state?.publisher;
const target = () => publisher()?.target?.versions;
const generation = () => {
  const result = publisher()?.releases?.state?.generation;
  if (!Number.isSafeInteger(result)) throw new Error('Open the original publisher and refresh release state.');
  return result;
};
function renderPublisher() {
  const pub = publisher(), current = target(), release = pub?.releases;
  facts('publisher-facts', [['Publisher directory', pub?.directory], ['Current snapshot', current?.current],
    ['Revision', current?.revision], ['Release generation', release?.state?.generation], ['Selected release', release?.state?.active],
    ['Runtime', release?.runtime?.state], ['Listener', release?.runtime?.observed?.listener]]);
  options('draft-selection', pub?.drafts?.candidates ?? [], item => item.dataset.name + ' · ' + item.dataset.rowCount + ' rows · ' + short(item.id),
    { selected: value('draft-selection') || pub?.drafts?.selectedDraftId });
  $('publisher-order').textContent = pub?.target?.connected ?
    'The original controller is running. Preview this candidate and the current dataset, then review the displayed snapshot and revision before publication.' :
    'The first prepared edition initializes the retained version store. Stage, activate and start its release below; subsequent candidate publication uses that live original controller.';
  options('release-selection', release?.releases ?? [], item => item.label + ' · ' + item.id);
  options('buyer-selection', pub?.drafts?.buyers ?? [], item => item.intentId + ' · ' + short(item.id));
  options('session-selection', pub?.sessions ?? [], item => item.id + ' · ' + (item.report?.state ?? item.report?.status ?? item.error?.code ?? 'Retained'));
  if (publicationReview && (publicationReview.expectedSnapshot !== current?.current || publicationReview.expectedRevision !== current?.revision ||
      publicationReview.draftId !== value('draft-selection'))) publicationReview = null;
  if (buyerReview && buyerReview.snapshot !== current?.current) { buyerReview = null; renderBuyerReview(); }
}
function renderBuyerReview() {
  $('buyer-review').textContent = buyerReview ? json(buyerReview) : 'Read the actual live seller offer for the selected original snapshot.';
  options('payment-option', (buyerReview?.accepts ?? []).map((item, id) => ({ ...item, id: String(id) })),
    item => item.amount + ' atomic · ' + item.network + ' · ' + item.asset + ' → ' + item.payTo,
    { placeholder: 'Select a displayed payment option' });
}
function renderControls() {
  document.body.setAttribute('aria-busy', String(busy));
  for (const control of document.querySelectorAll('main input,main select,main textarea,main button')) control.disabled = busy;
  for (const control of document.querySelectorAll('[data-required]')) control.disabled = true;
  $('refresh').disabled = busy;
  $('connection').textContent = busy ? activeAction : state ? 'Local workspace · saved state' : 'Connecting';
  const batch = state?.batches?.find(item => item.id === value('batch-selection')), latest = batch?.attempts.at(-1);
  $('capture').disabled = busy || !batch || Boolean(latest);
  $('retry').disabled = busy || !batch || !latest || latest.state === 'COMPLETE';
  $('cancel').disabled = !busy || !['batch.capture', 'discovery.benchmarks', 'discovery.vintages'].includes(activeAction);
  $('download-response').disabled = busy || !batchView?.responseSha256;
  $('download-input').disabled = busy || !batch;
  $('save-review').disabled = busy || batchView?.attempt?.state !== 'COMPLETE';
  $('previous-page').disabled = busy || !batchView?.rows || offset === 0;
  $('next-page').disabled = busy || batchView?.next === null || batchView?.next === undefined;
  $('build-edition').disabled = busy || !value('review-selection');
  const edition = state?.editions?.find(item => item.id === value('edition-selection'));
  for (const id of ['download-dataset', 'download-provenance', 'download-manifest', 'query-edition', 'export-edition'])
    $(id).disabled = busy || edition?.state !== 'COMPLETE';
  $('prepare-publisher').disabled = busy || edition?.state !== 'COMPLETE' || !edition.hasSeller;
  $('terms').hidden = !$('with-merchant').checked;
  const pub = publisher(), draftChosen = Boolean(value('draft-selection'));
  $('preview-draft').disabled = busy || !draftChosen;
  $('preview-current').disabled = busy || !pub?.target?.connected;
  $('review-draft').disabled = busy || !draftChosen || !pub?.target?.connected;
  $('publish-draft').disabled = busy || !publicationReview || !pub?.target?.connected;
  $('stage-release').disabled = busy || !draftChosen;
  $('activate-release').disabled = busy || !value('release-selection');
  $('start-release').disabled = busy || !pub?.releases?.state?.active || pub?.ownsRelease === true;
  $('stop-release').disabled = busy || pub?.ownsRelease !== true;
  $('rollback-release').disabled = busy || !pub?.releases?.state?.previous;
  $('review-buyer').disabled = busy || !pub?.target?.connected;
  $('create-session').disabled = busy || !value('buyer-selection');
  for (const id of ['run-session', 'recover-session', 'account-session', 'export-session'])
    $(id).disabled = busy || !value('session-selection');
  $('prepare-buyer').disabled = busy || !buyerReview || !value('payment-option');
  $('download-buyer').disabled = busy || !value('buyer-selection');
  $('download-session').disabled = busy || !value('session-selection');
}
function render() {
  if (!state) return;
  $('workspace-path').textContent = state.directory;
  renderDiscovery(); renderBatches(); renderReview(); renderEditions(); renderPublisher(); renderControls();
}
async function loadBatch() {
  const id = value('batch-selection'), revision = ++inspectionVersion;
  batchView = null; renderReview(); renderControls();
  if (!id) return;
  const selectedStatus = value('match-filter');
  const report = await api('/api/batch?' + new URLSearchParams({ id, status: selectedStatus, offset: String(offset), limit: '100' }));
  if (revision !== inspectionVersion || value('batch-selection') !== id || value('match-filter') !== selectedStatus) return;
  batchView = report; renderReview(); renderControls();
}
function button(id, fn) { $(id).addEventListener('click', () => handle(fn)); }
for (const control of document.querySelectorAll('[data-panel]')) control.addEventListener('click', () => selectPanel(control.dataset.panel));
button('refresh', async () => { await refresh(); if (value('batch-selection')) await loadBatch(); notice('Retained state refreshed.'); });
button('discover', async () => { const result = await perform('discovery.benchmarks'); $('discovery').value = result.id; renderDiscovery(); renderControls(); });
button('vintages', async () => {
  const result = await perform('discovery.vintages', { discoveryId: value('discovery'), benchmark: value('benchmark') });
  $('vintage-discovery').value = result.id; renderDiscovery(); renderControls();
});
for (const id of ['discovery', 'benchmark', 'vintage-discovery']) $(id).addEventListener('change', () => { renderDiscovery(); renderControls(); });
$('return-type').addEventListener('change', () => renderControls());
$('address-file').addEventListener('change', () => handle(async () => {
  if (busy && activeAction !== 'Read address file') throw new Error('Wait for the current operation before changing the file.');
  const revision = ++fileVersion, file = $('address-file').files[0];
  $('address-text').value = ''; $('file-note').textContent = 'Reading selected file…';
  if (!file) { $('file-note').textContent = 'Choose a CSV.'; return; }
  if (file.size > 5000000) { $('file-note').textContent = 'The input exceeds 5,000,000 bytes.'; throw new Error($('file-note').textContent); }
  fileReadOwner = revision; busy = true; activeAction = 'Read address file'; renderControls();
  try {
    const data = await file.arrayBuffer(), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    if (revision !== fileVersion) return;
    $('address-text').value = text; $('file-note').textContent = file.name + ' · ' + file.size + ' original UTF-8 bytes';
  } catch (error) {
    if (revision === fileVersion) { $('address-text').value = ''; $('file-note').textContent = 'File was not retained: ' + error.message; }
    throw error;
  } finally { if (revision === fileReadOwner) { fileReadOwner = 0; busy = false; activeAction = ''; renderControls(); } }
}));
$('address-text').addEventListener('input', () => { fileVersion++; $('file-note').textContent = 'Edited UTF-8 input will be retained as displayed.'; });
button('import-capture', async () => {
  const result = await perform('capture.import', { directory: value('capture-directory') });
  $('batch-selection').value = result.batch.id; offset = 0; await loadBatch(); selectPanel('review');
});
button('save-batch', async () => {
  const kind = value('return-type'), result = await perform('batch.create', { label: value('batch-label'), inputText: value('address-text'),
    header: $('has-header').checked, discoveryId: value('discovery'), benchmark: value('benchmark'), returnType: kind,
    ...(kind === 'geographies' ? { vintagesId: value('vintage-discovery'), vintage: value('vintage') } : {}) });
  $('batch-selection').value = result.id; offset = 0; await loadBatch(); selectPanel('review');
});
$('batch-selection').addEventListener('change', () => handle(async () => { offset = 0; await loadBatch(); }));
$('match-filter').addEventListener('change', () => handle(async () => { offset = 0; await loadBatch(); }));
button('previous-page', async () => { offset = Math.max(0, offset - 100); await loadBatch(); });
button('next-page', async () => { if (batchView?.next !== null) offset = batchView.next; await loadBatch(); });
button('capture', async () => { await perform('batch.capture', { batchId: value('batch-selection') }); await loadBatch(); });
button('retry', async () => { await perform('batch.capture', { batchId: value('batch-selection'), retry: true }); await loadBatch(); });
button('cancel', async () => {
  const result = await api('/api/action', { method: 'POST', body: json({ action: 'operation.cancel', payload: {} }) });
  notice('Cancellation requested for the original source request. Its captured response and attempt will remain retained.');
  $('operation-result').textContent = json(result.result);
});
button('download-input', () => download('input', value('batch-selection')));
button('download-response', () => download('response', value('batch-selection')));
button('save-review', async () => {
  if (batchView?.attempt?.state !== 'COMPLETE') throw new Error('Read the original completed response first.');
  const result = await perform('batch.review', { batchId: batchView.batch.id, attemptId: batchView.attempt.id,
    responseSha256: batchView.responseSha256, plan: { name: value('dataset-name'), columns: checked('column'),
      statuses: checked('status'), matchTypes: checked('match-type'), excludedIds: value('excluded-ids').split(/\r?\n/).filter(Boolean),
      filters: words('filters'), ranges: words('ranges'), sorts: words('sorts'), defaultLimit: Number(value('default-limit')),
      maxLimit: Number(value('max-limit')), note: value('review-note') } });
  $('review-saved').textContent = result.id + ' · ' + result.selectedRows + ' published / ' + result.omittedRows + ' omitted; original capture retained.';
  $('review-selection').value = result.id; renderControls(); selectPanel('editions');
});
$('with-merchant').addEventListener('change', renderControls);
$('review-selection').addEventListener('change', renderControls);
$('edition-selection').addEventListener('change', () => { renderEditions(); renderControls(); });
button('build-edition', async () => {
  const payload = { reviewId: value('review-selection') };
  if ($('with-merchant').checked) Object.assign(payload, { origin: value('origin'), path: value('route'),
    payment: { scheme: 'exact', network: value('network'), asset: value('asset'), amount: value('amount'),
      payTo: value('pay-to'), maxTimeoutSeconds: Number(value('payment-timeout')) } });
  const result = await perform('edition.build', payload); $('edition-selection').value = result.id; renderEditions(); renderControls();
});
for (const [id, kind] of [['download-dataset','dataset'],['download-provenance','provenance'],['download-manifest','manifest']])
  button(id, () => download(kind, value('edition-selection')));
button('query-edition', async () => { const result = await perform('edition.query', { id: value('edition-selection'), query: value('edition-query') }); $('query-result').textContent = json(result); });
button('export-edition', async () => { const result = await perform('edition.export', { id: value('edition-selection'), directory: value('export-directory') }); $('query-result').textContent = json(result); });
button('prepare-publisher', async () => {
  const result = await perform('publisher.prepareEdition', { id: value('edition-selection') });
  $('draft-selection').value = result.result?.draft?.id ?? ''; renderControls(); selectPanel('publisher');
});
button('open-publisher', () => perform('publisher.open'));
button('refresh-publisher', () => perform('publisher.status'));
button('preview-draft', async () => {
  const result = await perform('publisher.preview', { target: 'draft:' + value('draft-selection'), query: value('publisher-query') });
  $('publisher-preview').textContent = json(result.result);
});
button('preview-current', async () => {
  const result = await perform('publisher.preview', { target: target()?.current, query: value('publisher-query') });
  $('publisher-preview').textContent = json(result.result);
});
$('release-selection').addEventListener('change', renderControls);
button('review-draft', async () => {
  const selected = { draftId: value('draft-selection'), expectedSnapshot: target()?.current, expectedRevision: target()?.revision };
  await perform('publisher.reviewDraft', selected); publicationReview = selected; renderControls();
});
$('draft-selection').addEventListener('change', () => { publicationReview = null; renderControls(); });
button('publish-draft', async () => { if (!publicationReview) throw new Error('Review the displayed current revision first.'); await perform('publisher.publish', publicationReview); publicationReview = null; renderControls(); });
button('stage-release', async () => {
  const runtime = { port: Number(value('release-port')) };
  if (value('facilitator')) Object.assign(runtime, { facilitator: value('facilitator'), allowLocalFacilitator: $('local-facilitator').checked });
  const id = value('release-id'); await perform('publisher.release.stage', { draftId: value('draft-selection'), id, label: value('release-label'), runtime });
  $('release-selection').value = id; renderControls();
});
button('activate-release', () => perform('publisher.release.activate', { id: value('release-selection'), expectedGeneration: generation() }));
button('start-release', () => perform('publisher.release.start', { expectedGeneration: generation() }));
button('stop-release', () => perform('publisher.release.stop'));
button('rollback-release', () => perform('publisher.release.rollback', { expectedGeneration: generation() }));
$('buyer-query').addEventListener('input', () => { buyerReview = null; renderBuyerReview(); renderControls(); });
button('review-buyer', async () => {
  const result = await perform('publisher.buyer.review', { snapshot: target()?.current, query: value('buyer-query') });
  buyerReview = result.result; renderBuyerReview(); renderControls();
});
$('payment-option').addEventListener('change', renderControls);
button('prepare-buyer', async () => {
  if (!buyerReview || value('payment-option') === '') throw new Error('Review and choose an advertised payment option.');
  const result = await perform('publisher.buyer.prepare', { review: buyerReview, intentId: value('buyer-intent'),
    acceptIndex: Number(value('payment-option')), offerSha256: buyerReview.offerSha256 });
  $('buyer-selection').value = result.result.buyer.id; renderControls();
});
$('buyer-selection').addEventListener('change', renderControls);
button('download-buyer', () => download('publisher:buyer-config', value('buyer-selection')));
button('create-session', async () => {
  const result = await perform('publisher.buyer.session', { buyerId: value('buyer-selection'), workspaceDirectory: value('buyer-workspace'),
    maxPages: Number(value('max-pages')), maxTotalAtomic: value('max-total'), maxRows: Number(value('max-rows')) });
  $('session-selection').value = result.result.id; $('session-result').textContent = json(result.result); renderControls();
});
$('session-selection').addEventListener('change', renderControls);
for (const [id, action] of [['run-session','run'],['recover-session','recover'],['account-session','account'],['export-session','export']])
  button(id, async () => { const result = await perform('publisher.buyer.' + action, { id: value('session-selection') }); $('session-result').textContent = json(result.result); });
button('download-session', () => download('publisher:session-manifest', value('session-selection')));
handle(async () => { await refresh(); renderBuyerReview(); notice('Choose or reopen the retained address batch.'); });
