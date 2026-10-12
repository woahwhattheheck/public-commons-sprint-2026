/* MIT. Connector intake, mapping review and recovery in the existing merchant workspace. */
(() => {
  'use strict';
  const root = document.getElementById('sf104-kcf'), C = window.SF104KCF;
  if (!root || !C) return;
  const main = document.getElementById('kcf-content'), dialog = document.getElementById('kcf-dialog');
  const S = {status:null,installationPage:1,installationChoice:'',iid:'',installation:null,head:null,view:'sources',busy:false,message:'',error:false,
    pages:{receipts:1,editions:1,recipes:1,reviews:1,links:1,imports:1},lists:{},receiptCache:new Map(),edition:null,
    capture:{slot:'',format:'json',delimiter:',',screen:'',reference:'',observedAt:'',note:'',family:'configuration',coverage:'UNKNOWN',selection:'ALL',ids:'',filter:'',window:'',activeSelection:'',rowPointer:'',identityPointers:'',fields:[]},
    upload:null,reuseReceiptId:'',selectedReceipts:new Set(),selectionDirty:false,editionLabel:'',editionReason:'',metadata:null,
    draft:null,recipe:null,preview:null,assignmentPage:1,previewPage:1,subPage:{countries:1,states:1},impacts:null,impactPage:1,
    comparison:null,compareBefore:'',compareAfter:'',compareChange:'all',compareQ:'',comparePage:1,reviewReason:'',reviewDisposition:'RETAIN_MAPPING',
    includeOrders:true,pending:null,importFile:null,editor:null,browser:null};
  const D = new Map(); let detailSerial = 0;
  const e = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = v => JSON.parse(JSON.stringify(v));
  const json = v => JSON.stringify(v,null,2);
  const idShort = v => v ? String(v).slice(0,12) : '—';
  const label = v => String(v ?? '').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
  const option = (values,current) => values.map(v=>{const a=Array.isArray(v)?v:[v,label(v)];return '<option value="'+e(a[0])+'"'+(a[0]===current?' selected':'')+'>'+e(a[1])+'</option>';}).join('');
  const dis = yes => yes || S.busy ? ' disabled' : '';
  const input = (name,title,value,help='',attrs='') => '<label>'+e(title)+'<input name="'+e(name)+'" value="'+e(value)+'" '+attrs+'>'+ (help?'<small>'+e(help)+'</small>':'')+'</label>';
  const area = (name,title,value,help='',attrs='') => '<label>'+e(title)+'<textarea name="'+e(name)+'" '+attrs+'>'+e(value)+'</textarea>'+(help?'<small>'+e(help)+'</small>':'')+'</label>';
  const select = (name,title,values,value,help='') => '<label>'+e(title)+'<select name="'+e(name)+'">'+option(values,value)+'</select>'+(help?'<small>'+e(help)+'</small>':'')+'</label>';
  const check = (name,title,on) => '<label class="kcf-check"><input type="checkbox" name="'+e(name)+'"'+(on?' checked':'')+'>'+e(title)+'</label>';
  const badge = v => '<span class="kcf-badge">'+e(label(v))+'</span>';
  const note = s => '<div class="kcf-note">'+e(s)+'</div>';
  const empty = s => '<div class="kcf-empty">'+e(s)+'</div>';
  const table = (head,rows) => '<div class="kcf-table"><table><thead><tr>'+head.map(x=>'<th scope="col">'+e(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  const row = cells => '<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
  const button = (action,title,attrs='',blocked=false) => '<button type="button" data-action="'+action+'" '+attrs+dis(blocked)+'>'+e(title)+'</button>';
  const details = (title,value) => { const key=String(++detailSerial); D.set(key,value); if(D.size>600)D.delete(D.keys().next().value); return '<details data-detail="'+key+'"><summary>'+e(title)+'</summary><div></div></details>'; };
  const bytes = n => n === null || n === undefined ? '—' : Number(n).toLocaleString()+' B';
  const lines = text => String(text || '').split(/\r?\n/).filter(x=>x !== '');
  const escPointer = s => '/'+s.replaceAll('~','~0').replaceAll('/','~1');
  const newOp = () => 'connector-'+crypto.randomUUID();
  const basePath = () => '/installations/'+S.iid;
  const nativeLink = (params,title) => {const u=new URL(C.erpUrl,location.href);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);return '<a class="kcf-button" href="'+e(u.href)+'">'+e(title)+'</a>';};
  const typed = n => {
    if(!n)return '—';
    if(n.type==='missing')return '<span class="help">Not observed</span>';
    if(n.type==='null')return '<code>null</code>';
    if(['object','array'].includes(n.type))return '<span class="help">'+e(n.type)+' · '+(n.children??n.value?.length??0)+' values</span>';
    const v=String(n.value);return '<span class="mono" title="'+e(v)+'">'+e(v.length>130?v.slice(0,130)+'…':v)+'</span> <span class="help">'+e(n.type)+'</span>';
  };
  const ruleLabel = r => {
    if(!r)return 'Choose value';
    if(Object.hasOwn(r,'constant'))return r.constant.type==='string'?(r.constant.value===''?'Empty string':String(r.constant.value)):r.constant.type+': '+String(r.constant.value);
    return idShort(r.receiptId)+' '+(r.pointer || '(root)');
  };
  function pager(key,record) {
    const page=record?.page??1,total=record?.total??0,limit=record?.limit??50;
    return '<div class="kcf-pager"><span>'+total.toLocaleString()+' records · Page '+page+' of '+Math.max(1,Math.ceil(total/limit))+'</span>'+button('page','Previous','data-list="'+key+'" data-delta="-1"',page<=1)+button('page','Next','data-list="'+key+'" data-delta="1"',page*limit>=total)+'</div>';
  }
  async function api(path,body,base=C.api) {
    const u=new URL(base,location.href);
    if(u.origin!==location.origin)throw Error('The REST address must use this WordPress administrator origin.');
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),90000);
    try {
      const res=await fetch(u.href.replace(/\/$/,'')+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',signal:ctrl.signal,
        headers:{Accept:'application/json','X-WP-Nonce':C.nonce,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await res.json();
      if(!res.ok){const err=Error(value.message||'The operation returned HTTP '+res.status+'.');err.status=res.status;throw err;}
      return value;
    } catch(err) {if(err.name==='AbortError')throw Error('The response did not complete. Check or retry the exact retained operation before changing its request.');throw err;}
    finally{clearTimeout(timer);}
  }
  async function mutate(path,body,title) {
    if(S.pending)throw Error('An earlier response is unresolved. Check its retained result or retry that exact request first.');
    S.pending={schema:'stellar-forge.sf104.connector-pending-request.v1',installationId:S.iid,path,body:clone(body),title,preparedAt:new Date().toISOString()};
    renderPending();
    const result=await api(path,body);S.pending=null;renderPending();return result;
  }
  function saveFile(name,body,type='application/json') {
    const blob=body instanceof Blob?body:new Blob([body],{type});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);
  }
  async function downloadOriginal(id) {
    const r=S.receiptCache.get(id)||await api(basePath()+'/receipts/'+id);
    const u=new URL(C.api,location.href);const res=await fetch(u.href.replace(/\/$/,'')+basePath()+'/receipts/'+id+'/download',{credentials:'same-origin',redirect:'error',headers:{'X-WP-Nonce':C.nonce}});
    if(!res.ok)throw Error('The original source download returned HTTP '+res.status+'.');
    saveFile(r.name,await res.blob(),'application/octet-stream');
  }
  async function fileBytes(file,max) {
    if(!file||file.size>max)throw Error('Select an original file within the displayed size limit.');
    const buffer=await file.arrayBuffer();if(buffer.byteLength!==file.size)throw Error('The complete file could not be read.');
    if(!crypto.subtle)throw Error('Open this administrator page over HTTPS or loopback to calculate the original-file digest.');
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
    const array=new Uint8Array(buffer);let text='';for(let i=0;i<array.length;i+=32768)text+=String.fromCharCode(...array.subarray(i,i+32768));
    return {contentBase64:btoa(text),sha256:sha};
  }
  function formValues(id){const f=document.getElementById(id);return f?Object.fromEntries(new FormData(f).entries()):null;}
  function captureVisible() {
    let v=formValues('kcf-capture');
    if(v){for(const k of Object.keys(S.capture))if(k!=='fields'&&Object.hasOwn(v,k))S.capture[k]=v[k];S.reuseReceiptId=v.reuseReceiptId||'';
      S.capture.fields=Array.from(document.querySelectorAll('#kcf-projection-fields tr[data-field-row]')).map(tr=>({label:tr.querySelector('[name=fieldLabel]').value,pointer:tr.querySelector('[name=fieldPointer]').value}));}
    v=formValues('kcf-edition-form');
    if(v){S.editionLabel=v.editionLabel;S.editionReason=v.editionReason;S.metadata=S.metadata||emptyMeta();for(const k of ['pluginId','pluginVersion','frameworkVersion','packageName','packageSha256','environment'])S.metadata[k]=v[k]||'';
      S.metadata.credentialReferences=Array.from(document.querySelectorAll('#kcf-credential-refs tr[data-ref-row]')).map(tr=>({name:tr.querySelector('[name=parameterName]').value,environmentVariable:tr.querySelector('[name=environmentVariable]').value}));}
    v=formValues('kcf-map-form');
    if(v&&S.draft){S.draft.label=v.recipeLabel;S.draft.baseMapId=v.baseMapId;S.draft.reason=v.recipeReason;S.draft.acknowledgeLookupPriority=Object.hasOwn(v,'lookupAck');
      if(S.draft.substitutions){S.draft.substitutions.unmappedCountries=v.unmappedCountries;S.draft.substitutions.unmappedStates=v.unmappedStates;}}
    v=formValues('kcf-compare-form');if(v){S.compareBefore=v.before;S.compareAfter=v.after;S.compareChange=v.change;S.compareQ=v.q;}
    v=formValues('kcf-review-form');if(v){S.reviewReason=v.reviewReason;S.reviewDisposition=v.disposition;}
    v=formValues('kcf-export-form');if(v)S.includeOrders=Object.hasOwn(v,'includeOrders');
  }
  async function run(fn) {
    if(S.busy)return;captureVisible();S.busy=true;S.message='';S.error=false;render();
    try{await fn();}catch(err){S.message=err.message||String(err);S.error=true;}
    finally{S.busy=false;render();}
  }
  function emptyMeta(){return{pluginId:'',pluginVersion:'',frameworkVersion:'',packageName:'',packageSha256:'',environment:'',credentialReferences:[]};}
  async function loadList(name) {
    S.lists[name]=await api(basePath()+'/'+name+'?'+new URLSearchParams({page:String(S.pages[name]||1),limit:'50'}));
    if(name==='receipts')for(const r of S.lists[name].items)S.receiptCache.set(r.id,r);
  }
  async function loadInstallation(id,reset=true) {
    const r=await api('/installations/'+id);S.iid=id;S.installationChoice=id;S.installation=r.installation;S.head=r.head;
    S.status.currentMapId=r.currentMapId;
    if(reset){S.lists={};for(const k of Object.keys(S.pages))S.pages[k]=1;S.receiptCache.clear();S.selectionDirty=false;S.draft=null;S.recipe=null;S.preview=null;S.comparison=null;S.impacts=null;S.upload=null;S.reuseReceiptId='';S.editionLabel='';S.editionReason='';}
    await Promise.all(['receipts','editions','recipes','reviews','links','imports'].map(loadList));
    if(S.head.currentEditionId){S.edition=await api(basePath()+'/editions/'+S.head.currentEditionId);for(const r of S.edition.receipts)S.receiptCache.set(r.id,r);}
    else S.edition=null;
    if(reset||!S.selectionDirty){S.selectedReceipts=new Set(S.edition?.receiptIds||[]);S.metadata=clone(S.edition?.metadata||emptyMeta());}
    if(reset){S.compareAfter=S.head.currentEditionId;S.compareBefore=S.edition?.parentEditionId||'';}
    const u=new URL(location.href);u.searchParams.set('installation',id);history.replaceState(null,'',u.href);
  }
  async function refresh() {
    S.status=await api('?page='+S.installationPage+'&limit=50');if(S.iid)await loadInstallation(S.iid,false);
  }
  function renderPending() {
    const el=document.getElementById('kcf-pending');
    el.innerHTML=S.pending?'<section class="kcf-note"><h3>Retain the exact unresolved request</h3><p>'+e(S.pending.title)+' · <code>'+e(S.pending.body.operationId||'draft preview')+'</code></p><p>The page keeps the original request. A refresh or a different save does not establish its outcome.</p><div class="kcf-actions">'+button('pending-check','Check retained result')+button('pending-retry','Retry exact request')+button('pending-download','Download private request')+button('pending-dismiss','Keep draft and start a different request')+'</div></section>':'';
  }
  function renderSelection() {
    const el=document.getElementById('kcf-selection');if(!S.status){el.innerHTML='';return;}
    const items=S.status.items.map(i=>[i.id,i.name+' · '+i.identity.company+' / '+i.identity.connectorId]);
    if(S.iid&&!items.some(x=>x[0]===S.iid))items.push([S.iid,S.installation?.name||idShort(S.iid)]);
    el.innerHTML='<section class="kcf-card"><div class="kcf-toolbar">'+select('installationSelect','Installation',[['','Select retained installation'],...items],S.installationChoice)+button('open-installation','Open')+button('new-installation','New installation')+'</div>'+
      (S.installation?'<p class="help">'+e(S.installation.identity.applicationUrl)+' · Tenant '+e(S.installation.identity.tenant)+' · Company '+e(S.installation.identity.company)+' · Connector '+e(S.installation.identity.connectorId)+'</p><p class="help">Workspace revision '+S.head.revision+' · '+(S.edition?'Selected source: '+e(S.edition.label):'No source edition selected')+'</p>':'')+
      pager('installations',S.status)+'</section>';
  }
  function render() {
    renderSelection();renderPending();document.getElementById('kcf-message').innerHTML=S.message?'<div class="kcf-message'+(S.error?' error':'')+'">'+e(S.message)+'</div>':'';
    for(const b of root.querySelectorAll('.kcf-nav [data-view]')){b.setAttribute('aria-current',b.dataset.view===S.view?'page':'false');b.disabled=S.busy;}
    if(!S.status)main.innerHTML=empty('Opening the retained workspace…');
    else if(!S.iid)main.innerHTML='<section class="kcf-card"><h2>Open or create an installation</h2><p>Keep the exact Acumatica application path, tenant, company and connector identity together. Add its actual exported configuration or schema-screen JSON, then review how those fields map to the existing order delivery.</p>'+button('new-installation','Create installation')+note('Only original source exports are read here. No vendor endpoint, credential value or catalog completeness is inferred.')+'</section>'+renderImport();
    else main.innerHTML=({sources:renderSources,mapping:renderMapping,changes:renderChanges,handoff:renderHandoff}[S.view])();
    document.getElementById('kcf-observed').textContent=S.status?.observedAt?'Read '+S.status.observedAt:'';
  }

  function renderSources() {
    const list=S.lists.receipts, c=S.capture, m=S.metadata||emptyMeta();
    const existing=Array.from(S.receiptCache.values()).map(r=>[r.id,r.name+' · '+r.slot+' · '+idShort(r.id)]);
    const receipts=list?.items?.length?table(['Select','Original source','Scope','Inspection','Received','Actions'],list.items.map(r=>row([
      '<input type="checkbox" aria-label="Select '+e(r.name)+' for next edition" data-select-receipt="'+r.id+'"'+(S.selectedReceipts.has(r.id)?' checked':'')+'>',
      '<strong>'+e(r.name)+'</strong><div class="help">'+e(r.slot)+' · '+bytes(r.bytes)+'</div><code>'+e(r.sha256)+'</code>',
      e(label(r.scope.family))+'<div>'+badge(r.scope.coverage)+'</div><div class="help">'+e(r.scope.selection==='IDS'?r.scope.ids.join(', '):r.scope.filter||r.scope.selection)+'</div>',
      badge(r.status)+'<div class="help">'+(r.rowCount===null?e(r.inspectionError):r.rowCount.toLocaleString()+' projected rows')+'</div>',
      e(r.receivedAt)+'<div class="help">Source time: '+e(r.source.observedAt||'Not recorded')+'</div>',
      button('inspect-receipt','Inspect','data-id="'+r.id+'"')+' '+button('download-receipt','Original file','data-id="'+r.id+'"')+' '+button('reuse-receipt','New observation','data-id="'+r.id+'"')
    ]))):empty('No source receipts yet. Retain the actual installation export below.');
    const projected=c.fields.map((f,i)=>'<tr data-field-row><td><input name="fieldLabel" aria-label="Comparison field label" value="'+e(f.label)+'"></td><td><input name="fieldPointer" aria-label="Relative field pointer" value="'+e(f.pointer)+'"></td><td>'+button('remove-projection','Remove','data-index="'+i+'"')+'</td></tr>');
    const refs=m.credentialReferences.map((r,i)=>'<tr data-ref-row><td><input name="parameterName" aria-label="Credential parameter name" value="'+e(r.name)+'"></td><td><input name="environmentVariable" aria-label="Environment variable name" value="'+e(r.environmentVariable)+'"></td><td>'+button('remove-credential','Remove','data-index="'+i+'"')+'</td></tr>');
    const selected=Array.from(S.selectedReceipts).map(id=>{const r=S.receiptCache.get(id);return button('unselect-receipt',(r?.slot||idShort(id))+' · '+(r?.name||'retained source')+' ×','data-id="'+id+'"');}).join('');
    const history=S.lists.editions?.items?.length?table(['Source edition','Installation version','Created','Actions'],S.lists.editions.items.map(x=>row([
      '<strong>'+e(x.label)+'</strong><div class="help">'+idShort(x.id)+' · '+x.receiptIds.length+' sources</div>',
      e(x.metadata.pluginId||'Plugin not recorded')+'<div class="help">'+e(x.metadata.pluginVersion||'Version not recorded')+' / '+e(x.metadata.frameworkVersion||'Framework not recorded')+'</div>',
      e(x.createdAt),button('inspect-edition','Inspect','data-id="'+x.id+'"')+' '+button('select-edition','Use this source','data-id="'+x.id+'"')
    ]))):empty('Saving an edition freezes the selected receipt IDs and installation metadata.');
    return '<section class="kcf-card"><div class="kcf-toolbar"><div><h2>Original source receipts</h2><p>Each upload retains its exact bytes and observation. A new observation may reuse identical bytes.</p></div></div>'+receipts+pager('receipts',list)+'</section>'+
      '<div class="kcf-split"><section class="kcf-card"><h2>Retain an export</h2><form id="kcf-capture"><div class="kcf-grid">'+
      input('slot','Logical source slot',c.slot,'Keep this name stable when replacing the same scoped source.','required maxlength="160"')+
      select('family','Source family',S.status.families,c.family)+
      select('reuseReceiptId','Original bytes',[['','Upload a new original file'],...existing],S.reuseReceiptId,'Reusing bytes creates a distinct observation with the new scope and source metadata.')+
      '<label>Source file<input type="file" id="kcf-upload" accept=".json,.csv,.tsv,application/json,text/csv"><small>'+e(S.upload?S.upload.name+' · '+bytes(S.upload.size):'UTF-8 JSON or CSV · Maximum 4 MiB. No browser-side row conversion.')+'</small></label>'+
      select('format','File format',[['json','JSON'],['csv','CSV / delimited text']],c.format)+
      select('delimiter','CSV delimiter',[[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']],c.delimiter)+
      input('screen','Source screen or export command',c.screen,'Name the actual screen or export used.','required maxlength="300"')+
      input('reference','Source reference',c.reference,'Optional source document, screen ID or export reference.','maxlength="2048"')+
      input('observedAt','Source extraction time, if recorded',c.observedAt,'ISO timestamp with timezone; leave blank when unknown.','placeholder="2026-10-12T09:00:00Z"')+
      select('coverage','Observed coverage',S.status.coverage,c.coverage,'A single lookup is not a complete entity catalog.')+
      select('selection','Original selection',[['ALL','All within declared scope'],['IDS','Exact entity IDs'],['FILTER','Recorded filter']],c.selection)+
      area('ids','Exact selected IDs',c.ids,'One original ID per line. Used only for an ID selection.')+
      area('filter','Actual source filter',c.filter,'Used only for a filter selection; preserve its exact meaning.')+
      input('window','Date or other source window',c.window,'Retain the actual window, if one was selected.')+
      input('activeSelection','Active/inactive selection',c.activeSelection,'Record the source screen’s active-selection setting; blank means unrecorded.')+
      area('note','Observation note',c.note,'Include known missing pages, export problems or relevant source context.')+'</div>'+
      '<fieldset><legend>Explicit comparison projection</legend><p class="help">JSON pointers identify the actual source fields. CSV rows use / followed by the exact escaped header. Leave identity fields empty for a path inspection; it cannot establish catalog removals.</p><div class="kcf-grid">'+
      input('rowPointer','Rows pointer',c.rowPointer,'Use /items for that actual array; blank selects the document or the CSV row array.')+
      area('identityPointers','Identity field pointers',c.identityPointers,'One pointer per line, relative to each row. Include the country or parent field where needed.')+'</div>'+
      '<div class="kcf-table"><table id="kcf-projection-fields"><thead><tr><th>Comparison label</th><th>Relative source pointer</th><th></th></tr></thead><tbody>'+projected.join('')+'</tbody></table></div>'+
      button('add-projection','Add comparison field')+'<p class="help">An explicit field labeled active records the actual boolean activation flag. Empty field selection retains the complete row for comparison.</p></fieldset>'+
      '<div class="kcf-actions"><button class="primary" type="submit"'+dis(false)+'>Retain original source</button></div></form></section>'+
      '<section class="kcf-card"><h2>Freeze a source edition</h2><p>Select one receipt for each logical source slot. Sources not selected remain retained in the inventory.</p><div class="kcf-selected">'+selected+'</div><p class="help">'+S.selectedReceipts.size+' selected receipts.</p>'+
      '<form id="kcf-edition-form"><div class="kcf-grid">'+input('editionLabel','Edition label',S.editionLabel,'','required maxlength="160"')+
      input('pluginId','Installed plugin identity',m.pluginId,'Keep plugin identity separate from its version.')+
      input('pluginVersion','Plugin version',m.pluginVersion)+input('frameworkVersion','Framework version',m.frameworkVersion)+
      input('packageName','Customization or package name',m.packageName)+input('packageSha256','Recorded package SHA-256',m.packageSha256,'Leave blank if the original package hash is unavailable.','pattern="[a-f0-9]{64}"')+
      input('environment','Environment label',m.environment,'For example, the actual selected receiving environment.')+'</div>'+
      '<fieldset><legend>Credential parameter references</legend><p class="help">Retain parameter names and their configured environment variable names. Do not enter a password, bearer token or resolved credential value.</p>'+
      '<div class="kcf-table"><table id="kcf-credential-refs"><thead><tr><th>Parameter</th><th>Environment variable</th><th></th></tr></thead><tbody>'+refs.join('')+'</tbody></table></div>'+button('add-credential','Add reference')+'</fieldset>'+
      area('editionReason','Reason for this source selection',S.editionReason,'Explain the selected scope and any known gaps.','required maxlength="4000"')+
      '<div class="kcf-actions"><button class="primary" type="submit"'+dis(!S.selectedReceipts.size)+'>Save source edition</button></div></form>'+
      note('The captured source edition does not initialize, pause, stop or change the connector.')+'</section></div>'+
      '<section class="kcf-card"><h2>Source edition history</h2>'+history+pager('editions',S.lists.editions)+'</section>';
  }
  function mappingTarget(t){return t.path||t.table+' / '+(t.sourceKey||'shipping')+' / '+t.field;}
  function renderPreview() {
    if(!S.preview)return '';
    const p=S.preview,start=(S.previewPage-1)*50,subset=p.assignments.slice(start,start+50);
    return '<section class="kcf-card"><h2>Reviewed ERP map</h2>'+badge(p.ready?'READY_FOR_MAP_SAVE':'NEEDS_REVIEW')+
      (p.issues.length?'<ul>'+p.issues.map(x=>'<li><strong>'+e(x.path)+':</strong> '+e(x.message)+'</li>').join('')+'</ul>':'')+
      '<p class="help">Base map <code>'+e(p.baseMapId)+'</code><br>Result map <code>'+e(p.mapId||'Not compiled')+'</code></p>'+
      table(['ERP destination','Captured source','Before','Approved result'],subset.map(x=>row([
        e(mappingTarget(x.target)),typed(x.source.captured)+(x.source.source?'<div class="help">'+e(x.source.source.pointer)+' · '+idShort(x.source.source.receiptId)+'</div>':'<div class="help">Explicit constant</div>'),
        x.before.present?e(typeof x.before.value==='object'?JSON.stringify(x.before.value):x.before.value):'<span class="help">New field</span>',
        e(typeof(x.compiledAfter||x.after).value==='object'?JSON.stringify((x.compiledAfter||x.after).value):String((x.compiledAfter||x.after).value))
      ])))+pager('preview',{page:S.previewPage,limit:50,total:p.assignments.length})+
      (p.removals.length?details('Deliberate removals and reasons',p.removals):'')+details('Complete compiled ERP map',p.mapping)+
      '<p class="help">'+e(p.lookupPriority)+'</p>'+
      '<form id="kcf-apply-form">'+area('applyReason','Reason for applying this exact mapping',S.draft?.reason||S.recipe?.reason||'','Required; the original map ID and source edition are retained with this decision.','required maxlength="4000"')+
      check('historicalSource','I am deliberately applying this retained historical source edition',false)+
      '<div class="kcf-actions"><button class="primary" type="submit"'+dis(!p.ready||!S.recipe||p.recipeId!==S.recipe.id||!!S.pending||S.status.currentMapId===p.mapId)+'>Save through ERP mapping</button>'+nativeLink({map:p.mapId||S.status.currentMapId},'Open original map')+'</div></form>'+
      (S.status.currentMapId===p.mapId?'<p class="help">This exact ERP map is already selected.</p>':!S.recipe||p.recipeId!==S.recipe.id?'<p class="help">Save the recipe before applying its retained preview.</p>':'')+'</section>';
  }
  function renderSubstitutions() {
    const sub=S.draft?.substitutions;if(!sub)return '<fieldset><legend>Address substitutions</legend><p>Preserve the map’s existing address behavior, or add reviewed connector-to-Acumatica substitutions for order address overrides.</p>'+button('enable-substitutions','Configure country and state substitutions')+'</fieldset>';
    let html='<fieldset><legend>Connector → Acumatica address values</legend><p class="help">These rules apply only to order_override. The original billing and shipping addresses stay retained. States preserve both country identities; the incoming connector value maps to the Acumatica value.</p><div class="kcf-grid">'+select('unmappedCountries','Unmatched country',[['preserve','Preserve original value'],['error','Require an explicit match']],sub.unmappedCountries)+select('unmappedStates','Unmatched state',[['preserve','Preserve original value'],['error','Require an explicit match']],sub.unmappedStates)+'</div>';
    for(const name of ['countries','states']){
      const fields=name==='countries'?['connectorCountry','acumaticaCountry']:['connectorCountry','acumaticaCountry','connectorState','acumaticaState'],page=S.subPage[name],slice=sub[name].slice((page-1)*25,page*25);
      html+='<h3>'+e(label(name))+'</h3>'+table(fields.map(f=>f.replace(/([A-Z])/g,' $1')).concat(['Actions']),slice.map((r,i)=>row(fields.map(f=>'<button type="button" class="kcf-rule" data-action="edit-substitution" data-table="'+name+'" data-index="'+((page-1)*25+i)+'" data-field="'+f+'">'+e(ruleLabel(r[f]))+'</button>').concat([button('remove-substitution','Remove','data-table="'+name+'" data-index="'+((page-1)*25+i)+'"')]))))+
        pager('sub-'+name,{page,limit:25,total:sub[name].length})+button('add-substitution','Add '+(name==='countries'?'country':'state'),'data-table="'+name+'"');
    }
    return html+'<div class="kcf-actions">'+button('disable-substitutions','Keep base-map substitutions unchanged')+'</div></fieldset>';
  }
  function renderMapping() {
    const history=S.lists.recipes?.items?.length?table(['Recipe','Source / base map','State','Actions'],S.lists.recipes.items.map(r=>row([
      '<strong>'+e(r.label)+'</strong><div class="help">'+e(r.createdAt)+'</div>',
      '<code>'+idShort(r.sourceEditionId)+'</code> / <code>'+idShort(r.baseMapId)+'</code>',badge(r.status),
      button('open-recipe','Open','data-id="'+r.id+'"')+' '+button('recipe-impacts','Related orders','data-id="'+r.id+'"')
    ]))):empty('No saved source-to-map recipes yet.');
    let form='';
    if(S.draft){
      const d=S.draft,page=S.assignmentPage,rows=d.assignments.slice((page-1)*25,page*25).map((a,i)=>row([
        e(mappingTarget(a.target)),'<span class="kcf-break">'+e(ruleLabel(a.rule))+'</span><div class="help">'+e(a.rule.conversion||'preserve')+'</div>',
        button('edit-assignment','Edit','data-index="'+((page-1)*25+i)+'"')+' '+button('remove-assignment','Remove assignment','data-index="'+((page-1)*25+i)+'"')
      ]));
      const maps=S.status.maps.map(m=>[m.id,m.name+' · '+idShort(m.id)+(m.id===S.status.currentMapId?' · current':'')]);
      if(!maps.some(x=>x[0]===d.baseMapId))maps.push([d.baseMapId,idShort(d.baseMapId)]);
      form='<section class="kcf-card"><h2>Source-to-map recipe</h2><p class="help">Source edition <code>'+e(d.sourceEditionId)+'</code>. Unassigned fields and bindings remain from the selected base map. Omitting a source row never removes a binding.</p><form id="kcf-map-form"><div class="kcf-grid">'+
        input('recipeLabel','Recipe label',d.label,'','required maxlength="160"')+select('baseMapId','Original ERP base map',maps,d.baseMapId,'Use the current original map before applying a change.')+'</div>'+
        '<h3>Explicit field assignments</h3>'+table(['ERP destination','Source / constant','Actions'],rows)+pager('assignments',{page,limit:25,total:d.assignments.length})+
        '<div class="kcf-actions">'+button('add-assignment','Add field assignment')+button('add-removal','Remove a specific original binding')+'</div>'+
        (d.removals.length?table(['Explicit removal','Reason','Actions'],d.removals.map((r,i)=>row([e(r.table+' / '+(r.sourceKey||'shipping')),e(r.reason),button('remove-removal','Keep binding','data-index="'+i+'"')]))):'')+
        renderSubstitutions()+check('lookupAck','Reviewed: customer ID precedes email; variation/product ID precedes SKU',d.acknowledgeLookupPriority)+
        area('recipeReason','Reason and mapping review',d.reason,'Explain actual configuration, schema or substitution changes.','required maxlength="4000"')+
        '<div class="kcf-actions"><button type="submit" class="primary"'+dis(false)+'>Save recipe</button>'+button('preview-draft','Preview complete map')+'</div></form></section>';
    }
    const impacts=S.impacts?'<section class="kcf-card"><h2>Related original order editions</h2><p>These editions retain the selected base or source-linked map. They are not re-prepared or re-delivered by a connector-source change.</p>'+
      table(['Order','State','Edition / map','Actions'],S.impacts.items.map(r=>row([e(r.orderId),badge(r.state)+(r.currentEdition?' current edition':''),'<code>'+idShort(r.editionId)+'</code> / <code>'+idShort(r.mapId)+'</code>',nativeLink({operation:r.operationId},'Open original order')])))+
      pager('impacts',S.impacts)+'</section>':'';
    return '<section class="kcf-card"><h2>Mapping recipes</h2><p>Start with an existing ERP map, select actual source fields or reviewed constants, then inspect the complete result.</p><div class="kcf-actions">'+button('new-recipe','New recipe from selected source','',!S.edition||!S.status.currentMapId)+nativeLink({},'Create or inspect ERP map')+'</div>'+
      (!S.status.currentMapId?note('Create the original ERP map first. Its target, exact decimal settings, admission states and existing customer/product bindings remain the starting point.'):!S.edition?note('Save or select a source edition before creating a recipe.'):'')+
      history+pager('recipes',S.lists.recipes)+'</section>'+form+renderPreview()+impacts;
  }

  function renderChanges() {
    const choices=(S.lists.editions?.items||[]).map(x=>[x.id,x.label+' · '+idShort(x.id)]);
    for(const id of [S.compareBefore,S.compareAfter])if(id&&!choices.some(x=>x[0]===id))choices.push([id,idShort(id)]);
    const changes=['all','CHANGED','UNCHANGED','ADDED_TO_COMPLETE_SCOPE','REMOVED_FROM_COMPLETE_SCOPE','NEW_OBSERVATION','NOT_OBSERVED_AFTER','SCOPE_CHANGED','SCOPE_ADDED','SCOPE_NOT_SELECTED','SOURCE_INVALID','INSTALLATION_CHANGED'];
    let body='<section class="kcf-card"><h2>Compare actual source editions</h2><p>Exact IDs, filters, windows, activation selections and field projections determine the common scope. Missing rows outside an unchanged complete scope remain unobserved.</p><form id="kcf-compare-form"><div class="kcf-grid">'+
      select('before','Before source edition',[['','Choose earlier edition'],...choices],S.compareBefore)+select('after','After source edition',[['','Choose later edition'],...choices],S.compareAfter)+
      select('change','Change filter',changes,S.compareChange)+input('q','Find an exact field, ID or value',S.compareQ,'Searches the complete retained comparison.','maxlength="200"')+
      '</div><div class="kcf-actions"><button type="submit" class="primary"'+dis(!S.compareBefore||!S.compareAfter)+'>Compare editions</button></div></form></section>';
    if(S.comparison){
      const c=S.comparison;
      body+='<section class="kcf-card"><h2>Observed differences</h2><div class="kcf-metrics">'+Object.entries(c.counts).map(([k,v])=>'<div><strong>'+v.toLocaleString()+'</strong><span>'+e(label(k))+'</span></div>').join('')+'</div>'+
        table(['Source slot / identity','Change','Observed fields','Detail'],c.items.map(x=>row([
          '<strong>'+e(x.slot)+'</strong><div class="mono">'+e(x.identity?.map(v=>v.value).join(' / ')||x.key)+'</div>',
          badge(x.change),x.fields?.length?e(x.fields.map(f=>f.field).join(', ')):'<span class="help">'+e(x.meaning||'No selected field difference')+'</span>',
          details('Exact before and after',x)
        ])))+pager('comparison',c)+details('Declared common scopes',c.scopes)+
        '<form id="kcf-review-form"><h3>Record the operating decision</h3><div class="kcf-grid">'+
        select('disposition','Decision',[['RETAIN_MAPPING','Retain existing mapping'],['REVISE_MAPPING','Prepare a revised mapping'],['RECAPTURE_SCOPE','Obtain a corrected or complete source']],S.reviewDisposition)+
        area('reviewReason','Reason and next operating work',S.reviewReason,'The source result remains unchanged by this decision.','required maxlength="4000"')+'</div><div class="kcf-actions"><button type="submit" class="primary"'+dis(false)+'>Save change review</button>'+button('new-recipe-after','Create recipe from after edition','',!S.status.currentMapId)+'</div></form></section>';
    }
    body+='<section class="kcf-card"><h2>Change review history</h2>'+(S.lists.reviews?.items?.length?table(['Decision','Source editions','Reason','Recorded'],S.lists.reviews.items.map(r=>row([
      badge(r.disposition),'<code>'+idShort(r.beforeId)+'</code> → <code>'+idShort(r.afterId)+'</code>',e(r.reason)+details('Complete review and observed scope',r),e(r.createdAt)
    ]))):empty('No change review has been recorded.'))+pager('reviews',S.lists.reviews)+'</section>';
    return body;
  }
  function renderImport() {
    return '<section class="kcf-card"><h2>Receive a private workspace</h2><p>Choose the complete exported JSON. Its digest and every original source file are checked before receiving. A newer local selection is preserved; a different existing ERP order history is never replaced.</p><form id="kcf-import-form"><label>Complete private connector project<input type="file" id="kcf-import-file" accept=".json,application/json"><small>'+e(S.importFile?S.importFile.name+' · '+bytes(S.importFile.size):'Maximum 32 MiB. Keep this file private; it includes original source data and may contain customer/order history.')+'</small></label><div class="kcf-actions"><button type="submit" class="primary"'+dis(false)+'>Inspect and receive complete project</button></div></form></section>';
  }
  function renderHandoff() {
    const links=S.lists.links, imports=S.lists.imports;
    return '<section class="kcf-card"><h2>Retain the complete operating handoff</h2><p>The private package contains original JSON/CSV bytes, receipt scopes, all source editions and recipes, substitution decisions, mapping lineage and operation history.</p><form id="kcf-export-form">'+check('includeOrders','Include every related original ERP order project',S.includeOrders)+
      '<p class="help">ERP projects retain their native order key, editions, receiving history and approval/recovery rules. Keep the original Woo database as well when moving the store; this source package does not replace a WordPress database backup.</p><div class="kcf-actions"><button type="submit" class="primary"'+dis(false)+'>Download complete private project</button></div></form>'+
      note('Credential references retain environment variable names only. Exact source files remain private and may contain sensitive configuration. Configure the actual secrets on the receiving host. Imported ERP orders require the original bind-import and target reconciliation before another delivery.')+'</section>'+
      '<section class="kcf-card"><h2>Applied mapping lineage</h2>'+(links?.items?.length?table(['Original map','Retained source / recipe','Decision','Actions'],links.items.map(x=>row([
        '<code>'+e(x.mapId)+'</code>','<code>'+idShort(x.sourceEditionId)+'</code> / <code>'+idShort(x.recipeId)+'</code>',e(x.reason)+'<div class="help">'+e(x.createdAt)+'</div>',
        nativeLink({map:x.mapId},'Open original map')+' '+button('open-recipe','Inspect recipe','data-id="'+x.recipeId+'"')
      ]))):empty('No source recipe has been applied to the original ERP map.'))+pager('links',links)+'</section>'+
      renderImport()+
      '<section class="kcf-card"><h2>Private receiving history</h2>'+(imports?.items?.length?table(['Imported package','Source date','Received','Selection'],imports.items.map(x=>row([
        '<code>'+e(x.packageSha256)+'</code>',e(x.exportedAt),e(x.importedAt),'Source edition <code>'+idShort(x.importedHead.currentEditionId)+'</code>'
      ]))):empty('No private project has been received here.'))+pager('imports',imports)+'</section>'+
      '<section class="kcf-card"><h2>Recover an interrupted response</h2><p>Use the exact original request and operation ID. Checking a retained result does not apply a new map or repeat a delivery.</p><form id="kcf-operation-form"><div class="kcf-toolbar">'+input('operation','Original operation ID','', 'The ID returned by the UI or native client.','required pattern="[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}"')+'<button type="submit"'+dis(false)+'>Read retained result</button></div></form><label>Saved pending request<input type="file" id="kcf-pending-file" accept=".json,application/json"><small>Loads the original private request into the recovery panel. It does not send it.</small></label></section>';
  }
  function openDialog(title,body) {
    dialog.innerHTML='<div class="kcf-dialog-heading"><h2 id="kcf-dialog-title">'+e(title)+'</h2><button type="button" data-action="close-dialog" aria-label="Close dialog">Close</button></div><div id="kcf-dialog-error" role="alert"></div>'+body;
    if(!dialog.open)dialog.showModal();
  }
  function dialogError(err){const target=document.getElementById('kcf-dialog-error');if(target)target.innerHTML='<div class="kcf-message error">'+e(err.message||String(err))+'</div>';}
  function showReceipt(r) {
    S.receiptCache.set(r.id,r);S.editor=null;S.browser={rid:r.id,pointer:'',page:1,result:null};
    openDialog('Inspect '+r.name,'<p><code>'+e(r.sha256)+'</code> · '+bytes(r.bytes)+'</p>'+badge(r.status)+
      (r.inspectionError?note(r.inspectionError):'')+details('Exact receipt, source scope and field projection',r)+
      '<div class="kcf-actions">'+button('download-receipt','Download original bytes','data-id="'+r.id+'"')+'</div><h3>Exact source values</h3><div id="kcf-browser"></div>');
    loadBrowser().catch(dialogError);
  }
  async function loadBrowser() {
    const b=S.browser;if(!b)return;
    const r=await api(basePath()+'/receipts/'+b.rid+'/browse?'+new URLSearchParams({pointer:b.pointer,page:String(b.page),limit:'30'}));
    if(S.browser!==b)return;b.result=r;renderBrowser();
  }
  function renderBrowser() {
    const el=document.getElementById('kcf-browser'),b=S.browser;if(!el||!b)return;
    if(!b.result){el.innerHTML=empty('Reading the selected source values…');return;}
    const r=b.result;el.innerHTML='<div class="kcf-toolbar"><label>Pointer<input id="kcf-browse-pointer" value="'+e(b.pointer)+'"></label>'+button('browse-go','Open pointer')+button('browse-up','Parent','',b.pointer==='')+'</div><p class="help">'+typed(r.node)+'</p>'+
      (r.items.length?table(['Exact key','Value / type','Actions'],r.items.map(x=>row([
        '<span class="mono">'+e(x.key)+'</span>',typed(x),
        ['object','array'].includes(x.type)?button('browse-node','Open','data-pointer="'+e(x.pointer)+'"'):S.editor?button('browse-use','Use exact field','data-pointer="'+e(x.pointer)+'"'):button('browse-copy','Copy pointer','data-pointer="'+e(x.pointer)+'"')
      ]))):'')+
      '<div class="kcf-pager"><span>'+r.total+' children · Page '+b.page+'</span>'+button('browse-page','Previous','data-delta="-1"',b.page<=1)+button('browse-page','Next','data-delta="1"',b.page*30>=r.total)+'</div>'+
      (S.editor&&!['array','object','missing'].includes(r.node.type)?button('browse-use','Use this exact scalar','data-pointer="'+e(b.pointer)+'"'):'');
  }
  function editorValue() {
    const v=formValues('kcf-value-editor');if(!v)return S.editor?.rule;
    const scalar=(type,value)=>{
      if(type==='boolean'&&!['true','false'].includes(value))throw Error('Enter true or false for a boolean value.');
      if(type==='number'&&!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value))throw Error('Enter an exact JSON number without rounding.');
      if(type==='null'&&value!==''&&value!=='null')throw Error('A null value has no text value.');
      return{type,value:type==='null'?null:type==='boolean'?value==='true':value};
    };
    const r=v.valueMode==='constant'?{constant:scalar(v.constantType,v.constantValue)}:{receiptId:v.receiptId,pointer:v.pointer};
    r.conversion=v.conversion||'preserve';r.values=[];
    for(const tr of dialog.querySelectorAll('tr[data-translation-row]')){
      const val=name=>tr.querySelector('[name="'+name+'"]').value;
      r.values.push({from:scalar(val('fromType'),val('fromValue')),to:scalar(val('toType'),val('toValue'))});
    }
    if(v.allowInactive){r.allowInactive=true;r.inactiveReason=v.inactiveReason||'';}
    return r;
  }
  function captureEditor() {
    if(!S.editor)return;
    S.editor.rule=editorValue();
    const v=formValues('kcf-value-editor');
    if(S.editor.kind==='assignment'&&v){
      S.editor.target=v.targetMode==='header'?{path:v.headerPath}:{table:v.bindingTable,sourceKey:v.bindingTable==='shippingBinding'?'':v.sourceKey,field:v.bindingField};
    }
  }
  function renderEditor() {
    const ed=S.editor,r=ed.rule,constant=Object.hasOwn(r,'constant'),receipts=S.edition?.receipts||[];
    const sourceEdition=S.draft?.sourceEditionId;
    const allowed=sourceEdition===S.edition?.id?receipts:Array.from(S.receiptCache.values()).filter(x=>ed.receiptIds?.includes(x.id));
    const refs=allowed.map(x=>[x.id,x.slot+' / '+x.name+' · '+idShort(x.id)]);if(r.receiptId&&!refs.some(x=>x[0]===r.receiptId))refs.push([r.receiptId,idShort(r.receiptId)]);
    const types=[['string','String'],['number','Exact number text'],['boolean','Boolean'],['null','Null']];
    const conversions=[['preserve','Preserve captured type and value'],['trim','Explicitly trim text'],['upper','Uppercase text'],['lower','Lowercase text'],['number-text','JSON number → exact text'],['integer','Exact non-negative integer']];
    let target='';
    if(ed.kind==='assignment'){
      const t=ed.target,tableName=t.table||'productBindings',fields=tableName==='customerBindings'?['customerId','locationId']:['inventoryId','uom','taxCategory','warehouseId'];
      target='<fieldset><legend>Original ERP destination</legend><div class="kcf-grid">'+select('targetMode','Destination type',[['header','Map or target field'],['binding','Customer, product, fee or shipping binding']],t.path?'header':'binding')+
        (t.path?select('headerPath','ERP map field',S.status.mappingFields,t.path):select('bindingTable','Binding table',S.status.mappingTables,tableName)+input('sourceKey','Exact original Woo key',t.sourceKey||'','customer:42, email:name@example.com, product:42, sku:ITEM or fee:Exact name. Shipping uses no key.')+select('bindingField','ERP binding field',fields,t.field||fields[0]))+'</div></fieldset>';
    }
    const translations=(r.values||[]).map((x,i)=>'<tr data-translation-row><td><select name="fromType" aria-label="Exact source type">'+option(types,x.from.type)+'</select><input name="fromValue" aria-label="Exact source value" value="'+e(x.from.value)+'"></td><td><select name="toType" aria-label="Mapped value type">'+option(types,x.to.type)+'</select><input name="toValue" aria-label="Mapped value" value="'+e(x.to.value)+'"></td><td>'+button('remove-translation','Remove','data-index="'+i+'"')+'</td></tr>');
    openDialog(ed.kind==='assignment'?'Review field assignment':'Review address value','<form id="kcf-value-editor">'+target+
      '<div class="kcf-grid">'+select('valueMode','Value source',[['source','Retained original field'],['constant','Explicit reviewed constant']],constant?'constant':'source')+
      select('conversion','Explicit conversion',conversions,r.conversion||'preserve')+
      (constant?select('constantType','Constant type',types,r.constant.type)+input('constantValue','Constant value',r.constant.value,'For boolean, enter exactly true or false. Numbers stay exact text until an explicit conversion.') :
      select('receiptId','Original receipt',[['','Select a source receipt'],...refs],r.receiptId||'')+input('pointer','Exact JSON pointer or CSV cell',r.pointer||'','For example /items/0/InventoryID or /0/Exact Header.'))+'</div>'+
      (!constant?'<div class="kcf-actions">'+button('editor-browse','Browse actual source')+'</div>':'')+
      '<details><summary>Exact value translations</summary><p class="help">When translations are supplied, the captured typed value must match one exact source entry. No unspecified fallback is applied.</p>'+
      '<div class="kcf-table"><table><thead><tr><th>Exact source</th><th>Approved value</th><th></th></tr></thead><tbody>'+translations.join('')+'</tbody></table></div>'+button('add-translation','Add exact translation')+'</details>'+
      check('allowInactive','Deliberately use a source row whose explicit active flag is false',!!r.allowInactive)+
      area('inactiveReason','Inactive-source reason',r.inactiveReason||'','Required only when using that explicitly inactive row.')+
      '<div class="kcf-actions"><button type="submit" class="primary">Keep reviewed assignment</button></div></form><div id="kcf-browser"></div>');
    if(S.browser)renderBrowser();
  }

  async function loadDraftEdition(id) {
    const edition=id===S.edition?.id?S.edition:await api(basePath()+'/editions/'+id);
    for(const r of edition.receipts)S.receiptCache.set(r.id,r);return edition;
  }
  async function newRecipe(sourceId=S.head.currentEditionId) {
    if(!sourceId||!S.status.currentMapId)throw Error('Select a retained source edition and create the original ERP map first.');
    const edition=await loadDraftEdition(sourceId);
    S.draft={sourceEditionId:sourceId,baseMapId:S.status.currentMapId,label:edition.label+' mapping',assignments:[],removals:[],substitutions:null,acknowledgeLookupPriority:false,reason:''};
    S.recipe=null;S.preview=null;S.impacts=null;S.assignmentPage=1;S.previewPage=1;S.view='mapping';
  }
  async function openRecipe(id) {
    const r=await api(basePath()+'/recipes/'+id);await loadDraftEdition(r.sourceEditionId);
    S.recipe=r;S.draft={sourceEditionId:r.sourceEditionId,baseMapId:r.baseMapId,label:r.label,assignments:clone(r.assignments),removals:clone(r.removals),substitutions:clone(r.substitutions),acknowledgeLookupPriority:r.acknowledgeLookupPriority,reason:r.reason};
    S.preview=await api(basePath()+'/recipes/'+id+'/preview');S.assignmentPage=1;S.previewPage=1;S.view='mapping';S.impacts=null;
  }
  async function beginEditor(kind,index,tableName,field) {
    captureVisible();const edition=await loadDraftEdition(S.draft.sourceEditionId);
    let rule,target;
    if(kind==='assignment'){const a=index<0?{target:{table:'productBindings',sourceKey:'',field:'inventoryId'},rule:{receiptId:'',pointer:'',conversion:'preserve'}}:S.draft.assignments[index];rule=clone(a.rule);target=clone(a.target);}
    else rule=clone(S.draft.substitutions[tableName][index][field]);
    S.editor={kind,index,table:tableName,field,rule,target,receiptIds:edition.receiptIds};S.browser=null;renderEditor();
  }
  async function processResult(result) {
    if(result.installation?.id){await refresh();await loadInstallation(result.installation.id,true);}
    else if(result.installationId&&result.source){await refresh();await loadInstallation(result.installationId,true);openDialog('Private project received',details('Complete retained receiving result',result));}
    else if(result.receipt){
      const r=result.receipt;S.receiptCache.set(r.id,r);
      for(const id of S.selectedReceipts)if(S.receiptCache.get(id)?.slot===r.slot)S.selectedReceipts.delete(id);
      S.selectedReceipts.add(r.id);S.selectionDirty=true;S.upload=null;S.reuseReceiptId='';
      S.head=result.head;await loadList('receipts');
      S.message=r.status==='READY'?'Original bytes retained and selected in the next edition draft. Save that edition when its scope is ready.':'Original bytes retained. Correct the displayed source or projection problem before using it in a map.';
      S.error=r.status!=='READY';
    }else if(result.edition){
      S.selectionDirty=false;S.editionLabel='';S.editionReason='';await loadInstallation(S.iid,false);S.message='Source edition retained. Existing ERP maps and order editions remain unchanged.';
    }else if(result.recipe){S.recipe=result.recipe;S.preview=result.preview;S.head=result.head;await loadList('recipes');S.message='Recipe retained. Review its complete map before applying it.';}
    else if(result.map&&result.link){S.status.currentMapId=result.currentMapId;await refresh();S.message='The original ERP map is saved with its source lineage. Open Order delivery to prepare and review the next order edition.';}
    else if(result.review){S.head=result.head;await loadList('reviews');S.message='The source change decision is retained with the exact comparison.';}
    else if(result.head){S.head=result.head;S.selectionDirty=false;await loadInstallation(S.iid,false);S.message='Retained source selection reopened. No ERP order or map was changed.';}
    return result;
  }
  async function compareLoad() {
    S.comparison=await api(basePath()+'/compare?'+new URLSearchParams({before:S.compareBefore,after:S.compareAfter,change:S.compareChange,q:S.compareQ,page:String(S.comparePage),limit:'50'}));
  }
  async function importJson(file,max) {
    if(!file||file.size>max)throw Error('Select the complete private JSON file within the displayed limit.');
    const text=await file.text();if(new TextEncoder().encode(text).length!==file.size)throw Error('The private JSON is not a complete UTF-8 file.');
    return JSON.parse(text);
  }
  async function digestCanonical(value) {
    const enc=new TextEncoder();
    const compare=(a,b)=>{const x=enc.encode(a),y=enc.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
    const encode=v=>{
      if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
      if(v&&typeof v==='object')return '{'+Object.keys(v).sort(compare).map(k=>encode(k)+':'+encode(v[k])).join(',')+'}';
      if(!(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)))throw Error('The private project contains an unsupported numeric value.');
      return JSON.stringify(v).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    };
    if(!crypto.subtle)throw Error('Open the administrator page over HTTPS or loopback to verify the complete project digest.');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(encode(value)))),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function submitForm(form) {
    const id=form.id;captureVisible();
    if(id==='kcf-value-editor'){
      try{
        captureEditor();const ed=S.editor;
        if(ed.kind==='assignment'){
          const a={target:ed.target,rule:ed.rule};if(ed.index<0)S.draft.assignments.push(a);else S.draft.assignments[ed.index]=a;
        }else S.draft.substitutions[ed.table][ed.index][ed.field]=ed.rule;
        S.recipe=null;S.preview=null;dialog.close();S.editor=null;S.browser=null;render();
      }catch(err){dialogError(err);}return;
    }
    if(id==='kcf-new-installation'){
      const v=Object.fromEntries(new FormData(form));dialog.close();
      await run(async()=>{const r=await mutate('/installations',{operationId:newOp(),name:v.name,identity:{applicationUrl:v.applicationUrl,tenant:v.tenant,company:v.company,connectorId:v.connectorId}},'Create retained installation');await processResult(r);S.message='Installation identity retained. Add the actual source exports.';});return;
    }
    if(id==='kcf-remove-binding'){
      const v=Object.fromEntries(new FormData(form));
      S.draft.removals.push({table:v.table,sourceKey:v.table==='shippingBinding'?'':v.sourceKey,reason:v.reason});
      S.recipe=null;S.preview=null;dialog.close();render();return;
    }
    if(id==='kcf-select-edition'){
      const v=Object.fromEntries(new FormData(form));dialog.close();
      await run(async()=>processResult(await mutate(basePath()+'/select',{operationId:newOp(),expectedRevision:S.head.revision,editionId:v.editionId,recipeId:'',reason:v.reason},'Select retained source edition')));return;
    }
    if(id==='kcf-apply-form'){
      const v=Object.fromEntries(new FormData(form));
      await run(async()=>{
        if(!S.recipe||!S.preview?.ready||S.preview.recipeId!==S.recipe.id)throw Error('Save and review the exact recipe before applying it.');
        await processResult(await mutate(basePath()+'/recipes/'+S.recipe.id+'/apply',{operationId:newOp(),expectedCurrentMapId:S.recipe.baseMapId,previewSha256:S.preview.sha256,reason:v.applyReason,allowHistoricalSource:Object.hasOwn(v,'historicalSource')},'Apply the reviewed ERP mapping'));
      });return;
    }
    await run(async()=>{
      if(id==='kcf-capture'){
        const c=S.capture,fields=Object.create(null);
        for(const f of c.fields){if(!f.label&&!f.pointer)continue;if(!f.label)throw Error('Give every selected comparison field a label.');if(Object.hasOwn(fields,f.label))throw Error('Comparison labels must be unique.');fields[f.label]=f.pointer;}
        const body={operationId:newOp(),slot:c.slot,scope:{family:c.family,coverage:c.coverage,selection:c.selection,ids:c.selection==='IDS'?lines(c.ids):[],filter:c.selection==='FILTER'?c.filter:'',window:c.window,activeSelection:c.activeSelection},
          source:{screen:c.screen,reference:c.reference,observedAt:c.observedAt||null,note:c.note},profile:{rowPointer:c.rowPointer,identityPointers:lines(c.identityPointers),fields}};
        if(S.reuseReceiptId)body.reuseReceiptId=S.reuseReceiptId;
        else{const f=await fileBytes(S.upload,S.status.limits.fileBytes);body.file={name:S.upload.name,format:c.format,delimiter:c.delimiter,...f};}
        await processResult(await mutate(basePath()+'/receipts',body,'Retain original source file and scope'));
      }else if(id==='kcf-edition-form'){
        await processResult(await mutate(basePath()+'/editions',{operationId:newOp(),expectedRevision:S.head.revision,label:S.editionLabel,receiptIds:Array.from(S.selectedReceipts),metadata:clone(S.metadata),reason:S.editionReason},'Freeze the selected source edition'));
      }else if(id==='kcf-map-form'){
        await processResult(await mutate(basePath()+'/recipes',{operationId:newOp(),expectedRevision:S.head.revision,...clone(S.draft)},'Retain the source-to-map recipe'));
      }else if(id==='kcf-compare-form'){S.comparePage=1;await compareLoad();}
      else if(id==='kcf-review-form'){
        if(!S.comparison)throw Error('Read the source comparison first.');
        await processResult(await mutate(basePath()+'/reviews',{operationId:newOp(),expectedRevision:S.head.revision,beforeId:S.comparison.beforeId,afterId:S.comparison.afterId,selectionSha256:S.comparison.selectionSha256,disposition:S.reviewDisposition,reason:S.reviewReason,recipeId:S.recipe?.sourceEditionId===S.comparison.afterId?S.recipe.id:''},'Retain the source change review'));
      }else if(id==='kcf-export-form'){
        const p=await api(basePath()+'/export?includeOrders='+String(S.includeOrders));saveFile('connector-'+idShort(S.iid)+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',json(p)+'\n');S.message='Complete private project downloaded with digest '+p.sha256+'.';
      }else if(id==='kcf-import-form'){
        const project=await importJson(S.importFile,S.status.limits.projectBytes);const {sha256,...content}=project;
        if(project.schema!=='stellar-forge.sf104.connector-project.v1'||!sha256||await digestCanonical(content)!==sha256)throw Error('The complete connector project does not match its recorded digest.');
        await processResult(await mutate('/import',{operationId:newOp(),project},'Receive the complete private connector project'));S.importFile=null;S.message='Complete private source project received. Review imported original orders in Order delivery.';
      }else if(id==='kcf-operation-form'){
        const v=Object.fromEntries(new FormData(form));const result=await api(basePath()+'/operations/'+encodeURIComponent(v.operation));openDialog('Retained operation result',details('Exact operation and current selection',result));
      }
    });
  }
  root.addEventListener('submit',event=>{if(!event.target.matches('form'))return;event.preventDefault();submitForm(event.target).catch(err=>{S.message=err.message;S.error=true;render();});});
  root.addEventListener('input',event=>{
    if(event.target.closest('#kcf-capture'))captureVisible();
    if(event.target.closest('#kcf-edition-form')){captureVisible();S.selectionDirty=true;}
    if(event.target.closest('#kcf-map-form')){captureVisible();S.recipe=null;S.preview=null;const apply=document.querySelector('#kcf-apply-form button[type=submit]');if(apply){apply.disabled=true;apply.title='Save and review the edited recipe before applying it.';}}
  });
  root.addEventListener('change',event=>{
    const t=event.target;
    if(t.name==='installationSelect'){S.installationChoice=t.value;return;}
    if(t.id==='kcf-upload'){captureVisible();S.upload=t.files[0]||null;if(S.upload){S.reuseReceiptId='';if(/\.tsv$/i.test(S.upload.name)){S.capture.format='csv';S.capture.delimiter='\t';}else if(/\.csv$/i.test(S.upload.name))S.capture.format='csv';else if(/\.json$/i.test(S.upload.name))S.capture.format='json';
      const f=document.querySelector('#kcf-capture [name=format]'),d=document.querySelector('#kcf-capture [name=delimiter]'),r=document.querySelector('#kcf-capture [name=reuseReceiptId]');
      if(f)f.value=S.capture.format;if(d)d.value=S.capture.delimiter;if(r)r.value='';}return;}
    if(t.id==='kcf-import-file'){S.importFile=t.files[0]||null;return;}
    if(t.dataset.selectReceipt){
      const id=t.dataset.selectReceipt,r=S.receiptCache.get(id);
      if(t.checked){for(const old of S.selectedReceipts)if(S.receiptCache.get(old)?.slot===r.slot)S.selectedReceipts.delete(old);S.selectedReceipts.add(id);}
      else S.selectedReceipts.delete(id);S.selectionDirty=true;captureVisible();render();return;
    }
    if(t.closest('#kcf-value-editor')&&['valueMode','targetMode','bindingTable'].includes(t.name)){
      try{captureEditor();if(S.editor.kind==='assignment'&&!S.editor.target.path){S.editor.target.table ||= 'productBindings';const fields=S.editor.target.table==='customerBindings'?['customerId','locationId']:['inventoryId','uom','taxCategory','warehouseId'];if(!fields.includes(S.editor.target.field))S.editor.target.field=fields[0];S.editor.target.sourceKey ||= '';}
        if(Object.hasOwn(S.editor.rule,'constant')&&!S.editor.rule.constant.type)S.editor.rule.constant={type:'string',value:''};S.browser=null;renderEditor();
      }catch(err){dialogError(err);}return;
    }
    if(t.id==='kcf-pending-file')run(async()=>{
      const p=await importJson(t.files[0],S.status.limits.projectBytes);
      const pathOk=/^\/installations(?:\/[a-f0-9]{64}\/(?:receipts|editions|recipes|reviews|select|recipes\/[a-f0-9]{64}\/apply))?$/.test(p.path)||p.path==='/import';
      if(p.schema!=='stellar-forge.sf104.connector-pending-request.v1'||!pathOk||typeof p.body?.operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(p.body.operationId))throw Error('Select an exact saved pending connector request.');
      if(S.pending)throw Error('Keep the currently unresolved request before loading another.');
      if(p.installationId&&p.installationId!==S.iid)await loadInstallation(p.installationId,true);S.pending=p;S.message='The exact request is loaded. Check its result before retrying.';
    });
  });

  root.addEventListener('toggle',event=>{
    const el=event.target;if(!el.matches?.('details[data-detail]')||!el.open||el.dataset.filled)return;
    const value=D.get(el.dataset.detail),pre=document.createElement('pre');pre.textContent=value===undefined?'Reopen this detail from the current record.':json(value);el.querySelector('div').append(pre);el.dataset.filled='true';
  },true);
  root.addEventListener('click',event=>{
    const b=event.target.closest('button[data-action],button[data-view]');if(!b||b.disabled)return;
    if(b.dataset.view){captureVisible();S.view=b.dataset.view;render();return;}
    const action=b.dataset.action;captureVisible();
    if(action==='close-dialog'){dialog.close();S.editor=null;S.browser=null;return;}
    if(action==='new-installation'){
      openDialog('Create an installation','<form id="kcf-new-installation"><div class="kcf-grid">'+
        input('name','Installation name','','','required maxlength="160"')+
        input('applicationUrl','Acumatica application URL','','Include the installed virtual-directory path.','required type="url"')+
        input('tenant','Exact tenant identity','','Case and leading zeros remain unchanged.','required maxlength="200"')+
        input('company','Exact company identity','','','required maxlength="200"')+
        input('connectorId','Exact connector ID','','','required maxlength="200"')+
        '</div><p class="help">Plugin identity, versions and customization packages are recorded with each source edition.</p><div class="kcf-actions"><button class="primary" type="submit">Retain installation identity</button></div></form>');return;
    }
    if(action==='add-projection'){S.capture.fields.push({label:'',pointer:''});render();return;}
    if(action==='remove-projection'){S.capture.fields.splice(Number(b.dataset.index),1);render();return;}
    if(action==='add-credential'){S.metadata ||= emptyMeta();S.metadata.credentialReferences.push({name:'',environmentVariable:''});S.selectionDirty=true;render();return;}
    if(action==='remove-credential'){S.metadata.credentialReferences.splice(Number(b.dataset.index),1);S.selectionDirty=true;render();return;}
    if(action==='unselect-receipt'){S.selectedReceipts.delete(b.dataset.id);S.selectionDirty=true;render();return;}
    if(action==='remove-assignment'){S.draft.assignments.splice(Number(b.dataset.index),1);S.recipe=null;S.preview=null;S.assignmentPage=Math.max(1,Math.min(S.assignmentPage,Math.ceil(S.draft.assignments.length/25)));render();return;}
    if(action==='remove-removal'){S.draft.removals.splice(Number(b.dataset.index),1);S.recipe=null;S.preview=null;render();return;}
    if(action==='add-removal'){
      openDialog('Remove an exact original binding','<form id="kcf-remove-binding"><div class="kcf-grid">'+
        select('table','Original table',S.status.mappingTables,'productBindings')+
        input('sourceKey','Exact source key','','Use the existing binding’s complete source key. Shipping is a single binding with no key.')+'</div>'+
        area('reason','Reason for this explicit removal','','A missing row in a partial export never performs this action.','required maxlength="2000"')+
        '<div class="kcf-actions"><button type="submit" class="primary">Keep removal in recipe</button></div></form>');return;
    }
    if(action==='enable-substitutions'){S.draft.substitutions={unmappedCountries:'preserve',unmappedStates:'preserve',countries:[],states:[]};S.recipe=null;S.preview=null;render();return;}
    if(action==='disable-substitutions'){S.draft.substitutions=null;S.recipe=null;S.preview=null;render();return;}
    if(action==='add-substitution'){
      const name=b.dataset.table,fields=name==='countries'?['connectorCountry','acumaticaCountry']:['connectorCountry','acumaticaCountry','connectorState','acumaticaState'];
      const r={};for(const f of fields)r[f]={constant:{type:'string',value:''},conversion:'preserve'};
      S.draft.substitutions[name].push(r);S.subPage[name]=Math.ceil(S.draft.substitutions[name].length/25);S.recipe=null;S.preview=null;render();return;
    }
    if(action==='remove-substitution'){S.draft.substitutions[b.dataset.table].splice(Number(b.dataset.index),1);S.subPage[b.dataset.table]=Math.max(1,Math.min(S.subPage[b.dataset.table],Math.ceil(S.draft.substitutions[b.dataset.table].length/25)));S.recipe=null;S.preview=null;render();return;}
    if(action==='add-translation'||action==='remove-translation'){
      try{captureEditor();S.editor.rule.values ||= [];if(action==='add-translation')S.editor.rule.values.push({from:{type:'string',value:''},to:{type:'string',value:''}});else S.editor.rule.values.splice(Number(b.dataset.index),1);renderEditor();}catch(err){dialogError(err);}return;
    }
    if(action==='browse-node'||action==='browse-go'||action==='browse-up'||action==='browse-page'||action==='browse-use'||action==='browse-copy'||action==='editor-browse'){
      (async()=>{
        if(action==='browse-use'){captureEditor();S.editor.rule={...S.editor.rule,receiptId:S.browser.rid,pointer:b.dataset.pointer};delete S.editor.rule.constant;S.browser=null;renderEditor();return;}
        if(action==='browse-copy'){if(navigator.clipboard)await navigator.clipboard.writeText(b.dataset.pointer);else{const f=document.getElementById('kcf-browse-pointer');f.value=b.dataset.pointer;f.select();}return;}
        if(action==='editor-browse'){captureEditor();const id=S.editor.rule.receiptId;if(!/^[a-f0-9]{64}$/.test(id||''))throw Error('Select the retained receipt first.');S.browser={rid:id,pointer:'',page:1,result:null};renderBrowser();await loadBrowser();return;}
        if(!S.browser)return;
        if(action==='browse-node')S.browser={...S.browser,pointer:b.dataset.pointer,page:1,result:null};
        if(action==='browse-go')S.browser={...S.browser,pointer:document.getElementById('kcf-browse-pointer').value,page:1,result:null};
        if(action==='browse-up')S.browser={...S.browser,pointer:S.browser.pointer.slice(0,S.browser.pointer.lastIndexOf('/')),page:1,result:null};
        if(action==='browse-page')S.browser={...S.browser,page:S.browser.page+Number(b.dataset.delta),result:null};
        renderBrowser();await loadBrowser();
      })().catch(dialogError);return;
    }
    if(action==='pending-download'){saveFile('connector-pending-'+S.pending.body.operationId+'.json',json(S.pending)+'\n');return;}
    if(action==='pending-dismiss'){saveFile('connector-pending-'+S.pending.body.operationId+'.json',json(S.pending)+'\n');S.pending=null;S.message='The original request was downloaded. The retained server operation remains available by its ID; the page can now prepare different work.';render();return;}
    if(action==='page'&&['assignments','preview','sub-countries','sub-states'].includes(b.dataset.list)){
      const k=b.dataset.list,delta=Number(b.dataset.delta);
      if(k==='assignments')S.assignmentPage+=delta;else if(k==='preview')S.previewPage+=delta;else S.subPage[k.slice(4)]+=delta;render();return;
    }
    run(async()=>{
      if(action==='refresh'){await refresh();S.message='Retained source and original map selection refreshed. Unsaved drafts remain in the page.';return;}
      if(action==='open-installation'){const id=S.installationChoice;if(!id)throw Error('Select a retained installation.');await loadInstallation(id,true);return;}
      if(action==='inspect-receipt'){showReceipt(await api(basePath()+'/receipts/'+b.dataset.id));return;}
      if(action==='download-receipt'){await downloadOriginal(b.dataset.id);return;}
      if(action==='reuse-receipt'){
        const r=S.receiptCache.get(b.dataset.id)||await api(basePath()+'/receipts/'+b.dataset.id);S.receiptCache.set(r.id,r);S.reuseReceiptId=r.id;S.upload=null;
        S.capture={slot:r.slot,format:r.format,delimiter:r.delimiter,screen:r.source.screen,reference:r.source.reference,observedAt:'',note:r.source.note,
          ...r.scope,ids:r.scope.ids.join('\n'),rowPointer:r.profile.rowPointer,identityPointers:r.profile.identityPointers.join('\n'),
          fields:Object.entries(r.profile.fields).map(([label,pointer])=>({label,pointer}))};
        S.view='sources';S.message='The original bytes are selected for a new observation. Record its actual scope and source time.';return;
      }
      if(action==='inspect-edition'){const x=await api(basePath()+'/editions/'+b.dataset.id);openDialog(x.label,details('Complete immutable source edition',x));return;}
      if(action==='select-edition'){
        const x=await api(basePath()+'/editions/'+b.dataset.id);
        openDialog('Use retained source edition','<form id="kcf-select-edition"><p>'+e(x.label)+' · '+e(x.createdAt)+'</p><input type="hidden" name="editionId" value="'+x.id+'">'+
          area('reason','Reason to select this source edition','','Selecting a source does not change the current ERP map or any order.','required maxlength="4000"')+
          '<div class="kcf-actions"><button class="primary" type="submit">Use this retained source</button></div></form>');return;
      }
      if(action==='new-recipe'){await newRecipe();return;}
      if(action==='new-recipe-after'){await newRecipe(S.comparison.afterId);return;}
      if(action==='open-recipe'){await openRecipe(b.dataset.id);return;}
      if(action==='add-assignment'){await beginEditor('assignment',-1);return;}
      if(action==='edit-assignment'){await beginEditor('assignment',Number(b.dataset.index));return;}
      if(action==='edit-substitution'){await beginEditor('substitution',Number(b.dataset.index),b.dataset.table,b.dataset.field);return;}
      if(action==='preview-draft'){S.preview=await api(basePath()+'/preview',{recipe:clone(S.draft)});S.previewPage=1;return;}
      if(action==='recipe-impacts'){await openRecipe(b.dataset.id);S.impactPage=1;S.impacts=await api(basePath()+'/recipes/'+b.dataset.id+'/impacts?page=1&limit=50');return;}
      if(action==='page'){
        const name=b.dataset.list,delta=Number(b.dataset.delta);
        if(name==='installations'){S.installationPage+=delta;S.status=await api('?page='+S.installationPage+'&limit=50');}
        else if(name==='comparison'){S.comparePage+=delta;await compareLoad();}
        else if(name==='impacts'){S.impactPage+=delta;S.impacts=await api(basePath()+'/recipes/'+S.recipe.id+'/impacts?page='+S.impactPage+'&limit=50');}
        else{S.pages[name]+=delta;await loadList(name);}return;
      }
      if(action==='pending-retry'){
        const p=S.pending;if(!p)return;const result=await api(p.path,p.body);S.pending=null;await processResult(result);S.message ||= 'The exact retained request completed.';return;
      }
      if(action==='pending-check'){
        const p=S.pending;if(!p)return;
        const iid=p.installationId||S.iid;if(!iid)throw Error('The creation request has no installation result yet. Retry its exact original ID to read or complete it.');
        const op=await api('/installations/'+iid+'/operations/'+encodeURIComponent(p.body.operationId));
        if(op.data.state==='DONE'){S.pending=null;await processResult(op.data.result);S.message='The original operation is complete. Its retained result was reopened.';}
        else openDialog('Original operation is pending',details('Exact retained state and current selection',op));
      }
    });
  });
  dialog.addEventListener('close',()=>{S.editor=null;S.browser=null;});
  run(async()=>{
    S.status=await api('');
    const id=new URLSearchParams(location.search).get('installation');
    if(id&&/^[a-f0-9]{64}$/.test(id))await loadInstallation(id,true);
    else if(S.status.items.length===1)await loadInstallation(S.status.items[0].id,true);
  });
})();
