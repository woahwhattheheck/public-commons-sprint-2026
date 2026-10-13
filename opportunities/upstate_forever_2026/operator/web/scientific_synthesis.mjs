import {DOCUMENT_SCHEMA,WORK_SCHEMA,WORK_BYTES,KINDS,stableJSON,blankDocument,validateDocument,validateReferences,validateWorking,importWorking} from './scientific_synthesis_core.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>JSON.stringify([s.source_collection_id,s.source_id]);
const label={finding:'Finding',interpretation:'Interpretation',limitation:'Limitation','next-work':'Next work'};
const download=(name,value)=>{const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
function database(){
 return new Promise((resolve,reject)=>{const r=indexedDB.open('tjlabs-scientific-synthesis-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('working');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Open browser draft storage.'));});
}
async function stored(key,value,write=false,expectedRevision=0){
 const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('working',write?'readwrite':'readonly'),s=tx.objectStore('working');let result,problem;
  const r=s.get(key);
  r.onsuccess=()=>{
   const current=r.result;
   if(!write){result=current;return;}
   const revision=current?.schema==='upstate.scientific-synthesis-browser/v1'?current.revision:0;
   if(revision!==expectedRevision){problem=Error('This browser draft was changed by another tab. Keep this working copy under a new browser draft key or reopen the retained copy.');tx.abort();return;}
   result={schema:'upstate.scientific-synthesis-browser/v1',revision:revision+1,working:value};s.put(result,key);
  };
  tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(problem||tx.error||Error('The complete browser draft was not committed.'));
 });}finally{db.close();}
}
export function attachScientificSynthesis(host){
 let panel=null,workspace=null,project=null,turn=0,edit=0,busy=false,error='',storageError='',work=null,editions=[],opened=null,active=false,ready=null;
 let tabId;try{tabId=sessionStorage.getItem('scientific-synthesis-tab');if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('scientific-synthesis-tab',tabId);}}catch{tabId=crypto.randomUUID();}
 let writes=Promise.resolve();const draftRevisions=new Map();
 const current=(ws,t)=>active&&workspace===ws&&host.getWorkspace()===ws&&turn===t;
 const locked=()=>busy||!!work?.pending;
 const storeKey=()=>workspace+':'+tabId;
 const status=()=>{const n=panel?.querySelector('[data-synthesis-status]');if(n)n.textContent=error||storageError||(busy?'Working through the original source and task workflow…':'');};
 function persist(){
  if(!work)return Promise.resolve();
  const value=validateWorking(work),key=storeKey(),ws=workspace,t=turn;
  const operation=writes.catch(()=>{}).then(async()=>{const result=await stored(key,value,true,draftRevisions.get(key)||0);draftRevisions.set(key,result.revision);return result;});writes=operation;
  operation.then(()=>{if(current(ws,t)){storageError='';status();}},reason=>{if(current(ws,t)){storageError='Complete browser draft could not be saved: '+reason.message+'. Download the full working copy before leaving.';status();}});
  return operation;
 }
 function changed(){edit++;error='';persist().catch(()=>{});status();}
 const request=(path,values={})=>host.api(host.endpoint(path,values));
 async function catalog(){
  const ws=workspace,t=turn,result=await request('/api/source-reports/synthesis-catalog');
  if(!current(ws,t))return null;
  if(result.workspace_key!==ws)throw Error('The synthesis catalog belongs to another Workspace.');
  project=result.project_id;editions=result.editions||[];return result;
 }
 async function loadReferences(sources){
  const ws=workspace,t=turn,version=edit,result=await host.api(host.endpoint('/api/source-reports/synthesis-references'),{method:'POST',body:{sources}});
  if(!current(ws,t)||version!==edit)return null;
  if(result.workspace_key!==ws||result.project_id!==project)throw Error('Original source references belong to another project.');
  return result.catalog;
 }
 function newWork(doc,catalogue=null){
  return {schema:WORK_SCHEMA,project_id:project,document:doc,base_collection_id:null,catalog:catalogue,pending:null,import_history:[]};
 }
 function ensure(container){
  if(!panel){
   panel=document.createElement('section');panel.className='scientific-synthesis';panel.setAttribute('aria-label','Scientist-authored synthesis');
   panel.innerHTML='<h3>Scientist-authored synthesis</h3><p>Write a decision question and attributed findings against exact original studies. Saved chapters use the normal report composer and retain complete source editions.</p><p data-synthesis-status role="status"></p><div data-synthesis-toolbar></div><div data-synthesis-editor></div><div data-synthesis-history></div>';
   panel.addEventListener('click',event=>{const b=event.target.closest('[data-synthesis-action]');if(!b||!panel.contains(b))return;event.preventDefault();event.stopPropagation();act(b).catch(showError);});
   panel.addEventListener('input',event=>{const el=event.target;if(!el.dataset.synthesisField)return;if(locked())return;
    const before=clone(work),field=el.dataset.synthesisField;
    if(field.startsWith('author.'))work.document.author[field.slice(7)]=el.value;
    else if(el.dataset.section){const s=work.document.sections.find(r=>r.id===el.dataset.section);if(s)s[field]=el.value;}
    else work.document[field]=el.value;
    try{validateWorking(work);}catch(reason){work=before;error=reason.message;render();return;}
    changed();
   });
   panel.addEventListener('change',event=>{
    const el=event.target;
    if(el.matches('[data-synthesis-open]')){const file=el.files[0];el.value='';if(file)openFile(file).catch(showError);return;}
    if(el.dataset.synthesisKind&&!locked()){const s=work.document.sections.find(r=>r.id===el.dataset.synthesisKind);s.kind=el.value;changed();return;}
    if(el.dataset.synthesisRef&&!locked()){const before=clone(work),s=work.document.sections.find(r=>r.id===el.dataset.section);if(el.checked){if(!s.reference_ids.includes(el.dataset.synthesisRef))s.reference_ids.push(el.dataset.synthesisRef);}else{s.reference_ids=s.reference_ids.filter(x=>x!==el.dataset.synthesisRef);}try{validateWorking(work);}catch(reason){work=before;error=reason.message;render();return;}changed();}
   });
  }
  if(panel.parentNode!==container)container.append(panel);panel.hidden=false;
  if(!document.querySelector('link[data-scientific-synthesis-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/web/scientific_synthesis.css';l.dataset.scientificSynthesisStyle='';document.head.append(l);}
 }
 function showError(reason){error=reason?.message||String(reason);status();}
 const button=(action,title,disabled=false,extra='')=>'<button type="button" data-synthesis-action="'+action+'"'+(disabled?' disabled':'')+extra+'>'+esc(title)+'</button>';
 function render(){
  if(!panel)return;const lock=locked(),d=work?.document;
  panel.querySelector('[data-synthesis-toolbar]').innerHTML=
   '<div class="inline-actions">'+button('new','Start from selected report studies',lock||!project)+button('refresh','Refresh authored editions',busy)+
   (work?button('download','Download complete working copy',false)+button('references','Use current report study selection',lock)+(storageError?button('separate-draft','Keep this complete copy in a separate browser draft',busy):''):'')+
   '<label>Open a complete working copy<input type="file" accept=".json,application/json" data-synthesis-open'+(lock?' disabled':'')+'></label></div>'+
   '<p class="note">Portable working copies support 16 MiB of complete UTF-8 source and unfinished text. Each attributed document supports 8 MiB. Each browser tab has its own draft; source revisions use the original server comparison before save.</p>'+
   (work?.pending?'<p>Retained original request '+esc(work.pending.operation_id)+(work.pending.task_id?' · task '+esc(work.pending.task_id):'')+'</p>'+
    button('recover','Recover or open original save task',busy)+button('task','Open current task',busy||!work.pending.task_id)+button('release-failed','Retain failed request and return to draft',busy||!work.pending.task_id):'');
  const target=panel.querySelector('[data-synthesis-editor]');
  if(!d){target.innerHTML='<p>Select studies above, then start an authored synthesis or open a saved edition below.</p>';}
  else{
   const sources=work.catalog?.sources||[],refs=work.catalog?.references||[],present=new Set(refs.map(r=>r.id));
   target.innerHTML='<div class="scientific-synthesis-fields">'+
    [['title','Chapter title'],['revision_name','Edition name'],['question','Decision question'],['scope','Scope and intended use'],['change_note','Revision change note']].map(([field,title])=>'<label>'+esc(title)+(field==='question'||field==='scope'||field==='change_note'?'<textarea rows="3"':'<input')+' data-synthesis-field="'+field+'"'+(lock?' disabled':'')+(field==='question'||field==='scope'||field==='change_note'?'>'+esc(d[field])+'</textarea>':' value="'+esc(d[field])+'">')+'</label>').join('')+
    ['name','organization','email'].map(f=>'<label>'+esc({name:'Named author',organization:'Organization',email:'Contact email'}[f])+'<input data-synthesis-field="author.'+f+'" value="'+esc(d.author[f])+'"'+(lock?' disabled':'')+'></label>').join('')+'</div>'+
    '<p>Series '+esc(d.series_id)+(work.base_collection_id?' · revising retained collection '+esc(work.base_collection_id):' · new attributed series')+'</p>'+
    (opened?.foreign_project?'<p>This retained edition originated in another project. Fork a new series before saving here.</p>'+button('fork','Fork into this project',lock):'')+
    '<details><summary>Exact selected source studies and reference catalog</summary><ol>'+sources.map(s=>'<li><strong>'+esc(s.title)+'</strong> · '+esc(s.source_id)+'<br><code>'+esc(s.body_sha256)+'</code></li>').join('')+'</ol>'+
    button('download-catalog','Download complete reference catalog',!work.catalog)+'</details>'+
    '<div data-synthesis-sections>'+d.sections.map((s,i)=>'<section class="scientific-synthesis-section"><div class="inline-actions"><label>Section kind<select data-synthesis-kind="'+esc(s.id)+'"'+(lock?' disabled':'')+'>'+KINDS.map(k=>'<option value="'+k+'"'+(k===s.kind?' selected':'')+'>'+label[k]+'</option>').join('')+'</select></label>'+
     button('up','Earlier',lock||i===0,' data-section="'+esc(s.id)+'"')+button('down','Later',lock||i===d.sections.length-1,' data-section="'+esc(s.id)+'"')+button('remove','Remove section',lock,' data-section="'+esc(s.id)+'"')+'</div>'+
     '<label>Heading<input data-section="'+esc(s.id)+'" data-synthesis-field="heading" value="'+esc(s.heading)+'"'+(lock?' disabled':'')+'></label>'+
     '<label>Authored text<textarea rows="6" data-section="'+esc(s.id)+'" data-synthesis-field="text"'+(lock?' disabled':'')+'>'+esc(s.text)+'</textarea></label>'+
     '<details><summary>Original references ('+s.reference_ids.length+' selected)</summary>'+
     (s.reference_ids.filter(id=>!present.has(id)).map(id=>'<p class="error">Unresolved retained reference '+esc(id)+'. Select the original study or explicitly replace this reference.</p>').join(''))+
     sources.map(source=>'<details><summary>'+esc(source.title)+'</summary>'+
      refs.filter(r=>r.source_collection_id===source.source_collection_id&&r.source_id===source.source_id).map(r=>'<div class="scientific-synthesis-reference"><label><input type="checkbox" data-section="'+esc(s.id)+'" data-synthesis-ref="'+esc(r.id)+'"'+(s.reference_ids.includes(r.id)?' checked':'')+(lock?' disabled':'')+'> '+esc(r.kind)+' · '+esc(r.title)+'</label><details><summary>Read exact retained source value</summary><p>'+esc(r.member_path)+' '+esc(r.pointer)+'</p><pre>'+esc(JSON.stringify(r.content,null,2))+'</pre></details></div>').join('')+'</details>').join('')+
     '</details></section>').join('')+'</div>'+
    '<div class="inline-actions">'+KINDS.map(k=>button('add', 'Add '+label[k].toLowerCase(),lock,' data-kind="'+k+'"')).join('')+
    button('save','Save attributed chapter through original queue',lock||opened?.foreign_project||!work.catalog)+
    button('compose','Use saved chapter and original studies in report',lock||!opened)+
    (opened?button('download-edition','Download full authored edition/history',false):'')+'</div>';
  }
  panel.querySelector('[data-synthesis-history]').innerHTML='<h4>Saved authored editions</h4>'+
   (editions.length?'<div class="table-scroll"><table><thead><tr><th>Chapter / edition</th><th>Revision</th><th></th></tr></thead><tbody>'+
    editions.map(r=>'<tr><td>'+esc(r.title)+'<small>'+esc(r.series_id)+'</small></td><td>'+esc(r.revision)+'</td><td>'+button('open','Open full edition',lock,' data-id="'+esc(r.collection_id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No scientist-authored editions in this Workspace yet.</p>');
  status();
 }
 async function openFile(file){
  if(locked())throw Error('Recover the current original request before opening another working copy.');
  if(file.size>WORK_BYTES)throw Error('The complete working copy exceeds 16 MiB.');
  const ws=workspace,t=turn,version=edit,body=await file.text();
  if(!current(ws,t)||edit!==version)throw Error('The active draft changed while the file was opening. Your current edits are retained.');
  const value=importWorking(work,JSON.parse(body),{projectId:project,at:new Date().toISOString()});
  work=value;opened=null;edit++;await persist();render();
 }
 async function openEdition(id){
  const ws=workspace,t=turn,version=edit,result=await request('/api/source-reports/synthesis-edition',{collection_id:id});
  if(!current(ws,t)||version!==edit)return;
  if(result.workspace_key!==ws||result.collection_id!==id)throw Error('The saved chapter selection differs.');
  const doc=clone(result.record.document),next={...newWork(doc,result.catalog),base_collection_id:id};validateWorking(next);work=next;opened=result;edit++;
  await persist();render();
 }
 async function newFromSelection(){
  const ws=workspace,t=turn,choices=clone(host.getReportSources());
  if(!choices.length)throw Error('Choose original studies in the report composer above.');
  const doc=blankDocument({seriesId:crypto.randomUUID(),sources:choices});
  work=newWork(doc);opened=null;edit++;await persist();if(!current(ws,t))return;render();
  const result=await loadReferences(choices);if(result){const next={...work,catalog:result};validateWorking(next);work=next;await persist();if(current(ws,t))render();}
 }
 async function selectReferences(){
  const choices=clone(host.getReportSources());if(!choices.length)throw Error('Choose the original source studies above.');
  const refs=await loadReferences(choices);if(!refs)return;
  const next={...work,document:{...work.document,sources:choices},catalog:refs};validateWorking(next);work=next;edit++;await persist();render();
 }
 async function finishTask(original){
  const ws=workspace,t=turn;
  const response=await request('/api/task',{id:original.task_id});
  if(!current(ws,t)||work?.pending!==original)return;
  const task=response.task||response;
  if(task.id!==original.task_id||task.workspace!==ws||task.action!==original.action||stableJSON(task.payload)!==stableJSON(original.payload))
   throw Error('The accepted task differs from the retained complete request.');
  if(task.state==='complete'){
   const id=task.result?.collection_id;if(!id)throw Error('The complete original source receipt has no collection identity.');
   const result=await request('/api/source-reports/synthesis-edition',{collection_id:id});
   if(!current(ws,t)||work?.pending!==original)return;
   if(result.record.operation_id!==original.operation_id||stableJSON(result.record.document)!==stableJSON(original.payload.document))
    throw Error('The original source receipt has another authored document.');
   work.document=clone(result.record.document);work.base_collection_id=id;work.catalog=result.catalog;work.pending=null;opened=result;edit++;await persist();if(!current(ws,t))return;await catalog();if(current(ws,t))render();
  }else{
   error=task.state==='failed'?'The original task failed. Open it to inspect and resume the same request.':'The original save task is '+task.state+'. Recover it here after completion, or open its existing task view.';
   render();
  }
 }
 async function submit(){
  if(!work.pending){
   const doc=validateDocument(work.document,{complete:true});validateReferences(doc,work.catalog);
   const id=crypto.randomUUID(),pending={operation_id:id,action:'source-reports.synthesis-save',task_id:null,
    payload:{operation_id:id,document:doc,base_collection_id:work.base_collection_id,catalog_sha256:work.catalog.catalog_sha256}};
   validateWorking({...work,pending});work.pending=pending;
  }
  const original=work.pending,ws=workspace,t=turn;await persist();
  if(!current(ws,t)||work.pending!==original)return;
  if(!original.task_id){
   const result=await host.api('/api/actions',{method:'POST',body:{workspace:ws,action:original.action,operation_id:original.operation_id,payload:original.payload}});
   if(!current(ws,t)||work.pending!==original)return;
   const task=result.task||result;
   if(typeof task.id!=='string'||task.workspace!==ws||task.action!==original.action||stableJSON(task.payload)!==stableJSON(original.payload))throw Error('Recover the original accepted task; its complete selection was not returned.');
   original.task_id=task.id;await persist();
  }
  if(!current(ws,t)||work?.pending!==original)return;
  return finishTask(original);
 }
 async function act(b){
  const action=b.dataset.synthesisAction;
  if(action==='download'){download('scientific-synthesis-working.json',validateWorking(work));return;}
  if(action==='download-catalog'){download('scientific-synthesis-catalog.json',work.catalog);return;}
  if(action==='download-edition'){download('scientific-synthesis-edition.json',opened);return;}
  if(action==='task'){await host.showTask(work.pending.task_id);return;}
  if(action==='separate-draft'){tabId=crypto.randomUUID();try{sessionStorage.setItem('scientific-synthesis-tab',tabId);}catch{}await persist();render();return;}
  if(busy)return;
  if(work?.pending&&!['recover','refresh','release-failed'].includes(action))throw Error('Recover the retained original request first.');
  const ws=workspace,t=turn;busy=true;error='';render();
  try{
   if(action==='new')await newFromSelection();
   else if(action==='refresh'){await catalog();if(work?.pending?.task_id)await finishTask(work.pending);}
   else if(action==='references')await selectReferences();
   else if(action==='open')await openEdition(b.dataset.id);
   else if(action==='save'||action==='recover')await submit();
   else if(action==='release-failed'){
    const original=work.pending;
    const taskResult=await request('/api/task',{id:original.task_id});if(!current(ws,t)||work.pending!==original)return;
    const task=taskResult.task||taskResult;
    if(task.id!==original.task_id||task.workspace!==ws||task.action!==original.action||stableJSON(task.payload)!==stableJSON(original.payload)||task.state!=='failed')throw Error('Only the exact failed original task can return to an editable draft.');
    const result=await host.api(host.endpoint('/api/source-reports/synthesis-operation'),{method:'POST',body:original.payload});if(!current(ws,t)||work.pending!==original)return;
    if(result.received){throw Error('The original authored source is already saved. Resume the existing failed task to receive that same edition.');}
    work.import_history.push({at:new Date().toISOString(),failed_request:clone(original),failed_task:clone(task)});work.pending=null;edit++;await persist();
   }
   else if(action==='fork'){
    const prior=opened;const doc=clone(work.document);doc.series_id=crypto.randomUUID();doc.fork_origin={collection_id:prior.collection_id,revision_id:prior.record.revision_id};doc.revision_name='Forked first edition';doc.change_note='Forked from '+prior.record.document.revision_name;work=newWork(doc,work.catalog);opened=null;edit++;await persist();
   }
   else if(action==='compose'){await host.compose({workspace_key:ws,sources:[opened.source,...opened.record.document.sources],selection_mode:'replace',title:opened.record.document.title});}
   else if(action==='add'){const next=clone(work);next.document.sections.push({id:crypto.randomUUID(),kind:b.dataset.kind,heading:'',text:'',reference_ids:[]});validateWorking(next);work=next;changed();}
   else if(['remove','up','down'].includes(action)){const i=work.document.sections.findIndex(r=>r.id===b.dataset.section);if(i<0)throw Error('Choose an authored section.');if(action==='remove')work.document.sections.splice(i,1);else{const j=i+(action==='up'?-1:1);if(j<0||j>=work.document.sections.length)throw Error('Choose an available section order.');[work.document.sections[i],work.document.sections[j]]=[work.document.sections[j],work.document.sections[i]];}changed();}
  }finally{if(current(ws,t)){busy=false;render();}}
 }
 async function mount(container){
  const ws=host.getWorkspace();if(workspace===ws&&active){ensure(container);return ready;}
  turn++;workspace=ws;active=true;busy=false;error='';storageError='';work=null;opened=null;project=null;editions=[];edit++;
  const t=turn;ensure(container);render();
  ready=(async()=>{await catalog();if(!current(ws,t))return;
   const draftKey=storeKey(),saved=await stored(draftKey);if(!current(ws,t))return;
   draftRevisions.set(draftKey,saved?.schema==='upstate.scientific-synthesis-browser/v1'?saved.revision:0);
   if(saved){const value=validateWorking(saved.schema==='upstate.scientific-synthesis-browser/v1'?saved.working:saved);if(value.project_id!==project)throw Error('Retained browser work belongs to another original project. Download and open it in that project.');work=value;
    if(work.base_collection_id){try{const result=await request('/api/source-reports/synthesis-edition',{collection_id:work.base_collection_id});if(current(ws,t))opened=result;}catch(reason){if(current(ws,t))error='Retained source edition could not be read: '+reason.message;}}}
   if(current(ws,t))render();
  })().catch(reason=>{if(current(ws,t))showError(reason);});return ready;
 }
 function detach(){active=false;turn++;if(panel)panel.hidden=true;}
 function reset(){detach();panel?.remove();panel=null;workspace=null;work=null;opened=null;project=null;ready=null;}
 return {mount,detach,reset,working:()=>work?clone(work):null};
}
