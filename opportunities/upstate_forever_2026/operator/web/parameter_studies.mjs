import {attachParameterCaseConsole} from './parameter_case_console.mjs';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const format = value => value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 7}) : escapeHTML(value);
const short = value => String(value || '').slice(0, 12);
const label = value => String(value || '').replaceAll('_', ' ').replaceAll('.', ' · ');
const status = value => '<span class="status ' + escapeHTML(value) + '">' + escapeHTML(label(value)) + '</span>';
const button = (action, text, attributes = '', primary = false) => '<button type="button" data-action="parameter-study-' + action + '" ' + attributes + (primary ? ' class="primary"' : '') + '>' + escapeHTML(text) + '</button>';
const option = (value, text, selected = false) => '<option value="' + escapeHTML(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHTML(text) + '</option>';
const field = (name, text, value = '', options = '') => '<label><span>' + escapeHTML(text) + '</span><input name="' + name + '" value="' + escapeHTML(value) + '" ' + options + '></label>';
const textarea = (name, text, value = '', options = '') => '<label><span>' + escapeHTML(text) + '</span><textarea name="' + name + '" ' + options + '>' + escapeHTML(value) + '</textarea></label>';
const gridTable = (headings, rows) => '<div class="table-scroll"><table><thead><tr>' + headings.map(text => '<th scope="col">' + escapeHTML(text) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
const pretty = value => JSON.stringify(value, null, 2);
const references = value => (Array.isArray(value) ? value : [value]).filter(Boolean);
const modelNames = selection => (selection?.models || ['ndr', 'sdr']).map(value => String(value).toUpperCase()).join(' + ');
const readLines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);


function nativeFailureMarkup(error) {
  if (!error) return '';
  const message = '<div class="notice error">' + escapeHTML(error.message || error) + '</div>';
  if (error.kind !== 'native_process_interrupted') return message;
  const delta = error.memory_events?.delta || {};
  const local = delta['memory.events.local'] || delta['memory.events'];
  const observed = error.memory_events?.state === 'observed';
  const rows = [
    ['Native run', error.run_id || '—'],
    ['Process exit', Number.isInteger(error.return_code) ? error.return_code : 'Unavailable after reconnection'],
    ['Signal', error.signal?.name || 'Not observed'],
    ['Process ID', error.process?.pid ?? '—'],
    ['Shared-group OOM kills during this attempt', observed ? (local?.oom_kill ?? 'Not recorded') : 'Not observed'],
    ['Original request', error.process?.request_sha256 || '—'],
  ];
  return message + '<p class="note">' + escapeHTML(error.recovery || '') + '</p>' +
    '<details class="technical"><summary>Original process interruption</summary>' +
    '<dl class="definition">' + rows.map(([name, value]) =>
      '<dt>' + escapeHTML(name) + '</dt><dd class="mono" style="overflow-wrap:anywhere">' +
      escapeHTML(value) + '</dd>').join('') + '</dl>' +
    '<p>Group counters include other processes. They record a shared-group event, without identifying its victim.</p>' +
    '<pre>' + escapeHTML(pretty({process: error.process, memory_events: error.memory_events,
      resources_before: error.resources_before, resources_after: error.resources_after})) + '</pre></details>';
}

function versionRows(bindings, labels = {}, guides = {}) {
  const rows = [];
  for (const [runId, models] of Object.entries(bindings || {})) {
    for (const [model, info] of Object.entries(models || {})) {
      if (!info || typeof info !== 'object') continue;
      const basis = {completed_stage_runtime: 'Completed native stage', observed_run_fallback: 'Observed run metadata',
        requested_legacy: 'Requested version (legacy)', unavailable: 'Unavailable'}[info.basis] || info.basis || 'Not recorded';
      const reused = info.reused_from;
      const guide = guides[runId]?.[model];
      const documentation = typeof guide === 'string' && /^https?:\/\//i.test(guide) ?
        '<a href="' + escapeHTML(guide) + '" target="_blank" rel="noopener noreferrer">Model guide</a>' : '';
      rows.push('<tr><td class="mono" style="overflow-wrap:anywhere">' + escapeHTML(runId) +
        '</td><td>' + escapeHTML(String(model).toUpperCase()) + '</td><td>' +
        escapeHTML(info.comparison_version || 'Unavailable') + '<small>' +
        escapeHTML(labels[runId]?.[model] || basis) + '</small>' + documentation + '</td><td>' +
        escapeHTML(info.requested_version || 'Not recorded') + '</td><td>' +
        escapeHTML(info.stage_completed_at || 'Not recorded') + '</td><td class="mono" style="overflow-wrap:anywhere">' +
        escapeHTML(reused?.run_id ? reused.run_id + ' / ' + (reused.model || model) : '—') + '</td></tr>');
    }
  }
  return rows;
}

function baselineExecution(item) {
  const rows = versionRows({Baseline: item?.baseline_native_versions || {}},
    {Baseline: item?.baseline_version_labels || {}});
  return rows.length ? '<details class="technical"><summary>Retained baseline execution</summary>' +
    gridTable(['Run', 'Model', 'Recorded version and source', 'Requested version', 'Stage completed', 'Reused origin'], rows) +
    '</details>' : '<p class="note">The retained baseline has no per-model execution record available in this view.</p>';
}

function resultExecution(result) {
  const cohort = result.native_versions;
  if (!cohort?.runs) return '<p class="note">This saved result has no per-model execution provenance. Its original run selections remain in the full results JSON.</p>';
  const rows = versionRows(cohort.runs, result.native_version_labels, result.native_version_guides);
  const versions = Object.entries(cohort.versions || {}).map(([model, version]) =>
    escapeHTML(model.toUpperCase()) + ' ' + escapeHTML(version)).join(' · ');
  return '<details class="technical"><summary>Executed model versions · ' + versions + '</summary>' +
    '<p>Each selected model has a consistent comparison version across the compared cases. The source label distinguishes completed-stage execution, observed-run metadata and requested legacy versions.</p>' +
    gridTable(['Run', 'Model', 'Recorded version and source', 'Requested version', 'Stage completed', 'Reused origin'], rows.slice(0, 200)) +
    (rows.length > 200 ? '<p>Showing 200 of ' + format(rows.length) + ' run/model rows.</p>' : '') +
    '<p>The native-version CSV/JSON downloads below retain every run/model record and nested stage-reuse history.</p></details>';
}

function calibrationExecution(row) {
  const runId = row.run_id || 'Retained candidate';
  const versions = versionRows({[runId]: row.native_versions || {}},
    {[runId]: row.native_version_labels || {}});
  const mass = Object.entries(row.output_mass_basis || {}).map(([parameter, basis]) => {
    const guide = typeof basis.source_guide === 'string' && /^https?:\/\//i.test(basis.source_guide) ?
      '<a href="' + escapeHTML(basis.source_guide) + '" target="_blank" rel="noopener noreferrer">Source guide</a>' : '';
    return '<tr><td>' + escapeHTML(label(parameter)) + '</td><td>' +
      escapeHTML(String(basis.model || '').toUpperCase()) + '</td><td>' +
      escapeHTML(basis.raster_units || 'Not recorded') + '</td><td>' +
      escapeHTML(basis.annual_units || 'Not recorded') + '</td><td>' +
      escapeHTML(basis.reduction || 'Not recorded') + '<small>' +
      escapeHTML(basis.unit_basis || '') + '</small></td><td>' +
      escapeHTML(basis.version_basis || 'Not recorded') +
      (basis.legacy_requested_version === true ? '<small>Requested legacy version</small>' : '') +
      (basis.version_supported === false ? '<small>Version is outside the retained unit contract</small>' : '') +
      guide + '</td></tr>';
  });
  if (!versions.length && !mass.length && !row.execution_fingerprint) {
    return '<p class="note">Execution details are unavailable for this retained candidate.</p>';
  }
  return '<details class="technical"><summary>Retained execution and quantity basis</summary>' +
    (versions.length ? gridTable(['Original run', 'Model', 'Recorded version and source',
      'Requested version', 'Stage completed', 'Reused origin'], versions) : '') +
    (mass.length ? gridTable(['Quantity', 'Model', 'Native raster units', 'Annual quantity units',
      'Reduction and unit basis', 'Version basis and source'], mass) : '') +
    (row.execution_fingerprint ? '<p>Execution fingerprint <code style="overflow-wrap:anywhere">' +
      escapeHTML(row.execution_fingerprint) + '</code></p>' : '') +
    '<p class="note">These fields come from the retained calibration candidate. Objective weights and cross-candidate compatibility are reviewed in the calibration selection.</p></details>';
}

function aggregationProgress(item) {
  const value = item?.aggregation_progress || item?.aggregation;
  if (!value) return '';
  const phase = value.phase || 'preparing';
  const active = (item.cases || []).find(row => row.id === value.active_case_id);
  const details = [
    format(value.completed_pairs || 0) + ' / ' + format(value.total_pairs || 0) + ' case–pollutant pairs',
    format(value.reused_pairs || 0) + ' retained pairs reused',
    format(value.resumed_pairs || 0) + ' pairs continued from saved raster windows'
  ];
  const windowProgress = Number.isInteger(value.total_windows) && value.total_windows > 0 &&
    Number.isInteger(value.windows_completed) && value.windows_completed >= 0 && phase === 'aggregating' ?
    '<p>Original raster windows: ' + format(value.windows_completed) + ' / ' + format(value.total_windows) +
    '</p><progress max="' + escapeHTML(value.total_windows) + '" value="' +
    escapeHTML(value.windows_completed) + '" aria-label="Paired raster windows complete"></progress>' : '';
  return '<div class="note" data-parameter-study-aggregation><strong>Paired result aggregation · ' +
    escapeHTML(label(phase)) + '</strong><p>' + details.join(' · ') + '</p>' +
    (value.active_case_id ? '<p>' + escapeHTML(active?.label || short(value.active_case_id)) +
      ' · ' + escapeHTML(label(value.active_pollutant || '')) + '</p>' : '') +
    windowProgress + '<small>Each retained result keeps its original input bytes, reporting areas, units and spatial support.</small></div>';
}

/** Explicit entry only: numbers and native flow-direction choices have no inferred defaults. */
export function parseParameterStudyValues(text) {
  const tokens = String(text || '').split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean);
  if (!tokens.length) throw new Error('Enter the explicit values to evaluate for every parameter axis.');
  return tokens.map(token => {
    if (token === 'mfd' || token === 'd8') return token;
    let value;
    try { value = JSON.parse(token); } catch { throw new Error('Use finite numbers, mfd, or d8 for parameter values.'); }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === 'mfd' || value === 'd8') return value;
    throw new Error('Use finite numbers, mfd, or d8 for parameter values.');
  });
}

