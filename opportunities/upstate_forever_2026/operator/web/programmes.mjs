/* Retained native execution control, shared by programme and experiment callers. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const short = value => value ? String(value).slice(0, 12) : '—';
const printable = value => value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 6}) : String(value);
const labelState = value => String(value || 'pending').replaceAll('_', ' ');
const asArray = value => Array.isArray(value) ? value : [];
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const option = (row, selected) => '<option value="' + escapeHTML(row.id) + '"' + (row.id === selected ? ' selected' : '') + '>' + escapeHTML(row.title || short(row.id)) + '</option>';
const actionButton = (action, title, value = '', extra = '') => '<button type="button" data-programme-action="' + escapeHTML(action) + '" data-value="' + escapeHTML(value) + '" ' + extra + '>' + escapeHTML(title) + '</button>';
const stateBadge = value => '<span class="programme-state">' + escapeHTML(labelState(value)) + '</span>';
const methodLink = '<a href="https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html" target="_blank" rel="noopener noreferrer">InVEST 3.20.0 freshwater model guidance</a>';

export function attachProgrammes(context) {
  const {api, endpoint, getState, openForm, submitAction, detail, fileList, showTask, toast, openItem} = context;
  let host = null, controller = null, selected = null, currentWorkspace = null;
  let catalogue = null, record = null, loading = false, generation = 0;
  let subset = new Set(), latestError = '', activeRequest = false;
  const selectionByWorkspace = new Map();

  function workspaceKey() { return getState()?.workspace_key; }
  function rememberedSelection(key) {
    if (selectionByWorkspace.has(key)) return selectionByWorkspace.get(key);
    let value = null;
    try { value = sessionStorage.getItem('upstate-programme-selection:' + key); } catch {}
    if (!/^[0-9a-f]{64}$/.test(value || '')) value = null;
    selectionByWorkspace.set(key, value);
    return value;
  }
  function rememberSelection(key, value) {
    selectionByWorkspace.set(key, value || null);
    try {
      const name = 'upstate-programme-selection:' + key;
      if (value) sessionStorage.setItem(name, value); else sessionStorage.removeItem(name);
    } catch {}
  }
  function query(path, values = {}) { return endpoint('/api/programmes/' + path, values); }
  function showError(error) {
    latestError = error?.message || String(error);
    if (host) {
      const errorNode = host.querySelector('[data-programme-error]');
      if (errorNode) { errorNode.textContent = latestError; errorNode.hidden = false; }
    }
  }
  function clearError() {
    latestError = '';
    const errorNode = host?.querySelector('[data-programme-error]');
    if (errorNode) { errorNode.textContent = ''; errorNode.hidden = true; }
  }
  function tasksFor(id) {
    return asArray(getState()?.tasks).filter(task => task.payload?.programme_id === id && task.action?.startsWith('compute.programme.'));
  }
  function activeTask(id) { return tasksFor(id).find(task => ['queued', 'running'].includes(task.state)); }
  function named(kind, id) {
    return asArray(catalogue?.[kind]).find(row => row.id === id)?.title || short(id);
  }
  function table(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(item => '<th>' + escapeHTML(item) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function countLine(row) {
    const counts = row.counts || {};
    return printable(counts.complete || 0) + ' / ' + printable(counts.total ?? row.runs?.length ?? 0) +
      ' completed' + (counts.failed ? ' · ' + printable(counts.failed) + ' failed' : '');
  }
  function catalogueHTML() {
    const programmes = asArray(catalogue?.programmes);
    return '<section class="programme-catalogue"><header class="section-header"><div><h2>Saved programmes</h2><p>Each programme retains its grid, selected cases and original native runs.</p></div>' +
      actionButton('refresh', 'Refresh') + '</header>' +
      (programmes.length ? table(['Programme', 'State', 'Progress', 'Updated', ''], programmes.map(row =>
        '<tr' + (selected === row.id ? ' class="programme-selected"' : '') + '><td><strong>' + escapeHTML(row.title) +
        '</strong><small class="mono">' + escapeHTML(short(row.id)) + '</small></td><td>' + stateBadge(row.state) + '</td><td>' +
        escapeHTML(countLine(row)) + '</td><td>' + escapeHTML(row.updated_at ? new Date(row.updated_at).toLocaleString() : '—') +
        '</td><td>' + actionButton('open', 'Open', row.id) + '</td></tr>')) :
        '<div class="empty"><h3>Choose the next calculations</h3><p>Create a programme from prepared inputs or import the expanded selections from the experiment planner.</p>' +
        actionButton('create', 'Create programme') + '</div>') + '</section>';
  }
  function stageText(row) {
    const stages = row.stages || row.stage_summary || {};
    if (Array.isArray(stages)) return stages.map(item => item.name || item.stage || item).join(' · ');
    return Object.entries(stages).map(([name, stage]) => name + (stage?.completed_at ? ' completed' : stage?.state ? ': ' + labelState(stage.state) : stage?.started_at ? ' started' : '')).join(' · ');
  }
  function storageText(storage) {
    if (!storage || typeof storage !== 'object') return '';
    const parts = [];
    if (Number.isFinite(storage.available_bytes) && storage.available_bytes >= 0) {
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let amount = storage.available_bytes, unit = 0;
      while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
      parts.push(amount.toLocaleString(undefined, {maximumFractionDigits: unit ? 2 : 0}) + ' ' + units[unit] + ' available');
    }
    if (Number.isFinite(storage.available_inodes) && storage.available_inodes >= 0) {
      parts.push(storage.available_inodes.toLocaleString() + ' available inodes');
    }
    return parts.join(' · ') || (storage.error?.message ? String(storage.error.message) : '');
  }
  function executionSummary(execution) {
    if (!execution || typeof execution !== 'object') return '';
    const phases = {
      starting: 'Starting native run', log: 'Opening native log',
      verify_stage: 'Checking retained model stage', verify_export: 'Checking retained export',
      grid: 'Opening model grid', runtime: 'Opening model runtime', sources: 'Opening original sources',
      landcover: 'Preparing land cover', stage_identity: 'Resolving model stage',
      waiting_stage: 'Waiting for shared model stage', stage_reuse: 'Reusing model stage',
      validate: 'Validating model inputs', native: 'Calculating native model',
      retain_stage: 'Retaining model outputs', export: 'Writing export raster', complete: 'Native run complete',
    };
    return [
      Number.isInteger(execution.attempt) ? 'Attempt ' + execution.attempt : '',
      execution.model ? String(execution.model).toUpperCase() : '',
      phases[execution.phase] || (execution.phase ? labelState(execution.phase) : ''),
      execution.artifact ? labelState(execution.artifact) : '',
      execution.state && execution.state !== execution.phase ? labelState(execution.state) : '',
    ].filter(Boolean).join(' · ');
  }
  function executionHTML(row) {
    const execution = row.execution, summary = executionSummary(execution);
    const storage = storageText(execution?.storage);
    const checkpoint = execution?.storage_recorded_at || execution?.phase_started_at || execution?.started_at || execution?.updated_at;
    let html = summary ? '<small>' + escapeHTML(summary) + '</small>' : '';
    if (storage) {
      html += '<small>Storage recorded' +
        (checkpoint ? ' · ' + escapeHTML(new Date(checkpoint).toLocaleString()) : '') +
        ': ' + escapeHTML(storage) + '</small>';
    }
    html += failureRecoveryHTML(row.error);
    const history = asArray(row.execution_history);
    if (history.length) {
      html += '<details data-programme-details="' + escapeHTML('execution:' + record.id + ':' + row.key) +
        '"><summary>Previous execution attempts</summary><ul>' + history.map(item => {
          const message = item?.error?.message || (typeof item?.error === 'string' ? item.error : '');
          return '<li>' + escapeHTML(executionSummary(item)) +
            (item?.updated_at ? ' · ' + escapeHTML(new Date(item.updated_at).toLocaleString()) : '') +
            (message ? '<p class="programme-run-error">' + escapeHTML(message) + '</p>' : '') +
            failureRecoveryHTML(item?.error) + '</li>';
        }).join('') + '</ul></details>';
    }
    return html;
  }
  function failureRecoveryHTML(error) {
    let html = '';
    const storage = storageText(error?.storage_at_failure);
    if (storage) {
      const recorded = error?.storage_recorded_at;
      html += '<small>Storage at failure' +
        (recorded ? ' · ' + escapeHTML(new Date(recorded).toLocaleString()) : '') +
        ': ' + escapeHTML(storage) + '</small>';
    }
    if (typeof error?.recovery === 'string' && error.recovery) {
      html += '<p class="programme-run-error">' + escapeHTML(error.recovery) + '</p>';
    }
    return html;
  }
  function ensembleCandidatesHTML(value) {
    const candidates = asArray(value.ensemble_candidates), issues = asArray(value.ensemble_candidate_issues);
    const available = Array.isArray(getState()?.data?.paired_ensemble_products);
    return '<section class="programme-output"><header class="section-header"><div><h3>Paired scenario maps</h3>' +
      '<p>Compare each land-cover alternative with its baseline under the same original parameter profiles.</p></div>' +
      '<a href="/web/paired_ensemble.html">Open all paired results</a></header>' +
      (candidates.length ? table(['Alternative', 'Native models', 'Matched profiles', ''], candidates.map(row =>
        '<tr><td>' + escapeHTML(row.scenario_title || named('scenarios', row.scenario_id)) +
        '</td><td>' + escapeHTML(modelsLabel(row.models)) + '</td><td>' + escapeHTML(row.member_count ?? row.pairs?.length ?? 0) +
        '</td><td>' + actionButton('ensemble', 'Build paired maps', row.id, available ? '' : 'disabled') + '</td></tr>')) :
        '<p class="note">Complete a baseline and alternative under the same parameter profile to build their paired maps. Completed model stages assembled into a combined run enter this workflow directly.</p>') +
      (issues.length ? '<details><summary>Cases needing a completed matching pair (' + issues.length + ')</summary><ul>' +
        issues.map(issue => '<li>' + escapeHTML(typeof issue === 'string' ? issue : issue.message || issue.reason || JSON.stringify(issue)) + '</li>').join('') +
        '</ul></details>' : '') + '</section>';
  }
  async function buildProgrammeEnsemble(candidateId) {
    const requestedWorkspace = workspaceKey(), programmeId = record?.id;
    if (!programmeId) throw new Error('Open the saved programme containing these completed cases.');
    const current = await api(query('detail', {programme_id: programmeId}));
    if (requestedWorkspace !== workspaceKey()) return;
    const candidate = asArray(current.ensemble_candidates).find(row => row.id === candidateId);
    if (!candidate) throw new Error('The completed pair selection changed. Refresh this programme and choose its current paired maps.');
    const initial = candidate.selection;
    if (!initial || !asArray(initial.pairs).length) throw new Error('Complete the original matched native runs for this alternative.');
    let form, wrapper, revision = 0, previewSignature = null;
    const field = name => form.elements.namedItem(name);
    const readSelection = () => {
      if (!form.reportValidity()) throw new Error('Complete the marked ensemble selections.');
      const title = field('programme_ensemble_title').value.trim(), purpose = field('programme_ensemble_purpose').value.trim();
      const values = field('programme_ensemble_quantiles').value.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 100) || new Set(values).size !== values.length) {
        throw new Error('Enter distinct member percentiles from 0 to 100.');
      }
      const pollutants = [...form.querySelectorAll('[name="programme_ensemble_pollutant"]:checked')].map(input => input.value);
      if (!pollutants.length) throw new Error('Choose at least one available native quantity.');
      if (!title || !purpose) throw new Error('Give these paired maps a title and interpretation.');
      return {...initial, title, purpose, pollutants, quantiles: values.map(value => value / 100)};
    };
    const preview = async selection => {
      const requestedRevision = revision, signature = canonical(selection);
      const target = wrapper.querySelector('[data-programme-ensemble-preview]');
      target.textContent = 'Checking the original paired run files and reporting inputs…';
      const result = await api('/api/paired-ensemble/preview', {method: 'POST', body: {workspace: requestedWorkspace, selection}});
      if (requestedWorkspace !== workspaceKey() || requestedRevision !== revision || !wrapper?.isConnected ||
          document.querySelector('#operation-form') !== form || signature !== canonical(readSelection())) {
        throw new Error('The ensemble selection changed. Review the current selection.');
      }
      previewSignature = signature;
      target.innerHTML = '<div class="notice"><strong>' + escapeHTML(result.members) + ' original profile pairs</strong><p>' +
        escapeHTML(asArray(result.pollutants).map(name => name.replaceAll('_', ' ')).join(' · ')) +
        '.</p><p>Maps use cells valid in every selected pair. Positive values mean lower export under the alternative.</p></div>';
      return result;
    };
    const pairs = asArray(initial.pairs);
    openForm('Build paired scenario maps', 'Use the completed programme’s original same-profile baseline and alternative runs.',
      '<div class="programme-form programme-ensemble-form"><div class="form-grid"><label>Product title<input name="programme_ensemble_title" required value="' +
      escapeHTML(initial.title) + '"></label><label>Member percentiles<input name="programme_ensemble_quantiles" required value="' +
      escapeHTML(asArray(initial.quantiles || [.1, .5, .9]).map(value => value * 100).join(', ')) + '"></label></div>' +
      '<label>Purpose and interpretation<textarea name="programme_ensemble_purpose" rows="3" required>' + escapeHTML(initial.purpose) + '</textarea></label>' +
      '<fieldset><legend>Available native quantities</legend><div class="programme-quantity-choices">' +
      asArray(initial.pollutants).map(name => '<label><input type="checkbox" name="programme_ensemble_pollutant" value="' +
        escapeHTML(name) + '" checked> ' + escapeHTML(name.replaceAll('_', ' ')) + '</label>').join('') + '</div></fieldset>' +
      table(['Parameter profile', 'Original baseline run', 'Original alternative run'], pairs.map(pair => '<tr><td>' +
        escapeHTML(named('profiles', pair.profile_id)) + '</td><td class="mono">' + escapeHTML(pair.baseline_run_id) +
        '</td><td class="mono">' + escapeHTML(pair.alternative_run_id) + '</td></tr>')) +
      '<p class="note">These ' + pairs.length + ' profile pairs test the same grid and land-cover contrast. The maps describe the selected parameter members and retain their original source identities.</p>' +
      '<div class="programme-controls"><button type="button" data-programme-ensemble-preview-button>Review original inputs</button></div>' +
      '<div data-programme-ensemble-preview role="status" aria-live="polite"></div></div>',
      'Build paired maps', async () => {
        const selection = readSelection();
        if (previewSignature !== canonical(selection)) await preview(selection);
        if (requestedWorkspace !== workspaceKey() || !wrapper?.isConnected) throw new Error('Reopen this selection in its original workspace.');
        return submitAction('paired_ensemble.build', selection);
      }, () => {
        form = document.querySelector('#operation-form'); wrapper = form.querySelector('.programme-ensemble-form');
        wrapper.addEventListener('input', () => {
          revision++; previewSignature = null;
          wrapper.querySelector('[data-programme-ensemble-preview]').textContent = 'Review the current quantities and percentile selection.';
        });
        wrapper.querySelector('[data-programme-ensemble-preview-button]').addEventListener('click', async event => {
          const button = event.currentTarget; if (button.disabled) return;
          button.disabled = true;
          try { await preview(readSelection()); }
          catch (error) { if (wrapper?.isConnected) wrapper.querySelector('[data-programme-ensemble-preview]').textContent = error.message || String(error); }
          finally { button.disabled = false; }
        });
      });
  }

  function programmeHTML() {
    if (!selected) return '<section class="section"><h2>Original calculations, continued together</h2><p>A programme may contain a single baseline or an expanded list of prepared cases. The existing native engine validates every input and executes each saved selection. Completed model stages remain available when another case needs attention.</p></section>';
    if (!record) return '<section class="section" role="status"><h2>Opening saved programme…</h2></section>';
    const counts = record.counts || {}, rows = asArray(record.runs), task = activeTask(record.id);
    const nativeActive = Boolean(task) || Boolean(record.active) || rows.some(row => row.state === 'running');
    const complete = Number(counts.complete || 0), total = Number(counts.total ?? rows.length);
    const canPause = nativeActive && !record.pause_requested;
    const runRows = rows.map(row => {
      const error = row.error?.message || (typeof row.error === 'string' ? row.error : '');
      const native = row.run_id ? actionButton('native', 'Inspect run', row.run_id) + actionButton('log', 'Log', row.run_id) : '<small>Prepared when executed</small>';
      const sources = ['ndr', 'sdr'].map(model => {
        const id = row.stages?.[model]?.reused_from?.run_id || row.source_runs?.[model];
        return id ? actionButton('native', model.toUpperCase() + ' source', id, 'title="' + escapeHTML(id) + '"') : '';
      }).filter(Boolean).join('');
      return '<tr><td><input type="checkbox" data-programme-run="' + escapeHTML(row.key) + '" aria-label="Select ' +
        escapeHTML(row.title || row.key) + '"' + (subset.has(row.key) ? ' checked' : '') + '></td><td><strong>' +
        escapeHTML(row.title || row.key) + '</strong>' + (row.key === record.selection?.baseline_run ? '<small>Reference case</small>' : '') +
        '<small class="mono">' + escapeHTML(row.key) + '</small></td><td>' + escapeHTML(named('profiles', row.profile_id)) +
        '<small>' + escapeHTML(named('scenarios', row.scenario_id)) + '</small>' +
        '<small>' + escapeHTML(modelsLabel(row.native_selection?.models || row.models)) + '</small>' +
        '<small>' + escapeHTML([Object.keys(row.parameter_changes || {}).length ? 'Parameters changed' : '', row.table_changed ? 'Biophysical table changed' : '', row.scenario_changed ? 'Land cover changed' : ''].filter(Boolean).join(' · ') || 'Reference selections') + '</small></td><td>' + stateBadge(row.state) +
        '<small>' + escapeHTML(stageText(row)) + '</small>' +
        (row.execution_method === 'completed_model_assembly' ? '<small>Finish outputs from completed models</small>' : '') + (error ? '<p class="programme-run-error">' + escapeHTML(error) + '</p>' : '') + executionHTML(row) +
        '</td><td class="mono" title="' + escapeHTML(row.run_id || '') + '">' + escapeHTML(row.run_id ? short(row.run_id) : '—') +
        (sources ? '<div class="programme-source-actions">' + sources + '</div>' : '') + '</td><td><div class="programme-row-actions">' + native + '</div></td></tr>';
    });
    const report = record.latest_report || record.report;
    const files = asArray(record._downloads);
    return '<section class="programme-detail"><header class="section-header"><div><p class="eyebrow">RETAINED CALCULATIONS</p><h2>' +
      escapeHTML(record.title) + '</h2><p>' + escapeHTML(named('grids', record.selection?.grid_id)) + ' · <span class="mono">' +
      escapeHTML(short(record.id)) + '</span></p></div>' + stateBadge(record.state) + '</header>' +
      '<div class="programme-progress"><label for="programme-progress">' + escapeHTML(countLine(record)) + '</label><progress id="programme-progress" value="' +
      complete + '" max="' + Math.max(1, total) + '">' + complete + ' / ' + total + '</progress><p role="status">' +
      escapeHTML(record.pause_requested ? 'Pause requested. The active native run finishes before the next case starts.' :
        record.current_run ? 'Current case: ' + (record.current_run.key || record.current_run) :
        record.phase ? labelState(record.phase) : 'Ready for the next operation.') + '</p></div>' +
      '<div class="programme-controls">' + actionButton('run', complete === total && total ? 'Reconcile saved runs' : 'Continue unfinished runs', record.id, nativeActive ? 'disabled' : '') +
      actionButton('run-selected', 'Run selected cases', record.id, nativeActive ? 'disabled' : '') +
      actionButton('pause', record.pause_requested ? 'Pause requested' : 'Pause after current run', record.id, canPause ? '' : 'disabled') +
      actionButton('report', 'Build result catalogue', record.id, nativeActive ? 'disabled' : '') +
      actionButton('selection', 'Download selections', record.id) + actionButton('clone', 'Copy selections', record.id) +
      (task ? actionButton('task', 'Inspect active operation', task.id) : '') + '</div>' +
      '<p class="note">Resume reuses the original run identities and completed native stages. Selecting cases limits this request; the saved programme retains every case.</p>' +
      table(['Select', 'Case', 'Profile / land cover', 'Native state', 'Target run', ''], runRows) +
      '<div class="programme-controls">' + actionButton('select-pending', 'Select unfinished') + actionButton('clear-selection', 'Clear selection') + '</div>' +
      '<section class="programme-output"><header class="section-header"><div><h3>Result catalogue</h3><p>Open the original quantities, units, geographic coverage and result files retained for these runs.</p></div>' +
      actionButton('open-report', 'Open saved catalogue', record.id, report || files.length ? '' : 'disabled') + '</header>' +
      (files.length ? fileList(files) : '<p class="note">Build the catalogue after a run finishes. Completed cases can be reported while other cases remain in the programme.</p>') + '</section>' +
      ensembleCandidatesHTML(record) +
      '<details class="technical" data-programme-details="' + escapeHTML('selection:' + record.id) + '"><summary>Complete saved selections and provenance</summary><pre class="json-view">' +
      escapeHTML(JSON.stringify(record.selection, null, 2)) + '</pre></details></section>';
  }
  function draw() {
    if (!host) return;
    const preserveScroll = host.scrollTop;
    const expanded = new Set(Array.from(host.querySelectorAll('details[data-programme-details][open]'),
      node => node.dataset.programmeDetails));
    host.innerHTML = '<div class="programme-workbench"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Run programmes</h1><p>Run saved native cases, inspect progress, pause between calculations and continue the same work after reopening.</p></div>' +
      '<div class="page-actions">' + actionButton('create', 'Create programme') + actionButton('import', 'Import selections') +
      (catalogue?.experiments_available ? actionButton('experiment', 'Use saved experiment') : '') +
      '<button type="button" data-view="runs">Native model runs</button></div></header><div class="notice error" data-programme-error role="alert"' +
      (latestError ? '' : ' hidden') + '>' + escapeHTML(latestError) + '</div>' + catalogueHTML() + programmeHTML() +
      '<p class="programme-method">Parameter designs and interpretation use the selected experiment and scientific profile. ' + methodLink + '.</p></div>';
    host.scrollTop = preserveScroll;
    for (const node of host.querySelectorAll('details[data-programme-details]')) {
      node.open = expanded.has(node.dataset.programmeDetails);
    }
  }
  async function refreshRecord() {
    if (!host || loading) return;
    loading = true;
    const requestedWorkspace = workspaceKey(), currentGeneration = ++generation;
    try {
      const nextCatalogue = await api(query('catalog'));
      if (!host || currentGeneration !== generation || requestedWorkspace !== workspaceKey()) return;
      catalogue = nextCatalogue;
      if (selected && !asArray(catalogue.programmes).some(row => row.id === selected)) {
        selected = null; rememberSelection(requestedWorkspace, null); record = null; subset.clear();
      }
      if (selected) {
        const nextRecord = await api(query('detail', {programme_id: selected}));
        if (!host || currentGeneration !== generation || requestedWorkspace !== workspaceKey()) return;
        record = nextRecord;
      }
      draw();
    } catch (error) {
      if (host && requestedWorkspace === workspaceKey()) showError(error);
    } finally { if (currentGeneration === generation) loading = false; }
  }
  function mount(element, state = getState()) {
    const key = state?.workspace_key;
    if (!key) return;
    if (host !== element || currentWorkspace !== key) {
      detach();
      host = element; currentWorkspace = key; selected = rememberedSelection(key);
      catalogue = null; record = null; latestError = ''; subset.clear();
      controller = new AbortController();
      host.addEventListener('click', event => {
        const button = event.target.closest('[data-programme-action]');
        if (!button || button.disabled) return;
        event.preventDefault();
        dispatchLocal(button.dataset.programmeAction, button.dataset.value, button).catch(showError);
      }, {signal: controller.signal});
      host.addEventListener('change', event => {
        const key = event.target.dataset.programmeRun;
        if (!key) return;
        if (event.target.checked) subset.add(key); else subset.delete(key);
      }, {signal: controller.signal});
    }
    draw();
    refreshRecord();
  }
  function detach() {
    generation++;
    controller?.abort(); controller = null;
    host = null; loading = false;
  }
  async function select(id) {
    if (selected !== id) { generation++; loading = false; subset.clear(); record = null; }
    selected = id; rememberSelection(workspaceKey(), id);
    await refreshRecord();
  }
  async function sendAction(action, payload) {
    if (activeRequest) return;
    activeRequest = true;
    const key = workspaceKey(), storageKey = 'upstate-programme-requests:' + key;
    const signature = canonical({action, payload});
    let retained = {};
    try { retained = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch {}
    const operationId = retained[signature] || crypto.randomUUID();
    retained[signature] = operationId;
    sessionStorage.setItem(storageKey, JSON.stringify(retained));
    try {
      const previous = tasksFor(payload.programme_id).find(task => task.action === action &&
        canonical(task.payload) === canonical(payload) && ['failed', 'interrupted', 'cancelled'].includes(task.state));
      const task = previous
        ? await api('/api/task/resume', {method: 'POST', body: {id: previous.id}})
        : await api('/api/actions', {method: 'POST', body: {workspace: key, action, payload, operation_id: operationId}});
      delete retained[signature]; sessionStorage.setItem(storageKey, JSON.stringify(retained));
      await context.refreshState?.({force: true});
      if (workspaceKey() === key) { await refreshRecord(); await showTask(task.id); }
      return task;
    } finally { activeRequest = false; }
  }
  function downloadJSON(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function reportHTML(report) {
    const rows = asArray(report.rows);
    const columns = [
      ['Case', row => row.title || row.run_key || row.key],
      ['Quantity', row => row.pollutant || row.quantity],
      ['Total', row => printable(row.total)],
      ['Units', row => row.units],
      ['Valid cells', row => printable(row.valid_cells)],
      ['Area (ha)', row => printable(row.valid_area_ha ?? row.area_ha)],
      ['Common-area change', row => printable(row.total_change ?? row.common_sum_change ?? row.sum_change)],
      ['Change (%)', row => printable(row.percent_change)],
      ['Comparison cells', row => printable(row.comparison_cells)],
      ['State', row => labelState(row.state)],
      ['Original native run', row => row.native_source_run_id || row.run_id],
    ];
    return '<p>' + escapeHTML(report.title || 'Saved native result catalogue') + '</p>' +
      (rows.length ? table(columns.map(item => item[0]), rows.map(row => '<tr>' + columns.map(([, value]) => '<td>' +
        escapeHTML(value(row) ?? '—') + '</td>').join('') + '</tr>')) : '<p>No completed quantities are present in this saved catalogue.</p>') +
      '<p class="note">Whole-run totals retain each run’s actual valid area. Common-area changes use the original paired comparison. The decision-report workflow provides the full catchment and sensitivity interpretation.</p>' +
      (asArray(report.notes).length ? '<ul>' + report.notes.map(note => '<li>' + escapeHTML(note) + '</li>').join('') + '</ul>' : '') +
      fileList(asArray(report._downloads)) + '<details class="technical"><summary>Complete catalogue</summary><pre class="json-view">' +
      escapeHTML(JSON.stringify(report, null, 2)) + '</pre></details>';
  }
  async function showReport(id) {
    const requestedWorkspace = workspaceKey();
    const report = await api(query('report', {programme_id: id}));
    if (workspaceKey() !== requestedWorkspace) return;
    detail(report.title || 'Saved result catalogue', reportHTML(report), {kind: 'programme-report', id});
  }
  async function showLog(id) {
    const requestedWorkspace = workspaceKey();
    const data = await api(endpoint('/api/run-log', {id, offset: 0}));
    if (workspaceKey() !== requestedWorkspace) return;
    detail('Native model log', '<p>Original retained output for run <span class="mono">' + escapeHTML(short(id)) +
      '</span>.</p><pre class="logs">' + escapeHTML(data.text || 'The selected run has no native log output yet.') + '</pre>' +
      '<p class="note">Open the native run for continued log inspection and its complete artifact list.</p>', {kind: 'programme-log', id});
  }

  function choicesHTML(rows, selected) {
    const options = asArray(rows).map(row => option(row, selected)).join('');
    return selected && !asArray(rows).some(row => row.id === selected)
      ? '<option value="' + escapeHTML(selected) + '" selected>Unavailable: ' + escapeHTML(short(selected)) + '</option>' + options : options;
  }
  function nativeModels(value) {
    return Array.isArray(value) ? ['ndr', 'sdr'].filter(model => value.includes(model)) : ['ndr', 'sdr'];
  }
  function modelsLabel(value) { return nativeModels(value).map(model => model.toUpperCase()).join(' + '); }
  function sourceLabel(row) {
    return [row.profile_title || short(row.profile_id), row.scenario_title || short(row.scenario_id),
      row.stage_completed_at ? 'stage completed ' + new Date(row.stage_completed_at).toLocaleString() : 'completed stage'].join(' · ');
  }
  function rowHTML(row, index, baseline, available) {
    const chosen = Array.isArray(row.models) ? nativeModels(row.models).join(',') : '';
    const reuse = Boolean(row.source_runs);
    return '<tr data-programme-form-row="' + index + '"><td><input type="radio" name="programme_baseline" value="' + index +
      '" aria-label="Use this case as reference"' + (baseline ? ' checked' : '') + ' required></td><td><label><span class="sr-only">Case key</span><input data-field="key" value="' +
      escapeHTML(row.key || 'case-' + (index + 1)) + '" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"></label>' +
      '<label><span class="sr-only">Case title</span><input data-field="title" value="' + escapeHTML(row.title || 'Case ' + (index + 1)) + '" required></label></td>' +
      '<td><label>Parameter profile<select data-field="profile_id" required>' +
      choicesHTML(available.profiles, row.profile_id) + '</select></label><label>Land-cover case<select data-field="scenario_id" required>' +
      choicesHTML(available.scenarios, row.scenario_id) + '</select></label>' +
      '<label>Native models<select data-field="models">' + [['', 'Use grid models'], ['ndr', 'NDR'], ['sdr', 'SDR'], ['ndr,sdr', 'NDR + SDR']].map(([value, title]) =>
        '<option value="' + value + '"' + (chosen === value ? ' selected' : '') + '>' + title + '</option>').join('') +
      '</select></label><small data-programme-model-summary></small></td>' +
      '<td class="programme-execution"><label>Calculation method<select data-field="execution_method">' +
      '<option value="native"' + (!reuse ? ' selected' : '') + '>Run selected models</option>' +
      '<option value="assembly"' + (reuse ? ' selected' : '') + '>Reuse completed NDR and SDR</option></select></label>' +
      '<div class="programme-source-controls" data-programme-source-controls' + (reuse ? '' : ' hidden') + '>' +
      ['ndr', 'sdr'].map(model => '<label>Completed ' + model.toUpperCase() + ' source<input data-field="source_' + model +
        '" list="programme-completed-' + model + '" autocomplete="off" spellcheck="false" value="' +
        escapeHTML(row.source_runs?.[model] || '') + '" placeholder="Choose or paste the original run ID"></label>' +
        '<small data-programme-source-summary="' + model + '"></small>').join('') +
      '<p class="note">Input matching happens when the programme runs. The completed model stages can come from separate grid and profile records with matching native inputs.</p></div>' +
      '<small data-programme-execution-summary></small></td>' +
      '<td><button type="button" data-programme-form-action="remove">Remove</button></td></tr>';
  }
  function previewHTML(result) {
    const rows = asArray(result.runs);
    const sources = row => ['ndr', 'sdr'].map(model => {
      const id = row.source_stages?.[model]?.run_id || row.source_runs?.[model];
      return id ? model.toUpperCase() + ': ' + id : '';
    }).filter(Boolean).join(' · ');
    return '<div class="notice"><strong>' + escapeHTML(result.run_count ?? rows.length) +
      ' named cases</strong><p>' + escapeHTML(result.unique_run_count ?? result.run_count ?? rows.length) +
      ' distinct native selections.</p></div>' +
      table(['Case', 'Models', 'Calculation method', 'Completed source runs'], rows.map(row => '<tr><td>' +
        escapeHTML(row.title || row.key) + '</td><td>' + escapeHTML(modelsLabel(row.native_selection?.models || row.models)) +
        '</td><td>' + escapeHTML(row.existing && row.state === 'complete' ? 'Reuse completed target run' : row.execution_method === 'completed_model_assembly'
          ? 'Finish outputs from completed models' : 'Run selected models') +
        '</td><td class="mono">' + escapeHTML(sources(row) || 'Selected native run and compatible cached stages') + '</td></tr>')) +
      '<p class="note">Completed source selection retains the original model stages. The native assembler matches their actual inputs to the selected target before preparing reporting outputs.</p>';
  }
  async function createForm(copy) {
    const requestedWorkspace = workspaceKey();
    const available = await api(query('catalog', {include_sources: '1'}));
    if (requestedWorkspace !== workspaceKey()) return;
    const grids = asArray(available.grids).filter(row => row.state === 'complete');
    const profiles = asArray(available.profiles), scenarios = asArray(available.scenarios);
    if (!grids.length || !profiles.length || !scenarios.length) {
      detail('Prepare the calculation inputs', '<p>A run programme selects an existing completed model grid, a saved parameter profile and a saved land-cover case.</p>' +
        '<div class="page-actions"><button type="button" data-action="programme-view" data-target="sources">Original sources</button><button type="button" data-action="programme-view" data-target="grids">Model grids</button><button type="button" data-action="programme-view" data-target="profiles">Parameter profiles</button><button type="button" data-action="programme-view" data-target="scenarios">Land-cover scenarios</button></div>',
        {kind: 'programme-inputs'}); return;
    }
    const defaultProfile = gridId => {
      const models = nativeModels(grids.find(row => row.id === gridId)?.models);
      return (profiles.find(row => models.every(model => nativeModels(row.models).includes(model))) || profiles[0]).id;
    };
    const initial = copy?.selection || {title: '', grid_id: grids[0].id, runs: [{key: 'baseline', title: 'Baseline',
      profile_id: defaultProfile(grids[0].id), scenario_id: scenarios[0].id}], baseline_run: 'baseline'};
    const originals = new Map(asArray(initial.runs).map((row, index) => [String(index), row]));
    const completed = Object.fromEntries(['ndr', 'sdr'].map(model =>
      [model, new Map(asArray(available.completed_model_runs?.[model]).map(row => [row.run_id, row]))]));
    let serial = asArray(initial.runs).length, form, formRoot, revision = 0;
    const field = name => form.elements.namedItem(name);
    const rowField = (row, name) => row.querySelector('[data-field="' + name + '"]');
    const effectiveModels = row => {
      const explicit = rowField(row, 'models').value;
      return explicit ? explicit.split(',') : nativeModels(grids.find(item => item.id === field('programme_grid').value)?.models);
    };
    const syncRow = row => {
      const grid = grids.find(item => item.id === field('programme_grid').value);
      const profile = profiles.find(item => item.id === rowField(row, 'profile_id').value);
      const scope = effectiveModels(row), modelField = rowField(row, 'models');
      const supported = scope.length && scope.every(model => nativeModels(grid?.models).includes(model) && nativeModels(profile?.models).includes(model));
      modelField.setCustomValidity(!supported ? 'Choose models available in both the selected grid and parameter profile.' :
        modelField.value && !available.model_selection_available ? 'This application edition uses the grid models. Select Use grid models.' : '');
      rowField(row, 'profile_id').setCustomValidity(profile ? '' : 'Choose a retained parameter profile.');
      rowField(row, 'scenario_id').setCustomValidity(scenarios.some(item => item.id === rowField(row, 'scenario_id').value) ? '' : 'Choose a retained land-cover scenario.');
      row.querySelector('[data-programme-model-summary]').textContent = 'Selected calculation: ' + modelsLabel(scope) +
        '. Grid: ' + modelsLabel(grid?.models) + '. Profile: ' + modelsLabel(profile?.models) + '.';
      const method = rowField(row, 'execution_method'), reuse = method.value === 'assembly';
      const canAssemble = Boolean(available.completed_model_assembly_available) && scope.length === 2 && supported;
      method.querySelector('[value="assembly"]').disabled = !canAssemble;
      method.setCustomValidity(reuse && !canAssemble ? 'Completed NDR and SDR reuse requires both models on a compatible full grid and parameter profile.' : '');
      row.querySelector('[data-programme-source-controls]').hidden = !reuse;
      for (const model of ['ndr', 'sdr']) {
        const input = rowField(row, 'source_' + model), source = completed[model].get(input.value.trim());
        input.disabled = !reuse; input.required = reuse;
        input.setCustomValidity(reuse && input.value.trim() && !source ? 'Choose a run with an original completed ' + model.toUpperCase() + ' stage in this workspace.' : '');
        row.querySelector('[data-programme-source-summary="' + model + '"]').textContent = source ? sourceLabel(source) :
          input.value.trim() ? 'This run is absent from the current completed-stage catalogue.' : completed[model].size +
          ' completed ' + model.toUpperCase() + ' stages available.';
      }
      row.querySelector('[data-programme-execution-summary]').textContent = reuse
        ? 'Finish outputs from completed models.' : 'Compatible completed stages are reused automatically.';
    };
    const syncForm = () => {
      field('programme_grid').setCustomValidity(grids.some(row => row.id === field('programme_grid').value) ? '' : 'Choose a retained completed grid.');
      const rows = [...form.querySelectorAll('[data-programme-form-row]')], counts = new Map();
      for (const row of rows) { const key = rowField(row, 'key').value.trim(); counts.set(key, (counts.get(key) || 0) + 1); }
      for (const row of rows) {
        rowField(row, 'key').setCustomValidity(counts.get(rowField(row, 'key').value.trim()) > 1 ? 'Give each case a distinct key.' : '');
        syncRow(row);
      }
    };
    const readSelection = () => {
      syncForm();
      if (!form.reportValidity()) throw new Error('Complete the marked programme selections.');
      const selection = {
        schema: 'upstate.compute-programme-selection/v1', title: field('programme_title').value.trim(),
        grid_id: field('programme_grid').value, runs: [], baseline_run: '',
      };
      for (const element of form.querySelectorAll('[data-programme-form-row]')) {
        const original = originals.get(element.dataset.programmeFormRow) || {}, row = {};
        for (const name of ['key', 'title', 'profile_id', 'scenario_id']) row[name] = rowField(element, name).value.trim();
        const scope = rowField(element, 'models').value;
        if (scope) row.models = scope.split(',');
        if (rowField(element, 'execution_method').value === 'assembly') {
          row.source_runs = Object.fromEntries(['ndr', 'sdr'].map(model => [model, rowField(element, 'source_' + model).value.trim()]));
        }
        const originalGrid = grids.find(item => item.id === initial.grid_id);
        if (selection.grid_id === initial.grid_id && row.profile_id === original.profile_id && row.scenario_id === original.scenario_id &&
            canonical(effectiveModels(element)) === canonical(nativeModels(original.models || originalGrid?.models))) {
          for (const name of ['reason', 'experiment_key', 'changes']) if (original[name] !== undefined) row[name] = original[name];
        }
        selection.runs.push(row);
        if (element.querySelector('input[type="radio"]').checked) selection.baseline_run = row.key;
      }
      const source = field('programme_source').value.trim(), description = field('programme_description').value.trim();
      if (source) selection.source_reference = source;
      if (description) selection.description = description;
      if (!selection.runs.length) throw new Error('Add at least one prepared case.');
      if (!selection.baseline_run) throw new Error('Choose the reference case.');
      return selection;
    };
    const invalidate = () => {
      revision++;
      form.querySelector('[data-programme-preview]').textContent = 'Review the current cases before saving.';
    };
    const isCopy = Boolean(copy?.id);
    const datalists = ['ndr', 'sdr'].map(model => '<datalist id="programme-completed-' + model + '">' +
      [...completed[model].values()].map(row => '<option value="' + escapeHTML(row.run_id) + '" label="' +
        escapeHTML(sourceLabel(row)) + '"></option>').join('') + '</datalist>').join('');
    openForm(isCopy ? 'Copy saved programme selections' : 'Create a run programme',
      'Group prepared cases, select their native models and continue useful completed calculations.',
      '<div class="programme-form">' + datalists + '<div class="form-grid"><label>Programme title<input name="programme_title" value="' +
      escapeHTML(isCopy ? initial.title + ' — copy' : initial.title) +
      '" required></label><label>Completed model grid<select name="programme_grid" required>' +
      choicesHTML(grids, initial.grid_id) + '</select></label></div>' +
      '<label>Purpose and interpretation<textarea name="programme_description" rows="2">' + escapeHTML(initial.description || '') + '</textarea></label>' +
      '<label>Source or experiment reference<input name="programme_source" value="' + escapeHTML(initial.source_reference || '') +
      '" placeholder="Saved experiment identifier, source citation or work-order reference"></label>' +
      '<p class="note">Select NDR, SDR or both for each case. Reuse completed NDR and SDR to finish a combined result from existing native stages.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Case key / title</th><th>Prepared inputs</th><th>Calculation and completed sources</th><th></th></tr></thead><tbody data-programme-form-rows>' +
      asArray(initial.runs).map((row, index) => rowHTML(row, index, row.key === initial.baseline_run, available)).join('') + '</tbody></table></div>' +
      (asArray(available.completed_model_run_errors).length ? '<details><summary>Unavailable source records (' +
        available.completed_model_run_errors.length + ')</summary><ul>' + available.completed_model_run_errors.map(row => '<li><span class="mono">' +
          escapeHTML(row.run_id) + '</span>: ' + escapeHTML(row.error?.message || 'Open this native run to inspect its retained record.') + '</li>').join('') + '</ul></details>' : '') +
      '<div class="programme-controls"><button type="button" data-programme-form-action="add">Add prepared case</button><button type="button" data-programme-form-action="preview">Review planned runs</button></div>' +
      '<div data-programme-preview role="status" aria-live="polite"></div></div>',
      'Save programme', async () => {
        const selection = readSelection(), current = revision;
        const preview = await api('/api/programmes/preview', {method: 'POST', body: {workspace: requestedWorkspace, selection}});
        if (requestedWorkspace !== workspaceKey() || current !== revision || document.querySelector('#operation-form') !== form || !formRoot?.isConnected ||
            canonical(selection) !== canonical(readSelection())) throw new Error('Programme selections changed. Save the current selections again.');
        return submitAction('compute.programme.save', {selection: preview.selection});
      }, () => {
        form = document.querySelector('#operation-form');
        const wrapper = form.querySelector('.programme-form'); formRoot = wrapper;
        syncForm();
        wrapper.addEventListener('input', event => {
          invalidate();
          const row = event.target.closest('[data-programme-form-row]');
          if (event.target.name === 'programme_grid' || event.target.dataset.field === 'key') syncForm(); else if (row) syncRow(row);
        });
        wrapper.addEventListener('change', event => {
          invalidate();
          const row = event.target.closest('[data-programme-form-row]');
          if (event.target.name === 'programme_grid' || event.target.dataset.field === 'key') syncForm(); else if (row) syncRow(row);
        });
        wrapper.addEventListener('click', async event => {
          const button = event.target.closest('[data-programme-form-action]'); if (!button || button.disabled) return;
          const action = button.dataset.programmeFormAction, preview = form.querySelector('[data-programme-preview]');
          let requestRevision = revision;
          try {
            if (action === 'add') {
              form.querySelector('[data-programme-form-rows]').insertAdjacentHTML('beforeend',
                rowHTML({profile_id: defaultProfile(field('programme_grid').value), scenario_id: scenarios[0].id}, serial++, false, available));
              if (!form.querySelector('[name="programme_baseline"]:checked')) form.querySelector('[name="programme_baseline"]').checked = true;
              invalidate(); syncForm();
            }
            if (action === 'remove') {
              const row = button.closest('[data-programme-form-row]'), baseline = row.querySelector('input[type="radio"]').checked;
              row.remove();
              if (baseline) { const first = form.querySelector('[data-programme-form-row] input[type="radio"]'); if (first) first.checked = true; }
              invalidate(); syncForm();
            }
            if (action === 'preview') {
              const selection = readSelection(); requestRevision = revision;
              button.disabled = true; preview.textContent = 'Checking the retained selections and original completed stages…';
              const result = await api('/api/programmes/preview', {method: 'POST', body: {workspace: requestedWorkspace, selection}});
              if (requestRevision !== revision || requestedWorkspace !== workspaceKey() || !formRoot?.isConnected || !form.contains(preview) ||
                  document.querySelector('#operation-form') !== form) return;
              preview.innerHTML = previewHTML(result);
            }
          } catch (error) {
            if (requestRevision === revision && formRoot?.isConnected && document.querySelector('#operation-form') === form) preview.textContent = error.message || String(error);
          } finally { button.disabled = false; }
        });
      });
  }

  async function fromExperiment(experimentId) {
    const requestedWorkspace = workspaceKey();
    const available = await api(query('catalog'));
    if (workspaceKey() !== requestedWorkspace) return;
    const experiments = asArray(available.experiments).filter(row => row.state !== 'unavailable');
    if (!experiments.length) {
      detail('Prepare an experiment', '<p>Save an experiment in this workspace to create its complete native run programme. The saved design retains the profiles, cases and comparison pairs that the programme will execute.</p>', {kind: 'programme-experiment'});
      return;
    }
    if (experimentId && !experiments.some(row => row.id === experimentId)) throw new Error('The saved experiment is absent from this workspace.');
    let form, requestGeneration = 0;
    const preview = async () => {
      const request = ++requestGeneration, key = form.elements.namedItem('programme_experiment').value;
      const target = form.querySelector('[data-experiment-programme-preview]');
      target.textContent = 'Opening the prepared cases…';
      try {
        const result = await api('/api/programmes/experiment-preview', {method: 'POST',
          body: {workspace: workspaceKey(), experiment_id: key, offset: 0, limit: 100}});
        if (request !== requestGeneration || requestedWorkspace !== workspaceKey() || !form.isConnected) return;
        target.innerHTML = '<p><strong>' + escapeHTML(result.counts.cases) + ' prepared cases</strong> across ' +
          escapeHTML(result.counts.profiles) + ' profiles. Saving materializes the exact profiles and native run selections.</p>' +
          table(['Prepared case', 'Kind', 'Profile', 'Land-cover case'], asArray(result.cases).map(row =>
            '<tr><td>' + escapeHTML(row.title) + '</td><td>' + escapeHTML(row.kind) + '</td><td class="mono">' +
            escapeHTML(short(row.profile_id)) + '</td><td class="mono">' + escapeHTML(short(row.scenario_id)) + '</td></tr>')) +
          (result.next_offset !== null ? '<p>The first ' + result.cases.length + ' cases are shown. All ' + result.counts.cases + ' saved cases are included in the programme.</p>' : '') +
          '<p class="note">The programme compares against the original reference. Each case also retains the experiment’s paired baseline for the scientific comparison workflow.</p>';
      } catch (error) { if (request === requestGeneration) target.textContent = error.message || String(error); }
    };
    openForm('Create programme from a saved experiment',
      'Continue the existing experiment design through the shared native operator.',
      '<div class="programme-form"><label>Saved experiment<select name="programme_experiment" required>' +
      experiments.map(row => option(row, experimentId || experiments[0].id)).join('') +
      '</select></label><div data-experiment-programme-preview role="status"></div></div>',
      'Save complete programme',
      async () => submitAction('compute.programme.experiment', {experiment_id: form.elements.namedItem('programme_experiment').value}),
      () => { form = document.querySelector('#operation-form'); form.elements.namedItem('programme_experiment').addEventListener('change', preview); preview(); });
  }

  function importForm() {
    let form, selection = null;
    openForm('Import expanded programme selections',
      'Use a saved programme JSON or the expanded case list from the experiment planner. The programme refers to inputs already retained in this workspace.',
      '<div class="programme-form"><label>Programme JSON file<input type="file" name="programme_file" accept=".json,application/json" required></label>' +
      '<div data-programme-import-summary role="status">Choose the complete selection file.</div></div>',
      'Validate and save programme', async () => {
        if (!selection) throw new Error('Choose a readable programme JSON file.');
        const preview = await api('/api/programmes/preview', {method: 'POST', body: {workspace: workspaceKey(), selection}});
        return submitAction('compute.programme.save', {selection: preview.selection});
      }, () => {
        form = document.querySelector('#operation-form');
        form.elements.namedItem('programme_file').addEventListener('change', async event => {
          selection = null; const summary = form.querySelector('[data-programme-import-summary]');
          try {
            const file = event.target.files[0]; if (!file) return;
            if (file.size > 3 * 1024 * 1024) throw new Error('This JSON exceeds the operator request size. Import its selections in the native CLI.');
            const value = JSON.parse(await file.text()); selection = value.selection || value;
            if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('The selected file must contain a programme selection object.');
            const preview = await api('/api/programmes/preview', {method: 'POST', body: {workspace: workspaceKey(), selection}});
            selection = preview.selection;
            summary.textContent = (selection.title || 'Programme') + ': ' + (preview.run_count ?? preview.runs?.length ?? 0) +
              ' named cases on the retained model grid. ' + (preview.unique_run_count ?? preview.run_count ?? preview.runs?.length ?? 0) + ' distinct native selections.';
          } catch (error) { selection = null; summary.textContent = error.message || String(error); }
        });
      });
  }
  async function dispatchLocal(action, value) {
    clearError();
    if (action === 'refresh') return refreshRecord();
    if (action === 'open') return select(value);
    if (action === 'create') return createForm();
    if (action === 'import') return importForm();
    if (action === 'experiment') return fromExperiment();
    if (action === 'clone') return createForm(record);
    if (action === 'ensemble') return buildProgrammeEnsemble(value);
    if (action === 'select-pending') { subset = new Set(asArray(record?.runs).filter(row => row.state !== 'complete').map(row => row.key)); draw(); return; }
    if (action === 'clear-selection') { subset.clear(); draw(); return; }
    if (action === 'native') return openItem('runs', value);
    if (action === 'log') return showLog(value);
    if (action === 'task') return showTask(value);
    if (action === 'selection') return downloadJSON(record.selection, 'programme-' + short(record.id) + '.json');
    if (action === 'open-report') return showReport(value);
    if (action === 'report') return sendAction('compute.programme.report', {programme_id: value});
    if (action === 'run') return sendAction('compute.programme.run', {programme_id: value});
    if (action === 'run-selected') {
      if (!subset.size) throw new Error('Select at least one case to continue.');
      return sendAction('compute.programme.run', {programme_id: value, only_runs: [...subset].sort()});
    }
    if (action === 'pause') {
      await api('/api/programmes/pause', {method: 'POST', body: {workspace: workspaceKey(), programme_id: value}});
      toast('Pause requested. The active native run finishes before the next case.'); return refreshRecord();
    }
  }
  async function open(id) {
    if (id) { selected = id; rememberSelection(workspaceKey(), id); record = null; subset.clear(); }
    context.closeDetail?.();
    await context.navigate?.('programmes');
    if (host) await refreshRecord();
  }
  async function dispatch(button) {
    if (button.dataset.action === 'programme-view') { context.closeDetail?.(); return context.navigate?.(button.dataset.target); }
    if (button.dataset.action === 'programme-open') return open(button.dataset.id);
    if (button.dataset.action === 'programme-create') return createForm();
    if (button.dataset.action === 'programme-import') return importForm();
  }
  function taskActions(task) {
    const row = task.programme || (task.action === 'compute.programme.save' ? task.result : null);
    const id = row?.id || task.payload?.programme_id;
    if (!task.action?.startsWith('compute.programme.') || !id) return '';
    return '<div class="notice"><strong>' + escapeHTML(row?.title || 'Saved run programme') + '</strong><p>' +
      escapeHTML(row ? labelState(row.state) + ' · ' + countLine(row) : 'The original programme retains each native result and its continuation state.') +
      '</p><button type="button" data-action="programme-open" data-id="' + escapeHTML(id) + '">Open run programme</button></div>';
  }
  function completionMessage(task) {
    if (task.action !== 'compute.programme.run') return '';
    const result = task.result || {}, counts = result.counts || {};
    return 'Programme ' + labelState(result.state) + ': ' + (counts.complete || 0) + ' / ' + (counts.total || 0) + ' runs completed.';
  }
  return {mount, detach, open, dispatch, taskActions, completionMessage, refresh: refreshRecord, create: createForm, fromExperiment, importSelections: importForm};
}
