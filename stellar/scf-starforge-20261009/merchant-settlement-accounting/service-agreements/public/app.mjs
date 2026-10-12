import {createServiceAgreementClient} from './client.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const array = value => Array.isArray(value) ? value : [];
const json = value => JSON.stringify(value, null, 2);
const label = value => String(value ?? '').replaceAll('_', ' ').toLowerCase().replace(/^\w/, letter => letter.toUpperCase());
const day = value => typeof value === 'string' ? value.slice(0, 10) : '—';
const when = value => typeof value === 'string' ? value.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC') : '—';
const money = (value, currency) => {
  const code = typeof currency === 'string' ? currency : currency?.code;
  return (code ? code + ' ' : '') + String(value ?? '—');
};
const localToday = () => {
  const now = new Date();
  return String(now.getFullYear()).padStart(4, '0') + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
};
const configuration = await (async () => {
  try {
    const response = await fetch(new URL('./config.json', import.meta.url), {credentials: 'same-origin', cache: 'no-store'});
    if (!response.ok) throw new Error('Cannot load the service-agreement operator configuration.');
    return await response.json();
  } catch (error) {
    $('#message').innerHTML = '<div class="notice error"><p>' + esc(error.message) + '</p><p>Reload this page to reopen the operator.</p></div>';
    $('#revision').textContent = 'Workspace not opened';
    throw error;
  }
})();
const localPath = (value, fallback) => typeof value === 'string' && value.startsWith('/') &&
  !value.startsWith('//') && !value.includes('\\') ? value : fallback;
const apiPath = localPath(configuration.apiPath, '/api/service-agreements').replace(/\/+$/, '');
const apiUrl = new URL(apiPath, location.origin).href;
const receivablesPath = localPath(configuration.receivablesPath, '/receivables/');
const customersPath = localPath(configuration.customersPath, '/customer-statements/');
const requestBytes = Number.isSafeInteger(configuration.requestBytes) && configuration.requestBytes > 0
  ? configuration.requestBytes : 2000000;
const client = createServiceAgreementClient({baseUrl: apiUrl});
const pendingPrefix = 'tjlabs.service-agreements.pending.v1:' + apiUrl + ':';
const allowedMutations = new Set(['create', 'amend', 'renew', 'cancel', 'bill']);
const state = {
  data: null, selectedId: null, detail: null, view: 'agreements',
  reading: false, detailReading: false, mutationRunning: false, pending: null,
  pendingWorkspace: null, modal: null, historyPage: 0
};
let refreshSequence = 0;
let detailSequence = 0;
let dialogSequence = 0;

$('#as-of').value = localToday();
$('#receivables-link').href = receivablesPath;
$('#customers-link').href = customersPath;
try {
  const saved = sessionStorage.getItem('tjlabs.service-agreements.operator');
  if (saved) $('#operator').value = saved;
} catch {}
$('#operator').addEventListener('change', () => {
  try { sessionStorage.setItem('tjlabs.service-agreements.operator', $('#operator').value); } catch {}
});

