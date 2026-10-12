// MIT. Industrial Fuul operator with durable original browser requests.
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const model={state:null,operator:null,methods:[],catalog:[],actionCatalog:[],active:null,programme:null,tab:'overview',tables:new Map(),sourceId:null,editionId:null,reportUrl:null,busy:0,knownEditions:new Map()};
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('token')??sessionStorage.getItem('fuul-operator-token');
if(fragment.has('token')){sessionStorage.setItem('fuul-operator-token',token);history.replaceState(null,'',location.pathname+location.search);}
const headers=()=>({Authorization:'Bearer '+(token??'')});
function node(tag,attributes={},children=[]){
 const element=document.createElement(tag);
 for(const [key,value] of Object.entries(attributes)){
  if(value===undefined||value===null)continue;
  if(key==='text')element.textContent=String(value);
  else if(key==='class')element.className=value;
  else if(key.startsWith('on')&&typeof value==='function')element.addEventListener(key.slice(2),value);
  else if(key in element&&['value','checked','disabled','hidden','required','type','rows'].includes(key))element[key]=value;
  else element.setAttribute(key,String(value));
 }
 for(const child of (Array.isArray(children)?children:[children]))if(child!==null&&child!==undefined)element.append(typeof child==='string'?document.createTextNode(child):child);
 return element;
}
function jsonView(value){return node('pre',{text:JSON.stringify(value,null,2)});}
function textOf(value){return value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);}
function message(value,error=false){const target=$('#message');target.hidden=!value;target.dataset.error=String(error);target.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);}
function failure(error){message((error?.code?error.code+': ':'')+(error?.message??String(error)),true);}
function setBusy(change){model.busy+=change;$('#connection-status').textContent=model.busy?'Working · '+model.busy+' active operation'+(model.busy===1?'':'s'):'Connected';}
async function action(work,button){
 if(button)button.disabled=true;setBusy(1);
 try{return await work();}catch(error){failure(error);throw error;}finally{if(button)button.disabled=false;setBusy(-1);}
}
function onForm(id,handler){$(id).addEventListener('submit',event=>{event.preventDefault();action(()=>handler($(id),new FormData($(id))),event.submitter).catch(()=>{});});}
function button(label,handler,extra={}){return node('button',{type:'button',text:label,...extra,onclick:event=>{action(()=>handler(event),event.currentTarget).catch(()=>{});}});}
function optional(value){return typeof value==='string'&&value.trim()?value.trim():undefined;}
function ids(value){const text=optional(value);return text?[...new Set(text.split(/[\s,]+/).filter(Boolean))]:undefined;}
function jsonInput(value,label,fallback={}){
 if(!optional(value))return fallback;try{return JSON.parse(value);}catch{throw new Error(label+' must contain complete JSON.');}
}
function valueOf(form,name){return form.elements.namedItem(name)?.value??'';}
function setValue(form,name,value){const element=form.elements.namedItem(name);if(element)element.value=value??'';}
function activeArgs(){
 if(!model.active||!model.programme)throw new Error('Select an accepted programme first.');
 return {programmeId:model.active,programmeVersion:model.programme.version};
}
function showResult(result,label='Operation result'){
 const target=$('#latest-operation');target.replaceChildren(node('h3',{text:label}),jsonView(result));
 if(result?.error)message(result.error,true);else message(label+' completed.');
}
function showDialog(title,content){
 $('#dialog-title').textContent=title;$('#dialog-content').replaceChildren(content?.nodeType?content:jsonView(content));$('#detail-dialog').showModal();
}
$('#close-dialog').addEventListener('click',()=>$('#detail-dialog').close());

function claimSignaturePreview(result){
 const error=result?.error??result,preview=error?.details?.preview;
 return error?.code==='SIGNATURE_REQUIRED'&&preview&&typeof preview.preparedTransactionXdr==='string'&&preview.preparedTransactionXdr.length?preview:null;
}
function claimSignatureEntry(entry,result=entry?.result){
 return entry?.method==='action.prepare'&&entry.args?.operation==='stellar.claim'?claimSignaturePreview(result):null;
}
function followingClaimArgs(args){
 const original=structuredClone(args);delete original.requestId;delete original.expectedRevision;return original;
}
let claimContinuation=null;
function clearClaimContinuation(){
 claimContinuation=null;$('#action-form').querySelector('[data-claim-continuation]')?.remove();
}
async function selectOriginalClaim(args){
 await activeProgramme(args.programmeId,args.programmeVersion);
 const form=$('#action-form');
 setValue(form,'connectionAlias',args.connectionAlias);
 if(valueOf(form,'connectionAlias')!==args.connectionAlias)throw new Error('Open this workspace with the original claim connection '+args.connectionAlias+'.');
 refreshActionSchema();setValue(form,'operation',args.operation);refreshActionSchema();
 if(valueOf(form,'operation')!==args.operation)throw new Error('The original connection must expose '+args.operation+' before this prepared transaction can continue.');
 return form;
}
function claimPreparationArgs(form,input){
 const selected={...activeArgs(),connectionAlias:valueOf(form,'connectionAlias'),operation:valueOf(form,'operation'),input};
 if(!claimContinuation)return selected;
 const saved=claimContinuation;
 if(saved.workspaceId!==model.state.workspaceId||saved.directory!==model.operator.workspaceDirectory)throw new Error('This signed claim belongs to its original workspace.');
 if(['programmeId','programmeVersion','connectionAlias','operation'].some(name=>selected[name]!==saved.args[name]))
  throw new Error('Use the original programme and connection shown below the claim input, or start a separate preparation.');
 if(input.preparedTransactionXdr!==saved.preparedTransactionXdr)throw new Error('Keep the exact prepared transaction with this wallet signature.');
 return {...structuredClone(saved.args),input};
}
async function clearCompletedClaimSignature(entry,result){
 if(entry?.method!=='action.prepare'||entry.args?.operation!=='stellar.claim'||!result?.actionId||typeof entry.args?.input?.preparedTransactionXdr!=='string')return;
 for(const prior of await journalEntries()){
  if(prior.key===entry.key||prior.workspaceId!==entry.workspaceId||prior.directory!==entry.directory)continue;
  const preview=claimSignatureEntry(prior);
  if(preview?.preparedTransactionXdr!==entry.args.input.preparedTransactionXdr)continue;
  if(['programmeId','programmeVersion','connectionAlias','operation'].some(name=>prior.args[name]!==entry.args[name]))continue;
  await journalWrite(prior,true);
 }
}
function showClaimSignature(args,result,scope={}){
 const preview=claimSignaturePreview(result);
 if(args?.operation!=='stellar.claim'||!preview)return false;
 const original=followingClaimArgs(args),workspaceId=scope.workspaceId??model.state.workspaceId,directory=scope.directory??model.operator.workspaceDirectory;
 const identity=/^[a-f0-9]{64}$/i.test(preview.transactionHash??'')?preview.transactionHash:result.preparationId??'prepared';
 const signed=node('textarea',{id:'claim-signed-xdr',rows:8,spellcheck:'false',placeholder:'Paste the signed transaction XDR returned by your wallet.'});
 const file=node('input',{id:'claim-signed-xdr-file',type:'file',accept:'.xdr,.txt,text/plain,application/octet-stream'});
 const selectedFile=node('p',{class:'help',text:'Use the wallet’s signed XDR file or paste its complete signed transaction below.'});
 file.addEventListener('change',()=>action(async()=>{
  const selected=file.files[0];if(!selected)return;
  signed.value=await selected.text();selectedFile.textContent=selected.name+' · '+selected.size+' original bytes';signed.focus();
 }).catch(()=>{}));
 const box=node('div',{},[
  node('p',{text:'Download the prepared transaction, review and sign it in your Stellar wallet, then return the signed XDR here. The saved voucher, wallet, fee limit and original programme remain selected.'}),
  keyValues({Programme:original.programmeId,Version:original.programmeVersion,Connection:original.connectionAlias,Wallet:original.input?.walletAddress,
   'Manager contract':preview.contracts?.manager,'Maximum fee (stroops)':original.input?.maximumFeeStroops,
   'Prepared fee (stroops)':preview.feeStroops,'Simulation ledger':preview.simulationLedger,'Transaction hash':preview.transactionHash}),
  node('div',{class:'button-row'},[
   button('Download prepared XDR',()=>saveBlob(new Blob([preview.preparedTransactionXdr],{type:'text/plain;charset=utf-8'}),'fuul-claim-'+identity+'.xdr'),{id:'claim-download-prepared-xdr'}),
   button('Download complete claim input',()=>downloadJSON({schema:'stellar-forge.fuul-programmes.claim-signature-handoff.v1',workspaceId,directory,
    preparationId:result.preparationId??args.requestId??null,args:original,preview},'fuul-claim-'+identity+'-input.json'))
  ]),
  node('details',{},[node('summary',{text:'Original preparation and complete voucher'}),jsonView({args:original,preview})]),
  node('label',{},['Signed transaction file',file]),selectedFile,
  node('label',{},['Signed transaction XDR',signed]),
  button('Use signed transaction in request',async()=>{
   const signedTransactionXdr=signed.value.trim();
   if(!signedTransactionXdr)throw new Error('Select or paste the complete signed transaction returned by your wallet.');
   if(workspaceId!==model.state.workspaceId||directory!==model.operator.workspaceDirectory)throw new Error('Reopen the original workspace before continuing this claim.');
   const form=await selectOriginalClaim(original),input={...structuredClone(original.input),preparedTransactionXdr:preview.preparedTransactionXdr,signedTransactionXdr};
   clearClaimContinuation();
   claimContinuation={args:original,workspaceId,directory,preparedTransactionXdr:preview.preparedTransactionXdr};
   setValue(form,'input',JSON.stringify(input,null,2));
   form.append(node('div',{class:'request-card','data-claim-continuation':'true'},[
    node('strong',{text:'Signed claim uses the original programme selection'}),
    node('p',{text:original.programmeId+' · version '+original.programmeVersion+' · '+original.connectionAlias}),
    node('p',{text:'The complete original voucher and fee selection are in the input above, together with the prepared and signed transactions. Prepare this request to retain its original dispatch intent.'}),
    node('div',{class:'button-row'},[
     button('Use original programme',()=>selectOriginalClaim(original)),
     button('Download signed preparation input',()=>downloadJSON({...original,input:jsonInput(valueOf(form,'input'),'Original claim input')},'fuul-claim-'+identity+'-signed-input.json')),
     button('Start a separate preparation',()=>{setValue(form,'input',JSON.stringify(original.input,null,2));clearClaimContinuation();message('The original input is ready for a separate preparation.');})
    ])
   ]));
   $('#detail-dialog').close();setTab('actions');form.elements.namedItem('input').focus();
   message('Signed transaction loaded with its original voucher, wallet, fee limit and programme. Use Prepare request for dispatch to continue.');
  },{id:'claim-use-signed-xdr',class:'primary'})
 ]);
 showDialog('Sign the original Stellar claim',box);return true;
}

