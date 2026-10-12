// MIT. Operator surface for the original paid-job merchant and retained n8n dispatches.
const $ = id => document.getElementById(id);
const tokenKey = 'starforge-n8n-operator:' + location.origin;
const JOB_STATES = ['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
const DISPATCH_STATES = ['READY', 'DISPATCHING', 'UNRESOLVED', 'REJECTED', 'PENDING', 'SUCCEEDED', 'FAILED'];
const TERMINAL_LOCAL = new Set(['FAILED', 'INTERRUPTED', 'CANCELLED']);
const PAGE_SIZE = 20;
const PREVIEW_BYTES = 262144;
const state = {
  token: '', snapshot: null, selected: null, detail: null, selectionGeneration: 0,
  refreshing: false, refreshAbort: null, selectionAbort: null, mutating: false,
  timer: null, failures: 0, authenticated: true, page: 0, functionId: '',
  drafts: new Map(), reasons: new Map(), detailLimits: {dispatches: 10, jobs: 20, workflow: 20},
  ticket: null, result: null, resultPending: null, errorSource: null,
};

function captureToken() {
  const fragment = location.hash.slice(1);
  const supplied = fragment.startsWith('token=') ? new URLSearchParams(fragment).get('token') :
    fragment && !fragment.includes('=') && !['queue', 'prepare', 'detail', 'configuration', 'main'].includes(fragment) ? fragment : '';
  if (supplied) {
    state.token = supplied;
    try { sessionStorage.setItem(tokenKey, supplied); } catch { /* The current tab still holds its original connection. */ }
    history.replaceState(null, '', location.pathname + location.search);
    state.authenticated = true;
  } else if (!state.token) {
    try { state.token = sessionStorage.getItem(tokenKey) || ''; } catch { /* Private browser storage may be unavailable. */ }
  }
  return !!supplied;
}
captureToken();
const json = value => JSON.stringify(value ?? null, null, 2);
const idOf = job => job?.id ?? job?.jobId ?? '';
const activeOf = record => record?.dispatches?.at(-1) ?? null;
const settlementOf = job => job?.settlement ?? job?.nativeSettlement ?? null;
const human = value => String(value ?? '').toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const text = (id, value) => {
  const content = value === null || value === undefined || value === '' ? '—' : String(value);
  if ($(id).textContent !== content) $(id).textContent = content;
};
const show = (id, visible) => { $(id).hidden = !visible; };
const when = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : String(value);
};
const bytes = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() + ' bytes' : '—';
const printable = value => value === null || value === undefined ? '—' : typeof value === 'object' ? json(value) : String(value);
function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function notice(message) { text('notice', message); show('notice', !!message); }
function problem(message, source = 'action') {
  state.errorSource = source; text('error', message); show('error', !!message);
}
function connection(value, mode = '') {
  text('connection', value); $('connection').dataset.state = mode;
}
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function facts(id, pairs) {
  const target = $(id);
  const fingerprint = JSON.stringify(pairs);
  if (target.dataset.value === fingerprint) return;
  target.dataset.value = fingerprint; target.replaceChildren();
  for (const [label, value, mono = false] of pairs) {
    const term = node('dt', label), definition = node('dd', printable(value), mono ? 'mono' : '');
    target.append(term, definition);
  }
}
function badge(value, prefix = '') {
  const attention = ['FAILED', 'INTERRUPTED', 'UNRESOLVED', 'REJECTED'].includes(value);
  const strong = ['COMPLETED', 'SUCCEEDED'].includes(value);
  const label = value === 'NOT_DISPATCHED' ? 'Not dispatched' : human(value);
  const element = node('span', prefix + label, 'status' + (attention ? ' attention' : strong ? ' strong' : ''));
  element.title = String(value ?? '');
  return element;
}
async function api(path, {method = 'GET', body, signal} = {}) {
  if (!state.token) throw new Error('Open the complete private launch address from the merchant terminal to connect this tab.');
  let response;
  try {
    response = await fetch(path, {method, signal, cache: 'no-store', redirect: 'error',
      headers: {authorization: 'Bearer ' + state.token, ...(body !== undefined ? {'content-type': 'application/json'} : {})},
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The merchant host did not return a response. Refresh its original job record before repeating an operation.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = typeof payload.error === 'object' ? payload.error : payload;
    const error = new Error(detail.message || 'The merchant request returned HTTP ' + response.status + '.');
    error.code = detail.code || payload.code; error.status = response.status;
    if (response.status === 401) {
      state.authenticated = false; connection('Launch address required', 'error');
      error.message = 'This operator connection has expired. Open the complete current private launch address from the merchant terminal.';
    }
    throw error;
  }
  return response;
}
async function read(path, options) { return (await api(path, options)).json(); }
async function post(path, body = {}) { return (await api(path, {method: 'POST', body})).json(); }
function filename(value, fallback) {
  const name = String(value || fallback).split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 180);
  return name && name !== '.' && name !== '..' ? name : fallback;
}
function responseFilename(response, fallback) {
  return filename(/filename="([^"]+)"/i.exec(response.headers.get('content-disposition') || '')?.[1], fallback);
}
function save(blob, name) {
  const href = URL.createObjectURL(blob), link = node('a');
  link.href = href; link.download = filename(name, 'merchant-export.json');
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}
function saveJSON(value, name) { save(new Blob([json(value) + '\n'], {type: 'application/json'}), name); }

