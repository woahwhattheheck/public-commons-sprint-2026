// MIT. Local provider desk; all payment controls link to the original merchant.
const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2) + '\n';
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('blockscout-operator-token', token);
else token = sessionStorage.getItem('blockscout-operator-token') ?? '';
history.replaceState(null, '', location.pathname);
let status, prepared, selected, backup, nextAfter = null, filter = {}, loading = false;
let formRevision = 0, selectionEpoch = 0, historyEpoch = 0;
const reconciliationDrafts = new Map();
const names = { BLOCKSCOUT_LOCAL_DAILY_BUDGET: 'Local daily budget reached', BLOCKSCOUT_LOCAL_RATE_LIMIT: 'Local rate limit active',
  BLOCKSCOUT_PROVIDER_CREDITS_LOW: 'Recent provider balance is below the configured floor', BLOCKSCOUT_PROVIDER_RATE_LIMIT: 'Provider rate window is exhausted',
  BLOCKSCOUT_RETAINED_CAPACITY_FULL: 'Retained storage limit reached', BLOCKSCOUT_PROVIDER_IN_FLIGHT_LIMIT: 'Provider request capacity is in use' };
function message(text = '') { $('message').textContent = text; }
async function request(path, value, binary = false) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
    headers: { 'x-blockscout-operator-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const failure = Error(data.error === 'BLOCKSCOUT_OPERATOR_TOKEN_REQUIRED' ? 'Open the current private provider-desk URL printed by the merchant launcher.' :
      data.error === 'BLOCKSCOUT_RECONCILIATION_REVISION_CHANGED' ? 'The saved decision changed. Compare its current history before choosing a revision.' :
      names[data.error] ?? data.error ?? 'Request failed (' + response.status + ')');
    failure.code = data.error; failure.status = response.status; throw failure;
  }
  return binary ? response : response.json();
}
async function action(button, fn) {
  button.disabled = true; message();
  try { await fn(); } catch (e) { message(e.message); } finally { button.disabled = false; }
}
function download(bytes, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function cell(tr, text, small) {
  const td = document.createElement('td'); td.textContent = text;
  if (small !== undefined) { const detail = document.createElement('small'); detail.textContent = small; td.append(detail); }
  tr.append(td); return td;
}
function number(value) { return value === null || value === undefined ? 'Unknown' : value.toLocaleString(); }
function showStatus(value) {
  status = value; const p = value.provider, l = p.limits, q = p.providerQuota;
  const unit = p.budgetUnit ?? 'credits', instance = unit === 'requests';
  const mode = value.deployment?.mode === 'challenge-only' ? 'Challenge-only' :
    value.deployment?.mode === 'paid' ? 'Paid service' : 'Merchant';
  const credential = value.providerCredential?.state === 'MISSING' ? ' · provider credential pending' : '';
  $('identity').textContent = p.accountAlias + ' · ' + (value.source === 'loopback-contract-fixture' ? 'Loopback contract fixture' : value.connection?.providerName ?? 'Blockscout PRO') + ' · ' + mode + ' · ' + value.paymentNetwork + credential;
  $('history-budget-label').textContent = instance ? 'Local requests' : 'Local credits';
  $('budget-explanation').textContent = 'Local budgets count provider attempts in ' + unit + '. Provider balances are timestamped observations of the shared account. The original merchant journal records payment settlement.';
  $('admission').textContent = p.admission.allowed ? 'Available for a selected read' : names[p.admission.code] ?? p.admission.code;
  $('local-usage').textContent = number(p.localUsage.attempts) + ' / ' + number(l.dayAttempts) + ' attempts';
  $('local-detail').textContent = p.day + ' UTC · ' + number(p.localUsage.configuredCredits) + ' / ' + number(l.dayCredits) +
    ' configured ' + unit + ' · ' + number(l.creditsPerAttempt) + ' per attempt';
  $('provider-credits').textContent = q ? (instance ? number(q.rateRemaining) + ' rate-window requests remaining' : number(q.creditsRemaining) + ' credits remaining') : 'No provider observation';
  $('provider-rate').textContent = q ? number(q.rateRemaining) + ' / ' + number(q.rateLimit) + ' rate-window requests · reported reset ' + number(q.resetMs) + ' ms' : 'A provider response supplies the account headers.';
  if (p.quotaEstimates?.requests) $('provider-rate').textContent += ' · local conservative availability ' + number(p.quotaEstimates.requests.available) + ' requests after ' + number(p.quotaEstimates.requests.reserved) + ' reserved requests';
  $('provider-age').textContent = q ? q.observedAt + ' · ' + (q.fresh ? 'Within the configured observation window' : 'Observation is older than the configured window') : '';
  if (!instance && p.quotaEstimates?.credits) $('provider-age').textContent += ' · local conservative availability ' + number(p.quotaEstimates.credits.available) + ' credits after ' + number(p.quotaEstimates.credits.reserved) + ' reserved credits';
  $('retention').textContent = number(p.retention.records) + ' attempts';
  $('retention-detail').textContent = number(p.retention.bodyBytes) + ' / ' + number(l.maxStoredBodyBytes) + ' response bytes · ' +
    number(p.retention.inProgress) + ' in progress · ' + number(p.states.outcome_unknown ?? 0) + ' interrupted outcomes';
  const reconciliation = p.reconciliation;
  $('reconciliation-count').textContent = reconciliation ? number(reconciliation.unresolved) + ' unresolved reservations · ' +
    number(reconciliation.resolved) + ' with recorded completion · ' + number(reconciliation.decisions) + ' retained decisions' : '';
  if (q?.observationId) $('provider-age').textContent += ' · observation ' + q.observationId + ' · request started ' + q.startedAt;
  if (selected) paintReconciliationControls();
  $('payment').textContent = 'Payment asset and recipient come from the original offer. Chain IDs in these routes identify EVM data.';
  $('footer').textContent = value.contract + ' · plan SHA-256 ' + p.planSha256 + ' · updated ' + p.capturedAt;
  if (!$('chain').options.length) {
    for (const chain of value.chains) {
      for (const id of ['chain', 'filter-chain']) { const option = document.createElement('option'); option.value = chain.chainId;
        option.textContent = chain.name + ' (' + chain.chainId + ')'; $(id).append(option); }
      const tr = document.createElement('tr'); cell(tr, chain.name, chain.dataNetwork);
      cell(tr, '/' + chain.chainId + '/api/v2/tokens/{address_hash}'); cell(tr, chain.amountAtomic + ' atomic units', value.paymentNetwork);
      $('routes').append(tr);
    }
  }
}
async function refresh() {
  if (loading) return; loading = true;
  try { showStatus(await request('/api/status')); } finally { loading = false; }
}
function showSelection(value) {
  selected = value;
  $('selected').hidden = false; $('response-json').hidden = true;
  $('selection-summary').textContent = '#' + value.sequence + ' · ' + value.state + ' · eip155:' + value.chainId + ' · ' + value.addressHash;
  $('selection-json').textContent = json(value);
  $('download-response').disabled = !value.response?.retained; $('show-response').disabled = !value.response?.retained;
  renderReconciliation();
}
async function select(id) {
  const epoch = ++selectionEpoch, value = await request('/api/attempts/' + id);
  if (epoch !== selectionEpoch) return;
  const draft = reconciliationDrafts.get(id);
  if (draft?.pending && !draft.busy) reconcileReadback(value, draft, true);
  showSelection(value);
}
async function loadHistory(reset = false) {
  if (reset) { historyEpoch++; selectionEpoch++; $('attempts').replaceChildren(); nextAfter = 0; selected = null; $('selected').hidden = true; }
  const epoch = historyEpoch;
  const query = new URLSearchParams({ after: String(nextAfter ?? 0), limit: '50', ...filter });
  const page = await request('/api/attempts?' + query);
  if (epoch !== historyEpoch) return;
  $('history-total').textContent = number(page.total) + ' matching attempts';
  for (const row of page.rows) {
    const tr = document.createElement('tr'), td = cell(tr, '', row.startedAt);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'row-button'; button.textContent = '#' + row.sequence;
    button.addEventListener('click', () => action(button, () => select(row.id))); td.prepend(button);
    cell(tr, 'eip155:' + row.chainId, row.addressHash);
    cell(tr, row.state, 'HTTP ' + (row.upstreamStatus ?? 'unknown') + (row.error ? ' · ' + row.error : ''));
    cell(tr, String(row.localCredits)); cell(tr, row.response ? number(row.response.bytes) + ' bytes' : 'No retained body', row.purpose);
    $('attempts').append(tr);
  }
  nextAfter = page.nextAfter; $('more').hidden = nextAfter === null;
}

function latestRevision(record) {
  const value = record.reconciliation?.revision ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) throw Error('The saved reconciliation revision is invalid.');
  return value;
}
function newReconciliationDraft(record, operator = '') {
  return { expectedRevision: latestRevision(record), action: 'confirm_finished', operator, reference: '',
    observationId: '', providerFinishedAt: '', observation: null, pending: null, busy: false, feedback: '' };
}
function reconciliationDraft(record = selected) {
  if (!record) return null;
  if (!reconciliationDrafts.has(record.id)) reconciliationDrafts.set(record.id, newReconciliationDraft(record));
  return reconciliationDrafts.get(record.id);
}
function savedDecision(record, payload) {
  if (record.id !== payload.attemptId) return null;
  return (record.reconciliations ?? []).find(row => row.revision === payload.expectedRevision + 1 &&
    row.action === payload.action && row.operator === payload.operator && row.reference === payload.reference &&
    (payload.action === 'reopen' || row.observationId === payload.observationId &&
      row.providerFinishedAt === payload.providerFinishedAt)) ?? null;
}
function reconcileReadback(record, draft, allowUnrecorded = false) {
  if (!draft.pending) return false;
  if (record.id !== draft.pending.attemptId) throw Error('The returned history belongs to a different provider attempt.');
  const decision = savedDecision(record, draft.pending);
  if (decision) {
    const next = newReconciliationDraft(record, draft.operator);
    next.feedback = 'Decision revision ' + decision.revision + ' is retained in the original attempt history.';
    reconciliationDrafts.set(record.id, next);
    return true;
  }
  if (latestRevision(record) > draft.pending.expectedRevision || allowUnrecorded) {
    draft.pending = null;
    draft.feedback = latestRevision(record) !== draft.expectedRevision ?
      'A different decision is retained. Compare the history, then use the latest reviewed revision to continue with this draft.' :
      'No matching new decision is retained. The original request and reviewed revision remain in this form for inspection and an explicit submission.';
  }
  return false;
}
function paintObservation(draft) {
  const row = draft.observation;
  $('observation-details').hidden = !row;
  if (!row) return;
  $('observation-summary').textContent = '#' + row.sequence + ' · request started ' + row.startedAt +
    ' · response finished ' + row.finishedAt + ' · ' + number(row.quota?.creditsRemaining) + ' reported credits · ' +
    number(row.quota?.rateRemaining) + ' reported rate-window requests' +
    (row.response?.sha256 ? ' · response SHA-256 ' + row.response.sha256 : '');
  $('observation-json').textContent = json(row);
}
function paintReconciliationControls() {
  if (!selected || $('reconciliation').hidden) return;
  const draft = reconciliationDraft(), stale = draft.expectedRevision !== latestRevision(selected);
  const confirm = draft.action === 'confirm_finished';
  $('reconciliation-fields').disabled = draft.busy || Boolean(draft.pending) || selected.state !== 'outcome_unknown';
  $('reconciliation-submit').disabled = draft.busy || Boolean(draft.pending) || stale ||
    selected.state !== 'outcome_unknown' || confirm && draft.observation?.id !== draft.observationId;
  $('reconciliation-submit').textContent = confirm ? 'Record provider completion' : 'Restore reservation';
  $('completion-fields').hidden = !confirm;
  $('reconciliation-observation').required = confirm; $('reconciliation-finished').required = confirm;
  $('latest-observation').disabled = !status?.provider?.providerQuota?.observationId || draft.busy || Boolean(draft.pending);
  $('reload-attempt').disabled = draft.busy;
  $('use-latest-revision').hidden = !stale || Boolean(draft.pending);
  $('use-latest-revision').disabled = draft.busy;
  $('reconciliation-version').textContent = 'Reviewed revision ' + draft.expectedRevision + ' · current revision ' + latestRevision(selected);
  $('reconciliation-feedback').textContent = draft.feedback || (stale ?
    'The saved decision changed. Your draft still uses its original reviewed revision; compare the history before continuing.' : '');
}
function renderReconciliation() {
  const history = selected.reconciliations ?? [];
  $('reconciliation').hidden = selected.state !== 'outcome_unknown' && history.length === 0;
  if ($('reconciliation').hidden) return;
  const draft = reconciliationDraft(), last = selected.reconciliation;
  $('reconciliation-summary').textContent = last?.action === 'confirm_finished' ?
    'Provider completion is recorded at ' + last.providerFinishedAt + '. Reservation accounting uses that decision with later quota observations.' :
    'This interrupted request retains its possible provider charge. Review the provider account record before recording completion.';
  for (const [id, key] of [['reconciliation-action', 'action'], ['reconciliation-operator', 'operator'],
    ['reconciliation-reference', 'reference'], ['reconciliation-observation', 'observationId'],
    ['reconciliation-finished', 'providerFinishedAt']]) $(id).value = draft[key];
  $('reconciliation-history').replaceChildren(); $('reconciliation-empty').hidden = history.length > 0;
  for (const row of [...history].sort((a, b) => a.revision - b.revision)) {
    const tr = document.createElement('tr');
    cell(tr, String(row.revision), row.recordedAt);
    cell(tr, row.action === 'confirm_finished' ? 'Provider completion' : 'Reservation restored', row.operator);
    cell(tr, row.reference);
    cell(tr, row.providerFinishedAt ?? 'Reservation restored', row.observationId ?? 'Earlier confirmation remains in this history');
    $('reconciliation-history').append(tr);
  }
  paintObservation(draft); paintReconciliationControls();
}
function captureReconciliationDraft() {
  const draft = reconciliationDraft();
  if (!draft || draft.busy || draft.pending) return draft;
  const observationId = $('reconciliation-observation').value.trim();
  if (observationId !== draft.observationId) draft.observation = null;
  draft.action = $('reconciliation-action').value;
  draft.operator = $('reconciliation-operator').value;
  draft.reference = $('reconciliation-reference').value;
  draft.observationId = observationId;
  draft.providerFinishedAt = $('reconciliation-finished').value.trim();
  draft.feedback = '';
  paintObservation(draft); paintReconciliationControls(); return draft;
}
async function inspectObservation(id, draft, attemptId) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Enter the ID of a saved provider quota observation.');
  const row = await request('/api/attempts/' + id);
  if (row.id !== id || row.dispatched !== true || !row.quota || !Object.keys(row.quota.raw ?? {}).length || !row.finishedAt)
    throw Error('Select a saved dispatched provider response with quota headers.');
  if (reconciliationDrafts.get(attemptId) !== draft || draft.observationId !== id) return;
  draft.observation = row;
  if (selected?.id === attemptId) { paintObservation(draft); paintReconciliationControls(); }
}
function reconciliationPayload(record, draft) {
  if (record.state !== 'outcome_unknown') throw Error('Select an interrupted provider attempt.');
  if (draft.pending || draft.busy) throw Error('Reload the saved decision before submitting another action.');
  if (draft.expectedRevision !== latestRevision(record)) throw Error('Compare the current history and use the latest reviewed revision first.');
  const operator = draft.operator.normalize('NFC').trim(), reference = draft.reference.normalize('NFC').trim();
  if (!operator || operator.length > 160 || /[\u0000-\u001f\u007f]/.test(operator)) throw Error('Enter the operator name, up to 160 characters.');
  if (!reference || reference.length > 240 || /[\u0000-\u001f\u007f]/.test(reference)) throw Error('Enter the provider account record or correction reference, up to 240 characters.');
  const payload = { attemptId: record.id, expectedRevision: draft.expectedRevision, action: draft.action, operator, reference };
  if (draft.action === 'confirm_finished') {
    const value = draft.providerFinishedAt, observation = draft.observation;
    if (!observation || observation.id !== draft.observationId) throw Error('Inspect the selected saved quota observation first.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
      throw Error('Copy the exact UTC provider completion time, including milliseconds and Z.');
    const finished = Date.parse(value), started = Date.parse(record.startedAt), observed = Date.parse(observation.startedAt);
    if (!Number.isFinite(started) || !Number.isFinite(observed) || finished < started || finished >= observed)
      throw Error('Provider completion must be at or after this attempt started and strictly before the observation request started.');
    payload.observationId = observation.id; payload.providerFinishedAt = value;
  } else if (draft.action !== 'reopen') throw Error('Choose one of the displayed reconciliation decisions.');
  return payload;
}
async function submitReconciliation() {
  const record = selected, draft = captureReconciliationDraft(), epoch = selectionEpoch;
  if (!record || !draft) return;
  let payload;
  try { payload = reconciliationPayload(record, draft); }
  catch (e) { draft.feedback = e.message; paintReconciliationControls(); return; }
  draft.pending = payload; draft.busy = true; draft.feedback = 'Saving the selected decision to the original attempt history.';
  paintReconciliationControls();
  let failure, latest, readFailure, matched = false;
  try {
    try { await request('/api/reconciliation', payload); } catch (e) { failure = e; }
    try { latest = await request('/api/attempts/' + record.id); } catch (e) { readFailure = e; }
    if (latest) {
      matched = reconcileReadback(latest, draft, true);
      if (!matched && failure) draft.feedback = failure.message + ' ' + draft.feedback;
      if (!matched && !failure) draft.feedback = 'The returned history does not contain the selected decision. Inspect it before submitting another action.';
      if (epoch === selectionEpoch && selected?.id === record.id) showSelection(latest);
    } else {
      if (failure && [400, 401, 403, 404, 413, 422].includes(failure.status)) draft.pending = null;
      draft.feedback = draft.pending ?
        'The save acknowledgement could not be verified. Reload the saved decision to reconcile this exact request before editing or submitting again.' :
        failure?.message ?? readFailure?.message ?? 'The saved attempt could not be loaded.';
    }
  } finally {
    draft.busy = false;
    if (selected?.id === record.id) renderReconciliation();
  }
  if (matched) {
    message('The decision and its source reference are retained in the original provider attempt.');
    await refresh().catch(e => message('The decision is retained. Capacity refresh: ' + e.message));
  }
}
$('reconciliation-form').addEventListener('input', captureReconciliationDraft);
$('reconciliation-form').addEventListener('change', captureReconciliationDraft);
$('reconciliation-form').addEventListener('submit', event => { event.preventDefault(); submitReconciliation().catch(e => message(e.message)); });
$('inspect-observation').addEventListener('click', () => action($('inspect-observation'), async () => {
  const record = selected, draft = captureReconciliationDraft(); if (!record || !draft) return;
  await inspectObservation(draft.observationId, draft, record.id);
}));
$('latest-observation').addEventListener('click', () => action($('latest-observation'), async () => {
  const record = selected, draft = captureReconciliationDraft(), id = status?.provider?.providerQuota?.observationId;
  if (!record || !draft || !id) throw Error('Refresh the provider capacity to inspect a saved quota observation.');
  draft.observationId = id; draft.observation = null;
  $('reconciliation-observation').value = id;
  await inspectObservation(id, draft, record.id);
}));
$('reload-attempt').addEventListener('click', async () => {
  const record = selected, draft = reconciliationDraft(), epoch = selectionEpoch;
  if (!record || !draft || draft.busy) return;
  draft.busy = true; paintReconciliationControls();
  try {
    const latest = await request('/api/attempts/' + record.id);
    reconcileReadback(latest, draft, true);
    if (epoch === selectionEpoch && selected?.id === record.id) showSelection(latest);
  } catch (e) { draft.feedback = e.message; }
  finally { draft.busy = false; if (selected?.id === record.id) renderReconciliation(); }
});
$('use-latest-revision').addEventListener('click', () => {
  const draft = reconciliationDraft();
  if (!selected || !draft || draft.pending || draft.busy) return;
  draft.expectedRevision = latestRevision(selected);
  draft.feedback = 'The draft now uses reviewed revision ' + draft.expectedRevision + '. Its account reference and selected completion remain for your review.';
  renderReconciliation();
});


const PRO_PROVIDER_ORIGIN = 'https://api.blockscout.com';
const PRO_PROVIDER_SOURCE = 'https://docs.blockscout.com/api-reference/tokens/retrieve-detailed-information-about-a-specific-token';
let connectionSource, connectionReview, displayedConnectionReview, connectionChanges, connectionPackage;
let connectionRevision = 0, connectionSourceEpoch = 0, connectionHistoryEpoch = 0, connectionNext = '', connectionBusy = false;
function changedConnection() {
  connectionRevision++; connectionReview = null; displayedConnectionReview = null; connectionChanges = null;
  $('connection-review').hidden = true; $('connection-prepared').hidden = true;
}
function connectionMode() {
  const instance = $('connection-mode').value === 'instance', anonymous = $('connection-auth').value === 'none';
  $('connection-origin').readOnly = !instance; $('connection-auth').disabled = !instance;
  $('connection-chain-field').hidden = !instance; $('connection-chain').required = instance;
  $('connection-pro-limits').hidden = instance;
  for (const id of ['connection-day-credits', 'connection-credit-cost', 'connection-credit-floor']) $(id).disabled = instance;
  $('connection-env').disabled = anonymous; $('connection-env').required = !anonymous;
  $('connection-budget-help').textContent = instance
    ? 'Instance usage counts one local request per attempt. Its daily request ceiling, rate and concurrency apply to the selected instance account.'
    : 'PRO usage counts the configured credit cost for each provider attempt. Review the endpoint tariff and shared account allowance before choosing these ceilings.';
}
async function loadConnection() {
  if (connectionBusy) return;
  const epoch = ++connectionSourceEpoch; changedConnection();
  const revision = connectionRevision; $('connection-fields').disabled = true;
  try {
  const result = await request('/api/connection');
  if (epoch !== connectionSourceEpoch || revision !== connectionRevision) return;
  connectionSource = result; changedConnection();
  const c = result.connection, p = result.plan;
  $('connection-current').textContent = c.providerName + ' · ' + c.origin + ' · account ' + p.accountAlias +
    (c.reviewedAt ? ' · contract reviewed ' + c.reviewedAt : ' · existing PRO plan; enter the time of this connection review');
  for (const [id, value] of [
    ['connection-mode', c.mode], ['connection-account', p.accountAlias], ['connection-name', c.providerName],
    ['connection-origin', c.origin], ['connection-auth', c.authentication.kind], ['connection-env', p.apiKeyEnv],
    ['connection-source', c.sourceUrl], ['connection-reviewed-at', c.reviewedAt ?? ''],
    ['connection-day-attempts', p.limits.dayAttempts], ['connection-per-second', p.limits.perSecond],
    ['connection-in-flight', p.limits.maxInFlight], ['connection-day-credits', p.limits.dayCredits],
    ['connection-credit-cost', p.limits.creditsPerAttempt], ['connection-credit-floor', p.limits.minProviderCredits]
  ]) $(id).value = String(value);
  $('connection-chain').replaceChildren();
  for (const chain of p.chains) {
    const option = document.createElement('option'); option.value = chain.chainId;
    option.textContent = chain.name + ' (' + chain.chainId + ')'; $('connection-chain').append(option);
  }
  if (c.chainId) $('connection-chain').value = c.chainId;
  $('connection-fields').disabled = false; connectionMode();
  } finally {
    if (epoch === connectionSourceEpoch) { $('connection-fields').disabled = !connectionSource; connectionMode(); }
  }
}
function selectedConnectionChanges() {
  const instance = $('connection-mode').value === 'instance', kind = $('connection-auth').value;
  const dayAttempts = Number($('connection-day-attempts').value);
  return {
    connection: {
      schema: 'stellar-forge.blockscout-connection.v1',
      mode: instance ? 'instance' : 'pro', origin: $('connection-origin').value.trim(),
      ...(instance ? { chainId: $('connection-chain').value } : {}),
      authentication: { kind, ...(kind === 'api-key-header' ? { header: 'x-api-key' } : {}) },
      providerName: $('connection-name').value.trim(), sourceUrl: $('connection-source').value.trim(),
      reviewedAt: $('connection-reviewed-at').value.trim()
    },
    accountAlias: $('connection-account').value.trim(),
    apiKeyEnv: kind === 'none' ? connectionSource.plan.apiKeyEnv : $('connection-env').value.trim(),
    limits: { dayAttempts, perSecond: Number($('connection-per-second').value),
      maxInFlight: Number($('connection-in-flight').value),
      dayCredits: instance ? dayAttempts : Number($('connection-day-credits').value),
      creditsPerAttempt: instance ? 1 : Number($('connection-credit-cost').value),
      minProviderCredits: instance ? 0 : Number($('connection-credit-floor').value) }
  };
}
function connectionValue(td, value) {
  if (value && typeof value === 'object') {
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(value, null, 2); td.append(pre);
  } else td.textContent = value === null ? 'None' : String(value);
}
function showConnectionReview(value, retained = false) {
  displayedConnectionReview = value;
  $('connection-review').hidden = false;
  $('connection-review-summary').textContent = value.connection.providerName + ' · ' + value.connection.origin +
    ' · account ' + value.plan.accountAlias + ' · ' + value.plan.chains.length + ' data chain(s)';
  $('connection-state-plan').textContent = value.requiresNewMerchantState
    ? 'Start this provider account in a new private merchant state directory. The reviewed package retains the selected Stellar payment terms.'
    : 'After draining the original merchant, select this package with the same private merchant state. Its provider usage and retained responses continue under the same account.';
  $('connection-changes').replaceChildren();
  for (const row of value.changes) {
    const tr = document.createElement('tr'); cell(tr, row.name);
    connectionValue(cell(tr, ''), row.before); connectionValue(cell(tr, ''), row.after); $('connection-changes').append(tr);
  }
  if (!value.changes.length) {
    const tr = document.createElement('tr'); cell(tr, 'Same reviewed settings'); cell(tr, 'Current plan'); cell(tr, 'Current plan');
    $('connection-changes').append(tr);
  }
  $('connection-routes').replaceChildren();
  for (const row of value.connection.routes) {
    const tr = document.createElement('tr'); cell(tr, row.name, row.chainId);
    cell(tr, row.providerTemplate); cell(tr, row.merchantTemplate); $('connection-routes').append(tr);
  }
  $('connection-review-json').textContent = json(value);
  $('prepare-connection').hidden = retained; $('prepare-connection').disabled = retained;
}
function showConnectionPackage(value, cached) {
  connectionPackage = { ...value, ...(cached ? { cached } : {}) };
  $('connection-prepared').hidden = false;
  $('connection-prepared-summary').textContent = value.connection.providerName + ' · account ' + value.connection.accountAlias +
    ' · ' + number(value.bundle.bytes) + ' bytes · ' + value.status;
  const { cached: omitted, ...summary } = connectionPackage;
  $('connection-prepared-json').textContent = json(summary);
}
async function readConnectionPackage(id, expected) {
  const response = await request('/api/connection/packages/' + id, undefined, true);
  const bytes = await response.arrayBuffer(), advertised = response.headers.get('x-content-sha256');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (!/^[a-f0-9]{64}$/.test(advertised ?? '') || actual !== advertised ||
      expected && (actual !== expected.sha256 || bytes.byteLength !== expected.bytes)) throw Error('The saved package bytes changed.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value.schema !== 'stellar-forge.blockscout-connection-package.v1' || value.review?.reviewSha256 !== id)
    throw Error('The saved package belongs to a different connection review.');
  return { bytes, value, sha256: actual };
}
async function openConnectionPackage(id, expected) {
  if (connectionBusy) return;
  changedConnection(); const revision = connectionRevision;
  const saved = await readConnectionPackage(id, expected);
  if (revision !== connectionRevision) return;
  connectionReview = null; connectionChanges = null;
  showConnectionReview(saved.value.review, true);
  showConnectionPackage({ status: 'SAVED_PACKAGE_REOPENED', id, planSha256: saved.value.review.planSha256,
    connection: saved.value.review.connection,
    bundle: { bytes: saved.bytes.byteLength, sha256: saved.sha256, download: '/api/connection/packages/' + id } }, saved.bytes);
  message('The complete saved deployment and its reviewed plan are open.');
}
async function loadConnections(reset = false) {
  if (reset) { connectionHistoryEpoch++; connectionNext = ''; $('connection-packages').replaceChildren(); }
  const epoch = connectionHistoryEpoch, query = new URLSearchParams({ limit: '20' });
  if (connectionNext) query.set('after', connectionNext);
  const page = await request('/api/connection/history?' + query);
  if (epoch !== connectionHistoryEpoch) return;
  for (const row of page.items) {
    const tr = document.createElement('tr'); cell(tr, row.createdAt);
    cell(tr, row.connection.accountAlias, row.connection.providerName); cell(tr, row.connection.mode, row.connection.origin);
    const td = cell(tr, '', number(row.bytes) + ' bytes'), button = document.createElement('button');
    button.type = 'button'; button.className = 'row-button'; button.textContent = 'Open saved package';
    button.addEventListener('click', () => action(button, () => openConnectionPackage(row.id, row)));
    td.prepend(button); $('connection-packages').append(tr);
  }
  connectionNext = page.nextAfter; $('more-connections').hidden = connectionNext === null;
  $('connection-history-empty').textContent = $('connection-packages').children.length ? '' : 'Prepared deployment packages will appear here.';
}
$('connection-form').addEventListener('input', changedConnection);
$('connection-form').addEventListener('change', event => {
  changedConnection();
  if (event.target.id === 'connection-mode') {
    if ($('connection-mode').value === 'pro') {
      $('connection-origin').value = PRO_PROVIDER_ORIGIN; $('connection-name').value = 'Blockscout PRO';
      $('connection-source').value = PRO_PROVIDER_SOURCE; $('connection-auth').value = 'bearer';
      if (connectionSource?.connection.mode === 'instance') {
        $('connection-credit-cost').value = '20'; $('connection-credit-floor').value = '20';
        $('connection-day-credits').value = String(Number($('connection-day-attempts').value) * 20);
      }
    } else {
      if ($('connection-origin').value === PRO_PROVIDER_ORIGIN) $('connection-origin').value = '';
      if ($('connection-name').value === 'Blockscout PRO') $('connection-name').value = '';
      if ($('connection-source').value === PRO_PROVIDER_SOURCE) $('connection-source').value = '';
    }
    $('connection-reviewed-at').value = '';
  }
  connectionMode();
});
$('connection-review-time').addEventListener('click', () => {
  changedConnection(); $('connection-reviewed-at').value = new Date().toISOString();
});
$('reload-connection').addEventListener('click', () => {
  if (!connectionBusy) action($('reload-connection'), loadConnection);
});
$('connection-form').addEventListener('submit', event => {
  event.preventDefault();
  action(event.submitter, async () => {
    if (!connectionSource) return;
    const revision = connectionRevision, changes = selectedConnectionChanges();
    const value = await request('/api/connection/review', { sourcePlanSha256: connectionSource.planSha256, changes });
    if (revision !== connectionRevision) return;
    connectionReview = value; connectionChanges = changes; showConnectionReview(value);
    message('Review the resolved provider routes, account, limits and deployment state before preparing this package.');
  });
});
$('prepare-connection').addEventListener('click', () => action($('prepare-connection'), async () => {
  const reviewed = connectionReview, changes = connectionChanges;
  if (!reviewed || !changes || connectionBusy) return;
  connectionBusy = true; $('connection-fields').disabled = true;
  try {
    let result;
    try {
      result = await request('/api/connection/prepare', { sourcePlanSha256: reviewed.sourcePlanSha256,
        changes, reviewSha256: reviewed.reviewSha256 });
    } catch (original) {
      try { connectionBusy = false; await openConnectionPackage(reviewed.reviewSha256); await loadConnections(true); return; }
      catch { throw original; }
    }
    showConnectionPackage(result); await loadConnections(true);
    message('The complete deployment package is saved and ready to receive on the selected installation.');
  } finally { connectionBusy = false; $('connection-fields').disabled = false; connectionMode(); }
}));
$('download-connection-review').addEventListener('click', () => {
  if (displayedConnectionReview) download(json(displayedConnectionReview), 'blockscout-connection-review-' + displayedConnectionReview.reviewSha256 + '.json');
});
$('download-connection-package').addEventListener('click', () => action($('download-connection-package'), async () => {
  const selectedPackage = connectionPackage; if (!selectedPackage) return;
  const bytes = selectedPackage.cached ?? (await readConnectionPackage(selectedPackage.id, selectedPackage.bundle)).bytes;
  download(bytes, 'blockscout-connection-' + selectedPackage.id + '.json');
}));
$('refresh-connections').addEventListener('click', () => action($('refresh-connections'), () => loadConnections(true)));
$('more-connections').addEventListener('click', () => action($('more-connections'), () => loadConnections()));

function selection() { return { chainId: $('chain').value, addressHash: $('address').value.trim() }; }
$('token-form').addEventListener('input', () => { formRevision++; prepared = null; $('prepared').hidden = true; });
$('token-form').addEventListener('change', () => { formRevision++; prepared = null; $('prepared').hidden = true; });
$('token-form').addEventListener('submit', event => { event.preventDefault();
  action(event.submitter, async () => {
    const revision = formRevision;
    const value = await request('/api/buyer', { ...selection(), intentId: $('intent').value.trim(), responseOut: $('response-out').value.trim() });
    if (revision !== formRevision) return;
    prepared = value;
    $('prepared').hidden = false; $('prepared-summary').textContent = prepared.token.url + ' · config SHA-256 ' + prepared.configSha256;
    $('review-json').textContent = json(prepared.config); message('The original SF88 review config is ready.');
  });
});
$('download-review').addEventListener('click', () => { if (prepared) download(json(prepared.config), 'blockscout-buyer-review.json'); });
$('diagnose').addEventListener('click', () => action($('diagnose'), async () => {
  const result = await request('/api/diagnose', selection());
  await refresh(); await loadHistory(true); if (result.observation) await select(result.observation.id);
  message(result.status === 200 ? 'Provider response retained. Inspect its exact bytes and quota observation below.' : names[result.error] ?? result.error ?? 'Provider read returned HTTP ' + result.status);
}));
$('filter-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  filter = {}; if ($('filter-chain').value) filter.chainId = $('filter-chain').value;
  if ($('filter-address').value.trim()) filter.addressHash = $('filter-address').value.trim();
  await loadHistory(true);
}); });
$('more').addEventListener('click', () => action($('more'), () => loadHistory()));
$('refresh').addEventListener('click', () => action($('refresh'), async () => { await refresh(); await loadHistory(true); }));
$('download-response').addEventListener('click', () => action($('download-response'), async () => {
  const record = selected; if (!record) return;
  const response = await request('/api/attempts/' + record.id + '/response', undefined, true);
  if (response.headers.get('x-content-sha256') !== record.response.sha256) throw Error('Response identity changed.');
  download(await response.arrayBuffer(), 'blockscout-' + record.id + '.json');
}));
$('show-response').addEventListener('click', () => action($('show-response'), async () => {
  const record = selected, epoch = selectionEpoch; if (!record) return;
  const response = await request('/api/attempts/' + record.id + '/response', undefined, true);
  if (response.headers.get('x-content-sha256') !== record.response.sha256) throw Error('Response identity changed.');
  const text = await response.text(); if (epoch !== selectionEpoch) return;
  $('response-json').textContent = text; $('response-json').hidden = false;
}));
$('backup').addEventListener('click', () => action($('backup'), async () => {
  backup = await request('/api/backup', {}); $('backup-result').hidden = false;
  $('backup-summary').textContent = number(backup.bytes) + ' bytes · SHA-256 ' + backup.sha256;
  $('backup-json').textContent = json(backup); $('download-backup').disabled = backup.bytes > 67108864;
  message(backup.bytes > 67108864 ? 'The complete backup is retained at the displayed private path. Use the CLI to stream this larger database.' : 'The complete provider backup is ready.');
}));
$('download-backup').addEventListener('click', () => action($('download-backup'), async () => {
  const record = backup; if (!record) return;
  const response = await request(record.download, undefined, true);
  if (response.headers.get('x-content-sha256') !== record.sha256) throw Error('Backup identity changed.');
  download(await response.arrayBuffer(), 'blockscout-provider-' + record.id + '.sqlite', 'application/vnd.sqlite3');
}));
try {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Open the private provider-desk URL printed by the merchant launcher.');
  await refresh(); const links = await request('/api/navigation');
  for (const id of ['operations', 'availability', 'fulfillment']) if (links[id]) $(id).href = links[id];
  await loadHistory(true); await loadConnection(); await loadConnections(true);
} catch (e) { message(e.message); }
