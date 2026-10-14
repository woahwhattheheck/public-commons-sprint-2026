/** Original Eco editions with explicit selections for independent LDA receiving. */
const CHUNK=262144,HEX=/^[a-f0-9]{64}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value/1048576)+' MiB';
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
const identifier=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export function mountEcoHandovers(host,{request,scope='',initialState=null,onState=()=>{},digestBytes=digest}={}){
 let closed=false,busy=false,epoch=0,choices=null,complete=null,storageError='';
 const urls=new Set(),cleanup=[];
 const key=scope?'eco-measurements-lda-handover-v1:'+scope:null;
 const empty=()=>({schema:'eco-measurements-handover-browser-v1',title:'',collections:[],results:[],pending:null,history:[]});
 function validate(value){
  if(!value||value.schema!=='eco-measurements-handover-browser-v1'||typeof value.title!=='string'||value.title.length>200||!Array.isArray(value.collections)||!Array.isArray(value.results)||!Array.isArray(value.history))throw Error('Retained handover selection has an unreadable shape.');
  for(const row of value.collections)if(!HEX.test(row.id)||!Array.isArray(row.editions)||row.editions.some(id=>!HEX.test(id)))throw Error('Retained collection selection is invalid.');
  if(value.results.some(id=>typeof id!=='string')||value.history.some(id=>!HEX.test(id)))throw Error('Retained handover identifiers are invalid.');
  if(value.pending)validateRequest(value.pending);
  return clone(value);
 }
 function validateRequest(value){
  if(!value||!HEX.test(value.id)||typeof value.title!=='string'||!value.title.trim()||value.title.length>200||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||!Array.isArray(value.collections)||!Array.isArray(value.results))throw Error('Retained request is invalid.');
  for(const row of value.collections)if(!row||!HEX.test(row.id)||!Array.isArray(row.editions)||row.editions.some(id=>!HEX.test(id)))throw Error('Retained request collection selection is invalid.');
  if(value.results.some(id=>typeof id!=='string'||!id))throw Error('Retained request result selection is invalid.');return clone(value);
 }
 let state=empty();
 try{state=initialState?validate(initialState):key&&localStorage.getItem(key)?validate(JSON.parse(localStorage.getItem(key))):empty();}catch(error){storageError=error.message+' The original saved requests remain on the server; enter an identifier to recover one.';}
 host.innerHTML='<section class="mlf eco-handover"><h3>Scientific project handover</h3><p>Save a complete editable Eco project for independent receiving in LDA. Select the collections, collection editions and saved scientific results to present in its source inventory. The archive retains the entire original project and every native population file.</p><label>Handover title<input data-title maxlength="200"></label><div class="actions"><button data-choices>Refresh available sources</button><button data-all>Select all shown</button><button data-none>Clear selection</button></div><p data-revision></p><div data-collections class="scroll"></div><div data-results class="scroll"></div><div class="actions"><button data-save>Save complete handover</button><button data-reopen>Reopen retained request</button><button data-retry>Continue the same request</button><button data-new>New handover selection</button><button data-pause>Pause download</button></div><label>Retained handover identifier<input data-id spellcheck="false" maxlength="64"></label><div data-history></div><p role="status" aria-live="polite"></p><progress data-progress value="0" max="1"></progress><div data-complete></div><button data-request>Download retained request</button></section>';
 const q=selector=>host.querySelector(selector),status=q('[role=status]'),progress=q('[data-progress]');
 const check=token=>{if(closed||token!==epoch)throw Error('This handover view was paused or closed. Reopen its retained identifier to continue.');};
 function publish(blob,name){const url=URL.createObjectURL(blob);urls.add(url);const a=document.createElement('a');a.href=url;a.download=name;a.click();}
 function remember(){
  onState(clone(state));
  if(key)try{localStorage.setItem(key,JSON.stringify(state));storageError='';}catch{storageError='Browser storage is unavailable. Download the retained request to preserve its identifier across a browser restart.';}
  if(storageError)status.textContent=storageError;
 }
 function controls(){
  if(closed)return;
  for(const element of host.querySelectorAll('input,button'))element.disabled=busy;
  q('[data-pause]').disabled=!busy;
  q('[data-save]').disabled=busy||!choices||!!state.pending;
  q('[data-retry]').disabled=busy||!state.pending||complete?.id===state.pending.id;
  q('[data-request]').disabled=busy||!state.pending;
  q('[data-all]').disabled=busy||!choices||!!state.pending;
  q('[data-none]').disabled=busy||!choices||!!state.pending;
  q('[data-title]').disabled=busy||!!state.pending;
  for(const element of host.querySelectorAll('[data-collection],[data-edition],[data-result]'))element.disabled=busy||!!state.pending||element.dataset.incomplete==='true';
 }
 async function call(path,method='GET',body){
  const response=await request('/large/handovers'+path,method,body),text=await response.text();
  let value;try{value=JSON.parse(text);}catch{throw Error('The native handover service returned an unreadable response. Reopen the retained request.');}
  if(!response.ok){const error=Error(value.error||'Handover HTTP '+response.status);error.status=response.status;throw error;}return value;
 }
 async function run(operation){if(busy||closed)return;busy=true;const token=++epoch;controls();try{await operation(token);}catch(error){if(!closed)status.textContent=error.message;}finally{busy=false;if(!closed)controls();}}
 function selectedCollection(id){return state.collections.find(row=>row.id===id);}
 function paint(){
  if(closed)return;q('[data-title]').value=state.title;
  if(state.pending)q('[data-id]').value=state.pending.id;
  q('[data-revision]').textContent=choices?'Available sources at native revision '+choices.workspaceRevision+'. Refresh before making a new selection after source changes.':'Read available original sources to make a selection.';
  q('[data-collections]').innerHTML=choices?'<h4>Collections and saved editions</h4>'+choices.collections.map(c=>'<fieldset><legend><label><input type="checkbox" data-collection="'+esc(c.id)+'" data-incomplete="'+String(c.complete===false)+'" '+(selectedCollection(c.id)?'checked':'')+'> '+esc(c.title||c.id)+(c.complete===false?' (receiving incomplete)':'')+'</label></legend><code>'+esc(c.id)+'</code>'+c.editions.map(e=>'<label style="display:block"><input type="checkbox" data-edition="'+esc(e.id)+'" data-parent="'+esc(c.id)+'" data-incomplete="'+String(c.complete===false||e.complete===false)+'" '+(selectedCollection(c.id)?.editions.includes(e.id)?'checked':'')+'> '+esc(e.title||e.label||e.id)+(e.kind==='native-saved-population'?' · native saved population':'')+(e.complete===false?' · '+esc(e.reason||'edition incomplete'):'')+(e.createdAt?' · '+esc(e.createdAt):'')+'</label>').join('')+'</fieldset>').join(''):'';
  q('[data-results]').innerHTML=choices?'<h4>Saved scientific results</h4>'+choices.results.map(r=>'<label style="display:block"><input type="checkbox" data-result="'+esc(r.id)+'" '+(state.results.includes(r.id)?'checked':'')+'> '+esc(r.kind)+' · '+esc(r.id)+' · revision '+esc(r.workspaceRevision)+' · '+size(r.bytes)+'</label>').join(''):'';
  q('[data-history]').innerHTML=state.history.length?'<p>Earlier retained handovers</p>'+state.history.map(id=>'<button data-history-id="'+id+'">'+id.slice(0,16)+'…</button>').join(''):'';
  q('[data-complete]').innerHTML=complete?'<h4>Complete native handover</h4><p>'+esc(complete.title)+' · '+size(complete.source.bytes)+'</p><p><code>'+esc(complete.id)+'</code></p><p>Original archive SHA-256 <code>'+esc(complete.source.sha256)+'</code></p><button data-download>Download complete project ZIP</button>':'';
  for(const input of host.querySelectorAll('[data-collection]'))input.onchange=()=>{const id=input.dataset.collection;if(input.checked&&!selectedCollection(id))state.collections.push({id,editions:[]});else if(!input.checked)state.collections=state.collections.filter(row=>row.id!==id);remember();paint();};
  for(const input of host.querySelectorAll('[data-edition]'))input.onchange=()=>{const id=input.dataset.parent;let row=selectedCollection(id);if(!row){row={id,editions:[]};state.collections.push(row);}row.editions=input.checked?[...new Set([...row.editions,input.dataset.edition])]:row.editions.filter(e=>e!==input.dataset.edition);remember();paint();};
  for(const input of host.querySelectorAll('[data-result]'))input.onchange=()=>{state.results=input.checked?[...new Set([...state.results,input.dataset.result])]:state.results.filter(id=>id!==input.dataset.result);remember();};
  for(const button of host.querySelectorAll('[data-history-id]'))button.onclick=()=>run(token=>reopen(token,button.dataset.historyId));
  const button=q('[data-download]');if(button)button.onclick=()=>run(download);controls();
 }
 function exactSelection(){
  if(!choices)throw Error('Read the available original sources first.');
  const collections=state.collections.map(row=>{const found=choices.collections.find(c=>c.id===row.id);if(!found||found.complete===false||row.editions.some(id=>!found.editions.some(e=>e.id===id&&e.complete!==false)))throw Error('A selected collection or edition is absent from this source inventory. Refresh and review the selection.');return clone(row);});
  if(state.results.some(id=>!choices.results.some(r=>r.id===id)))throw Error('A selected scientific result is absent from this source inventory. Refresh and review the selection.');
  const title=state.title.trim();if(!title)throw Error('Enter a title for this scientific project handover.');
  return {id:identifier(),title,expectedRevision:choices.workspaceRevision,collections,results:[...state.results]};
 }
 async function readChoices(token){const value=await call('/choices');check(token);if(!Array.isArray(value.collections)||!Array.isArray(value.results))throw Error('The native source inventory is unreadable.');choices=value;paint();status.textContent='Complete original source inventory read at revision '+value.workspaceRevision+'.';}
 function accept(value){
  if(!HEX.test(value.id))throw Error('The returned handover identifier is invalid.');
  if(value.phase==='complete'){
   const source=value.source;if(!source||!Number.isSafeInteger(source.bytes)||source.bytes<=0||!HEX.test(source.sha256)||!Array.isArray(source.chunks)||source.chunks.length!==Math.ceil(source.bytes/CHUNK)||source.chunks.some(hash=>!HEX.test(hash))||value.chunkBytes!==CHUNK)throw Error('The complete native archive descriptor is unreadable.');
   complete=value;state.history=[value.id,...state.history.filter(id=>id!==value.id)].slice(0,32);remember();status.textContent='Complete native handover is saved. Download its entire project archive below.';
  }else{const request=validateRequest(value.request);if(request.id!==value.id)throw Error('The original retained request identifies a different handover.');if(state.pending&&state.pending.id!==request.id)throw Error('Another original request is retained in this browser. Download that request, then choose New handover selection before reopening '+value.id+'.');state.pending=request;state.title=request.title;state.collections=clone(request.collections);state.results=[...request.results];complete=null;remember();status.textContent='Retained handover '+value.id+' is '+value.phase+'. Continue the same request to complete it.';}
  q('[data-id]').value=value.id;paint();q('[data-id]').value=value.id;
 }
 async function reopen(token,id=q('[data-id]').value.trim()){
  if(!HEX.test(id))throw Error('Enter the full retained handover identifier.');
  const value=await call('/'+id);check(token);if(value.id!==id)throw Error('The native service returned a different handover.');accept(value);
 }
 async function submit(token){
  if(!state.pending){state.pending=exactSelection();remember();q('[data-id]').value=state.pending.id;}
  const original=clone(state.pending);status.textContent='Saving the complete original project. Retained request '+original.id;
  const value=await call('','POST',original);check(token);if(value.id!==original.id)throw Error('The native service returned a different handover.');accept(value);
 }
 async function download(token){
  const original=complete;if(!original)throw Error('Reopen a complete handover first.');
  let directory,handle,writable;const parts=[],temporary='eco-handover-'+original.id;let received=0;
  try{
   if(navigator.storage?.getDirectory)try{directory=await navigator.storage.getDirectory();handle=await directory.getFileHandle(temporary,{create:true});writable=await handle.createWritable();}catch{if(directory)await directory.removeEntry(temporary).catch(()=>{});directory=null;handle=null;writable=null;}
   for(let index=0;index<original.source.chunks.length;index++){
    check(token);const chunk=await call('/'+original.id+'/chunks/'+index);check(token);
    const data=Uint8Array.from(atob(chunk.base64),c=>c.charCodeAt(0)),expected=Math.min(CHUNK,original.source.bytes-received),sha256=await digestBytes(data);check(token);
    if(chunk.id!==original.id||chunk.index!==index||chunk.bytes!==data.length||data.length!==expected||chunk.sha256!==original.source.chunks[index]||sha256!==original.source.chunks[index])throw Error('An original archive chunk differs from the saved handover descriptor.');
    if(writable)await writable.write(data);else parts.push(data);received+=data.length;check(token);progress.value=received/original.source.bytes;status.textContent='Receiving complete original project: '+size(received)+' / '+size(original.source.bytes)+(writable?'':' (browser memory storage)');
   }
   if(writable){await writable.close();writable=null;}check(token);
   const blob=handle?await handle.getFile():new Blob(parts,{type:'application/zip'});check(token);if(blob.size!==original.source.bytes||received!==original.source.bytes)throw Error('The complete project archive length differs.');
   publish(blob,original.filename||'eco-measurements-'+original.id.slice(0,12)+'.zip');
   if(directory)cleanup.push(()=>directory.removeEntry(temporary).catch(()=>{}));
   status.textContent='Complete original project downloaded. All '+original.source.chunks.length+' archive chunks match the saved descriptor. Receive this ZIP in LDA’s Scientific Projects workspace.';
  }catch(error){if(writable)await writable.abort().catch(()=>{});if(directory)await directory.removeEntry(temporary).catch(()=>{});throw error;}
 }
 q('[data-title]').oninput=e=>{state.title=e.target.value;remember();};
 q('[data-choices]').onclick=()=>run(readChoices);
 q('[data-all]').onclick=()=>{state.collections=choices.collections.filter(c=>c.complete!==false).map(c=>({id:c.id,editions:c.editions.filter(e=>e.complete!==false).map(e=>e.id)}));state.results=choices.results.map(r=>r.id);remember();paint();};
 q('[data-none]').onclick=()=>{state.collections=[];state.results=[];remember();paint();};
 q('[data-save]').onclick=()=>run(submit);q('[data-retry]').onclick=()=>run(submit);q('[data-reopen]').onclick=()=>run(reopen);
 q('[data-new]').onclick=()=>{if(state.pending&&!confirm('Keep the original request on the server and start another handover selection?'))return;state.pending=null;complete=null;q('[data-id]').value='';remember();paint();};
 q('[data-pause]').onclick=()=>{epoch++;status.textContent='Pause requested. The original server handover remains saved.';};
 q('[data-request]').onclick=()=>publish(new Blob([JSON.stringify({schema:'eco-measurements-handover-request-v1',workspace:scope,request:state.pending},null,2)+'\n'],{type:'application/json'}),'Eco_Handover_Request_'+state.pending.id+'.json');
 paint();if(storageError)status.textContent=storageError;else status.textContent=state.pending?'A previous immutable request is retained. Reopen it to inspect the original result.':'Read available sources, select their editions and save the full project.';
 return {refresh:()=>run(readChoices),snapshot:()=>clone(state),hasUnsaved:()=>!!storageError&&!!state.pending,hasPending:()=>!!state.pending&&complete?.id!==state.pending.id,destroy(){closed=true;epoch++;for(const url of urls)URL.revokeObjectURL(url);for(const remove of cleanup)remove();host.replaceChildren();}};
}