function configuration() { return state.snapshot?.configuration?.normalized ?? {}; }
function currentFunction() { return state.snapshot?.jobs?.functions?.find(fn => fn.id === $('function').value); }
function parseInput() {
  return JSON.parse($('job-input').value, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Input numbers must be finite JSON values.');
    return value;
  });
}
function saveDraft() {
  if (!state.functionId) return;
  state.drafts.set(state.functionId, {input: $('job-input').value, label: $('job-label').value, reference: $('job-reference').value});
}
function selectFunction(id) {
  if (state.functionId !== id) {
    saveDraft(); state.functionId = id;
    const fn = state.snapshot?.jobs?.functions?.find(item => item.id === id);
    const draft = state.drafts.get(id) ?? {input: json(fn?.example ?? {}), label: '', reference: ''};
    $('job-input').value = draft.input; $('job-label').value = draft.label; $('job-reference').value = draft.reference;
  }
  renderFunction(); controls();
}
function renderFunction() {
  const fn = currentFunction(), automation = configuration().automations?.[fn?.id] ?? {};
  const fingerprint = JSON.stringify([fn, automation]);
  if ($('input-schema').dataset.value === fingerprint) { inputStatus(); return; }
  $('input-schema').dataset.value = fingerprint;
  text('function-description', fn?.description || 'Choose an installed automation.');
  facts('function-facts', [
    ['Function', fn?.id, true], ['Workflow ID', automation.workflowId, true],
    ['Purchase route', fn?.path, true], ['Result node', automation.resultNode],
    ['Result fields', automation.resultFields?.join(', ')],
    ['Output', [fn?.output?.filename, fn?.output?.contentType].filter(Boolean).join(' · ')],
    ['Local time limit', fn?.timeoutMs ? (fn.timeoutMs / 1000).toLocaleString() + ' seconds' : null],
    ['Input limit', fn?.maxInputBytes ? bytes(fn.maxInputBytes) : null],
  ]);
  text('input-schema', json(fn?.inputSchema ?? {})); text('function-payment', json(fn?.payment ?? {}));
  const schema = fn?.inputSchema ?? {}, properties = schema.properties ?? {}, required = new Set(schema.required ?? []);
  $('field-guide').replaceChildren();
  for (const [name, field] of Object.entries(properties)) {
    const row = node('div', undefined, 'field-row');
    row.append(node('strong', name + (required.has(name) ? ' · required' : '')));
    const details = [Array.isArray(field.type) ? field.type.join(' / ') : field.type,
      field.description, field.enum ? 'Values: ' + field.enum.map(printable).join(', ') : '',
      field.default !== undefined ? 'Default: ' + printable(field.default) : ''].filter(Boolean).join(' · ');
    row.append(node('p', details || 'See the complete input schema.'));
    $('field-guide').append(row);
  }
  if (!Object.keys(properties).length) $('field-guide').append(node('p', 'Use the declared schema and example for this automation.', 'muted small'));
  inputStatus();
}
function inputStatus() {
  try {
    const value = parseInput();
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const maximum = currentFunction()?.maxInputBytes;
    text('input-status', 'Valid JSON · ' + bytes(size) + (maximum ? ' · configured limit ' + bytes(maximum) : '') +
      '. The merchant validates the complete input schema.');
    $('input-status').dataset.invalid = maximum && size > maximum ? 'true' : 'false';
  } catch {
    text('input-status', 'Enter valid JSON before preparing this job. Your input remains in this tab.');
    $('input-status').dataset.invalid = 'true';
  }
}
function renderOverview() {
  const snapshot = state.snapshot, jobs = snapshot.jobs ?? {}, dispatches = new Map((snapshot.dispatches ?? []).map(row => [row.jobId, row]));
  const rows = jobs.jobs ?? [], counts = jobs.counts ?? {};
  const attention = rows.filter(job => ['FAILED', 'INTERRUPTED'].includes(job.state) ||
    ['UNRESOLVED', 'REJECTED', 'FAILED'].includes(activeOf(dispatches.get(idOf(job)))?.state) ||
    TERMINAL_LOCAL.has(job.state) && ['PENDING', 'DISPATCHING'].includes(activeOf(dispatches.get(idOf(job)))?.state)).length;
  text('service-name', [jobs.serviceName || configuration().serviceName, jobs.publicOrigin].filter(Boolean).join(' · '));
  text('count-payment', (counts.PREPARED ?? 0) + (counts.AWAITING_SETTLEMENT ?? 0));
  text('count-queued', counts.QUEUED ?? 0); text('count-running', (counts.RUNNING ?? 0) + (counts.CANCELLING ?? 0));
  text('count-attention', attention); text('count-completed', counts.COMPLETED ?? 0);
  const worker = jobs.worker ?? {};
  text('worker-status', (worker.running ? 'Running' : worker.draining ? 'Draining current work' : 'Stopped') +
    ' · ' + (worker.active ?? 0) + ' active · ' + (worker.maxConcurrency ?? '—') + ' execution slots');
  const alerts = [worker.error && 'Worker: ' + worker.error, jobs.storage !== 'ready' && jobs.storage && 'Storage: ' + printable(jobs.storage),
    jobs.nativeActivationError && 'Settlement activation: ' + jobs.nativeActivationError,
    jobs.eventExceptions?.length && jobs.eventExceptions.length + ' native settlement event exceptions require review in the job records.',
    snapshot.operator?.drainError && 'Worker drain: ' + snapshot.operator.drainError].filter(Boolean);
  text('operational-alerts', alerts.join(' ')); show('operational-alerts', alerts.length > 0);
  const functions = jobs.functions ?? [], ids = functions.map(fn => fn.id);
  if (JSON.stringify(ids) !== JSON.stringify([...$('function').options].map(option => option.value))) {
    const chosen = state.functionId;
    $('function').replaceChildren(...functions.map(fn => { const option = node('option', fn.id); option.value = fn.id; return option; }));
    if (!functions.length) { const option = node('option', 'No configured automations'); option.value = ''; $('function').append(option); }
    $('function').value = ids.includes(chosen) ? chosen : ids[0] ?? '';
  }
  selectFunction($('function').value); renderJobs(); renderConfiguration(); controls();
}

