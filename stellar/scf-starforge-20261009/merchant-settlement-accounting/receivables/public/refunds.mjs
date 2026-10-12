// MIT. Customer refunds and credit disposition in the original receivables desk.
const e = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label = value => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase());
const field = (title, name, value = '', extra = '') =>
  '<label>' + e(title) + '<input name="' + e(name) + '" value="' + e(value) + '" ' + extra + '></label>';
const button = (title, action, id = '', extra = '') =>
  '<button type="button" data-action="refund-' + action + '" data-id="' + e(id) + '" ' + extra + '>' + e(title) + '</button>';
const money = (value, currency) => e(currency?.code || '') + ' ' + e(value ?? '—');
const today = () => new Date().toISOString().slice(0, 10);
const methods = new Set(['commitRefund', 'cancelRefund', 'reverseRefund', 'reportRefundReturn',
  'receiveRefund', 'applyCreditDisposition']);
const writes = new Set(['refund-new', 'refund-move', 'refund-commit', 'refund-apply', 'refund-cancel',
  'refund-reverse', 'refund-return', 'refund-receive', 'refund-adopt', 'refund-correct']);

/** Browser writes stay in the original retained request/revision queue. */
export function createRefundUi(host) {
  const {api, openDialog, mutate, getState, saveBlob, setBusy, showError} = host;
  let funds = null, selected = null, review = null, readVersion = 0;
  let draft = host.readSession('refundDraft');
  let list = {refunds: [], total: 0, offset: 0, limit: 100};
  let listQuery = {}, listError = '';

  const asOf = () => host.getAsOf?.() || getState()?.asOf || today();
  const currentCustomer = () => host.getCustomer?.() || '';
  const number = (value, currency) => host.units(value || '0', currency);
  const amount = (value, currency) => host.amount(value, currency);
  const positive = (value, currency) => { try { return number(value, currency) > 0n; } catch { return false; } };
  const sameCurrency = (a, b) => a?.code === b?.code && Number(a?.scale) === Number(b?.scale);
  const receipt = id => funds?.receipts?.find(row => row.id === id);
  const customer = id => getState()?.customers?.find(row => row.id === id);
  function formActions(title) {
    return '<div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button>' +
      '<button type="submit" class="primary" data-write>' + e(title) + '</button></div>';
  }
  function selectedText(value, choice) { return value === choice ? ' selected' : ''; }
  function remember(form) {
    if (!['refund-form', 'credit-disposition-form'].includes(form?.id)) return;
    draft = {kind: form.id === 'refund-form' ? 'refund' : 'disposition',
      receiptId: form.dataset.receipt, values: Object.fromEntries(new FormData(form))};
    host.saveSession('refundDraft', draft);
  }
  async function readFunds(customerId, date = asOf()) {
    const version = ++readVersion;
    const result = await api.customerFunds({...(customerId ? {customerId} : {}), asOf: date});
    if (version !== readVersion) return null;
    funds = result;
    return result;
  }
  function fundingFor(row) {
    return (funds?.eligibleFunding || []).filter(item => item.receiptId === row.id);
  }
  function originalReturnsFor(row) {
    return row ? (funds?.availableRefundReturns || []).filter(item => item.receiptId === row.id) : [];
  }
  function refundable(row) {
    return positive(row.availableToRefund ?? row.available, row.currency) ||
      fundingFor(row).some(item => positive(item.refundableAmount, item.currency));
  }
  function receiptActions(row) {
    if (row.status === 'VOID') return '';
    return button('Refund / credit', 'funds', row.customerId,
      'class="small" data-receipt="' + e(row.id) + '"');
  }
  function invoiceActions(invoice) {
    if (!positive(invoice.creditBalance, invoice.currency)) return '';
    return '<section class="section"><div class="row between"><h3>Paid customer credit</h3>' +
      button('Manage customer funds', 'funds', invoice.customerId) + '</div><p>' +
      money(invoice.creditBalance, invoice.currency) +
      ' is credited against this paid invoice. Review returning the payment or moving it to another invoice in this customer account.</p></section>';
  }
  function historyRows(rows) {
    return '<div class="table-wrap"><table><thead><tr><th>Refund / customer</th><th>Date / method</th><th class="num">Amount</th><th>Status</th><th class="num">Reserved</th><th class="num">Refunded</th></tr></thead><tbody>' +
      rows.map(row => '<tr><td>' + button(row.receiptReference || row.id, 'open', row.id, 'class="link"') +
        '<span class="subline">' + e(row.customerName) + '</span></td><td>' + e(row.effectiveDate) +
        '<span class="subline">' + e(label(row.kind)) + '</span></td><td class="num">' + money(row.amount, row.currency) +
        '</td><td>' + e(label(row.status)) + (row.accountingScope === 'TESTNET_OBSERVATION' ? '<span class="subline">Test network observation</span>' : '') + '</td><td class="num">' + e(row.reserved) +
        '</td><td class="num">' + e(row.refunded) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function renderLedger() {
    const rows = list.refunds || [], finish = Math.min(list.total || 0, (list.offset || 0) + rows.length);
    return '<section class="panel"><div class="panel-head"><h2>Refunds and customer credit</h2><div class="row">' +
      button('Customer funds', 'funds', currentCustomer()) + button('Refresh refunds', 'reload') + '</div></div>' +
      (listError ? '<div class="panel-body"><p class="notice error">' + e(listError) + '</p></div>' : '') +
      (rows.length ? historyRows(rows) : '<div class="panel-body"><p class="muted">Review customer overpayments and paid credits, retain completed refunds, and track pending Stellar returns.</p></div>') +
      '<div class="panel-foot row between"><span class="small-text muted">As of ' + e(listQuery.asOf || asOf()) +
      (list.total ? ' · ' + ((list.offset || 0) + 1) + '–' + finish + ' of ' + list.total : '') +
      '</span><div class="row">' + ((list.offset || 0) > 0 ? button('Previous', 'page', '', 'data-offset="' + Math.max(0, list.offset - list.limit) + '"') : '') +
      (finish < list.total ? button('Next', 'page', '', 'data-offset="' + finish + '"') : '') + '</div></div></section>';
  }
  async function loadList({customerId = currentCustomer(), date = asOf(), offset = 0} = {}) {
    listQuery = {...(customerId ? {customerId} : {}), asOf: date, offset, limit: 100};
    const query = {...listQuery};
    try {
      const result = await api.refunds(query);
      if (JSON.stringify(query) !== JSON.stringify(listQuery)) return;
      list = result; listError = '';
    } catch (error) {
      if (JSON.stringify(query) !== JSON.stringify(listQuery)) return;
      list = {refunds: [], total: 0, offset, limit: 100};
      listError = error.message || 'Refund history could not be loaded. Use Refresh refunds to retry.';
    }
  }
  function fundsView(preferredReceipt = '') {
    const value = funds, selectedCustomer = value.customer;
    const customers = value.customers || getState()?.customers || [];
    const rows = (value.receipts || []).filter(row => !selectedCustomer || row.customerId === selectedCustomer.id);
    const totals = value.currencies || [];
    openDialog('Customer funds' + (selectedCustomer ? ' · ' + selectedCustomer.name : ''),
      '<form id="customer-funds-form"><div class="form-grid"><label>Customer<select name="customerId" required><option value="">Choose a customer</option>' +
      customers.map(row => '<option value="' + e(row.id) + '"' + selectedText(selectedCustomer?.id, row.id) + '>' + e(row.name) + '</option>').join('') +
      '</select></label>' + field('Account date', 'asOf', value.asOf, 'type="date" required') +
      '</div><div class="dialog-actions"><button type="submit">Open account</button></div></form>' +
      (totals.length ? '<div class="table-wrap"><table><thead><tr><th>Currency</th><th class="num">Invoice credit</th><th class="num">Unapplied</th><th class="num">Reserved refunds</th><th class="num">Refunded</th></tr></thead><tbody>' +
      totals.map(row => '<tr><td>' + e(row.currency.code) + '</td><td class="num">' + e(row.creditBalance) +
        '</td><td class="num">' + e(row.unappliedPayments) + '</td><td class="num">' + e(row.reservedRefunds) +
        '</td><td class="num">' + e(row.refundedPayments) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      (rows.length ? '<section class="section"><h3>Original customer receipts</h3><div class="table-wrap"><table><thead><tr><th>Receipt</th><th class="num">Received</th><th class="num">Allocated</th><th class="num">Available to refund</th><th class="num">Reserved / refunded</th><th>Action</th></tr></thead><tbody>' +
        rows.map(row => '<tr' + (row.id === preferredReceipt ? ' class="selected"' : '') + '><td>' + e(row.reference || row.id) +
          '<span class="subline">' + e(row.receivedDate) + ' · ' + e(row.method) + '</span></td><td class="num">' + money(row.amount, row.currency) +
          '</td><td class="num">' + e(row.allocated) + '</td><td class="num">' + e(row.availableToRefund ?? row.available) +
          '</td><td class="num">' + e(row.reserved || amount(0n, row.currency)) + ' / ' + e(row.refunded || amount(0n, row.currency)) +
          '</td><td><div class="row">' + (row.status !== 'VOID' && refundable(row) ?
          button('Refund', 'new', row.id, 'data-write') + button('Move credit', 'move', row.id, 'data-write') : '') +
          (row.status !== 'VOID' && originalReturnsFor(row).length ? button('Reconcile verified payout', 'adopt', row.id, 'data-write') : '') +
          '</div></td></tr>').join('') + '</tbody></table></div></section>' :
        '<p class="muted">Choose a customer account with retained payment receipts.</p>') +
      '<p class="hint">A paid invoice credit can release a corresponding payment allocation. Review preserves the remaining payment, checks scheduled changes, and shows the resulting invoice and receipt balances.</p>');
  }
  async function openFunds(customerId, preferredReceipt = '', date = asOf()) {
    setBusy(true);
    try { if (await readFunds(customerId, date)) fundsView(preferredReceipt); }
    finally { setBusy(false); }
  }
  function fundingFields(row, saved = {}) {
    const rows = fundingFor(row).filter(item => positive(item.refundableAmount, item.currency));
    if (!rows.length) return '<p class="hint">This operation uses the receipt’s available unapplied amount.</p>';
    return '<section class="section"><h3>Release payment against issued credits</h3><p class="hint">Enter the credited payment to release from each invoice. Leave zero to keep its original allocation. Rows for the same invoice share that invoice’s total credit.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Invoice / payment date</th><th class="num">Allocated</th><th class="num">Invoice credit</th><th>Release amount</th></tr></thead><tbody>' +
      rows.map(item => '<tr data-refund-funding="' + e(item.allocationId) + '"><td>' + e(item.invoiceNumber || item.invoiceId) +
        '<span class="subline">' + e(item.allocatedDate) + '</span></td><td class="num">' + e(item.amount) +
        '</td><td class="num">' + e(item.invoiceCreditBalance) + '</td><td><input aria-label="Release from ' + e(item.invoiceNumber || item.invoiceId) +
        '" name="funding:' + e(item.allocationId) + '" inputmode="decimal" value="' +
        e(saved['funding:' + item.allocationId] || amount(0n, row.currency)) + '" data-amount required></td></tr>').join('') + '</tbody></table></div></section>';
  }
  function targetFields(row, saved = {}) {
    const rows = (funds.targetInvoices || []).filter(item => item.customerId === row.customerId &&
      sameCurrency(item.currency, row.currency) && positive(item.amountDue, row.currency));
    if (!rows.length) return '<p class="notice">There are no outstanding invoices in this receipt’s customer account and currency. Released credit can remain unapplied for a future invoice.</p>';
    return '<section class="section"><h3>Apply to outstanding invoices</h3><div class="table-wrap"><table><thead><tr><th>Invoice / due date</th><th class="num">Amount due</th><th>Apply amount</th></tr></thead><tbody>' +
      rows.map(item => '<tr data-refund-target="' + e(item.id) + '"><td>' + e(item.number || item.id) +
        '<span class="subline">' + e(item.dueDate) + '</span></td><td class="num">' + e(item.amountDue) +
        '</td><td><input aria-label="Apply to ' + e(item.number || item.id) + '" name="target:' + e(item.id) +
        '" inputmode="decimal" required value="' + e(saved['target:' + item.id] || amount(0n, row.currency)) +
        '"></td></tr>').join('') + '</tbody></table></div></section>';
  }
  function payoutFields(row, saved = {}) {
    const kind = saved.kind || 'OPERATOR_RECORDED';
    const adjustmentRows = (funds.availableAdjustments || []).filter(item => item.receiptId === row.id);
    const returnRows = originalReturnsFor(row);
    return '<section class="section"><h3>Refund method</h3><label>Payment route<select name="kind">' +
      [['OPERATOR_RECORDED','Record a completed refund'],['STELLAR_TRANSFER','Prepare and receive a Stellar transfer'],['ORIGINAL_RETURN','Reconcile an original verified payout'],['ORIGINAL_STELLAR_ADJUSTMENT','Use a verified original adjustment']]
        .map(([value,title]) => '<option value="' + value + '"' + selectedText(kind,value) + '>' + title + '</option>').join('') + '</select></label>' +
      '<div data-refund-kind="OPERATOR_RECORDED" class="form-grid">' +
      (saved.replacesRefundId ? '<input type="hidden" name="replacesRefundId" value="' + e(saved.replacesRefundId) + '"><p class="hint wide">This correction retains the original payment reference and actual bank date. Its accounting date retains the original reversal date for a payment that already happened.</p>' : '') +
      field('Payment method', 'method', saved.method || 'Bank transfer', 'required maxlength="100"') +
      field('Completed payment reference', 'reference', saved.reference, 'required maxlength="300"') +
      field('Actual refund date', 'refundDate', saved.refundDate || funds.asOf, 'type="date" required') +
      '<p class="hint wide">Retain the reference and date of the completed payment. Its amount is removed from this receipt’s available funds.</p></div>' +
      '<div data-refund-kind="STELLAR_TRANSFER" class="form-grid"><label>Network<select name="network">' +
      '<option value="stellar:pubnet"' + selectedText(saved.network || 'stellar:pubnet','stellar:pubnet') + '>Public network</option>' +
      '<option value="stellar:testnet"' + selectedText(saved.network,'stellar:testnet') + '>Test network</option></select></label>' +
      field('Merchant paying account', 'sourceAccount', saved.sourceAccount, 'required minlength="56" maxlength="56" autocomplete="off" spellcheck="false"') +
      field('Customer destination account', 'destination', saved.destination, 'required minlength="56" maxlength="56" autocomplete="off" spellcheck="false"') +
      '<label>Asset<select name="assetKind"><option value="native"' + selectedText(saved.assetKind || 'native','native') + '>Native XLM</option>' +
      '<option value="credit"' + selectedText(saved.assetKind,'credit') + '>Issued asset</option></select></label>' +
      field('Asset code', 'assetCode', saved.assetCode, 'maxlength="12" data-refund-issued required') +
      field('Asset issuer', 'assetIssuer', saved.assetIssuer, 'minlength="56" maxlength="56" spellcheck="false" data-refund-issued required') +
      field('Exact amount received by customer', 'stellarAmount', saved.stellarAmount, 'inputmode="decimal" required') +
      field('Wallet message', 'msg', saved.msg, 'maxlength="300"') +
      '<p class="hint wide" data-refund-network-note></p></div>' +
      '<div data-refund-kind="ORIGINAL_RETURN"><label>Original verified payout<select name="originalReturnId" required><option value="">Choose the original transaction</option>' +
      returnRows.map(item => '<option value="' + e(item.originalReturnId) + '"' + selectedText(saved.originalReturnId,item.originalReturnId) + '>' +
        e(item.closedAt?.slice(0,10) || '') + ' · ' + e(item.amount) + ' ' + e(item.currency?.code) + ' · ' + e(item.transaction) + '</option>').join('') + '</select></label>' +
      (!returnRows.length ? '<p class="hint">No original verified, unposted public payout is available for this receipt.</p>' :
        '<p class="hint">This payment has already transferred. Review derives its original ledger date, sender, recipient, asset, amount and memo from the retained native proof.</p>') + '</div>' +
      '<div data-refund-kind="ORIGINAL_STELLAR_ADJUSTMENT"><label>Verified original adjustment<select name="adjustmentId" required><option value="">Choose a verified adjustment</option>' +
      adjustmentRows.map(item => '<option value="' + e(item.adjustmentId) + '"' + selectedText(saved.adjustmentId,item.adjustmentId) + '>' +
        e(item.transferAt || '') + ' · ' + e(item.network) + ' · ' + e(item.transaction) + '</option>').join('') + '</select></label>' +
      (!adjustmentRows.length ? '<p class="hint">This receipt has no unused verified original refund adjustment available.</p>' : '') + '</div>' +
      '<label data-refund-valuation>Commercial valuation basis<textarea name="valuationNote" rows="3" maxlength="4000" required>' + e(saved.valuationNote) + '</textarea></label></section>';
  }
  function edit(receiptId, kind = 'refund') {
    const row = receipt(receiptId);
    if (!row) throw new Error('Open the original customer funds before reviewing this receipt.');
    const saved = draft?.receiptId === receiptId && draft.kind === kind ? draft.values : {};
    const formId = kind === 'refund' ? 'refund-form' : 'credit-disposition-form';
    review = null;
    openDialog((kind === 'refund' ? 'Customer refund' : 'Move customer credit') + ' · ' + (row.reference || row.id),
      '<form id="' + formId + '" data-receipt="' + e(row.id) + '"><dl class="definition"><dt>Customer</dt><dd>' +
      e(funds.customer?.name || customer(row.customerId)?.name || row.customerId) + '</dd><dt>Original receipt</dt><dd>' +
      money(row.amount,row.currency) + ' · ' + e(row.receivedDate) + '</dd><dt>Available to refund</dt><dd>' +
      money(row.availableToRefund ?? row.available,row.currency) + '</dd></dl><div class="form-grid">' +
      field('Effective account date', 'effectiveDate', saved.effectiveDate || funds.asOf, 'type="date" required') +
      (kind === 'refund' ? field('Commercial refund amount · ' + row.currency.code, 'amount',
        saved.amount || row.availableToRefund || row.available, 'inputmode="decimal" required') : '') +
      '<label class="wide">Reason<textarea name="reason" rows="3" maxlength="3000" required>' + e(saved.reason) + '</textarea></label>' +
      '<label class="wide">Customer note<textarea name="customerNote" rows="2" maxlength="3000">' + e(saved.customerNote) + '</textarea></label></div>' +
      fundingFields(row, saved) + (kind === 'refund' ? payoutFields(row,saved) : targetFields(row,saved)) +
      '<p class="hint">Review uses the selected effective date and all retained scheduled allocations, reservations and refunds.</p>' +
      formActions(kind === 'refund' ? 'Review refund' : 'Review credit disposition') + '</form>');
    updateKind();
  }
  function updateKind() {
    const form = document.querySelector('#refund-form');
    if (!form) return;
    const kind = form.elements.kind.value;
    form.querySelectorAll('[data-refund-kind]').forEach(section => {
      const active = section.dataset.refundKind === kind; section.hidden = !active;
      section.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !active; });
    });
    const stellar = kind === 'STELLAR_TRANSFER', issued = stellar && form.elements.assetKind.value === 'credit';
    form.querySelectorAll('[data-refund-issued]').forEach(input => { input.disabled = !issued; input.required = issued; });
    const networkNote = form.querySelector('[data-refund-network-note]');
    networkNote.textContent = form.elements.network.value === 'stellar:testnet'
      ? 'Test-network refunds retain the reviewed transfer and its original network observation. Customer balances use completed commercial refunds.'
      : 'The reviewed request reserves customer funds. Complete the payment in the merchant wallet, retain its transaction hash, and receive the original network result here.';
    const valuation = form.querySelector('[data-refund-valuation]');
    valuation.hidden = kind === 'OPERATOR_RECORDED';
    form.elements.valuationNote.disabled = kind === 'OPERATOR_RECORDED';
  }
  function formInput(form, values) {
    const row = receipt(form.dataset.receipt);
    if (!row) throw new Error('Reopen the original customer receipt.');
    const selectedAmount = (value, title) => {
      const units = number(value,row.currency);
      if (units < 0n) throw new Error('Enter zero or a positive ' + title + '.');
      return units;
    };
    const funding = [...form.querySelectorAll('[data-refund-funding]')].map(item => ({
      allocationId: item.dataset.refundFunding, amount: values['funding:' + item.dataset.refundFunding]
    })).filter(item => selectedAmount(item.amount,'credit release amount') > 0n);
    const common = {receiptId: row.id, effectiveDate: values.effectiveDate, reason: values.reason,
      customerNote:values.customerNote || '', funding};
    if (form.id === 'credit-disposition-form') {
      const allocations = [...form.querySelectorAll('[data-refund-target]')].map(item => ({
        invoiceId: item.dataset.refundTarget, amount: values['target:' + item.dataset.refundTarget]
      })).filter(item => selectedAmount(item.amount,'invoice allocation amount') > 0n);
      return {...common, allocations};
    }
    let payout;
    if (values.kind === 'OPERATOR_RECORDED') payout = {kind: values.kind, method: values.method,
      reference: values.reference, refundDate: values.refundDate,
      ...(values.replacesRefundId ? {replacesRefundId:values.replacesRefundId} : {})};
    else if (values.kind === 'ORIGINAL_STELLAR_ADJUSTMENT') payout = {kind: values.kind,
      adjustmentId: values.adjustmentId, valuationNote: values.valuationNote};
    else if (values.kind === 'ORIGINAL_RETURN') {
      const original = originalReturnsFor(row).find(item => item.originalReturnId === values.originalReturnId);
      if (!original) throw new Error('Choose the retained verified payout for this original receipt.');
      payout = {kind:'STELLAR_TRANSFER', originalRefundId:original.originalRefundId,
        originalReturnId:original.originalReturnId, valuationNote:values.valuationNote};
    }
    else payout = {kind: 'STELLAR_TRANSFER', sourceAccount: values.sourceAccount, destination: values.destination,
      network: values.network, asset: values.assetKind === 'credit' ?
        {kind:'credit',code:values.assetCode,issuer:values.assetIssuer} : {kind:'native',code:'XLM',issuer:null},
      stellarAmount: values.stellarAmount, valuationNote: values.valuationNote,
      ...(values.msg ? {msg:values.msg} : {})};
    return {...common, amount: values.amount, payout};
  }
  function effectsView(effects) {
    if (!effects) return '';
    const original = effects.receipt?.before, updated = effects.receipt?.after;
    const receiptRows = ['allocated','reserved','refunded','available'];
    return '<section class="section"><h3>Account balances · ' + e(effects.asOf) + '</h3>' +
      (original && updated ? '<div class="table-wrap"><table><thead><tr><th>Receipt balance</th><th class="num">Before</th><th class="num">After</th></tr></thead><tbody>' +
      receiptRows.map(key => '<tr><td>' + e(label(key)) + '</td><td class="num">' +
        money(original[key] ?? amount(0n,original.currency),original.currency) + '</td><td class="num">' +
        money(updated[key] ?? amount(0n,updated.currency),updated.currency) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      ((effects.invoices || []).length ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th class="num">Paid before / after</th><th class="num">Due before / after</th><th class="num">Credit before / after</th></tr></thead><tbody>' +
      effects.invoices.map(item => '<tr><td>' + e(item.invoiceNumber || item.invoiceId) + '</td><td class="num">' +
        e(item.before.paid) + ' / ' + e(item.after.paid) + '</td><td class="num">' + e(item.before.amountDue) + ' / ' + e(item.after.amountDue) +
        '</td><td class="num">' + e(item.before.creditBalance) + ' / ' + e(item.after.creditBalance) + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</section>';
  }
  function proposalView(proposal) {
    const payout = proposal.payout || {}, currency = proposal.currency || proposal.receipt?.currency;
    return '<dl class="definition"><dt>Customer</dt><dd>' + e(proposal.customer?.name || funds?.customer?.name) +
      '</dd><dt>Original receipt</dt><dd>' + e(proposal.receipt?.reference || receipt(proposal.receiptId)?.reference || proposal.receiptId) +
      '</dd><dt>Effective account date</dt><dd>' + e(proposal.effectiveDate) +
      '</dd>' + (proposal.amount !== undefined ? '<dt>Commercial amount</dt><dd>' + money(proposal.amount,currency) + '</dd>' : '') +
      '<dt>Reason</dt><dd>' + e(proposal.reason) + '</dd>' +
      (proposal.customerNote ? '<dt>Customer note</dt><dd>' + e(proposal.customerNote) + '</dd>' : '') +
      (proposal.accountingScope ? '<dt>Account treatment</dt><dd>' + e(proposal.accountingScope === 'TESTNET_OBSERVATION' ? 'Test network observation' : 'Commercial customer funds') + '</dd>' : '') +
      (payout.kind ? '<dt>Payment route</dt><dd>' + e(payout.originalReturnId ? 'Original verified payout' : label(payout.kind)) + '</dd>' : '') +
      (payout.originalReturnId ? '<dt>Original transaction</dt><dd class="mono payment-wrap">' + e(payout.transaction) + '</dd><dt>Actual ledger date</dt><dd>' + e(payout.refundDate || payout.closedAt) + '</dd>' : '') +
      (payout.kind === 'OPERATOR_RECORDED' ? '<dt>Completed refund</dt><dd>' + e(payout.method) + ' · ' + e(payout.reference) +
        ' · ' + e(payout.refundDate) + '</dd>' +
        (payout.accountingDate && payout.accountingDate !== payout.refundDate ? '<dt>Accounting date</dt><dd>' + e(payout.accountingDate) + '</dd>' : '') +
        (payout.replacesRefundId ? '<dt>Corrects original refund</dt><dd>' + e(payout.replacesRefundId) + '</dd>' : '') : '') +
      (payout.kind === 'STELLAR_TRANSFER' ? '<dt>Network</dt><dd>' + e(payout.network) + '</dd><dt>Merchant pays from</dt><dd class="mono payment-wrap">' +
        e(payout.sourceAccount) + '</dd><dt>Customer receives at</dt><dd class="mono payment-wrap">' + e(payout.destination) +
        '</dd><dt>Exact asset received</dt><dd>' + e(payout.stellarAmount) + ' ' + e(payout.asset?.code) + '</dd>' +
        (payout.asset?.issuer ? '<dt>Asset issuer</dt><dd class="mono payment-wrap">' + e(payout.asset.issuer) + '</dd>' : '') +
        (payout.memo ? '<dt>Refund memo</dt><dd class="mono payment-wrap">' + e(typeof payout.memo === 'object' ? payout.memo.value : payout.memo) + '</dd>' : '') : '') +
      (payout.kind === 'ORIGINAL_STELLAR_ADJUSTMENT' ? '<dt>Verified original adjustment</dt><dd class="mono payment-wrap">' + e(payout.adjustmentId) + '</dd>' : '') +
      (payout.valuationNote ? '<dt>Valuation basis</dt><dd>' + e(payout.valuationNote) + '</dd>' : '') + '</dl>' +
      (proposal.sourceRefundCancellation ? '<p class="notice">This review replaces the original pending reservation from ' + e(proposal.sourceRefundCancellation.refundId) + ' on ' + e(proposal.sourceRefundCancellation.cancelledDate) + ' with its actual verified payout.</p>' : '') +
      ((proposal.funding || []).length ? '<section class="section"><h3>Credited payment releases</h3><div class="table-wrap"><table><thead><tr><th>Original allocation</th><th class="num">Released</th><th class="num">Payment retained</th></tr></thead><tbody>' +
      proposal.funding.map(item => '<tr><td>' + e(item.invoiceNumber || item.invoiceId || item.allocationId) + '</td><td class="num">' +
        e(item.amount) + (item.previousReleasedDate ? '<span class="subline">Original release ' + e(item.previousReleasedDate) + '</span>' : '') + '</td><td class="num">' + e(item.replacementAmount) +
        (item.replacementReleasedDate ? '<span class="subline">Until ' + e(item.replacementReleasedDate) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div></section>' : '') +
      ((proposal.allocations || []).length ? '<section class="section"><h3>Payment applied to invoices</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th class="num">Apply</th></tr></thead><tbody>' +
      proposal.allocations.map(item => '<tr><td>' + e(item.invoiceNumber || item.invoiceId) + '</td><td class="num">' +
        money(item.amount,currency) + '</td></tr>').join('') + '</tbody></table></div></section>' : '');
  }
  async function preview(form, values) {
    remember(form);
    const kind = form.id === 'refund-form' ? 'refund' : 'disposition', input = formInput(form, values);
    const version = ++readVersion; setBusy(true);
    try {
      const result = await (kind === 'refund' ? api.previewRefund(input) : api.previewCreditDisposition(input));
      if (version !== readVersion || !form.isConnected || !document.querySelector('#dialog')?.open) return;
      review = {...result, kind};
      openDialog(kind === 'refund' ? 'Review customer refund' : 'Review customer credit disposition',
        proposalView(result.proposal) + effectsView(result.balanceEffects) +
        '<div class="dialog-actions">' + button('Edit', kind === 'refund' ? 'edit' : 'edit-move', input.receiptId) +
        button(kind === 'refund' ? (result.proposal.payout?.kind === 'STELLAR_TRANSFER' && result.proposal.payout.walletHandoff !== false ? 'Retain transfer request' : 'Record completed refund') : 'Apply credit disposition',
          kind === 'refund' ? 'commit' : 'apply', input.receiptId, 'class="primary" data-write') + '</div>');
    } finally { setBusy(false); }
  }
  function returnRows(detail) {
    const rows = detail.returns || [];
    if (!rows.length) return '<p class="muted">Retain the wallet transaction hash after the transfer is submitted.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Transaction</th><th>Latest receiving</th><th>Action</th></tr></thead><tbody>' +
      rows.map(row => {
        const observation = row.observations?.at(-1) || row.observation;
        return '<tr><td class="mono payment-wrap">' + e(row.transaction) + '</td><td>' +
          e(label(observation?.status || row.status || 'REFERENCE_RECORDED')) + '</td><td>' +
          (row.resolvedRefundId ? button('Open recorded refund', 'open', row.resolvedRefundId) :
            (detail.proposal.payout?.walletHandoff !== false ? button('Receive transfer', 'receive', detail.refund.id,
              'data-return="' + e(row.id) + '" data-write') : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function openDetail(detail) {
    selected = detail;
    const row = detail.refund, payout = detail.proposal.payout || {};
    const fileRows = Object.entries({...detail.files,'status.json':{},'receiving.json':{}});
    const wallet = payout.uri || detail.proposal.uri;
    const safeWallet = typeof wallet === 'string' && wallet.startsWith('web+stellar:pay?');
    openDialog('Customer refund · ' + (row.receiptReference || row.id),
      '<div class="row between"><span class="status">' + e(label(row.status)) + '</span><span class="small-text">As of ' +
      e(detail.asOf) + '</span></div>' + proposalView(detail.proposal) +
      '<div class="stats"><div class="stat"><span>Reserved</span><strong>' + money(row.reserved,row.currency) +
      '</strong></div><div class="stat"><span>Refunded</span><strong>' + money(row.refunded,row.currency) + '</strong></div></div>' +
      (safeWallet && payout.walletHandoff !== false && row.status === 'AWAITING_TRANSFER' ? '<section class="section"><h3>Merchant wallet</h3><p><a class="payment-wallet" href="' +
        e(wallet) + '">Open reviewed refund in a Stellar wallet</a></p>' + button('Copy wallet request', 'copy', row.id) + '</section>' : '') +
      (payout.kind === 'STELLAR_TRANSFER' ? '<section class="section"><div class="row between"><h3>Original transfer receiving</h3>' +
        (payout.walletHandoff !== false ? button('Record transaction hash', 'return', row.id, 'data-write') : '') +
        '</div>' + returnRows(detail) + '</section>' : '') +
      effectsView(detail.balanceEffects) +
      (fileRows.length ? '<section class="section"><h3>Saved refund files</h3><div class="row">' + fileRows.map(([name]) =>
        button(name, 'download', row.id, 'data-name="' + e(name) + '"')).join('') + '</div></section>' : '') +
      '<section class="section"><h3>Refund history</h3><div class="table-wrap"><table><thead><tr><th>Time / operator</th><th>Action / reason</th></tr></thead><tbody>' +
      (detail.history || []).map(item => '<tr><td>' + e(item.at || item.createdAt) + '<span class="subline">' + e(item.actor) +
        '</span></td><td>' + e(label(item.action)) + '<span class="subline">' + e(item.reason || '') + '</span></td></tr>').join('') +
      '</tbody></table></div></section><div class="dialog-actions">' +
      (row.status === 'AWAITING_TRANSFER' ? button('Cancel pending refund', 'cancel', row.id, 'data-write') : '') +
      (row.status === 'RECORDED' && row.kind === 'OPERATOR_RECORDED' ? button('Correct recorded refund', 'reverse', row.id, 'data-write') : '') +
      (row.status === 'REVERSED' && row.kind === 'OPERATOR_RECORDED' ? button('Record corrected refund', 'correct', row.id, 'data-write') : '') + '</div>');
  }
  async function openRefund(id) {
    const version = ++readVersion; setBusy(true);
    try {
      const result = await api.refund(id,{asOf: asOf()});
      if (version === readVersion) openDetail(result);
    } finally { setBusy(false); }
  }
  async function submit(form, values) {
    if (form.id === 'customer-funds-form') { await openFunds(values.customerId,'',values.asOf); return true; }
    if (form.id === 'refund-form' || form.id === 'credit-disposition-form') { await preview(form,values); return true; }
    if (form.id === 'refund-return-form') {
      await mutate('reportRefundReturn',[form.dataset.id,{transaction:values.transaction.toLowerCase()}],'Retain refund transaction reference'); return true;
    }
    if (form.id === 'refund-reason-form') {
      const cancel = form.dataset.kind === 'cancel';
      await mutate(cancel ? 'cancelRefund' : 'reverseRefund',[form.dataset.id,
        {reason: values.reason, [cancel ? 'cancelledDate' : 'reversedDate']:values.effectiveDate}],
        cancel ? 'Cancel pending refund' : 'Correct recorded refund'); return true;
    }
    return false;
  }
  async function click(control) {
    const action = control.dataset.action, id = control.dataset.id;
    if (!action?.startsWith('refund-')) return false;
    if (host.isLocked() && writes.has(action)) throw new Error('Finish the retained operation before starting another change.');
    if (action === 'refund-funds') await openFunds(id,control.dataset.receipt);
    else if (action === 'refund-new' || action === 'refund-edit') edit(id,'refund');
    else if (action === 'refund-adopt') {
      const row = receipt(id), original = row && originalReturnsFor(row)[0];
      if (!original) throw new Error('Open the original customer account and choose its retained payout.');
      draft = {kind:'refund',receiptId:id,values:{kind:'ORIGINAL_RETURN',originalReturnId:original.originalReturnId,
        effectiveDate:original.closedAt.slice(0,10),amount:original.amount,
        reason:'Reconcile original verified customer payout',valuationNote:original.valuationNote || '',
        customerNote:original.customerNote || ''}};
      host.saveSession('refundDraft',draft); setBusy(true);
      try { if (await readFunds(row.customerId,draft.values.effectiveDate)) edit(id,'refund'); }
      finally { setBusy(false); }
    }
    else if (action === 'refund-correct') {
      if (selected?.refund.id !== id || selected.refund.status !== 'REVERSED')
        throw new Error('Open the original reversed refund before preparing its correction.');
      const row=selected.refund,payout=selected.proposal.payout;
      const date=row.reversedDate || asOf();
      draft={kind:'refund',receiptId:row.receiptId,values:{kind:'OPERATOR_RECORDED',
        replacesRefundId:id,method:payout.method,reference:payout.reference,refundDate:payout.refundDate,
        amount:row.amount,effectiveDate:date,customerNote:selected.proposal.customerNote || '',
        reason:'Correct original refund record '+(row.receiptReference || id)}};
      host.saveSession('refundDraft',draft);setBusy(true);
      try{if(await readFunds(row.customerId,date))edit(row.receiptId,'refund');}
      finally{setBusy(false);}
    }
    else if (action === 'refund-move' || action === 'refund-edit-move') edit(id,'disposition');
    else if (action === 'refund-open') await openRefund(id);
    else if (action === 'refund-reload' || action === 'refund-page') {
      await loadList({offset: action === 'refund-page' ? Number(control.dataset.offset) : 0}); host.render();
    } else if (action === 'refund-commit' || action === 'refund-apply') {
      const kind = action === 'refund-commit' ? 'refund' : 'disposition';
      if (!review || review.kind !== kind || review.proposal.receiptId !== id)
        throw new Error('Review the complete original account change before saving.');
      await mutate(kind === 'refund' ? 'commitRefund' : 'applyCreditDisposition',
        [{proposal:review.proposal,reviewSha256:review.reviewSha256}],
        kind === 'refund' ? 'Retain customer refund' : 'Apply customer credit', {revision:review.revision});
    } else if (action === 'refund-return') {
      openDialog('Retain original refund transaction', '<form id="refund-return-form" data-id="' + e(id) + '">' +
        field('Transaction hash', 'transaction', '', 'required minlength="64" maxlength="64" spellcheck="false" autocomplete="off"') +
        '<p class="hint">Receiving checks the original successful transfer against the reviewed merchant account, customer destination, exact asset amount and refund memo.</p>' +
        formActions('Retain transaction reference') + '</form>');
    } else if (action === 'refund-receive') {
      await mutate('receiveRefund',[id,{returnId:control.dataset.return}],'Receive original refund transfer');
    } else if (action === 'refund-cancel' || action === 'refund-reverse') {
      const cancel = action === 'refund-cancel';
      openDialog(cancel ? 'Cancel pending refund' : 'Correct recorded refund',
        '<form id="refund-reason-form" data-id="' + e(id) + '" data-kind="' + (cancel ? 'cancel' : 'reverse') + '">' +
        '<p>' + (cancel ? 'Cancellation releases the pending refund reservation. Any reviewed credit releases remain in the original dated allocation history.' :
          'Use this correction when the operator-recorded refund was entered in error or returned. Its original payment record remains in history, and the amount becomes available again on the correction date.') + '</p>' +
        field('Effective account date', 'effectiveDate', asOf(), 'type="date" required') +
        '<label>Reason<textarea name="reason" rows="3" maxlength="3000" required></textarea></label>' +
        formActions(cancel ? 'Cancel pending refund' : 'Record correction') + '</form>');
    } else if (action === 'refund-download') {
      const response = await api.refundFile(id,control.dataset.name);
      saveBlob(await response.blob(),control.dataset.name);
    } else if (action === 'refund-copy') {
      if (selected?.refund.id !== id) throw new Error('Open the original refund before copying.');
      const uri = selected.proposal.payout?.uri || selected.proposal.uri;
      if (!uri) throw new Error('This original refund has no wallet request.');
      await navigator.clipboard.writeText(uri); host.setMessage('Reviewed refund wallet request copied.');
    }
    return true;
  }
  async function afterMutation(result, operation) {
    if (!methods.has(operation.method)) return;
    if (['commitRefund','applyCreditDisposition'].includes(operation.method)) {
      draft = null; host.saveSession('refundDraft',null);
    }
    if (result.refund?.id) await openRefund(result.refund.id).catch(showError);
    else if (operation.method === 'applyCreditDisposition') {
      const customerId = result.receipt?.customerId || result.creditDisposition?.customerId || currentCustomer();
      await openFunds(customerId).catch(showError);
    }
  }
  async function refreshFormDate(form) {
    const row = receipt(form.dataset.receipt), date = form.elements.effectiveDate.value;
    if (!row || !date || date === funds.asOf) return;
    remember(form); setBusy(true);
    try {
      const updated = await readFunds(row.customerId,date);
      if (updated && form.isConnected && document.querySelector('#dialog')?.open)
        edit(row.id,form.id === 'refund-form' ? 'refund' : 'disposition');
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  return {methods, receiptActions, invoiceActions, renderLedger, loadList, submit, click, afterMutation,
    input(target) { remember(target.closest('#refund-form,#credit-disposition-form')); },
    change(target) {
      const form = target.closest('#refund-form');
      if (form) {
        updateKind();
        if (target.name === 'originalReturnId' && form.elements.kind.value === 'ORIGINAL_RETURN') {
          const original = originalReturnsFor(receipt(form.dataset.receipt)).find(item => item.originalReturnId === target.value);
          if (original) { form.elements.effectiveDate.value = original.closedAt.slice(0,10); form.elements.amount.value = original.amount;
            form.elements.valuationNote.value=original.valuationNote || '';form.elements.customerNote.value=original.customerNote || ''; }
        }
      }
      const edited = target.closest('#refund-form,#credit-disposition-form');
      remember(edited);
      if (edited && (target.name === 'effectiveDate' || target.name === 'originalReturnId'))
        void refreshFormDate(edited);
    },
    close() { readVersion++; }};
}
