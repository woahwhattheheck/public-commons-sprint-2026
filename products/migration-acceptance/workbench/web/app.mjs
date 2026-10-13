import {hashBlob,createSHA256} from '/assets/sha256.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const S={token:sessionStorage.getItem('definian-token')||'',session:null,projects:[],view:null,pane:'overview',scope:null,pending:null,storageReady:false,storageError:null,storageRead:0,busy:false,form:null,nav:0,db:null,poll:null};
const PANES={overview:'Overview',sources:'Sources',plans:'Migration plans',runs:'Native runs',comparisons:'Comparison',acceptance:'Business acceptance',cutover:'Cutover & consumers',delivery:'Delivery & history'};
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
  S.db=new Promise((yes,no)=>{const q=indexedDB.open('definian-migration-requests-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('records',{keyPath:'key'});q.onerror=()=>no(q.error);q.onblocked=()=>no(new Error('The original request store is held by an older tab.'));q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();S.db=null;};yes(q.result);};}).catch(e=>{S.db=null;throw e;});return S.db;
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
const ACCEPTANCE_VALIDATION_CODES=new Set(["ACCEPTANCE_COLUMNS","ACCEPTANCE_COLUMN_DUPLICATE","ACCEPTANCE_COLUMNS_EMPTY","ACCEPTANCE_OBJECT","ACCEPTANCE_UNKNOWN_FIELD","ACCEPTANCE_POLICY","ACCEPTANCE_COLUMN_NOT_SELECTED","ACCEPTANCE_INPUT","ACCEPTANCE_OBJECTS","ACCEPTANCE_STREAM","ACCEPTANCE_NATIVE_KEY","ACCEPTANCE_OBJECT_DUPLICATE","ACCEPTANCE_STREAM_DUPLICATE","ACCEPTANCE_STREAM_CLOSURE","ACCEPTANCE_RULES","ACCEPTANCE_RELATION_OBJECT","ACCEPTANCE_RELATION_WIDTH","ACCEPTANCE_RELATION_TYPE","ACCEPTANCE_RELATION_NULLS","ACCEPTANCE_RELATION_DUPLICATE","ACCEPTANCE_CONTROL_OBJECT","ACCEPTANCE_MEASURE","ACCEPTANCE_SUM_TYPE","ACCEPTANCE_SCALE","ACCEPTANCE_COUNT","ACCEPTANCE_CONTROL_NULLS","ACCEPTANCE_CONTROL_DUPLICATE","ACCEPTANCE_PLAN_CHANGED","ACCEPTANCE_SUM_CELL","ACCEPTANCE_SUM_SCALE","ACCEPTANCE_SUM_RANGE","ACCEPTANCE_SUM_FAILED","ACCEPTANCE_OBSERVATION_BINDING","ACCEPTANCE_PARITY","ACCEPTANCE_PARITY_BINDING","ACCEPTANCE_PARITY_CHANGED","ACCEPTANCE_FINDING_DUPLICATE","ACCEPTANCE_REPORT","ACCEPTANCE_REPORT_CHANGED","ACCEPTANCE_DECISIONS","ACCEPTANCE_DECISION_BINDING","ACCEPTANCE_DECISION_DUPLICATE","ACCEPTANCE_DISPOSITION","ACCEPTANCE_DECISION_REASON","ACCEPTANCE_REQUIRED_HOLD","invalid_identifier","missing_document_digest","document_edition_changed","invalid_json_value"]);
function rejectedAcceptanceInput(p,error){if(error.status!==400||!ACCEPTANCE_VALIDATION_CODES.has(error.code))return false;let body;try{body=JSON.parse(p.bodyText);}catch{return false;}return ['acceptance.compile','acceptance.evaluate','acceptance.decide'].includes(body.action);}
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
    if(p.response)p.state='committed';else p.state=(['REVISION_CONFLICT','UNAUTHENTICATED','OPERATOR_REQUIRED','INVALID_JSON'].includes(error.code)||rejectedAcceptanceInput(p,error))?'rejected':'uncertain';
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
function detail(title,content){$('#detail-title').textContent=title;$('#detail-content').innerHTML=typeof content==='string'?content:'<pre>'+h(j(content))+'</pre>';$('#detail-dialog').showModal();controls();}
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
  }else if(S.pane==='acceptance'){
    body=renderQuality(p);
  }else if(S.pane==='cutover'){
    const current=p.cutovers.find(v=>v.id===p.currentCutoverId);
    body='<p class="section-intro">Select a consumer table declaration after the latest explicit verification compares all rows. Original tables and previous declarations remain retained. External applications use their existing authorized configuration to adopt the reviewed declaration.</p>'+card('Actual consumer binding',current?'<dl class="detail-grid"><dt>Selection</dt><dd>'+badge(current.selection.kind)+' '+badge(p.consumer.state)+'</dd><dt>Source run</dt><dd class="mono">'+h(current.selection.jobId)+'</dd><dt>Binding SHA256</dt><dd class="mono">'+h(current.selection.snapshot.sha256)+'</dd><dt>Reason</dt><dd>'+h(current.reason)+'</dd></dl>':empty('Consumer has not switched','Complete and review an exact native comparison first.'),button('Switch consumer','cutover.add','',true)+(current?button('Retained results','consumer.query','',false,p.historical)+button('Rollback','cutover.rollback',current.id,true):''))+card('Consumer selection history',p.cutovers.length?table(['Changed','Kind','Reason','Binding'],p.cutovers.map(v=>[h(time(v.createdAt)),badge(v.kind),h(v.reason),'<span class="mono">'+h(brief(v.selection.snapshot.sha256))+'</span>'])):'<p class="muted">No selection changes.</p>');

  }else if(S.pane==='delivery'){
    body='<p class="section-intro">A complete handoff retains the selected immutable history, original sources, all native operation files, actual engine observations, complete native pipeline and DuckDB files and editable application. Received jobs stay closed until explicitly continued.</p>'+card('Named complete handoffs',handoffs.length?table(['Package','Selected revision','Bytes / identity',''],handoffs.map(v=>['<strong>'+h(v.title)+'</strong><span class="muted">'+h(v.filename)+'</span>',String(v.revision),(v.sha256?size(v.bytes):'Preparing')+'<span class="muted mono">'+h(brief(v.sha256||''))+'</span>',button('Download complete','handoff.download',v.id,false,!v.sha256)])):empty('Prepare a full handoff','Close the original native operations before freezing a receiving edition.'),button('Prepare handoff','handoff.add','',true)+button('Receive complete','handoff.receive','',true))+card('Original history',table(['Revision','Action','Actor','Retained at'],p.history.slice().reverse().map(v=>['<button class="text-button small" data-revision="'+v.revision+'">'+v.revision+'</button>',h(v.type),h(v.actorId),h(time(v.createdAt))])));
  }
  if(S.pane==='overview')body+=qualitySummary(p);
  if(S.pane==='cutover')body=qualitySummary(p)+body;
  $('#content').innerHTML=body;controls();
}
function options(rows,selected){return rows.map(([id,label])=>'<option value="'+h(id)+'"'+(id===selected?' selected':'')+'>'+h(label)+'</option>').join('');}
function input(name,label,value='',{type='text',help='',required=true}={}){return'<label>'+h(label)+'<input name="'+name+'" type="'+type+'" value="'+h(value)+'"'+(required?' required':'')+'>'+(help?'<span class="help">'+h(help)+'</span>':'')+'</label>';}
function select(name,label,rows,selected){return'<label>'+h(label)+'<select name="'+name+'"'+(rows.some(row=>row[0]==='')?'':' required')+'>'+options(rows,selected)+'</select></label>';}
function area(name,label,value='',code=false,help=''){return'<label>'+h(label)+'<textarea name="'+name+'" class="'+(code?'code':'')+'" required>'+h(typeof value==='string'?value:j(value))+'</textarea>'+(help?'<span class="help">'+h(help)+'</span>':'')+'</label>';}
function form(title,fields,callback){need(S.storageReady&&S.scope===scope(S.view?.id),'REQUEST_STORAGE_REQUIRED','Read the original request state before editing this scope.');S.form={callback,scope:S.scope,revision:S.view?.revision};$('#form-submit').textContent='Save action';$('#form-title').textContent=title;$('#form-fields').innerHTML=fields;$('#form-context').textContent=S.view?'Project revision '+S.view.revision:'New original project';$('#form-dialog').showModal();controls();}
function obj(text,label){try{return JSON.parse(text);}catch{throw new Error(label+' must be complete JSON.');}}
async function action(name,key){
  if(name.startsWith('quality.'))return qualityAction(name,key);
  const p=S.view,source=p?.sources.find(v=>v.id===key),plan=p?.plans.find(v=>v.id===key),job=p?.jobs.find(v=>v.id===key);
  if(name==='retry-storage'){if(await pendingScope(S.view?.id)){render();notice('Original request storage is ready.');}return;}
  if(name==='retry-pending')return sendPending(S.pending);
  if(name==='show-pending')return detail('Original request',{...S.pending,upload:S.pending.upload?{...S.pending.upload,file:'Original file retained in IndexedDB'}:undefined});
  if(name==='close-pending'){need(S.storageReady,'REQUEST_STORAGE_REQUIRED','Read the original pending request first.');need(S.pending.state==='rejected','REQUEST_UNCERTAIN','Reconcile the actual original request before closing it.');await saved('last:'+S.scope,S.pending);await saved('pending:'+S.scope,undefined,{expected:S.pending});S.pending=null;renderPending();if(p)await openProject(p.id);return;}
  if(name==='project.edit')return form('Edit project',input('title','Project title',p.title)+area('notes','Notes',p.notes),v=>mutate('project.update',v,{label:'project details'}));
  if(name==='source.add')return form('Retain complete source',input('title','Source title')+select('role','Source role',[['pipeline_config','Complete native dlt configuration'],['data','Original complete input data'],['expected','Independent expected typed table'],['airbyte','Original Airbyte configuration'],['acceptance_input','Business acceptance rules'],['documentation','Source documentation'],['other','Other retained source']])+input('url','Original source URL','',{required:false})+input('file','Complete original file','',{type:'file'})+area('notes','Source notes','Original source retained without changing its content.'),v=>mutate('source.retain',{title:v.title,role:v.role,url:v.url,notes:v.notes},{file:v.file,label:'original source'}));

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
    return detail('Complete typed comparison','<p>'+badge(value.readyForCutover?'ready':value.equal?'equal':'differences')+'</p>'+table(['Stream','Left / right','Rows equal','Schema','Keys / readiness'],value.nativeReport.streams.map(v=>[h(v.streamId),h(v.left.observedRows+' / '+v.right.observedRows),badge(v.equal?'equal':'differences'),badge(v.schema.compatible?'ready':'differences'),badge(v.readyForCutover?'ready':'review')]))+'<h3>Full comparison record</h3><pre>'+h(j(value))+'</pre>');
  }
  if(name==='comparison.download')return download(output('comparison',key));
  if(name==='observations.download')return download(output('observations',key));
  if(name==='cutover.add'){
    const q=currentQuality(p);need(q.ready,'ACCEPTANCE_NOT_READY','Complete the current business acceptance and its review before selecting the consumer.');
    const comparison=p.comparisons.find(v=>v.id===q.report.comparisonId);
    need(comparison?.readyForCutover&&p.jobs.find(j=>j.id===comparison.jobId)?.stage==='verify','FRESH_VERIFICATION_REQUIRED','Select business acceptance measured against the current complete native verification.');
    return form('Switch reviewed consumer',select('comparisonId','Native verification',[[comparison.id,brief(comparison.jobId)]])+'<p>Business report '+h(brief(q.report.reportId))+(q.decision?' · reviewed decision '+h(brief(q.decision.decisionId)):' · all measured conditions pass')+'</p>'+area('reason','Reviewed switch reason'),v=>mutate('cutover.apply',{...v,acceptanceReportId:q.report.id,...(q.decision?{acceptanceDecisionId:q.decision.id}:{})},{label:'accepted consumer cutover'}));
  }
  if(name==='cutover.rollback')return form('Restore earlier consumer binding',area('reason','Rollback reason','Restore the exact earlier retained consumer binding, preserving both native datasets.'),v=>mutate('cutover.rollback',{cutoverId:key,...v},{label:'consumer rollback'}));
  if(name==='consumer.query')return showConsumer(key);
  if(name==='airbyte.review')return form('Review original Airbyte configuration',select('sourceId','Original complete configuration',p.sources.map(s=>[s.id,s.title]))+area('options','Connection selection options','{}',true),v=>mutate('airbyte.review',{sourceId:v.sourceId,options:obj(v.options,'Selection options')},{label:'original Airbyte semantic intake'}));
  if(name==='handoff.add')return form('Prepare complete editable handoff',input('title','Named package title','Complete migration receiving edition')+input('revision','Retained revision',p.revision,{type:'number'})+area('notes','Receiving notes','Complete project history, original source and native operation files with editable application.'),v=>mutate('handoff.prepare',{...v,revision:Number(v.revision)},{label:'complete project handoff'}));
  if(name==='handoff.receive')return form('Receive original complete project',input('file','Complete original NDJSON handoff (gzip v1 also accepted)','',{type:'file'}),v=>mutate('handoff.receive',{}, {file:v.file,label:'complete project receiving'}));
  if(name==='handoff.download')return download(output('handoff',key));
}
async function login(token){
  S.token=token;const info=await api('/api/info');S.session=info;sessionStorage.setItem('definian-token',token);
  $('#identity').textContent=info.actor.name+' · '+info.actor.roles.join(', ');$('#signout').hidden=false;$('#login').hidden=true;$('#application').hidden=false;
  await projects();await openProject(S.projects[0]?.id);notice('');
}
$('#login-form').addEventListener('submit',e=>{e.preventDefault();login($('#token').value.trim()).catch(e=>{$('#login').hidden=false;$('#application').hidden=true;alert(errorText(e));});});
$('#signout').addEventListener('click',()=>{clearTimeout(S.poll);sessionStorage.removeItem('definian-token');S.token='';S.session=null;S.view=null;S.scope=null;S.pending=null;S.storageReady=false;S.storageError=null;S.storageRead++;S.nav++;$('#application').hidden=true;$('#login').hidden=false;$('#signout').hidden=true;$('#token').value='';});
$('#project-select').addEventListener('change',e=>openProject(e.target.value).catch(report));
$('#create-project').addEventListener('click',async()=>{try{need(S.storageReady&&!S.busy&&!S.pending,'REQUEST_STORAGE_REQUIRED','Read and reconcile the original scope first.');await openProject(null);if(!S.storageReady)return;form('Create migration project',input('title','Project title','Migration acceptance programme')+area('notes','Operating scope','Retain the original source and a separate target through comparison, cutover and receiving.'),v=>mutate('project.create',v,{create:true,label:'new migration project'}));}catch(e){report(e);}});
$('#refresh').addEventListener('click',()=>S.view&&openProject(S.view.id,S.view.historical?S.view.revision:undefined).catch(report));
$('#current').addEventListener('click',()=>S.view&&openProject(S.view.id).catch(report));
$('#revision').addEventListener('change',e=>S.view&&openProject(S.view.id,e.target.value===''?undefined:Number(e.target.value)).catch(report));
$('#navigation').addEventListener('click',e=>{const b=e.target.closest('[data-pane]');if(b){S.pane=b.dataset.pane;render();}});
$('#form-close').addEventListener('click',()=>$('#form-dialog').close());$('#detail-close').addEventListener('click',()=>$('#detail-dialog').close());
$('#operation-form').addEventListener('submit',async e=>{e.preventDefault();try{need(S.storageReady&&S.form&&S.form.scope===S.scope,'FORM_SCOPE','The original form belongs to another project.');need(S.form.revision===S.view?.revision,'FORM_REVISION','The project advanced while this form was open. Keep this draft, review the current project and reopen the action.');const values=Object.fromEntries(new FormData(e.target));await S.form.callback(values);}catch(e){report(e);}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)action(b.dataset.action,b.dataset.id).catch(report);
  const d=e.target.closest('[data-downstream-file]');if(d&&S.view)download('/api/projects/'+S.view.id+'/downstream/'+d.dataset.operation+'?path='+encodeURIComponent(d.dataset.downstreamFile)+(S.view.historical?'&revision='+S.view.revision:'')).catch(report);
  const revision=e.target.closest('[data-revision]');if(revision&&S.view)openProject(S.view.id,Number(revision.dataset.revision)).catch(report);
  const n=e.target.closest('[data-native-job]');if(n&&S.view)download('/api/projects/'+S.view.id+'/native/'+n.dataset.nativeJob+'?path='+encodeURIComponent(n.dataset.nativePath)+(S.view.historical?'&revision='+S.view.revision:'')).catch(report);
});
if(S.token)login(S.token).catch(()=>{sessionStorage.removeItem('definian-token');S.token='';});