function renderJobs() {
  const jobs = state.snapshot?.jobs?.jobs ?? [];
  const dispatches = new Map((state.snapshot?.dispatches ?? []).map(row => [row.jobId, row]));
  const query = $('job-search').value.trim().toLocaleLowerCase(), local = $('job-filter').value, remote = $('dispatch-filter').value;
  const found = jobs.filter(job => {
    const record = dispatches.get(idOf(job)), active = activeOf(record);
    return (!local || job.state === local) && (!remote || (active?.state ?? 'NOT_DISPATCHED') === remote) &&
      (!query || [idOf(job), job.label, job.functionId, active?.executionId, record?.workflowId]
        .some(value => String(value ?? '').toLocaleLowerCase().includes(query)));
  }).sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)) || idOf(a).localeCompare(idOf(b)));
  state.page = Math.min(state.page, Math.max(0, Math.ceil(found.length / PAGE_SIZE) - 1));
  const page = found.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const fingerprint = JSON.stringify([page.map(job => [job, activeOf(dispatches.get(idOf(job)))]), state.selected]);
  if ($('job-rows').dataset.value !== fingerprint) {
    const focused = document.activeElement?.dataset?.jobId;
    $('job-rows').dataset.value = fingerprint; $('job-rows').replaceChildren();
    for (const job of page) {
      const id = idOf(job), active = activeOf(dispatches.get(id)), row = node('tr');
      row.classList.toggle('selected', id === state.selected);
      const identity = node('td'), button = node('button', job.label || id, 'job-select');
      button.type = 'button'; button.dataset.jobId = id; button.setAttribute('aria-pressed', String(id === state.selected));
      button.addEventListener('click', () => selectJob(id, true));
      identity.append(button, node('span', id, 'subline mono'));
      const localCell = node('td'); localCell.append(badge(job.state));
      const remoteCell = node('td'); remoteCell.append(badge(active?.state ?? 'NOT_DISPATCHED'));
      if (active?.executionId) remoteCell.append(node('span', 'Execution ' + active.executionId, 'subline mono'));
      const payment = node('td', settlementOf(job)?.id ? 'Settled' : job.state === 'PREPARED' ? 'Prepared' : 'Awaiting receipt');
      row.append(identity, node('td', job.functionId), localCell, remoteCell, payment, node('td', when(job.updatedAt)));
      $('job-rows').append(row);
    }
    if (focused) [...$('job-rows').querySelectorAll('button')].find(button => button.dataset.jobId === focused)?.focus({preventScroll: true});
  }
  text('queue-count', found.length + ' matching ' + (found.length === 1 ? 'job' : 'jobs'));
  show('queue-empty', !found.length);
  text('queue-empty', jobs.length ? 'No jobs match these filters.' : 'There are no jobs yet. Prepare the first customer handoff below.');
  text('page-label', found.length ? (state.page * PAGE_SIZE + 1) + '–' + Math.min((state.page + 1) * PAGE_SIZE, found.length) + ' of ' + found.length : '0 jobs');
  $('previous').disabled = state.page === 0; $('next').disabled = (state.page + 1) * PAGE_SIZE >= found.length;
}

function renderConfiguration() {
  const data = state.snapshot.configuration ?? {}, normalized = data.normalized ?? {}, connection = normalized.connection ?? {};
  const environment = data.environment ?? [], missing = environment.filter(item => !item.present);
  text('environment-summary', environment.length ? missing.length ? missing.length + ' credential references missing' : 'Credential references present' : 'No credential references reported');
  const fingerprint = JSON.stringify([state.snapshot.services, environment, normalized]);
  if ($('configuration').dataset.value === fingerprint) return;
  $('configuration').dataset.value = fingerprint;
  $('service-links').replaceChildren();
  const labels = {seller: 'Seller', customer: 'Customer status', operations: 'Merchant operations', jobsOperator: 'Paid-job workspace'};
  for (const [key, value] of Object.entries(state.snapshot.services ?? {})) {
    const raw = typeof value === 'string' ? value : value?.url ?? value?.origin;
    const url = safeUrl(raw), definition = node('dd');
    if (url) { const link = node('a', raw); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; definition.append(link); }
    else definition.textContent = raw || 'Not running';
    $('service-links').append(node('dt', labels[key] ?? human(key)), definition);
  }
  $('environment-list').replaceChildren(...environment.map(item => {
    const row = node('li'); row.append(node('code', item.name), node('span', item.present ? 'Present' : 'Missing', 'pill')); return row;
  }));
  if (!environment.length) $('environment-list').append(node('li', 'No configured references were returned.'));
  facts('connection-facts', [['n8n API', connection.apiBaseUrl], ['Poll interval', connection.pollIntervalMs ? connection.pollIntervalMs + ' ms' : null],
    ['Request timeout', connection.requestTimeoutMs ? connection.requestTimeoutMs / 1000 + ' seconds' : null],
    ['Installed workflows', Object.keys(normalized.automations ?? {}).length]]);
  text('configuration-hash', data.configurationSha256); text('configuration-json', json(normalized));
}

