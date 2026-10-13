/* Saved native budget choices, exact plan navigation and retained source comparisons. */
const available = value => value !== null && value !== undefined;
const text = value => !available(value) ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const number = value => !available(value) ? 'Unavailable' : (Number(value)!==0&&Math.abs(Number(value))<0.000001?Number(value).toExponential(4):Number(value).toLocaleString(undefined,{maximumFractionDigits:6}));
const money = (cents,currency) => !available(cents) ? 'Unavailable' : (Number(cents)/100).toFixed(2)+' '+(currency||'');
const signed = value => !available(value) ? 'Unavailable' : (value>0?'+':'')+number(value);
function element(tag,value,className) {const node=document.createElement(tag);if(value!==undefined)node.textContent=text(value);if(className)node.className=className;return node;}
function button(label,action,handler) {const node=element('button',label);node.type='button';node.dataset.frontierAction=action;node.onclick=handler;return node;}
function setOptions(select,rows,value,label,placeholder,selected=select.value) {
  select.replaceChildren(new Option(placeholder,''));
  for(const row of rows)select.add(new Option(label(row),value(row)));
  if([...select.options].some(option=>option.value===selected))select.value=selected;
}
function details(title,value) {const node=element('details'),heading=element('summary',title),body=element('pre',JSON.stringify(value,null,2));node.append(heading,body);return node;}

