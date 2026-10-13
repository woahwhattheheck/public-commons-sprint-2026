import {configurationChangeTable, downloadSamplingText, requestLabel} from './monitoring_working_copy.mjs';
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
function keep(key,value){
  if(value===null){sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('The original completed request could not be retired. Reopen its retained operation before submitting another request.');memory.delete(key);return;}
  const body=JSON.stringify(value);sessionStorage.setItem(key,body);if(sessionStorage.getItem(key)!==body)throw Error('Retain the complete original sampling request before dispatch. Browser storage is unavailable.');memory.set(key,copy(value));
}
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
    if(row.model_evidence!==undefined){
      const selected=row.model_evidence;
      if(!selected||typeof selected!=='object'||Array.isArray(selected)||!ID.test(selected.source_collection_id||'')||typeof selected.source_id!=='string'||!selected.source_id||typeof selected.pollutant!=='string'||!selected.pollutant||typeof selected.applicability!=='string'||!selected.applicability.trim())throw Error(label+': choose a retained native source and quantity, then explain its applicability; or remove that evidence selection.');
      row.model_evidence={source_collection_id:selected.source_collection_id,source_id:selected.source_id,pollutant:selected.pollutant,applicability:selected.applicability.trim()};
    }
    return {...row,months:[...row.months].sort((a,b)=>a-b),minimum_dates_per_month:integer(row.minimum_dates_per_month,label+' historical date goal'),proposed_visits:integer(row.proposed_visits,label+' proposed visits'),priority:integer(row.priority,label+' priority',1,5),reporting_limit:decimal(row.reporting_limit,label+' reporting limit'),setup_cost:decimal(row.setup_cost,label+' setup cost'),per_visit_cost:decimal(row.per_visit_cost,label+' visit cost'),included:Boolean(row.included)};
  });
  return selection;
}
function evidenceKey(value){return JSON.stringify([value.source_collection_id,value.source_id]);}
function evidenceQuantity(row){return String(row.pollutant||'').replaceAll('_',' ')+' · '+text(row.units);}
function newDraft(context){return {context_id:context.context_id,title:'Sampling priorities',operator:'',recorded_at:new Date().toISOString(),evidence_start:'',evidence_end:'',notes:'',planning_basis:'',targets:[]};}
function roundDateText(value){
  if(value===undefined)return '';
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Selected round dates must be an object.');
  return Object.keys(value).sort((a,b)=>Number(a)-Number(b)).map(key=>{
    if(!/^[1-9]\d*$/.test(key)||!Array.isArray(value[key])||!value[key].length)throw Error('Each selected round needs its original number and a nonempty date array.');
    return key+' = '+value[key].join(', ');
  }).join('\n');
}
function parseRoundDates(value){
  const selected={};
  for(const line of String(value??'').split(/\r?\n/)){
    if(!line.trim())continue;
    const match=/^\s*([1-9]\d*)\s*=\s*(.+?)\s*$/.exec(line);
    if(!match||Object.prototype.hasOwnProperty.call(selected,match[1]))throw Error('Use one line per original round: 2 = 2026-12-04. Do not repeat a round.');
    const dates=match[2].split(',').map(date=>date.trim());
    if(dates.some(date=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)||dates.some((date,index)=>index&&date<=dates[index-1]))throw Error('Each round needs distinct ascending YYYY-MM-DD dates, separated by commas.');
    selected[match[1]]=dates;
  }
  return selected;
}
function roundDateValue(draft, strict=false){
  if(draft.selected_round_dates!==undefined)return draft.selected_round_dates;
  try{return roundDateText(JSON.parse(draft.advanced||'{}').calendar?.selected_round_dates);}catch(error){if(strict)throw error;return '';}
}
function designDraft(configuration=null){const c=configuration||{},calendar=c.calendar||{},cost=c.default_cost||{};return {title:'',budget:c.budget??'',max_sites:c.max_sites??'',program_overhead:c.program_overhead??'',coverage_mode:c.coverage_mode||'local',setup:cost.setup??'',per_visit:cost.per_visit??'',cost_basis:cost.basis||'',start_date:calendar.start_date||'',end_date:calendar.end_date||'',interval_days:calendar.interval_days??'',round_window_days:calendar.round_window_days??'',crews:calendar.crews??'',visit_minutes:calendar.visit_minutes??'',travel_buffer_minutes:calendar.travel_buffer_minutes??'',selected_round_dates:configuration===null?undefined:roundDateText(calendar.selected_round_dates),advanced:json(c)};}
function blankTarget(){return {id:'target-'+crypto.randomUUID(),station_id:'',cohort_id:'',months:[],minimum_dates_per_month:'',proposed_visits:'',reporting_limit:null,reporting_limit_basis:'',flow_goal:'any',reason:'',priority:3,included:true,setup_cost:null,per_visit_cost:null,cost_basis:'',sensitivity_basis:''};}
function money(cents){return cents===null||cents===undefined?'Unknown':(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});}
export function attachMonitoringRecommendations(host){
  const {getState,api,endpoint,showTask,toast,openDesk}=host;
  const states=new Map();let root=null,active=null,generation=0,request=0,events=null;
  const workspace=()=>getState()?.workspace_key||null;
  const current=(state,version=generation)=>Boolean(root&&active===state&&workspace()===state.key&&version===generation);
  function clearEvents(){
    if(!events)return;
    for(const [name,handler] of Object.entries(events.handlers))if(events.node[name]===handler)events.node[name]=null;
    events=null;
  }
  const storageKey=state=>'eco-sampling-request:'+state.key;
  function stateFor(key){
    if(!states.has(key)){
      const prior=stored('eco-sampling-request:'+key),envelope=prior?.schema==='upstate.sampling-request-recovery/v1';
      states.set(key,{key,catalog:{contexts:[],recommendations:[]},context:null,draft:null,saved:null,preview:null,dirty:false,designDirty:false,
        busy:false,busyOwner:null,filters:{station:'',gapsOnly:false},status:'Choose a retained observational context.',error:false,
        pending:envelope?prior.pending:prior,retainedRequests:envelope?(prior.retained||[]):[],
        lastTask:null,design:null,downloads:[],designDraft:designDraft(),selectedDesignId:null,working:null,
        workingRecords:[],workingTitle:'',workingOperator:'',workingNotes:'',editVersion:0,workingDirty:false,importPreview:null});
    }return states.get(key);
  }
  function status(state,message,error=false){state.status=message;state.error=error;if(current(state)){const node=root.querySelector('[data-status]');if(node){node.textContent=message;node.classList.toggle('sampling-error',error);}}}
  function fail(state,error){status(state,error?.message||String(error),true);if(current(state))toast?.(state.status);}
  function changed(state){state.editVersion++;state.workingDirty=true;state.dirty=true;state.preview=null;state.downloads=[];status(state,'Unsaved changes. Preview the current targets, then save a new edition.');const result=root?.querySelector('[data-result]');if(current(state)&&result)result.innerHTML=results(state);updateActions(state);}
  function read(state,action,payload={}){return api('/api/monitoring-recommendations?'+new URLSearchParams({workspace:state.key,action,payload:JSON.stringify(payload)})).then(value=>{if(value.workspace_key&&value.workspace_key!==state.key)throw Error('The response belongs to another Workspace.');return value;});}
  function selectCohort(context,id){return (context?.cohorts||[]).find(row=>row.id===id);}

  function evidenceChoices(state){return state.catalog.model_evidence?.choices||[];}
  function evidenceChoice(state,selection){return selection?evidenceChoices(state).find(row=>row.source_collection_id===selection.source_collection_id&&row.source_id===selection.source_id):null;}
  function evidenceEditor(state,row){
    const selected=row.model_evidence,choice=evidenceChoice(state,selected),rows=evidenceChoices(state),key=selected?evidenceKey(selected):'';
    const target='data-target="'+esc(row.id)+'"';
    let choices=options(rows,evidenceKey,item=>item.title+' · '+item.family,key,'No native evidence selected');
    if(selected&&!choice)choices+='<option value="'+esc(key)+'" selected>Retained source unavailable in this catalogue · '+esc(selected.source_id)+'</option>';
    let quantities=options(choice?.quantities||[],item=>item.pollutant,evidenceQuantity,selected?.pollutant||'','Choose the exact modeled quantity');
    if(selected?.pollutant&&!(choice?.quantities||[]).some(item=>item.pollutant===selected.pollutant))quantities+='<option value="'+esc(selected.pollutant)+'" selected>Retained quantity · '+esc(selected.pollutant)+'</option>';
    const station=(state.context?.stations||[]).find(item=>item.source_station_id===row.station_id);
    return '<section class="sampling-evidence sampling-wide" aria-label="Retained model evidence"><h4>Retained model evidence for this target</h4><p class="sampling-note">Choose a completed source only when it supports your scientific rationale. This does not change the target priority, proposed visits or Monitoring solver.</p>'+
      '<label>Original completed scientific source<select '+target+' data-evidence-source>'+choices+'</select></label>'+
      (selected?'<div class="sampling-grid"><label>Original modeled quantity<select '+target+' data-evidence-pollutant>'+quantities+'</select></label>'+
        '<label>Why this evidence is relevant to this station and exact analytical cohort<textarea '+target+' data-evidence-applicability rows="3">'+esc(selected.applicability||'')+'</textarea></label></div>'+
        table(['Scientific context','Retained source'],[
          ['Native study',choice?choice.title+' · '+choice.family:'Unavailable in this catalogue; retain the choice or remove it explicitly'],
          ['Model geographic support',choice?.support_scope],['Source classification',choice?.classification],
          ['Source station / assigned catchment',(row.station_id||'Not chosen')+' / '+(station?.catchment_id||'Not bound')],
          ['Station location review',station?.coordinate_review],
          ['Observation cohort',selectCohort(state.context,row.cohort_id)?.label||'Not chosen']
        ])+detail('Source identity and original station binding',{selection:selected,native_source:choice||null,station:station||null})+
        '<p class="sampling-note">Matching station/catchment support and constituent, fraction or time-scale equivalence are not established. Annual modeled mass is not a measured concentration. Explain applicability above.</p>':'<p class="sampling-note">The authored sensitivity rationale remains available without attaching model evidence.</p>')+'</section>';
  }
  function conservationEvidenceTables(native){
    const d=native.decision||{},summary=d.summary||{},units=native.selected_quantity?.units;
    const rows=Array.isArray(native.rows)?native.rows:[],paired=rows.filter(row=>row.support_kind!=='baseline_own');
    const own=rows.filter(row=>row.support_kind==='baseline_own');
    const o=d.optimization,request=o?.request||{};
    let result='<h5>Saved Conservation decision · original selected union</h5><p>'+esc(d.title)+' — '+esc(d.study_title)+'</p>'+
      '<p>The original selected reporting union counts overlapping land once. The selected unit identities and modeled case definitions inform the scientist’s question; station support and measured constituent equivalence remain explicit.</p>'+
      table(['Saved decision and geographic meaning','Retained original'],[
        ['Purpose',d.purpose],['Planning-unit label',d.planning_unit_label],
        ['Selected original IDs',d.selected_ids],['Reporting union (ha)',summary.union_area_ha],
        ['Whole-unit union (ha)',summary.whole_unit_union_area_ha],['Overlap removed from union (ha)',summary.overlap_area_ha],
        ['Original geometry layer',native.geometry?.selected_union?.layer],['Original CRS',native.geometry?.analysis_crs],
        ['Saved plan',d.plan_id],['Original study',d.study_id]])+
      '<h5>Baseline on its own retained support</h5>'+
      table(['Baseline run','Annual mass','Unit','Valid / structural / missing ha','Coverage','Availability'],own.map(row=>[
        row.baseline_run_id,row.baseline_own_total,units,
        text(row.baseline_own_valid_area_ha)+' / '+text(row.baseline_own_structural_area_ha)+' / '+text(row.baseline_own_missing_area_ha),
        row.baseline_own_coverage_fraction,row.availability_reason||row.availability]));
    for(const kind of ['fixed_baseline_pair','all_family_common']){
      const selected=paired.filter(row=>row.support_kind===kind);if(!selected.length)continue;
      result+='<h5>'+esc(kind==='all_family_common'?'All declared matched families · one original footprint for this pollutant':'Original fixed-baseline alternatives · each pair’s common footprint')+'</h5>'+
        '<p>Annual signed change is alternative minus baseline. Reduction is baseline minus alternative. Null mass stays unavailable, including structural-only coverage. Pollutants retain independent original support.</p>'+
        table(['Family / pair','Baseline mass','Alternative mass','Signed change','Reduction','Unit','Common valid / structural ha','Common coverage','Availability'],selected.map(row=>[
          row.label,row.common_baseline,row.common_alternative,row.delta,row.reduction,row.units,
          text(row.common_valid_area_ha)+' / '+text(row.common_structural_stream_area_ha),
          row.common_coverage_fraction,row.comparison_availability_reason||row.comparison_availability]))+
        table(['Family / pair','Original baseline','Original alternative','Scientific reason / reference','Support mask SHA256'],selected.map(row=>[
          row.label,row.baseline_run_id,row.alternative_run_id,
          [row.scientific_reason,row.reference].filter(Boolean).join(' · '),row.support_sha256]));
      if(kind==='fixed_baseline_pair')result+='<h5>Alternative own-support context</h5>'+
        table(['Alternative run','Own annual mass','Unit','Own valid / structural / missing ha','Own coverage','Availability'],selected.map(row=>[
          row.alternative_run_id,row.value,row.units,
          text(row.valid_area_ha)+' / '+text(row.structural_stream_area_ha)+' / '+text(row.missing_area_ha),
          row.coverage_fraction,row.availability_reason||row.availability]));
    }
    if(o){
      result+='<h5>Saved land-decision preferences and case interpretation</h5>'+
        table(['Authored setting','Original saved value'],[
          ['Objective',request.objective],['Explicit weights',request.weights],
          ['Original constraints',request.constraints],['Analysis identity',o.id],
          ['Original detail availability',o.detail_reason||o.detail_availability]])+
        table(['Criterion','Kind / axis','Direction','Weight','Original unit','Selected family / alternative'],(request.objective?.criteria||[]).map(c=>[
          c.label||c.id,c.kind+' / '+(c.axis||c.field||''),c.direction,request.weights?.[c.id],c.unit,c.family_id||c.scenario_run_id]))+
        '<p>Weights and deterministic case-selection frequencies describe this saved decision. They are not field observations, calibrated uncertainty, sampling power or a predicted benefit of a future visit.</p>'+
        detail('Original preference profiles, case comparisons and frozen normalization',o);
    }
    result+='<details><summary>Selected original land units · '+(d.selected_units||[]).length+'</summary>'+
      '<p>These original unit rows may overlap. Their masses are not added to create the selected-union quantities above.</p>'+
      table(['Original unit ID','Label','Whole area (ha)','Reporting area (ha)','Original eligibility'],(d.selected_units||[]).map(row=>[
        row.id,row.label,row.area_ha,row.reporting_area_ha,row.eligible]))+
      detail('Complete original selected-unit rows',d.selected_units||[])+'</details>';
    return result;
  }
  function nativeQuantityTables(native){
    if(native.family==="conservation_portfolio")return conservationEvidenceTables(native);
    const rows=Array.isArray(native.rows)?native.rows:[],pollutant=native.selected_quantity?.pollutant;
    if(native.family==='terrain_response'){
      return '<h5>Terrain variants · original shared cells</h5><p>The signed change is alternative minus baseline. Conditioning depth is the terrain input edit, not final elevation. Original full-support totals are retained in the source details.</p>'+
        table(['Variant / depth (m)','Baseline annual mass','Alternative annual mass','Signed change','Annual mass unit','Common cells / ha','Lost / gained valid cells'],rows.map(row=>[
          text(row.variant)+' / '+text(row.burn_depth_m),row.baseline_joint_total,row.alternative_joint_total,row.change_joint_total,row.units,
          text(row.joint_valid_cells)+' / '+text(row.joint_area_ha),text(row.lost_valid_cells)+' / '+text(row.gained_valid_cells)]));
    }
    if(native.family==='control_outcomes'){
      const modes=[...new Set(rows.map(row=>row.support_mode||'unspecified'))];
      return modes.map(mode=>{
        const selected=rows.filter(row=>(row.support_mode||'unspecified')===mode);
        const title=mode==='group_common'?'All selected designs · shared native cells':mode==='per_design'?'Each design · its own three-run shared cells':'Original native support: '+mode;
        return '<h5>'+esc(title)+'</h5><p>Annual masses and direct differences are the retained native result. Baseline minus alternative is avoided export; control minus restoration is the restoration advantage. Geographic rows may overlap and are not additive.</p>'+
          table(['Design / geographic region','Annual mass unit','Baseline','Restoration','Control','Baseline − restoration','Baseline − control','Control − restoration','Common cells / ha'],selected.map(row=>{
            const v=row.siting_contrasts?.[pollutant]||{};
            return [text(row.design_id)+' / '+text(row.title||row.id),v.units,v.mass?.baseline,v.mass?.restoration,v.mass?.control,
              v.alternatives?.restoration?.avoided_export_mass,v.alternatives?.control?.avoided_export_mass,v.restoration_advantage_mass,
              text(v.native_common_cells)+' / '+text(v.native_common_hectares)];
          }))+detail('Original area denominators, source-cell partitions and complete rows · '+title,selected);
      }).join('');
    }
    return detail('Complete original native quantity rows',native.rows);
  }
  function nativeEvidenceDownloads(value){
    const links=(value.downloads||[]).filter(item=>item&&typeof item.path==='string'&&typeof item.download_url==='string'&&/^\/api\/file\/[A-Za-z0-9_-]+\?download=1$/.test(item.download_url));
    if(!links.length)return '';
    return '<details class="sampling-evidence-files"><summary>Original report and source files · '+links.length+'</summary><div class="sampling-downloads">'+links.map(item=>
      '<a href="'+esc(item.download_url)+'" download>'+esc(item.path)+' · '+esc(item.bytes)+' bytes</a>').join('')+'</div></details>';
  }
  function nativeEvidenceView(value){
    if(!value)return '';
    const native=value.native||{},station=value.target_binding?.station||{},cohort=value.target_binding?.cohort||{};
    const quantity=native.selected_quantity||{},window=value.target_binding||{};
    return '<section class="sampling-evidence"><h4>Native evidence for this sampling target</h4><p>'+esc(value.applicability||value.selection?.applicability||'')+'</p>'+
      table(['Model and observation context','Retained value'],[
        ['Native scientific source',value.source?.title||native.family],['Modeled quantity',evidenceQuantity(quantity)],
        ['Modeled geographic support',native.quantity_scope],['Source classification',native.classification],
        ['Original source / network station',text(station.source_station_id)+' / '+text(station.network_station_id)],
        ['Assigned target catchment',station.catchment_id],['Catchment assignment',station.catchment_assignment],
        ['Original observation cohort',cohort.label],['Historical observation window',text(window.evidence_start)+' through '+text(window.evidence_end)],
        ['Spatial relationship','The modeled support is not established as this station’s contributing catchment.'],
        ['Constituent and time relationship','Annual modeled export provides analyst context; the selected observed constituent, method, fraction, units and dates remain distinct.']
      ])+'<p class="sampling-note">The values below retain their original direction, support and annual mass units. They do not establish station concentration, sampling benefit or target priority.</p>'+
      nativeQuantityTables(native)+nativeEvidenceDownloads(value)+detail('Complete original native support and coverage',native.support)+
      '<details><summary>Scientific interpretation limits</summary><ul>'+(value.limitations||[]).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul></details>'+
      detail('Complete native evidence, original source identities and exact target binding',value)+'</section>';
  }
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
      evidenceEditor(state,row)+
      textarea('Why this station, season and analyte need attention','reason',row.reason,{target:row.id})+
      '<label class="sampling-check"><input type="checkbox" '+attr+' data-target-field="included"'+(row.included?' checked':'')+'>Include in the proposed programme</label><button type="button" data-action="remove-target" data-id="'+esc(row.id)+'">Remove this draft target</button></div></details>';
  }
  function contextPanel(state){
    const c=state.context;if(!c)return '<p>Choose a saved context. Its original station matches, analyte cohorts and evidence remain attached to the recommendation.</p>';
    return '<p><strong>'+esc(c.stations?.length||0)+' original stations · '+esc(c.cohorts?.length||0)+' distinct analyte cohorts</strong></p><p>Declared original source period: '+esc(c.source_period?.start_inclusive||'Unknown')+' through '+esc(c.source_period?.end_inclusive||'Unknown')+'.</p><button type="button" data-action="use-period">Use the complete declared evidence window</button>'+
      '<p class="sampling-note">Cohorts retain the original method, unit, fraction, result-value type and speciation. A chosen cohort may have no observations at the chosen station.</p>'+
      '<details><summary>Original station bindings and support</summary>'+table(['Source station','Network station','Catchment','Match','Observations','Sampling dates'],(c.stations||[]).map(r=>[r.source_station_id,r.network_station_id,r.catchment_id,r.match,r.observations,r.sampling_dates]))+'</details>'+
      '<p>'+evidenceChoices(state).length+' retained scientific sources available as optional target evidence. Choices do not establish spatial or analytical equivalence.</p>'+
      ((state.catalog.model_evidence?.issues||[]).length?detail('Scientific sources needing attention',state.catalog.model_evidence.issues):'')+
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
          nativeEvidenceView(r.model_evidence)+
          detail('All original observation fields, qualifiers and source IDs ('+originals.length+')',originals)+detail('Complete target and exact supporting IDs',r)+'</details>';
      }).join('')+
      '<h4>Handoff to the original Monitoring design</h4><p>'+required.length+' required catchments · '+unbound.length+' unbound targets · '+conflicts.length+' catchments with conflicting station bindings.</p>'+
      detail('Exact catchments, station bindings and field/laboratory requirements',value.handoff)+
      '<ul>'+(value.interpretation||[]).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>'+
      detail('Complete immutable recommendation and original context',value);
  }
  function designChanges(state){
    const selected=selectedDesign(state);if(!selected)return '';
    try{return configurationChangeTable(selected.configuration,configuration(state));}
    catch(error){return '<p>Complete the current design fields to compare the exact submitted configuration: '+esc(error.message)+'</p>';}
  }
  function designPanel(state){
    const d=state.designDraft,designs=state.saved?.saved_designs||[],required=state.saved?.handoff?.required_catchment_ids||[];
    const selected=designs.find(item=>item.id===state.selectedDesignId)||null;
    const changes=designChanges(state);
    return '<details data-design-panel><summary>Review, revise and prepare a Monitoring design</summary>'+
      '<div class="sampling-toolbar"><label>Retained native design<select data-design-selection>'+options(designs,item=>item.id,item=>(item.request_payload?.title||'Monitoring design')+' · '+item.status+' · '+item.id.slice(0,12),state.selectedDesignId,'Choose an exact saved design')+'</select></label><button type="button" data-action="load-design">Use selected design configuration</button></div>'+
      (selected?'<h4>Original selected design</h4>'+table(['Saved result','Original value'],[['Design title',selected.request_payload?.title||'Monitoring design'],['Native outcome',selected.status],['Programme budget',money(selected.native_cost?.budget_cents)],['Calculated native cost',money(selected.native_cost?.total_cents)],['Remaining native budget',money(selected.native_cost?.remaining_cents)],['Cost scope',selected.native_cost?.scope],['Original plan',selected.plan_id]])+
        table(['Target','Original station / catchment','Proposed visits','Scheduled visits in target months','Count requirement'],(selected.target_calendar||[]).map(row=>[row.target_id,row.station_id+' / '+row.catchment_id,row.proposed_visits,row.calendar_visits_in_selected_months,row.calendar_count_meets_request?'Met':'Not met']))+
        '<p>Scheduled visits do not establish storm occurrence or laboratory suitability. The saved result remains unchanged when you edit the configuration.</p><details open><summary>Changes from the selected saved design</summary><div data-design-changes>'+changes+'</div></details>':'')+
      '<p>Review the original design configuration. Station requirements come from the saved recommendation; unbound or conflicting station assignments must be resolved before preparation. Native budget and calendar costs are reviewed separately from the itemized target estimate.</p><p>Required catchments from the saved edition: '+esc(required.join(', ')||'None selected')+'. These exact IDs are included in the submitted design configuration.</p><div class="sampling-grid">'+
      ['title','budget','max_sites','program_overhead','setup','per_visit','cost_basis','start_date','end_date','interval_days','round_window_days','crews','visit_minutes','travel_buffer_minutes'].map(key=>{
        const labels={title:'Design title',budget:'Programme budget (USD)',max_sites:'Maximum sites',program_overhead:'Programme overhead (USD)',setup:'Default setup cost per site (USD)',per_visit:'Default cost per visit (USD)',cost_basis:'Native design cost basis',start_date:'First round date',end_date:'Final round date',interval_days:'Days between rounds',round_window_days:'Days to finish each round',crews:'Field crews',visit_minutes:'Minutes per visit',travel_buffer_minutes:'Travel allowance per visit (minutes)'};
        return '<label>'+labels[key]+'<input data-design="'+key+'" value="'+esc(d[key])+'"'+(['start_date','end_date'].includes(key)?' type="date"':'')+'></label>';
      }).join('')+
      '<label>Coverage basis<select data-design="coverage_mode"><option value="local"'+(d.coverage_mode==='local'?' selected':'')+'>Local catchment presence</option><option value="outlet_context"'+(d.coverage_mode==='outlet_context'?' selected':'')+'>Upstream context at proposed outlets</option></select></label>'+
      '<label class="sampling-wide">Selected field dates by original round (optional)<textarea rows="3" data-design="selected_round_dates" placeholder="2 = 2026-12-04">'+esc(roundDateValue(d))+'</textarea><span>Use one line per original round and comma-separated dates when more field days are needed. Blank keeps the original earliest eligible scheduling. Every selected date must satisfy that round’s unchanged window, weekdays, months, blackouts and crew capacity. This prepares a separate saved design; it does not alter historical observations or a previous calendar.</span></label>'+
      '<label class="sampling-wide">Additional original design configuration (JSON object; visible fields above take precedence)<textarea rows="5" data-design="advanced">'+esc(d.advanced)+'</textarea></label></div><button type="button" data-action="design">Prepare Monitoring design</button>'+
      designs.map(item=>'<p>Saved design '+esc(item.plan_id)+' · '+esc(item.status)+'</p><button type="button" data-action="open-design" data-id="'+esc(item.plan_id)+'">Open saved design and calendar</button>').join('')+
      (state.design?'<p>Prepared design '+esc(state.design.plan_id||state.design.id||'')+' · '+esc(state.design.status)+'</p>'+table(['Target','Catchment','Proposed visits','Calendar visits in selected months','Request met'],(state.design.target_calendar||[]).map(r=>[r.target_id,r.catchment_id,r.proposed_visits,r.calendar_visits_in_selected_months,r.calendar_count_meets_request?'Yes':'No']))+detail('Original design costs, bindings and field requirements',state.design)+'<button type="button" data-action="open-design" data-id="'+esc(state.design.plan_id)+'">Open design and field calendar</button>':'')+'</details>';
  }

  function selectedDesign(state){return (state.saved?.saved_designs||[]).find(row=>row.id===state.selectedDesignId)||null;}
  function workingFile(state){
    if(!state.context)throw Error('Open the original observational context before saving a working copy.');
    const design=selectedDesign(state),designDraft=copy(state.designDraft);
    try{if(state.saved)designDraft.configuration=configuration(state);}catch{/* Incomplete authored fields remain editable. */}
    return {schema:'upstate.sampling-working-copy/v1',project_id:state.catalog.project_id,workspace_key:state.key,
      context_id:state.context.context_id,context_digest:state.context.context_digest,
      recommendation_id:state.saved?.id||null,recommendation_digest:state.saved?.recommendation_digest||null,
      design_id:design?.id||null,design_digest:design?.working_digest||null,
      draft:copy(state.draft),design_draft:designDraft,pending_request:state.pending?copy(state.pending):null,
      retained_requests:copy(state.retainedRequests),filters:copy(state.filters),
      title:state.workingTitle||state.draft?.title||'Sampling working copy',operator:state.workingOperator||state.draft?.operator||'',notes:state.workingNotes,
      editor_state:{dirty:state.dirty,design_dirty:state.designDirty,source_working_id:state.working?.id||null}};
  }
  function workingPanel(state){
    const records=state.workingRecords||[],pending=state.pending,review=state.importPreview;
    return '<section class="sampling-card sampling-working"><h3>Working copies and exact request recovery</h3>'+
      '<p>Keep unfinished targets and Monitoring design settings, including empty or unknown values. A working copy is editable planning work; saving or opening it does not run the Monitoring solver.</p>'+
      '<div class="sampling-toolbar"><label>Saved working copy<select data-working-saved>'+options(records,row=>row.id,row=>(row.title||row.working_file?.title||'Sampling working copy')+' · revision '+row.revision+' · '+row.id.slice(0,12),state.working?.id,'Choose a saved working copy')+'</select></label><button type="button" data-action="working-open">Open saved working copy</button></div>'+
      '<div class="sampling-grid"><label>Working-copy title<input data-working-field="workingTitle" value="'+esc(state.workingTitle)+'"></label><label>Responsible operator<input data-working-field="workingOperator" value="'+esc(state.workingOperator)+'"></label><label class="sampling-wide">Working notes<textarea data-working-field="workingNotes">'+esc(state.workingNotes)+'</textarea></label></div>'+
      '<div class="sampling-actions"><button type="button" data-action="working-save">Save '+(state.working?'new working-copy revision':'working copy')+'</button><button type="button" data-action="working-download">Download current working JSON</button><label>Open a working JSON file<input type="file" data-working-file accept=".json,application/json"></label></div>'+
      (state.working?'<p>Retained working copy '+esc(state.working.working_file?.title||state.working.title)+' · revision '+esc(state.working.revision)+' · '+esc(state.working.id)+'. '+(state.workingDirty?'Current edits are not saved in this edition.':'This edition remains available unchanged.')+'</p><div class="sampling-actions"><button type="button" data-action="working-bundle">Export working copy, review and original sources</button><button type="button" data-action="working-workspace">Export complete editable Workspace</button></div>':'')+
      (review?'<section class="sampling-import-review"><h4>Opened file · review before adoption</h4><p>'+esc(review.filename||'Working JSON')+' · '+esc(review.working_file?.title)+'</p>'+
        table(['Binding','Reviewed original'],[['Project',review.working_file?.project_id],['Observed context',review.working_file?.context_id],['Saved recommendation',review.working_file?.recommendation_id],['Selected native design',review.working_file?.design_id],['Original operator Workspace',review.working_file?.workspace_key],['Pending request can resume here',review.can_resume_pending?'Yes, after explicit selection':'No automatic retry']])+
        (review.warnings?.length?'<ul>'+review.warnings.map(w=>'<li>'+esc(typeof w==='string'?w:json(w))+'</li>').join('')+'</ul>':'')+
        '<div class="sampling-actions"><button type="button" data-action="working-adopt">Open reviewed working copy</button><button type="button" data-action="working-cancel">Keep current work</button></div></section>':'')+
      (pending?'<p>Pending '+esc(requestLabel(pending))+' · '+esc(pending.operation_id)+' · '+esc(pending.state)+'. Its exact original payload is retained.</p>'+
        '<button type="button" data-action="request-retain">Keep original request and continue editing</button><p>If a request has no confirmed task identity, use Resume original request before retaining it. A downloaded or imported request requires its original native task for later recovery.</p>':'')+
      (state.retainedRequests.length?'<h4>Retained original requests</h4><p>Recovering an older request does not replace newer target or design edits. Native task status determines whether the original operation can continue.</p>'+state.retainedRequests.map((row,index)=>'<div class="sampling-request"><p>'+esc(requestLabel(row))+' · '+esc(row.operation_id)+' · '+esc(row.state||'Unconfirmed')+'</p><button type="button" data-action="request-recover" data-id="'+index+'">Inspect or recover this exact request</button></div>').join(''):'')+
      (state.completedSelection?'<p>Original request completed while the current edits were retained.</p><button type="button" data-action="open-completed">Open the completed recommendation</button>':'')+'</section>';
  }
  function editorSnapshot(state){return JSON.stringify({draft:state.draft,design_draft:state.designDraft,selected_design_id:state.selectedDesignId});}
  function persistRequests(state){
    const envelope={schema:'upstate.sampling-request-recovery/v1',pending:state.pending,retained:state.retainedRequests};
    keep(storageKey(state),envelope);
  }
  function retainPending(state){
    if(!state.pending)return;
    const previous=state.pending,history=state.retainedRequests;
    state.retainedRequests=[...history.filter(row=>row.operation_id!==previous.operation_id),{...copy(previous),recovery_only:true}];state.pending=null;
    try{persistRequests(state);}catch(error){state.pending=previous;state.retainedRequests=history;throw error;}
    state.workingDirty=true;status(state,'Original request retained for explicit recovery. Current edits remain available.');render(state);
  }
  async function openWorking(state,workingId){
    if(!ID.test(workingId||''))throw Error('Choose a saved working copy.');
    if(!discard(state))return;
    await guarded(state,async valid=>{
      const response=await read(state,'working-get',{working_id:workingId});
      if(!valid())return;
      await adoptWorking(state,response,valid);
    });
  }
  async function adoptWorking(state,response,valid){
    const w=response.working_file;
    if(!w||w.schema!=='upstate.sampling-working-copy/v1')throw Error('Open a complete original Sampling working file.');
    const context=await read(state,'context',{context_id:w.context_id});if(!valid())return;
    let saved=null;if(w.recommendation_id){saved=await read(state,'get',{recommendation_id:w.recommendation_id});if(!valid())return;}
    if(context.context_id!==w.context_id||context.context_digest!==w.context_digest)throw Error('The original observational context changed.');
    if(saved&&(saved.id!==w.recommendation_id||saved.recommendation_digest!==w.recommendation_digest))throw Error('The original saved recommendation changed.');
    if(w.design_id&&!saved?.saved_designs?.some(row=>row.id===w.design_id&&row.working_digest===w.design_digest))throw Error('The selected native design is not in its original recommendation.');
    const requests=copy(w.retained_requests||[]),imported=w.pending_request?{...copy(w.pending_request),imported:true,recovery_only:true}:null;
    for(const row of [...requests,...(imported?[imported]:[])])if(!row.workspace_key)row.workspace_key=w.workspace_key;
    // Preserve every local uncertain operation even when opening a different file.
    for(const row of [...state.retainedRequests,...(state.pending?[state.pending]:[])]){
      const equal=requests.find(item=>item.operation_id===row.operation_id)||(imported?.operation_id===row.operation_id?imported:null);
      if(equal&&JSON.stringify({kind:equal.kind,payload:equal.payload,workspace_key:equal.workspace_key||state.key})!==JSON.stringify({kind:row.kind,payload:row.payload,workspace_key:row.workspace_key||state.key}))throw Error('A retained original operation ID has a different request. Keep both original files for review.');
      if(!equal)requests.push({...copy(row),recovery_only:true});
    }
    if(!valid())return;
    const next={context,saved,draft:copy(w.draft),designDraft:{...designDraft(),...copy(w.design_draft)},
      selectedDesignId:w.design_id||null,filters:copy(w.filters||{station:'',gapsOnly:false}),
      workingTitle:w.title||'',workingOperator:w.operator||'',workingNotes:w.notes||'',
      working:response.record||null,pending:imported,retainedRequests:requests,
      preview:null,downloads:[],importPreview:null,dirty:Boolean(w.editor_state?.dirty),
      designDirty:Boolean(w.editor_state?.design_dirty),workingDirty:false,editVersion:state.editVersion+1};
    delete next.designDraft.configuration;
    next.design=(saved?.saved_designs||[]).find(row=>row.id===next.selectedDesignId)||null;
    if(!next.working){next.dirty=Boolean(next.draft);next.designDirty=true;}
    // Browser persistence must succeed before replacing the current editor.
    keep(storageKey(state),{schema:'upstate.sampling-request-recovery/v1',pending:next.pending,retained:next.retainedRequests});
    Object.assign(state,next);
    status(state,'Opened the complete verified working copy. Original requests were retained; no scientific operation was dispatched.');
  }
  async function importWorking(state,file){
    if(!file)return;
    if(file.size>8*1024*1024)throw Error('Working JSON exceeds the 8 MiB opening limit.');
    const version=state.editVersion;
    await guarded(state,async valid=>{
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      if(!valid()||state.editVersion!==version)return;
      const preview=await previewWorking(state,raw);
      if(!valid()||state.editVersion!==version)return;
      state.importPreview={...preview,filename:file.name};status(state,'The working file has been checked against the retained source. Review its binding, then choose Open reviewed working copy.');
    });
  }

  async function previewWorking(state,working_file){
    const value=await api('/api/monitoring-recommendations?'+new URLSearchParams({workspace:state.key}),{method:'POST',body:{action:'working-preview',payload:{working_file}}});
    if(value.workspace_key&&value.workspace_key!==state.key)throw Error('The working file preview belongs to another Workspace.');
    return value;
  }
  function resetWorking(state){state.selectedDesignId=null;state.working=null;state.workingTitle='';state.workingOperator='';state.workingNotes='';state.workingDirty=false;state.importPreview=null;state.editVersion++;}
  function sameJSON(a,b){
    if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a),other=Object.keys(b);return keys.length===other.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(b,key)&&sameJSON(a[key],b[key]));
  }
  function verifyOriginalTask(state,request,task){
    if(!task||!task.id||(request.task_id&&request.task_id!==task.id)||task.workspace!==state.key||task.action!=='monitoring.recommendations.'+request.kind||!sameJSON(task.payload,request.payload))throw Error('The retained task does not match this original Workspace, action and exact request. Keep its working JSON for original operator reconciliation.');
  }
  async function recoverRequest(state,index){
    const selected=state.retainedRequests[Number(index)];if(!selected)throw Error('Choose a retained original request.');
    if(selected.workspace_key&&selected.workspace_key!==state.key)throw Error('This request belongs to its original operator Workspace; its full bytes remain retained here.');
    // An imported request is never submitted merely because a Workspace label matches.
    if(!selected.task_id)throw Error('This retained request has no confirmed native task identity. Its exact payload remains in the working JSON for original operator reconciliation.');
    await guarded(state,async valid=>{
      const task=await api('/api/task?'+new URLSearchParams({workspace:state.key,id:selected.task_id}));
      if(!valid())return;
      verifyOriginalTask(state,selected,task);
      const history=[...state.retainedRequests.filter(row=>row.operation_id!==selected.operation_id)];
      if(state.pending&&state.pending.operation_id!==selected.operation_id&&!history.some(row=>row.operation_id===state.pending.operation_id))history.push({...copy(state.pending),recovery_only:true});
      const pending={...copy(selected),recovery_only:true};
      keep(storageKey(state),{schema:'upstate.sampling-request-recovery/v1',pending,retained:history});
      state.pending=pending;state.retainedRequests=history;state.workingDirty=true;
      status(state,'Original native task found. Choose Resume original request to read or continue that exact task; later edits remain retained.');
    });
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
      '<section class="sampling-card">'+designPanel(state)+'</section>'+workingPanel(state)+
      '<div class="sampling-downloads" data-downloads></div></section>';
    for(const item of state.downloads)appendDownload(state,item);
    clearEvents();
    const node=root,version=generation;
    const handlers={
      oninput:event=>{if(current(state,version))input(state,event);},
      onchange:event=>{if(current(state,version))change(state,event);},
      onclick:event=>{if(!current(state,version))return;const button=event.target.closest('[data-action]');if(button&&node.contains(button)){event.preventDefault();return act(state,button.dataset.action,button.dataset.id).catch(error=>{if(current(state,version))fail(state,error);});}}
    };
    events={node,handlers};
    for(const [name,handler] of Object.entries(handlers))node[name]=handler;
    updateActions(state);
  }
  function updateActions(state){
    if(!current(state))return;
    const pending=Boolean(state.pending&&!terminal.has(state.pending.state)),blocked=state.busy||pending;
    for(const node of root.querySelectorAll('input,textarea,select,.sampling-editor button'))node.disabled=blocked;
    for(const node of root.querySelectorAll('[data-action]')){
      const a=node.dataset.action;
      node.disabled=(state.busy&&a!=='task')||(pending&&!['resume','task','request-retain','working-download'].includes(a))||
        (['preview','prepare','add-target'].includes(a)&&!state.draft)||
        (['design','export','transfer'].includes(a)&&!state.saved)||
        (['open-context','use-period','working-save','working-download'].includes(a)&&!state.context)||
        (a==='open-design'&&!node.dataset.id)||(a==='load-design'&&!state.saved?.saved_designs?.length)||
        (a==='design'&&state.dirty)||(a==='working-open'&&!state.workingRecords.length)||
        (['working-bundle','working-workspace'].includes(a)&&!state.working);
    }
  }
  function input(state,event){
    if(!current(state))return;const node=event.target;
    if(node.dataset.workingField){state[node.dataset.workingField]=node.value;state.workingDirty=true;state.editVersion++;return;}
    if(node.dataset.field&&state.draft){state.draft[node.dataset.field]=node.value;changed(state);}
    if(node.dataset.targetField&&state.draft){const row=state.draft.targets.find(r=>r.id===node.dataset.target);if(row){row[node.dataset.targetField]=node.type==='checkbox'?node.checked:node.value;changed(state);}}
    if(node.dataset.month&&state.draft){const row=state.draft.targets.find(r=>r.id===node.dataset.target),month=Number(node.dataset.month);if(row){row.months=node.checked?[...new Set([...row.months,month])]:row.months.filter(n=>n!==month);changed(state);}}
    if(node.hasAttribute('data-evidence-applicability')&&state.draft){const row=state.draft.targets.find(item=>item.id===node.dataset.target);if(row?.model_evidence){row.model_evidence.applicability=node.value;changed(state);}}
    if(node.dataset.design){state.editVersion++;state.workingDirty=true;state.designDraft[node.dataset.design]=node.value;state.designDirty=true;status(state,'Unsaved Monitoring design configuration. Prepare a design to retain these exact choices.');const comparison=root.querySelector('[data-design-changes]');if(comparison)comparison.innerHTML=designChanges(state);}
  }
  function change(state,event){
    if(!current(state))return;
    const node=event.target;
    if(node.hasAttribute('data-working-file'))return importWorking(state,node.files?.[0]).catch(error=>{if(current(state))fail(state,error);});
    if(node.hasAttribute('data-evidence-source')&&state.draft){
      const row=state.draft.targets.find(item=>item.id===node.dataset.target);if(!row)return;
      if(!node.value)delete row.model_evidence;
      else{const choice=evidenceChoices(state).find(item=>evidenceKey(item)===node.value);if(!choice){status(state,'The selected native source is unavailable in this catalogue. Keep the retained choice or remove it explicitly.',true);render(state);return;}
        if(!row.model_evidence||evidenceKey(row.model_evidence)!==node.value)row.model_evidence={source_collection_id:choice.source_collection_id,source_id:choice.source_id,pollutant:'',applicability:row.model_evidence?.applicability||''};}
      changed(state);render(state);return;
    }
    if(node.hasAttribute('data-evidence-pollutant')&&state.draft){
      const row=state.draft.targets.find(item=>item.id===node.dataset.target);if(!row?.model_evidence)return;
      row.model_evidence.pollutant=node.value;changed(state);return;
    }
    if(event.target.matches('[data-gap-station],[data-gap-only]')){if(event.target.matches('[data-gap-station]'))state.filters.station=event.target.value;else state.filters.gapsOnly=event.target.checked;root.querySelector('[data-result]').innerHTML=results(state);return;}
    if(event.target.matches('[data-context]')){const id=event.target.value;if(id)return loadContext(state,id).catch(error=>{if(current(state))fail(state,error);});}
    else if(event.target.dataset.targetField||event.target.dataset.month||event.target.dataset.design){input(state,event);if(['station_id','cohort_id'].includes(event.target.dataset.targetField))render(state);}
  }
  async function guarded(state,fn){const version=generation,ticket=++request,owner={};state.busyOwner=owner;state.busy=true;updateActions(state);try{await fn(()=>current(state,version)&&ticket===request);}catch(error){if(current(state,version)&&ticket===request)fail(state,error);}finally{if(state.busyOwner===owner){state.busy=false;state.busyOwner=null;if(current(state,version))render(state);}}}
  function hasUnsaved(state){return state.workingDirty||(!state.working&&(state.dirty||state.designDirty));}
  function discard(state){return !hasUnsaved(state)||confirm('Replace the current unsaved targets, design configuration and working-copy notes? Download current working JSON to retain them before opening other work. Original uncertain requests remain retained.');}
  async function refresh(state){await guarded(state,async valid=>{const [value,working]=await Promise.all([read(state,'catalog'),read(state,'working-list')]);if(!valid())return;state.catalog=value;state.workingRecords=working.records||[];status(state,(value.contexts||[]).length+' saved observation contexts · '+(value.recommendations||[]).length+' saved sampling editions.');});}
  async function loadContext(state,id,isCurrent=()=>true){
    if(!ID.test(id))throw Error('Choose a saved context identity.');
    if(!discard(state)){render(state);return;}
    await guarded(state,async valid=>{const value=await read(state,'context',{context_id:id});if(!valid()||!isCurrent())return;if(value.context_id!==id)throw Error('The original context identity changed.');resetWorking(state);state.context=value;state.designDraft=designDraft(value.design_configuration);state.designDirty=false;state.draft=newDraft(value);state.saved=null;state.preview=null;state.design=null;state.downloads=[];state.dirty=false;status(state,'Original context opened. Enter the historical evidence window and explicit future targets.');});
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
      resetWorking(state);state.context=context;state.designDraft=designDraft(context.design_configuration);state.designDirty=false;state.saved=value;state.draft=copy(selection);state.preview=null;state.design=null;state.downloads=[];state.dirty=false;status(state,'Opened this exact saved edition. Edits are saved as a new revision; the original remains retained.');
    });
  }
  function configuration(state){
    const d=state.designDraft;let extra;try{extra=JSON.parse(d.advanced);}catch{throw Error('Additional design configuration must be a JSON object.');}
    if(!extra||Array.isArray(extra)||typeof extra!=='object')throw Error('Additional design configuration must be a JSON object.');
    const requiredDecimal=(key,label)=>{const value=decimal(d[key],label);if(value===null)throw Error('Enter '+label+'.');return value;};
    if(!d.cost_basis.trim())throw Error('Enter the basis for the native design costs.');
    if(!d.start_date||!d.end_date||d.end_date<d.start_date)throw Error('Choose an ordered future calendar window.');
    if(extra.required_ids!==undefined&&!Array.isArray(extra.required_ids))throw Error('Additional required_ids must be an array of exact catchment IDs.');
    const selectedDates=parseRoundDates(roundDateValue(d,true));
    const calendar={...(extra.calendar||{})};
    if(Object.keys(selectedDates).length)calendar.selected_round_dates=selectedDates;
    else delete calendar.selected_round_dates;
    return {...extra,required_ids:[...new Set([...(extra.required_ids||[]),...(state.saved.handoff?.required_catchment_ids||[])])],coverage_mode:d.coverage_mode,budget:requiredDecimal('budget','programme budget'),max_sites:integer(d.max_sites,'Maximum sites'),program_overhead:requiredDecimal('program_overhead','programme overhead'),
      default_cost:{...(extra.default_cost||{}),setup:requiredDecimal('setup','default setup cost'),per_visit:requiredDecimal('per_visit','default cost per visit'),basis:d.cost_basis},
      calendar:{...calendar,start_date:d.start_date,end_date:d.end_date,interval_days:integer(d.interval_days,'Days between rounds',1),round_window_days:integer(d.round_window_days,'Round window',1),crews:integer(d.crews,'Field crews',1),visit_minutes:integer(d.visit_minutes,'Minutes per visit',1),travel_buffer_minutes:integer(d.travel_buffer_minutes,'Travel allowance') }};
  }
  function appendDownload(state,item){
    if(!current(state))return;const url=new URL(item.url,document.baseURI);if(url.origin!==location.origin||!/^\/api\/file\//.test(url.pathname))throw Error('The export did not return an original same-origin file ticket.');
    const a=document.createElement('a');a.href=url.href;a.download='';a.textContent=item.label;root.querySelector('[data-downloads]')?.append(a);
  }
  async function queue(state,kind,payload){
    if(state.busy)return;
    const intent=JSON.stringify({kind,payload});
    if(state.pending&&JSON.stringify({kind:state.pending.kind,payload:state.pending.payload})!==intent&&!terminal.has(state.pending.state))throw Error('Resume the existing request, or keep it for explicit recovery, before submitting a different one.');
    if(!state.pending||JSON.stringify({kind:state.pending.kind,payload:state.pending.payload})!==intent||state.pending.state==='complete'){
      if(state.pending&&!state.pending.kind.startsWith('working-'))state.retainedRequests=[...state.retainedRequests.filter(row=>row.operation_id!==state.pending.operation_id),{...copy(state.pending),recovery_only:true}];
      state.pending={kind,payload:copy(payload),operation_id:'sampling-'+crypto.randomUUID(),state:'unsent',task_id:null,workspace_key:state.key,editor_snapshot:editorSnapshot(state)};
    }
    try{persistRequests(state);}catch(error){render(state);throw error;}await resume(state);
  }
  async function resume(state){
    if(!state.pending||state.busy)return;
    const pending=state.pending;
    if(pending.workspace_key&&pending.workspace_key!==state.key)throw Error('This request belongs to the original operator Workspace. Its bytes remain retained here; reopen that original operation to recover it.');
    if(pending.imported&&!pending.task_id)throw Error('The imported request has no confirmed native task identity. Its exact original payload remains retained for operator reconciliation.');
    persistRequests(state);
    const version=generation,owner={};state.busyOwner=owner;state.busy=true;status(state,'Continuing the original '+requestLabel(pending).toLowerCase()+' request.');render(state);
    try{
      let task=pending.task_id?await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id})):await api('/api/actions',{method:'POST',body:{workspace:state.key,action:'monitoring.recommendations.'+pending.kind,payload:pending.payload,operation_id:pending.operation_id}});
      verifyOriginalTask(state,pending,task);
      pending.task_id=task.id;pending.state=task.state;state.lastTask=task.id;persistRequests(state);
      while(!terminal.has(task.state)){
        if(!current(state,version))return;
        status(state,'Original operation '+task.state+'. You can open its retained task.');await new Promise(resolve=>setTimeout(resolve,700));
        if(!current(state,version))return;
        task=await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id}));pending.state=task.state;persistRequests(state);
      }
      if(!current(state,version))return;
      if(task.state!=='complete')throw Error((task.error?.message||'The original operation is '+task.state)+'. Open its task to inspect or resume it. Your current edits and exact request remain retained.');
      task=await api('/api/task?'+new URLSearchParams({workspace:state.key,id:pending.task_id}));
      if(!current(state,version))return;
      const result=task.result||{},canAdopt=!pending.recovery_only&&(!state.draft||pending.editor_snapshot===editorSnapshot(state));
      if(pending.kind==='prepare'){
        const id=result.recommendation_id||result.id;if(!ID.test(id||''))throw Error('The completed operation did not identify its saved recommendation.');
        const saved=await read(state,'get',{recommendation_id:id});if(!current(state,version))return;
        state.catalog.recommendations=[...(state.catalog.recommendations||[]).filter(r=>(r.id||r.recommendation_id)!==id),saved];
        if(canAdopt){
          const context=await read(state,'context',{context_id:saved.context_id||saved.selection.context_id});if(!current(state,version))return;
          state.context=context;state.saved=saved;state.draft=copy(saved.selection);state.preview=null;state.dirty=false;state.design=null;state.selectedDesignId=null;
          status(state,'Saved the complete source-bound recommendation. Its original targets and observations remain retained.');
        }else{state.completedSelection={recommendation_id:id};status(state,'The original recommendation save completed. Your later edits remain unchanged; open its completed recommendation separately.');}
        state.workingDirty=true;
      }else if(pending.kind==='design'){
        if(state.saved?.id===result.recommendation_id){
          // Fetch the verified digest supplied by the native reader, never hash Python values in the browser.
          const saved=await read(state,'get',{recommendation_id:result.recommendation_id});if(!current(state,version))return;
          state.saved.saved_designs=saved.saved_designs;state.saved.recommendation_digest=saved.recommendation_digest;
          if(canAdopt){state.design=result;state.selectedDesignId=result.id||null;state.designDirty=false;}
        }
        state.completedSelection={recommendation_id:result.recommendation_id};state.workingDirty=true;
        status(state,canAdopt?'Prepared a new native Monitoring design. Its original configuration, costs and field calendar are retained.':'The original native design completed. Your later design edits remain unchanged.');
      }else if(pending.kind==='working-save'){
        const id=result.id||result.working_id;if(!ID.test(id||''))throw Error('The completed operation did not identify its saved working copy.');
        const response=await read(state,'working-get',{working_id:id});if(!current(state,version))return;
        state.workingRecords=[...(state.workingRecords||[]).filter(row=>row.id!==id),response.record];
        if(canAdopt){state.working=response.record;state.workingDirty=false;}
        status(state,'Saved the complete editable working copy. Scientific results and any earlier working-copy edition remain unchanged.');
      }else{
        const url=result.download_url;if(!url)throw Error('The completed export has no original file ticket.');
        const label=pending.kind==='working-export'?(pending.payload.format==='workspace'?'Download complete editable Workspace':'Download working copy, review and original sources'):'Download complete sampling edition and original sources';
        const item={url,label:label+(result.bytes?' · '+Number(result.bytes).toLocaleString()+' bytes':'')};state.downloads=[...state.downloads.filter(row=>row.url!==url),item];
        status(state,'Complete export ready. Open every included report and original source, then reopen the editable files.');
      }
      if(!pending.kind.startsWith('working-'))state.retainedRequests=[...state.retainedRequests.filter(row=>row.operation_id!==pending.operation_id),{...copy(pending),state:'complete',recovery_only:true}];
      state.pending=null;try{persistRequests(state);}catch(error){state.pending=pending;throw error;}
    }catch(error){if(current(state,version))fail(state,error);}
    finally{if(state.busyOwner===owner){state.busy=false;state.busyOwner=null;if(current(state,version))render(state);}}
  }
  async function act(state,action,id){
    if(!current(state))return;
    if(state.busy&&action!=='task')return;
    if(state.pending&&!terminal.has(state.pending.state)&&!['resume','task','request-retain','working-download'].includes(action))throw Error('Resolve or explicitly retain the original request before changing this work.');
    if(action==='working-open')return openWorking(state,root.querySelector('[data-working-saved]').value);
    if(action==='working-save')return queue(state,'working-save',{working_file:workingFile(state),parent_id:state.working?.id||null,expected_parent_digest:state.working?.id||null});
    if(action==='working-download')return guarded(state,async valid=>{const file=workingFile(state),preview=await previewWorking(state,file);if(valid()){downloadSamplingText(JSON.stringify(preview.working_file)+'\n','Sampling_Working_Copy.json');status(state,'Downloaded the current targets, full design text and exact retained requests. Saved scientific editions remain unchanged.');}});
    if(action==='working-bundle'||action==='working-workspace')return queue(state,'working-export',{working_id:state.working.id,format:action==='working-workspace'?'workspace':'bundle'});
    if(action==='working-adopt'){if(!state.importPreview||!discard(state))return;const selected=state.importPreview;return guarded(state,valid=>adoptWorking(state,selected,valid));}
    if(action==='working-cancel'){state.importPreview=null;render(state);return;}
    if(action==='request-retain')return retainPending(state);
    if(action==='request-recover')return recoverRequest(state,id);
    if(action==='open-completed')return openSaved(state,state.completedSelection.recommendation_id);
    if(action==='refresh')return refresh(state);
    if(action==='open-saved')return openSaved(state,root.querySelector('[data-saved]').value);
    if(action==='use-period'){if(!state.draft)return;state.draft.evidence_start=state.context.source_period.start_inclusive;state.draft.evidence_end=state.context.source_period.end_inclusive;changed(state);render(state);return;}
    if(action==='open-parent')return openSaved(state,state.saved.parent_id);
    if(action==='transfer')return openDesk('study-transfer','openForStudies',{workspace_key:state.key,roots:[{kind:'monitoring_recommendations',id:state.saved.id||state.saved.recommendation_id,title:state.saved.title||state.saved.selection.title,state:'saved'}]});
    if(action==='new'){if(!state.context||!discard(state))return;resetWorking(state);state.designDraft=designDraft(state.context.design_configuration);state.designDirty=false;state.draft=newDraft(state.context);state.saved=null;state.preview=null;state.design=null;state.downloads=[];state.dirty=false;render(state);return;}
    if(action==='add-target'){state.draft.targets.push(blankTarget());changed(state);render(state);return;}
    if(action==='remove-target'){state.draft.targets=state.draft.targets.filter(r=>r.id!==id);changed(state);render(state);return;}
    if(action==='preview'){const selection=samplingSelection(state.draft);return guarded(state,async valid=>{const value=await read(state,'preview',{selection});if(valid()){state.preview=value;status(state,'Preview of these exact targets and historical observations. Save to retain the edition.');}});}
    if(action==='prepare'){const selection=samplingSelection(state.draft);return queue(state,'prepare',{selection,...(state.saved?{parent_id:state.saved.id||state.saved.recommendation_id,expected_parent_digest:state.saved.id||state.saved.recommendation_id}:{})});}
    if(action==='load-design'){
      const selected=(state.saved?.saved_designs||[]).find(item=>item.id===root.querySelector('[data-design-selection]')?.value);
      if(!selected)throw Error('Choose one retained design from this exact saved recommendation.');
      if(state.designDirty&&!confirm('Replace the unfinished design settings with this saved design? Save a working copy first if you need those edits.'))return;
      state.designDraft=designDraft(selected.configuration);state.designDraft.title=selected.request_payload?.title||state.saved.title||state.saved.selection.title;state.design=copy(selected);state.selectedDesignId=selected.id;state.designDirty=false;state.workingDirty=true;state.editVersion++;status(state,'Opened the exact saved design configuration. Changes prepare a new native design; this original result is retained.');render(state);root.querySelector('[data-design-panel]')?.setAttribute('open','');return;
    }
    if(action==='design')return queue(state,'design',{recommendation_id:state.saved.id||state.saved.recommendation_id,configuration:configuration(state),title:state.designDraft.title.trim()||state.saved.title||state.saved.selection.title});
    if(action==='export')return queue(state,'export',{recommendation_id:state.saved.id||state.saved.recommendation_id});
    if(action==='resume')return resume(state);
    if(action==='task')return showTask?.(state.pending?.task_id||state.lastTask);
    if(action==='open-context')return openDesk('monitoring','openStudy',{workspace_key:state.key,kind:'monitoring_observed_contexts',id:state.context.context_id});
    if(action==='open-design')return openDesk('monitoring','openStudy',{workspace_key:state.key,kind:'monitoring_plans',id:id||state.design?.plan_id});
  }
  function unload(event){if([...states.values()].some(s=>hasUnsaved(s)||s.pending||s.retainedRequests.some(r=>r.state!=='complete'))){event.preventDefault();event.returnValue='';}}
  window.addEventListener('beforeunload',unload);
  async function mount(node){clearEvents();root=node;generation++;request++;const key=workspace();if(!key){root.innerHTML='<p>Select an original Workspace to review sampling priorities.</p>';return;}active=stateFor(key);active.busy=false;active.busyOwner=null;render(active);await refresh(active);}
  async function update(){if(root&&workspace()!==active?.key){clearEvents();generation++;request++;const key=workspace();if(!key){active=null;root.innerHTML='<p>Select an original Workspace.</p>';return;}active=stateFor(key);active.busy=false;active.busyOwner=null;render(active);await refresh(active);}}
  function detach(){clearEvents();generation++;request++;root=null;active=null;}
  async function openSavedEntry(selection){if(selection?.workspace_key&&selection.workspace_key!==workspace())throw Error('Open this recommendation in its original Workspace.');if(!root||!active)throw Error('Open Sampling priorities first.');if(active.busy||(active.pending&&!terminal.has(active.pending.state)))throw Error('Resume the original sampling operation before opening another saved edition.');await openSaved(active,selection?.recommendation_id||selection?.id);return {workspace_key:active.key,recommendation_id:active.saved?.id||active.saved?.recommendation_id};}
  async function openContextEntry(selection){
    if(selection?.workspace_key!==workspace())throw Error('Open these observations in their original Workspace.');
    if(!ID.test(selection?.context_id||''))throw Error('Choose an exact saved observational context.');
    if(!root||!active)throw Error('Open Sampling priorities first.');
    if(active.busy||(active.pending&&!terminal.has(active.pending.state)))throw Error('Resume the original sampling operation before opening another context.');
    const state=active,key=state.key,id=selection.context_id;
    if(typeof selection.isCurrent==='function'&&!selection.isCurrent())return {opened:false};
    await loadContext(state,id,()=>typeof selection.isCurrent!=='function'||selection.isCurrent());
    if(!current(state)||workspace()!==key||(typeof selection.isCurrent==='function'&&!selection.isCurrent()))return {opened:false};
    return {workspace_key:key,context_id:state.context?.context_id||null,opened:state.context?.context_id===id};
  }
  return {mount,update,detach,render:()=>'',dispatch:()=>false,openSaved:openSavedEntry,openContext:openContextEntry};
}