function reasonValues() {
  return {local: $('local-reason').value, execution: $('execution-reason').value,
    executionId: $('execution-id').value, rerun: $('rerun-reason').value,
    dispatchId: activeOf(state.detail?.dispatch)?.id ?? state.reasons.get(state.selected)?.dispatchId ?? null};
}
function retainReasons() { if (state.selected) state.reasons.set(state.selected, reasonValues()); }
function loadReasons(id) {
  const saved = state.reasons.get(id) ?? {};
  $('local-reason').value = saved.local ?? ''; $('execution-reason').value = saved.execution ?? '';
  $('execution-id').value = saved.executionId ?? ''; $('rerun-reason').value = saved.rerun ?? '';
}
function errorText(error) {
  if (!error) return '';
  return typeof error === 'string' ? error : [error.message, error.code, error.httpStatus && 'HTTP ' + error.httpStatus, error.at && when(error.at)].filter(Boolean).join(' · ');
}
function renderDetail(detail) {
  if (idOf(detail.job) !== state.selected) return;
  state.detail = detail;
  const job = detail.job, record = detail.dispatch, dispatch = activeOf(record), settlement = settlementOf(job), observation = dispatch?.observation;
  show('detail-empty', false); show('detail-content', true);
  text('detail-heading', job.label || 'Selected job'); text('detail-id', idOf(job));
  $('detail-badges').replaceChildren(badge(job.state, 'Local: '), badge(dispatch?.state ?? 'NOT_DISPATCHED', 'Workflow: '));
  const localExplanations = {
    PREPARED: 'The prepared purchase handoff is ready for its customer.',
    AWAITING_SETTLEMENT: 'The purchase was submitted. The job awaits its native settlement receipt.',
    QUEUED: 'The settled job is queued for its local worker.',
    RUNNING: 'The local attempt is executing or monitoring its retained workflow.',
    CANCELLING: 'The local attempt is stopping. Review n8n separately for the workflow state.',
    COMPLETED: 'The original result is retained and available for the customer.',
    FAILED: 'The local attempt failed. Review its retained workflow before choosing recovery.',
    INTERRUPTED: 'The local attempt was interrupted. Its original workflow record remains available for recovery.',
    CANCELLED: 'The local job is stopped. Its workflow execution has the separate state shown here.',
  };
  text('local-explanation', localExplanations[job.state] || human(job.state));
  facts('job-facts', [['Function', job.functionId, true], ['Job revision', job.revision],
    ['Local attempts', Array.isArray(job.attempts) ? job.attempts.length : job.attempts ?? 0],
    ['Created', when(job.createdAt)], ['Submitted', when(job.submittedAt)], ['Updated', when(job.updatedAt)],
    ['Input SHA-256', job.inputSha256, true]]);
  const executionExplanations = {
    READY: 'This retained dispatch is ready for the original worker.',
    DISPATCHING: 'The original webhook request has begun. Its acknowledgment is being retained.',
    UNRESOLVED: 'The webhook response was unavailable. Associate the original n8n execution to recover this dispatch.',
    REJECTED: 'The production webhook rejected this dispatch. Review the connection and rejection before authorizing a new run.',
    PENDING: 'The original n8n execution is pending. The worker follows its saved execution ID.',
    SUCCEEDED: 'n8n completed and its selected output was retained. The local job controls customer result availability.',
    FAILED: 'The original n8n execution failed. A new workflow execution requires an explicit rerun decision.',
  };
  text('execution-explanation', dispatch ? executionExplanations[dispatch.state] || human(dispatch.state) : 'This job has not retained a workflow dispatch.');
  facts('execution-facts', [['Workflow ID', record?.workflowId ?? configuration().automations?.[job.functionId]?.workflowId, true],
    ['Execution ID', dispatch?.executionId, true], ['Dispatch ID', dispatch?.id, true], ['Dispatch revision', record?.revision],
    ['Native n8n status', observation?.status], ['Input association', observation?.inputVerified === true ? 'Verified against original input' :
      observation?.inputVerified === false ? 'Not verified' : 'Not reported'],
    ['Started', when(observation?.startedAt ?? dispatch?.startedAt)], ['Stopped', when(observation?.stoppedAt)],
    ['Next provider read', when(dispatch?.nextPollAt)]]);
  const payment = job.payment ?? {};
  text('settlement-explanation', settlement?.id ? 'This job retains its original native settlement event.' :
    'The merchant has not retained a native settlement event for this job.');
  facts('settlement-facts', [['Event ID', settlement?.id, true], ['Recorded', when(settlement?.at)],
    ['Network', payment.network], ['Amount (atomic)', payment.amount], ['Asset', payment.asset],
    ['Recipient', payment.payTo, true]]);
  text('settlement-json', json(job.settlement ?? job.nativeSettlement ?? null));
  text('job-error', errorText(job.error)); show('job-error', !!job.error);
  text('execution-error', errorText(dispatch?.error)); show('execution-error', !!dispatch?.error);
  const rememberedDispatch = state.reasons.get(idOf(job))?.dispatchId;
  if (rememberedDispatch && rememberedDispatch !== dispatch?.id) $('execution-id').value = '';
  if (dispatch?.executionId) $('execution-id').value = dispatch.executionId;
  $('execution-id').readOnly = !!dispatch?.executionId;
  text('detail-input', json(job.input)); text('detail-job-json', json(job)); text('detail-dispatch-json', json(record));
  show('result-panel', job.state === 'COMPLETED' && !!job.result);
  text('result-description', [job.result?.filename, job.result?.bytes != null ? bytes(job.result.bytes) : '', job.result?.contentType].filter(Boolean).join(' · '));
  text('result-hash', job.result?.sha256);
  if (state.result && state.result.key !== idOf(job) + ':' + job.result?.sha256) { state.result = null; show('result-preview-panel', false); }
  retainReasons(); renderHistories(); controls();
}

