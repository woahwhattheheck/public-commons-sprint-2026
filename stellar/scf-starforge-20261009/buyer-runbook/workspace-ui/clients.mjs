// MIT. Original customer SDK receiving and request composition presentation.
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readable=value=>String(value??'').toLowerCase().replaceAll('_',' ');
const time=value=>value?new Date(value).toLocaleString():'—';
const count=value=>Number(value).toLocaleString();
async function base64(file,limit) {
  if(!file||file.size>limit)throw new Error('Choose a file of up to '+count(limit)+' bytes.');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let index=0;index<bytes.length;index+=16384)binary+=String.fromCharCode(...bytes.subarray(index,index+16384));
  return btoa(binary);
}
function jsonObject(text,label) {
  let value;try{value=JSON.parse(text);}catch{throw new Error(label+' must be a JSON object.');}
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must be a JSON object.');
  return value;
}

/** The same complete option display is used by SDK and native-request review. */
export function paymentOptionsTable(rows) {
  return '<table class="client-options"><thead><tr><th>Option</th><th>Scheme</th><th>Network</th><th>Exact asset</th><th>Recipient</th><th>Atomic amount</th><th>Timeout</th><th>Original extra metadata</th></tr></thead><tbody>'+
    rows.map(({index,terms,error})=>error?'<tr><td>'+escape(index+1)+'</td><td colspan="7">'+escape(readable(error))+'</td></tr>':
      '<tr><td>'+escape(index+1)+'</td><td>'+escape(terms.scheme)+'</td><td>'+escape(terms.network)+'</td><td><code>'+escape(terms.asset)+'</code></td><td><code>'+escape(terms.payTo)+'</code></td><td class="atomic">'+escape(terms.amount??terms.maxAtomic)+'</td><td>'+escape(terms.maxTimeoutSeconds)+' s</td><td><pre>'+escape(JSON.stringify(terms.extra??{},null,2))+'</pre></td></tr>').join('')+'</tbody></table>';
}

