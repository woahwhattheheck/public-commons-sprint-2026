// Complete source-file intake into the original Grant Operations case.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
const SCHEMA='stellar-forge.sf47-ledger-intake.v1';
const DESK_SCHEMA='stellar-forge.sf47-ledger-desk.v1';
const kinds=[['contributors','Contributors / suppliers'],['work','Recorded work'],['invoices','Supplier invoices'],['cash','Observed cash'],['source','Supporting attachment']];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2);
const clone=value=>JSON.parse(JSON.stringify(value));
const b64=buffer=>{let result='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
const size=value=>Number(value||0).toLocaleString()+' B';
const recordedDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?String(value||''):date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});};
const storageConflictMessage="Another tab saved a newer draft for this case. This tab keeps its complete input and pending request; download it or open the saved draft to reconcile.";
const choose=(values,value)=>values.map(([id,label])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(label)+'</option>').join('');
const button=(label,action,{disabled=false,always=false,data=''}={})=>'<button type="button" data-li-action="'+action+'" '+data+
  (disabled?' disabled data-li-fixed="true"':'')+(always?' data-li-always="true"':'')+'>'+esc(label)+'</button>';
const table=(head,rows)=>'<div class="ledger-intake-table"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+
  (rows.length?'':'<tr><td colspan="'+head.length+'">No rows in this view.</td></tr>')+'</tbody></table></div>';
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const LEDGER_DATABASE='sf47-ledger-intake',databases=new Map();
function db(name=LEDGER_DATABASE){
  if(!databases.has(name)){
    const opening=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error('Browser file storage is unavailable.'));return;}
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('desks'))request.result.createObjectStore('desks');};
      request.onerror=()=>reject(request.error||new Error('Browser file storage could not open.'));
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();databases.delete(name);};resolve(request.result);};
    }).catch(problem=>{databases.delete(name);throw problem;});
    databases.set(name,opening);
  }
  return databases.get(name);
}
async function saved(key,value,expectedRevision,name=LEDGER_DATABASE){
  const database=await db(name);
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('desks',value===undefined?'readonly':'readwrite'),store=tx.objectStore('desks');
    const request=store.get(key);
    let result,conflict;
    request.onsuccess=()=>{
      const previous=request.result;
      if(value===undefined){result=previous;return;}
      const revision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
      if(revision!==expectedRevision){
        conflict=Object.assign(new Error(storageConflictMessage),{code:'LEDGER_DRAFT_CONFLICT',storedRevision:revision});
        tx.abort();return;
      }
      const next={...value,_storedRevision:revision+1};
      store.put(next,key);result=next._storedRevision;
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(conflict||tx.error||request.error||new Error('Browser files could not be retained.'));
  });
}

