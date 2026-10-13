/** Portfolio decisions on the existing Conservation study, queue and plan store. */
const VIEW = 'conservation-optimization';
const PREFIX = 'portfolio-optimization-';
const ACTION = 'conservation.optimization.';
const h = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human = value => String(value ?? '').replace(/[_-]+/g,' ');
const number = value => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(value) : 'Unavailable';
const pretty = value => JSON.stringify(value, null, 2);
const array = value => Array.isArray(value) ? value : [];
const attr = (name,value) => ' data-'+name+'="'+h(value)+'"';
const button = (action,label,data='',disabled=false) =>
  '<button type="button" data-action="'+PREFIX+action+'"'+data+(disabled?' disabled':'')+'>'+h(label)+'</button>';
const section = (title,body) => '<section class="po-section"><h2>'+h(title)+'</h2>'+body+'</section>';
const json = (label,value) => '<details><summary>'+h(label)+'</summary><pre>'+h(pretty(value))+'</pre></details>';
const table = (heads,rows) => '<div class="po-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const field = (name,label,control) => '<label class="po-field" for="po-'+name+'"><span>'+h(label)+'</span>'+control+'</label>';
const input = (name,label,value='',extra='') => field(name,label,
  '<input id="po-'+name+'" name="'+name+'" value="'+h(value??'')+'" '+extra+'>');
const select = (name,label,options,value) => field(name,label,
  '<select id="po-'+name+'" name="'+name+'">'+options.map(([id,title])=>'<option value="'+h(id)+'"'+(String(id)===String(value)?' selected':'')+'>'+h(title)+'</option>').join('')+'</select>');
const textarea = (name,label,value='',extra='') => field(name,label,
  '<textarea id="po-'+name+'" name="'+name+'" '+extra+'>'+h(value)+'</textarea>');
