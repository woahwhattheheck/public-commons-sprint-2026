import {createEconomicRecoveryStore} from './economic_request_store.mjs';
import {clone,esc,parseMoney,money} from './implementation_core.mjs';
const SHA=/^[a-f0-9]{64}$/;
const ACTION='implementation.cost-review.apply';
const SCHEMA='upstate.implementation-cost-review-selection/v1';
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const id=()=>globalThis.crypto?.randomUUID?.()||'cost-review-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const dollars=value=>Number.isSafeInteger(value)?Math.floor(value/100)+'.'+String(value%100).padStart(2,'0'):'';
const opt=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const btn=(action,label,disabled=false,extra='')=>'<button type="button" data-cr-action="'+action+'"'+(disabled?' disabled':'')+' '+extra+'>'+esc(label)+'</button>';
const field=(label,body)=>'<label><span>'+esc(label)+'</span>'+body+'</label>';
const json=value=>'<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';
function download(name,value){const href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
function safeURL(value){try{const u=new URL(value,location.href);return u.origin===location.origin&&/^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
function validPending(p,planId){return p?.action===ACTION&&typeof p.operation_id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(p.operation_id)&&p.payload?.plan_id===planId&&Number.isSafeInteger(p.payload.revision)&&p.payload.revision>0&&SHA.test(p.payload.document_digest||'')&&SHA.test(p.payload.expected_operation_id||'')&&typeof p.payload.candidate_id==='string'&&p.payload.review?.schema===SCHEMA;}
function blankReview(context){
 const rows={};for(const row of context.ledger_rows||[])if(row.kind==='actual')rows[row.id]={classification:row.decision_required?'':'exclude',reason:row.decision_required?'':'Not selected for this candidate cost review',amount:'',allocation_reason:'',attribution_reason:'',acknowledge_undated:false};
 const forecast=()=>({amount:'',source:{title:'',uri:'',as_of:''},note:''});
 return {as_of:new Date().toISOString().slice(0,10),row_decisions:rows,remaining_capital:forecast(),annual_operating:forecast(),override_financial:!context.original_cost,financial_parameters:{horizon_years:context.original_cost?.horizon_years??'',discount_rate:context.original_cost?.discount_rate??'',reason:''},scope:{kind:'',note:''},note:'',acknowledge_currency_change:false};
}
function fromReview(value){
 if(!value||value.schema!==SCHEMA||!value.row_decisions||typeof value.row_decisions!=='object'||Array.isArray(value.row_decisions))throw Error('Choose an original cost review selection JSON.');
 const result=clone(value);result.row_decisions=Object.fromEntries(Object.entries(value.row_decisions).map(([key,row])=>[key,{...row,amount:row.amount_minor===undefined?'':dollars(row.amount_minor)}]));
 for(const key of ['remaining_capital','annual_operating']){if(!value[key]?.source)throw Error('The original review needs both forecast sources.');result[key]={...clone(value[key]),amount:dollars(value[key].amount_minor)};}
 result.override_financial=!!value.financial_parameters;result.financial_parameters=value.financial_parameters||{horizon_years:'',discount_rate:'',reason:''};return result;
}
function toReview(draft,context){
 const row_decisions={};
 for(const [key,row]of Object.entries(draft.row_decisions||{})){
  if(!row.classification)continue;
  const chosen={classification:row.classification,reason:row.reason||'',allocation_reason:row.allocation_reason||'',attribution_reason:row.attribution_reason||'',acknowledge_undated:!!row.acknowledge_undated};
  if(row.classification==='exclude')chosen.amount_minor=0;else if(String(row.amount??'').trim())chosen.amount_minor=parseMoney(row.amount);
  row_decisions[key]=chosen;
 }
 const forecast=key=>{const v=draft[key];return {amount_minor:parseMoney(v.amount),source:clone(v.source),note:v.note||''};};
 const result={schema:SCHEMA,as_of:draft.as_of,row_decisions,remaining_capital:forecast('remaining_capital'),annual_operating:forecast('annual_operating'),scope:clone(draft.scope),note:draft.note||'',acknowledge_currency_change:!!draft.acknowledge_currency_change};
 if(draft.override_financial||!context.original_cost){
  const f=draft.financial_parameters,number=(v,name)=>{if(String(v??'').trim()===''||!Number.isFinite(Number(v)))throw Error('Enter '+name+'.');return Number(v);};
  result.financial_parameters={horizon_years:number(f.horizon_years,'the reviewed horizon'),discount_rate:number(f.discount_rate,'the reviewed real discount rate'),reason:f.reason||''};
 }
 return result;
}
const styles='.iw-cost-review{width:min(1320px,96vw);max-width:none;max-height:94vh;padding:0;border:1px solid #777;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif}.iw-cost-review::backdrop{background:#0007}.iw-cost-review header{padding:18px;border-bottom:1px solid #ccc;background:#fff;display:flex;justify-content:space-between;gap:15px;position:sticky;top:0;z-index:2}.iw-cost-review main{padding:18px}.iw-cost-review h2{margin:0;font-size:23px}.iw-cost-review h3{margin:0 0 10px}.iw-cost-review p{margin:8px 0}.iw-cost-review button,.iw-cost-review input,.iw-cost-review select,.iw-cost-review textarea{font:inherit;border:1px solid #888;border-radius:3px;padding:8px;background:#fff;color:inherit}.iw-cost-review button{cursor:pointer}.iw-cost-review button:disabled{opacity:.5;cursor:default}.iw-cost-review input:not([type=checkbox]),.iw-cost-review select,.iw-cost-review textarea{box-sizing:border-box;width:100%}.iw-cost-review label{display:block}.iw-cost-review label>span{display:block;font-weight:600;margin-bottom:4px}.iw-cost-review textarea{min-height:75px}.iw-cost-review .cr-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.iw-cost-review .cr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.iw-cost-review .cr-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.iw-cost-review .cr-box{padding:14px;border:1px solid #ccc;margin:14px 0}.iw-cost-review .cr-note{padding:12px;background:#f2f2f2;border-left:3px solid #777}.iw-cost-review .cr-error{padding:12px;background:#f6f6f6;border:1px solid #777;white-space:pre-wrap}.iw-cost-review .cr-meta{font-size:12px;color:#444;overflow-wrap:anywhere}.iw-cost-review .cr-table{overflow:auto}.iw-cost-review table{width:100%;border-collapse:collapse}.iw-cost-review td,.iw-cost-review th{vertical-align:top;text-align:left;padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}.iw-cost-review th{background:#f2f2f2}.iw-cost-review pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;padding:10px;background:#f7f7f7}.iw-cost-review .cr-primary{background:#303030;color:#fff}.iw-cost-review a{color:#202020}.iw-cost-review details{margin:12px 0}.iw-cost-review dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}.iw-cost-review dd{margin:0;text-align:right}@media(max-width:760px){.iw-cost-review .cr-grid,.iw-cost-review .cr-three{grid-template-columns:1fr}.iw-cost-review header{display:block}.iw-cost-review main{padding:12px}}';

export class ImplementationCostReview{
 constructor(w){
  this.w=w;this.host=w.host;this.workspace=w.workspace;this.planId=w.plan.id;this.savedPlan=clone(w.nativePlan);this.generation=w.generation;this.planStamp=stable(w.plan);this.digest=null;this.closed=false;this.busy=false;this.controllers=new Set();this.timer=null;this.turn=0;
  this.catalog=null;this.context=null;this.candidateId='';this.drafts={};this.draft=null;this.preview=null;this.previewStamp=null;this.receipt=null;this.pending=null;this.error='';this.notice='';this.storageIssue='';this.query='';this.filter='required';this.page=0;this.selectedRow=null;
  this.storageKey='upstate.implementation-cost-review/v1/'+this.workspace+'/'+this.planId;
  this.recoveryStore=createEconomicRecoveryStore(this.workspace,'implementation-cost-review/'+this.planId,this.storageKey);
  this.node=document.createElement('dialog');this.node.className='iw-cost-review';this.node.setAttribute('aria-label','Review implementation costs in the original Economic scenario');
  this.node.addEventListener('click',e=>{const b=e.target.closest('[data-cr-action]');if(!b||!this.node.contains(b))return;e.preventDefault();e.stopPropagation();this.action(b).catch(error=>this.fail(error));});
  this.node.addEventListener('input',e=>this.input(e.target));
  this.node.addEventListener('change',e=>this.change(e.target).catch(error=>this.fail(error)));
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  w.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&!this.w.gone&&this.w.generation===this.generation&&this.w.workspace===this.workspace&&this.host.getState?.()?.workspace_key===this.workspace&&this.w.plan?.id===this.planId&&stable(this.w.plan)===this.planStamp&&this.node.isConnected;}
 current(){if(!this.alive())throw new DOMException('The original implementation plan changed while its cost review was open.','AbortError');}
 locked(){return this.busy||!!this.pending||this.restoreBlocked;}
 draftKey(){return this.digest+'/'+this.candidateId;}
 state(){
  if(this.draft&&this.digest&&this.candidateId)this.drafts[this.draftKey()]=clone(this.draft);
  return {schema:'upstate.implementation-cost-review-draft/v1',workspace_key:this.workspace,plan_id:this.planId,candidate_id:this.candidateId,drafts:this.drafts,pending:this.pending,receipt:this.receipt?{...this.receipt,draft:{id:this.receipt.draft?.id,title:this.receipt.draft?.title},edition:{id:this.receipt.edition?.id,title:this.receipt.edition?.title,open_url:this.receipt.edition?.open_url},files:[],_downloads:[]}:null};
 }
 restore(value){
  if(!value)return;
  if(value.workspace_key!==this.workspace||value.plan_id!==this.planId)throw Error('The retained cost review belongs to another original plan.');
  if(value.pending&&!validPending(value.pending,this.planId))throw Error('The retained cost request is incomplete. Open the exact original recovery file.');
  this.context=null;this.draft=null;this.preview=null;this.previewStamp=null;this.selectedRow=null;this.page=0;
  this.drafts=value.drafts||{};this.candidateId=value.candidate_id||'';this.receipt=value.receipt||null;this.pending=value.pending||null;
 }
 async persist({required=false}={}){
  if(this.closed||this.restoreBlocked){if(required)throw Error('Recover the original retained cost state first.');return false;}
  try{const result=await this.recoveryStore.save(this.state());this.storageIssue=result.warning||'';return true;}
  catch(error){this.storageIssue=error.message||String(error);if(required)throw error;return false;}
 }
 fail(error){if(error?.name==='AbortError'||!this.alive())return;this.error=error?.message||String(error);this.busy=false;this.render();}
 close(){if(this.closed)return;this.persist();this.closed=true;this.turn++;clearTimeout(this.timer);for(const c of this.controllers)c.abort();this.controllers.clear();this.node.close();this.node.remove();if(this.w.costReviewEditor===this)this.w.costReviewEditor=null;}
 async request(path,values={},body){this.current();const c=new AbortController();this.controllers.add(c);try{const r=await this.host.api(this.host.endpoint(path,{workspace:this.workspace,...values}),{...(body===undefined?{}:{method:'POST',body}),signal:c.signal});this.current();return r;}finally{this.controllers.delete(c);}}
 base(){return {plan_id:this.planId,revision:this.savedPlan.revision,document_digest:this.digest};}
 checkBinding(value){const b=value.binding||{},p=value.plan||value.context?.plan;if(value.workspace_key!==this.workspace||b.plan_id!==this.planId||b.revision!==this.savedPlan.revision||b.document_digest!==this.digest||b.candidate_id!==this.candidateId||(p&&p.id!==this.planId))throw Error('The cost source differs from the selected saved plan and scenario.');}
 async start(){
  try{const loaded=await this.recoveryStore.load();this.current();this.restore(loaded.state);this.storageIssue=loaded.warning||'';}catch(error){this.restoreBlocked=true;this.error=error.message||String(error);this.render();return;}
  if(this.restoreBlocked)return;
  await this.startNative();
 }
 async startNative(){
  this.busy=true;this.render();
  try{
   const detail=await this.request('/api/implementation/detail',{id:this.planId,revision:this.savedPlan.revision});
   if(detail.workspace_key!==this.workspace||stable(detail.plan)!==stable(this.savedPlan)||!SHA.test(detail.document_digest||''))throw Error('The original saved plan changed. Reopen it before reviewing its ledger.');
   this.digest=detail.document_digest;
   const catalog=await this.request('/api/implementation-costs/catalog',this.base());
   if(catalog.workspace_key!==this.workspace||catalog.plan?.id!==this.planId||catalog.plan?.revision!==this.savedPlan.revision||(catalog.plan.sha256||catalog.plan.document_digest)!==this.digest||!Array.isArray(catalog.candidates))throw Error('The cost catalogue differs from the original saved plan.');
   this.catalog=catalog;
   if(this.pending?.id)await this.poll();
   if(!this.context&&this.candidateId&&catalog.candidates.some(row=>row.id===this.candidateId)&&!this.pending)await this.loadContext(this.candidateId);
   if(this.receipt&&!this.pending)await this.refreshReceipt();
  }finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async loadContext(candidateId){
  if(this.pending)throw Error('Finish or recover the retained cost request before changing scenarios.');
  this.persist();this.candidateId=candidateId;this.context=null;this.draft=null;this.preview=null;this.previewStamp=null;this.selectedRow=null;this.page=0;
  if(!candidateId){this.render();return;}
  if(!this.catalog?.candidates.some(row=>row.id===candidateId))throw Error('Choose a candidate linked to an original Economic scenario.');
  const turn=++this.turn;this.busy=true;this.render();
  try{const value=await this.request('/api/implementation-costs/context',{}, {...this.base(),candidate_id:candidateId});if(turn!==this.turn)return;this.checkBinding(value);this.context=value;this.draft=clone(this.drafts[this.draftKey()]||blankReview(value));this.persist();}
  finally{if(this.alive()&&turn===this.turn){this.busy=false;this.render();}}
 }
 invalidate(){this.preview=null;this.previewStamp=null;this.error='';this.persist();const box=this.node.querySelector('[data-cr-preview]');if(box)box.innerHTML=this.previewHtml();}
 input(target){
  if(target.dataset.cr==='query'){this.query=target.value;this.page=0;this.renderRows();return;}
  if(this.locked()||!this.draft)return;
  const path=target.dataset.crField;if(!path)return;
  const parts=path.split('.');let object=this.draft;for(const key of parts.slice(0,-1)){if(!object[key])object[key]={};object=object[key];}
  object[parts.at(-1)]=target.type==='checkbox'?target.checked:target.value;this.invalidate();
 }
 async change(target){
  if(target.dataset.cr==='recovery-file'){
   const file=target.files?.[0];target.value='';if(!file)return;if(this.busy)throw Error('Wait for the original request before opening a recovery file.');if(file.size>128*1024*1024)throw Error('Choose a recovery file within 128 MiB.');const value=JSON.parse(await file.text());this.current();const state=await this.recoveryStore.importFile(value,this.pending);this.current();this.restore(state);this.restoreBlocked=false;this.storageIssue=this.recoveryStore.warning;this.preview=null;this.previewStamp=null;this.error='';
   if(!this.digest||!this.catalog)await this.startNative();else{if(this.pending?.id)await this.poll();if(!this.pending&&!this.context&&this.candidateId&&this.catalog.candidates.some(x=>x.id===this.candidateId))await this.loadContext(this.candidateId);}this.render();return;
  }
  if(target.dataset.cr==='candidate'){if(this.locked())throw Error('Recover the original request first.');await this.loadContext(target.value);return;}
  if(target.dataset.cr==='filter'){this.filter=target.value;this.page=0;this.renderRows();return;}
  if(target.dataset.cr==='review-file'){
   const file=target.files?.[0];target.value='';if(!file)return;if(this.locked()||!this.context)throw Error('Choose the original saved candidate first.');if(file.size>16*1024*1024)throw Error('Choose a cost review within 16 MiB.');
   const loaded=JSON.parse(await file.text());this.current();const review=loaded.review||loaded;
   if(loaded.binding&&stable(loaded.binding)!==stable(this.context.binding))throw Error('This review belongs to a different original saved plan or scenario.');
   this.draft=loaded.schema==='upstate.implementation-cost-review-browser-draft/v1'?clone(loaded.draft):fromReview(review);if(!this.draft?.row_decisions||!this.draft.remaining_capital?.source||!this.draft.annual_operating?.source||!this.draft.scope||!this.draft.financial_parameters)throw Error('The retained review draft is incomplete.');this.invalidate();this.notice='Original review selection loaded. Preview it against the current saved binding before saving.';this.render();return;
  }
  if(target.dataset.crField){this.input(target);if(target.dataset.crField==='override_financial')this.render();}
 }
 async prepare(){
  if(this.locked()||this.w.pending)throw Error('Finish the original plan or cost request first.');
  if(!this.context||!this.draft)throw Error('Choose the original Economic candidate.');
  const review=toReview(this.draft,this.context),stamp=stable(review);this.preview=null;this.previewStamp=null;this.busy=true;this.error='';this.render();
  try{const value=await this.request('/api/implementation-costs/preview',{}, {...this.base(),candidate_id:this.candidateId,review});this.checkBinding(value);if(value.can_apply&&(!SHA.test(value.operation_id||'')||!value.proposed_input))throw Error('The native cost preview is incomplete.');this.preview=value;this.previewStamp=stamp;this.persist();}
  finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async apply(){
  if(this.locked()||this.w.pending)throw Error('Finish or recover the original request first.');
  const preview=this.preview;if(!preview?.can_apply||!SHA.test(preview.operation_id||'')||stable(toReview(this.draft,this.context))!==this.previewStamp)throw Error('Preview the current complete cost review before saving.');
  this.current();this.w.cache();this.pending={action:ACTION,operation_id:id(),payload:{...this.base(),candidate_id:this.candidateId,review:clone(preview.review),expected_operation_id:preview.operation_id},state:'submitting'};
  try{await this.persist({required:true});}catch(error){this.pending.state='storage_unavailable';this.render();throw error;}await this.submit();
 }
 async submit(){
  const p=this.pending;if(!p||this.busy)return;this.busy=true;this.error='';
  try{await this.persist({required:true});await this.recoveryStore.verifyRequest(p);}catch(error){this.busy=false;throw error;}this.render();
  try{if(p.id){await this.poll();return;}const response=await this.request('/api/actions',{}, {workspace:this.workspace,action:p.action,payload:p.payload,operation_id:p.operation_id});if(this.pending!==p)return;const task=response.task||response;if(task.workspace&&task.workspace!==this.workspace)throw Error('The original task belongs to another Workspace.');if(!task.id)throw Error('No native task ID was returned. Recover the same original request.');p.id=task.id;p.state=task.state||'queued';this.persist();await this.poll();}
  catch(error){if(this.alive()&&this.pending===p&&!p.id){p.state='response_unconfirmed';this.persist();}throw error;}
  finally{if(this.alive()){this.busy=false;this.render();}}
 }
 checkReceipt(result,payload){
  if(result.workspace_key!==this.workspace||result.plan?.id!==this.planId||result.plan?.revision!==payload.revision||(result.plan.sha256||result.plan.document_digest)!==payload.document_digest||result.operation_id!==payload.expected_operation_id||result.candidate_id!==payload.candidate_id||!result.draft?.id||!result.edition?.id||!safeURL(result.edition.open_url))throw Error('The retained Economic result differs from the original reviewed plan, scenario or edition.');
  const b=result.binding||{};if(b.plan_id!==this.planId||b.revision!==payload.revision||b.document_digest!==payload.document_digest||b.candidate_id!==payload.candidate_id)throw Error('The Economic result has a different original source binding.');
 }
 async poll(){
  clearTimeout(this.timer);const p=this.pending;if(!p?.id||!this.alive())return;
  await this.persist({required:true});await this.recoveryStore.verifyRequest(p);
  const value=await this.request('/api/task',{id:p.id}),task=value.task||value;if(this.pending!==p)return;
  if(task.id!==p.id||task.workspace!==this.workspace||task.action!==p.action||task.operation_id!==p.operation_id||stable(task.payload)!==stable(p.payload))throw Error('The native task differs from the original cost review request.');
  p.state=task.state;this.persist();
  if(task.state==='complete'){
   this.checkReceipt(task.result,p.payload);this.receipt={...clone(task.result),task_id:task.id,request:clone(p),_downloads:clone(task._downloads||task.result._downloads||[])};
   this.pending=null;this.preview=null;this.previewStamp=null;this.notice='Reviewed inputs and the complete Economic edition are saved. The original plan revision, ledger, physical outputs and open browser draft remain unchanged.';this.persist();
   await(this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));if(this.alive()&&!this.context&&this.candidateId&&this.catalog?.candidates.some(row=>row.id===this.candidateId))await this.loadContext(this.candidateId);if(this.alive())this.render();return;
  }
  if(['failed','cancelled','interrupted'].includes(task.state)){this.error=task.error?.message||'The original cost task '+task.state+'.';this.render();return;}
  this.render();this.timer=setTimeout(()=>this.poll().catch(error=>this.fail(error)),2000);
 }
 async refreshReceipt(){
  const before=this.receipt;if(!before||this.pending)return;
  const result=await this.request('/api/implementation-costs/detail',{operation_id:before.operation_id});
  if(this.receipt!==before)return;this.checkReceipt(result,before.request.payload);this.receipt={...clone(result),task_id:before.task_id,request:clone(before.request)};this.persist();this.render();
 }
 rows(){const q=this.query.toLowerCase().trim();return(this.context?.ledger_rows||[]).filter(row=>{const chosen=this.draft?.row_decisions?.[row.id],type=chosen?.classification;
  const matches=this.filter==='all'||this.filter==='context'&&row.kind!=='actual'||this.filter==='actual'&&row.kind==='actual'||this.filter==='required'&&row.decision_required&&!type||this.filter==='candidate'&&row.kind==='actual'&&row.attribution==='candidate'||this.filter==='shared'&&row.kind==='actual'&&row.attribution!=='candidate'||['capital','operating','exclude'].includes(this.filter)&&row.kind==='actual'&&type===this.filter;
  return matches&&(!q||[row.id,row.label,row.reference,row.date,row.task_id,row.task_candidate_id,row.attribution,row.original_task?.title].join(' ').toLowerCase().includes(q));});}
 rowsHtml(){
  const rows=this.rows(),pages=Math.max(1,Math.ceil(rows.length/25));this.page=Math.min(Math.max(this.page,0),pages-1);const part=rows.slice(this.page*25,(this.page+1)*25),total=this.context?.ledger_rows.length||0;
  return '<p>'+rows.length+' matching of '+total+' original ledger rows · page '+(this.page+1)+' of '+pages+'. All matching rows are included in the JSON download.</p><div class="cr-table"><table><thead><tr><th>Original row</th><th>Kind and USD amount</th><th>Task and attribution</th><th>Date and reference</th><th>Reviewed choice</th><th>Source and review</th></tr></thead><tbody>'+part.map(row=>{const d=this.draft?.row_decisions?.[row.id];return '<tr><td>'+esc(row.label)+'<div class="cr-meta">'+esc(row.id)+'</div></td><td>'+esc(row.kind)+'<br>'+esc(money(row.amount_minor))+'</td><td>'+esc(row.original_task?.title||row.task_id||'No task')+'<div class="cr-meta">'+esc(row.attribution)+' · '+esc(row.task_candidate_id||'No candidate')+'</div></td><td>'+esc(row.date||'Date unstated')+'<br>'+esc(row.reference||'')+'</td><td>'+esc(row.kind!=='actual'?'Context only':d?.classification||'Decision required')+(d?.classification&&d.classification!=='exclude'?'<br>'+esc(d.amount?d.amount+' USD allocated':'Whole original amount'):'')+'</td><td>'+btn('row',row.kind==='actual'?'Review row':'Inspect original',this.busy,'data-id="'+esc(row.id)+'"')+'</td></tr>';}).join('')+'</tbody></table></div><div class="cr-actions">'+btn('previous','Previous',this.page===0)+btn('next','Next',this.page+1>=pages)+btn('rows-download','Download all matching rows')+'</div>';
 }
 renderRows(){const node=this.node.querySelector('[data-cr-rows]');if(node)node.innerHTML=this.rowsHtml();}
 inputField(label,path,value,type='text',extra=''){return field(label,'<input data-cr-field="'+esc(path)+'" type="'+type+'" value="'+esc(value??'')+'"'+(this.locked()?' disabled':'')+' '+extra+'>');}
 textField(label,path,value){return field(label,'<textarea data-cr-field="'+esc(path)+'"'+(this.locked()?' disabled':'')+'>'+esc(value||'')+'</textarea>');}
 rowHtml(){
  const row=this.context?.ledger_rows.find(x=>x.id===this.selectedRow);if(!row)return '';const d=this.draft?.row_decisions?.[row.id]||{},disabled=this.locked()?' disabled':'';
  const input=(key,label,value,type='text')=>field(label,'<input data-cr-row="'+key+'" type="'+type+'" value="'+esc(value??'')+'"'+disabled+'>');
  return '<section class="cr-box"><h3>Original ledger row · '+esc(row.label)+'</h3><p>'+esc(row.id)+' · '+esc(row.kind)+' · '+esc(money(row.amount_minor))+' USD · '+esc(row.attribution)+'.</p>'+
   (row.kind==='actual'?'<div class="cr-grid">'+field('Classification','<select data-cr-row="classification"'+disabled+'>'+opt('','Choose explicitly',d.classification)+opt('capital','Capital',d.classification)+opt('operating','Operating context',d.classification)+opt('exclude','Exclude',d.classification)+'</select>')+input('amount','Allocated amount, USD (blank uses whole original)',d.amount)+input('reason','Decision or exclusion reason',d.reason)+input('allocation_reason','Reason for a partial allocation',d.allocation_reason)+input('attribution_reason','Reason for shared or other-candidate attribution',d.attribution_reason)+'<label><input type="checkbox" data-cr-row="acknowledge_undated"'+(d.acknowledge_undated?' checked':'')+disabled+'> I acknowledge that this actual row has no recorded date.</label></div><p class="cr-meta">Excluded rows contribute zero. Future-dated actuals cannot be included. Operating actuals remain historical context and are not annualized. Shared allocations leave the original ledger and task assignments intact.</p><div class="cr-actions">'+btn('row-save','Keep row decision',this.locked())+'</div>':'<p>Budget and commitment rows remain separate source context and cannot supply actual expense.</p>')+
   '<details><summary>Complete original row, task and reviewed attribution</summary>'+json(row)+'</details>'+btn('row-download','Download original row and choice')+'</section>';
 }
 forecastHtml(key,title){
  const value=this.draft[key];return '<section class="cr-box"><h3>'+esc(title)+'</h3>'+this.inputField(key==='annual_operating'?'Constant annual forecast, USD/year':'Remaining capital, USD',key+'.amount',value.amount,'text','inputmode="decimal"')+'<div class="cr-grid">'+this.inputField('Original estimate source title',key+'.source.title',value.source.title)+this.inputField('Actual source reference or URI',key+'.source.uri',value.source.uri)+this.inputField('Source as-of date',key+'.source.as_of',value.source.as_of,'date')+'</div>'+this.textField('Forecast scope and basis',key+'.note',value.note)+'</section>';
 }
 economicPreviewHtml(){
  const report=this.preview?.economic_preview;if(!report?.alternatives)return '';
  const labels={nitrogen_export:['Nitrogen','kg/year'],phosphorus_export:['Phosphorus','kg/year'],sediment_export:['Sediment','t/year']};
  const number=value=>typeof value==='number'&&Number.isFinite(value)?String(value):'Undefined / unavailable';
  return '<h3>Original reporting-zone comparison with reviewed costs</h3><p>The native Economic preview reuses the retained physical comparison. Negative avoided-export values remain visible. Only the selected original scenario receives the reviewed cost.</p><div class="cr-table"><table><thead><tr><th>Original scenario</th><th>Signed avoided export</th><th>Annualized cost</th><th>Prepared decision</th></tr></thead><tbody>'+report.alternatives.map(row=>'<tr><td>'+esc(row.label||row.run_id)+(row.run_id===this.context.binding.run_id?'<br><strong>Reviewed cost</strong>':'')+'</td><td>'+Object.entries(row.outputs||{}).map(([key,value])=>esc(labels[key]?.[0]||key)+': '+esc(number(value?.reduction))+' '+esc(labels[key]?.[1]||value?.units||'')).join('<br>')+'</td><td>'+(row.cost?esc(number(row.cost.annualized))+' '+esc(row.cost.currency)+'/year':'Cost not entered')+'</td><td>'+esc(row.decision?.eligible?'Meets prepared criteria':'Outside prepared criteria')+(row.decision?.pareto?' · Pareto':'')+'</td></tr>').join('')+'</tbody></table></div>';
 }
 previewHtml(){
  const p=this.preview;if(!p)return '<p>Preview the complete review after all choices and forecast sources are recorded.</p>';
  const s=p.summary||{},issues=(p.issues||[]).map(x=>'<li>'+esc(x.severity)+': '+esc(x.message)+'</li>').join('');
  return '<h3>Reviewed Economic input</h3>'+(issues?'<ul>'+issues+'</ul>':'')+(p.can_apply?'<dl>'+[['Selected actual capital',money(s.selected_actual_capital_minor)],['Remaining capital forecast',money(s.remaining_capital_minor)],['Reviewed upfront capital',money(s.capital_minor)],['Observed actual operating context',money(s.selected_actual_operating_minor)],['Separate annual operating forecast',money(s.annual_operating_forecast_minor)+'/year'],['Horizon',s.horizon_years+' years'],['Real discount rate',String(s.discount_rate)],['Footprint',s.scope?.kind]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><p>Observed operating expense is not added to the annual forecast. The original modeled quantities and other scenarios stay with the original Economic selection.</p>':'<p>Complete the stated original-source decisions before saving.</p>')+this.economicPreviewHtml()+'<details><summary>Complete preview, source audit and original Economic input</summary>'+json(p)+'</details><div class="cr-actions">'+btn('preview-download','Download full review and source audit')+btn('apply','Save inputs and build Economic edition',this.locked()||!p.can_apply,'class="cr-primary"')+'</div>';
 }
 receiptHtml(){
  const r=this.receipt;if(!r)return '';const url=safeURL(r.edition?.open_url),files=r._downloads||[];
  return '<section class="cr-box"><h3>Saved Economic edition</h3><p>'+esc(r.edition?.title||r.edition?.id)+' · source plan revision '+esc(r.plan?.revision)+' · latest native plan revision '+esc(r.current_revision)+'.</p><p class="cr-meta">Saved input '+esc(r.draft?.id)+' · original scenario '+esc(r.binding?.run_id)+' · original report '+esc(r.binding?.report_id)+' · zone '+esc(r.binding?.zone_id)+'.</p><div class="cr-actions">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">Open complete Economic edition</a>':'')+btn('edition','Open in Economic desk',this.locked()||typeof this.host.openExtension!=='function')+btn('receipt-refresh','Refresh original receipt',this.locked())+btn('receipt-download','Download complete receipt')+'</div><div class="cr-actions">'+files.map(f=>{const u=safeURL(f.url);return u?'<a href="'+esc(u)+'" download>'+esc(f.label||f.name||'Original file')+'</a>':'';}).join(' ')+'</div><p>The saved Economic input contains the complete original ledger, allocations, forecast sources and frozen scientific source. No implementation ledger or modeled run was changed.</p></section>';
 }
 pendingHtml(){
  const p=this.pending;if(!p)return '';return '<section class="cr-note"><h3>Original cost request</h3><p>'+esc(p.state)+' · plan revision '+esc(p.payload.revision)+' · '+esc(p.operation_id)+'</p><div class="cr-actions">'+btn('recover',p.id?'Check original task':'Recover original request',this.busy)+(p.id?btn('task','Open original task',this.busy):'')+(p.state==='interrupted'?btn('resume','Resume original interrupted task',this.busy):'')+(['failed','cancelled'].includes(p.state)?btn('retire','Retain failed request and return to review',this.busy):'')+btn('request-download','Download original request')+'</div><p>The selected request remains fixed until the original task is complete or definitively failed/cancelled.</p></section>';
 }
 render(){
  if(this.closed)return;const c=this.context,d=this.draft,locked=this.locked(),original=c?.original_cost;
  this.node.innerHTML='<style>'+styles+'</style><header><div><h2>Review economic costs</h2><p>Saved plan '+esc(this.savedPlan.title)+' · revision '+esc(this.savedPlan.revision)+'. The open browser draft stays separate.</p></div>'+btn('close','Close')+'</header><main>'+
   (this.error?'<div class="cr-error" role="alert">'+esc(this.error)+'</div>':'')+(this.storageIssue?'<p class="cr-error">'+esc(this.storageIssue)+'</p>':'')+(this.notice?'<p class="cr-note" role="status">'+esc(this.notice)+'</p>':'')+this.pendingHtml()+this.receiptHtml()+'<div class="cr-actions">'+btn('recovery-download','Download exact recovery file')+btn('recovery-open','Open original recovery file',this.busy)+'</div><input type="file" data-cr="recovery-file" accept=".json,application/json" hidden>'+
   '<section class="cr-box"><h3>Original Economic scenario</h3>'+field('Saved implementation candidate','<select data-cr="candidate"'+(locked||!this.catalog?' disabled':'')+'>'+opt('','Choose a source-bound candidate',this.candidateId)+(this.catalog?.candidates||[]).map(x=>opt(x.id,x.label||x.id,this.candidateId)).join('')+'</select>')+(this.catalog&&!this.catalog.candidates.length?'<p>No candidate in this saved revision has an original Economic source. Use the Economic desk’s Plan implementation flow to retain the original scenario before reviewing its ledger.</p>':'')+'</section>'+
   (c&&d?'<section class="cr-box"><h3>Original source and cost basis</h3><p>Scenario '+esc(c.binding.run_id)+' · report '+esc(c.binding.report_id)+' · zone '+esc(c.binding.zone_id)+'.</p><p>'+(original?'Original cost: '+esc(original.capital)+' '+esc(original.currency)+' capital; '+esc(original.annual_operating)+' '+esc(original.currency)+'/year; '+esc(original.horizon_years)+' years; real rate '+esc(original.discount_rate)+'.':'The original scenario has no cost estimate. Enter an explicit horizon and real discount rate.')+'</p><details><summary>Complete frozen scenario, cost and modeled source context</summary>'+json(c)+'</details>'+btn('context-download','Download original source context')+'</section>'+
   '<section class="cr-box"><h3>Original ledger and explicit allocations</h3><p>Only actual expense rows can supply observed capital or operating context. Budgets and commitments are retained separately. Each directly attributed actual row needs a deliberate choice.</p><div class="cr-three">'+[['Budget','budget'],['Commitment','commitment'],['Actual','actual']].map(([l,k])=>'<div><strong>'+l+'</strong><p>'+esc(money(c.candidate_ledger_totals_minor?.[k]||0))+' directly attributed · '+esc(money(c.ledger_totals_minor?.[k]||0))+' whole plan</p></div>').join('')+'</div><div class="cr-grid">'+field('Search original rows','<input data-cr="query" value="'+esc(this.query)+'" placeholder="Label, invoice, task, candidate or exact ID">')+field('Show','<select data-cr="filter">'+[['required','Required decisions'],['candidate','Candidate actuals'],['shared','Shared / other actuals'],['actual','All actuals'],['capital','Selected capital'],['operating','Selected operating'],['exclude','Excluded actuals'],['context','Budgets and commitments'],['all','All original rows']].map(([v,l])=>opt(v,l,this.filter)).join('')+'</select>')+'</div><div data-cr-rows>'+this.rowsHtml()+'</div>'+this.rowHtml()+'</section>'+
   '<section class="cr-box"><h3>Review date and cost footprint</h3>'+this.inputField('Review as-of date','as_of',d.as_of,'date')+field('Explicit cost footprint','<select data-cr-field="scope.kind"'+(locked?' disabled':'')+'>'+opt('','Choose the actual footprint',d.scope.kind)+opt('whole_scenario','Whole original scenario',d.scope.kind)+opt('reporting_zone','Original reporting zone',d.scope.kind)+'</select>')+this.textField('Footprint rationale','scope.note',d.scope.note)+this.textField('Overall review rationale','note',d.note)+'</section><div class="cr-grid">'+this.forecastHtml('remaining_capital','Remaining capital forecast')+this.forecastHtml('annual_operating','Annual operating forecast')+'</div>'+
   '<section class="cr-box"><h3>Financial parameters and currency</h3><p>The maintained Economic model uses upfront capital and a constant annual operating forecast. Historical expense dates stay in the source audit; payments are not restated or re-discounted from transaction dates.</p><label><input type="checkbox" data-cr-field="override_financial"'+(d.override_financial?' checked':'')+(locked||!original?' disabled':'')+'> Supply reviewed financial parameters'+(!original?' (required for an originally uncosted scenario)':' instead of retaining the original horizon and rate')+'</label>'+(d.override_financial||!original?'<div class="cr-grid">'+this.inputField('Horizon, years','financial_parameters.horizon_years',d.financial_parameters.horizon_years,'number','min="0" step="any"')+this.inputField('Real discount rate, fraction (0.03 = 3%)','financial_parameters.discount_rate',d.financial_parameters.discount_rate,'number','min="0" step="any"')+'</div>'+this.textField('Reason for reviewed parameters','financial_parameters.reason',d.financial_parameters.reason):'<p>Retaining '+esc(original.horizon_years)+' years and real rate '+esc(original.discount_rate)+'.</p>')+
   (original&&String(original.currency).trim().toUpperCase()!=='USD'?'<p class="cr-note">The original estimate uses '+esc(original.currency)+'. The native ledger and both reviewed forecasts use USD; no exchange-rate conversion will be performed.</p><label><input type="checkbox" data-cr-field="acknowledge_currency_change"'+(d.acknowledge_currency_change?' checked':'')+(locked?' disabled':'')+'> I explicitly replace this scenario’s original cost with the reviewed USD basis.</label>':'')+'</section><div class="cr-actions">'+btn('preview','Preview reviewed Economic input',locked,'class="cr-primary"')+btn('review-download','Download review selection')+btn('draft-download','Download browser review draft')+btn('review-open','Open review JSON',locked)+'</div><input type="file" data-cr="review-file" accept=".json,application/json" hidden><section class="cr-box" data-cr-preview>'+this.previewHtml()+'</section>':'')+'</main>';
 }
 async action(b){
  const action=b.dataset.crAction;
  if(action==='close'){this.close();return;}
  if(action==='recovery-download'){download(this.planId+'-economic-original-recovery.json',await this.recoveryStore.exportFile(this.state()));return;}
  if(action==='recovery-open'){if(this.busy)throw Error('Wait for the original task lookup.');this.node.querySelector('[data-cr="recovery-file"]').click();return;}
  if(action==='previous'||action==='next'){this.page+=action==='previous'?-1:1;this.renderRows();return;}
  if(action==='row'){this.selectedRow=b.dataset.id;this.render();return;}
  if(action==='rows-download'){download(this.planId+'-matching-cost-rows.json',{binding:this.context.binding,filter:this.filter,query:this.query,rows:this.rows().map(row=>({...clone(row),reviewed_choice:clone(this.draft.row_decisions[row.id]||null)}))});return;}
  if(action==='row-download'){const row=this.context?.ledger_rows.find(x=>x.id===this.selectedRow);if(row)download(this.planId+'-'+row.id+'-original-cost.json',{binding:this.context.binding,row,reviewed_choice:this.draft.row_decisions[row.id]||null});return;}
  if(action==='row-save'){
   if(this.locked())throw Error('Recover the original request first.');
   const row=this.context.ledger_rows.find(x=>x.id===this.selectedRow);if(row?.kind!=='actual')throw Error('Only actual rows can receive an expense classification.');
   const get=key=>this.node.querySelector('[data-cr-row="'+key+'"]'),classification=get('classification').value;
   if(!['capital','operating','exclude'].includes(classification))throw Error('Choose capital, operating context or exclude.');
   const chosen={classification,reason:get('reason').value,amount:classification==='exclude'?'':get('amount').value,allocation_reason:get('allocation_reason').value,attribution_reason:get('attribution_reason').value,acknowledge_undated:get('acknowledge_undated').checked};
   if(chosen.amount&&parseMoney(chosen.amount)>row.amount_minor)throw Error('The allocation cannot exceed the original row amount.');
   this.draft.row_decisions[row.id]=chosen;this.invalidate();this.notice='Original row decision retained. Preview the entire review before saving.';this.render();return;
  }
  if(action==='context-download'){download(this.planId+'-original-economic-cost-context.json',this.context);return;}
  if(action==='draft-download'){download(this.planId+'-economic-cost-review-draft.json',{schema:'upstate.implementation-cost-review-browser-draft/v1',binding:this.context.binding,draft:this.draft});return;}
  if(action==='review-download'){download(this.planId+'-economic-cost-review.json',{binding:this.context.binding,review:toReview(this.draft,this.context)});return;}
  if(action==='review-open'){if(this.locked())throw Error('Recover the original request first.');this.node.querySelector('[data-cr="review-file"]').click();return;}
  if(action==='preview'){await this.prepare();return;}
  if(action==='preview-download'){if(this.preview)download(this.planId+'-complete-economic-cost-preview.json',this.preview);return;}
  if(action==='apply'){await this.apply();return;}
  if(action==='recover'){await this.submit();return;}
  if(action==='task'){if(this.pending?.id)await this.host.showTask?.(this.pending.id);return;}
  if(action==='resume'){const p=this.pending;if(!p?.id||p.state!=='interrupted')throw Error('Choose the original interrupted cost task.');await this.request('/api/task/resume',{}, {id:p.id});if(this.pending===p){p.state='queued';this.persist();await this.poll();}return;}
  if(action==='request-download'){if(this.pending)download(this.planId+'-original-cost-request.json',this.pending);return;}
  if(action==='retire'){if(!this.pending||!['failed','cancelled'].includes(this.pending.state))throw Error('Keep the original request until its actual task outcome is known.');download(this.planId+'-original-failed-cost-request.json',this.pending);this.pending=null;this.invalidate();this.render();return;}
  if(action==='receipt-refresh'){if(this.locked())throw Error('Recover the original request first.');this.busy=true;this.render();try{await this.refreshReceipt();}finally{if(this.alive()){this.busy=false;this.render();}}return;}
  if(action==='receipt-download'){if(this.receipt)download(this.planId+'-saved-economic-cost-review.json',this.receipt);return;}
  if(action==='edition'){
   if(this.locked()||!this.receipt)throw Error('Recover the original request first.');
   this.current();const value={workspace_key:this.workspace,edition_id:this.receipt.edition.id};this.persist();this.close();
   try{await this.host.openExtension('economic-desk','openSavedEdition',value);}catch(error){this.host.toast?.(error.message||String(error));throw error;}return;
  }
 }
}
export async function openImplementationCostReview(w){
 if(!w.native||!w.nativePlan?.revision)throw Error('Save or reopen the original native plan before reviewing its Economic costs.');
 if(w.pending)throw Error('Finish the original plan task before reviewing costs.');
 detachImplementationCostReview(w);const editor=new ImplementationCostReview(w);w.costReviewEditor=editor;try{await editor.start();}catch(error){editor.fail(error);}return editor;
}
export function detachImplementationCostReview(w){w.costReviewEditor?.close();w.costReviewEditor=null;}
