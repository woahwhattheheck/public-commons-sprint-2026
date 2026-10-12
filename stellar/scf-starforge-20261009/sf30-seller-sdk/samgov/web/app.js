const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const plain = value => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const label = value => String(value || '').replace(/_/g,' ');
const safeUrl = value => {try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const link = (url,caption) => safeUrl(url)?'<a href="'+esc(safeUrl(url))+'" target="_blank" rel="noreferrer">'+esc(caption||url)+'</a>':esc(caption||url||'—');
const date = value => value ? String(value).replace('T',' ').replace('.000Z',' UTC') : '—';
const bytes = value => Number(value)>=1048576?(Number(value)/1048576).toFixed(1)+' MiB':Number(value)>=1024?(Number(value)/1024).toFixed(1)+' KiB':String(value||0)+' B';
const badge = (value,strong=false) => '<span class="badge'+(strong?' strong':'')+'">'+esc(label(value||'unreviewed'))+'</span>';
const option = (value,title,current) => '<option value="'+esc(value)+'"'+(String(value)===String(current)?' selected':'')+'>'+esc(title)+'</option>';
const button = (action,title,id='',extra='',primary=false) => '<button type="button" data-action="'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+(extra?' '+extra:'')+' class="'+(primary?'primary':'small')+'">'+esc(title)+'</button>';
const boxHeading = (title,description,actions='') => '<div class="section-heading"><div><h3>'+esc(title)+'</h3>'+(description?'<p>'+esc(description)+'</p>':'')+'</div><div class="actions">'+actions+'</div></div>';
const panelHeading = (title,description,actions='') => '<div class="panel-heading"><div><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p></div><div class="actions">'+actions+'</div></div>';
const empty = (title,description,actions='') => '<div class="empty"><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p><div class="actions">'+actions+'</div></div>';
const table = (headers,rows) => '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const kv = items => '<dl class="key-values">'+items.filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(plain(v))+'</dd>').join('')+'</dl>';
const FORMATS = [['portable','Portable JSON'],['html','HTML review'],['markdown','Markdown'],['notices','Notice CSV'],['reviews','Review CSV'],['changes','Change CSV'],['sources','Source CSV']];
const SESSION_KEY = 'starforge-sam-session';
const PENDING_KEY = 'starforge-sam-pending';
let token = '';
try {
 const fragment = new URLSearchParams(location.hash.slice(1));
 token=fragment.get('token')||sessionStorage.getItem(SESSION_KEY)||'';
 if(fragment.has('token')) {sessionStorage.setItem(SESSION_KEY,token);history.replaceState(null,'',location.pathname+location.search);}
} catch {}
const state = {workspace:null,operator:'',tab:'searches',editionId:'',record:null,offset:0,limit:50,search:'',
 selected:new Set(),detail:null,beforeEditionId:'',afterEditionId:'',comparison:null,tasks:[],loading:false,
 opportunityConfigured:false,merchantHosts:[],pending:null,editor:null,source:null,poll:null,renderGeneration:0};
try{const v=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null');if(v?.action&&v?.payload?.requestId)state.pending=v;}catch{}
function show(message,error=false) {const el=$('#notice');el.textContent=message;el.className='notice'+(error?' error':'');el.hidden=!message;}
function setPending(value) {
 state.pending=value;try{if(value)sessionStorage.setItem(PENDING_KEY,JSON.stringify(value));else sessionStorage.removeItem(PENDING_KEY);}catch{}
 renderPending();
}
function renderPending() {
 const el=$('#pending-operation');
 if(!state.pending){el.hidden=true;el.innerHTML='';return;}
 el.hidden=false;el.innerHTML='<div><strong>Saved action awaiting confirmation</strong><br><span class="mono">'+esc(state.pending.action)+' · '+esc(state.pending.payload.requestId)+'</span></div><div class="actions">'+button('retry-pending','Retry saved action')+button('refresh','Check current state')+'</div>';
}
async function api(path,{method='GET',body}={}) {
 const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 let result;try{result=await response.json();}catch{throw Object.assign(new Error('The workspace returned an unreadable response. Refresh to read the retained operation state.'),{uncertain:method!=='GET'});}
 if(!response.ok){const error=result.error||result;throw Object.assign(new Error(error.message||result.message||'HTTP '+response.status),{code:error.code||result.code||'HTTP_'+response.status,status:response.status,uncertain:response.status>=500});}
 return result;
}
async function read(action,payload={}) {return api('/api/read',{method:'POST',body:{action,payload}});}
function mutationRecorded(pending,workspace=state.workspace) {
 return Boolean(pending&&(workspace?.history||[]).some(row=>row.requestId===pending.payload.requestId||row.change?.requestId===pending.payload.requestId));
}
async function refresh({paint=true}={}) {
 const result=await api('/api/workspace');state.workspace=result.workspace;state.operator=result.operator;
 state.tasks=result.tasks||[];state.opportunityConfigured=result.opportunityConfigured;state.merchantHosts=result.merchantHosts||[];
 if(state.pending&&mutationRecorded(state.pending))setPending(null);
 $('#connection-state').textContent='Connected';
 $('#workspace-id').textContent=state.workspace.id;
 $('#workspace-revision').textContent='Revision '+state.workspace.revision;
 $('#credential-state').textContent=state.workspace.capabilities?.keyConfigured?'SAM source connection ready':'Retained-source mode';
 $('#footer-state').textContent=state.operator+' · '+(state.workspace.capabilities?.readOnly?'Read access':'Operator access');
 renderMetrics();renderPending();schedulePoll();
 if(paint)await render();
 return state.workspace;
}
function renderMetrics() {
 const w=state.workspace||{}, editions=w.editions||[];
 const counts=[['Saved searches',(w.queries||[]).length,''],['Retained editions',editions.length,''],
 ['Notice observations',editions.reduce((n,e)=>n+(e.rowCount||0),0),''],['Selections',(w.selections||[]).length,''],['Named handoffs',(w.handoffs||[]).length,'']];
 $('#metrics').innerHTML=counts.map(([title,value,suffix])=>'<div class="metric"><span>'+esc(title)+'</span><strong>'+value.toLocaleString()+'</strong>'+(suffix?'<small>'+esc(suffix)+'</small>':'')+'</div>').join('');
}
function schedulePoll() {
 if(state.poll)clearTimeout(state.poll);
 const running=state.tasks.some(task=>task.state==='running')||(state.workspace?.captures||[]).some(c=>c.status==='running');
 if(!running)return;
 state.poll=setTimeout(async()=>{try{await refresh({paint:!$('#editor').open&&state.tab==='searches'});}catch(error){show(error.message,true);}finally{schedulePoll();}},2000);
}
async function executeMutation(action,payload,{prepared}={}) {
 if(state.pending&&!mutationRecorded(state.pending)&&state.pending.payload.requestId!==prepared?.payload?.requestId)
   throw Object.assign(new Error('Confirm the saved action using its retry control before preparing another change.'),{code:'SAVED_ACTION_PENDING'});
 const request=prepared||{action,payload:{...payload,expectedRevision:state.workspace.revision,requestId:'sam-ui-'+crypto.randomUUID()}};
 setPending(request);
 try {
   const result=await api('/api/dispatch',{method:'POST',body:request});
   if(result.workspace)state.workspace=result.workspace;
   setPending(null);
   await refresh({paint:false});
   return result;
 }catch(error){
   if(error.status&&error.status<500){setPending(null);}
   else{try{await refresh({paint:false});if(mutationRecorded(request)){setPending(null);return{workspace:state.workspace,result:{reconciled:true}};}}catch{}}
   throw error;
 }
}
function captureProgress() {
 return state.tasks.filter(task=>task.state==='running'||task.state==='failed').map(task=>{
   const capture=state.workspace.captures.find(c=>c.id===task.captureId),p=task.progress||{};
   const count=p.count??capture?.count??0,total=p.totalRecords??capture?.totalRecords;
   return '<div class="capture-progress"><div class="progress-heading"><strong>'+esc(capture?.name||task.captureId)+'</strong>'+badge(task.state)+'</div>'+
    '<p>'+Number(count).toLocaleString()+' records retained'+(total!==null&&total!==undefined?' of '+Number(total).toLocaleString():'')+' · '+(capture?.pageCount||p.pageCount||0)+' complete pages</p>'+
    (total?'<progress max="'+esc(total)+'" value="'+esc(count)+'" aria-label="Capture progress"></progress>':'')+
    (task.error?'<p>'+esc(task.error.message)+'</p>':'')+
    '<div class="actions">'+(task.state==='running'?button('cancel-capture','Pause capture',task.captureId):button('run-capture','Resume capture',task.captureId))+button('capture-detail','View original progress',task.captureId)+'</div></div>';
 }).join('');
}
function searchesView() {
 const w=state.workspace;
 const queryRows=(w.queries||[]).map(q=>'<tr><td class="title"><strong>'+esc(q.name)+'</strong><small>'+esc(q.id)+' · revision '+q.revision+'</small></td><td>'+esc(q.definition.filters.postedFrom)+'<br>'+esc(q.definition.filters.postedTo)+'</td><td>'+esc(q.definition.filters.noticeid||q.definition.filters.solnum||q.definition.filters.title||q.definition.filters.organizationName||'All matching notices')+'</td><td>'+q.definition.pageSize+' per page<br><span class="muted">'+Number(q.definition.maxRecords).toLocaleString()+' capacity</span></td><td><div class="actions">'+button('start-capture','Capture search',q.id,'',true)+button('edit-query','Edit',q.id)+'</div></td></tr>');
 const captureRows=[...(w.captures||[])].reverse().map(c=>'<tr><td class="title"><strong>'+esc(c.name)+'</strong><small>'+esc(c.id)+'</small></td><td>'+badge(c.status,c.status==='complete')+(c.error?'<small class="muted">'+esc(c.error.message||c.error)+'</small>':'')+'</td><td>'+Number(c.count||0).toLocaleString()+(c.totalRecords!==null&&c.totalRecords!==undefined?' / '+Number(c.totalRecords).toLocaleString():'')+'<br><span class="muted">'+(c.pageCount||0)+' pages · next page '+(c.nextOffset||0)+'</span></td><td class="nowrap">'+esc(date(c.updatedAt||c.startedAt))+'</td><td><div class="actions">'+button('capture-detail','Progress',c.id)+(c.editionId?button('open-edition','Open notices',c.editionId):'')+(['queued','paused','failed'].includes(c.status)?button('run-capture','Continue',c.id):'')+(c.status==='capacity'?button('resize-capture','Increase capacity',c.id):'')+(c.status==='running'?button('cancel-capture','Pause',c.id):'')+'</div></td></tr>');
 return panelHeading('Searches & captures','Every saved search records its date window, filters and page size. A complete capture retains every returned page and the terminal record total.',button('new-query','New search','','',true)+button('import-notice','Receive saved notice')+button('import-capture','Receive captured pages'))+
  captureProgress()+
  '<section class="box">'+boxHeading('Saved searches','Run a saved query again to retain a later observation.')+(queryRows.length?table(['Search','Posted window','Focus','Acquisition','Actions'],queryRows):empty('Create a source search','Choose the published date window and the notice, solicitation or subject you need.',button('new-query','Create search','','',true)))+'</section>'+
  '<section>'+boxHeading('Capture history','Interrupted work resumes its original query and next page. Capacity is explicit and can be increased on the same capture.')+(captureRows.length?table(['Capture','Status','Records & pages','Updated','Actions'],captureRows):empty('No captures yet','Save a query and run it, or receive complete original pages from an equipped operator.'))+'</section>';
}
function editionOptions(current,includeBlank=false) {
 return (includeBlank?option('','Choose retained edition',current):'')+[...(state.workspace.editions||[])].reverse().map(e=>option(e.id,e.name+' · '+e.rowCount+' notices · '+date(e.createdAt),current)).join('');
}
function reviewFor(editionId,noticeId) {return(state.workspace.reviews||[]).findLast(r=>r.editionId===editionId&&r.noticeId===noticeId);}
async function loadRecord(id,{offset=state.offset,limit=state.limit,search=state.search}={}) {
 return api('/api/records/'+encodeURIComponent(id)+'?'+new URLSearchParams({offset,limit,search}));
}
async function allNotices(editionId) {
 const rows=[];let offset=0,total;
 do{const page=await loadRecord(editionId,{offset,limit:1000,search:''});total=page.total;rows.push(...page.items);offset+=page.items.length;if(!page.items.length&&offset<total)throw new Error('The retained edition returned an incomplete page. Refresh the edition.');}while(offset<total);
 return rows;
}
async function noticesView() {
 const editions=state.workspace.editions||[];
 if(!editions.length)return panelHeading('Notice library','Review the complete retained notice, issued deadlines and original source files.')+empty('Capture an edition first','The notice library opens when a source capture or portable receiving has retained an edition.',button('switch-searches','Open searches','','',true));
 if(!editions.some(e=>e.id===state.editionId)){state.editionId=editions.at(-1).id;state.offset=0;state.detail=null;state.selected.clear();}
 const record=await loadRecord(state.editionId);state.record=record;
 const e=record.record;
 const rows=record.items.map(n=>{
  const r=reviewFor(state.editionId,n.noticeId);
  return '<tr><td><input type="checkbox" data-select-notice="'+esc(n.noticeId)+'" aria-label="Select '+esc(n.title)+'"'+(state.selected.has(n.noticeId)?' checked':'')+'></td><td class="title"><button type="button" class="link" data-action="notice-detail" data-id="'+esc(n.noticeId)+'">'+esc(n.title)+'</button><small>'+esc(n.solicitationNumber||n.noticeId)+'</small><small>'+esc(n.fullParentPathName)+'</small></td><td>'+esc(n.type||'—')+'<br><span class="muted">'+esc(n.active||'—')+'</span></td><td class="nowrap">'+esc(n.responseDeadLine||'Not supplied')+(r?.deadline?'<br><small class="muted">'+esc(r.deadline.at)+'<br>'+esc(r.deadline.timeZone)+'</small>':'')+'</td><td>'+badge(r?.status)+(r?.owner?'<br><small class="muted">'+esc(r.owner)+'</small>':'')+'</td><td><div class="actions">'+button('notice-detail','Open',n.noticeId)+button('review-notice','Review',n.noticeId)+'</div></td></tr>';
 });
 const chosen=state.selected.size;
 const controls='<div class="filters"><label class="grow">Retained edition<select id="edition-select">'+editionOptions(state.editionId)+'</select></label><label class="grow">Search retained records<input id="notice-search" value="'+esc(state.search)+'" placeholder="Title, solicitation, organization or notice ID"></label><div class="actions">'+button('search-notices','Apply filter')+button('clear-notice-search','Clear')+'</div></div>';
 const selectedBar='<div class="section-heading"><div><h3>'+esc(e.name)+'</h3><p>'+Number(record.total).toLocaleString()+' matching notices · '+badge(e.complete?'complete search':'partial search')+' · '+chosen+' selected</p></div><div class="actions">'+button('select-page','Select this page')+button('clear-selection','Clear selection')+button('select-all','Select complete edition')+button('save-selection','Save selection','',''+(!chosen?'disabled':''),true)+'</div></div>';
 const pagination='<div class="pagination"><span>Records '+(record.total?state.offset+1:0)+'–'+Math.min(state.offset+record.items.length,record.total)+' of '+record.total+'</span><div class="actions">'+button('previous-page','Previous','',''+(state.offset===0?'disabled':''))+button('next-page','Next','',''+(state.offset+state.limit>=record.total?'disabled':''))+'</div></div>';
 return panelHeading('Notice library','Issued deadlines remain exact source strings. Review owners can attach an explicit date, offset and time zone for operating decisions.')+controls+selectedBar+(rows.length?table(['','Notice','Type / active','Response deadline','Review','Actions'],rows):empty('No matching notices','Adjust the retained-record filter.'))+pagination+(state.detail?await noticeDetail(state.detail):'');
}
async function noticeDetail(noticeId) {
 const data=await read('notice',{editionId:state.editionId,noticeId});
 const n=data.notice||data.record||data,r=data.review||reviewFor(state.editionId,noticeId);
 const resources=n.resources||[],sourceIds=new Set(resources.map(s=>s.sourceId));
 const companions=(n.source?.companions||[]).map(item=>{const source=(state.workspace.sources||[]).find(s=>s.id===item.sourceId);return{...item,filename:source?.filename||label(item.kind),bytes:source?.bytes??null};});
 const sources=[...(n.source?.sourceId?[{sourceId:n.source.sourceId,filename:'Original notice response',kind:'notice',sha256:n.source.sha256,bytes:null}]:[]),...companions,...resources];
 const resourceList=sources.map(s=>'<div class="source-row"><div><strong>'+esc(s.filename||s.sourceId)+'</strong><small>'+esc(label(s.kind))+(s.bytes!==null?' · '+bytes(s.bytes):'')+' · '+esc(s.sha256||'')+'</small><small>'+esc(s.url||'')+'</small></div><div class="actions">'+button('view-source','Read source',s.sourceId)+button('download-source','Download',s.sourceId)+'</div></div>').join('');
 const retainedUrls=new Set(resources.map(s=>s.url));
 const remaining=[...(n.descriptionUrl?[{kind:'description',url:n.descriptionUrl}]:[]),...(n.resourceLinks||[]).map(url=>({kind:'attachment',url}))].filter(s=>!retainedUrls.has(s.url));
 const descriptions=(n.descriptions||[]).map(item=>{
  const document=new DOMParser().parseFromString(item.body.replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi,'\n'),'text/html');
  document.querySelectorAll('script,style').forEach(node=>node.remove());
  return '<article><div class="prose">'+esc(document.body.textContent.trim())+'</div><p class="small-text mono">'+esc(item.sourceId+' '+item.rowPointer)+'</p></article>';
 }).join('');
 const historyRows=(n.noticeHistory||[]).map(item=>'<tr><td>'+esc(item.index)+'</td><td>'+esc(item.postedDate)+'</td><td>'+esc(item.actionType)+'</td><td>'+esc(item.latest)+'</td><td>'+link('https://sam.gov/workspace/contract/opp/'+item.opportunityId+'/view',item.opportunityId)+'</td></tr>');
 const attachmentRows=(n.attachmentIndex||[]).map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+bytes(item.size)+'</td><td>'+esc([item.accessLevel,item.accessStatus].filter(Boolean).join(' / '))+'</td><td>'+esc(item.deletedFlag??'')+'</td></tr>');
 const documentDetails=(descriptions?'<section class="box">'+boxHeading('Issued description','Complete description text from the retained notice response.')+descriptions+'</section>':'')+
  (historyRows.length?'<section class="box">'+boxHeading('Published notice history','Original entries and version identities supplied by SAM.')+table(['Version','Posted as issued','Action','Latest as issued','Notice'],historyRows)+'</section>':'')+
  (attachmentRows.length?'<section class="box">'+boxHeading('Issued attachment index','Original filenames, sizes and access metadata.')+table(['File','Issued size','Access as issued','Deleted as issued'],attachmentRows)+'</section>':'');
 const contacts=(n.pointOfContact||[]).map(p=>'<li>'+esc([p.fullName||p.fullname,p.title,p.email,p.phone].filter(Boolean).join(' · '))+'</li>').join('');
 return '<section class="notice-detail"><div class="detail-heading"><div><p class="eyebrow">'+esc(n.solicitationNumber||n.noticeId)+'</p><h2>'+esc(n.title)+'</h2><p>'+esc(n.noticeId)+' · '+link(n.uiUrl,'Open issued notice')+'</p></div><div class="actions">'+button('review-notice','Review notice',n.noticeId,'',true)+button('capture-resources','Capture issued files',n.noticeId)+button('retain-resource','Receive source file',n.noticeId)+button('close-notice','Close')+'</div></div>'+
 '<div class="split"><section class="box">'+boxHeading('Issued notice','Provider fields retained from this selected edition.')+kv([['Organization',n.fullParentPathName],['Organization ID',n.organizationId],['Issued time zone',n.issuedTimeZone],['Source format',label(n.source?.format||'API search page')],['Type / original type',[n.type,n.baseType].filter(Boolean).join(' / ')],['Active',n.active],['Posted',n.postedDate],['Response deadline',n.responseDeadLine||'Not supplied'],['Archive date',n.archiveDate],['NAICS',n.naicsCode],['Classification',n.classificationCode],['Set-aside',[n.setAsideCode,n.setAsideDescription].filter(Boolean).join(' · ')],['Award amount',n.awardAmount],['Awardee',n.awardeeName],['Place of performance',n.placeOfPerformance]])+(contacts?'<hr class="section-rule"><h3>Published contacts</h3><ul class="small-text">'+contacts+'</ul>':'')+'</section>'+
 '<section class="box">'+boxHeading('Operator review','The review and operating deadline stay attached to this notice edition.')+kv([['Status',label(r?.status||'unreviewed')],['Owner',r?.owner||'Unassigned'],['Reviewed deadline',r?.deadline?.at],['Time zone',r?.deadline?.timeZone],['Deadline basis',r?.deadline?.reason]])+(r?.notes?'<hr class="section-rule"><div class="prose">'+esc(r.notes)+'</div>':'')+'<hr class="section-rule">'+kv([['Record SHA256',n.recordSha256],['Source record',n.source?.sourceId],['Original row',n.source?.rowPointer],['Page index',n.source?.pageOffset]])+'</section></div>'+
 documentDetails+'<section class="box">'+boxHeading('Original source files','Open or download the retained bytes of this notice, description and its attachments.')+'<div class="source-list">'+resourceList+'</div>'+(remaining.length?'<hr class="section-rule"><h3>Issued links awaiting retained files</h3><div class="source-list">'+remaining.map(s=>'<div class="source-row"><div><strong>'+esc(label(s.kind))+'</strong><small>'+link(s.url,s.url)+'</small></div><div class="actions">'+button('retain-resource','Receive file',n.noticeId,'data-kind="'+esc(s.kind)+'" data-url="'+esc(s.url)+'"')+'</div></div>').join('')+'</div>':'')+'</section></section>';
}
async function changesView() {
 const editions=state.workspace.editions||[];
 if(editions.length<2)return panelHeading('Change review','Compare retained editions and assign follow-up for issued field, source and resource changes.')+empty('A second edition enables comparison','Capture the saved query again, or retain its description and attachments to create the next source edition.');
 if(!editions.some(e=>e.id===state.beforeEditionId))state.beforeEditionId=editions.at(-2).id;
 if(!editions.some(e=>e.id===state.afterEditionId))state.afterEditionId=editions.at(-1).id;
 const filters='<div class="filters"><label class="grow">Earlier edition<select id="before-edition">'+editionOptions(state.beforeEditionId)+'</select></label><label class="grow">Later edition<select id="after-edition">'+editionOptions(state.afterEditionId)+'</select></label><div class="actions">'+button('compare','Compare editions','','',true)+'</div></div>';
 const saved=(state.workspace.changes||[]).filter(c=>c.beforeEditionId===state.beforeEditionId&&c.afterEditionId===state.afterEditionId);
 const comparison=state.comparison;
 let body=empty('Compare the selected editions','The result separates added, changed and no-longer-returned notices and their retained source details.');
 if(comparison){
  const result=comparison.result||comparison;
  const changes=Array.isArray(result.items)?result.items.filter(item=>item.kind!=='unchanged'):Array.isArray(result.changes)?result.changes:Array.isArray(result.changed)?result.changed:[];
  const cards=changes.map(change=>{
   const id=change.noticeId||change.id,note=saved.find(s=>s.noticeId===id);
   let fields=Array.isArray(change.changedFields)?change.changedFields:Array.isArray(change.fields)?change.fields:Array.isArray(change.changes)?change.changes:[];
   if(fields.length&&typeof fields[0]==='string')fields=fields.map(field=>({field,before:field==='retainedResources'?change.before?.resources:(change.before?.raw?.[field]??change.before?.[field]),after:field==='retainedResources'?change.after?.resources:(change.after?.raw?.[field]??change.after?.[field])}));
   return '<article class="change"><div class="change-heading"><div><h3>'+esc(change.title||change.after?.title||change.before?.title||id)+'</h3><p>'+esc(id)+' · '+esc(change.kind==='removed'?(result.after?.sourceBasis==='latest_api_observation'?'no longer returned in this search':'absent from the later retained edition'):label(change.kind||change.status||'changed'))+'</p></div><div class="actions">'+(note?badge(note.decision):'')+button('review-change','Review change',id,'',true)+'</div></div>'+
    (fields.length?'<div class="change-fields"><div class="column-label">Field</div><div class="column-label">Earlier</div><div class="column-label">Later</div>'+fields.map(f=>'<div class="field-name">'+esc(label(f.field||f.key))+'</div><div>'+esc(plain(f.before))+'</div><div>'+esc(plain(f.after))+'</div>').join('')+'</div>':'<pre class="mono">'+esc(JSON.stringify(change,null,2))+'</pre>')+
    (note?'<p class="small-text"><strong>'+esc(note.owner)+'</strong> · '+esc(note.note)+'</p>':'')+'</article>';
  }).join('');
  const groups=['added','removed','missing','unchanged'].filter(key=>Array.isArray(result[key]));
  body='<section class="box">'+boxHeading('Comparison summary','Earlier and later editions remain available with their original source bindings.')+kv(result.counts?Object.entries(result.counts).map(([key,value])=>[key==='removed'?'No longer returned':label(key),value]):[['Changed notices',changes.length],...groups.map(k=>[label(k),result[k].length])])+'</section>'+
   cards+(changes.length?'':empty('No changed notices in this comparison','The retained field comparison found no changed records.'))+
   groups.filter(k=>k!=='unchanged'&&result[k].length).map(k=>'<section class="box">'+boxHeading(label(k)+' notices','')+'<div class="source-list">'+result[k].map(n=>'<div class="source-row"><div><strong>'+esc(n.title||n.notice?.title||n.noticeId||n)+'</strong><small>'+esc(n.noticeId||n.notice?.noticeId||'')+'</small></div></div>').join('')+'</div></section>').join('');
 }
 return panelHeading('Change review','A later capture is another observation of the provider’s latest version. Review the actual changes before updating the pursuit.')+filters+body;
}
function downloadButtons(id,kind) {
 return FORMATS.map(([format,title])=>button('export',title,id,'data-format="'+format+'" data-kind="'+kind+'"')).join('');
}
async function selectionsView() {
 const selections=state.workspace.selections||[];
 const rows=[...selections].reverse().map(s=>{
  const e=state.workspace.editions.find(e=>e.id===s.editionId);
  return '<article class="handoff"><div><p class="eyebrow">Selection revision '+s.revision+'</p><h3>'+esc(s.name)+'</h3><p>'+s.noticeIds.length+' notices · '+esc(e?.name||s.editionId)+'</p><p>'+esc(s.notes||'')+'</p><p class="mono">'+esc(s.id)+'</p><div class="actions">'+downloadButtons(s.id,'selection')+'</div></div><div class="actions">'+button('selection-detail','Open selection',s.id)+button('edit-selection','Edit',s.id)+button('create-handoff','Create named handoff',s.id,'',true)+button('prepare-opportunity','Open opportunity',s.id)+button('prepare-merchant','Prepare merchant',s.id)+'</div></article>';
 });
 return panelHeading('Selections','Keep an explicit set of notice IDs from one retained edition, with scope notes and a saved revision.',button('switch-notices','Select notices','','',true))+
  (rows.length?rows.join(''):empty('No saved selections','Choose notices from the library, then save the set and its purpose.',button('switch-notices','Open notice library','','',true)))+
  (state.detail?.kind==='selection'?await selectionDetail(state.detail.id):'');
}
async function selectionDetail(id) {
 const page=await loadRecord(id,{offset:0,limit:1000,search:''});
 return '<section class="box">'+boxHeading(page.record.name,'Showing '+page.items.length+' of '+page.total+' selected notices; complete exports include the full saved selection.')+
  table(['Notice','Solicitation','Organization','Response deadline'],page.items.map(n=>'<tr><td class="title">'+esc(n.title)+'<small>'+esc(n.noticeId)+'</small></td><td>'+esc(n.solicitationNumber)+'</td><td>'+esc(n.fullParentPathName)+'</td><td>'+esc(n.responseDeadLine||'Not supplied')+'</td></tr>'))+'</section>';
}
function handoffsView() {
 const rows=[...(state.workspace.handoffs||[])].reverse().map(h=>'<article class="handoff"><div><p class="eyebrow">Named handoff</p><h3>'+esc(h.name)+'</h3><p>'+esc(h.note||'')+'</p><p>Source revision '+h.sourceRevision+' · creation revision '+h.revision+' · selection revision '+h.selectionRevision+'</p><p>'+esc(h.createdBy)+' · '+esc(date(h.createdAt))+'</p><p class="mono">'+esc(h.id)+'</p></div><div class="actions">'+downloadButtons(h.id,'handoff')+'</div></article>');
 const publications=(state.workspace.publications||[]).map(p=>{
   const host=state.merchantHosts.find(h=>h.publicationId===p.id),merchant=p.kind==='merchant',configured=merchant&&Boolean(p.seller);
   const running=host?.state==='running',starting=host?.state==='starting';
   return '<article class="handoff"><div><p class="eyebrow">'+(merchant?'Prepared notice seller':'Opportunity source handoff')+'</p><h3>'+esc(p.name||p.id)+'</h3>'+
    kv(Object.entries(p).filter(([k,v])=>!['files','raw','receipt','definition'].includes(k)&&typeof v!=='object').map(([k,v])=>[label(k),v]))+
    (host?'<p>'+badge(host.state)+(host.origin?' <span class="mono">'+esc(host.origin)+'</span>':'')+'</p>':'')+
    (host?.error?'<p>'+esc(host.error.message)+'</p>':'')+
    '</div><div class="actions">'+button('publication-detail','Open preparation',p.id)+
    (configured?((running||starting)?button('merchant-close','Stop local seller',p.id):button('merchant-serve','Start local seller',p.id,'',true))+
      button('buyer-review','Review buyer offer',p.id)+button('prepare-buyer','Prepare buyer request',p.id):
      merchant?button('prepare-merchant','Prepare seller terms',p.selectionId,'',true):'')+'</div></article>';
 });
 return panelHeading('Handoffs','Named exports keep their original selection, source revision and bytes when later work changes the workspace.',button('receive-packet','Receive portable workspace')+button('export','Export workspace','','data-format="portable" data-kind="workspace"'))+
 (rows.length?rows.join(''):empty('Create a named handoff from a selection','The handoff freezes a complete review and receiving edition for the next operator.',button('switch-selections','Open selections','','',true)))+
 '<section>'+boxHeading('Merchant and buyer preparation','Use the existing dataset, seller and buyer contracts for the selected notices.')+(publications.length?publications.join(''):empty('No merchant preparations','Prepare a merchant package from a saved selection, then review its concrete buyer offer.'))+'</section>';
}
async function render() {
 if(!state.workspace)return;
 const generation=++state.renderGeneration;$('#panel').setAttribute('aria-busy','true');
 $$('#tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===state.tab)));
 let content;
 try {
  if(state.tab==='searches')content=searchesView();
  else if(state.tab==='notices')content=await noticesView();
  else if(state.tab==='changes')content=await changesView();
  else if(state.tab==='selections')content=await selectionsView();
  else content=handoffsView();
  if(generation===state.renderGeneration)$('#panel').innerHTML=content;
 }finally{if(generation===state.renderGeneration)$('#panel').setAttribute('aria-busy','false');}
}

function field(name,title,{type='text',value='',required=false,help='',full=false,options=[],placeholder='',min,max,accept}={}) {
 let control;
 if(type==='textarea')control='<textarea name="'+esc(name)+'" id="field-'+esc(name)+'"'+(required?' required':'')+' placeholder="'+esc(placeholder)+'">'+esc(value)+'</textarea>';
 else if(type==='select')control='<select name="'+esc(name)+'" id="field-'+esc(name)+'"'+(required?' required':'')+'>'+options.map(x=>option(Array.isArray(x)?x[0]:x,Array.isArray(x)?x[1]:label(x),value)).join('')+'</select>';
 else control='<input name="'+esc(name)+'" id="field-'+esc(name)+'" type="'+type+'"'+(type==='file'?'':' value="'+esc(value)+'"')+(required?' required':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+(min!==undefined?' min="'+esc(min)+'"':'')+(max!==undefined?' max="'+esc(max)+'"':'')+(accept?' accept="'+esc(accept)+'"':'')+'>';
 return '<label class="field'+(full?' full':'')+'"><span>'+esc(title)+'</span>'+control+(help?'<span class="help">'+esc(help)+'</span>':'')+'</label>';
}
const note = text => '<p class="form-intro">'+esc(text)+'</p>';
const val = (data,key) => String(data.get(key)||'').trim();
const number = (data,key) => Number(val(data,key));
const optional = (data,keys) => Object.fromEntries(keys.map(k=>[k,val(data,k)]).filter(([,v])=>v!==''));
function openEditor({title,kind='Workspace action',fields,action,build,onDone,saveLabel='Save'}) {
 state.editor={action,build,onDone,baseRevision:state.workspace.revision,prepared:null,signature:null};
 $('#editor-title').textContent=title;$('#editor-kind').textContent=kind;$('#editor-fields').innerHTML=fields;
 $('#editor-error').hidden=true;$('#editor-error').textContent='';
 $('#editor-save').textContent=saveLabel;$('#editor-save').disabled=false;
 $('#editor').showModal();
}
function closeEditor() {if($('#editor-save').disabled)return;$('#editor').close();state.editor=null;}
async function editorSubmit(event) {
 event.preventDefault();const context=state.editor;if(!context)return;
 $('#editor-save').disabled=true;$('#editor-error').hidden=true;
 try{
  const data=new FormData($('#editor-form')),payload=await context.build(data);
  const signature=JSON.stringify(payload);
  if(context.signature!==signature){
   if(state.pending&&context.prepared?.payload?.requestId===state.pending.payload.requestId)
    throw new Error('Retry or confirm the saved action before changing its prepared values.');
   context.signature=signature;
   context.prepared={action:context.action,payload:{...payload,expectedRevision:context.baseRevision,requestId:'sam-ui-'+crypto.randomUUID()}};
  }
  const result=await executeMutation(context.action,payload,{prepared:context.prepared});
  $('#editor').close();state.editor=null;
  if(context.onDone)await context.onDone(result);
  await refresh();show('Saved '+label(context.action)+'.');
 }catch(error){
  $('#editor-error').textContent=(error.code?error.code+': ':'')+error.message;
  $('#editor-error').hidden=false;
  if(error.status===409&&!state.pending){
   const retry=document.createElement('button');retry.type='button';retry.className='small';retry.textContent='Read current revision and review this edit';
   retry.addEventListener('click',async()=>{try{await refresh({paint:false});context.baseRevision=state.workspace.revision;context.prepared=null;context.signature=null;$('#editor-error').textContent='Current workspace revision '+state.workspace.revision+' loaded. Review the fields, then save.';}catch(e){$('#editor-error').textContent=e.message;}});
   $('#editor-error').append(document.createElement('br'),retry);
  }
 }finally{$('#editor-save').disabled=false;}
}
function queryEditor(id) {
 const q=state.workspace.queries.find(x=>x.id===id),d=q?.definition||{},f=d.filters||{};
 const now=new Date(),end=now.toISOString().slice(0,10),start=end.slice(0,8)+'01';
 const fields=field('name','Search name',{value:q?.name||'',required:true,full:true})+
  field('postedFrom','Posted from',{type:'date',value:f.postedFrom||start,required:true})+field('postedTo','Posted through',{type:'date',value:f.postedTo||end,required:true,help:'Use a date window of at most one year.'})+
  field('noticeid','Exact notice ID',{value:f.noticeid||''})+field('solnum','Solicitation number',{value:f.solnum||''})+
  field('title','Title keywords',{value:f.title||''})+field('ptype','Notice type',{type:'select',value:f.ptype||'',options:[['','All notice types'],['r','Sources sought'],['o','Solicitation'],['k','Combined synopsis / solicitation'],['p','Pre-solicitation'],['s','Special notice'],['a','Award notice'],['u','Justification'],['g','Sale of surplus property'],['i','Intent to bundle']]})+
  field('organizationName','Organization name',{value:f.organizationName||''})+field('organizationCode','Organization code',{value:f.organizationCode||''})+
  field('ncode','NAICS code',{value:f.ncode||'',placeholder:'Up to six digits'})+field('ccode','Classification code',{value:f.ccode||''})+
  field('typeOfSetAside','Set-aside code',{value:f.typeOfSetAside||'',placeholder:'For example SBA'})+field('state','State',{value:f.state||'',placeholder:'Two-letter code'})+
  field('zip','ZIP code',{value:f.zip||''})+field('rdlfrom','Response deadline from',{type:'date',value:f.rdlfrom||''})+field('rdlto','Response deadline through',{type:'date',value:f.rdlto||''})+
  field('pageSize','Records per page',{type:'number',value:d.pageSize||1000,min:1,max:1000,required:true,help:'The provider uses a page index. The capture advances that index after every retained page.'})+
  field('maxRecords','Capture record capacity',{type:'number',value:d.maxRecords||250000,min:1,max:5000000,required:true,help:'Reaching this value pauses the original capture for an explicit capacity increase.'})+
  field('sourceTerms','Source and use notes',{type:'textarea',value:d.sourceTerms||'',full:true});
 openEditor({title:q?'Edit saved search':'New source search',fields,action:'save_query',build:data=>({
  ...(q?{queryId:q.id}:{}),name:val(data,'name'),
  filters:optional(data,['postedFrom','postedTo','noticeid','solnum','title','ptype','organizationName','organizationCode','ncode','ccode','typeOfSetAside','state','zip','rdlfrom','rdlto']),
  pageSize:number(data,'pageSize'),maxRecords:number(data,'maxRecords'),...(val(data,'sourceTerms')?{sourceTerms:val(data,'sourceTerms')}:{}),
 })});
}
async function startCapture(id) {
 const query=state.workspace.queries.find(q=>q.id===id);if(!query)throw new Error('The saved query is unavailable.');
 openEditor({title:'Capture '+query.name,kind:'Original source acquisition',fields:note('This run uses saved query revision '+query.revision+' and retains every returned page. The source key stays in the launching runtime.')+field('name','Capture name',{value:query.name+' · '+new Date().toISOString().slice(0,10),required:true,full:true}),
  action:'start_capture',saveLabel:'Start capture',build:data=>({queryId:query.id,queryRevision:query.revision,name:val(data,'name')}),
  onDone:async result=>{const captureId=result.result?.captureId;if(captureId){await api('/api/captures/'+encodeURIComponent(captureId)+'/run',{method:'POST',body:{}});state.tab='searches';}},
 });
}
async function captureDetail(id) {
 const result=await loadRecord(id,{offset:0,limit:1000,search:''});
 const record=result.record;
 const content=JSON.stringify({capture:record,pages:result.pages||result.items,attempts:result.attempts},null,2);
 openText('Capture progress · '+(record.name||id),content,[['Capture',id],['Status',record.status],['Next page',record.nextOffset],['Retained records',record.count]],id+'-capture.json','application/json');
}
function resizeCapture(id) {
 const c=state.workspace.captures.find(c=>c.id===id);
 openEditor({title:'Increase capture capacity',fields:note('Continue the original query and its already retained pages.')+
  field('maxRecords','New record capacity',{type:'number',value:Math.max(c.definition.maxRecords*2,c.totalRecords||0),min:c.definition.maxRecords+1,required:true,full:true}),
  action:'resize_capture',build:data=>({captureId:id,maxRecords:number(data,'maxRecords')}),
  onDone:async()=>api('/api/captures/'+encodeURIComponent(id)+'/run',{method:'POST',body:{}}),saveLabel:'Save and continue'});
}
function readJsonFile(file,maximum=512*1024*1024) {
 if(!(file instanceof File)||file.size===0)throw new Error('Choose the complete source JSON file.');
 if(file.size>maximum)throw new Error('The file exceeds the 512 MiB browser receiving limit. Use the original CLI receiving command.');
 return file.text().then(text=>{try{return JSON.parse(text);}catch{throw new Error('The selected file contains invalid JSON.');}});
}
async function fileBase64(file,maximum=64*1024*1024) {
 if(!(file instanceof File)||file.size===0)throw new Error('Choose the original source file.');
 if(file.size>maximum)throw new Error('This browser source input accepts files up to64 MiB. Use the source CLI for larger supported originals.');
 const data=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
 return btoa(binary);
}
function importNotice() {
 const editions=state.workspace.editions||[];
 openEditor({title:'Receive saved SAM notice',kind:'Original notice documents',
  fields:note('Receive the original SAM notice JSON. Add its attachment metadata and published history when those original files are available. The new edition retains all supplied source files.')+
   field('name','Edition name',{full:true,placeholder:'Uses the issued notice title when empty'})+
   field('editionId','Notice collection',{type:'select',full:true,value:'',options:[['','Create a new edition'],...editions.map(e=>[e.id,'Extend '+e.name])]})+
   field('notice','Original notice JSON',{type:'file',accept:'.json,application/json',required:true,full:true})+
   field('resources','Attachment metadata JSON (optional)',{type:'file',accept:'.json,application/json',full:true})+
   field('history','Published history JSON (optional)',{type:'file',accept:'.json,application/json',full:true})+
   field('capturedAt','Original capture time (optional)',{full:true,placeholder:'ISO timestamp with an offset',help:'Leave empty to record when the original files are received here.'}),
  action:'import_notice',saveLabel:'Receive notice',
  build:async data=>{const payload={},name=val(data,'name'),editionId=val(data,'editionId'),capturedAt=val(data,'capturedAt');
   if(name)payload.name=name;if(editionId)payload.editionId=editionId;
   for(const field of ['notice','resources','history']){const file=data.get(field);if(file instanceof File && file.size){
    await readJsonFile(file,64*1024*1024);
    payload[field]={filename:file.name,contentBase64:await fileBase64(file),...(capturedAt?{capturedAt}:{})};}}
   if(!payload.notice)throw new Error('Choose the complete original SAM notice JSON.');
   return payload;},
  onDone:result=>{if(result.result?.editionId){state.editionId=result.result.editionId;state.tab='notices';state.detail=result.result.noticeId;state.selected.clear();state.offset=0;}}
 });
}
function importCapture() {
 openEditor({title:'Receive original captured pages',kind:'Source receiving',fields:note('Choose the original capture JSON containing name, definition and every page with its request, actual status/time and response bytes. The complete captured page bodies stay attached.')+
  field('file','Complete capture JSON',{type:'file',required:true,accept:'.json,application/json',full:true}),
  action:'import_capture',build:async data=>{const v=await readJsonFile(data.get('file'));if(!v.definition||!Array.isArray(v.pages))throw new Error('The original capture must contain definition and pages.');return{name:v.name,definition:v.definition,pages:v.pages};},
  onDone:result=>{if(result.result?.editionId){state.editionId=result.result.editionId;state.tab='notices';state.offset=0;state.search='';}},saveLabel:'Receive captured pages'});
}
async function noticeValue(id) {
 const known=state.record?.items?.find(n=>n.noticeId===id);
 if(known)return known;
 const data=await read('notice',{editionId:state.editionId,noticeId:id});return data.notice||data.record||data;
}
async function reviewNotice(id) {
 const n=await noticeValue(id),r=reviewFor(state.editionId,id);
 openEditor({title:'Review notice',kind:n.solicitationNumber||n.noticeId,fields:note(n.title)+
  field('status','Review status',{type:'select',value:r?.status||'unreviewed',options:['unreviewed','watching','qualified','declined','needs_review']})+
  field('owner','Review owner',{value:r?.owner||state.operator,required:true})+
  field('notes','Review and next work',{type:'textarea',value:r?.notes||'',full:true})+
  note('Deadline as issued: '+(n.responseDeadLine||'Not supplied')+'. Attach an operating deadline only after reviewing that source.')+
  field('at','Reviewed date and explicit offset',{value:r?.deadline?.at||'',placeholder:'2026-10-29T18:00:00-04:00'})+
  field('timeZone','IANA time zone',{value:r?.deadline?.timeZone||'',placeholder:'America/New_York'})+
  field('reason','Deadline source and interpretation',{type:'textarea',value:r?.deadline?.reason||'',full:true}),
  action:'review_notice',build:data=>{const deadline=optional(data,['at','timeZone','reason']);if(Object.keys(deadline).length&&Object.keys(deadline).length!==3)throw new Error('Provide the date with offset, IANA zone, and source reason together.');return{editionId:state.editionId,noticeId:id,status:val(data,'status'),owner:val(data,'owner'),notes:val(data,'notes'),...(Object.keys(deadline).length?{deadline}:{})};}});
}
async function captureResources(id) {
 const n=await noticeValue(id),editionId=state.editionId;
 openEditor({title:'Capture issued source files',kind:n.solicitationNumber||n.noticeId,fields:note(n.title)+note('The original description and every attachment URL in this retained notice will be acquired. Completed bytes form a new enriched edition and the earlier source stays available.')+
  field('mode','Source files',{type:'select',value:'all',options:[['all','Description and all attachments'],['description','Description only'],['attachments','All attachments only']],full:true}),
  action:'capture_resources',build:data=>({editionId,noticeIds:[id],descriptions:val(data,'mode')!=='attachments',attachments:val(data,'mode')!=='description'}),
  onDone:result=>{if(result.result?.editionId){state.editionId=result.result.editionId;state.offset=0;state.selected.clear();state.detail=id;}},saveLabel:'Capture original files'});
}
async function retainResource(id,kind,url) {
 const n=await noticeValue(id),editionId=state.editionId;
 const candidates=[...(n.descriptionUrl?[['description',n.descriptionUrl]]:[]),...(n.resourceLinks||[]).map(u=>['attachment',u])];
 const selected=candidates.find(c=>c[1]===url)||candidates.find(c=>c[0]===kind)||candidates[0];
 if(!selected)throw new Error('This notice edition has no issued description or attachment URL to bind.');
 openEditor({title:'Receive original source file',kind:n.solicitationNumber||n.noticeId,
  fields:note('Select the exact issued URL and the bytes downloaded from that source by the existing operator.')+
   field('url','Issued source URL',{type:'select',value:selected[1],options:candidates.map(([k,u])=>[u,label(k)+' · '+u]),required:true,full:true})+
   field('file','Original file',{type:'file',required:true,full:true})+
   field('filename','Original filename',{required:true,value:'',help:'Retain the filename supplied by the source.'})+
   field('mediaType','Media type',{required:true,value:selected[0]==='description'?'text/html':'application/octet-stream'})+
   field('capturedAt','Actual retrieval timestamp',{required:true,placeholder:'2026-10-12T02:00:00Z',full:true})+
   field('response','HTTP receipt (optional)',{type:'textarea',full:true,rows:4,help:'If the original download includes an HTTP receipt, enter its request object (GET and the issued URL), numeric status and optional response headers as JSON. Otherwise the source is retained as a received file.'}),
  action:'retain_resource',build:async data=>{const selectedUrl=val(data,'url'),candidate=candidates.find(c=>c[1]===selectedUrl);let response;const receipt=val(data,'response');if(receipt){try{response=JSON.parse(receipt);}catch{throw new Error('The HTTP receipt must be valid JSON.');}if(!response||typeof response!=='object'||Array.isArray(response))throw new Error('Use the original HTTP receipt object.');}return{editionId,noticeId:id,kind:candidate[0],url:selectedUrl,filename:val(data,'filename'),mediaType:val(data,'mediaType'),capturedAt:val(data,'capturedAt'),contentBase64:await fileBase64(data.get('file')),...(response?{response}:{})};},
  onDone:result=>{if(result.result?.editionId){state.editionId=result.result.editionId;state.selected.clear();state.detail=id;state.offset=0;}},saveLabel:'Retain original source'});
 const input=$('#field-file');input.addEventListener('change',()=>{if(input.files[0]){if(!$('#field-filename').value)$('#field-filename').value=input.files[0].name;if(input.files[0].type)$('#field-mediaType').value=input.files[0].type;}});
}
async function selectionEditor(id) {
 const existing=state.workspace.selections.find(s=>s.id===id),editionId=existing?.editionId||state.editionId;
 const selected=existing?[...existing.noticeIds]:[...state.selected];
 if(!selected.length)throw new Error('Select at least one notice.');
 const rows=existing?await allNotices(editionId):state.record?.items||[];
 const titles=new Map(rows.map(n=>[n.noticeId,n.title]));
 const checks='<div class="field full"><span>Selected notices</span><div class="choice-list">'+selected.map(noticeId=>'<label class="choice-row"><input type="checkbox" name="noticeIds" value="'+esc(noticeId)+'" checked><span><strong>'+esc(titles.get(noticeId)||noticeId)+'</strong><small>'+esc(noticeId)+'</small></span></label>').join('')+'</div></div>';
 openEditor({title:existing?'Edit saved selection':'Save notice selection',fields:field('name','Selection name',{value:existing?.name||'',required:true,full:true})+checks+
  field('notes','Scope and purpose',{type:'textarea',value:existing?.notes||'',full:true}),
  action:'save_selection',build:data=>({...(existing?{selectionId:id}:{}),editionId,name:val(data,'name'),noticeIds:data.getAll('noticeIds').map(String),notes:val(data,'notes')}),
  onDone:()=>{state.tab='selections';state.detail=null;state.selected.clear();}});
}
function handoffEditor(selectionId) {
 const s=state.workspace.selections.find(s=>s.id===selectionId);
 openEditor({title:'Create named handoff',fields:note(s.name+' · selection revision '+s.revision+' · '+s.noticeIds.length+' notices')+
  field('name','Handoff name',{value:s.name+' · receiving',required:true,full:true})+
  field('note','Receiving notes',{type:'textarea',value:s.notes||'',full:true}),
  action:'create_handoff',build:data=>({name:val(data,'name'),selectionId,note:val(data,'note')}),
  onDone:()=>{state.tab='handoffs';state.detail=null;},saveLabel:'Freeze named handoff'});
}
function changeEditor(noticeId) {
 const original=(state.workspace.changes||[]).find(c=>c.beforeEditionId===state.beforeEditionId&&c.afterEditionId===state.afterEditionId&&c.noticeId===noticeId);
 const beforeEditionId=state.beforeEditionId,afterEditionId=state.afterEditionId;
 openEditor({title:'Review notice change',fields:note(noticeId)+
  field('decision','Change decision',{type:'select',value:original?.decision||'follow_up',options:['reviewed','follow_up','dismissed']})+
  field('owner','Review owner',{value:original?.owner||state.operator,required:true})+
  field('note','Decision and follow-up work',{type:'textarea',value:original?.note||'',required:true,full:true}),
  action:'review_change',build:data=>({beforeEditionId,afterEditionId,noticeId,decision:val(data,'decision'),owner:val(data,'owner'),note:val(data,'note')})});
}
async function opportunityEditor(selectionId) {
 const selection=state.workspace.selections.find(s=>s.id===selectionId);
 if(!state.opportunityConfigured)throw new Error('Launch this workspace with --opportunity-workspace set to the existing opportunity workspace directory, then use this handoff.');
 const rows=(await allNotices(selection.editionId)).filter(n=>selection.noticeIds.includes(n.noticeId));
 openEditor({title:'Prepare opportunity workspace',fields:note('The selected notice and its retained original sources will be joined to the opportunity workspace selected at launch.')+
  field('noticeId','Notice',{type:'select',value:rows[0]?.noticeId,options:rows.map(n=>[n.noticeId,n.title]),required:true,full:true})+
  field('documentKind','Issued document kind',{type:'select',value:'sources_sought',options:['rfi','sources_sought','solicitation','other']})+
  field('title','Opportunity title',{value:rows[0]?.title||''})+
  field('projectId','Existing opportunity ID',{help:'Leave empty to create the source-bound opportunity.'})+
  field('expectedProjectRevision','Existing opportunity revision',{type:'number',min:1})+
  field('at','Reviewed deadline with offset',{placeholder:'2026-10-29T18:00:00-04:00'})+
  field('timeZone','IANA time zone',{placeholder:'America/New_York'})+
  field('reason','Deadline source and interpretation',{type:'textarea',full:true}),
  action:'prepare_opportunity',build:data=>{
   const deadline=optional(data,['at','timeZone','reason']),projectId=val(data,'projectId'),revision=val(data,'expectedProjectRevision');
   if(Object.keys(deadline).length&&Object.keys(deadline).length!==3)throw new Error('Provide all three reviewed deadline fields together.');
   if(Boolean(projectId)!==Boolean(revision))throw new Error('Provide the existing project ID and expected revision together.');
   return{selectionId,noticeId:val(data,'noticeId'),documentKind:val(data,'documentKind'),...(val(data,'title')?{title:val(data,'title')}:{}),...(projectId?{projectId,expectedProjectRevision:Number(revision)}:{}),...(Object.keys(deadline).length?{deadline}:{})};
  },onDone:result=>{openText('Prepared opportunity handoff',JSON.stringify(result.result,null,2),[['Selection',selectionId]],'sam-opportunity-handoff.json','application/json');},saveLabel:'Prepare opportunity'});
}
function merchantEditor(selectionId) {
 const selection=state.workspace.selections.find(s=>s.id===selectionId);
 openEditor({title:'Prepare merchant integration',fields:note(selection.name+' · '+selection.noticeIds.length+' retained notice records')+
  field('origin','Seller origin',{placeholder:'https://existing-merchant.example',full:true,help:'Supply the intended resource origin together with its payment configuration to prepare a running seller.'})+
  field('path','Product path',{value:'/procurement-notices',required:true})+
  field('defaultLimit','Default result limit',{type:'number',value:50,min:1,required:true})+
  field('maxLimit','Maximum result limit',{type:'number',value:100,min:1,required:true})+
  field('payment','Existing payment configuration JSON',{type:'textarea',full:true,help:'Supply the existing public SDK payment terms and seller origin together. Leave both empty to prepare the retained dataset for configuration later.'}),
  action:'prepare_merchant',build:data=>{let payment;const rawPayment=val(data,'payment'),origin=val(data,'origin');if(Boolean(rawPayment)!==Boolean(origin))throw new Error('Supply the seller origin and public payment terms together, or leave both empty to prepare the dataset.');if(rawPayment){try{payment=JSON.parse(rawPayment);}catch{throw new Error('The payment configuration must be JSON.');}if(!payment||typeof payment!=='object'||Array.isArray(payment))throw new Error('Use the original SDK payment object.');}return{selectionId,...(origin?{origin,payment}:{}),path:val(data,'path'),defaultLimit:number(data,'defaultLimit'),maxLimit:number(data,'maxLimit')};},
  onDone:result=>{state.tab='handoffs';openText('Merchant preparation',JSON.stringify(result.result,null,2),[['Selection',selectionId]],'sam-merchant-preparation.json','application/json');},saveLabel:'Prepare merchant'});
}
function buyerReviewEditor(publicationId) {
 openEditor({title:'Review actual buyer offer',fields:note('Use the running original seller and the product prepared from this publication. The review reads the actual offer before preparing a buyer request.')+
  field('seller','Running seller origin',{value:state.merchantHosts.find(h=>h.publicationId===publicationId&&h.state==='running')?.origin||'',placeholder:'http://127.0.0.1:PORT',required:true,full:true})+
  field('query','Product query JSON',{type:'textarea',value:'{}',required:true,full:true}),
  action:'buyer_review',build:data=>{let query;try{query=JSON.parse(val(data,'query'));}catch{throw new Error('The product query must be JSON.');}return{publicationId,seller:val(data,'seller'),query};},
  onDone:result=>openText('Buyer offer review',JSON.stringify(result.result,null,2),[['Publication',publicationId]],'sam-buyer-review.json','application/json'),saveLabel:'Read actual offer'});
}
function prepareBuyerEditor(publicationId) {
 openEditor({title:'Prepare original buyer request',fields:note('Bind the request to the actual saved offer review. The original buyer handles the prepared request and payment flow.')+
  field('reviewId','Saved buyer review ID',{required:true,full:true})+
  field('intentId','Original buyer intent ID',{required:true,full:true})+
  field('acceptIndex','Selected offer index',{type:'number',value:0,min:0,required:true})+
  field('offerSha256','Reviewed offer SHA256',{required:true,full:true}),
  action:'prepare_buyer',build:data=>({publicationId,reviewId:val(data,'reviewId'),intentId:val(data,'intentId'),acceptIndex:number(data,'acceptIndex'),offerSha256:val(data,'offerSha256')}),
  onDone:result=>openText('Prepared buyer request',JSON.stringify(result.result,null,2),[['Publication',publicationId]],'sam-buyer-request.json','application/json'),saveLabel:'Prepare saved request'});
}
function downloadBlob(blob,filename) {
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadPath(path,fallback) {
 const response=await fetch(path,{headers:{Authorization:'Bearer '+token}});
 if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error?.message||'Download failed: HTTP '+response.status);}
 const disposition=response.headers.get('content-disposition')||'';
 const name=/filename="([^"]+)"/.exec(disposition)?.[1]||fallback;
 downloadBlob(await response.blob(),name);show('Downloaded '+name+'.');
}
async function exportView(id,kind,format) {
 const query=new URLSearchParams({format:format||'portable'});
 if(kind==='selection')query.set('selectionId',id);
 if(kind==='handoff')query.set('handoffId',id);
 await downloadPath('/api/export?'+query,'sam-workspace.json');
}
function openText(title,content,metadata=[],filename='sam-record.txt',mediaType='text/plain') {
 const data=new TextEncoder().encode(content);
 state.source={filename,mediaType,bytes:data.length,contentBase64:null,contentText:content};
 $('#source-title').textContent=title;$('#source-metadata').innerHTML=kv(metadata);
 $('#source-text').textContent=content;$('#source-viewer').showModal();
}
async function viewSource(sourceId) {
 const source=await api('/api/sources/'+encodeURIComponent(sourceId));state.source=source;
 $('#source-title').textContent=source.filename;
 $('#source-metadata').innerHTML=kv([['Source ID',source.id],['Media type',source.mediaType],['Bytes',source.bytes],['SHA256',source.sha256]]);
 $('#source-text').textContent=source.contentText!==undefined&&source.contentText!==null?source.contentText:'Original binary source · '+bytes(source.bytes)+'. Download the retained file to open it in its native application.';
 $('#source-viewer').showModal();
}
function sourceDownload() {
 if(!state.source)return;
 const source=state.source;
 if(source.contentBase64){const raw=atob(source.contentBase64),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);downloadBlob(new Blob([data],{type:'application/octet-stream'}),source.filename);}
 else downloadBlob(new Blob([source.contentText||''],{type:source.mediaType||'text/plain'}),source.filename);
}
async function receivePacket(file) {
 const packet=await readJsonFile(file);
 show('Receiving the complete retained workspace…');
 const result=await api('/api/receive',{method:'POST',body:{packet}});
 if(result.workspace)state.workspace=result.workspace;
 state.offset=0;state.search='';state.selected.clear();state.detail=null;
 await refresh();show('Received the portable workspace at revision '+state.workspace.revision+'.');
}
async function handleAction(target) {
 const action=target.dataset.action,id=target.dataset.id;
 if(action==='refresh'){await refresh();show('Current retained workspace loaded.');}
 else if(action==='new-query')queryEditor();
 else if(action==='edit-query')queryEditor(id);
 else if(action==='start-capture')await startCapture(id);
 else if(action==='run-capture'){await api('/api/captures/'+encodeURIComponent(id)+'/run',{method:'POST',body:{}});await refresh();show('Continuing the original capture.');}
 else if(action==='cancel-capture'){await api('/api/captures/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:{}});await refresh();show('Capture pause requested; its retained pages stay available.');}
 else if(action==='capture-detail')await captureDetail(id);
 else if(action==='resize-capture')resizeCapture(id);
 else if(action==='import-capture')importCapture();
 else if(action==='import-notice')importNotice();
 else if(action==='open-edition'){state.editionId=id;state.offset=0;state.search='';state.detail=null;state.selected.clear();state.tab='notices';await render();}
 else if(action==='notice-detail'){state.detail=id;await render();$('.notice-detail')?.scrollIntoView({block:'start',behavior:'auto'});}
 else if(action==='close-notice'){state.detail=null;await render();}
 else if(action==='review-notice')await reviewNotice(id);
 else if(action==='capture-resources')await captureResources(id);
 else if(action==='retain-resource')await retainResource(id,target.dataset.kind,target.dataset.url);
 else if(action==='view-source')await viewSource(id);
 else if(action==='download-source')await downloadPath('/api/sources/'+encodeURIComponent(id)+'?download=1','sam-source');
 else if(action==='search-notices'){state.search=$('#notice-search').value.trim();state.offset=0;state.detail=null;await render();}
 else if(action==='clear-notice-search'){state.search='';state.offset=0;await render();}
 else if(action==='previous-page'){state.offset=Math.max(0,state.offset-state.limit);state.detail=null;await render();}
 else if(action==='next-page'){state.offset+=state.limit;state.detail=null;await render();}
 else if(action==='select-page'){for(const n of state.record?.items||[])state.selected.add(n.noticeId);await render();}
 else if(action==='clear-selection'){state.selected.clear();await render();}
 else if(action==='select-all'){for(const n of await allNotices(state.editionId))state.selected.add(n.noticeId);await render();}
 else if(action==='save-selection')await selectionEditor();
 else if(action==='edit-selection')await selectionEditor(id);
 else if(action==='selection-detail'){state.detail={kind:'selection',id};await render();}
 else if(action==='create-handoff')handoffEditor(id);
 else if(action==='prepare-opportunity')await opportunityEditor(id);
 else if(action==='prepare-merchant')merchantEditor(id);
 else if(action==='merchant-serve'){
   const host=await api('/api/publications/'+encodeURIComponent(id)+'/serve',{method:'POST',body:{}});
   await refresh();show('The prepared notice seller is running at '+host.origin+'.');
 }
 else if(action==='merchant-close'){
   await api('/api/publications/'+encodeURIComponent(id)+'/close',{method:'POST',body:{}});
   await refresh();show('The selected seller has closed and its retained publication is ready to reopen.');
 }
 else if(action==='buyer-review')buyerReviewEditor(id);
 else if(action==='prepare-buyer')prepareBuyerEditor(id);
 else if(action==='publication-detail'){const p=await loadRecord(id,{offset:0,limit:1000,search:''});openText('Merchant preparation',JSON.stringify(p,null,2),[['Publication',id]],'sam-publication.json','application/json');}
 else if(action==='compare'){state.beforeEditionId=$('#before-edition').value;state.afterEditionId=$('#after-edition').value;state.comparison=await read('compare',{beforeEditionId:state.beforeEditionId,afterEditionId:state.afterEditionId});await render();}
 else if(action==='review-change')changeEditor(id);
 else if(action==='export')await exportView(id,target.dataset.kind,target.dataset.format);
 else if(action==='receive-packet')$('#packet-file').click();
 else if(action==='retry-pending'){const request=state.pending;if(request){await executeMutation(request.action,request.payload,{prepared:request});await refresh();show('The saved action is recorded.');}}
 else if(action?.startsWith('switch-')){state.tab=action.slice(7);state.detail=null;await render();}
}
document.addEventListener('click',async event=>{
 const close=event.target.closest('[data-close-editor]');if(close){closeEditor();return;}
 if(event.target.closest('[data-close-source]')){$('#source-viewer').close();return;}
 const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
 target.disabled=true;
 try{await handleAction(target);}catch(error){show((error.code?error.code+': ':'')+error.message,true);}finally{target.disabled=false;}
});
$('#tabs').addEventListener('click',async event=>{
 const button=event.target.closest('[data-tab]');if(!button)return;
 state.tab=button.dataset.tab;state.detail=null;
 try{await render();}catch(error){show(error.message,true);}
});
document.addEventListener('change',async event=>{
 if(event.target.id==='edition-select'){state.editionId=event.target.value;state.offset=0;state.search='';state.detail=null;state.selected.clear();try{await render();}catch(error){show(error.message,true);}}
 if(event.target.matches('[data-select-notice]')){if(event.target.checked)state.selected.add(event.target.dataset.selectNotice);else state.selected.delete(event.target.dataset.selectNotice);try{await render();}catch(error){show(error.message,true);}}
 if(event.target.id==='before-edition'||event.target.id==='after-edition'){state.beforeEditionId=$('#before-edition').value;state.afterEditionId=$('#after-edition').value;state.comparison=null;try{await render();}catch(error){show(error.message,true);}}
});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='notice-search'){event.preventDefault();$('#panel [data-action="search-notices"]')?.click();}});
$('#refresh').addEventListener('click',async()=>{try{await refresh();show('Current retained workspace loaded.');}catch(error){show(error.message,true);}});
$('#editor-form').addEventListener('submit',editorSubmit);
$('#editor').addEventListener('cancel',event=>{if($('#editor-save').disabled)event.preventDefault();else state.editor=null;});
$('#source-download').addEventListener('click',sourceDownload);
$('#packet-file').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(file){try{await receivePacket(file);}catch(error){show(error.message+' The same complete packet can be received again to reconcile its retained state.',true);}}});
if(!token){$('#connection-state').textContent='Private link required';show('Open the private link printed by the workspace serve command. Its fragment authenticates this operator tab.',true);$('#panel').setAttribute('aria-busy','false');}
else refresh().catch(error=>{$('#connection-state').textContent='Connection unavailable';show(error.message,true);$('#panel').setAttribute('aria-busy','false');});
