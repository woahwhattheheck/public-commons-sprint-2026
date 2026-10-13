import {createSpatialWorkspace} from './spatial.mjs';
import {attachCommunity} from './community.mjs';
import {attachCustomerReviews} from './reviews.mjs';
import {attachReceivingWaters} from './receiving_waters.mjs';
import {createExtensionHost} from './extension_host.mjs';
import {attachExperiments} from './experiments.mjs';
import {attachProgrammes} from './programmes.mjs';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? String(value).slice(0,12) : '—';
const pretty = value => JSON.stringify(value, null, 2);
const human = value => String(value ?? '').replaceAll('_',' ').replaceAll('.',' · ');
const number = value => value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString(undefined,{maximumFractionDigits:6}) : esc(value);
const bytes = value => {if(value===undefined)return '—';const units=['B','KiB','MiB','GiB'];let n=Number(value),i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+units[i];};
const when = value => value ? new Date(value).toLocaleString() : '—';
const safeURL = value => /^https?:\/\//i.test(value??'') ? value : null;
const external = value => safeURL(value) ? '<a href="'+esc(value)+'" target="_blank" rel="noopener noreferrer">'+esc(value)+'</a>' : esc(value??'');
const badge = value => '<span class="status '+esc(value)+'">'+esc(human(value))+'</span>';
const noRows = (title, description, action, label) => '<div class="empty"><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+(action?'<button class="primary" data-action="'+action+'">'+esc(label)+'</button>':'')+'</div>';
const table = (heads, rows) => '<div class="table-scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const defs = obj => '<dl class="definition">'+Object.entries(obj).map(([k,v])=>'<dt>'+esc(human(k))+'</dt><dd>'+(typeof v==='object'?'<span class="mono">'+esc(pretty(v))+'</span>':esc(v??'—'))+'</dd>').join('')+'</dl>';
const button = (action,label,extra='',style='') => '<button type="button" class="'+esc(style)+'" data-action="'+esc(action)+'" '+extra+'>'+esc(label)+'</button>';
const named = (kind,id) => {const row=state?.data?.[kind]?.find(x=>x.id===id);return row?.title||row?.metadata?.title||row?.spec?.title||row?.selection?.title||short(id);};
const viewLabels={'receiving-waters':'Receiving waters',experiments:'Scenario experiments',programmes:'Run programmes',overview:'Workspace overview',sources:'Original sources',profiles:'Parameter profiles',grids:'Model grids',scenarios:'Land-cover scenarios',runs:'Native model runs',comparisons:'Run comparisons',spatial:'Spatial review',communities:'Communities','customer-reviews':'Customer reviews',observations:'Observed water quality',deliveries:'Maps and delivery'};
const actionLabels={'paired_ensemble.build':'Build paired ensemble','paired_ensemble.resume':'Continue paired ensemble','paired_ensemble.export':'Export paired ensemble','paired_ensemble.receive':'Receive paired ensemble','receiving.water.catalog':'Compile published waters','receiving.water.plan':'Prepare receiving areas','receiving.water.profile':'Prepare utility areas','receiving.water.analyze':'Analyze receiving waters','experiment.save':'Save experiment design','experiment.run':'Run scenario experiment','experiment.summarize':'Build experiment report','compute.programme.experiment':'Use saved experiment','compute.programme.save':'Save run programme','compute.programme.run':'Continue run programme','compute.programme.report':'Build result catalogue','compute.programme.delivery':'Build programme delivery','customer.review.create':'Create customer review','customer.review.export':'Export customer review','customer.review.response.import':'Receive customer response','community.table.import':'Import community table','community.plan.save':'Save intervention plan','community.report.build':'Build community report','spatial.review.save':'Save spatial review','spatial.review.export':'Export saved spatial review','source.import':'Import original sources','profile.save':'Save parameter profile','scenario.save':'Save land-cover scenario','grid.prepare':'Prepare model grid','run.prepare':'Prepare native run','run.start':'Run selected native models','run.compare':'Compare native runs','observation.import':'Import original observations','observation.compare':'Compare observed annual loads','delivery.build':'Build complete map delivery','workspace.backup':'Back up scientific workspace','workspace.restore':'Restore scientific workspace'};
const mapFamilies=['future_sediment_loss','future_nutrient_runoff','critical_drinking_water','high_quality_waters','current_nutrient_export','current_sediment_export','combined_pollutant_export'];
const mapTitles={future_sediment_loss:'Future sediment loss',future_nutrient_runoff:'Future nutrient runoff',critical_drinking_water:'Critical drinking-water sources',high_quality_waters:'Designated high-quality waters',current_nutrient_export:'Current nutrient export',current_sediment_export:'Current sediment export',combined_pollutant_export:'Combined pollutant export'};
const keyName='upstate-operator-capability';
const fragment=new URLSearchParams(location.hash.slice(1));
let capability=fragment.get('token')||sessionStorage.getItem(keyName);
if(fragment.get('token')){sessionStorage.setItem(keyName,capability);history.replaceState(null,'','#overview');}
let workspace=sessionStorage.getItem('upstate-selected-workspace')||null;
let state=null,view=viewLabels[location.hash.slice(1)]?location.hash.slice(1):'overview',poll=null,refreshing=false,refreshQueued=false;
let formContext=null,detailContext=null,taskPanel=false,toastTimer=null,sourcePreview=null;
let lastTaskStates=new Map(),lastRendered='',logOffset=0;
const form=$('#operation-form'),formDialog=$('#form-dialog'),detailDialog=$('#detail-dialog');

const spatialWorkspace=createSpatialWorkspace({request:api,getWorkspace:()=>workspace,refreshState:refresh,showTask,openItem,toast});

