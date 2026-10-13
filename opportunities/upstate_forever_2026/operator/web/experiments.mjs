/* Scenario experiments in the maintained Upper Savannah operator. */
const METRICS = [
  ['nitrogen_export', 'Nitrogen'],
  ['phosphorus_export', 'Phosphorus'],
  ['sediment_export', 'Sediment'],
];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) ?
  value.toLocaleString(undefined, {maximumFractionDigits:6}) : '—';
const count = value => typeof value==='string' && /^\d+$/.test(value) ?
  BigInt(value).toLocaleString() : number(value);
const short = value => value ? String(value).slice(0,12) : '—';
const human = value => String(value ?? '').replaceAll('_',' ');
const when = value => value ? new Date(value).toLocaleString() : '—';
const btn = (action,label,id='',extra='') =>
  '<button type="button" data-action="experiment-'+action+'"'+
  (id?' data-id="'+esc(id)+'"':'')+' '+extra+'>'+esc(label)+'</button>';
const status = value => '<span class="experiment-state">'+esc(human(value))+'</span>';
const table = (heads,rows) => '<div class="table-scroll"><table><thead><tr>'+
  heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
  (rows.length?rows.join(''):'<tr><td colspan="'+heads.length+'">No matching results.</td></tr>')+
  '</tbody></table></div>';
const option = (value,label,selected=false) =>
  '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const errorText = error => typeof error === 'object' && error ?
  error.message || error.type || JSON.stringify(error) : String(error || '');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const parameterValue = value => value === null ? 'Native mean' : finite(value) ? number(value) : esc(value ?? '—');

export function parseAxisValues(text, spec={}) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) throw Error('Enter selected values for each parameter.');
  const values = parts.map(part => {
    if (Array.isArray(spec.values)) {
      const match=spec.values.find(value=>String(value).toLowerCase()===part.toLowerCase());
      if (match===undefined) throw Error('Choose one of: '+spec.values.join(', ')+'.');
      return match;
    }
    if (String(spec.rule||'').includes('null') && part.toLowerCase()==='null') return null;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(part))
      throw Error('This parameter needs finite decimal numbers'+(String(spec.rule||'').includes('null')?' or null for the native mean.':'.'));
    const value = Number(part);
    if (!Number.isFinite(value)) throw Error('Parameter values must be finite.');
    return value;
  });
  return [...new Set(values)];
}

export function responseEnvelopes(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (row.state !== 'complete' || row.kind !== 'landcover') continue;
    for (const [metric,label] of METRICS) {
      const value = row.metrics?.[metric];
      if (!value || !finite(value.delta) || !value.support_sha256) continue;
      const key = JSON.stringify([row.scenario_id,metric,value.units,value.support_sha256]);
      let group = groups.get(key);
      if (!group) {
        group = {scenario_id:row.scenario_id,scenario_title:row.scenario_title,metric,label,
          units:value.units,support_sha256:value.support_sha256,profiles:new Set(),
          minimum:Infinity,maximum:-Infinity,coverage:value.coverage_fraction,
          percent_min:Infinity,percent_max:-Infinity,lower:0,higher:0,unchanged:0};
        groups.set(key,group);
      }
      group.profiles.add(row.profile_id);
      group.minimum=Math.min(group.minimum,value.delta);
      group.maximum=Math.max(group.maximum,value.delta);
      if (finite(value.relative_change_pct)) {
        group.percent_min=Math.min(group.percent_min,value.relative_change_pct);
        group.percent_max=Math.max(group.percent_max,value.relative_change_pct);
      }
      if(value.delta<0)group.lower++;else if(value.delta>0)group.higher++;else group.unchanged++;
    }
  }
  return [...groups.values()].map(row=>({...row,profiles:row.profiles.size,
    percent_min:Number.isFinite(row.percent_min)?row.percent_min:null,
    percent_max:Number.isFinite(row.percent_max)?row.percent_max:null}));
}

