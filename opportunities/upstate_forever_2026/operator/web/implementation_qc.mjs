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
  Object.assign(this,{records:[],reviews:[],review:null,result:null,pending:null,error:'',notice:'',filter:'',page:0,rowPage:0,editing:null,closed:false,busy:false});
  this.selected=new Set();this.associated=new Set();this.controllers=new Set();this.timer=null;this.displayEpoch=0;
  this.selection={schema:SCHEMA,plan_id:this.plan.id,revision:this.plan.revision,title:this.plan.title+' — sample QC',purpose:'',reviewer:'',as_of:wb.asOf||new Date().toISOString().slice(0,10),notes:'',groups:[]};
  this.form={kind:'duplicate',relationship:'field_duplicate',relationship_basis:'',notes:'',metric:'',maximum:'',source:'',applicability:'',minimum_quantitation_multiple:'',accepted_qualifiers:'[""]',accepted_qa_statuses:'[""]'};
  try{const old=JSON.parse(localStorage.getItem(this.key)||'null');if(old?.selection?.plan_id===this.plan.id&&old.selection.revision===this.plan.revision&&old.selection.schema===SCHEMA){this.selection=old.selection;this.form={...this.form,...old.form};this.selected=new Set(old.selected||[]);this.associated=new Set(old.associated||[]);this.editing=old.editing||null;this.pending=old.pending||null;this.savedReport=old.savedReport||null;}}
  catch{this.notice='The prior browser draft could not be read. Export selection JSON to retain an independent copy.';}
  this.node=document.createElement('dialog');this.node.className='iw-qc';this.node.setAttribute('aria-label','Sample quality-control review');
  this.node.addEventListener('click',e=>{const b=e.target.closest('[data-qc]');if(b&&this.node.contains(b)){e.preventDefault();e.stopPropagation();this.action(b).catch(x=>this.fail(x));}});
  for(const name of ['input','change'])this.node.addEventListener(name,e=>{e.stopPropagation();this.changed(e);});
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  wb.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&!this.wb.gone&&this.wb.workspace===this.workspace&&this.host.getState?.()?.workspace_key===this.workspace&&this.node.isConnected;}
 persist(){if(this.closed)return;try{localStorage.setItem(this.key,JSON.stringify({selection:this.selection,form:this.form,selected:[...this.selected],associated:[...this.associated],editing:this.editing,pending:this.pending,savedReport:this.savedReport}));}catch{this.notice='Browser storage is unavailable. Export selection JSON and keep this view open while a native request is pending.';}}
 fail(e){if(this.alive()){this.busy=false;this.error=e?.message||String(e);this.render();}}
 async request(path,params={},body){
  const c=new AbortController();this.controllers.add(c);
  try{const q={workspace:this.workspace,...params},url=this.host.endpoint?this.host.endpoint(path,q):path+'?'+new URLSearchParams(q);
   const r=await this.host.api(url,body===undefined?{signal:c.signal}:{method:'POST',body:{workspace:this.workspace,...body},signal:c.signal});
   if(!this.alive())throw new DOMException('The workspace or editor changed.','AbortError');return r;
  }finally{this.controllers.delete(c);}
 }
 async start(){const r=await this.request('/api/implementation-qc/records',{plan_id:this.plan.id,revision:this.plan.revision});if(r.workspace_key!==this.workspace||r.plan_id!==this.plan.id||r.revision!==this.plan.revision)throw Error('The native result belongs to another plan.');this.records=r.records;this.reviews=r.reviews;this.render();if(this.pending?.id)await this.poll();else if(this.savedReport)await this.inspect(this.savedReport);}
 close(){this.persist();this.closed=true;clearTimeout(this.timer);for(const c of this.controllers)c.abort();this.controllers.clear();this.node.close();this.node.remove();if(this.wb.qcEditor===this)this.wb.qcEditor=null;}
 changed(e){
  const el=e.target;if(el.dataset.role){const s=el.dataset.role==='control'?this.selected:this.associated;el.checked?s.add(el.value):s.delete(el.value);this.persist();this.counts();return;}
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
  if(this.closed)return;const s=this.selection,f=this.form,p=this.pending;
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
   (this.result?.report_id?'<div class="qc-actions">'+button('source','Register with scientific reports',this.pending?'disabled':'')+button('archive','Complete report and sources ZIP',this.pending?'disabled':'')+'</div><p>Retained in the original plan’s report history and full Workspace archive.</p>':'<p>Save the complete review to retain its report and source edition.</p>')+
   (this.result?'<div class="qc-actions">'+(this.result._downloads||[]).filter(d=>/report\.html|qc-results\.csv|\.zip$/.test(d.label||d.name||'')).map(d=>'<a class="qc-button" href="'+esc(d.url)+'" target="_blank" rel="noopener">'+esc(d.label||d.name||'Retained file')+'</a>').join('')+'</div>':'')+
   (this.result?.delivery_selection?'<div class="qc-actions">'+button('prepare-report','Prepare scientific/client report')+'</div>':'')+'</section>';
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
  if(a==='prepare-report'){if(typeof this.host.openDelivery!=='function')throw Error('Select the retained QC report in the original scientific report source picker.');const s=clone(this.result.delivery_selection);this.close();await this.host.openDelivery(s);}
 }
}
export async function openImplementationQC(wb){
 if(!wb.native||!wb.nativePlan?.revision)throw Error('Save or reopen the original native plan before reviewing sample QC.');
 detachImplementationQC(wb);const editor=new SampleQCEditor(wb);wb.qcEditor=editor;
 try{await editor.start();}catch(e){if(e.name!=='AbortError')editor.fail(e);}return editor;
}
export function detachImplementationQC(wb){wb.qcEditor?.close();wb.qcEditor=null;}
