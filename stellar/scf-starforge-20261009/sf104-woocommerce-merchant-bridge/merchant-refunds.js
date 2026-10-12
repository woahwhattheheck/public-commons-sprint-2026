/* MIT. Refund work inside the store's existing merchant order console. */
(() => {
  'use strict';
  const SCHEMA = 'stellar-forge.sf104.merchant-refund.v1';
  const VIEW = 'stellar-forge.sf104.merchant-refunds.v1';
  const HASH = /^[a-f0-9]{64}$/;
  const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const REQUEST_FIELDS = ['id','runId','eventId','kind','amountAtomic','effectiveAt','reason','reference','actor','createdAt'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value)), x => x.toString(16).padStart(2, '0')).join('');
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  const human = code => ({
    REFUND_ORDER_REVISION_CHANGED:'The order or its refund history changed. Refresh this view, review the current totals, and prepare again.',
    REFUND_ORDER_IDENTITY_CHANGED:'The order contents changed after review. Reopen its original payment review before continuing.',
    REFUND_EXCEEDS_ORIGINAL_NATIVE_AMOUNT:'The prepared and recorded native returns would exceed this order’s original Stellar payment.',
    REFUND_EXCEEDS_REMAINING_WOO_AMOUNT:'This credit would exceed the Woo order amount remaining after its current refunds and prepared credits.',
    REFUND_ID_OR_TRANSFER_ALREADY_ASSIGNED:'This adjustment or native return transaction is already assigned. Reopen its existing order record.',
    REFUND_MAPPING_ALREADY_COMMITTED:'This mapping has begun applying. Reopen its saved review to recover the same Woo refund.',
    ORIGINAL_NATIVE_REVIEW_REQUIRED:'Finish this order’s original native payment review before importing a verified return.',
    REFUND_ORIGINAL_PAYMENT_CHANGED:'The imported return does not match this order’s released native payment.',
    REFUND_NATIVE_TERMS_MISMATCH:'The return proof differs from the selected original network, asset, payer, recipient, or amount.',
    WOO_REFUND_MISSING_RECONCILIATION_REQUIRED:'The retained mapping names a Woo refund that is no longer present. Review the original Woo refund history.',
    WOO_REFUND_RECORD_CHANGED:'The native Woo refund differs from its retained mapping. Review the saved refund in the Woo order.',
    REFUND_REOPEN_REQUIRED:'Reopen this same order and review its current refund records.',
  }[code] || String(code || 'The refund request could not complete.').replaceAll('_', ' '));

  async function validateCandidate(record, event, snapshot, exported) {
    const original = snapshot.originalPayment, native = original.reviewedTransfer, binding = original.binding;
    need(record?.schema === 'stellar-forge.merchant-adjustment.v1' && record.kind === 'REFUND' &&
      record.status === 'VERIFIED' && UUID.test(record.id) && record.eventId === original.eventId &&
      record.original?.eventId === original.eventId, 'Select a verified refund for this original payment.');
    need(native && binding && original.state === 'RELEASED', 'Complete the original native payment review first.');
    need(record.source?.runId === record.runId && HASH.test(record.source?.reportSha256 || '') &&
      HASH.test(record.source?.inputManifestSha256 || ''), 'The adjustment’s retained source is incomplete.');
    need(record.requestSha256 === await hash(jsonBytes(Object.fromEntries(REQUEST_FIELDS.map(key => [key, record[key]])))),
      'The retained adjustment request changed.');
    need(/^[1-9][0-9]{0,38}$/.test(record.amountAtomic) && BigInt(record.amountAtomic) <= BigInt(binding.amountAtomic),
      'The return amount must fit the original payment.');
    need(exported.source && ['runId','reportSha256','inputManifestSha256'].every(key =>
      exported.source[key] === record.source[key]), 'The export and selected adjustment refer to different source reports.');
    const ledger = exported.originalReport?.ledger;
    need(Array.isArray(ledger), 'Keep the original accounting report in this adjustment export.');
    const retained = ledger.filter(row => row.eventId === record.eventId && row.network === record.original.network);
    need(retained.length === 1, 'The original report must contain this payment exactly once.');
    for (const source of [record.original, event.original, retained[0]]) {
      need(source.eventId === original.eventId && source.routeId === binding.routeId && source.method === binding.method &&
        source.network === binding.network && source.assetDigest === binding.assetDigest &&
        source.amountAtomic === binding.amountAtomic && source.transactionFingerprint === await hash(original.transactionHash) &&
        (source.recipientDigest ?? source.termsRecipientDigest) === binding.recipientDigest,
        'The adjustment’s original payment terms differ from this Woo order.');
      need(source.orderReferenceDigest === await hash(snapshot.orderReference),
        'The accounting event belongs to another original Woo order.');
    }
    need(record.refundTerms?.network === native.network && record.refundTerms.asset === native.asset &&
      record.refundTerms.from === native.recipient && record.refundTerms.to === native.payer,
      'The refund terms must reverse this original payment.');
    const proof = record.verification?.proof;
    need(proof?.schema === 'stellar-forge.sf86.refund-reconciliation.v1' &&
      proof.origin === 'MERCHANT_REFUND' && proof.reservation === 'NOT_APPLICABLE_MERCHANT_REFUND' &&
      proof.refundId === record.id && proof.network === native.network && proof.asset === native.asset &&
      proof.payer === native.recipient && proof.recipient === native.payer &&
      proof.atomicAmount === record.amountAtomic && proof.matchingTransfers === 1 &&
      HASH.test(proof.transaction || '') && proof.transaction !== original.transactionHash &&
      proof.transaction === record.verification.transaction && proof.ledger === record.verification.ledger &&
      proof.transferAt === record.verification.transferAt && proof.observedAt === record.verification.verifiedAt,
      'The original reverse transfer does not match this retained refund.');
    need((proof.network === 'stellar:testnet' && proof.verdict === 'CHAIN_TRANSFER_MATCHED_RPC_TESTNET') ||
      (proof.network === 'stellar:pubnet' && proof.verdict === 'CHAIN_TRANSFER_MATCHED_RPC_PUBNET'),
      'Use the completed native network verification export.');
    return record;
  }
  function moneyValid(value, decimals) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value)) return false;
    const parts = value.split('.');
    return (parts[1] || '').length <= decimals && BigInt(parts.join('')) > 0n;
  }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function mount(container, {orderId, config}) {
    let snapshot = null, candidates = [], sourceSha256 = null, importedName = '', current = null, busy = false, lastReview = null;
    const endpoint = new URL(config.merchantApi.replace(/\/$/, '') + '/' + orderId + '/refunds', location.href);
    need(endpoint.origin === location.origin, 'Open the refund workspace on this store’s own origin.');
    const active = () => container.isConnected;
    const message = (value, error = false) => {
      const node = container.querySelector('[data-refund-message]');
      if (node) { node.textContent = value; node.className = error ? 'sf104-notice sf104-refund-error' : 'sf104-help'; }
    };
    async function request(suffix = '', body) {
      const response = await fetch(endpoint.href + suffix, {method:body ? 'POST' : 'GET', credentials:'same-origin',
        redirect:'error', headers:{'X-WP-Nonce':config.nonce, accept:'application/json', ...(body ? {'content-type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {})});
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(human(value.status)), {status:response.status,code:value.status});
      return value;
    }
    function assign(value) {
      need(value?.schema === VIEW && value.orderReference === orderId &&
        HASH.test(value.revision) && Array.isArray(value.adjustments) && Array.isArray(value.refunds), 'The store returned a different refund record.');
      snapshot = value;
    }
    const fact = (label, value) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    function render() {
      if (!active()) return;
      const order = snapshot.order, original = snapshot.originalPayment;
      const records = snapshot.adjustments.map(row => '<tr><td><strong>' + esc(row.status) + '</strong><small>' + esc(row.adjustmentId) +
        '</small></td><td>' + esc(row.amountAtomic) + '<small>Atomic units · ' + esc(row.network) + '</small></td><td>' +
        esc(row.currency + ' ' + row.wooAmount) + '</td><td>' + (row.refundId ? '#' + esc(row.refundId) : 'Prepared credit') +
        '<small>' + esc(row.reason) + '</small></td><td><button type="button" class="sf104-button" data-refund-review="' +
        esc(row.adjustmentId) + '">Review</button></td></tr>').join('');
      const woo = snapshot.refunds.map(row => '<tr><td>#' + esc(row.id) + '</td><td>' + esc(row.currency + ' ' + row.amount) +
        '</td><td>' + esc(row.adjustmentId || 'Created in the store’s existing refund workflow') + '</td><td>' +
        esc(row.reason) + '</td></tr>').join('');
      container.innerHTML = '<section class="sf104-panel sf104-refunds"><div class="sf104-panel-heading"><div><h3>Verified returns and order credits</h3>' +
        '<p>Connect a completed Stellar return to the matching credit on this Woo order.</p></div><button type="button" class="sf104-button" data-refund-refresh>Refresh refunds</button></div>' +
        '<div data-refund-message role="status" aria-live="polite"></div><dl class="sf104-facts">' +
        fact('Order status', order.status) + fact('Download access now', order.downloadsPermitted ? 'Permitted by store rules' : 'Unavailable under store rules') +
        fact('Original Woo total', order.currency + ' ' + order.total) + fact('Already credited', order.currency + ' ' + order.refundedTotal) +
        fact('Remaining Woo amount', order.currency + ' ' + order.remainingTotal) + fact('Original Stellar amount', original.binding?.amountAtomic || 'Not yet bound') +
        '</dl><p class="sf104-help">The Stellar amount and Woo currency amount are separate. Review the store credit explicitly. This amount-only workflow keeps item quantities and existing download records. A credit for the remaining total normally changes the order to Refunded, which can end download access under the store’s rules. Product returns stay in the Woo order’s item controls.</p></section>' +
        '<section class="sf104-panel"><h3>Import the original verified adjustment</h3><p>Choose Report JSON from the merchant accounting workspace’s adjustment export. Only matching, verified returns can be prepared.</p>' +
        '<label class="sf104-refund-file">Accounting adjustment export<input type="file" accept=".json,application/json" data-refund-import' + (busy ? ' disabled' : '') + '></label>' +
        (importedName ? '<p class="sf104-help">Loaded ' + esc(importedName) + ' · ' + candidates.length + ' matching verified returns</p>' : '') +
        '<form data-refund-prepare class="sf104-form"><div class="sf104-form-grid"><label>Verified return<select name="adjustment" required' + (!candidates.length ? ' disabled' : '') + '>' +
        '<option value="">Select a returned transfer</option>' + candidates.map(row => '<option value="' + esc(row.id) + '">' +
          esc(row.amountAtomic + ' atomic units · ' + row.id) + '</option>').join('') + '</select></label>' +
        '<label>Woo credit amount (' + esc(order.currency) + ')<input name="amount" required inputmode="decimal" autocomplete="off" placeholder="' +
        esc(order.remainingTotal) + '"></label></div><div data-refund-selection></div><button type="submit" class="sf104-button"' +
        (!candidates.length || busy ? ' disabled' : '') + '>Prepare order credit</button></form></section>' +
        '<section class="sf104-panel"><h3>Saved native refund mappings</h3>' + (records ?
          '<div class="sf104-table-scroll"><table class="sf104-data-table"><thead><tr><th>State / adjustment</th><th>Verified return</th><th>Woo credit</th><th>Refund / reason</th><th>Action</th></tr></thead><tbody>' +
          records + '</tbody></table></div>' : '<p>Prepared and completed credits for this order appear here.</p>') +
        '<div data-refund-detail></div></section><section class="sf104-panel"><h3>Current Woo refunds</h3>' + (woo ?
          '<div class="sf104-table-scroll"><table class="sf104-data-table"><thead><tr><th>Refund</th><th>Woo amount</th><th>Native adjustment</th><th>Reason</th></tr></thead><tbody>' +
          woo + '</tbody></table></div>' : '<p>This order has no Woo refund records.</p>') +
        '<button type="button" class="sf104-button" data-refund-export>Download current order refund snapshot</button></section>';
      if (lastReview) showReview(lastReview);
    }
    function showReview(id) {
      const row = snapshot.adjustments.find(item => item.adjustmentId === id);
      if (!row || !active()) return;
      lastReview = id;
      const node = container.querySelector('[data-refund-detail]');
      node.innerHTML = '<section class="sf104-refund-review"><h4>Review this order credit</h4><dl class="sf104-facts sf104-facts-single">' +
        fact('Woo order', '#' + orderId) + fact('Verified native return', row.amountAtomic + ' atomic units · ' + row.network) +
        fact('Woo credit', row.currency + ' ' + row.wooAmount) + fact('Return transaction', row.transactionHash) +
        fact('Adjustment', row.adjustmentId) + fact('Reason', row.reason) + fact('Current state', row.status) +
        fact('Original source export SHA-256', row.sourceSha256) + '</dl><p class="sf104-help">' +
        (row.wooAmount === snapshot.order.remainingTotal && row.status !== 'APPLIED' ?
          'This credit covers the remaining Woo total. The normal result is a Refunded order; download access follows the store’s order-status rules.' :
          'WooCommerce determines the resulting order status using its current refund rules. Item quantities and download records are retained.') + '</p>' +
        (row.status === 'APPLIED' ? '<p>Saved as Woo refund #' + esc(row.refundId) + '.</p>' :
        '<form data-refund-apply><label class="sf104-refund-confirm"><input type="checkbox" name="confirm" required> Record this reviewed amount as an order credit. WooCommerce’s normal refund status and notification hooks will run.</label>' +
          '<button type="submit" class="sf104-button sf104-primary"' + (busy ? ' disabled' : '') + '>' +
          (row.status === 'APPLYING' ? 'Recover this same order credit' : 'Record Woo order credit') + '</button></form>') + '</section>';
    }
    async function refresh() {
      assign(await request()); if (active()) render();
    }
    container.addEventListener('change', async event => {
      const input = event.target;
      if (busy) return;
      if (input.matches('[data-refund-import]')) {
        const file = input.files?.[0]; if (!file) return;
        try {
          need(file.size > 0 && file.size <= 16 * 1024 * 1024, 'Choose an adjustment export no larger than 16 MiB.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
          need(value.schema === 'stellar-forge.merchant-adjustment-export.v1' && Array.isArray(value.events),
            'Choose the original accounting adjustment export JSON.');
          const matching = value.events.filter(item => item.original?.eventId === snapshot.originalPayment.eventId);
          need(matching.length === 1 && Array.isArray(matching[0].adjustments), 'This export must contain exactly one record of this order’s original payment.');
          const found = [], invalid = [];
          for (const record of matching[0].adjustments) {
            if (record.kind !== 'REFUND' || record.status !== 'VERIFIED') continue;
            try { found.push(await validateCandidate(record, matching[0], snapshot, value)); }
            catch (error) { invalid.push(error.message); }
          }
          need(found.length > 0, invalid[0] || 'This order has no verified refund in the selected export.');
          need(new Set(found.map(row => row.id)).size === found.length, 'The export repeats an adjustment identity.');
          candidates = found; sourceSha256 = await hash(bytes); importedName = file.name; current = null;
          if (active()) { render(); message(found.length + ' matching verified returns loaded.' + (invalid.length ? ' ' + invalid.length + ' changed records could not be selected.' : '')); }
        } catch (error) { candidates = []; sourceSha256 = null; importedName = ''; render(); message(error.message, true); }
      } else if (input.matches('[name="adjustment"]')) {
        current = candidates.find(row => row.id === input.value) || null;
        const selected = container.querySelector('[data-refund-selection]');
        selected.innerHTML = current ? '<dl class="sf104-facts sf104-facts-single">' + fact('Native return', current.amountAtomic + ' atomic units') +
          fact('Reason', current.reason) + fact('Transaction', current.verification.transaction) + '</dl>' : '';
      }
    });
    container.addEventListener('click', async event => {
      const target = event.target.closest('button'); if (!target || busy) return;
      if (target.hasAttribute('data-refund-review')) showReview(target.dataset.refundReview);
      else if (target.hasAttribute('data-refund-export')) download(snapshot, 'woo-order-' + orderId + '-refunds.json');
      else if (target.hasAttribute('data-refund-refresh')) {
        try { await refresh(); message('Current Woo refund records loaded.'); } catch (error) { message(error.message, true); }
      }
    });
    container.addEventListener('submit', async event => {
      const form = event.target;
      if (!form.matches('[data-refund-prepare],[data-refund-apply]')) return;
      event.preventDefault(); if (busy) return;
      const prepare = form.matches('[data-refund-prepare]');
      try {
        busy = true; container.querySelectorAll('form button,[data-refund-import]').forEach(node => { node.disabled = true; });
        if (prepare) {
          const values = new FormData(form), id = values.get('adjustment'), amount = values.get('amount');
          const record = candidates.find(row => row.id === id);
          need(record && sourceSha256, 'Choose a verified return from the original export.');
          need(moneyValid(amount, snapshot.order.priceDecimals), 'Enter a positive amount using the store’s decimal scale.');
          const result = await request('/prepare', {schema:SCHEMA, adjustmentId:record.id, eventId:record.eventId,
            originalTransactionHash:snapshot.originalPayment.transactionHash, expectedIdentitySha256:snapshot.identitySha256,
            expectedRevision:snapshot.revision, sourceSha256, requestSha256:record.requestSha256,
            amountAtomic:record.amountAtomic, wooAmount:amount, currency:snapshot.order.currency,
            reason:record.reason, reviewedRefund:record.verification.proof, confirm:'PREPARE_THIS_REFUND'});
          assign(result.order); lastReview = record.id; render(); message('The mapping is saved. Review the exact credit below.');
        } else {
          const row = snapshot.adjustments.find(item => item.adjustmentId === lastReview);
          need(row && form.querySelector('[name="confirm"]').checked, 'Confirm this reviewed order credit.');
          const result = await request('/apply', {schema:SCHEMA, adjustmentId:row.adjustmentId, reviewSha256:row.reviewSha256,
            expectedRevision:snapshot.revision, confirm:'RECORD_THIS_REFUND'});
          assign(result.order); render(); message('Woo refund #' + result.adjustment.refundId + ' is recorded for this native return.');
        }
      } catch (error) {
        // Read the existing operation after a lost response. Another POST is an
        // explicit action on the saved mapping, with the same native refund ID.
        try { await refresh(); } catch {}
        message(error.message + ' Current retained rows show whether the request was saved.', true);
      } finally {
        busy = false;
        if (active()) {
          container.querySelectorAll('form button').forEach(node => { node.disabled = !!node.closest('[data-refund-prepare]') && !candidates.length; });
          container.querySelectorAll('[data-refund-import]').forEach(node => { node.disabled = false; });
        }
      }
    });
    container.innerHTML = '<section class="sf104-panel"><p role="status">Loading this order’s native refunds…</p></section>';
    try { await refresh(); } catch (error) { container.innerHTML = '<section class="sf104-panel"><h3>Order refunds</h3><p>' + esc(error.message) + '</p></section>'; }
  }
  window.SF104Refunds = Object.freeze({mount});
})();
