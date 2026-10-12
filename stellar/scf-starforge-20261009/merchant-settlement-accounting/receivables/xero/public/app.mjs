// MIT. Form-driven operator for the original Xero document handover controller.
import {XeroReceivablesClient, XeroReceivablesApiError} from './client.mjs';
import {parseXeroNativeJson} from './native-json.mjs';

const $ = id => document.getElementById(id);
const PAGES = ['queue', 'profiles', 'prepare', 'current'];
const view = {
  data: null, page: 'queue', loadEpoch: 0, profileEpoch: 0, profileId: '', profileVersion: undefined,
  profileDirty: false, contacts: new Map(), lineMappings: [], templates: {}, templateLoading: new Set(), lineSource: null, lineEpoch: 0,
  sourceCache: new Map(), selected: new Set(), selectionEpoch: 0, preview: null,
  packageId: '', package: null, detailEpoch: 0, correctionIds: new Set(), correctionEpoch: 0, correctionPreview: null,
  returned: null, returnEpoch: 0, busy: false, pending: null, pendingKey: null,
};
let config, client, nativeClient;

function node(tag, text, attrs = {}) {
  const item = document.createElement(tag);
  if (text !== undefined && text !== null) item.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'className') item.className = value;
    else if (key === 'disabled' || key === 'hidden' || key === 'checked') item[key] = Boolean(value);
    else item.setAttribute(key, String(value));
  }
  return item;
}
function replace(id, children) { $(id).replaceChildren(...children); }
function cell(text, className) { return node('td', text, {className}); }
function small(text) { return node('span', text, {className: 'subtext'}); }
function textCell(main, secondary, className) {
  const item = cell(main, className); if (secondary) item.append(small(secondary)); return item;
}
function badge(status) { return node('span', status, {className: 'badge', 'data-state': status}); }
function button(text, action, value, className) {
  const item = node('button', text, {type: 'button', 'data-action': action, 'data-value': value, className});
  return item;
}
function option(value, text) { return node('option', text, {value}); }
function fillSelect(id, values, selected, placeholder) {
  const select = $(id), items = placeholder === undefined ? [] : [option('', placeholder)];
  items.push(...values.map(item => option(item.value, item.label)));
  select.replaceChildren(...items);
  if ([...select.options].some(item => item.value === String(selected ?? ''))) select.value = selected ?? '';
}
function notice(message, tone = 'info') {
  const target = $('notice'); target.textContent = message; target.dataset.tone = tone; target.hidden = !message;
}
function report(error) {
  notice((error?.message || String(error)) + (error?.code ? ' [' + error.code + ']' : ''), 'error');
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function short(value) { const text = String(value ?? ''); return text.length > 20 ? text.slice(0, 16) + '…' : text; }
function byteCount(value) {
  const number = Number(value ?? 0);
  return number < 1024 ? number + ' B' : number < 1048576 ? (number / 1024).toFixed(1) + ' KiB' : (number / 1048576).toFixed(1) + ' MiB';
}
function amount(value, currency) { return String(value ?? '') + (currency?.code ? ' ' + currency.code : ''); }
function dateTime(value) { return value ? String(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '—'; }
function profileById(id) { return view.data?.profiles.find(item => item.id === id); }
function nativeDocuments() {
  if (!view.data) return [];
  const customers = new Map(view.data.customers.map(item => [item.id, item.name]));
  return [
    ...view.data.invoices.map(item => ({...item, kind: 'INVOICE', date: item.issueDate, eligible: item.status === 'ISSUED'})),
    ...view.data.credits.map(item => ({...item, kind: 'CREDIT_NOTE', date: item.creditDate, status: 'ISSUED', eligible: true})),
  ].map(item => ({...item, customerName: item.customerName || customers.get(item.customerId) || item.customerId}));
}
function docLabel(item) { return (item.number || short(item.id)) + ' · ' + (item.customerName || item.customerId || item.kind); }
function mutationIdentity() {
  requireValue(view.data && Number.isSafeInteger(view.data.revision), 'Refresh the current accounting workspace first.');
  const actor = $('actor').value.trim();
  requireValue(actor, 'Enter your operator name before saving an operation.');
  requireValue(!view.pending, 'Resolve the retained operation before starting another saved operation.');
  return {revision: view.data.revision, actor, requestId: crypto.randomUUID()};
}
function storageGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function savePending() {
  if (!view.pendingKey) return;
  try {
    if (view.pending) sessionStorage.setItem(view.pendingKey, JSON.stringify(view.pending));
    else sessionStorage.removeItem(view.pendingKey);
  } catch {
    if (view.pending) notice('The exact request remains in this tab. Keep it open until the response is complete, or download the saved request.', 'info');
  }
}
function renderPending() {
  $('pending').hidden = !view.pending;
  if (view.pending) {
    $('pending-description').textContent = view.pending.label + '. Retrying uses the same reviewed fields, revision and operation identity.';
    $('pending-identity').textContent = 'Request ' + view.pending.value.requestId + ' · revision ' + view.pending.value.revision;
  }
  $('retry-operation').disabled = view.busy;
  syncActions();
}
function syncActions() {
  const blocked = view.busy || Boolean(view.pending);
  for (const item of document.querySelectorAll('[data-mutation]')) item.disabled = blocked;
  $('prepare-package').disabled = blocked || !currentPreview(false);
  $('create-correction').disabled = blocked || !currentPreview(true);
  $('receive-result').disabled = blocked || !view.returned || !view.package;
  $('save-profile').disabled = blocked || !view.data || view.templateLoading.size > 0;
  for (const fieldset of $('profile-form').querySelectorAll('fieldset')) fieldset.disabled = blocked;
  for (const id of ['profile-select', 'new-profile', 'reload-profile']) $(id).disabled = blocked;
}
function invalidatePreview() {
  view.selectionEpoch += 1; view.preview = null; $('selection-preview').hidden = true; syncActions();
}
function invalidateCorrection() {
  view.correctionEpoch += 1; view.correctionPreview = null; $('correction-preview').hidden = true; syncActions();
}
function currentPreview(correction) {
  const saved = correction ? view.correctionPreview : view.preview;
  if (!saved || !saved.value.ready || saved.revision !== view.data?.revision) return false;
  if (saved.epoch !== (correction ? view.correctionEpoch : view.selectionEpoch)) return false;
  if (saved.input.profileId === view.profileId && view.profileDirty) return false;
  const profile = profileById(saved.input.profileId);
  if (!profile || profile.version !== saved.value.selection.profileVersion) return false;
  return !correction || saved.input.parentId === view.packageId;
}
function selectPage(page, updateHash = true) {
  if (!PAGES.includes(page)) page = 'queue';
  view.page = page;
  for (const name of PAGES) $('page-' + name).hidden = name !== page;
  for (const item of document.querySelectorAll('[data-page]')) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  if (updateHash) {
    const hash = page === 'current' && view.packageId ? 'package/' + encodeURIComponent(view.packageId) : page;
    history.replaceState(null, '', '#' + hash);
  }
}
function restorePendingIdentity() {
  const binding = view.data.binding || view.data;
  const workspaceId = binding.workspaceId, sourcesSha256 = binding.sourcesSha256;
  if (!workspaceId || !sourcesSha256) return; // In-memory operation retention still works in an older composed host.
  const key = 'starforge.xero.pending:' + config.apiPath + ':' + workspaceId + ':' + sourcesSha256;
  if (view.pendingKey === key) return;
  if (view.pendingKey && view.pendingKey !== key) view.pending = null;
  view.pendingKey = key;
  const retained = storageGet(key);
  if (retained) {
    try {
      const candidate = JSON.parse(retained);
      if (['saveProfile', 'prepare', 'receive', 'correct'].includes(candidate.action) &&
          candidate.value && typeof candidate.value.requestId === 'string' &&
          Number.isSafeInteger(candidate.value.revision) && typeof candidate.value.actor === 'string') view.pending = candidate;
    } catch { /* Unreadable local state is never sent. */ }
  }
  renderPending();
}
async function loadState({savedProfileId, showSavedProfile = false} = {}) {
  const epoch = ++view.loadEpoch;
  invalidatePreview(); invalidateCorrection();
  const state = await client.state();
  if (epoch !== view.loadEpoch) return;
  view.data = state;
  $('revision').textContent = 'Accounting revision ' + state.revision;
  if (!$('selection-date').value) $('selection-date').value = state.asOf;
  restorePendingIdentity();
  renderQueue(); renderProfileSelectors(); renderDocumentChoices(); renderDocuments();
  if (showSavedProfile && savedProfileId) {
    showProfile(savedProfileId); $('selection-profile').value = savedProfileId; renderSelectionProfile();
  } else if (!view.profileId && !view.profileDirty) showProfile('');
  syncActions();
}
async function sendPending() {
  const pending = view.pending;
  requireValue(pending && !view.busy, 'Select a retained operation to retry.');
  view.busy = true; renderPending();
  let result;
  try {
    result = ['receive', 'correct'].includes(pending.action) ?
      await client[pending.action](pending.id, pending.value) : await client[pending.action](pending.value);
  } catch (error) {
    const uncertain = !(error instanceof XeroReceivablesApiError) || error.status === 0 ||
      error.status >= 500 || error.details?.outcome === 'unknown';
    if (!uncertain) { view.pending = null; savePending(); }
    view.busy = false; renderPending(); report(error);
    if (!uncertain && error.status === 409) {
      try { await loadState(); if (view.packageId) await openPackage(view.packageId); } catch (readError) { report(readError); }
    }
    return;
  }
  view.pending = null; savePending(); view.busy = false; renderPending();
  try {
    if (pending.action === 'saveProfile') {
      await loadState({savedProfileId: result.profile?.id || result.operation?.result?.xeroProfileId, showSavedProfile: true});
      selectPage('profiles');
    } else {
      await loadState();
      const id = result.package?.id || result.operation?.result?.xeroPackageId || pending.id;
      if (pending.action === 'receive') clearReturnedFile();
      if (id) await openPackage(id);
    }
    notice(pending.label + ' saved at accounting revision ' + result.revision + '.', 'success');
  } catch (error) {
    notice(pending.label + ' was saved at accounting revision ' + result.revision + '. Refresh the workspace to read the current result. ' + error.message, 'error');
  }
}
async function mutate(action, label, payload, id) {
  const value = {...payload, ...mutationIdentity()};
  requireValue(new TextEncoder().encode(JSON.stringify(value)).length <= config.requestBytes, 'The encoded request exceeds the workspace request limit.');
  view.pending = {action, label, id, value}; savePending(); renderPending();
  await sendPending();
}
async function downloadResponse(response, fallback) {
  const blob = await response.blob();
  saveBlob(blob, fallback);
}
function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob), link = node('a', null, {href, download: String(name).replace(/[\\/]/g, '_')});
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 30000);
}
function saveJson(value, name) { saveBlob(new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'}), name); }
function toBase64(bytes) {
  const chunks = [];
  for (let at = 0; at < bytes.length; at += 16384) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 16384)));
  return btoa(chunks.join(''));
}
async function originalFile(file, maximum) {
  requireValue(file && file.size > 0 && file.size <= maximum, 'Choose a nonempty original file within the ' + byteCount(maximum) + ' file limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  requireValue(bytes.length > 0 && bytes.length <= maximum, 'The file exceeds the original source limit.');
  return {file: {name: file.name, dataBase64: toBase64(bytes)}, bytes};
}
function metric(label, count) {
  const item = node('div', null, {className: 'metric'}); item.append(node('strong', count), node('span', label)); return item;
}
function renderQueue() {
  const packages = view.data.packages;
  replace('queue-counts', [
    metric('Mapping profiles', view.data.profiles.length), metric('Packages', packages.length),
    metric('Awaiting results', packages.filter(item => item.state !== 'RECEIVED').length),
    metric('Received packages', packages.filter(item => item.state === 'RECEIVED').length),
  ]);
  const filter = $('queue-filter').value.toLowerCase(), state = $('queue-state').value;
  const selected = packages.filter(item =>
    (!state || item.state === state) && [item.id, item.title, item.organisation].some(text => String(text || '').toLowerCase().includes(filter)));
  replace('queue-body', selected.map(item => {
    const row = node('tr'), status = cell(); status.append(badge(item.state));
    const open = cell(); open.append(button('Open', 'package', item.id, 'link'));
    row.append(textCell(item.title || short(item.id), item.id), cell(item.organisation),
      cell(item.documentCount, 'numeric'), cell(item.resolvedCount + ' / ' + item.documentCount, 'numeric'),
      status, cell(dateTime(item.createdAt)), open);
    return row;
  }));
  $('queue-empty').hidden = packages.length > 0;
}

function renderProfileSelectors() {
  const profiles = view.data.profiles.map(item => ({value: item.id, label: item.name + ' · ' + item.organisation + ' · v' + item.version}));
  fillSelect('profile-select', profiles, view.profileId, 'New profile');
  const selected = $('selection-profile').value;
  fillSelect('selection-profile', profiles, selected || (profiles.length === 1 ? profiles[0].value : ''), 'Select a saved profile');
  const organisationKey = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const sameOrganisation = view.package ? view.data.profiles.filter(item =>
    organisationKey(item.organisation) === organisationKey(view.package.organisation) &&
    item.currency.code === view.package.profile.currency.code && item.currency.scale === view.package.profile.currency.scale) : view.data.profiles;
  const correction = $('correction-profile').value;
  fillSelect('correction-profile', sameOrganisation.map(item => ({value: item.id, label: item.name + ' · v' + item.version})),
    correction || view.package?.profileId || '', 'Select a saved profile');
  renderSelectionProfile();
}
function markProfileDirty() {
  view.profileDirty = true;
  if (view.profileId && $('selection-profile').value === view.profileId) invalidatePreview();
  if (view.profileId && $('correction-profile').value === view.profileId) invalidateCorrection();
  $('profile-save-state').textContent = 'Unsaved mapping changes. Save this version before reviewing its documents.';
  syncActions();
}
function templateDescription(type) {
  const current = view.templates[type], profile = profileById(view.profileId);
  const saved = profile?.[type + 'Template'];
  if (current) return current.name + ' · newly selected original file';
  if (saved) return saved.name + ' · ' + byteCount(saved.bytes) + ' · SHA-256 ' + saved.sha256 + ' · retained unless replaced';
  return 'Choose the original ' + type + ' template.';
}
function showProfile(id) {
  const profile = id ? profileById(id) : null;
  requireValue(!id || profile, 'Select a current saved mapping profile.');
  ++view.profileEpoch; ++view.lineEpoch;
  view.profileId = id; view.profileVersion = profile?.version; view.profileDirty = false;
  view.templates = {}; view.templateLoading = new Set(); view.lineMappings = (profile?.lineMappings || []).map(item => ({...item}));
  view.contacts = new Map((profile?.contacts || []).map(item => [item.customerId, item.contactName]));
  view.lineSource = null;
  $('profile-select').value = id;
  $('profile-name').value = profile?.name || '';
  $('profile-organisation').value = profile?.organisation || '';
  $('profile-currency').value = profile?.currency?.code || 'USD';
  $('profile-scale').value = String(profile?.currency?.scale ?? 2);
  $('profile-account').value = profile?.accountCode || '';
  $('profile-tax').value = profile?.taxType || '';
  $('invoice-date-format').value = profile?.invoiceDateFormat || 'DD/MM/YYYY';
  $('credit-date-format').value = profile?.creditDateFormat || 'DD/MM/YYYY';
  $('invoice-template').value = ''; $('credit-template').value = '';
  $('invoice-template-info').textContent = templateDescription('invoice');
  $('credit-template-info').textContent = templateDescription('credit');
  $('profile-version').textContent = profile ? 'Version ' + profile.version + ' · ' + profile.id : 'New mapping profile';
  $('profile-save-state').textContent = profile ? 'Saved version ' + profile.version + '. Changes create a new version.' : 'Save a version before preparing documents.';
  $('mapping-document').value = '';
  fillSelect('mapping-line', [], '', 'Select a document first'); $('mapping-line').disabled = true;
  $('mapping-source').textContent = ''; $('add-line-mapping').disabled = true;
  $('mapping-account').value = ''; $('mapping-tax').value = '';
  renderContacts(); renderLineMappings(); syncActions();
}
function renderContacts() {
  const filter = $('contact-filter').value.toLowerCase();
  const rows = view.data.customers.map(customer => {
    const row = node('tr'), inputCell = cell();
    row.hidden = ![customer.name, customer.reference, customer.id].some(item => String(item || '').toLowerCase().includes(filter));
    const input = node('input', null, {type: 'text', maxlength: 255, 'data-customer-id': customer.id,
      'aria-label': 'Xero contact name for ' + customer.name});
    input.value = view.contacts.get(customer.id) || '';
    inputCell.append(input);
    row.append(textCell(customer.name, short(customer.id)), cell(customer.reference || '—'), inputCell);
    return row;
  });
  replace('contacts-body', rows); $('contacts-empty').hidden = rows.length > 0;
}
function renderDocumentChoices() {
  const selected = $('mapping-document').value;
  fillSelect('mapping-document', nativeDocuments().filter(item => item.eligible).map(item => ({value: item.id, label: docLabel(item)})),
    selected, 'Select an issued document');
}
function renderLineMappings() {
  const documents = new Map(nativeDocuments().map(item => [item.id, item]));
  replace('line-mappings-body', view.lineMappings.map(item => {
    const source = view.sourceCache.get(item.documentId);
    const line = source?.lines.find(line => (line.id || line.invoiceLineId) === item.lineId);
    const row = node('tr'), remove = cell();
    remove.append(button('Remove', 'remove-mapping', JSON.stringify([item.documentId, item.lineId]), 'link'));
    row.append(textCell(documents.get(item.documentId)?.number || short(item.documentId), short(item.documentId)),
      textCell(line?.description || item.lineId, line ? item.lineId : ''), cell(item.accountCode), cell(item.taxType), remove);
    return row;
  }));
}
async function loadLineSource() {
  const id = $('mapping-document').value, epoch = ++view.lineEpoch;
  view.lineSource = null; $('mapping-line').disabled = true; $('add-line-mapping').disabled = true;
  fillSelect('mapping-line', [], '', id ? 'Reading original document…' : 'Select a document first');
  $('mapping-source').textContent = '';
  if (!id) return;
  const document = nativeDocuments().find(item => item.id === id);
  requireValue(document, 'Select a current source document.');
  let source = view.sourceCache.get(id);
  if (!source) source = await nativeClient.request('/documents/' + encodeURIComponent(id) + '/files/' +
    (document.kind === 'INVOICE' ? 'invoice.json' : 'credit.json'));
  if (epoch !== view.lineEpoch || id !== $('mapping-document').value) return;
  requireValue(source.id === id && Array.isArray(source.lines), 'The original document identity does not match the selected document.');
  view.sourceCache.set(id, source); view.lineSource = {id, source};
  const lines = source.lines.map(line => ({value: line.id || line.invoiceLineId,
    label: (line.description || line.id || line.invoiceLineId) + ' · ' + amount(line.total, source.currency)}));
  fillSelect('mapping-line', lines, '', 'Select an original line');
  $('mapping-line').disabled = false;
  $('mapping-source').textContent = 'Original ' + (source.number || id) + ' · ' + lines.length + ' lines · ' + id;
  $('mapping-account').value = $('profile-account').value;
  $('mapping-tax').value = $('profile-tax').value;
  renderLineMappings();
}
function addLineMapping() {
  const documentId = $('mapping-document').value, lineId = $('mapping-line').value;
  requireValue(view.lineSource?.id === documentId &&
    view.lineSource.source.lines.some(line => (line.id || line.invoiceLineId) === lineId), 'Load and select an original document line.');
  const accountCode = $('mapping-account').value.trim(), taxType = $('mapping-tax').value.trim();
  requireValue(accountCode && taxType, 'Enter the account code and tax type for this line.');
  const value = {documentId, lineId, accountCode, taxType};
  const index = view.lineMappings.findIndex(item => item.documentId === documentId && item.lineId === lineId);
  if (index < 0) view.lineMappings.push(value); else view.lineMappings[index] = value;
  markProfileDirty(); renderLineMappings();
}
async function chooseTemplate(type) {
  const epoch = view.profileEpoch, selected = $(type + '-template').files[0];
  delete view.templates[type]; view.templateLoading.delete(type); markProfileDirty();
  if (!selected) { $(type + '-template-info').textContent = templateDescription(type); return; }
  view.templateLoading.add(type); syncActions();
  $(type + '-template-info').textContent = 'Reading ' + selected.name + '…';
  try {
    const source = await originalFile(selected, config.templateBytes);
    if (epoch !== view.profileEpoch || $(type + '-template').files[0] !== selected) return;
    view.templates[type] = source.file;
    $(type + '-template-info').textContent = selected.name + ' · ' + byteCount(source.bytes.length) + ' · selected original bytes';
  } finally {
    if (epoch === view.profileEpoch && $(type + '-template').files[0] === selected) {
      view.templateLoading.delete(type); syncActions();
    }
  }
}
async function saveProfile() {
  requireValue($('profile-form').reportValidity(), 'Complete the mapping fields.');
  requireValue(view.templateLoading.size === 0, 'Finish reading the selected original templates before saving.');
  for (const type of ['invoice', 'credit']) requireValue(!$(type + '-template').files[0] || view.templates[type],
    'Read a valid selected ' + type + ' template, or clear that file selection to retain the saved original.');
  requireValue(view.profileId || (view.templates.invoice && view.templates.credit), 'Choose both original import templates for a new profile.');
  const value = {
    ...(view.profileId ? {id: view.profileId, expectedVersion: view.profileVersion} : {}),
    name: $('profile-name').value.trim(), organisation: $('profile-organisation').value.trim(),
    currency: {code: $('profile-currency').value.trim().toUpperCase(), scale: Number($('profile-scale').value)},
    accountCode: $('profile-account').value.trim(), taxType: $('profile-tax').value.trim(),
    invoiceDateFormat: $('invoice-date-format').value, creditDateFormat: $('credit-date-format').value,
    contacts: [...view.contacts].filter(([, name]) => name.trim()).map(([customerId, contactName]) => ({customerId, contactName: contactName.trim()})),
    lineMappings: view.lineMappings.map(item => ({...item})),
    ...(view.templates.invoice ? {invoiceTemplate: view.templates.invoice} : {}),
    ...(view.templates.credit ? {creditTemplate: view.templates.credit} : {}),
  };
  await mutate('saveProfile', 'Organisation mapping', value);
}
function renderSelectionProfile() {
  const profile = profileById($('selection-profile').value);
  $('selection-profile-info').textContent = profile ?
    profile.organisation + ' · saved version ' + profile.version + ' · ' + profile.currency.code +
    ' · account ' + profile.accountCode + ' · tax ' + profile.taxType : 'Choose the saved mapping for the receiving organisation.';
}
function filteredDocuments() {
  const filter = $('document-filter').value.toLowerCase(), kind = $('document-kind').value;
  return nativeDocuments().filter(item => (!kind || kind === item.kind) &&
    [item.number, item.id, item.customerName].some(value => String(value || '').toLowerCase().includes(filter)));
}
function renderDocuments() {
  const documents = filteredDocuments(), availableIds = new Set(nativeDocuments().filter(item => item.eligible).map(item => item.id));
  for (const id of [...view.selected]) if (!availableIds.has(id)) view.selected.delete(id);
  replace('documents-body', documents.map(item => {
    const row = node('tr'), checkboxCell = cell(), checkbox = node('input', null, {
      type: 'checkbox', 'data-document-id': item.id, 'aria-label': 'Select ' + (item.number || item.id), disabled: !item.eligible,
    });
    checkbox.checked = view.selected.has(item.id); checkboxCell.append(checkbox);
    row.append(checkboxCell, textCell(item.number || 'Unnumbered', short(item.id)), cell(item.customerName),
      cell(item.kind === 'INVOICE' ? 'Invoice' : 'Credit note'), cell(item.date || '—'), cell(item.currency?.code),
      cell(item.total, 'numeric'), cell(item.status));
    return row;
  }));
  const eligible = documents.filter(item => item.eligible), checked = eligible.filter(item => view.selected.has(item.id));
  $('select-visible').checked = eligible.length > 0 && checked.length === eligible.length;
  $('select-visible').indeterminate = checked.length > 0 && checked.length < eligible.length;
  $('select-visible').disabled = eligible.length === 0;
  $('selection-count').textContent = view.selected.size + ' selected';
  $('documents-empty').hidden = nativeDocuments().length > 0;
}
function selectionInput(correction) {
  const profileId = $(correction ? 'correction-profile' : 'selection-profile').value, profile = profileById(profileId);
  requireValue(profile, 'Choose a saved organisation mapping.');
  requireValue(!(view.profileDirty && view.profileId === profileId), 'Save the current mapping edits, or reload its saved version, before reviewing these documents.');
  const documentIds = [...(correction ? view.correctionIds : view.selected)].sort();
  requireValue(documentIds.length > 0 && documentIds.length <= 500, 'Select between one and 500 issued documents for this package.');
  const asOf = correction ? view.package?.selection.asOf : $('selection-date').value;
  requireValue(asOf, 'Choose the handover date.');
  return {profileId, documentIds, asOf, ...(correction ? {parentId: view.packageId} : {})};
}
function renderIssues(id, issues) {
  if (!issues?.length) { replace(id, []); return; }
  const box = node('div', null, {className: 'issues'}), list = node('ul');
  box.append(node('h4', 'Resolve the following items before preparing'));
  for (const issue of issues) list.append(node('li', issue.message +
    (issue.documentId ? ' · document ' + short(issue.documentId) : '') + (issue.lineId ? ' · line ' + issue.lineId : '')));
  box.append(list); replace(id, [box]);
}
function renderTotals(id, totals) {
  if (!totals) { replace(id, []); return; }
  const wrap = node('div', null, {className: 'totals table-wrap'}), table = node('table'), head = node('thead'), row = node('tr'), body = node('tbody');
  for (const heading of ['Documents', 'Net', 'Tax', 'Total', 'Currency']) row.append(node('th', heading));
  head.append(row);
  for (const [key, label] of [['invoices', 'Invoices'], ['credits', 'Credits']]) {
    const value = totals[key]; if (!value) continue;
    const current = node('tr'); current.append(cell(label), cell(value.net, 'numeric'), cell(value.tax, 'numeric'),
      cell(value.total, 'numeric'), cell(totals.currency?.code || '')); body.append(current);
  }
  table.append(head, body); wrap.append(table); replace(id, [wrap]);
}
function renderFiles(id, files, download) {
  const list = node('div', null, {className: 'file-list'});
  for (const file of files || []) {
    const row = node('div', null, {className: 'file-item'}), info = node('div');
    info.append(node('strong', file.name), node('small', (file.role || file.type || 'Document') + ' · ' + byteCount(file.bytes)),
      node('small', 'SHA-256 ' + file.sha256, {className: 'mono'}));
    row.append(info);
    if (download) row.append(button('Download', 'file', file.name));
    list.append(row);
  }
  replace(id, [list]);
}
function renderPreview(correction) {
  const saved = correction ? view.correctionPreview : view.preview, prefix = correction ? 'correction' : 'preview';
  $(correction ? 'correction-preview' : 'selection-preview').hidden = false;
  renderIssues(prefix + '-issues', saved.value.issues);
  renderTotals(prefix + '-totals', saved.value.totals);
  renderFiles(prefix + '-files', saved.value.files, false);
  $(prefix + '-identity').textContent = 'Review ' + saved.value.previewSha256 + ' · source ' + saved.value.sourceFingerprint;
  if (!correction) {
    $('preview-state').textContent = saved.value.ready ? 'READY' : 'MAPPING REQUIRED';
    $('preview-state').dataset.state = saved.value.ready ? 'IMPORTED' : 'UNRESOLVED';
    replace('preview-documents', saved.value.documents.map(item => {
      const row = node('tr'); row.append(textCell(item.number, short(item.id)), cell(item.contactName || 'Unmapped'),
        cell(item.kind === 'INVOICE' ? 'Invoice' : 'Credit note'), cell(item.net, 'numeric'), cell(item.tax, 'numeric'),
        cell(amount(item.total, item.currency), 'numeric'), cell(item.lineCount, 'numeric')); return row;
    }));
  }
  syncActions();
}
async function reviewSelection(correction) {
  const input = selectionInput(correction);
  if (correction) invalidateCorrection(); else invalidatePreview();
  const epoch = correction ? view.correctionEpoch : view.selectionEpoch, revision = view.data.revision;
  const target = $(correction ? 'preview-correction' : 'preview-selection'); target.disabled = true;
  try {
    const value = await client.preview(input);
    if (epoch !== (correction ? view.correctionEpoch : view.selectionEpoch) || revision !== view.data.revision) return;
    const saved = {input, value, revision, epoch};
    if (correction) view.correctionPreview = saved; else view.preview = saved;
    renderPreview(correction);
    if (!value.ready) notice('The document review identified mapping or source issues. Review the listed items before preparing.', 'info');
    else notice('The exact document selection and saved mapping version are ready for preparation.', 'success');
  } finally { target.disabled = false; }
}
async function prepareReviewed(correction) {
  requireValue(currentPreview(correction), 'Review this exact selection again before preparing.');
  const saved = correction ? view.correctionPreview : view.preview;
  const payload = {...saved.input, previewSha256: saved.value.previewSha256};
  if (correction) { delete payload.parentId; await mutate('correct', 'Linked correction package', payload, view.packageId); }
  else await mutate('prepare', 'Handover package', payload);
}

function clearReturnedFile() {
  ++view.returnEpoch; view.returned = null;
  $('returned-file').value = ''; $('result-mapping').disabled = true;
  $('returned-file-info').textContent = $('returned-format').value === 'NATIVE_JSON' ?
    'Choose the unchanged Xero JSON response, up to 8 MiB.' : 'Choose the original document summary CSV, up to 8 MiB.';
  replace('result-columns', []); replace('returned-preview', []); replace('native-source-preview', []);
  $('native-source-preview').hidden = true;
  syncActions();
}
async function openPackage(id) {
  const changed = view.packageId !== id, epoch = ++view.detailEpoch;
  if (changed) {
    view.packageId = id; view.package = null; view.correctionIds = new Set();
    clearReturnedFile(); invalidateCorrection();
    $('package-detail').hidden = true; $('package-empty').hidden = false;
  }
  selectPage('current');
  const result = await client.detail(id);
  if (epoch !== view.detailEpoch || id !== view.packageId) return;
  view.package = result.package;
  if (result.revision !== view.data.revision) {
    await loadState();
    if (epoch !== view.detailEpoch || id !== view.packageId) return;
  }
  invalidateCorrection();
  renderPackage(changed); renderProfileSelectors(); syncActions();
}
function resolutionMap() {
  return new Map((view.package?.resolutions || []).map(item => [item.documentId, item]));
}
function renderPackage(changed = false) {
  const current = view.package;
  $('package-empty').hidden = true; $('package-detail').hidden = false;
  $('package-heading').textContent = current.title || 'Xero handover';
  $('package-identity').textContent = current.id;
  $('package-state').textContent = current.state; $('package-state').dataset.state = current.state;
  replace('package-counts', [metric('Documents', current.documentCount), metric('Resolved', current.resolvedCount),
    metric('Unresolved', current.unresolvedCount), metric('Returned files', current.imports.length)]);
  $('package-context').textContent = current.organisation + ' · ' + (current.profile?.name || current.profileId) +
    ' v' + current.profileVersion + ' · original date ' + current.asOf + ' · prepared ' + dateTime(current.createdAt);
  const family = [];
  if (current.parentId) family.push(button('Open parent package', 'package', current.parentId));
  for (const related of (current.family || view.data.packages.filter(item => item.parentId === current.id))
    .filter(item => item.id !== current.id && item.id !== current.parentId))
    family.push(button((related.parentId === current.id ? 'Open correction ' : 'Related package ') + short(related.id), 'package', related.id));
  replace('package-family', family);
  renderFiles('package-files', current.files, true);
  const outcomes = resolutionMap(), correctable = new Set();
  for (const document of current.documents) if (outcomes.get(document.id)?.canCorrect) correctable.add(document.id);
  if (changed) view.correctionIds = new Set(correctable);
  else for (const id of [...view.correctionIds]) if (!correctable.has(id)) view.correctionIds.delete(id);
  replace('outcomes-body', current.documents.map(document => {
    const outcome = outcomes.get(document.id) || {status: 'UNRESOLVED', sourceRowNumbers: [], message: '', canCorrect: false};
    const row = node('tr'), selected = cell(), status = cell(), source = cell();
    const checkbox = node('input', null, {type: 'checkbox', 'data-correction-id': document.id,
      'aria-label': 'Include ' + document.number + ' in correction', disabled: !outcome.canCorrect});
    checkbox.checked = view.correctionIds.has(document.id); selected.append(checkbox); status.append(badge(outcome.status));
    source.append(node('span', outcome.fileName || '—'));
    if (outcome.sourceRowNumbers?.length) source.append(small('Rows ' + outcome.sourceRowNumbers.join(', ')));
    if (outcome.sourcePointers?.length) source.append(small(outcome.sourcePointers.join(', ')));
    if (outcome.packageId && outcome.packageId !== current.id) source.append(button(outcome.fileName ? 'Source package' : 'Open successor', 'package', outcome.packageId, 'link'));
    if (outcome.latestPackageId && outcome.latestPackageId !== current.id && outcome.latestPackageId !== outcome.packageId)
      source.append(button('Current successor', 'package', outcome.latestPackageId, 'link'));
    const external = textCell(outcome.externalDocumentId || '—', outcome.externalStatus);
    const otherIds = (outcome.externalDocumentIds || []).filter(id => id !== outcome.externalDocumentId);
    if (otherIds.length) external.append(small('Other returned IDs: ' + otherIds.join(', ')));
    if (Array.isArray(outcome.activeExternalDocumentIds)) external.append(small(outcome.activeExternalDocumentIds.length ?
      'Active IDs: ' + outcome.activeExternalDocumentIds.join(', ') : 'No active returned document ID'));
    row.append(selected, textCell(document.number, short(document.id)), cell(document.contactName),
      cell(amount(document.total, document.currency), 'numeric'), status,
      external, source, cell(outcome.message || ''));
    return row;
  }));
  $('correction-count').textContent = view.correctionIds.size + ' unresolved documents selected';
  $('preview-correction').disabled = correctable.size === 0;
  if (changed) {
    $('returned-organisation').value = current.organisation;
    $('returned-at').value = new Date().toISOString();
    $('returned-statuses').value = 'DRAFT, AUTHORISED, PAID'; $('retired-statuses').value = 'VOIDED, DELETED';
    $('decimal-separator').value = '.'; $('group-separator').value = ''; $('credit-sign').value = 'POSITIVE';
    $('correction-profile').value = '';
  }
  renderImports();
  const facts = node('dl', null, {className: 'facts'}), profile = current.profile || {};
  for (const [label, value] of [
    ['Profile', (profile.name || current.profileId) + ' · v' + current.profileVersion],
    ['Organisation', current.organisation], ['Currency', profile.currency?.code || ''],
    ['Account code', profile.accountCode || ''], ['Tax type', profile.taxType || ''],
    ['Invoice template', profile.invoiceTemplate?.name || ''], ['Invoice template SHA-256', profile.invoiceTemplate?.sha256 || ''],
    ['Credit template', profile.creditTemplate?.name || ''], ['Credit template SHA-256', profile.creditTemplate?.sha256 || ''],
    ['Invoice date format', profile.invoiceDateFormat || ''], ['Credit date format', profile.creditDateFormat || ''],
  ]) facts.append(node('dt', label), node('dd', value));
  const contacts = node('div', null, {className: 'table-wrap'}), table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const text of ['Customer identity', 'Retained Xero contact name']) header.append(node('th', text));
  head.append(header);
  for (const item of profile.contacts || []) { const row = node('tr'); row.append(cell(item.customerId), cell(item.contactName)); body.append(row); }
  table.append(head, body); contacts.append(table);
  replace('retained-profile', [facts, node('h4', 'Retained customer mapping'), contacts]);
  replace('history-body', (current.history || []).map(item => {
    const row = node('tr');
    row.append(cell(dateTime(item.at || item.recordedAt)), cell(item.actor), cell(item.action || item.type),
      cell(item.requestId || item.id || item.importId || item.packageId || item.parentId || current.id, 'mono')); return row;
  }));
}
function renderImports() {
  const imports = view.package.imports || [];
  if (!imports.length) { replace('imports-list', [node('p', 'Returned files will appear here with their original document records, source pointers and receiving interpretation.', {className: 'hint'})]); return; }
  replace('imports-list', imports.map(item => {
    const card = node('div', null, {className: 'import-card'});
    card.append(node('h4', item.file.name), node('p',
      'Received ' + dateTime(item.receivedAt) + ' · recorded by ' + item.actor + ' · ' + item.organisation + ' · ' + (item.format || 'CSV_SUMMARY'), {className: 'hint'}),
      node('p', 'SHA-256 ' + item.file.sha256 + ' · ' + byteCount(item.file.bytes), {className: 'mono'}));
    const actions = node('div', null, {className: 'actions'});
    if (item.fileName) actions.append(button('Download original return', 'file', item.fileName));
    if (item.reportName) actions.append(button('Download interpretation report', 'file', item.reportName));
    card.append(actions);
    const interpretation = node('dl', null, {className: 'facts'});
    for (const [label, value] of [
      ['Source format', item.format || 'CSV_SUMMARY'], ['Imported statuses', (item.importedStatusValues || []).join(', ')],
      ['Retired statuses', (item.retiredStatusValues || ['VOIDED', 'DELETED']).join(', ')],
      ...(item.format === 'NATIVE_JSON' ? [
        ['Original collections', (item.native?.collections || []).map(value => typeof value === 'string' ? value :
          value.name + ' (' + value.count + ' at ' + value.pointer + ')').join(', ')],
        ['Response identity', item.native?.envelope?.Id || ''],
        ['Response status', item.native?.envelope?.Status || ''],
        ['Response provider', item.native?.envelope?.ProviderName || ''],
        ['Original documents', item.native?.documentCount ?? ''],
        ['Considered receivables', item.native?.consideredCount ?? ''],
      ] : [
        ['Decimal separator', item.decimalSeparator], ['Thousands separator', item.groupSeparator === '' ? 'None' : item.groupSeparator === ' ' ? 'Space' : item.groupSeparator],
        ['Credit amounts', item.creditSign], ...Object.entries(item.columns || {}).map(([field, header]) => [field, header || 'Not selected']),
      ]),
    ]) interpretation.append(node('dt', label), node('dd', value));
    card.append(interpretation);
    if (item.unmatchedRows?.length) card.append(node('p', 'Rows outside this package: ' + item.unmatchedRows.join(', '), {className: 'source-note'}));
    const details = node('details'), table = node('table'), head = node('thead'), headings = node('tr'), body = node('tbody'), wrap = node('div', null, {className: 'table-wrap'});
    details.append(node('summary', 'Inspect interpreted document rows (' + (item.rows?.length || 0) + ')'));
    for (const text of ['Source', 'Original document', 'Outcome', 'Xero identity / status', 'Net', 'Tax', 'Total', 'Currency', 'Message']) headings.append(node('th', text));
    head.append(headings);
    for (const value of item.rows || []) {
      const row = node('tr'), state = cell(); state.append(badge(value.status));
      row.append(cell(value.sourcePointers?.length ? value.sourcePointers.join(', ') : (value.rowNumbers || []).join(', ')), textCell(value.documentNumber, short(value.documentId)),
        state, textCell(value.externalDocumentId, value.externalStatus), cell(value.net, 'numeric'), cell(value.tax, 'numeric'),
        cell(value.total, 'numeric'), cell(value.currency?.code || value.currency || ''), cell(value.error || '')); body.append(row);
    }
    table.append(head, body); wrap.append(table); details.append(wrap); card.append(details);
    return card;
  }));
}
const COLUMN_FIELDS = [
  ['documentNumber', 'Original document number', ['documentnumber', 'invoicenumber', 'creditnotenumber']],
  ['documentId', 'Xero document ID', ['documentid', 'invoiceid', 'creditnoteid']],
  ['status', 'Status', ['status', 'invoicestatus', 'creditnotestatus']],
  ['net', 'Net amount', ['net', 'netamount', 'subtotal']],
  ['tax', 'Tax amount', ['tax', 'taxamount', 'totaltax']],
  ['total', 'Total amount', ['total', 'totalamount']],
  ['currency', 'Currency', ['currency', 'currencycode']],
  ['error', 'Error or message', ['error', 'errors', 'errormessage', 'message']],
];
function csvSample(text, maximum = 9) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') { value += '"'; at++; } else { quoted = false; closed = true; }
      } else value += char;
    } else if (char === '"') {
      requireValue(value.length === 0 && !closed, 'A CSV field contains an unexpected quote.');
      quoted = true;
    } else if (char === ',') {
      row.push(value); value = ''; closed = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[at + 1] === '\n') at++;
      row.push(value); rows.push(row); row = []; value = ''; closed = false;
      if (rows.length >= maximum) return rows;
    } else {
      requireValue(!closed, 'A CSV field contains characters after its closing quote.');
      value += char;
    }
  }
  requireValue(!quoted, 'The CSV preview ends inside a quoted field.');
  if (value.length || row.length || closed) { row.push(value); rows.push(row); }
  return rows;
}
function renderReturnedSample(rows) {
  const table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const item of rows[0]) header.append(node('th', item));
  head.append(header);
  for (const values of rows.slice(1)) {
    const row = node('tr'); for (const value of values) row.append(cell(value)); body.append(row);
  }
  table.append(head, body); replace('returned-preview', [table]);
}
function sourceFormatChanged() {
  clearReturnedFile();
  const native = $('returned-format').value === 'NATIVE_JSON';
  $('returned-file').accept = native ? '.json,application/json' : '.csv,text/csv';
  $('result-mapping').hidden = native;
  $('returned-format-note').textContent = native ?
    'Choose the original Accounting API Invoices or CreditNotes response. Document UUIDs, statuses and full document amounts are read from its original JSON fields.' :
    'Choose a document-summary CSV containing the Xero UUID and complete document totals. Map its actual headers and numeric conventions below.';
}
function nativeDocumentSample(text) {
  let source;
  try { source = parseXeroNativeJson(text.replace(/^\uFEFF/, '')).value; }
  catch (error) { throw new Error('Read the complete original Xero JSON response. ' + error.message); }
  requireValue(source && typeof source === 'object' && !Array.isArray(source), 'Choose the complete original Invoices or CreditNotes response object.');
  const rows = [];
  for (const [container, idKey, numberKey] of [['Invoices', 'InvoiceID', 'InvoiceNumber'], ['CreditNotes', 'CreditNoteID', 'CreditNoteNumber'], ['Elements', null, null]]) {
    if (source[container] === undefined) continue;
    requireValue(Array.isArray(source[container]), 'The original ' + container + ' response must contain an array.');
    source[container].forEach((item, index) => {
      requireValue(item && typeof item === 'object' && !Array.isArray(item), 'The original response contains an invalid document object.');
      rows.push({pointer: '/' + container + '/' + index, kind: item.Type || container,
        number: numberKey ? item[numberKey] : (item.InvoiceNumber || item.CreditNoteNumber),
        id: idKey ? item[idKey] : (item.InvoiceID || item.CreditNoteID), status: item.Status, net: item.SubTotal,
        tax: item.TotalTax, total: item.Total, currency: item.CurrencyCode, contact: item.Contact?.Name,
        error: (Array.isArray(item.ValidationErrors) ? item.ValidationErrors : []).map(value => value?.Message || '').filter(Boolean).join('; ') ||
          (container === 'Elements' ? 'Xero returned this document in validation Elements' : item.HasErrors ? 'Xero reports validation errors' : '')});
    });
  }
  requireValue(rows.length > 0, 'Choose an original response containing Invoices or CreditNotes document records.');
  return {source, rows};
}
function renderNativeSample(sample) {
  const wrap = node('div', null, {className: 'review'});
  wrap.append(node('h4', 'Original Xero document records'), node('p',
    sample.rows.length + ' returned records · ' + (sample.source.ProviderName || 'Accounting API response'), {className: 'hint'}));
  const tableWrap = node('div', null, {className: 'table-wrap'}), table = node('table'), head = node('thead'), headings = node('tr'), body = node('tbody');
  for (const label of ['Source pointer', 'Document', 'Kind', 'Xero ID', 'Status', 'Net', 'Tax', 'Total', 'Currency', 'Validation errors'])
    headings.append(node('th', label));
  head.append(headings);
  for (const item of sample.rows.slice(0,100)) {
    const row = node('tr');
    row.append(cell(item.pointer, 'mono'), textCell(item.number, item.contact), cell(item.kind), cell(item.id, 'mono'),
      cell(item.status), cell(item.net, 'numeric'), cell(item.tax, 'numeric'), cell(item.total, 'numeric'), cell(item.currency), cell(item.error));
    body.append(row);
  }
  table.append(head, body); tableWrap.append(table); wrap.append(tableWrap);
  if (sample.rows.length > 100) wrap.append(node('p', 'The preview shows the first 100 records; the complete original file is retained and evaluated.', {className: 'hint'}));
  replace('native-source-preview', [wrap]); $('native-source-preview').hidden = false;
}
async function chooseReturnedFile() {
  const epoch = ++view.returnEpoch, packageId = view.packageId, selected = $('returned-file').files[0], format = $('returned-format').value;
  view.returned = null; $('result-mapping').disabled = true; syncActions();
  replace('result-columns', []); replace('returned-preview', []); replace('native-source-preview', []); $('native-source-preview').hidden = true;
  if (!selected) { sourceFormatChanged(); return; }
  const source = await originalFile(selected, config.returnedFileBytes);
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(source.bytes); }
  catch { throw new Error('Choose the original returned file encoded as UTF-8.'); }
  if (epoch !== view.returnEpoch || packageId !== view.packageId || selected !== $('returned-file').files[0] || format !== $('returned-format').value) return;
  if (format === 'NATIVE_JSON') {
    const sample = nativeDocumentSample(text);
    view.returned = {file: source.file, packageId, format};
    renderNativeSample(sample);
    $('returned-file-info').textContent = source.file.name + ' · ' + byteCount(source.bytes.length) + ' · ' + sample.rows.length + ' original JSON document records';
  } else {
    const rows = csvSample(text), headers = rows[0];
    requireValue(headers?.length && headers.every(header => header.length > 0), 'The returned CSV must contain a nonempty header for each column.');
    requireValue(new Set(headers).size === headers.length, 'The returned CSV contains repeated headers; select an original document-summary export with distinct column names.');
    view.returned = {file: source.file, packageId, headers, format};
    const controls = COLUMN_FIELDS.map(([key, label, candidates]) => {
      const field = node('label', label), select = node('select', null, {id: 'column-' + key, 'data-result-column': key});
      select.required = key !== 'error';
      select.append(option('', key === 'error' ? 'No error column' : 'Choose a column'));
      headers.forEach((header, index) => select.append(option(String(index), header)));
      const match = headers.findIndex(header => candidates.includes(header.replace(/^\*/, '').replace(/[\s_-]/g, '').toLowerCase()));
      if (match >= 0) select.value = String(match);
      field.append(select); return field;
    });
    replace('result-columns', controls); $('result-mapping').disabled = false;
    $('returned-file-info').textContent = source.file.name + ' · ' + byteCount(source.bytes.length) +
      ' · ' + headers.length + ' original columns · showing the first ' + Math.max(0, rows.length - 1) + ' data rows';
    renderReturnedSample(rows);
  }
  syncActions();
}
async function receiveReturnedFile() {
  requireValue(view.package && view.returned?.packageId === view.packageId && view.returned.format === $('returned-format').value,
    'Select the original return for this package and source format.');
  requireValue($('receive-form').reportValidity(), 'Complete the returned file fields and source interpretation.');
  const importedStatusValues = $('returned-statuses').value.split(',').map(value => value.trim()).filter(Boolean);
  const retiredStatusValues = $('retired-statuses').value.split(',').map(value => value.trim()).filter(Boolean);
  requireValue(importedStatusValues.length > 0, 'Enter exact status values that mean the document was imported.');
  requireValue(retiredStatusValues.length > 0 && !retiredStatusValues.some(value => importedStatusValues.includes(value)),
    'Imported and retired document statuses must be separate.');
  const receivedAt = $('returned-at').value.trim();
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(receivedAt) && Number.isFinite(Date.parse(receivedAt)),
    'Use a complete UTC timestamp, for example 2026-10-12T14:30:00.000Z.');
  const normalized = receivedAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => '.' + (fraction || '').padEnd(3, '0') + 'Z');
  requireValue(new Date(receivedAt).toISOString() === normalized, 'Check the calendar fields in the UTC received time.');
  const payload = {format: view.returned.format, file: view.returned.file, importedStatusValues, retiredStatusValues, receivedAt,
    organisation: $('returned-organisation').value.trim()};
  if (view.returned.format === 'CSV_SUMMARY') {
    const columns = {};
    for (const [key] of COLUMN_FIELDS) {
      const value = $('column-' + key).value;
      if (value !== '') columns[key] = view.returned.headers[Number(value)];
    }
    const decimalSeparator = $('decimal-separator').value, groupSeparator = $('group-separator').value;
    requireValue(!groupSeparator || groupSeparator !== decimalSeparator, 'Decimal and thousands separators must be different.');
    Object.assign(payload, {columns, decimalSeparator, groupSeparator, creditSign: $('credit-sign').value});
  }
  await mutate('receive', 'Original returned file', payload, view.packageId);
}
function listen(id, eventName, handler) {
  $(id).addEventListener(eventName, event => {
    if (eventName === 'submit') event.preventDefault();
    Promise.resolve().then(() => handler(event)).catch(report);
  });
}
function bindEvents() {
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    const page = target.dataset.page || target.dataset.go;
    if (page) { selectPage(page); return; }
    const action = target.dataset.action, value = target.dataset.value;
    if (!action) return;
    Promise.resolve().then(async () => {
      if (action === 'package') await openPackage(value);
      else if (action === 'file') await downloadResponse(await client.file(view.packageId, value), value);
      else if (action === 'remove-mapping') {
        const [documentId, lineId] = JSON.parse(value);
        view.lineMappings = view.lineMappings.filter(item => !(item.documentId === documentId && item.lineId === lineId));
        markProfileDirty(); renderLineMappings();
      }
    }).catch(report);
  });
  listen('refresh', 'click', async () => {
    $('refresh').disabled = true;
    try {
      await loadState();
      if (view.packageId) await openPackage(view.packageId);
      notice('Current accounting revision and handover outcomes refreshed.', 'success');
    } finally { $('refresh').disabled = false; }
  });
  listen('actor', 'input', () => { try { localStorage.setItem('starforge.xero.actor', $('actor').value); } catch { /* Optional preference. */ } });
  listen('queue-filter', 'input', renderQueue); listen('queue-state', 'change', renderQueue);
  listen('new-profile', 'click', () => showProfile(''));
  listen('reload-profile', 'click', () => showProfile(view.profileId));
  listen('profile-select', 'change', () => showProfile($('profile-select').value));
  listen('profile-form', 'submit', event => { event.preventDefault(); return saveProfile(); });
  for (const id of ['profile-name', 'profile-organisation', 'profile-currency', 'profile-scale', 'profile-account', 'profile-tax', 'invoice-date-format', 'credit-date-format'])
    listen(id, 'input', markProfileDirty);
  listen('contacts-body', 'input', event => {
    const id = event.target.dataset.customerId;
    if (id) { view.contacts.set(id, event.target.value); markProfileDirty(); }
  });
  listen('contact-filter', 'input', renderContacts);
  listen('mapping-document', 'change', loadLineSource);
  listen('mapping-line', 'change', () => {
    $('add-line-mapping').disabled = !($('mapping-line').value && view.lineSource?.id === $('mapping-document').value);
  });
  listen('add-line-mapping', 'click', addLineMapping);
  listen('invoice-template', 'change', () => chooseTemplate('invoice'));
  listen('credit-template', 'change', () => chooseTemplate('credit'));
  listen('selection-profile', 'change', () => { invalidatePreview(); renderSelectionProfile(); });
  listen('selection-date', 'change', invalidatePreview);
  listen('document-filter', 'input', renderDocuments); listen('document-kind', 'change', renderDocuments);
  listen('documents-body', 'change', event => {
    const id = event.target.dataset.documentId;
    if (!id) return;
    if (event.target.checked) view.selected.add(id); else view.selected.delete(id);
    invalidatePreview(); renderDocuments();
  });
  listen('select-visible', 'change', () => {
    for (const item of filteredDocuments().filter(item => item.eligible))
      if ($('select-visible').checked) view.selected.add(item.id); else view.selected.delete(item.id);
    invalidatePreview(); renderDocuments();
  });
  listen('clear-selection', 'click', () => { view.selected.clear(); invalidatePreview(); renderDocuments(); });
  listen('selection-form', 'submit', event => { event.preventDefault(); return reviewSelection(false); });
  listen('prepare-package', 'click', () => prepareReviewed(false));
  listen('returned-format', 'change', sourceFormatChanged);
  listen('returned-file', 'change', chooseReturnedFile);
  listen('receive-form', 'submit', event => { event.preventDefault(); return receiveReturnedFile(); });
  listen('correction-form', 'submit', event => { event.preventDefault(); return reviewSelection(true); });
  listen('correction-profile', 'change', invalidateCorrection);
  listen('outcomes-body', 'change', event => {
    const id = event.target.dataset.correctionId;
    if (!id) return;
    if (event.target.checked) view.correctionIds.add(id); else view.correctionIds.delete(id);
    invalidateCorrection(); $('correction-count').textContent = view.correctionIds.size + ' unresolved documents selected';
  });
  listen('create-correction', 'click', () => prepareReviewed(true));
  listen('export-tar', 'click', async () => {
    const id = view.packageId; await downloadResponse(await client.exportFile(id), 'xero-handover-' + id + '.tar');
  });
  listen('export-json', 'click', async () => {
    const id = view.packageId; saveJson(await client.export(id), 'xero-handover-' + id + '.json');
  });
  listen('retry-operation', 'click', sendPending);
  listen('download-operation', 'click', () => {
    if (view.pending) saveJson(view.pending, 'xero-operation-' + view.pending.value.requestId + '.json');
  });
  window.addEventListener('hashchange', () => followHash().catch(report));
}
async function followHash() {
  const raw = location.hash.slice(1);
  if (raw.startsWith('package/')) {
    let id;
    try { id = decodeURIComponent(raw.slice(8)); } catch { throw new Error('The package link is malformed.'); }
    if (id) await openPackage(id);
  } else selectPage(PAGES.includes(raw) ? raw : 'queue', false);
}
async function start() {
  const response = await fetch('./config.json', {cache: 'no-store', credentials: 'same-origin', redirect: 'error'});
  if (!response.ok) throw new Error('The local handover configuration could not be read.');
  config = await response.json();
  for (const key of ['apiPath', 'uiPath', 'receivablesApiPath', 'receivablesUiPath'])
    requireValue(typeof config[key] === 'string' && config[key].startsWith('/') && !config[key].startsWith('//'),
      'The local handover route configuration is invalid.');
  client = new XeroReceivablesClient({baseUrl: config.apiPath});
  nativeClient = new XeroReceivablesClient({baseUrl: config.receivablesApiPath});
  for (const link of document.querySelectorAll('#receivables-link, [data-receivables-link]'))
    link.href = config.receivablesUiPath.replace(/\/$/, '') + '/';
  $('native-return-guide').href = config.uiPath.replace(/\/$/, '') + '/NATIVE_RETURN.md';
  try { $('actor').value = localStorage.getItem('starforge.xero.actor') || ''; } catch { /* Optional preference. */ }
  bindEvents();
  await loadState();
  await followHash();
}
start().catch(error => { $('revision').textContent = 'Workspace unavailable'; report(error); });
