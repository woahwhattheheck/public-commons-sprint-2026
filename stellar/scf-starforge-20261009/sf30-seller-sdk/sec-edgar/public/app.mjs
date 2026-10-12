const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const formatDate = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const split = value => value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
const compact = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
let state = null, draft = null, draftRevision = null, selectedProduct = -1, selectedCapture = null, captureDetails = null;
let dirty = false, editorDirty = false, jsonDirty = false, busy = false, preview = null, previewQuery = null, previewProduct = null;
const hasEdits = () => dirty || editorDirty || jsonDirty;

function notice(message, isError = false) { $('notice').textContent = message; $('notice').classList.toggle('error', isError); }
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
async function api(path, options = {}) {
  const request = { credentials: 'same-origin', ...options };
  if (options.json !== undefined) { request.body = JSON.stringify(options.json); request.headers = { ...request.headers, 'content-type': 'application/json' }; delete request.json; }
  const response = await fetch(path, request);
  if (!response.ok) {
    let detail; try { detail = await response.json(); } catch {}
    const issue = detail?.error;
    const message = typeof issue === 'object' ? issue.message ?? issue.code : issue;
    const cause = Object.assign(new Error(message || 'The workspace could not complete this request.'), { status: response.status, code: issue?.code });
    if (response.status === 401) { $('unlock').hidden = false; $('desk').hidden = true; }
    throw cause;
  }
  return options.raw ? response : response.json();
}
async function run(label, action) {
  if (busy) return;
  busy = true; $('desk').inert = true; $('unlock').inert = true; document.body.setAttribute('aria-busy', 'true'); notice(label);
  try { await action(); }
  catch (cause) { notice(cause.message, true); }
  finally { busy = false; $('desk').inert = false; $('unlock').inert = false; document.body.removeAttribute('aria-busy'); updateDirty(); }
}
function updateDirty() {
  $('save').disabled = !state || busy || !hasEdits();
  $('product-local-state').textContent = hasEdits() ? 'Unsaved changes' : 'Saved draft';
  $('handoff-dirty').textContent = hasEdits() ? 'Save the draft to include your current edits in the exports.' : '';
  $('draft-recovery-state').textContent = state && draftRevision !== state.revision
    ? 'Your edits started at revision ' + draftRevision + '. The saved workspace is now revision ' + state.revision + '. Download your local draft, then load the saved draft to reconcile the changes.'
    : 'Loading the saved draft replaces local edits. Download your local draft first to keep a copy.';
}
function changed() { dirty = true; updateDirty(); }
function tab(name) {
  document.querySelectorAll('.tab-panel').forEach(node => { node.hidden = node.id !== 'tab-' + name; });
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (name === 'handoff') renderHandoff();
  if (name === 'history') run('Loading saved revisions…', loadHistory);
}
function editions() { return state?.editions ?? []; }
function capture(id) { return editions().find(item => item.id === id); }
function titleFor(record) { return (record.entityName || 'CIK ' + record.cik) + ' · ' + (record.kind === 'facts' ? 'Facts' : 'Filings'); }
function newDraft() { return { schema: 'stellar-forge.sec-edgar-merchant.v1', title: 'SEC EDGAR merchant', publicOrigin: 'https://merchant.example', products: [] }; }

