/** Ordered native combinations and pollutant-wise attribution in the existing desk host. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>typeof value==='number'?(Number.isFinite(value)?(value!==0&&Math.abs(value)<0.0001?value.toExponential(4):value.toLocaleString(undefined,{maximumFractionDigits:6})):'Unavailable'):String(value??'—');
const short=value=>String(value||'').slice(0,12);
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(fmt(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const template='<main class="native-combinations"><header><h1>Conservation combinations</h1><p>Compare conservation actions individually and together using their retained native scenarios. Allocate the combined annual export benefit while preserving interactions between actions.</p></header><div role="alert" data-error hidden></div><form data-design><div class="fields"><label>Study title<input name="title" value="Conservation action combinations" required></label><label>Retained baseline run<input name="baseline" list="combination-runs" autocomplete="off" required placeholder="Select or paste the complete native run ID"></label></div><datalist id="combination-runs"></datalist><p class="muted" data-baseline-note></p><div class="toolbar"><button type="button" data-action="runs-previous">Previous runs</button><button type="button" data-action="runs-next">More runs</button><span data-run-page></span></div><h2>Ordered conservation actions</h2><p>Each action uses patches from a saved scenario. Preview resolves the baseline-relative patch selection. The order below is the application order in every modeled combination, including overlapping edits.</p><div data-actions></div><button type="button" data-action="add-action">Add conservation action</button><fieldset><legend>Attribution design</legend><div class="fields"><label>Method<select name="estimator"><option value="exact">Exact coalition attribution</option><option value="permutation">Sample attribution paths</option></select></label><label>Sampled permutations<input name="permutations" type="number" min="1" value="128" step="1"></label><label>Random seed<input name="seed" type="number" min="0" value="0" step="1"></label><label>Maximum distinct cases<input name="max_cases" type="number" min="2" value="4096" step="1"></label></div><label class="check"><input name="pairwise" type="checkbox" checked>Include every pair interaction</label><p class="muted">Sampling changes attribution paths through the same ordered scenarios. Preview shows the distinct native cases before they are retained or queued.</p></fieldset><details><summary>Optional reporting zones</summary><div class="fields"><label>Retained polygon source<select name="zone"><option value="">Whole reporting area</option></select></label><label>Zone identity field<input name="zone_field" value="huc12"></label><label>Native layer override<input name="zone_layer"></label><label>Source feature filter, JSON object<textarea name="zone_where" rows="2"></textarea></label></div></details><div class="toolbar"><button type="submit" data-preview>Preview combinations</button><button type="button" data-action="save" data-save disabled>Save combination plan</button></div></form><section data-preview-result hidden></section><section><h2>Continue a saved combination study</h2><div class="toolbar"><select name="plans" aria-label="Saved combination study"></select><button type="button" data-action="refresh">Refresh studies</button></div><div class="toolbar"><label>Parallel native runs<input name="workers" type="number" min="1" step="1" value="1"></label><button type="button" data-action="prepare" data-needs-plan>Prepare cases</button><button type="button" data-action="run" data-needs-plan>Run and analyze / resume</button><button type="button" data-action="analyze" data-needs-plan>Reanalyze completed cases</button><button type="button" data-action="download-plan" data-needs-plan>Download plan</button></div><div data-plan></div><div data-operations></div></section><section data-result hidden></section><section data-method><h2>Reading the results</h2><p>Benefit is baseline export minus the combination export, on the same finite cells shared across every coalition and every selected metric. Nitrogen and phosphorus remain kg/year; sediment remains metric tonnes/year. Positive nonadditivity means the combined benefit exceeds the sum of standalone benefits.</p><p>Shapley attribution allocates the combined modeled benefit across the selected actions. Exact designs use every coalition. Sampled designs include the reported sampling error of marginal contributions. The attribution describes this saved set of actions and its global application order.</p></section></main>';


const metricName=value=>({nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment',n_export:'Nitrogen',p_export:'Phosphorus',sed_export:'Sediment'}[value]||String(value||'').replaceAll('_',' '));
const scopeKey=row=>JSON.stringify([row.scope_id??'',row.zone_id??null]);
const scopeName=row=>row.zone_id!=null?'Zone '+String(row.zone_id):'Whole reporting area';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const quantity=(value,units)=>finite(value)?fmt(value)+(units?' '+units:''):'Unavailable';
const card=(label,value)=>'<div class="result-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
const actionName=(rows,id)=>{const row=rows.find(x=>x.action_id===id);return row?.action_title||id;};

function renderNativeVersions(result){
 const cohort=result.native_versions;
 let output='<section><h3>Executed model versions</h3>';
 if(!cohort||!Array.isArray(cohort.models)||!cohort.runs||typeof cohort.runs!=='object'){
  return output+'<p>No per-model execution provenance was recorded in this saved result. Its original run identities and native output records remain in the retained selection.</p></section>';
 }
 const rows=[];
 const basis={completed_stage_runtime:'Completed native stage',observed_run_fallback:'Observed run metadata',requested_legacy:'Requested version (legacy)',unavailable:'Unavailable'};
 for(const [runId,versions] of Object.entries(cohort.runs)){
  if(!versions||typeof versions!=='object')continue;
  for(const model of cohort.models){
   const value=versions[model];
   if(!value||typeof value!=='object')continue;
   const reused=value.reused_from;
   rows.push([runId,String(model).toUpperCase(),value.comparison_version,
    basis[value.basis]||value.basis||'Not recorded',value.requested_version,value.stage_completed_at,
    reused?.run_id?String(reused.run_id)+' / '+String(reused.model||model):'']);
  }
 }
 if(!rows.length)return output+'<p>No per-model execution provenance was recorded in this saved result. Its original run identities and native output records remain in the retained selection.</p></section>';
 output+='<p>Each selected model uses a consistent comparison version across the retained combinations. Different selected models can have different versions.</p>'
  +table(['Native model','Comparison version'],cohort.models.map(model=>[String(model).toUpperCase(),cohort.versions?.[model]]))
  +'<details><summary>Run and model provenance ('+rows.length+' rows)</summary>'
  +table(['Run','Model','Comparison version','Version source','Requested version','Stage completed','Reused stage origin'],rows.slice(0,200))
  +(rows.length>200?'<p>Showing the first 200 rows. Download the tables or open the printable report to see every retained run and model.</p>':'')
  +'<p>Completed-stage records describe the executed stage and reused origin. Observed-run fallback uses retained run metadata. A requested legacy version is the saved request and is labeled separately from observed execution.</p>'
  +'<p>The complete source table and JSON retain observed stage/run versions, requested-version differences and the original nested stage-reuse record.</p></details></section>';
 return output;
}

export function renderNativeCombinationResult(result,selection={}){
 const summaries=result.summaries||[],scopes=[...new Map(summaries.map(row=>[scopeKey(row),row])).entries()];
 const metrics=[...new Set(summaries.map(row=>row.metric))];
 const chosenScope=scopes.some(([key])=>key===selection.scope)?selection.scope:scopes[0]?.[0]||'';
 const availableMetrics=[...new Set(summaries.filter(row=>scopeKey(row)===chosenScope).map(row=>row.metric))];
 const chosenMetric=availableMetrics.includes(selection.metric)?selection.metric:availableMetrics[0]||metrics[0]||'';
 const selected=rows=>(rows||[]).filter(row=>scopeKey(row)===chosenScope&&row.metric===chosenMetric);
 const totals=selected(summaries),attribution=selected(result.action_attribution),pairs=selected(result.pair_interactions),outcomes=selected(result.coalition_outcomes);
 const summary=totals[0],units=(summary?.units||'').replace('metric_tonnes','metric tonnes'),supported=summary&&summary.common_valid_cells>0&&finite(summary.common_area_ha)&&summary.common_area_ha>0;
 const percent=supported&&finite(summary.baseline_annual_export)&&summary.baseline_annual_export>0&&finite(summary.combined_benefit)?100*summary.combined_benefit/summary.baseline_annual_export:null;
 const reduction=supported?quantity(summary.combined_benefit,units)+(percent!=null?' ('+fmt(percent)+'%)':''):'Unavailable';
 const sampled=result.estimator==='permutation'||attribution.some(row=>row.allocation_method==='sampled_permutation_shapley');
 const title='Combined benefit and attribution';
 const toolbar='<div class="toolbar"><label>Reporting area<select name="result_scope">'+scopes.map(([key,row])=>'<option value="'+esc(key)+'"'+(key===chosenScope?' selected':'')+'>'+esc(scopeName(row))+'</option>').join('')+'</select></label><label>Pollutant<select name="result_metric">'+availableMetrics.map(value=>'<option value="'+esc(value)+'"'+(value===chosenMetric?' selected':'')+'>'+esc(metricName(value))+'</option>').join('')+'</select></label><button data-action="report-html">Download report</button><button data-action="report-csv">Download tables</button><button data-action="report-json">Download result JSON</button></div>';
 const cards='<div class="result-cards">'+card('Baseline annual export',supported?quantity(summary.baseline_annual_export,units):'Unavailable')+card('Combined annual export',supported?quantity(summary.combined_annual_export,units):'Unavailable')+card('Annual reduction',reduction)+card('Shared reporting area',supported?quantity(summary.common_area_ha,'ha'):'0 ha')+'</div>';
 let interpretation='<p class="result-reading">';
 if(!supported)interpretation+='No cells with finite values are shared by every modeled combination and selected pollutant in this reporting area. Choose another reporting area or inspect the common-support raster.';
 else if(!finite(summary.combined_benefit))interpretation+='The annual change is unavailable for this retained result.';
 else if(summary.combined_benefit>0)interpretation+='The combined actions reduce modeled '+esc(metricName(chosenMetric).toLowerCase())+' export by '+esc(quantity(summary.combined_benefit,units))+' relative to the baseline.';
 else if(summary.combined_benefit<0)interpretation+='The combined actions increase modeled '+esc(metricName(chosenMetric).toLowerCase())+' export by '+esc(quantity(-summary.combined_benefit,units))+' relative to the baseline.';
 else interpretation+='The combined actions leave modeled annual export unchanged on the shared reporting area.';
 interpretation+='</p>';
 const allocationHeaders=['Conservation action','Action alone ('+units+')','Allocated combined reduction ('+units+')'];
 if(sampled)allocationHeaders.push('Sampling standard error ('+units+')');
 const allocationRows=attribution.map(row=>[row.action_title||row.action_id,row.standalone_benefit,row.shapley_benefit,...(sampled?[row.permutation_sampling_standard_error]:[])]);
 let detail='<h3>Contributions of the actions</h3><p>The allocated reductions sum to the combined reduction. They account for how an action performs alongside the other selected actions; negative values represent increased export.</p>'+table(allocationHeaders,allocationRows);
 if(sampled)detail+='<p class="muted">The standard error describes variation across the sampled attribution paths. It does not represent model or field-measurement uncertainty.</p>';
 else detail+='<p class="muted">Exact attribution uses every combination of the selected actions.</p>';
 if(pairs.length)detail+='<h3>Interactions between pairs</h3><p>Additional reduction compares a pair with the sum of its two standalone reductions. Positive values indicate extra reduction when the actions are combined; negative values indicate less reduction than that sum.</p>'+table(['First action','Second action','Pair reduction ('+units+')','Additional reduction ('+units+')'],pairs.map(row=>[actionName(attribution,row.action_a),actionName(attribution,row.action_b),row.pair_benefit,row.pair_nonadditivity]));
 if(summary)detail+='<details><summary>Allocation and interaction balance</summary>'+table(['Measure',units||'Value'],[
  ['Sum of standalone reductions',summary.sum_standalone_benefit],
  ['Combined reduction',summary.combined_benefit],
  ['Additional combined reduction',summary.combined_nonadditivity],
  ['Sum of pair interactions',summary.sum_pair_nonadditivity],
  ['Remainder beyond pair interactions',summary.higher_order_remainder],
  ['Sum allocated to actions',summary.sum_allocated_benefit],
  ['Allocation residual',summary.allocation_efficiency_residual??summary.efficiency_residual]
 ])+'<p class="muted">The remainder covers interactions beyond pairs. Pair values and the remainder are unavailable when pair diagnostics were not selected.</p></details>';
 detail+='<details><summary>Modeled combinations ('+outcomes.length+')</summary>'+table(['Actions','Annual export ('+units+')','Annual reduction ('+units+')','Export outside common support ('+units+')'],outcomes.slice(0,200).map(row=>[(row.action_ids||[]).map(id=>actionName(attribution,id)).join(' + ')||'Baseline',row.annual_export,row.benefit,row.excluded_annual_export]))+(outcomes.length>200?'<p>Showing the first 200 combinations. Download tables includes every retained combination.</p>':'')+'</details>';
 const downloads=(result._downloads||[]).map(item=>'<a href="'+esc('/api/file/'+encodeURIComponent(item.id)+'?download=1')+'">'+esc(item.artifact_id.replaceAll('_',' '))+'</a>').join('');
 const method='<p class="muted">All compared exports use the same '+esc(fmt(summary?.common_valid_cells??0))+' finite cells across every combination and selected pollutant. Actions apply in the saved order: '+esc((result.application_order||[]).map(id=>actionName(attribution,id)).join(' → '))+'.</p>';
 return '<h2>'+title+'</h2>'+toolbar+cards+interpretation+detail+renderNativeVersions(result)+'<h3>Spatial results and source tables</h3><div class="toolbar">'+downloads+'</div>'+method;
}

export function createNativeInteractions(host){
 let root=null,key=null,epoch=0,abort=null,busy=false,catalog=null,offset=0;
 let actions=[],preview=null,previewKey=null,plan=null,result=null,planStamp='',stateStamp='';
 let catalogRead=0,planRead=0,resultRead=0,previewRead=0,pending=null,watch=null,watchRead=null,casePage=0,caseFilter='';
 const workspace=()=>host.getWorkspace?.()||host.getState()?.workspace_key;
 const alive=e=>root&&e===epoch&&workspace()===key;
 const $=s=>root?.querySelector(s);
 const $$=s=>root?[...root.querySelectorAll(s)]:[];
 const draftKey=()=> 'upstate-native-combinations:'+key;
 const endpoint=(path,values={})=>path+'?'+new URLSearchParams({workspace:key,...values});
 const api=(path,options={})=>host.api(path,{...options,signal:abort.signal});
 function error(value,e=epoch){if(!alive(e)||value?.name==='AbortError')return;$('[data-error]').textContent=value?.message||String(value);$('[data-error]').hidden=false;}
 function clearError(){if(root)$('[data-error]').hidden=true;}
 function readRows(){return $$('[data-row]').map(row=>({id:row.querySelector('[name=action_id]').value,title:row.querySelector('[name=action_title]').value,scenario_id:row.querySelector('[name=scenario]').value,patches:row.querySelector('[name=patches]').value}));}
 function draft(){
  const d={actions:readRows()};
  for(const name of ['title','baseline','estimator','permutations','seed','max_cases','zone','zone_field','zone_layer','zone_where','workers'])d[name]=$('[name='+name+']').value;
  d.pairwise=$('[name=pairwise]').checked;d.plan_id=$('[name=plans]').value;return d;
 }
 function saveDraft(){if(root)try{sessionStorage.setItem(draftKey(),JSON.stringify(draft()));}catch{}}
 function invalidate(){preview=null;previewKey=null;previewRead++;if(root){$('[data-preview-result]').hidden=true;buttons();}saveDraft();}
 function buttons(){
  if(!root)return;
  $$('button').forEach(x=>{if(x.dataset.action!=='open-task')x.disabled=busy;});
  $('[data-save]').disabled=busy||!preview||!previewKey;
  $$('[data-needs-plan]').forEach(x=>x.disabled=busy||!plan?.id);
  $('[data-action=runs-previous]').disabled=busy||offset===0;
  $('[data-action=runs-next]').disabled=busy||catalog?.next_offset==null;
  $('[name=plans]').disabled=busy;
  $('[name=permutations]').disabled=busy||$('[name=estimator]').value!=='permutation';
  $('[name=workers]').disabled=busy;
  const previousCases=$('[data-action=cases-previous]'),nextCases=$('[data-action=cases-next]');
  if(previousCases)previousCases.disabled=busy||casePage===0;
  if(nextCases)nextCases.disabled=busy||nextCases.dataset.last==='true';
 }
 function actionRows(){
  const options=(catalog?.actions||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+' ('+x.patch_count+' patches)</option>').join('');
  $('[data-actions]').innerHTML=actions.map((a,index)=>'<fieldset data-row="'+index+'"><legend>Action '+(index+1)+'</legend><div class="fields"><label>Action ID<input name="action_id" required value="'+esc(a.id)+'"></label><label>Action title<input name="action_title" value="'+esc(a.title)+'"></label><label>Saved scenario<select name="scenario"><option value="">Choose a retained scenario</option>'+options+'</select></label><label>Patch indexes, optional<input name="patches" placeholder="Baseline-relative default; or 0, 2, 3" value="'+esc(a.patches)+'"></label></div><div class="toolbar"><button type="button" data-action="up" data-index="'+index+'">Move up</button><button type="button" data-action="down" data-index="'+index+'">Move down</button><button type="button" data-action="remove" data-index="'+index+'">Remove action</button><span class="muted" data-action-note></span></div><div data-patch-details></div></fieldset>').join('');
  $$('[data-row]').forEach((row,index)=>{
   const a=actions[index],select=row.querySelector('[name=scenario]');select.value=a.scenario_id||'';
   if(a.scenario_id&&!select.value){const option=root.ownerDocument.createElement('option');option.value=a.scenario_id;option.textContent='Retained scenario '+short(a.scenario_id);select.append(option);select.value=a.scenario_id;}
   const selected=catalog?.actions?.find(x=>x.id===a.scenario_id);row.querySelector('[data-action-note]').textContent=selected?selected.patch_count+' original patches; source '+short(selected.source_collection_id):'';
   row.querySelector('[data-patch-details]').innerHTML=selected?'<details><summary>Inspect saved scenario patches</summary>'+table(['Index','Mask source','Original classes','Destination class','Layer / filter','Purpose'],(selected.patches||[]).map((p,i)=>[i,p.mask_source_id,(p.from_codes||[]).join(', '),p.to_code,[p.layer||'native layer',p.where?JSON.stringify(p.where):''].filter(Boolean).join(' / '),p.reason]))+'</details>':'';
  });buttons();
 }
 function selection(){
  const d=draft(),rows=d.actions.map((a,index)=>{
   if(!a.id.trim()||!a.scenario_id)throw Error('Choose an ID and retained scenario for action '+(index+1)+'.');
   const row={id:a.id.trim(),scenario_id:a.scenario_id};if(a.title.trim())row.title=a.title.trim();
   if(a.patches.trim()){
    const values=a.patches.split(',').map(v=>v.trim());
    if(values.some(v=>!/^(0|[1-9][0-9]*)$/.test(v)))throw Error('Patch indexes must be comma-separated nonnegative integers.');
    row.patch_indexes=values.map(Number);
    if(row.patch_indexes.some(v=>!Number.isSafeInteger(v))||new Set(row.patch_indexes).size!==row.patch_indexes.length)throw Error('Use distinct exact patch indexes.');
   }return row;
  });
  if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Give each conservation action a distinct ID.');
  const value={title:d.title.trim(),baseline_run_id:d.baseline.trim(),actions:rows,estimator:d.estimator,permutations:Number(d.permutations),seed:Number(d.seed),max_cases:Number(d.max_cases),include_pairwise:d.pairwise};
  if(!value.title||!value.baseline_run_id||rows.length<2)throw Error('Choose a title, retained baseline and at least two actions.');
  for(const field of ['permutations','seed','max_cases'])if(!Number.isSafeInteger(value[field])||value[field]<(field==='seed'?0:1))throw Error('Choose a valid integer for '+field.replaceAll('_',' ')+'.');
  if(d.zone){const zone=(catalog?.zones||[]).find(z=>z.collection_id+'/'+z.source_id===d.zone);if(!zone)throw Error('Choose a retained polygon source.');
   value.zones={source_collection_id:zone.collection_id,source_id:zone.source_id,id_field:d.zone_field.trim()};
   if(d.zone_layer.trim()||zone.layer)value.zones.layer=d.zone_layer.trim()||zone.layer;
   if(d.zone_where.trim()){const where=JSON.parse(d.zone_where);if(!where||Array.isArray(where)||typeof where!=='object')throw Error('The zone feature filter must be a JSON object.');value.zones.where=where;}
  }return value;
 }
 function showPreview(value){
  const s=value.summary||{};
  $('[data-preview-result]').innerHTML='<h2>Native combination design</h2>'+table(['Actions','Distinct coalitions','Additional cases','Estimator','Selected models'],[[s.action_count,s.coalition_count,s.nonbaseline_case_count,s.estimator,(s.selected_models||[]).join(', ')]])+
   table(['Action','Saved scenario','Applied patch indexes','Patch count'],(value.actions||[]).map(a=>[a.title||a.id,a.scenario_id,(a.patch_indexes||[]).join(', '),a.patch_count]))+
   '<p>Action order: '+esc(Array.isArray(value.application_order)?value.application_order.join(' → '):(value.application_order||'The saved action order applies to every coalition.'))+'</p><p>'+esc(value.overlap_semantics||'Baseline patches apply first; each action sees preceding patch results.')+'</p><p>'+esc(value.support_definition||'All coalition exports share one finite reporting support per reported scope.')+'</p>'+
   '<details><summary>Complete design and retained scenario bindings</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
  $('[data-preview-result]').hidden=false;buttons();
 }
 async function loadCatalog(){
  const e=epoch,n=++catalogRead,requestedOffset=offset;
  const value=await api(endpoint('/api/native-interactions/catalog',{offset:requestedOffset,limit:100}));
  if(!alive(e)||n!==catalogRead)return;
  const current=draft();actions=current.actions;catalog=value;
  $('[id=combination-runs]').innerHTML=value.runs.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.scenario_title+' / '+r.profile_title+' / '+r.state)+'</option>').join('');
  $('[data-run-page]').textContent=value.total?(value.offset+1)+'–'+(value.offset+value.runs.length)+' of '+value.total+' retained runs':'No retained runs yet';
  $('[name=zone]').innerHTML='<option value="">Whole reporting area</option>'+value.zones.map(z=>'<option value="'+esc(z.collection_id+'/'+z.source_id)+'">'+esc(z.title+' / '+z.collection_title)+'</option>').join('');
  $('[name=zone]').value=current.zone;
  const chosen=current.plan_id||plan?.id||'';
  $('[name=plans]').innerHTML='<option value="">Choose a retained study</option>'+value.plans.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title+' · '+(p.state||'planned'))+'</option>').join('');
  $('[name=plans]').value=chosen;
  actionRows();selectionNote();buttons();
  if(chosen&&value.plans.some(p=>p.id===chosen))await loadPlan(chosen);
 }
 function selectionNote(){
  const id=$('[name=baseline]').value.trim(),run=catalog?.runs.find(r=>r.id===id);
  $('[data-baseline-note]').textContent=run?run.scenario_title+' / '+run.profile_title+' · '+run.state+' · grid '+short(run.selection.grid_id):'The full retained run ID can also be pasted from Native runs.';
 }
 function renderPlan(){
  if(!plan){$('[data-plan]').innerHTML='';return;}
  const oldDetails=$('[data-case-details]'),detailsOpen=oldDetails?.open||false;
  const s=plan.state||{},cases=Object.values(s.cases||{}),summary=plan.preview?.summary||{},progress=s.analysis_progress||{};
  const pool=Array.isArray(s.active_cases)?s.active_cases:(s.active_case?[s.active_case]:[]);
  const active=pool.length?table(['Running combination','Native run','State','Model stage'],pool.map(item=>{const retained=s.cases?.[item.coalition_key];return [(retained?.action_ids||[]).map(id=>plan.actions?.find(action=>action.id===id)?.title||id).join(' + ')||(item.coalition_key==='baseline'?'Baseline':item.coalition_key),item.run_id,item.native_state||s.state,[item.model,item.phase].filter(Boolean).join(' / ')];})):'';
  const execution=s.execution?'<p class="muted">'+esc(fmt(s.execution.workers))+' parallel native run'+(s.execution.workers===1?'':'s')+' · '+esc(fmt(s.execution.finished_runs||0))+' runs finished in this operation · '+esc(fmt(s.execution.skipped_complete_runs||0))+' completed runs reused.</p><p class="muted">Retained stage records: '+esc(fmt(s.execution.reused_stage_records||0))+' reused and '+esc(fmt(s.execution.native_stage_records||0))+' executed.</p>':'';
  const analysis=progress.total_rasters!=null?'<p>Common reporting area: '+esc(fmt(progress.completed_rasters||0))+' of '+esc(fmt(progress.total_rasters))+' native rasters processed.</p>':progress.completed_outcome_rows!=null?'<p>Annual export: '+esc(fmt(progress.completed_outcome_rows))+' reporting rows calculated.</p>':'';
  const states=[...new Set(cases.map(x=>x.state||'planned'))].sort();
  if(caseFilter&&!states.includes(caseFilter))caseFilter='';
  const filtered=caseFilter?cases.filter(x=>(x.state||'planned')===caseFilter):cases;
  const pages=Math.max(1,Math.ceil(filtered.length/200));casePage=Math.max(0,Math.min(casePage,pages-1));
  const controls='<div class="toolbar"><label>Case state<select name="case_state"><option value="">All states</option>'+states.map(value=>'<option value="'+esc(value)+'"'+(value===caseFilter?' selected':'')+'>'+esc(value)+'</option>').join('')+'</select></label><button type="button" data-action="cases-previous">Previous cases</button><span>Page '+(casePage+1)+' of '+pages+' · '+filtered.length+' cases</span><button type="button" data-action="cases-next" data-last="'+(casePage>=pages-1?'true':'false')+'">More cases</button></div>';
  $('[data-plan]').innerHTML='<h3>'+esc(plan.title)+'</h3>'+table(['State','Phase','Completed cases','Required coalitions'],[[s.state||'planned',s.phase||'planned',s.completed_cases??cases.filter(x=>x.state==='complete').length,summary.coalition_count??plan.coalitions?.length]])+
   execution+active+analysis+(s.errors?.length?'<div class="notice">'+esc(JSON.stringify(s.errors))+'</div>':'')+
   '<details data-case-details'+(detailsOpen?' open':'')+'><summary>Retained native case bindings ('+cases.length+')</summary>'+(s.case_status_snapshot_at?'<p class="muted">Case details saved '+esc(s.case_status_snapshot_at)+'. The completion count above follows the current operation.</p>':'')+controls+table(['Coalition','Actions','Native run','State'],filtered.slice(casePage*200,(casePage+1)*200).map(x=>[x.key,(x.action_ids||[]).join(', '),x.run_id,x.state]))+'<p class="muted">Download plan includes every retained case binding.</p></details>';
  buttons();
  $('[data-action=cases-previous]').disabled=busy||casePage===0;
  $('[data-action=cases-next]').disabled=busy||casePage>=pages-1;
 }
 async function loadPlan(id,force=false){
  const e=epoch,n=++planRead,row=catalog?.plans?.find(p=>p.id===id),stamp=JSON.stringify([id,row?.state,row?.phase,row?.updated_at,row?.completed_cases,row?.result_id]);
  if(!force&&plan?.id===id&&stamp===planStamp)return;
  const value=await api(endpoint('/api/native-interactions/plan',{id}));
  if(!alive(e)||n!==planRead||$('[name=plans]').value!==id)return;
  plan=value;planStamp=stamp;renderPlan();saveDraft();
  const resultId=value.state?.result_id;
  if(resultId&&result?.id!==resultId)await loadResult(resultId);
  else if(!resultId){result=null;$('[data-result]').hidden=true;}
 }
 function renderResult(){
  if(!result){$('[data-result]').hidden=true;return;}
  const scope=$('[name=result_scope]')?.value||'',metric=$('[name=result_metric]')?.value||'';
  $('[data-result]').innerHTML=renderNativeCombinationResult(result,{scope,metric});
  $('[data-result]').hidden=false;buttons();
 }
 async function loadResult(id){
  const e=epoch,n=++resultRead,value=await api(endpoint('/api/native-interactions/result',{id}));
  if(!alive(e)||n!==resultRead||plan?.state?.result_id!==id)return;
  result=value;renderResult();
 }
 function operations(state){
  if(!root)return;
  const rows=(state?.tasks||state?.data?.tasks||[]).filter(t=>t.workspace===key&&String(t.action||'').startsWith('interaction.'));
  $('[data-operations]').innerHTML=rows.length?'<h3>Operations</h3>'+rows.map(t=>'<div class="operation"><span>'+esc(t.action+' · '+t.state+' · '+short(t.id))+'</span><button type="button" data-action="open-task" data-task="'+esc(t.id)+'">Open operation</button></div>').join(''):'';
 }
 async function runAction(action,payload){
  const e=epoch,selectedWorkspace=key,priorPlan=$('[name=plans]').value;
  const operationKey='upstate-combination-operation:'+key+':'+action+':'+JSON.stringify(payload);
  let operationId;try{operationId=sessionStorage.getItem(operationKey);}catch{}
  if(!operationId){operationId=crypto.randomUUID();try{sessionStorage.setItem(operationKey,operationId);}catch{}}
  const task=await api('/api/actions',{method:'POST',body:{workspace:selectedWorkspace,action,payload,operation_id:operationId}});
  const next={id:task.id,action,plan_id:payload.plan_id||null,prior_plan:priorPlan};
  try{sessionStorage.removeItem(operationKey);sessionStorage.setItem('upstate-combination-task:'+selectedWorkspace,JSON.stringify(next));}catch{}
  if(!alive(e))return;watch=next;
  if(host.showTask)await host.showTask(task.id,false);
  if(host.refresh)await host.refresh({force:true});
  if(alive(e)){await loadCatalog();await pollOperation();}
 }
 async function pollOperation(){
  if(!root||!watch)return;const e=epoch,id=watch.id,reading=e+':'+id;
  if(watchRead===reading)return;watchRead=reading;
  try{
   const task=await api(endpoint('/api/task',{id}));if(!alive(e)||watch?.id!==id)return;
   if(['complete','failed','error','cancelled','interrupted'].includes(task.state)){
    const terminalError=task.state==='complete'?null:(task.error?.message||task.error||task.message||'The operation '+task.state+'. Open the operation for details.');
    const done=watch;watch=null;try{sessionStorage.removeItem('upstate-combination-task:'+key);}catch{}
    const selected=$('[name=plans]').value;await loadCatalog();if(!alive(e))return;
    if(done.action==='interaction.plan'&&task.result?.id&&$('[name=plans]').value===selected&&selected===done.prior_plan){
     $('[name=plans]').value=task.result.id;plan=null;result=null;planStamp='';await loadPlan(task.result.id,true);
    }else if(done.plan_id&&$('[name=plans]').value===done.plan_id)await loadPlan(done.plan_id,true);
    if(terminalError)error(typeof terminalError==='string'?terminalError:JSON.stringify(terminalError),e);
   }
  }catch(ex){error(ex,e);}finally{if(watchRead===reading)watchRead=null;}
 }
 function download(body,filename,type){
  const url=URL.createObjectURL(new Blob([body],{type})),a=root.ownerDocument.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function guarded(fn){
  if(busy||!root)return;const e=epoch;busy=true;clearError();buttons();
  try{await fn();}catch(ex){error(ex,e);}finally{if(alive(e)){busy=false;buttons();}}
 }
 async function clicked(event){
  const button=event.target.closest('[data-action]');if(!button||!root.contains(button))return;
  const action=button.dataset.action;
  if(action==='open-task'){if(host.showTask)await host.showTask(button.dataset.task);return;}
  await guarded(async()=>{
   if(['add-action','up','down','remove'].includes(action)){
    actions=readRows();const index=Number(button.dataset.index);
    if(action==='add-action'){let n=actions.length+1;while(actions.some(a=>a.id==='action-'+n))n++;actions.push({id:'action-'+n,title:'',scenario_id:'',patches:''});}
    if(action==='remove')actions.splice(index,1);
    if(action==='up'&&index>0)[actions[index-1],actions[index]]=[actions[index],actions[index-1]];
    if(action==='down'&&index<actions.length-1)[actions[index+1],actions[index]]=[actions[index],actions[index+1]];
    actionRows();invalidate();return;
   }
   if(action==='cases-previous'||action==='cases-next'){casePage+=action==='cases-previous'?-1:1;renderPlan();return;}
   if(action==='runs-previous'||action==='runs-next'){offset=action==='runs-previous'?Math.max(0,offset-100):catalog.next_offset;await loadCatalog();return;}
   if(action==='refresh'){planStamp='';await loadCatalog();return;}
   if(action==='save'){const value=selection();if(!preview||JSON.stringify(value)!==previewKey)throw Error('Preview the current action choices before saving.');await runAction('interaction.plan',{selection:value});return;}
   if(action==='prepare'||action==='run'){const workers=Number($('[name=workers]').value);if(!Number.isSafeInteger(workers)||workers<1)throw Error('Choose a positive whole number of parallel native runs.');await runAction('interaction.apply',{plan_id:plan.id,run_models:action==='run',workers});return;}
   if(action==='analyze'){await runAction('interaction.analyze',{plan_id:plan.id});return;}
   if(action==='download-plan'){download(JSON.stringify(plan,null,2)+'\n','combination-plan-'+short(plan.id)+'.json','application/json');return;}
   if(action.startsWith('report-')){
    const e=epoch,id=result.id,format=action.slice(7),value=await api(endpoint('/api/native-interactions/report',{id}));
    if(!alive(e)||result?.id!==id)return;
    const body=format==='json'?JSON.stringify(value.json,null,2)+'\n':value[format];
    download(body,'combination-result-'+short(id)+'.'+format,format==='html'?'text/html;charset=utf-8':format==='csv'?'text/csv;charset=utf-8':'application/json');
   }
  });
 }
 async function mount(node){
  detach();root=node;key=workspace();const e=epoch;abort=new AbortController();root.innerHTML=template;
  let d={};try{const saved=JSON.parse(sessionStorage.getItem(draftKey())||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))d=saved;}catch{}
  for(const name of ['title','baseline','estimator','permutations','seed','max_cases','zone_field','zone_layer','zone_where','workers'])if(d[name]!==undefined)$('[name='+name+']').value=d[name];
  $('[name=pairwise]').checked=d.pairwise??true;actions=Array.isArray(d.actions)&&d.actions.length?d.actions:[{id:'action-1',title:'',scenario_id:'',patches:''}];
  if(d.plan_id){const o=root.ownerDocument.createElement('option');o.value=d.plan_id;o.textContent=short(d.plan_id);$('[name=plans]').append(o);$('[name=plans]').value=d.plan_id;}
  if(d.zone){const o=root.ownerDocument.createElement('option');o.value=d.zone;o.textContent=d.zone;$('[name=zone]').append(o);$('[name=zone]').value=d.zone;}
  actionRows();
  root.addEventListener('click',event=>{if(event.target.closest('[data-action]')){event.preventDefault();event.stopPropagation();}clicked(event).catch(ex=>error(ex,e));},{signal:abort.signal});
  root.addEventListener('input',event=>{if(event.target.closest('[data-design]')){invalidate();selectionNote();}},{signal:abort.signal});
  root.addEventListener('change',event=>{
   if(event.target.name==='plans'){casePage=0;caseFilter='';plan=null;result=null;planStamp='';renderPlan();$('[data-result]').hidden=true;saveDraft();if(event.target.value)loadPlan(event.target.value,true).catch(ex=>error(ex,e));}
   else if(['result_scope','result_metric'].includes(event.target.name))renderResult();
   else if(event.target.name==='workers')saveDraft();
   else if(event.target.name==='case_state'){casePage=0;caseFilter=event.target.value;renderPlan();}
   else if(event.target.closest('[data-design]')){actions=readRows();if(event.target.name==='scenario')actionRows();invalidate();selectionNote();}
  },{signal:abort.signal});
  $('[data-design]').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
   const value=selection(),stamp=JSON.stringify(value),n=++previewRead;
   const response=await api(endpoint('/api/native-interactions/preview'),{method:'POST',body:{workspace:key,selection:value}});
   if(!alive(e)||n!==previewRead||JSON.stringify(selection())!==stamp)return;
   preview=response;previewKey=stamp;showPreview(response);
  });},{signal:abort.signal});
  try{try{watch=JSON.parse(sessionStorage.getItem('upstate-combination-task:'+key)||'null');}catch{}await loadCatalog();if(!alive(e))return;operations(host.getState());if(watch)await pollOperation();if(!alive(e))return;if(pending){const value=pending;pending=null;if(value.workspace===key)await openDesign(value.selection);}}
  catch(ex){if(alive(e)&&ex?.name!=='AbortError')throw ex;}
 }
 function update(state){
  if(!root)return;if(workspace()!==key){detach();return;}operations(state);if(watch)pollOperation();
  const rows=(state?.tasks||state?.data?.tasks||[]).filter(t=>t.workspace===key&&String(t.action||'').startsWith('interaction.'));
  const progress=state?.data?.native_interactions?.plans||state?.native_interactions?.plans||[];
  const stamp=JSON.stringify([rows.map(t=>[t.id,t.state,t.updated_at,t.ended_at]),progress.map(p=>[p.id,p.state,p.phase,p.updated_at,p.completed_cases,p.result_id])]);
  if(stamp!==stateStamp){stateStamp=stamp;if(!busy)loadCatalog().catch(ex=>error(ex));}
 }
 function detach(){if(root)saveDraft();epoch++;abort?.abort();root=null;key=null;abort=null;busy=false;watch=null;watchRead=null;catalog=null;offset=0;casePage=0;caseFilter='';plan=null;result=null;preview=null;previewKey=null;planStamp='';stateStamp='';catalogRead++;planRead++;resultRead++;previewRead++;}
 async function openDesign(value){
  if(root&&key!==workspace())detach();
  if(!root){pending={workspace:workspace(),selection:JSON.parse(JSON.stringify(value))};await host.navigate?.('native-interactions');return;}
  $('[name=baseline]').value=value.baseline_run_id||'';
  $('[name=title]').value=value.title||'Conservation action combinations';
  actions=(Array.isArray(value.actions)?value.actions:[]).map((a,i)=>({...a,id:a.id||'action-'+(i+1),patches:(a.patch_indexes||[]).join(', ')}));
  if(!actions.length)actions=[{id:'action-1',title:'',scenario_id:'',patches:''}];
  for(const name of ['estimator','permutations','seed','max_cases'])if(value[name]!==undefined)$('[name='+name+']').value=value[name];
  $('[name=pairwise]').checked=value.include_pairwise??true;actionRows();invalidate();selectionNote();
 }
 return {mount,update,detach,openDesign};
}