function keyValues(value){
 const list=node('dl',{class:'key-values'});
 for(const [key,item] of Object.entries(value))list.append(node('dt',{text:key}),node('dd',{text:textOf(item)}));
 return list;
}
async function responseJSON(response){
 const body=await response.text();let value;
 try{value=JSON.parse(body);}catch{const error=new Error('The operator returned an incomplete or invalid JSON response.');error.code='INVALID_OPERATOR_RESPONSE';error.httpStatus=response.status;throw error;}
 if(!response.ok){const detail=value?.error??{};const error=new Error(detail.message??('Operator response '+response.status));Object.assign(error,detail,{httpStatus:response.status,response:value});throw error;}
 return value;
}
async function read(method,args={}){
 return responseJSON(await fetch('/api/invoke',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({method,args})}));
}
async function getState(){
 const state=await responseJSON(await fetch('/api/state',{headers:headers()}));
 if(model.state&&state.workspaceId!==model.state.workspaceId)throw new Error('The operator now has a different workspace identity. Open its complete workspace link.');
 model.state=state;renderSummary();return state;
}
let database,databaseOpening,databaseGeneration=0;
const JOURNAL_STORE='original-requests',sendingRequests=new Map();
function journalKey(entry){
 if(!entry||typeof entry.workspaceId!=='string'||!entry.workspaceId||typeof entry.directory!=='string'||!entry.directory||typeof entry.id!=='string'||!entry.id)
  throw new Error('The original browser request is missing its workspace, directory or request identity.');
 return JSON.stringify([entry.workspaceId,entry.directory,entry.id]);
}
function journalError(code,message){const error=new Error(message);error.code=code;return error;}
function canonicalRequest(value){
 if(Array.isArray(value))return '['+value.map(canonicalRequest).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalRequest(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function sameOriginalWire(left,right){
 if(left.url!==right.url||left.method!==right.method||canonicalRequest(left.headers)!==canonicalRequest(right.headers))return false;
 if(typeof left.body!=='string'||typeof right.body!=='string')return false;
 if(left.body===right.body)return true;
 if(left.url==='/api/invoke')try{return canonicalRequest(JSON.parse(left.body))===canonicalRequest(JSON.parse(right.body));}catch{}
 return false;
}
function closeDatabase(){
 const connection=database;database=null;databaseOpening=null;databaseGeneration++;
 if(connection)try{connection.close();}catch{}
}
async function db(){
 if(database)return database;
 if(databaseOpening)return databaseOpening;
 const generation=databaseGeneration,opening=new Promise((resolve,reject)=>{
  const request=indexedDB.open('fuul-programme-original-requests',2);let unavailable=false;
  request.onupgradeneeded=()=>{
   const connection=request.result,tx=request.transaction;
   const target=connection.objectStoreNames.contains(JOURNAL_STORE)?tx.objectStore(JOURNAL_STORE):connection.createObjectStore(JOURNAL_STORE,{keyPath:'key'});
   if(connection.objectStoreNames.contains('requests')){
    const cursor=tx.objectStore('requests').openCursor();
    cursor.onsuccess=()=>{
     if(!cursor.result)return;
     try{
      const entry=cursor.result.value,key=journalKey(entry);
      target.put({...entry,key,journalToken:entry.journalToken??crypto.randomUUID()});
      cursor.result.continue();
     }catch{tx.abort();}
    };
    cursor.onerror=()=>tx.abort();
   }
  };
  request.onsuccess=()=>{
   const connection=request.result;
   if(unavailable||generation!==databaseGeneration){connection.close();reject(journalError('BROWSER_PAGE_SUSPENDED','The workspace page changed while its original request store was opening. Reopen the saved request.'));return;}
   connection.onversionchange=()=>{if(database===connection)closeDatabase();else connection.close();};
   connection.onclose=()=>{if(database===connection)database=null;};
   database=connection;resolve(connection);
  };
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>{unavailable=true;reject(new Error('Close another outdated Fuul operator page to reopen the original request store.'));};
 });
 databaseOpening=opening;
 try{return await opening;}finally{if(databaseOpening===opening)databaseOpening=null;}
}
async function journalWrite(entry,remove=false,{create=false}={}){
 const connection=await db(),key=journalKey(entry);
 return new Promise((resolve,reject)=>{
  let tx,result,problem;
  try{tx=connection.transaction(JOURNAL_STORE,'readwrite',{durability:'strict'});}catch{tx=connection.transaction(JOURNAL_STORE,'readwrite');}
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(problem??tx.error);
  tx.onabort=()=>reject(problem??tx.error??new Error('The original request was not saved.'));
  const store=tx.objectStore(JOURNAL_STORE),read=store.get(key);
  read.onsuccess=()=>{
   try{
    const prior=read.result;
    if(create){
     if(prior){
      if(!sameOriginalWire(prior,entry))throw journalError('BROWSER_REQUEST_CONFLICT','This request ID already has a saved original body. Recover or review that request before creating a different one.');
      result=prior;return;
     }
     result={...entry,key,journalToken:crypto.randomUUID()};store.add(result);return;
    }
    if(!prior){
     if(remove){result=entry;return;}
     throw journalError('BROWSER_REQUEST_MISSING','The saved original request was removed. Review the original server result before continuing.');
    }
    if(!entry.journalToken||entry.journalToken!==prior.journalToken)throw journalError('BROWSER_REQUEST_CHANGED','The saved original request changed in another page. Reopen its retained request before continuing.');
    if(remove){store.delete(key);result=entry;return;}
    if(prior.status==='COMPLETED'){result=prior;return;}
    const changes=Object.fromEntries(['status','lastAttemptAt','error','completedAt','result'].filter(name=>Object.hasOwn(entry,name)).map(name=>[name,entry[name]]));
    result={...prior,...changes,key,journalToken:prior.journalToken};store.put(result);
   }catch(error){problem=error;tx.abort();}
  };
 });
}
async function journalEntries(){
 const connection=await db();
 return new Promise((resolve,reject)=>{
  const tx=connection.transaction(JOURNAL_STORE,'readonly'),request=tx.objectStore(JOURNAL_STORE).getAll();let rows;
  request.onsuccess=()=>{rows=request.result;};
  tx.oncomplete=()=>resolve(rows??[]);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The original request store could not be read.'));
 });
}
async function finishSaved(entry,result){
 // Retain the complete acknowledged result until the workspace is refreshed.
 // A claim awaiting its wallet signature stays in this same original journal
 // so its exact voucher and prepared XDR can be reopened after navigation.
 await getState();
 if(!claimSignatureEntry(entry,result)){
  await clearCompletedClaimSignature(entry,result);await journalWrite(entry,true);
 }
 await renderJournal();return result;
}
async function sendSaved(entry){
 const key=journalKey(entry);
 if(sendingRequests.has(key))return sendingRequests.get(key);
 const pending=(async()=>{
  if(entry.workspaceId!==model.state.workspaceId||entry.directory!==model.operator.workspaceDirectory)throw new Error('This original request belongs to another workspace.');
  if(!entry.url.startsWith('/api/'))throw new Error('The saved original request route is invalid.');
  entry=await journalWrite({...entry,status:'SENDING',lastAttemptAt:new Date().toISOString()});
  if(entry.status==='COMPLETED')return finishSaved(entry,entry.result);
  let result;
  try{
   const response=await fetch(entry.url,{method:'POST',headers:{...entry.headers,...headers(),'X-Fuul-Workspace-ID':entry.workspaceId},body:entry.body});
   result=await responseJSON(response);
  }catch(error){
   await journalWrite({...entry,status:'AWAITING_RESULT',lastAttemptAt:new Date().toISOString(),error:{code:error.code??'CONNECTION_INTERRUPTED',message:error.message,httpStatus:error.httpStatus??null}}).catch(()=>{});
   await renderJournal().catch(()=>{});throw error;
  }
  entry=await journalWrite({...entry,status:'COMPLETED',completedAt:new Date().toISOString(),error:null,result});
  return finishSaved(entry,result);
 })();
 sendingRequests.set(key,pending);
 try{return await pending;}finally{if(sendingRequests.get(key)===pending)sendingRequests.delete(key);}
}
async function perform(method,args={}){
 const definition=model.methods.find(row=>row.method===method);if(!definition)throw new Error('This operator method is unavailable.');
 if(!definition.mutates)return read(method,args);
 const state=await getState(),input={...args,requestId:args.requestId??crypto.randomUUID()};
 if(method!=='package.receive')input.expectedRevision??=state.revision;
 const entry={id:input.requestId,workspaceId:state.workspaceId,directory:model.operator.workspaceDirectory,
  label:method,url:'/api/invoke',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args:input}),method,args:input,
  createdAt:new Date().toISOString(),status:'SAVED'};
 const saved=await journalWrite(entry,false,{create:true});await renderJournal();return sendSaved(saved);
}
async function sourceUpload(file,args){
 const state=await getState(),input={...args,requestId:crypto.randomUUID(),expectedRevision:state.revision};
 const bytes=new TextEncoder().encode(JSON.stringify(input));let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 const entry={id:input.requestId,workspaceId:state.workspaceId,directory:model.operator.workspaceDirectory,label:'source.import · '+file.name,
  url:'/api/sources/import',headers:{'Content-Type':'application/octet-stream','X-Fuul-Source':btoa(binary)},body:file,method:'source.import',args:input,filename:file.name,
  createdAt:new Date().toISOString(),status:'SAVED'};
 const saved=await journalWrite(entry,false,{create:true});await renderJournal();return sendSaved(saved);
}
async function archiveUpload(file,manifestSha256){
 const state=await getState(),id=crypto.randomUUID(),query=new URLSearchParams({requestId:id});if(manifestSha256)query.set('manifestSha256',manifestSha256);
 const entry={id,workspaceId:state.workspaceId,directory:model.operator.workspaceDirectory,label:'package.unpack · '+file.name,url:'/api/packages/unpack?'+query,
  headers:{'Content-Type':'application/gzip',...(manifestSha256?{'X-Fuul-Manifest-SHA256':manifestSha256}:{})},body:file,method:'package.unpack',args:{manifestSha256:manifestSha256??null},filename:file.name,createdAt:new Date().toISOString(),status:'SAVED'};
 const saved=await journalWrite(entry,false,{create:true});await renderJournal();return sendSaved(saved);
}
async function saveBlob(blob,filename){
 const url=URL.createObjectURL(blob),anchor=node('a',{href:url,download:filename});document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function download(url,filename){
 const response=await fetch(url,{headers:headers()});if(!response.ok){await responseJSON(response);return;}
 await saveBlob(await response.blob(),filename);
}
function downloadJSON(value,filename){return saveBlob(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),filename);}
async function renderJournal(){
 const all=await journalEntries(),current=all.filter(row=>row.workspaceId===model.state?.workspaceId&&row.directory===model.operator?.workspaceDirectory).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const target=$('#request-journal');target.replaceChildren();
 if(!current.length){target.append(node('p',{class:'empty',text:'Every submitted request has a retained result.'}));return;}
 for(const entry of current){
  const card=node('article',{class:'request-card','data-request-id':entry.id},[
   node('strong',{text:entry.label}),node('p',{class:'mono',text:entry.id}),node('p',{text:entry.createdAt+' · '+entry.status}),
   entry.error?node('p',{text:entry.error.message}):null,
   node('div',{class:'button-row'},[
    button(claimSignatureEntry(entry)?'Continue wallet signing':entry.status==='COMPLETED'?'Open retained result':'Recover original request',async()=>{
     const result=await sendSaved(entry);showResult(result,'Recovered '+entry.label);await refreshVisible();
     if(claimSignatureEntry(entry,result))showClaimSignature(entry.args,result,entry);
    }),
    button('Review original request',()=>{showDialog(entry.label,{...entry,body:typeof entry.body==='string'?entry.body:{filename:entry.filename,bytes:entry.body.size,type:entry.body.type}});}),
    button('Save original body',()=>saveBlob(typeof entry.body==='string'?new Blob([entry.body],{type:'application/json'}):entry.body,entry.filename??entry.id+'.json')),
    button('Remove saved browser request',async()=>{await journalWrite(entry,true);await renderJournal();})
   ])
  ]);target.append(card);
 }
}
function setTab(name){
 if(!$('#'+name)?.classList.contains('view'))return;
 for(const section of $$('.view'))section.hidden=section.id!==name;
 for(const link of $$('nav [data-tab]')){if(link.dataset.tab===name)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 model.tab=name;refreshVisible().catch(failure);
}
for(const link of $$('[data-tab]'))link.addEventListener('click',()=>setTab(link.dataset.tab));


function editionLabel(row){return (row.name??row.id)+(row.asOf?' · '+row.asOf:'');}
function rememberEdition(row){
 if(!row?.id)return;
 const previous=model.knownEditions.get(row.id)??{};
 model.knownEditions.set(row.id,{...previous,...row});
}
function selectEdition(select,id,row,label){
 if(row)rememberEdition({...row,id});
 if(![...select.options].some(option=>option.value===id)){
  const known=model.knownEditions.get(id);
  select.append(node('option',{value:id,text:known?editionLabel(known):(label||id)}));
 }
 select.value=id;
}
function renderSummary(){
 if(!model.state)return;
 $('#organization').textContent=model.state.profile.organization??'';
 $('#workspace-id').textContent=model.state.workspaceId;$('#revision').textContent='Revision '+model.state.revision;
 $('#workspace-path').textContent=model.operator?.workspaceDirectory??'';
 const values=[['Programmes',model.state.counts.programmes],['Ready events',model.state.eventStates.READY??0],
  ['Events awaiting review',(model.state.eventStates.UNCERTAIN??0)+(model.state.eventStates.FAILED??0)],['Reports',model.state.counts.reports]];
 $('#metrics').replaceChildren(...values.map(([label,value])=>node('article',{class:'metric'},[node('strong',{text:value}),node('span',{text:label})])));
 const existing=$('#active-programme').value;
 const programmeRows=Object.values(model.state.programmes);
 $('#active-programme').replaceChildren(node('option',{value:'',text:'Select a programme'}),...programmeRows.map(row=>node('option',{value:row.id,text:row.name+' · v'+row.currentVersion})));
 if(model.active&&!programmeRows.some(row=>row.id===model.active))$('#active-programme').append(node('option',{value:model.active,text:model.programme?.name??model.active}));
 $('#active-programme').value=model.active??existing;
 $('#active-programme-summary').textContent=model.programme?model.programme.definition.projectId+' · '+model.programme.definition.network+' · version '+model.programme.version:'';
 const connectionRows=model.state.connections??[];
 $('#connections-list').replaceChildren(...connectionRows.map(row=>node('div',{class:'request-card'},[node('strong',{text:row.alias}),node('p',{text:[row.provider,row.projectId,row.network,row.authType].filter(Boolean).join(' · ')}),node('code',{text:row.origin})])));
 if(!connectionRows.length)$('#connections-list').append(node('p',{class:'empty',text:'Open this workspace with its private connection configuration to read the original services.'}));
 for(const select of $$('.connection-select')){
  const previous=select.value,empty=select.querySelector('option[value=""]')?.textContent;
  select.replaceChildren(...(empty?[node('option',{value:'',text:empty})]:[node('option',{value:'',text:'Select original connection'})]),
   ...connectionRows.map(row=>node('option',{value:row.alias,text:row.alias+' · '+row.provider+' · '+(row.projectId??row.network)})));
  select.value=previous;
 }
 const editions=Object.values(model.state.reconciliations);
 for(const row of editions)rememberEdition(row);
 for(const select of $('.edition-select')){
  const previous=select.value,previousLabel=select.selectedOptions[0]?.textContent;
  select.replaceChildren(node('option',{value:'',text:'Select original edition'}),
   ...editions.filter(row=>!model.active||row.programmeId===model.active).map(row=>node('option',{value:row.id,text:editionLabel(row)})));
  if(previous)selectEdition(select,previous,model.knownEditions.get(previous),previousLabel);
 }
 const previousMapping=$('#mapping-select').value;
 $('#mapping-select').replaceChildren(node('option',{value:'',text:'Select programme mapping'}),...(model.programme?.definition.mappings??[]).map(row=>node('option',{value:row.id,text:row.name??row.id})));
 $('#mapping-select').value=previousMapping;
 const profile=$('#profile-form');
 if(!profile.dataset.dirty&&!profile.contains(document.activeElement)){setValue(profile,'name',model.state.profile.name);setValue(profile,'organization',model.state.profile.organization);}
 $('#recent-work').replaceChildren(keyValues({'Native captures':model.state.counts.captures,'Retained sources':model.state.counts.sources,'Prepared actions':model.state.counts.actions,'Complete runs':model.state.counts.runs,'Operating editions':model.state.counts.reconciliations,'Workspace head':model.state.head??'New workspace'}));
}
function cellValue(row,path){
 if(typeof path==='function')return path(row);
 let value=row;for(const key of String(path).split('.'))value=value?.[key];return value;
}
function simpleTable(rows,columns,rowActions){
 if(!rows.length)return node('p',{class:'empty',text:'No records in this selection.'});
 const table=node('table'),head=node('tr');
 for(const [label] of columns)head.append(node('th',{text:label}));if(rowActions)head.append(node('th',{text:'Actions'}));
 table.append(node('thead',{},[head]));const body=node('tbody');
 for(const row of rows){
  const tr=node('tr');for(const [,path,format] of columns){const value=cellValue(row,path);tr.append(node('td',{},[format?format(value,row):node(typeof value==='string'&&value.length>30?'code':'span',{text:textOf(value)})]));}
  if(rowActions)tr.append(node('td',{},node('div',{class:'row-actions'},rowActions(row))));body.append(tr);
 }table.append(body);return node('div',{class:'table-wrap'},[table]);
}
function pageControls(page,load){
 return node('div',{class:'pager'},[
  node('span',{text:page.total?String(page.offset+1)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total:'0 records'}),
  button('Previous',()=>load(Math.max(0,page.offset-page.limit)),{disabled:page.offset===0}),
  button('Next',()=>load(page.nextOffset),{disabled:page.nextOffset===null||page.nextOffset===undefined})
 ]);
}
function createTable(target,table,columns,rowActions,{scoped=true}={}){
 const host=$(target),settings={table,offset:0,limit:50,query:'',status:'',scope:'all',serial:0};
 const query=node('input',{placeholder:'Search original IDs and labels'}),status=node('select',{},[
  node('option',{value:'',text:'All states'}),...['READY','RUNNING','SENDING','ACCEPTED','DUPLICATE','BATCH_OBSERVED','OBSERVED','UNCERTAIN','FAILED','WAITING','PAUSED','COMPLETE','CANCELED'].map(value=>node('option',{value,text:value}))
 ]),scope=node('select',{},[node('option',{value:'all',text:'Whole workspace'}),node('option',{value:'programme',text:'Active programme'})]);
 const data=node('div'),pager=node('div');
 const toolbar=node('div',{class:'table-toolbar'},[node('label',{text:'Find'},[query]),node('label',{text:'State'},[status]),...(scoped?[node('label',{text:'Scope'},[scope])]:[]),
  button('Apply',()=>{settings.query=query.value;settings.status=status.value;settings.scope=scope.value;return load(0);})]);
 host.replaceChildren(toolbar,data,pager);
 async function load(offset=settings.offset){
  settings.offset=offset??0;const serial=++settings.serial;
  const result=await read('workspace.list',{table,offset:settings.offset,limit:settings.limit,...(settings.query?{query:settings.query}:{}),
   ...(settings.status?{status:settings.status}:{}),...(settings.scope==='programme'&&model.active?{programmeId:model.active}:{})});
  if(serial!==settings.serial)return;
  if(table==='reconciliations')for(const row of result.rows)rememberEdition(row);
  data.replaceChildren(simpleTable(result.rows,columns,rowActions));pager.replaceChildren(pageControls(result,load));
 }
 query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();settings.query=query.value;settings.status=status.value;settings.scope=scope.value;action(()=>load(0)).catch(()=>{});}});
 const result={load,settings};model.tables.set(table,result);return result;
}
async function downloadFile(method,args,filename){
 const chunks=[];let offset=0,original=null;
 for(;;){
  const response=await read(method,{...args,offset,length:4*1024*1024}),bytes=Uint8Array.from(atob(response.base64),char=>char.charCodeAt(0));
  if(response.offset!==offset||response.bytes!==bytes.length||!response.file)throw new Error('The original file range is incomplete.');
  if(original&&(original.sha256!==response.file.sha256||original.bytes!==response.file.bytes))throw new Error('The original file changed during transfer.');
  original??=response.file;chunks.push(bytes);offset+=bytes.length;
  if(response.eof){if(offset!==original.bytes)throw new Error('The complete original file has not arrived.');await saveBlob(new Blob(chunks,{type:response.contentType??'application/octet-stream'}),filename??response.filename??'original-file');return;}
  if(!bytes.length)throw new Error('The original file range did not advance.');
 }
}
async function activeProgramme(id,version){
 if(!id){model.active=null;model.programme=null;renderSummary();return;}
 const programme=await read('programme.read',{programmeId:id,...(version?{version}:{})});
 model.active=id;model.programme=programme;renderSummary();refreshSchemas();
}
async function originalCapture(id,run=true){
 const result=await read('capture.read',{captureId:id,limit:1}),row=result.capture;
 const method=run?'capture.run':'capture.next',original=run?row.run?.args:row.inflight?.args;
 const outcome=await perform(method,original??{captureId:id});showResult(outcome,run?'Complete capture':'Native capture page');await refreshVisible();return outcome;
}
async function originalDispatch(table,id){
 const result=await read('queue.read',{table,id,limit:1}),row=result.row;
 const outcome=await perform('queue.next',row.inflight?.args??row.prerequisiteRun?.args??{table,id});showResult(outcome,'Original provider dispatch');await refreshVisible();return outcome;
}
async function originalRun(id){
 const result=await read('run.read',{runId:id,limit:1});
 const outcome=await perform('run.execute',result.run.execution?.args??{runId:id});showResult(outcome,'Complete programme run');await refreshVisible();return outcome;
}
async function openSource(sourceId,offset=0){
 model.sourceId=sourceId;const result=await read('source.read',{sourceId,offset,limit:50});$('#source-inspector').hidden=false;
 $('#source-detail').replaceChildren(keyValues({ID:result.source.id,Provider:result.source.provider,Kind:result.source.kind,Network:result.source.network,Observed:result.source.observedAt,
  'Original bytes':result.source.bodyFile.bytes,'Original SHA-256':result.source.bodyFile.sha256,Projection:result.source.error??'Available'}),
  node('div',{class:'button-row'},[
   button('Download original',()=>download('/api/sources/'+sourceId+'/original','fuul-source-'+sourceId+'.bin')),
   button('Download full projection',()=>downloadFile('source.file',{sourceId,part:'projection'},'fuul-source-'+sourceId+'-projection.json')),
   button('Read original metadata',()=>showDialog('Original source',result.source)),
   button('Use for mapping',()=>{setValue($('#event-prepare-form'),'sourceIds',sourceId);setValue($('#source-project-form'),'sourceId',sourceId);setTab('events');})
  ]));
 $('#source-records').replaceChildren(simpleTable(result.rows,[['Original record','id'],['Entity',row=>row.projection?.entityKey],['Status',row=>row.projection?.status],['Amount',row=>row.projection?.amount],['Original reference',row=>row.projection?.dedupId??row.projection?.payoutId??row.projection?.transactionHash]],row=>[
  button('Open',()=>showDialog('Original source record',row)),
  button('Map',()=>{setValue($('#event-prepare-form'),'sourceIds',sourceId);setValue($('#event-prepare-form'),'recordIds',row.id);setTab('events');}),
  button('Explain',()=>{setValue($('#decision-form'),'sourceId',sourceId);setValue($('#decision-form'),'recordId',row.id);setTab('editions');})
 ]),pageControls(result,offset=>openSource(sourceId,offset)));
 setTab('sources');
}
function outcomeReview(table,id){const form=$('#queue-resolve-form');setValue(form,'table',table);setValue(form,'id',id);setTab('events');form.scrollIntoView({block:'center',behavior:'smooth'});}
async function openQueue(table,id,offset=0){
 const result=await read('queue.read',{table,id,offset,limit:30}),row=result.row;
 const target=table==='actions'?$('#action-detail'):$('#operation-detail'),container=table==='actions'?$('#action-inspector'):$('#operation-inspector');container.hidden=false;
 target.replaceChildren(keyValues({ID:id,Status:row.status,Project:row.projectId,Network:row.network,Connection:row.connectionAlias,'Original body SHA-256':row.bodySha256,Paused:row.paused,
  'Exact pipeline':row.pipeline??'No observation retained'}),node('div',{class:'button-row'},[
   button(row.inflight?'Recover original attempt':'Dispatch original request',()=>originalDispatch(table,id)),
   button(row.paused?'Resume':'Pause',async()=>{showResult(await perform(row.paused?'queue.resume':'queue.pause',{table,id}));await openQueue(table,id,offset);}),
   button('Review outcome',()=>outcomeReview(table,id)),
   button('Download original request',()=>download('/api/operations/'+table+'/'+id+'/files/request','fuul-'+table+'-'+id+'-request.json')),
   button('Open complete intent',()=>showDialog('Original operation intent',result.original)),
   ...(table==='events'?[button('Observe exact pipeline',async()=>{const output=await perform('event.observe',{eventId:id});showResult(output,'Exact event pipeline');await openQueue(table,id,offset);})]:[])
  ]),
  node('h3',{text:'Retained attempts'}),simpleTable(result.attempts,[['Time','startedAt'],['Status','status'],['Provider HTTP',attempt=>attempt.response?.status],['Source','sourceId']],attempt=>[
   button('Open',()=>showDialog('Original dispatch attempt',attempt)),
   button('Response',()=>download('/api/operations/'+table+'/'+id+'/files/response?attemptId='+attempt.id,'fuul-response-'+attempt.id+'.bin')),
   ...(attempt.sourceId?[button('Source',()=>openSource(attempt.sourceId))]:[])
  ]),pageControls(result.attemptPage,offset=>openQueue(table,id,offset)),
  ...(result.conflicts.length?[node('h3',{text:'Changed original bodies'}),simpleTable(result.conflicts,[['Observed','createdAt'],['Source','sourceId'],['Body','bodySha256']],conflict=>[button('Open',()=>showDialog('Changed original body',conflict))])]:[]));
 setTab(table==='actions'?'actions':'events');
}
async function openRun(runId,offset=0){
 const result=await read('run.read',{runId,offset,limit:50});$('#run-inspector').hidden=false;
 $('#run-detail').replaceChildren(keyValues({ID:runId,Work:result.run.kind,Status:result.run.status,Progress:result.run.position+' / '+result.run.taskCount,
  Error:result.run.lastError}),node('div',{class:'button-row'},[button('Continue original run',()=>originalRun(runId)),
  button(result.run.paused?'Resume':'Pause',async()=>{showResult(await perform(result.run.paused?'run.resume':'run.pause',{runId}));await openRun(runId,offset);})]));
 $('#run-tasks').replaceChildren(simpleTable(result.rows,[['Task','id'],['Original selection',row=>row.eventIds??row.objectId],['Status','status'],['Result',row=>row.result?.status??row.error]],row=>[
  button('Open',()=>showDialog('Original run task',row)),
  ...(row.result?.table&&row.result?.id?[button('Operation',()=>openQueue(row.result.table,row.result.id))]:[])
 ]),pageControls(result,offset=>openRun(runId,offset)));setTab('runs');
}
async function openEdition(reconciliationId,offset=0){
 model.editionId=reconciliationId;const section=$('#edition-section').value;
 const result=await read('edition.read',{reconciliationId,section,offset,limit:50}),summary=await read('edition.read',{reconciliationId,limit:1});
 rememberEdition({id:reconciliationId,name:summary.name,asOf:summary.asOf,programmeId:summary.programme?.id??summary.programmeId});
 $('#edition-inspector').hidden=false;$('#edition-title').textContent=summary.name;
 $('#edition-summary').replaceChildren(keyValues({ID:reconciliationId,'As of':summary.asOf,'Programme version':summary.programme.version,'Original sources':summary.sourceIds.length,'Decisions':summary.decisionIds.length}),
  node('details',{},[node('summary',{text:'Summary and source coverage'}),jsonView({summary:summary.data.summary,coverage:summary.data.coverage,sourceWarnings:summary.sourceWarnings})]),
  node('div',{class:'button-row'},[button('Download full edition',()=>download('/api/editions/'+reconciliationId+'/original','fuul-edition-'+reconciliationId+'.json')),
   button('Build report',()=>{selectEdition($('#report-form').elements.namedItem('reconciliationId'),reconciliationId,model.knownEditions.get(reconciliationId));setTab('reports');})]));
 const fields=[['Identity',row=>row.id??row.eventId??row.entityKey??row.dedupId??row.payoutId],['Stage',row=>row.status??row.stage??row.code],['Original user',row=>row.userIdentifier??row.user??row.to],
  ['Currency',row=>row.currency?.id??row.currency?.address??row.currency],['Amount',row=>row.amount??row.totalAmount??row.total_amount],['Reference',row=>row.transactionHash??row.dedupId??row.proof]];
 $('#edition-rows').replaceChildren(simpleTable(result.rows,fields,row=>[button('Open complete row',()=>showDialog('Original '+section+' record',row))]),pageControls(result,offset=>openEdition(reconciliationId,offset)));
 setTab('editions');
}
$('#edition-section').addEventListener('change',()=>{if(model.editionId)action(()=>openEdition(model.editionId)).catch(()=>{});});
async function openReport(reportId){
 const report=await read('report.read',{reportId});$('#report-inspector').hidden=false;
 $('#report-detail').replaceChildren(keyValues({ID:report.id,Name:report.name,Scope:report.scope,'Created at':report.createdAt}),node('div',{class:'button-row'},[
  ...report.files.map(file=>button('Download '+file.format.toUpperCase(),()=>download('/api/reports/'+reportId+'/files/'+file.format,file.filename))),
  button('Open manifest',()=>showDialog('Original report manifest',report)),
  button('Export report',()=>{setValue($('#report-export-form'),'reportId',reportId);setTab('transfer');})
 ]));
 const preview=$('#report-preview');preview.hidden=!report.formats.includes('html');
 if(report.formats.includes('html')){
  const response=await fetch('/api/reports/'+reportId+'/files/html',{headers:headers()});if(!response.ok)await responseJSON(response);
  if(model.reportUrl)URL.revokeObjectURL(model.reportUrl);model.reportUrl=URL.createObjectURL(await response.blob());preview.src=model.reportUrl;
 }
 setTab('reports');
}
function initializeTables(){
 createTable('#programmes-list','programmes',[['Programme','name'],['Original project','projectId'],['Network','network'],['Version','currentVersion']],row=>[
  button('Open',async()=>{await activeProgramme(row.id);fillProgramme(model.programme.definition,model.programme);setTab('programmes');}),
  button('Versions',async()=>{const values=await read('programme.read',{programmeId:row.id});showDialog('Programme version',values);})
 ],{scoped:false});
 createTable('#captures-list','captures',[['Capture','name'],['Kind',row=>row.read.kind],['State','status'],['Sources','sourceCount'],['Attempts','attemptCount']],row=>[
  button('Open',async()=>showDialog('Original capture',await read('capture.read',{captureId:row.id}))),button('Continue',()=>originalCapture(row.id)),
  button(row.paused?'Resume':'Pause',async()=>{showResult(await perform(row.paused?'capture.resume':'capture.pause',{captureId:row.id}));await refreshVisible();})
 ]);
 createTable('#sources-list','sources',[['Source','label'],['Provider','provider'],['Kind','kind'],['Observed','observedAt'],['Records','selectedRecords'],['Projection',row=>row.error?.code??'Available']],row=>[button('Open',()=>openSource(row.id))]);
 createTable('#events-list','events',[['Event','eventName'],['Original action','dedupId'],['User','userIdentifier'],['Delivery','status'],['Pipeline',row=>row.pipeline?.status??'Pending'],['Conflicts','conflictCount']],row=>[
  button('Open',()=>openQueue('events',row.id)),button('Add to batch',()=>{const form=$('#batch-form'),existing=ids(valueOf(form,'eventIds'))??[];setValue(form,'eventIds',[...new Set([...existing,row.id])].join('\n'));})
 ]);
 createTable('#batches-list','batches',[['Batch','id'],['Original project','projectId'],['Events','eventCount'],['State','status'],['Attempts','attemptCount']],row=>[button('Open',()=>openQueue('batches',row.id))]);
 createTable('#actions-list','actions',[['Operation','operation'],['Project','projectId'],['State','status'],['Prerequisites',row=>row.prerequisiteIds?.length??0],['Attempts','attemptCount']],row=>[button('Open',()=>openQueue('actions',row.id))]);
 createTable('#runs-list','runs',[['Run','name'],['Work','kind'],['State','status'],['Progress',row=>row.position+' / '+row.taskCount]],row=>[button('Open',()=>openRun(row.id)),button('Continue',()=>originalRun(row.id))]);
 createTable('#editions-list','reconciliations',[['Edition','name'],['Programme version','programmeVersion'],['As of','asOf'],['Sources',row=>row.sourceIds?.length]],row=>[button('Open',()=>openEdition(row.id))]);
 createTable('#decisions-list','decisions',[['Decision','action'],['Record','recordId'],['Actor','actor'],['Reason','reason']],row=>[button('Open',async()=>showDialog('Original decision',await read('decision.read',{decisionId:row.id})))]);
 createTable('#reports-list','reports',[['Report','name'],['Project','projectId'],['User','userIdentifier'],['Formats',row=>row.formats.join(', ')],['Created','createdAt']],row=>[button('Open',()=>openReport(row.id))]);
 createTable('#exports-list','exports',[['Package','id'],['Kind','kind'],['Directory','directory'],['Manifest','manifestSha256']],row=>[
  button('Download archive',()=>download('/api/packages/'+row.id+'/archive','fuul-workspace-'+row.id+'.tar.gz')),
  button('Inspect',async()=>showDialog('Original exported package',await read('package.inspect',{sourceDirectory:row.directory,expectedManifestSha256:row.manifestSha256})))
 ],{scoped:false});
}
async function loadHistory(offset=0){
 const result=await read('workspace.history',{offset,limit:50});
 $('#history-list').replaceChildren(simpleTable(result.records,[['Revision','revision'],['Time','at'],['Operation','operation'],['Request','requestId']],row=>[button('Open',()=>showDialog('Original transition',row))]),
  pageControls({offset,limit:50,total:result.total,nextOffset:result.nextOffset},loadHistory));
}
async function refreshVisible(){
 const tables={programmes:['programmes'],sources:['captures','sources'],events:['events','batches'],runs:['runs'],actions:['actions'],editions:['reconciliations','decisions'],reports:['reports'],transfer:['exports']}[model.tab]??[];
 const results=await Promise.allSettled(tables.map(table=>model.tables.get(table)?.load()));
 for(const result of results)if(result.status==='rejected')failure(result.reason);
 if(model.tab==='requests'){await renderJournal();await loadHistory();}
}


