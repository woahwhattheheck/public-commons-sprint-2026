import {hashBlob,createSHA256} from '/assets/sha256.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const S={token:sessionStorage.getItem('dlthub-token')||'',session:null,projects:[],view:null,pane:'overview',scope:null,pending:null,storageReady:false,storageError:null,storageRead:0,busy:false,form:null,nav:0,db:null,poll:null};
const PANES={overview:'Overview',sources:'Sources',plans:'Migration plans',runs:'Native runs',comparisons:'Comparison',cutover:'Cutover & consumers',delivery:'Delivery & history'};
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const j=v=>JSON.stringify(v,null,2),uid=()=>crypto.randomUUID();
const time=v=>v?new Date(v).toLocaleString():'—';
const size=v=>v<1024?v+' B':v<1048576?(v/1024).toFixed(1)+' KiB':(v/1048576).toFixed(1)+' MiB';
const brief=v=>String(v??'').length>25?String(v).slice(0,12)+'…'+String(v).slice(-6):String(v??'');
const need=(condition,code,message)=>{if(!condition)throw Object.assign(new Error(message),{code});};
const errorText=e=>(e.code?e.code+': ':'')+(e.message||e);
function notice(message,error=false){const t=$('#notice');t.hidden=!message;t.className='notice'+(error?' error':'');t.textContent=message||'';}
const report=e=>notice(errorText(e),true);
function badge(value){const type=['complete','approved','ready','equal','selected'].includes(value)?'good':['failed','cancelled','changes_required'].includes(value)?'bad':['running','queued','cancelling','interrupted','awaiting_reconciliation','draft'].includes(value)?'warn':'';return'<span class="badge '+type+'">'+h(value)+'</span>';}
const button=(title,action,id='',write=false,disabled=false)=>'<button type="button" class="small secondary" data-action="'+h(action)+'" data-id="'+h(id)+'"'+(write?' data-write':'')+(disabled?' disabled data-unavailable="true"':'')+'>'+h(title)+'</button>';
const empty=(title,message)=>'<div class="empty"><h3>'+h(title)+'</h3><p>'+h(message)+'</p></div>';
function table(head,rows){return'<div class="table-wrap"><table><thead><tr>'+head.map(v=>'<th>'+h(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function card(title,content,actions=''){return'<section class="card"><div class="card-header"><h2>'+h(title)+'</h2><div class="actions">'+actions+'</div></div>'+content+'</section>';}
function metric(label,value,foot){return'<div class="metric"><span class="label">'+h(label)+'</span><span class="value">'+h(value)+'</span><div class="foot">'+h(foot)+'</div></div>';}
async function api(path,{method='GET',body,headers={},raw=false}={}){
  need(path.startsWith('/api/'),'API_PATH','Use the selected installation API.');
  const options={method,headers:{Authorization:'Bearer '+S.token,...headers},cache:'no-store',redirect:'error',credentials:'omit'};
  if(body!==undefined){if(typeof body==='string'||body instanceof Blob||body instanceof ArrayBuffer||ArrayBuffer.isView(body))options.body=body;else{options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}}
  const response=await fetch(path,options);
  if(raw&&response.ok)return response;
  let value;try{value=await response.json();}catch{throw Object.assign(new Error('The response was not readable. Reconcile the original request.'),{code:'RESPONSE_UNOBSERVED',uncertain:true});}
  if(!response.ok)throw Object.assign(new Error(value?.error?.message||'The host rejected this request.'),{code:value?.error?.code||'HTTP_'+response.status,status:response.status,details:value?.error?.details});
  return value;
}
function db(){
  if(S.db)return S.db;
  S.db=new Promise((yes,no)=>{const q=indexedDB.open('dlthub-pipeline-requests-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('records',{keyPath:'key'});q.onerror=()=>no(q.error);q.onblocked=()=>no(new Error('The original request store is held by an older tab.'));q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();S.db=null;};yes(q.result);};}).catch(e=>{S.db=null;throw e;});return S.db;
}
async function stored(key){const d=await db();return new Promise((yes,no)=>{let out;const tx=d.transaction('records','readonly'),q=tx.objectStore('records').get(key);q.onsuccess=()=>out=q.result?.value;tx.oncomplete=()=>yes(out);tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}
async function saved(key,value,{expected}={}){
  const d=await db();return new Promise((yes,no)=>{const tx=d.transaction('records','readwrite'),records=tx.objectStore('records'),q=records.get(key);let error=null;
    q.onsuccess=()=>{const old=q.result?.value;if(expected&&old&&(old.requestId!==expected.requestId||old.bodyText!==expected.bodyText)){error=new Error('Another tab retained a different original request. Reopen it.');tx.abort();return;}if(value===undefined)records.delete(key);else records.put({key,value});};
    tx.oncomplete=()=>yes();tx.onerror=()=>no(error||tx.error);tx.onabort=()=>no(error||tx.error||new Error('The original request was not saved.'));
  });
}
function scope(projectId){return[location.origin,S.session.instanceId,S.session.actor.id,projectId||'$create'].map(encodeURIComponent).join('|');}
async function pendingScope(projectId,{navigation=S.nav}={}){
  const selected=scope(projectId),readId=++S.storageRead;S.scope=selected;S.storageReady=false;S.storageError=null;S.pending=null;renderPending();
  const current=()=>S.scope===selected&&S.storageRead===readId&&S.nav===navigation&&S.session&&scope(projectId)===selected;
  try{
    const p=await stored('pending:'+selected);if(!current())return false;
    if(p)need(p.scope===selected&&JSON.parse(p.bodyText).requestId===p.requestId,'REQUEST_IDENTITY','Retained request identity differs.');
    S.pending=p||null;S.storageReady=true;renderPending();return true;
  }catch(error){if(current()){S.storageError={code:error.code||'REQUEST_STORAGE_UNAVAILABLE',message:error.message};S.storageReady=false;renderPending();}throw error;}
}
function controls(){const yes=!!S.session?.permissions.operate&&S.storageReady&&S.scope===scope(S.view?.id)&&!S.busy&&!S.pending&&!S.view?.historical;$$('[data-write]').forEach(e=>e.disabled=!yes||e.dataset.unavailable==='true');$('#project-select').disabled=S.busy;$('#create-project').disabled=!yes;$('#form-submit').disabled=!yes;$('#signout').disabled=S.busy;}
function renderPending(){
  const el=$('#pending'),p=S.pending;el.hidden=!p&&S.storageReady;
  if(!S.storageReady){el.innerHTML='<h3>'+h(S.storageError?'Original request storage unavailable':'Opening original request storage')+'</h3><p>'+h(S.storageError?.message||'Reading the pending request for this exact installation, actor and project.')+'</p>'+(S.storageError?button('Retry original request read','retry-storage'):'');controls();return;}
  el.innerHTML=p?'<h3>'+h(p.state==='committed'?'Committed response retained':'Original request retained')+'</h3><p>'+h(p.label)+'</p><p class="mono">'+h(p.requestId)+' · revision '+h(p.expectedRevision??'create')+'</p>'+(p.error?'<p>'+h(p.error.message)+'</p>':'')+'<div class="actions">'+button('Reconcile same request','retry-pending')+button('Inspect request','show-pending')+(p.state==='rejected'?button('Close rejected request','close-pending'):'')+'</div>':'';
  controls();
}
async function keepPending(p){await saved('pending:'+p.scope,p,{expected:p});if(S.scope===p.scope){S.pending=p;renderPending();}}
async function finish(p){
  const response=p.response;need(response?.view?.id&&Number.isSafeInteger(response.view.revision),'RESPONSE_UNOBSERVED','The saved response has no original project revision.');
  await saved('last:'+p.scope,{...p,upload:p.upload?{...p.upload,file:undefined}:undefined});await saved('pending:'+p.scope,undefined,{expected:p});
  if(S.scope===p.scope)S.pending=null;S.busy=false;renderPending();$('#form-dialog').close();await projects();
  await openProject(response.view.id);notice('Saved '+p.label+' at revision '+response.view.revision+'. The current project is shown.');return response;
}
async function upload(p){
  const u=p.upload;need(u?.file instanceof Blob&&u.file.size===u.bytes,'UPLOAD_CUSTODY','The original complete file is no longer in this browser.');
  const identity=await hashBlob(u.file);need(identity.sha256===u.sha256,'UPLOAD_IDENTITY','The selected source bytes changed.');
  let remote;try{remote=await api('/api/uploads/'+encodeURIComponent(u.id));}catch(e){if(e.status!==404)throw e;remote=await api('/api/uploads',{method:'POST',body:{uploadId:u.id,filename:u.filename,mediaType:u.mediaType,bytes:u.bytes,sha256:u.sha256}});}
  const check=v=>need(v.id===u.id&&v.sha256===u.sha256&&v.bytes===u.bytes&&Number.isSafeInteger(v.offset)&&v.offset>=0&&v.offset<=u.bytes,'UPLOAD_IDENTITY','The original host upload identifies different bytes.');
  check(remote);
  while(remote.offset<u.bytes){
    const start=remote.offset,end=Math.min(start+S.session.limits.chunk,u.bytes),chunk=u.file.slice(start,end),digest=await hashBlob(chunk);
    remote=await api('/api/uploads/'+encodeURIComponent(u.id),{method:'PUT',body:chunk,headers:{'Content-Type':'application/octet-stream','Content-Range':'bytes '+start+'-'+(end-1)+'/'+u.bytes,'X-Chunk-SHA256':digest.sha256}});
    check(remote);need(remote.offset>=end,'UPLOAD_OFFSET','The original chunk offset was not confirmed.');u.offset=remote.offset;await keepPending(p);notice('Retaining '+u.filename+' · '+size(remote.offset)+' / '+size(u.bytes));
  }
  const completed=await api('/api/uploads/'+encodeURIComponent(u.id)+'/finish',{method:'POST',body:{}});check(completed);need(completed.complete,'UPLOAD_INCOMPLETE','The original source has not closed.');u.complete=true;await keepPending(p);
}
async function sendPending(p){
  need(S.storageReady&&p&&S.pending?.requestId===p.requestId,'REQUEST_STORAGE_REQUIRED','Read the original pending request for this exact scope first.');need(!S.busy,'OPERATION_ACTIVE','Wait for the original operation.');need(p.scope===S.scope,'REQUEST_SCOPE','Open the original project for this request.');S.busy=true;controls();
  try{
    if(p.state==='committed')return await finish(p);
    if(p.upload&&!p.upload.complete)await upload(p);
    p.state='sending';delete p.error;await keepPending(p);
    const response=await api(p.path,{method:'POST',body:p.bodyText,headers:{'Content-Type':'application/json'}});
    need(response?.view?.id&&Number.isSafeInteger(response.currentRevision),'RESPONSE_UNOBSERVED','The original response did not include its complete project identity.');
    p.response=response;p.state='committed';await keepPending(p);return await finish(p);
  }catch(error){
    if(p.response)p.state='committed';else p.state=['REVISION_CONFLICT','UNAUTHENTICATED','OPERATOR_REQUIRED','INVALID_JSON'].includes(error.code)?'rejected':'uncertain';
    p.error={code:error.code||'REQUEST_UNOBSERVED',message:error.message};await keepPending(p);throw error;
  }finally{S.busy=false;controls();}
}
async function mutate(action,payload,{file,create=false,label=action}={}){
  need(S.storageReady&&S.scope===scope(S.view?.id),'REQUEST_STORAGE_REQUIRED','Open the original request storage before preparing another mutation.');need(S.session?.permissions.operate&&!S.view?.historical,'OPERATOR_REQUIRED','Open the current project with operator access.');need(!S.pending&&!S.busy,'ORIGINAL_REQUEST_PENDING','Reconcile the original request first.');
  const selected={projectId:S.view?.id,revision:S.view?.revision,scope:S.scope};let u=null;
  if(file){need(file instanceof File&&file.size>0&&file.size<=S.session.limits.upload,'UPLOAD_SIZE','Select a nonempty file within the installation upload limit.');S.busy=true;controls();
    try{const digest=await hashBlob(file);u={id:uid(),file,filename:file.name,mediaType:file.type||'application/octet-stream',...digest,offset:0,complete:false};payload={...payload,uploadId:u.id};}finally{S.busy=false;controls();}
  }
  need(S.storageReady&&S.scope===selected.scope,'VIEW_CHANGED','The project changed while the original action was prepared.');
  const requestId=uid(),body=create?{requestId,...payload}:{projectId:selected.projectId,requestId,expectedRevision:selected.revision,action,payload};
  const p={schema:'tjlabs.sling-browser-request.v1',scope:selected.scope,requestId,expectedRevision:selected.revision??null,path:create?'/api/projects':'/api/projects/'+encodeURIComponent(selected.projectId)+'/actions',bodyText:JSON.stringify(body),label,state:'prepared',createdAt:new Date().toISOString(),...(u?{upload:u}:{})};
  await keepPending(p);return sendPending(p);
}
async function projects(){const value=await api('/api/projects');S.projects=value.projects;$('#project-select').innerHTML='<option value="">Select a project</option>'+S.projects.map(p=>'<option value="'+h(p.id)+'">'+h(p.title)+'</option>').join('');if(S.view)$('#project-select').value=S.view.id;}
async function openProject(projectId,revision){
  const nav=++S.nav;clearTimeout(S.poll);S.storageRead++;S.storageReady=false;S.storageError=null;S.pending=null;S.scope=scope(projectId);renderPending();
  if(!projectId){S.view=null;if(!await pendingScope(null,{navigation:nav}))return;if(nav!==S.nav)return;render();return;}
  const value=await api('/api/projects/'+encodeURIComponent(projectId)+(revision===undefined?'':'?revision='+revision));if(nav!==S.nav)return;
  S.view=value.view;$('#revision').value=revision===undefined?'':revision;$('#project-select').value=projectId;if(!await pendingScope(projectId,{navigation:nav}))return;if(nav!==S.nav)return;render();poll();
}
function poll(){clearTimeout(S.poll);if(S.view&&!S.view.historical&&S.view.jobs.some(j=>['queued','running','cancelling'].includes(j.status)))S.poll=setTimeout(async()=>{if(S.busy||S.pending||$('#form-dialog').open){poll();return;}try{await openProject(S.view.id);}catch(e){report(e);poll();}},2000);}
function output(kind,id){return'/api/projects/'+encodeURIComponent(S.view.id)+'/outputs/'+kind+'/'+encodeURIComponent(id)+(S.view.historical?'?revision='+S.view.revision:'');}
async function download(path,filename){
  const response=await api(path,{raw:true}),reader=response.body.getReader(),parts=[],hash=createSHA256();let bytes=0;
  try{for(;;){const item=await reader.read();if(item.done)break;hash.update(item.value);bytes+=item.value.length;parts.push(item.value);}}finally{reader.releaseLock();}
  need(hash.hex()===response.headers.get('x-content-sha256')&&bytes===Number(response.headers.get('content-length')),'DOWNLOAD_IDENTITY','The full download did not match its original SHA and length.');
  const blob=new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename||/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'retained-source';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('Downloaded the complete verified '+a.download+'.');
}
async function readOutput(kind,id){const response=await api(output(kind,id),{raw:true});need(Number(response.headers.get('content-length'))<=32*1024*1024,'DETAIL_SIZE','Download the complete larger record to inspect it.');const body=await response.arrayBuffer();need((await hashBlob(new Blob([body]))).sha256===response.headers.get('x-content-sha256'),'DOWNLOAD_IDENTITY','The retained detail hash differs.');return JSON.parse(new TextDecoder().decode(body));}
function detail(title,content){$('#detail-title').textContent=title;$('#detail-content').innerHTML=typeof content==='string'?content:'<pre>'+h(j(content))+'</pre>';$('#detail-dialog').showModal();}
function render(){
  $('#navigation').innerHTML=Object.entries(PANES).map(([key,label])=>'<button data-pane="'+key+'" aria-current="'+(key===S.pane?'page':'false')+'">'+h(label)+'</button>').join('');
  $('#page-title').textContent=PANES[S.pane];$('#page-subtitle').textContent=S.view?S.view.title+' · revision '+S.view.revision+(S.view.historical?' · retained historical edition':''): 'Choose a project or create an original migration record.';
  $('#runtime-state').textContent=S.session.runtime.available?'dlt '+S.session.runtime.version+' · DuckDB '+S.session.runtime.duckdb.version:'Select the installed original dlt runtime';
  const p=S.view;if(!p){$('#content').innerHTML=empty('Start with the original source','Create a project, then retain complete data, independent expected tables and the original native pipeline configuration.');controls();return;}
  const handoffs=[...new Map([...(p.handoffs??[]).map(v=>[v.id,{...v,...p.handoffCustody?.[v.id]}]),...Object.values(p.handoffCustody??{}).map(v=>[v.id,v])]).values()];
  let body='';
  if(S.pane==='overview'){
    const latest=p.comparisons.at(-1);
    body='<div class="grid">'+metric('Retained sources',p.sources.length,'Complete original bytes')+metric('Migration plans',p.plans.length,'Source and binding editions')+metric('Native runs',p.jobs.filter(j=>j.status==='complete').length+' / '+p.jobs.length,'Completed original operations')+'</div><br><div class="split">'+card('Current migration', '<dl class="detail-grid"><dt>Plan</dt><dd>'+h(p.plans.find(r=>r.id===p.currentPlanId)?.title||'No plan selected')+'</dd><dt>Comparison</dt><dd>'+badge(latest?(latest.readyForCutover?'ready':latest.equal?'equal':'differences'):'not compared')+'</dd><dt>Consumer</dt><dd>'+badge(p.consumer.state)+'</dd><dt>Project updated</dt><dd>'+h(time(p.updatedAt))+'</dd></dl><p>'+h(p.notes)+'</p>',button('Edit project','project.edit','',true))+card('Operating sequence','<ol class="timeline">'+['Retain complete data and independent expected exports','Review native schema, cursor, keys and merge strategy','Extract, normalize and load with original dlt packages','Compare all typed rows and normalized table coverage','Verify and select the retained consumer binding','Receive complete pipeline state, data and editable application'].map((s,i)=>'<li><strong>'+h((i+1)+'. '+s)+'</strong></li>').join('')+'</ol>')+'</div>';
  }else if(S.pane==='sources'){
    body='<p class="section-intro">Keep each complete source with its original URL and role. Native configuration, original documentation and complete response files retain separate identities.</p>'+card('Source library',p.sources.length?table(['Source','Role / captured','Original identity',''],p.sources.map(s=>['<strong>'+h(s.title)+'</strong><span class="muted">'+h(s.filename)+' · '+size(s.bytes)+'</span>',h(s.role)+'<span class="muted">'+h(time(s.capturedAt))+'</span>','<span class="mono">'+h(brief(s.sha256))+'</span>', '<div class="actions">'+button('Inspect','source.inspect',s.id)+button('Download','source.download',s.id)+'</div>'])):empty('Retain a complete source','Original configurations and data remain unchanged.'),button('Retain source','source.add','',true)+button('Author configuration','source.author','',true)+button('Review Airbyte intake','airbyte.review','',true));
  }else if(S.pane==='plans'){
    body='<p class="section-intro">Native resource hints, schema contracts, merge strategy, source cursor and independent expected tables remain explicit. Every normalized business table needs a complete acceptance mapping.</p>'+card('Plan editions',p.plans.length?table(['Edition','Streams','Review',''],p.plans.map(v=>['<strong>'+h(v.title)+'</strong><span class="muted mono">'+h(brief(v.semanticPlanId))+'</span>',String(v.selectedStreams.length),badge(v.status)+'<span class="muted">'+(v.ready?'Semantics ready':h(v.issues.length+' review items'))+'</span>','<div class="actions">'+button('Inspect','plan.inspect',v.id)+button('Replication','plan.download',v.id,false,!v.replication)+button('Review','plan.review',v.id,true)+'</div>'])):empty('Prepare the first plan','Retain an original dlt input with source IDs and independent expected tables.'),button('Compile plan','plan.add','',true));
  }else if(S.pane==='runs'){
    body='<p class="section-intro">Each operation owns the original dlt pipeline stage and retains state, schemas, load packages, jobs, traces and the complete DuckDB database. Load and normalization continue through dlt recovery. Uncertain extraction requires explicit reconciliation.</p>'+card('Installed original engine','<dl class="detail-grid"><dt>Selected release</dt><dd>'+h(S.session.runtime.version||'Not selected')+'</dd><dt>Runtime identity</dt><dd class="mono">'+h(S.session.runtime.runtimeId||'Original runtime unavailable')+'</dd><dt>Retained project runtime</dt><dd>'+h(p.runtime?.adapter||'Not yet retained')+'</dd></dl>',button('Retain runtime','runtime.select','',true,!S.session.runtime.available))+card('Native operations',p.jobs.length?table(['Run / phase','Status','Original outcome',''],p.jobs.map(v=>['<strong>'+h(v.phase)+'</strong><span class="muted mono">'+h(brief(v.id))+'</span>',badge(v.status),h(v.nativeState?.error?j(v.nativeState.error):v.mode+' · '+Object.keys(v.nativeState?.steps||{}).length+' native steps'),'<div class="actions">'+button('Inspect','job.inspect',v.id)+button('Files','job.files',v.id)+(v.status==='prepared'?button('Start','job.start',v.id,true):'')+(['failed','interrupted','awaiting_reconciliation','cancelled'].includes(v.status)?button('Resume','job.resume',v.id,true):'')+(['queued','running','cancelling','prepared'].includes(v.status)?button('Cancel','job.cancel',v.id,true):'')+(v.status==='awaiting_reconciliation'?button('Resolve write','job.resolve',v.id,true):'')+'</div>'])):empty('Prepare a native run','Select a reviewed native plan and the original closed parent job, then choose extract, normalize, load or full verification.'),button('Prepare run','run.add','',true));
  }else if(S.pane==='comparisons'){
    body='<p class="section-intro">Every selected business row and duplicate multiplicity is compared. The review includes full schemas, typed values, keys and the actual native command outcome; displayed examples do not limit the comparison.</p>'+card('Complete comparisons',p.comparisons.length?table(['Native run','Result','Plan identity',''],p.comparisons.map(v=>[h(brief(v.jobId)),badge(v.readyForCutover?'ready':v.equal?'equal':'differences'),'<span class="mono">'+h(brief(v.semanticPlanId))+'</span>','<div class="actions">'+button('Review','comparison.inspect',v.id)+button('Full report','comparison.download',v.id)+button('Typed data','observations.download',v.id)+'</div>'])):empty('Compare an original completed run','The comparison reads its full retained source and target observations.'),button('Create comparison','comparison.add','',true));
  }else if(S.pane==='cutover'){
    const current=p.cutovers.find(v=>v.id===p.currentCutoverId);
    body='<p class="section-intro">Select a consumer table declaration after the latest explicit verification compares all rows. Original tables and previous declarations remain retained. External applications use their existing authorized configuration to adopt the reviewed declaration.</p>'+card('Actual consumer binding',current?'<dl class="detail-grid"><dt>Selection</dt><dd>'+badge(current.selection.kind)+' '+badge(p.consumer.state)+'</dd><dt>Source run</dt><dd class="mono">'+h(current.selection.jobId)+'</dd><dt>Binding SHA256</dt><dd class="mono">'+h(current.selection.snapshot.sha256)+'</dd><dt>Reason</dt><dd>'+h(current.reason)+'</dd></dl>':empty('Consumer has not switched','Complete and review an exact native comparison first.'),button('Switch consumer','cutover.add','',true)+(current?button('Retained results','consumer.query')+button('Rollback','cutover.rollback',current.id,true):''))+card('Consumer selection history',p.cutovers.length?table(['Changed','Kind','Reason','Binding'],p.cutovers.map(v=>[h(time(v.createdAt)),badge(v.kind),h(v.reason),'<span class="mono">'+h(brief(v.selection.snapshot.sha256))+'</span>'])):'<p class="muted">No selection changes.</p>');

  }else if(S.pane==='delivery'){
    body='<p class="section-intro">A complete handoff retains the selected immutable history, original sources, all native operation files, actual engine observations, complete native pipeline and DuckDB files and editable application. Received jobs stay closed until explicitly continued.</p>'+card('Named complete handoffs',handoffs.length?table(['Package','Selected revision','Bytes / identity',''],handoffs.map(v=>['<strong>'+h(v.title)+'</strong><span class="muted">'+h(v.filename)+'</span>',String(v.revision),(v.sha256?size(v.bytes):'Preparing')+'<span class="muted mono">'+h(brief(v.sha256||''))+'</span>',button('Download complete','handoff.download',v.id,false,!v.sha256)])):empty('Prepare a full handoff','Close the original native operations before freezing a receiving edition.'),button('Prepare handoff','handoff.add','',true)+button('Receive complete','handoff.receive','',true))+card('Original history',table(['Revision','Action','Actor','Retained at'],p.history.slice().reverse().map(v=>['<button class="text-button small" data-revision="'+v.revision+'">'+v.revision+'</button>',h(v.type),h(v.actorId),h(time(v.createdAt))])));
  }
  $('#content').innerHTML=body;controls();
}
function options(rows,selected){return rows.map(([id,label])=>'<option value="'+h(id)+'"'+(id===selected?' selected':'')+'>'+h(label)+'</option>').join('');}
function input(name,label,value='',{type='text',help='',required=true}={}){return'<label>'+h(label)+'<input name="'+name+'" type="'+type+'" value="'+h(value)+'"'+(required?' required':'')+'>'+(help?'<span class="help">'+h(help)+'</span>':'')+'</label>';}
function select(name,label,rows,selected){return'<label>'+h(label)+'<select name="'+name+'"'+(rows.some(row=>row[0]==='')?'':' required')+'>'+options(rows,selected)+'</select></label>';}
function area(name,label,value='',code=false,help=''){return'<label>'+h(label)+'<textarea name="'+name+'" class="'+(code?'code':'')+'" required>'+h(typeof value==='string'?value:j(value))+'</textarea>'+(help?'<span class="help">'+h(help)+'</span>':'')+'</label>';}
function form(title,fields,callback){need(S.storageReady&&S.scope===scope(S.view?.id),'REQUEST_STORAGE_REQUIRED','Read the original request state before editing this scope.');S.form={callback,scope:S.scope,revision:S.view?.revision};$('#form-title').textContent=title;$('#form-fields').innerHTML=fields;$('#form-context').textContent=S.view?'Project revision '+S.view.revision:'New original project';$('#form-dialog').showModal();controls();}
function obj(text,label){try{return JSON.parse(text);}catch{throw new Error(label+' must be complete JSON.');}}
async function action(name,key){
  const p=S.view,source=p?.sources.find(v=>v.id===key),plan=p?.plans.find(v=>v.id===key),job=p?.jobs.find(v=>v.id===key);
  if(name==='retry-storage'){if(await pendingScope(S.view?.id)){render();notice('Original request storage is ready.');}return;}
  if(name==='retry-pending')return sendPending(S.pending);
  if(name==='show-pending')return detail('Original request',{...S.pending,upload:S.pending.upload?{...S.pending.upload,file:'Original file retained in IndexedDB'}:undefined});
  if(name==='close-pending'){need(S.storageReady,'REQUEST_STORAGE_REQUIRED','Read the original pending request first.');need(S.pending.state==='rejected','REQUEST_UNCERTAIN','Reconcile the actual original request before closing it.');await saved('last:'+S.scope,S.pending);await saved('pending:'+S.scope,undefined,{expected:S.pending});S.pending=null;renderPending();if(p)await openProject(p.id);return;}
  if(name==='project.edit')return form('Edit project',input('title','Project title',p.title)+area('notes','Notes',p.notes),v=>mutate('project.update',v,{label:'project details'}));
  if(name==='source.add')return form('Retain complete source',input('title','Source title')+select('role','Source role',[['pipeline_config','Complete native dlt configuration'],['data','Original complete input data'],['expected','Independent expected typed table'],['airbyte','Original Airbyte configuration'],['documentation','Source documentation'],['other','Other retained source']])+input('url','Original source URL','',{required:false})+input('file','Complete original file','',{type:'file'})+area('notes','Source notes','Original source retained without changing its content.'),v=>mutate('source.retain',{title:v.title,role:v.role,url:v.url,notes:v.notes},{file:v.file,label:'original source'}));

  if(name==='source.author')return form('Author an editable native configuration',input('title','Configuration title','Native dlt input')+area('configuration','Complete native configuration',{"schema":"dlthub.pipeline-input.v1","title":"Original pipeline migration","pipelineName":"customer_pipeline","datasetName":"customer_data","phase":"baseline","resources":[{"name":"records","sourceId":"RETAINED_DATA_SOURCE_ID","format":"csv","columns":[{"name":"id","data_type":"bigint","nullable":false},{"name":"updated_at","data_type":"timestamp"},{"name":"amount","data_type":"decimal","precision":38,"scale":7}],"primaryKey":["id"],"writeDisposition":{"disposition":"merge","strategy":"delete-insert"},"incremental":{"cursor_path":"updated_at","initial_value":"2000-01-01T00:00:00Z"},"schemaContract":{"tables":"evolve","columns":"evolve","data_type":"freeze"},"nullValues":[""],"maxTableNesting":10}],"acceptance":[{"table":"records","expectedSourceId":"RETAINED_EXPECTED_SOURCE_ID","columns":[{"name":"id","cellType":"integer"},{"name":"updated_at","cellType":"timestamp"},{"name":"amount","cellType":"decimal"}],"primaryKey":["id"],"ignoredRightColumns":["_dlt_load_id","_dlt_id"]}],"sourceBoundary":"Complete retained original data and separately prepared expected destination."},true,'Replace the source IDs with retained complete files. Every expected table uses dlthub.expected-table.v1 with exact typed cells.'),v=>{const value=obj(v.configuration,'Native configuration'),file=new File([j(value)+'\n'],'pipeline-input.json',{type:'application/json'});return mutate('source.retain',{title:v.title,role:'pipeline_config',url:'',notes:'Operator-authored native dlt configuration retained in full.'},{file,label:'native configuration edition'});});
  if(name==='source.download')return download('/api/projects/'+p.id+'/sources/'+key+(p.historical?'?revision='+p.revision:''),source.filename);
  if(name==='source.inspect'){
    let extra='';if(source.mediaType.includes('json')||source.filename.endsWith('.json'))try{const c=await api('/api/projects/'+p.id+'/sources/'+key+'/connections'+(p.historical?'?revision='+p.revision:''));extra='<h3>Original connections</h3><pre>'+h(j(c.connections))+'</pre>';}catch(e){extra='<p class="muted">'+h(errorText(e))+'</p>';}
    return detail(source.title,'<dl class="detail-grid">'+Object.entries(source).map(([k,v])=>'<dt>'+h(k)+'</dt><dd>'+h(typeof v==='object'?j(v):v)+'</dd>').join('')+'</dl>'+extra);
  }
  if(name==='plan.add')return form('Compile native pipeline plan',input('title','Plan title','Reviewed original dlt migration')+select('sourceId','Complete native configuration',p.sources.map(v=>[v.id,v.title])),v=>mutate('plan.compile',v,{label:'native pipeline plan'}));
  if(name==='plan.inspect')return detail(plan.title,await readOutput('plan',key));
  if(name==='plan.download')return download(output('replication',key));
  if(name==='plan.review')return form('Review exact plan',select('decision','Decision',[['approved','Approve the exact runnable plan'],['changes_required','Changes required']])+area('notes','Review reasoning','I reviewed native types, source IDs, expected complete exports, cursor, primary keys, merge strategy and schema contracts.'),v=>mutate('plan.review',{planId:key,...v},{label:'plan review'}));
  if(name==='runtime.select')return mutate('runtime.select',{}, {label:'original runtime selection'});
  if(name==='run.add')return form('Prepare original dlt stage',select('planId','Approved plan',p.plans.filter(v=>v.status==='approved').map(v=>[v.id,v.title]),p.currentPlanId)+select('stage','Native operation',[['run','Extract → normalize → load'],['extract','Extract to original load packages'],['normalize','Normalize original pending packages'],['load','Load or resume original pending packages'],['verify','Read complete native destination and parity'],['inspect','Retain original state/package inspection'],['retry_failed','Original retry_failed_job'],['abort','Original abort_packages']])+select('parentJobId','Original closed pipeline', [['','New original pipeline'],...p.jobs.filter(j=>!['queued','running','cancelling','prepared'].includes(j.status)&&j.files.length).map(j=>[j.id,j.stage+' · '+brief(j.id)+' · '+j.status])],p.jobs.filter(j=>!['queued','running','cancelling','prepared'].includes(j.status)&&j.files.length).at(-1)?.id)+area('options','Original native options (JSON)','{}',true,'retry_failed requires loadId and jobFileName; abort optionally selects loadId. Names are original native identifiers.')+area('reason','Reason','Continue the exact retained original pipeline and selected data edition.')+input('forkReason','Earlier-parent fork reason','',{required:false}),v=>mutate('run.prepare',{planId:v.planId,stage:v.stage,parentJobId:v.parentJobId||undefined,options:obj(v.options,'Native options'),reason:v.reason,forkReason:v.forkReason||undefined},{label:'original native stage'}));
  if(name==='job.start')return mutate('job.start',{jobId:key},{label:'original dlt stage'});
  if(['job.resume','job.cancel'].includes(name))return form(name==='job.resume'?'Continue original native job':'Cancel original native job',area('reason','Reason',name==='job.resume'?'Continue the original retained selection and reconcile every previous command.':'Stop this original operation.'),v=>mutate(name,{jobId:key,...v},{label:name==='job.resume'?'original job continuation':'original job cancellation'}));
  if(name==='job.resolve'){
    const rows=Object.values(job.nativeState?.steps||{}).filter(v=>v.writesTarget&&v.status!=='complete');
    return form('Resolve original target write',select('stepId','Exact original step',rows.map(v=>[v.id,v.id+' · '+v.status]))+select('decision','Reviewed outcome',[['adopt','Adopt the observed original outcome'],['retry','Explicitly authorize retry of this step'],['abandon','Abandon the original operation']])+area('reason','Evidence and reasoning'),v=>{const step=rows.find(r=>r.id===v.stepId);return mutate('job.resolve',{jobId:key,stepId:step.id,attemptId:step.attemptId,decision:v.decision,reason:v.reason},{label:'target-write reconciliation'});});
  }
  if(name==='job.inspect')return detail('Original native operation',job);
  if(name==='job.files')return detail('Complete native files',job.files.length?table(['Original path','Bytes / SHA',''],job.files.map(v=>[h(v.path),size(v.bytes)+'<span class="muted mono">'+h(brief(v.sha256))+'</span>','<button class="small" data-native-job="'+key+'" data-native-path="'+h(v.path)+'">Download</button>'])):empty('Native files are not closed yet','The actual operation must close before its full file set is retained.'));
  if(name==='comparison.add')return form('Compare complete native output',select('jobId','Original completed run',p.jobs.filter(v=>v.kind==='dlt_pipeline'&&v.status==='complete').map(v=>[v.id,v.phase+' · '+brief(v.id)])),v=>mutate('comparison.create',v,{label:'complete source/target comparison'}));
  if(name==='comparison.inspect'){
    const value=await readOutput('comparison',key);
    return detail('Complete typed comparison','<p>'+badge(value.readyForCutover?'ready':value.equal?'equal':'differences')+'</p>'+table(['Stream','Left / right','Rows equal','Schema','Keys / readiness'],value.nativeReport.streams.map(v=>[h(v.streamId),h((v.left?.rowCount??v.left?.rows??'?')+' / '+(v.right?.rowCount??v.right?.rows??'?')),badge(v.equal?'equal':'differences'),badge(v.schema.compatible?'ready':'differences'),badge(v.readyForCutover?'ready':'review')]))+'<h3>Full comparison record</h3><pre>'+h(j(value))+'</pre>');
  }
  if(name==='comparison.download')return download(output('comparison',key));
  if(name==='observations.download')return download(output('observations',key));
  if(name==='cutover.add')return form('Switch actual consumer',select('comparisonId','Complete ready comparison',p.comparisons.filter(v=>v.readyForCutover&&p.jobs.find(j=>j.id===v.jobId)?.mode==='verify').map(v=>[v.id,brief(v.jobId)+' · '+brief(v.comparisonId)]))+area('reason','Reviewed switch reason'),v=>mutate('cutover.apply',v,{label:'consumer cutover'}));
  if(name==='cutover.rollback')return form('Restore earlier consumer binding',area('reason','Rollback reason','Restore the exact earlier retained consumer binding, preserving both native datasets.'),v=>mutate('cutover.rollback',{cutoverId:key,...v},{label:'consumer rollback'}));
  if(name==='consumer.query'){const value=await api('/api/projects/'+p.id+'/consumer');return detail('Retained native consumer review','<p>These are the complete retained native results from the selected verification. This view does not issue a live database query.</p><p>'+h(value.rowCount)+' total rows · '+h(value.rows.length)+' displayed</p>'+table(value.columns.map(c=>c.name),value.rows.map(row=>row.map(v=>h(v.type==='null'?'NULL':v.value))))+'<h3>Original native pipeline and consumer declaration</h3><pre>'+h(j(value.binding))+'</pre>');}
  if(name==='airbyte.review')return form('Review original Airbyte configuration',select('sourceId','Original complete configuration',p.sources.map(s=>[s.id,s.title]))+area('options','Connection selection options','{}',true),v=>mutate('airbyte.review',{sourceId:v.sourceId,options:obj(v.options,'Selection options')},{label:'original Airbyte semantic intake'}));
  if(name==='handoff.add')return form('Prepare complete editable handoff',input('title','Named package title','Complete migration receiving edition')+input('revision','Retained revision',p.revision,{type:'number'})+area('notes','Receiving notes','Complete project history, original source and native operation files with editable application.'),v=>mutate('handoff.prepare',{...v,revision:Number(v.revision)},{label:'complete project handoff'}));
  if(name==='handoff.receive')return form('Receive original complete project',input('file','Complete original NDJSON handoff (gzip v1 also accepted)','',{type:'file'}),v=>mutate('handoff.receive',{}, {file:v.file,label:'complete project receiving'}));
  if(name==='handoff.download')return download(output('handoff',key));
}
async function login(token){
  S.token=token;const info=await api('/api/info');S.session=info;sessionStorage.setItem('dlthub-token',token);
  $('#identity').textContent=info.actor.name+' · '+info.actor.roles.join(', ');$('#signout').hidden=false;$('#login').hidden=true;$('#application').hidden=false;
  await projects();await openProject(S.projects[0]?.id);notice('');
}
$('#login-form').addEventListener('submit',e=>{e.preventDefault();login($('#token').value.trim()).catch(e=>{$('#login').hidden=false;$('#application').hidden=true;alert(errorText(e));});});
$('#signout').addEventListener('click',()=>{clearTimeout(S.poll);sessionStorage.removeItem('dlthub-token');S.token='';S.session=null;S.view=null;S.scope=null;S.pending=null;S.storageReady=false;S.storageError=null;S.storageRead++;S.nav++;$('#application').hidden=true;$('#login').hidden=false;$('#signout').hidden=true;$('#token').value='';});
$('#project-select').addEventListener('change',e=>openProject(e.target.value).catch(report));
$('#create-project').addEventListener('click',async()=>{try{need(S.storageReady&&!S.busy&&!S.pending,'REQUEST_STORAGE_REQUIRED','Read and reconcile the original scope first.');await openProject(null);if(!S.storageReady)return;form('Create migration project',input('title','Project title','Native dlt pipeline migration')+area('notes','Operating scope','Retain the original source and a separate target through comparison, cutover and receiving.'),v=>mutate('project.create',v,{create:true,label:'new migration project'}));}catch(e){report(e);}});
$('#refresh').addEventListener('click',()=>S.view&&openProject(S.view.id,S.view.historical?S.view.revision:undefined).catch(report));
$('#current').addEventListener('click',()=>S.view&&openProject(S.view.id).catch(report));
$('#revision').addEventListener('change',e=>S.view&&openProject(S.view.id,e.target.value===''?undefined:Number(e.target.value)).catch(report));
$('#navigation').addEventListener('click',e=>{const b=e.target.closest('[data-pane]');if(b){S.pane=b.dataset.pane;render();}});
$('#form-close').addEventListener('click',()=>$('#form-dialog').close());$('#detail-close').addEventListener('click',()=>$('#detail-dialog').close());
$('#operation-form').addEventListener('submit',async e=>{e.preventDefault();try{need(S.storageReady&&S.form&&S.form.scope===S.scope,'FORM_SCOPE','The original form belongs to another project.');const values=Object.fromEntries(new FormData(e.target));await S.form.callback(values);}catch(e){report(e);}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)action(b.dataset.action,b.dataset.id).catch(report);
  const d=e.target.closest('[data-downstream-file]');if(d&&S.view)download('/api/projects/'+S.view.id+'/downstream/'+d.dataset.operation+'?path='+encodeURIComponent(d.dataset.downstreamFile)+(S.view.historical?'&revision='+S.view.revision:'')).catch(report);
  const revision=e.target.closest('[data-revision]');if(revision&&S.view)openProject(S.view.id,Number(revision.dataset.revision)).catch(report);
  const n=e.target.closest('[data-native-job]');if(n&&S.view)download('/api/projects/'+S.view.id+'/native/'+n.dataset.nativeJob+'?path='+encodeURIComponent(n.dataset.nativePath)+(S.view.historical?'&revision='+S.view.revision:'')).catch(report);
});
if(S.token)login(S.token).catch(()=>{sessionStorage.removeItem('dlthub-token');S.token='';});

Object.defineProperty(window,'dltOperator',{value:Object.freeze({inspect:()=>({instanceId:S.session?.instanceId??null,actorId:S.session?.actor?.id??null,projectId:S.view?.id??null,revision:S.view?.revision??null,historical:S.view?.historical??false,scope:S.scope,storageReady:S.storageReady,storageError:S.storageError?{...S.storageError}:null,busy:S.busy,pending:S.pending?{requestId:S.pending.requestId,state:S.pending.state,scope:S.pending.scope,expectedRevision:S.pending.expectedRevision,label:S.pending.label}:null})}),writable:false,configurable:false});
