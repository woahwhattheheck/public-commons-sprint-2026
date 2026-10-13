/** Customer review of exact saved parameter profiles through the original review engine. */
const text=value=>String(value??'');
const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const short=value=>text(value).slice(0,12);
const human=value=>text(value).replace(/[_-]+/g,' ');
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const status=value=>({working:'Working',reviewed:'Scientist reviewed',changes_requested:'Changes requested'}[value]||human(value)||'Working');
const button=(action,label,attrs='',primary=false)=>'<button type="button" data-pcr-action="'+esc(action)+'" '+attrs+' class="'+(primary?'primary':'')+'">'+esc(label)+'</button>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const ACTIONS=new Set(['profile.customer_review.create','profile.customer_review.apply']);
const terminal=task=>['complete','failed','interrupted','cancelled'].includes(task?.state);
function links(record){
  return list(record?._downloads).filter(file=>/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(file.url||'')).map(file=>'<a class="pw-download" href="'+esc(file.url)+'?download=1" download>'+esc(file.label||file.filename||'Retained file')+'</a>').join('');
}
function metadata(rows){
  return '<dl class="pw-metadata">'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v==null||v===''?'Not recorded':typeof v==='object'?JSON.stringify(v):v)+'</dd>').join('')+'</dl>';
}
function reviewButton(id){
  return id?'<button type="button" data-action="review-open" data-id="'+esc(id)+'">Open customer review</button>':'';
}
function requestId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  if(!globalThis.crypto?.getRandomValues)throw Error('This browser cannot create a retained operation identifier.');
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return 'profile-review-'+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function createProfileCustomerReview(host,{onApplied=async()=>{}}={}){
  if(typeof host.api!=='function'||typeof host.getState!=='function')throw Error('Open customer profile reviews through the scientific operator.');
  let root=null,events=null,workspace=null,profileId=null,profileTitle='',generation=0,readEpoch=0,previewEpoch=0,intentEpoch=0;
  let memory=null,catalog=null,opened=null,preview=null,responseId='',message='',error=false,busy=false,loading=false,taskSignature='',processing=false;
  const current=()=>host.getState()?.workspace_key||null;
  const storageKey=key=>'upstate-profile-customer-review-v1:'+key;
  const empty=()=>({drafts:{},selections:{},roles:{},requests:[]});
  function stored(key){
    try{
      const value=JSON.parse(localStorage.getItem(storageKey(key))||'null');
      if(value&&value.drafts&&value.selections&&value.roles&&Array.isArray(value.requests))
        return value;
    }catch{}
    return empty();
  }
  function save(value=memory,key=workspace){
    if(!key||!value)return;
    try{localStorage.setItem(storageKey(key),JSON.stringify(value));}
    catch{if(key===workspace)setMessage('Browser recovery storage is unavailable. Keep this page open until the original operator returns its operation.',true);}
  }
  const scope=()=>({workspace,profileId,generation});
  const alive=s=>Boolean(root&&root.isConnected&&s.workspace===workspace&&s.profileId===profileId&&s.generation===generation&&current()===workspace);
  const $=selector=>root?.querySelector(selector);
  function assertActive(s=scope()){if(!alive(s))throw Error('The selected project or profile changed. Reopen its customer review.');}
  function draft(){
    if(!memory.drafts[profileId])memory.drafts[profileId]={title:(profileTitle||'Scientific profile').slice(0,279)+' — coefficient review',purpose:'',notes:''};
    return memory.drafts[profileId];
  }
  function role(){
    return opened?text(memory.roles[opened.capture_id]||''):'';
  }
  function setMessage(value='',isError=false){
    message=text(value);error=isError;
    const node=$('[data-pcr-message]');
    if(node){node.textContent=message;node.hidden=!message;node.classList.toggle('pw-error',error);}
  }
  async function read(operation,payload={},s=scope()){
    assertActive(s);
    const result=await host.api('/api/profile-workbench/customer-reviews/'+operation,{method:'POST',body:{workspace:s.workspace,...payload}});
    assertActive(s);return result;
  }
  function allTasks(){
    const rows=current()===workspace?list(host.getState()?.tasks).filter(task=>ACTIONS.has(task.action)):[];
    const seen=new Set(rows.map(task=>task.id));
    return [...rows,...list(memory?.requests).filter(r=>r.task&&(!r.task.id||!seen.has(r.task.id))).map(r=>r.task)];
  }
  function findTask(request){return allTasks().find(task=>task.id===request.task_id)||request.task||null;}
  function taskReceipt(task){
    const result=task.result||{};
    return {id:task.id,action:task.action,state:task.state,
      result:{capture_id:result.capture_id,profile_id:result.profile_id,profile_review_id:result.profile_review_id},
      ...(task.error?{error:clone(task.error)}:{})};
  }
  function retain(request,patch,s){
    const target=s.workspace===workspace&&memory?memory:stored(s.workspace);
    let row=target.requests.find(item=>item.operation_id===request.operation_id);
    if(!row){row=clone(request);target.requests.push(row);}
    Object.assign(row,clone(patch));
    save(target,s.workspace);
    return row;
  }
  function tasksHTML(){
    const requests=list(memory?.requests).filter(row=>row.profile_id===profileId);
    if(!requests.length)return '';
    return '<details class="pw-original-source"'+(requests.some(r=>!terminal(findTask(r)))?' open':'')+'><summary>Customer review operations</summary><div class="pw-operations">'+requests.slice().reverse().map(request=>{
      const task=findTask(request),state=task?.state||'request retained';
      return '<div><span><strong>'+esc(request.action.endsWith('.create')?'Capture exact profile for review':'Apply returned review')+'</strong> · '+esc(human(state))+
        (task?.error?.message?'<small>'+esc(task.error.message)+'</small>':'')+'</span><div class="pw-actions">'+
        (request.task_id?button('task','Open operation','data-pcr-task="'+esc(request.task_id)+'"'):'')+
        (!request.task_id?button('retry-request','Retry retained request','data-pcr-operation="'+esc(request.operation_id)+'"'):
          ['failed','interrupted'].includes(state)?button('resume','Resume same operation','data-pcr-task="'+esc(request.task_id)+'"'):'')+
        '</div></div>';
    }).join('')+'</div></details>';
  }
  function renderOperations(){const node=$('[data-pcr-operations]');if(node)node.innerHTML=tasksHTML();}
  function capturesHTML(){
    const captures=list(catalog?.captures).filter(row=>row.profile_id===profileId).slice().sort((a,b)=>text(b.created_at).localeCompare(text(a.created_at)));
    return captures.length?'<label class="pw-field"><span>Retained customer reviews</span><select data-pcr-field="capture">'+option('','Choose a retained review',!opened)+captures.map(row=>option(row.capture_id,(row.title||short(row.capture_id))+' · '+date(row.created_at)+(row.latest_response_id?' · response received':''),row.capture_id===opened?.capture_id)).join('')+'</select></label>':'<p class="pw-empty">Capture this saved profile to open its first customer review.</p>';
  }
  function render(){
    if(!root||!root.isConnected)return;
    const value=draft();
    root.innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>Customer review of this profile</h2><p>Retain the exact parameters and coefficient table, collect decisions in the customer review desk, then apply the returned scientific outcome.</p></div>'+button('refresh','Refresh reviews',busy?'disabled':'')+'</header><div class="pw-panel-body"><p data-pcr-message class="pw-message" role="status" aria-live="polite" hidden></p><div data-pcr-operations>'+tasksHTML()+'</div><div class="pw-two-columns"><div><h3>Capture a review edition</h3><form data-pcr-create><div class="pw-form-grid"><label class="pw-field pw-full"><span>Review title</span><input data-pcr-field="title" maxlength="300" required value="'+esc(value.title)+'"></label><label class="pw-field pw-full"><span>Question for the reviewer</span><textarea data-pcr-field="purpose" rows="3" maxlength="20000" required>'+esc(value.purpose)+'</textarea><small>Explain the intended scientific use and what should be checked.</small></label><label class="pw-field pw-full"><span>Review notes</span><textarea data-pcr-field="notes" rows="3" maxlength="20000">'+esc(value.notes)+'</textarea><small>Each nonempty line is retained as a note.</small></label></div><p class="pw-note">The saved profile and its complete original coefficient table are included with the review requirements.</p><div class="pw-actions">'+button('create','Capture profile for review',busy?'disabled':'',true)+'</div></form></div><div><h3>Saved review editions</h3><div data-pcr-captures>'+capturesHTML()+'</div><p class="pw-note">Open the customer review to export the packet, record decisions or receive the original returned response.</p></div></div><div data-pcr-detail></div></div></section>';
    setMessage(message,error);renderDetail();
  }
  function historyHTML(){
    const rows=list(opened?.applications);
    if(!rows.length)return '<p class="pw-note">A returned decision has not yet been applied from this capture.</p>';
    return '<ol class="pw-review-history">'+rows.slice().reverse().map(row=>{
      const state=row.profile_review||row.review||row;
      return '<li><div><strong>'+esc(status(row.derived_status||state.status))+'</strong><span>'+esc(date(row.applied_at||row.created_at||state.created_at))+'</span></div>'+
        '<p>Response '+esc(short(row.response_id))+' · profile review '+esc(short(row.profile_review_id||state.id||state.review_id))+'</p>'+
        (state.reviewer?'<p>'+esc(typeof state.reviewer==='object'?state.reviewer.name:state.reviewer)+(state.reviewer_role?' · '+esc(state.reviewer_role):'')+'</p>':'')+
        button('historical','Inspect this applied response','data-pcr-response="'+esc(row.response_id)+'"')+'</li>';
    }).join('')+'</ol>';
  }
  function renderDetail(){
    const node=$('[data-pcr-detail]');if(!node)return;
    if(loading){node.innerHTML='<p class="pw-note" role="status">Reading the retained profile capture…</p>';return;}
    if(!opened){node.innerHTML='';return;}
    const table=opened.table||{},capture=opened.capture||{},state=opened.profile_review_state||{};
    const options=[...new Set([opened.latest_response_id,...list(opened.review?.responses).map(row=>row.id||row.response_id),...list(opened.applications).map(row=>row.response_id)].filter(Boolean))];
    const requirements=list(opened.requirements);
    node.innerHTML='<section class="pw-original-source"><h3>'+esc(opened.title||'Captured profile review')+'</h3><p><strong>Scientific purpose:</strong> '+esc(opened.purpose)+'</p><div class="pw-actions">'+reviewButton(opened.customer_review_id)+links(opened)+'</div><div class="pw-two-columns"><div>'+metadata([
      ['Saved profile',opened.profile_id],['Coefficient table SHA256',table.sha256||table.table_sha256||capture.table_sha256],
      ['Source collection',opened.source_collection_id||table.source_collection_id||capture.source_collection_id],['Captured',date(opened.created_at)],
    ])+'</div><div>'+metadata([['Customer review',opened.customer_review_id],['Capture',opened.capture_id],['Current scientific status',status(typeof state==='string'?state:state.status)],['Latest returned response',opened.latest_response_id]])+'</div></div>'+
    (requirements.length?'<details class="pw-original-source"><summary>Checks included in this review</summary><ul class="pw-reference-list">'+requirements.map(row=>'<li><strong>'+esc(row.title||row.id)+'</strong>'+(row.detail?'<p>'+esc(row.detail)+'</p>':'')+'</li>').join('')+'</ul></details>':'')+
    '<div class="pw-two-columns"><div><h3>Returned decision</h3>'+
    (options.length?'<label class="pw-field"><span>Original response</span><select data-pcr-field="response">'+options.map(id=>option(id,(id===opened.latest_response_id?'Latest returned response':'Earlier returned response')+' · '+short(id),id===responseId)).join('')+'</select></label><div class="pw-actions">'+button('preview','Check returned decisions',busy?'disabled':'',true)+'</div>':'<p class="pw-note">Receive a returned response in the original customer review desk, then refresh this capture.</p>')+
    '<div data-pcr-preview></div></div><div><h3>Applications to scientific status</h3>'+historyHTML()+'</div></div></section>';
    renderPreview();
  }
  function renderPreview(){
    const node=$('[data-pcr-preview]');if(!node)return;
    if(!preview){node.innerHTML='';return;}
    const reviewer=preview.reviewer||{},checks=list(preview.checks),reasons=list(preview.reasons),response=preview.response?.response||{},corrections=list(response.corrections);
    node.innerHTML='<section class="pw-preview"><header><h3>'+esc(status(preview.derived_status))+'</h3><p>'+esc(preview.status_explanation||'Derived from the exact returned requirements below.')+'</p></header>'+
      metadata([['Reviewer',reviewer.name],['Organization',reviewer.organization],['Role in the returned response',reviewer.role],['Response',preview.response_id],['Scientific review being continued',preview.current_profile_review_id||'Initial review']])+
      (preview.requires_reviewer_role?'<label class="pw-field"><span>Reviewer role for this scientific record</span><input data-pcr-field="reviewer_role" value="'+esc(role())+'" maxlength="300" required><small>The returned response omitted this field. Record the reviewer’s actual role before applying.</small></label>':'')+
      (preview.reviewer_role?'<p class="pw-note">Scientific reviewer role: '+esc(preview.reviewer_role)+' · '+esc(human(preview.reviewer_role_origin))+'</p>':'')+
      (response.summary?'<p><strong>Reviewer summary:</strong> '+esc(response.summary)+'</p>':'')+
      (checks.length?'<div class="pw-table-scroll" tabindex="0"><table><thead><tr><th scope="col">Required check</th><th scope="col">Returned decision</th><th scope="col">Accepted</th><th scope="col">Reviewer explanation and requested change</th></tr></thead><tbody>'+checks.map(row=>'<tr><th scope="row">'+esc(row.title||row.id)+'</th><td>'+esc(human(row.decision))+'</td><td>'+esc(row.accepted?'Yes':'No')+'</td><td>'+(row.comment?'<p>'+esc(row.comment)+'</p>':'')+(row.requested_change?'<p><strong>Requested change:</strong> '+esc(row.requested_change)+'</p>':'')+(row.assignee?'<p><strong>Assignee:</strong> '+esc(row.assignee)+'</p>':'')+(!row.comment&&!row.requested_change&&!row.assignee?'No additional explanation.':'')+'</td></tr>').join('')+'</tbody></table></div>':'')+
      (corrections.length?'<h4>Returned corrections</h4><ul class="pw-reference-list">'+corrections.map(row=>'<li><strong>'+esc(row.title)+'</strong> · '+esc(human(row.state))+(row.description?'<p>'+esc(row.description)+'</p>':'')+(row.assignee?'<p>Assignee: '+esc(row.assignee)+'</p>':'')+(row.resolution?'<p>Resolution: '+esc(row.resolution)+'</p>':'')+'</li>').join('')+'</ul>':'')+
      (reasons.length?'<ul class="pw-validation-errors">'+reasons.map(row=>'<li>'+esc(row.message||human(row.code))+'</li>').join('')+'</ul>':'')+
      (!preview.response_is_latest?'<p class="pw-note">A newer returned response exists. Select the latest response to record the current outcome.</p>':'')+
      (preview.already_applied?'<p class="pw-note">This exact response already has a retained scientific application.</p>':'')+
      (preview.can_apply&&!preview.already_applied?'<div data-pcr-apply><p class="pw-note">Applying this response records '+esc(status(preview.derived_status))+' on this exact saved profile.</p><div class="pw-actions">'+button('apply','Apply returned scientific review',busy?'disabled':'',true)+'</div></div>':'')+
      (preview.requires_reviewer_role?'<div class="pw-actions">'+button('preview','Check role and decisions again',busy?'disabled':'')+'</div>':'')+'</section>';
  }
  async function openCapture(id,{preferredResponse=null}={}){
    const s=scope(),token=++readEpoch;
    ++previewEpoch;loading=true;opened=null;preview=null;responseId='';renderDetail();
    const result=await read('inspect',{capture_id:id},s);
    if(!alive(s)||token!==readEpoch)return;
    if(result.profile_id!==profileId)throw Error('This capture belongs to a different saved profile.');
    opened=result;loading=false;
    memory.selections[profileId]=id;responseId=preferredResponse||result.latest_response_id||'';
    save();render();setMessage();
  }
  async function refresh({reopen=true}={}){
    const s=scope(),selected=opened?.capture_id||memory.selections[profileId],token=++readEpoch;
    const result=await read('catalog',{profile_id:s.profileId},s);if(!alive(s)||token!==readEpoch)return;
    catalog=result;
    if(reopen&&selected&&list(result.captures).some(row=>row.capture_id===selected&&row.profile_id===profileId)){
      await openCapture(selected);return;
    }
    if(selected&&!list(result.captures).some(row=>row.capture_id===selected&&row.profile_id===profileId)){
      opened=null;preview=null;responseId='';delete memory.selections[profileId];save();
    }
    render();
  }
  async function checkResponse(){
    if(!opened||!responseId)throw Error('Choose an actual returned response.');
    const s=scope(),captureId=opened.capture_id,id=responseId,roleValue=role(),token=++previewEpoch;
    const payload={capture_id:captureId,response_id:id};if(roleValue.trim())payload.reviewer_role=roleValue.trim();
    const result=await read('preview',payload,s);
    if(!alive(s)||token!==previewEpoch||opened?.capture_id!==captureId||responseId!==id||role()!==roleValue)return;
    if(result.capture_id!==captureId||result.profile_id!==profileId||result.response_id!==id)throw Error('The returned preview belongs to a different profile capture.');
    preview={...result,_role:roleValue};renderPreview();setMessage();
  }
  async function refreshHost(s){
    await (host.refreshState||host.refresh)?.({force:true});
    return alive(s);
  }
  async function issue(request,s){
    retain(request,{},s);
    const task=await host.api('/api/actions',{method:'POST',body:{workspace:s.workspace,action:request.action,payload:clone(request.payload),operation_id:request.operation_id}});
    if(!task?.id)throw Error('The operator did not return its retained operation. Retry the same request.');
    retain(request,{task_id:task.id,task:taskReceipt(task)},s);
    if(!alive(s))return task;
    renderOperations();
    await refreshHost(s);if(!alive(s))return task;
    await completeOperations();if(!alive(s))return task;
    if(request.handled&&task.state==='complete'&&task.result?.capture_id)
      await openCapture(task.result.capture_id);
    if(!alive(s))return task;
    setMessage(task.state==='complete'?'The customer review operation completed.':'The original operator retained this operation. Its progress appears above.');
    return task;
  }
  async function queue(action,payload){
    const s=scope();assertActive(s);const signature=canonical({action,payload});
    let request=memory.requests.find(row=>row.signature===signature&&row.profile_id===profileId);
    if(!request){request={operation_id:requestId(),action,payload:clone(payload),signature,profile_id:profileId,created_at:new Date().toISOString(),handled:false};memory.requests.push(request);}
    save();return issue(clone(request),s);
  }
  async function completeOperations(){
    if(processing||!root||!root.isConnected)return;
    const s=scope();processing=true;
    try{
      const completed=memory.requests.filter(row=>row.profile_id===profileId&&!row.handled&&findTask(row)?.state==='complete');
      if(!completed.length)return;
      const selectedBefore=opened?.capture_id||null,viewBefore=readEpoch,finished=[];
      for(const request of completed){
        const task=findTask(request);request.task=taskReceipt(task);finished.push({request,task});
      }
      save();renderOperations();
      const result=await read('catalog',{profile_id:s.profileId},s);if(!alive(s))return;
      catalog=result;
      const created=finished.filter(row=>row.request.action==='profile.customer_review.create').at(-1);
      const applied=finished.filter(row=>row.request.action==='profile.customer_review.apply').at(-1);
      if(readEpoch===viewBefore&&(opened?.capture_id||null)===selectedBefore){
        const captureId=created?.task.result?.capture_id||applied?.request.payload.capture_id||selectedBefore;
        if(captureId)await openCapture(captureId);else render();
      }else{
        const node=$('[data-pcr-captures]');if(node)node.innerHTML=capturesHTML();
      }
      for(const {request} of finished)retain(request,{handled:true},s);
      if(applied&&alive(s))await onApplied({workspace_key:s.workspace,profile_id:s.profileId,capture_id:applied.request.payload.capture_id,response_id:applied.request.payload.response_id});
    }finally{if(s.generation===generation)processing=false;}
  }
  async function action(name,target){
    if(name==='refresh'){await refresh();return completeOperations();}
    if(name==='create'){
      if(!$('[data-pcr-create]')?.reportValidity())return;
      const value=draft();
      return queue('profile.customer_review.create',{profile_id:profileId,title:value.title.trim(),purpose:value.purpose.trim(),notes:value.notes.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)});
    }
    if(name==='preview')return checkResponse();
    if(name==='historical'){
      responseId=target.dataset.pcrResponse;preview=null;++previewEpoch;renderDetail();return checkResponse();
    }
    if(name==='apply'){
      if(!preview?.can_apply||preview.already_applied||!preview.response_is_latest||preview.capture_id!==opened?.capture_id||preview.response_id!==responseId||preview._role!==role())
        throw Error('Check the current returned decisions before applying.');
      if(!Object.prototype.hasOwnProperty.call(preview,'current_profile_review_id'))throw Error('Refresh the current scientific review before applying.');
      const payload={capture_id:preview.capture_id,response_id:preview.response_id,expected_profile_review_id:preview.current_profile_review_id};
      if(role().trim())payload.reviewer_role=role().trim();
      return queue('profile.customer_review.apply',payload);
    }
    if(name==='task')return host.showTask?.(target.dataset.pcrTask);
    if(name==='retry-request'){
      const request=memory.requests.find(row=>row.operation_id===target.dataset.pcrOperation&&row.profile_id===profileId);
      if(!request)throw Error('Choose a retained request for this profile.');
      return issue(clone(request),scope());
    }
    if(name==='resume'){
      const s=scope();await host.api('/api/task/resume',{method:'POST',body:{id:target.dataset.pcrTask}});
      if(await refreshHost(s))renderOperations();
    }
  }
  async function clicked(event){
    const target=event.target.closest('[data-pcr-action]');
    if(!target||!root?.contains(target))return;
    event.preventDefault();event.stopPropagation();if(busy)return;
    const s=scope(),intent=++intentEpoch;busy=true;target.disabled=true;
    try{assertActive(s);setMessage();await action(target.dataset.pcrAction,target);}
    catch(e){if(alive(s)&&intent===intentEpoch){loading=false;renderDetail();setMessage(e.message||e,true);}}
    finally{if(alive(s)){busy=false;for(const node of root.querySelectorAll('[data-pcr-action]'))node.disabled=false;renderOperations();}}
  }
  async function changed(event){
    const node=event.target,name=node.dataset.pcrField;if(!name)return;
    const s=scope();
    if(['title','purpose','notes'].includes(name)){draft()[name]=node.value;save();return;}
    if(name==='reviewer_role'){++intentEpoch;if(opened){memory.roles[opened.capture_id]=node.value;save();++previewEpoch;if(preview)preview={...preview,can_apply:false};const apply=$('[data-pcr-apply]');if(apply)apply.remove();}return;}
    if(name==='response'){++intentEpoch;responseId=node.value;preview=null;++previewEpoch;renderPreview();return;}
    if(name==='capture'&&event.type==='change'){
      const intent=++intentEpoch;
      try{
        setMessage();if(node.value)await openCapture(node.value);
        else{++readEpoch;++previewEpoch;opened=null;preview=null;responseId='';loading=false;delete memory.selections[profileId];save();renderDetail();}
      }catch(e){if(alive(s)&&intent===intentEpoch){loading=false;renderDetail();setMessage(e.message||e,true);}}
    }
  }
  async function mount(node,selection){
    detach();root=node;workspace=selection?.workspace_key||current();profileId=selection?.profile_id||null;profileTitle=selection?.title||'';
    if(!root||!workspace||!profileId||current()!==workspace)throw Error('Select a saved profile in the current scientific workspace.');
    memory=stored(workspace);catalog=null;opened=null;preview=null;responseId='';busy=false;loading=false;taskSignature='';message='';error=false;processing=false;
    events=new AbortController();root.addEventListener('click',clicked,{signal:events.signal});root.addEventListener('input',changed,{signal:events.signal});root.addEventListener('change',changed,{signal:events.signal});root.addEventListener('submit',event=>event.preventDefault(),{signal:events.signal});
    render();setMessage('Reading retained customer profile reviews…');const s=scope();
    try{await refresh();if(alive(s)){await completeOperations();if(alive(s))setMessage();}}
    catch(e){if(alive(s)){loading=false;renderDetail();setMessage(e.message||e,true);}}
  }
  function update(snapshot=host.getState()){
    if(!root)return;if(snapshot?.workspace_key!==workspace){detach();return;}
    if(!root.isConnected)return;
    const signature=canonical(allTasks().map(task=>[task.id,task.state]));
    if(signature!==taskSignature){taskSignature=signature;renderOperations();const s=scope();completeOperations().catch(e=>{if(alive(s))setMessage(e.message||e,true);});}
  }
  function detach(){
    if(memory&&workspace)save();++generation;++readEpoch;++previewEpoch;++intentEpoch;events?.abort();events=null;root=null;catalog=null;opened=null;preview=null;processing=false;busy=false;loading=false;
  }
  return {mount,update,detach};
}
