// MIT. Original municipal source editions, service follow-through, reviewed work and complete handover.
(async function serviceFollowThroughApp() {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = value => Array.isArray(value) ? value : [];
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
  const stamp = value => { const d=new Date(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(d) : value ? String(value) : '—'; };
  const short = value => String(value ?? '').slice(0,12);
  const byteLabel = n => n < 1024 ? count(n)+' B' : n < 1048576 ? (n/1024).toFixed(1)+' KiB' : (n/1048576).toFixed(1)+' MiB';
  const words = value => [...new Set(String(value ?? '').split(',').map(s=>s.trim()).filter(Boolean))];
  const human = value => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const pretty = value => JSON.stringify(value,null,2);
  const enumLabel = value => ({new:'New',assigned:'Assigned',in_progress:'In progress',done:'Done',dismissed:'Dismissed',draft:'Draft',approved:'Approved',rejected:'Rejected',review:'Review',contact:'Contact',inspect:'Inspect',create_work_order:'Create work order',update_work_order:'Update work order',reconcile:'Reconcile',none:'No action',needed:'Work order needed',not_needed:'Work order not needed',unknown:'Work requirement unknown'}[value] || String(value ?? '').replace(/_/g,' '));
  const views=new Set(['overview','sources','profiles','requests','changes','work','dispatch','receiving']);
  const state={
    workspace:null,launch:null,view:'overview',busy:false,pending:null,epoch:0,
    sourceId:'',profileKey:'',editionId:'',beforeId:'',workId:'',returnId:'',dispatchId:'',
    source:null,sourceRows:null,profile:null,profileSources:{requests:null,orders:null},edition:null,requests:null,changes:null,work:null,returned:null,dispatch:null,
    query:'',discrepancy:'',assignee:'',workStatus:'',offset:0,limit:100,sourceQuery:'',sourceOffset:0,changesOffset:0,changeEntity:'requests',
    selected:new Set(),selectedWork:new Set(),reviewChoices:new Map(),detail:null,
    draft:{source:{role:'requests'},profile:{},build:{},link:{},work:{},review:{},dispatch:{},receiving:{}}
  };
  let databasePromise,searchTimer,noticeTimer,inspectionSequence=0;
  const fileSequence={source:0,metadata:0,review:0,receiving:0};
  const apiUrl=(path,params={})=>{const url=new URL(path,location.origin);for(const [key,value] of Object.entries(params))if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,String(value));return url.pathname+url.search;};
  async function api(path,input) {
    const mutating=input!==undefined&&path!=='/api/inspect-source';
    let response;
    try {response=await fetch(path,{method:input===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(input===undefined?{}:{'Content-Type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)})});}
    catch(cause){const e=new Error(mutating?'The workspace connection was interrupted. Recover the saved action before repeating it.':'The workspace connection was interrupted. Refresh this view to continue.');e.uncertain=mutating;e.cause=cause;throw e;}
    let result;
    try{result=await response.json();}
    catch{const e=new Error('The workspace response could not be read. Refresh or recover the saved action.');e.uncertain=mutating;throw e;}
    if(!response.ok||result?.ok===false){const e=new Error(result?.error?.message||'The workspace could not complete this action.');e.code=result?.error?.code;e.details=result?.error?.details;e.status=response.status;e.uncertain=mutating&&response.status>=500;throw e;}
    return result&&Object.hasOwn(result,'value')?result.value:result;
  }
  function database(){return databasePromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('open311-service-follow-through',1);r.onupgradeneeded=()=>r.result.createObjectStore('saved');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function savedGet(key){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('saved').objectStore('saved').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function savedPut(key,value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('saved','readwrite'),s=tx.objectStore('saved');value===undefined?s.delete(key):s.put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('The browser save was interrupted.'));});}
  const storageKey=kind=>kind+':directory:'+(state.launch?.directory||state.workspace?.directory||location.origin);
  async function retainDrafts(){try{await savedPut(storageKey('drafts'),state.draft);}catch{/* The open tab retains the draft if browser storage is unavailable. */}}
  function notice(message,persistent=false){clearTimeout(noticeTimer);$('#notice').textContent=message;$('#notice').hidden=false;if(!persistent)noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},9000);}
  function showError(error){$('#error-title').textContent=error.code==='REVISION_CONFLICT'?'The workspace has a newer edition':'The action needs attention';$('#error-message').textContent=error.message+(error.details?'\n'+pretty(error.details):'');$('#error').hidden=false;if($('#detail-dialog').open){let box=$('#detail-error');if(!box){box=document.createElement('div');box.id='detail-error';box.className='error';box.setAttribute('role','alert');$('#detail-content').prepend(box);}box.textContent=$('#error-message').textContent;box.scrollIntoView({block:'nearest'});}else $('#error').scrollIntoView({block:'nearest'});}
  function clearError(){$('#error').hidden=true;$('#detail-error')?.remove();}
  const profileKey=p=>p?.key||(p?.id?String(p.id)+'@'+String(p.revision||1):'');
  const latest=items=>list(items).slice().sort((a,b)=>String(b.createdAt||b.updatedAt||b.observedAt||'').localeCompare(String(a.createdAt||a.updatedAt||a.observedAt||'')));
  function chooseDefaults(){
    const w=state.workspace;
    if(!list(w.sources).some(x=>x.id===state.sourceId))state.sourceId=latest(w.sources)[0]?.id||'';
    if(!list(w.profiles).some(x=>profileKey(x)===state.profileKey))state.profileKey=profileKey(latest(w.profiles)[0]);
    if(!list(w.editions).some(x=>x.id===state.editionId)){state.editionId=latest(w.editions)[0]?.id||'';state.offset=0;state.selected.clear();state.selectedWork.clear();}
    if(!list(w.editions).some(x=>x.id===state.beforeId))state.beforeId=latest(w.editions).find(x=>x.id!==state.editionId)?.id||'';
    if(!list(w.work).some(x=>x.id===state.workId))state.workId=latest(w.work)[0]?.id||'';
    if(!list(w.returns).some(x=>x.id===state.returnId))state.returnId=latest(w.returns)[0]?.id||'';
    if(!list(w.dispatches).some(x=>x.id===state.dispatchId))state.dispatchId=latest(w.dispatches)[0]?.id||'';
  }
  async function refreshWorkspace(){
    state.workspace=await api('/api/state');
    if(state.launch&&state.launch.workspaceId!==state.workspace.workspaceId)state.launch=await api('/api/launch');
    chooseDefaults();$('#workspace-name').textContent=state.workspace.name||'Service follow-through '+short(state.workspace.workspaceId);
    $('#workspace-revision').textContent='Edition '+count(state.workspace.revision)+' · Updated '+stamp(state.workspace.updatedAt||state.workspace.createdAt);
  }
  async function refreshDetail(){
    const epoch=++state.epoch,view=state.view,sourceId=state.sourceId,editionId=state.editionId,key=state.profileKey;
    $('#main').setAttribute('aria-busy','true');
    try{
      if(view==='sources'&&sourceId){
        const [source,rows]=await Promise.all([api(apiUrl('/api/source',{id:sourceId})),api(apiUrl('/api/source-rows',{id:sourceId,q:state.sourceQuery,offset:state.sourceOffset,limit:state.limit}))]);
        if(epoch===state.epoch&&sourceId===state.sourceId){state.source=source;state.sourceRows=rows;}
      }else if(view==='profiles'){
        if(key){const result=await api(apiUrl('/api/profile',{id:key}));if(epoch===state.epoch&&key===state.profileKey)state.profile=result;}
        const requestSource=state.draft.profile.requestSourceId||latest(state.workspace.sources).find(x=>x.role==='requests')?.id;
        const orderSource=state.draft.profile.orderSourceId||latest(state.workspace.sources).find(x=>x.role==='orders')?.id;
        const pair=await Promise.all([requestSource?api(apiUrl('/api/source',{id:requestSource})):null,orderSource?api(apiUrl('/api/source',{id:orderSource})):null]);
        if(epoch===state.epoch){state.profileSources={requests:pair[0],orders:pair[1]};}
      }else if((view==='requests'||view==='dispatch')&&editionId){
        const [edition,rows]=await Promise.all([api(apiUrl('/api/edition',{id:editionId})),api(apiUrl('/api/requests',{editionId,q:state.query,discrepancy:state.discrepancy,assignee:state.assignee,workStatus:state.workStatus,offset:state.offset,limit:state.limit}))]);
        if(epoch===state.epoch&&editionId===state.editionId){state.edition=edition;state.requests=rows;}
        if(view==='dispatch'){const queue=await api(apiUrl('/api/work-queue',{editionId,approval:'approved',offset:state.approvedOffset||0,limit:state.limit}));if(epoch===state.epoch&&editionId===state.editionId)state.approvedWorkPage=queue;}
        if(view==='dispatch'&&state.dispatchId){const id=state.dispatchId,result=await api(apiUrl('/api/dispatch',{id}));if(epoch===state.epoch&&id===state.dispatchId)state.dispatch=result;}
      }else if(view==='changes'&&editionId&&state.beforeId){
        const before=state.beforeId,result=await api(apiUrl('/api/changes',{before,after:editionId,entity:state.changeEntity,offset:state.changesOffset,limit:state.limit}));if(epoch===state.epoch&&before===state.beforeId&&editionId===state.editionId)state.changes=result;
      }else if(view==='work'){
        if(state.workId){const id=state.workId,result=await api(apiUrl('/api/work',{id}));if(epoch===state.epoch&&id===state.workId)state.work=result;}
        if(state.returnId){const id=state.returnId,result=await api(apiUrl('/api/return',{id,targetEditionId:reviewTargetId()}));if(epoch===state.epoch&&id===state.returnId){state.returned=result;restoreReviewChoices();}}
      }
    }finally{if(epoch===state.epoch)$('#main').setAttribute('aria-busy','false');}
  }
  async function navigate(view,focus=true){state.view=views.has(view)?view:'overview';clearError();$$('.sidebar [data-view]').forEach(a=>a.dataset.view===state.view?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));render();await refreshDetail();render();if(focus)$('#main').focus({preventScroll:true});}
  async function clearPending(){state.pending=null;try{await savedPut(storageKey('pending'),undefined);}catch{/* The server retains the original action. */}}
  async function acceptResult(result,label){
    result=result||{};
    if(result.source)state.sourceId=result.source.id;
    if(result.profile)state.profileKey=profileKey(result.profile);
    if(result.edition){state.editionId=result.edition.id;state.offset=0;state.selected.clear();state.selectedWork.clear();}
    if(result.work&&!Array.isArray(result.work))state.workId=result.work.id;
    if(result.returned||result.return){state.returnId=(result.returned||result.return).id;state.reviewChoices.clear();}
    if(result.dispatch)state.dispatchId=result.dispatch.id;
    await clearPending();await refreshWorkspace();await refreshDetail();render();notice(label||'The saved workspace is updated.');
  }
  async function mutate(path,input,label){
    if(state.busy)return;
    if(state.pending)throw new Error('Recover the earlier saved action before starting another workspace action.');
    state.busy=true;
    const original={path,input:{...input,requestId:crypto.randomUUID(),expectedRevision:state.workspace.revision},label,createdAt:new Date().toISOString()};
    state.pending=original;
    try{await savedPut(storageKey('pending'),original);}catch{notice('Browser storage is unavailable. Keep this tab open until the save returns.',true);}
    render();
    try{const result=await api(path,original.input);await acceptResult(result,label);return result;}
    catch(error){if(!error.uncertain){await clearPending();await refreshWorkspace().catch(()=>{});}showError(error);throw error;}
    finally{state.busy=false;render();}
  }
  async function recoverPending(replay=false){
    if(!state.pending||state.busy)return;
    state.busy=true;clearError();render();
    try{
      const original=state.pending,operation=await api(apiUrl('/api/operation',{requestId:original.input.requestId}));
      if(operation?.state==='SUCCEEDED')await acceptResult(operation.result,original.label||'The saved action is recovered.');
      else if(operation)notice('The original action is '+enumLabel(operation.state)+'. Its saved input remains selected.',true);
      else if(replay)await acceptResult(await api(original.path,original.input),original.label||'The original action is saved.');
      else notice('No saved result has returned for this action. Resume saved action will send its original input once more.',true);
    }catch(error){if(!error.uncertain&&error.status&&error.status<500){await clearPending();await refreshWorkspace().catch(()=>{});}showError(error);}
    finally{state.busy=false;render();}
  }
  const options=(items,selected,title=x=>x.name||x.id,blank='')=>(blank?'<option value="">'+esc(blank)+'</option>':'')+list(items).map(x=>'<option value="'+esc(x.id)+'"'+(String(x.id)===String(selected)?' selected':'')+'>'+esc(title(x))+'</option>').join('');
  const enums=(values,selected,blank='')=>options(values.map(id=>({id,name:enumLabel(id)})),selected,x=>x.name,blank);
  const badge=(text,kind='')=>'<span class="badge '+esc(kind)+'">'+esc(text)+'</span>';
  const button=(action,text,data='',primary=false)=>'<button type="button" data-action="'+esc(action)+'" '+data+' class="'+(primary?'primary':'')+'">'+esc(text)+'</button>';
  const empty=(title,text,action='')=>'<div class="empty"><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p>'+action+'</div>';
  const header=(title,text,actions='')=>'<div class="page-heading"><div><h1>'+esc(title)+'</h1><p>'+esc(text)+'</p></div>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div>';
  const metric=(n,text)=>'<div class="metric"><strong>'+count(n)+'</strong><span>'+esc(text)+'</span></div>';
  const viewLink=(view,text)=>'<a href="#'+esc(view)+'">'+esc(text)+'</a>';
  const details=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
  function pendingBanner(){if(!state.pending)return '';return '<div class="pending-status" role="status"><strong>'+(state.busy?'Saving the workspace action…':'A saved action is awaiting its result')+'</strong><p>'+esc(state.pending.label||'Workspace change')+' · '+esc(stamp(state.pending.createdAt))+'</p><div class="actions">'+button('recover','Recover saved action')+button('replay','Resume saved action')+'</div><details><summary>Original request</summary><code>'+esc(state.pending.input.requestId)+'</code></details></div>';}
  function pager(result,prefix='request'){
    const total=Number(result?.total||0),offset=Number(result?.offset||0),limit=Number(result?.limit||state.limit),length=list(result?.items).length;
    return '<div class="table-footer"><span>'+(total?count(offset+1)+'–'+count(offset+length)+' of '+count(total):'No matching records')+'</span><div class="actions"><button type="button" data-action="'+prefix+'-previous"'+(offset===0?' disabled':'')+'>Previous</button><button type="button" data-action="'+prefix+'-next"'+(offset+length>=total?' disabled':'')+'>Next</button></div></div>';
  }
  function editionSelector(id='edition-selection',selected=state.editionId,blank='Choose a saved edition'){return '<label>Source edition<select id="'+esc(id)+'">'+options(latest(state.workspace?.editions),selected,x=>(x.name||short(x.id))+' · '+count(x.rows)+' requests',blank)+'</select></label>';}
  function sourceSummary(id){return list(state.workspace?.sources).find(x=>x.id===id);}
  function selectedEdition(){return list(state.workspace?.editions).find(x=>x.id===state.editionId);}
  const fieldName=f=>typeof f==='string'?f:f?.name||f?.field||f?.id||'';
  const sourceFields=s=>list(s?.fields||s?.source?.fields||s?.metadata?.fields).filter(f=>fieldName(f));
  function fieldOptions(fields,value,blank='Not mapped'){const items=fields.map(f=>({id:fieldName(f),name:fieldName(f)+(typeof f==='object'&&f.alias&&f.alias!==f.name?' — '+f.alias:'')}));if(value&&!items.some(f=>f.id===value))items.push({id:value,name:value+' — saved mapping'});return options(items,value,x=>x.name,blank);}
  const draftInput=(kind,name,label,type='text',fallback='',extra='')=>'<label>'+esc(label)+'<input type="'+esc(type)+'" name="'+esc(name)+'" data-draft="'+esc(kind)+'" value="'+esc(state.draft[kind]?.[name]??fallback)+'" '+extra+'></label>';
  function parseJson(value,label,expected='object'){let parsed;try{parsed=JSON.parse(value);}catch{throw new Error(label+' must contain complete JSON.');}if(expected==='array'&&!Array.isArray(parsed))throw new Error(label+' must be a JSON array.');if(expected==='object'&&(!parsed||typeof parsed!=='object'||Array.isArray(parsed)))throw new Error(label+' must be a JSON object.');return parsed;}
  function toIso(value,label){if(!value)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error(label+' must be a valid date and time.');return d.toISOString();}
  function localInput(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);}
  async function download(kind,selection={}){
    clearError();const response=await fetch(apiUrl('/api/export',{kind,...selection,expectedRevision:state.workspace.revision}),{credentials:'same-origin',cache:'no-store'});
    if(!response.ok){const result=await response.json().catch(()=>({}));const e=new Error(result.error?.message||'The selected file could not be exported.');e.code=result.error?.code;e.details=result.error?.details;throw e;}
    const blob=await response.blob(),raw=response.headers.get('content-disposition')||'',filename=(raw.match(/filename="([^"]+)"/)?.[1]||'service-follow-through-'+kind+'.'+(kind.endsWith('csv')?'csv':kind==='report'?'html':kind.endsWith('geojson')?'geojson':'json')).replace(/[\\/\u0000-\u001f]/g,'_');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('Downloaded '+filename+' · '+byteLabel(blob.size));
  }
  function exportButtons(kinds,selection={}){
    const attrs=Object.entries(selection).map(([k,v])=>'data-'+k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+esc(v)+'"').join(' ');
    const labels={source:'Original file',edition:'Complete source edition','requests-csv':'Request CSV',review:'Editable review','dispatch-json':'Dispatch JSON','dispatch-csv':'Dispatch CSV','dispatch-geojson':'Dispatch GeoJSON',report:'Operating report',workspace:'Complete workspace'};
    return kinds.map(kind=>button('export',labels[kind]||kind,'data-kind="'+esc(kind)+'" '+attrs)).join('');
  }
  function restoreReviewChoices(){
    const retained=state.draft.review.choices;
    if(!state.reviewChoices.size&&retained?.returnId===state.returnId)state.reviewChoices=new Map(Object.entries(retained.values||{}));
    const valid=new Set(reviewable().map(p=>p.id));for(const [id,choice] of state.reviewChoices)if(!valid.has(id)||!['pending','accept','reject'].includes(choice))state.reviewChoices.delete(id);
  }
  function reviewable(){return list(state.returned?.proposals).filter(p=>!p.status||p.status==='pending'||p.status==='proposed');}
  async function retainReviewChoices(){state.draft.review.choices={returnId:state.returnId,values:Object.fromEntries(state.reviewChoices)};await retainDrafts();}

  function reviewTargetId(){
    const returned=list(state.workspace?.returns).find(r=>r.id===state.returnId),seriesId=returned?.seriesId;
    const allowed=latest(state.workspace?.editions).filter(e=>!seriesId||e.seriesId===seriesId);
    const preferred=state.draft.review.targetEditionId||state.editionId;
    return allowed.find(e=>e.id===preferred)?.id||allowed[0]?.id||returned?.baseEditionId||'';
  }
  function reviewTargetSelector(){
    const returned=list(state.workspace?.returns).find(r=>r.id===state.returnId),editions=latest(state.workspace?.editions).filter(e=>!returned?.seriesId||e.seriesId===returned.seriesId);
    return '<label>Review target edition<select id="review-target-edition">'+options(editions,reviewTargetId(),e=>(e.name||short(e.id))+' · '+count(e.rows)+' requests','Choose target edition')+'</select></label>';
  }


  function renderOverview(){
    const w=state.workspace,editions=latest(w.editions),current=selectedEdition(),work=list(w.work),active=work.filter(x=>!['done','dismissed'].includes(x.status));
    return header('Service follow-through','Follow an original service request through related work, assign the next action and hand over the reviewed result.')+
      '<div class="metrics">'+metric(list(w.sources).length,'Original source editions')+metric(current?.rows||0,'Requests in selected edition')+metric(active.length,'Open assigned work')+metric(list(w.dispatches).length,'Saved dispatch packages')+'</div>'+
      '<div class="steps"><section class="step"><h3>1 / Receive original sources</h3><p>Keep the full request and work-order files, field declarations and source selection together.</p>'+viewLink('sources','Open original sources')+'</section><section class="step"><h3>2 / Follow the work</h3><p>Select the field and relationship meanings, then save a source edition and assign the next actions.</p>'+viewLink('requests','Open service follow-through')+'</section><section class="step"><h3>3 / Review and deliver</h3><p>Apply reviewed changes, choose approved work and export a complete editable handover.</p>'+viewLink('dispatch','Open reviewed dispatch')+'</section></div>'+
      '<div class="split"><section class="panel"><h2>Saved source editions</h2>'+(editions.length?'<div class="record-list">'+editions.map(e=>'<article class="record-card"><header><div><h3>'+esc(e.name||short(e.id))+'</h3><p>'+count(e.rows)+' requests · As of '+esc(stamp(e.asOf))+'</p></div>'+badge(e.id===state.editionId?'Selected':'Saved')+'</header><p>'+esc(sourceSummary(e.requestSourceId)?.name||short(e.requestSourceId))+' → '+esc(sourceSummary(e.orderSourceId)?.name||short(e.orderSourceId))+'</p><div class="actions">'+button('open-edition','Open follow-through','data-id="'+esc(e.id)+'"')+exportButtons(['edition','review'],{editionId:e.id})+'</div></article>').join('')+'</div>':empty('Build the first source edition','Import an original request source and save its field mapping to open the operating view.',viewLink('sources','Import original sources')))+'</section>'+
      '<aside class="panel"><h2>Work ready for review</h2>'+(work.length?'<div class="record-list">'+latest(active).slice(0,8).map(item=>'<article class="record-card"><h3>'+esc(item.serviceRequestId||item.key||short(item.id))+'</h3><p>'+esc(enumLabel(item.action))+' · '+esc(item.assignee||'Unassigned')+'</p><div class="badges">'+badge(enumLabel(item.status))+badge(enumLabel(item.approval),item.approval==='approved'?'strong':'')+'</div><div class="actions">'+button('open-work','Open saved work','data-id="'+esc(item.id)+'"')+'</div></article>').join('')+'</div>':empty('No work assigned yet','Open a request to save an owner, due time and next action.'))+'<p class="section-note">Review approval is saved separately from whether the work is complete.</p></aside></div>'+
      '<section class="panel"><h2>Recent workspace actions</h2>'+renderOperations()+'</section>';
  }
  function renderOperations(){
    const entries=latest(state.workspace.operations).slice(0,12);
    if(!entries.length)return '<p class="muted">Your saved workspace actions will appear here.</p>';
    return '<div class="table-scroll"><table><thead><tr><th>Action</th><th>Saved</th><th>Result</th><th></th></tr></thead><tbody>'+entries.map(x=>'<tr><td>'+esc(enumLabel(x.kind))+'</td><td>'+esc(stamp(x.createdAt))+'</td><td>'+esc(enumLabel(x.state))+'</td><td>'+button('operation-detail','Details','data-request-id="'+esc(x.requestId)+'"')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function sourceAttributes(row){const r=row?.original||row?.source||row;return r?.attributes||r?.properties||r||{};}
  function originalTable(rows,fields){
    const items=list(rows?.items),names=fields.length?fields.map(fieldName).slice(0,8):Object.keys(sourceAttributes(items[0])||{}).slice(0,8);
    if(!items.length)return empty('No original records in this selection','The complete retained file and its source selection remain available.');
    return '<div class="table-scroll"><table><thead><tr>'+names.map(n=>'<th>'+esc(n)+'</th>').join('')+'<th>Original fields</th></tr></thead><tbody>'+items.map((row,index)=>{const values=sourceAttributes(row);return '<tr>'+names.map(n=>'<td>'+esc(human(values[n]))+'</td>').join('')+'<td>'+button('original-detail','Open','data-index="'+index+'"')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  function renderSources(){
    const d=state.draft.source,inspection=d.inspection,s=state.source,meta=s?.summary||s?.source||s,fields=sourceFields(s);
    return header('Original sources','Receive the complete service-request and work-order files. Source selection, original field names and file contents stay attached to every saved edition.')+
      '<div class="split"><section class="panel"><h2>Receive a source edition</h2><form id="source-form"><div class="form-stack">'+
      '<label>Source role<select name="role" data-draft="source">'+options([{id:'requests',name:'Service requests'},{id:'orders',name:'Work orders'}],d.role||'requests',x=>x.name)+'</select></label>'+
      '<label>Original source file<input id="source-file" type="file" accept=".json,.geojson,.csv,application/json,text/csv"><small>Use a complete original ArcGIS response, source package or supported export.</small></label>'+
      (d.filename?'<div class="file-selected">'+esc(d.filename)+' · '+byteLabel(d.bytes||0)+'</div>':'')+
      '<label>Original layer metadata (optional)<input id="metadata-file" type="file" accept=".json,application/json"><small>Keep the source field types and coordinate declaration with the data file.</small></label>'+
      (d.metadataFilename?'<div class="file-selected">'+esc(d.metadataFilename)+'</div>':'')+
      '<div class="form-grid">'+draftInput('source','name','Source name','text',d.filename||'','required')+draftInput('source','seriesId','Source series','text','','placeholder="manatee-service-requests" required')+draftInput('source','observedAt','Source observed at','datetime-local',localInput(new Date().toISOString()),'required')+draftInput('source','sourceUrl','Original source URL','url','','placeholder="https://…"')+'</div>'+
      '<details><summary>Import format</summary><label>Source format<select name="kind" data-draft="source">'+options([{id:'',name:'Recognize the original file'},{id:'arcgis',name:'ArcGIS feature response'},{id:'geojson',name:'GeoJSON'},{id:'csv',name:'CSV'},{id:'json',name:'JSON records'}],d.kind||'',x=>x.name)+'</select></label></details>'+
      '<div class="form-actions"><button class="primary" type="submit"'+(!inspection||inspection.state==='selection_required'?' disabled':'')+'>Save original source</button>'+button('inspect-source','Inspect selected file')+'</div></div></form></section>'+
      '<aside class="panel"><h2>Selected file</h2>'+(inspection?sourceInspectionStatus(inspection)+'<dl class="detail-grid"><dt>Format</dt><dd>'+esc(inspection.kind||'Original source')+'</dd><dt>Records</dt><dd>'+count(inspection.rows??inspection.rowCount??inspection.summary?.rows)+'</dd><dt>Source role</dt><dd>'+esc(d.role==='orders'?'Work orders':'Service requests')+'</dd><dt>Original size</dt><dd>'+byteLabel(d.bytes||inspection.bytes||0)+'</dd></dl>'+
      '<h3>Original fields</h3><div class="source-fields">'+sourceFields(inspection).map(f=>'<div><strong>'+esc(fieldName(f))+'</strong><span>'+esc(typeof f==='object'?(f.alias||'')+' · '+(f.type||''):'')+'</span></div>').join('')+'</div>'+sourceCaptureChoices(inspection)+details('Full source declaration and coverage',inspection):empty('Choose an original file','The source structure and field declarations will appear before you save.'))+'</aside></div>'+
      '<section class="panel flat"><div class="panel-header"><h2>Retained source editions</h2><label><span class="visually-hidden">Selected retained source</span><select id="source-selection">'+options(latest(state.workspace.sources),state.sourceId,x=>(x.name||short(x.id))+' · '+(x.role==='orders'?'Work orders':'Requests'),'Choose a source')+'</select></label></div>'+
      (s?'<div class="panel-padding">'+sourceInspectionStatus(meta)+'<dl class="detail-grid"><dt>Name</dt><dd>'+esc(meta.name||sourceSummary(state.sourceId)?.name)+'</dd><dt>Source series</dt><dd>'+esc(meta.seriesId||sourceSummary(state.sourceId)?.seriesId)+'</dd><dt>Observed at</dt><dd>'+esc(stamp(meta.observedAt||sourceSummary(state.sourceId)?.observedAt))+'</dd><dt>Records</dt><dd>'+count(meta.rows??sourceSummary(state.sourceId)?.rows)+'</dd></dl><div class="actions">'+exportButtons(['source'],{sourceId:state.sourceId})+button('source-profile','Use these source fields','data-id="'+esc(state.sourceId)+'"')+'</div>'+details('Source metadata, original file identity and coverage',s)+'</div><div class="panel-inline-padding"><label>Search original values<input id="source-query" value="'+esc(state.sourceQuery)+'" type="search" placeholder="Identifier, description or original value"></label></div>'+originalTable(state.sourceRows,fields)+pager(state.sourceRows,'source'):empty('No retained source selected','Saved original sources can be reopened and exported in full.'))+'</section>';
  }
  function blankProfile(){
    const req=sourceFields(state.profileSources.requests),ord=sourceFields(state.profileSources.orders),has=(fields,name)=>fields.some(x=>fieldName(x)===name),date=(fields,name)=>has(fields,name)?{field:name,format:(fields.find(x=>fieldName(x)===name)?.type==='esriFieldTypeDate'?'epoch-ms':'literal')}:undefined;
    const request={idFields:has(req,'QSCEND_ID')?['QSCEND_ID']:[],titleField:null,descriptionField:null,statusField:null,referenceFields:has(req,'CW_REQUEST')?['CW_REQUEST']:[],workNeeded:{field:has(req,'WONEEDED')?'WONEEDED':null,neededValues:[],notNeededValues:[]},dates:{},coordinates:{mode:'source',name:'',sourceReferences:[]}};
    const order={idFields:has(ord,'WORKORDERID')?['WORKORDERID']:[],titleField:null,descriptionField:null,statusField:null,referenceFields:[],dates:{},costs:[],coordinates:{mode:'source',name:'',sourceReferences:[]}};
    for(const [logical,name] of [['createdAt','DATETIMEINIT'],['closedAt','DATETIMECLOSED']]){const value=date(req,name);if(value)request.dates[logical]=value;}
    return {id:'municipal-follow-through',name:'Municipal service and work orders',revision:1,request,order,joins:[],statuses:{requestClosed:[],requestActive:[],orderClosed:[],orderActive:[]},rules:{requireOrderWhenNeeded:true,flagMultipleCandidates:true,flagRequestClosedOrderActive:true,flagOrderClosedRequestActive:true,staleAfterDays:null},notes:''};
  }
  function editorProfile(){
    if(state.draft.profile.value)return state.draft.profile.value;
    const p=state.profile?.profile||state.profile;
    return p?.request&&p?.order?JSON.parse(JSON.stringify(p)):blankProfile();
  }
  function mappingGroup(role,p,fields){
    const isRequest=role==='request',map=p[role]||{},names=fields.map(fieldName),prefix=role+'_';
    const select=(name,label)=>'<label>'+esc(label)+'<select name="'+prefix+name+'">'+fieldOptions(fields,map[name])+'</select></label>';
    let html='<fieldset><legend>'+(isRequest?'Service-request fields':'Work-order fields')+'</legend><div class="form-grid">'+
      '<label class="full">Identity fields<input name="'+prefix+'idFields" value="'+esc(list(map.idFields).join(', '))+'" list="'+role+'-field-list"'+(isRequest||fields.length?' required':'')+'><small>Use original field names; separate composite identity fields with commas.</small></label>'+
      '<datalist id="'+role+'-field-list">'+names.map(n=>'<option value="'+esc(n)+'">').join('')+'</datalist>'+select('titleField','Title')+select('descriptionField','Description')+select('statusField','Literal status')+
      '<label>Other reference fields<input name="'+prefix+'referenceFields" value="'+esc(list(map.referenceFields).join(', '))+'" list="'+role+'-field-list"><small>Preserve other identifiers as references.</small></label>';
    if(isRequest)html+='<label>Work-order requirement field<select name="request_workNeededField">'+fieldOptions(fields,map.workNeeded?.field)+'</select></label>'+
      '<label>Values meaning work needed<textarea name="request_neededValues" rows="2">'+esc(pretty(map.workNeeded?.neededValues||[]))+'</textarea><small>Original typed values, for example ["Y"] or [1].</small></label>'+
      '<label>Values meaning no work needed<textarea name="request_notNeededValues" rows="2">'+esc(pretty(map.workNeeded?.notNeededValues||[]))+'</textarea><small>All other source values remain unknown.</small></label>';
    for(const [logical,label] of [['createdAt','Created'],['updatedAt','Updated'],['closedAt','Closed']]){
      const date=map.dates?.[logical]||{};
      html+='<label>'+label+' field<select name="'+prefix+logical+'Field">'+fieldOptions(fields,date.field)+'</select></label><label>'+label+' date meaning<select name="'+prefix+logical+'Format">'+options([{id:'literal',name:'Literal source value'},{id:'epoch-ms',name:'UTC milliseconds since 1970'},{id:'iso-offset',name:'ISO date/time with offset'}],date.format||'literal',x=>x.name)+'</select></label>';
    }
    html+='<label>Source coordinates<select name="'+prefix+'coordinateMode">'+options([{id:'source',name:'Use the source declaration'},{id:'wgs84',name:'Interpret as longitude / latitude'},{id:'web-mercator',name:'Interpret as Web Mercator metres'}],map.coordinates?.mode||'source',x=>x.name)+'</select></label>'+
      '<label>Interpretation name<input name="'+prefix+'coordinateName" value="'+esc(map.coordinates?.name||'')+'"><small>A selected interpretation applies to this entire source role.</small></label>'+
      '<label class="full">Coordinate source references<textarea name="'+prefix+'coordinateReferences" rows="2">'+esc(pretty(map.coordinates?.sourceReferences||[]))+'</textarea><small>Complete reference strings in a JSON array. Per-request choices are available in the work editor.</small></label>';
    if(!isRequest)html+='<label class="full">Cost fields and declared units<textarea name="order_costs" rows="3">'+esc(pretty(map.costs||[]))+'</textarea><small>Optional objects with field, label and unit; preserve a null unit when the source does not declare one.</small></label>';
    return html+'</div></fieldset>';
  }
  function renderProfiles(){
    const p=editorProfile(),d=state.draft.profile,requestSources=latest(state.workspace.sources).filter(s=>s.role==='requests'),orderSources=latest(state.workspace.sources).filter(s=>s.role==='orders'),reqId=d.requestSourceId||requestSources[0]?.id||'',ordId=d.orderSourceId||orderSources[0]?.id||'';
    const profiles=latest(state.workspace.profiles).map(x=>({...x,id:profileKey(x)}));
    return header('Field and link mappings','Name what the original fields mean. Each saved mapping edition remains attached to the source editions built from it.')+
      '<section class="panel"><div class="filters"><label class="grow">Saved mapping<select id="profile-selection">'+options(profiles,state.profileKey,x=>(x.name||x.id)+' · Revision '+count(x.revision),'Create a new mapping')+'</select></label>'+button('new-profile','New mapping')+button('edit-profile','Edit next mapping revision')+'</div>'+
      '<div class="form-grid"><label>Request fields from<select id="profile-request-source">'+options(requestSources,reqId,x=>x.name||x.id,'Choose request source')+'</select></label><label>Work-order fields from<select id="profile-order-source">'+options(orderSources,ordId,x=>x.name||x.id,'Choose work-order source')+'</select></label></div><p class="section-note">These source choices provide the field lists. The operating edition separately records the exact data files it uses.</p></section>'+
      '<section class="panel"><h2>'+esc(p.name||'New field mapping')+'</h2><form id="profile-form"><div class="form-stack"><div class="form-grid">'+
      '<label>Mapping name<input name="name" value="'+esc(p.name||'')+'" required></label><label>Mapping identity<input name="id" value="'+esc(p.id||'')+'" required></label>'+
      '<label>Revision<input name="revision" type="number" min="1" step="1" value="'+esc(p.revision||1)+'" required></label><label>Editor<select name="editorMode" id="profile-editor-mode">'+options([{id:'basic',name:'Named field editor'},{id:'json',name:'Complete JSON mapping'}],d.editorMode||'basic',x=>x.name)+'</select></label></div>'+
      '<div id="profile-basic"'+(d.editorMode==='json'?' hidden':'')+' class="form-stack">'+mappingGroup('request',p,sourceFields(state.profileSources.requests))+mappingGroup('order',p,sourceFields(state.profileSources.orders))+
      '<fieldset><legend>Literal status meanings</legend><div class="form-grid">'+[['requestClosed','Closed request values'],['requestActive','Active request values'],['orderClosed','Closed work-order values'],['orderActive','Active work-order values']].map(([name,label])=>'<label>'+label+'<textarea name="status_'+name+'" rows="2">'+esc(pretty(p.statuses?.[name]||[]))+'</textarea><small>JSON array of exact original values, including their types.</small></label>').join('')+'</div></fieldset>'+
      '<fieldset><legend>Relationship rules</legend><p class="section-note">An original reference is kept separately from a work-order identity. Add a field relationship only when the chosen two fields have the intended common meaning.</p><label>Explicit field joins<textarea name="joins" class="code-input" rows="6">'+esc(pretty(p.joins||[]))+'</textarea><small>Each entry names id, name, requestField, orderField and normalization (exact, trim-text or fold-text). Empty keeps relationships for individual review.</small></label></fieldset>'+
      '<fieldset><legend>Follow-through rules</legend><div class="form-grid">'+[['requireOrderWhenNeeded','Flag work needed without a linked order'],['flagMultipleCandidates','Flag multiple candidate orders'],['flagRequestClosedOrderActive','Flag a closed request with active work'],['flagOrderClosedRequestActive','Flag an active request with closed work']].map(([name,label])=>'<label class="check-label"><input name="rule_'+name+'" type="checkbox"'+(p.rules?.[name]!==false?' checked':'')+'>'+label+'</label>').join('')+
      '<label>Stale after days<input name="staleAfterDays" type="number" min="0" step="any" value="'+esc(p.rules?.staleAfterDays??'')+'"><small>Leave empty when no age threshold has been selected.</small></label></div></fieldset>'+
      '<label>Mapping notes<textarea name="notes">'+esc(p.notes||'')+'</textarea></label></div>'+
      '<div id="profile-json-panel"'+(d.editorMode==='json'?'':' hidden')+'><label>Complete mapping<textarea id="profile-json" name="profileJson" class="code-input" rows="20">'+esc(d.profileJson||pretty(p))+'</textarea></label><p class="section-note">This editor preserves the whole typed mapping and any additional supported settings.</p></div>'+
      '<div class="form-actions"><button type="submit" class="primary">Save mapping edition</button>'+button('reset-profile-draft','Load saved mapping')+'</div></div></form></section>';
  }

  function sourceInspectionStatus(value){
    if(value?.state==='selection_required')return '<div class="callout"><strong>Choose the original dataset captures</strong><p>This package contains several source responses. Select the exact data pages to use below.</p></div>';
    if(value?.state==='source_error'||value?.error)return '<div class="callout"><strong>Original source error response</strong><p>'+esc(value.error?.message||'The source returned an error for this request.')+'</p><p>The complete original response can be retained with its source selection. Choose a successful source edition when building the operating desk.</p></div>';
    return value?.state==='ready'?'<p>'+badge('Source file ready')+'</p>':'';
  }
  function sourceCaptureChoices(inspection){
    const captures=list(inspection.availableCaptures);if(captures.length<2)return '';
    const explicit=Array.isArray(state.draft.source.captureIds),selected=new Set(state.draft.source.captureIds||[]),chosen=new Set(list(inspection.captureIds||inspection.selectedCaptureIds||inspection.coverage?.selectedCaptures));
    return '<fieldset><legend>Original captures in this source package</legend><p class="section-note">Choose the exact feature response or retained error response to use. Every original capture remains attached to the imported package.</p>'+captures.map(c=>'<label class="check-label"><input type="checkbox" data-capture="'+esc(c.id)+'"'+(selected.has(c.id)||(!explicit&&(chosen.has(c.id)||c.selected))?' checked':'')+'>'+esc(c.name||c.id)+' · '+esc(c.state==='source_error'?'Source error':count(c.rows)+' records')+'</label>').join('')+'</fieldset>';
  }
  function captureEndpoint(capture){
    try{const url=new URL(capture?.sourceUrl),match=url.pathname.match(/^(.*\/(?:MapServer|FeatureServer)\/\d+)(?:\/.*)?$/i);return match?url.origin+match[1]:null;}catch{return null;}
  }


  function cleanSourceChoices(role){return latest(state.workspace.sources).filter(s=>s.role===role);}
  function buildForm(){
    const d=state.draft.build,requests=cleanSourceChoices('requests'),orders=cleanSourceChoices('orders'),profiles=latest(state.workspace.profiles).map(p=>({...p,id:profileKey(p)}));
    return '<details class="panel"'+(!state.editionId?' open':'')+'><summary>Save an operating source edition</summary><p class="section-note">Pair exact original files with a saved mapping. A request-only edition can begin the desk while work-order files are being prepared.</p>'+
      '<form id="build-form"><div class="form-grid">'+draftInput('build','name','Edition name','text','','required placeholder="Manatee service follow-through"')+draftInput('build','seriesId','Operating series','text','','required placeholder="manatee-municipal-operations"')+
      '<label>Request source<select name="requestSourceId" data-draft="build" required>'+options(requests,d.requestSourceId||requests[0]?.id,x=>(x.name||x.id)+' · '+count(x.rows)+' records'+(x.state==='source_error'?' · Source error':''),'Choose request source')+'</select></label>'+
      '<label>Work-order source<select name="orderSourceId" data-draft="build">'+options(orders,d.orderSourceId??'',x=>(x.name||x.id)+' · '+count(x.rows)+' records'+(x.state==='source_error'?' · Source error':''),'No work-order source selected')+'</select></label>'+
      '<label>Saved field mapping<select name="profileId" data-draft="build" required>'+options(profiles,d.profileId||state.profileKey,x=>(x.name||x.id)+' · Revision '+count(x.revision),'Choose saved mapping')+'</select></label>'+
      draftInput('build','asOf','Assess the work as of','datetime-local',localInput(new Date().toISOString()),'required')+
      '<label class="full">Edition commentary<textarea name="commentary" data-draft="build">'+esc(d.commentary||'')+'</textarea></label></div><div class="form-actions"><button type="submit" class="primary">Save source edition</button></div></form></details>';
  }
  function requestFilters(){
    const codes=[...new Set(list(state.requests?.items).flatMap(r=>list(r.discrepancies).map(x=>x.code)))].filter(Boolean).sort();
    return '<div class="filters"><label class="grow">Search requests<input id="request-query" type="search" value="'+esc(state.query)+'" placeholder="Request identifier, title or original value"></label>'+
      '<label>Follow-through issue<input id="discrepancy-filter" value="'+esc(state.discrepancy)+'" list="discrepancy-codes" placeholder="All issues"><datalist id="discrepancy-codes">'+codes.map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist></label>'+
      '<label>Assigned to<input id="assignee-filter" value="'+esc(state.assignee)+'" placeholder="Any owner"></label><label>Work status<select id="work-status-filter">'+enums(['new','assigned','in_progress','done','dismissed'],state.workStatus,'Any work status')+'</select></label><label>Rows per page<select id="page-size">'+options([10,25,50,100,250].map(n=>({id:String(n),name:String(n)})),String(state.limit),x=>x.name)+'</select></label>'+button('clear-filters','Clear filters')+'</div>';
  }
  function flags(value){const entries=list(value);return entries.length?'<div class="badges">'+entries.map(x=>'<span class="badge" title="'+esc(typeof x.detail==='string'?x.detail:pretty(x.detail)||'')+'">'+esc(x.label||enumLabel(x.code)||human(x))+'</span>').join('')+'</div>':'<span class="muted">No flags in the selected mapping</span>';}
  function requestTable(rows){
    const items=list(rows?.items);
    if(!items.length)return empty('No requests in this selection','Change the filters or choose another source edition.');
    return '<div class="table-scroll"><table><thead><tr><th>Service request</th><th>Original status</th><th>Related work</th><th>Follow-through</th><th>Assigned action</th><th>Review</th><th></th></tr></thead><tbody>'+items.map(r=>'<tr><td><strong>'+esc(human(r.serviceRequestId||r.key))+'</strong>'+(r.title?'<div class="cell-secondary">'+esc(r.title)+'</div>':'')+(r.updatedAt?'<div class="cell-secondary">Updated '+esc(stamp(r.updatedAt))+'</div>':'')+'</td><td>'+esc(human(r.sourceStatus))+'</td><td>'+esc(enumLabel(r.workNeeded))+'<div class="cell-secondary">'+count(r.candidateCount)+' candidates · '+count(r.linkCount)+' confirmed links</div></td><td>'+flags(r.discrepancies)+'</td><td>'+(r.work?'<strong>'+esc(r.work.assignee||'Unassigned')+'</strong><div class="cell-secondary">'+esc(enumLabel(r.work.action))+' · '+esc(enumLabel(r.work.status))+'</div>':'<span class="muted">No saved work</span>')+'</td><td>'+(r.work?badge(enumLabel(r.work.approval),r.work.approval==='approved'?'strong':'')+(r.work.sourceChanged?'<div class="cell-secondary">Review the newer source</div>':''):'—')+'</td><td>'+button('request-detail','Open request','data-key="'+esc(r.key)+'"')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function renderRequests(){
    const e=state.edition?.edition||state.edition||selectedEdition(),totals=e?.totals||{};
    return header('Service follow-through','Follow each original service request into its related work, save the owner and next action, and review what is ready to deliver.',state.editionId?exportButtons(['requests-csv','review','edition'],{editionId:state.editionId}):'')+
      buildForm()+'<section class="panel">'+editionSelector()+(e?'<div class="status-strip"><span>'+count(e.rows??state.requests?.total)+' requests</span><span>As of '+esc(stamp(e.asOf))+'</span><span>'+esc(sourceSummary(e.requestSourceId)?.name||short(e.requestSourceId))+'</span><span>'+(e.orderSourceId?esc(sourceSummary(e.orderSourceId)?.name||short(e.orderSourceId)):'No work-order source selected')+'</span></div>'+details('Edition coverage and rules',{coverage:e.coverage,totals,profileId:e.profileId,sourceIds:[e.requestSourceId,e.orderSourceId]}):'')+'</section>'+
      (state.editionId?'<section class="panel flat"><div class="panel-padding">'+requestFilters()+'</div>'+requestTable(state.requests)+pager(state.requests)+'</section>':empty('Prepare a source edition','Receive an original request file, save its field mapping, then build an operating edition above.',viewLink('sources','Open original sources')));
  }
  function changeKind(item){return item.kind||item.change||item.type||(item.before&&!item.after?'notObserved':!item.before&&item.after?'added':'changed');}
  function changeFields(item){
    if(Array.isArray(item.changes))return item.changes;
    if(Array.isArray(item.fields))return item.fields;
    if(item.changes&&typeof item.changes==='object')return Object.entries(item.changes).map(([field,x])=>({field,...(x&&typeof x==='object'?x:{after:x})}));
    return [];
  }
  function renderChanges(){
    const result=state.changes,summary=result?.summary||{},same=state.beforeId&&state.beforeId===state.editionId,orders=state.changeEntity==='orders',noun=orders?'work orders':'requests';
    return header('Source changes','Compare saved requests or work orders across two operating editions. Original source values stay available in both editions.')+
      '<section class="panel"><div class="form-grid">'+editionSelector('change-before',state.beforeId,'Choose earlier edition')+editionSelector('change-after',state.editionId,'Choose later edition')+
      '<label>Source records<select id="change-entity">'+options(['requests','orders'],state.changeEntity,x=>x==='orders'?'Work orders':'Service requests')+'</select></label></div><p class="section-note">A record absent from a later source selection is recorded as not observed in that edition. Its original file and earlier history stay available. A declared generated source identifier is shown separately from changes to the original business fields.</p></section>'+
      (same?empty('Choose two different source editions','The source comparison uses an earlier and a later saved edition.'):result?'<div class="metrics">'+metric(summary.added||0,'Added '+noun)+metric(summary.changed||0,'Changed '+noun)+metric(summary.notObserved||0,'Not observed later')+metric(summary.unchanged||0,'Unchanged '+noun)+(summary.sourceMetadataOnly?metric(summary.sourceMetadataOnly,'Source metadata changes'):'')+'</div>'+
      '<section class="panel flat">'+(list(result.items).length?'<div class="change-list">'+list(result.items).map((item,index)=>{
        const entity=item.entity||state.changeEntity,isOrder=entity==='orders',identity=isOrder?(item.workOrderId||item.after?.workOrderId||item.before?.workOrderId):(item.serviceRequestId||item.after?.serviceRequestId||item.before?.serviceRequestId);
        const metadataOnly=item.sourceMetadataOnly||changeKind(item)==='source_metadata_only';
        return '<article class="change-item"><header class="panel-header"><div><h3>'+esc(human(identity||item.key))+'</h3>'+badge(enumLabel(changeKind(item)))+'</div><div class="actions">'+button('change-detail','Compare original values','data-index="'+index+'"')+(!isOrder&&item.after?button('request-detail','Open later request','data-key="'+esc(item.key||item.after.key)+'"'):'')+'</div></header>'+flags(item.discrepancies||item.after?.discrepancies)+'<p>'+esc(item.summary||item.label||(changeFields(item).length?count(changeFields(item).length)+' original field changes':'The complete before and after records are retained.'))+'</p>'+(metadataOnly?'<p class="section-note">The original business fields are unchanged. This change is confined to the declared generated source identifier; both complete original records are retained.</p>':'')+(!isOrder&&(item.work||item.workChanged||item.sourceChanged)?'<p class="section-note">Review the saved assignment against the selected source edition.</p>':'')+'</article>';
      }).join('')+'</div>':empty('No changed '+noun+' in this page','The comparison summary covers both complete saved editions.'))+pager(result,'changes')+'</section>':empty('Choose editions to compare','Save a later original source file and build its operating edition to compare the same service series.'));
  }
  const workValue=value=>value?.work||value;
  const orderValue=value=>value?.order||value?.workOrder||value;
  function workList(){
    let items=latest(state.workspace.work);
    if(state.assignee)items=items.filter(w=>String(w.assignee||'').toLocaleLowerCase().includes(state.assignee.toLocaleLowerCase()));
    if(state.workStatus)items=items.filter(w=>w.status===state.workStatus);
    return items;
  }
  function workCards(items){
    return '<div class="record-list">'+items.map(w=>'<article class="record-card"><header><div><h3>'+esc(human(w.serviceRequestId||w.key))+'</h3><p>'+esc(w.assignee||'Unassigned')+' · '+esc(enumLabel(w.action))+'</p></div>'+badge(enumLabel(w.approval),w.approval==='approved'?'strong':'')+'</header><div class="badges">'+badge(enumLabel(w.status))+badge(enumLabel(w.priority||'normal'))+(w.sourceChanged?badge('Source changed'):'')+'</div>'+(w.dueAt?'<p>Due '+esc(stamp(w.dueAt))+'</p>':'')+(w.actionNote?'<p class="description-text">'+esc(w.actionNote)+'</p>':'')+'<div class="actions">'+button('open-work','Open saved work','data-id="'+esc(w.id)+'"')+(w.editionId&&w.key?button('request-detail','Open request','data-key="'+esc(w.key)+'" data-edition-id="'+esc(w.editionId)+'"'):'')+'</div></article>').join('')+'</div>';
  }
  function proposalSummary(p){
    const before=p.before||{},after=p.after||{};
    if(p.kind==='link')return human(after.decision||before.decision)+' relationship with '+human(after.orderKey||before.orderKey);
    return [after.assignee||before.assignee,enumLabel(after.status||before.status),enumLabel(after.action||before.action)].filter(Boolean).join(' · ');
  }
  function renderReviewReturn(){
    const r=state.returned,d=state.draft.review,proposals=list(r?.proposals),pending=reviewable(),choices=state.reviewChoices;
    return '<section class="panel"><h2>Receive an editable review</h2><p>A reviewer can change the exported review file and return it here. Each returned choice is compared with the original request and saved assignment before it is applied.</p>'+
      '<form id="review-import-form"><div class="form-stack"><label>Returned review file<input id="review-file" type="file" accept=".json,application/json"></label>'+(d.filename?'<p class="file-selected">'+esc(d.filename)+' · '+byteLabel(d.bytes||0)+'</p>':'')+'<div class="form-actions"><button class="primary" type="submit"'+(!d.originalText?' disabled':'')+'>Receive review file</button></div></div></form></section>'+
      '<section class="panel"><div class="form-grid"><label>Saved returned review<select id="return-selection">'+options(latest(state.workspace.returns),state.returnId,x=>(x.name||x.filename||short(x.id))+' · '+stamp(x.createdAt),'Choose returned review')+'</select></label>'+reviewTargetSelector()+'</div></section>'+
      (r?'<section class="panel"><div class="panel-header"><div><h2>Review returned changes</h2><p>'+count(pending.length)+' awaiting a decision · '+count(proposals.length)+' changed items</p></div>'+badge('Original file retained')+'</div>'+
      (proposals.length?'<div class="record-list">'+proposals.map((p,index)=>{const isPending=pending.some(x=>x.id===p.id),choice=choices.get(p.id)||'pending',conflicts=list(p.conflicts),blocked=conflicts.length>0;return '<article class="review-card"><header><h3>'+esc(human(p.serviceRequestId||p.key))+' · '+esc(enumLabel(p.kind))+'</h3>'+badge(isPending?'Awaiting review':enumLabel(p.status))+'</header><p>'+esc(proposalSummary(p))+'</p>'+
      (blocked?'<div class="callout"><strong>Changed since this review was prepared</strong><p>'+conflicts.map(x=>esc(typeof x==='string'?x:x.message||x.code||pretty(x))).join('<br>')+'</p></div>':'')+
      '<div class="equal-split"><div class="change-before"><h4>Saved before review</h4><pre>'+esc(pretty(p.before))+'</pre></div><div class="change-after"><h4>Returned proposal</h4><pre>'+esc(pretty(p.after))+'</pre></div></div>'+
      (isPending?'<div class="actions" role="group" aria-label="Decision for '+esc(human(p.serviceRequestId||p.key))+'">'+[['pending','Decide later'],['accept','Accept change'],['reject','Reject change']].map(([value,label])=>'<label class="check-label"><input type="radio" name="proposal-'+index+'" data-proposal="'+esc(p.id)+'" value="'+value+'"'+(choice===value?' checked':'')+(value==='accept'&&blocked?' disabled':'')+'>'+label+'</label>').join('')+'</div>':'')+'</article>';}).join('')+'</div>':empty('No proposed changes in this return','The returned original file and unchanged rows remain part of the saved review.'))+
      '<form id="review-apply-form"><div class="form-grid">'+draftInput('review','reviewer','Reviewing person','text','','required')+'<label>Decision note<textarea name="note" data-draft="review">'+esc(d.note||'')+'</textarea></label></div><div class="form-actions"><button class="primary" type="submit"'+(!pending.length?' disabled':'')+'>Apply selected decisions</button>'+button('clear-review-choices','Decide all remaining later')+'</div><p class="section-note">Only the selected accept and reject decisions are saved. Remaining proposals stay open with their original source and assignment context.</p></form>'+details('Return metadata and unchanged records',r)+'</section>':'');
  }
  function renderWork(){
    const items=workList(),w=workValue(state.work);
    return header('Assigned work and reviews','Save ownership and due times, keep the action separate from completion, and review returned edits before they change the operating desk.',state.editionId?exportButtons(['review'],{editionId:state.editionId}):'')+
      '<div class="split"><section class="panel"><h2>Saved assignments</h2><div class="filters"><label class="grow">Assigned to<input id="work-assignee-filter" value="'+esc(state.assignee)+'" placeholder="Any owner"></label><label>Status<select id="saved-work-status-filter">'+enums(['new','assigned','in_progress','done','dismissed'],state.workStatus,'All work statuses')+'</select></label></div>'+(items.length?workCards(items):empty('No assignments in this selection','Open a service request to save its owner, due time and next action.'))+'</section>'+
      '<aside class="panel"><h2>Selected assignment</h2>'+(w?'<dl class="detail-grid"><dt>Request</dt><dd>'+esc(human(w.serviceRequestId||w.key))+'</dd><dt>Owner</dt><dd>'+esc(w.assignee||'Unassigned')+'</dd><dt>Status</dt><dd>'+esc(enumLabel(w.status))+'</dd><dt>Action</dt><dd>'+esc(enumLabel(w.action))+'</dd><dt>Approval</dt><dd>'+esc(enumLabel(w.approval))+'</dd><dt>Due</dt><dd>'+esc(stamp(w.dueAt))+'</dd><dt>Reviewed by</dt><dd>'+esc(w.reviewer||'—')+'</dd></dl><p class="description-text">'+esc(w.actionNote||w.note||'')+'</p><div class="actions">'+button('request-detail','Edit assignment on request','data-key="'+esc(w.key)+'" data-edition-id="'+esc(w.editionId||state.editionId)+'"')+'</div>'+details('Complete assignment and saved history',state.work):empty('Select an assignment','The complete saved action and history will appear here.'))+'</aside></div>'+renderReviewReturn();
  }
  function approvedWork(){
    return list(state.approvedWorkPage?.items).filter(w=>w.approval==='approved'&&w.action!=='none'&&w.approvalCurrent!==false&&!w.sourceChanged&&!w.orderChanged);
  }
  function dispatchRows(value){return list(value?.rows||value?.dispatch?.rows);}
  function renderDispatchRows(value){
    const rows=dispatchRows(value),offset=state.dispatchOffset||0,items=rows.slice(offset,offset+state.limit),declared=list(value?.columns||value?.definition?.columns||value?.dispatch?.columns),names=declared.length?declared.map(c=>c.name):Object.keys(items[0]||{});
    if(!rows.length)return empty('No rows in this dispatch','The saved dispatch definition and file exports remain available.');
    return '<div class="table-scroll"><table><thead><tr>'+names.map(n=>'<th>'+esc(n)+'</th>').join('')+'<th>Complete row</th></tr></thead><tbody>'+items.map((r,i)=>'<tr>'+names.map(n=>'<td>'+esc(human((r.mapped||r)[n]))+'</td>').join('')+'<td>'+button('dispatch-row-detail','Open','data-index="'+(offset+i)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+pager({items,total:rows.length,offset,limit:state.limit},'dispatch-row');
  }
  function renderDispatch(){
    const items=approvedWork(),d=state.draft.dispatch,selectedCount=state.selectedWork.size,value=state.dispatch?{...(state.dispatch.dispatch||{}),...state.dispatch}:null;
    return header('Reviewed dispatch','Choose the approved actions to deliver, name the destination columns, and save the exact dispatch package.')+
      '<section class="panel">'+editionSelector()+'<p class="section-note">A dispatch saves the selected request and order versions, reviewed action, owner, due time and location. It can be reopened and exported as JSON, CSV, GeoJSON or an operating report.</p></section>'+
      '<div class="split"><section class="panel flat"><div class="panel-header"><div><h2>Approved actions</h2><p>'+count(selectedCount)+' selected of '+count(state.approvedWorkPage?.total||0)+' available</p></div><div class="actions">'+button('select-approved','Select all approved')+button('clear-approved','Clear selection')+'</div></div>'+
      (items.length?'<div class="table-scroll"><table><thead><tr><th><span class="visually-hidden">Select</span></th><th>Request and action</th><th>Owner and due</th><th>Reviewed by</th><th></th></tr></thead><tbody>'+items.map(w=>'<tr><td><input type="checkbox" data-select-work="'+esc(w.id)+'" aria-label="Select '+esc(human(w.serviceRequestId||w.key))+'"'+(state.selectedWork.has(w.id)?' checked':'')+'></td><td><strong>'+esc(human(w.serviceRequestId||w.key))+'</strong><div class="cell-secondary">'+esc(enumLabel(w.action))+'</div></td><td>'+esc(w.assignee||'Unassigned')+'<div class="cell-secondary">'+esc(stamp(w.dueAt))+'</div></td><td>'+esc(w.reviewer||'—')+'</td><td>'+button('request-detail','Open','data-key="'+esc(w.key)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+pager(state.approvedWorkPage,'approved'):empty('No approved actions in this source edition','Open a service request, save its next action and reviewer, then select Approved in the work editor.',viewLink('requests','Open service follow-through')))+'</section>'+
      '<aside class="panel"><h2>Save selected dispatch</h2><form id="dispatch-form"><div class="form-stack">'+draftInput('dispatch','name','Dispatch name','text','','required')+'<label>Destination columns<textarea name="columns" data-draft="dispatch" class="code-input" rows="7">'+esc(d.columns||'[]')+'</textarea><small>Use [] for the named standard mapping, or objects with name, source (request, order or work) and the original field name.</small></label><label>Dispatch note<textarea name="note" data-draft="dispatch">'+esc(d.note||'')+'</textarea></label><div class="form-actions"><button type="submit" class="primary"'+(!selectedCount?' disabled':'')+'>Save '+count(selectedCount)+' selected actions</button></div></div></form><p class="section-note">Selection is retained while you open requests. The workspace checks the original source and approval again when it saves the dispatch.</p></aside></div>'+
      '<section class="panel flat"><div class="panel-header"><h2>Saved dispatch packages</h2><label><span class="visually-hidden">Choose saved dispatch</span><select id="dispatch-selection">'+options(latest(state.workspace.dispatches),state.dispatchId,x=>(x.name||short(x.id))+' · '+stamp(x.createdAt),'Choose saved dispatch')+'</select></label></div>'+
      (value?'<div class="panel-padding"><dl class="detail-grid"><dt>Name</dt><dd>'+esc(value.name||value.definition?.name)+'</dd><dt>Rows</dt><dd>'+count(dispatchRows(value).length||value.rowCount||0)+'</dd><dt>Saved</dt><dd>'+esc(stamp(value.createdAt))+'</dd><dt>Source edition</dt><dd>'+esc(value.editionId||value.definition?.editionId||'')+'</dd></dl><div class="actions">'+exportButtons(['dispatch-json','dispatch-csv','dispatch-geojson','report'],{dispatchId:state.dispatchId})+'</div>'+details('Dispatch definition and location coverage',value.definition||{...value,rows:undefined})+'</div>'+renderDispatchRows(value):empty('No dispatch selected','Saved dispatch packages keep the exact reviewed selection for later delivery.'))+'</section>';
  }
  function receiveSummary(){
    const d=state.draft.receiving;if(!d.originalText)return '';
    let value;try{value=JSON.parse(d.originalText);}catch{return '<div class="callout"><strong>The selected file is not complete JSON</strong><p>Choose a complete workspace handover exported by this desk.</p></div>';}
    const w=value.workspace||value.payload?.workspace||value;
    return '<dl class="detail-grid"><dt>File</dt><dd>'+esc(d.filename)+'</dd><dt>Size</dt><dd>'+byteLabel(d.bytes||0)+'</dd><dt>Workspace identity</dt><dd>'+esc(w.workspaceId||w.id||value.workspaceId||'Available when the handover is opened')+'</dd><dt>Format</dt><dd>'+esc(value.schema||value.kind||value.format||'Workspace handover')+'</dd></dl>'+details('Handover file structure',{...Object.fromEntries(Object.entries(value).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v))),sections:Object.fromEntries(Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,Array.isArray(v)?{records:v.length}:Object.keys(v)]))});
  }
  function renderReceiving(){
    return header('Open a handover','Continue work from the complete workspace file, including original sources, field mappings, assignments, review history and saved dispatch.')+
      '<div class="split"><section class="panel"><h2>Save this workspace</h2><p>Download the full editable handover after the operating work is saved. The receiving desk can continue from the same original source editions and reviewed decisions.</p><div class="actions">'+exportButtons(['workspace'])+'</div><h3>Current workspace</h3><dl class="detail-grid"><dt>Name</dt><dd>'+esc(state.workspace.name||short(state.workspace.workspaceId))+'</dd><dt>Saved edition</dt><dd>'+count(state.workspace.revision)+'</dd><dt>Sources</dt><dd>'+count(list(state.workspace.sources).length)+'</dd><dt>Operating editions</dt><dd>'+count(list(state.workspace.editions).length)+'</dd><dt>Assigned work</dt><dd>'+count(list(state.workspace.work).length)+'</dd></dl></section>'+
      '<section class="panel"><h2>Open a complete handover</h2><p>The receiving operation validates the complete file and preserves its original workspace identity. Use a fresh workspace directory when starting a separate receiving desk.</p><form id="receiving-form"><div class="form-stack"><label>Complete workspace file<input id="receiving-file" type="file" accept=".json,application/json"></label>'+receiveSummary()+'<div class="form-actions"><button type="submit" class="primary"'+(!state.draft.receiving.originalText?' disabled':'')+'>Open handover in this workspace</button></div></div></form></section></div>'+
      '<section class="panel"><h2>Receiving directory</h2><p>This browser is connected to the workspace launched from the directory below. The command line and installed application operate the same complete file format.</p><pre>'+esc(state.launch?.directory||'Local workspace directory')+'</pre>'+details('Workspace and application information',{workspaceId:state.workspace.workspaceId,revision:state.workspace.revision,launch:state.launch})+'</section>';
  }


  function requestRecord(){return state.detail?.request||null;}
  function requestContext(r=requestRecord(),editionId=state.detail?.edition?.id||state.detailEditionId||state.editionId){return r?editionId+':'+r.key+':'+r.sourceSha256:'';}
  function sourceIdentity(r){return '<dl class="detail-grid"><dt>Original identifier</dt><dd>'+esc(human(r.serviceRequestId??r.workOrderId??r.key))+'</dd><dt>Original status</dt><dd>'+esc(human(r.sourceStatus))+'</dd><dt>Created</dt><dd>'+esc(stamp(r.createdAt))+'</dd><dt>Updated</dt><dd>'+esc(stamp(r.updatedAt))+'</dd><dt>Closed</dt><dd>'+esc(stamp(r.closedAt))+'</dd></dl>';}
  function knownOrders(){
    const map=new Map();
    for(const entry of [...list(state.detail?.candidates),...list(state.detail?.links),...list(state.orders?.items)]){const order=orderValue(entry);if(order?.key&&order?.sourceSha256)map.set(order.key,order);}
    return [...map.values()];
  }
  function selectedLinkDraft(){
    const context=requestContext();
    if(state.draft.link.context!==context)state.draft.link={context,reviewer:state.draft.link.reviewer||'',decision:'confirm',note:''};
    return state.draft.link;
  }
  function currentWorkDraft(){
    const request=requestRecord(),context=requestContext(),saved=workValue(state.detail?.work||request?.work)||{},records=state.draft.work.records||{};
    if(records[context])return records[context];
    return {
      context,status:saved.status||'new',assignee:saved.assignee||'',priority:saved.priority||'normal',
      dueAt:localInput(saved.dueAt),note:saved.note||'',action:saved.action||'review',actionNote:saved.actionNote||'',
      targetOrderKeys:list(saved.targetOrderKeys),approval:saved.sourceChanged?'draft':saved.approval||'draft',reviewer:saved.reviewer||'',
      locationMode:saved.location?.mode||'source',locationName:saved.location?.name||'',
      longitude:saved.location?.longitude??'',latitude:saved.location?.latitude??'',
      sourceReferences:pretty(saved.location?.sourceReferences||[])
    };
  }
  function retainWorkDraft(form){
    if(!form||!requestRecord())return;
    const d={...currentWorkDraft(),...Object.fromEntries(new FormData(form).entries())};
    d.targetOrderKeys=[...form.elements.targetOrderKeys.selectedOptions].map(o=>o.value);
    d.context=requestContext();state.draft.work.records={...(state.draft.work.records||{}),[d.context]:d};
  }
  function orderCard(entry){
    const order=orderValue(entry);
    if(!order?.key)return '';
    const matches=list(entry.matches);
    return '<article class="record-card"><header><div><h3>'+esc(human(order.workOrderId||order.key))+'</h3>'+(order.title?'<p>'+esc(order.title)+'</p>':'')+'</div>'+badge(human(order.sourceStatus))+'</header>'+
      (order.description?'<p class="description-text">'+esc(order.description)+'</p>':'')+
      '<dl class="detail-grid"><dt>Created</dt><dd>'+esc(stamp(order.createdAt))+'</dd><dt>Closed</dt><dd>'+esc(stamp(order.closedAt))+'</dd></dl>'+
      (matches.length?details('Mapped relationship values',matches):'')+
      '<div class="actions">'+button('select-link-order','Review this relationship','data-order-key="'+esc(order.key)+'"')+button('order-detail','Original order','data-order-key="'+esc(order.key)+'"')+'</div></article>';
  }
  function orderSearchTable(){
    const rows=state.orders,items=list(rows?.items);
    if(!rows)return '<p class="muted">Search the selected original work-order source to find an order by its identifier or fields.</p>';
    return (items.length?'<div class="table-scroll"><table><thead><tr><th>Work-order identity</th><th>Original status</th><th>Title</th><th></th></tr></thead><tbody>'+items.map(o=>'<tr><td>'+esc(human(o.workOrderId||o.key))+'</td><td>'+esc(human(o.sourceStatus))+'</td><td>'+esc(o.title||'')+'</td><td>'+button('select-link-order','Select order','data-order-key="'+esc(o.key)+'"')+'</td></tr>').join('')+'</tbody></table></div>':empty('No work orders in this selection','Change the search value or receive a work-order source edition.'))+pager(rows,'order');
  }
  function renderLinks(){
    const r=requestRecord(),d=selectedLinkDraft(),selected=knownOrders().find(o=>o.key===d.orderKey),links=list(state.detail?.links),candidates=list(state.detail?.candidates),edition=state.detail?.edition||selectedEdition(),hasOrders=!!edition?.orderSourceId;
    return '<section class="dialog-section"><h3>Related work orders</h3>'+
      (links.length?'<div class="record-list">'+links.map(link=>'<article class="record-card"><header><h4>'+esc(human(link.order?.workOrderId||link.orderKey))+'</h4>'+badge(link.decision==='confirm'?'Confirmed relationship':'Rejected relationship')+'</header><p>'+esc(link.reviewer||'')+' · '+esc(stamp(link.createdAt))+'</p>'+(link.note?'<p class="description-text">'+esc(link.note)+'</p>':'')+(link.sourceChanged?'<div class="callout">The source has changed since this relationship was reviewed. Open the current order and review the newer source values.</div>':'')+details('Saved relationship and original order',link)+'</article>').join('')+'</div>':'<p class="muted">No reviewed relationships are saved for this request.</p>')+
      (candidates.length?'<h4>Mapped candidates</h4><div class="record-list">'+candidates.map(orderCard).join('')+'</div>':'<p class="section-note">The selected mapping has no matching candidate orders for this request.</p>')+
      (hasOrders?'<h4>Find an original work order</h4><p>Search the saved work-order source and choose an order for explicit relationship review.</p><div class="filters"><label class="grow">Original order search<input id="order-query" type="search" value="'+esc(state.orderQuery||'')+'" placeholder="Work-order identifier, title or original value"></label>'+button('search-orders','Search orders')+'</div>'+orderSearchTable()+
      '<form id="link-form"><fieldset><legend>Review selected relationship</legend>'+(selected?'<p><strong>'+esc(human(r.serviceRequestId||r.key))+'</strong> → <strong>'+esc(human(selected.workOrderId||selected.key))+'</strong></p><p class="section-note">The exact original request and work-order versions are attached to this decision.</p>':'<p class="muted">Select an order above.</p>')+
      '<div class="form-grid"><label>Decision<select name="decision" data-draft="link">'+options([{id:'confirm',name:'Confirm the relationship'},{id:'reject',name:'Reject the relationship'}],d.decision||'confirm',x=>x.name)+'</select></label>'+draftInput('link','reviewer','Reviewing person','text','','required')+'<label class="full">Relationship note<textarea name="note" data-draft="link" required>'+esc(d.note||'')+'</textarea></label></div><div class="form-actions"><button type="submit" class="primary"'+(!selected?' disabled':'')+'>Save relationship decision</button></div></fieldset></form>':
      '<div class="callout"><strong>Receive a work-order source to review relationships</strong><p>The request, assignment and next action can be prepared in this edition. A later edition can pair the original requests with the chosen work-order file.</p></div>')+'</section>';
  }
  function renderWorkEditor(){
    const r=requestRecord(),d=currentWorkDraft(),saved=workValue(state.detail?.work||r?.work),orders=knownOrders(),selectedKeys=new Set(list(d.targetOrderKeys));
    for(const key of selectedKeys)if(!orders.some(o=>o.key===key))orders.push({key,workOrderId:key});
    return '<section class="dialog-section"><h3>Assigned work and reviewed action</h3>'+(saved?.sourceChanged?'<div class="callout"><strong>Review this newer source version</strong><p>The earlier saved assignment remains in history. Review the source changes before approving an action for this edition.</p></div>':'')+
      '<form id="work-form"><div class="form-grid"><label>Work status<select name="status">'+enums(['new','assigned','in_progress','done','dismissed'],d.status)+'</select></label><label>Assigned to<input name="assignee" value="'+esc(d.assignee)+'"></label>'+
      '<label>Priority<select name="priority">'+enums(['low','normal','high','urgent'],d.priority)+'</select></label><label>Due at<input name="dueAt" type="datetime-local" value="'+esc(d.dueAt)+'"></label>'+
      '<label class="full">Working note<textarea name="note">'+esc(d.note)+'</textarea></label><label>Next action<select name="action">'+enums(['review','contact','inspect','create_work_order','update_work_order','reconcile','none'],d.action)+'</select></label>'+
      '<label>Review decision<select name="approval">'+enums(['draft','approved','rejected'],d.approval)+'</select></label><label class="full">Action to deliver<textarea name="actionNote">'+esc(d.actionNote)+'</textarea><small>Describe the actual action that belongs in a dispatch.</small></label>'+
      '<label>Reviewing person<input name="reviewer" value="'+esc(d.reviewer)+'"><small>Required for an approved or rejected action.</small></label>'+
      '<label>Target work orders<select name="targetOrderKeys" multiple size="'+Math.min(5,Math.max(2,orders.length))+'">'+orders.map(o=>'<option value="'+esc(o.key)+'"'+(selectedKeys.has(o.key)?' selected':'')+'>'+esc(human(o.workOrderId||o.key))+'</option>').join('')+'</select><small>Choose the exact orders this action concerns.</small></label></div>'+
      '<fieldset><legend>Dispatch location</legend><p class="section-note">Original coordinates are retained. Choose an interpretation or a manually reviewed position when the source declaration does not provide a usable geographic point.</p>'+
      '<div class="form-grid"><label>Location choice<select name="locationMode" id="work-location-mode">'+options([{id:'source',name:'Use the original source declaration'},{id:'wgs84',name:'Interpret this point as longitude / latitude'},{id:'web-mercator',name:'Interpret this point as Web Mercator metres'},{id:'manual',name:'Use a reviewed manual position'}],d.locationMode,x=>x.name)+'</select></label><label>Interpretation or reviewed location name<input name="locationName" value="'+esc(d.locationName)+'"></label>'+
      '<label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="'+esc(d.longitude)+'"'+(d.locationMode==='manual'?'':' disabled')+'></label><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="'+esc(d.latitude)+'"'+(d.locationMode==='manual'?'':' disabled')+'></label>'+
      '<label class="full">Location source references<textarea name="sourceReferences" rows="3">'+esc(d.sourceReferences||'[]')+'</textarea><small>JSON array of original reference strings for the selected interpretation or manual position.</small></label></div>'+
      details('Original and interpreted request coordinates',{original:r.originalGeometry,geographic:r.geometry})+'</fieldset>'+
      '<div class="form-actions"><button type="submit" class="primary">Save assigned work</button>'+button('reset-work-draft','Load saved assignment')+'</div><p class="section-note">Editing the source-dependent action or location returns its approval to Draft until the reviewer selects a new decision.</p></form></section>';
  }
  function renderRequestDialog(){
    const d=state.detail,r=requestRecord();if(!r)return;
    $('#detail-title').textContent='Service request '+human(r.serviceRequestId||r.key);
    $('#detail-content').innerHTML='<section class="dialog-section"><div class="panel-header"><div><h3>'+esc(r.title||'Original service request')+'</h3><p>'+esc(enumLabel(r.workNeeded))+'</p></div>'+badge('Source edition '+short(d.edition?.id||state.detailEditionId||state.editionId))+'</div>'+
      sourceIdentity(r)+(r.description?'<p class="description-text">'+esc(r.description)+'</p>':'')+flags(d.discrepancies||r.discrepancies)+
      details('Original references and source version',{references:r.referenceValues,sourceId:r.sourceId,sourceSha256:r.sourceSha256,key:r.key,dates:r.dates})+'</section>'+
      renderLinks()+renderWorkEditor()+'<section class="dialog-section"><h3>Original source and saved history</h3>'+details('Complete original service request',r.original||r.source||r)+details('Complete request and interpreted fields',r)+details('All saved assignment and relationship history',d.history||[])+details('Complete source edition',d.edition||{})+'</section>';
  }
  async function openRequest(key,editionId=state.editionId,{keepOrders=false,captureDraft=true}={}){
    if(!key||!editionId)throw new Error('Choose a saved source edition and service request.');
    if(captureDraft&&$('#work-form'))retainWorkDraft($('#work-form'));
    const seq=(state.detailSequence||0)+1;state.detailSequence=seq;
    const result=await api(apiUrl('/api/request',{editionId,key}));
    if(seq!==state.detailSequence)return;
    if(!keepOrders||state.detailEditionId!==editionId){state.orders=null;state.orderQuery='';state.orderOffset=0;}
    state.detail=result;state.detailEditionId=editionId;renderRequestDialog();
    const dialog=$('#detail-dialog');if(!dialog.open)dialog.showModal();
  }
  async function refreshOpenRequest(){
    const r=requestRecord();if(r&&$('#detail-dialog').open)await openRequest(r.key,state.detailEditionId,{keepOrders:true,captureDraft:false});
  }
  async function searchOrders(){
    if(!requestRecord())return;
    const editionId=state.detailEditionId,key=requestRecord().key,seq=(state.orderSequence||0)+1;state.orderSequence=seq;
    const form=$('#work-form');if(form)retainWorkDraft(form);
    const result=await api(apiUrl('/api/orders',{editionId,q:state.orderQuery,offset:state.orderOffset||0,limit:state.limit}));
    if(seq!==state.orderSequence||editionId!==state.detailEditionId||key!==requestRecord()?.key)return;
    state.orders=result;renderRequestDialog();
  }
  function showDetail(title,content){
    const form=$('#work-form');if(form)retainWorkDraft(form);
    state.detail=null;state.detailSequence=(state.detailSequence||0)+1;
    $('#detail-title').textContent=title;$('#detail-content').innerHTML=content;const dialog=$('#detail-dialog');if(!dialog.open)dialog.showModal();
  }
  function render(){
    if(!state.workspace)return;
    const fn={overview:renderOverview,sources:renderSources,profiles:renderProfiles,requests:renderRequests,changes:renderChanges,work:renderWork,dispatch:renderDispatch,receiving:renderReceiving}[state.view]||renderOverview;
    $('#main').innerHTML=pendingBanner()+fn();
    $('#main').dataset.editionId=state.editionId;$('#main').dataset.sourceId=state.sourceId;$('#main').dataset.returnId=state.returnId;$('#main').dataset.dispatchId=state.dispatchId;
    if(state.view==='sources'&&$('#source-form')){$('#source-form').dataset.inspectionState=state.draft.source.inspection?.state||'none';$('#source-form').dataset.filename=state.draft.source.filename||'';$('#source-form').dataset.captureIds=JSON.stringify(state.draft.source.inspection?.coverage?.selectedCaptures||[]);}
    if(state.view==='profiles')restoreProfileForm();
    if(state.busy)$$('button[type="submit"]',$('#main')).forEach(x=>x.disabled=true);
    $('#download-workspace').disabled=state.busy;
  }


  function formValues(form){return Object.fromEntries(new FormData(form).entries());}
  function profileFormMemory(form){
    if(!form)return;
    const values={};for(const input of [...form.elements])if(input.name&&input.type!=='submit')values[input.name]=input.type==='checkbox'?input.checked:input.value;
    state.draft.profile.formValues=values;
  }
  function restoreProfileForm(){
    const form=$('#profile-form');if(!form)return;
    for(const [name,value] of Object.entries(state.draft.profile.formValues||{})){const input=form.elements.namedItem(name);if(!input)continue;if(input.type==='checkbox')input.checked=!!value;else{if(input.tagName==='SELECT'&&value&&!list([...input.options]).some(o=>o.value===value)){const option=new Option('Saved mapping: '+value,value);input.add(option);}input.value=value??'';}}
    const json=(state.draft.profile.editorMode||'basic')==='json';$('#profile-basic').hidden=json;$('#profile-json-panel').hidden=!json;
    $$('input,select,textarea',$('#profile-basic')).forEach(input=>input.disabled=json);
    for(const name of ['id','name','revision'])form.elements.namedItem(name).readOnly=json;
  }
  function readProfileForm(form,mode=state.draft.profile.editorMode||'basic'){
    if(mode==='json')return parseJson(form.elements.profileJson.value,'Complete field mapping');
    const values=formValues(form),base=editorProfile(),p=JSON.parse(JSON.stringify(base));
    p.id=String(values.id||'').trim();p.name=String(values.name||'').trim();p.revision=Number(values.revision);
    if(!p.id||!p.name||!Number.isSafeInteger(p.revision)||p.revision<1)throw new Error('Give the field mapping an identity, name and positive whole revision.');
    for(const role of ['request','order']){
      const prefix=role+'_',m={...(p[role]||{})};
      m.idFields=words(values[prefix+'idFields']);m.referenceFields=words(values[prefix+'referenceFields']);
      for(const key of ['titleField','descriptionField','statusField'])m[key]=values[prefix+key]||null;
      m.dates={};for(const key of ['createdAt','updatedAt','closedAt'])if(values[prefix+key+'Field'])m.dates[key]={field:values[prefix+key+'Field'],format:values[prefix+key+'Format']||'literal'};
      m.coordinates={mode:values[prefix+'coordinateMode']||'source',name:values[prefix+'coordinateName']||'',sourceReferences:parseJson(values[prefix+'coordinateReferences']||'[]',role+' coordinate source references','array')};
      if(role==='request')m.workNeeded={field:values.request_workNeededField||null,neededValues:parseJson(values.request_neededValues||'[]','Values meaning work needed','array'),notNeededValues:parseJson(values.request_notNeededValues||'[]','Values meaning no work needed','array')};
      else m.costs=parseJson(values.order_costs||'[]','Work-order cost fields','array');
      p[role]=m;
    }
    p.joins=parseJson(values.joins||'[]','Relationship rules','array');p.statuses={...p.statuses};
    for(const key of ['requestClosed','requestActive','orderClosed','orderActive'])p.statuses[key]=parseJson(values['status_'+key]||'[]',key+' status values','array');
    p.rules={...p.rules};for(const key of ['requireOrderWhenNeeded','flagMultipleCandidates','flagRequestClosedOrderActive','flagOrderClosedRequestActive'])p.rules[key]=form.elements.namedItem('rule_'+key).checked;
    p.rules.staleAfterDays=values.staleAfterDays===''?null:Number(values.staleAfterDays);p.notes=values.notes||'';
    return p;
  }
  async function inspectSource(){
    const d=state.draft.source;if(typeof d.originalText!=='string')throw new Error('Choose the complete original source file first.');
    const priorInspection=d.inspection,sequence=++inspectionSequence,input={originalText:d.originalText,...(d.metadataText!==undefined?{metadataText:d.metadataText}:{}),...(d.kind?{kind:d.kind}:{}),...(d.sourceUrl?{sourceUrl:d.sourceUrl}:{}),...(d.name?{name:d.name}:{}),...(Array.isArray(d.captureIds)?{captureIds:d.captureIds}:{})};
    const form=$('#source-form');if(form){form.dataset.inspectionState='loading';form.querySelector('button[type="submit"]').disabled=true;}
    let result;try{result=await api('/api/inspect-source',input);}catch(error){if(sequence===inspectionSequence){d.inspection=priorInspection?{...priorInspection,state:'selection_required',rows:0,fields:[],coverage:{selectionRequired:true},error:null}:null;render();}throw error;}
    if(sequence!==inspectionSequence)return;d.inspection=result;await retainDrafts();render();
  }
  async function loadOriginalFile(input,kind){
    const file=input.files?.[0];if(!file)return;
    const sequence=++fileSequence[kind],raw=new Uint8Array(await file.arrayBuffer());
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw new Error('Choose a UTF-8 text source or workspace file. The selected file contains bytes that cannot be represented unchanged as UTF-8 text.');}
    if(sequence!==fileSequence[kind])return;
    if(kind==='source'){const d=state.draft.source;d.originalText=text;d.filename=file.name;d.bytes=raw.length;d.name=d.name||file.name;d.inspection=null;delete d.captureIds;await retainDrafts();render();await inspectSource();}
    else if(kind==='metadata'){state.draft.source.metadataText=text;state.draft.source.metadataFilename=file.name;state.draft.source.inspection=null;await retainDrafts();render();if(state.draft.source.originalText!==undefined)await inspectSource();}
    else{const d=state.draft[kind];d.originalText=text;d.filename=file.name;d.bytes=raw.length;await retainDrafts();render();}
  }
  async function submitSource(form){
    const values=formValues(form),d=state.draft.source;if(!d.inspection)throw new Error('Inspect the complete original file before saving it.');if(d.inspection.state==='selection_required')throw new Error('Choose the original captures to save as this source edition.');
    const input={originalText:d.originalText,...(d.metadataText!==undefined?{metadataText:d.metadataText}:{}),role:values.role,seriesId:String(values.seriesId||'').trim(),observedAt:toIso(values.observedAt,'Source observed at'),name:String(values.name||'').trim(),sourceUrl:values.sourceUrl||null,...(values.kind?{kind:values.kind}:{}),...(Array.isArray(d.captureIds)?{captureIds:d.captureIds}:{})};
    if(!input.seriesId||!input.name||!input.observedAt)throw new Error('Give the original source a name, series and observation time.');
    const result=await mutate('/api/import',input,'Original source edition saved.');
    if(result){const next={role:values.role,seriesId:input.seriesId,sourceUrl:values.sourceUrl||'',kind:values.kind||''};state.draft.source=next;await retainDrafts();render();}
  }
  async function submitProfile(form){
    profileFormMemory(form);const profile=readProfileForm(form);
    const result=await mutate('/api/profile',{profile},'Field and link mapping edition saved.');
    if(result){state.draft.profile={requestSourceId:state.draft.profile.requestSourceId,orderSourceId:state.draft.profile.orderSourceId};await retainDrafts();await refreshDetail();render();}
  }
  async function submitBuild(form){
    const values=formValues(form),definition={name:String(values.name||'').trim(),seriesId:String(values.seriesId||'').trim(),requestSourceId:values.requestSourceId,orderSourceId:values.orderSourceId||null,profileId:values.profileId,asOf:toIso(values.asOf,'Operating assessment time'),commentary:values.commentary||''};
    if(!definition.name||!definition.seriesId||!definition.requestSourceId||!definition.profileId||!definition.asOf)throw new Error('Choose the original request file, saved field mapping, edition name, operating series and assessment time.');
    const result=await mutate('/api/build',{definition},'Operating source edition saved.');
    if(result){state.draft.build={...values,name:'',asOf:localInput(new Date().toISOString())};state.requests=null;state.edition=null;await retainDrafts();await refreshDetail();render();}
  }
  async function submitLink(form){
    const r=requestRecord(),d=selectedLinkDraft(),order=knownOrders().find(o=>o.key===d.orderKey),values=formValues(form);
    if(!r||!order)throw new Error('Select an original work order for the relationship decision.');
    const selection={editionId:state.detailEditionId,key:r.key,sourceSha256:r.sourceSha256,orderKey:order.key,orderSha256:order.sourceSha256,decision:values.decision,reviewer:String(values.reviewer||'').trim(),note:values.note||''};
    if(!selection.reviewer)throw new Error('Enter the person reviewing this relationship.');
    const result=await mutate('/api/link',{selection},'Relationship decision saved.');
    if(result){state.draft.link={context:requestContext(),reviewer:selection.reviewer,decision:'confirm',note:''};await retainDrafts();await refreshOpenRequest();}
  }
  async function submitWork(form){
    const r=requestRecord();if(!r)throw new Error('Open the original service request first.');
    retainWorkDraft(form);const d=currentWorkDraft(),work={
      editionId:state.detailEditionId,key:r.key,sourceSha256:r.sourceSha256,status:d.status,assignee:String(d.assignee||'').trim(),priority:d.priority,
      dueAt:toIso(d.dueAt,'Work due time'),note:d.note||'',action:d.action,actionNote:d.actionNote||'',targetOrderKeys:list(d.targetOrderKeys),
      approval:d.approval,reviewer:String(d.reviewer||'').trim(),
      location:{mode:d.locationMode||'source',name:d.locationName||'',longitude:d.locationMode==='manual'&&d.longitude!==''?Number(d.longitude):null,latitude:d.locationMode==='manual'&&d.latitude!==''?Number(d.latitude):null,sourceReferences:parseJson(d.sourceReferences||'[]','Location source references','array')}
    };
    if(['approved','rejected'].includes(work.approval)&&!work.reviewer)throw new Error('Enter the person reviewing this action.');
    if(work.location.mode==='manual'&&(!Number.isFinite(work.location.longitude)||!Number.isFinite(work.location.latitude)))throw new Error('Give the reviewed manual location a valid longitude and latitude.');
    const context=requestContext(),result=await mutate('/api/work',{work},'Assigned work and review decision saved.');
    if(result){if(state.draft.work.records)delete state.draft.work.records[context];await retainDrafts();await refreshOpenRequest();}
  }
  async function submitReviewImport(){
    const d=state.draft.review;if(typeof d.originalText!=='string')throw new Error('Choose the complete returned review file first.');
    const result=await mutate('/api/review-import',{originalText:d.originalText},'Returned review saved for selected decisions.');
    if(result){delete d.originalText;delete d.filename;delete d.bytes;await retainDrafts();await refreshDetail();render();}
  }
  async function submitReviewApply(form){
    const values=formValues(form),pending=reviewable(),accept=pending.filter(p=>state.reviewChoices.get(p.id)==='accept').map(p=>p.id),reject=pending.filter(p=>state.reviewChoices.get(p.id)==='reject').map(p=>p.id);
    if(!accept.length&&!reject.length)throw new Error('Select at least one returned proposal to accept or reject.');
    const selection={returnId:state.returnId,targetEditionId:reviewTargetId(),accept,reject,reviewer:String(values.reviewer||'').trim(),note:values.note||''};
    if(!selection.targetEditionId||!selection.reviewer)throw new Error('Choose the target source edition and reviewing person.');
    const result=await mutate('/api/review-apply',{selection},'Selected review decisions applied.');
    if(result){for(const id of [...accept,...reject])state.reviewChoices.delete(id);await retainReviewChoices();await refreshDetail();render();}
  }
  async function submitDispatch(form){
    const values=formValues(form),workIds=[...state.selectedWork];
    if(!workIds.length)throw new Error('Choose at least one approved action in this source edition.');
    const definition={name:String(values.name||'').trim(),editionId:state.editionId,workIds,columns:parseJson(values.columns||'[]','Destination columns','array'),note:values.note||''};
    if(!definition.name)throw new Error('Give this dispatch package a name.');
    const result=await mutate('/api/dispatch',{definition},'Selected approved actions saved as a dispatch package.');
    if(result){state.selectedWork.clear();state.draft.dispatch={...state.draft.dispatch,...values,name:''};await retainDispatchSelection();await refreshDetail();render();}
  }
  async function submitReceiving(){
    if(typeof state.draft.receiving.originalText!=='string')throw new Error('Choose the complete workspace handover first.');
    const result=await mutate('/api/receive',{originalText:state.draft.receiving.originalText},'Complete handover opened in this workspace.');
    if(result){state.draft.receiving={};await retainDrafts();await navigate('overview');history.replaceState(null,'','#overview');}
  }
  async function selectAllApproved(){
    if(state.selectingApproved)return;
    const editionId=state.editionId,revision=state.workspace.revision,ids=new Set();state.selectingApproved=true;
    try{
      let offset=0;
      while(true){
        const page=await api(apiUrl('/api/work-queue',{editionId,approval:'approved',offset,limit:state.limit}));
        for(const w of list(page.items))if(w.approval==='approved'&&w.action!=='none'&&w.approvalCurrent!==false&&!w.sourceChanged&&!w.orderChanged)ids.add(w.id);
        offset+=list(page.items).length;
        if(offset>=Number(page.total||0))break;
        if(!list(page.items).length)throw new Error('The approved-work page returned before its complete selection. Refresh the queue and try again.');
        notice('Selecting approved actions: '+count(offset)+' of '+count(page.total),true);
      }
      await refreshWorkspace();
      if(state.workspace.revision!==revision||state.editionId!==editionId)throw new Error('The workspace changed while the complete approved selection was being read. Refresh the selected edition and choose the actions again.');
      state.selectedWork=ids;await retainDispatchSelection();render();notice(count(ids.size)+' approved actions selected.');
    }finally{state.selectingApproved=false;}
  }
  async function go(view){history.replaceState(null,'','#'+view);await navigate(view);}
  async function retainDispatchSelection(){state.draft.dispatch.selections={...(state.draft.dispatch.selections||{}),[state.editionId]:[...state.selectedWork]};await retainDrafts();}
  async function chooseEdition(id){state.editionId=id;state.edition=null;state.requests=null;state.changes=null;state.offset=0;state.changesOffset=0;state.approvedOffset=0;state.approvedWorkPage=null;state.selected.clear();state.selectedWork=new Set(state.draft.dispatch.selections?.[id]||[]);await refreshDetail();render();}
  async function handleAction(buttonElement){
    const a=buttonElement.dataset.action,d=buttonElement.dataset;
    if(a==='recover')return recoverPending();
    if(a==='replay')return recoverPending(true);
    if(a==='export')return download(d.kind,{sourceId:d.sourceId,editionId:d.editionId,dispatchId:d.dispatchId});
    if(a==='open-edition'){await chooseEdition(d.id);return go('requests');}
    if(a==='request-detail')return openRequest(d.key,d.editionId||state.editionId);
    if(a==='open-work'){state.workId=d.id;state.work=null;return go('work');}
    if(a==='inspect-source')return inspectSource();
    if(a==='source-profile'){const source=sourceSummary(d.id);if(source?.role==='orders')state.draft.profile.orderSourceId=d.id;else state.draft.profile.requestSourceId=d.id;await retainDrafts();return go('profiles');}
    if(a==='original-detail'){const row=list(state.sourceRows?.items)[Number(d.index)];return showDetail('Original source fields and coordinates',details('Complete original fields',sourceAttributes(row))+details('Source record and coordinate declaration',row));}
    if(a==='operation-detail'){const value=await api(apiUrl('/api/operation',{requestId:d.requestId}));return showDetail('Saved workspace action',details('Complete saved action',value));}
    if(a==='change-detail'){const value=list(state.changes?.items)[Number(d.index)];return showDetail(state.changeEntity==='orders'?'Original work-order comparison':'Original request comparison','<div class="equal-split"><section><h3>Earlier source edition</h3><pre>'+esc(pretty(value?.before))+'</pre></section><section><h3>Later source edition</h3><pre>'+esc(pretty(value?.after))+'</pre></section></div>'+details('Complete source changes and work context',value));}
    if(a==='dispatch-row-detail'){const row=dispatchRows(state.dispatch)[Number(d.index)];return showDetail('Complete dispatch row',details('Saved dispatch values',row));}
    if(a==='new-profile'){state.profileKey='';state.profile=null;state.draft.profile={requestSourceId:state.draft.profile.requestSourceId,orderSourceId:state.draft.profile.orderSourceId,value:blankProfile()};await retainDrafts();render();return;}
    if(a==='edit-profile'){const p=JSON.parse(JSON.stringify(state.profile?.profile||state.profile||editorProfile()));p.revision=Math.max(Number(p.revision||0),...list(state.workspace.profiles).filter(x=>x.id===p.id).map(x=>Number(x.revision||0)))+1;state.draft.profile={requestSourceId:state.draft.profile.requestSourceId,orderSourceId:state.draft.profile.orderSourceId,value:p};await retainDrafts();render();return;}
    if(a==='reset-profile-draft'){state.draft.profile={requestSourceId:state.draft.profile.requestSourceId,orderSourceId:state.draft.profile.orderSourceId};await retainDrafts();render();return;}
    if(a==='clear-filters'){state.query='';state.discrepancy='';state.assignee='';state.workStatus='';state.offset=0;await refreshDetail();render();return;}
    if(a==='search-orders'){state.orderQuery=$('#order-query')?.value||'';state.orderOffset=0;return searchOrders();}
    if(a==='select-link-order'){const order=knownOrders().find(o=>o.key===d.orderKey);if(!order)throw new Error('Reopen the selected original order from its saved source edition.');if($('#work-form'))retainWorkDraft($('#work-form'));state.draft.link={...selectedLinkDraft(),orderKey:order.key,orderSha256:order.sourceSha256};await retainDrafts();renderRequestDialog();$('#link-form').scrollIntoView({block:'nearest'});return;}
    if(a==='order-detail'){const order=knownOrders().find(o=>o.key===d.orderKey);if(!order)return;const section=document.createElement('section');section.className='dialog-section';section.innerHTML='<h3>Original work order '+esc(human(order.workOrderId||order.key))+'</h3>'+details('Complete original order',order.original||order.source)+details('Interpreted order and source values',order);$('#detail-content').append(section);section.scrollIntoView({block:'nearest'});section.querySelector('details').open=true;return;}
    if(a==='reset-work-draft'){const context=requestContext();if(state.draft.work.records)delete state.draft.work.records[context];await retainDrafts();renderRequestDialog();return;}
    if(a==='clear-review-choices'){state.reviewChoices.clear();await retainReviewChoices();render();return;}
    if(a==='select-approved')return selectAllApproved();
    if(a==='clear-approved'){state.selectedWork.clear();await retainDispatchSelection();render();return;}
    const paging=/^(request|source|changes|order|dispatch-row|approved)-(previous|next)$/.exec(a);
    if(paging){const step=paging[2]==='next'?state.limit:-state.limit,key={request:'offset',source:'sourceOffset',changes:'changesOffset',order:'orderOffset','dispatch-row':'dispatchOffset',approved:'approvedOffset'}[paging[1]];state[key]=Math.max(0,(state[key]||0)+step);if(paging[1]==='order')return searchOrders();if(paging[1]!=='dispatch-row')await refreshDetail();render();}
  }
  const safely=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(showError);
  document.addEventListener('click',safely(async event=>{
    const action=event.target.closest('[data-action]');if(!action||action.disabled)return;event.preventDefault();await handleAction(action);
  }));
  document.addEventListener('submit',event=>{
    const supported=new Set(['source-form','profile-form','build-form','link-form','work-form','review-import-form','review-apply-form','dispatch-form','receiving-form']);
    if(!supported.has(event.target.id))return;event.preventDefault();
    safely(async event=>{
    const handlers={'source-form':submitSource,'profile-form':submitProfile,'build-form':submitBuild,'link-form':submitLink,'work-form':submitWork,'review-import-form':submitReviewImport,'review-apply-form':submitReviewApply,'dispatch-form':submitDispatch,'receiving-form':submitReceiving};
    const fn=handlers[event.target.id];if(state.busy)return;clearError();await fn(event.target);
    })(event);
  });
  document.addEventListener('input',safely(async event=>{
    const target=event.target,form=target.form;
    if(form?.id==='profile-form'){profileFormMemory(form);await retainDrafts();return;}
    if(form?.id==='work-form'){
      const reset=['assignee','priority','dueAt','action','actionNote','targetOrderKeys','locationMode','locationName','longitude','latitude','sourceReferences'].includes(target.name);
      if(reset&&form.elements.approval.value==='approved')form.elements.approval.value='draft';
      retainWorkDraft(form);await retainDrafts();return;
    }
    if(target.dataset.draft&&target.name){const kind=target.dataset.draft;state.draft[kind][target.name]=target.type==='checkbox'?target.checked:target.value;await retainDrafts();}
    const filters={'request-query':'query','discrepancy-filter':'discrepancy','assignee-filter':'assignee','work-assignee-filter':'assignee','source-query':'sourceQuery'};
    if(filters[target.id]){state[filters[target.id]]=target.value;if(target.id==='source-query')state.sourceOffset=0;else state.offset=0;clearTimeout(searchTimer);searchTimer=setTimeout(safely(async()=>{const focusId=target.id,start=target.selectionStart;await refreshDetail();render();const input=$('#'+focusId);if(input){input.focus({preventScroll:true});if(start!==null&&input.setSelectionRange)try{input.setSelectionRange(start,start);}catch{}}}),280);}
    if(target.id==='order-query')state.orderQuery=target.value;
  }));
  document.addEventListener('change',safely(async event=>{
    const target=event.target,id=target.id;
    const fileKinds={'source-file':'source','metadata-file':'metadata','review-file':'review','receiving-file':'receiving'};
    if(fileKinds[id])return loadOriginalFile(target,fileKinds[id]);
    if(target.dataset.proposal){state.reviewChoices.set(target.dataset.proposal,target.value);await retainReviewChoices();return;}
    if(target.dataset.selectWork){target.checked?state.selectedWork.add(target.dataset.selectWork):state.selectedWork.delete(target.dataset.selectWork);await retainDispatchSelection();render();return;}
    if(target.dataset.capture){const d=state.draft.source,captures=list(d.inspection?.availableCaptures),endpoint=captureEndpoint(captures.find(c=>c.id===target.dataset.capture));d.captureIds=$$('[data-capture]:checked').map(x=>x.dataset.capture);if(target.checked&&endpoint)d.captureIds=d.captureIds.filter(id=>captureEndpoint(captures.find(c=>c.id===id))===endpoint);await inspectSource();return;}
    if(id==='page-size'){const size=Number(target.value);if(![10,25,50,100,250].includes(size))return;state.limit=size;state.offset=0;state.sourceOffset=0;state.changesOffset=0;state.approvedOffset=0;state.dispatchOffset=0;state.orderOffset=0;await refreshDetail();render();return;}
    if(id==='source-selection'){state.sourceId=target.value;state.source=null;state.sourceRows=null;state.sourceOffset=0;state.sourceQuery='';await refreshDetail();render();return;}
    if(id==='profile-selection'){state.profileKey=target.value;state.profile=null;state.draft.profile={requestSourceId:state.draft.profile.requestSourceId,orderSourceId:state.draft.profile.orderSourceId};await retainDrafts();await refreshDetail();render();return;}
    if(id==='profile-request-source'||id==='profile-order-source'){profileFormMemory($('#profile-form'));state.draft.profile[id==='profile-request-source'?'requestSourceId':'orderSourceId']=target.value;await retainDrafts();await refreshDetail();render();return;}
    if(id==='profile-editor-mode'){
      const form=target.form,previous=state.draft.profile.editorMode||'basic';
      try{const p=readProfileForm(form,previous);state.draft.profile.value=p;state.draft.profile.editorMode=target.value;state.draft.profile.profileJson=pretty(p);delete state.draft.profile.formValues;await retainDrafts();render();}
      catch(error){target.value=previous;throw error;}return;
    }
    if(id==='edition-selection'||id==='change-after')return chooseEdition(target.value);
    if(id==='change-before'){state.beforeId=target.value;state.changes=null;state.changesOffset=0;await refreshDetail();render();return;}
    if(id==='change-entity'){state.changeEntity=target.value==='orders'?'orders':'requests';state.changes=null;state.changesOffset=0;await refreshDetail();render();return;}
    if(id==='work-status-filter'||id==='saved-work-status-filter'){state.workStatus=target.value;state.offset=0;await refreshDetail();render();return;}
    if(id==='return-selection'){state.returnId=target.value;state.returned=null;state.reviewChoices.clear();await refreshDetail();render();return;}
    if(id==='review-target-edition'){state.draft.review.targetEditionId=target.value;await retainDrafts();await refreshDetail();render();return;}
    if(id==='dispatch-selection'){state.dispatchId=target.value;state.dispatch=null;state.dispatchOffset=0;await refreshDetail();render();return;}
    if(id==='work-location-mode'){const form=target.form;form.elements.longitude.disabled=target.value!=='manual';form.elements.latitude.disabled=target.value!=='manual';retainWorkDraft(form);await retainDrafts();return;}
    if(target.name==='kind'&&target.dataset.draft==='source'){state.draft.source.inspection=null;if(state.draft.source.originalText!==undefined)await inspectSource();}
  }));
  $('#close-detail').addEventListener('click',()=>{if($('#work-form'))retainWorkDraft($('#work-form'));retainDrafts();$('#detail-dialog').close();});
  $('#detail-dialog').addEventListener('cancel',()=>{if($('#work-form'))retainWorkDraft($('#work-form'));retainDrafts();});
  $('#dismiss-error').addEventListener('click',clearError);
  $('#refresh-workspace').addEventListener('click',safely(async()=>{if($('#profile-form'))profileFormMemory($('#profile-form'));if($('#work-form'))retainWorkDraft($('#work-form'));await retainDrafts();await refreshWorkspace();await refreshDetail();render();await refreshOpenRequest();notice('The saved workspace is refreshed.');}));
  $('#download-workspace').addEventListener('click',safely(()=>download('workspace')));
  window.addEventListener('hashchange',safely(()=>navigate(location.hash.slice(1))));
  try{
    state.launch=await api('/api/launch');await refreshWorkspace();
    try{const [draft,pending]=await Promise.all([savedGet(storageKey('drafts')),savedGet(storageKey('pending'))]);if(draft)for(const kind of Object.keys(state.draft))state.draft[kind]={...state.draft[kind],...(draft[kind]||{})};if(pending)state.pending=pending;}catch{notice('Browser draft storage is unavailable. Saved workspace actions remain on this server.',true);}
    state.selectedWork=new Set(state.draft.dispatch.selections?.[state.editionId]||[]);await navigate(location.hash.slice(1)||'overview',false);if(state.pending)await recoverPending();
  }catch(error){showError(error);$('#main').innerHTML=empty('The workspace is not open yet','Refresh after the local workspace server is available.');$('#main').setAttribute('aria-busy','false');}
})();