let editorBase={},editorRows={contracts:[],currencies:[],mappings:[]};
function inputField(label,name,value,options={}){
 const input=node(options.multiline?'textarea':options.options?'select':'input',{name,value:value??'',...(options.multiline?{rows:options.rows??3}:{}),...(options.required?{required:true}:{}),...(options.type?{type:options.type}:{}),spellcheck:'false'});
 if(options.options){input.replaceChildren(...options.options.map(item=>node('option',{value:typeof item==='string'?item:item.value,text:typeof item==='string'?item:item.label})));input.value=value??options.options[0]?.value??options.options[0]??'';}
 return node('label',{text:label},[input]);
}
function editorCard(kind,value,index){
 const row=node('div',{class:'editor-row','data-editor-kind':kind,'data-editor-index':index});
 row.append(node('div',{class:'editor-heading'},[node('strong',{text:(kind==='contracts'?'Contract':kind==='currencies'?'Currency':'Activity mapping')+' '+(index+1)}),
  button('Remove',()=>{readEditorRows();editorRows[kind].splice(index,1);renderEditors();})]));
 if(kind==='contracts')row.append(node('div',{class:'form-grid'},[inputField('Original contract address','address',value.address),inputField('Role','role',value.role??'project')]));
 if(kind==='currencies')row.append(node('div',{class:'form-grid'},[
  inputField('Currency ID','id',value.id),inputField('Original contract address','address',value.address),inputField('Label','label',value.label),
  inputField('Original chain identifier','chainIdentifier',value.chainIdentifier??'',{type:'number'}),
  inputField('Decimals','decimals',value.decimals??7,{type:'number'})
 ]));
 if(kind==='mappings'){
  row.append(node('div',{class:'form-grid'},[
   inputField('Mapping ID','id',value.id),inputField('Mapping name','name',value.name),inputField('Stable source namespace','sourceNamespace',value.sourceNamespace??value.id),inputField('Exact Fuul event name','event',value.event),
   inputField('Source provider','provider',value.provider??'activity',{options:['activity','fuul','stellar']}),
   inputField('Original source kind','kind',value.kind??'activity'),inputField('Field view','view',value.view??'original',{options:['original','projection']}),
   inputField('Original identity pointer','identityPointer',value.identityPointer),inputField('Original user pointer','userPointer',value.userPointer),
   inputField('Original timestamp pointer','timestampPointer',value.timestampPointer)
  ]),inputField('Constant event arguments','args',JSON.stringify(value.args??{},null,2),{multiline:true}),
   inputField('Original field mapping array','fields',JSON.stringify(value.fields??[],null,2),{multiline:true}),
   node('div',{class:'form-grid'},[
    inputField('Value amount pointer','valueAmountPointer',value.value?.amountPointer),inputField('Value currency ID','valueCurrencyId',value.value?.currencyId),
    inputField('Value units','valueUnits',value.value?.units??'base',{options:['base','decimal']}),
    inputField('Revenue amount pointer','revenueAmountPointer',value.revenue?.amountPointer),inputField('Revenue currency ID','revenueCurrencyId',value.revenue?.currencyId),
    inputField('Revenue units','revenueUnits',value.revenue?.units??'base',{options:['base','decimal']})
   ]));
 }
 return row;
}
function renderEditors(){
 for(const [kind,target] of [['contracts','#contract-editor'],['currencies','#currency-editor'],['mappings','#mapping-editor']]){
  $(target).replaceChildren(...editorRows[kind].map((value,index)=>editorCard(kind,value,index)));
  if(!editorRows[kind].length)$(target).append(node('p',{class:'empty',text:'No '+kind+' in this accepted definition.'}));
 }
}
function editorValue(row,name){return row.querySelector('[name="'+name+'"]')?.value??'';}
function readEditorRows(){
 for(const kind of ['contracts','currencies','mappings']){
  const previous=editorRows[kind];
  editorRows[kind]=$$('[data-editor-kind="'+kind+'"]').map((row,index)=>{
   const value={...(previous[index]??{})};
   if(kind==='contracts')return {...value,address:editorValue(row,'address').trim(),role:editorValue(row,'role').trim()};
   if(kind==='currencies'){
    const decimals=Number(editorValue(row,'decimals')),chain=optional(editorValue(row,'chainIdentifier'));
    if(!Number.isSafeInteger(decimals)||decimals<0||decimals>38)throw new Error('Currency decimals must be a whole original precision.');
    return {...value,id:editorValue(row,'id').trim(),address:editorValue(row,'address').trim(),label:editorValue(row,'label').trim(),
     decimals,chainIdentifier:chain?Number(chain):(valueOf($('#programme-form'),'network')==='stellar:pubnet'?148:1481)};
   }
   for(const key of ['id','name','event','provider','kind','view','userPointer'])value[key]=editorValue(row,key).trim();
   for(const key of ['identityPointer','timestampPointer','sourceNamespace']){const selected=optional(editorValue(row,key));if(selected)value[key]=selected;else delete value[key];}
   value.args=jsonInput(editorValue(row,'args'),'Constant mapping arguments');value.fields=jsonInput(editorValue(row,'fields'),'Original field mapping',[]);
   for(const field of ['value','revenue']){
    const pointer=optional(editorValue(row,field+'AmountPointer')),currency=optional(editorValue(row,field+'CurrencyId'));
    if(pointer||currency){if(!pointer||!currency)throw new Error('Supply both '+field+' amount pointer and currency ID.');value[field]={amountPointer:pointer,currencyId:currency,units:editorValue(row,field+'Units')};}
    else delete value[field];
   }
   return value;
  });
 }
 return editorRows;
}
function programmeDefinition(){
 const form=$('#programme-form');readEditorRows();
 const network=valueOf(form,'network');if(!['stellar:pubnet','stellar:testnet'].includes(network))throw new Error('Select the original Stellar network.');
 const additional={...editorBase};delete additional.period;delete additional.selection;
 const periodFrom=optional(valueOf(form,'periodFrom')),periodTo=optional(valueOf(form,'periodTo'));
 if(periodFrom||periodTo){
  if(!periodFrom||!periodTo)throw new Error('Supply both ends of the original reporting period.');
  const from=new Date(periodFrom+'Z'),to=new Date(periodTo+'Z');if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime()))throw new Error('Select valid UTC period dates.');
  additional.period={from:from.toISOString(),to:to.toISOString(),timeZone:'UTC'};
 }
 const selection={};for(const key of ['incentiveIds','incentiveSlugs','triggerRefs','audienceIds','tierIds']){const chosen=ids(valueOf(form,key));if(chosen)selection[key]=chosen;}
 if(Object.keys(selection).length)additional.selection=selection;
 return {...additional,name:valueOf(form,'name').trim(),projectId:valueOf(form,'projectId').trim(),network,chainIdentifier:network==='stellar:pubnet'?148:1481,
  contracts:structuredClone(editorRows.contracts),currencies:structuredClone(editorRows.currencies),mappings:structuredClone(editorRows.mappings),
  providerSourceIds:ids(valueOf(form,'providerSourceIds'))??[],rules:jsonInput(valueOf(form,'rules'),'Programme rules')};
}
function fillProgramme(definition={},version=null){
 editorBase=structuredClone(definition);editorRows={contracts:structuredClone(definition.contracts??[]),currencies:structuredClone(definition.currencies??[]),mappings:structuredClone(definition.mappings??[])};
 const form=$('#programme-form');setValue(form,'programmeId',version?.id??'');setValue(form,'expectedVersion',version?.version??'');
 for(const name of ['name','projectId','network'])setValue(form,name,definition[name]??'');
 setValue(form,'providerSourceIds',(definition.providerSourceIds??[]).join('\n'));setValue(form,'rules',JSON.stringify(definition.rules??{},null,2));
 for(const [field,key] of [['periodFrom','from'],['periodTo','to']])setValue(form,field,definition.period?.[key]?new Date(definition.period[key]).toISOString().slice(0,16):'');
 for(const key of ['incentiveIds','incentiveSlugs','triggerRefs','audienceIds','tierIds'])setValue(form,key,(definition.selection?.[key]??[]).join('\n'));
 $('#programme-editor-title').textContent=version?version.name+' · editing version '+version.version:'New programme';
 $('#programme-json').value=JSON.stringify(definition,null,2);renderEditors();
}
async function saveProgramme(definition){
 const form=$('#programme-form'),id=optional(valueOf(form,'programmeId')),version=optional(valueOf(form,'expectedVersion'));
 const result=await perform('programme.save',{definition,...(id?{programmeId:id}:{}),...(version?{expectedVersion:Number(version)}:{})});
 await activeProgramme(result.programmeId,result.version);fillProgramme(model.programme.definition,model.programme);showResult(result,'Programme version');await refreshVisible();
}
for(const [id,kind] of [['#add-contract','contracts'],['#add-currency','currencies'],['#add-mapping','mappings']])$(id).addEventListener('click',()=>action(async()=>{readEditorRows();editorRows[kind].push({});renderEditors();}).catch(()=>{}));
$('#new-programme').addEventListener('click',()=>fillProgramme({name:'',projectId:'',network:'',contracts:[],currencies:[],mappings:[],providerSourceIds:[],rules:{}}));
$('#programme-to-json').addEventListener('click',()=>action(async()=>{$('#programme-json').value=JSON.stringify(programmeDefinition(),null,2);}).catch(()=>{}));
$('#programme-from-json').addEventListener('click',()=>action(async()=>{const form=$('#programme-form'),id=optional(valueOf(form,'programmeId')),version=optional(valueOf(form,'expectedVersion'));
 const definition=jsonInput($('#programme-json').value,'Programme definition');
 fillProgramme(definition,id?{id,version:Number(version),name:definition.name}:null);}).catch(()=>{}));
