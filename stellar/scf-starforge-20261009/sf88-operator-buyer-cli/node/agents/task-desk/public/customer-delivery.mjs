// MIT. Customer delivery through the original saved InboxTask and native delivery model.
const views=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>esc(JSON.stringify(value,null,2));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function matching(result,pending){
 if(!result||!same(result.request,pending.request)||result.previewSha256!==pending.expectedPreviewSha256)
  throw Object.assign(new Error('This delivery ID retains another reviewed selection. Your original request remains saved; inspect both identities before choosing the existing history entry or a new delivery ID.'),
   {code:'DESK_DELIVERY_REQUEST_CHANGED',details:{submitted:pending,retained:result?{id:result.id,request:result.request,previewSha256:result.previewSha256}:null}});
}
const clone=value=>JSON.parse(JSON.stringify(value));
const missing=error=>['ENOENT','CUSTOMER_DELIVERY_NOT_FOUND'].includes(error?.code);
function database(){
 return new Promise((done,fail)=>{
  const request=indexedDB.open('inbox-task-customer-delivery.v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('pending');
  request.onsuccess=()=>done(request.result);request.onerror=()=>fail(request.error);
 });
}
async function pendingRead(key){
 const db=await database();
 try{return await new Promise((done,fail)=>{const tx=db.transaction('pending','readonly'),r=tx.objectStore('pending').get(key);r.onsuccess=()=>done(r.result??null);r.onerror=()=>fail(r.error);});}
 finally{db.close();}
}
async function pendingWrite(key,value,expected){
 const db=await database();
 try{await new Promise((done,fail)=>{
  const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),read=store.get(key);let issue;
  read.onsuccess=()=>{
   if(!same(read.result??null,expected??null)){issue=new Error('Another browser view changed the retained delivery. Refresh its original request.');tx.abort();return;}
   if(value===null)store.delete(key);else store.put(value,key);
  };
  tx.oncomplete=()=>done();tx.onabort=()=>fail(issue??tx.error??new Error('The reviewed request could not be retained.'));tx.onerror=()=>{};
 });}finally{db.close();}
}
async function archivedRead(key){
 const db=await database(),prefix=key+'|archived|';
 try{return await new Promise((done,fail)=>{
  const tx=db.transaction('pending','readonly'),r=tx.objectStore('pending').getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));
  r.onsuccess=()=>done(r.result);r.onerror=()=>fail(r.error);
 });}finally{db.close();}
}
async function archivePending(key,expected){
 const db=await database(),archived={archivedAt:new Date().toISOString(),reason:'Same delivery ID retains another reviewed selection',command:clone(expected)};
 try{await new Promise((done,fail)=>{
  const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),read=store.get(key);let issue;
  read.onsuccess=()=>{
   if(!same(read.result??null,expected)){issue=new Error('Another view changed this pending review. Refresh before choosing a new ID.');tx.abort();return;}
   store.add(archived,key+'|archived|'+archived.archivedAt+'-'+crypto.randomUUID());store.delete(key);
  };
  tx.oncomplete=()=>done();tx.onabort=()=>fail(issue??tx.error??new Error('The original review could not be archived.'));tx.onerror=()=>{};
 });return archived;}finally{db.close();}
}
function field(label,name,value,{required=false,help='',multiline=false}={}){
 return '<label class="field"><span>'+esc(label)+'</span>'+
  (multiline?'<textarea rows="3" name="'+name+'">'+esc(value)+'</textarea>':'<input name="'+name+'" value="'+esc(value)+'"'+(required?' required':'')+'>')+
  (help?'<span class="field-help">'+esc(help)+'</span>':'')+'</label>';
}
export function mountCustomerDelivery(root,{client,taskId,detail,status}){
 if(!root)return;
 const directory=status?.roots?.customerDelivery;
 if(!directory){
  root.innerHTML='<section class="panel"><h2>Customer delivery</h2><p>Open this task desk with <code>--delivery /absolute/private/customer-deliveries</code>, or select Reviewed customer deliveries in Applications. Keep that store separate from the Inbox, task and response roots.</p><p>The same original task packet, complete executing source and named delivery history will remain available here.</p></section>';
  return;
 }
 const key=JSON.stringify([directory,detail.record.taskSha256]),title=detail.record.manifest.task.title;
 let m=views.get(key);
 if(!m){m={key,taskId,epoch:0,loaded:false,busy:false,loading:false,error:null,notice:'',inspection:null,history:null,preview:null,pending:null,opened:null,canForget:false,conflict:false,archived:[],
  input:{id:'task-'+detail.record.taskSha256.slice(0,16)+'-delivery-1',title,note:'',sourceRoot:'',sourceManifest:'',intentIds:[]}};views.set(key,m);}
 const instance={};m.mount=instance;
 const live=()=>root.isConnected&&m.mount===instance;
 const draw=()=>{
  if(!live())return;
  root.innerHTML='<section class="panel"><div class="section-heading"><div><h2>Complete customer delivery</h2><p>Review this task’s saved responses and complete application source, then prepare one named package.</p></div><button class="button" data-customer="refresh"'+(m.loading||m.busy?' disabled':'')+'>Refresh saved deliveries</button></div>'+
   '<p class="field-help">Original delivery store: <code>'+esc(directory)+'</code></p>'+
   (m.error?'<div class="notice" role="alert"><strong>'+esc(m.error.code||'Delivery needs attention')+'</strong><p>'+esc(m.error.message)+'</p>'+(m.error.details?'<details><summary>Exact delivery identities</summary><pre>'+pretty(m.error.details)+'</pre></details>':'')+'</div>':'')+
   (m.notice?'<p role="status">'+esc(m.notice)+'</p>':'')+
   (m.loading?'<p role="status">Opening the original task packet and delivery history…</p>':'')+
   pendingMarkup()+
   '<form id="customer-delivery-form"><fieldset'+(m.busy||m.pending?' disabled':'')+'><legend>Reviewed selection</legend><div class="form-grid">'+
   field('Delivery ID','id',m.input.id,{required:true,help:'Retained native operation identity. Reuse this ID only for the same reviewed request.'})+
   field('Customer title','title',m.input.title,{required:true})+
   field('Delivery note','note',m.input.note,{multiline:true})+
   field('Complete executing source root','sourceRoot',m.input.sourceRoot,{required:true,help:'Absolute application or selected installation root. Keep private operating data outside it.'})+
   field('Original source manifest','sourceManifest',m.input.sourceManifest,{required:true,help:'Absolute manifest file outside the source root, in an existing private parent directory.'})+
   '</div><div class="button-row"><button type="button" class="button" data-customer="source">Create full source manifest</button><button type="submit" class="button primary"'+(!m.inspection?' disabled':'')+'>Preview complete delivery</button></div>'+
   '<p class="field-help">Creating a manifest inventories the complete executing source. Repeating it verifies the same bytes; choose a new manifest filename for a changed source edition.</p>'+
   '<h3>Original task responses</h3>'+intentsMarkup()+'</fieldset></form>'+previewMarkup()+openedMarkup()+'</section>'+historyMarkup();
 };
 m.draw=draw;
 function changed(){
  m.epoch++;m.preview=null;m.notice='';m.canForget=false;
  const f=root.querySelector('form');if(f){
   for(const name of ['id','title','note','sourceRoot','sourceManifest'])m.input[name]=f.elements[name].value;
   m.input.intentIds=[...f.querySelectorAll('[name="intentIds"]:checked')].map(x=>x.value);
  }
  const review=root.querySelector('[data-customer-preview]');if(review)review.remove();
 }
 function intentsMarkup(){
  if(!m.inspection)return '<p>Refresh this view after the task has a complete received packet. Saved customer deliveries remain available below.</p>';
  return '<div class="table-wrap"><table class="data-table"><thead><tr><th>Select / role</th><th>Original outcome</th><th>Later recovered read</th><th>Complete response</th></tr></thead><tbody>'+
   m.inspection.intents.map(item=>'<tr><td><label><input type="checkbox" name="intentIds" value="'+esc(item.intentId)+'"'+(m.input.intentIds.includes(item.intentId)?' checked':'')+'> '+esc(item.role)+'</label><div class="field-help">'+esc(item.intentId)+'</div></td><td>'+esc(item.nativeState)+'<br>'+esc(item.originalStatus??'Unknown')+'</td><td>'+esc(item.recoveredReadId??'None selected')+'</td><td>'+esc(item.bytes)+' bytes<details><summary>SHA-256</summary><code>'+esc(item.sha256)+'</code></details></td></tr>').join('')+'</tbody></table></div>';
 }
 function previewMarkup(){
  if(!m.preview)return '';
  const p=m.preview;
  return '<section data-customer-preview class="space-before-16"><h3>Review complete selection</h3><dl class="facts"><div><dt>Original task</dt><dd>'+esc(p.task.taskSha256)+'</dd></div><div><dt>Selected responses</dt><dd>'+p.jobs.length+'</dd></div><div><dt>Complete source</dt><dd>'+p.source.files+' files · '+p.source.bytes+' bytes</dd></div><div><dt>Preview SHA-256</dt><dd>'+esc(p.previewSha256)+'</dd></div></dl>'+
   '<details open><summary>Original outcomes, later recovery and response identities</summary><pre>'+pretty(p.jobs)+'</pre></details>'+
   '<details><summary>Exact native request and complete source selection</summary><pre>'+pretty(p)+'</pre></details>'+
   '<button class="button primary" type="button" data-customer="prepare"'+(m.busy?' disabled':'')+'>Prepare reviewed customer delivery</button></section>';
 }
 function pendingMarkup(){
  if(!m.pending)return '';
  return '<section class="notice"><h3>Retained original delivery: '+esc(m.pending.request.id)+'</h3><p>The complete reviewed request is saved before preparation. Reopen its native record to see whether it finished; continue using the same request and ID.</p>'+
   '<details><summary>Exact retained request</summary><pre>'+pretty(m.pending)+'</pre></details><div class="button-row">'+
   '<button class="button" data-customer="reopen"'+(m.busy?' disabled':'')+'>Open original delivery</button>'+
   '<button class="button" data-customer="continue"'+(m.busy?' disabled':'')+'>Continue original preparation once</button>'+
   (m.canForget?'<button class="button" data-customer="forget">Release unsaved review</button>':'')+
   (m.conflict?'<button class="button" data-customer="archive-conflict">Keep original review and choose a new delivery ID</button>':'')+'</div></section>';
 }
 function openedMarkup(){
  if(!m.opened)return '';
  const d=m.opened;
  return '<section class="space-before-16"><h3>'+esc(d.request.title)+' · '+esc(d.state)+'</h3>'+
   (d.package?'<p>'+esc(d.package.bytes)+' bytes · <code>'+esc(d.package.sha256)+'</code></p><a class="button primary" href="/api/tasks/'+encodeURIComponent(taskId)+'/customer-deliveries/named/'+encodeURIComponent(d.id)+'/download" download>Download complete customer package</a>':'<p>The original preparation is retained. Continue its exact saved request when its original source and response roots are available.</p><button class="button" data-customer="adopt-opened"'+(m.busy||m.pending?' disabled':'')+'>Continue this saved preparation</button>')+
   '<details><summary>Complete original delivery record</summary><pre>'+pretty(d)+'</pre></details></section>';
 }
 function historyMarkup(){
  const rows=m.history?.deliveries??[];
  return '<section class="panel"><h2>This task’s delivery history</h2><p>These entries come from the original native delivery store. Opening or downloading verifies the complete saved package.</p>'+
   (rows.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Delivery</th><th>State</th><th>Created</th><th>Complete package</th></tr></thead><tbody>'+rows.map(d=>'<tr><td><button class="row-button" data-customer="open-history" data-delivery="'+esc(d.id)+'">'+esc(d.title)+'</button><div class="field-help">'+esc(d.id)+'</div></td><td>'+esc(d.state)+'</td><td>'+esc(d.createdAt)+'</td><td>'+esc(d.package?.bytes??'Preparing')+(d.package?' bytes':'')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No named deliveries have been retained for this task.</p>')+
   (m.history?.issues?.length?'<details open><summary>Original history entries needing attention</summary><pre>'+pretty(m.history.issues)+'</pre></details>':'')+(m.archived.length?'<details><summary>Earlier reviewed requests retained in this browser</summary><pre>'+pretty(m.archived)+'</pre></details>':'')+'</section>';
 }
 async function refresh(){
  if(m.loading||m.busy)return;m.loading=true;m.error=null;m.draw();
  try{
   const results=await Promise.allSettled([client.inspectCustomerTask(taskId),client.listCustomerDeliveries(taskId),pendingRead(key),archivedRead(key)]);
   if(results[0].status==='fulfilled'){
    m.inspection=results[0].value;
    if(!m.loaded)m.input.intentIds=m.inspection.intents.map(x=>x.intentId);
   }else{m.inspection=null;m.error=results[0].reason;}
   if(results[1].status==='fulfilled')m.history=results[1].value;else m.error=results[1].reason;
   if(results[2].status==='fulfilled')m.pending=results[2].value;else m.error=results[2].reason;
   if(results[3].status==='fulfilled')m.archived=results[3].value;else m.error=results[3].reason;
   m.loaded=true;
  }finally{m.loading=false;m.draw();}
 }
 async function reconcile(){
  try{
   const result=await client.getCustomerDelivery(taskId,m.pending.request.id);
   try{matching(result,m.pending);}catch(error){m.conflict=true;throw error;}
   m.conflict=false;m.opened=result;m.canForget=false;
   if(result.state==='COMPLETE'){
    const old=m.pending;await pendingWrite(key,null,old);m.pending=null;
    m.notice='The original complete customer package is ready.';
   }
  }catch(error){
   if(missing(error)){m.canForget=true;m.notice='No original preparation has been retained under this ID. Continue the saved review once, or release this unsaved review.';}
   else throw error;
  }
 }
 async function prepare(value){
  m.busy=true;m.error=null;m.notice='Preparing the complete original delivery…';m.draw();
  try{
   const result=await client.prepareCustomerDelivery(taskId,value);matching(result,value);m.opened=result;
   if(result.state==='COMPLETE'){await pendingWrite(key,null,value);m.pending=null;m.preview=null;m.notice='The complete customer package is saved.';}
  }catch(error){
   m.error=error;
   try{await reconcile();}catch(reopenError){m.notice='Keep the original request and delivery ID. Reopening also needs attention: '+reopenError.message;}
  }finally{
   m.busy=false;
   try{m.history=await client.listCustomerDeliveries(taskId);}catch(error){m.error??=error;}
   m.draw();
  }
 }
 root.oninput=event=>{if(event.target.closest('form'))changed();};
 root.onchange=event=>{if(event.target.closest('form'))changed();};
 root.onsubmit=async event=>{
  event.preventDefault();if(m.busy||m.pending)return;changed();
  const selection=clone(m.input),epoch=m.epoch;m.error=null;m.notice='Verifying complete source and selected original responses…';m.draw();
  try{
   const value=await client.previewCustomerDelivery(taskId,selection);
   if(epoch!==m.epoch)return;m.preview=value;m.notice='Review the exact native outcomes and source identity before preparation.';
  }catch(error){if(epoch===m.epoch)m.error=error;}
  finally{if(epoch===m.epoch)m.draw();}
 };
 root.onclick=async event=>{
  const button=event.target.closest('[data-customer]');if(!button||button.disabled||m.busy)return;
  const action=button.dataset.customer;
  try{
   if(action==='refresh'){await refresh();return;}
   if(action==='source'){
    changed();const epoch=m.epoch,input=clone(m.input);m.notice='Inventorying the complete executing source…';m.draw();
    const value=await client.createCustomerSourceManifest({sourceRoot:input.sourceRoot,destination:input.sourceManifest});
    if(epoch===m.epoch){m.notice='Complete source manifest saved: '+value.files.length+' files, '+value.bytes+' bytes, SHA-256 '+value.sha256;m.draw();}return;
   }
   if(action==='prepare'){
    if(!m.preview||m.pending)return;
    const value={request:clone(m.preview.request),expectedPreviewSha256:m.preview.previewSha256};
    await pendingWrite(key,value,null);m.pending=value;await prepare(value);return;
   }
   if(action==='continue'){if(m.pending)await prepare(clone(m.pending));return;}
   if(action==='reopen'){m.busy=true;m.draw();try{await reconcile();}finally{m.busy=false;m.draw();}return;}
   if(action==='archive-conflict'){
    if(!m.conflict||!m.pending)return;
    const original=clone(m.pending),retained=await client.getCustomerDelivery(taskId,original.request.id);
    if(same(retained.request,original.request)&&retained.previewSha256===original.expectedPreviewSha256)
     throw new Error('This ID now matches the original review. Reopen its retained preparation.');
    const archived=await archivePending(key,original);
    m.archived.push(archived);m.pending=null;m.conflict=false;m.canForget=false;m.preview=null;m.opened=null;m.epoch++;
    m.input={...m.input,...clone(original.request),id:original.request.id.slice(0,65)+'-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8)};
    m.error=null;m.notice='The original reviewed request is retained below. Review the new delivery ID and create a fresh preview before preparing.';
    m.draw();return;
   }
   if(action==='forget'){
    if(!m.canForget||!m.pending)return;
    const id=m.pending.request.id;
    try{await client.getCustomerDelivery(taskId,id);throw new Error('This original preparation now exists. Reopen and continue it.');}
    catch(error){if(!missing(error))throw error;}
    await pendingWrite(key,null,m.pending);m.pending=null;m.canForget=false;m.draw();return;
   }
   if(action==='open-history'){
    m.busy=true;m.draw();
    try{m.opened=await client.getCustomerDelivery(taskId,button.dataset.delivery);}
    finally{m.busy=false;m.draw();}return;
   }
   if(action==='adopt-opened'){
    if(!m.opened||m.pending)return;
    const value={request:clone(m.opened.request),expectedPreviewSha256:m.opened.previewSha256};
    await pendingWrite(key,value,null);m.pending=value;m.canForget=false;m.draw();return;
   }
  }catch(error){m.error=error;m.draw();}
 };
 draw();if(!m.loaded&&!m.loading)void refresh();
}
