/* Reuse original completed model stages through the retained operator queue. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const order = ['ndr', 'sdr'];
const outputs = {ndr: ['nitrogen_export', 'phosphorus_export'], sdr: ['sediment_export']};
const identifier = /^[0-9a-f]{64}$/;
const short = value => String(value || '').slice(0, 12);
const title = row => row?.title || row?.metadata?.title || row?.spec?.title || short(row?.id);
const nativeModels = record => {
  const value = Object.hasOwn(record || {}, 'models') ? record.models : order;
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string')) return [];
  const names = value.map(item => item.trim().toLowerCase());
  if (new Set(names).size !== names.length || names.some(item => !order.includes(item))) return [];
  return order.filter(item => names.includes(item));
};
const sameCase = (left, right) => ['grid_id', 'profile_id', 'scenario_id'].every(key => left?.[key] === right?.[key]);
const complete = run => run?.state === 'complete' && nativeModels(run.selection).length &&
  nativeModels(run.selection).every(model => Object.hasOwn(run.stages || run.stage_summary || {}, model) &&
    outputs[model].every(name => !!run.artifacts?.[name]));

const reusableStage = (run, model) => {
  const stage = run?.stages?.[model] || run?.stage_summary?.[model];
  const fileCount = stage?.files ? Object.keys(stage.files).length : stage?.file_count;
  return !['running', 'queued'].includes(run?.state) && nativeModels(run?.selection).includes(model) &&
    !!stage?.completed_at && Number.isInteger(fileCount) && fileCount > 0;
};

export function attachRunAssembly({api, getState, openForm, submitAction, openItem}) {
  async function open({selection, run_id, compose = false} = {}) {
    const snapshot = getState(), workspace = snapshot?.workspace_key;
    if (!workspace || !snapshot.data) throw Error('Open the scientific workspace before assembling a native run.');
    const data = snapshot.data;
    const grids = new Map((data.grids || []).map(row => [row.id, row]));
    const profiles = new Map((data.profiles || []).map(row => [row.id, row]));
    const scenarios = new Map((data.scenarios || []).map(row => [row.id, row]));
    let target = {}, grid, profile, scenario;
    if (!compose) {
      if (!selection || !['grid_id', 'profile_id', 'scenario_id'].every(key => identifier.test(selection[key] || '')) ||
          nativeModels(selection).join('+') !== 'ndr+sdr')
        throw Error('Choose the complete target grid, profile, scenario and both native models.');
      target = {grid_id: selection.grid_id, profile_id: selection.profile_id, scenario_id: selection.scenario_id};
      const targetRun = (data.runs || []).find(row => row.id === run_id);
      if (!identifier.test(run_id || '') || !targetRun || !sameCase(targetRun.selection, target) ||
          nativeModels(targetRun.selection).length !== 2)
        throw Error('Prepare the original full target run before selecting its completed model sources.');
      if (complete(targetRun)) return openItem('runs', run_id);
      if (!['prepared', 'failed'].includes(targetRun.state))
        throw Error('Choose a prepared or failed full target run to reuse its original completed model stages.');
      grid = grids.get(target.grid_id); profile = profiles.get(target.profile_id); scenario = scenarios.get(target.scenario_id);
      if (!grid || grid.state !== 'complete' || !profile || !scenario ||
          nativeModels(grid.spec).length !== 2 || nativeModels(profile).length !== 2)
        throw Error('Choose a completed target grid and retained profile containing both NDR and SDR inputs.');
    }
    const fullProfiles = [...profiles.values()].filter(row => nativeModels(row).length === 2);
    if (compose && (!fullProfiles.length || !scenarios.size))
      throw Error('Retain a full NDR and SDR parameter profile and the original scenario before composing their prepared inputs.');
    const capability = await api('/api/run-assembly/catalog?workspace=' + encodeURIComponent(workspace));
    if (getState()?.workspace_key !== workspace) throw Error('Reopen native run assembly in the selected workspace.');
    if (capability?.schema !== 'upstate.native-run-assembly-capabilities/v1' || capability.available !== true ||
        capability.action !== 'run.start' || capability.source_runs !== true)
      throw Error(capability?.reason || 'Install the current original native run assembly operation in this application.');
    if (compose && (capability.prepared_grid_composition !== true || capability.composition_action !== 'run.assembly.compose'))
      throw Error(capability.composition_reason || 'Install the prepared input composition action in this application.');
    const candidates = {ndr: [], sdr: []};
    for (const run of data.runs || []) {
      const models = order.filter(model => reusableStage(run, model));
      if (!models.length) continue;
      const original = run.selection || {};
      const label = title(profiles.get(original.profile_id)) + ' · ' + title(scenarios.get(original.scenario_id)) +
        ' · grid ' + short(original.grid_id) + ' · run ' + short(run.id) + ' · ' + run.state;
      const row = {run, label, sameCase: sameCase(original, target),
        search: [label, run.id, original.grid_id, original.profile_id, original.scenario_id, title(grids.get(original.grid_id))].join(' ').toLocaleLowerCase()};
      for (const model of models) {
        const completedAt = (run.stages?.[model] || run.stage_summary?.[model]).completed_at;
        candidates[model].push({...row, completedAt, label: model.toUpperCase() + ' completed ' + completedAt + ' · ' + row.label});
      }
    }
    for (const model of order) candidates[model].sort((left, right) =>
      Number(right.sameCase) - Number(left.sameCase) ||
      String(right.completedAt).localeCompare(String(left.completedAt)) || left.run.id.localeCompare(right.run.id));
    if (order.some(model => !candidates[model].length))
      throw Error('Complete an original NDR stage and an original SDR stage in this workspace before combining their results.');
    const chosen = Object.fromEntries(order.map(model => [model, candidates[model].find(row => row.sameCase)?.run.id || '']));
    const query = {ndr: '', sdr: ''}, pages = {ndr: 0, sdr: 0}, pageSize = 50;
    let form, controls;
    function drawChooser(model) {
      const section = controls.querySelector('[data-assembly-model="' + model + '"]');
      const found = candidates[model].filter(row => !query[model] || row.search.includes(query[model]));
      const pageCount = Math.max(1, Math.ceil(found.length / pageSize));
      pages[model] = Math.min(pages[model], pageCount - 1);
      const shown = found.slice(pages[model] * pageSize, (pages[model] + 1) * pageSize);
      const retained = candidates[model].find(row => row.run.id === chosen[model]);
      if (retained && !shown.some(row => row.run.id === retained.run.id)) shown.unshift(retained);
      const select = section.querySelector('select');
      select.innerHTML = '<option value="">Choose an original completed run…</option>' +
        shown.map(row => '<option value="' + row.run.id + '"' + (chosen[model] === row.run.id ? ' selected' : '') + '>' +
          escapeHTML(row.label) + '</option>').join('');
      select.value = chosen[model];
      section.querySelector('[data-assembly-count]').textContent = found.length + ' matching original runs · page ' + (pages[model] + 1) + ' of ' + pageCount;
      section.querySelector('[data-assembly-action="previous"]').disabled = pages[model] === 0;
      section.querySelector('[data-assembly-action="next"]').disabled = pages[model] + 1 >= pageCount;
      section.querySelector('[data-assembly-action="inspect"]').disabled = !chosen[model];
      section.querySelector('[data-assembly-action="clear"]').disabled = !chosen[model];
    }
    function drawSourceSummary() {
      if (!compose || !form) return;
      const summary = form.querySelector('[data-assembly-summary]');
      const rows = order.map(model => {
        const run = candidates[model].find(row => row.run.id === chosen[model])?.run;
        const sourceGrid = grids.get(run?.selection?.grid_id);
        if (!run || !sourceGrid) return '<tr><th scope="row">' + model.toUpperCase() + '</th><td colspan="3">Choose its completed calculation.</td></tr>';
        return '<tr><th scope="row">' + model.toUpperCase() + '</th><td>' + escapeHTML(title(sourceGrid)) +
          '<small class="mono">' + escapeHTML(short(sourceGrid.id)) + '</small></td><td>' +
          escapeHTML(sourceGrid.grid?.resolution_m ?? 'Unknown') + ' m</td><td class="mono">' +
          escapeHTML(short(sourceGrid.spec?.source_collection_id)) + '</td></tr>';
      });
      summary.innerHTML = '<div class="table-scroll"><table><caption>Original prepared inputs</caption><thead><tr><th scope="col">Model</th>' +
        '<th scope="col">Prepared grid</th><th scope="col">Resolution</th><th scope="col">Source edition</th></tr></thead><tbody>' +
        rows.join('') + '</tbody></table></div><p class="note">The queued operation compares the actual input cells, masks, model domain and reporting area, preserving the selected resolution and original sources.</p>';
    }
    const option = row => '<option value="' + escapeHTML(row.id) + '">' + escapeHTML(title(row)) + '</option>';
    const targetFields = compose ?
      '<label class="full"><span>Full target parameter profile</span><select name="assembly_profile" required>' +
        '<option value="">Choose a retained NDR and SDR profile…</option>' + fullProfiles.map(option).join('') + '</select></label>' +
      '<label class="full"><span>Original target scenario</span><select name="assembly_scenario" required>' +
        '<option value="">Choose the retained land-cover scenario…</option>' + [...scenarios.values()].map(option).join('') + '</select></label>' +
      '<div class="full" data-assembly-summary></div>' +
      '<label class="full"><input type="checkbox" name="assembly_preview"> Check the prepared inputs only</label>' +
      '<p class="note full">An input check runs in the same retained queue and returns the target grid, run selection and source plan. Clear this choice to compose the inputs and queue the ordinary native run.</p>' : '';
    const chooser = model => '<fieldset class="full" data-assembly-model="' + model + '"><legend>Completed ' +
      model.toUpperCase() + ' calculation</legend><label><span>Find an original run</span><input type="search" data-assembly-search="' + model +
      '" placeholder="Run ID, scenario, profile or grid"></label><label><span>Original native run</span><select name="assembly_' + model +
      '" required data-assembly-choice="' + model + '"></select></label><p class="note" data-assembly-count></p><div class="page-actions">' +
      '<button type="button" class="small" data-assembly-action="previous">Previous</button><button type="button" class="small" data-assembly-action="next">Next</button>' +
      '<button type="button" class="small" data-assembly-action="inspect">Inspect selected run</button><button type="button" class="small" data-assembly-action="clear">Clear choice</button>' +
      '</div></fieldset>';
    openForm(compose ? 'Compose prepared inputs and complete native models' : 'Combine completed native models',
      compose ? 'Select completed original NDR and SDR calculations, retain their prepared input union, and continue through the existing native queue.' :
        'Reuse the completed original NDR and SDR calculations, then finish the full native outputs through the existing operator queue.',
      (compose ? '<p class="note full">The prepared grids may come from separate source editions. Choose a compatible full profile and equivalent original scenario; the native engine checks their actual scientific inputs.</p>' :
        '<div class="full"><strong>' + escapeHTML(title(scenario)) + '</strong><p>' + escapeHTML(title(profile)) + ' · ' +
          escapeHTML(title(grid)) + ' · NDR + SDR</p><p class="note">The original engine compares the target inputs, scenario, model arguments and every reused output. A completed stage remains reusable when a later stage in its source run failed. The assembly retains each original stage and source run.</p></div>') +
      '<div class="full" data-assembly-controls>' + order.map(chooser).join('') + '</div>' + targetFields +
      '<p class="note full">The retained operation continues after this form closes. Open its saved run to follow the ordinary native task, outputs and any original input difference.</p>',
      compose ? 'Compose inputs and queue native run' : 'Combine and finish native run', async () => {
        if (getState()?.workspace_key !== workspace) throw Error('Reopen native run assembly in the selected workspace.');
        const source_runs = Object.fromEntries(order.map(model => [model, form.elements.namedItem('assembly_' + model).value]));
        if (order.some(model => !identifier.test(source_runs[model]) || !candidates[model].some(row => row.run.id === source_runs[model])))
          throw Error('Choose one original completed run for each native model.');
        if (!compose) return submitAction('run.start', {run_id, source_runs});
        const profile_id = form.elements.namedItem('assembly_profile').value;
        const scenario_id = form.elements.namedItem('assembly_scenario').value;
        if (!fullProfiles.some(row => row.id === profile_id) || !scenarios.has(scenario_id))
          throw Error('Choose the retained full target profile and original scenario.');
        return submitAction(capability.composition_action, {
          source_runs, profile_id, scenario_id,
          preview_only: form.elements.namedItem('assembly_preview').checked});
      }, () => {
        form = document.querySelector('#operation-form');
        controls = form.querySelector('[data-assembly-controls]');
        for (const model of order) drawChooser(model);
        drawSourceSummary();
        if (compose) {
          const preview = form.elements.namedItem('assembly_preview');
          preview.addEventListener('change', () => {
            const submit = document.querySelector('#form-submit');
            if (submit) submit.textContent = preview.checked ? 'Queue input check' : 'Compose inputs and queue native run';
          });
        }
        controls.addEventListener('input', event => {
          const model = event.target.dataset.assemblySearch;
          if (!order.includes(model)) return;
          query[model] = event.target.value.trim().toLocaleLowerCase(); pages[model] = 0; drawChooser(model);
        });
        controls.addEventListener('change', event => {
          const model = event.target.dataset.assemblyChoice;
          if (!order.includes(model)) return;
          chosen[model] = event.target.value; drawChooser(model);
          if (compose && model === 'ndr') {
            const selected = candidates.ndr.find(row => row.run.id === chosen.ndr)?.run.selection;
            const profileField = form.elements.namedItem('assembly_profile');
            const scenarioField = form.elements.namedItem('assembly_scenario');
            if (!profileField.value && fullProfiles.some(row => row.id === selected?.profile_id)) profileField.value = selected.profile_id;
            if (!scenarioField.value && scenarios.has(selected?.scenario_id)) scenarioField.value = selected.scenario_id;
          }
          drawSourceSummary();
        });
        controls.addEventListener('click', event => {
          const button = event.target.closest('[data-assembly-action]');
          if (!button || button.disabled) return;
          const model = button.closest('[data-assembly-model]')?.dataset.assemblyModel;
          if (!order.includes(model)) return;
          event.preventDefault();
          const action = button.dataset.assemblyAction;
          if (action === 'inspect') {
            Promise.resolve(openItem('runs', chosen[model])).catch(error => {
              if (controls.isConnected) controls.querySelector('[data-assembly-model="' + model + '"] [data-assembly-count]').textContent = error.message;
            });
            return;
          }
          if (action === 'previous') pages[model]--;
          if (action === 'next') pages[model]++;
          if (action === 'clear') chosen[model] = '';
          drawChooser(model);
          drawSourceSummary();
        });
      });
  }
  return {open};
}
