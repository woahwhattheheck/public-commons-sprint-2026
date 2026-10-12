// MIT. Source-owned operator interface. Exact values remain strings through forms.
const $=id=>document.getElementById(id),all=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2),values=value=>Object.values(value??{});
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
let token=new URLSearchParams(location.hash.slice(1)).get('token');
try{if(token)sessionStorage.setItem('invoice-token:'+location.origin,token);else token=sessionStorage.getItem('invoice-token:'+location.origin);}catch{}
if(location.hash)history.replaceState(null,'',location.pathname+location.search);

let state,catalog=[],methods=[],operatorInfo,active=0,activeLabel='',refreshing=null,selectedTab='overview';
let programmeBasis=null,programmeExtra={},assets=[],invoices=[],invoiceOffset=0,invoiceFilter='',inputFiles=new Map();
let sourceOffset=0,sourceListOffset=0,captureOffset=0,sourceCaptureFilter=null,selectedSource=null;
let selectedDelivery=null,deliveryOffset=0,selectedReconciliation=null,reconciliationOffset=0,orderOffset=0,issueOffset=0;
let historyOffset=0,historyResult=null,reportObjectURL=null,receiptOffset=0;
const pageSize=100,pendingRequests=new Map();

// The complete input is committed locally before its original request is sent.
// IndexedDB retains File/Blob contents without converting large sources to JSON.
const REQUEST_JOURNAL_SCHEMA='stellar-forge.invoice-browser-request.v1';
const REQUEST_JOURNAL_DATABASE='stellar-forge.invoice-settlement.requests.v1';
const REQUEST_JOURNAL_STORE='requests';
const REQUEST_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let browserWorkspace=null,journalDatabase=null;
const pendingExecutions=new Map();
function journalProblem(cause){
  if(typeof cause?.code==='string')return cause;
  const problem=error(cause?.name==='QuotaExceededError'?
    'Make space for the complete original file in this browser, then retry.':
    'The original request could not be retained in this browser. Reopen with browser storage available, then retry.',
    'REQUEST_JOURNAL_UNAVAILABLE');
  problem.details={reason:String(cause?.name??'Browser storage unavailable')};return problem;
}
function journalScope(){
  if(!browserWorkspace)throw error('Open the selected original workspace first.','WORKSPACE_IDENTITY_REQUIRED');
  return JSON.stringify([browserWorkspace.workspaceId,browserWorkspace.workspaceDirectory]);
}
function sameJSON(left,right){
  if(left===right)return true;
  if(left===null||right===null||typeof left!==typeof right||typeof left!=='object')return false;
  if(Array.isArray(left)!==Array.isArray(right))return false;
  if(Array.isArray(left))return left.length===right.length&&left.every((value,index)=>sameJSON(value,right[index]));
  const a=Object.keys(left).sort(),b=Object.keys(right).sort();
  return a.length===b.length&&a.every((key,index)=>key===b[index]&&sameJSON(left[key],right[key]));
}
function bindWorkspace(opened){
  const next=opened?.state,info=opened?.operator;
  if(!REQUEST_UUID.test(next?.workspaceId??'')||!Number.isSafeInteger(next.revision)||next.revision<0||
    typeof info?.workspaceDirectory!=='string'||!info.workspaceDirectory)
    throw error('The operator did not return its original workspace identity.','WORKSPACE_IDENTITY_REQUIRED');
  if(browserWorkspace&&(browserWorkspace.workspaceId!==next.workspaceId||
    browserWorkspace.workspaceDirectory!==info.workspaceDirectory))
    throw error('This page belongs to another original workspace. Open its complete application link.','WORKSPACE_IDENTITY_MISMATCH');
  browserWorkspace={workspaceId:next.workspaceId,workspaceDirectory:info.workspaceDirectory};
  return next;
}
function acceptWorkspaceState(next){
  if(!browserWorkspace||next?.workspaceId!==browserWorkspace.workspaceId||
    !Number.isSafeInteger(next.revision)||next.revision<0)
    throw error('The operator no longer has this page’s original workspace identity. Open the selected application link.','WORKSPACE_IDENTITY_MISMATCH');
  return next;
}
async function openRequestJournal(){
  if(journalDatabase)return journalDatabase;
  const pending=new Promise((done,reject)=>{
    let opening,settled=false;
    const fail=cause=>{if(!settled){settled=true;reject(journalProblem(cause));}};
    try{
      if(typeof indexedDB==='undefined')throw new Error('Browser storage unavailable');
      opening=indexedDB.open(REQUEST_JOURNAL_DATABASE,1);
    }catch(cause){fail(cause);return;}
    opening.onupgradeneeded=()=>{
      const db=opening.result;
      if(!db.objectStoreNames.contains(REQUEST_JOURNAL_STORE)){
        const records=db.createObjectStore(REQUEST_JOURNAL_STORE,{keyPath:'key'});
        records.createIndex('scope','scope',{unique:false});
      }
    };
    opening.onerror=()=>fail(opening.error);
    opening.onblocked=()=>fail(new Error('Another page has an older request journal open'));
    opening.onsuccess=()=>{
      const db=opening.result;
      if(settled){db.close();return;}
      settled=true;
      db.onversionchange=()=>{db.close();journalDatabase=null;};
      done(db);
    };
  });
  journalDatabase=pending;
  try{return await pending;}catch(cause){if(journalDatabase===pending)journalDatabase=null;throw journalProblem(cause);}
}
async function journalAccess(mode,work){
  const db=await openRequestJournal();
  return new Promise((done,reject)=>{
    let transaction,result,failure;
    try{
      try{transaction=db.transaction(REQUEST_JOURNAL_STORE,mode,{durability:'strict'});}
      catch(cause){if(cause?.name!=='TypeError')throw cause;transaction=db.transaction(REQUEST_JOURNAL_STORE,mode);}
      transaction.oncomplete=()=>done(result);
      transaction.onabort=()=>reject(failure??journalProblem(transaction.error));
      transaction.onerror=event=>{failure??=journalProblem(event.target?.error??transaction.error);};
      const fail=cause=>{failure=journalProblem(cause);try{transaction.abort();}catch{reject(failure);}};
      try{work(transaction.objectStore(REQUEST_JOURNAL_STORE),value=>{result=value;},fail);}
      catch(cause){fail(cause);}
    }catch(cause){reject(journalProblem(cause));}
  });
}
function assertJournalRecord(record){
  if(record?.schema!==REQUEST_JOURNAL_SCHEMA||record.scope!==journalScope()||
    record.workspaceId!==browserWorkspace.workspaceId||record.workspaceDirectory!==browserWorkspace.workspaceDirectory||
    !REQUEST_UUID.test(record.requestId??'')||record.key!==record.scope+'\n'+record.requestId||
    !['method','source','archive'].includes(record.kind))
    throw error('The retained request has a different original workspace selection.','REQUEST_JOURNAL_CHANGED');
  if(record.kind==='method'){
    let wire;try{wire=JSON.parse(record.wireBody);}catch{throw error('The retained original request body is incomplete.','REQUEST_JOURNAL_CHANGED');}
    if(typeof record.method!=='string'||!sameJSON(wire,{method:record.method,args:record.args})||
      record.args?.requestId!==record.requestId)
      throw error('The retained original operation arguments have changed.','REQUEST_JOURNAL_CHANGED');
  }else{
    if(!(record.file instanceof Blob)||record.file.size!==record.fileSelection?.size||
      record.metadata?.requestId!==record.requestId)
      throw error('The complete original upload is missing from this browser request.','REQUEST_JOURNAL_CHANGED');
    if(record.kind==='source'&&(record.metadataJSON!==JSON.stringify(record.metadata)||record.encodedMetadata!==encodedSourceMetadata(record.metadataJSON)))
      throw error('The retained original source selection has changed.','REQUEST_JOURNAL_CHANGED');
  }
  return record;
}
function newJournalRecord(value){
  const requestId=value.kind==='method'?value.args.requestId:value.metadata.requestId;
  const scope=journalScope();
  return assertJournalRecord({schema:REQUEST_JOURNAL_SCHEMA,key:scope+'\n'+requestId,scope,
    ...browserWorkspace,createdAt:new Date().toISOString(),...value,requestId});
}
async function retainBrowserRequest(candidate){
  assertJournalRecord(candidate);
  return journalAccess('readwrite',(records,set,fail)=>{
    const read=records.get(candidate.key);
    read.onsuccess=()=>{
      try{
        const original=read.result;
        if(original){
          assertJournalRecord(original);
          const matches=original.kind===candidate.kind&&(original.kind==='method'?
            original.method===candidate.method&&sameJSON(original.args,candidate.args):
            sameJSON(original.metadata,candidate.metadata)&&sameJSON(original.fileSelection,candidate.fileSelection));
          if(!matches)throw error('This request ID already retains another original input. Recover it or choose a new request ID.','REQUEST_ID_CONFLICT');
          // A repeated UUID always keeps the first complete retained upload.
          set(original);
        }else{
          const saved=records.put(candidate);saved.onsuccess=()=>set(candidate);
        }
      }catch(cause){fail(cause);}
    };
  });
}
async function removeBrowserRequest(record){
  assertJournalRecord(record);
  await journalAccess('readwrite',(records,set)=>{const removed=records.delete(record.key);removed.onsuccess=()=>set(true);});
  pendingRequests.delete(record.requestId);renderRequestJournal();
}
async function noteBrowserFailure(record,problem){
  const lastError={code:String(problem.code??'OPERATOR_ERROR'),message:String(problem.message),
    ...(problem.details===undefined?{}:{details:problem.details}),at:new Date().toISOString()};
  const noted=await journalAccess('readwrite',(records,set,fail)=>{
    const current=records.get(record.key);
    current.onsuccess=()=>{
      try{
        if(!current.result){set(null);return;}
        const original=assertJournalRecord(current.result),next={...original,lastError};
        const saved=records.put(next);saved.onsuccess=()=>set(next);
      }catch(cause){fail(cause);}
    };
  });
  if(noted)pendingRequests.set(noted.requestId,noted);else pendingRequests.delete(record.requestId);
  renderRequestJournal();
}
async function restoreBrowserRequests(){
  const scope=journalScope();
  const records=await journalAccess('readonly',(store,set)=>{const found=store.index('scope').getAll(scope);found.onsuccess=()=>set(found.result);});
  for(const record of records)pendingRequests.set(record.requestId,assertJournalRecord(record));
  renderRequestJournal();busy('',0);
  if(records.length)notify('Recovered '+records.length+' complete original request'+(records.length===1?'':'s')+
    ' for this workspace. Retry resumes the same request IDs and retained files.');
}
function encodedSourceMetadata(metadataJSON){
  const bytes=new TextEncoder().encode(metadataJSON);
  if(bytes.length>12000)throw error('The original source metadata exceeds the supported request header size.','INVALID_ARGUMENT');
  return btoa(String.fromCharCode(...bytes));
}
function fileSelection(file){
  if(!(file instanceof Blob))throw error('Select the complete original file.','ORIGINAL_FILE_REQUIRED');
  return {name:typeof file.name==='string'?file.name:'original-source',type:file.type,
    size:file.size,lastModified:Number.isSafeInteger(file.lastModified)?file.lastModified:null};
}
function renderRequestJournal(){
  let panel=$('invoice-request-journal');
  if(!panel){
    panel=el('details',undefined,'panel');panel.id='invoice-request-journal';
    const summary=el('summary','Retained original requests');
    const description=el('p','Each browser copy retains its request ID, complete arguments and original upload. Retry continues that same operation.','help');
    const rows=el('div');rows.id='invoice-request-journal-rows';
    panel.append(summary,description,rows);$('activity').after(panel);
  }
  panel.hidden=pendingRequests.size===0;
  const rows=$('invoice-request-journal-rows');rows.replaceChildren();
  for(const record of pendingRequests.values()){
    const row=el('div',undefined,'list-item'),information=el('div'),controls=el('div');
    information.append(el('strong',record.kind==='method'?record.method:record.kind==='source'?'Original source upload':'Complete package upload'));
    information.append(el('small',record.requestId+' · '+date(record.createdAt)));
    if(record.fileSelection)information.append(el('small',record.fileSelection.name+' · '+size(record.fileSelection.size)));
    if(record.lastError)information.append(el('p',record.lastError.code+': '+record.lastError.message,'minor'));
    const retry=el('button','Retry original');retry.type='button';retry.disabled=active>0;
    retry.addEventListener('click',()=>guarded(retry,()=>recoverBrowserRequest(record)));
    const save=el('button','Save request');save.type='button';
    save.addEventListener('click',()=>downloadJSON({schema:record.schema,workspaceId:record.workspaceId,
      workspaceDirectory:record.workspaceDirectory,requestId:record.requestId,kind:record.kind,method:record.method,
      args:record.args,metadata:record.metadata,fileSelection:record.fileSelection,createdAt:record.createdAt},
      'invoice-request-'+record.requestId+'.json'));
    controls.append(retry,save);
    if(record.file){
      const original=el('button','Save original file');original.type='button';
      original.addEventListener('click',()=>{
        const url=URL.createObjectURL(record.file),link=el('a');link.href=url;link.download=record.fileSelection.name;
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      });controls.append(original);
    }
    const remove=el('button','Remove browser copy');remove.type='button';remove.disabled=active>0;
    remove.addEventListener('click',()=>guarded(remove,async()=>{
      await removeBrowserRequest(record);busy('',0);notify('Removed the selected browser request copy.');
    }));controls.append(remove);
    row.append(information,controls);rows.append(row);
  }
}
async function sendRetainedBrowserRequest(record){
  assertJournalRecord(record);
  if(record.kind==='method')return responseJSON(await request('/api/invoke',{method:'POST',
    headers:{'Content-Type':'application/json'},body:record.wireBody}));
  if(record.kind==='source')return responseJSON(await request('/api/sources/import',{method:'POST',
    headers:{'Content-Type':'application/octet-stream','X-Invoice-Source':record.encodedMetadata},body:record.file}));
  const hash=record.metadata.manifestSha256??'';
  const path='/api/packages/unpack?requestId='+encodeURIComponent(record.requestId)+
    (hash?'&manifestSha256='+encodeURIComponent(hash):'');
  return responseJSON(await request(path,{method:'POST',headers:{'Content-Type':'application/gzip'},body:record.file}));
}
function performBrowserRequest(candidate,label){
  assertJournalRecord(candidate);
  if(pendingExecutions.has(candidate.key))return pendingExecutions.get(candidate.key);
  const operation=(async()=>{
    let retained=null;busy(label,1);
    try{
      retained=await retainBrowserRequest(candidate);
      pendingRequests.set(retained.requestId,retained);renderRequestJournal();busy('',0);
      const result=await sendRetainedBrowserRequest(retained);
      await removeBrowserRequest(retained);
      await refresh(true).catch(showError);return result;
    }catch(problem){
      if(retained){
        try{await noteBrowserFailure(retained,problem);}
        catch(storageProblem){showError(storageProblem);}
      }
      throw problem;
    }finally{busy('',-1);renderRequestJournal();}
  })();
  pendingExecutions.set(candidate.key,operation);
  operation.then(()=>pendingExecutions.delete(candidate.key),()=>pendingExecutions.delete(candidate.key));
  return operation;
}
async function recoverBrowserRequest(record){
  const result=await performBrowserRequest(record,'Recovering original '+(record.method??record.kind+' upload'));
  if(record.kind==='archive'){
    field($('receive-form'),'sourceDirectory').value=result.sourceDirectory;
    field($('receive-form'),'expectedManifestSha256').value=result.manifestSha256;showReceiving(result);
  }else if(record.method==='workspace.export'||record.method==='report.export'){
    field($('receive-form'),'sourceDirectory').value=result.directory;
    field($('receive-form'),'expectedManifestSha256').value=result.manifestSha256;showReceiving(result);
  }else if(record.method==='package.receive')showReceiving(result);
  showOperation(result,{heading:'Recovered original request '+record.requestId,open:false});
  return result;
}

