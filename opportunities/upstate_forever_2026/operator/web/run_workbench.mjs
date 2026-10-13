/**
 * Native run execution desk over the original operator task queue.
 * Scientific selections and calculations remain in model.workspace/native.
 */
import {attachRunAssembly} from './run_assembly_workbench.mjs';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const activeStates = new Set(['queued', 'running']);
const resumableStates = new Set(['failed', 'interrupted', 'cancelled']);
const idPattern = /^[0-9a-f]{64}$/;
const pairedProgrammeTask = task => task?.action === 'compute.programme.pair-completion' && task.payload?.run === true;
const executingProgrammeTask = task => task?.action === 'compute.programme.run' || pairedProgrammeTask(task);
const pageSize = 50;
const modelOrder = ['ndr', 'sdr'];
const modelOutputs = {ndr: ['nitrogen_export', 'phosphorus_export'], sdr: ['sediment_export']};
const allOutputs = modelOrder.flatMap(model => modelOutputs[model]);
const quantity = value => value === null || value === undefined ? '—' :
  typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 6}) : escapeHTML(value);
const title = row => row?.title || row?.metadata?.title || row?.spec?.title || row?.selection?.title || String(row?.id || '').slice(0, 12);
const short = value => String(value || '').slice(0, 12);
const modelsOf = value => {
  const original = Array.isArray(value) ? value : value?.models;
  const values = original === undefined ? modelOrder : original;
  if (!Array.isArray(values) || !values.length || values.some(name => typeof name !== 'string'))
    throw Error('Select the native nutrient model, sediment model, or both.');
  const names = values.map(name => name.trim().toLowerCase());
  if (new Set(names).size !== names.length || names.some(name => !modelOrder.includes(name)))
    throw Error('Select each native model once: NDR or SDR.');
  return modelOrder.filter(name => names.includes(name));
};
const modelKey = models => modelsOf(models).join('+');
const modelLabel = models => modelsOf(models).map(name => name.toUpperCase()).join(' + ');
const tripleKey = selection => [selection.grid_id, selection.profile_id, selection.scenario_id].join(':');
const selectionKey = selection => tripleKey(selection) + ':' + modelKey(selection);
const requestModels = (selection, grids) => modelsOf(Object.hasOwn(selection, 'models') ?
  selection : grids.get(selection.grid_id)?.spec);
const nativeSelection = (selection, models) => ({
  grid_id: selection.grid_id, profile_id: selection.profile_id, scenario_id: selection.scenario_id,
  ...(modelKey(models) === 'ndr+sdr' ? {} : {models: modelsOf(models)})
});
const selectedOutputsComplete = run => !!run && run.state === 'complete' &&
  modelsOf(run.selection).every(model => Object.hasOwn(run.stages || run.stage_summary || {}, model) &&
    modelOutputs[model].every(name => !!run.artifacts?.[name]));
const reusableStage = (run, model) => {
  const stage = run?.stages?.[model] || run?.stage_summary?.[model];
  const fileCount = stage?.files ? Object.keys(stage.files).length : stage?.file_count;
  return !activeStates.has(run?.state) && modelsOf(run?.selection).includes(model) &&
    !!stage?.completed_at && Number.isInteger(fileCount) && fileCount > 0;
};
const fullOutputsComplete = run => selectedOutputsComplete(run) &&
  modelKey(run.selection) === 'ndr+sdr' && allOutputs.every(name => !!run.artifacts?.[name]);
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


function comparisonKey(baselineId, alternativeIds) {
  return baselineId + ':' + [...alternativeIds].sort().join(',');
}
function runDeskIndex(snapshot) {
  const data = snapshot?.data || {};
  const profiles = new Map((data.profiles || []).map(row => [row.id, row]));
  const scenarios = new Map((data.scenarios || []).map(row => [row.id, row]));
  const grids = new Map((data.grids || []).map(row => [row.id, row]));
  const runs = new Map(), runsById = new Map(), retainedScopes = new Map(), reusableModels = {ndr: false, sdr: false};
  function retainScope(selection, models) {
    const key = tripleKey(selection);
    if (!retainedScopes.has(key)) retainedScopes.set(key, new Map());
    retainedScopes.get(key).set(modelKey(models), models);
  }
  for (const run of data.runs || []) {
    runsById.set(run.id, run);
    const selection = run.selection || {};
    const key = selectionKey(selection), before = runs.get(key);
    if (!before || String(run.created_at || '') > String(before.created_at || '')) runs.set(key, run);
    const models = modelsOf(selection);
    retainScope(selection, models);
    for (const model of models) if (reusableStage(run, model)) reusableModels[model] = true;
  }
  const tasks = [...(snapshot?.tasks || [])]
    .filter(task => !task.workspace || task.workspace === snapshot.workspace_key)
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  const preparationBySelection = new Map(), startByRun = new Map(), runningTasks = new Map();
  const activeComparisons = new Map(), comparisons = new Map();
  for (const task of tasks) {
    if (executingProgrammeTask(task) && task.state === 'running') runningTasks.set(task.id, task);
    if (task.action === 'run.compare' && activeStates.has(task.state) && Array.isArray(task.payload?.run_ids)) {
      const key = comparisonKey(task.payload.run_ids[0], task.payload.run_ids.slice(1));
      if (!activeComparisons.has(key)) activeComparisons.set(key, task);
    }
    const index = task.action === 'run.prepare' ? preparationBySelection : task.action === 'run.start' ? startByRun : null;
    if (!index) continue;
    let key = task.payload?.run_id;
    if (task.action === 'run.prepare') {
      const payload = task.payload || {}, models = requestModels(payload, grids);
      key = selectionKey(nativeSelection(payload, models));
      retainScope(payload, models);
    }
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(task);
  }
  for (const row of data.comparisons || []) {
    const key = comparisonKey(row.baseline_run_id, (row.alternatives || []).map(value => value.run_id));
    if (!comparisons.has(key)) comparisons.set(key, row);
  }
  return {data: snapshot?.data, taskSource: snapshot?.tasks, workspace: snapshot?.workspace_key,
    profiles, scenarios, grids, runs, runsById, tasks, retainedScopes, preparationBySelection, startByRun,
    runningTasks, activeComparisons, comparisons, reusableModels};
}
function selectedFamilies(rows, compatibleOnly = false) {
  const families = new Map();
  for (const row of rows) {
    if (!row.selected || compatibleOnly && !row.compatible) continue;
    const id = row.selection.profile_id;
    if (!families.has(id)) families.set(id, new Map());
    const scopes = families.get(id);
    if (!scopes.has(row.modelKey)) scopes.set(row.modelKey, []);
    scopes.get(row.modelKey).push(row);
  }
  return families;
}

