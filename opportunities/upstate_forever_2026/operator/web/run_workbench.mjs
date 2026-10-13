/**
 * Native run execution desk over the original operator task queue.
 * Scientific selections and calculations remain in model.workspace/native.
 */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const activeStates = new Set(['queued', 'running']);
const resumableStates = new Set(['failed', 'interrupted', 'cancelled']);
const idPattern = /^[0-9a-f]{64}$/;
const pageSize = 50;
const quantity = value => value === null || value === undefined ? '—' :
  typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 6}) : escapeHTML(value);
const title = row => row?.title || row?.metadata?.title || row?.spec?.title || row?.selection?.title || String(row?.id || '').slice(0, 12);
const short = value => String(value || '').slice(0, 12);
const selectionKey = selection => [selection.grid_id, selection.profile_id, selection.scenario_id].join(':');
const canonical = value => JSON.stringify(value, (_, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  }
  return item;
});
const htmlButton = (action, label, values = {}, disabled = false, primary = false) =>
  '<button type="button" data-action="run-desk-' + escapeHTML(action) + '"' +
  Object.entries(values).map(([key, value]) => ' data-' + key + '="' + escapeHTML(value) + '"').join('') +
  (disabled ? ' disabled' : '') + ' class="' + (primary ? 'primary' : 'small') + '">' + escapeHTML(label) + '</button>';
const option = (value, label, selected, disabled = false) =>
  '<option value="' + escapeHTML(value) + '"' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + escapeHTML(label) + '</option>';

export function runDeskRows(snapshot, draft, programmeStatuses = []) {
  const data = snapshot?.data || {};
  const profiles = new Map((data.profiles || []).map(row => [row.id, row]));
  const scenarios = new Map((data.scenarios || []).map(row => [row.id, row]));
  const runs = new Map();
  for (const run of data.runs || []) {
    const key = selectionKey(run.selection || {});
    const before = runs.get(key);
    if (!before || String(run.created_at || '') > String(before.created_at || '')) runs.set(key, run);
  }
  const tasks = [...(snapshot?.tasks || [])]
    .filter(task => !task.workspace || task.workspace === snapshot.workspace_key)
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  const preparationBySelection = new Map(), startByRun = new Map();
  for (const task of tasks) {
    const index = task.action === 'run.prepare' ? preparationBySelection : task.action === 'run.start' ? startByRun : null;
    if (!index) continue;
    const key = task.action === 'run.prepare' ? selectionKey(task.payload || {}) : task.payload?.run_id;
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(task);
  }
  const programmeByRun = new Map(), programmeBySelection = new Map();
  const runningTasks = new Map(tasks.filter(task => task.action === 'compute.programme.run' && task.state === 'running').map(task => [task.id, task]));
  for (const retained of programmeStatuses) {
    const task = runningTasks.get(retained.task_id), status = retained.status;
    if (!task || status?.active !== true || !Array.isArray(status.runs)) continue;
    const requested = new Set(Array.isArray(status.requested_runs) ? status.requested_runs : status.runs.map(row => row.key));
    if (status.baseline_run) requested.add(status.baseline_run);
    const currentKey = typeof status.current_run === 'string' ? status.current_run : status.current_run?.key;
    if (currentKey) requested.add(currentKey);
    for (const binding of status.runs) {
      if (!requested.has(binding.key)) continue;
      const programme = {id: status.programme_id || status.id, key: binding.key, current: binding.key === currentKey, task};
      if (idPattern.test(binding.run_id || '') && (!programmeByRun.has(binding.run_id) || programme.current))
        programmeByRun.set(binding.run_id, programme);
      const selection = binding.native_selection || binding.selection;
      if (selection && ['grid_id', 'profile_id', 'scenario_id'].every(key => idPattern.test(selection[key] || '')) &&
          (!programmeBySelection.has(selectionKey(selection)) || programme.current))
        programmeBySelection.set(selectionKey(selection), programme);
    }
  }
  const excluded = new Set(draft.excluded || []);
  const rows = [];
  for (const profileId of draft.profile_ids || []) {
    const profile = profiles.get(profileId);
    if (!profile) continue;
    for (const scenarioId of draft.scenario_ids || []) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario) continue;
      const selection = {grid_id: draft.grid_id, profile_id: profileId, scenario_id: scenarioId};
      const key = selectionKey(selection);
      const run = runs.get(key);
      const preparations = preparationBySelection.get(key) || [];
      const starts = run ? startByRun.get(run.id) || [] : [];
      const activePreparation = preparations.find(task => activeStates.has(task.state));
      const activeStart = starts.find(task => activeStates.has(task.state));
      const programme = (run && programmeByRun.get(run.id)) || programmeBySelection.get(key);
      const task = programme?.task || activeStart || activePreparation || starts[0] || preparations[0];
      let state = 'missing', label = 'Needs preparation';
      if (run?.state === 'complete') { state = 'complete'; label = 'Complete'; }
      else if (programme) { state = programme.current ? 'running' : 'queued'; label = programme.current ? 'Running in programme' : 'Selected in active programme'; }
      else if (activeStart) { state = activeStart.state; label = activeStart.state === 'queued' ? 'Queued to run' : 'Running'; }
      else if (activePreparation) { state = 'preparing'; label = activePreparation.state === 'running' ? 'Preparing' : 'Preparation queued'; }
      else if (run && starts[0] && resumableStates.has(starts[0].state)) { state = 'attention'; label = starts[0].state === 'failed' ? 'Run needs attention' : 'Continuation available'; }
      else if (run?.state === 'prepared') { state = 'ready'; label = 'Ready to run'; }
      else if (run) { state = 'attention'; label = run.state === 'failed' ? 'Run needs attention' : 'Continuation available'; }
      else if (task && resumableStates.has(task.state)) { state = 'attention'; label = 'Preparation needs attention'; }
      rows.push({
        key, selection, profile, scenario, run, task, state, label, programme,
        selected: !excluded.has(key),
        preparable: !run && !activePreparation && !programme,
        startable: !!run && run.state !== 'complete' && !activeStart && !activePreparation && !programme,
        queuedTask: [activeStart, activePreparation].find(value => value?.state === 'queued')
      });
    }
  }
  return rows;
}

