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
const count = value => typeof value==='bigint' ? value.toLocaleString() :
  typeof value==='string' && /^\d+$/.test(value) ? BigInt(value).toLocaleString() : number(value);
const exactInteger = value => {
  if(typeof value==='bigint'&&value>=0n)return value;
  if(typeof value==='string'&&/^\d+$/.test(value))return BigInt(value);
  if(Number.isSafeInteger(value)&&value>=0)return BigInt(value);
  throw Error('The saved experiment must provide an exact nonnegative case count.');
};
function caseWindow(total,offset,limit) {
  total=exactInteger(total);offset=exactInteger(offset);const size=exactInteger(limit);
  if(size<1n)throw Error('Choose a positive result page size.');
  if(offset>=total)offset=total?((total-1n)/size)*size:0n;
  const end=offset+size<total?offset+size:total;
  return {total,offset,first:total?offset+1n:0n,last:end,
    previous:offset>size?offset-size:0n,next:end<total?end:null};
}
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


export function ensembleGroups(report) {
  if (report?.state !== 'complete') throw Error('Complete the experiment before building its ensemble maps.');
  const groups=new Map();
  for(const pair of report.pairs||[]) {
    if(!pair||['profile_id','baseline_run_id','alternative_run_id','scenario_id'].some(key=>typeof pair[key]!=='string'||!pair[key]))
      throw Error('A saved ensemble member is missing its original run selection.');
    let group=groups.get(pair.scenario_id);
    if(!group){group={scenario_id:pair.scenario_id,pairs:[],profiles:new Map()};groups.set(pair.scenario_id,group);}
    const selected=Object.fromEntries(['profile_id','baseline_run_id','alternative_run_id','scenario_id'].map(key=>[key,pair[key]]));
    const previous=group.profiles.get(pair.profile_id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(selected))throw Error('A parameter profile has conflicting saved ensemble pairs.');
    if(!previous){group.profiles.set(pair.profile_id,selected);group.pairs.push(selected);}
  }
  return [...groups.values()].map(({scenario_id,pairs})=>({scenario_id,pairs}));
}
export function ensembleQuantiles(text) {
  const values=String(text).split(/[\s,;]+/).filter(Boolean);
  if(!values.length)throw Error('Choose at least one member percentile.');
  const parsed=values.map(value=>{
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))throw Error('Enter percentiles as numbers from 0 to 100.');
    const number=Number(value);if(!Number.isFinite(number)||number<0||number>100)throw Error('Enter percentiles from 0 to 100.');
    return number/100;
  });
  return [...new Set(parsed)].sort((a,b)=>a-b);
}