function renderHistory(targetId, events, limit, moreId) {
  const source = [...(events ?? [])].reverse(), visible = source.slice(0, limit), target = $(targetId);
  const fingerprint = JSON.stringify(visible);
  if (target.dataset.value !== fingerprint) {
    target.dataset.value = fingerprint; target.replaceChildren();
    for (const event of visible) {
      const item = node('li');
      item.append(node('strong', human(event.action ?? event.state ?? 'Recorded')), node('time', when(event.at), 'history-time'));
      if (event.reason) item.append(node('p', event.reason));
      const details = Object.fromEntries(Object.entries(event).filter(([key]) => !['action', 'at', 'reason'].includes(key)));
      if (Object.keys(details).length) item.append(node('div', json(details), 'mono event-detail'));
      target.append(item);
    }
    if (!source.length) target.append(node('li', 'No additional retained events.'));
  }
  show(moreId, source.length > limit);
}
function renderHistories() {
  if (!state.detail) return;
  const {job, dispatch: record} = state.detail, list = [...(record?.dispatches ?? [])].reverse();
  renderHistory('job-history', job.history, state.detailLimits.jobs, 'job-history-older');
  renderHistory('workflow-history', record?.history, state.detailLimits.workflow, 'workflow-history-older');
  const visible = list.slice(0, state.detailLimits.dispatches), fingerprint = JSON.stringify(visible);
  if ($('dispatch-history').dataset.value !== fingerprint) {
    const opened = new Set([...$('dispatch-history').querySelectorAll('article')]
      .filter(card => card.querySelector('details')?.open).map(card => card.dataset.dispatchId));
    $('dispatch-history').dataset.value = fingerprint; $('dispatch-history').replaceChildren();
    for (const [index, entry] of visible.entries()) {
      const card = node('article', undefined, 'dispatch-card'), title = node('h4', index === 0 ? 'Current dispatch' : 'Earlier dispatch');
      card.dataset.dispatchId = entry.id;
      title.append(badge(entry.state)); card.append(title, node('p', entry.id, 'mono'));
      card.append(node('p', 'Execution: ' + (entry.executionId ?? 'Awaiting association')));
      card.append(node('p', 'Created ' + when(entry.createdAt) + (entry.observation?.status ? ' · n8n ' + entry.observation.status : ''), 'muted'));
      if (entry.error) card.append(node('p', errorText(entry.error)));
      const detail = node('details'); detail.append(node('summary', 'Original dispatch fields'), node('pre', json(entry), 'json-block'));
      detail.open = opened.has(entry.id);
      card.append(detail); $('dispatch-history').append(card);
    }
    if (!list.length) $('dispatch-history').append(node('p', 'No workflow has been dispatched for this job.', 'muted small'));
  }
  show('dispatch-older', list.length > state.detailLimits.dispatches);
}

