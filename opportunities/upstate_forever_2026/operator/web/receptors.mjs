/* Source-water receiving areas on the existing operator extension host. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const short = value => String(value ?? '').slice(0, 12);
const label = value => String(value ?? '').replaceAll('_', ' ');
const number = value => value === null || value === undefined ? '—' :
  typeof value === 'number' ? value.toLocaleString(undefined, {maximumSignificantDigits: 7}) : String(value);
const copy = value => JSON.parse(JSON.stringify(value));
const active = value => ['queued', 'running'].includes(value);
const ticketURL = ticket => /^\/api\/file\/[a-f0-9]{64}$/.test(ticket?.url || '') ? ticket.url : '';
const metricName = key => ({nitrogen_export:'Nitrogen', phosphorus_export:'Phosphorus', sediment_export:'Sediment'}[key] || label(key));

export function attachReceptorWorkbench({getState, api, endpoint, toast}) {
  let root=null, frame=null, workspace=null, generation=0, catalog=null;
  let draft=null, customProfile=null, planned=null, profileOptions=[], scenarioOptions=[];
  let result=null, pending=null, packageFiles=[], observing=false, fetching=false, pathSelection=null, selectedMapHuc='';
  let filters={profile:'',scenario:'',area:'',pollutant:'',search:''}, page=0;
  const node = selector => frame?.querySelector(selector);
  const currentWorkspace = () => getState()?.workspace_key;
  const storageKey = () => 'upstate-source-water:' + workspace;
  const defaultDraft = () => ({
    mode:'experiment', title:'Source-water scenario comparisons',
    experiment_id:'', receptor_profile_id:'', receptor_ids:[],
    profile_ids:null, scenario_ids:null, baseline_run_id:'', alternative_run_ids:[],
    delivery_id:'', delivery_ids_by_baseline:{}, network_source_id:'', network_member:'',
    network_body_sha256:'', network_decoded_sha256:'', network_product:null,
  });
  const status = (text, error=false) => {
    const output=node('[data-rc-status]');
    if(output){output.textContent=text;output.setAttribute('role',error?'alert':'status');output.classList.toggle('rc-error',error);}
  };
  const remember = () => {
    if(!workspace||!draft)return;
    try{localStorage.setItem(storageKey(),JSON.stringify({draft,customProfile,pending}));}catch(_){}
  };
  const selectedProfile = () => customProfile ||
    catalog?.receptor_profiles?.find(item=>item.id===draft.receptor_profile_id)?.spec;
  const chooseProfile = id => {
    customProfile=null;draft.receptor_profile_id=id;
    draft.receptor_ids=(selectedProfile()?.receptors||[]).map(row=>row.id);
    planned=null;draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;remember();
  };
  const nativeReferenceMatches = reference => {
    const spec=selectedProfile();
    if(draft.network_body_sha256)return reference?.sha256===draft.network_body_sha256;
    if(!spec?.source_collection_id||!spec?.network_source_id)return true;
    if(!reference)return false;
    return (reference.source_collection_id===spec.source_collection_id&&reference.source_id===spec.network_source_id)||
      reference.sha256===spec.source_reference?.sha256;
  };
  const nativeRuns = () => (catalog?.runs||[]).filter(row=>nativeReferenceMatches(row.network_source_reference));
  const nativeExperiments = () => (catalog?.experiments||[]).filter(row=>nativeReferenceMatches(row.network_source_reference));
  function nativeSpecification(spec, reference) {
    if((!spec.source_collection_id||!spec.network_source_id)&&!draft.network_body_sha256)return spec;
    if(!nativeReferenceMatches(reference))throw Error('Choose native results prepared from this retained watershed source.');
    if(spec.source_collection_id!==reference.source_collection_id||spec.network_source_id!==reference.source_id) {
      spec.source_network_reference=copy(spec.source_reference||draft.network_product||{
        source_collection_id:spec.source_collection_id,source_id:spec.network_source_id});
      spec.source_collection_id=reference.source_collection_id;
      spec.network_source_id=reference.source_id;spec.source_reference=copy(reference);
    }
    return spec;
  }
  function controls() {
    return '<header class="page-header"><div><h1>Source-water areas</h1><p>Follow contributing land upstream from water-protection areas, compare retained physical results and carry the complete GIS outputs into a review.</p></div></header>' +
      '<section class="rc-section"><h2>Choose source-water work</h2><div class="rc-controls">' +
      '<label>Work mode<select name="rc-mode"><option value="network">Original watershed connections</option><option value="experiment">All selected experiment profiles</option><option value="inventory">One completed baseline</option></select></label>' +
      '<label>Report title<input name="rc-title" maxlength="240"></label>' +
      '<label>Receptor profile<select name="rc-profile"></select></label>' +
      '<label data-rc-experiment>Retained experiment<select name="rc-experiment"></select></label>' +
      '<label data-rc-direct hidden>Completed baseline<select name="rc-baseline"></select></label>' +
      '<label data-rc-network hidden>Retained watershed source<select name="rc-network-source"></select></label></div>' +
      '<div data-rc-network hidden><p data-rc-source-reference class="rc-note"></p><details class="rc-detail"><summary>Choose a watershed file inside a ZIP</summary><p>A domain archive with one model-domain.esri.json or model-domain.esri.json.gz file is selected automatically.</p><label>Archive member name, when needed<input name="rc-network-member" maxlength="1000" placeholder="folder/model-domain.esri.json.gz"></label></details></div>' +
      '<div data-rc-receptors></div><div data-rc-alternatives hidden></div>' +
      '<details class="rc-detail" data-rc-experiment><summary>Choose experiment profiles and scenarios</summary><p>Preview the retained case plan to choose a subset. Each profile uses its own original-land-cover baseline.</p><div data-rc-case-filters></div></details>' +
      '<details class="rc-detail"><summary>Load another receptor specification</summary><p>The complete specification carries the source anchors and references into the saved result.</p><label>Receptor JSON file<input type="file" accept=".json,application/json" name="rc-profile-file"></label></details>' +
      '<div class="rc-toolbar"><button type="button" data-receptor-action="plan">Preview selected work</button><button type="button" data-receptor-action="build">Build source-water results</button><button type="button" data-receptor-action="refresh">Refresh retained results</button><button type="button" data-receptor-action="resume" hidden>Resume workspace task</button></div>' +
      '<p data-rc-status role="status" aria-live="polite">Opening the existing workspace…</p><div data-rc-packages class="rc-download-links"></div><div data-rc-plan></div></section>' +
      '<section class="rc-section"><h2>Saved outputs</h2><div data-rc-saved></div></section>' +
      '<section class="rc-section" data-rc-result hidden><div data-rc-result-header></div><div data-rc-result-filters></div><div data-rc-quantities></div><div data-rc-path></div><div data-rc-ranges></div><div data-rc-products></div><div data-rc-downloads></div></section>';
  }
  function selectOptions(target, rows, chosen, prompt) {
    if(!target)return;
    target.innerHTML='<option value="">'+esc(prompt)+'</option>'+rows.map(row =>
      '<option value="'+esc(row.id)+'">'+esc(row.title)+'</option>').join('');
    target.value=chosen||'';
  }
  function syncControls() {
    if(!frame||!catalog)return;
    node('[name="rc-mode"]').value=draft.mode;
    node('[name="rc-title"]').value=draft.title;
    const profileRows=(catalog.receptor_profiles||[]).map(row=>({id:row.id,title:row.title}));
    if(customProfile)profileRows.unshift({id:'custom',title:customProfile.title||'Loaded receptor specification'});
    selectOptions(node('[name="rc-profile"]'),profileRows,customProfile?'custom':draft.receptor_profile_id,'Choose a receptor profile');
    selectOptions(node('[name="rc-experiment"]'),nativeExperiments().map(row=>({
      id:row.id,title:row.title+' · '+row.state+' · '+(row.counts?.cases??0)+' cases',
    })),draft.experiment_id,'Choose an existing experiment');
    const baselines=nativeRuns().filter(row=>row.scenario_kind==='baseline').map(row=>({
      id:row.id,title:row.scenario_title+' · '+row.profile_title+' · '+row.pollutants.map(metricName).join(', ')+(row.network_source_reference?' · '+row.network_source_reference.title:''),
    }));
    selectOptions(node('[name="rc-baseline"]'),baselines,draft.baseline_run_id,'Choose a completed baseline');
    selectOptions(node('[name="rc-network-source"]'),(catalog.network_sources||[]).map(row=>({
      id:row.id,title:row.title+' · '+row.vintage+' · '+row.collection_title,
    })),draft.network_source_id,'Choose the retained original watershed source');
    node('[name="rc-network-member"]').value=draft.network_member||'';
    const source=(catalog.network_sources||[]).find(row=>row.id===draft.network_source_id);
    node('[data-rc-source-reference]').textContent=source ?
      source.filename+' · '+number(source.bytes)+' bytes · '+source.uri :
      'Import the original watershed source into this workspace to explore its retained HUC12 and ToHUC relationships.';
    for(const target of frame.querySelectorAll('[data-rc-network]'))target.hidden=draft.mode!=='network';
    for(const target of frame.querySelectorAll('[data-rc-experiment]'))target.hidden=draft.mode!=='experiment';
    for(const target of frame.querySelectorAll('[data-rc-direct]'))target.hidden=draft.mode!=='inventory';
    node('[data-rc-alternatives]').hidden=draft.mode!=='inventory';
    const spec=selectedProfile();
    node('[data-rc-receptors]').innerHTML='<h3>Receiving areas</h3>'+(spec?.receptors?.length ?
      '<div class="rc-choices">'+spec.receptors.map(row=>'<label class="rc-check"><input type="checkbox" data-rc-area-choice="'+esc(row.id)+'" '+(draft.receptor_ids.includes(row.id)?'checked':'')+'><span><strong>'+esc(row.title||row.id)+'</strong><small>'+esc(label(row.role))+' · '+esc((row.anchor_huc12s||[]).join(', '))+'</small></span></label>').join('')+'</div>' :
      '<p>Choose an installed receptor profile to open its original watershed anchors.</p>');
    const baseline=(catalog.runs||[]).find(row=>row.id===draft.baseline_run_id);
    const alternatives=nativeRuns().filter(row=>row.id!==baseline?.id&&row.grid_id===baseline?.grid_id);
    node('[data-rc-alternatives]').innerHTML='<h3>Completed alternatives on the same grid</h3>'+(alternatives.length ?
      '<div class="rc-choices">'+alternatives.map(row=>'<label class="rc-check"><input type="checkbox" data-rc-run-choice="'+esc(row.id)+'" '+(draft.alternative_run_ids.includes(row.id)?'checked':'')+'><span><strong>'+esc(row.scenario_title)+'</strong><small>'+esc(row.profile_title)+' · '+esc(row.pollutants.map(metricName).join(', '))+(row.profile_id!==baseline.profile_id?' · Parameter profile differs':'')+'</small></span></label>').join('')+'</div>' :
      '<p>Complete the retained baseline and at least one alternative on its grid.</p>');
    renderCaseChoices();renderSaved();
  }
  function renderCaseChoices() {
    const checkList=(rows,field,title)=>'<div><h3>'+title+'</h3>'+rows.map(row=>
      '<label class="rc-check"><input type="checkbox" data-rc-filter="'+field+'" value="'+esc(row.id)+'" '+
      (draft[field]===null||draft[field].includes(row.id)?'checked':'')+'><span>'+esc(row.title)+
      (row.total_cases===undefined?'':'<small>'+row.complete_cases+' / '+row.total_cases+' cases complete</small>')+'</span></label>').join('')+'</div>';
    node('[data-rc-case-filters]').innerHTML=profileOptions.length ?
      '<div class="rc-choices">'+checkList(profileOptions,'profile_ids','Parameter profiles')+
      checkList(scenarioOptions,'scenario_ids','Land-cover scenarios')+'</div>' : '';
  }
  function renderSaved() {
    if(!frame||!catalog)return;
    const rows=[...(catalog.comparisons||[]).map(row=>({...row,kind:'comparison'})),
      ...(catalog.inventories||[]).map(row=>({...row,kind:'inventory'})),
      ...(catalog.networks||[]).map(row=>({...row,kind:'network'}))].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    node('[data-rc-saved]').innerHTML=rows.length ?
      '<div class="rc-scroll"><table><caption>Retained source-water products</caption><thead><tr><th>Title</th><th>Type</th><th>State</th><th>Rows</th><th>Open</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+esc(row.title)+'</td><td>'+esc(row.kind==='comparison'?'Experiment profiles':row.kind==='network'?'Original watershed network':'One baseline')+'</td><td>'+esc(label(row.state))+'</td><td>'+esc(number(row.scenario_rows))+'</td><td><button type="button" data-receptor-action="open" data-kind="'+row.kind+'" data-id="'+esc(row.id)+'">Open result</button></td></tr>').join('')+
      '</tbody></table></div>' : '<p>Saved original watershed networks, native comparisons and inventories appear here as their workspace tasks finish.</p>';
  }
  function selection() {
    const original=selectedProfile();
    if(!original?.receptors?.length)throw Error('Choose a receptor profile.');
    const spec=copy(original);spec.receptors=spec.receptors.filter(row=>draft.receptor_ids.includes(row.id));
    if(!spec.receptors.length)throw Error('Select at least one receiving area.');
    if(!draft.title.trim())throw Error('Give the report a title.');
    if(draft.mode==='network') {
      const source=catalog.network_sources?.find(row=>row.id===draft.network_source_id);
      if(!source)throw Error('Choose the retained original watershed source.');
      spec.title=draft.title.trim();
      spec.source_collection_id=source.source_collection_id;spec.network_source_id=source.source_id;
      spec.source_reference=Object.fromEntries(['source_collection_id','source_id','uri','vintage','title','sha256'].map(key=>[key,source[key]]));
      return {source_collection_id:source.source_collection_id,network_source_id:source.source_id,receptor_spec:spec,
        ...(draft.network_member.trim()?{member:draft.network_member.trim()}:{}),
        ...(draft.network_decoded_sha256?{expected_decoded_sha256:draft.network_decoded_sha256}:{})};
    }
    if(draft.mode==='inventory') {
      if(!draft.baseline_run_id||!draft.alternative_run_ids.length)throw Error('Select a completed baseline and at least one alternative.');
      spec.title=draft.title.trim();
      return {baseline_run_id:draft.baseline_run_id,scenario_run_ids:[...draft.alternative_run_ids].sort(),
        receptor_spec:nativeSpecification(spec,catalog.runs.find(row=>row.id===draft.baseline_run_id)?.network_source_reference),
        ...(draft.delivery_id?{delivery_id:draft.delivery_id}:{})};
    }
    if(!draft.experiment_id)throw Error('Choose a retained experiment.');
    for(const field of ['profile_ids','scenario_ids'])if(Array.isArray(draft[field])&&!draft[field].length)
      throw Error('Select at least one '+(field==='profile_ids'?'parameter profile.':'land-cover scenario.'));
    return {title:draft.title.trim(),experiment_id:draft.experiment_id,
      receptor_spec:nativeSpecification(spec,catalog.experiments.find(row=>row.id===draft.experiment_id)?.network_source_reference),
      profile_ids:draft.profile_ids?[...draft.profile_ids].sort():[],
      scenario_ids:draft.scenario_ids?[...draft.scenario_ids].sort():[],
      ...(Object.keys(draft.delivery_ids_by_baseline||{}).length?{delivery_ids_by_baseline:copy(draft.delivery_ids_by_baseline)}:{})};
  }
  async function loadCatalog() {
    const epoch=++generation, requested=workspace;fetching=true;
    status('Reading the retained watershed sources, experiments, native runs and receptor specifications…');
    try {
      const loaded=await api(endpoint('/api/receptors/catalog'));
      if(epoch!==generation||workspace!==requested||!frame)return;
      catalog=loaded;
      if(!draft.experiment_id&&catalog.experiments?.length)draft.experiment_id=catalog.experiments[0].id;
      if(!customProfile&&!catalog.receptor_profiles?.some(row=>row.id===draft.receptor_profile_id)&&catalog.receptor_profiles?.length)chooseProfile(catalog.receptor_profiles[0].id);
      if(!draft.network_source_id&&catalog.network_sources?.length) {
        const preferred=catalog.network_sources.find(row=>/model.domain|watershed|HUC12|217/i.test(row.filename+' '+row.title));
        draft.network_source_id=(preferred||catalog.network_sources[0]).id;
      }
      if(!draft.baseline_run_id)draft.baseline_run_id=nativeRuns().find(row=>row.scenario_kind==='baseline')?.id||'';
      if(!catalog.experiments?.length&&draft.mode==='experiment')draft.mode=catalog.runs?.length?'inventory':'network';
      if(draft.mode==='network'&&draft.title==='Source-water scenario comparisons')draft.title='Original watershed connections';
      syncControls();remember();status('Retained workspace results are ready.');
    }catch(error){if(epoch===generation)status(error.message||String(error),true);}
    finally{if(epoch===generation)fetching=false;}
  }
  async function preview() {
    const value=selection();
    if(draft.mode==='network') {
      const requested=workspace, epoch=generation, signature=JSON.stringify(value);
      status('Following the original watershed links to the selected receiving areas…');
      const loaded=await api(endpoint('/api/receptors/network-plan'),{method:'POST',body:{workspace:requested,selection:value}});
      if(epoch!==generation||workspace!==requested||!frame)return;
      if(JSON.stringify(selection())!==signature){status('The selection changed. Preview its current watershed connections.');return;}
      planned=loaded;draft.network_body_sha256=loaded.source_binding.body_sha256;
      draft.network_decoded_sha256=loaded.source_binding.decoded_sha256;remember();
      node('[data-rc-plan]').innerHTML='<h3>Original upstream connections</h3><p>'+number(loaded.network_huc12_count)+' retained watershed units · '+
        number(loaded.selected_huc12_count)+' unique contributing units · '+Object.keys(loaded.shared_huc12s||{}).length+' shared by the selected receiving areas.</p>'+
        '<div class="rc-scroll"><table><thead><tr><th>Receiving area</th><th>Contributing HUC12 units</th><th>Original anchors</th></tr></thead><tbody>'+
        loaded.areas.map(area=>'<tr><td>'+esc(area.title)+'</td><td>'+number(area.huc12_count)+'</td><td>'+esc(area.anchor_huc12s.join(', '))+'</td></tr>').join('')+'</tbody></table></div>';
      status('The actual source network and selected anchors are ready to save.');return;
    }
    if(draft.mode==='inventory') {
      const baseline=catalog.runs.find(row=>row.id===value.baseline_run_id);
      const alternatives=value.scenario_run_ids.map(id=>catalog.runs.find(row=>row.id===id));
      const common=(baseline?.pollutants||[]).filter(key=>alternatives.every(row=>row?.pollutants.includes(key)));
      node('[data-rc-plan]').innerHTML='<h3>Selected native comparison</h3><p>'+alternatives.length+' completed alternatives · '+value.receptor_spec.receptors.length+' receiving areas · '+esc(common.map(metricName).join(', ')||'No common retained pollutant')+'</p><p>Baseline: '+esc(baseline?.scenario_title)+' · '+esc(baseline?.profile_title)+'</p>';
      status('The inventory will use these existing completed native rasters.');return;
    }
    const requested=workspace, epoch=generation, signature=JSON.stringify(value);
    status('Reading every original experiment case page…');
    const loaded=await api(endpoint('/api/receptors/plan'),{method:'POST',body:{workspace:requested,selection:value}});
    if(epoch!==generation||workspace!==requested||!frame)return;
    if(JSON.stringify(selection())!==signature){status('The selection changed. Preview its current profile groups.');return;}
    planned=loaded;profileOptions=loaded.profiles;scenarioOptions=loaded.scenarios;renderCaseChoices();
    node('[data-rc-plan]').innerHTML='<h3>Selected profile groups</h3><p>'+loaded.selected_cases+' selected land-cover cases · '+loaded.pending_cases+' native cases progressing.</p><div class="rc-scroll"><table><thead><tr><th>Profile</th><th>Own baseline</th><th>Completed alternatives</th></tr></thead><tbody>'+
      loaded.groups.map(group=>'<tr><td>'+esc(group.profile_title)+'</td><td><code>'+esc(short(group.baseline_run_id))+'</code></td><td>'+group.alternative_run_ids.length+'</td></tr>').join('')+'</tbody></table></div>';
    status('The original profile-to-baseline mappings are ready.');
  }
  async function submit(action,payload) {
    if(pending&&active(pending.state)){status('The current workspace task is '+pending.state+'.');return;}
    const requested=workspace, epoch=generation, key=action+':'+JSON.stringify(payload);
    if(!pending||pending.body_key!==key)pending={
      operation_id:crypto.randomUUID(),action,body_key:key,state:'submitting'};
    remember();status('Submitting the selected source-water task…');
    const operation=pending.operation_id;
    const queued=await api('/api/actions',{method:'POST',body:{
      workspace:requested,action,payload,operation_id:operation}});
    if(workspace!==requested||epoch!==generation||!frame)return;
    pending={...pending,...queued,body_key:key,operation_id:operation,action};
    remember();status('Source-water task '+pending.state+'. Its original progress is retained.');
  }
  function downloadLinks(files) {
    return (files||[]).filter(item=>ticketURL(item)).map(item=>
      '<a href="'+esc(ticketURL(item))+'?download=1" download>'+esc(item.label||item.filename)+'</a>').join(' · ');
  }
  async function openResult(kind,id) {
    const requested=workspace, epoch=++generation;fetching=true;
    status('Opening the saved source-water product and original file references…');
    try {
      const loaded=await api(endpoint('/api/receptors/'+kind,{id}));
      if(workspace!==requested||epoch!==generation||!frame)return;
      result=loaded;filters={profile:'',scenario:'',area:'',pollutant:'',search:''};page=0;packageFiles=[];pathSelection=null;selectedMapHuc='';
      renderResult();status('Saved source-water results reopened.');
    }catch(error){if(epoch===generation)status(error.message||String(error),true);}
    finally{if(epoch===generation)fetching=false;}
  }
  const resultRows = () => result?._kind==='network'?result.memberships||[]:
    result?._kind==='comparison'?result.rows||[]:result?.scenario_exports||[];
  function renderResult() {
    if(!result||!frame)return;
    node('[data-rc-result]').hidden=false;
    if(result._kind==='network')return renderNetwork();
    node('[data-rc-path]').replaceChildren();
    const rows=resultRows(), report=ticketURL(result._report);
    node('[data-rc-result-header]').innerHTML='<h2>'+esc(result.title)+'</h2><p>'+rows.length+' retained receiving-area quantities · '+esc(label(result.state||'complete'))+'</p>'+
      '<div class="rc-toolbar">'+(report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable report</a>':'')+
      '<button type="button" data-receptor-action="export">Export complete results package</button>'+
      '<button type="button" data-receptor-action="reuse">Use this saved selection</button></div>'+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div><p class="rc-note">Quantities describe modeled annual export from contributing land to the stream network. Change is alternative minus baseline on the same valid pixels. Each experiment profile retains its own baseline; receiving areas can share upstream land.</p>';
    const choices=(field)=>[...new Set(rows.map(row=>row[field]||'').filter(Boolean))].sort();
    node('[data-rc-result-filters]').innerHTML='<div class="rc-controls">'+[
      ['profile','profile_title','Profile'],['scenario','scenario_title','Scenario'],
      ['area','receptor_title','Receiving area'],['pollutant','pollutant','Pollutant']
    ].filter(([name])=>name!=='profile'||result._kind==='comparison').map(([name,field,title])=>
      '<label>'+title+'<select data-rc-row-filter="'+name+'"><option value="">All</option>'+
      choices(field).map(value=>'<option value="'+esc(value)+'">'+esc(field==='pollutant'?metricName(value):value)+'</option>').join('')+'</select></label>').join('')+
      '<label>Search<input type="search" data-rc-row-filter="search" placeholder="Area, scenario or profile"></label></div>';
    renderQuantities();renderRanges();renderProducts();
  }
  function networkMapMarkup() {
    const view=result.geography_view;
    if(!view?.shapes?.length)return '';
    return '<figure class="rc-geography"><div class="rc-toolbar"><button type="button" data-receptor-action="map-in">Zoom in</button>'+
      '<button type="button" data-receptor-action="map-out">Zoom out</button><button type="button" data-receptor-action="map-reset">Reset view</button></div>'+
      '<svg data-rc-geography xmlns="http://www.w3.org/2000/svg" viewBox="'+esc(view.view_box.join(' '))+'" role="group" aria-label="Original watershed polygons">'+
      view.shapes.map(shape=>'<path class="rc-unit" d="'+esc(shape.path)+'" data-receptor-action="map-select" data-huc="'+esc(shape.huc12)+'" tabindex="0" role="button" aria-label="'+
      esc(shape.huc12+' '+(shape.name||''))+'"><title>'+esc(shape.huc12+' · '+(shape.name||''))+'</title></path>').join('')+
      '</svg><figcaption><p>Original source polygons. Contributing units are shaded; selected anchors are darkest. Choose a watershed to find its upstream memberships, then inspect its drainage path.</p>'+
      '<p data-rc-map-status role="status">The complete source package keeps the original geometry and interactive offline map.</p></figcaption></figure>';
  }
  function syncNetworkMap() {
    const svg=node('[data-rc-geography]');
    if(!svg||!result.geography_view)return;
    const shapes=new Map(result.geography_view.shapes.map(row=>[row.huc12,row]));
    for(const path of svg.querySelectorAll('[data-huc]')){
      const row=shapes.get(path.dataset.huc), member=row.area_ids.some(id=>!filters.area||id===filters.area);
      const anchor=row.anchor_area_ids.some(id=>!filters.area||id===filters.area);
      const matches=!filters.search||[row.huc12,row.name,row.tohuc_original,row.source_feature_id].join(' ').toLowerCase().includes(filters.search.toLowerCase());
      path.classList.toggle('rc-member',member);path.classList.toggle('rc-anchor',anchor);
      path.classList.toggle('rc-quiet',Boolean((filters.area&&!member)||!matches));
      path.classList.toggle('rc-chosen',row.huc12===selectedMapHuc);
    }
  }
  function selectMapHuc(huc) {
    const selected=result.geography_view?.shapes.find(row=>row.huc12===huc);
    if(!selected)return;
    selectedMapHuc=huc;filters.search=huc;page=0;
    const field=node('[data-rc-row-filter="search"]');if(field)field.value=huc;
    renderMemberships();
    node('[data-rc-map-status]').textContent=huc+' · '+(selected.name||'')+
      (selected.area_ids.length?' · Original upstream memberships are listed below.':' · Original source watershed outside the selected receiving-area memberships.');
  }
  function zoomNetworkMap(action) {
    const svg=node('[data-rc-geography]'), full=result?.geography_view?.view_box;
    if(!svg||!full)return;
    if(action==='map-reset'){svg.setAttribute('viewBox',full.join(' '));return;}
    const current=svg.getAttribute('viewBox').split(' ').map(Number);
    const width=Math.max(full[2]/32,Math.min(full[2],current[2]*(action==='map-in'?1/1.5:1.5)));
    const height=width*full[3]/full[2];
    let x=current[0]+current[2]/2,y=current[1]+current[3]/2;
    const selected=[...svg.querySelectorAll('[data-huc]')].find(path=>path.dataset.huc===selectedMapHuc);
    if(selected){const box=selected.getBBox();x=box.x+box.width/2;y=box.y+box.height/2;}
    svg.setAttribute('viewBox',[x-width/2,y-height/2,width,height].join(' '));
  }
  function renderNetwork() {
    const report=ticketURL(result._report), shared=Object.keys(result.shared_huc12s||{});

    node('[data-rc-result-header]').innerHTML='<h2>'+esc(result.title)+'</h2>'+
      '<div class="rc-metrics"><div><strong>'+number(result.network_huc12_count)+'</strong><span>Original HUC12 units</span></div>'+
      '<div><strong>'+number(result.selected_huc12_count)+'</strong><span>Unique contributing units</span></div>'+
      '<div><strong>'+number(shared.length)+'</strong><span>Units shared by receiving areas</span></div></div>'+
      '<div class="rc-toolbar">'+(report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable source report</a>':'')+
      '<button type="button" data-receptor-action="export">Export complete source package</button>'+
      '<button type="button" data-receptor-action="reuse">Use these receiving areas again</button></div>'+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div>'+
      networkMapMarkup()+
      '<p class="rc-note">Membership follows the original ToHUC drainage links upstream from each selected anchor, including the anchor watershed. A watershed can contribute to more than one selected receiving area. Link counts describe steps through the retained network.</p>'+
      '<div class="rc-scroll"><table><caption>Selected receiving areas</caption><thead><tr><th>Area</th><th>Role</th><th>Contributing HUC12 units</th><th>Shared units</th><th>Original anchors</th></tr></thead><tbody>'+
      result.areas.map(area=>'<tr><td>'+esc(area.title)+'</td><td>'+esc(label(area.role))+'</td><td>'+number(area.huc12_count)+'</td><td>'+
      number((area.huc12s||[]).filter(huc=>shared.includes(huc)).length)+'</td><td>'+esc(area.anchor_huc12s.join(', '))+'</td></tr>').join('')+'</tbody></table></div>';
    node('[data-rc-result-filters]').innerHTML='<div class="rc-controls"><label>Receiving area<select data-rc-row-filter="area"><option value="">All</option>'+
      result.areas.map(area=>'<option value="'+esc(area.id)+'">'+esc(area.title)+'</option>').join('')+'</select></label>'+
      '<label>Search original network<input type="search" data-rc-row-filter="search" placeholder="HUC12, name, original ToHUC or source ID"></label></div>';
    node('[data-rc-ranges]').replaceChildren();
    renderMemberships();renderPath();renderNetworkProducts();
  }
  function renderMemberships() {
    const rows=(result.memberships||[]).filter(row=>
      (!filters.area||row.receptor_id===filters.area)&&(!filters.search||
      [row.huc12,row.name,row.tohuc_original,row.receptor_title,row.anchor_huc12,row.source_feature_id].join(' ').toLowerCase().includes(filters.search.toLowerCase())));
    const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.max(0,Math.min(page,pages-1));
    const shown=rows.slice(page*50,page*50+50);
    node('[data-rc-quantities]').innerHTML='<div class="rc-scroll" tabindex="0"><table><caption>Original upstream memberships and drainage paths</caption><thead><tr><th>HUC12</th><th>Watershed name</th><th>Receiving area</th><th>Selected anchor</th><th>Links to anchor</th><th>Original ToHUC</th><th>Unit type</th><th>Path</th></tr></thead><tbody>'+
      shown.map(row=>'<tr><td><code>'+esc(row.huc12)+'</code></td><td>'+esc(row.name)+'</td><td>'+esc(row.receptor_title)+'</td><td><code>'+
      esc(row.anchor_huc12)+'</code></td><td class="rc-number">'+number(row.links_to_anchor)+'</td><td><code>'+esc(row.tohuc_original)+'</code></td><td>'+
      esc(row.hutype)+'</td><td><button type="button" data-receptor-action="path" data-area="'+esc(row.receptor_id)+'" data-huc="'+esc(row.huc12)+'">Inspect path</button></td></tr>').join('')+
      '</tbody></table></div><div class="rc-toolbar"><button type="button" data-receptor-action="previous" '+(page===0?'disabled':'')+'>Previous</button><span>'+
      rows.length+' matching memberships · Page '+(page+1)+' of '+pages+'</span><button type="button" data-receptor-action="next" '+(page+1>=pages?'disabled':'')+'>Next</button></div>';
    syncNetworkMap();
  }
  function renderPath() {
    const target=node('[data-rc-path]');target.tabIndex=-1;
    if(!pathSelection){target.innerHTML='<p class="rc-note">Choose Inspect path beside a watershed to follow its original downstream links to the selected receiving anchor.</p>';return;}
    const area=result.network.areas.find(row=>row.id===pathSelection.area);
    if(!area)throw Error('Choose a receiving area in this retained network.');
    const memberships=new Map(area.memberships.map(row=>[row.huc12,row]));
    const originals=new Map(result.network.network.map(row=>[row.huc12,row]));
    const start=memberships.get(pathSelection.huc);
    if(!start)throw Error('Choose a watershed in this receiving area.');
    let cursor=start.huc12;const rows=[],seen=new Set();
    while(cursor){
      if(seen.has(cursor)||rows.length>result.network_huc12_count)throw Error('The saved membership path contains a repeated watershed.');
      seen.add(cursor);const member=memberships.get(cursor), original=originals.get(cursor);
      if(!member||!original)throw Error('The saved membership path is missing an original watershed.');
      rows.push({member,original});if(cursor===start.anchor_huc12)break;cursor=member.downstream_huc12;
    }
    if(rows.at(-1)?.member.huc12!==start.anchor_huc12)throw Error('The saved drainage path does not reach its selected anchor.');
    target.innerHTML='<section class="rc-path"><h3>'+esc(area.title)+' · Drainage path from '+esc(start.huc12)+'</h3><p>'+
      number(start.links_to_anchor)+' original ToHUC links to anchor '+esc(start.anchor_huc12)+'.</p>'+
      '<div class="rc-scroll"><table><caption>Original watershed sequence</caption><thead><tr><th>Step</th><th>HUC12</th><th>Watershed name</th><th>Original ToHUC</th><th>Remaining links</th><th>Source feature ID</th></tr></thead><tbody>'+
      rows.map(({member,original},index)=>'<tr><td>'+index+'</td><td><code>'+esc(member.huc12)+'</code>'+(member.huc12===start.anchor_huc12?'<small>Selected anchor</small>':'')+
      '</td><td>'+esc(original.name)+'</td><td><code>'+esc(original.tohuc_original)+'</code></td><td>'+number(member.links_to_anchor)+'</td><td>'+
      esc(original.source_feature_id)+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="rc-note">The trace ends at the selected anchor. Its original downstream value remains visible in the table and the source download.</p></section>';
  }
  function renderNetworkProducts() {
    const spec=result.identity.receptor_spec, binding=result.source_binding;
    const reference=spec.source_reference||{}, names={
      'memberships.csv':'Upstream memberships CSV','areas.csv':'Receiving areas CSV',
      'network.csv':'Original drainage links CSV','network.json':'Complete network and source attributes',
      'source-profile.json':'Reusable receiving-area specification','result.json':'Saved source result',
    };
    const prefix='receptor-networks/'+result.id+'/';
    const files=(result._downloads||[]).filter(file=>file.label?.startsWith(prefix)&&!file.filename.endsWith('.html')).map(file=>({
      ...file,label:file.filename===result.source_body_filename?'Original watershed geometry and attributes':names[file.filename]||file.filename}));
    node('[data-rc-products]').innerHTML='<h3>Retained watershed source</h3><div class="rc-products"><article><h4>'+esc(reference.title||binding.input_filename)+'</h4>'+
      '<p>'+esc(reference.vintage||'')+'</p><p class="rc-note">'+esc(reference.uri||'')+'</p>'+
      '<p>'+number(binding.feature_count)+' original feature records · '+esc(binding.feature_identity_field||'Retained feature order')+'</p>'+
      '<p class="rc-download-links">'+downloadLinks(files)+'</p></article></div>';
    node('[data-rc-downloads]').innerHTML='<details class="rc-detail"><summary>Source identity and network context</summary>'+
      '<p>Decoded original source: <code>'+esc(binding.decoded_sha256)+'</code></p>'+
      '<p>Retained source body: <code>'+esc(binding.body_sha256)+'</code></p>'+
      '<p>'+number(result.network.outside_network_links?.length||0)+' original links leave the retained network; '+
      number(result.network.terminal_links?.length||0)+' use original terminal labels; '+
      number(result.network.special_hydrologic_units?.length||0)+' retain a special source hydrologic-unit type.</p>'+
      '<p>Saved result: <code>'+esc(result.id)+'</code></p></details>';
  }
  function renderQuantities() {
    if(!result||!frame)return;
    if(result._kind==='network')return renderMemberships();
    const rows=resultRows().filter(row=>
      (!filters.profile||row.profile_title===filters.profile)&&
      (!filters.scenario||row.scenario_title===filters.scenario)&&
      (!filters.area||row.receptor_title===filters.area)&&
      (!filters.pollutant||row.pollutant===filters.pollutant)&&
      (!filters.search||[row.receptor_title,row.scenario_title,row.profile_title].join(' ').toLowerCase().includes(filters.search.toLowerCase())));
    const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.max(0,Math.min(page,pages-1));
    const shown=rows.slice(page*50,page*50+50);
    node('[data-rc-quantities]').innerHTML='<div class="rc-scroll" tabindex="0"><table><caption>Annual contributing-land export and change</caption><thead><tr>'+
      (result._kind==='comparison'?'<th>Profile</th>':'')+'<th>Receiving area</th><th>Scenario</th><th>Pollutant</th><th>Baseline</th><th>Alternative</th><th>Change</th><th>Change, %</th><th>Unit</th><th>Compared / selected pixels</th><th>Parameters</th></tr></thead><tbody>'+
      shown.map(row=>'<tr>'+(result._kind==='comparison'?'<td>'+esc(row.profile_title)+'</td>':'')+
      '<td>'+esc(row.receptor_title)+'</td><td>'+esc(row.scenario_title)+'</td><td>'+esc(metricName(row.pollutant))+'</td>'+
      ['common_baseline_export','common_alternative_export','alternative_minus_baseline','change_percent'].map(key=>'<td class="rc-number">'+esc(number(row[key]))+'</td>').join('')+
      '<td>'+esc(row.unit)+'</td><td>'+esc(number(row.common_valid_cells))+' / '+esc(number(row.selected_cells))+'</td><td>'+esc(row.profile_changed?'Profile differs':'Same profile')+'</td></tr>').join('')+
      '</tbody></table></div><div class="rc-toolbar"><button type="button" data-receptor-action="previous" '+(page===0?'disabled':'')+'>Previous</button><span>'+rows.length+' matching rows · Page '+(page+1)+' of '+pages+'</span><button type="button" data-receptor-action="next" '+(page+1>=pages?'disabled':'')+'>Next</button></div>';
  }
  function renderRanges() {
    const rows=result.profile_ranges||[];
    node('[data-rc-ranges]').innerHTML=rows.length?'<details class="rc-detail"><summary>Range across evaluated parameter profiles</summary><div class="rc-scroll"><table><thead><tr><th>Area</th><th>Scenario</th><th>Pollutant</th><th>Minimum change</th><th>Median change</th><th>Maximum change</th><th>Unit</th><th>Profiles with quantities</th><th>Whole-basin pair footprint</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+esc(row.receptor_title)+'</td><td>'+esc(row.scenario_title)+'</td><td>'+esc(metricName(row.pollutant))+'</td>'+
      ['minimum_change','median_change','maximum_change'].map(key=>'<td>'+esc(number(row[key]))+'</td>').join('')+
      '<td>'+esc(row.unit)+'</td><td>'+row.profiles_with_quantities+' / '+row.evaluated_profiles+'</td><td>'+(row.same_basin_support?'Same':'Varies')+'</td></tr>').join('')+
      '</tbody></table></div><p>Ranges describe the evaluated profile choices. Each detailed quantity retains its own common-valid footprint.</p></details>':'';
  }
  function renderProducts() {
    if(result._kind==='network')return renderNetworkProducts();
    const groups=result._kind==='comparison'?result.groups||[]:[{
      state:'complete',profile_title:'Selected baseline',inventory_id:result.id,
      areas:result.areas,files:result.files,pollutants:result.pollutants,
    }];
    node('[data-rc-products]').innerHTML='<h3>Editable profile products</h3><div class="rc-products">'+groups.map(group=>{
      if(group.state!=='complete')return '<article><h4>'+esc(group.profile_title)+'</h4><p>'+esc(group.error?.message||group.state)+'</p></article>';
      const prefix='receptor-inventories/'+group.inventory_id+'/';
      const files=(result._downloads||[]).filter(file=>file.label?.startsWith(prefix));
      const report=ticketURL(result._profile_reports?.[prefix+'index.html']);
      const named=files.map(file=>({...file,label:({'contributing-areas.gpkg':'Editable GeoPackage','memberships.csv':'Original HUC memberships','scenario-exports.csv':'Physical quantities','inventory.json':'Inventory record','network.json':'Original network'}[file.filename]||file.filename)}));
      return '<article><h4>'+esc(group.profile_title)+'</h4><p>'+(group.areas?.length||0)+' receiving areas · '+esc((group.pollutants||[...new Set((group.scenario_exports||[]).map(row=>row.pollutant))]).map(metricName).join(', '))+'</p>'+
        (report?'<p><a href="'+esc(report)+'" target="_blank" rel="noopener">Open area report</a></p>':'')+
        '<p class="rc-download-links">'+downloadLinks(named.filter(file=>!['index.html','result.json'].includes(file.filename)))+'</p></article>';
    }).join('')+'</div>';
    const prefix=(result._kind==='comparison'?'receptor-experiments/':'receptor-inventories/')+result.id+'/';
    const files=(result._downloads||[]).filter(file=>file.label?.startsWith(prefix)&&!file.filename.endsWith('.html')).map(file=>({...file,label:file.filename}));
    node('[data-rc-downloads]').innerHTML='<details class="rc-detail"><summary>Complete saved records and quantities</summary><p class="rc-download-links">'+downloadLinks(files)+'</p><p><code>'+esc(result.id)+'</code></p></details>';
  }
  function useSaved() {
    if(!result)return;
    draft.mode=result._kind==='comparison'?'experiment':result._kind==='network'?'network':'inventory';draft.title=result.title;
    const selected=result.selection;
    if(result._kind!=='network'){draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;}
    if(result._kind==='network') {
      customProfile=copy(result.identity.receptor_spec);
      draft.network_product={id:result.id,source_body_sha256:result.source_binding.body_sha256,
        decoded_source_sha256:result.source_binding.decoded_sha256};
      const source=catalog.network_sources?.find(row=>row.source_collection_id===customProfile.source_collection_id&&row.source_id===customProfile.network_source_id);
      draft.network_source_id=source?.id||'';
      draft.network_member=result.source_binding.zip_member||'';
      draft.network_body_sha256=result.source_binding.body_sha256;
      draft.network_decoded_sha256=result.source_binding.decoded_sha256;
    } else if(result._kind==='comparison') {
      draft.experiment_id=selected.experiment_id;
      draft.profile_ids=selected.profile_ids?.length?selected.profile_ids:null;
      draft.scenario_ids=selected.scenario_ids?.length?selected.scenario_ids:null;
      draft.delivery_ids_by_baseline=copy(selected.delivery_ids_by_baseline||{});
      customProfile=copy(selected.receptor_spec);
    } else {
      const original=result.build_selection||{baseline_run_id:result.baseline_run_id,
        scenario_run_ids:result.alternative_run_ids,receptor_spec:selected};
      draft.baseline_run_id=original.baseline_run_id;
      draft.alternative_run_ids=[...(original.scenario_run_ids||[])];
      draft.delivery_id=original.delivery_id||'';
      customProfile=copy(original.receptor_spec);
    }
    draft.receptor_profile_id='';draft.receptor_ids=customProfile.receptors.map(row=>row.id);
    profileOptions=[];scenarioOptions=[];planned=null;syncControls();remember();
    status(result._kind==='network'?'The original source and receiving areas are ready to reuse. Choose a native work mode to carry them into completed regional results.':'The complete saved selection is ready to reuse with current completed native results.');
  }
  async function act(action,target) {
    if(action==='refresh')return loadCatalog();
    if(action==='plan')return preview();
    if(action==='build')return submit(draft.mode==='experiment'?'receptor.experiment.build':draft.mode==='network'?'receptor.network.build':'receptor.inventory.build',{selection:selection()});
    if(action==='open')return openResult(target.dataset.kind,target.dataset.id);
    if(action==='export'){
      if(!result)throw Error('Open a saved result first.');
      return submit('receptor.package.export',{kind:result._kind,id:result.id});
    }
    if(action==='reuse')return useSaved();
    if(action==='path'){pathSelection={area:target.dataset.area,huc:target.dataset.huc};selectedMapHuc=target.dataset.huc;renderPath();syncNetworkMap();node('[data-rc-path]')?.focus();return;}
    if(action==='map-select')return selectMapHuc(target.dataset.huc);
    if(['map-in','map-out','map-reset'].includes(action))return zoomNetworkMap(action);
    if(action==='previous'){page--;return renderQuantities();}
    if(action==='next'){page++;return renderQuantities();}
    if(action==='resume'&&pending?.id) {
      const resumed=await api('/api/task/resume',{method:'POST',body:{id:pending.id}});
      pending={...pending,...resumed};remember();node('[data-receptor-action="resume"]').hidden=true;
      return status('The original workspace task is queued for continuation.');
    }
  }
  async function update() {
    if(!frame)return;
    if(workspace!==currentWorkspace())return mount(root);
    const sourceState=getState()?.data?.source_water;
    if(sourceState&&catalog){catalog.comparisons=sourceState.comparisons||[];catalog.inventories=sourceState.inventories||[];catalog.networks=sourceState.networks||[];renderSaved();}
    if(!pending||observing)return;
    const task=(getState()?.tasks||[]).find(row=>row.id===pending.id||row.operation_id===pending.operation_id);
    if(!task)return;
    pending={...pending,...task};remember();
    if(['failed','interrupted','cancelled'].includes(task.state)){
      status(task.error?.message||'The retained workspace task can be resumed.',true);
      node('[data-receptor-action="resume"]').hidden=false;return;
    }
    if(task.state!=='complete'){status('Source-water task '+task.state+'.');return;}
    observing=true;
    const requested=workspace, epoch=generation, finished=pending;
    try {
      if(finished.action==='receptor.package.export'){
        const decorated=await api('/api/task?id='+encodeURIComponent(finished.id));
        if(workspace!==requested||epoch!==generation||!frame)return;
        packageFiles=decorated._downloads||[];
        node('[data-rc-packages]').innerHTML='<strong>Completed result package</strong> · '+downloadLinks(packageFiles);
        node('[data-rc-package]')?.replaceChildren();
        if(node('[data-rc-package]'))node('[data-rc-package]').innerHTML=downloadLinks(packageFiles);
        status('The complete results package is ready to download.');toast('Source-water package ready.');
      } else if(finished.result?.id){
        const kind=finished.action==='receptor.experiment.build'?'comparison':finished.action==='receptor.network.build'?'network':'inventory';
        pending=null;remember();await openResult(kind,finished.result.id);
        toast('Source-water results saved.');
      }
      if(workspace===requested){pending=null;remember();node('[data-receptor-action="resume"]').hidden=true;}
    }catch(error){if(workspace===requested)status(error.message||String(error),true);}
    finally{observing=false;}
  }
  function mount(container) {
    if(root===container&&frame?.isConnected&&workspace===currentWorkspace()){update();return;}
    detach();root=container;workspace=currentWorkspace();
    draft=defaultDraft();customProfile=null;pending=null;result=null;catalog=null;packageFiles=[];
    planned=null;profileOptions=[];scenarioOptions=[];observing=false;pathSelection=null;selectedMapHuc='';
    try{const saved=JSON.parse(localStorage.getItem(storageKey())||'null');if(saved){draft={...draft,...saved.draft};customProfile=saved.customProfile||null;pending=saved.pending||null;}}catch(_){}
    frame=document.createElement('div');frame.className='receptor-workbench';frame.innerHTML=controls();container.replaceChildren(frame);
    frame.addEventListener('click',event=>{
      const target=event.target.closest('[data-receptor-action]');
      if(!target||!frame?.contains(target))return;
      event.preventDefault();event.stopPropagation();target.disabled=true;
      Promise.resolve(act(target.dataset.receptorAction,target)).catch(error=>status(error.message||String(error),true))
        .finally(()=>{if(target.isConnected)target.disabled=false;});
    });
    frame.addEventListener('keydown',event=>{
      const target=event.target.closest('[data-receptor-action="map-select"]');
      if(target&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();selectMapHuc(target.dataset.huc);}
    });
    frame.addEventListener('change',event=>{
      event.stopPropagation();const target=event.target;
      if(target.name==='rc-mode'){
        if(draft.mode==='network'&&target.value!=='network'){
          const source=catalog.network_sources?.find(row=>row.id===draft.network_source_id);
          const original=selectedProfile();
          if(source&&original){
            customProfile=copy(original);draft.receptor_profile_id='';
            customProfile.source_collection_id=source.source_collection_id;customProfile.network_source_id=source.source_id;
            customProfile.source_reference=Object.fromEntries(['source_collection_id','source_id','uri','vintage','title','sha256'].map(key=>[key,source[key]]));
          }
        }
        draft.mode=target.value;planned=null;node('[data-rc-plan]').replaceChildren();
        if(['Source-water scenario comparisons','Original watershed connections'].includes(draft.title))draft.title=draft.mode==='network'?'Original watershed connections':'Source-water scenario comparisons';
        if(draft.mode==='inventory'&&!nativeRuns().some(row=>row.id===draft.baseline_run_id)){
          draft.baseline_run_id=nativeRuns().find(row=>row.scenario_kind==='baseline')?.id||'';
          draft.alternative_run_ids=[];draft.delivery_id='';
        }
        if(draft.mode==='experiment'&&!nativeExperiments().some(row=>row.id===draft.experiment_id)){
          draft.experiment_id=nativeExperiments()[0]?.id||'';draft.profile_ids=null;draft.scenario_ids=null;
          draft.delivery_ids_by_baseline={};profileOptions=[];scenarioOptions=[];
        }
        syncControls();
      }
      if(target.name==='rc-network-source'){
        draft.network_source_id=target.value;draft.network_member='';
        draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;planned=null;
        node('[data-rc-plan]').replaceChildren();syncControls();
      }
      if(target.name==='rc-network-member'){
        draft.network_member=target.value;draft.network_body_sha256='';draft.network_decoded_sha256='';planned=null;
        node('[data-rc-plan]').replaceChildren();
      }
      if(target.name==='rc-profile'){if(target.value!=='custom'){chooseProfile(target.value);syncControls();}}
      if(target.name==='rc-experiment'){draft.experiment_id=target.value;draft.delivery_ids_by_baseline={};draft.profile_ids=null;draft.scenario_ids=null;profileOptions=[];scenarioOptions=[];planned=null;renderCaseChoices();node('[data-rc-plan]').replaceChildren();}
      if(target.name==='rc-baseline'){draft.baseline_run_id=target.value;draft.delivery_id='';draft.alternative_run_ids=[];planned=null;syncControls();}
      if(target.dataset.rcAreaChoice)draft.receptor_ids=[...frame.querySelectorAll('[data-rc-area-choice]:checked')].map(row=>row.dataset.rcAreaChoice);
      if(target.dataset.rcRunChoice)draft.alternative_run_ids=[...frame.querySelectorAll('[data-rc-run-choice]:checked')].map(row=>row.dataset.rcRunChoice);
      if(target.dataset.rcFilter){const field=target.dataset.rcFilter;draft[field]=[...frame.querySelectorAll('[data-rc-filter="'+field+'"]:checked')].map(row=>row.value);planned=null;}
      if(target.dataset.rcRowFilter){filters[target.dataset.rcRowFilter]=target.value;page=0;renderQuantities();}
      if(target.name==='rc-profile-file'&&target.files?.[0]){
        const requested=workspace, epoch=generation;
        target.files[0].text().then(text=>{
          if(workspace!==requested||epoch!==generation||!frame)return;
          const value=JSON.parse(text);
          if(!Array.isArray(value.receptors)||!value.receptors.length)throw Error('Choose a receptor specification containing original watershed anchors.');
          customProfile=value;draft.receptor_profile_id='';draft.receptor_ids=value.receptors.map(row=>row.id);
          draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;
          planned=null;syncControls();remember();status('Loaded the complete receptor specification.');
        }).catch(error=>status(error.message||String(error),true));
      }
      remember();
    });
    frame.addEventListener('input',event=>{
      event.stopPropagation();const target=event.target;
      if(target.name==='rc-title'){draft.title=target.value;remember();}
      if(target.dataset.rcRowFilter==='search'){filters.search=target.value;page=0;renderQuantities();}
    });
    loadCatalog();
  }
  function detach() {
    remember();generation++;root=null;frame=null;fetching=false;observing=false;
  }
  return {mount,update,detach};
}
