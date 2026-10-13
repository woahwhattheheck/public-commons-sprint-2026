/** Preview an actual source-edition successor inside the maintained Programme desk. */
const rows = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => String(value ?? '').slice(0, 12);
const stateName = value => String(value || 'pending').replaceAll('_', ' ');
const cell = value => '<td>' + esc(value) + '</td>';
function nativeWork(row) {
  if (!row.target_run_id) return 'Prepare the source mapping';
  if (row.target_state === 'complete') return 'Completed native result available';
  if (rows(row.reuse_source_run_ids).length) return 'Compare original native inputs; reuse matching stages and run changed stages';
  if (row.prepared_on_create) return 'Prepared when saved; continue in Programme';
  return row.requires_native_rerun ? 'Continue the selected native run' : 'Continue; original stages may be reused';
}
function mappingDetails(row) {
  const dependencies = ['profile', 'scenario', 'grid'].map(kind =>
    '<small><strong>' + esc(kind[0].toUpperCase() + kind.slice(1)) + ':</strong><br>Original: <code>' +
    esc(row['source_' + kind + '_id'] || 'Unavailable') + '</code><br>Successor: <code>' +
    esc(row['target_' + kind + '_id'] || 'Awaiting preparation') + '</code></small>').join('');
  const sources = ['from', 'to'].map(side => '<small><strong>' +
    (side === 'from' ? 'Original sources' : 'Successor sources') + ':</strong> ' +
    (rows(row.source_ids?.[side]).map(item => esc(item.kind) + ' · <code>' + esc(item.collection_id) +
      '/' + esc(item.source_id) + '</code>').join('<br>') || 'No retained source references') + '</small>').join('');
  const candidates = rows(row.reuse_candidates).map(item => '<small><code>' + esc(item.run_id) + '</code> · ' +
    'selected model scope: ' + esc(rows(item.models).join(', ')) + '</small>').join('');
  const skipped = rows(row.reuse_skipped).map(item => '<small><code>' + esc(item.run_id) + '</code> · ' +
    esc(item.reason) + '</small>').join('');
  const reuse = candidates ? '<p><strong>Original stage candidates</strong><br>' + candidates +
    'The native input matcher checks each selected model before reusing its retained stage. Candidate selection does not assert equivalent inputs.</p>' : '';
  const omitted = skipped ? '<p><strong>Originals not selected for reuse</strong><br>' + skipped + '</p>' : '';
  return '<details><summary>Source, dependency and native reuse details</summary>' + dependencies + sources + reuse + omitted + '</details>';
}
const button = (action, title, extra = '') => '<button type="button" data-source-successor="' + action + '" ' + extra + '>' + esc(title) + '</button>';