export function runDeskRows(snapshot, draft, programmeStatuses = [], index = runDeskIndex(snapshot)) {
  const {profiles, scenarios, grids, runs, tasks, preparationBySelection, startByRun, runningTasks} = index;
  const requested = requestModels({grid_id: draft.grid_id, ...(draft.models ? {models: draft.models} : {})}, grids);
  const requestedKey = modelKey(requested), gridModels = modelsOf(grids.get(draft.grid_id)?.spec);
  const programmeScopes = new Map();
  function retainScope(selection, models) {
    const key = tripleKey(selection);
    if (!programmeScopes.has(key)) programmeScopes.set(key, new Map());
    programmeScopes.get(key).set(modelKey(models), models);
  }
  const programmeByRun = new Map(), programmeBySelection = new Map();
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
      const original = binding.native_selection || binding.selection;
      if (original && ['grid_id', 'profile_id', 'scenario_id'].every(key => idPattern.test(original[key] || ''))) {
        const models = binding.native_selection ? modelsOf(original) :
          requestModels({...original, ...(binding.models ? {models: binding.models} : {})}, grids);
        const selection = nativeSelection(original, models);
        const key = selectionKey(selection);
        retainScope(selection, models);
        if (!programmeBySelection.has(key) || programme.current) programmeBySelection.set(key, programme);
      }
    }
  }
  const excluded = new Set(draft.excluded || []), included = new Set(draft.included || []);
  const rows = [];
  for (const profileId of draft.profile_ids || []) {
    const profile = profiles.get(profileId);
    if (!profile) continue;
    const profileModels = modelsOf(profile);
    for (const scenarioId of draft.scenario_ids || []) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario) continue;
      const choice = {grid_id: draft.grid_id, profile_id: profileId, scenario_id: scenarioId};
      const originalKey = tripleKey(choice);
      const scopes = new Map([[requestedKey, requested], ...(index.retainedScopes.get(originalKey) || []), ...(programmeScopes.get(originalKey) || [])]);
      for (const [scopeKey, models] of scopes) {
        const selection = nativeSelection(choice, models);
        const key = selectionKey(selection);
        const run = runs.get(key);
        const preparations = preparationBySelection.get(key) || [];
        const starts = run ? startByRun.get(run.id) || [] : [];
        const activePreparation = preparations.find(task => activeStates.has(task.state));
        const activeStart = starts.find(task => activeStates.has(task.state));
        const programme = (run && programmeByRun.get(run.id)) || programmeBySelection.get(key);
        const task = programme?.task || activeStart || activePreparation || starts[0] || preparations[0];
        const unavailable = models.filter(name => !gridModels.includes(name) || !profileModels.includes(name));
        const compatible = !unavailable.length;
        const complete = selectedOutputsComplete(run);
        let state = 'missing', label = 'Needs preparation';
        if (complete) { state = 'complete'; label = modelLabel(models) + ' complete'; }
        else if (programme) { state = programme.current ? 'running' : 'queued'; label = programme.current ? 'Running in programme' : 'Selected in active programme'; }
        else if (run?.state === 'complete') { state = 'attention'; label = 'Selected exports need attention'; }
        else if (activeStart) { state = activeStart.state; label = activeStart.state === 'queued' ? 'Queued to run' : 'Running'; }
        else if (activePreparation) { state = 'preparing'; label = activePreparation.state === 'running' ? 'Preparing' : 'Preparation queued'; }
        else if (run && starts[0] && resumableStates.has(starts[0].state)) { state = 'attention'; label = starts[0].state === 'failed' ? 'Run needs attention' : 'Continuation available'; }
        else if (run?.state === 'prepared') { state = 'ready'; label = 'Ready to run'; }
        else if (run) { state = 'attention'; label = run.state === 'failed' ? 'Run needs attention' : 'Continuation available'; }
        else if (task && resumableStates.has(task.state)) { state = 'attention'; label = 'Preparation needs attention'; }
        else if (!compatible) { state = 'attention'; label = 'Grid or profile excludes ' + modelLabel(unavailable); }
        rows.push({
          key, selection, models, modelKey: scopeKey, profile, scenario, run, task, state, label, compatible, programme,
          selected: !excluded.has(key) && !(excluded.has(originalKey) && scopeKey === requestedKey) &&
            (scopeKey === requestedKey || included.has(key)),
          preparable: compatible && !run && !activePreparation && !programme,
          startable: compatible && !!run && run.state !== 'complete' && !activeStart && !activePreparation && !programme,
          queuedTask: [activeStart, activePreparation].find(value => value?.state === 'queued')
        });
      }
    }
  }
  return rows;
}

export function runDeskComparisons(snapshot, draft, rows = null, index = runDeskIndex(snapshot)) {
  rows ||= runDeskRows(snapshot, draft, [], index);
  const baseline = index.scenarios.get(draft.baseline_scenario_id);
  if (!baseline || baseline.kind !== 'baseline') return [];
  const families = selectedFamilies(rows), groups = [];
  for (const profileId of draft.profile_ids || []) {
    for (const [scopeKey, family] of families.get(profileId) || []) {
      const base = family.find(row => row.scenario.id === baseline.id);
      const alternatives = family.filter(row => row.scenario.id !== baseline.id);
      if (!base || !alternatives.length) continue;
      const complete = alternatives.filter(row => selectedOutputsComplete(row.run));
      // Programmes and comparisons retain every checked scenario. The original
      // mapped-delivery API requires explicit land-cover alternatives, so expose
      // that separate selection instead of silently dropping controls upstream.
      const deliveryAlternatives = alternatives.filter(row => row.scenario.kind === 'landcover');
      const deliveryComplete = deliveryAlternatives.filter(row => fullOutputsComplete(row.run));
      const deliveryRunIds = fullOutputsComplete(base.run) ?
        [base.run.id, ...deliveryComplete.map(row => row.run.id)] : [];
      const runIds = selectedOutputsComplete(base.run) ? [base.run.id, ...complete.map(row => row.run.id)] : [];
      const key = runIds.length > 1 ? comparisonKey(runIds[0], runIds.slice(1)) : '';
      const retained = key ? index.comparisons.get(key) || null : null;
      const task = key ? index.activeComparisons.get(key) || null : null;
      groups.push({key: profileId + ':' + scopeKey, profileId, profile: base.profile, models: base.models,
        modelKey: scopeKey, baseline: base, alternatives, complete, runIds, retained, task,
        deliveryAlternatives, deliveryComplete, deliveryRunIds,
        canDeliver: deliveryRunIds.length > 1});
    }
  }
  return groups;
}

