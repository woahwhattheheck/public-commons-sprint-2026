/** Guided operation of the existing Upper Savannah scientific workspace. */
import {attachRegionalJourney} from './regional_journey.mjs';
const SCHEMA='upstate.operating-journey/v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const stamp=value=>{const time=Date.parse(value);return Number.isFinite(time)?time:null;};
const when=value=>stamp(value)===null?'Not recorded':new Date(value).toLocaleString();
const number=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:6}):'Not recorded';
const duration=value=>!Number.isFinite(value)?'Not recorded':value<1000?Math.round(value)+' ms':value<60000?(value/1000).toFixed(1)+' s':value<3600000?(value/60000).toFixed(1)+' min':(value/3600000).toFixed(2)+' h';
const elapsed=(start,end)=>{const a=stamp(start),b=stamp(end);return a!==null&&b!==null&&b>=a?b-a:null;};
const short=value=>String(value??'').slice(0,12);
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const human=value=>String(value??'').replaceAll('_',' ');
const nativeModels=record=>{const chosen=record?.models??['ndr','sdr'];return ['ndr','sdr'].filter(name=>Array.isArray(chosen)&&chosen.includes(name));};
const modelLabel=record=>nativeModels(record).map(name=>name.toUpperCase()).join(' + ')||'Choose native models';
const sameModels=(a,b)=>canonical(nativeModels(a))===canonical(nativeModels(b));
const commonModels=(a,b)=>nativeModels(a?.selection).filter(name=>nativeModels(b?.selection).includes(name));
const fields={baseline_run_id:'runs',grid_id:'grids',profile_id:'profiles',scenario_id:'scenarios',run_id:'runs',comparison_id:'comparisons',spatial_review_id:'spatial_reviews',spatial_export_id:'spatial_exports',delivery_id:'deliveries',calibration_review_id:'calibration_reviews'};
const resultFields={'scenario.save':'scenario_id','profile.save':'profile_id','grid.prepare':'grid_id','run.prepare':'run_id','run.compare':'comparison_id','delivery.build':'delivery_id','spatial.review.save':'spatial_review_id','spatial.review.export':'spatial_export_id'};
const journeyRows=(state,kind)=>list(kind==='calibration_reviews'?state?.data?.calibration?.calibration_reviews:state?.data?.[kind]);
const reviewContext=record=>record?Object.fromEntries(['id','calibration_id','plan_id','uncertainty_id','map_id','selected_run_id','selected_profile_id'].map(key=>[key,record[key]??null])):null;
export const journeySteps=[
 {id:'study',title:'Choose a prepared study',view:'overview',do:'Choose the saved baseline you want to explain. Open its result before changing any inputs.',see:'The selected source grid, parameter profile, baseline scenario and actual run state.',meaning:'This fixes the starting point for every change and comparison in this journey.',say:'This is our saved starting point, and every result stays linked to the inputs that produced it.'},
 {id:'inputs',title:'Explain inputs and geography',view:'sources',do:'Open the source edition, model grid and parameter profile. Inspect the reporting boundary in Spatial review.',see:'Original source editions and references, the coordinate system, resolution, upstream context and model period.',meaning:'The reporting area determines where quantities are summarized; the wider model domain supplies hydrologic context.',say:'We retain the original data and show exactly which geography and assumptions the model uses.'},
 {id:'change',title:'Make a case change',view:'scenarios',do:'Revise the baseline scenario with an actual retained polygon mask and explicit land-cover codes. Select the saved revision below.',see:'The original baseline beside a separate scenario, with the reason, masks and replacement codes recorded.',meaning:'A scenario describes a specific change. A profile change is a separate scientific assumption and remains visible in the comparison.',say:'I can change a defined part of the landscape while keeping the baseline available for comparison.'},
 {id:'calculate',title:'Calculate and recover',view:'runs',do:'Prepare the selected grid, profile and scenario, then start that retained run. Inspect the original task if it pauses or fails.',see:'The actual queue state, native stage times, retained log and physical output quantities.',meaning:'The original selected NDR, SDR or combined engines calculate the result. Resume uses the same task and its saved native stages.',say:'This control runs the original models, and I can see their progress and continue the same work after an interruption.'},
 {id:'compare',title:'Compare physical results',view:'comparisons',do:'Compare the completed baseline and alternative on the same grid. Open the difference map and inspect its quantities.',see:'Alternative-minus-baseline changes, physical units, valid-cell coverage and any changed parameter profile.',meaning:'A negative difference means the alternative has a smaller modeled export for that quantity on the compared cells.',say:'This shows the modeled change from the same baseline, with the units and assumptions visible.'},
 {id:'maps',title:'Inspect and explain the maps',view:'spatial',do:'Open the selected result or comparison in Spatial review. Inspect the legend, extent, source layers and saved annotations, then save a view or map pack.',see:'Actual mapped outputs, saved geographic views and the original printable map files.',meaning:'Map colors and priorities need the physical units, legend and selected geography beside them.',say:'I can move from a numerical result to the actual map and retain the view we discussed.'},
 {id:'delivery',title:'Build and open the delivery',view:'deliveries',do:'Build the original seven-map delivery from completed runs and actual supporting sources. Open its report, maps and working package.',see:'The native delivery state, selected runs, map PDFs, metadata and original authenticated downloads.',meaning:'The delivery packages the analysis with its supporting source editions and restorable working project.',say:'The handover includes both the readable report and the working analysis behind it.'},
 {id:'reopen',title:'Save, reopen and transfer',view:'overview',do:'Save your view, open Project continuity and create a complete project with its operation history. Receive its archive or incremental edition, open the received workspace and continue the retained work.',see:'The original project identity, saved selections and notes, completed results, receiving workspace and unfinished original operations.',meaning:'Project continuity carries the scientific workspace and the selected operating history together. Scientific backups and separate journey downloads remain available.',say:'We can reopen the project, explain the saved analysis and continue its unfinished work.'},
 {id:'review',optional:true,title:'Review calibration evidence (optional)',view:'calibration',do:'Select a completed calibration review. Open its readable report, nominal analysis, chosen observation-error sensitivity and original catchment maps. Save this view before handover.',see:'One exact saved dossier, its source observation and plan identities, original selected native run, and explicitly chosen supplements.',meaning:'This dossier explains how original annual observations compare with the retained native candidates. Its scientific selection is independent of the scenario comparison selected in the other journey steps.',say:'This is the complete observation-based review behind the selected calibration, with the report and original supporting files kept together.'}
];
export const journeyVocabulary=[
 ['Source edition','The retained version of an original dataset, with its references and original files.'],
 ['Reporting area','The geographic area used to summarize the reported quantities.'],
 ['Model domain','The wider hydrologic area used when calculating flows affecting the reporting area.'],
 ['Parameter profile','The saved biophysical table, native model settings, references and model period.'],
 ['Scenario','The unchanged baseline or a specified set of land-cover changes.'],
 ['Native run','A saved selection executed by the original InVEST NDR, SDR or both models.'],
 ['Annual export','The modeled quantity leaving the selected area in the units shown beside the result.'],
 ['Comparison','The alternative minus the baseline on the same model grid.'],
 ['Saved spatial review','A retained geographic view, including its source layers, extent and annotations.'],
 ['Delivery','The original maps, report, metadata and working analysis assembled from selected results.']
];
export function nativeTiming(run,task,at=new Date().toISOString()){
 const stages=Object.entries(run?.stage_summary||run?.stages||{}).map(([name,row])=>({name,started_at:row.started_at??null,completed_at:row.completed_at??null,duration_ms:elapsed(row.started_at,row.completed_at),files:row.file_count??Object.keys(row.files||{}).length,reused_from:row.reused_from??null,reused_at:row.reused_at??null}));
 const starts=stages.map(x=>stamp(x.started_at)).filter(x=>x!==null),ends=stages.map(x=>stamp(x.completed_at)).filter(x=>x!==null);
 const reused=stages.filter(stage=>stage.reused_from);
 const span=starts.length&&ends.length&&!reused.length&&stages.every(x=>stamp(x.completed_at)!==null)?Math.max(...ends)-Math.min(...starts):null;
 const created=stamp(task?.created_at),newStages=stages.filter(x=>!x.reused_from&&created!==null&&stamp(x.started_at)!==null&&stamp(x.started_at)>=created);
 let label=run?.state==='complete'?'Saved complete result':human(run?.state||'No run selected');
 if(task?.state==='running')label='Original task running';
 else if(task?.state==='queued')label='Original task queued';
 else if(['failed','interrupted','cancelled'].includes(task?.state))label='Original task '+task.state;
 else if(task?.state==='complete'&&run?.state==='complete'){
  if(reused.length)label=newStages.length?'Native calculation completed with reused stages':'Run contains reused native stages';
  else if(stages.length&&newStages.length===stages.length)label='Native calculation completed in this task';
  else if(newStages.length)label='Native continuation completed in this task';
  else label='Task complete; retained native stages available';
 }
 return {label,observed_at:at,stages,native_span_ms:span,reused_stages:reused.length,queue_ms:elapsed(task?.created_at,task?.started_at),task_ms:elapsed(task?.started_at,task?.ended_at||(task?.state==='running'?at:null))};
}
export function validateJourneyImport(value,state){
 if(!value||value.schema!==SCHEMA||value.project_id!==state?.data?.project?.id)throw Error('Open the original project or its restored copy before importing these journey selections.');
 if(value.regional!==undefined&&value.regional!==null&&(typeof value.regional!=='object'||Array.isArray(value.regional)||value.regional.schema!=='upstate.regional-journey/v1'))throw Error('Choose the original regional journey selection format.');
 const selection={};
 for(const [key,collection]of Object.entries(fields)){
  const id=value.selection?.[key]||'';
  if(typeof id!=='string'||(id&&!journeyRows(state,collection).some(row=>row.id===id)))throw Error('This project does not contain the selected '+human(key)+'. Open the complete matching workspace archive.');
  selection[key]=id;
 }
 const review=journeyRows(state,'calibration_reviews').find(row=>row.id===selection.calibration_review_id);
 if(review&&review.state!=='complete')throw Error('Choose a completed original calibration review.');
 const retainedReview=value.recorded_context?.calibration_review;
 if(retainedReview!==undefined&&retainedReview!==null&&canonical(retainedReview)!==canonical(reviewContext(review)))throw Error('The saved review context belongs to a different original dossier. Open the matching workspace.');
 const base=list(state.data.runs).find(x=>x.id===selection.baseline_run_id),run=list(state.data.runs).find(x=>x.id===selection.run_id);
 const requested=value.selection?.models;
 if(requested!==undefined&&(!Array.isArray(requested)||requested.some(name=>!['ndr','sdr'].includes(name))||new Set(requested).size!==requested.length))throw Error('The journey native model selection is invalid.');
 selection.models=requested===undefined?(run||base?nativeModels((run||base).selection):[]):nativeModels({models:requested});
 if(run&&(['grid_id','profile_id','scenario_id'].some(key=>run.selection?.[key]!==selection[key])||!sameModels(run.selection,selection)))throw Error('The selected run belongs to a different grid, profile, scenario or native model selection.');
 const comparison=list(state.data.comparisons).find(x=>x.id===selection.comparison_id);
 if(comparison&&(comparison.baseline_run_id!==base?.id||!list(comparison.alternatives).some(x=>x.run_id===run?.id)))throw Error('The selected comparison does not join this baseline and alternative.');
 const delivery=list(state.data.deliveries).find(x=>x.id===selection.delivery_id);
 if(delivery&&(delivery.selection?.baseline_run_id!==base?.id||!list(delivery.selection?.scenario_run_ids).includes(run?.id)))throw Error('The selected delivery belongs to a different baseline or alternative.');
 const mapPack=list(state.data.spatial_exports).find(x=>x.id===selection.spatial_export_id);
 if(mapPack&&selection.spatial_review_id&&mapPack.review_id!==selection.spatial_review_id)throw Error('The map pack belongs to a different saved geographic view.');
 return {selection,regional:value.regional?JSON.parse(JSON.stringify(value.regional)):null,step:journeySteps.some(x=>x.id===value.step)?value.step:'study',notes:typeof value.notes==='string'?value.notes:'',note_versions:list(value.note_versions).filter(x=>typeof x?.text==='string').map(x=>({text:x.text,recorded_at:typeof x.recorded_at==='string'?x.recorded_at:null})),started_at:stamp(value.started_at)!==null?value.started_at:new Date().toISOString()};
}
export function attachOperatingJourney(host){
 let snapshot=null,preferences=null,currentKey=null,storageMessage='',busy=false,mounted=null,removeListeners=null,rail=null,currentView='overview',storageRevision=null,savedNotes='',savedSelection='';
 const state=()=>snapshot||host.getState();
 const hostView=()=>typeof host.getView==='function'?host.getView():currentView;
 const workspace=()=>state()?.workspace_key||host.getWorkspace();
 const rows=kind=>journeyRows(state(),kind);
 const row=(kind,id)=>rows(kind).find(x=>x.id===id);
 const selected=key=>row(fields[key],preferences?.selection[key]);
 const title=(kind,id)=>{const item=row(kind,id);return item?.title||item?.spec?.title||item?.selection?.title||item?.metadata?.title||short(id)||'Choose a saved item';};
 const selectionRevision=value=>canonical({selection:value?.selection||{},regional:value?.regional??null});
 const runTitle=item=>item?title('scenarios',item.selection?.scenario_id)+' · '+title('profiles',item.selection?.profile_id)+' · '+modelLabel(item.selection):'Choose a native run';
 const regional=attachRegionalJourney({...host,getState:state,getSelection:()=>preferences?.selection||{},getContext:()=>preferences?.regional??null,setContext:value=>{if(preferences){preferences.regional=value;save();}}});
 function retainIntent(id){
  const pending=preferences?.pending[id];
  if(!currentKey||!pending?.request)throw Error('Retain the original request before submitting this operation.');
  try{
   const key=currentKey+':intent:'+id,existing=JSON.parse(localStorage.getItem(key)||'null');
   if(existing?.request&&canonical(existing.request)!==canonical(pending.request))throw Error('An original journey request changed. Recover its saved task before opening a new selection.');
   const saved={...existing,...pending,request:existing?.request||pending.request};
   localStorage.setItem(key,JSON.stringify(saved));
   const readback=JSON.parse(localStorage.getItem(key)||'null');
   if(!readback?.request||canonical(readback.request)!==canonical(saved.request)||readback.operation_id!==id)throw Error('Original request readback differs.');
   preferences.pending[id]=saved;return saved;
  }catch(error){
   if(error.message?.startsWith('An original journey request'))throw error;
   throw Error('This browser could not retain the original request. Keep the form open, make browser storage available, and retry.');
  }
 }
 function currentIntent(field,pending){
  const rank=item=>Number.isFinite(item.request_order)?item.request_order:(stamp(item.requested_at)||stamp(item.created_at)||0);
  // Protect the fields a later operation writes, invalidates, or needs to keep
  // coherent. Independent input edits can still adopt their separate results.
  const runFields=['run_id','grid_id','profile_id','scenario_id','models'];
  const effects={
   'scenario.save':['scenario_id','run_id','comparison_id','delivery_id'],
   'profile.save':['profile_id','run_id','comparison_id','delivery_id'],
   'grid.prepare':['grid_id','run_id','comparison_id','delivery_id'],
   'run.prepare':[...runFields,'comparison_id','delivery_id'],
   'run.start':runFields,
   'run.compare':[...runFields,'baseline_run_id','comparison_id','delivery_id'],
   'delivery.build':[...runFields,'baseline_run_id','comparison_id','spatial_review_id','spatial_export_id','delivery_id'],
   'spatial.review.save':['spatial_review_id','spatial_export_id','delivery_id'],
   'spatial.review.export':['spatial_review_id','spatial_export_id','delivery_id']
  };
  for(const item of Object.values(preferences.pending)){
   if(!item?.request||item.generation!==preferences.generation||item.operation_id===pending.operation_id)continue;
   const later=rank(item)-rank(pending)||String(item.operation_id).localeCompare(String(pending.operation_id));
   if(later>0&&(effects[item.intent]||[]).includes(field))return false;
  }
  return true;
 }
 function save(){
  if(!preferences||!currentKey)return;
  try{
   const latest=JSON.parse(localStorage.getItem(currentKey)||'null');
   if(latest?.schema===SCHEMA&&latest.workspace_key===preferences.workspace_key&&latest.project_id===preferences.project_id&&latest.revision!==storageRevision){
    const incomingNotes=typeof latest.notes==='string'?latest.notes:'',localChanged=preferences.notes!==savedNotes,remoteChanged=incomingNotes!==savedNotes;
    const variants=[...list(latest.note_versions),...list(preferences.note_versions)];
    if(remoteChanged&&localChanged&&incomingNotes!==preferences.notes)variants.push({text:incomingNotes,recorded_at:new Date().toISOString()});
    else if(remoteChanged&&!localChanged)preferences.notes=incomingNotes;
    preferences.note_versions=variants.filter((item,index,all)=>typeof item?.text==='string'&&all.findIndex(other=>other?.text===item.text)===index);
    if(selectionRevision(latest)!==savedSelection&&selectionRevision(preferences)===savedSelection){
     const incoming=validateJourneyImport(latest,state());preferences.selection=incoming.selection;preferences.regional=incoming.regional;preferences.generation=latest.generation||crypto.randomUUID();
    }
   }
   for(const [id,pending]of Object.entries(preferences.pending)){
    const key=currentKey+':intent:'+id,existing=JSON.parse(localStorage.getItem(key)||'null');
    if(existing?.request&&pending.request&&canonical(existing.request)!==canonical(pending.request))throw Error('An original journey request changed. Recover its saved task before opening a new selection.');
    const value={...existing,...pending,request:existing?.request||pending.request};
    localStorage.setItem(key,JSON.stringify(value));preferences.pending[id]=value;
   }
   preferences.revision=crypto.randomUUID();
   const saved={...preferences,pending:{}};
   localStorage.setItem(currentKey,JSON.stringify(saved));
   storageRevision=preferences.revision;savedNotes=preferences.notes;savedSelection=selectionRevision(preferences);storageMessage='';
  }catch(error){
   if(error.message?.startsWith('An original journey request'))throw error;
   storageMessage='Journey selections are available in this tab. Download them to keep a copy.';
  }
 }
 const action=(name,label,attrs='',primary=false)=>'<button type="button" class="'+(primary?'primary':'')+'" data-action="journey-'+esc(name)+'" '+attrs+'>'+esc(label)+'</button>';
 const open=(kind,id,label)=>id?action('item',label||'Open original record','data-kind="'+esc(kind)+'" data-id="'+esc(id)+'"'):'';
 const map=(kind,id,label)=>id?action('map',label||'Open map','data-kind="'+esc(kind)+'" data-id="'+esc(id)+'"'):'';
 const select=(key,label,items,labelFor=item=>title(fields[key],item.id))=>'<label><span>'+esc(label)+'</span><select data-journey-field="'+esc(key)+'"><option value="">Choose a saved item…</option>'+items.map(item=>'<option value="'+esc(item.id)+'" '+(preferences.selection[key]===item.id?'selected':'')+'>'+esc(labelFor(item))+'</option>').join('')+'</select></label>';
 const info=(label,value)=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value??'Not recorded')+'</dd></div>';
 const facts=values=>'<dl class="journey-facts">'+values.map(x=>info(x[0],x[1])).join('')+'</dl>';
 const notice=text=>'<p class="journey-note">'+esc(text)+'</p>';
 function latestTask(actionName,runId){
  return list(state()?.tasks).filter(task=>task.workspace===workspace()&&task.action===actionName&&(!runId||task.payload?.run_id===runId)).sort((a,b)=>(stamp(b.created_at)||0)-(stamp(a.created_at)||0))[0]||null;
 }
 function matchingRun(){
  const selection=preferences.selection;
  const existing=selected('run_id');
  if(existing&&['grid_id','profile_id','scenario_id'].every(key=>existing.selection?.[key]===selection[key])&&sameModels(existing.selection,selection))return existing;
  return null;
 }
 function chooseBase(id){
  const base=row('runs',id);preferences.selection.baseline_run_id=id;
  for(const key of ['grid_id','profile_id','scenario_id'])preferences.selection[key]=base?.selection?.[key]||'';
  preferences.selection.run_id=base?.id||'';
  preferences.selection.models=base?nativeModels(base.selection):[];
  for(const key of ['comparison_id','spatial_review_id','spatial_export_id','delivery_id'])preferences.selection[key]='';
 }
 function clearDownstream(field){
  if(['grid_id','profile_id'].includes(field)){
   const profile=selected('profile_id'),grid=selected('grid_id');
   const available=profile?nativeModels(profile):['ndr','sdr'];
   preferences.selection.models=grid?available.filter(name=>nativeModels(grid.spec).includes(name)):available;
  }
  if(['grid_id','profile_id','scenario_id'].includes(field))preferences.selection.run_id='';
  if(['grid_id','profile_id','scenario_id','run_id'].includes(field)){preferences.selection.comparison_id='';preferences.selection.delivery_id='';}
 }
 function adopt(task,pending){
  if(pending.applied||task.state!=='complete'||!task.result)return false;
  const field=resultFields[task.action];
  if(field&&!row(fields[field],task.result.id))return false;
  pending.applied=true;
  if(pending.generation!==preferences.generation||(field&&!currentIntent(field,pending)))return true;
  if(field){
   const previous=preferences.selection[field];
   preferences.selection[field]=task.result.id;
   if(previous!==task.result.id)clearDownstream(field);
   if(field==='run_id'){
    for(const key of ['grid_id','profile_id','scenario_id'])preferences.selection[key]=task.result.selection?.[key]||preferences.selection[key];
    preferences.selection.models=nativeModels(task.result.selection);
   }
  }
  return true;
 }
 function observe(next,view=currentView){
  if(!next?.workspace_key||!next.data?.project?.id)return;
  snapshot=next;currentView=view;
  const key='upstate-operating-journey:'+next.workspace_key;
  if(key!==currentKey){
   detach();currentKey=key;let saved;
   try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
   if((!saved||saved.project_id!==next.data.project.id||saved.workspace_key!==next.workspace_key)&&next.data.operator_session?.journey){
    saved={...next.data.operator_session.journey,workspace_key:next.workspace_key,active:true};
   }
   preferences={schema:SCHEMA,project_id:next.data.project.id,workspace_key:next.workspace_key,active:false,step:'study',started_at:new Date().toISOString(),generation:crypto.randomUUID(),selection:{...Object.fromEntries(Object.keys(fields).map(k=>[k,''])),models:[]},notes:'',regional:null,pending:{},requests:{},note_versions:[]};
   if(saved?.schema===SCHEMA&&saved.project_id===next.data.project.id&&saved.workspace_key===next.workspace_key){
    try{
     const valid=validateJourneyImport(saved,next);
     Object.assign(preferences,valid,{active:!!saved.active,generation:typeof saved.generation==='string'?saved.generation:crypto.randomUUID(),pending:saved.pending&&typeof saved.pending==='object'&&!Array.isArray(saved.pending)?saved.pending:{},requests:saved.requests&&typeof saved.requests==='object'&&!Array.isArray(saved.requests)?saved.requests:{}});
    }catch(error){storageMessage=error.message;}
   }
   storageRevision=saved?.revision||null;savedNotes=preferences.notes;savedSelection=selectionRevision(preferences);
   preferences.browser_view_draft=saved?.browser_view_draft&&saved.browser_view_draft.project_id===next.data.project.id?saved.browser_view_draft:null;
   try{
    for(let i=0;i<localStorage.length;i++){
     const name=localStorage.key(i);if(!name?.startsWith(currentKey+':intent:'))continue;
     const pending=JSON.parse(localStorage.getItem(name)||'null');
     if(pending?.operation_id&&(!pending.request||pending.request.workspace===next.workspace_key))preferences.pending[pending.operation_id]=pending;
    }
   }catch{}

  }
  let changed=false;
  const savedSession=next.data.operator_session;
  if(savedSession?.revision&&savedSession.revision!==preferences.operator_revision){
   preferences.operator_revision=savedSession.revision;
   const prior=savedSession.journey||{},versions=[...list(preferences.note_versions),...list(prior.note_versions)];
   if(typeof prior.notes==='string'&&prior.notes&&prior.notes!==preferences.notes)versions.push({text:prior.notes,recorded_at:savedSession.saved_at});
   preferences.note_versions=versions.filter((item,index,all)=>typeof item?.text==='string'&&all.findIndex(other=>other?.text===item.text)===index);
   changed=true;
  }
  for(const task of list(next.tasks)){
   if(task.workspace!==next.workspace_key)continue;
   const matching=Object.values(preferences.pending).filter(p=>p&&typeof p==='object'&&(p.task_id===task.id||p.operation_id===task.operation_id));
   for(const pending of matching){if(pending.task_id!==task.id){pending.task_id=task.id;changed=true;}if(adopt(task,pending))changed=true;}
  }
  if(changed)save();
  updateRail(view);
 }
 function beforeSubmission(request){
  const pending=preferences?.pending[request.operation_id];
  if(!pending)return request;
  if(request.workspace!==workspace()||request.action!==pending.intent)throw Error('The original journey form belongs to a different workspace or operation.');
  const frozen=JSON.parse(JSON.stringify(request));
  if(pending.request&&canonical(pending.request)!==canonical(frozen))throw Error('This form already submitted an earlier selection. Use Recover original request, or close this form and open a new selection.');
  pending.request??=frozen;pending.selection??=JSON.parse(JSON.stringify(preferences.selection));
  if(pending.request_order===undefined){
   pending.requested_at=new Date().toISOString();
   pending.request_order=Math.max(Date.now(),...Object.values(preferences.pending).map(item=>Number.isFinite(item?.request_order)?item.request_order:0))+1;
  }
  retainIntent(request.operation_id);save();
  return pending.request;
 }
 function acceptTask(task,submittedOperation){
  if(!preferences||task.workspace!==workspace())return;
  const pending=preferences.pending[submittedOperation]||preferences.pending[task.operation_id];
  if(pending){pending.task_id=task.id;pending.actual_operation_id=task.operation_id;save();}
 }
 async function form(intent,openForm){
  if(busy)throw Error('The current operation is being retained. Wait for its response.');
  const selectedWorkspace=workspace(),generation=preferences.generation;
  busy=true;
  try{
   const opened=await openForm();
   if(workspace()!==selectedWorkspace)throw Error('Open this form again in the intended workspace.');
   if(!opened?.operation_id)throw Error('The original form did not return its request identity.');
   preferences.pending[opened.operation_id]={operation_id:opened.operation_id,intent,generation,created_at:new Date().toISOString()};
   save();
  }finally{busy=false;}
 }
 async function startRun(){
  const run=matchingRun();if(!run)throw Error('Prepare the selected grid, profile and scenario first.');
  const originalTask=latestTask('run.start',run.id);
  if(originalTask&&['queued','running','failed','interrupted','cancelled'].includes(originalTask.state)){
   if(['failed','interrupted','cancelled'].includes(originalTask.state)){
    const actual=await host.api('/api/task?id='+encodeURIComponent(originalTask.id));
    if(actual.workspace!==workspace())throw Error('Open this operation in its original workspace.');
    if(['failed','interrupted','cancelled'].includes(actual.state))await host.api('/api/task/resume',{method:'POST',body:{id:actual.id}});
    await host.refresh({force:true});
   }
   return host.showTask(originalTask.id);
  }
  if(run.state==='complete')return host.openItem('runs',run.id);
  const selectedWorkspace=workspace();
  let request=preferences.requests[run.id];
  if(!request||request.action!=='run.start'||request.payload?.run_id!==run.id)request={operation_id:crypto.randomUUID(),action:'run.start',payload:{run_id:run.id},created_at:new Date().toISOString()};
  preferences.requests[run.id]=request;
  preferences.pending[request.operation_id]??={operation_id:request.operation_id,intent:'run.start',generation:preferences.generation,created_at:request.created_at};
  const submission=beforeSubmission({workspace:selectedWorkspace,action:request.action,payload:request.payload,operation_id:request.operation_id});
  const task=await host.api('/api/actions',{method:'POST',body:submission});
  if(workspace()!==selectedWorkspace)return;
  acceptTask(task,request.operation_id);request.task_id=task.id;save();
  await host.refresh({force:true});await host.showTask(task.id);
 }
 function resultTable(run){
  const artifacts=Object.entries(run?.artifacts||{});
  if(!artifacts.length)return notice('Physical quantities will appear when the original run has saved its outputs.');
  return '<div class="table-scroll"><table><thead><tr><th>Quantity</th><th>Reporting total</th><th>Physical units</th><th>Valid cells</th></tr></thead><tbody>'+artifacts.map(([name,value])=>'<tr><td>'+esc(human(name))+'</td><td class="number-cell">'+number(value.sum)+'</td><td>'+esc(value.sum_units||'Total units not recorded')+'</td><td class="number-cell">'+number(value.valid_cells)+'</td></tr>').join('')+'</tbody></table></div>';
 }
 function timingTable(run){
  const task=run?latestTask('run.start',run.id):null,timing=nativeTiming(run,task);
  let html='<div class="journey-state" role="status">'+esc(timing.label)+'</div>';
  if(task){
   html+=facts([['Task created',when(task.created_at)],['Queue time',duration(timing.queue_ms)],['Task duration',duration(timing.task_ms)],['Observed',when(timing.observed_at)]]);
   if(task.error)html+='<p class="journey-error">'+esc(task.error.message||task.error)+'</p>';
   html+='<div class="page-actions">'+action('task','Inspect original task','data-id="'+esc(task.id)+'"')+'</div>';
  }
  if(timing.stages.length)html+='<div class="table-scroll"><table><thead><tr><th>Native stage</th><th>Started</th><th>Completed</th><th>Original stage duration</th><th>Outputs</th><th>Stage origin</th></tr></thead><tbody>'+timing.stages.map(stage=>'<tr><td>'+esc(human(stage.name))+'</td><td>'+esc(when(stage.started_at))+'</td><td>'+esc(when(stage.completed_at))+'</td><td>'+esc(duration(stage.duration_ms))+'</td><td>'+number(stage.files)+'</td><td>'+esc(stage.reused_from?('Reused from run '+short(stage.reused_from.run_id)+' · '+when(stage.reused_at)):'Recorded for this run')+'</td></tr>').join('')+'</tbody></table></div>';
  const history=rows('runs').filter(item=>item.id!==run?.id&&item.state==='complete'&&item.selection?.grid_id===run?.selection?.grid_id&&item.selection?.profile_id===run?.selection?.profile_id).map(item=>nativeTiming(item,null).native_span_ms).filter(value=>value!==null&&value>=0);
  if(history.length)html+=notice(history.length+' saved run'+(history.length===1?'':'s')+' on the same grid and profile recorded a native stage span of '+duration(Math.min(...history))+' to '+duration(Math.max(...history))+'.');
  return html;
 }
 function study(){
  const base=selected('baseline_run_id');
  let html=select('baseline_run_id','Saved baseline or prepared study',rows('runs'),run=>runTitle(run)+' · '+human(run.state));
  if(!base)return html+notice('Select a prepared run, or use the existing source, grid, profile and scenario controls to prepare the first study.')+'<div class="page-actions">'+action('view','Open workspace overview','data-view-name="overview"')+action('prepare','Prepare a run')+'</div>';
  html+=facts([['Scenario',title('scenarios',base.selection?.scenario_id)],['Grid',title('grids',base.selection?.grid_id)],['Parameter profile',title('profiles',base.selection?.profile_id)],['Native models',modelLabel(base.selection)],['Native model version',base.selection?.invest_version||'Not recorded']]);
  html+='<div class="page-actions">'+open('runs',base.id,'Open saved result')+map('runs',base.id,'Open study map')+'</div>'+timingTable(base)+resultTable(base);
  return html;
 }
 function inputs(){
  const base=selected('baseline_run_id'),grid=selected('grid_id')||row('grids',base?.selection?.grid_id),profile=selected('profile_id')||row('profiles',base?.selection?.profile_id),collection=row('sources',grid?.spec?.source_collection_id||profile?.source_collection_id);
  if(!grid&&!profile)return notice('Select a saved scientific profile and model grid to inspect their original inputs.');
  let html=facts([['Source edition',collection?.title||collection?.id],['Coordinate system',grid?.grid?.crs_name||grid?.grid?.crs],['Resolution',grid?.grid?.resolution_m!==undefined?number(grid.grid.resolution_m)+' m':null],['Grid dimensions',grid?.grid?number(grid.grid.width)+' × '+number(grid.grid.height):null],['Upstream context',grid?.spec?.upstream_buffer_m!==undefined?number(grid.spec.upstream_buffer_m)+' m':null],['Model period',typeof profile?.model_period==='object'?JSON.stringify(profile.model_period):profile?.model_period]]);
  html+='<div class="page-actions">'+open('sources',collection?.id,'Open original sources')+open('grids',grid?.id,'Inspect grid and boundary')+open('profiles',profile?.id,'Inspect parameters')+map('grids',grid?.id,'Inspect geography')+'</div>';
  const entries=list(collection?.entries);
  if(entries.length)html+='<div class="table-scroll"><table><thead><tr><th>Original source</th><th>Edition</th><th>Units</th><th>Reference</th></tr></thead><tbody>'+entries.map(entry=>'<tr><td>'+esc(entry.title||entry.id)+'</td><td>'+esc(entry.vintage||'Not recorded')+'</td><td>'+esc(entry.units||'Not supplied')+'</td><td>'+(/^https?:\/\//i.test(entry.uri||'')?'<a href="'+esc(entry.uri)+'" target="_blank" rel="noopener noreferrer">Open original reference</a>':esc(entry.uri||'Not recorded'))+'</td></tr>').join('')+'</tbody></table></div>';
  return html;
 }
 function change(){
  const base=selected('baseline_run_id'),scenario=selected('scenario_id');
  return '<div class="journey-fields">'+select('scenario_id','Saved case or scenario',rows('scenarios'))+select('profile_id','Parameter profile',rows('profiles'))+select('grid_id','Complete model grid',rows('grids').filter(x=>x.state==='complete'))+'</div>'+
   '<div class="page-actions">'+action('scenario','Revise selected scenario','',true)+action('profile','Revise parameter profile')+action('regional-profile','Open profile workbench')+action('grid','Revise model grid')+'</div>'+
   (scenario?facts([['Scenario kind',human(scenario.kind)],['Reason',scenario.reason],['Specified land-cover changes',list(scenario.patches).length],['Starting baseline',base?runTitle(base):'Choose the starting study']]):notice('Choose an existing scenario or create one using the original scenario form.'))+
   (base&&preferences.selection.scenario_id===base.selection?.scenario_id?notice('The original baseline is selected. Save and select a separate case change to compare an alternative.'): '');
 }
 function calculate(){
  const run=matchingRun(),selection=preferences.selection;
  const candidates=rows('runs').filter(item=>['grid_id','profile_id','scenario_id'].every(key=>item.selection?.[key]===selection[key])&&(!list(selection.models).length||sameModels(item.selection,selection)));
  let html=facts([['Grid',title('grids',selection.grid_id)],['Profile',title('profiles',selection.profile_id)],['Scenario',title('scenarios',selection.scenario_id)],['Native models',modelLabel(selection)]]);
  if(candidates.length)html+=select('run_id','Run for this exact selection',candidates,item=>short(item.id)+' · '+modelLabel(item.selection)+' · '+human(item.state));
  html+='<div class="page-actions">'+action('prepare','Prepare selected run','',!run);
  if(run){
   const task=latestTask('run.start',run.id),label=['failed','interrupted','cancelled'].includes(task?.state)?'Resume original task':['queued','running'].includes(task?.state)?'Inspect running task':run.state==='complete'?'Open completed result':'Start original models';
   html+=action('start',label,'',true)+open('runs',run.id,'Inspect result and log');
  }
  html+='</div>';
  return html+(run?timingTable(run)+resultTable(run):notice('Prepare this selection before starting the models. The original form lets you review the exact inputs.'));
 }
 function compare(){
  const base=selected('baseline_run_id'),run=matchingRun();
  const compatible=base&&run&&base.id!==run.id&&base.state==='complete'&&run.state==='complete'&&base.selection.grid_id===run.selection.grid_id&&commonModels(base,run).length>0;
  const comparisons=rows('comparisons').filter(item=>item.baseline_run_id===base?.id&&list(item.alternatives).some(alt=>alt.run_id===run?.id));
  let html=facts([['Baseline',base?runTitle(base):'Choose a baseline'],['Alternative',run?runTitle(run):'Prepare and complete an alternative'],['Compared native models',base&&run?commonModels(base,run).map(name=>name.toUpperCase()).join(' + ')||'No common native model':'Choose both runs']]);
  if(!compatible)html+=notice(base?.id===run?.id?'Save and complete a separate alternative before comparing it with the baseline.':'Complete both runs on the same grid with at least one common native model to calculate their differences.');
  else html+='<div class="page-actions">'+action('compare','Compare selected runs','',true)+'</div>';
  if(comparisons.length)html+=select('comparison_id','Saved comparison',comparisons,item=>short(item.id)+' · '+human(item.direction));
  const comparison=selected('comparison_id');
  if(comparison&&comparisons.some(x=>x.id===comparison.id)){
   html+='<div class="page-actions">'+open('comparisons',comparison.id,'Open physical differences')+map('comparisons',comparison.id,'Open difference map')+'</div>';
   html+='<div class="table-scroll"><table><thead><tr><th>Alternative</th><th>Quantity</th><th>Annual change</th><th>Valid cells</th><th>Profile changed</th></tr></thead><tbody>'+list(comparison.alternatives).flatMap(alt=>Object.entries(alt.artifacts||{}).map(([name,item])=>'<tr><td>'+esc(runTitle(row('runs',alt.run_id)))+'</td><td>'+esc(human(name))+'</td><td>'+number(item.sum_change)+' '+esc(item.sum_units||(base.artifacts?.[name]?.sum_units&&base.artifacts[name].sum_units===row('runs',alt.run_id)?.artifacts?.[name]?.sum_units?base.artifacts[name].sum_units:'Total units not recorded'))+'</td><td>'+number(item.valid_cells)+'</td><td>'+esc(alt.profile_changed?'Yes':'No')+'</td></tr>')).join('')+'</tbody></table></div>';
  }
  return html;
 }
 function maps(){
  const run=matchingRun(),comparison=selected('comparison_id');
  let html='<div class="page-actions">'+map('runs',run?.id,'Open selected result')+map('comparisons',comparison?.id,'Open selected comparison')+action('view','Open Spatial review','data-view-name="spatial"')+'</div>';
  html+='<div class="journey-fields">'+select('spatial_review_id','Saved geographic view',rows('spatial_reviews'))+select('spatial_export_id','Complete printable map pack',rows('spatial_exports').filter(x=>x.state==='complete'))+'</div>';
  const review=selected('spatial_review_id'),pack=selected('spatial_export_id');
  html+='<div class="page-actions">'+map('spatial_reviews',review?.id,'Open saved view')+open('spatial_exports',pack?.id,'Open original map files')+'</div>';
  if(pack)html+=facts([['Map pack',pack.title||pack.id],['Saved review',pack.review_id],['Created',when(pack.created_at)],['Resolution',pack.selection?.dpi?pack.selection.dpi+' dpi':'Not recorded']]);
  return html;
 }
 function delivery(){
  const base=selected('baseline_run_id'),run=matchingRun();
  const deliveries=rows('deliveries').filter(item=>item.selection?.baseline_run_id===base?.id&&list(item.selection?.scenario_run_ids).includes(run?.id));
  let html=select('delivery_id','Delivery for the selected baseline and alternative',deliveries,item=>(item.selection?.title||short(item.id))+' · '+human(item.state));
  const item=selected('delivery_id');
  if(base&&run&&(nativeModels(base.selection).length!==2||nativeModels(run.selection).length!==2))html+=notice('The complete seven-map delivery requires both nutrient and sediment models for the baseline and alternative. Prepare NDR + SDR in the original run form before building that delivery.');
  html+='<div class="page-actions">'+action('view','Open scenario reports','data-view-name="scenario-analysis"')+action('delivery','Build or revise complete delivery','',true)+open('deliveries',item?.id,'Open report, maps and package')+'</div>';
  if(item)html+=facts([['Delivery state',human(item.state)],['Original map PDFs',Object.keys(item.maps||{}).length],['Created',when(item.created_at)],['Package audit',item.package?.auditStatus||'In progress']])+(item.error?'<p class="journey-error">'+esc(item.error.message||item.error)+'</p>':'');
  else html+=notice('The original delivery form selects the supporting sources, water designations, observations, map settings and contact details.');
  return html;
 }
 function review(){
  const records=rows('calibration_reviews').filter(item=>item.state==='complete');
  const chosen=selected('calibration_review_id'),context=reviewContext(chosen);
  let html=notice('Optional scientific evidence: this review preserves its own original native selection. Choosing it does not change the scenario comparison or delivery selected in the original eight steps.');
  if(!state()?.data?.calibration)return html+notice('The complete calibration component is not installed in this application. Receive it with the current source package to open original observation-based reviews.');
  html+='<div class="page-actions">'+action('view','Open calibration and validation','data-view-name="calibration"')+'</div>';
  if(!records.length)return html+notice('Complete a calibration analysis and prepare its review package in Calibration and validation. The resulting retained review will be available here.');
  html+=select('calibration_review_id','Completed scientific review',records,item=>(item.title||short(item.id))+' · '+short(item.calibration_id));
  if(!chosen)return html+notice('Choose the exact review edition to carry with this saved project view.');
  html+=facts([['Review',chosen.title||chosen.id],['Calibration',context.calibration_id],['Original plan',context.plan_id],['Selected native run',context.selected_run_id],['Selected parameter profile',context.selected_profile_id],['Source-error edition',context.uncertainty_id||'Not selected'],['Catchment map edition',context.map_id||'Not selected'],['Retained files',number(chosen.file_count)]]);
  html+='<div class="page-actions">'+action('review-open','Open complete review','',true)+action('review-read','Read report')+open('calibrations',context.calibration_id,'Open nominal results')+open('calibration-uncertainties',context.uncertainty_id,'Open source-error sensitivity')+open('calibration-maps',context.map_id,'Open original catchment maps')+'</div>';
  const nativeSession=Object.hasOwn(state()?.data||{},'operator_session');
  if(nativeSession)html+='<div class="page-actions">'+action('save-view','Save review selection and notes')+(state()?.data?.project_continuity?action('handoff','Save view and transfer project','',true):'')+'</div>';
  return html+notice('The saved selection contains one dossier ID. Its calibration, plan, native run, error edition and map edition are derived from that original record and checked again when the saved view is opened or transferred.');
 }
 function reopen(){
  const backup=latestTask('workspace.backup'),restore=latestTask('workspace.restore');
  const nativeSession=Object.hasOwn(state()?.data||{},'operator_session');
  const continuity=state()?.data?.project_continuity?.accepted_actions?.includes('workspace.snapshot');
  let html='<div class="page-actions">'+(continuity&&nativeSession?action('handoff','Save view and transfer project','',true):'')+(continuity?action('view','Receive or continue a project','data-view-name="project-continuity"'):'')+(nativeSession?action('save-view','Save view and notes'):'')+action('backup','Create scientific workspace backup','',!continuity)+action('restore','Restore workspace archive')+action('export','Download journey selections')+action('notes','Download operating notes')+'</div>';
  if(continuity)html+=notice('Project continuity saves the original scientific workspace with selected completed history, unfinished operations and their required original inputs. Choose a complete ZIP or incremental parts there. After receiving, open the returned project, review its saved history and resume selected work.');
  const saved=state()?.data?.operator_session;
  if(saved)html+=facts([['View saved with project',when(saved.saved_at)],['Saved profile',title('profiles',saved.journey?.selection?.profile_id)],['Saved native models',modelLabel(saved.journey?.selection)]])+'<div class="page-actions">'+action('open-saved-view','Open saved project view')+'</div>'+notice('Opening the project view keeps the current browser view available below.');
  if(preferences.browser_view_draft)html+='<div class="page-actions">'+action('swap-browser-view','Switch to retained browser view')+'</div>'+notice('The retained browser view includes its selected records, watershed context and notes. Switching keeps the view you are leaving available for another switch.');
  html+='<label class="journey-import"><span>Open regional workflow or resume a saved journey</span><input type="file" data-journey-import accept=".json,application/json"><small>'+ (nativeSession?'Workspace backups include the saved view and notes. You can also import a separate selections file for the same project.':'Use the regional-workflow-opening.json receipt or journey selections file in the original project or its restored copy.')+'</small></label>';
  if(backup)html+='<h3>Latest native backup</h3>'+facts([['State',human(backup.state)],['Created',when(backup.created_at)],['Bytes',number(backup.result?.bytes)],['Original project',backup.result?.project_id]])+'<div class="page-actions">'+action('task','Open backup and original download','data-id="'+esc(backup.id)+'"')+'</div>';
  if(restore)html+='<h3>Latest native restore</h3>'+facts([['State',human(restore.state)],['Created',when(restore.created_at)],['Original identity',restore.result?.identity||'Available after completion']])+'<div class="page-actions">'+action('task','Inspect restore','data-id="'+esc(restore.id)+'"')+(restore.result?.workspace_key?action('workspace','Open restored workspace','data-id="'+esc(restore.result.workspace_key)+'"'):'')+'</div>';
  const opened=list(state()?.workspaces).find(x=>x.id===workspace());
  if(opened?.received)html+=notice(nativeSession?'This is a restored workspace. Its original project, scientific records and saved operator view are available together. Continue the selected analysis above.':'This is a restored workspace. Its original project and scientific records are available above; import the journey selections to resume your tour.');
  return html+notice('After downloading the native backup, close the operator normally and reopen it with the same workspace and state directory. The workspace selector opens a restored copy while keeping the original project available.');
 }
 function operationTable(){
  const operations=Object.values(preferences.pending).filter(item=>item?.request||item?.task_id);
  if(!operations.length)return '';
  return '<section class="journey-operations"><h2>Operations from this journey</h2><div class="table-scroll"><table><thead><tr><th>Operation</th><th>Original selection</th><th>Current state</th><th></th></tr></thead><tbody>'+operations.map(item=>{
   const task=list(state().tasks).find(row=>row.id===item.task_id||row.operation_id===item.operation_id);
   return '<tr><td>'+esc(human(item.intent))+'</td><td>'+esc(item.selection?.scenario_id?title('scenarios',item.selection.scenario_id):short(item.operation_id))+'</td><td>'+esc(task?human(task.state)+(item.generation!==preferences.generation?' · earlier selection':''):'Response to reconcile')+'</td><td>'+(task?action('task','Open original task','data-id="'+esc(task.id)+'"'):action('recover','Recover original request','data-operation-id="'+esc(item.operation_id)+'"'))+'</td></tr>';
  }).join('')+'</tbody></table></div></section>';
 }
 async function recoverRequest(id){
  const pending=preferences.pending[id];if(!pending?.request)throw Error('This journey has no submitted original request to recover.');
  const originalWorkspace=workspace();await host.refresh({force:true});
  if(workspace()!==originalWorkspace)return;
  let task=list(state().tasks).find(row=>row.id===pending.task_id||row.operation_id===pending.operation_id);
  if(!task){retainIntent(id);task=await host.api('/api/actions',{method:'POST',body:pending.request});}
  if(workspace()!==originalWorkspace)return;
  acceptTask(task,pending.operation_id);await host.refresh({force:true});return host.showTask(task.id);
 }
 const renderers={study,inputs,change,calculate,compare,maps,delivery,reopen,review};
 function render(){
  const step=journeySteps.find(x=>x.id===preferences.step)||journeySteps[0],index=journeySteps.indexOf(step);
  return '<div class="operating-journey"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH</p><h1>Guided operating journey</h1><p>Use the saved project, original calculations and actual delivery controls.</p></div><div class="page-actions">'+action('export','Download selections')+action('notes','Operating notes')+'</div></header>'+
   (storageMessage?notice(storageMessage):'')+
   '<nav class="journey-steps" aria-label="Operating journey steps">'+journeySteps.map((item,i)=>action('step',String(i+1)+'. '+item.title,'data-step="'+item.id+'" aria-current="'+(item.id===step.id?'step':'false')+'"')).join('')+'</nav>'+
   '<section class="journey-main" aria-labelledby="journey-step-title"><p class="eyebrow">STEP '+(index+1)+' OF '+journeySteps.length+'</p><h2 id="journey-step-title">'+esc(step.title)+'</h2>'+
   '<dl class="journey-instructions">'+[['Do',step.do],['See',step.see],['Meaning',step.meaning]].map(([label,text])=>'<div><dt>'+label+'</dt><dd>'+esc(text)+'</dd></div>').join('')+'</dl>'+
   '<blockquote class="journey-speaking">'+esc(step.say)+'</blockquote><div class="journey-work">'+(['study','inputs','compare'].includes(step.id)?'<div data-journey-regional-slot></div>':'')+renderers[step.id]()+'</div>'+
   '<div class="journey-step-actions">'+(index?action('step','Previous step','data-step="'+journeySteps[index-1].id+'"'):'<span></span>')+(index<journeySteps.length-1?action('step','Next: '+journeySteps[index+1].title,'data-step="'+journeySteps[index+1].id+'"',true):action('view','Open workspace overview','data-view-name="overview"'))+'</div></section>'+
   '<section class="journey-notes"><h2>Notes for this project</h2><label><span>Decisions and questions to carry forward</span><textarea data-journey-field="notes" rows="5">'+esc(preferences.notes)+'</textarea></label>'+list(preferences.note_versions).map(version=>'<details><summary>Retained notes · '+esc(when(version.recorded_at))+'</summary><pre class="journey-note-version">'+esc(version.text)+'</pre></details>').join('')+'</section>'+operationTable()+
   '<details class="journey-reference"><summary>Control guide and plain language</summary><dl>'+journeyVocabulary.map(([term,meaning])=>'<dt>'+esc(term)+'</dt><dd>'+esc(meaning)+'</dd>').join('')+'</dl><h3>Questions to be ready for</h3><ul><li>Which source editions and model period are selected?</li><li>Where is the reporting boundary, and how much upstream context is included?</li><li>What exactly changed between the baseline and this alternative?</li><li>Did the biophysical profile also change?</li><li>What are the units and valid-cell coverage of this result?</li><li>Is this a saved result, a current calculation, or a continuation?</li><li>Which observations can be compared with the modeled annual loads?</li><li>Can the recipient reopen the working project and original maps?</li></ul></details></div>';
 }
 function focusState(container){
  const node=document.activeElement;
  if(!container?.contains(node)||!node?.dataset?.journeyField)return null;
  return {field:node.dataset.journeyField,start:node.selectionStart,end:node.selectionEnd};
 }
 function restoreFocus(container,saved){
  if(!saved)return;
  const node=[...container.querySelectorAll('[data-journey-field]')].find(x=>x.dataset.journeyField===saved.field);
  if(node){node.focus({preventScroll:true});if(typeof saved.start==='number'&&typeof node.setSelectionRange==='function')node.setSelectionRange(saved.start,saved.end);}
 }
 function mount(container,next=host.getState()){
  observe(next,hostView());
  if(preferences&&!preferences.active){preferences.active=true;save();}
  if(!preferences)return;
  const focus=focusState(container);detach();mounted=container;
  container.innerHTML=render();
  regional.mount(container.querySelector('[data-journey-regional-slot]'),preferences.step);
  const input=event=>{
   if(event.target.dataset.journeyField==='notes'){preferences.notes=event.target.value;save();}
  };
  const change=async event=>{
   try{
    if(event.target.matches('[data-journey-import]')){const file=event.target.files?.[0];if(file)await importFile(file);return;}
    const field=event.target.dataset.journeyField;if(!Object.hasOwn(fields,field))return;
    const id=event.target.value;if(id&&!row(fields[field],id))throw Error('Choose an item from the current workspace.');
    preferences.generation=crypto.randomUUID();
    if(field==='baseline_run_id')chooseBase(id);
    else{preferences.selection[field]=id;clearDownstream(field);if(field==='run_id'){const run=row('runs',id);if(run){for(const key of ['grid_id','profile_id','scenario_id'])preferences.selection[key]=run.selection[key];preferences.selection.models=nativeModels(run.selection);}}
     if(field==='spatial_review_id'&&selected('spatial_export_id')?.review_id!==id)preferences.selection.spatial_export_id='';
     if(field==='spatial_export_id'){const pack=row('spatial_exports',id);if(pack&&row('spatial_reviews',pack.review_id))preferences.selection.spatial_review_id=pack.review_id;}}
    save();mount(container);updateRail(currentView);
   }catch(error){host.reportError(error);}
  };
  container.addEventListener('input',input);container.addEventListener('change',change);
  removeListeners=()=>{container.removeEventListener('input',input);container.removeEventListener('change',change);};
  restoreFocus(container,focus);
 }
 function detach(){regional.detach();if(removeListeners)removeListeners();removeListeners=null;mounted=null;}
 function updateRail(view){
  currentView=view;
  if(!rail){rail=document.createElement('aside');rail.className='journey-rail';rail.setAttribute('aria-label','Current operating journey');document.querySelector('#content')?.before(rail);}
  const show=preferences?.active&&view!=='journey';rail.hidden=!show;if(!show)return;
  const step=journeySteps.find(x=>x.id===preferences.step)||journeySteps[0];
  rail.innerHTML='<div><strong>'+esc(step.title)+'</strong><p>'+esc(step.do)+'</p></div><div class="page-actions">'+action('home','Return to journey')+'</div>';
 }
 function download(filename,content,type){
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 function exportValue(){
  const taskIds=new Set(Object.values(preferences.pending).map(x=>x?.task_id).filter(Boolean));
  return {schema:SCHEMA,project_id:state().data.project.id,step:preferences.step,started_at:preferences.started_at,selection:{...preferences.selection},regional:regional.capture(),notes:preferences.notes,note_versions:list(preferences.note_versions),observed_at:new Date().toISOString(),recorded_context:{calibration_review:reviewContext(selected('calibration_review_id')),project_title:state().data.project.title,workspace_key:workspace(),tasks:list(state().tasks).filter(task=>taskIds.has(task.id)).map(task=>({id:task.id,operation_id:task.operation_id,action:task.action,state:task.state,created_at:task.created_at,started_at:task.started_at??null,ended_at:task.ended_at??null})),selected_run_timing:nativeTiming(matchingRun(),matchingRun()?latestTask('run.start',matchingRun().id):null)}};
 }
 function operatingNotes(){
  const value=exportValue(),base=selected('baseline_run_id'),run=matchingRun(),lines=['# Upper Savannah — operating notes','',state().data.project.title,'','Recorded: '+value.observed_at,'Project: '+value.project_id,'','## Selected analysis',''];
  for(const [key,collection]of Object.entries(fields))if(value.selection[key])lines.push('- '+human(key)+': '+title(collection,value.selection[key])+' ('+value.selection[key]+')');
  if(value.recorded_context.calibration_review){lines.push('','## Original calibration review','');for(const [key,id]of Object.entries(value.recorded_context.calibration_review))if(id)lines.push('- '+human(key)+': '+id);}
  const regionalNotes=regional.notes();if(regionalNotes)lines.push('',regionalNotes);
  lines.push('','## Operating journey','');
  journeySteps.forEach((step,i)=>lines.push('### '+(i+1)+'. '+step.title,'','Do: '+step.do,'','See: '+step.see,'','Meaning: '+step.meaning,'','Say: '+step.say,''));
  lines.push('## Actual result and timing','');
  for(const [label,item]of [['Baseline',base],['Selected calculation',run]]){
   if(!item)continue;const task=latestTask('run.start',item.id),timing=nativeTiming(item,task);
   lines.push('### '+label,'',runTitle(item),'State: '+timing.label,'Original run: '+item.id,'');
   for(const [name,result]of Object.entries(item.artifacts||{}))lines.push('- '+human(name)+': '+number(result.sum)+' '+(result.sum_units||'total units not recorded')+'; '+number(result.valid_cells)+' valid cells.');
   for(const stage of timing.stages)lines.push('- '+human(stage.name)+': '+(stage.started_at||'start not recorded')+' → '+(stage.completed_at||'completion not recorded')+'; '+duration(stage.duration_ms)+'.');
   if(task)lines.push('- Original task: '+task.id+'; queue '+duration(timing.queue_ms)+'; task duration '+duration(timing.task_ms)+'.');
   lines.push('');
  }
  lines.push('## Working definitions','');for(const [term,meaning]of journeyVocabulary)lines.push('- '+term+': '+meaning);
  lines.push('','## Project notes','',preferences.notes||'No project notes entered.','');
  for(const version of list(preferences.note_versions))lines.push('### Notes retained from another tab','',version.recorded_at||'','',version.text,'');
  return lines.join('\n');
 }
 async function selectOpening(value,{locked=false}={}){
  if(busy&&!locked)throw Error('Wait for the current operation response before importing a regional opening.');
  const originalWorkspace=workspace();if(!locked)busy=true;
  try{
   const opened=await regional.opening(value,state());
   if(workspace()!==originalWorkspace)throw Error('Open the intended regional workspace and import the opening again.');
   const validated=validateJourneyImport({schema:SCHEMA,project_id:state().data.project.id,selection:opened.selection,regional:opened.regional,step:'inputs',notes:preferences.notes,note_versions:preferences.note_versions,started_at:preferences.started_at},state());
   Object.assign(preferences,validated,{active:true,generation:crypto.randomUUID()});
   save();host.toast('Regional watershed selection and scientific profile opened in the original journey.');return host.navigate('journey');
  }finally{if(!locked)busy=false;}
 }
 async function openRetainedView(value,{projectRevision=null}={}){
  if(busy)throw Error('Wait for the current operation response before opening another view.');
  const originalWorkspace=workspace(),generation=preferences.generation,originalSelection=selectionRevision(preferences);
  busy=true;
  try{
   const imported=validateJourneyImport(value,state());
   imported.regional=await regional.validateImport(imported.regional,originalWorkspace);
   if(workspace()!==originalWorkspace||preferences.generation!==generation||selectionRevision(preferences)!==originalSelection)throw Error('The selected workspace or view changed. Open the retained view again.');
   const leaving=exportValue();
   const versions=[...list(preferences.note_versions),...list(imported.note_versions)];
   if(preferences.notes&&preferences.notes!==imported.notes)versions.push({text:preferences.notes,recorded_at:new Date().toISOString()});
   imported.note_versions=versions.filter((item,index,all)=>typeof item?.text==='string'&&all.findIndex(other=>other?.text===item.text)===index);
   Object.assign(preferences,imported,{active:true,generation:crypto.randomUUID(),browser_view_draft:leaving});
   if(projectRevision)preferences.opened_project_revision=projectRevision;
   save();if(mounted)mount(mounted);updateRail(currentView);
   host.toast(projectRevision?'Saved project view opened. The prior browser view is retained.':'Retained browser view opened.');
  }finally{busy=false;}
 }
 async function importFile(file){
  if(busy)throw Error('Wait for the current operation response before importing selections.');
  const originalWorkspace=workspace();busy=true;
  try{
   const value=JSON.parse(await file.text());
   if(workspace()!==originalWorkspace)throw Error('Open the intended workspace and import the journey again.');
   if(value.schema==='upstate.regional-workflow-opening/v1')return await selectOpening(value,{locked:true});
   const imported=validateJourneyImport(value,state());
   imported.regional=await regional.validateImport(imported.regional,originalWorkspace);
   if(workspace()!==originalWorkspace)throw Error('Open the intended workspace and import the journey again.');
   Object.assign(preferences,imported,{active:true,generation:crypto.randomUUID(),pending:{},requests:{}});
   save();if(mounted)mount(mounted);updateRail(currentView);host.toast('Journey selections opened in this original project.');
  }finally{busy=false;}
 }
 async function dispatch(button){
  if(!preferences)throw Error('Open the scientific workspace first.');
  const name=button.dataset.action?.replace(/^journey-/,'');
  if(name?.startsWith('regional-'))return regional.dispatch(button);
  if(name==='home'){preferences.active=true;save();if(mounted)mount(mounted);return host.navigate('journey');}
  if(name==='step'){if(!journeySteps.some(x=>x.id===button.dataset.step))return;preferences.step=button.dataset.step;preferences.active=true;save();if(mounted)mount(mounted);return host.navigate('journey');}
  if(name==='view')return host.navigate(button.dataset.viewName);
  if(name==='review-open'||name==='review-read'){
   const selectedWorkspace=workspace(),generation=preferences.generation,id=preferences.selection.calibration_review_id;
   if(!id||!selected('calibration_review_id'))throw Error('Choose a completed review from this workspace.');
   if(typeof host.openExtension!=='function')throw Error('Receive the maintained extension host to open the original review controller.');
   await host.navigate('calibration');
   if(workspace()!==selectedWorkspace||preferences.generation!==generation||preferences.selection.calibration_review_id!==id)throw Error('The workspace or review selection changed. Open the selected review again.');
   return host.openExtension('calibration','openForReview',{workspace_key:selectedWorkspace,review_id:id,preview:name==='review-read'});
  }
  if(name==='item')return host.openItem(button.dataset.kind,button.dataset.id);
  if(name==='map')return host.openMap(button.dataset.kind,button.dataset.id);
  if(name==='task')return host.showTask(button.dataset.id);
  if(name==='workspace')return host.selectWorkspace(button.dataset.id);
  if(name==='export'){const value=exportValue();download('Upper_Savannah_Journey_'+short(value.project_id)+'.json',JSON.stringify(value,null,2)+'\n','application/json');return;}
  if(name==='notes'){download('Upper_Savannah_Operating_Notes_'+short(state().data.project.id)+'.md',operatingNotes(),'text/markdown;charset=utf-8');return;}
  if(name==='open-saved-view'){
   const saved=state()?.data?.operator_session;
   if(!saved?.journey)throw Error('Save a project view before opening it.');
   return openRetainedView(saved.journey,{projectRevision:saved.revision});
  }
  if(name==='swap-browser-view'){
   if(!preferences.browser_view_draft)throw Error('No earlier browser view is retained.');
   return openRetainedView(preferences.browser_view_draft);
  }
  if(name==='save-view'||name==='handoff'){
   if(busy)throw Error('The current operation is being retained. Wait for its response.');
   const selectedWorkspace=workspace(),generation=preferences.generation;
   const journey=exportValue(),expectedRevision=state().data.operator_session?.revision||null;
   busy=true;button.disabled=true;
   try{
    await host.api('/api/operator-session',{method:'POST',body:{workspace:selectedWorkspace,journey,expected_revision:expectedRevision}});
    if(workspace()!==selectedWorkspace||preferences.generation!==generation)return;
    await host.refresh({force:true});
    if(workspace()!==selectedWorkspace||preferences.generation!==generation)return;
    if(name==='handoff'&&preferences.notes!==journey.notes){host.toast('The saved view is retained. Save your newer local notes before transferring.');return;}
    update();host.toast('Selected analysis and notes saved in this workspace.');
   }finally{busy=false;if(button.isConnected)button.disabled=false;}
   if(name==='handoff')return host.navigate('project-continuity');
   return;
  }
  if(name==='scenario')return form('scenario.save',()=>host.openScenario(preferences.selection.scenario_id));
  if(name==='profile')return form('profile.save',()=>host.openProfile(preferences.selection.profile_id));
  if(name==='grid')return form('grid.prepare',()=>host.openGrid(preferences.selection.grid_id));
  if(name==='prepare')return form('run.prepare',()=>host.openRun({...preferences.selection}));
  if(name==='compare'){
   const base=selected('baseline_run_id'),run=matchingRun();
   if(!base||!run||base.id===run.id||base.state!=='complete'||run.state!=='complete'||base.selection.grid_id!==run.selection.grid_id||!commonModels(base,run).length)throw Error('Complete distinct baseline and alternative runs on the same grid with a common native model.');
   return form('run.compare',()=>host.openComparison({baseline_run_id:base.id,run_ids:[run.id]}));
  }
  if(name==='delivery')return form('delivery.build',()=>(host.openJourneyDelivery||host.openDelivery).call(host,preferences.selection.delivery_id,{baseline_run_id:preferences.selection.baseline_run_id,scenario_run_ids:preferences.selection.run_id?[preferences.selection.run_id]:[],spatial_review_ids:preferences.selection.spatial_review_id?[preferences.selection.spatial_review_id]:[],spatial_export_ids:preferences.selection.spatial_export_id?[preferences.selection.spatial_export_id]:[]}));
  if(name==='backup')return form('workspace.backup',()=>host.openBackup());
  if(name==='restore')return form('workspace.restore',()=>host.openRestore());
  if(name==='recover'||name==='start'){
   if(busy)throw Error('The current operation is being retained. Wait for its response.');
   busy=true;button.disabled=true;
   try{return await (name==='recover'?recoverRequest(button.dataset.operationId):startRun());}finally{busy=false;if(button.isConnected)button.disabled=false;}
  }
 }
 function update(next=host.getState()){
  observe(next,hostView());
  if(mounted)mount(mounted,next);
 }
 const controller={observe,beforeSubmission,acceptTask,mount,update,detach,dispatch,updateRail,selectOpening,isBusy:()=>busy,activate:()=>{if(preferences&&!preferences.active){preferences.active=true;save();}},capture:exportValue};
 function install(){
  if(!document.querySelector('link[data-operating-journey]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/web/journey.css';link.dataset.operatingJourney='';document.head.append(link);}
  if(!document.querySelector('[data-view="journey"]')){
   const overview=document.querySelector('[data-view="overview"]');
   if(overview){const button=document.createElement(overview.tagName.toLowerCase());button.className=overview.className;if(button.tagName==='BUTTON')button.type='button';if(button.tagName==='A')button.href='#journey';button.dataset.view='journey';button.textContent='Guided journey';overview.after(button);}
  }
 }
 if(typeof host.setJourneyController==='function')host.setJourneyController(controller);
 else install();
 observe(host.getState(),hostView());
 return controller;
}
