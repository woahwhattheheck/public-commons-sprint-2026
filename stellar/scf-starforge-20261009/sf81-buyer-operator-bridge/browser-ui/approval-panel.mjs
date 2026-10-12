// MIT. Shared presentation of SF62's exact native request and budget review.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const atomic = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const text = value => value === null || value === undefined ? '—' : String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const json = value => JSON.stringify(value, null, 2)?.replace(/[\u007f-\uffff]/g,
  character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) ?? '';
const node = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = text(value);
  if (className) element.className = className;
  return element;
};
const remainingLabels = [
  ['max_single', 'Single request'],
  ['max_total', 'Total budget'],
  ['max_per_utc_day', 'UTC day'],
  ['max_per_actor_utc_day', 'Operator / UTC day'],
  ['max_per_service_utc_day', 'Service / UTC day'],
];
function facts(list, entries) {
  list.replaceChildren();
  for (const [name, value] of entries)
    if (value !== undefined) list.append(node('dt', name), node('dd', value));
}
function date(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : '—';
}

/**
 * A host supplies the authenticated snapshot and action transport.
 * decide() receives only the displayed request identity and explicit decision.
 * refresh() reads the original operation; it never dispatches another purchase.
 * render(approval, {intentId, pending, fresh:true}) follows an authoritative
 * server read. Use fresh:false for local busy-state redraws so a disconnected
 * review stays disabled until the original operation is read successfully.
 * The approval is {id,intentId,state,createdAt,expiresAt,review,
 * current_native_budget_estimate}; review is SF62 operator-review.v1.
 */