$('#programme-save-json').addEventListener('click',event=>action(()=>saveProgramme(jsonInput($('#programme-json').value,'Programme definition')),event.currentTarget).catch(()=>{}));
$('#download-programme').addEventListener('click',()=>action(()=>downloadJSON(programmeDefinition(),'fuul-programme.json')).catch(()=>{}));
$('#programme-file').addEventListener('change',event=>action(async()=>{const file=event.target.files[0];if(!file)return;fillProgramme(JSON.parse(await file.text()));}).catch(()=>{}));
onForm('#programme-form',()=>saveProgramme(programmeDefinition()));
$('#active-programme').addEventListener('change',event=>action(async()=>{await activeProgramme(event.target.value);await refreshVisible();}).catch(()=>{}));
$('#open-active-programme').addEventListener('click',()=>action(async()=>{if(!model.active)throw new Error('Select an accepted programme.');await activeProgramme(model.active);fillProgramme(model.programme.definition,model.programme);setTab('programmes');}).catch(()=>{}));
function catalogItems(value){
 if(Array.isArray(value))return value;
 if(Array.isArray(value?.operations))return value.operations;
 if(Array.isArray(value?.kinds))return value.kinds;
 if(Array.isArray(value?.catalog))return value.catalog;
 return value&&typeof value==='object'?Object.entries(value).filter(([,item])=>item&&typeof item==='object').map(([kind,item])=>({kind,...item})):[];
}
function fieldSchema(container,schema){
 container.replaceChildren();const properties=schema?.properties??{},required=new Set(schema?.required??[]);
 for(const [name,definition] of Object.entries(properties)){
  if(['kind','signal','provider'].includes(name)||definition.const!==undefined)continue;
  let input;
  if(definition.enum)input=inputField(definition.title??name,name,undefined,{options:[{value:'',label:'Select '+name},...definition.enum.map(value=>({value:String(value),label:String(value)}))]});
  else if(['object','array'].includes(definition.type)||definition.properties)input=inputField(definition.title??name,name,'',{multiline:true});
  else if(definition.type==='boolean')input=inputField(definition.title??name,name,'',{options:[{value:'',label:'Use provider default'},{value:'true',label:'True'},{value:'false',label:'False'}]});
  else input=inputField(definition.title??name,name,'');
  const control=input.querySelector('input,textarea,select');control.dataset.schema=JSON.stringify(definition);control.dataset.required=String(required.has(name));control.dataset.nativeField=name;
  if(definition.description)input.append(node('span',{class:'small',text:definition.description}));
  container.append(input);
 }
}
function schemaValues(container){
 const values={};
 for(const control of container.querySelectorAll('[data-native-field]')){
  const schema=JSON.parse(control.dataset.schema),name=control.dataset.nativeField,value=control.value;
  if(!optional(value)){if(control.dataset.required==='true')throw new Error('Supply the original '+name+'.');continue;}
  if(schema.type==='integer'||schema.type==='number'){
   const number=Number(value);if(!Number.isFinite(number)||(schema.type==='integer'&&!Number.isSafeInteger(number)))throw new Error(name+' must use its native numeric type.');
   values[name]=number;
  }else if(schema.type==='boolean')values[name]=value==='true';
  else if(schema.type==='array'||schema.type==='object'||schema.properties)values[name]=jsonInput(value,name);
  else values[name]=value;
 }
 return values;
}
function refreshCaptureSchema(){
 const form=$('#capture-form'),alias=valueOf(form,'connectionAlias'),holder=model.catalog.find(row=>row.connection.alias===alias),items=catalogItems(holder?.catalog),select=form.elements.namedItem('kind'),previous=select.value;
 select.replaceChildren(node('option',{value:'',text:'Select original source'}),...items.map(item=>node('option',{value:item.kind??item.name,text:(item.title??item.label??item.kind??item.name)+(item.path?' · '+item.path:'')})));
 if(items.some(item=>(item.kind??item.name)===previous))select.value=previous;
 const item=items.find(item=>(item.kind??item.name)===select.value);
 fieldSchema($('#capture-schema'),item?.filtersSchema??item?.inputSchema?.properties?.filters??item?.inputSchema??item?.schema??{});
}
function refreshActionSchema(){
 const form=$('#action-form'),alias=valueOf(form,'connectionAlias'),holder=model.actionCatalog.find(row=>row.connection.alias===alias),items=catalogItems(holder?.catalog),select=form.elements.namedItem('operation'),previous=select.value;
 select.replaceChildren(node('option',{value:'',text:'Select original action'}),...items.map(item=>node('option',{value:item.operation??item.kind??item.name,text:item.operation??item.kind??item.name})));
 if(items.some(item=>(item.operation??item.kind??item.name)===previous))select.value=previous;
 const item=items.find(item=>(item.operation??item.kind??item.name)===select.value);
 fieldSchema($('#action-schema'),item?.inputSchema?.properties?.input??item?.inputSchema??item?.schema??{});
}
function refreshSchemas(){refreshCaptureSchema();refreshActionSchema();}
$('#capture-form [name=connectionAlias]').addEventListener('change',refreshCaptureSchema);
$('#capture-form [name=kind]').addEventListener('change',refreshCaptureSchema);
$('#action-form [name=connectionAlias]').addEventListener('change',refreshActionSchema);
$('#action-form [name=operation]').addEventListener('change',refreshActionSchema);


