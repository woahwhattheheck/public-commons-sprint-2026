/** Milestone evidence in the original operator; original Reviews owns decisions. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const uuid=()=>crypto.randomUUID();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const fields=['source_collection_ids','run_ids','delivery_ids','spatial_export_ids'];
const kinds={source_collection_ids:['sources','Original sources'],run_ids:['runs','Completed runs'],delivery_ids:['deliveries','Complete deliveries'],spatial_export_ids:['spatial_exports','Saved map exports']};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const knownActions=new Set(['milestone-handoff.create','customer.review.export','customer.review.response.import']);
const finalStates=new Set(['failed','cancelled','interrupted']);
const keyPrefix='upstate.milestone-handoff.copy.v1/';
const download=(body,name,type='application/json')=>{
 const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
};
const ownerOf=state=>canonical({id:state?.person?.id??null,name:state?.person?.name??null});
const scopeOf=state=>({workspace_key:state?.workspace_key,project_id:state?.data?.project?.id,owner:ownerOf(state)});
const button=(action,label,disabled=false,extra='')=>'<button type="button" data-mh-action="'+action+'"'+(disabled?' disabled':'')+' '+extra+'>'+esc(label)+'</button>';
const links=items=>(items||[]).map(item=>'<a href="'+esc(item.url)+(item.url.includes('?')?'&':'?')+'download=1" download="'+esc(item.filename)+'">'+esc(item.label||item.filename)+'</a>').join('');
function shapeWorking(value){
 if(!value||value.schema!=='upstate.milestone-handoff-working/v1'||typeof value.id!=='string'||!value.scope||(typeof value.scope.project_id!=='string'||!value.scope.project_id)||!value.definition||typeof value.definition!=='object'||!Array.isArray(value.history))throw Error('Open a complete milestone working file.');
 const d=value.definition;
 if(d.schema!=='upstate.milestone-handoff-definition/v1'||typeof d.title!=='string'||typeof d.notes!=='string'||typeof d.milestone_id!=='string'||!d.selection||!Array.isArray(d.criteria))throw Error('The unfinished milestone definition is incomplete.');
 for(const field of fields)if(!Array.isArray(d.selection[field])||d.selection[field].some(k=>!hex(k)))throw Error('The working file has invalid original source identities.');
 const ids=new Set();
 for(const row of d.criteria){
  if(typeof row.id!=='string'||ids.has(row.id)||typeof row.note!=='string'||!Array.isArray(row.evidence_ids)||row.evidence_ids.some(k=>!hex(k))||!Array.isArray(row.exceptions))throw Error('The working file has invalid criterion evidence.');
  ids.add(row.id);
  for(const item of row.exceptions)if(!item||['title','detail','owner'].some(k=>typeof item[k]!=='string'))throw Error('Retain each unfinished exception title, detail and owner.');
 }
 const p=value.pending;
 if(p){
  if(!p.request||!knownActions.has(p.request.action)||typeof p.request.operation_id!=='string'||!p.request.operation_id||p.request.workspace!==value.scope.workspace_key||!p.request.payload||!hex(p.request_sha256))throw Error('The retained original request is incomplete.');
  if(p.request.action==='milestone-handoff.create'&&(!same(p.request.payload.definition,d)||!hex(p.request.payload.preview_sha256)))throw Error('The frozen original request differs from the working definition.');
  if(p.request.action!=='milestone-handoff.create'&&!hex(p.request.payload.review_id))throw Error('The retained review operation has no original review ID.');
 }
 return clone(value);
}
class MilestoneDesk{
 constructor(root,host){
  this.root=root;this.host=host;this.scope=scopeOf(host.getState());this.gone=false;this.generation=0;this.sequence=0;
  this.catalog=null;this.w=null;this.preview=null;this.detail=null;this.artifacts=[];this.selectedCriterion='';this.search='';
  this.busy=false;this.error='';this.notice='';this.backupText=null;this.copies=[];this.controller=new AbortController();
  root.classList.add('milestone-handoff');
  root.addEventListener('click',event=>{const b=event.target.closest('[data-mh-action]');if(b&&root.contains(b)){event.preventDefault();void this.act(b).catch(error=>this.fail(error));}},{signal:this.controller.signal});
  root.addEventListener('input',event=>this.input(event),{signal:this.controller.signal});
  root.addEventListener('change',event=>{void this.change(event).catch(error=>this.fail(error));},{signal:this.controller.signal});
 }
 valid(){return !this.gone&&same(scopeOf(this.host.getState()),this.scope);}
 context(){return {scope:clone(this.scope),working:this.w,generation:this.generation};}
 current(c){return this.valid()&&c.generation===this.generation&&c.working===this.w;}
 require(c){if(!this.current(c))throw Error('The original milestone window or staff session changed. Its working copy is retained.');}
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
   download(this.text(w),'Milestone_Original_Outcome_'+w.id+'.json');
   const box=document.getElementById('milestone-detached-outcomes')||Object.assign(document.createElement('section'),{id:'milestone-detached-outcomes'});
   box.style.cssText='background:#fff;color:#20252b;border:2px solid #575f68;padding:16px;position:relative';
   const p=document.createElement('p');p.textContent='Original milestone outcome retained in its complete downloaded working file. Keep that file for continuation.';
   const b=document.createElement('button');b.textContent='Download original outcome again';b.style.cssText='background:#e8ebee;color:#18222a;padding:8px';b.onclick=()=>download(this.text(w),'Milestone_Original_Outcome_'+w.id+'.json');
   box.append(p,b);if(!box.isConnected)document.body.append(box);
  }
 }
 saveEdit(){++this.sequence;this.preview=null;this.root.querySelector('[data-mh-preview]')?.remove();const save=this.root.querySelector('[data-mh-action="save"]');if(save)save.disabled=true;this.w.updated_at=new Date().toISOString();try{this.persist();}catch{this.notice='Browser storage is unavailable. Download your complete working file before leaving.';}}
 newWorking(milestone){
  return {schema:'upstate.milestone-handoff-working/v1',id:uuid(),scope:clone(this.scope),updated_at:new Date().toISOString(),
   definition:{schema:'upstate.milestone-handoff-definition/v1',title:milestone.title,milestone_id:milestone.id,notes:'',
    selection:Object.fromEntries(fields.map(k=>[k,[]])),criteria:milestone.criteria.map(r=>({id:r.id,evidence_ids:[],note:'',exceptions:[]}))},
   pending:null,history:[],origin:null};
 }
 async read(path,args={}){return this.host.api(this.host.endpoint('/api/milestone-handoff/'+path,args));}
 async post(path,payload){return this.host.api('/api/milestone-handoff/'+path,{method:'POST',body:{workspace:this.scope.workspace_key,...payload}});}
 async start(){this.render();await this.refresh();this.listCopies();}
 async refresh(){
  const generation=++this.generation,data=await this.read('catalog');
  if(!this.valid()||generation!==this.generation)return;
  if(data.workspace_key!==this.scope.workspace_key||data.project.id!==this.scope.project_id)throw Error('The milestone catalogue belongs to another original project.');
  this.catalog=data;if(!this.w){this.w=this.newWorking(data.profile.milestones[0]);this.selectedCriterion=this.w.definition.criteria[0]?.id||'';try{this.persist();}catch{}}
  this.render();
 }
 listCopies(){
  const rows=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(keyPrefix)){try{const w=JSON.parse(localStorage.getItem(k));if(w?.scope?.project_id===this.scope.project_id)rows.push({id:w.id,title:w.definition?.title||'Untitled working copy',updated_at:w.updated_at,pending:!!w.pending});}catch{}}}}catch{}
  this.copies=rows.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));if(this.valid())this.render();
 }
 input(event){
  if(!this.valid()||!this.w)return;
  const field=event.target.dataset.mhField;if(!field)return;
  if(field==='search'){this.search=event.target.value;this.renderEvidence();return;}
  if(this.frozen())return;
  if(field==='title'||field==='notes')this.w.definition[field]=event.target.value;
  const row=this.w.definition.criteria.find(r=>r.id===this.selectedCriterion);
  if(field==='criterion-note'&&row)row.note=event.target.value;
  if(field.startsWith('exception-')&&row){const item=row.exceptions[Number(event.target.dataset.index)];if(item)item[field.slice(10)]=event.target.value;}
  this.saveEdit();
 }
 async change(event){
  if(!this.valid()||!this.w)return;
  const el=event.target;
  if(el.dataset.mhFile==='working'){const file=el.files?.[0];if(file)await this.openFile(file);el.value='';return;}
  if(el.dataset.mhFile==='response'){const file=el.files?.[0];if(file)await this.responseFile(file);el.value='';return;}
  if(this.frozen())return;
  if(el.dataset.mhField==='milestone'){
   const selected=this.catalog.profile.milestones.find(m=>m.id===el.value);if(!selected)throw Error('Choose a known milestone.');
   this.retain();this.w=this.newWorking(selected);++this.generation;this.artifacts=[];this.preview=null;this.selectedCriterion=selected.criteria[0]?.id||'';this.retain();this.render();return;
  }
  if(el.dataset.mhSource){
   const values=new Set(this.w.definition.selection[el.dataset.mhSource]);el.checked?values.add(el.value):values.delete(el.value);
   this.w.definition.selection[el.dataset.mhSource]=[...values];this.artifacts=[];this.saveEdit();this.render();return;
  }
  if(el.dataset.mhEvidence){
   const row=this.w.definition.criteria.find(r=>r.id===this.selectedCriterion),ids=new Set(row.evidence_ids);
   el.checked?ids.add(el.dataset.mhEvidence):ids.delete(el.dataset.mhEvidence);row.evidence_ids=[...ids];this.saveEdit();
  }
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
   const actual=new Set(data.artifacts.map(r=>r.id)),missing=c.working.definition.criteria.flatMap(r=>r.evidence_ids.filter(id=>!actual.has(id)));
   this.notice=missing.length?'Earlier assignments are preserved but outside this source selection. Remove or reselect those exact files before saving.':'Exact original source inventory loaded.';
  });
 }
 async review(){
  if(this.w.pending)throw Error('Reconcile the original request first.');
  return this.exclusive(async c=>{
   const definition=clone(c.working.definition),data=await this.post('preview',{definition});this.require(c);
   if(data.workspace_key!==this.scope.workspace_key||data.project.id!==this.scope.project_id||!same(data.definition,definition))throw Error('The preview differs from the authored definition.');
   this.preview=data;this.artifacts=data.artifacts;this.notice='This preview names actual selected files. Unfinished criteria and exceptions remain visible; it records no recipient acceptance.';
  });
 }
 async queue(action,payload){
  if(this.frozen())throw Error('Reconcile the current original request first.');
  const c=this.context(),request={workspace:this.scope.workspace_key,action,payload:clone(payload),operation_id:'milestone-'+uuid()};
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
 validateTask(task,p){
  if(task.workspace!==p.request.workspace||task.operation_id!==p.request.operation_id||task.action!==p.request.action||!same(task.payload,p.request.payload)||!hex(task.id))throw Error('The returned task differs from the exact retained original request.');
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
    task=raw.task||raw;this.validateTask(task,p);
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
  this.validateTask(task,p);this.require(c);
  if(task.state==='complete'){
   c.working.history.push({request:clone(p.request),request_sha256:p.request_sha256,task:clone(task)});
   c.working.pending=null;this.outcome(c.working);
   const reviewId=task.result?.review_id||p.request.payload.review_id;
   if(reviewId)await this.openSaved(reviewId);
   if(this.valid())this.notice='Original operation complete. Source and recipient decisions remain in the original review history.';
  }else if(finalStates.has(task.state)){
   p.rejected={status:task.state,message:task.error?.message||task.state};this.outcome(c.working);
   this.error='The original task is '+task.state+'. Resume this same task after its cause is repaired, or preserve it and author a corrected successor.';
  }else this.notice='Original task '+task.id.slice(0,12)+' is '+task.state+'. Recover its status without creating another operation.';
 }
 async status(){
  const p=this.w?.pending;if(!p)return;if(!p.task_id)return this.submit();
  return this.exclusive(async c=>{
   const raw=await this.host.api(this.host.endpoint('/api/task',{id:p.task_id})),task=raw.task||raw;
   this.validateTask(task,p);p.state=task.state;p.task=clone(task);this.outcome(c.working);this.require(c);await this.adopt(task,c,p);
  });
 }
 async openSaved(id,responseId=undefined){
  const c=this.context(),seq=++this.sequence,args={id};if(responseId!==undefined)args.response_id=responseId??'';
  const data=await this.read('detail',args);this.require(c);if(seq!==this.sequence)return;
  if(data.review_id!==id||data.project.id!==this.scope.project_id||data.workspace_key!==this.scope.workspace_key)throw Error('The saved milestone belongs to another original source.');
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
  const milestone=this.catalog.profile.milestones.find(m=>m.id===w.definition.milestone_id);
  if(!milestone||!same(milestone.criteria.map(r=>r.id),w.definition.criteria.map(r=>r.id)))throw Error('The working file uses a different retained criterion profile.');
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
  this.w=w;++this.generation;this.artifacts=[];this.preview=null;this.detail=null;this.selectedCriterion=w.definition.criteria[0]?.id||'';
  this.outcome(w);this.notice=w.pending?'Original request retained. Replay it against the original server; imported outcomes do not authorize a successor.':'Complete working copy opened separately; its earlier copy remains retained.';this.render();
 }
 async openFile(file){const c=this.context(),seq=++this.sequence,text=await file.text();this.require(c);if(seq!==this.sequence)throw Error('A later edit superseded this file.');await this.replaceWorking(JSON.parse(text));}
 async act(b){
  const action=b.dataset.mhAction;if(!this.valid())return;
  if(action==='refresh')return this.refresh();
  if(action==='working-download'){const text=this.text();download(text,'Milestone_Working_'+this.w.id+'.json');this.backupText=text;this.notice='Complete working copy download initiated. Keep the file; it includes the exact pending request, if any.';this.render();return;}
  if(action==='copies'){this.listCopies();return;}
  if(action==='copy-open'){const id=this.root.querySelector('[data-mh-copy]').value;const text=localStorage.getItem(keyPrefix+id);if(!text)throw Error('That browser copy is unavailable.');return this.replaceWorking(JSON.parse(text));}
  if(action==='criterion'){this.selectedCriterion=b.dataset.id;this.render();return;}
  if(action==='evidence')return this.evidence();
  if(action==='preview')return this.review();
  if(action==='save'){if(!this.preview||!same(this.preview.definition,this.w.definition))throw Error('Preview the exact current definition first.');return this.queue('milestone-handoff.create',{definition:clone(this.w.definition),preview_sha256:this.preview.preview_sha256});}
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
   if(this.frozen())throw Error('Reconcile the original request first.');this.retain();const d=clone(this.detail.definition);
   const w=this.newWorking(this.catalog.profile.milestones.find(m=>m.id===d.milestone_id));w.definition=d;w.origin={review_id:this.detail.review_id,working_id:this.w.id};this.w=w;++this.generation;this.artifacts=[];this.preview=null;this.selectedCriterion=d.criteria[0]?.id||'';this.outcome();this.render();return;
  }
  if(this.frozen())throw Error('Reconcile the original request before editing.');
  const row=this.w.definition.criteria.find(r=>r.id===this.selectedCriterion);
  if(action==='exception-add'){row.exceptions.push({title:'',detail:'',owner:''});this.saveEdit();this.render();return;}
  if(action==='exception-remove'){row.exceptions.splice(Number(b.dataset.index),1);this.saveEdit();this.render();return;}
  if(action==='clear-missing'){const actual=new Set(this.artifacts.map(r=>r.id));row.evidence_ids=row.evidence_ids.filter(id=>actual.has(id));this.saveEdit();this.render();return;}
 }
 async update(state){
  if(!this.valid()){this.detach();return;}
  if(this.busy||!this.w?.pending)return;
  const p=this.w.pending,t=(state.tasks||[]).find(t=>t.operation_id===p.request.operation_id);
  if(t&&(!p.task_id||p.state!==t.state)){p.task_id=t.id;void this.status().catch(error=>this.fail(error));}
 }
 evidenceHTML(){
  if(!this.w)return '';
  const row=this.w.definition.criteria.find(r=>r.id===this.selectedCriterion);if(!row)return '';
  const q=this.search.toLocaleLowerCase(),matching=this.artifacts.filter(a=>(a.label+' '+a.original_path+' '+a.role).toLocaleLowerCase().includes(q));
  const ids=new Set(this.artifacts.map(a=>a.id)),missing=row.evidence_ids.filter(id=>!ids.has(id));
  return (missing.length?'<p class="mh-error">Earlier assignments outside the loaded inventory: '+esc(missing.join(', '))+'</p>'+button('clear-missing','Remove these missing assignments',this.frozen()||!this.artifacts.length):'')+
   '<p>'+matching.length+' matching original files. '+row.evidence_ids.length+' assigned to this criterion.</p>'+
   (matching.length?'<div class="mh-scroll"><table><thead><tr><th>Assign</th><th>Original file</th><th>Role / source</th><th>Bytes / SHA256</th></tr></thead><tbody>'+matching.map(a=>'<tr><td><input type="checkbox" aria-label="Assign '+esc(a.label)+'" data-mh-evidence="'+a.id+'"'+(row.evidence_ids.includes(a.id)?' checked':'')+(this.frozen()?' disabled':'')+'></td><td>'+esc(a.label)+'<small>'+esc(a.original_path)+'</small></td><td>'+esc(a.role)+'<small>'+esc(a.group)+'</small></td><td>'+esc(a.bytes)+'<small class="mh-code">'+esc(a.sha256)+'</small></td></tr>').join('')+'</tbody></table></div>':'<p>Load the selected original inventory to assign files.</p>');
 }
 renderEvidence(){const target=this.root.querySelector('[data-mh-evidence-list]');if(target)target.innerHTML=this.evidenceHTML();}
 render(){
  if(!this.valid())return;
  this.root.setAttribute('aria-busy',String(this.busy));this.root.dataset.mhRender=String(Number(this.root.dataset.mhRender||0)+1);
  if(!this.catalog||!this.w){this.root.innerHTML='<h1>Milestone handoff</h1><p>'+(this.error?esc(this.error):'Reading original project and milestone criteria…')+'</p>';return;}
  const d=this.w.definition,m=this.catalog.profile.milestones.find(m=>m.id===d.milestone_id),row=d.criteria.find(r=>r.id===this.selectedCriterion),criterion=m?.criteria.find(r=>r.id===this.selectedCriterion),locked=this.frozen(),p=this.w.pending;
  let html='<header><h1>Milestone handoff</h1><p>Assign actual retained evidence, keep exceptions visible, and receive decisions through the original Customer reviews workflow.</p><div class="mh-actions">'+button('refresh','Refresh saved handoffs',this.busy)+button('working-download','Download complete working copy')+'<label class="mh-file">Open working file<input type="file" accept=".json,application/json" data-mh-file="working"'+(locked?' disabled':'')+'></label>'+button('copies','Show saved browser copies',this.busy)+'</div></header>';
  html+='<p class="mh-scope">'+esc(this.catalog.profile.scope_note)+'</p><div role="status" class="'+(this.error?'mh-error':'mh-notice')+'">'+esc(this.error||this.notice)+'</div>';
  if(this.copies.length)html+='<section><h2>Independent browser copies</h2><div class="mh-actions"><select data-mh-copy>'+this.copies.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.title+' · '+c.updated_at+(c.pending?' · original request retained':''))+'</option>').join('')+'</select>'+button('copy-open','Open a separate copy',locked)+'</div></section>';
  if(p)html+='<section class="mh-pending" data-mh-pending="'+esc(p.request.operation_id)+'"><h2>Original operation</h2><p>'+esc(p.request.action)+' · '+esc(p.state)+'</p><p class="mh-code">'+esc(p.request.operation_id)+'</p><div class="mh-actions">'+button('retry','Replay exact original request',this.busy)+button('status','Read original task',this.busy||!p.task_id)+button('resume','Resume original task',this.busy||!p.task_id||!finalStates.has(p.state))+button('correct','Preserve rejected request and edit successor',this.busy||!p.rejected)+'</div>'+ (p.rejected?'<p class="mh-error">'+esc(p.rejected.message)+'</p>':'')+'</section>';
  html+='<section><h2>Working evidence selection</h2><div class="mh-grid"><label>Milestone<select data-mh-field="milestone"'+(locked?' disabled':'')+'>'+this.catalog.profile.milestones.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===d.milestone_id?' selected':'')+'>'+esc(item.title)+'</option>').join('')+'</select></label><label>Handoff title<input data-mh-field="title" value="'+esc(d.title)+'"'+(locked?' disabled':'')+'></label></div><label>Purpose and context<textarea data-mh-field="notes"'+(locked?' disabled':'')+'>'+esc(d.notes)+'</textarea></label><div class="mh-grid">';
  for(const field of fields){const [kind,title]=kinds[field];html+='<fieldset><legend>'+title+'</legend>'+(this.catalog[kind].length?this.catalog[kind].map(item=>'<label class="mh-check"><input type="checkbox" data-mh-source="'+field+'" value="'+item.id+'"'+(d.selection[field].includes(item.id)?' checked':'')+(locked?' disabled':'')+'><span>'+esc(item.title)+'<small>'+esc(item.id)+'</small></span></label>').join(''):'<p>No retained selections of this kind.</p>')+'</fieldset>';}
  html+='</div><div class="mh-actions">'+button('evidence','Load exact original files',locked)+'</div></section>';
  html+='<section><h2>Criterion evidence and exceptions</h2><div class="mh-criteria-nav">'+m.criteria.map(c=>button('criterion',c.id+' · '+c.title,false,'data-id="'+c.id+'" aria-pressed="'+(c.id===this.selectedCriterion)+'"')).join('')+'</div>';
  if(row&&criterion){html+='<h3>'+esc(criterion.title)+'</h3><p>'+esc(criterion.detail)+'</p><label>Engineering evidence note<textarea data-mh-field="criterion-note"'+(locked?' disabled':'')+'>'+esc(row.note)+'</textarea></label><label>Find original files<input data-mh-field="search" value="'+esc(this.search)+'" placeholder="File name, source or role"></label><div data-mh-evidence-list>'+this.evidenceHTML()+'</div><h3>Source and assumption exceptions</h3>'+row.exceptions.map((x,i)=>'<div class="mh-exception"><label>Exception<input data-mh-field="exception-title" data-index="'+i+'" value="'+esc(x.title)+'"'+(locked?' disabled':'')+'></label><label>Responsible owner<input data-mh-field="exception-owner" data-index="'+i+'" value="'+esc(x.owner)+'"'+(locked?' disabled':'')+'></label><label>Detail<textarea data-mh-field="exception-detail" data-index="'+i+'"'+(locked?' disabled':'')+'>'+esc(x.detail)+'</textarea></label>'+button('exception-remove','Remove exception',locked,'data-index="'+i+'"')+'</div>').join('')+button('exception-add','Add source exception',locked);}
  html+='</section><section><h2>Prepare original recipient review</h2><div class="mh-actions">'+button('preview','Preview this complete selection',locked)+button('save','Save original milestone review',locked||!this.preview||!same(this.preview.definition,d))+'</div>';
  if(this.preview)html+='<div data-mh-preview="'+this.preview.preview_sha256+'"><p>'+this.preview.summary.selected_files+' original files · '+this.preview.summary.criteria+' criteria · '+this.preview.summary.criteria_without_evidence+' without assigned evidence · '+this.preview.summary.authored_exceptions+' authored exceptions</p><ul>'+this.preview.criteria.map(c=>'<li>'+esc(c.id+' · '+c.title)+' — '+c.evidence.length+' assigned files; '+c.exceptions.length+' exceptions.</li>').join('')+'</ul></div>';
  html+='</section><section><h2>Saved original milestone reviews</h2><div class="mh-scroll"><table><thead><tr><th>Handoff</th><th>Original recipient disposition</th><th>Open</th></tr></thead><tbody>'+this.catalog.reviews.map(r=>'<tr><td>'+esc(r.title)+'<small>'+esc(r.milestone_id)+' · '+esc(r.created_at)+'</small></td><td>'+esc(r.disposition)+'</td><td>'+button('open','Open saved handoff',this.busy,'data-id="'+r.id+'"')+'</td></tr>').join('')+'</tbody></table></div>'+this.catalog.issues.map(i=>'<p class="mh-error">'+esc(i.id+': '+i.message)+'</p>').join('')+'</section>';
  if(this.detail){
   const v=this.detail;html+='<section data-mh-saved="'+v.review_id+'"><h2>Saved handoff: '+esc(v.review.title)+'</h2><p>'+esc(v.milestone.title)+' · '+esc(v.summary.reviewer_disposition)+'</p><p class="mh-code">Review '+esc(v.review_id)+'<br>Selected response '+esc(v.selected_response_id||'none')+'</p><div class="mh-actions">'+links(v._downloads)+button('original','Open exact original files',this.busy,'data-tab="files"')+button('original','Open recipient decisions',this.busy,'data-tab="requirements"')+button('original','Open engineering handbacks',this.busy,'data-tab="handbacks"')+button('export','Export original review package',locked)+button('draft','Use evidence in a new working copy',locked)+'</div><label class="mh-file">Import actual returned response<input type="file" accept=".json,application/json" data-mh-file="response"'+(locked?' disabled':'')+'></label><h3>Original returned generations</h3><div class="mh-actions">'+button('response-open','Before any returned response',this.busy,'data-id=""')+(v.original_review.responses||[]).map(r=>button('response-open',r.response.reviewer.name+' · '+r.response.created_at,this.busy,'data-id="'+r.id+'"')).join('')+'</div><div class="mh-scroll"><table><thead><tr><th>Criterion</th><th>Assigned originals / exceptions</th><th>Returned decision</th><th>Returned comment / change</th></tr></thead><tbody>'+v.criteria.map(c=>'<tr><td>'+esc(c.id+' · '+c.title)+'</td><td>'+c.evidence.length+' files / '+c.exceptions.length+' exceptions</td><td>'+esc(c.decision?.decision||'not-returned')+'</td><td>'+esc(c.decision?.comment||'')+'<br>'+esc(c.decision?.requested_change||'')+'</td></tr>').join('')+'</tbody></table></div><p>'+v.summary.engineering_editions+' retained engineering editions. '+esc(v.commercial_status)+'</p></section>';
  }
  this.root.innerHTML=html;
 }
 detach(){if(this.gone)return;this.gone=true;this.generation++;this.sequence++;this.controller.abort();if(this.w){try{this.persist(this.w);}catch{this.outcome(this.w);}}}
}
export function attachMilestoneHandoff(host){
 let active=null;
 return {mount(root){active?.detach();active=new MilestoneDesk(root,host);const desk=active;void desk.start().catch(e=>desk.fail(e));},
  update(state){const desk=active;if(desk)void desk.update(state).catch(e=>desk.fail(e));},
  detach(){active?.detach();active=null;},
  getWorking(){return active?.w?clone(active.w):null;},
  async openReview(selection){if(!active||selection.workspace_key!==active.scope.workspace_key)throw Error('Open the original milestone Workspace first.');return active.openSaved(selection.id,selection.response_id);}
 };
}
