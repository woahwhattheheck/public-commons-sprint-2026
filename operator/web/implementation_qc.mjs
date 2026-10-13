/* Exact saved FIELD12 revisions; numerical methods remain in model.implementation_qc. */
const SCHEMA='upstate.implementation-qc-selection/v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
const REL={duplicate:['field_duplicate','laboratory_duplicate','split_sample'],replicate:['field_replicate','laboratory_replicate'],blank:['field_blank','equipment_blank','trip_blank','method_blank']};
const MET={duplicate:['rpd_percent','absolute_difference'],replicate:['rsd_percent'],blank:['blank_value']};
const LABEL={rpd_percent:'Relative percent difference (%)',absolute_difference:'Absolute difference (original unit)',rsd_percent:'Replicate relative standard deviation (%)',blank_value:'Original blank value'};
const option=(v,l,s)=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(l)+'</option>';
const field=(l,b)=>'<label><span>'+esc(l)+'</span>'+b+'</label>';
const input=(n,v,t='text',a='')=>'<input name="'+esc(n)+'" type="'+t+'" value="'+esc(v)+'" '+a+'>';
const area=(n,v)=>'<textarea name="'+esc(n)+'">'+esc(v)+'</textarea>';
const button=(a,l,x='')=>'<button type="button" data-qc="'+a+'" '+x+'>'+esc(l)+'</button>';
const uid=()=>globalThis.crypto?.randomUUID?.()||('qc-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const styles=".iw-qc{color:#171717;background:#fff;border:1px solid #666;width:min(1350px,94vw);max-width:none;max-height:94vh;padding:0;font:14px/1.5 system-ui,sans-serif}.iw-qc::backdrop{background:#0008}.iw-qc header{position:sticky;top:0;background:#fff;border-bottom:1px solid #999;padding:16px;z-index:2;display:flex;justify-content:space-between;gap:20px}.iw-qc main{padding:16px}.iw-qc h2{font-size:21px;margin:0}.iw-qc h3{font-size:17px;margin:20px 0 10px}.iw-qc p{margin:8px 0}.iw-qc label{display:block}.iw-qc label>span{display:block;font-weight:600}.iw-qc input,.iw-qc textarea,.iw-qc select{box-sizing:border-box;width:100%;font:inherit;border:1px solid #999;background:#fff;color:#171717;padding:7px}.iw-qc textarea{min-height:68px;resize:vertical}.iw-qc input[type=checkbox]{width:auto}.iw-qc button,.iw-qc a.qc-button{font:inherit;background:#f4f4f4;color:inherit;border:1px solid #888;border-radius:0;padding:7px 11px;cursor:pointer;display:inline-block;text-decoration:none}.iw-qc button:disabled{opacity:.5}.iw-qc .qc-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.iw-qc .qc-grid{display:grid;grid-template-columns:repeat(2,minmax(200px,1fr));gap:12px}.iw-qc .qc-wide{grid-column:1/-1}.iw-qc .qc-box{border:1px solid #aaa;padding:12px;margin:12px 0}.iw-qc .qc-notice{background:#eee;padding:10px;border-left:3px solid #666}.iw-qc .qc-error{border:2px solid #333;padding:10px;white-space:pre-wrap}.iw-qc .qc-table{overflow:auto;max-height:430px}.iw-qc table{border-collapse:collapse;width:100%;font-size:12px}.iw-qc th,.iw-qc td{border:1px solid #aaa;padding:6px;vertical-align:top;text-align:left;overflow-wrap:anywhere}.iw-qc th{position:sticky;top:0;background:#eee}.iw-qc pre{white-space:pre-wrap;overflow-wrap:anywhere}.iw-qc details{border-top:1px solid #bbb;padding:9px 0}.iw-qc :focus-visible{outline:3px solid #555;outline-offset:2px}@media(max-width:700px){.iw-qc .qc-grid{grid-template-columns:1fr}.iw-qc header{position:static;display:block}}";
function download(name,value,type='application/json'){
 const body=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function strings(t,label){let v;try{v=JSON.parse(t);}catch{throw Error(label+' must be a JSON array such as [""] or ["","J"].');}if(!Array.isArray(v)||v.some(x=>typeof x!=='string')||new Set(v).size!==v.length)throw Error(label+' must contain unique exact source strings.');return v;}
function number(v,label){if(v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw Error(label+' must be finite and nonnegative.');return n;}
export class SampleQCEditor{
 constructor(wb){
  this.wb=wb;this.host=wb.host;this.workspace=wb.workspace;this.plan=clone(wb.nativePlan);
  this.key='upstate.implementation.qc/v1/'+this.workspace+'/'+this.plan.id+'/'+this.plan.revision;
  this.recoveryKey='upstate.implementation.qc-operation/v1/'+this.workspace+'/'+this.plan.id;this.follow=null;this.followReport=null;this.lastActionReport=null;
  Object.assign(this,{records:[],reviews:[],review:null,result:null,pending:null,error:'',notice:'',filter:'',page:0,rowPage:0,editing:null,closed:false,busy:false});
  this.selected=new Set();this.associated=new Set();this.controllers=new Set();this.timer=null;this.displayEpoch=0;
  this.selection={schema:SCHEMA,plan_id:this.plan.id,revision:this.plan.revision,title:this.plan.title+' — sample QC',purpose:'',reviewer:'',as_of:wb.asOf||new Date().toISOString().slice(0,10),notes:'',groups:[]};
  this.form={kind:'duplicate',relationship:'field_duplicate',relationship_basis:'',notes:'',metric:'',maximum:'',source:'',applicability:'',minimum_quantitation_multiple:'',accepted_qualifiers:'[""]',accepted_qa_statuses:'[""]'};
  try{const old=JSON.parse(localStorage.getItem(this.key)||'null');if(old?.selection?.plan_id===this.plan.id&&old.selection.revision===this.plan.revision&&old.selection.schema===SCHEMA){this.selection=old.selection;this.form={...this.form,...old.form};this.selected=new Set(old.selected||[]);this.associated=new Set(old.associated||[]);this.editing=old.editing||null;this.pending=old.pending||null;this.savedReport=old.savedReport||null;}}
  catch{this.notice='The prior browser draft could not be read. Export selection JSON to retain an independent copy.';}
  try{const retained=JSON.parse(localStorage.getItem(this.recoveryKey)||'null');if(retained?.plan_id===this.plan.id){this.pending=retained.pending||null;this.savedReport=retained.savedReport||this.savedReport;this.followReport=retained.followReport||null;this.lastActionReport=retained.lastActionReport||null;}}catch{this.notice='The prior operation index could not be read. Retained native tasks remain available in the task desk.';}
  this.node=document.createElement('dialog');this.node.className='iw-qc';this.node.setAttribute('aria-label','Sample quality-control review');
  this.node.addEventListener('click',e=>{const b=e.target.closest('[data-qc]');if(b&&this.node.contains(b)){e.preventDefault();e.stopPropagation();this.action(b).catch(x=>this.fail(x));}});
  for(const name of ['input','change'])this.node.addEventListener(name,e=>{e.stopPropagation();this.changed(e);});
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  wb.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&!this.wb.gone&&this.wb.workspace===this.workspace&&this.host.getState?.()?.workspace_key===this.workspace&&this.node.isConnected;}
 persist(){if(this.closed)return;this.followPersist();try{localStorage.setItem(this.key,JSON.stringify({selection:this.selection,form:this.form,selected:[...this.selected],associated:[...this.associated],editing:this.editing,pending:this.pending,savedReport:this.savedReport}));localStorage.setItem(this.recoveryKey,JSON.stringify({plan_id:this.plan.id,pending:this.pending,savedReport:this.savedReport,followReport:this.followReport,lastActionReport:this.lastActionReport}));}catch{this.notice='Browser storage is unavailable. Export selection JSON and keep this view open while a native request is pending.';}}
 fail(e){if(this.alive()){this.busy=false;this.error=e?.message||String(e);this.render();}}
 async request(path,params={},body){
  const c=new AbortController();this.controllers.add(c);
  try{const q={workspace:this.workspace,...params},url=this.host.endpoint?this.host.endpoint(path,q):path+'?'+new URLSearchParams(q);
   const r=await this.host.api(url,body===undefined?{signal:c.signal}:{method:'POST',body:{workspace:this.workspace,...body},signal:c.signal});
   if(!this.alive())throw new DOMException('The workspace or editor changed.','AbortError');return r;
  }finally{this.controllers.delete(c);}
 }
 async start(){const r=await this.request('/api/implementation-qc/records',{plan_id:this.plan.id,revision:this.plan.revision});if(r.workspace_key!==this.workspace||r.plan_id!==this.plan.id||r.revision!==this.plan.revision)throw Error('The native result belongs to another plan.');this.records=r.records;this.reviews=r.reviews;this.render();if(this.followReport)await this.followOpen(this.followReport);if(this.pending?.id)await this.poll();else if(!this.follow&&this.savedReport)await this.inspect(this.savedReport);}
 close(){this.persist();this.closed=true;clearTimeout(this.timer);for(const c of this.controllers)c.abort();this.controllers.clear();this.node.close();this.node.remove();if(this.wb.qcEditor===this)this.wb.qcEditor=null;}
 changed(e){
  const el=e.target;if(this.followChanged(el))return;if(el.dataset.role){const s=el.dataset.role==='control'?this.selected:this.associated;el.checked?s.add(el.value):s.delete(el.value);this.persist();this.counts();return;}
  if(el.name==='filter'){this.filter=el.value;this.page=0;this.renderRecords();return;}
  if(el.name?.startsWith('review.')){this.selection[el.name.slice(7)]=el.value;this.persist();}
  if(el.name?.startsWith('group.')){const f=el.name.slice(6);this.form[f]=el.value;if(f==='kind'){this.form.relationship=REL[el.value][0];this.form.metric='';if(el.value!=='blank')this.associated.clear();this.persist();this.render();}else this.persist();}
 }
 counts(){const e=this.node.querySelector('[data-qc-counts]');if(e)e.textContent=this.selected.size+' control results selected; '+this.associated.size+' explicitly associated samples.';}
 matches(){const q=this.filter.toLocaleLowerCase();return this.records.filter(r=>!q||[r.observation_id,r.site_label,r.sample_id,r.parameter,r.unit,r.fraction,r.method,r.qualifier,r.qa_status,r.original_text].some(v=>text(v).toLocaleLowerCase().includes(q)));}
 renderRecords(){
  const el=this.node.querySelector('[data-qc-records]');if(!el)return;
  const rows=this.matches(),max=Math.max(0,Math.ceil(rows.length/30)-1);this.page=Math.min(this.page,max);
  el.innerHTML='<p>'+rows.length+' matching original results of '+this.records.length+'. Page '+(this.page+1)+' of '+(max+1)+'.</p><div class="qc-actions">'+button('prev','Previous',this.page===0?'disabled':'')+button('next','Next',this.page===max?'disabled':'')+'</div><div class="qc-table"><table><thead><tr><th>Control</th>'+(this.form.kind==='blank'?'<th>Associated</th>':'')+'<th>Original ID</th><th>Site / sample / collection</th><th>Definition</th><th>Result / source QA</th><th>Inspect</th></tr></thead><tbody>'+
   rows.slice(this.page*30,(this.page+1)*30).map(r=>'<tr><td><input type="checkbox" aria-label="Select control '+esc(r.observation_id)+'" data-role="control" value="'+esc(r.observation_id)+'"'+(this.selected.has(r.observation_id)?' checked':'')+'></td>'+(this.form.kind==='blank'?'<td><input type="checkbox" aria-label="Associate sample '+esc(r.observation_id)+'" data-role="associated" value="'+esc(r.observation_id)+'"'+(this.associated.has(r.observation_id)?' checked':'')+'></td>':'')+'<td>'+esc(r.observation_id)+'</td><td>'+esc(r.site_label)+'<br>'+esc(r.sample_id)+'<br>'+esc(r.collected_at||'Collection time not supplied')+'</td><td>'+esc(r.parameter)+' · '+esc(r.unit)+'<br>'+esc([r.basis,r.fraction,r.method,r.activity_method].filter(Boolean).join(' / '))+'</td><td>'+esc(r.original_text)+'<br>'+esc(r.result_type)+' · qualifier '+esc(JSON.stringify(r.qualifier))+' · QA '+esc(JSON.stringify(r.qa_status))+'</td><td>'+button('record','Original record','data-id="'+esc(r.observation_id)+'"')+'</td></tr>').join('')+'</tbody></table></div>';this.counts();
 }
 render(){
  if(this.closed)return;if(this.follow){this.node.innerHTML='<style>'+styles+'</style>'+this.followHtml();this.followList();this.node.querySelector('[data-qc-follow-file]').addEventListener('change',e=>this.followReceiveFile(e.target.files?.[0]).catch(x=>this.fail(x)));return;}const s=this.selection,f=this.form,p=this.pending;
  this.node.innerHTML='<style>'+styles+'</style><header><div><h2>Sample quality-control review</h2><p>'+esc(this.plan.title)+' · exact saved revision '+this.plan.revision+'</p></div>'+button('close','Close and retain draft')+'</header><main>'+
   (this.error?'<div role="alert" class="qc-error">'+esc(this.error)+'</div>':'')+(this.notice?'<p role="status" class="qc-notice">'+esc(this.notice)+'</p>':'')+
   (this.wb.dirty?'<p class="qc-notice">This review uses native revision '+this.plan.revision+'. Your unsaved plan draft remains in the original desk.</p>':'')+
   '<p>Declare actual control relationships from sampling or laboratory records. Enter criteria from the applicable method or project plan. Original results and QA dispositions remain attached to their source.</p><div class="qc-grid">'+
   field('Review title',input('review.title',s.title))+field('Reviewer',input('review.reviewer',s.reviewer))+field('Review date',input('review.as_of',s.as_of,'date'))+field('Scientific purpose',area('review.purpose',s.purpose))+field('Review notes',area('review.notes',s.notes))+'</div>'+
   '<section class="qc-box"><h3>'+(this.editing?'Edit group '+esc(this.editing):'Add declared control group')+'</h3><div class="qc-grid">'+field('Type','<select name="group.kind">'+Object.keys(REL).map(k=>option(k,k,f.kind)).join('')+'</select>')+field('Actual relationship','<select name="group.relationship">'+REL[f.kind].map(k=>option(k,k.replaceAll('_',' '),f.relationship)).join('')+'</select>')+field('Relationship source / basis',area('group.relationship_basis',f.relationship_basis))+field('Group notes',area('group.notes',f.notes))+'</div>'+
   field('Find original results',input('filter',this.filter,'search','placeholder="Sample, site, parameter, method or result ID"'))+'<p data-qc-counts></p><div data-qc-records></div><div class="qc-actions">'+button('clear-selection','Clear selected IDs')+'</div>'+
   '<details'+(f.metric?' open':'')+'><summary>Optional criterion and original result dispositions</summary><p>Choose descriptive review or enter an applicable maximum with its source. Censored results remain visible without substitution. Associated blank samples retain their own QA dispositions.</p><div class="qc-grid">'+
   field('Metric','<select name="group.metric">'+option('','Descriptive only',f.metric)+MET[f.kind].map(k=>option(k,LABEL[k],f.metric)).join('')+'</select>')+field('Entered maximum',input('group.maximum',f.maximum,'number','min="0" step="any"'))+field('Criterion source',area('group.source',f.source))+field('Applicability',area('group.applicability',f.applicability))+field('Minimum multiple of each original quantitation limit (optional)',input('group.minimum_quantitation_multiple',f.minimum_quantitation_multiple,'number','min="0" step="any"'))+field('Accepted exact qualifier strings (JSON)',input('group.accepted_qualifiers',f.accepted_qualifiers))+field('Accepted exact QA status strings (JSON)',input('group.accepted_qa_statuses',f.accepted_qa_statuses))+'</div></details><div class="qc-actions">'+button('add',this.editing?'Update group':'Add group')+(this.editing?button('cancel-edit','Cancel edit'):'')+'</div></section>'+
   '<h3>Complete selected review · '+s.groups.length+' groups</h3><div class="qc-table"><table><thead><tr><th>Group</th><th>Relationship</th><th>Original IDs</th><th>Criterion</th><th>Edit</th></tr></thead><tbody>'+s.groups.map((g,i)=>'<tr><td>'+esc(g.id)+'</td><td>'+esc(g.relationship)+'</td><td>'+esc(g.observation_ids.join(', '))+'</td><td>'+esc(g.criterion?LABEL[g.criterion.metric]+' ≤ '+g.criterion.maximum:'Descriptive')+'</td><td>'+button('edit','Edit','data-index="'+i+'"')+' '+button('remove','Remove','data-index="'+i+'"')+'</td></tr>').join('')+'</tbody></table></div>'+
   '<div class="qc-actions">'+button('preview','Calculate review',this.busy?'disabled':'')+button('save','Save complete native review',this.busy||p?'disabled':'')+button('export-selection','Export selection JSON')+button('import-selection','Open selection JSON')+'</div>'+
   (p?'<section class="qc-notice"><p>Original '+esc(p.action)+' operation '+esc(p.id||p.operation_id)+' · '+esc(p.state||'awaiting response')+'</p><div class="qc-actions">'+(!p.id?button('retry','Recover original submit'):button('task','Open native task')+button('recover','Refresh original task'))+(p.state==='interrupted'?button('resume','Resume original task'):'')+(p.state==='failed'?button('clear-pending','Retain failed request and start a new operation'):'')+'</div></section>':'')+
   this.resultHtml()+'<h3>Saved reviews in this original plan</h3><div class="qc-actions">'+button('refresh','Refresh saved reviews')+'</div><div class="qc-table"><table><thead><tr><th>Title</th><th>Revision / date</th><th>Reviewer</th><th>Open</th></tr></thead><tbody>'+this.reviews.map(r=>'<tr><td>'+esc(r.title)+'</td><td>'+r.revision+' · '+esc(r.as_of)+'</td><td>'+esc(r.reviewer)+'</td><td>'+button('open-review','Open exact review','data-report="'+esc(r.report_id)+'"')+'</td></tr>').join('')+'</tbody></table></div><input hidden type="file" accept=".json,application/json" data-qc-file></main>';
  this.renderRecords();this.node.querySelector('[data-qc-file]').addEventListener('change',e=>this.receiveFile(e.target.files?.[0]).catch(x=>this.fail(x)));
 }

 resultHtml(){
  const r=this.review;if(!r)return '';const groups=r.groups||[],max=Math.max(0,Math.ceil(groups.length/30)-1);this.rowPage=Math.min(this.rowPage,max);
  return '<section class="qc-box"><h3>'+esc(r.title)+'</h3><p>Revision '+esc(r.revision)+' · reviewer '+esc(r.reviewer)+' · '+esc(r.as_of)+'</p><p>'+esc(r.notice)+'</p><p>'+esc(Object.entries(r.summary.outcomes).map(([k,v])=>k.replaceAll('_',' ')+': '+v).join(' · '))+'</p><div class="qc-actions">'+button('result-json','Complete review JSON')+button('result-prev','Previous results',this.rowPage===0?'disabled':'')+button('result-next','Next results',this.rowPage===max?'disabled':'')+'</div><p>Groups '+Math.min(groups.length,this.rowPage*30+1)+'–'+Math.min(groups.length,(this.rowPage+1)*30)+' of '+groups.length+'. The native report retains every group.</p><div class="qc-table"><table><thead><tr><th>Group / IDs</th><th>Definitions</th><th>Metrics</th><th>Entered criterion</th><th>Outcome</th></tr></thead><tbody>'+
   groups.slice(this.rowPage*30,(this.rowPage+1)*30).map(g=>'<tr><td>'+esc(g.id)+'<br>'+esc(g.relationship)+'<br>'+esc(g.observation_ids.join(', '))+'</td><td>'+esc(Object.entries(g.definitions).map(([k,v])=>k+': '+v.map(x=>x||'(unspecified)').join(' / ')).join('; '))+'</td><td>'+esc(Object.entries(g.metrics).filter(([,v])=>v!==null).map(([k,v])=>k+': '+v).join('; ')||'Unavailable')+'</td><td>'+esc(g.criterion?g.criterion.metric+' ≤ '+g.criterion.maximum+'; '+g.criterion.source+'; '+g.criterion.applicability:'Descriptive')+'</td><td>'+esc(g.outcome.replaceAll('_',' '))+'<br>'+esc([...g.reasons,...g.warnings].join('; '))+'</td></tr>').join('')+'</tbody></table></div>'+
   (this.result?.report_id?'<div class="qc-actions">'+button('follow-open','Review decisions and follow-up')+button('source','Register with scientific reports',this.pending?'disabled':'')+button('archive','Complete report and sources ZIP',this.pending?'disabled':'')+'</div><p>Retained in the original plan’s report history and full Workspace archive.</p>':'<p>Save the complete review to retain its report and source edition.</p>')+
   (this.result?'<div class="qc-actions">'+(this.result._downloads||[]).filter(d=>/report\.html|qc-results\.csv|\.zip$/.test(d.label||d.name||'')).map(d=>'<a class="qc-button" href="'+esc(d.url)+'" target="_blank" rel="noopener">'+esc(d.label||d.name||'Retained file')+'</a>').join('')+'</div>':'')+
   (this.result?.delivery_selection?'<div class="qc-actions">'+button('prepare-report','Prepare scientific/client report')+(this.result?.report_source?.source_id&&typeof this.host.openScientificReport==='function'?button('standalone-report','Prepare standalone scientific report'):'')+'</div>':'')+'</section>';
 }
 followKey(report){return 'upstate.implementation.qc-actions/v1/'+this.workspace+'/'+this.plan.id+'/'+report;}
 followEmpty(group){
  const old=group?.latest||{};
  return {group_id:group.group.id,decision:old.decision||'unresolved',use_scope:old.use_scope||'',reason:old.reason||'',state:old.state||'open',task_ids:[...(old.task_ids||[])],evidence_refs:[...(old.evidence_refs||[])],closure_note:old.closure_note||'',new_task:false,task_title:'',task_assignee:'',task_phase:'Quality follow-up',task_duration:'',task_start:'',task_notes:''};
 }
 followPersist(){
  if(!this.follow||this.closed)return;
  try{localStorage.setItem(this.followKey(this.follow.report_id),JSON.stringify({selection:this.follow.selection,editing:this.follow.editing,form:this.follow.form,query:this.follow.query,page:this.follow.page,saved_action_report:this.follow.saved_action_report}));}
  catch{this.notice='Browser draft storage is unavailable. Export the follow-through selection to retain your decisions.';}
 }
 async followOpen(report){
  const turn=++this.displayEpoch;this.busy=true;this.error='';this.render();
  const r=await this.request('/api/implementation-qc/actions',{plan_id:this.plan.id,report_id:report});
  if(turn!==this.displayEpoch){this.busy=false;return;}
  if(r.workspace_key!==this.workspace||r.plan_id!==this.plan.id||r.report_id!==report)throw Error('The follow-through result belongs to another original review.');
  let saved=null;try{saved=JSON.parse(localStorage.getItem(this.followKey(report))||'null');}catch{this.notice='The previous follow-through draft could not be read.';}
  const selection=saved?.selection?.schema==='upstate.implementation-qc-actions-selection/v1'&&saved.selection.plan_id===this.plan.id&&saved.selection.report_id===report?saved.selection:{schema:'upstate.implementation-qc-actions-selection/v1',plan_id:this.plan.id,report_id:report,expected_revision:r.revision,actor:'',as_of:new Date().toISOString().slice(0,10),decisions:[]};
  this.follow={report_id:report,context:r,selection,editing:saved?.editing||null,form:saved?.form||null,query:saved?.query||'',page:saved?.page||0,refreshEpoch:0,saved_action_report:saved?.saved_action_report||(this.lastActionReport?.report_id===report?this.lastActionReport.action_report_id:null),preview:null,result:null};
  this.followReport=report;this.busy=false;this.persist();this.render();if(this.follow.saved_action_report)await this.followInspect(this.follow.saved_action_report);
 }
 async followRefresh(){
  const f=this.follow;if(!f)return;const turn=++f.refreshEpoch;const r=await this.request('/api/implementation-qc/actions',{plan_id:this.plan.id,report_id:f.report_id});
  if(this.follow!==f||turn!==f.refreshEpoch)return;
  if(r.workspace_key!==this.workspace||r.plan_id!==this.plan.id||r.report_id!==f.report_id)throw Error('The follow-through result belongs to another original review.');
  f.context=r;this.followPersist();this.render();
 }
 followChanged(el){
  const f=this.follow;if(!f)return false;
  if(el.dataset.followRole){const key=el.dataset.followRole==='task'?'task_ids':'evidence_refs';if(!f.form)return true;const a=new Set(f.form[key]);el.checked?a.add(el.value):a.delete(el.value);f.form[key]=[...a];this.followPersist();return true;}
  if(el.name==='follow.query'){f.query=el.value;f.page=0;this.followList();this.followPersist();return true;}
  if(el.name?.startsWith('follow.meta.')){f.selection[el.name.slice(12)]=el.value;f.preview=null;this.displayEpoch++;this.followPersist();return true;}
  if(el.name?.startsWith('follow.group.')){if(!f.form)return true;const key=el.name.slice(13);f.form[key]=el.type==='checkbox'?el.checked:el.value;f.preview=null;this.displayEpoch++;this.followPersist();if(key==='new_task')this.render();return true;}
  return false;
 }
 followGroup(){
  const f=this.follow,d=f.form;if(!d)throw Error('Select a QC group first.');
  if(!d.reason.trim())throw Error('Explain the reviewer decision for this original QC group.');
  if(!d.use_scope.trim())throw Error('Specify the selected scientific or reporting use this decision applies to.');
  if(d.state==='closed'&&!d.closure_note.trim())throw Error('Record the closeout evidence and reasoning before closing this review action.');
  const v={group_id:d.group_id,decision:d.decision,use_scope:d.use_scope,reason:d.reason,state:d.state,task_ids:[...d.task_ids],evidence_refs:[...d.evidence_refs],closure_note:d.closure_note};
  if(d.new_task){
   if(!d.task_title.trim())throw Error('Enter the follow-up task title.');
   const duration=d.task_duration===''?null:Number(d.task_duration);
   if(duration!==null&&(!Number.isInteger(duration)||duration<0))throw Error('Task duration must be a nonnegative whole number of days.');
   v.create_task={title:d.task_title,assignee:d.task_assignee,phase:d.task_phase,duration_days:duration,start_not_before:d.task_start||null,notes:d.task_notes};
  }
  return v;
 }
 followMatches(){
  const f=this.follow,q=f.query.toLocaleLowerCase();return f.context.groups.filter(g=>!q||JSON.stringify(g).toLocaleLowerCase().includes(q));
 }
 followList(){
  const f=this.follow,el=this.node.querySelector('[data-qc-follow-list]');if(!f||!el)return;
  const groups=this.followMatches(),max=Math.max(0,Math.ceil(groups.length/25)-1);f.page=Math.min(f.page,max);
  el.innerHTML='<p>'+groups.length+' matching groups of '+f.context.groups.length+' · page '+(f.page+1)+' of '+(max+1)+'.</p><div class="qc-actions">'+button('follow-prev','Previous',f.page===0?'disabled':'')+button('follow-next','Next',f.page===max?'disabled':'')+'</div><div class="qc-table"><table><thead><tr><th>Original group / result IDs</th><th>Saved QC outcome</th><th>Current review decision</th><th>Linked field tasks</th><th>Open</th></tr></thead><tbody>'+groups.slice(f.page*25,(f.page+1)*25).map(v=>{
   const g=v.group,latest=v.latest?.decision&&typeof v.latest.decision==='object'?v.latest.decision:v.latest,staged=f.selection.decisions.find(d=>d.group_id===g.id);
   return '<tr><td>'+esc(g.id)+'<br>'+esc(g.relationship)+'<br>'+esc((g.observation_ids||[]).join(', '))+'</td><td>'+esc((g.outcome||'').replaceAll('_',' '))+'<br>'+esc((g.reasons||[]).join('; '))+'</td><td>'+(staged?'Draft: '+esc(staged.decision.replaceAll('_',' '))+' · '+esc(staged.state)+'<br>':'')+(latest?esc(text(latest.decision))+' · '+esc(latest.state)+'<br>'+esc(latest.use_scope):'No retained reviewer decision')+((v.source_changes||[]).length?'<br>Original/current source changes: '+v.source_changes.length:'')+'</td><td>'+(v.linked_tasks||[]).map(t=>esc(t.title||t.id)+' · '+esc(t.status||t.state||'')).join('<br>')+'</td><td>'+button('follow-edit','Review group','data-group="'+esc(g.id)+'"')+' '+button('follow-history','Full original group and history','data-group="'+esc(g.id)+'"')+'</td></tr>';
  }).join('')+'</tbody></table></div>';
 }
 followEditor(){
  const f=this.follow,d=f.form;if(!d)return '';const entry=f.context.groups.find(g=>g.group.id===d.group_id);if(!entry)return '<p class="qc-error">The selected original group is unavailable. Refresh the saved review.</p>';
  const tasks=f.context.tasks||[],links=f.context.source_links||[],knownTasks=new Set(tasks.map(t=>t.id)),knownLinks=new Set(links.map(l=>l.id));
  const changes=entry.source_changes||[];
  return '<section class="qc-box"><h3>Reviewer decision · '+esc(d.group_id)+'</h3><p>Original QC report '+esc(f.report_id)+' · saved scientific revision '+esc(f.context.review.revision)+'</p><p>'+esc((entry.group.reasons||[]).concat(entry.group.warnings||[]).join('; '))+'</p>'+
   (changes.length?'<details open><summary>Changes between the original review and current field records</summary><pre>'+esc(JSON.stringify(changes,null,2))+'</pre></details>':'')+
   '<div class="qc-grid">'+field('Decision','<select name="follow.group.decision">'+[['unresolved','Unresolved'],['use_as_reviewed','Use as reviewed'],['restricted_use','Restricted use'],['exclude_from_selected_use','Exclude from selected use'],['follow_up_required','Follow-up required']].map(([v,l])=>option(v,l,d.decision)).join('')+'</select>')+field('Action state','<select name="follow.group.state">'+option('open','Open',d.state)+option('closed','Closed',d.state)+'</select>')+field('Scientific / reporting use scope',area('follow.group.use_scope',d.use_scope))+field('Decision reason',area('follow.group.reason',d.reason))+field('Closeout note',area('follow.group.closure_note',d.closure_note))+'</div>'+
   '<h4>Link current field tasks</h4><p>Task progress is edited in the original Implementation plan. Closing this reviewer action retains each linked task’s own status.</p><div class="qc-table">'+(tasks.length?'<table><thead><tr><th>Select</th><th>Task / owner</th><th>Phase / status</th></tr></thead><tbody>'+tasks.map(t=>'<tr><td><input type="checkbox" data-follow-role="task" value="'+esc(t.id)+'" aria-label="Link task '+esc(t.title||t.id)+'"'+(d.task_ids.includes(t.id)?' checked':'')+'></td><td>'+esc(t.title||t.id)+'<br>'+esc(t.assignee||'Unassigned')+'<br>'+esc(t.id)+'</td><td>'+esc(t.phase)+'<br>'+esc(t.status||t.state||'')+'</td></tr>').join('')+'</tbody></table>':'<p>No field tasks retained.</p>')+'</div>'+
   (d.task_ids.some(id=>!knownTasks.has(id))?'<p class="qc-error">Previously selected tasks are absent from the current plan: '+esc(d.task_ids.filter(id=>!knownTasks.has(id)).join(', '))+'. Retain the prior event and revise this new selection.</p>'+d.task_ids.filter(id=>!knownTasks.has(id)).map(id=>'<label><input type="checkbox" data-follow-role="task" value="'+esc(id)+'" checked> '+esc(id)+' (missing; clear this new selection)</label>').join(''):'')+
   field('Create one additional follow-up task','<input type="checkbox" name="follow.group.new_task"'+(d.new_task?' checked':'')+'>')+
   (d.new_task?'<div class="qc-grid">'+field('Task title',input('follow.group.task_title',d.task_title))+field('Assignee',input('follow.group.task_assignee',d.task_assignee))+field('Phase',input('follow.group.task_phase',d.task_phase))+field('Duration (days)',input('follow.group.task_duration',d.task_duration,'number','min="0" step="1"'))+field('Start no earlier than',input('follow.group.task_start',d.task_start,'date'))+field('Task notes',area('follow.group.task_notes',d.task_notes))+'</div>':'')+
   '<h4>Retained source evidence</h4><p>Select original source links already retained with this plan. Full source bindings remain attached to the decision report.</p><div class="qc-table">'+(links.length?'<table><thead><tr><th>Select</th><th>Source</th><th>Original reference</th></tr></thead><tbody>'+links.map(l=>'<tr><td><input type="checkbox" data-follow-role="evidence" value="'+esc(l.id)+'" aria-label="Link evidence '+esc(l.label||l.title||l.id)+'"'+(d.evidence_refs.includes(l.id)?' checked':'')+'></td><td>'+esc(l.label||l.title||l.id)+'<br>'+esc(l.kind)+'</td><td>'+esc(text(l.reference||l.file_ref||l.id))+'</td></tr>').join('')+'</tbody></table>':'<p>No source links retained. Add evidence through the original field plan, then refresh this view.</p>')+'</div>'+
   (d.evidence_refs.some(id=>!knownLinks.has(id))?'<p class="qc-error">Previously selected evidence is absent from the current plan: '+esc(d.evidence_refs.filter(id=>!knownLinks.has(id)).join(', '))+'. Revise the new selection after inspecting the original history.</p>'+d.evidence_refs.filter(id=>!knownLinks.has(id)).map(id=>'<label><input type="checkbox" data-follow-role="evidence" value="'+esc(id)+'" checked> '+esc(id)+' (missing; clear this new selection)</label>').join(''):'')+
   '<div class="qc-actions">'+button('follow-stage','Add this decision to the draft')+button('follow-cancel-edit','Cancel group edit')+'</div></section>';
 }
 followHtml(){
  const f=this.follow,c=f.context,s=f.selection,changed=s.expected_revision!==c.revision;
  return '<header><div><h2>QC decisions and follow-up</h2><p>'+esc(this.plan.title)+' · original review '+esc(c.review.title)+'</p></div><div class="qc-actions">'+button('follow-back','Back to sample review')+button('close','Close and retain draft')+'</div></header><main>'+
   (this.error?'<div role="alert" class="qc-error">'+esc(this.error)+'</div>':'')+(this.notice?'<p role="status" class="qc-notice">'+esc(this.notice)+'</p>':'')+
   '<p>Review the original saved QC groups, record their selected use, and connect corrective work to the field plan. Original measurements, qualifiers and laboratory QA remain attached to the source.</p>'+
   '<p>Scientific review revision '+esc(c.review.revision)+' · latest saved field plan '+esc(c.revision)+' · this action draft targets revision '+esc(s.expected_revision)+'.</p>'+
   (this.wb.dirty?'<p class="qc-notice">The original plan editor has unsaved changes. This action uses the saved field plan; keep the original draft available and reconcile it before saving that plan.</p>':'')+
   (changed?'<section class="qc-notice"><p>The field plan changed after this draft was prepared. Inspect source changes, tasks and evidence before explicitly updating the draft’s target revision.</p>'+button('follow-rebase','Use current saved plan revision')+'</section>':'')+
   '<div class="qc-actions">'+button('follow-refresh','Refresh current tasks and source changes')+button('follow-export-selection','Export action selection JSON')+button('follow-import-selection','Open action selection JSON')+'</div><div class="qc-grid">'+field('Reviewer',input('follow.meta.actor',s.actor))+field('Review date',input('follow.meta.as_of',s.as_of,'date'))+'</div>'+
   field('Find original groups, requests or assigned tasks',input('follow.query',f.query,'search'))+'<div data-qc-follow-list></div>'+this.followEditor()+
   '<section class="qc-box"><h3>Decisions prepared for saving · '+s.decisions.length+'</h3><div class="qc-table"><table><thead><tr><th>Group</th><th>Decision / state</th><th>Use and reason</th><th>Follow-up</th><th>Edit</th></tr></thead><tbody>'+s.decisions.map(d=>'<tr><td>'+esc(d.group_id)+'</td><td>'+esc(d.decision.replaceAll('_',' '))+'<br>'+esc(d.state)+'</td><td>'+esc(d.use_scope)+'<br>'+esc(d.reason)+'</td><td>'+esc(d.task_ids.length+' existing tasks; '+d.evidence_refs.length+' evidence links')+(d.create_task?'<br>New: '+esc(d.create_task.title):'')+'</td><td>'+button('follow-edit','Edit','data-group="'+esc(d.group_id)+'"')+' '+button('follow-remove','Remove from draft','data-group="'+esc(d.group_id)+'"')+'</td></tr>').join('')+'</tbody></table></div><div class="qc-actions">'+button('follow-preview','Preview complete action review',this.busy||!s.decisions.length?'disabled':'')+button('follow-save','Save decisions and follow-up tasks',this.busy||this.pending||changed||!s.decisions.length?'disabled':'')+'</div></section>'+
   (f.preview?'<section class="qc-box"><h3>Complete preview</h3><p>Review every selected decision and proposed task before saving.</p>'+button('follow-preview-json','Download complete preview')+this.followPreviewHtml(f.preview)+'<details><summary>Preview details</summary><pre>'+esc(JSON.stringify(f.preview,null,2))+'</pre></details></section>':'')+
   this.followPendingHtml()+
   (f.result?'<section class="qc-box"><h3>Retained follow-through report</h3><p>'+esc(f.result.action_report_id)+'</p><div class="qc-actions">'+(f.result._downloads||[]).map(d=>'<a class="qc-button" href="'+esc(d.url)+'" target="_blank" rel="noopener">'+esc(d.label||d.name||'Original report file')+'</a>').join('')+button('follow-plan','Open updated field plan',this.wb.dirty?'disabled':'')+button('follow-source','Register with scientific reports',this.pending?'disabled':'')+button('follow-archive','Complete follow-through ZIP',this.pending?'disabled':'')+(f.result.delivery_selection?button('follow-prepare-report','Prepare scientific/client report'):'')+(f.result.report_source?.source_id&&typeof this.host.openScientificReport==='function'?button('follow-standalone-report','Prepare standalone scientific report'):'')+'</div><details><summary>Complete retained review</summary><pre>'+esc(JSON.stringify(f.result.action_review||f.result,null,2))+'</pre></details></section>':'')+
   '<h3>Saved follow-through editions</h3><div class="qc-table"><table><thead><tr><th>Edition</th><th>Reviewer / date</th><th>Open</th></tr></thead><tbody>'+(c.action_reports||[]).map(r=>'<tr><td>'+esc(r.title||r.action_report_id||r.report_id)+'<br>'+esc(r.revision)+'</td><td>'+esc(r.actor||r.reviewer)+'<br>'+esc(r.as_of||r.created_at)+'</td><td>'+button('follow-open-report','Open original edition','data-report="'+esc(r.action_report_id||r.report_id)+'"')+'</td></tr>').join('')+'</tbody></table></div><input hidden type="file" accept=".json,application/json" data-qc-follow-file></main>';
 }
 followPreviewHtml(value){
  const events=value.events||[],tasks=value.created_tasks||[];
  return '<p>Current plan revision '+esc(value.revision)+' → proposed revision '+esc(value.committed_revision)+' · '+events.length+' decisions · '+tasks.length+' new field tasks.</p><div class="qc-table"><table><thead><tr><th>Original group</th><th>Decision / action state</th><th>Selected use and reason</th><th>Tasks / evidence</th></tr></thead><tbody>'+events.map(e=>'<tr><td>'+esc(e.group_id)+'</td><td>'+esc(e.decision.replaceAll('_',' '))+'<br>'+esc(e.state)+'</td><td>'+esc(e.use_scope)+'<br>'+esc(e.reason)+(e.closure_note?'<br>Closeout: '+esc(e.closure_note):'')+'</td><td>'+esc((e.task_ids||[]).join(', '))+'<br>'+esc((e.evidence_refs||[]).join(', '))+'<br>'+esc((e.warnings||[]).join('; '))+'</td></tr>').join('')+'</tbody></table></div>'+
   (tasks.length?'<h4>New field tasks</h4><div class="qc-table"><table><thead><tr><th>Task</th><th>Assignee / phase</th><th>Schedule</th></tr></thead><tbody>'+tasks.map(t=>'<tr><td>'+esc(t.title)+'<br>'+esc(t.notes)+'</td><td>'+esc(t.assignee||'Unassigned')+'<br>'+esc(t.phase)+'</td><td>'+esc(t.duration_days===null?'Duration to be determined':t.duration_days+' days')+'<br>'+esc(t.start_not_before||'Start date to be determined')+'</td></tr>').join('')+'</tbody></table></div>':'');
 }

 followPendingHtml(){
  const p=this.pending;return p?'<section class="qc-notice"><p>Original '+esc(p.action)+' · '+esc(p.id||p.operation_id)+' · '+esc(p.state)+'</p><div class="qc-actions">'+(!p.id?button('retry','Recover original submit'):button('task','Open native task')+button('recover','Refresh original task'))+(p.state==='interrupted'?button('resume','Resume original task'):'')+(p.state==='failed'?button('clear-pending','Retain failed request and start a new operation'):'')+'</div></section>':'';
 }
 async followInspect(id){
  const f=this.follow;if(!f)return;const turn=++this.displayEpoch,r=await this.request('/api/implementation-qc/actions-inspect',{plan_id:this.plan.id,report_id:f.report_id,action_report_id:id});
  if(this.follow!==f||turn!==this.displayEpoch)return;
  if(r.plan_id!==this.plan.id||r.report_id!==f.report_id||r.action_report_id!==id)throw Error('The retained follow-through edition belongs to another original review.');
  f.result=r;f.saved_action_report=id;this.lastActionReport={report_id:f.report_id,action_report_id:id};this.followPersist();this.render();
 }
 async followReceiveFile(file){
  if(!file)return;if(file.size>32*1024*1024)throw Error('Choose action selection JSON smaller than 32 MiB.');
  const f=this.follow,turn=++this.displayEpoch,next=JSON.parse(await file.text());
  if(this.follow!==f||turn!==this.displayEpoch)return;
  if(next.schema!=='upstate.implementation-qc-actions-selection/v1'||next.plan_id!==this.plan.id||next.report_id!==f.report_id||!Array.isArray(next.decisions))throw Error('Choose action selection JSON for this exact original saved review.');
  const validated=await this.request('/api/implementation-qc/actions-validate',{}, {selection:next});
  if(this.follow!==f||turn!==this.displayEpoch)return;
  if(validated.workspace_key!==this.workspace||validated.preview?.selection?.plan_id!==this.plan.id||validated.preview.selection.report_id!==f.report_id)throw Error('The validated selection belongs to another original report.');
  f.selection=clone(validated.preview.selection);f.editing=null;f.form=null;f.preview=null;this.followPersist();this.render();
 }
 async followAction(b){
  const a=b.dataset.qc,f=this.follow;
  if(a==='follow-open'){if(!this.result?.report_id)throw Error('Open a saved QC review first.');await this.followOpen(this.result.report_id);return;}
  if(!f)throw Error('Open the original saved QC review follow-through first.');
  if(a==='follow-back'){this.followPersist();this.follow=null;this.followReport=null;this.displayEpoch++;this.persist();this.render();return;}
  if(a==='follow-prev'||a==='follow-next'){f.page+=a==='follow-prev'?-1:1;this.followList();this.followPersist();return;}
  if(a==='follow-refresh'){await this.followRefresh();return;}
  if(a==='follow-rebase'){f.selection.expected_revision=f.context.revision;f.preview=null;this.displayEpoch++;this.followPersist();this.render();return;}
  if(a==='follow-edit'){
   if(f.editing===b.dataset.group)return;if(f.editing)throw Error('Add or cancel the current group edit before opening another.');
   const g=f.context.groups.find(g=>g.group.id===b.dataset.group);if(!g)throw Error('The original group is missing.');
   const staged=f.selection.decisions.find(d=>d.group_id===g.group.id);f.form=staged?{...this.followEmpty(g),...clone(staged),new_task:!!staged.create_task,task_title:staged.create_task?.title||'',task_assignee:staged.create_task?.assignee||'',task_phase:staged.create_task?.phase||'Quality follow-up',task_duration:staged.create_task?.duration_days??'',task_start:staged.create_task?.start_not_before||'',task_notes:staged.create_task?.notes||''}:this.followEmpty(g);f.editing=g.group.id;this.followPersist();this.render();return;
  }
  if(a==='follow-stage'){const d=this.followGroup(),i=f.selection.decisions.findIndex(x=>x.group_id===d.group_id);if(i<0)f.selection.decisions.push(d);else f.selection.decisions[i]=d;f.editing=null;f.form=null;f.preview=null;this.displayEpoch++;this.followPersist();this.render();return;}
  if(a==='follow-cancel-edit'){f.editing=null;f.form=null;this.followPersist();this.render();return;}
  if(a==='follow-remove'){f.selection.decisions=f.selection.decisions.filter(d=>d.group_id!==b.dataset.group);if(f.editing===b.dataset.group){f.editing=null;f.form=null;}f.preview=null;this.followPersist();this.render();return;}
  if(a==='follow-history'){const g=f.context.groups.find(g=>g.group.id===b.dataset.group);if(g)download(g.group.id+'-qc-action-history.json',{schema:'upstate.implementation-qc-action-history-export/v1',plan_id:this.plan.id,report_id:f.report_id,current_revision:f.context.revision,...g});return;}
  if(a==='follow-export-selection'){download(this.plan.id+'-qc-actions-selection.json',f.selection);return;}
  if(a==='follow-import-selection'){this.node.querySelector('[data-qc-follow-file]').click();return;}
  if(a==='follow-preview-json'){download(f.report_id+'-qc-action-preview.json',f.preview);return;}
  if(a==='follow-preview'||a==='follow-save'){
   if(f.editing)throw Error('Add or cancel the current group edit first.');
   if(!f.selection.actor.trim()||!f.selection.as_of)throw Error('Enter the reviewer and review date.');
   if(f.selection.expected_revision!==f.context.revision)throw Error('Inspect current source changes and explicitly update the target revision.');
   if(a==='follow-save'){await this.submit('implementation.qc.actions.save',{selection:f.selection});return;}
   const turn=++this.displayEpoch;this.busy=true;this.render();const r=await this.request('/api/implementation-qc/actions-preview',{}, {selection:clone(f.selection)});
   if(this.follow!==f||turn!==this.displayEpoch){this.busy=false;this.render();return;}f.preview=r.preview||r;this.busy=false;this.render();return;
  }
  if(a==='follow-open-report'){await this.followInspect(b.dataset.report);return;}
  if(a==='follow-plan'){if(this.wb.dirty)throw Error('Retain and reconcile the original plan’s unsaved draft before reopening its native tasks.');if(typeof this.wb.openPlan!=='function')throw Error('Reopen this saved plan in the original Implementation desk.');const wb=this.wb,id=this.plan.id,workspace=this.workspace;if(!this.alive())return;this.close();await wb.openPlan(id,true);if(wb.gone||wb.workspace!==workspace||this.host.getState?.()?.workspace_key!==workspace||wb.nativePlan?.id!==id)return;wb.tab='tasks';wb.render();return;}
  if(a==='follow-standalone-report'){
   if(!this.alive()||!f.result?.report_source)throw Error('Open the retained QC follow-through source in its original workspace.');
   const selected=f.result,source=clone(selected.report_source),module=await import('./implementation_source_reports.mjs');
   if(!this.alive()||this.follow!==f||f.result!==selected)return;
   await module.openImplementationSourceReport(this.wb,[source],{title:'QC decisions and follow-up · saved revision '+selected.revision,closeEditor:()=>this.close()});return;
  }
  if(a==='follow-prepare-report'){if(typeof this.host.openDelivery!=='function')throw Error('Select this retained source in the original scientific report source picker.');const selection=clone(f.result.delivery_selection);this.close();await this.host.openDelivery(selection);return;}
  if(a==='follow-source'||a==='follow-archive'){if(!f.result?.action_report_id)throw Error('Open a saved follow-through edition.');await this.submit('implementation.qc.actions.'+(a==='follow-source'?'source':'export'),{plan_id:this.plan.id,action_report_id:f.result.action_report_id});return;}
 }

 group(){
  const f=this.form,n=this.selected.size;if((f.kind==='duplicate'&&n!==2)||(f.kind==='replicate'&&n<3)||(f.kind==='blank'&&n!==1))throw Error('Select two duplicate results, three or more replicate results, or one blank.');
  if(!f.relationship_basis.trim())throw Error('State the original relationship source or basis.');
  const associated=f.kind==='blank'?[...this.associated]:[];if(associated.some(id=>this.selected.has(id)))throw Error('A blank cannot be its own associated sample.');
  const g={id:this.editing||'qc-'+uid(),kind:f.kind,relationship:f.relationship,relationship_basis:f.relationship_basis,notes:f.notes,observation_ids:[...this.selected],associated_observation_ids:associated,accepted_qualifiers:strings(f.accepted_qualifiers,'Qualifiers'),accepted_qa_statuses:strings(f.accepted_qa_statuses,'QA statuses')};
  if(f.metric){const maximum=number(f.maximum,'Maximum');if(maximum===null||!f.source.trim()||!f.applicability.trim())throw Error('Enter the maximum, criterion source and applicability.');g.criterion={metric:f.metric,maximum,source:f.source,applicability:f.applicability};const multiple=number(f.minimum_quantitation_multiple,'Quantitation multiple');if(multiple!==null)g.criterion.minimum_quantitation_multiple=multiple;}
  return g;
 }
 async submit(action,payload){
  if(this.pending)throw Error('Recover or finish the retained original QC operation first.');
  this.pending={action,payload:clone(payload),operation_id:uid(),state:'submitting'};this.persist();this.render();await this.retry();
 }
 async retry(){
  const p=this.pending;if(!p||p.id)return;
  try{const r=await this.request('/api/actions',{}, {action:p.action,payload:p.payload,operation_id:p.operation_id}),t=r.task||r;if(!t.id)throw Error('The task identity was not returned. Retry preserves the original operation.');p.id=t.id;p.state=t.state||'queued';this.persist();this.render();await this.poll();}
  catch(e){if(this.alive()){p.state='response_unconfirmed';this.persist();throw e;}}
 }
 async poll(){
  clearTimeout(this.timer);const p=this.pending;if(!p?.id||!this.alive())return;
  try{const r=await this.request('/api/task',{id:p.id}),task=r.task||r;if(this.pending!==p||!this.alive())return;
   p.state=task.state;this.persist();
   if(task.state==='complete'){
    const v=task.result||{};if(v.plan_id!==this.plan.id)throw Error('The completed task belongs to another plan.');
    if(p.action.startsWith('implementation.qc.actions.')){
     const originalReport=v.report_id||p.payload.selection?.report_id||this.follow?.report_id;if(!originalReport)throw Error('The action result lacks its original QC report.');
     this.lastActionReport={report_id:originalReport,action_report_id:v.action_report_id};this.followReport=originalReport;this.pending=null;this.error='';this.persist();
     if(!this.follow||this.follow.report_id!==originalReport)await this.followOpen(originalReport);
     const f=this.follow;await this.followRefresh();
     if(p.action==='implementation.qc.actions.save'&&JSON.stringify(f.selection)===JSON.stringify(p.payload.selection)){f.selection.decisions=[];f.selection.expected_revision=f.context.revision;f.editing=null;f.form=null;f.preview=null;}
     f.result={...v,_downloads:task._downloads||v._downloads||[]};f.saved_action_report=v.action_report_id||f.saved_action_report;
     this.notice=task._qc_export?.message||'The follow-through operation completed at saved field-plan revision '+v.revision+'. Its decisions, tasks and complete report are retained. Reopen the saved field plan to work on the current task records.';
     this.followPersist();this.persist();this.render();return;
    }
    this.displayEpoch++;this.result={...v,_downloads:task._downloads||v._downloads||[]};this.review=v.review;this.savedReport=v.report_id;this.pending=null;this.error='';this.notice=task._qc_export?.message||'The original operation completed; its complete review is retained.';this.persist();await this.refresh();this.render();return;
   }
   if(task.state==='failed'||task.state==='interrupted'){this.error=task.error?.message||'The original task '+task.state+'. Its exact request is retained.';this.render();return;}
   this.render();this.timer=setTimeout(()=>this.poll().catch(e=>this.fail(e)),2000);
  }catch(e){if(this.alive()){this.error=e.message;this.render();}}
 }
 async refresh(){const r=await this.request('/api/implementation-qc/list',{plan_id:this.plan.id});this.reviews=r.reviews;}
 async inspect(id){const turn=++this.displayEpoch;const r=await this.request('/api/implementation-qc/inspect',{plan_id:this.plan.id,report_id:id});if(turn!==this.displayEpoch)return;if(r.plan_id!==this.plan.id)throw Error('The review belongs to another plan.');this.result=r;this.review=r.review;this.savedReport=id;this.rowPage=0;this.persist();this.render();}
 async receiveFile(file){
  if(!file)return;if(file.size>32*1024*1024)throw Error('Choose selection JSON smaller than 32 MiB.');
  const turn=++this.displayEpoch;const parsed=JSON.parse(await file.text()),next=parsed.schema===SCHEMA?parsed:parsed.selection;
  if(!next||next.schema!==SCHEMA||next.plan_id!==this.plan.id||next.revision!==this.plan.revision||!Array.isArray(next.groups))throw Error('Choose a selection for this exact saved plan and revision.');
  const r=await this.request('/api/implementation-qc/preview',{}, {selection:next});
  if(turn!==this.displayEpoch)return;this.selection=clone(r.review.selection);this.review=r.review;this.result=null;this.rowPage=0;this.selected.clear();this.associated.clear();this.editing=null;this.persist();this.render();
 }
 async action(b){
  const a=b.dataset.qc;
  if(a.startsWith('follow-'))return this.followAction(b);
  if(a==='close'){this.close();return;}
  if(a==='prev'||a==='next'){this.page+=a==='prev'?-1:1;this.renderRecords();return;}
  if(a==='result-prev'||a==='result-next'){this.rowPage+=a==='result-prev'?-1:1;this.render();return;}
  if(a==='clear-selection'){this.selected.clear();this.associated.clear();this.persist();this.renderRecords();return;}
  if(a==='record'){const r=this.records.find(v=>v.observation_id===b.dataset.id);if(r)download(r.observation_id+'-original.json',r);return;}
  if(a==='add'){const g=this.group(),i=this.selection.groups.findIndex(v=>v.id===g.id);if(i<0)this.selection.groups.push(g);else this.selection.groups[i]=g;this.editing=null;this.selected.clear();this.associated.clear();this.persist();this.render();return;}
  if(a==='edit'){const g=this.selection.groups[Number(b.dataset.index)];this.editing=g.id;this.selected=new Set(g.observation_ids);this.associated=new Set(g.associated_observation_ids||[]);this.form={kind:g.kind,relationship:g.relationship,relationship_basis:g.relationship_basis,notes:g.notes||'',metric:g.criterion?.metric||'',maximum:g.criterion?.maximum??'',source:g.criterion?.source||'',applicability:g.criterion?.applicability||'',minimum_quantitation_multiple:g.criterion?.minimum_quantitation_multiple??'',accepted_qualifiers:JSON.stringify(g.accepted_qualifiers||['']),accepted_qa_statuses:JSON.stringify(g.accepted_qa_statuses||[''])};this.persist();this.render();return;}
  if(a==='remove'){this.selection.groups.splice(Number(b.dataset.index),1);this.persist();this.render();return;}
  if(a==='cancel-edit'){this.editing=null;this.selected.clear();this.associated.clear();this.persist();this.render();return;}
  if(a==='export-selection'){download(this.plan.id+'-qc-selection.json',this.selection);return;}
  if(a==='import-selection'){this.node.querySelector('[data-qc-file]').click();return;}
  if(a==='result-json'){download((this.review?.id||'review')+'.json',this.review);return;}
  if(a==='preview'){if(this.editing)throw Error('Update or cancel the current group edit.');const turn=++this.displayEpoch;this.busy=true;this.error='';this.render();const r=await this.request('/api/implementation-qc/preview',{}, {selection:clone(this.selection)});if(turn!==this.displayEpoch){this.busy=false;return;}this.review=r.review;this.result=null;this.rowPage=0;this.busy=false;this.render();return;}
  if(a==='save'){if(this.editing)throw Error('Update or cancel the current group edit.');await this.submit('implementation.qc.save',{selection:this.selection});return;}
  if(a==='retry'){await this.retry();return;}
  if(a==='recover'){await this.poll();return;}
  if(a==='task'){this.host.showTask?.(this.pending.id);return;}
  if(a==='resume'){const p=this.pending;await this.request('/api/task/resume',{}, {id:p.id});p.state='queued';this.persist();await this.poll();return;}
  if(a==='clear-pending'){download(this.pending.id+'-original-qc-request.json',this.pending);this.pending=null;this.persist();this.render();return;}
  if(a==='refresh'){await this.refresh();this.render();return;}
  if(a==='open-review'){await this.inspect(b.dataset.report);return;}
  if(a==='source'||a==='archive'){if(!this.result?.report_id)throw Error('Save or reopen a complete review.');await this.submit('implementation.qc.'+(a==='source'?'source':'export'),{plan_id:this.plan.id,report_id:this.result.report_id});return;}
  if(a==='standalone-report'){
   if(!this.alive()||!this.result?.report_source)throw Error('Open the retained QC scientific source in its original workspace.');
   const selected=this.result,source=clone(selected.report_source),module=await import('./implementation_source_reports.mjs');
   if(!this.alive()||this.result!==selected)return;
   await module.openImplementationSourceReport(this.wb,[source],{title:'Sample quality review · saved revision '+selected.revision,closeEditor:()=>this.close()});return;
  }
  if(a==='prepare-report'){if(typeof this.host.openDelivery!=='function')throw Error('Select the retained QC report in the original scientific report source picker.');const s=clone(this.result.delivery_selection);this.close();await this.host.openDelivery(s);}
 }
}
export async function openImplementationQC(wb){
 if(!wb.native||!wb.nativePlan?.revision)throw Error('Save or reopen the original native plan before reviewing sample QC.');
 detachImplementationQC(wb);const editor=new SampleQCEditor(wb);wb.qcEditor=editor;
 try{await editor.start();}catch(e){if(e.name!=='AbortError')editor.fail(e);}return editor;
}
export function detachImplementationQC(wb){wb.qcEditor?.close();wb.qcEditor=null;}
