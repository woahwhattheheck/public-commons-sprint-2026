/* Saved original field selections → ordinary editable native implementation plans. */
const clone=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const validId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const identity=value=>JSON.stringify(value);
const option=(value,label,current)=>'<option value="'+escape(value)+'"'+(value===current?' selected':'')+'>'+escape(label)+'</option>';
const table=(headers,rows,label)=>'<div class="mfa-table" role="region" tabindex="0" aria-label="'+escape(label)+'"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+escape(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const fixed=value=>typeof value==='number'?String(value):'';
const coordinateBasis=area=>area.family==='observation'?area.station?.original_coordinate_crs:area.station?.source_properties?.coordinate_crs;
const rawCoordinates=area=>area.family==='observation'?area.station?.original_coordinates:[area.station?.source_properties?.coordinate_x,area.station?.source_properties?.coordinate_y];

export function attachMonitoringFieldAssignment(host){
  const {getState,api,endpoint,toast,openForm,submitAction,openDesk}=host;
  let root=null,workspace='',epoch=0,events=null,catalogue={sources:[],assignments:[]},previewed=null,opened=null;
  let catalogueRead=0,previewRead=0,fileRead=0,detailRead=0;
  const drafts=new Map();
  const current=()=>getState()?.workspace_key||'';
  const alive=(w,e)=>!!root&&workspace===w&&current()===w&&epoch===e;
  const field=name=>root?.querySelector('[name="'+name+'"]');
  function draft(w=workspace){
    if(!drafts.has(w)){
      let saved={};try{saved=JSON.parse(localStorage.getItem('upstate.field-assignment.'+w)||'{}');}catch{}
      drafts.set(w,{source:typeof saved.source==='string'?saved.source:'',title:typeof saved.title==='string'?saved.title:'Monitoring field assignments',selectionText:typeof saved.selectionText==='string'?saved.selectionText:'',filename:typeof saved.filename==='string'?saved.filename:'',lastTask:typeof saved.lastTask==='string'?saved.lastTask:'',lastOpened:typeof saved.lastOpened==='string'?saved.lastOpened:'',selectionReady:saved.selectionReady===false?false:!!saved.selectionText,selectionRecordId:validId(saved.selectionRecordId)?saved.selectionRecordId:'',edit:0,observedTasks:new Set()});
    }
    return drafts.get(w);
  }
  function persist(w=workspace){
    const d=draft(w);try{localStorage.setItem('upstate.field-assignment.'+w,JSON.stringify({source:d.source,title:d.title,selectionText:d.selectionText,filename:d.filename,selectionReady:d.selectionReady,selectionRecordId:d.selectionRecordId,lastTask:d.lastTask,lastOpened:d.lastOpened}));}catch{}
  }
  function note(text,error=false){
    const node=root?.querySelector('[data-mfa-status]');if(node){node.textContent=text;node.classList.toggle('mfa-error',error);}
  }
  function changed(){
    const d=draft(),source=field('source')?.value||'';if(source!==d.source)d.selectionRecordId='';d.source=source;d.title=field('title')?.value||'';
    d.edit++;previewed=null;++previewRead;persist();renderPreview();
  }
  function controls(){
    const d=draft();
    return '<section class="mfa"><header><h2>Field assignments</h2><p>Bring saved station choices, selected rounds and field notes into an editable implementation plan. Original coordinates, calendar slots and programme costs stay attached.</p></header>'+
      '<div class="mfa-controls"><label>Saved native field selection<select name="native_selection"></select><button type="button" data-mfa-action="native">Use retained selection</button></label><label>Original field-support source<select name="source"></select></label><label>Editable plan title<input name="title" maxlength="240" value="'+escape(d.title)+'"></label>'+
      '<label>Saved field-selection JSON<input name="selection" type="file" accept=".json,application/json"><small data-mfa-file>'+escape((d.filename+(d.selectionReady?'':' · selection not yet admitted'))||'Choose the file saved by the monitoring field desk.')+'</small></label>'+
      '<div class="mfa-actions"><button type="button" data-mfa-action="preview">Review assignments</button><button type="button" data-mfa-action="save" disabled>Create editable plan</button><button type="button" data-mfa-action="refresh">Refresh saved assignments</button></div></div>'+
      '<p role="status" aria-live="polite" data-mfa-status></p><div data-mfa-preview></div>'+
      '<section><h3>Saved assignments</h3><label>Original assignment<select name="saved"></select></label><button type="button" data-mfa-action="open">Open original assignment</button><div data-mfa-detail></div></section></section>';
  }
  async function refresh(){
    const w=workspace,e=epoch,ticket=++catalogueRead;
    const result=await api(endpoint('/api/monitoring-field-assignment/catalog',{workspace:w}));
    if(!alive(w,e)||ticket!==catalogueRead)return;
    catalogue=result;const d=draft(w),choices=list(result.sources).map(row=>({value:identity({source_collection_id:row.source_collection_id,source_id:row.source_id,body_sha256:row.body_sha256}),label:row.title+' · '+row.collection_title}));
    if(d.source&&!choices.some(row=>row.value===d.source))choices.push({value:d.source,label:'Previously selected original source — native preview verifies its availability'});
    field('source').innerHTML=option('','Choose the original field-support document',d.source)+choices.map(row=>option(row.value,row.label,d.source)).join('');
    field('native_selection').innerHTML=option('','Choose an original retained selection',d.selectionRecordId)+list(result.native_selections).map(row=>option(row.id,row.title,d.selectionRecordId)).join('');
    field('saved').innerHTML=option('','Choose a saved assignment',d.lastOpened)+list(result.assignments).map(row=>option(row.id,row.title+' · '+row.assigned_areas+' assigned areas',d.lastOpened)).join('');
    if(!choices.length)note('Import the original field-support source manifest through Sources, then load the selection saved by its field desk.');
  }
  async function readSelection(file){
    if(!file)return;
    const w=workspace,e=epoch,d=draft(w),ticket=++fileRead;
    // Choosing a replacement immediately revokes the earlier preview and confirmation.
    // Retain prior bytes as a draft, but never admit them as the newly selected file.
    d.edit++;d.selectionReady=false;d.selectionRecordId='';d.filename=file.name;previewed=null;++previewRead;
    const edit=d.edit;persist(w);renderPreview();
    root.querySelector('[data-mfa-file]').textContent=file.name+' · reading new selection';
    note('Reading the newly selected file. Review and Create are unavailable until its bytes are loaded.');
    if(file.size>1024*1024){
      root.querySelector('[data-mfa-file]').textContent=file.name+' · not admitted (over 1 MiB)';
      note('Choose a saved field-selection JSON no larger than 1 MiB.',true);return;
    }
    let text;
    try{text=await file.text();}
    catch(error){if(alive(w,e)&&ticket===fileRead&&d.edit===edit){root.querySelector('[data-mfa-file]').textContent=file.name+' · not admitted';note(error.message||String(error),true);}return;}
    if(!alive(w,e)||ticket!==fileRead||d.edit!==edit)return;
    // Native preview validates exact source membership and all saved selection fields.
    if(!text.trim()){root.querySelector('[data-mfa-file]').textContent=file.name+' · empty file, not admitted';note('The selected file is empty. Choose the original saved selection.',true);return;}
    d.selectionText=text;d.selectionReady=true;d.filename=file.name;d.edit++;previewed=null;++previewRead;persist(w);
    root.querySelector('[data-mfa-file]').textContent=file.name+' · '+file.size+' bytes retained';
    renderPreview();note('Original selection loaded. Review its source, station assignments and rounds.');
  }
  async function loadNative(){
    const id=field('native_selection')?.value;
    if(!validId(id))throw Error('Choose an original saved native field selection.');
    const w=workspace,e=epoch,d=draft(w),ticket=++fileRead;
    d.edit++;d.selectionReady=false;d.selectionRecordId='';previewed=null;++previewRead;
    const edit=d.edit;persist(w);renderPreview();
    note('Reading the exact retained field-selection JSON and its verified original source…');
    let value;
    try{value=await api(endpoint('/api/monitoring-field-assignment/selection',{workspace:w,id}));}
    catch(error){if(alive(w,e)&&ticket===fileRead&&d.edit===edit)note(error.message||String(error),true);return;}
    if(!alive(w,e)||ticket!==fileRead||d.edit!==edit)return;
    if(value.selection_record_id!==id||typeof value.selection_text!=='string'||
       !validId(value.source?.source_collection_id)||!validId(value.source?.body_sha256)||
       typeof value.source?.source_id!=='string')throw Error('The native selection reader returned an incomplete original binding.');
    d.selectionText=value.selection_text;d.selectionRecordId=id;d.selectionReady=true;
    d.source=identity(value.source);d.filename='Original native selection '+id.slice(0,12)+'.json';
    if(!d.title.trim()||d.title==='Monitoring field assignments')d.title=(value.title+' — field assignments').slice(0,240);
    d.edit++;persist(w);
    const select=field('source');
    if(!Array.from(select.options||[]).some(row=>row.value===d.source))
      select.innerHTML+=option(d.source,'Retained selection’s original field-support document',d.source);
    select.value=d.source;field('title').value=d.title;field('native_selection').value=id;
    root.querySelector('[data-mfa-file]').textContent=d.filename+' · exact original bytes retained';
    note('Original native field selection loaded. Review its station assignments, calendar and programme budget.');
  }
  function payload(){
    const d=draft();if(!d.source)throw Error('Choose the matching original field-support document.');
    if(!d.selectionReady||!d.selectionText)throw Error('Load the newly selected field-selection JSON before reviewing or saving.');
    return {source:JSON.parse(d.source),title:d.title,selection_text:d.selectionText,...(d.selectionRecordId?{selection_record_id:d.selectionRecordId}:{})};
  }
  async function preview(){
    const w=workspace,e=epoch,d=draft(w),edit=d.edit,ticket=++previewRead,request=payload();
    note('Reading the retained source and saved selection…');
    const result=await api(endpoint('/api/monitoring-field-assignment/preview',{workspace:w}),{method:'POST',body:request});
    if(!alive(w,e)||ticket!==previewRead||d.edit!==edit)return;
    if(!validId(result.id))throw Error('The original assignment preview is incomplete.');
    previewed={result,request:clone(request),edit};renderPreview();note('Review complete. Create the editable plan when these original assignments are ready.');
  }
  function renderPreview(){
    const target=root?.querySelector('[data-mfa-preview]');if(!target)return;
    const button=root.querySelector('[data-mfa-action="save"]');button.disabled=!previewed;
    if(!previewed){target.innerHTML='';return;}
    const p=previewed.result;
    const areas=list(p.areas),rows=areas.map(a=>[a.huc12,a.name,a.assigned?(a.station.name||a.station.id):'Station unassigned',a.station_key||'—',a.family||'—',a.assigned?fixed(a.station.latitude):'—',a.assigned?fixed(a.station.longitude):'—',a.assigned?coordinateBasis(a):'—',a.assigned?JSON.stringify(rawCoordinates(a)):'—',a.planned_slots.length,a.note]);
    const slots=areas.flatMap(a=>list(a.planned_slots).map(s=>[a.huc12,a.station_key||'Station unassigned',s.round,s.date,s.start_local,s.finish_local,s.crew,s.round_deadline]));
    target.innerHTML='<h3>'+escape(p.title)+'</h3><dl class="mfa-summary"><div><dt>Assigned areas</dt><dd>'+p.assigned_areas+'</dd></div><div><dt>Unassigned areas</dt><dd>'+p.unassigned_areas+'</dd></div><div><dt>Planned station visits</dt><dd>'+p.planned_visits+'</dd></div><div><dt>Unassigned calendar slots</dt><dd>'+p.unassigned_slots+'</dd></div><div><dt>Selected rounds</dt><dd>'+escape(list(p.selected_rounds).join(', ')||'None')+'</dd></div><div><dt>Full original programme budget</dt><dd>USD '+escape(p.original_budget_usd)+'</dd></div></dl><p>'+escape(p.budget_note)+'</p><p>'+escape(p.planning_note)+'</p>'+
      '<h4>Original station choices and notes</h4>'+table(['Search area','Area name','Station','Original station key','Source family','Planning latitude','Planning longitude','Original coordinate CRS','Original coordinates','Selected slots','Field notes'],rows,'Original station assignments')+
      '<h4>Selected original calendar slots</h4>'+table(['Search area','Station assignment','Round','Date','Start local','Finish local','Crew','Round deadline'],slots,'Original selected field calendar')+
      '<details><summary>Source identity and original programme costs</summary><pre>'+escape(JSON.stringify({source:p.source,original_plan_id:p.original_plan_id,original_cost:p.original_cost},null,2))+'</pre></details>';
  }
  async function save(){
    if(!previewed||previewed.edit!==draft().edit)throw Error('Review the current assignments before saving.');
    const w=workspace,e=epoch,edit=draft(w).edit,captured=clone(previewed),p=captured.result;
    const request={...captured.request,expected_id:p.id};
    return openForm('Create editable field plan','The original station choices, source files and calendar will be retained with the native plan.',
      '<p><strong>'+escape(p.title)+'</strong></p><p>'+p.assigned_areas+' assigned areas; '+p.unassigned_areas+' unassigned areas; '+p.planned_visits+' planned station visits.</p><p>Full original programme budget: USD '+escape(p.original_budget_usd)+'.</p><p>'+escape(p.budget_note)+'</p>',
      'Create editable plan',async()=>{
        if(!alive(w,e)||draft(w).edit!==edit||identity(payload())!==identity(captured.request))throw Error('The source or selection changed. Review the current assignments again.');
        const task=await submitAction('monitoring.field-assignment.save',clone(request));
        if(task?.id){draft(w).lastTask=task.id;persist(w);}
        return task;
      });
  }
  async function openSaved(id){
    if(!validId(id))throw Error('Choose a complete saved field assignment.');
    const w=current();if(!root||workspace!==w)return openDesk('monitoring-field-assignment','openSaved',id);
    const e=epoch,ticket=++detailRead;
    const value=await api(endpoint('/api/monitoring-field-assignment/detail',{workspace:w,id}));
    if(!alive(w,e)||ticket!==detailRead)return;
    if(value.id!==id)throw Error('The returned assignment does not match the selected original.');
    opened=value;draft(w).lastOpened=id;persist(w);field('saved').value=id;
    const downloads=list(value._downloads).map(row=>{
      if(typeof row.url!=='string'||!/^\/api\/file\//.test(row.url))throw Error('An original report download ticket is missing.');
      return '<li><a href="'+escape(row.url)+'">'+escape(row.label||row.filename||'Original file')+'</a></li>';
    }).join('');
    const originalAreas=list(value.assignment?.areas);
    const stationRows=originalAreas.map(a=>[a.huc12,a.name,a.station_key||'Station unassigned',a.station?.name||'—',a.family||'—',a.assigned?fixed(a.station.latitude):'—',a.assigned?fixed(a.station.longitude):'—',a.assigned?coordinateBasis(a):'—',a.assigned?JSON.stringify(rawCoordinates(a)):'—',a.note]);
    const calendarRows=originalAreas.flatMap(a=>list(a.planned_slots).map(s=>[a.huc12,a.station_key||'Station unassigned',s.round,s.date,s.start_local,s.finish_local,s.crew,s.round_deadline]));
    root.querySelector('[data-mfa-detail]').innerHTML='<h4>'+escape(value.summary.title)+'</h4><p>Original assignment revision '+value.plan.revision+'; current editable revision '+value.current_revision+'.</p><p>'+escape(value.summary.budget_note)+'</p><button type="button" data-mfa-action="implementation">Open editable implementation plan</button><h5>Original station choices and notes</h5>'+table(['Search area','Area name','Station key','Station','Source family','Planning latitude','Planning longitude','Original CRS','Original coordinates','Notes'],stationRows,'Saved original station assignments')+'<h5>Original selected calendar</h5>'+table(['Search area','Station assignment','Round','Date','Start local','Finish local','Crew','Round deadline'],calendarRows,'Saved original calendar')+'<h5>Original report and files</h5><ul>'+downloads+'</ul>';
    note('Original assignment and report reopened. The editable plan retains its current native revision.');
  }
  async function openImplementation(){
    if(!opened)throw Error('Open a saved assignment first.');
    return openDesk('implementation','openSavedPlan',{workspace_key:workspace,plan_id:opened.plan.id});
  }
  function taskActions(task){
    return task?.workspace===current()&&task.action==='monitoring.field-assignment.save'&&task.state==='complete'&&validId(task.result?.id)?
      '<button type="button" data-action="monitoring-field-assignment-open" data-id="'+escape(task.result.id)+'">Open field assignment</button>':'';
  }
  function dispatch(node){
    if(node?.dataset?.action==='monitoring-field-assignment-open')return openSaved(node.dataset.id);
    return false;
  }
  function detach(){++epoch;++fileRead;++previewRead;++detailRead;++catalogueRead;events?.abort();events=null;root=null;workspace='';previewed=null;opened=null;}
  async function mount(container){
    if(root===container&&workspace===current())return update();
    detach();root=container;workspace=current();const w=workspace,e=epoch;root.innerHTML=controls();events=new AbortController();
    root.addEventListener('input',event=>{if(event.target.name==='title')changed();},{signal:events.signal});
    root.addEventListener('change',event=>{
      if(event.target.name==='source')changed();
      if(event.target.name==='selection')readSelection(event.target.files?.[0]).catch(error=>{if(alive(w,e))note(error.message,true);});
    },{signal:events.signal});
    root.addEventListener('click',event=>{
      const node=event.target.closest('[data-mfa-action]');if(!node)return;event.preventDefault();
      const action=node.dataset.mfaAction;
      Promise.resolve().then(()=>({preview,save,refresh,native:loadNative,open:()=>openSaved(field('saved').value),implementation:openImplementation}[action]?.()))
        .catch(error=>{if(alive(w,e))note(error.message,true);});
    },{signal:events.signal});
    try{await refresh();if(alive(w,e)&&draft(w).lastOpened)await openSaved(draft(w).lastOpened);}
    catch(error){if(alive(w,e))note(error.message,true);}
  }
  function update(){
    if(!root)return;
    if(workspace!==current()){const container=root;return mount(container);}
    const d=draft(),task=list(getState()?.tasks).find(row=>row.id===d.lastTask&&row.workspace===workspace);
    if(task?.state==='complete'&&!d.observedTasks.has(task.id)){
      d.observedTasks.add(task.id);persist();const w=workspace,e=epoch;
      note('Field assignment saved. Open its original report or continue in the editable implementation plan.');
      refresh().catch(error=>{if(alive(w,e))note(error.message,true);});
    }
  }
  return {mount,update,detach,taskActions,dispatch,openSaved};
}
