// MIT. Industrial local operator. No provider token or source rows enter browser storage.
const $ = id => document.getElementById(id);
const clone = value => value == null ? value : structuredClone(value);
const node = (tag, value, className) => { const e = document.createElement(tag); if (value != null) e.textContent = String(value); if (className) e.className = className; return e; };
const short = value => value ? String(value).slice(0,16) : '—';
const shown = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const when = value => value ? new Date(value).toLocaleString() : '—';
const uuid = () => crypto.randomUUID();
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
const bodyHash = value => sha(JSON.stringify(stable(value)));
const tokenKey = 'stellar.baserow.authoring.token';
let token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(tokenKey);
let state = null, busy = false, pending = null, retryPayload = null, known = null, recovering = false;
let metadata = null, sourceOrders = [], captureColumns = new Map(), editorColumns = new Map(), captureView = null;
let rowsPage = null, filesPage = null;
let draft = null, draftRevision = 0, dirty = false, queryName = null, preview = null, upload = null;
let revision = 0, renderEpoch = 0, deployment = null, deploymentReview = null;
let capturesOffset = 0, versionsOffset = 0, discoveriesOffset = 0, deploymentOffset = 0;
const limit = 25;
const errorMessage = e => [e.code, e.message || String(e)].filter(Boolean).join(': ');
function notice(value, error = false) { $('notice').textContent = value || ''; $('notice').hidden = !value; $('notice').classList.toggle('error', error); }
function tab(name) {
  document.querySelectorAll('[data-panel]').forEach(e => { e.hidden = e.dataset.panel !== name; });
  document.querySelectorAll('[data-view]').forEach(e => e.setAttribute('aria-current', e.dataset.view === name ? 'page' : 'false'));
}
function lock() {
  $('workspace-controls').disabled = !state || busy || Boolean(pending);
  for (const id of ['check-operation','resume-operation','retry-operation','dismiss-operation','retry-file']) $(id).disabled = busy || recovering;
  $('retry-operation').disabled = busy || recovering || (!retryPayload && Boolean(pending?.file));
}
const markerPrefix = directory => 'stellar.baserow.pending.v1:' + directory + ':';
const activeKey = directory => 'stellar.baserow.active.v1:' + directory;
function showRecovery(message) {
  $('recovery').hidden = !pending;
  if (!pending) { lock(); return; }
  $('recovery-title').textContent = pending.label || 'Retained source request';
  $('recovery-id').textContent = pending.requestId;
  $('recovery-message').textContent = message || (known?.status === 'complete' ? 'The original receipt is available. Refreshing its saved result…' :
    known?.status === 'pending' ? 'The original operation is still running. Check this same receipt again.' :
    known?.status === 'interrupted' ? 'Resume this retained request. Provider reads are never repeated by recovery.' :
    known?.status === 'failed' ? known.error?.message || 'The operation ended with a recorded error. Saved work remains available.' :
    'No receipt is currently visible. Retry only this identical request.');
  $('resume-operation').hidden = known?.status !== 'interrupted';
  $('retry-operation').hidden = known !== null;
  $('dismiss-operation').hidden = known?.status !== 'failed';
  $('retry-file-label').hidden = known !== null || !pending.file || Boolean(retryPayload);
  $('retry-operation').disabled = busy || recovering || !retryPayload && Boolean(pending.file);
  lock();
}
async function sha(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
}
function remember(marker, body) {
  marker.directory = state.directory;
  localStorage.setItem(markerPrefix(state.directory) + marker.requestId, JSON.stringify(marker));
  sessionStorage.setItem(activeKey(state.directory), marker.requestId);
  pending = marker; retryPayload = body; known = null; showRecovery('Waiting for the original request receipt…');
}
function forget() {
  if (pending) {
    localStorage.removeItem(markerPrefix(pending.directory) + pending.requestId);
    if (sessionStorage.getItem(activeKey(pending.directory)) === pending.requestId) sessionStorage.removeItem(activeKey(pending.directory));
  }
  pending = null; retryPayload = null; known = null; showRecovery();
}
async function api(path, options = {}) {
  const control = new AbortController(), timeout = setTimeout(() => control.abort(), options.timeout ?? 65000);
  try {
    const response = await fetch(path, { method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'x-baserow-workspace-token': token || '', ...(options.body === undefined ? {} : { 'content-type':'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), cache:'no-store', signal:control.signal });
    if (options.binary && response.ok) return { data: await response.blob(),
      filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'baserow-source.json',
      sha256: response.headers.get('x-content-sha256'), manifestSha256: response.headers.get('x-capture-sha256') };
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || result.error || response.statusText), { code: result.error, status: response.status });
    return result;
  } catch (issue) { if (!issue.status) issue.uncertain = true; throw issue; }
  finally { clearTimeout(timeout); }
}
async function refresh({ loadCurrentDraft = false } = {}) {
  const epoch = ++renderEpoch, editing = revision;
  const latest = await api('/api/status?' + new URLSearchParams({capturesOffset,versionsOffset,discoveriesOffset,limit}));
  if (epoch !== renderEpoch) return state;
  state = latest; renderState();
  if (loadCurrentDraft && latest.draft && editing === revision) await loadDraft(latest.draft, latest.draftRevision);
  return latest;
}
async function finish(result, marker) {
  // Retain the same request marker through a failed status read or view refresh.
  await refresh();
  if (marker.path === '/api/discover') { loadDiscovery(result); tab('acquire'); }
  if (['/api/import-package','/api/capture','/api/draft'].includes(marker.path)) {
    if (state.draft) await loadDraft(state.draft, state.draftRevision);
    tab('review');
  }
  if (marker.path === '/api/preview') { preview = result; renderPreview(); tab('review'); }
  if (marker.path === '/api/version' || marker.path === '/api/select') tab('versions');
  if (marker.path === '/api/deployment/review') { deploymentReview = result; renderDeploymentReview(); }
  if (marker.path?.startsWith('/api/deployment/')) await refreshDeployment();
  if (marker.path === '/api/deployment/prepare') { $('stage-package').value = result.packageRequestId; $('stage-sha').value = result.sourceSha256; }
  if (marker.path === '/api/publisher/start') { tab('deploy'); renderPublisher(); }
  if (pending?.requestId === marker.requestId) forget();
  notice('Saved. Original request ' + marker.requestId + '.');
}
async function checkReceipt() {
  if (!pending || recovering) return;
  recovering = true; lock();
  try {
    const reply = await api('/api/operation?id=' + encodeURIComponent(pending.requestId));
    known = reply.operation; showRecovery();
    if (known?.status === 'complete') await finish(known.result, pending);
  } catch (issue) { showRecovery('The receipt could not be read. Its original request remains retained. ' + errorMessage(issue)); }
  finally { recovering = false; lock(); }
}
async function mutate(path, body, label, file = null) {
  if (pending || busy) return;
  busy = true; lock(); notice('');
  try {
    const requestId = uuid(), payload = { ...clone(body), requestId };
    const marker = { requestId, path, label, bodySha256: await bodyHash(payload),
      small: file ? { ...clone(body), packet: undefined } : payload, file, createdAt: new Date().toISOString() };
    remember(marker, payload);
    try { const result = await api(path, { body: payload }); await finish(result, marker); }
    catch (issue) {
      notice(errorMessage(issue), true);
      const reply = await api('/api/operation?id=' + requestId).catch(() => null);
      if (reply) {
        known = reply.operation; showRecovery();
        if (known?.status === 'complete') await finish(known.result, marker);
        else if (known === null && issue.status) { forget(); notice(errorMessage(issue), true); }
      } else showRecovery('The request response is uncertain. Keep this identifier and read its original receipt.');
    }
  } catch (issue) { notice(errorMessage(issue), true); }
  finally { busy = false; lock(); }
}
async function readAction(action) {
  if (busy || pending) return;
  busy = true; lock(); notice('');
  try { await action(); } catch (issue) { notice(errorMessage(issue), true); } finally { busy = false; lock(); }
}
async function download(path, expected = null) {
  const file = await api(path, { binary:true });
  if (expected && (file.data.size !== expected.bytes || file.sha256 !== expected.sha256 ||
      file.manifestSha256 !== expected.manifestSha256 || await sha(await file.data.arrayBuffer()) !== expected.sha256))
    throw new Error('The received bytes differ from the selected original attachment. Refresh its retained capture.');
  const url = URL.createObjectURL(file.data);
  const a = document.createElement('a'); a.href = url; a.download = file.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function table(parent, headings, rows) {
  parent.replaceChildren();
  if (!rows.length) { parent.append(node('p','No retained items.','help')); return; }
  const t=node('table'),head=node('thead'),tr=node('tr');
  for(const value of headings)tr.append(node('th',value));head.append(tr);t.append(head);
  const b=node('tbody');for(const cells of rows){const r=node('tr');for(const value of cells){const c=node('td');c.append(value instanceof Node?value:node('span',shown(value)));r.append(c);}b.append(r);}t.append(b);parent.append(t);
}
function button(label, action) {
  const b=node('button',label);b.type='button';b.addEventListener('click',async event=>{event.preventDefault();if(busy||pending)return;try{await action();}catch(issue){notice(errorMessage(issue),true);}});return b;
}
function actions(...buttons){const n=node('div');n.append(...buttons);return n;}
function description(title, detail){const n=node('div');n.append(node('strong',title),node('small',detail));return n;}
function jsonView(value){return node('pre',JSON.stringify(value,null,2));}
function change(){dirty=true;revision++;$('draft-state').textContent='Unsaved edits · based on draft revision '+draftRevision;preview=null;renderPreview();}
function pager(name,offset,total){$(name+'-page').textContent=(total?offset+1:0)+'–'+Math.min(offset+limit,total)+' of '+total;$(name+'-prev').disabled=offset===0;$(name+'-next').disabled=offset+limit>=total;}
function renderState(){
  $('workspace-path').textContent=state.directory;
  $('summary').textContent='Draft '+state.draftRevision+' · Selected source '+(state.selectedVersion??'none');
  const stats=$('overview-stats');stats.replaceChildren();
  for(const [label,value] of [['Observations',state.pages.capturesTotal],['Saved versions',state.pages.versionsTotal],['Selected version',state.selectedVersion??'—']]){const e=node('div',null,'stat');e.append(node('strong',value),node('span',label));stats.append(e);}
  const choice=$('connection'),old=choice.value;choice.replaceChildren(node('option','Select connection'));
  for(const c of state.connections){const o=node('option',c.label+' · '+c.server+' · '+c.state);o.value=c.alias;choice.append(o);}if(state.connections.some(c=>c.alias===old))choice.value=old;renderConnection();
  $('connection-help').textContent=state.connections.length?'Token values remain on this host. The browser selects only these declared connection aliases.':'No live read connection is declared. Import a complete source packet, or restart with the private connections file described in WORKSPACE.md.';
  table($('captures'),['Observation','Rows / pages','Original source','Completed','Actions'],state.captures.map(c=>[
    description(c.title,c.tableTitle+' · '+short(c.manifestSha256)),c.rowCount+' / '+c.pageCount,
    description(sourceLabel(c.selection),c.selection.server),when(c.completedAt),
    actions(button('Review',()=>readAction(()=>loadDraft(c.draft,state.draftRevision))),button('Download',()=>readAction(()=>download('/api/export-capture?id='+c.id))))]));
  pager('captures',capturesOffset,state.pages.capturesTotal);
  table($('discoveries'),['Table','Source','Inspected','Actions'],state.discoveries.map(d=>[d.title,description(sourceLabel(d.source),d.source.server),when(d.receivedAt),button('Use metadata',()=>{loadDiscovery(d);tab('acquire');})]));
  pager('discoveries',discoveriesOffset,state.pages.discoveriesTotal);
  table($('operations'),['Action','Request','State','Updated','Actions'],state.operations.map(o=>[
    o.kind,node('code',o.id),o.status,when(o.updatedAt),actions(
      button('Receipt',()=>readAction(async()=>{const v=await api('/api/operation?id='+o.id);$('attempt-detail').hidden=false;$('attempt-detail').replaceChildren(node('h3','Original operation'),jsonView(v));})),
      ...(o.kind==='CAPTURE'?[button('Retained files',()=>readAction(async()=>{const v=await api('/api/capture-attempt?id='+o.id);$('attempt-detail').hidden=false;$('attempt-detail').replaceChildren(node('h3','Original capture files'),jsonView(v));}))]:[]),
      ...(['pending','interrupted'].includes(o.status)?[button('Recover',()=>{
        pending={requestId:o.id,path:'/api/resume',label:o.kind,directory:state.directory};known=o;retryPayload=null;showRecovery();checkReceipt();
      })]:[]))]));
  table($('versions'),['Version','Review','Rows / queries','Exact source','Actions'],state.versions.map(v=>[
    description('v'+v.id+(v.id===state.selectedVersion?' · SELECTED':''),v.title),description(v.reviewer,when(v.createdAt)+' · '+v.note),
    v.rowCount+' / '+Object.keys(v.queries).join(', '),node('code',short(v.sourceSha256)),
    actions(button('Select',()=>mutate('/api/select',{versionId:v.id,expectedSelectedVersion:state.selectedVersion},'Select saved source')),
      button('Review draft',()=>readAction(()=>loadDraft(v.draft,state.draftRevision))),
      button('Download complete source',()=>readAction(()=>download('/api/export?id='+v.id))))]));
  pager('versions',versionsOffset,state.pages.versionsTotal);
  renderPublisher();lock();
}
function alias(text,index){return (text.normalize('NFKD').replace(/[^A-Za-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^([^A-Za-z])/,'field_$1').slice(0,40)||'field')+'_'+index;}
function sourceLabel(source){
  return source.kind==='public-grid'?'Shared grid '+source.slug:'Table '+source.tableId+(source.viewId?' · view '+source.viewId:'');
}
function nativeField(field){return{id:field.key??'field_'+field.id,providerId:field.id,title:field.name,type:field.type};}
function renderConnection(){
  const connection=state?.connections.find(c=>c.alias===$('connection').value),shared=connection?.kind==='public-grid';
  $('public-source').hidden=!shared;$('table-source').hidden=Boolean(shared);$('view-source').hidden=Boolean(shared);
  $('public-slug').required=Boolean(shared);$('table-id').required=Boolean(connection&&!shared);
}
function attachmentPolicy(){
  if($('attachment-mode').value==='metadata')return{mode:'metadata'};
  return{mode:'retain',allowedOrigins:$('attachment-origins').value.split(/[\r\n,]+/).map(x=>x.trim()).filter(Boolean),
    maxFileBytes:Number($('attachment-max-bytes').value),maxFiles:Number($('attachment-max-files').value)};
}
function defaultSpec(field,index){
  if(['$recordId','$order'].includes(field.id))return{alias:field.id==='$recordId'?'record_id':'row_order',
    enabled:true,source:field.id,type:'string',encoding:'identity-text',nullable:false,empty:'preserve'};
  const encoding=['autonumber','rating','count'].includes(field.type)?'number-text':
    ['single_select','multiple_select','link_row','file','lookup','multiple_collaborators','formula'].includes(field.type)?'json-text':'native';
  return{alias:alias(field.title,index),enabled:false,source:field.id,providerType:field.type,
    type:field.type==='boolean'?'boolean':'string',encoding,nullable:true,empty:'preserve'};
}
function selectInput(values,value,changed){
  const input=node('select');for(const item of values){const [v,label]=Array.isArray(item)?item:[item,item];const o=node('option',label);o.value=v;input.append(o);}input.value=value;input.addEventListener('change',()=>{if(!busy&&!pending)changed(input.value);});return input;
}
function fieldTable(parent,fields,map,onChange){
  table(parent,['Use','Native field / observed values','Public alias','Scalar type','Value encoding','Nulls','Empty strings'],fields.map((f,index)=>{
    let spec=map.get(f.id);if(!spec){spec=defaultSpec(f,index);map.set(f.id,spec);}
    const check=node('input');check.type='checkbox';check.checked=spec.enabled;check.setAttribute('aria-label','Use '+f.title);check.addEventListener('change',()=>{if(!busy&&!pending){spec.enabled=check.checked;onChange();}});
    const details=description(f.title,(['$recordId','$order'].includes(f.id)?'Native identity/order':f.type)+' · '+f.id);
    if(f.counts){details.append(node('small',Object.entries(f.counts).filter(([,n])=>n).map(([k,n])=>k+' '+n).join(' · ')));details.append(node('small',(f.samples??[]).map(s=>s.kind+': '+shown(s.value)).join(' | ')));}
    const name=node('input');name.value=spec.alias;name.maxLength=48;name.setAttribute('aria-label','Public alias for '+f.title);name.addEventListener('input',()=>{if(!busy&&!pending){spec.alias=name.value;onChange();}});
    const type=selectInput(['string','integer','number','boolean'],spec.type,v=>{spec.type=v;onChange();});type.setAttribute('aria-label','Scalar type for '+f.title);
    const options=['$recordId','$order'].includes(f.id)?['identity-text','native','number-text','decimal-number']:
      ['native','number-text','decimal-number','json-text',...(f.type==='single_select'?['select-value']:[]),...(f.type==='file'?['attachments']:[])];
    const encoding=selectInput(options,spec.encoding,v=>{spec.encoding=v;onChange();});encoding.setAttribute('aria-label','Encoding for '+f.title);
    const nullable=selectInput([['false','Required'],['true','Allow null']],String(spec.nullable),v=>{spec.nullable=v==='true';onChange();});nullable.setAttribute('aria-label','Null policy for '+f.title);if(['$recordId','$order'].includes(f.id))nullable.disabled=true;
    const empty=selectInput([['preserve','Preserve'],['null','Use null']],spec.empty,v=>{spec.empty=v;onChange();});empty.setAttribute('aria-label','Empty string policy for '+f.title);
    return[check,details,name,type,encoding,nullable,empty];
  }));
}
function columnsFrom(map){
  const result={};for(const spec of map.values())if(spec.enabled){
    if(!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(spec.alias)||['constructor','prototype','__proto__'].includes(spec.alias)||Object.hasOwn(result,spec.alias))throw new Error('Use unique public column names beginning with a letter, followed by letters, digits or underscores.');
    const {alias:ignored,enabled:ignoredEnabled,...value}=spec;result[spec.alias]=value;
  }return result;
}
function mapFrom(fields,columns){
  const mapped=new Map(fields.map((f,i)=>[f.id,defaultSpec(f,i)]));for(const spec of mapped.values())spec.enabled=false;
  for(const [name,spec]of Object.entries(columns))mapped.set(spec.source,{...clone(spec),alias:name,enabled:true});
  return mapped;
}
function loadDiscovery(value){
  metadata=value;sourceOrders=clone(value.originalOrder?.requested??value.source.orderBy??[]);
  captureColumns=new Map();$('acquisition').hidden=false;$('acquisition-title').textContent=value.title;
  $('acquisition-source').textContent=value.source.server+' · '+sourceLabel(value.source)+' · '+when(value.receivedAt);
  $('capture-title').value=value.title;renderOrders();
  $('provider-order-detail').textContent='Provider tie break: native row order, then row ID.'+
    (value.source.kind==='public-grid'?' Select the intended field sorts below; the saved grid display sorts are shown for reference.':'');
  $('saved-grid-sorts').textContent=value.originalOrder?.publicViewSortings?JSON.stringify(value.originalOrder.publicViewSortings,null,2):'No saved public-grid sort metadata.';
  const fields=[{id:'$recordId',title:'Native row ID',type:'RecordIdentity'},
    {id:'$order',title:'Native row order',type:'RecordOrder'},...value.fields.map(nativeField)];
  fieldTable($('capture-fields'),fields,captureColumns,()=>{});
}
function renderOrders(){
  const list=$('source-order');list.replaceChildren();for(const [index,order]of sourceOrders.entries()){
    const row=node('div',null,'order-row'),label=node('label','Actual field');
    const choices=metadata.fields.map(f=>[f.id,f.name+' · field_'+f.id]);
    const field=selectInput(choices,order.field,v=>{order.field=Number(v);});label.append(field);
    const direction=node('label','Direction');direction.append(selectInput(['asc','desc'],order.direction,v=>{order.direction=v;}));
    row.append(label,direction,button('Remove',()=>{sourceOrders.splice(index,1);renderOrders();}));list.append(row);
  }
}
function fullValue(value){
  if(!value)return node('span','Missing');
  const content=value.value===null?'null':String(value.value);
  if(content.length<=180)return description(content,value.kind);
  const detail=node('details');detail.append(node('summary',content.slice(0,180)+'… · '+value.kind),node('pre',content));return detail;
}
function renderCaptureRows(){
  $('row-inspection').hidden=!rowsPage;if(!rowsPage)return;
  table($('capture-rows'),rowsPage.fields.map(f=>f.name+' · '+f.key),
    rowsPage.records.map(row=>rowsPage.fields.map(f=>fullValue(row.values[f.key]))));
  pager('rows',rowsPage.offset,rowsPage.total);
}
function renderCaptureFiles(){
  $('attachment-inspection').hidden=!filesPage;if(!filesPage)return;
  $('attachment-summary').textContent=filesPage.complete?filesPage.total+' original files retained with this capture.':
    'This capture retains file metadata. Select file retention for a new observation to keep its original bytes.';
  table($('capture-files'),['File','Bytes / SHA256','Row references','Actions'],filesPage.files.map(file=>[
    description(file.storageName,file.mimeType),description(file.bytes,file.sha256),
    file.referenceCount,button('Download file',()=>readAction(()=>download('/api/capture-file?'+new URLSearchParams({
      id:filesPage.captureId,file:file.file,manifestSha256:filesPage.manifestSha256,sha256:file.sha256,
    }),{...file,manifestSha256:filesPage.manifestSha256}))),
  ]));pager('files',filesPage.offset,filesPage.total);
}
async function loadDraft(value,currentRevision){
  const epoch=++renderEpoch;const loaded=await api('/api/capture?id='+encodeURIComponent(value.captureId));
  if(epoch!==renderEpoch)return;captureView=loaded;draft=clone(value);draftRevision=currentRevision;dirty=JSON.stringify(value)!==JSON.stringify(state.draft);revision++;
  $('draft-title').value=draft.title;$('draft-editor').hidden=false;queryName=Object.keys(draft.queries)[0];renderQuery();
  $('draft-state').textContent=(dirty?'Unsaved selection based on draft ':'Draft revision ')+draftRevision+' · '+loaded.capture.rowCount+' complete rows · '+loaded.capture.pageCount+' original pages';
  $('capture-binding').textContent=loaded.capture.selection.server+' · '+sourceLabel(loaded.capture.selection)+
    ' · Capture '+loaded.capture.manifestSha256+' · Provider sorts '+
    (loaded.capture.selection.orderBy.map(o=>'field_'+o.field+' '+o.direction).join(', ')||'native order')+
    ' · '+loaded.capture.attachmentCount+' retained files / '+loaded.capture.attachmentBytes+' bytes';
  rowsPage=loaded.rows;filesPage=loaded.files;renderCaptureRows();renderCaptureFiles();
  preview=!dirty&&state.preview?.draftRevision===draftRevision&&state.draft?.captureId===draft.captureId?state.preview:null;renderPreview();tab('review');
}
function flushQuery(){if(draft&&queryName)draft.queries[queryName]={columns:columnsFrom(editorColumns)};}
function renderQuery(){
  const s=$('query-select');s.replaceChildren();for(const name of Object.keys(draft.queries)){const o=node('option',name);o.value=name;s.append(o);}s.value=queryName;$('query-name').value=queryName;
  editorColumns=mapFrom(captureView.fields,draft.queries[queryName].columns);fieldTable($('draft-fields'),captureView.fields,editorColumns,change);
}
function renderPreview(){
  const out=$('preview');out.replaceChildren();out.hidden=!preview;
  $('save-version').disabled=!preview||dirty||preview.draftRevision!==draftRevision;
  $('preview-draft').disabled=dirty||!draft;
  if(!preview)return;out.append(node('h3','Complete row validation'),node('p','Every configured scalar in every captured row was validated through the original source reader. Samples below show at most 25 rows per query.','help'));
  for(const [name,value]of Object.entries(preview.reports)){out.append(node('h4',name+' · '+value.report.rowCount+' rows'));const wrap=node('div',null,'table-wrap');
    const sample=value.sample,keys=sample.length?Object.keys(sample[0]):Object.keys(draft.queries[name].columns);
    table(wrap,keys,sample.map(row=>keys.map(k=>shown(row[k]))));out.append(wrap);}
}
function renderPublisher(){
  if(!state)return;
  $('publisher-state').textContent='Selected source version: '+(state.selectedVersion??'none')+'. Publisher '+(state.publisher.running?'running':'stopped')+'. Dataset directory: '+state.publisher.targetDirectory;
  $('publisher-link').hidden=!state.publisher.url;if(state.publisher.url)$('publisher-link').href=state.publisher.url;
  $('open-publisher').disabled=state.selectedVersion===null;$('stop-publisher').disabled=!state.publisher.running;
  if(state.selectedVersion!==null&&!$('deployment-version').value)$('deployment-version').value=state.selectedVersion;
}


async function refreshDeployment(){
  deployment=await api('/api/deployment/status?'+new URLSearchParams({operationsOffset:deploymentOffset,limit}));
  table($('published-runs'),['Published extraction','Source version','State / snapshot','Actions'],(deployment.publisher?.runs??[]).map(r=>[
    description(r.id,r.dataset?.name??''),r.sourceVersions.map(v=>'v'+v.id).join(', ')||'Other retained source',description(r.state,r.publication?.snapshot??'Not published'),
    button('Use this publication',()=>{if(!r.publication)throw new Error('Review and publish this candidate in the original publisher first.');$('deployment-run').value=r.id;if(r.sourceVersions.length)$('deployment-version').value=r.sourceVersions[0].id;})
  ]));
  table($('deployment-packages'),['Original request','Action / state','Source / snapshot','Actions'],deployment.operations.map(o=>{
    const r=o.result,buttons=[];
    if(o.status==='complete'&&o.kind==='DEPLOYMENT_REVIEW')buttons.push(button('Use review',()=>{deploymentReview=r;renderDeploymentReview();}));
    if(o.status==='complete'&&o.kind==='DEPLOYMENT_PREPARE'){
      buttons.push(button('Use package',()=>{$('stage-package').value=o.id;$('stage-sha').value=r.sourceSha256;}));
      for(const f of r.files??[])buttons.push(button('Download '+f.file,()=>readAction(()=>download('/api/deployment/file?'+new URLSearchParams({packageId:o.id,file:f.file})))));
    }
    buttons.push(button('Receipt',()=>{$('release-state').replaceChildren(jsonView(o));}));
    return[node('code',o.id),description(o.kind,o.status),description(short(r?.sourceSha256??r?.reviewSha256),r?.dataset?.baselineSnapshot??r?.snapshot??''),actions(...buttons)];
  }));
  pager('deploy',deploymentOffset,deployment.pages.operationsTotal);
  const running=deployment.console?.running; $('release-link').hidden=!running;
  if(running)$('release-link').href=deployment.console.url;
  $('close-release-console').disabled=!running;
  $('release-state').replaceChildren(node('p',running?'Original release console is running.':'Original release console is stopped.','help'));
  if(deployment.native)$('release-state').append(jsonView(deployment.native));
}
function renderDeploymentReview(){
  const out=$('deployment-review');out.replaceChildren();out.hidden=!deploymentReview;
  $('prepare-deployment').disabled=!deploymentReview;
  if(deploymentReview)out.append(node('h4','Reviewed original publication'),jsonView(deploymentReview));
}
function guarded(action){return async event=>{event?.preventDefault();if(busy||pending)return;try{await action();}catch(issue){notice(errorMessage(issue),true);}};}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>tab(b.dataset.view));
$('refresh').addEventListener('click',guarded(()=>readAction(()=>refresh())));
$('load-current-draft').addEventListener('click',guarded(()=>readAction(async()=>{await refresh();if(state.draft)await loadDraft(state.draft,state.draftRevision);})));
$('connection').addEventListener('change',renderConnection);
$('attachment-mode').addEventListener('change',()=>{$('attachment-options').hidden=$('attachment-mode').value!=='retain';});
$('discover-form').addEventListener('submit',guarded(()=>{
  const connection=state.connections.find(c=>c.alias===$('connection').value);
  if(!connection)throw new Error('Select the host connection.');
  return mutate('/api/discover',{connectionAlias:connection.alias,
    slug:connection.kind==='public-grid'?$('public-slug').value.trim():null,
    tableId:connection.kind==='table'?Number($('table-id').value):null,
    viewId:connection.kind==='table'&&$('view-id').value.trim()?Number($('view-id').value):null,
    filters:$('source-filters').value.trim()?JSON.parse($('source-filters').value):null,
    search:$('query-search').value||null},'Inspect Baserow metadata');
}));
$('add-order').addEventListener('click',guarded(()=>{
  if(sourceOrders.length>=8)throw new Error('The original source supports at most eight stable-order fields.');
  const next=metadata.fields.find(f=>!sourceOrders.some(o=>o.field===f.id));
  if(!next)throw new Error('All available order fields are already selected.');
  sourceOrders.push({field:next.id,direction:'asc'});renderOrders();
}));
$('capture-live').addEventListener('click',guarded(async()=>{
  const name=$('capture-query').value.trim();
  if(!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name))throw new Error('Use a valid query name.');
  const columns=columnsFrom(captureColumns);
  await mutate('/api/capture',{discoveryId:metadata.id,connectionAlias:metadata.connectionAlias,orderBy:clone(sourceOrders),attachments:attachmentPolicy(),
    queries:{[name]:{columns}},title:$('capture-title').value.trim(),expectedDraftRevision:state.draftRevision},'Capture complete Baserow observation');
}));
async function readUpload(file){
  if(!file||file.size<1||file.size>553648128)throw new Error('Choose a complete source packet within the supported 528 MiB transport limit.');
  const data=await file.arrayBuffer(), text=new TextDecoder('utf-8',{fatal:true}).decode(data),packet=JSON.parse(text);
  if(packet.schema!=='stellar-forge.baserow-source-packet.v1')throw new Error('This is not an original Baserow source packet.');
  return{packet,file:{name:file.name,bytes:file.size,sha256:await sha(data)}};
}
$('import-file').addEventListener('change',guarded(async()=>{
  const file=$('import-file').files[0],epoch=++revision;upload=null;
  const value=await readUpload(file);if(epoch!==revision)return;upload=value;
  $('import-summary').textContent=file.name+' · '+file.size+' bytes · '+sourceLabel(value.packet.source);
}));
$('import-form').addEventListener('submit',guarded(async()=>{
  if(!upload)throw new Error('Wait for the complete selected packet to be read.');
  await mutate('/api/import-package',{packet:upload.packet,title:$('import-title').value.trim(),expectedDraftRevision:state.draftRevision},'Import original complete source',upload.file);
}));
$('draft-title').addEventListener('input',()=>{if(!busy&&!pending)change();});
$('query-select').addEventListener('change',guarded(()=>{flushQuery();queryName=$('query-select').value;renderQuery();}));
$('rename-query').addEventListener('click',guarded(()=>{
  flushQuery();const next=$('query-name').value.trim();
  if(!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(next)||['constructor','prototype','__proto__'].includes(next))throw new Error('Use a valid query name.');
  if(next!==queryName&&Object.hasOwn(draft.queries,next))throw new Error('That query name already exists.');
  if(next!==queryName){draft.queries=Object.fromEntries(Object.entries(draft.queries).map(([n,q])=>[n===queryName?next:n,q]));queryName=next;change();renderQuery();}
}));
$('add-query').addEventListener('click',guarded(()=>{
  flushQuery();if(Object.keys(draft.queries).length>=32)throw new Error('The original source supports at most 32 queries.');
  let i=1;while(Object.hasOwn(draft.queries,'query_'+i))i++;
  const cols={};for(const [index,field]of captureView.fields.entries()){const v=defaultSpec(field,index);v.enabled=true;const {alias:name,enabled:ignored,...spec}=v;cols[name]=spec;}
  queryName='query_'+i;draft.queries[queryName]={columns:cols};change();renderQuery();
}));
$('remove-query').addEventListener('click',guarded(()=>{
  flushQuery();if(Object.keys(draft.queries).length===1)throw new Error('Keep at least one configured query.');
  delete draft.queries[queryName];queryName=Object.keys(draft.queries)[0];change();renderQuery();
}));
$('save-draft').addEventListener('click',guarded(async()=>{
  flushQuery();draft.title=$('draft-title').value.trim();
  await mutate('/api/draft',{draft:clone(draft),expectedRevision:draftRevision},'Save source draft');
}));
$('preview-draft').addEventListener('click',guarded(async()=>{
  if(dirty)throw new Error('Save the edited draft before validating it.');
  await mutate('/api/preview',{draftRevision},'Validate complete source projection');
}));
$('save-version-form').addEventListener('submit',guarded(async()=>{
  if(dirty||!preview)throw new Error('Save and validate this exact draft first.');
  await mutate('/api/version',{draftRevision,previewId:preview.id,reviewer:$('reviewer').value.trim(),
    note:$('change-note').value.trim(),expectedSelectedVersion:state.selectedVersion},'Freeze reviewed source version');
}));
$('compare-form').addEventListener('submit',guarded(()=>readAction(async()=>{
  const result=await api('/api/compare?'+new URLSearchParams({left:$('compare-left').value,right:$('compare-right').value})),out=$('comparison');out.replaceChildren();
  out.append(node('h3','v'+result.left.id+' → v'+result.right.id),node('p','Same capture: '+result.sameObservation+' · Same source selection: '+result.sameSelection+' · Same projection: '+result.sameProjection,'help'));
  for(const q of result.queries){out.append(node('h4',q.name));const wrap=node('div',null,'table-wrap');table(wrap,['Alias','Earlier','Later','Change'],q.columns.map(c=>[c.alias,shown(c.before),shown(c.after),c.status]));out.append(wrap);}
})));
$('open-publisher').addEventListener('click',guarded(()=>mutate('/api/publisher/start',{expectedSelectedVersion:state.selectedVersion},'Open original publisher')));
$('stop-publisher').addEventListener('click',guarded(()=>mutate('/api/publisher/stop',{},'Close original publisher')));
$('refresh-deploy').addEventListener('click',guarded(()=>readAction(refreshDeployment)));
$('deployment-review-form').addEventListener('submit',guarded(()=>mutate('/api/deployment/review',{
  versionId:Number($('deployment-version').value),runId:$('deployment-run').value.trim(),
  terms:JSON.parse($('deployment-terms').value)},'Review original merchant release')));
$('prepare-deployment').addEventListener('click',guarded(()=>{
  if(!deploymentReview)throw new Error('Select a completed original deployment review.');
  return mutate('/api/deployment/prepare',{reviewRequestId:deploymentReview.reviewRequestId,
    expectedReviewSha256:deploymentReview.reviewSha256},'Prepare original deployment package');
}));
$('stage-form').addEventListener('submit',guarded(()=>mutate('/api/deployment/stage',{
  packageRequestId:$('stage-package').value.trim(),expectedSourceSha256:$('stage-sha').value.trim(),
  id:$('stage-id').value.trim(),label:$('stage-label').value.trim(),runtime:{port:0}},'Stage original release')));
$('open-release-console').addEventListener('click',guarded(()=>mutate('/api/deployment/console/open',{},'Open original release controls')));
$('close-release-console').addEventListener('click',guarded(()=>{
  if(!deployment?.console?.instanceId)throw new Error('Refresh the running original console first.');
  return mutate('/api/deployment/console/close',{instanceId:deployment.console.instanceId},'Close original release controls');
}));
for(const [name,current,path,render]of [
  ['rows',()=>rowsPage,'/api/capture-rows',renderCaptureRows],
  ['files',()=>filesPage,'/api/capture-files',renderCaptureFiles],
])for(const [suffix,direction]of [['prev',-1],['next',1]])$(name+'-'+suffix).addEventListener('click',guarded(()=>readAction(async()=>{
  const page=current(),captureId=captureView?.capture.id;if(!page||!captureId)return;
  const value=await api(path+'?'+new URLSearchParams({id:captureId,offset:Math.max(0,page.offset+direction*limit),limit}));
  if(captureView?.capture.id!==captureId)return;
  if(name==='rows')rowsPage=value;else filesPage=value;render();
})));
for(const [name,get,set]of [
  ['captures',()=>capturesOffset,v=>{capturesOffset=v;}],['versions',()=>versionsOffset,v=>{versionsOffset=v;}],
  ['discoveries',()=>discoveriesOffset,v=>{discoveriesOffset=v;}],['deploy',()=>deploymentOffset,v=>{deploymentOffset=v;}],
])for(const [suffix,delta]of [['prev',-limit],['next',limit]])$(name+'-'+suffix).addEventListener('click',guarded(()=>readAction(async()=>{
  set(Math.max(0,get()+delta));if(name==='deploy')await refreshDeployment();else await refresh();
})));
$('check-operation').addEventListener('click',()=>checkReceipt());
$('resume-operation').addEventListener('click',async()=>{
  if(!pending||busy||recovering)return;recovering=true;lock();
  try{const marker=pending,result=await api('/api/resume',{body:{requestId:marker.requestId}});await finish(result,marker);}
  catch(issue){notice(errorMessage(issue),true);const reply=await api('/api/operation?id='+pending.requestId).catch(()=>null);if(reply){known=reply.operation;showRecovery();}}
  finally{recovering=false;lock();}
});
$('retry-file').addEventListener('change',async()=>{
  if(!pending||busy||recovering)return;
  try{const value=await readUpload($('retry-file').files[0]);if(value.file.bytes!==pending.file.bytes||value.file.sha256!==pending.file.sha256)throw new Error('Reselect the exact original packet bytes.');
    const payload={...pending.small,packet:value.packet,requestId:pending.requestId};
    if(await bodyHash(payload)!==pending.bodySha256)throw new Error('The retained request payload differs. Keep this original request for receipt lookup.');
    retryPayload=payload;showRecovery();
  }catch(issue){notice(errorMessage(issue),true);}
});
$('retry-operation').addEventListener('click',async()=>{
  if(!pending||busy||recovering)return;recovering=true;lock();
  try{const body=retryPayload??pending.small;
    if(!body||await bodyHash(body)!==pending.bodySha256)throw new Error('The identical input is not available. Reselect its original packet or inspect the receipt.');
    const marker=pending,result=await api(marker.path,{body});await finish(result,marker);
  }catch(issue){notice(errorMessage(issue),true);if(pending){const r=await api('/api/operation?id='+pending.requestId).catch(()=>null);if(r){known=r.operation;showRecovery();}}}
  finally{recovering=false;lock();}
});
$('dismiss-operation').addEventListener('click',async()=>{
  if(!pending||busy||recovering||known?.status!=='failed')return;
  const original=pending.requestId;forget();await refresh().catch(issue=>notice(errorMessage(issue),true));
  notice('Recorded failure acknowledged. Original request '+original+' and its retained files remain in the workspace.');
});
try{
  await refresh();
  const active=sessionStorage.getItem(activeKey(state.directory));
  if(active){try{pending=JSON.parse(localStorage.getItem(markerPrefix(state.directory)+active));}catch{}}
  if(pending){retryPayload=pending.file?null:pending.small;showRecovery();await checkReceipt();}
  else if(state.draft)await loadDraft(state.draft,state.draftRevision);
}catch(issue){notice(errorMessage(issue),true);lock();}