export function attachExperiments(context) {
  const {getState,api,endpoint,openForm,submitAction,fileList,toast,openItem,showTask,navigate,closeDetail}=context;
  let root=null,workspace=null,selected=null,offset=0n,limit=100,jumpText=null;
  let summaryRevision=null,nativeByCase={},nativeRefresh=null;
  let details=null,summary=null,search='',metric='all',kind='all',axes={},methods=[],formModels=['ndr','sdr'];
  let generation=0,controller=null,previewGeneration=0,previewController=null,formGeneration=0;
  let formSourceRunIds=[];
  let ensembleReport=null,ensemblePreviewKey=null,ensemblePreviewGeneration=0,ensemblePreviewController=null;

  const data=()=>getState()?.data || {};
  const experiments=()=>data().experiments || [];
  const availableMetrics=()=>METRICS.filter(([name])=>!Array.isArray(details?.pollutants)||details.pollutants.includes(name));
  const name=(collection,id)=> {
    const row=(data()[collection]||[]).find(x=>x.id===id);
    return row?.title || row?.spec?.title || row?.metadata?.title || short(id);
  };
  const runModels=row=>Array.isArray(row?.selection?.models)?row.selection.models:['ndr','sdr'];
  const modelNames=models=>(models||['ndr','sdr']).map(value=>String(value).toUpperCase()).join(' + ');
  const runName=row=>name('scenarios',row.selection?.scenario_id)+' · '+
    name('profiles',row.selection?.profile_id)+' · '+modelNames(runModels(row))+' · '+human(row.state);
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
        source_run_ids:[...new Set(value.source_run_ids||[])].sort(),
        axes:(value.axes||[]).map(axis=>({path:axis.path,values:[...new Set(axis.values||[])],
          reference:String(axis.reference||'').trim()})).sort((x,y)=>x.path.localeCompare(y.path))};
    };
    return JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
  }
  function taskActions(task) {
    if(!task.action?.startsWith('experiment.'))return '';
    const id=task.experiment?.id||task.experiment_id||task.result?.id||task.payload?.experiment_id||
      experiments().find(record=>sameDesign(record.selection,task.payload?.selection))?.id;
    if(!id)return '';
    const retained=task.experiment||{},error=retained.report_error;
    const refresh=error||retained.study_report?.state==='stale';
    return (error?'<div class="notice error">'+esc(error)+'</div>':'')+
      '<div class="page-actions">'+btn('show','Open experiment',id)+
      (refresh?btn('report','Rebuild study report',id):'')+'</div>';
  }
  function axisEntries() {
    const entries=Array.isArray(axes)?axes.map(x=>typeof x==='string'?{path:x}:x):
      Object.entries(axes||{}).map(([path,spec])=>({path,...(typeof spec==='object'?spec:{})}));
    return entries.filter(entry=>formModels.includes(entry.path.split('.')[0]));
  }
  function adoptedRuns() {
    const target=document.querySelector('#experiment-source-runs');
    if(!target)return;
    if(target.dataset.loaded==='true') {
      formSourceRunIds=[...target.querySelectorAll('[name="experiment_source_run"]:checked')].map(node=>node.value);
    }
    const chosen=document.querySelector('[name="experiment_baseline"]')?.value;
    const baseline=(data().runs||[]).find(run=>run.id===chosen);
    const selected=new Set(formSourceRunIds);
    const models=JSON.stringify([...runModels(baseline)].sort());
    const eligible=(data().runs||[]).filter(run=>run.state==='complete'&&baseline&&
      run.selection?.grid_id===baseline.selection?.grid_id&&JSON.stringify([...runModels(run)].sort())===models);
    const eligibleIds=new Set(eligible.map(run=>run.id));
    const rows=new Map(eligible.map(run=>[run.id,run]));
    for(const id of selected)if(!rows.has(id))rows.set(id,(data().runs||[]).find(run=>run.id===id)||{id});
    target.innerHTML=rows.size?[...rows.values()].map(run=>{
      const compatible=eligibleIds.has(run.id);
      const label=run.selection?runName(run):'Retained original run '+short(run.id);
      const note=compatible?'Original native ID '+run.id:
        'Retained selection '+run.id+' — choose a matching baseline or remove this explicit source.';
      return '<label class="experiment-choice"><input type="checkbox" name="experiment_source_run" value="'+
        esc(run.id)+'"'+(selected.has(run.id)?' checked':'')+'><span><strong>'+esc(label)+
        '</strong><small>'+esc(note)+'</small></span></label>';
    }).join(''):'<p class="note">'+(baseline?
      'This catalogue has no completed runs on the selected grid and model scope.':
      'Choose the retained baseline to list completed runs on its grid and model scope.')+'</p>';
    target.dataset.loaded='true';
  }
  function syncBaselineModels() {
    const chosen=document.querySelector('[name="experiment_baseline"]')?.value;
    formModels=runModels((data().runs||[]).find(run=>run.id===chosen));
    adoptedRuns();
    const label=document.querySelector('#experiment-model-scope');
    if(label)label.textContent=chosen?'Native models: '+modelNames(formModels):'Choose the retained baseline to select native models.';
    for(const node of document.querySelectorAll('[name="experiment_axis_path"]')){
      const original=node.value,entries=axisEntries(),retained=entries.some(axis=>axis.path===original);
      node.innerHTML=(retained?'':option('','Choose a parameter for '+modelNames(formModels),true))+
        entries.map(entry=>option(entry.path,(entry.label||entry.title||human(entry.path))+' · '+
          entry.path+(entry.units?' ['+entry.units+']':''),entry.path===original)).join('');
    }
    invalidatePreview();
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
        const p=row.progress||{},exact=row.progress_exact||{},counts=row.counts_exact||row.counts||{};
        return '<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong><small class="mono">'+short(row.id)+'</small></td>'+
          '<td>'+status(row.state)+'</td><td class="number-cell">'+count(exact.complete??p.complete??0)+' / '+count(counts.cases||0)+
          ((p.failed||0)?'<small>'+count(exact.failed??p.failed)+' failed</small>':'')+'</td><td>'+esc(when(row.updated_at))+'</td>'+
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
    const planned=exactInteger(details?.total_cases_exact??details?.total_cases??0);
    const complete=details?.state==='complete'&&summary?.state==='complete'&&
      summary.id===details.id&&BigInt(summary.rows?.length??-1)===planned;
    const rows=complete?matching(summary.rows):(details?.cases||[]);
    const page=caseWindow(complete?rows.length:planned,offset,limit);
    offset=page.offset;
    return {...page,complete,rows:complete?rows.slice(Number(offset),Number(offset)+limit):rows};
  }
  function renderPagination(page) {
    const last=page.rows.length?offset+BigInt(page.rows.length):0n;
    return '<span>'+((search||kind!=='all')&&page.complete?'Matching cases ':'Cases ')+
      count(page.rows.length?page.first:0n)+'–'+count(last)+' of '+count(page.total)+'</span>'+
      btn('previous','Previous',selected,offset===0n?'disabled':'')+
      btn('next','Next',selected,page.next===null?'disabled':'')+
      '<label class="experiment-jump">Go to case<input type="text" inputmode="numeric" pattern="[0-9]*" '+
      'data-experiment-case aria-label="Case number" value="'+esc(jumpText??(page.total?page.first.toString():''))+'" '+
      (page.total?'':'disabled')+'></label>'+btn('jump','Go',selected,page.total?'':'disabled');
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
          row.lower&&!row.higher?'Lower or unchanged export':
          row.higher&&!row.lower?'Higher or unchanged export':
          !row.lower&&!row.higher?'Unchanged export':'Direction changes across profiles')+'</td></tr>'));
  }
  function renderDetails() {
    const target=root?.querySelector('#experiment-detail');
    if(!target||!details)return;
    const d=details,p=d.progress||{},exact=d.progress_exact||{},s=d.selection||{},page=resultPage(),cases=page.rows;
    const active=(getState()?.tasks||[]).find(t=>['queued','running'].includes(t.state)&&
      t.action.startsWith('experiment.')&&(t.payload?.experiment_id===d.id||
        sameDesign(t.payload?.selection,s)));
    target.innerHTML='<header class="section-header"><div><h2>'+esc(d.title)+'</h2><p>'+esc(s.reason||'')+'</p></div>'+
      '<div class="page-actions">'+status(d.state)+
      (active?btn('task','View running operation',active.id):
        d.state==='complete'?btn('report','Refresh report',d.id):btn('run',d.state==='prepared'?'Run experiment':'Resume experiment',d.id,'class="primary"'))+
      btn('clone','Revise design',d.id)+
      (Array.isArray(data().paired_ensemble_products)&&summary?.id===d.id&&summary.state==='complete'&&summary.pairs?.length?
        btn('ensemble','Build ensemble maps',d.id):'')+'</div></header>'+
      '<div class="section-body"><div class="experiment-counts">'+
      [['Completed',exact.complete??p.complete??0],['Pending',exact.pending??p.pending??0],['Failed',exact.failed??p.failed??0],['Planned cases',d.counts_exact?.cases??d.counts?.cases??0]].map(([label,value])=>
        '<div><span>'+label+'</span><strong>'+count(value)+'</strong></div>').join('')+'</div>'+
      '<p class="note">Each land-cover case uses a baseline with the same parameter profile. Signed change is alternative minus baseline; '
      +'positive reduction means less exported mass. Reference and parameter cases remain separate.</p>'+
      (p.active_case_id?'<p role="status">Current native case: <code>'+esc(short(p.active_case_id))+'</code></p>':'')+
      '<details><summary>Saved inputs and design</summary><dl class="definition"><dt>Baseline run</dt><dd>'+esc(short(s.baseline_run_id))+
      ' <button type="button" data-action="item" data-kind="runs" data-id="'+esc(s.baseline_run_id)+'">Open run</button></dd>'+
      '<dt>Native models</dt><dd>'+esc(modelNames(d.models))+'</dd><dt>Design</dt><dd>'+esc(human(s.design))+'</dd><dt>Alternatives</dt><dd>'+
      (s.scenario_ids||[]).map(id=>esc(name('scenarios',id))).join(', ')+
      '</dd><dt>Additional profiles</dt><dd>'+(s.profile_ids||[]).map(id=>esc(name('profiles',id))).join(', ')+
      '</dd><dt>Adopted original runs</dt><dd>'+(s.source_run_ids?.length?
        s.source_run_ids.map(id=>'<button type="button" data-action="item" data-kind="runs" data-id="'+esc(id)+'">'+esc(short(id))+'</button>').join(' '):
        'Canonical native selections')+'</dd></dl>'+table(['Parameter','Selected values','Reference'],(s.axes||[]).map(a=>'<tr><td>'+esc(a.path)+'</td><td>'+
        a.values.map(parameterValue).join(', ')+'</td><td>'+esc(a.reference)+'</td></tr>'))+'</details>'+
      '<div class="experiment-filters"><label>'+(page.complete?'Search all cases':'Search this page')+'<input data-experiment-filter="search" value="'+esc(search)+
      '" placeholder="Name or retained run ID"></label><label>Case kind<select data-experiment-filter="kind">'+
      [['all','All cases'],['landcover','Land-cover alternatives'],['parameter','Parameter response'],['reference','Reference baseline']].map(([v,l])=>option(v,l,kind===v)).join('')+
      '</select></label><label>Pollutant<select data-experiment-filter="metric">'+option('all','All pollutants',metric==='all')+
      availableMetrics().map(([v,l])=>option(v,l,metric===v)).join('')+'</select></label></div>'+
      '<div id="experiment-result-tables">'+renderResultTables(cases)+'</div>'+
      '<div id="experiment-pagination" class="experiment-pagination">'+renderPagination(page)+'</div>'+
      '<h3>Reports and retained files</h3>'+fileList([...(d._downloads||[]),...(summary?._downloads||[])].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i))+
      ((!summary&&d.state!=='running')?'<p>'+btn('report','Build report from available cases',d.id)+'</p>':'')+
      '<p class="note">Use Back up workspace to transfer the experiment, original inputs and native models together.</p></div>';
  }
  function stageDuration(start,end) {
    const seconds=(Date.parse(end)-Date.parse(start))/1000;
    if(!Number.isFinite(seconds)||seconds<0)return '';
    if(seconds<60)return number(Math.round(seconds*10)/10)+' s';
    if(seconds<3600)return Math.floor(seconds/60)+' min '+Math.floor(seconds%60)+' s';
    return Math.floor(seconds/3600)+' h '+Math.floor(seconds%3600/60)+' min';
  }
  function nativeExecution(row) {
    const adopted=(row.native_source?'<small>Adopted original run</small>':'')+
      (row.native_baseline_source?'<small>Adopted original paired baseline</small>':'');
    const execution=nativeByCase[row.id];
    if(!execution)return adopted+'<small>Opening native stages…</small>';
    if(!execution.stages?.length)return adopted+esc(execution.state==='unprepared'?'Awaiting preparation':
      execution.state==='running'?'Native run running':human(execution.state));
    return adopted+execution.stages.map(stage=>{
      const label={executed:'Executed',reused:'Reused',recovered:'Recovered',complete:'Complete'}[stage.mode]||'Complete';
      const duration=stageDuration(stage.started_at,stage.completed_at);
      const original=stage.origin,originDuration=original&&stageDuration(original.started_at,original.completed_at);
      const source=stage.source_run_id;
      return '<div class="experiment-native-stage"><strong>'+esc(String(stage.model).toUpperCase())+' · '+label+
        (duration?' · '+esc(duration):'')+'</strong>'+
        ((stage.mode==='reused'||stage.mode==='recovered')&&originDuration?'<small>Original execution '+esc(originDuration)+'</small>':'')+
        (source&&source!==row.run_id?'<button type="button" data-action="item" data-kind="runs" data-id="'+
          esc(source)+'">Open source run</button>':'')+'</div>';
    }).join('');
  }
  function renderResultTables(cases) {
    return renderMetrics(cases)+renderEnvelopes()+'<h3>Native cases and continuation</h3>'+
      table(['Scenario','Profile','State','Native execution','Run','Detail'],matching(cases).map(row=>
        '<tr><td>'+esc(row.scenario_title||short(row.scenario_id))+'</td><td>'+esc(row.profile_title||short(row.profile_id))+
        '</td><td>'+status(row.state)+'</td><td>'+nativeExecution(row)+'</td><td class="actions-cell">'+(row.run_id?
          '<button type="button" data-action="item" data-kind="runs" data-id="'+esc(row.run_id)+'">Open run</button>'+
          '<button type="button" data-action="spatial-item" data-kind="runs" data-id="'+esc(row.run_id)+'">Map</button>':
          'Awaiting preparation')+'</td><td>'+esc(errorText(row.error))+'</td></tr>'));
  }
  async function loadSelected() {
    if(!root||!selected)return;
    const current=++generation,forWorkspace=workspace,id=selected;
    controller?.abort();controller=new AbortController();
    try {
      const pageIds=summary?.id===id&&summary.state==='complete'?resultPage().rows.map(row=>row.id):[];
      const params={experiment_id:id,offset:offset.toString(),limit};
      if(pageIds.length)params.case_ids=pageIds.join(',');
      const record=await api(endpoint('/api/experiments/inspect',params),{signal:controller.signal});
      if(current!==generation||forWorkspace!==workspace||id!==selected||!root)return;
      details=record;if(metric!=='all'&&!availableMetrics().some(([name])=>name===metric))metric='all';
      Object.assign(nativeByCase,record.native_execution_by_case||{});renderDetails();
      const revision=record.files?.json?.sha256||record.summary_at||null;
      if((revision||['complete','partial','failed'].includes(record.state))&&
          (!summary||summary.id!==id||summaryRevision!==revision)) {
        try {
          const report=await api(endpoint('/api/experiments/summary',{experiment_id:id}),{signal:controller.signal});
          if(current!==generation||forWorkspace!==workspace||id!==selected||!root)return;
          summary=report;summaryRevision=revision;renderDetails();
        }catch(error){if(error.name!=='AbortError'&&error.status!==404)throw error;}
      }
      const missing=resultPage().rows.filter(row=>!nativeByCase[row.id]).map(row=>row.id);
      if(missing.length){
        const stages=await api(endpoint('/api/experiments/inspect',{
          experiment_id:id,offset:offset.toString(),limit,case_ids:missing.join(',')
        }),{signal:controller.signal});
        if(current!==generation||forWorkspace!==workspace||id!==selected||!root)return;
        Object.assign(nativeByCase,stages.native_execution_by_case||{});renderDetails();
      }
    }catch(error) {
      if(error.name==='AbortError'||current!==generation||forWorkspace!==workspace||!root)return;
      const target=root.querySelector('#experiment-detail');
      if(target)target.innerHTML='<div class="section-body"><p class="notice error" role="alert">'+esc(error.message)+
        '</p>'+btn('open','Retry opening experiment',id)+'</div>';
    }
  }
  function onFilter(event) {
    if(event.target.dataset.experimentCase!==undefined){jumpText=event.target.value;return;}
    const field=event.target.dataset.experimentFilter;if(!field)return;
    if(field==='search')search=event.target.value;
    if(field==='kind')kind=event.target.value;
    if(field==='metric')metric=event.target.value;
    if(!details)return;
    if(resultPage().complete)offset=0n;jumpText=null;
    const page=resultPage(),results=root?.querySelector('#experiment-result-tables');
    if(results)results.innerHTML=renderResultTables(page.rows);
    const pagination=root?.querySelector('#experiment-pagination');
    if(pagination)pagination.innerHTML=renderPagination(page);
    if(page.complete&&page.rows.some(row=>!nativeByCase[row.id])){
      clearTimeout(nativeRefresh);nativeRefresh=setTimeout(()=>loadSelected(),180);
    }
  }
  function onCaseKey(event) {
    if(event.key==='Enter'&&event.target.dataset.experimentCase!==undefined){
      event.preventDefault();root?.querySelector('[data-action="experiment-jump"]')?.click();
    }
  }
  function detach() {
    formGeneration++;previewGeneration++;previewController?.abort();
    clearTimeout(nativeRefresh);nativeRefresh=null;
    generation++;controller?.abort();controller=null;
    if(root){root.removeEventListener('input',onFilter);root.removeEventListener('change',onFilter);root.removeEventListener('keydown',onCaseKey);}
    root=null;
  }
  function mount(container,currentState) {
    if(workspace!==currentState.workspace_key) {
      formGeneration++;previewGeneration++;previewController?.abort();
      workspace=currentState.workspace_key;details=null;summary=null;summaryRevision=null;nativeByCase={};offset=0n;jumpText=null;search='';metric='all';kind='all';
      try{selected=sessionStorage.getItem(selectionKey());}catch{selected=null;}
    }
    if(root!==container) {
      if(root){root.removeEventListener('input',onFilter);root.removeEventListener('change',onFilter);root.removeEventListener('keydown',onCaseKey);}
      root=container;root.addEventListener('input',onFilter);root.addEventListener('change',onFilter);root.addEventListener('keydown',onCaseKey);
    }
    if(selected&&!experiments().some(row=>row.id===selected)){setSelected(null);details=null;summary=null;summaryRevision=null;nativeByCase={};}
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
    if(selectedAxes.some(x=>!x.path||!formModels.includes(x.path.split('.')[0])))throw Error('Choose parameter rows for '+modelNames(formModels)+' or remove unused rows.');
    if(selectedAxes.some(x=>!x.reference))throw Error('Each parameter choice needs its published reference or study rationale.');
    if(new Set(selectedAxes.map(x=>x.path)).size!==selectedAxes.length)throw Error('Combine values for the same parameter in one row.');
    const sourceRunIds=[...new Set(values('experiment_source_run'))].sort();
    if(sourceRunIds.some(id=>!/^[0-9a-f]{64}$/.test(id)))throw Error('Retain the complete original native run IDs.');
    return {schema:'upstate.experiment-selection/v1',title,reason,baseline_run_id:baseline,
      scenario_ids:values('experiment_scenario'),profile_ids:values('experiment_profile'),
      ...(sourceRunIds.length?{source_run_ids:sourceRunIds}:{}),
      design:field('experiment_design').value,axes:selectedAxes};
  }
  async function newForm(id, options={}) {
    const forWorkspace=getState()?.workspace_key;
    const initialExecution=options.defaultExecution==='save'?'save':'run';
    const formRequest=++formGeneration;
    const currentForm=()=>formRequest===formGeneration&&getState()?.workspace_key===forWorkspace;
    previewGeneration++;previewController?.abort();
    const [schema,methodSource]=await Promise.all([
      api(endpoint('/api/experiments/axes')),api(endpoint('/api/experiments/methods'))]);
    if(!currentForm())return;
    axes=schema.axes||{};methods=methodSource.methods||[];
    let selection={};
    if(id) {
      const record=await api(endpoint('/api/experiments/inspect',{experiment_id:id,limit:1}));
      if(!currentForm())return;
      selection={...record.selection,title:record.title+' — revised'};
    }
    formSourceRunIds=[...new Set(selection.source_run_ids||[])];
    const baselineScenarios=new Set((data().scenarios||[]).filter(s=>s.kind==='baseline').map(s=>s.id));
    const baselineRuns=(data().runs||[]).filter(r=>baselineScenarios.has(r.selection?.scenario_id));
    if(!baselineRuns.length)throw Error('Prepare a native run using the retained baseline scenario, grid and parameter profile first.');
    formModels=runModels(baselineRuns.find(run=>run.id===selection.baseline_run_id));
    const alternatives=(data().scenarios||[]).filter(s=>s.kind!=='baseline');
    const profiles=data().profiles||[];
    const checkbox=(name,row,checked)=>'<label class="experiment-choice"><input type="checkbox" name="'+name+
      '" value="'+esc(row.id)+'"'+(checked?' checked':'')+'><span><strong>'+esc(row.title||short(row.id))+
      '</strong><small>'+esc(row.reason||short(row.id))+'</small></span></label>';
    const html='<div class="experiment-form"><div class="experiment-form-grid">'+
      '<label>Experiment title<input name="experiment_title" required value="'+esc(selection.title||'')+'" autocomplete="off"></label>'+
      '<label>Baseline native run<select name="experiment_baseline" required>'+option('','Choose retained baseline')+
      baselineRuns.map(row=>option(row.id,runName(row),row.id===selection.baseline_run_id)).join('')+'</select><small id="experiment-model-scope">'+
      esc(selection.baseline_run_id?'Native models: '+modelNames(formModels):'Choose the retained baseline to select native models.')+'</small></label>'+
      '<label class="full">Purpose and interpretation<textarea name="experiment_reason" required rows="3">'+esc(selection.reason||'')+'</textarea></label></div>'+
      '<fieldset><legend>Land-cover alternatives</legend><p>Every selected alternative is paired with a baseline using the same parameter profile.</p>'+
      (alternatives.length?'<div class="experiment-choices">'+alternatives.map(row=>checkbox('experiment_scenario',row,
        (selection.scenario_ids||[]).includes(row.id))).join('')+'</div>':
        '<p class="note">Save land-cover alternatives in the Scenarios view to include them here. Parameter comparisons can use the baseline landscape.</p>')+'</fieldset>'+
      '<fieldset><legend>Additional retained parameter profiles</legend><p>The selected baseline profile is included automatically. '
      +'These additional profiles keep their own original tables, references and assumptions.</p><div class="experiment-choices">'+
      profiles.map(row=>checkbox('experiment_profile',row,(selection.profile_ids||[]).includes(row.id))).join('')+'</div></fieldset>'+
      '<fieldset><legend>Adopt completed original runs</legend><p>Select the completed native sources to use for matching cells. '+
      'The original engine checks the grid, profile, scenario, model scope and producing-stage versions. The selected baseline is considered automatically. '+
      'New cells keep the current canonical run selection.</p><div id="experiment-source-runs" class="experiment-choices" data-loaded="false"></div></fieldset>'+
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
      option('run','Save and run native models',initialExecution==='run')+option('save','Save design for later execution',initialExecution==='save')+'</select></label>'+
      '<p class="note">Native runs use the original workspace operation queue. Already completed cases are reused.</p></div>'+
      '<div class="experiment-preview"><div class="page-actions">'+btn('preview','Preview selected cases')+'</div>'+
      '<div id="experiment-preview" role="status" aria-live="polite">Preview the design to inspect its profile and run counts.</div></div></div>';
    openForm(id?'Revise experiment design':'New scenario experiment',
      'Select the actual retained study inputs. Saved designs and completed native cases remain available after reopening.',
      html,initialExecution==='save'?'Save design':'Save and run',async()=> {
        if(!currentForm())throw Error('Reopen this design in its original workspace before submitting.');
        const chosen=readForm(),mode=document.querySelector('[name="experiment_execution"]').value;
        const task=await submitAction(mode==='save'?'experiment.save':'experiment.run',{selection:chosen});
        if(typeof options.onSubmitted==='function')await options.onSubmitted(task);
      },()=> {
        adoptedRuns();
        const mode=document.querySelector('[name="experiment_execution"]');
        mode.addEventListener('change',()=>{document.querySelector('#form-submit').textContent=mode.value==='save'?'Save design':'Save and run';});
        document.querySelector('[name="experiment_baseline"]').addEventListener('change',syncBaselineModels);
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
  function readEnsembleForm() {
    if(!ensembleReport)throw Error('Open a completed experiment to select its ensemble members.');
    const form=document.querySelector('#operation-form');
    const field=name=>form.elements.namedItem(name);
    const title=field('ensemble_title').value.trim(),purpose=field('ensemble_purpose').value.trim();
    if(!title||!purpose)throw Error('Give the ensemble products a title and interpretation.');
    const chosen=new Set([...form.querySelectorAll('[name="ensemble_scenario"]:checked')].map(node=>node.value));
    const pollutants=[...form.querySelectorAll('[name="ensemble_pollutant"]:checked')].map(node=>node.value);
    if(!chosen.size)throw Error('Choose at least one land-cover alternative.');
    if(!pollutants.length)throw Error('Choose at least one available pollutant.');
    const available=new Set(ensembleReport.pollutants||METRICS.map(([key])=>key));
    if(pollutants.some(key=>!available.has(key)))throw Error('Choose the native outputs selected by this experiment.');
    const quantiles=ensembleQuantiles(field('ensemble_quantiles').value);
    return ensembleGroups(ensembleReport).filter(group=>chosen.has(group.scenario_id)).map(group=>({
      title:title+' — '+name('scenarios',group.scenario_id),purpose,
      pairs:group.pairs,pollutants,quantiles,support:'all_pairs',planned_member_count:group.pairs.length,
    }));
  }
  function invalidateEnsemblePreview() {
    ensemblePreviewKey=null;ensemblePreviewGeneration++;ensemblePreviewController?.abort();
    const target=document.querySelector('#experiment-ensemble-preview');
    if(target)target.textContent='Preview the selected members and their retained native inputs.';
  }
  async function previewEnsembles(selections=readEnsembleForm()) {
    const forWorkspace=getState()?.workspace_key,current=++ensemblePreviewGeneration;
    ensemblePreviewController?.abort();ensemblePreviewController=new AbortController();
    const results=[],target=document.querySelector('#experiment-ensemble-preview');
    try {
    for(let index=0;index<selections.length;index++) {
      if(target)target.textContent='Opening native inputs for alternative '+(index+1)+' of '+selections.length+'…';
      const result=await api('/api/paired-ensemble/preview',{method:'POST',
        body:{workspace:forWorkspace,selection:selections[index]},signal:ensemblePreviewController.signal});
      if(current!==ensemblePreviewGeneration||getState()?.workspace_key!==forWorkspace)return null;
      results.push(result);
    }
    ensemblePreviewKey=JSON.stringify(selections);
    if(target&&target===document.querySelector('#experiment-ensemble-preview'))target.innerHTML=
      table(['Alternative','Parameter members','Native outputs','Common support'],results.map((result,index)=>
        '<tr><td>'+esc(name('scenarios',selections[index].pairs[0].scenario_id))+'</td><td>'+count(result.members)+
        '</td><td>'+esc((result.pollutants||[]).map(key=>METRICS.find(([name])=>name===key)?.[1]||key).join(', '))+
        '</td><td>Cells valid in every paired member</td></tr>'))+
      '<p>'+count(results.length)+' ensemble products use the original native runs and reporting masks.</p>';
    return results;
    } catch(error) {
      if(error.name==='AbortError')return null;
      if(target&&target===document.querySelector('#experiment-ensemble-preview'))target.textContent=error.message||String(error);
      throw error;
    }
  }
  async function newEnsembleForm(id) {
    formGeneration++;
    const forWorkspace=getState()?.workspace_key;
    if(!Array.isArray(data().paired_ensemble_products))throw Error('The paired ensemble view is unavailable in this workspace.');
    const report=summary?.id===id&&summary.state==='complete'?summary:
      await api(endpoint('/api/experiments/summary',{experiment_id:id}));
    if(getState()?.workspace_key!==forWorkspace)return;
    const groups=ensembleGroups(report);
    if(!groups.length)throw Error('This experiment has no completed land-cover alternatives.');
    ensembleReport=report;ensemblePreviewKey=null;ensemblePreviewGeneration++;
    const available=new Set(report.pollutants||METRICS.map(([key])=>key));
    const html='<div class="experiment-form" id="experiment-ensemble-form"><div class="experiment-form-grid">'+
      '<label>Product title prefix<input name="ensemble_title" required value="'+esc(report.title||details?.title||'Scenario ensemble')+'"></label>'+
      '<label>Member percentiles<input name="ensemble_quantiles" value="10, 50, 90" required><small>Percentiles across the selected parameter members.</small></label>'+
      '<label class="full">Purpose and interpretation<textarea name="ensemble_purpose" rows="3" required>'+
        esc(report.selection?.reason||details?.selection?.reason||'Compare the selected parameter members for each retained land-cover alternative.')+
      '</textarea></label></div><fieldset><legend>Land-cover alternatives</legend>'+
      '<p>Each alternative becomes a separate ensemble product with its same-profile baseline pairs.</p><div class="experiment-choices">'+
      groups.map(group=>'<label class="experiment-choice"><input type="checkbox" name="ensemble_scenario" checked value="'+
        esc(group.scenario_id)+'"><span><strong>'+esc(name('scenarios',group.scenario_id))+'</strong><small>'+
        count(group.pairs.length)+' retained parameter members</small></span></label>').join('')+'</div></fieldset>'+
      '<fieldset><legend>Native quantities</legend><div class="experiment-choices">'+METRICS.filter(([key])=>available.has(key)).map(([key,label])=>
        '<label class="experiment-choice"><input type="checkbox" name="ensemble_pollutant" checked value="'+esc(key)+'"><span>'+
        esc(label)+'</span></label>').join('')+'</div></fieldset>'+
      '<p class="note">Each product summarizes per-cell response across the selected parameters on their shared valid area. '
      +'Positive reduction means baseline export exceeds the alternative. The maps retain member counts, coverage and the original run references.</p>'+
      '<div class="experiment-preview"><div class="page-actions">'+btn('ensemble-preview','Preview ensemble inputs')+'</div>'+
      '<div id="experiment-ensemble-preview" role="status" aria-live="polite">Preview the selected members and their retained native inputs.</div></div></div>';
    openForm('Build ensemble maps','Use the completed native experiment to compare spatial responses across parameter choices.',
      html,'Build selected ensembles',async()=>{
        const selections=readEnsembleForm();
        if(ensemblePreviewKey!==JSON.stringify(selections)){
          const ready=await previewEnsembles(selections);if(!ready)return;
        }
        for(const selection of selections){
          if(getState()?.workspace_key!==forWorkspace)throw Error('Reopen this selection in its original workspace.');
          await submitAction('paired_ensemble.build',selection);
        }
        toast(selections.length+' ensemble product'+(selections.length===1?'':'s')+' queued.');
      },()=>document.querySelector('#experiment-ensemble-form').addEventListener('input',invalidateEnsemblePreview));
  }
  async function dispatch(button) {
    const action=button.dataset.action.slice('experiment-'.length),id=button.dataset.id;
    if(action==='new')return newForm();
    if(action==='ensemble')return newEnsembleForm(id);
    if(action==='ensemble-preview')return previewEnsembles();
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
      const selectedAxes=selectedMethod.axes.filter(axis=>formModels.includes(axis.path.split('.')[0]));
      if(!selectedAxes.length||selectedAxes.some(axis=>!supported.has(axis.path)))throw Error('This method has no supported parameter choices for the selected native models.');
      document.querySelector('#experiment-axis-rows').innerHTML=selectedAxes.map(axisRow).join('');
      document.querySelector('[name="experiment_design"]').value=selectedMethod.design||'factorial';
      previewGeneration++;previewController?.abort();
      document.querySelector('#experiment-preview').textContent=modelNames(formModels)+' reference values. '+selectedMethod.reference+' '+(selectedMethod.notes||[]).join(' ');
      return;
    }
    if(action==='preview')return previewDesign();
    if(action==='show'){
      workspace=getState()?.workspace_key;
      setSelected(id);offset=0n;jumpText=null;details=null;summary=null;summaryRevision=null;nativeByCase={};
      closeDetail?.();
      if(navigate)return navigate('experiments');
      render();return loadSelected();
    }
    if(action==='open'){
      setSelected(id);offset=0n;jumpText=null;details=null;summary=null;summaryRevision=null;nativeByCase={};render();return loadSelected();
    }
    if(action==='previous'||action==='next'){
      const page=resultPage();
      const next=action==='previous'?page.previous:page.next;
      if(next===null||next===undefined)return;
      offset=next;jumpText=null;
      if(page.complete)renderDetails();
      return loadSelected();
    }
    if(action==='jump'){
      const page=resultPage(),raw=String(root?.querySelector('[data-experiment-case]')?.value??'').trim();
      if(!/^\d+$/.test(raw))throw Error('Enter the case number using digits.');
      const target=BigInt(raw);
      if(target<1n||target>page.total)throw Error('Choose a case from 1 to '+count(page.total)+'.');
      offset=target-1n;jumpText=null;
      if(page.complete)renderDetails();
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
  async function openForInvestigation(options={}) {
    const owner=getState()?.workspace_key;
    if(!owner || (options.workspace_key&&options.workspace_key!==owner))
      throw Error('Open the original programme designer in its selected workspace.');
    if(typeof options.onSubmitted!=='function')
      throw Error('The originating investigation needs its native task callback.');
    return newForm(undefined,{defaultExecution:'save',onSubmitted:options.onSubmitted});
  }

  return {mount,detach,dispatch,taskActions,openForInvestigation};
}
