/* Source-native saved QC comparison within the existing Implementation desk. */
const SCHEMA='upstate.implementation-qc-comparison-selection/v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const canon=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(v=>JSON.parse(canon(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canon(x[k]))]))):x);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const obj=x=>x===null?'Not entered':typeof x==='object'?JSON.stringify(x):String(x??'');
const uid=()=>globalThis.crypto.randomUUID();
const opt=(v,l,s)=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(l)+'</option>';
const btn=(a,l,more='')=>'<button type="button" data-qcc="'+a+'" '+more+'>'+esc(l)+'</button>';
const field=(label,control)=>'<label><span>'+esc(label)+'</span>'+control+'</label>';
const input=(name,value,type='text')=>'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'">';
const area=(name,value)=>'<textarea name="'+esc(name)+'">'+esc(value)+'</textarea>';
const style='.iw-qcc{color:#171717;background:#fff;border:1px solid #555;width:min(1280px,94vw);max-width:none;max-height:94vh;padding:0;font:14px/1.5 system-ui,sans-serif}.iw-qcc::backdrop{background:#0008}.iw-qcc header{display:flex;justify-content:space-between;gap:18px;padding:16px;border-bottom:1px solid #aaa}.iw-qcc main{padding:16px}.iw-qcc h2{font-size:22px;margin:0}.iw-qcc h3{font-size:18px;margin:16px 0 8px}.iw-qcc p{margin:8px 0}.iw-qcc label{display:block}.iw-qcc label>span{display:block;font-weight:600}.iw-qcc input,.iw-qcc select,.iw-qcc textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:#fff;border:1px solid #999;padding:7px}.iw-qcc textarea{min-height:70px;resize:vertical}.iw-qcc button,.iw-qcc a{font:inherit;color:inherit;background:#f3f3f3;border:1px solid #888;padding:7px 10px;display:inline-block;overflow-wrap:anywhere}.iw-qcc button:disabled{opacity:.5}.iw-qcc .actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.iw-qcc .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.iw-qcc .box{border:1px solid #aaa;padding:12px;margin:12px 0}.iw-qcc .notice{background:#eee;border-left:3px solid #777;padding:10px}.iw-qcc .error{border:2px solid #444;padding:10px;white-space:pre-wrap}.iw-qcc .table{overflow:auto}.iw-qcc table{border-collapse:collapse;width:100%;font-size:12px}.iw-qcc th,.iw-qcc td{border:1px solid #aaa;text-align:left;padding:6px;vertical-align:top;overflow-wrap:anywhere}.iw-qcc th{background:#eee}.iw-qcc pre{white-space:pre-wrap;overflow-wrap:anywhere}.iw-qcc summary{cursor:pointer;padding:8px 0}.iw-qcc :focus-visible{outline:3px solid #555;outline-offset:2px}@media(max-width:700px){.iw-qcc .grid{grid-template-columns:1fr}.iw-qcc header{display:block}}';
function download(name,value){const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
class QCComparison{
 constructor(parent){
  this.parent=parent;this.wb=parent.wb;this.host=parent.host;this.workspace=parent.workspace;this.plan=parent.plan;
  this.key='upstate.implementation.qc-comparison/v1/'+this.workspace+'/'+this.plan.id;
  this.selection={schema:SCHEMA,plan_id:this.plan.id,before_report_id:'',after_report_id:'',title:this.plan.title+' — QC comparison',purpose:'',reviewer:'',as_of:new Date().toISOString().slice(0,10),notes:'',pairs:[]};
  Object.assign(this,{reviews:[],saved:[],before:null,after:null,pair:{before_group_id:'',after_group_id:'',basis:'',notes:''},preview:null,result:null,pending:null,history:[],error:'',notice:'',busy:false,closed:false,epoch:0,page:0,filter:'',controllers:new Set(),timer:null});
  try{const old=JSON.parse(localStorage.getItem(this.key)||'null');if(old?.selection?.schema===SCHEMA&&old.selection.plan_id===this.plan.id){this.selection=old.selection;this.pair={...this.pair,...old.pair};this.pending=old.pending||null;this.savedReport=old.savedReport||null;this.history=old.history||[];}}catch{this.notice='The saved local comparison draft could not be read.';}
  this.choices={before_report_id:this.selection.before_report_id,after_report_id:this.selection.after_report_id};
  this.node=document.createElement('dialog');this.node.className='iw-qcc';this.node.setAttribute('aria-label','Compare saved sample QC reviews');
  this.node.addEventListener('click',event=>{const b=event.target.closest('[data-qcc]');if(b&&this.node.contains(b)){event.preventDefault();event.stopPropagation();this.action(b).catch(e=>this.fail(e));}});
  for(const name of ['input','change'])this.node.addEventListener(name,e=>{e.stopPropagation();this.changed(e.target);});
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.wb.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&this.parent.alive()&&this.node.isConnected;}
 persist(){if(this.closed)return;try{localStorage.setItem(this.key,JSON.stringify({selection:this.selection,pair:this.pair,pending:this.pending,savedReport:this.savedReport,history:this.history}));}catch{this.notice='Browser storage is unavailable. Download the comparison draft and keep this view open while an original request is pending.';}}
 close(){if(this.closed)return;this.persist();this.closed=true;clearTimeout(this.timer);for(const c of this.controllers)c.abort();this.controllers.clear();this.node.close();this.node.remove();if(this.parent.comparisonEditor===this)this.parent.comparisonEditor=null;}
 fail(error){if(!this.alive()||error?.name==='AbortError')return;this.busy=false;this.error=error.message||String(error);this.render();}
 async request(path,params={},body){
  const c=new AbortController();this.controllers.add(c);
  try{const q={workspace:this.workspace,...params},url=this.host.endpoint?this.host.endpoint(path,q):path+'?'+new URLSearchParams(q),r=await this.host.api(url,body===undefined?{signal:c.signal}:{method:'POST',body:{workspace:this.workspace,...body},signal:c.signal});if(!this.alive())throw new DOMException('The original field desk changed.','AbortError');return r;}finally{this.controllers.delete(c);}
 }
 invalidate(){this.epoch++;this.preview=null;const preview=this.node.querySelector('[data-qcc-preview]');if(preview)preview.innerHTML='<p>Draft changed. Calculate the current explicit comparison before inspecting its preview.</p>';this.persist();}
 changed(el){
  if(el.name==='selection.before_report_id'||el.name==='selection.after_report_id'){this.choices[el.name.slice(10)]=el.value;this.invalidate();this.render();return;}
  if(el.name?.startsWith('selection.')){this.selection[el.name.slice(10)]=el.value;this.invalidate();return;}
  if(el.name?.startsWith('pair.')){this.pair[el.name.slice(5)]=el.value;this.persist();return;}
  if(el.name==='filter'){const position=el.selectionStart;this.filter=el.value;this.page=0;this.renderResult();const next=this.node.querySelector('[name="filter"]');if(next){next.focus({preventScroll:true});if(position!==null)next.setSelectionRange(position,position);}return;}
 }
 async refresh(){const [a,b]=await Promise.all([this.request('/api/implementation-qc/list',{plan_id:this.plan.id}),this.request('/api/implementation-qc/comparisons',{plan_id:this.plan.id})]);if(a.plan_id!==this.plan.id||b.plan_id!==this.plan.id)throw Error('Saved reports belong to another field plan.');this.reviews=a.reviews;this.saved=b.comparisons;}
 async start(){await this.refresh();if(this.selection.before_report_id&&this.selection.after_report_id)await this.loadSources(false);this.render();if(this.pending?.id)await this.poll();else if(this.savedReport)await this.inspect(this.savedReport);}
 async loadSources(reset){
  const ids=[this.choices.before_report_id,this.choices.after_report_id];if(!ids[0]||!ids[1]||ids[0]===ids[1])throw Error('Choose two distinct saved QC reviews.');
  const epoch=++this.epoch;this.busy=true;this.error='';this.render();
  try{
   const [before,after]=await Promise.all(ids.map(report_id=>this.request('/api/implementation-qc/inspect',{plan_id:this.plan.id,report_id})));
   if(epoch!==this.epoch)return;
   if([before,after].some((r,i)=>r.plan_id!==this.plan.id||r.report_id!==ids[i]))throw Error('A returned review differs from its exact selected source.');
   if(reset&&this.selection.pairs.length){this.history.push({retained_at:new Date().toISOString(),selection:clone(this.selection)});this.history=this.history.slice(-10);this.selection.pairs=[];this.pair={before_group_id:'',after_group_id:'',basis:'',notes:''};}
   this.selection.before_report_id=ids[0];this.selection.after_report_id=ids[1];this.before=before;this.after=after;this.preview=null;this.notice='Both original reviews are loaded. Pair groups explicitly; labels describe your chosen order, not inferred collection chronology.';this.persist();
  }finally{this.busy=false;if(this.alive())this.render();}
 }
 sourceCurrent(){return this.before?.report_id===this.selection.before_report_id&&this.after?.report_id===this.selection.after_report_id&&this.choices.before_report_id===this.selection.before_report_id&&this.choices.after_report_id===this.selection.after_report_id;}
 sourceOptions(which){const selected=this.choices[which+'_report_id'];return opt('','Choose a saved QC review',selected)+this.reviews.map(r=>opt(r.report_id,r.title+' · revision '+r.revision+' · '+r.as_of+' · '+r.report_id.slice(0,12),selected)).join('');}
 groupOptions(side){return opt('','Choose an original group',this.pair[side+'_group_id'])+(this[side]?.review.groups||[]).map(g=>opt(g.id,g.id+' · '+g.relationship+' · '+g.observation_ids.join(', '),this.pair[side+'_group_id'])).join('');}
 pendingHtml(){const p=this.pending;if(!p)return '';return '<section class="box"><h3>Original queued comparison operation</h3><p>'+esc(p.action)+' · '+esc(p.state)+' · '+esc(p.id||p.operation_id)+'</p><div class="actions">'+(!p.id?btn('retry','Recover original request'):btn('poll','Refresh original task')+btn('task','Open native task')+((p.state==='failed'||p.state==='interrupted')?btn('resume','Resume original task'):''))+btn('request-json','Download exact retained request')+'</div></section>';}
 render(){
  if(!this.alive())return;const s=this.selection,p=this.pair;
  this.node.innerHTML='<style>'+style+'</style><header><div><h2>Compare saved sample QC reviews</h2><p>'+esc(this.plan.title)+' · original field plan '+esc(this.plan.id)+'</p></div>'+btn('close','Close and retain draft')+'</header><main>'+
   (this.error?'<div class="error" role="alert">'+esc(this.error)+'</div>':'')+(this.notice?'<p class="notice" role="status">'+esc(this.notice)+'</p>':'')+this.pendingHtml()+
   '<p>Select two original saved reviews and declare why the chosen groups form a useful before/after comparison. Original results, criteria, applicability and field-task decisions remain attached to their source.</p>'+
   '<section class="box"><h3>Original review editions</h3><div class="grid">'+field('Before review','<select name="selection.before_report_id">'+this.sourceOptions('before')+'</select>')+field('After review','<select name="selection.after_report_id">'+this.sourceOptions('after')+'</select>')+'</div><div class="actions">'+btn('load','Load selected reviews and start explicit pair selection',this.busy?'disabled':'')+btn('refresh','Refresh saved report catalog')+'</div>'+
   (!this.sourceCurrent()?'<p class="notice">Load the selected original reviews before pairing or saving.</p>':'<p>Loaded revisions '+esc(this.before.revision)+' → '+esc(this.after.revision)+'. Complete original sources remain available in the saved comparison package.</p>')+'</section>'+
   '<div class="grid">'+field('Comparison title',input('selection.title',s.title))+field('Reviewer',input('selection.reviewer',s.reviewer))+field('Comparison date',input('selection.as_of',s.as_of,'date'))+field('Scientific purpose',area('selection.purpose',s.purpose))+field('Comparison notes',area('selection.notes',s.notes))+'</div>'+
   '<section class="box"><h3>Explicit group pair</h3><div class="grid">'+field('Before group','<select name="pair.before_group_id">'+this.groupOptions('before')+'</select>')+field('After group','<select name="pair.after_group_id">'+this.groupOptions('after')+'</select>')+field('Relationship and source basis',area('pair.basis',p.basis))+field('Pair notes',area('pair.notes',p.notes))+'</div><div class="actions">'+btn('add','Add this explicit pair',this.sourceCurrent()?'':'disabled')+'</div><p>Every original group can appear once on its side. Unpaired groups remain listed in the retained comparison.</p></section>'+
   '<h3>Selected group pairs · '+s.pairs.length+'</h3><div class="table"><table><thead><tr><th>Before</th><th>After</th><th>Authored basis</th><th>Notes</th><th>Change</th></tr></thead><tbody>'+s.pairs.map((r,i)=>'<tr><td>'+esc(r.before_group_id)+'</td><td>'+esc(r.after_group_id)+'</td><td>'+esc(r.basis)+'</td><td>'+esc(r.notes)+'</td><td>'+btn('remove','Remove','data-index="'+i+'"')+'</td></tr>').join('')+'</tbody></table></div>'+
   '<div class="actions">'+btn('preview','Calculate comparison',this.busy||!this.sourceCurrent()?'disabled':'')+btn('save','Save complete native comparison',this.busy||this.pending||!this.sourceCurrent()?'disabled':'')+btn('selection-json','Download current draft and prior selections')+'</div>'+
   '<div data-qcc-preview>'+this.previewHtml()+'</div><section class="box"><h3>Saved comparisons</h3>'+(this.saved.length?this.saved.map(r=>'<p>'+esc(r.title)+' · '+esc(r.as_of)+' · '+r.summary.comparable+' comparable / '+r.summary.withheld+' withheld '+btn('open','Open exact saved comparison','data-report="'+esc(r.comparison_report_id)+'"')+'</p>').join(''):'<p>No saved comparison in this original plan.</p>')+'</section><div data-qcc-result></div></main>';
  this.renderResult();
 }
 previewHtml(){return this.preview?'<section class="box"><h3>Current unsaved comparison preview</h3><p>'+this.preview.summary.comparable+' comparable; '+this.preview.summary.withheld+' withheld. '+esc(this.preview.notice)+'</p>'+this.cards(this.preview.pairs.slice(0,20))+(this.preview.pairs.length>20?'<p>Preview shows the first20 pairs. Download the complete current preview; the saved comparison offers all pairs.</p>':'')+btn('preview-json','Download complete preview')+'</section>':'';}
 cards(rows){return rows.map(r=>'<article class="box"><h3>'+esc(r.before_group_id)+' → '+esc(r.after_group_id)+'</h3><p>'+esc(r.basis)+'</p><div class="grid"><section><h4>Before original review</h4><p>'+esc(r.before_metric)+': '+esc(r.before_value??'Unavailable')+'</p><p>'+esc(r.before.outcome)+'</p><pre>'+esc(JSON.stringify({definitions:r.before.definitions,criterion:r.before.criterion,observations:r.before.observation_ids,reasons:r.before.reasons,warnings:r.before.warnings},null,2))+'</pre></section><section><h4>After original review</h4><p>'+esc(r.after_metric)+': '+esc(r.after_value??'Unavailable')+'</p><p>'+esc(r.after.outcome)+'</p><pre>'+esc(JSON.stringify({definitions:r.after.definitions,criterion:r.after.criterion,observations:r.after.observation_ids,reasons:r.after.reasons,warnings:r.after.warnings},null,2))+'</pre></section></div><p><strong>After minus before:</strong> '+esc(r.after_minus_before===null?'Withheld':r.after_minus_before)+' '+esc(r.after_minus_before===null?'':r.delta_unit)+'</p>'+(r.reasons.length?'<p>Why withheld: '+esc(r.reasons.join('; '))+'</p>':'')+'<p>'+esc(r.notes)+'</p></article>').join('');}
 renderResult(){
  const node=this.node.querySelector('[data-qcc-result]');if(!node)return;const r=this.result;if(!r){node.innerHTML='';return;}const v=r.comparison,q=this.filter.toLowerCase(),rows=v.pairs.filter(x=>!q||JSON.stringify(x).toLowerCase().includes(q)),max=Math.max(0,Math.ceil(rows.length/20)-1);this.page=Math.min(this.page,max);
  const controls='<div class="actions">'+btn('result-json','Download complete comparison JSON')+btn('export','Export complete original source package',this.pending?'disabled':'')+btn('source','Retain scientific report source',this.pending?'disabled':'')+(r.report_source?btn('scientific-report','Open this comparison in Scientific Reports'):'')+'</div>';
  node.innerHTML='<section class="box"><h3>Exact saved comparison · '+esc(v.title)+'</h3><p>'+esc(v.reviewer)+' · '+esc(v.as_of)+' · report '+esc(r.comparison_report_id)+'</p><p>'+esc(v.notice)+'</p><p>Before original review '+esc(v.original.before.report_id)+'; after '+esc(v.original.after.report_id)+'.</p>'+controls+field('Find saved pairs / source context',input('filter',this.filter,'search'))+
   '<p>'+rows.length+' matching pairs of '+v.pairs.length+'; page '+(this.page+1)+' of '+(max+1)+'.</p><div class="actions">'+btn('prev','Previous pairs',this.page===0?'disabled':'')+btn('next','Next pairs',this.page===max?'disabled':'')+'</div>'+this.cards(rows.slice(this.page*20,this.page*20+20))+
   '<p>Unpaired before: '+esc(v.unpaired_before.join(', ')||'None')+'. Unpaired after: '+esc(v.unpaired_after.join(', ')||'None')+'.</p>'+
   '<details><summary>All retained report/source downloads</summary><p>For each unchanged original review, download before-review.zip or after-review.zip, extract it and open report.html. The complete comparison archive contains both.</p><ul>'+(r._downloads||[]).map(f=>'<li><a href="'+esc(f.url+(f.url.includes('?')?'&':'?')+'download=1')+'" download="'+esc(f.filename||f.name||'')+'">'+esc(f.filename||f.name||f.url)+'</a> · '+esc(f.bytes)+' bytes</li>').join('')+'</ul></details></section>';
 }
 async inspect(id){const turn=++this.epoch;const r=await this.request('/api/implementation-qc/comparison-inspect',{plan_id:this.plan.id,comparison_report_id:id});if(turn!==this.epoch)return;if(r.plan_id!==this.plan.id||r.comparison_report_id!==id)throw Error('The returned comparison belongs to another original selection.');this.result=r;this.savedReport=id;this.page=0;this.filter='';this.persist();this.render();}
 validateTask(task,p){
  if(task.workspace!==this.workspace||task.action!==p.action||canon(task.payload)!==canon(p.payload))throw Error('The native task differs from the retained original comparison request.');
  if(typeof task.id!=='string'||!/^[a-f0-9]{64}$/.test(task.id)||!task.operation_id)throw Error('The native task identity is incomplete.');
  if(p.id&&(p.id!==task.id||p.accepted_operation_id!==task.operation_id))throw Error('The original accepted comparison task identity changed.');
  return task;
 }
 async submit(action,payload){if(this.pending)throw Error('Recover the original pending comparison task first.');this.pending={action,payload:clone(payload),operation_id:uid(),state:'submitting'};this.persist();this.render();await this.retry();}
 async retry(){const p=this.pending;if(!p||p.id)return;try{const r=await this.request('/api/actions',{}, {action:p.action,payload:p.payload,operation_id:p.operation_id}),t=this.validateTask(r.task||r,p);p.id=t.id;p.accepted_operation_id=t.operation_id;p.state=t.state;this.persist();await this.poll();}catch(e){if(this.alive()&&this.pending===p){p.state='response_unconfirmed';this.persist();}throw e;}}
 async poll(){
  clearTimeout(this.timer);const p=this.pending;if(!p?.id||!this.alive())return;
  const r=await this.request('/api/task',{id:p.id}),task=this.validateTask(r.task||r,p);if(this.pending!==p)return;p.state=task.state;this.persist();
  if(task.state==='complete'){
   const v=task.result||{};if(v.plan_id!==this.plan.id||!v.comparison_report_id||v.comparison?.schema!=='upstate.implementation-qc-comparison/v1')throw Error('The completed task lacks its original comparison.');
   this.result={...v,_downloads:task._downloads||v._downloads||[]};this.savedReport=v.comparison_report_id;this.pending=null;this.error='';this.notice=task._qc_export?.message||'The exact original comparison operation completed and is retained.';this.persist();this.render();await this.refresh();this.render();return;
  }
  if(task.state==='failed'||task.state==='interrupted'){this.error=task.error?.message||'The original task '+task.state+'.';this.render();return;}
  this.render();this.timer=setTimeout(()=>this.poll().catch(e=>this.fail(e)),2000);
 }
 async action(b){
  const action=b.dataset.qcc;
  if(action==='close'){this.close();return;}
  if(action==='refresh'){await this.refresh();this.render();return;}
  if(action==='load'){await this.loadSources(true);return;}
  if(action==='add'){
   if(!this.sourceCurrent())throw Error('Load the exact original selected reviews.');
   const p=this.pair;if(!p.basis.trim()||!this.before.review.groups.some(g=>g.id===p.before_group_id)||!this.after.review.groups.some(g=>g.id===p.after_group_id))throw Error('Choose both actual groups and state their relationship/source basis.');
   if(this.selection.pairs.some(r=>r.before_group_id===p.before_group_id||r.after_group_id===p.after_group_id))throw Error('Each group can appear only once on its original side.');
   this.selection.pairs.push({id:uid(),...clone(p)});this.pair={before_group_id:'',after_group_id:'',basis:'',notes:''};this.invalidate();this.render();return;
  }
  if(action==='remove'){this.selection.pairs.splice(Number(b.dataset.index),1);this.invalidate();this.render();return;}
  if(action==='selection-json'){download(this.plan.id+'-qc-comparison-drafts.json',{selection:this.selection,prior_selections:this.history});return;}
  if(action==='preview-json'){download('qc-comparison-preview.json',this.preview);return;}
  if(action==='preview'){const turn=++this.epoch,selected=clone(this.selection);this.busy=true;this.error='';this.render();try{const r=await this.request('/api/implementation-qc/comparison-preview',{}, {selection:selected});if(turn!==this.epoch)return;this.preview=r.comparison;}finally{this.busy=false;if(this.alive())this.render();}return;}
  if(action==='save'){if(!this.sourceCurrent())throw Error('Load the selected original reviews.');await this.submit('implementation.qc.comparison.save',{selection:this.selection});return;}
  if(action==='open'){await this.inspect(b.dataset.report);return;}
  if(action==='retry'){await this.retry();return;}
  if(action==='poll'){await this.poll();return;}
  if(action==='task'){this.host.showTask?.(this.pending.id);return;}
  if(action==='request-json'){download('qc-comparison-original-request.json',this.pending);return;}
  if(action==='resume'){await this.request('/api/task/resume',{}, {id:this.pending.id});await this.poll();return;}
  if(action==='prev'||action==='next'){this.page+=action==='prev'?-1:1;this.renderResult();return;}
  if(action==='result-json'){download('qc-comparison.json',this.result.comparison);return;}
  if(action==='export'||action==='source'){if(!this.result?.comparison_report_id)throw Error('Open an original saved comparison.');await this.submit('implementation.qc.comparison.'+(action==='export'?'export':'source'),{plan_id:this.plan.id,comparison_report_id:this.result.comparison_report_id});return;}
  if(action==='scientific-report'){
   const result=this.result;if(!result?.report_source)throw Error('Retain the original comparison source first.');const module=await import('./implementation_source_reports.mjs');if(!this.alive()||this.result!==result)return;
   await module.openImplementationSourceReport(this.wb,[clone(result.report_source)],{title:result.comparison.title,closeEditor:()=>this.parent.close()});return;
  }
 }
}
export async function openQCComparison(parent){const editor=new QCComparison(parent);parent.comparisonEditor=editor;try{await editor.start();}catch(e){editor.fail(e);}return editor;}