export function runDeskComparisons(snapshot, draft, rows = runDeskRows(snapshot, draft)) {
  const baseline = (snapshot?.data?.scenarios || []).find(row => row.id === draft.baseline_scenario_id);
  if (!baseline || baseline.kind !== 'baseline') return [];
  const selected = rows.filter(row => row.selected);
  const groups = [];
  for (const profileId of draft.profile_ids || []) {
    const family = selected.filter(row => row.selection.profile_id === profileId);
    const base = family.find(row => row.scenario.id === baseline.id);
    const alternatives = family.filter(row => row.scenario.id !== baseline.id && row.scenario.kind === 'landcover');
    if (!base || !alternatives.length) continue;
    const complete = alternatives.filter(row => row.run?.state === 'complete');
    const runIds = base.run?.state === 'complete' ? [base.run.id, ...complete.map(row => row.run.id)] : [];
    const signature = [...runIds.slice(1)].sort().join(',');
    const retained = runIds.length > 1 ? (snapshot.data.comparisons || []).find(row =>
      row.baseline_run_id === runIds[0] && (row.alternatives || []).map(value => value.run_id).sort().join(',') === signature) : null;
    const task = runIds.length > 1 ? (snapshot.tasks || []).find(row =>
      row.action === 'run.compare' && row.payload?.run_ids?.[0] === runIds[0] &&
      [...row.payload.run_ids.slice(1)].sort().join(',') === signature &&
      activeStates.has(row.state)) : null;
    groups.push({profileId, profile: base.profile, baseline: base, alternatives, complete, runIds, retained, task});
  }
  return groups;
}

export function runDeskProgrammes(snapshot, draft, rows = runDeskRows(snapshot, draft)) {
  const grid = (snapshot?.data?.grids || []).find(row => row.id === draft.grid_id && row.state === 'complete');
  if (!grid) return [];
  const selected = rows.filter(row => row.selected), programmes = [];
  for (const profileId of draft.profile_ids || []) {
    const family = selected.filter(row => row.selection.profile_id === profileId);
    const baseline = family.find(row => row.scenario.id === draft.baseline_scenario_id && row.scenario.kind === 'baseline');
    if (!baseline) continue;
    const alternatives = family.filter(row => row.scenario.id !== baseline.scenario.id && row.scenario.kind === 'landcover');
    const selection = {
      schema: 'upstate.compute-programme-selection/v1',
      title: 'Native runs · ' + title(baseline.profile),
      grid_id: draft.grid_id,
      baseline_run: 'baseline',
      runs: [{key: 'baseline', title: title(baseline.scenario), profile_id: profileId, scenario_id: baseline.scenario.id},
        ...alternatives.map(row => ({key: row.scenario.id, title: title(row.scenario),
          profile_id: profileId, scenario_id: row.scenario.id}))]
    };
    programmes.push({profileId, profile: baseline.profile, baseline, selection});
  }
  return programmes;
}

