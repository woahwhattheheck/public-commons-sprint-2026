// Receive complete accepted exports through the original Workspace transaction.
const SCHEMA = 'staff-market.classification-receiving/v1';
const API = '/api/extensions/classification/';
const MAX_SOURCE = 24 * 1024 * 1024;
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashText = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function mountClassificationReceiving(target, api, callbacks = {}) {
  const doc = target.ownerDocument, win = doc.defaultView;
  const workspaceId = api.getState().workspace.id;
  let disposed = false, busy = false, readSequence = 0, selectionSequence = 0, fileSequence = 0;
  let dbPromise = null, writes = Promise.resolve(), active = Promise.resolve();
  let history = {items:[],total:0,next_cursor:null}, opened = null, documentPages = {preview:0,received:0};
  let retained = {actor:'',origin_workspace_id:'',source_ref:'',notes:'',source:null,preview:null,
    pending:null,completed:null,declined:null,opened_id:null,history_cursor:'0',previous_cursors:[]};
  const disabled = new Map(), urls = new Set();
  const root = el('section',undefined,'classification-receiving');
  const notice = el('div',undefined,'notice'), contents = el('div');
  notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  root.setAttribute('aria-label','Receive accepted classification packages');
  const style = el('style');
  style.textContent = '.classification-receiving .cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.classification-receiving .cr-id{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.classification-receiving .cr-summary{display:flex;gap:22px;flex-wrap:wrap}.classification-receiving .cr-summary strong{font-size:22px;display:block}.classification-receiving .cr-history{margin-top:24px}.classification-receiving .cr-source{border:1px solid #c7cdd2;padding:14px;margin:14px 0}.classification-receiving pre{white-space:pre-wrap;overflow-wrap:anywhere}.classification-receiving th,.classification-receiving td{vertical-align:top}.classification-receiving table{min-width:630px}.classification-receiving .cr-actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.classification-receiving input,.classification-receiving textarea{min-width:0;max-width:100%;box-sizing:border-box}.classification-receiving .cr-pages{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.classification-receiving .cr-warning{border-left:3px solid #9b742e;padding:4px 12px}@media(max-width:680px){.classification-receiving .cr-grid{grid-template-columns:1fr}.classification-receiving .cr-actions button{max-width:100%}}';
  root.append(style,notice,contents);target.replaceChildren(root);
  for (const name of ['click','submit','input','change']) root.addEventListener(name,event=>event.stopPropagation());

  function el(tag,text,className){const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text??'');if(className)n.className=className;return n;}
  function panel(title){const n=el('section',undefined,'panel');n.append(el('h3',title));return n;}
  function hint(text){return el('p',text,'cl-meta');}
  function pre(value){return el('pre',typeof value==='string'?value:JSON.stringify(value,null,2),'cr-id');}
  function details(title,node){const n=el('details');n.append(el('summary',title),node);return n;}
  function actions(...nodes){const n=el('div',undefined,'cr-actions');n.append(...nodes);return n;}
  function button(title,work,primary=false){const n=el('button',title,primary?'primary':'');n.type='button';n.addEventListener('click',()=>perform(work));return n;}
  function table(headers,rows){const wrap=el('div',undefined,'scroll'),t=el('table'),head=el('thead'),body=el('tbody'),tr=el('tr');
    for(const text of headers){const th=el('th',text);th.scope='col';tr.append(th);}head.append(tr);
    for(const cells of rows){const row=el('tr');for(const value of cells){const td=el('td');td.append(value?.nodeType?value:doc.createTextNode(String(value??'—')));row.append(td);}body.append(row);}
    t.append(head,body);wrap.append(t);return wrap;}
  function field(title,key,multiline=false){const label=el('label',title),n=el(multiline?'textarea':'input');
    if(!multiline)n.type='text';n.value=retained[key];n.setAttribute('aria-label',title);n.disabled=!!retained.pending;
    n.addEventListener('input',()=>{retained[key]=n.value;retained.preview=null;updatePreviewAvailability();void persist();});label.append(n);return label;}
  function show(message,error=false){if(disposed)return;notice.className='notice'+(error?' error':'');notice.textContent=message;}
  function ensureWorkspace(){if(disposed||api.getState().workspace.id!==workspaceId)throw new Error('Reopen this receiving request in its original workspace.');}
  function lock(){for(const control of root.querySelectorAll('button,input,textarea,select')){if(!disabled.has(control))disabled.set(control,control.disabled);control.disabled=true;}}
  function perform(work){
    if(disposed||busy)return active;
    busy=true;root.setAttribute('aria-busy','true');lock();
    active=(async()=>{try{await persist();await work();await persist();}
      catch(error){show(error.message||String(error),true);if(error.details)notice.append(pre(error.details));}
      finally{busy=false;root.removeAttribute('aria-busy');for(const [control,value]of disabled)control.disabled=value;disabled.clear();}})();
    return active;
  }
  function database(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=win.indexedDB.open('staff-market-classification-receiving',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});
    return dbPromise;
  }
  function persist(){
    const snapshot=clone(retained);
    writes=writes.catch(()=>{}).then(async()=>{const db=await database();await new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(snapshot,workspaceId);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Receiving draft storage was interrupted.'));});});
    writes.catch(error=>show('The receiving draft could not be saved: '+error.message,true));return writes;
  }
  function validSource(source){
    if(!object(source)||typeof source.filename!=='string'||typeof source.content_base64!=='string'||
       !hashText(source.sha256)||!Number.isInteger(source.bytes)||source.bytes<1||source.bytes>MAX_SOURCE)
      throw new Error('The saved original source descriptor is incomplete.');
    if(source.content_base64.length>Math.ceil(MAX_SOURCE/3)*4)throw new Error('The saved source exceeds the receiving limit.');
    return source;
  }
  function pendingShape(value){
    if(!object(value)||!['preview_package','receive_package'].includes(value.action)||!object(value.body)||
       typeof value.body.operation_id!=='string'||!Number.isInteger(value.body.expected_revision)||
       value.workspace_id!==workspaceId)throw new Error('The saved request does not describe this workspace.');
    if(value.path!==API+value.action)throw new Error('The saved request path differs from its original action.');
    for(const key of ['content_base64','filename','expected_source_sha256','actor','origin_workspace_id','source_ref','notes'])
      if(typeof value.body[key]!=='string')throw new Error('The saved request has an incomplete '+key+' field.');
    return value;
  }
  async function readDraft(){
    const db=await database();const value=await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),r=tx.objectStore('drafts').get(workspaceId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    if(!value)return;
    try{
      if(!object(value))throw new Error('The saved editor is not an object.');
      for(const key of ['actor','origin_workspace_id','source_ref','notes'])if(typeof value[key]!=='string')throw new Error('The saved '+key+' field is incomplete.');
      if(value.source)validSource(value.source);if(value.pending)pendingShape(value.pending);
      if(value.preview&&(!object(value.preview)||value.preview.schema!==SCHEMA||value.preview.receiving_workspace_id!==workspaceId||
        !Array.isArray(value.preview.documents)||!Array.isArray(value.preview.roots)))throw new Error('The saved receiving preview is incomplete.');
      if(value.opened_id!==null&&typeof value.opened_id!=='string')throw new Error('The saved receiving selection is incomplete.');
      if(typeof value.history_cursor!=='string'||!/^(0|[1-9][0-9]{0,8})$/.test(value.history_cursor)||
        !Array.isArray(value.previous_cursors)||value.previous_cursors.some(x=>typeof x!=='string'||!/^(0|[1-9][0-9]{0,8})$/.test(x)))throw new Error('The saved history page is invalid.');
      retained={...retained,...value};
    }catch(error){retained.recovery={message:error.message,original:value};show('The saved editor needs correction. Its complete original draft is retained below.',true);}
  }
  async function sha(bytes){return Array.from(new Uint8Array(await win.crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
  function encode(bytes){let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return win.btoa(value);}
  function decode(text){const value=win.atob(text),bytes=new Uint8Array(value.length);for(let i=0;i<value.length;i++)bytes[i]=value.charCodeAt(i);return bytes;}
  function saveBytes(bytes,filename,type='application/octet-stream'){
    const url=win.URL.createObjectURL(new win.Blob([bytes],{type}));urls.add(url);const a=el('a');a.href=url;a.download=filename;root.append(a);a.click();a.remove();
    win.setTimeout(()=>{win.URL.revokeObjectURL(url);urls.delete(url);},1000);
  }
  function saveJSON(value,name){saveBytes(new win.TextEncoder().encode(JSON.stringify(value,null,2)+'\n'),name,'application/json');}
  async function selectFile(file){
    if(!file)return;ensureWorkspace();if(retained.pending)throw new Error('Finish the saved receiving request before selecting another source.');
    if(file.size<1||file.size>MAX_SOURCE)throw new Error('Choose a complete accepted JSON or ZIP no larger than 24 MiB.');
    const sequence=++fileSequence,bytes=new Uint8Array(await file.arrayBuffer()),hash=await sha(bytes);
    ensureWorkspace();if(sequence!==fileSequence)return;
    if(bytes.length!==file.size)throw new Error('The selected original file could not be read completely.');
    retained.source={filename:file.name,bytes:bytes.length,sha256:hash,content_base64:encode(bytes)};
    retained.preview=null;documentPages={preview:0,received:0};await persist();render();show('The exact original file is retained. Enter its source handoff and preview the receiving changes.');
  }
  function payload(){
    if(!retained.source)throw new Error('Select the complete original accepted export.');
    validSource(retained.source);
    if(!retained.actor.trim())throw new Error('Enter the operator receiving this case.');
    if(!retained.source_ref.trim())throw new Error('Enter the original handoff or source reference.');
    return {content_base64:retained.source.content_base64,filename:retained.source.filename,
      expected_source_sha256:retained.source.sha256,actor:retained.actor.trim(),
      origin_workspace_id:retained.origin_workspace_id.trim(),source_ref:retained.source_ref.trim(),notes:retained.notes.trim()};
  }
  async function start(action){
    ensureWorkspace();if(retained.pending)throw new Error('Resume the original saved request first.');
    const args=payload();
    if(action==='receive_package'){
      if(!retained.preview)throw new Error('Preview the current original source before receiving.');
      args.expected_preview_sha256=retained.preview.preview_sha256;
    }
    retained.pending={workspace_id:workspaceId,action,path:API+action,created_at:new Date().toISOString(),
      body:{operation_id:win.crypto.randomUUID(),expected_revision:api.getState().workspace.revision,...args}};
    await persist();render();await continueRequest();
  }
  function validateResponse(request,response){
    if(!object(response)||!Number.isInteger(response.revision)||!object(response.result))throw new Error('The returned native request result is incomplete; its full return is retained.');
    const value=request.action==='receive_package'?response.result.receipt:response.result;
    if(!object(value)||value.schema!==SCHEMA||value.receiving_workspace_id!==workspaceId||
       !object(value.source)||value.source.sha256!==request.body.expected_source_sha256||
       value.source.filename!==request.body.filename||!Array.isArray(value.documents)||!Array.isArray(value.roots))
      throw new Error('The returned source identity differs from the saved request; its full return is retained.');
    for(const key of ['actor','origin_workspace_id','source_ref','notes'])
      if(value.context?.[key]!==request.body[key])throw new Error('The returned receiving context differs from the saved '+key+'.');
    if(request.action==='receive_package'&&(value.kind!=='received_package'||!hashText(value.sha256)||
       (value.preview_sha256!==request.body.expected_preview_sha256&&response.result.reused!==true)))throw new Error('The receiving record differs from the selected original preview.');
    if(!hashText(value.preview_sha256))throw new Error('The native preview identity is absent.');
    return value;
  }
  async function continueRequest(){
    ensureWorkspace();const pending=pendingShape(retained.pending);
    if(pending.declined)throw new Error('Review the returned refusal before preparing another request.');
    if(!pending.returned){
      try{
        const response=await api.mutate(pending.path,clone(pending.body));
        pending.returned=clone(response);pending.returned_at=new Date().toISOString();
        // Persist the actual native return before any view refresh or selection changes.
        await persist();
      }catch(error){
        if(!pending.returned){
          pending.error={message:error.message||String(error),status:error.status??null,code:error.code??null,at:new Date().toISOString()};
          pending.declined=Number.isInteger(error.status)&&error.status>=400&&error.status<500;
          await persist();
        }
        render();throw error;
      }
    }
    const value=validateResponse(pending,pending.returned);
    if(pending.action==='preview_package'){retained.preview=value;documentPages={preview:0,received:0};}
    else{
      ++selectionSequence;opened=value;retained.opened_id=value.id;retained.preview=null;
      retained.history_cursor='0';retained.previous_cursors=[];documentPages={preview:0,received:0};
    }
    retained.completed={operation_id:pending.body.operation_id,action:pending.action,source_sha256:pending.body.expected_source_sha256,
      request_revision:pending.body.expected_revision,returned_at:pending.returned_at,response:clone(pending.returned)};
    retained.pending=null;await persist();render();
    show(pending.action==='receive_package'?'The original accepted documents and reviews are received. Open each exact edition or download the complete retained source below.':'The current receiving preview is ready.');
    try{await api.refresh(false);ensureWorkspace();if(pending.action==='receive_package')await callbacks.onReceived?.();await refresh();}
    catch(error){show('The native result is saved. The latest workspace view could not refresh: '+error.message,true);}
  }
  async function closeDeclined(){
    if(!retained.pending?.declined)throw new Error('Keep this original request available for native replay.');
    retained.declined=clone(retained.pending);retained.pending=null;retained.preview=null;
    await persist();render();show('The returned refusal remains retained. Review the source and prepare a new preview.');
  }
  async function openReceipt(id){
    ensureWorkspace();const sequence=++selectionSequence;retained.opened_id=id;await persist();
    const value=await api.request(API+'document/received/'+encodeURIComponent(id));
    if(disposed||sequence!==selectionSequence||retained.opened_id!==id||api.getState().workspace.id!==workspaceId)return;
    if(value.id!==id||value.schema!==SCHEMA||value.receiving_workspace_id!==workspaceId)throw new Error('The selected receiving record was not returned.');
    opened=value;documentPages={preview:0,received:0};render();
  }
  async function refresh(){
    if(disposed)return;ensureWorkspace();const sequence=++readSequence,selected=retained.opened_id,selection=selectionSequence,cursor=retained.history_cursor;
    const next=await api.request(API+'document/received-page/'+encodeURIComponent(cursor));
    if(disposed||sequence!==readSequence||api.getState().workspace.id!==workspaceId)return;
    if(!Array.isArray(next.items)||!Number.isInteger(next.total))throw new Error('The complete receiving-history page was not returned.');
    history=next;
    if(selected){
      const value=await api.request(API+'document/received/'+encodeURIComponent(selected));
      if(disposed||sequence!==readSequence||selection!==selectionSequence||retained.opened_id!==selected||api.getState().workspace.id!==workspaceId)return;
      if(value.id!==selected||value.schema!==SCHEMA||value.receiving_workspace_id!==workspaceId)throw new Error('The selected receiving record differs.');
      opened=value;
    }
    if(!disposed&&sequence===readSequence)render();
  }
  async function download(kind,id,filename,expected=null){
    ensureWorkspace();const response=await win.fetch(API+'download/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id),{cache:'no-store'});
    if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error||'This original export is not currently available.');}
    const bytes=new Uint8Array(await response.arrayBuffer());ensureWorkspace();
    if(expected&&(bytes.length!==expected.bytes||await sha(bytes)!==expected.sha256))throw new Error('The complete downloaded bytes differ from the selected original source.');
    saveBytes(bytes,filename,response.headers.get('Content-Type')||'application/octet-stream');
  }
  function updatePreviewAvailability(){
    const receive=root.querySelector('[data-receive-package]');if(receive)receive.disabled=true;
    const stale=root.querySelector('[data-package-preview-state]');if(stale)stale.textContent='The source or receiving context changed. Preview the current input before receiving.';
  }
  function requestPanel(){
    const p=panel('Saved receiving request'),pending=retained.pending;
    p.append(hint('The original request is retained before dispatch and reopens with the same operation ID.'),pre({operation_id:pending.body.operation_id,
      action:pending.action,request_revision:pending.body.expected_revision,source_sha256:pending.body.expected_source_sha256,created_at:pending.created_at}));
    if(pending.error)p.append(hint(pending.error.message));
    p.append(actions(button(pending.returned?'Apply retained native result':'Resume original request',continueRequest,true),
      button('Download complete saved request',()=>saveJSON(pending,'classification-receiving-request.json'))));
    if(pending.declined)p.append(button('Review draft after returned refusal',closeDeclined));
    return p;
  }
  function overview(value,received=false){
    const p=panel(received?'Received original case':'Review the original source and receiving changes'),summary=el('div',undefined,'cr-summary');
    for(const [label,count]of [['Accepted scenarios',value.roots.length],['Original documents',value.documents.length],['Original reviews',value.review_count]]){
      const n=el('div',label);n.append(el('strong',count));summary.append(n);
    }
    p.append(summary,hint(value.history_scope),hint('The saved package supplies its original classification documents and review history. This workspace records the receiving operation and any subsequent work.'));
    if(value.context.origin_workspace_id)p.append(hint('Original workspace identified by the source handoff: '+value.context.origin_workspace_id));
    p.append(hint('Source handoff: '+value.context.source_ref),hint('Receiving workspace: '+workspaceId));
    if(received)p.append(hint('Received '+value.received_at+' by '+value.received_by+' · local revision '+value.receiving_revision),
      pre({id:value.id,sha256:value.sha256,source:value.source}),
      actions(button('Download exact received source',()=>download('received-original',value.id,value.source.filename,value.source)),
        button('Download complete receiving record',()=>download('received-manifest',value.id,value.id+'.json'))));
    else{
      const state=hint('This preview selects the current source bytes, complete review history and existing workspace editions.');state.dataset.packagePreviewState='';p.append(state);
      const receive=button('Receive these exact accepted packages',()=>start('receive_package'),true);receive.dataset.receivePackage='';receive.disabled=!!retained.pending||!retained.preview;p.append(receive);
    }
    p.append(table(['Scenario / original ID','Source acceptance','Open / current accepted exports'],value.roots.map(row=>[
      el('div',row.title+'\n'+row.id,'cr-id'),el('div',row.accepted_review_id,'cr-id'),
      received?actions(button('Open original scenario',()=>callbacks.onOpen?.('scenario',row.id,row.sha256)),
        button('Accepted cost CSV',()=>download('scenario-csv',row.id,row.id+'-accepted.csv')),
        button('Accepted complete JSON',()=>download('scenario-package',row.id,row.id+'-accepted.json'))):'Included in this preview'
    ])));
    if(received)p.append(hint('Current accepted exports use the latest review in this workspace. The original files below remain available with their original bytes and review state.'));
    const pageKey=received?'received':'preview',size=25,max=Math.max(0,Math.ceil(value.documents.length/size)-1);
    const documentPage=documentPages[pageKey]=Math.min(documentPages[pageKey],max);
    const current=new Map((value.current_documents||[]).map(row=>[row.id,row]));
    p.append(el('h4','Complete original document access'),hint('Documents '+(documentPage*size+1)+'–'+Math.min(value.documents.length,(documentPage+1)*size)+' of '+value.documents.length));
    p.append(table(['Kind / name','Original ID / SHA-256','Rows / original reviews','Workspace action'],value.documents.slice(documentPage*size,(documentPage+1)*size).map(row=>[
      row.kind+' · '+(row.name||''),el('div',row.id+'\n'+row.sha256,'cr-id'),row.rows+' / '+row.review_ids.length,
      received?button('Open original edition',()=>callbacks.onOpen?.(row.kind,row.id,row.sha256)):
        details(current.get(row.id)?.document_action||'receive',pre(current.get(row.id)))
    ])));
    const previous=button('Previous original documents',()=>{documentPages[pageKey]--;render();}),next=button('Next original documents',()=>{documentPages[pageKey]++;render();});
    previous.disabled=documentPage===0;next.disabled=documentPage===max;p.append(actions(previous,next));
    p.append(details('Complete original source files',table(['Original file','Bytes / SHA-256','Download'],value.members.map((row,index)=>[
      row.path,el('div',row.bytes+'\n'+row.sha256,'cr-id'),received?
        button('Download original file',()=>download('received-member',value.id+'~'+index,row.path.split('/').at(-1),row)):'Retained with the original source'
    ]))));
    if(value.external_references.length)p.append(details('References outside the exported classification case',
      pre(value.external_references)));
    p.append(details(received?'Complete receiving provenance':'Complete receiving preview',pre(value)));
    if(received)p.append(hint('Use Workspace → Create complete backup to carry this case, the exact received archive and its native receiving requests to another operator.'));
    return p;
  }
  function historyPanel(){
    const p=panel('Received packages');p.classList.add('cr-history');
    p.append(hint('All receiving records remain available. '+history.total+' total.'),button('Refresh receiving history',refresh));
    if(!history.items.length)p.append(hint('No accepted packages have been received in this workspace.'));
    else p.append(table(['Received','Original source / roots','Operator','Open'],history.items.map(row=>[
      row.received_at,row.source.filename+' · '+row.roots.length+' scenarios',row.received_by,button('Open receiving record',()=>openReceipt(row.id))
    ])));
    const previous=button('Previous receiving records',async()=>{retained.history_cursor=retained.previous_cursors.pop();await persist();await refresh();});
    previous.disabled=!retained.previous_cursors.length;
    const next=button('Next receiving records',async()=>{if(history.next_cursor===null)return;retained.previous_cursors.push(retained.history_cursor);retained.history_cursor=history.next_cursor;await persist();await refresh();});
    next.disabled=history.next_cursor===null;p.append(actions(previous,next));return p;
  }
  function render(){
    if(disposed)return;
    const fragment=el('div'),input=panel('Receive an accepted classification case');
    input.append(hint('Open the complete accepted JSON or the original ZIP of JSON and CSV exports. The receiver checks the original identities, calculations as saved, input editions and recorded acceptances.'));
    if(retained.recovery){const recovery=panel('Retained editor recovery');recovery.append(hint(retained.recovery.message),
      button('Download complete original browser draft',()=>saveJSON(retained.recovery.original,'classification-receiving-draft-recovery.json')));fragment.append(recovery);}
    const file=el('input');file.type='file';file.accept='.json,.zip,application/json,application/zip';file.disabled=!!retained.pending;
    file.setAttribute('aria-label','Original accepted classification JSON or ZIP');file.addEventListener('change',()=>perform(()=>selectFile(file.files[0])));
    input.append(file);
    if(retained.source){const source=el('div',undefined,'cr-source');source.append(el('strong',retained.source.filename),hint(retained.source.bytes+' bytes · '+retained.source.sha256),
      button('Download retained selected source',()=>saveBytes(decode(retained.source.content_base64),retained.source.filename)));input.append(source);}
    const grid=el('div',undefined,'cr-grid');grid.append(field('Operator receiving the case','actor'),field('Original workspace ID, when supplied by the handoff','origin_workspace_id'));
    input.append(grid,field('Original handoff or source reference','source_ref'),field('Receiving notes','notes',true));
    const preview=button('Preview original accepted packages',()=>start('preview_package'),true);preview.disabled=!!retained.pending||!retained.source;input.append(actions(preview));
    if(retained.declined)input.append(details('Last returned request refusal',pre({action:retained.declined.action,
      operation_id:retained.declined.body.operation_id,error:retained.declined.error})));
    fragment.append(input);
    if(retained.pending)fragment.append(requestPanel());
    if(retained.preview)fragment.append(overview(retained.preview));
    if(opened)fragment.append(overview(opened,true));
    fragment.append(historyPanel());contents.replaceChildren(fragment);if(busy)lock();
  }
  const ready=(async()=>{try{await readDraft();if(!retained.actor&&callbacks.actor)retained.actor=callbacks.actor()||'';await refresh();}
    catch(error){show(error.message||String(error),true);}finally{if(!disposed)render();}})();
  return {ready,refresh,open:async id=>{await ready;return perform(()=>openReceipt(id));},
    destroy(){disposed=true;++readSequence;++selectionSequence;++fileSequence;
      for(const url of urls)win.URL.revokeObjectURL(url);urls.clear();
      active.catch(()=>{}).then(()=>writes.catch(()=>{})).then(()=>dbPromise?.then(db=>db.close()).catch(()=>{}));target.replaceChildren();}};
}
