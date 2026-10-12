// MIT. Invoice wallet handoff and receiving in the existing operator lifecycle.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label = value => String(value || 'ISSUED').replaceAll('_', ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase());
const field = (title, name, value = '', attributes = '') =>
  '<label>' + escape(title) + '<input name="' + name + '" value="' + escape(value) + '" ' + attributes + '></label>';
const button = (title, action, id = '', attributes = '') =>
  '<button type="button" data-action="payment-' + action + '" data-id="' + escape(id) + '" ' + attributes + '>' + escape(title) + '</button>';
const money = (amount, currency) => escape(currency?.code || '') + ' ' + escape(amount);
const fileNames = [['payment-request.html', 'Printable payment request'], ['payment-request.json', 'Customer JSON'],
  ['receiving.json', 'Complete receiving history']];
const methods = new Set(['createPaymentRequest', 'cancelPaymentRequest', 'reportPaymentReturn', 'receivePaymentRequest']);

/** All writes use the host's retained request/revision queue. */
export function createPaymentRequestUi(host) {
  const {api, openDialog, mutate, getState, getInvoice, saveBlob, showError, setBusy} = host;
  let reviewed = null, selected = null, readVersion = 0;
  let retainedDraft = host.readSession('paymentRequestDraft');

  function invoiceById(id) {
    return getState()?.invoices?.find(row => row.id === id) || getInvoice();
  }
  function actions(title) {
    return '<div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button>' +
      '<button type="submit" class="primary" data-write>' + escape(title) + '</button></div>';
  }
  function rows(invoice) {
    return (getState()?.paymentRequests || []).filter(row => row.invoiceId === invoice.id);
  }
  function render(invoice) {
    if (!invoice || invoice.status === 'DRAFT') return '';
    const requests = rows(invoice);
    return '<section class="section"><div class="row between"><h3>Stellar payment requests</h3>' +
      (invoice.status === 'ISSUED' ? button('Create payment request', 'new', invoice.id, 'data-write') : '') + '</div>' +
      (requests.length ? '<div class="table-wrap"><table><thead><tr><th>Request / expiry</th><th class="num">Invoice amount</th><th>Status</th></tr></thead><tbody>' +
      requests.map(row => '<tr><td><button type="button" class="link" data-action="payment-open" data-id="' + escape(row.id) + '">' +
        escape(row.asset?.code) + ' ' + escape(row.stellarAmount) + '</button><span class="subline">' +
        escape(row.expiresAt || 'No expiry') + '</span></td><td class="num">' + money(row.invoiceAmount, row.currency) +
        '</td><td>' + escape(label(row.status)) + (row.returnCount ? '<span class="subline">' + row.returnCount + ' returned reference(s)</span>' : '') +
        '</td></tr>').join('') + '</tbody></table></div>' :
        '<p class="muted small-text">Create a customer wallet request from this issued invoice and retain its collection history here.</p>') +
      '</section>';
  }
  function createDialog(invoiceId) {
    readVersion++;
    const invoice = invoiceById(invoiceId);
    if (!invoice || invoice.status !== 'ISSUED') throw new Error('Choose an issued invoice for this collection.');
    const draft = retainedDraft?.invoiceId === invoice.id ? retainedDraft : {
      invoiceId: invoice.id, invoiceAmount: invoice.amountDue, network: 'stellar:pubnet', destination: '',
      assetKind: 'native', assetCode: '', assetIssuer: '', stellarAmount: invoice.currency.code === 'XLM' ? invoice.amountDue : '',
      valuationNote: '', expiresAt: new Date(Date.now() + 86400000).toISOString(), msg: 'Invoice ' + invoice.number,
    };
    openDialog('Stellar collection · ' + (invoice.number || invoice.id),
      '<form id="payment-request-form" data-invoice="' + escape(invoice.id) + '"><p>Select the invoice value and the exact asset amount the merchant will receive.</p>' +
      '<div class="form-grid">' +
      field('Invoice amount · ' + invoice.currency.code, 'invoiceAmount', draft.invoiceAmount, 'required inputmode="decimal"') +
      '<label>Stellar network<select name="network"><option value="stellar:pubnet"' + (draft.network === 'stellar:pubnet' ? ' selected' : '') +
        '>Public network</option><option value="stellar:testnet"' + (draft.network === 'stellar:testnet' ? ' selected' : '') + '>Test network</option></select></label>' +
      field('Merchant destination (G account)', 'destination', draft.destination, 'required spellcheck="false" autocomplete="off" maxlength="56"') +
      '<label>Asset<select name="assetKind"><option value="native"' + (draft.assetKind === 'native' ? ' selected' : '') +
        '>Native XLM</option><option value="credit"' + (draft.assetKind === 'credit' ? ' selected' : '') + '>Issued asset</option></select></label>' +
      field('Asset code (case sensitive)', 'assetCode', draft.assetCode, 'maxlength="12" data-credit-asset') +
      field('Asset issuer (G account)', 'assetIssuer', draft.assetIssuer, 'spellcheck="false" autocomplete="off" maxlength="56" data-credit-asset') +
      field('Stellar amount received', 'stellarAmount', draft.stellarAmount, 'required inputmode="decimal"') +
      field('Expires at (UTC, ISO date and time)', 'expiresAt', draft.expiresAt, 'required placeholder="2026-10-20T18:00:00Z"') +
      '<label class="wide">Valuation basis<textarea name="valuationNote" rows="3" maxlength="4000">' + escape(draft.valuationNote) + '</textarea></label>' +
      '<label class="wide">Wallet message<textarea name="msg" rows="2" maxlength="300">' + escape(draft.msg) + '</textarea></label></div>' +
      '<p class="hint">Record the agreed conversion or value basis when the invoice currency and received asset differ. A unique transaction memo links the payment to this request.</p>' +
      '<p class="hint">Test-network receiving is recorded as a test observation. Public-network receiving creates the invoice receipt and allocation.</p>' +
      actions('Review payment request') + '</form>');
    updateAssetFields();
  }
  function updateAssetFields() {
    const form = document.querySelector('#payment-request-form');
    if (!form) return;
    const credit = form.elements.assetKind.value === 'credit';
    form.querySelectorAll('[data-credit-asset]').forEach(input => { input.disabled = !credit; input.required = credit; });
  }
  function persistDraft(form) {
    if (form?.id !== 'payment-request-form') return;
    retainedDraft = {...Object.fromEntries(new FormData(form)), invoiceId: form.dataset.invoice};
    host.saveSession('paymentRequestDraft', retainedDraft);
  }
  function proposalView(proposal) {
    const invoice = proposal.invoice || {}, asset = proposal.asset || {};
    return '<dl class="definition"><dt>Invoice</dt><dd>' + escape(invoice.number || invoice.id) +
      '</dd><dt>Customer</dt><dd>' + escape(invoice.customer?.name || invoice.customer?.displayName || invoice.customer?.id) +
      '</dd><dt>Invoice value</dt><dd>' + money(proposal.invoiceAmount, invoice.currency) +
      '</dd><dt>Stellar network</dt><dd>' + escape(proposal.network) +
      '</dd><dt>Merchant receives</dt><dd>' + escape(proposal.stellarAmount) + ' ' + escape(asset.code) +
      '</dd><dt>Destination</dt><dd class="mono payment-wrap">' + escape(proposal.destination) +
      '</dd>' + (asset.kind === 'credit' ? '<dt>Issuer</dt><dd class="mono payment-wrap">' + escape(asset.issuer) + '</dd>' : '') +
      '<dt>Transaction memo</dt><dd class="mono payment-wrap">' + escape(proposal.memo?.type) + ' · ' + escape(proposal.memo?.value) +
      '</dd><dt>Expiry</dt><dd>' + escape(proposal.expiresAt) +
      '</dd><dt>Valuation basis</dt><dd class="preline">' + escape(proposal.valuationNote || 'Original XLM invoice value') + '</dd></dl>' +
      (proposal.msg ? '<p class="preline">' + escape(proposal.msg) + '</p>' : '');
  }
  async function preview(form, values) {
    persistDraft(form);
    const input = {invoiceAmount: values.invoiceAmount, network: values.network, destination: values.destination,
      asset: values.assetKind === 'native' ? {kind: 'native', code: 'XLM', issuer: null} :
        {kind: 'credit', code: values.assetCode, issuer: values.assetIssuer},
      stellarAmount: values.stellarAmount, expiresAt: values.expiresAt, msg: values.msg, valuationNote: values.valuationNote};
    const version = ++readVersion;
    setBusy(true);
    try {
      const result = await api.previewPaymentRequest(form.dataset.invoice, input);
      if (version !== readVersion || !form.isConnected || !document.querySelector('#dialog')?.open) return;
      reviewed = result;
      openDialog('Review customer payment request', proposalView(result.proposal) +
        '<p class="hint">Issue retains these exact instructions with the original invoice and current balance. The customer reviews and authorizes payment in their wallet.</p>' +
        '<div class="dialog-actions">' + button('Edit instructions', 'edit', result.proposal.invoice.id) +
        button('Issue payment request', 'issue', result.proposal.invoice.id, 'class="primary" data-write') + '</div>');
    } finally { setBusy(false); }
  }
  function observation(row) {
    const proof = row.observation || row.verification || row.observations?.at(-1) || row.proofs?.at(-1);
    return proof?.result || proof?.verification || proof || {};
  }
  function canCorrectPayer(row) {
    return !row.receiptId && !(row.observations || []).some(item => item.verification?.status === 'VERIFIED');
  }
  function historyDescription(item) {
    if (item.action === 'transaction_payer_corrected') {
      return '<span class="subline payment-wrap">From ' + escape(item.previousPayer || 'Use the payment sender') +
        ' to ' + escape(item.payer || 'Use the payment sender') + '</span>' +
        '<span class="subline preline">' + escape(item.note) + '</span>';
    }
    return item.reason ? '<span class="subline">' + escape(item.reason) + '</span>' : '';
  }
  function returnRows(detail) {
    const returns = detail.returns || [];
    if (!returns.length) return '<p class="muted">No transaction reference has been recorded.</p>';
    return returns.map(row => {
      const seen = observation(row), latest = row.observations?.at(-1) || row.observation;
      const code = latest?.status || seen.status || row.status || 'REFERENCE_RECORDED';
      return '<section class="section"><div class="row between"><strong>' + escape(label(code)) +
        '</strong><div class="row">' + button('Inspect and receive', 'receive', detail.paymentRequest.id,
          'data-return="' + escape(row.id) + '" data-write') +
        (canCorrectPayer(row) ? button('Correct sending account', 'correct-payer', detail.paymentRequest.id,
          'data-return="' + escape(row.id) + '" data-write') : '') + '</div></div>' +
        '<dl class="definition"><dt>Transaction</dt><dd class="mono payment-wrap">' + escape(row.transaction) +
        '</dd><dt>Payer</dt><dd class="mono payment-wrap">' + escape(row.payer || seen.payer || 'Derived during verification') +
        '</dd>' + (seen.closedAt ? '<dt>Ledger close</dt><dd>' + escape(seen.closedAt) + '</dd>' : '') +
        (seen.reason ? '<dt>Latest result</dt><dd>' + escape(seen.reason) + '</dd>' : '') + '</dl>' +
        button('Download verification history', 'download', detail.paymentRequest.id,
          'data-name="proof-' + escape(row.id) + '.json"') + '</section>';
    }).join('');
  }
  async function openRequest(id) {
    const version = ++readVersion;
    const detail = await api.paymentRequest(id, {asOf: getState()?.asOf});
    if (version !== readVersion) return;
    selected = detail; reviewed = null;
    const row = detail.paymentRequest, proposal = detail.proposal;
    openDialog('Payment request · ' + (row.invoiceNumber || proposal.invoice.number),
      '<div class="row between"><strong>' + escape(label(row.status)) + '</strong><span class="small-text">Issued ' + escape(row.issuedAt || detail.issuedAt) +
      '</span></div>' + proposalView(proposal) +
      (row.balanceChanged ? '<p class="notice">The invoice balance has changed since this request was issued. Review current allocations before delivering these instructions again.</p>' : '') +
      '<div class="stats"><div class="stat"><span>Received</span><strong>' + money(row.received, row.currency) +
      '</strong></div><div class="stat"><span>Applied</span><strong>' + money(row.applied, row.currency) +
      '</strong></div><div class="stat"><span>Available receipt</span><strong>' + money(row.unapplied, row.currency) + '</strong></div></div>' +
      '<section class="section"><h3>Customer handoff</h3>' +
      (row.payable ? '<p><a class="payment-wallet" href="' + escape(row.uri || proposal.uri) + '">Open payment in a Stellar wallet</a></p>' : '') +
      '<div class="row">' + button('Copy wallet URI', 'copy', row.id) + fileNames.map(([name, title]) =>
        button(title, 'download', row.id, 'data-name="' + name + '"')).join('') + '</div>' +
      '<details class="section"><summary>Exact wallet URI</summary><textarea rows="4" readonly class="mono payment-uri">' +
        escape(row.uri || proposal.uri) + '</textarea></details></section>' +
      '<section class="section"><div class="row between"><h3>Transaction receiving</h3>' +
        button('Record transaction reference', 'return', row.id, 'data-write') + '</div>' + returnRows(detail) + '</section>' +
      '<section class="section"><h3>Request history</h3><div class="table-wrap"><table><thead><tr><th>Time / operator</th><th>Action</th></tr></thead><tbody>' +
      (detail.history || []).map(item => '<tr><td>' + escape(item.at || item.createdAt) + '<span class="subline">' + escape(item.actor) +
        '</span></td><td>' + escape(item.action === 'transaction_payer_corrected' ? 'Sending account corrected' : label(item.action)) +
        historyDescription(item) + '</td></tr>').join('') +
      '</tbody></table></div></section>' +
      (!row.cancelledAt ? '<div class="dialog-actions">' + button('Withdraw request', 'cancel', row.id, 'data-write') + '</div>' : ''));
  }
  function recordReturn(id) {
    openDialog('Record the customer transaction reference', '<form id="payment-return-form" data-id="' + escape(id) +
      '"><p>Retain the submitted transaction hash, then inspect the original network result. An optional paying account narrows the match.</p><div class="form-grid">' +
      field('Transaction hash', 'transaction', '', 'required minlength="64" maxlength="64" spellcheck="false" autocomplete="off"') +
      field('Paying account (optional G account)', 'payer', '', 'minlength="56" maxlength="56" spellcheck="false" autocomplete="off"') +
      '<label class="wide">Internal note<textarea name="note" rows="3" maxlength="4000"></textarea></label></div>' +
      actions('Retain transaction reference') + '</form>');
  }
  function correctPayerDialog(id, returnId) {
    const row = selected?.paymentRequest?.id === id && selected.returns?.find(item => item.id === returnId);
    if (!row) throw new Error('Reopen this payment request before correcting the sending account.');
    if (!canCorrectPayer(row)) throw new Error('The sending account is fixed after this transaction has been verified.');
    openDialog('Correct the sending account', '<form id="payment-payer-form" data-id="' + escape(id) +
      '"><p>Correct the account used to match this transaction. Leave it blank to use the account that sent the matching payment.</p>' +
      '<div class="form-grid">' +
      field('Saved transaction hash', 'transaction', row.transaction, 'readonly spellcheck="false"') +
      field('Sending account (optional G account)', 'payer', row.payer || '',
        'minlength="56" maxlength="56" spellcheck="false" autocomplete="off"') +
      '<label class="wide">Reason for correction<textarea name="note" required rows="3" maxlength="4000"></textarea></label></div>' +
      '<p class="hint">The transaction reference and previous observations stay in the history. Save the correction, then inspect and receive this reference again.</p>' +
      actions('Save sending account correction') + '</form>');
  }
  function receiveDialog(id, returnId) {
    const row = selected?.paymentRequest;
    if (!row || row.id !== id) throw new Error('Reopen this payment request before receiving.');
    openDialog('Inspect and receive Stellar payment', '<form id="payment-receive-form" data-id="' + escape(id) +
      '" data-return="' + escape(returnId) + '"><p>The original transaction is checked against the exact network, destination, asset, received amount and memo.</p>' +
      '<div class="form-grid"><label>After public-network verification<select name="allocate"><option value="true">Apply up to the invoice balance</option>' +
      '<option value="false">Retain the receipt for later allocation</option></select></label>' +
      field('Allocation date', 'allocatedDate', getState()?.asOf || new Date().toISOString().slice(0, 10), 'type="date" required') +
      '</div><p class="hint">The receipt uses the request’s retained commercial valuation. Any amount beyond the current invoice balance remains available on the customer receipt.</p>' +
      actions('Verify transaction and receive') + '</form>');
  }
  async function submit(form, values) {
    if (form.id === 'payment-request-form') { await preview(form, values); return true; }
    if (form.id === 'payment-return-form') {
      await mutate('reportPaymentReturn', [form.dataset.id, {transaction: values.transaction.toLowerCase(), note: values.note, ...(values.payer ? {payer: values.payer} : {})}], 'Record Stellar transaction reference'); return true;
    }
    if (form.id === 'payment-payer-form') {
      await mutate('reportPaymentReturn', [form.dataset.id, {
        transaction: values.transaction.toLowerCase(), payer: values.payer.trim() || null, note: values.note,
      }], 'Correct Stellar sending account'); return true;
    }
    if (form.id === 'payment-receive-form') {
      await mutate('receivePaymentRequest', [form.dataset.id, {returnId: form.dataset.return,
        allocate: values.allocate === 'true', allocatedDate: values.allocatedDate}], 'Inspect and receive Stellar payment'); return true;
    }
    if (form.id === 'payment-cancel-form') {
      await mutate('cancelPaymentRequest', [form.dataset.id, {reason: values.reason}], 'Withdraw Stellar payment request'); return true;
    }
    return false;
  }
  async function click(control) {
    const action = control.dataset.action, id = control.dataset.id;
    if (!action?.startsWith('payment-')) return false;
    if (host.isLocked() && ['payment-new','payment-edit','payment-issue','payment-return','payment-correct-payer','payment-receive','payment-cancel'].includes(action)) {
      throw new Error('Finish the retained operation before starting another change.');
    }
    if (action === 'payment-new' || action === 'payment-edit') createDialog(id);
    else if (action === 'payment-open') await openRequest(id);
    else if (action === 'payment-issue') {
      if (!reviewed || reviewed.proposal.invoice.id !== id) throw new Error('Review the exact request before issuing.');
      await mutate('createPaymentRequest', [id, {proposal: reviewed.proposal, reviewSha256: reviewed.reviewSha256}], 'Issue Stellar payment request');
    } else if (action === 'payment-return') recordReturn(id);
    else if (action === 'payment-correct-payer') correctPayerDialog(id, control.dataset.return);
    else if (action === 'payment-receive') receiveDialog(id, control.dataset.return);
    else if (action === 'payment-cancel') {
      openDialog('Withdraw payment request', '<form id="payment-cancel-form" data-id="' + escape(id) +
        '"><p>Withdrawal retires these instructions in this workspace. Retained customer copies remain in their original history.</p>' +
        '<label>Reason<textarea name="reason" required rows="3" maxlength="4000"></textarea></label>' + actions('Withdraw request') + '</form>');
    } else if (action === 'payment-copy') {
      if (selected?.paymentRequest?.id !== id) throw new Error('Open the request before copying its URI.');
      try { await navigator.clipboard.writeText(selected.proposal.uri); host.setMessage('Wallet URI copied.'); }
      catch { throw new Error('Select and copy the complete URI from Exact wallet URI.'); }
    } else if (action === 'payment-download') {
      const response = await api.paymentRequestFile(id, control.dataset.name);
      saveBlob(await response.blob(), control.dataset.name);
    }
    return true;
  }
  async function afterMutation(result, operation) {
    if (!methods.has(operation.method)) return;
    if (operation.method === 'createPaymentRequest') {
      retainedDraft = null; host.saveSession('paymentRequestDraft', null);
    }
    const id = result.paymentRequest?.id || operation.args[0];
    if (id) await openRequest(id).catch(showError);
  }
  return {render, submit, click, afterMutation, methods,
    input(target) { const form = target.closest('#payment-request-form'); if (form) persistDraft(form); },
    change(target) { if (target.closest('#payment-request-form')) { updateAssetFields(); persistDraft(target.form); } },
    close() { readVersion++; }};
}