export function createApprovalPanel({ host, decide, refresh }) {
  if (!host || typeof decide !== 'function' || typeof refresh !== 'function')
    throw new TypeError('Approval panel requires host, decide and refresh.');
  let current = null, selectedIntent = '', blocked = false, deciding = false;
  let connected = true, uncertain = false, documentIdentity = '', timer;
  host.classList.add('operator-approval');
  host.hidden = true;
  const heading = node('div', undefined, 'approval-heading');
  const title = node('h3', 'Approve this purchase');
  const status = node('span', 'Waiting for payment terms', 'approval-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  heading.append(title, status);
  const summary = node('p', undefined, 'approval-summary');
  const amount = node('strong', undefined, 'approval-amount');
  const amountUnit = node('span', 'atomic units', 'approval-unit');
  const amountLine = node('div', undefined, 'approval-amount-line');
  amountLine.append(amount, amountUnit);
  const request = node('p', undefined, 'approval-request');
  const reviewFacts = node('dl', undefined, 'approval-facts');
  const budgetHeading = node('h4', 'Budget at review');
  const budgetNote = node('p', undefined, 'approval-help');
  const tableWrap = node('div', undefined, 'approval-table-wrap');
  const table = node('table', undefined, 'approval-budget');
  const caption = node('caption', 'Native budget capacity in atomic units');
  const head = node('thead'), headRow = node('tr'), budgetRows = node('tbody');
  for (const label of ['Limit', 'Available at review']) {
    const cell = node('th', label); cell.scope = 'col'; headRow.append(cell);
  }
  head.append(headRow); table.append(caption, head, budgetRows); tableWrap.append(table);
  const terms = node('details'), termsSummary = node('summary', 'Complete payment terms');
  const originalTerms = node('pre'); originalTerms.tabIndex = 0;
  terms.open = true; terms.append(termsSummary, originalTerms);
  const identity = node('details'), identitySummary = node('summary', 'Request identity and native review');
  const identityFacts = node('dl', undefined, 'approval-facts'), nativeReview = node('pre');
  nativeReview.tabIndex = 0; identity.append(identitySummary, identityFacts, nativeReview);
  const timing = node('p', undefined, 'approval-help');
  const response = node('p', undefined, 'approval-feedback');
  response.setAttribute('role', 'status'); response.setAttribute('aria-live', 'polite');
  const actions = node('div', undefined, 'approval-actions');
  const approve = node('button', 'Approve purchase', 'approval-approve');
  const reject = node('button', 'Reject purchase');
  const refreshButton = node('button', 'Refresh approval');
  for (const button of [approve, reject, refreshButton]) button.type = 'button';
  actions.append(reject, approve, refreshButton);
  host.replaceChildren(heading, summary, amountLine, request, reviewFacts,
    budgetHeading, budgetNote, tableWrap, terms, identity, timing, response, actions);

  function validReview(value) {
    const review = value?.review, estimate = value?.current_native_budget_estimate;
    return object(value) && typeof value.id === 'string' && value.id.length > 0 &&
      value.intentId === selectedIntent && review?.request_id === selectedIntent &&
      review.schema === 'stellar-forge.sf62.operator-review.v1' &&
      digest(review.request_sha256) && digest(review.accepted_terms_sha256) &&
      atomic(review.max_atomic_units_to_reserve) &&
      object(review.complete_original_accepted_terms) && object(estimate) &&
      atomic(estimate.reserved_max_base_units) &&
      estimate.reserved_max_base_units === review.max_atomic_units_to_reserve &&
      typeof estimate.approved === 'boolean' && object(estimate.limit_remaining) &&
      remainingLabels.every(([key]) => atomic(estimate.limit_remaining[key])) &&
      ['method', 'resource', 'network', 'asset', 'pay_to', 'scheme', 'actor', 'service']
        .every(key => typeof review[key] === 'string' && review[key].length > 0) &&
      Number.isSafeInteger(review.max_timeout_seconds) && review.max_timeout_seconds > 0 &&
      typeof review.body_present === 'boolean' && Number.isSafeInteger(review.body_bytes) && review.body_bytes >= 0;
  }
  function expired() {
    const expires = Date.parse(current?.expiresAt);
    return !Number.isFinite(expires) || expires <= Date.now();
  }
  function controls() {
    clearTimeout(timer);
    const valid = validReview(current), awaiting = current?.state === 'AWAITING_OPERATOR';
    const isExpired = awaiting && expired();
    const locked = !valid || !connected || blocked || deciding || uncertain || !awaiting || isExpired;
    approve.disabled = locked || current?.current_native_budget_estimate?.approved !== true;
    reject.disabled = locked;
    refreshButton.disabled = blocked || deciding;
    refreshButton.hidden = connected && !uncertain && valid && !isExpired;
    host.setAttribute('aria-busy', String(deciding));
    const labels = { AWAITING_OPERATOR: 'Your approval required', APPROVING: 'Reserving amount', APPROVED: 'Reservation approved',
      REJECTED: 'Rejected', EXPIRED: 'Approval expired', FAILED: 'Approval stopped',
      CANCELLED: 'Request interrupted' };
    const label = deciding ? 'Recording decision…' : uncertain ? 'Checking decision' :
      !connected ? 'Connection interrupted' : !valid && awaiting ? 'Review unavailable' :
      isExpired ? 'Approval expired' : labels[current?.state] ?? text(current?.state);
    if (status.textContent !== label) status.textContent = label;
    if (isExpired) summary.textContent = 'The decision window ended. Refresh this original operation to read its recorded result.';
    if (awaiting && valid && !isExpired) {
      const seconds = Math.max(0, Math.ceil((Date.parse(current.expiresAt) - Date.now()) / 1000));
      timing.textContent = 'Decision window: ' + Math.floor(seconds / 60) + ':' +
        String(seconds % 60).padStart(2, '0') + ' remaining · expires ' + date(current.expiresAt);
      timer = setTimeout(controls, 1000);
    } else {
      timing.textContent = current?.createdAt ? 'Requested ' + date(current.createdAt) +
        (current.decidedAt ? ' · decision recorded ' + date(current.decidedAt) : '') : '';
    }
  }
  function render(value, { intentId = '', pending = false, fresh = false } = {}) {
    current = value ?? null; selectedIntent = intentId; blocked = pending;
    if (fresh) connected = true;
    host.hidden = !current;
    if (!current) { clearTimeout(timer); documentIdentity = ''; return; }
    const valid = validReview(current), review = current.review;
    const nextIdentity = valid ? json([current.id, review, current.current_native_budget_estimate]) : '';
    if (valid && nextIdentity !== documentIdentity) {
      documentIdentity = nextIdentity;
      terms.open = true; identity.open = false;
      amount.textContent = review.max_atomic_units_to_reserve;
      request.textContent = text(review.method) + ' ' + text(review.resource);
      facts(reviewFacts, [
        ['Network', review.network], ['Asset', review.asset], ['Recipient', review.pay_to],
        ['Payment scheme', review.scheme], ['Maximum timeout', text(review.max_timeout_seconds) + ' seconds'],
        ['Operator', review.actor], ['Service', review.service],
        ['Request body', review.body_present ? text(review.body_bytes) + ' bytes' : 'None'],
      ]);
      const estimate = current.current_native_budget_estimate;
      budgetRows.replaceChildren();
      for (const [key, label] of remainingLabels) {
        const available = estimate.limit_remaining?.[key], row = node('tr');
        const exceeded = estimate.denied_by?.includes(key);
        const title = node('th', label + (exceeded ? ' · exceeded' : '')); title.scope = 'row';
        row.append(title, node('td', available));
        if (exceeded) row.dataset.exceeded = 'true';
        budgetRows.append(row);
      }
      budgetNote.textContent = estimate.approved
        ? 'The native estimate covers this amount. Available capacity is checked again when your approval is recorded.'
        : 'This request exceeds ' + (estimate.denied_by ?? []).map(key =>
          remainingLabels.find(row => row[0] === key)?.[1] ?? key).join(', ') + '.';
      originalTerms.textContent = json(review.complete_original_accepted_terms);
      facts(identityFacts, [
        ['Operation', review.request_id], ['Request SHA-256', review.request_sha256],
        ['Accepted terms SHA-256', review.accepted_terms_sha256],
        ['Request body SHA-256', review.body_sha256], ['Approval', current.id],
      ]);
      nativeReview.textContent = json({ review, current_native_budget_estimate: estimate });
    }
    for (const element of [amountLine, request, reviewFacts, budgetHeading, budgetNote, tableWrap, terms, identity])
      element.hidden = !valid;
    summary.textContent = !valid ? current.state === 'AWAITING_OPERATOR'
      ? 'Refresh this operation to load its complete native payment review.'
      : 'This approval has ended. Read the original operation below for its recorded result.' :
      current.state === 'AWAITING_OPERATOR'
        ? 'Review the exact merchant request and accepted payment terms. Approve purchase reserves the displayed amount and continues this operation with your configured signer.'
        : current.state === 'APPROVING'
          ? 'Your approval was received. The operator is reserving this exact amount under the current spending limits.'
          : current.state === 'APPROVED'
          ? 'The native reservation is approved for this exact request. Follow the original operation below for payment and delivery progress.'
          : current.state === 'REJECTED'
            ? 'You rejected this payment request. The original operation records the result.'
            : current.state === 'EXPIRED'
              ? 'The decision window ended. Read the original operation result before preparing another request.'
              : 'The original operation retains its progress and result.';
    if (!deciding) {
      if (fresh) uncertain = false;
      response.textContent = current.error ? text(current.error.message ?? current.error.code ?? current.error) : '';
    }
    controls();
  }
  async function decision(value) {
    controls();
    if ((value === 'approve' ? approve : reject).disabled) return;
    const binding = { intent: selectedIntent, approvalId: current.id,
      requestSha256: current.review.request_sha256, decision: value };
    const originalId = current.id;
    deciding = true; response.textContent = ''; controls();
    try {
      await decide(binding);
    } catch (error) {
      if (current?.id === originalId) {
        uncertain = true;
        response.textContent = text(error?.message ?? 'The decision response was interrupted.') +
          ' Refresh this original operation to read its recorded state.';
      }
    } finally {
      deciding = false;
      controls();
      try { await refresh(); } catch { disconnect(); }
    }
  }
  function disconnect() {
    connected = false;
    if (current) response.textContent = 'Reconnect and refresh this original operation to recover its current approval and result.';
    controls();
  }
  function reset() {
    clearTimeout(timer); current = null; selectedIntent = ''; documentIdentity = '';
    uncertain = false; host.hidden = true; approve.disabled = true; reject.disabled = true;
  }
  approve.addEventListener('click', () => void decision('approve'));
  reject.addEventListener('click', () => void decision('reject'));
  refreshButton.addEventListener('click', () => void Promise.resolve().then(refresh).catch(disconnect));
  return { render, reset, disconnect, dispose: () => { reset(); host.replaceChildren(); } };
}