function validReason(value) { return !!value.trim() && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value); }
function controls() {
  const ready = !!state.snapshot && !!state.token && state.authenticated;
  const busy = state.mutating, worker = state.snapshot?.jobs?.worker ?? {};
  $('refresh').disabled = state.refreshing;
  $('export').disabled = !ready || busy;
  $('worker-start').disabled = !ready || busy || worker.running || worker.draining;
  $('worker-stop').disabled = !ready || busy || !worker.running;
  $('function').disabled = !ready || busy || !(state.snapshot?.jobs?.functions?.length);
  $('prepare-job').disabled = !ready || busy || !currentFunction();
  $('load-example').disabled = !currentFunction() || busy;
  $('format-input').disabled = busy;
  $('prepare-job').textContent = busy && state.pendingAction === 'prepare' ? 'Preparing original job…' : 'Prepare job & download handoff';

  const job = state.detail?.job, record = state.detail?.dispatch, dispatch = activeOf(record);
  const same = job && idOf(job) === state.selected;
  const allowed = ready && !busy && same, reason = validReason($('local-reason').value);
  const settled = !!settlementOf(job)?.id;
  const stopped = TERMINAL_LOCAL.has(job?.state);
  const owned = ['RUNNING', 'CANCELLING'].includes(job?.state);
  const retryable = stopped && settled && !job.result &&
    (!dispatch || ['READY', 'SUCCEEDED'].includes(dispatch.state) || !!dispatch.executionId && !['FAILED', 'REJECTED'].includes(dispatch.state));
  $('retry-job').disabled = !allowed || !reason || !retryable;
  $('retry-job').textContent = dispatch?.state === 'SUCCEEDED' ? 'Finish local job from retained result' :
    dispatch?.executionId && !['FAILED', 'REJECTED'].includes(dispatch.state) ? 'Resume local monitoring' : 'Retry local job';
  $('cancel-job').disabled = !allowed || !reason || ['COMPLETED', 'CANCELLED', 'CANCELLING'].includes(job?.state);
  const renewable = job?.state === 'PREPARED' && !job.submittedAt && !settled;
  $('renew-claim').disabled = !allowed || !reason || !renewable;
  text('local-control-note', !same ? 'Select a job to use its current revision.' :
    renewable ? 'Renewing replaces this prepared job’s previous purchase claim and downloads its new handoff.' :
    ['FAILED', 'REJECTED'].includes(dispatch?.state) ? 'Review the original workflow outcome. A fresh execution uses the explicit authorization below.' :
    stopped && !settled ? 'This stopped job has no retained native settlement to admit a local retry.' :
    stopped && dispatch && !dispatch.executionId && dispatch.state !== 'READY' ? 'Associate the original execution before resuming its local monitor.' :
    'Each operation uses the currently displayed job revision and retains your reason.');

  const until = Date.parse(dispatch?.nextPollAt ?? ''), remaining = Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
  const supplied = $('execution-id').value.trim();
  const execution = !!dispatch?.executionId || /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(supplied);
  const association = !dispatch?.executionId && !!supplied;
  const canReconcile = !!dispatch && !['READY', 'SUCCEEDED'].includes(dispatch.state) && !owned &&
    execution && (!association || validReason($('execution-reason').value)) && remaining === 0;
  $('reconcile-job').disabled = !allowed || !canReconcile;
  $('reconcile-job').textContent = association ? 'Verify & associate original execution' : 'Recheck original execution';
  text('reconcile-note', !dispatch ? 'An execution can be reconciled after this job has dispatched its workflow.' :
    dispatch.state === 'SUCCEEDED' ? 'The selected output is retained. A stopped local job can finish from that result.' :
    dispatch.state === 'READY' ? 'The retained dispatch is ready for the original worker.' :
    owned ? 'The active local attempt owns this dispatch. Stop the local job before manual recovery.' :
    remaining ? 'The provider read cooldown ends ' + when(dispatch.nextPollAt) + ' (' + Math.ceil(remaining / 1000) + ' seconds).' :
    !dispatch.executionId ? 'Use the original execution ID from n8n. Its retained Webhook input must match this exact dispatch.' :
    'The request reads this existing execution and refreshes its retained observation.');

  const rerunPossible = stopped && settled && !job.result && ['FAILED', 'REJECTED'].includes(dispatch?.state);
  $('authorize-rerun').disabled = !allowed || !rerunPossible || !validReason($('rerun-reason').value) ||
    dispatch?.state === 'FAILED' && remaining > 0;
  $('authorize-rerun').textContent = dispatch?.state === 'REJECTED' ? 'Authorize new workflow run' : 'Recheck & authorize new workflow run';
  text('rerun-note', !dispatch ? 'A new workflow decision becomes available after an original dispatch.' :
    dispatch.state === 'REJECTED' && rerunPossible ? 'Review the rejection and connection before creating another dispatch for this paid job.' :
    dispatch.state === 'FAILED' && rerunPossible ? remaining > 0 ? 'The provider read cooldown ends ' + when(dispatch.nextPollAt) + '.' :
      'The merchant will recheck the failed execution, retain this decision, and queue the same paid job.' :
    'Available when the local paid job is stopped and its original workflow failed or its dispatch was rejected.');
  const complete = allowed && job?.state === 'COMPLETED' && !!job.result;
  $('result-download').disabled = !complete || !!state.resultPending;
  $('result-preview').disabled = !complete || !!state.resultPending;
  $('handoff-download').disabled = !state.ticket;
  $('handoff-select').disabled = !state.ticket;
}

