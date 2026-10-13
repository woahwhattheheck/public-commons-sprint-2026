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
      return '<tr><td><input type="checkbox" data-programme-run="' + escapeHTML(row.key) + '" aria-label="Select ' +
        escapeHTML(row.title || row.key) + '"' + (subset.has(row.key) ? ' checked' : '') + '></td><td><strong>' +
        escapeHTML(row.title || row.key) + '</strong>' + (row.key === record.selection?.baseline_run ? '<small>Reference case</small>' : '') +
        '<small class="mono">' + escapeHTML(row.key) + '</small></td><td>' + escapeHTML(named('profiles', row.profile_id)) +
        '<small>' + escapeHTML(named('scenarios', row.scenario_id)) + '</small></td><td>' + stateBadge(row.state) +
        '<small>' + escapeHTML(stageText(row)) + '</small>' + (error ? '<p class="programme-run-error">' + escapeHTML(error) + '</p>' : '') +
        '</td><td>' + escapeHTML(row.run_id ? short(row.run_id) : '—') + '</td><td><div class="programme-row-actions">' + native + '</div></td></tr>';
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
      table(['Select', 'Case', 'Profile / land cover', 'Native state', 'Run', ''], runRows) +
      '<div class="programme-controls">' + actionButton('select-pending', 'Select unfinished') + actionButton('clear-selection', 'Clear selection') + '</div>' +
      '<section class="programme-output"><header class="section-header"><div><h3>Result catalogue</h3><p>Open the original quantities, units, geographic coverage and result files retained for these runs.</p></div>' +
      actionButton('open-report', 'Open saved catalogue', record.id, report || files.length ? '' : 'disabled') + '</header>' +
      (files.length ? fileList(files) : '<p class="note">Build the catalogue after a run finishes. Completed cases can be reported while other cases remain in the programme.</p>') + '</section>' +
      '<details class="technical"><summary>Complete saved selections and provenance</summary><pre class="json-view">' +
      escapeHTML(JSON.stringify(record.selection, null, 2)) + '</pre></details></section>';
  }
  function draw() {
    if (!host) return;
    const preserveScroll = host.scrollTop;
    host.innerHTML = '<div class="programme-workbench"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Run programmes</h1><p>Run saved native cases, inspect progress, pause between calculations and continue the same work after reopening.</p></div>' +
      '<div class="page-actions">' + actionButton('create', 'Create programme') + actionButton('import', 'Import selections') +
      '<button type="button" data-view="runs">Native model runs</button></div></header><div class="notice error" data-programme-error role="alert"' +
      (latestError ? '' : ' hidden') + '>' + escapeHTML(latestError) + '</div>' + catalogueHTML() + programmeHTML() +
      '<p class="programme-method">Parameter designs and interpretation use the selected experiment and scientific profile. ' + methodLink + '.</p></div>';
    host.scrollTop = preserveScroll;
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
        selected = null; record = null; subset.clear();
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
      host = element; currentWorkspace = key; selected = selectionByWorkspace.get(key) || null;
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
    selected = id; selectionByWorkspace.set(workspaceKey(), id);
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
      ['Common-area change', row => printable(row.common_sum_change ?? row.sum_change)],
      ['State', row => labelState(row.state)],
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
    const report = await api(query('report', {programme_id: id}));
    detail(report.title || 'Saved result catalogue', reportHTML(report), {kind: 'programme-report', id});
  }
  async function showLog(id) {
    const data = await api(endpoint('/api/run-log', {id, offset: 0}));
    detail('Native model log', '<p>Original retained output for run <span class="mono">' + escapeHTML(short(id)) +
      '</span>.</p><pre class="logs">' + escapeHTML(data.text || 'The selected run has no native log output yet.') + '</pre>' +
      '<p class="note">Open the native run for continued log inspection and its complete artifact list.</p>', {kind: 'programme-log', id});
  }

  function rowHTML(row, index, baseline, available) {
    return '<tr data-programme-form-row="' + index + '"><td><input type="radio" name="programme_baseline" value="' + index +
      '" aria-label="Use this case as reference"' + (baseline ? ' checked' : '') + ' required></td><td><label><span class="sr-only">Case key</span><input data-field="key" value="' +
      escapeHTML(row.key || 'case-' + (index + 1)) + '" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"></label>' +
      '<label><span class="sr-only">Case title</span><input data-field="title" value="' + escapeHTML(row.title || 'Case ' + (index + 1)) + '" required></label></td>' +
      '<td><label><span class="sr-only">Parameter profile</span><select data-field="profile_id" required>' +
      available.profiles.map(item => option(item, row.profile_id)).join('') + '</select></label></td><td><label><span class="sr-only">Land-cover case</span><select data-field="scenario_id" required>' +
      available.scenarios.map(item => option(item, row.scenario_id)).join('') + '</select></label></td><td><button type="button" data-programme-form-action="remove">Remove</button></td></tr>';
  }
  async function createForm(copy) {
    const available = await api(query('catalog'));
    const grids = asArray(available.grids).filter(row => row.state === 'complete');
    if (!grids.length || !asArray(available.profiles).length || !asArray(available.scenarios).length) {
      detail('Prepare the calculation inputs', '<p>A run programme selects an existing completed model grid, a saved parameter profile and a saved land-cover case.</p>' +
        '<div class="page-actions"><button type="button" data-action="programme-view" data-target="sources">Original sources</button><button type="button" data-action="programme-view" data-target="grids">Model grids</button><button type="button" data-action="programme-view" data-target="profiles">Parameter profiles</button><button type="button" data-action="programme-view" data-target="scenarios">Land-cover scenarios</button></div>',
        {kind: 'programme-inputs'}); return;
    }
    const initial = copy?.selection || {title: '', grid_id: grids[0].id, runs: [{key: 'baseline', title: 'Baseline', profile_id: available.profiles[0].id, scenario_id: available.scenarios[0].id}], baseline_run: 'baseline'};
    const originals = new Map(asArray(initial.runs).map((row, index) => [String(index), row]));
    let serial = asArray(initial.runs).length, form;
    const readSelection = () => {
      const selection = {
        schema: 'upstate.compute-programme-selection/v1',
        title: form.elements.namedItem('programme_title').value.trim(),
        grid_id: form.elements.namedItem('programme_grid').value,
        runs: [], baseline_run: '',
      };
      for (const element of form.querySelectorAll('[data-programme-form-row]')) {
        const original = originals.get(element.dataset.programmeFormRow) || {};
        const row = {};
        for (const name of ['key', 'title', 'profile_id', 'scenario_id']) row[name] = element.querySelector('[data-field="' + name + '"]').value.trim();
        for (const name of ['reason', 'experiment_key', 'changes']) if (original[name] !== undefined) row[name] = original[name];
        selection.runs.push(row);
        if (element.querySelector('input[type="radio"]').checked) selection.baseline_run = row.key;
      }
      const source = form.elements.namedItem('programme_source').value.trim();
      if (source) selection.source_reference = source;
      if (!selection.runs.length) throw new Error('Add at least one prepared case.');
      if (!selection.baseline_run) throw new Error('Choose the reference case.');
      return selection;
    };
    openForm(copy ? 'Copy saved programme selections' : 'Create a run programme',
      'Select the original prepared inputs and cases. Parameter designs from the experiment planner can also be imported as expanded selections.',
      '<div class="programme-form"><div class="form-grid"><label>Programme title<input name="programme_title" value="' + escapeHTML(copy ? initial.title + ' — copy' : initial.title) +
      '" required></label><label>Completed model grid<select name="programme_grid" required>' + grids.map(row => option(row, initial.grid_id)).join('') + '</select></label></div>' +
      '<label>Source or experiment reference<input name="programme_source" value="' + escapeHTML(initial.source_reference || '') +
      '" placeholder="Saved experiment identifier, source citation or work-order reference"></label><p class="note">Each case uses a retained profile and land-cover scenario compatible with the selected grid.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Case key / title</th><th>Parameter profile</th><th>Land-cover case</th><th></th></tr></thead><tbody data-programme-form-rows>' +
      asArray(initial.runs).map((row, index) => rowHTML(row, index, row.key === initial.baseline_run, available)).join('') + '</tbody></table></div>' +
      '<div class="programme-controls"><button type="button" data-programme-form-action="add">Add prepared case</button><button type="button" data-programme-form-action="preview">Review planned runs</button></div>' +
      '<div data-programme-preview role="status"></div></div>',
      'Save programme', async () => {
        const preview = await api('/api/programmes/preview', {method: 'POST', body: {workspace: workspaceKey(), selection: readSelection()}});
        return submitAction('compute.programme.save', {selection: preview.selection});
      }, () => {
        form = document.querySelector('#operation-form');
        form.querySelector('.programme-form').addEventListener('click', async event => {
          const button = event.target.closest('[data-programme-form-action]'); if (!button) return;
          const action = button.dataset.programmeFormAction; const preview = form.querySelector('[data-programme-preview]');
          try {
            if (action === 'add') {
              form.querySelector('[data-programme-form-rows]').insertAdjacentHTML('beforeend',
                rowHTML({profile_id: available.profiles[0].id, scenario_id: available.scenarios[0].id}, serial++, false, available));
            }
            if (action === 'remove') {
              const row = button.closest('[data-programme-form-row]'); const baseline = row.querySelector('input[type="radio"]').checked;
              row.remove(); if (baseline) { const first = form.querySelector('[data-programme-form-row] input[type="radio"]'); if (first) first.checked = true; }
            }
            if (action === 'preview') {
              if (!form.reportValidity()) return;
              button.disabled = true; preview.textContent = 'Checking the retained selections…';
              const result = await api('/api/programmes/preview', {method: 'POST', body: {workspace: workspaceKey(), selection: readSelection()}});
              preview.innerHTML = '<div class="notice"><strong>' + escapeHTML(result.run_count ?? result.runs?.length ?? 0) +
                ' named cases</strong><p>' + escapeHTML(result.unique_run_count ?? result.run_count ?? result.runs?.length ?? 0) +
                ' distinct native selections. Compatible completed stages will be reused.</p></div>';
            }
          } catch (error) { preview.textContent = error.message || String(error); }
          finally { button.disabled = false; }
        });
      });
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
    if (action === 'clone') return createForm(record);
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
    if (id) { selected = id; selectionByWorkspace.set(workspaceKey(), id); record = null; subset.clear(); }
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
  return {mount, detach, open, dispatch, taskActions, completionMessage, refresh: refreshRecord, create: createForm, importSelections: importForm};
}
