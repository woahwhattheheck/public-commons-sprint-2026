/** Complete collection operating surface over the original authenticated API. */
import {freshCollectionWorking,validateCollectionWorking,addCollectionSources,editCollectionWorking,mappingFor,definitionKey,validateCollectionDefinition,retainCollectionRequest,acceptCollectionResponse,saveCollectionInspection,reviewedCollectionRequest,preserveUnresolvedCollectionRequest,exportCollectionWorking,captureCollectionSession,restoreCollectionSession} from './collection_working.mjs';
import {collectionRandomId,collectionSHA256,uploadCollectionOriginal,downloadCollectionMember} from './collection_transfer.mjs';
import {receiveCollectionEditionFolder,reopenCollectionEditionFolder} from './collection_folder.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value)),stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const CSS=".measured-collections{margin:18px;padding:18px;border:1px solid #bfc4c9;background:#f6f7f8;color:#20242a;font:14px/1.5 system-ui,sans-serif;max-width:100%;box-sizing:border-box}\n.measured-collections *{box-sizing:border-box}.measured-collections h2,.measured-collections h3,.measured-collections summary,.measured-collections label,.measured-collections p,.measured-collections th,.measured-collections td,.measured-collections small{color:#20242a}\n.measured-collections h2{font-size:21px;margin:0 0 10px}.measured-collections h3{font-size:16px;margin:18px 0 8px}.measured-collections details{border-top:1px solid #ccd1d6;margin-top:14px;padding-top:12px}.measured-collections summary{cursor:pointer;font-weight:600}\n.measured-collections button,.measured-collections input,.measured-collections select,.measured-collections textarea{font:inherit;color:#20242a;background:#fff;border:1px solid #8b939c;border-radius:3px;padding:8px;max-width:100%}\n.measured-collections button{background:#edf0f2;cursor:pointer;min-height:36px}.measured-collections button:disabled{color:#6e7781;background:#e2e5e8;cursor:default}.measured-collections button:focus-visible,.measured-collections input:focus-visible,.measured-collections textarea:focus-visible,.measured-collections select:focus-visible{outline:2px solid #20242a;outline-offset:2px}\n.measured-collections label{display:grid;gap:5px}.measured-collections textarea{width:100%;min-height:80px;resize:vertical}.measured-collections .mc-wide{width:100%}.measured-collections .mc-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.measured-collections .mc-scroll{max-width:100%;overflow:auto}.measured-collections table{border-collapse:collapse;min-width:820px;width:100%;background:#fff}\n.measured-collections th,.measured-collections td{border:1px solid #ccd1d6;padding:8px;vertical-align:top;text-align:left}.measured-collections th{background:#e8ebee}.measured-collections td input,.measured-collections td select{width:100%;min-width:140px}.measured-collections td textarea{min-width:240px}.measured-collections code,.measured-collections pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}\n.measured-collections pre{max-height:26em;overflow:auto;background:#fff;border:1px solid #ccd1d6;padding:10px;color:#20242a}.measured-collections a{color:#25384a;text-decoration:underline}.measured-collections .mc-note{padding:10px;background:#e8ebee;border-left:3px solid #5b626a}.measured-collections [role=alert]{background:#f0eded;border-left:3px solid #4b3838;padding:10px;color:#302424}.measured-collections [role=status]{min-height:24px}.measured-collections article{padding:12px 0;border-top:1px solid #ccd1d6}.measured-collections progress{width:100%;height:14px}.measured-collections [hidden]{display:none!important}\n@media(max-width:600px){.measured-collections{margin:8px;padding:12px;font-size:13px}.measured-collections .mc-actions>button{flex:1 1 150px}.measured-collections h2{font-size:19px}.measured-collections .mc-actions>label{flex:1 1 100%}}\n@media print{.measured-collections{margin:0;border:0;background:#fff}.measured-collections button,.measured-collections input[type=file],.measured-collections progress{display:none}.measured-collections .mc-scroll,.measured-collections pre{overflow:visible;max-height:none}.measured-collections table{min-width:0;font-size:10px}.measured-collections th,.measured-collections td{overflow-wrap:anywhere}}\n";
export function mountCollectionPanel(host,{request,refresh,workspaceKey,initialSession=null}){
 if(typeof workspaceKey!=='string'||!workspaceKey)throw new Error('The collection panel requires its original workspace and account identity.');
 const lifecycle=new AbortController(),fileHandles=new Map(),editionBindings=new Map(),downloads=new Set(),storageKey='measurement-collection-working/v1:'+workspaceKey;
 let state=freshCollectionWorking(workspaceKey),knownRevision=null,storageBlocked=false,storageMessage='',downloadedPendingId=null;
 let dead=false,busy=false,generation=0,openSequence=0,dirty=false;
 const signal=lifecycle.signal;
 host.classList.add('measured-collections');
 host.innerHTML='<style>'+CSS+'</style><h2>Observation collections and complete study editions</h2><p>Keep chemistry, monitoring stations, discharge and accompanying originals together. Chemistry and station CSVs travel in checked 256 KiB chunks; their actual mappings and source summaries come from the installed measurement engine.</p>'+
 '<details open><summary>Collection working copy</summary><div class="mc-actions"><button type="button" data-action="save">Download complete working file</button><label>Open working file<input type="file" data-open accept=".json,application/json"></label><button type="button" data-action="new">New collection</button></div>'+
 '<p class="mc-note">A working file retains unfinished fields, small originals, the exact pending request and native intake identities. Large originals stay in the current native workspace. Resume here, or export the complete study edition to receive it in another workspace.</p>'+
 '<label>Collection title<input class="mc-wide" data-title maxlength="4096"></label><div class="mc-actions"><label>Add original files<input type="file" multiple data-add></label><button type="button" data-action="inspect">Upload and inspect complete collection</button><button type="button" data-action="receive">Receive reviewed collection</button></div>'+
 '<div class="mc-scroll" data-rows></div><progress data-progress value="0" max="1" hidden></progress><p data-progress-text></p>'+
 '<div data-pending class="mc-note" hidden></div><div class="mc-actions"><button type="button" data-action="resume">Resume exact saved request</button><button type="button" data-action="revise">Retain unresolved request and open fresh review</button><button type="button" data-action="pause">Pause this browser operation</button></div>'+
 '<div data-status role="status" aria-live="polite"></div><div data-persistence role="alert" hidden></div>'+
 '<h3>Complete source inspection</h3><div class="mc-scroll" data-inspection></div><details><summary>Original mappings, source summaries and operation history</summary><pre data-details></pre></details></details>'+
 '<details open><summary>Saved collections and complete study editions</summary><div class="mc-actions"><button type="button" data-action="refresh">Refresh saved collections</button><button type="button" data-action="verify-folder">Verify received edition folder</button></div><div data-list></div><div data-native-status></div><div data-edition></div></details>';
 const el=selector=>host.querySelector(selector);
 function notice(message,error=false){if(dead)return;const node=el('[data-status]');node.textContent=message;node.setAttribute('role',error?'alert':'status');}
 function persistence(){if(dead)return;const node=el('[data-persistence]');node.hidden=!storageMessage;node.textContent=storageMessage;}
 function readEnvelope(){const raw=localStorage.getItem(storageKey);if(!raw)return null;const value=JSON.parse(raw);if(typeof value.revision!=='string'||!value.state)throw new Error('The saved collection working copy is unreadable.');return value;}
 function saveLocal(){
  dirty=true;
  try{
   if(storageBlocked)throw new Error('Another saved copy has changed, or browser persistence is unavailable.');
   const current=readEnvelope();if((current?.revision||null)!==knownRevision){storageBlocked=true;throw new Error('Another browser tab saved a different collection working copy.');}
   const next=collectionRandomId(),body=exportCollectionWorking(state);
   localStorage.setItem(storageKey,JSON.stringify({revision:next,state:JSON.parse(body)}));knownRevision=next;dirty=false;storageMessage='';persistence();return true;
  }catch(error){storageMessage=error.message+' Your complete work remains in this tab. Download it before leaving. For a changed saved copy, download both tabs, reload the current saved copy, then explicitly open the chosen complete working file.';persistence();return false;}
 }
 function download(name,blob,cleanup=async()=>{}){
  const url=URL.createObjectURL(blob),a=document.createElement('a'),entry={url,cleanup};downloads.add(entry);a.href=url;a.download=name;a.click();
  // Keep the object URL and any disk-backed temporary original alive for the
  // browser download; disposal happens on panel destruction.
 }
 function saveWorking(suffix='working'){
  const body=exportCollectionWorking(state);download('collection-'+suffix+'.json',new Blob([body],{type:'application/json'}));
  if(state.pending)downloadedPendingId=state.pending.id;
  notice('The complete collection working file is ready to save. It includes the current original request and every retained field.');
 }
 function guards(token,selected=state){return ()=>{if(dead||token!==generation||state!==selected)throw new Error('Browser operation paused. Its exact pending native request remains available for recovery.');};}
 async function api(path,method='GET',payload){
  const response=await request(path,method,payload),body=await response.text();
  if(!response.ok){const error=new Error(body||'Collection request failed.');error.status=response.status;throw error;}
  try{return JSON.parse(body);}catch{throw new Error('The collection operation returned an unreadable complete response.');}
 }
 function controls(){
  if(dead)return;
  host.setAttribute('aria-busy',String(busy));
  for(const node of host.querySelectorAll('input,select,textarea'))node.disabled=busy||!!state.pending;
  el('[data-open]').disabled=busy;
  for(const node of host.querySelectorAll('button'))node.disabled=busy||node.dataset.nativeEligible==='0';
  el('[data-action="save"]').disabled=false;
  el('[data-action="pause"]').disabled=!busy;
  el('[data-action="resume"]').disabled=busy||!state.pending;
  el('[data-action="revise"]').disabled=busy||!state.pending;
  el('[data-action="inspect"]').disabled=busy||!!state.pending||!state.rows.length;
  el('[data-action="receive"]').disabled=busy||!!state.pending||!state.inspected||state.inspected.definition!==definitionKey(state);
  el('[data-action="new"]').disabled=busy;
  const pending=el('[data-pending]');pending.hidden=!state.pending;
  pending.textContent=state.pending?'Saved '+state.pending.kind+' request '+state.pending.id+'. Its full '+state.pending.method+' '+state.pending.path+' body will be retried unchanged. Download the working file to retain it outside this browser.':'';
 }
 function renderRows(){
  el('[data-title]').value=state.title;
  el('[data-rows]').innerHTML=state.rows.length?'<table><thead><tr><th>Original and retained state</th><th>Member and label</th><th>Interpretation</th><th>Column mapping JSON</th><th>Source controls</th></tr></thead><tbody>'+state.rows.map(r=>'<tr data-key="'+r.key+'"><td><strong>'+esc(r.source.name)+'</strong><br>'+r.source.bytes+' bytes<br><small>'+esc(r.retained?.phase||(r.prepared?'Prepared':'Original selection required'))+'</small><br><code>'+esc(r.intakeId)+'</code>'+(r.error?'<p>'+esc(r.error)+'</p>':'')+'</td><td><label>Member path<input data-field="path" maxlength="1024" value="'+esc(r.path)+'"></label><label>Source label<input data-field="label" maxlength="4096" value="'+esc(r.label)+'"></label></td><td><select data-field="kind" aria-label="Interpretation '+esc(r.source.name)+'">'+[['companion','Retained companion'],['wqp','Chemistry / WQP'],['stations','Monitoring stations'],['usgs-daily','Daily discharge']].map(([v,t])=>'<option value="'+v+'"'+(r.kind===v?' selected':'')+'>'+t+'</option>').join('')+'</select></td><td><textarea data-field="mappingText" maxlength="1048576" aria-label="Mapping '+esc(r.source.name)+'">'+esc(r.mappingText)+'</textarea></td><td><label>Reselect exact original<input type="file" data-reselect="'+r.key+'"></label><button type="button" data-fork="'+r.key+'">New source interpretation</button><button type="button" data-remove="'+r.key+'">Remove from working set</button></td></tr>').join('')+'</tbody></table>':'<p>No originals selected.</p>';
  renderInspection();controls();
 }
 function renderInspection(){
  const p=state.inspected?.response,entries=p?.inspection||[];
  el('[data-inspection]').innerHTML=p?'<p>Collection <code>'+esc(p.id)+'</code> reviewed at workspace revision '+esc(p.workspaceRevision)+'.</p><table><thead><tr><th>Original member</th><th>Interpretation</th><th>Complete accepted rows</th><th>Rejected rows</th><th>Original bytes</th></tr></thead><tbody>'+entries.map(f=>{const v=f.preview?.summary||f.preview;return '<tr><td>'+esc(f.path)+'</td><td>'+esc(f.kind)+'</td><td>'+esc(v?.rows??'Retained original')+'</td><td>'+esc(v?.rejectedCount??'—')+'</td><td>'+esc(f.bytes??'—')+'</td></tr>';}).join('')+'</tbody></table>':'<p>Upload and inspect the complete current selection to review actual source mappings and row summaries.</p>';
  el('[data-details]').textContent=JSON.stringify({inspection:p||null,history:state.history,pending:state.pending?{...state.pending,payload:{...state.pending.payload,...(state.pending.payload.base64?{base64:'Complete pending chunk retained in working file'}:{}),...(Array.isArray(state.pending.payload.files)?{files:state.pending.payload.files.map(f=>({...f,...('base64' in f?{base64:'Complete original retained in working file'}:{}),...('text' in f?{text:'Complete original retained in working file'}:{})}))}:{})}}:null},null,2);
 }
 async function run(fn){
  if(busy||dead)return;busy=true;const token=++generation,check=guards(token);controls();
  try{await fn(check);check();}catch(error){if(!dead)notice(error.message,true);}
  finally{busy=false;if(!dead){renderRows();persistence();}}
 }
 function applyResponse(p,response){
  if(p.rowKey){const row=state.rows.find(r=>r.key===p.rowKey);if(!row)throw new Error('Original source row is unavailable.');
   row.error=null;if(p.path.endsWith('/prepare')){row.prepared=clone(response);row.retained={...(row.retained||{}),phase:row.retained?.phase==='committed'?'committed':'prepared',offset:response.bytes};}else row.retained={...(row.retained||{}),...clone(response)};
  }
  acceptCollectionResponse(state,p.id,response,new Date().toISOString());
  if(p.path==='/large/collections/preview')saveCollectionInspection(state,p.payload,response);
  if(p.path==='/large/collections/receive')state.lastCollectionId=response.id;
  saveLocal();renderInspection();controls();
 }
 async function dispatchPending(check){
  const p=state.pending;if(!p)throw new Error('No original request is pending.');
  validateCollectionWorking(state,workspaceKey);
  if(!saveLocal()&&downloadedPendingId!==p.id)throw new Error('The complete original request is retained in this tab. Download the working file, then resume that same saved request.');
  check();const result=await api(p.path,p.method,p.payload);check();applyResponse(p,result);return result;
 }
 async function write(path,method,payload,extra,check){
  retainCollectionRequest(state,{id:collectionRandomId(),path,method,payload,...extra,at:new Date().toISOString()});controls();
  return dispatchPending(check);
 }
 function progress(info){
  if(dead)return;el('[data-progress]').hidden=false;el('[data-progress]').max=info.total||1;el('[data-progress]').value=info.bytes;
  el('[data-progress-text]').textContent=(info.name||state.rows.find(r=>r.key===info.rowKey)?.path||'Original')+': '+info.bytes+' / '+info.total+' bytes'+(info.checkedPrefix?' original prefix checked':'');
 }
 async function preparedMember(row,check){
  const mapping=mappingFor(row),definition={kind:row.kind,label:row.label,mapping,origin:{type:'collection-file'}};
  const file=fileHandles.get(row.key);let retained;
  if(file)retained=await uploadCollectionOriginal({row,file,definition,read:p=>api(p),write:(p,m,v,x)=>write(p,m,v,x,check),check,progress});
  else{try{retained=await api('/large/intakes/'+row.intakeId);}catch(error){if(error.status===404)throw new Error('Reselect '+row.source.name+' to resume its complete original upload.');throw error;}check();}
  if(retained.id!==row.intakeId||retained.kind!==row.kind||retained.bytes!==row.source.bytes||retained.offset!==retained.bytes)throw new Error('The complete original is not retained yet. Reselect '+row.source.name+' and inspect again.');
  // Actual prepared mappings can differ from the initial automatic-map object.
  // Keep the retained request metadata exact unless the operator changed it.
  if(retained.label!==row.label||stable(retained.mapping)!==stable(mapping)){
   retained=await write('/large/intakes/'+row.intakeId,'PUT',{label:row.label,mapping},{kind:'prepare',rowKey:row.key},check);
  }
  const prepared=await write('/large/intakes/'+row.intakeId+'/prepare','POST',{}, {kind:'prepare',rowKey:row.key},check);check();
  if(!hex(prepared.sourceSha256)||prepared.bytes!==row.source.bytes||!prepared.mapping)throw new Error('The installed source preparation returned an incomplete original identity.');
  row.retained={...clone(retained),phase:retained.phase==='committed'?'committed':'prepared',offset:prepared.bytes};row.prepared=clone(prepared);saveLocal();
  return {path:row.path,kind:row.kind,intakeId:row.intakeId,sha256:prepared.sourceSha256,label:retained.label,mapping:clone(prepared.mapping),origin:clone(retained.origin)};
 }
 async function inlineMember(row,check){
  if(!row.inline){
   const file=fileHandles.get(row.key);if(!file)throw new Error('Reselect the complete companion or discharge original '+row.source.name+'.');
   const buffer=await file.arrayBuffer();check();if(buffer.byteLength!==row.source.bytes)throw new Error('The selected inline original changed size.');
   const bytes=new Uint8Array(buffer),sha256=await collectionSHA256(bytes);check();row.inline={base64:base64(bytes),sha256};state.revision++;saveLocal();
  }
  return {path:row.path,label:row.label,kind:row.kind,mapping:mappingFor(row),sha256:row.inline.sha256,base64:row.inline.base64};
 }
 async function inspect(check){
  validateCollectionDefinition(state);
  const inlineBytes=state.rows.filter(r=>!['wqp','stations'].includes(r.kind)).reduce((n,r)=>n+r.source.bytes,0);
  // A full request plus saved inspection and working originals must fit the
  // portable working-file budget; large CSV originals use the streaming path.
  if(inlineBytes>24*1024*1024)throw new Error('The combined companion and daily-discharge originals exceed this browser working file’s 24 MiB inline budget. Keep them in the original installed collection-file workflow; chemistry and station CSVs use streamed receiving without this inline limit.');
  notice('Retaining and preparing each complete original…');const files=[];
  for(const row of state.rows){check();try{files.push(['wqp','stations'].includes(row.kind)?await preparedMember(row,check):await inlineMember(row,check));}catch(error){row.error=error.message;saveLocal();throw error;}}
  const manifest={format:'upper-savannah-measurement-collection/v1',title:state.title,files};
  const result=await write('/large/collections/preview','POST',manifest,{kind:'prepare'},check);
  notice('Complete source inspection is ready. Review original mappings and row summaries before receiving this exact collection.');return result;
 }
 async function list(check=()=>{}){
  const value=await api('/collections');check();if(dead)return;
  el('[data-list]').innerHTML=value.collections?.length?value.collections.map(c=>'<article><h3>'+esc(c.title)+'</h3><p>'+esc(c.fileCount)+' original files · '+(c.complete?'complete originals received':'collection receiving has retained partial progress')+'</p><code>'+esc(c.id)+'</code><div class="mc-actions"><button type="button" data-collection="'+c.id+'">Open current receiving and study editions</button>'+((c.editions||[]).map(id=>'<button type="button" data-old-edition="'+esc(id)+'" data-old-collection="'+c.id+'">Earlier edition '+esc(id.slice(0,12))+'</button>').join(''))+'</div></article>').join(''):'<p>No native collection has been retained in this workspace.</p>';
 }
 async function openCollection(id,check){
  if(!hex(id))throw new Error('Invalid collection identity.');
  const current=await api('/large/collections/'+id);check();const list=await api('/large/collections/'+id+'/editions');check();for(const row of list.editions||[])editionBindings.set(row.binding.editionId,clone(row.binding));
  el('[data-native-status]').innerHTML='<h3>'+esc(current.title||id)+'</h3><p>Workspace revision '+esc(current.workspaceRevision)+' · '+(current.complete?'complete original collection':'partial receiving retained')+'</p><div class="mc-actions"><button type="button" data-publish="'+id+'" data-native-eligible="'+(current.complete?'1':'0')+'"'+(current.complete?'':' disabled')+'>Save complete current study edition</button></div><details><summary>Original receiving operations and retained errors</summary><pre>'+esc(JSON.stringify(current.operations||[],null,2))+'</pre></details><div class="mc-actions">'+(list.editions||[]).map(v=>'<button type="button" '+(v.edition?'data-large-edition':'data-publication')+'="'+esc(v.binding.editionId)+'">'+(v.edition?'Study edition ':'Resume publication ')+esc(v.binding.editionId.slice(0,12))+'</button>').join('')+'</div>';
 }
 async function showLargeEdition(id,check){
  if(!hex(id))throw new Error('Invalid study edition identity.');const edition=await api('/large/editions/'+id);check();
  el('[data-edition]').innerHTML='<h3>Complete editable study edition</h3><p>Edition <code>'+esc(id)+'</code> · workspace revision '+esc(edition.workspaceRevision)+'</p><p>Every original, editable project, report and complete archive is downloaded from this saved edition with its declared chunk hashes and full byte count.</p><div class="mc-actions"><button type="button" data-folder-edition="'+id+'" data-folder-collection="'+esc(edition.collectionBinding?.collectionId||'')+'">Receive complete edition to folder</button></div><p>Choose a parent folder to receive all original members. Repeating this action with the same parent resumes its checked original chunks after a browser restart. Existing complete-file downloads remain available.</p><div class="mc-scroll"><table><thead><tr><th>Complete member</th><th>Bytes</th><th>Download</th></tr></thead><tbody>'+edition.files.map(f=>'<tr><td>'+esc(f.path)+'</td><td>'+esc(f.bytes)+'</td><td><button type="button" data-member="'+esc(f.path)+'" data-download-edition="'+id+'">Download complete file</button></td></tr>').join('')+'</tbody></table></div>';
 }
 async function showOldEdition(collection,id,check){
  if(!hex(collection)||!hex(id))throw new Error('Invalid saved collection edition.');
  const edition=await api('/collections/'+collection+'/editions/'+id);check();
  el('[data-edition]').innerHTML='<h3>Earlier complete study edition</h3><p>Revision '+esc(edition.workspaceRevision)+': '+esc(edition.recordCount)+' complete records.</p><button type="button" data-old-bundle="'+id+'" data-old-collection="'+collection+'">Download complete editable study ZIP</button>';
 }
 host.addEventListener('input',event=>{
  const target=event.target;if(busy||state.pending)return;
  try{
   if(target.matches('[data-title]'))editCollectionWorking(state,s=>{s.title=target.value;});
   else if(target.dataset.field){const row=state.rows.find(r=>r.key===target.closest('[data-key]')?.dataset.key);if(!row)return;editCollectionWorking(state,()=>{row[target.dataset.field]=target.value;});}
   else return;
   saveLocal();renderInspection();controls();
  }catch(error){notice(error.message,true);}
 },{signal});
 host.addEventListener('change',event=>{
  const target=event.target;
  if(target.matches('[data-open]')){openWorking(target);return;}
  if(busy||state.pending)return;
  try{
   if(target.matches('[data-add]')){const files=Array.from(target.files),rows=addCollectionSources(state,files,collectionRandomId);rows.forEach((r,i)=>fileHandles.set(r.key,files[i]));saveLocal();renderRows();target.value='';}
   else if(target.dataset.reselect){const row=state.rows.find(r=>r.key===target.dataset.reselect),file=target.files[0];if(!row||!file)return;if(file.size!==row.source.bytes)throw new Error('Choose the original complete file of '+row.source.bytes+' bytes.');fileHandles.set(row.key,file);editCollectionWorking(state,()=>{row.inline=null;row.error=null;});saveLocal();notice('Original reselected. The retained prefix will be checked before receiving more bytes.');target.value='';}
   else if(target.dataset.field==='kind'){const row=state.rows.find(r=>r.key===target.closest('[data-key]').dataset.key);if(row){editCollectionWorking(state,()=>{row.intakeId=collectionRandomId();row.retained=null;row.prepared=null;row.error=null;});saveLocal();renderRows();}}
  }catch(error){notice(error.message,true);}
 },{signal});
 async function openWorking(input){
  const file=input.files[0];if(!file)return;const serial=++openSequence,selected=state,version=state.revision;
  try{
   if(busy)throw new Error('Pause the current browser operation before opening another working file.');
   if(!Number.isSafeInteger(file.size)||file.size<0)throw new Error('Choose a readable complete collection working file.');
   const body=await file.text();if(dead||serial!==openSequence)return;
   if(state!==selected||state.revision!==version||busy)throw new Error('Current work changed while the saved file was read. Your newer work remains; choose the file again.');
   const next=validateCollectionWorking(JSON.parse(body),workspaceKey);
   if(state.rows.length||state.pending||state.history.length)saveWorking('before-open');
   state=next;generation++;fileHandles.clear();downloadedPendingId=null;saveLocal();renderRows();notice('Opened the complete working file. Its original native requests and source identities are retained.');
  }catch(error){if(!dead&&serial===openSequence)notice(error.message,true);}
  finally{if(serial===openSequence)input.value='';}
 }
 host.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||!host.contains(target))return;
  const action=target.dataset.action;
  if(action==='save'){try{saveWorking();}catch(error){notice(error.message,true);}return;}
  if(action==='pause'){generation++;notice('Browser operation paused. Its current original request remains retained; resume it to reconcile native completion.');return;}
  if(busy)return;
  if(action==='new'){
   try{if(state.rows.length||state.pending||state.history.length)saveWorking('before-new');state=freshCollectionWorking(workspaceKey);generation++;fileHandles.clear();downloadedPendingId=null;saveLocal();renderRows();notice('New collection working copy opened. The preceding complete working file is ready to save.');}catch(error){notice(error.message,true);}return;
  }
  if(target.dataset.fork){
   try{editCollectionWorking(state,()=>{const row=state.rows.find(r=>r.key===target.dataset.fork);if(!row)throw new Error('Choose an original source row.');row.intakeId=collectionRandomId();row.retained=null;row.prepared=null;row.error=null;});saveLocal();renderRows();notice('A new source interpretation is selected. The preceding native original remains retained; reselect the same complete original if this tab no longer has it.');}catch(error){notice(error.message,true);}return;
  }
  if(target.dataset.remove){
   try{editCollectionWorking(state,s=>{s.rows=s.rows.filter(r=>r.key!==target.dataset.remove);});fileHandles.delete(target.dataset.remove);saveLocal();renderRows();}catch(error){notice(error.message,true);}return;
  }
  if(action==='verify-folder'||target.dataset.folderEdition){
   if(typeof globalThis.showDirectoryPicker!=='function'||!globalThis.navigator?.locks?.request){notice('This browser does not expose selected-folder receiving. Use Download complete file or the installed collection export.',true);return;}
   // Acquire the actual user-granted handle before any network work can consume
   // transient activation. The ordinary run lifetime guards all later effects.
   let selected;try{selected=globalThis.showDirectoryPicker({mode:action==='verify-folder'?'read':'readwrite',id:'measurement-collection-edition'});}catch(error){notice(error.message,true);return;}
   run(async check=>{
    const directory=await selected;check();
    const result=action==='verify-folder'?await reopenCollectionEditionFolder({directory,check,progress}):await receiveCollectionEditionFolder({api,id:target.dataset.folderEdition,collectionId:target.dataset.folderCollection,directory,check,progress});check();
    notice((action==='verify-folder'?'Verified all complete original members in ':'Received all complete original members in ')+result.folderName+'. Open START_HERE.md and the files/ directory. '+(result.cleanupErrors?.length?'Some checked chunk files remain for later cleanup; the complete originals and receiving result are saved.':''));
   });return;
  }
  run(async check=>{
   if(action==='inspect')await inspect(check);
   else if(action==='resume'){const p=clone(state.pending),result=await dispatchPending(check);notice('The exact saved request has been reconciled with its native result.');if(p.path==='/large/collections/receive'){await list(check);await openCollection(result.id,check);await refresh();}else if(p.kind==='publish')await showLargeEdition(p.payload.id,check);}
   else if(action==='revise'){saveWorking('unresolved-request');preserveUnresolvedCollectionRequest(state,new Date().toISOString());saveLocal();renderRows();notice('The unresolved original request remains in history and the downloaded working file. Review the current native collection before preparing a new continuation.');}
   else if(action==='receive'){const body={...reviewedCollectionRequest(state),operationId:collectionRandomId()};const value=await write('/large/collections/receive','POST',body,{kind:'receive'},check);await list(check);await openCollection(value.id,check);await refresh();notice('Complete originals received at workspace revision '+value.workspaceRevision+'.');}
   else if(action==='refresh')await list(check);
   else if(target.dataset.collection)await openCollection(target.dataset.collection,check);
   else if(target.dataset.publish){const id=target.dataset.publish,current=await api('/large/collections/'+id);check();const body={id:collectionRandomId(),expectedRevision:current.workspaceRevision,filters:{}};const result=await write('/large/collections/'+id+'/publish','POST',body,{kind:'publish'},check);await openCollection(id,check);await showLargeEdition(result.binding.editionId,check);notice('Complete current study edition is saved with its original collection binding.');}
   else if(target.dataset.publication){const b=editionBindings.get(target.dataset.publication);if(!b)throw new Error('Refresh the original collection publication.');const result=await write('/large/collections/'+b.collectionId+'/publish','POST',{id:b.editionId,expectedRevision:b.expectedRevision,filters:b.filters},{kind:'publish'},check);await openCollection(b.collectionId,check);await showLargeEdition(result.binding.editionId,check);notice('The original collection publication is complete.');}
   else if(target.dataset.largeEdition)await showLargeEdition(target.dataset.largeEdition,check);
   else if(target.dataset.member)await downloadCollectionMember({api,id:target.dataset.downloadEdition,name:target.dataset.member,check,progress,download});
   else if(target.dataset.oldEdition)await showOldEdition(target.dataset.oldCollection,target.dataset.oldEdition,check);
   else if(target.dataset.oldBundle){const value=await api('/collections/'+target.dataset.oldCollection+'/editions/'+target.dataset.oldBundle+'/bundle');check();const bytes=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));if(bytes.length!==value.bytes||await collectionSHA256(bytes)!==value.sha256)throw new Error('Study download differs from its saved original edition.');check();download(value.name,new Blob([bytes],{type:value.type}));notice('The complete earlier editable study ZIP is ready to save.');}
  });
 },{signal});
 window.addEventListener('storage',event=>{if(event.key===storageKey&&!dead){storageBlocked=true;storageMessage='Another tab changed this workspace’s saved collection. Your current work remains here. Download both copies, reload the current saved copy, then open the chosen complete file.';persistence();}},{signal});
 window.addEventListener('beforeunload',event=>{if(dirty||busy||state.pending){event.preventDefault();event.returnValue='';}},{signal});
 if(initialSession!==null){
  const retained=restoreCollectionSession(initialSession,workspaceKey);
  ({state,knownRevision,storageBlocked,storageMessage,dirty}=retained);
  // Keep the original lease. A different saved tab must not be overwritten merely
  // because the host temporarily selected another workspace or signed-in person.
  try{const current=readEnvelope();if((current?.revision||null)!==knownRevision){storageBlocked=true;dirty=true;storageMessage='Another saved copy changed while this collection was detached. Your complete retained work remains here. Download both copies, reload the saved copy, then explicitly open the selected working file.';}}
  catch(error){storageBlocked=true;dirty=true;storageMessage=error.message+' Your complete retained work remains here. Download it before closing this browser.';}
  notice('Restored this workspace and account’s complete collection working copy, including unfinished fields and the exact pending request. Reselect a large original if more file bytes are needed.');persistence();
 }else try{const envelope=readEnvelope();if(envelope){state=validateCollectionWorking(envelope.state,workspaceKey);knownRevision=envelope.revision;notice('Reopened the saved collection working copy with its original request history.');}}catch(error){storageBlocked=true;storageMessage=error.message+' Download current work and retain the existing browser copy before replacing it.';persistence();}
 renderRows();persistence();const start=generation;list(()=>{if(dead||generation!==start)throw new Error('Collection list refresh superseded.');}).catch(error=>{if(!dead&&generation===start)notice(error.message,true);});
 return {snapshot(){return captureCollectionSession({state,knownRevision,storageBlocked,storageMessage,dirty});},hasUnsaved(){return dirty||busy||!!state.pending;},destroy(){dead=true;generation++;lifecycle.abort();for(const value of downloads){URL.revokeObjectURL(value.url);Promise.resolve(value.cleanup()).catch(()=>{});}downloads.clear();host.replaceChildren();}};
}
