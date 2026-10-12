const boot=globalThis.REPORT_DESK,base=boot.apiBase,scope=location.origin+base,key='groundwater-report:'+scope;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem(key+':access')??'',state=null,busy=false,selectedReport=null,preview=null,uploads={},jobs=[],catalogRows=[];
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access')){token=fragment.get('access');sessionStorage.setItem(key+':access',token);history.replaceState(null,'',location.pathname+'#overview');}
const draft=JSON.parse(localStorage.getItem(key+':draft')??'{}');
let retained=JSON.parse(localStorage.getItem(key+':pending')??'null'),volatileRequest=null;
const id=prefix=>prefix+'-'+crypto.randomUUID(),show=v=>'<pre>'+esc(JSON.stringify(v,null,2))+'</pre>';
const title={overview:'Report distribution',reports:'Frozen scientific reports',publish:'File publication',buyer:'Buyer preparation',receiving:'Report receiving',operations:'Operations & recovery',handover:'Complete handover'};
function notice(message,error=false){$('#notice').className='notice'+(error?' error':'');$('#notice').textContent=message;}
function actor(){const value=$('#actor').value.trim();if(!value)throw Error('Enter the recording operator.');return value;}
function draftKey(el){return (el.closest('form')?.id??routes())+':'+el.dataset.draft;}
function saveDraft(){
  for(const el of document.querySelectorAll('[data-draft]'))if(el.type!=='file')draft[draftKey(el)]=el.type==='checkbox'?el.checked:el.value;
  draft.actor=$('#actor').value;localStorage.setItem(key+':draft',JSON.stringify(draft));
}
function restoreDraft(){for(const el of document.querySelectorAll('[data-draft]'))if(Object.hasOwn(draft,draftKey(el))){if(el.type==='checkbox')el.checked=draft[draftKey(el)];else el.value=draft[draftKey(el)];}}
function input(name,label,value='',options=''){return '<label>'+esc(label)+'<input data-draft="'+esc(name)+'" name="'+esc(name)+'" value="'+esc(value)+'" '+options+'></label>';}
function area(name,label,value=''){return '<label class="wide">'+esc(label)+'<textarea data-draft="'+esc(name)+'" name="'+esc(name)+'">'+esc(value)+'</textarea></label>';}
function select(name,label,items,first='Select an original record'){return '<label>'+esc(label)+'<select data-draft="'+esc(name)+'" name="'+esc(name)+'"><option value="">'+esc(first)+'</option>'+items.map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('')+'</select></label>';}
function jsonDetails(label,value){return '<details><summary>'+esc(label)+'</summary>'+show(value)+'</details>';}
function values(form){return Object.fromEntries(new FormData(form));}
function opInput(form,prefix){const data=values(form);data.operationId=data.operationId||id(prefix);form.elements.operationId.value=data.operationId;saveDraft();return data;}
function publicationRows(){return(state?.operations??[]).filter(x=>x.action==='publish'&&x.state==='RECORDED_COMPLETE');}
function pendingBar(){
  const el=$('#pending');el.hidden=!retained;
  if(retained)el.innerHTML='Retained request <code>'+esc(retained.operationId??retained.action)+'</code> · '+esc(retained.action)+
    ' <button data-pending="inspect">Read original</button> <button data-pending="continue">Continue original</button> <button data-pending="dismiss">Dismiss local notice</button>';
}
async function api(path,body){
  const r=await fetch(base+'/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;try{result=await r.json();}catch{throw Error('The response was incomplete. Read the retained original operation before continuing.');}
  if(!r.ok)throw Object.assign(Error(result.error?.message??'The original action was rejected.'),result.error??{});
  return result;
}
function metadataRequest(envelope){
  const copy=structuredClone(envelope);
  if(copy.input.files)for(const row of Object.values(copy.input.files))delete row.base64;
  if(copy.input.catalog?.base64)delete copy.input.catalog.base64;
  return copy;
}
async function action(name,input){
  const envelope={action:name,input};
  retained={scope,action:name,operationId:input.operationId??null,request:metadataRequest(envelope),createdAt:new Date().toISOString()};
  volatileRequest=envelope;localStorage.setItem(key+':pending',JSON.stringify(retained));pendingBar();
  const result=await api('action',envelope);
  retained=null;volatileRequest=null;localStorage.removeItem(key+':pending');pendingBar();
  await refresh(false);return result;
}
async function refresh(renderPage=true){
  state=await api('state');if(state.desk.id!==boot.deskId)throw Error('The server opened another report desk.');
  $('#identity').textContent=state.desk.id; if(renderPage)await render();
}
function routes(){return (location.hash.slice(1).split('?')[0]||'overview');}
function form(id,body,label){return '<form id="'+id+'"><div class="fields">'+body+'</div><div class="actions"><button class="primary" type="submit">'+label+'</button>'+
  (body.includes('name="operationId"')?'<button type="button" data-new-id="'+id+'">Start a new reviewed operation</button>':'')+'</div></form>';}
async function render(){
  saveDraft();const route=routes();$('#title').textContent=title[route]??title.overview;
  for(const a of document.querySelectorAll('nav a'))a.setAttribute('aria-current',a.hash==='#'+route?'page':'false');
  let html='';
  if(route==='overview'){
    const ops=state.operations;
    html='<div class="metrics">'+[['Frozen publications',ops.filter(x=>x.action==='publish'&&x.state==='RECORDED_COMPLETE').length],['Buyer preparations',ops.filter(x=>x.action==='buyer-prepare').length],['Received report reviews',ops.filter(x=>x.action==='receive'&&x.state==='RECORDED_COMPLETE').length],['Retained unfinished operations',ops.filter(x=>x.state==='PENDING').length]].map(([l,n])=>'<div class="metric"><span>'+l+'</span><strong>'+n+'</strong></div>').join('')+'</div>'+
      '<div class="card"><h2>One frozen report, complete receiving</h2><p>Open an approved report from the original groundwater workspace, review its source and unit findings, then freeze a file product with explicit payment terms. The maintained merchant serves the exact report bytes. Buyer preparation uses the original catalog and SF88 configuration.</p><p>After the existing buyer finishes its operation, select its saved handoff and actual response ZIP. The original readers verify the report and purchase separately. An attributed receiving decision may then be linked to the selected Operations case and deployment.</p><div class="evidence"><strong>Original scientific context stays visible</strong><p>The publisher recharge discrepancy, legacy and MF6 unit declarations, steady-state time semantics, mapped aquifers and native budget definitions stay in the complete report. This desk does not run a solver or recalculate those results.</p></div></div>'+
      '<div class="card"><h2>Configured connections</h2><p>Scientific workspace: '+(state.sourceConfigured?'configured for existing report reads':'not configured; buyer receiving remains available')+'<br>Original SF47 Operations: '+(state.operationsConfigured?esc(state.operationsOrigin):'not configured; file receiving remains available')+'</p>'+jsonDetails('Persistent desk identity',state.desk)+'</div>';
  }else if(route==='reports'){
    const data=await api('reports');
    html='<div class="card"><h2>Original report inventory</h2><p>Each selection reopens the frozen report and verifies every named export through the original application.</p><table><thead><tr><th>Report</th><th>Original identity</th><th>Action</th></tr></thead><tbody>'+data.reports.map(r=>'<tr><td>'+esc(r.title??r.id)+'</td><td><code>'+esc(r.id)+'</code><br><code>'+esc(r.sha256)+'</code></td><td><button data-report="'+esc(r.id)+'">Inspect frozen report</button></td></tr>').join('')+'</tbody></table></div><div id="detail"></div>';
  }else if(route==='publish'){
    html='<div class="card"><h2>Review the exact source</h2><div class="inline">'+input('sourceReportId','Original report ID',selectedReport?.report.id??'')+'<button type="button" id="load-report">Load report</button></div><div id="source-detail">'+(selectedReport?reportDetails(selectedReport):'')+'</div></div>'+
      '<div class="card"><h2>Freeze a native file product</h2><p>The complete ZIP is required. JSON, HTML and CSV are optional separately priced companions. The HTML companion refers to report members and figures; use the full ZIP for its complete context.</p>'+
      form('publish-form',input('operationId','Original publication operation ID',id('report-publication'))+input('reportId','Frozen report ID',selectedReport?.report.id??'')+
        input('expectedReportSha256','Report SHA-256',selectedReport?.report.sha256??'')+input('expectedManifestSha256','Manifest SHA-256',selectedReport?.manifest.sha256??'')+
        input('expectedArchiveSha256','Full ZIP SHA-256',selectedReport?.exports.zip.sha256??'')+input('title','Public service title · 1–32 ASCII characters','','maxlength="32"')+
        area('description','Public description')+area('license','Attribution and permitted use')+area('reason','Why this exact report and source findings are suitable for this file publication')+
        input('origin','Actual public HTTPS origin','https://reports.example.org')+input('routePrefix','Fixed versioned route prefix','/groundwater/report-v1')+
        select('formatSet','Published files',[['zip','Complete ZIP'],['zip,json,csv','ZIP + JSON + CSV'],['zip,json,html,csv','ZIP + JSON + HTML + CSV']])+
        area('payment','Exact original payment terms JSON',JSON.stringify({scheme:'exact',network:'stellar:testnet',asset:'',amount:'',payTo:'',maxTimeoutSeconds:60},null,2)),
        'Freeze report and native offers')+'</div><div id="detail"></div>';
  }else if(route==='buyer'){
    const options=publicationRows().map(x=>[x.id,x.id]);
    html='<div class="two"><div class="card"><h2>Prepare the original buyer review</h2><p>Preparation records no purchase. Use the downloaded original configuration with the maintained SF88 buyer and its existing authorized signing workflow.</p>'+
      form('buyer-form',input('operationId','Preparation operation ID',id('report-buyer'))+select('publicationId','Original publication',options)+
        select('format','Published format',[['zip','Complete report ZIP'],['json','JSON companion'],['html','HTML companion'],['csv','CSV companion']])+
        input('acceptIndex','Explicit payment option index','0','type="number" min="0"')+input('intentId','Original buyer intent ID')+
        input('responseOut','New absolute buyer response path'), 'Prepare buyer configuration')+'</div>'+
      '<div class="card"><h2>Capture a completed original Inbox selection</h2><p>Choose the existing Inbox and exact intent IDs. The original reader makes one capture; an uncertain publication remains the same attempt.</p>'+
      form('capture-form',input('operationId','Capture operation ID',id('report-capture'))+input('inboxDirectory','Original private Inbox directory')+
        area('intentIds','Original intent IDs · one per line'), 'Capture selected original jobs')+'</div></div>'+
      '<div class="card"><h2>Prepare from an original public catalog</h2><p>A buyer can prepare the existing SF88 configuration without access to the merchant’s private workspace. Select the complete public catalog and explicit row and payment option.</p><label>Original public catalog<input type="file" data-file="catalog"><span id="file-state-catalog" class="hint">'+(uploads.catalog?esc(uploads.catalog.sha256):'No file selected')+'</span></label>'+
      form('catalog-buyer-form',input('operationId','Preparation operation ID',id('catalog-buyer'))+input('rowIndex','Original catalog row index','0','type="number" min="0"')+
        input('acceptIndex','Accepted payment option index','0','type="number" min="0"')+input('intentId','Original buyer intent ID')+
        input('responseOut','New absolute buyer response path'),'Prepare from this exact catalog')+'</div>'+
      '<div class="card"><h2>Published file services</h2><p>The operator opens the maintained native service. Without an explicitly configured facilitator it returns challenges only. Public hosting and the original signer remain in their existing deployment.</p>'+publicationsTable()+'</div><div id="detail"></div>';
  }else if(route==='receiving'){
    html='<div class="card"><h2>Select complete original evidence</h2><p>Select the original public catalog, the retained private SF88 handoff, and the buyer’s actual report response ZIP. Files stay in memory until this original operation saves them; after a reload reselect the same bytes.</p><div class="files">'+
      [['catalog','Public catalog · up to 1 MiB'],['handoff','Original SF88 handoff · up to 8 MiB'],['response','Actual purchased complete ZIP · up to 16 MiB']].map(([n,l])=>'<label>'+l+'<input type="file" id="file-'+n+'" data-file="'+n+'"><span id="file-state-'+n+'" class="hint">'+(uploads[n]?esc(uploads[n].sha256):'No file selected')+'</span></label>').join('')+'</div><div class="actions"><button type="button" id="inspect-inputs">Inspect saved buyer jobs and catalog</button></div><div id="buyer-inputs"></div></div>'+
      '<div class="card"><h2>Explicit receiving selection</h2>'+form('preview-form',input('operationId','Preview operation ID',id('report-preview'))+
        input('rowIndex','Original catalog row index','0','type="number" min="0"')+input('acceptIndex','Original accepted payment option index','0','type="number" min="0"')+
        select('jobId','Original Inbox job',jobs.map(r=>[r.jobId,r.intentId+' · '+r.output.state]))+input('caseId','Existing Operations case ID · optional')+
        area('reason','Your report receiving review reason')+select('decision','File receiving decision',[['received','Received for the stated purpose'],['changes_requested','Changes requested']]),'Preview exact report and Operations association')+'</div>'+
      '<div id="preview">'+(preview?previewDetails(): '')+'</div><div id="detail"></div>';
  }else if(route==='operations'){
    html='<div class="card"><h2>Original operation history</h2><p>Read a saved result before continuing after an uncertain response. A completed publication or receiving result is verified against its original files. No payment operation is repeated by this desk.</p>'+operationsTable()+'</div>'+
      '<div class="card"><h2>Read an exact original operation</h2><div class="inline">'+input('inspectOperationId','Original operation ID')+'<button id="inspect-operation" type="button">Read original</button><button id="continue-operation" type="button">Continue original</button></div></div><div id="detail"></div>';
  }else if(route==='handover'){
    html='<div class="two"><div class="card"><h2>Export the complete report desk</h2><p>Retain every frozen report product, original selected catalog and handoff, exact purchased ZIP, receiving review and native Operations request/receipt. The complete package can reopen independently with the installed original application.</p>'+
      form('export-form',input('operationId','Export operation ID',id('report-export'))+input('destination','New absolute ZIP path outside this desk'),'Export complete desk')+'</div>'+
      '<div class="card"><h2>Restore an exact saved desk</h2><p>Restore creates a new destination and retains the same desk and operation identities. The original desk remains available. Use the returned directory in a new local server launch.</p>'+
      form('restore-form',input('archive','Original complete desk ZIP path')+input('destination','New empty restore destination')+
        input('expectedSha256','Exact original ZIP SHA-256')+input('expectedBytes','Exact original ZIP bytes','','type="number" min="1"'),'Restore original desk')+'</div></div><div id="detail"></div>';
  }else{location.hash='#overview';return;}
  $('#main').innerHTML=html;restoreDraft();pendingBar();
}
function reportDetails(data){return '<h3>'+esc(data.report.title)+'</h3><p><code>'+esc(data.report.id)+'</code> · original run <code>'+esc(data.run.id)+'</code></p>'+
  '<div class="evidence"><strong>Retained source findings and units</strong>'+show({timeSemantics:data.timeSemantics,units:data.units,findings:data.findings})+'</div>'+
  jsonDetails('Exact frozen report, review and export identities',data)+'<button type="button" data-use-report="'+esc(data.report.id)+'">Use this exact report for publication</button>';}
function operationsTable(){return '<table><thead><tr><th>Action and original ID</th><th>State</th><th>Recorded by</th><th>Read / continue</th></tr></thead><tbody>'+state.operations.map(r=>'<tr><td>'+esc(r.action)+'<br><code>'+esc(r.id)+'</code></td><td><span class="tag">'+esc(r.state)+'</span></td><td>'+esc(r.actor)+'<br><small>'+esc(r.createdAt)+'</small></td><td><div class="row-actions"><button data-original="'+esc(r.id)+'">Original</button><button data-continue="'+esc(r.id)+'">Continue</button></div></td></tr>').join('')+'</tbody></table>';}
function publicationsTable(){return '<table><thead><tr><th>Original publication</th><th>Files and service</th></tr></thead><tbody>'+publicationRows().map(r=>'<tr><td><code>'+esc(r.id)+'</code></td><td><div class="row-actions"><button data-publication="'+esc(r.id)+'">Inspect</button><button data-download="catalog" data-id="'+esc(r.id)+'">Catalog</button><button data-service="'+esc(r.id)+'">Start local service</button><button data-stop="'+esc(r.id)+'">Drain and stop</button></div></td></tr>').join('')+'</tbody></table>'+jsonDetails('Current native service states',state.services??[]);}
function previewDetails(){
  const p=preview,ops=p.operations;
  const deploy=ops?.preview.deployments??[],purchases=ops?.preview.purchases??[];
  return '<div class="card"><h2>Review the exact receiving preview</h2>'+show({binding:p.binding,buyer:{intentId:p.selection.intentId,url:p.selection.url,payment:p.selection.row.purchase,output:p.selection.row.output}})+
    jsonDetails('Complete original report member manifest',p.manifest)+(ops?jsonDetails('Original current Operations preview',ops):'')+
    form('receive-form',input('operationId','Receiving operation ID',draft.receivingOperationId??id('report-receive'))+
      (ops?select('deploymentId','Explicit existing buyer deployment',deploy.map(x=>[x.id,(x.name??x.id)+' · '+x.id]))+
        select('purchaseId','Original purchase association',[[ '__new__','Create from this original intent if unmatched'],...purchases.map(x=>[x.id,(x.intentId??x.id)+' · '+x.id])]):'')+
      '<div class="wide evidence">This decision records your receiving review. It keeps the original payment, technical findings, merchant order status and customer acceptance separate.</div>','Record report receiving and selected association')+'</div>';
}
function result(value,buttons=''){$('#detail').innerHTML='<div class="card"><h2>Original result</h2>'+show(value)+buttons+'</div>';}
async function download(operationId,kind,format){
  const query=new URLSearchParams({id:operationId,kind,...(format?{format}:{})});
  const response=await fetch(base+'/download?'+query,{headers:{authorization:'Bearer '+token}});
  if(!response.ok){const d=await response.json();throw Error(d.error?.message??'Original download unavailable.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??'original-download';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function fileRecord(file,limit){
  if(!file||file.size>limit)throw Error('Select the complete file within its declared byte limit.');
  const raw=new Uint8Array(await file.arrayBuffer()),hash=await crypto.subtle.digest('SHA-256',raw);
  const sha256=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  let binary='';for(let i=0;i<raw.length;i+=32768)binary+=String.fromCharCode(...raw.subarray(i,i+32768));
  return {base64:btoa(binary),bytes:raw.length,sha256};
}
function requireFiles(){if(!uploads.catalog||!uploads.handoff||!uploads.response)throw Error('Reselect all three complete original files.');return uploads;}
async function perform(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn();}catch(e){notice((e.code?e.code+': ':'')+e.message,true);}finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;}}
document.addEventListener('input',e=>{if(e.target.matches('[data-draft],#actor'))saveDraft();});
document.addEventListener('change',e=>{if(e.target.dataset.file)void perform(async()=>{
  const name=e.target.dataset.file;uploads[name]=await fileRecord(e.target.files[0],{catalog:1048576,handoff:8388608,response:16777216}[name]);
  $('#file-state-'+name).textContent=uploads[name].bytes+' bytes · '+uploads[name].sha256;preview=null;
});});
document.addEventListener('submit',e=>{e.preventDefault();void perform(async()=>{
  const form=e.target;
  if(form.id==='publish-form'){
    const v=opInput(form,'report-publication'),{operationId,formatSet,payment,...input}=v;
    const r=await action('publish',{operationId,actor:actor(),input:{...input,formats:formatSet.split(','),payment:JSON.parse(payment)}});
    result(r,'<button data-download="catalog" data-id="'+esc(operationId)+'">Download native catalog</button>');
  }else if(form.id==='buyer-form'){
    const v=opInput(form,'report-buyer');v.acceptIndex=Number(v.acceptIndex);
    result(await action('buyer.prepare',{...v,actor:actor()}),'<button data-download="buyer-config" data-id="'+esc(v.operationId)+'">Download original buyer configuration</button>');
  }else if(form.id==='catalog-buyer-form'){
    if(!uploads.catalog)throw Error('Select the original public catalog.');
    const v=opInput(form,'catalog-buyer');v.rowIndex=Number(v.rowIndex);v.acceptIndex=Number(v.acceptIndex);
    result(await action('buyer.prepare-catalog',{...v,actor:actor(),catalog:uploads.catalog}),
      '<button data-download="buyer-config" data-id="'+esc(v.operationId)+'">Download original buyer configuration</button>');
  }else if(form.id==='capture-form'){
    const v=opInput(form,'report-capture');v.intentIds=v.intentIds.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    result(await action('buyer.capture',{...v,actor:actor()}),'<button data-download="handoff" data-id="'+esc(v.operationId)+'">Download private original handoff</button>');
  }else if(form.id==='preview-form'){
    const v=opInput(form,'report-preview'),{operationId,...input}=v;
    input.rowIndex=Number(input.rowIndex);input.acceptIndex=Number(input.acceptIndex);if(!input.caseId)delete input.caseId;
    preview=await action('receiving.preview',{operationId,actor:actor(),input,files:requireFiles()});
    preview.reviewInput=input;$('#preview').innerHTML=previewDetails();restoreDraft();
  }else if(form.id==='receive-form'){
    if(!preview)throw Error('Review the original receiving preview first.');
    const v=opInput(form,'report-receive'),input={...preview.reviewInput};
    if(preview.operations){input.deploymentId=v.deploymentId;input.purchaseId=v.purchaseId==='__new__'?null:v.purchaseId;
      input.expectedCaseVersion=preview.operations.case.version;input.expectedPreviewSha256=preview.operations.preview.previewSha256;}
    const r=await action('receiving.commit',{operationId:v.operationId,actor:actor(),input,files:requireFiles()});
    result(r,'<button data-download="review" data-id="'+esc(v.operationId)+'">Download receiving review</button> <button data-download="report" data-id="'+esc(v.operationId)+'">Download original report ZIP</button>');
  }else if(form.id==='export-form'){
    const v=opInput(form,'report-export'),r=await action('desk.export',{...v,actor:actor()});
    result(r,'<button data-download="complete-export" data-id="'+esc(v.operationId)+'">Download complete desk archive</button>');
  }else if(form.id==='restore-form'){
    const v=values(form);v.expectedBytes=Number(v.expectedBytes);result(await action('desk.restore',v));
  }
  notice('Original action recorded. Its source and result identities are retained.');
});});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.type==='submit')return;
  void perform(async()=>{
    if(b.dataset.newId){const form=$('#'+b.dataset.newId);form.elements.operationId.value=id(b.dataset.newId);saveDraft();notice('A new review ID is ready. The previous operation remains in history.');return;}
    if(b.id==='refresh'){saveDraft();await refresh();return;}
    if(b.dataset.download){await download(b.dataset.id,b.dataset.download,b.dataset.format);return;}
    if(b.dataset.report||b.id==='load-report'){
      const rid=b.dataset.report??$('[name="sourceReportId"]').value;selectedReport=await api('report?id='+encodeURIComponent(rid));
      if(b.id==='load-report'){$('#source-detail').innerHTML=reportDetails(selectedReport);for(const [field,value]of Object.entries({reportId:selectedReport.report.id,expectedReportSha256:selectedReport.report.sha256,expectedManifestSha256:selectedReport.manifest.sha256,expectedArchiveSha256:selectedReport.exports.zip.sha256})){const el=$('#publish-form [name="'+field+'"]');el.value=value;}saveDraft();}
      else $('#detail').innerHTML='<div class="card">'+reportDetails(selectedReport)+'</div>';return;
    }
    if(b.dataset.useReport){draft['publish-form:reportId']=selectedReport.report.id;draft['publish:sourceReportId']=selectedReport.report.id;draft['publish-form:expectedReportSha256']=selectedReport.report.sha256;
      draft['publish-form:expectedManifestSha256']=selectedReport.manifest.sha256;draft['publish-form:expectedArchiveSha256']=selectedReport.exports.zip.sha256;draft['publish-form:title']=selectedReport.report.title.slice(0,32);localStorage.setItem(key+':draft',JSON.stringify(draft));location.hash='#publish';return;}
    if(b.dataset.original||b.id==='inspect-operation'){result(await api('operation?id='+encodeURIComponent(b.dataset.original??$('[name="inspectOperationId"]').value)));return;}
    if(b.dataset.continue||b.id==='continue-operation'){result(await action('continue',{operationId:b.dataset.continue??$('[name="inspectOperationId"]').value}));return;}
    if(b.dataset.publication){result(await api('publication?id='+encodeURIComponent(b.dataset.publication)));return;}
    if(b.dataset.service){result(await action('service.start',{publicationId:b.dataset.service}));return;}
    if(b.dataset.stop){result(await action('service.stop',{publicationId:b.dataset.stop}));return;}
    if(b.id==='inspect-inputs'){
      requireFiles();
      const r=await api('action',{action:'buyer.inspect',input:{handoff:uploads.handoff}});
      jobs=r.rows;
      const catalog=JSON.parse(atob(uploads.catalog.base64));catalogRows=catalog.resources??[];
      const select=$('[name="jobId"]');select.innerHTML='<option value="">Select an original job</option>'+jobs.map(j=>'<option value="'+esc(j.jobId)+'">'+esc(j.intentId+' · '+j.output.state)+'</option>').join('');
      $('#buyer-inputs').innerHTML=jsonDetails('Original buyer interpretations',r)+show(catalogRows.map((r,index)=>({rowIndex:index,resource:r.resource,accepts:r.accepts,asset:r.extensions?.['stellar-forge-asset']})));return;
    }
    if(b.dataset.pending){
      if(b.dataset.pending==='dismiss'){retained=null;volatileRequest=null;localStorage.removeItem(key+':pending');pendingBar();return;}
      if(!retained?.operationId)throw Error('This was a live service or restore request. Read its saved output or current service state.');
      const original=await api('operation?id='+encodeURIComponent(retained.operationId)).catch(e=>{if(e.code==='ORIGINAL_FILE_UNAVAILABLE')return null;throw e;});
      if(b.dataset.pending==='inspect'){notice(original?JSON.stringify(original.result??{state:'PENDING',request:original.request}):'No original request was recorded; reselect the same files and original fields.');return;}
      if(original){const r=await api('action',{action:'continue',input:{operationId:retained.operationId}});notice(JSON.stringify(r));}
      else if(volatileRequest){notice(JSON.stringify(await api('action',volatileRequest)));}
      else throw Error('Reselect the exact original files and fields before retrying this saved operation ID.');
      retained=null;volatileRequest=null;localStorage.removeItem(key+':pending');pendingBar();await refresh(false);
    }
  });
});
window.addEventListener('hashchange',()=>{void perform(render);});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
$('#actor').value=draft.actor??'';
pendingBar();void perform(async()=>{if(!token)throw Error('Open the private launch link printed by the original report desk server.');await refresh();});
