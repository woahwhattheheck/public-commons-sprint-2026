/** Original native flow routing in the existing scientific operator. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>stable(a)===stable(b);
const identifier=/^[0-9a-f]{64}$/;
const SCHEMA='upstate.flow-routing-working/v1';
const members=['trace.json','originals.json','source-cells.json','routing_paths.py','cells.csv','edges.csv','terminals.csv','routes.geojson','route.svg','terrain-preview.png','index.html','MANIFEST.json','routing.zip'];
const terminalNames={stream:'First native stream or drainage arrival',outside_extent:'Leaves raster extent',terrain_nodata:'Missing terrain support',stream_unknown:'Stream status unavailable',direction_missing:'Direction unavailable on valid terrain'};
const empty=()=>({schema:'upstate.flow-routing-selection/v1',run_id:'',model:'ndr',row:0,column:0,stop_at_stream:true,title:'Downstream routing explanation',notes:''});
const button=(action,title,attrs='')=>'<button type="button" data-flow-action="'+action+'" '+attrs+'>'+esc(title)+'</button>';
const field=(name,label,value,type='text')=>'<label><span>'+esc(label)+'</span><input data-flow-field="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" step="1"':'maxlength="240"')+'></label>';
const option=(id,title,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(title)+'</option>';
const pretty=v=>esc(JSON.stringify(v,null,2));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function validateSelection(value,{complete=true}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Open a complete routing selection.');
 const allowed=new Set(Object.keys(empty()));
 if(Object.keys(value).some(k=>!allowed.has(k))||value.schema!=='upstate.flow-routing-selection/v1')throw Error('This working selection uses an unsupported field or schema.');
 if((complete||value.run_id)&&!identifier.test(value.run_id))throw Error('Select a complete original run.');
 if(!['ndr','sdr'].includes(value.model))throw Error('Select NDR or SDR.');
 for(const key of ['row','column'])if(!(!complete&&value[key]===null)&&(!Number.isSafeInteger(value[key])||value[key]<0))throw Error('Select a zero-based integer '+key+'.');
 if(typeof value.stop_at_stream!=='boolean'||typeof value.title!=='string'||(complete&&!value.title.trim())||value.title.length>240||typeof value.notes!=='string'||value.notes.length>16000)throw Error('Keep a named selection, explicit stopping choice and complete interpretation note.');
 return clone(value);
}
function validateOperation(value,workspace){
 if(!value||value.workspace!==workspace||value.action!=='flow-route.trace'||typeof value.operation_id!=='string'||!value.operation_id||!value.payload||!identifier.test(value.payload.expected_source_id))throw Error('Retain the complete original routing request in its own Workspace.');
 validateSelection(value.payload.selection);
 if(value.task_id!=null&&!identifier.test(value.task_id))throw Error('Retain the original complete task identity.');
 return clone(value);
}
export function attachFlowRouting(host){
 let root=null,workspaceKey=null,projectId=null,epoch=0,busy=false,catalog=null,source=null,active=null,pending=null,history=[],selected=empty(),message='',error=false,tab=null;
 let reportPage=0,reportKind='cells',reportSearch='',activeId=null,sourceSequence=0,reportSequence=0;
 let storageAuthority=false,unreadableRaw=null,priorCopies=[];
 const q=s=>root?.querySelector(s),qa=s=>[...(root?.querySelectorAll(s)||[])];
 const workspace=()=>host.getState()?.workspace_key;
 const alive=(e,w)=>!!root?.isConnected&&epoch===e&&workspaceKey===w&&workspace()===w;
 const key=()=> 'upstate-flow-routing:v1:'+workspaceKey+':'+projectId+':'+tab;
 function read(path,params={}){return host.api(path+'?'+new URLSearchParams({workspace:workspaceKey,...params}));}
 function post(path,body){return host.api(path,{method:'POST',body:{workspace:workspaceKey,...body}});}
 function snapshot(){return {schema:SCHEMA,workspace:workspaceKey,project_id:projectId,selection:clone(selected),source_id:source?.source?.id||null,active_id:activeId,pending:pending?clone(pending):null,requests:clone(history),prior_copies:clone(priorCopies)};}
 function retain(critical=false){
  if(!storageAuthority){if(critical)throw Error('Preserve the unreadable original working copy and explicitly open a valid recovery file before continuing.');return false;}
  try{localStorage.setItem(key(),JSON.stringify(snapshot()));return true;}
  catch(err){if(critical)throw Error('The browser could not retain this original request. Download the working selection, restore browser storage, then continue.');notice('Browser saving is unavailable; download the working selection before leaving.',true);return false;}
 }
 function checkWorking(value){
  if(value?.schema!==SCHEMA||value.workspace!==workspaceKey||value.project_id!==projectId)throw Error('Open this working selection in its original registered Workspace.');
  validateSelection(value.selection,{complete:false});
  if(value.source_id!=null&&!identifier.test(value.source_id))throw Error('The saved native source identity is invalid.');
  if(value.active_id!=null&&!identifier.test(value.active_id))throw Error('The saved report identity is invalid.');
  if(!Array.isArray(value.requests))throw Error('Retain the original request history.');
  value.requests.forEach(v=>validateOperation(v,workspaceKey));
  if(value.prior_copies!=null&&(!Array.isArray(value.prior_copies)||value.prior_copies.some(v=>typeof v!=='string')))throw Error('Retain complete original recovery copies.');

  if(value.pending)validateOperation(value.pending,workspaceKey);
  return clone(value);
 }
 function notice(text,isError=false){message=text;error=isError;const node=q('[data-flow-notice]');if(node){node.textContent=text;node.hidden=!text;node.className='flow-notice'+(isError?' error':'');}}
 function locks(){
  for(const el of qa('[data-flow-field]'))el.disabled=busy||!!pending||!storageAuthority;
  for(const el of qa('[data-flow-action]')){
   const action=el.dataset.flowAction;
   if(['previous','next'].includes(action))continue;
   el.disabled=busy&&!['download-working','task'].includes(action);
   if(action==='trace')el.disabled=busy||!!pending||!source;
   if(action==='resume')el.disabled=busy||!pending;
   if(['source','open-working'].includes(action))el.disabled=busy||!!pending;
   if(action==='new-selection')el.disabled=busy||!pending;
   if(!storageAuthority&&!['open-working','download-working','download-original','refresh'].includes(action))el.disabled=true;
  }
 }
 function formValue(){
  if(!q('[data-flow-form]'))return selected;
  const v=clone(selected);
  for(const k of ['run','model','title','notes'])v[k==='run'?'run_id':k]=q('[data-flow-field="'+k+'"]').value;
  for(const k of ['row','column']){const s=q('[data-flow-field="'+k+'"]').value;v[k]=s.trim()===''?null:Number(s);}
  v.stop_at_stream=q('[data-flow-field="stop_at_stream"]').checked;
  return v;
 }
 function form(){
  const run=catalog?.runs.find(r=>r.id===selected.run_id),stages=run?.stages||[];
  return '<div class="flow-grid"><label><span>Original completed run</span><select data-flow-field="run">'+option('','Choose a native run',selected.run_id)+(catalog?.runs||[]).map(r=>option(r.id,r.id.slice(0,16)+' · '+r.stages.map(s=>s.model.toUpperCase()).join(', '),selected.run_id)).join('')+'</select></label><label><span>Native model</span><select data-flow-field="model">'+(stages.length?stages:[{model:'ndr'},{model:'sdr'}]).map(s=>option(s.model,s.model.toUpperCase(),selected.model)).join('')+'</select></label>'+field('row','Original row (zero-based)',selected.row,'number')+field('column','Original column (zero-based)',selected.column,'number')+field('title','Explanation title',selected.title)+'</div><label><span>Interpretation and source-point reason</span><textarea data-flow-field="notes" rows="3" maxlength="16000">'+esc(selected.notes)+'</textarea></label><label class="flow-check"><input data-flow-field="stop_at_stream" type="checkbox"'+(selected.stop_at_stream?' checked':'')+'>Stop at first native stream or drainage arrival</label><div class="flow-toolbar">'+button('source','Open original native source')+button('trace','Save complete routing explanation')+'</div>';
 }
 function render(){
  if(!root)return;
  root.classList.add('flow-routing');root.dataset.flowRouting='';
  root.innerHTML='<header><h1>Flow routes</h1><p>Select an original native run and source cell to explain its downstream routing. The calculation follows every positive retained branch and saves the original cell values with the result.</p></header><p data-flow-notice role="status" class="flow-notice"'+(!message?' hidden':'')+'>'+esc(message)+'</p><section><h2>Source and selection</h2><form data-flow-form>'+form()+'</form><div data-flow-source></div></section><section><h2>Working selection and original request</h2><p>Your working selection stays in this browser tab. Saved reports belong to the original scientific Workspace and its complete backup.</p><div class="flow-toolbar">'+button('download-working','Download working selection')+(unreadableRaw!==null?button('download-original','Download unreadable original'):'' )+button('open-working','Open working selection')+button('resume','Continue original task')+button('new-selection','Keep failed task and edit a new selection')+(pending?.task_id?button('task','Open original task'):'')+'</div><input type="file" accept=".json,application/json" data-flow-open-working hidden><p data-flow-pending>'+esc(pending?'Original operation '+pending.operation_id+(pending.task_id?' · task '+pending.task_id:' · awaiting original task response'):'No unfinished routing request.')+'</p></section><section><h2>Saved routing explanations</h2><div class="flow-toolbar">'+button('refresh','Refresh saved reports')+'</div><div data-flow-catalog></div></section><div data-flow-active></div>';
  if(error)q('[data-flow-notice]').classList.add('error');
  renderSource();renderCatalog();renderActive();locks();
 }
 function renderSource(){
  const node=q('[data-flow-source]');if(!node)return;
  if(!source){node.innerHTML='<p class="flow-muted">Open the selected original source before saving a route. The native algorithm comes from that run’s recorded arguments.</p>';return;}
  const g=source.geometry,s=source.source,o=source.overview;
  node.innerHTML='<h3>Original '+esc(s.algorithm.toUpperCase())+' routing</h3><p>'+esc(g.crs_label)+' · '+g.width+' columns × '+g.height+' rows. Click the retained terrain overview to select its corresponding full-resolution cell, or enter the precise row and column above.</p><div class="flow-map-wrap"><canvas data-flow-map width="'+o.width+'" height="'+o.height+'" tabindex="0" aria-label="Original terrain overview. Use row and column fields for precise keyboard selection."></canvas></div><p>'+esc(o.note)+'</p><p data-flow-point></p><details><summary>Original file, algorithm and geometry records</summary><pre>'+pretty({source:s,geometry:g})+'</pre></details><h3>Original native source files</h3><ul class="flow-downloads">'+source.source_tickets.map(x=>'<li><a href="'+esc(ticketURL(x,true))+'" data-flow-source-download="'+esc(x.role)+'" download="'+esc(x.filename)+'">'+esc(x.role)+' · '+esc(x.member)+'</a><small>'+x.bytes.toLocaleString()+' bytes · '+esc(x.sha256)+'</small></li>').join('')+'</ul>';
  const canvas=q('[data-flow-map]'),img=new Image(),e=epoch,w=workspaceKey,sid=s.id;
  img.onload=()=>{if(!alive(e,w)||source?.source.id!==sid||!canvas.isConnected)return;canvas.getContext('2d').drawImage(img,0,0);canvas._flowBase=img;paintPoint();};
  img.src='data:image/png;base64,'+o.data_base64;paintPoint();
 }
 function paintPoint(){
  if(!source)return;
  const g=source.geometry,[a,b,c,d,e,f]=g.affine,r=selected.row,col=selected.column;
  const good=Number.isSafeInteger(r)&&Number.isSafeInteger(col)&&r>=0&&col>=0&&r<g.height&&col<g.width;
  const node=q('[data-flow-point]');if(node)node.textContent=good?'Selected cell centre: x '+(a*(col+.5)+b*(r+.5)+c)+', y '+(d*(col+.5)+e*(r+.5)+f)+' in '+g.crs_label+'.':'Choose a source cell inside the original raster.';
  const canvas=q('[data-flow-map]');if(canvas?._flowBase){const ctx=canvas.getContext('2d');ctx.drawImage(canvas._flowBase,0,0);if(good){const x=(col+.5)*canvas.width/g.width,y=(r+.5)*canvas.height/g.height;ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.strokeRect(x-5,y-5,10,10);ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.strokeRect(x-5,y-5,10,10);}}
 }
 function renderCatalog(){
  const node=q('[data-flow-catalog]');if(!node)return;
  const reports=catalog?.reports||[];
  node.innerHTML=reports.length?'<div class="flow-table"><table><thead><tr><th>Saved explanation</th><th>Native source</th><th>Point</th><th>Open</th></tr></thead><tbody>'+reports.map(r=>'<tr><td>'+esc(r.title)+'<small>'+esc(r.captured_at)+'</small></td><td>'+esc(r.summary.algorithm.toUpperCase())+' · '+esc(r.selection.model.toUpperCase())+'</td><td>'+r.selection.row+', '+r.selection.column+'</td><td>'+button('open-report','Open','data-flow-report="'+esc(r.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No saved routing explanation yet. Choose a retained run and inspect its source above.</p>';
 }
 function ticketURL(ticket,download=false){
  if(ticket.workspace!==workspaceKey||!identifier.test(ticket.id)||!/^\/api\/file\/[0-9a-f]{64}$/.test(ticket.url))throw Error('A report download belongs to another original Workspace.');
  return ticket.url+(download?'?download=1':'');
 }
 function renderActive(){
  const node=q('[data-flow-active]');if(!node)return;
  if(!active){node.innerHTML='';return;}
  const d=active.document,t=d.trace,g=d.geometry,tickets=active.tickets,find=n=>tickets.find(x=>x.member===n);
  const sum=Object.entries(t.terminal_shares).map(([k,v])=>'<tr><td>'+esc(terminalNames[k]||k)+'</td><td>'+Number(v).toPrecision(8)+'</td></tr>').join('');
  const factor=g.distance.to_metres,distance=factor!=null?(t.mean_terminal_distance_native_units*factor).toLocaleString(undefined,{maximumFractionDigits:3})+' m':t.mean_terminal_distance_native_units.toPrecision(8)+' original coordinate units';
  node.innerHTML='<section><h2>'+esc(d.selection.title)+'</h2><p>'+esc(d.selection.notes)+'</p><p>'+esc(t.algorithm.toUpperCase())+' · '+t.reachable_cells+' complete cells · '+t.edge_count+' branches. Original point '+t.origin.row+', '+t.origin.column+'.</p><div class="flow-table"><table><thead><tr><th>Where the dimensionless share ends</th><th>Share</th></tr></thead><tbody>'+sum+'</tbody></table></div><p>Share-weighted native graph distance: '+esc(distance)+'. Pixel-centre route length does not establish travel time or observed connectivity.</p><p>Numerical accounting residual '+t.accounting_residual+'; underflowed branches '+t.numerical_underflow_edges+'.</p><img class="flow-route-map" alt="Complete original downstream branches and terminal points" src="'+esc(ticketURL(find('route.svg')))+'"><p>Square: original source cell. Filled circles: stream arrival. Open circles: missing support or extent boundary. Every positive original branch is retained.</p><div class="flow-toolbar"><label><span>Records</span><select data-flow-kind>'+['cells','edges','terminals'].map(k=>option(k,k==='edges'?'Branches':k,reportKind)).join('')+'</select></label><label><span>Find in complete records</span><input data-flow-search type="search" value="'+esc(reportSearch)+'"></label>'+button('previous','Previous records')+button('next','Next records')+'<span data-flow-count></span></div><div data-flow-rows></div><h3>Complete original downloads</h3><ul class="flow-downloads">'+tickets.map(x=>'<li><a href="'+esc(ticketURL(x,true))+'" data-flow-download="'+esc(x.member)+'" download="'+esc(x.member)+'">'+esc(x.member)+'</a><small>'+x.bytes.toLocaleString()+' bytes · '+esc(x.sha256)+'</small></li>').join('')+'</ul><p><a href="'+esc(active.report_url)+'" target="_blank" rel="noopener" data-flow-open-report-html>Open the complete readable report</a></p><details><summary>Original source binding and complete geometry</summary><pre>'+pretty({binding:d.binding,geometry:g})+'</pre></details></section>';
  renderRows();
 }
 function renderRows(){
  if(!active||!q('[data-flow-rows]'))return;
  const term=reportSearch.trim().toLowerCase(),all=active.document.trace[reportKind],rows=term?all.filter(r=>JSON.stringify(r).toLowerCase().includes(term)):all;
  reportPage=Math.max(0,Math.min(reportPage,Math.ceil(rows.length/50)-1));const shown=rows.slice(reportPage*50,reportPage*50+50),keys=Object.keys(shown[0]||{});
  q('[data-flow-rows]').innerHTML=shown.length?'<div class="flow-table"><table><thead><tr>'+keys.map(k=>'<th>'+esc(k.replaceAll('_',' '))+'</th>').join('')+'</tr></thead><tbody>'+shown.map(row=>'<tr>'+keys.map(k=>'<td>'+esc(row[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p>No matching original records.</p>';
  q('[data-flow-count]').textContent=rows.length+' records · page '+(reportPage+1)+' of '+Math.max(1,Math.ceil(rows.length/50));
  q('[data-flow-action="previous"]').disabled=!reportPage;q('[data-flow-action="next"]').disabled=(reportPage+1)*50>=rows.length;
 }
 async function refresh(){
  const e=epoch,w=workspaceKey,value=await read('/api/flow-routing/catalog');
  if(!alive(e,w))return false;
  if(value?.schema!=='upstate.flow-routing-catalog/v1'||value.workspace_key!==w||value.project_id!==host.getState()?.data?.project?.id||!Array.isArray(value.runs)||!Array.isArray(value.reports))throw Error('The routing catalogue belongs to another original project.');
  catalog=value;projectId=value.project_id;return true;
 }
 async function openSource(){
  selected=validateSelection(formValue());retain();const e=epoch,w=workspaceKey,sequence=++sourceSequence,choice=clone(selected);
  busy=true;locks();notice('Reading the original retained rasters and their complete source identities…');
  try{
   const value=await post('/api/flow-routing/source',{run_id:choice.run_id,model:choice.model});
   if(!alive(e,w)||sequence!==sourceSequence)return;
   if(selected.run_id!==choice.run_id||selected.model!==choice.model)return;
   if(value.workspace_key!==w||value.project_id!==projectId||value.source?.run_id!==choice.run_id||value.source?.model!==choice.model||!identifier.test(value.source?.id))throw Error('The retained raster source does not match this selected run.');
   const expected={arguments:value.source.native_stage.arguments,...value.source.files};
   for(const item of value.source.companions)expected['companion:'+item.path]=item;
   if(!Array.isArray(value.source_tickets)||!same(value.source_tickets.map(v=>v.role).sort(),Object.keys(expected).sort()))throw Error('The original source download set is incomplete.');
   for(const ticket of value.source_tickets){ticketURL(ticket);const item=expected[ticket.role];if(ticket.member!==item.path||ticket.bytes!==item.bytes||ticket.sha256!==item.sha256)throw Error('An original source download differs from its recorded native file.');}
   source=value;retain();renderSource();notice('Original source is open. Select a full-resolution cell and save the complete route.');
  }finally{if(alive(e,w)){busy=false;locks();}}
 }
 function checkTask(operation,task){
  if(!task||!identifier.test(task.id)||task.workspace!==operation.workspace||task.action!==operation.action||!same(task.payload,operation.payload)||(operation.task_id&&task.id!==operation.task_id))throw Error('The retained task differs from this complete original source request.');
 }
 async function openReport(id){
  const e=epoch,w=workspaceKey,sequence=++reportSequence,value=await read('/api/flow-routing/report',{id});
  if(!alive(e,w)||sequence!==reportSequence)return;
  if(value?.schema!=='upstate.flow-routing-product/v1'||value.workspace_key!==w||value.project_id!==projectId||value.id!==id||value.report?.id!==id||value.document?.id!==id)throw Error('The report belongs to another original selection.');
  if(!Array.isArray(value.tickets)||value.tickets.length!==members.length||!same(value.tickets.map(x=>x.member).sort(),[...members].sort()))throw Error('The original report is missing a complete outgoing file.');
  for(const ticket of value.tickets){
   const item=value.report.files[ticket.member];
   ticketURL(ticket);
   if(!item||item.path!==ticket.member||ticket.bytes!==item.bytes||ticket.sha256!==item.sha256)throw Error('A retained download differs from its original report manifest.');
  }
  if(value.report_url!=='/api/file/flow-routing/'+encodeURIComponent(w)+'/'+id+'/index.html')throw Error('The readable original report route differs from its saved identity.');
  active=value;activeId=id;reportPage=0;reportSearch='';retain();renderActive();locks();
 }
 async function follow(operation,task,e,w){
  while(alive(e,w)){
   checkTask(operation,task);pending={...clone(operation),task_id:task.id};retain(true);locks();
   if(task.state==='complete'){
    if(!identifier.test(task.result?.id))throw Error('The complete task has no retained routing report.');
    await openReport(task.result.id);if(!alive(e,w))return;
    history.push({...pending,state:'complete',report_id:task.result.id});pending=null;retain(true);await refresh();if(!alive(e,w))return;renderCatalog();notice('Complete route, original source cells and every outgoing file are saved.');render();return;
   }
   notice('Original routing task: '+task.state+'.'+(task.error?.message?' '+task.error.message:''));
   if(['failed','interrupted','cancelled'].includes(task.state))throw Error(task.error?.message||'Continue the original task, or keep its failure and edit a new selection.');
   await sleep(1200);if(!alive(e,w))return;
   task=await read('/api/task',{id:task.id});
  }
 }
 async function trace(){
  if(pending)throw Error('Continue the original request first.');
  selected=validateSelection(formValue());if(!source||source.source.run_id!==selected.run_id||source.source.model!==selected.model)throw Error('Open this original native source first.');
  const g=source.geometry;if(selected.row>=g.height||selected.column>=g.width)throw Error('Select a point inside the retained native raster.');
  const e=epoch,w=workspaceKey,operation={workspace:w,action:'flow-route.trace',payload:{selection:clone(selected),expected_source_id:source.source.id},operation_id:crypto.randomUUID()};
  pending=operation;retain(true);busy=true;render();notice('Saving the complete original routing explanation…');
  try{const task=await host.api('/api/actions',{method:'POST',body:operation});if(alive(e,w))await follow(operation,task,e,w);}
  finally{if(alive(e,w)){busy=false;locks();}}
 }
 async function resume(){
  if(!pending)return;
  const operation=validateOperation(pending,workspaceKey),e=epoch,w=workspaceKey;
  busy=true;locks();
  try{
   let task=operation.task_id?await read('/api/task',{id:operation.task_id}):await host.api('/api/actions',{method:'POST',body:{workspace:operation.workspace,action:operation.action,payload:operation.payload,operation_id:operation.operation_id}});
   if(!alive(e,w))return;checkTask(operation,task);
   if(['failed','interrupted','cancelled'].includes(task.state))task=await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});
   if(alive(e,w))await follow(operation,task,e,w);
  }finally{if(alive(e,w)){busy=false;locks();}}
 }
 async function newSelection(){
  if(!pending?.task_id)throw Error('Recover the original response before making another selection.');
  const operation=clone(pending),e=epoch,w=workspaceKey;busy=true;locks();
  try{
   const task=await read('/api/task',{id:operation.task_id});
   if(!alive(e,w))return;checkTask(operation,task);
   if(!same(pending,operation))throw Error('The original request changed while opening its state.');
   if(!['failed','interrupted','cancelled'].includes(task.state))throw Error('Keep the current running or complete task attached to its original selection.');
   history.push({...operation,state:task.state,error:task.error||null});pending=null;source=null;sourceSequence++;retain(true);render();notice('The original task remains in request history. Edit the point or source, then open the revised selection.');
  }finally{if(alive(e,w)){busy=false;locks();}}
 }
 function download(rawOriginal=false){
  if(rawOriginal||!storageAuthority){
   if(unreadableRaw===null)throw Error('The browser has not returned the stored original. Reopen the view after storage becomes readable.');
   downloadText(unreadableRaw,'flow-routing-unreadable-original.json');return;
  }
  selected=formValue();downloadText(JSON.stringify(snapshot(),null,2)+'\n','flow-routing-working.json');
 }
 function downloadText(data,filename){
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function openWorking(file){
  if(busy)throw Error('Finish the current original action before opening another working selection.');
  const e=epoch,w=workspaceKey;busy=true;reportSequence++;locks();
  try{
   const text=await file.text();if(!alive(e,w))return;
   const value=checkWorking(JSON.parse(text));
   if(pending&&!same(pending,value.pending))throw Error('Continue or retain the original current request before opening another working selection.');
   if(!storageAuthority){
    const actual=localStorage.getItem(key());
    if(unreadableRaw!==null&&actual!==unreadableRaw)throw Error('The saved original changed during recovery. Reopen this view to inspect the current copy.');
    let old=null;try{old=JSON.parse(actual);}catch(_){}
    if(old?.pending&&!same(old.pending,value.pending))throw Error('The recovery file must retain the exact original pending request.');
    if(actual!==null)unreadableRaw=actual;
   }
   if(value.pending?.task_id){const task=await read('/api/task',{id:value.pending.task_id});if(!alive(e,w))return;checkTask(value.pending,task);}
   const recovered=[...(value.prior_copies||[])];
   if(unreadableRaw!==null&&!recovered.includes(unreadableRaw))recovered.push(unreadableRaw);
   const candidate={...value,prior_copies:recovered};
   // Grant storage authority only after this complete, explicit recovery save.
   localStorage.setItem(key(),JSON.stringify(candidate));
   storageAuthority=true;priorCopies=recovered;unreadableRaw=null;
   selected=value.selection;history=value.requests;pending=value.pending;activeId=value.active_id;source=null;sourceSequence++;active=null;render();
   if(activeId)await openReport(activeId);if(!alive(e,w))return;
   notice(pending?'Original pending request reopened. Continue that same task.':'Working selection reopened. Open its original source before another route.');
  }finally{if(alive(e,w)){busy=false;locks();}}
 }
 function change(event){
  const el=event.target;
  if(el.matches('[data-flow-open-working]')){const file=el.files?.[0];if(file)openWorking(file).catch(e=>notice(e.message,true));el.value='';return;}
  if(el.matches('[data-flow-search]')){reportSearch=el.value;reportPage=0;renderRows();return;}
  if(el.matches('[data-flow-kind]')){reportKind=el.value;reportPage=0;renderRows();return;}
  if(!el.matches('[data-flow-field]')||busy||pending||!storageAuthority)return;
  selected=formValue();
  if(['run','model'].includes(el.dataset.flowField)){source=null;sourceSequence++;if(el.dataset.flowField==='run'){const run=catalog.runs.find(r=>r.id===selected.run_id);if(run&&!run.stages.some(s=>s.model===selected.model))selected.model=run.stages[0].model;const model=q('[data-flow-field="model"]');model.innerHTML=(run?.stages||[{model:'ndr'},{model:'sdr'}]).map(s=>option(s.model,s.model.toUpperCase(),selected.model)).join('');}renderSource();}
  retain();paintPoint();locks();
 }
 async function click(event){
  const canvas=event.target.closest('[data-flow-map]');
  if(canvas&&source&&!busy&&!pending&&storageAuthority){
   const rect=canvas.getBoundingClientRect(),g=source.geometry;
   selected=formValue();selected.column=Math.min(g.width-1,Math.max(0,Math.floor((event.clientX-rect.left)/rect.width*g.width)));selected.row=Math.min(g.height-1,Math.max(0,Math.floor((event.clientY-rect.top)/rect.height*g.height)));
   q('[data-flow-field="row"]').value=selected.row;q('[data-flow-field="column"]').value=selected.column;retain();paintPoint();return;
  }
  const el=event.target.closest('[data-flow-action]');if(!el||!root?.contains(el))return;
  event.preventDefault();event.stopPropagation();const action=el.dataset.flowAction,e=epoch,w=workspaceKey;
  if(busy&&!['download-working','task'].includes(action))return;
  try{
   if(action==='source')await openSource();
   else if(action==='trace')await trace();
   else if(action==='resume')await resume();
   else if(action==='new-selection')await newSelection();
   else if(action==='open-report')await openReport(el.dataset.flowReport);
   else if(action==='refresh'){if(await refresh())renderCatalog();}
   else if(action==='download-working')download();
   else if(action==='download-original')download(true);
   else if(action==='open-working')q('[data-flow-open-working]').click();
   else if(action==='task'&&pending?.task_id)await host.showTask(pending.task_id);
   else if(action==='previous'){reportPage--;renderRows();}
   else if(action==='next'){reportPage++;renderRows();}
  }catch(err){if(alive(e,w)){locks();notice(err.message||String(err),true);}}
 }
 async function mount(node){
  detach();root=node;workspaceKey=workspace();epoch++;catalog=null;projectId=null;source=null;active=null;pending=null;history=[];selected=empty();activeId=null;message='';error=false;busy=false;storageAuthority=false;unreadableRaw=null;priorCopies=[];
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',change);
  root.addEventListener('submit',submit);root.innerHTML='<p role="status">Opening original native runs and saved routing reports…</p>';
  const e=epoch,w=workspaceKey;
  try{
   tab=sessionStorage.getItem('upstate-flow-routing-tab');if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('upstate-flow-routing-tab',tab);}
   if(!await refresh()||!alive(e,w))return;
   const raw=localStorage.getItem(key());unreadableRaw=raw;
   if(raw!==null){const saved=checkWorking(JSON.parse(raw));selected=saved.selection;pending=saved.pending;history=saved.requests;activeId=saved.active_id;priorCopies=saved.prior_copies||[];}
   storageAuthority=true;unreadableRaw=null;
   render();if(activeId)await openReport(activeId);
  }catch(err){if(alive(e,w)){if(catalog)render();else root.innerHTML='<h1>Flow routes</h1><p data-flow-notice role="alert"></p>';notice(err.message||String(err),true);}}
 }
 function submit(event){if(event.target.matches('[data-flow-form]')){event.preventDefault();if(!busy&&!pending)openSource().catch(err=>notice(err.message,true));}}
 function update(){if(root?.isConnected&&workspace()!==workspaceKey)detach();}
 function detach(){
  if(root){if(catalog&&q('[data-flow-form]')){selected=formValue();retain();}root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',change);root.removeEventListener('submit',submit);root.classList.remove('flow-routing');delete root.dataset.flowRouting;}
  epoch++;sourceSequence++;reportSequence++;root=null;busy=false;
 }
 return {mount,update,detach,openReport};
}