function scheduleRefresh() {
  clearTimeout(state.timer);
  if (document.hidden || !state.authenticated || !state.token) return;
  const worker = state.snapshot?.jobs?.worker;
  const interval = state.failures ? Math.min(30000, 5000 * state.failures) : worker?.running || worker?.draining || state.selected ? 5000 : 10000;
  state.timer = setTimeout(() => refresh(), interval);
}
async function refresh({manual = false} = {}) {
  if (state.refreshing || state.mutating || document.hidden && !manual) { scheduleRefresh(); return; }
  if (!state.token) { connection('Launch address required', 'error'); problem('Open the complete private launch address from the merchant terminal to connect this tab.', 'read'); controls(); return; }
  state.refreshing = true;
  const controller = new AbortController(); state.refreshAbort = controller; controls();
  try {
    const snapshot = await read('/api/state', {signal: controller.signal});
    if (controller.signal.aborted) return;
    if (!snapshot?.jobs || !Array.isArray(snapshot.jobs.jobs) || !Array.isArray(snapshot.dispatches))
      throw new Error('The merchant returned an incomplete workspace state. Refresh the original host.');
    state.snapshot = snapshot; state.failures = 0; state.authenticated = true;
    renderOverview(); connection('Connected', 'connected'); text('last-updated', 'Updated ' + new Date().toLocaleTimeString());
    if (state.errorSource === 'read') problem('', null);
    if (state.selected) {
      const id = state.selected, generation = state.selectionGeneration;
      const detail = await read('/api/jobs/' + encodeURIComponent(id), {signal: controller.signal});
      if (!controller.signal.aborted && state.selected === id && generation === state.selectionGeneration) renderDetail(detail);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      state.failures++; connection(error.status === 401 ? 'Launch address required' : 'Connection interrupted', 'error');
      problem(error.message, 'read');
    }
  } finally {
    if (state.refreshAbort === controller) state.refreshAbort = null;
    state.refreshing = false; controls(); scheduleRefresh();
  }
}
async function selectJob(id, scroll = false) {
  if (!id) return;
  retainReasons();
  state.selected = id; state.detail = null;
  const generation = ++state.selectionGeneration;
  state.selectionAbort?.abort(); const controller = new AbortController(); state.selectionAbort = controller;
  state.result = null; state.resultPending = null;
  state.detailLimits = {dispatches: 10, jobs: 20, workflow: 20}; loadReasons(id);
  show('detail-content', false); show('detail-empty', true); text('detail-empty', 'Reading the original job and workflow dispatch…');
  text('detail-heading', 'Selected job'); text('detail-id', id); $('detail-badges').replaceChildren();
  show('result-preview-panel', false); renderJobs(); controls();
  try {
    const detail = await read('/api/jobs/' + encodeURIComponent(id), {signal: controller.signal});
    if (state.selected !== id || generation !== state.selectionGeneration) return;
    renderDetail(detail);
    if (scroll) $('detail').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  } catch (error) {
    if (error.name !== 'AbortError' && state.selected === id && generation === state.selectionGeneration) {
      text('detail-empty', error.message); problem(error.message);
    }
  } finally {
    if (state.selectionAbort === controller) state.selectionAbort = null;
    controls();
  }
}
async function change(name, operation, success) {
  if (state.mutating) return;
  state.mutating = true; state.pendingAction = name;
  state.refreshAbort?.abort(); clearTimeout(state.timer);
  problem('', null); notice(''); controls();
  try {
    const result = await operation();
    notice(typeof success === 'function' ? success(result) : success);
    return result;
  } catch (error) {
    problem(error.message + (error.status === 409 ? ' The original records will refresh; your reason stays in this tab.' : ''));
  } finally {
    state.mutating = false; state.pendingAction = null;
    // Let an aborted older refresh retire before asking for the current record.
    if (state.refreshing) {
      state.timer = setTimeout(() => refresh({manual: true}), 0);
    } else await refresh({manual: true});
    controls();
  }
}
function currentAction() {
  const detail = state.detail;
  if (!detail || idOf(detail.job) !== state.selected) throw new Error('Select and refresh the original job before applying an operation.');
  retainReasons();
  return {id: state.selected, job: detail.job, record: detail.dispatch, dispatch: activeOf(detail.dispatch)};
}
function showTicket(value, selectionGeneration) {
  const ticket = value?.handoff ?? value;
  if (!ticket?.job || !idOf(ticket.job) || ticket.schema !== 'stellar-forge.job-handoff.v1')
    throw new Error('The response did not contain the native purchase handoff. Refresh the prepared job and renew its handoff if needed.');
  state.ticket = ticket;
  saveJSON(ticket, idOf(ticket.job) + '-purchase-handoff.json');
  text('handoff-summary', (ticket.job.label ? ticket.job.label + ' · ' : '') + idOf(ticket.job) + ' · ' + ticket.job.functionId);
  show('handoff-panel', true); controls();
  if (selectionGeneration === state.selectionGeneration) selectJob(idOf(ticket.job));
}
async function jobOperation(action) {
  let selected;
  try { selected = currentAction(); } catch (error) { problem(error.message); return; }
  const reason = $('local-reason').value.trim();
  if (!validReason(reason)) { problem('Enter a reason of 1–500 characters for this local job operation.'); $('local-reason').focus(); return; }
  const generation = state.selectionGeneration;
  const messages = {retry: 'The same paid job is queued for its original local worker.',
    cancel: 'The local stop request is retained. The execution panel shows the original n8n workflow state.',
    'renew-claim': 'The renewed private purchase handoff has downloaded.'};
  await change(action, async () => {
    const result = await post('/api/jobs/' + encodeURIComponent(selected.id) + '/' + action, {expectedRevision: selected.job.revision, reason});
    if (action === 'renew-claim') showTicket(result, generation);
    return result;
  }, messages[action]);
}
async function reconcileJob() {
  let selected;
  try { selected = currentAction(); } catch (error) { problem(error.message); return; }
  const body = {expectedRevision: selected.record.revision};
  const reason = $('execution-reason').value.trim();
  if (reason) body.reason = reason;
  if (!selected.dispatch.executionId) {
    body.executionId = $('execution-id').value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.executionId) || !validReason(reason)) {
      problem('Enter the original execution ID and a reason for associating it with this dispatch.'); return;
    }
  }
  await change('reconcile', () => post('/api/jobs/' + encodeURIComponent(selected.id) + '/reconcile', body),
    'The original n8n execution was reconciled into this job’s retained dispatch record.');
}
async function authorizeRerun() {
  let selected;
  try { selected = currentAction(); } catch (error) { problem(error.message); return; }
  const reason = $('rerun-reason').value.trim();
  if (!validReason(reason)) { problem('Enter a reason for authorizing a new workflow execution.'); $('rerun-reason').focus(); return; }
  await change('authorize-rerun', () => post('/api/jobs/' + encodeURIComponent(selected.id) + '/authorize-rerun', {
    expectedRevision: selected.record.revision, jobRevision: selected.job.revision, reason,
  }), 'The new workflow execution is authorized and the same already-paid job is queued. Its earlier dispatch remains in history.');
}

