/** Future land-cover counterfactuals, using the original Workspace and queue. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (name, label, attrs = '') => `<button type="button" data-action="disturbance-${name}" ${attrs}>${escape(label)}</button>`;
const terminal = new Set(['complete', 'completed', 'failed', 'cancelled', 'canceled', 'interrupted']);
const draftFields = ['title', 'reason', 'cell_counts', 'from_codes', 'to_codes', 'buffer_m', 'baseline_run_ids'];
export function createDisturbanceDesk({getState, api, endpoint, submitAction, toast}) {
  let mounted = null, currentWorkspace = null, data = null, loading = false, busy = false;
  let version = 0, message = '', studyId = null, draft = null, draftRevision = 0;
  let workspaceEpoch = 0, observed = '', refreshAgain = false, storageMessage = '', pendingStudy = null;
  const workspace = () => getState()?.workspace_key;
  const storageKey = () => `upstate.disturbance-working-design.v1:${currentWorkspace}`;
  const tasks = () => (getState()?.tasks || []).filter(t => t.workspace === workspace() && String(t.action).startsWith('disturbance.'));
  const selectedStudy = () => data?.studies?.find(s => s.id === studyId);
  function remember() {
    if (!currentWorkspace) return;
    try {
      if (draft) localStorage.setItem(storageKey(), JSON.stringify({version:1, draft}));
      else localStorage.removeItem(storageKey());
      storageMessage = draft ? 'Working design saved in this browser. Saving native cases creates the transferable scientific edition.' : '';
    } catch {
      storageMessage = draft ? 'This browser cannot retain the working design after closing. Save native cases before leaving.' : '';
    }
  }
  function restoreDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null');
      if (saved?.version === 1 && saved.draft && draftFields.every(k => Object.hasOwn(saved.draft, k)) &&
          ['cell_counts','from_codes','to_codes','baseline_run_ids'].every(k => Array.isArray(saved.draft[k]))) {
        draft = Object.fromEntries(draftFields.map(k => [k, saved.draft[k]]));
        storageMessage = 'Restored this browser’s working design. Review the selected baselines before saving native cases.';
      }
    } catch { storageMessage = 'The saved browser working design could not be read. The original native studies remain available.'; }
  }
  function capture() {
    const form = mounted?.querySelector('#disturbance-design');
    if (!form || !draft) return;
    const v = new FormData(form);
    draft = {...draft, title:String(v.get('title')), reason:String(v.get('reason')), buffer_m:String(v.get('buffer_m')), baseline_run_ids:v.getAll('baselines')};
    for (const k of ['cell_counts','from_codes','to_codes']) draft[k] = String(v.get(k)).split(',').map(x => x.trim());
    remember();
  }
  function options() {
    const selected = draft?.baseline_run_ids || [], available = data?.baselines || [];
    const ordered = [...selected.map(id => available.find(r => r.id === id)).filter(Boolean), ...available.filter(r => !selected.includes(r.id))];
    const missing = selected.filter(id => !available.some(r => r.id === id));
    return (missing.length ? '<p class="dist-error">A selected baseline is no longer available. Refresh and select the intended completed baseline before saving.</p>' : '') +
      ordered.map(r => `<label class="dist-check"><input type="checkbox" name="baselines" value="${escape(r.id)}" ${selected.includes(r.id) ? 'checked' : ''}><span>${escape(r.title)}<small>Run ${escape(r.id.slice(0,12))} · grid ${escape(r.selection.grid_id.slice(0,12))}</small></span></label>`).join('');
  }
  function taskContent() {
    const rows = tasks();
    if (!rows.length) return '';
    return '<section class="dist-card"><h2>Saved preparation and report operations</h2><p>These are the original operator tasks. Use Tasks for full progress, cancellation and error details.</p><ul class="dist-operations">' + rows.map(t => {
      const state = t.state || t.status || 'queued';
      const failure = t.error ? (typeof t.error === 'string' ? t.error : t.error.message || JSON.stringify(t.error)) : '';
      return `<li><strong>${t.action === 'disturbance.prepare' ? 'Prepare native cases' : 'Create scientific report'}</strong><span>${escape(state)}</span>${failure ? `<p class="dist-error">${escape(failure)}</p>` : ''}<div class="dist-controls"><button type="button" data-action="task-open" data-id="${escape(t.id)}">Details</button>${['failed','interrupted','cancelled'].includes(state) ? `<button type="button" data-action="task-resume" data-id="${escape(t.id)}">Resume original selection</button>` : ''}${state === 'queued' ? `<button type="button" data-action="task-cancel" data-id="${escape(t.id)}">Cancel before start</button>` : ''}</div><details><summary>Operation identity</summary><code>${escape(t.id)}</code></details></li>`;
    }).join('') + '</ul></section>';
  }
  function content() {
    if (!workspace()) return '<h1>Future disturbance</h1><p>Open a scientific workspace.</p>';
    const selected = selectedStudy();
    const disabled = busy || loading ? 'disabled' : '';
    const ready = Boolean(data?.baselines?.length);
    return `<h1>Future disturbance and land protection</h1><p>Compare explicit land-cover changes with conversion retained or relocated around the original modeled stream. Save scientific choices, use the existing native queue, and read annual nitrogen, phosphorus and sediment results.</p>
      <div class="dist-controls">${button('refresh','Refresh saved studies',disabled)}${button('new','New editable study',!ready || busy ? 'disabled' : '')}${selected ? button('revise','Revise this design',busy ? 'disabled' : '') : ''}</div>
      <p class="dist-message" role="status" aria-live="polite">${escape(message || (loading ? 'Reading original studies…' : ''))}</p>
      ${!loading && data && !ready ? '<p>No completed baseline with a saved scientific profile is available here. Prepare and finish a baseline in the existing scientific workbench, then return to this desk.</p>' : ''}
      ${draft ? `<section class="dist-card" data-dist-draft="${draftRevision}"><h2>Design a native course</h2><form id="disturbance-design"><label>Study title<input name="title" value="${escape(draft.title)}" required></label><label>Scientific counterfactual and intended interpretation<textarea name="reason" required>${escape(draft.reason)}</textarea></label><div class="dist-grid"><label>Requested cell counts<input name="cell_counts" value="${escape(draft.cell_counts.join(', '))}" required></label><label>Original land-cover codes<input name="from_codes" value="${escape(draft.from_codes.join(', '))}" required></label><label>Destination codes<input name="to_codes" value="${escape(draft.to_codes.join(', '))}" required></label><label>Native stream buffer (metres)<input type="number" min="0" step="any" name="buffer_m" value="${escape(draft.buffer_m)}" required></label></div><p>Cell counts describe conversion area on the selected original grid. Codes retain their meanings in the original land cover and the chosen biophysical tables.</p><h3>Completed baseline profiles on the same grid</h3><p>The first selected baseline supplies the fixed stream geometry. Select one baseline per profile, all on the same grid; each keeps its own coefficients.</p>${options()}<p data-dist-storage role="status">${escape(storageMessage)}</p><div class="dist-controls">${button('prepare','Save source masks and native cases',busy ? 'disabled' : '')}${button('close','Discard working design',busy ? 'disabled' : '')}</div></form></section>` : ''}
      <section class="dist-card"><h2>Saved courses</h2>${!data ? `<p>${loading ? 'Reading saved editions…' : 'Refresh to read the saved editions.'}</p>` : !data.studies.length ? '<p>No disturbance studies are saved here. Use New editable study.</p>' : `<label>Scientific edition<select id="dist-study" ${busy ? 'disabled' : ''}>${data.studies.map(s => `<option value="${escape(s.id)}" ${s.id === studyId ? 'selected' : ''}>${escape(s.spec.title)} · ${s.completed_runs}/${s.unique_runs} native cases complete</option>`).join('')}</select></label>`}
      ${selected ? `<p>${escape(selected.spec.reason)}</p><div class="dist-stats"><strong>${selected.cases.length} case/profile combinations</strong><strong>${selected.completed_runs} / ${selected.unique_runs} unique runs complete</strong><strong>${selected.geometry.buffer_eligible_cells} eligible cells in buffer</strong></div><p>Original grid ${escape(selected.geometry.crs)}, ${escape(selected.geometry.pixel_area_ha)} ha/cell. Retain-buffer forgoes conversion; relocate preserves the requested area outside the buffer. Each destination retains the chosen profile’s original coefficients.</p><div class="dist-controls">${button('queue',selected.completed_runs === selected.unique_runs ? 'Create report from completed runs' : 'Queue unfinished native runs and report',`data-id="${escape(selected.id)}" ${busy ? 'disabled' : ''}`)}</div>
        ${(selected._downloads || []).length ? '<h3>Complete results and receiving</h3><div class="dist-controls">' + selected._downloads.map(f => `<a class="button" href="${escape(f.url + (f.url.includes('?') ? '&' : '?') + 'download=1')}" download>${escape(f.label)} · ${Math.round(f.bytes/1024).toLocaleString()} KB</a>`).join('') + '</div><p>Extract Review Package and open index.html for the map, exact cell inspection, original GeoTIFFs, full result table and editable review. The normal Workspace backup carries all scenarios, native runs and this source.</p>' : '<p>Finish the native cases and create the report to receive readable results and editable review files.</p>'}
        <details><summary>Original scientific selection and identity</summary><code>${escape(selected.id)}</code><pre>${escape(JSON.stringify(selected.spec,null,2))}</pre></details>` : ''}</section>${taskContent()}`;
  }
  function paint() {
    if (!mounted) return;
    // Catalogue/task updates must not replace a scientist's live form or caret.
    const formCard = mounted.querySelector(`[data-dist-draft="${draftRevision}"]`);
    const keep = draft && formCard, active = keep && formCard.contains(document.activeElement) ? document.activeElement : null;
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    mounted.innerHTML = content();
    if (keep) {
      mounted.querySelector('[data-dist-draft]')?.replaceWith(formCard);
      formCard.querySelector('[data-dist-storage]').textContent = storageMessage;
      for (const b of formCard.querySelectorAll('button')) b.disabled = busy;
      if (active) { active.focus({preventScroll:true}); if (caret?.[0] != null) active.setSelectionRange(...caret); }
    } else {
      const form = mounted.querySelector('#disturbance-design');
      form?.addEventListener('input', () => {capture(); const note = form.querySelector('[data-dist-storage]'); if (note) note.textContent = storageMessage;});
      form?.addEventListener('change', capture);
      form?.addEventListener('submit', event => {event.preventDefault(); void dispatch(form.querySelector('[data-action="disturbance-prepare"]'));});
    }
    mounted.querySelector('#dist-study')?.addEventListener('change', e => {capture(); studyId = e.target.value; paint();});
  }
  async function refresh({quiet=false} = {}) {
    if (!workspace() || !mounted) return;
    if (loading) {refreshAgain = true; return;}
    capture();
    const ws = workspace(), n = ++version;
    loading = true; if (!quiet) paint();
    try {
      const value = await api(endpoint('/api/disturbance/catalog'));
      if (ws !== workspace() || n !== version) return;
      if (!Array.isArray(value?.studies) || !Array.isArray(value?.baselines)) throw Error('The saved-study catalogue was not returned. Refresh to retry.');
      data = value;
      if (pendingStudy && data.studies.some(s => s.id === pendingStudy)) {studyId = pendingStudy; pendingStudy = null;}
      if (!data.studies.some(s => s.id === studyId)) studyId = data.studies[0]?.id || null;
    } catch (e) {if (ws === workspace() && n === version) message = e.message || String(e);}
    finally {
      if (ws === workspace() && n === version) {
        loading = false; paint();
        if (refreshAgain) {refreshAgain = false; void refresh({quiet:true});}
      }
    }
  }
  function integers(value, positive=false) {
    const parts = String(value).split(',').map(s => s.trim());
    if (!parts.length || parts.some(s => !/^-?\d+$/.test(s))) throw Error('Enter whole-number values separated by commas.');
    const values = parts.map(Number);
    if (values.some(n => !Number.isSafeInteger(n) || (positive && n < 1))) throw Error(positive ? 'Cell counts must be positive safe whole numbers.' : 'Land-cover codes must be safe whole numbers.');
    return values;
  }
  function checkedSpec(form) {
    const values = new FormData(form), ids = values.getAll('baselines');
    if (!ids.length) throw Error('Select at least one completed baseline profile.');
    const baselines = ids.map(id => data.baselines.find(r => r.id === id));
    if (baselines.some(r => !r)) throw Error('Refresh and select available completed baselines.');
    if (new Set(baselines.map(r => r.selection.grid_id)).size !== 1) throw Error('Select baseline profiles on the same original grid.');
    if (new Set(baselines.map(r => r.selection.profile_id)).size !== ids.length) throw Error('Select one baseline run per scientific profile.');
    const from = integers(values.get('from_codes')), to = integers(values.get('to_codes'));
    if (from.some(code => to.includes(code))) throw Error('Original and destination land-cover codes must be distinct.');
    const buffer = Number(values.get('buffer_m'));
    if (!Number.isFinite(buffer) || buffer < 0) throw Error('Enter a finite, nonnegative stream buffer in metres.');
    return {title:String(values.get('title')).trim(), reason:String(values.get('reason')).trim(), cell_counts:integers(values.get('cell_counts'),true), from_codes:from, to_codes:to, buffer_m:buffer, baseline_run_ids:ids};
  }
  async function dispatch(node) {
    if (!node?.dataset?.action?.startsWith('disturbance-')) return false;
    const action = node.dataset.action.slice('disturbance-'.length), ws = workspace(), epoch = workspaceEpoch;
    const current = () => ws === workspace() && epoch === workspaceEpoch;
    if (busy) return true;
    capture();
    try {
      if (action === 'refresh') {message = ''; await refresh(); return true;}
      if (action === 'new') {
        draft = {title:'Future land-cover disturbance',reason:'',cell_counts:[250,750,1500],from_codes:[41],to_codes:[81,82],buffer_m:90,baseline_run_ids:data?.baselines?.slice(0,1).map(r => r.id) || []};
        draftRevision++; remember(); paint(); return true;
      }
      if (action === 'revise') {
        const selected = selectedStudy(); if (!selected) throw Error('Refresh and choose a saved scientific edition.');
        draft = Object.fromEntries(draftFields.map(k => [k, structuredClone(selected.spec[k])]));
        draft.title += ' / revision'; draftRevision++; remember(); paint(); return true;
      }
      if (action === 'close') {draft = null; draftRevision++; remember(); paint(); return true;}
      if (action === 'prepare') {
        const form = mounted?.querySelector('#disturbance-design');
        if (!form?.reportValidity()) return true;
        const spec = checkedSpec(form); if (!spec.title || !spec.reason) throw Error('Name the study and describe its scientific interpretation.');
        busy = true; message = ''; paint();
        const accepted = await submitAction('disturbance.prepare', {spec});
        if (current()) {
          draft = null; draftRevision++; remember();
          pendingStudy = accepted.result?.id || null;
          const task = tasks().find(t => t.id === accepted.id) || accepted;
          message = `Native preparation ${task.state || task.status || 'accepted'}. Its original state and error details appear below and in Tasks.`;
          void refresh({quiet:true});
        }
        return true;
      }
      if (action === 'queue' || action === 'report') {
        const selected = data?.studies?.find(s => s.id === node.dataset.id);
        if (!selected) throw Error('Refresh and choose the saved scientific edition.');
        busy = true; message = ''; paint(); let queued = 0;
        if (action === 'queue') for (const id of [...new Set(selected.cases.map(c => c.run_id))]) {
          if (!current()) throw Error('The workspace changed; remaining submissions were stopped.');
          if (selected.run_states[id] === 'complete') continue;
          const admitted = await api('/api/actions', {method:'POST',body:{workspace:ws,action:'run.start',payload:{run_id:id},operation_id:'disturbance-'+id}});
          if (['failed','interrupted','cancelled'].includes(admitted.state)) {
            if (!current()) throw Error('The workspace changed before the retained task could resume.');
            await api('/api/task/resume', {method:'POST',body:{id:admitted.id}});
          }
          queued++;
        }
        if (!current()) throw Error('The workspace changed before report submission.');
        const accepted = await submitAction('disturbance.report', {study_id:selected.id});
        if (current()) {
          const task = tasks().find(t => t.id === accepted.id) || accepted;
          const status = task.state || task.status || 'accepted';
          message = `${queued ? queued + ' native tasks accepted. ' : ''}Scientific report ${status}. The original task and saved downloads are shown below.`;
          void refresh({quiet:true});
        }
        return true;
      }
    } catch (error) {if (current()) {message = error.message || String(error); toast?.(message);}}
    finally {if (current()) {busy = false; paint();}}
    return true;
  }
  function resetWorkspace() {
    if (currentWorkspace === workspace()) return false;
    capture(); version++; workspaceEpoch++; currentWorkspace = workspace(); data = null; draft = null; draftRevision++;
    loading = false; busy = false; studyId = null; message = ''; observed = ''; refreshAgain = false; pendingStudy = null; storageMessage = '';
    if (currentWorkspace) restoreDraft();
    return true;
  }
  function render() {return '<section id="disturbance-desk">' + content() + '</section>';}
  function mount(root) {
    resetWorkspace();
    if (!root) return;
    mounted = root.matches?.('#disturbance-desk') ? root : root.querySelector?.('#disturbance-desk');
    // The extension host supplies its content root, not pre-rendered desk markup.
    if (!mounted) {root.innerHTML = render(); mounted = root.querySelector('#disturbance-desk');}
    paint(); update(); if (!loading) void refresh();
  }
  function update() {
    const changedWorkspace = resetWorkspace(); if (!mounted) return;
    if (changedWorkspace) paint();
    const state = getState(), relevant = tasks();
    const signature = JSON.stringify([workspace(), (state?.data?.runs || []).map(r => [r.id,r.state]), relevant.map(t => [t.id,t.state || t.status,t.result?.id,t.updated_at])]);
    if (signature === observed) return;
    observed = signature;
    const prepared = relevant.find(t => t.action === 'disturbance.prepare' && (t.state === 'complete' || t.status === 'complete') && t.result?.id);
    if (prepared && !data?.studies?.some(s => s.id === prepared.result.id)) pendingStudy = prepared.result.id;
    const last = relevant[0], status = last?.state || last?.status;
    if (last && terminal.has(status)) message = `${last.action === 'disturbance.prepare' ? 'Native preparation' : 'Scientific report'} ${status}. ${status === 'complete' || status === 'completed' ? 'Its saved scientific edition is available below.' : 'See the original task details below; completed scientific runs remain available.'}`;
    void refresh({quiet:Boolean(data)});
  }
  function detach() {capture(); mounted = null; version++; loading = false; refreshAgain = false;}
  return {render,mount,update,detach,dispatch};
}
