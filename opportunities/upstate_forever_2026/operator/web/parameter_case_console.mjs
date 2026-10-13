/** Inspect retained native case receipts from either original execution entrypoint. */
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const pretty = value => JSON.stringify(value, null, 2);
const when = value => value ? new Date(value).toLocaleString() : '—';
const quantity = value => Number.isFinite(value) ? value.toLocaleString() : '—';
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  let amount = value, index = 0;
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return amount.toLocaleString(undefined, {maximumFractionDigits: index ? 1 : 0}) + ' ' + units[index];
};
const action = (name, label, disabled = false) =>
  '<button type="button" data-case-console="' + name + '"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
const metric = (label, value) => '<dl><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></dl>';

export function renderCaseResources(value) {
  if (!value?.values) return '<p class="note">Open an attempt with a saved resource observation to inspect its recorded memory and cache values.</p>';
  const observed = value.values, group = observed.cgroup || {}, process = observed.process || {};
  const events = group['memory.events.local'] || group['memory.events'];
  return '<p class="note">' + esc(value.source) + ' · ' + esc(when(value.observed_at || observed.recorded_at)) +
    ' · observing process ' + esc(observed.pid ?? '—') + '</p><div class="native-metrics">' +
    metric('Recorded process memory', bytes(process.VmRSS_bytes)) +
    metric('Recorded process peak', bytes(process.VmHWM_bytes)) +
    metric('Shared group memory', bytes(group['memory.current'])) +
    metric('Shared group limit', group['memory.max'] === 'max' ? 'Unlimited' : bytes(group['memory.max'])) +
    metric('Group shared memory', bytes(group['memory.stat']?.shmem)) +
    metric('GDAL cache used', bytes(observed.gdal_bytes?.GetCacheUsed)) + '</div>' +
    (events ? '<p>Recorded group event totals: ' + [['High threshold', events.high],
      ['Limit reached', events.max], ['Out of memory', events.oom], ['Processes killed', events.oom_kill]]
      .map(([name, total]) => esc(name) + ' ' + quantity(total)).join(' · ') + '.</p>' : '') +
    '<p class="note">These are the selected receipt’s observations. Shared-group totals include other processes and do not identify the cause of this case’s outcome.</p>';
}