function taskRows(state) {
  const value=state?.tasks;
  return Array.isArray(value)?value:Array.isArray(value?.tasks)?value.tasks:
    Array.isArray(value?.items)?value.items:value&&typeof value==='object'?Object.values(value).filter(x=>x?.action):[];
}
function taskState(task) {return task?.state||task?.status||'unknown';}
function completed(task) {return ['complete','completed','succeeded','success'].includes(taskState(task));}
function taskStamp(state) {
  return JSON.stringify(taskRows(state).filter(x=>x.action?.startsWith(ACTION))
    .map(x=>[x.id,taskState(x),x.updated_at,x.progress,x.error]));
}
function selectionFromRequest(request) {
  return Object.fromEntries(['study_id','title','purpose','objective','weights','filters','include_ineligible',
    'constraints','solver','solver_time_limit_seconds','stability'].filter(key=>request?.[key]!==undefined)
    .map(key=>[key,JSON.parse(JSON.stringify(request[key]))]));
}
function axesFor(study,kind,alternative) {
  const bindings=study?.selection?.bindings||{}, spec=study?.selection?.spec||study?.spec||{};
  if(kind==='published-method')return spec.score?.basis==='published_method'&&bindings.published_method?['published_points']:[];
  if(kind==='source-context')return ['reporting_area_ha',...[
    ['source_water_area_ha','drinking_water'],['unprotected_area_ha','protected_lands'],
    ['high_quality_context','high_quality_waters']].filter(([,source])=>bindings.sources?.[source]).map(([axis])=>axis)];
  const runs=bindings.runs||{}, original=runs[spec.baseline_run_id]?.outputs||{};
  const keys=Array.isArray(original)?original:Object.keys(original);
  const other=runs[alternative]?.outputs||{}, shared=Array.isArray(other)?other:Object.keys(other);
  return ['nitrogen_export','phosphorus_export','sediment_export']
    .filter(axis=>keys.includes(axis)&&(kind==='current-export'||shared.includes(axis)));
}
function optionalNumber(value,label,{integer=false,min=0,max=Infinity}={}) {
  if(value===''||value==null)return undefined;
  const result=Number(value);
  if(!Number.isFinite(result)||result<min||result>max||(integer&&!Number.isSafeInteger(result)))
    throw Error(label+' must be '+(integer?'a whole number':'a finite number')+' between '+min+' and '+(max===Infinity?'the supported maximum':max)+'.');
  return result;
}
function idList(value,label) {
  if(!value.trim())return [];
  let result;try{result=JSON.parse(value);}catch(_){throw Error(label+' must be a JSON list of original string IDs.');}
  if(!Array.isArray(result)||result.some(x=>typeof x!=='string'||!x))throw Error(label+' must contain original string IDs.');
  return [...new Set(result)];
}
export function attachConservationOptimization(host, options = {}) {
  const view=options.view || VIEW;
  let node=null, workspace=null, catalog=null, catalogPromise=null, loading=false, issue='', active=null;
  let generation=0, actionGeneration=0, stamp='', catalogTasks='', query='', show='all', page=0;
  const completedTasks=()=>JSON.stringify(taskRows(host.getState()).filter(task=>task.action?.startsWith(ACTION)&&completed(task))
    .map(task=>[task.id,taskState(task),task.ended_at]));
  const key=()=>host.getState()?.workspace_key??null;
  function resetWorkspace() {
    if(workspace===key())return;
    workspace=key();generation++;actionGeneration++;catalog=null;catalogPromise=null;
    loading=false;issue='';active=null;query='';show='all';page=0;stamp='';catalogTasks='';
  }
  async function read(path,params={}) {
    const selected=key(), epoch=generation;
    const result=await host.api(host.endpoint(path,params));
    if(selected!==key()||epoch!==generation)return null;
    return result;
  }
  function controls() {
    return '<div class="po-actions">'+button('refresh','Refresh saved work')+
      '<button type="button" data-view="conservation">Conservation studies</button></div>';
  }
  function tasksHTML() {
    const tasks=taskRows(host.getState()).filter(x=>x.action?.startsWith(ACTION));
    if(!tasks.length)return '<p>No optimization tasks in the current queue.</p>';
    return table(['Operation','Status','Progress',''],tasks.map(task=>'<tr><td>'+h(human(task.action.slice(ACTION.length)))+
      '<small>'+h(task.id)+'</small></td><td>'+h(human(taskState(task)))+'</td><td>'+
      h(typeof task.progress==='string'?task.progress:task.progress?pretty(task.progress):'')+
      (task.error?'<small>'+h(typeof task.error==='string'?task.error:task.error.message||pretty(task.error))+'</small>':'')+
      '</td><td>'+button('task','Open task',attr('id',task.id))+
      (completed(task)?button('result','Open result',attr('id',task.id)):'')+'</td></tr>'));
  }
  function dashboardHTML() {
    if(!catalog)return loading?'<p role="status">Loading saved conservation work…</p>':'<p>Refresh to load studies and retained decisions.</p>';
    const studies=array(catalog.studies), plans=array(catalog.plans), analyses=array(catalog.analyses);
    return section('Choose a completed study',studies.length?table(['Study','Source / state',''],studies.map(study=>
      '<tr><td><strong>'+h(study.title||study.id)+'</strong><small>'+h(study.planning_unit_label||study.unit_type||'')+'</small></td><td>'+
      h(human(study.mode))+'<small>'+h(human(study.state))+'</small></td><td>'+
      button('new','Set objectives and resources',attr('study',study.id),study.state!=='complete')+
      '<button type="button" data-action="conservation-open-study" data-study-id="'+h(study.id)+'">Open study</button></td></tr>')):
      '<p>Create a Conservation study from the retained original sources to begin.</p>')+
      section('Saved land plans',plans.length?table(['Plan','Study',''],plans.map(plan=>'<tr><td><strong>'+h(plan.title||plan.id)+'</strong><small>'+h(plan.created_at||'')+'</small></td><td>'+
        h(studies.find(s=>s.id===plan.study_id)?.title||plan.study_id)+'</td><td>'+button('plan','Open saved plan',attr('id',plan.id))+'</td></tr>')):'<p>No saved land plans.</p>')+
      section('Retained decision analyses',analyses.length?table(['Analysis','Study',''],analyses.map(row=>
        '<tr><td><span class="po-id">'+h(row.id)+'</span><small>'+h(row.created_at||'')+'</small></td><td>'+h(row.study_title||row.study_id)+
        '</td><td>'+button('analysis','Reopen analysis',attr('id',row.id)+attr('study',row.study_id))+'</td></tr>')):'<p>Saving an optimization retains its complete decision analysis here.</p>')+
      (array(catalog.issues).length?section('Saved-reference notices',array(catalog.issues).map(row=>'<p>'+h(row.study_id)+' / '+h(row.analysis_id)+': '+h(row.message)+'</p>').join('')):'');
  }
  function metric(label,value,unit='') {return '<div><dt>'+h(label)+'</dt><dd>'+h(number(value))+(unit?' '+h(unit):'')+'</dd></div>';}
  function candidatesHTML(analysis) {
    const candidates=array(analysis.candidates), search=query.toLocaleLowerCase();
    const filtered=candidates.filter(row=>(show==='all'||(show==='selected'?row.selected:!row.eligible))&&
      (!search||[row.feature_id,row.label,...array(row.exclusions)].some(value=>String(value??'').toLocaleLowerCase().includes(search))));
    const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages-1);
    const axes=array(analysis.request?.axes);
    const rows=filtered.slice(page*50,(page+1)*50).map(row=>'<tr><td><strong>'+h(row.label||row.feature_id)+'</strong><small>'+h(row.feature_id)+'</small></td><td>'+
      h(row.selected?'Selected':row.eligible?'Eligible':'Excluded')+'</td><td>'+h(number(row.score))+'</td><td>'+
      axes.map(axis=>'<small>'+h(human(axis))+': '+h(number(row.objective_values?.[axis]))+' '+h(row.objective_units?.[axis]||'')+'</small>').join('')+
      '</td><td>'+h(number(row.reporting_area_ha))+'</td><td>'+h(number(row.supplied_cost))+' '+h(row.currency||'')+'</td><td>'+
      h(array(row.exclusions).join('; '))+'</td><td>'+button('candidate','Inspect support',attr('id',row.feature_id))+'</td></tr>');
    return '<div class="po-filter">'+input('candidate-search','Search IDs, labels and exclusion reasons',query,'type="search"')+
      select('candidate-show','Candidate view',[['all','All candidates'],['selected','Selected'],['excluded','Excluded']],show)+'</div>'+
      '<p>'+filtered.length+' of '+candidates.length+' retained candidates. Page '+(page+1)+' of '+pages+'.</p>'+
      table(['Original unit','Selection','Score','Independent objectives','Reporting ha','Supplied cost','Exclusion reasons',''],rows)+
      '<div class="po-actions">'+button('previous','Previous page','',page===0)+button('next','Next page','',page+1>=pages)+'</div>';
  }
  function analysisHTML(analysis) {
    const request=analysis.request||{}, selection=analysis.selection||{}, geometry=selection.geometry||{}, counts=analysis.counts||{};
    return section(request.title||'Decision analysis','<p>'+h(request.purpose||'')+'</p><p>'+h(analysis.methods?.objective_scope||'')+'</p>'+
      '<dl class="po-metrics">'+metric('Selected units',counts.selected)+metric('Eligible units',counts.eligible)+metric('Original inventory',counts.inventory)+
      metric('Independent objective score',selection.objective_score)+metric('Reporting union',geometry.reporting_union_area_ha,'ha')+
      metric('Whole-unit union',geometry.whole_unit_union_area_ha,'ha')+metric('Reporting overlap',geometry.reporting_overlap_area_ha,'ha')+
      metric('Supplied cost total',selection.supplied_cost_total,selection.currency||'')+
      metric('Known supplied cost subtotal',selection.known_supplied_cost_subtotal,selection.currency||'')+'</dl>'+
      '<p>'+h(geometry.area_constraint_method||'')+'</p><p>'+h(analysis.methods?.optimality_scope||'')+'</p>'+
      '<div class="po-actions">'+button('revise','Revise selection')+
      (active?.plan?'':button('save','Save selected land plan','',!array(analysis.selected_ids).length))+
      '<button type="button" data-action="conservation-open-study" data-study-id="'+h(analysis.input?.study_id||request.study_id)+'">Open original study</button></div>'+
      json('Original constraints and available axes',request)+json('Solver outcome and actual resource limits',{optimization:analysis.optimization,solver_request:analysis.solver_request})+
      json('Independent objective sums and units',selection.independent_objective_sums)+
      json('Objective normalization',analysis.normalization)+json('Original source and native bindings',analysis.input))+
      section('Candidate inventory','<div id="po-candidates">'+candidatesHTML(analysis)+'</div>')+
      section('Named preference comparisons','<p>'+h(analysis.stability?.interpretation||'')+'</p>'+
        table(['Preference','Eligible','Selected',''],array(analysis.stability?.profiles).map(profile=>'<tr><td>'+h(profile.name)+'</td><td>'+h(profile.eligible_count)+
          '</td><td>'+array(profile.selected_ids).length+'</td><td>'+json('Weights, original IDs and solver outcome',profile)+'</td></tr>')))+
      '<div class="po-actions">'+button('analysis-json','Inspect complete original analysis')+'</div>';
  }
  function activeHTML() {
    if(!active)return '';
    const plan=active.plan, analysis=active.analysis;
    return '<div class="po-actions">'+button('list','All studies and saved work')+'</div>'+
      (plan?section(plan.title||'Saved land plan','<p class="po-id">'+h(plan.id)+'</p>'+
        '<p>'+h(human(plan.state))+' · '+array(plan.selected_ids).length+' original units</p>'+
        '<div class="po-actions">'+(plan.selection?.optimization?button('export','Export complete decision packet',attr('id',plan.id)):'')+
        '<button type="button" data-action="conservation-open-plan" data-plan-id="'+h(plan.id)+'">Open plan and prepare a native scenario</button></div>'+
        json('Recomputed selected-union results',plan.summary)+json('Original plan selection',plan.selection)):'')+
      (analysis?analysisHTML(analysis):'')+
      (active.files?.length?section('Saved outputs',host.fileList(active.files)):'');
  }
  function paint() {
    if(!node)return;
    node.innerHTML='<div class="po-desk"><header><h1>Conservation optimization</h1><p>Compare retained planning units under explicit objectives and land or cost limits. Save the chosen land in the original Conservation plan store.</p>'+controls()+'</header>'+
      (issue?'<p class="po-error" role="alert">'+h(issue)+'</p>':'')+
      (loading?'<p role="status">Loading original records…</p>':'')+
      (active?activeHTML():dashboardHTML())+section('Original task queue','<div id="po-tasks">'+tasksHTML()+'</div>')+'</div>';
    bindFilters();
  }
  function bindFilters() {
    if(!node)return;
    const search=node.querySelector('#po-candidate-search'), filter=node.querySelector('#po-candidate-show');
    search?.addEventListener('input',()=>{query=search.value;page=0;paintCandidates(true);});
    filter?.addEventListener('change',()=>{show=filter.value;page=0;paintCandidates();});
  }
  function paintCandidates(restore=false) {
    const container=node?.querySelector('#po-candidates');if(!container||!active?.analysis)return;
    const old=node.querySelector('#po-candidate-search'), caret=old?.selectionStart;
    container.innerHTML=candidatesHTML(active.analysis);bindFilters();
    if(restore){const next=node.querySelector('#po-candidate-search');next?.focus();if(Number.isInteger(caret))try{next.setSelectionRange(caret,caret);}catch(_){}}
  }
  async function refreshCatalog() {
    resetWorkspace();if(catalogPromise)return catalogPromise;
    const epoch=generation;catalogTasks=completedTasks();loading=true;paint();
    const pending=(async()=>{
      try{const value=await read('/api/conservation-optimization/catalog');if(value){catalog=value;issue='';}}
      catch(error){if(epoch===generation)issue=error.message||String(error);}
      finally{if(epoch===generation){loading=false;catalogPromise=null;paint();}}
    })();catalogPromise=pending;return pending;
  }
  async function enter() {resetWorkspace();host.closeDetail();await host.navigate(view);resetWorkspace();}
  async function openAnalysis(study,id) {
    await enter();const token=++actionGeneration;loading=true;paint();
    try{const row=await read('/api/conservation-optimization/analysis',{study_id:study,analysis_id:id});
      if(row&&token===actionGeneration){active={analysis:row.analysis,files:row._downloads||[]};query='';show='all';page=0;issue='';}}
    finally{if(token===actionGeneration){loading=false;paint();}}
  }
  async function openPlan(id) {
    await enter();const token=++actionGeneration;loading=true;paint();
    try{
      const original=await read('/api/conservation/plan',{plan_id:id});
      if(!original||token!==actionGeneration)return;
      if(original.selection?.optimization){
        const plan=await read('/api/conservation-optimization/plan',{plan_id:id});if(!plan||token!==actionGeneration)return;
        const analysis=await read('/api/conservation-optimization/analysis',{study_id:plan.study_id,analysis_id:plan.selection.optimization.analysis_id});
        if(!analysis||token!==actionGeneration)return;
        active={plan,analysis:analysis.analysis,files:plan._downloads||[]};
      }else active={plan:original,files:original._downloads||[]};
      query='';show='all';page=0;issue='';
    }finally{if(token===actionGeneration){loading=false;paint();}}
  }
  async function openResult(id) {
    await enter();const token=++actionGeneration;const task=await read('/api/task',{id});
    if(!task||token!==actionGeneration)return;
    if(!completed(task)){await host.showTask(id);return;}
    if(task.action===ACTION+'preview'&&task.result?.request){
      active={analysis:task.result,files:task._downloads||[],task:id};query='';show='all';page=0;issue='';paint();
    }else if(task._conservation_optimization?.plan_id||task.result?.plan?.id||task.result?.plan_id){
      const planId=task._conservation_optimization?.plan_id||task.result?.plan?.id||task.result?.plan_id;
      await openPlan(planId);
      if(active?.plan?.id===planId && task.workspace===key()){
        const files=new Map([...array(active.files),...array(task._downloads)].map(file=>[file.id||file.url,file]));
        active.files=[...files.values()];paint();
      }
    }else await host.showTask(id);
  }
  async function edit(studyId,seed={}) {
    resetWorkspace();const selected=key(),token=++actionGeneration,study=await read('/api/conservation-catalog/study',{study_id:studyId});
    if(!study||key()!==selected||token!==actionGeneration)return;
    if(study.state!=='complete')throw Error('Complete the original conservation study before choosing a portfolio.');
    const spec=study.selection?.spec||study.spec||{}, bindings=study.selection?.bindings||{}, rules=spec.rules||{};
    const defaultKind={context:'source-context',current_export:'current-export',scenario_reduction:'restoration',
      disturbance_increase:'avoided-conversion',published_method:'published-method'}[spec.score?.basis]||'source-context';
    const kinds=[['source-context','Geographic source context']];
    if(study.mode==='native_model')kinds.push(['current-export','Baseline native export'],['restoration','Baseline minus selected alternative'],['avoided-conversion','Selected disturbance minus baseline']);
    if(spec.score?.basis==='published_method'&&bindings.published_method)kinds.push(['published-method','Published practice points']);
    let kind=kinds.some(([id])=>id===seed.objective?.kind)?seed.objective.kind:defaultKind;
    if(!kinds.some(([id])=>id===kind))kind=kinds[0][0];
    const alternatives=array(spec.alternative_run_ids).map(id=>[id,bindings.runs?.[id]?.title||id]);
    const alternative=seed.objective?.scenario_run_id||spec.score?.alternative_run_id||alternatives[0]?.[0]||'';
    const costs=spec.costs, usd=costs?.currency==='USD', limits=seed.constraints||{}, filters=seed.filters||{};
    const selectedWeights={...(seed.weights||{})};
    let formNode=null;
    const get=name=>formNode.querySelector('[name="'+name+'"]');
    const text=name=>get(name)?.value??'';
    function weightsHTML(nextKind,nextAlternative) {
      const axes=axesFor(study,nextKind,nextAlternative);
      return '<p>Available measurements from this study’s retained source and native bindings. The queued preview evaluates each candidate’s actual support.</p>'+
        (axes.length?axes.map(axis=>input('weight-'+axis,human(axis),selectedWeights[axis]??(nextKind==='source-context'?(axis==='reporting_area_ha'?1:0):1),'type="number" min="0" step="any" required')).join(''):
          '<p>Select an original alternative with shared native outputs.</p>');
    }
    function updateAxes() {
      for(const element of formNode.querySelectorAll('[name^="weight-"]'))selectedWeights[element.name.slice(7)]=element.value;
      const current=text('kind'), paired=['restoration','avoided-conversion'].includes(current);
      get('alternative').disabled=!paired;get('alternative').required=paired;
      get('basis').disabled=current==='source-context';if(current==='source-context')get('basis').value='total';
      formNode.querySelector('[data-po-weights]').innerHTML=weightsHTML(current,text('alternative'));
    }
    const html='<div class="po-editor"><p><strong>'+h(study.title)+'</strong> · '+h(study.planning_unit_label||study.unit_type)+'</p>'+
      '<div class="po-grid">'+input('title','Decision title',seed.title||study.title+' — selection','required')+
      textarea('purpose','Decision purpose',seed.purpose||'Compare retained land priorities under explicit resource constraints.')+
      select('kind','Objective',kinds,kind)+select('basis','Quantity basis',[['total','Original total'],['per-reporting-hectare','Per reporting hectare']],seed.objective?.basis||'total')+
      select('alternative','Original alternative',alternatives.length?alternatives:[['','No retained alternative']],alternative)+'</div>'+
      '<fieldset><legend>Measurement weights</legend><div class="po-grid" data-po-weights>'+weightsHTML(kind,alternative)+'</div></fieldset>'+
      '<fieldset><legend>Resource limits</legend><p>Blank limits use the complete eligible inventory. Costs retain the supplied whole-unit currency and amount.</p><div class="po-grid">'+
      input('budget','Budget in USD',limits.budget_usd??'','type="text" inputmode="decimal"'+(usd?'':' disabled'))+
      input('area','Area limit in hectares',limits.area_ha??'','type="number" min="0" step="any"')+
      select('area-basis','Area resource basis',[['whole_units','Whole original units'],['reporting','Within reporting geometry']],limits.area_basis||'whole_units')+
      input('count','Maximum original units',limits.max_count??'','type="number" min="0" step="1"')+'</div>'+
      '<p>'+h(usd?'Original USD cost table is retained. Units with missing supplied costs cannot satisfy a budget.':costs?'Original cost currency: '+costs.currency+'. USD budgets require a retained USD table.':'No cost table is bound to this study. Area and count limits are available.')+'</p></fieldset>'+
      '<details><summary>Source filters and candidate scope</summary><div class="po-grid">'+
      input('coverage','Minimum objective coverage',filters.min_coverage_fraction??rules.minimum_coverage_fraction??0,'type="number" min="0" max="1" step="any" required')+
      input('protected','Maximum protected fraction',filters.max_protected_fraction??1,'type="number" min="0" max="1" step="any" required')+
      select('source-water','Source-water relation',[['any','Any'],['yes','Present'],['no','Absent']],filters.source_water||'any')+
      select('high-quality','High-quality-water relation',[['any','Any'],['yes','Present'],['no','Absent']],filters.high_quality_water||'any')+
      textarea('include','Candidate universe: original IDs as JSON',pretty(filters.include_ids||[]))+
      textarea('exclude','Excluded original IDs as JSON',pretty(filters.exclude_ids||[]))+'</div>'+
      '<label><input name="ineligible" type="checkbox"'+(seed.include_ineligible?' checked':'')+'> Reconsider original study eligibility using this decision’s support and resource rules</label></details>'+
      '<details><summary>Solver and named preferences</summary><div class="po-grid">'+
      select('solver','Solver',[['deterministic','Deterministic portfolio solver'],['scipy-milp','SciPy mixed integer solver']],seed.solver||'deterministic')+
      input('time','Seconds per preference profile',seed.solver_time_limit_seconds??20,'type="number" min="0.001" step="any" required')+'</div>'+
      '<label><input name="stability" type="checkbox"'+(seed.stability===false||seed.stability?.enabled===false?'':' checked')+'> Compare named measurement preferences</label>'+
      textarea('profiles','Optional named preference profiles as JSON',pretty(seed.stability?.profiles||[]))+
      '<p>Leave the list empty for the original per-measurement preferences.</p></details></div>';
    host.openForm('Preview a conservation portfolio','Use this study’s retained source units and the original queued optimizer.',html,'Run complete preview',async()=>{
      if(key()!==selected)throw Error('The workspace changed. Reopen this decision in the intended workspace.');
      const objective={kind:text('kind'),basis:text('basis')};
      if(['restoration','avoided-conversion'].includes(objective.kind))objective.scenario_run_id=text('alternative');
      const weights={};for(const axis of axesFor(study,objective.kind,objective.scenario_run_id))
        weights[axis]=optionalNumber(text('weight-'+axis),human(axis))??0;
      if(!Object.values(weights).some(value=>value>0))throw Error('Choose at least one positive available measurement weight.');
      const constraints={area_basis:text('area-basis')};
      if(text('budget').trim()){
        if(!usd)throw Error('A USD budget requires this study’s retained USD cost table.');
        if(!/^\d+(?:\.\d{1,2})?$/.test(text('budget').trim()))throw Error('Use a nonnegative USD amount with at most two decimal places.');
        constraints.budget_usd=text('budget').trim();
      }
      const area=optionalNumber(text('area'),'Area limit'), count=optionalNumber(text('count'),'Unit limit',{integer:true});
      if(area!==undefined)constraints.area_ha=area;if(count!==undefined)constraints.max_count=count;
      let profiles;try{profiles=JSON.parse(text('profiles')||'[]');}catch(_){throw Error('Named preference profiles must be a JSON list.');}
      if(!Array.isArray(profiles))throw Error('Named preference profiles must be a JSON list.');
      const payload={study_id:study.id,title:text('title').trim(),purpose:text('purpose').trim(),objective,weights,constraints,
        filters:{min_coverage_fraction:optionalNumber(text('coverage'),'Minimum coverage',{max:1}),
          max_protected_fraction:optionalNumber(text('protected'),'Protected fraction',{max:1}),
          source_water:text('source-water'),high_quality_water:text('high-quality'),
          include_ids:idList(text('include'),'Candidate universe'),exclude_ids:idList(text('exclude'),'Excluded units')},
        include_ineligible:get('ineligible').checked,solver:text('solver'),
        solver_time_limit_seconds:optionalNumber(text('time'),'Solver limit',{min:.001}),
        stability:{enabled:get('stability').checked,profiles}};
      await host.submitAction(ACTION+'preview',{spec:payload});
    },()=>{
      formNode=globalThis.document.querySelector('#form-body .po-editor');
      if(!formNode)throw Error('The original operator form did not mount.');
      get('kind').addEventListener('change',updateAxes);get('alternative').addEventListener('change',updateAxes);updateAxes();
    });
  }
  function queueSave() {
    if(!active?.analysis)return;
    const analysis=active.analysis,selected=key(),selection=selectionFromRequest(analysis.request);
    if(!array(analysis.selected_ids).length)throw Error('This preview has no selected units. Revise the objectives or resource limits.');
    host.openForm('Save this land decision','The original optimizer recalculates this retained selection and saves its selected land through Conservation.',
      '<div class="po-editor"><p>'+h(selection.title)+' · '+analysis.selected_ids.length+' selected original units</p>'+
      json('Complete selection to save',selection)+'</div>','Save land plan',async()=>{
        if(key()!==selected)throw Error('The workspace changed. Reopen the decision in the intended workspace.');
        await host.submitAction(ACTION+'save',{spec:selection});
      });
  }
  function queueExport(id) {
    const selected=key();
    host.openForm('Export the complete decision','The original queue prepares the geographic portfolio and every retained optimization file.',
      '<p class="po-id">'+h(id)+'</p>','Prepare decision packet',async()=>{
        if(key()!==selected)throw Error('The workspace changed. Reopen the plan in the intended workspace.');
        await host.submitAction(ACTION+'export',{plan_id:id});
      });
  }
  function inspectCandidate(id) {
    const row=active?.analysis?.candidates?.find(candidate=>candidate.feature_id===id);if(!row)return;
    host.detail(row.label||row.feature_id,'<div class="po-desk">'+json('Original candidate and independent support',row)+
      '<p>'+h(array(row.exclusions).join('; ')||'Eligible under the selected objectives and resources.')+'</p></div>');
  }
  function mount(element) {
    resetWorkspace();node=element;stamp=taskStamp(host.getState());paint();
    if(!catalog||catalogTasks!==completedTasks())return refreshCatalog();
    return catalogPromise;
  }
  function update() {
    const before=workspace;resetWorkspace();if(before!==workspace){paint();return refreshCatalog();}
    const next=taskStamp(host.getState());if(next===stamp)return;stamp=next;
    const tasks=node?.querySelector('#po-tasks');if(tasks)tasks.innerHTML=tasksHTML();
    if(catalogTasks!==completedTasks())return refreshCatalog();
  }
  function detach() {node=null;}
  async function dispatch(target) {
    resetWorkspace();const action=target?.dataset?.action;
    if(!action?.startsWith(PREFIX))return false;
    const name=action.slice(PREFIX.length);
    try{
      if(name==='refresh')await refreshCatalog();
      else if(name==='list'){actionGeneration++;active=null;issue='';paint();await refreshCatalog();}
      else if(name==='new')await edit(target.dataset.study);
      else if(name==='revise'&&active?.analysis)await edit(active.analysis.request.study_id,selectionFromRequest(active.analysis.request));
      else if(name==='save')queueSave();
      else if(name==='export')queueExport(target.dataset.id);
      else if(name==='task')await host.showTask(target.dataset.id);
      else if(name==='result')await openResult(target.dataset.id);
      else if(name==='plan')await openPlan(target.dataset.id);
      else if(name==='analysis')await openAnalysis(target.dataset.study,target.dataset.id);
      else if(name==='candidate')inspectCandidate(target.dataset.id);
      else if(name==='analysis-json'&&active?.analysis)host.detail('Complete original decision analysis','<div class="po-desk"><pre>'+h(pretty(active.analysis))+'</pre></div>');
      else if(name==='previous'){page=Math.max(0,page-1);paintCandidates();}
      else if(name==='next'){page++;paintCandidates();}
    }catch(error){issue=error.message||String(error);paint();throw error;}
    return true;
  }
  function taskActions(task) {
    if(!task?.action?.startsWith(ACTION)||!completed(task))return '';
    return '<div class="po-actions">'+button('result','Open conservation decision',attr('id',task.id))+'</div>';
  }
  return {mount,update,detach,dispatch,taskActions,openPlan,openAnalysis,openResult,openStudy:edit};
}