export function createSellerClientUI({request,notice,refreshState,openPanel,onRequest}) {
  let state={clients:[],files:[]},selected=null,operation=null,busy=false,generation=0;
  function bodyControls() {
    const body=operation&&['POST','PUT','PATCH'].includes(operation.method),form=operation?.bodyType==='form-data';
    const optional=body&&operation.bodyRequired===false,omitted=optional&&$('#client-omit-body').checked;
    const wire=$('#client-form-mode').value==='wire';
    $('#client-omit-label').hidden=!optional;
    $('#client-omit-body').disabled=busy||!optional;
    $('#client-body-area').hidden=!body||omitted;
    $('#client-json-area').hidden=Boolean(form);
    $('#client-multipart-area').hidden=!form;
    $('#client-form-builder').hidden=wire;$('#client-form-wire').hidden=!wire;
    $('#client-ticket-area').hidden=operation?.method!=='POST';
    for(const element of $('#client-ticket-area').querySelectorAll('input'))element.disabled=busy||operation?.method!=='POST';
    for(const element of $('#client-json-area').querySelectorAll('input,textarea'))element.disabled=busy||!body||omitted||form;
    $('#client-json-body').required=Boolean(body&&!omitted&&!form);
    for(const element of $('#client-multipart-area').querySelectorAll('input,textarea,select,button'))element.disabled=busy||!body||omitted||!form;
    for(const element of $('#client-form-builder').querySelectorAll('input,textarea,button'))element.disabled=busy||!body||omitted||!form||wire;
    for(const element of $('#client-form-wire').querySelectorAll('input'))element.disabled=busy||!body||omitted||!form||!wire;
    $('#client-multipart-file').required=Boolean(body&&!omitted&&form&&wire);
    $('#client-multipart-type').required=Boolean(body&&!omitted&&form&&wire);
  }
  function disabled() {
    for(const element of document.querySelectorAll('#client-upload-form input,#client-upload-form button,#client-request-form input,#client-request-form textarea,#client-request-form button,#client-request-form select'))
      element.disabled=busy;
    $('#client-operation').disabled=busy||selected?.state!=='COMPLETE';
    $('#compose-client-request').disabled=busy||!operation||new URL(selected.manifest.origin).protocol!=='https:';
    bodyControls();
  }
  function renderList() {
    $('#client-count').textContent=String(state.clients.length);
    $('#client-list').innerHTML=state.clients.length?state.clients.map(item=>
      '<button class="request-row '+(selected?.id===item.id?'selected':'')+'" data-client="'+escape(item.id)+'"><span><strong>'+escape(item.title)+'</strong><small>'+escape(item.origin)+' · '+item.operations+' operations</small></span><span class="badge">'+(item.state==='COMPLETE'?'Complete':item.missingFiles.length+' missing')+'</span></button>').join(''):
      '<p class="muted">Received SDKs and their original files remain available here after reopening.</p>';
    $('#client-errors').textContent=(state.errors??[]).map(item=>readable(item.code)).join('; ');
  }
  function renderOperation() {
    $('#client-operation-detail').hidden=!operation;
    $('#client-form-files').replaceChildren();
    $('#client-intent').value='';$('#client-query').value='{}';$('#client-json-body').value='';
    $('#client-omit-body').checked=false;$('#client-form-fields').value='{}';$('#client-form-mode').value='fields';
    $('#client-multipart-file').value='';$('#client-multipart-type').value='';
    $('#client-ticket').value='';$('#client-ticket-header').value='';
    if(operation) {
      $('#client-options').innerHTML=paymentOptionsTable(operation.offer.accepts.map((terms,index)=>({index,terms})));
      $('#client-schema').textContent=JSON.stringify({method:operation.method,path:operation.path,openapiPath:operation.openapiPath,
        parameters:operation.parameters,requestBody:operation.requestBody,
        originalBazaar:operation.offer.extensions.bazaar},null,2);
      $('#client-path-inputs').innerHTML=operation.pathNames.map(name=>
        '<label>Path · '+escape(name)+'<input data-client-path="'+escape(name)+'" required maxlength="1024" autocomplete="off"></label>').join('');
      $('#client-body-limit').textContent=['POST','PUT','PATCH'].includes(operation.method)?
        'Exact body limit: '+count(Math.min(operation.maxRequestBytes,state.maxRequestBodyBytes))+' bytes.':'This operation has no request body.';
    }
    disabled();
  }
  function renderSelected({preserveForm=false}={}) {
    $('#client-detail').hidden=!selected;if(!selected){operation=null;disabled();return;}
    const item=selected,manifest=item.manifest,oldId=operation?.id;
    $('#client-title').textContent=item.title;$('#client-state').textContent=item.state==='COMPLETE'?'Original files complete':'Upload remaining files';
    $('#client-summary').innerHTML='<div><dt>Merchant origin</dt><dd>'+escape(manifest.origin)+'</dd></div><div><dt>Receipt completion</dt><dd>'+escape(readable(manifest.completion))+' · '+escape(time(manifest.completedAt))+'</dd></div><div><dt>Received here</dt><dd>'+escape(time(item.receivedAt))+'</dd></div><div><dt>Source mode</dt><dd>'+escape(manifest.mode)+'</dd></div><div class="wide"><dt>Original OpenAPI SHA-256</dt><dd><code>'+escape(manifest.sourceSha256)+'</code></dd></div><div class="wide"><dt>Completion receipt SHA-256</dt><dd><code>'+escape(item.manifestSha256)+'</code></dd></div>';
    const fileRows=[{name:'client-export.json',state:'RETAINED',bytes:null,sha256:item.manifestSha256},...item.files];
    $('#client-files').innerHTML='<table class="client-files"><thead><tr><th>Original file</th><th>Bytes</th><th>SHA-256</th><th>Retained file</th></tr></thead><tbody>'+fileRows.map(file=>
      '<tr><td>'+escape(file.name)+'</td><td>'+(file.bytes===null?'Receipt':count(file.bytes))+'</td><td><code>'+escape(file.sha256)+'</code></td><td>'+(file.state==='RETAINED'?'<a class="button quiet" href="/files/clients/'+item.id+'/'+file.name+'">Download</a>':'Upload required')+'</td></tr>').join('')+'</tbody></table>';
    $('#client-operation-area').hidden=item.state!=='COMPLETE';
    $('#client-origin-note').hidden=new URL(manifest.origin).protocol==='https:';
    $('#client-origin-note').textContent='This SDK retains its local HTTP origin. Native buyer preparation requires an HTTPS merchant origin in the original seller export. Its original files and operations remain available for inspection here.';
    $('#client-operation').innerHTML='<option value="">Choose an operation</option>'+item.operations.map(op=>'<option value="'+escape(op.id)+'">'+escape(op.method+' '+op.path+' · '+op.id)+'</option>').join('');
    operation=preserveForm?item.operations.find(op=>op.id===oldId)??null:null;
    $('#client-operation').value=operation?.id??'';
    if(!preserveForm||!operation)renderOperation();
    $('#client-request-list').innerHTML=item.requests.length?item.requests.map(entry=>
      '<button class="request-row" data-client-request="'+entry.requestId+'"><span><strong>'+escape(entry.summary.method??'POST')+' '+escape(new URL(entry.summary.url).pathname)+'</strong><small>'+escape(entry.intentId)+'</small></span><span class="badge">'+(entry.prepared?'Buyer ready':'Review request')+'</span></button>').join(''):
      '<p class="muted">Retaining a configured request adds it here and opens the original payment review.</p>';
    disabled();renderList();
  }
  async function open(id) {
    const current=++generation,preserveForm=selected?.id===id;openPanel();notice('');
    const value=await request('/api/clients/'+id);
    if(current!==generation)return;
    selected=value;renderSelected({preserveForm});
  }
  async function action(fn) {
    if(busy)return;busy=true;disabled();notice('');
    try{await fn();}catch(error){notice(error.message,true);}
    finally{busy=false;disabled();}
  }
  for(const id of ['open-clients','welcome-clients'])$('#'+id).addEventListener('click',()=>{openPanel();renderList();});
  $('#client-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-client]');
    if(button&&!busy)open(button.dataset.client).catch(error=>notice(error.message,true));
  });
  $('#client-upload-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    const files=[...$('#client-upload').files],seen=new Set();
    if(!files.length)throw new Error('Select the original SDK files.');
    for(const file of files) {
      if(seen.has(file.name)||!state.files.includes(file.name))throw new Error('Select each of the six original filenames at most once.');
      seen.add(file.name);
    }
    const receipt=files.find(file=>file.name==='client-export.json');
    if(receipt){selected=await request('/api/clients/upload',{base64:await base64(receipt,state.maxReceiptBytes)});operation=null;generation++;}
    else if(!selected)throw new Error('Include client-export.json when receiving a new SDK.');
    try {
      for(const file of files.filter(file=>file.name!=='client-export.json')) {
        const expected=selected.manifest.files.find(item=>item.name===file.name);
        if(file.size!==expected.bytes)throw new Error(file.name+' has a different size from the original receipt.');
        $('#client-upload-progress').textContent='Retaining '+file.name+'…';
        selected=await request('/api/clients/file',{id:selected.id,file:file.name,base64:await base64(file,expected.bytes)});
      }
    } catch(error) {
      // A lost response may follow a completed immutable file publication.
      // Reopen its receipt before showing which original files remain missing.
      try {selected=await request('/api/clients/'+selected.id);await refreshState();}catch{}
      renderSelected({preserveForm:false});
      $('#client-upload-progress').textContent=selected.files.filter(file=>file.state==='MISSING').length+' original files still need upload. Select those files to continue.';
      throw error;
    }
    await refreshState();renderSelected({preserveForm:false});$('#client-upload').value='';
    $('#client-upload-progress').textContent=selected.state==='COMPLETE'?'All five original files and the completion receipt are retained.':
      selected.files.filter(file=>file.state==='MISSING').length+' original files still need upload.';
    $('#client-detail').scrollIntoView({block:'start'});
  });});
  $('#client-operation').addEventListener('change',()=>{
    operation=selected?.operations.find(item=>item.id===$('#client-operation').value)??null;renderOperation();
  });
  $('#client-omit-body').addEventListener('change',bodyControls);
  $('#client-form-mode').addEventListener('change',bodyControls);
  $('#client-add-file').addEventListener('click',()=>{
    const rows=$('#client-form-files');
    if(rows.children.length>=64){notice('Use up to 64 file selections in this form.',true);return;}
    const row=document.createElement('div');row.className='client-file-part';
    row.innerHTML='<label>Declared field<input data-form-field required maxlength="80" autocomplete="off"></label><label>File<input data-form-file type="file" required></label><label>Content-Type<input data-form-type maxlength="127" placeholder="From selected file"></label><button type="button" class="quiet" data-remove-file>Remove</button>';
    rows.append(row);bodyControls();
  });
  $('#client-form-files').addEventListener('click',event=>{if(event.target.closest('[data-remove-file]'))event.target.closest('.client-file-part').remove();});
  $('#client-request-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-client-request]');
    if(button&&!busy)action(()=>onRequest(button.dataset.clientRequest));
  });
  $('#client-request-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    if(!selected||!operation)throw new Error('Choose an operation from the retained SDK.');
    const path=Object.fromEntries([...document.querySelectorAll('[data-client-path]')].map(input=>[input.dataset.clientPath,input.value]));
    const values={path,query:jsonObject($('#client-query').value,'Query parameters')};
    if(['POST','PUT','PATCH'].includes(operation.method)) {
      if(operation.bodyRequired===false&&$('#client-omit-body').checked)values.omitBody=true;
      else if(operation.bodyType!=='form-data')values.body=$('#client-json-body').value;
      else if($('#client-form-mode').value==='wire') {
        const file=$('#client-multipart-file').files[0];
        values.multipart={base64:await base64(file,Math.min(operation.maxRequestBytes,state.maxRequestBodyBytes)),contentType:$('#client-multipart-type').value};
      } else {
        const files=[];let total=0;
        for(const row of document.querySelectorAll('.client-file-part')) {
          const file=row.querySelector('[data-form-file]').files[0];
          if(!file)throw new Error('Choose a file for every declared file part.');
          total+=file.size;if(total>state.maxRequestBodyBytes)throw new Error('The selected files exceed the original buyer body limit.');
          files.push({field:row.querySelector('[data-form-field]').value,filename:file.name,
            contentType:row.querySelector('[data-form-type]').value||file.type||'application/octet-stream',
            base64:await base64(file,state.maxRequestBodyBytes)});
        }
        values.form={fields:jsonObject($('#client-form-fields').value,'Form fields'),files};
      }
    }
    const input={id:selected.id,expectedManifestSha256:selected.manifestSha256,
      operationId:operation.id,intentId:$('#client-intent').value,values};
    const ticket=$('#client-ticket').files[0];
    if(ticket)input.ticket={base64:await base64(ticket,16384),
      ...($('#client-ticket-header').value?{header:$('#client-ticket-header').value}:{})};
    const result=await request('/api/clients/request',input);
    selected=await request('/api/clients/'+selected.id);await refreshState();renderSelected({preserveForm:true});
    await onRequest(result.request.id);
    notice('Exact request retained. Review a payment option and your local budget in the original receiving workflow.');
  });});
  return {update(value){state=value??{clients:[],files:[]};renderList();disabled();},
    async refresh(){if(selected)await open(selected.id);else renderList();}};
}
