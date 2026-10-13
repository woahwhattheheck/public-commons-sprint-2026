/** Source-bound coefficient evidence and endpoint profiles in the existing profile workbench. */
const text=value=>String(value??'');
const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const short=value=>text(value).slice(0,12);
const human=value=>text(value).replace(/[_-]+/g,' ');
const cellKey=row=>row.lucode+':'+row.parameter;
const button=(action,label,attrs='',primary=false)=>'<button type="button" data-be-action="'+esc(action)+'" '+attrs+' class="'+(primary?'primary':'')+'">'+esc(label)+'</button>';
const option=(value,label,selected=false)=>'<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const ACTIONS=new Set(['profile.biophysical.evidence.save','profile.biophysical.ranges.prepare','profile.biophysical.experiment.prepare','profile.biophysical.evidence.populate']);
const terminal=task=>['complete','failed','interrupted','cancelled'].includes(task?.state);
function links(record){
  return list(record?._downloads).filter(file=>/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(file.url||'')).map(file=>'<a class="pw-download" href="'+esc(file.url)+'?download=1" download>'+esc(file.label||file.filename||'Retained file')+'</a>').join('');
}
function citation(source){
  if(!source)return '<span class="pw-note">Unknown</span>';
  let link=esc(source.uri||'');
  if(/^https?:\/\//i.test(source.uri||''))link='<a href="'+esc(source.uri)+'" target="_blank" rel="noopener noreferrer">'+link+'</a>';
  return '<strong>'+esc(source.title)+'</strong><br>'+link+
    (source.locator?'<br>'+esc(source.locator):'')+(source.period?'<br>'+esc(source.period):'')+
    (source.notes?'<br>'+esc(source.notes):'');
}
function requestId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  if(!globalThis.crypto?.getRandomValues)throw Error('This browser cannot create a retained operation identifier.');
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return 'biophysical-'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function createBiophysicalEvidence(host,{onProfile=async()=>{}}={}){
  if(typeof host.api!=='function'||typeof host.getState!=='function')throw Error('Open coefficient evidence through the scientific operator.');
  let root=null,events=null,workspace=null,profileId=null,title='',generation=0,intent=0;
  let memory=null,catalog=null,evidence=null,range=null,preview=null,rangePreview=null;
  let busy=false,processing=false,message='',isError=false,taskSignature='';
  const $=selector=>root?.querySelector(selector);
  const current=()=>host.getState()?.workspace_key||null;
  const storageKey=key=>'upstate-biophysical-evidence-v1:'+key;
  const memories=new Map();
  const empty=()=>({drafts:{},requests:[]});
  const scope=()=>({workspace,profileId,generation});
  const alive=s=>Boolean(root?.isConnected&&s.workspace===workspace&&s.profileId===profileId&&s.generation===generation&&current()===workspace);
  function assertActive(s=scope()){if(!alive(s))throw Error('The selected project or profile changed. Reopen its coefficient evidence.');}
  function stored(key){
    if(memories.has(key))return memories.get(key);
    let value=null;
    try{value=JSON.parse(localStorage.getItem(storageKey(key))||'null');}catch{}
    if(!value?.drafts||!Array.isArray(value.requests))value=empty();
    memories.set(key,value);return value;
  }
  function save(value=memory,key=workspace){
    if(!value||!key)return;
    memories.set(key,value);
    try{localStorage.setItem(storageKey(key),JSON.stringify(value));}
    catch{if(key===workspace)setMessage('Browser recovery storage is unavailable. Keep this page open until the operator returns the saved operation.',true);}
  }
  function draft(){
    return memory.drafts[profileId]??=( {
      source_collection_id:'',source_id:'',evidence_id:'',range_id:'',
      title:(title||'Profile')+' coefficient endpoints',reason:'',selected:[],baseline_run_id:'',scenario_ids:[],filter:'all',search:''
    });
  }
  function setMessage(value='',error=false){
    message=text(value);isError=error;
    const node=$('[data-be-message]');if(node){node.textContent=message;node.hidden=!message;node.classList.toggle('pw-error',error);}
  }
  function sources(){
    return list(host.getState()?.data?.sources).flatMap(collection=>list(collection.entries).filter(entry=>entry.kind==='table').map(entry=>({
      collection_id:collection.id,id:entry.id,title:entry.title||entry.id,
      collection_title:collection.title||short(collection.id),uri:entry.uri||''
    })));
  }
  function runs(){return list(host.getState()?.data?.runs);}
  function scenarios(){return list(host.getState()?.data?.scenarios);}
  function baselineRuns(){
    const ids=new Set(scenarios().filter(row=>row.kind==='baseline').map(row=>row.id));
    const scope=canonical([...list(catalog?.profile?.models)].sort());
    return runs().filter(row=>row.state==='complete'&&row.selection?.profile_id===profileId&&ids.has(row.selection?.scenario_id)&&canonical([...(list(row.selection?.models).length?row.selection.models:['ndr','sdr'])].sort())===scope);
  }
  async function read(operation,payload={},s=scope()){
    assertActive(s);
    const result=await host.api('/api/profile-workbench/biophysical/'+operation,{method:'POST',body:{workspace:s.workspace,...payload}});
    assertActive(s);return result;
  }
  function allTasks(){
    const rows=current()===workspace?list(host.getState()?.tasks).filter(task=>ACTIONS.has(task.action)):[];
    const ids=new Set(rows.map(row=>row.id));
    return [...rows,...list(memory?.requests).filter(row=>row.task&&!ids.has(row.task.id)).map(row=>row.task)];
  }
  const findTask=request=>allTasks().find(row=>row.id===request.task_id)||request.task||null;
  function receipt(task){return {id:task.id,action:task.action,state:task.state,result:{id:task.result?.id,profile_id:task.result?.profile_id},...(task.error?{error:copy(task.error)}:{})};}
  function retain(request,patch,s){
    const target=s.workspace===workspace&&memory?memory:stored(s.workspace);
    let row=target.requests.find(item=>item.operation_id===request.operation_id);
    if(!row){row=copy(request);target.requests.push(row);}
    Object.assign(row,copy(patch));save(target,s.workspace);return row;
  }
  function operationsHTML(){
    const requests=list(memory?.requests).filter(row=>row.profile_id===profileId);
    if(!requests.length)return '';
    return '<details class="pw-original-source"'+(requests.some(row=>!terminal(findTask(row)))?' open':'')+'><summary>Evidence and endpoint operations</summary><div class="pw-operations">'+requests.slice().reverse().map(request=>{
      const task=findTask(request),state=task?.state||'request retained';
      const label=request.action.endsWith('evidence.save')?'Save coefficient evidence':request.action.endsWith('evidence.populate')?'Populate coefficient provenance':request.action.endsWith('ranges.prepare')?'Prepare endpoint profiles':'Prepare native experiment';
      return '<div><span><strong>'+esc(label)+'</strong> · '+esc(human(state))+(task?.error?.message?'<small>'+esc(task.error.message)+'</small>':'')+'</span><div class="pw-actions">'+
        (request.task_id?button('task','Open operation','data-be-id="'+esc(request.task_id)+'"'):'')+
        (!request.task_id?button('retry','Retry retained request','data-be-id="'+esc(request.operation_id)+'"'):
          ['failed','interrupted'].includes(state)?button('resume','Resume operation','data-be-id="'+esc(request.task_id)+'"'):'')+'</div></div>';
    }).join('')+'</div></details>';
  }
  function coverageHTML(record){
    const c=record?.coverage||{};
    return '<dl class="pw-metadata"><dt>Documented cells</dt><dd>'+esc(c.documented??0)+' / '+esc(c.total??0)+'</dd><dt>Unknown cells</dt><dd>'+esc(c.unknown??0)+'</dd><dt>Cells with distinct endpoints</dt><dd>'+esc(c.range_eligible??0)+'</dd><dt>Documented nutrient load cells</dt><dd>'+esc(c.documented_load_cells??0)+' / '+esc(c.load_cells??0)+'</dd></dl><p class="pw-note">'+esc(c.meaning||'Coefficient counts for the selected native models.')+'</p>';
  }
  function evidenceChoices(){
    return option('','Choose saved evidence',!evidence)+list(catalog?.evidence).map(row=>option(row.id,(row.source?.title||short(row.id))+' · '+row.coverage.documented+'/'+row.coverage.total+' documented',row.id===evidence?.id)).join('');
  }
  function rangeChoices(){
    return option('','Choose saved endpoint profiles',!range)+list(catalog?.ranges).map(row=>option(row.id,row.title+' · '+row.selected_cells.length+' cells',row.id===range?.id)).join('');
  }
  function render(){
    if(!root?.isConnected)return;
    const value=draft(),available=sources();
    const sourceIndex=available.findIndex(row=>row.collection_id===value.source_collection_id&&row.id===value.source_id);
    root.innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>Coefficient evidence and ranges</h2><p>Bind original citations to this saved table and choose the exact coefficients to vary in native experiments.</p></div>'+button('refresh','Refresh evidence',busy?'disabled':'')+'</header><div class="pw-panel-body"><p data-be-message class="pw-message" role="status" aria-live="polite" hidden></p><div data-be-operations>'+operationsHTML()+'</div><div class="pw-two-columns"><div><h3>Document the original table</h3><p>Download the template, add the source for each documented cell, then import the completed CSV through Original sources. Values, units and nutrient load types must match this profile.</p><div class="pw-actions">'+button('template','Download evidence template',busy?'disabled':'')+button('cite-table','Cite original table',busy?'disabled':'')+'</div><p class="pw-note">Cite original table records each supplied coefficient with its exact source row and column. Add specific publications through an imported citation CSV.</p><label class="pw-field"><span>Imported evidence CSV</span><select data-be-field="source">'+option('','Select an original table source',sourceIndex<0)+available.map((row,i)=>option(JSON.stringify([row.collection_id,row.id]),row.title+' · '+row.collection_title,i===sourceIndex)).join('')+'</select></label><div class="pw-actions">'+button('preview','Inspect source evidence',sourceIndex<0||busy?'disabled':'',true)+'</div></div><div><h3>Retained evidence</h3><label class="pw-field"><span>Saved evidence for this exact profile</span><select data-be-field="evidence">'+evidenceChoices()+'</select></label><label class="pw-field"><span>Saved endpoint profiles</span><select data-be-field="range">'+rangeChoices()+'</select></label><p class="pw-note">Missing citations stay unknown. General profile references do not establish a source for an individual coefficient.</p></div></div><div data-be-evidence></div><div data-be-range></div></div></section>';
    setMessage(message,isError);renderEvidence();renderRange();
  }
  function renderEvidence(){
    const node=$('[data-be-evidence]');if(!node)return;
    const record=preview||evidence||catalog;if(!record){node.innerHTML='<p class="pw-note">Reading coefficient coverage…</p>';return;}
    const value=draft(),isSaved=Boolean(evidence&&!preview),all=list(record.cells);
    const filtered=all.filter(row=>(value.filter==='all'||value.filter==='unknown'&&row.source_status==='unknown'||value.filter==='ranged'&&row.range_eligible)&&(!value.search||text(row.lucode+' '+row.parameter+' '+(row.source?.title||'')).toLowerCase().includes(value.search.toLowerCase())));
    node.innerHTML='<section class="pw-original-source"><h3>'+(preview?'Evidence source preview':evidence?'Saved coefficient evidence':'Original table coverage')+'</h3><div class="pw-two-columns"><div>'+coverageHTML(record)+'</div><div>'+(record.source?'<p><strong>Evidence CSV:</strong> '+esc(record.source.title)+'</p><p class="pw-multiline">'+esc(record.source.uri)+'</p><p class="mono">SHA256 '+esc(record.source.sha256)+'</p>':'<p class="pw-note">Choose or save an evidence CSV to document these coefficients.</p>')+'<p class="mono">Table SHA256 '+esc(record.table?.sha256)+'</p><div class="pw-actions">'+links(record)+(preview?button('save-evidence','Save this evidence',busy?'disabled':'',true)+button('fill-provenance','Fill remaining table provenance',busy?'disabled':'')+button('close-preview','Close preview'): '')+'</div></div></div><div class="pw-inline-form"><label class="pw-field"><span>Find land-cover code, parameter or source</span><input data-be-field="search" type="search" value="'+esc(value.search)+'"></label><label class="pw-field"><span>Show</span><select data-be-field="filter">'+[['all','All cells'],['unknown','Unknown sources'],['ranged','Distinct sourced endpoints']].map(([key,label])=>option(key,label,value.filter===key)).join('')+'</select></label></div><div class="pw-table-scroll"><table class="pw-table be-coefficients"><thead><tr><th>Vary</th><th>Land cover</th><th>Parameter and units</th><th>Central</th><th>Source</th><th>Lower / upper</th></tr></thead><tbody>'+filtered.map(row=>{
      const key=cellKey(row),selected=value.selected.includes(key);
      return '<tr><td><input type="checkbox" data-be-cell="'+esc(key)+'" aria-label="Vary '+esc(row.lucode+' '+row.parameter)+'"'+(selected?' checked':'')+(!isSaved||!row.range_eligible?' disabled':'')+'></td><td>'+esc(row.lucode)+'</td><td>'+esc(row.parameter)+'<small>'+esc(row.units)+(row.load_type?' · '+esc(row.load_type):'')+'</small></td><td>'+esc(row.table_value_text)+'</td><td>'+citation(row.source)+'</td><td>'+(row.range?esc(row.range.lower_text)+' / '+esc(row.range.upper_text)+'<small>'+esc(row.range.basis)+'</small>':'—')+'</td></tr>';
    }).join('')+'</tbody></table></div><p class="pw-note">'+filtered.length+' of '+all.length+' coefficient cells shown. '+esc(value.selected.length)+' selected for endpoint profiles.</p>'+
      (isSaved?'<form data-be-range-form><div class="pw-form-grid"><label class="pw-field pw-full"><span>Endpoint profile title</span><input data-be-field="title" value="'+esc(value.title)+'" required maxlength="300"></label><label class="pw-field pw-full"><span>Scientific purpose</span><textarea data-be-field="reason" rows="3" required maxlength="20000">'+esc(value.reason)+'</textarea></label></div><p class="pw-note">Lower and upper name parameter values. They are not confidence limits or automatically lower and higher pollution outcomes. All unselected coefficient cells stay unchanged.</p><div class="pw-actions">'+button('preview-ranges','Review selected endpoints',!value.selected.length||busy?'disabled':'',true)+'</div></form>':'')+'</section>';
  }
  function rangeSelection(){
    if(!evidence)throw Error('Open saved evidence before selecting endpoints.');
    const value=draft(),keys=new Set(value.selected);
    return {evidence_id:evidence.id,title:value.title.trim(),reason:value.reason.trim(),
      parameters:list(evidence.cells).filter(row=>keys.has(cellKey(row))).map(row=>({lucode:row.lucode,parameter:row.parameter})).sort((a,b)=>a.lucode-b.lucode||(a.parameter<b.parameter?-1:a.parameter>b.parameter?1:0))};
  }
  function renderRange(){
    const node=$('[data-be-range]');if(!node)return;
    if(rangePreview){
      const selected=list(rangePreview.selected_cells);
      node.innerHTML='<section class="pw-original-source"><h3>Review endpoint profiles</h3><p>'+esc(rangePreview.selection.title)+'</p><p>'+esc(rangePreview.selection.reason)+'</p><p>'+selected.length+' selected cells; the original central profile is '+esc(short(rangePreview.central.profile_id))+'.</p><div class="pw-table-scroll"><table class="pw-table"><thead><tr><th>Land cover</th><th>Parameter</th><th>Lower</th><th>Central</th><th>Upper</th><th>Units</th></tr></thead><tbody>'+selected.map(row=>'<tr><td>'+esc(row.lucode)+'</td><td>'+esc(row.parameter)+'</td><td>'+esc(row.range.lower_text)+'</td><td>'+esc(row.table_value_text)+'</td><td>'+esc(row.range.upper_text)+'</td><td>'+esc(row.units)+'</td></tr>').join('')+'</tbody></table></div><p class="pw-note">'+esc(rangePreview.methods?.ranges)+'</p><div class="pw-actions">'+button('prepare-ranges','Prepare these profiles',busy?'disabled':'',true)+button('close-range-preview','Close preview')+'</div></section>';return;
    }
    if(!range){node.innerHTML='';return;}
    const value=draft(),baselines=baselineRuns(),alternatives=scenarios().filter(row=>row.kind!=='baseline');
    node.innerHTML='<section class="pw-original-source"><h3>'+esc(range.title)+'</h3><p>'+esc(range.reason)+'</p><div class="pw-table-scroll"><table class="pw-table"><thead><tr><th>Parameter position</th><th>Saved profile</th><th>Original table SHA256</th></tr></thead><tbody>'+['lower','central','upper'].map(position=>{
      const item=range.profiles[position];
      return '<tr><td>'+esc(human(position))+'</td><td>'+button('profile',item.title||short(item.profile_id),'data-be-id="'+esc(item.profile_id)+'"')+'</td><td class="mono">'+esc(item.table_sha256)+'</td></tr>';
    }).join('')+'</tbody></table></div><div class="pw-actions">'+links(range)+'</div><h4>Prepare a native experiment</h4><p>Use a completed baseline run from the original central profile. The prepared experiment appears in Experiments, where its native runs and results follow the existing workflow.</p><label class="pw-field"><span>Central profile baseline run</span><select data-be-field="baseline_run_id" required>'+option('','Choose a completed baseline',!value.baseline_run_id)+baselines.map(row=>option(row.id,(scenarios().find(item=>item.id===row.selection.scenario_id)?.title||'Baseline')+' · '+short(row.id),row.id===value.baseline_run_id)).join('')+'</select></label>'+(!baselines.length?'<p class="pw-note">Complete the original central profile on a baseline land-cover scenario to prepare this experiment.</p>':'')+'<fieldset class="pw-parameters"><legend>Additional land-cover scenarios</legend>'+alternatives.map(row=>'<label class="be-scenario"><input type="checkbox" data-be-scenario="'+esc(row.id)+'"'+(value.scenario_ids.includes(row.id)?' checked':'')+'>'+esc(row.title||short(row.id))+'</label>').join('')+'</fieldset><p class="pw-note">Each saved endpoint profile is evaluated on baseline land cover and every selected scenario. Scenario changes use the matching baseline under that same profile.</p><div class="pw-actions">'+button('prepare-experiment','Prepare native experiment',!baselines.some(row=>row.id===value.baseline_run_id)||busy?'disabled':'',true)+'</div></section>';
  }
  async function refresh({reopen=true}={}){
    const s=scope(),token=++intent,result=await read('catalog',{profile_id:s.profileId},s);
    if(!alive(s)||token!==intent)return;
    if(result.profile?.id!==profileId)throw Error('The evidence catalog belongs to another profile.');
    catalog=result;preview=null;rangePreview=null;
    const value=draft();
    if(reopen&&value.evidence_id&&list(result.evidence).some(row=>row.id===value.evidence_id)){
      const item=await read('evidence-inspect',{evidence_id:value.evidence_id},s);if(!alive(s)||token!==intent)return;evidence=item;
    }else{evidence=null;value.evidence_id='';value.selected=[];}
    if(reopen&&value.range_id&&list(result.ranges).some(row=>row.id===value.range_id)){
      const item=await read('ranges-inspect',{range_id:value.range_id},s);if(!alive(s)||token!==intent)return;range=item;
    }else{range=null;value.range_id='';}
    save();render();
  }
  async function selectEvidence(id){
    const s=scope(),token=++intent;preview=null;rangePreview=null;
    const item=id?await read('evidence-inspect',{evidence_id:id},s):null;
    if(!alive(s)||token!==intent)return;
    if(item&&item.profile_id!==profileId)throw Error('Choose evidence for this original profile.');
    evidence=item;draft().evidence_id=id;draft().selected=[];save();render();
  }
  async function selectRange(id){
    const s=scope(),token=++intent;rangePreview=null;
    const item=id?await read('ranges-inspect',{range_id:id},s):null;
    if(!alive(s)||token!==intent)return;
    if(item&&item.profile_id!==profileId)throw Error('Choose endpoints for this original profile.');
    range=item;draft().range_id=id;save();renderRange();
  }
  async function issue(request,s){
    retain(request,{},s);
    const task=await host.api('/api/actions',{method:'POST',body:{workspace:s.workspace,action:request.action,payload:copy(request.payload),operation_id:request.operation_id}});
    if(!task?.id)throw Error('The operator did not return the retained operation. Retry the same request.');
    retain(request,{task_id:task.id,task:receipt(task)},s);
    if(!alive(s))return task;
    const node=$('[data-be-operations]');if(node)node.innerHTML=operationsHTML();
    await host.refreshState?.({force:true});if(!alive(s))return task;
    await completeOperations();if(!alive(s))return task;
    setMessage(task.state==='complete'?'The original operator completed the operation.':'The original operator retained this operation. Its progress appears above.');
    return task;
  }
  async function queue(action,payload){
    const s=scope();assertActive(s);const signature=canonical({action,payload});
    let request=memory.requests.find(row=>row.profile_id===profileId&&row.signature===signature);
    if(!request){request={operation_id:requestId(),profile_id:profileId,action,payload:copy(payload),signature,created_at:new Date().toISOString(),handled:false};memory.requests.push(request);}
    save();return issue(copy(request),s);
  }
  async function completeOperations(){
    if(processing||!root?.isConnected)return;
    const s=scope();processing=true;
    try{
      const finished=memory.requests.filter(row=>row.profile_id===profileId&&!row.handled&&findTask(row)?.state==='complete');
      if(!finished.length)return;
      const before=intent,items=finished.map(request=>({request,task:findTask(request)}));
      for(const {request,task} of items)retain(request,{task:receipt(task)},s);
      const result=await read('catalog',{profile_id:s.profileId},s);if(!alive(s))return;
      catalog=result;
      if(before===intent){
        const saved=items.filter(row=>row.request.action.endsWith('evidence.save')||row.request.action.endsWith('evidence.populate')).at(-1);
        const prepared=items.filter(row=>row.request.action.endsWith('ranges.prepare')).at(-1);
        if(saved)await selectEvidence(saved.task.result.id);
        if(alive(s)&&prepared)await selectRange(prepared.task.result.id);
      }
      if(!alive(s))return;
      for(const {request} of items)retain(request,{handled:true},s);
      render();
    }finally{if(s.generation===generation)processing=false;}
  }
  async function action(name,target){
    if(name==='refresh'){await refresh();return completeOperations();}
    if(name==='template'){
      const result=await read('template',{profile_id:profileId});
      const url=URL.createObjectURL(new Blob([result.csv_text],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=result.filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(result.instructions);return;
    }
    if(name==='preview'){
      const value=draft();if(!value.source_collection_id||!value.source_id)throw Error('Choose an imported evidence CSV.');
      const s=scope(),token=++intent,payload={profile_id:profileId,source_collection_id:value.source_collection_id,source_id:value.source_id};
      const result=await read('evidence-preview',payload,s);
      if(!alive(s)||token!==intent)return;
      preview=result;preview._selection=payload;rangePreview=null;renderEvidence();renderRange();return;
    }
    if(name==='cite-table')return queue('profile.biophysical.evidence.populate',{profile_id:profileId});
    if(name==='fill-provenance'){
      const value=draft();if(!preview||preview._selection.source_collection_id!==value.source_collection_id||preview._selection.source_id!==value.source_id)throw Error('Inspect the selected citation CSV before filling table provenance.');
      return queue('profile.biophysical.evidence.populate',preview._selection);
    }
    if(name==='save-evidence'){
      const value=draft();if(!preview||preview._selection.source_collection_id!==value.source_collection_id||preview._selection.source_id!==value.source_id)throw Error('Inspect the selected source evidence before saving.');
      return queue('profile.biophysical.evidence.save',preview._selection);
    }
    if(name==='close-preview'){preview=null;renderEvidence();return;}
    if(name==='preview-ranges'){
      if(!$('[data-be-range-form]')?.reportValidity())return;
      const s=scope(),token=++intent,selection=rangeSelection(),result=await read('ranges-preview',selection,s);
      if(!alive(s)||token!==intent||canonical(selection)!==canonical(rangeSelection()))return;
      rangePreview=result;renderRange();return;
    }
    if(name==='prepare-ranges'){
      if(!rangePreview||canonical(rangePreview.selection)!==canonical(rangeSelection()))throw Error('Review the current selected endpoints before preparing profiles.');
      return queue('profile.biophysical.ranges.prepare',rangePreview.selection);
    }
    if(name==='close-range-preview'){rangePreview=null;renderRange();return;}
    if(name==='prepare-experiment'){
      const value=draft();if(!range||!baselineRuns().some(row=>row.id===value.baseline_run_id))throw Error('Choose the completed central profile baseline.');
      return queue('profile.biophysical.experiment.prepare',{range_id:range.id,baseline_run_id:value.baseline_run_id,scenario_ids:copy(value.scenario_ids)});
    }
    if(name==='profile')return onProfile(target.dataset.beId);
    if(name==='task')return host.showTask?.(target.dataset.beId);
    if(name==='retry'){
      const request=memory.requests.find(row=>row.operation_id===target.dataset.beId&&row.profile_id===profileId);
      if(!request)throw Error('The retained request is unavailable.');return issue(copy(request),scope());
    }
    if(name==='resume'){
      const s=scope();await host.api('/api/task/resume',{method:'POST',body:{id:target.dataset.beId}});
      await host.refreshState?.({force:true});if(alive(s))await completeOperations();
    }
  }
  async function clicked(event){
    const target=event.target.closest('[data-be-action]');if(!target||!root?.contains(target))return;
    event.preventDefault();event.stopPropagation();if(busy)return;
    const s=scope();busy=true;target.disabled=true;
    try{setMessage();await action(target.dataset.beAction,target);}
    catch(error){if(alive(s))setMessage(error.message||error,true);}
    finally{if(alive(s)){busy=false;if(target.isConnected)target.disabled=false;render();}}
  }
  async function changed(event){
    const node=event.target;if(!root?.contains(node))return;
    const field=node.dataset.beField,value=draft(),s=scope();
    try{
      if(node.dataset.beCell){
        const key=node.dataset.beCell;value.selected=node.checked?[...new Set([...value.selected,key])]:value.selected.filter(item=>item!==key);
        rangePreview=null;++intent;save();renderEvidence();renderRange();return;
      }
      if(node.dataset.beScenario){value.scenario_ids=node.checked?[...new Set([...value.scenario_ids,node.dataset.beScenario])]:value.scenario_ids.filter(id=>id!==node.dataset.beScenario);save();return;}
      if(!field)return;
      if(field==='source'){
        const ids=node.value===''?null:JSON.parse(node.value);const row=ids?sources().find(item=>item.collection_id===ids[0]&&item.id===ids[1]):null;value.source_collection_id=row?.collection_id||'';value.source_id=row?.id||'';
        preview=null;rangePreview=null;++intent;save();render();return;
      }
      if(field==='evidence'){await selectEvidence(node.value);return;}
      if(field==='range'){await selectRange(node.value);return;}
      value[field]=node.value;save();
      if(field==='title'||field==='reason'){rangePreview=null;++intent;renderRange();}
      if(field==='search'||field==='filter'){
        const focus=field==='search',start=node.selectionStart;renderEvidence();
        const replacement=$('[data-be-field="search"]');if(focus&&replacement){replacement.focus();if(start!=null)replacement.setSelectionRange(start,start);}
      }
      if(field==='baseline_run_id')renderRange();
    }catch(error){if(alive(s))setMessage(error.message||error,true);}
  }
  async function mount(node,selection){
    detach();root=node;workspace=selection.workspace_key;profileId=selection.profile_id;title=selection.title||'';
    memory=stored(workspace);catalog=null;evidence=null;range=null;preview=null;rangePreview=null;message='';isError=false;taskSignature='';
    events=new AbortController();root.addEventListener('click',clicked,{signal:events.signal});
    root.addEventListener('change',changed,{signal:events.signal});root.addEventListener('input',event=>{if(['title','reason','search'].includes(event.target.dataset.beField))changed(event);},{signal:events.signal});
    root.addEventListener('submit',event=>event.preventDefault(),{signal:events.signal});
    const s=scope();render();
    try{await refresh();if(alive(s))await completeOperations();}catch(error){if(alive(s))setMessage(error.message||error,true);}
  }
  function update(snapshot=host.getState()){
    if(!root)return;if(snapshot?.workspace_key!==workspace){detach();return;}
    const signature=canonical(allTasks().map(task=>[task.id,task.state]));
    if(signature!==taskSignature){taskSignature=signature;const node=$('[data-be-operations]');if(node)node.innerHTML=operationsHTML();const s=scope();completeOperations().catch(error=>{if(alive(s))setMessage(error.message||error,true);});}
  }
  function detach(){
    save();events?.abort();events=null;root=null;generation++;intent++;busy=false;processing=false;
  }
  return {mount,update,detach};
}