export function runDeskProcessReports(snapshot, draft, rows = null, index = runDeskIndex(snapshot)) {
  rows ||= runDeskRows(snapshot, draft, [], index);
  const baseline = index.scenarios.get(draft.baseline_scenario_id);
  if (!baseline || baseline.kind !== 'baseline') return [];
  const families = selectedFamilies(rows), groups = [];
  for (const profileId of draft.profile_ids || []) {
    for (const [scopeKey, family] of families.get(profileId) || []) {
      const base = family.find(row => row.scenario.id === baseline.id);
      if (!base) continue;
      const alternatives = family.filter(row => row.scenario.id !== baseline.id);
      const selected = [base, ...alternatives];
      const stages = selected.map(row => {
        const completed = {};
        for (const model of row.models) {
          const stage = row.run?.stages?.[model] || row.run?.stage_summary?.[model];
          // Compact state lists retain completion/counts; the destination reads
          // the original stage registry before accepting the entire selection.
          const retained = stage?.files ? !!stage.files['watershed_results_' + model] :
            Number.isInteger(stage?.file_count) && stage.file_count > 0;
          if (stage?.completed_at && retained) completed[model] = stage.completed_at;
        }
        return {row, completed};
      });
      const scopes = [base.models, ...base.models.map(model => [model])]
        .filter((models, position, all) => all.findIndex(value => modelKey(value) === modelKey(models)) === position)
        .map(models => {
          const missing = stages.filter(value => !value.row.run || models.some(model => !value.completed[model]));
          return {models, key: modelKey(models), ready: !missing.length, completed: selected.length - missing.length, missing};
        });
      groups.push({key: profileId + ':' + scopeKey, profileId, profile: base.profile, models: base.models,
        modelKey: scopeKey, baseline: base, alternatives, selected, stages, scopes,
        runIds: selected.map(row => row.run?.id || null)});
    }
  }
  return groups;
}

export function runDeskProgrammes(snapshot, draft, rows = null, index = runDeskIndex(snapshot)) {
  rows ||= runDeskRows(snapshot, draft, [], index);
  const grid = index.grids.get(draft.grid_id);
  if (!grid || grid.state !== 'complete') return [];
  const families = selectedFamilies(rows, true), programmes = [];
  for (const profileId of draft.profile_ids || []) {
    for (const [scopeKey, family] of families.get(profileId) || []) {
      const baseline = family.find(row => row.scenario.id === draft.baseline_scenario_id && row.scenario.kind === 'baseline');
      if (!baseline) continue;
      const alternatives = family.filter(row => row.scenario.id !== baseline.scenario.id);
      const entry = (row, key) => ({
        key, title: title(row.scenario), profile_id: profileId, scenario_id: row.scenario.id,
        ...(scopeKey === 'ndr+sdr' ? {} : {models: [...row.models]})
      });
      const selection = {
        schema: 'upstate.compute-programme-selection/v1',
        title: 'Native runs · ' + title(baseline.profile) + (scopeKey === 'ndr+sdr' ? '' : ' · ' + modelLabel(baseline.models)),
        grid_id: draft.grid_id,
        baseline_run: 'baseline',
        runs: [entry(baseline, 'baseline'), ...alternatives.map(row => entry(row, row.scenario.id))]
      };
      programmes.push({key: profileId + ':' + scopeKey, profileId, profile: baseline.profile,
        models: baseline.models, modelKey: scopeKey, baseline, selection});
    }
  }
  return programmes;
}

