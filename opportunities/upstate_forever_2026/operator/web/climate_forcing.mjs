/* Climate forcing in the original operator. Scientific calculations remain in model. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => escape(JSON.stringify(value, null, 2));
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, {maximumSignificantDigits:8}) : String(value ?? '—');
const roles = ['PRECIPITATION', 'R_FACTOR'];
const label = role => role === 'PRECIPITATION' ? 'Precipitation / runoff proxy' : 'Rainfall erosivity';
const sourceKey = row => JSON.stringify([row.source_collection_id, row.source_id]);
const option = (value, title, selected) => '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(title) + '</option>';
const details = (title, value) => '<details><summary>' + escape(title) + '</summary><pre>' + json(value) + '</pre></details>';
const button = (action, title, attrs='') => '<button type="button" data-cf="' + action + '" ' + attrs + '>' + escape(title) + '</button>';
const id = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('This browser needs a secure context to retain unique operation identities.');
};
const emptyCase = n => ({id:'period-' + n, label:'Period ' + n, overrides:{}});
const newDraft = () => ({title:'Spatial climate forcing', purpose:'', baseline_run_id:'', cases:[emptyCase(1)], reporting_areas:[], difference_maps:true});
const terminal = state => ['complete','failed','cancelled','interrupted'].includes(state);
export function createClimateForcing(context) {
  const {api,getState} = context;
  let root=null,workspace=null,epoch=0,listener=null,timer=null,readAbort=null,busy=false,pollBusy=false;
  let catalog=null,draft=newDraft(),preview=null,study=null,report=null,error='',notice='',storageNotice='';
  let pending=[],tasks=[],selectedId='',currentRead=0,draftRevision=0;
  const $ = selector => root?.querySelector(selector);
  const $$ = selector => [...(root?.querySelectorAll(selector) || [])];
  const key = () => 'upstate.climate-forcing.v1:' + workspace;
  const active = (target, generation) => !!root && workspace === target && epoch === generation && getState()?.workspace_key === target;
  function persist() {
    try {
      sessionStorage.setItem(key(),JSON.stringify({draft,pending,tasks,selectedId}));
      storageNotice='';
    } catch (_) { storageNotice='Browser draft storage is unavailable. Submitted operations are retained by the operator; keep this view open until pending submissions are acknowledged.'; }
  }
  function restore() {
    try {
      const value=JSON.parse(sessionStorage.getItem(key()) || 'null');
      if(value) {
        if(value.draft && Array.isArray(value.draft.cases)) draft=value.draft;
        pending=Array.isArray(value.pending)?value.pending.filter(x=>x?.workspace===workspace && x.operation_id && x.action):[];
        tasks=Array.isArray(value.tasks)?value.tasks:[];
        selectedId=typeof value.selectedId==='string'?value.selectedId:'';
      }
    } catch (_) { storageNotice='The saved browser draft could not be read. Retained studies and tasks remain available from the operator.'; }
  }
  function url(kind,params={}) {
    return '/api/climate-forcing/' + kind + '?' + new URLSearchParams({workspace,...params});
  }
  function source(role,keyValue) {
    return (catalog?.sources?.[role] || []).find(row=>sourceKey(row)===keyValue);
  }
  function selection() {
    return structuredClone(draft);
  }
  function sourceControl(role, row, index) {
    const selected=row.overrides?.[role];
    const chosen=selected ? sourceKey(selected) : '';
    const values=catalog?.sources?.[role] || [];
    const original=source(role,chosen);
    return '<fieldset class="cf-source"><legend>' + escape(label(role)) + '</legend>' +
      '<label>Retained source<select data-source="' + role + '" data-index="' + index + '">' +
      option('','Use baseline source',chosen) +
      values.map(item=>option(sourceKey(item),item.title + (item.vintage?' · '+item.vintage:''),chosen)).join('') +
      (chosen && !original ? option(chosen,'Saved source — absent from current catalogue',chosen) : '') +
      '</select></label>' +
      (selected ? '<div class="cf-columns"><label>Period / edition label<input data-binding="period_label" data-role="' + role + '" data-index="' + index + '" value="' + escape(selected.period_label) + '" required></label>' +
        '<label>Annual temporal basis<input data-binding="temporal_basis" data-role="' + role + '" data-index="' + index + '" value="' + escape(selected.temporal_basis) + '" required placeholder="Annual total, 2025; or annual mean, 2021–2025"></label></div>' +
        '<label>Interpretation<textarea rows="2" data-binding="interpretation" data-role="' + role + '" data-index="' + index + '" required>' + escape(selected.interpretation) + '</textarea></label>' +
        (original ? '<p class="cf-meta">Units: ' + escape(original.units || 'not recorded') + ' · Source resolution: ' + escape(typeof original.source_resolution==='object'?JSON.stringify(original.source_resolution):original.source_resolution || 'not recorded') + '</p>' +
          details('Retained publisher metadata', original) : '<p class="cf-warning">Select a source present in this workspace before preparing.</p>') : '<p class="cf-meta">This input remains the same as the completed baseline.</p>') + '</fieldset>';
  }
  function draftMarkup() {
    const runs=catalog?.baseline_runs || [];
    const baseline=runs.find(row=>row.id===draft.baseline_run_id);
    return '<section><h2>1. Define forcing cases</h2>' +
      '<p>Each case changes explicitly selected spatial forcing sources. Terrain, land cover, soils, model parameters, intervention scenario and reporting geometry are retained from the completed baseline.</p>' +
      '<div class="cf-columns"><label>Study title<input data-draft="title" value="' + escape(draft.title) + '" required></label>' +
      '<label>Completed baseline<select data-draft="baseline_run_id">' + option('','Select a completed native run',draft.baseline_run_id) +
      runs.map(row=>option(row.id,(row.title || row.id) + ' · ' + (row.models || []).join(' + ') + ' · '+row.id,draft.baseline_run_id)).join('') +
      '</select></label></div><label>Purpose<textarea rows="2" data-draft="purpose" required>' + escape(draft.purpose) + '</textarea></label>' +
      (baseline?details('Baseline model selection',baseline.selection):'') +
      draft.cases.map((row,index)=>'<article class="cf-case"><div class="cf-case-heading"><h3>Case ' + (index+1) + '</h3>' +
        button('remove-case','Remove case','data-index="'+index+'"'+(draft.cases.length===1?' disabled':'')) + '</div>' +
        '<div class="cf-columns"><label>Case ID<input data-case="id" data-index="' + index + '" value="' + escape(row.id) + '" required></label>' +
        '<label>Case label<input data-case="label" data-index="' + index + '" value="' + escape(row.label) + '" required></label></div>' +
        roles.map(role=>sourceControl(role,row,index)).join('') + '</article>').join('') +
      '<div class="cf-actions">' + button('add-case','Add forcing case') + '</div>' +
      '<label class="cf-check"><input type="checkbox" data-draft="difference_maps"' + (draft.difference_maps?' checked':'') + '> Retain difference rasters for GIS</label>' +
      '<fieldset><legend>Additional polygon reporting layers</legend><p>The whole baseline reporting area is always included. Each choice summarizes the complete selected polygon source or layer within that mask. Multiple features are combined; point or line layers cannot define reporting areas.</p>' +
      ((catalog?.reporting_areas || []).length ? (catalog.reporting_areas || []).map((area,index)=>'<label class="cf-check"><input type="checkbox" data-area="' + index + '"' +
        (draft.reporting_areas.some(row=>row.source_collection_id===area.source_collection_id && row.source_id===area.source_id && (row.layer || '')===(area.layer || ''))?' checked':'') + '> ' +
        escape(area.title || area.source_id) + (area.layer?' · '+escape(area.layer):'') + '</label>').join('') : '<p class="cf-meta">No additional vector reporting areas are registered in this workspace.</p>') + '</fieldset>' +
      '<div class="cf-actions">' + button('preview','Preview retained inputs',busy?'disabled':'') + '</div></section>';
  }
  function previewMarkup() {
    if(!preview)return '';
    return '<section><h2>2. Review and prepare</h2><p>' + escape(preview.cases?.length ?? draft.cases.length) + ' alternative cases · ' + escape((preview.models || []).join(' + ')) + '</p>' +
      '<p>The preview binds these source bytes and the completed baseline. Preparing creates new grid and run records; execution uses the existing native run queue.</p>' +
      (preview.limitations?.length?'<ul>'+preview.limitations.map(value=>'<li>'+escape(typeof value==='string'?value:JSON.stringify(value))+'</li>').join('')+'</ul>':'') +
      details('Source bindings, spatial checks and retained selection',preview) +
      '<div class="cf-actions">'+button('prepare','Prepare these cases',busy?'disabled':'')+'</div></section>';
  }
  function studyMarkup() {
    if(!study)return '';
    const progress=study.progress || {};
    const caseRows=study.cases || [];
    const runnable=caseRows.filter(row=>!row.baseline && !['complete','running'].includes(row.state));
    return '<section><h2>3. Native model cases</h2><h3>' + escape(study.title || study.id) + '</h3>' +
      '<p>' + escape(study.state) + ' · ' + escape(progress.completed ?? 0) + ' of ' + escape(progress.total ?? caseRows.length) + ' runs complete</p>' +
      '<div class="cf-table"><table><thead><tr><th>Case</th><th>Forcing sources</th><th>Run state</th><th>Controls</th></tr></thead><tbody>' +
      caseRows.map(row=>'<tr><th scope="row">' + escape(row.label || row.id) + (row.baseline?' (baseline)':'') + '<small>' + escape(row.run_id) + '</small></th>' +
        '<td>'+roles.map(role=>'<div>'+escape(label(role))+': '+escape(row.overrides?.[role]?.period_label || 'baseline source')+'</div>').join('') + '</td>' +
        '<td>'+escape(row.state || 'prepared')+'</td><td><div class="cf-actions">' +
        (!row.baseline && !['complete','running'].includes(row.state) ? button('run','Queue native run','data-run="'+escape(row.run_id)+'"'+(busy?' disabled':'')):'') +
        button('log','Open run log','data-run="'+escape(row.run_id)+'"') +
        button('run-detail','Run details','data-run="'+escape(row.run_id)+'"') + '</div></td></tr>').join('') + '</tbody></table></div>' +
      '<div class="cf-actions">' + button('run-all','Queue unfinished cases',(busy || !runnable.length)?'disabled':'') +
      button('refresh','Refresh run states',busy?'disabled':'') +
      button('report','Compare completed cases',busy?'disabled':'') +
      (typeof context.openDesk==='function'?button('export-study','Export editable study',busy?'disabled':''):'') +
      (typeof context.openDesk==='function' && getState()?.climate_management?button('management','Compare management across periods',busy?'disabled':''):'') + '</div>' +
      '<p class="cf-meta">Completed runs are reused. New cases offer their completed baseline to the native input matcher, which reuses only equivalent original model stages and calculates the remaining stages. The comparison records the actual reuse outcome, completed-case roster and common finite area. Additional completed cases produce a new retained report.</p>' +
      details('Study selection and forcing diagnostics',study) + '</section>';
  }
  function reuseMarkup() {
    if(!report?.native_reuse)return '';
    const rows=Object.entries(report.native_reuse).flatMap(([caseId,observed])=>
      Object.entries(observed.models || {}).map(([model,stage])=>({
        caseLabel:(report.cases || []).find(row=>row.id===caseId)?.label || caseId,
        model,stage
      })));
    if(!rows.length)return '';
    const outcome=value=>({
      reused_original_stage:'Verified original stage reused',
      completed_without_reuse_record:'Completed; no reuse record',
      not_complete:'Not complete'
    })[value] || 'Outcome not recorded';
    return '<h3>Observed native stage reuse</h3>' +
      '<p>The original native matcher checks each candidate stage. This table describes the retained outcome; a proposed baseline donor does not establish reuse or a time saving.</p>' +
      '<div class="cf-table"><table><thead><tr><th>Case</th><th>Native model</th><th>Observed outcome</th><th>Original donor run</th><th>Retained completion</th></tr></thead><tbody>' +
      rows.map(({caseLabel,model,stage})=>'<tr><th scope="row">'+escape(caseLabel)+'</th><td>'+escape(model.toUpperCase())+'</td><td>'+
        escape(outcome(stage.outcome))+'</td><td>'+escape(stage.source?.run_id || '—')+'</td><td>'+
        escape(stage.reused_at || stage.completed_at || '—')+'</td></tr>').join('') +
      '</tbody></table></div>'+details('Original reuse records and candidate decisions',report.native_reuse);
  }
  function reportMarkup() {
    if(!report)return '';
    const rows=report.rows || [];
    const columns=[
      ['case','Case'],['area','Reporting area'],['pollutant','Export'],
      ['units','Units'],['baseline_mass','Baseline annual mass'],
      ['case_mass','Case annual mass'],['change','Change: case minus baseline'],
      ['percent_change','Change (%)'],['paired_area_ha','Common finite area (ha)']
    ];
    const cell = (row,name) => {
      const value=row[name];
      if(name==='pollutant')return ({n:'Nitrogen',nitrogen:'Nitrogen',nitrogen_export:'Nitrogen',p:'Phosphorus',phosphorus:'Phosphorus',phosphorus_export:'Phosphorus',sediment:'Sediment',sediment_export:'Sediment',sed:'Sediment'})[value] || value;
      if(name==='units')return value==='metric_tonnes/year'?'metric tonnes/year':value;
      if(name==='percent_change')return value===null||value===undefined?'—':fmt(value);
      if(name==='change' && typeof value==='number')return (value>0?'+':'')+fmt(value);
      return fmt(value);
    };
    return '<section><h2>4. Results and editable delivery</h2><p>' + escape(report.title || 'Climate-forcing comparison') + '</p>' +
      '<div class="cf-actions">'+(report._downloads || []).map(file=>'<a class="cf-download" href="'+escape(file.url)+'?download=1" download="'+escape(file.filename)+'">'+escape(file.label || file.filename)+'</a>').join('')+
      (report.source?button('source','Open GIS source collection'):'')+'</div>' +
      '<div class="cf-table"><table><thead><tr>'+columns.map(([name,title])=>'<th>'+escape(title)+'</th>').join('')+'</tr></thead><tbody>' +
      rows.map(row=>'<tr>'+columns.map(([name])=>'<td>'+escape(cell(row,name))+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></div>' +
      (report.limitations?.length?'<ul>'+report.limitations.map(value=>'<li>'+escape(typeof value==='string'?value:JSON.stringify(value))+'</li>').join('')+'</ul>':'') +
      '<p>Positive change means greater annual mass delivered to streams; negative change means less. Comparisons use each reported common finite area. A dash for percentage means the baseline or support cannot define a percentage.</p>' +
      (rows.some(row=>row.support_changed)?'<p class="cf-warning">Input or output coverage differs in one or more comparisons. Read the retained valid-cell and full-area totals alongside the matched-area results.</p>':'') +
      reuseMarkup() + details('Executed native versions',report.native_versions) + details('Spatial forcing diagnostics',report.forcing_diagnostics) +
      details('Reporting support and complete retained result',report) +
      '<p>Use the original workspace backup or full application delivery to carry source files, studies, model outputs and these reports together.</p></section>';
  }
  function tasksMarkup() {
    if(!pending.length && !tasks.length)return '';
    return '<section><h2>Retained operations</h2>'+
      (pending.length?'<p class="cf-warning">'+pending.length+' submission(s) await acknowledgement. Retry resends the same operation identity and exact payload.</p>'+
      button('retry','Reconcile pending submissions',busy?'disabled':''):'')+
      '<ul class="cf-task-list">'+tasks.map(task=>'<li><span>'+escape(task.action)+' · '+escape(task.state || 'submitted')+'</span> '+
      (task.id?button('task','Open task','data-task="'+escape(task.id)+'"'):'')+
      (task.error?'<p>'+escape(typeof task.error==='string'?task.error:task.error.message || JSON.stringify(task.error))+'</p>':'')+'</li>').join('')+'</ul></section>';
  }
  function render() {
    if(!root)return;
    const focus=document.activeElement;
    const restoreFocus=root.contains(focus)&&focus?.matches('input,textarea,select')?{tag:focus.tagName,data:{...focus.dataset},start:focus.selectionStart,end:focus.selectionEnd,value:focus.value}:null;
    root.classList.add('climate-forcing');
    root.innerHTML='<header><h1>Climate forcing</h1><p>Compare retained precipitation and rainfall-erosivity patterns with the same watershed model configuration.</p></header>' +
      '<div class="cf-status" role="status" aria-live="polite">'+escape(notice || (busy?'Working…':''))+'</div>' +
      (error?'<p class="cf-error" role="alert">'+escape(error)+'</p>':'') +
      (storageNotice?'<p class="cf-warning">'+escape(storageNotice)+'</p>':'') +
      '<aside><strong>Annual model interpretation</strong><p>NDR uses the saved profile’s normalization. With an automatic mean, uniform multipliers cancel on unchanged support; a fixed runoff-proxy mean preserves magnitude response. The comparison retains that setting and inspects actual native normalization. Rainfall erosivity is selected independently. Period differences alone do not establish a climate trend.</p></aside>' +
      '<section><div class="cf-columns"><label>Retained study<select data-saved-study>' +
      option('','Select a saved study',selectedId)+(catalog?.studies || []).map(row=>option(row.id,(row.title || row.id)+' · '+row.state,selectedId)).join('')+
      '</select></label><div class="cf-actions">'+button('open-study','Open study',busy?'disabled':'')+button('new','New study',busy?'disabled':'')+button('refresh','Refresh',busy?'disabled':'')+'</div></div></section>'+
      (!catalog?'<p>Loading retained sources and completed baselines…</p>':draftMarkup())+previewMarkup()+studyMarkup()+reportMarkup()+tasksMarkup();
    if(restoreFocus){const next=$$('input,textarea,select').find(el=>el.tagName===restoreFocus.tag&&JSON.stringify({...el.dataset})===JSON.stringify(restoreFocus.data));if(next){next.focus({preventScroll:true});if(typeof restoreFocus.start==='number'&&next.setSelectionRange){try{next.setSelectionRange(restoreFocus.start,restoreFocus.end);}catch(_){}}}}

  }
  function changed(event) {
    const el=event.target;
    if(el.matches('[data-saved-study]')){selectedId=el.value;persist();return;}
    draftRevision++;
    if(el.matches('[data-draft]'))draft[el.dataset.draft]=el.type==='checkbox'?el.checked:el.value;
    else if(el.matches('[data-case]'))draft.cases[Number(el.dataset.index)][el.dataset.case]=el.value;
    else if(el.matches('[data-binding]'))draft.cases[Number(el.dataset.index)].overrides[el.dataset.role][el.dataset.binding]=el.value;
    else if(el.matches('[data-source]')) {
      const row=draft.cases[Number(el.dataset.index)],role=el.dataset.source,found=source(role,el.value);
      if(!el.value)delete row.overrides[role];
      else if(found)row.overrides[role]={source_collection_id:found.source_collection_id,source_id:found.source_id,period_label:found.vintage || found.title || '',temporal_basis:'',interpretation:''};
      preview=null;persist();render();return;
    } else if(el.matches('[data-area]')) {
      const area=catalog.reporting_areas[Number(el.dataset.area)];
      draft.reporting_areas=draft.reporting_areas.filter(row=>!(row.source_collection_id===area.source_collection_id && row.source_id===area.source_id && (row.layer || '')===(area.layer || '')));
      if(el.checked)draft.reporting_areas.push({source_collection_id:area.source_collection_id,source_id:area.source_id,name:area.title || area.source_id,...(area.layer?{layer:area.layer}:{})});
    } else return;
    preview=null;persist();
    const old=$('button[data-cf="prepare"]');if(old)old.disabled=true;
  }
  async function refresh({loadStudy=true}={}) {
    const target=workspace,generation=epoch,request=++currentRead;
    readAbort?.abort();readAbort=new AbortController();
    const value=await api(url('catalog'),{signal:readAbort.signal});
    if(!active(target,generation)||request!==currentRead)return;
    catalog=value;
    if(loadStudy && selectedId) {
      const requestedId=selectedId;
      const record=await api(url('study',{id:requestedId}),{signal:readAbort.signal});
      if(!active(target,generation)||request!==currentRead)return;
      if(record?.id!==requestedId)throw new Error('The operator returned a different retained study.');
      study=record;
      if(record.latest_report?.id) {
        const retained=await api(url('report',{id:record.id,report_id:record.latest_report.id}),{signal:readAbort.signal});
        if(!active(target,generation)||request!==currentRead)return;
        report=retained;
      } else report=null;
    }
    render();
  }
  async function openSavedStudy(value) {
    const requestedId=value?.study_id;
    if(!root || !workspace || value?.workspace_key!==workspace || getState()?.workspace_key!==workspace)
      throw new Error('Open the receiving workspace before opening its climate forcing study.');
    if(!/^[0-9a-f]{64}$/.test(requestedId || ''))throw new Error('Select a retained climate forcing study.');
    const target=workspace,generation=epoch,version=draftRevision;
    selectedId=requestedId;study=null;report=null;preview=null;error='';persist();render();
    await refresh();
    if(!active(target,generation)||selectedId!==requestedId||study?.id!==requestedId)return null;
    if(version!==draftRevision)throw new Error('The draft changed while the saved study was loading. Open the saved study again to replace that draft.');
    if(!study.selection || !Array.isArray(study.selection.cases))throw new Error('The retained study does not include an editable selection.');
    draft=structuredClone(study.selection);draftRevision++;preview=null;persist();render();
    return study;
  }
  function rememberTask(value,request) {
    const record=value?.task || value;
    if(record?.workspace && record.workspace!==request.workspace)throw new Error('The operator returned a task from another workspace.');
    if(record?.action && record.action!==request.action)throw new Error('The operator returned a different action.');
    if(!record?.id)throw new Error('The operator response did not include a task identity; the exact submission remains pending.');
    const at=tasks.findIndex(row=>row.id===record.id);
    const next={...record,action:record.action || request.action,payload:record.payload || request.payload};
    if(at<0)tasks.push(next);else tasks[at]=next;
    pending=pending.filter(row=>row.operation_id!==request.operation_id);
    persist();
    return next;
  }
  async function submitRequest(request) {
    const target=workspace,generation=epoch;
    const response=await api('/api/actions',{method:'POST',body:request});
    if(!active(target,generation))return null;
    const task=rememberTask(response,request);
    if(task.state==='complete' && task.action==='climate-forcing.prepare' && task.result?.id) {
      selectedId=task.result.id;study=task.result;persist();await refresh();
    } else if(task.state==='complete' && task.action==='climate-forcing.report' && task.result?.study_id) {
      selectedId=task.result.study_id;persist();await refresh();
    }
    return task;
  }
  async function submit(action,payload) {
    const request={workspace,action,payload,operation_id:id()};
    pending.push(request);persist();render();
    return submitRequest(request);
  }
  async function queueRuns(rows) {
    const target=workspace,generation=epoch,selectedStudy=study;
    if(!selectedStudy?.id)throw new Error('Open the original retained forcing study.');
    for(const row of rows) {
      if(!active(target,generation))return;
      const current=[...tasks,...(Array.isArray(getState()?.tasks)?getState().tasks:[])].find(task=>task.action==='run.start' && (!task.workspace || task.workspace===target) && task.payload?.run_id===row.run_id && !terminal(task.state));
      const uncertain=pending.find(task=>task.action==='run.start' && task.payload?.run_id===row.run_id);
      if(current) {
        if(current.id && !tasks.some(task=>task.id===current.id))tasks.push(current);
        persist();continue;
      }
      if(uncertain)continue;
      const payload=await api(url('run-request',{id:selectedStudy.id,case_id:row.id}));
      if(!active(target,generation))return;
      const binding=payload?.climate_forcing_context;
      if(payload?.run_id!==row.run_id || binding?.schema!=='upstate.climate-forcing-native-case/v1' ||
         binding.study_id!==selectedStudy.id || binding.case_id!==row.id || binding.run_id!==row.run_id ||
         binding.workspace_id!==selectedStudy.workspace_id ||
         !Array.isArray(payload.reuse_source_run_ids) || payload.reuse_source_run_ids.length!==1 ||
         payload.reuse_source_run_ids[0]!==selectedStudy.selection.baseline_run_id)
        throw new Error('The operator returned a different forcing case or baseline donor.');
      await submit('run.start',payload);
    }
    if(!active(target,generation))return;
    notice='Native runs are retained in the existing operator queue.';
  }
  async function act(action,el) {
    if(busy)return;
    if(['preview','prepare'].includes(action)){const invalid=$$('input,textarea,select').find(item=>!item.checkValidity());if(invalid){invalid.reportValidity();return;}}
    if(pending.length && ['prepare','report'].includes(action)){error='Reconcile the pending submission before creating another operation.';render();return;}
    const target=workspace,generation=epoch;
    busy=true;error='';notice='';render();
    try {
      if(action==='preview') {
        if(!draft.baseline_run_id)throw new Error('Select a completed baseline run.');
        if(!draft.cases.length)throw new Error('Add at least one alternative forcing case.');
        if(draft.cases.some(row=>!Object.keys(row.overrides || {}).length))throw new Error('Select at least one changed forcing source for every alternative case.');
        const version=draftRevision;
        const value=await api(url('preview'),{method:'POST',body:{workspace,selection:selection()}});
        if(!active(target,generation))return;
        if(version!==draftRevision)throw new Error('The selection changed during preview. Preview the updated inputs.');
        preview=value;notice='Source-bound preview ready. Review the retained source periods and spatial checks.';
      } else if(action==='prepare') {
        if(!preview?.id)throw new Error('Preview the current selection before preparing.');
        await submit('climate-forcing.prepare',{selection:selection(),expected_id:preview.id});
        if(!active(target,generation))return;
        notice='Preparation is retained in the operator queue.';
      } else if(action==='report') {
        if(!study)throw new Error('Open a retained study.');
        await submit('climate-forcing.report',{study_id:study.id});
        if(!active(target,generation))return;
        notice='Comparison of the completed case roster is queued.';
      } else if(action==='run' || action==='run-all') {
        const rows=(study?.cases || []).filter(row=>!row.baseline && !['complete','running'].includes(row.state) && (action==='run-all'||row.run_id===el.dataset.run));
        await queueRuns(rows);
      } else if(action==='retry') {
        for(const request of [...pending]) {
          if(!active(target,generation))return;
          await submitRequest(request);
        }
        if(!active(target,generation))return;
        notice='Pending submissions reconciled with their original operation identities.';
      } else if(action==='open-study') {
        await openSavedStudy({workspace_key:workspace,study_id:selectedId});
      } else if(action==='refresh') {
        await refresh();
      } else if(action==='export-study') {
        if(!study || typeof context.openDesk!=='function')throw new Error('Open a retained study in the original operator.');
        await context.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[{kind:'climate-forcing-studies',id:study.id,title:study.title,state:study.state}]});
      } else if(action==='management') {
        if(!study || !getState()?.climate_management || typeof context.openDesk!=='function')throw new Error('Open the installed management comparison desk from a retained forcing study.');
        await context.openDesk('climate-management','openForStudy',{workspace_key:workspace,study_id:study.id});
      } else if(action==='new') {
        draft=newDraft();draftRevision++;preview=null;study=null;report=null;selectedId='';persist();
      } else if(action==='add-case') {
        let n=draft.cases.length+1;while(draft.cases.some(row=>row.id==='period-'+n))n++;
        draft.cases.push(emptyCase(n));draftRevision++;preview=null;persist();
      } else if(action==='remove-case') {
        if(draft.cases.length>1){draft.cases.splice(Number(el.dataset.index),1);draftRevision++;}
        preview=null;persist();
      } else if(action==='task') {
        if(context.showTask)await context.showTask(el.dataset.task);
      } else if(action==='log') {
        if(context.showRunLog)await context.showRunLog(el.dataset.run);
        else if(context.openItem)await context.openItem('runs',el.dataset.run);
      } else if(action==='run-detail') {
        if(context.openItem)await context.openItem('runs',el.dataset.run);
      } else if(action==='source' && report?.source && context.openItem) {
        await context.openItem('sources',report.source.source_collection_id);
      }
    } catch(cause) {
      if(active(target,generation)&&cause.name!=='AbortError')error=cause.message || String(cause);
    } finally {
      if(active(target,generation)){busy=false;render();schedule();}
    }
  }
  async function poll() {
    if(pollBusy||busy){schedule();return;}pollBusy=true;
    const target=workspace,generation=epoch;
    let refreshNeeded=false;
    try {
      for(const old of [...tasks].filter(row=>row.id&&!terminal(row.state))) {
        const value=await api('/api/task?'+new URLSearchParams({workspace:target,id:old.id}));
        if(!active(target,generation))return;
        const task=value?.task || value;
        if(task.id!==old.id || (task.workspace && task.workspace!==target))throw new Error('The returned task does not match this retained operation.');
        const at=tasks.findIndex(row=>row.id===old.id);
        if(at>=0)tasks[at]={...old,...task};
        if(terminal(task.state))refreshNeeded=true;
        if(task.state==='complete' && task.action==='climate-forcing.prepare' && task.result?.id) {
          selectedId=task.result.id;study=task.result;
        }
      }
      if(!active(target,generation))return;
      persist();
      if(refreshNeeded)await refresh();else render();
    } catch(cause) {
      if(active(target,generation)) {error=cause.message || String(cause);render();}
    } finally {if(active(target,generation)){pollBusy=false;schedule();}}
  }
  function schedule() {
    clearTimeout(timer);
    if(root&&tasks.some(row=>row.id&&!terminal(row.state)))timer=setTimeout(()=>{if(!busy)poll();else schedule();},2500);
  }
  function detach() {
    epoch++;currentRead++;readAbort?.abort();readAbort=null;clearTimeout(timer);timer=null;
    listener?.abort();listener=null;root=null;busy=false;pollBusy=false;
  }
  function mount(node,state) {
    detach();root=node;workspace=(state || getState())?.workspace_key;
    catalog=null;draft=newDraft();preview=null;study=null;report=null;pending=[];tasks=[];selectedId='';error='';notice='';storageNotice='';
    if(!workspace){root.textContent='Open a workspace to compare climate forcing.';return;}
    restore();listener=new AbortController();
    root.addEventListener('click',event=>{const el=event.target.closest('[data-cf]');if(el&&root.contains(el)){event.preventDefault();act(el.dataset.cf,el);}},{signal:listener.signal});
    root.addEventListener('input',event=>{if(!event.target.matches('select,input[type="checkbox"]'))changed(event);},{signal:listener.signal});
    root.addEventListener('change',event=>{if(event.target.matches('select,input[type="checkbox"]'))changed(event);},{signal:listener.signal});
    render();const target=workspace,generation=epoch;
    refresh().catch(cause=>{if(active(target,generation)&&cause.name!=='AbortError'){error=cause.message;render();}});schedule();
  }
  function update(state) {
    if(!root)return;
    if(state?.workspace_key!==workspace){detach();return;}
    const server=state.tasks || [];
    if(Array.isArray(server)) {
      const byId=new Map(server.map(task=>[task.id,task]));
      tasks=tasks.map(task=>byId.has(task.id)&&!terminal(byId.get(task.id).state)?{...task,...byId.get(task.id)}:task);
      persist();schedule();
    }
  }
  return {mount,update,detach,openSavedStudy};
}