function error(message,code='INVALID_INPUT'){const problem=new Error(message);problem.code=code;return problem;}
function notify(message,problem=false){$('notice').hidden=false;$('notice').className=problem?'error':'';$('notice').textContent=message;}
function hideNotice(){$('notice').hidden=true;}
function showError(problem){notify((problem.code?problem.code+': ':'')+problem.message+(problem.details&&Object.keys(problem.details).length?'\n'+pretty(problem.details):''),true);}
function busy(label,delta){active+=delta;activeLabel=label||activeLabel;$('activity').hidden=active===0&&pendingRequests.size===0;$('activity-text').textContent=active?activeLabel:pendingRequests.size+' original request'+(pendingRequests.size===1?'':'s')+' awaiting a complete response. Retry to recover the recorded result.';$('retry-request').hidden=pendingRequests.size===0||active>0;renderRequestJournal();}
function headers(extra={}){return {...extra,Authorization:'Bearer '+(token??''),...(browserWorkspace?{'X-Invoice-Workspace-ID':browserWorkspace.workspaceId}:{})};}
async function request(path,options={}){
  let response;
  try{response=await fetch(path,{cache:'no-store',...options,headers:headers(options.headers)});}
  catch(cause){throw error('The operator connection was interrupted. Reopen the complete workspace link or retry the original request.','CONNECTION_INTERRUPTED');}
  if(!response.ok){let body;try{body=await response.json();}catch{throw error('The operator returned HTTP '+response.status+'.','HTTP_'+response.status);}
    const problem=error(body.error?.message??'The operation failed.',body.error?.code??'OPERATOR_ERROR');problem.details=body.error?.details;throw problem;}
  return response;
}
async function responseJSON(response){try{return await response.json();}catch{throw error('The operator response ended before its complete result arrived. Recover the original request.','CONNECTION_INTERRUPTED');}}
async function read(method,args={}){return responseJSON(await request('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}));}
async function mutate(method,args={},label='Saving workspace'){
  if(!state)throw error('Open the workspace before changing it.');
  const requestBody={method,args:{...args,requestId:args.requestId??crypto.randomUUID(),
    ...(method!=='package.receive'?{expectedRevision:args.expectedRevision??state.revision}:{})}};
  const wireBody=JSON.stringify(requestBody),original=JSON.parse(wireBody);
  return performBrowserRequest(newJournalRecord({kind:'method',...original,wireBody}),label);
}
async function importOriginal(file,args,label){
  const metadata=JSON.parse(JSON.stringify({...args,filename:file.name,contentType:file.type||'application/octet-stream',
    requestId:args.requestId??crypto.randomUUID(),expectedRevision:args.expectedRevision??state.revision}));
  const metadataJSON=JSON.stringify(metadata),encodedMetadata=encodedSourceMetadata(metadataJSON);
  if(encodedMetadata.length>16000)throw error('The original source metadata exceeds the supported request header size.','INVALID_ARGUMENT');
  return performBrowserRequest(newJournalRecord({kind:'source',file,fileSelection:fileSelection(file),metadata,metadataJSON,encodedMetadata}),
    label||'Retaining original source');
}
async function download(path,filename,{preview=false}={}){
  let handle=null;
  if(!preview&&typeof window.showSaveFilePicker==='function'){
    try{handle=await window.showSaveFilePicker({suggestedName:filename});}
    catch(problem){if(problem.name==='AbortError')return;throw problem;}
  }
  busy(preview?'Opening retained report':'Downloading complete file',1);
  let writable=null;
  try{
    const response=await request(path);
    if(handle&&response.body){writable=await handle.createWritable();await response.body.pipeTo(writable);writable=null;return;}
    const blob=await response.blob(),url=URL.createObjectURL(blob);
    if(preview){if(reportObjectURL)URL.revokeObjectURL(reportObjectURL);reportObjectURL=url;$('report-preview').src=url;$('report-preview').hidden=false;$('report-preview').scrollIntoView({behavior:'smooth'});}
    else{const link=el('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(problem){if(writable)await writable.abort().catch(()=>{});throw problem;}
  finally{busy('',-1);}
}

function tab(name){
  selectedTab=name;all('[data-section]').forEach(section=>section.hidden=section.id!==name);
  all('nav [data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===name));
  if(name==='history')loadHistory().catch(showError);
}
function field(form,name){return form.elements.namedItem(name);}
function text(form,name){return String(field(form,name)?.value??'').trim();}
function optionalJSON(value,fallback){if(!value.trim())return fallback;try{return JSON.parse(value);}catch{throw error('Enter complete JSON in the JSON input.');}}
function whole(value,name){if(!/^\d+$/.test(String(value)))throw error(name+' must be a whole nonnegative number.');const n=Number(value);if(!Number.isSafeInteger(n))throw error(name+' exceeds the supported integer range.');return n;}
function select(id,rows,{blank=null}={}){
  const element=$(id),previous=element.value;
  element.innerHTML=(blank!==null?'<option value="">'+esc(blank)+'</option>':'')+rows.map(row=>'<option value="'+esc(row.value??row.id)+'">'+esc(row.label??row.name??row.id)+'</option>').join('');
  if([...element.options].some(option=>option.value===previous))element.value=previous;
}
function versions(table){return values(table).flatMap(item=>[...item.versions].reverse().map(version=>({value:item.id+'@'+version.version,label:item.name+' · version '+version.version})));}
function versionSelection(value){const [id,version]=value.split('@');return {id,version:version?whole(version,'version'):undefined};}
function status(value){return '<span class="status '+(['FAILED','MISMATCH','AMBIGUOUS','ATTENTION','UNCERTAIN','ID_CONFLICT'].includes(value)?'attention':'')+'">'+esc(value??'')+'</span>';}
function table(columns,rows){return rows.length?'<div class="table-scroll"><table><thead><tr>'+columns.map(value=>'<th>'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">No records in this selection.</p>';}
function action(name,label,id='',extra=''){return '<button type="button" data-action="'+esc(name)+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';}
function short(value){const s=String(value??'');return s.length>27?s.slice(0,14)+'…'+s.slice(-9):s;}
function date(value){return value?new Date(value).toLocaleString():'';}
function size(bytes){return bytes<1024?bytes+' B':bytes<1024**2?(bytes/1024).toFixed(1)+' KB':bytes<1024**3?(bytes/1024**2).toFixed(1)+' MB':(bytes/1024**3).toFixed(2)+' GB';}

function programmeSelection(required=true){
  const value=$('active-programme').value;
  if(!value){if(required)throw error('Save and select an invoice programme first.');return null;}
  const chosen=versionSelection(value);return {programmeId:chosen.id,programmeVersion:chosen.version};
}
function scope(rows){const selected=programmeSelection(false);return selected?rows.filter(row=>row.programmeId===selected.programmeId):rows;}
function newest(rows){return [...rows].sort((a,b)=>String(b.createdAt??b.observedAt??'').localeCompare(String(a.createdAt??a.observedAt??'')));}
function pager(id,offset,total,actionName){
  const start=total?Math.min(offset+1,total):0,end=Math.min(offset+pageSize,total);
  $(id).innerHTML='<span>'+start+'–'+end+' of '+total+'</span>'+
    '<button type="button" data-action="'+actionName+'" data-offset="'+Math.max(0,offset-pageSize)+'" '+(offset===0?'disabled':'')+'>Previous</button>'+
    '<button type="button" data-action="'+actionName+'" data-offset="'+(offset+pageSize)+'" '+(offset+pageSize>=total?'disabled':'')+'>Next</button>';
}
function units(value,asset){
  if(value===undefined||value===null)return '—';
  const raw=String(value);if(!/^-?\d+$/.test(raw))return raw;
  const precision=Number(asset?.decimals??0);if(!Number.isInteger(precision)||precision<0||precision>255)return raw;
  const negative=raw.startsWith('-'),digits=(negative?raw.slice(1):raw).padStart(precision+1,'0');
  const result=precision?digits.slice(0,-precision)+'.'+digits.slice(-precision):digits;
  return (negative?'-':'')+result;
}
function amountWithAsset(value,asset){return esc(units(value,asset))+' <span class="minor">'+esc(asset?.code??asset?.id??asset?.assetId??'')+'</span>';}
function searchText(value,query){return !query||JSON.stringify(value).toLowerCase().includes(query.toLowerCase());}
function jsonPointer(value){const raw=value.trim();return raw==='null'?null:raw;}
function nonempty(value){return value!==undefined&&value!==null&&value!=='';}
function optionalFields(form,names){const result={};for(const key of names){const value=text(form,key);if(value)result[key]=value;}return result;}
function position(summary){
  if(!summary)return '<p class="empty">Collect the original records and create a reconciliation edition.</p>';
  return '<div class="position-grid">'+[['Matched invoices',summary.matched],['Pending',summary.pending],['Needs attention',summary.attention],
    ['Refunded',summary.refunded],['Unassigned records',summary.unassigned],['Conflicts',summary.conflicts]]
    .map(([label,value])=>'<div class="position-item"><span>'+label+'</span><strong>'+esc(value??0)+'</strong></div>').join('')+'</div>';
}
async function refresh(following=false){
  if(refreshing){await refreshing;if(following)return refresh();return;}
  refreshing=(async()=>{state=acceptWorkspaceState(await responseJSON(await request('/api/state')));render();})();
  try{return await refreshing;}finally{refreshing=null;}
}
function render(){
  $('workspace-name').textContent=state.profile.name;$('workspace-revision').textContent='Revision '+state.revision;
  $('workspace-footer').textContent=state.workspaceId+' · '+operatorInfo.workspaceDirectory;
  select('active-programme',versions(state.programmes),{blank:values(state.programmes).length?null:'Save an invoice programme'});
  const sources=scope(values(state.sources)),jobs=scope(values(state.deliveries)),recons=newest(scope(values(state.reconciliations))),
    reports=newest(scope(values(state.reports))),captures=newest(scope(values(state.captures)));
  $('metrics').innerHTML=[['REGISTERED INVOICES',(()=>{const selected=programmeSelection(false);return selected?state.programmes[selected.programmeId]?.versions.find(row=>row.version===selected.programmeVersion)?.invoiceCount??recons[0]?.summary?.invoices??0:0;})(),'Selected original programme version'],
    ['ORIGINAL RECORDS',sources.reduce((sum,row)=>sum+(row.selectedRecords??0),0),sources.length+' retained source responses'],
    ['READY DELIVERIES',jobs.filter(row=>row.status==='READY'&&!row.paused).length,jobs.filter(row=>row.status==='UNCERTAIN'||row.status==='FAILED').length+' outcomes to review'],
    ['PARTNER REPORTS',reports.length,'Complete retained HTML, JSON and CSV']]
    .map(([label,value,detail])=>'<div class="metric"><span class="label">'+label+'</span><span class="value">'+esc(value)+'</span><span class="detail">'+esc(detail)+'</span></div>').join('');
  $('latest-position').innerHTML=(recons[0]?'<p class="help">'+esc(recons[0].name)+' · '+esc(date(recons[0].asOf))+'</p>':'')+position(recons[0]?.summary);
  $('overview-captures').innerHTML=captures.slice(0,5).map(row=>'<div class="list-item"><div><strong>'+esc(row.name)+'</strong><small>'+esc(row.provider)+' · '+row.sources.length+' original responses</small></div>'+status(row.status)+'</div>').join('')||'<p class="empty">No source captures yet.</p>';
  const outcomes={};for(const row of jobs)outcomes[row.status]=(outcomes[row.status]??0)+1;
  $('overview-deliveries').innerHTML=Object.entries(outcomes).map(([key,count])=>'<div class="list-item">'+status(key)+'<strong>'+count+'</strong></div>').join('')||'<p class="empty">Prepare listener jobs from original captured events.</p>';
  for(const id of ['reconciliation-select','report-reconciliation','compare-left','compare-right'])
    select(id,recons.map(row=>({id:row.id,label:row.name+' · '+date(row.createdAt)})),{blank:recons.length?null:'Create a reconciliation edition'});
  select('export-report',reports.map(row=>({id:row.id,label:row.name+' · '+(row.partnerId??'Complete programme')})),{blank:reports.length?null:'Create a report'});
  renderCaptures();renderSources();renderDeliveries();renderReports();renderExports();renderDecisions();
  const previous=new Map(all('#reconcile-sources input').map(input=>[input.value,input.checked]));
  $('reconcile-sources').innerHTML=sources.map(row=>'<label><input type="checkbox" value="'+esc(row.id)+'" '+((previous.has(row.id)?previous.get(row.id):true)?'checked':'')+'><span>'+esc(row.label)+' · '+esc(row.provider+'/'+row.kind)+' · '+esc(row.selectedRecords)+' records'+(row.error?' · '+esc(row.error.code):'')+'</span></label>').join('')||'<p class="empty">Capture or import original source files for this programme.</p>';
  const current=programmeSelection(false),hook=values(state.connections).find(row=>row.provider==='customer-webhook');
  $('webhook-command').textContent=current&&hook?'stellar-invoice-settlement webhook-serve --workspace '+JSON.stringify(operatorInfo.workspaceDirectory)+
    ' --connections-file '+JSON.stringify(operatorInfo.connectionsFile??'/private/connections.json')+' --programme-id '+current.programmeId+
    ' --programme-version '+current.programmeVersion+' --connection-alias '+hook.alias+' --host 127.0.0.1 --port 8789':
    'Configure a customer-webhook connection and select a saved programme to open the authenticated notification receiver.';
}
function renderConnections(){
  $('connection-list').innerHTML=table(['Alias','Provider','Network','Origin or scope'],values(state.connections).map(row=>[
    esc(row.alias),esc(row.provider),esc(row.network??''),esc(row.origin??row.nativeSource?.origin??short(row.sourceScope))]));
  $('connection-location').textContent=operatorInfo.connectionsFile??'Start with --connections-file /absolute/private/connections.json. See examples/connections.example.json.';
  select('capture-connection',catalog.map(row=>({value:row.connection.alias,label:row.connection.alias+' · '+row.connection.provider})),{blank:catalog.length?null:'Configure a source connection'});
  for(const id of ['import-connection','project-connection'])select(id,catalog.map(row=>({value:row.connection.alias,label:row.connection.alias+' · '+row.connection.provider})),{blank:'Original imported source'});
  select('delivery-backend',values(state.connections).filter(row=>row.provider==='listener-backend').map(row=>({value:row.alias,label:row.alias})),{blank:'Select original listener backend'});
  configureCaptureKinds();
}


function clearProgramme(){
  programmeBasis=null;programmeExtra={};assets=[];invoices=[];invoiceOffset=0;inputFiles.clear();
  $('programme-form').reset();$('programme-editor-title').textContent='New invoice programme';$('programme-version-label').textContent='';
  $('programme-json').value='';$('invoice-filter').value='';invoiceFilter='';renderRegisters();
}
function applyProgramme(definition){
  if(!definition||typeof definition!=='object'||!Array.isArray(definition.assets)||!Array.isArray(definition.invoices))throw error('Supply a complete programme with asset and invoice arrays.');
  programmeExtra=structuredClone(definition);assets=structuredClone(definition.assets);invoices=structuredClone(definition.invoices);
  const form=$('programme-form');field(form,'name').value=definition.name??'';field(form,'merchantId').value=definition.merchantId??'';
  field(form,'networks').value=(definition.networks??[]).join(', ');
  field(form,'allowSettledUnverified').checked=definition.rules?.allowSettledUnverified===true;
  field(form,'requireSuccessfulChainTransaction').checked=definition.rules?.requireSuccessfulChainTransaction!==false;
  field(form,'minimumConfirmations').value=String(definition.rules?.minimumConfirmations??0);
  invoiceOffset=0;renderRegisters();
}
async function loadProgramme(){
  const selected=programmeSelection(),value=await read('programme.read',{programmeId:selected.programmeId,version:selected.programmeVersion});
  programmeBasis={id:value.id,expectedVersion:state.programmes[value.id].currentVersion,loadedVersion:value.version};
  applyProgramme(value.definition);inputFiles.clear();
  $('programme-editor-title').textContent=value.name;$('programme-version-label').textContent='Loaded version '+value.version+' · saves as a following version';
  $('programme-json').value=pretty(value.definition);tab('programmes');
}
function registerInput(sheet,index,key,value,{className='',placeholder='',type='text'}={}){
  return '<input type="'+type+'" data-sheet="'+sheet+'" data-index="'+index+'" data-key="'+key+'" value="'+esc(value??'')+'" class="'+className+'" placeholder="'+esc(placeholder)+'" aria-label="'+esc(key)+'">';
}
function registerSelect(sheet,index,key,value,options){
  return '<select data-sheet="'+sheet+'" data-index="'+index+'" data-key="'+key+'" aria-label="'+esc(key)+'">'+options.map(row=>{
    const id=typeof row==='string'?row:row.value,label=typeof row==='string'?row:row.label;
    return '<option value="'+esc(id)+'" '+(String(id)===String(value)?'selected':'')+'>'+esc(label)+'</option>';
  }).join('')+'</select>';
}
function renderRegisters(){
  $('assets-table').tBodies[0].innerHTML=assets.map((row,index)=>'<tr><td>'+registerInput('assets',index,'id',row.id)+'</td><td>'+registerInput('assets',index,'network',row.network)+'</td><td>'+
    registerSelect('assets',index,'type',row.type,['fiat','stellar','evm'])+'</td><td>'+registerInput('assets',index,'code',row.code)+'</td><td>'+
    registerInput('assets',index,'decimals',row.decimals,{className:'small'})+'</td><td>'+registerInput('assets',index,'binding',row.type==='evm'?row.contract:row.issuer,{className:'account'})+'</td><td>'+action('asset-remove','Remove',String(index))+'</td></tr>').join('');
  const indexed=invoices.map((row,index)=>({row,index})).filter(({row})=>searchText(row,invoiceFilter));
  invoiceOffset=Math.min(invoiceOffset,Math.max(0,Math.floor((indexed.length-1)/pageSize)*pageSize));
  const assetOptions=[{value:'',label:'Select asset'},...assets.map(row=>({value:row.id,label:row.id+(row.code?' · '+row.code:'')}))];
  $('invoices-table').tBodies[0].innerHTML=indexed.slice(invoiceOffset,invoiceOffset+pageSize).map(({row,index})=>{
    const ownOptions=[...assetOptions];for(const id of [row.assetId,row.settlementAssetId])if(id&&!ownOptions.some(item=>item.value===id))ownOptions.push({value:id,label:id});
    return '<tr><td>'+registerInput('invoices',index,'id',row.id)+'</td><td><div class="stack">'+registerInput('invoices',index,'partnerId',row.partnerId,{placeholder:'Partner ID'})+
      registerInput('invoices',index,'customerId',row.customerId,{placeholder:'Customer ID'})+'</div></td><td>'+registerSelect('invoices',index,'assetId',row.assetId,ownOptions)+'</td><td>'+
      registerInput('invoices',index,'amount',row.amount,{placeholder:'Exact decimal'})+'</td><td>'+registerInput('invoices',index,'dueAt',row.dueAt,{placeholder:'Original date/time'})+'</td><td>'+
      registerInput('invoices',index,'orderIds',(row.orderIds??[]).join('; '),{placeholder:'IDs separated by semicolons'})+'</td><td>'+
      registerSelect('invoices',index,'settlementAssetId',row.settlementAssetId??'',[{value:'',label:'Use original programme rules'},...ownOptions.filter(item=>item.value)])+'</td><td>'+
      registerInput('invoices',index,'settlementAmount',row.settlementAmount,{placeholder:'Exact decimal'})+'</td><td>'+action('invoice-remove','Remove',String(index))+'</td></tr>';
  }).join('');
  pager('invoice-pager',invoiceOffset,indexed.length,'invoice-page');
}
function programmeFromForm(){
  const form=$('programme-form');
  return {...structuredClone(programmeExtra),schema:'stellar-forge.invoice-programme.v1',name:text(form,'name'),
    ...(text(form,'merchantId')?{merchantId:text(form,'merchantId')}:{}),
    networks:text(form,'networks').split(',').map(value=>value.trim()).filter(Boolean),
    assets:assets.map(row=>{
      const value={...row,decimals:whole(row.decimals,'Asset decimals')};delete value.binding;
      for(const key of ['issuer','contract'])if(!value[key])delete value[key];
      if(value.type!=='stellar')delete value.issuer;if(value.type!=='evm')delete value.contract;return value;
    }),
    invoices:invoices.map(row=>{
      const value={...row,amount:String(row.amount??''),orderIds:[...(row.orderIds??[])],references:[...(row.references??[])]};
      for(const key of ['partnerId','customerId','dueAt','settlementAssetId','settlementAmount'])if(!value[key])delete value[key];return value;
    }),
    rules:{...(programmeExtra.rules??{}),allowSettledUnverified:field(form,'allowSettledUnverified').checked,
      requireSuccessfulChainTransaction:field(form,'requireSuccessfulChainTransaction').checked,
      minimumConfirmations:whole(text(form,'minimumConfirmations'),'Minimum confirmations')}};
}
function csvRows(source){
  const text=source.charCodeAt(0)===0xFEFF?source.slice(1):source,rows=[];let row=[],value='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=char;continue;}
    if(char==='"'){if(value!==''||closed)throw error('The CSV has an unexpected quote.');quoted=true;continue;}
    if(char===','||char==='\n'||char==='\r'){
      row.push(value);value='';closed=false;
      if(char!==','){if(char==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}continue;
    }
    if(closed&&char!==' '&&char!=='\t')throw error('The CSV has text after a closing quote.');
    if(!closed)value+=char;
  }
  if(quoted)throw error('The original CSV ends inside a quoted value.');
  if(value!==''||row.length||closed){row.push(value);rows.push(row);}
  while(rows.length&&rows.at(-1).every(value=>value===''))rows.pop();
  if(!rows.length)throw error('The CSV is empty.');
  const names=rows.shift().map(value=>value.trim());
  if(names.some(value=>!value)||new Set(names).size!==names.length)throw error('Use unique, named CSV columns.');
  return rows.map((cells,index)=>{
    if(cells.length!==names.length)throw error('CSV row '+(index+2)+' has '+cells.length+' fields; the header has '+names.length+'.');
    return Object.fromEntries(names.map((name,column)=>[name,cells[column]]));
  });
}
function listCell(value){
  const raw=String(value??'').trim();if(!raw)return [];
  if(raw.startsWith('[')){const result=JSON.parse(raw);if(!Array.isArray(result)||!result.every(item=>typeof item==='string'))throw error('Use an array of original string references.');return result;}
  return raw.split(';').map(item=>item.trim()).filter(Boolean);
}
async function importRegister(kind,file){
  const source=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),rows=csvRows(source);
  if(kind==='assets'){
    const required=['id','network','type','code','decimals'];for(const key of required)if(rows.some(row=>!Object.hasOwn(row,key)))throw error('Asset CSV needs '+key+'.');
    assets=rows.map(row=>({...row,decimals:whole(row.decimals,'Asset decimals')}));
  }else{
    for(const key of ['id','assetId','amount'])if(rows.some(row=>!Object.hasOwn(row,key)))throw error('Invoice CSV needs '+key+'.');
    invoices=rows.map(row=>({...row,orderIds:listCell(row.orderIds),references:listCell(row.references)}));invoiceOffset=0;
  }
  inputFiles.set(kind,file);renderRegisters();notify('Loaded '+rows.length+' '+kind+' for review. Save the complete programme to retain this original CSV.');
}
async function saveProgramme(){
  const definition=programmeFromForm(),args={definition,name:definition.name,...(programmeBasis?{programmeId:programmeBasis.id,expectedVersion:programmeBasis.expectedVersion}:{})};
  const result=await mutate('programme.save',args,'Saving complete invoice programme');
  $('active-programme').value=result.programmeId+'@'+result.version;
  programmeBasis={id:result.programmeId,expectedVersion:result.version,loadedVersion:result.version};
  $('programme-version-label').textContent='Saved version '+result.version;
  $('programme-json').value=pretty(definition);
  for(const [kind,file] of [...inputFiles]){
    await importOriginal(file,{provider:'document',kind:kind+'-csv',label:'Original '+kind+' register · '+file.name,
      programmeId:result.programmeId,programmeVersion:result.version,request:{source:'programme-register-import',programmeId:result.programmeId,programmeVersion:result.version,filename:file.name}},
      'Retaining complete original '+kind+' register');
    inputFiles.delete(kind);
  }
  render();notify('Saved the complete programme and its original imported registers.');
}


function schemaProperties(entry,part){
  if(part==='filters')return entry?.filtersSchema?.properties??Object.fromEntries((entry?.filters??[]).map(key=>[key,{type:['include_failed','enabled','include_deleted','user_managed'].includes(key)?'boolean':'string'}]));
  const result={...(entry?.inputSchema?.properties??{})};for(const key of ['kind','filters','pageSize'])delete result[key];
  if(!Object.keys(result).length&&entry?.shape==='object'&&entry.kind!=='root')result.id={type:'string'};
  return result;
}
function schemaControl(name,definition,{part,required=false}={}){
  const base='data-native-part="'+part+'" data-native-key="'+esc(name)+'" data-native-type="'+esc(definition.type??'string')+'" data-native-required="'+required+'"';
  const title=definition.title??name,hint=definition.description?'<span class="field-hint">'+esc(definition.description)+'</span>':'';
  let control;
  if(definition.type==='boolean')control='<select '+base+'><option value="">Provider default</option><option value="true">True</option><option value="false">False</option></select>';
  else if(definition.enum)control='<select '+base+' '+''+'>'+(!required?'<option value="">Provider default</option>':'')+definition.enum.map(value=>'<option value="'+esc(value)+'">'+esc(value)+'</option>').join('')+'</select>';
  else if(definition.type==='array'&&definition.items?.enum)control='<select '+base+' multiple size="'+Math.min(definition.items.enum.length,4)+'">'+definition.items.enum.map(value=>'<option selected value="'+esc(value)+'">'+esc(value)+'</option>').join('')+'</select>';
  else control='<input '+base+' '+''+' '+(definition.type==='integer'?'inputmode="numeric"':'')+' placeholder="'+esc(definition.default??'')+'">';
  return '<label>'+esc(title)+control+hint+'</label>';
}
function currentCaptureContract(){
  const selected=catalog.find(row=>row.connection.alias===$('capture-connection').value);
  return {source:selected,entry:selected?.catalog.kinds?.[$('capture-kind').value]};
}
function configureCaptureKinds(){
  const source=catalog.find(row=>row.connection.alias===$('capture-connection').value);
  select('capture-kind',Object.entries(source?.catalog.kinds??{}).map(([kind,entry])=>({value:kind,label:kind+(entry.path?' · '+entry.path:'')})),{blank:source?null:'Select connection'});
  configureCaptureFields();
}
function configureCaptureFields(){
  const {source,entry}=currentCaptureContract(),form=$('capture-form');
  $('capture-fields').innerHTML=Object.entries(schemaProperties(entry,'input')).map(([name,definition])=>schemaControl(name,definition,
    {part:'input',required:entry?.inputSchema?.required?.includes(name)??false})).join('');
  $('capture-filters').innerHTML=Object.entries(schemaProperties(entry,'filters')).map(([name,definition])=>schemaControl(name,definition,
    {part:'filters',required:entry?.filtersSchema?.required?.includes(name)??false})).join('');
  $('capture-contract').textContent=entry?pretty(entry):'Select a configured native source.';
  $('ledger-selection').hidden=source?.connection.provider!=='horizon';
  const page=entry?.inputSchema?.properties?.pageSize,pageSupported=!!page||entry?.shape==='page'||!!entry?.pagination;
  field(form,'pageSize').disabled=!pageSupported;field(form,'pageSize').max=page?.maximum??entry?.maximumPageSize??1000000;
  for(const key of ['fromLedger','throughLedger'])field(form,key).disabled=source?.connection.provider!=='horizon';
}
function nativeReadFromForm(){
  const form=$('capture-form'),explicit=text(form,'readJSON');
  if(explicit){const value=optionalJSON(explicit,null);if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.kind!=='string')throw error('The complete native request needs a kind.');return value;}
  const read={kind:$('capture-kind').value},filters={};
  if(!field(form,'pageSize').disabled&&text(form,'pageSize'))read.pageSize=whole(text(form,'pageSize'),'Page size');
  for(const input of all('#capture-fields [data-native-key],#capture-filters [data-native-key]')){
    let value=input.multiple?[...input.selectedOptions].map(option=>option.value):input.value.trim();
    if(value===''||Array.isArray(value)&&value.length===0){if(input.dataset.nativeRequired==='true')throw error('Supply '+input.dataset.nativeKey+' for this native request.');continue;}
    if(input.dataset.nativeType==='integer')value=whole(value,input.dataset.nativeKey);
    else if(input.dataset.nativeType==='number'){value=Number(value);if(!Number.isFinite(value))throw error('Use a finite '+input.dataset.nativeKey+'.');}
    else if(input.dataset.nativeType==='boolean')value=value==='true';
    else if(input.dataset.nativeType==='array'&&!Array.isArray(value))value=optionalJSON(value,[]);
    else if(input.dataset.nativeType==='object')value=optionalJSON(value,{});
    (input.dataset.nativePart==='filters'?filters:read)[input.dataset.nativeKey]=value;
  }
  if(Object.keys(filters).length)read.filters=filters;return read;
}
async function startCapture(run){
  const form=$('capture-form'),selected=programmeSelection(),readRequest=nativeReadFromForm();
  const selection={};for(const key of ['fromLedger','throughLedger'])if(!field(form,key).disabled&&text(form,key))selection[key]=whole(text(form,key),key);
  const result=await mutate('capture.start',{...selected,connectionAlias:text(form,'connectionAlias'),read:readRequest,
    ...(text(form,'name')?{name:text(form,'name')}:{}),...(Object.keys(selection).length?{selection}:{})},'Saving original native capture');
  if(run)await runCapture(result.captureId);else notify('Saved the complete original source selection.');
}
async function runCapture(id){
  let capture=state.captures[id];if(!capture)throw error('The original source capture is absent.');
  if(capture.status==='PAUSED'||capture.status==='FAILED'){
    await mutate('capture.resume',{captureId:id},'Resuming original source capture');capture=state.captures[id];
  }
  const result=await mutate('capture.run',capture.run?.args??{captureId:id},'Collecting complete original native pages');
  notify(result.status==='COMPLETE'?'Collected the complete selected source history.':'Capture '+result.status.toLowerCase()+'. '+(result.error?.message??'Its original request and continuation are retained.'),result.status==='FAILED');
}
function renderCaptures(){
  const rows=newest(scope(values(state.captures)));captureOffset=Math.min(captureOffset,Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));
  $('capture-count').textContent=rows.length+' original captures';
  $('captures-list').innerHTML=table(['Capture','Native source','State','Responses','Latest observation',''],rows.slice(captureOffset,captureOffset+pageSize).map(row=>[
    '<strong>'+esc(row.name)+'</strong><span class="minor">'+esc(short(row.id))+'</span>',
    esc(row.connectionAlias)+'<span class="minor">'+esc(row.read.kind)+'</span>',status(row.status),esc(row.sources.length),
    esc(date(row.updatedAt))+(row.lastError?'<span class="minor">'+esc(row.lastError.message)+'</span>':''),
    action('capture-sources','Sources',row.id)+' '+(row.status==='COMPLETE'?'':action('capture-run',row.status==='PAUSED'||row.status==='FAILED'?'Resume':'Collect',row.id)+
      ' '+action('capture-pause','Pause',row.id))]));
  pager('capture-pager',captureOffset,rows.length,'capture-page');
}
function renderSources(){
  let rows=newest(scope(values(state.sources)));if(sourceCaptureFilter)rows=rows.filter(row=>row.captureId===sourceCaptureFilter);
  const query=$('source-search').value;rows=rows.filter(row=>searchText({label:row.label,kind:row.kind,provider:row.provider,id:row.id},query));
  sourceListOffset=Math.min(sourceListOffset,Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));
  $('sources-list').innerHTML=table(['Original source','Provider / kind','Records','Observed','Original bytes',''],rows.slice(sourceListOffset,sourceListOffset+pageSize).map(row=>[
    esc(row.label)+'<span class="minor">'+esc(short(row.id))+'</span>',esc(row.provider+'/'+row.kind),esc(row.selectedRecords)+(row.error?'<span class="minor">'+esc(row.error.code)+'</span>':''),
    esc(date(row.observedAt)),esc(size(row.bodyFile.bytes)),action('source-open','Open',row.id)+' '+action('source-download','Download',row.id)]));
  pager('source-pager',sourceListOffset,rows.length,'source-page');
}
async function openSource(sourceId){
  busy('Opening complete original source',1);
  try{
    selectedSource=await read('source.read',{sourceId});sourceOffset=0;
    const source=selectedSource.source;$('source-detail-panel').hidden=false;$('source-title').textContent=source.label;
    $('source-facts').innerHTML=table(['Provider','Kind','Records','Observed','Original bytes'],[[esc(source.provider),esc(source.kind),esc(source.selectedRecords),esc(date(source.observedAt)),esc(size(source.bodyFile.bytes))]])+
      (source.error?'<div class="issue-row"><strong>'+esc(source.error.code)+'</strong><p>'+esc(source.error.message)+'</p></div>':'');
    $('source-metadata').textContent=pretty(source);
    const form=$('source-project-form');field(form,'provider').value=source.provider==='document'?'elementpay':source.provider;
    field(form,'kind').value=source.kind;field(form,'recordsPath').value=source.recordsPath===null?'null':source.recordsPath??'';
    if(source.connection?.alias)$('project-connection').value=source.connection.alias;
    $('record-detail').hidden=true;renderRecords();tab('sources');$('source-detail-panel').scrollIntoView({behavior:'smooth'});
  }finally{busy('',-1);}
}
function renderRecords(){
  if(!selectedSource)return;const rows=selectedSource.records;
  $('source-records').innerHTML=table(['Original record','Status / event','Invoice / order','Amounts','References',''],rows.slice(sourceOffset,sourceOffset+pageSize).map(row=>{
    const projection=row.projection??{},amounts=projection.amounts??[];
    return [esc(short(row.id))+'<span class="minor">'+esc(projection.nativeId??'')+'</span>',
      status(projection.status??projection.event??row.kind),esc(projection.invoiceId??'')+'<span class="minor">'+esc(projection.orderId??'')+'</span>',
      amounts.map(value=>esc(value.amount??value.units??'')+' '+esc(value.code??value.assetId??value.contract??'')+'<span class="minor">'+esc(value.role??'')+'</span>').join(''),
      Object.values(projection.transactionHashes??{}).filter(Boolean).map(value=>esc(short(value))).join('<br>'),
      action('record-open','Original',row.id)+' '+action('record-decision','Link / correct',row.id)];
  }));
  pager('record-pager',sourceOffset,rows.length,'record-page');
}
async function sourceImport(){
  const form=$('source-import-form'),file=field(form,'file').files[0];if(!file)throw error('Select a complete original source file.');
  const selected=programmeSelection(),args={...selected,provider:text(form,'provider'),kind:text(form,'kind'),
    ...optionalFields(form,['label','network','sourceScope','connectionAlias'])};
  if(text(form,'recordsPath'))args.recordsPath=jsonPointer(text(form,'recordsPath'));
  const result=await importOriginal(file,args);await openSource(result.sourceId);notify('Retained the complete original source and its projection.');
}
async function projectSource(){
  if(!selectedSource)throw error('Open the original source first.');
  const form=$('source-project-form'),args={sourceId:selectedSource.source.id,provider:text(form,'provider'),kind:text(form,'kind'),
    recordsPath:jsonPointer(text(form,'recordsPath')),...optionalFields(form,['connectionAlias'])};
  const result=await mutate('source.project',args,'Projecting retained original source');await openSource(result.sourceId);
  notify('Saved a new interpretation of the retained original bytes.');
}


async function prepareDeliveries(){
  const form=$('delivery-prepare-form'),connectionAlias=text(form,'connectionAlias');
  if(!connectionAlias)throw error('Select the original listener backend.');
  const result=await mutate('delivery.prepare',{...programmeSelection(),connectionAlias},'Preparing complete original listener bodies');
  notify('Prepared '+result.deliveryIds.length+' new jobs; '+result.reusedDeliveryIds.length+' original jobs already exist.');
}
async function runDeliveries(runId){
  let args;
  if(runId){
    let run=state.deliveryRuns[runId];if(!run)throw error('The original delivery run is absent.');
    if(run.status==='PAUSED'){await mutate('delivery.run.resume',{runId},'Resuming original delivery run');run=state.deliveryRuns[runId];}
    args=run.args;
  }else{
    const chosen=programmeSelection(),connectionAlias=$('delivery-backend').value;
    args={programmeId:chosen.programmeId,...(connectionAlias?{connectionAlias}:{})};
  }
  const result=await mutate('delivery.run',args,'Delivering complete original event selection');
  notify(result.status==='COMPLETE'?'Completed the selected listener run. '+Object.entries(result.counts??{}).map(([key,count])=>count+' '+key.toLowerCase()).join(' · '):
    'Delivery run '+String(result.status).toLowerCase()+'. The original selection remains available.');
}
async function runDelivery(id){
  let job=state.deliveries[id];if(!job)throw error('The original delivery job is absent.');
  if(job.paused){await mutate('delivery.resume',{deliveryId:id},'Resuming original listener job');job=state.deliveries[id];}
  const result=await mutate('delivery.next',job.inflight?.args??{deliveryId:id},job.inflight?'Recovering original backend attempt':'Delivering original listener body');
  await openDelivery(id);notify('Original listener outcome: '+result.status.toLowerCase()+'.',result.status==='FAILED'||result.status==='UNCERTAIN');
}
function renderDeliveries(){
  const filter=$('delivery-filter').value,rows=newest(scope(values(state.deliveries))).filter(row=>!filter||row.status===filter);
  deliveryOffset=Math.min(deliveryOffset,Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));
  $('delivery-list').innerHTML=table(['Original event','Order','Backend','Outcome','Attempts',''],rows.slice(deliveryOffset,deliveryOffset+pageSize).map(row=>[
    esc(row.event)+'<span class="minor">'+esc(short(row.sourceRecordId))+'</span>',esc(short(row.orderId)),esc(row.connectionAlias),
    status(row.status)+(row.paused?'<span class="minor">Paused</span>':''),esc(row.attempts.length)+(row.lastResponseStatus?'<span class="minor">HTTP '+esc(row.lastResponseStatus)+'</span>':''),
    action('delivery-open','Inspect',row.id)+' '+(row.status==='READY'||row.inflight?action('delivery-next',row.inflight?'Recover attempt':row.paused?'Resume & deliver':'Deliver',row.id)+' '+
      action('delivery-pause','Pause',row.id):'')]));
  pager('delivery-pager',deliveryOffset,rows.length,'delivery-page');
  const selected=programmeSelection(false),runs=newest(values(state.deliveryRuns).filter(row=>!selected||row.programmeId===selected.programmeId));
  $('delivery-runs').innerHTML=table(['Original run','State','Processed','Started',''],runs.map(row=>[
    esc(short(row.id)),status(row.status),esc(row.index)+' / '+esc(row.deliveryIds.length),esc(date(row.createdAt)),
    row.status==='COMPLETE'?action('delivery-run-detail','Original result',row.id):
      action('delivery-run','Continue',row.id)+' '+action('delivery-run-pause','Pause',row.id)]));
  const receipts=newest(scope(values(state.receipts)));
  receiptOffset=Math.min(receiptOffset,Math.max(0,Math.floor((receipts.length-1)/pageSize)*pageSize));
  $('receipts-list').innerHTML=table(['Notification','Original ID','State','Attempts','Received',''],receipts.slice(receiptOffset,receiptOffset+pageSize).map(row=>[
    esc(row.event),esc(short(row.nativeId)),status(row.status),esc(row.attempts.length),esc(date(row.updatedAt)),action('receipt-open','Inspect',row.id)]))+
    '';
  pager('receipt-pager',receiptOffset,receipts.length,'receipt-page');
}
async function openDelivery(id){
  selectedDelivery=await read('delivery.read',{deliveryId:id});const row=selectedDelivery.delivery;
  $('delivery-detail-panel').hidden=false;$('delivery-title').textContent=row.event+' · '+short(row.orderId);
  $('delivery-facts').innerHTML=table(['Outcome','Backend','Original body','Source occurrence'],[[status(row.status),esc(row.connectionAlias),esc(row.bodySha256),esc(row.sourceOccurrenceKey)]]);
  $('delivery-attempts').innerHTML=table(['Attempt','Outcome','Backend response','Started','Finished','Original bytes'],selectedDelivery.attempts.map(attempt=>[
    esc(short(attempt.id)),status(attempt.status),esc(attempt.response?.status??'Unresolved')+(attempt.error?'<span class="minor">'+esc(attempt.error.message)+'</span>':''),
    esc(date(attempt.startedAt)),esc(date(attempt.finishedAt)),
    action('delivery-file','Attempt',row.id,'data-attempt="'+esc(attempt.id)+'" data-part="attempt"')+
      (attempt.response?.bodyFile?' '+action('delivery-file','Response',row.id,'data-attempt="'+esc(attempt.id)+'" data-part="response"'):'')]));
  $('delivery-attempts').insertAdjacentHTML('beforeend','<p class="inline">'+action('delivery-file','Original request body',row.id,'data-part="request"')+' '+action('delivery-file','Original intent',row.id,'data-part="manifest"')+'</p>');
  $('delivery-original').textContent=pretty(selectedDelivery.original);
  const form=$('delivery-resolve-form');form.hidden=!!row.inflight||row.status==='ACKNOWLEDGED';
  field(form,'actor').value=state.profile.contact??'';field(form,'sourceReferences').value='[]';
  if(row.status==='READY')field(form,'outcome').value='cancel';else if(row.status==='CANCELED')field(form,'outcome').value='retry';else field(form,'outcome').value='acknowledged';
  tab('deliveries');$('delivery-detail-panel').scrollIntoView({behavior:'smooth'});
}
async function resolveDelivery(){
  if(!selectedDelivery)throw error('Open the original listener delivery.');
  const form=$('delivery-resolve-form'),references=optionalJSON(text(form,'sourceReferences'),[]);
  if(!Array.isArray(references))throw error('Supply an array of original outcome source references.');
  const result=await mutate('delivery.resolve',{deliveryId:selectedDelivery.delivery.id,outcome:text(form,'outcome'),actor:text(form,'actor'),
    reason:text(form,'reason'),sourceReferences:references},'Saving original backend outcome');
  await openDelivery(result.deliveryId);notify('Saved the original outcome decision: '+result.status.toLowerCase()+'.');
}


async function createReconciliation(){
  const form=$('reconcile-form'),args={...programmeSelection(),sourceIds:all('#reconcile-sources input:checked').map(input=>input.value),
    ...optionalFields(form,['name','asOf'])};
  const result=await mutate('reconciliation.create',args,'Reconciling complete invoice and settlement selection');
  await openReconciliation(result.reconciliationId);notify('Saved the complete reconciliation edition.');
}
async function openReconciliation(id){
  if(!id)throw error('Select a retained reconciliation edition.');
  busy('Opening retained reconciliation',1);
  try{
    selectedReconciliation=await read('edition.read',{reconciliationId:id});reconciliationOffset=0;orderOffset=0;issueOffset=0;
    $('reconciliation-select').value=id;$('report-reconciliation').value=id;renderReconciliation();tab('reconciliation');
  }finally{busy('',-1);}
}
function totalsTable(rows){
  return table(['Asset / network','Expected','Collected','Settled','Refunded','Fees','Net'],rows.map(row=>[
    '<strong>'+esc(row.assetId)+'</strong><span class="minor">'+esc(row.network??'')+'</span>',
    amountWithAsset(row.expectedUnits,row),amountWithAsset(row.collectionUnits,row),amountWithAsset(row.settlementUnits,row),
    amountWithAsset(row.refundUnits,row),amountWithAsset(row.feeUnits,row),amountWithAsset(row.netUnits,row)]));
}
function renderReconciliation(){
  const edition=selectedReconciliation;if(!edition)return;
  const data=edition.data,query=$('reconciliation-filter').value;
  $('reconciliation-position').innerHTML='<p class="help">'+esc(edition.name)+' · programme version '+esc(edition.programme.version)+' · '+esc(date(edition.asOf))+'</p>'+position(data.summary);
  $('reconciliation-totals').innerHTML=totalsTable(data.totals??[]);
  const assetById=new Map((data.totals??[]).map(row=>[row.assetId,row]));
  const invoices=data.invoices.filter(row=>searchText(row,query)),orders=data.orders.filter(row=>searchText(row,query));
  reconciliationOffset=Math.min(reconciliationOffset,Math.max(0,Math.floor((invoices.length-1)/pageSize)*pageSize));
  orderOffset=Math.min(orderOffset,Math.max(0,Math.floor((orders.length-1)/pageSize)*pageSize));
  $('reconciliation-invoices').innerHTML=table(['Invoice','Partner / customer','Outcome','Expected','Original balances','Orders / records',''],invoices.slice(reconciliationOffset,reconciliationOffset+pageSize).map(row=>[
    '<strong>'+esc(row.id)+'</strong>'+(row.dueAt?'<span class="minor">Due '+esc(row.dueAt)+'</span>':''),
    esc(row.partnerId??'')+'<span class="minor">'+esc(row.customerId??'')+'</span>',status(row.status),
    esc(row.amount)+'<span class="minor">'+esc(row.assetId)+'</span>',
    (row.balances??[]).map(balance=>{const asset=assetById.get(balance.assetId);return '<strong>'+esc(balance.assetId)+'</strong>'+
      '<span class="minor">Collection '+esc(units(balance.collectionUnits,asset))+' · Settlement '+esc(units(balance.settlementUnits,asset))+
      ' · Refund '+esc(units(balance.refundUnits,asset))+' · Fees '+esc(units(balance.feeUnits,asset))+'</span>';}).join(''),
    esc(row.orderIds.length)+' orders<span class="minor">'+esc(row.recordIds.length)+' original records</span>',
    action('invoice-inspect','Inspect',row.id)]));
  pager('reconciliation-pager',reconciliationOffset,invoices.length,'reconciliation-page');
  $('reconciliation-orders').innerHTML=table(['Original order','Invoice','State','Amounts','Transaction references',''],orders.slice(orderOffset,orderOffset+pageSize).map(row=>[
    esc(short(row.id))+'<span class="minor">'+esc(row.orderType??'')+'</span>',esc(row.invoiceId??''),status(row.status),
    (row.amounts??[]).map(value=>esc(value.role)+' '+esc(value.amount??units(value.units,assetById.get(value.assetId)))+' '+esc(value.assetId)+'<br>').join(''),
    Object.entries(row.transactionHashes??{}).filter(([,items])=>items.length).map(([key,items])=>'<span class="minor">'+esc(key)+'</span>'+items.map(value=>esc(short(value))).join('<br>')).join(''),
    action('order-inspect','Inspect',row.id)]));
  pager('order-pager',orderOffset,orders.length,'order-page');
  const issues=[...(edition.sourceWarnings??[]).map(row=>({code:row.error.code,severity:'source',message:row.error.message,sourceId:row.sourceId,recordIds:[]})),
    ...(data.conflicts??[]),...(data.unassigned??[]).map(row=>({code:'UNASSIGNED_RECORD',severity:'attention',message:row.reason,recordIds:[row.recordId],details:{candidateInvoiceIds:row.candidateInvoiceIds,candidateOrderIds:row.candidateOrderIds}})),
    ...data.invoices.flatMap(row=>(row.issues??[]).map(issue=>({...issue,entityId:row.id}))),
    ...data.orders.flatMap(row=>(row.issues??[]).map(issue=>({...issue,entityId:row.id})))];
  const seen=new Set(),unique=issues.filter(row=>{const key=JSON.stringify([row.code,row.entityId,row.sourceId,row.recordIds,row.details]);if(seen.has(key))return false;seen.add(key);return searchText(row,query);});
  issueOffset=Math.min(issueOffset,Math.max(0,Math.floor((unique.length-1)/pageSize)*pageSize));
  $('reconciliation-issues').innerHTML=unique.slice(issueOffset,issueOffset+pageSize).map(row=>'<div class="issue-row"><strong>'+esc(row.code)+(row.entityId?' · '+esc(row.entityId):'')+'</strong><p>'+esc(row.message)+'</p>'+
    (row.sourceId?action('source-open','Original source',row.sourceId):'')+
    (row.recordIds??[]).slice(0,4).map(id=>action('decision-select','Link / correct '+short(id),id)).join(' ')+'</div>').join('')||'<p class="empty">No issues in the selected edition and filter.</p>';
  pager('issue-pager',issueOffset,unique.length,'issue-page');
  $('reconciliation-original').textContent=pretty(edition);
}
function selectDecision(recordId){
  const form=$('decision-form');field(form,'recordId').value=recordId;field(form,'actor').value=state.profile.contact??'';
  const prior=newest(scope(values(state.decisions)).filter(row=>row.recordId===recordId))[0];field(form,'supersedes').value=prior?.id??'';
  for(const key of ['invoiceId','orderId','role','reason'])field(form,key).value='';
  const record=selectedSource?.records.find(row=>row.id===recordId);
  if(record){field(form,'invoiceId').value=record.projection?.invoiceId??'';field(form,'orderId').value=record.projection?.orderId??'';}
  tab('reconciliation');$('decision-form').scrollIntoView({behavior:'smooth'});field(form,'reason').focus();
}
async function saveDecision(){
  const form=$('decision-form'),args={...programmeSelection(),recordId:text(form,'recordId'),action:text(form,'action'),
    actor:text(form,'actor'),reason:text(form,'reason'),...optionalFields(form,['invoiceId','orderId','role','supersedes'])};
  const result=await mutate('decision.save',args,'Saving explained original-record decision');
  field(form,'supersedes').value=result.decisionId;notify('Saved the decision. Create a following reconciliation to apply it to the selected original records.');
}
function renderDecisions(){
  $('decisions-list').innerHTML=table(['Original record','Decision','Invoice / order','Operator','Reason',''],newest(scope(values(state.decisions))).map(row=>[
    esc(short(row.recordId)),esc(row.action)+'<span class="minor">'+esc(row.role??'')+'</span>',
    esc(row.invoiceId??'')+'<span class="minor">'+esc(short(row.orderId))+'</span>',esc(row.actor),esc(row.reason),
    action('decision-select','Correct',row.recordId)+' '+action('decision-open','Original',row.id)]));
}
async function compareReconciliations(){
  const form=$('compare-form'),result=await read('reconciliation.compare',{leftId:text(form,'leftId'),rightId:text(form,'rightId')});
  const changedInvoices=result.changedInvoices??[],changedOrders=result.changedOrders??[];
  $('compare-result').innerHTML='<p class="help">'+(result.programmeChanged?'The original programme version changed. ':'')+
    esc((result.addedInvoices??[]).length)+' invoices added · '+esc((result.removedInvoices??[]).length)+' removed · '+esc(changedInvoices.length)+' changed</p>'+
    table(['Invoice','Baseline status','Following status','Original changes'],changedInvoices.map(row=>[
      esc(row.id),status(row.before.status),status(row.after.status),'<details><summary>Complete before and after</summary><pre>'+esc(pretty(row))+'</pre></details>']))+
    '<h4>Changed orders</h4>'+table(['Order','Baseline','Following','Original changes'],changedOrders.map(row=>[
      esc(short(row.id)),status(row.before.status),status(row.after.status),'<details><summary>Complete before and after</summary><pre>'+esc(pretty(row))+'</pre></details>']))+
    '<h4>Baseline totals</h4>'+totalsTable(result.totalsBefore??[])+'<h4>Following totals</h4>'+totalsTable(result.totalsAfter??[]);
}
async function createReport(){
  const form=$('report-form'),args={reconciliationId:text(form,'reconciliationId'),formats:['html','json','csv'],...optionalFields(form,['name','partnerId'])};
  const result=await mutate('report.create',args,'Rendering complete original partner reports');notify('Created all three original report formats.');return result;
}
function renderReports(){
  const rows=newest(scope(values(state.reports)));
  $('reports-list').innerHTML=table(['Report','Scope','Reconciliation','Created','Original files'],rows.map(row=>[
    '<strong>'+esc(row.name)+'</strong>',esc(row.partnerId??'Complete programme'),esc(short(row.reconciliationId)),esc(date(row.createdAt)),
    row.files.map(member=>action('report-download',member.format.toUpperCase(),row.id,'data-format="'+esc(member.format)+'" data-filename="'+esc(member.filename)+'"')).join(' ')+
      (row.formats.includes('html')?' '+action('report-preview','Preview',row.id):'')]));
}


function showOperation(result,{heading='Original operation result',open=true}={}){
  const target=$('operation-result');target.hidden=false;target.textContent=heading+'\n\n'+pretty(result);
  if(open){tab('history');target.scrollIntoView({behavior:'smooth'});}
}
function showReceiving(result){
  $('receiving-result-panel').hidden=false;$('receiving-result').textContent=pretty(result);
  $('receiving-result-panel').scrollIntoView({behavior:'smooth'});
}
function renderExports(){
  const rows=newest(values(state.exports));
  $('exports-list').innerHTML=table(['Complete package','Original revision','Files / bytes','Manifest',''],rows.map(row=>[
    '<strong>'+esc(row.kind==='workspace'?'Continuing workspace':'Partner report')+'</strong><span class="minor">'+esc(row.directory)+'</span>',
    esc(row.sourceRevision),esc(row.files)+' files<span class="minor">'+esc(size(row.bytes))+'</span>',
    esc(row.manifestSha256),action('package-download','Download archive',row.exportId)+' '+action('package-select','Inspect / receive',row.exportId)]));
}
async function exportWorkspace(){
  const form=$('export-form'),result=await mutate('workspace.export',{destination:text(form,'destination'),...optionalFields(form,['name'])},'Exporting complete workspace, application and runtimes');
  field($('receive-form'),'sourceDirectory').value=result.directory;
  field($('receive-form'),'expectedManifestSha256').value=result.manifestSha256;
  showReceiving(result);notify('Exported '+result.files+' complete files. The package is ready to download or receive independently.');
}
async function exportReport(){
  const form=$('report-export-form'),result=await mutate('report.export',{reportId:text(form,'reportId'),destination:text(form,'destination')},'Exporting complete original partner report');
  field($('receive-form'),'sourceDirectory').value=result.directory;
  field($('receive-form'),'expectedManifestSha256').value=result.manifestSha256;
  showReceiving(result);notify('Exported the complete original partner report package.');
}
async function uploadArchive(file,metadata){
  const original=JSON.parse(JSON.stringify({...metadata,requestId:metadata.requestId??crypto.randomUUID()}));
  const result=await performBrowserRequest(newJournalRecord({kind:'archive',file,fileSelection:fileSelection(file),metadata:original}),
    'Receiving and inspecting complete archive');
  field($('receive-form'),'sourceDirectory').value=result.sourceDirectory;
  field($('receive-form'),'expectedManifestSha256').value=result.manifestSha256;
  showReceiving(result);notify('Opened the complete archive. Choose an independent destination to continue the received workspace.');
  return result;
}
async function unpackArchive(){
  const form=$('unpack-form'),file=field(form,'file').files[0];
  if(!file)throw error('Choose the complete original archive.');
  const manifestSha256=text(form,'manifestSha256');
  if(manifestSha256&&!/^[a-f0-9]{64}$/.test(manifestSha256))throw error('Use the complete 64-character lowercase manifest SHA256.');
  return uploadArchive(file,{manifestSha256});
}
function packageArguments({receiving=false}={}){
  const form=$('receive-form'),args={sourceDirectory:text(form,'sourceDirectory'),...optionalFields(form,['expectedManifestSha256'])};
  if(!args.sourceDirectory)throw error('Select the original complete package directory.');
  if(receiving){args.destination=text(form,'destination');if(!args.destination)throw error('Choose an independent receiving directory.');}
  return args;
}
async function inspectPackage(){
  busy('Inspecting original application, workspace and runtime files',1);
  try{const result=await read('package.inspect',packageArguments());showReceiving(result);notify('The complete selected package is ready for independent receiving.');}
  finally{busy('',-1);}
}
async function receivePackage(){
  const result=await mutate('package.receive',packageArguments({receiving:true}),'Receiving complete independent operator');
  showReceiving(result);
  notify(result.kind==='workspace'?'Received the independent workspace, complete application and original runtime generations. The returned application paths open this operator.':'Received the complete original partner report files.');
}
async function loadHistory(){
  if(!state)return;
  historyResult=await read('workspace.history',{offset:historyOffset,limit:pageSize});
  if(historyOffset>=historyResult.total&&historyOffset>0){historyOffset=Math.max(0,Math.floor((historyResult.total-1)/pageSize)*pageSize);return loadHistory();}
  $('history-list').innerHTML=table(['Revision','Operation','Original request','Recorded',''],historyResult.records.map(row=>[
    esc(row.revision),esc(row.operation),esc(row.requestId),esc(date(row.at)),
    action('history-open','Original transition',row.hash)+' '+action('request-open','Request result',row.requestId)]));
  pager('history-pager',historyOffset,historyResult.total,'history-page');
}
function operationContract(){
  const entry=methods.find(row=>row.method===$('operation-method').value);
  $('operation-contract').textContent=entry?pretty(entry):'Select an available operator method.';
}
async function runOperation(){
  const form=$('operation-form'),method=text(form,'method'),args=optionalJSON(text(form,'arguments'),{});
  if(!args||typeof args!=='object'||Array.isArray(args))throw error('Supply a complete JSON object for the method arguments.');
  const contract=methods.find(row=>row.method===method);if(!contract)throw error('Choose an available operator method.');
  const result=contract.mutates?await mutate(method,args,contract.description):await read(method,args);
  showOperation(result,{heading:method,open:false});
}
async function retryOriginalRequests(){
  const rows=[...pendingRequests.values()],failed=[];let recovered=0;
  for(const original of rows){
    try{await recoverBrowserRequest(original);recovered++;}
    catch(problem){failed.push({requestId:original.requestId,code:problem.code,message:problem.message});}
  }
  busy('',0);renderRequestJournal();
  notify('Recovered '+recovered+' original request'+(recovered===1?'':'s')+
    (failed.length?'. '+failed.length+' retained request'+(failed.length===1?' still needs':'s still need')+' attention.':' successfully.'),failed.length>0);
  if(failed.length)showOperation(failed,{heading:'Retained original requests',open:false});
}
function downloadJSON(value,filename){
  const blob=new Blob([pretty(value)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=el('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function changeProgrammeSelection(){
  sourceOffset=0;sourceListOffset=0;captureOffset=0;sourceCaptureFilter=null;deliveryOffset=0;receiptOffset=0;
  selectedSource=null;selectedDelivery=null;selectedReconciliation=null;
  for(const id of ['source-detail-panel','delivery-detail-panel','receipt-detail-panel'])$(id).hidden=true;
  for(const id of ['reconciliation-position','reconciliation-totals','reconciliation-invoices','reconciliation-orders',
    'reconciliation-issues','reconciliation-original','reconciliation-pager','order-pager','issue-pager','compare-result'])$(id).textContent='';
  render();
}
async function receiptOpen(id){
  const result=await read('receipt.read',{receiptId:id});
  $('receipt-detail-panel').hidden=false;$('receipt-detail').textContent=pretty(result);
  $('receipt-detail-panel').scrollIntoView({behavior:'smooth'});
}
async function sourceDownload(id){
  const row=state.sources[id];if(!row)throw error('Select a retained original source.');
  return download('/api/sources/'+encodeURIComponent(id)+'/original','source-'+id+(row.provider==='document'?'.bin':'.json'));
}
async function deliveryFile(id,{part,attempt}){
  const path='/api/listener/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(part)+
    (attempt?'?attemptId='+encodeURIComponent(attempt):'');
  return download(path,'listener-'+(attempt??id)+'-'+part+(part==='response'?'.bin':'.json'));
}
function writeRegister(input){
  const sheet=input.dataset.sheet,index=whole(input.dataset.index,'Register row'),key=input.dataset.key;
  const rows=sheet==='assets'?assets:invoices,row=rows[index];if(!row)throw error('The selected register row changed. Refresh the register.');
  const value=input.value;
  if(key==='binding'){if(row.type==='evm')row.contract=value;else if(row.type==='stellar')row.issuer=value;}
  else if(key==='orderIds'||key==='references')row[key]=listCell(value);
  else row[key]=value;
}
const actionHandlers={
  'asset-remove':async(id)=>{assets.splice(whole(id,'Asset row'),1);renderRegisters();},
  'invoice-remove':async(id)=>{invoices.splice(whole(id,'Invoice row'),1);renderRegisters();},
  'invoice-page':async(_id,data)=>{invoiceOffset=whole(data.offset,'Offset');renderRegisters();},
  'capture-page':async(_id,data)=>{captureOffset=whole(data.offset,'Offset');renderCaptures();},
  'capture-run':runCapture,
  'capture-pause':async id=>{await mutate('capture.pause',{captureId:id},'Pausing original native capture');notify('Paused the source capture. Its original selection remains available.');},
  'capture-sources':async id=>{sourceCaptureFilter=id;sourceListOffset=0;renderSources();$('sources-list').scrollIntoView({behavior:'smooth'});},
  'source-page':async(_id,data)=>{sourceListOffset=whole(data.offset,'Offset');renderSources();},
  'source-open':openSource,'source-download':sourceDownload,
  'record-page':async(_id,data)=>{sourceOffset=whole(data.offset,'Offset');renderRecords();},
  'record-open':async id=>{const row=selectedSource?.records.find(item=>item.id===id);if(!row)throw error('Open the source containing this original record.');
    $('record-detail').hidden=false;$('record-json').textContent=pretty(row);$('record-detail').scrollIntoView({behavior:'smooth'});},
  'record-decision':async id=>selectDecision(id),
  'delivery-page':async(_id,data)=>{deliveryOffset=whole(data.offset,'Offset');renderDeliveries();},
  'delivery-open':openDelivery,'delivery-next':runDelivery,'delivery-run':runDeliveries,
  'delivery-pause':async id=>{await mutate('delivery.pause',{deliveryId:id},'Pausing original listener job');notify('Paused the selected listener job.');},
  'delivery-run-pause':async id=>{await mutate('delivery.run.pause',{runId:id},'Pausing original listener run');notify('Paused the original listener selection.');},
  'delivery-run-detail':async id=>showOperation(state.deliveryRuns[id],{heading:'Original delivery selection and outcomes'}),
  'delivery-file':deliveryFile,
  'receipt-open':receiptOpen,
  'receipt-page':async(_id,data)=>{receiptOffset=whole(data.offset,'Offset');renderDeliveries();},
  'reconciliation-page':async(_id,data)=>{reconciliationOffset=whole(data.offset,'Offset');renderReconciliation();},
  'order-page':async(_id,data)=>{orderOffset=whole(data.offset,'Offset');renderReconciliation();},
  'issue-page':async(_id,data)=>{issueOffset=whole(data.offset,'Offset');renderReconciliation();},
  'invoice-inspect':async id=>{const row=selectedReconciliation?.data.invoices.find(item=>item.id===id);
    if(!row)throw error('Open the reconciliation containing this invoice.');showOperation(row,{heading:'Complete invoice reconciliation'});},
  'order-inspect':async id=>{const row=selectedReconciliation?.data.orders.find(item=>item.id===id);
    if(!row)throw error('Open the reconciliation containing this order.');showOperation(row,{heading:'Complete original order reconciliation'});},
  'decision-select':async id=>selectDecision(id),
  'decision-open':async id=>showOperation(await read('decision.read',{decisionId:id}),{heading:'Original explained reconciliation decision'}),
  'report-download':async(id,data)=>download('/api/reports/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(data.format),data.filename),
  'report-preview':async id=>download('/api/reports/'+encodeURIComponent(id)+'/files/html','invoice-settlement-report.html',{preview:true}),
  'package-download':async id=>download('/api/packages/'+encodeURIComponent(id)+'/archive','invoice-workspace-'+id+'.tar.gz'),
  'package-select':async id=>{const row=state.exports[id];if(!row)throw error('Select an original export.');
    field($('receive-form'),'sourceDirectory').value=row.directory;field($('receive-form'),'expectedManifestSha256').value=row.manifestSha256;
    $('receive-form').scrollIntoView({behavior:'smooth'});await inspectPackage();},
  'history-page':async(_id,data)=>{historyOffset=whole(data.offset,'Offset');await loadHistory();},
  'history-open':async id=>showOperation(historyResult?.records.find(row=>row.hash===id),{heading:'Complete original workspace transition',open:false}),
  'request-open':async id=>showOperation(await read('request.status',{requestId:id}),{heading:'Recorded original request',open:false}),
};


async function guarded(control,work){
  if(control?.dataset.running==='true')return;
  if(control){control.dataset.running='true';control.disabled=true;}
  try{hideNotice();return await work();}
  catch(problem){showError(problem);}
  finally{if(control){delete control.dataset.running;control.disabled=false;}}
}
function onClick(id,work){$(id).addEventListener('click',event=>guarded(event.currentTarget,()=>work(event)));}
function onSubmit(id,work){$(id).addEventListener('submit',event=>{event.preventDefault();guarded(event.submitter??event.currentTarget.querySelector('[type="submit"]'),()=>work(event));});}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const handler=actionHandlers[button.dataset.action];
  if(handler)guarded(button,()=>handler(button.dataset.id??'',button.dataset));
});
for(const button of all('nav [data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
onClick('refresh',async()=>{await refresh();notify('Loaded the current retained workspace.');});
onClick('retry-request',retryOriginalRequests);
onClick('load-active-programme',loadProgramme);
$('active-programme').addEventListener('change',changeProgrammeSelection);
onClick('new-programme',async()=>{clearProgramme();tab('programmes');field($('programme-form'),'name').focus();});
onSubmit('programme-form',saveProgramme);
onClick('asset-add',async()=>{assets.push({id:'',network:'',type:'stellar',code:'',decimals:7});renderRegisters();});
onClick('invoice-add',async()=>{invoices.push({id:'',assetId:assets[0]?.id??'',amount:'',orderIds:[],references:[]});
  invoiceFilter='';$('invoice-filter').value='';invoiceOffset=Math.floor((invoices.length-1)/pageSize)*pageSize;renderRegisters();});
for(const sheet of ['assets','invoices']){
  $(sheet+'-table').addEventListener('input',event=>{const input=event.target.closest('[data-sheet]');if(!input||input.tagName==='SELECT')return;try{writeRegister(input);}catch(problem){showError(problem);}});
  $(sheet+'-table').addEventListener('change',event=>{const input=event.target.closest('[data-sheet]');if(!input)return;
    try{writeRegister(input);if(sheet==='assets')renderRegisters();}catch(problem){showError(problem);}});
  $(sheet+'-file').addEventListener('change',event=>{const file=event.currentTarget.files[0];if(file)guarded(event.currentTarget,()=>importRegister(sheet,file));});
}
$('invoice-filter').addEventListener('input',event=>{invoiceFilter=event.currentTarget.value;invoiceOffset=0;renderRegisters();});
onClick('programme-to-json',async()=>{$('programme-json').value=pretty(programmeFromForm());});
onClick('programme-from-json',async()=>{const value=optionalJSON($('programme-json').value,null);applyProgramme(value);notify('Loaded the complete programme into the editable register. Save to retain its new version.');});
onClick('programme-download',async()=>downloadJSON(programmeFromForm(),'invoice-programme.json'));
onSubmit('profile-form',async()=>{const form=$('profile-form');await mutate('workspace.profile',{profile:{...state.profile,name:text(form,'name'),
  organization:text(form,'organization'),contact:text(form,'contact')}},'Saving operator profile');notify('Saved the operator profile.');});
$('capture-connection').addEventListener('change',configureCaptureKinds);
$('capture-kind').addEventListener('change',configureCaptureFields);
onSubmit('capture-form',event=>startCapture(event.submitter?.value==='run'));
onSubmit('source-import-form',sourceImport);
onSubmit('source-project-form',projectSource);
$('source-search').addEventListener('input',()=>{sourceListOffset=0;renderSources();});
onClick('source-clear-filter',async()=>{sourceCaptureFilter=null;sourceListOffset=0;$('source-search').value='';renderSources();});
onClick('source-download',async()=>{if(!selectedSource)throw error('Open an original source.');return sourceDownload(selectedSource.source.id);});
onSubmit('delivery-prepare-form',prepareDeliveries);
onClick('delivery-run-ready',async()=>runDeliveries());
$('delivery-filter').addEventListener('change',()=>{deliveryOffset=0;renderDeliveries();});
onSubmit('delivery-resolve-form',resolveDelivery);
onSubmit('reconcile-form',createReconciliation);
onClick('select-all-sources',async()=>{for(const input of all('#reconcile-sources input'))input.checked=true;});
onClick('reconciliation-open',async()=>openReconciliation($('reconciliation-select').value));
$('reconciliation-filter').addEventListener('input',()=>{reconciliationOffset=0;orderOffset=0;issueOffset=0;renderReconciliation();});
onSubmit('decision-form',saveDecision);
onSubmit('compare-form',compareReconciliations);
onSubmit('report-form',createReport);
onSubmit('export-form',exportWorkspace);
onSubmit('report-export-form',exportReport);
onSubmit('unpack-form',unpackArchive);
onClick('inspect-package',inspectPackage);
onSubmit('receive-form',receivePackage);
onClick('history-refresh',loadHistory);
$('operation-method').addEventListener('change',operationContract);
onSubmit('operation-form',runOperation);
window.addEventListener('beforeunload',event=>{if(active>0||pendingRequests.size){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{if(reportObjectURL)URL.revokeObjectURL(reportObjectURL);});
async function bootstrap(){
  if(!token)throw error('Open the complete local workspace URL printed by the operator or opened by Applications. The link contains its private access token.','OPERATOR_LINK_REQUIRED');
  busy('Opening invoice and settlement operator',1);
  try{
    const opened=await responseJSON(await request('/api/bootstrap'));
    state=bindWorkspace(opened);catalog=opened.catalog;methods=opened.methods;operatorInfo=opened.operator;
    clearProgramme();
    for(const key of ['name','organization','contact'])field($('profile-form'),key).value=state.profile[key]??'';
    select('operation-method',methods.map(row=>({value:row.method,label:row.method+(row.mutates?' · changes workspace':'')})));
    operationContract();render();renderConnections();tab('overview');
    await restoreBrowserRequests().catch(showError);
    setInterval(()=>{if(!document.hidden)refresh().catch(showError);},5000);
  }finally{busy('',-1);}
}
bootstrap().catch(showError);