export function attachRunWorkbench({getState, api, refreshState, openItem, showTask, showRunLog, openDelivery, openProgramme, getProgramme, openForm, submitAction, openDesk, toast}) {
  let host = null, current = null, workspaceKey = null, draft = null;
  let busy = false, notice = '', page = 0, filter = 'all', search = '';
  let storageMessage = '', submission = null;
  let programmeStatuses = [], programmeRead = null, programmeCache = null, programmeEpoch = 0, programmeMessage = '';
  let assemblyCapability = null, assemblyRead = null, assemblyEpoch = 0;
  const assemblyForm = typeof openForm === 'function' && typeof submitAction === 'function' ?
    attachRunAssembly({api, getState, openForm, submitAction, openItem}) : null;
  let programmeActivityMode = 'unknown', programmeActivityRecords = new Map();
  let sourceIndex = null, rowCache = null, selectionRevision = 0;
  function currentIndex() {
    if (!sourceIndex || sourceIndex.data !== current?.data || sourceIndex.taskSource !== current?.tasks ||
        sourceIndex.workspace !== current?.workspace_key) sourceIndex = runDeskIndex(current);
    return sourceIndex;
  }
  function currentRows() {
    const index = currentIndex();
    if (!rowCache || rowCache.index !== index || rowCache.revision !== selectionRevision || rowCache.programmes !== programmeStatuses)
      rowCache = {index, revision: selectionRevision, programmes: programmeStatuses,
        rows: runDeskRows(current, draft, programmeStatuses, index)};
    return rowCache.rows;
  }
  function programmeOpener() {
    if (typeof openProgramme === 'function') return openProgramme;
    const programme = typeof getProgramme === 'function' ? getProgramme() : null;
    return typeof programme?.create === 'function' ? selection => programme.create({selection}) : null;
  }

  function resetProgrammeTracking() {
    programmeEpoch++;
    programmeStatuses = []; programmeRead = null; programmeCache = null; programmeMessage = '';
    programmeActivityMode = 'unknown'; programmeActivityRecords = new Map();
  }
  function runningProgrammeTasks(snapshot) {
    return (snapshot?.tasks || []).filter(task => executingProgrammeTask(task) && task.state === 'running' &&
      (!task.workspace || task.workspace === snapshot.workspace_key) && idPattern.test(task.payload?.programme_id || ''))
      .sort((left, right) => String(left.started_at || left.created_at || '').localeCompare(String(right.started_at || right.created_at || '')));
  }
  async function readProgrammeActivity(target, task, request) {
    const id = task.payload.programme_id, paired = pairedProgrammeTask(task);
    const currentRequest = () => request.epoch === programmeEpoch && programmeRead === request &&
      getState()?.workspace_key === target;
    if (programmeActivityMode !== 'legacy') {
      const cached = programmeActivityRecords.get(task.id);
      const query = '?workspace=' + encodeURIComponent(target) + '&programme_id=' + encodeURIComponent(id) +
        (paired ? '&task_id=' + encodeURIComponent(task.id) : '') +
        (cached ? '&bindings_id=' + encodeURIComponent(cached.bindingsId) + '&request_id=' + encodeURIComponent(cached.requestId) : '');
      let value;
      try {
        value = await api('/api/programme-activity/detail' + query);
      } catch (error) {
        if (programmeActivityMode === 'unknown' && [404, 405, 501].includes(error.status)) {
          if (currentRequest()) programmeActivityMode = 'legacy';
        } else throw error;
      }
      // Older activity providers ignore task_id and return the parent. Resolve
      // their decorated original task below, never mistake parent for child.
      if (value && (!paired || value.source_task_id !== undefined)) {
        if (value.schema !== 'upstate.programme-activity/v1' ||
            !idPattern.test(value.programme_id || '') || value.bindings_id !== value.programme_id ||
            !idPattern.test(value.request_id || '') || typeof value.active !== 'boolean' ||
            (paired ? value.source_task_id !== task.id || value.parent_programme_id !== id : value.programme_id !== id))
          throw Error('The compact programme activity does not match its original retained programme task.');
        const bindings = Array.isArray(value.bindings) ? value.bindings : cached?.bindingsId === value.bindings_id ? cached.bindings : null;
        const requested = Array.isArray(value.requested_runs) ? value.requested_runs : cached?.requestId === value.request_id ? cached.requested : null;
        if (!bindings || !requested)
          throw Error('The programme activity response omitted a changed original binding or requested selection.');
        if (Array.isArray(value.bindings) && bindings.some(row => typeof row.key !== 'string' ||
            !idPattern.test(row.run_id || '') || !row.native_selection ||
            ['grid_id', 'profile_id', 'scenario_id'].some(key => !idPattern.test(row.native_selection[key] || ''))))
          throw Error('The programme activity contains an invalid original native binding.');
        if (requested.some(key => typeof key !== 'string'))
          throw Error('The programme activity contains an invalid requested case.');
        if (currentRequest()) {
          programmeActivityMode = 'compact';
          programmeActivityRecords.set(task.id, {bindingsId: value.bindings_id, requestId: value.request_id, bindings, requested});
        }
        return {...value, runs: bindings, requested_runs: requested};
      }
    }
    let selected = id;
    if (paired) {
      const retained = await api('/api/task?workspace=' + encodeURIComponent(target) + '&id=' + encodeURIComponent(task.id));
      if (retained?.id !== task.id || retained.workspace !== target ||
          !pairedProgrammeTask(retained) || retained.payload.programme_id !== id)
        throw Error('The paired programme task changed while its continuation was opening.');
      selected = retained._native_job?.programme_context?.programme_id ||
        retained._native_context?.programme_id || retained.result?.id || retained.programme?.id;
      if (!idPattern.test(selected || '') || selected === id)
        throw Error('The matching calculation programme is being retained. Its task remains available.');
    }
    const value = await api('/api/programmes/detail?workspace=' + encodeURIComponent(target) + '&programme_id=' + encodeURIComponent(selected));
    if ((value?.programme_id || value?.id) !== selected)
      throw Error('The programme detail response belongs to another retained selection.');
    return paired ? {...value, source_task_id: task.id, parent_programme_id: id} : value;
  }
  async function refreshProgrammeActivity(required = false) {
    const snapshot = getState(), target = snapshot?.workspace_key;
    if (!host || !target) return;
    const tasks = runningProgrammeTasks(snapshot);
    if (!tasks.length) { resetProgrammeTracking(); return; }
    // Stage progress already arrives in /api/state. Full programme bindings only
    // need rereading on an execution-state transition, periodic lock reconciliation,
    // or immediately before an operator starts more work.
    const signature = tasks.map(task => task.id + ':' + task.payload.programme_id + ':' + (task.started_at || '')).sort().join('|') +
      '#' + (snapshot.data?.runs || []).map(run => run.id + ':' + run.state).join('|');
    if (!required && programmeCache?.workspace === target && programmeCache.signature === signature &&
        Date.now() - programmeCache.observedAt < 30000) return programmeCache.result;
    let request = programmeRead;
    if (!request || request.workspace !== target || request.signature !== signature) {
      request = {workspace: target, signature, epoch: programmeEpoch, promise: null};
      programmeRead = request;
      request.promise = Promise.allSettled(tasks.map(async task => {
        const status = await readProgrammeActivity(target, task, request);
        if (!status || !Array.isArray(status.runs) || typeof status.active !== 'boolean' ||
            (pairedProgrammeTask(task) ?
              status.source_task_id !== task.id || status.parent_programme_id !== task.payload.programme_id :
              (status.programme_id || status.id) !== task.payload.programme_id))
          throw Error('The programme detail response does not match its retained operation.');
        return {task_id: task.id, status};
      })).then(results => {
        const records = results.filter(row => row.status === 'fulfilled').map(row => row.value);
        const errors = results.filter(row => row.status === 'rejected').map(row => row.reason?.message || String(row.reason));
        if (host && programmeRead === request && request.epoch === programmeEpoch && getState()?.workspace_key === target) {
          programmeStatuses = records;
          programmeCache = {workspace: target, signature, observedAt: Date.now(), result: {records, errors}};
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

  function resetAssemblyAvailability() {
    assemblyEpoch++; assemblyCapability = null; assemblyRead = null;
  }
  async function refreshAssemblyAvailability() {
    const target = getState()?.workspace_key;
    if (!host || !target || !assemblyForm ||
        (assemblyCapability?.workspace === target && (!assemblyCapability.error || Date.now() - assemblyCapability.observedAt < 30000))) return;
    if (assemblyRead?.workspace === target) return assemblyRead.promise;
    const request = {workspace: target, epoch: assemblyEpoch, promise: null};
    assemblyRead = request;
    request.promise = api('/api/run-assembly/catalog?workspace=' + encodeURIComponent(target)).then(value => {
      if (host && assemblyRead === request && request.epoch === assemblyEpoch && getState()?.workspace_key === target) {
        assemblyCapability = {workspace: target, supported: value?.schema === 'upstate.native-run-assembly-capabilities/v1' &&
          value.available === true && value.action === 'run.start' && value.source_runs === true,
          composeSupported: value?.prepared_grid_composition === true && value.composition_action === 'run.assembly.compose',
          reason: value?.reason || '', observedAt: Date.now()};
        paint();
      }
    }).catch(error => {
      if (host && assemblyRead === request && request.epoch === assemblyEpoch && getState()?.workspace_key === target) {
        assemblyCapability = {workspace: target, supported: false, error: error.status === 404 ? '' : error.message, observedAt: Date.now()};
        paint();
      }
    }).finally(() => { if (assemblyRead === request) assemblyRead = null; });
    return request.promise;
  }
  function canAssemble(row) {
    const sources = currentIndex().reusableModels;
    return assemblyCapability?.supported && !!assemblyForm && row.modelKey === 'ndr+sdr' &&
      row.startable && ['prepared', 'failed'].includes(row.run?.state) && sources.ndr && sources.sdr;
  }
  function canComposePreparedInputs() {
    const sources = currentIndex().reusableModels;
    return assemblyCapability?.supported && assemblyCapability?.composeSupported && !!assemblyForm &&
      sources.ndr && sources.sdr && (current.data.profiles || []).some(row => modelsOf(row).length === 2) &&
      (current.data.scenarios || []).length > 0;
  }
  async function openPreparedComposition() {
    if (busy) return;
    synchronize(getState());
    const target = current.workspace_key;
    await refreshAssemblyAvailability();
    assertWorkspace(target); synchronize(getState());
    if (!canComposePreparedInputs())
      throw Error('Retain completed NDR and SDR calculations, a full parameter profile and the original scenario to compose their prepared inputs.');
    return assemblyForm.open({compose: true});
  }
  async function openAssembly(key) {
    if (busy) return;
    synchronize(getState());
    const target = current.workspace_key;
    const activity = await refreshProgrammeActivity(true);
    assertWorkspace(target); synchronize(getState());
    const row = runDeskRows(current, draft, activity?.records || programmeStatuses, currentIndex()).find(value => value.key === key);
    if (!row || !canAssemble(row)) throw Error('Prepare an available full target run and complete the original NDR and SDR source runs.');
    return assemblyForm.open({selection: row.selection, run_id: row.run.id});
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
      baseline_scenario_id: baseline?.id || '',
      models: modelsOf(last && last.selection?.grid_id === grid?.id ? last.selection : grid?.spec),
      excluded: [], included: []};
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
    const grid = (snapshot.data.grids || []).find(row => row.id === value.grid_id);
    const models = modelsOf(Object.hasOwn(value, 'models') ? value : grid?.spec);
    const cellKeys = values => Array.isArray(values) ? [...new Set(values.flatMap(key => {
      if (typeof key !== 'string') return [];
      const parts = key.split(':');
      if (![3, 4].includes(parts.length) || !parts.slice(0, 3).every(id => idPattern.test(id))) return [];
      if (parts.length === 3) return [key + ':' + modelKey(models)];
      return ['ndr', 'sdr', 'ndr+sdr'].includes(parts[3]) ? [key] : [];
    }))] : [];
    return {schema: value.schema, project_id: value.project_id, grid_id: value.grid_id || '',
      profile_ids: [...value.profile_ids], scenario_ids: [...value.scenario_ids],
      baseline_scenario_id: value.baseline_scenario_id || '', models,
      excluded: cellKeys(value.excluded), included: cellKeys(value.included)};
  }
  function synchronize(snapshot) {
    if (!snapshot?.data) return;
    current = snapshot;
    if (workspaceKey === snapshot.workspace_key && draft) return;
    resetProgrammeTracking();
    resetAssemblyAvailability();
    workspaceKey = snapshot.workspace_key;
    sourceIndex = null; rowCache = null; selectionRevision++;
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
    selectionRevision++;
    try { localStorage.setItem(storageKey(workspaceKey), JSON.stringify(draft)); storageMessage = ''; }
    catch { storageMessage = 'Download this run selection to keep it across browser sessions.'; }
  }
  function selectionIssues() {
    if (!current || !draft) return [];
    const data = current.data, issues = [];
    const index = currentIndex(), grid = index.grids.get(draft.grid_id);
    if (!grid) issues.push('Choose a retained model grid.');
    else if (grid.state !== 'complete') issues.push('Complete the selected model grid before preparing its runs.');
    if (grid && modelsOf(draft).some(name => !modelsOf(grid.spec).includes(name)))
      issues.push('Choose native models included in the selected grid.');
    if (!draft.profile_ids.length) issues.push('Select at least one parameter profile.');
    if (!draft.scenario_ids.length) issues.push('Select at least one land-cover scenario.');
    for (const [field, collection, label] of [['profile_ids', 'profiles', 'profile'], ['scenario_ids', 'scenarios', 'scenario']]) {
      for (const id of draft[field]) {
        if (!index[collection].has(id)) issues.push('The selected ' + label + ' ' + short(id) + ' is unavailable in this workspace.');
      }
    }
    return issues;
  }
  function checkedList(kind, selected) {
    const rows = current.data[kind] || [], selectedIds = new Set(selected);
    if (!rows.length) return '<p class="note">Save an original ' + (kind === 'profiles' ? 'parameter profile' : 'land-cover scenario') + ' to select it here.</p>';
    return rows.map(row => '<label class="check"><input type="checkbox" data-rd-focus="' + kind + '-' + escapeHTML(row.id) +
      '" data-rd-choice="' + kind + '" value="' + escapeHTML(row.id) + '"' + (selectedIds.has(row.id) ? ' checked' : '') +
      (busy ? ' disabled' : '') + '><span><strong>' + escapeHTML(title(row)) + '</strong><small>' +
      escapeHTML(kind === 'profiles' ? 'Table ' + short(row.biophysical_source_id) + ' · ' + modelLabel(modelsOf(row)) : row.kind + (row.patches?.length ? ' · ' + row.patches.length + ' retained changes' : '')) +
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
      '</strong><small>' + escapeHTML(title(row.profile)) + ' · ' + escapeHTML(modelLabel(row.models)) + '</small><small class="mono">' + escapeHTML(row.run ? short(row.run.id) : 'Selection ' + short(row.scenario.id)) +
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
      (canAssemble(row) ? htmlButton('assemble', 'Reuse completed models', {key: row.key}, busy) : '') +
      '</div></td></tr>').join('');
  }
  function matchingRows(rows) {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(row => (!query || [title(row.profile), title(row.scenario), modelLabel(row.models), row.run?.id, row.label].join(' ').toLocaleLowerCase().includes(query)) &&
      (filter === 'all' || filter === 'selected' && row.selected || filter === 'missing' && row.preparable ||
       filter === 'ready' && row.startable || filter === 'active' && ['preparing', 'queued', 'running'].includes(row.state) ||
       filter === 'complete' && row.state === 'complete' || filter === 'attention' && row.state === 'attention'));
  }
  function renderGroups(rows) {
    const groups = runDeskComparisons(current, draft, rows, currentIndex());
    if (!groups.length) return '<p class="note">Select an unchanged baseline and at least one other scenario under the same profile and native model selection.</p>';
    return groups.map(group => '<article class="rd-comparison"><div><h3>' + escapeHTML(title(group.profile)) + ' · ' +
      escapeHTML(modelLabel(group.models)) + '</h3><p>' +
      escapeHTML(title(group.baseline.scenario)) + ' → ' + group.complete.length + ' of ' + group.alternatives.length + ' selected alternatives complete.</p>' +
      '<small>' + (selectedOutputsComplete(group.baseline.run) ? 'Baseline complete. ' : 'Baseline awaiting completion. ') +
      'Every pair uses the same grid, parameter profile and native models. Checked unchanged controls are included.</small>' +
      '<p class="note">Completed comparison selection: ' + escapeHTML(group.complete.length ?
        group.complete.map(row => title(row.scenario)).join(' · ') : 'Awaiting an alternative') + '.</p>' +
      '<p class="note">Land-cover delivery: ' + group.deliveryComplete.length + ' of ' +
        group.deliveryAlternatives.length + ' checked land-cover alternatives have complete NDR + SDR exports' +
        (group.deliveryComplete.length ? ' · ' + escapeHTML(group.deliveryComplete.map(row => title(row.scenario)).join(' · ')) : '') +
        '. Unchanged controls remain in the programme, comparison and process report.</p></div><div class="rd-row-actions">' +
      (group.retained ? htmlButton('comparison-open', 'Open retained comparison', {id: group.retained.id}) :
        group.task ? htmlButton('task', 'Comparison ' + group.task.state, {id: group.task.id}) :
        htmlButton('compare', 'Compare ' + group.complete.length + ' completed alternative' + (group.complete.length === 1 ? '' : 's'),
          {profile: group.profileId, models: group.modelKey}, busy || group.runIds.length < 2)) +
      htmlButton('delivery', 'Prepare land-cover delivery (' + group.deliveryComplete.length + ')', {profile: group.profileId, models: group.modelKey},
        busy || !group.canDeliver) + '</div></article>').join('');
  }
  function renderProgrammes(rows, hasIssues) {
    if (!programmeOpener()) return '';
    const groups = runDeskProgrammes(current, draft, rows, currentIndex());
    if (!groups.length) return '<div class="section-body"><p class="note">Choose a complete working grid and check an unchanged baseline under a compatible profile to open its execution programme.</p></div>';
    return '<div class="section-body"><p class="note">Each programme retains one parameter profile and native model selection, reuses completed stages, and continues from saved progress.</p>' +
      groups.map(group => '<article class="rd-comparison"><div><h3>' + escapeHTML(title(group.profile)) + ' · ' +
        escapeHTML(modelLabel(group.models)) + '</h3><p>' +
        group.selection.runs.length + ' selected native run' + (group.selection.runs.length === 1 ? '' : 's') +
        ' · unchanged baseline: ' + escapeHTML(title(group.baseline.scenario)) + '</p><small>Uses this working grid, this profile and every checked scenario, including unchanged controls.</small></div>' +
        '<div class="rd-row-actions">' + htmlButton('programme', 'Inspect execution programme',
          {profile: group.profileId, models: group.modelKey}, busy || hasIssues) +
        '</div></article>').join('') + '</div>';
  }
  function renderProcessReports(rows) {
    if (typeof openDesk !== 'function') return '';
    const groups = runDeskProcessReports(current, draft, rows, currentIndex());
    return '<section class="section"><header class="section-header"><div><h2>4. Report completed model stages</h2><p>Open the baseline and every other checked scenario in their selected order. A baseline alone is supported.</p></div></header>' +
      '<div class="section-body"><p class="note">A completed nutrient or sediment stage can be reported while its parent run continues. The process desk checks the original watershed files and producing versions before building the report.</p>' +
      (groups.length ? groups.map(group => '<article class="rd-comparison"><div><h3>' +
        escapeHTML(title(group.profile)) + ' · retained ' + escapeHTML(modelLabel(group.models)) + ' runs</h3><p>' +
        group.selected.length + ' selected run' + (group.selected.length === 1 ? '' : 's') + ' · baseline first</p><ol>' +
        group.stages.map(({row, completed}) => '<li><strong>' + escapeHTML(title(row.scenario)) + '</strong> · ' +
          escapeHTML(row.run ? 'parent ' + row.run.state : 'awaiting run preparation') +
          '<br><small>' + escapeHTML(row.run ? short(row.run.id) + ' · ' : '') +
          escapeHTML(row.models.map(model => model.toUpperCase() + (completed[model] ? ' completed ' + completed[model] : ' awaiting completed watershed output')).join(' · ')) +
          '</small></li>').join('') + '</ol><small>All checked alternatives stay in this cohort. Uncheck an unfinished alternative above to deliberately prepare a smaller report.</small></div>' +
        '<div class="rd-row-actions">' + group.scopes.map(scope => htmlButton('process-report',
          'Open ' + modelLabel(scope.models) + ' report (' + scope.completed + '/' + group.selected.length + ' ready)',
          {profile: group.profileId, models: group.modelKey, 'report-models': scope.key, workspace: current.workspace_key},
          busy || !scope.ready)).join('') + '</div></article>').join('') :
        '<p class="note">Check an unchanged baseline under a selected profile to prepare a process report. Check its restoration, control or other scenarios to include them in the same original cohort.</p>') +
      '</div></section>';
  }
  function paint() {
    if (!host || !current || !draft) return;
    const focused = host.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.dataset.rdFocus;
    const start = focused?.selectionStart, end = focused?.selectionEnd;
    const scroll = [...host.querySelectorAll('[data-rd-scroll]')].map(node => [node.dataset.rdScroll, node.scrollLeft, node.scrollTop]);
    const rows = currentRows(), selected = rows.filter(row => row.selected), issues = selectionIssues();
    const shown = matchingRows(rows), pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
    page = Math.min(page, pageCount - 1);
    const visible = shown.slice(page * pageSize, (page + 1) * pageSize);
    const preparable = selected.filter(row => row.preparable).length;
    const startable = selected.filter(row => row.startable).length;
    const queued = new Set(selected.flatMap(row => row.queuedTask ? [row.queuedTask.id] : [])).size;
    const grids = current.data.grids || [];
    const gridModels = modelsOf(grids.find(row => row.id === draft.grid_id)?.spec);
    const modelChoices = [['ndr', 'sdr'], ['ndr'], ['sdr']].filter(models => models.every(name => gridModels.includes(name)));
    const selectedScenarios = new Set(draft.scenario_ids);
    const baselineChoices = (current.data.scenarios || []).filter(row => row.kind === 'baseline' && selectedScenarios.has(row.id));
    host.innerHTML = '<div class="run-desk" data-run-desk><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>' +
      '<h1>Native run desk</h1><p>Select retained scientific inputs, prepare their run matrix, and queue the original NDR and SDR engines.</p></div>' +
      '<div class="page-actions">' + htmlButton('compose-prepared-inputs', 'Compose prepared inputs', {}, busy || !canComposePreparedInputs()) +
      htmlButton('download-selection', 'Download run selection', {}, busy) + htmlButton('import-selection', 'Open run selection', {}, busy) +
      '</div></header>' +
      '<section class="section"><header class="section-header"><div><h2>1. Select the original inputs</h2><p>Each checked cell is one immutable grid, profile, scenario and native model selection.</p></div></header>' +
      '<div class="section-body rd-selector"><div><label>Complete model grid<select data-rd-field="grid_id" data-rd-focus="grid"' + (busy ? ' disabled' : '') + '>' +
      option('', 'Choose a retained grid…', !draft.grid_id) + grids.map(row => option(row.id, title(row) + ' · ' + row.state + ' · ' + modelLabel(modelsOf(row.spec)), row.id === draft.grid_id, row.state !== 'complete')).join('') +
      '</select></label><p class="note">' + escapeHTML(grids.find(row => row.id === draft.grid_id)?.grid?.resolution_m ?
        'Working ' + grids.find(row => row.id === draft.grid_id).grid.resolution_m + ' m grid; reporting boundary and upstream model context remain in its retained record.' :
        'Prepare the actual reporting grid in Model grids before queueing native runs.') + '</p>' +
      '<label>Native models<select data-rd-field="models" data-rd-focus="models"' + (busy ? ' disabled' : '') + '>' +
      modelChoices.map(models => option(modelKey(models), modelLabel(models), modelKey(models) === modelKey(draft))).join('') +
      '</select></label><p class="note">The chosen models select the default rows. Retained runs with other model selections remain visible and can be checked individually.</p>' +
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
      renderProgrammes(rows, !!issues.length) + '<div class="rd-operation-bar">' + htmlButton('prepare', 'Prepare missing (' + preparable + ')', {}, busy || !!issues.length || !preparable, true) +
      htmlButton('start', 'Queue / continue prepared runs (' + startable + ')', {}, busy || !!issues.length || !startable, true) +
      htmlButton('cancel', 'Cancel queued (' + queued + ')', {}, busy || !queued) +
      '<button type="button" data-action="runtime" class="small">Runtime versions</button></div>' +
      '<p class="rd-explanation">Preparation saves the original selections. Queueing starts the existing serial operator queue; queued model runs continue after this tab closes. Continuation reuses the original native stages.</p>' +
      '<div class="rd-notice" role="status" aria-live="polite">' + escapeHTML(submission?.workspace === workspaceKey ? submission.message : notice) + '</div>' +
      (programmeMessage ? '<div class="rd-notice" role="status">' + escapeHTML(programmeMessage) + '</div>' : '') +
      (assemblyCapability?.error ? '<div class="rd-notice" role="status">Completed-model assembly: ' + escapeHTML(assemblyCapability.error) + '</div>' : '') +
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
      '</div>' + htmlButton('download-results', 'Download selected native totals', {},
        !selected.some(row => row.models.some(model => modelOutputs[model].some(name => !!row.run?.artifacts?.[name])))) + '</footer></section>' +
      '<section class="section"><header class="section-header"><div><h2>3. Compare and deliver completed pairs</h2><p>Signed comparison outputs use alternative minus baseline. The completed pairs below retain one common profile and grid.</p></div></header>' +
      '<div class="section-body">' + renderGroups(rows) + '</div></section>' + renderProcessReports(rows) + '</div>';
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
    sourceIndex = null; rowCache = null;
    synchronize(snapshot);
    refreshProgrammeActivity().catch(error => { programmeMessage = error.message; paint(); });
    refreshAssemblyAvailability();
    paint();
  }
  function change(event) {
    const node = event.target;
    if (node.dataset.rdField) {
      const field = node.dataset.rdField;
      if (field === 'search') search = node.value;
      else if (field === 'filter') filter = node.value;
      else if (!busy) {
        draft[field] = field === 'models' ? modelsOf(node.value.split('+')) : node.value;
        if (field === 'grid_id') draft.models = modelsOf((current.data.grids || []).find(row => row.id === node.value)?.spec);
        draft.excluded = []; draft.included = []; persist();
      }
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
      const excluded = new Set(draft.excluded), included = new Set(draft.included || []);
      if (node.checked) { excluded.delete(node.dataset.rdRow); included.add(node.dataset.rdRow); }
      else { excluded.add(node.dataset.rdRow); included.delete(node.dataset.rdRow); }
      draft.excluded = [...excluded]; draft.included = [...included]; persist(); paint();
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
    sourceIndex = null; rowCache = null;
    resetProgrammeTracking();
    resetAssemblyAvailability();
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
    const grids = new Map((getState()?.data?.grids || []).map(row => [row.id, row]));
    const matchesPayload = candidate => action === 'run.prepare' ?
      selectionKey(nativeSelection(candidate, requestModels(candidate, grids))) ===
        selectionKey(nativeSelection(payload, requestModels(payload, grids))) : canonical(candidate) === identity;
    const tasks = (getState()?.tasks || []).filter(row => row.workspace === target && row.action === action && matchesPayload(row.payload || {}))
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
      rows = runDeskRows(current, draft, activity?.records || programmeStatuses, currentIndex()).filter(row => key ? row.key === key : row.selected);
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
    const columns = ['project_id','grid_id','profile_id','profile_title','scenario_id','scenario_title','scenario_kind','run_id','invest_version','models','run_state','export','annual_reporting_total','total_units','valid_cells'];
    const records = [];
    for (const row of runDeskRows(getState(), draft).filter(value => value.selected && value.run)) {
      for (const metric of row.models.flatMap(model => modelOutputs[model])) {
        const artifact = row.run.artifacts?.[metric];
        if (!artifact) continue;
        records.push([current.data.project.id, row.selection.grid_id, row.profile.id, title(row.profile), row.scenario.id, title(row.scenario), row.scenario.kind,
          row.run.id, row.run.selection.invest_version, modelLabel(row.models), row.run.state, metric,
          artifact.sum, artifact.sum_units || artifact.units, artifact.valid_cells]);
      }
    }
    const cell = value => {
      let text = value === null || value === undefined ? '' : String(value);
      if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    download('upper-savannah-native-run-totals.csv', [columns, ...records].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }
  async function compare(profileId, scopeKey, delivery = false) {
    synchronize(getState());
    const group = runDeskComparisons(current, draft).find(row => row.profileId === profileId && row.modelKey === scopeKey);
    if (!group || group.runIds.length < 2) throw Error('Complete the selected baseline and at least one other scenario under this profile and native model selection.');
    if (delivery) {
      if (!group.canDeliver) throw Error('Land-cover delivery requires complete nitrogen, phosphorus and sediment exports for the baseline and at least one checked explicit land-cover alternative.');
      return openDelivery({baseline_run_id: group.deliveryRunIds[0], scenario_run_ids: group.deliveryRunIds.slice(1)});
    }
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
    if (action === 'compose-prepared-inputs') return openPreparedComposition();
    if (action === 'assemble') return openAssembly(button.dataset.key);
    if (action === 'record') return openItem('runs', button.dataset.id);
    if (action === 'task') return showTask(button.dataset.id);
    if (action === 'log') return showRunLog(button.dataset.id);
    if (action === 'process-report') {
      if (busy) return;
      if (!host || typeof openDesk !== 'function') throw Error('Open Native runs in the current scientific application.');
      if (button.dataset.workspace !== workspaceKey || button.dataset.workspace !== getState()?.workspace_key)
        throw Error('Open this original run cohort in its selected Workspace.');
      synchronize(getState());
      const target = current.workspace_key;
      assertWorkspace(target);
      const group = runDeskProcessReports(current, draft, currentRows(), currentIndex()).find(row =>
        row.profileId === button.dataset.profile && row.modelKey === button.dataset.models);
      const scope = group?.scopes.find(value => value.key === button.dataset.reportModels);
      if (!group || !scope?.ready || group.runIds.some(id => !idPattern.test(id || '')))
        throw Error('Keep the original checked cohort and wait for every requested model stage, or deliberately change the checked runs.');
      return openDesk('native-process-reports', 'createForRuns', {
        workspace_key: target, run_ids: [...group.runIds], models: [...scope.models],
        title: 'Native processes · ' + title(group.profile) + ' · ' + modelLabel(scope.models)
      });
    }
    if (action === 'comparison-open') return openItem('comparisons', button.dataset.id);
    if (action === 'programme') {
      if (busy) return;
      synchronize(getState());
      const issues = selectionIssues();
      if (issues.length) throw Error(issues.join(' '));
      const group = runDeskProgrammes(current, draft).find(row =>
        row.profileId === button.dataset.profile && row.modelKey === button.dataset.models);
      if (!group) throw Error('Check an unchanged baseline under this profile to open its retained execution programme.');
      const open = programmeOpener();
      if (!open) throw Error('The current application has no programme controls attached.');
      let programmeSelection = group.selection;
      if (group.models.length < 2) {
        const target = current.workspace_key;
        const preview = await api('/api/programmes/preview', {method: 'POST',
          body: {workspace: target, selection: group.selection}});
        assertWorkspace(target);
        if (!preview?.selection || preview.selection.baseline_run !== group.selection.baseline_run ||
            preview.runs?.length !== group.selection.runs.length)
          throw Error('The programme preview changed the selected cases. Open the current native programme engine.');
        const bindings = new Map((preview.runs || []).map(row => [row.key, row.native_selection]));
        for (const requested of group.selection.runs) {
          const native = bindings.get(requested.key);
          if (!native || native.grid_id !== group.selection.grid_id || native.profile_id !== requested.profile_id ||
              native.scenario_id !== requested.scenario_id || modelKey(native) !== modelKey(requested))
            throw Error('The programme preview changed a selected native input or model scope. Use the current selected-model programme engine.');
        }
        programmeSelection = preview.selection;
      }
      return open(programmeSelection);
    }
    if (action === 'compare' || action === 'delivery') return compare(button.dataset.profile, button.dataset.models, action === 'delivery');
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
    if (action === 'select-cells') { draft.excluded = []; draft.included = rows.map(row => row.key); }
    if (action === 'clear-cells') { draft.excluded = rows.map(row => row.key); draft.included = []; }
    if (action === 'select-incomplete') {
      draft.excluded = rows.filter(row => row.state === 'complete').map(row => row.key);
      draft.included = rows.filter(row => row.state !== 'complete').map(row => row.key);
    }
    persist(); page = 0; paint();
  }
  return {mount, update, detach, dispatch};
}
