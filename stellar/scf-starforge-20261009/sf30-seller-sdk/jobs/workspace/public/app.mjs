const $ = id => document.getElementById(id);
const tokenKey = 'starforge-paid-jobs:' + location.origin;
const fragment = location.hash.slice(1);
if (fragment) { sessionStorage.setItem(tokenKey, fragment); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem(tokenKey) || '';
const state = { snapshot: null, selected: null, detail: null, ticket: null, page: 0, loading: false, mutating: false, lastStates: '' };
const pageSize = 20;
const statuses = ['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
const words = value => String(value ?? '').toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const jobState = job => job?.state ?? job?.status ?? '';
const jobId = job => job?.id ?? job?.jobId ?? '';
const timestamp = value => {
  if (!value) return '—'; const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(value);
};
const json = value => JSON.stringify(value, null, 2);
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function note(message, error = false) {
  $('notice').textContent = message; $('notice').className = 'notice' + (error ? ' error' : ''); $('notice').hidden = !message;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: 'Bearer ' + token,
    ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }, cache: 'no-store' });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.message || 'The request failed (' + response.status + ').');
  }
  return response;
}
async function read(path) { return (await api(path)).json(); }
async function post(path, body = {}) { return (await api(path, { method: 'POST', body: JSON.stringify(body) })).json(); }
function save(body, filename, type = 'application/json') {
  const href = URL.createObjectURL(new Blob([body], { type })), link = document.createElement('a');
  link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 5000);
}
async function attachment(path, fallback) {
  const response = await api(path), disposition = response.headers.get('content-disposition');
  const filename = /filename="([^"]+)"/.exec(disposition || '')?.[1] || fallback;
  save(await response.arrayBuffer(), filename, response.headers.get('content-type') || 'application/octet-stream');
}
function showTicket(ticket) {
  state.ticket = ticket;
  $('ticket-json').textContent = json(ticket); $('ticket-panel').hidden = false;
  state.selected = jobId(ticket.job) || ticket.jobId;
  $('ticket-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function badge(value) {
  return element('span', words(value), 'status' + (value === 'COMPLETED' ? ' complete' : ['FAILED', 'INTERRUPTED'].includes(value) ? ' attention' : ''));
}
function rows() {
  const query = $('search').value.trim().toLowerCase(), selected = $('status-filter').value;
  const jobs = (state.snapshot?.jobs || []).filter(job => (!selected || jobState(job) === selected) && (!query ||
    [jobId(job), job.label, job.reference, job.functionId].some(value => String(value ?? '').toLowerCase().includes(query))));
  jobs.sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')) || jobId(a).localeCompare(jobId(b)));
  state.page = Math.min(state.page, Math.max(0, Math.ceil(jobs.length / pageSize) - 1));
  $('job-rows').replaceChildren();
  for (const job of jobs.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
    const row = element('tr'); if (jobId(job) === state.selected) row.classList.add('selected');
    const identity = element('td'), button = element('button', job.label || job.reference || jobId(job), 'job-button');
    button.type = 'button'; button.addEventListener('click', () => select(jobId(job), true));
    identity.append(button, element('span', jobId(job), 'subline mono'));
    const status = element('td'); status.append(badge(jobState(job)));
    row.append(identity, element('td', job.functionId || '—'), status, element('td', timestamp(job.updatedAt || job.createdAt)));
    $('job-rows').append(row);
  }
  $('queue-count').textContent = jobs.length + ' matching ' + (jobs.length === 1 ? 'job' : 'jobs');
  $('empty').hidden = jobs.length > 0; $('previous').disabled = state.page === 0;
  $('next').disabled = (state.page + 1) * pageSize >= jobs.length;
  $('page-label').textContent = jobs.length ? (state.page * pageSize + 1) + '–' + Math.min((state.page + 1) * pageSize, jobs.length) + ' of ' + jobs.length : '0 jobs';
}
function terms(target, entries, wrapper = false) {
  target.replaceChildren();
  for (const [label, value] of entries) {
    const nodes = [element('dt', label), element('dd', typeof value === 'object' && value !== null ? json(value) : String(value ?? '—'))];
    if (wrapper) { const item = element('div'); item.append(...nodes); target.append(item); }
    else target.append(...nodes);
  }
}
function selectedFunction() { return state.snapshot?.functions?.find(item => item.id === $('function').value); }
function renderFunction() {
  const fn = selectedFunction(); $('function-description').textContent = fn?.description || '';
  const payment = Array.isArray(fn?.payment) ? fn.payment[0] : fn?.payment ?? {};
  terms($('function-terms'), [['Network', payment.network], ['Amount (atomic)', payment.amount], ['Asset', payment.asset],
    ['Recipient', payment.payTo], ['Execution limit', fn?.timeoutMs ? fn.timeoutMs / 1000 + ' seconds' : 'Configured by merchant']]);
  $('input-schema').textContent = json(fn?.inputSchema ?? {});
}
function render(snapshot) {
  state.snapshot = snapshot;
  let deliveryLink = $('result-delivery-link');
  if (snapshot.resultDelivery?.workspace === '/deliveries') {
    if (!deliveryLink) {
      deliveryLink = element('a', 'Result delivery');
      deliveryLink.id = 'result-delivery-link';
      $('refresh').before(deliveryLink);
    }
    deliveryLink.href = '/deliveries#' + token;
    deliveryLink.hidden = false;
  } else if (deliveryLink) deliveryLink.hidden = true;
  $('service-name').textContent = [snapshot.serviceName || 'Job merchant', snapshot.publicOrigin].filter(Boolean).join(' · ');
  const counts = {};
  for (const job of snapshot.jobs || []) counts[jobState(job)] = (counts[jobState(job)] || 0) + 1;
  if (snapshot.counts && typeof snapshot.counts === 'object') Object.assign(counts, snapshot.counts);
  $('count-payment').textContent = (counts.PREPARED || 0) + (counts.AWAITING_SETTLEMENT || 0);
  $('count-ready').textContent = counts.QUEUED || 0;
  $('count-running').textContent = counts.RUNNING || 0;
  $('count-attention').textContent = (counts.FAILED || 0) + (counts.INTERRUPTED || 0);
  $('count-complete').textContent = counts.COMPLETED || 0;
  const worker = snapshot.worker || {};
  const active = Array.isArray(worker.active) ? worker.active.length : worker.active ?? 0;
  $('worker-description').textContent = (worker.running ? 'Running' : worker.draining || active ? 'Draining' : 'Stopped') +
    ' · ' + active + ' active · ' + (worker.maxConcurrency ?? '—') + ' configured execution slots';
  if (worker.error || snapshot.operator?.drainError) note('Worker: ' + String(worker.error ?? snapshot.operator.drainError), true);
  $('worker-start').disabled = !!worker.running || !!worker.draining || state.mutating;
  $('worker-stop').disabled = !worker.running || state.mutating;
  const functions = snapshot.functions || [], previous = $('function').value;
  if (json(functions.map(fn => fn.id)) !== json([...$('function').options].map(option => option.value))) {
    $('function').replaceChildren(...functions.map(fn => { const option = element('option', fn.id); option.value = fn.id; return option; }));
    if (functions.some(fn => fn.id === previous)) $('function').value = previous;
  }
  $('create-form').querySelector('button[type="submit"]').disabled = !functions.length || state.mutating;
  const present = [...new Set([...statuses, ...(snapshot.jobs || []).map(jobState)])];
  if (json(present) !== state.lastStates) {
    const old = $('status-filter').value;
    const all = element('option', 'All states'); all.value = '';
    $('status-filter').replaceChildren(all, ...present.map(value => { const option = element('option', words(value)); option.value = value; return option; }));
    $('status-filter').value = old; state.lastStates = json(present);
  }
  renderFunction(); rows();
  $('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  $('connection').textContent = 'Connected';
}
function renderDetail(job) {
  state.detail = job;
  const id = jobId(job), status = jobState(job);
  $('detail-panel').hidden = false; $('detail-title').textContent = job.label || job.reference || 'Job details';
  $('detail-subtitle').textContent = id; $('detail-state').replaceWith(Object.assign(badge(status), { id: 'detail-state' }));
  const attempts = Array.isArray(job.attempts) ? job.attempts.length : job.attempts ?? job.attempt ?? 0;
  terms($('detail-facts'), [['Function', job.functionId], ['Reference', id], ['Revision', job.revision],
    ['Attempts', attempts], ['Created', timestamp(job.createdAt)], ['Updated', timestamp(job.updatedAt)],
    ['Settlement event', job.nativeSettlement?.id ?? job.settlement?.id],
    ['Worker outcome', job.error?.message ?? job.error?.code ?? job.error ?? job.lastError ?? '—']], true);
  $('detail-input').textContent = json(job.input ?? {}); $('detail-json').textContent = json(job);
  $('history').replaceChildren();
  for (const event of [...(job.history || [])].reverse()) {
    const item = element('li');
    item.append(element('strong', words(event.type ?? event.event ?? event.action ?? event.state ?? 'Updated')),
      element('span', timestamp(event.at ?? event.createdAt ?? event.timestamp), 'history-time'));
    if (event.reason || event.message) item.append(element('p', event.reason || event.message));
    const specifics = Object.fromEntries(Object.entries(event).filter(([key]) => !['type', 'event', 'state', 'action', 'at', 'createdAt', 'timestamp', 'reason', 'message'].includes(key)));
    if (Object.keys(specifics).length) item.append(element('span', json(specifics), 'muted mono'));
    $('history').append(item);
  }
  if (!job.history?.length) $('history').append(element('li', 'This job has no additional retained events.'));
  $('result-panel').hidden = status !== 'COMPLETED';
  const output = job.result ?? job.output ?? {};
  $('result-summary').textContent = [output.filename, output.bytes !== undefined ? Number(output.bytes).toLocaleString() + ' bytes' : '', output.contentType, output.sha256].filter(Boolean).join(' · ');
  $('renew-claim-job').disabled = status !== 'PREPARED' || job.submittedAt !== null ||
    !!(job.nativeSettlement?.id ?? job.settlement?.id) || state.mutating;
  $('cancel-job').disabled = !['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING'].includes(status) || state.mutating;
  $('retry-job').disabled = !['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(status) ||
    !(job.nativeSettlement?.id ?? job.settlement?.id) || state.mutating;
}
async function select(id, scroll = false) {
  state.selected = id; $('result-content').hidden = true;
  try {
    const job = await read('/api/jobs/' + encodeURIComponent(id));
    if (state.selected !== id) return;
    renderDetail(job); rows();
    if (scroll) $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { note(error.message, true); }
}
async function refresh() {
  if (state.loading) return;
  state.loading = true; $('refresh').disabled = true;
  try {
    const snapshot = await read('/api/state'); render(snapshot);
    if (state.selected) {
      const id = state.selected, detail = await read('/api/jobs/' + encodeURIComponent(id));
      if (id === state.selected) renderDetail(detail);
    }
  } catch (error) { $('connection').textContent = 'Unavailable'; note(error.message, true); }
  finally { state.loading = false; $('refresh').disabled = false; }
}
async function change(operation, success) {
  if (state.mutating) return;
  state.mutating = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { const outcome = await operation(); note(typeof success === 'function' ? success(outcome) : success); }
  catch (error) { note(error.message, true); }
  finally {
    state.mutating = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
    await refresh();
  }
}
$('refresh').addEventListener('click', refresh);
$('export').addEventListener('click', () => attachment('/api/export', 'paid-jobs-ledger.json').catch(error => note(error.message, true)));
$('search').addEventListener('input', () => { state.page = 0; rows(); });
$('status-filter').addEventListener('change', () => { state.page = 0; rows(); });
$('previous').addEventListener('click', () => { state.page--; rows(); });
$('next').addEventListener('click', () => { state.page++; rows(); });
$('function').addEventListener('change', renderFunction);
$('example').addEventListener('click', () => { $('input').value = json(selectedFunction()?.example ?? {}); });
$('worker-start').addEventListener('click', () => change(() => post('/api/worker/start'), 'The execution worker is running.'));
$('worker-stop').addEventListener('click', () => change(() => post('/api/worker/stop'), 'Worker drain requested. Running jobs remain available for review and cancellation.'));
$('reconcile').addEventListener('click', () => change(() => post('/api/reconcile'), result =>
  'Settlement review complete. ' + (Array.isArray(result.activated) ? result.activated.length : result.activated ?? 0) + ' jobs activated. ' +
  (Array.isArray(result.exceptions) ? result.exceptions.length : result.exceptions ?? 0) + ' exceptions.'));
$('create-form').addEventListener('submit', event => {
  event.preventDefault(); let input;
  try { input = JSON.parse($('input').value); } catch { note('Enter valid JSON for this function’s input.', true); return; }
  const request = { functionId: $('function').value, input };
  if ($('label').value.trim()) request.label = $('label').value.trim();
  if ($('reference').value.trim()) request.reference = $('reference').value.trim();
  change(async () => {
    showTicket(await post('/api/jobs', request));
  }, 'Job prepared. Save the purchase ticket for its buyer.');
});
$('ticket-hide').addEventListener('click', () => { $('ticket-panel').hidden = true; });
$('ticket-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(json(state.ticket)); note('Purchase ticket copied.'); }
  catch { note('Copy is unavailable in this browser. Download the ticket instead.', true); }
});
$('ticket-download').addEventListener('click', () => save(json(state.ticket), 'job-' + (jobId(state.ticket?.job) || 'purchase') + '-ticket.json'));
$('result-preview').addEventListener('click', async () => {
  const id = state.selected;
  try {
    const result = await read('/api/jobs/' + encodeURIComponent(id) + '/preview');
    if (state.selected !== id) return;
    let text = result.text;
    if (text !== null && !result.truncated && /json/i.test(result.contentType ?? '')) {
      try { text = json(JSON.parse(text)); } catch {}
    }
    $('result-content').textContent = text === null ? 'This is a binary result. Download it to use the file.' :
      text + (result.truncated ? '\n\n[Preview limited to the first 256 KiB. Download contains the complete result.]' : '');
    $('result-content').hidden = false;
  } catch (error) { note(error.message, true); }
});
$('result-download').addEventListener('click', () => attachment('/api/jobs/' + encodeURIComponent(state.selected) + '/result', 'job-result.bin').catch(error => note(error.message, true)));
for (const action of ['cancel', 'retry']) $(action + '-job').addEventListener('click', () => {
  if (!$('action-form').reportValidity() || !state.detail || jobId(state.detail) !== state.selected) return;
  const id = state.selected, expectedRevision = state.detail.revision, reason = $('reason').value.trim();
  change(() => post('/api/jobs/' + encodeURIComponent(id) + '/' + action, { expectedRevision, reason }),
    action === 'retry' ? 'Execution queued on the original paid job.' : 'Job cancellation recorded.');
});
$('renew-claim-job').addEventListener('click', () => {
  if (!$('action-form').reportValidity() || !state.detail || jobId(state.detail) !== state.selected) return;
  const id = state.selected, expectedRevision = state.detail.revision, reason = $('reason').value.trim();
  change(async () => {
    showTicket(await post('/api/jobs/' + encodeURIComponent(id) + '/renew-claim', { expectedRevision, reason }));
  }, 'Purchase ticket renewed for the same prepared job. Save this replacement ticket for its buyer.');
});
$('action-form').addEventListener('submit', event => event.preventDefault());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
await refresh();
setInterval(() => { if (!document.hidden && !state.mutating) refresh(); }, 5000);
