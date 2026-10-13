/* Shared paired-raster desk. Uses the original operator API and task queue. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const short = value => String(value ?? '').slice(0, 12);
const number = value => value === null || value === undefined ? 'Unavailable' :
  Number(value).toLocaleString(undefined, {maximumSignificantDigits:7});
const names = {nitrogen_export:'Nitrogen', phosphorus_export:'Phosphorus', sediment_export:'Sediment'};
const units = {nitrogen_export:'kg/pixel/year', phosphorus_export:'kg/pixel/year', sediment_export:'metric tonnes/pixel/year'};
const supportNames = {
  all_pairs:'All selected pairs, separately for each pollutant',
  available_pairs:'Available pairs at each pixel',
  all_pairs_all_pollutants:'All pairs and all selected pollutants'
};
const action = (name, title, id='', disabled=false) =>
  '<button type="button" data-pe-action="'+esc(name)+'"'+
  (id?' data-id="'+esc(id)+'"':'')+(disabled?' disabled':'')+'>'+esc(title)+'</button>';
const table = (head, rows) => '<div class="pe-scroll"><table><thead><tr>'+
  head.map(value=>'<th>'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const cell = value => '<td>'+esc(value)+'</td>';
const options = (rows, placeholder) => '<option value="">'+esc(placeholder)+'</option>'+
  rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.title||row.spec?.title||short(row.id))+'</option>').join('');
const pathMember = value => String(value).split('/').map(encodeURIComponent).join('/');


// All views consume the same retained per-model catalogue as the Python binder.
const producingModel = output => output === 'sediment_export' ? 'sdr' : 'ndr';
function nativeOutputIssue(runs, output) {
  const model=producingModel(output);
  if(!runs.length)return 'Select original native pairs.';
  if(runs.some(run=>!run?.available_pollutants?.includes(output)))
    return 'The output is absent from a selected original run.';
  const versions=runs.map(run=>run.native_model_versions?.[model]?.comparison_version);
  if(versions.some(version=>!version))
    return model.toUpperCase()+' producing version is unavailable in a selected run.';
  const distinct=[...new Set(versions)];
  return distinct.length===1?'':model.toUpperCase()+' producing versions differ: '+distinct.join(' versus ')+'.';
}
function nativeRunLabel(run) {
  const bases={completed_stage_runtime:'completed stage',observed_run_fallback:'observed run fallback',
    requested_legacy:'requested legacy'};
  return Object.entries(run?.native_model_versions||{}).map(([model,info])=>
    model.toUpperCase()+' '+(info.comparison_version||'unavailable')+
    ' ('+(bases[info.basis]||'basis unavailable')+')').join('; ')||'Producing runtime unavailable';
}
function selectedNativeRuns(runs, pairs) {
  const byId=new Map(runs.map(run=>[run.id,run]));
  return pairs.flatMap(pair=>[byId.get(pair.baseline_run_id),byId.get(pair.alternative_run_id)]);
}

export function attachPairedEnsembles(context) {
  const document = context.document || globalThis.document;
  const {api, getState, toast} = context;
  let root=null, workspace=null, catalog=null, epoch=0, version=0;
  let listeners=null, reads=null, timer=null, pollBusy=null;
  let catalogRevision=0, submitRevision=0, uploadRevision=0, pollRevision=0;
  let pairRows=[], choices=new Map(), imported=null, selectedTask=null;
  let productSignature='', taskSignature='', pendingOpen=null, detailRequest=0, transferRequest=0;
  let lastRequest=null, lastSelection=null, savedDraft=null, pollingTask=null, detailId=null;
  let viewSave=Promise.resolve();
  const query = selector => root?.querySelector(selector);
  const field = name => query('[name="'+name+'"]');
  const value = name => field(name)?.value ?? '';
  const current = (token, key) => root && token===epoch && key===workspace && key===getState()?.workspace_key;
  const url = (path, extra={}, key=workspace) => path+'?'+new URLSearchParams({workspace:key,...extra});
  const storageKey = key => 'upstate-paired-ensemble-desk:'+key;
  const profileName = key => catalog?.profiles.find(row=>row.id===key)?.title || short(key);
  const scenarioName = key => catalog?.scenarios.find(row=>row.id===key)?.title || short(key);

  function notify(message, error=false) {
    const node=query('[data-pe-notice]');
    if(node){node.textContent=message;node.hidden=!message;node.setAttribute('role',error?'alert':'status');}
  }
  function remember() {
    if(!workspace)return;
    try {
      globalThis.sessionStorage?.setItem(storageKey(workspace), JSON.stringify({lastRequest,lastSelection,draft:savedDraft}));
    } catch (_) { /* The original task retains every submitted request. */ }
  }
  function recordTask(task, request=null){
    const key=task.workspace||request?.workspace;
    if(!key||!task.id)return;
    const terminal=state=>['complete','failed','cancelled','canceled'].includes(state);
    const update=record=>{
      if(!record||record.workspace!==key||
        !(record.task_id===task.id||(request&&record.operation_id===request.operation_id)))return record;
      if(terminal(record.task_state)&&!terminal(task.state))return record;
      if(record.task_id===task.id&&record.task_state===task.state)return record;
      return {...record,task_id:task.id,task_state:task.state};
    };
    if(workspace===key){
      const request=update(lastRequest),selection=update(lastSelection);
      if(request===lastRequest&&selection===lastSelection)return;
      lastRequest=request;lastSelection=selection;remember();
    }else{
      try{
        const saved=JSON.parse(globalThis.sessionStorage?.getItem(storageKey(key))||'null');
        if(saved){
          saved.lastRequest=update(saved.lastRequest);saved.lastSelection=update(saved.lastSelection);
          globalThis.sessionStorage?.setItem(storageKey(key),JSON.stringify(saved));
        }
      }catch(_){ /* The original queue retains accepted task identities. */ }
    }
  }
  function restore() {
    lastRequest=null;lastSelection=null;savedDraft=null;
    try {
      const record=JSON.parse(globalThis.sessionStorage?.getItem(storageKey(workspace))||'null');
      if(record && typeof record==='object'){lastRequest=record.lastRequest||null;lastSelection=record.lastSelection||null;savedDraft=record.draft||null;}
    } catch (_) { /* An unreadable browser draft does not affect retained tasks. */ }
  }
  function captureDraft() {
    if(!root || !catalog || !field('grid'))return;
    savedDraft={
      fields:Object.fromEntries([...root.querySelectorAll('[name]')].filter(node=>node.type!=='file'&&node.type!=='checkbox').map(node=>[node.name,node.value])),
      choices:[...choices].map(([id,row])=>[id,{...row}]),
      pollutants:[...root.querySelectorAll('[name="pollutant"]:checked')].map(node=>node.value),
      imported:imported?{design_id:imported.design_id,description:imported.description}:null
    };
    remember();
  }
  function detach() {
    captureDraft();
    epoch++;version++;catalogRevision++;submitRevision++;uploadRevision++;pollRevision++;transferRequest++;
    listeners?.abort();reads?.abort();
    clearTimeout(timer);timer=null;pollingTask=null;pollBusy=null;
    root=null;workspace=null;catalog=null;detailId=null;
    productSignature='';taskSignature='';
  }
  function layout() {
    root.innerHTML='<div class="paired-ensemble-desk">'+
      '<header><div><h1>Paired raster analysis</h1><p>Compare completed land-cover alternatives across the selected scientific profiles.</p></div>'+
      '<div class="pe-actions">'+action('reload','Refresh available runs')+'</div></header>'+
      '<div data-pe-notice class="pe-notice" role="status" hidden></div>'+
      '<section aria-labelledby="pe-selection-title"><h2 id="pe-selection-title">Select the original native results</h2>'+
      '<p>Positive reduction means baseline minus alternative. Nitrogen and phosphorus retain kilograms; sediment retains metric tonnes.</p>'+
      '<div class="pe-fields"><label>Completed scenario design<select name="design"><option value="">Choose native pairs below</option></select></label>'+
      '<label>Design alternative<select name="design_scenario"><option value="">Choose a design first</option></select></label></div>'+
      '<div class="pe-actions">'+action('design','Use completed design pairs')+'<span data-pe-design-status></span></div>'+
      '<div class="pe-fields"><label>Analysis title<input name="title" value="Paired land-cover analysis" required></label>'+
      '<label>Scientific question<textarea name="purpose" rows="2" required>How does this land-cover alternative change physical export across the selected profiles?</textarea></label></div>'+
      '<div class="pe-fields pe-contrast"><label>Original grid<select name="grid"></select></label>'+
      '<label>Baseline scenario<select name="baseline"></select></label>'+
      '<label>Alternative scenario<select name="alternative"></select></label></div>'+
      '<p>Run choices show the version that produced each model output. Each selected quantity must use the same producing version across all included runs.</p>'+
      '<p data-pe-grid class="pe-meta"></p><p data-pe-pair-status role="status"></p><p data-pe-version-status role="status"></p><div data-pe-pairs></div>'+
      '<fieldset class="pe-quantities"><legend>Physical outputs present in every selected pair</legend>'+
      Object.keys(names).map(name=>'<label><input type="checkbox" name="pollutant" value="'+name+'"> '+names[name]+'</label>').join('')+'</fieldset>'+
      '<div class="pe-fields"><label>Pixel support<select name="support">'+Object.entries(supportNames).map(([id,label])=>'<option value="'+id+'">'+esc(label)+'</option>').join('')+'</select>'+
      '<label>Quantiles (0 to 1, comma separated)<input name="quantiles" value="0.1, 0.5, 0.9"></label>'+
      '<label>Planned parameter profiles<input name="planned" type="number" min="1" step="1" value="1"></label></div>'+
      '<p class="pe-method">With available-pair support, each pixel uses its actual valid-pair count. Improvement fractions divide improved pairs by valid pairs; read the count raster alongside them. Basin totals always use common cells for all selected profiles.</p>'+
      '<details><summary>Computation and improvement thresholds</summary><div class="pe-fields">'+
      '<label>Tile-array budget (MiB)<input name="memory" type="number" min="1" value="256"></label>'+
      '<label>Tile edge (pixels)<input name="tile" type="number" min="1" max="2048" step="1" value="256"></label>'+
      '<label>Open raster handles<input name="handles" type="number" min="2" step="1" value="48"></label>'+
      Object.keys(names).map(name=>'<label>'+names[name]+' improvement threshold ('+units[name]+')<input name="threshold_'+name+'" type="number" min="0" step="any" placeholder="0"></label>').join('')+
      '</div><p>Improvement uses reduction strictly greater than the selected threshold. The memory value covers tile arrays; the native GIS process also uses memory for its libraries and caches.</p></details>'+
      '<div class="pe-actions">'+action('preview','Preview original source binding')+action('build','Build quantitative analysis')+action('saved','Load last submitted selection')+'</div>'+
      '<div data-pe-preview></div></section>'+
      '<section aria-labelledby="pe-progress-title"><h2 id="pe-progress-title">Execution and recovery</h2>'+
      '<p data-pe-progress role="status">Retained tasks will appear here.</p><div data-pe-task-actions class="pe-actions"></div><div data-pe-tasks></div></section>'+
      '<section aria-labelledby="pe-products-title"><h2 id="pe-products-title">Saved quantitative products</h2><div data-pe-products></div><div data-pe-detail></div></section>'+
      '<section aria-labelledby="pe-receive-title"><h2 id="pe-receive-title">Receive a complete result project</h2>'+
      '<p>Open the original result ZIP to retain its quantitative rasters, report files and source identities in this workspace.</p>'+
      '<label>Result ZIP<input name="archive" type="file" accept=".zip,application/zip"></label>'+
      action('receive','Receive result project')+'</section></div>';
  }
  async function mount(container, state=getState()) {
    if(root)detach();
    root=container;workspace=state?.workspace_key;const token=++epoch,key=workspace;
    listeners=new AbortController();reads=new AbortController();restore();layout();
    root.addEventListener('click',onClick,{signal:listeners.signal});
    root.addEventListener('change',onChange,{signal:listeners.signal});
    root.addEventListener('input',()=>{version++;captureDraft();},{signal:listeners.signal});
    notify('Reading original run and scenario records…');
    await reload({restoreDraft:true,token,key});
    if(!current(token,key))return;
    const opening=pendingOpen;pendingOpen=null;
    if(opening?.kind==='design')await loadDesign(opening);
    else if(opening?.kind==='selection')applySelection(opening.selection);
    else if(opening?.kind==='product')await openProduct(opening.id);
    else if(!opening&&catalog?.saved_view?.ensemble_id)await openProduct(catalog.saved_view.ensemble_id,{save:false});
    update(getState());
  }
  async function reload({restoreDraft=false,token=epoch,key=workspace}={}) {
    const revision=++catalogRevision;
    const result=await api(url('/api/paired-ensemble/catalog',{},key),{signal:reads.signal});
    if(!current(token,key)||revision!==catalogRevision)return;
    version++;
    if(!restoreDraft)captureDraft();
    catalog=result;
    for(const [name,kind,title] of [['grid','grids','Choose the original grid'],['baseline','scenarios','Choose a baseline'],['alternative','scenarios','Choose an alternative']])
      field(name).innerHTML=options(result[kind]||[],title);
    field('design').innerHTML=options((result.designs||[]).filter(row=>row.alternative_scenario_ids.length),'Choose native pairs below');
    for(const [name,selected] of Object.entries(savedDraft?.fields||{}))if(field(name))field(name).value=selected;
    if(!value('grid')&&result.grids.length===1)field('grid').value=result.grids[0].id;
    designs();
    choices=new Map(savedDraft?.choices||[]);
    imported=savedDraft?.imported||null;
    renderPairs(true);
    for(const node of root.querySelectorAll('[name="pollutant"]'))
      node.checked=!node.disabled&&(savedDraft?.pollutants?.includes(node.value)??true);
    renderProducts(result.products||[]);
    notify(result.saved_view_error||'Original run catalogue loaded.',!!result.saved_view_error);
  }
  function designs() {
    const previous=value('design_scenario')||savedDraft?.fields?.design_scenario;
    const selected=catalog?.designs.find(row=>row.id===value('design'));
    field('design_scenario').innerHTML=options((selected?.alternative_scenario_ids||[]).map(id=>({id,title:scenarioName(id)})),'Choose the land-cover alternative');
    if(selected?.alternative_scenario_ids.includes(previous))field('design_scenario').value=previous;
    else if(selected?.alternative_scenario_ids.length===1)field('design_scenario').value=selected.alternative_scenario_ids[0];
  }
  function ranked(rows) {
    return [...rows].sort((a,b)=>b.available_pollutants.length-a.available_pollutants.length||a.id.localeCompare(b.id));
  }
  function renderPairs(preserve=false) {
    if(!catalog)return;
    const grid=value('grid'), baseline=value('baseline'), alternative=value('alternative');
    const runs=catalog.runs.filter(row=>row.selection.grid_id===grid&&[baseline,alternative].includes(row.selection.scenario_id));
    const ids=[...new Set(runs.map(row=>row.selection.profile_id))].sort((a,b)=>profileName(a).localeCompare(profileName(b))||a.localeCompare(b));
    const prior=preserve?choices:new Map();choices=new Map();pairRows=[];
    for(const id of ids){
      const all=runs.filter(row=>row.selection.profile_id===id);
      const before=ranked(all.filter(row=>row.state==='complete'&&row.selection.scenario_id===baseline));
      const after=ranked(all.filter(row=>row.state==='complete'&&row.selection.scenario_id===alternative));
      if(!baseline||!alternative||baseline===alternative)continue;
      const previous=prior.get(id),ready=before.length>0&&after.length>0;
      let suggested=[before[0],after[0]],best=-1;
      for(const first of before)for(const second of after){
        const count=Object.keys(names).filter(name=>!nativeOutputIssue([first,second],name)).length;
        if(count>best){suggested=[first,second];best=count;}
      }
      choices.set(id,{baseline:before.some(row=>row.id===previous?.baseline)?previous.baseline:suggested[0]?.id,
        alternative:after.some(row=>row.id===previous?.alternative)?previous.alternative:suggested[1]?.id,
        included:ready&&(previous?.included??true)});
      pairRows.push({id,before,after,all,ready});
    }
    const runOptions=(rows,selected)=>rows.map(row=>'<option value="'+row.id+'"'+(row.id===selected?' selected':'')+'>'+short(row.id)+' · '+row.available_pollutants.map(id=>names[id]).join(', ')+' · '+esc(nativeRunLabel(row))+'</option>').join('');
    query('[data-pe-pairs]').innerHTML=pairRows.length?table(['Include','Parameter profile','Baseline native run','Alternative native run'],pairRows.map(row=>{
      const choice=choices.get(row.id);
      const missing=side=>row.all.filter(run=>run.selection.scenario_id===(side==='before'?baseline:alternative)).map(run=>run.state).join(', ')||'missing';
      return '<tr><td><input type="checkbox" data-pe-profile="'+row.id+'"'+(choice.included?' checked':'')+(!row.ready?' disabled':'')+' aria-label="Include '+esc(profileName(row.id))+'"></td>'+
        '<th scope="row">'+esc(profileName(row.id))+'<small><code>'+short(row.id)+'</code></small></th>'+
        '<td>'+(row.before.length?'<select data-pe-run="baseline" data-profile="'+row.id+'" aria-label="Baseline for '+esc(profileName(row.id))+'">'+runOptions(row.before,choice.baseline)+'</select>':esc(missing('before')))+'</td>'+
        '<td>'+(row.after.length?'<select data-pe-run="alternative" data-profile="'+row.id+'" aria-label="Alternative for '+esc(profileName(row.id))+'">'+runOptions(row.after,choice.alternative)+'</select>':esc(missing('after')))+'</td></tr>';
    })):'<p>Choose a grid and two distinct scenarios. Completed runs will appear under their original parameter profile with their producing model versions.</p>';
    const gridRecord=catalog.grids.find(row=>row.id===grid);
    query('[data-pe-grid]').textContent=gridRecord?'Original grid '+gridRecord.id:'';
    field('planned').value=Math.max(Number(value('planned'))||1,ids.length,imported?.planned_member_count||0);
    updateQuantities(true);
  }
  function selectedPairs() {
    return pairRows.filter(row=>choices.get(row.id)?.included&&row.ready).map(row=>{
      const chosen=choices.get(row.id);
      return {profile_id:row.id,baseline_run_id:chosen.baseline,alternative_run_id:chosen.alternative,scenario_id:value('alternative')};
    });
  }
  function updateQuantities(initial=false) {
    const selected=selectedPairs();
    const originalRuns=selectedNativeRuns(catalog.runs,selected);
    const reasons=Object.fromEntries(Object.keys(names).map(name=>[name,nativeOutputIssue(originalRuns,name)]));
    const common=new Set(Object.keys(names).filter(name=>!reasons[name]));
    query('[data-pe-version-status]').textContent=selected.length?
      [...new Set(Object.entries(reasons).filter(([,reason])=>reason).map(([name,reason])=>names[name]+': '+reason))].join(' '):'';
    for(const node of root.querySelectorAll('[name="pollutant"]')){
      const eligible=selected.length>0&&common.has(node.value),wasDisabled=node.disabled;
      node.disabled=!eligible;
      if(!eligible)node.checked=false;
      else if(initial||wasDisabled)node.checked=true;
    }
    const ready=pairRows.filter(row=>row.ready).length;
    query('[data-pe-pair-status]').textContent=selected.length+' selected of '+ready+' complete same-profile pairs; '+
      (pairRows.length-ready)+' profiles have unfinished or missing runs for this contrast.'+
      (selected.length&&!common.size?' The selected pairs have no common physical output; select matching native outputs.':'');
  }

  function selection() {
    const pairs=selectedPairs();
    if(!pairs.length)throw Error('Select at least one completed same-profile native pair.');
    const pollutants=[...root.querySelectorAll('[name="pollutant"]:checked')].filter(node=>!node.disabled).map(node=>node.value);
    if(!pollutants.length)throw Error('Select a physical output with matching producing versions in every selected pair.');
    const title=value('title').trim(),purpose=value('purpose').trim();
    if(!title||!purpose)throw Error('Describe the analysis title and scientific question.');
    const parts=value('quantiles').split(',').map(part=>part.trim());
    const quantiles=parts.map(Number);
    if(!parts.length||parts.some(part=>!part)||quantiles.some(q=>!Number.isFinite(q)||q<0||q>1)||new Set(quantiles).size!==quantiles.length)
      throw Error('Use distinct finite quantiles from zero to one.');
    const planned=Number(value('planned')),memory=Number(value('memory')),tile=Number(value('tile')),handles=Number(value('handles'));
    if(!Number.isInteger(planned)||planned<pairs.length)throw Error('Planned profiles must include all selected pairs.');
    if(!Number.isFinite(memory)||memory<=0)throw Error('Choose a positive tile-array memory budget.');
    if(!Number.isInteger(tile)||tile<1||tile>2048)throw Error('Choose a tile edge from 1 to 2048 pixels.');
    if(!Number.isInteger(handles)||handles<2)throw Error('Allow at least two open raster handles.');
    const thresholds={};
    for(const name of pollutants){
      const raw=value('threshold_'+name).trim();
      if(raw){const amount=Number(raw);if(!Number.isFinite(amount)||amount<0)throw Error('Thresholds must be finite nonnegative pixel-mass quantities.');thresholds[name]=amount;}
    }
    return {title,purpose,pairs,pollutants,quantiles,support:value('support'),planned_member_count:planned,
      memory_mb:memory,tile_size:tile,max_open_datasets:handles,
      ...(Object.keys(thresholds).length?{improvement_thresholds:thresholds}:{}),
      ...(imported?.description?{input_description:imported.description}:{})};
  }
  function applySelection(selected) {
    if(!catalog||!selected||!Array.isArray(selected.pairs)||!selected.pairs.length)
      throw Error('The retained selection has no completed native pairs yet.');
    const before=catalog.runs.find(run=>run.id===selected.pairs[0].baseline_run_id);
    const after=catalog.runs.find(run=>run.id===selected.pairs[0].alternative_run_id);
    if(!before||!after)throw Error('Refresh the original runs in this workspace before loading this selection.');
    const mapping={title:selected.title,purpose:selected.purpose,grid:before.selection.grid_id,
      baseline:before.selection.scenario_id,alternative:after.selection.scenario_id,
      quantiles:(selected.quantiles||[.1,.5,.9]).join(', '),support:selected.support||'all_pairs',
      planned:selected.planned_member_count??selected.pairs.length,memory:selected.memory_mb??256,
      tile:selected.tile_size??256,handles:selected.max_open_datasets??48};
    for(const [name,content] of Object.entries(mapping))if(field(name))field(name).value=content;
    choices=new Map(selected.pairs.map(pair=>[pair.profile_id,{baseline:pair.baseline_run_id,alternative:pair.alternative_run_id,included:true}]));
    for(const run of catalog.runs)if(!choices.has(run.selection.profile_id))choices.set(run.selection.profile_id,{included:false});
    renderPairs(true);
    const actual=selectedPairs();
    if(actual.length!==selected.pairs.length||actual.some(pair=>!selected.pairs.some(wanted=>wanted.profile_id===pair.profile_id&&wanted.baseline_run_id===pair.baseline_run_id&&wanted.alternative_run_id===pair.alternative_run_id)))
      throw Error('The original selected native pair is unavailable. Refresh its retained run state before resuming.');
    const retainedOutputs=selected.pollutants||Object.keys(names);
    const retainedRuns=selectedNativeRuns(catalog.runs,selected.pairs);
    for(const output of retainedOutputs){
      const issue=nativeOutputIssue(retainedRuns,output);
      if(issue)throw Error((names[output]||output)+': '+issue+' The retained selection is unchanged.');
    }
    for(const node of root.querySelectorAll('[name="pollutant"]'))node.checked=retainedOutputs.includes(node.value);
    for(const name of Object.keys(names))field('threshold_'+name).value=selected.improvement_thresholds?.[name]??'';
    imported={...(imported||{}),description:selected.input_description||null};
    version++;captureDraft();
  }
  async function loadDesign(opening={}) {
    const token=epoch,key=workspace,revision=version,design_id=opening.design_id||value('design'),scenario_id=opening.scenario_id||value('design_scenario');
    if(!design_id||!scenario_id)throw Error('Choose a saved design and one of its land-cover alternatives.');
    const result=await api(url('/api/paired-ensemble/cohort',{design_id,scenario_id},key),{signal:reads.signal});
    if(!current(token,key)||revision!==version)return;
    query('[data-pe-design-status]').textContent=result.selected_member_count+' complete pairs of '+result.planned_member_count+' planned profiles.';
    const incompatible=Object.entries(result.incompatible_pollutants||{}).map(([name,reason])=>(names[name]||name)+': '+reason).join(' ');
    if(!result.ready){
      notify(incompatible||(result.selected_member_count?'Completed pairs need a common physical output before analysis.':'These original native cases are still unfinished. Open Scenario sensitivity to run or resume this design.'));
      return;
    }
    imported={design_id,planned_member_count:result.planned_member_count,description:result.selection.input_description};
    applySelection(result.selection);
    const pending=result.pending_members||[];
    query('[data-pe-design-status]').textContent=result.selected_member_count+' complete pairs of '+result.planned_member_count+' planned profiles.'+
      (pending.length?' Pending profiles: '+pending.map(row=>row.label+' ('+row.baseline_state+' / '+row.alternative_state+')').join('; '):'');
    notify('Completed original design pairs loaded. Review the outputs and support rule, then build.'+(incompatible?' '+incompatible:''));
  }
  async function preview() {
    const token=epoch,key=workspace,revision=version,selected=selection();
    notify('Checking the original native source binding…');
    const result=await api('/api/paired-ensemble/preview',{method:'POST',body:{workspace:key,selection:selected},signal:reads.signal});
    if(!current(token,key)||revision!==version)return;
    query('[data-pe-preview]').innerHTML='<div class="pe-preview"><h3>Original source binding</h3>'+
      '<p>'+number(result.members)+' selected profiles of '+number(result.planned_member_count)+' planned; '+
      result.pollutants.map(name=>esc(names[name])).join(', ')+'.</p>'+
      '<p>'+esc(result.effect_direction)+'. '+esc(supportNames[result.support])+'.</p>'+
      '<details><summary>Producing model versions and original runtime records</summary><pre>'+esc(JSON.stringify(result.native_version_provenance,null,2))+'</pre></details>'+
      '<details><summary>Profiles, source references and original grid</summary><pre>'+esc(JSON.stringify(result.source_references,null,2))+'</pre></details></div>';
    notify('Source binding is ready for this selection.');
  }
  async function submit(actionName,payload,{resumeRecord=null,key=workspace}={}) {
    const token=epoch,revision=++submitRevision;
    if(!current(token,key))throw Error('Open the selected workspace before submitting its analysis.');
    const terminal=record=>['complete','failed','cancelled','canceled'].includes(record?.task_state);
    const same=lastRequest?.action===actionName&&JSON.stringify(lastRequest.payload)===JSON.stringify(payload)&&lastRequest.workspace===key;
    const record=resumeRecord&&!terminal(resumeRecord)?resumeRecord:same&&!terminal(lastRequest)?lastRequest:{
      workspace:key,action:actionName,payload:JSON.parse(JSON.stringify(payload)),operation_id:crypto.randomUUID()
    };
    if(record.workspace!==key||record.action!==actionName)throw Error('The saved request belongs to a different action or workspace.');
    lastRequest=record;if(['paired_ensemble.build','paired_ensemble.resume'].includes(actionName))lastSelection=record;remember();
    let task;
    try{
      task=await api('/api/actions',{method:'POST',body:{
        workspace:key,action:actionName,payload:record.payload,operation_id:record.operation_id
      }});
      if(task.workspace!==key)throw Error('The queued task belongs to a different workspace.');
    }catch(error){
      if(current(token,key)&&revision===submitRevision)throw error;
      return null;
    }
    recordTask(task,record);
    if(!current(token,key)||revision!==submitRevision)return task;
    selectedTask=task.id;
    notify('The original queue retained '+actionName+'.');
    await context.refresh?.({force:true});
    if(!current(token,key)||revision!==submitRevision)return task;
    showProgress(task);
    if(['queued','running'].includes(task.state))schedule(task.id);
    return task;
  }
  async function loadTask(taskId) {
    const token=epoch,key=workspace;
    const task=await api(url('/api/task',{id:taskId},key),{signal:reads.signal});
    if(!current(token,key))return null;
    if(task.workspace!==key||!String(task.action).startsWith('paired_ensemble.'))throw Error('Choose a paired-raster task in this workspace.');
    recordTask(task);
    return task;
  }
  async function resumeTask(taskId) {
    const task=await loadTask(taskId);
    if(!task)return;
    if(!['paired_ensemble.build','paired_ensemble.resume'].includes(task.action))throw Error('Choose the original build or resume task.');
    await submit('paired_ensemble.resume',task.payload);
  }
  async function pauseTask(taskId) {
    const token=epoch,key=workspace;
    await api('/api/paired-ensemble/pause',{method:'POST',body:{workspace:key,task_id:taskId}});
    if(current(token,key))notify('Pause requested after the current durable tile. The same original selection can be resumed.');
  }
  function showProgress(task,progress=null) {
    if(!root)return;
    selectedTask=task.id;
    const state=task.result?.state||progress?.state;
    let text=task.action+': '+task.state;
    if(state&&state!==task.state)text+='; analysis '+state;
    if(progress?.phase)text+='; '+progress.phase+' '+number(progress.complete)+' / '+number(progress.total);
    if(task.error?.message)text+='; '+task.error.message;
    query('[data-pe-progress]').textContent=text;
    const computation=['paired_ensemble.build','paired_ensemble.resume'].includes(task.action);
    query('[data-pe-task-actions]').innerHTML=action('task','Open retained task',task.id)+
      (computation&&['queued','running'].includes(task.state)?action('pause','Pause after this tile',task.id):'')+
      (computation&&!['queued','running'].includes(task.state)?action('resume','Resume exact selected pairs',task.id):'')+
      (task.result?.id?action('product','Open analysis',task.result.id):'')+
      downloads(task._downloads||[]);
  }
  function schedule(id) {
    clearTimeout(timer);
    if(!root||workspace!==getState()?.workspace_key)return;
    if(pollingTask!==id)pollRevision++;
    pollingTask=id;
    const token=epoch,key=workspace,revision=pollRevision;
    timer=setTimeout(()=>poll(id,token,key,revision),2500);
  }
  async function poll(id,token,key,revision=pollRevision) {
    const owns=()=>current(token,key)&&revision===pollRevision&&pollingTask===id;
    if(!owns())return;
    if(pollBusy?.revision===revision&&pollBusy?.token===token){schedule(id);return;}
    const claim={id,token,key,revision};pollBusy=claim;
    try {
      const task=await api(url('/api/task',{id},key),{signal:reads.signal});
      if(task.workspace!==key)throw Error('The task belongs to another workspace.');
      recordTask(task);
      if(!owns())return;
      let progress=null;
      if(['queued','running'].includes(task.state)&&['paired_ensemble.build','paired_ensemble.resume'].includes(task.action))
        progress=await api(url('/api/paired-ensemble/progress',{task_id:id},key),{signal:reads.signal});
      if(!owns())return;
      showProgress(task,progress);
      if(['queued','running'].includes(task.state))schedule(id);
      else {
        pollingTask=null;pollRevision++;
        await context.refresh?.({force:true});
        if(current(token,key))renderProducts(getState()?.data?.paired_ensemble_products||[]);
      }
    } catch(error) {
      if(error.name!=='AbortError'&&owns()){notify(error.message,true);pollingTask=null;pollRevision++;}
    } finally {if(pollBusy===claim)pollBusy=null;}
  }
  function downloads(rows) {
    return rows.map(row=>'<a href="'+esc(row.url||('/api/file/'+row.id))+'" download>'+esc(row.label||row.filename||'Download')+'</a>').join('');
  }
  function renderTasks(state) {
    const tasks=(state.tasks||[]).filter(task=>task.workspace===workspace&&String(task.action).startsWith('paired_ensemble.'));
    for(const task of tasks)recordTask(task);
    const signature=JSON.stringify(tasks.map(task=>[task.id,task.state,task.updated_at,task.result?.state]));
    if(signature!==taskSignature){
      taskSignature=signature;
      query('[data-pe-tasks]').innerHTML=tasks.length?'<details><summary>Retained paired-raster tasks ('+tasks.length+')</summary>'+
        table(['Action','Queue state','Analysis state',''],tasks.map(task=>'<tr>'+cell(task.action)+cell(task.state)+cell(task.result?.state||'')+
          '<td>'+action('watch','Follow',task.id)+action('task','Open task',task.id)+'</td></tr>'))+'</details>':'';
    }
    const currentTask=tasks.find(task=>task.id===selectedTask)||tasks.find(task=>['queued','running'].includes(task.state))||tasks[0];
    if(currentTask&&!pollingTask){
      showProgress(currentTask);
      if(['queued','running'].includes(currentTask.state))schedule(currentTask.id);
    }
  }
  function update(state=getState()) {
    if(!root||state?.workspace_key!==workspace||!catalog)return;
    renderProducts(state.data?.paired_ensemble_products||[]);
    renderTasks(state);
  }
  function renderProducts(rows) {
    const signature=JSON.stringify(rows);
    if(signature===productSignature)return;
    productSignature=signature;
    query('[data-pe-products]').innerHTML=rows.length?table(['Analysis','State','Selected profiles','Physical outputs',''],rows.map(row=>'<tr>'+
      '<th scope="row">'+esc(row.title)+'<small><code>'+short(row.id)+'</code></small></th>'+cell(row.state)+cell(row.members)+
      cell((row.pollutants||[]).map(name=>names[name]||name).join(', '))+
      '<td>'+action('product','Open result',row.id)+action('study-transfer','Transfer editable analysis',row.id)+action('export','Export result ZIP',row.id,row.state!=='complete')+'</td></tr>')):
      '<p>Completed analyses retain their quantitative maps and reports here.</p>';
  }

  async function transferProduct(id) {
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose an original saved paired raster analysis.');
    if(typeof context.openDesk!=='function')throw Error('Open the maintained Study transfer desk.');
    const token=epoch,key=workspace,request=++transferRequest;
    const detail=await api(url('/api/paired-ensemble/inspect',{ensemble_id:id},key),{signal:reads.signal});
    if(!current(token,key)||request!==transferRequest)return;
    if(detail.id!==id||detail.schema!=='upstate.paired-raster-ensemble/v1'||!detail.selection)
      throw Error('The saved paired analysis differs from the selected original record.');
    return context.openDesk('study-transfer','openForStudies',{
      workspace_key:key,roots:[{kind:'ensemble-products',id:detail.id,
        title:detail.selection.title||'Paired raster analysis',state:detail.state}]
    });
  }

  async function openProduct(id,{save=true}={}) {
    transferRequest++;
    const token=epoch,key=workspace,request=++detailRequest;
    const detail=await api(url('/api/paired-ensemble/inspect',{ensemble_id:id},key),{signal:reads.signal});
    if(!current(token,key)||request!==detailRequest)return;
    detailId=id;
    const s=detail.selection||{},summaries=detail.summary||{},records=detail.reports?.files||[];
    const native=detail.native_context||{},nativeRuns=new Set(native.available_run_ids||[]);
    const sourceCell=(row,side)=>{
      const id=row[side+'_run_id'];
      let html=id?(nativeRuns.has(id)?action('native-run',short(id),id):'<code>'+esc(id)+'</code>'):'';
      for(const [quantity,pair] of Object.entries(row.rasters||{})){
        const source=pair[side];if(!source)continue;
        html+='<div><strong>'+esc(names[quantity]||quantity)+'</strong> · '+esc(pair.units||'')+'<br>'+number(source.bytes)+' bytes<br><code>'+esc(source.sha256||'Hash absent from original record')+'</code></div>';
      }
      return html||'Original source description retained below';
    };
    const sourceDescription=typeof s.input_description==='string'?s.input_description:JSON.stringify(s.input_description??'Source description absent from this edition');
    let html='<article class="pe-result"><h3>'+esc(s.title||short(id))+'</h3><p>'+esc(detail.state)+
      ' · '+number(s.selected_member_count)+' selected of '+number(s.planned_member_count)+' planned members.</p>'+
      '<p><strong>Purpose:</strong> '+esc(s.purpose||'Purpose absent from this edition')+'</p>'+
      '<p><strong>Retained input kind:</strong> '+esc(s.input_kind||'Input kind absent from this edition')+'</p>'+
      '<p><strong>Original source description:</strong> '+esc(sourceDescription)+'</p>'+
      '<p><strong>Positive reduction = baseline − alternative.</strong> '+esc(supportNames[s.support]||s.support)+'.</p>'+
      (detail.error?'<div class="pe-notice" role="alert">'+esc(detail.error.message||JSON.stringify(detail.error))+'</div>':'')+
      '<div class="pe-actions">'+(detail._report_url?'<a href="'+esc(detail._report_url)+'" target="_blank" rel="noopener">Open full quantitative report</a>':'')+
      action('study-transfer','Transfer editable analysis',id)+
      action('export','Export complete result ZIP',id,detail.state!=='complete')+
      (native.can_resume?action('resume-product','Resume from retained native pairs',id):'')+'</div>';
    if(native.can_resume&&detail.execution_settings){
      const settings=detail.execution_settings;
      html+='<p><strong>Retained execution controls:</strong> '+number(settings.memory_mb)+' MiB for tile arrays, '+
        number(settings.tile_size)+'-pixel requested tile edge and '+number(settings.max_open_datasets)+
        ' open raster handles. Resume continues the saved tile layout with these controls.</p>';
    }
    if(!native.can_resume)html+=s.input_kind==='original Workspace native run artifacts'?
      '<p>The result project retains its quantitative outputs and original source references. Open the scientific Workspace backup to continue calculations from its original native runs.</p>':
      '<p>The original raster members and quantitative outputs remain available below. Continue this analysis through its retained source workflow.</p>';
    if(Object.keys(summaries).length){
      html+=table(['Output','Common / reporting cells','Common coverage','Common / reporting area (ha)','Mean reduction on common support','Member range on common support','Improvement threshold'],Object.entries(summaries).map(([name,summary])=>{
        const spread=summary.basin_reduction_distribution_common_support;
        return '<tr><th scope="row">'+esc(names[name]||name)+'</th>'+cell(number(summary.common_cells)+' / '+number(summary.reporting_cells))+
          cell(summary.common_coverage_fraction===null||summary.common_coverage_fraction===undefined?'Unavailable':number(100*summary.common_coverage_fraction)+'%')+
          cell(number(summary.common_projected_grid_area_ha)+' / '+number(summary.reporting_projected_grid_area_ha))+
          cell(spread?number(spread.mean)+' '+summary.units:'Unavailable')+
          cell(spread?number(spread.minimum)+' to '+number(spread.maximum)+' '+summary.units:'Unavailable')+
          cell(number(s.improvement_thresholds?.[name])+' '+(units[name]||''))+'</tr>';
      }));
      html+='<p>Member distributions sum each paired reduction over the same common cells. These totals cover the full reporting area only when common coverage is 100%. Pixel quantiles remain separate quantitative rasters. Improvement fractions count valid pairs whose baseline − alternative exceeds the retained threshold, using the actual valid-pair denominator at each pixel. Areas shown are projected grid areas.</p>';
      const previews=records.filter(row=>row.path.startsWith('previews/')&&row.path.endsWith('.png'));
      if(previews.length)html+='<div class="pe-previews">'+previews.map(row=>'<figure><img loading="lazy" src="/api/file/paired-ensemble/'+encodeURIComponent(key)+'/'+encodeURIComponent(id)+'/'+pathMember(row.path)+'" alt="'+esc(row.path.replace(/^previews\//,'').replace(/\.png$/,'').replaceAll('_',' '))+'"><figcaption>'+esc(row.path.replace(/^previews\//,'').replace(/\.png$/,'').replaceAll('_',' '))+'</figcaption></figure>').join('')+'</div>';
      html+='<details><summary>Original member totals and valid coverage</summary>'+Object.entries(summaries).map(([name,summary])=>'<h4>'+esc(names[name]||name)+' · '+esc(summary.units)+'</h4>'+
        table(['Member / profile','Baseline on common cells','Alternative on common cells','Reduction on common cells','Reduction %','Paired valid cells'],
          (summary.members||[]).map(row=>'<tr><th scope="row" title="'+esc(row.profile_id||row.id)+'">'+esc(profileName(row.profile_id)||short(row.id))+'</th>'+
            [row.baseline_total_common_support,row.alternative_total_common_support,row.reduction_total_common_support,row.reduction_percent_common_support,row.paired_valid_cells].map(amount=>cell(number(amount))).join('')+'</tr>'))).join('')+'</details>';
    } else html+='<p>'+number(detail.tiles_complete||0)+' durable tiles are retained. The result record includes the current execution state.</p>';
    html+='<details><summary>Quantitative raster and report downloads ('+(detail._downloads||[]).length+')</summary><div class="pe-downloads">'+downloads(detail._downloads||[])+'</div></details>'+
      '<details><summary>Original member sources and references</summary>'+
      table(['Member / profile','Baseline source','Alternative source'],(s.members||[]).map(row=>'<tr>'+
        '<th scope="row">'+esc(profileName(row.profile_id)||row.id||'Member')+'</th>'+
        '<td>'+sourceCell(row,'baseline')+'</td>'+
        '<td>'+sourceCell(row,'alternative')+'</td></tr>'))+
      '<pre>'+esc(JSON.stringify({ensemble_id:id,grid:s.grid,source_references:s.source_references,
        quantiles:s.quantiles,quantile_method:s.quantile_method,improvement_thresholds:s.improvement_thresholds},null,2))+'</pre></details></article>';
    query('[data-pe-detail]').innerHTML=html;
    query('[data-pe-detail]').scrollIntoView?.({block:'nearest'});
    if(save){
      const retain=async()=>{
        if(!current(token,key)||request!==detailRequest)return;
        try{
          const saved=await api(url('/api/paired-ensemble/view',{},key),{method:'POST',body:{workspace:key,ensemble_id:id}});
          if(current(token,key)&&request===detailRequest)catalog.saved_view=saved;
        }catch(error){if(current(token,key)&&request===detailRequest)notify('The result is open. Save its selected view again by reopening the result: '+error.message,true);}
      };
      viewSave=viewSave.then(retain,retain);
      await viewSave;
    }
  }
  async function resumeProduct(id) {
    const token=epoch,key=workspace;
    const result=await api(url('/api/paired-ensemble/selection',{ensemble_id:id},key),{signal:reads.signal});
    if(!current(token,key))return;
    await submit('paired_ensemble.resume',result.selection,{key});
  }
  async function receive() {
    const file=field('archive').files[0],token=epoch,key=workspace,revision=++uploadRevision;
    if(!file)throw Error('Choose the complete result ZIP.');
    const limit=getState()?.limits?.upload_bytes;
    if(Number.isFinite(limit)&&file.size>limit)throw Error('This result ZIP exceeds the operator’s configured upload capacity.');
    notify('Retaining '+file.name+' ('+number(file.size)+' bytes)…');
    const upload=await api('/api/upload',{method:'POST',raw:file,filename:file.name,signal:reads.signal});
    if(!current(token,key)||revision!==uploadRevision||field('archive').files[0]!==file)return;
    await submit('paired_ensemble.receive',{upload_id:upload.id},{key});
  }
  async function loadSaved() {
    let request=lastSelection;
    if(!request){
      const task=(getState()?.tasks||[]).find(row=>row.workspace===workspace&&['paired_ensemble.build','paired_ensemble.resume'].includes(row.action));
      if(task){const full=await loadTask(task.id);if(full)request={payload:full.payload};}
    }
    if(!request)throw Error('Choose an original analysis task or a saved product to load its native pairs.');
    applySelection(request.payload);
    notify('The last submitted native selection is loaded.');
  }
  async function onClick(event) {
    const button=event.target.closest?.('[data-pe-action]');
    if(!button||!root?.contains(button))return;
    event.preventDefault();event.stopPropagation();
    const operation=button.dataset.peAction,id=button.dataset.id,token=epoch,key=workspace;
    button.disabled=true;
    try {
      if(operation==='reload')await reload();
      else if(operation==='design')await loadDesign();
      else if(operation==='preview')await preview();
      else if(operation==='build')await submit('paired_ensemble.build',selection());
      else if(operation==='saved')await loadSaved();
      else if(operation==='product')await openProduct(id);
      else if(operation==='resume-product')await resumeProduct(id);
      else if(operation==='export')await submit('paired_ensemble.export',{ensemble_id:id});
      else if(operation==='study-transfer')await transferProduct(id);
      else if(operation==='receive')await receive();
      else if(operation==='pause')await pauseTask(id);
      else if(operation==='resume')await resumeTask(id);
      else if(operation==='task')await context.showTask(id);
      else if(operation==='native-run')await context.openItem('runs',id);
      else if(operation==='watch'){const task=await loadTask(id);if(task){showProgress(task);if(['queued','running'].includes(task.state))schedule(task.id);}}
      else throw Error('Choose an available paired-raster operation.');
    } catch(error) {
      if(error.name!=='AbortError'&&current(token,key)){notify(error.message,true);toast?.(error.message);}
    } finally {if(button.isConnected)button.disabled=false;}
  }
  function onChange(event) {
    const node=event.target;
    if(node.dataset.peProfile){const row=choices.get(node.dataset.peProfile);if(row)row.included=node.checked;updateQuantities();}
    else if(node.dataset.peRun){const row=choices.get(node.dataset.profile);if(row)row[node.dataset.peRun]=node.value;updateQuantities();}
    else if(node.name==='design')designs();
    else if(['grid','baseline','alternative'].includes(node.name)){
      imported=null;field('planned').value=1;
      renderPairs(false);
      query('[data-pe-design-status]').textContent='';
    }
    version++;
    query('[data-pe-preview]').replaceChildren();
    captureDraft();
  }
  function openOrQueue(value) {
    pendingOpen=value;
    context.navigate('paired-ensemble');
    if(root&&catalog&&workspace===getState()?.workspace_key){
      const opening=pendingOpen;pendingOpen=null;
      if(opening.kind==='design')return loadDesign(opening);
      if(opening.kind==='selection')return applySelection(opening.selection);
      if(opening.kind==='product')return openProduct(opening.id);
    }
  }
  return {
    mount,update,detach,
    prepare: selected => {
      if(!selected||!Array.isArray(selected.pairs)||!selected.pairs.length)
        throw Error('Pass complete original paired runs from the experiment.');
      return openOrQueue({kind:'selection',selection:selected});
    },
    openEdition: id => openOrQueue({kind:'product',id}),
    openForStudy: selection => {
      if(selection?.workspace_key!==getState()?.workspace_key||!/^[0-9a-f]{64}$/.test(selection?.id||''))
        throw Error('Open this saved paired analysis in its original workspace.');
      return openOrQueue({kind:'product',id:selection.id});
    },
    fromDesign: value => openOrQueue({kind:'design',...value}),
    create: value => openOrQueue({kind:'selection',selection:value.selection||value}),
    open: id => openOrQueue({kind:'product',id})
  };
}
