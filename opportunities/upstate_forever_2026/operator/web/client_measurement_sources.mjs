/** Original retained worksheets into the existing Measurements preparation desk. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=x=>JSON.parse(JSON.stringify(x));
const fields=['source_collection_id','source_id','kind','label','reviewer','note','context'];
const schema='upstate.client-measurement-working/v1';
function fresh(workspace){return {schema,workspace,form:{source_collection_id:'',source_id:'',kind:'wqp',label:'',reviewer:'',note:'',context:''},requests:[],history:[]};}
function checked(value,workspace){
  if(value?.schema!==schema||value.workspace!==workspace||!value.form||!Array.isArray(value.requests))throw Error('Choose a complete working copy for this scientific workspace.');
  if(fields.some(k=>typeof value.form[k]!=='string')||!['wqp','stations'].includes(value.form.kind))throw Error('The original preparation fields are incomplete.');
  for(const request of value.requests)if(typeof request.operation_id!=='string'||request.action!=='client-measurement.prepare'||request.workspace!==workspace||!request.payload||fields.some(k=>typeof request.payload[k]!=='string')||typeof request.payload.target_workspace_id!=='string')throw Error('An original preparation request is incomplete.');
  if(value.history!==undefined&&(!Array.isArray(value.history)||value.history.some(x=>!x||!x.form||!Array.isArray(x.requests))))throw Error('The complete prior working history is invalid.');
  if(new TextEncoder().encode(JSON.stringify(value)).length>4*1024*1024)throw Error('Retain this complete working history separately before creating another preparation.');
  return value;
}
function download(name,value){const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function createClientMeasurementSources(host){
  let root=null,workspace=null,epoch=0,busy=false,controller=null,catalog=null,result=null,draft=null,storage='',invalid=null,status='',failure='';
  const memory=new Map(),key=w=>'upstate-client-measurement-working-v1:'+w;
  const q=s=>root?.querySelector(s),alive=(w,e)=>root&&workspace===w&&epoch===e;
  function retain(){
    checked(draft,workspace);memory.set(workspace,copy(draft));
    if(invalid!==null){storage='The previous unreadable browser copy remains unchanged. Download it and this complete working copy before leaving.';return;}
    try{sessionStorage.setItem(key(workspace),JSON.stringify(draft));storage='';}
    catch(error){storage='Browser storage is unavailable. This working copy remains in this page; download it before leaving. '+error.message;}
  }
  function load(){
    invalid=null;storage='';draft=memory.has(workspace)?copy(memory.get(workspace)):fresh(workspace);
    if(memory.has(workspace))return;
    let raw;try{raw=sessionStorage.getItem(key(workspace));}catch(error){storage='Browser storage is unavailable. Download this complete working copy before leaving.';return;}
    if(raw)try{draft=checked(JSON.parse(raw),workspace);}catch(error){invalid=raw;storage='The previous browser copy could not be read and is unchanged. Its exact original is downloadable.';}
  }
  function capture(){
    const f=q('[data-form]');if(!f)return;
    for(const name of ['kind','label','reviewer','note','context'])draft.form[name]=f.elements[name].value;
    const chosen=catalog?.sources.find(s=>s.source_collection_id+'|'+s.source_id===f.elements.source.value);
    if(chosen){draft.form.source_collection_id=chosen.source_collection_id;draft.form.source_id=chosen.source_id;}
    retain();
  }
  function messages(){
    if(!root)return;
    q('[data-status]').textContent=status;q('[data-error]').textContent=failure;q('[data-storage]').textContent=storage;
    for(const el of root.querySelectorAll('[data-write]'))el.disabled=busy;
  }
  function render(){
    if(!root)return;
    const f=draft.form,chosen=f.source_collection_id+'|'+f.source_id;
    root.innerHTML='<main class="ci-desk"><header><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Prepare workbook measurements</h1><p>Select a retained worksheet or delimited table. Its complete original and physical row map accompany a saved preparation in the existing Measurements workspace.</p></header><p data-error role="alert" class="ci-error"></p><p data-status role="status" aria-live="polite"></p><p data-storage class="ci-warning" role="status"></p>'+
    '<section><h2>Original worksheet and target</h2><p>The worksheet, header, encoding and formula-reading choices come from its reviewed source edition. Change those choices in Open my data to create another source edition.</p><form data-form><label>Retained measurement source<select name="source" data-write><option value="">Choose a saved measurement source</option>'+ (catalog?.sources||[]).map(s=>'<option value="'+esc(s.source_collection_id+'|'+s.source_id)+'"'+(chosen===s.source_collection_id+'|'+s.source_id?' selected':'')+'>'+esc(s.title+' · '+s.filename+(s.sheet?' / '+s.sheet:''))+'</option>').join('')+'</select></label><p>Measurements workspace: <code>'+esc(catalog?.target_workspace_id||'Loading original workspace…')+'</code></p>'+
    '<label>Scientific source type<select name="kind" data-write><option value="wqp"'+(f.kind==='wqp'?' selected':'')+'>Chemistry / WQP</option><option value="stations"'+(f.kind==='stations'?' selected':'')+'>Monitoring stations</option></select></label>'+
    ['label','reviewer','note','context'].map(name=>'<label>'+({label:'Preparation name',reviewer:'Mapping reviewer',note:'Review note',context:'Original source context'})[name]+'<textarea name="'+name+'" rows="'+(name==='context'?3:1)+'" data-write>'+esc(f[name])+'</textarea></label>').join('')+
    '<div class="ci-actions"><button type="submit" data-write>Save worksheet preparation</button><button type="button" data-action="sources">Open my data</button><button type="button" data-action="measurements">Open Measurements</button></div></form><p>No observations are imported by this control. Review the saved preparation’s columns, units, fractions, dates and native acceptance/rejection counts in Measurements before importing.</p></section>'+
    '<section><h2>Working copy and original operations</h2><div class="ci-actions"><button data-action="download">Download complete working copy</button><label>Open working copy<input type="file" accept=".json,application/json" data-open data-write></label>'+(invalid!==null?'<button data-action="invalid">Download exact previous browser copy</button>':'')+'<button data-action="refresh" data-write>Refresh saved preparations</button></div><div>'+
    (catalog?.operations||[]).map(row=>'<p><button data-action="result" data-id="'+esc(row.id)+'" data-write>'+esc(row.title+' · '+row.state)+'</button> <button data-action="task" data-id="'+esc(row.id)+'">Progress / original request</button> '+(row.state==='failed'?'<button data-action="resume" data-id="'+esc(row.id)+'" data-write>Resume original operation</button> ':'')+esc(row.preparation_id||'')+'</p>').join('')+draft.requests.filter(r=>r.task_id&&!(catalog?.operations||[]).some(o=>o.id===r.task_id)).map(r=>'<p><button data-action="task" data-id="'+esc(r.task_id)+'">Open retained queued operation</button></p>').join('')+'</div></section><section data-result></section></main>';
    renderResult();messages();
  }
  function renderResult(){
    const area=q('[data-result]');if(!area)return;
    if(!result){area.innerHTML='';return;}
    area.innerHTML='<h2>'+esc(result.title)+'</h2><p>'+esc(result.state)+' · preparation <code>'+esc(result.preparation_id)+'</code></p><p>Open Measurements and select this saved preparation. Complete source lineage remains bound to the original scientific source edition and worksheet.</p><div class="ci-actions"><button data-action="measurements">Open Measurements</button></div><div class="ci-downloads">'+(result._downloads||[]).map(file=>'<a download href="'+esc(file.url)+'?download=1">'+esc(file.label||file.filename)+'</a>').join('')+'</div>'+(result.error?'<p class="ci-error">'+esc(result.error.message)+'</p>':'');
  }
  async function refresh(){
    const w=workspace,e=epoch;
    const value=await host.api('/api/client-measurement/catalog',{method:'POST',body:{workspace:w}});
    if(!alive(w,e))return;
    catalog=value;render();
  }
  async function run(work){
    if(busy||!root)return;const w=workspace,e=epoch;busy=true;failure='';messages();
    try{await work();}catch(error){if(alive(w,e)){failure=error.message;messages();}}
    finally{if(alive(w,e)){busy=false;messages();}}
  }
  async function submit(){
    capture();const w=workspace,e=epoch;
    const found=catalog?.sources.find(s=>s.source_collection_id===draft.form.source_collection_id&&s.source_id===draft.form.source_id);
    if(!found||!q('[data-form]').elements.source.value)throw Error('Choose a retained original worksheet.');
    if(!draft.form.label.trim()||!draft.form.reviewer.trim())throw Error('Name this preparation and its mapping reviewer.');
    const payload={...copy(draft.form),target_workspace_id:catalog.target_workspace_id};
    let request=draft.requests.find(r=>JSON.stringify(r.payload)===JSON.stringify(payload));
    if(!request){request={workspace:w,action:'client-measurement.prepare',operation_id:'client-measurement-'+crypto.randomUUID(),payload};const candidate=copy(draft);candidate.requests.push(request);checked(candidate,w);draft=candidate;request=draft.requests.at(-1);retain();}
    status='Saving the retained worksheet through the original operator queue…';messages();
    const task=await host.api('/api/actions',{method:'POST',body:request});
    if(!alive(w,e))return;
    // The queue may coalesce aliases. Its returned task identity is authoritative.
    request.task_id=task.id;retain();status='Original operation '+task.state+'. The saved preparation retains the full source; review and import it in Measurements.';
    await host.refresh({force:true});if(!alive(w,e))return;await refresh();
  }
  function suspend(){if(root){capture();memory.set(workspace,copy(draft));}controller?.abort();root=null;epoch++;busy=false;}
  function mount(target){
    suspend();root=target;workspace=host.getWorkspace();epoch++;load();catalog=null;result=null;status='';failure='';render();controller=new AbortController();
    root.addEventListener('input',event=>{if(event.target.closest('[data-form]')){capture();messages();}},{signal:controller.signal});
    root.addEventListener('change',event=>{
      if(event.target.matches('[data-open]')){const file=event.target.files[0];if(file)void run(async()=>{
        capture();if(file.size>4*1024*1024)throw Error('Choose a complete working copy up to 4 MiB.');
        const w=workspace,e=epoch,value=checked(JSON.parse(await file.text()),w);if(!alive(w,e))return;
        // Retain the full prior form/request history before explicit replacement.
        const candidate=copy(value);candidate.history=[...(draft.history||[]),...(value.history||[]),{form:copy(draft.form),requests:copy(draft.requests),openedAt:new Date().toISOString()}];checked(candidate,w);draft=candidate;retain();render();status='Complete working copy opened. Original native operations are not replayed automatically.';messages();
      });}
      else if(event.target.closest('[data-form]')){capture();messages();}
    },{signal:controller.signal});
    root.addEventListener('submit',event=>{if(event.target.matches('[data-form]')){event.preventDefault();void run(submit);}},{signal:controller.signal});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;event.preventDefault();const action=button.dataset.action;
      if(action==='download'){capture();download('measurement-preparation-working.json',draft);return;}
      if(action==='invalid'){download('measurement-preparation-browser-original.json',invalid);return;}
      if(action==='task'){void host.showTask(button.dataset.id);return;}
      if(action==='resume'){void run(async()=>{await host.api('/api/task/resume',{method:'POST',body:{id:button.dataset.id}});await host.refresh({force:true});await refresh();});return;}
      if(action==='sources'){host.navigate('client-source-intake');return;}
      if(action==='measurements'){host.navigate('measured-observations');return;}
      if(action==='refresh'){capture();void run(refresh);}
      if(action==='result')void run(async()=>{const w=workspace,e=epoch,value=await host.api('/api/client-measurement/result',{method:'POST',body:{workspace:w,id:button.dataset.id}});if(!alive(w,e))return;result=value;renderResult();messages();});
    },{signal:controller.signal});
    void run(refresh);
  }
  return {mount,update(){if(root&&workspace!==host.getWorkspace())mount(root);},suspend};
}
