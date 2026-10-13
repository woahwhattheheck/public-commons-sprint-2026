/** Regional context and native scientific desk transitions in the existing journey. */
const SCHEMA='upstate.regional-journey/v1';
const list=value=>Array.isArray(value)?value:[];
const copy=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const option=(id,label,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(label)+'</option>';
const button=(name,label,disabled=false)=>'<button type="button" data-action="journey-regional-'+esc(name)+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const field=(name,label,options)=>'<label><span>'+esc(label)+'</span><select data-regional-field="'+esc(name)+'">'+options+'</select></label>';
const facts=entries=>'<dl class="journey-facts">'+entries.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value??'Choose a retained record')+'</dd></div>').join('')+'</dl>';
const sourceDetails=entries=>'<details class="journey-regional-source"><summary>Source details</summary>'+facts(entries)+'</details>';

export function attachRegionalJourney(host){
 const document=host.document||globalThis.document;
 if(document&&!document.querySelector('link[data-regional-journey]')){
  const link=document.createElement('link');link.rel='stylesheet';link.href='/web/regional_journey.css';link.dataset.regionalJourney='';document.head.append(link);
 }

 let node=null,events=null,workspace=null,epoch=0,request=0,catalog=null,decisions=null,selectedRecord=null,experiment=null,decision=null,error='',loaded='',inflight=null,step='study';
 const choices={region:0,experiment:0,decision:0};
 const state=()=>host.getState();
 const key=()=>state()?.workspace_key??null;
 const selection=()=>host.getSelection()||{};
 const context=()=>host.getContext()||{};
 const rows=name=>list(state()?.data?.[name]);
 const actual=(name,id)=>rows(name).find(row=>row.id===id);
 const current=(forWorkspace=workspace,version=epoch)=>node&&workspace===forWorkspace&&key()===forWorkspace&&epoch===version;
 const read=(kind,operation,payload={},forWorkspace=workspace)=>kind==='experiments'
  ?host.api('/api/experiments/'+operation+'?'+new URLSearchParams({workspace:forWorkspace,...payload}))
  :host.api('/api/'+kind+'/'+operation,{method:'POST',body:{workspace:forWorkspace,...payload}});
 const update=value=>{host.setContext({...context(),...value,schema:SCHEMA});};
 function reset(){
  const next=key();if(workspace===next)return;
  workspace=next;epoch++;request++;catalog=null;decisions=null;selectedRecord=null;experiment=null;decision=null;error='';loaded='';inflight=null;
 }
 function snapshotKey(){return canonical({workspace:key(),reports:rows('watershed_context_reports').map(row=>[row.id,row.source_fingerprint]),experiments:rows('experiments').map(row=>[row.id,row.state,row.summary_at]),regional:context(),tasks:list(state()?.tasks).filter(t=>/^(watershed\.context\.|robust\.|experiment\.)/.test(t.action||'')).map(t=>[t.id,t.state])});}
 function rememberRegional(value){
  try{
   const name='upstate-watershed-context:'+workspace,prior=JSON.parse(sessionStorage.getItem(name)||'null')||{};
   sessionStorage.setItem(name,JSON.stringify({...prior,report_id:value.report_id,export_id:value.export_id,focus_huc:value.huc12s?.length===1?value.huc12s[0]:'',filters:{search:'',huc8:'',state:'',priority:'',classification:'',coverage:''}}));
  }catch{}
 }
 async function verifiedExport(exportId,forWorkspace=workspace){
  const saved=await read('watershed-context','export',{export_id:exportId},forWorkspace);
  const report=await read('watershed-context','report',{report_id:saved.report_id},forWorkspace);
  if(saved.id!==exportId||report.id!==saved.report_id||report.files?.['watershed-context.json']?.sha256!==saved.report_sha256)throw Error('The saved watershed selection and original report identities differ.');
  const all=new Map(list(report.report?.hucs).map(row=>[row.huc12,row]));
  if(!list(saved.huc12s).length||saved.huc12s.some(id=>typeof id!=='string'||!all.has(id)))throw Error('The saved selection contains a watershed outside its original report.');
  if(saved.source_fingerprint!==report.source_fingerprint)throw Error('The saved selection and report use different source editions.');
  return {saved,report,rows:saved.huc12s.map(id=>all.get(id))};
 }
 async function chooseRegion(id){
  const forWorkspace=workspace,token=++request;choices.region=token;
  if(!id){update({export_id:'',report_id:'',report_sha256:'',source_fingerprint:'',huc12s:[]});selectedRecord=null;paint();return;}
  const record=await verifiedExport(id,forWorkspace);
  if(key()!==forWorkspace||workspace!==forWorkspace||choices.region!==token)return;
  selectedRecord=record;error='';
  update({export_id:record.saved.id,report_id:record.saved.report_id,report_sha256:record.saved.report_sha256,source_fingerprint:record.saved.source_fingerprint,huc12s:[...record.saved.huc12s]});
  rememberRegional(context());paint();
 }
 async function chooseExperiment(id){
  const forWorkspace=workspace,token=++request;choices.experiment=token;
  if(!id){update({experiment_id:'',decision_study_id:'',decision_revision:null});experiment=null;decision=null;paint();return;}
  const value=await read('experiments','inspect',{experiment_id:id,limit:1},forWorkspace);
  if(key()!==forWorkspace||workspace!==forWorkspace||choices.experiment!==token)return;
  if(value.id!==id)throw Error('The native experiment identity changed while opening it.');
  experiment=value;decision=null;error='';update({experiment_id:id,decision_study_id:'',decision_revision:null});paint();
 }
 async function chooseDecision(id){
  const forWorkspace=workspace,token=++request;choices.decision=token;
  if(!id){decision=null;update({decision_study_id:'',decision_revision:null});paint();return;}
  const value=await read('robust-workbench','study',{study_id:id},forWorkspace);
  if(key()!==forWorkspace||workspace!==forWorkspace||choices.decision!==token)return;
  if(value.id!==id)throw Error('The retained decision identity changed while opening it.');
  decision=value;error='';update({decision_study_id:id,decision_revision:value.revision});paint();
 }
 async function validateImport(value,forWorkspace=key()){
  if(value===undefined||value===null)return null;
  if(value.schema!==SCHEMA)throw Error('Choose the original regional journey selection format.');
  const result={schema:SCHEMA,export_id:'',report_id:'',report_sha256:'',source_fingerprint:'',huc12s:[],experiment_id:'',decision_study_id:'',decision_revision:null};
  if(value.export_id){
   const record=await verifiedExport(value.export_id,forWorkspace);
   for(const field of ['report_id','report_sha256','source_fingerprint'])if(value[field]!==record.saved[field])throw Error('The imported regional selection has a different '+field+'.');
   if(canonical([...list(value.huc12s)].sort())!==canonical([...record.saved.huc12s].sort()))throw Error('The imported regional selection has different watershed membership.');
   Object.assign(result,{export_id:record.saved.id,report_id:record.saved.report_id,report_sha256:record.saved.report_sha256,source_fingerprint:record.saved.source_fingerprint,huc12s:[...record.saved.huc12s]});
  }
  if(value.experiment_id){
   const record=await read('experiments','inspect',{experiment_id:value.experiment_id,limit:1},forWorkspace);
   if(record.id!==value.experiment_id)throw Error('The restored workspace does not contain the selected native experiment.');
   result.experiment_id=record.id;
  }
  if(value.decision_study_id){
   if(!Number.isInteger(value.decision_revision)||value.decision_revision<1)throw Error('The imported decision needs its exact saved revision.');
   const record=await read('robust-workbench','study',{study_id:value.decision_study_id,revision:value.decision_revision},forWorkspace);
   if(record.id!==value.decision_study_id||record.revision!==value.decision_revision)throw Error('The restored workspace does not contain the selected decision revision.');
   result.decision_study_id=record.id;result.decision_revision=record.revision;
  }
  return result;
 }
 async function opening(value,snapshot=state()){
  if(value?.schema!=='upstate.regional-workflow-opening/v1'||value.workspace_id!==snapshot?.data?.project?.id)throw Error('Open the original regional workspace or its restored copy before importing this opening.');
  const forWorkspace=snapshot.workspace_key,sourceRows=list(snapshot.data.sources),profiles=list(snapshot.data.profiles),runs=list(snapshot.data.runs);
  const profile=profiles.find(row=>row.id===value.profile_id);if(!profile)throw Error('The opening profile is absent from this original workspace.');
  if(value.source_collection_id||value.source_id){
   if(!value.source_collection_id||!value.source_id)throw Error('The opening regional source needs both its collection and source identities.');
   const collection=sourceRows.find(row=>row.id===value.source_collection_id);
   if(!collection?.entries?.some(row=>row.id===value.source_id))throw Error('The opening regional source edition is absent from this workspace.');
  }
  if(value.profile_table_sha256&&profile.table_summary?.sha256!==value.profile_table_sha256)throw Error('The opening profile table differs from its original retained bytes.');
  if(value.profile_source_collection_id&&profile.source_collection_id!==value.profile_source_collection_id)throw Error('The opening profile belongs to a different biophysical source edition.');
  if(value.biophysical_source_id&&profile.biophysical_source_id!==value.biophysical_source_id)throw Error('The opening profile belongs to a different biophysical source table.');
  const record=await verifiedExport(value.watershed_export_id,forWorkspace);
  if(value.source_collection_id&&(record.report.source_collection_id!==value.source_collection_id||record.report.source_id!==value.source_id))throw Error('The opening regional source differs from the saved report source.');
  if(record.saved.report_id!==value.watershed_report_id)throw Error('The opening selection belongs to a different full regional report.');
  if(canonical([...list(value.selected_huc12s)].sort())!==canonical([...record.saved.huc12s].sort()))throw Error('The opening has different HUC12 membership from its saved selection.');
  if(value.watershed_report_sha256&&value.watershed_report_sha256!==record.saved.report_sha256)throw Error('The opening report SHA-256 differs from its original retained bytes.');
  if(value.source_fingerprint&&value.source_fingerprint!==record.saved.source_fingerprint)throw Error('The opening names a different regional source edition.');
  const regional={schema:SCHEMA,export_id:record.saved.id,report_id:record.saved.report_id,report_sha256:record.saved.report_sha256,source_fingerprint:record.saved.source_fingerprint,huc12s:[...record.saved.huc12s],experiment_id:value.experiment_id||'',decision_study_id:value.decision_study_id||'',decision_revision:value.decision_revision??null};
  const selected={baseline_run_id:'',grid_id:'',profile_id:profile.id,scenario_id:'',run_id:'',comparison_id:'',spatial_review_id:'',spatial_export_id:'',delivery_id:''};
  let baseline=null,alternative=null;
  for(const [field,gridField]of [['baseline_run_id','baseline_grid_id'],['alternative_run_id','alternative_grid_id']]){
   if(!value[field])continue;const run=runs.find(row=>row.id===value[field]);if(!run)throw Error('The opening '+field+' is absent from the original workspace.');
   if(value[gridField]&&run.selection?.grid_id!==value[gridField])throw Error('The opening '+field+' belongs to a different native grid.');
   const selectionField=field.replace(/_id$/,'_selection');if(value[selectionField]&&canonical(value[selectionField])!==canonical(run.selection))throw Error('The opening '+field+' has different original input selections.');
   if(field==='baseline_run_id'){baseline=run;selected.baseline_run_id=run.id;}else alternative=run;
  }
  const focus=alternative||baseline;
  if(focus){selected.grid_id=focus.selection.grid_id;selected.scenario_id=focus.selection.scenario_id;if(focus.selection.profile_id===profile.id)selected.run_id=focus.id;}
  else{
   for(const [field,collectionName]of [['grid_id','grids'],['scenario_id','scenarios']])if(value[field]){
    if(!list(snapshot.data[collectionName]).some(row=>row.id===value[field]))throw Error('The opening '+field+' is absent from this workspace.');selected[field]=value[field];
   }
  }
  selected.models=['ndr','sdr'].filter(name=>(selected.run_id?(focus.selection.models||['ndr','sdr']):(profile.models||['ndr','sdr'])).includes(name));
  const selectedGrid=list(snapshot.data.grids).find(row=>row.id===selected.grid_id);
  if(!selected.run_id&&selectedGrid)selected.models=selected.models.filter(name=>(selectedGrid.spec?.models||['ndr','sdr']).includes(name));
  return {selection:selected,regional:await validateImport(regional,forWorkspace)};
 }
 function contextHtml(){
  const value=context(),record=selectedRecord?.saved?.id===value.export_id?selectedRecord:null;
  const picks=list(catalog?.exports);
  let html='<section class="journey-regional-section"><h3>Regional starting point</h3><p class="journey-note">Retain the watershed context beside the selected scientific inputs and results.</p><label class="journey-import"><span>Open a prepared regional workflow</span><input type="file" data-journey-import accept=".json,application/json"><small>Choose the original regional-workflow-opening.json receipt or exported journey selections for this project.</small></label>';
  html+=field('selection','Saved watershed selection',option('','Choose a saved selection',value.export_id)+picks.map(row=>option(row.id,(row.huc12s?.length===1?row.huc12s[0]:String(row.watershed_count??row.huc12s?.length??0)+' watersheds')+' · '+String(row.created_at||'').slice(0,16).replace('T',' '),value.export_id)).join(''));
  html+='<div class="page-actions">'+button('watersheds','Browse regional watersheds')+button('selection','Open exact saved selection',!value.export_id)+button('refresh','Refresh retained records')+'</div>';
  if(record)html+=facts([['Selected watersheds',record.rows.map(row=>(row.name||'Watershed')+' · '+row.huc12).join('; ')],['Whole-watershed area',record.rows.reduce((n,row)=>n+(Number(row.area_km2)||0),0).toLocaleString(undefined,{maximumFractionDigits:2})+' km²'],['Regional context',record.report.title||'Saved regional watershed context'],['Watersheds selected',record.rows.length]])+
   '<p class="journey-note">Open the saved selection to inspect original source rows and selected-water classifications.</p>'+
   sourceDetails([['Full regional report',record.saved.report_id],['Saved selection',record.saved.id],['Report SHA-256',record.saved.report_sha256],['Source fingerprint',record.saved.source_fingerprint]]);
  else if(value.export_id)html+='<p class="journey-note">Opening the original saved selection and its regional source report…</p>';
  else html+='<p class="journey-note">Export a watershed selection from Regional watersheds, then choose it here.</p>';
  return html+'</section>';
 }
 function scienceHtml(){
  const chosen=selection(),profile=actual('profiles',chosen.profile_id),grid=actual('grids',chosen.grid_id),collection=actual('sources',grid?.spec?.source_collection_id);
  let html='<section class="journey-regional-section"><h3>Scientific inputs for this journey</h3><div class="journey-fields">';
  for(const [name,label,items]of [['profile_id','Saved scientific profile',rows('profiles')],['grid_id','Retained model grid',rows('grids').filter(row=>row.state==='complete')]]){
   html+='<label><span>'+label+'</span><select data-journey-field="'+name+'">'+option('','Choose a saved item',chosen[name])+items.map(row=>option(row.id,row.title||row.spec?.title||row.id,chosen[name])).join('')+'</select></label>';
  }
  html+='</div><div class="page-actions">'+button('profile','Open selected profile workbench',!profile)+button('grid','Inspect selected native grid',!grid)+button('grid-map','Open grid in Spatial review',!grid)+'</div>';
  if(profile)html+=facts([['Scientific profile',profile.title||'Selected native profile'],['Native models',(profile.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' / ')],['Model period',typeof profile.model_period==='object'?JSON.stringify(profile.model_period):profile.model_period]]);
  if(grid)html+=facts([['Model grid',grid.title||grid.spec?.title||'Selected retained grid'],['Grid source edition',collection?.title||'Original imported source edition'],['Coordinate system',grid.grid?.crs_name||grid.grid?.crs],['Cell resolution',grid.grid?.resolution_m===undefined?'Inspect original grid':grid.grid.resolution_m+' m']])+
   '<p class="journey-note">The selected native grid defines the reporting boundary and modeled hydrologic domain. Regional context retains the separate saved HUC selection.</p>';
  if(profile||grid)html+=sourceDetails([...(profile?[['Profile',profile.id],['Coefficient source edition',profile.source_collection_id],['Coefficient table source',profile.biophysical_source_id],['Coefficient table SHA-256',profile.table_summary?.sha256]]:[]),...(grid?[['Model grid',grid.id],['Grid source edition',grid.spec?.source_collection_id],['Reporting boundary source',grid.spec?.reporting_area?.source_id||'Inspect original grid inputs'],['Hydrologic domain source',grid.spec?.model_domain?.source_id||'Inspect original grid inputs']]:[])]);
  return html+'</section>';
 }
 function decisionsHtml(){
  const value=context(),native=list(decisions?.experiments).length?decisions.experiments:rows('experiments');
  let html='<section class="journey-regional-section"><h3>Retained comparisons and decisions</h3><div class="journey-fields">'+
   field('experiment','Native scenario experiment',option('','Choose a retained experiment',value.experiment_id)+native.map(row=>option(row.id,(row.title||row.selection?.title||row.id)+' · '+(row.state||'retained'),value.experiment_id)).join(''))+
   field('decision','Saved decision study',option('','Choose a saved decision',value.decision_study_id)+list(decisions?.studies).map(row=>option(row.id,(row.title||row.id)+' · revision '+row.head,value.decision_study_id)).join(''))+'</div>';
  html+='<div class="page-actions">'+button('experiment','Open original experiment',!value.experiment_id)+button('prepare-decision','Configure decision from this experiment',!value.experiment_id)+button('decision','Open saved decision revision',!value.decision_study_id)+'</div>';
  if(experiment&&experiment.id===value.experiment_id){
   const baseline=actual('runs',experiment.selection?.baseline_run_id),grid=actual('grids',baseline?.selection?.grid_id);
   html+=facts([['Experiment',experiment.title||experiment.selection?.title||'Selected native experiment'],['Native state',experiment.state],['Baseline grid',grid?.title||grid?.spec?.title||'Open original experiment'],['Requested alternatives',list(experiment.selection?.scenario_ids).length],['Parameter profiles',list(experiment.selection?.profile_ids).length],['Native models',list(experiment.models).map(name=>name.toUpperCase()).join(' / ')]])+
    sourceDetails([['Experiment',experiment.id],['Baseline run',experiment.selection?.baseline_run_id],['Baseline grid',baseline?.selection?.grid_id],['Grid source edition',grid?.spec?.source_collection_id]]);
  }
  if(decision&&decision.id===value.decision_study_id)html+=facts([['Decision study',decision.study?.title||'Selected decision study'],['Opened revision',decision.revision],['Decision mode',decision.study?.mode==='native_packages'?'Complete native alternatives':'Declared additive actions'],['Retained calculations in revision',list(decision.runs).length]])+
   sourceDetails([['Decision study',decision.id],['Decision source experiment',decision.study?.source?.experiment_id||'Open retained decision source'],['Decision source grid',decision.study?.source?.grid_id||'Open retained decision source']]);
  html+='<p class="journey-note">Open the native experiment to inspect paired baseline and alternative results. Decision preparation asks for explicit costs, capacity, metric scales and weights before the original receiver binds those results.</p>';
  return html+'</section>';
 }
 function paint(){
  if(!node)return;
  const saved=host.document?.activeElement||globalThis.document?.activeElement;
  const focused=node.contains(saved)?{field:saved.dataset?.regionalField,journey:saved.dataset?.journeyField}:null;
  node.innerHTML='<div class="journey-regional">'+(error?'<p class="journey-error" role="alert">'+esc(error)+'</p>':'')+
   (step==='compare'?decisionsHtml():contextHtml()+scienceHtml()+(step==='study'?decisionsHtml():''))+'</div>';
  if(focused?.field)node.querySelector('[data-regional-field="'+focused.field+'"]')?.focus({preventScroll:true});
  if(focused?.journey)node.querySelector('[data-journey-field="'+focused.journey+'"]')?.focus({preventScroll:true});
 }
 async function refresh(force=false){
  reset();if(!node)return;
  const signature=snapshotKey();if(!force&&loaded===signature&&catalog){paint();return;}
  if(inflight){paint();return;}
  const forWorkspace=workspace,version=epoch;error='';
  const pending=(async()=>{
   const values=await Promise.allSettled([read('watershed-context','catalog',{},forWorkspace),read('robust-workbench','catalog',{},forWorkspace)]);
   if(!current(forWorkspace,version))return;
   if(values[0].status==='fulfilled')catalog=values[0].value;else error=values[0].reason?.message||String(values[0].reason);
   if(values[1].status==='fulfilled')decisions=values[1].value;else error+=(error?' ':'')+(values[1].reason?.message||String(values[1].reason));
   const cataloguesReady=values.every(value=>value.status==='fulfilled');
   const wanted=context();
   if(wanted.export_id&&catalog?.exports?.some(row=>row.id===wanted.export_id)){
    const record=await verifiedExport(wanted.export_id,forWorkspace);
    if(!current(forWorkspace,version)||context().export_id!==wanted.export_id)return;
    if(wanted.report_sha256&&wanted.report_sha256!==record.saved.report_sha256)throw Error('The selected report identity changed. Choose its retained watershed selection again.');
    if(wanted.huc12s?.length&&canonical([...wanted.huc12s].sort())!==canonical([...record.saved.huc12s].sort()))throw Error('The selected watershed membership changed. Choose its retained selection again.');
    selectedRecord=record;
   }
   if(wanted.experiment_id){
    const record=await read('experiments','inspect',{experiment_id:wanted.experiment_id,limit:1},forWorkspace);
    if(current(forWorkspace,version)&&context().experiment_id===record.id)experiment=record;
   }
   if(wanted.decision_study_id){
    const record=await read('robust-workbench','study',{study_id:wanted.decision_study_id,...(wanted.decision_revision?{revision:wanted.decision_revision}:{})},forWorkspace);
    if(current(forWorkspace,version)&&context().decision_study_id===record.id)decision=record;
   }
   if(current(forWorkspace,version)){
    if(cataloguesReady&&snapshotKey()===signature)loaded=signature;
    paint();
   }
  })();
  inflight=pending;
  try{await pending;}catch(fault){if(current(forWorkspace,version)){error=fault.message||String(fault);paint();}}
  finally{if(inflight===pending)inflight=null;}
 }
 function mount(container,currentStep){
  detach();reset();node=container;step=currentStep;if(!node)return;
  events=new AbortController();node.addEventListener('change',event=>{
   const field=event.target.dataset.regionalField;if(!field)return;
   const value=event.target.value,forWorkspace=workspace,choice=field==='selection'?'region':field;
   const operation=field==='selection'?chooseRegion(value):field==='experiment'?chooseExperiment(value):chooseDecision(value),token=choices[choice];
   Promise.resolve(operation).catch(fault=>{if(node&&key()===forWorkspace&&workspace===forWorkspace&&choices[choice]===token){error=fault.message||String(fault);paint();}});
  },{signal:events.signal});paint();void refresh();
 }
 function detach(){epoch++;events?.abort();events=null;node=null;inflight=null;}
 async function dispatch(buttonNode){
  const name=buttonNode.dataset.action?.replace(/^journey-regional-/,''),value=context(),chosen=selection(),forWorkspace=key(),version=epoch,originalNode=node;
  const requireSame=()=>{if(key()!==forWorkspace||epoch!==version||node!==originalNode)throw Error('Reopen this selection in its original workspace.');};
  if(name==='refresh')return refresh(true);
  if(name==='watersheds')return host.navigate('watershed-context');
  if(name==='selection'){if(!value.export_id)throw Error('Choose a saved watershed selection.');rememberRegional(value);return host.openDesk('watershed-context','openSelection',value.export_id);}
  if(name==='profile'){if(!actual('profiles',chosen.profile_id))throw Error('Choose a retained scientific profile.');return host.openDesk('profile-workbench','open',chosen.profile_id);}
  if(name==='grid')return host.openItem('grids',chosen.grid_id);
  if(name==='grid-map')return host.openMap('grids',chosen.grid_id);
  if(name==='experiment'){if(!value.experiment_id)throw Error('Choose a retained experiment.');return host.openExperiment(value.experiment_id);}
  if(name==='prepare-decision'){
   if(!value.experiment_id)throw Error('Choose a retained native experiment.');
   const record=await read('experiments','inspect',{experiment_id:value.experiment_id,limit:1},forWorkspace);requireSame();
   if(record.id!==value.experiment_id)throw Error('The original experiment identity changed.');
   return host.openDesk('robust-workbench','prepare',value.experiment_id);
  }
  if(name==='decision'){if(!value.decision_study_id)throw Error('Choose a retained decision study.');return host.openDesk('robust-workbench','open',value.decision_study_id,value.decision_revision);}
 }
 function notes(){
  const value=context();if(!value.export_id&&!value.experiment_id&&!value.decision_study_id)return '';
  return ['## Regional and decision context','',...Object.entries(value).filter(([name,v])=>name!=='schema'&&v!==null&&v!==''&&(!Array.isArray(v)||v.length)).map(([name,v])=>'- '+name.replaceAll('_',' ')+': '+(Array.isArray(v)?v.join(', '):v)),''].join('\n');
 }
 return {mount,detach,dispatch,validateImport,opening,capture:()=>Object.keys(context()).length?copy(context()):null,notes};
}
