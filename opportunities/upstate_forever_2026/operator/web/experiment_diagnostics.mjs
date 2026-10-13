/* Scientific interpretation of retained native runs. TokenJunkieLabs. */
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? String(value).slice(0,12) : '—';
const title = value => String(value ?? '').replaceAll('_',' ').replaceAll('-',' ');
const number = value => value === null || value === undefined ? '—' : typeof value === 'number' ? (value!==0&&(Math.abs(value)<1e-5||Math.abs(value)>=1e10)?value.toExponential(5):value.toLocaleString(undefined,{maximumFractionDigits:6})) : esc(value);
const date = value => value ? new Date(value).toLocaleString() : '—';
const pretty = value => JSON.stringify(value,null,2);
const observationKey = row => JSON.stringify([row.observation_id,
  Object.entries(row.catchments??{}).sort(([a],[b])=>a.localeCompare(b))]);
const button = (action,label,id='',primary=false,extra='') => '<button type="button" data-action="diagnostic-'+action+'" '+(id?'data-id="'+esc(id)+'" ':'')+'class="'+(primary?'primary':'small')+'" '+extra+'>'+esc(label)+'</button>';
const table = (headers,rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const note = (heading,body) => '<section class="diagnostic-note"><h3>'+esc(heading)+'</h3><p>'+esc(body)+'</p></section>';
const field = (name,label,value='',{type='text',required=false,note='',rows=3}={}) => '<label><span>'+esc(label)+'</span>'+(type==='textarea'?'<textarea name="'+esc(name)+'" rows="'+rows+'" '+(required?'required':'')+'>'+esc(value)+'</textarea>':'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+'>')+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const select = (name,rows,value='',{required=true,empty='Choose…'}={}) => '<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">'+esc(empty)+'</option>'+rows.map(row=>'<option value="'+esc(row[0])+'" '+(row[0]===value?'selected':'')+'>'+esc(row[1])+'</option>').join('')+'</select>';
const val = name => $('#operation-form [name="'+name+'"]')?.value ?? '';
const checked = name => $$('#operation-form [name="'+name+'"]:checked').map(x=>x.value);
const cells = values => '<tr>'+values.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
const labelMap = {native_version_summary:'Native producing versions',native_version_state:'Producing-version compatibility',native_version_reason:'Version notes',incompatible_native_versions:'Incompatible producing versions',selected_run_count:'Runs using this model',model_not_selected_run_count:'Runs with model not selected',pair_applicability:'Paired comparison',interaction_applicability:'Interaction comparison',observations:'Shared / expected observations',model_not_selected_profiles:'Model not selected',source_excluded_observation_count:'Source exclusions',nitrogen_export:'Nitrogen export',phosphorus_export:'Phosphorus export',sediment_export:'Sediment export',
  reference_profile_id:'Reference profile',baseline_scenario_id:'Baseline',profile_id:'Parameter profile',scenario_id:'Scenario',
  modeled_annual_mass:'Modeled annual load',observed_annual_mass:'Observed annual load',mean_bias:'Mean bias',
  percent_bias_model_minus_observed:'Bias, model minus observed (%)',nash_sutcliffe_efficiency:'NSE',
  rmse:'RMSE',mae:'MAE',top_k_design_fraction:'Top-k share of evaluated profiles',spearman:'Spearman rank correlation',top_k_share_percent:'Top-k share (%)',completed_profiles:'Profiles complete / expected',median_export_change:'Median export change',evaluated_range:'Evaluated range',scenario_percent_change:'Export change (%)',baseline_profile_effect:'Baseline parameter effect',scenario_parameter_interaction:'Scenario × parameter effect',oat_mass_slope:'Mass change per parameter unit',oat_scenario_response_slope:'Scenario effect per parameter unit',oat_mass_elasticity:'Mass elasticity',percent_bias:'Bias, model minus observed (%)'};
const label = key => labelMap[key] ?? title(key).replace(/^./,x=>x.toUpperCase());
const pollutant = key => labelMap[key] ?? label(key);
const members = value => Array.isArray(value) ? value : value && typeof value==='object' ? Object.entries(value).map(([key,row])=>({metric:key,...(row&&typeof row==='object'?row:{value:row})})) : [];

export function attachExperimentDiagnostics({getState,api,endpoint,openForm,submitAction,detail,fileList,showTask,openItem,toast,refreshState,navigate,closeDetail,openInvestigation,openStudy,openDecision,openDelivery,openScientificReport}){
  let mounted=null,activeId=null,activeReport=null,activeTab='summary',generation=0,query='',activeWorkspace=null,reportVersion=null;
  const state = () => getState();
  const workspace = () => state()?.workspace_key;
  const data = () => state()?.data ?? {};
  const named = (kind,id) => {
    const row=(data()[kind]??[]).find(x=>x.id===id);
    return row?.title || row?.metadata?.title || row?.spec?.title || short(id);
  };
  const saved = () => data().experiment_diagnostics ?? [];
  async function read(operation,params={}){
    const selected=workspace();
    const result=await api(endpoint('/api/diagnostics/'+operation,params));
    if(workspace()!==selected)throw Error('The workspace changed. Reopen the analysis in the selected workspace.');
    return result;
  }
  function header(heading,description,actions=''){
    return '<header class="page-header"><div><h1>'+esc(heading)+'</h1><p>'+esc(description)+'</p></div><div class="page-actions">'+actions+'</div></header>';
  }
  function overviewRows(){
    return saved().filter(row=>!query||[row.title,row.id].join(' ').toLowerCase().includes(query.toLowerCase()))
      .sort((a,b)=>String(b.created_at??b.updated_at??'').localeCompare(String(a.created_at??a.updated_at??'')))
      .map(row=>cells([
        '<strong>'+esc(row.title||row.selection?.title||'Scientific analysis')+'</strong><small>'+esc(date(row.created_at??row.updated_at))+'</small>',
        esc(row.state??'complete'),
        number(row.coverage?.complete_runs??row.complete_runs??row.run_count??'—'),
        '<span class="mono">'+esc(short(row.id))+'</span>',
        button('open','Open analysis',row.id)+button('revise','New edition',row.id),
      ])).join('');
  }
  function render(){
    if(activeWorkspace!==workspace()){activeWorkspace=workspace();activeId=null;activeReport=null;activeTab='summary';query='';reportVersion=null;}
    if(activeId)return header('Scientific interpretation','Compare exactly matched native results and inspect the observations and assumptions behind the conclusions.',
      button('list','All analyses')+button('new','Select cohort','',true))+'<div class="diagnostic-workspace" id="diagnostic-workspace" aria-live="polite">'+(activeReport?reportHTML(activeReport):'<p>Opening the retained analysis…</p>')+'</div>';
    return header('Scientific interpretation','Compare parameter effects, scenario stability and observed annual loads on a consistent source cohort.',
      button('new','Select cohort','',true))+
      '<div class="diagnostic-intro">'+note('Use the model runs you already have','Choose the original grid, parameter profiles and land-cover cases. A saved analysis records the exact runs and their completion state.')+
      note('Keep the comparison consistent','Effects use matched baselines. Observation scores use the same complete observations across the compared profiles. Every report shows its included and missing members.')+'</div>'+
      '<section class="panel"><div class="diagnostic-filter"><label>Find a saved analysis<input type="search" id="diagnostic-search" value="'+esc(query)+'" placeholder="Name or saved ID"></label></div>'+
      (saved().length?table(['Analysis','State','Complete runs','Saved ID',''],[overviewRows()]):'<div class="empty"><h2>Select a scientific cohort</h2><p>Choose retained native runs to interpret their shared results.</p>'+button('new','Select cohort','',true)+'</div>')+'</section>';
  }
  async function mount(node){
    mounted=node;const turn=++generation;
    $('#diagnostic-search',node)?.addEventListener('input',event=>{
      query=event.target.value;const tbody=$('tbody',node);if(tbody)tbody.innerHTML=overviewRows();
    });
    if(activeId){
      const version=saved().find(row=>row.id===activeId)?.updated_at??null;
      if(activeReport&&reportVersion===version)return;
      try{
        const result=await read('item',{diagnostic_id:activeId});
        if(turn!==generation||!mounted)return;
        activeReport=result;reportVersion=version;const target=$('#diagnostic-workspace',mounted);
        if(target)target.innerHTML=reportHTML(result);
      }catch(error){if(turn===generation&&mounted){const target=$('#diagnostic-workspace',mounted);if(target)target.innerHTML='<p class="notice error">'+esc(error.message)+'</p>'+button('list','Return to saved analyses');}}
    }
  }
  function detach(){mounted=null;generation++;}
  function metricRows(records,columns){
    const list=members(records);
    if(!list.length)return '<p class="note">This analysis has no completed records in this section.</p>';
    const names=columns??[...new Set(list.flatMap(row=>Object.keys(row)))].filter(key=>!['artifact','artifacts','source_stamp','run_ids'].includes(key));
    function format(key,value){
      if(value===null||value===undefined)return '—';
      if(key==='profile_id'||key==='reference_profile_id')return esc(named('profiles',value));
      if(key==='scenario_id'||key==='baseline_scenario_id')return esc(named('scenarios',value));
      if(['model','models','scenario_models','baseline_models'].includes(key))return (Array.isArray(value)?value:[value]).map(model=>esc(String(model).toUpperCase())).join(' · ');
      if(['state','coverage_state','metric_applicability','pair_applicability','interaction_applicability'].includes(key)&&typeof value==='string')return esc(label(value));
      if(['metric','pollutant','artifact_key','parameter'].includes(key)&&typeof value==='string')return esc(pollutant(value));
      if(typeof value==='number')return '<span class="diagnostic-number">'+number(value)+'</span>';
      if(typeof value==='boolean')return value?'Yes':'No';
      if(Array.isArray(value))return value.map(x=>typeof x==='object'?esc(pretty(x)):number(x)).join('<br>');
      if(typeof value==='object'){
        if(Object.hasOwn(value,'min')&&Object.hasOwn(value,'max'))return number(value.min)+' / '+number(value.median)+' / '+number(value.max);
        return Object.entries(value).map(([k,v])=>'<span class="diagnostic-value">'+esc(label(k))+': '+(typeof v==='number'?number(v):v===null?'—':typeof v==='object'?esc(pretty(v)):esc(v))+'</span>').join('');
      }
      if(/_id$/.test(key))return '<span class="mono" title="'+esc(value)+'">'+esc(short(value))+'</span>';
      return esc(value);
    }
    return table(names.map(label),list.map(row=>cells(names.map(key=>format(key,row[key])))));
  }

  function scenarioOverview(report){
    const groups=new Set((report.scenario_summaries??[]).map(row=>row.structural_group_id));
    const rows=(report.scenario_summaries??[]).filter(row=>row.scenario_id!==report.selection?.baseline_scenario_id).map(row=>({
      metric:row.metric,scenario_id:row.scenario_id,structural_group_id:row.structural_group_id,
      units:row.units,completed_profiles:row.delta_n_complete+' / '+row.delta_n_expected,
      median_export_change:row.delta_median,
      evaluated_range:row.delta_minimum===null||row.delta_minimum===undefined?'—':number(row.delta_minimum)+' to '+number(row.delta_maximum),
      sign_consistent:row.sign_consistent,coverage_state:row.coverage_state,
      model_not_selected_profiles:(row.model_not_selected_profile_ids??[]).map(id=>named('profiles',id)),
    }));
    return metricRows(rows,['metric','scenario_id',...(groups.size>1?['structural_group_id']:[]),'units','completed_profiles','median_export_change','evaluated_range','sign_consistent','coverage_state','model_not_selected_profiles']);
  }
  function observationScores(observed,full){
    const requests=new Map((observed.requests??[]).map(row=>[row.request_id,row]));
    return (observed.scores??[]).map(row=>{
      const score=row[full?'full_expected_cohort_score':'common_cohort_score'];
      return {
        observation_dataset:named('observations',requests.get(row.request_id)?.observation_id),
        parameter:row.parameter,profile_id:row.profile_id,units:row.units,
        observations:row.n_common_observations+' / '+row.n_expected_observations,
        cohort_state:row.score_state==='incompatible_native_versions'?'Incompatible producing versions':full?(row.full_expected_cohort_complete?'Complete':'Incomplete'):(row.profile_available?'Available shared observations':'Baseline unavailable'),
        native_version_reason:row.native_version_reason,
        mean_bias:score?.mean_bias,rmse:score?.rmse,mae:score?.mae,
        percent_bias:score?.percent_bias,nash_sutcliffe_efficiency:score?.nash_sutcliffe_efficiency,
      };
    });
  }


  function observationCoverage(report){
    const observed=report.observation_diagnostics??{};
    if(Array.isArray(report.observation_cohort_coverage)){
      return report.observation_cohort_coverage.map(cohort=>({
        observation_dataset:named('observations',cohort.observation_source_id),
        parameter:cohort.parameter,units:cohort.units,
        observations:cohort.coverage_state==='source_unavailable'?'Unavailable':(cohort.n_common_observations??'—')+' / '+(cohort.n_expected_observations??'—'),
        model_not_selected_profiles:(cohort.model_not_selected_profile_ids??[]).map(id=>named('profiles',id)),
        missing_profiles:(cohort.missing_profile_ids??[]).map(id=>named('profiles',id)),
        omitted_observations:cohort.omitted_observation_ids??[],
        full_expected_cohort_complete:cohort.full_expected_cohort_complete,
        coverage_state:label(cohort.coverage_state),
        source_excluded_observation_count:cohort.source_excluded_observation_count,
        explanation:cohort.native_version_reason||cohort.error,
      }));
    }
    return (observed.requests??[]).flatMap(request=>(request.cohorts??[]).map(cohort=>({
      observation_dataset:named('observations',request.observation_id),parameter:cohort.parameter,
      units:cohort.units,observations:cohort.n_common_observations+' / '+cohort.n_expected_observations,
      missing_profiles:(cohort.missing_profile_ids??request.missing_profile_ids??[]).map(id=>named('profiles',id)),
      omitted_observations:(cohort.omitted_observation_keys??[]).map(key=>{
        const row=cohort.observation_members?.[key];return row?[row.station_id||row.catchment_id,row.period_start,row.period_end,row.observation_id].filter(Boolean).join(' · '):key;
      }),
      full_expected_cohort_complete:cohort.full_expected_cohort_complete,
      coverage_state:cohort.full_expected_cohort_complete?'Complete':'Incomplete',
    })));
  }

  function coverageHTML(report){
    const c=report.coverage??{};
    const cards=[['Complete native runs',(c.complete_runs??0)+' / '+(c.expected_runs??0)],
      ['Profiles with every case',(c.complete_profiles??0)+' / '+(c.expected_profiles??0)],
      ['Land-cover cases',c.expected_scenarios??0],['Missing or unfinished runs',(c.missing_runs??0)+(c.unfinished_runs??0)+(c.failed_runs??0)]];
    return '<div class="diagnostic-cards">'+cards.map(([heading,value])=>'<div class="card"><h3>'+esc(heading)+'</h3><strong class="number">'+esc(value)+'</strong></div>').join('')+'</div>'+
      '<details class="technical"><summary>Exact cohort membership and completion</summary><pre class="json-view">'+esc(pretty(c))+'</pre></details>';
  }
  function reportHTML(report){
    const selection=report.selection??{},tabs=[['summary','Overview'],['scenarios','Scenario effects'],['parameters','Parameter responses'],['rank','Ranking stability'],['observations','Observed loads'],['sources','Runs and files']];
    const issues=[...new Map([...(report.errors??[]),...(report.processing_errors??[])].map(error=>[JSON.stringify([error.stage,error.metric,error.run_id,error.profile_id,error.message]),error])).values()];
    const issuesHTML=issues.length?'<details class="diagnostic-status"><summary>'+issues.length+' source or processing issues</summary><ul>'+issues.map(error=>'<li>'+esc(error.message??pretty(error))+'</li>').join('')+'</ul></details>':'';
    const phase=report.processing_phase??report.phase;
    const processingStatus=['failed','interrupted','running','prepared'].includes(report.state)?'<p class="diagnostic-status" role="status">'+esc(label(report.state))+(phase?' · '+esc(label(phase)):'')+'</p>':'';
    if(!report.coverage){
      return '<h2>'+esc(selection.title??'Scientific analysis')+'</h2>'+processingStatus+
        '<p>The retained analysis records its current processing stage. Completed scientific tables appear here when that stage finishes.</p>'+
        '<dl><dt>Elapsed processing time</dt><dd>'+number(report.processing_elapsed_seconds??report.elapsed_seconds)+' seconds</dd></dl>'+
        issuesHTML+'<div class="page-actions">'+button('list','All analyses')+button('revise','Reopen cohort',report.id)+'</div>';
    }
    let body='';
    if(activeTab==='summary'){
      body=coverageHTML(report)+note('Read effects with their direction','Scenario export change is alternative minus its matched baseline: a negative change means lower delivered export. A reported reduction uses the opposite sign. Nutrient loads are in kg/year and sediment loads in tonnes/year.')+
        '<h2>Scenario conclusions across the selected profiles</h2>'+scenarioOverview(report)+
        '<h2>Common spatial support</h2>'+metricRows(report.common_support,['metric','state','native_version_state','native_version_reason','selected_run_count','model_not_selected_run_count','valid_cells','grid_cells','excluded_grid_cells'])+
        note('What the range means','The minimum, median and maximum describe the profiles evaluated in this analysis. Their spread depends on the chosen parameter values and scientific assumptions.')+
        note('Native producing versions','Compatibility is checked separately for each metric using its completed model stage before observed-run and explicitly labeled requested-legacy fallbacks. Incompatible cohorts stay unavailable; compatible outputs from another model remain usable.');
    }else if(activeTab==='scenarios'){
      body=note('Match every alternative to its baseline','Each scenario effect uses the baseline under the same parameter profile and grid. The retained common spatial support makes the selected values comparable.')+
        '<h2>Effects by scenario</h2>'+scenarioOverview(report)+
        '<h2>Each matched scenario and profile</h2>'+metricRows(report.parameter_effects,['metric','scenario_id','profile_id','units','paired_baseline_mass','common_mass_total','scenario_delta','scenario_percent_change','paired_complete','pair_applicability'])+
        '<details><summary>Native totals and spatial coverage</summary>'+metricRows(report.metric_values,['metric','scenario_id','profile_id','units','native_mass_total','common_mass_total','native_valid_cells','common_valid_cells','excluded_native_cells'])+'</details>';
    }else if(activeTab==='parameters'){
      body=note('Separate parameter response and land-cover response','Baseline parameter effects hold land cover fixed. An interaction describes how a parameter choice changes the alternative-versus-baseline effect.')+
        '<h2>Parameter and scenario interaction effects</h2>'+metricRows(report.parameter_effects,['metric','profile_id','scenario_id','units','baseline_profile_effect','profile_effect','scenario_parameter_interaction','paired_complete','interaction_applicability'])+
        '<h2>Responses with one numerical parameter changed</h2>'+metricRows((report.parameter_effects??[]).filter(row=>row.oat_parameter),['metric','profile_id','scenario_id','oat_parameter','oat_parameter_increment','oat_mass_slope','oat_scenario_response_slope','oat_mass_elasticity'])+
        '<details><summary>Exact parameter values and scientific groups</summary>'+metricRows(report.profiles,['profile_id','is_reference','parameter_values','changed_parameters','same_biophysical_table_as_reference','structural_factors'])+'</details>';
    }else if(activeTab==='rank'){
      body=note('Keep the candidate set fixed','Ranks use the same alternatives for every contributing profile. Equal scores share a rank, and a tie crossing the top-k boundary receives fractional membership.')+
        metricRows((report.rank_stability??[]).map(row=>({...row,
          completed_profiles:row.rank_n_complete+' / '+row.rank_n_expected,
          model_not_selected_profiles:(row.model_not_selected_profile_ids??[]).map(id=>named('profiles',id)),
          top_k_share_percent:row.top_k_design_fraction===null||row.top_k_design_fraction===undefined?null:100*row.top_k_design_fraction
        })),['metric','scenario_id','completed_profiles','rank_minimum','rank_median','rank_maximum','reference_rank','top_k','top_k_share_percent','ranking_complete','coverage_state','model_not_selected_profiles'])+
        note('Design frequency','A top-k design fraction is the share of evaluated profiles in which a scenario appears in the top k, including the stated tie treatment.');
    }else if(activeTab==='observations'){
      const observed=report.observation_diagnostics??{};
      body=note('Compare like annual loads','The original catchment comparison preserves source periods, method, units and coverage. Across parameter profiles, these diagnostics use the same complete observation IDs.')+
        '<h2>Observation coverage and omitted members</h2>'+metricRows(observationCoverage(report),['observation_dataset','parameter','units','observations','coverage_state','model_not_selected_profiles','missing_profiles','omitted_observations','source_excluded_observation_count','explanation'])+'<h2>Fit across the full selected cohort</h2>'+metricRows(observationScores(observed,true),['observation_dataset','parameter','profile_id','units','observations','cohort_state','native_version_reason','mean_bias','rmse','percent_bias','nash_sutcliffe_efficiency'])+
        ((observed.scores??[]).some(row=>!row.full_expected_cohort_complete)?'<h2>Available observations shared across completed profiles</h2>'+metricRows(observationScores(observed,false),['observation_dataset','parameter','profile_id','units','observations','cohort_state','native_version_reason','mean_bias','rmse','percent_bias','nash_sutcliffe_efficiency']):'')+
        ((observed.rows??[]).length?'<details><summary>Retained station and period records</summary>'+metricRows(observed.rows,['parameter','profile_id','station_id','catchment_id','period_start','period_end','units','observed_annual_mass','modeled_annual_mass','included_in_metrics','coverage_status'])+'</details>':'')+
        '<details class="technical"><summary>Observation membership, exclusions and source methods</summary><pre class="json-view">'+esc(pretty(observed))+'</pre></details>';
    }else{
      body='<h2>Original native run matrix</h2>'+metricRows(report.run_matrix,['profile_id','scenario_id','models','native_version_summary','state','run_id','is_reference','is_baseline','models_error'])+
        '<h2>Download the complete analysis</h2>'+fileList(report._downloads??[])+
        '<details class="technical"><summary>Selected study and actual source identities</summary><pre class="json-view">'+esc(pretty({selection:report.selection,source_stamp:report.source_stamp}))+'</pre></details>'+
        note('Continue in a transferred workspace','Choose Transfer study to include this analysis and its original scientific dependencies in an editable study archive. Use Back up workspace in the sidebar when transferring the complete project.');
    }
    return '<div class="diagnostic-report-header"><div><h2>'+esc(report.title??selection.title??'Scientific analysis')+'</h2><p>'+esc(selection.purpose??'')+'</p><small>'+esc(date(report.created_at??report.generated_at))+' · <span class="mono">'+esc(short(report.id))+'</span></small></div><div class="page-actions">'+button('revise','New edition',report.id)+button('downloads','Export reports',report.id)+((typeof openScientificReport==='function'||typeof openDelivery==='function')&&report.artifacts?.report_json?button('report','Use in scientific report',report.id,false,'data-report-sha="'+esc(report.artifacts.report_json.sha256)+'"'):'')+(typeof openStudy==='function'?button('study','Transfer study',report.id):'')+(typeof openInvestigation==='function'&&report.artifacts?.report_json?button('investigate','Investigate this analysis',report.id,false,'data-report-sha="'+esc(report.artifacts.report_json.sha256)+'"'):'')+(typeof openDecision==='function'&&report.artifacts?.report_json?button('decision','Prepare Decision study',report.id,false,'data-report-sha="'+esc(report.artifacts.report_json.sha256)+'"'):'')+'</div></div>'+
      processingStatus+(report.results_state==='partial'?'<p class="diagnostic-status" role="status">This cohort is incomplete. Read each result with its included runs and observation counts.</p>':'')+issuesHTML+'<nav class="diagnostic-tabs" aria-label="Scientific analysis views">'+tabs.map(([key,text])=>'<button type="button" data-action="diagnostic-tab" data-tab="'+key+'" aria-current="'+(activeTab===key?'page':'false')+'">'+text+'</button>').join('')+'</nav><div class="diagnostic-results">'+body+'</div>';
  }

  async function newAnalysis(previousId=null,experimentId=null){
    const catalog=await read('catalog');
    const programme=experimentId?await read('experiment',{experiment_id:experimentId}):null;
    const original=programme?.selection??(previousId?(await read('item',{diagnostic_id:previousId})).selection:{});
    let retainedDeclaration=true;
    catalog.observation_contexts=catalog.observation_contexts??[];
    const knownContexts=new Set(catalog.observation_contexts.map(observationKey));
    for(const row of original.observations??[]){
      if(!knownContexts.has(observationKey(row))){
        catalog.observation_contexts.push(row);knownContexts.add(observationKey(row));
      }
    }
    if(!catalog.grids.length||!catalog.profiles.length||!catalog.scenarios.length){
      throw Error('Retain a model grid, parameter profile and land-cover scenario in the original workspace before selecting a scientific cohort.');
    }
    const runById=new Map(catalog.runs.map(row=>[row.id,row]));
    const selectedIds=new Set(original.run_ids??[]);
    const profileNames=new Map(catalog.profiles.map(row=>[row.id,row.title||short(row.id)]));
    const scenarioNames=new Map(catalog.scenarios.map(row=>[row.id,row.title||short(row.id)]));
    const profileName=id=>profileNames.get(id)??short(id);
    const scenarioName=id=>scenarioNames.get(id)??short(id);
    const modelsFor=row=>Array.isArray(row.selection.models)?row.selection.models:row.selection.models===undefined?['ndr','sdr']:[];
    const modelScope=row=>{const models=modelsFor(row);return models.length===2&&models.includes('ndr')&&models.includes('sdr')?'both':models.length===1&&['ndr','sdr'].includes(models[0])?models[0]:'unresolved';};
    const modelLabel=row=>({both:'NDR and SDR',ndr:'NDR only',sdr:'SDR only',unresolved:'Unresolved model selection'}[modelScope(row)]);
    const cellKey=row=>row.selection.profile_id+':'+row.selection.scenario_id;
    const runSearch=new Map(catalog.runs.map(row=>[row.id,[row.id,row.selection.profile_id,row.selection.scenario_id,profileName(row.selection.profile_id),scenarioName(row.selection.scenario_id),modelLabel(row)].join(' ').toLowerCase()]));
    let runPage=0;
    const runPageSize=200;
    const originalGrid=original.run_ids?.map(id=>runById.get(id)?.selection.grid_id).find(Boolean)??'';
    const gridRows=catalog.grids.map(row=>[row.id,(row.title||short(row.id))+' · '+row.state]);
    const profileRows=catalog.profiles.map(row=>[row.id,row.title||short(row.id)]);
    const scenarioRows=catalog.scenarios.filter(row=>row.kind==='baseline').map(row=>[row.id,row.title||short(row.id)]);
    const contextRows=catalog.observation_contexts.map((row,index)=>[
      String(index), (catalog.observations.find(x=>x.id===row.observation_id)?.title??short(row.observation_id))+
      ' · '+(row.source?.title??row.catchments.source_id)+' · '+row.catchments.id_field,
    ]);
    const selectedContexts=new Set((original.observations??[]).map(observationKey));
    const contextCheckboxes=contextRows.map(([key,text])=>{
      const row=catalog.observation_contexts[Number(key)];
      const selection={observation_id:row.observation_id,catchments:row.catchments};
      return '<label class="diagnostic-choice"><input type="checkbox" name="diagnostic_context" value="'+key+'" '+(selectedContexts.has(observationKey(selection))?'checked':'')+'><span>'+esc(text)+'</span></label>';
    }).join('');
    const programmes=catalog.experiment_programmes??[];
    const programmeChooser=programmes.length?'<fieldset><legend>Use an existing experiment programme</legend><div class="diagnostic-programme"><label><span>Retained programme</span>'+select('diagnostic_campaign',programmes.map(row=>[row.id,(row.title||short(row.id))+' · '+row.state]),original.campaign_id??'',{required:false})+'</label>'+button('load-programme','Use programme cases')+'</div><p>Imports its complete planned profile and scenario matrix, including cases awaiting native calculation.</p></fieldset>':'';
    const programmeError=catalog.experiment_programme_error?'<details class="diagnostic-status"><summary>The experiment programme needs a source update</summary><p>Select the retained native runs below to form the cohort.</p><pre>'+esc(catalog.experiment_programme_error)+'</pre></details>':'';
    const programmeNote=programme?'<p class="diagnostic-status">'+esc(programme.programme.title)+' · '+programme.programme.retained_runs+' retained native runs from '+programme.programme.expected_cases+' expected cases. Missing members remain in the saved cohort.</p>':'';
    const body='<div class="diagnostic-form">'+programmeChooser+programmeError+programmeNote+'<div class="form-grid">'+
      field('diagnostic_title','Analysis name',original.title?(previousId?original.title+' — revised cohort':original.title):'',{required:true})+
      field('diagnostic_purpose','Question to answer',original.purpose??'',{type:'textarea',note:'State the physical scenario or assumption you want to compare.'})+
      '<label><span>Study grid</span>'+select('diagnostic_grid',gridRows,originalGrid)+'</label>'+
      '<label><span>Reference parameter profile</span>'+select('diagnostic_reference',profileRows,original.reference_profile_id??'')+'</label>'+
      '<label><span>Baseline land-cover case</span>'+select('diagnostic_baseline',scenarioRows,original.baseline_scenario_id??'')+'</label>'+
      '<label><span>Parameter design represented by these runs</span>'+select('diagnostic_design',[['explicit_run_set','Explicit retained run set'],['one_at_a_time','One parameter at a time'],['full_factorial','Full factorial design']],original.design??'explicit_run_set')+'</label>'+
      '</div><fieldset><legend>Original native runs</legend><p>Select the complete and pending members of the cohort. Pending members stay visible in the result; the analysis uses completed native outputs.</p>'+
      '<div class="form-grid"><label><span>Find native runs</span><input type="search" name="diagnostic_run_query" placeholder="Scenario, profile, models or run ID"></label><label><span>Native run state</span>'+select('diagnostic_run_state',[['complete','Complete'],['prepared','Prepared'],['running','Running'],['failed','Failed'],['interrupted','Interrupted']],'',{required:false,empty:'Every state'})+'</label><label><span>Native model selection</span>'+select('diagnostic_run_models',[['both','NDR and SDR'],['ndr','NDR only'],['sdr','SDR only']],'',{required:false,empty:'Every model selection'})+'</label><label><span>Cohort selection</span>'+select('diagnostic_run_selection',[['selected','Selected runs'],['conflicts','Conflicting selections']],'',{required:false,empty:'All matching runs'})+'</label></div>'+
      '<div class="page-actions">'+button('select-runs','Select all matching')+button('complete-runs','Select completed matching')+button('clear-runs','Clear matching selection')+'</div>'+
      '<p id="diagnostic-selection-count" role="status"></p><p id="diagnostic-selection-conflicts" class="diagnostic-status" role="status" hidden></p><div id="diagnostic-run-choices"></div><p class="note">Choose one native run for each parameter profile and land-cover case. The model selection identifies NDR, SDR, or their combined run.</p></fieldset>'+
      '<fieldset><legend>Observed annual loads</legend><p>Optionally reuse an existing observation and catchment selection. The same complete observation IDs will be compared across the selected baseline profiles.</p>'+
      (contextCheckboxes?'<div class="diagnostic-choices">'+contextCheckboxes+'</div>':'<p class="note">Existing comparison selections appear here after the original Observed water quality workflow has retained one.</p>')+
      '<details><summary>Select another retained observation and catchment</summary><div class="form-grid">'+
      '<label><span>Original observation dataset</span>'+select('diagnostic_observation',catalog.observations.map(x=>[x.id,x.title]),'',{required:false,empty:'Use only the selections above'})+'</label>'+
      '<label><span>Original catchment source</span>'+select('diagnostic_catchment',catalog.source_vectors.map((x,index)=>[String(index),x.title+' · '+x.collection_title]),'',{required:false})+'</label>'+
      field('diagnostic_layer','Native layer name','',{note:'Use the layer retained with the source.'})+
      field('diagnostic_id_field','Catchment ID field','',{note:'Must match the original observation catchment IDs.'})+
      '</div></details></fieldset>'+
      '<details><summary>Ranking and numerical interpretation</summary><div class="form-grid">'+
      field('diagnostic_top_k','Top k scenarios',original.top_k??1,{type:'number',note:'Fractional membership is used for ties at this boundary.'})+
      field('diagnostic_tolerance_n','Nitrogen effect tolerance, kg/year',original.tolerances?.nitrogen_export??0,{type:'number'})+
      field('diagnostic_tolerance_p','Phosphorus effect tolerance, kg/year',original.tolerances?.phosphorus_export??0,{type:'number'})+
      field('diagnostic_tolerance_s','Sediment effect tolerance, t/year',original.tolerances?.sediment_export??0,{type:'number'})+
      '</div><p class="note">A tolerance is an explicit numerical interpretation choice for effects close to zero. It does not change the native model results.</p></details>'+
      '<p class="note">The source selection and resulting report are retained as a new analysis edition. Original runs and profiles remain available in their existing views.</p></div>';
    function gridRuns(){return catalog.runs.filter(row=>row.selection.grid_id===val('diagnostic_grid'));}
    function conflictingCells(rows=catalog.runs.filter(row=>selectedIds.has(row.id))){
      const groups=new Map();
      for(const row of rows){const key=cellKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      return new Map([...groups].filter(([,members])=>members.length>1));
    }
    function visibleRuns(){
      const text=val('diagnostic_run_query').trim().toLowerCase(),nativeState=val('diagnostic_run_state'),models=val('diagnostic_run_models'),selection=val('diagnostic_run_selection');
      const conflicts=selection==='conflicts'?conflictingCells():null;
      return gridRuns().filter(row=>(!nativeState||row.state===nativeState)&&(!models||modelScope(row)===models)&&(!text||runSearch.get(row.id).includes(text))&&(!selection||selectedIds.has(row.id)&&(selection!=='conflicts'||conflicts.has(cellKey(row)))));
    }
    function repaintRuns(){
      const rows=visibleRuns(),pages=Math.max(1,Math.ceil(rows.length/runPageSize));
      runPage=Math.min(runPage,pages-1);
      const pageRows=rows.slice(runPage*runPageSize,(runPage+1)*runPageSize);
      const pager='<div class="diagnostic-run-pages"><span>'+rows.length+' matching of '+gridRuns().length+' runs on this grid · Page '+(runPage+1)+' of '+pages+'</span><div class="page-actions">'+button('runs-prev','Previous page','',false,runPage===0?'disabled':'')+button('runs-next','Next page','',false,runPage>=pages-1?'disabled':'')+'</div></div>';
      $('#diagnostic-run-choices').innerHTML=pager+(rows.length?table(['Select','Land-cover case','Parameter profile','Models','Native state','Run ID'],pageRows.map(row=>cells([
        '<input type="checkbox" name="diagnostic_run" value="'+esc(row.id)+'" aria-label="'+esc(scenarioName(row.selection.scenario_id)+' / '+profileName(row.selection.profile_id)+' / '+modelLabel(row))+'" '+(selectedIds.has(row.id)?'checked':'')+'>',
        esc(scenarioName(row.selection.scenario_id)),esc(profileName(row.selection.profile_id)),esc(modelLabel(row)),
        esc(row.state)+(row.error?'<small>'+esc(row.error.message||row.error)+'</small>':''),
        '<span class="mono">'+esc(short(row.id))+'</span>',
      ]))):'<p class="note">No native runs match this grid and filter. Change the filter, or use Native model runs to prepare the selected cases.</p>');
      updateSelection();
    }
    function updateSelection(){
      const rows=catalog.runs.filter(row=>selectedIds.has(row.id));
      const profiles=new Set(rows.map(x=>x.selection.profile_id)),scenarios=new Set(rows.map(x=>x.selection.scenario_id));
      const complete=rows.filter(x=>x.state==='complete').length;
      $('#diagnostic-selection-count').textContent=rows.length+' selected runs · '+complete+' complete · '+profiles.size+' profiles · '+scenarios.size+' land-cover cases';
      const conflicts=conflictingCells(rows),status=$('#diagnostic-selection-conflicts');
      status.hidden=!conflicts.size;
      status.textContent=conflicts.size?conflicts.size+' profile/case '+(conflicts.size===1?'pair has':'pairs have')+' multiple selected native runs. Choose Conflicting selections above, then retain the intended model run for each pair.':'';
    }
    formListeners.abort();formListeners=new AbortController();
    openForm('Select scientific cohort','Choose the existing scientific records and the reference needed to interpret their effects.',
      body,'Analyze',async()=>{
        const allowed=new Set(gridRuns().map(x=>x.id));
        const ids=[...selectedIds].filter(id=>allowed.has(id));
        if(!ids.length)throw Error('Select the native runs to include in this analysis.');
        const chosen=ids.map(id=>runById.get(id));
        const conflicts=conflictingCells(chosen);
        if(conflicts.size){const first=conflicts.values().next().value[0];for(const name of ['diagnostic_run_query','diagnostic_run_state','diagnostic_run_models'])$('#operation-form [name="'+name+'"]').value='';$('#operation-form [name="diagnostic_run_selection"]').value='conflicts';runPage=0;repaintRuns();throw Error('Choose one native run for '+scenarioName(first.selection.scenario_id)+' under '+profileName(first.selection.profile_id)+'. Use Conflicting selections to resolve '+conflicts.size+' duplicated profile/case '+(conflicts.size===1?'pair.':'pairs.'));}
        if(!chosen.some(x=>x.state==='complete'))throw Error('The selected cohort needs at least one completed native run.');
        const reference=val('diagnostic_reference'),baseline=val('diagnostic_baseline');
        if(!chosen.some(x=>x.selection.profile_id===reference&&x.selection.scenario_id===baseline))throw Error('Include the original baseline run under the selected reference profile.');
        const toleranceNames={nitrogen_export:'diagnostic_tolerance_n',phosphorus_export:'diagnostic_tolerance_p',sediment_export:'diagnostic_tolerance_s'};
        const tolerances={};
        for(const [metric,name] of Object.entries(toleranceNames)){
          const raw=val(name),value=Number(raw);if(!raw.trim()||!Number.isFinite(value)||value<0)throw Error('Use a finite, nonnegative '+pollutant(metric).toLowerCase()+' tolerance.');
          tolerances[metric]=value;
        }
        const topK=Number(val('diagnostic_top_k'));
        if(!Number.isSafeInteger(topK)||topK<1)throw Error('Top k must be a positive whole number.');
        const observations=checked('diagnostic_context').map(index=>{
          const row=catalog.observation_contexts[Number(index)];return {observation_id:row.observation_id,catchments:row.catchments};
        });
        const observationId=val('diagnostic_observation');
        if(observationId){
          const vectorIndex=val('diagnostic_catchment'),vector=vectorIndex===''?null:catalog.source_vectors[Number(vectorIndex)];
          const idField=val('diagnostic_id_field').trim();
          if(!vector||!idField)throw Error('Choose the original catchment source and its catchment ID field.');
          const catchments={source_collection_id:vector.collection_id,source_id:vector.source_id,id_field:idField};
          const layer=val('diagnostic_layer').trim()||vector.layer;if(layer)catchments.layer=layer;
          observations.push({observation_id:observationId,catchments});
        }
        const uniqueContexts=[...new Map(observations.map(row=>[observationKey(row),row])).values()];
        const selection={title:val('diagnostic_title').trim(),purpose:val('diagnostic_purpose').trim(),
          run_ids:ids,baseline_scenario_id:baseline,reference_profile_id:reference,
          design:val('diagnostic_design'),expected_profile_ids:[...new Set([reference,...(retainedDeclaration?original.expected_profile_ids??[]:[]),...chosen.map(x=>x.selection.profile_id)])],
          scenario_ids:[...new Set([baseline,...(retainedDeclaration?original.scenario_ids??[]:[]),...chosen.map(x=>x.selection.scenario_id)])],top_k:topK,tolerances,
          observations:uniqueContexts};
        if(retainedDeclaration&&original.campaign_id)selection.campaign_id=original.campaign_id;
        await submitAction('diagnostics.analyze',selection);
      },()=>{
        const form=$('#operation-form');
        $('#operation-form [name="diagnostic_grid"]').addEventListener('change',()=>{selectedIds.clear();retainedDeclaration=false;runPage=0;repaintRuns();});
        $('#operation-form [name="diagnostic_run_query"]').addEventListener('input',()=>{runPage=0;repaintRuns();},{signal:formListeners.signal});
        form.addEventListener('change',event=>{
          if(event.target.name==='diagnostic_run'){
            if(event.target.checked)selectedIds.add(event.target.value);else selectedIds.delete(event.target.value);
            if(val('diagnostic_run_selection'))repaintRuns();else updateSelection();
          }
          if(['diagnostic_run_state','diagnostic_run_models','diagnostic_run_selection'].includes(event.target.name)){runPage=0;repaintRuns();}
          if(event.target.name==='diagnostic_catchment'){
            const vector=catalog.source_vectors[Number(event.target.value)];
            if(vector&&event.target.value!=='')$('#operation-form [name="diagnostic_layer"]').value=vector.layer??'';
          }
        },{signal:formListeners.signal});
        for(const input of $$('#operation-form [type="number"]')){input.min=input.name==='diagnostic_top_k'?'1':'0';input.step=input.name==='diagnostic_top_k'?'1':'any';}
        form.querySelector('.diagnostic-form').addEventListener('click',event=>{
          const action=event.target.closest('[data-action]')?.dataset.action;
          if(action==='diagnostic-load-programme'){
            event.stopPropagation();event.preventDefault();
            const id=val('diagnostic_campaign');
            if(!id){toast('Select an existing experiment programme.');return;}
            beginAnalysis(null,id).catch(error=>toast(error.message));return;
          }
          if(action==='diagnostic-runs-prev'||action==='diagnostic-runs-next'){
            event.stopPropagation();event.preventDefault();
            runPage=Math.max(0,runPage+(action==='diagnostic-runs-prev'?-1:1));repaintRuns();return;
          }
          if(!['diagnostic-select-runs','diagnostic-complete-runs','diagnostic-clear-runs'].includes(action))return;
          event.stopPropagation();event.preventDefault();
          for(const row of visibleRuns()){
            if(action==='diagnostic-clear-runs'||action==='diagnostic-complete-runs'&&row.state!=='complete')selectedIds.delete(row.id);
            else selectedIds.add(row.id);
          }
          repaintRuns();
        });
        repaintRuns();
      });
  }
  let formListeners=new AbortController();
  async function beginAnalysis(id=null,experimentId=null){return newAnalysis(id,experimentId);}
  async function openAnalysis(id){
    const result=await read('item',{diagnostic_id:id});
    activeWorkspace=workspace();activeId=id;activeReport=result;reportVersion=saved().find(row=>row.id===id)?.updated_at??null;activeTab='summary';closeDetail();
    await navigate('experiment-diagnostics');
    const target=mounted?$('#diagnostic-workspace',mounted):null;if(target)target.innerHTML=reportHTML(result);
  }
  async function prepareReportForm(id,expectedSHA){
    if(typeof openScientificReport!=='function'&&typeof openDelivery!=='function')throw Error('Open the original scientific report composer to use this retained analysis.');
    if(!/^[0-9a-f]{64}$/.test(expectedSHA??''))throw Error('Reopen the saved scientific report to select its exact revision.');
    const selectedWorkspace=workspace(),selectedGeneration=generation;
    const [report,catalog]=await Promise.all([read('item',{diagnostic_id:id}),read('catalog')]);
    if(workspace()!==selectedWorkspace||generation!==selectedGeneration)return;
    if(report.id!==id||report.artifacts?.report_json?.sha256!==expectedSHA)
      throw Error('This scientific report has advanced. Reopen the analysis to choose its current revision.');
    const standalone=typeof openScientificReport==='function';
    const rows=typeof openDelivery==='function'?(catalog.deliveries??[]).map(row=>[row.id,(row.title||short(row.id))+' · '+(row.state||'retained')]):[];
    const body='<div class="diagnostic-form"><p>'+esc(report.selection?.title??'Scientific interpretation')+
      '</p><p>Retain the exact saved report, original numerical tables, source wrappers and common-support masks. '+
      'The report keeps missing runs, observation coverage and design-spread interpretation visible.</p>'+
      '<p class="diagnostic-status">Scientific results: '+esc(report.results_state??report.state)+
      '. Revision <span class="mono">'+esc(short(expectedSHA))+'</span>.</p>'+
      '<label><span>Report to extend</span>'+select('diagnostic_report_delivery',rows,'',{required:false,empty:standalone?'New standalone scientific report':'New report — choose native runs in the original delivery form'})+
      '</label><p>'+(standalone?'A standalone scientific report uses this saved analysis and the original ordered source composer. It can render PDF, HTML, Markdown and source data for the selected native models. ':'')+
      'An existing mapped report keeps its native runs, map settings and ordered scientific sources. '+
      'This analysis is appended once; the original form lets you review and reorder the selection.</p></div>';
    openForm('Use scientific interpretation in a report','Retain the chosen report revision as an original scientific source.',
      body,'Prepare report source',async()=>{
        if(workspace()!==selectedWorkspace)throw Error('The workspace changed. Reopen this report in the intended workspace.');
        const deliveryId=$('#operation-form [name="diagnostic_report_delivery"]').value;
        const payload={diagnostic_id:id,report_sha256:expectedSHA,...(deliveryId?{delivery_id:deliveryId}:{})};
        const task=await submitAction('diagnostics.report.prepare',payload);
        if(workspace()===selectedWorkspace&&task?.state==='complete'){
          if(!deliveryId&&standalone)await openPreparedScientificReport(task.id);
          else await openPreparedReport(task.id);
        }
      });
  }
  async function openPreparedScientificReport(taskId){
    if(typeof openScientificReport!=='function')throw Error('Open Sources to compose this saved scientific report.');
    const selectedWorkspace=workspace(),selectedGeneration=generation;
    const task=await api('/api/task?id='+encodeURIComponent(taskId));
    if(workspace()!==selectedWorkspace||generation!==selectedGeneration)return;
    if(task.workspace!==selectedWorkspace||task.action!=='diagnostics.report.prepare'||task.state!=='complete')
      throw Error('Complete this original report-source operation in the selected workspace first.');
    const result=task.result,source=result?.source,selection=result?.delivery_selection;
    if(!/^[0-9a-f]{64}$/.test(result?.diagnostic_id??'')||!/^[0-9a-f]{64}$/.test(result?.report_sha256??''))
      throw Error('The completed task has no exact retained diagnostic report revision.');
    const original=selection?.observed_context_sources;
    if(!source||!Array.isArray(original)||!original.length||
       !original.some(row=>row.source_collection_id===source.source_collection_id&&row.source_id===source.source_id))
      throw Error('The original report operation has no retained ordered scientific sources.');
    const sources=[],seen=new Set();
    for(const row of original){
      if(!row||!/^[0-9a-f]{64}$/.test(row.source_collection_id??'')||typeof row.source_id!=='string'||!row.source_id.trim())
        throw Error('The original scientific report contains an unreadable retained source choice.');
      const key=JSON.stringify([row.source_collection_id,row.source_id]);
      if(!seen.has(key)){seen.add(key);sources.push({source_collection_id:row.source_collection_id,source_id:row.source_id});}
    }
    return openScientificReport({workspace_key:selectedWorkspace,sources,
      ...(typeof result.title==='string'&&result.title.trim()?{title:result.title}:{})});
  }
  async function openPreparedReport(taskId){
    if(typeof openDelivery!=='function')throw Error('Open the original delivery desk to compose the retained report source.');
    const selectedWorkspace=workspace();
    const task=await api('/api/task?id='+encodeURIComponent(taskId));
    if(workspace()!==selectedWorkspace)return;
    if(task.workspace!==selectedWorkspace||task.action!=='diagnostics.report.prepare'||task.state!=='complete')
      throw Error('Complete this original report-source operation in the selected workspace first.');
    const result=task.result,source=result?.source,selection=result?.delivery_selection;
    if(!source?.source_collection_id||!source?.source_id||!selection||
       !selection.observed_context_sources?.some(row=>row.source_collection_id===source.source_collection_id&&row.source_id===source.source_id))
      throw Error('The original report operation has no retained source selection.');
    await refreshState({force:true});
    if(workspace()!==selectedWorkspace)return;
    return openDelivery(JSON.parse(JSON.stringify(selection)));
  }
  function taskActions(task){
    if(task.action==='diagnostics.report.prepare'&&task.state==='complete'&&task._diagnostic_report)
      return '<div class="page-actions">'+
        (typeof openScientificReport==='function'?button('report-scientific','Open scientific report',task.id,true):'')+
        (typeof openDelivery==='function'?button('report-open','Open mapped report form',task.id,typeof openScientificReport!=='function'):'')+
        button('open','Open source analysis',task._diagnostic_report.diagnostic_id)+'</div>';
    const record=task._diagnostic;
    if(!record)return '';
    return '<div class="page-actions">'+button('open','Open scientific analysis',record.id,true)+'</div>';
  }
  async function dispatch(node){
    const action=node.dataset.action.slice('diagnostic-'.length),id=node.dataset.id;
    if(action==='report')return prepareReportForm(id,node.dataset.reportSha);
    if(action==='report-open')return openPreparedReport(id);
    if(action==='report-scientific')return openPreparedScientificReport(id);
    if(action==='new')return beginAnalysis();
    if(action==='programme')return beginAnalysis(null,id);
    if(action==='revise')return beginAnalysis(id);
    if(action==='open')return openAnalysis(id);
    if(action==='study'){
      if(typeof openStudy!=='function')throw Error('Open Study transfer to select this saved analysis.');
      const report=await read('item',{diagnostic_id:id});
      return openStudy([{kind:'experiment-diagnostics',id:report.id,
        title:report.selection?.title??report.title??'Scientific analysis',state:report.state}]);
    }
    if(action==='decision'){
      if(typeof openDecision!=='function')throw Error('Open Decision studies to prepare this saved analysis.');
      const selectedWorkspace=workspace(),selectedGeneration=generation,expectedSHA=node.dataset.reportSha;
      if(!/^[0-9a-f]{64}$/.test(expectedSHA??''))throw Error('Reopen the saved scientific report before preparing its Decision study.');
      const report=await read('item',{diagnostic_id:id});
      if(generation!==selectedGeneration||workspace()!==selectedWorkspace)return;
      if(report.id!==id||report.artifacts?.report_json?.sha256!==expectedSHA)
        throw Error('This scientific report has advanced. Reopen the analysis to prepare its current saved revision.');
      return openDecision({workspace_key:selectedWorkspace,diagnostic_id:report.id,report_sha256:expectedSHA});
    }
    if(action==='investigate'){
      if(typeof openInvestigation!=='function')throw Error('Connect Scientific investigations to open this analysis there.');
      const selectedWorkspace=workspace(),selectedGeneration=generation,expectedSHA=node.dataset.reportSha;
      if(!/^[0-9a-f]{64}$/.test(expectedSHA??''))throw Error('Reopen the saved scientific report before starting its investigation.');
      const report=await read('item',{diagnostic_id:id});
      if(generation!==selectedGeneration||workspace()!==selectedWorkspace)return;
      if(report.id!==id||report.artifacts?.report_json?.sha256!==expectedSHA)
        throw Error('This scientific report has advanced. Reopen the analysis to investigate its current saved revision.');
      return openInvestigation({workspace_key:selectedWorkspace,diagnostic_id:report.id,title:report.selection?.title??report.title??'Scientific analysis',dataset_id:'es26:'+report.id+':report_json',report_sha256:expectedSHA});
    }
    if(action==='list'){activeId=null;activeReport=null;reportVersion=null;activeTab='summary';return refreshState({force:true});}
    if(action==='tab'){
      activeTab=node.dataset.tab;
      const target=mounted?$('#diagnostic-workspace',mounted):null;
      if(target&&activeReport)target.innerHTML=reportHTML(activeReport);
      return;
    }
    if(action==='downloads'){
      const report=await read('item',{diagnostic_id:id});
      return detail('Export scientific analysis',fileList(report._downloads??[])+
        '<p>These files retain the exact scientific cohort, comparison support and numerical results.</p>',{kind:'diagnostic-files',id});
    }
  }
  function setInvestigationHandler(callback){
    if(callback!==null&&typeof callback!=='function')throw TypeError('The investigation handler must be a function or null.');
    openInvestigation=callback;
    const target=mounted?$('#diagnostic-workspace',mounted):null;
    if(target&&activeReport)target.innerHTML=reportHTML(activeReport);
  }
  function setDecisionHandler(callback){
    if(callback!==null&&typeof callback!=='function')throw TypeError('The decision handler must be a function or null.');
    openDecision=callback;
    const target=mounted?$('#diagnostic-workspace',mounted):null;
    if(target&&activeReport)target.innerHTML=reportHTML(activeReport);
  }
  return {render,mount,detach,dispatch,taskActions,openAnalysis,beginAnalysis,setInvestigationHandler,setDecisionHandler,openAnalysisForExperiment:id=>beginAnalysis(null,id)};
}