export function attachProgrammeSourceUpdates(context) {
  const {api, endpoint, getState, beginFormOpening, openProgramme} = context;
  let generation = 0, active = null;
  function detach() {
    generation++;
    active?.request?.abort();
    active?.events?.abort();
    active = null;
  }
  function alive(view) {
    return active === view && view.generation === generation && view.opening.active() &&
      getState()?.workspace_key === view.workspace &&
      view.root?.isConnected && document.querySelector('[data-source-successor-form]') === view.root &&
      document.querySelector('#form-dialog')?.open;
  }
  function download(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selection(view) {
    return {programme_id: view.programmeId, refresh_plan_id: view.root.querySelector('[name="successor_plan"]').value,
      title: view.root.querySelector('[name="successor_title"]').value.trim()};
  }
  function stamp(value) { return JSON.stringify([value.programme_id, value.refresh_plan_id, value.title]); }
  function notice(view, message, error = false) {
    if (!alive(view)) return;
    const target = view.root.querySelector('[data-successor-notice]');
    target.textContent = message; target.classList.toggle('error', error); target.hidden = !message;
  }
  function controls(view) {
    if (!alive(view)) return;
    const frozen = view.loading || Boolean(view.submitted);
    for (const field of view.root.querySelectorAll('[name="successor_plan"],[name="successor_title"]')) field.disabled = frozen;
    view.root.querySelector('[data-source-successor="preview"]').disabled = frozen || !view.catalog.plans.length;
    view.root.querySelector('[data-source-successor="download"]').disabled = !view.preview;
    document.querySelector('#form-submit').disabled = view.loading || (!view.submitted && !view.preview?.ready);
  }
  function showRows(view) {
    const all = rows(view.preview?.runs), offset = view.offset;
    const visible = all.slice(offset, offset + 50);
    const content = view.root.querySelector('[data-successor-results]');
    if (!view.preview) { content.innerHTML = ''; return; }
    const counts = {replace: 0, retain: 0, pending: 0};
    for (const row of all) if (Object.hasOwn(counts, row.action)) counts[row.action]++;
    content.innerHTML = '<section><h3>Reviewed successor</h3><p>' + counts.replace + ' replaced · ' +
      counts.retain + ' retained · ' + counts.pending + ' awaiting source preparation.</p>' +
      '<p>' + esc(view.preview.ready ? 'This selection can be saved as a new Programme.' :
        'Complete the listed source preparation before creating this successor.') + '</p>' +
      (rows(view.preview.issues).length ? '<ul>' + view.preview.issues.map(item => '<li>' +
        esc((item.run_key ? item.run_key + ': ' : '') + item.message) + '</li>').join('') + '</ul>' : '') +
      (rows(view.preview.warnings).length ? '<ul>' + view.preview.warnings.map(item =>
        '<li>' + esc(typeof item === 'string' ? item : item.message) + '</li>').join('') + '</ul>' : '') +
      '<p>Source edition: ' + esc(view.preview.refresh_plan?.from_collection?.title) + ' → ' +
        esc(view.preview.refresh_plan?.to_collection?.title) + '</p>' +
      '<p>Original grid: <code>' + esc(short(view.preview.source_grid_id)) + '</code> · Successor grid: <code>' +
        esc(short(view.preview.target_grid_id) || 'Awaiting preparation') + '</code></p>' +
      '<div class="table-scroll" tabindex="0" aria-label="Source changes for every Programme case"><table><thead><tr>' +
      ['Case','Source action','Original run','Successor run','Native work','Reason'].map(value => '<th scope="col">' + esc(value) + '</th>').join('') +
      '</tr></thead><tbody>' + visible.map(row => '<tr>' + cell(row.title || row.key) + cell(stateName(row.action)) +
        '<td><code>' + esc(short(row.source_run_id)) + '</code><small>' + esc(stateName(row.source_state)) + '</small></td>' +
        '<td><code>' + esc(short(row.target_run_id) || 'Awaiting preparation') + '</code><small>' +
          esc(row.target_run_id ? (row.prepared_on_create ? 'Prepared on creation' : stateName(row.target_state)) : '') + '</small></td>' +
        cell(nativeWork(row)) +
        '<td>' + esc(rows(row.reasons).map(item => typeof item === 'string' ? item : item.message || item.code).join('; ')) +
        mappingDetails(row) + '</td></tr>').join('') +
      '</tbody></table></div><div class="programme-controls">' +
      button('previous','Previous cases', offset ? '' : 'disabled') + '<span>Cases ' +
        (all.length ? offset + 1 : 0) + '–' + Math.min(offset + 50, all.length) + ' of ' + all.length + '</span>' +
      button('next','Next cases', offset + 50 < all.length ? '' : 'disabled') + '</div>' +
      '<p class="note">The complete downloaded preview includes every case and its original source, scenario, profile and grid identities.</p></section>';
  }
  async function review(view) {
    if (!alive(view) || view.loading || view.submitted) return;
    const selected = selection(view);
    if (!selected.refresh_plan_id) { notice(view, 'Choose a saved source update plan.', true); return; }
    if (!selected.title) { notice(view, 'Enter a title for the successor Programme.', true); return; }
    view.preview = null; view.offset = 0; view.loading = true;
    view.request?.abort(); view.request = new AbortController();
    showRows(view); controls(view); notice(view, 'Reading the original source mappings and prepared native cases…');
    try {
      const result = await api('/api/programme-source-updates/preview', {
        method:'POST', body:{workspace:view.workspace, ...selected}, signal:view.request.signal});
      if (!alive(view) || stamp(selected) !== stamp(selection(view))) return;
      if (result.workspace_key !== view.workspace || result.programme?.id !== view.programmeId ||
          result.refresh_plan?.id !== selected.refresh_plan_id) throw Error('This preview belongs to another Programme or source plan.');
      view.preview = result; view.previewSelection = selected;
      showRows(view); notice(view, result.ready ? 'Review the mapped cases, then create the successor Programme.' :
        'The preview identifies the source preparation still needed.');
    } catch (error) {
      if (alive(view) && error.name !== 'AbortError') notice(view, error.message || String(error), true);
    } finally {
      view.loading = false;
      if (alive(view)) controls(view);
    }
  }
  async function open(programme) {
    if (!programme?.id) throw Error('Open the saved Programme whose source edition you want to update.');
    detach();
    const opening = beginFormOpening();
    const view = {generation, opening, programmeId:programme.id, workspace:opening.workspace,
      request:new AbortController(), events:new AbortController(), root:null, preview:null,
      previewSelection:null, offset:0, loading:false, submitted:null};
    active = view;
    let catalogue;
    try {
      catalogue = await opening.resolve(() => api(endpoint('/api/programme-source-updates/catalog', {programme_id:programme.id}),
        {signal:view.request.signal}));
    } catch (error) {
      if (active !== view || generation !== view.generation || getState()?.workspace_key !== view.workspace || error.name === 'AbortError') return;
      throw error;
    }
    if (active !== view || generation !== view.generation || getState()?.workspace_key !== view.workspace || !opening.pending()) return;
    if (catalogue.workspace_key !== view.workspace || catalogue.programme?.id !== programme.id)
      throw Error('The source update choices belong to another saved Programme.');
    view.catalog = catalogue;
    const plans = rows(catalogue.plans), successors = rows(catalogue.successors);
    const defaultTitle = ((catalogue.programme.title || 'Programme') + ' — source update').slice(0, 240);
    const html = '<div class="programme-form" data-source-successor-form><p>The saved source plan supplies the exact replacement runs or their published source dependencies. ' +
      'The successor keeps the named baseline and case order so its native results can be compared and exported through the usual Programme controls.</p>' +
      '<p><strong>Original Programme:</strong> ' + esc(catalogue.programme.title) + ' · ' + esc(catalogue.programme.run_count) + ' cases</p>' +
      '<div class="form-grid"><label>Saved source update<select name="successor_plan">' +
      (plans.length ? '<option value="">Choose an existing source plan</option>' + plans.map(plan => '<option value="' + esc(plan.id) + '">' +
        esc((plan.title || short(plan.id)) + ' · ' + plan.mapped_run_count + '/' + plan.affected_run_count +
          ' affected cases mapped · ' + stateName(plan.state)) + '</option>').join('') :
        '<option value="">No relevant saved source updates</option>') +
      '</select></label><label>Successor title<input name="successor_title" maxlength="240" required value="' +
        esc(defaultTitle) + '"></label></div>' +
      (!plans.length ? '<p>Open Source updates, choose the new source edition and prepare its affected native cases. Return here to review their mapping into this Programme.</p>' : '') +
      '<div class="programme-controls">' + button('preview','Preview successor') + button('download','Download complete preview','disabled') +
      '</div><p data-successor-notice class="notice" role="status" aria-live="polite" hidden></p><div data-successor-results></div>' +
      '<section><h3>Existing source successors</h3>' + (successors.length ? '<ul>' + successors.map(item =>
        '<li>' + esc(item.title || short(item.programme_id)) + ' · ' + esc(stateName(item.state)) + ' ' +
        button('open', 'Open Programme', 'data-programme-id="' + esc(item.programme_id) + '"') + '</li>').join('') + '</ul>' :
        '<p>Created successors will appear here and in the saved Programmes list.</p>') + '</section></div>';
    opening.show('Update Programme sources', 'Review one new source edition and retain its successor study.', html,
      'Create successor Programme', async () => {
        if (!alive(view)) throw Error('Reopen this source update in its original Programme and workspace.');
        if (!view.submitted) {
          if (!view.preview?.ready || stamp(selection(view)) !== stamp(view.previewSelection))
            throw Error('Preview this exact source plan and title before creating its successor.');
          view.submitted = {...view.previewSelection, expected_preview_id:view.preview.id};
        }
        controls(view);
        try { return await opening.submit('compute.programme.source-update', {...view.submitted}); }
        catch (error) {
          notice(view, 'The original request is retained in this form. Retry uses the same selection. ' +
            'Open Tasks to inspect accepted work; close and reopen this form to review another edition.', true);
          throw error;
        }
      }, () => {
        view.root = document.querySelector('[data-source-successor-form]');
        const signal = view.events.signal;
        view.root.addEventListener('input', () => {
          if (!alive(view) || view.submitted) return;
          view.preview = null; view.previewSelection = null; showRows(view); controls(view);
          notice(view, 'Preview the changed source selection before creating its successor.');
        }, {signal});
        view.root.addEventListener('change', () => {
          if (!alive(view) || view.submitted) return;
          view.preview = null; view.previewSelection = null; showRows(view); controls(view);
        }, {signal});
        view.root.addEventListener('click', event => {
          const target = event.target.closest('[data-source-successor]');
          if (!target || target.disabled || !alive(view)) return;
          const action = target.dataset.sourceSuccessor;
          if (action === 'preview') void review(view);
          else if (action === 'download' && view.preview) download(view.preview, 'programme-source-update-' + view.preview.id + '.json');
          else if (action === 'previous' || action === 'next') {
            view.offset = Math.max(0, Math.min(Math.max(0, Math.ceil(rows(view.preview?.runs).length / 50) - 1) * 50,
              view.offset + (action === 'next' ? 50 : -50))); showRows(view);
          } else if (action === 'open') {
            const id = target.dataset.programmeId;
            document.querySelector('#form-dialog').close();
            Promise.resolve(openProgramme(id)).catch(error => context.toast?.(error.message || String(error)));
          }
        }, {signal});
        document.querySelector('#form-dialog').addEventListener('close', () => {
          if (!document.querySelector('#form-dialog')?.open && active === view) detach();
        }, {signal});
        controls(view);
      });
  }
  return {open, detach};
}
