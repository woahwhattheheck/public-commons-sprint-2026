/** Complete joint-delivery allocations in the original operator; Customer reviews owns recipient decisions. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=()=>crypto.randomUUID();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const fields=['source_collection_ids','run_ids','delivery_ids','spatial_export_ids'];
const kinds={source_collection_ids:['sources','Original sources'],run_ids:['runs','Completed runs'],delivery_ids:['deliveries','Complete deliveries'],spatial_export_ids:['spatial_exports','Saved map exports']};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const knownActions=new Set(['joint-delivery.create','customer.review.export','customer.review.response.import']);
const finalStates=new Set(['failed','cancelled','interrupted']);
const keyPrefix='upstate.joint-delivery.copy.v1/';
const download=(body,name,type='application/json')=>{
 const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
};
const ownerOf=state=>canonical({id:state?.person?.id??null,name:state?.person?.name??null});
const scopeOf=state=>({workspace_key:state?.workspace_key,project_id:state?.data?.project?.id,owner:ownerOf(state)});
const button=(action,label,disabled=false,extra='')=>'<button type="button" data-jd-action="'+action+'"'+(disabled?' disabled':'')+' '+extra+'>'+esc(label)+'</button>';
const links=items=>(items||[]).map(item=>'<a href="'+esc(item.url)+(item.url.includes('?')?'&':'?')+'download=1" download="'+esc(item.filename)+'">'+esc(item.label||item.filename)+'</a>').join('');
function shapeWorking(value){
 if(!value||value.schema!=='upstate.joint-delivery-working/v1'||typeof value.id!=='string'||!value.scope||typeof value.scope.project_id!=='string'||!value.scope.project_id||!value.definition||!value.profile||!Array.isArray(value.history))throw Error('Open a complete joint-delivery working file.');
 const d=value.definition;
 if(d.schema!=='upstate.joint-delivery-definition/v1'||typeof d.title!=='string'||typeof d.notes!=='string'||!d.selection||!Array.isArray(d.allocations)||!Array.isArray(d.inputs))throw Error('The complete unfinished allocation and input register are required.');
 for(const field of fields)if(!Array.isArray(d.selection[field])||d.selection[field].some(k=>!hex(k))||new Set(d.selection[field]).size!==d.selection[field].length)throw Error('The working file has invalid original source identities.');
 const seen=new Set();
 for(const r of d.allocations){
  if(!r||typeof r.id!=='string'||seen.has(r.id)||['prime','engineering','receiving','milestone_id','target_date','note'].some(k=>typeof r[k]!=='string')||['input_ids','evidence_ids'].some(k=>!Array.isArray(r[k])||r[k].some(v=>typeof v!=='string')||new Set(r[k]).size!==r[k].length)||r.evidence_ids.some(v=>!hex(v)))throw Error('Retain every complete allocation row once.');
  if(['active_start_day','active_end_day','effort_hours'].some(k=>r[k]!==null&&(typeof r[k]!=='number'||!Number.isFinite(r[k]))))throw Error('Retain entered numeric values or an explicit unfilled value.');
  seen.add(r.id);
 }
 const inputs=new Set();
 for(const r of d.inputs){
  if(!r||typeof r.id!=='string'||inputs.has(r.id)||['title','needed','public_context','owner','status','decision'].some(k=>typeof r[k]!=='string')||!Array.isArray(r.evidence_ids)||r.evidence_ids.some(v=>!hex(v))||new Set(r.evidence_ids).size!==r.evidence_ids.length)throw Error('Retain every complete prime-input row once.');
  inputs.add(r.id);
 }
 if(d.allocations.some(r=>r.input_ids.some(id=>!inputs.has(id))))throw Error('An allocation names an input outside this working register.');
 const drafts=value.numericDrafts??{};
 if(!drafts||typeof drafts!=='object'||Array.isArray(drafts)||Object.entries(drafts).some(([key,raw])=>typeof raw!=='string'||!d.allocations.some(r=>['active_start_day','active_end_day','effort_hours'].some(field=>key===r.id+'/'+field))))throw Error('Retain unfinished numeric text only against its original allocation and field.');
 const p=value.pending;
 if(p&&Object.keys(drafts).length)throw Error('A frozen native request cannot include unresolved numeric text.');
 if(p){
  if(!p.request||!knownActions.has(p.request.action)||typeof p.request.operation_id!=='string'||!p.request.operation_id||p.request.workspace!==value.scope.workspace_key||!p.request.payload||!hex(p.request_sha256))throw Error('The retained original request is incomplete.');
  if(p.request.action==='joint-delivery.create'&&(!same(p.request.payload.definition,d)||!hex(p.request.payload.preview_sha256)))throw Error('The frozen original request differs from the complete authored definition.');
  if(p.request.action!=='joint-delivery.create'&&!hex(p.request.payload.review_id))throw Error('The retained review operation has no original review ID.');
 }
 return clone(value);
}
class JointDeliveryDesk{
 constructor(root,host){
  this.root=root;this.host=host;this.scope=scopeOf(host.getState());this.gone=false;this.generation=0;this.sequence=0;
  this.catalog=null;this.w=null;this.preview=null;this.detail=null;this.artifacts=[];this.selectedAllocation='';this.selectedInput='';this.editKind='allocation';this.search='';this.rowSearch='';
  this.busy=false;this.error='';this.notice='';this.backupText=null;this.copies=[];this.controller=new AbortController();
  root.classList.add('joint-delivery');
  root.addEventListener('click',event=>{const b=event.target.closest('[data-jd-action]');if(b&&root.contains(b)){event.preventDefault();void this.act(b).catch(error=>this.fail(error));}},{signal:this.controller.signal});
  root.addEventListener('input',event=>this.input(event),{signal:this.controller.signal});
  root.addEventListener('change',event=>{void this.change(event).catch(error=>this.fail(error));},{signal:this.controller.signal});
 }
 valid(){return !this.gone&&same(scopeOf(this.host.getState()),this.scope);}
 context(){return {scope:clone(this.scope),working:this.w,generation:this.generation};}
 current(c){return this.valid()&&c.generation===this.generation&&c.working===this.w;}
 require(c){if(!this.current(c))throw Error('The original joint delivery window or staff session changed. Its working copy is retained.');}
 fail(error){if(this.valid()){this.error=error?.message||String(error);this.render();}}
 frozen(){return this.busy||!!this.w?.pending;}
 text(w=this.w){return JSON.stringify(w,null,2)+'\n';}
 persist(w=this.w){localStorage.setItem(keyPrefix+w.id,this.text(w));}
 retain(w=this.w){
  try{this.persist(w);return true;}catch(error){
   if(this.backupText===this.text(w))return true;
   throw Error('Browser storage is unavailable. Download this complete working file, then retry the SAME action; its original request remains here.');
  }
 }
 outcome(w){
  try{this.persist(w);}catch{
   download(this.text(w),'Joint_Delivery_Original_Outcome_'+w.id+'.json');
   const box=document.getElementById('joint-delivery-detached-outcomes')||Object.assign(document.createElement('section'),{id:'joint-delivery-detached-outcomes'});
   box.style.cssText='background:#fff;color:#20252b;border:2px solid #575f68;padding:16px;position:relative';
   const p=document.createElement('p');p.textContent='Original joint delivery outcome retained in its complete downloaded working file. Keep that file for continuation.';
   const b=document.createElement('button');b.textContent='Download original outcome again';b.style.cssText='background:#e8ebee;color:#18222a;padding:8px';b.onclick=()=>download(this.text(w),'Joint_Delivery_Original_Outcome_'+w.id+'.json');
   box.append(p,b);if(!box.isConnected)document.body.append(box);
  }
 }
 saveEdit(){++this.sequence;this.preview=null;this.root.querySelector('[data-jd-preview]')?.remove();const save=this.root.querySelector('[data-jd-action="save"]');if(save)save.disabled=true;const preview=this.root.querySelector('[data-jd-action="preview"]');if(preview)preview.disabled=this.frozen()||this.unresolvedNumbers().length>0;const definition=this.root.querySelector('[data-jd-action="definition-download"]');if(definition)definition.disabled=true;this.w.updated_at=new Date().toISOString();try{this.persist();}catch{this.notice='Browser storage is unavailable. Download your complete working file before leaving.';}}
 newWorking(){
  return {schema:'upstate.joint-delivery-working/v1',id:uuid(),scope:clone(this.scope),updated_at:new Date().toISOString(),
   profile:clone(this.catalog.profile),definition:clone(this.catalog.draft),numericDrafts:{},pending:null,history:[],origin:null};
 }
 unresolvedNumbers(){return Object.keys(this.w?.numericDrafts||{});}
 requireNumbers(){if(this.unresolvedNumbers().length)throw Error('Correct or clear each unfinished numeric entry before preview or dispatch. Its exact text is retained in the complete working file.');}
 selectedRow(){return this.editKind==='input'?this.w?.definition.inputs.find(r=>r.id===this.selectedInput):this.w?.definition.allocations.find(r=>r.id===this.selectedAllocation);}
 allRows(){return [...this.w.definition.allocations,...this.w.definition.inputs];}
 initializeSelection(){this.selectedAllocation=this.w.definition.allocations[0]?.id||'';this.selectedInput=this.w.definition.inputs[0]?.id||'';this.editKind='allocation';this.search='';this.rowSearch='';}
 async read(path,args={}){return this.host.api(this.host.endpoint('/api/joint-delivery/'+path,args));}
 async post(path,payload){return this.host.api('/api/joint-delivery/'+path,{method:'POST',body:{workspace:this.scope.workspace_key,...payload}});}
 async start(){this.render();await this.refresh();this.listCopies();}
 async refresh(){
  const generation=++this.generation,data=await this.read('catalog');
  if(!this.valid()||generation!==this.generation)return;
  if(data.workspace_key!==this.scope.workspace_key||data.project.id!==this.scope.project_id)throw Error('The joint delivery catalogue belongs to another original project.');
  if(this.w&&!same(this.w.profile,data.profile))throw Error('The installed original source profile changed. Keep this complete working copy and use its source edition or explicitly start a new plan.');
  this.catalog=data;if(!this.w){this.w=this.newWorking();this.initializeSelection();try{this.persist();}catch{}}
  this.render();
 }
 listCopies(){
  const rows=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(keyPrefix)){try{const w=JSON.parse(localStorage.getItem(k));if(w?.scope?.project_id===this.scope.project_id)rows.push({id:w.id,title:w.definition?.title||'Untitled working copy',updated_at:w.updated_at,pending:!!w.pending});}catch{}}}}catch{}
  this.copies=rows.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));if(this.valid())this.render();
 }
 input(event){
  if(!this.valid()||!this.w)return;
  const field=event.target.dataset.jdField;if(!field)return;
  if(field==='search'){this.search=event.target.value;this.renderEvidence();return;}
  if(field==='row-search'){this.rowSearch=event.target.value;this.renderAllocationList();return;}
  if(this.frozen())return;
  if(field==='title'||field==='notes')this.w.definition[field]=event.target.value;
  const r=this.selectedRow();
  if(field.startsWith('allocation:')&&this.editKind==='allocation'&&r){
   const key=field.slice(11);if(['active_start_day','active_end_day','effort_hours'].includes(key)){
    const raw=event.target.value,token=r.id+'/'+key;
    this.w.numericDrafts??={};
    const decimal=/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
    if(raw!==''&&(!decimal.test(raw)||!Number.isFinite(Number(raw)))){
     this.w.numericDrafts[token]=raw;this.notice='Unfinished numeric text is retained exactly. Correct or clear it before preview or save.';this.saveEdit();return;
    }
    delete this.w.numericDrafts[token];r[key]=raw===''?null:Number(raw);
   }else r[key]=event.target.value;
  }
  if(field.startsWith('input:')&&this.editKind==='input'&&r)r[field.slice(6)]=event.target.value;
  this.saveEdit();
 }
 async change(event){
  if(!this.valid()||!this.w)return;const el=event.target;
  if(el.dataset.jdFile==='working'){const file=el.files?.[0];if(file)await this.openFile(file);el.value='';return;}
  if(el.dataset.jdFile==='response'){const file=el.files?.[0];if(file)await this.responseFile(file);el.value='';return;}
  if(this.frozen())return;
  if(el.dataset.jdSource){
   const values=new Set(this.w.definition.selection[el.dataset.jdSource]);el.checked?values.add(el.value):values.delete(el.value);
   this.w.definition.selection[el.dataset.jdSource]=[...values];this.artifacts=[];this.saveEdit();this.render();return;
  }
  if(el.dataset.jdInputDependency){
   const r=this.w.definition.allocations.find(x=>x.id===this.selectedAllocation);if(!r)return;
   const ids=new Set(r.input_ids);el.checked?ids.add(el.value):ids.delete(el.value);r.input_ids=[...ids];this.saveEdit();return;
  }
  if(el.dataset.jdEvidence){
   const r=this.selectedRow();if(!r)return;const ids=new Set(r.evidence_ids);
   el.checked?ids.add(el.dataset.jdEvidence):ids.delete(el.dataset.jdEvidence);r.evidence_ids=[...ids];this.saveEdit();return;
  }
  if(el.dataset.jdField?.startsWith('allocation:')||el.dataset.jdField?.startsWith('input:'))this.input(event);
 }
 async exclusive(operation){
  if(this.busy)throw Error('Finish the current original action first.');
  const c=this.context();this.busy=true;this.error='';this.render();
  try{return await operation(c);}finally{if(this.current(c)){this.busy=false;this.render();}}
 }
 async evidence(){
  if(this.w.pending)throw Error('Reconcile the original request first.');
  return this.exclusive(async c=>{
   const selection=clone(c.working.definition.selection),data=await this.post('evidence',{selection});this.require(c);
   if(data.workspace_key!==this.scope.workspace_key||data.project.id!==this.scope.project_id||!same(data.selection,selection))throw Error('The source inventory returned a different selection.');
   this.artifacts=data.artifacts;
   const actual=new Set(data.artifacts.map(r=>r.id)),missing=[...c.working.definition.allocations,...c.working.definition.inputs].flatMap(r=>r.evidence_ids.filter(id=>!actual.has(id)));
   this.notice=missing.length?'Earlier assignments are preserved but outside this source selection. Remove or reselect those exact files before saving.':'Exact original source inventory loaded.';
  });
 }
 async review(){
  this.requireNumbers();
  if(this.w.pending)throw Error('Reconcile the original request first.');
  return this.exclusive(async c=>{
   const definition=clone(c.working.definition),data=await this.post('preview',{definition});this.require(c);
   if(data.workspace_key!==this.scope.workspace_key||data.project.id!==this.scope.project_id||(!same(data.definition,definition)||!same(data.profile,c.working.profile)))throw Error('The preview differs from the authored definition or retained source profile.');
   this.preview=data;this.artifacts=data.artifacts;this.notice='This preview names actual selected files. Unfilled responsibility, effort, timing and prime inputs remain visible; this records no recipient or commercial acceptance.';
  });
 }
 async queue(action,payload){
  this.requireNumbers();
  if(this.frozen())throw Error('Reconcile the current original request first.');
  const c=this.context(),request={workspace:this.scope.workspace_key,action,payload:clone(payload),operation_id:'joint-delivery-'+uuid()};
  const sentDefinition=clone(c.working.definition);
  this.busy=true;this.render();
  try{
   const hash=await digest(request);this.require(c);
   if(!same(c.working.definition,sentDefinition))throw Error('The working definition changed before the original request was frozen.');
   c.working.pending={request,request_sha256:hash,task_id:null,state:'prepared',rejected:null};
   this.retain(c.working);
  }finally{if(this.current(c)){this.busy=false;this.render();}}
  this.require(c);return this.submit();
 }
 async validateTask(task,p){
  const expected=await digest({workspace:p.request.workspace,action:p.request.action,payload:p.request.payload});
  if(task.workspace!==p.request.workspace||task.action!==p.request.action||!same(task.payload,p.request.payload)||task.request_sha256!==expected||!hex(task.id)||(p.task_id&&task.id!==p.task_id))throw Error('The returned task differs from the exact retained original request or accepted task identity.');
  // Original Operator may return its existing active task through an operation
  // alias. Its original operation remains on the task; our requested ID stays
  // unchanged in p.request.
 }
 async submit(resume=false){
  if(!this.w.pending)throw Error('No original request is pending.');
  return this.exclusive(async c=>{
   const w=c.working,p=w.pending;p.rejected=null;delete p.imported_outcome;this.retain(w);this.require(c);
   if(await digest(p.request)!==p.request_sha256)throw Error('The original request identity changed.');
   this.require(c);
   let task;
   try{
    const raw=await this.host.api(resume&&p.task_id?'/api/task/resume':'/api/actions',{method:'POST',body:resume&&p.task_id?{id:p.task_id}:clone(p.request)});
    task=raw.task||raw;await this.validateTask(task,p);
   }catch(error){
    if(w.pending===p&&[400,401,403,404,405,413,415,422].includes(Number(error?.status)))p.rejected={status:error.status,message:error.message};
    this.outcome(w);throw error;
   }
   p.task_id=task.id;p.state=task.state;p.task=clone(task);this.outcome(w);
   if(!this.current(c))return;
   await this.adopt(task,c,p);
   if(this.current(c))await this.host.refresh({force:true});
  });
 }
 async adopt(task,c,p){
  await this.validateTask(task,p);this.require(c);
  if(task.state==='complete'){
   c.working.history.push({request:clone(p.request),request_sha256:p.request_sha256,task:clone(task)});
   c.working.pending=null;this.outcome(c.working);
   const reviewId=task.result?.review_id||p.request.payload.review_id;
   if(reviewId)await this.openSaved(reviewId);
   if(this.valid())this.notice='Original allocation saved. Recipient decisions and handbacks remain in the original Customer reviews history.';
  }else if(finalStates.has(task.state)){
   p.rejected={status:task.state,message:task.error?.message||task.state};this.outcome(c.working);
   this.error='The original task is '+task.state+'. Resume this same task after its cause is repaired, or preserve it and author a corrected successor.';
  }else this.notice='Original task '+task.id.slice(0,12)+' is '+task.state+'. Recover its status without creating another operation.';
 }
 async status(){
  const p=this.w?.pending;if(!p)return;if(!p.task_id)return this.submit();
  return this.exclusive(async c=>{
   const raw=await this.host.api(this.host.endpoint('/api/task',{id:p.task_id})),task=raw.task||raw;
   await this.validateTask(task,p);p.state=task.state;p.task=clone(task);this.outcome(c.working);this.require(c);await this.adopt(task,c,p);
  });
 }
 async openSaved(id,responseId=undefined){
  const c=this.context(),seq=++this.sequence,args={id};if(responseId!==undefined)args.response_id=responseId??'';
  const data=await this.read('detail',args);this.require(c);if(seq!==this.sequence)return;
  if(data.review_id!==id||data.project.id!==this.scope.project_id||data.workspace_key!==this.scope.workspace_key)throw Error('The saved joint delivery belongs to another original source.');
  this.detail=data;this.render();
 }
 async responseFile(file){
  if(this.frozen()||!this.detail)throw Error('Open a saved review and reconcile any pending operation first.');
  const c=this.context(),seq=++this.sequence,id=this.detail.review_id,text=await file.text();this.require(c);if(seq!==this.sequence)throw Error('A later file or edit replaced this response read.');
  const value=JSON.parse(text);if(value.schema!=='upstate.customer-review-response/v1'||value.review_id!==id||value.project_id!==this.scope.project_id)throw Error('This returned response belongs to another review or project.');
  await this.queue('customer.review.response.import',{review_id:id,response:value});
 }
 async replaceWorking(value){
  if(this.frozen())throw Error('Reconcile the current original request before opening another working file.');
  const c=this.context(),seq=this.sequence,w=shapeWorking(value);
  if(w.scope.project_id!==this.scope.project_id)throw Error('The working file belongs to another original project.');
  if(!same(w.profile,this.catalog.profile)||!same(this.catalog.profile.requirements.map(r=>r.id),w.definition.allocations.map(r=>r.id))||!same(this.catalog.profile.inputs.map(r=>r.id),w.definition.inputs.map(r=>r.id)))throw Error('The working file uses another original requirement or commercial profile. Preserve it and reopen with its original source edition.');
  if(w.pending){
   if(!same(w.scope,this.scope))throw Error('Reconcile this pending request on its original Workspace and staff session. Its file remains unchanged.');
   if(await digest(w.pending.request)!==w.pending.request_sha256)throw Error('The retained request body changed.');
   this.require(c);if(seq!==this.sequence)throw Error('A later edit superseded the working-file read.');
   w.history.push({imported_pending_observation:clone(w.pending)});
   w.pending.task_id=null;w.pending.state='prepared';w.pending.rejected=null;delete w.pending.task;
  }
  this.require(c);if(seq!==this.sequence)throw Error('A later edit superseded the working-file read.');
  this.retain(c.working);
  w.origin={working_id:w.id,scope:clone(w.scope),prior:w.origin||null};w.id=uuid();w.scope=clone(this.scope);
  this.w=w;++this.generation;this.artifacts=[];this.preview=null;this.detail=null;this.initializeSelection();
  this.outcome(w);this.notice=w.pending?'Original request retained. Replay it against the original server; imported outcomes do not authorize a successor.':'Complete working copy opened separately; its earlier copy remains retained.';this.render();
 }
 async openFile(file){const c=this.context(),seq=++this.sequence,text=await file.text();this.require(c);if(seq!==this.sequence)throw Error('A later edit superseded this file.');await this.replaceWorking(JSON.parse(text));}
 async act(b){
  const action=b.dataset.jdAction;if(!this.valid())return;
  if(action==='refresh')return this.refresh();
  if(action==='working-download'){const text=this.text();download(text,'Joint_Delivery_Working_'+this.w.id+'.json');this.backupText=text;this.notice='Complete working copy download initiated. Keep the file; it includes the exact pending request, if any.';this.render();return;}
  if(action==='copies'){this.listCopies();return;}
  if(action==='copy-open'){const id=this.root.querySelector('[data-jd-copy]').value;const text=localStorage.getItem(keyPrefix+id);if(!text)throw Error('That browser copy is unavailable.');return this.replaceWorking(JSON.parse(text));}
  if(action==='allocation'){this.selectedAllocation=b.dataset.id;this.editKind='allocation';this.search='';this.render();return;}
  if(action==='input'){this.selectedInput=b.dataset.id;this.editKind='input';this.search='';this.render();return;}
  if(action==='evidence')return this.evidence();
  if(action==='preview')return this.review();
  if(action==='definition-download'){this.requireNumbers();if(!this.preview||!same(this.preview.definition,this.w.definition))throw Error('Preview the exact current definition first.');download(JSON.stringify(this.preview.definition,null,2)+'\n','Joint_Delivery_Authored_Definition.json');return;}
  if(action==='save'){this.requireNumbers();if(!this.preview||!same(this.preview.definition,this.w.definition))throw Error('Preview the exact current definition first.');return this.queue('joint-delivery.create',{definition:clone(this.w.definition),preview_sha256:this.preview.preview_sha256});}
  if(action==='retry')return this.submit(false);
  if(action==='resume')return this.submit(true);
  if(action==='status')return this.status();
  if(action==='correct'){
   if(!this.w.pending?.rejected)throw Error('Reconcile the original operation before authoring a successor.');
   this.retain();const old=this.w,newCopy=clone(old);newCopy.origin={working_id:old.id,scope:clone(old.scope),prior:old.origin};newCopy.id=uuid();
   newCopy.history.push({request:clone(old.pending.request),request_sha256:old.pending.request_sha256,terminal_observation:clone(old.pending.rejected)});
   newCopy.pending=null;this.w=newCopy;++this.generation;this.preview=null;this.outcome();this.render();return;
  }
  if(action==='open')return this.openSaved(b.dataset.id);
  if(action==='response-open')return this.openSaved(this.detail.review_id,b.dataset.id||null);
  if(action==='original'){
   if(!this.detail)throw Error('Open a saved handoff first.');
   const id=this.detail.review_id;this.retain();
   return this.host.openSavedCustomerReview({workspace_key:this.scope.workspace_key,id,tab:b.dataset.tab||'files',isCurrent:()=>this.valid()});
  }
  if(action==='export'){
   if(!this.detail)throw Error('Open a saved handoff first.');
   return this.queue('customer.review.export',{review_id:this.detail.review_id,expected_response_id:this.detail.selected_response_id});
  }
  if(action==='draft'){
   if(this.frozen()||!this.detail)throw Error('Open a saved allocation and reconcile the original request first.');
   if(!same(this.detail.profile,this.catalog.profile))throw Error('This saved review retains a different original profile. Keep its complete snapshot; use its source edition to author a successor.');
   this.retain();const w=this.newWorking();w.definition=clone(this.detail.definition);w.origin={review_id:this.detail.review_id,working_id:this.w.id};
   this.w=w;++this.generation;this.artifacts=[];this.preview=null;this.initializeSelection();this.outcome();this.render();return;
  }
  if(action==='new'){
   if(this.frozen())throw Error('Reconcile the original request first.');this.retain();this.w=this.newWorking();++this.generation;this.artifacts=[];this.preview=null;this.detail=null;this.initializeSelection();this.outcome();this.render();return;
  }
  if(this.frozen())throw Error('Reconcile the original request before editing.');
  if(action==='clear-missing'){const r=this.selectedRow(),actual=new Set(this.artifacts.map(x=>x.id));r.evidence_ids=r.evidence_ids.filter(id=>actual.has(id));this.saveEdit();this.render();return;}
 }

 async update(state){
  if(!this.valid()){this.detach();return;}
  if(this.busy||!this.w?.pending)return;
  const p=this.w.pending,t=(state.tasks||[]).find(t=>t.operation_id===p.request.operation_id);
  if(t&&(!p.task_id||p.state!==t.state)){p.task_id=t.id;void this.status().catch(error=>this.fail(error));}
 }
 evidenceHTML(){
  const row=this.selectedRow();if(!row)return '';
  const q=this.search.toLocaleLowerCase(),matching=this.artifacts.filter(a=>(a.label+' '+a.original_path+' '+a.role).toLocaleLowerCase().includes(q));
  const ids=new Set(this.artifacts.map(a=>a.id)),missing=row.evidence_ids.filter(id=>!ids.has(id));
  return (missing.length?'<p class="jd-error">Retained assignments outside the loaded inventory: '+esc(missing.join(', '))+'</p>'+button('clear-missing','Remove these missing assignments',this.frozen()||!this.artifacts.length):'')+
   '<p>'+matching.length+' matching original files. '+row.evidence_ids.length+' assigned to this '+(this.editKind==='input'?'input':'requirement')+'.</p>'+
   (matching.length?'<div class="jd-scroll" tabindex="0" aria-label="Exact evidence files"><table><thead><tr><th>Assign</th><th>Original file</th><th>Role / source</th><th>Bytes / SHA256</th></tr></thead><tbody>'+matching.map(a=>'<tr><td><input type="checkbox" aria-label="Assign '+esc(a.label)+'" data-jd-evidence="'+a.id+'"'+(row.evidence_ids.includes(a.id)?' checked':'')+(this.frozen()?' disabled':'')+'></td><td>'+esc(a.label)+'<small>'+esc(a.original_path)+'</small></td><td>'+esc(a.role)+'<small>'+esc(a.group)+'</small></td><td>'+esc(a.bytes)+'<small class="jd-code">'+esc(a.sha256)+'</small></td></tr>').join('')+'</tbody></table></div>':'<p>No matching files in the loaded inventory. Select retained sources and load their exact files.</p>');
 }
 renderEvidence(){const el=this.root.querySelector('[data-jd-evidence-list]');if(el)el.innerHTML=this.evidenceHTML();}
 allocationListHTML(){
  const q=this.rowSearch.toLocaleLowerCase(),d=this.w.definition;
  const rows=this.catalog.profile.requirements.filter(r=>(r.id+' '+r.title+' '+r.detail).toLocaleLowerCase().includes(q));
  return '<p data-jd-match-count>'+rows.length+' of '+d.allocations.length+' original requirements</p>'+rows.map(r=>{const a=d.allocations.find(x=>x.id===r.id);return button('allocation',r.title,false,'data-id="'+esc(r.id)+'" aria-pressed="'+(this.editKind==='allocation'&&r.id===this.selectedAllocation)+'"')+'<small>'+esc(r.id)+' · '+a.evidence_ids.length+' files · '+(a.effort_hours===null?'hours unfilled':esc(a.effort_hours)+' h')+'</small>';}).join('')+(rows.length?'':'<p>No original requirement matches this filter.</p>');
 }
 renderAllocationList(){const el=this.root.querySelector('[data-jd-allocation-list]');if(el)el.innerHTML=this.allocationListHTML();}
 field(label,key,value,{kind='text',options=null,help=''}={}){
  const numeric=kind==='number',token=numeric&&this.selectedRow()?this.selectedRow().id+'/'+key.slice(11):null;
  const unfinished=token&&Object.hasOwn(this.w?.numericDrafts||{},token);
  if(unfinished)value=this.w.numericDrafts[token];
  const disabled=this.frozen()?' disabled':'',attr=' data-jd-field="'+esc(key)+'"'+disabled;
  let input=kind==='textarea'?'<textarea'+attr+'>'+esc(value)+'</textarea>':options?'<select'+attr+'>'+options.map(o=>'<option value="'+esc(o.value)+'"'+(o.value===value?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>':'<input type="'+(numeric?'text':kind)+'"'+attr+(numeric?' inputmode="'+(key.endsWith('effort_hours')?'decimal':'numeric')+'"':'')+(unfinished?' aria-invalid="true"':'')+' value="'+esc(value??'')+'">';
  return '<label>'+esc(label)+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
 }
 termsHTML(profile){
  const t=profile.terms,money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:t.currency}).format(c/100);
  return '<section data-jd-terms><h2>Proposed engineering scope</h2><p class="jd-term-line"><strong>'+esc(money(t.fee_cents))+'</strong> · '+t.engineering_hours+' engineering hours · '+t.active_business_days+' active business days</p><p>'+esc(profile.scope_note)+'</p><p>'+esc(t.included)+'</p><div class="jd-scroll" tabindex="0"><table><thead><tr><th>Proposed milestone</th><th>Fee</th><th>Active days</th></tr></thead><tbody>'+t.milestones.map(r=>'<tr><td>'+esc(r.title)+'</td><td>'+esc(money(r.fee_cents))+'</td><td>'+r.active_start_day+'–'+r.active_end_day+'</td></tr>').join('')+'</tbody></table></div><p>Issuer proposal deadline: '+esc(t.proposal_deadline)+'. Issuer delivery date: '+esc(t.delivery_date)+'. Active engineering days are separate from calendar waiting and the issuer deadline.</p><details><summary>Original effort allowances and source profile</summary><ul>'+t.effort_allowances.map(r=>'<li>'+esc(r.id)+': '+r.hours+' h</li>').join('')+'</ul><pre class="jd-source">'+esc(JSON.stringify(profile.sources,null,2))+'</pre></details><p class="jd-scope">These are proposed terms. A plan, saved review or returned scientific decision does not sign a contract, authorize an invoice, record payment or establish commercial acceptance.</p></section>';
 }
 summaryHTML(v){
  const x=v.summary;
  return '<div class="jd-summary"><p><strong>'+x.requirements+'</strong> requirements · '+x.selected_files+' selected original files · '+x.without_evidence+' requirements without evidence · '+x.unassigned_responsibilities+' unassigned responsibility fields</p><p>'+x.needed_inputs+' needed prime inputs · '+x.entered_effort_hours+' entered hours · '+x.unfilled_effort_rows+' rows with effort unfilled. Original allowance: '+x.proposed_allowance_hours+' hours.</p><p>Last entered active day: '+esc(x.active_day_end??'unfilled')+'.'+(x.entered_effort_exceeds_allowance?' Entered hours exceed the proposed allowance; review the allocation.':'')+'</p></div>';
 }
 render(){
  if(!this.valid())return;this.root.setAttribute('aria-busy',String(this.busy));this.root.dataset.jdRender=String(Number(this.root.dataset.jdRender||0)+1);
  if(!this.catalog||!this.w){this.root.innerHTML='<h1>Joint delivery planning</h1><p role="status">'+esc(this.error||'Reading the original project, requirements and proposed source profile…')+'</p>'+button('refresh','Read original project again',this.busy);return;}
  const d=this.w.definition,locked=this.frozen(),p=this.w.pending,r=this.selectedRow();
  let out='<header><h1>Joint delivery planning</h1><p>Allocate the original Upper Savannah requirements, name prime-only inputs and retain exact source editions. Customer reviews owns recipient decisions and engineering handbacks.</p><div class="jd-actions">'+button('refresh','Refresh saved plans',this.busy)+button('working-download','Download complete working copy')+'<label class="jd-file">Open working file<input type="file" accept=".json,application/json" data-jd-file="working"'+(locked?' disabled':'')+'></label>'+button('copies','Show browser copies',this.busy)+button('new','Start a separate working copy',locked)+'</div></header><div role="status" class="'+(this.error?'jd-error':'jd-notice')+'">'+esc(this.error||this.notice)+'</div>';
  if(this.unresolvedNumbers().length)out+='<section class="jd-error"><h2>Unfinished numeric entries</h2><p>The exact text is retained in this working file. Correct or clear it in the named allocation before preview or save.</p><ul>'+this.unresolvedNumbers().map(key=>'<li>'+esc(key)+' = '+esc(this.w.numericDrafts[key])+'</li>').join('')+'</ul></section>';
  out+=this.termsHTML(this.catalog.profile);
  if(this.copies.length)out+='<section><h2>Retained browser copies</h2><div class="jd-actions"><select data-jd-copy aria-label="Retained working copy">'+this.copies.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.title+' · '+c.updated_at+(c.pending?' · original request retained':''))+'</option>').join('')+'</select>'+button('copy-open','Open a separate copy',locked)+'</div></section>';
  if(p)out+='<section class="jd-pending" data-jd-pending="'+esc(p.request.operation_id)+'"><h2>Original operation</h2><p>'+esc(p.request.action)+' · '+esc(p.state)+'</p><p class="jd-code">'+esc(p.request.operation_id)+'</p><div class="jd-actions">'+button('retry','Replay exact original request',this.busy)+button('status','Read original task',this.busy||!p.task_id)+button('resume','Resume original task',this.busy||!p.task_id||!finalStates.has(p.state))+button('correct','Retain rejected request and edit successor',this.busy||!p.rejected)+'</div>'+(p.rejected?'<p class="jd-error">'+esc(p.rejected.message)+'</p>':'')+'</section>';
  out+='<section><h2>Working plan and original source selection</h2>'+this.field('Plan title','title',d.title)+this.field('Purpose and context','notes',d.notes,{kind:'textarea'})+'<div class="jd-grid">';
  for(const field of fields){const [kind,title]=kinds[field];const rows=this.catalog[kind]||[];out+='<fieldset><legend>'+title+'</legend>'+(rows.length?rows.map(item=>'<label class="jd-check"><input type="checkbox" data-jd-source="'+field+'" value="'+item.id+'"'+(d.selection[field].includes(item.id)?' checked':'')+(locked?' disabled':'')+'><span>'+esc(item.title)+'<small>'+esc(item.id)+'</small></span></label>').join(''):'<p>No retained selections of this kind.</p>')+'</fieldset>';}
  out+='</div><div class="jd-actions">'+button('evidence','Load exact original files',locked)+'</div><p>Earlier file assignments stay in the working copy if you change selections. Reselect their exact source or explicitly remove the missing assignment before saving.</p></section>';
  out+='<section><h2>Requirement allocations and prime inputs</h2><div class="jd-editor"><nav aria-label="Original requirement and input register"><label>Find a requirement<input data-jd-field="row-search" value="'+esc(this.rowSearch)+'"></label><div data-jd-allocation-list>'+this.allocationListHTML()+'</div><h3>Prime-only inputs</h3>'+d.inputs.map(x=>button('input',x.title,false,'data-id="'+esc(x.id)+'" aria-pressed="'+(this.editKind==='input'&&x.id===this.selectedInput)+'"')+'<small>'+esc(x.status)+' · '+d.allocations.filter(a=>a.input_ids.includes(x.id)).length+' dependent requirements</small>').join('')+'</nav><div class="jd-row-editor">';
  if(r&&this.editKind==='allocation'){
   const original=this.catalog.profile.requirements.find(x=>x.id===r.id);out+='<h3>'+esc(original.title)+'</h3><p class="jd-code">'+esc(r.id)+'</p><p class="jd-original">'+esc(original.detail)+'</p>'+this.field('Prime scientific / client responsibility','allocation:prime',r.prime,{kind:'textarea'})+this.field('TJLabs engineering output','allocation:engineering',r.engineering,{kind:'textarea'})+this.field('Receiving responsibility','allocation:receiving',r.receiving,{kind:'textarea'})+'<div class="jd-grid">'+this.field('Proposed phase','allocation:milestone_id',r.milestone_id,{options:[{value:'proposal',label:'Issuer proposal'},...this.catalog.profile.terms.milestones.map(x=>({value:x.id,label:x.title}))]})+this.field('Target calendar date','allocation:target_date',r.target_date,{kind:'date'})+this.field('Active start day','allocation:active_start_day',r.active_start_day,{kind:'number'})+this.field('Active end day','allocation:active_end_day',r.active_end_day,{kind:'number'})+this.field('Entered engineering hours','allocation:effort_hours',r.effort_hours,{kind:'number',help:'Blank means unfilled. Zero is an explicit entry. Requirement allocations are separate from the original phase allowances.'})+'</div><fieldset><legend>Prime inputs required for this output</legend>'+d.inputs.map(x=>'<label class="jd-check"><input type="checkbox" data-jd-input-dependency="1" value="'+esc(x.id)+'"'+(r.input_ids.includes(x.id)?' checked':'')+(locked?' disabled':'')+'><span>'+esc(x.title)+'<small>'+esc(x.status+' · '+x.owner)+'</small></span></label>').join('')+'</fieldset>'+this.field('Allocation note','allocation:note',r.note,{kind:'textarea'});
  }else if(r){
   out+='<h3>'+esc(r.title)+'</h3><p class="jd-code">'+esc(r.id)+'</p>'+this.field('Input title','input:title',r.title)+this.field('Specific information or decision needed','input:needed',r.needed,{kind:'textarea'})+this.field('Available public context already retained','input:public_context',r.public_context,{kind:'textarea'})+this.field('Responsible prime / data owner','input:owner',r.owner)+this.field('Input status','input:status',r.status,{options:[{value:'needed',label:'Needed'},{value:'supplied',label:'Supplied'},{value:'not-applicable',label:'Not applicable to this selection'}]})+this.field('Attributed decision or applicability reason','input:decision',r.decision,{kind:'textarea',help:'A supplied input needs original evidence or a named, attributed decision. Not applicable needs a reason. This is an authored plan; it does not impersonate the prime.'})+'<h4>Requirements unlocked by this input</h4><ul>'+d.allocations.filter(a=>a.input_ids.includes(r.id)).map(a=>'<li>'+esc(this.catalog.profile.requirements.find(o=>o.id===a.id)?.title||a.id)+'</li>').join('')+'</ul><p>Dependencies are derived from the requirement allocations above.</p>';
  }
  out+='<h3>Assign retained evidence</h3><label>Find original files<input data-jd-field="search" value="'+esc(this.search)+'" placeholder="File name, source or role"></label><div data-jd-evidence-list>'+this.evidenceHTML()+'</div></div></div></section>';
  out+='<section><h2>Preview and save the original planning review</h2><div class="jd-actions">'+button('preview','Preview this complete allocation',locked||this.unresolvedNumbers().length>0)+button('save','Save original joint-delivery review',locked||this.unresolvedNumbers().length>0||!this.preview||!same(this.preview.definition,d))+button('definition-download','Download authored definition',this.unresolvedNumbers().length>0||!this.preview||!same(this.preview.definition,d))+'</div>';
  if(this.preview)out+='<div data-jd-preview="'+this.preview.preview_sha256+'">'+this.summaryHTML(this.preview)+'<div class="jd-scroll" tabindex="0"><table><thead><tr><th>Requirement</th><th>Phase / timing</th><th>Effort</th><th>Inputs / evidence</th></tr></thead><tbody>'+this.preview.allocations.map(a=>'<tr><td>'+esc(a.title)+'</td><td>'+esc(a.milestone_id)+'<small>'+esc(a.target_date||'date unfilled')+' · '+esc(a.active_start_day??'unfilled')+'–'+esc(a.active_end_day??'unfilled')+' active days</small></td><td>'+esc(a.effort_hours??'unfilled')+'</td><td>'+a.inputs.length+' inputs / '+a.evidence.length+' files</td></tr>').join('')+'</tbody></table></div></div>';
  out+='</section><section><h2>Saved original joint-delivery reviews</h2>'+(this.catalog.reviews.length?'<div class="jd-scroll" tabindex="0"><table><thead><tr><th>Planning review</th><th>Original recipient disposition</th><th>Open</th></tr></thead><tbody>'+this.catalog.reviews.map(x=>'<tr><td>'+esc(x.title)+'<small>'+esc(x.created_at)+'</small></td><td>'+esc(x.disposition)+'</td><td>'+button('open','Open saved plan',this.busy,'data-id="'+x.id+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No joint-delivery review is saved in this original Workspace.</p>')+this.catalog.issues.map(x=>'<p class="jd-error">'+esc(x.id+': '+x.message)+'</p>').join('')+'</section>';
  if(this.detail){
   const v=this.detail;
   out+='<section data-jd-saved="'+v.review_id+'"><h2>Saved plan: '+esc(v.review.title)+'</h2><p>'+esc(v.summary.reviewer_disposition)+' · proposed commercial terms remain proposed</p><p class="jd-code">Review '+esc(v.review_id)+'<br>Selected returned response '+esc(v.selected_response_id||'none')+'</p>'+this.summaryHTML(v)+'<div class="jd-actions">'+links(v._downloads)+button('original','Open exact original files',this.busy,'data-tab="files"')+button('original','Open recipient decisions',this.busy,'data-tab="requirements"')+button('original','Open engineering handbacks',this.busy,'data-tab="handbacks"')+button('export','Export original review package',locked)+button('draft','Use this plan in a new working copy',locked)+'</div><label class="jd-file">Import actual returned response<input type="file" accept=".json,application/json" data-jd-file="response"'+(locked?' disabled':'')+'></label><h3>Original returned generations</h3><div class="jd-actions">'+button('response-open','Before any returned response',this.busy,'data-id=""')+(v.original_review.responses||[]).map(x=>button('response-open',x.response.reviewer.name+' · '+x.response.created_at,this.busy,'data-id="'+x.id+'"')).join('')+'</div>';
   out+='<details data-jd-saved-profile><summary>Complete original proposed profile for this saved review</summary>'+this.termsHTML(v.profile)+'</details><h3>Complete saved requirement allocation</h3>'+v.allocations.map(a=>'<details data-jd-saved-allocation="'+esc(a.id)+'"><summary>'+esc(a.title)+'</summary><p class="jd-original">'+esc(a.detail)+'</p><dl><dt>Prime scientific / client responsibility</dt><dd>'+esc(a.prime||'Unassigned')+'</dd><dt>TJLabs engineering output</dt><dd>'+esc(a.engineering||'Unassigned')+'</dd><dt>Receiving responsibility</dt><dd>'+esc(a.receiving||'Unassigned')+'</dd><dt>Phase / calendar / active days / hours</dt><dd>'+esc(a.milestone_id)+' · '+esc(a.target_date||'date unfilled')+' · '+esc(a.active_start_day??'unfilled')+'–'+esc(a.active_end_day??'unfilled')+' · '+esc(a.effort_hours??'unfilled')+' h</dd><dt>Note</dt><dd>'+esc(a.note)+'</dd><dt>Original input dependencies</dt><dd>'+a.inputs.map(x=>esc(x.title+' · '+x.status)).join('<br>')+'</dd><dt>Assigned originals</dt><dd>'+a.evidence.map(x=>esc(x.label)+'<small class="jd-code">'+esc(x.original_path+' · '+x.sha256)+'</small>').join('')+'</dd><dt>Actual returned decision</dt><dd>'+esc(a.decision?.decision||'not-returned')+'<br>'+esc(a.decision?.comment||'')+'<br>'+esc(a.decision?.requested_change||'')+'</dd></dl></details>').join('');
   out+='<h3>Complete saved prime inputs</h3>'+v.inputs.map(x=>'<details data-jd-saved-input="'+esc(x.id)+'"><summary>'+esc(x.title)+' · '+esc(x.status)+'</summary><dl><dt>Needed</dt><dd>'+esc(x.needed)+'</dd><dt>Available public context</dt><dd>'+esc(x.public_context)+'</dd><dt>Owner</dt><dd>'+esc(x.owner)+'</dd><dt>Attributed decision / reason</dt><dd>'+esc(x.decision)+'</dd><dt>Dependent requirements</dt><dd>'+esc(x.requirement_ids.join(', '))+'</dd><dt>Exact evidence</dt><dd>'+x.evidence.map(a=>esc(a.label)+'<small class="jd-code">'+esc(a.original_path+' · '+a.sha256)+'</small>').join('')+'</dd></dl></details>').join('')+'<p>'+v.summary.engineering_editions+' engineering editions and '+v.summary.returned_corrections+' actual returned corrections are retained by Customer reviews.</p></section>';
  }
  this.root.innerHTML=out;
 }
 detach(){if(this.gone)return;this.gone=true;this.generation++;this.sequence++;this.controller.abort();if(this.w){try{this.persist(this.w);}catch{this.outcome(this.w);}}}
}
export function attachJointDelivery(host){
 let active=null;
 return {mount(root){active?.detach();active=new JointDeliveryDesk(root,host);const desk=active;void desk.start().catch(e=>desk.fail(e));},
  update(state){const desk=active;if(desk)void desk.update(state).catch(e=>desk.fail(e));},
  detach(){active?.detach();active=null;},
  getWorking(){return active?.w?clone(active.w):null;},
  async openReview(selection){if(!active||selection.workspace_key!==active.scope.workspace_key)throw Error('Open the original joint delivery Workspace first.');return active.openSaved(selection.id,selection.response_id);}
 };
}
