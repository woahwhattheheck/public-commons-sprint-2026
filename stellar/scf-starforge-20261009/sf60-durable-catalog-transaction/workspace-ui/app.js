/* MIT. No third-party scripts. Native catalog results are rendered as text. */
'use strict';
const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
const pages = ['catalog', 'admit', 'withdraw', 'operations'];
let token = '', tab = 'catalog', status, page, offset = 0, cursors = [null], searchPage = 0;
let filters = { query: '', network: '', type: '' }, chosen, reviewed, withdrawal, operationsOffset = 0;
let catalogGeneration = 0, detailGeneration = 0, operationGeneration = 0, operationsTotal = 0;
try {
  const fragment = location.hash.slice(1);
  if (/^[a-f0-9]{64}$/.test(fragment)) { sessionStorage.setItem('catalog-workspace-session', fragment); history.replaceState(null, '', location.pathname); }
  token = sessionStorage.getItem('catalog-workspace-session') || '';
} catch { /* The private launch link remains usable without storage. */
  token = location.hash.slice(1); history.replaceState(null, '', location.pathname);
}
function notice(message = '') { $('notice').hidden = !message; $('notice').textContent = message; }
function showError(error) {
  notice(error.message === 'WORKSPACE_SESSION_REQUIRED'
    ? 'This browser session is not connected. Reopen the URL from the current private launch file; do not paste it into chat or share it.'
    : error.message === 'REQUEST_FAILED'
      ? 'The native request failed. Refresh the catalog or inspect the retained operation before trying a new operation.'
      : error.message);
}
async function api(path, body) {
  let response;
  try { response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Workspace-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', credentials: 'omit' }); }
  catch { throw Error('Connection interrupted. Reopen Operations to recover the saved result. Do not submit a new copy of an uncertain operation.'); }
  let value;
  try { value = await response.json(); } catch { throw Error('The server response was incomplete. Inspect the saved operation before submitting anything again.'); }
  if (!response.ok) throw Error(value.error || `HTTP_${response.status}`);
  return value;
}
function action(button, fn) {
  button.addEventListener('click', async event => {
    event.preventDefault(); if (button.disabled) return;
    button.disabled = true; notice('');
    try { await fn(); } catch (error) { showError(error); }
    finally { button.disabled = false; syncReviewButtons(); }
  });
}
function form(id, fn) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault(); const button = $(id).querySelector('button[type=submit], button:not([type])');
    if (button.disabled) return;
    button.disabled = true; notice('');
    try { await fn(); } catch (error) { showError(error); }
    finally { button.disabled = false; syncReviewButtons(); }
  });
}
function el(tag, text, className) {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
}
function detailList(target, pairs) {
  target.replaceChildren();
  for (const [name, value] of pairs) { target.append(el('dt', name), el('dd', value === undefined || value === null ? '—' : String(value))); }
}
function download(name, document) {
  const url = URL.createObjectURL(new Blob([pretty(document) + '\n'], { type: 'application/json' }));
  const a = el('a'); a.href = url; a.download = name; documentBody().append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function documentBody() { return window.document.body; }
function setTab(next) {
  tab = next;
  for (const name of pages) $('tab-' + name).hidden = name !== next;
  document.querySelectorAll('[data-tab]').forEach(button => {
    if (button.dataset.tab === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}
function setSellers(select, sellers) {
  const previous = select.value;
  select.replaceChildren(...sellers.map(seller => { const option = el('option', seller.sellerId); option.value = seller.sellerId; return option; }));
  if (sellers.some(seller => seller.sellerId === previous)) select.value = previous;
}
async function refreshStatus() {
  status = await api('/api/status');
  $('connection').textContent = 'Connected / local';
  $('active-count').textContent = status.activeResources;
  $('commit-count').textContent = status.committedOperations;
  $('seller-count').textContent = status.sellers.length;
  $('journal-head').textContent = status.journalHead;
  $('journal-head').title = status.journalHead;
  setSellers($('admit-seller'), status.sellers); setSellers($('withdraw-seller'), status.sellers);
}
function queryString() {
  const params = new URLSearchParams({ limit: '20' });
  for (const key of ['network', 'type']) if (filters[key]) params.set(key, filters[key]);
  if (filters.query) {
    params.set('query', filters.query);
    if (cursors[searchPage]) params.set('cursor', cursors[searchPage]);
  } else params.set('offset', String(offset));
  return params;
}
async function loadCatalog() {
  const generation = ++catalogGeneration;
  $('page-state').textContent = 'Loading…';
  const result = await api('/api/' + (filters.query ? 'search?' : 'list?') + queryString());
  if (generation !== catalogGeneration) return;
  page = result; const rows = $('catalog-rows'); rows.replaceChildren();
  for (const entry of page.resources) {
    const tr = el('tr'), resource = el('td'), input = entry.extensions?.bazaar?.info?.input ?? {};
    resource.append(el('div', entry.resource?.serviceName || entry.resource?.description || 'Unnamed resource', 'title'), el('div', entry.resource?.url || '', 'small'));
    if (entry.resource?.tags?.length) resource.append(el('div', entry.resource.tags.join(' / '), 'small'));
    const method = el('td', input.type === 'mcp' ? input.toolName : input.method);
    const terms = el('td');
    for (const accept of entry.accepts ?? []) terms.append(el('span', `${accept.network} · ${accept.amount ?? accept.maxAmountRequired ?? '—'} atomic · ${accept.scheme}`, 'term'));
    const controls = el('td'), button = el('button', 'Inspect'); button.className = 'secondary';
    action(button, () => inspectResource(entry.catalogKey, entry)); controls.append(button);
    tr.append(resource, method, terms, controls); rows.append(tr);
  }
  if (!page.resources.length) { const td = el('td', 'No resources match the current view.', 'empty'); td.colSpan = 4; const tr = el('tr'); tr.append(td); rows.append(tr); }
  if (filters.query) {
    $('page-state').textContent = `Search page ${searchPage + 1} · ${page.resources.length} resources${page.partialResults ? ' · more results' : ''}`;
    $('previous-page').disabled = searchPage === 0; $('next-page').disabled = !page.pagination.cursor;
  } else {
    $('page-state').textContent = `${page.resources.length ? offset + 1 : 0}–${offset + page.resources.length} of ${page.pagination.total} resources`;
    $('previous-page').disabled = offset === 0; $('next-page').disabled = offset + 20 >= page.pagination.total;
  }
}
async function inspectResource(key, entry) {
  const generation = ++detailGeneration;
  const lookup = await api('/api/lookup?' + new URLSearchParams({ key }));
  const history = lookup.current?.lifecycleId ? await api('/api/history?' + new URLSearchParams({ id: lookup.current.lifecycleId })) : null;
  if (generation !== detailGeneration) return;
  chosen = { catalogKey: key, entry: entry ?? null, lookup, history };
  detailList($('resource-summary'), [['Catalog key', key], ['Seller', lookup.current?.sellerId], ['Sequence', lookup.current?.sequence], ['Lifecycle ID', lookup.current?.lifecycleId], ['Retired', lookup.current ? String(lookup.current.retired) : 'No record']]);
  $('resource-json').textContent = pretty({ ...(entry ? { resource: entry } : {}), ...lookup });
  $('history-json').textContent = pretty(history);
  $('use-withdrawal').disabled = !lookup.current || lookup.current.retired;
  $('catalog-detail').hidden = false; $('catalog-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function fileBytes(id, max) {
  const file = $(id).files[0];
  if (!file || file.size < 1 || file.size > max) throw Error(`Choose a nonempty ${id === 'offer-file' ? 'declaration' : 'JSON'} file no larger than ${Math.floor(max / 1024)} KiB.`);
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) };
}
function parseJSON(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Error(`${label} must be valid UTF-8 JSON.`); }
}
function base64(bytes) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function showFileInfo() {
  const parts = [];
  for (const [id, max] of [['offer-file', 65536], ['proofs-file', 384 * 1024]]) {
    if (!$(id).files.length) continue;
    const { file, bytes } = await fileBytes(id, max);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    parts.push(`${file.name} · ${bytes.length.toLocaleString()} bytes\nSHA-256 ${digest}`);
  }
  $('files-info').textContent = parts.join('\n\n') || 'No files selected. Never upload seller private keys.';
}
function syncReviewButtons() {
  if (page) {
    $('previous-page').disabled = filters.query ? searchPage === 0 : offset === 0;
    $('next-page').disabled = filters.query ? !page.pagination.cursor : offset + 20 >= page.pagination.total;
  }
  $('operations-prev').disabled = operationsOffset === 0;
  $('operations-next').disabled = operationsOffset + 20 >= operationsTotal;
  if (!reviewed) return;
  $('execute-operation').hidden = reviewed.phase !== 'prepared';
  $('reconcile-operation').hidden = reviewed.phase === 'prepared' || !['admit', 'apply-withdrawal'].includes(reviewed.operation);
  $('inspect-operation').hidden = !['unknown', 'rejected', 'succeeded', 'sending'].includes(reviewed.phase);
}
function showReview(record) {
  reviewed = record;
  CatalogRevisionUI.renderReview($('revision-comparison'), record.revisionReview);
  CatalogRevisionUI.renderReconciliation($('reconciliation-panel'), record.reconciliation);
  $('review-title').textContent = record.operation === 'admit' ? 'Offer admission / revision' : 'Signed withdrawal';
  $('review-phase').textContent = record.phase.toUpperCase();
  const explanations = {
    prepared: 'Compare the original declaration, seller, source, and sequence below. Submit sends this exact saved intent once to the original catalog operator. Signature verification has not yet been performed.',
    sending: 'A command may have been sent. Refresh Operations to recover its outcome. It will not be sent again from this record.',
    succeeded: 'The original operator returned success. Its complete response is retained below. This catalog operation is not a payment or customer transaction.',
    rejected: 'The native request was rejected or failed before a complete send. Inspect the exact error and current catalog. This record will not be automatically retried.',
    unknown: 'The command may have reached the writer, but its outcome is not known. Inspect the current catalog and lifecycle history before preparing anything new. This record cannot be resubmitted.',
  };
  $('review-explanation').textContent = explanations[record.phase] + (record.persistenceError ? ' WARNING: The latest outcome could not be saved to disk. Export this operation now.' : '');
  detailList($('review-summary'), [['Operation ID', record.id], ['Intent SHA-256', record.digest], ['Seller', record.summary.sellerId], ['Sequence', record.summary.sequence ?? record.summary.request?.sequence], ['Catalog key', record.summary.catalogKey], ['Original source SHA-256', record.summary.sourceSha256], ['Created', record.createdAt], ['Updated', record.updatedAt], ['Policy SHA-256', record.policySha256]]);
  $('review-input').textContent = pretty({ ...record.summary, ...(record.operation === 'apply-withdrawal' ? { envelope: record.input.envelope } : { proofs: record.input.proofs }) });
  $('result-section').hidden = record.phase === 'prepared';
  $('review-result').textContent = pretty({ phase: record.phase, result: record.result ?? null, error: record.error ?? null, persistenceError: record.persistenceError ?? null });
  $('operation-inspection').hidden = true; $('review-panel').hidden = false; syncReviewButtons();
  $('review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadOperations() {
  const generation = ++operationGeneration;
  const result = await api('/api/operations?' + new URLSearchParams({ offset: String(operationsOffset), limit: '20' }));
  if (generation !== operationGeneration) return;
  operationsTotal = result.total;
  const rows = $('operation-rows'); rows.replaceChildren();
  for (const record of result.items) {
    const tr = el('tr'), created = el('td', new Date(record.createdAt).toLocaleString());
    const type = el('td'); type.append(el('div', record.operation, 'title'), el('div', record.summary.sellerId || '', 'small'));
    const state = el('td'); state.append(el('span', record.phase, 'badge'));
    if (record.reconciliation) state.append(el('div', record.reconciliation === 'MATCHING_ORIGINAL_REVISION_PRESENT' ? 'Matching revision found' : 'No matching revision observed', 'small'));
    const controls = el('td'), button = el('button', record.phase === 'prepared' ? 'Review' : 'Open', 'secondary');
    action(button, async () => showReview(await api('/api/operations/' + record.id))); controls.append(button);
    tr.append(created, type, state, controls); rows.append(tr);
  }
  if (!result.items.length) { const tr = el('tr'), td = el('td', 'No saved operations. Reviews and outcomes appear here without changing the catalog.', 'empty'); td.colSpan = 4; tr.append(td); rows.append(tr); }
  $('operations-state').textContent = `${result.items.length ? operationsOffset + 1 : 0}–${operationsOffset + result.items.length} of ${result.total} operations`;
  $('operations-prev').disabled = operationsOffset === 0; $('operations-next').disabled = operationsOffset + 20 >= result.total;
}

action($('reconcile-operation'), async () => {
  if (!reviewed) return;
  const id = reviewed.id, digest = reviewed.digest;
  const record = await api('/api/operations/' + id + '/reconcile', { digest });
  if (reviewed?.id === id) showReview(record);
  if (tab === 'operations') await loadOperations();
});

document.querySelectorAll('[data-tab]').forEach(button => action(button, async () => { setTab(button.dataset.tab); if (tab === 'operations') await loadOperations(); if (tab === 'catalog') { offset = 0; cursors = [null]; searchPage = 0; await loadCatalog(); } }));
action($('refresh'), async () => { await refreshStatus(); if (tab === 'catalog') { offset = 0; cursors = [null]; searchPage = 0; await loadCatalog(); } if (tab === 'operations') await loadOperations(); });
form('search-form', async () => { filters = { query: $('query').value.trim(), network: $('network').value.trim(), type: $('type').value }; offset = 0; cursors = [null]; searchPage = 0; await loadCatalog(); });
action($('clear-search'), async () => { $('search-form').reset(); filters = { query: '', network: '', type: '' }; offset = 0; cursors = [null]; searchPage = 0; await loadCatalog(); });
action($('previous-page'), async () => { if (filters.query) searchPage = Math.max(0, searchPage - 1); else offset = Math.max(0, offset - 20); await loadCatalog(); });
action($('next-page'), async () => { if (filters.query) { if (!page?.pagination.cursor) return; cursors[++searchPage] = page.pagination.cursor; } else offset += 20; await loadCatalog(); });
action($('export-page'), () => { if (page) download('catalog-page.json', { filters, ...page }); });
form('lookup-form', () => inspectResource($('lookup-key').value));
action($('close-detail'), () => { $('catalog-detail').hidden = true; detailGeneration++; });
action($('export-detail'), () => { if (chosen) download('catalog-inspection.json', chosen); });
action($('use-withdrawal'), () => {
  if (!chosen?.lookup.current) return;
  $('withdraw-seller').value = chosen.lookup.current.sellerId;
  $('withdraw-key').value = chosen.catalogKey;
  $('withdraw-url').value = chosen.entry?.resource?.url ?? '';
  setTab('withdraw'); $('withdraw-reason').focus();
});
for (const id of ['offer-file', 'proofs-file']) $(id).addEventListener('change', () => showFileInfo().catch(showError));
form('admit-form', async () => {
  const sequence = $('sequence').value;
  if (!/^[1-9][0-9]*$/.test(sequence) || !Number.isSafeInteger(Number(sequence))) throw Error('Use a positive safe integer seller sequence.');
  const offer = await fileBytes('offer-file', 65536), proofs = await fileBytes('proofs-file', 384 * 1024);
  parseJSON(offer.bytes, 'Declaration');
  const record = await api('/api/review', { operation: 'admit', input: { sellerId: $('admit-seller').value,
    sequence: Number(sequence), sourceURL: $('source-url').value, observedAt: $('observed-at').value,
    sourceBase64: base64(offer.bytes), proofs: parseJSON(proofs.bytes, 'Proofs') } });
  showReview(record);
});
form('withdraw-form', async () => {
  withdrawal = await api('/api/prepare-withdrawal', { sellerId: $('withdraw-seller').value, catalogKey: $('withdraw-key').value,
    sourceURL: $('withdraw-url').value, reason: $('withdraw-reason').value });
  $('withdrawal-json').textContent = pretty(withdrawal); $('prepared-withdrawal').hidden = false;
  download('withdrawal-request.json', withdrawal); notice('Original head-bound request prepared. Sign it with the existing seller signer; no listing has been withdrawn.');
});
action($('download-withdrawal'), () => { if (withdrawal) download('withdrawal-request.json', withdrawal); });
form('envelope-form', async () => {
  const envelope = await fileBytes('envelope-file', 128 * 1024);
  showReview(await api('/api/review', { operation: 'apply-withdrawal', input: { envelope: parseJSON(envelope.bytes, 'Envelope') } }));
});
action($('execute-operation'), async () => {
  if (!reviewed || reviewed.phase !== 'prepared') return;
  const saved = reviewed;
  // Optimistic display disables the sole send action even if browser transport
  // ends before the daemon responds. The durable record determines the outcome.
  showReview({ ...saved, phase: 'sending' });
  try {
    showReview(await api('/api/execute', { id: saved.id, digest: saved.digest }));
  } catch (error) {
    try { showReview(await api('/api/operations/' + saved.id)); } catch { /* Keep sending/unknown display. */ }
    throw error;
  }
  await refreshStatus();
  if (tab === 'catalog') await loadCatalog();
  if (tab === 'operations') await loadOperations();
});
action($('inspect-operation'), async () => {
  if (!reviewed) return;
  const id = reviewed.id;
  const result = await api('/api/operations/' + id + '/inspect');
  if (reviewed?.id !== id) return;
  $('inspection-json').textContent = pretty(result); CatalogRevisionUI.renderReconciliation($('reconciliation-panel'), result.reconciliation); $('operation-inspection').hidden = false;
});
action($('export-operation'), () => { if (reviewed) download(`catalog-operation-${reviewed.id}.json`, reviewed); });
action($('close-review'), () => { $('review-panel').hidden = true; });
action($('refresh-operations'), loadOperations);
action($('operations-prev'), async () => { operationsOffset = Math.max(0, operationsOffset - 20); await loadOperations(); });
action($('operations-next'), async () => { operationsOffset += 20; await loadOperations(); });
(async () => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('WORKSPACE_SESSION_REQUIRED');
  await refreshStatus(); await loadCatalog();
})().catch(error => { $('connection').textContent = 'Not connected'; showError(error); });