export function attachNativeCaseConsole(host, family = 'parameter-study') {
  const settings = {
    'parameter-study': {endpoint: '/api/parameter-studies/execution', queryId: 'id',
      responseId: 'study_id', state: 'study_state', action: 'parameter-study.run',
      payloadId: 'experiment_id', noun: 'study', initial: 'Run original study',
      resume: 'Resume remaining study cases'},
    'programme': {endpoint: '/api/programmes/execution', queryId: 'programme_id',
      responseId: 'programme_id', state: 'programme_state', action: 'compute.programme.run',
      payloadId: 'programme_id', noun: 'programme', initial: 'Run original programme',
      resume: 'Continue unfinished programme runs'},
  }[family];
  if (!settings) throw new Error('Choose an original saved native case family.');
  let panel = null, selectedWorkspace = null, studyId = null, runId = null;
  let attemptId = '', stream = 'native', offset = null, expectedAttempt = '';
  let historyOffset = 0, snapshot = null, timer = null, request = null, listeners = null;
  let generation = 0, busy = false, follow = true;
  const workspace = () => host.getState()?.workspace_key;
  const current = () => panel?.isConnected && workspace() === selectedWorkspace &&
    document.querySelector('[data-parameter-case-console]') === panel;

  function detach() {
    generation++; clearTimeout(timer); timer = null;
    request?.abort(); request = null; listeners?.abort(); listeners = null;
    panel = null; snapshot = null; busy = false;
  }

  function setError(error) {
    if (!current()) return;
    const node = panel.querySelector('[data-case-error]');
    node.hidden = !error; node.textContent = error?.message || String(error || '');
  }

  function restart({nextAttempt = attemptId, nextStream = stream, nextOffset = offset,
                    clearLog = false} = {}) {
    generation++; request?.abort(); request = null; clearTimeout(timer); busy = false;
    attemptId = nextAttempt; stream = nextStream; offset = nextOffset;
    if (clearLog) {
      expectedAttempt = '';
      if (current()) panel.querySelector('[data-case-log]').textContent = '';
    }
    return update();
  }

  function reset(nextAttempt = attemptId, nextStream = stream) {
    return restart({nextAttempt, nextStream, nextOffset: null, clearLog: true});
  }

  function paint(value) {
    snapshot = value;
    const native = value.native, attempt = value.attempt;
    const ownerActive = value.programme_active === true || value.programme_native_active === true;
    panel.querySelector('[data-case-heading]').textContent =
      value.case_bindings.map(row => row.label || row.id).join(' / ');
    const phase = native.execution?.phase;
    panel.querySelector('[data-case-phase]').textContent =
      native.state + (phase ? ' · ' + phase.replaceAll('_', ' ') : '') +
      (native.execution?.model ? ' · ' + native.execution.model.toUpperCase() : '');
    panel.querySelector('[data-case-live]').textContent = native.active
      ? 'This original native run currently holds its execution lock.'
      : value.programme_native_active && !value.programme_active
      ? 'Another original native run in this programme currently holds its execution lock.'
      : ownerActive
      ? 'The original programme is active · ' + String(value.programme?.phase || '').replaceAll('_', ' ') + '.'
      : value.coordinator_active
      ? 'The workspace’s original native coordinator is active. Open its task to follow or reconnect that operation.'
      : 'Open the saved case records or continue the same ' + settings.noun + '’s remaining work.';
    const nativeError = native.error?.message || attempt?.error?.message;
    const error = panel.querySelector('[data-case-native-error]');
    error.hidden = !nativeError; error.textContent = nativeError || '';
    panel.querySelector('[data-case-metrics]').innerHTML =
      metric('Native attempt', quantity(native.execution?.attempt)) +
      metric('Native process', native.execution?.pid ?? '—') +
      metric('Run updated', when(native.execution?.updated_at || native.execution?.completed_at)) +
      metric('Workspace disk available', bytes(native.storage?.available_bytes));
    panel.querySelector('[data-case-stages]').innerHTML = Object.entries(native.stages || {}).map(([name, row]) =>
      '<tr><th scope="row">' + esc(name.toUpperCase()) + '</th><td>' + esc(row.state) +
      '</td><td>' + esc(when(row.completed_at)) + '</td><td>' + esc(quantity(row.files)) +
      '</td><td class="mono">' + esc(row.reused_from?.run_id || '—') + '</td></tr>').join('');
    const reuse = native.execution?.stage_reuse;
    panel.querySelector('[data-case-reuse]').textContent = reuse
      ? (reuse.model || '').toUpperCase() + ' · ' + String(reuse.phase || '').replaceAll('_', ' ') +
        ' · ' + quantity(reuse.files_completed) + ' / ' + quantity(reuse.files_total) +
        ' retained files · ' + bytes(reuse.logical_bytes_completed) +
        (reuse.source_run_id ? ' · original run ' + reuse.source_run_id : '')
      : '';
    const tasks = host.getState()?.tasks || [];
    const activeTasks = tasks.filter(task => task.workspace === selectedWorkspace &&
      task.action === settings.action && task.payload?.[settings.payloadId] === studyId &&
      ['running', 'queued'].includes(task.state));
    const available = !native.active && !ownerActive && !value.coordinator_active && !activeTasks.length &&
      value[settings.state] !== 'complete';
    const owner = panel.querySelector('[data-case-owner]');
    owner.textContent = settings.noun[0].toUpperCase() + settings.noun.slice(1) + ' · ' +
      String(value[settings.state]).replaceAll('_', ' ') +
      (value.programme?.recorded_state !== undefined && value.programme.recorded_state !== value.programme_state
        ? ' (saved state: ' + String(value.programme.recorded_state).replaceAll('_', ' ') + ')' : '') +
      (value.programme?.counts ? ' · ' + quantity(value.programme.counts.complete) + ' / ' +
        quantity(value.programme.counts.total) + ' completed cases' : '');
    panel.querySelector('[data-case-resume]').disabled = !available;
    panel.querySelector('[data-case-resume]').textContent =
      value[settings.state] === 'prepared' ? settings.initial : settings.resume;
    const taskButton = panel.querySelector('[data-case-task]');
    taskButton.hidden = !attempt?.task_id || !tasks.some(task => task.id === attempt.task_id && task.workspace === selectedWorkspace);
    taskButton.dataset.taskId = attempt?.task_id || '';

    const history = value.history;
    historyOffset = history.offset;
    panel.querySelector('[data-case-history-summary]').textContent = history.total
      ? 'Attempts ' + (history.offset + 1) + '–' + (history.offset + history.rows.length) + ' of ' + history.total
      : 'This case has no retained isolated-process receipt. Its original native journal and model log remain available.';
    panel.querySelector('[data-case-history]').innerHTML = history.rows.map(row =>
      '<tr><td>' + (row.kind === 'gura_isolated' ? 'Original Gura CLI' : 'Operator worker') +
      '</td><td>' + esc(when(row.created_at)) + '</td><td>' + esc(row.state) +
      '</td><td>' + (Number.isInteger(row.return_code) ? esc(row.return_code) : '—') +
      '</td><td>' + esc(row.pid ?? '—') + '</td><td><button type="button" data-case-console="attempt" data-attempt-id="' +
      esc(row.id) + '"' + (row.state === 'unavailable' ? ' disabled' : '') + '>' +
      (attempt?.id === row.id ? 'Selected' : 'Open attempt') + '</button>' +
      (row.state === 'unavailable' ? '<small>' + esc(row.error?.message) + '</small>' : '') +
      '</td></tr>').join('');
    panel.querySelector('[data-case-console="previous"]').disabled = history.offset === 0;
    panel.querySelector('[data-case-console="next"]').disabled = history.offset + history.rows.length >= history.total;
    panel.querySelector('[data-case-selected-attempt]').textContent = attempt
      ? (attempt.kind === 'gura_isolated' ? 'Original Gura CLI' : 'Operator worker') + ' · ' +
        when(attempt.created_at) + ' · ' + attempt.state +
        (Number.isInteger(attempt.return_code) ? ' · exit ' + attempt.return_code : '')
      : 'Original run log';
    const resources = panel.querySelector('[data-case-resources]');
    resources.innerHTML = renderCaseResources(attempt?.resources);
    const entries = value.log.available_streams;
    const streamSelect = panel.querySelector('[data-case-stream]');
    stream = value.log.stream;
    const wanted = entries.map(name => '<option value="' + name + '"' +
      (name === stream ? ' selected' : '') + '>' +
      ({native: 'Original native model log (all attempts)', process: 'Selected worker process',
        stdout: 'Selected original stdout', stderr: 'Selected original stderr'}[name]) + '</option>').join('');
    if (streamSelect.innerHTML !== wanted) streamSelect.innerHTML = wanted;
    const output = panel.querySelector('[data-case-log]');
    if (value.log.reset || offset === null) output.textContent = '';
    output.textContent += value.log.text;
    if (output.textContent.length > 700000)
      output.textContent = '[Earlier displayed text is retained in the original log. Use Read from start.]\n' +
        output.textContent.slice(-600000);
    offset = value.log.next_offset; expectedAttempt = value.log.attempt_id || '';
    panel.querySelector('[data-case-log-position]').textContent = bytes(offset) + ' read of ' + bytes(value.log.bytes);
    if (panel.querySelector('[data-case-follow-log]').checked) output.scrollTop = output.scrollHeight;
    panel.querySelector('[data-case-identities]').textContent = pretty({
      context: value.context, cases: value.case_bindings, selection: native.selection,
      model_scope: native.model_scope, selected_attempt: attempt?.id,
      request_sha256: attempt?.request_sha256, request_body_sha256: attempt?.request_body_sha256});
    panel.querySelector('[data-case-receipts]').textContent = pretty({
      attempt, native_execution_history: native.execution_history, native_error: native.error,
      verification: native.verification, programme: value.programme, continuation: value.continuation});
  }

  async function update() {
    if (!current() || busy) return;
    clearTimeout(timer); busy = true;
    const epoch = generation, selectedPanel = panel;
    const query = new URLSearchParams({workspace: selectedWorkspace, [settings.queryId]: studyId, run_id: runId,
      stream, history_offset: String(historyOffset), limit: '25'});
    if (attemptId) query.set('attempt_id', attemptId);
    if (offset !== null) query.set('log_offset', String(offset));
    if (expectedAttempt) query.set('expected_attempt_id', expectedAttempt);
    request = new AbortController();
    try {
      const value = await host.api(settings.endpoint + '?' + query, {signal: request.signal});
      if (epoch !== generation || selectedPanel !== panel || !current()) return;
      if (value[settings.responseId] !== studyId || value.native?.run_id !== runId)
        throw new Error('The returned case differs from the original saved selection.');
      setError(null); paint(value);
    } catch (error) {
      if (epoch === generation && error.name !== 'AbortError') setError(error);
    } finally {
      if (epoch === generation) {
        busy = false; request = null;
        if (current() && follow) timer = setTimeout(update, snapshot?.native.active ? 2000 : 5000);
      }
    }
  }

  async function dispatch(event) {
    const node = event.target.closest('[data-case-console]');
    if (!node || !current() || !panel.contains(node)) return;
    const name = node.dataset.caseConsole;
    if (name === 'attempt') return reset(node.dataset.attemptId, 'native');
    if (name === 'latest') return reset('', 'native');
    if (name === 'refresh') return update();
    if (name === 'start') return restart({nextOffset: 0, clearLog: true});
    if (name === 'previous' || name === 'next') {
      historyOffset = Math.max(0, historyOffset + (name === 'previous' ? -25 : 25));
      return restart();
    }
    if (name === 'native') { const id = runId; detach(); return host.openItem('runs', id); }
    if (name === 'task') { const id = node.dataset.taskId; detach(); return host.openItem('tasks', id); }
    if (name === 'resume') {
      if (!snapshot || snapshot.native.active || snapshot.coordinator_active || snapshot.programme_active || snapshot.programme_native_active)
        throw new Error('Follow the original active calculation before continuing this saved ' + settings.noun + '.');
      node.disabled = true;
      const payload = {[settings.payloadId]: studyId};
      await host.executeAction(settings.action, payload);
      return;
    }
    if (name === 'download' && snapshot) {
      const blob = new Blob([pretty(snapshot) + '\n'], {type: 'application/json'});
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'native-case-' + runId.slice(0, 12) + '.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    }
  }

  async function open(study, run) {
    if (!/^[0-9a-f]{64}$/.test(study || '') || !/^[0-9a-f]{64}$/.test(run || ''))
      throw new Error('Open an original saved ' + settings.noun + ' case.');
    detach(); studyId = study; runId = run; selectedWorkspace = workspace();
    attemptId = ''; stream = 'native'; offset = null; expectedAttempt = '';
    historyOffset = 0; follow = true;
    host.detail('Saved native case',
      '<section class="native-console" data-parameter-case-console>' +
      '<h2 data-case-heading>Opening original case…</h2><p data-case-phase aria-live="polite"></p>' +
      '<p class="note" data-case-owner></p><p class="note" data-case-live></p><div class="notice error" data-case-error hidden></div>' +
      '<div class="notice error" data-case-native-error hidden></div>' +
      '<div class="page-actions">' + action('refresh', 'Refresh') +
      '<button type="button" data-case-console="resume" data-case-resume disabled>' + esc(settings.resume) + '</button>' +
      action('native', 'Open native run') +
      '<button type="button" data-case-console="task" data-case-task hidden>Open original operator task</button>' +
      action('download', 'Download case record') + '</div>' +
      '<div class="native-metrics" data-case-metrics></div><p class="note mono" data-case-reuse></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Native stage</th><th>State</th><th>Retained at</th><th>Files</th><th>Original source run</th></tr></thead><tbody data-case-stages></tbody></table></div>' +
      '<h3>Original process attempts</h3><p class="note" data-case-history-summary></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Entrypoint</th><th>Started</th><th>State</th><th>Exit</th><th>Process</th><th>Open</th></tr></thead><tbody data-case-history></tbody></table></div>' +
      '<div class="page-actions">' + action('previous', 'Previous attempts', true) +
      action('next', 'Next attempts', true) + action('latest', 'Follow latest attempt') + '</div>' +
      '<h3 data-case-selected-attempt>Original run log</h3><section data-case-resources></section>' +
      '<div class="native-log-controls"><label>Log stream<select data-case-stream><option value="native">Original native model log (all attempts)</option></select></label>' +
      '<label class="check"><input type="checkbox" data-case-follow checked> Refresh saved status</label>' +
      '<label class="check"><input type="checkbox" data-case-follow-log checked> Follow new log text</label>' +
      action('start', 'Read from start') + '<span data-case-log-position></span></div>' +
      '<pre class="native-log" data-case-log tabindex="0" aria-label="Retained native log"></pre>' +
      '<details><summary>Original selected input identities</summary><pre data-case-identities></pre></details>' +
      '<details><summary>Original receipts and run history</summary><pre data-case-receipts></pre></details></section>',
      {kind: family + '-case', id: study + ':' + run});
    panel = document.querySelector('[data-parameter-case-console]');
    if (!panel) throw new Error('Open the saved native case in the current operator.');
    listeners = new AbortController();
    panel.addEventListener('click', event => { dispatch(event).catch(setError); }, {signal: listeners.signal});
    panel.querySelector('[data-case-stream]').addEventListener('change', event =>
      reset(attemptId, event.target.value).catch(setError), {signal: listeners.signal});
    panel.querySelector('[data-case-follow]').addEventListener('change', event => {
      follow = event.target.checked; clearTimeout(timer); if (follow) update();
    }, {signal: listeners.signal});
    document.querySelector('#detail-dialog')?.addEventListener('close', detach, {signal: listeners.signal});
    await update();
  }

  return {open, detach};
}

export function attachParameterCaseConsole(host) {
  return attachNativeCaseConsole(host, 'parameter-study');
}
