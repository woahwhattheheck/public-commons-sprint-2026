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
  $('identity').textContent = p.accountAlias + ' · ' + (value.source === 'blockscout-pro' ? 'Blockscout PRO' : 'Loopback contract fixture') + ' · ' + value.paymentNetwork + ' payments';
  $('admission').textContent = p.admission.allowed ? 'Available for a selected read' : names[p.admission.code] ?? p.admission.code;
  $('local-usage').textContent = number(p.localUsage.attempts) + ' / ' + number(l.dayAttempts) + ' attempts';
  $('local-detail').textContent = p.day + ' UTC · ' + number(p.localUsage.configuredCredits) + ' / ' + number(l.dayCredits) +
    ' configured credits · ' + number(l.creditsPerAttempt) + ' per attempt';
  $('provider-credits').textContent = q ? number(q.creditsRemaining) + ' credits remaining' : 'No provider observation';
  $('provider-rate').textContent = q ? number(q.rateRemaining) + ' / ' + number(q.rateLimit) + ' rate-window requests · reported reset ' + number(q.resetMs) + ' ms' : 'A provider response supplies the account headers.';
  if (p.quotaEstimates?.requests) $('provider-rate').textContent += ' · local conservative availability ' + number(p.quotaEstimates.requests.available) + ' requests after ' + number(p.quotaEstimates.requests.reserved) + ' reserved requests';
  $('provider-age').textContent = q ? q.observedAt + ' · ' + (q.fresh ? 'Within the configured observation window' : 'Observation is older than the configured window') : '';
  if (p.quotaEstimates?.credits) $('provider-age').textContent += ' · local conservative availability ' + number(p.quotaEstimates.credits.available) + ' credits after ' + number(p.quotaEstimates.credits.reserved) + ' reserved credits';
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
  await loadHistory(true);
} catch (e) { message(e.message); }