export function mountLedgerIntake({container,current,api,saveApi=api,session,mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext()}){
  const root=document.createElement('section');root.className='ledger-intake';root.setAttribute('aria-label','Bulk ledger intake');container.replaceChildren(root);
  if(!document.querySelector('link[data-ledger-intake-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_ledger_intake.css';style.dataset.ledgerIntakeStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey=caseId;
  const deskContext=staffContext?clone(staffContext):null,databaseName=staffDeskStorageKey(LEDGER_DATABASE,deskContext),boundStaff=databaseName!==LEDGER_DATABASE;
  const ownSaved=(key,value,expectedRevision)=>saved(key,value,expectedRevision,databaseName);
  let legacyCopy=null,legacySearched=false;
  function pendingActorProblem(body) {
    if(!boundStaff||deskContext.role==='owner'||!body)return null;
    if(typeof body.actor==='string'&&body.actor.trim()===deskContext.actor)return null;
    const original=typeof body.actor==='string'&&body.actor.trim()?body.actor.trim():'an unrecorded operator';
    return Object.assign(new Error('This original request belongs to '+original+'. Sign in as that operator to resume it. The complete original copy remains available to download.'),{code:'STAFF_REQUEST_ACTOR_CHANGED',status:403});
  }

  let active=true,busy=false,hostBusy=false,contract=null,error='',notice='',storageNote=session.storageConflict?storageConflictMessage:'',saveTimer;
  session.storageWrites||=Promise.resolve();
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  const draft=()=>session.document;
  function state(){
    return {schema:DESK_SCHEMA,caseId,document:clone(draft()),rawDefaults:clone(session.rawDefaults||{}),
      inspections:clone(session.inspections||{}),selectedFile:session.selectedFile||0,
      pending:session.pending?clone(session.pending):null,result:session.result?clone(session.result):null,note:session.note||''};
  }
  async function persist(){
    const value=state();
    const write=session.storageWrites.catch(()=>{}).then(async()=>{
      const revision=await ownSaved(storageKey,value,session.storageRevision??0);
      session.storageRevision=revision;session.storageConflict=false;
      return revision;
    });
    session.storageWrites=write;
    try{await write;storageNote='';if(available())status();return true;}
    catch(problem){
      session.storageConflict=problem.code==='LEDGER_DRAFT_CONFLICT'||session.storageConflict;
      storageNote=session.storageConflict?storageConflictMessage:'Browser storage could not retain this draft. Download the complete draft or original pending request to keep its files.';
      if(available())status();return false;
    }
  }
  function validateDesk(value){
    if(value?.schema!==DESK_SCHEMA||value.caseId!==caseId||value.document?.schema!==SCHEMA||!Array.isArray(value.document.files)||value.document.files.length>20)
      throw new Error('Open a complete saved ledger desk for this original case.');
    if(value.document.files.some(file=>!file||typeof file.contentBase64!=='string'||typeof file.id!=='string'))
      throw new Error('Every source file must retain its complete content and file key.');
    if(value.pending&&(!value.pending.body||typeof value.pending.body.requestId!=='string'||!Number.isInteger(value.pending.body.expectedVersion)||
      value.pending.body.document?.schema!==SCHEMA||typeof value.pending.documentSha256!=='string'))
      throw new Error('Retain the complete original ledger request and input identity.');
  }
  function restore(previous){
    validateDesk(previous);
    const values={document:{schema:SCHEMA,title:'Ledger intake',files:[]},rawDefaults:{},inspections:{},selectedFile:0,pending:null,result:null,note:'',...previous};
    for(const key of ['document','rawDefaults','inspections','selectedFile','pending','result','note'])session[key]=clone(values[key]);
    session.storageRevision=Number.isSafeInteger(previous._storedRevision)?previous._storedRevision:0;
    session.storageConflict=false;session.preview=null;storageNote='';
  }
  function schedule(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist();},200);}
  function edited(){session.preview=null;session.page=0;session.result=null;notice='Input changed. Preview the complete intake again.';const apply=$('[data-li-action="apply"]');if(apply)apply.disabled=true;status();schedule();}
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const fixed=el.dataset.liFixed==='true',always=el.dataset.liAlways==='true';
      el.disabled=fixed||(!always&&(busy||hostBusy||!!session.pending));
    }
    for(const el of root.querySelectorAll('[data-li-action="retry"]'))el.disabled=busy||hostBusy||!session.pending||!!pendingActorProblem(session.pending?.body);
  }
  function status(){
    const node=$('[data-li-status]');
    if(node){node.textContent=error||storageNote||notice;node.setAttribute('role',error||session.storageConflict?'alert':'status');}
    const conflict=$('[data-li-storage-conflict]');if(conflict)conflict.hidden=!session.storageConflict;
  }
  async function inspectLegacy(){
    const value=await saved(storageKey);if(!available())return;
    if(value)validateDesk(value);
    legacyCopy=value?clone(value):null;legacySearched=true;render();
  }
  async function openLegacy(){
    if(!legacyCopy)throw new Error('Choose an earlier browser copy first.');
    if(session.pending)throw new Error('Keep the current original request until its result is available.');
    const problem=pendingActorProblem(legacyCopy.pending?.body);if(problem)throw problem;
    clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});if(!available())return;
    const revision=session.storageRevision??0;
    download(state(),caseId+'-ledger-intake-before-earlier-copy-'+Date.now()+'.json');
    restore(legacyCopy);session.storageRevision=revision;legacyCopy=null;legacySearched=false;render();
    await persist();if(!available())return;
    notice='Opened the selected earlier copy in this sign-in with every original source file. Its original browser copy remains available.';render();
  }
  function legacyView(){
    if(!legacySearched)return '';
    if(!legacyCopy)return '<section class="ledger-intake-pending"><h4>Earlier browser copies</h4><p>No earlier ledger desk is saved for this case.</p>'+button('Close','legacy-close')+'</section>';
    const pending=legacyCopy.pending,problem=pendingActorProblem(pending?.body);
    return '<section class="ledger-intake-pending"><h4>Earlier browser copy</h4>'+
      table(['Original case','Original input','Source files','Original request / operator'],[[esc(legacyCopy.caseId),esc(legacyCopy.document.title),String(legacyCopy.document.files.length),esc(pending?.body?.requestId||'No pending request')+'<small>'+esc(pending?.body?.actor||'No pending request')+'</small>']])+
      '<p>'+esc(problem?.message||'Open this selected copy in the current sign-in. This desk is retained as a complete download first.')+'</p><div class="ledger-intake-actions">'+
      button('Open selected earlier copy','legacy-open',{disabled:!!problem||!!session.pending})+button('Download earlier copy','legacy-download',{always:true})+button('Close','legacy-close')+'</div></section>';
  }
  function activeFile(){return draft().files[session.selectedFile||0];}
  function fileEditor(){
    const file=activeFile();
    if(!file)return '<p>Add your complete source files to prepare the intake.</p>';
    const inspection=session.inspections[file.id],headers=inspection?.headers||[];
    const formats=file.kind==='source'?[['binary','Original attachment'],['csv','CSV'],['tsv','TSV'],['json','JSON']]:[['csv','CSV'],['tsv','TSV'],['json','JSON']];
    const fields=contract?.fields[file.kind]||[];
    const defaults=Object.hasOwn(session.rawDefaults,file.id)?session.rawDefaults[file.id]:pretty(file.defaults||{});
    return '<section class="ledger-intake-editor"><h4>'+esc(file.filename)+'</h4><div class="ledger-intake-fields">'+
      '<label>File key<input data-li-file-field="id" value="'+esc(file.id)+'" maxlength="100"></label>'+
      '<label>Record table<select data-li-file-field="kind">'+choose(kinds,file.kind)+'</select></label>'+
      '<label>Original format<select data-li-file-field="format">'+choose(formats,file.format)+'</select></label>'+
      '<label>Original source URL<input type="url" data-li-file-field="sourceUrl" value="'+esc(file.sourceUrl||'')+'"></label>'+
      '<label>Observed at (ISO timestamp)<input data-li-file-field="observedAt" value="'+esc(file.observedAt||'')+'"></label>'+
      '</div><p>'+esc(size(inspection?.bytes||Math.floor(file.contentBase64.length*3/4)))+
      (inspection?' · '+inspection.rowCount+' source rows':'')+'</p>'+
      '<div class="ledger-intake-actions">'+button('Read columns and sample','inspect',{disabled:file.kind==='source'})+
      button('Remove file','remove-file')+'</div>'+
      (file.kind!=='source'&&['csv','tsv'].includes(file.format)?'<h5>Map original columns</h5><p>Native header names are selected automatically. Choose Ignore for a column you are leaving in the original source only.</p>'+
        (headers.length?table(['Native field','Original source column'],fields.map(field=>[esc(field),'<select aria-label="'+esc('Column for '+field)+'" data-li-map="'+esc(field)+'">'+
          choose([['','Ignore'],...headers.map(header=>[header,header])],Object.hasOwn(file.mapping||{},field)?file.mapping[field]||'':headers.includes(field)?field:'')+'</select>'])):
          '<p>Read the file columns to configure their mapping.</p>'):'')+
      (file.kind!=='source'?'<details><summary>Defaults for missing table fields</summary><p>Use native JSON field names. Put each row key and existing record ID in the table itself. Decimal amounts can be written as strings.</p>'+
        '<textarea data-li-defaults rows="8" spellcheck="false" aria-label="Native defaults">'+esc(defaults)+'</textarea></details>':'')+
      (inspection?.unmappedColumns?.length?'<p><strong>Original columns outside the selected mapping:</strong> '+esc(inspection.unmappedColumns.join(', '))+'</p>':'')+
      (inspection?.sample?.length?'<details><summary>First original mapped rows</summary><pre>'+esc(pretty(inspection.sample))+'</pre></details>':'')+'</section>';
  }
  function previewView(){
    const selected=session.preview;
    if(!selected)return '<section><h4>Review every native record</h4><p>Preview the complete intake after selecting its files and mappings. The preview shows each original replacement beside the complete new record.</p></section>';
    let rows=selected.records;
    if(session.filterKind)rows=rows.filter(row=>row.kind===session.filterKind);
    const query=(session.query||'').trim().toLowerCase();
    if(query)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query));
    const pages=Math.max(1,Math.ceil(rows.length/50));session.page=Math.min(Math.max(session.page||0,0),pages-1);
    const summary=selected.summary;
    return '<section class="ledger-intake-review"><h4>Complete native preview · case version '+selected.case.version+'</h4>'+
      '<div class="ledger-intake-stats">'+[['Records',summary.records],['New',summary.created],['Replacements',summary.replaced],['Original files',summary.files],['Original bytes',size(summary.sourceBytes)]]
        .map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+'</div>'+
      (selected.alreadyRecorded?'<p class="ledger-intake-note">This exact complete input is already recorded in '+esc(selected.alreadyRecorded.title)+', original case version '+selected.alreadyRecorded.version+'.</p>'+
        button('Open recorded input','open-recorded',{data:'data-source-id="'+esc(selected.alreadyRecorded.sourceId)+'"'}):'')+
      (selected.errors.length?'<details open><summary>'+selected.errors.length+' items to correct</summary><ul class="ledger-intake-errors">'+selected.errors.map(item=>'<li>'+
        esc([item.fileId,item.key,item.rows?'rows '+item.rows.join(', '):''].filter(Boolean).join(' · '))+': '+esc(item.message)+'</li>').join('')+'</ul></details>':'')+
      '<div class="ledger-intake-fields"><label>Table<select data-li-filter="filterKind">'+choose([['','All tables'],...kinds.filter(([id])=>id!=='source')],session.filterKind||'')+'</select></label>'+
      '<label>Find key, source, record or amount<input type="search" data-li-filter="query" value="'+esc(session.query||'')+'"></label></div>'+
      table(['Native action','Source / key','Original target','Complete proposed record'],rows.slice(session.page*50,(session.page+1)*50).map(row=>[
        esc(row.mode+' · '+row.action),esc(row.fileId+' · rows '+row.rows.join(', '))+'<p><code>@'+esc(row.key)+'</code></p>',
        row.recordId?'<code>'+esc(row.recordId)+'</code><details><summary>Original record</summary><pre>'+esc(pretty(row.before))+'</pre></details>':'New native record',
        '<strong>'+esc(row.after.name||row.after.number||row.after.description||row.after.externalRef||row.key)+'</strong><p>'+esc(row.after.state)+'</p>'+
          '<details><summary>All fields</summary><pre>'+esc(pretty(row.after))+'</pre></details>']))+
      '<div class="ledger-intake-actions"><span>'+rows.length+' matching records · page '+(session.page+1)+' of '+pages+'</span>'+
      button('Previous','previous',{disabled:session.page===0})+button('Next','next',{disabled:session.page>=pages-1})+
      button('Download full preview','download-preview',{always:true})+'</div>'+
      '<p>New work enters the original Logged state; supplier invoices enter Received. Continue their original review and acceptance controls after intake. Cash keeps its original observation and allocation rules.</p>'+
      '<div class="ledger-intake-actions">'+button('Apply complete reviewed intake','apply',{disabled:!selected.canApply||current.program.state!=='OPEN'})+'</div></section>';
  }
  function references(){
    const query=(session.referenceQuery||'').trim().toLowerCase(),kind=session.referenceKind||'contributors';
    const rows=(current.records[kind]||[]).filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query)).slice(0,50);
    return '<details class="ledger-intake-reference" data-li-reference'+(session.referenceOpen?' open':'')+'><summary>Existing record and file references</summary>'+
      '<p>Use the exact retained ID to link to an existing record. Use @row-key for a row in this intake and @file:file-key for an attached source. A record table\'s own source file is attached automatically.</p>'+
      '<div class="ledger-intake-fields"><label>Original records<select data-li-filter="referenceKind">'+choose(kinds.filter(([id])=>id!=='source'),kind)+'</select></label>'+
      '<label>Find retained record<input type="search" data-li-filter="referenceQuery" value="'+esc(session.referenceQuery||'')+'"></label></div>'+
      table(['Retained record','Exact ID','State'],rows.map(row=>[esc(row.name||row.number||row.description||row.externalRef||row.id),'<code>'+esc(row.id)+'</code>',esc(row.state)]))+
      '<p>Showing up to 50 matching records. Pinned package IDs: '+current.plan.scenario.future_costs.map(row=>'<code>'+esc(row.id)+'</code>').join(', ')+'.</p>'+
      table(['Original source','Exact source ID'],current.sources.map(row=>[esc(row.filename),'<code>'+esc(row.id)+'</code>']))+'</details>';
  }
  function render(){
    if(!available())return;
    const files=draft().files;
    session.selectedFile=Math.min(Math.max(session.selectedFile||0,0),Math.max(0,files.length-1));
    root.innerHTML='<header><div><h3>Bulk ledger intake</h3><p>Bring complete contributor, work, supplier invoice and cash tables into this retained case.</p></div>'+
      '<div class="ledger-intake-actions">'+button('Download complete draft','download-draft',{always:true})+
      button('Open draft / input','open-document')+button('Open Budget performance','performance')+(boundStaff?button('Find earlier browser copy','legacy-inspect'):'')+'</div></header>'+
      '<p data-li-status role="status" aria-live="polite"></p>'+
      '<section class="ledger-intake-pending" data-li-storage-conflict hidden><h4>Two tabs edited this case draft</h4><p>Keep the complete input in this tab before opening the newer stored draft. The download includes any original pending request.</p>'+
        '<div class="ledger-intake-actions">'+button('Download this draft and open saved draft','open-saved',{always:true})+'</div></section>'+
      legacyView()+(session.pending?'<section class="ledger-intake-pending"><h4>Original intake request retained</h4><p>Request <code>'+esc(session.pending.body.requestId)+
        '</code> carries the complete reviewed input for case version '+session.pending.body.expectedVersion+'.</p><p>'+esc(pendingActorProblem(session.pending.body)?.message||'Resume that original request to receive its result.')+'</p>'+
        '<div class="ledger-intake-actions">'+button('Retry original intake','retry')+button('Download original request','download-request',{always:true})+'</div></section>':'')+
      (session.result?'<section class="ledger-intake-result"><h4>Recorded intake · case version '+session.result.version+'</h4><p>'+
        session.result.summary.records+' native records and '+session.result.summary.files+' original source files are retained with their input mapping.</p>'+
        '<div class="ledger-intake-actions">'+button('Download returned record map','download-result',{always:true})+
        button('Export complete case','export-case')+button('Open Budget performance','performance')+'</div></section>':'')+
      '<div class="ledger-intake-fields"><label>Intake title<input data-li-title value="'+esc(draft().title)+'" maxlength="300"></label>'+
      '<label>Recorded operation note<textarea data-li-note rows="2" maxlength="12000">'+esc(session.note||'')+'</textarea></label></div>'+
      '<div class="ledger-intake-add"><label>Next file contains<select data-li-next-kind>'+choose(kinds,session.nextKind||'contributors')+'</select></label>'+
      '<div class="ledger-intake-actions">'+button('Add source files','add-files',{disabled:files.length>=20})+
      button('CSV template','template-csv',{disabled:(session.nextKind||'contributors')==='source'})+
      button('TSV template','template-tsv',{disabled:(session.nextKind||'contributors')==='source'})+'</div></div>'+
      '<input type="file" data-li-files multiple hidden><input type="file" data-li-document accept=".json,application/json" hidden>'+
      '<div class="ledger-intake-layout"><aside aria-label="Selected source files">'+
        (files.length?'<ol class="ledger-intake-files">'+files.map((file,index)=>'<li>'+button(file.filename,'select-file',{data:'data-index="'+index+'"'+
          (index===session.selectedFile?' aria-current="true"':'')})+'<small>'+esc(kinds.find(([id])=>id===file.kind)?.[1]||file.kind)+' · '+esc(file.id)+'</small></li>').join('')+'</ol>':'<p>No source files selected.</p>')+
        '<p>Up to 20 complete files, 12 MiB, 5,000 original rows and 1,000 native records per intake.</p></aside>'+fileEditor()+'</div>'+
      '<div class="ledger-intake-actions">'+button('Preview complete intake','preview',{disabled:!files.length||!contract})+'</div>'+
      previewView()+references()+
      '<section><h4>Recorded intakes in this case</h4>'+
      table(['Intake','Original case versions','Records / files','Operator',''],(contract?.intakes||[]).map(item=>[
        esc(item.title)+'<small>'+esc(recordedDate(item.recordedAt))+'</small>',item.fromVersion+' → '+item.version,
        item.summary.records+' / '+item.summary.files,esc(item.actor),button('Open original input','open-recorded',{data:'data-source-id="'+esc(item.sourceId)+'"'})]))+
      '<p>The complete case handover retains every original file, native record event and intake mapping. Receiving it through Import complete case makes these original inputs available here.</p></section>';
    controls();status();
  }
  function syncDefaults(){
    for(const file of draft().files){
      if(!Object.hasOwn(session.rawDefaults,file.id))continue;
      let value;try{value=JSON.parse(session.rawDefaults[file.id]||'{}');}catch{throw new Error('Correct the JSON defaults for '+file.filename+'.');}
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Defaults for '+file.filename+' must be a JSON object.');
      file.defaults=value;
    }
  }
  async function run(action){
    if(busy||hostBusy||!available())return;
    busy=true;error='';controls();status();
    try{await action();}catch(problem){if(available())error=problem.message||String(problem);}
    finally{if(available()){busy=false;render();}}
  }
  async function inspectFile(file){
    const result=await api(prefix+'/ledger-intake-inspect',{file:clone(file)});
    session.inspections[file.id]=result;await persist();return result;
  }
  async function review(){
    syncDefaults();await persist();
    const selected=clone(draft());
    const result=await api(prefix+'/ledger-intake-preview',{document:selected});
    if(result.schema!=='stellar-forge.sf47-ledger-preview.v1'||result.case?.id!==caseId)
      throw new Error('The preview response does not match this original case.');
    session.preview=result;session.page=0;
    for(const item of result.files)session.inspections[item.id]=item;
    notice=result.canApply?'Review the full proposed records, then apply the complete intake.':result.alreadyRecorded?'This complete input is already retained.':'Correct the listed input items and preview again.';
  }
  async function dispatch(){
    const pending=session.pending;
    if(!pending)return;
    busy=true;error='';render();
    try{
      const problem=pendingActorProblem(pending.body);if(problem)throw problem;
      const result=await saveApi(prefix+'/ledger-intake-apply',clone(pending.body));
      if(result.id!==caseId||result.documentSha256!==pending.documentSha256)
        throw new Error('The returned intake does not match the retained original request.');
      session.result=result;session.pending=null;session.preview=null;
      await persist();
      if(available()){
        notice='Recorded the complete intake and its original files.';
        const next=await api(prefix);
        await onCase(next,result);
      }
    }catch(problem){
      if([400,409,413,415,422].includes(problem.status)&&typeof problem.code==='string'){
        session.pending=null;session.preview=null;await persist();
      }
      if(available())error=problem.message||String(problem);
    }finally{if(available()){busy=false;render();}}
  }
  async function apply(){
    const selected=session.preview;
    if(!selected?.canApply)return;
    syncDefaults();
    const body={document:clone(draft()),expectedVersion:selected.case.version,expectedPreviewSha256:selected.previewSha256,
      actor:recordingActor(),note:session.note||''};
    body.requestId=await mutationId('operations-ledger-intake:'+caseId,body);
    session.pending={body,documentSha256:selected.documentSha256};
    if(!await persist())download(state(),caseId+'-ledger-intake-original-request.json');render();await dispatch();
  }
  async function openDocument(file){
    if(file.size>64*1024*1024)throw new Error('Use a complete intake document or retained desk up to 64 MiB.');
    const parsed=JSON.parse(await file.text());if(!available())return;
    const originalPending=parsed.schema===DESK_SCHEMA&&parsed.caseId===caseId?parsed.pending:null;
    const problem=pendingActorProblem(originalPending?.body);if(problem)throw problem;
    const document=parsed.schema===DESK_SCHEMA?parsed.document:parsed;
    if(document?.schema!==SCHEMA||!Array.isArray(document.files)||document.files.length>20)
      throw new Error('Open a complete ledger-intake document or saved desk.');
    for(const item of document.files)if(!item||typeof item.contentBase64!=='string'||typeof item.id!=='string')
      throw new Error('Every source file must retain its complete content and file key.');
    session.document=clone(document);session.rawDefaults=parsed.schema===DESK_SCHEMA&&parsed.rawDefaults?clone(parsed.rawDefaults):{};
    session.inspections={};session.preview=null;session.result=null;session.selectedFile=0;
    session.pending=parsed.schema===DESK_SCHEMA&&parsed.caseId===caseId&&parsed.pending?clone(parsed.pending):null;
    session.note=parsed.schema===DESK_SCHEMA&&typeof parsed.note==='string'?parsed.note:'';
    await persist();
    notice=session.pending?'Opened the complete original pending request. Retry it to receive its native result.':'Opened every original source file. Review this input against the receiving case.';
  }
  root.addEventListener('toggle',event=>{if(event.target.matches('[data-li-reference]'))session.referenceOpen=event.target.open;},true);
  root.addEventListener('input',event=>{
    const target=event.target;
    if(session.pending)return;
    if(target.matches('[data-li-title]')){draft().title=target.value;edited();return;}
    if(target.matches('[data-li-note]')){session.note=target.value;schedule();return;}
    if(target.matches('[data-li-defaults]')){const file=activeFile();if(file){session.rawDefaults[file.id]=target.value;edited();}return;}
    const key=target.dataset.liFilter;
    if(!key||!['query','referenceQuery'].includes(key))return;
    const cursor=target.selectionStart;session[key]=target.value;session.page=0;render();
    const input=$('[data-li-filter="'+key+'"]');input?.focus();try{input?.setSelectionRange(cursor,cursor);}catch{}
  });
  root.addEventListener('change',event=>{
    const target=event.target;
    if(session.pending)return;
    if(target.matches('[data-li-files]')){
      const files=Array.from(target.files||[]),selectedKind=session.nextKind||'contributors';target.value='';
      run(async()=>{
        if(draft().files.length+files.length>20)throw new Error('An intake supports at most 20 original files.');
        if(files.some(file=>!file.size||file.size>8*1024*1024))throw new Error('Each original file must be nonempty and at most 8 MiB.');
        const added=[];
        for(const file of files){
          const bytes=await file.arrayBuffer(),ext=file.name.split('.').pop().toLowerCase();
          const format=selectedKind==='source'?'binary':ext==='tsv'?'tsv':ext==='json'?'json':'csv';
          const spec={id:'file-'+crypto.randomUUID(),filename:file.name,kind:selectedKind,format,
            contentBase64:b64(bytes),mapping:{},defaults:{},sourceUrl:'',observedAt:new Date().toISOString(),
            ...(file.type?{mediaType:file.type.split(';')[0]}:{})};
          draft().files.push(spec);added.push(spec);session.selectedFile=draft().files.length-1;edited();await persist();
        }
        const problems=[];
        for(const spec of added){try{await inspectFile(spec);}catch(problem){problems.push(spec.filename+': '+problem.message);}}
        if(problems.length)throw new Error(problems.join(' '));
      });return;
    }
    if(target.matches('[data-li-document]')){
      const file=target.files?.[0];target.value='';if(file)run(()=>openDocument(file));return;
    }
    if(target.matches('[data-li-next-kind]')){session.nextKind=target.value;render();return;}
    const field=target.dataset.liFileField,file=activeFile();
    if(field&&file){
      const oldId=file.id;
      if(field==='id'&&(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(target.value)||draft().files.some(other=>other!==file&&other.id===target.value))){
        error='Enter a distinct file key using letters, digits, dot, underscore, colon or dash.';render();return;
      }
      file[field]=target.value;
      if(field==='id'){
        if(Object.hasOwn(session.rawDefaults,oldId)){session.rawDefaults[file.id]=session.rawDefaults[oldId];delete session.rawDefaults[oldId];}
        delete session.inspections[oldId];
      }
      if(field==='kind'){
        file.mapping={};file.defaults={};delete session.rawDefaults[file.id];delete session.inspections[file.id];
        file.format=file.kind==='source'?'binary':file.filename.toLowerCase().endsWith('.json')?'json':file.filename.toLowerCase().endsWith('.tsv')?'tsv':'csv';
      }
      if(field==='format'){file.mapping={};delete session.inspections[file.id];}
      edited();render();return;
    }
    if(target.dataset.liMap&&file){file.mapping||={};file.mapping[target.dataset.liMap]=target.value||null;edited();return;}
    const key=target.dataset.liFilter;
    if(key){session[key]=target.value;session.page=0;render();}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-li-action]');
    if(!target||target.disabled)return;
    const action=target.dataset.liAction;
    if(action==='download-draft'){download(state(),caseId+'-ledger-intake-draft.json');return;}
    if(action==='download-request'&&session.pending){download(state(),caseId+'-ledger-intake-request.json');return;}
    if(action==='download-preview'&&session.preview){download(session.preview,caseId+'-ledger-intake-preview.json');return;}
    if(action==='download-result'&&session.result){download(session.result,caseId+'-ledger-intake-result.json');return;}
    if(action==='legacy-download'&&legacyCopy){download(legacyCopy,caseId+'-earlier-ledger-intake-desk.json');return;}
    if(busy||hostBusy)return;
    if(action==='open-saved'){
      run(async()=>{
        clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});
        const previous=await ownSaved(storageKey);if(!available())return;
        if(previous?.schema!==DESK_SCHEMA||previous.caseId!==caseId||previous.document?.schema!==SCHEMA)
          throw new Error('The saved draft is unavailable; download this complete draft to keep it.');
        download(state(),caseId+'-ledger-intake-local-'+Date.now()+'.json');
        restore(previous);notice='Downloaded the complete input from this tab and opened the newer saved draft.';
      });return;
    }
    if(action==='retry'){dispatch();return;}
    if(action==='legacy-inspect'){run(inspectLegacy);return;}
    if(action==='legacy-open'){run(openLegacy);return;}
    if(action==='legacy-close'){legacyCopy=null;legacySearched=false;render();return;}
    if(session.pending)return;
    if(action==='add-files'){$('[data-li-files]').click();return;}
    if(action==='open-document'){$('[data-li-document]').click();return;}
    if(action==='select-file'){session.selectedFile=Number(target.dataset.index);schedule();render();return;}
    if(action==='remove-file'){
      const file=activeFile();if(file){draft().files.splice(session.selectedFile,1);delete session.rawDefaults[file.id];delete session.inspections[file.id];edited();render();}return;
    }
    if(action.startsWith('template-')){
      const format=action.slice(9),kind=session.nextKind||'contributors',value=contract?.templates[kind]?.[format];
      if(value)download(value,kind+'.'+format,format==='tsv'?'text/tab-separated-values':'text/csv');return;
    }
    if(action==='inspect'){const file=activeFile();if(file)run(async()=>{syncDefaults();await inspectFile(file);});return;}
    if(action==='preview'){run(review);return;}
    if(action==='apply'){run(apply);return;}
    if(action==='previous'||action==='next'){session.page+=(action==='next'?1:-1);render();return;}
    if(action==='performance'){onOpen('performance');return;}
    if(action==='export-case'){run(async()=>{const response=await api(prefix+'/export.zip',undefined,{download:true});download(await response.blob(),caseId+'-complete-case.zip');});return;}
    if(action==='open-recorded'){run(async()=>{
      const value=await api(prefix+'/ledger-intakes/'+target.dataset.sourceId);
      if(value.document?.schema!==SCHEMA)throw new Error('The retained source is not a complete ledger intake.');
      session.document=value.document;session.rawDefaults={};session.inspections={};session.preview=null;session.pending=null;session.selectedFile=0;
      session.result={id:caseId,version:value.recorded.version,summary:value.recorded.summary,sourceId:value.source.id,records:value.recorded.records,files:value.recorded.files};
      await persist();notice='Opened the complete recorded input and original record mapping.';
    });}
  });
  async function initialize(){
    if(!session.initialized){
      session.initializing||=(async()=>{
        try{
          const previous=await ownSaved(storageKey);
          session.storageRevision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
          if(previous?.schema===DESK_SCHEMA&&previous.caseId===caseId)restore(previous);
        }catch{storageNote='Browser file storage is unavailable. Download the complete draft to keep the selected source files.';}
        session.initialized=true;
      })();
      await session.initializing;
    }
    await session.storageWrites.catch(()=>{});if(!available())return;
    session.document||={schema:SCHEMA,title:'Ledger intake',files:[]};session.rawDefaults||={};session.inspections||={};
    session.pending||=null;session.result||=null;render();
    const value=await api(prefix+'/ledger-intake');if(!available())return;contract=value;
    render();
  }
  session.document||={schema:SCHEMA,title:'Ledger intake',files:[]};session.rawDefaults||={};session.inspections||={};
  const ready=initialize().catch(problem=>{if(available())throw problem;});
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){active=false;clearTimeout(saveTimer);if(session.initialized)persist();}};
}