Object.defineProperty(window,'dltOperator',{value:Object.freeze({inspect:()=>({instanceId:S.session?.instanceId??null,actorId:S.session?.actor?.id??null,projectId:S.view?.id??null,revision:S.view?.revision??null,historical:S.view?.historical??false,scope:S.scope,storageReady:S.storageReady,storageError:S.storageError?{...S.storageError}:null,busy:S.busy,pending:S.pending?{requestId:S.pending.requestId,state:S.pending.state,scope:S.pending.scope,expectedRevision:S.pending.expectedRevision,label:S.pending.label}:null})}),writable:false,configurable:false});


/* Definian business acceptance uses the retained original native programme. */
const qaRows=p=>({plans:p.acceptancePlans||[],reports:p.acceptanceReports||[],decisions:p.acceptanceDecisions||[]});
function currentQuality(p){
  const rows=qaRows(p),plan=rows.plans.find(x=>x.id===p.currentAcceptancePlanId),report=rows.reports.find(x=>x.id===p.currentAcceptanceReportId),decision=rows.decisions.find(x=>x.id===p.currentAcceptanceDecisionId);
  const reportCurrent=!!plan&&!!report&&report.acceptancePlanId===plan.id&&report.planId===p.currentPlanId;
  const decisionCurrent=reportCurrent&&!!decision&&decision.reportId===report.id;
  return{plan,report,decision:decisionCurrent?decision:null,reportCurrent,ready:reportCurrent&&(decisionCurrent?decision.readyForCutover:report.readyForCutover)===true};
}
const qualityRef=(reportId,findingId,offset=0)=>JSON.stringify({reportId,findingId,offset});
function sourcePath(id){return'/api/projects/'+encodeURIComponent(S.view.id)+'/sources/'+encodeURIComponent(id)+(S.view.historical?'?revision='+S.view.revision:'');}
async function qualitySource(id){
  const selected=S.view.sources.find(x=>x.id===id);need(selected,'ACCEPTANCE_SOURCE','The selected complete acceptance source is missing.');
  need(selected.bytes<=32*1024*1024,'DETAIL_SIZE','Download this complete larger acceptance record.');
  const response=await api(sourcePath(id),{raw:true}),body=await response.arrayBuffer(),actual=await hashBlob(new Blob([body]));
  need(actual.sha256===selected.sha256&&actual.bytes===selected.bytes&&response.headers.get('x-content-sha256')===selected.sha256,'DOWNLOAD_IDENTITY','Acceptance source identity differs from this retained edition.');
  return JSON.parse(new TextDecoder().decode(body));
}
function qualitySummary(p){
  const q=currentQuality(p),counts=q.decision?.counts??q.report?.counts;
  return card('Business acceptance','<dl class="detail-grid"><dt>Selected rules</dt><dd>'+h(q.plan?.title||'Choose business rules')+'</dd><dt>Measured result</dt><dd>'+h(q.reportCurrent?(q.report.readyForCutover?'All measured conditions pass':q.report.findings.length+' measured findings'):'Evaluate the selected rules against a current comparison')+'</dd><dt>Reviewed result</dt><dd>'+h(q.decision?(q.decision.readyForCutover?'Ready after recorded review':q.decision.counts.remaining+' unresolved findings'):'No decision edition selected')+'</dd><dt>Business rule outcome</dt><dd>'+badge(q.ready?'ready':'review required')+'</dd><dt>Selected consumer review</dt><dd>'+h(p.consumer?.acceptance?.state||'unbound')+(p.consumer?.acceptance?.reportId?' · '+h(brief(p.consumer.acceptance.reportId)):'')+'</dd></dl>'+(counts?'<p class="muted">'+h(counts.required)+' required · '+h(counts.reviewable)+' reviewable · '+h(counts.accepted??0)+' accepted exceptions</p>':'')+'<p class="muted">Measured findings stay with their original data. Acknowledgement records review; only an explicitly reviewable exception can be accepted.</p>',button('Open acceptance','quality.open')+button('Author rules','quality.author','',true,!p.plans.length));
}
function renderQuality(p){
  const rows=qaRows(p),q=currentQuality(p);
  return qualitySummary(p)+card('Business rule editions',rows.plans.length?table(['Rules / native plan','Objects / relationships / controls','Selected',''],rows.plans.map(x=>['<strong>'+h(x.title)+'</strong><span class="muted">'+h(p.plans.find(t=>t.id===x.planId)?.title||x.planId)+'</span>',h(x.objects.length+' / '+x.relationships.length+' / '+x.controls.length),badge(x.id===p.currentAcceptancePlanId?'selected':'retained'),'<div class="actions">'+button('Inspect rules','quality.plan',x.id)+button('Download','quality.plan.download',x.id)+(x.id!==p.currentAcceptancePlanId?button('Select edition','quality.select',x.id,true):'')+'</div>'])):empty('Define migration acceptance','Select object keys, parent/child rules and grouped counts or exact sums.'),button('Author rules','quality.author','',true,!p.plans.length)+button('Compile retained rules','quality.compile','',true,!p.plans.length||!p.sources.some(x=>x.role==='acceptance_input')))
    +card('Measured report editions',rows.reports.length?table(['Report / measured','Native comparison','Findings',''],rows.reports.slice().reverse().map(x=>['<strong>'+h(time(x.createdAt))+'</strong><span class="muted mono">'+h(brief(x.reportId))+'</span>',h(brief(x.comparisonId))+'<span class="muted">'+h(brief(x.jobId))+'</span>',badge(x.readyForCutover?'ready':'review required')+'<span class="muted">'+h(x.counts.required)+' required · '+h(x.counts.reviewable)+' reviewable</span>','<div class="actions">'+button('Review findings','quality.report',x.id)+button('Control totals','quality.controls',x.id)+button('Relationships','quality.relationships',x.id)+button('Full report','quality.report.download',x.id)+'</div>'])):empty('Evaluate the complete original results','The selected rules use the retained native comparison and all source/target observations.'),button('Evaluate rules','quality.evaluate','',true,!q.plan||!p.comparisons.length))
    +card('Decision history',rows.decisions.length?table(['Recorded','Report edition','Review outcome',''],rows.decisions.slice().reverse().map(x=>[h(time(x.createdAt)),h(brief(x.reportId)),badge(x.readyForCutover?'ready':'review required')+'<span class="muted">'+h(x.counts.accepted)+' accepted · '+h(x.counts.acknowledged)+' acknowledged · '+h(x.counts.remaining)+' unresolved</span>','<div class="actions">'+button('Inspect decisions','quality.decision',x.id)+button('Full decisions','quality.decision.download',x.id)+'</div>'])):'<p class="muted">Review a measured finding to record a decision with its reason and operator identity.</p>');
}
function multi(name,label,names,chosen=[]){return'<label>'+h(label)+'<select multiple name="'+h(name)+'" size="'+Math.min(6,Math.max(2,names.length))+'">'+names.map(x=>'<option value="'+h(x)+'"'+(chosen.includes(x)?' selected':'')+'>'+h(x)+'</option>').join('')+'</select><span class="help">Select all applicable columns; use Control or Command for multiple selections.</span></label>';}
function optionalArea(name,label,value=''){return'<label>'+h(label)+'<textarea name="'+h(name)+'">'+h(value)+'</textarea></label>';}
function typedColumns(plan){return plan.acceptance.map(t=>({id:t.id,table:t.table,names:t.columns.map(c=>c.name),columns:t.columns,key:t.primaryKey}));}
function designerObjects(){return $$('#qa-objects [data-qa-object]').map(el=>({id:el.querySelector('[data-object-id]').value.trim(),streamId:el.dataset.streamId,element:el}));}
function chosen(el,name){return[...el.querySelector('[name="'+name+'"]').selectedOptions].map(x=>x.value);}
function addRuleRow(kind,objects){
  const parent=kind==='relationship'?$('#qa-relationships'):$('#qa-controls'),row=document.createElement('fieldset');
  row.className='qa-rule';row.dataset.qaRule=kind;
  const seq=Number(parent.dataset.sequence||0)+1;parent.dataset.sequence=String(seq);
  const rows=objects.map(x=>[x.id,x.table+' ('+x.id+')']);
  if(kind==='relationship'){
    row.innerHTML='<legend>Parent / child rule '+seq+'</legend>'+input('ruleId','Rule ID','relationship_'+seq)+'<div class="qa-two">'+select('parentObjectId','Parent object',rows)+select('childObjectId','Child object',rows,rows[1]?.[0]||rows[0]?.[0])+'</div><div class="qa-two" data-relation-columns></div><div class="qa-two">'+select('nulls','Child key nulls',[['forbid','Every child must have a complete key'],['allow-all-null','Allow an entirely null optional child key']])+select('acceptance','Acceptance policy',[['required','Required'],['reviewable','Reviewable exception']])+'</div><button type="button" class="secondary small" data-remove-rule>Remove rule</button>';
    const refresh=()=>{const selectedParent=objects.find(o=>o.id===row.querySelector('[name=parentObjectId]').value),selectedChild=objects.find(o=>o.id===row.querySelector('[name=childObjectId]').value);
      row.querySelector('[data-relation-columns]').innerHTML=multi('parentColumns','Parent columns, in join order',selectedParent.names,selectedParent.key)+multi('childColumns','Child columns, in matching order',selectedChild.names,selectedChild.key);
    };
    row.querySelectorAll('[name=parentObjectId],[name=childObjectId]').forEach(el=>el.addEventListener('change',refresh));refresh();
  }else{
    row.innerHTML='<legend>Control total '+seq+'</legend>'+input('ruleId','Control ID','control_'+seq)+select('objectId','Business object',rows)+'<div data-control-columns></div><div class="qa-two">'+select('measureKind','Measure',[['count','Count every retained row'],['sum','Exact numeric sum']])+input('scale','Optional exact decimal scale','',{type:'number',required:false,help:'0–38. A value requiring rounding fails the control.'})+'</div><div class="qa-two">'+select('nulls','Null measures',[['reject','Require a value'],['ignore','Omit null measures and retain their count']])+select('acceptance','Acceptance policy',[['required','Required'],['reviewable','Reviewable exception']])+'</div><button type="button" class="secondary small" data-remove-rule>Remove control</button>';
    const refresh=()=>{const obj=objects.find(o=>o.id===row.querySelector('[name=objectId]').value);
      row.querySelector('[data-control-columns]').innerHTML=multi('groupBy','Group by columns (empty means whole table)',obj.names)+select('measureColumn','Sum column', [['','Select a numeric column'],...obj.columns.filter(c=>['integer','decimal'].includes(c.cellType)).map(c=>[c.name,c.name])]);
      toggle();
    };
    const toggle=()=>{const sum=row.querySelector('[name=measureKind]').value==='sum',column=row.querySelector('[name=measureColumn]'),scale=row.querySelector('[name=scale]');column.disabled=!sum;column.required=sum;scale.disabled=!sum;};
    row.querySelector('[name=objectId]').addEventListener('change',refresh);row.querySelector('[name=measureKind]').addEventListener('change',toggle);refresh();
  }
  row.querySelector('[data-remove-rule]').addEventListener('click',()=>row.remove());parent.append(row);
}
function readDesigner(plan,objects){
  const inputs=designerObjects(),ids=new Map(inputs.map(o=>[o.streamId,o.id]));
  need(inputs.every(o=>o.id)&&new Set(inputs.map(o=>o.id)).size===inputs.length,'OBJECT_ID','Give every object a distinct nonblank ID.');
  const take=(el,name)=>el.querySelector('[name="'+name+'"]').value;
  const selectedObjects=inputs.map(o=>({id:o.id,streamId:o.streamId,key:chosen(o.element,'key'),required:chosen(o.element,'required')}));
  need(selectedObjects.every(o=>o.key.length),'OBJECT_KEY','Select a key for every object.');
  const rename=id=>{const original=objects.find(o=>o.id===id);need(original,'OBJECT_ID','Reopen the selected original object.');return ids.get(original.id);};
  const relationships=$$('#qa-relationships [data-qa-rule]').map(el=>({id:take(el,'ruleId').trim(),parentObjectId:rename(take(el,'parentObjectId')),childObjectId:rename(take(el,'childObjectId')),parentColumns:chosen(el,'parentColumns'),childColumns:chosen(el,'childColumns'),nulls:take(el,'nulls'),acceptance:take(el,'acceptance')}));
  for(const r of relationships)need(r.parentColumns.length&&r.parentColumns.length===r.childColumns.length,'RELATION_COLUMNS','Select equal nonzero parent/child column counts in the displayed join order.');
  const controls=$$('#qa-controls [data-qa-rule]').map(el=>{const measure={kind:take(el,'measureKind')};if(measure.kind==='sum'){measure.column=take(el,'measureColumn');const scale=take(el,'scale');if(scale!==''){measure.scale=Number(scale);need(Number.isInteger(measure.scale)&&measure.scale>=0&&measure.scale<=38,'CONTROL_SCALE','Use an exact scale from zero through38.');}}return{id:take(el,'ruleId').trim(),objectId:rename(take(el,'objectId')),groupBy:chosen(el,'groupBy'),measure,nulls:take(el,'nulls'),acceptance:take(el,'acceptance')};});
  return{schema:'definian.acceptance-input.v1',title:$('#operation-form [name=title]').value.trim(),pipelinePlan:plan,objects:selectedObjects,relationships,controls};
}
function ruleDesigner(plan,row){
  const objects=typedColumns(plan);
  form('Author business acceptance rules',input('title','Rule edition title',row.title+' — business acceptance')+'<p class="help">The selected native plan supplies the exact business types and source mappings. Object keys retain the native primary key. Empty text and null are different values.</p><div id="qa-objects">'+objects.map(o=>'<fieldset class="qa-rule" data-qa-object data-stream-id="'+h(o.id)+'"><legend>'+h(o.table)+'</legend>'+input('objectId','Business object ID',o.id).replace('name="objectId"','name="objectId" data-object-id')+'<div class="qa-two">'+multi('key','Object key',o.names,o.key)+multi('required','Required fields',o.names,[])+'</div></fieldset>').join('')+'</div><div class="qa-section-heading"><h3>Relationships</h3><button type="button" class="secondary" id="qa-add-relationship">Add relationship</button></div><p class="help">Selected columns are paired in their displayed column order. Use the complete JSON editor for a different composite join order.</p><div id="qa-relationships"></div><div class="qa-section-heading"><h3>Control totals</h3><button type="button" class="secondary" id="qa-add-control">Add control</button></div><div id="qa-controls"></div><p class="help">Save the complete rule source, then use Compile retained rules to review it as an immutable edition.</p>',async()=>{const document=readDesigner(plan,objects),file=new File([j(document)+'\n'],'acceptance-input.json',{type:'application/json'});return mutate('source.retain',{title:document.title,role:'acceptance_input',url:'',notes:'Complete operator-authored related-object acceptance rules for native plan '+row.id+'.'},{file,label:'business acceptance rule source'});});
  $('#qa-add-relationship').addEventListener('click',()=>addRuleRow('relationship',objects));
  $('#qa-add-control').addEventListener('click',()=>addRuleRow('control',objects));
  $('#form-submit').textContent='Save rule source';
}
function exactDisplay(total){
  if(!total)return'Unmeasurable';const coefficient=String(total.coefficient),exponent=String(total.exponent);
  if(!/^-?\d+$/.test(coefficient)||! /^-?\d+$/.test(exponent))return String(total.exact??'Unmeasurable');
  const exp=BigInt(exponent),negative=coefficient.startsWith('-'),digits=coefficient.replace(/^-/,'');
  if(exp>128n||exp< -128n||digits.length>128)return String(total.exact);
  const e=Number(exp);let value;
  if(e>=0)value=digits+'0'.repeat(e);else{const point=digits.length+e;value=point>0?digits.slice(0,point)+'.'+digits.slice(point):'0.'+'0'.repeat(-point)+digits;}
  return(negative?'-':'')+value;
}
function showFindings(row){
  const q=currentQuality(S.view),current=q.reportCurrent&&q.report?.id===row.id,decision=qaRows(S.view).decisions.filter(d=>d.reportId===row.id).at(-1),byId=new Map((decision?.decisions??[]).map(d=>[d.findingId,d]));
  detail('Measured findings', '<div class="qa-report" data-report-id="'+h(row.id)+'"><p>'+badge(row.readyForCutover?'ready':'review required')+' '+h(row.findings.length)+' measured findings · native comparison '+h(brief(row.comparisonId))+'</p><p class="help">'+h(current?'Review decisions apply to this exact selected report.':'This is a retained report edition. Select and evaluate the current rules before recording a new decision.')+'</p>'+(row.findings.length?table(['Finding','Policy / population','Current review',''],row.findings.map(f=>['<strong>'+h(f.code)+'</strong><span class="muted">'+h(f.message)+'</span><span class="mono">'+h(f.objectId||f.relationshipId||f.controlId||'Native programme')+' '+h(f.side||'')+'</span>',badge(f.acceptance)+'<span class="muted">'+h(f.count)+' measured · '+h(f.rows.length)+' retained row references</span>',h(byId.get(f.findingId)?.disposition||'Unreviewed'),'<div class="actions">'+button('Row evidence','quality.evidence',qualityRef(row.id,f.findingId))+button('Record decision','quality.review',qualityRef(row.id,f.findingId),true,!current)+'</div>'])):empty('All measured conditions pass','The complete selected native results satisfy these rules.'))+'<div class="actions">'+button('Full report','quality.report.download',row.id)+(decision?button('Selected decisions','quality.decision',decision.id):'')+'</div></div>');
  controls();
}
async function qualityAction(name,key){
  const p=S.view,rows=qaRows(p),q=currentQuality(p),plan=rows.plans.find(r=>r.id===key),reportRow=rows.reports.find(r=>r.id===key),decision=rows.decisions.find(r=>r.id===key);
  if(name==='quality.open'){S.pane='acceptance';render();return;}
  if(name==='quality.author'){form('Select the native plan for business rules',select('planId','Native pipeline plan',p.plans.map(r=>[r.id,r.title]),p.currentPlanId),async v=>{const row=p.plans.find(x=>x.id===v.planId),native=await readOutput('plan',row.id);need(S.view.id===p.id&&S.view.revision===p.revision,'VIEW_CHANGED','Reopen rules on the current project edition.');ruleDesigner(native,row);});$('#form-submit').textContent='Continue';return;}
  if(name==='quality.json')return form('Author complete acceptance JSON',input('title','Rule source title','Business acceptance rules')+area('configuration','Complete acceptance input',key||'{"schema":"definian.acceptance-input.v1","objects":[],"relationships":[],"controls":[]}',true,'Compile binds the selected original native plan. Use explicit canonical business columns and matching types.'),v=>{const doc=obj(v.configuration,'Acceptance source'),file=new File([j(doc)+'\n'],'acceptance-input.json',{type:'application/json'});return mutate('source.retain',{title:v.title,role:'acceptance_input',url:'',notes:'Complete operator-authored acceptance input.'},{file,label:'business acceptance source'});});
  if(name==='quality.compile')return form('Compile retained business rules',input('title','Rule edition title','Business acceptance')+select('sourceId','Complete retained rule input',p.sources.filter(x=>x.role==='acceptance_input').map(x=>[x.id,x.title]))+select('planId','Exact native pipeline plan',p.plans.map(x=>[x.id,x.title]),p.currentPlanId),v=>mutate('acceptance.compile',v,{label:'compiled business acceptance'}));
  if(name==='quality.select')return form('Select retained business rules','<p>'+h(plan.title)+'</p>'+area('reason','Reason for selecting this edition'),v=>mutate('acceptance.select',{acceptancePlanId:key,...v},{label:'business rule selection'}));
  if(name==='quality.plan'){
    const body=await qualitySource(plan.compiledSourceId);
    return detail(plan.title,table(['Business object','Native stream','Key','Required fields'],body.objects.map(x=>[h(x.id),h(x.streamId),h(x.key.join(', ')),h(x.required.join(', ')||'—')]))+'<h3>Relationships</h3>'+table(['Rule','Parent → child','Columns','Policy'],body.relationships.map(x=>[h(x.id),h(x.parentObjectId+' → '+x.childObjectId),h(x.parentColumns.join(', ')+' → '+x.childColumns.join(', ')),h(x.nulls+' · '+x.acceptance)]))+'<h3>Controls</h3>'+table(['Rule','Object / grouping','Measure','Policy'],body.controls.map(x=>[h(x.id),h(x.objectId+' / '+(x.groupBy.join(', ')||'whole table')),h(x.measure.kind+(x.measure.column?' '+x.measure.column:'')+(x.measure.scale!==undefined?' · scale '+x.measure.scale:'')),h(x.nulls+' · '+x.acceptance)]))+'<div class="actions">'+button('Edit complete JSON as new source','quality.json',j(body.input),true)+'</div><details><summary>Complete rule edition</summary><pre>'+h(j(body))+'</pre></details>');
  }
  if(name==='quality.evaluate')return form('Evaluate complete native results',select('acceptancePlanId','Selected business rules',q.plan?[[q.plan.id,q.plan.title]]:[])+select('comparisonId','Complete comparison for the selected native plan',p.comparisons.filter(x=>x.planId===q.plan?.planId).map(x=>[x.id,brief(x.jobId)+' · '+(x.readyForCutover?'native ready':'native findings')])),v=>mutate('acceptance.evaluate',v,{label:'complete business acceptance report'}));
  if(name==='quality.report')return showFindings(reportRow);
  if(name==='quality.evidence'){
    const ref=obj(key,'Finding selection'),row=rows.reports.find(r=>r.id===ref.reportId),finding=row?.findings.find(f=>f.findingId===ref.findingId);need(finding,'FINDING_MISSING','Select a retained measured finding.');
    const offset=Math.max(0,Math.floor(Number(ref.offset)||0)),page=finding.rows.slice(offset,offset+50);
    return detail(finding.code,'<p>'+h(finding.message)+'</p><p>'+h(finding.rows.length)+' complete row references · showing '+(page.length?offset+1:0)+'–'+(offset+page.length)+'</p>'+table(['Side / object','Original row','Source identity','Complete retained detail'],page.map(r=>[h((r.side||'')+' '+(r.objectId||'')),h(r.rowIndex),'<span class="mono">'+h(r.sourceSha256||'')+'</span>','<pre>'+h(j(r))+'</pre>']))+'<div class="actions">'+button('Previous rows','quality.evidence',qualityRef(row.id,finding.findingId,Math.max(0,offset-50)),false,offset===0)+button('Next rows','quality.evidence',qualityRef(row.id,finding.findingId,offset+50),false,offset+50>=finding.rows.length)+button('Back to findings','quality.report',row.id)+button('Download all evidence','quality.report.download',row.id)+'</div>');
  }
  if(name==='quality.review'){
    const ref=obj(key,'Finding selection'),row=rows.reports.find(r=>r.id===ref.reportId),finding=row?.findings.find(f=>f.findingId===ref.findingId);
    need(finding&&q.reportCurrent&&q.report.id===row.id,'CURRENT_REPORT_REQUIRED','Open the exact current measured report before deciding.');
    const prior=rows.decisions.filter(d=>d.reportId===row.id).at(-1)?.decisions.find(d=>d.findingId===finding.findingId);
    $('#detail-dialog').close();
    return form('Review measured finding','<p><strong>'+h(finding.code)+'</strong> · '+h(finding.message)+'</p><p class="help">Required conditions remain unresolved after acknowledgement. An accepted exception applies only to an explicitly reviewable finding in this report.</p>'+select('disposition','Disposition',[['acknowledged','Acknowledge — keep unresolved'],...(finding.acceptance==='reviewable'?[['accepted_exception','Accept this reviewable exception']]:[])],prior?.disposition)+area('reason','Reason and operating consequence',prior?.reason||''),v=>mutate('acceptance.decide',{reportId:row.id,decisions:[{findingId:finding.findingId,disposition:v.disposition,reason:v.reason}]},{label:'business acceptance decision'}));
  }
  if(name==='quality.controls'){
    const body=await qualitySource(reportRow.sourceId);
    return detail('Exact grouped control totals',body.controls.map(c=>'<section><h3>'+h(c.controlId)+' · '+h(c.objectId)+'</h3><p>'+h(c.measure.kind+(c.measure.column?' '+c.measure.column:'')+' by '+(c.groupBy.join(', ')||'whole table'))+'</p>'+table(['Group','Original / expected','Destination','Result'],c.groups.map(g=>['<pre>'+h(j(g.group))+'</pre>',g.left?h(exactDisplay(g.left.total))+'<span class="muted">'+h(g.left.rowCount)+' rows · '+h(g.left.nullRows)+' null · '+h(g.left.ignoredNullRows)+' ignored null</span>':'Absent group',g.right?h(exactDisplay(g.right.total))+'<span class="muted">'+h(g.right.rowCount)+' rows · '+h(g.right.nullRows)+' null · '+h(g.right.ignoredNullRows)+' ignored null</span>':'Absent group',badge(g.equal?'equal':'review required')]))+'</section>').join('')||empty('No control totals selected','Add explicit row counts or exact sums to the rule input.'));
  }
  if(name==='quality.relationships'){
    const body=await qualitySource(reportRow.sourceId);
    return detail('Parent / child integrity',body.relationships.length?table(['Rule / side','Parent / child rows','Matched / optional null','Unresolved rows'],body.relationships.map(r=>[h(r.relationshipId+' / '+r.side),h(r.parentRows+' / '+r.childRows),h(r.matchedRows+' / '+r.allowedNullRows),h(r.orphanRows+' orphan · '+r.ambiguousRows+' ambiguous · '+r.disallowedNullRows+' null · '+r.invalidRows+' invalid')])):empty('No relationships selected','Author an explicit parent/child rule for the next edition.'));
  }
  if(name==='quality.decision')return detail('Recorded business decisions',await qualitySource(decision.sourceId));
  if(name==='quality.plan.download')return download(sourcePath(plan.compiledSourceId));
  if(name==='quality.report.download')return download(sourcePath(reportRow.sourceId));
  if(name==='quality.decision.download')return download(sourcePath(decision.sourceId));
  throw new Error('Unknown business acceptance action.');
}

