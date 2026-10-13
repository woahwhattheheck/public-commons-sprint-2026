/* Utility source-area comparison desk, using the maintained operator host. */
import {nativeModelsForOutputs, nativeCommonVersionIssues, nativeModelVersionLabel} from './native_versions.mjs';
const POLLUTANTS = ['nitrogen_export', 'phosphorus_export', 'sediment_export'];
const NAMES = {nitrogen_export:'Nitrogen', phosphorus_export:'Phosphorus', sediment_export:'Sediment'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = (value, digits=3) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? '\u2014' : Number(value).toLocaleString(undefined, {maximumFractionDigits:digits});
const date = value => value ? new Date(value).toLocaleString() : '\u2014';
const short = value => String(value || '').slice(0, 10);
const signed = (value, digits=3) => value === null || value === undefined ? '\u2014'
  : (Number(value)>0 ? '+' : '') + number(value,digits);
const percent = value => value === null || value === undefined ? '\u2014' : number(value,2)+'%';
const size = value => value >= 1048576 ? number(value/1048576,1)+' MB' : number(value/1024,1)+' KB';
const button = (action, title, attrs='') => '<button type="button" data-action="utility-cohort-'+action+'" '+attrs+'>'+esc(title)+'</button>';
const option = (id,title) => '<option value="'+esc(id)+'">'+esc(title)+'</option>';
const sourceKey = value => JSON.stringify([value.source_collection_id,value.source_id]);
const stable = value => JSON.stringify(value, function(key,item){
  return item && !Array.isArray(item) && typeof item==='object'
    ? Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])) : item;
});
function gridPoints(count) { return count===3 ? 15 : count===2 ? 5 : count===1 ? 1 : 0; }
const referenceOnly = value => value?.report_kind
  ? value.report_kind==='reference_totals' : value?.run_ids?.length===1;
const kindTitle = value => referenceOnly(value)?'Reference totals':'Scenario comparisons';
const coveragePercent = value => value===null||value===undefined?'\u2014':percent(100*value);

export function utilityCommonOutputs(runs) {
  return runs?.length && runs.every(Boolean)
    ? POLLUTANTS.filter(name=>runs.every(run=>(run.comparison_pollutants||[]).includes(name))) : [];
}
export function utilityVersionIssues(runs, outputs=utilityCommonOutputs(runs)) {
  const models=nativeModelsForOutputs(outputs);
  const issues=nativeCommonVersionIssues(runs,models);
  if(!models.length)return issues;
  for(const run of runs||[]){
    if(!run)continue;
    for(const output of outputs){
      const eligibility=run.version_eligibility?.[output];
      if(eligibility?.eligible!==true)
        issues.push(eligibility?.reason||(run.title||run.id)+': refresh the original model execution for '+NAMES[output]+'.');
    }
  }
  return [...new Set(issues)];
}