export function attachRunWorkbench({getState, api, refreshState, openItem, showTask, showRunLog, openDelivery, openProgramme, getProgramme, toast}) {
  let host = null, current = null, workspaceKey = null, draft = null;
  let busy = false, notice = '', page = 0, filter = 'all', search = '';
  let storageMessage = '', submission = null;
  let programmeStatuses = [], programmeRead = null, programmeEpoch = 0, programmeMessage = '';
  function programmeOpener() {
    if (typeof openProgramme === 'function') return openProgramme;
    const programme = typeof getProgramme === 'function' ? getProgramme() : null;
    return typeof programme?.create === 'function' ? selection => programme.create({selection}) : null;
  }

  function resetProgrammeTracking() {
    programmeEpoch++;
    programmeStatuses = []; programmeRead = null; programmeMessage = '';
  }
  function runningProgrammeTasks(snapshot) {
    const byProgramme = new Map();
    const tasks = (snapshot?.tasks || []).filter(task => task.action === 'compute.programme.run' && task.state === 'running' &&
      (!task.workspace || task.workspace === snapshot.workspace_key) && idPattern.test(task.payload?.programme_id || ''))
      .sort((left, right) => String(left.started_at || left.created_at || '').localeCompare(String(right.started_at || right.created_at || '')));
    for (const task of tasks) if (!byProgramme.has(task.payload.programme_id)) byProgramme.set(task.payload.programme_id, task);
    return [...byProgramme.values()];
  }
  async function refreshProgrammeActivity(required = false) {
    const snapshot = getState(), target = snapshot?.workspace_key;
    if (!host || !target) return;
    const tasks = runningProgrammeTasks(snapshot);
    if (!tasks.length) { resetProgrammeTracking(); return; }
    const signature = tasks.map(task => task.id + ':' + task.payload.programme_id).sort().join('|');
    let request = programmeRead;
    if (!request || request.workspace !== target || request.signature !== signature) {
      request = {workspace: target, signature, epoch: programmeEpoch, promise: null};
      programmeRead = request;
      request.promise = Promise.allSettled(tasks.map(async task => {
        const path = '/api/programmes/detail?workspace=' + encodeURIComponent(target) + '&programme_id=' + encodeURIComponent(task.payload.programme_id);
        const status = await api(path);
        if (!status || !Array.isArray(status.runs) || typeof status.active !== 'boolean' ||
            (status.programme_id || status.id) !== task.payload.programme_id)
          throw Error('The programme detail response does not match its retained operation.');
        return {task_id: task.id, status};
      })).then(results => {
        const records = results.filter(row => row.status === 'fulfilled').map(row => row.value);
        const errors = results.filter(row => row.status === 'rejected').map(row => row.reason?.message || String(row.reason));
        if (host && programmeRead === request && request.epoch === programmeEpoch && getState()?.workspace_key === target) {
          programmeStatuses = records;
          programmeMessage = errors.length ? 'Programme progress could not be refreshed: ' + [...new Set(errors)].join(' ') : '';
          paint();
        }
        return {records, errors};
      }).finally(() => { if (programmeRead === request) programmeRead = null; });
    }
    const result = await request.promise;
    if (required && result.errors.length) throw Error('Refresh the active programme before queueing these cases. ' + result.errors.join(' '));
    return result;
  }

  function storageKey(key) { return 'upstate-run-desk-v1:' + key; }
  function initialDraft(snapshot) {
    const data = snapshot.data;
    const last = [...(data.runs || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    const grid = (data.grids || []).find(row => row.id === last?.selection?.grid_id && row.state === 'complete') ||
      (data.grids || []).find(row => row.state === 'complete');
    const profile = (data.profiles || []).find(row => row.id === last?.selection?.profile_id) || data.profiles?.[0];
    const baseline = (data.scenarios || []).find(row => row.kind === 'baseline');
    const selectedScenario = (data.scenarios || []).find(row => row.id === last?.selection?.scenario_id) || baseline || data.scenarios?.[0];
    return {schema: 'upstate.operator-run-desk/v1', project_id: data.project.id, grid_id: grid?.id || '',
      profile_ids: profile ? [profile.id] : [], scenario_ids: [...new Set([baseline?.id, selectedScenario?.id].filter(Boolean))],
      baseline_scenario_id: baseline?.id || '', excluded: []};
  }
  function parseDraft(value, snapshot) {
    if (!value || value.schema !== 'upstate.operator-run-desk/v1' || value.project_id !== snapshot.data.project.id)
      throw Error('Open the run selection in its original scientific project.');
    for (const key of ['profile_ids', 'scenario_ids']) {
      if (!Array.isArray(value[key]) || value[key].some(id => typeof id !== 'string' || !idPattern.test(id)) ||
          new Set(value[key]).size !== value[key].length) throw Error('The run selection contains invalid ' + key.replaceAll('_', ' ') + '.');
    }
    if (value.grid_id && !idPattern.test(value.grid_id)) throw Error('The run selection has an invalid grid identity.');
    if (value.baseline_scenario_id && !idPattern.test(value.baseline_scenario_id)) throw Error('The run selection has an invalid baseline identity.');
    return {schema: value.schema, project_id: value.project_id, grid_id: value.grid_id || '',
      profile_ids: [...value.profile_ids], scenario_ids: [...value.scenario_ids],
      baseline_scenario_id: value.baseline_scenario_id || '',
      excluded: Array.isArray(value.excluded) ? value.excluded.filter(key => typeof key === 'string' &&
        key.split(':').length === 3 && key.split(':').every(id => idPattern.test(id))) : []};
  }
  function synchronize(snapshot) {
    if (!snapshot?.data) return;
    current = snapshot;
    if (workspaceKey === snapshot.workspace_key && draft) return;
    workspaceKey = snapshot.workspace_key;
    resetProgrammeTracking();
    draft = initialDraft(snapshot);
    notice = ''; storageMessage = ''; page = 0; filter = 'all'; search = '';
    try {
      const value = localStorage.getItem(storageKey(workspaceKey));
      if (value) draft = parseDraft(JSON.parse(value), snapshot);
    } catch (error) {
      storageMessage = 'The previous browser selection could not be opened. Retained workspace runs are available below.';
    }
  }
  function persist() {
    try { localStorage.setItem(storageKey(workspaceKey), JSON.stringify(draft)); storageMessage = ''; }
    catch { storageMessage = 'Download this run selection to keep it across browser sessions.'; }
  }
  function selectionIssues() {
    if (!current || !draft) return [];
    const data = current.data, issues = [];
    const grid = (data.grids || []).find(row => row.id === draft.grid_id);
    if (!grid) issues.push('Choose a retained model grid.');
    else if (grid.state !== 'complete') issues.push('Complete the selected model grid before preparing its runs.');
    if (!draft.profile_ids.length) issues.push('Select at least one parameter profile.');
    if (!draft.scenario_ids.length) issues.push('Select at least one land-cover scenario.');
    for (const [field, collection, label] of [['profile_ids', 'profiles', 'profile'], ['scenario_ids', 'scenarios', 'scenario']]) {
      for (const id of draft[field]) {
        if (!(data[collection] || []).some(row => row.id === id)) issues.push('The selected ' + label + ' ' + short(id) + ' is unavailable in this workspace.');
      }
    }
    return issues;
  }
  function checkedList(kind, selected) {
    const rows = current.data[kind] || [];
    if (!rows.length) return '<p class="note">Save an original ' + (kind === 'profiles' ? 'parameter profile' : 'land-cover scenario') + ' to select it here.</p>';
    return rows.map(row => '<label class="check"><input type="checkbox" data-rd-focus="' + kind + '-' + escapeHTML(row.id) +
      '" data-rd-choice="' + kind + '" value="' + escapeHTML(row.id) + '"' + (selected.includes(row.id) ? ' checked' : '') +
      (busy ? ' disabled' : '') + '><span><strong>' + escapeHTML(title(row)) + '</strong><small>' +
      escapeHTML(kind === 'profiles' ? 'Table ' + short(row.biophysical_source_id) : row.kind + (row.patches?.length ? ' · ' + row.patches.length + ' retained changes' : '')) +
      '</small></span></label>').join('');
  }
  function stageText(row) {
    const stages = row.run?.stage_summary || row.run?.stages || {};
    const prefix = row.programme ? 'Programme ' + short(row.programme.id) + ' · ' : '';
    const names = Object.entries(stages).filter(([, value]) => value.completed_at).map(([name]) => name === 'ndr' || name === 'sdr' ? name.toUpperCase() : name.replaceAll('_', ' '));
    if (names.length) return prefix + names.join(' · ') + ' retained';
    return prefix + (row.run ? 'Original native stages appear as they complete.' : 'Preparation retains the original input selection.');
  }
  function tableRows(rows) {
    return rows.map(row => '<tr><td><input type="checkbox" data-rd-row="' + escapeHTML(row.key) + '" data-rd-focus="cell-' +
      escapeHTML(row.key) + '" aria-label="Select ' + escapeHTML(title(row.scenario)) + ' with ' + escapeHTML(title(row.profile)) + '"' +
      (row.selected ? ' checked' : '') + (busy ? ' disabled' : '') + '></td><td class="name-cell"><strong>' + escapeHTML(title(row.scenario)) +
      '</strong><small>' + escapeHTML(title(row.profile)) + '</small><small class="mono">' + escapeHTML(row.run ? short(row.run.id) : 'Selection ' + short(row.scenario.id)) +
      '</small></td><td><span class="status ' + escapeHTML(row.state) + '">' + escapeHTML(row.label) + '</span><small class="rd-stage">' +
      escapeHTML(stageText(row)) + '</small>' + ((row.task?.error || row.run?.error) ? '<small class="rd-error">' +
      escapeHTML(row.task?.error?.message || row.run?.error?.message || 'Open the retained task for the original error.') + '</small>' : '') +
      '</td>' + ['nitrogen_export', 'phosphorus_export', 'sediment_export'].map(key => {
        const artifact = row.run?.artifacts?.[key];
        return '<td class="number-cell">' + quantity(artifact?.sum) + (artifact ? '<small>' + escapeHTML(artifact.sum_units || artifact.units || '') +
          '</small><small>' + quantity(artifact.valid_cells) + ' valid cells</small>' : '') + '</td>';
      }).join('') + '<td><div class="rd-row-actions">' +
      (row.run ? htmlButton('record', 'Run', {id: row.run.id}) + htmlButton('log', 'Native log', {id: row.run.id}) : '') +
      (row.task ? htmlButton('task', 'Operation', {id: row.task.id}) : '') +
      (row.preparable ? htmlButton('prepare-one', row.task && resumableStates.has(row.task.state) ? 'Resume preparation' : 'Prepare', {key: row.key}, busy) : '') +
      (row.startable ? htmlButton('start-one', row.run.state === 'prepared' ? 'Queue run' : 'Continue run', {key: row.key}, busy) : '') +
      '</div></td></tr>').join('');
  }
  function matchingRows(rows) {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(row => (!query || [title(row.profile), title(row.scenario), row.run?.id, row.label].join(' ').toLocaleLowerCase().includes(query)) &&
      (filter === 'all' || filter === 'selected' && row.selected || filter === 'missing' && row.preparable ||
       filter === 'ready' && row.startable || filter === 'active' && ['preparing', 'queued', 'running'].includes(row.state) ||
       filter === 'complete' && row.state === 'complete' || filter === 'attention' && row.state === 'attention'));
  }
  function renderGroups(rows) {
    const groups = runDeskComparisons(current, draft, rows);
    if (!groups.length) return '<p class="note">Select an unchanged baseline and at least one land-cover alternative under the same profile to prepare a comparison or delivery.</p>';
    return groups.map(group => '<article class="rd-comparison"><div><h3>' + escapeHTML(title(group.profile)) + '</h3><p>' +
      escapeHTML(title(group.baseline.scenario)) + ' → ' + group.complete.length + ' of ' + group.alternatives.length + ' selected alternatives complete.</p>' +
      '<small>' + (group.baseline.run?.state === 'complete' ? 'Baseline complete. ' : 'Baseline awaiting completion. ') +
      'Every pair uses the selected grid and this original parameter profile.</small></div><div class="rd-row-actions">' +
      (group.retained ? htmlButton('comparison-open', 'Open retained comparison', {id: group.retained.id}) :
        group.task ? htmlButton('task', 'Comparison ' + group.task.state, {id: group.task.id}) :
        htmlButton('compare', 'Compare ' + group.complete.length + ' completed alternative' + (group.complete.length === 1 ? '' : 's'), {profile: group.profileId}, busy || group.runIds.length < 2)) +
      htmlButton('delivery', 'Prepare delivery from completed pairs', {profile: group.profileId}, busy || group.runIds.length < 2) + '</div></article>').join('');
  }
  function renderProgrammes(rows) {
    if (!programmeOpener()) return '';
    const groups = runDeskProgrammes(current, draft, rows);
    if (!groups.length) return '<div class="section-body"><p class="note">Choose a complete working grid and check an unchanged baseline under a selected profile to open its execution programme.</p></div>';
    return '<div class="section-body"><p class="note">Retain a programme for each profile to prepare and execute its selected runs, reuse completed native stages, and continue from saved progress.</p>' +
      groups.map(group => '<article class="rd-comparison"><div><h3>' + escapeHTML(title(group.profile)) + '</h3><p>' +
        group.selection.runs.length + ' selected native run' + (group.selection.runs.length === 1 ? '' : 's') +
        ' · unchanged baseline: ' + escapeHTML(title(group.baseline.scenario)) + '</p><small>Uses this working grid, this profile and the checked land-cover alternatives.</small></div>' +
        '<div class="rd-row-actions">' + htmlButton('programme', 'Inspect execution programme', {profile: group.profileId}, busy || !!selectionIssues().length) +
        '</div></article>').join('') + '</div>';
  }
  function paint() {
    if (!host || !current || !draft) return;
    const focused = host.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.dataset.rdFocus;
    const start = focused?.selectionStart, end = focused?.selectionEnd;
    const scroll = [...host.querySelectorAll('[data-rd-scroll]')].map(node => [node.dataset.rdScroll, node.scrollLeft, node.scrollTop]);
    const rows = runDeskRows(current, draft, programmeStatuses), selected = rows.filter(row => row.selected), issues = selectionIssues();
    const shown = matchingRows(rows), pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
    page = Math.min(page, pageCount - 1);
    const visible = shown.slice(page * pageSize, (page + 1) * pageSize);
    const preparable = selected.filter(row => row.preparable).length;
    const startable = selected.filter(row => row.startable).length;
    const queued = new Set(selected.flatMap(row => row.queuedTask ? [row.queuedTask.id] : [])).size;
    const grids = current.data.grids || [];
    const baselineChoices = (current.data.scenarios || []).filter(row => row.kind === 'baseline' && draft.scenario_ids.includes(row.id));
    host.innerHTML = '<div class="run-desk" data-run-desk><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>' +
      '<h1>Native run desk</h1><p>Select retained scientific inputs, prepare their run matrix, and queue the original NDR and SDR engines.</p></div>' +
      '<div class="page-actions">' + htmlButton('download-selection', 'Download run selection', {}, busy) + htmlButton('import-selection', 'Open run selection', {}, busy) +
      '</div></header>' +
      '<section class="section"><header class="section-header"><div><h2>1. Select the original inputs</h2><p>Each checked cell is one immutable grid, profile and scenario selection.</p></div></header>' +
      '<div class="section-body rd-selector"><div><label>Complete model grid<select data-rd-field="grid_id" data-rd-focus="grid"' + (busy ? ' disabled' : '') + '>' +
      option('', 'Choose a retained grid…', !draft.grid_id) + grids.map(row => option(row.id, title(row) + ' · ' + row.state, row.id === draft.grid_id, row.state !== 'complete')).join('') +
      '</select></label><p class="note">' + escapeHTML(grids.find(row => row.id === draft.grid_id)?.grid?.resolution_m ?
        'Working ' + grids.find(row => row.id === draft.grid_id).grid.resolution_m + ' m grid; reporting boundary and upstream model context remain in its retained record.' :
        'Prepare the actual reporting grid in Model grids before queueing native runs.') + '</p>' +
      '<label>Unchanged baseline for paired results<select data-rd-field="baseline_scenario_id" data-rd-focus="baseline"' + (busy ? ' disabled' : '') + '>' +
      option('', 'Choose a selected baseline…', !draft.baseline_scenario_id) + baselineChoices.map(row => option(row.id, title(row), row.id === draft.baseline_scenario_id)).join('') +
      '</select></label><div class="rd-row-actions"><button type="button" data-view="grids" class="small">Model grids</button>' +
      '<button type="button" data-view="profiles" class="small">Parameter profiles</button><button type="button" data-view="scenarios" class="small">Scenarios</button></div></div>' +
      '<fieldset><legend>Parameter profiles</legend><div class="rd-choice-actions">' + htmlButton('select-profiles', 'Select all', {}, busy) +
      htmlButton('clear-profiles', 'Clear', {}, busy) + '</div><div class="rd-choices" data-rd-scroll="profiles">' + checkedList('profiles', draft.profile_ids) + '</div></fieldset>' +
      '<fieldset><legend>Land-cover scenarios</legend><div class="rd-choice-actions">' + htmlButton('select-scenarios', 'Select all', {}, busy) +
      htmlButton('clear-scenarios', 'Clear', {}, busy) + '</div><div class="rd-choices" data-rd-scroll="scenarios">' + checkedList('scenarios', draft.scenario_ids) + '</div></fieldset></div>' +
      (issues.length ? '<div class="rd-selection-note" role="status">' + issues.map(escapeHTML).join('<br>') + '</div>' : '') +
      (storageMessage ? '<p class="rd-selection-note">' + escapeHTML(storageMessage) + '</p>' : '') + '</section>' +
      '<section class="section"><header class="section-header"><div><h2>2. Prepare and queue native runs</h2><p>' + selected.length + ' of ' + rows.length +
      ' matrix cells selected · ' + selected.filter(row => row.state === 'complete').length + ' complete · ' +
      selected.filter(row => ['queued', 'running', 'preparing'].includes(row.state)).length + ' active.</p></div></header>' +
      renderProgrammes(rows) + '<div class="rd-operation-bar">' + htmlButton('prepare', 'Prepare missing (' + preparable + ')', {}, busy || !!issues.length || !preparable, true) +
      htmlButton('start', 'Queue / continue prepared runs (' + startable + ')', {}, busy || !!issues.length || !startable, true) +
      htmlButton('cancel', 'Cancel queued (' + queued + ')', {}, busy || !queued) +
      '<button type="button" data-action="runtime" class="small">Runtime versions</button></div>' +
      '<p class="rd-explanation">Preparation saves the original selections. Queueing starts the existing serial operator queue; queued model runs continue after this tab closes. Continuation reuses the original native stages.</p>' +
      '<div class="rd-notice" role="status" aria-live="polite">' + escapeHTML(submission?.workspace === workspaceKey ? submission.message : notice) + '</div>' +
      (programmeMessage ? '<div class="rd-notice" role="status">' + escapeHTML(programmeMessage) + '</div>' : '') +
      '<div class="rd-filter-bar"><label>Find a selected scenario or profile<input data-rd-field="search" data-rd-focus="search" value="' + escapeHTML(search) +
      '" type="search" placeholder="Scenario, profile, run ID or status"></label><label>Show<select data-rd-field="filter" data-rd-focus="filter">' +
      [['all','All matrix cells'],['selected','Selected cells'],['missing','Needs preparation'],['ready','Can queue / continue'],['active','Active operations'],['complete','Complete runs'],['attention','Needs attention']]
        .map(([id, label]) => option(id, label, filter === id)).join('') + '</select></label><div class="rd-row-actions">' +
      htmlButton('select-cells', 'Select all cells', {}, busy) + htmlButton('select-incomplete', 'Select incomplete', {}, busy) + htmlButton('clear-cells', 'Clear cells', {}, busy) +
      '</div></div><p class="rd-filter-note">Actions apply to all checked cells, including other pages. ' + shown.length + ' cells match the current display filter.</p>' +
      '<div class="table-scroll" data-rd-scroll="matrix"><table><thead><tr><th scope="col">Use</th><th scope="col">Scenario / profile</th><th scope="col">Native progress</th>' +
      '<th scope="col">Nitrogen</th><th scope="col">Phosphorus</th><th scope="col">Sediment</th><th scope="col">Open / continue</th></tr></thead><tbody>' +
      (visible.length ? tableRows(visible) : '<tr><td colspan="7">Select the original inputs above or change the display filter.</td></tr>') + '</tbody></table></div>' +
      '<footer class="rd-pager"><span>Page ' + (page + 1) + ' of ' + pageCount + ' · ' + (shown.length ? page * pageSize + 1 : 0) + '–' + Math.min((page + 1) * pageSize, shown.length) +
      ' of ' + shown.length + ' cells</span><div>' + htmlButton('previous-page', 'Previous', {}, page === 0) + htmlButton('next-page', 'Next', {}, page + 1 >= pageCount) +
      '</div>' + htmlButton('download-results', 'Download selected native totals', {}, !selected.some(row => row.run)) + '</footer></section>' +
      '<section class="section"><header class="section-header"><div><h2>3. Compare and deliver completed pairs</h2><p>Signed comparison outputs use alternative minus baseline. The completed pairs below retain one common profile and grid.</p></div></header>' +
      '<div class="section-body">' + renderGroups(rows) + '</div></section></div>';
    for (const [key, left, top] of scroll) {
      const node = [...host.querySelectorAll('[data-rd-scroll]')].find(value => value.dataset.rdScroll === key);
      if (node) { node.scrollLeft = left; node.scrollTop = top; }
    }
    if (focusKey) {
      const node = [...host.querySelectorAll('[data-rd-focus]')].find(value => value.dataset.rdFocus === focusKey);
      if (node && !node.disabled) {
        node.focus({preventScroll: true});
        if (typeof start === 'number' && typeof node.setSelectionRange === 'function') {
          try { node.setSelectionRange(start, end); } catch {}
        }
      }
    }
  }
  function update(snapshot) {
    synchronize(snapshot);
    refreshProgrammeActivity().catch(error => { programmeMessage = error.message; paint(); });
    paint();
  }
  function change(event) {
    const node = event.target;
    if (node.dataset.rdField) {
      const field = node.dataset.rdField;
      if (field === 'search') search = node.value;
      else if (field === 'filter') filter = node.value;
      else if (!busy) { draft[field] = node.value; draft.excluded = []; persist(); }
      page = 0; paint(); return;
    }
    if (busy) return;
    if (node.dataset.rdChoice) {
      const field = node.dataset.rdChoice === 'profiles' ? 'profile_ids' : 'scenario_ids';
      const selected = new Set(draft[field]);
      if (node.checked) selected.add(node.value); else selected.delete(node.value);
      draft[field] = [...selected];
      if (!draft.scenario_ids.includes(draft.baseline_scenario_id)) draft.baseline_scenario_id = '';
      if (!draft.baseline_scenario_id) draft.baseline_scenario_id = (current.data.scenarios || []).find(row => row.kind === 'baseline' && draft.scenario_ids.includes(row.id))?.id || '';
      persist(); page = 0; paint();
    }
    if (node.dataset.rdRow) {
      const excluded = new Set(draft.excluded);
      if (node.checked) excluded.delete(node.dataset.rdRow); else excluded.add(node.dataset.rdRow);
      draft.excluded = [...excluded]; persist(); paint();
    }
  }
  function input(event) { if (event.target.dataset.rdField === 'search') change(event); }
  function mount(node, snapshot = getState()) {
    if (host !== node) { detach(); host = node; host.addEventListener('change', change); host.addEventListener('input', input); }
    update(snapshot);
  }
  function detach() {
    if (host) { host.removeEventListener('change', change); host.removeEventListener('input', input); }
    host = null;
    resetProgrammeTracking();
  }
  function assertWorkspace(expected) {
    if (getState()?.workspace_key !== expected) throw Error('Workspace changed. Queued operations remain with their original workspace; reopen its run desk to continue.');
  }
  async function operationId(workspace, action, payload) {
    const bytes = new TextEncoder().encode(canonical({workspace, action, payload}));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return 'run_desk_' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  async function submitOriginal(target, action, payload) {
    assertWorkspace(target);
    const identity = canonical(payload);
    const tasks = (getState()?.tasks || []).filter(row => row.workspace === target && row.action === action && canonical(row.payload) === identity)
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
    const active = tasks.find(row => activeStates.has(row.state));
    if (active) return {task: active, reused: true};
    const latest = tasks[0];
    if (latest?.state === 'complete') return {task: latest, reused: true};
    const recover = latest && resumableStates.has(latest.state) ? latest : null;
    if (recover) {
      const task = await api('/api/task/resume', {method: 'POST', body: {id: recover.id}});
      return {task, resumed: true};
    }
    const operation_id = await operationId(target, action, payload);
    assertWorkspace(target);
    let task;
    try {
      task = await api('/api/actions', {method: 'POST', body: {workspace: target, action, payload, operation_id}});
    } catch (error) {
      // A lost response must reconcile the same operation before another submit.
      if (error.status && error.status < 500) throw error;
      let observed;
      try {
        const snapshot = await api('/api/state?workspace=' + encodeURIComponent(target));
        observed = snapshot.tasks?.find(row => row.operation_id === operation_id && row.action === action && canonical(row.payload) === identity);
      } catch {}
      if (!observed) throw error;
      task = observed;
    }
    if (resumableStates.has(task.state)) {
      assertWorkspace(target);
      return {task: await api('/api/task/resume', {method: 'POST', body: {id: task.id}}), resumed: true};
    }
    return {task, reused: task.state === 'complete'};
  }
  async function operate(mode, key) {
    if (busy) return;
    synchronize(getState());
    const issues = selectionIssues();
    if (mode !== 'cancel' && issues.length) throw Error(issues.join(' '));
    const target = current.workspace_key;
    const cancelTasks = new Set();
    let rows = [], completed = 0, recovered = 0, reused = 0, alreadyStarted = 0;
    busy = true; submission = {workspace: target, message: 'Reading retained native operation progress…'}; paint();
    try {
      const activity = mode !== 'cancel' ? await refreshProgrammeActivity(true) : null;
      assertWorkspace(target);
      synchronize(getState());
      rows = runDeskRows(current, draft, activity?.records || programmeStatuses).filter(row => key ? row.key === key : row.selected);
      rows = rows.filter(row => mode === 'prepare' ? row.preparable : mode === 'start' ? row.startable : !!row.queuedTask);
      if (!rows.length) { notice = 'The selected cells already reflect the retained operator state.'; return; }
      submission.message = 'Submitting original ' + mode + ' operations…'; paint();
      for (const row of rows) {
        assertWorkspace(target);
        if (mode === 'cancel') {
          if (cancelTasks.has(row.queuedTask.id)) continue;
          cancelTasks.add(row.queuedTask.id);
          try { await api('/api/task/cancel', {method: 'POST', body: {id: row.queuedTask.id}}); }
          catch (error) {
            if (error.code !== 'TASK_RUNNING') throw error;
            alreadyStarted++;
            submission.message = alreadyStarted + ' original operation' + (alreadyStarted === 1 ? ' has' : 's have') + ' already started; cancelling the remaining queued selections…';
            paint(); continue;
          }
        } else {
          const result = await submitOriginal(target, mode === 'prepare' ? 'run.prepare' : 'run.start',
            mode === 'prepare' ? row.selection : {run_id: row.run.id});
          if (result.resumed) recovered++;
          if (result.reused) reused++;
        }
        completed++;
        submission.message = completed + ' of ' + rows.length + ' original operations ' + (mode === 'cancel' ? 'cancelled before start.' : 'retained by the operator.');
        paint();
      }
      notice = mode === 'cancel' ? completed + ' queued operations cancelled' + (alreadyStarted ? ' · ' + alreadyStarted + ' already started' : '') + '.' :
        completed + ' operations retained' + (recovered ? ' · ' + recovered + ' original tasks resumed' : '') +
        (reused ? ' · ' + reused + ' existing operations reused' : '') + '. ' +
        (mode === 'prepare' ? 'When preparation completes, queue the ready runs.' : 'The native server queue carries these runs.');
      toast(notice);
    } catch (error) {
      notice = (rows.length ? completed + ' of ' + rows.length + ' requests completed. ' : '') + error.message +
        ' Reopen or refresh this desk to continue the retained selection.';
      throw Error(notice);
    } finally {
      busy = false; submission = null; paint();
      await refreshState({force: true});
    }
  }
  function download(name, body, type) {
    const url = URL.createObjectURL(new Blob([body], {type}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadSelection() {
    const snapshot = getState();
    const value = {...draft, exported_at: new Date().toISOString(), project_title: snapshot.data.project.title,
      retained_run_ids: runDeskRows(snapshot, draft).filter(row => row.selected && row.run).map(row => row.run.id)};
    download('upper-savannah-run-selection.json', JSON.stringify(value, null, 2) + '\n', 'application/json');
  }
  async function importSelection(file) {
    if (!file) return;
    if (busy) throw Error('Wait for the current queue request to finish.');
    const target = getState().workspace_key;
    const parsed = JSON.parse(await file.text());
    assertWorkspace(target);
    const imported = parseDraft(parsed, getState());
    const data = getState().data;
    if (!(data.grids || []).some(row => row.id === imported.grid_id) ||
        imported.profile_ids.some(id => !(data.profiles || []).some(row => row.id === id)) ||
        imported.scenario_ids.some(id => !(data.scenarios || []).some(row => row.id === id))) {
      throw Error('The original grid, profiles or scenarios are absent. Open the complete restored scientific workspace before this run selection.');
    }
    draft = imported; persist(); page = 0; filter = 'all'; search = '';
    notice = 'Opened the original run selection. Existing run records and tasks are resolved from this workspace.'; paint();
  }
  function downloadResults() {
    const columns = ['project_id','grid_id','profile_id','profile_title','scenario_id','scenario_title','scenario_kind','run_id','invest_version','run_state','export','annual_reporting_total','total_units','valid_cells'];
    const records = [];
    for (const row of runDeskRows(getState(), draft).filter(value => value.selected && value.run)) {
      for (const metric of ['nitrogen_export', 'phosphorus_export', 'sediment_export']) {
        const artifact = row.run.artifacts?.[metric];
        records.push([current.data.project.id, row.selection.grid_id, row.profile.id, title(row.profile), row.scenario.id, title(row.scenario), row.scenario.kind,
          row.run.id, row.run.selection.invest_version, row.run.state, metric, artifact?.sum, artifact?.sum_units || artifact?.units, artifact?.valid_cells]);
      }
    }
    const cell = value => {
      let text = value === null || value === undefined ? '' : String(value);
      if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    download('upper-savannah-native-run-totals.csv', [columns, ...records].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }
  async function compare(profileId, delivery = false) {
    synchronize(getState());
    const group = runDeskComparisons(current, draft).find(row => row.profileId === profileId);
    if (!group || group.runIds.length < 2) throw Error('Complete the selected baseline and at least one selected land-cover alternative under this profile.');
    if (delivery) return openDelivery({baseline_run_id: group.runIds[0], scenario_run_ids: group.runIds.slice(1)});
    if (group.retained) return openItem('comparisons', group.retained.id);
    if (group.task) return showTask(group.task.id);
    if (busy) return;
    const target = current.workspace_key;
    busy = true; submission = {workspace: target, message: 'Retaining the original completed-run comparison…'}; paint();
    try {
      const result = await submitOriginal(target, 'run.compare', {run_ids: group.runIds});
      notice = 'Original comparison ' + result.task.state + '.';
      await refreshState({force: true});
      assertWorkspace(target);
      return showTask(result.task.id);
    } finally { busy = false; submission = null; paint(); }
  }
  async function dispatch(button) {
    const action = button.dataset.action?.replace(/^run-desk-/, '');
    if (['prepare','start','cancel'].includes(action)) return operate(action);
    if (action === 'prepare-one' || action === 'start-one') return operate(action === 'prepare-one' ? 'prepare' : 'start', button.dataset.key);
    if (action === 'record') return openItem('runs', button.dataset.id);
    if (action === 'task') return showTask(button.dataset.id);
    if (action === 'log') return showRunLog(button.dataset.id);
    if (action === 'comparison-open') return openItem('comparisons', button.dataset.id);
    if (action === 'programme') {
      if (busy) return;
      synchronize(getState());
      const issues = selectionIssues();
      if (issues.length) throw Error(issues.join(' '));
      const group = runDeskProgrammes(current, draft).find(row => row.profileId === button.dataset.profile);
      if (!group) throw Error('Check an unchanged baseline under this profile to open its retained execution programme.');
      const open = programmeOpener();
      if (!open) throw Error('The current application has no programme controls attached.');
      return open(group.selection);
    }
    if (action === 'compare' || action === 'delivery') return compare(button.dataset.profile, action === 'delivery');
    if (action === 'download-selection') return downloadSelection();
    if (action === 'download-results') return downloadResults();
    if (action === 'import-selection') {
      if (busy) return;
      const target = getState().workspace_key;
      const picker = document.createElement('input');
      picker.type = 'file'; picker.accept = '.json,application/json'; picker.hidden = true;
      picker.addEventListener('change', async () => {
        try { assertWorkspace(target); await importSelection(picker.files?.[0]); }
        catch (error) { notice = error.message; paint(); }
        finally { picker.remove(); }
      }, {once: true});
      picker.addEventListener('cancel', () => picker.remove(), {once: true});
      document.body.append(picker); picker.click(); return;
    }
    if (action === 'previous-page' || action === 'next-page') { page = Math.max(0, page + (action === 'next-page' ? 1 : -1)); paint(); return; }
    if (busy) return;
    if (action === 'select-profiles') draft.profile_ids = (current.data.profiles || []).map(row => row.id);
    if (action === 'clear-profiles') draft.profile_ids = [];
    if (action === 'select-scenarios') draft.scenario_ids = (current.data.scenarios || []).map(row => row.id);
    if (action === 'clear-scenarios') draft.scenario_ids = [];
    if (!draft.scenario_ids.includes(draft.baseline_scenario_id)) draft.baseline_scenario_id = '';
    if (!draft.baseline_scenario_id) draft.baseline_scenario_id = (current.data.scenarios || []).find(row => row.kind === 'baseline' && draft.scenario_ids.includes(row.id))?.id || '';
    const rows = runDeskRows(current, draft);
    if (action === 'select-cells') draft.excluded = [];
    if (action === 'clear-cells') draft.excluded = rows.map(row => row.key);
    if (action === 'select-incomplete') draft.excluded = rows.filter(row => row.state === 'complete').map(row => row.key);
    persist(); page = 0; paint();
  }
  return {mount, update, detach, dispatch};
}
