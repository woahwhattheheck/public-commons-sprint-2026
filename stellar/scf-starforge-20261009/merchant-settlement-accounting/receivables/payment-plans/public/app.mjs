import {PaymentPlansClient} from './sdk/client.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, char => char.toUpperCase());
const copy = value => JSON.parse(JSON.stringify(value));
const dateToday = () => {
  const date = new Date(), local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const addDays = (date, days) => {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const money = (value, currency) => esc(String(value ?? '0')) + (currency?.code ? ' <span class="muted">' + esc(currency.code) + '</span>' : '');
const badge = value => '<span class="badge' + (/OVERDUE|REPLAN_REQUIRED/.test(String(value)) ? ' strong' : '') + '">' + esc(label(value)) + '</span>';
const empty = (title, message, action = '') => '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(message) + '</p>' + action + '</div>';
const queryString = value => {
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(value || {})) if (item !== undefined && item !== null && item !== '') query.set(key, String(item));
  return query.size ? '?' + query : '';
};
const ui = {client:null,config:null,state:null,tab:'plans',editor:null,detail:null,pending:null,busy:false,storageKey:null,loadSequence:0};
$('#as-of').value = dateToday();
$('#through').value = addDays(dateToday(), 30);

function notice(message, error = false, dialog = false) {
  const target = dialog && $('#dialog').open ? $('#dialog-message') : $('#message');
  target.textContent = String(message || '');
  target.classList.toggle('error', error);
}
function setBusy(value) {
  ui.busy = value;
  document.querySelectorAll('button[data-mutates], button[data-request]').forEach(button => { button.disabled = value; });
}
function filters() {
  return {asOf: $('#as-of').value, through: $('#through').value, customerId: $('#customer-filter').value};
}
function searchMatch(value) {
  const query = $('#search').value.trim().toLowerCase();
  return !query || [value.customerName, value.invoiceNumber, value.reference, value.title, value.customerId]
    .filter(Boolean).join(' ').toLowerCase().includes(query);
}
function invoiceById(id) { return [...(ui.state?.invoices || []),...(ui.invoiceCatalog || [])].find(invoice => invoice.id === id); }
function selectedCurrency(draft) { return invoiceById(draft?.invoiceId)?.currency || ui.detail?.plan?.currency; }
function pendingSave() {
  try {
    if (ui.pending) sessionStorage.setItem(ui.storageKey, JSON.stringify(ui.pending));
    else sessionStorage.removeItem(ui.storageKey);
  } catch { /* The current tab still retains the exact request in memory. */ }
  renderPending();
}
function renderPending() {
  const item = ui.pending;
  if (!item) { $('#pending').replaceChildren(); return; }
  const matching = !ui.state?.workspaceId || !item.workspaceId || ui.state.workspaceId === item.workspaceId;
  $('#pending').innerHTML = '<p><strong>' + esc(item.title) + '</strong> · Request <code>' + esc(item.value.requestId) + '</code></p>' +
    '<p>' + esc(matching ? item.message || 'This operation is retained. Read its saved result or retry this same request after reconnecting.' :
      'This operation belongs to another accounting workspace. Reopen that workspace to continue it.') + '</p>' +
    '<div class="actions"><button data-action="pending-check" data-request' + (!matching ? ' disabled' : '') + '>Read saved result</button>' +
    '<button data-action="pending-retry" data-mutates' + (!matching ? ' disabled' : '') + '>Retry same request</button>' +
    '<button data-action="pending-download">Download request</button><button data-action="pending-clear">' +
    (item.method === 'savePlan' ? 'Recover draft' : 'Close retained request') + '</button></div>';
}
function fillCustomers() {
  const selected = $('#customer-filter').value;
  const customers = new Map();
  for (const customer of ui.state?.customers || []) customers.set(customer.id || customer.customerId, customer.name || customer.displayName || customer.customerName || customer.id);
  for (const invoice of ui.state?.invoices || []) customers.set(invoice.customerId, invoice.customerName || invoice.customerId);
  $('#customer-filter').innerHTML = '<option value="">All customers</option>' + [...customers]
    .filter(([id]) => id).sort((a,b) => String(a[1]).localeCompare(String(b[1])))
    .map(([id,name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
  if (customers.has(selected)) $('#customer-filter').value = selected;
}
function renderSummary() {
  const report = ui.state?.report;
  const currencies = report?.currencies || [];
  if (!currencies.length) { $('#summary').replaceChildren(); return; }
  $('#summary').innerHTML = '<div class="summary-panel"><div class="summary-title"><h2>Collections by currency</h2><span>As of ' +
    esc(report.asOf) + ' · planning through ' + esc(report.through) + '</span></div><div class="table-scroll"><table><thead><tr>' +
    '<th>Currency</th><th class="number">Outstanding</th><th class="number">Overdue</th><th class="number">Due today</th>' +
    '<th class="number">Upcoming</th><th class="number">After horizon</th><th class="number">Unscheduled</th><th class="number">Credit balance</th></tr></thead><tbody>' +
    currencies.map(row => '<tr><td><strong>' + esc(row.currency?.code) + '</strong><span class="secondary-line">' + esc(row.currency?.scale) + ' decimal places</span></td>' +
      ['amountDue','overdue','dueToday','upcoming','afterHorizon','unscheduled','creditBalance'].map(key => '<td class="number">' + money(row[key]) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div></div>';
}
function renderPlans() {
  const plans = (ui.state?.plans || []).filter(searchMatch);
  if (!plans.length) return empty('No payment plans in this view', 'Create a schedule from an issued invoice, then review and activate the customer edition.',
    '<button class="primary" data-action="new">New payment plan</button>');
  return '<div class="table-scroll"><table><thead><tr><th>Plan / invoice</th><th>Customer</th><th>Status</th><th>Next due</th>' +
    '<th class="number">Scheduled balance</th><th class="number">Overdue</th><th class="number">Unscheduled</th><th></th></tr></thead><tbody>' +
    plans.map(plan => '<tr><td><button class="link-button" data-action="detail" data-id="' + esc(plan.id || plan.planId) + '">' +
      esc(plan.title || plan.reference || plan.invoiceNumber || 'Payment plan') + '</button><span class="secondary-line">' +
      esc(plan.invoiceNumber || plan.invoiceId) + (plan.reference ? ' · ' + esc(plan.reference) : '') + '</span></td><td>' +
      esc(plan.customerName || plan.customerId) + '</td><td>' + badge(plan.collectionStatus || plan.status) +
      (plan.hasDraftChanges ? '<span class="secondary-line">Draft changes</span>' : '') + '</td><td class="nowrap">' +
      esc(plan.nextDueDate || '—') + '</td><td class="number">' + money(plan.scheduledOutstanding, plan.currency) +
      '</td><td class="number">' + money(plan.overdueAmount, plan.currency) + '</td><td class="number">' +
      money(plan.unscheduledAmount, plan.currency) + '</td><td><button class="compact" data-action="detail" data-id="' +
      esc(plan.id || plan.planId) + '">Open</button></td></tr>').join('') + '</tbody></table></div>';
}
function renderCollections() {
  const rows = (ui.state?.report?.installments || []).filter(searchMatch);
  if (!rows.length) return empty('No scheduled installments in this view', 'Activate a reviewed payment plan to add its dated installments here.');
  return '<div class="table-scroll"><table><thead><tr><th>Due date</th><th>Customer / invoice</th><th>Installment</th><th>Window</th>' +
    '<th class="number">Scheduled</th><th class="number">Paid</th><th class="number">Credits</th><th class="number">Remaining</th><th>Status</th></tr></thead><tbody>' +
    rows.map(row => '<tr><td class="nowrap">' + esc(row.dueDate) + '</td><td><button class="link-button" data-action="detail" data-id="' +
      esc(row.planId) + '">' + esc(row.customerName || row.customerId) + '</button><span class="secondary-line">' +
      esc(row.invoiceNumber || row.invoiceId) + '</span></td><td>' + esc(row.label || row.id) + '</td><td>' + esc(label(row.bucket)) +
      '</td><td class="number">' + money(row.amount,row.currency) + '</td><td class="number">' + money(row.paid) +
      '</td><td class="number">' + money(row.credited) + '</td><td class="number">' + money(row.remaining) +
      '</td><td>' + badge(row.status) + '</td></tr>').join('') + '</tbody></table></div>';
}
function renderUnplanned() {
  const rows = (ui.state?.report?.unplanned || []).filter(searchMatch);
  if (!rows.length) return empty('No unscheduled balances in this view', 'Current invoice balances are covered by the displayed schedules.');
  return '<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Original due</th><th class="number">Unscheduled</th><th>Reason</th><th></th></tr></thead><tbody>' +
    rows.map(row => '<tr><td>' + esc(row.invoiceNumber || row.invoiceId) + '</td><td>' + esc(row.customerName || row.customerId) +
      '</td><td class="nowrap">' + esc(row.originalDueDate || '—') + '</td><td class="number">' + money(row.amount,row.currency) +
      '</td><td>' + esc(label(row.reason)) + '</td><td><button class="compact" data-action="' + (row.planId ? 'detail' : 'new') +
      '" data-id="' + esc(row.planId || row.invoiceId) + '">' + (row.planId ? 'Review plan' : 'Plan balance') + '</button></td></tr>').join('') +
    '</tbody></table></div>';
}
function render() {
  renderSummary();
  $('#content').innerHTML = ui.tab === 'collections' ? renderCollections() : ui.tab === 'unplanned' ? renderUnplanned() : renderPlans();
  document.querySelectorAll('[data-tab]').forEach(button => {
    if (button.dataset.tab === ui.tab) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  $('#revision').textContent = 'Revision ' + String(ui.state?.revision ?? '—');
  renderPending();
}
async function refresh() {
  if (!ui.client) return;
  const sequence = ++ui.loadSequence;
  const result = await ui.client.state(filters());
  if (sequence !== ui.loadSequence) return;
  ui.state = result;
  fillCustomers(); render();
}
function openDialog(title, content) {
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  $('#dialog-message').replaceChildren();
  $('#dialog-message').classList.remove('error');
  if (!$('#dialog').open) $('#dialog').showModal();
}
function invoiceOptions(selected) {
  const candidates = new Map([...(ui.invoiceCatalog || []),...(ui.state?.invoices || [])].map(invoice => [invoice.id,invoice]));
  const plan = ui.detail?.plan;
  if (selected && !candidates.has(selected) && plan?.invoiceId === selected) {
    candidates.set(selected,{...plan.invoice,id:plan.invoiceId,number:plan.invoiceNumber,
      customerName:plan.customerName,customerId:plan.customerId,currency:plan.currency});
  }
  return [...candidates.values()].filter(invoice => invoice.issued && invoice.status !== 'VOID' || invoice.id === selected)
    .map(invoice => '<option value="' + esc(invoice.id) + '"' + (invoice.id === selected ? ' selected' : '') + '>' +
      esc((invoice.number || invoice.id) + ' · ' + (invoice.customerName || invoice.customerId) +
        (invoice.amountDue !== undefined ? ' · ' + invoice.amountDue + ' ' + (invoice.currency?.code || '') : '')) +
      '</option>').join('');
}
function readDraft() {
  const form = $('#plan-form');
  if (!form) return copy(ui.editor.draft);
  const get = name => form.elements.namedItem(name)?.value || '';
  return {...(ui.editor.draft.id ? {id:ui.editor.draft.id} : {}), invoiceId:get('invoiceId'), balanceDate:get('balanceDate'),
    title:get('title'), reference:get('reference'), customerNote:get('customerNote'),
    installments:[...form.querySelectorAll('[data-installment]')].map(row => ({
      ...(row.dataset.id ? {id:row.dataset.id} : {}),
      dueDate:row.querySelector('[name=dueDate]').value, amount:row.querySelector('[name=amount]').value,
      label:row.querySelector('[name=label]').value,
    }))};
}
function exactTotal(rows, scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) return '—';
  let total = 0n;
  for (const row of rows) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(row.amount || ''));
    if (!match || (match[2] || '').length > scale) return 'Enter valid amounts';
    total += BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] || '').padEnd(scale,'0') || '0');
  }
  const text = total.toString().padStart(scale + 1, '0');
  return scale ? text.slice(0,-scale) + '.' + text.slice(-scale) : text;
}
function updateEditorTotal() {
  if (!$('#editor-total') || !ui.editor) return;
  const draft = readDraft(), currency = selectedCurrency(draft);
  $('#editor-total').textContent = 'Scheduled total: ' + exactTotal(draft.installments, currency?.scale) + ' ' + (currency?.code || '');
}
function editorMarkup() {
  const draft = ui.editor.draft, currency = selectedCurrency(draft);
  const rows = draft.installments || [];
  return '<form id="plan-form"><div class="form-grid">' +
    '<label class="span-2">Issued invoice<select name="invoiceId" required' + (draft.id ? ' disabled' : '') + '>' + invoiceOptions(draft.invoiceId) + '</select></label>' +
    '<label>Balance date<input type="date" name="balanceDate" value="' + esc(draft.balanceDate) + '" required></label>' +
    '<label class="span-2">Plan title<input name="title" maxlength="240" value="' + esc(draft.title) + '" required></label>' +
    '<label>Customer reference<input name="reference" maxlength="240" value="' + esc(draft.reference) + '"></label>' +
    '<label class="span-3">Customer note<textarea name="customerNote" maxlength="4000">' + esc(draft.customerNote) + '</textarea></label></div>' +
    '<section class="form-section"><h3>Prepare equal installments</h3><div class="generation">' +
    '<label>First due date<input type="date" name="firstDueDate" value="' + esc(rows[0]?.dueDate || addDays(draft.balanceDate || dateToday(), 7)) + '"></label>' +
    '<label>Installments<input type="number" name="count" min="1" max="120" value="' + esc(rows.length || 3) + '"></label>' +
    '<label>Days between<input type="number" name="intervalDays" min="1" max="366" value="30"></label>' +
    '<button type="button" data-action="generate" data-request>Prepare schedule</button></div>' +
    '<p class="footnote">Uses the invoice balance on the selected date. You can adjust each date and amount before saving.</p></section>' +
    '<div class="review-heading"><h3>Installments</h3><span class="meta">' + esc(currency?.code || '') + '</span></div>' +
    '<div class="schedule-edit"><table><thead><tr><th>#</th><th>Label</th><th>Due date</th><th class="number">Amount</th><th></th></tr></thead><tbody>' +
    rows.map((row,index) => '<tr data-installment data-id="' + esc(row.id || '') + '"><td>' + (index+1) + '</td><td>' +
      '<input name="label" aria-label="Installment ' + (index+1) + ' label" maxlength="240" value="' + esc(row.label || '') + '"></td><td class="date">' +
      '<input type="date" name="dueDate" aria-label="Installment ' + (index+1) + ' due date" value="' + esc(row.dueDate) + '" required></td><td class="amount">' +
      '<input inputmode="decimal" name="amount" aria-label="Installment ' + (index+1) + ' amount" value="' + esc(row.amount) + '" required></td>' +
      '<td><button type="button" class="compact" data-action="remove-row" data-index="' + index + '" aria-label="Remove installment ' + (index+1) + '">Remove</button></td></tr>').join('') +
    '</tbody></table></div><div class="editor-bar"><button type="button" data-action="add-row">Add installment</button><span id="editor-total" class="editor-total"></span></div>' +
    '<div class="dialog-actions"><button type="button" data-action="close">Close</button><button class="primary" type="submit" data-mutates>Save draft</button></div></form>';
}
function showEditor(draft, options = {}) {
  ui.editor = {draft:copy(draft),version:options.version,revision:options.revision ?? ui.state.revision,
    workspaceId:options.workspaceId || ui.state.workspaceId};
  openDialog(draft.id ? 'Edit payment plan' : 'New payment plan', editorMarkup());
  updateEditorTotal();
}
function openNew(invoiceId) {
  if (!ui.state) throw new Error('Wait for the accounting workspace to open.');
  const candidate = invoiceById(invoiceId) || (ui.state.invoices || []).find(invoice =>
    invoice.issued && invoice.status !== 'VOID' && !/^0(?:\.0+)?$/.test(String(invoice.amountDue || '0')));
  if (!candidate) { openDialog('New payment plan', empty('Issue an invoice first','Open Receivables to create and issue the customer invoice, then prepare its payment schedule.',
    '<a class="button" href="/receivables/">Open invoices</a>')); return; }
  ui.detail = null;
  showEditor({invoiceId:candidate.id,balanceDate:$('#as-of').value,title:'Payment plan · ' + (candidate.number || candidate.id),
    reference:'',customerNote:'',installments:[]});
}
async function generate() {
  const draft = readDraft(), form = $('#plan-form');
  const result = await ui.client.generate({...draft, firstDueDate:form.elements.firstDueDate.value,
    count:Number(form.elements.count.value), intervalDays:Number(form.elements.intervalDays.value)});
  const generated = {...result.draft,...(draft.id ? {id:draft.id} : {})};
  showEditor(generated,{version:ui.editor.version,revision:result.revision,workspaceId:result.workspaceId});
  notice('Schedule prepared. Review the dates and amounts, then save the draft.',false,true);
}
function installmentsTable(rows,currency) {
  return '<div class="table-scroll"><table><thead><tr><th>Installment</th><th>Due date</th><th class="number">Scheduled</th>' +
    '<th class="number">Paid</th><th class="number">Credits</th><th class="number">Remaining</th><th>Status</th></tr></thead><tbody>' +
    rows.map((row,index) => '<tr><td>' + esc(row.label || 'Installment ' + (index+1)) + '</td><td class="nowrap">' + esc(row.dueDate) +
      '</td><td class="number">' + money(row.amount,currency) + '</td><td class="number">' + money(row.paid) +
      '</td><td class="number">' + money(row.credited) + '</td><td class="number">' + money(row.remaining ?? row.amount) +
      '</td><td>' + badge(row.status || 'SCHEDULED') + '</td></tr>').join('') + '</tbody></table></div>';
}
function editionLinks(planId,edition) {
  return ['schedule.html','schedule.csv','schedule.json','manifest.json'].map(name => '<a class="button compact" href="' +
    esc(ui.client.baseUrl + '/plans/' + encodeURIComponent(planId) + '/editions/' + encodeURIComponent(edition.id || edition.editionId) +
      '/files/' + name) + '" download>' + esc({'schedule.html':'Print-ready schedule','schedule.csv':'CSV','schedule.json':'JSON','manifest.json':'File manifest'}[name]) + '</a>').join('');
}
function accountActivity(ledger = {}, plan) {
  const receipts = new Map((ledger.receipts || []).map(receipt => [receipt.id,receipt]));
  const allocations = ledger.allocations || [], credits = ledger.credits || [], asOf = plan.asOf || $('#as-of').value;
  const allocationRows = allocations.map(item => {
    const receipt = receipts.get(item.receiptId) || {};
    const state = item.releasedDate && item.releasedDate <= asOf ? 'RELEASED' : item.allocatedDate > asOf ? 'FUTURE' : 'ACTIVE';
    return '<tr><td>' + esc(receipt.reference || item.receiptId) + '<span class="secondary-line">' +
      esc([receipt.method,receipt.receivedDate].filter(Boolean).join(' · ')) + '</span></td><td class="nowrap">' +
      esc(item.allocatedDate) + '</td><td class="nowrap">' + esc(item.releasedDate || '—') +
      '</td><td class="number">' + money(item.amount,item.currency || plan.currency) + '</td><td>' + badge(state) +
      '</td><td>' + esc(item.reason || '—') + '</td></tr>';
  }).join('');
  const creditRows = credits.map(item => '<tr><td>' + esc(item.number || item.id) +
    '</td><td class="nowrap">' + esc(item.date) + '</td><td class="number">' + money(item.amount,item.currency || plan.currency) +
    '</td><td>' + badge(item.date > asOf ? 'FUTURE' : 'APPLIED') + '</td></tr>').join('');
  return '<section class="subsection"><h3>Original account activity</h3><p class="meta">Balance effects as of ' + esc(asOf) + '</p>' +
    (allocations.length ? '<h4>Payment allocations</h4><div class="table-scroll"><table><thead><tr><th>Receipt / method</th><th>Allocated</th><th>Released</th>' +
      '<th class="number">Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>' + allocationRows + '</tbody></table></div>' : '<p class="muted">No payment allocations for this invoice.</p>') +
    (credits.length ? '<h4>Credit notes</h4><div class="table-scroll"><table><thead><tr><th>Credit note</th><th>Date</th><th class="number">Amount</th><th>Status</th>' +
      '</tr></thead><tbody>' + creditRows + '</tbody></table></div>' : '<p class="muted">No credit notes for this invoice.</p>') + '</section>';
}

async function openDetail(id) {
  const detail = await ui.client.detail(id,{asOf:$('#as-of').value});
  ui.detail = detail; ui.editor = null;
  const plan = detail.plan, planId = plan.id || plan.planId, rows = plan.installments || [], editions = detail.editions || [];
  openDialog(plan.title || plan.reference || 'Payment plan',
    '<div class="review-heading"><div>' + badge(plan.collectionStatus || plan.status) +
    (plan.hasDraftChanges ? ' <span class="meta">Saved draft changes</span>' : '') + '</div><span class="meta">Plan version ' + esc(plan.version) + '</span></div>' +
    '<dl class="details-grid"><div><dt>Customer</dt><dd>' + esc(plan.customerName || plan.customerId) + '</dd></div>' +
    '<div><dt>Invoice</dt><dd>' + esc(plan.invoiceNumber || plan.invoiceId) + '</dd></div>' +
    '<div><dt>Scheduled balance</dt><dd>' + money(plan.scheduledOutstanding,plan.currency) + '</dd></div>' +
    '<div><dt>Overdue</dt><dd>' + money(plan.overdueAmount,plan.currency) + '</dd></div>' +
    '<div><dt>Schedule effective date</dt><dd>' + esc(plan.effectiveDate || detail.draft?.balanceDate || '—') + '</dd></div>' +
    '<div><dt>Next due date</dt><dd>' + esc(plan.nextDueDate || '—') + '</dd></div>' +
    '<div><dt>Unscheduled balance</dt><dd>' + money(plan.unscheduledAmount,plan.currency) + '</dd></div>' +
    '<div><dt>Customer reference</dt><dd>' + esc(plan.reference || '—') + '</dd></div></dl>' +
    (plan.baselineChanged ? '<div class="notice">The invoice balance changed relative to this schedule. Review the unscheduled balance and prepare a revised edition when needed.</div>' : '') +
    (rows.length ? installmentsTable(rows,plan.currency) : plan.collectionStatus === 'CANCELLED' ?
      empty('Schedule cancelled','The remaining invoice balance is available in Unscheduled balances.') : plan.collectionStatus === 'FUTURE' ?
      empty('Schedule starts ' + (plan.effectiveDate || detail.draft?.balanceDate || ''),'Select its effective date or a later balance date to see the installment balances.') :
      empty('Draft schedule','Save and review the draft to activate a customer schedule.')) +
    (detail.draft?.customerNote ? '<section class="subsection"><h3>Draft customer note</h3><p class="review-note">' + esc(detail.draft.customerNote) + '</p></section>' : '') +
    accountActivity(detail.ledger,plan) +
    '<section class="subsection"><h3>Saved customer editions</h3>' + (editions.length ? editions.map(edition =>
      '<div class="form-section"><p><strong>Edition ' + esc(edition.editionNumber || edition.id) + '</strong> · effective ' + esc(edition.effectiveDate) +
      '<span class="secondary-line">Saved ' + esc(edition.createdAt) + ' by ' + esc(edition.actor) + '</span></p><div class="file-list">' +
      editionLinks(planId,edition) + '</div></div>').join('') : '<p class="muted">Activate the reviewed draft to retain its first customer edition.</p>') + '</section>' +
    '<section class="subsection"><h3>Plan history</h3><ul class="history-list">' + (detail.history || []).map(item =>
      '<li><strong>' + esc(label(item.action || item.type || item.status || 'Update')) + '</strong> · ' + esc(item.actor || '') +
      '<span class="secondary-line">' + esc(item.at || item.createdAt || item.date || '') + (item.reason ? ' · ' + esc(item.reason) : '') + '</span></li>').join('') +
    '</ul></section><div class="dialog-actions">' +
    (plan.status !== 'CANCELLED' ? '<button data-action="edit" data-id="' + esc(planId) + '">Edit draft</button>' : '') +
    (plan.status === 'ACTIVE' ? '<button data-action="cancel" data-id="' + esc(planId) + '">Cancel schedule</button>' : '') +
    (plan.status !== 'CANCELLED' ? '<button class="primary" data-action="review" data-request data-id="' + esc(planId) + '">Review and activate</button>' : '') + '</div>');
}
async function preview(id) {
  const review = await ui.client.previewPlan(id);
  const source = review.source || {}, schedule = review.schedule || {}, rows = schedule.installments || [];
  ui.review = review;
  openDialog('Review customer schedule',
    '<dl class="details-grid"><div><dt>Invoice</dt><dd>' + esc(source.invoiceNumber || source.invoiceId) + '</dd></div>' +
    '<div><dt>Balance date</dt><dd>' + esc(source.balanceDate || schedule.balanceDate) + '</dd></div>' +
    '<div><dt>Invoice amount due</dt><dd>' + money(source.amountDue,source.currency || schedule.currency) + '</dd></div>' +
    '<div><dt>Scheduled total</dt><dd>' + money(schedule.total,schedule.currency) + '</dd></div></dl>' +
    installmentsTable(rows,schedule.currency) +
    (schedule.customerNote ? '<section class="subsection"><h3>Customer note</h3><p class="review-note">' + esc(schedule.customerNote) + '</p></section>' : '') +
    '<p class="footnote">Activating retains this customer edition. Later invoice payments and credits update its balance; the saved schedule remains available in the plan history.</p>' +
    '<div class="dialog-actions"><button data-action="detail" data-id="' + esc(id) + '">Back to plan</button>' +
    '<button class="primary" data-action="activate" data-id="' + esc(id) + '" data-mutates>Activate reviewed schedule</button></div>');
}
function openCancel(id) {
  const plan = ui.detail.plan;
  openDialog('Cancel payment schedule',
    '<form id="cancel-form" class="cancel-form"><p>Choose when this schedule ends and record the reason for the customer account.</p>' +
    '<div class="form-grid"><label>Cancellation date<input type="date" name="cancelledDate" value="' + esc($('#as-of').value) + '" required></label>' +
    '<label class="span-3">Reason<textarea name="reason" maxlength="2000" required></textarea></label></div>' +
    '<div class="dialog-actions"><button type="button" data-action="detail" data-id="' + esc(id) + '">Back to plan</button>' +
    '<button type="submit" class="primary" data-mutates>Cancel schedule</button></div></form>');
  $('#cancel-form').dataset.id = id;
}
function envelope(value,revision,workspaceId) {
  const actor = $('#operator').value.trim();
  if (!actor) throw new Error('Enter the operator name before saving.');
  return {...value,revision,workspaceId,actor,requestId:'payment-plan-' + crypto.randomUUID()};
}
async function sendPending(item) {
  if (item.workspaceId && ui.state?.workspaceId && item.workspaceId !== ui.state.workspaceId) throw new Error('Reopen the original accounting workspace for this request.');
  if (item.method === 'savePlan') return ui.client.savePlan(item.value);
  if (item.method === 'activate') return ui.client.activate(item.planId,item.value);
  if (item.method === 'cancelPlan') return ui.client.cancelPlan(item.planId,item.value);
  throw new Error('The retained operation type is unsupported.');
}
async function completeOperation(result,title) {
  ui.pending = null; pendingSave();
  if ($('#dialog').open) $('#dialog').close();
  notice(title + ' saved.');
  try {
    await refresh();
    const id = result.plan?.id || result.plan?.planId || result.operation?.result?.planId;
    if (id) await openDetail(id);
  } catch (error) { notice(title + ' was saved. ' + error.message,true); }
}
async function mutate(method,value,{title,planId} = {}) {
  if (ui.pending) throw new Error('Finish or close the retained request before starting another operation.');
  ui.pending = {method,value,planId,title,workspaceId:value.workspaceId,savedAt:new Date().toISOString()};
  pendingSave();
  let result;
  try { result = await sendPending(ui.pending); }
  catch (error) {
    ui.pending.message = error.message;
    ui.pending.outcome = error.details?.outcome || 'rejected';
    pendingSave(); throw error;
  }
  await completeOperation(result,title);
}
async function retryPending() {
  if (!ui.pending) return;
  const title = ui.pending.title;
  let result;
  try { result = await sendPending(ui.pending); }
  catch (error) { ui.pending.message = error.message; ui.pending.outcome = error.details?.outcome || 'rejected'; pendingSave(); throw error; }
  await completeOperation(result,title);
}
async function checkPending() {
  if (!ui.pending) return;
  if (ui.pending.workspaceId && ui.state.workspaceId !== ui.pending.workspaceId) throw new Error('Reopen the original accounting workspace for this request.');
  const result = await ui.client.getOperation(ui.pending.value.requestId);
  if (result.operation) await completeOperation(result,ui.pending.title);
  else { ui.pending.message = 'No saved result was found for this request. Retry keeps its original identity and reviewed values.'; pendingSave(); }
}
async function saveDraft(event) {
  event.preventDefault();
  const draft = readDraft(), editor = ui.editor;
  if (!draft.installments.length) throw new Error('Add an installment or prepare an equal schedule before saving.');
  await mutate('savePlan',envelope({plan:draft,...(editor.version !== undefined ? {expectedVersion:editor.version} : {})},
    editor.revision,editor.workspaceId),{title:'Payment-plan draft',planId:draft.id});
}
function downloadBlob(blob,name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
async function action(button) {
  const {action:name,id} = button.dataset;
  if (name === 'close') { $('#dialog').close(); return; }
  if (name === 'tab') { ui.tab = button.dataset.tab; render(); return; }
  if (name === 'new') { openNew(id); return; }
  if (name === 'refresh' || name === 'apply') { if (ui.client) await refresh(); else await start(); notice('Balances refreshed.'); return; }
  if (name === 'detail') { await openDetail(id); return; }
  if (name === 'edit') {
    const detail = ui.detail?.plan && (ui.detail.plan.id || ui.detail.plan.planId) === id ? ui.detail : await ui.client.detail(id,{asOf:$('#as-of').value});
    ui.detail = detail;
    showEditor({...detail.draft,id},{version:detail.plan.version,revision:detail.revision,workspaceId:detail.workspaceId}); return;
  }
  if (name === 'generate') { await generate(); return; }
  if (name === 'add-row' || name === 'remove-row') {
    const draft = readDraft();
    if (name === 'remove-row') draft.installments.splice(Number(button.dataset.index),1);
    else draft.installments.push({dueDate:addDays(draft.installments.at(-1)?.dueDate || draft.balanceDate || dateToday(),30),
      amount:'',label:'Installment ' + (draft.installments.length + 1)});
    showEditor(draft,ui.editor); return;
  }
  if (name === 'review') { await preview(id); return; }
  if (name === 'activate') {
    const review = ui.review;
    if (!review || review.planId !== id) throw new Error('Review the current schedule first.');
    await mutate('activate',envelope({expectedVersion:review.planVersion,reviewSha256:review.reviewSha256},
      review.revision,review.workspaceId),{title:'Customer schedule',planId:id}); return;
  }
  if (name === 'cancel') { openCancel(id); return; }
  if (name === 'collections-file') {
    const response = await ui.client.collectionsFile(button.dataset.name,filters());
    downloadBlob(await response.blob(),button.dataset.name); return;
  }
  if (name === 'pending-check') { await checkPending(); return; }
  if (name === 'pending-retry') { await retryPending(); return; }
  if (name === 'pending-download') {
    downloadBlob(new Blob([JSON.stringify(ui.pending,null,2) + '\n'],{type:'application/json'}),'payment-plan-request.json'); return;
  }
  if (name === 'conflict-current' || name === 'conflict-local') {
    const conflict = ui.draftConflict;
    if (!conflict) throw new Error('Reopen the retained draft to compare its current version.');
    const draft = name === 'conflict-current' ? {...conflict.current.draft,id:conflict.current.plan.id || conflict.current.plan.planId} : conflict.draft;
    showEditor(draft,{version:conflict.current.plan.version,revision:conflict.current.revision,workspaceId:conflict.current.workspaceId});
    ui.draftConflict = null;
    notice(name === 'conflict-current' ? 'The current saved draft is open.' : 'Your draft is open against the current plan version. Review its changes before saving.',false,true);
    return;
  }
  if (name === 'pending-clear') {
    const retained = ui.pending;
    if (!retained) return;
    await refresh();
    if (retained.workspaceId && retained.workspaceId !== ui.state.workspaceId) throw new Error('Reopen the original accounting workspace to recover this request.');
    const saved = await ui.client.getOperation(retained.value.requestId);
    if (saved.operation) { await completeOperation(saved,retained.title); return; }
    const draft = retained.value.plan;
    if (retained.method === 'savePlan' && !invoiceById(draft.invoiceId)) {
      const catalog = await ui.client.state({asOf:$('#as-of').value,through:$('#through').value});
      ui.invoiceCatalog = catalog.invoices || [];
    }
    const current = retained.method === 'savePlan' && draft.id ?
      await ui.client.detail(draft.id,{asOf:$('#as-of').value}) : null;
    if (current) ui.detail = current;
    ui.pending = null; pendingSave();
    if (retained.method === 'savePlan') {
      if (current && current.plan.version !== retained.value.expectedVersion) {
        ui.draftConflict = {draft:copy(draft),current};
        const currency = current.plan.currency;
        openDialog('Review changes to this plan',
          '<p>The saved plan changed while your draft was open. Compare the two schedules and choose which draft to edit.</p>' +
          '<section class="subsection"><h3>Current saved draft</h3>' + installmentsTable(current.draft.installments || [],currency) +
          '</section><section class="subsection"><h3>Your retained draft</h3>' + installmentsTable(draft.installments || [],currency) +
          '</section><div class="dialog-actions"><button data-action="conflict-current">Open current draft</button>' +
          '<button class="primary" data-action="conflict-local">Edit my draft against current version</button></div>');
      } else {
        showEditor(draft,{version:current?.plan.version,revision:current?.revision ?? ui.state.revision,workspaceId:ui.state.workspaceId});
        notice('Your draft is recovered against the current workspace. Review it before saving.',false,true);
      }
    } else if (retained.planId) await openDetail(retained.planId);
    return;
  }
}
document.addEventListener('click',async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || ui.busy) return;
  setBusy(true);
  try { await action(button); } catch (error) { notice(error.message,true,$('#dialog').open); }
  finally { setBusy(false); renderPending(); }
});
document.addEventListener('submit',async event => {
  if (!['plan-form','cancel-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (ui.busy || !event.target.reportValidity()) return;
  setBusy(true);
  try {
    if (event.target.id === 'plan-form') await saveDraft(event);
    else {
      const form = event.target, detail = ui.detail;
      await mutate('cancelPlan',envelope({expectedVersion:detail.plan.version,cancelledDate:form.elements.cancelledDate.value,
        reason:form.elements.reason.value},detail.revision,detail.workspaceId),{title:'Schedule cancellation',planId:form.dataset.id});
    }
  } catch (error) { notice(error.message,true,true); }
  finally { setBusy(false); renderPending(); }
});
$('#search').addEventListener('input',() => { if (ui.state) render(); });
$('#customer-filter').addEventListener('change',() => refresh().catch(error => notice(error.message,true)));
document.addEventListener('input',event => { if (event.target.closest('#plan-form')) updateEditorTotal(); });
document.addEventListener('change',event => {
  if (event.target.matches('#plan-form [name=invoiceId]')) {
    const draft = readDraft(), invoice = invoiceById(draft.invoiceId);
    draft.installments = []; draft.title = 'Payment plan · ' + (invoice?.number || draft.invoiceId);
    showEditor(draft,ui.editor);
  }
});
async function start() {
  const response = await fetch('./config.json',{cache:'no-store',credentials:'same-origin',redirect:'error'});
  if (!response.ok) throw new Error('The payment-plan configuration could not be opened.');
  ui.config = await response.json();
  ui.client = new PaymentPlansClient({baseUrl:ui.config.apiPath});
  ui.storageKey = 'merchant-payment-plan-pending:' + location.origin + ui.config.apiPath;
  try {
    const stored = JSON.parse(sessionStorage.getItem(ui.storageKey) || 'null');
    if (stored && ['savePlan','activate','cancelPlan'].includes(stored.method) && typeof stored.value?.requestId === 'string') ui.pending = stored;
  } catch { /* An unreadable browser draft does not alter the original journal. */ }
  await refresh();
}
start().catch(error => { notice(error.message,true); $('#content').innerHTML = empty('Workspace could not be opened','Check the original Receivables process and select Refresh.'); });