async function api(path,{method='GET',body,raw,filename,signal}={}){
  const headers={Authorization:'Bearer '+capability};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);
  const response=await fetch(path,{method,headers,body:raw??(body===undefined?undefined:JSON.stringify(body)),credentials:'same-origin',signal});
  const text=await response.text();
  let value;try{value=JSON.parse(text);}catch{value={error:{message:'The operator returned an unreadable response (HTTP '+response.status+').'}};}
  if(!response.ok){const error=new Error(value.error?.message||'HTTP '+response.status);error.code=value.error?.code;error.status=response.status;throw error;}
  return value;
}
const endpoint = (path, values={}) => path+'?'+new URLSearchParams({...(workspace?{workspace}:{}),...values});
const community=attachCommunity({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,sourceForm,toast,openItem});
const customerReviews=attachCustomerReviews({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,uploadFile,showTask,toast,closeForm:()=>{formDialog.close();formContext=null;}});
const receivingWaters=attachReceivingWaters({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast});
const experiments=attachExperiments({navigate,closeDetail:()=>{detailDialog.close();detailContext=null;},getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,toast,openItem,showTask});
const programmes=attachProgrammes({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,openItem,refreshState:refresh,navigate,closeDetail:()=>{detailDialog.close();detailContext=null;}});
const extensions=createExtensionHost({getState:()=>state,getWorkspace:()=>workspace,api,endpoint,toast,
 navigationRoot:'.sidebar',refreshState:refresh,openItem,showTask,showRunLog,navigate,
 openForm,submitAction,detail,fileList,uploadFile,
 closeDetail:()=>{detailDialog.close();detailContext=null;},
 openDelivery:selection=>deliveryForm(undefined,selection),
 getProgramme:()=>typeof programmes==='undefined'?null:programmes});
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function globalError(error){$('#global-error').textContent=error.message||String(error);$('#global-error').hidden=false;}
function clearError(){$('#global-error').hidden=true;$('#global-error').textContent='';}
async function refresh({force=false}={}){
  if(!capability)return;
  if(refreshing){if(force)refreshQueued=true;return;}
  refreshing=true;clearTimeout(poll);
  const requestedWorkspace=workspace;
  try{
    let data;
    try{data=await api('/api/state'+(requestedWorkspace?'?workspace='+encodeURIComponent(requestedWorkspace):''));}
    catch(error){
      if(workspace!==requestedWorkspace)return;
      if(error.status!==404||!requestedWorkspace)throw error;
      data=await api('/api/state');
    }
    if(workspace!==requestedWorkspace)return;
    state=data;workspace=data.workspace_key;sessionStorage.setItem('upstate-selected-workspace',workspace);
    $('#connection-state').textContent='';
    const options=data.workspaces.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===workspace?'selected':'')+' '+(!x.available?'disabled':'')+'>'+esc(x.title)+(x.received?' · restored copy':'')+'</option>').join('');
    $('#workspace-select').innerHTML=options;
    for(const task of data.tasks){
      const taskKey=workspace+':'+task.id,before=lastTaskStates.get(taskKey);
      if(before&&before!==task.state&&task.state==='complete')toast(programmes.completionMessage(task)||(actionLabels[task.action]||task.action)+' completed.');
      lastTaskStates.set(taskKey,task.state);
    }
    renderTasks();
    extensions.update(state);
    const fingerprint=JSON.stringify({view,workspace,data:data.data});
    if(force||fingerprint!==lastRendered){render();lastRendered=fingerprint;}
    if(detailContext?.kind==='task')await showTask(detailContext.id,false);
    if(['runs','spatial_exports'].includes(detailContext?.kind)&&detailDialog.open){const kind=detailContext.kind,row=(data.data[kind]||[]).find(x=>x.id===detailContext.id);if(row&&row.state!==detailContext.state)await openItem(kind,row.id,false);}
  }catch(error){
    if(workspace===requestedWorkspace){$('#connection-state').textContent='Connection interrupted. Retained task state is preserved.';if(force)globalError(error);}
  }finally{
    refreshing=false;clearTimeout(poll);
    if(refreshQueued){refreshQueued=false;poll=setTimeout(()=>refresh({force:true}),0);}
    else poll=setTimeout(()=>refresh(),state?.tasks.some(x=>['queued','running'].includes(x.state))?2500:12000);
  }
}
function pageHeader(title,description,actions=''){return '<header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div><div class="page-actions">'+actions+'</div></header>';}
function section(title,description,body,actions=''){return '<section class="section"><header class="section-header"><div><h3>'+esc(title)+'</h3>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+actions+'</header>'+body+'</section>';}
function metaId(row){return '<small><span class="mono">'+esc(short(row.id))+'</span> · '+esc(when(row.created_at||row.captured_at))+'</small>';}
function itemButton(kind,id,label='Open'){return button('item',label,'data-kind="'+kind+'" data-id="'+id+'"','small')+(['sources','grids','runs','comparisons','deliveries'].includes(kind)?button('spatial-item','Map','data-kind="'+kind+'" data-id="'+id+'"','small'):'');}
function sourceName(collection,id){return state?.data.sources.find(x=>x.id===collection)?.entries.find(x=>x.id===id)?.title||id||'—';}
function sumCell(artifact){return artifact?number(artifact.sum)+' <small>'+esc(artifact.sum_units||artifact.units||'')+'</small>':'—';}
function render(){
  if(!state)return;
  if(!extensions.hasView(view))extensions.detach();
  if(typeof experiments!=='undefined'&&view!=='experiments')experiments.detach();
  if(typeof experimentDiagnostics!=='undefined'&&view!=='experiment-diagnostics')experimentDiagnostics.detach();
  if(typeof receivingWaters!=='undefined'&&view!=='receiving-waters')receivingWaters.detach();
  for(const node of $$('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');
  if(extensions.render(view,$('#content'),state)){community.detach();customerReviews.detach();spatialWorkspace.suspend();if(typeof programmes!=='undefined')programmes.detach();if(typeof conservation!=='undefined')conservation.detach();return;}
  if(view==='experiments'){extensions.detach();programmes.detach();spatialWorkspace.suspend();community.detach();customerReviews.detach();experiments.mount($('#content'),state);return;}
  experiments.detach();
  if(view==='spatial'){receivingWaters.detach();programmes.detach();community.detach();customerReviews.detach();spatialWorkspace.mount($('#content'),state);return;}
  spatialWorkspace.suspend();
  if(view==='programmes'){community.detach();customerReviews.detach();programmes.mount($('#content'),state);return;}
  programmes.detach();
  const d=state.data;let html='';
  if(view==='overview'){
    const complete=d.runs.filter(x=>x.state==='complete').length;
    html=pageHeader(d.project.title,'Original data, explicit model choices, retained native outputs and a complete receiving package.',button('source-open','Import sources','','primary'));
    html+='<div class="cards">'+[
      ['Source editions',d.sources.length,'Retained original files and provenance.'],
      ['Model grids',d.grids.filter(x=>x.state==='complete').length,'Aligned to each study’s original reference grid.'],
      ['Complete native runs',complete,'Completed outputs for each run’s selected native models.'],
      ['Complete deliveries',d.deliveries.filter(x=>x.state==='complete').length,'Seven map families, physical rasters and working archive.']
    ].map(x=>'<div class="card"><h3>'+x[0]+'</h3><strong class="number">'+number(x[1])+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>';
    html+='<div class="two-columns">'+section('Continue the original workflow','Each saved selection remains available after reopening.','<div class="section-body flow-list">'+[
      ['1','Retain original source editions','Import a native source package or register a published table with its actual provenance.','source-open','Sources'],
      ['2','Select the biophysical profile and reporting grid','Choose real land-cover coefficients, hydrologic context, units and native parameters.','profile-new','Profile'],
      ['3','Compare explicit land-cover scenarios','Run the retained baseline and alternatives on the same source grid.','run-prepare','Prepare run'],
      ['4','Assemble the seven-map delivery','Join actual water-designation overlays, observations, report, metadata and a full working archive.','delivery-new','Delivery']
    ].map(x=>'<div class="flow-row"><span class="flow-step">'+x[0]+'</span><div><h3>'+x[1]+'</h3><p>'+x[2]+'</p></div>'+button(x[3],x[4],'','small')+'</div>').join('')+'</div>')+
    section('Workspace custody','Original identity is preserved by native backup and restore.','<div class="section-body">'+defs({project_id:d.project.id,created:when(d.project.created_at),source_editions:d.sources.length,observation_editions:d.observations.length,retained_comparisons:(d.comparisons||[]).length+(d.observation_comparisons||[]).length})+'<div class="page-actions">'+button('backup','Create complete backup')+button('restore','Restore an archive')+'</div></div>')+'</div>';
  }
  if(view==='sources'){
    html=pageHeader('Original sources','Retain the source URI, edition, units, exact bytes and native sidecars before selecting data for analysis.',button('source-open','Import source edition','','primary'));
    html+=d.sources.length?section('Retained source editions','Select an edition to inspect its original files and native schema.',table(['Edition','Captured','Sources','Scope',''],d.sources.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong>'+metaId(row)+'</td><td>'+esc(row.captured_at||'Not supplied')+'</td><td>'+row.entries.length+'</td><td>'+esc(typeof row.scope==='string'?row.scope:JSON.stringify(row.scope))+'</td><td class="actions-cell">'+itemButton('sources',row.id)+'</td></tr>'))):noRows('Import the original source data','A source edition retains its actual manifest and file bytes, including raster units and the biophysical CSV.','source-open','Import sources');
  }
  if(view==='profiles'){
    html=pageHeader('Parameter profiles','Use the original biophysical CSV and parameters for the selected native NDR/SDR models. Save revisions as new immutable profiles.',button('profile-new','New parameter profile','','primary'));
    html+=d.profiles.length?section('Retained parameter choices','The original table is preserved by source edition and content hash.',table(['Profile','Table codes','Flow routing','Model period',''],d.profiles.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong>'+metaId(row)+'</td><td>'+number(row.table_summary?.rows)+'</td><td>'+nativeModels(row).map(name=>esc(name.toUpperCase())+' '+esc(row[name]?.flow_dir_algorithm?.toUpperCase()||'—')).join(' / ')+'</td><td>'+esc(typeof row.model_period==='object'?JSON.stringify(row.model_period):row.model_period||'Not supplied')+'</td><td class="actions-cell">'+itemButton('profiles',row.id)+button('profile-clone','Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Select real biophysical coefficients','Create a profile from an imported parameter table and its published references.','profile-new','New profile');
  }
  if(view==='grids'){
    html=pageHeader('Model grids','Align the selected models’ original rasters to the retained native grid, preserving its cell size, reporting mask and upstream model context. Extend an existing grid when additional model sources arrive.',button('grid-new','Prepare model grid','','primary'));
    html+=d.grids.length?section('Original grid preparations','Incomplete preparations retain their completed native files for continuation.',table(['Grid','State','Dimensions','Resolution','Source edition',''],d.grids.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.spec.title||'Model grid')+'</strong><small>'+esc(nativeModelLabel(row.spec))+'</small>'+metaId(row)+'</td><td>'+badge(row.state)+'</td><td>'+number(row.grid?.width)+' × '+number(row.grid?.height)+'</td><td>'+number(row.grid?.resolution_m)+' m</td><td>'+esc(named('sources',row.spec.source_collection_id))+'</td><td class="actions-cell">'+itemButton('grids',row.id)+button('grid-clone',row.state==='complete'?'Extend / revise':'Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Prepare the reporting and model grid','Select original rasters, the reporting boundary, the covering hydrologic domain and an explicit positive context buffer.','grid-new','Prepare grid');
  }
  if(view==='scenarios'){
    html=pageHeader('Land-cover scenarios','Preserve the original baseline and describe each proposed land-cover change using an actual retained polygon mask.',button('scenario-new','New scenario','','primary'));
    html+=d.scenarios.length?section('Retained scenario assumptions','A revision creates a separate scenario with its original reasons and source masks.',table(['Scenario','Kind','Changes','Source edition',''],d.scenarios.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong><small>'+esc(row.reason)+'</small></td><td>'+badge(row.kind)+'</td><td>'+number(row.patches.length)+'</td><td>'+esc(named('sources',row.source_collection_id))+'</td><td class="actions-cell">'+itemButton('scenarios',row.id)+button('scenario-clone','Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Retain a baseline and explicit alternatives','The baseline uses the actual land-cover edition; alternatives change only selected source masks and land-cover codes.','scenario-new','New scenario');
  }
  if(view==='runs'){
    html=pageHeader('Native model runs','Prepare a source-bound selection, then execute its original InVEST models. Completed native stages remain available for continuation and exact reuse.',button('run-compare','Compare completed runs')+button('run-prepare','Prepare native run','','primary'));
    html+=d.runs.length?section('Retained model runs','Annual export totals use the original reporting mask and physical units.',table(['Selection','State','Nitrogen','Phosphorus','Sediment',''],d.runs.map(row=>'<tr><td class="name-cell"><strong>'+esc(named('scenarios',row.selection.scenario_id))+'</strong><small>'+esc(named('profiles',row.selection.profile_id))+' · '+esc(named('grids',row.selection.grid_id))+' · '+esc(nativeModelLabel(row.selection))+'</small><small class="mono">'+short(row.id)+'</small></td><td>'+badge(row.state)+'</td><td class="number-cell">'+nativeOutputCell(row,'ndr','nitrogen_export')+'</td><td class="number-cell">'+nativeOutputCell(row,'ndr','phosphorus_export')+'</td><td class="number-cell">'+nativeOutputCell(row,'sdr','sediment_export')+'</td><td class="actions-cell">'+itemButton('runs',row.id)+(row.state==='prepared'||row.state==='failed'?button('run-start',row.state==='prepared'?'Run':'Resume','data-id="'+row.id+'"','small'):'')+(canSelectCompletedModels(row)?button('run-completed-models','Use completed models','data-id="'+row.id+'"','small'):'')+'</td></tr>'))):noRows('Prepare the first native model run','Select a complete grid, retained coefficient profile and baseline or alternative scenario.','run-prepare','Prepare native run');
  }
  if(view==='comparisons'){
    html=pageHeader('Run comparisons','Compare completed original runs on the same retained grid. Signed changes are alternative minus baseline.',button('run-compare','Compare runs','','primary'));
    const rows=d.comparisons||[];
    html+=rows.length?section('Retained run comparisons','Profile changes remain explicit alongside land-cover changes.',table(['Baseline','Alternatives','Direction',''],rows.map(row=>'<tr><td class="name-cell"><strong>'+esc(runTitle(row.baseline_run_id))+'</strong><small class="mono">'+short(row.id)+'</small></td><td>'+row.alternatives.length+'</td><td>'+esc(row.direction)+'</td><td class="actions-cell">'+itemButton('comparisons',row.id)+'</td></tr>'))):noRows('Compare the completed baseline and alternatives','The comparison preserves the actual difference rasters and their valid-cell coverage.','run-compare','Compare runs');
  }
  if(view==='observations'){
    html=pageHeader('Observed water quality','Retain every original CSV row and its qualifier. Compare only explicitly derived annual N/P/sediment mass rates with full native catchment outputs.',button('observation-compare','Compare observations')+button('observation-new','Import observations','','primary'));
    html+=d.observations.length?section('Original observation editions','Context rows, including nonannual water-quality measurements, remain in the retained source.',table(['Edition','Rows','Annual loads admitted','Context rows','Source',''],d.observations.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.metadata.title)+'</strong><small>'+esc(row.metadata.value_basis||'context')+'</small></td><td>'+number(row.row_count)+'</td><td>'+number(row.admitted_count)+'</td><td>'+number(row.context_count)+'</td><td>'+external(row.metadata.source_uri)+'</td><td class="actions-cell">'+itemButton('observations',row.id)+'</td></tr>'))):noRows('Import actual observation records','Preserve original station and catchment identities, units, dates, annualization methods and qualifiers.','observation-new','Import observations');
    const comparisons=d.observation_comparisons||[];
    if(comparisons.length)html+=section('Retained observed-versus-modeled comparisons','Review periods, spatial coverage and model assumptions with the residuals.',table(['Observation edition','Model run','Compared','Context / excluded',''],comparisons.map(row=>'<tr><td class="name-cell"><strong>'+esc(named('observations',row.observation_id))+'</strong><small class="mono">'+short(row.id)+'</small></td><td>'+esc(runTitle(row.run_id))+'</td><td>'+number(row.comparisons.length)+'</td><td>'+number(row.exclusions.length)+'</td><td class="actions-cell">'+itemButton('observation_comparisons',row.id)+'</td></tr>')));
  }
  if(view==='deliveries'){
    html=pageHeader('Maps and delivery','Build all seven requested map families from completed native runs, actual water-designation overlays and original parcel/source editions.',button('delivery-new','Build complete delivery','','primary'));
    html+=d.deliveries.length?section('Retained delivery builds','Each package joins physical rasters, FGDC metadata, PDF maps/report, observations and a receiving-ready working archive.',table(['Delivery','State','Maps','Original package audit',''],d.deliveries.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.selection.title||'Scientific delivery')+'</strong>'+metaId(row)+'</td><td>'+badge(row.state)+'</td><td>'+Object.keys(row.maps||{}).length+'</td><td>'+esc(row.package?.auditStatus||'In progress')+'</td><td class="actions-cell">'+itemButton('deliveries',row.id)+(row.state==='failed'?button('delivery-resume','Resume','data-id="'+row.id+'"','small'):'')+'</td></tr>'))):noRows('Build the complete original-data delivery','Select the completed baseline and alternatives, real source-water/designation overlays, original supporting datasets and metadata contact.','delivery-new','Prepare delivery');
    if(d.spatial_exports?.length)html+=section('Saved map packs','Printable figures retain the selected review, source editions, extent, legend and annotations.',table(['Map pack','State','Paper / resolution',''],d.spatial_exports.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title||row.id)+'</strong>'+metaId(row)+'</td><td>'+badge(row.state)+'</td><td>'+esc([row.selection?.paper?.toUpperCase()||'',row.selection?.dpi?row.selection.dpi+' dpi':''].filter(Boolean).join(' · '))+'</td><td class="actions-cell">'+itemButton('spatial_exports',row.id,'Open files')+'</td></tr>')));
    html+='<div class="map-cards">'+mapFamilies.map((id,i)=>'<article class="map-card"><p class="map-index">MAP FAMILY '+String(i+1).padStart(2,'0')+'</p><h3>'+mapTitles[id]+'</h3><p>Generated from the selected original model outputs and retained source editions.</p></article>').join('')+'</div>';
  }
  if(view==='communities')html=community.render();
  if(view==='customer-reviews')html=customerReviews.render();
  if(view==='receiving-waters')html=receivingWaters.render();
  $('#content').innerHTML=html;
  if(view==='receiving-waters')receivingWaters.mount($('#content'));else receivingWaters.detach();
  if(view==='runs'){const actions=$('.page-actions',$('#content'));if(actions)actions.insertAdjacentHTML('beforeend',button('programme-open','Run programmes'));}
  if(view==='communities')community.mount($('#content'));else community.detach();
  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();
}
function runTitle(id){const row=state?.data.runs.find(x=>x.id===id);return row?named('scenarios',row.selection.scenario_id)+' · '+named('profiles',row.selection.profile_id)+' · '+nativeModelLabel(row.selection):short(id);}
function renderTasks(){
  const tasks=state?.tasks||[],active=tasks.filter(x=>['queued','running'].includes(x.state));
  $('#task-count').textContent=active.length;
  $('#task-banner').hidden=!active.length;
  if(active.length)$('#task-banner').innerHTML='<strong>'+esc(active[0].state==='running'?'Original operation running':'Original operation queued')+'</strong>'+esc(actionLabels[active[0].action]||active[0].action)+button('tasks','Inspect operations','','small');
  $('#task-list').innerHTML=tasks.length?tasks.map(row=>'<article class="task-row"><h3>'+esc(actionLabels[row.action]||row.action)+badge(row.state)+'</h3><time>'+esc(when(row.created_at))+'</time>'+(row.error?'<p class="error-text">'+esc(row.error.message)+'</p>':'')+'<div class="task-actions">'+button('task-open','Details','data-id="'+row.id+'"','small')+(['failed','interrupted','cancelled'].includes(row.state)?button('task-resume','Resume original selection','data-id="'+row.id+'"','small'):'')+(row.state==='queued'?button('task-cancel','Cancel before start','data-id="'+row.id+'"','small'):'')+'</div></article>').join(''):'<div class="section-body note">Workspace operations will appear here with their selected inputs and retained attempts.</div>';
}
function fileList(files){
  if(!files?.length)return '';
  return '<div class="file-list">'+files.map(f=>'<div class="file-row"><div><strong>'+esc(f.label||f.filename)+'</strong><small>'+esc(f.filename)+' · '+bytes(f.bytes)+'</small><small class="mono">SHA256 '+esc(f.sha256)+'</small></div><div class="inline-actions">'+(f.filename.toLowerCase().endsWith('.pdf')?button('preview-file','Preview','data-file-id="'+f.id+'"','small'):'')+'<a href="'+esc(f.url)+'?download=1" download>Download</a></div></div>').join('')+'</div>';
}
function detail(title,body,{kind,id,state:status}={}){
  $('#detail-title').textContent=title;$('#detail-body').innerHTML=body;
  detailContext={kind,id,state:status,files:detailContext?.files||[]};
  if(!detailDialog.open)detailDialog.showModal();
}
async function openItem(kind,id,focus=true){
  const requestedWorkspace=workspace,row=await api(endpoint('/api/item',{kind,id}));if(workspace!==requestedWorkspace)return;detailContext={kind,id,state:row.state,files:row._downloads||[]};
  let content='';
  if(kind==='sources'){
    content=defs({captured_at:row.captured_at,source_count:row.entries.length,scope:row.scope})+table(['Source','Kind / units','Edition','Original source',''],row.entries.map(e=>'<tr><td class="name-cell"><strong>'+esc(e.title)+'</strong><small>'+esc(e.id)+'</small></td><td>'+esc(e.kind)+'<br>'+esc(e.units||'')+'</td><td>'+esc(e.vintage)+'</td><td>'+external(e.uri)+'</td><td>'+button('source-inspect','Inspect native file','data-collection="'+id+'" data-source="'+esc(e.id)+'"','small')+'</td></tr>'));
  }else if(kind==='profiles'){
    content='<div class="two-columns">'+nativeModels(row).map(name=>section(name==='ndr'?'Nutrient delivery ratio':'Sediment delivery ratio','Original '+name.toUpperCase()+' parameters.','<div class="section-body">'+defs(row[name]||{})+'</div>')).join('')+'</div>'+defs({selected_models:nativeModelLabel(row),biophysical_table:sourceName(row.source_collection_id,row.biophysical_source_id),land_cover_codes:row.table_summary.lucodes,model_period:row.model_period||'Not supplied',references:row.references})+button('profile-clone','Create revised profile','data-id="'+id+'"');
  }else if(kind==='grids'){
    content=defs({state:row.state,selected_models:nativeModelLabel(row.spec),reused_original_grid:row.spec.base_grid_id||'Prepared from the selected original sources',reused_inputs:Object.keys(row.reused_inputs||{}),crs:row.grid?.crs_name,dimensions:row.grid?.width+' × '+row.grid?.height,resolution_m:row.grid?.resolution_m,pixel_area_ha:row.grid?.pixel_area_ha,bounds:row.grid?.bounds,transform:row.grid?.transform,upstream_context_m:row.spec.upstream_buffer_m})+table(['Input','Source edition','Units / source','Native minimum','Native maximum'],Object.entries(row.inputs||{}).map(([name,input])=>'<tr><td>'+esc(name)+'</td><td>'+esc(input.vintage)+'</td><td>'+external(input.source_uri)+'</td><td>'+number(input.minimum)+'</td><td>'+number(input.maximum)+'</td></tr>'));
  }else if(kind==='scenarios'){
    content=defs({kind:row.kind,reason:row.reason,source_edition:named('sources',row.source_collection_id)})+table(['Original mask','From land-cover codes','To code','Reason','Selection'],row.patches.map(p=>'<tr><td>'+esc(sourceName(row.source_collection_id,p.mask_source_id))+'</td><td>'+esc(p.from_codes.join(', '))+'</td><td>'+p.to_code+'</td><td>'+esc(p.reason)+'</td><td>'+esc(pretty({layer:p.layer,where:p.where}))+'</td></tr>'))+button('scenario-clone','Create revised scenario','data-id="'+id+'"');
  }else if(kind==='runs'){
    content='<div class="meta">'+badge(row.state)+'<span>InVEST '+esc(row.selection.invest_version)+'</span><span>'+esc(runTitle(row.id))+'</span></div>';
    if(row.error)content+='<div class="notice error">'+esc(row.error.message)+'</div>';
    content+=table(['Native stage','Execution source','Started','Completed','Retained outputs'],Object.entries(row.stages||{}).map(([name,stage])=>'<tr><td>'+esc(human(name))+'</td><td>'+(stage.reused_from?'Reused from '+esc(short(stage.reused_from.run_id))+'<br><small>'+esc(when(stage.reused_at))+'</small>':'Calculated in this retained run')+'</td><td>'+esc(when(stage.started_at))+'</td><td>'+esc(when(stage.completed_at))+'</td><td>'+(Object.keys(stage.files||{}).length+(stage.artifact?1:0))+'</td></tr>'));
    content+=table(['Export','Annual reporting total','Valid cells'],Object.entries(row.artifacts||{}).map(([name,item])=>'<tr><td>'+esc(human(name))+'</td><td>'+sumCell(item)+'</td><td>'+number(item.valid_cells)+'</td></tr>'));
    content+=completedModelOrigins(row);
    content+='<div class="page-actions">'+(['prepared','failed'].includes(row.state)?button('run-start',row.state==='failed'?'Resume original models':'Run original models','data-id="'+id+'"','primary'):'')+(canSelectCompletedModels(row)?button('run-completed-models','Use completed models','data-id="'+id+'"'):'')+button('run-log','Read native log','data-id="'+id+'"')+'</div><pre id="native-log" class="logs" hidden></pre>';
  }else if(kind==='comparisons'){
    content=defs({baseline:runTitle(row.baseline_run_id),direction:row.direction,compared_outputs:row.common_artifacts||Object.keys(row.alternatives?.[0]?.artifacts||{})})+table(['Alternative','Export','Annual change','Valid cells','Profile also changes'],row.alternatives.flatMap(alt=>Object.entries(alt.artifacts).map(([name,item])=>'<tr><td>'+esc(runTitle(alt.run_id))+'</td><td>'+esc(human(name))+'</td><td>'+number(item.sum_change)+' '+esc((item.units||'').replace('/pixel',''))+'</td><td>'+number(item.valid_cells)+'</td><td>'+esc(alt.profile_changed?'Yes':'No')+'</td></tr>')));
  }else if(kind==='observations'){
    content=defs({source_uri:row.metadata.source_uri,value_basis:row.metadata.value_basis,annualization_method:row.metadata.annualization_method||'Context observations',rows:row.rows.length,admitted:row.admitted_count,context:row.context_count})+'<div class="filters"><label>Find a record<input id="observation-search" placeholder="Station, catchment, parameter or qualifier"></label><label>Rows<select id="observation-filter"><option value="">All original rows</option value="admitted">Annual loads admitted</option><option value="context">Context and exclusions</option></select></label></div><div id="observation-records"></div>';
  }else if(kind==='observation_comparisons'){
     content='<p class="note">'+esc(row.interpretation)+'</p>'+defs({run:runTitle(row.run_id),observations:named('observations',row.observation_id),catchment_source:row.catchment_source,model_period:row.model_period||'Review original source vintages',selected_models:row.model_scope?.selected_models||'Review the retained run selection'});
     content+='<p class="note">'+esc(row.metrics_basis||'This retained comparison predates the complete-catchment coverage check. Create a comparison on the same retained run and observations to calculate current coverage.')+'</p>';
     content+=table(['Parameter',row.comparison_version>=2?'Complete comparisons':'Retained comparisons','Mean bias','RMSE','Nash–Sutcliffe efficiency','Catchments / periods'],Object.entries(row.metrics).map(([name,m])=>'<tr><td>'+esc(name)+'<br><small>'+esc(m.units)+'</small></td><td>'+m.n+'</td><td>'+number(m.mean_bias)+'</td><td>'+number(m.rmse)+'</td><td>'+number(m.nash_sutcliffe_efficiency)+'</td><td>'+number(m.unique_catchments??m.n)+' catchments<br><small>'+esc(m.repeated_catchments?'Includes repeated station periods':'Distinct catchments')+'</small></td></tr>'));
     content+='<div class="filters"><label>Parameter<select id="comparison-parameter"></select></label><label>Station / catchment<select id="comparison-station"></select></label><label>Coverage<select id="comparison-coverage"><option value="">Every retained comparison</option><option value="complete">Complete catchments</option><option value="partial">Partial or legacy coverage</option></select></label></div><div id="observation-comparison-view"></div>';
     content+='<div class="page-actions">'+button('observation-comparison-csv','Download selected comparison rows')+'</div>';
     if(row.exclusions.length)content+='<details class="technical"><summary>'+row.exclusions.length+' original context or excluded rows</summary><pre class="json-view">'+esc(pretty(row.exclusions))+'</pre></details>';
   }else if(kind==='spatial_exports'){
    content='<div class="meta">'+badge(row.state)+'</div>'+defs({saved_review:row.review_id,paper:row.selection?.paper,resolution_dpi:row.selection?.dpi,created_at:row.created_at});
    if(row.error)content+='<div class="notice error">'+esc(row.error.message||row.error)+'</div>';
    if(row.review_id)content+='<div class="page-actions">'+button('spatial-item','Open saved view','data-kind="spatial_reviews" data-id="'+esc(row.review_id)+'"')+'</div>';
    if(row.summary)content+=defs({map_mode:row.summary.mode,coordinate_system:row.summary.view?.crs,extent:row.summary.view?.bounds,annotations:row.summary.marker_count});
    content+=customerReviews.mapActions(row);
   }else if(kind==='deliveries'){
    content='<div class="meta">'+badge(row.state)+'<span>Original audit: '+esc(row.package?.auditStatus||'In progress')+'</span><span>'+Object.keys(row.maps||{}).length+' retained map PDFs</span></div>';
    if(row.error)content+='<div class="notice error">'+esc(row.error.message)+'</div>';
    content+='<div class="map-cards">'+Object.entries(row.maps||{}).map(([name,item])=>{const family=mapFamilies.find(x=>name===x||name.startsWith(x+'-'));const f=row._downloads.find(x=>x.sha256===item.sha256&&x.bytes===item.bytes);return '<article class="map-card"><p class="map-index">'+esc(family?'MAP FAMILY '+(mapFamilies.indexOf(family)+1):'MAP')+'</p><h3>'+esc(mapTitles[family]||human(name))+'</h3><p>'+esc(name.slice((family||'').length).replace(/^-/,'')?runTitle(name.slice(family.length+1)):'Selected baseline and source context')+'</p>'+(f?button('preview-file','Open original PDF','data-file-id="'+f.id+'"','small'):'')+'</article>';}).join('')+'</div>';
    if(row.priority)content+='<h3 class="subheading">Combined priority settings</h3>'+defs(row.priority);
    if(row.state==='failed')content+=button('delivery-resume','Resume original delivery','data-id="'+id+'"','primary');
  }
  if(['sources','grids','runs','comparisons','deliveries','spatial_reviews'].includes(kind))content='<div class="page-actions">'+button('spatial-item','Open in spatial review','data-kind="'+kind+'" data-id="'+id+'"')+'</div>'+content;
  content+='<h3 class="subheading">Retained files</h3>'+fileList(row._downloads)+'<details class="technical"><summary>Original record, selection and provenance</summary><pre class="json-view">'+esc(pretty(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_downloads'))))+'</pre></details>';
  detail(row.title||row.metadata?.title||row.spec?.title||row.selection?.title||viewLabels[kind]||human(kind),content,{kind,id,state:row.state});detailContext.files=row._downloads;
  if(kind==='observations'){detailContext.observation=row;renderObservationRows();$('#observation-search').addEventListener('input',renderObservationRows);$('#observation-filter').addEventListener('change',renderObservationRows);}
  if(kind==='observation_comparisons'){
     detailContext.observationComparison=row;
     $('#comparison-parameter').innerHTML=[...new Set(row.comparisons.map(r=>r.parameter))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(human(x))+'</option>').join('');
     $('#comparison-station').innerHTML='<option value="">All stations / catchments</option>'+[...new Set(row.comparisons.map(r=>r.station_id||r.catchment_id))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
     for(const id of ['comparison-parameter','comparison-station','comparison-coverage'])$('#'+id).addEventListener('change',renderObservationComparison);
     renderObservationComparison();
   }
   if(focus)$('#detail-body').scrollTop=0;
}
function renderObservationRows(){
  const row=detailContext.observation,q=$('#observation-search').value.trim().toLowerCase(),type=$('#observation-filter').value;
  const all=row.rows.filter(r=>(!q||JSON.stringify(r).toLowerCase().includes(q))&&(!type||(type==='admitted')===r.admitted));
  $('#observation-records').innerHTML='<p class="note">'+Math.min(150,all.length)+' of '+all.length+' matching retained rows. The original CSV download contains every source row.</p>'+table(['Record','Catchment / station','Parameter','Original value / unit','Period','Method / uncertainty','Disposition'],all.slice(0,150).map(r=>'<tr><td>'+esc(r.id)+'</td><td>'+esc(r.catchment_id)+'<br><small>'+esc(r.station_id)+'</small></td><td>'+esc(r.parameter)+'</td><td>'+esc(r.value_text)+' '+esc(r.unit)+'</td><td>'+esc(r.period_start)+'<br>'+esc(r.period_end)+'</td><td>'+observationMethod(r)+'</td><td>'+badge(r.admitted?'admitted':'context')+'<small>'+esc(r.issues.join('; '))+'</small></td></tr>'));
}
function observationMethod(row){
 const method=row.method||'Original source method retained',uncertainty=row.uncertainty;
 return '<span>'+esc(typeof method==='string'?method:pretty(method))+'</span>'+
   (uncertainty!==undefined&&uncertainty!==null&&uncertainty!==''?'<details class="row-detail"><summary>Source uncertainty</summary><pre>'+esc(typeof uncertainty==='string'?uncertainty:pretty(uncertainty))+'</pre></details>':'<small>Source uncertainty not specified</small>')+
   (row.source_records?'<details class="row-detail"><summary>Original contributing records</summary><pre>'+esc(pretty(row.source_records))+'</pre></details>':'');
}
function comparisonRows(){
 const row=detailContext?.observationComparison;if(!row)return [];
 const parameter=$('#comparison-parameter').value,station=$('#comparison-station').value,coverage=$('#comparison-coverage').value;
 return row.comparisons.filter(r=>(!parameter||r.parameter===parameter)&&(!station||(r.station_id||r.catchment_id)===station)&&(!coverage||(coverage==='complete')===(r.included_in_metrics===true)));
}
function observationPlot(rows){
 const points=rows.filter(r=>r.included_in_metrics===true&&Number.isFinite(r.observed_annual_mass)&&Number.isFinite(r.modeled_annual_mass));
 if(!points.length)return '<p class="note">Select a complete source-catchment comparison to view the observed-versus-modeled plot.</p>';
 let maximum=1;for(const r of points)maximum=Math.max(maximum,r.observed_annual_mass,r.modeled_annual_mass);
 const maxValue=maximum*1.05,left=85,top=25,size=390,x=v=>left+v/maxValue*size,y=v=>top+size-v/maxValue*size;
 const ticks=Array.from({length:5},(_,i)=>i*maxValue/4),tick=v=>v>=1000000?v.toExponential(2):number(v);
 const grid=ticks.map(v=>'<line x1="'+x(v)+'" y1="'+top+'" x2="'+x(v)+'" y2="'+(top+size)+'" stroke="#dedede"/><line x1="'+left+'" y1="'+y(v)+'" x2="'+(left+size)+'" y2="'+y(v)+'" stroke="#dedede"/><text x="'+x(v)+'" y="'+(top+size+20)+'" text-anchor="middle">'+esc(tick(v))+'</text><text x="'+(left-9)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(tick(v))+'</text>').join('');
 const circles=points.map(r=>'<circle cx="'+x(r.observed_annual_mass)+'" cy="'+y(r.modeled_annual_mass)+'" r="4" fill="#222" fill-opacity=".55" stroke="#fff" stroke-width=".7" tabindex="0"><title>'+esc((r.station_id||r.catchment_id)+'; '+r.period_start+' to '+r.period_end+'; observed '+number(r.observed_annual_mass)+'; modeled '+number(r.modeled_annual_mass)+' '+r.units)+'</title></circle>').join('');
 return '<figure class="observation-plot"><svg viewBox="0 0 525 485" role="img" aria-label="Observed versus modeled annual '+esc(points[0].parameter)+' loads for complete source catchments"><title>Observed versus modeled annual loads</title>'+grid+'<line x1="'+left+'" y1="'+(top+size)+'" x2="'+(left+size)+'" y2="'+top+'" stroke="#555" stroke-dasharray="5 4"/>'+circles+'<text x="'+(left+size/2)+'" y="468" text-anchor="middle">Observed annual mass ('+esc(points[0].units)+')</text><text transform="translate(17 220) rotate(-90)" text-anchor="middle">Modeled annual mass</text></svg><figcaption>'+points.length+' retained station-period comparisons. The dashed line represents equal annual mass. Point details retain each original period; repeated catchments share one selected model estimate.</figcaption></figure>';
}
function renderObservationComparison(){
 const rows=comparisonRows(),complete=rows.filter(r=>r.included_in_metrics===true).length;
 $('#observation-comparison-view').innerHTML='<p class="note">'+rows.length+' matching rows; '+complete+' complete catchments enter the plot and fit statistics. Other native partial totals remain visible below.</p>'+observationPlot(rows)+
 table(['Station / catchment','Original period','Observed annual mass','Modeled annual mass','Full-catchment residual','Whole-catchment coverage','Method / uncertainty'],rows.map(r=>{
   const c=r.spatial_coverage||{},legacy=r.included_in_metrics===undefined;
   const extent=c.raster_extent_coverage_fraction==null?'Not retained in this version':number(c.raster_extent_coverage_fraction*100)+'% of polygon inside raster extent';
   const grid=c.valid_fraction_of_selected_cells==null?'No selected grid cells':number(c.valid_cells)+' valid export cells of '+number(c.selected_cells)+' selected';
   const support=c.native_support_fraction==null?'':number(c.native_support_fraction*100)+'% expected native support; '+number(c.structural_stream_omission_cells)+' original stream omissions; '+number(c.unexpected_missing_cells)+' unexpected missing cells';
   return '<tr><td>'+esc(r.station_id||r.catchment_id)+'<br><small>'+esc(r.catchment_id)+'</small></td><td>'+esc(r.period_start)+'<br>'+esc(r.period_end)+'</td><td>'+number(r.observed_annual_mass)+'<br><small>'+esc(r.units)+'</small></td><td>'+number(r.modeled_annual_mass)+(r.included_in_metrics===false?'<small>Partial native total</small>':'')+'</td><td>'+(r.included_in_metrics===true?number(r.residual):'—')+'</td><td>'+badge(legacy?'legacy':r.coverage_status||'partial')+'<small>'+esc(extent)+'</small><small>'+esc(grid)+'</small>'+(support?'<small>'+esc(support)+'</small>':'')+'<small>'+esc((c.coverage_issues||[]).join('; '))+'</small></td><td>'+observationMethod(r)+'</td></tr>';
 }));
}
function downloadObservationComparison(){
 const selected=comparisonRows(),fields=['observation_id','station_id','catchment_id','parameter','period_start','period_end','period_days','observed_annual_mass','modeled_annual_mass','units','residual','relative_residual','partial_catchment_difference','included_in_metrics','coverage_status','method','uncertainty','source_records','observed_value_text','observed_source_unit','observed_qualifier','spatial_coverage'];
 const cell=value=>'"'+String(value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):value).replaceAll('"','""')+'"';
 const text=[fields.map(cell).join(','),...selected.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download='watershed-observation-comparison-'+short(detailContext.observationComparison.id)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function showTask(id,focus=true){
  const requestedWorkspace=workspace,row=await api(endpoint('/api/task',{id}));if(workspace!==requestedWorkspace)return;
  const body='<div class="meta">'+badge(row.state)+'<span>'+esc(when(row.created_at))+'</span><span>'+row.attempts.length+' retained attempts</span></div>'+(row.error?'<div class="notice error">'+esc(row.error.message)+'</div>':'')+
  (row.result?.workspace_key?'<div class="notice"><strong>Original workspace restored</strong>'+button('workspace-select','Open restored copy','data-id="'+row.result.workspace_key+'"','small')+'</div>':'')+
  (row.action==='spatial.review.export'&&row.result?.id?'<div class="page-actions">'+itemButton('spatial_exports',row.result.id,'Open map pack')+'</div>':'')+
  programmes.taskActions(row)+receivingWaters.taskActions(row)+customerReviews.taskActions(row)+experiments.taskActions(row)+fileList(row._downloads||[])+'<div class="page-actions">'+(['failed','interrupted','cancelled'].includes(row.state)?button('task-resume','Resume original selection','data-id="'+row.id+'"','primary'):'')+(row.state==='queued'?button('task-cancel','Cancel before start','data-id="'+row.id+'"'):'')+'</div><details class="technical" open><summary>Original selected inputs and attempts</summary><pre class="json-view">'+esc(pretty(row))+'</pre></details>';
  detail(actionLabels[row.action]||row.action,body,{kind:'task',id,state:row.state});detailContext.files=row._downloads||[];
  if(focus)$('#detail-body').scrollTop=0;
}

const input=(name,type='text',value='',attrs='')=>'<input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value??'')+'" '+attrs+'>';
const area=(name,value='',attrs='')=>'<textarea name="'+esc(name)+'" '+attrs+'>'+esc(value??'')+'</textarea>';
const field=(label,control,note='',wide=false)=>'<label class="'+(wide?'full':'')+'"><span>'+esc(label)+'</span>'+control+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const select=(name,rows,value='',required=true)=>'<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">Choose…</option>'+rows.map(x=>{const pair=Array.isArray(x)?x:[x.id,x.title||x.name||short(x.id)];return '<option value="'+esc(pair[0])+'" '+(String(pair[0])===String(value??'')?'selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select>';
const checks=(name,rows,chosen=[])=>'<div class="checkbox-list">'+rows.map(row=>'<label class="check"><input type="checkbox" name="'+esc(name)+'" value="'+esc(row.id)+'" '+(chosen.includes(row.id)?'checked':'')+'><span>'+esc(row.title||runTitle(row.id)||short(row.id))+'</span></label>').join('')+'</div>';
const val=(name,root=form)=>root.querySelector('[name="'+name+'"]')?.value??'';
const chosen=(name,root=form)=>$$('[name="'+name+'"]:checked',root).map(x=>x.value);
const num=(name,root=form,optional=false)=>{const text=val(name,root).trim();if(!text&&optional)return undefined;const n=Number(text);if(!text||!Number.isFinite(n))throw Error('Enter a finite value for '+human(name)+'.');return n;};
const lines=text=>text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const sources=()=>state.data.sources;
const collectionDefault=row=>row?.source_collection_id||((sources().length===1)?sources()[0].id:'');
const sourceRows=(collection,kind=null)=>{const edition=sources().find(x=>x.id===collection);return (edition?.entries||[]).filter(x=>!kind||kind.split('|').includes(x.kind));};
const requireSources=()=>{if(!sources().length)throw Error('Import an original source edition first.');};
function setOptions(node,rows,selected=node.value){node.innerHTML=select('_',rows,selected,node.required).replace(/^<select[^>]*>|<\/select>$/g,'');}
function openForm(title,description,html,submit,onSubmit,setup){
  formContext={workspace,operation_id:crypto.randomUUID(),onSubmit,busy:false};
  $('#form-title').textContent=title;$('#form-description').textContent=description;
  $('#form-body').innerHTML=html;$('#form-submit').textContent=submit;
  $('#form-error').hidden=true;$('#form-progress').textContent='';$('#form-submit').disabled=false;
  if(!formDialog.open)formDialog.showModal();
  if(setup)setup();
}
async function submitAction(action,payload){
  if(formContext&&formContext.workspace!==workspace)throw Error('The selected workspace changed. Reopen this form in the intended workspace.');
  const result=await api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:formContext?.operation_id||crypto.randomUUID()}});
  formDialog.close();formContext=null;
  taskPanel=true;$('#task-panel').hidden=false;
  toast((actionLabels[action] || action)+' retained.');
  await refresh({force:true});
  await showTask(result.id);
  return result;
}
async function uploadFile(file){
  if(!file)throw Error('Choose the original file.');
  if(file.size>state.limits.upload_bytes)throw Error('This file is larger than this operator’s configured '+bytes(state.limits.upload_bytes)+' upload capacity.');
  $('#form-progress').textContent='Retaining '+file.name+' ('+bytes(file.size)+')…';
  return api('/api/upload',{method:'POST',raw:file,filename:file.name});
}
function filterEditor(name,value={}){
 return '<fieldset class="full" data-filter="'+esc(name)+'"><legend>Optional exact attribute selection</legend><p class="note">Use original field names and values. Leaving this empty uses the complete selected layer.</p><div data-filter-rows>'+Object.entries(value||{}).map(([key,value])=>filterRow(key,value)).join('')+'</div>'+button('filter-add','Add field selection','','small')+'</fieldset>';
}
function filterRow(name='',value=''){
 const type=value===null?'null':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text';
 return '<div class="repeat-row" data-filter-row>'+field('Field',input('filter_field','text',name,'required'))+field('Type',select('filter_type',[['text','Text'],['number','Number'],['boolean','True / false'],['null','Null']],type))+field('Exact value',input('filter_value','text',value===null?'':String(value)))+button('row-remove','Remove','','small')+'</div>';
}
function readFilter(name,root=form){
 const target=root.querySelector('[data-filter="'+name+'"]'),result={};
 for(const row of $$('[data-filter-row]',target)){
  const key=val('filter_field',row).trim(),type=val('filter_type',row),text=val('filter_value',row);
  if(!key)throw Error('Each selection needs its original field name.');
  if(Object.hasOwn(result,key))throw Error('A field appears twice in the exact selection: '+key);
  let value=text;
  if(type==='number'){value=Number(text);if(!text.trim()||!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error('Use a finite, safely representable number for '+key+'.');}
  if(type==='boolean'){if(!['true','false'].includes(text.toLowerCase()))throw Error('Use true or false for '+key+'.');value=text.toLowerCase()==='true';}
  if(type==='null')value=null;
  result[key]=value;
 }
 return Object.keys(result).length?result:undefined;
}
function vectorSelection(name,label,collection,value={}){
 return '<fieldset class="full" data-vector="'+esc(name)+'"><legend>'+esc(label)+'</legend><div class="form-grid">'+field('Original vector source',select(name+'_source',sourceRows(collection,'vector'),value.source_id))+field('Layer name',input(name+'_layer','text',value.layer||''),'Optional for a source with one layer.')+filterEditor(name,value.where)+'</div></fieldset>';
}
function readVector(name,root=form){const row={source_id:val(name+'_source',root)};const layer=val(name+'_layer',root).trim(),where=readFilter(name,root);if(layer)row.layer=layer;if(where)row.where=where;return row;}
function bindCollection(name,targets,chosenValues={}){
 const node=form.elements.namedItem(name);
 const update=()=>{const collection=node.value;for(const [target,kind] of targets){const el=form.elements.namedItem(target);if(el)setOptions(el,sourceRows(collection,kind),chosenValues[target]??el.value);}chosenValues={};};
 node.addEventListener('change',update);update();
}
function sourceForm(){
 sourcePreview=null;
 const registered=state.registered_sources||[];
 openForm('Import original source data','Preview the original metadata and file selection, then retain the edition in the native workspace.',
 '<div class="form-grid">'+field('Source selection',select('source_mode',[...(registered.length?[['registered','Registered source manifest']]:[]),['archive','Source archive (ZIP)'],['file','Single original table or file']],registered.length?'registered':'archive'))+
 '<div id="source-selection-body" class="full"></div><div id="source-preview" class="full"></div></div>','Preview source',
 async()=>{
  if(sourcePreview)return submitAction('source.import',{preview_id:sourcePreview.id});
  const mode=val('source_mode');let data;
  if(mode==='registered')data={registered_id:val('registered_id')};
  else{
   const uploaded=await uploadFile(form.elements.namedItem('source_file').files[0]);
   data={upload_id:uploaded.id};
   if(mode==='archive'&&val('manifest_member').trim())data.manifest_member=val('manifest_member').trim();
   if(mode==='file'){
    data.file_metadata={title:val('source_title'),uri:val('source_uri'),vintage:val('source_vintage'),kind:val('source_kind')};
    for(const [name,key] of [['source_units','units'],['source_role','role'],['source_layer','layer']])if(val(name).trim())data.file_metadata[key]=val(name).trim();
    data.notes=lines(val('source_notes'));
   }
  }
  sourcePreview=await api('/api/source-preview',{method:'POST',body:data});
  $('#source-preview').innerHTML='<h3 class="subheading">'+esc(sourcePreview.title)+'</h3><p class="note">'+sourcePreview.entries.length+' original sources · manifest <span class="mono">'+esc(short(sourcePreview.manifest_sha256))+'</span></p>'+table(['Source','Kind / role','Original URI','Vintage / units'],sourcePreview.entries.map(x=>'<tr><td>'+esc(x.title)+'<small>'+esc(x.path)+'</small></td><td>'+esc(x.kind)+'<br>'+esc(x.role||'')+'</td><td>'+external(x.uri)+'</td><td>'+esc(x.vintage)+'<br>'+esc(x.units||'')+'</td></tr>'));
  $('#form-submit').textContent='Import this source edition';
  $('#form-progress').textContent='Preview retained. Review the exact source selection before import.';
 },()=>{
  const renderSource=()=>{
   sourcePreview=null;$('#source-preview').innerHTML='';$('#form-submit').textContent='Preview source';
   const mode=val('source_mode');
   $('#source-selection-body').innerHTML=mode==='registered'?field('Registered manifest',select('registered_id',registered.map(x=>[x.id,x.title+' · '+x.entries+' sources'])),'',true):
    '<div class="form-grid">'+field(mode==='archive'?'Original source ZIP':'Original source file',input('source_file','file','','required '+(mode==='archive'?'accept=".zip"':'')),'Files are uploaded as their original bytes.',true)+
    (mode==='archive'?field('Manifest entry, when the ZIP has several manifests',input('manifest_member'),'Optional. Use the exact original relative path.',true):
     field('Title',input('source_title','text','','required'))+field('Original source URI',input('source_uri','url','','required'))+field('Source vintage',input('source_vintage','text','','required'),'Edition, release date or actual observation period.')+field('Kind',select('source_kind',[['table','Table'],['raster','Raster'],['vector','Vector'],['document','Document']],'table'))+field('Units',input('source_units'))+field('Role',input('source_role'),'Optional original source role.')+field('Layer',input('source_layer'))+field('Source notes',area('source_notes'),'One note per line.',true))+'</div>';
  };
  form.elements.namedItem('source_mode').addEventListener('change',renderSource);renderSource();
  form.addEventListener('input',sourceDraftChanged,{once:false});
 });
}
function sourceDraftChanged(event){
 if(formContext?.sourcePreviewLocked)return;
 if(sourcePreview&&event.target.closest('#source-selection-body')){sourcePreview=null;$('#source-preview').innerHTML='';$('#form-submit').textContent='Preview source';}
}
function nativeModels(record){
 const chosen=record?.models??['ndr','sdr'];
 return ['ndr','sdr'].filter(name=>Array.isArray(chosen)&&chosen.includes(name));
}
function nativeModelLabel(record){return nativeModels(record).map(x=>x.toUpperCase()).join(' + ');}
function nativeModelOptions(available=['ndr','sdr']){
 return [['ndr,sdr','NDR + SDR — nutrients and sediment'],['ndr','NDR — nitrogen and phosphorus'],['sdr','SDR — sediment']]
  .filter(([value])=>value.split(',').every(name=>available.includes(name)));
}
function nativeModelFields(value=val('models')){
 const chosen=String(value).split(',').filter(Boolean);
 if(!chosen.length||chosen.some(x=>!['ndr','sdr'].includes(x))||new Set(chosen).size!==chosen.length)throw Error('Select NDR, SDR, or both native models.');
 const models=['ndr','sdr'].filter(name=>chosen.includes(name));
 return models.length===2?{}:{models};
}
function bindNativeModelFields(){
 const control=form.elements.namedItem('models');
 const update=()=>{
  const chosen=control.value.split(',');
  for(const node of $$('[data-native-models]',form)){
   const active=node.dataset.nativeModels.split(' ').some(name=>chosen.includes(name));
   node.hidden=!active;
   for(const input of $$('input,select,textarea,button',node))input.disabled=!active;
  }
 };
 control.addEventListener('change',update);update();
}
function fullNativeRun(row){
 return row?.state==='complete'&&nativeModels(row.selection).length===2&&
  ['ndr','sdr'].every(name=>Object.hasOwn(row.stages||row.stage_summary||{},name))&&
  ['nitrogen_export','phosphorus_export','sediment_export'].every(name=>row.artifacts?.[name]);
}
function nativeOutputCell(row,model,artifact){
 return nativeModels(row.selection).includes(model)?sumCell(row.artifacts?.[artifact]):'<span class="muted">Not selected</span>';
}

async function profileForm(id){
 requireSources();const row=id?await api(endpoint('/api/item',{kind:'profiles',id})):null,collection=collectionDefault(row);
 const parameter=(group,key,label,note='',attrs='')=>field(label,input(group+'_'+key,'number',row?.[group]?.[key]??'','required step="any" '+attrs),note);
 openForm(row?'Revise parameter profile':'New parameter profile','Select the original biophysical table, the native models to calculate and their published parameters. Each saved revision retains the complete original table and its own identity.',
 '<div class="form-grid">'+field('Profile title',input('title','text',row?.title?row.title+' · revision':'','required'),'',true)+
 field('Native models',select('models',nativeModelOptions(),nativeModels(row).join(',')),'NDR uses nutrient coefficients; SDR uses erosion coefficients.',true)+
 field('Source edition',select('collection',sources(),collection))+field('Original biophysical CSV',select('biophysical_source',sourceRows(collection,'table'),row?.biophysical_source_id))+
 field('Published references',area('references',(row?.references||[]).map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n'),'required'),'One source citation or URL per line.',true)+
 field('Model period',input('model_period','text',typeof row?.model_period==='object'?JSON.stringify(row.model_period):row?.model_period||''),'Retain the actual period represented by the selected source data.',true)+
 '<fieldset class="full" data-native-models="ndr"><legend>Nutrient Delivery Ratio</legend><div class="form-grid">'+
 parameter('ndr','threshold_flow_accumulation','Flow accumulation threshold','Pixels.','min="0"')+parameter('ndr','k_param','Connectivity k','Positive native parameter.','min="0"')+
 field('Flow direction',select('ndr_flow_dir_algorithm',[['mfd','Multiple flow direction'],['d8','D8']],row?.ndr?.flow_dir_algorithm))+
 parameter('ndr','subsurface_critical_length_n','Nitrogen subsurface critical length','Metres.','min="0"')+parameter('ndr','subsurface_eff_n','Nitrogen subsurface retention efficiency','Fraction from 0 to 1.','min="0" max="1"')+
 field('Runoff proxy average',input('ndr_runoff_proxy_av','number',row?.ndr?.runoff_proxy_av??'','step="any" min="0"'),'Optional original native override.')+'</div></fieldset>'+
 '<fieldset class="full" data-native-models="sdr"><legend>Sediment Delivery Ratio</legend><div class="form-grid">'+
 parameter('sdr','threshold_flow_accumulation','Flow accumulation threshold','Pixels.','min="0"')+parameter('sdr','k_param','Connectivity k','Positive native parameter.','min="0"')+
 field('Flow direction',select('sdr_flow_dir_algorithm',[['mfd','Multiple flow direction'],['d8','D8']],row?.sdr?.flow_dir_algorithm))+
 parameter('sdr','sdr_max','Maximum SDR','Fraction from 0 to 1.','min="0" max="1"')+parameter('sdr','ic_0_param','Connectivity midpoint')+parameter('sdr','l_max','Maximum RUSLE L-factor','Dimensionless.','min="0"')+'</div></fieldset>'+
 field('Notes',area('notes',(row?.notes||[]).join('\n')),'One note per line.',true)+'</div>','Save immutable profile',()=>{
  const modelFields=nativeModelFields(),active=nativeModels(modelFields),parameters={};
  if(active.includes('ndr')){
   const ndr={};for(const k of ['threshold_flow_accumulation','k_param','subsurface_critical_length_n','subsurface_eff_n'])ndr[k]=num('ndr_'+k);
   ndr.flow_dir_algorithm=val('ndr_flow_dir_algorithm');
   const runoff=num('ndr_runoff_proxy_av',form,true);if(runoff!==undefined)ndr.runoff_proxy_av=runoff;
   parameters.ndr=ndr;
  }
  if(active.includes('sdr')){
   const sdr={};for(const k of ['threshold_flow_accumulation','k_param','sdr_max','ic_0_param','l_max'])sdr[k]=num('sdr_'+k);
   sdr.flow_dir_algorithm=val('sdr_flow_dir_algorithm');parameters.sdr=sdr;
  }
  return submitAction('profile.save',{title:val('title'),source_collection_id:val('collection'),biophysical_source_id:val('biophysical_source'),references:lines(val('references')),...modelFields,...parameters,model_period:val('model_period'),notes:lines(val('notes'))});
 },()=>{bindCollection('collection',[['biophysical_source','table']],{biophysical_source:row?.biophysical_source_id});bindNativeModelFields();});
}
async function gridForm(id){
 requireSources();const original=id?await api(endpoint('/api/item',{kind:'grids',id})):null,row=original?.spec,collection=collectionDefault(row);
 const rasterRoles=[['DEM','Elevation model','ndr sdr'],['NLCD','Original land cover','ndr sdr'],['PRECIPITATION','Precipitation','ndr'],['R_FACTOR','Rainfall erosivity','sdr'],['K_FACTOR','Soil erodibility','sdr']];
 const canReuse=original?.state==='complete',originalResolution=original?.grid?.resolution_m??row?.resolution_m??30;
 openForm(row?'Extend or revise native grid':'Prepare native model grid','Choose the native models and their original sources, reporting area and upstream context. A completed grid can supply its exact common inputs when the remaining model sources arrive.',
 '<div class="form-grid">'+field('Grid title',input('title','text',row?.title?row.title+' · revision':'','required'))+field('Source edition',select('collection',sources(),collection))+
 field('Native models',select('models',nativeModelOptions(),nativeModels(row).join(',')),'NDR requires elevation, land cover and precipitation. SDR requires elevation, land cover, rainfall erosivity and soil erodibility.',true)+
 field('Native cell size',input('resolution','number',row?.resolution_m??originalResolution,'required min="0" step="any"'),'Metres per square cell. Match the original projected land-cover grid; 30 m is the Upper Savannah default.')+
 (canReuse?'<label class="full"><span>Reuse original grid preparation</span><span><input name="reuse_original_grid" type="checkbox" checked> Carry completed common files from '+esc(short(original.id))+'</span><small>Keep the original cell size, geometry, source selections and context buffer to reuse them. Clear this choice when changing the physical grid. New input roles are prepared in the new grid.</small></label>':'')+
 rasterRoles.map(([key,label,models])=>field(label,select('raster_'+key,sourceRows(collection,'raster'),row?.input_sources?.[key])).replace('<label','<label data-native-models="'+models+'"')).join('')+
 field('Upstream context buffer',input('buffer','number',row?.upstream_buffer_m??'','required min="0.01" max="999999" step="any"'),'Metres. The model domain must cover the selected reporting area.')+
 vectorSelection('reporting','Reporting boundary',collection,row?.reporting_area)+vectorSelection('domain','Hydrologic model domain',collection,row?.model_domain)+'</div>',
 'Prepare original grid',()=>{
  const modelFields=nativeModelFields(),active=nativeModels(modelFields),input_sources={},resolution=num('resolution');
  if(resolution<=0)throw Error('Enter a positive native cell size in metres that matches the original land-cover grid.');
  for(const [key,,models]of rasterRoles)if(models.split(' ').some(name=>active.includes(name)))input_sources[key]=val('raster_'+key);
  const selection={title:val('title'),source_collection_id:val('collection'),...modelFields,input_sources,reporting_area:readVector('reporting'),model_domain:readVector('domain'),upstream_buffer_m:num('buffer')};
  if(row?.resolution_m!==undefined||resolution!==30)selection.resolution_m=resolution;
  if(canReuse&&form.elements.namedItem('reuse_original_grid')?.checked){
   if(resolution!==Number(originalResolution))throw Error('A different native cell size needs a new grid preparation. Clear Reuse original grid preparation, then select the matching original land-cover source.');
   selection.base_grid_id=original.id;
  }
  return submitAction('grid.prepare',selection);
 },()=>{bindCollection('collection',[...rasterRoles.map(([key])=>['raster_'+key,'raster']),['reporting_source','vector'],['domain_source','vector']]);bindNativeModelFields();});
}
function patchRow(collection,row={}){
 return '<fieldset class="patch" data-patch><div class="patch-header"><legend>Land-cover change</legend>'+button('row-remove','Remove change','','small')+'</div><div class="form-grid">'+
 field('Original polygon mask',select('mask_source',sourceRows(collection,'vector'),row.mask_source_id))+field('Layer name',input('mask_layer','text',row.layer||''),'Optional for a source with one layer.')+
 field('Original land-cover codes',input('from_codes','text',(row.from_codes||[]).join(', '),'required'),'Separate the exact integer codes with commas.')+field('Replacement land-cover code',input('to_code','number',row.to_code??'','required step="1"'))+
 field('Reason for this change',area('patch_reason',row.reason||'','required'),'',true)+filterEditor('patch',row.where)+'</div></fieldset>';
}
async function scenarioForm(id){
 requireSources();const row=id?await api(endpoint('/api/item',{kind:'scenarios',id})):null,collection=collectionDefault(row);
 openForm(row?'Revise land-cover scenario':'New land-cover scenario','Keep an unchanged baseline or define explicit changes using original polygon masks and land-cover codes. The model records the scenario separately from the source data.',
 '<div class="form-grid">'+field('Scenario title',input('title','text',row?.title?row.title+' · revision':'','required'))+field('Scenario type',select('kind',[['baseline','Unchanged source baseline'],['landcover','Explicit land-cover changes']],row?.kind||'baseline'))+
 field('Original source edition',select('collection',sources(),collection))+field('Scenario reason',area('reason',row?.reason||'','required'),'',true)+
 '<div class="full" id="scenario-patches"><div id="patch-list">'+(row?.patches||[]).map(x=>patchRow(collection,x)).join('')+'</div>'+button('patch-add','Add land-cover change','','small')+'</div></div>',
 'Save immutable scenario',()=>{
  const kind=val('kind'),patches=[];
  if(kind==='landcover')for(const node of $$('[data-patch]',form)){
   const codes=val('from_codes',node).split(',').map(x=>x.trim());
   if(!codes.length||codes.some(x=>!x||!Number.isSafeInteger(Number(x))))throw Error('Enter the exact original integer land-cover codes.');
   const to=num('to_code',node);if(!Number.isSafeInteger(to))throw Error('The replacement land-cover code must be an integer.');
   const patch={mask_source_id:val('mask_source',node),from_codes:codes.map(Number),to_code:to,reason:val('patch_reason',node)};
   const layer=val('mask_layer',node).trim(),where=readFilter('patch',node);if(layer)patch.layer=layer;if(where)patch.where=where;patches.push(patch);
  }
  if(kind==='landcover'&&!patches.length)throw Error('Add at least one actual land-cover change.');
  return submitAction('scenario.save',{title:val('title'),kind,source_collection_id:val('collection'),reason:val('reason'),patches});
 },()=>{
  const update=()=>{const visible=val('kind')==='landcover';$('#scenario-patches').hidden=!visible;for(const el of $$('input,select,textarea', $('#scenario-patches')))el.disabled=!visible;};
  form.elements.namedItem('kind').addEventListener('change',update);
  form.elements.namedItem('collection').addEventListener('change',()=>{for(const el of $$('[name="mask_source"]',form))setOptions(el,sourceRows(val('collection'),'vector'));});
  update();
 });
}
function runForm(){
 const grids=state.data.grids.filter(x=>x.state==='complete').map(x=>({id:x.id,title:(x.spec.title||'Model grid')+' · '+nativeModelLabel(x.spec)})),profiles=state.data.profiles.map(x=>({id:x.id,title:x.title+' · '+nativeModelLabel(x)})),scenarios=state.data.scenarios;
 if(!grids.length||!profiles.length||!scenarios.length)throw Error('Prepare a model grid, an original parameter profile and a scenario before selecting a native run.');
 openForm('Prepare native model run','Bind the actual grid, parameter table, scenario and selected InVEST models. Start the retained run after reviewing that selection.',
 '<div class="form-grid">'+field('Prepared model grid',select('grid',grids))+
 field('Parameter profile',select('profile',profiles))+field('Land-cover scenario',select('scenario',scenarios))+
 field('Native models',select('models',[]),'The choices use models present in both the prepared grid and selected profile.')+
 '<p id="run-model-readiness" class="note full">Choose the grid and profile to see their available models.</p>'+
 '<p class="note full">Each native stage retains its actual arguments, engine source, logs and original outputs. Resuming uses completed stages. An exact stage from another retained run can also be reused with its original provenance.</p></div>','Prepare retained run',
 ()=>submitAction('run.prepare',{grid_id:val('grid'),profile_id:val('profile'),scenario_id:val('scenario'),...nativeModelFields()}),
 ()=>{
  const update=()=>{
   const grid=state.data.grids.find(x=>x.id===val('grid')),profile=state.data.profiles.find(x=>x.id===val('profile'));
   const available=grid&&profile?nativeModels(grid.spec).filter(x=>nativeModels(profile).includes(x)):[];
   const node=form.elements.namedItem('models'),previous=node.value.split(',');
   const selected=previous.length&&previous.every(x=>available.includes(x))?node.value:available.join(',');
   setOptions(node,nativeModelOptions(available),selected);
   $('#run-model-readiness').textContent=!grid||!profile?'Choose the grid and profile to see their available models.':available.length?'Ready to calculate '+available.map(x=>x.toUpperCase()).join(' and ')+'.':'These selections have no native model in common. Select a matching profile or extend the prepared grid.';
  };
  form.elements.namedItem('grid').addEventListener('change',update);form.elements.namedItem('profile').addEventListener('change',update);update();
 });
}
function completedModelStage(row,model){
 const stage=row?.stages?.[model]||row?.stage_summary?.[model];
 return stage?.completed_at&&(stage.file_count??Object.keys(stage.files||{}).length)>0?stage:null;
}
function completedModelSources(target,model){
 const rows=(state?.data?.runs||[]).filter(row=>nativeModels(row.selection).includes(model)&&
  !['running','queued'].includes(row.state)&&completedModelStage(row,model));
 const rank=row=>(row.selection.scenario_id===target.selection.scenario_id?4:0)+
  (row.selection.grid_id===target.selection.grid_id?2:0)+
  (row.selection.profile_id===target.selection.profile_id?1:0);
 return rows.slice().sort((a,b)=>rank(b)-rank(a)||
  String(completedModelStage(b,model).completed_at).localeCompare(String(completedModelStage(a,model).completed_at))||
  a.id.localeCompare(b.id));
}
function canSelectCompletedModels(row){
 return ['prepared','failed'].includes(row?.state)&&nativeModels(row.selection).length===2&&
  ['ndr','sdr'].every(model=>completedModelSources(row,model).length);
}
function completedModelOrigins(row){
 if(!row.assembly?.models)return '';
 const rows=['ndr','sdr'].filter(model=>row.assembly.models[model]).map(model=>{
  const entry=row.assembly.models[model],stage=row.stages?.[model]||{};
  const source=entry.source_run_id||stage.reused_from?.run_id||row.id;
  const original=(state?.data?.runs||[]).find(value=>value.id===source);
  const selection=entry.source_selection||original?.selection;
  return '<tr><td>'+esc(model.toUpperCase())+'</td><td>'+esc(runTitle(source))+
   '<small class="mono">'+esc(short(source))+'</small></td><td>'+
   esc(selection?named('grids',selection.grid_id):'Retained original stage')+'</td><td>'+
   esc(selection?named('profiles',selection.profile_id):'Retained original stage')+
   '</td><td>'+number(entry.input_matches?.length||0)+' matched inputs</td><td>'+
   (original?itemButton('runs',source):'')+'</td></tr>';
 });
 return '<h3>Original completed models</h3><p class="note">This run retains the selected original model results and their matching input records.</p>'+
  table(['Model','Original run','Grid','Parameters','Inputs',''],rows);
}
async function completedModelsForm(id){
 const selectedWorkspace=workspace;
 const target=await api(endpoint('/api/item',{kind:'runs',id}));
 if(workspace!==selectedWorkspace)return;
 if(!['prepared','failed'].includes(target.state)||nativeModels(target.selection).length!==2)
  throw Error('Choose a prepared combined NDR and SDR run.');
 const candidates={ndr:completedModelSources(target,'ndr'),sdr:completedModelSources(target,'sdr')};
 if(!candidates.ndr.length||!candidates.sdr.length)
  throw Error('Complete the original NDR and SDR calculations before selecting their retained results.');
 const options=model=>candidates[model].map(row=>({id:row.id,
  title:runTitle(row.id)+' · '+named('grids',row.selection.grid_id)+' · '+short(row.id)}));
 detailDialog.close();
 openForm('Use completed models','Choose the original completed NDR and SDR calculations for this prepared combined run. The native operation checks their actual inputs, retains both results and completes the combined reporting outputs.',
 '<div class="form-grid"><div class="full">'+defs({combined_run:short(target.id),
  grid:named('grids',target.selection.grid_id),profile:named('profiles',target.selection.profile_id),
  scenario:named('scenarios',target.selection.scenario_id)})+'</div>'+
 field('Original completed NDR run',select('source_ndr',options('ndr'),candidates.ndr[0].id),
  'Nitrogen and phosphorus results.',true)+
 field('Original completed SDR run',select('source_sdr',options('sdr'),candidates.sdr[0].id),
  'Sediment results. A completed run containing both models can supply both selections.',true)+
 '<div id="completed-model-selection" class="full"></div>'+
 '<p class="note full">The original terrain, land cover, scenario changes, biophysical table and model parameters must match this combined run. The retained native operation checks the selected files and reports any input difference in the same task.</p></div>',
 'Use results and complete run',()=>{
  const source_runs={ndr:val('source_ndr'),sdr:val('source_sdr')};
  if(!['ndr','sdr'].every(model=>candidates[model].some(row=>row.id===source_runs[model])))
   throw Error('Choose the original completed source run for each model.');
  return submitAction('run.start',{run_id:target.id,source_runs});
 },()=>{
  const update=()=>{
   const rows=['ndr','sdr'].map(model=>{
    const row=candidates[model].find(item=>item.id===val('source_'+model));
    if(!row)return '';
    return '<tr><td>'+esc(model.toUpperCase())+'</td><td>'+esc(named('scenarios',row.selection.scenario_id))+
     '</td><td>'+esc(named('grids',row.selection.grid_id))+'</td><td>'+
     esc(named('profiles',row.selection.profile_id))+'</td><td>'+
     esc(when(completedModelStage(row,model)?.completed_at))+'</td></tr>';
   });
   $('#completed-model-selection').innerHTML=table(['Model','Scenario','Grid','Parameters','Completed'],rows);
  };
  form.elements.namedItem('source_ndr').addEventListener('change',update);
  form.elements.namedItem('source_sdr').addEventListener('change',update);update();
 });
}
function compareForm(){
 const complete=state.data.runs.filter(x=>x.state==='complete');
 if(complete.length<2)throw Error('Complete a baseline and at least one alternative on the same model grid.');
 openForm('Compare completed native runs','Choose runs on the same grid with at least one common native model. Signed differences retain the actual shared pollutants and exact run identities.',
 '<div class="form-grid">'+field('Baseline run',select('baseline',complete.map(x=>[x.id,runTitle(x.id)])),'',true)+'<fieldset class="full"><legend>Alternatives on the same grid</legend><div id="compare-alternatives"></div></fieldset></div>','Compare original runs',
 ()=>{
  const other=chosen('alternatives');if(!other.length)throw Error('Select at least one completed alternative.');
  const ids=[val('baseline'),...other],runs=ids.map(id=>complete.find(x=>x.id===id));
  if(runs.some(x=>!x)||!['ndr','sdr'].some(model=>runs.every(x=>nativeModels(x.selection).includes(model))))throw Error('Choose a cohort sharing NDR, SDR, or both native models.');
  return submitAction('run.compare',{run_ids:ids});
 },
 ()=>{
  const update=()=>{
   const baseline=complete.find(x=>x.id===val('baseline'));
   $('#compare-alternatives').innerHTML=baseline?checks('alternatives',complete.filter(x=>x.id!==baseline.id&&x.selection.grid_id===baseline.selection.grid_id&&nativeModels(x.selection).some(model=>nativeModels(baseline.selection).includes(model))).map(x=>({id:x.id,title:runTitle(x.id)}))):'<p class="note">Choose the baseline first.</p>';
  };
  form.elements.namedItem('baseline').addEventListener('change',update);update();
 });
}
function columnControl(key,requiredField=false){
 return field(human(key),'<select name="column_'+esc(key)+'" '+(requiredField?'required':'')+'><option value="">Choose a CSV field…</option></select>',requiredField?'Required original column.':'Optional original column.');
}
function csvHeader(text){
 const result=[];let value='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){result.push(value);value='';}
  else if((c==='\n'||c==='\r')&&!quoted){result.push(value);return result;}
  else value+=c;
 }
 if(quoted)throw Error('The CSV header exceeds the preview window or contains an unfinished quoted field.');
 if(value||result.length)result.push(value);
 return result;
}
function parameterRow(from='',to='nitrogen'){
 return '<div class="repeat-row" data-parameter-row>'+field('Original parameter label',input('parameter_from','text',from,'required'))+field('Native annual-load parameter',select('parameter_to',[['nitrogen','Nitrogen'],['phosphorus','Phosphorus'],['sediment','Sediment']],to))+button('row-remove','Remove','','small')+'</div>';
}
function observationForm(){
 const keys=['record_id','station_id','catchment_id','parameter','value','unit','period_start','period_end','qualifier','method','uncertainty','source_records'];
 openForm('Import original water-quality observations','Keep every original CSV row and its source provenance. The native comparison admits explicitly derived annual N/P/sediment mass rates; other measurements remain available as context.',
 '<div class="form-grid">'+field('Original observation CSV',input('observation_file','file','','required accept=".csv,text/csv"'),'The complete original file is retained.',true)+
  field('Prepared source-method JSON',input('observation_metadata','file','','accept=".json,application/json"'),'Optional. Loads the original source, annualization, column mapping and qualifier choices; its exact bytes stay with the edition.',true)+
 field('Observation title',input('title','text','','required'))+field('Original source URI',input('source_uri','url','','required'))+
 field('Measurement basis',select('basis',[['context','Original contextual measurements'],['annual_mass_rate','Derived annual mass-rate observations']],'context'))+
 field('Original annualization method',area('annualization_method'),'Required for derived annual loads; retain the source method, period and assumptions.',true)+
 field('Fallback period start',input('period_start','date'))+field('Fallback period end',input('period_end','date'),'Used when those period columns are absent.')+
 '<fieldset class="full"><legend>Original CSV columns</legend><p class="note" id="csv-header-note">Choose the original CSV to inspect its actual header.</p><div class="form-grid three">'+keys.map(k=>columnControl(k,['catchment_id','parameter','value','unit'].includes(k))).join('')+'</div></fieldset>'+
 '<fieldset class="full"><legend>Original parameter labels</legend><p class="note">The native names nitrogen, phosphorus and sediment already match. Map other exact source labels when they represent those same annual mass-rate parameters.</p><div id="parameter-rows"></div>'+button('parameter-add','Map an original label','','small')+'</fieldset>'+
 '<fieldset class="full"><legend>Accepted source qualifiers</legend><label class="check"><input name="blank_qualifier" type="checkbox" checked><span>Accept an empty source qualifier</span></label>'+field('Other accepted exact qualifiers',area('qualifiers'),'One original qualifier per line. Unselected qualifiers remain retained as context.',true)+'</fieldset></div>',
 'Retain original observations',async()=>{
  if(formContext.observationMetadataLoading)throw Error('The source-method document is still loading.');
   if(formContext.observationMetadataError)throw Error(formContext.observationMetadataError);
   const uploaded=await uploadFile(form.elements.namedItem('observation_file').files[0]),columns={},parameter_mapping={};
  for(const key of keys)if(val('column_'+key))columns[key]=val('column_'+key);
  for(const node of $$('[data-parameter-row]',form)){
   const key=val('parameter_from',node).trim();if(Object.hasOwn(parameter_mapping,key))throw Error('An original parameter label is mapped twice.');parameter_mapping[key]=val('parameter_to',node);
  }
  const metadata={...(formContext.observationMetadata||{}),title:val('title'),source_uri:val('source_uri'),value_basis:val('basis'),annualization_method:val('annualization_method'),columns,parameter_mapping,accepted_qualifiers:[...(form.elements.namedItem('blank_qualifier').checked?['']:[]),...lines(val('qualifiers'))]};
  if(val('period_start'))metadata.period_start=val('period_start');else delete metadata.period_start;if(val('period_end'))metadata.period_end=val('period_end');else delete metadata.period_end;
   if(formContext.observationMetadataFile)metadata.source_metadata_document=formContext.observationMetadataFile;
  if(metadata.value_basis==='annual_mass_rate'&&!metadata.annualization_method.trim())throw Error('Describe the original method that produced the annual mass-rate values.');
  return submitAction('observation.import',{upload_id:uploaded.id,metadata});
 },()=>{
  form.elements.namedItem('basis').addEventListener('change',()=>form.elements.namedItem('annualization_method').required=val('basis')==='annual_mass_rate');
   form.elements.namedItem('observation_metadata').addEventListener('change',async()=>{
    const context=formContext,token=crypto.randomUUID();context.observationMetadataToken=token;context.observationMetadataLoading=true;context.observationMetadataError=null;
    const current=()=>formContext===context&&context.observationMetadataToken===token;
    try{
     const file=form.elements.namedItem('observation_metadata').files[0];
     if(!file){context.observationMetadata=null;context.observationMetadataFile=null;return;}
     if(file.size>1024*1024)throw Error('Use a source-method JSON of at most 1 MiB; the original data CSV is selected separately.');
     const data=new Uint8Array(await file.arrayBuffer());if(!current())return;
     const value=JSON.parse(new TextDecoder().decode(data));
     if(!value||typeof value!=='object'||Array.isArray(value))throw Error('The source-method file must contain an observation metadata object.');
     for(const key of ['title','source_uri','annualization_method','period_start','period_end'])if(value[key]!==undefined){if(typeof value[key]!=='string')throw Error('Source metadata '+key+' must be text.');}
     if(value.value_basis!==undefined){if(!['context','annual_mass_rate'].includes(value.value_basis))throw Error('The source method must declare context or annual_mass_rate.');}
     if(value.columns!==undefined&&(!value.columns||typeof value.columns!=='object'||Array.isArray(value.columns)||Object.values(value.columns).some(v=>typeof v!=='string')))throw Error('Original column mappings must use source field names.');
     if(value.parameter_mapping!==undefined&&(!value.parameter_mapping||typeof value.parameter_mapping!=='object'||Array.isArray(value.parameter_mapping)||Object.values(value.parameter_mapping).some(v=>!['nitrogen','phosphorus','sediment'].includes(v))))throw Error('Original parameter mappings must select nitrogen, phosphorus or sediment.');
     if(value.accepted_qualifiers!==undefined&&(!Array.isArray(value.accepted_qualifiers)||value.accepted_qualifiers.some(v=>typeof v!=='string')))throw Error('Accepted qualifiers must be exact source strings.');
     let binary='';for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('');
     if(!current())return;
     for(const key of ['title','source_uri','annualization_method','period_start','period_end'])if(value[key]!==undefined)form.elements.namedItem(key).value=value[key];
     if(value.value_basis!==undefined)form.elements.namedItem('basis').value=value.value_basis;
     context.observationMetadata=value;context.observationMetadataFile={filename:file.name,bytes:data.length,sha256:hash,encoding:'base64',content:btoa(binary)};
     if(value.parameter_mapping)$('#parameter-rows').innerHTML=Object.entries(value.parameter_mapping).map(([from,to])=>parameterRow(from,to)).join('');
     if(value.accepted_qualifiers){form.elements.namedItem('blank_qualifier').checked=value.accepted_qualifiers.includes('');form.elements.namedItem('qualifiers').value=value.accepted_qualifiers.filter(Boolean).join('\n');}
     if(formContext.observationHeaders)for(const key of keys){const selected=value.columns?.[key]??key;setOptions(form.elements.namedItem('column_'+key),formContext.observationHeaders.map(x=>[x,x]),formContext.observationHeaders.includes(selected)?selected:'');}
     form.elements.namedItem('annualization_method').required=val('basis')==='annual_mass_rate';
     $('#form-error').hidden=true;
    }catch(error){if(current()){context.observationMetadata=null;context.observationMetadataFile=null;context.observationMetadataError=error.message;$('#form-error').textContent=error.message;$('#form-error').hidden=false;}}
    finally{if(current())context.observationMetadataLoading=false;}
   });
  form.elements.namedItem('observation_file').addEventListener('change',async()=>{
   try{
    const file=form.elements.namedItem('observation_file').files[0];if(!file)return;
    const headers=csvHeader(await file.slice(0,256*1024).text());
    if(!headers.length||new Set(headers).size!==headers.length)throw Error('The original CSV header is empty or repeats a column name.');
    formContext.observationHeaders=headers;
     for(const key of keys){const selected=formContext.observationMetadata?.columns?.[key]??key;setOptions(form.elements.namedItem('column_'+key),headers.map(x=>[x,x]),headers.includes(selected)?selected:'');}
    $('#csv-header-note').textContent=headers.length+' original CSV fields: '+headers.join(', ');
   }catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}
  });
 });
}
function observationCompareForm(id){
 requireSources();const complete=state.data.runs.filter(x=>x.state==='complete'),observations=state.data.observations;
 if(!complete.length||!observations.length)throw Error('Complete a native model run and retain the original observation CSV first.');
 const collection=collectionDefault();
 openForm('Compare original annual loads','Aggregate the actual native model output over each full source catchment and preserve modeled-versus-observed residuals, coverage and excluded contextual records.',
 '<div class="form-grid">'+field('Completed native run',select('run',complete.map(x=>[x.id,runTitle(x.id)])))+
 field('Original observation edition',select('observation',observations.map(x=>[x.id,x.metadata.title]),id||''))+
 field('Catchment source edition',select('collection',sources(),collection))+
 field('Original catchment ID field',input('id_field','text','','required'),'Must match the catchment identifiers in the original observations.')+
 vectorSelection('catchments','Original catchment boundaries',collection)+
 '<div class="full">'+button('inspect-form-vector','Inspect native catchment fields','data-vector="catchments" data-collection="collection"','small')+'</div></div>',
 'Compare observed annual loads',()=>submitAction('observation.compare',{run_id:val('run'),observation_id:val('observation'),catchments:{source_collection_id:val('collection'),id_field:val('id_field'),...readVector('catchments')}}),
 ()=>bindCollection('collection',[['catchments_source','vector']]));
}
function deliverySource(name,label,choice={},requiredField=true,withFilters=false){
 const collection=choice.source_collection_id||collectionDefault(),source=choice.source_id||'';
 return '<fieldset class="full" data-delivery-source="'+esc(name)+'"><legend>'+esc(label)+'</legend>'+
 (!requiredField?'<label class="check"><input type="checkbox" name="'+esc(name)+'_enabled" '+(source?'checked':'')+'><span>Include this original overlay</span></label>':'')+
 '<div class="form-grid" data-source-fields>'+field('Source edition',select(name+'_collection',sources(),collection,requiredField))+
 field('Original source',select(name+'_source',sourceRows(collection,withFilters?'vector':null),source,requiredField))+
 (withFilters?field('Native layer name',input(name+'_layer','text',choice.layer||''),'Optional for a source with one layer.')+filterEditor(name,choice.where):'')+'</div></fieldset>';
}
function bindDeliverySource(name,requiredField,withFilters){
 const node=form.querySelector('[data-delivery-source="'+name+'"]'),collection=form.elements.namedItem(name+'_collection');
 collection.addEventListener('change',()=>setOptions(form.elements.namedItem(name+'_source'),sourceRows(collection.value,withFilters?'vector':null)));
 if(!requiredField){
  const update=()=>{const enabled=form.elements.namedItem(name+'_enabled').checked;for(const el of $$('[data-source-fields] input,[data-source-fields] select,[data-source-fields] textarea,[data-source-fields] button',node)){el.disabled=!enabled;if(el.name===name+'_collection'||el.name===name+'_source')el.required=enabled;}};
  form.elements.namedItem(name+'_enabled').addEventListener('change',update);update();
 }
}
function readDeliverySource(name,requiredField=true,withFilters=false){
 if(!requiredField&&!form.elements.namedItem(name+'_enabled').checked)return null;
 const row={source_collection_id:val(name+'_collection'),source_id:val(name+'_source')};
 if(withFilters){const layer=val(name+'_layer').trim(),where=readFilter(name);if(layer)row.layer=layer;if(where)row.where=where;}
 return row;
}
async function deliveryForm(id,initialSelection){
 requireSources();const saved=id?await api(endpoint('/api/item',{kind:'deliveries',id})):null,row=saved?.selection||initialSelection;
 const complete=state.data.runs.filter(fullNativeRun);
 if(complete.length<2)throw Error('Complete both NDR and SDR for the original baseline and at least one alternative before assembling the seven-map delivery.');
 const roles=[['PROTECTED_LANDS','Protected-lands source'],['PARCEL','Original parcel source'],['NHD','National Hydrography Dataset source'],['NWI','National Wetlands Inventory source']];
 const overlays=[['drinking_water','Critical drinking-water source boundaries',true],['high_quality_waters','Designated high-quality waters',true],['protected_lands','Protected-lands cartographic overlay',false],['parcels','Parcel priority inventory and GIS export',false]];
 const settings=row?.map_settings||{},weights=settings.weights||{};
 openForm(saved?'Revise complete map delivery':'Build complete seven-map delivery','Join the completed native baseline and alternatives with original water designations and supporting source data. The existing delivery engine writes the physical rasters, PDFs, report, metadata, parcel inventory when selected, and a restorable scientific workspace.',
 '<div class="form-grid">'+field('Delivery title',input('title','text',row?.title||'','required'),'',true)+
 field('Completed baseline run',select('baseline',complete.map(x=>[x.id,runTitle(x.id)]),row?.baseline_run_id),'',true)+
 '<fieldset class="full"><legend>Completed alternatives on the same grid</legend><div id="delivery-alternatives"></div></fieldset>'+
 receivingWaters.deliveryFields(row||{})+
 '<h3 class="subheading full">Actual supporting source editions</h3><p class="note full">The five modeled raster sources and computed LS factor come from the selected original run. Choose these additional original sources for the delivery lineage.</p>'+
 roles.map(([key,label])=>deliverySource('role_'+key,label,row?.source_roles?.[key])).join('')+
 '<h3 class="subheading full">Source-backed cartography and parcel priority</h3>'+
 overlays.map(([key,label,requiredField])=>deliverySource('overlay_'+key,label,row?.overlays?.[key],requiredField,true)).join('')+
 '<h3 class="subheading full">Combined export priority</h3><p class="note full">The original engine normalizes actual export values against each pollutant’s positive-cell 95th percentile unless an explicit cap is supplied. Weights are recorded in the retained delivery.</p>'+
 ['nitrogen_export','phosphorus_export','sediment_export'].map(key=>field(human(key)+' weight',input('weight_'+key,'number',weights[key]??1,'required min="0" step="any"'))).join('')+
 ['nitrogen_export','phosphorus_export','sediment_export'].map(key=>field(human(key)+' cap',input('cap_'+key,'number',settings.caps?.[key]??'','min="0" step="any"'),'Optional positive cap in the actual export raster units.')).join('')+
 field('Map resolution',input('dpi','number',settings.dpi??200,'required min="72" max="600" step="1"'),'PDF rendering DPI; native analytical grids are unchanged.')+
 field('Map title',input('map_title','text',settings.title||''),'Optional title for the original map layouts.')+
 '<fieldset class="full"><legend>Retained observed-load comparisons</legend>'+checks('observation_comparisons',(state.data.observation_comparisons||[]).map(x=>({id:x.id,title:named('observations',x.observation_id)+' · '+runTitle(x.run_id)})),row?.observation_comparison_ids||[])+'</fieldset>'+
 '<fieldset class="full"><legend>Saved spatial review views</legend>'+checks('spatial_reviews',(state.data.spatial_reviews||[]).map(x=>({id:x.id,title:x.title})),row?.spatial_review_ids||[])+'<p class="note">Selected views carry their original sources, filters, markers, viewport and interpretation as working project assets.</p></fieldset>'+
 '<fieldset class="full"><legend>Printable map packs</legend>'+checks('spatial_exports',(state.data.spatial_exports||[]).filter(x=>x.state==='complete').map(x=>({id:x.id,title:x.title})),row?.spatial_export_ids||[])+'<p class="note">Include the retained PDF, vector and raster figures, annotations and complete map pack. Their original saved reviews are included with the delivery.</p></fieldset>'+
 '<h3 class="subheading full">Delivery contact and interpretation</h3>'+field('Contact name',input('contact_name','text',row?.contact?.name||'','required'))+
 field('Organization',input('contact_organization','text',row?.contact?.organization||'','required'))+field('Email',input('contact_email','email',row?.contact?.email||'','required'))+
 field('Delivery notes',area('notes',(row?.notes||[]).join('\n')),'One original interpretation or delivery note per line.',true)+'</div>',
 'Build complete original delivery',()=>{
  const alternatives=chosen('alternatives');if(!alternatives.length)throw Error('Select at least one completed alternative on the baseline grid.');
  const source_roles={},selectedOverlays={},weights={},caps={};
  for(const [key]of roles)source_roles[key]=readDeliverySource('role_'+key);
  for(const [key,,requiredField]of overlays){const x=readDeliverySource('overlay_'+key,requiredField,true);if(x)selectedOverlays[key]=x;}
  for(const key of ['nitrogen_export','phosphorus_export','sediment_export']){
   weights[key]=num('weight_'+key);const cap=num('cap_'+key,form,true);if(cap!==undefined){if(cap<=0)throw Error('A priority cap must be positive.');caps[key]=cap;}
  }
  if(Object.values(weights).every(x=>x===0))throw Error('At least one pollutant weight must be positive.');
  const map_settings={weights,dpi:num('dpi')};if(Object.keys(caps).length)map_settings.caps=caps;if(val('map_title').trim())map_settings.title=val('map_title').trim();
  return submitAction('delivery.build',{...receivingWaters.deliverySelection({baseline_run_id:val('baseline'),scenario_run_ids:alternatives}),title:val('title'),baseline_run_id:val('baseline'),scenario_run_ids:alternatives,source_roles,overlays:selectedOverlays,map_settings,observation_comparison_ids:chosen('observation_comparisons'),spatial_review_ids:chosen('spatial_reviews'),spatial_export_ids:chosen('spatial_exports'),contact:{name:val('contact_name'),organization:val('contact_organization'),email:val('contact_email')},notes:lines(val('notes'))});
 },()=>{
  for(const [key]of roles)bindDeliverySource('role_'+key,true,false);
  for(const [key,,requiredField]of overlays)bindDeliverySource('overlay_'+key,requiredField,true);
  let initial=row?.scenario_run_ids||[];
  const update=()=>{
   const baseline=complete.find(x=>x.id===val('baseline'));
   $('#delivery-alternatives').innerHTML=baseline?checks('alternatives',complete.filter(x=>x.id!==baseline.id&&x.selection.grid_id===baseline.selection.grid_id).map(x=>({id:x.id,title:runTitle(x.id)})),initial):'<p class="note">Choose the original baseline first.</p>';initial=[];
  };
  form.elements.namedItem('baseline').addEventListener('change',update);update();
 });
}
function backupForm(){
 openForm('Back up the original scientific workspace','Create an exact native archive containing the original project, source objects, selections, outputs and application. The same archive opens as a new receiving workspace.',
 '<div class="stack"><label class="check"><input type="checkbox" name="include_intermediates" checked><span>Include retained native model intermediates for continuation</span></label><p class="note">The completed archive is streamed as an authenticated file download. Original run and source identities are preserved.</p></div>',
 'Create complete backup',()=>submitAction('workspace.backup',{include_intermediates:form.elements.namedItem('include_intermediates').checked}));
}
function restoreForm(){
 openForm('Restore an original workspace archive','Choose the exact native scientific-workspace ZIP. The original receiver verifies every member and creates a new directory with the same project identity.',
 field('Original scientific workspace ZIP',input('restore_file','file','','required accept=".zip"'),'The current workspace remains available in the workspace selector.',true),
 'Verify and restore original archive',async()=>{const upload=await uploadFile(form.elements.namedItem('restore_file').files[0]);return submitAction('workspace.restore',{upload_id:upload.id});});
}

async function inspectSource(collection,id,layer){
 const value=await api(endpoint('/api/source-info',{collection,source:id,...(layer?{layer}:{})}));
 const entry=value.source;
 let html='<div class="meta"><span>'+esc(entry.kind)+'</span><span>'+esc(entry.vintage)+'</span><span>'+esc(entry.units||'')+'</span></div><p>'+external(entry.uri)+'</p>';
 if(value.layers)html+='<div class="filters">'+field('Original native layer','<select id="source-layer">'+value.layers.map(x=>'<option value="'+esc(x)+'" '+(x===value.selected_layer?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select>')+'</div>'+
 defs({features:value.feature_count,geometry_type:value.geometry_type,coordinate_reference_system:value.crs,bounds:value.bounds})+'<h3 class="subheading">Original field schema</h3>'+table(['Field','Native type'],Object.entries(value.fields).map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(v)+'</td></tr>'));
 if(entry.kind==='raster')html+=defs({width:value.width,height:value.height,bands:value.count,coordinate_reference_system:value.crs,pixel_resolution:value.resolution,bounds:value.bounds,types:value.dtypes,nodata:value.nodata});
 if(value.sample){
  const columns=value.columns||Object.keys(value.sample[0]||{});
  html+='<h3 class="subheading">Original source preview</h3><p class="note">First '+value.sample.length+' retained rows. Download the original file for the complete source.</p>'+table(columns,value.sample.map(row=>'<tr>'+columns.map(k=>'<td>'+esc(typeof row[k]==='object'?JSON.stringify(row[k]):row[k])+'</td>').join('')+'</tr>'));
 }
 if(['raster','vector'].includes(entry.kind))html+='<div class="page-actions">'+button('spatial-item','Open in spatial review','data-kind="source-info" data-id="'+esc(id)+'" data-collection="'+esc(collection)+'"')+'</div>';
 html+='<h3 class="subheading">Exact original file</h3>'+fileList([value.download])+'<details class="technical"><summary>Retained metadata</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details>';
 detail(entry.title,html,{kind:'source-info',id,collection});detailContext.files=[value.download];
 $('#source-layer')?.addEventListener('change',()=>inspectSource(collection,id,$('#source-layer').value).catch(globalError));
}
async function inspectFormVector(button){
 const name=button.dataset.vector,collection=val(button.dataset.collection);
 const id=val(name+'_source'),layer=val(name+'_layer').trim();
 if(!collection||!id)throw Error('Choose the source edition and original vector first.');
 return inspectSource(collection,id,layer||undefined);
}
async function showRunLog(id,append=false){
 if(!append){logOffset=0;detail('Original native model log','<p class="note">Retained output from the original selected NDR and SDR run.</p><pre id="native-log" class="logs"></pre>'+button('run-log-more','Read further log output','data-id="'+id+'"','small'),{kind:'run-log',id});}
 const value=await api(endpoint('/api/run-log',{id,offset:logOffset}));
 const text=value.text??value.content??'';
 $('#native-log').textContent+=text;
 logOffset=value.next_offset??value.offset??(logOffset+text.length);
 const b=$('[data-action="run-log-more"]',detailDialog);if(b)b.textContent=logOffset>=value.bytes?'Refresh retained log':'Read further log output';
}
function previewFile(id){
 const item=detailContext?.files?.find(x=>x.id===id);if(!item)throw Error('Reopen the retained item to obtain its current authenticated file link.');
 if(!item.filename.toLowerCase().endsWith('.pdf')){window.open(item.url+'?download=1','_blank','noopener');return;}
 detail(item.label||item.filename,'<div class="preview-options"><span>'+bytes(item.bytes)+' · <span class="mono">'+esc(short(item.sha256))+'</span></span><a class="button" href="'+esc(item.url)+'?download=1" download>Download original PDF</a></div><iframe class="preview-frame" title="'+esc(item.filename)+'" src="'+esc(item.url)+'"></iframe>',{kind:'file',id});detailContext.files=[item];
}
async function runtimeDialog(){
 const value=await api('/api/runtime');
 detail('Actual installed scientific runtime','<p class="note">Versions are read from this operator’s existing Python environment. Native run preparation verifies the selected original model installation.</p><pre class="json-view">'+esc(pretty(value))+'</pre>',{kind:'runtime'});
}
async function executeAction(action,payload){
 const row=await api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:crypto.randomUUID()}});
 await refresh({force:true});await showTask(row.id);return row;
}
async function navigate(next){
 if(!viewLabels[next]&&!extensions.hasView(next))return;
 view=next;history.replaceState(null,'','#'+next);lastRendered='';render();$('#main').focus();
}
async function selectWorkspace(id){
 if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');
 extensions.detach();
 spatialWorkspace.suspend();programmes.detach();community.detach();customerReviews.detach();experiments.detach();receivingWaters.detach();workspace=id;state=null;sessionStorage.setItem('upstate-selected-workspace',id);
 detailDialog.close();detailContext=null;lastRendered='';$('#content').innerHTML='<div class="empty"><h2>Opening selected workspace…</h2></div>';await refresh({force:true});
}
async function dispatch(button){
 const action=button.dataset.action,id=button.dataset.id;
 if(await extensions.dispatch(button))return;
 if(action?.startsWith('experiment-'))return experiments.dispatch(button);
 if(action?.startsWith('programme-'))return programmes.dispatch(button);
 if(action?.startsWith('community-'))return community.dispatch(button);
 if(action?.startsWith('review-'))return customerReviews.dispatch(button);
 if(action?.startsWith('water-'))return receivingWaters.dispatch(button);
 if(action==='refresh')return refresh({force:true});
 if(action==='tasks'||action==='tasks-close'){taskPanel=action==='tasks'?!taskPanel:false;$('#task-panel').hidden=!taskPanel;for(const b of $$('[data-action="tasks"]'))b.setAttribute('aria-expanded',String(taskPanel));return;}
 if(action==='form-close'){if(formContext?.busy)throw Error('The current request is being retained. Wait for its response before closing.');formDialog.close();formContext=null;return;}
 if(action==='detail-close'){detailDialog.close();detailContext=null;return;}
 if(action==='spatial-item'){
  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection,subject:button.dataset.subject,subject_kind:button.dataset.subjectKind,statistic:button.dataset.statistic,run:button.dataset.run,quantity:button.dataset.quantity};
  detailDialog.close();detailContext=null;await spatialWorkspace.openTarget(target);return navigate('spatial');
 }
 if(action==='item')return openItem(button.dataset.kind,id);
 if(action==='source-open')return sourceForm();
 if(action==='source-inspect')return inspectSource(button.dataset.collection,button.dataset.source);
 if(action==='profile-new'||action==='profile-clone')return profileForm(id);
 if(action==='grid-new'||action==='grid-clone')return gridForm(id);
 if(action==='scenario-new'||action==='scenario-clone')return scenarioForm(id);
 if(action==='run-prepare')return runForm();
 if(action==='run-start')return executeAction('run.start',{run_id:id});
 if(action==='run-completed-models')return completedModelsForm(id);
 if(action==='run-compare')return compareForm();
 if(action==='run-log'||action==='run-log-more')return showRunLog(id,action==='run-log-more');
 if(action==='observation-new')return observationForm();
 if(action==='observation-compare')return observationCompareForm(id);
 if(action==='observation-comparison-csv')return downloadObservationComparison();
 if(action==='delivery-new')return deliveryForm();
 if(action==='delivery-resume'){const row=await api(endpoint('/api/item',{kind:'deliveries',id}));return executeAction('delivery.build',row.selection);}
 if(action==='backup')return backupForm();
 if(action==='restore')return restoreForm();
 if(action==='preview-file')return previewFile(button.dataset.fileId);
 if(action==='task-open')return showTask(id);
 if(action==='task-resume'||action==='task-cancel'){await api('/api/task/'+(action==='task-resume'?'resume':'cancel'),{method:'POST',body:{id}});await refresh({force:true});return showTask(id);}
 if(action==='workspace-select')return selectWorkspace(id);
 if(action==='runtime')return runtimeDialog();
 if(action==='filter-add'){button.closest('[data-filter]').querySelector('[data-filter-rows]').insertAdjacentHTML('beforeend',filterRow());return;}
 if(action==='parameter-add'){$('#parameter-rows').insertAdjacentHTML('beforeend',parameterRow());return;}
 if(action==='patch-add'){$('#patch-list').insertAdjacentHTML('beforeend',patchRow(val('collection')));return;}
 if(action==='row-remove'){button.closest('[data-filter-row],[data-parameter-row],[data-patch]').remove();return;}
 if(action==='inspect-form-vector')return inspectFormVector(button);
}
document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-view]');if(nav){event.preventDefault();await navigate(nav.dataset.view);return;}
 const button=event.target.closest('[data-action]');if(!button)return;
 event.preventDefault();
 try{clearError();await dispatch(button);}catch(error){if(formDialog.open){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}else globalError(error);}
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!formContext||formContext.busy)return;
 if(!form.reportValidity())return;
 const current=formContext;current.busy=true;$('#form-submit').disabled=true;$('#form-error').hidden=true;$('#form-progress').textContent='Retaining the original selection…';
 try{await current.onSubmit();}
 catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;$('#form-progress').textContent='Draft retained in this form. Correct the selection or retry the same request.';}
 finally{if(formContext===current){current.busy=false;$('#form-submit').disabled=false;}}
});
formDialog.addEventListener('cancel',event=>{if(formContext?.busy)event.preventDefault();else formContext=null;});
detailDialog.addEventListener('close',()=>{detailContext=null;});
$('#workspace-select').addEventListener('change',event=>selectWorkspace(event.target.value).catch(globalError));
window.addEventListener('hashchange',()=>{const requested=location.hash.slice(1);if(viewLabels[requested]||extensions.hasView(requested))navigate(requested);});
window.addEventListener('online',()=>refresh({force:true}));
if(capability){
 try{await api('/api/session',{method:'POST',body:{}});try{await extensions.load();const requested=location.hash.slice(1);if(extensions.hasView(requested))view=requested;}catch(error){toast('Additional desks: '+error.message);}await refresh({force:true});}
 catch(error){globalError(error);$('#connection-state').textContent='Open the current operator URL printed by the local server.';}
}else $('#connection-state').textContent='Open the complete operator URL printed by the local server to access this workspace.';
