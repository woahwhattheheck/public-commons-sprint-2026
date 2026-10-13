/** Regional source choices; original host owns tasks, native runs and downloads. */
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=x=>Array.isArray(x)?x:[];
const short=x=>String(x||'').slice(0,12);
const uid=()=>crypto.randomUUID();
const opt=(v,t,s=false)=>'<option value="'+esc(v)+'"'+(s?' selected':'')+'>'+esc(t)+'</option>';
const terminal=t=>['complete','failed','interrupted','cancelled'].includes(t?.state);
const ACTIONS=new Set(['regional-biophysical.prepare','regional-biophysical.export','regional-biophysical.experiment.prepare']);
export function attachRegionalBiophysical(host){
  let root=null,events=null,workspace=null,project=null,generation=0,requestEpoch=0;
  let catalog=null,library=null,memory=null,preview=null,detail=null,busy=false,leaving=false,message='',error=false;
  let search='',page=0,editing=null,taskState='',busySequence=0;
  const memories=new Map();
  const current=()=>host.getState()?.workspace_key||null;
  const storagePrefix=key=>'upstate-regional-biophysical-v1:'+key+':';
  const scope=()=>({workspace,project,generation,instance:memory?.instance});
  const alive=s=>Boolean(root?.isConnected&&current()===s.workspace&&workspace===s.workspace&&project===s.project&&generation===s.generation&&memory?.instance===s.instance);
  const active=s=>{if(!alive(s))throw Error('The selected project or working copy changed. Reopen its original selection.');};
  const blocked=()=>busy||leaving;
  function fresh(){return {schema:'upstate.regional-biophysical-working/v1',workspace_key:workspace,project_id:project,instance:uid(),definition:null,requests:[],selected_id:'',experiment:{baseline_run_id:'',scenario_ids:[]}};}
  function key(m=memory){return storagePrefix(m.workspace_key)+m.instance;}
  function save(m=memory){
    if(!m)return false;
    memories.set(key(m),m);
    try{localStorage.setItem(key(m),JSON.stringify(m));return true;}
    catch{return false;}
  }
  function notice(value='',failed=false){message=String(value);error=failed;const n=root?.querySelector('[data-rb-message]');if(n){n.textContent=message;n.dataset.error=String(error);}}
  function downloadable(m=memory){const v=clone(m);delete v.download_barrier;return v;}
  function download(name,text,type='application/json'){
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function saveWorking(m=memory){
    const raw=JSON.stringify(downloadable(m),null,2)+'\n';
    if(new TextEncoder().encode(raw).length>32*1024*1024)throw Error('The full working copy exceeds the supported 32 MiB envelope; retain browser storage and original task/source exports.');
    download('Regional_Profile_Working_'+m.instance+'.json',raw);
    m.download_barrier=stable(downloadable(m));save(m);
    notice('Complete working copy download requested. Keep the downloaded file before continuing when browser storage is unavailable.');
  }
  function durable(m=memory){
    if(save(m))return;
    if(m.download_barrier===stable(downloadable(m))&&root?.querySelector('[data-rb-file-kept]')?.checked)return;
    throw Error('Browser recovery storage is unavailable. Download this complete working copy, confirm that its file is saved, then retry the same retained request.');
  }
  function mutate(){preview=null;memory.download_barrier=null;++requestEpoch;save();renderPreview();}
  function copies(){
    const found=new Map();
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(storagePrefix(workspace))){try{const x=JSON.parse(localStorage.getItem(k));if(x?.project_id===project)found.set(x.instance,x);}catch{}}}}catch{}
    for(const m of memories.values())if(m.workspace_key===workspace&&m.project_id===project)found.set(m.instance,m);
    return [...found.values()];
  }
  const entries=()=>new Map(list(library?.entries).map(x=>[x.id,x]));
  function base(){return list(catalog?.profiles).find(p=>p.id===memory?.definition?.baseline_profile_id);}
  function validEntries(family){
    const b=base();if(!b)return [];
    const models=list(b.models).length?b.models:['ndr','sdr'];
    const codes=new Set(list(b.table_summary?.lucodes));
    return list(family.entry_ids).filter(id=>{const e=entries().get(id),m=e?.target.startsWith('sdr.')||['table.usle_c','table.usle_p'].includes(e?.target)?'sdr':'ndr';return e&&models.includes(m)&&(!e.target.startsWith('table.')||!codes.size||codes.has(e.lucode));});
  }
  function selection(profileId,familyId,binding=catalog.library_binding){
    const family=list(library?.families).find(x=>x.id===familyId)||library?.families?.[0];
    memory.definition={schema:'upstate.regional-biophysical-selection/v1',baseline_profile_id:profileId,
      library:clone(binding),family_id:family?.id||'',title:family?.title||'',reason:'',applicability_note:'',selected_entry_ids:[],edits:[]};
    if(family)memory.definition.selected_entry_ids=validEntries(family);
    memory.selected_id='';memory.experiment={baseline_run_id:'',scenario_ids:[]};detail=null;preview=null;editing=null;memory.editors={};memory.editor_id=null;save();
  }
  async function read(op,body={},s=scope()){
    active(s);const result=await host.api('/api/regional-biophysical/'+op,{method:'POST',body:{workspace:s.workspace,...body}});
    active(s);return result;
  }
  async function refresh(){
    const s=scope(),token=++requestEpoch;
    const r=await host.api('/api/regional-biophysical/catalog?workspace='+encodeURIComponent(s.workspace));
    if(!alive(s)||token!==requestEpoch)return;
    if(r.workspace_id!==project)throw Error('The catalogue belongs to another original project.');
    catalog=r;
    if(!memory.definition){library=r.library;const first=list(r.profiles)[0];if(first)selection(first.id,r.library.families[0].id);}
    else{
      const selected=await read('library',{library:memory.definition.library},s);if(!alive(s)||token!==requestEpoch)return;library=selected.library;
    }
    editing=memory.editor_id||null;
    if(memory.selected_id)await openSaved(memory.selected_id);
    render();
  }
  function currentTask(request){return list(host.getState()?.tasks).find(t=>t.id===request.task_id)||request.task||null;}
  function requestsHTML(){
    return list(memory.requests).slice().reverse().map(r=>{const t=currentTask(r);return '<article class="rb-request"><strong>'+esc(r.action)+'</strong> · '+esc(t?.state||'original request retained')+'<code>'+esc(r.operation_id)+'</code>'+(t?.error?'<p>'+esc(t.error.message)+'</p>':'')+
      '<button data-rb-action="retry" data-id="'+esc(r.operation_id)+'">Reopen same request</button>'+
      (t?.id?'<button data-rb-action="task" data-id="'+esc(t.id)+'">Open original operation</button>':'')+
      (t?.state==='complete'&&r.action==='regional-biophysical.prepare'?'<button data-rb-action="saved" data-id="'+esc(t.result?.id)+'">Open saved selection</button>':'')+'</article>';}).join('');
  }
  function field(name,label,value,multiline=false,attrs=''){
    return '<label>'+esc(label)+(multiline?'<textarea data-rb-field="'+name+'" '+attrs+'>'+esc(value)+'</textarea>':'<input data-rb-field="'+name+'" value="'+esc(value)+'" '+attrs+'>')+'</label>';
  }
  function render(){
    if(!root)return;
    const d=memory.definition,profiles=list(catalog?.profiles),family=list(library?.families);
    root.innerHTML='<section class="rb-desk"><header><h1>Regional biophysical library</h1><p>Choose published coefficients, retain their source meaning, and prepare an editable native profile alongside the original baseline.</p></header>'+
      '<p data-rb-message role="status" data-error="'+error+'">'+esc(message)+'</p>'+
      '<div class="rb-toolbar"><button data-rb-action="refresh">Refresh retained sources</button><button data-rb-action="working">Download complete working copy</button>'+
      '<label>Reopen working JSON<input type="file" data-rb-working accept=".json,application/json"></label>'+
      '<label>Saved browser copy<select data-rb-copy>'+opt('','Choose an earlier copy')+copies().filter(x=>x.instance!==memory.instance).map(x=>opt(x.instance,(x.definition?.title||'Unfinished')+' · '+short(x.instance))).join('')+'</select></label>'+
      '<label class="rb-confirm"><input type="checkbox" data-rb-file-kept>I have saved the current working file</label></div>'+
      (!catalog?'<p>Reading original source catalogue…</p>':!profiles.length?'<p>Save an original native profile through Profiles before selecting regional coefficients.</p>':
      '<div class="rb-grid"><label>Original baseline profile<select data-rb-field="baseline_profile_id">'+profiles.map(x=>opt(x.id,x.title+' · '+short(x.id),x.id===d?.baseline_profile_id)).join('')+'</select></label>'+
      '<label>Library source<select data-rb-library>'+opt('builtin',catalog.library.title,Boolean(d?.library?.builtin_sha256))+
      list(catalog.source_libraries).map(x=>opt(JSON.stringify([x.collection_id,x.id]),x.title+' · '+short(x.sha256),d?.library?.source_collection_id===x.collection_id&&d?.library?.source_id===x.id)).join('')+'</select></label>'+
      '<label>Published profile family<select data-rb-field="family_id">'+family.map(x=>opt(x.id,x.title,x.id===d?.family_id)).join('')+'</select></label></div>'+
      '<p class="rb-note">A new library JSON and its original companions can be imported through Original sources. A published default is labelled as such. Unreported values remain the exact selected baseline; no local calibration is inferred.</p>'+
      '<div class="rb-grid">'+field('title','Selection title',d?.title)+field('reason','Scientific purpose',d?.reason,true)+field('applicability_note','Why these original sources apply to this region and land management',d?.applicability_note,true)+'</div>'+
      '<div class="rb-toolbar"><label>Find code, parameter or citation<input data-rb-search type="search" value="'+esc(search)+'"></label><button data-rb-action="select-family">Select applicable family entries</button><button data-rb-action="clear">Clear selections</button></div>'+
      '<div data-rb-entries></div><div data-rb-editor></div><div data-rb-preview></div>'+
      '<div class="rb-toolbar"><button data-rb-action="preview">Preview exact native profile</button></div>'+
      '<section><h2>Saved regional selections</h2><select data-rb-saved>'+opt('','Choose an immutable selection')+list(catalog.selections).map(x=>opt(x.id,x.title+' · '+short(x.id),x.id===memory.selected_id)).join('')+'</select><div data-rb-detail></div></section>')+
      '<section><h2>Original operations</h2><div data-rb-requests>'+requestsHTML()+'</div></section></section>';
    renderEntries();renderEditor();renderPreview();renderDetail();lock();
  }
  function lock(){if(!root)return;for(const n of root.querySelectorAll('input,select,textarea,button'))n.disabled=(blocked()&&n.dataset.rbAction!=='working')||n.hasAttribute('data-rb-unavailable');}
  function renderEntries(){
    const n=root?.querySelector('[data-rb-entries]');if(!n||!memory.definition)return;
    const d=memory.definition,byId=entries(),family=library.families.find(x=>x.id===d.family_id);
    const applicable=new Set(validEntries(family||{entry_ids:[]}));
    const all=list(family?.entry_ids).map(id=>byId.get(id)).filter(e=>e&&(!search||stable(e).toLowerCase().includes(search.toLowerCase())));
    page=Math.min(page,Math.max(0,Math.ceil(all.length/30)-1));const selected=new Set(d.selected_entry_ids);
    n.innerHTML='<div class="rb-scroll"><table><thead><tr><th>Use</th><th>Land cover</th><th>Parameter</th><th>Choice / units</th><th>Meaning and original source</th><th>Edit</th></tr></thead><tbody>'+
      all.slice(page*30,page*30+30).map(e=>{const change=d.edits.find(x=>x.entry_id===e.id),s=change?.source||e.source,v=change&&Object.prototype.hasOwnProperty.call(change,'value')?change.value:e.value;return '<tr><td><input type="checkbox" data-rb-entry="'+esc(e.id)+'" '+(selected.has(e.id)?'checked':'')+' '+(!applicable.has(e.id)?'disabled data-rb-unavailable':'')+' aria-label="Select '+esc(e.id)+'"></td><td>'+esc(e.lucode??'Whole model')+'<small>'+esc(e.land_cover)+'</small></td><td>'+esc(e.target)+'</td><td>'+esc(v===null?'Automatic native mean':v)+' '+esc(e.units)+'<small>'+esc(change?.load_type??e.load_type??'')+(change?' · explicit edit':'')+'</small></td><td>'+esc(s.classification)+'<small>'+esc(s.geography)+' · '+esc(s.period)+'</small><details><summary>Complete citation and interpretation</summary><p>'+esc(s.title)+'</p><p>'+esc(s.uri)+'</p><p>'+esc(s.locator)+'</p><p>'+esc(s.management)+'</p><p>'+esc(s.method)+'</p><p>'+esc(s.notes)+'</p></details></td><td><button data-rb-action="edit" data-id="'+esc(e.id)+'">Inspect / edit choice</button></td></tr>';}).join('')+
      '</tbody></table></div><div class="rb-toolbar"><button data-rb-action="previous">Previous</button><span>'+Math.min(all.length,page*30+1)+'–'+Math.min(all.length,(page+1)*30)+' of '+all.length+' entries; '+selected.size+' selected.</span><button data-rb-action="next">Next</button></div>';lock();
  }
  function renderEditor(){
    const n=root?.querySelector('[data-rb-editor]');if(!n)return;
    if(!editing){n.replaceChildren();return;}
    const original=entries().get(editing),change=memory.definition.edits.find(x=>x.entry_id===editing);
    let val=change||{entry_id:editing,value:original.value,load_type:original.load_type,range:original.range,
      source:{...clone(original.source),classification:'operator_hypothesis'},reason:''};
    const sourceFields=['title','uri','locator','period','geography','management','method','notes'];
    if(memory.editors?.[editing]){const f=memory.editors[editing];val={...clone(val),value:f.auto_mean==='yes'?null:f.value,load_type:original.load_type?f.load_type:null,reason:f.reason,source:{...val.source,classification:f.classification},range:f.lower||f.upper?{lower:f.lower,upper:f.upper,basis:f.range_basis}:null};for(const k of sourceFields)val.source[k]=f['source_'+k];}
    n.innerHTML='<section class="rb-editor"><h2>Explicit choice: '+esc(original.target)+' / '+esc(original.lucode??'whole model')+'</h2><p>Original value '+esc(original.value)+' '+esc(original.units)+'. Editing never changes the retained publication. Supply the new source or clearly identify an operator hypothesis.</p>'+
      '<form data-rb-edit-form><div class="rb-grid">'+(original.target==='ndr.runoff_proxy_av'?'<label>Runoff normalization<select name="auto_mean">'+opt('no','Explicit positive mean',val.value!==null)+opt('yes','Automatic native masked mean',val.value===null)+'</select></label>':'')+'<label>Selected value<input name="value" value="'+esc(val.value)+'" '+(original.target==='ndr.runoff_proxy_av'?'':'required')+'></label>'+
      (original.load_type?'<label>Native load interpretation<select name="load_type">'+['application-rate','measured-runoff'].map(x=>opt(x,x,x===val.load_type)).join('')+'</select></label>':'')+
      '<label>Evidence classification<select name="classification">'+['operator_hypothesis','published_model_input','published_default','measured_plot_runoff','application_rate'].map(x=>opt(x,x,x===val.source.classification)).join('')+'</select></label>'+
      sourceFields.map(k=>'<label>'+esc(k)+'<textarea name="source_'+k+'" '+(k==='notes'?'':'required')+'>'+esc(val.source[k])+'</textarea></label>').join('')+
      '<label>Why this explicit edit is selected<textarea name="reason" required>'+esc(val.reason)+'</textarea></label>'+
      '<label>Sourced lower endpoint (optional)<input name="lower" value="'+esc(val.range?.lower??'')+'"></label><label>Sourced upper endpoint (optional)<input name="upper" value="'+esc(val.range?.upper??'')+'"></label><label>Original range basis<textarea name="range_basis">'+esc(val.range?.basis??'')+'</textarea></label></div>'+
      '<button type="submit">Retain edited choice in working selection</button><button type="button" data-rb-action="restore-entry">Restore published entry</button><button type="button" data-rb-action="close-editor">Close editor</button></form></section>';lock();
  }
  function renderPreview(){
    const n=root?.querySelector('[data-rb-preview]');if(!n)return;
    n.innerHTML=preview?'<section><h2>Exact native preparation preview</h2><p>'+esc(preview.selected_entries.length)+' selected source entries; '+esc(preview.profile_preview.derived_profile_count)+' derived profile. Original table '+esc(preview.baseline_table_sha256)+'.</p><p>'+esc(preview.inherited_fields)+'</p><details><summary>All source-bound changes and inherited settings</summary><pre>'+esc(JSON.stringify(preview,null,2))+'</pre></details><button data-rb-action="prepare">Prepare this saved native profile</button></section>':'';lock();
  }
  function downloadLinks(record){
    return list(record?._downloads).filter(x=>/^\/api\/file\//.test(x.url||'')).map(x=>'<a href="'+esc(host.endpoint(x.url+(x.url.includes('?')?'&':'?')+'download=1'))+'" download>'+esc(x.label||x.filename)+'</a>').join(' ');
  }
  function renderDetail(){
    const n=root?.querySelector('[data-rb-detail]');if(!n)return;
    if(!detail){n.replaceChildren();return;}
    const runs=list(host.getState()?.data?.runs),scenarios=list(host.getState()?.data?.scenarios),bids=new Set(scenarios.filter(x=>x.kind==='baseline').map(x=>x.id));
    const baselines=runs.filter(x=>x.state==='complete'&&x.selection?.profile_id===detail.baseline_profile_id&&bids.has(x.selection?.scenario_id));
    const e=memory.experiment;
    n.innerHTML='<section><h3>'+esc(detail.title)+'</h3><p>Native profile <code>'+esc(detail.profile_id)+'</code><br>Original baseline <code>'+esc(detail.baseline_profile_id)+'</code></p><p>'+esc(detail.definition.applicability_note)+'</p>'+
      '<div class="rb-toolbar"><button data-rb-action="export">Prepare complete source package and report</button>'+downloadLinks(detail)+'</div><details><summary>Complete immutable selection</summary><pre>'+esc(JSON.stringify(detail,null,2))+'</pre></details>'+
      '<h3>Use the original native experiment engine</h3><label>Completed original baseline<select data-rb-baseline-run>'+opt('','Choose the exact native baseline')+baselines.map(x=>opt(x.id,short(x.id),x.id===e.baseline_run_id)).join('')+'</select></label><fieldset><legend>Additional retained land-cover scenarios</legend>'+
      scenarios.filter(x=>x.kind!=='baseline').map(x=>'<label><input type="checkbox" data-rb-scenario="'+esc(x.id)+'" '+(e.scenario_ids.includes(x.id)?'checked':'')+'>'+esc(x.title||short(x.id))+'</label>').join('')+
      '</fieldset><p>Only prepares the original experiment. Execute and inspect native runs through the existing Experiments desk and retained source owner.</p><button data-rb-action="experiment">Prepare original native experiment</button></section>';lock();
  }
  async function openSaved(id){
    const s=scope(),token=++requestEpoch;
    const result=await host.api('/api/regional-biophysical/detail?workspace='+encodeURIComponent(workspace)+'&id='+encodeURIComponent(id));
    if(!alive(s)||token!==requestEpoch)return;
    if(result.workspace_id!==project)throw Error('The saved selection belongs to another project.');
    detail=result;memory.selected_id=id;save();renderDetail();
  }
  async function issue(request,s,m){
    active(s);durable(m);
    const result=await host.api('/api/actions',{method:'POST',body:{workspace:s.workspace,action:request.action,payload:clone(request.payload),operation_id:request.operation_id}});
    if(!result?.id)throw Error('No original task identity returned. Retry the same retained request.');
    const retained=m.requests.find(x=>x.operation_id===request.operation_id);
    retained.task_id=result.id;retained.task=clone(result);save(m);
    if(!alive(s))return result;
    await host.refresh?.({force:true});if(!alive(s))return result;
    notice('Original operation '+result.id+' is '+result.state+'. Its exact request is retained for reopening.');
    if(result.state==='complete'&&request.action==='regional-biophysical.prepare')await openSaved(result.result.id);
    if(result.state==='complete'&&request.action==='regional-biophysical.export')await openSaved(request.payload.id);
    return result;
  }
  async function queue(action,payload){
    const s=scope(),m=memory,signature=stable({action,payload});
    let request=m.requests.find(x=>x.signature===signature);
    if(!request){request={operation_id:uid(),action,payload:clone(payload),signature,created_at:new Date().toISOString()};m.requests.push(request);m.download_barrier=null;}
    return issue(request,s,m);
  }
  async function adopt(value){
    const s=scope();active(s);
    if(value?.schema!=='upstate.regional-biophysical-working/v1'||value.workspace_key!==workspace||value.project_id!==project||!Array.isArray(value.requests))throw Error('Select an original working file from this exact project.');
    const incoming=clone(value);
    for(const r of incoming.requests){
      if(!ACTIONS.has(r.action)||typeof r.operation_id!=='string'||!r.operation_id||r.signature!==stable({action:r.action,payload:r.payload}))throw Error('The incoming original request binding is invalid.');
      // Imported task observations do not authorize a replacement request or prove completion.
      r.task=null;r.task_id=null;
    }
    if(incoming.definition){await read('library',{library:incoming.definition.library},s);active(s);}
    durable();incoming.instance=uid();delete incoming.download_barrier;
    if(!save(incoming))throw Error('Cannot save this separate incoming copy. Existing draft remains open; retain the original input file.');
    memory=incoming;generation++;preview=null;detail=null;editing=null;await refresh();
  }
  async function action(name,id){
    if(name==='working'){saveWorking();return;}
    if(name==='refresh')return refresh();
    if(name==='previous'||name==='next'){page=Math.max(0,page+(name==='next'?1:-1));renderEntries();return;}
    if(name==='edit'){retainEditor();editing=id;memory.editor_id=id;renderEditor();retainEditor();return;}
    if(name==='close-editor'){retainEditor();editing=null;memory.editor_id=null;save();renderEditor();return;}
    if(name==='restore-entry'){memory.definition.edits=memory.definition.edits.filter(x=>x.entry_id!==editing);delete (memory.editors||{})[editing];editing=null;memory.editor_id=null;mutate();renderEntries();renderEditor();return;}
    if(name==='clear'||name==='select-family'){const f=library.families.find(x=>x.id===memory.definition.family_id);memory.definition.selected_entry_ids=name==='clear'?[]:validEntries(f);memory.definition.edits=memory.definition.edits.filter(e=>memory.definition.selected_entry_ids.includes(e.entry_id));mutate();renderEntries();return;}
    if(name==='preview'){
      const s=scope(),definition=clone(memory.definition),token=++requestEpoch;
      const result=await read('preview',{definition},s);
      if(!alive(s)||token!==requestEpoch||stable(definition)!==stable(memory.definition))return;
      preview=result;renderPreview();return;
    }
    if(name==='prepare'){
      if(!preview||stable(preview.definition)!==stable(memory.definition))throw Error('Preview the current exact choices first.');
      return queue('regional-biophysical.prepare',{definition:clone(memory.definition),preview_sha256:preview.preview_sha256});
    }
    if(name==='retry'){const r=memory.requests.find(x=>x.operation_id===id);if(!r)throw Error('The original request is missing.');return issue(r,scope(),memory);}
    if(name==='task')return host.showTask?.(id);
    if(name==='saved')return openSaved(id);
    if(name==='export'){if(!detail)throw Error('Open a saved selection.');return queue('regional-biophysical.export',{id:detail.id});}
    if(name==='experiment'){
      if(!detail||!memory.experiment.baseline_run_id)throw Error('Choose the original completed baseline.');
      return queue('regional-biophysical.experiment.prepare',{selection_id:detail.id,baseline_run_id:memory.experiment.baseline_run_id,scenario_ids:clone(memory.experiment.scenario_ids),title:detail.title+' regional comparison',reason:detail.definition.reason});
    }
  }
  async function operate(fn){
    if(blocked())return;
    const s=scope(),owner=++busySequence;busy=true;lock();notice();
    try{await fn();}catch(e){if(owner===busySequence&&root)notice(e.message||e,true);}
    finally{if(owner===busySequence){busy=false;if(root)render();}}
  }
  async function change(event){
    const n=event.target;if(blocked()||!memory)return;
    if(n.dataset.rbEntry){const d=memory.definition,id=n.dataset.rbEntry;d.selected_entry_ids=n.checked?[...new Set([...d.selected_entry_ids,id])]:d.selected_entry_ids.filter(x=>x!==id);d.edits=d.edits.filter(x=>d.selected_entry_ids.includes(x.entry_id));mutate();return;}
    if(n.hasAttribute('data-rb-baseline-run')){memory.experiment.baseline_run_id=n.value;save();return;}
    if(n.dataset.rbScenario){const ids=memory.experiment.scenario_ids;memory.experiment.scenario_ids=n.checked?[...new Set([...ids,n.dataset.rbScenario])]:ids.filter(x=>x!==n.dataset.rbScenario);save();return;}
    if(n.dataset.rbField){
      const field=n.dataset.rbField;
      if(field==='baseline_profile_id'||field==='family_id'){
        durable();const prior=memory,definition=clone(prior.definition);memory=fresh();library=clone(library);
        selection(field==='baseline_profile_id'?n.value:definition.baseline_profile_id,field==='family_id'?n.value:definition.family_id,definition.library);generation++;render();return;
      }
      memory.definition[field]=n.value;mutate();return;
    }
    if(n.hasAttribute('data-rb-search')){search=n.value;page=0;renderEntries();return;}
    if(n.hasAttribute('data-rb-saved')){if(n.value)await operate(()=>openSaved(n.value));return;}
    if(n.hasAttribute('data-rb-copy')){const v=copies().find(x=>x.instance===n.value);if(v)await operate(()=>adopt(v));return;}
    if(n.hasAttribute('data-rb-library'))await operate(async()=>{
      const s=scope(),binding=n.value==='builtin'?clone(catalog.library_binding):{source_collection_id:JSON.parse(n.value)[0],source_id:JSON.parse(n.value)[1]};
      const result=await read('library',{library:binding},s);active(s);durable();
      const old=memory;memory=fresh();library=result.library;
      selection(old.definition.baseline_profile_id,library.families[0].id,binding);generation++;render();
    });
  }
  async function workingFile(event){
    const file=event.target.files?.[0];if(!file||blocked())return;
    await operate(async()=>{const s=scope();if(file.size>32*1024*1024)throw Error('This working file exceeds the supported 32 MiB editor envelope.');const raw=await file.text();active(s);await adopt(JSON.parse(raw));});
  }
  function retainEditor(){
    const form=root?.querySelector('[data-rb-edit-form]');if(!form||!editing||!memory)return;
    memory.editors??={};memory.editors[editing]=Object.fromEntries(new FormData(form).entries());memory.editor_id=editing;memory.download_barrier=null;save();
  }
  function submit(event){
    if(!event.target.matches('[data-rb-edit-form]'))return;
    event.preventDefault();if(blocked()||!event.target.reportValidity())return;
    const data=new FormData(event.target),original=entries().get(editing),source={};
    for(const k of ['title','uri','locator','period','geography','management','method','notes'])source[k]=String(data.get('source_'+k)||'');
    source.classification=String(data.get('classification'));
    const lower=String(data.get('lower')||''),upper=String(data.get('upper')||'');
    if(Boolean(lower)!==Boolean(upper)){notice('Provide both sourced range endpoints or neither.',true);return;}
    const edit={entry_id:editing,value:original.target==='ndr.runoff_proxy_av'&&data.get('auto_mean')==='yes'?null:String(data.get('value')),load_type:original.load_type?String(data.get('load_type')):null,source,range:lower?{lower,upper,basis:String(data.get('range_basis')||'')}:null,reason:String(data.get('reason')||'')};
    memory.definition.edits=memory.definition.edits.filter(x=>x.entry_id!==editing).concat(edit);
    memory.definition.selected_entry_ids=[...new Set([...memory.definition.selected_entry_ids,editing])];
    delete (memory.editors||{})[editing];editing=null;memory.editor_id=null;mutate();render();
  }
  async function mount(node,state=host.getState()){
    detach();root=node;workspace=state.workspace_key;project=state.data?.project?.id||state.project?.id;
    if(!workspace||!project)throw Error('Open an original scientific workspace before the regional library.');
    memory=fresh();save();generation++;root.dataset.rbWorkspace=workspace;root.dataset.rbProject=project;events=new AbortController();
    root.addEventListener('click',e=>{const b=e.target.closest('[data-rb-action]');if(!b||!root.contains(b))return;e.preventDefault();e.stopPropagation();if(b.dataset.rbAction==='working'){saveWorking();return;}operate(()=>action(b.dataset.rbAction,b.dataset.id));},{signal:events.signal});
    root.addEventListener('change',e=>{if(e.target.hasAttribute('data-rb-working'))workingFile(e);else if(e.target.closest('[data-rb-edit-form]'))retainEditor();else change(e).catch(x=>notice(x.message,true));},{signal:events.signal});
    root.addEventListener('input',e=>{if(e.target.closest('[data-rb-edit-form]')){retainEditor();return;}if(['title','reason','applicability_note'].includes(e.target.dataset.rbField)||e.target.hasAttribute('data-rb-search'))change(e).catch(x=>notice(x.message,true));},{signal:events.signal});
    root.addEventListener('submit',submit,{signal:events.signal});
    globalThis.addEventListener('beforeunload',beforeUnload,{signal:events.signal});render();
    try{await refresh();}catch(e){notice(e.message,true);}
  }
  function beforeUnload(e){if(memory&&!save()){e.preventDefault();e.returnValue='';}}
  function update(state){
    if(!root)return;
    if(state?.workspace_key!==workspace){detach();return;}
    const signature=stable(list(state.tasks).filter(x=>ACTIONS.has(x.action)).map(x=>[x.id,x.state]));
    if(signature!==taskState){taskState=signature;for(const r of memory.requests){const t=list(state.tasks).find(x=>x.id===r.task_id);if(t)r.task=clone(t);}save();const n=root.querySelector('[data-rb-requests]');if(n)n.innerHTML=requestsHTML();lock();}
  }
  function detach(){if(memory)save();events?.abort();events=null;root=null;generation++;requestEpoch++;busySequence++;busy=false;leaving=false;preview=null;detail=null;}
  async function prepareLeave(){if(busy)throw Error('Wait for the original regional operation.');leaving=true;lock();try{durable();}catch(e){leaving=false;lock();throw e;}}
  function cancelLeave(){leaving=false;lock();}
  return {mount,update,detach,prepareLeave,cancelLeave,getWorking:()=>memory?clone(downloadable()):null};
}
