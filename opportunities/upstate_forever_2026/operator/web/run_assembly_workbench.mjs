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
  async function open({selection, run_id}) {
    const snapshot = getState(), workspace = snapshot?.workspace_key;
    if (!workspace || !snapshot.data) throw Error('Open the scientific workspace before assembling a native run.');
    if (!selection || !['grid_id', 'profile_id', 'scenario_id'].every(key => identifier.test(selection[key] || '')) ||
        nativeModels(selection).join('+') !== 'ndr+sdr')
      throw Error('Choose the complete target grid, profile, scenario and both native models.');
    const target = {grid_id: selection.grid_id, profile_id: selection.profile_id, scenario_id: selection.scenario_id};
    const data = snapshot.data;
    const targetRun = (data.runs || []).find(row => row.id === run_id);
    if (!identifier.test(run_id || '') || !targetRun || !sameCase(targetRun.selection, target) ||
        nativeModels(targetRun.selection).length !== 2)
      throw Error('Prepare the original full target run before selecting its completed model sources.');
    if (complete(targetRun)) return openItem('runs', run_id);
    if (!['prepared', 'failed'].includes(targetRun.state))
      throw Error('Choose a prepared or failed full target run to reuse its original completed model stages.');
    const grids = new Map((data.grids || []).map(row => [row.id, row]));
    const profiles = new Map((data.profiles || []).map(row => [row.id, row]));
    const scenarios = new Map((data.scenarios || []).map(row => [row.id, row]));
    const grid = grids.get(target.grid_id), profile = profiles.get(target.profile_id), scenario = scenarios.get(target.scenario_id);
    if (!grid || grid.state !== 'complete' || !profile || !scenario ||
        nativeModels(grid.spec).length !== 2 || nativeModels(profile).length !== 2)
      throw Error('Choose a completed target grid and retained profile containing both NDR and SDR inputs.');
    const capability = await api('/api/run-assembly/catalog?workspace=' + encodeURIComponent(workspace));
    if (getState()?.workspace_key !== workspace) throw Error('Reopen native run assembly in the selected workspace.');
    if (capability?.schema !== 'upstate.native-run-assembly-capabilities/v1' || capability.available !== true ||
        capability.action !== 'run.start' || capability.source_runs !== true)
      throw Error(capability?.reason || 'Install the current original native run assembly operation in this application.');
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
    const chooser = model => '<fieldset class="full" data-assembly-model="' + model + '"><legend>Completed ' +
      model.toUpperCase() + ' calculation</legend><label><span>Find an original run</span><input type="search" data-assembly-search="' + model +
      '" placeholder="Run ID, scenario, profile or grid"></label><label><span>Original native run</span><select name="assembly_' + model +
      '" required data-assembly-choice="' + model + '"></select></label><p class="note" data-assembly-count></p><div class="page-actions">' +
      '<button type="button" class="small" data-assembly-action="previous">Previous</button><button type="button" class="small" data-assembly-action="next">Next</button>' +
      '<button type="button" class="small" data-assembly-action="inspect">Inspect selected run</button><button type="button" class="small" data-assembly-action="clear">Clear choice</button>' +
      '</div></fieldset>';
    openForm('Combine completed native models',
      'Reuse the completed original NDR and SDR calculations, then finish the full native outputs through the existing operator queue.',
      '<div class="full"><strong>' + escapeHTML(title(scenario)) + '</strong><p>' + escapeHTML(title(profile)) + ' · ' +
        escapeHTML(title(grid)) + ' · NDR + SDR</p><p class="note">The original engine compares the target inputs, scenario, model arguments and every reused output. A completed stage remains reusable when a later stage in its source run failed. The assembly retains each original stage and source run.</p></div>' +
      '<div class="full" data-assembly-controls>' + order.map(chooser).join('') + '</div>' +
      '<p class="note full">The queued request retains both reused stages and completes the normal combined outputs. Progress and any original error remain in the run desk after this form closes.</p>',
      'Combine and finish native run', async () => {
        if (getState()?.workspace_key !== workspace) throw Error('Reopen native run assembly in the selected workspace.');
        const source_runs = Object.fromEntries(order.map(model => [model, form.elements.namedItem('assembly_' + model).value]));
        if (order.some(model => !identifier.test(source_runs[model]) || !candidates[model].some(row => row.run.id === source_runs[model])))
          throw Error('Choose one original completed run for each native model.');
        return submitAction('run.start', {run_id, source_runs});
      }, () => {
        form = document.querySelector('#operation-form');
        controls = form.querySelector('[data-assembly-controls]');
        for (const model of order) drawChooser(model);
        controls.addEventListener('input', event => {
          const model = event.target.dataset.assemblySearch;
          if (!order.includes(model)) return;
          query[model] = event.target.value.trim().toLocaleLowerCase(); pages[model] = 0; drawChooser(model);
        });
        controls.addEventListener('change', event => {
          const model = event.target.dataset.assemblyChoice;
          if (!order.includes(model)) return;
          chosen[model] = event.target.value; drawChooser(model);
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
        });
      });
  }
  return {open};
}