Object.defineProperty(window,'definianOperator',{value:window.dltOperator,writable:false,configurable:false});


async function showConsumer(key){
  const p=S.view;need(p&&!p.historical,'CURRENT_CONSUMER','Open the current project to browse its selected consumer.');
  const selection=p.cutovers.find(x=>x.id===p.currentCutoverId)?.selection;
  need(selection,'CONSUMER_UNBOUND','Select a reviewed consumer before opening its retained tables.');
  const query=key?obj(key,'Consumer page'):{},offset=Math.max(0,Math.floor(Number(query.offset)||0));
  const params=new URLSearchParams({offset:String(offset),limit:'100'});
  if(query.streamId)params.set('streamId',query.streamId);
  const value=await api('/api/projects/'+encodeURIComponent(p.id)+'/consumer?'+params);
  need(S.view?.id===p.id&&S.view.revision===p.revision&&value.selection.snapshot.sha256===selection.snapshot.sha256,
    'CONSUMER_CHANGED','The selected consumer advanced. Refresh and reopen its retained tables.');
  const page=(streamId,next)=>JSON.stringify({streamId,offset:next});
  const shown=v=>v.type==='null'?'NULL':typeof v.value==='object'?j(v.value):String(v.value);
  return detail('Retained consumer tables','<section data-consumer-stream="'+h(value.streamId)+'" data-consumer-offset="'+h(value.offset)+'" data-consumer-total="'+h(value.rowCount)+'"><p>'+h(value.binding.pipelineName)+' · '+h(value.binding.datasetName)+' · '+h(value.binding.side)+'</p><div class="actions">'+value.binding.tables.map(t=>button(t.relation.join('.'),'consumer.query',page(t.streamId,0),false,t.streamId===value.streamId)).join('')+'</div><p>'+h(value.streamId)+' · '+h(value.rowCount)+' total rows · '+(value.rows.length?value.offset+1:0)+'–'+(value.offset+value.rows.length)+'</p>'+table(value.columns.map(c=>c.name),value.rows.map(row=>row.map(v=>h(shown(v)))))+'<div class="actions">'+button('Previous rows','consumer.query',page(value.streamId,Math.max(0,value.offset-value.limit)),false,value.offset===0)+button('Next rows','consumer.query',page(value.streamId,value.offset+value.limit),false,value.offset+value.rows.length>=value.rowCount)+button('Download complete typed data','observations.download',value.binding.comparisonId)+'</div><h3>Selected source and consumer</h3><pre>'+h(j({selection:value.selection,binding:value.binding,source:value.source}))+'</pre></section>');
}