export function attachUtilityCohorts(context) {
  let root=null, workspace=null, state=null, controller=null, epoch=0, rowsEpoch=0;
  let catalog=null, catalogPromise=null, catalogAgain=false, catalogSignal='';
  let selectedId=null, packet=null, rowPage=null, lastTaskId=null, pendingOpen=false;
  let lastSubmission=null, draft={}, filters={region_id:'',run_id:'',pollutant:'',view:'physical',offset:0};
  let submitting=false, previewing=false, detailLoading=false;
  const $ = selector => root?.querySelector(selector);
  const $$ = selector => [...(root?.querySelectorAll(selector)||[])];
  const current = token => !!root && token===epoch && context.getState()?.workspace_key===workspace;
  const storageKey = () => 'upstate.utility-cohorts.v2.'+workspace;
  const run = id => catalog?.runs.find(item=>item.id===id);
  function loadSaved() {
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey())||'{}');
      draft=saved.draft||{}; filters={...filters,...saved.filters,offset:0};
      selectedId=saved.selectedId||null; lastTaskId=saved.lastTaskId||null;
      lastSubmission=saved.lastSubmission||null;
    } catch { draft={}; }
  }
  function persist() {
    try { localStorage.setItem(storageKey(),JSON.stringify({draft,filters,selectedId,lastTaskId,lastSubmission})); }
    catch { /* Calculation and operation identity are retained by the original server. */ }
  }
  function error(message) {
    const node=$('[data-error]');
    if(node){node.textContent=message||'';node.hidden=!message;}
  }
  function request(path, values={}) {
    return context.api(context.endpoint('/api/utility-cohorts/'+path,{workspace,...values}));
  }
  function selectedRuns() {
    const baseline=run($('[name="baseline"]')?.value);
    return baseline?[baseline,...$$('[name="alternative"]:checked').map(input=>run(input.value))]:[];
  }
  function commonOutputs() {
    return utilityCommonOutputs(selectedRuns());
  }
  function readDraft() {
    if(!$('[data-builder]'))return draft;
    return {
      title:$('[name="title"]').value,source:$('[name="source"]').value,
      baseline:$('[name="baseline"]').value,
      alternatives:$$('[name="alternative"]:checked').map(input=>input.value),
      parameters:$('[name="parameters"]').checked,
      weights:Object.fromEntries(POLLUTANTS.map(name=>[name,$('[name="weight-'+name+'"]').value])),
      caps:Object.fromEntries(POLLUTANTS.map(name=>[name,$('[name="cap-'+name+'"]').value])),
      mode:$('[name="normalization"]').value,percentile:$('[name="percentile"]').value,
      grid:$('[name="weight-grid"]').checked,
    };
  }
  function saveDraft(){draft=readDraft();persist();}
  function selected() {
    const currentDraft=readDraft();
    const source=catalog?.sources.find(item=>sourceKey(item)===currentDraft.source);
    const baseline=run(currentDraft.baseline);
    if(!source)throw new Error('Select the imported original protection-area source edition.');
    if(!baseline?.eligible)throw new Error('Select a completed native baseline.');
    const pollutants=commonOutputs();
    if(!pollutants.length)throw new Error('The selected runs must share at least one completed native pollutant.');
    const versionIssues=utilityVersionIssues(selectedRuns(),pollutants);
    if(versionIssues.length)throw new Error(versionIssues.join(' '));
    const weights=Object.fromEntries(POLLUTANTS.map(name=>[name,pollutants.includes(name)?Number(currentDraft.weights[name]):0]));
    if(Object.values(weights).some(value=>!Number.isFinite(value)||value<0)||Object.values(weights).reduce((a,b)=>a+b,0)<=0)
      throw new Error('Use nonnegative planning weights with a positive total.');
    const planning={weights};
    if(currentDraft.mode==='caps'){
      planning.caps=Object.fromEntries(pollutants.map(name=>[name,Number(currentDraft.caps[name])]));
      if(pollutants.some(name=>currentDraft.caps[name]===''||!Number.isFinite(planning.caps[name])||planning.caps[name]<0))
        throw new Error('Enter a finite nonnegative fixed cap for each available pollutant.');
    } else {
      planning.percentile=Number(currentDraft.percentile);
      if(!Number.isFinite(planning.percentile)||planning.percentile<=0||planning.percentile>100)
        throw new Error('Choose a positive baseline percentile no greater than 100.');
    }
    return {
      title:currentDraft.title.trim()||'ARJWS and Pioneer native scenario priorities',
      source_collection_id:source.source_collection_id,source_id:source.source_id,
      baseline_run_id:baseline.id,scenario_run_ids:currentDraft.alternatives,
      planning,weight_grid:currentDraft.grid?4:0,
    };
  }
  function shell(){
    return '<div class="uc-desk">'+
      '<header class="uc-heading"><div><h2>Utility scenario cohorts</h2><p>Calculate reference exports and compare scenarios for the original ARJWS and Pioneer source-water protection areas in South Carolina on one fixed planning scale.</p></div>'+
      '<div class="uc-actions">'+button('refresh','Refresh choices')+button('sources','Study sources')+button('runs','Native runs')+'</div></header>'+
      '<div class="uc-error" data-error hidden role="alert"></div>'+
      '<section class="uc-section" aria-labelledby="uc-build-title"><h3 id="uc-build-title">Prepare utility outcomes</h3>'+
      '<form data-builder><div class="uc-grid"><label class="uc-wide">Title<input name="title" maxlength="240" value="ARJWS and Pioneer native scenario priorities"></label>'+
      '<label class="uc-wide">Original protection-area source<select name="source" required><option value="">Loading imported sources...</option></select><small data-source-note></small></label>'+
      '<label class="uc-wide">Reference native run<select name="baseline" required><option value="">Loading completed runs...</option></select><small>Select the regional study whose original reporting area overlaps these protection polygons.</small></label></div>'+
      '<fieldset><legend>Alternative native runs, optional</legend><label class="uc-check"><input type="checkbox" name="parameters">Include runs with a different parameter profile</label>'+
      '<p class="uc-note">The reference run produces source-area totals and priorities immediately. Select alternatives to compare their changes on that same grid. Parameter changes remain identified.</p><div data-alternatives class="uc-alternatives"></div></fieldset>'+
      '<fieldset><legend>Planning weights</legend><p data-pollutants class="uc-note">Choose the reference run and any alternatives to resolve the available native outputs.</p><p data-native-versions class="uc-note" aria-live="polite"></p><div class="uc-grid uc-three">'+
      POLLUTANTS.map(name=>'<label>'+NAMES[name]+'<input type="number" name="weight-'+name+'" min="0" step="any" value="1"></label>').join('')+
      '</div><label class="uc-check"><input type="checkbox" name="weight-grid"><span data-grid-label>Compare all 15 planning ratios</span></label>'+
      '<p class="uc-note" data-grid-note>The optional grid spans the available pollutants in quarter-step ratios. The selected weights remain the primary result.</p></fieldset>'+
      '<fieldset><legend>Fixed baseline scale</legend><div class="uc-grid"><label>Normalization<select name="normalization"><option value="percentile">Baseline positive-value percentile</option><option value="caps">Retained physical caps</option></select></label>'+
      '<label data-percentile>Baseline percentile<input type="number" name="percentile" min="0.000001" max="100" step="any" value="95"></label></div>'+
      '<div data-caps hidden><div class="uc-grid uc-three">'+POLLUTANTS.map(name=>'<label>'+NAMES[name]+' cap<small>'+(name==='sediment_export'?'metric tonnes/year/pixel':'kg/year/pixel')+'</small><input type="number" name="cap-'+name+'" min="0" step="any"></label>').join('')+'</div></div>'+
      '<p class="uc-note">Caps are frozen from the selected baseline and reused across every alternative and weight set. Physical export masses retain their original units.</p></fieldset>'+
      '<div class="uc-actions">'+button('preview','Inspect source areas')+'<button type="submit" data-build>Build utility cohort</button><span data-submit-note class="uc-note"></span></div></form>'+
      '<div data-preview hidden></div></section>'+
      '<section class="uc-section" aria-labelledby="uc-operations-title"><h3 id="uc-operations-title">Current operations</h3><div data-tasks></div></section>'+
      '<section class="uc-section" aria-labelledby="uc-saved-title"><h3 id="uc-saved-title">Retained utility cohorts</h3><div data-saved></div></section>'+
      '<section class="uc-section" data-result hidden aria-live="polite"><div data-result-heading></div><div data-result-progress></div><div data-result-content></div></section></div>';
  }
  function fillChoices() {
    if(!catalog||!root)return;
    const saved={...draft};
    $('[name="source"]').innerHTML='<option value="">Select the retained source edition</option>'+
      catalog.sources.map(source=>option(sourceKey(source),source.title+' / '+(source.vintage||short(source.source_collection_id)))).join('');
    $('[name="source"]').value=catalog.sources.some(source=>sourceKey(source)===saved.source)?saved.source:
      catalog.sources.length===1?sourceKey(catalog.sources[0]):'';
    const baselineOptions=catalog.runs.filter(item=>item.eligible);
    $('[name="baseline"]').innerHTML='<option value="">Select the completed baseline</option>'+baselineOptions.map(item=>
      option(item.id,item.title+' / '+item.profile_title+' / '+item.comparison_pollutants.map(name=>NAMES[name]).join(', ')+' / '+
        nativeModelVersionLabel(item,nativeModelsForOutputs(item.comparison_pollutants))+' / '+short(item.id))).join('');
    const preferred=baselineOptions.find(item=>item.id===saved.baseline)||
      baselineOptions.find(item=>item.scenario_kind==='baseline');
    $('[name="baseline"]').value=preferred?.id||'';
    $('[name="title"]').value=saved.title||'ARJWS and Pioneer native scenario priorities';
    $('[name="parameters"]').checked=!!saved.parameters;
    $('[name="normalization"]').value=saved.mode==='caps'?'caps':'percentile';
    $('[name="percentile"]').value=saved.percentile??95;
    $('[name="weight-grid"]').checked=!!saved.grid;
    POLLUTANTS.forEach(name=>{
      $('[name="weight-'+name+'"]').value=saved.weights?.[name]??1;
      $('[name="cap-'+name+'"]').value=saved.caps?.[name]??'';
    });
    alternatives(saved.alternatives||[]);
    updatePlanning();sourceNote();saveDraft();
    if(!catalog.sources.length)
      $('[data-source-note]').textContent='Prepare the original four source-water protection polygons with the existing public-water source importer. Its returned collection will appear here.';
    if(!baselineOptions.length)
      $('[data-alternatives]').innerHTML='<p class="uc-note">Complete the selected native model in Native runs. Its retained exports will appear here.</p>'+
        catalog.runs.map(item=>'<p><strong>'+esc(item.title)+'</strong><br><small>'+esc(item.note)+'</small></p>').join('');
  }
  function alternatives(checked=[]) {
    const baseline=run($('[name="baseline"]').value),chosen=new Set(checked);
    const includeParameters=$('[name="parameters"]').checked;
    const candidates=catalog.runs.filter(item=>item.eligible&&item.id!==baseline?.id&&
      item.selection.grid_id===baseline?.selection.grid_id&&
      (includeParameters||item.selection.profile_id===baseline?.selection.profile_id));
    $('[data-alternatives]').innerHTML=candidates.length?candidates.map(item=>{
      const common=item.comparison_pollutants.filter(name=>baseline.comparison_pollutants.includes(name));
      return '<label class="uc-run-choice"><input type="checkbox" name="alternative" value="'+esc(item.id)+'" '+
        (chosen.has(item.id)&&common.length?'checked ':'')+(!common.length?'disabled ':'')+'><span><strong>'+esc(item.title)+'</strong>'+
        '<small>'+esc(item.profile_title)+' / '+esc(item.comparison_pollutants.map(name=>NAMES[name]).join(', '))+' / '+esc(short(item.id))+
        ' / '+esc(nativeModelVersionLabel(item,nativeModelsForOutputs(item.comparison_pollutants)))+
        (item.selection.profile_id!==baseline.selection.profile_id?' / parameter profile differs':'')+
        (!common.length?' / no shared native output':'')+'</small></span></label>';
    }).join(''):'<p class="uc-note">'+(baseline?'The selected reference can be calculated now. Completed alternatives on this grid will appear here.':'Select a completed reference run.')+'</p>';
  }
  function sourceNote(){
    const source=catalog?.sources.find(item=>sourceKey(item)===$('[name="source"]').value);
    if(source)$('[data-source-note]').textContent=(source.vintage||'Retained source')+' / '+short(source.source_collection_id)+
      ' / original polygons OBJECTID 11, 12, 131 and 132';
  }
  function updatePlanning(){
    const shared=commonOutputs(),n=shared.length,selected=selectedRuns();
    const versionIssues=n?utilityVersionIssues(selected,shared):[];
    $('[data-native-versions]').textContent=versionIssues.length?versionIssues.join(' '):
      n?'Compared native models: '+selected.map(item=>(item.title||short(item.id))+': '+
        nativeModelVersionLabel(item,nativeModelsForOutputs(shared))).join(' / '):'';
    $('[data-pollutants]').textContent=n?'Shared completed outputs: '+shared.map(name=>NAMES[name]).join(', ')+
      '. Weights apply only to these physical outputs.':'Select runs with a shared completed native output.';
    POLLUTANTS.forEach(name=>{
      const input=$('[name="weight-'+name+'"]'),cap=$('[name="cap-'+name+'"]');
      input.disabled=cap.disabled=!shared.includes(name);
      input.closest('label').classList.toggle('uc-unavailable',input.disabled);
      cap.closest('label').classList.toggle('uc-unavailable',cap.disabled);
    });
    if(shared.length&&shared.every(name=>Number($('[name="weight-'+name+'"]').value)<=0))
      shared.forEach(name=>$('[name="weight-'+name+'"]').value=1);
    $('[data-grid-label]').textContent='Compare all '+gridPoints(n)+' planning ratios across '+n+' available pollutant'+(n===1?'':'s');
    $('[data-grid-note]').textContent=n===1?
      'A single pollutant has one normalized ratio. Its selected physical outcome and ranking remain available.':
      'The optional grid includes every quarter-step ratio across the available pollutants. Duplicate normalized selections are reused.';
    const caps=$('[name="normalization"]').value==='caps';
    $('[data-caps]').hidden=!caps;$('[data-percentile]').hidden=caps;
    const alternativeCount=$$('[name="alternative"]:checked').length;
    $('[data-build]').textContent=alternativeCount?'Build scenario comparison':'Build reference totals';
    $('[data-build]').disabled=submitting||!catalog.sources.length||!n||!!versionIssues.length;
  }
  function progress(value) {
    if(!value)return '';
    const finite=Number.isFinite(value.percent);
    const counts=value.completed!==null&&value.completed!==undefined&&value.total!==null&&value.total!==undefined
      ?number(value.completed,0)+' / '+number(value.total,0)+' '+esc(value.unit||''):'';
    return '<div class="uc-progress"><div><strong>'+esc(value.label||value.phase||'Preparing')+'</strong>'+
      '<span>'+counts+(finite?' / '+percent(value.percent):'')+'</span></div>'+
      (finite?'<progress value="'+Math.max(0,Math.min(100,value.percent))+'" max="100"></progress>':'')+
      '<small>Current phase'+(value.elapsed_seconds!==null&&value.elapsed_seconds!==undefined?' / '+number(value.elapsed_seconds,0)+' seconds elapsed':'')+'</small></div>';
  }
  function renderTasks() {
    if(!root)return;
    const tasks=(state?.tasks||[]).filter(item=>item.action==='utility.cohort.build'&&item.workspace===workspace);
    const visible=tasks.filter(item=>item.state!=='complete'||item.id===lastTaskId);
    $('[data-tasks]').innerHTML=visible.length?'<div class="uc-task-list">'+visible.map(item=>
      '<div><span><strong>'+esc(item.payload?.selection?.title||'Utility cohort')+'</strong><small>'+esc(item.state)+' / '+esc(date(item.created_at))+'</small>'+
      (item.error?'<small>'+esc(item.error.message||item.error)+'</small>':'')+'</span>'+
      button('task','Open operation','data-id="'+esc(item.id)+'"')+'</div>').join('')+'</div>':
      '<p class="uc-note">Cohorts use the existing serial operation queue. Interrupted calculations resume from Operations.</p>';
    const task=tasks.find(item=>item.id===lastTaskId);
    if(pendingOpen&&task?.state==='complete'&&task.result?.id){
      pendingOpen=false;open(task.result.id);
    }
  }
  function summaries(){return state?.data?.utility_cohorts||catalog?.cohorts||[];}
  function renderSaved() {
    if(!root)return;
    const rows=summaries();
    $('[data-saved]').innerHTML=rows.length?'<div class="uc-table-wrap"><table><thead><tr><th>Cohort</th><th>Native outputs</th><th>State / phase</th><th>Runs</th><th>Created</th><th></th></tr></thead><tbody>'+
      rows.map(item=>'<tr><td><strong>'+esc(item.title||'Utility cohort')+'</strong><small>'+esc(kindTitle(item))+' / '+esc(short(item.id))+'</small></td><td>'+
      esc((item.comparison_pollutants||POLLUTANTS).map(name=>NAMES[name]).join(', '))+'</td><td>'+esc(item.state)+
      (item.state==='building'?progress(item.progress):item.error?'<small>'+esc(item.error.message||item.error)+'</small>':'')+'</td><td>'+
      number(item.run_ids?.length,0)+'</td><td>'+esc(date(item.created_at))+'</td><td>'+button('open','Open','data-id="'+esc(item.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':
      '<p class="uc-note">Completed and interrupted utility cohorts will be retained here.</p>';
    if(selectedId){
      const currentSummary=rows.find(item=>item.id===selectedId);
      if(currentSummary){
        $('[data-result-progress]').innerHTML=currentSummary.state==='complete'?'':progress(currentSummary.progress)+
          (currentSummary.error?'<p class="uc-error">'+esc(currentSummary.error.message||currentSummary.error)+'</p>':'');
        if(currentSummary.state==='complete'&&packet?.summary.state!=='complete'&&!detailLoading)open(selectedId);
      }
    }
  }
  async function refreshCatalog(){
    if(catalogPromise){catalogAgain=true;return catalogPromise;}
    const token=epoch;
    catalogPromise=(async()=>{
      try {
        if(catalog&&root)draft=readDraft();
        const value=await request('catalog');
        if(!current(token))return;
        catalog=value;fillChoices();renderSaved();
      }catch(reason){if(current(token))error(reason.message||String(reason));}
      finally{
        if(token===epoch){
          catalogPromise=null;
          if(catalogAgain&&current(token)){catalogAgain=false;refreshCatalog();}
        }
      }
    })();
    return catalogPromise;
  }
  async function preview(){
    if(previewing)return;
    const token=epoch;
    try {
      const selection=selected();saveDraft();error('');previewing=true;
      $('[data-preview]').hidden=false;$('[data-preview]').textContent='Reading original source geometry...';
      const value=await context.api('/api/utility-cohorts/preview',{method:'POST',body:{workspace,selection}});
      if(!current(token))return;
      $('[data-preview]').innerHTML='<h4>Selected original source areas</h4>'+sourceAreas(value.zone_bindings)+
        '<p class="uc-note">'+esc(kindTitle(value))+' / '+value.run_ids.length+' actual runs / '+value.weight_grid.weight_set_count+' declared weight sets / grid '+esc(short(value.grid_id))+'</p>'+
        nativeExecution(value.native_execution,value.runs);
    }catch(reason){if(current(token)){$('[data-preview]').hidden=true;error(reason.message||String(reason));}}
    finally{if(current(token))previewing=false;}
  }
  async function build(){
    if(submitting)return;
    const token=epoch;
    try{
      const selection=selected();saveDraft();error('');
      const fingerprint=stable(selection);
      if(lastSubmission?.fingerprint!==fingerprint)
        lastSubmission={fingerprint,operation_id:crypto.randomUUID()};
      persist();submitting=true;updatePlanning();
      $('[data-submit-note]').textContent='Submitting to the current operation queue...';
      const task=await context.api('/api/actions',{method:'POST',body:{
        workspace,action:'utility.cohort.build',payload:{selection},operation_id:lastSubmission.operation_id
      }});
      if(!current(token))return;
      lastTaskId=task.id||task.task?.id;pendingOpen=true;persist();
      $('[data-submit-note]').textContent='Queued. The retained phase appears below.';
      context.toast('Utility cohort queued.');
      await context.refreshState();
      if(task.state==='complete'&&task.result?.id){pendingOpen=false;await open(task.result.id);}
    }catch(reason){
      if(current(token)){error(reason.message||String(reason));$('[data-submit-note]').textContent='Retry keeps this exact operation identity.';}
    }finally{if(current(token)){submitting=false;updatePlanning();}}
  }
  function sourceAreas(areas){
    const intersecting=areas.filter(area=>area.reporting_intersection_area_ha>0).length;
    return '<p class="uc-note">'+intersecting+' of '+areas.length+' original protection areas overlap the selected study. Areas outside its reporting geometry remain listed.</p>'+
      '<div class="uc-table-wrap"><table><thead><tr><th>Source area</th><th>Intake</th><th>Native buffer</th><th>Original area, ha</th><th>Reporting intersection, ha</th></tr></thead><tbody>'+
      areas.map(area=>'<tr><td>'+esc(area.title)+'<small>OBJECTID '+esc(area.object_id)+' / '+esc(area.rank_group)+'</small></td><td>'+
      esc(area.intake_id)+'</td><td>'+number(area.buffer_ft,0)+' ft</td><td>'+number(area.original_area_ha)+'</td><td>'+
      number(area.reporting_intersection_area_ha)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function downloadGroups(files){
    const groups=new Map();
    for(const file of files||[]){
      if(!/^\/api\/file\/[a-f0-9]{64}$/.test(file.url||''))continue;
      const group=file.group||'Files';if(!groups.has(group))groups.set(group,[]);
      groups.get(group).push(file);
    }
    return [...groups].map(([title,items])=>'<details class="uc-downloads"><summary>'+esc(title)+' / '+items.length+' files</summary><ul>'+
      items.map(item=>'<li><span>'+esc(item.filename)+'<small>'+size(item.bytes)+'</small></span><a href="'+esc(item.url)+
        '?download=1" download>Download</a></li>').join('')+'</ul></details>').join('');
  }
  function nativeExecution(execution,runs){
    if(!execution?.models?.length||!execution.runs)return '';
    return '<details class="uc-source-detail"><summary>Retained native model execution</summary>'+
      '<div class="uc-table-wrap"><table><thead><tr><th>Selected run</th><th>Completed model versions</th></tr></thead><tbody>'+
      runs.map(item=>'<tr><td>'+esc(item.title||short(item.id))+'<small>'+esc(item.id)+'</small></td><td>'+
        esc(nativeModelVersionLabel({model_versions:execution.runs[item.id]||{}},execution.models))+'</td></tr>').join('')+
      '</tbody></table></div></details>';
  }
  function resultContent(){
    const value=packet.cohort,complete=value.state==='complete';
    if(!complete)return '<p class="uc-note">The source selection and latest phase are retained. Open the corresponding operation to resume an interrupted calculation.</p>';
    const runOptions=packet.runs.map(item=>option(item.id,item.title+' / '+short(item.id))).join('');
    return '<details class="uc-source-detail"><summary>Original source areas and fixed baseline scale</summary>'+
      '<p>'+esc(value.source.title)+' / '+esc(value.source.vintage||'')+'</p>'+sourceAreas(value.zone_bindings)+
      '<div data-normalization>'+normalization(value.normalization)+'</div>'+
      '<p class="uc-note">The publisher\'s upstream protection polygons keep their original 200-foot and 1,500-foot attributes. These are separate ranking groups. Each area is intersected with the selected reporting geometry.</p></details>'+
      nativeExecution(value.native_execution,packet.runs)+
      '<div class="uc-result-filters"><label>Source area<select name="filter-region">'+option('','All source areas')+
      packet.filters.regions.map(item=>option(item.id,item.title)).join('')+'</select></label>'+
      '<label>Native run<select name="filter-run">'+option('','All selected runs')+runOptions+'</select></label>'+
      '<label>Pollutant<select name="filter-pollutant">'+option('','All available pollutants')+
      packet.filters.pollutants.map(name=>option(name,NAMES[name])).join('')+'</select></label>'+
      '<label>Table<select name="filter-view"><option value="physical">Physical outcomes</option><option value="priority">Planning priorities</option><option value="coverage">Native coverage</option></select></label></div>'+
      '<p class="uc-note" data-table-note></p><div data-result-rows></div><div class="uc-pagination" data-pagination></div>'+
      '<h4>Retained products</h4>'+downloadGroups(packet._downloads);
  }
  function normalization(value){
    if(!value)return '';
    const caps=value.caps||value.reference_caps||{};
    const selected=packet.filters.pollutants;
    return '<p class="uc-note">Fixed physical caps are retained with the planning analysis.</p>'+
      '<dl class="uc-values">'+selected.map(name=>{
        const item=caps[name];const cap=item&&typeof item==='object'?item.value??item.cap:item;
        return '<div><dt>'+NAMES[name]+'</dt><dd>'+number(cap)+' <small>'+
          (name==='sediment_export'?'metric tonnes/year/pixel':'kg/year/pixel')+'</small></dd></div>';
      }).join('')+'</dl>';
  }
  function applyFilters(){
    if(!$('[name="filter-region"]'))return;
    for(const [key,name] of [['region_id','region'],['run_id','run'],['pollutant','pollutant'],['view','view']]){
      const input=$('[name="filter-'+name+'"]');input.value=filters[key]||'';
      if(input.selectedIndex<0){input.value=key==='view'?'physical':'';filters[key]=input.value;}
    }
    $('[name="filter-pollutant"]').disabled=filters.view==='priority';
    const reference=referenceOnly(packet.cohort);
    const notes={
      priority:'Priority uses the selected planning weights and frozen physical caps. Ranks compare the same published buffer group. Each source-area/run pair appears once.'+
        (reference?'':' A negative rank change moves upward.'),
      physical:reference?
        'Reference annual export is aggregated from this original native run. Yield divides that mass by its valid source-area hectares. Each pollutant retains its own native units.':
        'Annual physical change is alternative minus baseline. Avoided export is baseline minus alternative. Each pollutant uses the same valid cells across the entire selected cohort.',
      coverage:'Native valid area and annual mass include every valid cell in this run. Common area uses the intersection across all selected runs. Structural stream cells are identified by the original stream raster; unexpected missing cells remain separate.'
    };
    $('[data-table-note]').textContent=notes[filters.view];
  }
  async function open(id){
    identifier(id);const token=epoch;selectedId=id;packet=null;rowPage=null;detailLoading=true;persist();error('');
    $('[data-result]').hidden=false;$('[data-result-heading]').innerHTML='<h3>Loading utility cohort...</h3>';
    $('[data-result-content]').innerHTML='';$('[data-result-progress]').innerHTML='';
    try{
      const value=await request('cohort',{id});
      if(!current(token)||selectedId!==id)return;
      packet=value;
      $('[data-result-heading]').innerHTML='<div class="uc-heading"><div><h3>'+esc(value.cohort.title)+'</h3><p>'+
        esc(value.summary.state)+' / '+esc(kindTitle(value.cohort))+' / '+value.cohort.run_ids.length+' runs / '+esc(packet.filters.pollutants.map(name=>NAMES[name]).join(', '))+
        ' / '+esc(date(value.cohort.completed_at||value.cohort.created_at))+'</p></div></div>';
      $('[data-result-progress]').innerHTML=value.summary.state==='complete'?'':progress(value.summary.progress)+
        (value.summary.error?'<p class="uc-error">'+esc(value.summary.error.message||value.summary.error)+'</p>':'');
      $('[data-result-content]').innerHTML=resultContent();
      if(value.summary.state==='complete'){applyFilters();await fetchRows();}
    }catch(reason){if(current(token)&&selectedId===id)error(reason.message||String(reason));}
    finally{if(current(token)&&selectedId===id)detailLoading=false;}
  }
  function identifier(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('Select a retained utility cohort.');}
  async function fetchRows(){
    if(!packet||packet.summary.state!=='complete')return;
    const token=epoch,requestId=++rowsEpoch,id=selectedId;
    $('[data-result-rows]').textContent='Loading retained comparison rows...';
    try{
      const values={id,offset:filters.offset||0,limit:100,view:filters.view,
        region_id:filters.region_id,run_id:filters.run_id,pollutant:filters.view==='priority'?'':filters.pollutant};
      const value=await request('rows',values);
      if(!current(token)||requestId!==rowsEpoch||id!==selectedId)return;
      rowPage=value;renderRows();
    }catch(reason){if(current(token)&&requestId===rowsEpoch)error(reason.message||String(reason));}
  }
  function renderRows(){
    const priority=filters.view==='priority',coverage=filters.view==='coverage';
    const reference=referenceOnly(packet.cohort);
    const titles=new Map(packet.runs.map(item=>[item.id,item.title]));
    let headers=['Source area','Native run'];
    if(priority)headers=headers.concat(reference?
      ['Priority mean','Rank','Rank range across weights','Score range across weights','Common coverage']:
      ['Priority mean','Score change','Rank','Rank change','Rank range across weights','Score range across weights','Common coverage']);
    else if(coverage)headers=headers.concat([
      'Pollutant / annual units','Selected cells','Native valid cells','Structural stream cells',
      'Unexpected missing cells','Unknown stream cells','Native valid area, ha','Native annual mass',
      'Common area, ha','Common native support','Coverage status']);
    else headers=headers.concat(reference?
      ['Pollutant / annual units','Annual export','Yield / ha / year','Valid area, ha','Valid coverage']:
      ['Pollutant / annual units','Baseline mass','Current mass','Change','Avoided export','Change %','Common area, ha','Common coverage']);
    const rows=rowPage.rows.map(row=>{
      const cells=[
        '<strong>'+esc(row.title)+'</strong><small>'+esc(row.rank_group||'Reporting area')+'</small>',
        esc(titles.get(row.run_id)||short(row.run_id))+'<small>'+esc(reference?'Reference':row.comparison_kind)+'</small>'
      ];
      if(priority){
        cells.push(number(row.selected_priority_mean,6));
        if(!reference)cells.push(signed(row.selected_priority_score_change,6));
        cells.push(number(row.selected_priority_rank,0));
        if(!reference)cells.push(signed(row.priority_rank_change,0));
        cells.push(number(row.sensitivity_best_rank,0)+' to '+number(row.sensitivity_worst_rank,0),
          number(row.sensitivity_score_min,6)+' to '+number(row.sensitivity_score_max,6),
          coveragePercent(row.priority_coverage_fraction));
      }else{
        cells.push(esc(NAMES[row.pollutant])+'<small>'+esc(row.units)+'</small>');
        if(coverage){
          cells.push(number(row.selected_cells,0),number(row.native_valid_cells,0),
            number(row.native_structural_stream_cells,0),number(row.native_unexpected_missing_cells,0),
            number(row.native_unknown_stream_cells,0),number(row.native_valid_area_ha),
            number(row.native_all_valid_mass),number(row.common_area_ha),
            coveragePercent(row.common_native_support_fraction),
            row.native_complete_support===true?'Complete native support':
              row.native_complete_support===false?'Review source coverage':'See native report');
        }else if(reference){
          cells.push(number(row.current_common_mass),number(row.common_yield_per_ha_year),
            number(row.common_area_ha),coveragePercent(row.common_coverage_fraction));
        }else{
          cells.push(number(row.baseline_common_mass),number(row.current_common_mass),
            signed(row.change_mass),signed(row.avoided_export_mass),
            percent(row.change_percent)+(row.percent_status!=='defined'?
              '<small>'+esc(String(row.percent_status).replaceAll('_',' '))+'</small>':''),
            number(row.common_area_ha),coveragePercent(row.common_coverage_fraction));
        }
      }
      return '<tr>'+cells.map(value=>'<td>'+value+'</td>').join('')+'</tr>';
    }).join('');
    $('[data-result-rows]').innerHTML=rows?'<div class="uc-table-wrap"><table><thead><tr>'+headers.map(title=>'<th>'+esc(title)+'</th>').join('')+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="uc-note">No retained rows match these filters.</p>';
    $('[data-pagination]').innerHTML='<span>'+number(rowPage.total?rowPage.offset+1:0,0)+' to '+number(Math.min(rowPage.offset+rowPage.rows.length,rowPage.total),0)+
      ' of '+number(rowPage.total,0)+' rows</span><div class="uc-actions">'+button('previous','Previous',rowPage.offset<=0?'disabled':'')+
      button('next','Next',!rowPage.more?'disabled':'')+'</div>';
  }
  function change(event){
    const name=event.target?.name;if(!name)return;
    if(name.startsWith('filter-')){
      const map={'filter-region':'region_id','filter-run':'run_id','filter-pollutant':'pollutant','filter-view':'view'};
      filters[map[name]]=event.target.value;filters.offset=0;applyFilters();persist();fetchRows();return;
    }
    if(name==='baseline'||name==='parameters'){
      const saved=readDraft();alternatives(saved.alternatives);updatePlanning();
    }else if(name==='alternative'||name==='normalization')updatePlanning();
    if(name==='source')sourceNote();
    saveDraft();
  }
  async function dispatch(element){
    if(!root||!root.contains(element))return false;
    const action=(element.dataset.action||'').replace('utility-cohort-','');
    try {
      if(action==='refresh')await refreshCatalog();
      else if(action==='sources')context.navigate('sources');
      else if(action==='runs')context.navigate('run-desk');
      else if(action==='preview')await preview();
      else if(action==='open')await open(element.dataset.id);
      else if(action==='task')await context.showTask(element.dataset.id);
      else if(action==='previous'||action==='next'){
        filters.offset=Math.max(0,(filters.offset||0)+(action==='next'?100:-100));persist();await fetchRows();
      }else return false;
    }catch(reason){error(reason.message||String(reason));}
    return true;
  }
  async function mount(node,nextState){
    detach();root=node;workspace=nextState.workspace_key;state=nextState;epoch++;loadSaved();
    controller=new AbortController();root.innerHTML=shell();const signal=controller.signal;
    root.addEventListener('change',change,{signal});
    root.addEventListener('input',event=>{if(event.target.closest('[data-builder]'))saveDraft();},{signal});
    root.addEventListener('submit',event=>{if(event.target.matches('[data-builder]')){event.preventDefault();build();}},{signal});
    const token=epoch;renderTasks();renderSaved();await refreshCatalog();
    if(current(token)&&selectedId)await open(selectedId);
  }
  function signalFor(nextState){
    return JSON.stringify((nextState.data?.runs||[]).map(item=>[item.id,item.state,
      Object.keys(item.artifacts||{}).sort(),item.selection?.invest_version,item.runtime?.version,
      ['ndr','sdr'].map(model=>{const stage=item.stages?.[model]||item.stage_summary?.[model]||{};
        return [stage.completed_at,stage.runtime?.version,stage.reused_from];})]));
  }
  function update(nextState){
    if(!root||nextState.workspace_key!==workspace)return;
    state=nextState;renderTasks();renderSaved();
    const nextSignal=signalFor(nextState);
    if(catalogSignal&&nextSignal!==catalogSignal)refreshCatalog();
    catalogSignal=nextSignal;
  }
  function detach(){
    if(root){draft=readDraft();persist();}
    controller?.abort();controller=null;epoch++;rowsEpoch++;
    root=null;catalog=null;packet=null;catalogPromise=null;catalogAgain=false;catalogSignal='';
    previewing=false;submitting=false;detailLoading=false;
  }
  async function create(value={}){
    if(!root)return;
    const token=epoch,selection=value.selection||{};
    if(!catalog)await refreshCatalog();
    if(!current(token))return;
    draft={...readDraft(),title:selection.title||draft.title,baseline:selection.baseline_run_id||draft.baseline,
      alternatives:selection.scenario_run_ids||draft.alternatives};
    if(selection.source_collection_id&&selection.source_id)
      draft.source=sourceKey(selection);
    fillChoices();$('[data-builder]')?.scrollIntoView({block:'start'});
  }
  return {mount,update,detach,dispatch,open,create};
}
