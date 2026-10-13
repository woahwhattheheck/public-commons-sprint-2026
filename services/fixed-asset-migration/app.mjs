export async function mountFixedAssetWorkspace(E,boot,A,IssuerUI,extensions){
'use strict';
const $=s=>document.querySelector(s), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>crypto.randomUUID(), now=()=>new Date().toISOString(), copy=x=>JSON.parse(JSON.stringify(x));
const MAX=E.LIMITS.workspaceBytes, encoder=new TextEncoder();
let drafts=copy(boot.drafts||{corrections:{},mappings:{},multipliers:{},policies:{}});
for(const key of ['corrections','mappings','multipliers','policies'])drafts[key]??={};
let policySelected='',financePart='rollforwards',financeRole='all',financeQuery='',financePage=0;
let ws=boot.portable?E.importWorkspace(boot.portable):E.createWorkspace({id:id(),title:'Fixed asset migration and exit',createdAt:now()});
let copyId=boot.copyId||id(),dbRevision=0,db=null,manual=false,dirty=false,blocked=false,active=false,report=null,tab='sources',domain='assets',role='source',selected='',page=0,issuePage=0,query='',notice='',recovery=copy(boot.recovery||null),archive=null;
const copyKey=()=> 'fixed-asset-finance:'+copyId;
const workOrders=extensions?.workOrders||null;
const applicationSource=extensions?.applicationSource||null;
if(applicationSource)applicationSource.assertRuntime(boot.applicationSource,boot);
const workOrderPanel=extensions?.createWorkOrderPanel?extensions.createWorkOrderPanel(workOrders,{
 getWorkspace:()=>ws,
 change:(fn,workOrderDraft)=>{const next=copy(drafts);next.workOrders=copy(workOrderDraft);return change(fn,next);},
 download,getDraft:()=>drafts.workOrders,setDraft:value=>{drafts.workOrders=copy(value);dirty=true;},
 notice:status,now
}):null;
const sourcePreparationPanel=extensions?.createSourcePreparationPanel?extensions.createSourcePreparationPanel({...extensions.sourcePreparation,E,W:workOrders},{
 getWorkspace:()=>ws,
 change:(fn,preparationDraft)=>{const next=copy(drafts);next.sourcePreparation=copy(preparationDraft);return change(fn,next);},
 download,getDraft:()=>drafts.sourcePreparation,setDraft:value=>{drafts.sourcePreparation=copy(value);dirty=true;},now
}):null;
const issuer=IssuerUI({A,E,esc,table,options,button,download,wire,now,workspace:()=>ws,drafts:()=>drafts,change,render,fileText,dirty:()=>{dirty=true;}});
function download(name,text,type='application/json'){const b=text instanceof Blob?text:new Blob([text],{type});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
function safeName(x){return String(x).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'workspace';}
function wire(name,fn){const n=$('#'+name);if(n)n.addEventListener('click',()=>run(fn));}
function syncBusy(){
 const mount=$('#app');if(!mount)return;
 mount.inert=active;
 if(active)mount.setAttribute('aria-busy','true');else mount.removeAttribute('aria-busy');
 mount.querySelectorAll('button,input,select,textarea').forEach(n=>{
  if(active&&!n.disabled){n.dataset.operationDisabled='true';n.disabled=true;}
  else if(!active&&n.dataset.operationDisabled==='true'){n.disabled=false;delete n.dataset.operationDisabled;}
 });
}
async function run(fn){
 if(active)return;
 active=true;syncBusy();
 try{return await fn();}
 catch(e){notice=e.message||String(e);render();}
 finally{active=false;syncBusy();}
}
function submittedDrafts(entries){
 const value=copy(drafts);
 for(const [kind,key]of entries)delete value[kind][key];
 return value;
}
function status(message){notice=message;render();}
function readRecord(){return new Promise((resolve,reject)=>{const t=db.transaction('copies','readonly'),r=t.objectStore('copies').get(copyKey());r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('tjlabs-fixed-asset-finance-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('copies');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Browser storage is busy. Save a working HTML copy to continue independently.'));});}
function persist(next,nextDrafts=copy(drafts)){if(!db)throw new Error('Browser storage is unavailable. Use Save working HTML to retain this complete copy.');const text=E.exportWorkspace(next);
return new Promise((resolve,reject)=>{const t=db.transaction('copies','readwrite'),s=t.objectStore('copies'),r=s.get(copyKey());let err=null;const rev=dbRevision+1;r.onsuccess=()=>{const old=r.result;if((old?.revision||0)!==dbRevision){err=new Error('Another tab has saved this working copy. Download both complete versions and open a new working copy.');recovery={kind:'competing-tab',current:old?.portable||null,currentDrafts:copy(old?.drafts||{}),incoming:text,incomingDrafts:copy(nextDrafts)};t.abort();return;}s.put({revision:rev,portable:text,drafts:copy(nextDrafts),savedAt:now()},copyKey());};t.oncomplete=()=>{dbRevision=rev;resolve();};t.onabort=()=>reject(err||t.error||new Error('The complete working copy could not be saved.'));t.onerror=()=>{};});}
async function commit(result,nextDrafts=copy(drafts)){
 const next=result.workspace;
 if(manual){ws=next;drafts=nextDrafts;dirty=true;report=archive=null;notice='Revision '+ws.revision+' is in memory. Save working HTML to retain all changes.';render();return;}
 try{
  await persist(next,nextDrafts);
  ws=next;drafts=nextDrafts;blocked=false;report=null;archive=null;notice='Saved revision '+ws.revision+'. '+(result.receipt?.id||'');
 }catch(e){
  recovery=recovery||{kind:'storage-write',current:E.exportWorkspace(ws),currentDrafts:copy(drafts),incoming:E.exportWorkspace(next),incomingDrafts:copy(nextDrafts)};
  recovery.submittedDrafts=copy(drafts);drafts=nextDrafts;
  ws=next;blocked=true;dirty=true;report=null;archive=null;notice=e.message;
 }
 render();
}
function change(fn,nextDrafts=copy(drafts)){
 if(blocked)throw new Error('Save this complete working HTML as a new copy, then reopen it before editing. Both versions are available under recovery.');
 return commit(fn({operationId:id(),expectedRevision:ws.revision}),nextDrafts);
}
async function fileText(file,limit){if(!file)throw new Error('Choose a file.');if(file.size>limit)throw new Error('The selected file exceeds the '+Math.floor(limit/1048576)+' MiB input limit. It remains unchanged on your computer.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}
function selectedSource(){return ws.sources.find(s=>s.id===selected&&s.role===role&&s.domain===domain)||ws.sources.filter(s=>s.role===role&&s.domain===domain).at(-1);}
function selectedMapping(){return ws.mappings?.[role]?.[domain];}
function sourceText(s){return s?esc(s.filename)+' · '+s.rows.length+' records · '+s.sha256.slice(0,12):'Choose an imported file';}
function correctedRows(s){const by=new Map(s.rows.map(r=>[r.id,{...r,cells:[...r.cells]}]));for(const c of ws.corrections)if(c.sourceId===s.id){const r=by.get(c.rowId);if(r)r.cells[c.column]=c.value;}return [...by.values()];}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function options(values,current){return values.map(([v,label])=>'<option value="'+esc(v)+'" '+(v===current?'selected':'')+'>'+esc(label)+'</option>').join('');}
function button(id,label,cls=''){return '<button id="'+id+'" class="'+cls+'">'+esc(label)+'</button>';}
function selectors(){return '<div class="toolbar"><label>Dataset<select id="domain">'+options(Object.entries(E.DOMAINS).map(([k,v])=>[k,v.label]),domain)+'</select></label><label>File role<select id="role">'+options([['source','Original source'],['target','Returned target']],role)+'</select></label></div>';}
function policyFormModel(){
 const saved=ws.financePolicies.find(p=>p.id===policySelected);
 return drafts.policies[policySelected]||(saved?copy(saved):null);
}
function newPolicy(){
 const p={id:id(),company_id:'',book_id:'',currency:'',opening_date:'',closing_date:'',event_scope_complete:false,population_complete:false,rollforward_measures:[],carrying_equations:[],actor:'',note:''};
 drafts.policies[p.id]=p;policySelected=p.id;dirty=true;render();
}
function renderPolicy(){
 const basis=E.financeBasis(ws),existing=ws.financePolicies||[],ids=[...new Set([...existing.map(p=>p.id),...Object.keys(drafts.policies)])];
 if(!policySelected&&ids.length)policySelected=ids[0];
 const model=policyFormModel();
 let html='<section class="panel"><h2>Financial basis and review</h2><p>Define one exact company, book and currency for a stated opening and closing date. The saved review binds the currently selected files, mappings and corrections. Any change to those selections requires a new review before financial schedules can be confirmed.</p><p class="id">Current selected basis '+esc(basis)+'</p>'+table(['Policy','Company / book / currency','Period','Basis'],existing.map(p=>[
 '<span class="id">'+esc(p.id)+'</span>',esc(p.company_id)+' / '+esc(p.book_id)+' / '+esc(p.currency),
 esc(p.opening_date)+' → '+esc(p.closing_date),p.basis_sha256===basis?'Current selected basis':'Changed selection — review required'
 ]))+'<div class="toolbar">'+button('new-policy','Create financial review')+(ids.length?'<label>Selected review<select id="policy-select">'+options(ids.map(k=>{const p=drafts.policies[k]||existing.find(p=>p.id===k);return[k,(p.company_id||'New')+' / '+(p.book_id||'book')+' / '+(p.currency||'currency')+' · '+k]}),policySelected)+'</select></label>':'')+'</div></section>';
 html+='<p>Issuer reference decisions: '+esc(A.assessment(ws).selected?(A.assessment(ws).ready?'all selected policies resolved':'open or changed policy-field decisions remain'):'no issuer reference selected')+'. Retain supporting originals and finish their decisions before declaring this final financial basis.</p>';if(!model)return html+'<section class="panel"><p>Import and map the actual books and financial files, then create a review for the intended comparison. A missing population or event scope is left unconfirmed.</p></section>';
 html+='<section class="panel"><h3>Selected financial review</h3><p class="id">'+esc(model.id)+'</p><div class="fields">'+[
 ['company_id','Exact company ID','text'],['book_id','Exact book ID','text'],['currency','Exact currency','text'],['opening_date','Opening balance date','date'],['closing_date','Closing balance date','date'],['actor','Reviewer','text']
 ].map(([key,label,type])=>'<label>'+esc(label)+'<input data-policy="'+key+'" type="'+type+'" value="'+esc(model[key])+'"></label>').join('')+'</div><label>Review reason and source scope<textarea data-policy="note" rows="4">'+esc(model.note)+'</textarea></label>';
 html+='<div class="attestations"><label><input type="checkbox" data-policy="event_scope_complete" '+(model.event_scope_complete?'checked':'')+'> I confirm the selected events contain every signed movement for this company, book, currency and period, after the opening date through the closing date.</label><label><input type="checkbox" data-policy="population_complete" '+(model.population_complete?'checked':'')+'> I confirm the selected balance population is complete for comparison with its independent control totals.</label></div>';
 html+='<label>Measures to reconcile from opening balances and movements<textarea id="policy-measures" rows="4" spellcheck="false">'+esc(model.rollforward_measures.join('\n'))+'</textarea></label><p class="muted">Enter one exact source-defined measure per line. No sign, accounting category or missing balance is inferred. Opening + signed movements after opening and on or before closing is compared with the recorded closing balance.</p>';
 html+='<h3>Explicit carrying equations</h3><p>Add only equations supported by the selected book’s accounting basis. Choose each component and its sign explicitly; separate impairment is included only when the recorded basis requires it.</p>';
 for(const [index,equation]of model.carrying_equations.entries()){
 html+='<div class="panel equation"><div class="toolbar"><label>Recorded result measure<input data-equation="'+index+'" data-equation-field="result_measure" value="'+esc(equation.result_measure)+'"></label><button data-remove-equation="'+index+'">Remove equation</button></div>';
 html+=equation.components.map((part,j)=>'<div class="toolbar"><label>Sign<select data-equation="'+index+'" data-component="'+j+'" data-component-field="coefficient">'+options([['1','Add (+)'],['-1','Subtract (−)']],String(part.coefficient))+'</select></label><label>Exact component measure<input data-equation="'+index+'" data-component="'+j+'" data-component-field="measure" value="'+esc(part.measure)+'"></label><button data-remove-component="'+index+':'+j+'">Remove component</button></div>').join('');
 html+='<button data-add-component="'+index+'">Add component</button></div>';
 }
 html+='<div class="toolbar">'+button('add-equation','Add explicit equation')+'</div><label class="confirm"><input type="checkbox" id="confirm-policy"> I have reviewed the current source selection and this exact financial basis.</label><div class="toolbar">'+button('save-policy','Save reviewed financial basis')+button('download-policy-draft','Download this complete review draft')+'</div><p class="muted">Editing any review field clears the confirmation. Unfinished entries remain in the saved working HTML. Source changes are always checked again by the engine.</p></section>';
 return html;
}
function wirePolicy(){
 const chooser=$('#policy-select');if(chooser)chooser.onchange=()=>{policySelected=chooser.value;render();};
 wire('new-policy',newPolicy);
 const model=policyFormModel();if(!model)return;
 const retain=()=>{drafts.policies[model.id]=copy(model);dirty=true;const confirm=$('#confirm-policy');if(confirm)confirm.checked=false;};
 document.querySelectorAll('[data-policy]').forEach(n=>n.addEventListener('input',()=>{model[n.dataset.policy]=n.type==='checkbox'?n.checked:n.value;retain();}));
 const measures=$('#policy-measures');if(measures)measures.oninput=()=>{model.rollforward_measures=measures.value.split('\n').filter(x=>x.length);retain();};
 document.querySelectorAll('[data-equation-field]').forEach(n=>n.oninput=()=>{model.carrying_equations[Number(n.dataset.equation)][n.dataset.equationField]=n.value;retain();});
 document.querySelectorAll('[data-component-field]').forEach(n=>n.addEventListener('input',()=>{const part=model.carrying_equations[Number(n.dataset.equation)].components[Number(n.dataset.component)];part[n.dataset.componentField]=n.dataset.componentField==='coefficient'?Number(n.value):n.value;retain();}));
 wire('add-equation',()=>{model.carrying_equations.push({result_measure:'',components:[{measure:'',coefficient:1}]});retain();render();});
 document.querySelectorAll('[data-remove-equation]').forEach(n=>n.onclick=()=>{model.carrying_equations.splice(Number(n.dataset.removeEquation),1);retain();render();});
 document.querySelectorAll('[data-add-component]').forEach(n=>n.onclick=()=>{model.carrying_equations[Number(n.dataset.addComponent)].components.push({measure:'',coefficient:1});retain();render();});
 document.querySelectorAll('[data-remove-component]').forEach(n=>n.onclick=()=>{const [i,j]=n.dataset.removeComponent.split(':').map(Number);model.carrying_equations[i].components.splice(j,1);retain();render();});
 wire('download-policy-draft',()=>download('financial-review-'+model.id+'-draft.json',JSON.stringify({schema:'tjlabs.fixed-asset-financial-review-draft.v1',workspaceId:ws.id,revision:ws.revision,basis_sha256:E.financeBasis(ws),policy:model},null,2)));
 wire('save-policy',async()=>{if(!$('#confirm-policy').checked)throw new Error('Review and confirm the current financial basis before saving.');const policy=copy(model);for(const key of ['basis_sha256','revision','at'])delete policy[key];await change(meta=>E.saveFinancePolicy(ws,{...meta,at:now(),policy}),submittedDrafts([['policies',model.id]]));});
}
function renderFinanceSchedules(){
 const f=report?.financial;if(!f)return '';
 const labels={rollforwards:'Opening balances and movements',controls:'Independent control totals',equations:'Explicit carrying equations',journals:'Journal balance',policies:'Reviewed financial basis'};
 const rows=Array.isArray(f[financePart])?f[financePart]:[];
 const filtered=rows.filter(row=>(financeRole==='all'||row.role===financeRole||financePart==='policies')&&(!financeQuery||JSON.stringify(row).toLowerCase().includes(financeQuery.toLowerCase())));
 const pages=Math.max(1,Math.ceil(filtered.length/50));financePage=Math.min(financePage,pages-1);
 return '<section class="panel"><h2>Financial schedules</h2><p><strong>'+(f.confirmed?'Financial basis confirmed for selected scope':'Financial scope requires review')+'</strong></p><p>Amounts remain separate by company, book, currency, measure and date. A missing or unconfirmed comparison remains visible in its recorded state.</p><div class="toolbar"><label>Schedule<select id="finance-part">'+options(Object.entries(labels),financePart)+'</select></label><label>Role<select id="finance-role">'+options([['all','All roles'],['source','Original source'],['target','Returned target']],financeRole)+'</select></label><label>Search every result<input id="finance-query" type="search" value="'+esc(financeQuery)+'"></label></div>'+financeRows(filtered.slice(financePage*50,financePage*50+50))+'<div class="toolbar">'+button('finance-prev','Previous schedule page')+'<span>'+filtered.length+' records · page '+(financePage+1)+' of '+pages+'</span>'+button('finance-next','Next schedule page')+'</div><p class="muted">The complete JSON and readable report include every financial result.</p></section>';
}
function wireFinanceSchedules(){
 const p=$('#finance-part');if(p)p.onchange=()=>{financePart=p.value;financePage=0;render();};
 const r=$('#finance-role');if(r)r.onchange=()=>{financeRole=r.value;financePage=0;render();};
 const q=$('#finance-query');if(q)q.onchange=()=>{financeQuery=q.value;financePage=0;render();};
 wire('finance-prev',()=>{financePage=Math.max(0,financePage-1);render();});
 wire('finance-next',()=>{financePage++;render();});
}
function bytesToBase64(bytes){
 let text='';for(let at=0;at<bytes.length;at+=16384)text+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(text);
}
function base64ToBytes(value){
 const text=atob(value),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;
}
function renderSupporting(){
 const files=ws.supportingFiles||[];
 return '<section class="panel"><h2>Complete exit files</h2><p>Retain the original metadata, audit exports, data dictionaries, configuration and supporting documents alongside the financial records. These files are preserved byte-for-byte and travel with the complete editable handover.</p><p>Keep original XLSX files here. Import their explicitly prepared CSV exports under Source files for tabular comparison, and identify the corresponding workbook and sheet in the purpose below.</p><div class="fields"><label>Original file<input type="file" id="supporting-file"></label><label>Purpose and source relationship<textarea id="supporting-purpose" rows="4">'+esc(drafts.supportingPurpose||'')+'</textarea></label></div>'+button('receive-supporting','Retain complete original file')+'<p class="muted">The original format remains unchanged. Open retained documents with their appropriate application when reviewing the exit package. This workspace does not execute imported documents.</p></section><section class="panel"><h3>'+files.length+' complete supporting files</h3>'+table(['Original file','Purpose','Bytes / SHA-256','Download'],files.map((file,index)=>[
 esc(file.filename)+'<br><span class="muted">'+esc(file.mimeType||file.type||'application/octet-stream')+'</span>',esc(file.purpose),esc(file.bytes)+'<br><span class="id">'+esc(file.sha256)+'</span>','<button data-supporting="'+index+'">Download original</button>'
 ]))+'</section>';
}
function wireSupporting(){
 const purpose=$('#supporting-purpose');if(purpose)purpose.oninput=()=>{drafts.supportingPurpose=purpose.value;dirty=true;};
 wire('receive-supporting',async()=>{
 const file=$('#supporting-file').files[0],purpose=$('#supporting-purpose').value;
 if(!file)throw new Error('Choose the complete original supporting file.');
 if(!purpose.trim())throw new Error('Describe this file’s purpose and relationship to the financial records.');
 if(file.size>E.LIMITS.csvBytes)throw new Error('This file exceeds the supported per-file input size. Preserve the complete original in the source programme.');
 const bytes=new Uint8Array(await file.arrayBuffer()),base64=bytesToBase64(bytes);
 await change(meta=>E.importSupportingFile(ws,{...meta,at:now(),filename:file.name,mimeType:file.type||'application/octet-stream',purpose,base64}),{...copy(drafts),supportingPurpose:''});
 });
 document.querySelectorAll('[data-supporting]').forEach(n=>n.onclick=()=>{
 const f=ws.supportingFiles[Number(n.dataset.supporting)];
 download(f.filename,new Blob([base64ToBytes(f.base64)],{type:f.mimeType||'application/octet-stream'}),f.mimeType||'application/octet-stream');
 });
}
function renderSources(){
const src=selectedSource();if(src)selected=src.id;const list=ws.sources.filter(s=>s.role===role&&s.domain===domain);
let html=selectors()+'<section class="panel"><h2>Receive original files</h2><p>Keep each source export and returned target export as a separate edition. Select a UTF-8 CSV file; its original text, duplicate column headings and all cells are retained.</p><div class="toolbar"><label>CSV file<input type="file" id="csv" accept=".csv,text/csv"></label>'+button('import-csv','Import complete CSV')+button('template','Download empty template')+'</div><p class="muted">Empty templates describe the exchange fields. Each actual file is mapped explicitly before comparison.</p></section>';
html+='<section class="panel"><h2>Imported editions</h2>';
if(!list.length)html+='<p>No '+esc(role)+' '+esc(domain)+' file has been imported.</p>';
else{html+='<label>Choose edition<select id="source">'+options(list.map(s=>[s.id,s.filename+' · '+s.observedAt+' · '+s.rows.length+' records']),src.id)+'</select></label><p>'+sourceText(src)+'</p><p class="id">Source ID '+esc(src.id)+'</p><div class="toolbar">'+button('original','Download original CSV')+button('mapping-tab','Map this edition')+'</div>';
const rows=correctedRows(src),filtered=rows.filter(r=>!query||r.cells.some(c=>c.toLowerCase().includes(query.toLowerCase()))||r.id.includes(query));const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages-1);
html+='<label>Search full records<input id="row-search" type="search" value="'+esc(query)+'"></label><p>'+filtered.length+' matching records. Showing '+(filtered.length?page*50+1:0)+'–'+Math.min((page+1)*50,filtered.length)+'. Every row remains in downloads.</p>'+table(['Record',...src.headers.map((h,i)=>String(i+1)+': '+h),'Correction'],filtered.slice(page*50,page*50+50).map(r=>['<span class="id">'+esc(r.record)+'</span>',...r.cells.map(c=>'<span class="cell">'+esc(c)+'</span>'),'<button data-row="'+esc(r.id)+'">Edit cell</button>']))+'<div class="toolbar">'+button('prev','Previous')+'<span>Page '+(page+1)+' of '+pages+'</span>'+button('next','Next')+'</div>';
html+='<details id="correction-panel"><summary>Record a reviewed correction</summary><p>The original file remains unchanged. Enter the exact replacement value and the reason for the change.</p><div class="fields"><label>Record ID<input id="row-id" required></label><label>Original column<select id="column">'+options(src.headers.map((h,i)=>[String(i),String(i+1)+': '+h]),'0')+'</select></label><label>Replacement value<textarea id="value"></textarea></label><label>Reason<textarea id="reason" required></textarea></label><label>Reviewer<input id="actor" autocomplete="name" required></label></div>'+button('correct','Save correction')+'</details>';
}return html+'</section>';
}
function renderMapping(){
const src=selectedSource();if(src)selected=src.id;
let html=selectors()+'<section class="panel"><h2>Explicit field mapping</h2><p>Choose the original column for each exchange field. Column numbers distinguish repeated headings. Identifiers and values remain exactly as imported; reviewed corrections are applied separately.</p>';
const sources=ws.sources.filter(s=>s.role===role&&s.domain===domain);if(!src)return html+'<p>Import an original file for this dataset first.</p>'+button('sources-tab','Open source files')+'</section>';
html+='<label>Original edition<select id="source">'+options(sources.map(s=>[s.id,s.filename+' · '+s.observedAt]),src.id)+'</select></label><p>'+sourceText(src)+'</p>';
const m=selectedMapping(),hasDraft=Object.hasOwn(drafts.mappings,src.id),hasSaved=m?.sourceId===src.id,cols=hasDraft?drafts.mappings[src.id]:(hasSaved?m.columns:{});
html+=table(['Exchange field','Type','Original column'],E.DOMAINS[domain].fields.map(f=>{let ix=cols[f.name];if(ix===undefined&&!hasDraft&&!hasSaved){const exact=src.headers.map((h,i)=>h===f.name?i:-1).filter(i=>i>=0);ix=exact.length===1?exact[0]:undefined;}return [esc(f.label||f.name)+(f.required?' <strong>required</strong>':''),esc(f.type)+'<br><span class="muted">'+esc(f.reference?JSON.stringify(f.reference):'')+'</span>','<select data-field="'+esc(f.name)+'" aria-label="'+esc(f.name)+'">'+options([['','Unmapped'],...src.headers.map((h,i)=>[String(i),String(i+1)+': '+h])],ix===undefined?'':String(ix))+'</select>'];}));
const financial=['balances','events','journals','controls'].includes(domain),multiplier=Object.hasOwn(drafts.multipliers,src.id)?drafts.multipliers[src.id]:(hasSaved?m.amount_multiplier:'');
if(financial)html+='<label>Explicit amount scale<select id="amount-multiplier">'+options([['','Choose the recorded amount scale'],['1','1 — original currency amounts'],['1000','1000 — original amounts are in thousands']],String(multiplier))+'</select></label><p class="muted">This scale applies to the monetary fields in this mapping. Every original token remains unchanged. Currency conversion and accounting signs are never inferred.</p>';
html+='<div class="toolbar">'+button('save-map','Save and select this mapping')+button('run-report','Reconcile complete workspace')+'</div><p class="muted">The suggested choices above are editable. Save explicitly to select this edition. Columns left unmapped remain fully available in originals, corrected CSVs and coverage findings.</p>';
if(m)html+='<p>Currently selected mapping: <span class="id">'+esc(m.id)+'</span> · revision '+esc(m.revision)+'</p>';return html+'</section>';
}
function renderReport(){
if(!report)return '<section class="panel"><h2>Reconcile source and returned target</h2><p>Check identifiers, required fields, relationships, exact monetary amounts, books and currencies, attested balance rollforwards and journal balance, and compare all mapped rows and cells.</p>'+button('run-report','Reconcile complete workspace')+'</section>';
const all=report.issues||[],filtered=all.filter(i=>(domain==='all'||i.domain===domain)&&(!query||JSON.stringify(i).toLowerCase().includes(query.toLowerCase())));const pages=Math.max(1,Math.ceil(filtered.length/50));issuePage=Math.min(issuePage,pages-1);
let html=renderFinanceSchedules()+'<section class="panel"><div class="heading"><h2>Revision '+esc(report.revision)+' reconciliation</h2><strong>'+ (report.ready?'Reconciled under selected mappings':'Review findings')+'</strong></div><p>'+all.length+' findings across the complete selected source and target. Review unmapped columns and the actual target import result before operational acceptance.</p><div class="toolbar">'+button('run-report','Refresh reconciliation')+button('report-json','Download report JSON')+button('report-html','Download full readable report')+'<label>Dataset<select id="report-domain">'+options([['all','All datasets'],...Object.entries(E.DOMAINS).map(([k,v])=>[k,v.label])],domain)+'</select></label><label>Search findings<input id="issue-search" type="search" value="'+esc(query)+'"></label></div>';
html+=table(['Severity','Dataset / role','Finding','Record / field','Details'],filtered.slice(issuePage*50,issuePage*50+50).map(i=>[esc(i.severity),esc(i.domain)+'<br>'+esc(i.role),'<strong>'+esc(i.code)+'</strong><br>'+esc(i.message),'<span class="id">'+esc(i.rowId||'')+'</span><br>'+esc(i.field||'')+(i.sourceId?'<br><button data-finding="'+esc(i.id)+'">Open source record</button>':''),'<details><summary>Full finding</summary><pre>'+esc(JSON.stringify(i,null,2))+'</pre></details>']))+'<div class="toolbar">'+button('issue-prev','Previous')+'<span>'+filtered.length+' findings · page '+(issuePage+1)+' of '+pages+'</span>'+button('issue-next','Next')+'</div></section>';
for(const r of ['source','target'])for(const [d,selection]of Object.entries(report.domains[r]||{})){if(domain!=='all'&&domain!==d)continue;html+='<section class="panel"><h3>'+esc(E.DOMAINS[d].label)+' · '+esc(r)+' column coverage</h3><p>'+selection.rows.length+' complete selected records. '+selection.coverage.unmappedColumns.length+' original columns are outside the exchange fields.</p><details><summary>All original columns and mapped fields</summary>'+table(['Original column','Heading','Mapped fields'],selection.coverage.headers.map(h=>[esc(h.column+1),esc(h.name),esc(h.fields.join(', ')||'Unmapped — retained in original and corrected files')]))+'</details></section>';}
for(const [d,c]of Object.entries(report.comparisons||{})){if(domain!=='all'&&domain!==d)continue;html+='<section class="panel"><h3>'+esc(E.DOMAINS[d]?.label||d)+' · '+esc(c.state)+'</h3><p>'+esc(JSON.stringify(c.counts))+'</p><details><summary>Complete row and cell comparison ('+(c.rows?.length||0)+' rows)</summary><p>Download the complete report to retain every row and original value.</p><div class="compare-controls"><label>Exact row key<input id="key-'+esc(d)+'"></label><button data-find-key="'+esc(d)+'">Open row</button></div><pre id="comparison-'+esc(d)+'">Enter a complete key to inspect its source and returned target cells.</pre></details></section>';}
return html;
}
function financeValue(value){
 if(value===null||value===undefined)return '—';
 if(typeof value==='object')return '<details><summary>Complete values</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
 return '<span class="cell">'+esc(value)+'</span>';
}
function financeRows(value){
 if(!Array.isArray(value))return '<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';
 if(!value.length)return '<p>No rows for this section.</p>';
 if(value.some(v=>!v||typeof v!=='object'||Array.isArray(v)))return '<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';
 const keys=[...new Set(value.flatMap(row=>Object.keys(row)))];
 return table(keys.map(key=>key.replaceAll('_',' ')),value.map(row=>keys.map(key=>financeValue(row[key]))));
}
function financeSections(value){
 if(!value||typeof value!=='object')return '<p>No financial schedules have been calculated.</p>';
 return Object.entries(value).map(([name,rows])=>'<section class="panel"><h3>'+esc(name.replace(/_/g,' '))+'</h3>'+financeRows(rows)+'</section>').join('');
}
function financialReportHTML(){
 if(!report)throw new Error('Reconcile the current complete workspace first.');
 const styles='body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1240px;margin:32px auto;padding:0 24px}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border:1px solid #bbb;text-align:left;vertical-align:top}th{background:#eee}section{margin:24px 0}pre,.cell{white-space:pre-wrap;overflow-wrap:anywhere}pre{font-size:12px}.table-wrap{overflow:auto}.id{font-family:monospace;overflow-wrap:anywhere}@media print{details>*,details>summary{display:block}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}body{max-width:none;margin:0;padding:0}button{display:none}}';
 let body='<header><h1>'+esc(ws.title)+'</h1><p>Complete reconciliation at workspace revision '+esc(ws.revision)+'</p><p class="id">Workspace '+esc(ws.id)+'</p><p>Each amount belongs to its stated company, book, currency, measure and period. Original tokens, selected scale and all detailed differences remain in the complete editable handover.</p></header>';
 body+='<section><h2>Summary</h2>'+financeRows(report.summary)+'</section>';
 body+='<section><h2>Selected financial basis</h2>'+financeRows(ws.financePolicies||[])+'</section>';
 body+='<section><h2>Financial schedules</h2>'+financeSections(report.finance||report.financial||{})+'</section>';
 body+='<section><h2>Every finding</h2>'+financeRows(report.issues||[])+'</section>';
 for(const role of ['source','target'])for(const [name,selection]of Object.entries(report.domains?.[role]||{})){
 body+='<section><h2>'+esc(E.DOMAINS[name]?.label||name)+' · '+esc(role)+'</h2><h3>Column coverage</h3>'+financeRows(selection.coverage?.headers||[])+'<h3>All selected mapped rows</h3>'+financeRows(selection.rows||[])+'</section>';
 }
 for(const [name,value]of Object.entries(report.comparisons||{}))body+='<section><h2>'+esc(E.DOMAINS[name]?.label||name)+' source and returned target</h2><p>'+esc(value.state)+'</p>'+financeRows(value.counts)+'<h3>Complete comparisons</h3>'+financeRows(value.rows||[])+'</section>';
 body+='<section><h2>Full working history</h2><h3>Mapping editions</h3>'+financeRows(ws.mappingHistory)+'<h3>Reviewed corrections</h3>'+financeRows(ws.corrections)+'<h3>Financial basis history</h3>'+financeRows(ws.financePolicyHistory||[])+'</section>';
 body+='<section><h2>Issuer reference decision summary</h2>'+financeRows(A.assessment(ws).policies.map(p=>({policy:p.policyId,state:p.state,reviewer:p.review?.actor||'',decision:p.review?.decision||''})))+'<p>The complete issuer source, every original table, all normalized values and original policy-field bindings are in issuer/Issuer_Source_and_Policy_Report.html in the full handover.</p></section>';
 body+='<section><h2>Supporting exit files</h2>'+financeRows((ws.supportingFiles||[]).map(({base64,...file})=>file))+'</section>';
 body+='<footer><p>This report contains the full selected result. Receive the complete working HTML or workspace JSON to continue the original migration and preserve every source edition and operation.</p></footer>';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(ws.title)+' — full reconciliation</title><style>'+styles+'</style></head><body>'+body+'</body></html>';
}
function renderHistory(){return '<section class="panel"><h2>Complete working history</h2><p>'+ws.sources.length+' original editions · '+ws.mappingHistory.length+' mapping editions · '+ws.corrections.length+' corrections · '+ws.operations.length+' operations · '+ws.financePolicyHistory.length+' financial review editions.</p>'+table(['Revision','Reviewer','Original cell','Change','Reason'],ws.corrections.map(c=>[esc(c.revision),esc(c.actor)+'<br>'+esc(c.at),'<span class="id">'+esc(c.sourceId)+'<br>'+esc(c.rowId)+'</span><br>Column '+(c.column+1),'<pre>'+esc(c.before)+'</pre><p>→</p><pre>'+esc(c.value)+'</pre>',esc(c.reason)]))+'<details><summary>All mapping editions</summary><pre>'+esc(JSON.stringify(ws.mappingHistory,null,2))+'</pre></details><details><summary>All financial review editions</summary><pre>'+esc(JSON.stringify(ws.financePolicyHistory,null,2))+'</pre></details><div class="toolbar">'+button('workspace-json','Download complete editable workspace')+'</div></section>';}
function renderHandover(){const issuerStatus=A.assessment(ws);let html='<section class="panel"><h2>Complete editable handover</h2><p>Save a working HTML to reopen this complete project independently. The workspace JSON carries every original import, mapping, correction and operation. The handover ZIP adds original and corrected CSVs, mapped source and target files, financial schedules, complete reconciliation, reviewed basis history, every supporting exit file and the manifest.</p><div class="toolbar">'+button('save-html','Save working HTML')+button('workspace-json','Download workspace JSON')+button('prepare-handover','Prepare full handover')+'</div><label>Receive complete workspace JSON<input id="receive-file" type="file" accept=".json,application/json"></label>'+button('receive','Receive as an independent working copy')+'<p class="muted">Receiving first downloads the current complete workspace. Incoming data is validated before it becomes a new independent working copy.</p></section>';
html+='<p>'+(applicationSource?'The complete handover includes the retained application source, source-preparation CLI and accounting guides under application/. Start with OPEN_DELIVERY.txt.':'This older working HTML does not carry an application source bundle. Rebuild with the maintained application to include the complete offline source tools; original workspace exports remain available.')+'</p>';
html+='<section class="panel"><h3>Start another migration</h3><label>New workspace title<input id="new-title" maxlength="300" placeholder="Name the new migration"></label>'+button('new-workspace','Create independent workspace')+'<p class="muted">The current complete workspace is downloaded before a new project is opened.</p></section>';
html+='<p>Issuer decisions: '+esc(!issuerStatus.selected?'No issuer reference selected':issuerStatus.ready?'All selected issuer decisions resolved':'Pending or changed mapping-bound issuer decisions remain')+'. The complete source and decision report travels with the financial Exit.</p>';if(archive)html+='<section class="panel"><h3>Revision '+esc(archive.revision)+' handover</h3><p>'+archive.files.length+' complete files. '+(archive.ready?'Selected mappings reconcile.':'Open findings are retained in the report.')+'</p><div class="toolbar">'+button('zip','Download full handover ZIP')+button('handover-json','Download full handover JSON')+'</div>'+table(['File','Bytes','SHA-256','Download'],archive.files.map((f,i)=>[esc(f.path),esc(f.bytes),'<span class="id">'+esc(f.sha256)+'</span>','<button data-file="'+i+'">Download</button>']))+'</section>';return html;}
function render(){
const mount=$('#app');
mount.innerHTML='<header><div><p class="eyebrow">Fixed asset migration and exit</p><h1>'+esc(ws.title)+'</h1><p>Revision '+esc(ws.revision)+' · '+ws.sources.length+' retained files</p></div><div class="toolbar">'+button('top-save','Save working HTML')+button('top-json','Workspace JSON')+'</div></header><div id="notice" role="status" aria-live="polite">'+esc(notice||'Import original source files and actual returned target exports to begin.')+'</div>'+(recovery?'<section class="recovery"><h2>Complete version recovery</h2><p>'+esc(recovery.kind)+'. Both versions remain available. Save a new working HTML to continue independently.</p>'+button('recovery-current','Download other saved version')+button('recovery-incoming','Download this version')+button('recovery-bundle','Download complete recovery bundle')+button('manual-mode','Continue in downloaded-file mode')+'</section>':'')+'<nav aria-label="Workspace sections">'+[['sources','Source files'],...(sourcePreparationPanel?[['preparation','Prepare native sources']]:[]),['mapping','Field mapping'],['issuer','Issuer reference'],['policy','Financial basis'],['report','Reconciliation'],...(workOrderPanel?[['workorders','Work orders and costs']]:[]),['history','Working history'],['supporting','Exit files'],['handover','Handover']].map(([v,l])=>'<button data-tab="'+v+'" aria-current="'+(tab===v?'page':'false')+'">'+l+'</button>').join('')+'</nav><main>'+({sources:renderSources,preparation:()=>sourcePreparationPanel.render(),mapping:renderMapping,policy:renderPolicy,issuer:issuer.render,report:renderReport,workorders:()=>workOrderPanel.render(),history:renderHistory,supporting:renderSupporting,handover:renderHandover}[tab])()+'</main><footer><p>Original values remain in the complete working file. This application processes files locally in this browser.</p><p class="id">Workspace '+esc(ws.id)+' · Working copy '+esc(copyId)+'</p></footer>';
mount.querySelectorAll('[data-tab]').forEach(n=>n.onclick=()=>{tab=n.dataset.tab;query='';page=issuePage=0;if(tab==='report')domain='all';else if(domain==='all')domain='assets';render();});
for(const n of ['domain','role','source']){const el=$('#'+n);if(el)el.onchange=()=>{if(n==='domain')domain=el.value;if(n==='role')role=el.value;if(n==='source')selected=el.value;else selected='';query='';page=0;render();};}
const original=selectedSource();if(original&&tab==='sources'){const draft=drafts.corrections[original.id];if(draft){for(const [k,v]of Object.entries(draft)){const el=$('#'+k);if(el)el.value=v;}if(draft['row-id'])$('#correction-panel').open=true;}for(const key of ['row-id','column','value','reason','actor']){const el=$('#'+key);if(el)el.addEventListener('input',()=>{drafts.corrections[original.id]=Object.fromEntries(['row-id','column','value','reason','actor'].map(k=>[k,$('#'+k).value]));dirty=true;});}}
if(original&&tab==='mapping')mount.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{const values={};mount.querySelectorAll('[data-field]').forEach(n=>{if(n.value!=='')values[n.dataset.field]=Number(n.value);});drafts.mappings[original.id]=values;dirty=true;});
if(tab==='workorders'&&workOrderPanel)workOrderPanel.wire(render,run);
if(tab==='preparation'&&sourcePreparationPanel)sourcePreparationPanel.wire(render,run);
if(tab==='issuer')issuer.wire();if(tab==='supporting')wireSupporting();if(tab==='policy')wirePolicy();if(tab==='report')wireFinanceSchedules();
const multiplier=$('#amount-multiplier');if(multiplier)multiplier.onchange=()=>{drafts.multipliers[original.id]=multiplier.value;dirty=true;};
wire('top-save',saveHTML);wire('save-html',saveHTML);wire('top-json',()=>downloadWorkspace());wire('workspace-json',()=>downloadWorkspace());
wire('template',()=>download(domain+'-empty-template.csv',E.templateCsv(domain),'text/csv;charset=utf-8'));
wire('import-csv',async()=>{const file=$('#csv').files[0],chosenRole=role,chosenDomain=domain,observedAt=now(),text=await fileText(file,E.LIMITS.csvBytes);let outcome;await change(meta=>(outcome=E.importCsv(ws,{...meta,role:chosenRole,domain:chosenDomain,filename:file.name,text,observedAt})));selected=outcome.receipt.result.sourceId;role=chosenRole;domain=chosenDomain;render();});
wire('original',()=>{const s=selectedSource();download(s.filename,s.text,'text/csv;charset=utf-8');});
wire('mapping-tab',()=>{tab='mapping';render();});wire('sources-tab',()=>{tab='sources';render();});
const search=$('#row-search');if(search)search.onchange=()=>{query=search.value;page=0;render();};
wire('prev',()=>{page=Math.max(0,page-1);render();});wire('next',()=>{page++;render();});
mount.querySelectorAll('[data-row]').forEach(n=>n.onclick=()=>{const panel=$('#correction-panel');panel.open=true;$('#row-id').value=n.dataset.row;const s=selectedSource(),r=correctedRows(s).find(r=>r.id===n.dataset.row);$('#value').value=r?.cells[Number($('#column').value)]??'';drafts.corrections[s.id]=Object.fromEntries(['row-id','column','value','reason','actor'].map(k=>[k,$('#'+k).value]));dirty=true;panel.scrollIntoView({block:'nearest'});});
const col=$('#column');if(col)col.onchange=()=>{const s=selectedSource(),r=correctedRows(s).find(r=>r.id===$('#row-id').value);if(r)$('#value').value=r.cells[Number(col.value)]??'';drafts.corrections[s.id]=Object.fromEntries(['row-id','column','value','reason','actor'].map(k=>[k,$('#'+k).value]));dirty=true;};
wire('correct',async()=>{const s=selectedSource(),rowId=$('#row-id').value,column=Number($('#column').value),value=$('#value').value,reason=$('#reason').value,actor=$('#actor').value;if(!reason.trim()||!actor.trim())throw new Error('Enter the reviewer and reason.');await change(meta=>E.saveCorrection(ws,{...meta,sourceId:s.id,rowId,column,value,reason,actor,at:now()}),submittedDrafts([['corrections',s.id]]));});
wire('save-map',async()=>{const s=selectedSource(),columns={};mount.querySelectorAll('[data-field]').forEach(n=>{if(n.value!=='')columns[n.dataset.field]=Number(n.value);});const financial=['balances','events','journals','controls'].includes(domain),choice=$('#amount-multiplier')?.value;if(financial&&!['1','1000'].includes(choice))throw new Error('Choose the explicit original amount scale before saving this financial mapping.');const amount_multiplier=financial?Number(choice):1;await change(meta=>E.saveMapping(ws,{...meta,role,domain,sourceId:s.id,columns,amount_multiplier,at:now()}),submittedDrafts([['mappings',s.id],['multipliers',s.id]]));});
wire('run-report',()=>{report=E.reconcile(ws);tab='report';domain='all';query='';issuePage=0;notice='Complete reconciliation calculated for revision '+ws.revision+'.';render();});
mount.querySelectorAll('[data-finding]').forEach(n=>n.onclick=()=>{const f=report.issues.find(i=>i.id===n.dataset.finding);role=f.role;domain=f.domain;selected=f.sourceId;query=f.rowId||'';page=0;tab='sources';render();});
wire('report-json',()=>download('reconciliation-revision-'+ws.revision+'.json',JSON.stringify(report,null,2)));
wire('report-html',()=>download(safeName(ws.title)+'-complete-reconciliation.html',financialReportHTML(),'text/html;charset=utf-8'));
const ds=$('#report-domain');if(ds)ds.onchange=()=>{domain=ds.value;issuePage=0;render();};const q=$('#issue-search');if(q)q.onchange=()=>{query=q.value;issuePage=0;render();};wire('issue-prev',()=>{issuePage=Math.max(0,issuePage-1);render();});wire('issue-next',()=>{issuePage++;render();});
mount.querySelectorAll('[data-find-key]').forEach(n=>n.onclick=()=>{const d=n.dataset.findKey,key=$('#key-'+d).value,rows=report.comparisons[d].rows.filter(r=>r.key===key);$('#comparison-'+d).textContent=rows.length?JSON.stringify(rows,null,2):'No comparison row has that exact key.';});
wire('prepare-handover',()=>{archive=A.handover(ws,workOrders?workOrders.buildHandover(ws):undefined);const html=workingHTML('exit-'+ws.id+'-'+ws.revision),reportText=(report=E.reconcile(ws),financialReportHTML());archive.files=archive.files.filter(f=>f.path!=='MANIFEST.json');for(const [path,text,type]of [['Fixed_Asset_Finance_Workspace.html',html,'text/html;charset=utf-8'],['Complete_Financial_Report.html',reportText,'text/html;charset=utf-8']])archive.files.push({path,text,type,...A.textIdentity(text)});archive.manifest.files=archive.files.map(({text,base64,...f})=>f);const manifestText=JSON.stringify(archive.manifest,null,2)+'\n';archive.files.push({path:'MANIFEST.json',type:'application/json',text:manifestText,...A.textIdentity(manifestText)});if(applicationSource)archive=applicationSource.append(archive,boot.applicationSource);notice='Complete handover prepared for revision '+ws.revision+'.';render();});
wire('handover-json',()=>download(safeName(ws.title)+'-handover.json',JSON.stringify(archive,null,2)));
wire('zip',()=>download(safeName(ws.title)+'-handover.zip',makeZip(archive.files),'application/zip'));
mount.querySelectorAll('[data-file]').forEach(n=>n.onclick=()=>{const f=archive.files[Number(n.dataset.file)];download(f.path.split('/').at(-1),f.base64!==undefined?new Blob([base64ToBytes(f.base64)],{type:f.type||'application/octet-stream'}):f.text,f.type||'text/plain;charset=utf-8');});
wire('new-workspace',async()=>{const title=$('#new-title').value;if(!title.trim())throw new Error('Enter a title for the new migration.');const incoming=E.createWorkspace({id:id(),title,createdAt:now()});saveHTML('-before-new-project');ws=incoming;drafts={corrections:{},mappings:{},multipliers:{},policies:{}};policySelected='';copyId=id();dbRevision=0;dirty=true;report=archive=recovery=null;blocked=false;if(manual){dirty=true;}else{try{await persist(ws);}catch(e){manual=true;dirty=true;notice=e.message;}}tab='sources';domain='assets';role='source';selected='';query='';notice='New independent workspace created. Save working HTML to retain its identity.';render();});
wire('receive',async()=>{const file=$('#receive-file').files[0],raw=await fileText(file,MAX),incoming=E.importWorkspace(raw),prior=E.exportWorkspace(ws);saveHTML('-before-receiving');ws=incoming;drafts={corrections:{},mappings:{},multipliers:{},policies:{}};policySelected='';copyId=id();dbRevision=0;dirty=true;report=archive=null;recovery=null;blocked=false;if(manual){dirty=true;notice='Received a complete independent workspace in downloaded-file mode. Save working HTML to retain it.';render();return;}try{await persist(ws);}catch(e){blocked=true;dirty=true;recovery={kind:'received-workspace-storage-write',current:prior,incoming:E.exportWorkspace(ws)};notice=e.message;render();return;}notice='Received complete workspace as a new independent working copy. Save the working HTML to retain it.';render();});
wire('manual-mode',()=>{if(recovery.current)download('other-complete-workspace.json',recovery.current);downloadWorkspace('-before-file-mode');copyId=id();dbRevision=0;manual=true;blocked=false;dirty=true;notice='Working in downloaded-file mode. Save working HTML after edits; this independent copy stays in memory until saved.';render();});
wire('recovery-current',()=>{if(recovery.current)download('other-complete-workspace.json',recovery.current);else notice='No prior stored version exists.';});
wire('recovery-incoming',()=>download('this-complete-workspace.json',recovery.incoming));
wire('recovery-bundle',()=>download('complete-migration-recovery.json',JSON.stringify({schema:'tjlabs.migration-recovery.v1',workspaceId:ws.id,copyId,recovery},null,2)));
syncBusy();
}
function downloadWorkspace(suffix=''){download(safeName(ws.title)+suffix+'.json',E.exportWorkspace(ws));}
function workingHTML(key){const portable=E.exportWorkspace(ws),next={...boot,copyId:key,portable,drafts:copy(drafts),recovery:copy(recovery)};const doc=document.documentElement.cloneNode(true);doc.querySelector('#bootstrap').textContent=JSON.stringify(next).replace(/</g,'\\u003c');doc.querySelector('#app').innerHTML='<p>Opening complete migration workspace…</p>';return '<!doctype html>\n'+doc.outerHTML;}
function saveHTML(suffix=''){download(safeName(ws.title)+suffix+'-working.html',workingHTML(id()),'text/html;charset=utf-8');dirty=false;notice='Complete working HTML downloaded. Open that file to continue as an independent copy.';render();}
function makeZip(files){
const data=[],central=[];let offset=0;const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=b=>{let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const header=(len,fields)=>{const b=new Uint8Array(len),v=new DataView(b.buffer);for(const [at,value,size]of fields)size===2?v.setUint16(at,value,true):v.setUint32(at,value,true);return b;};
for(const f of files){if(!f.path||f.path.startsWith('/')||f.path.split('/').some(p=>p==='..'||!p))throw new Error('Unsafe handover member path.');const name=encoder.encode(f.path),body=f.base64!==undefined?base64ToBytes(f.base64):encoder.encode(f.text),sum=crc(body);if(name.length>65535||offset+body.length>512*1048576)throw new Error('Handover exceeds the browser ZIP limit. Download individual complete files or use the CLI.');const h=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,sum,4],[18,body.length,4],[22,body.length,4],[26,name.length,2]]);data.push(h,name,body);central.push(header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,sum,4],[20,body.length,4],[24,body.length,4],[28,name.length,2],[42,offset,4]]),name);offset+=30+name.length+body.length;}
const size=central.reduce((n,b)=>n+b.length,0);return new Blob([...data,...central,header(22,[[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,size,4],[16,offset,4]])],{type:'application/zip'});}
try{db=await openDB();const saved=await readRecord();if(saved){try{ws=E.importWorkspace(saved.portable);drafts=copy(saved.drafts||drafts);for(const key of ['corrections','mappings','multipliers','policies'])drafts[key]??={};dbRevision=saved.revision;notice='Reopened complete browser working copy from '+saved.savedAt+'.';}catch(e){blocked=true;recovery={kind:'unreadable-stored-version',current:saved.portable,currentDrafts:copy(saved.drafts||{}),incoming:E.exportWorkspace(ws),incomingDrafts:copy(drafts)};notice='The stored version could not be validated. Download it for recovery and save a new working HTML.';}}else await persist(ws);}catch(e){blocked=false;manual=true;dirty=true;notice='Downloaded-file mode: '+e.message+' Save working HTML after edits to retain the complete project.';}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
render();
}