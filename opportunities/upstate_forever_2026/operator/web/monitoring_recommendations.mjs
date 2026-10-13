/* Source-bound sampling priorities. Original Workspace, queue and Monitoring design. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value,null,2);
const text=value=>value===null||value===undefined?'Unknown':Array.isArray(value)?value.join('; '):typeof value==='object'?JSON.stringify(value):String(value);
const terminal=new Set(['complete','failed','cancelled']);
const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ID=/^[a-f0-9]{64}$/;
const memory=new Map();
function stored(key){try{return JSON.parse(sessionStorage.getItem(key)||'null')||memory.get(key)||null;}catch{return memory.get(key)||null;}}
function keep(key,value){if(value===null){memory.delete(key);try{sessionStorage.removeItem(key);}catch{}}else{memory.set(key,copy(value));try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}}
function options(rows,value,label,selected,placeholder){return '<option value="">'+esc(placeholder)+'</option>'+rows.map(row=>'<option value="'+esc(value(row))+'"'+(value(row)===selected?' selected':'')+'>'+esc(label(row))+'</option>').join('');}
function table(headings,rows){return '<div class="sampling-table"><table><thead><tr>'+headings.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(text(cell))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function detail(title,value){return '<details><summary>'+esc(title)+'</summary><pre>'+esc(json(value))+'</pre></details>';}
function field(label,name,value,{target=null,type='text',min=null,max=null,placeholder='',wide=false}={}){return '<label'+(wide?' class="sampling-wide"':'')+'>'+esc(label)+'<input '+(target===null?'data-field="'+esc(name)+'"':'data-target="'+esc(target)+'" data-target-field="'+esc(name)+'"')+' type="'+type+'" value="'+esc(value)+'"'+(min!==null?' min="'+min+'"':'')+(max!==null?' max="'+max+'"':'')+' placeholder="'+esc(placeholder)+'"></label>';}
function textarea(label,name,value,{target=null,wide=true}={}){return '<label'+(wide?' class="sampling-wide"':'')+'>'+esc(label)+'<textarea '+(target===null?'data-field="'+esc(name)+'"':'data-target="'+esc(target)+'" data-target-field="'+esc(name)+'"')+' rows="3">'+esc(value)+'</textarea></label>';}
function decimal(value,label){const raw=String(value??'').trim();if(!raw)return null;if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw))throw Error(label+' needs a nonnegative decimal, or leave it blank for unknown.');return raw;}
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){const raw=String(value??'').trim();if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw Error(label+' needs a whole number from '+min+' to '+max+'.');return Number(raw);}
export function samplingSelection(draft){
  if(!draft||!ID.test(draft.context_id||''))throw Error('Choose a saved observational context.');
  const selection=copy(draft);
  for(const key of ['title','operator','planning_basis'])if(!String(selection[key]||'').trim())throw Error('Complete '+key.replaceAll('_',' ')+'.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(selection.evidence_start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(selection.evidence_end||'')||selection.evidence_end<selection.evidence_start)throw Error('Choose an ordered historical evidence window.');
  if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(selection.recorded_at||'')||!Number.isFinite(Date.parse(selection.recorded_at)))throw Error('Recording time needs a valid ISO timestamp with a timezone.');
  if(!Array.isArray(selection.targets)||!selection.targets.length)throw Error('Add at least one explicit sampling target.');
  selection.targets=selection.targets.map((row,index)=>{
    const label='Target '+(index+1);if(!row.station_id||!row.cohort_id)throw Error(label+': choose an original station and an exact analyte cohort.');
    if(!Array.isArray(row.months)||!row.months.length)throw Error(label+': select the months to review.');
    return {...row,months:[...row.months].sort((a,b)=>a-b),minimum_dates_per_month:integer(row.minimum_dates_per_month,label+' historical date goal'),proposed_visits:integer(row.proposed_visits,label+' proposed visits'),priority:integer(row.priority,label+' priority',1,5),reporting_limit:decimal(row.reporting_limit,label+' reporting limit'),setup_cost:decimal(row.setup_cost,label+' setup cost'),per_visit_cost:decimal(row.per_visit_cost,label+' visit cost'),included:Boolean(row.included)};
  });
  return selection;
}
function newDraft(context){return {context_id:context.context_id,title:'Sampling priorities',operator:'',recorded_at:new Date().toISOString(),evidence_start:'',evidence_end:'',notes:'',planning_basis:'',targets:[]};}
function designDraft(configuration=null){const c=configuration||{},calendar=c.calendar||{},cost=c.default_cost||{};return {title:'',budget:c.budget??'',max_sites:c.max_sites??'',program_overhead:c.program_overhead??'',coverage_mode:c.coverage_mode||'local',setup:cost.setup??'',per_visit:cost.per_visit??'',cost_basis:cost.basis||'',start_date:calendar.start_date||'',end_date:calendar.end_date||'',interval_days:calendar.interval_days??'',round_window_days:calendar.round_window_days??'',crews:calendar.crews??'',visit_minutes:calendar.visit_minutes??'',travel_buffer_minutes:calendar.travel_buffer_minutes??'',advanced:json(c)};}
function blankTarget(){return {id:'target-'+crypto.randomUUID(),station_id:'',cohort_id:'',months:[],minimum_dates_per_month:'',proposed_visits:'',reporting_limit:null,reporting_limit_basis:'',flow_goal:'any',reason:'',priority:3,included:true,setup_cost:null,per_visit_cost:null,cost_basis:'',sensitivity_basis:''};}
function money(cents){return cents===null||cents===undefined?'Unknown':(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});}
export function attachMonitoringRecommendations(host){
  const {getState,api,endpoint,showTask,toast,openDesk}=host;
  const states=new Map();let root=null,active=null,generation=0,request=0;
  const workspace=()=>getState()?.workspace_key||null;
  const current=(state,version=generation)=>Boolean(root&&active===state&&workspace()===state.key&&version===generation);
  const storageKey=state=>'eco-sampling-request:'+state.key;
  function stateFor(key){if(!states.has(key))states.set(key,{key,catalog:{contexts:[],recommendations:[]},context:null,draft:null,saved:null,preview:null,dirty:false,designDirty:false,busy:false,busyOwner:null,filters:{station:'',gapsOnly:false},status:'Choose a retained observational context.',error:false,pending:stored('eco-sampling-request:'+key),lastTask:null,design:null,downloads:[],designDraft:designDraft()});return states.get(key);}
  function status(state,message,error=false){state.status=message;state.error=error;if(current(state)){const node=root.querySelector('[data-status]');if(node){node.textContent=message;node.classList.toggle('sampling-error',error);}}}
  function fail(state,error){status(state,error?.message||String(error),true);if(current(state))toast?.(state.status);}
  function changed(state){state.dirty=true;state.preview=null;state.downloads=[];status(state,'Unsaved changes. Preview the current targets, then save a new edition.');const result=root?.querySelector('[data-result]');if(current(state)&&result)result.innerHTML=results(state);updateActions(state);}
  function read(state,action,payload={}){return api('/api/monitoring-recommendations?'+new URLSearchParams({workspace:state.key,action,payload:JSON.stringify(payload)})).then(value=>{if(value.workspace_key&&value.workspace_key!==state.key)throw Error('The response belongs to another Workspace.');return value;});}
  function selectCohort(context,id){return (context?.cohorts||[]).find(row=>row.id===id);}
  function targetCard(state,row,index){
    const stationRows=state.context?.stations||[],cohorts=state.context?.cohorts||[];
    const attr='data-target="'+esc(row.id)+'"';
    return '<details class="sampling-target" open><summary>Target '+(index+1)+' · '+esc(row.station_id||'Choose station')+' · '+esc(selectCohort(state.context,row.cohort_id)?.label||'Choose analyte cohort')+'</summary><div class="sampling-grid">'+
      '<label>Original source station<select '+attr+' data-target-field="station_id">'+options(stationRows,r=>r.source_station_id,r=>r.source_station_id+(r.network_station_id?' · network '+r.network_station_id:' · not bound to network'),row.station_id,'Choose original station')+'</select></label>'+
      '<label>Exact analyte cohort<select '+attr+' data-target-field="cohort_id">'+options(cohorts,r=>r.id,r=>r.label+' · '+r.observation_count+' observations',row.cohort_id,'Choose retained analyte, method and unit')+'</select></label>'+
      '<fieldset class="sampling-months sampling-wide"><legend>Historical months to review within the evidence window</legend>'+monthNames.map((name,i)=>'<label><input type="checkbox" '+attr+' data-month="'+(i+1)+'"'+(row.months.includes(i+1)?' checked':'')+'>'+name+'</label>').join('')+'</fieldset>'+
      field('Historical distinct-date goal per selected month','minimum_dates_per_month',row.minimum_dates_per_month,{target:row.id,type:'number',min:0})+
      field('Future visits proposed by the operator','proposed_visits',row.proposed_visits,{target:row.id,type:'number',min:0})+
      '<label>Flow objective<select '+attr+' data-target-field="flow_goal"><option value="any"'+(row.flow_goal==='any'?' selected':'')+'>Any flow condition</option><option value="high_flow"'+(row.flow_goal==='high_flow'?' selected':'')+'>High flow at the same eligible station</option></select></label>'+
      '<label>Priority<select '+attr+' data-target-field="priority">'+[1,2,3,4,5].map(n=>'<option value="'+n+'"'+(Number(row.priority)===n?' selected':'')+'>'+n+(n===1?' · highest':'')+'</option>').join('')+'</select></label>'+
      field('Proposed reporting limit · original cohort unit','reporting_limit',row.reporting_limit,{target:row.id,placeholder:'Unknown if blank'})+
      textarea('Reporting-limit rationale / laboratory basis','reporting_limit_basis',row.reporting_limit_basis,{target:row.id,wide:false})+
      field('Setup cost (USD)','setup_cost',row.setup_cost,{target:row.id,placeholder:'Unknown if blank; 0 is explicit'})+
      field('Cost per proposed visit (USD)','per_visit_cost',row.per_visit_cost,{target:row.id,placeholder:'Unknown if blank; 0 is explicit'})+
      textarea('Cost basis','cost_basis',row.cost_basis,{target:row.id,wide:false})+
      textarea('Sensitivity basis, if supplied by the operator','sensitivity_basis',row.sensitivity_basis,{target:row.id,wide:false})+
      textarea('Why this station, season and analyte need attention','reason',row.reason,{target:row.id})+
      '<label class="sampling-check"><input type="checkbox" '+attr+' data-target-field="included"'+(row.included?' checked':'')+'>Include in the proposed programme</label><button type="button" data-action="remove-target" data-id="'+esc(row.id)+'">Remove this draft target</button></div></details>';
  }
  function contextPanel(state){
    const c=state.context;if(!c)return '<p>Choose a saved context. Its original station matches, analyte cohorts and evidence remain attached to the recommendation.</p>';
    return '<p><strong>'+esc(c.stations?.length||0)+' original stations · '+esc(c.cohorts?.length||0)+' distinct analyte cohorts</strong></p><p>Declared original source period: '+esc(c.source_period?.start_inclusive||'Unknown')+' through '+esc(c.source_period?.end_inclusive||'Unknown')+'.</p><button type="button" data-action="use-period">Use the complete declared evidence window</button>'+
      '<p class="sampling-note">Cohorts retain the original method, unit, fraction, result-value type and speciation. A chosen cohort may have no observations at the chosen station.</p>'+
      '<details><summary>Original station bindings and support</summary>'+table(['Source station','Network station','Catchment','Match','Observations','Sampling dates'],(c.stations||[]).map(r=>[r.source_station_id,r.network_station_id,r.catchment_id,r.match,r.observations,r.sampling_dates]))+'</details>'+
      detail('Complete context identity, original period and cohort definitions',c);
  }
  function results(state){
    const value=state.preview||state.saved;if(!value)return '<p>Preview your explicit targets to inspect the historical gaps, entered costs and network handoff.</p>';
    return resultView(value,Boolean(state.preview),state);
  }
  function resultView(value,preview,state){
    const budget=value.budget||{},rows=value.targets||[],allGaps=value.gaps||[];
    const stations=[...new Set(allGaps.map(r=>r.station_id))];
    const gaps=allGaps.filter(r=>(!state.filters.station||r.station_id===state.filters.station)&&(!state.filters.gapsOnly||r.date_gap>0));
    const required=value.handoff?.required_catchment_ids||[],unbound=value.handoff?.unbound_target_ids||[],conflicts=value.handoff?.station_binding_conflicts||[];
    return '<h3>'+(preview?'3. Current target preview':'3. Saved recommendation')+'</h3><p><strong>'+esc(value.title||value.selection?.title||'Sampling priorities')+'</strong>'+(value.id?' · revision '+esc(value.revision)+' · '+esc(value.id):'')+'</p>'+
      '<div class="sampling-metrics"><p><strong>'+esc(money(budget.known_total_cents))+'</strong><span>Known entered programme cost</span></p><p><strong>'+esc(budget.complete?'Complete':'Incomplete')+'</strong><span>'+esc((budget.unknown_target_ids||[]).length)+' included targets with unknown costs</span></p><p><strong>'+esc(value.summary?.month_gaps??0)+'</strong><span>Selected month rows below the date goal</span></p></div>'+
      '<p class="sampling-note">Historical date gaps apply to the complete selected evidence window. Future visits and reporting limits are explicit operator proposals. Neither establishes a predicted ecological response. '+esc(budget.basis||'')+'</p>'+
      table(['Target / source station','Exact analyte cohort','Included / priority','Historical observations / dates','Proposed future visits','Entered cost'],rows.map(r=>[r.target_id+' / '+r.target.station_id,r.cohort.label,(r.target.included?'Included':'Excluded')+' / '+r.target.priority,r.evidence.observations+' observations / '+r.evidence.distinct_dates+' dates',r.target.proposed_visits,money(r.cost.total_cents)]))+
      '<h4>Historical monthly gaps</h4><div class="sampling-actions"><label>Source station<select data-gap-station>'+options(stations,r=>r,r=>r,state.filters.station,'All selected stations')+'</select></label><label class="sampling-check"><input type="checkbox" data-gap-only'+(state.filters.gapsOnly?' checked':'')+'>Show unmet date goals only</label></div><p>'+gaps.length+' of '+allGaps.length+' month rows. View filters do not change the retained targets or complete export.</p>'+
      table(['Target','Source station','Month','Distinct historical dates','Operator goal','Date gap','Years with evidence'],gaps.map(r=>[r.target_id,r.station_id,monthNames[r.month-1],r.observed_dates,r.minimum_dates,r.date_gap,r.years_with_observations]))+
      '<h4>Target rationale and original evidence</h4>'+rows.map(r=>{
        const evidence=r.evidence,originals=evidence.original_rows||(value.context_snapshot?.observations||[]).filter(o=>(evidence.observation_ids||[]).includes(o.observation_id));
        return '<details><summary>'+esc(r.target.station_id+' · '+r.cohort.label)+' · '+esc(evidence.observations)+' original observations</summary>'+
          '<p><strong>Rationale:</strong> '+esc(r.target.reason)+'</p><p><strong>Proposed reporting limit:</strong> '+esc(r.target.reporting_limit===null?'Unknown':r.target.reporting_limit)+' · '+esc(r.cohort.fields?.unit?.present?text(r.cohort.fields.unit.value):'Original unit absent')+'</p><p>'+esc(r.target.reporting_limit_basis)+'</p>'+
          '<p><strong>High-flow support:</strong> '+(evidence.flow_scope_eligible?'Original flow scope applies to this exact station.':'No eligible same-station flow scope; support is unknown.')+'</p>'+
          table(['Original episode','Start','End','Selected routine-sample dates'],(evidence.high_flow_episodes||[]).map(e=>[e.event_id,e.start_date,e.end_date,e.sampled_dates]))+
          table(['Original observation','Retained limit','Original limit unit','Above proposed limit'],(evidence.reporting_limits||[]).map(r=>[r.observation_id,r.value,r.unit,r.above_target===null?'No limit proposed':r.above_target?'Yes':'No']))+
          '<p>'+esc((evidence.unknown_limit_observation_ids||[]).length)+' observations with unknown limits; '+esc((evidence.incompatible_limit_unit_observation_ids||[]).length)+' with incompatible or unspecified limit units. No conversion is inferred.</p>'+
          '<ul>'+(r.warnings||[]).map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>'+
          detail('All original observation fields, qualifiers and source IDs ('+originals.length+')',originals)+detail('Complete target and exact supporting IDs',r)+'</details>';
      }).join('')+
      '<h4>Handoff to the original Monitoring design</h4><p>'+required.length+' required catchments · '+unbound.length+' unbound targets · '+conflicts.length+' catchments with conflicting station bindings.</p>'+
      detail('Exact catchments, station bindings and field/laboratory requirements',value.handoff)+
      '<ul>'+(value.interpretation||[]).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>'+
      detail('Complete immutable recommendation and original context',value);
  }
  function designPanel(state){
    const d=state.designDraft,designs=state.saved?.saved_designs||[],required=state.saved?.handoff?.required_catchment_ids||[];
    return '<details><summary>Prepare an original Monitoring design from the saved edition</summary><p>Review the original design configuration. Station requirements come from the saved recommendation; unbound or conflicting station assignments must be resolved before preparation. Native budget and calendar costs are reviewed separately from the itemized target estimate.</p><p>Required catchments from the saved edition: '+esc(required.join(', ')||'None selected')+'. These exact IDs are included in the submitted design configuration.</p><div class="sampling-grid">'+
      ['title','budget','max_sites','program_overhead','setup','per_visit','cost_basis','start_date','end_date','interval_days','round_window_days','crews','visit_minutes','travel_buffer_minutes'].map(key=>{
        const labels={title:'Design title',budget:'Programme budget (USD)',max_sites:'Maximum sites',program_overhead:'Programme overhead (USD)',setup:'Default setup cost per site (USD)',per_visit:'Default cost per visit (USD)',cost_basis:'Native design cost basis',start_date:'First round date',end_date:'Final round date',interval_days:'Days between rounds',round_window_days:'Days to finish each round',crews:'Field crews',visit_minutes:'Minutes per visit',travel_buffer_minutes:'Travel allowance per visit (minutes)'};
        return '<label>'+labels[key]+'<input data-design="'+key+'" value="'+esc(d[key])+'"'+(['start_date','end_date'].includes(key)?' type="date"':'')+'></label>';
      }).join('')+
      '<label>Coverage basis<select data-design="coverage_mode"><option value="local"'+(d.coverage_mode==='local'?' selected':'')+'>Local catchment presence</option><option value="outlet_context"'+(d.coverage_mode==='outlet_context'?' selected':'')+'>Upstream context at proposed outlets</option></select></label>'+
      '<label class="sampling-wide">Additional original design configuration (JSON object; visible fields above take precedence)<textarea rows="5" data-design="advanced">'+esc(d.advanced)+'</textarea></label></div><button type="button" data-action="design">Prepare Monitoring design</button>'+
      designs.map(item=>'<p>Saved design '+esc(item.plan_id)+' · '+esc(item.status)+'</p><button type="button" data-action="open-design" data-id="'+esc(item.plan_id)+'">Open saved design and calendar</button>').join('')+
      (state.design?'<p>Prepared design '+esc(state.design.plan_id||state.design.id||'')+' · '+esc(state.design.status)+'</p>'+table(['Target','Catchment','Proposed visits','Calendar visits in selected months','Request met'],(state.design.target_calendar||[]).map(r=>[r.target_id,r.catchment_id,r.proposed_visits,r.calendar_visits_in_selected_months,r.calendar_count_meets_request?'Yes':'No']))+detail('Original design costs, bindings and field requirements',state.design)+'<button type="button" data-action="open-design" data-id="'+esc(state.design.plan_id)+'">Open design and field calendar</button>':'')+'</details>';
  }
  function render(state){
    if(!current(state))return;
    const d=state.draft;
    root.innerHTML='<section class="sampling-priorities" aria-label="Sampling priorities"><header><div><h2>Sampling priorities</h2><p>Original observations · explicit targets · retained Monitoring designs</p></div><button type="button" data-action="refresh">Refresh saved work</button></header>'+
      '<p class="sampling-intro">Use a saved observational context to review station, season, analyte and high-flow gaps. Enter the sampling targets and costs you can justify, save an immutable edition, then prepare the existing Monitoring design.</p>'+
      '<p data-status role="status" aria-live="polite" class="'+(state.error?'sampling-error':'')+'">'+esc(state.status)+'</p>'+
      '<div class="sampling-toolbar"><label>Saved observational context<select data-context>'+options(state.catalog.contexts||[],r=>r.id,r=>(r.title||r.id)+' · '+r.id.slice(0,12),state.context?.context_id,'Choose original observations')+'</select></label><label>Saved sampling edition<select data-saved>'+options(state.catalog.recommendations||[],r=>r.id||r.recommendation_id,r=>(r.title||r.id||r.recommendation_id)+' · revision '+(r.revision||1)+' · '+(r.id||r.recommendation_id).slice(0,12),state.saved?.id||state.saved?.recommendation_id,'Choose a retained edition')+'</select></label><button type="button" data-action="open-saved">Open saved edition</button></div>'+
      '<div class="sampling-actions"><button type="button" data-action="open-context">Open original context in Monitoring</button><button type="button" data-action="new">Start a new recommendation</button></div>'+
      '<section class="sampling-card"><h3>1. Original evidence</h3>'+contextPanel(state)+'</section>'+
      (d?'<fieldset class="sampling-card sampling-editor"><legend>2. Explicit sampling targets</legend><div class="sampling-grid">'+
        field('Recommendation title','title',d.title)+field('Responsible operator','operator',d.operator)+
        field('Recorded at · ISO timestamp with timezone','recorded_at',d.recorded_at,{wide:true})+
        field('Historical evidence begins','evidence_start',d.evidence_start,{type:'date'})+field('Historical evidence ends','evidence_end',d.evidence_end,{type:'date'})+
        textarea('Planning basis','planning_basis',d.planning_basis)+textarea('Notes','notes',d.notes)+
        '</div><p class="sampling-note">Count distinct sampling dates across this window in each selected calendar month. Enter future visits separately; blank costs and limits remain unknown.</p><div data-targets>'+d.targets.map((r,i)=>targetCard(state,r,i)).join('')+'</div><button type="button" data-action="add-target">Add sampling target</button></fieldset>':'')+
      '<div class="sampling-actions"><button type="button" data-action="preview">Preview gaps and costs</button><button type="button" data-action="prepare">'+(state.saved?'Save new revision':'Save recommendation')+'</button><button type="button" data-action="export">Export saved edition and original sources</button><button type="button" data-action="transfer">Export editable study</button></div>'+(state.saved?.parent_id?'<p>This is revision '+esc(state.saved.revision)+'. <button type="button" data-action="open-parent">Open original parent edition</button></p>':'')+''+
      '<div class="sampling-queue">'+(state.pending?'<p>Original '+esc(state.pending.kind)+' request · '+esc(state.pending.state||'awaiting acknowledgement')+'</p><button type="button" data-action="resume">Resume original request</button>':'')+(state.pending?.task_id||(!state.pending&&state.lastTask)?'<button type="button" data-action="task">Open retained operation</button>':'')+'</div>'+
      '<section class="sampling-card" data-result>'+results(state)+'</section>'+
      '<section class="sampling-card">'+designPanel(state)+'</section>'+
      '<div class="sampling-downloads" data-downloads></div></section>';
    for(const item of state.downloads)appendDownload(state,item);
    root.oninput=event=>input(state,event);
    root.onchange=event=>change(state,event);
    root.onclick=event=>{const button=event.target.closest('[data-action]');if(button&&root.contains(button)){event.preventDefault();return act(state,button.dataset.action,button.dataset.id).catch(error=>{if(current(state))fail(state,error);});}};
    updateActions(state);
  }
  function updateActions(state){
    if(!current(state))return;
    const blocked=state.busy||Boolean(state.pending&&!terminal.has(state.pending.state));
    for(const node of root.querySelectorAll('input,textarea,select,.sampling-editor button'))node.disabled=blocked;
    for(const node of root.querySelectorAll('[data-action]')){
      const a=node.dataset.action;
      node.disabled=(state.busy&&a!=='task')||(Boolean(state.pending&&!terminal.has(state.pending.state))&&!['resume','task'].includes(a))||
        (['preview','prepare','add-target'].includes(a)&&!state.draft)||
        (['design','export','transfer'].includes(a)&&!state.saved)||
        (['open-context','use-period'].includes(a)&&!state.context)||
        (a==='open-design'&&!node.dataset.id);
    }
  }
  function input(state,event){
    if(!current(state))return;const node=event.target;
    if(node.dataset.field&&state.draft){state.draft[node.dataset.field]=node.value;changed(state);}
    if(node.dataset.targetField&&state.draft){const row=state.draft.targets.find(r=>r.id===node.dataset.target);if(row){row[node.dataset.targetField]=node.type==='checkbox'?node.checked:node.value;changed(state);}}
    if(node.dataset.month&&state.draft){const row=state.draft.targets.find(r=>r.id===node.dataset.target),month=Number(node.dataset.month);if(row){row.months=node.checked?[...new Set([...row.months,month])]:row.months.filter(n=>n!==month);changed(state);}}
    if(node.dataset.design){state.designDraft[node.dataset.design]=node.value;state.designDirty=true;status(state,'Unsaved Monitoring design configuration. Prepare a design to retain these exact choices.');}
  }
  function change(state,event){
    if(event.target.matches('[data-gap-station],[data-gap-only]')){if(event.target.matches('[data-gap-station]'))state.filters.station=event.target.value;else state.filters.gapsOnly=event.target.checked;root.querySelector('[data-result]').innerHTML=results(state);return;}
    if(event.target.matches('[data-context]')){const id=event.target.value;if(id)return loadContext(state,id).catch(error=>{if(current(state))fail(state,error);});}
    else if(event.target.dataset.targetField||event.target.dataset.month||event.target.dataset.design)input(state,event);
  }
  async function guarded(state,fn){const version=generation,ticket=++request,owner={};state.busyOwner=owner;state.busy=true;updateActions(state);try{await fn(()=>current(state,version)&&ticket===request);}catch(error){if(current(state,version)&&ticket===request)fail(state,error);}finally{if(state.busyOwner===owner){state.busy=false;state.busyOwner=null;if(current(state,version))render(state);}}}
  function discard(state){return !(state.dirty||state.designDirty)||confirm('Replace the unsaved sampling targets or design configuration with the selected saved evidence?');}
  async function refresh(state){await guarded(state,async valid=>{const value=await read(state,'catalog');if(!valid())return;state.catalog=value;status(state,(value.contexts||[]).length+' saved observation contexts · '+(value.recommendations||[]).length+' saved sampling editions.');});}
  async function loadContext(state,id){
    if(!ID.test(id))throw Error('Choose a saved context identity.');
    if(!discard(state)){render(state);return;}
    await guarded(state,async valid=>{const value=await read(state,'context',{context_id:id});if(!valid())return;if(value.context_id!==id)throw Error('The original context identity changed.');state.context=value;state.designDraft=designDraft(value.design_configuration);state.designDirty=false;state.draft=newDraft(value);state.saved=null;state.preview=null;state.design=null;state.downloads=[];state.dirty=false;status(state,'Original context opened. Enter the historical evidence window and explicit future targets.');});
  }
  async function openSaved(state,id,{force=false}={}){
    if(!ID.test(id||''))throw Error('Choose a retained sampling edition.');
    if(!force&&!discard(state))return;
    await guarded(state,async valid=>{
      const value=await read(state,'get',{recommendation_id:id});
      if(!valid())return;if((value.id||value.recommendation_id)!==id)throw Error('The saved sampling identity changed.');
      const selection=value.selection;if(!selection)throw Error('The saved edition does not contain its original target selection.');
      const context=await read(state,'context',{context_id:selection.context_id});
      if(!valid())return;if(context.context_id!==selection.context_id)throw Error('The original context identity changed.');
      state.context=context;state.designDraft=designDraft(context.design_configuration);state.designDirty=false;state.saved=value;state.draft=copy(selection);state.preview=null;state.design=null;state.downloads=[];state.dirty=false;status(state,'Opened this exact saved edition. Edits are saved as a new revision; the original remains retained.');
    });
  }
  function configuration(state){
    const d=state.designDraft;let extra;try{extra=JSON.parse(d.advanced);}catch{throw Error('Additional design configuration must be a JSON object.');}
    if(!extra||Array.isArray(extra)||typeof extra!=='object')throw Error('Additional design configuration must be a JSON object.');
    const requiredDecimal=(key,label)=>{const value=decimal(d[key],label);if(value===null)throw Error('Enter '+label+'.');return value;};
    if(!d.cost_basis.trim())throw Error('Enter the basis for the native design costs.');
    if(!d.start_date||!d.end_date||d.end_date<d.start_date)throw Error('Choose an ordered future calendar window.');
    if(extra.required_ids!==undefined&&!Array.isArray(extra.required_ids))throw Error('Additional required_ids must be an array of exact catchment IDs.');
    return {...extra,required_ids:[...new Set([...(extra.required_ids||[]),...(state.saved.handoff?.required_catchment_ids||[])])],coverage_mode:d.coverage_mode,budget:requiredDecimal('budget','programme budget'),max_sites:integer(d.max_sites,'Maximum sites'),program_overhead:requiredDecimal('program_overhead','programme overhead'),
      default_cost:{...(extra.default_cost||{}),setup:requiredDecimal('setup','default setup cost'),per_visit:requiredDecimal('per_visit','default cost per visit'),basis:d.cost_basis},
      calendar:{...(extra.calendar||{}),start_date:d.start_date,end_date:d.end_date,interval_days:integer(d.interval_days,'Days between rounds',1),round_window_days:integer(d.round_window_days,'Round window',1),crews:integer(d.crews,'Field crews',1),visit_minutes:integer(d.visit_minutes,'Minutes per visit',1),travel_buffer_minutes:integer(d.travel_buffer_minutes,'Travel allowance') }};
  }
  function appendDownload(state,item){
    if(!current(state))return;const url=new URL(item.url,document.baseURI);if(url.origin!==location.origin||!/^\/api\/file\//.test(url.pathname))throw Error('The export did not return an original same-origin file ticket.');
    const a=document.createElement('a');a.href=url.href;a.download='';a.textContent=item.label;root.querySelector('[data-downloads]')?.append(a);
  }
  async function queue(state,kind,payload){
    const intent=JSON.stringify({kind,payload});
    if(state.pending&&JSON.stringify({kind:state.pending.kind,payload:state.pending.payload})!==intent&&!terminal.has(state.pending.state))throw Error('Resume the existing sampling request before submitting a different one.');
    if(!state.pending||JSON.stringify({kind:state.pending.kind,payload:state.pending.payload})!==intent||state.pending.state==='complete')state.pending={kind,payload:copy(payload),operation_id:'sampling-'+crypto.randomUUID(),state:'unsent',task_id:null};
    keep(storageKey(state),state.pending);await resume(state);
  }
  async function resume(state){
    if(!state.pending||state.busy)return;
    const pending=state.pending,version=generation,owner={};state.busyOwner=owner;state.busy=true;status(state,'Continuing the original sampling request.');render(state);
    try{
      let task=pending.task_id?await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id})):await api('/api/actions',{method:'POST',body:{workspace:state.key,action:'monitoring.recommendations.'+pending.kind,payload:pending.payload,operation_id:pending.operation_id}});
      pending.task_id=task.id;pending.state=task.state;state.lastTask=task.id;keep(storageKey(state),pending);
      while(!terminal.has(task.state)){
        if(!current(state,version))return;
        status(state,'Original operation '+task.state+'. You can open its retained task.');await new Promise(resolve=>setTimeout(resolve,700));
        if(!current(state,version))return;
        task=await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id}));pending.state=task.state;keep(storageKey(state),pending);
      }
      if(!current(state,version))return;
      if(task.state!=='complete')throw Error((task.error?.message||'The original operation is '+task.state)+'. Open its task to inspect or resume it.');
      task=await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id}));
      if(!current(state,version))return;
      const result=task.result||{};
      if(pending.kind==='prepare'){
        const id=result.recommendation_id||result.id;if(!ID.test(id||''))throw Error('The completed operation did not identify its saved recommendation.');
        const saved=await read(state,'get',{recommendation_id:id});if(!current(state,version))return;
        state.saved=saved;state.draft=copy(saved.selection);state.preview=null;state.dirty=false;state.design=null;
        state.catalog.recommendations=[...(state.catalog.recommendations||[]).filter(r=>(r.id||r.recommendation_id)!==id),saved];
        status(state,'Saved the complete source-bound recommendation. Its original targets and observations remain retained.');
      }else if(pending.kind==='design'){state.design=result;state.designDirty=false;status(state,'Prepared the original Monitoring design. Open it to inspect feasibility and arrange the field calendar.');}
      else{
        const url=result.download_url;if(!url)throw Error('The completed export has no original file ticket.');
        const item={url,label:'Download complete sampling edition and original sources'+(result.bytes?' · '+Number(result.bytes).toLocaleString()+' bytes':'')};appendDownload(state,item);state.downloads=[item];status(state,'Complete export ready with the retained edition and original source attachments.');
      }
      state.pending=null;keep(storageKey(state),null);
    }catch(error){if(current(state,version))fail(state,error);}
    finally{if(state.busyOwner===owner){state.busy=false;state.busyOwner=null;if(current(state,version))render(state);}}
  }
  async function act(state,action,id){
    if(!current(state))return;
    if(action==='refresh')return refresh(state);
    if(action==='open-saved')return openSaved(state,root.querySelector('[data-saved]').value);
    if(action==='use-period'){if(!state.draft)return;state.draft.evidence_start=state.context.source_period.start_inclusive;state.draft.evidence_end=state.context.source_period.end_inclusive;changed(state);render(state);return;}
    if(action==='open-parent')return openSaved(state,state.saved.parent_id);
    if(action==='transfer')return openDesk('study-transfer','openForStudies',{workspace_key:state.key,roots:[{kind:'monitoring_recommendations',id:state.saved.id||state.saved.recommendation_id,title:state.saved.title||state.saved.selection.title,state:'saved'}]});
    if(action==='new'){if(!state.context||!discard(state))return;state.designDraft=designDraft(state.context.design_configuration);state.designDirty=false;state.draft=newDraft(state.context);state.saved=null;state.preview=null;state.design=null;state.downloads=[];state.dirty=false;render(state);return;}
    if(action==='add-target'){state.draft.targets.push(blankTarget());changed(state);render(state);return;}
    if(action==='remove-target'){state.draft.targets=state.draft.targets.filter(r=>r.id!==id);changed(state);render(state);return;}
    if(action==='preview'){const selection=samplingSelection(state.draft);return guarded(state,async valid=>{const value=await read(state,'preview',{selection});if(valid()){state.preview=value;status(state,'Preview of these exact targets and historical observations. Save to retain the edition.');}});}
    if(action==='prepare'){const selection=samplingSelection(state.draft);return queue(state,'prepare',{selection,...(state.saved?{parent_id:state.saved.id||state.saved.recommendation_id,expected_parent_digest:state.saved.id||state.saved.recommendation_id}:{})});}
    if(action==='design')return queue(state,'design',{recommendation_id:state.saved.id||state.saved.recommendation_id,configuration:configuration(state),title:state.designDraft.title.trim()||state.saved.title||state.saved.selection.title});
    if(action==='export')return queue(state,'export',{recommendation_id:state.saved.id||state.saved.recommendation_id});
    if(action==='resume')return resume(state);
    if(action==='task')return showTask?.(state.pending?.task_id||state.lastTask);
    if(action==='open-context')return openDesk('monitoring','openStudy',{workspace_key:state.key,kind:'monitoring_observed_contexts',id:state.context.context_id});
    if(action==='open-design')return openDesk('monitoring','openStudy',{workspace_key:state.key,kind:'monitoring_plans',id:id||state.design?.plan_id});
  }
  function unload(event){if([...states.values()].some(s=>s.dirty||s.designDirty)){event.preventDefault();event.returnValue='';}}
  window.addEventListener('beforeunload',unload);
  async function mount(node){root=node;generation++;request++;const key=workspace();if(!key){root.innerHTML='<p>Select an original Workspace to review sampling priorities.</p>';return;}active=stateFor(key);active.busy=false;active.busyOwner=null;render(active);await refresh(active);}
  async function update(){if(root&&workspace()!==active?.key){generation++;request++;const key=workspace();if(!key){active=null;root.innerHTML='<p>Select an original Workspace.</p>';return;}active=stateFor(key);active.busy=false;active.busyOwner=null;render(active);await refresh(active);}}
  function detach(){generation++;request++;root=null;active=null;}
  async function openSavedEntry(selection){if(selection?.workspace_key&&selection.workspace_key!==workspace())throw Error('Open this recommendation in its original Workspace.');if(!root||!active)throw Error('Open Sampling priorities first.');if(active.busy||(active.pending&&!terminal.has(active.pending.state)))throw Error('Resume the original sampling operation before opening another saved edition.');await openSaved(active,selection?.recommendation_id||selection?.id);return {workspace_key:active.key,recommendation_id:active.saved?.id||active.saved?.recommendation_id};}
  return {mount,update,detach,render:()=>'',dispatch:()=>false,openSaved:openSavedEntry};
}
