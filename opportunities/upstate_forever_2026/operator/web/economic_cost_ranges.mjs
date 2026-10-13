// Copyright (c) 2026 TokenJunkie Labs. MIT License.
import {createEconomicRecoveryStore} from './economic_request_store.mjs';
const ACTION='economic.cost-ranges.build',WORKING='upstate.economic-cost-ranges-working/v1',SHA=/^[a-f0-9]{64}$/;
const copy=v=>JSON.parse(JSON.stringify(v));
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>v===null||v===undefined?'Not recorded':String(v);
const uuid=()=>crypto.randomUUID();
const enc=new TextEncoder(),MAX=128*1024*1024;
async function hash(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(stable(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function jsonBytes(v){const s=JSON.stringify(v)+'\n';if(enc.encode(s).length>MAX)throw Error('The complete working file exceeds 128 MiB. Keep the original file and use a smaller selected edition.');return s;}
function download(name,v){const body=typeof v==='string'?v:jsonBytes(v),url=URL.createObjectURL(new Blob([body],{type:typeof v==='string'?'text/plain;charset=utf-8':'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function safeURL(value){try{const u=new URL(value,location.href);return u.origin===location.origin&&/^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
const button=(action,label,disabled=false,extra='')=>'<button type="button" data-ecr-action="'+action+'" '+(disabled?'disabled ':'')+extra+'>'+esc(label)+'</button>';
const selectOption=(id,label,chosen)=>'<option value="'+esc(id)+'"'+(id===chosen?' selected':'')+'>'+esc(label)+'</option>';
const details=(title,v)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(v,null,2))+'</pre></details>';
function sourceValid(s,d){return s&&SHA.test(s.edition?.id||'')&&SHA.test(s.edition_sha256||'')&&s.edition.id===d.edition_id&&s.edition_sha256===d.edition_sha256&&s.report?.schema==='upstate.decision-report/v1'&&s.packet?.project?.id===s.report.project?.id;}
function validateDefinition(d,source,{unfinished=false}={}){
 if(!d||d.schema!=='upstate.economic-cost-ranges-definition/v1'||!SHA.test(d.edition_id||'')||!SHA.test(d.edition_sha256||'')||typeof d.title!=='string'||typeof d.note!=='string'||!Array.isArray(d.rows)||!sourceValid(source,d))throw Error('Choose a complete definition bound to its original Economic edition.');
 const available=new Set((source.report.alternatives||[]).map(x=>x.run_id)),seen=new Set();
 const range=v=>{if(!v||typeof v!=='object'||['lower','reference','upper','note'].some(k=>typeof v[k]!=='string')||!v.source||['title','uri','as_of'].some(k=>typeof v.source[k]!=='string'))throw Error('Every cost range needs complete original reference, bound text, source fields and note.');};
 for(const row of d.rows){if(!row||!available.has(row.run_id)||seen.has(row.run_id)||!['aggregate','components'].includes(row.mode)||typeof row.label!=='string'||!Array.isArray(row.components))throw Error('Each retained range must identify one original scenario.');seen.add(row.run_id);range(row.capital);range(row.annual_operating);const ids=new Set();for(const c of row.components){if(typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.title!=='string'||!['capital','annual'].includes(c.classification))throw Error('Retain distinct original component identities and classifications.');ids.add(c.id);range(c);}}
 jsonBytes(d);return d;
}
function validState(v,workspace,principal){
 if(!v||v.schema!==WORKING||v.workspace_key!==workspace||v.principal!==principal||typeof v.instance!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(v.instance)||!Array.isArray(v.receipts)||typeof v.selected_run!=='string')throw Error('Choose a complete working copy from this Workspace and signed-in operator.');
 if(v.definition!==null)validateDefinition(v.definition,v.source,{unfinished:true});
 else if(v.source!==null)throw Error('A retained source needs its complete unfinished definition.');
 const p=v.pending;
 if(p){if(p.workspace!==workspace||p.action!==ACTION||typeof p.operation_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(p.operation_id)||!SHA.test(p.payload?.expected_preview_sha256||'')||stable(p.payload.definition)!==stable(v.definition))throw Error('The pending request differs from its frozen authored selection.');}
 return copy(v);
}
export function attachEconomicCostRanges(host){
 let root=null,C=null,generation=0,mountEvents=null;
 const workspace=()=>host.getState()?.workspace_key,principal=()=>String(host.getState()?.person?.id||host.getState()?.person?.name||'local-owner');
 const current=c=>C===c&&workspace()===c.workspace&&principal()===c.principal;
 const live=c=>current(c)&&root?.isConnected&&!c.detached;
 const key=c=>'upstate.economic-cost-ranges/copies/'+c.workspace+'/'+c.principal;
 const owner=(p,id)=>'economic-cost-ranges/'+p+'/'+id;
 function makeState(ws,p){return {schema:WORKING,workspace_key:ws,principal:p,instance:uuid(),source:null,definition:null,selected_run:'',pending:null,lastReceipt:null,receipts:[],opened_id:null};}
 function install(state){const c={workspace:state.workspace_key,principal:state.principal,state,store:null,busy:false,checking:false,detached:false,error:'',notice:'',storage:'',catalog:null,preview:null,result:null,timer:null,turn:++generation};c.store=createEconomicRecoveryStore(c.workspace,owner(c.principal,state.instance),'upstate.ecr/'+c.workspace+'/'+c.principal+'/'+state.instance);return c;}
 function index(c){try{const rows=JSON.parse(localStorage.getItem(key(c))||'[]');const item={instance:c.state.instance,title:c.state.definition?.title||'Unfinished sourced ranges',updated_at:new Date().toISOString(),pending:!!c.state.pending};const next=[item,...rows.filter(x=>x.instance!==item.instance)].slice(0,200);localStorage.setItem(key(c),JSON.stringify(next));}catch{}}
 function copies(c){try{const x=JSON.parse(localStorage.getItem(key(c))||'[]');return Array.isArray(x)?x:[];}catch{return [];}}
 async function persist(c,required=false){const state=copy(c.state);try{const r=await c.store.save(state);c.storage=r.warning||'';index(c);return true;}catch(error){c.storage=error.message||String(error);if(required)throw error;return false;}}
 function frozen(c){return c.busy||c.checking||!!c.state.pending;}
 function error(c,e){c.error=e.message||String(e);if(live(c))render();}
 async function api(c,path,values={},body){if(!current(c))throw Error('Return to the original Workspace and operator.');const result=await host.api(host.endpoint(path,{workspace:c.workspace,...values}),body===undefined?{}:{method:'POST',body});return result;}
 function checkedReply(c,v){if(v.workspace_key!==c.workspace)throw Error('The response belongs to another Workspace.');return v;}
 async function refresh(c){const v=checkedReply(c,await api(c,'/api/economic-cost-ranges/catalog'));if(!Array.isArray(v.editions)||!Array.isArray(v.ranges))throw Error('The original cost-range catalogue is incomplete.');c.catalog=v;if(live(c))render();}
 async function run(c,fn){if(c.busy||c.checking)throw Error('Wait for this original operation to finish.');c.busy=true;c.error='';if(live(c))render();try{return await fn();}finally{c.busy=false;if(live(c))render();}}
 async function keepCurrent(c){const packet=await c.store.exportFile(c.state);download('Economic_Cost_Ranges_Working_'+c.state.instance+'.json',packet);}
 async function openSource(c,id){
  if(frozen(c))throw Error('Continue the original request before selecting another source.');
  await run(c,async()=>{await persist(c);const turn=++c.turn;const v=checkedReply(c,await api(c,'/api/economic-cost-ranges/source',{id}));validateDefinition(v.definition,v.source);
   if(!current(c)||turn!==c.turn)return;if(c.state.definition)await keepCurrent(c);
   const fresh=makeState(c.workspace,c.principal);fresh.source=v.source;fresh.definition=v.definition;fresh.selected_run=v.definition.rows[0]?.run_id||'';
   const next=install(fresh);C=next;await persist(next);await refresh(next);
  });
 }
 async function preview(c){
  if(frozen(c))throw Error('Continue the original request before changing its preview.');
  validateDefinition(c.state.definition,c.state.source);
  await run(c,async()=>{const original=stable(c.state.definition),turn=++c.turn;await persist(c,true);const v=checkedReply(c,await api(c,'/api/economic-cost-ranges/preview',{}, {definition:copy(c.state.definition)}));
   if(!SHA.test(v.preview_sha256||'')||stable(v.definition)!==original||v.result?.schema!=='upstate.economic-cost-ranges/v1'||typeof v.report_html!=='string')throw Error('The preview differs from the original selected definition.');
   if(!current(c)||turn!==c.turn||original!==stable(c.state.definition))return;c.preview=v;c.result=null;c.state.opened_id=null;c.notice='Preview uses the saved physical outputs and the exact authored cost bounds.';await persist(c);
  });
 }
 async function checkTask(c,p,task){
  if(!task||!SHA.test(task.id||'')||task.workspace!==c.workspace||task.action!==ACTION||stable(task.payload)!==stable(p.payload))throw Error('The task differs from the original Workspace, action or payload.');
  if(!SHA.test(task.request_sha256||'')||p.native_request_sha256&&p.native_request_sha256!==task.request_sha256||p.id&&p.id!==task.id)throw Error('The returned task has another original source identity.');
  p.native_request_sha256=task.request_sha256;
  p.id=task.id;p.state=task.state;p.error=task.error?.message||'';p.accepted_operation_id=task.operation_id;
 }
 async function receiveTask(c,p,task){
  const native=checkedReply(c,await api(c,'/api/economic-cost-ranges/request',{operation_id:p.operation_id}));
  if(!native.found||native.task?.id!==task.id||native.native_request_sha256!==native.task?.request_sha256)throw Error('The original native request has not been retained under this operation. Continue the same request.');
  task=native.task;
  await checkTask(c,p,task);c.confirmedRequest={operation_id:p.operation_id,id:p.id,state:p.state};await persist(c,true);
  if(task.state==='complete'){
   const value=checkedReply(c,await api(c,'/api/economic-cost-ranges/detail',{id:p.payload.expected_preview_sha256}));
   if(value.id!==p.payload.expected_preview_sha256||stable(value.definition)!==stable(p.payload.definition)||value.result?.schema!=='upstate.economic-cost-ranges/v1')throw Error('The completed range result differs from the original request.');
   const receipt={operation_id:p.operation_id,task_id:p.id,accepted_operation_id:p.accepted_operation_id,range_id:value.id,request:copy(p)};
   c.state.receipts.push(receipt);c.state.lastReceipt=receipt;c.state.pending=null;c.state.opened_id=value.id;c.result=value;c.preview=null;
   await persist(c,true);c.notice='Complete sourced ranges and the original Economic package are saved.';if(current(c))await refresh(c);if(current(c))await host.refresh?.();
  }else if(['failed','cancelled','interrupted'].includes(task.state)){c.error=p.error||'The original task is '+task.state+'.';}
  else if(live(c)){clearTimeout(c.timer);c.timer=setTimeout(()=>poll(c).catch(e=>error(c,e)),2000);}
 }
 async function poll(c){
  const p=c.state.pending;if(!p?.id||c.checking)return;c.checking=true;if(live(c))render();
  try{await persist(c,true);await c.store.verifyRequest(p);if(!current(c))return;const v=await api(c,'/api/task',{id:p.id});await receiveTask(c,p,v.task||v);}
  finally{c.checking=false;if(live(c))render();}
 }
 async function submit(c){
  const p=c.state.pending;if(!p)throw Error('No original request is retained.');
  if(p.id)return poll(c);
  await run(c,async()=>{await persist(c,true);await c.store.verifyRequest(p);if(!current(c)||c.state.pending!==p)throw Error('Return to the original pending copy before dispatch.');
   p.state='submitting';await persist(c,true);if(!current(c)||c.state.pending!==p)throw Error('The selected original copy changed before dispatch.');
   try{const original=checkedReply(c,await api(c,'/api/economic-cost-ranges/request',{operation_id:p.operation_id}));
    if(original.found){await receiveTask(c,p,original.task);return;}
    if(!current(c)||c.state.pending!==p)throw Error('The original copy changed before dispatch.');
    const v=await api(c,'/api/actions',{}, {workspace:c.workspace,action:ACTION,operation_id:p.operation_id,payload:copy(p.payload)});await receiveTask(c,p,v.task||v);}
   catch(e){if(c.state.pending===p){p.state=p.id?p.state:'response_unconfirmed';p.error=e.message;await persist(c);}throw e;}
  });
 }
 async function save(c){
  if(frozen(c)||!c.preview||stable(c.preview.definition)!==stable(c.state.definition))throw Error('Preview these exact authored ranges before saving.');
  c.state.pending={workspace:c.workspace,action:ACTION,operation_id:uuid(),payload:{definition:copy(c.state.definition),expected_preview_sha256:c.preview.preview_sha256},state:'retained'};
  await persist(c,true);if(live(c))render();await submit(c);
 }
 async function openResult(c,id){
  await run(c,async()=>{const value=checkedReply(c,await api(c,'/api/economic-cost-ranges/detail',{id}));if(value.id!==id||value.result?.schema!=='upstate.economic-cost-ranges/v1')throw Error('The selected saved result differs from its original identity.');if(!current(c))return;c.result=value;c.preview=null;c.state.opened_id=id;await persist(c);});
 }
 async function adopt(c,packet){
  if(c.checking)throw Error('Wait for the original request read before opening its working file.');
  if(packet?.schema!=='upstate.economic-browser-recovery/v1'||packet.workspace_key!==c.workspace||!SHA.test(packet.sha256||'')||await hash(packet.state)!==packet.sha256)throw Error('Choose the unchanged complete original working file.');
  const state=validState(packet.state,c.workspace,c.principal);
  const samePending=c.state.pending;
  if(samePending&&(!state.pending||state.instance!==c.state.instance||stable({workspace:state.pending.workspace,action:state.pending.action,operation_id:state.pending.operation_id,payload:state.pending.payload})!==stable({workspace:samePending.workspace,action:samePending.action,operation_id:samePending.operation_id,payload:samePending.payload})))throw Error('Recover the currently retained original request before opening another working copy.');
  if(packet.owner!==owner(c.principal,state.instance))throw Error('The working file belongs to another original browser copy.');
  if(state.source){const actual=checkedReply(c,await api(c,'/api/economic-cost-ranges/source',{id:state.definition.edition_id}));if(actual.source.edition_sha256!==state.definition.edition_sha256||stable(actual.source)!==stable(state.source))throw Error('The working source differs from this retained original Economic edition.');}
  if(!current(c))throw Error('Return to the original Workspace before opening the file.');
  await keepCurrent(c);
  // An immutable pending request retains its original browser owner for exact file-backed recovery.
  // Editable copies always fork so another open window's unfinished writing survives.
  if(!state.pending)state.instance=uuid();
  const next=install(state);
  if(state.pending){await next.store.importFile(packet,samePending);state.pending.state='response_unconfirmed';state.pending.error='';next.confirmedRequest=null;next.notice='Original pending request recovered from the complete file. Check its server outcome before making another request.';}
  else await persist(next);
  if(!current(c))throw Error('The selected operator changed while receiving the saved copy.');
  C=next;await refresh(next);
  if(next.state.pending)await submit(next);else if(next.state.opened_id)await openResult(next,next.state.opened_id);
 }
 async function openDefinition(c,file){
  if(frozen(c)||!c.state.source)throw Error('Choose the original source before opening authored range inputs.');
  await run(c,async()=>{if(file.size>MAX)throw Error('Choose a definition within 128 MiB.');const d=JSON.parse(await file.text());validateDefinition(d,c.state.source,{unfinished:true});if(!current(c))return;await keepCurrent(c);c.state.definition=copy(d);c.state.selected_run=d.rows[0]?.run_id||'';invalidate(c);await persist(c);});
 }
 function invalidate(c){c.preview=null;c.result=null;c.state.opened_id=null;c.notice='Inputs changed. Preview the current ranges before saving.';c.error='';c.turn++;if(live(c)){const box=root.querySelector('[data-ecr-result]');if(box){box.dataset.ecrResult='';box.innerHTML='<p>Inputs changed. Preview the current ranges before saving.</p>';}}}
 function rangeHtml(c,row,range,label,path){
  const locked=frozen(c),field=(key,l,value,readOnly=false)=>'<label><span>'+esc(l)+'</span><input data-ecr-path="'+esc(path+'.'+key)+'" value="'+esc(value)+'"'+(locked?' disabled':'')+(readOnly?' readonly':'')+'></label>';
  return '<div class="range-line"><h4>'+esc(label)+'</h4><div class="grid">'+field('lower','Lower cost',range.lower)+field('reference','Saved reference cost',range.reference,true)+field('upper','Upper cost',range.upper)+'</div><div class="grid">'+field('source.title','Bound source title',range.source.title)+field('source.uri','Original source URI',range.source.uri)+field('source.as_of','Source date (YYYY-MM-DD)',range.source.as_of)+'</div><label><span>Applicability and bound explanation</span><textarea data-ecr-path="'+esc(path+'.note')+'"'+(locked?' disabled':'')+'>'+esc(range.note)+'</textarea></label></div>';
 }
 function selectedHtml(c){
  const d=c.state.definition;if(!d)return '<p>Select a completed Economic edition to review its original costs and retained physical quantities.</p>';
  const r=d.rows.find(x=>x.run_id===c.state.selected_run);if(!r)return '<p>This edition has no costed scenario available for authored bounds. Its original physical results remain in the source.</p>';
  const i=d.rows.indexOf(r),locked=frozen(c),original=c.state.source.report.alternatives.find(x=>x.run_id===r.run_id),currency=original?.cost?.currency||'original currency';
  return '<h3>'+esc(r.label)+'</h3><p>Costs in '+esc(currency)+'. Original horizon '+esc(original?.cost?.horizon_years)+' years; real discount rate '+esc(original?.cost?.discount_rate)+'. Physical loads, support, targets and cost footprint remain those of the saved edition.</p>'+
   '<label><span>Range authoring</span><select data-ecr-row-mode="'+i+'"'+(locked?' disabled':'')+'>'+selectOption('aggregate','Capital and annual operating totals',r.mode)+(r.components.length?selectOption('components','Retained original cost components',r.mode):'')+'</select></label>'+
   '<p class="scope">'+esc(r.component_status||'Component availability is determined from the original saved quantity calculation.')+'</p>'+
   (r.mode==='components'?r.components.map((line,j)=>rangeHtml(c,r,line,line.title+' · '+line.classification,'rows.'+i+'.components.'+j)+details('Original quantity, rate and source line',line.original_line)).join(''):rangeHtml(c,r,r.capital,'Capital cost','rows.'+i+'.capital')+rangeHtml(c,r,r.annual_operating,'Annual operating cost','rows.'+i+'.annual_operating'))+
   details('Original physical quantities and support',original?.outputs)+details('Original cost footprint and source',c.state.source.edition.input.selection.costs.find(x=>x.run_id===r.run_id));
 }
 function resultsHtml(c){
  const r=c.result?.result||c.preview?.result;if(!r)return '<p>Preview or open a saved range comparison to see complete scenario costs and affordability.</p>';
  const rows=r.scenarios||[],url=safeURL(c.result?.open_url);
  return '<h3>'+esc(r.title)+'</h3><p>Lower and upper are explicit authored cost cases. They do not assign probabilities or change the modeled physical response.</p><div class="table"><table><thead><tr><th>Original scenario</th><th>Lower annualized</th><th>Saved reference</th><th>Upper annualized</th><th>Budget range</th></tr></thead><tbody>'+rows.map(x=>'<tr><th>'+esc(x.label)+'</th>'+['lower','reference','upper'].map(k=>'<td>'+esc(x.cases?.[k]?.cost?text(x.cases[k].cost.annualized)+' '+x.currency+'/year':'Not costed')+'</td>').join('')+'<td>'+esc(x.affordability?.status||'Not recorded')+'</td></tr>').join('')+'</tbody></table></div><div class="actions">'+(url?'<a data-ecr-report href="'+esc(url)+'" target="_blank" rel="noopener">Open complete readable report</a>':'')+(c.result?c.result._downloads.map(x=>{const u=safeURL(x.url);return u?'<a data-ecr-download="'+esc(x.path||x.label)+'" href="'+esc(u)+'" download>'+esc(x.label||x.path)+'</a>':'';}).join(''):button('save','Save complete sourced comparison',frozen(c),'class="primary"'))+'</div><div data-ecr-report-frame></div>'+details('Complete original definition and source identities',r.definition);
 }
 function render(){
  const c=C;if(!live(c))return;const d=c.state.definition,locked=frozen(c),p=c.state.pending,editions=c.catalog?.editions||[];
  root.innerHTML='<div class="ecr" data-ecr-root><h2>Sourced cost ranges</h2><p>Compare explicit cost bounds against the same saved scientific results. Original source quantities, assumptions and all prior editions remain available.</p>'+(c.error?'<p class="error" role="alert">'+esc(c.error)+'</p>':'')+(c.storage?'<p class="notice">'+esc(c.storage)+'</p>':'')+(c.notice?'<p class="notice" role="status">'+esc(c.notice)+'</p>':'')+
  '<section><h3>Working copy and original source</h3><p class="meta">Independent writing copy '+esc(c.state.instance)+'</p><div class="actions">'+button('working-download','Save complete working file')+button('working-open','Open working file',c.busy||c.checking)+button('definition-open','Open authored range definition',locked||!d)+button('definition-download','Download editable definition',!d)+button('refresh','Refresh saved editions',c.busy||c.checking)+'</div><input hidden type="file" data-ecr-file="working" accept=".json,application/json"><input hidden type="file" data-ecr-file="definition" accept=".json,application/json"><div class="two"><label><span>Original saved Economic edition</span><select data-ecr-field="edition"'+(locked?' disabled':'')+'>'+selectOption('','Choose a completed edition',d?.edition_id)+editions.map(x=>selectOption(x.id,x.title+' · '+(x.zone_title||x.zone_id),d?.edition_id)).join('')+'</select></label><label><span>Earlier saved browser copies</span><select data-ecr-field="copy">'+selectOption('','Choose a retained copy','')+copies(c).map(x=>selectOption(x.instance,x.title+' · '+x.updated_at+(x.pending?' · pending request':''),'')).join('')+'</select></label></div><div class="actions">'+button('source','Open selected source',locked)+button('copy-open','Open selected browser copy',locked)+'</div></section>'+
  (p?'<section data-ecr-pending="'+esc(p.operation_id)+'"><h3>Original saved request</h3><p>'+esc(p.state)+' · '+esc(p.operation_id)+'</p><p>All selected inputs remain frozen until the original server outcome is known.</p><div class="actions">'+button('recover','Continue same original request',c.busy||c.checking)+(p.state==='interrupted'?button('resume','Resume original interrupted task',c.busy||c.checking):'')+(['failed','cancelled'].includes(p.state)?button('retire','Keep failed request and edit a new copy',c.busy||c.checking):'')+'</div></section>':'')+
  (d?'<section><h3>Authored comparison</h3><div class="two"><label><span>Title</span><input data-ecr-field="title" value="'+esc(d.title)+'"'+(locked?' disabled':'')+'></label><label><span>Scenario to edit</span><select data-ecr-field="run">'+d.rows.map(x=>selectOption(x.run_id,x.label,c.state.selected_run)).join('')+'</select></label></div><label><span>Scientific and costing context</span><textarea data-ecr-field="note"'+(locked?' disabled':'')+'>'+esc(d.note)+'</textarea></label><div data-ecr-editor>'+selectedHtml(c)+'</div><div class="actions">'+button('preview','Preview complete cost ranges',locked,'class="primary"')+'</div></section>':'')+
  '<section data-ecr-result="'+esc(c.result?.id||c.preview?.preview_sha256||'')+'">'+resultsHtml(c)+'</section><section><h3>Saved comparisons</h3>'+(c.catalog?.ranges.length?'<ul>'+c.catalog.ranges.map(x=>'<li>'+button('saved',x.title,c.busy||c.checking,'data-id="'+esc(x.id)+'"')+' <span class="meta">'+esc(x.created_at)+'</span></li>').join('')+'</ul>':'<p>No sourced cost-range comparison is saved in this Workspace.</p>')+(c.result?button('reuse','Edit a new copy of this saved definition',locked):'')+'</section><footer>TokenJunkie Labs · Scientific source and original publisher attribution remain in the complete package.</footer></div>';
  const slot=root.querySelector('[data-ecr-report-frame]');
  if(slot&&(c.preview?.report_html||c.result?.open_url)){const frame=document.createElement('iframe');frame.title='Complete readable sourced cost-range report';frame.style='width:100%;height:650px;border:1px solid #aaa';frame.sandbox='';if(c.result)frame.src=safeURL(c.result.open_url);else{const doc=new DOMParser().parseFromString(c.preview.report_html,'text/html');for(const a of doc.querySelectorAll('a[href]')){a.removeAttribute('href');a.title='Complete source download is available after saving.';}frame.srcdoc=doc.documentElement.outerHTML;}slot.append(frame);}
 }
 function input(event){
  const c=C,target=event.target;if(!live(c)||frozen(c))return;
  const field=target.dataset.ecrField,path=target.dataset.ecrPath;
  if(field==='title'||field==='note'){c.state.definition[field]=target.value;invalidate(c);persist(c).catch(e=>error(c,e));}
  else if(path){const parts=path.split('.');if(!/^rows\.\d+\.(capital|annual_operating|components\.\d+)\.(lower|upper|note|source\.(title|uri|as_of))$/.test(path))return;let obj=c.state.definition;for(const key of parts.slice(0,-1))obj=obj[key];obj[parts.at(-1)]=target.value;invalidate(c);persist(c).catch(e=>error(c,e));}
 }
 async function change(event){
  const c=C,target=event.target;if(!live(c))return;
  if(target.dataset.ecrFile){const file=target.files?.[0];target.value='';if(!file)return;if(file.size>MAX)throw Error('Choose a complete input within 128 MiB.');if(target.dataset.ecrFile==='definition')return openDefinition(c,file);return run(c,async()=>{const packet=JSON.parse(await file.text());if(!current(c))return;await adopt(c,packet);});}
  if(target.dataset.ecrField==='run'){c.state.selected_run=target.value;await persist(c);render();}
  if(target.dataset.ecrRowMode!==undefined){if(frozen(c))return;const row=c.state.definition.rows[Number(target.dataset.ecrRowMode)];if(!['aggregate','components'].includes(target.value)||target.value==='components'&&!row.components.length)throw Error('Choose a supported original range mode.');row.mode=target.value;invalidate(c);await persist(c);render();}
 }
 async function action(event){
  const b=event.target.closest('[data-ecr-action]'),c=C;if(!b||!live(c))return;event.preventDefault();const a=b.dataset.ecrAction;
  if(a==='working-download')return keepCurrent(c);
  if(a==='working-open'){root.querySelector('[data-ecr-file=working]').click();return;}
  if(a==='definition-open'){root.querySelector('[data-ecr-file=definition]').click();return;}
  if(a==='definition-download'){if(c.state.definition)download('Economic_Cost_Ranges_Definition.json',c.state.definition);return;}
  if(a==='source')return openSource(c,root.querySelector('[data-ecr-field=edition]').value);
  if(a==='refresh')return run(c,()=>refresh(c));
  if(a==='preview')return preview(c);
  if(a==='save')return save(c);
  if(a==='recover')return submit(c);
  if(a==='resume'){const p=c.state.pending;if(!p?.id)throw Error('Select the original retained request.');return run(c,async()=>{await persist(c,true);await c.store.verifyRequest(p);const native=checkedReply(c,await api(c,'/api/economic-cost-ranges/request',{operation_id:p.operation_id}));if(!native.found||native.native_request_sha256!==native.task?.request_sha256)throw Error('The original native request could not be verified.');await receiveTask(c,p,native.task);if(c.state.pending!==p||p.state!=='interrupted')return;if(!current(c))throw Error('Return to the original pending copy before resuming.');await persist(c,true);await c.store.verifyRequest(p);const response=await api(c,'/api/task/resume',{}, {id:p.id});await receiveTask(c,p,response.task||response);});}
  if(a==='retire'){if(!c.state.pending||c.busy||c.checking||!['failed','cancelled'].includes(c.confirmedRequest?.state)||c.confirmedRequest.operation_id!==c.state.pending.operation_id||c.confirmedRequest.id!==c.state.pending.id)throw Error('Read the current native terminal outcome before retiring this original request.');await keepCurrent(c);const state=copy(c.state);state.retiredRequest=state.pending;state.pending=null;state.instance=uuid();const next=install(state);C=next;await persist(next);await refresh(next);return;}
  if(a==='saved')return openResult(c,b.dataset.id);
  if(a==='copy-open'){const id=root.querySelector('[data-ecr-field=copy]').value;if(!id)return;const store=createEconomicRecoveryStore(c.workspace,owner(c.principal,id),'upstate.ecr/'+c.workspace+'/'+c.principal+'/'+id);const loaded=await store.load();if(!loaded.state)throw Error('The retained browser copy is unavailable. Open its complete saved file.');return adopt(c,await store.exportFile(loaded.state));}
  if(a==='reuse'){if(frozen(c)||!c.result)throw Error('Continue the original request before authoring another result.');const result=c.result;await openSource(c,result.definition.edition_id);if(C!==c&&C?.state.definition?.edition_sha256===result.definition.edition_sha256){C.state.definition=copy(result.definition);C.state.selected_run=result.definition.rows[0]?.run_id||'';await persist(C);render();}return;}
 }
 function ensure(){const ws=workspace(),p=principal();if(!ws)throw Error('Open the original scientific Workspace.');if(!C||C.workspace!==ws||C.principal!==p){if(C){clearTimeout(C.timer);persist(C).catch(()=>{});}C=install(makeState(ws,p));}return C;}
 function onBeforeUnload(event){if(C?.state.definition){persist(C);event.preventDefault();event.returnValue='';}}
 window.addEventListener('beforeunload',onBeforeUnload);
 return {
  async mount(node){mountEvents?.abort();mountEvents=new AbortController();root=node;const options={signal:mountEvents.signal};root.addEventListener('click',e=>{const original=C;action(e).catch(err=>error(original,err));},options);root.addEventListener('input',input,options);root.addEventListener('change',e=>{const original=C;change(e).catch(err=>error(original,err));},options);const c=ensure();c.detached=false;render();await refresh(c);if(c.state.pending?.id)await poll(c);},
  update(){if(!root)return;const previous=C,c=ensure();if(c!==previous){c.detached=false;render();refresh(c).catch(e=>error(c,e));}},
  detach(){mountEvents?.abort();mountEvents=null;if(C){C.detached=true;clearTimeout(C.timer);persist(C).catch(()=>{});}root=null;},
  async openEdition(id){const c=ensure();await openSource(c,id);},
  getWorking(){return C?copy(C.state):null;}
 };
}
