/* Native watershed-report generation and receiving controls for the maintained operator. */
export const VERSION = '2026-10-13.4';
export const FOCUS_HUCS = ['030601010703','030601010704','030601020507','030601020502'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text = value => String(value ?? '');
const short = value => text(value).slice(0,12);
const labels = {nitrogen:'Nitrogen',phosphorus:'Phosphorus',sediment:'Sediment'};
const button = (action,label,attrs='') => '<button type="button" data-report-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
const option = (value,label,selected=false) => '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const number = value => typeof value === 'number' ? value.toLocaleString() : '—';
const sourceIdentity = source => JSON.stringify([source.source_collection_id,source.source_id]);
const sourceFromChoice = (catalog,value) => (catalog?.zone_sources||[]).find(source=>sourceIdentity(source)===value);
const safeLocalURL = value => typeof value === 'string' && /^\/api\/file\/[a-zA-Z0-9/_-]+(?:\?[a-zA-Z0-9_=&%-]*)?$/.test(value) ? value : null;

export function commonPollutants(runs) {
  if (!runs.length) return [];
  return Object.keys(labels).filter(key => runs.every(run => (run.pollutants || []).includes(key)));
}

export function cohortRuns(catalog, baselineId, includeParameterChanges=false) {
  const baseline = (catalog?.runs || []).find(run => run.id === baselineId && run.reportable);
  if (!baseline) return {baseline:null,alternatives:[]};
  return {baseline,alternatives:catalog.runs.filter(run =>
    run.reportable && run.id !== baseline.id &&
    run.selection.grid_id === baseline.selection.grid_id &&
    (includeParameterChanges || run.selection.profile_id === baseline.selection.profile_id) &&
    commonPollutants([baseline,run]).length > 0
  ).sort((left,right) => {
    const a=left.selection.profile_id===baseline.selection.profile_id?0:1;
    const b=right.selection.profile_id===baseline.selection.profile_id?0:1;
    return a-b || text(left.scenario_title).localeCompare(text(right.scenario_title)) || left.id.localeCompare(right.id);
  })};
}

export function reportDeliveryContext(value,{complete=true}={}) {
  if (value.delivery_mode===undefined) {
    if (value.native_study!==undefined) throw Error('Choose Original native study for its retained study context.');
    return {};
  }
  if (!['regional_rfp','native_study'].includes(value.delivery_mode)) throw Error('Choose a report delivery mode.');
  const context={delivery_mode:value.delivery_mode};
  if (value.delivery_mode==='regional_rfp') {
    if (value.native_study!==undefined) throw Error('Original study metadata belongs to native-study mode.');
    return context;
  }
  const study=value.native_study;
  if (!study || typeof study!=='object' || Array.isArray(study) ||
      Object.keys(study).some(key=>!['title','purpose','reference'].includes(key))) {
    throw Error('Retain the original study title, purpose and optional reference.');
  }
  context.native_study={};
  for (const key of ['title','purpose']) {
    if (typeof study[key]!=='string' || (complete&&!study[key].trim())) throw Error('Enter the original study '+key+'.');
    context.native_study[key]=study[key].trim();
  }
  if (study.reference!==undefined&&study.reference!==null) {
    if (typeof study.reference!=='string') throw Error('The original study reference must be text.');
    if (study.reference.trim()) context.native_study.reference=study.reference.trim();
  }
  return context;
}

export function selectionFromDraft(catalog,draft) {
  const {baseline,alternatives}=cohortRuns(catalog,draft.baseline_run_id,Boolean(draft.include_parameter_changes));
  if (!baseline) throw Error('Choose a completed reference run.');
  const ids=Array.from(new Set(draft.alternative_run_ids || []));
  const chosen=ids.map(id => {
    const run=alternatives.find(row=>row.id===id);
    if (!run) throw Error('A selected alternative no longer belongs to this reporting cohort. Refresh the run choices.');
    return run;
  });
  const available=commonPollutants([baseline,...chosen]);
  const pollutants=Array.from(new Set(draft.pollutants || []));
  if (!pollutants.length) throw Error('Choose at least one available pollutant.');
  if (pollutants.some(key=>!available.includes(key))) throw Error('Choose pollutants completed in every selected run.');
  const title=text(draft.title).trim();
  if (!title) throw Error('Give this report a title.');
  const result={schema:'upstate.scenario-decision-selection/v1',title,
    run_ids:[baseline.id,...chosen.map(run=>run.id)],pollutants,zones:[],
    ...reportDeliveryContext(draft)};
  if (draft.zone) {
    const zone=draft.zone;
    if (!zone.source_collection_id || !zone.source_id || !zone.id_field) throw Error('Choose the original polygon source and identity field.');
    if (!['whole','reporting_intersection'].includes(zone.scope)) throw Error('Choose the watershed scope.');
    const source=(catalog.zone_sources||[]).find(row=>row.source_collection_id===zone.source_collection_id && row.source_id===zone.source_id);
    if (!source) throw Error('The selected watershed source is no longer retained in this project.');
    const selection={id:'watersheds',title:text(zone.title).trim() || source.title,
      source_collection_id:zone.source_collection_id,source_id:zone.source_id,
      id_field:zone.id_field,scope:zone.scope};
    if (zone.layer) selection.layer=zone.layer;
    if (zone.label_field) selection.label_field=zone.label_field;
    if (zone.mode==='focus') {
      if (!/^huc_?12$/i.test(zone.id_field)) throw Error('The utility focus shortcut requires the original HUC12 field.');
      selection.feature_ids=[...FOCUS_HUCS];
    } else if (zone.mode==='selected') {
      selection.feature_ids=Array.from(new Set(text(zone.feature_ids).split(/[\s,;]+/).filter(Boolean)));
      if (!selection.feature_ids.length) throw Error('Enter the original watershed IDs to include.');
    } else if (zone.mode!=='all') throw Error('Choose which watershed features to include.');
    result.zones.push(selection);
  }
  return result;
}

export function economicReleaseSelection(release, editionId='', deliveryMode=null) {
  let selection={...release.selection};
  if (deliveryMode!==null) {
    selection.delivery_mode=deliveryMode;
    if (deliveryMode==='regional_rfp') delete selection.native_study;
    else if (deliveryMode==='native_study'&&!selection.native_study) {
      selection.native_study={title:selection.title||'',purpose:'',reference:''};
    }
  }
  selection={...selection,...reportDeliveryContext(selection,{complete:false})};
  if (!editionId) return selection;
  const edition=(release.economic_editions||[]).find(item=>item.id===editionId);
  if (!edition || !/^[0-9a-f]{64}$/.test(edition.id) ||
      !/^[0-9a-f]{64}$/.test(edition.edition_sha256||'')) {
    throw Error('Reopen this report and choose an available completed economic edition.');
  }
  return {...selection,economic_edition_id:edition.id,economic_edition_sha256:edition.edition_sha256};
}

export function attachScenarioReports(context) {
  const {getState,api,endpoint,toast=()=>{},showTask,openExtension,navigate}=context;
  if (typeof getState!=='function'||typeof api!=='function'||typeof endpoint!=='function') throw Error('Scenario reports need the maintained operator context.');
  let root=null,events=null,workspaceKey=null,catalog=null,requestGeneration=0,sourceGeneration=0,builderGeneration=0;
  let sourceInfo=null,sourceChoice=null,submitting=null,lastSubmission=null,selectedReport=null;
  let completed=new Set(),lastTaskSignature='',disposed=true,pendingDraft=null,pendingOpen=null;
  const currentWorkspace=()=>getState()?.workspace_key || null;
  const $=selector=>root?.querySelector(selector);
  const $$=selector=>root ? Array.from(root.querySelectorAll(selector)) : [];
  const val=name=>$('[name="'+name+'"]')?.value || '';
  const checked=name=>$('[name="'+name+'"]')?.checked || false;
  const message=(value,error=false)=>{
    const node=$('[data-report-message]');if(!node)return;
    node.textContent=value;node.classList.toggle('is-error',error);node.hidden=!value;
  };

  const draftKey=()=> 'upstate-watershed-report-draft:'+workspaceKey;
  function readRemembered() {
    try {const value=JSON.parse(localStorage.getItem(draftKey())||'null');
      return value?.schema==='upstate.scenario-report-draft/v1'?value:null;
    } catch (_) {return null;}
  }
  function remember() {
    const form=$('[data-report-form]');if(!form||!workspaceKey)return;
    const values={};
    for(const element of form.elements) {
      if(!element.name)continue;
      if(element.type==='checkbox') {
        if(['alternative_run_id','pollutant'].includes(element.name)) {
          if(!values[element.name])values[element.name]=[];
          if(element.checked)values[element.name].push(element.value);
        } else values[element.name]=element.checked;
      } else values[element.name]=element.value;
    }
    const selected=sourceFromChoice(catalog,val('zone_source'));
    const source=selected?{source_collection_id:selected.source_collection_id,source_id:selected.source_id}:null;
    const value={schema:'upstate.scenario-report-draft/v1',open:!$('[data-report-builder]').hidden,values,source,lastSubmission};
    try {localStorage.setItem(draftKey(),JSON.stringify(value));}catch(_){}
  }
  function fillControls(values,names) {
    for(const name of names) {
      if(!(name in values))continue;
      const nodes=$$('[name="'+name+'"]');
      for(const node of nodes) {
        if(node.type==='checkbox')node.checked=!node.disabled&&(Array.isArray(values[name])?values[name].includes(node.value):Boolean(values[name]));
        else if(node.tagName!=='SELECT'||Array.from(node.options).some(item=>item.value===text(values[name])))node.value=text(values[name]);
      }
    }
  }

  const assertWorkspace=()=>{
    if(!workspaceKey||currentWorkspace()!==workspaceKey)throw Error('The selected project changed. Reopen the report controls in that project.');
  };
  const call=(path,values={})=>{assertWorkspace();return api(endpoint(path,values));};
  const scaffold=()=>{
    root.classList.add('scenario-report-workbench');
    root.innerHTML='<header class="sr-heading"><div><h2>Watershed reports</h2><p>Compare native annual exports across the reporting basin, model domain and original watershed polygons.</p></div><div class="sr-actions">'+button('new','Build report')+button('refresh','Refresh')+'</div></header>'+
      '<p class="sr-message" data-report-message role="status" aria-live="polite" hidden></p>'+
      '<div data-report-tasks></div><section data-report-builder hidden></section>'+
      '<section aria-label="Saved watershed reports"><h3>Saved reports</h3><div data-report-saved></div></section>'+
      '<section data-report-view hidden></section>';
  };
  const savedHTML=()=>{
    const target=$('[data-report-saved]');if(!target)return;
    const rows=catalog?.reports || [];
    if(!rows.length){target.innerHTML='<p class="sr-empty">No watershed reports have been saved in this project. Build a report from the completed native runs.</p>';return;}
    target.innerHTML='<div class="sr-table-scroll"><table><thead><tr><th>Report</th><th>Scope</th><th>Pollutants</th><th>Saved</th><th></th></tr></thead><tbody>'+
      [...rows].sort((a,b)=>text(b.created_at).localeCompare(text(a.created_at))).map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(short(row.id))+'</small></td><td>'+number(row.zones)+' zones · '+number(row.runs)+' runs</td><td>'+esc((row.pollutants||[]).map(x=>labels[x]||x).join(', '))+'</td><td>'+esc(row.created_at?new Date(row.created_at).toLocaleString():'—')+'</td><td>'+button('open','Open','data-report-id="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>';
  };
  async function refresh() {
    if(pendingOpen&&pendingOpen.workspace!==currentWorkspace())pendingOpen=null;
    if(disposed||!root)return;
    const key=currentWorkspace();
    if(!key){
      remember();workspaceKey=null;catalog=null;sourceInfo=null;sourceChoice=null;selectedReport=null;
      pendingDraft=null;lastSubmission=null;completed=new Set();lastTaskSignature='';
      requestGeneration++;sourceGeneration++;builderGeneration++;scaffold();
      $('[data-report-action="new"]').disabled=true;
      message('Open a scientific project to view watershed reports.');return;
    }
    if(workspaceKey!==key){remember();workspaceKey=key;catalog=null;sourceInfo=null;sourceChoice=null;selectedReport=null;completed=new Set();lastTaskSignature='';sourceGeneration++;builderGeneration++;pendingDraft=readRemembered();lastSubmission=pendingDraft?.lastSubmission||null;scaffold();}
    const generation=++requestGeneration;
    message('Reading completed runs and saved reports…');
    try {
      const value=await call('/api/scenario-reports/catalog');
      if(disposed||generation!==requestGeneration||workspaceKey!==currentWorkspace())return;
      catalog=value;savedHTML();message('');
      $('[data-report-action="new"]').disabled=!catalog.runs.some(run=>run.reportable);
      if(!catalog.runs.some(run=>run.reportable))message('Complete a native NDR or SDR run to build the first watershed report.');
      if(pendingDraft?.open&&catalog.runs.some(run=>run.reportable)){const saved=pendingDraft;pendingDraft=null;await renderBuilder(saved);}else pendingDraft=null;
      observe(getState());
      if(pendingOpen&&pendingOpen.workspace===workspaceKey) {
        const requested=pendingOpen;pendingOpen=null;
        await openReport(requested.report_id);
      }
    } catch(error){if(!disposed&&generation===requestGeneration)message(error.message,true);}
  }
  async function renderBuilder(saved=null) {
    assertWorkspace();
    const key=workspaceKey,generation=++builderGeneration;
    if(!catalog)throw Error('Refresh the completed model runs first.');
    const runs=catalog.runs.filter(run=>run.reportable);
    if(!runs.length)throw Error('Complete a native model run to build a report.');
    const chosen=runs.find(run=>run.scenario_kind==='baseline')||runs[0];
    const savedReference=saved?.values?.baseline_run_id;
    const missingReference=Boolean(savedReference&&!runs.some(run=>run.id===savedReference));
    sourceInfo=null;sourceChoice=null;sourceGeneration++;
    const target=$('[data-report-builder]');
    target.hidden=false;
    target.innerHTML='<form data-report-form><fieldset><legend>Build a watershed report</legend>'+
      '<div class="sr-grid"><label>Report title<input name="report_title" required maxlength="240" value="'+esc((catalog.project?.title||'Watershed')+' native export report')+'"></label>'+
      '<label>Reference run<select name="baseline_run_id">'+option('','Choose a completed reference run')+runs.map(run=>option(run.id,run.scenario_title+' · '+run.profile_title+' · '+(run.pollutants||[]).map(p=>labels[p]||p).join('/'),run.id===chosen.id)).join('')+'</select></label></div>'+
      '<label>Delivery context<select name="report_delivery_mode">'+option('regional_rfp','Regional RFP')+option('native_study','Original native study')+'</select></label>'+
      '<div data-report-study hidden><div class="sr-grid"><label>Original study title<input name="study_title" maxlength="240" value="'+esc(catalog.project?.title||'')+'"></label>'+
      '<label>Original study reference<input name="study_reference" maxlength="2000"></label></div>'+
      '<label>Original study purpose<textarea name="study_purpose" rows="3" maxlength="4000"></textarea></label>'+
      '<p class="sr-note">These original study fields stay with the saved report, its economic editions and the prepared map release.</p></div>'+
      '<label class="sr-check"><input type="checkbox" name="include_parameter_changes"> Include alternatives with different parameter profiles</label>'+
      '<div data-report-alternatives></div><div data-report-pollutants></div>'+
      '<h4>Watershed scope</h4><p class="sr-note">The retained reporting area and hydrologic model domain are always included. Add the original utility, HUC or other polygon source for individual watershed rows.</p>'+
      '<label>Additional polygon source<select name="zone_source">'+option('','Reporting area and model domain only')+
      (catalog.zone_sources||[]).map(source=>option(sourceIdentity(source),source.title+' · '+(source.vintage||short(source.source_collection_id)))).join('')+'</select></label>'+
      '<div data-report-zone-fields hidden></div><p class="sr-note" data-report-selection-note></p>'+
      '<div class="sr-actions"><button type="submit">Build and save report</button>'+button('cancel','Close controls')+'</div>'+
      '</fieldset></form>';
    const form=$('[data-report-form]');
    if(saved)fillControls(saved.values||{},['report_title','baseline_run_id','include_parameter_changes','report_delivery_mode','study_title','study_purpose','study_reference']);
    syncStudyControls();
    if(missingReference)$('[name="baseline_run_id"]').value='';
    renderAlternatives();
    if(saved) {
      fillControls(saved.values||{},['alternative_run_id']);renderPollutants();
      fillControls(saved.values||{},['pollutant']);
      const savedSource=(catalog.zone_sources||[]).find(row=>row.source_collection_id===saved.source?.source_collection_id&&row.source_id===saved.source?.source_id);
      if(savedSource) {
        $('[name="zone_source"]').value=sourceIdentity(savedSource);
        const loading=loadSource(saved.values?.zone_layer||null),sourceRequest=sourceGeneration;
        const applied=await loading;
        if(!applied||disposed||key!==workspaceKey||key!==currentWorkspace()||generation!==builderGeneration||sourceRequest!==sourceGeneration||form!==$('[data-report-form]'))return;
        fillControls(saved.values||{},['zone_id_field','zone_label_field','zone_scope','zone_mode','zone_title','zone_feature_ids']);updateZoneNote();
      }
    }
    if(disposed||key!==workspaceKey||key!==currentWorkspace()||generation!==builderGeneration||form!==$('[data-report-form]'))return;
    remember();target.scrollIntoView({block:'nearest'});
    if(missingReference)message('The saved reference is no longer available. Choose a completed reference run and its native outputs.',true);
    else if(Array.isArray(saved?.values?.pollutant)&&saved.values.pollutant.some(p=>!commonPollutants(selectedRuns()).includes(p)))message('Some saved native outputs are unavailable for this cohort. Review the output selection.',true);
  }
  function selectedRuns() {
    const {baseline,alternatives}=cohortRuns(catalog,val('baseline_run_id'),checked('include_parameter_changes'));
    const ids=new Set($$('input[name="alternative_run_id"]:checked').map(x=>x.value));
    return baseline?[baseline,...alternatives.filter(run=>ids.has(run.id))]:[];
  }
  function renderAlternatives() {
    const {baseline,alternatives}=cohortRuns(catalog,val('baseline_run_id'),checked('include_parameter_changes'));
    const target=$('[data-report-alternatives]');if(!target)return;
    if(!baseline){target.textContent='Choose a completed reference run.';renderPollutants();return;}
    target.innerHTML='<h4>Alternatives</h4>'+(alternatives.length?
      '<div class="sr-table-scroll"><table><thead><tr><th>Include</th><th>Scenario</th><th>Parameter profile</th><th>Comparison</th></tr></thead><tbody>'+
      alternatives.map(run=>{const same=run.selection.profile_id===baseline.selection.profile_id;
        const automatic=same&&run.scenario_kind==='landcover'&&commonPollutants([baseline,run]).length===(baseline.pollutants||[]).length;
        return '<tr><td><input type="checkbox" name="alternative_run_id" value="'+esc(run.id)+'" '+(automatic?'checked ':'')+'aria-label="Include '+esc(run.scenario_title)+'"></td><td>'+esc(run.scenario_title)+'<small>'+esc(short(run.id))+'</small></td><td>'+esc(run.profile_title)+'</td><td>'+esc(same?(run.scenario_kind==='landcover'?'Land-cover change':'Same-profile reference'):(run.scenario_kind==='landcover'?'Parameter and land-cover changes':'Parameter change'))+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<p class="sr-empty">No other completed runs share this grid and selected profile. The reference alone can be reported.</p>');
    renderPollutants();
  }
  function renderPollutants() {
    const target=$('[data-report-pollutants]');if(!target)return;
    const old=new Set($$('input[name="pollutant"]:checked').map(x=>x.value));
    const available=commonPollutants(selectedRuns());
    target.innerHTML='<h4>Native outputs</h4><div class="sr-actions">'+Object.entries(labels).map(([id,label])=>'<label class="sr-check"><input type="checkbox" name="pollutant" value="'+id+'" '+(available.includes(id)?((!old.size||old.has(id))?'checked ':''):'disabled ')+'> '+label+(available.includes(id)?'':' · unavailable in this cohort')+'</label>').join('')+'</div>';
    const note=$('[data-report-selection-note]');
    if(note)note.textContent=selectedRuns().length+' native runs. Each reported pollutant uses the common valid footprint across every selected run. A reference-only report provides its original annual totals.';
  }
  async function loadSource(layer=null) {
    assertWorkspace();
    const key=workspaceKey,form=$('[data-report-form]');
    const choice=val('zone_source'),target=$('[data-report-zone-fields]');
    const generation=++sourceGeneration;
    sourceInfo=null;sourceChoice=null;
    if(choice===''){target.hidden=true;target.innerHTML='';return true;}
    const source=sourceFromChoice(catalog,choice);
    if(!source)throw Error('Choose an original retained polygon source.');
    target.hidden=false;target.innerHTML='<p>Reading the original polygon schema…</p>';
    const ownsRequest=()=>!disposed&&generation===sourceGeneration&&key===workspaceKey&&key===currentWorkspace()&&form===$('[data-report-form]')&&target===$('[data-report-zone-fields]');
    let info;
    try {
      info=await call('/api/source-info',{collection:source.source_collection_id,source:source.source_id,...((layer||source.layer)?{layer:layer||source.layer}:{})});
    } catch(error) {
      if(ownsRequest())target.innerHTML='<p class="sr-message is-error" role="alert">'+esc(error.message)+'</p>';
      return false;
    }
    if(!ownsRequest())return false;
    sourceInfo=info;sourceChoice=source;
    const fields=Object.keys(info.fields||{});
    const huc=fields.find(name=>/^huc_?12$/i.test(name));
    const id=huc||fields.find(name=>/^(objectid|fid|id)$/i.test(name))||'';
    const label=fields.find(name=>/^(name|huc_?12_name|hu_?12_name)$/i.test(name))||'';
    const layers=info.layers||[];
    if(!/polygon/i.test(info.geometry_type||'')){
      target.innerHTML=(layers.length>1?'<label>Original layer<select name="zone_layer">'+layers.map(x=>option(x,x,x===info.selected_layer)).join('')+'</select></label>':'')+
        '<p class="sr-message is-error">The selected native layer contains '+esc(info.geometry_type||'unknown geometry')+'. Select a polygon layer for watershed summaries.</p>';
      return true;
    }
    target.innerHTML='<p class="sr-note">'+number(info.feature_count)+' original polygon features · '+esc(source.vintage||'')+'</p>'+
      '<div class="sr-grid">'+(layers.length?'<label>Original layer<select name="zone_layer">'+layers.map(x=>option(x,x,x===info.selected_layer)).join('')+'</select></label>':'')+
      '<label>Original identity field<select name="zone_id_field" required>'+option('','Choose the unique original field')+fields.map(x=>option(x,x+' · '+info.fields[x],x===id)).join('')+'</select></label>'+
      '<label>Display-name field<select name="zone_label_field">'+option('','Use original identity')+fields.map(x=>option(x,x,x===label)).join('')+'</select></label>'+
      '<label>Watershed scope<select name="zone_scope">'+option('whole','Whole original watershed',true)+option('reporting_intersection','Part inside the reporting area')+'</select></label>'+
      '<label>Features<select name="zone_mode">'+option('all','All original features',true)+option('focus','Four utility focus HUC12')+option('selected','Selected original IDs')+'</select></label>'+
      '<label>Watershed group title<input name="zone_title" value="'+esc(source.title)+'"></label></div>'+
      '<label data-report-original-ids hidden>Original feature IDs<textarea name="zone_feature_ids" rows="3" placeholder="One original ID per line"></textarea></label>'+
      '<p class="sr-note" data-report-zone-note></p>';
    updateZoneNote();return true;
  }
  function updateZoneNote() {
    const mode=val('zone_mode'),id=val('zone_id_field');
    const focus=$('[name="zone_mode"] option[value="focus"]');
    if(focus)focus.disabled=!/^huc_?12$/i.test(id);
    if(mode==='focus'&&focus?.disabled)$('[name="zone_mode"]').value='all';
    const current=val('zone_mode'),input=$('[data-report-original-ids]');
    if(input)input.hidden=current!=='selected';
    const note=$('[data-report-zone-note]');
    if(note)note.textContent=current==='focus'?'Original HUC12: '+FOCUS_HUCS.join(', ')+'. Each polygon is reported separately.':
      current==='selected'?'IDs remain exact strings, including leading zeroes.':'Every selected original polygon becomes its own report zone. Overlapping watershed totals remain separate.';
  }
  function syncStudyControls() {
    const container=$('[data-report-study]');
    if(!container)return;
    const active=val('report_delivery_mode')==='native_study';
    container.hidden=!active;
    for(const field of container.querySelectorAll('input,textarea')) {
      field.disabled=!active;
      field.required=active&&field.name!=='study_reference';
    }
  }
  function draft() {
    const value={title:val('report_title'),baseline_run_id:val('baseline_run_id'),
      include_parameter_changes:checked('include_parameter_changes'),
      alternative_run_ids:$$('input[name="alternative_run_id"]:checked').map(x=>x.value),
      pollutants:$$('input[name="pollutant"]:checked').map(x=>x.value),
      delivery_mode:val('report_delivery_mode')||'regional_rfp'};
    if(value.delivery_mode==='native_study')value.native_study={
      title:val('study_title'),purpose:val('study_purpose'),reference:val('study_reference')};
    if(val('zone_source')!=='') {
      if(!sourceInfo||!sourceChoice||sourceIdentity(sourceChoice)!==val('zone_source')||!/polygon/i.test(sourceInfo.geometry_type||''))throw Error('Finish choosing the original watershed polygon layer.');
      value.zone={...sourceChoice,layer:val('zone_layer')||sourceInfo.selected_layer,
        id_field:val('zone_id_field'),label_field:val('zone_label_field'),scope:val('zone_scope'),
        title:val('zone_title'),mode:val('zone_mode'),feature_ids:val('zone_feature_ids')};
    }
    return value;
  }
  async function submit() {
    assertWorkspace();if(submitting?.workspace===workspaceKey)return;
    const selected=selectionFromDraft(catalog,draft());
    const fingerprint=JSON.stringify({workspace:workspaceKey,selection:selected});
    if(!lastSubmission||lastSubmission.fingerprint!==fingerprint)lastSubmission={fingerprint,id:crypto.randomUUID()};
    const key=workspaceKey,form=$('[data-report-form]'),fieldset=form?.querySelector('fieldset');
    const attempt={workspace:key,operation_id:lastSubmission.id};
    remember();submitting=attempt;if(fieldset)fieldset.disabled=true;message('Queuing the native watershed report…');
    try {
      const result=await api('/api/actions',{method:'POST',body:{workspace:key,action:'scenario.decision.build',payload:{selection:selected},operation_id:lastSubmission.id}});
      if(disposed||key!==currentWorkspace())return;
      message('Report queued. Its progress and completed products are retained in this project.');
      toast('Watershed report queued.');if(showTask)await showTask(result.id);
      observe(getState());
    } catch(error){if(!disposed&&key===currentWorkspace())message(error.message,true);}
    finally{if(submitting===attempt)submitting=null;if(fieldset&&fieldset.isConnected)fieldset.disabled=false;}
  }
  const releaseHTML=value=>{
    const release=value||{ready:false,issues:[],releases:[]};
    const issues=release.issues||[];
    const choices=release.remaining_choices||[];
    const rows=release.releases||[],editions=release.economic_editions||[];
    return '<section class="sr-release" aria-label="Map releases from this report"><h4>Map release</h4>'+
      '<p>Use this saved reference and every alternative for the map atlas. The original report, annual totals, comparison tables and watershed geometry travel with the release.</p>'+
      (issues.length?'<ul>'+issues.map(item=>'<li>'+esc(item.message)+'</li>').join(''):'')+
      (release.ready?'<label>Delivery mode<select name="release_delivery_mode">'+option('regional_rfp','Regional RFP · seven map families',(release.selection?.delivery_mode||'regional_rfp')==='regional_rfp')+option('native_study','Original native study · retain original grid and domain',release.selection?.delivery_mode==='native_study')+'</select></label>':'')+
      (release.ready&&editions.length?'<label>Economic decision edition<select name="release_economic_edition">'+
        option('','Physical report and maps')+editions.map(item=>option(item.id,item.title+' / '+item.zone_title+' / '+item.costed_count+' costed alternatives')).join('')+
        '</select></label><p class="sr-note">Include this completed edition’s selected-zone costs, budgets, physical response and original decision package in the client report.</p>':'')+
      ((release.economic_issues||[]).length?'<p class="sr-note">'+esc(release.economic_issues.map(item=>item.message).join(' '))+'</p>':'')+
      (release.ready?'<div class="sr-actions">'+button('map-release','Build map release','data-report-id="'+esc(selectedReport)+'"')+'</div>':'')+
      (release.ready&&choices.length?'<p class="sr-note">The atlas builder applies the selected delivery mode. Regional RFP choices include: '+esc(choices.join('; '))+'.</p>':'')+
      (rows.length?'<h5>Saved map releases</h5><div class="sr-table-scroll"><table><thead><tr><th>Release</th><th>State</th><th>Saved</th><th></th></tr></thead><tbody>'+
        rows.map(row=>'<tr><td>'+esc(row.title)+'<small>'+esc(short(row.id))+'</small></td><td>'+esc(row.state)+'</td><td>'+esc(row.created_at?new Date(row.created_at).toLocaleString():'—')+'</td><td>'+
          button('open-release','Open release','data-release-id="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'')+
      ((release.release_issues||[]).length?'<p class="sr-note">'+esc(release.release_issues.map(item=>item.message).join(' '))+'</p>':'')+'</section>';
  };
  async function createMapRelease(id) {
    assertWorkspace();
    if(typeof openExtension!=='function')throw Error('Install the current map-atlas desk to open this report selection.');
    const key=workspaceKey;
    const economicEditionId=val('release_economic_edition'),deliveryMode=val('release_delivery_mode')||'regional_rfp';
    message('Opening the map release for this saved report…');
    const release=await call('/api/scenario-reports/release',{report_id:id});
    if(disposed||key!==currentWorkspace()||selectedReport!==id)return;
    if(!release.ready) {
      const target=$('[data-report-release]');
      if(target)target.innerHTML=releaseHTML(release);
      message((release.issues||[]).map(item=>item.message).join(' ')||'Reopen the report selection before building the map release.',true);
      return;
    }
    const selection=economicReleaseSelection(release,economicEditionId,deliveryMode);
    await openExtension('map-atlas','create',{workspace_key:key,selection});
  }
  async function openLinkedRelease(id) {
    assertWorkspace();
    if(typeof openExtension!=='function')throw Error('Install the current map-atlas desk to open this release.');
    return openExtension('map-atlas','open',id,{workspace_key:workspaceKey});
  }
  async function open(id,options={}) {
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose an existing saved watershed report.');
    const key=options?.workspace_key||currentWorkspace();
    if(key!==currentWorkspace())throw Error('Open this saved report in its original project.');
    if(!key)throw Error('Open the project containing this watershed report.');
    const requested={workspace:key,report_id:id};
    if((disposed||!root)&&typeof navigate!=='function')throw Error('Open Watershed reports, then select this saved report.');
    pendingOpen=requested;
    try {
      if(typeof navigate==='function')await navigate('scenario-reports');
    } catch(error) {
      if(pendingOpen===requested)pendingOpen=null;
      throw error;
    }
    if(currentWorkspace()!==key){
      if(pendingOpen===requested)pendingOpen=null;
      throw Error('The selected project changed. Open the report in its original project.');
    }
    if(root&&!disposed&&workspaceKey===key&&pendingOpen===requested) {
      pendingOpen=null;
      return openReport(id);
    }
    return {workspace_key:key,report_id:id};
  }
  async function openReport(id) {
    assertWorkspace();
    const key=workspaceKey;selectedReport=id;message('Opening the saved watershed report…');
    try {
      const packet=await call('/api/scenario-reports/report',{report_id:id});
      if(disposed||key!==currentWorkspace()||selectedReport!==id)return;
      const target=$('[data-report-view]'),report=packet.report,summary=packet.summary;
      const preview=safeLocalURL(packet.preview_url);
      const downloads=(packet._downloads||[]).filter(item=>safeLocalURL(item.url));
      target.hidden=false;
      target.innerHTML='<div class="sr-heading"><div><h3>'+esc(summary.title)+'</h3><p>'+number(summary.zones)+' zones · '+number(summary.runs)+' native runs · '+esc((summary.pollutants||[]).map(x=>labels[x]||x).join(', '))+'</p></div>'+button('close-preview','Close preview')+'</div>'+
        '<div class="sr-actions">'+(preview?'<a href="'+esc(preview)+'" target="_blank" rel="noopener">Open report in a new tab</a>':'')+
        downloads.map(item=>'<a href="'+esc(item.url)+(item.url.includes('?')?'&amp;':'?')+'download=1" download>'+esc(item.filename||item.label)+'</a>').join('')+'</div>'+
        '<p class="sr-note">The decision workbench can now open this report through its watershed selector. All alternatives retain the same common-support comparison used here.</p>'+
        '<div data-report-release>'+releaseHTML(packet.release)+'</div>'+
        (preview?'<iframe title="Saved watershed scenario report" src="'+esc(preview)+'" sandbox="allow-scripts allow-downloads allow-modals" referrerpolicy="no-referrer"></iframe>':'<p>Use the saved HTML download to open the complete report.</p>');
      message('');target.scrollIntoView({block:'nearest'});
      root.dispatchEvent(new CustomEvent('upstate:scenario-report-opened',{bubbles:true,detail:{workspace:key,report_id:id,summary,report}}));
    } catch(error){if(!disposed&&key===currentWorkspace()&&selectedReport===id)message(error.message,true);}
  }
  function observe(state=getState()) {
    if(pendingOpen&&pendingOpen.workspace!==currentWorkspace())pendingOpen=null;
    if(disposed||!root)return;
    if((state?.workspace_key||null)!==workspaceKey){refresh();return;}
    const tasks=(state.tasks||[]).filter(task=>task.action==='scenario.decision.build'&&task.workspace===workspaceKey);
    const signature=JSON.stringify(tasks.map(task=>[task.id,task.state,task.updated_at,task.result?.id]));
    if(signature===lastTaskSignature)return;
    lastTaskSignature=signature;
    const target=$('[data-report-tasks]');
    if(target)target.innerHTML=tasks.length?'<details class="sr-task-list"><summary>Report tasks · '+tasks.length+'</summary>'+
      tasks.map(task=>'<div><span>'+esc(task.state)+'</span> '+esc(short(task.id))+' '+
        (showTask?button('task','Open task','data-task-id="'+esc(task.id)+'"'):'')+
        (task.state==='complete'&&task.result?.id?button('open','Open result','data-report-id="'+esc(task.result.id)+'"'):'')+'</div>').join('')+'</details>':'';
    let changed=false;
    for(const task of tasks)if(task.state==='complete'&&task.result?.id&&!completed.has(task.id)){completed.add(task.id);changed=true;}
    if(changed&&catalog)refresh();
  }
  function detach() {
    if(pendingOpen&&pendingOpen.workspace!==currentWorkspace())pendingOpen=null;
    remember();disposed=true;requestGeneration++;sourceGeneration++;builderGeneration++;events?.abort();events=null;
    if(root){root.classList.remove('scenario-report-workbench');root.replaceChildren();}
    root=null;workspaceKey=null;catalog=null;sourceInfo=null;sourceChoice=null;selectedReport=null;submitting=null;lastTaskSignature='';
  }
  function mount(element) {
    if(pendingOpen&&pendingOpen.workspace!==currentWorkspace())pendingOpen=null;
    if(root===element&&!disposed&&workspaceKey===currentWorkspace()){observe();return {detach,update:observe,refresh,open};}
    detach();root=element;disposed=false;events=new AbortController();scaffold();
    root.addEventListener('click',event=>{
      const node=event.target.closest('[data-report-action]');if(!node||!root.contains(node))return;
      const action=node.dataset.reportAction;
      Promise.resolve().then(()=>{
        if(action==='new')return renderBuilder();
        if(action==='refresh')return refresh();
        if(action==='cancel'){builderGeneration++;sourceGeneration++;$('[data-report-builder]').hidden=true;remember();return;}
        if(action==='open')return openReport(node.dataset.reportId);
        if(action==='map-release')return createMapRelease(node.dataset.reportId);
        if(action==='open-release')return openLinkedRelease(node.dataset.releaseId);
        if(action==='close-preview'){$('[data-report-view]').hidden=true;$('[data-report-view]').replaceChildren();selectedReport=null;return;}
        if(action==='task'&&showTask)return showTask(node.dataset.taskId);
      }).catch(error=>message(error.message,true));
    },{signal:events.signal});
    root.addEventListener('change',event=>{
      const name=event.target.name,key=workspaceKey,form=$('[data-report-form]');
      const ownsForm=()=>!disposed&&key===workspaceKey&&key===currentWorkspace()&&form===$('[data-report-form]');
      const readSource=layer=>{const loading=loadSource(layer),generation=sourceGeneration;return loading.then(applied=>{if(applied&&ownsForm()&&generation===sourceGeneration)remember();});};
      Promise.resolve().then(()=>{
        if(!ownsForm())return;
        if(name==='report_delivery_mode')syncStudyControls();
        else if(name==='baseline_run_id'||name==='include_parameter_changes')renderAlternatives();
        else if(name==='alternative_run_id')renderPollutants();
        else if(name==='zone_source')return readSource();
        else if(name==='zone_layer')return readSource(event.target.value);
        else if(name==='zone_mode'||name==='zone_id_field')updateZoneNote();
        remember();
      }).catch(error=>{if(ownsForm())message(error.message,true);});
    },{signal:events.signal});
    root.addEventListener('input',remember,{signal:events.signal});
    root.addEventListener('submit',event=>{
      if(!event.target.matches('[data-report-form]'))return;
      event.preventDefault();submit().catch(error=>message(error.message,true));
    },{signal:events.signal});
    refresh();
    return {detach,update:observe,refresh,open};
  }
  return {mount,detach,update:observe,refresh,open};
}