export function attachParameterStudies(host) {
  const caseConsole = attachParameterCaseConsole(host);
  let root = null, controller = null, selected = null, currentWorkspace = null, pendingOpen = null;
  let study = null, results = null, resultFilters = {area_id: '', pollutant: '', offset: 0, range_offset: 0};
  let caseFilter = '', caseOffset = 0, draftCatalog = null, draftRoot = null;
  let catalogSequence = 0, previewSequence = 0, resultSequence = 0, confirmedSelection = null;
  let formSequence = 0, activeForm = null, draftSession = null, resultController = null;
  const state = () => host.getState();
  const data = () => state()?.data || {};
  const workspace = () => state()?.workspace_key;
  const named = (kind, id) => {
    const row = (data()[kind] || []).find(item => item.id === id);
    return row?.title || row?.spec?.title || row?.selection?.title || short(id);
  };
  const requested = (path, values = {}) => host.endpoint(path, values);
  const busy = id => (state()?.tasks || []).some(task =>
    task.action.startsWith('parameter-study.') && task.payload?.experiment_id === id &&
    ['queued', 'running'].includes(task.state));
  const provenance = selection => [
    ['Native models', modelNames(selection)],
    ['Grid', named('grids', selection?.grid_id)],
    ['Land-cover scenario', named('scenarios', selection?.scenario_id)],
    ['Baseline profile', named('profiles', selection?.profile_id)],
    ['Requested InVEST', selection?.invest_version || '—']
  ].map(([name, value]) => '<div><dt>' + name + '</dt><dd>' + escapeHTML(value) + '</dd></div>').join('');

  function formRequest() {
    const selectedWorkspace = workspace(), sequence = ++formSequence;
    const body = document.querySelector('#form-body'), anchor = body?.firstChild;
    const dialog = document.querySelector('#operation-form')?.closest('dialog'), wasOpen = dialog?.open;
    return {workspace: selectedWorkspace, current: () => workspace() === selectedWorkspace &&
      sequence === formSequence && document.querySelector('#form-body') === body &&
      body?.firstChild === anchor && dialog?.open === wasOpen};
  }

  function formSession(selector, selectedWorkspace) {
    activeForm?.release();
    const form = document.querySelector('#operation-form'), anchor = form?.querySelector(selector);
    const dialog = form?.closest('dialog'), listeners = [];
    if (!form || !anchor || !dialog) throw new Error('Reopen the original parameter-study form.');
    let released = false;
    const session = {
      anchor,
      current() {
        const current = !released && activeForm === session && workspace() === selectedWorkspace &&
          form.isConnected && anchor.isConnected && document.querySelector('#operation-form') === form &&
          dialog.open && form.querySelector(selector) === anchor;
        if (!current) session.release();
        return current;
      },
      ensure() {
        if (!session.current()) throw new Error('The original parameter-study form changed or closed. Reopen it before continuing.');
      },
      listen(node, event, callback) {
        const guarded = value => { if (session.current()) return callback(value); };
        node.addEventListener(event, guarded); listeners.push([node, event, guarded]);
      },
      release() {
        if (released) return;
        released = true;
        for (const [node, event, callback] of listeners) node.removeEventListener(event, callback);
        dialog.removeEventListener('close', onClose);
        if (activeForm === session) activeForm = null;
        if (draftSession === session) {
          draftSession = null; draftRoot = null; draftCatalog = null; confirmedSelection = null;
          catalogSequence++; previewSequence++;
        }
      }
    };
    const onClose = () => { if (!dialog.open) session.release(); };
    dialog.addEventListener('close', onClose);
    activeForm = session;
    return session;
  }

  function render() {
    if (currentWorkspace !== workspace()) {
      activeForm?.current();
      currentWorkspace = workspace(); selected = null; study = null; results = null;
      if (pendingOpen?.workspace !== currentWorkspace) pendingOpen = null;
      resultFilters = {area_id: '', pollutant: '', offset: 0, range_offset: 0}; caseFilter = ''; caseOffset = 0;
    }
    const studies = data()['parameter-studies'] || [];
    if (pendingOpen?.workspace === workspace() && studies.some(row => row.id === pendingOpen.id)) {
      selected = pendingOpen.id; pendingOpen = null;
    }
    if (selected && !studies.some(row => row.id === selected) && pendingOpen?.id !== selected) selected = null;
    const rows = studies.map(row => {
      const progress = row.progress || {};
      return '<tr' + (row.id === selected ? ' class="parameter-study-selected"' : '') + '><td class="name-cell"><strong>' +
        escapeHTML(row.selection?.title || row.title || short(row.id)) + '</strong><small>' +
        escapeHTML(row.selection?.purpose || '') + '</small><small class="mono">' + escapeHTML(short(row.id)) +
        '</small></td><td>' + status(row.state) + '</td><td>' + escapeHTML(label(row.selection?.design)) +
        '</td><td>' + format(progress.completed || 0) + ' / ' + format(progress.total || row.cases?.length || 0) +
        (progress.failed ? '<small>' + format(progress.failed) + ' need recovery</small>' : '') + '</td><td class="actions-cell">' +
        button('open', 'Open study', 'data-id="' + escapeHTML(row.id) + '"') +
        button('revise', 'Use as draft', 'data-id="' + escapeHTML(row.id) + '"') + '</td></tr>';
    });
    return '<div class="parameter-study-workbench"><header class="page-header"><div><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Parameter studies</h1><p>Evaluate explicit model assumptions on the retained grid and land-cover scenario. Review the selected nutrient model, sediment model, or both against the same baseline.</p></div><div class="page-actions">' +
      button('new', 'New parameter study', '', true) + '</div></header>' +
      (rows.length ? '<section class="section"><header class="section-header"><div><h2>Saved studies</h2><p>Each study retains its case selections, native runs, progress, and comparison files.</p></div></header>' +
        gridTable(['Study', 'State', 'Design', 'Complete cases', ''], rows) + '</section>' :
        '<section class="empty"><h2>Define the model assumptions to investigate</h2><p>Start from a prepared or completed native run, select parameter axes, and enter the values and scientific references for each axis.</p>' +
        button('new', 'Create parameter study', '', true) + '</section>') +
      '<div data-parameter-study-detail aria-live="polite">' + (selected ? '<p class="note">Opening selected study…</p>' : '<p class="note">Open a saved study to inspect native cases and export results.</p>') + '</div></div>';
  }

  function detach() {
    if (controller) controller.abort();
    resultController?.abort(); resultController = null; resultSequence++;
    controller = null; root = null;
  }

  function mount(node) {
    detach(); root = node; controller = new AbortController();
    root.addEventListener('change', event => {
      if (event.target.matches('[data-parameter-study-result-filter]')) {
        resultFilters[event.target.dataset.parameterStudyResultFilter] = event.target.value;
        resultFilters.offset = 0; resultFilters.range_offset = 0; refreshResults().catch(showError);
      }
    }, {signal: controller.signal});
    root.addEventListener('input', event => {
      if (event.target.matches('[data-parameter-study-case-filter]')) {
        caseFilter = event.target.value; caseOffset = 0; renderCases();
      }
    }, {signal: controller.signal});
    if (selected && !pendingOpen) openStudy(selected).catch(showError);
    else if (pendingOpen?.workspace === workspace()) {
      const detail = root.querySelector('[data-parameter-study-detail]');
      if (detail) detail.innerHTML = '<p class="note">Refreshing the original Workspace to open this saved parameter study…</p>';
    }
  }

  function showError(error) {
    if (error.name === 'AbortError' || !root) return;
    const panel = root.querySelector('[data-parameter-study-error]') || root.querySelector('[data-parameter-study-detail]');
    if (panel) { panel.innerHTML = '<div class="notice error" role="alert">' + escapeHTML(error.message || error) + '</div>'; }
  }

  async function openStudy(id) {
    const thisRoot = root, selectedWorkspace = workspace(), signal = controller?.signal;
    const item = await host.api(requested('/api/item', {kind: 'parameter-studies', id}), {signal});
    if (!thisRoot || thisRoot !== root || selectedWorkspace !== workspace() || selected !== id) return;
    study = item;
    const progress = item.progress || {}, isBusy = busy(id);
    const canRun = item.state !== 'complete' && !isBusy;
    const activeCase = (item.cases || []).find(row => row.id === item.active_case_id);
    const actions = (canRun ? button('run', item.state === 'prepared' ? 'Run all cases' : 'Resume remaining cases', 'data-id="' + escapeHTML(id) + '"', true) : '') +
      (!isBusy && Number(progress.completed) > 0 ? button('summarize', 'Refresh completed results', 'data-id="' + escapeHTML(id) + '"') : '') +
      button('revise', 'Use as new draft', 'data-id="' + escapeHTML(id) + '"') +
      button('calibration', 'Use completed cases in calibration', 'data-id="' + escapeHTML(id) + '"') +
      (item.comparison_id ? '<button type="button" data-action="item" data-kind="comparisons" data-id="' + escapeHTML(item.comparison_id) + '">Open difference maps</button>' : '');
    const detail = thisRoot.querySelector('[data-parameter-study-detail]');
    detail.innerHTML = '<section class="section"><header class="section-header"><div><h2>' + escapeHTML(item.selection.title) +
      '</h2><p>' + escapeHTML(item.selection.purpose) + '</p></div><div class="page-actions">' + actions +
      '</div></header><div class="section-body"><div class="parameter-study-summary"><div>' + status(item.state) +
      '<p><strong>' + format(progress.completed || 0) + ' / ' + format(progress.total || item.cases.length) +
      '</strong> cases complete' + (progress.failed ? ' · ' + format(progress.failed) + ' need recovery' : '') +
      '</p></div><progress max="' + escapeHTML(progress.total || item.cases.length || 1) + '" value="' +
      escapeHTML(progress.completed || 0) + '" aria-label="Native cases complete"></progress></div>' +
      (activeCase && isBusy ? '<p class="note">Executing ' + escapeHTML(activeCase.label) + ' · native run ' + escapeHTML(short(activeCase.run_id)) + '</p>' : '') +
      aggregationProgress(item) +
      nativeFailureMarkup(item.error) +
      '<dl class="parameter-study-provenance">' + provenance(item.baseline_selection) + '</dl>' + baselineExecution(item) +
      '<details class="technical"><summary>Selected axes and scientific rationale</summary>' + axesSummary(item.selection.axes) + '</details>' +
      '<div data-parameter-study-error></div></div></section>' +
      '<section class="section"><header class="section-header"><div><h2>Native cases</h2><p>Each case uses the baseline grid and land-cover scenario with its selected parameter profile.</p></div><label class="parameter-study-filter">Find a case<input data-parameter-study-case-filter type="search" value="' + escapeHTML(caseFilter) + '" placeholder="Case, parameter, or run ID"></label></header><div data-parameter-study-cases></div></section>' +
      '<section class="section"><header class="section-header"><div><h2>Results and downloads</h2><p>Signed changes are study case minus baseline, using the paired valid cells for each selected area.</p></div></header><div class="section-body"><div data-parameter-study-results></div>' +
      '<div data-parameter-study-downloads>' + host.fileList(item._downloads || []) + '</div></div></section>';
    renderCases();
    if (item.artifacts?.results) await refreshResults();
    else detail.querySelector('[data-parameter-study-results]').innerHTML = '<p class="note">Run the study to produce the comparison matrix, selected-case ranges, and downloadable report. Completed native cases can be summarized at any time.</p>';
  }

  function axesSummary(axes) {
    return gridTable(['Axis', 'Parameters', 'Explicit values', 'Rationale and references'], (axes || []).map(axis => '<tr><td>' +
      escapeHTML(axis.name) + '</td><td class="mono">' + axis.parameters.map(escapeHTML).join('<br>') + '</td><td>' +
      axis.values.map(format).join(', ') + '</td><td>' + escapeHTML(axis.reason) + '<small>' +
      references(axis.references).map(value => /^https?:\/\//i.test(value) ? '<a href="' + escapeHTML(value) +
      '" target="_blank" rel="noopener noreferrer">' + escapeHTML(value) + '</a>' : escapeHTML(value)).join('<br>') + '</small></td></tr>'));
  }

  function renderCases() {
    const panel = root?.querySelector('[data-parameter-study-cases]'); if (!panel || !study) return;
    const query = caseFilter.trim().toLowerCase();
    const matching = study.cases.filter(row => !query || [row.label, row.run_id, row.profile_id, pretty(row.overrides)].join(' ').toLowerCase().includes(query));
    if (caseOffset >= matching.length) caseOffset = Math.max(0, Math.floor((matching.length - 1) / 50) * 50);
    const page = matching.slice(caseOffset, caseOffset + 50);
    const rows = page.map(row => '<tr><td class="name-cell"><strong>' + escapeHTML(row.label) + '</strong><small class="mono">' +
      escapeHTML(short(row.run_id)) + '</small></td><td>' + status(row.state) + (row.error ? '<small>' +
      escapeHTML(row.error.message || row.error) + '</small>' : '') +
      (row.process_interruption && !row.error ? '<small>' + escapeHTML(row.process_interruption.message) + '</small>' : '') +
      (row.native_version_labels ? '<small>' + Object.entries(row.native_version_labels).map(([model, value]) =>
        escapeHTML(model.toUpperCase() + ': ' + value)).join('<br>') + '</small>' : '') + '</td><td class="mono">' +
      (Object.entries(row.overrides || {}).map(([name, value]) => escapeHTML(name) + ' = ' + format(value)).join('<br>') || 'Baseline values') +
      '</td><td class="actions-cell">' + button('case-console', 'Native case console', 'data-id="' + escapeHTML(selected) + '" data-run-id="' + escapeHTML(row.run_id) + '"') +
      '<button type="button" data-action="item" data-kind="runs" data-id="' + escapeHTML(row.run_id) +
      '">Open native run</button><button type="button" data-action="run-log" data-id="' + escapeHTML(row.run_id) +
      '">Log</button><button type="button" data-action="item" data-kind="profiles" data-id="' + escapeHTML(row.profile_id) + '">Profile</button></td></tr>');
    panel.innerHTML = rows.length ? gridTable(['Case', 'State', 'Parameter changes', ''], rows) + '<div class="parameter-study-pager">' +
      '<span>' + format(caseOffset + 1) + '–' + format(caseOffset + rows.length) + ' of ' + format(matching.length) + ' cases</span>' +
      button('cases-prev', 'Previous', caseOffset ? '' : 'disabled') + button('cases-next', 'Next', caseOffset + rows.length < matching.length ? '' : 'disabled') + '</div>' :
      '<p class="note section-body">No cases match this filter.</p>';
  }

  async function refreshResults() {
    if (!root || !selected || !study?.artifacts?.results) return;
    const thisRoot = root, id = selected, selectedWorkspace = workspace(), sequence = ++resultSequence;
    resultController?.abort();
    const reading = new AbortController(); resultController = reading;
    const values = {id, offset: resultFilters.offset, limit: 100,
      range_offset: resultFilters.range_offset || 0, range_limit: 100};
    if (results?.experiment_id === id) values.expected_artifact_sha256 = results.artifact_sha256;
    if (resultFilters.area_id) values.area_id = resultFilters.area_id;
    if (resultFilters.pollutant) values.pollutant = resultFilters.pollutant;
    const current = () => thisRoot === root && id === selected && selectedWorkspace === workspace() &&
      sequence === resultSequence && !reading.signal.aborted;
    let result;
    try {
      result = await host.api(requested('/api/parameter-studies/results', values), {signal: reading.signal});
    } catch (error) {
      if (current()) throw error;
      return;
    }
    if (!current()) return;
    if (study?.artifacts?.results?.sha256 !== result.artifact_sha256) {
      const downloads = root.querySelector('[data-parameter-study-downloads]');
      if (downloads) downloads.innerHTML = '<p class="note">Refreshing downloads for this saved result edition…</p>';
      let retained;
      try {
        retained = await host.api(requested('/api/item', {kind: 'parameter-studies', id}), {signal: reading.signal});
      } catch (error) {
        if (current()) throw error;
        return;
      }
      if (!current()) return;
      if (retained?.artifacts?.results?.sha256 !== result.artifact_sha256) {
        // The source advanced again during this item read. Resolve its current
        // original edition before exposing either rows or download tickets.
        return refreshResults();
      }
      study = retained;
      if (downloads) downloads.innerHTML = host.fileList(retained._downloads || []);
    }
    results = result; resultFilters.offset = result.offset;
    resultFilters.range_offset = result.range_offset || 0;
    resultFilters.area_id = result.area_id ?? resultFilters.area_id;
    resultFilters.pollutant = result.pollutant ?? resultFilters.pollutant;
    const panel = root.querySelector('[data-parameter-study-results]'); if (!panel) return;
    const controls = '<div class="filters"><label>Reporting area<select data-parameter-study-result-filter="area_id">' + option('', 'All reporting areas', !resultFilters.area_id) +
      result.areas.map(area => option(area.id, area.name, resultFilters.area_id === area.id)).join('') + '</select></label><label>Pollutant<select data-parameter-study-result-filter="pollutant">' +
      option('', 'All pollutants', !resultFilters.pollutant) + result.pollutants.map(value => option(value, label(value), resultFilters.pollutant === value)).join('') + '</select></label></div>';
    const rows = result.rows.map(row => '<tr><td class="name-cell"><strong>' + escapeHTML(row.case) + '</strong><small>' +
      escapeHTML(row.area) + '</small><small>' + escapeHTML(label(row.pollutant)) + ' · ' + escapeHTML(row.units) +
      '</small></td><td class="number-cell">' + format(row.baseline_mass) + '</td><td class="number-cell">' + format(row.case_mass) +
      '</td><td class="number-cell">' + format(row.change) + '<small>' + format(row.percent_change) + (row.percent_change === null ? '' : '%') +
      '</small></td><td>' + (row.support_changed ? 'Coverage changed' : 'Matching coverage') + '<small>' +
      format(row.paired_valid_cells) + ' paired cells</small><details class="row-detail"><summary>Coverage and response</summary><dl class="definition">' +
      [['Pixel area (ha)', row.pixel_area_ha], ['Paired area (ha)', row.paired_area_ha],
       ['Baseline valid area (ha)', row.baseline_valid_area_ha], ['Case valid area (ha)', row.case_valid_area_ha],
       ['Baseline valid cells', row.baseline_valid_cells], ['Case valid cells', row.case_valid_cells], ['Baseline full mass', row.baseline_full_mass],
       ['Case full mass', row.case_full_mass], ['Parameter', row.parameter], ['Baseline parameter', row.baseline_parameter],
       ['Case parameter', row.case_parameter], ['Response per parameter unit', row.response_per_parameter_unit], ['Elasticity', row.elasticity]]
        .map(([name, value]) => '<dt>' + name + '</dt><dd>' + format(value) + '</dd>').join('') + '</dl></details></td></tr>');
    panel.innerHTML = (result.edition_changed ? '<div class="notice">A newer saved scientific summary is available. Result and range pages now start from that original edition.</div>' : '') +
      '<p class="note">' + escapeHTML(modelNames({models: result.models})) + ' · ' + escapeHTML(result.comparison_basis) + '</p>' +
      (result.mass_basis ? '<p class="note">' + escapeHTML(result.mass_basis) + '</p>' : '') + resultExecution(result) + controls +
      (rows.length ? gridTable(['Case and reporting area', 'Baseline mass', 'Case mass', 'Change', 'Valid-cell coverage'], rows) : '<p class="note">No completed rows match these filters.</p>') +
      '<div class="parameter-study-pager"><span>' + (rows.length ? format(result.offset + 1) + '–' + format(result.offset + rows.length) : '0') + ' of ' +
      format(result.filtered_rows) + ' result rows</span>' + button('results-prev', 'Previous', result.offset ? '' : 'disabled') +
      button('results-next', 'Next', result.offset + rows.length < result.filtered_rows ? '' : 'disabled') +
      (result.filtered_rows > 100 ? '<label>Go to result row<input data-parameter-study-result-row type="number" min="1" max="' +
        escapeHTML(result.filtered_rows) + '" step="1" value="' + escapeHTML(result.offset + 1) + '"></label>' +
        button('results-go', 'Go to row') : '') + '</div>' +
      (result.ranges.length ? '<details class="technical"><summary>Ranges across selected completed cases</summary><p class="note">' +
        escapeHTML(result.range_basis) + '</p>' + gridTable(['Area', 'Pollutant', 'Minimum mass', 'Maximum mass', 'Comparable cases'],
        result.ranges.map(row => '<tr><td>' + escapeHTML(row.area) + '</td><td>' + escapeHTML(label(row.pollutant)) +
          '<small>' + escapeHTML(row.units) + '</small></td><td class="number-cell">' + format(row.minimum_mass) +
          '</td><td class="number-cell">' + format(row.maximum_mass) + '</td><td>' + format(row.cases) +
          (row.support_changed_cases ? '<small>' + format(row.support_changed_cases) + ' changed-coverage cases</small>' : '') + '</td></tr>')) +
        '<div class="parameter-study-pager"><span>' + format((result.range_offset || 0) + 1) + '–' +
        format((result.range_offset || 0) + result.ranges.length) + ' of ' +
        format(result.filtered_ranges ?? result.ranges.length) + ' original ranges</span>' +
        button('ranges-prev', 'Previous ranges', result.range_offset ? '' : 'disabled') +
        button('ranges-next', 'Next ranges', (result.range_offset || 0) + result.ranges.length <
          (result.filtered_ranges ?? result.ranges.length) ? '' : 'disabled') + '</div></details>' : '') +
      '<p class="note">Result source <code style="overflow-wrap:anywhere">' + escapeHTML(result.artifact_sha256) +
      '</code>. Full JSON, CSV and report downloads retain every original case, reporting area and range.</p>';
  }

  function axisEditor(axis = {}) {
    return '<fieldset class="parameter-study-axis"><legend>Parameter axis</legend><div class="parameter-study-axis-heading">' +
      field('axis_name', 'Axis name', axis.name || '', 'required') + button('axis-remove', 'Remove axis') + '</div>' +
      '<div class="form-grid"><label>Native parameters<select name="axis_parameters" multiple size="5" required data-selected="' +
      escapeHTML(JSON.stringify(axis.parameters || [])) + '"></select><small>Select one parameter, or couple parameters that should use the same explicit value.</small></label>' +
      textarea('axis_values', 'Values to evaluate', (axis.values || []).join('\n'), 'required rows="5" placeholder="One explicit value per line"') +
      textarea('axis_reason', 'Scientific rationale', axis.reason || '', 'required rows="3"') +
      textarea('axis_references', 'Supporting references', references(axis.references).join('\n'), 'required rows="3" placeholder="One source reference per line"') +
      '</div><p class="note" data-axis-baseline></p></fieldset>';
  }

  function areaEditor(area = {}) {
    return '<fieldset class="parameter-study-area"><legend>Reporting area</legend><div class="parameter-study-axis-heading">' +
      field('area_name', 'Area name', area.name || '', 'required') + button('area-remove', 'Remove area') +
      '</div><div class="form-grid"><label>Retained source edition<select name="area_collection" required>' + option('', 'Choose source edition') +
      (data().sources || []).map(row => option(row.id, row.title || row.scope || short(row.id), row.id === area.source_collection_id)).join('') +
      '</select></label><label>Polygon source<select name="area_source" required data-selected="' + escapeHTML(area.source_id || '') +
      '"></select></label>' + field('area_layer', 'Layer name (when required)', area.layer || '') +
      textarea('area_where', 'Exact field filters (optional JSON object)', area.where ? pretty(area.where) : '', 'rows="3" placeholder=\'{"field": "value"}\'') +
      '</div></fieldset>';
  }

  function setAreaSources(node) {
    const select = node.querySelector('[name="area_source"]'), collection = node.querySelector('[name="area_collection"]').value;
    const selectedSource = select.value || select.dataset.selected || '';
    const edition = (data().sources || []).find(row => row.id === collection);
    select.innerHTML = option('', 'Choose polygon source') + (edition?.entries || []).filter(row => row.kind === 'vector').map(row => option(row.id, row.title || row.id, row.id === selectedSource)).join('');
    select.dataset.selected = '';
  }

  function fillParameters(node) {
    const select = node.querySelector('[name="axis_parameters"]');
    const chosen = [...select.selectedOptions].map(row => row.value);
    const initial = chosen.length ? chosen : JSON.parse(select.dataset.selected || '[]');
    select.innerHTML = (draftCatalog?.parameters || []).map(row => option(row.parameter,
      row.model.toUpperCase() + ' · ' + row.label + ' (' + row.units + ')', initial.includes(row.parameter))).join('');
    select.dataset.selected = '';
    describeAxis(node);
  }

  function describeAxis(node) {
    const chosen = [...node.querySelector('[name="axis_parameters"]').selectedOptions].map(row => row.value);
    node.querySelector('[data-axis-baseline]').textContent = chosen.map(path => {
      const item = draftCatalog?.parameters.find(row => row.parameter === path);
      return item ? path + ': baseline ' + (item.explicit_in_baseline ? String(item.baseline_value) : 'uses native engine default') +
        ' · allowed ' + item.constraint + ' · ' + item.units : path;
    }).join(' | ');
  }

  function invalidatePreview() {
    confirmedSelection = null; previewSequence++;
    const panel = draftRoot?.querySelector('[data-parameter-study-preview]');
    if (panel) panel.innerHTML = '<p class="note">Preview the selected design to inspect its case count before saving.</p>';
  }

  async function loadCatalog() {
    const session = draftSession;
    if (!session?.current()) return;
    const current = session.anchor, sequence = ++catalogSequence, selectedWorkspace = workspace();
    draftCatalog = null; invalidatePreview();
    const baseline = current.querySelector('[name="baseline_run_id"]').value;
    if (!baseline) { current.querySelector('[data-baseline-description]').textContent = 'Choose a retained native run.'; return; }
    current.querySelector('[data-baseline-description]').textContent = 'Reading the retained baseline parameters…';
    try {
      const result = await host.api(requested('/api/parameter-studies/catalog', {baseline_run_id: baseline}));
      if (!session.current() || current !== draftRoot || sequence !== catalogSequence || selectedWorkspace !== workspace()) return;
      draftCatalog = result;
      current.querySelector('[data-baseline-description]').innerHTML = '<dl class="parameter-study-provenance">' +
        provenance(result.selection) + '</dl>' + baselineExecution(result) + '<p class="note">Baseline ' + escapeHTML(result.baseline_state) + ' · ' +
        escapeHTML(result.profile_title) + ' · ' + (result.pollutants || []).map(value => escapeHTML(label(value))).join(', ') + '</p>';
      current.querySelectorAll('.parameter-study-axis').forEach(fillParameters);
    } catch (error) {
      if (session.current() && current === draftRoot && sequence === catalogSequence && selectedWorkspace === workspace()) current.querySelector('[data-baseline-description]').textContent = error.message;
    }
  }

  function selectionFromForm() {
    draftSession?.ensure();
    if (!draftSession || !draftRoot || !draftCatalog) throw new Error('Select a baseline and wait for its parameter catalog to load.');
    const value = name => draftRoot.querySelector('[name="' + name + '"]').value.trim();
    const selection = {title: value('experiment_title'), purpose: value('experiment_purpose'),
      baseline_run_id: value('baseline_run_id'), design: value('experiment_design'),
      axes: [...draftRoot.querySelectorAll('.parameter-study-axis')].map(node => {
        const get = name => node.querySelector('[name="' + name + '"]').value.trim();
        return {name: get('axis_name'), parameters: [...node.querySelector('[name="axis_parameters"]').selectedOptions].map(row => row.value),
          values: parseParameterStudyValues(get('axis_values')), reason: get('axis_reason'), references: readLines(get('axis_references'))};
      }),
      reporting_areas: [...draftRoot.querySelectorAll('.parameter-study-area')].map(node => {
        const get = name => node.querySelector('[name="' + name + '"]').value.trim();
        const area = {name: get('area_name'), source_collection_id: get('area_collection'), source_id: get('area_source')};
        if (get('area_layer')) area.layer = get('area_layer');
        if (get('area_where')) {
          try { area.where = JSON.parse(get('area_where')); } catch { throw new Error('Area filters must be a JSON object of exact field values.'); }
          if (!area.where || typeof area.where !== 'object' || Array.isArray(area.where)) throw new Error('Area filters must be a JSON object.');
        }
        return area;
      }),
      difference_maps: draftRoot.querySelector('[name="difference_maps"]').checked};
    return selection;
  }

  async function previewDesign() {
    const selection = selectionFromForm(), session = draftSession, current = session.anchor;
    const sequence = ++previewSequence, selectedWorkspace = workspace();
    const panel = current.querySelector('[data-parameter-study-preview]');
    panel.innerHTML = '<p class="note">Calculating the selected case design…</p>';
    try {
      const result = await host.api('/api/parameter-studies/preview', {method: 'POST', body: {workspace: workspace(), selection}});
      if (!session.current() || current !== draftRoot || sequence !== previewSequence || selectedWorkspace !== workspace()) return null;
      confirmedSelection = {input: JSON.stringify(selection), selection: result.selection};
      panel.innerHTML = '<div class="notice"><strong>' + format(result.case_count) + ' native cases · ' +
        format(result.alternatives) + ' parameter alternatives plus the baseline</strong>' + escapeHTML(label(result.design)) +
        ' · ' + escapeHTML(modelNames({models: result.models})) + ' · baseline requested InVEST ' + escapeHTML(result.invest_version) +
        (result.preparation_invest_version ? ' · preparing new cases with InVEST ' + escapeHTML(result.preparation_invest_version) : '') +
        '</div>' + baselineExecution(result) + axesSummary(result.axes) +
        (result.examples?.length ? '<details class="technical"><summary>Example case selections (' + format(result.example_count) +
          ' of ' + format(result.alternatives) + ' alternatives)</summary>' + gridTable(['Case', 'Overrides'],
          result.examples.map(row => '<tr><td>' + escapeHTML(row.label) + '</td><td class="mono">' +
            escapeHTML(pretty(row.overrides)) + '</td></tr>')) + '</details>' : '');
      return result;
    } catch (error) {
      if (!session.current() || current !== draftRoot || sequence !== previewSequence || selectedWorkspace !== workspace()) return null;
      panel.innerHTML = '<div class="notice error" role="alert">' + escapeHTML(error.message) + '</div>';
      throw error;
    }
  }

  async function newStudy(id, baselineId) {
    if (!(data().runs || []).length) throw new Error('Prepare a native run before creating a parameter study.');
    const opening = formRequest(), originalWorkspace = opening.workspace;
    let initial = {}, editor = null;
    if (id) initial = (await host.api(requested('/api/item', {kind: 'parameter-studies', id}))).selection;
    if (!opening.current()) return;
    draftCatalog = null; confirmedSelection = null;
    const html = '<div class="parameter-study-draft"><div class="form-grid">' +
      field('experiment_title', 'Study title', initial.title ? initial.title + ' — revision' : '', 'required') +
      '<label>Design<select name="experiment_design">' + option('one-at-a-time', 'One parameter axis at a time', initial.design !== 'factorial') +
      option('factorial', 'Every combination of axis values', initial.design === 'factorial') + '</select></label>' +
      textarea('experiment_purpose', 'Scientific question', initial.purpose || '', 'required rows="3"') +
      '<label>Baseline native run<select name="baseline_run_id" required>' + option('', 'Choose retained baseline') +
      data().runs.map(run => option(run.id, named('scenarios', run.selection.scenario_id) + ' · ' +
        named('profiles', run.selection.profile_id) + ' · ' + modelNames(run.selection) + ' · ' + run.state + ' · ' + short(run.id),
        run.id === (initial.baseline_run_id || baselineId))).join('') + '</select></label></div>' +
      '<div data-baseline-description class="parameter-study-baseline"></div><div class="subheading"><h3>Parameter axes</h3>' +
      button('axis-add', 'Add parameter axis') + '</div><div data-parameter-study-axes>' +
      (initial.axes?.length ? initial.axes : [{}]).map(axisEditor).join('') + '</div>' +
      '<details class="technical"' + (initial.reporting_areas?.length ? ' open' : '') + '><summary>Additional geographic reporting areas</summary>' +
      '<p class="note">The full original reporting area is always included. Add retained polygon sources for local summaries.</p>' +
      '<div data-parameter-study-areas>' + (initial.reporting_areas || []).map(areaEditor).join('') + '</div>' + button('area-add', 'Add reporting area') +
      '</details><label class="check parameter-study-map-choice"><input name="difference_maps" type="checkbox"' + (initial.difference_maps ? ' checked' : '') +
      '><span>Retain difference rasters for completed cases</span></label><div class="page-actions">' +
      button('preview', 'Preview case design') + '</div><div data-parameter-study-preview></div></div>';
    host.openForm('New parameter study', 'Choose explicit values and supporting references. A saved study retains its baseline, axes, geographic reporting areas, and native case identities.',
      html, 'Save study', async () => {
        editor.ensure();
        const selection = selectionFromForm();
        if (!confirmedSelection || confirmedSelection.input !== JSON.stringify(selection)) {
          const preview = await previewDesign();
          if (!preview) throw new Error('The selection changed while the preview was loading. Preview the current design.');
        }
        editor.ensure();
        if (!confirmedSelection || confirmedSelection.input !== JSON.stringify(selectionFromForm())) {
          throw new Error('The selection changed while the preview was loading. Preview the current design.');
        }
        await host.submitAction('parameter-study.prepare', confirmedSelection.selection);
      }, () => {
        editor = formSession('.parameter-study-draft', originalWorkspace);
        draftSession = editor; draftRoot = editor.anchor;
        editor.listen(draftRoot, 'input', invalidatePreview);
        editor.listen(draftRoot, 'change', event => {
          invalidatePreview();
          if (event.target.name === 'baseline_run_id') loadCatalog();
          if (event.target.name === 'axis_parameters') describeAxis(event.target.closest('.parameter-study-axis'));
          if (event.target.name === 'area_collection') setAreaSources(event.target.closest('.parameter-study-area'));
        });
        draftRoot.querySelectorAll('.parameter-study-area').forEach(setAreaSources);
        loadCatalog();
      });
  }

  async function openCalibration(id) {
    const opening = formRequest(), originalWorkspace = opening.workspace;
    const packet = await host.api(requested('/api/parameter-studies/calibration', {id}));
    if (!opening.current()) return;
    let editor = null;
    const eligible = packet.eligible || [], excluded = packet.excluded || [];
    const rows = eligible.map(row => '<tr><td><input type="checkbox" name="parameter_study_calibration_run" value="' +
      escapeHTML(row.run_id) + '" checked aria-label="Use ' + escapeHTML(row.labels.join(', ')) + '"></td><td><strong>' +
      escapeHTML(row.labels.join(', ')) + '</strong><small class="mono">' + escapeHTML(row.run_id) +
      '</small></td><td>' + escapeHTML(row.selected_models.map(value => value.toUpperCase()).join(' + ')) +
      '<small>' + escapeHTML(row.available_parameters.map(label).join(', ')) + '</small></td><td>' +
      escapeHTML(row.title) + (row.is_reference ? '<small>Original study reference</small>' : '') + '</td><td>' +
      calibrationExecution(row) + '</td></tr>');
    const excludedRows = excluded.map(row => '<tr><td>' + escapeHTML(row.labels.join(', ')) +
      '<small class="mono">' + escapeHTML(row.run_id) + '</small></td><td>' + status(row.state) +
      '</td><td>' + row.reasons.map(escapeHTML).join('<br>') + '</td><td>' +
      calibrationExecution(row) + '</td></tr>');
    const body = '<div class="parameter-study-calibration"><p>' + escapeHTML(packet.method) + '</p>' +
      (packet.issues?.length ? '<div class="notice">' + packet.issues.map(escapeHTML).join('<br>') + '</div>' : '') +
      '<p><strong>' + format(eligible.length) + '</strong> eligible native runs · ' + format(excluded.length) +
      ' remaining or excluded runs. Reused runs appear once, with every original case label.</p>' +
      (rows.length ? gridTable(['Use', 'Original study cases', 'Native outputs', 'Parameter profile', 'Execution and units'], rows) :
        '<p class="note">This study has no completed unchanged-baseline cases for annual-load calibration.</p>') +
      (excludedRows.length ? '<details class="technical"><summary>Remaining and excluded cases</summary>' +
        gridTable(['Case', 'State', 'Reason', 'Retained execution'], excludedRows) + '</details>' : '') +
      '<p class="note">Continue preserves your saved observation and catchment draft. The next form reviews objective weights, observed annual loads and the spatial validation split.</p></div>';
    host.openForm('Calibrate completed study cases', packet.title, body, 'Open calibration selection', async () => {
      editor.ensure();
      const ids = [...editor.anchor.querySelectorAll('[name="parameter_study_calibration_run"]:checked')].map(node => node.value);
      if (!ids.length) throw new Error('Choose at least one completed original baseline run.');
      if (typeof host.openExtension !== 'function') throw new Error('Open this source edition with its registered calibration desk.');
      return host.openExtension('calibration', 'openForCandidates', {
        workspace_key: originalWorkspace, study_id: id, candidate_run_ids: ids});
    }, () => {
      editor = formSession('.parameter-study-calibration', originalWorkspace);
      const submit = document.getElementById('form-submit');
      if (submit) submit.disabled = !eligible.length;
    });
  }

  async function dispatch(node) {
    const action = node.dataset.action.slice('parameter-study-'.length), id = node.dataset.id;
    if (node.dataset.workspace && node.dataset.workspace !== workspace()) {
      throw new Error('Open this task in its original Workspace before opening its parameter study.');
    }
    if (action === 'case-console') return caseConsole.open(id, node.dataset.runId);
    if (action === 'new' || action === 'revise') return newStudy(action === 'revise' ? id : null, node.dataset.baselineId);
    if (action === 'open') {
      currentWorkspace = workspace(); study = null; results = null;
      selected = id; pendingOpen = {workspace: currentWorkspace, id};
      resultFilters = {area_id: '', pollutant: '', offset: 0, range_offset: 0}; caseFilter = ''; caseOffset = 0;
      document.querySelector('#detail-dialog')?.close();
      host.navigate('parameter-studies');
      if (pendingOpen) await host.refreshState();
      return;
    }
    if (action === 'run' || action === 'summarize') return host.executeAction('parameter-study.' + action, {experiment_id: id});
    if (action === 'calibration') return openCalibration(id);
    if (['preview', 'axis-add', 'axis-remove', 'area-add', 'area-remove'].includes(action)) {
      if (!draftSession?.current() || !draftRoot.contains(node)) return;
    }
    if (action === 'preview') return previewDesign();
    if (action === 'axis-add') {
      draftRoot.querySelector('[data-parameter-study-axes]').insertAdjacentHTML('beforeend', axisEditor());
      fillParameters(draftRoot.querySelector('.parameter-study-axis:last-child')); invalidatePreview(); return;
    }
    if (action === 'axis-remove') { node.closest('.parameter-study-axis').remove(); invalidatePreview(); return; }
    if (action === 'area-add') {
      draftRoot.querySelector('[data-parameter-study-areas]').insertAdjacentHTML('beforeend', areaEditor());
      setAreaSources(draftRoot.querySelector('.parameter-study-area:last-child')); invalidatePreview(); return;
    }
    if (action === 'area-remove') { node.closest('.parameter-study-area').remove(); invalidatePreview(); return; }
    if (action === 'cases-prev' || action === 'cases-next') { caseOffset = Math.max(0, caseOffset + (action === 'cases-prev' ? -50 : 50)); renderCases(); return; }
    if (action === 'results-prev' || action === 'results-next') {
      resultFilters.offset = Math.max(0, resultFilters.offset + (action === 'results-prev' ? -100 : 100)); return refreshResults();
    }
    if (action === 'ranges-prev' || action === 'ranges-next') {
      resultFilters.range_offset = Math.max(0, (resultFilters.range_offset || 0) +
        (action === 'ranges-prev' ? -100 : 100)); return refreshResults();
    }
    if (action === 'results-go') {
      const value = Number(root?.querySelector('[data-parameter-study-result-row]')?.value);
      if (!Number.isSafeInteger(value) || value < 1 || value > (results?.filtered_rows || 0)) {
        throw new Error('Choose a result row within this original filtered table.');
      }
      resultFilters.offset = Math.floor((value - 1) / 100) * 100; return refreshResults();
    }
  }


  async function openSavedStudy(selection) {
    const selectedWorkspace=workspace(), id=selection?.experiment_id;
    if(!selection||selection.workspace_key!==selectedWorkspace||!/^[0-9a-f]{64}$/.test(id||'')) {
      throw new Error('Open a retained parameter study in its original workspace.');
    }
    const retained=await host.api(requested('/api/item',{kind:'parameter-studies',id}));
    if(workspace()!==selectedWorkspace||retained.id!==id) {
      throw new Error('The workspace or saved parameter study changed while opening it.');
    }
    currentWorkspace=selectedWorkspace;selected=id;study=null;results=null;
    pendingOpen={workspace:selectedWorkspace,id};
    resultFilters={area_id:'',pollutant:'',offset:0,range_offset:0};caseFilter='';caseOffset=0;
    await host.navigate('parameter-studies');
    if(workspace()!==selectedWorkspace)throw new Error('Reopen the retained study in its selected workspace.');
    if(pendingOpen)await host.refreshState();
    if(workspace()!==selectedWorkspace)throw new Error('The selected workspace changed while refreshing the study.');
    return {workspace_key:selectedWorkspace,experiment_id:id};
  }

  function taskActions(task) {
    return task.action?.startsWith('parameter-study.') && task.result?.id && task.workspace ?
      (task.result.state === 'partial' ? '<div class="notice">Completed-case results are available. Resume the study to recover the remaining cases.</div>' : '') +
      '<div class="page-actions">' + button('open', 'Open parameter study', 'data-id="' + escapeHTML(task.result.id) + '" data-workspace="' + escapeHTML(task.workspace) + '"') + '</div>' : '';
  }

  return {render, mount, detach, dispatch, taskActions, openSavedStudy};
}