function notice(target, message, error = null, kind = '') {
  const code = error?.code ? '<div class="error-code">' + esc(error.code) + '</div>' : '';
  const details = error?.details && Object.keys(error.details).length
    ? '<details><summary>Operation details</summary><pre>' + esc(json(error.details)) + '</pre></details>' : '';
  $(target).innerHTML = message ? '<div class="notice ' + (kind || (error ? 'error' : '')) + '">' +
    '<p>' + esc(message) + '</p>' + code + details + '</div>' : '';
}
function showError(error, target = '#message') {
  notice(target, error?.message || String(error), error);
}
function workspaceId() { return state.data?.workspaceId || null; }
function asOf() { return $('#as-of').value || localToday(); }
function actor() {
  const value = $('#operator').value.trim();
  if (!value) throw new Error('Enter the accountable operator before saving.');
  if (value.length > 160) throw new Error('The operator name must contain at most 160 characters.');
  return value;
}
function pendingKey(id) { return pendingPrefix + encodeURIComponent(id); }
function readPending(id) {
  try {
    const text = sessionStorage.getItem(pendingKey(id));
    if (!text) return null;
    const record = JSON.parse(text);
    if (record.schema !== 'stellar-forge.service-agreement-browser-request.v1' ||
      record.workspaceId !== id || record.apiUrl !== apiUrl || !allowedMutations.has(record.action) ||
      !record.body || typeof record.body.requestId !== 'string' ||
      typeof record.body.actor !== 'string' || !Number.isSafeInteger(record.body.revision) ||
      (record.action !== 'create' && typeof record.agreementId !== 'string')) {
      notice('#message', 'The saved request could not be read. Its original session record remains available.', null, 'warning');
      return null;
    }
    return record;
  } catch (error) {
    notice('#message', 'The browser could not read its saved pending request. ' + error.message, null, 'warning');
    return null;
  }
}
function loadPendingForWorkspace(id) {
  if (state.pendingWorkspace === id) return;
  state.pendingWorkspace = id;
  state.pending = id ? readPending(id) : null;
}
function retainPending(record) {
  state.pending = record;
  state.pendingWorkspace = record.workspaceId;
  try {
    sessionStorage.setItem(pendingKey(record.workspaceId), JSON.stringify(record));
  } catch {
    record.memoryOnly = true;
  }
  renderPending();
  syncControls();
}
function clearPending(record = state.pending) {
  if (!record) return;
  try { sessionStorage.removeItem(pendingKey(record.workspaceId)); } catch {}
  if (state.pending?.body.requestId === record.body.requestId) state.pending = null;
  renderPending();
  syncControls();
}
function renderPending() {
  const record = state.pending;
  if (!record) { $('#pending').innerHTML = ''; return; }
  const current = record.workspaceId === workspaceId();
  const extra = record.memoryOnly
    ? ' Keep this tab open or save the original request file before leaving.' : '';
  $('#pending').innerHTML = '<div class="notice warning"><strong>Original request awaiting its outcome</strong>' +
    '<p>' + esc(record.label) + '. Retry continues the same saved request and operator.' + esc(extra) + '</p>' +
    '<span class="meta">' + esc(record.body.actor) + ' · ' + esc(when(record.createdAt)) + '</span>' +
    '<div class="actions"><button type="button" class="primary" data-action="retry-pending"' +
    (!current || state.mutationRunning || state.reading ? ' disabled' : '') + '>Retry original request</button>' +
    '<button type="button" data-action="save-pending">Save request file</button></div>' +
    (current ? '' : '<p class="help">Reopen its original accounting workspace to continue.</p>') + '</div>';
}
function syncControls() {
  const blocked = !state.data || state.reading || state.mutationRunning || Boolean(state.pending);
  for (const button of $$('[data-mutation]')) {
    button.disabled = blocked || button.hasAttribute('data-fixed-disabled') ||
      (button.id === 'dialog-submit' && Boolean(state.modal?.fileLoads || state.modal?.foreignWorkspace));
  }
  for (const control of $$('#agreement-form input, #agreement-form select, #agreement-form textarea')) {
    control.disabled = state.mutationRunning || Boolean(state.pending);
  }
  for (const input of $$('input[data-source="quote"], input[data-source="response"]')) {
    input.disabled = state.mutationRunning || Boolean(state.pending) || Boolean(state.modal?.renewalJson || state.modal?.renewalLoading || state.modal?.requireRenewal);
  }
  const clearRenewal = $('#remove-renewal');
  if (clearRenewal) clearRenewal.disabled = blocked || Boolean(state.modal?.fileLoads);
  for (const button of $$('[data-action="refresh"]')) button.disabled = state.reading || state.mutationRunning;
  const retry = $('[data-action="retry-pending"]');
  if (retry) retry.disabled = state.mutationRunning || state.reading ||
    state.pending?.workspaceId !== workspaceId();
  $('#revision').textContent = state.data
    ? 'Revision ' + state.data.revision + ' · as of ' + asOf() + (state.reading ? ' · refreshing…' : '')
    : 'Opening workspace…';
}
function downloadObject(name, value) {
  const url = URL.createObjectURL(new Blob([json(value) + '\n'], {type: 'application/json;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validateRead(data) {
  if (!data || typeof data.workspaceId !== 'string' || !Number.isSafeInteger(data.revision)) {
    throw new Error('The service-agreement response is missing its original workspace or revision.');
  }
}
function refreshCustomerFilter() {
  const selected = $('#customer-filter').value;
  const customers = array(state.data?.customers);
  $('#customer-filter').innerHTML = '<option value="">All customers</option>' +
    customers.map(customer => '<option value="' + esc(customer.id) + '">' +
      esc(customer.name || customer.billingName || customer.title || customer.id) + '</option>').join('');
  if (customers.some(customer => customer.id === selected)) $('#customer-filter').value = selected;
}
async function refresh({quiet = false} = {}) {
  const sequence = ++refreshSequence;
  state.reading = true; syncControls();
  try {
    const data = await client.state({asOf: asOf()});
    if (sequence !== refreshSequence) return;
    validateRead(data);
    const previousWorkspace = workspaceId();
    state.data = data;
    if (previousWorkspace && previousWorkspace !== data.workspaceId) {
      state.selectedId = null; state.detail = null;
      if (state.modal) {
        state.modal.foreignWorkspace = true;
        notice('#dialog-message', 'This listener now opens a different accounting workspace. The entered form is kept here for review.', null, 'warning');
      }
    }
    loadPendingForWorkspace(data.workspaceId);
    refreshCustomerFilter();
    render();
    if (state.selectedId) await loadDetail(state.selectedId, {focus: false});
    if (!quiet && !state.pending) notice('#message', 'Current agreements and billing periods are loaded.');
  } catch (error) {
    if (sequence === refreshSequence) showError(error);
  } finally {
    if (sequence === refreshSequence) { state.reading = false; syncControls(); renderPending(); }
  }
}
async function loadDetail(id, {focus = true} = {}) {
  const sequence = ++detailSequence;
  if (state.selectedId !== id) state.detailHistoryPage = 0;
  state.selectedId = id; state.detailReading = true;
  renderDetail();
  try {
    const detail = await client.detail(id, {asOf: asOf()});
    if (sequence !== detailSequence || state.selectedId !== id) return;
    validateRead(detail);
    if (detail.workspaceId !== workspaceId()) throw new Error('The returned agreement belongs to another accounting workspace.');
    if (detail.agreement?.id !== id) throw new Error('The returned agreement does not match the selected agreement.');
    state.detail = detail;
    renderDetail();
    renderMain();
    if (focus) $('#detail').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {
    if (sequence === detailSequence) {
      state.detail = null;
      $('#detail').hidden = false;
      $('#detail').innerHTML = '<section class="panel"><div class="panel-body"><h2>Agreement could not be opened</h2>' +
        '<p>' + esc(error.message) + '</p><button type="button" data-action="detail" data-id="' + esc(id) + '">Try again</button></div></section>';
      showError(error);
    }
  } finally {
    if (sequence === detailSequence) state.detailReading = false;
    syncControls();
  }
}
function agreementName(agreement) { return agreement.reference || agreement.title || agreement.id; }
function filteredAgreements() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const customer = $('#customer-filter').value;
  const status = $('#status-filter').value;
  return array(state.data?.agreements).filter(agreement =>
    (!customer || agreement.customerId === customer) && (!status || agreement.status === status) &&
    (!query || [agreement.reference, agreement.title, agreement.customerName, agreement.id]
      .some(value => String(value || '').toLocaleLowerCase().includes(query))));
}
function badge(status) {
  return '<span class="badge' + (status === 'DUE' || status === 'PREPARING' ? ' emphasis' : '') + '">' +
    esc(label(status)) + '</span>';
}
function empty(title, text) {
  return '<section class="empty"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></section>';
}
function periodRange(period) {
  return esc(day(period.startDate)) + ' → ' + esc(day(period.endDate)) +
    '<span class="subline">' + esc(period.periodCount) + ' month' + (period.periodCount === 1 ? '' : 's') + ' · end exclusive</span>';
}
function periodAction(agreement, period) {
  const preview = '<button type="button" class="small" data-action="preview" data-id="' + esc(agreement.id) +
    '" data-period="' + esc(period.id) + '">' +
    (period.status === 'PREPARING' ? 'Resume billing' : period.status === 'VOID' && period.canPrepare ? 'Review replacement' : period.status === 'DUE' ? 'Review draft' : 'Preview') + '</button>';
  if (period.status === 'DRAFT' || period.status === 'ISSUED' || (period.status === 'VOID' && !period.canPrepare)) {
    return '<a class="button-link small" href="' + esc(receivablesPath) + '">Open receivables</a>' +
      (period.invoiceNumber || period.invoiceId ? '<span class="subline">' + esc(period.invoiceNumber || period.invoiceId) + '</span>' : '');
  }
  return preview;
}
function downloadLinks(id) {
  const base = apiPath + '/agreements/' + encodeURIComponent(id) + '/export?asOf=' + encodeURIComponent(asOf()) + '&format=';
  return '<div class="actions"><span class="meta">Complete agreement:</span>' +
    ['tar', 'json', 'csv', 'html'].map(format => '<a class="button-link small" href="' + esc(base + format) +
      '" download>Download ' + (format === 'tar' ? 'package' : format.toUpperCase()) + '</a>').join('') + '</div>';
}

function metrics(agreements) {
  const periods = agreements.flatMap(agreement => array(agreement.periods));
  return '<section class="metrics" aria-label="Current selection"><div class="metric"><strong>' +
    agreements.length + '</strong><span>agreements in this view</span></div><div class="metric"><strong>' +
    periods.filter(period => period.status === 'DUE' || period.status === 'PREPARING').length +
    '</strong><span>periods ready for review</span></div><div class="metric"><strong>' +
    periods.filter(period => period.status === 'DRAFT').length +
    '</strong><span>invoice drafts in receivables</span></div></section>';
}
function agreementsTable(agreements) {
  if (!agreements.length) return empty('No agreements in this view', array(state.data?.agreements).length
    ? 'Change the customer, status or search filter to open another agreement.'
    : 'Create an agreement from the original quotation and its accepted customer response.');
  return '<section class="panel"><div class="panel-head"><h2>Agreements</h2><span class="meta">' +
    agreements.length + ' saved agreement' + (agreements.length === 1 ? '' : 's') + '</span></div>' +
    '<div class="table-wrap"><table><thead><tr><th scope="col">Agreement</th><th scope="col">Customer</th>' +
    '<th scope="col">Service term</th><th scope="col">Status</th><th scope="col">Billing</th><th scope="col">Open</th></tr></thead><tbody>' +
    agreements.map(agreement => {
      const periods = array(agreement.periods);
      const due = periods.filter(period => period.status === 'DUE' || period.status === 'PREPARING');
      const next = periods.filter(period => period.status === 'UPCOMING')
        .sort((a, b) => String(a.issueDate).localeCompare(String(b.issueDate)))[0];
      return '<tr' + (state.selectedId === agreement.id ? ' class="selected"' : '') + '><td><strong>' +
        esc(agreement.reference || agreement.title) + '</strong><span class="subline">' + esc(agreement.title) +
        '</span></td><td>' + esc(agreement.customerName || agreement.customerId) + '</td><td class="nowrap">' +
        esc(day(agreement.startDate)) + ' → ' + esc(day(agreement.endDate)) +
        '<span class="subline">' + esc(agreement.termMonths) + ' months · end exclusive</span></td><td>' +
        badge(agreement.status) + '</td><td>' + (due.length ? '<strong>' + due.length + ' to review</strong>' :
          next ? 'Next invoice ' + esc(day(next.issueDate)) : 'No period awaiting billing') +
        '<span class="subline">Edition ' + esc(agreement.version) + '</span></td><td><button type="button" class="small" data-action="detail" data-id="' +
        esc(agreement.id) + '">Open agreement</button></td></tr>';
    }).join('') + '</tbody></table></div></section>';
}
function calendarTable(agreements) {
  const filter = $('#period-filter').value;
  const rows = agreements.flatMap(agreement => array(agreement.periods).map(period => ({agreement, period})))
    .filter(({period}) => filter === 'due' ? ['DUE', 'PREPARING'].includes(period.status) : !filter || period.status === filter)
    .sort((a, b) => String(a.period.issueDate).localeCompare(String(b.period.issueDate)) ||
      agreementName(a.agreement).localeCompare(agreementName(b.agreement)) ||
      String(a.period.startDate).localeCompare(String(b.period.startDate)));
  if (!rows.length) return empty(filter === 'due' ? 'No periods are due in this view' : 'No matching billing periods',
    'Choose another date or billing-period filter to review the retained calendar.');
  return '<section class="panel"><div class="panel-head"><h2>Billing calendar</h2><span class="meta">' +
    rows.length + ' period' + (rows.length === 1 ? '' : 's') + ' · as of ' + esc(asOf()) + '</span></div>' +
    '<div class="table-wrap"><table><caption>Service intervals include their start date and exclude their end date.</caption>' +
    '<thead><tr><th scope="col">Agreement / customer</th><th scope="col">Service period</th><th scope="col">Invoice date</th>' +
    '<th scope="col">Payment due</th><th scope="col" class="align-right">Quoted charge</th><th scope="col">Status</th>' +
    '<th scope="col">Work</th></tr></thead><tbody>' + rows.map(({agreement, period}) =>
      '<tr><td><button type="button" class="text" data-action="detail" data-id="' + esc(agreement.id) + '">' +
      esc(agreementName(agreement)) + '</button><span class="subline">' + esc(agreement.customerName || agreement.customerId) +
      '</span></td><td class="nowrap">' + periodRange(period) + '</td><td class="nowrap">' + esc(day(period.issueDate)) +
      '</td><td class="nowrap">' + esc(day(period.dueDate)) + '</td><td class="align-right amount">' +
      esc(money(period.amount, period.currency)) + '</td><td>' + badge(period.status) + '</td><td>' +
      periodAction(agreement, period) + '</td></tr>').join('') + '</tbody></table></div></section>';
}
function eventAgreementId(event) { return event.agreementId || event.agreement?.id || null; }
function eventTime(event) { return event.createdAt || event.at || event.timestamp || event.time || ''; }
function eventName(event) { return event.action || event.type || event.kind || 'Recorded change'; }
function historyTable(events, scope = 'all') {
  const key = scope === 'detail' ? 'detailHistoryPage' : 'historyPage';
  const size = 30;
  const sorted = [...events].sort((a, b) => String(eventTime(b)).localeCompare(String(eventTime(a))));
  const last = Math.max(0, Math.ceil(sorted.length / size) - 1);
  const page = Math.min(state[key] || 0, last);
  state[key] = page;
  const selected = sorted.slice(page * size, (page + 1) * size);
  if (!selected.length) return '<div class="panel-body"><p class="help">The current selection has no saved history events.</p></div>';
  const names = new Map(array(state.data?.agreements).map(agreement => [agreement.id, agreementName(agreement)]));
  return '<div class="table-wrap"><table><thead><tr><th scope="col">Recorded</th><th scope="col">Change</th>' +
    (scope === 'all' ? '<th scope="col">Agreement</th>' : '') +
    '<th scope="col">Operator</th><th scope="col">Retained event</th></tr></thead><tbody>' +
    selected.map(event => '<tr><td class="nowrap">' + esc(when(eventTime(event))) + '</td><td>' + esc(label(eventName(event))) +
      '</td>' + (scope === 'all' ? '<td>' + esc(names.get(eventAgreementId(event)) || eventAgreementId(event) || 'Workspace') + '</td>' : '') +
      '<td>' + esc(event.actor || event.operator || '—') + '</td><td class="history-details"><details><summary>' +
      esc(event.reason || event.summary || 'Open complete event') + '</summary><pre>' + esc(json(event)) +
      '</pre></details></td></tr>').join('') + '</tbody></table></div><div class="pager">' +
    '<span class="meta">' + (page * size + 1) + '–' + Math.min((page + 1) * size, sorted.length) + ' of ' + sorted.length + '</span>' +
    '<button type="button" class="small" data-action="history-page" data-scope="' + scope + '" data-page="' + (page - 1) + '"' +
    (page === 0 ? ' disabled' : '') + '>Previous</button><button type="button" class="small" data-action="history-page" data-scope="' +
    scope + '" data-page="' + (page + 1) + '"' + (page >= last ? ' disabled' : '') + '>Next</button></div>';
}
function historyView(agreements) {
  const ids = new Set(agreements.map(agreement => agreement.id));
  let events = array(state.data?.history);
  if (!events.length) {
    events = array(state.data?.agreements).flatMap(agreement =>
      array(agreement.history).map(event => ({...event, agreementId: eventAgreementId(event) || agreement.id})));
  }
  const hasFilter = Boolean($('#search').value.trim() || $('#customer-filter').value || $('#status-filter').value);
  events = events.filter(event => eventAgreementId(event) ? ids.has(eventAgreementId(event)) : !hasFilter);
  return '<section class="panel"><div class="panel-head"><h2>Agreement history</h2><span class="meta">Original changes and billing events</span></div>' +
    historyTable(events) + '</section>';
}
function renderMain() {
  if (!state.data) return;
  const agreements = filteredAgreements();
  $('#period-filter-label').hidden = state.view !== 'calendar';
  for (const button of $$('.tabs [data-view]')) {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#content').innerHTML = metrics(agreements) + (state.view === 'calendar' ? calendarTable(agreements) :
    state.view === 'history' ? historyView(agreements) : agreementsTable(agreements));
  syncControls();
}
function sourceLinks(agreementId, sourceId, renewal = null) {
  if (!sourceId) return '';
  const base = apiPath + '/agreements/' + encodeURIComponent(agreementId) + '/sources/' + encodeURIComponent(sourceId) + '/';
  return '<div class="actions">' + [
    ['quote.json', 'Quotation'], ['response.json', 'Accepted response'], ['source.json', 'Source'], ['review.json', 'Calculation review'],
    ...(renewal ? [['renewal.json', 'Original renewal handover']] : [])
  ].map(([file, title]) => '<a class="button-link small" href="' + esc(base + file) + '" download>' + title + '</a>').join('') + '</div>';
}

function tariffBasisView(tariff, imported = null) {
  if (!tariff?.basis) return '';
  const basis = tariff.basis;
  const amount = value => 'USD ' + esc(value ?? '—');
  return '<section class="section-title"><h3>Accepted tariff basis</h3><p class="help">' + esc(basis.text) + '</p>' +
    '<dl class="definition-grid"><div><dt>Tariff</dt><dd>' + esc(basis.tariffLabel) +
    '</dd></div><div><dt>Schedule</dt><dd>' + esc(label(basis.mode)) +
    '</dd></div><div><dt>Saved selection volume / month</dt><dd class="amount">' + esc(basis.selectedQuantity) +
    '</dd></div><div><dt>Quoted requests / month</dt><dd class="amount">' + esc(basis.quotedQuantity) +
    '</dd></div><div><dt>Quoted uniform rate / request</dt><dd class="amount">' + amount(basis.uniformUnitUsd) +
    '</dd></div><div><dt>Original selected tariff total</dt><dd class="amount">' + amount(basis.originalTariffGrossUsd) +
    '</dd></div><div><dt>Original upward unit rounding</dt><dd class="amount">' + amount(basis.originalRoundingDeltaUsd) +
    '</dd></div>' + (imported ? '<div><dt>Original quoted route / month</dt><dd class="amount">' +
      amount(imported.originalMonthlyAmountUsd) + '</dd></div>' : '') + '</dl>' +
    (basis.changedQuantity ? '<div class="notice"><strong>Quoted volume changed</strong><p>At ' + esc(basis.quotedQuantity) +
      ' requests, the retained tier comparison totals ' + amount(basis.tariffGrossAtQuotedQuantityUsd) + '. ' +
      (basis.derivedUnitAtQuotedQuantityUsd === null ? 'The zero-request comparison has no per-request rate.' :
        'Its comparison rate is ' + amount(basis.derivedUnitAtQuotedQuantityUsd) + ' per request.') +
      ' The accepted quotation uses its saved uniform rate of ' + amount(basis.uniformUnitUsd) + ' per request.</p></div>' : '') +
    (imported?.includedInScope ? '<p class="help">This billing scope carries the original quoted route for ' +
      esc(imported.periodCount) + ' complete month' + (imported.periodCount === 1 ? '' : 's') + ': ' +
      amount(imported.invoiceAmount) + ' at the selected invoice precision.</p>' : '') +
    '<details><summary>Original tariff tiers and source</summary><div class="table-wrap"><table><thead><tr>' +
    '<th scope="col">Request quantity</th><th scope="col" class="align-right">USD / request</th></tr></thead><tbody>' +
    array(tariff.tiers).map(tier => '<tr><td>' + (tier.upTo === null ? 'Remaining requests' : 'Through ' + esc(tier.upTo)) +
      '</td><td class="align-right amount">' + esc(tier.unitPriceUsd) + '</td></tr>').join('') +
    '</tbody></table></div><p class="meta">Original selection ' + esc(tariff.selectionRequestId) +
    '</p><p class="meta">Source ' + esc(tariff.id) + '</p></details></section>';
}


function performanceBasisView(binding, imported = null) {
  if (!binding) return '';
  const period = binding.period || {}, measured = binding.measuredQuote || {}, proposed = binding.proposed || {};
  const date = value => String(value || '').replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const observed = [period.observedFrom, period.observedUntil].filter(Boolean).map(date).join(' → ');
  const amount = value => value === null || value === undefined ? '—' : 'USD ' + esc(value);
  const row = (name, value) => '<tr><th scope="row">' + esc(name) + '</th><td>' + value + '</td></tr>';
  const counts = Object.entries(binding.basis?.counts || {});
  const notes = Array.isArray(binding.issues) ? binding.issues : [];
  return '<section class="section-title"><h3>Recorded usage and this quotation revision</h3>' +
    '<p class="help">The saved review describes its measured period. This quotation records the proposed monthly requests and accepted price separately.</p>' +
    '<div class="table-wrap"><table><tbody>' +
    row('Measured quotation', esc(measured.title || measured.id)) +
    row('Observed period', esc(observed || 'Saved observation period')) +
    row('Recorded quantity', esc(binding.basis?.quantity ?? '—') + ' ' + esc(binding.basis?.label || '')) +
    row('Measured route', esc(binding.route?.method) + ' ' + esc(binding.route?.path)) +
    row('Earlier quoted uniform rate / request', amount(binding.quoted?.savedUnitUsd)) +
    row('Earlier quote value at recorded quantity', amount(binding.quoted?.valueAtObservedQuantityUsd)) +
    row('Original tariff total at recorded quantity', amount(binding.tariff?.quote?.totalUsd)) +
    row('Proposed requests / month', esc(proposed.monthlyRequests)) +
    row('Revised quoted rate / request', amount(proposed.unitUsd)) +
    row('Revised quoted route / month', amount(proposed.amountUsd)) +
    (imported?.includedInScope ? row('Imported route charge', amount(imported.invoiceAmount) + ' · ' +
      esc(imported.periodCount) + ' complete month' + (imported.periodCount === 1 ? '' : 's')) : '') +
    '</tbody></table></div><details class="section-title"><summary>Saved cost view, source counts and identities</summary>' +
    '<div class="table-wrap"><table><tbody>' +
    row('Estimated cost at recorded quantity', amount(binding.costs?.estimated?.valueAtBasisQuantityUsd)) +
    row('Contribution using estimated unit cost', amount(binding.costs?.contributionUsingEstimatedUnitCostUsd)) +
    (binding.costs?.recorded ? row('Recorded cost edition', esc(binding.costs.recorded.edition)) +
      row('Cost period alignment', esc(typeof binding.costs.recorded.periodAlignment === 'object' ?
        JSON.stringify(binding.costs.recorded.periodAlignment) : binding.costs.recorded.periodAlignment)) : '') +
    counts.map(([key, value]) => row(key, esc(value ?? '—'))).join('') +
    '</tbody></table></div>' +
    (notes.length ? '<ul>' + notes.map(note => '<li>' + esc(note.message || note.code || '') + '</li>').join('') + '</ul>' : '') +
    '<p class="meta">Measured quote ' + esc(measured.id) + ' · ' + esc(measured.sha256) +
    '</p><p class="meta">Native source ' + esc(binding.nativeSourceId) +
    '</p><p class="meta">Usage version ' + esc(binding.usageVersion) + ' · revision ' + esc(binding.usageRevision) +
    '</p><p class="meta">Recorded-usage source ' + esc(binding.id) + '</p></details></section>';
}

function currentAgreement() {
  const id = state.selectedId;
  if (!id || state.detail?.agreement?.id !== id) return null;
  const listed = array(state.data?.agreements).find(agreement => agreement.id === id) || {};
  return {...listed, ...state.detail.agreement, periods: array(state.detail.periods || state.detail.agreement.periods)};
}
function renderDetail() {
  if (!state.selectedId) { $('#detail').hidden = true; $('#detail').innerHTML = ''; return; }
  $('#detail').hidden = false;
  const agreement = currentAgreement();
  if (!agreement) {
    $('#detail').innerHTML = '<section class="panel"><div class="loading">Opening the complete agreement…</div></section>';
    return;
  }
  const periods = array(agreement.periods);
  const editions = array(agreement.editions).sort((a, b) => Number(a.fromMonth) - Number(b.fromMonth));
  $('#detail').innerHTML = '<section class="panel"><div class="panel-head"><div><p class="eyebrow">Selected agreement</p><h2>' +
    esc(agreement.reference || agreement.title) + '</h2><span class="meta">' + esc(agreement.title) +
    '</span></div><div class="actions"><button type="button" data-action="amend" data-id="' + esc(agreement.id) +
    '" data-mutation>Amend terms</button><button type="button" data-action="renew" data-id="' + esc(agreement.id) +
    '" data-mutation>Renew</button><button type="button" data-action="cancel" data-id="' + esc(agreement.id) +
    '" data-mutation>Cancel term</button><button type="button" data-action="close-detail">Close</button></div></div>' +
    '<div class="panel-body"><dl class="definition-grid"><div><dt>Customer</dt><dd>' +
    esc(agreement.customerName || agreement.customerId) + '</dd></div><div><dt>Service term</dt><dd>' +
    esc(day(agreement.startDate)) + ' → ' + esc(day(agreement.endDate)) + '</dd></div><div><dt>Current status</dt><dd>' +
    badge(agreement.status) + '</dd></div><div><dt>Term length</dt><dd>' + esc(agreement.termMonths) +
    ' complete months</dd></div><div><dt>Agreement edition</dt><dd>' + esc(agreement.version) +
    '</dd></div><div><dt>As of</dt><dd>' + esc(asOf()) + '</dd></div></dl></div>' +
    '<div class="downloads">' + downloadLinks(agreement.id) + '</div></section>' +
    renewalContinuationGuidance(agreement, {buttons: true}) +
    '<section class="panel"><div class="panel-head"><h3>Service periods and original invoices</h3><span class="meta">' +
    periods.length + ' retained period' + (periods.length === 1 ? '' : 's') + '</span></div>' +
    (periods.length ? '<div class="table-wrap"><table><caption>Each period uses its saved accepted quotation and native invoice calculation.</caption><thead><tr>' +
      '<th scope="col">Service period</th><th scope="col">Invoice / due dates</th><th scope="col" class="align-right">Quoted charge</th>' +
      '<th scope="col">Status</th><th scope="col">Invoice and work</th></tr></thead><tbody>' +
      periods.map(period => '<tr><td class="nowrap">' + periodRange(period) + '</td><td class="nowrap">' +
        esc(day(period.issueDate)) + '<span class="subline">Due ' + esc(day(period.dueDate)) + '</span></td><td class="align-right amount">' +
        esc(money(period.amount, period.currency)) + '</td><td>' + badge(period.status) +
        '</td><td>' + periodAction(agreement, period) +
        (array(period.previousInvoices).length ? '<details><summary>Previous invoice history</summary><pre>' +
          esc(json(period.previousInvoices)) + '</pre></details>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>' : '<div class="panel-body"><p class="help">This agreement has no current billing periods.</p></div>') +
    '</section><section class="panel"><div class="panel-head"><h3>Accepted quotation editions</h3>' +
    '<span class="meta">Terms and original source files</span></div>' +
    (editions.length ? editions.map(edition => '<div class="panel-body"><dl class="definition-grid"><div><dt>Effective from</dt><dd>' +
      esc(day(edition.effectiveDate)) + '</dd></div><div><dt>Billing cycle</dt><dd>' + esc(edition.billingMonths) +
      ' month' + (edition.billingMonths === 1 ? '' : 's') + '</dd></div><div><dt>Invoice timing</dt><dd>' +
      esc(label(edition.invoiceTiming)) + ' · payment due in ' + esc(edition.dueDays) + ' days</dd></div></dl>' +
      '<h3 class="section-title">' + esc(edition.quote?.title || 'Original accepted quotation') + '</h3>' +
      '<p class="help">' + esc(edition.reason || 'Original agreement terms') + ' · ' + esc(edition.actor || '—') + ' · ' +
      esc(when(edition.createdAt)) + '</p>' + sourceLinks(agreement.id, edition.sourceId, edition.renewal) +
      renewalIdentityView(edition.renewal) + tariffBasisView(edition.quote?.bindings?.tariff) +
      performanceBasisView(edition.quote?.bindings?.performance) +
      '<details class="section-title"><summary>Source identity and complete edition</summary><pre>' + esc(json(edition)) +
      '</pre></details></div>').join('') : '<div class="panel-body"><p class="help">No quotation editions were returned.</p></div>') +
    '</section><section class="panel"><div class="panel-head"><h3>Complete agreement history</h3></div>' +
    historyTable(array(agreement.history), 'detail') + '</section>';
  syncControls();
}
function render() { renderMain(); renderDetail(); renderPending(); renderParkedForm(); syncControls(); }

function renderParkedForm() {
  if (state.rejectedRecord && !state.modal) {
    $('#parked-form').innerHTML = '<div class="notice"><strong>Original entered request retained</strong><div class="actions">' +
      '<button type="button" data-action="restore-rejected">Reopen original form</button>' +
      '<button type="button" data-action="save-rejected">Save original request</button></div></div>';
    return;
  }
  const modal = state.modal;
  if (!modal || $('#dialog').open || !modal.dirty) { $('#parked-form').innerHTML = ''; return; }
  $('#parked-form').innerHTML = '<div class="notice"><strong>Entered agreement form retained</strong><p>' +
    esc(modal.title) + ' remains in this tab with its entered terms and loaded source files.</p><div class="actions">' +
    '<button type="button" data-action="resume-form">Resume form</button>' +
    '<button type="button" data-action="discard-form">Discard entered form</button></div></div>';
}
function presentDialog() {
  if (!$('#dialog').open) $('#dialog').showModal();
  renderParkedForm(); syncControls();
}
function closeDialog() {
  $('#dialog').close();
  if (state.modal && !state.modal.dirty && !state.mutationRunning) {
    state.modal = null; $('#dialog-content').innerHTML = ''; notice('#dialog-message', '');
  }
  renderParkedForm();
}
function discardForm() {
  if (state.mutationRunning) return;
  state.modal = null; $('#dialog-content').innerHTML = '';
  $('#dialog').close(); notice('#dialog-message', ''); renderParkedForm();
}
function canOpenDialog(key) {
  if (state.mutationRunning) return false;
  if (state.modal?.dirty) {
    presentDialog();
    if (state.modal.key !== key) notice('#dialog-message',
      'Your entered form is still here. Save it or use “Discard entered form” before opening another operation.', null, 'warning');
    return false;
  }
  return true;
}
function inputField(name, title, value = '', {type = 'text', required = true, min, max, maxLength, list, full = false} = {}) {
  return '<label' + (full ? ' class="full"' : '') + '>' + esc(title) + '<input name="' + name + '" type="' + type +
    '" value="' + esc(value) + '"' + (required ? ' required' : '') + (min !== undefined ? ' min="' + esc(min) + '"' : '') +
    (max !== undefined ? ' max="' + esc(max) + '"' : '') + (maxLength !== undefined ? ' maxlength="' + maxLength + '"' : '') +
    (list ? ' list="' + esc(list) + '"' : '') + (type === 'number' ? ' step="1" inputmode="numeric"' : '') + '></label>';
}
function selectField(name, title, options, value, required = true) {
  return '<label>' + esc(title) + '<select name="' + name + '"' + (required ? ' required' : '') + '>' + options.map(([key, text]) =>
    '<option value="' + esc(key) + '"' + (String(key) === String(value) ? ' selected' : '') + '>' + esc(text) + '</option>').join('') +
    '</select></label>';
}
function renewalIdentityView(renewal, {draft = false} = {}) {
  if (!renewal || typeof renewal !== 'object') return '';
  const join = renewal.financialJoin || {};
  const head = renewal.acceptedHead || {};
  const servicePeriod = renewal.servicePeriod || (renewal.proposedContinuation?.effectiveFrom ? {
    effectiveFrom: renewal.proposedContinuation.effectiveFrom, effectiveUntil: renewal.proposedContinuation.effectiveUntil
  } : null);
  const terms = [
    ['Prior service terms', join.sourceTerms, renewal.sourceTerms],
    ['Customer-accepted continuation', join.proposedContinuation, renewal.proposedContinuation || servicePeriod],
    ['Activated service terms', join.activeTerms, renewal.activeTerms || (join.activeTerms ? servicePeriod : null)]
  ];
  return '<section class="renewal-summary"><h4>' + (draft ? 'Loaded service renewal' : 'Linked service renewal') + '</h4>' +
    '<dl class="definition-grid"><div><dt>Original service case</dt><dd>' + esc(join.caseId || renewal.case?.id || '—') +
    '</dd></div><div><dt>Operational agreement</dt><dd>' + esc(join.agreementId || '—') +
    '</dd></div><div><dt>Accepted renewal</dt><dd>' + esc(head.id || '—') +
    '<span class="subline">Edition ' + esc(head.revision ?? '—') + '</span></dd></div>' +
    '<div><dt>Customer acceptance</dt><dd>' + esc(when(join.acceptedAt)) + '</dd></div>' +
    (servicePeriod ? '<div><dt>Accepted service interval</dt><dd>' + esc(when(servicePeriod.effectiveFrom)) +
      '<span class="subline">' + (servicePeriod.effectiveUntil === null ? 'No fixed end' : 'Until ' + esc(when(servicePeriod.effectiveUntil))) +
      '</span></dd></div>' : '') + '</dl>' +
    '<div class="table-wrap"><table><caption>The accepted quotation and activated service terms retain their original editions.</caption>' +
    '<thead><tr><th scope="col">Terms</th><th scope="col">Original agreement / edition</th><th scope="col">Service interval</th></tr></thead><tbody>' +
    terms.map(([title, reference, original]) => '<tr><th scope="row">' + title + '</th><td>' +
      (reference ? esc(reference.id) + '<span class="subline">Edition ' + esc(reference.revision) + '</span>' :
        'Awaiting service activation') + '</td><td>' +
      (original?.effectiveFrom ? esc(when(original.effectiveFrom)) + '<span class="subline">Until ' +
        (original.effectiveUntil === null ? 'no fixed end' : esc(when(original.effectiveUntil))) + '</span>' : 'See original handover') + '</td></tr>').join('') +
    '</tbody></table></div><details><summary>Original renewal references</summary><pre>' +
    esc(json({sha256: renewal.sha256, acceptedHead: renewal.acceptedHead, financialJoin: renewal.financialJoin, servicePeriod})) +
    '</pre></details></section>';
}
function renewalContinuationGuidance(agreement, {buttons = false} = {}) {
  if (!agreement || agreement.status === 'CANCELLED' || agreement.cancellation) return '';
  const latest = [...array(agreement.editions)].sort((a, b) => a.fromMonth - b.fromMonth).at(-1);
  const period = latest?.renewal?.servicePeriod;
  if (!period?.effectiveFrom) return '';
  const prepared = latest.fromMonth >= agreement.termMonths;
  if (!prepared && period.effectiveUntil === null) return '';
  const nextMonthEnd = monthBoundary(agreement.startDate, agreement.termMonths + 1) + 'T00:00:00.000Z';
  const exhausted = period.effectiveUntil !== null && Date.parse(nextMonthEnd) > Date.parse(period.effectiveUntil);
  let title, message, action;
  if (prepared) {
    title = 'Accepted continuation is ready';
    message = 'The next accepted terms are saved at the financial term end, ' + agreement.endDate +
      '. Use Renew to add their complete monthly billing periods within the accepted service interval.';
    action = ['renew', 'Extend service term'];
  } else if (exhausted) {
    title = 'Load the next accepted continuation';
    message = 'Another complete month would exceed the current accepted service interval. Amend the agreement effective from its original financial end, ' +
      agreement.endDate + ', using the next accepted renewal handover. Then use Renew to extend the service term.';
    action = ['amend', 'Amend accepted terms'];
  } else {
    title = 'Accepted service interval';
    message = 'The current accepted renewal permits service until ' + when(period.effectiveUntil) +
      '. Additional whole billing periods must fit within that interval. To continue beyond it, save the next accepted renewal as an amendment at the financial term end, then use Renew.';
  }
  return '<section class="panel"><div class="panel-body"><h3>' + title + '</h3><p>' + esc(message) + '</p>' +
    (buttons && action ? '<div class="actions"><button type="button" data-action="' + action[0] + '" data-id="' +
      esc(agreement.id) + '" data-mutation>' + action[1] + '</button></div>' : '') + '</div></section>';
}

function sourceFields({renewalRequired = false} = {}) {
  return '<section class="form-section full"><h3>Original accepted quotation</h3>' +
    '<p class="help">' + (renewalRequired
      ? 'This agreement retains an operational service renewal. Load its next accepted renewal handover below; the original quotation and response fill these source documents.'
      : 'Load the exported quotation and its accepted customer response, or load the original renewal handover below. A renewal handover supplies both source documents.') + '</p>' +
    '<div class="form-grid"><label>Quotation JSON<input type="file" accept=".json,application/json" data-source="quote">' +
    '<span class="file-state" id="quote-file-state">Choose the original quotation.</span></label>' +
    '<label>Accepted response JSON<input type="file" accept=".json,application/json" data-source="response">' +
    '<span class="file-state" id="response-file-state">Choose its accepted response.</span></label></div></section>' +
    '<section class="form-section full"><h3>Operational service renewal</h3>' +
    '<p class="help">' + (renewalRequired
      ? 'Required for this amendment: load the next accepted renewal from the same original merchant service case and operational agreement. The complete accepted handover keeps the existing financial calendar with its source history and accepted service dates.'
      : 'Optional: load the complete accepted renewal exported by the merchant service case. Its original quotation and response fill the source documents above. The saved financial agreement retains the full case history and the accepted renewal reference.') + '</p>' +
    '<label>Original renewal handover JSON' + (renewalRequired ? ' (required)' : '') +
    '<input type="file" accept=".json,application/json" data-source="renewal"' + (renewalRequired ? ' aria-required="true"' : '') + '>' +
    '<span class="file-state" id="renewal-file-state">Choose an original renewal handover to link this agreement.</span></label>' +
    '<div id="renewal-file-summary"></div><div class="actions"><button type="button" data-action="remove-renewal" data-mutation id="remove-renewal" hidden>' +
    'Clear renewal handover and its source documents</button></div></section>';
}
function monthBoundary(startDate, offset) {
  const [year, month, originalDay] = startDate.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  const nextYear = Math.floor(index / 12), nextMonth = index % 12;
  const last = new Date(0); last.setUTCHours(0, 0, 0, 0); last.setUTCFullYear(nextYear, nextMonth + 1, 0);
  const date = new Date(0); date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(nextYear, nextMonth, Math.min(originalDay, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
function boundaries(agreement) {
  return Array.from({length: Math.min(1200, agreement.termMonths) + 1}, (_, index) => monthBoundary(agreement.startDate, index));
}
function effectiveEdition(agreement, effectiveDate) {
  return [...array(agreement.editions)].sort((a, b) => a.fromMonth - b.fromMonth)
    .filter(edition => edition.effectiveDate <= effectiveDate).at(-1) || array(agreement.editions)[0] || {};
}
function formFooter(text) {
  return '<footer class="dialog-footer"><span class="help">Saved with the named operator and the current agreement edition.</span>' +
    '<div class="actions"><button type="button" data-action="discard-form">Discard entered form</button>' +
    '<button type="button" data-action="close-dialog">Keep for later</button>' +
    '<button type="submit" class="primary" id="dialog-submit" data-mutation>' + esc(text) + '</button></div></footer>';
}
function modalContext(modal) {
  const agreement = modal.agreement;
  return '<div class="form-context">' + (agreement
    ? '<strong>' + esc(agreementName(agreement)) + '</strong><span>' +
      esc(agreement.customerName || agreement.customerId) + ' · edition ' + esc(modal.expectedVersion) + '</span>'
    : '<strong>New customer agreement</strong>') +
    '<span>Revision ' + esc(modal.revision) + ' · accounting workspace ' + esc(modal.workspaceId) + '</span></div>';
}
async function openForm(action, id = null, seed = null) {
  const key = action + ':' + (id || '');
  if (!seed && !canOpenDialog(key)) return;
  if (!state.data) throw new Error('Open the accounting workspace before entering an agreement.');
  if (state.pending && !seed) throw new Error('Resolve the original retained request before starting another change.');
  const sequence = ++dialogSequence;
  const originalWorkspace = workspaceId();
  let detail = null;
  if (id) {
    detail = await client.detail(id, {asOf: asOf()});
    if (sequence !== dialogSequence) return;
    validateRead(detail);
    if (detail.workspaceId !== originalWorkspace || detail.agreement?.id !== id || workspaceId() !== originalWorkspace) {
      throw new Error('The opened agreement does not match the original accounting workspace.');
    }
  }
  const agreement = detail ? {...detail.agreement, periods: array(detail.periods || detail.agreement.periods)} : null;
  const values = seed?.body || {};
  const title = ({create: 'Create service agreement', amend: 'Amend accepted terms', renew: 'Renew service term', cancel: 'Cancel remaining service'})[action];
  const modal = {
    key, action, agreementId: id, agreement, title, workspaceId: originalWorkspace,
    revision: values.revision ?? detail?.revision ?? state.data.revision,
    expectedVersion: values.expectedVersion ?? agreement?.version,
    dirty: Boolean(seed), fileLoads: 0, quoteContent: values.quoteContent ?? null,
    responseContent: values.responseContent ?? null, quoteName: '', responseName: '',
    renewalJson: values.renewalJson ?? null, renewalEnvelope: null, renewalName: '', renewalLoading: false,
    requireRenewal: action === 'amend' && array(agreement?.editions).some(edition => Boolean(edition.renewal)),
    foreignWorkspace: false
  };
  if (typeof modal.renewalJson === 'string') {
    try { modal.renewalEnvelope = JSON.parse(modal.renewalJson); } catch {}
  }
  const monthDates = agreement ? boundaries(agreement) : [];
  const nextDate = monthDates.find(date => date >= asOf() && date <= agreement.endDate) ||
    agreement?.endDate || agreement?.startDate || asOf();
  const edition = agreement ? effectiveEdition(agreement, values.effectiveDate || nextDate) : {};
  const monthlyOptions = Array.from({length: 12}, (_, index) => [index + 1, String(index + 1) + (index ? ' months' : ' month')]);
  const timingOptions = [['START', 'At the start of each period'], ['END', 'At the end of each period']];
  let fields = '';
  if (action === 'create') {
    const customers = array(state.data.customers);
    if (!customers.length) throw new Error('Create the billing customer in receivables before opening a service agreement.');
    fields = inputField('reference', 'Agreement reference', values.reference || '', {maxLength: 120}) +
      inputField('title', 'Agreement title', values.title || '', {maxLength: 500}) +
      selectField('customerId', 'Original billing customer', [['', 'Choose a billing customer'], ...customers.map(customer =>
        [customer.id, customer.name || customer.billingName || customer.title || customer.id])], values.customerId || '') +
      inputField('startDate', 'Service starts', values.startDate || asOf(), {type: 'date'}) +
      inputField('termMonths', 'Initial service term, months', values.termMonths ?? 12, {type: 'number', min: 1, max: 120}) +
      selectField('billingMonths', 'Bill every', monthlyOptions, values.billingMonths ?? 1) +
      selectField('invoiceTiming', 'Invoice timing', timingOptions, values.invoiceTiming || 'START') +
      inputField('dueDays', 'Payment due after invoice, days', values.dueDays ?? 30, {type: 'number', min: 0, max: 365}) +
      inputField('currencyScale', 'USD decimal places', values.currencyScale ?? 2, {type: 'number', min: 0, max: 6}) +
      '<p class="help full">Service periods follow complete monthly boundaries from the original start date. Each charge uses the accepted quotation for that whole number of months.</p>' + sourceFields();
  } else if (action === 'amend') {
    fields = inputField('effectiveDate', 'New terms effective from', values.effectiveDate || nextDate,
      {type: 'date', min: agreement.startDate, max: agreement.endDate, list: 'month-boundaries'}) +
      selectField('billingMonths', 'Bill every', [['', 'Keep the terms effective on this date'], ...monthlyOptions], values.billingMonths ?? '', false) +
      selectField('invoiceTiming', 'Invoice timing', [['', 'Keep the terms effective on this date'], ...timingOptions], values.invoiceTiming ?? '', false) +
      inputField('dueDays', 'Payment due after invoice, days (blank keeps current terms)', values.dueDays ?? '',
        {type: 'number', required: false, min: 0, max: 365}) +
      '<p class="help full">Use an original monthly boundary. The saved quotation replaces pricing from that date; already occupied service months retain their original invoice. Current selected terms: ' +
      esc(edition.billingMonths) + ' month billing, ' + esc(label(edition.invoiceTiming)) + ', due in ' + esc(edition.dueDays) + ' days.</p>' +
      '<p class="help full">For a newly accepted continuation, save its terms effective from the current financial end, ' +
      esc(agreement.endDate) + ', then use Renew to extend the term into its complete service months.</p>' + sourceFields({renewalRequired: modal.requireRenewal});
  } else if (action === 'renew') {
    fields = inputField('additionalMonths', 'Additional complete service months', values.additionalMonths ?? 12,
      {type: 'number', min: 1, max: 120}) +
      '<p class="help">Current service end: ' + esc(agreement.endDate) +
      '. The latest accepted terms supply the additional months. Every new billing period must fit within their original accepted service interval.</p>' +
      '<div class="full">' + renewalContinuationGuidance(agreement) + '</div>';
  } else if (action === 'cancel') {
    fields = inputField('effectiveDate', 'Service ends on this monthly boundary', values.effectiveDate || nextDate,
      {type: 'date', min: agreement.startDate, max: agreement.endDate, list: 'month-boundaries'}) +
      '<p class="help">The effective date is the first day without service. Earlier complete periods and their invoices remain in the agreement history.</p>';
  } else throw new Error('Unknown agreement form.');
  if (action !== 'create') fields += '<label class="full">Reason<textarea name="reason" rows="3" maxlength="1000" required>' +
    esc(values.reason || '') + '</textarea></label>';
  if (monthDates.length) fields += '<datalist id="month-boundaries">' +
    monthDates.map(value => '<option value="' + esc(value) + '"></option>').join('') + '</datalist>';
  state.modal = modal;
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = '<form id="agreement-form">' + modalContext(modal) +
    '<div class="form-grid">' + fields + '</div>' + formFooter(action === 'create' ? 'Create agreement' :
      action === 'amend' ? 'Save new accepted terms' : action === 'renew' ? 'Renew agreement' : 'Save cancellation') + '</form>';
  notice('#dialog-message', '');
  for (const kind of ['quote', 'response']) {
    if (modal[kind + 'Content'] !== null) {
      const element = $('#' + kind + '-file-state');
      if (element) { element.textContent = 'Original source retained from the saved request.'; element.classList.add('loaded'); }
    }
  }
  renderRenewalSourceState(modal);
  presentDialog();
}
function renderRenewalSourceState(modal = state.modal) {
  const target = $('#renewal-file-state');
  if (!target || !modal) return;
  const loaded = typeof modal.renewalJson === 'string';
  if (loaded) target.classList.add('loaded'); else target.classList.remove('loaded');
  target.textContent = loaded ? (modal.renewalName || 'Original handover retained from the saved request') +
    ' · complete renewal source loaded' : 'Choose an original renewal handover to link this agreement.';
  const summary = $('#renewal-file-summary');
  if (summary) summary.innerHTML = loaded ? renewalIdentityView(modal.renewalEnvelope, {draft: true}) : '';
  const clear = $('#remove-renewal');
  if (clear) clear.hidden = !loaded;
  if (loaded) {
    for (const kind of ['quote', 'response']) {
      const element = $('#' + kind + '-file-state');
      if (!element) continue;
      element.textContent = (kind === 'quote' ? 'Original quotation' : 'Original accepted response') +
        ' loaded from the renewal handover.';
      element.classList.add('loaded');
    }
  }
}
function originalRenewalMaterial(material, title) {
  if (!material || material.encoding !== 'base64' || typeof material.data !== 'string' ||
    !Number.isSafeInteger(material.bytes) || material.bytes < 1 || material.bytes > requestBytes) {
    throw new Error('The handover must include the complete original ' + title + ' material.');
  }
  if (material.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(material.data)) {
    throw new Error('The original ' + title + ' material is not complete base64.');
  }
  const binary = atob(material.data);
  if (binary.length !== material.bytes) throw new Error('The original ' + title + ' byte count differs from the handover.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  if (!text.trim()) throw new Error('The original ' + title + ' document is empty.');
  return text;
}
function readRenewalEnvelope(content) {
  let envelope;
  try { envelope = JSON.parse(content); }
  catch { throw new Error('Choose the complete JSON renewal handover exported by the merchant service case.'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    envelope.schema !== 'stellar-forge.merchant-service-renewal-handover.v1') {
    throw new Error('Choose the original merchant service renewal handover.');
  }
  if (!envelope.acceptedHead || typeof envelope.acceptedHead.id !== 'string' ||
    !Number.isSafeInteger(envelope.acceptedHead.revision) || envelope.acceptedHead.revision < 1 ||
    typeof envelope.acceptedHead.sha256 !== 'string') {
    throw new Error('Choose a service renewal that retains its original customer acceptance.');
  }
  const quoteContent = originalRenewalMaterial(envelope.materials?.quote, 'quotation');
  const responseContent = originalRenewalMaterial(envelope.materials?.acceptance, 'accepted response');
  if (new TextEncoder().encode(JSON.stringify({renewalJson: content, quoteContent, responseContent})).byteLength > requestBytes) {
    throw new Error('The complete renewal handover and its original documents exceed the 2,000,000-byte request limit.');
  }
  return {envelope, quoteContent, responseContent};
}
async function readRenewalSourceFile(input) {
  const modal = state.modal;
  if (!modal || !['create', 'amend'].includes(modal.action) || state.pending || state.mutationRunning) return;
  const file = input.files?.[0];
  if (!file) return;
  const sequence = (modal.renewalLoadSequence || 0) + 1;
  modal.renewalLoadSequence = sequence;
  modal.fileLoads++; modal.renewalLoading = true; modal.dirty = true; syncControls();
  const target = $('#renewal-file-state');
  target.textContent = 'Reading ' + file.name + '…'; target.classList.remove('loaded');
  try {
    if (file.size > requestBytes) throw new Error('The source file exceeds the 2,000,000-byte request limit.');
    const content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
    const loaded = readRenewalEnvelope(content);
    if (state.modal !== modal || modal.renewalLoadSequence !== sequence) return;
    for (const kind of ['quote', 'response']) modal[kind + 'LoadSequence'] = (modal[kind + 'LoadSequence'] || 0) + 1;
    modal.renewalJson = content; modal.renewalEnvelope = loaded.envelope; modal.renewalName = file.name;
    modal.quoteContent = loaded.quoteContent; modal.responseContent = loaded.responseContent;
    modal.quoteName = 'Quotation from ' + file.name; modal.responseName = 'Accepted response from ' + file.name;
    for (const kind of ['quote', 'response']) {
      const field = $('input[data-source="' + kind + '"]');
      if (field) field.value = '';
    }
    renderRenewalSourceState(modal);
    notice('#dialog-message', 'The handover supplies the original quotation and accepted response. Review its continuation dates with the billing terms; saving validates and retains the complete renewal source.');
  } catch (error) {
    if (state.modal === modal && modal.renewalLoadSequence === sequence) {
      input.value = ''; renderRenewalSourceState(modal); showError(error, '#dialog-message');
    }
  } finally {
    modal.fileLoads--;
    if (modal.renewalLoadSequence === sequence) modal.renewalLoading = false;
    syncControls();
  }
}
function clearRenewalSource() {
  const modal = state.modal;
  if (!modal || state.pending || state.mutationRunning || modal.fileLoads) return;
  modal.renewalLoadSequence = (modal.renewalLoadSequence || 0) + 1;
  modal.renewalJson = null; modal.renewalEnvelope = null; modal.renewalName = '';
  modal.quoteContent = null; modal.responseContent = null; modal.quoteName = ''; modal.responseName = '';
  modal.dirty = true;
  for (const kind of ['quote', 'response', 'renewal']) {
    const field = $('input[data-source="' + kind + '"]');
    if (field) field.value = '';
  }
  for (const kind of ['quote', 'response']) {
    const target = $('#' + kind + '-file-state');
    if (target) {
      target.textContent = kind === 'quote' ? 'Choose the original quotation.' : 'Choose its accepted response.';
      target.classList.remove('loaded');
    }
  }
  renderRenewalSourceState(modal);
  notice('#dialog-message', 'Load a quotation and its accepted response, or choose another complete renewal handover.');
  syncControls();
}

async function readSourceFile(input) {
  const modal = state.modal;
  const kind = input.dataset.source;
  if (kind === 'renewal') return readRenewalSourceFile(input);
  if (!modal || !['quote', 'response'].includes(kind)) return;
  if (modal.renewalJson || modal.renewalLoading) {
    input.value = '';
    throw new Error('Clear the loaded renewal handover before selecting separate quotation documents.');
  }
  const file = input.files?.[0];
  if (!file) return;
  const counterKey = kind + 'LoadSequence';
  const sequence = (modal[counterKey] || 0) + 1;
  modal[counterKey] = sequence;
  modal.fileLoads++; modal.dirty = true; syncControls();
  const target = $('#' + kind + '-file-state');
  target.textContent = 'Reading ' + file.name + '…';
  target.classList.remove('loaded');
  try {
    if (file.size > requestBytes) throw new Error('The source file exceeds the 2,000,000-byte request limit.');
    const content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
    if (!content.trim()) throw new Error('The selected source file is empty.');
    if (state.modal !== modal || modal[counterKey] !== sequence) return;
    modal[kind + 'Content'] = content; modal[kind + 'Name'] = file.name;
    target.textContent = file.name + ' · ' + file.size.toLocaleString() + ' original bytes loaded';
    target.classList.add('loaded'); notice('#dialog-message', '');
  } catch (error) {
    if (state.modal === modal && modal[counterKey] === sequence) {
      modal[kind + 'Content'] = null;
      target.textContent = 'Choose the original ' + (kind === 'quote' ? 'quotation.' : 'accepted response.');
      showError(error, '#dialog-message');
    }
  } finally { modal.fileLoads--; syncControls(); }
}
function wholeField(form, name, minimum, maximum, optional = false) {
  const text = form.elements.namedItem(name)?.value.trim() ?? '';
  if (optional && !text) return undefined;
  if (!/^\d+$/.test(text)) throw new Error(label(name) + ' must be a whole number.');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(label(name) + ' must be between ' + minimum + ' and ' + maximum + '.');
  }
  return value;
}
function sourceBody(modal) {
  if (modal.requireRenewal && typeof modal.renewalJson !== 'string') {
    throw new Error('Load the next accepted renewal handover from this agreement’s original service case before saving its amendment.');
  }
  if (typeof modal.quoteContent !== 'string' || typeof modal.responseContent !== 'string') {
    throw new Error('Load both the original quotation and its accepted response before saving.');
  }
  return {quoteContent: modal.quoteContent, responseContent: modal.responseContent,
    ...(typeof modal.renewalJson === 'string' ? {renewalJson: modal.renewalJson} : {})};
}
function newRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}
function ensureModalWorkspace(modal) {
  if (!modal || modal.foreignWorkspace || modal.workspaceId !== workspaceId()) {
    throw new Error('Reopen the original accounting workspace before saving this retained form.');
  }
}
function recordRequest(modal, body) {
  ensureModalWorkspace(modal);
  body.workspaceId = modal.workspaceId;
  if (state.pending) throw new Error('Continue the original pending request before saving another change.');
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > requestBytes) {
    throw new Error('The full request exceeds 2,000,000 UTF-8 bytes. Select the original source exports within the service limit.');
  }
  const record = {schema: 'stellar-forge.service-agreement-browser-request.v1',
    workspaceId: modal.workspaceId, apiUrl, action: modal.action, agreementId: modal.agreementId,
    body, label: modal.title, createdAt: new Date().toISOString()};
  retainPending(record);
  return record;
}
async function submitAgreementForm(form) {
  const modal = state.modal;
  if (!modal || !form.reportValidity() || state.mutationRunning || modal.fileLoads) return;
  ensureModalWorkspace(modal);
  const field = name => form.elements.namedItem(name)?.value.trim() ?? '';
  const body = {revision: modal.revision, actor: actor(), requestId: newRequestId()};
  if (modal.agreementId) body.expectedVersion = modal.expectedVersion;
  if (modal.action === 'create') Object.assign(body, {
    reference: field('reference'), title: field('title'), customerId: field('customerId'), startDate: field('startDate'),
    termMonths: wholeField(form, 'termMonths', 1, 120), billingMonths: wholeField(form, 'billingMonths', 1, 12),
    invoiceTiming: field('invoiceTiming'), dueDays: wholeField(form, 'dueDays', 0, 365),
    currencyScale: wholeField(form, 'currencyScale', 0, 6), ...sourceBody(modal)
  });
  else if (modal.action === 'amend') {
    Object.assign(body, {effectiveDate: field('effectiveDate'), reason: field('reason'), ...sourceBody(modal)});
    if (field('billingMonths')) body.billingMonths = wholeField(form, 'billingMonths', 1, 12);
    if (field('invoiceTiming')) body.invoiceTiming = field('invoiceTiming');
    const dueDays = wholeField(form, 'dueDays', 0, 365, true);
    if (dueDays !== undefined) body.dueDays = dueDays;
  } else if (modal.action === 'renew') Object.assign(body, {
    additionalMonths: wholeField(form, 'additionalMonths', 1, 120), reason: field('reason')
  });
  else if (modal.action === 'cancel') Object.assign(body, {effectiveDate: field('effectiveDate'), reason: field('reason')});
  else throw new Error('The selected form does not save agreement terms.');
  modal.dirty = true;
  await performRequest(recordRequest(modal, body));
}

function previewContents(preview, agreement) {
  const draft = preview.invoiceDraft || {};
  const period = preview.period || {};
  const review = preview.quoteReview || {};
  const customer = preview.customer || draft.customer || {};
  const recover = preview.recoveryRequest || period.recoveryRequest;
  const renewal = array(agreement.editions).find(edition => edition.id === period.editionId || edition.sourceId === period.sourceId)?.renewal;
  const canBill = Boolean(period.canPrepare && (period.due || period.status === 'DUE' || period.status === 'PREPARING'));
  const description = period.status === 'PREPARING'
    ? 'Continue the original prepared billing operation with its saved operator and request.'
    : period.status === 'VOID' && canBill
      ? 'Create a replacement draft for this service period. Previous invoice history stays attached.'
      : canBill ? 'Review the saved accepted quotation, original accounting customer and exact invoice lines.'
      : period.status === 'UPCOMING' ? 'This service period is upcoming. Its saved charge is available for review.'
      : 'This period already has an invoice. Continue the invoice workflow in receivables.';
  const lines = array(draft.lines);
  return '<div class="form-context"><strong>' + esc(agreementName(agreement)) + '</strong><span>' +
    esc(customer.name || agreement.customerName || agreement.customerId) + ' · edition ' +
    esc(preview.agreementVersion) + ' · revision ' + esc(preview.revision) + '</span></div>' +
    '<p>' + esc(description) + '</p>' +
    '<section class="panel"><div class="panel-head"><h3>Original billing customer</h3></div><div class="panel-body">' +
    '<dl class="definition-grid"><div><dt>Customer</dt><dd>' + esc(customer.name || agreement.customerName || agreement.customerId) +
    '</dd></div><div><dt>Customer reference</dt><dd>' + esc(customer.reference || customer.id || agreement.customerId) +
    '</dd></div><div><dt>Billing contact</dt><dd>' + esc(customer.email || '—') + '</dd></div>' +
    '<div><dt>Billing address</dt><dd>' + esc(customer.address || '—').replace(/\n/g, '<br>') +
    '</dd></div><div><dt>Customer edition</dt><dd>' + esc(customer.version ?? '—') +
    '</dd></div></dl></div></section><dl class="definition-grid">' +
    '<div><dt>Service interval</dt><dd>' + periodRange(period) + '</dd></div>' +
    '<div><dt>Invoice date</dt><dd>' + esc(day(draft.issueDate || period.issueDate)) + '</dd></div>' +
    '<div><dt>Payment due</dt><dd>' + esc(day(draft.dueDate || period.dueDate)) + '</dd></div>' +
    '<div><dt>Invoice total</dt><dd class="amount">' + esc(money(draft.totals?.total ?? period.amount, draft.currency || period.currency)) + '</dd></div>' +
    '<div><dt>Period status</dt><dd>' + badge(period.status) + '</dd></div>' +
    '<div><dt>Accepted quotation</dt><dd>' + esc(review.quote?.title || 'Original accepted quotation') + '</dd></div></dl>' +
    (recover ? '<div class="notice"><strong>Resume saved billing</strong><p>Original operator: ' + esc(recover.actor) +
      '</p><span class="meta">Request ' + esc(recover.requestId) + '</span></div>' : '') +
    '<section class="panel"><div class="panel-head"><h3>Native invoice draft</h3></div><div class="table-wrap"><table>' +
    '<thead><tr><th scope="col">Description</th><th scope="col" class="align-right">Quantity</th>' +
    '<th scope="col" class="align-right">Unit amount</th><th scope="col" class="align-right">Line total</th></tr></thead><tbody>' +
    lines.map(line => '<tr><td>' + esc(line.description) + '</td><td class="align-right amount">' + esc(line.quantity) +
      '</td><td class="align-right amount">' + esc(money(line.unitAmount, draft.currency)) +
      '</td><td class="align-right amount">' + esc(money(line.total, draft.currency)) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><th colspan="3" scope="row">Total</th><td class="align-right amount">' +
    esc(money(draft.totals?.total ?? period.amount, draft.currency || period.currency)) + '</td></tr></tfoot></table></div></section>' +
    '<p class="help">' + esc(review.calculation || draft.rounding || '') + '</p>' +
    (review.plannedRouteLines ? '<p class="help">' + esc(review.plannedRouteLines) +
      ' quoted planned-usage line' + (review.plannedRouteLines === 1 ? '' : 's') + ' included in this period.</p>' : '') +
    tariffBasisView(review.tariff?.binding, review.tariff) + performanceBasisView(review.performance?.binding, review.performance) +
    sourceLinks(agreement.id, period.sourceId, renewal) + renewalIdentityView(renewal) +
    '<details class="section-title"><summary>Original customer, quote calculation and complete invoice preview</summary><pre>' +
    esc(json(preview)) + '</pre></details>' +
    '<footer class="dialog-footer"><a class="button-link" href="' + esc(receivablesPath) + '">Open receivables</a>' +
    '<div class="actions"><button type="button" data-action="close-dialog">Close preview</button>' +
    (canBill ? '<button type="button" class="primary" data-action="bill" id="dialog-submit" data-mutation>' +
      (recover || period.status === 'PREPARING' ? 'Resume original billing' : period.status === 'VOID' ? 'Create replacement draft' : 'Create invoice draft') +
      '</button>' : '') + '</div></footer>';
}
async function openPreview(id, periodId) {
  const key = 'bill:' + id + ':' + periodId;
  if (!canOpenDialog(key)) return;
  const originalWorkspace = workspaceId();
  const sequence = ++dialogSequence;
  const preview = await client.preview(id, {periodId, asOf: asOf()});
  if (sequence !== dialogSequence) return;
  validateRead(preview);
  if (preview.workspaceId !== originalWorkspace || workspaceId() !== originalWorkspace ||
    preview.agreementId !== id || preview.period?.id !== periodId) {
    throw new Error('The billing preview does not match its original agreement and accounting workspace.');
  }
  const agreement = array(state.data.agreements).find(row => row.id === id) ||
    (state.detail?.agreement?.id === id ? state.detail.agreement : {id});
  state.modal = {action: 'bill', key, agreementId: id, agreement, periodId, preview,
    workspaceId: originalWorkspace, revision: preview.revision, expectedVersion: preview.agreementVersion,
    title: 'Review invoice draft · ' + agreementName(agreement), dirty: false, fileLoads: 0};
  $('#dialog-title').textContent = 'Review service-period invoice';
  $('#dialog-content').innerHTML = previewContents(preview, agreement);
  notice('#dialog-message', '');
  presentDialog();
}
async function prepareInvoice() {
  const modal = state.modal;
  ensureModalWorkspace(modal);
  if (modal.action !== 'bill' || state.mutationRunning) return;
  const preview = modal.preview;
  const period = preview.period;
  if (!period.canPrepare || !(period.due || period.status === 'DUE' || period.status === 'PREPARING')) {
    throw new Error('Open a due service period before preparing its invoice draft.');
  }
  const recovery = preview.recoveryRequest || period.recoveryRequest;
  if (period.status === 'PREPARING' && !recovery) {
    throw new Error('Refresh this preview to retrieve the original prepared billing request.');
  }
  const body = recovery ? {
    revision: preview.revision, actor: recovery.actor, requestId: recovery.requestId,
    expectedVersion: recovery.expectedVersion, periodId: recovery.periodId, previewSha256: recovery.previewSha256
  } : {
    revision: preview.revision, actor: actor(), requestId: newRequestId(),
    expectedVersion: preview.agreementVersion, periodId: period.id, previewSha256: preview.previewSha256
  };
  if (typeof body.previewSha256 !== 'string' || !body.previewSha256 || typeof body.actor !== 'string' ||
    typeof body.requestId !== 'string' || !Number.isSafeInteger(body.expectedVersion) || body.periodId !== period.id) {
    throw new Error('The original billing review is incomplete. Refresh its saved preview before continuing.');
  }
  modal.dirty = true;
  await performRequest(recordRequest(modal, body));
}
function uncertainOutcome(error) {
  return error?.uncertain === true || !Number.isInteger(error?.status) ||
    error.status >= 500 || error.status === 408 ||
    /(?:UNCERTAIN|RECOVERY|RECOVER|REOPEN|PREPARING|PENDING)/i.test(String(error?.code || '')) ||
    error?.details?.recoveryRequest || error?.details?.prepared === true || error?.details?.agreementBillingPrepared === true;
}
function resultMessage(record, result) {
  if (record.action === 'bill') {
    const invoice = result.invoice;
    return 'Invoice draft ' + (invoice?.number || invoice?.id || '') +
      ' is saved in original receivables for the reviewed service period.';
  }
  return ({create: 'Service agreement created.', amend: 'New accepted terms saved.',
    renew: 'Service term renewed.', cancel: 'Service cancellation saved.'})[record.action];
}
async function restoreRejectedForm(record, error) {
  if (record.action !== 'bill') {
    if (!state.modal || state.modal.key !== record.action + ':' + (record.agreementId || '')) {
      try { await openForm(record.action, record.agreementId, record); }
      catch (restoreError) {
        state.rejectedRecord = record;
        notice('#message', error.message + ' The original request remains available below.', error);
        $('#parked-form').innerHTML = '<div class="notice"><strong>Original entered request retained</strong><div class="actions">' +
          '<button type="button" data-action="restore-rejected">Reopen original form</button>' +
          '<button type="button" data-action="save-rejected">Save original request</button></div></div>';
        return;
      }
    }
    showError(error, '#dialog-message');
    $('#dialog-message').insertAdjacentHTML('beforeend',
      '<div class="actions"><button type="button" data-action="refresh-form" data-mutation>Review current agreement and keep entered values</button></div>');
    presentDialog();
  } else {
    if (state.modal) state.modal.dirty = false;
    showError(error, '#dialog-message');
    $('#dialog-message').insertAdjacentHTML('beforeend',
      '<div class="actions"><button type="button" data-action="refresh-preview" data-id="' + esc(record.agreementId) +
      '" data-period="' + esc(record.body.periodId) + '">Refresh the original period preview</button></div>');
    if (state.modal) presentDialog();
    else showError(error);
  }
}
async function performRequest(record) {
  if (state.mutationRunning) return;
  if (record.workspaceId !== workspaceId() || record.apiUrl !== apiUrl) {
    throw new Error('Reopen the original accounting workspace before retrying its request.');
  }
  state.mutationRunning = true; syncControls(); renderPending();
  notice('#dialog-message', 'Saving the original ' + (record.action === 'bill' ? 'billing request…' : 'agreement request…'));
  let result;
  try {
    const requestBody = {...record.body, workspaceId: record.workspaceId};
    result = record.action === 'create' ? await client.create(requestBody) :
      await client[record.action](record.agreementId, requestBody);
    validateRead(result);
    if (result.workspaceId !== record.workspaceId) {
      const error = new Error('The operation reply identifies another accounting workspace. The original request is retained.');
      error.uncertain = true; throw error;
    }
    clearPending(record);
    state.modal = null; state.rejectedRecord = null; $('#dialog-content').innerHTML = ''; $('#dialog').close();
    state.selectedId = result.agreementId || record.agreementId || result.agreement?.id || null;
    state.detail = null; state.detailHistoryPage = 0;
    await refresh({quiet: true});
    notice('#message', resultMessage(record, result));
    if (record.action === 'bill') $('#message').insertAdjacentHTML('beforeend',
      '<div class="actions"><a class="button-link primary" href="' + esc(receivablesPath) + '">Review and issue in receivables</a></div>');
  } catch (error) {
    if (uncertainOutcome(error)) {
      retainPending(record);
      notice('#message', 'The original request is retained. Retry resumes that request with the same operator and source contents.', error, 'warning');
      notice('#dialog-message', 'The original request is retained until its outcome is returned.', error, 'warning');
    } else {
      clearPending(record);
      await refresh({quiet: true});
      await restoreRejectedForm(record, error);
    }
  } finally {
    state.mutationRunning = false; renderPending(); renderParkedForm(); syncControls();
  }
}
async function reviewCurrentForm() {
  const modal = state.modal;
  if (!modal || state.pending || state.mutationRunning || modal.action === 'bill') return;
  ensureModalWorkspace(modal);
  const detail = modal.agreementId ? await client.detail(modal.agreementId, {asOf: asOf()}) : await client.state({asOf: asOf()});
  validateRead(detail);
  if (state.modal !== modal) return;
  if (detail.workspaceId !== modal.workspaceId) throw new Error('The current listener opens a different accounting workspace.');
  modal.revision = detail.revision;
  if (modal.agreementId) {
    if (detail.agreement?.id !== modal.agreementId) throw new Error('The current agreement could not be matched.');
    modal.agreement = {...detail.agreement, periods: array(detail.periods || detail.agreement.periods)};
    modal.expectedVersion = detail.agreement.version;
  }
  const context = $('#dialog-content .form-context');
  if (context) context.outerHTML = modalContext(modal);
  notice('#dialog-message', 'The current agreement edition is loaded. Your entered terms and original quotation files are kept for review before saving.');
  if (modal.agreement) $('#dialog-message').insertAdjacentHTML('beforeend',
    '<details><summary>Current agreement and occupied service periods</summary><pre>' + esc(json(modal.agreement)) + '</pre></details>');
  syncControls();
}
async function handleAction(button) {
  const action = button.dataset.action;
  if (button.disabled) return;
  if (action === 'refresh') return refresh();
  if (action === 'create') return openForm('create');
  if (['amend', 'renew', 'cancel'].includes(action)) return openForm(action, button.dataset.id);
  if (action === 'view') {
    state.view = button.dataset.view; state.historyPage = 0; renderMain(); return;
  }
  if (action === 'detail') return loadDetail(button.dataset.id);
  if (action === 'close-detail') {
    detailSequence++; state.selectedId = null; state.detail = null; renderDetail(); renderMain(); return;
  }
  if (action === 'preview' || action === 'refresh-preview') {
    if (action === 'refresh-preview' && state.modal?.action === 'bill') { state.modal.dirty = false; }
    return openPreview(button.dataset.id, button.dataset.period);
  }
  if (action === 'bill') return prepareInvoice();
  if (action === 'close-dialog') return closeDialog();
  if (action === 'resume-form') return presentDialog();
  if (action === 'discard-form') return discardForm();
  if (action === 'remove-renewal') return clearRenewalSource();
  if (action === 'refresh-form') return reviewCurrentForm();
  if (action === 'retry-pending' && state.pending) return performRequest(state.pending);
  if (action === 'save-pending' && state.pending) return downloadObject(
    'service-agreement-request-' + state.pending.body.requestId + '.json', state.pending);
  if (action === 'restore-rejected' && state.rejectedRecord) {
    const record = state.rejectedRecord;
    await openForm(record.action, record.agreementId, record);
    state.rejectedRecord = null; return;
  }
  if (action === 'save-rejected' && state.rejectedRecord) return downloadObject(
    'service-agreement-request-' + state.rejectedRecord.body.requestId + '.json', state.rejectedRecord);
  if (action === 'history-page') {
    const page = Number(button.dataset.page);
    if (!Number.isSafeInteger(page) || page < 0) return;
    state[button.dataset.scope === 'detail' ? 'detailHistoryPage' : 'historyPage'] = page;
    if (button.dataset.scope === 'detail') renderDetail(); else renderMain();
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  event.preventDefault();
  Promise.resolve().then(() => handleAction(button)).catch(error =>
    showError(error, $('#dialog').open ? '#dialog-message' : '#message'));
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'agreement-form') return;
  event.preventDefault();
  submitAgreementForm(event.target).catch(error => showError(error, '#dialog-message'));
});
$('#dialog-content').addEventListener('input', event => {
  if (state.modal && event.target.closest('#agreement-form')) state.modal.dirty = true;
});
$('#dialog-content').addEventListener('change', event => {
  if (event.target.matches('input[data-source]')) readSourceFile(event.target).catch(error => showError(error, '#dialog-message'));
  else if (state.modal && event.target.closest('#agreement-form')) state.modal.dirty = true;
});
$('#dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
for (const selector of ['#search', '#customer-filter', '#status-filter', '#period-filter']) {
  $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => {
    state.historyPage = 0; renderMain();
  });
}
$('#as-of').addEventListener('change', () => {
  if ($('#as-of').validity.valid && $('#as-of').value) refresh({quiet: true});
});
await refresh({quiet: true});
