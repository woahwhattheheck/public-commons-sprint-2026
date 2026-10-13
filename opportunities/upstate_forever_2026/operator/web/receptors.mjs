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

export function attachReceptorWorkbench({getState, getWorkspace, api, endpoint, toast, openExtension, openForm, submitAction, refreshState, openItem, navigate, closeDetail, getProgramme, openScientificReport}) {
  let root=null, frame=null, workspace=null, generation=0, catalog=null, taskTarget=null;
  let transferVersion=0, transferring=false, sourceComposerIntent=0;
  let draft=null, customProfile=null, planned=null, profileOptions=[], scenarioOptions=[];
  let result=null, pending=null, packageFiles=[], observing=false, fetching=false, pathSelection=null, selectedMapHuc='';
  let filters={profile:'',scenario:'',area:'',pollutant:'',search:''}, page=0;
  const node = selector => frame?.querySelector(selector);
  const currentWorkspace = () => typeof getWorkspace==='function'?getWorkspace():getState()?.workspace_key;
  const viewContext = () => ({workspace,frame});
  const currentView = context => Boolean(context?.frame)&&context.frame===frame&&
    context.workspace===workspace&&context.workspace===currentWorkspace();
  const sameTask = (left,right) => Boolean(left&&right)&&
    (!left.workspace||!right.workspace||left.workspace===right.workspace)&&
    (!left.action||!right.action||left.action===right.action)&&
    Boolean((left.id&&right.id&&left.id===right.id)||
      (left.operation_id&&right.operation_id&&left.operation_id===right.operation_id));
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
    planned=null;draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;draft.area_authoring=null;remember();
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
      '<section class="rc-section" data-rc-authoring hidden></section>' +
      '<section class="rc-section"><h2>Saved outputs</h2><div data-rc-saved></div></section>' +
      '<section class="rc-section" data-rc-result hidden><div data-rc-result-header></div><div data-rc-result-filters></div><div data-rc-quantities></div><div data-rc-path></div><div data-rc-ranges></div><div data-rc-products></div><div data-rc-downloads></div></section>';
  }
  function selectOptions(target, rows, chosen, prompt) {
    if(!target)return;
    target.innerHTML='<option value="">'+esc(prompt)+'</option>'+rows.map(row =>
      '<option value="'+esc(row.id)+'">'+esc(row.title)+'</option>').join('');
    target.value=chosen||'';
  }
  function retainNetworkSource(network) {
    if(!catalog||network._kind!=='network')return;
    const binding=network.source_binding, reference=network.identity.receptor_spec.source_reference||{};
    const value={id:'network:'+network.id,network_result_id:network.id,title:network.title,
      collection_title:'Retained source-water studies',filename:network.source_body_filename,
      bytes:binding.body_bytes,sha256:binding.body_sha256,decoded_sha256:binding.decoded_sha256,
      uri:reference.uri||'urn:sha256:'+binding.body_sha256,
      vintage:reference.vintage||String(network.created_at||'').split('T')[0],source_reference:copy(reference)};
    catalog.network_sources=catalog.network_sources||[];
    const index=catalog.network_sources.findIndex(row=>row.id===value.id);
    if(index<0)catalog.network_sources.push(value);else catalog.network_sources[index]=value;
  }
  function authoringSource() {
    return result?._kind==='network'&&draft.area_authoring?.source_body_sha256===result.source_binding.body_sha256?result:null;
  }
  function beginAuthoring() {
    if(result?._kind!=='network')throw Error('Open an original watershed network to create a receiving-area study.');
    if(draft.area_authoring?.source_body_sha256===result.source_binding.body_sha256){
      draft.mode='network';draft.area_authoring.collapsed=false;renderAuthoring();syncControls();
      node('[data-rc-authoring]')?.scrollIntoView({behavior:'smooth',block:'start'});return;
    }
    useSaved();
    draft.area_authoring={network_id:result.id,source_body_sha256:result.source_binding.body_sha256,
      decoded_sha256:result.source_binding.decoded_sha256,base_spec:copy(customProfile),
      base_title:result.title,collapsed:false,
      network_index:result.network.network.map(row=>({huc12:row.huc12,name:row.name||'',tohuc_original:row.tohuc_original})),
      editor:null,dirty:false};
    draft.title=result.title+' — receiving-area study';
    editArea(null);syncControls();remember();
    node('[data-rc-authoring]')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function editArea(id,duplicate=false) {
    const study=draft.area_authoring;
    if(!study)throw Error('Open a watershed study for editing first.');
    const row=id?selectedProfile()?.receptors.find(item=>item.id===id):null;
    if(id&&!row)throw Error('Choose an area in the current study.');
    const source=catalog.network_sources?.find(item=>item.id==='network:'+study.network_id);
    study.editor={
      original_id:row&&!duplicate?row.id:null,seed:row?copy(row):null,
      title:row?row.title+(duplicate?' — variant':''):'',
      role:row?.role||'drinking_water',
      uri:row?.reference?.uri||source?.uri||'urn:sha256:'+study.source_body_sha256,
      basis:row?.reference?.basis||'Selected original HUC12 anchors for upstream contributing-land analysis.',
      anchor_huc12s:row?[...row.anchor_huc12s]:[],anchor_text:''};
    study.dirty=false;study.collapsed=false;renderAuthoring();syncNetworkMap();remember();
  }
  function renderAuthoring() {
    const panel=node('[data-rc-authoring]'),study=draft?.area_authoring;
    if(!panel)return;
    panel.hidden=!study||draft.mode!=='network';
    if(panel.hidden)return;
    if(study.collapsed){
      panel.innerHTML='<h2>Receiving-area study draft</h2><p>The complete edited selection is retained in this workspace draft.</p><button type="button" data-receptor-action="author-continue">Continue editing</button>';return;
    }
    const spec=selectedProfile(),editor=study.editor,original=new Map(study.network_index.map(row=>[row.huc12,row]));
    const ready=Boolean(authoringSource()),chosen=ready?selectedMapHuc:'';
    panel.innerHTML='<h2>Author receiving areas from original watersheds</h2>'+
      '<p>Choose anchor watersheds, record their source and purpose, then save a complete geographic study. Saving follows the original ToHUC links and retains the source, memberships, editable definition and map.</p>'+
      '<div class="rc-toolbar"><button type="button" data-receptor-action="author-source">Open study source map</button>'+
      '<button type="button" data-receptor-action="author-new">New receiving area</button>'+
      '<button type="button" data-receptor-action="author-json">Download current receptor JSON</button>'+
      '<button type="button" data-receptor-action="author-collapse">Hide editor</button></div>'+
      '<div class="rc-scroll"><table><caption>Current study areas</caption><thead><tr><th>Area</th><th>Purpose</th><th>Original anchors</th><th>Edit</th></tr></thead><tbody>'+
      (spec?.receptors||[]).map(row=>'<tr><td>'+esc(row.title)+'</td><td>'+esc(label(row.role))+'</td><td>'+esc(row.anchor_huc12s.join(', '))+'</td><td><div class="rc-actions">'+
        '<button type="button" data-receptor-action="author-edit" data-area="'+esc(row.id)+'">Edit</button>'+
        '<button type="button" data-receptor-action="author-duplicate" data-area="'+esc(row.id)+'">Duplicate</button>'+
        '<button type="button" data-receptor-action="author-remove" data-area="'+esc(row.id)+'">Remove from draft</button></div></td></tr>').join('')+
      '</tbody></table></div>'+
      (editor?'<div class="rc-editor"><h3>'+esc(editor.original_id?'Edit receiving area':'New receiving area')+'</h3>'+
        '<div class="rc-controls"><label>Area title<input maxlength="240" data-rc-editor="title" value="'+esc(editor.title)+'"></label>'+
        '<label>Study purpose<select data-rc-editor="role"><option value="drinking_water" '+(editor.role==='drinking_water'?'selected':'')+'>Drinking-water contributing area</option>'+
        '<option value="high_quality_waters" '+(editor.role==='high_quality_waters'?'selected':'')+'>High-quality-water contributing area</option></select></label></div>'+
        '<label>Source reference<input data-rc-editor="uri" maxlength="2000" value="'+esc(editor.uri)+'"></label>'+
        '<label>Reason for choosing these anchors<textarea data-rc-editor="basis" rows="3" maxlength="5000">'+esc(editor.basis)+'</textarea></label>'+
        '<div class="rc-toolbar"><button type="button" data-receptor-action="author-map-anchor" '+(!chosen?'disabled':'')+'>Add selected watershed'+(chosen?' '+esc(chosen):'')+'</button>'+
        '<span class="rc-note">'+(ready?'Select any original polygon on the source map.':'Open the source map to select original polygons.')+'</span></div>'+
        '<div class="rc-anchor-entry"><label>Add original HUC12 anchors<input data-rc-editor="anchor_text" list="rc-authoring-hucs" value="'+esc(editor.anchor_text)+'" placeholder="12-digit HUC12, or several separated by spaces"></label>'+
        '<button type="button" data-receptor-action="author-add-anchors">Add anchors</button></div>'+
        '<datalist id="rc-authoring-hucs">'+study.network_index.map(row=>'<option value="'+esc(row.huc12)+'">'+esc(row.name)+'</option>').join('')+'</datalist>'+
        '<ul class="rc-anchor-list" aria-label="Draft anchor watersheds">'+editor.anchor_huc12s.map(huc=>'<li><span><strong>'+esc(huc)+'</strong> '+esc(original.get(huc)?.name||'')+'</span>'+
          '<button type="button" data-receptor-action="author-remove-anchor" data-huc="'+esc(huc)+'" aria-label="Remove anchor '+esc(huc)+'">Remove</button></li>').join('')+'</ul>'+
        '<p class="rc-note">'+editor.anchor_huc12s.length+' original anchor watersheds in this area.'+(study.dirty?' Apply these edits to the study selection.':'')+'</p>'+
        '<div class="rc-toolbar"><button type="button" data-receptor-action="author-apply">Apply area to study</button>'+
        '<button type="button" data-receptor-action="author-reset-area">Reset area edits</button></div></div>':'')+
      '<div class="rc-toolbar"><button type="button" data-receptor-action="author-preview">Preview edited watershed connections</button>'+
      '<button type="button" data-receptor-action="author-save">Save complete receiving-area study</button>'+
      '<button type="button" data-receptor-action="author-reset">Reset draft to source study</button></div>'+
      '<p class="rc-note">The saved study contains its complete receptor JSON and original source. Use its receiving areas again to select matching completed native runs or experiment profiles.</p>';
  }
  function addAuthoringAnchors(values) {
    const study=draft.area_authoring,editor=study?.editor;
    if(!editor)throw Error('Choose a receiving area to edit.');
    const index=new Set(study.network_index.map(row=>row.huc12));
    const selected=values.map(value=>String(value).trim()).filter(Boolean);
    if(!selected.length)throw Error('Select a watershed on the map or enter its original HUC12.');
    const invalid=selected.filter(value=>!/^\d{12}$/.test(value)||!index.has(value));
    if(invalid.length)throw Error('These anchors are outside the retained original source: '+invalid.join(', '));
    editor.anchor_huc12s=[...new Set([...editor.anchor_huc12s,...selected])].sort();
    editor.anchor_text='';study.dirty=true;renderAuthoring();syncNetworkMap();remember();
  }
  function applyAuthoringArea() {
    const study=draft.area_authoring,editor=study?.editor;
    if(!editor)throw Error('Choose a receiving area to edit.');
    const title=editor.title.trim(),uri=editor.uri.trim(),basis=editor.basis.trim();
    if(!title||!uri||!basis)throw Error('Give the area a title, source reference and reason for choosing its anchors.');
    if(!['drinking_water','high_quality_waters'].includes(editor.role))throw Error('Choose the receiving-area study purpose.');
    if(!/^(https?:\/\/|urn:)/i.test(uri))throw Error('Use an original HTTP, HTTPS or content-identity URN source reference.');
    if(!editor.anchor_huc12s.length)throw Error('Select at least one original anchor watershed.');
    const sourceHucs=new Set(study.network_index.map(row=>row.huc12));
    if(editor.anchor_huc12s.some(huc=>!/^\d{12}$/.test(huc)||!sourceHucs.has(huc)))throw Error('Use original HUC12 anchors from this retained source.');
    const profile=copy(selectedProfile()),previous=editor.original_id?profile.receptors.find(row=>row.id===editor.original_id):editor.seed;
    let id=editor.original_id;
    if(!id){
      const base=title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'receiving-area';
      id=base;let suffix=2;while(profile.receptors.some(row=>row.id===id))id=base+'-'+suffix++;
    }
    const anchors=[...editor.anchor_huc12s].sort();
    const unchanged=previous&&previous.reference?.uri===uri&&previous.reference?.basis===basis&&
      JSON.stringify([...previous.anchor_huc12s].sort())===JSON.stringify(anchors);
    const area={...(previous||{}),id,title,role:editor.role,anchor_huc12s:anchors,
      reference:unchanged?copy(previous.reference):{uri,basis,source_body_sha256:study.source_body_sha256}};
    if(previous&&!unchanged&&!area.source_receptor_reference)area.source_receptor_reference={
      id:previous.id,title:previous.title,role:previous.role,
      anchor_huc12s:[...previous.anchor_huc12s],reference:copy(previous.reference)};
    const index=profile.receptors.findIndex(row=>row.id===editor.original_id);
    if(index>=0)profile.receptors[index]=area;else profile.receptors.push(area);
    profile.title=draft.title.trim()||profile.title;
    customProfile=profile;draft.receptor_profile_id='';
    draft.receptor_ids=[...new Set([...draft.receptor_ids.filter(value=>value!==editor.original_id),id])];
    editor.original_id=id;editor.seed=copy(area);study.dirty=false;planned=null;
    syncControls();syncNetworkMap();remember();status('The receiving area is applied. Preview or save the complete study.');
  }
  function removeAuthoringArea(id) {
    const profile=copy(selectedProfile());
    if(profile.receptors.length<=1)throw Error('Keep one receiving area, or add its replacement first.');
    profile.receptors=profile.receptors.filter(row=>row.id!==id);
    customProfile=profile;draft.receptor_profile_id='';draft.receptor_ids=draft.receptor_ids.filter(value=>value!==id);
    if(!draft.receptor_ids.length)draft.receptor_ids=profile.receptors.map(row=>row.id);
    if(draft.area_authoring.editor?.original_id===id)editArea(null);
    planned=null;syncControls();syncNetworkMap();remember();
  }
  function applyPendingAuthoring() {
    if(draft.mode!=='network'||!draft.area_authoring)return;
    const value=draft.area_authoring.editor?.anchor_text?.trim();
    if(value)addAuthoringAnchors(value.split(/[\s,;]+/));
    if(draft.area_authoring.dirty)applyAuthoringArea();
  }
  function downloadAuthoringProfile() {
    applyPendingAuthoring();
    const spec=selection().receptor_spec;
    const blob=new Blob([JSON.stringify(spec,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='source-water-receptor-specification.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
      'Choose an imported original watershed source or a retained source-water study.';
    node('[name="rc-network-member"]').disabled=Boolean(source?.network_result_id);
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
    renderCaseChoices();renderSaved();renderAuthoring();
  }
  const nativeRunLabel = run => run?.error ? 'Retained run unavailable: '+run.error :
    (run?.models||[]).map(info=>info.model.toUpperCase()+': '+info.label).join('; ') || 'Producing model version unavailable';
  function renderCaseChoices() {
    const checkList=(rows,field,title)=>'<div><h3>'+title+'</h3>'+rows.map(row=>
      '<label class="rc-check"><input type="checkbox" data-rc-filter="'+field+'" value="'+esc(row.id)+'" '+
      (draft[field]===null||draft[field].includes(row.id)?'checked':'')+'><span>'+esc(row.title)+
      (row.total_cases===undefined?'':'<small>'+row.complete_cases+' / '+row.total_cases+' cases complete</small>')+
      (row.baseline?'<small>Own baseline '+esc(short(row.baseline_run_id))+' · '+esc(nativeRunLabel(row.baseline))+'</small>':'')+
      (row.completed_runs?.length?'<small>Completed alternatives: '+esc([...new Set(row.completed_runs.map(nativeRunLabel))].join(' | '))+'</small>':'')+'</span></label>').join('')+'</div>';
    node('[data-rc-case-filters]').innerHTML=profileOptions.length ?
      '<div class="rc-choices">'+checkList(profileOptions,'profile_ids','Parameter profiles')+
      checkList(scenarioOptions,'scenario_ids','Land-cover scenarios')+'</div>' : '';
  }
  const transferKinds = {
    network:'receptor-networks', 'source-areas':'receptor-scenario-areas',
    programme:'receptor-programmes', comparison:'receptor-experiments',
    inventory:'receptor-inventories', 'report-source':'receptor-report-sources',
  };
  function studyTransferButton(kind,id) {
    if(typeof openExtension!=='function'||!transferKinds[kind]||!/^[0-9a-f]{64}$/.test(id||''))return '';
    return '<button type="button" data-receptor-action="transfer-study" data-kind="'+esc(kind)+
      '" data-id="'+esc(id)+'" data-workspace="'+esc(workspace)+'">Transfer editable study</button>';
  }
  async function transferStudy(target) {
    const kind=target?.dataset?.kind,id=target?.dataset?.id,requested=target?.dataset?.workspace;
    if(!transferKinds[kind]||!/^[0-9a-f]{64}$/.test(id||'')||
       !requested||requested!==workspace||requested!==currentWorkspace())
      throw Error('Open the saved source-water study in its original workspace.');
    if(typeof openExtension!=='function')throw Error('The original selected-study desk is unavailable.');
    if(transferring)return;
    const context=viewContext(),epoch=generation,version=++transferVersion;
    const current=()=>currentView(context)&&epoch===generation&&version===transferVersion;
    transferring=true;
    status('Reading the exact saved source-water study for editable transfer…');
    try {
      const retained=await api(endpoint('/api/receptors/'+kind,{id,workspace:requested}));
      if(!current())return;
      if(retained?.id!==id||retained?._kind!==kind)
        throw Error('The saved source-water reply identifies another original study.');
      const selected={kind:transferKinds[kind],id,title:retained.title||id};
      if(typeof retained.state==='string')selected.state=retained.state;
      await openExtension('study-transfer','openForStudies',{workspace_key:requested,roots:[selected]});
    } catch(error) {
      if(current())status(error.message||String(error),true);
    } finally {
      if(version===transferVersion)transferring=false;
    }
  }
  function renderSaved() {
    if(!frame||!catalog)return;
    const rows=[...(catalog.comparisons||[]).map(row=>({...row,kind:'comparison'})),
      ...(catalog.inventories||[]).map(row=>({...row,kind:'inventory'})),
      ...(catalog.networks||[]).map(row=>({...row,kind:'network'})),
      ...(catalog.source_areas||[]).map(row=>({...row,kind:'source-areas'})),
      ...(catalog.programmes||[]).map(row=>({...row,kind:'programme'})),
      ...(catalog.report_sources||[]).map(row=>({...row,kind:'report-source'}))].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    node('[data-rc-saved]').innerHTML=rows.length ?
      '<div class="rc-scroll"><table><caption>Retained source-water products</caption><thead><tr><th>Title</th><th>Type</th><th>State</th><th>Rows</th><th>Open</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+esc(row.title)+'</td><td>'+esc(row.kind==='comparison'?'Experiment profiles':row.kind==='network'?'Original watershed network':row.kind==='source-areas'?'Prepared scenario areas':row.kind==='programme'?'Paired native programme':row.kind==='report-source'?'Scientific source report':'One baseline')+'</td><td>'+esc(label(row.state))+'</td><td>'+esc(number(row.scenario_rows))+'</td><td><button type="button" data-receptor-action="open" data-kind="'+row.kind+'" data-id="'+esc(row.id)+'">Open result</button>'+studyTransferButton(row.kind,row.id)+'</td></tr>').join('')+
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
      if(source.network_result_id)return {network_result_id:source.network_result_id,receptor_spec:spec,
        expected_decoded_sha256:source.decoded_sha256||draft.network_decoded_sha256};
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
      if(loaded?.workspace_key!==requested)throw Error('The source-water catalogue belongs to another workspace.');
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
      await openTaskTarget();
    }catch(error){if(epoch===generation)status(error.message||String(error),true);}
    finally{if(epoch===generation)fetching=false;}
  }
  async function preview() {
    const value=selection(), context=viewContext();
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
    if(!currentView(context))return;
    planned=loaded;profileOptions=loaded.profiles;scenarioOptions=loaded.scenarios;renderCaseChoices();
    const compatibility=loaded.compatible===false?
      '<p class="rc-error" role="alert">'+esc(loaded.compatibility_error||'The selected native cohort is incompatible.')+'</p><p>Select parameter profiles and land-cover scenarios above, then preview the selected subgroup. Each profile keeps its own baseline.</p>':'';
    node('[data-rc-plan]').innerHTML='<h3>Selected profile groups</h3>'+compatibility+'<p>'+loaded.selected_cases+' selected land-cover cases · '+loaded.pending_cases+' native cases progressing.</p><div class="rc-scroll"><table><thead><tr><th>Profile</th><th>Own baseline and producing models</th><th>Completed alternatives</th></tr></thead><tbody>'+
      loaded.groups.map(group=>'<tr><td>'+esc(group.profile_title)+'</td><td><code>'+esc(short(group.baseline_run_id))+'</code><br>'+esc(nativeRunLabel(group.baseline))+'</td><td>'+group.alternative_run_ids.length+
        '<details><summary>Original scenario executions</summary>'+ (group.alternatives||[]).map(run=>'<p><strong>'+esc(run.scenario_title)+'</strong> · <code>'+esc(short(run.id))+'</code><br>'+esc(nativeRunLabel(run))+'</p>').join('')+'</details></td></tr>').join('')+'</tbody></table></div>';
    status(loaded.compatible===false?'Select a compatible profile and scenario subgroup; the original choices remain available.':'The original profile-to-baseline mappings are ready.',loaded.compatible===false);
    return loaded;
  }
  async function submit(action,payload) {
    if(pending&&active(pending.state)){status('The current workspace task is '+pending.state+'.');return;}
    const requested=workspace, context=viewContext(), key=action+':'+JSON.stringify(payload);
    if(!pending||pending.body_key!==key)pending={
      operation_id:crypto.randomUUID(),workspace:requested,action,body_key:key,state:'submitting'};
    remember();status('Submitting the selected source-water task…');
    const operation=pending.operation_id;
    const queued=await api('/api/actions',{method:'POST',body:{
      workspace:requested,action,payload,operation_id:operation}});
    if(!currentView(context)||pending?.operation_id!==operation)return queued;
    if(queued.workspace!==requested||queued.action!==action)throw Error('The returned task belongs to a different source-water request.');
    pending={...pending,...queued,body_key:key,operation_id:operation,action};
    remember();status('Source-water task '+pending.state+'. Its original progress is retained.');
  }
  function downloadLinks(files) {
    return (files||[]).filter(item=>ticketURL(item)).map(item=>
      '<a href="'+esc(ticketURL(item))+'?download=1" download>'+esc(item.label||item.filename)+'</a>').join(' · ');
  }
  async function openResult(kind,id,{preserveDraft=false}={}) {
    if(!Object.hasOwn(transferKinds,kind)||!/^[0-9a-f]{64}$/.test(id||''))
      throw Error('Choose an original saved source-water record.');
    const requested=workspace, context=viewContext(), epoch=++generation;fetching=true;
    status('Opening the saved source-water product and original file references…');
    try {
      const loaded=await api(endpoint('/api/receptors/'+kind,{id,workspace:requested}));
      if(!currentView(context)||epoch!==generation)return false;
      if(loaded?.id!==id||loaded?._kind!==kind||loaded?.workspace_key!==requested)
        throw Error('The saved source-water reply identifies another study or workspace.');
      result=loaded;filters={profile:'',scenario:'',area:'',pollutant:'',search:''};page=0;packageFiles=[];pathSelection=null;selectedMapHuc='';
      if(kind==='network'){
        retainNetworkSource(loaded);
        if(!preserveDraft&&draft.area_authoring?.source_body_sha256===loaded.source_binding.body_sha256){
          const previous=draft.area_authoring.network_id;draft.area_authoring.network_id=loaded.id;
          if(draft.network_source_id==='network:'+previous)draft.network_source_id='network:'+loaded.id;
          remember();
        }
      }
      renderResult();renderAuthoring();status('Saved source-water results reopened.');return true;
    }catch(error){if(currentView(context)&&epoch===generation)status(error.message||String(error),true);return false;}
    finally{if(epoch===generation)fetching=false;}
  }
  const resultRows = () => result?._kind==='network'?result.memberships||[]:
    result?._kind==='comparison'?result.rows||[]:result?.scenario_exports||[];
  function renderResult() {
    renderResultBody();
    const header=node('[data-rc-result-header]');
    if(result&&header&&!header.querySelector('[data-receptor-action="transfer-study"]')){
      const button=studyTransferButton(result._kind,result.id);
      if(button)header.insertAdjacentHTML('beforeend','<div class="rc-toolbar">'+button+'</div>');
    }
  }
  function renderResultBody() {
    if(!result||!frame)return;
    node('[data-rc-result]').hidden=false;
    if(result._kind==='network')return renderNetwork();
    if(result._kind==='source-areas')return renderPreparedSources();
    if(result._kind==='programme')return renderProgramme();
    if(result._kind==='report-source')return renderSourceReport();
    node('[data-rc-path]').replaceChildren();
    const rows=resultRows(), report=ticketURL(result._report);
    node('[data-rc-result-header]').innerHTML='<h2>'+esc(result.title)+'</h2><p>'+rows.length+' retained receiving-area quantities · '+esc(label(result.state||'complete'))+'</p>'+
      '<div class="rc-toolbar">'+(report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable report</a>':'')+
      '<button type="button" data-receptor-action="export">Export complete results package</button>'+
      '<button type="button" data-receptor-action="reuse">Use this saved selection</button></div>'+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div><p class="rc-note">Quantities describe modeled annual export from contributing land to the stream network. Change is alternative minus baseline on the same valid pixels. Each experiment profile retains its own baseline; receiving areas can share upstream land.</p>'+
      (result._native_executions?.length?'<details class="rc-detail"><summary>Original producing models and versions</summary><div class="rc-scroll"><table><thead><tr><th>Native run</th><th>Model</th><th>Version and original basis</th><th>Stage completed</th><th>Stage reuse</th></tr></thead><tbody>'+
        result._native_executions.map(row=>'<tr><td><code>'+esc(short(row.run_id))+'</code></td><td>'+esc(row.model.toUpperCase())+'</td><td>'+esc(row.label)+'</td><td>'+esc(row.stage_completed_at||'Unavailable')+'</td><td>'+esc(row.reused_from?JSON.stringify(row.reused_from):'Original run')+'</td></tr>').join('')+'</tbody></table></div></details>':'');
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
      '</svg><figcaption><p>Original source polygons. Contributing units are shaded; selected anchors are darkest. Choose a watershed to find its upstream memberships, then inspect its drainage path. Draft anchors use dashed outlines while editing.</p>'+
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
      const editing=draft.area_authoring?.source_body_sha256===result.source_binding?.body_sha256;
      path.classList.toggle('rc-edit-anchor',Boolean(editing&&draft.area_authoring.editor?.anchor_huc12s.includes(row.huc12)));
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
    if(draft.area_authoring)renderAuthoring();
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
      '<button type="button" data-receptor-action="reuse">Use these receiving areas again</button>'+
      '<button type="button" data-receptor-action="author-start">Edit receiving-area study</button>'+
      '<button type="button" data-receptor-action="prepare-areas">Prepare scenario areas</button>'+
      '<button type="button" data-receptor-action="scientific-source">Prepare scientific report source</button></div>'+
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
      (result._kind==='comparison'?'<th>Profile</th>':'')+'<th>Receiving area</th><th>Scenario</th><th>Pollutant</th><th>Baseline</th><th>Alternative</th><th>Change</th><th>Change, %</th><th>Unit</th><th>Producing model</th><th>InVEST version</th><th>Compared / selected pixels</th><th>Parameters</th></tr></thead><tbody>'+
      shown.map(row=>'<tr>'+(result._kind==='comparison'?'<td>'+esc(row.profile_title)+'</td>':'')+
      '<td>'+esc(row.receptor_title)+'</td><td>'+esc(row.scenario_title)+'</td><td>'+esc(metricName(row.pollutant))+'</td>'+
      ['common_baseline_export','common_alternative_export','alternative_minus_baseline','change_percent'].map(key=>'<td class="rc-number">'+esc(number(row[key]))+'</td>').join('')+
      '<td>'+esc(row.unit)+'</td><td>'+esc(row.native_model?.toUpperCase()||'—')+'</td><td>'+esc(row.native_version||'—')+'</td><td>'+esc(number(row.common_valid_cells))+' / '+esc(number(row.selected_cells))+'</td><td>'+esc(row.profile_changed?'Profile differs':'Same profile')+'</td></tr>').join('')+
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
      const named=files.map(file=>({...file,label:({'contributing-areas.gpkg':'Editable GeoPackage','memberships.csv':'Original HUC memberships','scenario-exports.csv':'Physical quantities','inventory.json':'Inventory record','network.json':'Original network','native-execution.json':'Original producing stages and output bindings'}[file.filename]||file.filename)}));
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
    draft.area_authoring=null;
    draft.mode=result._kind==='comparison'?'experiment':result._kind==='network'?'network':'inventory';draft.title=result.title;
    const selected=result.selection;
    if(result._kind!=='network'){draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;}
    if(result._kind==='network') {
      customProfile=copy(result.identity.receptor_spec);
      draft.network_product={id:result.id,source_body_sha256:result.source_binding.body_sha256,
        decoded_source_sha256:result.source_binding.decoded_sha256};
      retainNetworkSource(result);
      draft.network_source_id='network:'+result.id;
      draft.network_member='';
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

  const operationForm = () => document.getElementById('operation-form');
  function requirePreparation() {
    if(result?._kind!=='source-areas')throw Error('Open prepared source areas first.');
    return copy(result);
  }
  async function submitFormAction(action,payload,requested) {
    const context=viewContext();
    if(workspace!==requested||!currentView(context))throw Error('Reopen the form in the intended workspace.');
    const queued=await submitAction(action,payload);
    if(!currentView(context))return queued;
    if(queued.workspace!==requested||queued.action!==action)throw Error('The returned task belongs to a different source-water request.');
    pending={...queued,action,body_key:action+':'+JSON.stringify(payload)};
    remember();await update();return queued;
  }
  function prepareAreaForm() {
    if(result?._kind!=='network')throw Error('Open a saved original watershed study first.');
    const source=copy(result),requested=workspace;
    openForm('Prepare scenario areas','Retain exact original HUC12 polygons for selected receiving areas. The saved study remains the source of every membership and drainage connection.',
      '<div class="form-grid"><label class="full">Prepared area title<input name="rc_prepare_title" required maxlength="240" value="'+esc(source.title+' — scenario areas')+'"></label>'+
      '<fieldset class="full"><legend>Receiving areas</legend>'+source.areas.map(area=>
        '<label><input type="checkbox" name="rc_prepare_area" value="'+esc(area.id)+'" checked> '+esc(area.title)+' · '+number(area.huc12_count)+' original HUC12 units</label>').join('')+
      '</fieldset><p class="note full">Preparation imports one original polygon subset per selected area into this workspace. These sources support the existing analysis form and explicit land-cover changes. Shared upstream watersheds remain shared.</p></div>',
      'Prepare retained polygon sources',()=>{
        const form=operationForm(),ids=[...form.querySelectorAll('[name="rc_prepare_area"]:checked')].map(input=>input.value);
        if(!ids.length)throw Error('Select at least one receiving area.');
        return submitFormAction('receptor.source-areas.prepare',{selection:{network_result_id:source.id,receptor_ids:ids,
          title:form.elements.namedItem('rc_prepare_title').value.trim()}},requested);
      });
  }
  async function waitForRetainedState(collectionId,scenarioId=null) {
    const requested=workspace,context=viewContext(),deadline=Date.now()+15000;
    const ready=()=>{
      const state=getState();
      return state?.workspace_key===requested&&
        (state.data?.sources||[]).some(row=>row.id===collectionId)&&
        (!scenarioId||(state.data?.scenarios||[]).some(row=>row.id===scenarioId));
    };
    for(;;){
      if(!currentView(context))
        throw Error('Reopen this operation in the intended workspace.');
      if(ready())return;
      if(Date.now()>=deadline)
        throw Error('The saved source records are still refreshing. The completed task is retained; retry when the Workspace reconnects.');
      await refreshState({force:true});
      if(!ready())await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
  async function usePreparedAnalysis() {
    const prepared=requirePreparation(),requested=workspace,context=viewContext();
    await waitForRetainedState(prepared.source_collection_id);
    if(!currentView(context))return;
    return openExtension('scenario-analysis','createForSourceAreas',{
      ...copy(prepared.scenario_source_areas),workspace_key:requested});
  }
  function sourceAreaScenarios(prepared) {
    return (getState()?.data?.scenarios||[]).filter(row=>
      row.source_area_selection?.preparation_id===prepared.id);
  }
  function interventionRow(prepared) {
    return '<fieldset class="rc-intervention-row"><legend>Land-cover change</legend><div class="form-grid">'+
      '<label>Receiving area<select name="rc_change_area" required>'+prepared.areas.map(area=>
        '<option value="'+esc(area.id)+'">'+esc(area.title)+'</option>').join('')+'</select></label>'+
      '<label>Original land-cover codes<input name="rc_change_from" required placeholder="Comma-separated original integer codes"></label>'+
      '<label>Replacement code<input name="rc_change_to" required type="number" step="1"></label>'+
      '<label class="full">Reason for this change<textarea name="rc_change_reason" required></textarea></label>'+
      '<div class="full"><button type="button" data-rc-patch="up">Move earlier</button> '+
      '<button type="button" data-rc-patch="down">Move later</button> '+
      '<button type="button" data-rc-patch="remove">Remove change</button></div></div></fieldset>';
  }
  function interventionForm() {
    const prepared=requirePreparation(),requested=workspace;
    const codes=(getState()?.data?.profiles||[]).map(profile=>
      '<li>'+esc(profile.title)+': '+esc((profile.table_summary?.lucodes||[]).join(', '))+'</li>').join('');
    openForm('Create a land-cover scenario','Apply explicit land-cover changes within the retained upstream polygon sources. Changes run in the listed order against the current scenario land cover.',
      '<div class="form-grid"><label class="full">Scenario title<input name="rc_scenario_title" required maxlength="240"></label>'+
      '<label class="full">Scenario reason<textarea name="rc_scenario_reason" required></textarea></label>'+
      '<div class="full" data-rc-patches>'+interventionRow(prepared)+'</div>'+
      '<div class="full"><button type="button" data-rc-patch="add">Add land-cover change</button></div>'+
      '<p class="note full">'+number(Object.keys(prepared.shared_huc12s||{}).length)+' original HUC12 units are shared by these areas. Later changes see earlier changes. The native engine checks destination codes against the selected parameter profile.</p>'+
      (codes?'<details class="full"><summary>Codes in retained parameter profiles</summary><ul>'+codes+'</ul></details>':'')+'</div>',
      'Save immutable land-cover scenario',()=>{
        const form=operationForm(),changes=[...form.querySelectorAll('.rc-intervention-row')].map(row=>{
          const field=name=>row.querySelector('[name="'+name+'"]').value.trim();
          const original=field('rc_change_from').split(',').map(value=>value.trim()),destination=field('rc_change_to');
          if(!original.length||original.some(value=>!/^[-+]?\d+$/.test(value)||!Number.isSafeInteger(Number(value)))||
             !/^[-+]?\d+$/.test(destination)||!Number.isSafeInteger(Number(destination)))
            throw Error('Use the exact original integer land-cover codes.');
          const from=original.map(Number);
          if(new Set(from).size!==from.length)throw Error('Each change must list distinct source land-cover codes.');
          return {receptor_id:field('rc_change_area'),from_codes:from,to_code:Number(destination),reason:field('rc_change_reason')};
        });
        if(!changes.length)throw Error('Add at least one actual land-cover change.');
        return submitFormAction('receptor.scenario.save',{preparation_id:prepared.id,selection:{
          title:form.elements.namedItem('rc_scenario_title').value.trim(),
          reason:form.elements.namedItem('rc_scenario_reason').value.trim(),changes}},requested);
      },()=>{
        const container=operationForm().querySelector('[data-rc-patches]');
        operationForm().querySelector('[data-rc-patch="add"]').addEventListener('click',()=>{
          container.insertAdjacentHTML('beforeend',interventionRow(prepared));
        });
        container.addEventListener('click',event=>{
          const button=event.target.closest('[data-rc-patch]');
          if(!button)return;
          const row=button.closest('.rc-intervention-row');
          if(button.dataset.rcPatch==='remove')row.remove();
          if(button.dataset.rcPatch==='up'&&row.previousElementSibling)row.previousElementSibling.before(row);
          if(button.dataset.rcPatch==='down'&&row.nextElementSibling)row.nextElementSibling.after(row);
        });
      });
  }
  function preparedRunForm(scenarioId) {
    const prepared=requirePreparation(),requested=workspace,state=getState()?.data||{};
    const scenario=sourceAreaScenarios(prepared).find(row=>row.id===scenarioId);
    if(!scenario)throw Error('Open an existing land-cover scenario for these prepared areas.');
    const originalHash=prepared.source_binding.body_sha256;
    const grids=(state.grids||[]).filter(row=>{
      if(row.state!=='complete')return false;
      const spec=row.spec||{},collection=(state.sources||[]).find(item=>item.id===spec.source_collection_id);
      const source=collection?.entries?.find(item=>item.id===spec.model_domain?.source_id);
      return source?.body?.sha256===originalHash;
    });
    const profiles=state.profiles||[];
    if(!grids.length)throw Error('Prepare a native grid from this study’s retained original watershed source, then return to select its intervention run.');
    if(!profiles.length)throw Error('Retain the original native parameter profile before preparing this run.');
    const options=rows=>rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.title||row.spec?.title||row.id.slice(0,12))+'</option>').join('');
    const models=row=>['ndr','sdr'].filter(model=>(row?.models||['ndr','sdr']).includes(model));
    openForm('Prepare native intervention run','Bind this saved land-cover scenario to an actual grid from the same original watershed source and a retained parameter profile.',
      '<div class="form-grid"><p class="full">'+esc(scenario.title)+'</p>'+
      '<label>Original model grid<select name="rc_run_grid" required>'+options(grids)+'</select></label>'+
      '<label>Parameter profile<select name="rc_run_profile" required>'+options(profiles)+'</select></label>'+
      '<label>Native models<select name="rc_run_models" required></select></label>'+
      '<p class="note full" data-rc-run-ready></p></div>',
      'Prepare retained native run',()=>{
        const form=operationForm(),gridId=form.elements.namedItem('rc_run_grid').value,
          profileId=form.elements.namedItem('rc_run_profile').value,
          selected=form.elements.namedItem('rc_run_models').value.split(',').filter(Boolean);
        const grid=grids.find(row=>row.id===gridId),profile=profiles.find(row=>row.id===profileId),
          available=models(grid?.spec).filter(model=>models(profile).includes(model));
        if(!selected.length||selected.some(model=>!available.includes(model)))throw Error('Choose native models available in both the actual grid and parameter profile.');
        const codes=profile?.table_summary?.lucodes||[];
        if(codes.length&&scenario.patches.some(patch=>!codes.includes(patch.to_code)))
          throw Error('A destination land-cover code is absent from this parameter profile. Select its matching profile or revise the scenario.');
        if(workspace!==requested||currentWorkspace()!==requested)throw Error('Reopen this form in the intended workspace.');
        return submitAction('run.prepare',{grid_id:gridId,profile_id:profileId,scenario_id:scenario.id,models:selected});
      },()=>{
        const form=operationForm(),updateModels=()=>{
          const grid=grids.find(row=>row.id===form.elements.namedItem('rc_run_grid').value),
            profile=profiles.find(row=>row.id===form.elements.namedItem('rc_run_profile').value),
            available=models(grid?.spec).filter(model=>models(profile).includes(model));
          const choices=[['ndr,sdr','Nutrients and sediment'],['ndr','Nitrogen and phosphorus'],['sdr','Sediment']]
            .filter(([value])=>value.split(',').every(model=>available.includes(model)));
          form.elements.namedItem('rc_run_models').innerHTML=choices.map(([value,title])=>'<option value="'+value+'">'+title+'</option>').join('');
          form.querySelector('[data-rc-run-ready]').textContent=available.length?
            'The existing run panel starts and resumes the prepared native calculation, with its original logs and outputs.':
            'These selections have no native model in common.';
        };
        form.elements.namedItem('rc_run_grid').addEventListener('change',updateModels);
        form.elements.namedItem('rc_run_profile').addEventListener('change',updateModels);
        updateModels();
      });
  }
  function programmeForm() {
    const prepared=requirePreparation(),requested=workspace,state=getState()?.data||{};
    const scenarios=sourceAreaScenarios(prepared),baselines=(state.scenarios||[]).filter(row=>row.kind==='baseline');
    const grids=(state.grids||[]).filter(row=>{
      const spec=row.spec||{},collection=(state.sources||[]).find(item=>item.id===spec.source_collection_id);
      const original=collection?.entries?.find(item=>item.id===spec.model_domain?.source_id);
      return row.state==='complete'&&original?.body?.sha256===prepared.source_binding.body_sha256;
    }),profiles=state.profiles||[];
    if(!scenarios.length)throw Error('Save the intended land-cover alternatives on these areas before preparing their programme.');
    if(!grids.length)throw Error('Prepare a native grid from this study’s original watershed source first.');
    if(!baselines.length||!profiles.length)throw Error('Retain the original land-cover baseline and parameter profiles first.');
    const options=rows=>rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.title||row.spec?.title||short(row.id))+'</option>').join('');
    const models=row=>row?.models||['ndr','sdr'];
    const initial=models(grids[0].spec);
    const checks=(rows,name)=>rows.map((row,i)=>'<label class="rc-choice"><input type="checkbox" name="'+name+'" value="'+esc(row.id)+'" '+
      ((name==='rc_programme_scenarios'||i===0)?'checked':'')+'><span>'+esc(row.title)+
      (name==='rc_programme_profiles'?' <small>'+esc(models(row).join(' + ').toUpperCase())+'</small>':'')+'</span></label>').join('');
    let form,formRoot,revision=0;
    const read=()=>{
      if(!form.reportValidity())throw Error('Complete the marked programme fields.');
      const chosen=name=>[...form.querySelectorAll('[name="'+name+'"]:checked')].map(input=>input.value);
      const profilesChosen=chosen('rc_programme_profiles'),scenariosChosen=chosen('rc_programme_scenarios');
      if(!profilesChosen.length||!scenariosChosen.length)throw Error('Select at least one retained profile and one land-cover alternative.');
      return {schema:'upstate.receptor-programme-selection/v1',title:form.elements.namedItem('rc_programme_title').value.trim(),
        reason:form.elements.namedItem('rc_programme_reason').value.trim(),preparation_id:prepared.id,
        grid_id:form.elements.namedItem('rc_programme_grid').value,
        baseline_scenario_id:form.elements.namedItem('rc_programme_baseline').value,
        models:form.elements.namedItem('rc_programme_models').value.split(','),
        profile_ids:profilesChosen,scenario_ids:scenariosChosen};
    };
    const stillCurrent=(selected,version)=>workspace===requested&&currentWorkspace()===requested&&version===revision&&
      formRoot?.isConnected&&operationForm()===form&&JSON.stringify(selected)===JSON.stringify(read());
    const drawPreview=value=>{
      form.querySelector('[data-rc-programme-preview]').innerHTML='<p><strong>'+number(value.counts.profiles)+' profiles · '+
        number(value.counts.baselines)+' matching baselines · '+number(value.counts.alternatives)+' alternatives · '+
        number(value.counts.runs)+' native runs</strong></p><p>'+number(value.counts.complete_runs)+' runs are already complete. '+
        'Each selected profile keeps its own baseline; the first selected profile is the experiment’s overall reference.</p>'+
        '<div class="rc-scroll"><table><thead><tr><th>Profile</th><th>Scenario</th><th>Native state</th><th>Matching baseline</th></tr></thead><tbody>'+
        value.runs.map(row=>'<tr><td>'+esc(row.profile_title)+'</td><td>'+esc(row.scenario_title)+'</td><td>'+esc(label(row.state))+
          '</td><td><code>'+esc(short(row.paired_baseline_run_id))+'</code></td></tr>').join('')+'</tbody></table></div>';
    };
    openForm('Prepare paired source-water programme',
      'Select the complete intervention cohort. The existing experiment planner supplies each profile’s baseline, and the native programme runs and resumes those exact cases.',
      '<div class="form-grid"><label class="full">Programme title<input name="rc_programme_title" value="'+esc(prepared.title+' — paired native scenarios')+'" required></label>'+
      '<label class="full">Scientific purpose<textarea name="rc_programme_reason" required>Compare the selected upstream-area land-cover alternatives under retained parameter profiles.</textarea></label>'+
      '<label>Original model grid<select name="rc_programme_grid" required>'+options(grids)+'</select></label>'+
      '<label>Original land-cover baseline<select name="rc_programme_baseline" required>'+options(baselines)+'</select></label>'+
      '<label>Native models<select name="rc_programme_models">'+
      [['ndr,sdr','Nutrients and sediment'],['ndr','Nitrogen and phosphorus'],['sdr','Sediment']].map(([value,title])=>'<option value="'+value+'" '+(value===initial.join(',')?'selected':'')+'>'+title+'</option>').join('')+
      '</select></label></div><div class="rc-programme-choices"><fieldset><legend>Retained parameter profiles</legend>'+checks(profiles,'rc_programme_profiles')+
      '<button type="button" data-rc-select-profiles>Select all compatible profiles</button></fieldset><fieldset><legend>Prepared land-cover alternatives</legend>'+
      checks(scenarios,'rc_programme_scenarios')+'</fieldset></div><p class="rc-note" data-rc-programme-count></p>'+
      '<button type="button" data-rc-programme-review>Review paired calculations</button><div data-rc-programme-preview role="status" aria-live="polite"></div>',
      'Save paired programme',async()=>{
        const selected=read(),version=revision;
        const previewed=await api('/api/receptors/programme-plan',{method:'POST',body:{workspace:requested,selection:selected}});
        if(!stillCurrent(selected,version))throw Error('The selections or workspace changed. Review the current programme.');
        return submitFormAction('receptor.programme.create',{selection:previewed.selection,expected_preview_id:previewed.id},requested);
      },()=>{
        form=operationForm();formRoot=form.querySelector('.rc-programme-choices');
        const updateChoices=()=>{
          const grid=grids.find(row=>row.id===form.elements.namedItem('rc_programme_grid').value),
            selectedModels=form.elements.namedItem('rc_programme_models').value.split(','),
            gridModels=models(grid?.spec),inputs=[...form.querySelectorAll('[name="rc_programme_profiles"]')],
            alternatives=form.querySelectorAll('[name="rc_programme_scenarios"]:checked').length,
            selectedProfiles=inputs.filter(input=>input.checked).length;
          for(const option of form.elements.namedItem('rc_programme_models').options)
            option.disabled=option.value.split(',').some(model=>!gridModels.includes(model));
          const compatible=selectedModels.every(model=>gridModels.includes(model));
          form.elements.namedItem('rc_programme_models').setCustomValidity(compatible?'':'Select native models available in the original grid.');
          for(const input of inputs){
            const profile=profiles.find(row=>row.id===input.value);
            input.setCustomValidity(input.checked&&selectedModels.some(model=>!models(profile).includes(model))?
              'This retained profile does not support the selected native models.':'');
          }
          form.querySelector('[data-rc-programme-count]').textContent=selectedProfiles+' selected profiles × '+(1+alternatives)+
            ' land-cover cases = '+(selectedProfiles*(1+alternatives))+' native selections. Completed compatible runs remain reusable.';
        };
        const changed=()=>{revision++;form.querySelector('[data-rc-programme-preview]').textContent='Review the current paired selections before saving.';updateChoices();};
        form.addEventListener('change',changed);
        form.addEventListener('input',()=>{revision++;});
        form.querySelector('[data-rc-select-profiles]').addEventListener('click',()=>{
          const chosen=form.elements.namedItem('rc_programme_models').value.split(',');
          for(const input of form.querySelectorAll('[name="rc_programme_profiles"]'))
            input.checked=chosen.every(model=>models(profiles.find(row=>row.id===input.value)).includes(model));
          changed();
        });
        form.querySelector('[data-rc-programme-review]').addEventListener('click',async event=>{
          const button=event.currentTarget;let version=revision;
          try{
            const selected=read();version=revision;button.disabled=true;
            form.querySelector('[data-rc-programme-preview]').textContent='Reading original sources and exact native selections…';
            const value=await api('/api/receptors/programme-plan',{method:'POST',body:{workspace:requested,selection:selected}});
            if(stillCurrent(selected,version))drawPreview(value);
          }catch(error){if(workspace===requested&&revision===version&&formRoot?.isConnected)form.querySelector('[data-rc-programme-preview]').textContent=error.message||String(error);}
          finally{button.disabled=false;}
        });
        updateChoices();
      });
  }
  async function openNativeProgramme(id) {
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose a retained native programme.');
    const controller=getProgramme?.();
    if(typeof controller?.open!=='function')throw Error('Open Run programmes in the maintained operator to continue this saved programme.');
    return controller.open(id);
  }
  function renderProgramme() {
    const saved=result,native=saved.native_programme,report=ticketURL(saved._report),counts=native.counts||{};
    node('[data-rc-result-header]').innerHTML='<h2>'+esc(saved.title)+'</h2><p>'+esc(label(native.state))+' · '+
      number(counts.complete)+' / '+number(counts.total)+' native runs complete · '+number(saved.counts.profiles)+' parameter profiles</p>'+
      '<div class="rc-toolbar"><button type="button" data-receptor-action="native-programme" data-id="'+esc(saved.programme_id)+'">Open programme and continue runs</button>'+
      '<button type="button" data-receptor-action="programme-compare" '+(native.state==='complete'?'':'disabled')+'>Build source-water comparisons</button>'+
      '<button type="button" data-receptor-action="open" data-kind="programme" data-id="'+esc(saved.id)+'">Refresh calculation status</button>'+
      '<button type="button" data-receptor-action="open" data-kind="source-areas" data-id="'+esc(saved.preparation_id)+'">Open prepared areas</button>'+
      '<button type="button" data-receptor-action="export">Export programme plan</button>'+
      (report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable paired selections</a>':'')+'</div>'+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div><p class="rc-note">Each profile retains its own original land-cover baseline. '+
      'The native programme provides pause, continuation, original logs and paired map controls. After its runs finish, collect the source-water quantities here.</p>';
    node('[data-rc-result-filters]').replaceChildren();node('[data-rc-path]').replaceChildren();node('[data-rc-ranges]').replaceChildren();
    node('[data-rc-quantities]').innerHTML='<div class="rc-scroll"><table><caption>Retained native selections and current state</caption><thead><tr>'+
      '<th>Parameter profile</th><th>Land-cover scenario</th><th>State</th><th>Matching baseline</th><th>Native run</th></tr></thead><tbody>'+
      native.runs.map(row=>{
        const original=saved.runs.find(item=>item.run_id===row.run_id);
        return '<tr><td>'+esc(row.profile_title)+'</td><td>'+esc(row.scenario_title)+'</td><td>'+esc(label(row.state))+'</td><td><code>'+
          esc(short(original?.paired_baseline_run_id))+'</code></td><td><button type="button" data-receptor-action="native-run" data-id="'+esc(row.run_id)+'">Open run</button></td></tr>';
      }).join('')+'</tbody></table></div>';
    const comparisons=(catalog?.comparisons||[]).filter(row=>row.experiment_id===saved.experiment_id);
    node('[data-rc-products]').innerHTML='<h3>Receiving-area comparison reports</h3>'+
      (comparisons.length?'<div class="rc-products">'+comparisons.map(row=>'<article><h4>'+esc(row.title)+'</h4><p>'+esc(label(row.state))+'</p>'+
        '<button type="button" data-receptor-action="open" data-kind="comparison" data-id="'+esc(row.id)+'">Open source-water results</button></article>').join('')+'</div>':
        '<p>Build the receiving-area comparisons after the native programme completes. The report preserves each profile’s baseline, shared valid raster support and original physical units.</p>');
    node('[data-rc-downloads]').innerHTML='<details class="rc-detail" open><summary>Saved selections and original lineage</summary><p class="rc-download-links">'+
      downloadLinks((saved._downloads||[]).filter(row=>!row.filename.endsWith('.html')))+'</p><p>Paired experiment: <code>'+esc(saved.experiment_id)+
      '</code></p><p>Native programme: <code>'+esc(saved.programme_id)+'</code></p></details>';
  }

  function renderPreparedSources() {
    const prepared=result,report=ticketURL(result._report),scenarios=sourceAreaScenarios(prepared);
    node('[data-rc-result-header]').innerHTML='<h2>'+esc(prepared.title)+'</h2>'+
      '<p>'+number(prepared.areas.length)+' receiving areas · '+number(prepared.selected_huc12_count)+' unique original HUC12 polygons</p>'+
      '<div class="rc-toolbar"><button type="button" data-receptor-action="prepared-analysis">Compare native results for these areas</button>'+
      '<button type="button" data-receptor-action="prepared-scenario">Create land-cover scenario</button>'+
      '<button type="button" data-receptor-action="prepared-programme">Prepare paired programme</button>'+
      '<button type="button" data-receptor-action="scientific-source">Prepare scientific report source</button>'+
      '<button type="button" data-receptor-action="export">Export complete source package</button>'+
      '<button type="button" data-receptor-action="open" data-kind="network" data-id="'+esc(prepared.network_result_id)+'">Open original watershed study</button>'+
      (report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable area report</a>':'')+'</div>'+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div>';
    node('[data-rc-result-filters]').replaceChildren();
    node('[data-rc-path]').replaceChildren();
    node('[data-rc-ranges]').replaceChildren();
    const tableTarget=node('[data-rc-quantities]');
    if(tableTarget)tableTarget.innerHTML='<div class="rc-scroll"><table><caption>Retained original polygon sources</caption><thead><tr><th>Receiving area</th><th>Purpose</th><th>HUC12 units</th><th>Source</th></tr></thead><tbody>'+
      prepared.areas.map(area=>'<tr><td>'+esc(area.title)+'</td><td>'+esc(label(area.role))+'</td><td>'+number(area.huc12_count)+'</td><td><code>'+esc(area.source_id)+'</code></td></tr>').join('')+'</tbody></table></div>';
    node('[data-rc-products]').innerHTML='<h3>Land-cover scenarios on these areas</h3>'+
      (scenarios.length?'<div class="rc-products">'+scenarios.map(scenario=>'<article><h4>'+esc(scenario.title)+'</h4><p>'+esc(scenario.reason)+'</p><p>'+
        '<button type="button" data-receptor-action="native-scenario" data-id="'+esc(scenario.id)+'">Open saved scenario</button> '+
        '<button type="button" data-receptor-action="prepared-run" data-id="'+esc(scenario.id)+'">Prepare native run</button></p></article>').join('')+'</div>':'<p>Create an explicit land-cover scenario to prepare its native model run.</p>')+
      '<p class="rc-note">'+number(Object.keys(prepared.shared_huc12s||{}).length)+' HUC12 units are shared by selected areas. Analyses retain each area separately; land-cover patches apply in their declared order.</p>';
    const programmes=(catalog?.programmes||[]).filter(row=>row.preparation_id===prepared.id);
    if(programmes.length)node('[data-rc-products]').insertAdjacentHTML('beforeend','<h3>Paired native programmes</h3><div class="rc-products">'+
      programmes.map(row=>'<article><h4>'+esc(row.title)+'</h4><p>'+number(row.counts.profiles)+' profiles · '+number(row.counts.runs)+' native selections</p>'+
        '<button type="button" data-receptor-action="open" data-kind="programme" data-id="'+esc(row.id)+'">Open calculations and source-water reports</button></article>').join('')+'</div>');
    const scenarioIds=new Set(scenarios.map(row=>row.id)),runs=(getState()?.data?.runs||[]).filter(run=>scenarioIds.has(run.selection?.scenario_id));
    if(runs.length)node('[data-rc-products]').insertAdjacentHTML('beforeend','<h3>Native runs for these areas</h3><div class="rc-scroll"><table><thead><tr><th>Scenario</th><th>State</th><th>Models</th><th>Open</th></tr></thead><tbody>'+
      runs.map(run=>'<tr><td>'+esc(scenarios.find(row=>row.id===run.selection.scenario_id)?.title||run.selection.scenario_id)+'</td><td>'+esc(label(run.state))+'</td><td>'+esc((run.selection.models||['ndr','sdr']).join(', ').toUpperCase())+'</td><td>'+
        '<button type="button" data-receptor-action="native-run" data-id="'+esc(run.id)+'">Open run and outputs</button></td></tr>').join('')+'</tbody></table></div>');
    const files=(prepared._downloads||[]).map(file=>({...file,label:file.filename==='scenario-source-areas.json'?'Prepared source areas for analysis':file.filename}));
    node('[data-rc-downloads]').innerHTML='<details class="rc-detail" open><summary>Prepared sources and original records</summary><p class="rc-download-links">'+downloadLinks(files.filter(file=>!file.filename.endsWith('.html')))+'</p><p>Original source body: <code>'+esc(prepared.source_binding.body_sha256)+'</code></p></details>';
  }


  function sourceReportForm() {
    if(!['network','source-areas'].includes(result?._kind))
      throw Error('Open a saved original watershed study or prepared area result.');
    const saved=result, context=viewContext(), epoch=generation, requested=workspace;
    const available=catalog?.report_map_capability?.available===true;
    const versions=catalog?.report_map_capability?.libraries||{};
    openForm('Prepare scientific report source',
      'Retain the original watershed study and its complete source files for the scientific report composer.',
      '<div class="form-grid"><label class="full">Report source title<input name="rc_report_title" required maxlength="240" value="'+esc(saved.title+' — source geography')+'"></label>'+
      '<label class="full"><input type="checkbox" name="rc_report_maps" '+(available?'':'disabled')+'> Include projected original watershed maps</label>'+
      '<p class="note full">'+(available?
        'The installed native renderer draws the original upstream HUC12 polygons and dark anchor outlines. Numbered labels identify receiving areas. Grid north and scale use the original projected CRS. Geometry interpretation and any repairs remain in the source inventory.':
        'Projected maps become available when the original Esri reader, shared map renderer, pyproj, Shapely and ReportLab are installed. The complete source geography, memberships and original files are available now.')+'</p>'+
      (available?'<p class="note full">Installed renderer: ReportLab '+esc(versions.reportlab)+' · Shapely '+esc(versions.shapely)+' · PROJ '+esc(versions.proj)+'. Published area quantities retain the original AreaSqKm attributes.</p>':'')+
      '</div>', 'Prepare retained report source',()=>{
        if(!currentView(context)||generation!==epoch||result!==saved)
          throw Error('Reopen this report form on the intended saved watershed result.');
        const form=operationForm(), selection=saved._kind==='network'?{network_id:saved.id}:{preparation_id:saved.id};
        selection.title=form.elements.namedItem('rc_report_title').value.trim();
        if(!selection.title)throw Error('Give the retained report source a title.');
        const requestedMaps=form.elements.namedItem('rc_report_maps').checked;
        if(requestedMaps&&!available)throw Error('The native projected-map renderer is unavailable in this host.');
        if(requestedMaps)selection.include_maps=true;
        return submitFormAction('receptor.report-source.build',{selection},requested);
      });
  }

  function renderSourceReport() {
    const saved=result, summary=saved.summary, report=ticketURL(saved._report);
    node('[data-rc-result-header]').innerHTML='<h2>'+esc(saved.title)+'</h2>'+
      '<p>'+number(summary.network_huc12_count)+' original HUC12 units · '+number(summary.selected_huc12_count)+' selected distinct units · '+number(summary.membership_rows)+' original membership rows</p>'+
      '<div class="rc-toolbar"><button type="button" data-receptor-action="scientific-compose" data-selection-mode="replace">'+
      (typeof openScientificReport==='function'?'Open this report only':'Open retained scientific source')+'</button>'+
      (typeof openScientificReport==='function'?'<button type="button" data-receptor-action="scientific-compose" data-selection-mode="append">Add to current report</button>':'')+
      '<button type="button" data-receptor-action="export">Export complete source package</button>'+
      '<button type="button" data-receptor-action="open" data-kind="'+(saved.preparation_id?'source-areas':'network')+'" data-id="'+esc(saved.preparation_id||saved.network_result_id)+'">Open original source study</button>'+
      (report?'<a class="rc-button" href="'+esc(report)+'" target="_blank" rel="noopener">Printable source geography</a>':'')+'</div>'+
      (typeof openScientificReport==='function'?'<p class="rc-note">Open this report only replaces the composer’s selected sources and title. Add to current report preserves its source order and title, then adds this source; an empty title uses this report’s title.</p>':'')+
      '<div data-rc-package>'+downloadLinks(packageFiles)+'</div>';
    for(const selector of ['[data-rc-result-filters]','[data-rc-path]','[data-rc-ranges]'])node(selector)?.replaceChildren();
    node('[data-rc-quantities]').innerHTML='<div class="rc-scroll"><table><caption>Original receiving-area source support</caption><thead><tr><th>Receiving area</th><th>HUC12 units</th><th>Original anchors</th><th>Published area (km²)</th><th>Longest path (links)</th></tr></thead><tbody>'+
      summary.areas.map(area=>'<tr><td>'+esc(area.title)+'</td><td>'+number(area.huc12_count)+'</td><td>'+esc(area.anchor_huc12s.join(', '))+'</td><td>'+
        esc(area.published_area.complete?area.published_area.value:'Unavailable: '+area.published_area.missing_units+' original values missing')+'</td><td>'+number(area.maximum_links_to_anchor)+'</td></tr>').join('')+'</tbody></table></div>';
    node('[data-rc-products]').innerHTML='<h3>Scientific source and original companions</h3><p>The retained report preserves the original watershed geography, drainage links, memberships and prepared polygon sources. Published areas sum the original AreaSqKm attributes over distinct HUC12 members. The report composer can combine this source with selected observation and native process reports in reading order.</p>'+
      '<p>'+number(summary.shared_huc12_count)+' HUC12 units are shared by selected areas. The selected union counts every original unit once.</p>'+
      (summary.projected_maps?'<p><strong>'+number(summary.projected_maps.figures)+' native projected map figures</strong> · '+esc(summary.projected_maps.crs)+'. Separate upstream-unit boundaries and original anchors remain visible. Grid scale uses projected metres. '+number(summary.projected_maps.native_geometry_operations)+' recorded reader operations are retained with the original geometry and native renderer source.</p>':'<p>This retained edition includes the original source geography and membership tables. To add projected vector figures, reopen the original study and select maps when preparing a new report source.</p>');
    node('[data-rc-downloads]').innerHTML='<details class="rc-detail"><summary>Complete original report files</summary><p class="rc-download-links">'+downloadLinks(saved._downloads||[])+'</p><p>Original decoded source: <code>'+esc(saved.source_binding.decoded_sha256)+'</code></p></details>';
  }
  async function openSourceReportComposer(selectionMode='replace') {
    if(!['replace','append'].includes(selectionMode))throw Error('Choose a supported scientific report source selection mode.');
    if(result?._kind!=='report-source')throw Error('Open the retained source geography report first.');
    const selected=result, context=viewContext(), epoch=generation, intent=++sourceComposerIntent, choice=copy(selected.source_choice);
    await waitForRetainedState(choice.source_collection_id);
    if(!currentView(context)||generation!==epoch||result!==selected||intent!==sourceComposerIntent)return;
    const collection=getState()?.data?.sources?.find(row=>row.id===choice.source_collection_id);
    if(!collection?.entries?.some(entry=>entry.id===choice.source_id))throw Error('Refresh the retained report source before opening its composer.');
    if(typeof openScientificReport==='function'){
      await openScientificReport({workspace_key:context.workspace,sources:[choice],title:selected.title,selection_mode:selectionMode});
    }else{
      await openItem('sources',choice.source_collection_id);
    }
  }

  function taskActions(task) {
    if(task?.state!=='complete'||!task.result||task.workspace!==currentWorkspace())return '';
    const saved=task.result,buttons=[];
    const choices={
      'receptor.network.build':['network','Open watershed study'],
      'receptor.inventory.build':['inventory','Open source-water inventory'],
      'receptor.experiment.build':['comparison','Open profile comparisons'],
      'receptor.source-areas.prepare':['source-areas','Open prepared scenario areas'],
      'receptor.programme.create':['programme','Open paired native programme'],
      'receptor.programme.compare':['comparison','Open source-water programme comparisons'],
      'receptor.report-source.build':['report-source','Open scientific source geography']
    };
    const valid=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
    const resultButton=(kind,id,title)=>{
      if(!['network','inventory','comparison','source-areas','programme','report-source'].includes(kind)||!valid(id))return;
      buttons.push('<button type="button" data-action="receptor-result-open" data-workspace="'+esc(task.workspace)+
        '" data-kind="'+kind+'" data-id="'+id+'">'+esc(title)+'</button>');
    };
    if(choices[task.action])resultButton(choices[task.action][0],saved.id,choices[task.action][1]);
    if(task.action==='receptor.package.export')resultButton(saved.kind,saved.result_id,'Open packaged source-water results');
    if(task.action==='receptor.scenario.save'){
      if(valid(saved.id))buttons.push('<button type="button" data-action="receptor-result-scenario" data-workspace="'+
        esc(task.workspace)+'" data-id="'+saved.id+'">Open saved land-cover scenario</button>');
      resultButton('source-areas',saved.preparation_id,'Open scenario areas and native runs');
    }
    return buttons.length?'<div class="page-actions">'+buttons.join('')+'</div>':'';
  }
  async function openTaskTarget() {
    const selected=taskTarget;
    if(!selected||!frame||!catalog||workspace!==selected.workspace||currentWorkspace()!==selected.workspace)return;
    taskTarget=null;
    await openResult(selected.kind,selected.id);
    if(workspace===selected.workspace)node('[data-rc-result]')?.scrollIntoView({block:'start'});
  }
  async function openStudy(selection) {
    const requested=currentWorkspace();
    const kind=Object.keys(transferKinds).find(key=>transferKinds[key]===selection?.kind);
    if(!requested||selection?.workspace_key!==requested||workspace!==requested||!frame)
      throw Error('Open this received study in its original workspace.');
    if(!kind||!/^[0-9a-f]{64}$/.test(selection?.id||''))
      throw Error('Choose an original saved source-water record.');
    if(!catalog)throw Error('Refresh the original source-water catalogue before opening this study.');
    const context=viewContext(),expectedGeneration=generation+1;
    const completed=await openResult(kind,selection.id,{preserveDraft:true});
    if(!currentView(context)||generation!==expectedGeneration)return null;
    if(!completed)throw Error('The saved source-water study could not be opened. Review the original result error.');
    node('[data-rc-result]')?.scrollIntoView({block:'start'});
    return {workspace_key:requested,kind:selection.kind,id:selection.id};
  }
  async function dispatch(button) {
    const action=button?.dataset?.action,id=button?.dataset?.id,requested=currentWorkspace();
    if(button?.dataset?.workspace!==requested)throw Error('Open this task in its original workspace.');
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose a retained source-water result.');
    if(action==='receptor-result-scenario'){
      closeDetail();
      return openItem('scenarios',id);
    }
    if(action!=='receptor-result-open'||!['network','inventory','comparison','source-areas','programme','report-source'].includes(button.dataset.kind))
      throw Error('Choose a registered source-water task result.');
    taskTarget={workspace:requested,kind:button.dataset.kind,id};
    closeDetail();
    navigate('source-water');
    return openTaskTarget();
  }

  async function act(action,target) {
    if(action==='transfer-study')return transferStudy(target);
    if(action==='scientific-compose')return openSourceReportComposer(target.dataset.selectionMode||'replace');
    if(action==='scientific-source')return sourceReportForm();
    if(action==='prepare-areas')return prepareAreaForm();
    if(action==='prepared-analysis')return usePreparedAnalysis();
    if(action==='prepared-scenario')return interventionForm();
    if(action==='prepared-run')return preparedRunForm(target.dataset.id);
    if(action==='prepared-programme')return programmeForm();
    if(action==='native-programme')return openNativeProgramme(target.dataset.id);
    if(action==='programme-compare'){
      if(result?._kind!=='programme')throw Error('Open the saved source-water programme.');
      return submit('receptor.programme.compare',{source_water_programme_id:result.id});
    }
    if(action==='native-scenario')return openItem('scenarios',target.dataset.id);
    if(action==='native-run')return openItem('runs',target.dataset.id);
    if(action==='refresh')return loadCatalog();
    if(action==='plan'){applyPendingAuthoring();return preview();}
    if(action==='build'){
      applyPendingAuthoring();const context=viewContext();
      if(draft.mode==='experiment'){
        const check=await preview();
        if(!currentView(context)||!check||check.compatible===false)return;
      }
      return submit(draft.mode==='experiment'?'receptor.experiment.build':draft.mode==='network'?'receptor.network.build':'receptor.inventory.build',{selection:selection()});
    }
    if(action==='author-start')return beginAuthoring();
    if(action==='author-source')return openResult('network',draft.area_authoring.network_id);
    if(action==='author-new')return editArea(null);
    if(action==='author-edit')return editArea(target.dataset.area);
    if(action==='author-duplicate')return editArea(target.dataset.area,true);
    if(action==='author-remove')return removeAuthoringArea(target.dataset.area);
    if(action==='author-map-anchor'){
      if(!authoringSource())throw Error('Open the original source map for this study.');
      return addAuthoringAnchors([selectedMapHuc]);
    }
    if(action==='author-add-anchors')return addAuthoringAnchors((draft.area_authoring.editor.anchor_text||'').split(/[\s,;]+/));
    if(action==='author-remove-anchor'){
      const study=draft.area_authoring;study.editor.anchor_huc12s=study.editor.anchor_huc12s.filter(huc=>huc!==target.dataset.huc);
      study.dirty=true;renderAuthoring();syncNetworkMap();remember();return;
    }
    if(action==='author-apply'){
      const value=draft.area_authoring.editor?.anchor_text?.trim();if(value)addAuthoringAnchors(value.split(/[\s,;]+/));
      return applyAuthoringArea();
    }
    if(action==='author-reset-area')return editArea(draft.area_authoring.editor?.original_id||null);
    if(action==='author-json')return downloadAuthoringProfile();
    if(action==='author-preview'){applyPendingAuthoring();return preview();}
    if(action==='author-save'){applyPendingAuthoring();return submit('receptor.network.build',{selection:selection()});}
    if(action==='author-reset'){
      const study=draft.area_authoring;customProfile=copy(study.base_spec);draft.receptor_profile_id='';
      draft.title=study.base_title+' — receiving-area study';draft.receptor_ids=customProfile.receptors.map(row=>row.id);
      editArea(null);syncControls();remember();return;
    }
    if(action==='author-collapse'||action==='author-continue'){
      draft.area_authoring.collapsed=action==='author-collapse';renderAuthoring();remember();return;
    }
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
      const context=viewContext(),original=pending;
      const resumed=await api('/api/task/resume',{method:'POST',body:{id:original.id}});
      if(!currentView(context)||!sameTask(pending,original))return;
      if(resumed.workspace!==context.workspace||!sameTask(resumed,original))
        throw Error('The resumed task belongs to a different source-water request.');
      pending={...pending,...resumed};remember();node('[data-receptor-action="resume"]').hidden=true;
      return status('The original workspace task is queued for continuation.');
    }
  }
  async function update() {
    if(!frame)return;
    if(workspace!==currentWorkspace())return mount(root);
    const state=getState();
    if(state?.workspace_key!==workspace)return;
    const sourceState=state.data?.source_water;
    if(sourceState&&catalog){catalog.comparisons=sourceState.comparisons||[];catalog.inventories=sourceState.inventories||[];catalog.networks=sourceState.networks||[];catalog.source_areas=sourceState.source_areas||[];catalog.programmes=sourceState.programmes||[];catalog.report_sources=sourceState.report_sources||[];renderSaved();if(result?._kind==='source-areas')renderPreparedSources();}
    if(!pending||observing)return;
    const task=(state.tasks||[]).find(row=>row.workspace===workspace&&sameTask(row,pending));
    if(!task)return;
    pending={...pending,...task};remember();
    if(['failed','interrupted','cancelled'].includes(task.state)){
      status(task.error?.message||'The retained workspace task can be resumed.',true);
      node('[data-receptor-action="resume"]').hidden=false;return;
    }
    if(task.state!=='complete'){status('Source-water task '+task.state+'.');return;}
    const context=viewContext(),finished=pending,observation={context,task:finished};
    const ownsCompletion=()=>currentView(context)&&sameTask(pending,finished);
    observing=observation;
    try {
      let completed=false;
      if(finished.action==='receptor.package.export'){
        const decorated=await api('/api/task?id='+encodeURIComponent(finished.id));
        if(!ownsCompletion())return;
        if(decorated.workspace!==context.workspace||!sameTask(decorated,finished))
          throw Error('The retained package task belongs to a different request.');
        packageFiles=decorated._downloads||[];
        node('[data-rc-packages]').innerHTML='<strong>Completed result package</strong> · '+downloadLinks(packageFiles);
        node('[data-rc-package]')?.replaceChildren();
        if(node('[data-rc-package]'))node('[data-rc-package]').innerHTML=downloadLinks(packageFiles);
        status('The complete results package is ready to download.');toast('Source-water package ready.');
        completed=true;
      } else if(finished.action==='receptor.scenario.save'&&finished.result?.id){
        await waitForRetainedState(finished.result.source_collection_id,finished.result.id);
        if(!ownsCompletion())return;
        completed=await openResult('source-areas',finished.result.preparation_id);
        if(completed&&ownsCompletion())toast('Land-cover scenario saved. Prepare its native run from these source areas.');
      } else if(finished.result?.id){
        const kind=finished.action==='receptor.report-source.build'?'report-source':finished.action==='receptor.programme.create'?'programme':
          ['receptor.experiment.build','receptor.programme.compare'].includes(finished.action)?'comparison':finished.action==='receptor.network.build'?'network':finished.action==='receptor.source-areas.prepare'?'source-areas':'inventory';
        if(kind==='source-areas'||kind==='report-source'){
          await waitForRetainedState(finished.result.source_collection_id);
          if(!ownsCompletion())return;
        }
        completed=await openResult(kind,finished.result.id);
        if(completed&&ownsCompletion())toast('Source-water results saved.');
      }
      if(completed&&ownsCompletion()){
        pending=null;remember();node('[data-receptor-action="resume"]').hidden=true;
      }
    }catch(error){if(ownsCompletion())status(error.message||String(error),true);}
    finally{if(observing===observation)observing=false;}
  }
  function mount(container) {
    if(root===container&&frame?.isConnected&&workspace===currentWorkspace()){update();return;}
    detach();root=container;workspace=currentWorkspace();
    if(taskTarget&&taskTarget.workspace!==workspace)taskTarget=null;
    draft=defaultDraft();customProfile=null;pending=null;result=null;catalog=null;packageFiles=[];
    planned=null;profileOptions=[];scenarioOptions=[];observing=false;pathSelection=null;selectedMapHuc='';
    try{const saved=JSON.parse(localStorage.getItem(storageKey())||'null');if(saved){draft={...draft,...saved.draft};customProfile=saved.customProfile||null;pending=saved.pending||null;}}catch(_){}
    frame=document.createElement('div');frame.className='receptor-workbench';frame.innerHTML=controls();container.replaceChildren(frame);
    frame.addEventListener('click',event=>{
      const target=event.target.closest('[data-receptor-action]');
      if(!target||!frame?.contains(target))return;
      event.preventDefault();event.stopPropagation();target.disabled=true;
      const context=viewContext();
      Promise.resolve(act(target.dataset.receptorAction,target))
        .catch(error=>{if(currentView(context))status(error.message||String(error),true);})
        .finally(()=>{if(target.isConnected)target.disabled=false;});
    });
    frame.addEventListener('keydown',event=>{
      const target=event.target.closest('[data-receptor-action="map-select"]');
      if(target&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();selectMapHuc(target.dataset.huc);}
    });
    frame.addEventListener('change',event=>{
      event.stopPropagation();const target=event.target;
      if(target.name==='rc-mode'){
        const nextMode=target.value;
        if(draft.mode==='network'&&nextMode!=='network'){
          try{applyPendingAuthoring();}
          catch(error){target.value=draft.mode;status(error.message||String(error),true);remember();return;}
          const source=catalog.network_sources?.find(row=>row.id===draft.network_source_id);
          const original=selectedProfile();
          if(source&&original){
            customProfile=copy(original);draft.receptor_profile_id='';
            if(source.network_result_id){
              draft.network_body_sha256=source.sha256;draft.network_decoded_sha256=source.decoded_sha256;
              draft.network_product={id:source.network_result_id,source_body_sha256:source.sha256,decoded_source_sha256:source.decoded_sha256};
            }else{
              customProfile.source_collection_id=source.source_collection_id;customProfile.network_source_id=source.source_id;
              customProfile.source_reference=Object.fromEntries(['source_collection_id','source_id','uri','vintage','title','sha256'].map(key=>[key,source[key]]));
            }
          }
        }
        draft.mode=nextMode;planned=null;node('[data-rc-plan]').replaceChildren();
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
        draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;planned=null;draft.area_authoring=null;
        const source=catalog.network_sources?.find(row=>row.id===target.value);
        if(source?.network_result_id){
          draft.network_body_sha256=source.sha256;draft.network_decoded_sha256=source.decoded_sha256;
          draft.network_product={id:source.network_result_id,source_body_sha256:source.sha256,decoded_source_sha256:source.decoded_sha256};
        }
        node('[data-rc-plan]').replaceChildren();syncControls();
      }
      if(target.name==='rc-network-member'){
        draft.network_member=target.value;draft.network_body_sha256='';draft.network_decoded_sha256='';planned=null;
        node('[data-rc-plan]').replaceChildren();
      }
      if(target.name==='rc-profile'){if(target.value!=='custom'){chooseProfile(target.value);syncControls();}}
      if(target.name==='rc-experiment'){draft.experiment_id=target.value;draft.delivery_ids_by_baseline={};draft.profile_ids=null;draft.scenario_ids=null;profileOptions=[];scenarioOptions=[];planned=null;renderCaseChoices();node('[data-rc-plan]').replaceChildren();}
      if(target.name==='rc-baseline'){draft.baseline_run_id=target.value;draft.delivery_id='';draft.alternative_run_ids=[];planned=null;syncControls();}
      if(target.dataset.rcEditor&&draft.area_authoring?.editor){
        draft.area_authoring.editor[target.dataset.rcEditor]=target.value;draft.area_authoring.dirty=true;
      }
      if(target.dataset.rcAreaChoice)draft.receptor_ids=[...frame.querySelectorAll('[data-rc-area-choice]:checked')].map(row=>row.dataset.rcAreaChoice);
      if(target.dataset.rcRunChoice)draft.alternative_run_ids=[...frame.querySelectorAll('[data-rc-run-choice]:checked')].map(row=>row.dataset.rcRunChoice);
      if(target.dataset.rcFilter){const field=target.dataset.rcFilter;draft[field]=[...frame.querySelectorAll('[data-rc-filter="'+field+'"]:checked')].map(row=>row.value);planned=null;}
      if(target.dataset.rcRowFilter){filters[target.dataset.rcRowFilter]=target.value;page=0;renderQuantities();}
      if(target.name==='rc-profile-file'&&target.files?.[0]){
        const requested=workspace, context=viewContext(), epoch=generation;
        target.files[0].text().then(text=>{
          if(workspace!==requested||epoch!==generation||!frame)return;
          const value=JSON.parse(text);
          if(!Array.isArray(value.receptors)||!value.receptors.length)throw Error('Choose a receptor specification containing original watershed anchors.');
          customProfile=value;draft.receptor_profile_id='';draft.receptor_ids=value.receptors.map(row=>row.id);
          draft.network_body_sha256='';draft.network_decoded_sha256='';draft.network_product=null;draft.area_authoring=null;
          planned=null;syncControls();remember();status('Loaded the complete receptor specification.');
        }).catch(error=>{if(currentView(context)&&epoch===generation)status(error.message||String(error),true);});
      }
      remember();
    });
    frame.addEventListener('input',event=>{
      event.stopPropagation();const target=event.target;
      if(target.name==='rc-title'){draft.title=target.value;remember();}
      if(target.dataset.rcEditor&&draft.area_authoring?.editor){
        draft.area_authoring.editor[target.dataset.rcEditor]=target.value;draft.area_authoring.dirty=true;remember();
      }
      if(target.dataset.rcRowFilter==='search'){filters.search=target.value;page=0;renderQuantities();}
    });
    return loadCatalog();
  }
  function detach() {
    remember();generation++;transferVersion++;transferring=false;root=null;frame=null;fetching=false;observing=false;
  }
  return {mount,update,detach,taskActions,dispatch,openStudy};
}
