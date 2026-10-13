import {createPortfolioPairingControls} from './portfolio_pairing.mjs';
import {nativeModelsForOutputs,nativeCommonVersionIssues} from './native_versions.mjs';
/* Conservation portfolio operator. Host supplies the existing workspace and task services. */
export function attachPortfolio(host) {
  const {getState,api,endpoint,openForm,submitAction,sourceForm,toast,openItem,executeAction,openExtension,refreshState}=host;
  const metrics=[['nitrogen_export','Nitrogen','kg/yr'],['phosphorus_export','Phosphorus','kg/yr'],['sediment_export','Sediment','t/yr']];
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const fmt=(v,d=2)=>finite(v)?Number(v).toLocaleString(undefined,{maximumFractionDigits:d}):'Unknown';
  const pct=v=>finite(v)?fmt(Number(v)*100,1)+'%':'Unknown';
  const money=v=>finite(v)?Number(v).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}):'Unknown';
  const values=x=>Array.isArray(x)?x:Object.values(x||{});
  const arr=x=>Array.isArray(x)?x:[];
  const label=r=>r.title||r.name||r.id;
  const button=(action,text,id='',extra='')=>'<button type="button" data-action="portfolio-'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+' '+extra+'>'+esc(text)+'</button>';
  const field=(name,title,value='',attrs='',help='')=>'<label class="pf-field"><span>'+esc(title)+'</span><input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
  const select=(name,title,options,value='',help='')=>'<label class="pf-field"><span>'+esc(title)+'</span><select name="'+esc(name)+'">'+options.map(o=>'<option value="'+esc(o[0])+'"'+(String(value)===String(o[0])?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
  const note=text=>'<p class="pf-note">'+esc(text)+'</p>';
  function data(){
    const state=getState(),key=state?.workspace_key??null;
    if(key!==boundWorkspace){
      boundWorkspace=key;workspaceGeneration+=1;
      Object.assign(draft,initialDraft);preview=null;previewKey='';busy=false;error='';
      tablePage=0;query='';filter='selected';cache.clear();
      if(unmountDetail)unmountDetail();unmountDetail=null;
    }
    return state?.data||{};
  }
  const records=kind=>values(data()[kind]);
  let root=null,unmount=null,unmountDetail=null,preview=null,busy=false,error='',previewKey='',tablePage=0,query='',filter='selected',boundWorkspace=undefined,workspaceGeneration=0;
  const cache=new Map();
  const initialDraft={title:'Land conservation portfolio',purpose:'',delivery_id:'',kind:'avoided-conversion',scenario_run_id:'',basis:'total',
    nitrogen_export:'1',phosphorus_export:'1',sediment_export:'1',min_coverage_fraction:'0.95',max_protected_fraction:'1',
    source_water:'any',high_quality_water:'any',budget_usd:'',area_ha:'',max_count:'',cost_source:'',
    feature_id_field:'feature_id',cost_field:'cost_usd',include_feature_ids:'',exclude_feature_ids:'',solver:'deterministic'};
  const draft={...initialDraft};
  function sourceOptions(){
    const options=[['','No cost table']];
    for(const collection of records('sources'))for(const entry of values(collection.entries)){
      if(entry.kind!=='table')continue;
      options.push([encodeURIComponent(JSON.stringify([collection.id,entry.id])),label(collection)+' / '+label(entry)]);
    }
    return options;
  }
  function deliveries(){
    return [
      ...records('planning_inventories').map(r=>({...r,_key:'inventory:'+r.id,_inventory:true})),
      ...records('deliveries').filter(r=>r.parcel_priorities&&(r.files?.parcel_csv||r.parcel_priorities.features!==undefined)).map(r=>({...r,_key:r.id}))
    ];
  }
  function inventoryWeights(row){
    const available=row?.available_metrics||metrics.map(([key])=>key);
    for(const [key]of metrics)draft[key]=available.includes(key)?'1':'0';
    if(!arr(row?.selection?.scenario_run_ids).length)draft.kind='current-export';
  }
  function delivery(){
    const rows=deliveries();
    if(!draft.delivery_id&&rows.length){draft.delivery_id=rows[0]._key;inventoryWeights(rows[0]);}
    return rows.find(r=>r._key===draft.delivery_id);
  }
  function runOptions(ids,empty='Choose a completed native alternative'){
    const byId=new Map(records('runs').map(r=>[r.id,r]));
    return [['',empty],...arr(ids).map(id=>[id,label(byId.get(id)||{id})])];
  }
  function ids(text){
    return [...new Set(String(text||'').split(/[\n,]+/).map(x=>x.trim()).filter(Boolean))];
  }
  function capture(scope=root){
    const form=scope?.querySelector('[data-portfolio-form]');
    if(form)for(const [key,value]of new FormData(form))if(Object.prototype.hasOwnProperty.call(draft,key))draft[key]=String(value);
    return form;
  }
  function request(){
    capture();
    const d=delivery();
    if(!d)throw new Error('Build a native planning inventory or select an original delivery inventory.');
    if(!draft.title.trim())throw new Error('Give the portfolio a title.');
    if(draft.kind!=='current-export'&&!draft.scenario_run_id)throw new Error('Choose the native alternative used to measure the planning unit objective.');
    const weights=Object.fromEntries(metrics.map(([key])=>[key,Number(draft[key])]));
    if(Object.values(weights).some(v=>!Number.isFinite(v)||v<0)||!Object.values(weights).some(v=>v>0))throw new Error('Enter nonnegative pollutant weights with at least one positive weight.');
    const filters={min_coverage_fraction:Number(draft.min_coverage_fraction),max_protected_fraction:Number(draft.max_protected_fraction),
      source_water:draft.source_water,high_quality_water:draft.high_quality_water};
    if([filters.min_coverage_fraction,filters.max_protected_fraction].some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('Coverage and protected fractions must be between 0 and 1.');
    for(const key of ['include_feature_ids','exclude_feature_ids'])if(ids(draft[key]).length)filters[key]=ids(draft[key]);
    const constraints={};
    if(draft.budget_usd.trim()){
      if(!/^\d+(\.\d{1,2})?$/.test(draft.budget_usd.trim()))throw new Error('Enter the USD budget as a nonnegative amount with at most two decimal places.');
      constraints.budget_usd=draft.budget_usd.trim();
    }
    for(const key of ['area_ha','max_count'])if(draft[key].trim()){
      const value=Number(draft[key]);
      if(!Number.isFinite(value)||value<0||(key==='max_count'&&!Number.isInteger(value)))throw new Error('Area and planning unit limits must be nonnegative; the planning unit limit must be an integer.');
      constraints[key]=value;
    }
    const payload={title:draft.title.trim(),purpose:draft.purpose.trim(),delivery_id:d._inventory?undefined:d.id,inventory_id:d._inventory?d.id:undefined,
      objective:{kind:draft.kind,basis:draft.basis},weights,filters,constraints,solver:draft.solver};
    if(draft.kind!=='current-export')payload.objective.scenario_run_id=draft.scenario_run_id;
    if(draft.cost_source){
      const [source_collection_id,source_id]=JSON.parse(decodeURIComponent(draft.cost_source));
      if(!draft.feature_id_field.trim()||!draft.cost_field.trim())throw new Error('Provide the feature ID and USD cost column names.');
      payload.costs={source_collection_id,source_id,feature_id_field:draft.feature_id_field.trim(),cost_field:draft.cost_field.trim()};
    }
    if(constraints.budget_usd!==undefined&&!payload.costs)throw new Error('Choose a supplied planning unit cost table for a budgeted selection.');
    return payload;
  }
  function current(){
    try{return !!preview&&previewKey===JSON.stringify(request());}catch{return false;}
  }
  function config(){
    const d=delivery();
    const scenarios=runOptions(d?.selection?.scenario_run_ids);
    return '<form data-portfolio-form class="pf-config"><fieldset><legend>Source and objective</legend>'+
      field('title','Portfolio title',draft.title,'required maxlength="160"')+
      field('purpose','Decision or project purpose',draft.purpose,'maxlength="1000"')+
      select('delivery_id','Planning inventory',deliveries().map(r=>[r._key,label(r)+(r._inventory?' · '+r.unit_kind:' · delivery')]),draft.delivery_id,'Select retained native results and their original planning geometry.')+
      select('kind','Decision objective',[['avoided-conversion','Protect against development'],['restoration','Prioritize restoration'],['current-export','Locate current export']],draft.kind)+
      select('scenario_run_id','Native alternative',scenarios,draft.scenario_run_id,'Protection measures alternative minus baseline. Restoration measures baseline minus alternative.')+
      select('basis','Score basis',[['total','Total planning unit export'],['per-reporting-hectare','Export per reporting hectare']],draft.basis)+
      '</fieldset><fieldset><legend>Pollutant priorities</legend><div class="pf-grid-three">'+metrics.map(([key,title])=>field(key,title+' weight',draft[key],'type="number" min="0" step="any" required')).join('')+'</div>'+
      note('Weights apply to normalized planning unit objectives. The preview also compares equal weights, single pollutants and changed preferences.')+
      '</fieldset><fieldset><legend>Eligibility and context</legend><div class="pf-grid-two">'+
      field('min_coverage_fraction','Minimum valid coverage',draft.min_coverage_fraction,'type="number" min="0" max="1" step="0.01" required','Fraction from 0 to 1.')+
      field('max_protected_fraction','Maximum protected fraction',draft.max_protected_fraction,'type="number" min="0" max="1" step="0.01" required','Set 0 to select fully unprotected planning units.')+
      select('source_water','Source water context',[['any','Any'],['yes','Present'],['no','Absent']],draft.source_water)+
      select('high_quality_water','High quality water context',[['any','Any'],['yes','Present'],['no','Absent']],draft.high_quality_water)+
      '</div><details><summary>Specific planning unit IDs</summary>'+field('include_feature_ids','Restrict to these IDs',draft.include_feature_ids,'','Comma separated; blank includes the whole inventory.')+
      field('exclude_feature_ids','Exclude these IDs',draft.exclude_feature_ids,'','Use the original feature IDs from the planning unit inventory.')+'</details>'+
      '</fieldset><fieldset><legend>Costs and limits</legend>'+
      select('cost_source','Supplied planning unit cost CSV',sourceOptions(),draft.cost_source)+
      '<div class="pf-grid-two">'+field('feature_id_field','Feature ID column',draft.feature_id_field)+field('cost_field','USD cost column',draft.cost_field)+'</div>'+
      '<div class="pf-toolbar">'+button('source','Import original cost file')+'</div>'+
      note('Match one USD estimate to each original planning unit ID. Unknown estimates remain visible and are excluded when a budget is applied.')+
      '<div class="pf-grid-three">'+field('budget_usd','Budget in USD',draft.budget_usd,'inputmode="decimal" placeholder="No limit"')+
      field('area_ha','Maximum hectares',draft.area_ha,'type="number" min="0" step="any" placeholder="No limit"')+
      field('max_count','Maximum planning units',draft.max_count,'type="number" min="0" step="1" placeholder="No limit"')+'</div>'+
      select('solver','Selection method',[['deterministic','Deterministic selection with bound'],['scipy-milp','Mixed integer optimization']],draft.solver)+
      '</fieldset><div class="pf-toolbar pf-sticky">'+button('preview','Calculate portfolio','','data-portfolio-submit')+
      button('save','Save portfolio','','data-portfolio-save disabled')+'<span data-portfolio-status role="status" aria-live="polite"></span></div></form>';
  }
  function selectionSummary(row){
    const s=row.selection||{},c=row.counts||{},o=row.optimization||{};
    return '<div class="pf-summary">'+[
      ['Selected planning units',fmt(s.count??c.selected,0)],['Reporting area',fmt(s.area_ha)+' ha'],
      ['Supplied cost',money(s.cost_usd)],['Selection score',fmt(s.objective_score,4)],
      ['Eligible inventory',fmt(c.eligible,0)+' / '+fmt(c.inventory,0)],
      ['Optimization',String(o.status||'Available')]
    ].map(([a,b])=>'<div><span>'+esc(a)+'</span><strong>'+esc(b)+'</strong></div>').join('')+'</div>'+
    '<dl class="pf-facts"><dt>Score upper bound</dt><dd>'+esc(fmt(o.upper_bound,4))+'</dd><dt>Relative selection gap</dt><dd>'+esc(pct(o.relative_gap))+
    '</dd><dt>Unknown cost estimates</dt><dd>'+esc(fmt(s.unknown_cost_count??c.unknown_costs,0))+'</dd></dl>';
  }
  function stability(row){
    const s=row.stability||{},profiles=arr(s.profiles);
    if(!profiles.length)return '';
    return '<details class="pf-section" open><summary>Preference sensitivity</summary>'+
      note(s.interpretation||'Compare the selected set under different pollutant preferences. This comparison uses the same retained native results and constraints.')+
      '<div class="pf-scroll"><table><thead><tr><th>Preference</th><th>N weight</th><th>P weight</th><th>Sediment weight</th><th>Selected</th><th>Selection status</th></tr></thead><tbody>'+
      profiles.map(p=>'<tr><th scope="row">'+esc(p.name)+'</th>'+metrics.map(([key])=>'<td>'+esc(fmt(p.weights?.[key],3))+'</td>').join('')+
      '<td>'+esc(fmt(p.selected_count,0))+'</td><td>'+esc(p.optimization?.status||'')+'</td></tr>').join('')+'</tbody></table></div></details>';
  }
  function candidateRows(row,search=query,mode=filter){
    const selected=new Set(arr(row.selection?.feature_ids).map(String));
    return arr(row.candidates).filter(r=>(mode==='all'||(mode==='selected'&&(r.selected||selected.has(String(r.feature_id))))||(mode==='excluded'&&!r.eligible)||(mode==='eligible'&&r.eligible))&&
      (!search||[r.feature_id,...arr(r.exclusions)].join(' ').toLowerCase().includes(search.toLowerCase())));
  }
  function tableContent(row,page=tablePage,search=query,mode=filter){
    const rows=candidateRows(row,search,mode),pages=Math.max(1,Math.ceil(rows.length/50)),active=Math.min(Math.max(0,page),pages-1);
    const selected=new Set(arr(row.selection?.feature_ids).map(String));
    return '<div class="pf-scroll" tabindex="0" aria-label="Planning unit ranking table"><table class="pf-parcels"><thead><tr><th>Planning unit</th><th>Rank</th><th>Score</th><th>Area ha</th><th>Cost USD</th><th>Coverage</th><th>Protected</th><th>N kg/yr</th><th>P kg/yr</th><th>Sediment t/yr</th><th>Rank range</th><th>Selections</th><th>Context and eligibility</th></tr></thead><tbody>'+
      (rows.slice(active*50,active*50+50).map(r=>{
        const st=r.rank_stability||{},chosen=r.selected||selected.has(String(r.feature_id));
        const range=st.min_rank==null?'—':fmt(st.min_rank,0)+'–'+fmt(st.max_rank,0);
        const context=[chosen?'Selected':r.eligible?'Eligible':'Excluded',r.source_water?'Source water':'',r.high_quality_context?'High quality water':'',...arr(r.exclusions)].filter(Boolean);
        return '<tr'+(chosen?' class="pf-selected"':'')+'><th scope="row">'+esc(r.feature_id)+'</th><td>'+esc(fmt(r.rank,0))+'</td><td>'+esc(fmt(r.score,4))+
          '</td><td>'+esc(fmt(r.area_ha))+'</td><td>'+esc(money(r.cost_usd))+'</td><td>'+esc(pct(r.coverage_fraction))+
          '</td><td>'+esc(pct(r.protected_fraction))+'</td>'+metrics.map(([key])=>'<td>'+esc(fmt(r.physical_metrics?.[key],3))+'</td>').join('')+
          '<td>'+esc(range)+'</td><td>'+esc(st.profile_count?st.selected_profiles+'/'+st.profile_count:'—')+'</td><td>'+esc(context.join(' · '))+'</td></tr>';
      }).join('')||'<tr><td colspan="13">No planning units match these display filters.</td></tr>')+'</tbody></table></div>'+
      '<div class="pf-toolbar pf-pagination">'+button('previous','Previous','','data-portfolio-page '+(active===0?'disabled':''))+
      '<span>'+esc(rows.length+' planning units · page '+(active+1)+' of '+pages)+'</span>'+button('next','Next','','data-portfolio-page '+(active===pages-1?'disabled':''))+'</div>';
  }
  function candidateTable(row){
    if(!Array.isArray(row.candidates))return note('Open the retained candidate ranking CSV for every planning unit and its original attributes.');
    return '<section class="pf-section" data-portfolio-table><h3>Planning unit ranking and selection</h3><div class="pf-table-filters">'+
      '<label class="pf-field"><span>Find a planning unit or exclusion reason</span><input data-portfolio-search value="'+esc(query)+'" type="search"></label>'+
      '<label class="pf-field"><span>Show</span><select data-portfolio-filter>'+[['selected','Selected planning units'],['eligible','All eligible planning units'],['excluded','Excluded planning units'],['all','Full inventory']].map(([v,t])=>'<option value="'+v+'"'+(filter===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label></div>'+
      '<div data-portfolio-table-content>'+tableContent(row)+'</div></section>';
  }
  function physical(row){
    const values=row.selection?.physical_metrics;
    if(!values)return '';
    return '<section class="pf-section"><h3>Selected planning unit contributions</h3>'+note(row.methods?.combined_effect||'Run the selected portfolio as one native land-cover alternative to obtain the combined treatment result.')+
      '<table><thead><tr><th>Metric</th><th>Planning unit contribution</th><th>Units</th><th>Planning unit coverage</th></tr></thead><tbody>'+
      metrics.map(([key,title,units])=>{const r=values[key]||{};return '<tr><th scope="row">'+title+'</th><td>'+esc(fmt(r.sum,3))+'</td><td>'+esc(r.units||units)+
        '</td><td>'+esc(fmt(r.known_parcels,0)+' known / '+fmt(r.missing_parcels,0)+' missing')+'</td></tr>';}).join('')+'</tbody></table></section>';
  }
  function analysis(row){
    row=row.analysis||row;
    return selectionSummary(row)+note(row.methods?.objective_direction||'')+physical(row)+stability(row)+candidateTable(row);
  }
  function result(){
    if(error)return '<div class="pf-error" role="alert">'+esc(error)+'</div>'+(preview?analysis(preview):'');
    if(!preview)return '<div class="pf-empty"><h3>Choose the land that best serves the project</h3><p>Calculate a portfolio to review selected planning units, spending, pollutant contributions and sensitivity to different priorities.</p><p>Saved portfolios carry the original planning unit selections into a native land-cover scenario and a decision report.</p></div>';
    return analysis(preview);
  }
  function saved(){
    const rows=records('portfolios'),reports=records('portfolio_reports');
    return '<section class="pf-section"><div class="pf-heading"><h2>Saved portfolios</h2><span>'+esc(rows.length)+'</span></div>'+
      (rows.length?'<div class="pf-saved">'+rows.map(r=>{
        cache.set(r.id,{...cache.get(r.id),...r});
        return '<article><h3>'+esc(label(r))+'</h3><p>'+esc(r.purpose||r.request?.purpose||'')+'</p><dl><dt>Planning units</dt><dd>'+esc(fmt(r.selection?.count,0))+'</dd><dt>Hectares</dt><dd>'+esc(fmt(r.selection?.area_ha))+'</dd><dt>Cost</dt><dd>'+esc(money(r.selection?.cost_usd))+'</dd></dl><div class="pf-toolbar">'+
          button('open','Inspect',r.id)+button('edit','Use these settings',r.id)+button('run','Run selected land cover',r.id)+
          button('decision','Build decision desk',r.id)+button('report','Build portfolio report',r.id)+button('analysis','Compare native scenarios',r.id)+'</div></article>';
      }).join('')+'</div>':note('Save a calculated selection to retain its full ranking, source inputs and analysis.'))+
      (reports.length?'<h3>Decision and portfolio reports</h3><ul class="pf-report-list">'+reports.map(r=>'<li>'+button('report-open',label(r),r.id)+' <span>'+esc(r.report_type||'Portfolio report')+'</span></li>').join('')+'</ul>':'')+'</section>';
  }
  function render(){
    delivery();
    return '<section class="portfolio-workspace"><header class="pf-heading"><div><p class="pf-eyebrow">Land and water decisions</p><h1>Conservation portfolios</h1><p>Compare protection and restoration priorities, select planning units within the project limits, and evaluate the selected combination.</p></div><div class="pf-toolbar">'+button('inventory','Build native inventory')+'</div></header>'+
      (deliveries().length?'<div class="pf-layout"><aside>'+config()+'</aside><div class="pf-results" data-portfolio-results aria-live="polite">'+result()+'</div></div>':
      '<div class="pf-empty"><h2>Prepare the planning inventory</h2><p>Choose original polygons and completed native runs to build an inventory. Planning unit inventories from saved map deliveries also appear here.</p>'+button('inventory','Build native inventory')+button('source','Import original data')+'</div>')+
      saved()+'</section>';
  }
  function sync(){
    if(!root)return;
    const valid=current();
    const status=root.querySelector('[data-portfolio-status]');
    if(status)status.textContent=busy?'Calculating…':preview?(valid?'Current selection':'Settings changed. Recalculate to review the new selection.'):'';
    const save=root.querySelector('[data-portfolio-save]');
    if(save)save.disabled=busy||!valid;
    for(const b of root.querySelectorAll('[data-portfolio-submit]'))b.disabled=busy;
    const scenario=root.querySelector('[name="scenario_run_id"]');
    if(scenario)scenario.disabled=draft.kind==='current-export';
  }
  function refreshResult(){
    const target=root?.querySelector('[data-portfolio-results]');
    if(target)target.innerHTML=result();
    sync();
  }
  function updateTables(scope=root,row=preview){
    if(!scope||!row)return;
    row=row.analysis||row;
    const target=scope.querySelector('[data-portfolio-table-content]');
    if(target)target.innerHTML=tableContent(row);
  }
  function mount(node){
    if(unmount)unmount();unmount=null;root=node;
    const input=e=>{
      const target=e.target;
      if(target.matches('[data-portfolio-search]')){query=target.value;tablePage=0;updateTables();return;}
      if(target.matches('[data-portfolio-filter]')){filter=target.value;tablePage=0;updateTables();return;}
      if(target.closest('[data-portfolio-form]')){capture();sync();}
    };
    const change=e=>{
      if(e.target.name==='delivery_id'){
        capture();draft.scenario_run_id='';
        const s=root.querySelector('[name="scenario_run_id"]'),d=delivery();
        inventoryWeights(d);
        for(const [key]of metrics){const input=root.querySelector('[name="'+key+'"]');if(input)input.value=draft[key];}
        const objective=root.querySelector('[name="kind"]');if(objective)objective.value=draft.kind;
        if(s)s.innerHTML=runOptions(d?.selection?.scenario_run_ids).map(([v,t])=>'<option value="'+esc(v)+'">'+esc(t)+'</option>').join('');
      }
      input(e);
    };
    const submit=e=>{if(e.target.matches('[data-portfolio-form]')){e.preventDefault();dispatch({dataset:{action:'portfolio-preview'}});}};
    node.addEventListener('input',input);node.addEventListener('change',change);node.addEventListener('submit',submit);
    unmount=()=>{node.removeEventListener('input',input);node.removeEventListener('change',change);node.removeEventListener('submit',submit);};
    sync();
  }
  function detach(){if(unmount)unmount();if(unmountDetail)unmountDetail();unmount=null;unmountDetail=null;root=null;}
  async function completed(receipt,taskEndpoint,owner){
    let task=receipt?.task||receipt,id=task?.id||task?.task_id;
    if(!id)return task?.result??task;
    for(;;){
      data();if(owner!==workspaceGeneration)return null;
      const status=String(task.state||task.status||'').toLowerCase();
      if(task.error||['failed','error','cancelled','canceled'].includes(status))throw new Error(typeof task.error==='string'?task.error:task.error?.message||task.message||'The operation failed. Open its task for details.');
      if(['succeeded','success','completed','complete','done'].includes(status))return task.result??task.output??task;
      if(task.result!==undefined&&!['queued','running','pending','preparing'].includes(status))return task.result;
      await new Promise(resolve=>setTimeout(resolve,800));
      const response=await api(taskEndpoint+(taskEndpoint.includes('?')?'&':'?')+'id='+encodeURIComponent(id));
      task=response?.task||response;
    }
  }
  function submitted(form){
    if(!form)form=document.getElementById('operation-form');
    if(!form)throw new Error('The operation form is no longer available. Reopen this action.');
    if(form instanceof FormData)return form;
    if(typeof HTMLFormElement!=='undefined'&&(form instanceof HTMLFormElement||form?.currentTarget instanceof HTMLFormElement))return new FormData(form.currentTarget||form);
    if(form&&typeof form.get==='function')return form;
    return new Map(Object.entries(form||{}));
  }
  function record(id){data();return cache.get(id)||records('portfolios').find(r=>r.id===id);}
  function assertWorkspace(owner){data();if(owner!==workspaceGeneration)throw new Error('The workspace changed. Open this action in the current project.');}
  function linkedRuns(r){
    const context=r.context||{},scenarioIds=new Set(records('scenarios').filter(s=>s.portfolio_id===r.id).map(s=>s.id));
    return records('runs').filter(run=>['completed','complete','succeeded','success','done'].includes(String(run.state||run.status).toLowerCase())&&run.selection?.grid_id===context.grid_id&&scenarioIds.has(run.selection?.scenario_id));
  }
  function controls(r){
    return '<div class="pf-toolbar">'+button('run','Run selected land cover',r.id)+button('decision','Build decision desk',r.id)+button('report','Build portfolio report',r.id)+button('analysis','Compare native scenarios',r.id)+button('edit','Use these settings',r.id)+'</div>';
  }
  function renderItem(row,kind='portfolios'){
    data();cache.set(row.id,row);tablePage=0;
    if(kind==='portfolio_reports'){
      const summary=row.decision||row.summary||{};
      return '<section class="portfolio-workspace"><h2>'+esc(row.title||'Portfolio report')+'</h2>'+note(row.report_type==='whole-scenario-decision'?'Native model results and project economics for the selected land-cover combination.':'Saved portfolio priorities, selections, context and source inputs.')+
        '<dl class="pf-facts"><dt>Portfolio</dt><dd>'+esc(row.portfolio_id||row.selection?.portfolio_id||'')+'</dd><dt>Report type</dt><dd>'+esc(row.report_type||'Portfolio')+'</dd><dt>Alternatives</dt><dd>'+esc(Array.isArray(summary.alternatives)?summary.alternatives.length:summary.alternatives??'')+'</dd></dl></section>';
    }
    return '<section class="portfolio-workspace"><h2>'+esc(label(row))+'</h2>'+note(row.purpose||row.request?.purpose||'')+controls(row)+analysis(row)+'</section>';
  }
  function mountItem(node,row){
    if(unmountDetail)unmountDetail();
    unmountDetail=null;
    if(!node)return;
    const input=e=>{
      if(e.target.matches('[data-portfolio-search]')){query=e.target.value;tablePage=0;updateTables(node,row);}
      if(e.target.matches('[data-portfolio-filter]')){filter=e.target.value;tablePage=0;updateTables(node,row);}
    };
    node.addEventListener('input',input);node.addEventListener('change',input);
    node.dataset.portfolioItem=row.id;
    unmountDetail=()=>{node.removeEventListener('input',input);node.removeEventListener('change',input);delete node.dataset.portfolioItem;};
  }
  function inventoryForm(){
    const owner=workspaceGeneration;
    const runs=records('runs').filter(r=>r.state==='complete'&&metrics.some(([key])=>r.artifacts?.[key]));
    const baselines=runs.filter(run=>records('scenarios').some(s=>s.id===run.selection?.scenario_id&&s.kind==='baseline'));
    if(!baselines.length)throw new Error('Complete an original native baseline before building its planning inventory.');
    const vectors=[];
    for(const collection of records('sources'))for(const entry of values(collection.entries)){
      if(entry.kind==='vector')vectors.push([encodeURIComponent(JSON.stringify([collection.id,entry.id])),label(collection)+' / '+label(entry)]);
    }
    if(!vectors.length)throw new Error('Import the original planning-unit polygon source before building its inventory.');
    const runLabel=r=>label(records('scenarios').find(s=>s.id===r.selection?.scenario_id)||r)+' · '+r.id.slice(0,10);
    const html='<div class="portfolio-workspace">'+
      field('title','Inventory title','Native planning inventory','required')+
      select('baseline_run_id','Completed native baseline',baselines.map(r=>[r.id,runLabel(r)]),baselines[0].id)+
      '<label class="pf-field"><span>Completed land-cover alternatives</span><select name="scenario_run_ids" multiple size="5"></select><small>Optional. Alternatives use the same original grid and parameter profile.</small></label>'+
      select('polygon_source','Original polygon source',vectors,vectors[0][0])+
      '<div class="pf-grid-two">'+field('layer','Source layer','','','Leave blank to use the retained source layer.')+
      field('feature_id_field','Original feature ID field','','','Leave blank to preserve the source feature IDs.')+'</div>'+
      select('unit_kind','Planning unit type',[['parcel','Parcel'],['subwatershed','Subwatershed'],['catchment','Catchment'],['planning-unit','Other planning unit']],'planning-unit')+
      note('The inventory sums the selected native annual exports on common valid cells inside each original polygon and the reporting boundary. Protected-area and water-source context stays unknown until supplied by a complete delivery inventory.')+'</div>';
    const setup=()=>{
      const form=document.getElementById('operation-form'),baseline=form?.querySelector('[name="baseline_run_id"]'),choices=form?.querySelector('[name="scenario_run_ids"]');
      if(!baseline||!choices)return;
      const update=()=>{
        const selected=runs.find(r=>r.id===baseline.value);
        const alternatives=runs.filter(r=>r.id!==selected?.id&&r.selection?.grid_id===selected?.selection?.grid_id&&r.selection?.profile_id===selected?.selection?.profile_id&&metrics.some(([key])=>r.artifacts?.[key]&&selected?.artifacts?.[key]));
        choices.innerHTML=alternatives.map(r=>'<option value="'+esc(r.id)+'">'+esc(runLabel(r))+'</option>').join('');
      };
      baseline.addEventListener('change',update);update();
    };
    openForm('Build native planning inventory','Use actual completed model outputs and original polygon identities.',html,'Build inventory',async form=>{
      assertWorkspace(owner);
      const f=submitted(form),read=k=>String(f.get(k)||'').trim();
      const [source_collection_id,source_id]=JSON.parse(decodeURIComponent(read('polygon_source')));
      const payload={title:read('title'),baseline_run_id:read('baseline_run_id'),scenario_run_ids:f.getAll('scenario_run_ids').map(String),source_collection_id,source_id,unit_kind:read('unit_kind')};
      if(!payload.title)throw new Error('Name the planning inventory.');
      const selectedRuns=[payload.baseline_run_id,...payload.scenario_run_ids].map(id=>runs.find(run=>run.id===id));
      const shared=metrics.map(([key])=>key).filter(key=>selectedRuns.every(run=>run?.artifacts?.[key]));
      if(!shared.length)throw new Error('Choose runs sharing at least one native pollutant output.');
      const versionIssues=nativeCommonVersionIssues(selectedRuns,nativeModelsForOutputs(shared));
      if(versionIssues.length)throw new Error(versionIssues.join(' '));
      if(read('layer'))payload.layer=read('layer');
      if(read('feature_id_field'))payload.feature_id_field=read('feature_id_field');
      return submitAction('portfolio.inventory.build',payload);
    },setup);
  }
  function pairedControls(id,owner,onChange){
    return createPortfolioPairingControls({api,endpoint,getState,portfolioId:id,
      assertCurrent:()=>assertWorkspace(owner),onChange});
  }
  function analysisForm(id){
    const r=record(id);if(!r)throw new Error('Open the saved portfolio to compare its native scenarios.');
    if(typeof openExtension!=='function')throw new Error('The scenario-analysis desk is unavailable in this operator.');
    const owner=workspaceGeneration,runs=linkedRuns(r);
    if(!runs.length)throw new Error('Complete a selected portfolio scenario before comparing its native result.');
    const pairing=pairedControls(id,owner);
    const html='<div class="portfolio-workspace">'+
      field('title','Analysis title',(r.title||'Portfolio')+' native scenario analysis','required')+
      select('evaluation_run_id','Completed portfolio scenario',runs.map(run=>[run.id,label(run)]),runs[0].id)+
      pairing.html()+note('The original analysis form receives the actual matched baseline and evaluation. Retained planning areas and explicit weights can be selected there.')+'</div>';
    const setup=()=>{
      const form=document.getElementById('operation-form'),run=form.querySelector('[name="evaluation_run_id"]');
      pairing.mount(form);run.addEventListener('change',()=>pairing.load(run.value));pairing.load(run.value);
    };
    openForm('Compare portfolio native scenarios','Continue from an actual matched native baseline and evaluation.',html,'Open analysis',async form=>{
      assertWorkspace(owner);
      const f=submitted(form),runId=String(f.get('evaluation_run_id')||''),title=String(f.get('title')||'').trim();
      if(!title)throw Error('Name this native scenario analysis.');
      if(!linkedRuns(r).some(run=>run.id===runId))throw new Error('Select a completed native evaluation of this portfolio.');
      const selected=pairing.selection(runId);
      let baselineId=selected.baseline_run_id;
      if(!baselineId){
        if(typeof refreshState!=='function')throw Error('Receive the current original portfolio host refresh capability before completing this continuation.');
        const task=await submitAction('portfolio.baseline.complete',{portfolio_id:id,evaluation_run_id:runId,title});
        const result=await completed(task,endpoint('/api/task'),owner);
        assertWorkspace(owner);
        if(result?.schema!=='upstate.portfolio-baseline-completion/v1'||result.portfolio_id!==id||
           result.evaluation_run_id!==runId||!result.baseline_run_id)throw Error('Open the original baseline completion task to inspect its actual result.');
        await refreshState();assertWorkspace(owner);baselineId=result.baseline_run_id;
      }
      return openExtension('scenario-analysis','create',{workspace_key:getState()?.workspace_key,
        selection:{title,baseline_run_id:baselineId,scenario_run_ids:[runId]}});
    },setup);
  }
  function chooseNative(id){
    const r=record(id);if(!r)throw new Error('Open the saved portfolio before preparing a native run.');
    const d=data(),context=r.context||{},owner=workspaceGeneration;
    const originalGrid=values(d.grids).find(x=>x.id===context.grid_id);
    if(!originalGrid)throw new Error('Open the portfolio in its retained scientific workspace with the original grid.');
    const profileRows=values(d.profiles),baseline=values(d.runs).find(x=>x.id===context.baseline_run_id);
    const scope=value=>Array.isArray(value?.models)?value.models:['ndr','sdr'];
    const gridModels=scope(originalGrid?.spec),defaultModels=scope(baseline?.selection).join(',');
    const modelOptions=profileId=>{
      const profile=profileRows.find(x=>x.id===profileId);if(!profile)return[];
      const available=gridModels.filter(model=>scope(profile).includes(model));
      const result=[];
      if(available.includes('ndr')&&available.includes('sdr'))result.push(['ndr,sdr','Nutrients and sediment']);
      if(available.includes('ndr'))result.push(['ndr','Nutrients — NDR']);
      if(available.includes('sdr'))result.push(['sdr','Sediment — SDR']);
      return result;
    };
    const eligibleProfiles=profileRows.filter(profile=>modelOptions(profile.id).length);
    if(!eligibleProfiles.length)throw new Error('Save a native model profile compatible with this portfolio grid.');
    const profileId=eligibleProfiles.some(profile=>profile.id===context.profile_id)?context.profile_id:eligibleProfiles[0].id;
    const initialModels=modelOptions(profileId);
    const selectedModels=initialModels.some(([value])=>value===defaultModels)?defaultModels:initialModels[0][0];
    const grids=context.grid_id?[[context.grid_id,label(originalGrid||{id:context.grid_id})]]:[],profiles=eligibleProfiles.map(x=>[x.id,label(x)]);
    const html='<div class="portfolio-workspace">'+note('Apply a land-cover conversion to the selected original planning unit features. The native run evaluates their combined effect using the selected models, retained grid and explicit parameter profile.')+
      field('title','Scenario title',(r.title||'Portfolio')+' selected land cover','required')+
      field('reason','Scenario purpose',r.purpose||r.request?.purpose||'Evaluate the selected portfolio','required')+
      '<div class="pf-grid-two">'+field('from_codes','Existing land-cover codes','','required placeholder="21, 22, 23, 24"','Comma separated numeric codes from the project classification.')+
      field('to_code','Target land-cover code','','type="number" step="1" required','Use the original project biophysical classification.')+'</div>'+
      select('grid_id','Native model grid',grids,context.grid_id)+select('profile_id','Native model profile',profiles,profileId)+
      select('models','Models to evaluate',initialModels,selectedModels,'Available choices follow the retained grid and selected profile.')+
      select('operation','Operation',[['portfolio.run.prepare','Prepare the native run'],['portfolio.run.start','Prepare and execute the native run']],'portfolio.run.prepare')+'</div>';
    const setup=()=>{
      const form=document.getElementById('operation-form'),profile=form?.querySelector('[name="profile_id"]'),models=form?.querySelector('[name="models"]');
      if(!profile||!models)return;
      profile.addEventListener('change',()=>{
        const previous=models.value,options=modelOptions(profile.value);
        models.innerHTML=options.map(([value,title])=>'<option value="'+esc(value)+'">'+esc(title)+'</option>').join('');
        if(options.some(([value])=>value===previous))models.value=previous;
      });
    };
    openForm('Evaluate selected land cover','The saved portfolio identifies the original planning unit geometry for this scenario.',html,'Continue',async form=>{
      assertWorkspace(owner);
      const f=submitted(form),read=k=>String(f.get(k)||'').trim();
      const codes=read('from_codes').split(/[,\s]+/).filter(Boolean);
      if(!codes.length||codes.some(c=>!(/^-?\d+$/.test(c)))||!(/^-?\d+$/.test(read('to_code'))))throw new Error('Land-cover codes must be integers.');
      if(!read('grid_id')||!read('profile_id'))throw new Error('Choose a grid and model profile.');
      if(!modelOptions(read('profile_id')).some(([value])=>value===read('models')))throw new Error('Choose native models available on the selected grid and profile.');
      const payload={portfolio_id:id,title:read('title'),reason:read('reason'),from_codes:[...new Set(codes.map(Number))],to_code:Number(read('to_code')),grid_id:read('grid_id'),profile_id:read('profile_id'),models:read('models').split(',')};
      if(!payload.title||!payload.reason)throw new Error('Provide a scenario title and purpose.');
      return submitAction(read('operation'),payload);
    },setup);
  }
  function decisionForm(id){
    const r=record(id);if(!r)throw new Error('Open the saved portfolio before building its decision desk.');
    const context=r.context||{},runs=linkedRuns(r),owner=workspaceGeneration;
    const pairing=pairedControls(id,owner);
    const html='<div class="portfolio-workspace">'+note('Choose the completed native run of the selected combination. The decision desk compares actual whole-scenario nutrient and sediment exports against a compatible baseline.')+
      field('title','Report title',(r.title||'Portfolio')+' decision desk','required')+
      select('evaluation_run_id','Completed portfolio evaluation',[['','Choose a completed native run'],...runs.map(run=>[run.id,label(run)])],'')+
      pairing.html()+note('The completed evaluation and its matching baseline feed the whole-scenario comparison.')+'<details><summary>Project economics</summary>'+note('Enable economics when you can supply its basis, operating assumptions and dated source. You can build the physical comparison now and add economics in a later report.')+
      select('economics_basis','Cost basis',[['','Physical comparison'],['selected-parcel-capital','Selected planning unit estimates are capital cost'],['selected-parcel-annual-operating','Selected planning unit estimates are annual operating cost'],['whole-scenario','Supply complete whole-scenario costs']],'')+
      '<div class="pf-grid-two">'+field('capital','Whole-scenario capital USD','','type="number" min="0" step="0.01"','Required unless capital comes from the selected planning unit estimates.')+
      field('annual_operating','Annual operating USD','','type="number" min="0" step="0.01"','Required unless operating cost comes from the selected planning unit estimates. Enter 0 explicitly when appropriate.')+
      field('horizon_years','Evaluation horizon in years','','type="number" min="1" step="1"')+
      field('discount_rate','Annual discount rate','','type="number" min="0" max="1" step="any" placeholder="0.03"','Fraction; enter 0 explicitly for an undiscounted evaluation.')+'</div>'+
      field('source_title','Cost source title','','')+field('source_uri','Cost source URL or retained reference','','')+
      field('source_as_of','Cost source date','','type="date"')+field('economics_note','Cost assumptions','','')+'</details>'+
      '<details><summary>Decision targets</summary><div class="pf-grid-three">'+metrics.map(([key,title,units])=>field('target_'+key,title+' reduction ('+units+')','','type="number" min="0" step="any"')).join('')+
      '</div>'+note('Targets apply to whole-scenario reductions in the native comparison.')+'</details></div>';
    openForm('Build the decision desk','Use completed native results and the project cost assumptions.',html,'Build decision desk',async form=>{
      assertWorkspace(owner);
      const f=submitted(form),read=k=>String(f.get(k)||'').trim();
      const payload={portfolio_id:id,title:read('title'),evaluation_run_id:read('evaluation_run_id')};
      if(!payload.evaluation_run_id)throw new Error('Choose a completed native evaluation.');
      Object.assign(payload,pairing.selection(payload.evaluation_run_id));
      const basis=read('economics_basis');
      if(basis){
        const economics={basis,currency:'USD',source:{title:read('source_title'),uri:read('source_uri'),as_of:read('source_as_of')}};
        for(const key of ['horizon_years','discount_rate']){
          if(!read(key)||!Number.isFinite(Number(read(key))))throw new Error('Supply the evaluation horizon and discount rate explicitly.');
          economics[key]=Number(read(key));
        }
        if(economics.horizon_years<=0||economics.discount_rate<0)throw new Error('Use a positive horizon and a nonnegative discount rate.');
        const required=basis==='whole-scenario'?['capital','annual_operating']:basis==='selected-parcel-capital'?['annual_operating']:['capital'];
        for(const key of required){
          if(!read(key)||!Number.isFinite(Number(read(key)))||Number(read(key))<0)throw new Error('Supply the required capital and annual operating estimates explicitly.');
          economics[key]=Number(read(key));
        }
        if(!economics.source.title||!economics.source.uri||!economics.source.as_of)throw new Error('Supply the cost source title, reference and date.');
        if(read('economics_note'))economics.note=read('economics_note');
        payload.economics=economics;
      }
      const targets={};
      for(const [key]of metrics)if(read('target_'+key)){
        const v=Number(read('target_'+key));if(!Number.isFinite(v)||v<0)throw new Error('Reduction targets must be nonnegative.');
        targets[key]=v;
      }
      if(Object.keys(targets).length)payload.decision={targets};
      return submitAction('portfolio.decision.build',payload);
    },()=>{
      const form=document.getElementById('operation-form'),run=form.querySelector('[name="evaluation_run_id"]');
      pairing.mount(form);run.addEventListener('change',()=>pairing.load(run.value));pairing.load(run.value);
    });
  }
  function reportForm(id){
    const r=record(id);if(!r)throw new Error('Open the saved portfolio before building its report.');
    const runs=linkedRuns(r),owner=workspaceGeneration;
    let form=null;
    const compatible=(runId,baselineId)=>baselineId?records('comparisons').filter(c=>
      c.baseline_run_id===baselineId&&arr(c.alternatives).some(a=>a.run_id===runId)):[];
    const pairing=pairedControls(id,owner,(_,baselineId)=>{
      if(!form)return;
      const run=form.querySelector('[name="evaluation_run_id"]'),comparison=form.querySelector('[name="comparison_id"]');
      const options=[['','Build comparison from the selected original runs'],...compatible(run.value,baselineId).map(c=>[c.id,label(c)])];
      comparison.innerHTML=options.map(([v,t])=>'<option value="'+esc(v)+'">'+esc(t)+'</option>').join('');
      comparison.disabled=!run.value;
    });
    const html='<div class="portfolio-workspace">'+
      field('title','Report title',(r.title||'Portfolio')+' report','required')+
      select('evaluation_run_id','Report contents',[['','Planning portfolio and planning unit selection'],...runs.map(run=>[run.id,'Include native evaluation: '+label(run)])],'')+
      pairing.html()+select('comparison_id','Existing compatible comparison',[['','Build comparison from the selected original runs']],'')+
      note('The quantitative report retains the actual comparison baseline, evaluation, observed engine versions and original screening baseline separately.')+'</div>';
    const setup=()=>{
      form=document.getElementById('operation-form');
      const run=form.querySelector('[name="evaluation_run_id"]');
      pairing.mount(form);run.addEventListener('change',()=>pairing.load(run.value));pairing.load(run.value);
    };
    openForm('Build portfolio report','Choose planning contents or the completed native evaluation.',html,'Build report',async submittedForm=>{
      assertWorkspace(owner);
      const f=submitted(submittedForm),read=k=>String(f.get(k)||'').trim(),evaluation=read('evaluation_run_id');
      const payload={portfolio_id:id,title:read('title')};
      if(!payload.title)throw new Error('Provide a report title.');
      if(evaluation){
        if(!linkedRuns(r).some(run=>run.id===evaluation))throw new Error('Choose a completed evaluation of this portfolio on its original grid.');
        payload.evaluation_run_id=evaluation;Object.assign(payload,pairing.selection(evaluation));
        if(read('comparison_id')){
          if(!compatible(evaluation,payload.baseline_run_id).some(c=>c.id===read('comparison_id')))throw new Error('Choose the original comparison for this exact baseline and evaluation.');
          payload.comparison_id=read('comparison_id');
        }
      }
      return submitAction('portfolio.report.build',payload);
    },setup);
  }
  function loadSettings(r){
    const q=r.request||{},f=q.filters||{},c=q.constraints||{};
    Object.assign(draft,{title:q.title||r.title||draft.title,purpose:q.purpose||'',delivery_id:q.inventory_id?'inventory:'+q.inventory_id:q.delivery_id||'',
      kind:q.objective?.kind||'current-export',scenario_run_id:q.objective?.scenario_run_id||'',basis:q.objective?.basis||'total',
      min_coverage_fraction:String(f.min_coverage_fraction??0.95),max_protected_fraction:String(f.max_protected_fraction??1),
      source_water:f.source_water||'any',high_quality_water:f.high_quality_water||'any',
      budget_usd:String(c.budget_usd??''),area_ha:String(c.area_ha??''),max_count:String(c.max_count??''),
      include_feature_ids:arr(f.include_feature_ids).join(', '),exclude_feature_ids:arr(f.exclude_feature_ids).join(', '),
      solver:q.solver||'deterministic',cost_source:q.costs?encodeURIComponent(JSON.stringify([q.costs.source_collection_id,q.costs.source_id])):'',
      feature_id_field:q.costs?.feature_id_field||'feature_id',cost_field:q.costs?.cost_field||'cost_usd'});
    for(const [key]of metrics)draft[key]=String(q.weights?.[key]??0);
    preview=null;previewKey='';error='';
    if(root){const node=root;node.innerHTML=render();mount(node);node.querySelector('[name="title"]')?.focus();}
    else toast('Settings loaded. Open Conservation portfolios to adjust and recalculate.');
  }
  async function dispatch(element){
    const action=element?.dataset?.action||'',id=element?.dataset?.id||'';
    if(!action.startsWith('portfolio-'))return false;
    data();const dispatchGeneration=workspaceGeneration;
    try{
      const verb=action.slice(10);
      if(verb==='source'){sourceForm();return true;}
      if(verb==='inventory'){inventoryForm();return true;}
      if(verb==='analysis'){analysisForm(id);return true;}
      if(verb==='open'){await openItem('portfolios',id);return true;}
      if(verb==='report-open'){await openItem('portfolio_reports',id);return true;}
      if(verb==='edit'){const r=record(id);if(!r)throw new Error('Open the portfolio to load its settings.');loadSettings(r);return true;}
      if(verb==='run'){chooseNative(id);return true;}
      if(verb==='decision'){decisionForm(id);return true;}
      if(verb==='report'){reportForm(id);return true;}
      if(verb==='previous'||verb==='next'){
        tablePage=Math.max(0,tablePage+(verb==='next'?1:-1));
        const owner=element.closest?.('[data-portfolio-item]'),row=owner?record(owner.dataset.portfolioItem):preview;
        updateTables(owner||root,row);return true;
      }
      if(verb==='preview'||verb==='save'){
        if(busy)return true;
        const form=capture();if(form&&!form.reportValidity())return true;
        const payload=request(),owner=workspaceGeneration,taskEndpoint=endpoint('/api/task');
        if(verb==='save'&&!current())throw new Error('Recalculate the changed settings before saving this portfolio.');
        const fingerprint=JSON.stringify(payload);
        busy=true;error='';sync();
        try{
          const receipt=await executeAction('portfolio.'+verb,payload);
          const result=await completed(receipt,taskEndpoint,owner);
          data();if(owner!==workspaceGeneration)return true;
          const row=result?.portfolio||result?.analysis||result?.preview||result;
          if(verb==='preview'){
            if(!row||!row.selection||!Array.isArray(row.candidates))throw new Error('The completed task did not return a planning unit analysis. Open the task for its result.');
            preview=row;previewKey=fingerprint;tablePage=0;query='';filter='selected';
          }else{
            if(row?.id)cache.set(row.id,row);
            toast('Portfolio saved with its source inputs and selection.');
            if(row?.id)await openItem('portfolios',row.id);
          }
        }finally{data();if(owner===workspaceGeneration){busy=false;refreshResult();}}
        return true;
      }
      return false;
    }catch(e){data();if(dispatchGeneration!==workspaceGeneration)return true;error=e?.message||String(e);busy=false;refreshResult();toast(error);return true;}
  }
  return {render,mount,detach,dispatch,renderItem,mountItem};
}