export function attachMonitoringFrontiers(node,host,workspaceKey) {
  const panel=element('section',undefined,'monitoring-frontiers');
  panel.dataset.monitoringFrontiers='';
  panel.innerHTML='<h3>Saved budget choices</h3><p class="small">Reopen a completed budget frontier, choose a baseline and compare its original plans. Each plan keeps its own selected search areas, calendar and source objective.</p><div class="row"><label>Saved frontier<select data-frontier-picker><option value="">Choose a saved budget frontier</option></select></label><label>Saved comparison<select data-comparison-picker><option value="">Open a saved comparison</option></select></label></div><div class="row"><button type="button" data-frontier-refresh>Refresh saved choices</button></div><div data-frontier-editor hidden><div class="row"><label>Comparison title<input data-comparison-title value="Saved monitoring budget comparison"></label><label>Baseline plan<select data-frontier-baseline></select></label></div><div data-frontier-contexts></div><div class="row"><button type="button" data-frontier-preview>Preview comparison</button><button type="button" data-frontier-save>Save comparison</button><button type="button" data-frontier-export disabled>Download complete comparison</button><button type="button" data-frontier-transfer disabled>Transfer editable comparison</button></div></div><p data-frontier-status class="small" role="status"></p><div data-frontier-downloads class="downloads"></div><div data-frontier-result></div>';
  const q=selector=>panel.querySelector(selector);
  const state={frontiers:[],comparisons:[],contexts:[],campaigns:[],frontier:null,plans:[],network:null,comparison:null,contextByPlan:{},catalogReady:false,networkId:node.network?.id||null};
  let epoch=0,attached=false,refreshing=null,operation=0;
  const current=version=>attached&&epoch===version&&node.isConnected&&host.getState()?.workspace_key===workspaceKey;
  function status(message,error=false) {q('[data-frontier-status]').textContent=message;q('[data-frontier-status]').dataset.error=String(error);}
  function attach() {
    if(!node.shadowRoot.querySelector('link[data-monitoring-frontier-style]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./monitoring-frontiers.css',import.meta.url).href;link.dataset.monitoringFrontierStyle='';node.shadowRoot.append(link);
    }
    if(panel.parentNode!==node.$('frontier-results'))node.$('frontier-results').replaceChildren(panel);
  }
  function availability() {
    for(const control of panel.querySelectorAll('button,input,select,textarea'))control.disabled=Boolean(node.busy);
    const ready=Boolean(state.frontier);
    q('[data-frontier-editor]').hidden=!ready;
    q('[data-frontier-preview]').disabled=!ready||node.busy;
    q('[data-frontier-save]').disabled=!ready||node.busy;
    q('[data-frontier-export]').disabled=!state.comparison?.id||node.busy;
    q('[data-frontier-transfer]').disabled=!state.comparison?.id||node.busy;
  }
  function selection() {
    if(!state.frontier)throw Error('Open an original saved frontier.');
    const title=q('[data-comparison-title]').value.trim();
    if(!title)throw Error('Name the comparison before saving.');
    const baseline_plan_id=q('[data-frontier-baseline]').value;
    if(!state.plans.some(plan=>plan.id===baseline_plan_id))throw Error('Choose a baseline from this original frontier.');
    return {frontier_id:state.frontier.id,baseline_plan_id,title,context_ids:state.plans.map(plan=>state.contextByPlan[plan.id]).filter(Boolean)};
  }
  function invalidate() {
    operation++;state.comparison=null;q('[data-frontier-downloads]').replaceChildren();q('[data-frontier-result]').replaceChildren();q('[data-comparison-picker]').value='';
    status('Selection changed. Preview or save to calculate the comparison of these retained plans.');availability();
  }
  function catalogOptions() {
    setOptions(q('[data-frontier-picker]'),state.frontiers,row=>row.id,row=>row.title||row.id,'Choose a saved budget frontier',state.frontier?.id||'');
    setOptions(q('[data-comparison-picker]'),state.comparisons,row=>row.id,row=>row.title||row.id,'Open a saved comparison',state.comparison?.id||'');
  }
  function contextOptions() {
    const root=q('[data-frontier-contexts]');root.replaceChildren();
    if(!state.frontier)return;
    root.append(element('h4','Observed support for each saved plan'),element('p','Attach a saved context for the exact plan. Historical campaign revisions remain explicit. Matching stations inside a selected search area are candidate locations until a campaign binds them.','small'));
    for(const plan of state.plans){
      const row=element('div',undefined,'frontier-context-row'),label=element('label',plan.title),select=element('select');
      select.dataset.frontierContextPlan=plan.id;
      select.setAttribute('aria-label','Observed context for '+plan.title);
      const choices=state.contexts.filter(context=>context.network_id===state.frontier.network_id&&context.plan_id===plan.id);
      setOptions(select,choices,context=>context.id,context=>context.title+(context.campaign_revision_id?' · retained campaign revision '+context.campaign_revision_id.slice(0,10):' · saved plan'),'No observed context selected',state.contextByPlan[plan.id]||'');
      if(state.contextByPlan[plan.id]&&!choices.some(context=>context.id===state.contextByPlan[plan.id])){
        select.add(new Option('Retained selected context · '+state.contextByPlan[plan.id].slice(0,12),state.contextByPlan[plan.id]));select.value=state.contextByPlan[plan.id];
      }
      select.onchange=()=>{state.contextByPlan[plan.id]=select.value;invalidate();};
      label.append(select);row.append(label,button('Open plan and observed support','prepare-context',()=>openObserved(plan.id)));
      root.append(row);
    }
    availability();
  }
  async function refreshCatalog() {
    const version=epoch;
    const [frontiers,comparisons,contexts,campaigns]=await Promise.all([node.records('frontiers'),node.api('comparison.list'),node.api('context.list'),node.api('campaign.list')]);
    if(!current(version))return false;
    state.frontiers=frontiers;state.comparisons=comparisons.records;state.contexts=contexts.records;state.campaigns=campaigns;state.catalogReady=true;
    catalogOptions();contextOptions();availability();return true;
  }
  async function run(work,label) {
    if(node.busy)return false;
    const version=epoch,ticket=++operation;let succeeded=false;
    await node.run(async()=>{
      try {await work(()=>current(version)&&ticket===operation);succeeded=current(version)&&ticket===operation;}
      catch(error){if(current(version))status(error.message,true);throw error;}
    },label);
    if(current(version))availability();
    return succeeded;
  }
  async function loadFrontier(id,guard) {
    const frontier=await node.api('get',{kind:'frontiers',record_id:id});
    if(!guard())return null;
    if(frontier.id!==id||!Array.isArray(frontier.plan_ids)||!frontier.plan_ids.length)throw Error('The saved frontier has no retained plans.');
    const plans=[];
    for(const planId of frontier.plan_ids){
      const plan=await node.api('get',{kind:'plans',record_id:planId});
      if(!guard())return null;
      if(plan.id!==planId||plan.network_id!==frontier.network_id)throw Error('A retained plan no longer matches its original frontier.');
      plans.push(plan);
    }
    const network=await node.api('get',{kind:'networks',record_id:frontier.network_id});
    if(!guard())return null;
    return {frontier,plans,network};
  }
  function adoptFrontier(data) {
    state.frontier=data.frontier;state.plans=data.plans;state.network=data.network;
    state.networkId=data.network.id;
    if(node.network?.id!==data.network.id){
      node.network=data.network;node.plan=null;node.campaign=null;
      const select=node.$('networks');if(![...select.options].some(option=>option.value===data.network.id))select.add(new Option(data.network.title,data.network.id));
      select.value=data.network.id;node.$('plans').value='';node.$('campaigns').value='';node.$('downloads').replaceChildren();node.render();
    }
    attach();
    setOptions(q('[data-frontier-baseline]'),data.plans,plan=>plan.id,plan=>plan.title+' · '+plan.status,'Choose the comparison baseline',data.plans[0].id);
  }
  async function calculate(save,guard) {
    const chosen=selection(),result=await node.api(save?'comparison.prepare':'comparison.preview',chosen);
    if(!guard())return;
    if(result.frontier_id!==chosen.frontier_id||result.baseline_plan_id!==chosen.baseline_plan_id)throw Error('The returned comparison differs from the selected original plans.');
    state.comparison=result;q('[data-frontier-downloads]').replaceChildren();
    if(result.id){state.comparisons=state.comparisons.filter(row=>row.id!==result.id).concat(result);}
    catalogOptions();renderResult();availability();
    status(save?'Saved comparison. Reopen it from this library or from the full received Workspace.':'Preview uses the selected original plans and source contexts. Save it to retain and export this comparison.');
  }
  async function openFrontier(id) {
    return run(async guard=>{
      const data=await loadFrontier(id,guard);if(!data)return;
      adoptFrontier(data);state.contextByPlan={};state.comparison=null;
      q('[data-comparison-title]').value=data.frontier.title+' · budget comparison';
      if(!state.catalogReady)await refreshCatalog();if(!guard())return;
      contextOptions();catalogOptions();await calculate(false,guard);
    },'Opening the saved budget frontier and its original plans…');
  }
  async function openComparison(id) {
    return run(async guard=>{
      const record=await node.api('comparison.get',{comparison_id:id});if(!guard())return;
      const data=await loadFrontier(record.frontier_id,guard);if(!data)return;
      if(record.id!==id)throw Error('The saved comparison identity changed.');
      adoptFrontier(data);state.comparison=record;
      state.contextByPlan=Object.fromEntries(record.rows.filter(row=>row.observed).map(row=>[row.plan_id,row.observed.context_id]));
      q('[data-comparison-title]').value=record.title;q('[data-frontier-baseline]').value=record.baseline_plan_id;
      if(!state.catalogReady)await refreshCatalog();if(!guard())return;
      contextOptions();catalogOptions();q('[data-frontier-downloads]').replaceChildren();renderResult();availability();
      status('Opened the saved comparison with its exact retained plans and observed contexts.');
    },'Reopening the saved comparison…');
  }
  async function openPlan(planId) {
    return run(async guard=>{
      const plan=await node.api('get',{kind:'plans',record_id:planId});if(!guard())return;
      if(!state.plans.some(row=>row.id===plan.id)||plan.network_id!==state.frontier?.network_id)throw Error('Select a plan from the open frontier.');
      const network=state.network;node.plan=plan;node.network=network;node.campaign=null;
      node.loadConfig(plan.configuration);node.$('title').value=plan.title;
      node.$('plans').value=plan.id;node.$('networks').value=network.id;node.$('campaigns').value='';node.$('downloads').replaceChildren();node.render();
      await node.refreshSources();if(!guard())return;
      status('Opened '+plan.title+'. The native map, calendar, constraints and report controls now use this exact saved plan.');
      node.$('results').scrollIntoView({block:'start',behavior:'smooth'});
    },'Opening the original saved plan…');
  }
  async function openObserved(planId,contextId=null) {
    if(!await openPlan(planId)||!attached||host.getState()?.workspace_key!==workspaceKey)return;
    const target=node.shadowRoot.querySelector('.observed-context-panel');
    if(!target)throw Error('The original observed-support panel is unavailable.');
    if(contextId){
      const select=target.querySelector('[data-saved]');
      if(![...select.options].some(option=>option.value===contextId)){status('Refresh original observed support to reopen this retained context.',true);return;}
      select.value=contextId;await select.onchange();
    }
    target.scrollIntoView({block:'start',behavior:'smooth'});
    if(!contextId)status('Choose the original observational source and explicit station mapping in Observed support. Save its context, then refresh these choices and attach it to this plan.');
  }
  async function openCampaign(saved) {
    return run(async guard=>{
      const campaign=await node.api('campaign.get',{campaign_id:saved.campaign_id});if(!guard())return;
      if(campaign.revision.id!==saved.id||campaign.plan.id!==saved.plan_id)throw Error('This campaign advanced. Refresh saved choices and open its current exact plan.');
      const network=await node.api('get',{kind:'networks',record_id:campaign.plan.network_id});if(!guard())return;
      node.campaign=campaign;node.plan=campaign.plan;node.network=network;node.loadConfig(campaign.plan.configuration);
      node.$('title').value=campaign.revision.title;node.$('campaigns').value=saved.campaign_id;node.$('plans').value=campaign.plan.id;node.$('networks').value=network.id;
      node.$('downloads').replaceChildren();node.render();await node.refreshSources();if(!guard())return;
      status('Opened '+campaign.revision.title+' at revision '+campaign.revision.revision+'. Its plan is an exact member of this frontier.');
      node.$('results').scrollIntoView({block:'start',behavior:'smooth'});
    },'Opening the exact saved campaign and calendar…');
  }
  function addTable(root,headers,rows) {
    const wrapper=element('div',undefined,'table-wrap');
    wrapper.append(node.table(headers,rows));root.append(wrapper);
  }
  function renderResult() {
    const root=q('[data-frontier-result]');root.replaceChildren();
    const record=state.comparison;if(!record)return;
    root.append(element('h4',record.title),element('p',record.network_title+' · Source objective: '+text(record.weight_basis),'small'));
    addTable(root,['Budget','Status','Search areas','Total cost','Total covered weight','New covered weight','Change from baseline','Planned visits'],record.rows.map(row=>[
      money(row.budget_cents,row.currency),row.status,number(row.selected_sites),money(row.cost?.total_cents,row.currency),
      number(row.coverage?.covered_weight),number(row.new_covered_weight),signed(row.delta?.covered_weight),number(row.calendar?.visits)
    ]));
    root.append(element('p','Total coverage includes the existing-station baseline. New covered weight excludes it. Units and objective follow the original source; each budget was optimized independently.','small'));
    for(const row of record.rows){
      const section=element('section',undefined,'frontier-plan');section.dataset.frontierPlan=row.plan_id;
      section.append(element('h4',money(row.budget_cents,row.currency)+(row.is_baseline?' · comparison baseline':'')+' · '+row.status));
      section.append(element('p',row.coverage_meaning+' · '+text(row.weight_basis),'small'));
      const controls=element('div',undefined,'row');
      controls.append(button('Open original plan and calendar','open-plan',()=>openPlan(row.plan_id)));
      for(const campaign of state.campaigns.filter(c=>c.plan_id===row.plan_id))controls.append(button('Open '+campaign.title+' · revision '+campaign.revision,'open-campaign',()=>openCampaign(campaign)));
      if(row.observed)controls.append(button('Open retained observed support','open-context',()=>openObserved(row.plan_id,row.observed.context_id)));
      section.append(controls);
      const plan=state.plans.find(p=>p.id===row.plan_id);
      addTable(section,['Measure','Original value'],[
        ['Existing baseline coverage',number(row.coverage?.baseline_weight)],
        ['New coverage beyond existing stations',number(row.new_covered_weight)],
        ['Scenario maximum sites',text(plan?.configuration?.max_sites??row.max_sites)],
        ['Calendar site capacity',text(plan?.calendar_site_capacity??row.calendar_site_capacity)],
        ['Calendar period',row.calendar?[row.calendar.first_date,row.calendar.last_date].map(text).join(' to '):'Unavailable'],
        ['Program overhead',money(row.cost?.program_overhead_cents,row.currency)],
        ['Cost change from comparison baseline',row.delta?money(row.delta.total_cost_cents,row.currency):'Unavailable'],
      ]);
      if(row.delta){
        const changed=element('details');changed.append(element('summary','Selected search-area changes'));
        addTable(changed,['Change','Original search-area IDs'],[
          ['Added',row.delta.added_search_area_ids.join(', ')||'None'],
          ['Removed',row.delta.removed_search_area_ids.join(', ')||'None'],
          ['Retained',row.delta.retained_search_area_ids.join(', ')||'None']
        ]);section.append(changed);
      }
      if(row.observed){
        const observed=row.observed;
        section.append(element('h4','Retained observed support'));
        addTable(section,['Measure','Retained value'],[
          ['Source period',text(observed.source_period)],
          ['Candidate source stations in selected areas',number(observed.selected_search_area_source_stations)],
          ['Original activities in selected areas',number(observed.selected_search_area_activities)],
          ['Original observations in selected areas',number(observed.selected_search_area_observations)],
          ['Same source, mapping and flow scope as baseline',row.same_observed_source_as_baseline?'Yes':'No'],
          ['Retained campaign revision',observed.campaign_revision_id?'Recorded revision · '+observed.campaign_revision_id.slice(0,12):'Plan context']
        ]);
        section.append(element('p','These counts describe original observations in candidate search areas. Field locations and future visit dates remain those in the native campaign and its explicit station bindings.','small'));
        section.append(details('Observed source, mapping and retained revision',{source_binding:observed.source_binding,source_edition:observed.source_edition,station_mapping:observed.station_mapping,flow_scope:observed.flow_scope,campaign_id:observed.campaign_id,campaign_revision_id:observed.campaign_revision_id,summary:observed.summary,interpretation:observed.interpretation}));
      }else section.append(element('p','No observed context is attached to this exact plan. Use Open plan and observed support above to prepare one from the retained original source.','small'));
      if((row.diagnostics||[]).length||(row.warnings||[]).length)section.append(details('Original solver diagnostics',{solver:row.solver,diagnostics:row.diagnostics,warnings:row.warnings}));
      section.append(details('Original plan and configuration',plan));root.append(section);
    }
    root.append(details('Comparison source details and complete retained values',record));availability();
  }
  async function exportComparison() {
    return run(async guard=>{
      const identity=state.comparison?.id;if(!identity)throw Error('Save or reopen this comparison first.');
      const result=await node.api('comparison.export',{comparison_id:identity});if(!guard()||state.comparison?.id!==identity)return;
      const url=new URL(result.download_url,document.baseURI);
      if(url.origin!==location.origin)throw Error('The original comparison download has an unexpected origin.');
      const link=element('a','Complete comparison · '+number(result.bytes)+' bytes');link.href=url.href;link.download='';link.dataset.frontierDownload='';
      q('[data-frontier-downloads]').replaceChildren(link);
      status('The saved HTML report, CSV, native plans and full source/context family are ready. Full Workspace backup retains the editable saved comparison.');
    },'Preparing the complete original comparison package…');
  }
  async function transferComparison() {
    return run(async guard=>{
      const chosen=state.comparison;
      if(!chosen?.id)throw Error('Save or reopen the original comparison before transferring it.');
      if(typeof host.openDesk!=='function')throw Error('Use the current operator Study transfer desk.');
      const identity=chosen.id;
      const retained=await node.api('comparison.get',{comparison_id:identity});
      if(!guard()||state.comparison!==chosen)return;
      if(retained.id!==identity||retained.project_id!==chosen.project_id||
        retained.frontier_id!==chosen.frontier_id||
        retained.baseline_plan_id!==chosen.baseline_plan_id||
        JSON.stringify(retained.selection?.context_ids)!==JSON.stringify(chosen.selection?.context_ids))
        throw Error('The saved comparison returned a different original scientific selection.');
      await host.openDesk('study-transfer','openForStudies',{workspace_key:workspaceKey,roots:[{
        kind:'monitoring_frontier_comparisons',id:identity,
        title:retained.title||'Saved Monitoring budget choices',state:'Saved'
      }]});
      if(guard()&&state.comparison===chosen)
        status('Original comparison selected for editable transfer, including its baseline, saved plans and exact per-plan observed contexts.');
    },'Opening the original saved comparison in Study transfer…');
  }
  q('[data-frontier-picker]').onchange=()=>{const id=q('[data-frontier-picker]').value;if(id)openFrontier(id);};
  q('[data-comparison-picker]').onchange=()=>{const id=q('[data-comparison-picker]').value;if(id)openComparison(id);};
  q('[data-frontier-refresh]').onclick=()=>run(async guard=>{if(await refreshCatalog()&&guard()){if(state.comparison)renderResult();status('Saved frontiers, comparisons, exact campaign heads and observed contexts refreshed. Your comparison choices are preserved.');}},'Refreshing saved Monitoring records…');
  q('[data-comparison-title]').oninput=invalidate;q('[data-frontier-baseline]').onchange=invalidate;
  q('[data-frontier-preview]').onclick=()=>run(guard=>calculate(false,guard),'Reading original plans and observed contexts…');
  q('[data-frontier-save]').onclick=()=>run(guard=>calculate(true,guard),'Saving the comparison of original Monitoring plans…');
  q('[data-frontier-export]').onclick=exportComparison;
  q('[data-frontier-transfer]').onclick=transferComparison;
  const originalRender=node.render.bind(node);
  node.render=function(){originalRender();networkChanged(node.network?.id||null);};
  node.$('frontier').onclick=()=>run(async guard=>{
    if(!node.network)throw Error('Select a retained network first.');
    const request={network_id:node.network.id,configuration:node.configuration(),budgets:node.$('budgets').value.split(',').map(value=>value.trim()).filter(Boolean)};
    const result=await node.api('frontier',request);if(!guard())return;
    await node.refresh();if(!guard())return;
    const data=await loadFrontier(result.id,guard);if(!data)return;
    adoptFrontier(data);state.contextByPlan={};state.comparison=null;q('[data-comparison-title]').value=data.frontier.title+' · budget comparison';
    await refreshCatalog();if(!guard())return;contextOptions();await calculate(false,guard);
  },'Solving each requested budget with the original native design engine…');
  function networkChanged(id) {
    attach();
    if(id===state.networkId)return;
    epoch++;state.networkId=id;state.frontier=null;state.plans=[];state.network=null;state.comparison=null;state.contextByPlan={};
    q('[data-frontier-result]').replaceChildren();q('[data-frontier-downloads]').replaceChildren();catalogOptions();contextOptions();availability();status('Choose a saved frontier for this workspace.');
  }
  async function mount() {
    attached=true;attach();networkChanged(node.network?.id||null);availability();
    if(!state.catalogReady)await update();
  }
  async function update() {
    attach();if(!attached||node.busy)return;
    if(refreshing)return refreshing;
    const promise=refreshCatalog().catch(error=>{if(attached&&host.getState()?.workspace_key===workspaceKey)status(error.message,true);});
    refreshing=promise;
    try {await promise;}finally{if(refreshing===promise)refreshing=null;}
  }
  function detach(){attached=false;epoch++;refreshing=null;}
  return {mount,update,detach,networkChanged,openFrontier,openComparison,transferComparison};
}
