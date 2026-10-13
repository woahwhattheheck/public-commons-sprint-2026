/** Original returned-review comparison and incorporation through the native queue. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const title=value=>value.title||value.filename||value.label||value.id;
const roles=[['baseline','Sent baseline','The complete native edition that was sent for review.'],['returned','Returned review','The reviewer’s complete returned native edition.'],['current','Current scientist','The current complete edition, including independent scientist changes.']];
const archiveKey=row=>row?row.kind+':'+row.id:'';
const options=(rows,value,empty)=>'<option value="">'+esc(empty)+'</option>'+rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===value?' selected':'')+'>'+esc(title(row))+'</option>').join('');
const amount=value=>Number.isFinite(value)?value.toLocaleString():'—';

export function mountReturnedReviews(root,host,{memory=new Map(),openLargeFiles=()=>{}}={}){
 const workspace=host.getWorkspace(),person=JSON.stringify(host.getState?.()?.person??null),abort=new AbortController();
 const memoryKey=person+':'+workspace,state=copy(memory.get(memoryKey)||{title:'Returned measurement reviews',archives:{},planId:'',resultId:'',lastRequest:''});
 let dead=false,busy=false,loaded=false,generation=0,catalog={archives:[],plans:[],results:[]},plan=null,result=null,decisions=null;
 const active=()=>!dead&&host.getWorkspace()===workspace&&JSON.stringify(host.getState?.()?.person??null)===person;
 const requireActive=()=>{if(!active())throw Error('Reopen the original Measurements workspace before continuing.');};
 const save=()=>memory.set(memoryKey,copy(state));
 const q=s=>root.querySelector(s);
 const read=async(operation,payload={})=>{requireActive();const value=await host.api('/api/measurement-returned-reviews/'+operation,{method:'POST',body:{...payload,workspace}});requireActive();return value;};
 root.classList.add('mrr');
 root.innerHTML='<details data-panel><summary>Incorporate returned measurement reviews</summary><p>Compare the edition sent for review, the returned work and the scientist’s current edition. Review overlapping changes in the original decision desk, then create a separate editable result.</p>'+
 '<p class="mrr-notice">Original measurement values, qualifiers, source editions and independent scientist decisions remain identifiable. Incorporation does not replace any of the three selected projects.</p>'+
 '<p role="status" aria-live="polite">Open this panel to read complete saved archives and earlier comparisons.</p>'+
 '<div class="mrr-actions"><button type="button" data-refresh>Refresh saved work</button><button type="button" data-retry hidden>Continue original request</button><button type="button" data-task hidden>Open original task</button></div>'+
 '<p>To add an archive, use <strong>Large originals and complete handover</strong>: choose <strong>Complete measured project ZIP</strong> and <strong>Receive original and preview</strong>. A complete upload is ready here before receiving it into a live workspace. Then refresh this saved list.</p><button type="button" data-large>Open original large-file intake</button>'+
 '<div data-archive-issues></div>'+
 '<form data-plan-form><h3>1. Choose the three complete editions</h3><label>Comparison title<input name="title" required maxlength="200"></label><div class="mrr-grid">'+
 roles.map(([key,label,help])=>'<fieldset><legend>'+label+'</legend><p>'+help+'</p><label>Saved native archive<select data-archive="'+key+'"></select></label><p class="mrr-small" data-archive-detail="'+key+'"></p></fieldset>').join('')+
 '</div><button type="submit">Prepare returned-review comparison</button></form>'+
 '<h3>2. Review and reopen a saved comparison</h3><div class="mrr-actions"><label>Saved comparison<select data-plans></select></label><button type="button" data-open-plan>Open comparison</button></div><div data-plan></div>'+
 '<form data-apply-form hidden><h3>3. Incorporate the explicit saved decisions</h3><p>Extract the complete comparison ZIP, open its original <strong>review.html</strong>, choose each overlapping change and save the decision JSON. Open that exact file here.</p><label>Saved decisions for this comparison<input type="file" accept=".json,application/json" data-decisions></label><div data-decision-review></div><button type="submit" disabled>Create independent reviewed project</button></form>'+
 '<h3>Independent reviewed projects</h3><div class="mrr-actions"><label>Saved incorporation<select data-results></select></label><button type="button" data-open-result>Open result</button></div><div data-result></div></details>';
 const panel=q('[data-panel]'),status=q('[role=status]'),titleInput=q('[name=title]');
 titleInput.value=state.title;
 function message(text,error=false){if(active()){status.textContent=text;status.dataset.error=String(error);}}
 function controls(){
  for(const control of root.querySelectorAll('button,input,select'))control.disabled=busy;
  q('[data-apply-form] button').disabled=busy||!decisions;
  if(currentTask)q('[data-task]').disabled=false;
 }
 async function work(fn){if(busy||!active())return;busy=true;root.setAttribute('aria-busy','true');controls();try{await fn();}catch(error){message(error.message,true);}finally{busy=false;if(active()){root.setAttribute('aria-busy','false');controls();}}}
 function links(record){
  const downloads=record?._downloads||[];
  return downloads.length?'<div class="mrr-actions">'+downloads.map(file=>'<a href="'+esc(file.url+(file.url.includes('?')?'&':'?')+'download=1')+'" download="'+esc(file.filename||'')+'">'+esc(file.label||file.filename||'Original file')+'</a>').join('')+'</div>':'<p class="mrr-small">Reopen this saved record to load its original download links.</p>';
 }
 function archiveDetails(role){
  const chosen=state.archives[role],record=(catalog.archives||[]).find(row=>archiveKey(row)===archiveKey(chosen));
  q('[data-archive-detail="'+role+'"]').textContent=record?(record.filename||title(record))+' · '+amount(record.bytes)+' bytes'+(record.revision!==undefined?' · source revision '+record.revision:''):'No complete archive selected.';
 }
 function paintCatalog(){
  for(const [role]of roles){q('[data-archive="'+role+'"]').innerHTML=options((catalog.archives||[]).map(row=>({...row,id:archiveKey(row)})),archiveKey(state.archives[role]),'Choose a saved complete archive');archiveDetails(role);}
  q('[data-plans]').innerHTML=options(catalog.plans||[],state.planId,'Choose a saved comparison');
  q('[data-results]').innerHTML=options(catalog.results||[],state.resultId,'Choose an independent reviewed project');
  const issues=catalog.archive_issues||[];q('[data-archive-issues]').innerHTML=issues.length?'<p class="mrr-notice">Some original archives are unavailable and have not been offered as choices.</p><details><summary>Original archive issues</summary><ul>'+issues.map(row=>'<li>'+esc(row.kind)+' '+esc(row.id)+': '+esc(row.message)+'</li>').join('')+'</ul></details>':'';
 }
 async function loadCatalog(){const value=await read('catalog');catalog=value;paintCatalog();loaded=true;save();}
 function paintPlan(){
  q('[data-apply-form]').hidden=!plan;
  if(!plan){q('[data-plan]').replaceChildren();return;}
  const native=plan,counts=native.counts||{},inventory=native.inventory||{};
  q('[data-plan]').innerHTML='<h3>'+esc(native.title||plan.title||'Saved returned-review comparison')+'</h3>'+
   '<div class="mrr-facts">'+[['Current measurements',inventory.current?.recordCount],['Ready to incorporate',counts['apply-return']],['Overlapping changes',counts.conflict],['Already current',counts['already-current']],['Need source or review',counts['source-needed']]].map(([label,value])=>'<div><strong>'+amount(value)+'</strong>'+label+'</div>').join('')+'</div>'+
   '<p>Use the complete comparison package to keep the original review desk, its three input archives, complete changes and decision template together. In the extracted package, open <strong>review.html</strong>.</p>'+links(plan)+
   '<details><summary>Original edition identities</summary><pre>'+esc(JSON.stringify({id:native.id,native_plan_id:native.native_plan_id,sourceRevisions:native.sourceRevisions,inputs:native.inputs},null,2))+'</pre></details>';
 }
 function paintResult(){
  if(!result){q('[data-result]').replaceChildren();return;}
  const native=result;
  q('[data-result]').innerHTML='<h3>'+esc(result.title||'Independent reviewed Measurements project')+'</h3><div class="mrr-facts">'+
   [['Original measurements',native.recordCount],['Incorporated groups',native.adoptedGroups],['Kept current',native.retainedGroups],['Native review actions',native.actionCount]].map(([label,value])=>'<div><strong>'+amount(value)+'</strong>'+label+'</div>').join('')+'</div>'+
   '<p>The complete editable <strong>project.zip</strong> reopens through the existing Measurements large-file receiving flow into an empty receiving project. The selected live workspaces remain unchanged.</p>'+links(result)+
   '<details><summary>Original incorporation and revision identities</summary><pre>'+esc(JSON.stringify({id:result.id,planId:native.planId,operationId:native.operationId,sourceRevisions:native.sourceRevisions,resultRevision:native.resultRevision,editionId:native.editionId},null,2))+'</pre></details>';
 }
 async function openPlan(id){
  if(!id)throw Error('Choose a saved comparison.');
  const value=await read('inspect',{kind:'plan',id});
  if(value.record?.id!==id||value.record.kind!=='plan'||!value.record.native_plan_id)throw Error('The saved comparison identity is incomplete.');
  plan={...value.record,_downloads:value.downloads||[]};state.planId=id;q('[data-plans]').value=id;decisions=null;q('[data-decisions]').value='';q('[data-decision-review]').replaceChildren();paintPlan();controls();save();
 }
 async function openResult(id){if(!id)throw Error('Choose an independent reviewed project.');const value=await read('inspect',{kind:'result',id});if(value.record?.id!==id||value.record.kind!=='result')throw Error('The saved incorporation identity differs.');result={...value.record,_downloads:value.downloads||[]};state.resultId=id;q('[data-results]').value=id;paintResult();save();}
 async function upload(file){
  requireActive();const result=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});requireActive();
  if(!result.id||!result.sha256||result.bytes!==file.size)throw Error('The retained upload differs from the selected complete file.');
  return {upload_id:result.id,filename:result.filename||file.name,bytes:result.bytes,sha256:result.sha256};
 }
 const ledgerPrefix='upstate-measurement-returned-review:';
 function readEntry(key){try{const value=localStorage.getItem(key);return value?JSON.parse(value):null;}catch{throw Error('The original request journal cannot be read. Reopen its native task before submitting again.');}}
 function writeEntry(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{throw Error('The browser cannot retain this native request. Enable its local storage before submitting.');}}
 let currentTask='';
 async function pointerKey(){const key=ledgerPrefix+'latest:'+await sha(canonical({person,workspace}));requireActive();return key;}
 async function recoverPointer(){const key=await pointerKey();if(!state.lastRequest){const retained=readEntry(key);if(retained?.key)state.lastRequest=retained.key;}q('[data-retry]').hidden=!state.lastRequest;save();}
 function taskNotice(task){if(!active())return;currentTask=task.id;q('[data-task]').hidden=false;q('[data-task]').disabled=false;message('Original native request: '+task.state+'.');}
 async function validateEntry(entry,key){
  const request=entry?.request;
  if(!request||request.workspace!==workspace||!['measurements.returned-review.plan','measurements.returned-review.apply'].includes(request.action)||typeof request.operation_id!=='string'||!request.operation_id||!request.payload||typeof request.payload!=='object'||Array.isArray(request.payload))throw Error('The retained request is not an original returned-review operation in this workspace.');
  const original={...request};delete original.operation_id;
  if(key!==ledgerPrefix+await sha(canonical({person,request:original})))throw Error('The retained request belongs to another selection or signed-in person.');
  requireActive();
 }
 async function observeTask(entry,key,allowResume){
  await validateEntry(entry,key);
  let task=entry.task_id?await host.api('/api/task?id='+encodeURIComponent(entry.task_id)):await host.api('/api/actions',{method:'POST',body:entry.request});
  const validate=()=>{if(!task?.id||task.workspace!==workspace||task.action!==entry.request.action||canonical(task.payload)!==canonical(entry.request.payload)||(entry.task_id&&task.id!==entry.task_id))throw Error('The retained native task does not match this exact original request.');};
  validate();entry.task_id=task.id;entry.state=task.state;writeEntry(key,entry);
  if(!active())return;
  if(['failed','interrupted','cancelled'].includes(task.state)&&allowResume){
   task=await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});validate();entry.state=task.state;writeEntry(key,entry);
  }
  while(active()&&['queued','running'].includes(task.state)){taskNotice(task);await wait(700);if(!active())return;task=await host.api('/api/task?id='+encodeURIComponent(task.id));validate();entry.state=task.state;writeEntry(key,entry);}
  if(!active())return;taskNotice(task);
  if(task.state!=='complete')throw Error(task.error?.message||'The original task is '+task.state+'. Continue that same request or inspect it in the native task view.');
  task=await host.api('/api/task?id='+encodeURIComponent(task.id));validate();requireActive();
  await loadCatalog();
  if(entry.request.action==='measurements.returned-review.plan')await openPlan(task.result.id);
  else await openResult(task.result.id);
  message('Original request completed. The saved result and complete downloads are ready.');
 }
 async function queue(action,payload){
  const request={workspace,action,payload};requireActive();const hash=await sha(canonical({person,request}));requireActive();
  const key=ledgerPrefix+hash;let entry=readEntry(key);
  if(entry){const original={...entry.request};delete original.operation_id;if(canonical(original)!==canonical(request)||!entry.request.operation_id)throw Error('The saved request identity differs from this selection.');}
  if(!entry){entry={request:{...request,operation_id:'measurement-return-'+crypto.randomUUID()},prepared_at:new Date().toISOString()};writeEntry(key,entry);}
  writeEntry(await pointerKey(),{key});requireActive();state.lastRequest=key;save();q('[data-retry]').hidden=false;await observeTask(entry,key,true);
 }
 titleInput.addEventListener('input',()=>{generation++;state.title=titleInput.value;save();},{signal:abort.signal});
 for(const [role]of roles){
  q('[data-archive="'+role+'"]').addEventListener('change',event=>{generation++;const selected=(catalog.archives||[]).find(row=>archiveKey(row)===event.target.value);state.archives[role]=selected?{kind:selected.kind,id:selected.id,bytes:selected.bytes,sha256:selected.sha256}:null;archiveDetails(role);save();},{signal:abort.signal});
 }
 q('[data-large]').addEventListener('click',()=>{if(active())openLargeFiles();},{signal:abort.signal});
 q('[data-plan-form]').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  const value={title:titleInput.value.trim()};if(!value.title)throw Error('Enter a comparison title.');
  for(const [role]of roles){const chosen=state.archives[role],record=(catalog.archives||[]).find(row=>archiveKey(row)===archiveKey(chosen));if(!record||!['edition','intake'].includes(record.kind)||!Number.isSafeInteger(record.bytes)||record.bytes<=0||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Choose a complete verified '+role+' archive from the current catalog.');if(chosen.sha256!==record.sha256||chosen.bytes!==record.bytes)throw Error('The selected '+role+' archive changed. Select its current retained edition explicitly.');value[role]={kind:record.kind,id:record.id,bytes:record.bytes,sha256:record.sha256};}
  await queue('measurements.returned-review.plan',value);
 });},{signal:abort.signal});
 q('[data-decisions]').addEventListener('change',event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;const version=++generation,planId=state.planId,nativePlanId=plan?.native_plan_id;
  work(async()=>{
   const value=JSON.parse(await file.text());if(!active()||version!==generation)return;
   if(value.format!=='upper-savannah-returned-review-decisions/v1'||value.planId!==nativePlanId||!Array.isArray(value.decisions)||!String(value.reviewer||'').trim()||!String(value.reason||'').trim())throw Error('Choose complete saved decisions for this exact comparison, with the incorporating reviewer and rationale.');
   const tokens=new Set();let useReturn=0,keepCurrent=0;
   for(const choice of value.decisions){const token=canonical([choice.kind,choice.key]);if(!['measurement','station'].includes(choice.kind)||typeof choice.key!=='string'||tokens.has(token)||!['current','return'].includes(choice.choice))throw Error('The file contains an incomplete, repeated or invalid decision. Finish the original review desk first.');tokens.add(token);if(choice.choice==='return')useReturn++;else keepCurrent++;}
   const retained=await upload(file);if(!active()||version!==generation||state.planId!==planId)return;
   decisions={...retained,plan_id:planId};q('[data-decision-review]').innerHTML='<p><strong>'+esc(retained.filename)+'</strong> · '+amount(retained.bytes)+' bytes</p><p><strong>'+esc(value.reviewer)+'</strong> · '+useReturn+' returned choices · '+keepCurrent+' kept current</p><p>'+esc(value.reason)+'</p><p class="mrr-small">The native engine verifies every original group and source constraint before incorporation.</p>';controls();message('Exact saved decision file retained. Review the choices, then create the separate result.');
  });
 },{signal:abort.signal});
 q('[data-apply-form]').addEventListener('submit',event=>{event.preventDefault();work(async()=>{if(!decisions||decisions.plan_id!==state.planId)throw Error('Open the saved decisions for the current comparison.');await queue('measurements.returned-review.apply',{plan_id:state.planId,decisions_upload_id:decisions.upload_id});});},{signal:abort.signal});
 q('[data-refresh]').addEventListener('click',()=>work(loadCatalog),{signal:abort.signal});
 q('[data-open-plan]').addEventListener('click',()=>work(()=>openPlan(q('[data-plans]').value)),{signal:abort.signal});
 q('[data-open-result]').addEventListener('click',()=>work(()=>openResult(q('[data-results]').value)),{signal:abort.signal});
 q('[data-task]').addEventListener('click',async()=>{if(active()&&currentTask){try{await host.showTask?.(currentTask);}catch(error){message(error.message,true);}}},{signal:abort.signal});
 q('[data-retry]').hidden=!state.lastRequest;
 q('[data-retry]').addEventListener('click',()=>work(async()=>{const entry=readEntry(state.lastRequest);if(!entry||entry.request?.workspace!==workspace)throw Error('The saved original request is unavailable. Inspect native tasks before submitting again.');await observeTask(entry,state.lastRequest,true);}),{signal:abort.signal});
 panel.addEventListener('toggle',()=>{if(panel.open&&!loaded)work(async()=>{await recoverPointer();await loadCatalog();if(state.planId)await openPlan(state.planId);if(state.resultId)await openResult(state.resultId);message('Original saved comparisons and independent results loaded.');});},{signal:abort.signal});
 return {destroy(){save();dead=true;generation++;abort.abort();root.replaceChildren();}};
}
