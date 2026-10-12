// MIT. Checkout browser over the original private customer host and SF88 operation.
const byId = id => document.getElementById(id);
const SESSION = 'sf88-paid-job-customer-session';
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem(SESSION, token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(SESSION) ?? '';
const prefix = '/api/job-checkout';
const requested = new URL(location.href).searchParams.get('checkout');
let requestedId = /^[a-f0-9]{64}$/.test(requested ?? '') ? requested : null;
let selected = null, selectionEpoch = 0, offset = 0, total = 0, rows = [], status = null;
let refreshing = false, stopped = false, timer, requestPending = false, replacementRevision = null;
const endpoint = (id, action = '') => prefix + '/checkouts/' + id + (action ? '/' + action : '');
const words = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
function message(text, error = false) { byId('message').textContent = text; byId('message').dataset.error = String(error); }
function problem(error) {
  const descriptions = {
    JOB_CHECKOUT_REVISION_CONFLICT: 'This checkout changed. Refresh it and review the current request before continuing.',
    JOB_CHECKOUT_OPERATOR_REQUIRED: 'Start this customer workspace with its original operator workspace or profile.',
    JOB_CHECKOUT_TICKET_EXISTS_USE_REPLACE: 'This job already has a retained ticket. Select its checkout to use a renewed merchant ticket.',
    JOB_CHECKOUT_ORIGINAL_ATTEMPT_DIRECTORY_REQUIRED: 'Restore the original operation directory shown below, then recover the retained purchase.',
    JOB_CHECKOUT_NATIVE_RESULT_PENDING: 'The original operation has an attempt record. Recover it again when its original result is available.',
    JOB_CHECKOUT_OPERATION_ACTIVE: 'One original checkout operation is already active in this workspace.',
    JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY: 'This checkout has an original attempt. Use Recover original operation.',
    JOB_CHECKOUT_REVIEW_CHANGED: 'The saved original review changed. Review this request again.',
  };
  message(descriptions[error?.code] ?? words(error?.code ?? 'REQUEST_FAILED'), true);
}
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, { method, credentials: 'omit',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? 'REQUEST_FAILED'), { code: value.error ?? 'REQUEST_FAILED', status: response.status });
  return value;
}
function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function date(value) {
  const parsed = value && new Date(value);
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : '—';
}
function links() {
  for (const [id, path] of [['checkoutLink','/jobs/checkout/'],['jobsLink','/jobs/'],['libraryLink','/'],['collectionsLink','/collections']])
    byId(id).href = path + '#' + token;
}
function renderList() {
  const body = byId('rows'); body.replaceChildren();
  for (const value of rows) {
    const tr = node('tr'); if (value.id === selected?.id) tr.className = 'selected';
    const identity = node('td'), choose = node('button', value.label || value.ticket.jobId);
    choose.type = 'button'; choose.addEventListener('click', () => select(value.id).catch(problem));
    identity.append(choose, node('span', value.ticket.jobId, 'small mono'),
      node('span', new URL(value.ticket.sellerUrl).host + ' · ' + value.ticket.functionId, 'small'));
    const phase = node('td'); phase.append(node('span', value.phase.replaceAll('_',' '), 'state'));
    if (['RUNNING','CANCELLING'].includes(value.task?.state))
      phase.append(node('span', words(value.task.stage) + ' · ' + words(value.task.state), 'small'));
    const amount = node('td', value.ticket.acceptedTerms.maxAtomic, 'money mono');
    amount.append(node('span', value.ticket.acceptedTerms.network, 'small'));
    tr.append(identity, phase, amount); body.append(tr);
  }
  byId('empty').hidden = rows.length > 0;
  byId('empty').textContent = total ? 'No checkouts on this page.' :
    byId('query').value || byId('phase').value ? 'No checkouts match these filters.' : 'Import a ticket to begin.';
  byId('count').textContent = total + (total === 1 ? ' checkout' : ' checkouts');
  byId('page').textContent = total ? offset + 1 + '–' + Math.min(offset + 50, total) + ' of ' + total : '0 checkouts';
  byId('previous').disabled = offset === 0; byId('next').disabled = offset + 50 >= total;
}
function progress(value) {
  if (value.phase === 'ACCEPTED') return 'The original buyer accepted this job. Open it to follow execution, retrieve its result and use the resource library.';
  const task = value.task;
  if (task?.state === 'CANCELLING') return 'Stopping the original operation process and retaining its current state.';
  if (task?.state === 'RUNNING') return {
    PREPARING: 'Preparing the exact job request with the original operator.',
    REVIEWING: 'Reading the original buyer review.',
    EXECUTING: 'Complete the original purchase approval in the terminal connected to this customer workspace.',
    RECOVERING: 'Reopening the retained original request, attempt and result.',
    RETAINING_RESULT: 'Retaining the accepted response in the original job buyer.',
  }[task.stage] ?? 'The original operation is running.';
  if (value.lastError) return {
    JOB_CHECKOUT_NATIVE_RESULT_PENDING: 'The original attempt is retained. Its result is still pending; recover this same operation when the original output is available.',
    JOB_CHECKOUT_ORIGINAL_ATTEMPT_DIRECTORY_REQUIRED: 'The original attempt directory is unavailable. Restore the directory shown under Request and recovery location, then recover.',
    JOB_CHECKOUT_PROCESS_REOPENED: 'This customer process reopened. Recover the saved original operation to read its current outcome.',
  }[value.lastError] ?? words(value.lastError);
  if (value.pendingTicket) return 'A renewed ticket was saved. Recover this checkout to finish its retained replacement.';
  if (value.phase === 'REVIEWED') return 'The exact request is reviewed. Start checkout when ready to use the original terminal approval.';
  if (value.phase === 'FINISHED') return 'The original purchase returned the outcome below.';
  if (value.attempted) return 'The original attempt is retained. Recover it to read the saved result.';
  return 'Review the exact merchant request and its existing operator connection.';
}
function renderDetail() {
  byId('unselected').hidden = Boolean(selected); byId('detail').hidden = !selected;
  byId('stage').hidden = !selected;
  if (!selected) return;
  const value = selected, ticket = value.ticket, terms = ticket.acceptedTerms, native = value.native, review = value.review;
  byId('detailHeading').textContent = value.label || ticket.jobId;
  byId('identity').textContent = ticket.jobId;
  byId('stage').textContent = value.phase.replaceAll('_',' ');
  byId('progress').textContent = progress(value);
  const labels = {
    merchant: new URL(ticket.sellerUrl).host, function: ticket.functionId, network: terms.network,
    amount: terms.maxAtomic, asset: terms.asset, recipient: terms.payTo,
    timeout: terms.maxTimeoutSeconds === undefined ? 'Original selected terms' : terms.maxTimeoutSeconds + ' seconds',
    paymentFlow: terms.paymentFlow ?? 'Original selected terms', merchantRevision: String(ticket.merchantRevision),
    bodyHash: ticket.bodySha256, inputHash: ticket.inputSha256,
    reviewOperator: review?.operatorId ?? '—', reviewService: review?.serviceId ?? '—',
    reviewedAt: date(review?.reviewedAt),
  };
  for (const [id, text] of Object.entries(labels)) byId(id).textContent = text;
  byId('reviewHint').textContent = review
    ? 'The saved original buyer review is bound to this request, body and operator configuration.'
    : 'Review prepares the exact request through your existing operator configuration.';
  for (const [id, action] of [['reviewButton','review'],['executeButton','execute'],['recoverButton','recover'],['replaceButton','replace']])
    byId(id).disabled = requestPending || !value.actions[action];
  byId('stopButton').hidden = !['RUNNING','CANCELLING'].includes(value.task?.state);
  byId('stopButton').disabled = requestPending || !value.actions.stop;
  byId('replacement').hidden = value.attempted || value.phase === 'ACCEPTED';
  byId('replacementFile').disabled = requestPending || !value.actions.replace;
  byId('replacementReason').disabled = requestPending || !value.actions.replace;
  byId('openJob').hidden = !value.jobEntryId;
  if (value.jobEntryId) byId('openJob').href = '/jobs/?entry=' + value.jobEntryId + '#' + token;
  byId('outcomeState').textContent = native?.status ?? (value.attempted ? 'Original attempt retained' : 'Awaiting checkout');
  byId('outcome').textContent = native
    ? [native.httpStatus === null ? null : 'HTTP ' + native.httpStatus,
      native.deliveryStatus ? 'Response file: ' + native.deliveryStatus : null,
      native.recovered ? 'Recovered from the saved original output.' : 'Recorded by the original buyer.',
      native.runtimeError ? 'Runtime: ' + native.runtimeError : null].filter(Boolean).join('\n')
    : value.attempted ? 'Recover this checkout to inspect its original recorded response.' : 'The original buyer result will appear here.';
  byId('requestDetails').textContent = JSON.stringify({
    intentId: value.intentId, sellerUrl: ticket.sellerUrl, method: ticket.method,
    orderReference: ticket.orderReference, statusUrl: ticket.statusUrl, resultUrl: ticket.resultUrl,
    handoffSha256: value.handoffSha256, operator: value.operator, runtimeDirectory: value.runtimeDirectory,
    nativeDirectory: value.nativeDirectory, reviewedConfigSha256: review?.configSha256 ?? null,
    revision: value.revision,
  }, null, 2);
  const history = byId('history'); history.replaceChildren();
  for (const entry of value.history.slice(-24).reverse()) {
    const li = node('li', entry.action.replaceAll('-', ' '));
    li.append(node('span', date(entry.at) + ' · revision ' + entry.revision));
    if (entry.reason) li.append(node('span', entry.reason));
    history.append(li);
  }
}
function renderStatus() {
  if (!status) return;
  byId('total').textContent = status.entries;
  byId('reviewed').textContent = status.counts.REVIEWED ?? 0;
  byId('accepted').textContent = status.counts.ACCEPTED ?? 0;
  byId('activity').textContent = status.active ? words(status.active.stage) + ' · ' + words(status.active.state) : 'Ready';
  const setting = status.selection;
  byId('operator').textContent = setting ? (setting.kind === 'workspace' ? setting.directory : setting.path) +
    '\n' + setting.runtimeDirectory : 'Existing checkouts retain their original operator selection.';
  byId('operatorHint').textContent = setting
    ? 'Start checkout here, then complete the original approval in the connected terminal. Each ticket retains this operator selection.'
    : 'To import a new ticket, open job-workspace serve with --operator-workspace or --operator-profile. Existing checkouts reopen from their saved selection.';
  byId('importButton').disabled = requestPending || !setting;
}
async function select(id) {
  const epoch = ++selectionEpoch, value = await api(endpoint(id));
  if (epoch !== selectionEpoch) return;
  if (selected?.id !== id) {
    replacementRevision = null;
    byId('replaceForm').reset(); byId('replacement').open = false;
  }
  selected = value;
  history.replaceState(null, '', location.pathname + '?checkout=' + id);
  renderList(); renderDetail();
}
async function refresh() {
  if (refreshing || stopped) return;
  refreshing = true;
  try {
    const query = new URLSearchParams({ q: byId('query').value, phase: byId('phase').value, offset: String(offset), limit: '50' });
    const [current, page] = await Promise.all([api(prefix + '/state'), api(prefix + '/checkouts?' + query)]);
    status = current; rows = page.items; total = page.total;
    const selectedId = selected?.id ?? requestedId, epoch = selectionEpoch;
    if (selectedId) {
      const value = await api(endpoint(selectedId));
      if (epoch === selectionEpoch && (!selected || selected.id === selectedId)) { selected = value; requestedId = null; }
    }
    renderStatus(); renderList(); renderDetail();
    byId('connection').textContent = 'Connected · ' + new Date().toLocaleTimeString();
  } catch (error) {
    byId('connection').textContent = 'Connection interrupted';
    if (error.status === 401) message('Open the private launch URL again to restore this session.', true);
    else { requestedId = null; problem(error); }
  } finally { refreshing = false; }
}
async function perform(kind) {
  if (!selected || requestPending) return;
  const id = selected.id, revision = selected.revision;
  requestPending = true; renderDetail(); renderStatus();
  try {
    const value = await api(endpoint(id, 'start'), { method: 'POST', body: { kind, expectedRevision: revision } });
    if (selected?.id === id) selected = value;
    message(kind === 'execute' ? 'Checkout started. Continue in the original connected terminal.' :
      kind === 'review' ? 'Original request review started.' : 'Original operation recovery started.');
  } catch (error) { problem(error); }
  finally { requestPending = false; renderDetail(); renderStatus(); await refresh(); }
}
async function fileBase64(file) {
  if (!file || file.size < 1 || file.size > 65536) throw Object.assign(new Error('TICKET_FILE_REQUIRED'), { code: 'JOB_CHECKOUT_TICKET_FILE_REQUIRED' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
byId('importForm').addEventListener('submit', async event => {
  event.preventDefault(); if (requestPending) return;
  requestPending = true; renderStatus(); renderDetail();
  try {
    const result = await api(prefix + '/import', { method: 'POST', body: {
      handoffBase64: await fileBase64(byId('ticketFile').files[0]),
      ...(byId('ticketLabel').value ? { label: byId('ticketLabel').value } : {}),
    } });
    byId('importForm').reset(); byId('intake').open = false;
    await select(result.checkout.id);
    message(result.reused ? 'Reopened the retained checkout.' : 'Ticket saved. Review its original request when ready.');
  } catch (error) { problem(error); }
  finally { requestPending = false; renderStatus(); renderDetail(); await refresh(); }
});
for (const [id, kind] of [['reviewButton','review'],['executeButton','execute'],['recoverButton','recover']])
  byId(id).addEventListener('click', () => { void perform(kind); });
byId('stopButton').addEventListener('click', async () => {
  if (!selected || requestPending) return;
  const id = selected.id, taskId = selected.task?.id;
  requestPending = true; renderDetail();
  try {
    const value = await api(endpoint(id, 'stop'), { method: 'POST', body: { taskId } });
    if (selected?.id === id) selected = value;
    message('Stop requested for the current local operation.');
  } catch (error) { problem(error); }
  finally { requestPending = false; renderDetail(); await refresh(); }
});
for (const id of ['replacementFile','replacementReason']) byId(id).addEventListener('input', () => {
  replacementRevision ??= selected?.revision;
});
byId('replaceForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || requestPending) return;
  const id = selected.id, revision = replacementRevision ?? selected.revision;
  requestPending = true; renderDetail();
  try {
    const value = await api(endpoint(id, 'replace'), { method: 'POST', body: {
      handoffBase64: await fileBase64(byId('replacementFile').files[0]), reason: byId('replacementReason').value,
      expectedRevision: revision,
    } });
    if (selected?.id === id) { selected = value; replacementRevision = null; byId('replaceForm').reset(); byId('replacement').open = false; }
    message('Renewed ticket retained with the same job and purchase intent.');
  } catch (error) { problem(error); }
  finally { requestPending = false; renderDetail(); await refresh(); }
});
byId('filterForm').addEventListener('submit', event => { event.preventDefault(); offset = 0; void refresh(); });
byId('previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); void refresh(); });
byId('next').addEventListener('click', () => { offset += 50; void refresh(); });
byId('reload').addEventListener('click', () => { void refresh(); });
async function poll() {
  clearTimeout(timer); if (stopped) return;
  if (!document.hidden) await refresh();
  if (!stopped) timer = setTimeout(poll, document.hidden ? 10000 : 2500);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); }, { once: true });
links();
if (!token) message('Open the private launch URL printed by job-workspace serve.', true);
else void poll();
