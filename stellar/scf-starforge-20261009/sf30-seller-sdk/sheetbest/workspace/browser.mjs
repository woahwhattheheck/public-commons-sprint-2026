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
const tokenKey = 'stellar.sheetbest.authoring.token';
let token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(tokenKey);
let state = null, busy = false, pending = null, retryPayload = null, known = null, recovering = false;
let editorOrders = [], editorColumns = new Map(), captureView = null, fieldOffset = 0;
let draft = null, draftRevision = 0, dirty = false, queryName = null, preview = null, upload = null;
let revision = 0, renderEpoch = 0, deployment = null, deploymentReview = null;
let capturesOffset = 0, versionsOffset = 0, deploymentOffset = 0;
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
const markerPrefix = directory => 'stellar.sheetbest.pending.v1:' + directory + ':';
const activeKey = directory => 'stellar.sheetbest.active.v1:' + directory;
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
      headers: { 'x-sheetbest-workspace-token': token || '', ...(options.body === undefined ? {} : { 'content-type':'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), cache:'no-store', signal:control.signal });
    if (options.binary && response.ok) return { data: await response.blob(),
      filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'sheetbest-source.json' };
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || result.error || response.statusText), { code: result.error, status: response.status });
    return result;
  } catch (issue) { if (!issue.status) issue.uncertain = true; throw issue; }
  finally { clearTimeout(timeout); }
}
async function refresh({ loadCurrentDraft = false } = {}) {
  const epoch = ++renderEpoch, editing = revision;
  const latest = await api('/api/status?' + new URLSearchParams({capturesOffset,versionsOffset,limit}));
  if (epoch !== renderEpoch) return state;
  state = latest; renderState();
  if (loadCurrentDraft && latest.draft && editing === revision) await loadDraft(latest.draft, latest.draftRevision);
  return latest;
}
async function finish(result, marker) {
  // Retain the same request marker through a failed status read or view refresh.
  await refresh();
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
async function download(path) {
  const file = await api(path, { binary:true }), url = URL.createObjectURL(file.data);
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
  const choice=$('connection'),old=choice.value;choice.replaceChildren(node('option','Select connection'));choice.firstChild.value='';
  for(const c of state.connections){const o=node('option',c.label+' · '+(c.tab||'default tab')+' · '+c.valueMode+' · '+c.state);o.value=c.alias;choice.append(o);}if(state.connections.some(c=>c.alias===old))choice.value=old;
  $('connection-help').textContent=state.connections.length?'API key values remain on this host. The browser selects only these declared connection aliases.':'No live read connection is declared. Import a complete source packet, or restart with the private connections file described in WORKSPACE.md.';
  table($('captures'),['Observation','Rows','Original connection','Received','Actions'],state.captures.map(c=>[
    description(c.title,short(c.manifestSha256)),c.rowCount,
    description(c.selection.connectionId,(c.selection.tab||'Default tab')+' · '+c.selection.valueMode),when(c.receivedAt),
    actions(button('Review',()=>readAction(()=>loadDraft(c.draft,state.draftRevision))),button('Private packet',()=>readAction(()=>download('/api/export-capture?id='+c.id))))]));
  pager('captures',capturesOffset,state.pages.capturesTotal);
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
function defaultSpec(field,index){
  return{alias:alias(field.title,index),enabled:false,source:field.id,type:'string',nullable:false,empty:'preserve'};
}
function selectInput(values,value,changed){
  const input=node('select');for(const item of values){const [v,label]=Array.isArray(item)?item:[item,item];const o=node('option',label);o.value=v;input.append(o);}input.value=value;input.addEventListener('change',()=>{if(!busy&&!pending)changed(input.value);});return input;
}
function fieldTable(parent,fields,map,onChange){
  for(const [index,f]of fields.entries())if(!map.has(f.id))map.set(f.id,defaultSpec(f,index));
  const term=$('field-filter').value.toLowerCase();
  const available=fields.filter(f=>f.title.toLowerCase().includes(term));
  fieldOffset=Math.min(fieldOffset,Math.max(0,Math.floor((available.length-1)/50)*50));
  const displayed=available.slice(fieldOffset,fieldOffset+50);
  $('field-page').textContent=(available.length?fieldOffset+1:0)+'–'+Math.min(fieldOffset+50,available.length)+' of '+available.length+' source fields';
  $('field-prev').disabled=fieldOffset===0;$('field-next').disabled=fieldOffset+50>=available.length;
  table(parent,['Publish','Original field / observed values','Public alias','Scalar type','Nulls','Empty strings'],displayed.map(f=>{
    const spec=map.get(f.id);
    const supported=f.id.length<=512&&!/[\u0000-\u001f]/.test(f.id)&&!['constructor','prototype','__proto__'].includes(f.id);
    const check=node('input');check.type='checkbox';check.checked=spec.enabled;check.disabled=!supported;check.setAttribute('aria-label','Publish '+f.title);
    check.addEventListener('change',()=>{if(!busy&&!pending){spec.enabled=check.checked;onChange();}});
    const details=description(f.title,supported?'Exact original key':'This key cannot be selected by the original source declaration');
    if(f.counts){details.append(node('small',Object.entries(f.counts).filter(([,n])=>n).map(([k,n])=>k+' '+n).join(' · ')));
      details.append(node('small',(f.samples??[]).map(s=>s.kind+': '+shown(s.value)).join(' | ')));}
    const name=node('input');name.value=spec.alias;name.maxLength=48;name.setAttribute('aria-label','Public alias for '+f.title);
    name.addEventListener('input',()=>{if(!busy&&!pending){spec.alias=name.value;onChange();}});
    const type=selectInput(['string','integer','number','boolean'],spec.type,v=>{spec.type=v;onChange();});type.setAttribute('aria-label','Scalar type for '+f.title);
    const nullable=selectInput([['false','Required'],['true','Allow null']],String(spec.nullable),v=>{spec.nullable=v==='true';onChange();});nullable.setAttribute('aria-label','Null policy for '+f.title);
    const empty=selectInput([['preserve','Preserve'],['null','Use null']],spec.empty,v=>{spec.empty=v;onChange();});empty.setAttribute('aria-label','Empty string policy for '+f.title);
    return[check,details,name,type,nullable,empty];
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
function renderOrders(){
  const list=$('query-order');list.replaceChildren();
  const choices=[...editorColumns.values()].filter(s=>s.enabled).map(s=>[s.alias,s.alias]);
  for(const [index,order]of editorOrders.entries()){
    const row=node('div',null,'order-row'),label=node('label','Published column');
    const options=choices.some(([name])=>name===order.column)?choices:[[order.column,order.column+' · no longer selected'],...choices];
    label.append(selectInput(options,order.column,v=>{order.column=v;change();}));
    const direction=node('label','Direction');direction.append(selectInput(['asc','desc'],order.direction,v=>{order.direction=v;change();}));
    row.append(label,direction,button('Remove',()=>{editorOrders.splice(index,1);change();renderOrders();}));list.append(row);
  }
}
async function loadDraft(value,currentRevision){
  const epoch=++renderEpoch,editing=++revision;
  const loaded=await api('/api/capture?id='+encodeURIComponent(value.captureId));
  if(epoch!==renderEpoch||editing!==revision)return;
  captureView=loaded;draft=clone(value);draftRevision=currentRevision;
  draft.orders??={};dirty=JSON.stringify(value)!==JSON.stringify(state.draft);
  if(!Object.keys(draft.queries).length){draft.queries={catalog:{columns:{}}};draft.orders={catalog:[]};dirty=true;}
  $('draft-title').value=draft.title;$('draft-editor').hidden=false;queryName=Object.keys(draft.queries)[0];fieldOffset=0;renderQuery();
  $('draft-state').textContent=(dirty?'Unsaved projection based on draft ':'Draft revision ')+draftRevision+' · '+loaded.capture.rowCount+' original records';
  $('capture-binding').textContent=loaded.capture.selection.connectionId+' · '+(loaded.capture.selection.tab||'Default tab')+' · '+loaded.capture.selection.valueMode+
    ' · Capture '+loaded.capture.manifestSha256+' · Source records '+loaded.capture.sourceSha256;
  preview=!dirty&&state.preview?.draftRevision===draftRevision&&state.draft?.captureId===draft.captureId?state.preview:null;renderPreview();tab('review');
}
function flushQuery(){if(draft&&queryName){draft.queries[queryName]={columns:columnsFrom(editorColumns)};draft.orders[queryName]=clone(editorOrders);}}
function renderQuery(){
  const s=$('query-select');s.replaceChildren();for(const name of Object.keys(draft.queries)){const o=node('option',name);o.value=name;s.append(o);}s.value=queryName;$('query-name').value=queryName;
  editorColumns=mapFrom(captureView.fields,draft.queries[queryName].columns);editorOrders=clone(draft.orders[queryName]??[]);
  fieldTable($('draft-fields'),captureView.fields,editorColumns,()=>{change();renderOrders();});renderOrders();
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
$('capture-form').addEventListener('submit',guarded(()=>mutate('/api/capture',{
  connectionAlias:$('connection').value,title:$('capture-title').value.trim(),expectedDraftRevision:state.draftRevision
},'Read one complete Sheet Best records response')));
$('add-order').addEventListener('click',guarded(()=>{
  const columns=columnsFrom(editorColumns),next=Object.keys(columns).find(name=>!editorOrders.some(o=>o.column===name));
  if(!next)throw new Error('Select a public column that is not already in the order.');
  editorOrders.push({column:next,direction:'asc'});change();renderOrders();
}));
$('field-filter').addEventListener('input',()=>{if(!busy&&!pending){fieldOffset=0;fieldTable($('draft-fields'),captureView.fields,editorColumns,()=>{change();renderOrders();});}});
for(const [id,amount]of [['field-prev',-50],['field-next',50]])$(id).addEventListener('click',guarded(()=>{
  fieldOffset=Math.max(0,fieldOffset+amount);fieldTable($('draft-fields'),captureView.fields,editorColumns,()=>{change();renderOrders();});
}));
async function readUpload(file){
  if(!file||file.size<1||file.size>135266304)throw new Error('Choose a complete source packet within the supported 129 MiB transport limit.');
  const data=await file.arrayBuffer(), text=new TextDecoder('utf-8',{fatal:true}).decode(data),packet=JSON.parse(text);
  if(packet.schema!=='stellar-forge.sheetbest-source-packet.v1')throw new Error('This is not an original SheetBest source packet.');
  return{packet,file:{name:file.name,bytes:file.size,sha256:await sha(data)}};
}
$('import-file').addEventListener('change',guarded(async()=>{
  const file=$('import-file').files[0],epoch=++revision;upload=null;
  const value=await readUpload(file);if(epoch!==revision)return;upload=value;
  $('import-summary').textContent=file.name+' · '+file.size+' bytes · '+value.packet.source.connectionId+' · '+(value.packet.source.tab||'Default tab');
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
  if(next!==queryName){draft.queries=Object.fromEntries(Object.entries(draft.queries).map(([n,q])=>[n===queryName?next:n,q]));draft.orders=Object.fromEntries(Object.entries(draft.orders).map(([n,q])=>[n===queryName?next:n,q]));queryName=next;change();renderQuery();}
}));
$('add-query').addEventListener('click',guarded(()=>{
  flushQuery();if(Object.keys(draft.queries).length>=32)throw new Error('The original source supports at most 32 queries.');
  let i=1;while(Object.hasOwn(draft.queries,'query_'+i))i++;
  queryName='query_'+i;draft.queries[queryName]={columns:{}};draft.orders[queryName]=[];change();renderQuery();
}));
$('remove-query').addEventListener('click',guarded(()=>{
  flushQuery();if(Object.keys(draft.queries).length===1)throw new Error('Keep at least one configured query.');
  delete draft.queries[queryName];delete draft.orders[queryName];queryName=Object.keys(draft.queries)[0];change();renderQuery();
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
  out.append(node('h3','v'+result.left.id+' → v'+result.right.id),node('p','Same capture: '+result.sameObservation+' · Same source selection: '+result.sameSelection+' · Same projection: '+result.sameProjection+' · Same extraction order: '+result.sameOrder,'help'));
  out.append(jsonView(result.orders));
  for(const q of result.queries){out.append(node('h4',q.name));const wrap=node('div',null,'table-wrap');table(wrap,['Alias','Earlier','Later','Change'],q.columns.map(c=>[c.alias,shown(c.before),shown(c.after),c.status]));out.append(wrap);}
})));
$('publisher-plan-form').addEventListener('submit',guarded(()=>readAction(async()=>{
  if(state.selectedVersion===null)throw new Error('Select a reviewed source version first.');
  const result=await api('/api/publisher/plan?'+new URLSearchParams({id:state.selectedVersion,query:$('publisher-query').value}));
  $('publisher-plan').replaceChildren(node('h4','Original publisher plan input'),jsonView(result.plan));
  const content=new Blob([JSON.stringify(result.plan,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(content),a=node('a','Download reviewed plan input');a.href=url;a.download='sheetbest-plan-v'+state.selectedVersion+'.json';
  a.addEventListener('click',()=>setTimeout(()=>URL.revokeObjectURL(url),1000));$('publisher-plan').append(a);
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
for(const [name,get,set]of [
  ['captures',()=>capturesOffset,v=>{capturesOffset=v;}],['versions',()=>versionsOffset,v=>{versionsOffset=v;}],
['deploy',()=>deploymentOffset,v=>{deploymentOffset=v;}],
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

