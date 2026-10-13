import {clone,canonical,createPreparationStorage,workingCopyEnvelope,validateWorkingCopy,workingSelection} from './delivery_preparation_storage.mjs';
const text=value=>String(value??''), list=value=>Array.isArray(value)?value:[], object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>text(value).slice(0,12), pretty=value=>JSON.stringify(value,null,2), human=value=>text(value).replaceAll('_',' ');
const date=value=>value?new Date(value).toLocaleString('en-US'):'Not yet saved';
const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
const button=(action,label,attrs='',primary=false)=>'<button type="button" data-dp-action="'+esc(action)+'" '+attrs+(primary?' class="primary"':'')+'>'+esc(label)+'</button>';
const option=(id,label,selected)=>'<option value="'+esc(id)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const input=(path,label,value,attrs='',help='')=>'<label class="dp-field"><span>'+esc(label)+'</span><input data-dp-field="'+esc(path)+'" value="'+esc(value)+'" '+attrs+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const textarea=(path,label,value,help='')=>'<label class="dp-field"><span>'+esc(label)+'</span><textarea data-dp-field="'+esc(path)+'" rows="4">'+esc(value)+'</textarea>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const MAPS=[['future_sediment_loss','Future sediment loss','Explicit future land-cover alternatives'],['future_nutrient_runoff','Future nutrient runoff','Explicit future land-cover alternatives'],['critical_drinking_water','Critical drinking-water areas','Original source designation and method'],['high_quality_waters','High-quality waters','Original source designation and method'],['current_nutrient_export','Current nutrient export','Original baseline NDR results'],['current_sediment_export','Current sediment export','Original baseline SDR results'],['combined_pollutant_export','Combined pollutant export','Common support, retained weights and caps']];
const SOURCE_ROLES=[['PROTECTED_LANDS','Protected lands'],['PARCEL','Original parcels'],['NHD','Hydrography'],['NWI','Wetlands'],['OBSERVED_CONTEXT','Observed context']];
const OVERLAYS=[['drinking_water','Critical drinking-water source areas'],['high_quality_waters','Designated high-quality waters'],['protected_lands','Protected-land map overlay'],['parcels','Parcel priority inventory']];
const POLLUTANTS=['nitrogen_export','phosphorus_export','sediment_export'];
const ENDPOINT='/api/delivery-preparation/';
function get(row,path){for(const key of path.split('.')){if(['__proto__','prototype','constructor'].includes(key))return undefined;row=row?.[key];}return row;}
function set(row,path,value){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Choose an ordinary native field.');const last=keys.pop();let cursor=row;for(const key of keys){if(!object(cursor[key]))cursor[key]={};cursor=cursor[key];}if(value===undefined)delete cursor[last];else cursor[last]=value;}
function fullRun(row){return row?.state==='complete'&&['ndr','sdr'].every(model=>{const stage=row.stages?.[model]||row.stage_summary?.[model];return (row.selection?.models??['ndr','sdr']).includes(model)&&stage?.completed_at&&(stage.file_count??Object.keys(stage.files||{}).length)>0;})&&POLLUTANTS.every(key=>row.artifacts?.[key]);}
function download(body,name,type='application/json'){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function originalChoice(choice){return choice&&Object.keys(choice).filter(k=>!['source_collection_id','source_id','layer','where','label'].includes(k));}
export function createDeliveryPreparationDesk(host) {
  const storage=createPreparationStorage();let node=null,abort=null,workspace=null,project=null,scope=null,lifecycle=0,busy=false;
  let current=null,catalog=null,preview=null,message='',failed=false,search='',pendingPoll=false;
  const local=new Map(),unwritten=new Map(),errors=new Map(),chains=new Map(),revisions=new Map();
  const $=selector=>node?.querySelector(selector), $$=selector=>node?[...node.querySelectorAll(selector)]:[];
  const state=()=>host.getState(), data=()=>state()?.data||{};
  const active=(origin,generation)=>!!node&&workspace===origin&&state()?.workspace_key===origin&&generation===lifecycle;
  const projectInfo=snapshot=>({id:snapshot?.data?.project?.id,title:snapshot?.data?.project?.title||snapshot?.workspace?.title||'Scientific workspace'});
  const key=draft=>scope+':'+draft.id;
  const signature=draft=>canonical({title:draft.title,purpose:draft.purpose,selection:draft.selection,raw:draft.raw,base:draft.base});
  const operations=draft=>list(draft?.operations);
  const unsettled=draft=>operations(draft).filter(op=>!['complete','rejected'].includes(op.state));
  function status(value='',isError=false){message=text(value);failed=isError;const target=$('[data-dp-status]');if(target){target.textContent=message;target.hidden=!message;target.classList.toggle('dp-error',isError);}}
  function ensure(){if(!workspace||workspace!==state()?.workspace_key)throw Error('Reopen this preparation in its original workspace.');if(!project?.id)throw Error('The original scientific project identity is unavailable.');}
  async function read(operation,payload={},origin=workspace){return host.api(ENDPOINT+operation,{method:'POST',body:{workspace:origin,...payload}});}
  function lock(){if(!node)return;for(const el of $$('button,input,select,textarea')){if(!el.hasAttribute('data-dp-permanent-disabled')&&!el.hasAttribute('data-dp-import'))el.disabled=busy;}if(current&&unsettled(current).length)for(const el of $$('[data-dp-editor] input,[data-dp-editor] select,[data-dp-editor] textarea,[data-dp-editor] button'))el.disabled=true;}
  async function persist(draft=current,{strict=false,originScope=scope}={}){
    if(!draft)return null;const snapshot=clone(draft),recordKey=originScope+':'+snapshot.id;
    unwritten.set(recordKey,snapshot);local.set(recordKey,snapshot);
    const previous=chains.get(recordKey)||Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      if(errors.has(recordKey))throw errors.get(recordKey);
      try{
        const saved=await storage.write(originScope,snapshot.id,revisions.get(recordKey)||0,snapshot);
        revisions.set(recordKey,saved.revision);if(canonical(unwritten.get(recordKey))===canonical(snapshot))unwritten.delete(recordKey);
        return saved;
      }catch(error){errors.set(recordKey,error);throw error;}
    });
    chains.set(recordKey,next);
    try{return await next;}catch(error){if(current?.id===snapshot.id&&scope===originScope)status(error.message,true);if(strict)throw error;return null;}
  }
  async function flush(draft=current,originScope=scope){if(!draft)return;await persist(draft,{strict:true,originScope});}
  async function recall(originScope=scope){
    const rows=await storage.list(originScope);
    for(const row of rows){const k=originScope+':'+row.id;if(unwritten.has(k)||errors.has(k))continue;local.set(k,row.body);revisions.set(k,row.revision);}
    return rows;
  }
  async function reload(){
    ensure();const origin=workspace,generation=lifecycle,old=current?.id;
    await recall();if(!active(origin,generation))return;const result=await read('catalog',{},origin);
    if(!active(origin,generation))return;catalog=result;
    if(old){const k=scope+':'+old;current=clone(unwritten.get(k)||local.get(k)||current);}
    render();status(message,failed);
  }
  function listDrafts(){return [...local.entries()].filter(([k])=>k.startsWith(scope+':')).map(([,d])=>d);}
  function runs(){return list(data().runs);}
  function scenario(run){return list(data().scenarios).find(s=>s.id===run?.selection?.scenario_id);}
  function runName(run){const s=scenario(run),profile=list(data().profiles).find(p=>p.id===run?.selection?.profile_id);return (s?.title||short(run?.id))+' · '+(profile?.title||short(run?.selection?.profile_id));}
  function baselines(){return runs().filter(r=>fullRun(r)&&scenario(r)?.kind==='baseline');}
  function alternatives(){const b=runs().find(r=>r.id===current?.selection?.baseline_run_id);return runs().filter(r=>fullRun(r)&&scenario(r)?.kind==='landcover'&&r.id!==b?.id&&r.selection.grid_id===b?.selection.grid_id&&r.selection.profile_id===b?.selection.profile_id);}
  function sources(){return list(data().sources);}
  function boundCohort(){const s=current?.selection||{};return !!(s.source_scenario_analysis_id||s.source_decision||s.source_report_id);}
  function scalar(path,fallback=''){return own(current.raw,path)?current.raw[path]:get(current.selection,path)??fallback;}
  function matches(row){return !search||canonical([row.title,row.id,row.preparation_id]).toLowerCase().includes(search.toLowerCase());}
  function items(){return list(catalog?.preparations||catalog?.items);}
  function renderLibrary(){
    const target=$('[data-dp-library]');if(!target)return;
    target.innerHTML='<h2>Saved preparations</h2>'+items().filter(matches).map(row=>button('open',row.title||short(row.preparation_id||row.id),'data-dp-id="'+esc(row.preparation_id||row.id)+'"')+'<small>Revision '+esc(row.revision)+' · '+esc(date(row.updated_at||row.created_at))+'</small>').join('')+
      (!items().length?'<p>Save a named preparation to retain it with this project.</p>':'')+
      (catalog?.next_offset!=null?button('more','Load more saved preparations'):'')+
      '<small>'+items().length+' of '+(catalog?.total??items().length)+' saved preparations</small>'+
      '<h2>Working copies</h2>'+listDrafts().filter(matches).map(row=>button('draft',row.title||'Untitled preparation','data-dp-id="'+esc(row.id)+'"')+'<small>'+(errors.has(scope+':'+row.id)?'Local save needs attention':unsettled(row).length?'Original operation pending':'Editable working copy')+'</small>').join('');
  }
  function checks(path,title,rows,selected,help=''){
    const chosen=list(selected),choices=new Map(rows.map(row=>[row.id,row]));for(const id of chosen)if(!choices.has(id))choices.set(id,{id,title:'Retained selection · '+short(id)});
    return '<fieldset><legend>'+esc(title)+'</legend>'+(help?'<p>'+esc(help)+'</p>':'')+'<div class="dp-checks">'+[...choices.values()].map(row=>'<label><input type="checkbox" data-dp-list="'+esc(path)+'" value="'+esc(row.id)+'"'+(chosen.includes(row.id)?' checked':'')+'><span>'+esc(row.title||row.id)+'</span></label>').join('')+'</div></fieldset>';
  }
  function selectField(path,label,rows,value,help='',attrs=''){
    const options=[...rows];if(value&&!options.some(row=>row[0]===value))options.push([value,'Retained original · '+short(value)]);
    return '<label class="dp-field"><span>'+esc(label)+'</span><select data-dp-field="'+esc(path)+'" '+attrs+'>'+option('','Choose an original record',!value)+options.map(([id,title])=>option(id,title,id===value)).join('')+'</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
  }
  function choiceCard(path,label,vector=false){
    const choice=get(current.selection,path), enabled=!!choice, selection=choice||{}, collection=sources().find(s=>s.id===selection.source_collection_id), locked=originalChoice(choice)?.length;
    return '<fieldset class="dp-source"><legend>'+esc(label)+'</legend><label class="dp-check"><input type="checkbox" data-dp-source-toggle="'+esc(path)+'"'+(enabled?' checked':'')+'><span>Include this source</span></label>'+
      (enabled?'<div class="dp-grid">'+selectField(path+'.source_collection_id','Source collection',sources().map(s=>[s.id,s.title||short(s.id)]),selection.source_collection_id)+
        selectField(path+'.source_id','Original source',list(collection?.entries).filter(e=>!vector||e.kind==='vector').map(e=>[e.id,e.title||e.id]),selection.source_id)+
        (vector?input(path+'.layer','Original layer',selection.layer||'')+textarea(path+'.where','Exact original attribute filter',own(current.raw,path+'.where')?current.raw[path+'.where']:pretty(selection.where||{}),'JSON object of exact original field names and values. Empty object selects the full layer.'):'')+'</div>'+
        (locked?'<p class="dp-note">This choice retains a saved designation or source binding. Changing the original source, layer or filter requires a new reviewed source choice. Its retained metadata remain below.</p>':'')+
        '<div class="dp-actions">'+button('source','Inspect original source','data-dp-collection="'+esc(selection.source_collection_id||'')+'" data-dp-id="'+esc(selection.source_id||'')+'"')+
        (locked?button('release-source','Choose another source','data-dp-path="'+esc(path)+'"'):'')+'</div>'+
        '<details><summary>Complete source selection</summary><pre>'+esc(pretty(selection))+'</pre></details>':'')+'</fieldset>';
  }
  function editorHTML(){
    if(!current)return '<section class="dp-panel"><h2>Prepare the complete map delivery</h2><p>Keep the selected native results, original sources, map presentation and delivery notes together. Start a new preparation or revise a retained delivery.</p>'+button('new','New preparation','',true)+'</section>';
    const s=current.selection, base=current.base, locked=boundCohort(), pending=unsettled(current).length;
    const errorsHTML=errors.has(key(current))?'<section class="dp-conflict"><h2>Keep your unsaved work</h2><p>'+esc(errors.get(key(current)).message)+'</p><div class="dp-actions">'+button('fork','Save these changes as a separate copy')+button('reopen-local','Reopen the other saved copy')+button('download','Download this complete working copy')+'</div></section>':'';
    return errorsHTML+'<section class="dp-panel"><header class="dp-panel-heading"><div><h2>'+esc(current.title||'Untitled preparation')+'</h2><p>'+(base?'Working from saved revision '+esc(base.revision):'New preparation')+' · '+esc(current.origin?.label||'Original scientific workspace')+'</p></div><div class="dp-actions">'+button('download','Download working copy')+button('fork','Separate copy')+button('new-cohort','Copy settings for another cohort')+'</div></header>'+
      '<div class="dp-operation-strip" data-dp-operations></div>'+
      (pending?'<p class="dp-note">Recover the pending original operation before editing this copy. A separate copy retains these inputs for additional work.</p>':'')+
      '<form data-dp-editor><div class="dp-grid">'+input('@title','Preparation name',current.title,'required maxlength="200"')+textarea('@purpose','Purpose and intended recipient',current.purpose)+
      input('title','Delivery title',scalar('title'),'required')+selectField('delivery_mode','Delivery context',[['regional_rfp','Regional RFP — seven map families'],['native_study','Original native study']],s.delivery_mode||'regional_rfp')+'</div>'+
      (s.delivery_mode==='native_study'?'<fieldset><legend>Original study context</legend>'+input('native_study.title','Study title',scalar('native_study.title'),'required')+textarea('native_study.purpose','Study purpose',scalar('native_study.purpose'))+input('native_study.reference','Original reference',scalar('native_study.reference'))+'</fieldset>':'')+
      '<section class="dp-section"><h3>Current baseline and future alternatives</h3><p>The original baseline supplies current export. Explicit land-cover alternatives supply future maps. All selected runs use the same native grid and parameter profile.</p>'+
      selectField('baseline_run_id','Completed original baseline',baselines().map(r=>[r.id,runName(r)]),s.baseline_run_id,locked?'The attached scientific source binds this original cohort. Start a new preparation to select a different cohort.':'Completed NDR and SDR with all three native export rasters.',locked?'disabled data-dp-permanent-disabled':'')+
      '<div'+(locked?' class="dp-bound-cohort"':'')+'>'+checks('scenario_run_ids','Completed land-cover alternatives',alternatives().map(r=>({id:r.id,title:runName(r)})),s.scenario_run_ids)+'</div>'+
      (locked?'<p class="dp-note">Original scientific cohort is retained. “Copy settings for another cohort” keeps your map, source and contact settings, while explicitly detaching the linked analysis, report, decision and economic edition. Their complete original bindings remain in the new copy’s history.</p>':'')+
      '<details><summary>Reporting domain and native source bindings</summary><p>Reporting limits and the external modeled buffer remain the selected original grid. The saved source records below retain their scientific methods and identities.</p><pre>'+esc(pretty({baseline_run_id:s.baseline_run_id,scenario_run_ids:s.scenario_run_ids,grid:runs().find(r=>r.id===s.baseline_run_id)?.selection?.grid_id,bindings:Object.fromEntries(Object.entries(s).filter(([k])=>/binding|^source_|^coefficient_|^economic_|native_execution|receptor_spec/.test(k)))}))+'</pre></details></section>'+
      '<section class="dp-section"><h3>Original sources and water designations</h3><p>Keep drinking-water and high-quality designations distinct from modeled exports. Inspect the original source and its method before selecting a replacement.</p>'+
      SOURCE_ROLES.map(([id,label])=>choiceCard('source_roles.'+id,label)).join('')+
      OVERLAYS.map(([id,label])=>choiceCard('overlays.'+id,label,true)).join('')+
      textarea('observed_context_sources','Additional observed-context sources',own(current.raw,'observed_context_sources')?current.raw.observed_context_sources:pretty(s.observed_context_sources||[]),'Complete source selections as a JSON array; the first observed-context role above remains retained.')+'</section>'+
      '<section class="dp-section"><h3>Map presentation and priority settings</h3><p>These settings use the existing delivery renderer. Map DPI does not change the native analytical grid. Explicit zero caps remain zero.</p><div class="dp-grid">'+
      POLLUTANTS.map(k=>input('map_settings.weights.'+k,human(k)+' weight',scalar('map_settings.weights.'+k,1),'type="number" min="0" step="any"')).join('')+
      POLLUTANTS.map(k=>input('map_settings.caps.'+k,human(k)+' cap',scalar('map_settings.caps.'+k),'type="number" min="0" step="any"','Blank uses the original engine’s positive-cell 95th percentile. Units remain the original raster units.')).join('')+
      selectField('map_settings.paper','Paper size',[['letter','US letter'],['a4','A4'],['a3','A3']],s.map_settings?.paper||'letter')+
      input('map_settings.dpi','PDF resolution (DPI)',scalar('map_settings.dpi',220),'type="number" min="120" max="600" step="1"')+
      input('map_settings.display_percentile','Map display percentile',scalar('map_settings.display_percentile',98),'type="number" min="0" max="100" step="any"')+
      input('map_settings.title','Map title',scalar('map_settings.title'),'maxlength="140"')+
      input('map_settings.subtitle','Map subtitle',scalar('map_settings.subtitle'),'maxlength="220"')+'</div>'+
      '<div class="dp-map-family">'+MAPS.map(([id,title,meaning])=>'<article><h4>'+esc(title)+'</h4><p>'+esc(meaning)+'</p>'+input('map_settings.family_titles.'+id,'Optional map heading',scalar('map_settings.family_titles.'+id),'maxlength="110"')+'</article>').join('')+'</div></section>'+
      '<section class="dp-section"><h3>Retained review and report attachments</h3>'+checks('observation_comparison_ids','Observed-load comparisons',list(data().observation_comparisons).map(r=>({id:r.id,title:r.title||short(r.id)})),s.observation_comparison_ids)+
      checks('spatial_review_ids','Saved spatial review views',list(data().spatial_reviews),s.spatial_review_ids)+checks('spatial_export_ids','Complete printable map packs',list(data().spatial_exports).filter(r=>r.state==='complete'),s.spatial_export_ids)+
      '<details><summary>Additional exact scientific and delivery fields</summary><p>The complete selection is preserved, including source reports, scenario analysis, decisions, economic editions, receiving-water configuration and coefficient evidence. Use this original JSON to import a native selection; checking it never calculates replacement science.</p>'+
      textarea('@selection-json','Complete original selection',own(current.raw,'@selection-json')?current.raw['@selection-json']:pretty(s))+
      button('apply-json','Apply this complete selection')+'</details></section>'+
      '<section class="dp-section"><h3>Metadata contact and interpretation</h3><div class="dp-grid">'+
      input('contact.name','Contact name',scalar('contact.name'),'required')+input('contact.organization','Organization',scalar('contact.organization'),'required')+
      input('contact.email','Email',scalar('contact.email'),'type="email" required')+
      textarea('contact.address','Address',scalar('contact.address'))+textarea('notes','Delivery and interpretation notes',own(current.raw,'notes')?current.raw.notes:list(s.notes).join('\n'),'One note per line; retain limitations, interpretation and source qualifications.')+'</div></section>'+
      '<footer class="dp-actions">'+button('check','Check current preparation')+button('save','Save preparation revision','',true)+'</footer></form></section>'+
      '<section class="dp-panel" data-dp-preview></section>'+
      (base?'<section class="dp-panel"><h2>Build the saved revision</h2><p>The build uses the exact saved preparation and the original delivery engine. Unsaved edits do not change that saved build.</p><div class="dp-actions">'+button('build','Build saved revision '+base.revision,'',true)+button('history','Read complete saved history')+button('project-transfer','Open complete project handoff')+'</div><div data-dp-history></div></section>':'');
  }
  function render(){
    if(!node)return;node.classList.add('delivery-preparation');
    node.innerHTML='<header class="dp-heading"><div><p class="eyebrow">SCIENTIFIC DELIVERY</p><h1>Delivery preparation</h1><p>Save and continue the complete map selection before building its reports, GIS data, metadata and working project.</p></div><div class="dp-actions">'+button('new','New preparation','',true)+button('refresh','Refresh saved records')+button('import','Open working copy')+'</div></header><p class="dp-status" data-dp-status role="status" aria-live="polite" hidden></p>'+
      '<input type="file" data-dp-import accept=".json,application/json" hidden><div class="dp-layout"><aside class="dp-library"><label class="dp-field"><span>Find a preparation</span><input type="search" data-dp-search value="'+esc(search)+'"></label><div data-dp-library></div><h2>Revise a delivery</h2>'+list(data().deliveries).map(row=>button('delivery',row.selection?.title||row.title||short(row.id),'data-dp-id="'+esc(row.id)+'"')).join('')+'</aside><main class="dp-main" data-dp-main>'+editorHTML()+'</main></div>';
    if(boundCohort())for(const el of $$('[data-dp-list="scenario_run_ids"]')){el.disabled=true;el.setAttribute('data-dp-permanent-disabled','');}
    renderLibrary();renderOperations();renderPreview();status(message,failed);lock();
  }

  function renderOperations(){
    const target=$('[data-dp-operations]');if(!target||!current)return;
    target.innerHTML=operations(current).slice().reverse().map(op=>'<article><div><strong>'+esc(op.request.action.endsWith('.save')?'Save preparation':'Build saved delivery')+'</strong> · '+esc(human(op.state||'prepared'))+'<small>'+esc(date(op.created_at))+'</small></div>'+
      (op.error?'<p class="dp-error">'+esc(op.error.message||op.error)+'</p>':'')+
      '<div class="dp-actions">'+button('receive','Read original result','data-dp-operation="'+esc(op.operation_id)+'"')+
      (op.state==='not_found'&&op.request.workspace===workspace?button('retry','Submit same original request','data-dp-operation="'+esc(op.operation_id)+'"'):'')+
      (op.task_id?button('task','Open retained operation','data-dp-id="'+esc(op.task_id)+'"'):'')+
      (['failed','interrupted','cancelled'].includes(op.task_state)?button('resume','Resume same operation','data-dp-operation="'+esc(op.operation_id)+'"'):'')+
      (op.delivery_id&&op.outputs_available!==false?button('output','Open complete delivery','data-dp-id="'+esc(op.delivery_id)+'"'):'')+'</div>'+
      (op.state==='not_found'&&op.request.workspace!==workspace?'<p>Receive the original operator task history in this workspace before continuing this pending request. Its original workspace binding has been preserved.</p>':'')+
      (op.outputs_available===false?'<p>The original accepted result is retained. Its output files were not included in this received workspace; receive the complete original delivery before opening them.</p>':'')+
      '<details><summary>Exact retained request and result</summary><pre>'+esc(pretty(op))+'</pre></details></article>').join('');
  }
  function renderPreview(){
    const target=$('[data-dp-preview]');if(!target)return;
    if(!preview){target.innerHTML='<h2>Preparation readiness</h2><p>Checking this preparation reads its saved source identities and current readiness. The original builder performs the final native checks when a saved revision is built.</p>';return;}
    target.innerHTML='<h2>'+(preview.result.eligible?'Ready for original build validation':'Preparation needs attention')+'</h2><p>Checked against the displayed draft. Editing any field clears this result.</p>'+
      (list(preview.result.issues).length?'<ul>'+preview.result.issues.map(x=>'<li><strong>'+esc(x.code)+'</strong> — '+esc(x.message)+'</li>').join('')+'</ul>':'<p>No readiness issue was returned for these selected inputs.</p>')+
      '<details><summary>Complete checked selection and source snapshot</summary><pre>'+esc(pretty(preview.result))+'</pre></details>';
  }
  function newDraft(selection={},extra={}){
    return {id:crypto.randomUUID(),preparation_id:crypto.randomUUID(),base:null,title:selection.title||'Map delivery preparation',purpose:'',selection:clone(selection),raw:{},operations:[],created_at:new Date().toISOString(),origin:null,...clone(extra)};
  }
  async function chooseDraft(draft){
    const origin=workspace,generation=lifecycle,originalScope=scope,selected=clone(draft),previous=current?clone(current):null;
    if(previous)await persist(previous,{originScope:originalScope});
    if(!active(origin,generation))return false;
    current=selected;preview=null;local.set(originalScope+':'+selected.id,clone(selected));
    await persist(selected,{strict:true,originScope:originalScope});
    if(!active(origin,generation)||current?.id!==selected.id)return false;
    render();return true;
  }
  async function create(selection={},origin=null){
    ensure();return chooseDraft(newDraft(selection,{origin}));
  }
  async function open(id,revision){
    ensure();const origin=workspace,generation=lifecycle,originalScope=scope,originalProject=clone(project),previous=current?clone(current):null;
    if(previous)await persist(previous,{originScope:originalScope});
    if(!active(origin,generation))return;
    const record=await read('item',{preparation_id:id,...(revision?{revision}:{})},origin);
    if(!active(origin,generation))return;
    if(record.project_id!==originalProject.id||!record.preparation)throw Error('The saved preparation does not belong to this original scientific project.');
    const p=record.preparation;
    const found=listDrafts().find(d=>d.base?.preparation_id===p.id&&d.base?.revision===p.revision&&!unsettled(d).length);
    if(found){current=clone(unwritten.get(scope+':'+found.id)||found);preview=null;render();return;}
    await chooseDraft(newDraft(p.selection,{preparation_id:p.id,base:{preparation_id:p.id,revision:p.revision,revision_id:p.revision_id},title:p.title,purpose:p.purpose,saved_content:{title:p.title,purpose:p.purpose,selection:clone(p.selection)},origin:{label:'Saved preparation revision '+p.revision,record:p}}));
  }
  async function fromDelivery(id){
    ensure();const origin=workspace,generation=lifecycle,record=await host.api(host.endpoint('/api/item',{kind:'deliveries',id}));
    if(!active(origin,generation))return;
    if(!object(record?.selection))throw Error('The retained delivery has no complete native selection.');
    return create(record.selection,{label:'Original delivery '+short(id),delivery_id:id});
  }
  function selection(){return workingSelection(current);}
  function savePayload(){return {preparation_id:current.base?.preparation_id||current.preparation_id,expected_revision:current.base?.revision||0,title:current.title,purpose:current.purpose,selection:selection()};}
  function invalidate(){preview=null;current.updated_at=new Date().toISOString();local.set(key(current),clone(current));void persist();renderPreview();}
  function changedOverlay(path){
    const match=/^overlays\.([^.]+)/.exec(path);if(!match)return;
    current.raw['@changed-overlays']=[...new Set([...list(current.raw['@changed-overlays']),match[1]])];
  }
  function change(event){
    const el=event.target;if(el.hasAttribute('data-dp-search')){search=el.value;renderLibrary();return;}
    if(!current||busy||unsettled(current).length)return;
    if(el.dataset.dpField){
      const path=el.dataset.dpField;
      if(path==='@title')current.title=el.value;
      else if(path==='@purpose')current.purpose=el.value;
      else if(path==='@selection-json')current.raw[path]=el.value;
      else if(path==='baseline_run_id'){
        if(boundCohort())throw Error('The original scientific source binds this cohort.');
        current.selection.baseline_run_id=el.value;current.selection.scenario_run_ids=[];delete current.raw[path];invalidate();render();return;
      } else if(path==='delivery_mode'){
        current.selection.delivery_mode=el.value;delete current.raw[path];invalidate();render();return;
      } else if(path.endsWith('.source_collection_id')||path.endsWith('.source_id')){
        const parent=path.slice(0,path.lastIndexOf('.')),choice=get(current.selection,parent);
        if(originalChoice(choice)?.length){el.value=get(current.selection,path)||'';status('Retain this bound source, or explicitly choose another original source first.',true);return;}
        changedOverlay(path);set(current.selection,path,el.value);
        if(path.endsWith('.source_collection_id'))set(current.selection,parent+'.source_id','');
        invalidate();render();return;
      } else {
        const parent=path.endsWith('.where')||path.endsWith('.layer')?path.slice(0,path.lastIndexOf('.')):null;
        if(parent&&originalChoice(get(current.selection,parent))?.length){el.value=path.endsWith('.where')?pretty(get(current.selection,path)||{}):get(current.selection,path)||'';status('A retained designation binds this filter and layer. Use a reviewed replacement source choice.',true);return;}
        changedOverlay(path);current.raw[path]=el.value;
      }
      invalidate();return;
    }
    if(el.dataset.dpList){
      const path=el.dataset.dpList;
      if(path==='scenario_run_ids'&&boundCohort()){el.checked=list(current.selection.scenario_run_ids).includes(el.value);return;}
      current.selection[path]=$$('[data-dp-list="'+path+'"]:checked').map(x=>x.value);invalidate();return;
    }
    if(el.dataset.dpSourceToggle){
      const path=el.dataset.dpSourceToggle;
      if(!el.checked&&originalChoice(get(current.selection,path))?.length){el.checked=true;status('Use “Choose another source” to explicitly release a retained source binding.',true);return;}
      changedOverlay(path);set(current.selection,path,el.checked?{source_collection_id:'',source_id:''}:undefined);
      for(const raw of Object.keys(current.raw))if(raw.startsWith(path+'.'))delete current.raw[raw];
      invalidate();render();
    }
  }
  async function retainOperationResult(draftId,originalScope,operationId,receipt,context){
    const k=originalScope+':'+draftId;
    const base=clone(unwritten.get(k)||local.get(k));
    if(!base)throw Error('The original working copy is unavailable; the server result remains retained.');
    const op=base.operations.find(x=>x.operation_id===operationId);if(!op)throw Error('The original saved request is unavailable.');
    op.receipt=clone(receipt);op.received_at=new Date().toISOString();
    const task=receipt.task;op.task_id=task?.id||receipt.task_id||op.task_id;op.task_state=task?.state||op.task_state;
    op.error=receipt.error||task?.error||null;op.outputs_available=receipt.outputs_available??null;
    if(receipt.status==='NOT_FOUND')op.state=op.claimed_complete?'verification_required':'not_found';
    else if(task?.state==='complete'||['SAVED','COMPLETE'].includes(receipt.status))op.state='complete';
    else op.state=task?.state||text(receipt.status||'pending').toLowerCase();
    const result=task?.result||receipt.result;
    if(op.state==='complete'){
      const p=result?.preparation||result?.record||receipt.preparation;
      if(op.request.action==='delivery.preparation.save'){
        if(!p||p.id!==op.request.payload.preparation_id||p.title!==op.request.payload.title||p.purpose!==op.request.payload.purpose||canonical(p.selection)!==canonical(op.request.payload.selection))
          throw Error('The saved result does not match this original preparation request.');
        op.saved_preparation={id:p.id,revision:p.revision,revision_id:p.revision_id};
        if(signature(base)===op.draft_signature){base.base={preparation_id:p.id,revision:p.revision,revision_id:p.revision_id};base.preparation_id=p.id;base.selection=clone(p.selection);base.raw={};base.saved_content={title:p.title,purpose:p.purpose,selection:clone(p.selection)};}
      } else {
        if(result?.preparation_id!==op.request.payload.preparation_id||result?.revision!==op.request.payload.revision||!result?.delivery_id)throw Error('The build result differs from this original saved preparation revision.');
        op.delivery_id=result?.delivery_id||result?.delivery?.id||result?.record?.id||null;
      }
    }
    local.set(k,base);unwritten.set(k,base);
    await persist(base,{strict:true,originScope:originalScope});
    if(scope===originalScope&&current?.id===draftId&&(!context||active(context.origin,context.generation))){current=clone(base);preview=null;render();}
    return op;
  }
  async function receive(operationId){
    ensure();const draft=clone(current),origin=workspace,originalScope=scope,generation=lifecycle;
    const op=draft.operations.find(x=>x.operation_id===operationId);if(!op)throw Error('Choose a retained original operation.');
    const receipt=await read('operation',{operation_id:op.operation_id,task_id:op.task_id||null,request:clone(op.request)},origin);
    await retainOperationResult(draft.id,originalScope,op.operation_id,receipt,{origin,generation});
    return receipt;
  }
  async function send(op,draftId=current.id,originalScope=scope,context={origin:workspace,generation:lifecycle}){
    const origin=op.request.workspace;
    if(origin!==context.origin||!active(context.origin,context.generation))throw Error('Resume this exact request in its original operator workspace; its workspace identity cannot be rewritten.');
    const task=await host.api('/api/actions',{method:'POST',body:clone(op.request)});
    const result=await retainOperationResult(draftId,originalScope,op.operation_id,{status:task.state==='complete'?'COMPLETE':'PENDING',task},context);
    if(active(context.origin,context.generation))await (host.refreshState||host.refresh)?.({force:true});return result;
  }
  async function submit(action,payload){
    ensure();if(unsettled(current).length)throw Error('Recover the pending original request before another operation.');
    const origin=workspace,generation=lifecycle,originalScope=scope,draft=clone(current);
    const request={workspace:origin,action,payload:clone(payload),operation_id:crypto.randomUUID()};
    await flush(draft,originalScope);
    if(!active(origin,generation)||current?.id!==draft.id)return;
    const op={operation_id:request.operation_id,request,signature:canonical(request),draft_signature:signature(draft),created_at:new Date().toISOString(),state:'prepared'};
    draft.operations.push(op);current=clone(draft);
    // The atomic whole-copy write claims this request before the first network effect.
    await persist(draft,{strict:true,originScope:originalScope});
    if(!active(origin,generation)||current?.id!==draft.id)return;
    renderOperations();lock();
    try{return await send(clone(op),draft.id,originalScope,{origin,generation});}
    catch(error){if(active(origin,generation))status('The original request is retained. Read its original result before retrying. '+error.message,true);throw error;}
  }
  async function importCopy(file){
    if(!file)throw Error('Choose a complete working-copy JSON file.');
    if(file.size>16*1024*1024)throw Error('Choose a working copy no larger than 16 MiB; use the complete project handoff for source files.');
    const origin=workspace,generation=lifecycle,originalProject=clone(project),originalText=await file.text();let parsed;try{parsed=JSON.parse(originalText.replace(/^\uFEFF/,''));}catch{throw Error('The working copy is not complete JSON.');}
    const value=validateWorkingCopy(parsed,{projectId:originalProject.id});
    if(!active(origin,generation))return;
    const draft=value.draft;draft.id=crypto.randomUUID();draft.imported_original={filename:file.name,bytes:file.size,text:originalText};draft.imported_at=new Date().toISOString();
    // Never silently unlock an uncertain retained request on import.
    for(const op of draft.operations)if(op.state==='complete'){op.claimed_complete=true;op.state='pending_verification';}
    if(!await chooseDraft(draft)||!active(origin,generation))return;
    for(const op of [...operations(draft)]){if(!active(origin,generation)||current?.id!==draft.id)return;await receive(op.operation_id);}
    if(active(origin,generation))status('The complete original working copy is open. Saved requests were checked against the original project.');
  }
  async function fork(){
    if(!current)return;const draft=newDraft(current.selection,{title:current.title+' · separate copy',purpose:current.purpose,raw:clone(current.raw),origin:{label:'Separate working copy',prior_working_copy_id:current.id,prior_preparation:clone(current.base),prior_operations:clone(current.operations)}});
    // A separate named preparation has a new server CAS lineage; source binding remains complete.
    if(await chooseDraft(draft))status('A separate complete copy is saved. The other tab’s original copy remains intact.');
  }
  async function action(name,target){
    ensure();
    if(name==='new')return create({delivery_mode:'regional_rfp',scenario_run_ids:[],source_roles:{},overlays:{},map_settings:{weights:Object.fromEntries(POLLUTANTS.map(x=>[x,1])),dpi:220,paper:'letter',display_percentile:98},contact:{},notes:[]});
    if(name==='refresh')return reload();
    if(name==='more'){
      const origin=workspace,generation=lifecycle,offset=catalog?.next_offset;if(offset==null)return;
      const result=await read('catalog',{offset,limit:50},origin);if(!active(origin,generation))return;
      if(result.project_id!==project.id||result.offset!==offset)throw Error('The returned preparation page belongs to a different project or offset.');
      const combined=new Map(items().map(row=>[row.id,row]));for(const row of result.items)combined.set(row.id,row);
      catalog={...result,items:[...combined.values()]};renderLibrary();lock();return;
    }
    if(name==='open')return open(target.dataset.dpId);
    if(name==='draft'){const origin=workspace,generation=lifecycle,originalScope=scope,id=target.dataset.dpId;if(current)await persist(current,{originScope:originalScope});if(!active(origin,generation))return;const k=originalScope+':'+id,found=unwritten.get(k)||local.get(k);if(!found)throw Error('This working copy is unavailable.');current=clone(found);preview=null;render();return;}
    if(name==='delivery')return fromDelivery(target.dataset.dpId);
    if(name==='import'){$('[data-dp-import]').click();return;}
    if(name==='download'){download(pretty(workingCopyEnvelope(project,current))+'\n','delivery-preparation-'+current.id+'.json');return;}
    if(name==='fork')return fork();
    if(name==='new-cohort'){
      const selected=selection(),detached={};
      for(const field of Object.keys(selected))if(/^(source_scenario_analysis|source_report|source_decision|economic_edition)/.test(field)||['native_execution_digest','coefficient_evidence_binding','observed_context_binding','application_sha256','delivery_edition','report_renderer_version','client_report_edition','client_companion_edition','fgdc_metadata_edition'].includes(field)){detached[field]=selected[field];delete selected[field];}
      selected.baseline_run_id='';selected.scenario_run_ids=[];
      return chooseDraft(newDraft(selected,{title:current.title+' · new cohort',purpose:current.purpose,origin:{label:'Settings copied for another native cohort',prior_preparation:clone(current.base),prior_working_copy_id:current.id,detached_bindings:detached}}));
    }
    if(name==='reopen-local'){
      const id=current.id,k=key(current),origin=workspace,generation=lifecycle,originalScope=scope,record=await storage.read(originalScope,id);
      if(!active(origin,generation)||current?.id!==id)return;
      if(!record)throw Error('The other saved copy is unavailable. Download your current copy or save it separately.');
      // Explicit button discards only this visible failed draft after offering its complete download.
      unwritten.delete(k);errors.delete(k);revisions.set(k,record.revision);local.set(k,record.body);current=clone(record.body);preview=null;render();return;
    }
    if(name==='apply-json'){
      let selected;try{selected=JSON.parse(current.raw['@selection-json']??pretty(current.selection));}catch{throw Error('Complete the original selection JSON before applying it.');}
      if(!object(selected))throw Error('The native delivery selection must be an object.');
      if(boundCohort()&&(selected.baseline_run_id!==current.selection.baseline_run_id||canonical(selected.scenario_run_ids)!==canonical(current.selection.scenario_run_ids)))throw Error('Start a new preparation to change a source-bound scientific cohort.');
      const origin=workspace,generation=lifecycle,id=current.id;current.selection=clone(selected);current.raw={};invalidate();await flush();if(active(origin,generation)&&current?.id===id)render();return;
    }
    if(name==='release-source'){
      const path=target.dataset.dpPath,prior=clone(get(current.selection,path));
      current.source_changes??=[];current.source_changes.push({path,previous:prior,at:new Date().toISOString()});
      changedOverlay(path);set(current.selection,path,{source_collection_id:'',source_id:''});
      for(const raw of Object.keys(current.raw))if(raw.startsWith(path+'.'))delete current.raw[raw];
      invalidate();render();status('Choose and inspect the replacement original source. Its scientific designation must be reviewed in the source workflow.');return;
    }
    if(name==='source'){
      const collection=target.dataset.dpCollection,id=target.dataset.dpId;if(!collection||!id)throw Error('Choose an original source first.');
      return host.openItem('sources',collection);
    }
    if(name==='check'){
      const payload=savePayload(),sig=signature(current),origin=workspace,generation=lifecycle,id=current.id;
      await flush();if(!active(origin,generation)||current?.id!==id)return;const result=await read('preview',payload,origin);
      if(active(origin,generation)&&current?.id===id&&signature(current)===sig){preview={signature:sig,result};renderPreview();status(result.eligible?'Current preparation is ready for the original builder’s final validation.':'Review the named readiness issues. Incomplete preparation can still be saved.');}
      return;
    }
    if(name==='save')return submit('delivery.preparation.save',savePayload());
    if(name==='build'){
      if(!current.base)throw Error('Save this preparation first.');
      if(!current.saved_content||canonical({title:current.title,purpose:current.purpose,selection:selection()})!==canonical(current.saved_content))
        throw Error('Save the current changes before building a preparation revision.');
      return submit('delivery.preparation.build',{preparation_id:current.base.preparation_id,revision:current.base.revision});
    }
    if(name==='receive')return receive(target.dataset.dpOperation);
    if(name==='retry'){
      const origin=workspace,generation=lifecycle,draftId=current.id,originalScope=scope;
      const op=operations(current).find(x=>x.operation_id===target.dataset.dpOperation);if(!op)throw Error('Choose the original request.');
      const receipt=await receive(op.operation_id);if(!active(origin,generation)||current?.id!==draftId)return;if(receipt.status!=='NOT_FOUND'){status('The original request already has a retained outcome.');return;}
      return send(clone(operations(current).find(x=>x.operation_id===op.operation_id)),draftId,originalScope,{origin,generation});
    }
    if(name==='resume'){
      const origin=workspace,generation=lifecycle,draftId=current.id;
      const op=operations(current).find(x=>x.operation_id===target.dataset.dpOperation);await receive(op.operation_id);if(!active(origin,generation)||current?.id!==draftId)return;
      const currentOp=operations(current).find(x=>x.operation_id===op.operation_id);
      if(currentOp.state==='complete')return;if(!currentOp.task_id)throw Error('Read the original task before resuming it.');
      await host.api('/api/task/resume',{method:'POST',body:{id:currentOp.task_id}});if(active(origin,generation)&&current?.id===draftId)return receive(currentOp.operation_id);
    }
    if(name==='task')return host.showTask(target.dataset.dpId);
    if(name==='output')return host.openItem('deliveries',target.dataset.dpId);
    if(name==='project-transfer'){return host.navigate("project-transfer");}
    if(name==='history'){
      const origin=workspace,generation=lifecycle,id=current.id,record=await read('item',{preparation_id:current.base.preparation_id});
      if(!active(origin,generation)||id!==current?.id)return;
      $('[data-dp-history]').innerHTML='<div class="dp-table-scroll" tabindex="0"><table><thead><tr><th>Revision</th><th>Title</th><th>Saved</th><th></th></tr></thead><tbody>'+list(record.history).map(row=>'<tr><td>'+esc(row.revision)+'</td><td>'+esc(row.title)+'</td><td>'+esc(date(row.created_at))+'</td><td>'+button('history-open','Open original revision','data-dp-id="'+esc(current.base.preparation_id)+'" data-dp-revision="'+esc(row.revision)+'"')+'</td></tr>').join('')+'</tbody></table></div><details><summary>Complete original preparation and build history</summary><pre>'+esc(pretty(record))+'</pre></details>';return;
    }
    if(name==='history-open')return open(target.dataset.dpId,Number(target.dataset.dpRevision));
  }
  async function guarded(run){
    if(busy)return;busy=true;lock();const origin=workspace,generation=lifecycle;
    try{status();await run();}catch(error){if(active(origin,generation))status(error.message,true);}
    finally{if(active(origin,generation)){busy=false;lock();}}
  }
  async function mount(target,snapshot=host.getState()){
    detach();node=target;workspace=snapshot.workspace_key;project=projectInfo(snapshot);scope=workspace+':'+project.id;ensure();
    abort=new AbortController();const signal=abort.signal;const origin=workspace,generation=lifecycle;
    node.addEventListener('click',event=>{const control=event.target.closest('[data-dp-action]');if(!control||!node?.contains(control))return;event.preventDefault();event.stopPropagation();void guarded(()=>action(control.dataset.dpAction,control));},{signal});
    node.addEventListener('input',event=>{try{change(event);}catch(error){status(error.message,true);}},{signal});
    node.addEventListener('change',event=>{if(event.target.hasAttribute('data-dp-import')){const file=event.target.files?.[0];event.target.value='';void guarded(()=>importCopy(file));}else if(event.target.matches('select,input[type=checkbox]')){try{change(event);}catch(error){status(error.message,true);}}},{signal});
    node.addEventListener('submit',event=>event.preventDefault(),{signal});
    document.addEventListener('click',event=>{if(busy&&event.target.closest('.sidebar [data-view]')){event.preventDefault();event.stopImmediatePropagation();status('Finish the current retained operation before changing the workspace view.');}},{signal,capture:true});
    window.addEventListener('beforeunload',event=>{if(current&&(unwritten.has(key(current))||errors.has(key(current)))){event.preventDefault();event.returnValue='';}},{signal});
    catalog=null;current=null;preview=null;busy=true;render();
    try{await recall();if(!active(origin,generation))return;const drafts=listDrafts();if(drafts.length)current=clone(drafts.sort((a,b)=>text(b.updated_at||b.created_at).localeCompare(text(a.updated_at||a.created_at)))[0]);await reload();}
    catch(error){if(active(origin,generation))status(error.message,true);}
    finally{if(active(origin,generation)){busy=false;lock();}}
  }
  function update(snapshot=host.getState()){
    if(!node)return;if(snapshot.workspace_key!==workspace){detach();return;}
    if(!busy&&!pendingPoll&&current&&unsettled(current).some(op=>op.task_id&&list(snapshot.tasks).some(t=>t.id===op.task_id&&t.state!==op.task_state))){
      pendingPoll=true;const id=current.id,origin=workspace,generation=lifecycle;
      void guarded(async()=>{for(const op of [...unsettled(current)]){if(!active(origin,generation)||current?.id!==id)return;await receive(op.operation_id);}}).finally(()=>{pendingPoll=false;});
    }
  }
  function detach(){if(current)void persist();abort?.abort();abort=null;lifecycle++;node?.classList.remove('delivery-preparation');node=null;busy=false;preview=null;catalog=null;}
  return {mount,update,detach,open,create,fromDelivery};
}
