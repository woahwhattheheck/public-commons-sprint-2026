/** Review an original stale field return against its retained base and current plan. */
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const uid=()=>globalThis.crypto?.randomUUID?.()||('field-return-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const button=(action,label,disabled=false,extra='')=>'<button type="button" data-return-action="'+action+'"'+(disabled?' disabled':'')+' '+extra+'>'+esc(label)+'</button>';
const objectText=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const styles='.iw-return{width:min(1380px,96vw);max-width:none;max-height:94vh;padding:0;border:1px solid #777;color:#202020;background:#fff;font:14px/1.5 system-ui,sans-serif}.iw-return::backdrop{background:#0007}.iw-return header{position:sticky;top:0;background:#fff;z-index:2;padding:18px;border-bottom:1px solid #ccc;display:flex;justify-content:space-between;gap:15px}.iw-return main{padding:18px}.iw-return h2{font-size:22px;margin:0}.iw-return h3{margin:20px 0 8px}.iw-return p{margin:7px 0}.iw-return button,.iw-return input,.iw-return select{font:inherit;padding:8px;border:1px solid #888;background:#fff;color:inherit;border-radius:3px}.iw-return button{cursor:pointer}.iw-return button:disabled{opacity:.5;cursor:default}.iw-return label{display:block}.iw-return label>span{display:block;font-weight:600;margin-bottom:5px}.iw-return input,.iw-return select{box-sizing:border-box;width:100%}.iw-return .return-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center}.iw-return .return-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.iw-return .return-box{padding:12px;border:1px solid #ccc;margin:12px 0}.iw-return .return-note{padding:12px;background:#f2f2f2;border-left:3px solid #777}.iw-return .return-error{padding:12px;background:#f6f6f6;border:1px solid #777;white-space:pre-wrap}.iw-return table{border-collapse:collapse;width:100%}.iw-return th,.iw-return td{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #d0d0d0;overflow-wrap:anywhere}.iw-return th{background:#f2f2f2}.iw-return .return-table{overflow:auto}.iw-return .return-value{max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;background:#f7f7f7;padding:9px;margin:5px 0}.iw-return .return-meta{font-size:12px;color:#444;overflow-wrap:anywhere}.iw-return .return-primary{background:#303030;color:#fff}.iw-return .return-resolution{border:1px solid #bbb;padding:13px;margin:14px 0}.iw-return a{color:#202020}@media(max-width:750px){.iw-return .return-grid{grid-template-columns:1fr}.iw-return header{display:block}.iw-return main{padding:12px}}';
function download(name,value){
 const content=JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function valueHtml(value){
 if(!value||value.present===false)return '<p class="return-meta">Absent from this version</p>';
 const content=objectText(value.value),limit=24000;
 return '<pre class="return-value">'+esc(content.slice(0,limit))+'</pre>'+(content.length>limit?'<p class="return-meta">Showing the first '+limit+' characters. Download this complete original difference to inspect the full value.</p>':'');
}
function definitionNotice(row){
 if(row.kind!=='scientific-definition')return '';
 const name=row.path?.endsWith('/$measurement')?'measurement definition':row.path?.endsWith('/$sample_context')?'sample and collection context':row.path?.endsWith('/$site_definition')?'site and coordinate definition':'scientific definition';
 return '<p class="return-note">Choose one complete original '+name+'. Values, units, limits, quality fields and source metadata stay together; this review does not combine them into a new scientific record. Notes and attached-file associations remain separate decisions.</p>';
}
function summaryHtml(value){
 if(!value||typeof value!=='object')return '';
 return '<div class="return-table"><table><thead><tr><th>Review quantity</th><th>Count / value</th></tr></thead><tbody>'+Object.entries(value).map(([k,v])=>'<tr><td>'+esc(k.replaceAll('_',' '))+'</td><td>'+esc(typeof v==='object'?JSON.stringify(v):v)+'</td></tr>').join('')+'</tbody></table></div>';
}
function restoredReview(value,workspace,planId){
 if(!value||value.workspace_key!==workspace||value.plan_id!==planId)return null;
 const result={conflict_id:typeof value.conflict_id==='string'?value.conflict_id:'',choices:{},actor:typeof value.actor==='string'?value.actor.slice(0,800):'',pending:null,receipt:value.receipt||null};
 if(value.choices&&typeof value.choices==='object'&&!Array.isArray(value.choices)){
  for(const [id,choice] of Object.entries(value.choices))if(/^[a-f0-9]{64}$/.test(id)&&['current','incoming'].includes(choice))result.choices[id]=choice;
 }
 const p=value.pending;
 if(p){
  const b=p.payload;
  if(p.action!=='implementation.reconciliation.apply'||typeof p.operation_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(p.operation_id)||!b||b.id!==planId||typeof b.conflict_id!=='string'||!/^[a-f0-9]{64}-r[0-9]{1,16}\.json$/.test(b.conflict_id)||!Number.isSafeInteger(b.expected_revision)||b.expected_revision<1||typeof b.expected_operation_id!=='string'||!/^[a-f0-9]{64}$/.test(b.expected_operation_id)||!b.choices||typeof b.choices!=='object'||Array.isArray(b.choices)||Object.entries(b.choices).some(([id,choice])=>!/^[a-f0-9]{64}$/.test(id)||!['current','incoming'].includes(choice))||typeof b.actor!=='string'||b.actor.length>800)throw Error('The retained request no longer matches its original native reconciliation identity. Keep the stored review and recover the original task from native task history.');
  result.pending=clone(p);result.conflict_id=b.conflict_id;result.choices=clone(b.choices);result.actor=b.actor;
 }
 return result;
}
export class FieldReturnReview{
 constructor(w){
  this.w=w;this.host=w.host;this.workspace=w.workspace;this.planId=w.plan.id;this.generation=w.generation;
  this.storageKey='upstate.implementation-return-review/v1/'+this.workspace+'/'+this.planId;
  this.closed=false;this.controllers=new Set();this.timer=null;this.turn=0;this.busy=false;this.items=[];this.selected='';this.choices={};this.actor='';this.query='';this.scope='required';this.page=0;this.analysis=null;this.preview=null;this.pending=null;this.receipt=null;this.error='';this.notice='';this.storageIssue='';this.restoreBlocked=false;
  try{const saved=restoredReview(JSON.parse(localStorage.getItem(this.storageKey)||'null'),this.workspace,this.planId);if(saved){this.selected=saved.conflict_id;this.choices=saved.choices;this.actor=saved.actor;this.pending=saved.pending;this.receipt=saved.receipt;}}catch(e){this.restoreBlocked=true;this.storageIssue=e?.message||'The prior review could not be read. Native return files and tasks remain retained.';}
  this.node=document.createElement('dialog');this.node.className='iw-return';this.node.setAttribute('aria-label','Reconcile a returned field plan');
  this.node.addEventListener('click',e=>{const b=e.target.closest('[data-return-action]');if(!b||!this.node.contains(b))return;e.preventDefault();e.stopPropagation();this.action(b).catch(x=>this.fail(x));});
  this.node.addEventListener('change',e=>this.change(e.target).catch(x=>this.fail(x)));
  this.node.addEventListener('input',e=>{if(e.target.dataset.returnField==='query'){this.query=e.target.value;this.page=0;this.renderRows();}if(e.target.dataset.returnField==='actor'&&!this.pending&&!this.busy){this.actor=e.target.value;this.persist();}});
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  this.w.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&!this.w.gone&&this.w.generation===this.generation&&this.w.workspace===this.workspace&&this.w.plan?.id===this.planId&&this.host.getState?.()?.workspace_key===this.workspace&&this.node.isConnected;}
 persist(){
  if(this.closed||this.restoreBlocked)return;
  try{localStorage.setItem(this.storageKey,JSON.stringify({schema:'upstate.implementation-return-review/v1',workspace_key:this.workspace,plan_id:this.planId,conflict_id:this.selected,choices:this.choices,actor:this.actor,pending:this.pending,receipt:this.receipt}));this.storageIssue='';}
  catch{this.storageIssue='Browser storage is unavailable. Export the review choices and keep this review open until the original task is recovered.';}
 }
 fail(e){if(this.alive()){this.error=e?.message||String(e);this.busy=false;this.render();}}
 close(){
  if(this.closed)return;this.persist();this.closed=true;this.turn++;clearTimeout(this.timer);
  for(const controller of this.controllers)controller.abort();this.controllers.clear();
  this.node.close();this.node.remove();if(this.w.returnReviewEditor===this)this.w.returnReviewEditor=null;
 }
 async request(path,values={},body){
  if(!this.alive())throw new DOMException('The original field-plan view is no longer active.','AbortError');
  const controller=new AbortController();this.controllers.add(controller);
  try{
   const url=this.host.endpoint?this.host.endpoint(path,values):path+'?'+new URLSearchParams({workspace:this.workspace,...values});
   const result=await this.host.api(url,{...(body===undefined?{}:{method:'POST',body}),signal:controller.signal});
   if(!this.alive())throw new DOMException('The original field-plan view changed.','AbortError');
   return result;
  }finally{this.controllers.delete(controller);}
 }
 async start(){
  await this.refreshList();if(!this.alive())return;
  if(this.pending?.id)await this.poll();
  else if(!this.pending&&this.selected)await this.prepare();
 }
 async refreshList(){
  const turn=++this.turn;const r=await this.request('/api/implementation/reconciliation-conflicts',{id:this.planId});
  if(turn!==this.turn)return;
  if(r.workspace_key!==this.workspace||r.plan_id!==this.planId)throw Error('The retained returns belong to another native plan.');
  this.items=r.items||[];this.currentRevision=r.current_revision;
  if(this.selected&&!this.items.some(x=>x.conflict_id===this.selected)){if(!this.pending){this.selected='';this.choices={};this.analysis=null;this.preview=null;}}
  this.persist();this.render();
 }
 async prepare(){
  if(this.restoreBlocked)throw Error(this.storageIssue);
  if(this.pending)throw Error('Recover the original reconciliation task before changing the review.');
  if(this.w.pending)throw Error('Finish the original plan operation before reviewing its returned changes.');
  if(!this.selected)throw Error('Choose a retained returned plan.');
  const selected=this.selected,choices=clone(this.choices),turn=++this.turn;
  this.busy=true;this.preview=null;this.error='';this.render();
  try{
   const r=await this.request('/api/implementation/reconciliation-preview',{}, {id:this.planId,conflict_id:selected,choices});
   if(turn!==this.turn||this.selected!==selected)return;
   if(r.workspace_key!==this.workspace||r.plan_id!==this.planId||r.conflict_id!==selected)throw Error('The review differs from the selected native return.');
   this.analysis=r;this.preview=r;this.error='';this.page=0;this.persist();
  }finally{if(this.alive()&&turn===this.turn){this.busy=false;this.render();}}
 }
 async change(el){
  const field=el.dataset.returnField;
  if(field==='choices-file'){await this.readChoices(el.files?.[0]);return;}
  if(field==='source'){
   if(this.busy||this.pending)throw Error('Finish or recover the original request before selecting another return.');
   this.selected=el.value;this.choices={};this.analysis=null;this.preview=null;this.receipt=null;this.page=0;this.persist();this.render();if(this.selected)await this.prepare();return;
  }
  if(field==='scope'){this.scope=el.value;this.page=0;this.renderRows();return;}
  if(el.dataset.returnChoice){
   if(this.busy||this.pending)throw Error('Finish or recover the original request before changing a resolution.');
   const id=el.dataset.returnChoice;if(!(this.analysis?.conflicts||[]).some(x=>x.id===id))throw Error('Choose a conflict from the original review.');
   if(el.value==='')delete this.choices[id];else if(['current','incoming'].includes(el.value))this.choices[id]=el.value;else throw Error('Choose the current or returned value.');
   this.preview=null;this.persist();this.render();return;
  }
 }
 async readChoices(file){
  if(!file)return;if(this.busy||this.pending)throw Error('Recover the original request before opening review choices.');
  if(file.size>16*1024*1024)throw Error('Use a review-choice file within 16 MiB.');
  const turn=++this.turn,value=JSON.parse(await file.text());if(!this.alive()||turn!==this.turn)return;
  if(value.schema!=='upstate.implementation-reconciliation-choices/v1'||value.workspace_key!==this.workspace||value.plan_id!==this.planId)throw Error('These choices belong to another original plan or workspace.');
  if(!this.items.some(item=>item.conflict_id===value.conflict_id))throw Error('The original returned plan is unavailable in this native workspace.');
  if(!value.choices||typeof value.choices!=='object'||Array.isArray(value.choices)||Object.values(value.choices).some(v=>!['current','incoming'].includes(v)))throw Error('Use explicit original current/incoming resolution choices.');
  if(typeof value.actor!=='string'||value.actor.length>800)throw Error('Use a reviewer label within 800 characters.');
  this.selected=value.conflict_id;this.choices=clone(value.choices);this.actor=value.actor;this.preview=null;this.analysis=null;this.page=0;this.persist();await this.prepare();
 }
 matched(){const q=this.query.toLocaleLowerCase();return (this.analysis?.conflicts||[]).filter(row=>(this.scope==='all'||this.scope==='automatic'&&row.automatic||this.scope==='required'&&row.required!==false||this.scope==='unresolved'&&row.required!==false&&!this.choices[row.id]&&!row.default_choice)&&(!q||JSON.stringify(row).toLocaleLowerCase().includes(q)));}
 renderRows(){
  const target=this.node.querySelector('[data-return-rows]');if(!target)return;
  const rows=this.matched(),pages=Math.max(1,Math.ceil(rows.length/20));this.page=Math.max(0,Math.min(pages-1,this.page));const locked=this.busy||!!this.pending;
  target.innerHTML='<p>'+rows.length+' matching decisions of '+(this.analysis?.conflicts?.length||0)+' · page '+(this.page+1)+' of '+pages+'</p><div class="return-actions">'+button('previous','Previous',this.page===0)+button('next','Next',this.page===pages-1)+'</div>'+
   rows.slice(this.page*20,(this.page+1)*20).map(row=>'<section class="return-resolution"><h4>'+esc(row.label||row.path||row.id)+'</h4><p class="return-meta">'+esc((row.required===false?'Independent change · ':'Conflicting change · ')+(row.kind||'Field difference'))+(row.record_id?' · original record '+esc(row.record_id):'')+'</p>'+definitionNotice(row)+'<div class="return-grid"><section><h5>Original base</h5>'+valueHtml(row.base)+'</section><section><h5>Current saved plan</h5>'+valueHtml(row.current)+'</section><section><h5>Returned field plan</h5>'+valueHtml(row.incoming)+'</section></div><label><span>Resolve this difference</span><select data-return-choice="'+esc(row.id)+'"'+(locked?' disabled':'')+'><option value="">'+esc(row.default_choice==='incoming'?'Automatic: use returned value':row.default_choice==='current'?'Automatic: keep current value':'Choose explicitly')+'</option><option value="current"'+(this.choices[row.id]==='current'?' selected':'')+'>Keep current saved value</option><option value="incoming"'+(this.choices[row.id]==='incoming'?' selected':'')+'>Use returned value</option></select></label>'+(row.message?'<p>'+esc(row.message)+'</p>':'')+button('conflict-export','Download complete original difference',false,'data-conflict="'+esc(row.id)+'"')+'</section>').join('')+
   (!rows.length?'<p>No decisions match this view. Choose All changes to inspect or override independent changes, then review whole-plan validation below.</p>':'');
 }
 render(){
  if(this.closed)return;const p=this.analysis,locked=this.busy||!!this.pending;
  const identity=p?'<section class="return-box"><h3>Original versions</h3><div class="return-grid">'+[['Base',p.base],['Current saved',p.current],['Returned',p.incoming]].map(([label,v])=>'<div><strong>'+label+' revision '+esc(v?.revision)+'</strong><p class="return-meta">'+esc(v?.sha256||v?.document_digest||'')+'</p></div>').join('')+'</div><p>Changes made on only one side are carried into the preview. Conflicting field or record changes need an explicit choice. Source snapshots, relationships and the complete resolved plan remain subject to native validation.</p>'+summaryHtml(p.summary)+'</section>':'';
  const errors=p?.validation_errors||[];
  this.node.innerHTML='<style>'+styles+'</style><header><div><h2>Reconcile a returned field plan</h2><p>'+esc(this.w.plan.title)+' · '+esc(this.planId)+'</p></div>'+button('close','Close and retain review')+'</header><main>'+
   (this.error?'<p class="return-error" role="alert">'+esc(this.error)+'</p>':'')+(this.storageIssue?'<p class="return-error">'+esc(this.storageIssue)+'</p>':'')+
   (this.notice?'<p class="return-note" role="status">'+esc(this.notice)+'</p>':'')+
   '<p>Review a return already preserved by the native importer. Its original plan, revision and attached files stay retained. This review does not replace the open browser draft.</p>'+
   (this.w.dirty?'<p class="return-note">The workbench has a browser draft. It stays unchanged while you review and save the native reconciliation; opening the latest native plan afterwards preserves a separate copy of that draft.</p>':'')+
   '<div class="return-actions">'+button('refresh','Refresh retained returns',locked)+button('choices-export','Export review choices')+button('choices-open','Open review choices',locked)+button('preview-export','Download complete preview',!p)+'</div>'+
   '<label><span>Retained returned plan</span><select data-return-field="source"'+(locked?' disabled':'')+'><option value="">Choose an original return</option>'+this.items.map(item=>'<option value="'+esc(item.conflict_id)+'"'+(item.conflict_id===this.selected?' selected':'')+'>Returned revision '+esc(item.source_revision??item.revision)+' · '+esc(item.received_at||'')+' · '+esc(item.reason||item.conflict_id)+'</option>').join('')+'</select></label>'+
   (!this.items.length?'<p>No retained return conflicts are available for this plan. Open the complete returned plan + files ZIP (or original plan JSON) and use its normal native save/import. If its revision is stale, the original return is preserved here for review.</p>':'')+
   (this.busy?'<p role="status">Reading the exact retained native versions…</p>':'')+identity+
   (p?'<div class="return-grid"><label><span>Show changes</span><select data-return-field="scope">'+[['required','Conflicting changes'],['unresolved','Unresolved conflicts'],['automatic','Independent automatic changes'],['all','All changes']].map(([value,label])=>'<option value="'+value+'"'+(this.scope===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label><label><span>Find original records or values</span><input type="search" data-return-field="query" value="'+esc(this.query)+'"></label></div><div data-return-rows></div><div class="return-actions">'+button('clear-choices','Clear retained choices',locked)+button('preview','Preview resolved return',locked)+'</div>'+
    (errors.length?'<section class="return-error"><h3>Resolved-plan validation</h3><p>These issues must be resolved before a new revision can be saved.</p><ul>'+errors.map(x=>'<li>'+esc(typeof x==='string'?x:((x.path?x.path+': ':'')+(x.message||JSON.stringify(x))))+'</li>').join('')+'</ul></section>':'')+
    '<label><span>Reviewer (optional)</span><input data-return-field="actor" maxlength="800" value="'+esc(this.actor)+'"'+(locked?' disabled':'')+'></label><div class="return-actions">'+button('apply','Save one reconciled native revision',locked||!this.preview?.can_apply,'class="return-primary"')+'</div><p class="return-meta">The save uses the exact preview operation and current native revision. If the native plan changes again, review it before applying. Saved quantities, units and source snapshots are not recalculated.</p>':'')+
   this.pendingHtml()+this.receiptHtml()+'<input hidden type="file" data-return-field="choices-file" accept=".json,application/json"></main>';this.renderRows();
 }
 pendingHtml(){
  const p=this.pending;if(!p)return '';
  return '<section class="return-box"><h3>Original reconciliation request</h3><p>'+esc(p.operation_id)+' · '+esc(p.state||'response unconfirmed')+'</p><div class="return-actions">'+
   (p.id?button('poll','Refresh retained task',this.busy)+button('task','Open native task'):button('retry','Recover original request',this.busy))+
   (p.state==='interrupted'?button('resume','Resume original task',this.busy):'')+
   (['failed','cancelled'].includes(p.state)?button('retire','Retain failed request and review again',this.busy):'')+
   button('request-export','Download original request')+'</div></section>';
 }
 receiptHtml(){
  const r=this.receipt;if(!r)return '';
  return '<section class="return-note"><h3>Retained reconciliation</h3><p>'+esc(r.status)+' · applied revision '+esc(r.applied_revision)+' · current revision at receipt '+esc(r.current_revision)+'</p><p>The original incoming return, resolution choices and saved revision remain retained. Later native edits remain separate.</p><div class="return-actions">'+button('open-current','Open latest saved plan',!!this.pending||this.busy)+button('receipt-export','Download reconciliation receipt')+'</div>'+this.w.nativeDownloads(r._downloads||[])+'</section>';
 }
 async submit(){
  const p=this.pending;if(!p||this.busy)return;
  this.busy=true;this.error='';this.persist();this.render();
  try{
   if(p.id){await this.poll();return;}
   const r=await this.request('/api/actions',{}, {workspace:this.workspace,action:p.action,payload:p.payload,operation_id:p.operation_id});
   if(this.pending!==p)return;const task=r.task||r;
   if(task.workspace&&task.workspace!==this.workspace)throw Error('The retained task belongs to another workspace.');
   if(!task.id)throw Error('The original request did not return its task ID. Recover the same request.');
   p.id=task.id;p.state=task.state||'queued';this.persist();await this.poll();
  }catch(e){if(this.alive()&&this.pending===p&&!p.id){p.state='response_unconfirmed';this.persist();}throw e;}
  finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async poll(){
  clearTimeout(this.timer);const p=this.pending;if(!p?.id||!this.alive())return;
  const r=await this.request('/api/task',{id:p.id}),task=r.task||r;if(this.pending!==p)return;
  if(task.workspace!==this.workspace||task.action!==p.action||task.operation_id!==p.operation_id||stable(task.payload)!==stable(p.payload))throw Error('The native task differs from its retained reconciliation request.');
  p.state=task.state;this.persist();
  if(task.state==='complete'){
   const result=task.result||{};
   if((result.plan_id||result.plan?.id)!==this.planId||result.operation_id!==p.payload.expected_operation_id)throw Error('The completed reconciliation differs from its original preview.');
   this.receipt={...clone(result),_downloads:clone(task._downloads||result._downloads||[])};delete this.receipt.plan;
   this.pending=null;this.preview=null;this.notice='The resolved native revision is retained. The open browser draft has not been replaced.';this.persist();
   await(this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));if(this.alive())this.render();return;
  }
  if(['failed','cancelled','interrupted'].includes(task.state)){this.error=task.error?.message||'The original reconciliation task '+task.state+'.';this.render();return;}
  this.render();this.timer=setTimeout(()=>this.poll().catch(e=>this.fail(e)),2000);
 }
 async action(b){
  const a=b.dataset.returnAction;
  if(a==='close'){this.close();return;}
  if(a==='previous'||a==='next'){this.page+=a==='previous'?-1:1;this.renderRows();return;}
  if(a==='refresh'){if(this.pending||this.busy)throw Error('Recover the original request first.');await this.refreshList();if(this.selected)await this.prepare();return;}
  if(a==='preview'){await this.prepare();return;}
  if(a==='clear-choices'){if(this.pending||this.busy)throw Error('Recover the original request first.');this.choices={};this.preview=null;this.persist();this.render();return;}
  if(a==='choices-open'){if(this.busy||this.pending)throw Error('Recover the original request first.');this.node.querySelector('[data-return-field="choices-file"]').click();return;}
  if(a==='choices-export'){download(this.planId+'-return-review-choices.json',{schema:'upstate.implementation-reconciliation-choices/v1',workspace_key:this.workspace,plan_id:this.planId,conflict_id:this.selected,choices:this.choices,actor:this.actor,operation_id:this.preview?.operation_id||null});return;}
  if(a==='conflict-export'){const row=(this.analysis?.conflicts||[]).find(x=>x.id===b.dataset.conflict);if(!row)throw Error('Choose a difference in the retained review.');download(this.planId+'-original-return-difference.json',{plan_id:this.planId,conflict_id:this.selected,base:this.analysis.base,current:this.analysis.current,incoming:this.analysis.incoming,difference:row});return;}
  if(a==='preview-export'){if(this.analysis)download(this.planId+'-return-preview.json',this.analysis);return;}
  if(a==='request-export'){if(this.pending)download(this.planId+'-original-return-request.json',this.pending);return;}
  if(a==='receipt-export'){if(this.receipt)download(this.planId+'-reconciliation-receipt.json',this.receipt);return;}
  if(a==='task'){if(this.pending?.id)await this.host.showTask?.(this.pending.id);return;}
  if(a==='retry'){await this.submit();return;}
  if(a==='poll'){await this.poll();return;}
  if(a==='resume'){
   const p=this.pending;if(!p?.id||p.state!=='interrupted')throw Error('Select the original interrupted reconciliation.');
   const r=await this.request('/api/task/resume',{}, {id:p.id});if(this.pending!==p)return;p.state=(r.task||r).state||'queued';this.persist();await this.poll();return;
  }
  if(a==='retire'){
   if(!this.pending||!['failed','cancelled'].includes(this.pending.state))throw Error('Keep the original request until its actual task status is known.');
   download(this.planId+'-retained-failed-reconciliation.json',this.pending);this.pending=null;this.preview=null;this.persist();await this.refreshList();if(this.selected)await this.prepare();return;
  }
  if(a==='open-current'){
   if(this.pending||this.w.pending)throw Error('Finish the retained native operation first.');
   const w=this.w,id=this.planId,workspace=this.workspace;this.close();await w.openPlan(id,true);
   if(!w.gone&&w.workspace===workspace&&w.plan?.id===id){w.tab='handover';w.message='Opened the latest saved native revision. Any prior browser draft was preserved separately.';w.render();}return;
  }
  if(a==='apply'){
   if(this.restoreBlocked)throw Error(this.storageIssue);
   if(this.busy||this.pending||this.w.pending)throw Error('Finish the retained native operation before saving this review.');
   const p=this.preview;if(!p?.can_apply||p.conflict_id!==this.selected)throw Error('Preview the complete resolved return before saving.');
   if(typeof p.operation_id!=='string'||!p.operation_id||!Number.isSafeInteger(p.expected_revision))throw Error('The native preview lacks its exact operation and current revision.');
   this.w.cache();
   this.pending={operation_id:uid(),action:'implementation.reconciliation.apply',payload:{id:this.planId,conflict_id:this.selected,choices:clone(this.choices),expected_operation_id:p.operation_id,expected_revision:p.expected_revision,actor:this.actor},state:'submitting'};
   this.persist();await this.submit();return;
  }
 }
}
export async function openFieldReturnReview(w){
 if(!w.native||!w.plan?.id||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open the original native plan before reviewing a returned field package.');
 if(w.pending)throw Error('Finish or recover the retained plan operation before opening the returned-plan review.');
 if(w.root.querySelector('dialog[open]'))throw Error('Close the current plan editor before reviewing its returned changes.');
 detachFieldReturnReview(w);w.cache();const editor=new FieldReturnReview(w);w.returnReviewEditor=editor;
 try{await editor.start();}catch(e){if(e.name!=='AbortError')editor.fail(e);}return editor;
}
export function detachFieldReturnReview(w){w.returnReviewEditor?.close();w.returnReviewEditor=null;}