async function resultForCurrentJob() {
  const job = state.detail?.job, id = state.selected;
  if (!job || idOf(job) !== id || job.state !== 'COMPLETED' || !job.result) throw new Error('Select a completed job to read its original result.');
  const key = id + ':' + job.result.sha256;
  if (state.result?.key === key) return state.result;
  if (state.resultPending?.key === key) return state.resultPending.promise;
  const promise = (async () => {
    const response = await api('/api/jobs/' + encodeURIComponent(id) + '/result');
    const blob = await response.blob();
    const result = {key, id, blob, name: responseFilename(response, job.result.filename || id + '-result.json'),
      type: response.headers.get('content-type') || job.result.contentType || 'application/octet-stream'};
    if (state.selected === id && state.detail?.job?.result?.sha256 === job.result.sha256) state.result = result;
    return result;
  })();
  state.resultPending = {key, promise}; controls();
  try { return await promise; }
  finally { if (state.resultPending?.promise === promise) state.resultPending = null; controls(); }
}
async function previewResult() {
  const id = state.selected;
  try {
    const result = await resultForCurrentJob();
    if (id !== state.selected) return;
    const raw = await result.blob.slice(0, PREVIEW_BYTES).arrayBuffer();
    if (id !== state.selected) return;
    let content;
    try { content = new TextDecoder('utf-8', {fatal: true}).decode(raw, {stream: result.blob.size > PREVIEW_BYTES}); }
    catch { text('result-preview-note', 'This result uses binary content. Download the original file to open it.'); show('result-preview-panel', true); text('result-text', ''); return; }
    const complete = result.blob.size <= PREVIEW_BYTES;
    if (complete && /json/i.test(result.type)) { try { content = json(JSON.parse(content)); } catch { /* Display original text when it is not a JSON document. */ } }
    text('result-text', content);
    text('result-preview-note', complete ? 'Complete text preview · ' + bytes(result.blob.size) :
      'Text preview of the first ' + bytes(PREVIEW_BYTES) + ' of ' + bytes(result.blob.size) + '. Download contains the complete original result.');
    show('result-preview-panel', true);
  } catch (error) { problem(error.message); }
}
for (const value of JOB_STATES) {
  const option = node('option', human(value)); option.value = value; $('job-filter').append(option);
}
for (const value of DISPATCH_STATES) {
  const option = node('option', human(value)); option.value = value; $('dispatch-filter').append(option);
}
$('refresh').addEventListener('click', () => refresh({manual: true}));
$('export').addEventListener('click', async () => {
  try {
    const response = await api('/api/export');
    save(await response.blob(), responseFilename(response, 'n8n-merchant-records.json'));
    notice('Original private job and workflow records downloaded.');
  } catch (error) { problem(error.message); }
});
$('job-search').addEventListener('input', () => { state.page = 0; renderJobs(); });
for (const id of ['job-filter', 'dispatch-filter']) $(id).addEventListener('change', () => { state.page = 0; renderJobs(); });
$('previous').addEventListener('click', () => { state.page--; renderJobs(); });
$('next').addEventListener('click', () => { state.page++; renderJobs(); });
$('function').addEventListener('change', () => selectFunction($('function').value));
for (const id of ['job-input', 'job-label', 'job-reference']) $(id).addEventListener('input', () => { saveDraft(); if (id === 'job-input') inputStatus(); });
$('load-example').addEventListener('click', () => { $('job-input').value = json(currentFunction()?.example ?? {}); saveDraft(); inputStatus(); });
$('format-input').addEventListener('click', () => {
  try { $('job-input').value = json(parseInput()); saveDraft(); inputStatus(); }
  catch { inputStatus(); $('job-input').focus(); }
});
$('prepare-form').addEventListener('submit', event => {
  event.preventDefault();
  let input;
  try { input = parseInput(); }
  catch { problem('Enter valid JSON before preparing the job.'); $('job-input').focus(); return; }
  const request = {functionId: $('function').value, input};
  if ($('job-label').value.trim()) request.label = $('job-label').value.trim();
  // Retain the generated reference in the draft so a lost response can be found.
  if (!$('job-reference').value.trim() && globalThis.crypto?.randomUUID) $('job-reference').value = 'job_' + crypto.randomUUID();
  if ($('job-reference').value.trim()) request.reference = $('job-reference').value.trim();
  saveDraft();
  const generation = state.selectionGeneration;
  change('prepare', async () => { const ticket = await post('/api/jobs', request); showTicket(ticket, generation); return ticket; },
    'The original job is prepared and its private purchase handoff has downloaded.');
});
$('handoff-download').addEventListener('click', () => { if (state.ticket) saveJSON(state.ticket, idOf(state.ticket.job) + '-purchase-handoff.json'); });
$('handoff-select').addEventListener('click', () => { if (state.ticket) selectJob(idOf(state.ticket.job), true); });
$('prepare-another').addEventListener('click', () => {
  $('job-reference').value = ''; saveDraft();
  $('prepare').scrollIntoView({block: 'start'}); $('job-label').focus(); $('job-label').select();
});
$('handoff-hide').addEventListener('click', () => { show('handoff-panel', false); state.ticket = null; controls(); });
$('worker-start').addEventListener('click', () => change('worker-start', () => post('/api/worker/start'), 'The original local worker has started.'));
$('worker-stop').addEventListener('click', () => change('worker-stop', () => post('/api/worker/stop'),
  'Local worker drain requested. Current jobs keep running while the worker pauses new local work.'));
$('retry-job').addEventListener('click', () => jobOperation('retry'));
$('cancel-job').addEventListener('click', () => jobOperation('cancel'));
$('renew-claim').addEventListener('click', () => jobOperation('renew-claim'));
$('reconcile-job').addEventListener('click', reconcileJob);
$('authorize-rerun').addEventListener('click', authorizeRerun);
for (const id of ['local-reason', 'execution-reason', 'execution-id', 'rerun-reason'])
  $(id).addEventListener('input', () => { retainReasons(); controls(); });
$('result-download').addEventListener('click', async () => {
  try { const result = await resultForCurrentJob(); save(result.blob, result.name); notice('Original completed result downloaded.'); }
  catch (error) { problem(error.message); }
});
$('result-preview').addEventListener('click', previewResult);
for (const [id, key, step] of [['dispatch-older', 'dispatches', 10], ['job-history-older', 'jobs', 20], ['workflow-history-older', 'workflow', 20]])
  $(id).addEventListener('click', () => { state.detailLimits[key] += step; renderHistories(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(state.timer); text('refresh-policy', 'Live refresh pauses while this page is hidden.'); }
  else { text('refresh-policy', 'Live state refreshes while this page is visible.'); refresh(); }
});
window.addEventListener('hashchange', () => { if (captureToken()) refresh({manual: true}); });
setInterval(() => { if (!document.hidden && state.detail) controls(); }, 1000);
controls();
refresh();