function formArgs(form,names){
 const result={};for(const name of names){const value=optional(valueOf(form,name));if(value!==undefined)result[name]=value;}return result;
}
async function finish(result,label){showResult(result,label);await refreshVisible();return result;}
onForm('#profile-form',async form=>{
 const result=await perform('workspace.profile',{profile:{...model.state.profile,name:valueOf(form,'name'),organization:valueOf(form,'organization')}});
 delete form.dataset.dirty;return finish(result,'Workspace profile');
});
$('#profile-form').addEventListener('input',event=>{event.currentTarget.dataset.dirty='true';});
onForm('#capture-form',async form=>{
 const selection=optional(valueOf(form,'readJson'))?jsonInput(valueOf(form,'readJson'),'Original read selection'):{kind:valueOf(form,'kind'),filters:schemaValues($('#capture-schema'))};
 const result=await perform('capture.start',{...activeArgs(),connectionAlias:valueOf(form,'connectionAlias'),read:selection,...formArgs(form,['name'])});
 await finish(result,'Native capture');
 if(form.elements.namedItem('run').checked)await originalCapture(result.captureId);
});
onForm('#source-form',async form=>{
 const file=form.elements.namedItem('file').files[0];if(!file)throw new Error('Select a complete original source file.');
 const provider=valueOf(form,'provider'),args={provider,kind:valueOf(form,'kind'),filename:file.name,contentType:file.type||(/\.csv$/i.test(file.name)?'text/csv':'application/json'),
  ...(model.active?activeArgs():{}),...formArgs(form,['label','sourceScope','connectionAlias','format']),recordsPath:optional(valueOf(form,'recordsPath'))??null,
  ...(model.programme?{network:model.programme.definition.network}:{})};
 if(optional(valueOf(form,'request')))args.request=jsonInput(valueOf(form,'request'),'Original request');
 const result=await sourceUpload(file,args);await finish(result,'Original source retained');await openSource(result.sourceId);
});
onForm('#source-project-form',async form=>{
 const result=await perform('source.project',{sourceId:valueOf(form,'sourceId'),recordsPath:optional(valueOf(form,'recordsPath'))??null,...formArgs(form,['provider','kind','connectionAlias','format'])});
 await finish(result,'Original source projected');await openSource(result.sourceId);
});
onForm('#event-prepare-form',async form=>{
 const args={...activeArgs(),connectionAlias:valueOf(form,'connectionAlias'),mappingId:valueOf(form,'mappingId')};
 for(const key of ['sourceIds','recordIds']){const value=ids(valueOf(form,key));if(value)args[key]=value;}
 const result=await perform('event.prepare',args);await finish(result,'Programme events prepared');
 showDialog('Prepared events and original source outcomes',result);
});
onForm('#batch-form',async form=>{
 const eventIds=ids(valueOf(form,'eventIds'));if(!eventIds?.length)throw new Error('Select original ready event UUIDs.');
 const result=await perform('batch.prepare',{eventIds});await finish(result,'Original event batch');await openQueue('batches',result.batchId);
});
onForm('#queue-resolve-form',async form=>{
 const args={...formArgs(form,['table','id','outcome','actor','reason'])},sourceIds=ids(valueOf(form,'sourceIds'));if(sourceIds)args.sourceIds=sourceIds;
 const result=await perform('queue.resolve',args);await finish(result,'Explained original operation outcome');await openQueue(args.table,args.id);
});
onForm('#run-form',async form=>{
 const args={...activeArgs(),kind:valueOf(form,'kind'),batchSize:Number(valueOf(form,'batchSize')),...formArgs(form,['name','connectionAlias'])},selection=ids(valueOf(form,'ids'));if(selection)args.ids=selection;
 const result=await perform('run.start',args);await finish(result,'Complete programme run');
 if(form.elements.namedItem('execute').checked)await originalRun(result.runId);await openRun(result.runId);
});
onForm('#action-form',async form=>{
 const input=optional(valueOf(form,'input'))?jsonInput(valueOf(form,'input'),'Original provider input'):schemaValues($('#action-schema'));
 const args=claimPreparationArgs(form,input);let result;
 try{result=await perform('action.prepare',args);}
 catch(error){if(showClaimSignature(args,error))return;throw error;}
 await finish(result,claimSignaturePreview(result)?'Stellar claim awaiting wallet signature':'Original provider request prepared');
 if(showClaimSignature(args,result))return;
 if(result.actionId){clearClaimContinuation();await openQueue('actions',result.actionId);}else showDialog('Original preparation result',result);
});
onForm('#reconcile-form',async form=>{
 const args={...activeArgs(),...formArgs(form,['name'])};
 if(optional(valueOf(form,'asOf'))){const date=new Date(valueOf(form,'asOf'));if(!Number.isFinite(date.getTime()))throw new Error('Select a valid edition time.');args.asOf=date.toISOString();}
 for(const key of ['sourceIds','decisionIds']){const selection=ids(valueOf(form,key));if(selection)args[key]=selection;}
 const result=await perform('reconciliation.create',args);await finish(result,'Complete programme edition');await openEdition(result.reconciliationId);
});
onForm('#compare-form',async form=>{
 const result=await read('reconciliation.compare',{leftId:valueOf(form,'leftId'),rightId:valueOf(form,'rightId')});
 showDialog('Original programme edition comparison',node('div',{},[jsonView(result),button('Download complete comparison',()=>downloadJSON(result,'fuul-edition-comparison.json'))]));
});
onForm('#decision-form',async form=>{
 const args={...activeArgs(),...formArgs(form,['sourceId','recordId','action','actor','reason','supersedes'])};
 if(args.action==='link')args.link=jsonInput(valueOf(form,'link'),'Original reference link');
 return finish(await perform('decision.save',args),'Explained source decision');
});
onForm('#report-form',async form=>{
 const formats=['html','json','csv'].filter(key=>form.elements.namedItem(key).checked);if(!formats.length)throw new Error('Select at least one complete report format.');
 const result=await perform('report.create',{reconciliationId:valueOf(form,'reconciliationId'),formats,...formArgs(form,['name','projectId','userIdentifier'])});
 await finish(result,'Programme report');await openReport(result.reportId);
});
function receivingResult(result,label){
 const target=$('#receiving-detail');target.hidden=false;target.replaceChildren(node('h2',{text:label}),jsonView(result));
 target.append(button('Save complete result',()=>downloadJSON(result,'fuul-receiving-result.json')));
}
onForm('#export-form',async form=>{
 const result=await perform('workspace.export',{destination:valueOf(form,'destination')});await finish(result,'Complete workspace export');receivingResult(result,'Complete workspace package');
});
onForm('#report-export-form',async form=>{
 const result=await perform('report.export',{reportId:valueOf(form,'reportId'),destination:valueOf(form,'destination'),includeApplication:form.elements.namedItem('includeApplication').checked});
 await finish(result,'Complete report export');receivingResult(result,'Original report package');
});
onForm('#archive-form',async form=>{
 const file=form.elements.namedItem('file').files[0];if(!file)throw new Error('Select a complete original package archive.');
 const result=await archiveUpload(file,optional(valueOf(form,'manifestSha256')));await finish(result,'Complete original archive');
 for(const target of ['#inspect-form','#receive-form']){setValue($(target),'sourceDirectory',result.sourceDirectory);setValue($(target),'expectedManifestSha256',result.manifestSha256);}
 receivingResult(result,'Archive ready to receive');
});
onForm('#inspect-form',async form=>{
 const result=await read('package.inspect',formArgs(form,['sourceDirectory','expectedManifestSha256']));receivingResult(result,'Original package inspection');showResult(result,'Package inspection');
});
onForm('#receive-form',async form=>{
 const result=await perform('package.receive',formArgs(form,['sourceDirectory','destination','expectedManifestSha256']));await finish(result,'Complete independent workspace');receivingResult(result,'Received workspace and application');
});
function refreshMethod(){
 const selected=model.methods.find(row=>row.method===$('#method-select').value);
 $('#method-description').textContent=selected?selected.description+(selected.required.length?' Required fields: '+selected.required.join(', ')+'.':''):'';
}
$('#method-select').addEventListener('change',refreshMethod);
onForm('#method-form',async form=>{
 const method=valueOf(form,'method'),args=jsonInput(valueOf(form,'args'),'Original method arguments');
 const result=await perform(method,args);await finish(result,method);
 if(method==='action.prepare'&&showClaimSignature(args,result))return;
 showDialog(method,result);
});
$('#refresh').addEventListener('click',event=>action(async()=>{await getState();await refreshVisible();},event.currentTarget).catch(()=>{}));
async function bootstrap(){
 const result=await responseJSON(await fetch('/api/bootstrap',{headers:headers()}));
 model.state=result.state;model.operator=result.operator;model.methods=result.methods;model.catalog=result.catalog;model.actionCatalog=result.actionCatalog;
 renderSummary();initializeTables();fillProgramme({name:'',projectId:'',network:'',contracts:[],currencies:[],mappings:[],providerSourceIds:[],rules:{}});
 $('#method-select').replaceChildren(...model.methods.map(row=>node('option',{value:row.method,text:row.method})));refreshMethod();refreshSchemas();
 const programmes=Object.values(model.state.programmes);if(programmes.length===1)await activeProgramme(programmes[0].id);
 await renderJournal();await refreshVisible();$('#connection-status').textContent='Connected';message('');
}
let refreshTimer,polling=false;
function startPolling(){
 clearInterval(refreshTimer);
 refreshTimer=setInterval(async()=>{
  if(document.hidden||polling||model.busy)return;polling=true;
  try{await getState();await refreshVisible();}catch(error){$('#connection-status').textContent='Connection interrupted';failure(error);}finally{polling=false;}
 },5000);
}
bootstrap().then(startPolling).catch(error=>{$('#connection-status').textContent='Unable to open workspace';failure(error);});
addEventListener('pagehide',event=>{
 clearInterval(refreshTimer);closeDatabase();
 if(!event.persisted&&model.reportUrl){URL.revokeObjectURL(model.reportUrl);model.reportUrl=null;}
});
addEventListener('pageshow',event=>{
 if(!event.persisted)return;
 token=sessionStorage.getItem('fuul-operator-token')??token;
 action(async()=>{await getState();await renderJournal();await refreshVisible();startPolling();}).catch(()=>{});
});