export function attachExperiments(context) {
  const {getState,api,endpoint,openForm,submitAction,fileList,toast,openItem,showTask,navigate,closeDetail}=context;
  let root=null,workspace=null,selected=null,offset=0,limit=100;
  let details=null,summary=null,search='',metric='all',kind='all',axes={},methods=[];
  let generation=0,controller=null,previewGeneration=0,previewController=null;

  const data=()=>getState()?.data || {};
  const experiments=()=>data().experiments || [];
  const name=(collection,id)=> {
    const row=(data()[collection]||[]).find(x=>x.id===id);
    return row?.title || row?.spec?.title || row?.metadata?.title || short(id);
  };
  const runName=row=>name('scenarios',row.selection?.scenario_id)+' · '+
    name('profiles',row.selection?.profile_id)+' · '+human(row.state);
  const selectionKey=()=> 'upstate-experiment-selected:'+workspace;
  const setSelected=id=> {
    selected=id;
    try{if(id)sessionStorage.setItem(selectionKey(),id);else sessionStorage.removeItem(selectionKey());}catch{}
  };
  function sameDesign(a,b) {
    if(!a||!b)return false;
    const normalized=value=>{
      const original=(data().runs||[]).find(run=>run.id===value.baseline_run_id)?.selection?.profile_id;
      return {schema:value.schema||'upstate.experiment-selection/v1',title:String(value.title||'').trim(),
        reason:String(value.reason||'').trim(),baseline_run_id:value.baseline_run_id,
        scenario_ids:[...new Set(value.scenario_ids||[])],
        profile_ids:[...new Set(value.profile_ids||[])].filter(id=>id!==original),
        design:value.design||'one_at_a_time',
        axes:(value.axes||[]).map(axis=>({path:axis.path,values:[...new Set(axis.values||[])],
          reference:String(axis.reference||'').trim()})).sort((x,y)=>x.path.localeCompare(y.path))};
    };
    return JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
  }
  function taskActions(task) {
    if(!task.action?.startsWith('experiment.'))return '';
    const id=task.result?.id||task.payload?.experiment_id||
      experiments().find(record=>sameDesign(record.selection,task.payload?.selection))?.id;
    return id?'<div class="page-actions">'+btn('show','Open experiment',id)+'</div>':'';
  }
  function axisEntries() {
    return Array.isArray(axes) ? axes.map(x=>typeof x==='string'?{path:x}:x) :
      Object.entries(axes||{}).map(([path,spec])=>({path,...(typeof spec==='object'?spec:{})}));
  }
  function heading() {
    return '<header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>'+
      '<h1>Scenario experiments</h1><p>Compare land-cover alternatives and explicit parameter choices on the retained study.</p>'+
      '</div><div class="page-actions">'+btn('new','New experiment','','class="primary"')+'</div></header>';
  }
  function renderList() {
    const rows=experiments();
    if(!rows.length)return '<section class="section"><div class="section-body"><h2>Set up a repeatable comparison</h2>'+
      '<p>Select a baseline run, existing alternatives and referenced parameter values. Each parameter profile receives its own baseline.</p>'+
      '<p>The native models, progress and results remain in this workspace for further runs and transfer.</p>'+
      btn('new','Create experiment','','class="primary"')+'</div></section>';
    return '<section class="section"><header class="section-header"><div><h2>Saved experiments</h2>'+
      '<p>Completed cases are reused when the experiment resumes.</p></div></header>'+
      table(['Experiment','State','Completed / total','Updated',''],rows.map(row=> {
        const p=row.progress||{},counts=row.counts_exact||row.counts||{};
        return '<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong><small class="mono">'+short(row.id)+'</small></td>'+
          '<td>'+status(row.state)+'</td><td class="number-cell">'+number(p.complete||0)+' / '+count(counts.cases||0)+
          ((p.failed||0)?'<small>'+number(p.failed)+' failed</small>':'')+'</td><td>'+esc(when(row.updated_at))+'</td>'+
          '<td class="actions-cell">'+btn('open',selected===row.id?'Selected':'Open',row.id)+
          btn('clone','Revise design',row.id)+'</td></tr>';
      }))+'</section>';
  }
  function render() {
    if(!root)return;
    root.innerHTML='<div class="experiment-workspace">'+heading()+renderList()+
      (selected?'<section id="experiment-detail" class="section"><div class="section-body"><p role="status">Opening saved experiment…</p></div></section>':'')+'</div>';
    if(details?.id===selected)renderDetails();
  }
  function matching(rows) {
    const query=search.trim().toLocaleLowerCase();
    return (rows||[]).filter(row=>(kind==='all'||row.kind===kind)&&
      (!query||[row.scenario_title,row.profile_title,row.scenario_id,row.profile_id,row.run_id].some(x=>String(x||'').toLocaleLowerCase().includes(query))));
  }
  function resultPage() {
    const complete=details?.state==='complete' && summary?.state==='complete' &&
      summary.id===details.id && summary.rows?.length===details.total_cases;
    const rows=complete?matching(summary.rows):(details?.cases||[]);
    const total=complete?rows.length:(details?.total_cases||0);
    if(complete)offset=Math.min(offset,Math.max(0,Math.floor((total-1)/limit)*limit));
    return {complete,total,total_display:complete?rows.length:(details?.total_cases_exact||total),rows:complete?rows.slice(offset,offset+limit):rows,
      next:complete?(offset+limit<total?offset+limit:null):details?.next_offset};
  }
  function renderPagination(page) {
    const first=page.total?offset+1:0,last=Math.min(offset+page.rows.length,page.total);
    return '<span>'+((search||kind!=='all')&&page.complete?'Matching cases ':'Cases ')+
      count(first)+'–'+count(last)+' of '+count(page.total_display)+'</span>'+
      btn('previous','Previous',selected,offset===0?'disabled':'')+
      btn('next','Next',selected,page.next===null||page.next===undefined?'disabled':'');
  }
  function invalidatePreview() {
    previewGeneration++;previewController?.abort();
    const node=document.querySelector('#experiment-preview');
    if(node)node.textContent='Design changed. Preview the current selection to refresh case counts.';
  }
  function renderMetrics(rows) {
    const result=[];
    for(const row of matching(rows)) {
      for(const [key,label] of METRICS) {
        if(metric!=='all'&&metric!==key)continue;
        const value=row.metrics?.[key];
        if(!value)continue;
        result.push('<tr><td>'+esc(row.scenario_title||short(row.scenario_id))+
          '<small>'+esc(row.profile_title||short(row.profile_id))+'</small></td><td>'+esc(human(row.kind))+
          '</td><td>'+label+'<small>'+esc(value.units)+'</small></td>'+
          ['baseline_total','alternative_total','delta','reduction','relative_change_pct'].map(field=>'<td class="number-cell">'+number(value[field])+'</td>').join('')+
          '<td class="number-cell">'+number(value.paired_cells)+'<small>'+
          (finite(value.coverage_fraction)?number(value.coverage_fraction*100)+'% coverage':'Coverage unavailable')+'</small></td></tr>');
      }
    }
    return table(['Scenario / profile','Case','Export / units','Paired baseline','Alternative','Signed change','Reduction','Change %','Paired support'],result);
  }
  function renderEnvelopes() {
    if(!summary?.rows)return '';
    const rows=responseEnvelopes(matching(summary.rows)).filter(row=>metric==='all'||row.metric===metric);
    if(!rows.length)return '';
    return '<h3>Alternative response across parameter profiles</h3><p class="note">Each range uses the same scenario, pollutant units and paired cell support. '
      +'These are outcomes of the selected parameter choices. Read them with the completed-case count.</p>'+
      table(['Scenario','Export','Profiles','Signed change range','Change % range','Direction'],rows.map(row=>
        '<tr><td>'+esc(row.scenario_title||short(row.scenario_id))+'</td><td>'+esc(row.label)+'<small>'+esc(row.units)+'</small></td>'+
        '<td class="number-cell">'+number(row.profiles)+'</td><td class="number-cell">'+number(row.minimum)+' to '+number(row.maximum)+'</td>'+
        '<td class="number-cell">'+number(row.percent_min)+' to '+number(row.percent_max)+'</td><td>'+
        (row.lower&&!row.higher&&!row.unchanged?'Lower export in every compared profile':
          row.higher&&!row.lower&&!row.unchanged?'Higher export in every compared profile':
          !row.lower&&!row.higher?'Unchanged export':'Mixed response')+'</td></tr>'));
  }
  function renderDetails() {
    const target=root?.querySelector('#experiment-detail');
    if(!target||!details)return;
    const d=details,p=d.progress||{},s=d.selection||{},page=resultPage(),cases=page.rows;
    const active=(getState()?.tasks||[]).find(t=>['queued','running'].includes(t.state)&&
      t.action.startsWith('experiment.')&&(t.payload?.experiment_id===d.id||
        sameDesign(t.payload?.selection,s)));
    target.innerHTML='<header class="section-header"><div><h2>'+esc(d.title)+'</h2><p>'+esc(s.reason||'')+'</p></div>'+
      '<div class="page-actions">'+status(d.state)+
      (active?btn('task','View running operation',active.id):
        d.state==='complete'?btn('report','Refresh report',d.id):btn('run',d.state==='prepared'?'Run experiment':'Resume experiment',d.id,'class="primary"'))+
      btn('clone','Revise design',d.id)+'</div></header>'+
      '<div class="section-body"><div class="experiment-counts">'+
      [['Completed',p.complete||0],['Pending',p.pending||0],['Failed',p.failed||0],['Planned cases',d.counts_exact?.cases||d.counts?.cases||0]].map(([label,value])=>
        '<div><span>'+label+'</span><strong>'+count(value)+'</strong></div>').join('')+'</div>'+
      '<p class="note">Each land-cover case uses a baseline with the same parameter profile. Signed change is alternative minus baseline; '
      +'positive reduction means less exported mass. Reference and parameter cases remain separate.</p>'+
      (p.active_case_id?'<p role="status">Current native case: <code>'+esc(short(p.active_case_id))+'</code></p>':'')+
      '<details><summary>Saved inputs and design</summary><dl class="definition"><dt>Baseline run</dt><dd>'+esc(short(s.baseline_run_id))+
      ' <button type="button" data-action="item" data-kind="runs" data-id="'+esc(s.baseline_run_id)+'">Open run</button></dd>'+
      '<dt>Design</dt><dd>'+esc(human(s.design))+'</dd><dt>Alternatives</dt><dd>'+
      (s.scenario_ids||[]).map(id=>esc(name('scenarios',id))).join(', ')+
      '</dd><dt>Additional profiles</dt><dd>'+(s.profile_ids||[]).map(id=>esc(name('profiles',id))).join(', ')+
      '</dd></dl>'+table(['Parameter','Selected values','Reference'],(s.axes||[]).map(a=>'<tr><td>'+esc(a.path)+'</td><td>'+
        a.values.map(parameterValue).join(', ')+'</td><td>'+esc(a.reference)+'</td></tr>'))+'</details>'+
      '<div class="experiment-filters"><label>'+(page.complete?'Search all cases':'Search this page')+'<input data-experiment-filter="search" value="'+esc(search)+
      '" placeholder="Name or retained run ID"></label><label>Case kind<select data-experiment-filter="kind">'+
      [['all','All cases'],['landcover','Land-cover alternatives'],['parameter','Parameter response'],['reference','Reference baseline']].map(([v,l])=>option(v,l,kind===v)).join('')+
      '</select></label><label>Pollutant<select data-experiment-filter="metric">'+option('all','All pollutants',metric==='all')+
      METRICS.map(([v,l])=>option(v,l,metric===v)).join('')+'</select></label></div>'+
      '<div id="experiment-result-tables">'+renderResultTables(cases)+'</div>'+
      '<div id="experiment-pagination" class="experiment-pagination">'+renderPagination(page)+'</div>'+
      '<h3>Reports and retained files</h3>'+fileList([...(d._downloads||[]),...(summary?._downloads||[])].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i))+
      ((!summary&&d.state!=='running')?'<p>'+btn('report','Build report from available cases',d.id)+'</p>':'')+
      '<p class="note">Use Back up workspace to transfer the experiment, original inputs and native models together.</p></div>';
  }
  function renderResultTables(cases) {
    return renderMetrics(cases)+renderEnvelopes()+'<h3>Native cases and continuation</h3>'+
      table(['Scenario','Profile','State','Run','Detail'],matching(cases).map(row=>
        '<tr><td>'+esc(row.scenario_title||short(row.scenario_id))+'</td><td>'+esc(row.profile_title||short(row.profile_id))+
        '</td><td>'+status(row.state)+'</td><td class="actions-cell">'+(row.run_id?
          '<button type="button" data-action="item" data-kind="runs" data-id="'+esc(row.run_id)+'">Open run</button>'+
          '<button type="button" data-action="spatial-item" data-kind="runs" data-id="'+esc(row.run_id)+'">Map</button>':
          'Awaiting preparation')+'</td><td>'+esc(errorText(row.error))+'</td></tr>'));
  }
  async function loadSelected() {
    if(!root||!selected)return;
    const current=++generation,forWorkspace=workspace,id=selected;
    controller?.abort();controller=new AbortController();
    try {
      const record=await api(endpoint('/api/experiments/inspect',{experiment_id:id,offset,limit}),{signal:controller.signal});
      if(current!==generation||forWorkspace!==workspace||id!==selected||!root)return;
      details=record;renderDetails();
      if(record.progress?.complete || ['complete','partial','failed'].includes(record.state)) {
        try {
          const report=await api(endpoint('/api/experiments/summary',{experiment_id:id}),{signal:controller.signal});
          if(current!==generation||forWorkspace!==workspace||id!==selected||!root)return;
          summary=report;renderDetails();
        }catch(error){if(error.name!=='AbortError'&&error.status!==404)throw error;}
      }
    }catch(error) {
      if(error.name==='AbortError'||current!==generation||forWorkspace!==workspace||!root)return;
      const target=root.querySelector('#experiment-detail');
      if(target)target.innerHTML='<div class="section-body"><p class="notice error" role="alert">'+esc(error.message)+
        '</p>'+btn('open','Retry opening experiment',id)+'</div>';
    }
  }
  function onFilter(event) {
    const field=event.target.dataset.experimentFilter;if(!field)return;
    if(field==='search')search=event.target.value;
    if(field==='kind')kind=event.target.value;
    if(field==='metric')metric=event.target.value;
    if(!details)return;
    if(resultPage().complete)offset=0;
    const page=resultPage(),results=root?.querySelector('#experiment-result-tables');
    if(results)results.innerHTML=renderResultTables(page.rows);
    const pagination=root?.querySelector('#experiment-pagination');
    if(pagination)pagination.innerHTML=renderPagination(page);
  }
  function detach() {
    generation++;controller?.abort();controller=null;
    if(root){root.removeEventListener('input',onFilter);root.removeEventListener('change',onFilter);}
    root=null;
  }
  function mount(container,currentState) {
    if(workspace!==currentState.workspace_key) {
      workspace=currentState.workspace_key;details=null;summary=null;offset=0;search='';metric='all';kind='all';
      try{selected=sessionStorage.getItem(selectionKey());}catch{selected=null;}
    }
    if(root!==container) {
      if(root){root.removeEventListener('input',onFilter);root.removeEventListener('change',onFilter);}
      root=container;root.addEventListener('input',onFilter);root.addEventListener('change',onFilter);
    }
    if(selected&&!experiments().some(row=>row.id===selected)){setSelected(null);details=null;summary=null;}
    render();loadSelected();
  }

  function axisRow(axis={}) {
    const entries=axisEntries(),chosen=axis.path||entries[0]?.path||'';
    return '<div class="experiment-axis" data-experiment-axis><label>Parameter<select name="experiment_axis_path" required>'+
      entries.map(entry=>option(entry.path,(entry.label||entry.title||human(entry.path))+' · '+entry.path+(entry.units?' ['+entry.units+']':''),entry.path===chosen)).join('')+
      '</select></label><label>Selected values<input name="experiment_axis_values" required value="'+
      esc((axis.values||[]).map(v=>v===null?'null':v).join(', '))+'" placeholder="Comma-separated values"></label>'+
      '<label>Published reference or study rationale<textarea name="experiment_axis_reference" required rows="2">'+esc(axis.reference||'')+
      '</textarea></label>'+btn('axis-remove','Remove parameter')+'</div>';
  }
  function readForm() {
    const form=document.querySelector('#operation-form');
    const field=name=>form.elements.namedItem(name);
    const values=name=>[...form.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
    const title=field('experiment_title').value.trim(),reason=field('experiment_reason').value.trim();
    const baseline=field('experiment_baseline').value;
    if(!title||!reason||!baseline)throw Error('Give the experiment a title, purpose and retained baseline run.');
    const selectedAxes=[...form.querySelectorAll('[data-experiment-axis]')].map(row=>({
      path:row.querySelector('[name="experiment_axis_path"]').value,
      values:parseAxisValues(row.querySelector('[name="experiment_axis_values"]').value,
        axisEntries().find(x=>x.path===row.querySelector('[name="experiment_axis_path"]').value)||{}),
      reference:row.querySelector('[name="experiment_axis_reference"]').value.trim(),
    }));
    if(selectedAxes.some(x=>!x.reference))throw Error('Each parameter choice needs its published reference or study rationale.');
    if(new Set(selectedAxes.map(x=>x.path)).size!==selectedAxes.length)throw Error('Combine values for the same parameter in one row.');
    return {schema:'upstate.experiment-selection/v1',title,reason,baseline_run_id:baseline,
      scenario_ids:values('experiment_scenario'),profile_ids:values('experiment_profile'),
      design:field('experiment_design').value,axes:selectedAxes};
  }
  async function newForm(id) {
    const forWorkspace=getState()?.workspace_key;
    previewGeneration++;previewController?.abort();
    const [schema,methodSource]=await Promise.all([
      api(endpoint('/api/experiments/axes')),api(endpoint('/api/experiments/methods'))]);
    if(getState()?.workspace_key!==forWorkspace)return;
    axes=schema.axes||{};methods=methodSource.methods||[];
    let selection={};
    if(id) {
      const record=await api(endpoint('/api/experiments/inspect',{experiment_id:id,limit:1}));
      if(getState()?.workspace_key!==forWorkspace)return;
      selection={...record.selection,title:record.title+' — revised'};
    }
    const baselineScenarios=new Set((data().scenarios||[]).filter(s=>s.kind==='baseline').map(s=>s.id));
    const baselineRuns=(data().runs||[]).filter(r=>baselineScenarios.has(r.selection?.scenario_id));
    if(!baselineRuns.length)throw Error('Prepare a native run using the retained baseline scenario, grid and parameter profile first.');
    const alternatives=(data().scenarios||[]).filter(s=>s.kind!=='baseline');
    const profiles=data().profiles||[];
    const checkbox=(name,row,checked)=>'<label class="experiment-choice"><input type="checkbox" name="'+name+
      '" value="'+esc(row.id)+'"'+(checked?' checked':'')+'><span><strong>'+esc(row.title||short(row.id))+
      '</strong><small>'+esc(row.reason||short(row.id))+'</small></span></label>';
    const html='<div class="experiment-form"><div class="experiment-form-grid">'+
      '<label>Experiment title<input name="experiment_title" required value="'+esc(selection.title||'')+'" autocomplete="off"></label>'+
      '<label>Baseline native run<select name="experiment_baseline" required>'+option('','Choose retained baseline')+
      baselineRuns.map(row=>option(row.id,runName(row),row.id===selection.baseline_run_id)).join('')+'</select></label>'+
      '<label class="full">Purpose and interpretation<textarea name="experiment_reason" required rows="3">'+esc(selection.reason||'')+'</textarea></label></div>'+
      '<fieldset><legend>Land-cover alternatives</legend><p>Every selected alternative is paired with a baseline using the same parameter profile.</p>'+
      (alternatives.length?'<div class="experiment-choices">'+alternatives.map(row=>checkbox('experiment_scenario',row,
        (selection.scenario_ids||[]).includes(row.id))).join('')+'</div>':
        '<p class="note">Save land-cover alternatives in the Scenarios view to include them here. Parameter comparisons can use the baseline landscape.</p>')+'</fieldset>'+
      '<fieldset><legend>Additional retained parameter profiles</legend><p>The selected baseline profile is included automatically. '
      +'These additional profiles keep their own original tables, references and assumptions.</p><div class="experiment-choices">'+
      profiles.map(row=>checkbox('experiment_profile',row,(selection.profile_ids||[]).includes(row.id))).join('')+'</div></fieldset>'+
      '<fieldset><legend>Parameter exploration</legend>'+
      (methods.length?'<div class="experiment-method"><label>Published starting profile<select name="experiment_method">'+
        methods.map(method=>option(method.id,method.title)).join('')+'</select></label>'+btn('method','Use regional reference values')+
        '<p class="note">Apply the cited scalar parameters as a joint profile. The selected native table and study inputs remain the basis of the run.</p></div>':'')+
      '<div class="experiment-form-grid">'+
      '<label>Design<select name="experiment_design">'+option('one_at_a_time','One parameter at a time',selection.design!=='factorial')+
      option('factorial','Every selected parameter combination',selection.design==='factorial')+'</select></label>'+
      '<p class="note">Enter values from the selected study or published method. A factorial design evaluates combinations of the supplied values.</p></div>'+
      '<div id="experiment-axis-rows">'+(selection.axes||[]).map(axisRow).join('')+'</div>'+
      btn('axis-add','Add parameter')+'</fieldset>'+
      '<div class="experiment-form-grid"><label>When saving<select name="experiment_execution">'+
      option('run','Save and run native models',true)+option('save','Save design for later execution')+'</select></label>'+
      '<p class="note">Native runs use the original workspace operation queue. Already completed cases are reused.</p></div>'+
      '<div class="experiment-preview"><div class="page-actions">'+btn('preview','Preview selected cases')+'</div>'+
      '<div id="experiment-preview" role="status" aria-live="polite">Preview the design to inspect its profile and run counts.</div></div></div>';
    openForm(id?'Revise experiment design':'New scenario experiment',
      'Select the actual retained study inputs. Saved designs and completed native cases remain available after reopening.',
      html,'Save and run',async()=> {
        const chosen=readForm(),mode=document.querySelector('[name="experiment_execution"]').value;
        await submitAction(mode==='save'?'experiment.save':'experiment.run',{selection:chosen});
      },()=> {
        const mode=document.querySelector('[name="experiment_execution"]');
        mode.addEventListener('change',()=>{document.querySelector('#form-submit').textContent=mode.value==='save'?'Save design':'Save and run';});
        document.querySelector('.experiment-form').addEventListener('input',invalidatePreview);
      });
  }
  async function previewDesign() {
    const selection=readForm(),target=document.querySelector('#experiment-preview');
    const forWorkspace=getState()?.workspace_key,current=++previewGeneration;
    previewController?.abort();previewController=new AbortController();
    target.textContent='Resolving the saved inputs and selected cases…';
    try {
      const result=await api('/api/experiments/preview',{method:'POST',
        body:{workspace:forWorkspace,selection},signal:previewController.signal});
      if(current!==previewGeneration||getState()?.workspace_key!==forWorkspace||
          document.querySelector('#experiment-preview')!==target)return;
      const c=result.counts_exact||result.counts||{};
      target.innerHTML='<strong>'+count(c.profiles)+' parameter profiles · '+count(c.cases)+
        ' cases · '+count(c.runs)+' native run selections</strong>'+
        '<p>Completed run selections will be reused. Each alternative receives its own same-profile baseline.</p>'+
        ((result.warnings||[]).length?'<ul>'+result.warnings.map(x=>'<li>'+esc(typeof x==='string'?x:JSON.stringify(x))+'</li>').join('')+'</ul>':'')+
        '<details><summary>Resolved parameter values</summary>'+
        table(['Parameter','Baseline value','Selected values','Reference'],(result.axis_values||[]).map(row=>
          '<tr><td>'+esc(row.path)+'</td><td>'+parameterValue(row.baseline_value)+'</td><td>'+
          (row.values||[]).map(parameterValue).join(', ')+'</td><td>'+esc(row.reference)+'</td></tr>'))+'</details>';
    }catch(error) {
      if(error.name==='AbortError')return;
      if(document.querySelector('#experiment-preview')===target)target.textContent='Correct the selection and preview again.';
      throw error;
    }
  }
  async function dispatch(button) {
    const action=button.dataset.action.slice('experiment-'.length),id=button.dataset.id;
    if(action==='new')return newForm();
    if(action==='clone')return newForm(id);
    if(action==='axis-add'){
      document.querySelector('#experiment-axis-rows').insertAdjacentHTML('beforeend',axisRow());
      invalidatePreview();return;
    }
    if(action==='axis-remove'){
      button.closest('[data-experiment-axis]').remove();invalidatePreview();return;
    }
    if(action==='method'){
      const id=document.querySelector('[name="experiment_method"]').value;
      const selectedMethod=methods.find(method=>method.id===id);
      if(!selectedMethod)throw Error('Select an available published profile.');
      const supported=new Set(axisEntries().map(axis=>axis.path));
      if(selectedMethod.axes.some(axis=>!supported.has(axis.path)))throw Error('This profile refers to a parameter outside the selected native model.');
      document.querySelector('#experiment-axis-rows').innerHTML=selectedMethod.axes.map(axisRow).join('');
      document.querySelector('[name="experiment_design"]').value=selectedMethod.design||'factorial';
      previewGeneration++;previewController?.abort();
      document.querySelector('#experiment-preview').textContent=selectedMethod.reference+' '+(selectedMethod.notes||[]).join(' ');
      return;
    }
    if(action==='preview')return previewDesign();
    if(action==='show'){
      workspace=getState()?.workspace_key;
      setSelected(id);offset=0;details=null;summary=null;
      closeDetail?.();
      if(navigate)return navigate('experiments');
      render();return loadSelected();
    }
    if(action==='open'){
      setSelected(id);offset=0;details=null;summary=null;render();return loadSelected();
    }
    if(action==='previous'||action==='next'){
      const page=resultPage();
      const next=action==='previous'?Math.max(0,offset-limit):page.next;
      if(next===null||next===undefined)return;
      offset=next;
      if(page.complete){renderDetails();return;}
      return loadSelected();
    }
    if(action==='task')return showTask(id);
    if(action==='run'||action==='report'){
      button.disabled=true;
      try{return await submitAction(action==='run'?'experiment.run':'experiment.summarize',{experiment_id:id});}
      finally{if(button.isConnected)button.disabled=false;}
    }
    throw Error('This experiment action is unavailable.');
  }
  return {mount,detach,dispatch,taskActions};
}