async function refresh({ replaceDraft = false, message = 'Saved workspace loaded.' } = {}) {
  const latest = await api('/api/state');
  state = latest;
  if (!draft || replaceDraft || !hasEdits()) {
    draft = clone(state.config ?? newDraft()); draftRevision = state.revision; dirty = false; editorDirty = false; jsonDirty = false;
    selectedProduct = draft.products.length ? Math.max(0, Math.min(selectedProduct, draft.products.length - 1)) : -1;
    $('merchant-title').value = draft.title; $('merchant-origin').value = draft.publicOrigin;
  }
  $('unlock').hidden = true; $('desk').hidden = false;
  $('revision').textContent = 'Revision ' + state.revision;
  $('edition-count').textContent = editions().length.toLocaleString();
  $('product-count').textContent = (state.config?.products.length ?? 0).toLocaleString();
  $('source-count').textContent = new Set(state.config?.products.map(item => item.editionId) ?? []).size.toLocaleString();
  $('saved-at').textContent = formatDate(state.updatedAt);
  $('capture-total').textContent = editions().length + ' editions';
  renderEditions(); renderProducts();
  if (!editorDirty) await renderEditor();
  renderHandoff(); updateJson(); updateDirty(); notice(message);
}
function renderEditions() {
  const newSelect = $('new-product-edition'), prior = newSelect.value;
  newSelect.replaceChildren(new Option('Choose a capture', ''));
  for (const record of editions()) newSelect.add(new Option(titleFor(record) + ' · ' + record.id, record.id));
  if (capture(prior)) newSelect.value = prior; else if (editions().length === 1) newSelect.value = editions()[0].id;
  const list = $('capture-list'); list.replaceChildren();
  if (!editions().length) list.append(element('p', 'No captures have been imported yet.', 'empty-inline'));
  for (const record of editions()) {
    const button = element('button', undefined, 'item' + (record.id === selectedCapture ? ' active' : ''));
    button.type = 'button'; button.append(element('strong', titleFor(record)), element('span', record.id + ' · ' + record.recordCount.toLocaleString() + ' records'), element('span', formatDate(record.capturedAt)));
    button.addEventListener('click', () => run('Opening source edition…', () => showCapture(record.id))); list.append(button);
  }
}
async function showCapture(id) {
  const detail = await api('/api/editions/' + encodeURIComponent(id)); selectedCapture = id; renderEditions();
  const holder = $('capture-detail'), record = detail.record; holder.hidden = false; holder.className = 'capture-detail'; holder.replaceChildren();
  holder.append(element('h3', titleFor(record)));
  const dl = element('dl', undefined, 'meta-grid');
  for (const [label, value] of [['Edition', record.id], ['CIK', record.cik], ['Captured', formatDate(record.capturedAt)], ['Records', record.recordCount.toLocaleString()], ['Source bytes', record.sourceBytes.toLocaleString()], ['SHA-256', record.sourceSha256]]) {
    dl.append(element('dt', label), element('dd', value, label === 'SHA-256' ? 'mono' : undefined));
  }
  const link = element('a', record.sourceUrl); link.href = record.sourceUrl; link.target = '_blank'; link.rel = 'noreferrer';
  dl.append(element('dt', 'SEC source'), element('dd')); dl.lastElementChild.append(link); holder.append(dl);
  const available = record.kind === 'facts' ? detail.concepts.length + ' concepts in this edition' : (detail.forms.length ? 'Forms: ' + detail.forms.join(', ') : 'No forms in this edition');
  holder.append(element('p', available, 'help'));
  if (record.historyFiles?.length) holder.append(element('p', record.historyFiles.length + ' additional filing-history files are referenced by the original SEC response.', 'help'));
  const actions = element('div', undefined, 'form-actions');
  const raw = element('button', 'Download original JSON'); raw.type = 'button'; raw.addEventListener('click', () => run('Downloading original capture…', async () => { await download('/api/editions/' + encodeURIComponent(id) + '/raw', id + '-source.json'); notice('Original source downloaded.'); }));
  const add = element('button', 'Create product from this capture', 'primary'); add.type = 'button'; add.addEventListener('click', () => run('Creating product draft…', async () => { await addProduct(id); tab('products'); }));
  actions.append(raw, add); holder.append(actions); notice('Original capture and available fields loaded.');
}
function renderProducts() {
  const list = $('product-list'); list.replaceChildren();
  if (!draft.products.length) list.append(element('p', 'Your draft has no data products.', 'empty-inline'));
  draft.products.forEach((product, index) => {
    const button = element('button', undefined, 'item' + (index === selectedProduct ? ' active' : ''));
    button.type = 'button'; button.append(element('strong', product.id), element('span', product.kind + ' · CIK ' + product.cik), element('span', product.path));
    button.addEventListener('click', () => run('Opening product…', async () => { commitEditor(); selectedProduct = index; renderProducts(); await renderEditor(); notice('Product loaded.'); }));
    list.append(button);
  });
}
function objectJson(text, label, array = false) {
  let value; try { value = JSON.parse(text); } catch { throw new Error(label + ' contains invalid JSON.'); }
  if (array ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + (array ? ' must be an array.' : ' must be an object.'));
  return value;
}
function commitEditor() {
  if (!draft) return;
  draft.title = $('merchant-title').value.trim(); draft.publicOrigin = $('merchant-origin').value.trim();
  if (selectedProduct < 0 || !editorDirty) return;
  const current = draft.products[selectedProduct], record = capture($('product-edition').value);
  if (!record) throw new Error('Choose an available source capture for this product.');
  const id = $('product-id').value.trim();
  if (draft.products.some((item, index) => index !== selectedProduct && item.id === id)) throw new Error('Each product needs a unique ID.');
  draft.products[selectedProduct] = { ...current, id, path: $('product-path').value.trim(), description: $('product-description').value.trim(),
    editionId: record.id, sourceSha256: record.sourceSha256, cik: record.cik, kind: record.kind,
    concepts: record.kind === 'facts' ? [...new Set(split($('product-concepts').value))] : [],
    forms: [...new Set(split($('product-forms').value))], maxPageSize: Number($('product-page-size').value),
    paymentOptions: objectJson($('product-payments').value, 'Payment options', true), example: objectJson($('product-example').value, 'Example query') };
  editorDirty = false; changed(); renderProducts(); updateJson();
}
async function renderEditor() {
  const product = draft.products[selectedProduct];
  $('product-empty').hidden = Boolean(product); $('product-card').hidden = !product; $('preview-card').hidden = !product;
  if (!product) return;
  $('product-heading').textContent = product.id;
  for (const [id, value] of [['product-id', product.id], ['product-path', product.path], ['product-description', product.description ?? ''], ['product-concepts', (product.concepts ?? []).join('\n')], ['product-forms', (product.forms ?? []).join(', ')], ['product-page-size', product.maxPageSize ?? 100], ['product-payments', JSON.stringify(product.paymentOptions ?? [], null, 2)], ['product-example', JSON.stringify(product.example ?? { limit: '25' }, null, 2)]]) $(id).value = value;
  const select = $('product-edition'); select.replaceChildren();
  for (const record of editions()) select.add(new Option(titleFor(record) + ' · ' + record.id, record.id));
  select.value = product.editionId;
  $('concept-search').value = ''; editorDirty = false;
  await renderProductSource(product.editionId);
  const query = product.example ?? {};
  for (const [key, id] of queryFields) $(id).value = query[key] ?? (key === 'limit' ? '25' : '');
  if (product.kind === 'facts' && !query.concept && product.concepts?.length === 1) {
    const [taxonomy, concept] = product.concepts[0].split(':'); $('query-taxonomy').value = taxonomy; $('query-concept').value = concept;
  }
  resetPreview(); updateDirty();
}
async function renderProductSource(id) {
  const record = capture(id);
  if (!record) {
    captureDetails = null; renderConcepts();
    $('product-source').textContent = 'Import the expected source edition ' + id + ' to use this product.';
    return;
  }
  $('facts-fields').hidden = record.kind !== 'facts';
  document.querySelectorAll('.facts-query').forEach(node => { node.hidden = record.kind !== 'facts'; });
  $('product-source').replaceChildren(element('strong', titleFor(record)), document.createTextNode(' · ' + record.recordCount.toLocaleString() + ' records'), element('br'), element('code', record.sourceSha256));
  captureDetails = await api('/api/editions/' + encodeURIComponent(id)); renderConcepts();
}
function renderConcepts() {
  const list = $('concept-picker'), search = $('concept-search').value.trim().toLowerCase(); list.replaceChildren();
  const all = captureDetails?.concepts ?? [], filtered = all.filter(row => !search || [row.taxonomy, row.concept, row.label].join(' ').toLowerCase().includes(search));
  for (const row of filtered.slice(0, 250)) list.add(new Option(row.taxonomy + ':' + row.concept + (row.label ? ' — ' + row.label : ''), row.taxonomy + ':' + row.concept));
  $('concept-count').textContent = Math.min(250, filtered.length).toLocaleString() + ' shown · ' + filtered.length.toLocaleString() + ' matching concepts';
}
async function addProduct(id) {
  commitEditor(); const record = capture(id); if (!record) throw new Error('Import and select a source capture first.');
  const label = (record.entityName || 'issuer_' + record.cik).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const base = (/^[a-z]/.test(label) ? label : 'issuer_' + label).slice(0, 48) + '_' + record.kind;
  let productId = base, suffix = 2; while (draft.products.some(item => item.id === productId)) productId = base + '_' + suffix++;
  const detail = await api('/api/editions/' + encodeURIComponent(id));
  const preferred = detail.concepts?.find(item => item.taxonomy === 'us-gaap' && item.concept === 'Assets') ?? detail.concepts?.[0];
  const paymentOptions = clone(draft.products[selectedProduct]?.paymentOptions ?? draft.products[0]?.paymentOptions ?? []);
  draft.products.push({ id: productId, path: '/data/' + productId, kind: record.kind, cik: record.cik,
    editionId: record.id, sourceSha256: record.sourceSha256, description: titleFor(record),
    concepts: record.kind === 'facts' && preferred ? [preferred.taxonomy + ':' + preferred.concept] : [],
    forms: [], maxPageSize: 100, paymentOptions, example: { limit: '25' } });
  selectedProduct = draft.products.length - 1; changed(); renderProducts(); await renderEditor(); updateJson();
  notice('Product added to your draft. Set its payment terms and save the draft when ready.');
}
function updateJson() { if (draft && !jsonDirty) $('merchant-json').value = JSON.stringify(draft, null, 2); }
function resetPreview() { preview = null; previewQuery = null; previewProduct = null; $('next-page').disabled = true; $('download-preview').disabled = true; $('preview-count').textContent = ''; $('preview-table').replaceChildren(element('p', 'Run a preview to inspect the selected rows.', 'empty-inline')); }
const queryFields = [['taxonomy', 'query-taxonomy'], ['concept', 'query-concept'], ['unit', 'query-unit'], ['form', 'query-form-value'], ['accession', 'query-accession'], ['limit', 'query-limit'], ['filedFrom', 'query-filed-from'], ['filedTo', 'query-filed-to'], ['periodFrom', 'query-period-from'], ['periodTo', 'query-period-to']];
function queryInput() {
  const product = draft.products[selectedProduct], values = {};
  for (const [key, id] of queryFields) {
    if (product.kind !== 'facts' && ['taxonomy', 'concept', 'unit', 'periodFrom', 'periodTo'].includes(key)) continue;
    const value = $(id).value.trim(); if (value) values[key] = value;
  }
  return values;
}
function table(rows, holder, preferred = []) {
  holder.replaceChildren();
  if (!rows.length) { holder.append(element('p', 'No records match this selection.', 'empty-inline')); return; }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const columns = [...preferred.filter(key => keys.includes(key)), ...keys.filter(key => !preferred.includes(key))];
  const grid = element('table'), head = element('thead'), heading = element('tr'), body = element('tbody');
  for (const key of columns) heading.append(element('th', key)); head.append(heading); grid.append(head);
  for (const row of rows) {
    const tr = element('tr');
    for (const key of columns) {
      const text = compact(row[key]), cell = element('td', text);
      if (key === 'value' || key === 'val') cell.className = 'number mono'; else if (text.length > 70) cell.className = 'long';
      tr.append(cell);
    }
    body.append(tr);
  }
  grid.append(body); holder.append(grid);
}
async function requestPreview(next = false) {
  commitEditor(); const product = draft.products[selectedProduct]; if (!product) throw new Error('Choose a data product.');
  const query = next ? { ...previewQuery, cursor: preview.nextCursor } : queryInput();
  if (next && (previewProduct !== product.id || !preview?.nextCursor)) throw new Error('Run this product preview again before continuing.');
  const result = await api('/api/query', { method: 'POST', json: { productId: product.id, config: draft, query } });
  preview = result; previewQuery = { ...query }; delete previewQuery.cursor; previewProduct = product.id;
  table(result.rows, $('preview-table'), product.kind === 'facts' ? ['taxonomy', 'concept', 'value', 'valueType', 'unit', 'start', 'end', 'form', 'filed', 'accession'] : ['filed', 'form', 'accession', 'reportDate', 'primaryDocument']);
  $('preview-count').textContent = result.totalReturned.toLocaleString() + ' shown / ' + result.totalMatched.toLocaleString() + ' matching';
  $('next-page').disabled = !result.nextCursor; $('download-preview').disabled = false;
  notice('Selection loaded from the retained source edition.');
}
function saveBlob(blob, filename) { const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
async function download(path, filename) { const response = await api(path, { raw: true }); saveBlob(await response.blob(), filename); }
function renderHandoff() {
  $('handoff-revision').textContent = state ? 'Saved revision ' + state.revision : '';
  const holder = $('handoff-products'); holder.replaceChildren();
  const config = state?.config;
  document.querySelectorAll('[data-download]').forEach(button => { button.disabled = !config; });
  if (!config) { holder.append(element('p', 'Save a merchant configuration to prepare the buyer handoff.', 'empty-inline')); return; }
  for (const product of config.products) {
    const card = element('article', undefined, 'handoff-item'); card.append(element('h3', product.id), element('p', product.description ?? ''));
    const url = new URL(product.path, config.publicOrigin);
    for (const [key, value] of Object.entries(product.example ?? {})) url.searchParams.set(key, String(value));
    card.append(element('div', 'GET ' + url.href, 'url'), element('p', 'Edition ' + product.editionId + ' · CIK ' + product.cik), element('p', 'SHA-256 ' + product.sourceSha256, 'mono'));
    holder.append(card);
  }
  updateDirty();
}
async function loadHistory() {
  const result = await api('/api/revisions'); table(result.revisions, $('history-table'), ['revision', 'updatedAt', 'action', 'products', 'configSha256']);
  $('restore-revision').replaceChildren();
  for (const row of result.revisions) if (row.products) $('restore-revision').add(new Option('Revision ' + row.revision + ' · ' + formatDate(row.updatedAt), row.revision));
  $('restore').disabled = !$('restore-revision').options.length;
  notice(result.hasMore ? 'Showing the 50 most recent saved revisions.' : 'Saved revision history loaded.');
}
async function applyJson(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.products)) throw new Error('The merchant configuration needs a products array.');
  if (value.products.some(product => !product || typeof product !== 'object' || !['id', 'editionId', 'path'].every(key => typeof product[key] === 'string')))
    throw new Error('Each product needs an ID, source edition and request path.');
  draft = clone(value); selectedProduct = draft.products.length ? 0 : -1; editorDirty = false; jsonDirty = false; changed();
  $('merchant-title').value = draft.title ?? ''; $('merchant-origin').value = draft.publicOrigin ?? '';
  renderProducts(); await renderEditor(); updateJson(); notice('Configuration loaded into your local draft. Save to retain the revision.');
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.openTab)));
$('unlock-form').addEventListener('submit', event => { event.preventDefault(); run('Opening session…', async () => { await api('/api/session', { method: 'POST', json: { key: $('access-key').value } }); $('access-key').value = ''; await refresh({ replaceDraft: true }); }); });
$('refresh').addEventListener('click', () => run('Refreshing saved state…', async () => {
  await refresh({ message: hasEdits() ? 'Saved state refreshed. Your local draft and its starting revision are retained.' : 'Saved workspace loaded.' });
}));
$('save').addEventListener('click', () => run('Saving retained draft…', async () => {
  if (jsonDirty) throw new Error('Apply your edited merchant JSON to the draft before saving.');
  commitEditor(); const result = await api('/api/draft', { method: 'PUT', json: { expectedRevision: draftRevision, config: draft } });
  await refresh({ replaceDraft: true, message: result.unchanged ? 'This exact draft is already saved.' : 'Draft saved as revision ' + result.revision + '.' });
}));
for (const id of ['merchant-title', 'merchant-origin']) $(id).addEventListener('input', () => { draft[id === 'merchant-title' ? 'title' : 'publicOrigin'] = $(id).value; changed(); updateJson(); });
$('product-form').addEventListener('input', event => { if (event.target.id === 'concept-search') return; editorDirty = true; $('next-page').disabled = true; updateDirty(); });
$('product-form').addEventListener('submit', event => { event.preventDefault(); run('Applying product changes…', async () => { commitEditor(); resetPreview(); notice('Product changes applied to your draft.'); }); });
$('product-edition').addEventListener('change', () => run('Opening selected capture…', async () => { editorDirty = true; await renderProductSource($('product-edition').value); resetPreview(); notice('Source edition selected.'); }));
$('concept-search').addEventListener('input', renderConcepts);
$('add-concepts').addEventListener('click', () => { $('product-concepts').value = [...new Set([...split($('product-concepts').value), ...[...$('concept-picker').selectedOptions].map(item => item.value)])].join('\n'); editorDirty = true; $('next-page').disabled = true; updateDirty(); });
$('add-product').addEventListener('click', () => run('Adding data product…', () => addProduct($('new-product-edition').value)));
$('remove-product').addEventListener('click', () => run('Updating local draft…', async () => { if (selectedProduct < 0) return; draft.products.splice(selectedProduct, 1); selectedProduct = draft.products.length ? Math.min(selectedProduct, draft.products.length - 1) : -1; editorDirty = false; changed(); renderProducts(); await renderEditor(); updateJson(); notice('Product removed from the local draft. Save to retain this change.'); }));
$('query-form').addEventListener('submit', event => { event.preventDefault(); run('Loading selected records…', () => requestPreview()); });
$('query-form').addEventListener('input', () => { $('next-page').disabled = true; });
$('next-page').addEventListener('click', () => run('Loading the next source page…', () => requestPreview(true)));
$('download-preview').addEventListener('click', () => { if (preview) saveBlob(new Blob([JSON.stringify(preview, null, 2) + '\n'], { type: 'application/json' }), 'sec-edgar-' + previewProduct + '-selection.json'); });
$('import-form').addEventListener('submit', event => { event.preventDefault(); run('Importing original SEC capture…', async () => {
  const file = $('capture-file').files[0]; if (!file) throw new Error('Choose the original JSON file.');
  const id = $('capture-id').value.trim(), meta = { id, kind: $('capture-kind').value, cik: $('capture-cik').value.trim().padStart(10, '0'), sourceUrl: $('capture-url').value.trim() };
  if ($('capture-time').value) meta.capturedAt = new Date($('capture-time').value).toISOString();
  await api('/api/import?' + new URLSearchParams(meta), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
  await refresh({ message: 'Capture imported with its exact original bytes.' }); await showCapture(id); $('new-product-edition').value = id;
}); });
function defaultSourceUrl() {
  const cik = $('capture-cik').value.trim(); if (!/^\d{1,10}$/.test(cik)) return;
  const padded = cik.padStart(10, '0');
  $('capture-url').value = $('capture-kind').value === 'facts' ? 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + padded + '.json' : 'https://data.sec.gov/submissions/CIK' + padded + '.json';
}
$('capture-cik').addEventListener('change', defaultSourceUrl); $('capture-kind').addEventListener('change', defaultSourceUrl);
document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => run('Preparing saved export…', async () => { await download('/api/download/' + button.dataset.download, 'sec-edgar-' + button.dataset.download + '.json'); notice('Saved revision export downloaded.'); })));
$('apply-json').addEventListener('click', () => run('Loading merchant JSON…', () => applyJson(objectJson($('merchant-json').value, 'Merchant configuration'))));
$('merchant-json').addEventListener('input', () => { jsonDirty = true; updateDirty(); });
$('download-local').addEventListener('click', () => run('Preparing your local draft…', async () => {
  let content;
  if (jsonDirty) content = $('merchant-json').value;
  else { commitEditor(); content = JSON.stringify(draft, null, 2) + '\n'; }
  saveBlob(new Blob([content], { type: 'application/json' }), 'sec-edgar-local-draft-revision-' + draftRevision + '.json');
  notice('Your local draft was downloaded. Its edits remain open.');
}));
$('load-saved').addEventListener('click', () => run('Loading saved draft…', () => refresh({ replaceDraft: true, message: 'The latest saved draft is now open for editing.' })));
$('config-file').addEventListener('change', () => run('Importing merchant configuration…', async () => { const file = $('config-file').files[0]; if (file) await applyJson(objectJson(await file.text(), 'Merchant configuration')); }));
$('refresh-history').addEventListener('click', () => run('Loading revision history…', loadHistory));
$('restore').addEventListener('click', () => run('Restoring selected revision…', async () => {
  const result = await api('/api/restore', { method: 'POST', json: { revision: Number($('restore-revision').value), expectedRevision: state.revision } });
  await refresh({ replaceDraft: true, message: 'Selected draft restored as revision ' + result.revision + '.' }); await loadHistory();
}));
window.addEventListener('beforeunload', event => { if (hasEdits()) { event.preventDefault(); event.returnValue = ''; } });

await run('Opening the retained workspace…', async () => {
  const key = new URLSearchParams(location.hash.slice(1)).get('session');
  if (key) { history.replaceState(null, '', location.pathname + location.search); await api('/api/session', { method: 'POST', json: { key } }); }
  await refresh({ replaceDraft: true });
});
